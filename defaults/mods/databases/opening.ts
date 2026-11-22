// How the Databases view opens, moves and is told things (the pattern every
// window mod follows: aspane's): a window iff props.overlay, a pane with its
// slot; where it starts (a handover note from the copy it moved from, a
// pane's own kept place in localStorage, a connection another mod sent); the
// commands it takes (databases.connect:{…}, to-pane, to-window, focus, and any
// key's action by name); and the move itself (ctrl-t, the ◧ / ⧉ chip).

import type { Context } from "gpui-kit";
import { spaces, panes, focused, shared, setShared, run, openOverlay, closeOverlay } from "herdr";
import { parseJson, readShared, writeShared } from "./guard.ts";
import type { ConnectArgs, DbProps, Handover, KeptCopy } from "./state.ts";
import { HANDOVER_FRESH, HANDOVER_KEY, MOD, WINDOW_KEY, isConnectArgs, isKeptCopy } from "./state.ts";
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
  const space = spaces().find((s) => s.active) ?? null;
  const tab = space?.tabs.find((c) => c.active)?.id ?? null;
  const ps = panes();
  const pane = ps.find((p) => p.focused && p.tab === tab) ?? ps.find((p) => p.tab === tab && p.terminal !== null && p.cwd);
  const cwd = pane && pane.terminal !== null ? pane.cwd : null;

  return { folder: (space?.attached && space.folder) || cwd || focused()?.cwd || space?.folder || null, on: space?.machine ?? null };
}

/** The window's overlay spec (nocturne.databases opens the same). */
export function windowSpec(props: DbProps): Parameters<typeof openOverlay>[0] {
  return { mod: MOD, kind: "window", key: MOD, frame: "none", scrim: true, width: 0.88, height: 0.88, resizable: { min: [520, 360] }, props };
}

/** A pane's slot: unique, names the copy. */
export const newSlot = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** This copy's pane (a mod isn't told its pane: it finds itself by its slot). */
export function ownPane(v: DbView): string | null {
  if (!v.slot) return null;

  const slot = v.slot;

  return panes().find((p) => p.mod === MOD && isKeptSlot(p.props) && p.props.slot === slot)?.pane ?? null;
}

/** A pane's props that carry a slot. */
const isKeptSlot = (p: unknown): p is { readonly slot: string } => typeof p === "object" && p !== null && "slot" in p && typeof p.slot === "string";

/** Whether this copy acts on a command sent to every copy: the window when one is open, else the
 *  copy whose pane is focused. */
export function acts(v: DbView): boolean {
  if (v.overlay) return true;

  const w = readShared(shared, WINDOW_KEY, null);

  if (w && Date.now() - (w.beat ?? 0) < 10000) return false;

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

  if (v.active) out.conn = v.active.id;

  if (v.rows.browse) out.table = v.rows.browse.table.name;

  return out;
}

/** A pane keeps its place (localStorage is per mod and props: per slot); window and pane keep it
 *  as their space's too (lastview.ts), with a sent connection's request. */
export function keepCopy(v: DbView): void {
  const args = v.active?.origin === "sent" ? v.sentArgs.get(v.active.id) : undefined;
  const sent: { -readonly [K in keyof ConnectArgs]: ConnectArgs[K] } | undefined = args ? { ...args } : undefined;

  // A database picked on it since it was sent (dbs.ts) is where it's sent again.
  if (sent && v.active?.database !== undefined) sent.database = v.active.database;

  keepSpacePlace(v.space, sent ? { ...placeNow(v), sent } : placeNow(v));

  if (!v.slot) return;

  try {
    localStorage.setItem("copy", JSON.stringify(placeNow(v)));
  } catch {
    /* a full or missing storage: the place isn't kept */
  }
}

/** Where to start: the handover note (fresh, this folder), else a pane's own place, else where the
 *  view was last left in this space; then a sent connection. */
export async function start(v: DbView, pr: DbProps, cx: Context): Promise<void> {
  cx = v.held(cx);

  const note = readShared(shared, HANDOVER_KEY, null);
  const fresh = note && Date.now() - note.at < HANDOVER_FRESH && (note.folder ?? null) === v.folder ? note : null;
  let kept: KeptCopy | null = null;

  if (fresh) {
    writeShared(setShared, HANDOVER_KEY, null);
    kept = fresh;
  } else if (v.slot) {
    let text: string | null = null;

    try {
      text = localStorage.getItem("copy");
    } catch {
      text = null;
    }

    kept = text ? parseJson(text, isKeptCopy) ?? null : null;
  }

  kept ??= spacePlace(v.space);

  if (pr.connect) {
    receive(v, pr.connect, cx);

    return;
  }

  restore(v, kept, cx);
}

/** Back where a copy was: its connection (connected again: reads only; a sent one sent again), its
 *  panel and table. A connection that doesn't come up leaves the list shown with why. One found in
 *  the folder (discover.ts) isn't listed yet: tried again once it may be (restoreFound). */
