// How the Databases view opens, moves and is told things (the pattern every
// window mod follows: aspane's): a window iff props.overlay, a pane with its
// slot; where it starts (a handover note from the copy it moved from, a
// pane's own kept place in localStorage, a connection another mod sent); the
// commands it takes (databases.connect:{…}, to-pane, to-window, focus, and any
// key's action by name); and the move itself (ctrl-t, the ◧ / ⧉ chip).

import type { Context } from "gpui-kit";
import { spaces, panes, focused, shared, setShared, run, openOverlay, closeOverlay } from "herdr";
import { Array as Arr, Clock, Effect, Option, Random, Schema, String as Str } from "effect";
import { Commands, decodeJsonOption, readShared, writeShared } from "@fireflies/kit";
import type { ConnectArgs, DbProps, Handover, KeptCopy } from "./state.ts";
import { ConnectArgsSchema, HANDOVER_FRESH, HANDOVER_KEY, KeptCopySchema, MOD, WINDOW_KEY } from "./state.ts";
import { nowMs, runtime } from "./app.ts";
import type { DbRun } from "./app.ts";

const connectArgsOf = decodeJsonOption(ConnectArgsSchema);
const keptCopyOf = decodeJsonOption(KeptCopySchema);
const copyText = Schema.encodeOption(Schema.fromJsonString(KeptCopySchema));

/** The copy's kept place (none when there is no storage). */
const readCopy = Option.liftThrowable(() => localStorage.getItem("copy"));

import { connList, connect, receive } from "./conns.ts";
import { act, openTable } from "./actions.ts";
import { shownTables } from "./panels.ts";
import { runQuery } from "./query.ts";
import { setCell } from "./cell-edit.ts";
import { stopReads } from "./reads.ts";
import { askActions } from "./forward-view.ts";
import type { default as DbView } from "./main.ts";
import type { SpacePlace } from "./lastview.ts";
import { keepSpacePlace, spacePlace } from "./lastview.ts";

/** A folder and the machine it's on. */
export interface Place {
  readonly folder: string | null;
  readonly on: string | null;
}

/** The shown space's folder and machine (an attached folder first, then the focused pane's). */
export function here(): Place {
  const space = Option.getOrUndefined(Arr.findFirst(spaces(), (s) => s.active)) ?? null;
  const tab = Option.getOrUndefined(Arr.findFirst(space?.tabs ?? [], (c) => c.active))?.id ?? null;
  const ps = panes();
  const pane = Option.getOrUndefined(Arr.findFirst(ps, (p) => p.focused && p.tab === tab)) ?? Option.getOrUndefined(Arr.findFirst(ps, (p) => p.tab === tab && p.terminal !== null && p.cwd !== null && Str.isNonEmpty(p.cwd)));
  const cwd = pane !== undefined && pane.terminal !== null ? pane.cwd : null;

  return { folder: (space?.attached && space.folder) || cwd || focused()?.cwd || space?.folder || null, on: space?.machine ?? null };
}

/** The window's overlay spec (nocturne.databases opens the same). */
export function windowSpec(props: DbProps): Parameters<typeof openOverlay>[0] {
  return { mod: MOD, kind: "window", key: MOD, frame: "none", scrim: true, width: 0.88, height: 0.88, resizable: { min: [520, 360] }, props };
}

/** A pane's slot: unique, names the copy. */
export const newSlot = (): string => nowMs().toString(36) + Str.padStart(4, "0")(runtime.now(Random.nextIntBetween(0, 36 ** 4)).toString(36));

/** This copy's pane (a mod isn't told its pane: it finds itself by its slot). */
export function ownPane(v: DbView): string | null {
  if (v.slot === null || Str.isEmpty(v.slot)) return null;

  const slot = v.slot;

  return Option.getOrUndefined(Arr.findFirst(panes(), (p) => p.mod === MOD && isKeptSlot(p.props) && p.props.slot === slot))?.pane ?? null;
}

/** A pane's props that carry a slot. */
const isKeptSlot = (p: unknown): p is { readonly slot: string } => typeof p === "object" && p !== null && "slot" in p && typeof p.slot === "string";

/** Whether this copy acts on a command sent to every copy: the window when one is open, else the
 *  copy whose pane is focused. */
export function acts(v: DbView): boolean {
  if (v.overlay !== null && Str.isNonEmpty(v.overlay)) return true;

  const w = readShared(shared, WINDOW_KEY, null);

  if (w !== null && nowMs() - (w.beat ?? 0) < 10000) return false;

  const own = ownPane(v);

  return own !== null && focused()?.pane === own;
}

/** A kept place put together field by field. */
type KeptDraft = { -readonly [K in keyof KeptCopy]: KeptCopy[K] };

