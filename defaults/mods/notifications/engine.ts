// The engine, run by the bell (the copy in the layout): reads what each
// waiting agent shows and what its hook recorded, makes the items
// (model.ts) and keeps them in shared(ITEMS) for the overview, the
// question dialog and Nocturne's toasts. Answers go out through drive.ts.

import { terminals, agents, hc, exec, shared, setShared } from "herdr";
import { arrayOf, isNumber, isString, literal, nullable, object, parseJson, readSharedList, readSharedMap, sharedKey, sharedListKey, sharedMapKey, writeShared, writeSharedMap } from "./guard.ts";
import { collect, adapterOf, isItem, isTerminal, statusOf, splitAddress } from "./model.ts";
import type { Info, Item, Terminal } from "./model.ts";
import { isHookPayload } from "./request.ts";
import type { HookRecord } from "./request.ts";

export const ITEMS = "notifications.items";
export const OPEN = "notifications.open"; // { terminal, at }: what the overview opens on
export const DISMISSED = "notifications.dismissed"; // { [item id]: true }: errors put away

/** The items, newest first within a type (model.ts collect). */
export const ITEMS_KEY = sharedListKey(ITEMS, isItem);

/** ITEMS, written whole. */
const ITEMS_LIST = sharedKey(ITEMS, arrayOf(isItem));

/** The request a toast asked the overview to open on: its terminal, and when. */
export const OPEN_KEY = sharedKey(OPEN, nullable(object({ terminal: isString }, { at: isNumber })));

/** The errors put away, by item id (each `true`). */
const DISMISSED_KEY = sharedMapKey(DISMISSED, literal(true));

/** The terminals as terminals() lists them, the fields read here (one in another shape is
 *  left out). */
export const terminalsNow = (): Terminal[] => terminals().filter((t) => isTerminal(t));

/** The name a person gave a terminal (Nocturne's rename label), by address. */
function givenNames(list: readonly Terminal[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>();

  for (const t of list) {
    const name = t.labels?.["nocturne.name"];

    if (name) out.set(t.address, name);
  }

  return out;
}

/** The visible screen of a terminal (null when it can't be read). */
export async function readScreen(address: string): Promise<string | null> {
  const r = await hc(["read", address, "--lines", "0"]).catch(() => null);

  return r?.code === 0 ? r.stdout : null;
}

// Hook records live where bin/claude-hook writes them, on the agent's machine.
const RECORDS = [
  'd="${XDG_STATE_HOME:-$HOME/.local/state}/herdr-app/notify"',
  'for id in "$@"; do',
  '  f="$d/$id.claude.json"',
  '  [ -f "$f" ] || continue',
  '  printf \'\\n@@record %s %s\\n\' "$id" "$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null)"',
  '  cat "$f"',
  'done',
].join("\n");

/** Hook records by address for these terminals. */
export async function readRecords(addresses: readonly string[]): Promise<ReadonlyMap<string, HookRecord>> {
  const byMachine = new Map<string | null, string[]>();

  for (const a of addresses) {
    const { machine, id } = splitAddress(a);

    if (!/^[A-Za-z0-9_-]+$/.test(id)) continue;

    byMachine.set(machine, [...(byMachine.get(machine) ?? []), id]);
  }

  const out = new Map<string, HookRecord>();

  for (const [machine, ids] of byMachine) {
    const r = await exec("sh", ["-c", RECORDS, "sh", ...ids], { on: machine, timeout: 8000 }).catch(() => null);

    for (const part of (r?.stdout ?? "").split("\n@@record ").slice(1)) {
      const nl = part.indexOf("\n");
      const [id = "", at = ""] = part.slice(0, nl).split(" ");
      // Half-written: next time.
      const payload = parseJson(part.slice(nl + 1), isHookPayload);

      if (payload) out.set(machine ? `${machine}/${id}` : id, { at: Number(at) * 1000, payload });
    }
  }

  return out;
}

/** What a terminal showed when last read, and when its status began. */
interface Read extends Info {
  readonly since: number;
  readonly read: number;
}

export class Engine {
  info = new Map<string, Read>(); // address -> what it showed
  busy = false;
  seen = new Map<string, { readonly key: string; readonly at: number }>(); // address -> when this status (and request) began, as seen here

  /** When each terminal's current status began: its status_ms, unless this engine saw it change later. */
  since(list: readonly Terminal[]): ReadonlyMap<string, number> {
    const out = new Map<string, number>();
    const now = Date.now();

    for (const t of list) {
      const key = `${statusOf(t)}|${t.report?.kind ?? ""}|${t.report?.msg ?? ""}`;
      const had = this.seen.get(t.address);
      const ms = t.status_ms || 0;
      const seen = !had ? { key, at: ms || now } : had.key !== key ? { key, at: Math.max(ms, now) } : had;

      this.seen.set(t.address, seen);
      out.set(t.address, seen.at);
    }

    for (const a of this.seen.keys()) if (!out.has(a)) this.seen.delete(a);

    return out;
  }

  /** Reads what changed: every waiting agent's screen, finished ones' once. */
  async refresh(): Promise<boolean> {
    if (this.busy) return false;

    this.busy = true;

    try {
      const list = terminalsNow().filter((t) => t.state !== "finished");
      const waiting = list.filter((t) => ["blocked", "error"].includes(statusOf(t) ?? ""));
      const live = new Set(waiting.map((t) => t.address));

      for (const a of this.info.keys()) if (!live.has(a)) this.info.delete(a);

      const began = this.since(list);
      const blocked = waiting.filter((t) => statusOf(t) === "blocked");
      const records = await readRecords(blocked.filter((t) => adapterOf(t).hook).map((t) => t.address));

      for (const t of waiting) {
        const since = began.get(t.address) ?? 0;
        const had = this.info.get(t.address);

        // Failed: read once for its last lines. Waiting: every time.
        if (statusOf(t) !== "blocked" && had?.since === since) continue;

        const screen = await readScreen(t.address);

        this.info.set(t.address, { screen, record: records.get(t.address) ?? null, since, read: Date.now() });
      }

      return this.publish(list);
    } finally {
      this.busy = false;
    }
  }

  /** Items into shared(ITEMS), when they changed. */
  publish(list: readonly Terminal[] = terminalsNow()): boolean {
    const dismissed = new Set(readSharedMap(shared, DISMISSED_KEY).keys());
    const now = collect({ terminals: list, agents: agents(), info: this.info, since: this.since(list), names: givenNames(list), dismissed });

    if (JSON.stringify(readSharedList(shared, ITEMS_KEY)) === JSON.stringify(now)) return false;

    writeShared(setShared, ITEMS_LIST, now);

    return true;
  }
}

/** The items as last published. */
export const items = (): readonly Item[] => readSharedList(shared, ITEMS_KEY);

/** Puts an error away (it isn't asking anything). */
export function dismiss(id: string) {
  const d = new Map(readSharedMap(shared, DISMISSED_KEY));

  d.set(id, true);

  // Keep the newest 200.
  const keys = [...d.keys()];

  for (const k of keys.slice(0, Math.max(0, keys.length - 200))) d.delete(k);

  writeSharedMap(setShared, DISMISSED_KEY, d);
  writeShared(setShared, ITEMS_LIST, items().filter((i) => i.id !== id));
}
