// The engine, run by the bell (the copy in the layout): reads what each
// waiting agent shows and what its hook recorded, makes the items
// (model.ts) and keeps them in shared(ITEMS) for the overview, the
// question dialog and Nocturne's toasts. Answers go out through drive.ts.

import { Array as Arr, Clock, Effect, Option, Record as Rec, Schema, String as Str } from "effect";
import { shared, setShared } from "herdr";
import { Exec, Shared, Workspace, decodeJsonOption, readShared, sharedKey, writeShared } from "@fireflies/kit";
import { agents, hc } from "./fx.ts";
import { collect, adapterOf, ItemSchema, TerminalSchema, statusOf, splitAddress } from "./model.ts";
import type { Info, Item, Terminal } from "./model.ts";
import { HookPayloadSchema } from "./request.ts";
import type { HookRecord } from "./request.ts";
import { listEntries, readSharedList, readSharedMap, sharedListKey, sharedMapKey, writeSharedMap } from "./shared-lists.ts";

export const ITEMS = "notifications.items";
export const OPEN = "notifications.open"; // { terminal, at }: what the overview opens on
export const DISMISSED = "notifications.dismissed"; // { [item id]: true }: errors put away

/** The items, newest first within a type (model.ts collect), read entry by entry. */
export const ITEMS_KEY = sharedListKey(ITEMS, ItemSchema);

/** ITEMS, written whole. */
const ITEMS_LIST = sharedKey(ITEMS, Schema.Array(ItemSchema));

/** The request a toast asked the overview to open on: its terminal, and when. */
export const OPEN_KEY = sharedKey(OPEN, Schema.NullOr(Schema.Struct({ terminal: Schema.String, at: Schema.optionalKey(Schema.Finite) })));

/** The errors put away, by item id (each `true`). */
const DISMISSED_KEY = sharedMapKey(DISMISSED, Schema.Literal(true));

/** ITEMS and DISMISSED as they are, for an effect to read entry by entry. */
const ITEMS_RAW = sharedKey(ITEMS, Schema.Array(Schema.Unknown));

const DISMISSED_RAW = sharedKey(DISMISSED, Schema.Record(Schema.String, Schema.Unknown));

/** Two item lists hold the same items, field by field. */
const sameItems = Schema.toEquivalence(Schema.Array(ItemSchema));

/** The terminals as herdr-core lists them, the fields read here (one in another shape is left out). */
export const terminalsNow: Effect.Effect<readonly Terminal[], never, Workspace> = Effect.map(Workspace.use((w) => w.terminals), (list) => listEntries(list, TerminalSchema));