/** pane.split's arguments for this mod. */
type SplitArgs = {
  direction: string;
  mod: string;
  props: DbProps;
  pane?: string;
};

/** Where this copy was, for a handover or a pane's localStorage. */
function placeNow(v: DbView): KeptCopy {
  const out: KeptDraft = { panel: v.panel, query: v.mainTab };

  if (v.active !== null) out.conn = v.active.id;

  if (v.rows.browse !== null) out.table = v.rows.browse.table.name;

  return out;
}

/** A pane keeps its place (localStorage is per mod and props: per slot); window and pane keep it
 *  as their space's too (lastview.ts), with a sent connection's request. */
export function keepCopy(v: DbView): void {
  const args = v.active?.origin === "sent" ? v.sentArgs.get(v.active.id) : undefined;
  const sent: { -readonly [K in keyof ConnectArgs]: ConnectArgs[K] } | undefined = args !== undefined ? { ...args } : undefined;

  // A database picked on it since it was sent (dbs.ts) is where it's sent again.
  if (sent !== undefined && v.active?.database !== undefined) sent.database = v.active.database;

  keepSpacePlace(v.space, sent !== undefined ? { ...placeNow(v), sent } : placeNow(v));

  if (v.slot === null || Str.isEmpty(v.slot)) return;

  try {
    Option.map(copyText(placeNow(v)), (text) => localStorage.setItem("copy", text));
  } catch {
    /* a full or missing storage: the place isn't kept */
  }
}

/** Where to start: the handover note (fresh, this folder), else a pane's own place, else where the
 *  view was last left in this space; then a sent connection. */
export const start = (v: DbView, pr: DbProps): Effect.Effect<void, never, DbRun> => Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const note = readShared(shared, HANDOVER_KEY, null);
  const fresh = note !== null && now - note.at < HANDOVER_FRESH && (note.folder ?? null) === v.folder ? note : null;
  let kept: KeptCopy | null = null;

  if (fresh !== null) {
    writeShared(setShared, HANDOVER_KEY, null);
    kept = fresh;
  } else if (v.slot !== null && Str.isNonEmpty(v.slot)) {
    // A missing storage: no place kept.
    const text = Option.getOrNull(Option.flatMap(readCopy(), Option.fromNullOr));

    kept = text !== null && Str.isNonEmpty(text) ? Option.getOrNull(keptCopyOf(text)) : null;
  }

  kept ??= spacePlace(v.space);

  if (pr.connect !== undefined) {
    receive(v, pr.connect);

    return;
  }

  restore(v, kept);
});

/** Back where a copy was: its connection (connected again: reads only; a sent one sent again), its
 *  panel and table. A connection that doesn't come up leaves the list shown with why. One found in
 *  the folder (discover.ts) isn't listed yet: tried again once it may be (restoreFound). */
function restore(v: DbView, kept: KeptCopy | SpacePlace | null): void {
  const sent = kept !== null && "sent" in kept ? kept.sent : undefined;
  const named = kept?.conn !== undefined && Str.isNonEmpty(kept.conn) ? kept.conn : null;
  const c = (named !== null ? Option.getOrUndefined(Arr.findFirst(connList(v), (x) => x.id === named)) : undefined) ?? (sent !== undefined ? receive(v, sent, false) ?? undefined : undefined);

  if (named !== null && c === undefined) v.lateKept = kept;

  if (kept === null || c === undefined) return;

  const table = kept.table;

  v.run(Effect.andThen(connect(v, c), Effect.sync(() => {
    const failed = v.active?.id !== c.id ? "" : v.catalog.error;

    if (failed !== null) {
      v.panel = "conns";

      if (Str.isNonEmpty(failed)) v.say(`couldn't connect to ${c.name} again: ${failed}`, "failed");

      return;
    }

    if (table !== undefined && Str.isNonEmpty(table)) openNamed(v, table);

    v.panel = kept.panel ?? "tables";
    v.mainTab = kept.query ?? 0;
    keepCopy(v);
  })));
  v.connAt = Math.max(0, connList(v).indexOf(c));
}

/** The kept place whose connection the folder's discovery may have listed since. */
export function restoreFound(v: DbView): void {
  const kept = v.lateKept;

  v.lateKept = null;

  if (kept !== null && v.active === null) restore(v, kept);
}

