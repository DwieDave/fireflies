// The processes and ports manager's corner of the tab strip (the deck itself
// is the nocturne-procs mod): a tree mark beside the script runner's ▶ and,
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
import { terminals, openOverlay, closeOverlay, shared, setShared, exec } from "herdr";
import { ART, dropBelow } from "./kit.js";

export const DECK = "nocturne-procs.deck";
// { at, n }: listening ports in this app's terminals, from the deck or the strip.
export const COUNT = "nocturne-procs.count";
export const DECK_W = 480;
export const DECK_H = 560;
const SEP = "@@nocturne-procs@@";
export const PORTS_PROBE = `LC_ALL=C ps -axo pid=,ppid=; echo '${SEP}'; lsof -nP -iTCP -sTCP:LISTEN -F pn 2>/dev/null; true`;

/** Opens the deck (`tab`: "procs" or "ports"), or closes it when open
 *  (`tab` given to an open deck: it switches to it instead). `wasOpen`: the
 *  mark was lit when pressed (tabs.js tool): the press closed the deck
 *  already, or closes it now; either way it stays closed. */
export function toggleProcs({ centered = false, at = null, wasOpen = false, tab = null } = {}) {
  const open = procsOpen();
  if (open) {
    const d = shared(DECK);
    if (tab && d?.tab !== tab) { setShared(DECK, { ...d, want: tab, beat: Date.now() }); return; }
    setShared(DECK, null);
    closeOverlay(open);
    return;
  }
  if (wasOpen) return;
  const id = openOverlay({ mod: "nocturne-procs", kind: centered ? "dialog" : "popup", frame: "none",
    width: DECK_W, height: DECK_H, ...(at && !centered ? { at } : {}), props: { tab: tab ?? "procs" } });
  setShared(DECK, { id, tab: tab ?? "procs", beat: Date.now() });
}

/** The open deck's overlay id, or null. The deck renews shared(DECK) every
 *  refresh, so a note left by an app restart doesn't swallow a press. */
export function procsOpen() {
  const d = shared(DECK);
  return d?.id && Date.now() - (d.beat ?? 0) < 6000 ? d.id : null;
}

/** Listening ports whose process runs in one of `terms` (live local terminals' records). */
export function countPorts(text, terms) {
  const [ps = "", lsof = ""] = String(text ?? "").split(SEP);
  const parent = new Map();
  for (const line of ps.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)/.exec(line);
    if (m) parent.set(Number(m[1]), Number(m[2]));
  }
  const roots = new Set(terms.filter((t) => t?.pid && !String(t.address).includes("/") && t.state !== "finished").map((t) => Number(t.pid)));
  const ours = (pid) => {
    const seen = new Set();
    for (let p = pid; p && !seen.has(p); p = parent.get(p)) { if (roots.has(p)) return true; seen.add(p); }
    return false;
  };
  const ports = new Set();
  let pid = null;
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
export async function readCount(now = Date.now()) {
  const c = shared(COUNT);
  if (reading || (c && now - (c.at ?? 0) < 10000)) return;
  reading = true;
  try {
    const r = await exec("sh", ["-c", PORTS_PROBE], { timeout: 10000 });
    setShared(COUNT, { at: Date.now(), n: countPorts(r?.stdout, terminals()) });
  } catch { /* no count: the mark alone */ }
  finally { reading = false; }
}

/** The strip's control: the tree mark and the port count. `tool` is the strip's icon button. */
export function procsControl(t, tool) {
  readCount();
  const open = Boolean(procsOpen());
  const n = shared(COUNT)?.n ?? 0;
  const tip = n ? `Processes and ports · ${n} listening` : "Processes and ports";
  return tool(t, "tab-procs", open, open ? null : tip, (e, wasOpen) => toggleProcs({ at: dropAt(e), wasOpen }),
    svg(`${ART}/tree.svg`).size(9).text_color(open ? t.accent : t.muted),
    ...(n ? [div().text_size(11).text_color(t.ansi6 ?? t.accent).child(`:${n}`)] : []));
}

const dropAt = (e) => dropBelow(e, DECK_W);
