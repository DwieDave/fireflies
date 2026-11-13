// The processes and ports manager's corner of the tab strip (the deck itself
// is the procs mod): a tree mark beside the script runner's ▶ and,
// when the processes in this app's terminals listen on TCP ports, how many
// in teal (":2"). A click opens the deck hanging under the mark (kit.js
// dropBelow), a second closes it (tabs.js tool, as ▶); the mark is lit while
// it's open. nocturne.procs (no key by default) opens it centered or closes
// it; nocturne.ports the same, on its ports tab.
//
// The count is the strip's own light read every 10 s (PORTS_PROBE: pids and
// parents, and lsof's listening ports), walking each port's process up to a
// terminal's pid. While the deck is open it writes the count it sees to
// shared(COUNT) with each refresh, and the strip shows that.

import { div, svg } from "gpui-kit";
import type { Element, MouseButtonEvent } from "gpui-kit";
import { terminals, openOverlay, closeOverlay, shared, setShared, exec } from "herdr";
import type { Theme } from "herdr";
import { isNumber, isString, literal, nullable, object, readShared, sharedKey, writeShared } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import { isTerminal } from "./guards.ts";
import type { Terminal } from "./guards.ts";
import { ART, dropBelow } from "./kit.ts";
import type { DropAt, ToolButton } from "./kit.ts";

/** The deck's two tabs. */
const isDeckTab = literal("procs", "ports");

export type DeckTab = Guarded<typeof isDeckTab>;

export const DECK = "procs.deck";

/** The open deck: { id, tab, beat }, and `want`: a tab the strip asks it to show (the procs mod reads it). */
const DECK_KEY = sharedKey(DECK, nullable(object({ id: isString }, { tab: isDeckTab, beat: isNumber, want: isDeckTab })));

// { at, n }: listening ports in this app's terminals, from the deck or the strip.
export const COUNT = "procs.count";
const COUNT_KEY = sharedKey(COUNT, nullable(object({}, { at: isNumber, n: isNumber })));
export const DECK_W = 480;
export const DECK_H = 560;
const SEP = "@@procs@@";
export const PORTS_PROBE = `LC_ALL=C ps -axo pid=,ppid=; echo '${SEP}'; lsof -nP -iTCP -sTCP:LISTEN -F pn 2>/dev/null; true`;

/** How the deck is opened (toggleProcs). */
export interface ProcsOpening {
  readonly centered?: boolean;
  readonly at?: DropAt | null;
  readonly wasOpen?: boolean;
  readonly tab?: DeckTab | null;
}

/** Opens the deck (`tab`: "procs" or "ports"), or closes it when open
 *  (`tab` given to an open deck: it switches to it instead). `wasOpen`: the
 *  mark was lit when pressed (tabs.js tool): the press closed the deck
 *  already, or closes it now; either way it stays closed. */
export function toggleProcs({ centered = false, at = null, wasOpen = false, tab = null }: ProcsOpening = {}): void {
  const open = procsOpen();

  if (open) {
    const d = readShared(shared, DECK_KEY, null);

    if (tab && d && d.tab !== tab) {
      writeShared(setShared, DECK_KEY, { ...d, want: tab, beat: Date.now() });

      return;
    }

    writeShared(setShared, DECK_KEY, null);
    closeOverlay(open);

    return;
  }

  if (wasOpen) return;

  const props = { tab: tab ?? "procs" };
  const kind = centered ? "dialog" : "popup";

  const id = openOverlay(at && !centered
    ? { mod: "procs", kind, frame: "none", width: DECK_W, height: DECK_H, at, props }
    : { mod: "procs", kind, frame: "none", width: DECK_W, height: DECK_H, props });

  writeShared(setShared, DECK_KEY, { id, tab: tab ?? "procs", beat: Date.now() });
}

/** The open deck's overlay id, or null. The deck renews shared(DECK) every
 *  refresh, so a note left by an app restart doesn't swallow a press. */
export function procsOpen(): string | null {
  const d = readShared(shared, DECK_KEY, null);

  return d?.id && Date.now() - (d.beat ?? 0) < 6000 ? d.id : null;
}

/** Listening ports whose process runs in one of `terms` (live local terminals' records). */
export function countPorts(text: string | null | undefined, terms: readonly Terminal[]): number {
  const [ps = "", lsof = ""] = (text ?? "").split(SEP);
  const parent = new Map<number, number>();

  for (const line of ps.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)/.exec(line);

    if (m) parent.set(Number(m[1]), Number(m[2]));
  }

  const roots = new Set(terms.flatMap((t) => (t.pid && !t.address.includes("/") && t.state !== "finished" ? [t.pid] : [])));

  const ours = (pid: number) => {
    const seen = new Set<number>();

    for (let p: number | undefined = pid; p && !seen.has(p); p = parent.get(p)) {
      if (roots.has(p)) return true;

      seen.add(p);
    }

    return false;
  };

  const ports = new Set<number>();
  let pid: number | null = null;

  for (const line of lsof.split("\n")) {
    if (line[0] === "p") pid = Number(line.slice(1));
    else if (line[0] === "n" && pid != null && ours(pid)) {
      const m = /:(\d+)$/.exec(line);

      if (m) ports.add(Number(m[1]));
    }
  }

  return ports.size;
}

let reading = false;

/** The strip's read of the count, at most every 10 s, and none while the deck reads it. */
export async function readCount(now = Date.now()): Promise<void> {
  const c = readShared(shared, COUNT_KEY, null);

  if (reading || (c && now - (c.at ?? 0) < 10000)) return;

  reading = true;

  try {
    const r = await exec("sh", ["-c", PORTS_PROBE], { timeout: 10000 });

    writeShared(setShared, COUNT_KEY, { at: Date.now(), n: countPorts(r.stdout, terminals().filter((t) => isTerminal(t))) });
  } catch {
    /* no count: the mark alone */
  } finally {
    reading = false;
  }
}

const dropAt = (e: MouseButtonEvent | undefined) => dropBelow(e, DECK_W);

/** The strip's control: the tree mark and the port count. `tool` is the strip's icon button. */
export function procsControl(t: Theme, tool: ToolButton): Element {
  readCount();

  const open = Boolean(procsOpen());
  const n = readShared(shared, COUNT_KEY, null)?.n ?? 0;
  const tip = n ? `Processes and ports · ${n} listening` : "Processes and ports";
  const mark = svg(`${ART}/tree.svg`).size(9).text_color(open ? t.accent : t.muted);
  const press = (e: MouseButtonEvent | undefined, wasOpen: boolean) => toggleProcs({ at: dropAt(e), wasOpen });

  return n
    ? tool(t, "tab-procs", open, open ? null : tip, press, mark, div().text_size(11).text_color(t.ansi6).child(`:${n}`))
    : tool(t, "tab-procs", open, open ? null : tip, press, mark);
}