/** A command from keys.json, `herdr-app do`, nocturne or another mod. */
export function command(v: DbView, c: string, cx: Context): void {
  const name = Str.replace(/^databases\./, "")(c);

  if (name === "focus") {
    v.focusShown();

    return;
  }

  if (!acts(v)) return;

  if (name === "cancel") {
    dismiss(v);

    return;
  }

  // The forward's ask: its buttons by name (enter, c, k).
  const ask = v.forwardAsk;
  const press = { "forward-start": "enter", "forward-anyway": "c", "forward-k8s": "k" }[name];

  if (press !== undefined && Str.isNonEmpty(press)) {
    if (ask !== null) Option.getOrUndefined(Arr.findFirst(askActions(v, ask), (x) => x.key === press))?.go(cx);

    return;
  }

  // What esc does to a read going on (the tables, a secret, the folder's environment).
  if (name === "stop") {
    if (stopReads(v)) v.say("stopped", "done");

    return;
  }

  if (Str.startsWith("connect:")(name)) {
    const args = connectArgsOf(Str.slice("connect:".length)(name));

    if (Option.isSome(args)) receive(v, args.value);
    else v.say("databases.connect: its argument isn't a connection", "failed");
  } else if (Str.startsWith("sql:")(name)) v.addQuery(Str.slice("sql:".length)(name));
  else if (name === "run" || name === "run-all") runShown(v, name === "run-all");
  else if (Str.startsWith("table:")(name)) openNamed(v, Str.slice("table:".length)(name));
  else if (Str.startsWith("set:")(name)) setCell(v, Str.slice("set:".length)(name));
  else if (name === "to-pane" && (v.overlay !== null && Str.isNonEmpty(v.overlay))) handoverOut(v);
  else if (name === "to-window" && (v.overlay === null || Str.isEmpty(v.overlay))) handoverOut(v);
  // A command is no keystroke: in a query tab it reaches the results' actions, not the editor.
  else act(v, v.place() === "editor" ? "results" : v.place(), name, cx);
}

/** databases.cancel: whatever is over the view goes (an ask, a menu, a form, the keys). */
function dismiss(v: DbView): void {
  v.ask = null;
  v.menu = null;
  v.password = null;
  v.form = null;
  v.exporting = null;
  v.help = false;
  v.cellEdit = null;
  v.rename = null;
  v.press = null;

  if (v.review?.busy !== true) v.review = null;

  v.focusShown();
}

/** Runs the shown query tab (databases.run, run-all): the statement under its caret, or every one. */
function runShown(v: DbView, all: boolean): void {
  const q = v.shownQuery() ?? v.queries.at(-1);

  if (q === undefined) return;

  v.mainTab = v.queries.indexOf(q) + 1;
  v.panel = "main";
  runQuery(v, q, all);
}

/** Opens a table by name (databases.table:<name> or <schema>.<name>) on the connection. */
function openNamed(v: DbView, name: string): void {
  const [a, b] = Str.includes(".")(name) ? Str.split(name, ".") : [null, name];
  const t = Option.getOrUndefined(Arr.findFirst(v.catalog.tables, (x) => x.name === b && (a === null || x.schema === a)));

  if (t === undefined) {
    v.say(v.active !== null ? `no table ${name} on ${v.active.name}` : "connect first", "failed");

    return;
  }

  // The cursor on its row in [2] as drawn (its tab; a schema or a find that hides it goes), so
  // enter opens the table that's open, not the one at its index in the whole catalog.
  v.panel = "tables";
  v.tablesTab = t.type === "view" ? "views" : "tables";

  if (!Arr.contains(shownTables(v), t)) {
    v.schema = null;
    v.tableFind = null;
    v.findTyping = false;
  }

  v.tableAt = Math.max(0, shownTables(v).indexOf(t));
  openTable(v, t);
}

/** Moves to a pane (from the window) or a window (from a pane): the place handed over, the new copy
 *  opened, this one closed a moment later (closed at once, the new copy's first tasks go with it). */
export function handoverOut(v: DbView): void {
  const now = nowMs();
  const h: Handover = { at: now, folder: v.folder, ...placeNow(v) };

  writeShared(setShared, HANDOVER_KEY, h);

  if (v.overlay !== null && Str.isNonEmpty(v.overlay)) {
    const pane = focused()?.pane ?? null;
    const args: SplitArgs = { direction: "auto", mod: MOD, props: { slot: newSlot(), folder: v.folder, on: v.on } };

    if (pane !== null && Str.isNonEmpty(pane)) args.pane = pane;

    run("pane.split", args);
    v.run(Effect.andThen(Effect.sleep(300), Effect.sync(() => v.closeWindow())));

    return;
  }

  const open = readShared(shared, WINDOW_KEY, null);

  if (open !== null && now - (open.beat ?? 0) < 10000) closeOverlay(open.id);

  openOverlay(windowSpec({ folder: v.folder, on: v.on }));

  const own = ownPane(v);

  if (own !== null && Str.isNonEmpty(own)) v.run(Effect.andThen(Effect.sleep(300), Commands.use((x) => x.run("pane.close", { pane: own }))));
}