function restore(v: DbView, kept: KeptCopy | SpacePlace | null, cx: Context): void {
  cx = v.held(cx);

  const sent = kept && "sent" in kept ? kept.sent : undefined;
  const c = (kept?.conn ? connList(v).find((x) => x.id === kept.conn) : undefined) ?? (sent ? receive(v, sent, cx, false) ?? undefined : undefined);

  if (kept?.conn && !c) v.lateKept = kept;

  if (!kept || !c) return;

  const table = kept.table;

  void connect(v, c, cx).then(() => {
    const failed = v.active?.id !== c.id ? "" : v.catalog.error;

    if (failed !== null) {
      v.panel = "conns";

      if (failed) v.say(`couldn't connect to ${c.name} again: ${failed}`, "failed");
      cx.notify();

      return;
    }

    if (table) openNamed(v, table, cx);

    v.panel = kept.panel ?? "tables";
    v.mainTab = kept.query ?? 0;
    keepCopy(v);
    cx.notify();
  });
  v.connAt = Math.max(0, connList(v).indexOf(c));
}

/** The kept place whose connection the folder's discovery may have listed since. */
export function restoreFound(v: DbView, cx: Context): void {
  const kept = v.lateKept;

  v.lateKept = null;

  if (kept && v.active === null) restore(v, kept, cx);
}

/** A command from keys.json, `herdr-app do`, nocturne or another mod. */
export function command(v: DbView, c: string, cx: Context): void {
  const name = c.replace(/^databases\./, "");

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

  if (press) {
    if (ask) askActions(v, ask).find((x) => x.key === press)?.go(cx);

    return;
  }

  // What esc does to a read going on (the tables, a secret, the folder's environment).
  if (name === "stop") {
    if (stopReads(v)) v.say("stopped", "done");

    return;
  }

  if (name.startsWith("connect:")) {
    const args = parseJson(name.slice("connect:".length), isConnectArgs);

    if (args) receive(v, args, cx);
    else v.say("databases.connect: its argument isn't a connection", "failed");
  } else if (name.startsWith("sql:")) v.addQuery(name.slice("sql:".length), cx);
  else if (name === "run" || name === "run-all") runShown(v, name === "run-all", cx);
  else if (name.startsWith("table:")) openNamed(v, name.slice("table:".length), cx);
  else if (name.startsWith("set:")) setCell(v, name.slice("set:".length));
  else if (name === "to-pane" && v.overlay) handoverOut(v, cx);
  else if (name === "to-window" && !v.overlay) handoverOut(v, cx);
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

  if (!v.review?.busy) v.review = null;

  v.focusShown();
}

/** Runs the shown query tab (databases.run, run-all): the statement under its caret, or every one. */
function runShown(v: DbView, all: boolean, cx: Context): void {
  const q = v.shownQuery() ?? v.queries.at(-1);

  if (!q) return;

  v.mainTab = v.queries.indexOf(q) + 1;
  v.panel = "main";
  runQuery(v, q, all, cx);
}

/** Opens a table by name (databases.table:<name> or <schema>.<name>) on the connection. */
function openNamed(v: DbView, name: string, cx: Context): void {
  const [a, b] = name.includes(".") ? name.split(".", 2) : [null, name];
  const t = v.catalog.tables.find((x) => x.name === b && (a === null || x.schema === a));

  if (!t) {
    v.say(v.active ? `no table ${name} on ${v.active.name}` : "connect first", "failed");

    return;
  }

  // The cursor on its row in [2] as drawn (its tab; a schema or a find that hides it goes), so
  // enter opens the table that's open, not the one at its index in the whole catalog.
  v.panel = "tables";
  v.tablesTab = t.type === "view" ? "views" : "tables";

  if (!shownTables(v).includes(t)) {
    v.schema = null;
    v.tableFind = null;
    v.findTyping = false;
  }

  v.tableAt = Math.max(0, shownTables(v).indexOf(t));
  openTable(v, t, cx);
}

/** Moves to a pane (from the window) or a window (from a pane): the place handed over, the new copy
 *  opened, this one closed a moment later (closed at once, the new copy's first tasks go with it). */
export function handoverOut(v: DbView, cx: Context): void {
  const h: Handover = { at: Date.now(), folder: v.folder, ...placeNow(v) };

  writeShared(setShared, HANDOVER_KEY, h);

  if (v.overlay) {
    const pane = focused()?.pane ?? null;
    const args: SplitArgs = { direction: "auto", mod: MOD, props: { slot: newSlot(), folder: v.folder, on: v.on } };

    if (pane) args.pane = pane;

    run("pane.split", args);
    cx.timer.after(300, () => v.closeWindow());

    return;
  }

  const open = readShared(shared, WINDOW_KEY, null);

  if (open && Date.now() - (open.beat ?? 0) < 10000) closeOverlay(open.id);

  openOverlay(windowSpec({ folder: v.folder, on: v.on }));

  const own = ownPane(v);

  if (own) cx.timer.after(300, () => run("pane.close", { pane: own }));
}
