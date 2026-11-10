// The engine, run by the bell (the copy in the layout): reads what each
// waiting agent shows and what its hook recorded, makes the items
// (model.js) and keeps them in shared(ITEMS) for the overview, the
// question dialog and Nocturne's toasts. Answers go out through drive.js.

import { terminals, agents, hc, exec, shared, setShared } from "herdr";
import { collect, adapterOf, statusOf, splitAddress } from "./model.js";

export const ITEMS = "nocturne-notifications.items";
export const OPEN = "nocturne-notifications.open"; // { terminal, at }: what the overview opens on
export const DISMISSED = "nocturne-notifications.dismissed"; // { [item id]: true }: errors put away

/** The name a person gave a terminal (Nocturne's rename label), by address. */
function givenNames(list) {
  const out = {};
  for (const t of list) if (t?.labels?.["nocturne.name"]) out[t.address] = t.labels["nocturne.name"];
  return out;
}

/** The visible screen of a terminal ("" when it can't be read). */
export async function readScreen(address) {
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

/** Hook records by address for these terminals: { [address]: { at, payload } }. */
export async function readRecords(addresses) {
  const byMachine = new Map();
  for (const a of addresses) {
    const { machine, id } = splitAddress(a);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) continue;
    byMachine.set(machine, [...(byMachine.get(machine) ?? []), id]);
  }
  const out = {};
  for (const [machine, ids] of byMachine) {
    const r = await exec("sh", ["-c", RECORDS, "sh", ...ids], { on: machine, timeout: 8000 }).catch(() => null);
    for (const part of (r?.stdout ?? "").split("\n@@record ").slice(1)) {
      const nl = part.indexOf("\n");
      const [id, at] = part.slice(0, nl).split(" ");
      try {
        out[machine ? `${machine}/${id}` : id] = { at: Number(at) * 1000, payload: JSON.parse(part.slice(nl + 1)) };
      } catch { /* half-written: next time */ }
    }
  }
  return out;
}

export class Engine {
  constructor() {
    this.info = {}; // address -> { screen, record, since, read }
    this.busy = false;
    this.seen = {}; // address -> { key, at }: when this status (and request) began, as seen here
  }

  /** When each terminal's current status began: its status_ms, unless this engine saw it change later. */
  since(list) {
    const out = {};
    const now = Date.now();
    for (const t of list) {
      const key = `${statusOf(t)}|${t.report?.kind ?? ""}|${t.report?.msg ?? ""}`;
      const had = this.seen[t.address];
      const ms = Number(t.status_ms) || 0;
      if (!had) this.seen[t.address] = { key, at: ms || now };
      else if (had.key !== key) this.seen[t.address] = { key, at: Math.max(ms, now) };
      out[t.address] = this.seen[t.address].at;
    }
    for (const a of Object.keys(this.seen)) if (!(a in out)) delete this.seen[a];
    return out;
  }

  /** Reads what changed: every waiting agent's screen, finished ones' once. */
  async refresh() {
    if (this.busy) return false;
    this.busy = true;
    try {
      const list = terminals().filter((t) => t?.state !== "finished");
      const waiting = list.filter((t) => ["blocked", "error"].includes(statusOf(t)));
      const live = new Set(waiting.map((t) => t.address));
      for (const a of Object.keys(this.info)) if (!live.has(a)) delete this.info[a];
      const began = this.since(list);
      const blocked = waiting.filter((t) => statusOf(t) === "blocked");
      const records = await readRecords(blocked.filter((t) => adapterOf(t).hook).map((t) => t.address));
      for (const t of waiting) {
        const since = began[t.address];
        const had = this.info[t.address];
        // Failed: read once for its last lines. Waiting: every time.
        if (statusOf(t) !== "blocked" && had?.since === since) continue;
        const screen = await readScreen(t.address);
        this.info[t.address] = { screen, record: records[t.address] ?? null, since, read: Date.now() };
      }
      return this.publish(list);
    } finally {
      this.busy = false;
    }
  }

  /** Items into shared(ITEMS), when they changed. */
  publish(list = terminals()) {
    const items = collect({ terminals: list, agents: agents(), info: this.info, since: this.since(list), names: givenNames(list), dismissed: shared(DISMISSED) ?? {} });
    const before = shared(ITEMS);
    if (JSON.stringify(before ?? []) === JSON.stringify(items)) return false;
    setShared(ITEMS, items);
    return true;
  }
}

/** The items as last published. */
export const items = () => (Array.isArray(shared(ITEMS)) ? shared(ITEMS) : []);

/** Puts an error away (it isn't asking anything). */
export function dismiss(id) {
  const d = { ...(shared(DISMISSED) ?? {}) };
  d[id] = true;
  // Keep the newest 200.
  const keys = Object.keys(d);
  for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete d[k];
  setShared(DISMISSED, d);
  setShared(ITEMS, items().filter((i) => i.id !== id));
}