/** The name a person gave a terminal (Nocturne's rename label), by address. */
function givenNames(list: readonly Terminal[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>();

  for (const t of list) {
    const name = t.labels?.["nocturne.name"] ?? "";

    if (Str.isNonEmpty(name)) out.set(t.address, name);
  }

  return out;
}

/** The visible screen of a terminal; null when it can't be read (the caller says so: "Its terminal can't be read"). */
export const readScreen = (address: string): Effect.Effect<string | null> =>
  hc(["read", address, "--lines", "0"]).pipe(
    Effect.map((r) => (r.code === 0 ? r.stdout : null)),
    Effect.catchTag("ExecError", () => Effect.succeed(null)),
  );

// Hook records live where bin/claude-hook writes them, on the agent's machine;
// a machine whose hook is still Herdr's copy writes them under herdr-app.
const RECORDS = Arr.join([
  'd="${XDG_STATE_HOME:-$HOME/.local/state}"',
  'for id in "$@"; do',
  '  f="$d/fireflies/notify/$id.claude.json"',
  '  [ -f "$f" ] || f="$d/herdr-app/notify/$id.claude.json"',
  '  [ -f "$f" ] || continue',
  // GNU stat first: its -f is file-system status, printed over several lines (exit 1), which
  // would land in the header; BSD stat refuses -c with nothing on stdout.
  '  printf \'\\n@@record %s %s\\n\' "$id" "$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null)"',
  '  cat "$f"',
  'done',
], "\n");

const readPayload = decodeJsonOption(HookPayloadSchema);

/** The records in one machine's answer (RECORDS' output): id -> record; a half-written one is left for next time. */
export function parseRecords(stdout: string, machine: string | null): ReadonlyMap<string, HookRecord> {
  const out = new Map<string, HookRecord>();

  for (const part of Arr.drop(Str.split(stdout, "\n@@record "), 1)) {
    const nl = Option.getOrElse(Str.indexOf("\n")(part), () => part.length);
    const [id = "", at = ""] = Str.split(Str.slice(0, nl)(part), " ");

    Option.map(readPayload(Str.slice(nl + 1)(part)), (payload) => out.set(machine === null ? id : `${machine}/${id}`, { at: Number(at) * 1000, payload }));
  }

  return out;
}

/** Hook records by address for these terminals. A machine whose records can't be read gives none: its
 *  permissions still come from the screen, its questions show as the generic view, and the next poll asks again. */
export const readRecords = Effect.fnUntraced(function* (addresses: readonly string[]) {
  const byMachine = new Map<string | null, string[]>();

  for (const a of addresses) {
    const { machine, id } = splitAddress(a);

    if (/^[A-Za-z0-9_-]+$/.test(id)) byMachine.set(machine, [...(byMachine.get(machine) ?? []), id]);
  }

  const exec = yield* Exec;
  const out = new Map<string, HookRecord>();

  for (const [machine, ids] of byMachine) {
    const r = yield* exec.run("sh", ["-c", RECORDS, "sh", ...ids], { on: machine, timeout: 8000 }).pipe(
      Effect.map((x) => x.stdout),
      Effect.catchTag("ExecError", () => Effect.succeed("")),
    );

    for (const [k, v] of parseRecords(r, machine)) out.set(k, v);
  }

  return out;
});

/** What a terminal showed when last read, and when its status began. */
interface Read extends Info {
  readonly since: number;
  readonly read: number;
}

/** A terminal's status, the report's kind and words: a change of any begins a new item. */
const statusKey = (t: Terminal): string => `${statusOf(t) ?? ""}|${t.report?.kind ?? ""}|${t.report?.msg ?? ""}`;

export class Engine {
  info = new Map<string, Read>(); // address -> what it showed
  busy = false;
  seen = new Map<string, { readonly key: string; readonly at: number }>(); // address -> when this status (and request) began, as seen here

  /** When each terminal's current status began: its status_ms, unless this engine saw it change later. */
  since(list: readonly Terminal[], now: number): ReadonlyMap<string, number> {
    const out = new Map<string, number>();

    for (const t of list) {
      const key = statusKey(t);
      const had = this.seen.get(t.address);
      const ms = t.status_ms ?? 0;
      const seen = had === undefined ? { key, at: ms === 0 ? now : ms } : had.key === key ? had : { key, at: Math.max(ms, now) };

      this.seen.set(t.address, seen);
      out.set(t.address, seen.at);
    }

    for (const a of this.seen.keys()) if (!out.has(a)) this.seen.delete(a);

    return out;
  }

  /** Reads what changed: every waiting agent's screen, finished ones' once. True when the items changed;
   *  false at once while a read is still going (it reads everything anyway). */
  readonly refresh = Effect.suspend(() => {
    if (this.busy) return Effect.succeed(false);

    this.busy = true;

    return this.read.pipe(Effect.ensuring(Effect.sync(() => {
      this.busy = false;
    })));
  });

  private readonly read = Effect.gen({ self: this }, function* () {
    const all = yield* terminalsNow;
    const list = Arr.filter(all, (t) => t.state !== "finished");
    const waiting = Arr.filter(list, (t) => statusOf(t) === "blocked" || statusOf(t) === "error");
    const live = new Set(Arr.map(waiting, (t) => t.address));

    for (const a of this.info.keys()) if (!live.has(a)) this.info.delete(a);

    const start = yield* Clock.currentTimeMillis;
    const began = this.since(list, start);
    const blocked = Arr.filter(waiting, (t) => statusOf(t) === "blocked");
    const records = yield* readRecords(Arr.map(Arr.filter(blocked, (t) => adapterOf(t).hook), (t) => t.address));

    for (const t of waiting) {
      const since = began.get(t.address) ?? 0;
      const had = this.info.get(t.address);

      // Failed: read once for its last lines. Waiting: every time.
      if (statusOf(t) !== "blocked" && had?.since === since) continue;

      const screen = yield* readScreen(t.address);

      const read = yield* Clock.currentTimeMillis;

      this.info.set(t.address, { screen, record: records.get(t.address) ?? null, since, read });
    }

    return yield* this.publish(list);
  });

  /** Items into shared(ITEMS), when they changed. */
  publish(list: readonly Terminal[]): Effect.Effect<boolean, never, Shared> {
    return Effect.gen({ self: this }, function* () {
      const shared = yield* Shared;
      const put = yield* shared.get(DISMISSED_RAW);
      const had = yield* shared.get(ITEMS_RAW);
      const dismissed = new Set(Arr.map(Arr.filter(Rec.toEntries(Option.getOrElse(put, () => ({}))), ([, v]) => v === true), ([k]) => k));
      const before = listEntries(Option.getOrElse(had, () => []), ItemSchema);
      const places = yield* agents;
      const at = yield* Clock.currentTimeMillis;
      const now = collect({ terminals: list, agents: places, info: this.info, since: this.since(list, at), names: givenNames(list), dismissed });

      if (sameItems(before, now)) return false;

      yield* shared.set(ITEMS_LIST, now);

      return true;
    });
  }
}

/** The items as last published. */
export const items = (): readonly Item[] => readSharedList(shared, ITEMS_KEY);

/** How many put-away errors are kept (the newest). */
const KEEP_DISMISSED = 200;

/** Puts an error away (it isn't asking anything). */
export function dismiss(id: string): void {
  const d = new Map(readSharedMap(shared, DISMISSED_KEY));

  d.set(id, true);

  for (const k of Arr.take(Arr.fromIterable(d.keys()), Math.max(0, d.size - KEEP_DISMISSED))) d.delete(k);

  writeSharedMap(setShared, DISMISSED_KEY, d);
  writeShared(setShared, ITEMS_LIST, Arr.filter(items(), (i) => i.id !== id));
}

/** The toast's request for the overview, none when there is none. */
export const openRequest = (): Option.Option<{ readonly terminal: string; readonly at?: number }> =>
  Option.fromNullOr(readShared(shared, OPEN_KEY, null));
