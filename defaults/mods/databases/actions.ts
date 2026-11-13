// What the Databases window's actions do (keys.ts names them): the window's
// own (panels, history, read again, move, close, keys) and the lists' (the
// connections, the tables, the structure, the log). The grids' are
// act-grid.ts's. act() takes a key's name or an action's own name (a
// databases.<action> command) and says whether it did something.

import type { Context } from "gpui-kit";
import { InputState } from "gpui-base";
import { run } from "herdr";
import type { Binding, Place } from "./keys.ts";
import { BINDINGS, actionFor } from "./keys.ts";
import { PANELS, STRUCT_TABS, TABLES_TABS } from "./state.ts";
import type { PanelId } from "./state.ts";
import { connAtCursor, connList, connect, discover, saveFound, test } from "./conns.ts";
import { browse, loadRows, loadStructure } from "./session.ts";
import { insertAtCaret } from "./query.ts";
import { gridAct } from "./act-grid.ts";
import { connMenu, historyMenu, structMenu, tableMenu, confirmRemove } from "./menus.ts";
import { openForm } from "./conn-form.ts";
import { openExport } from "./export-form.ts";
import { keepCopy, ownPane } from "./opening.ts";
import { quoteName, qualified } from "./catalog.ts";
import { schemasOf, shownTables, structRows } from "./panels.ts";
import { edgesOf } from "./layout.ts";
import type { default as DbView } from "./main.ts";

/** Whether `name` is an action of the place's or the window's table (a command by name). */
const isAction = (place: Place, name: string): boolean => [...BINDINGS[place], ...BINDINGS.window].some((b: Binding) => b[2] === name);

/** Does what a key (or an action's name) asks in a place; false when it means nothing there. */
export function act(v: DbView, place: Place, key: string, cx: Context): boolean {
  const action = actionFor(place, key) ?? (isAction(place, key) ? key : null);

  if (key === "escape" && !action) return escape(v);

  if (!action) return false;

  if (windowAct(v, action, cx)) return true;

  switch (place) {
    case "conns": return connAct(v, action, cx);
    case "tables": return tableAct(v, action, cx);
    case "structure": return structAct(v, action, cx);
    case "log": return logAct(v, action, cx);
    case "rows":
    case "results": return gridAct(v, place, action, cx);
    case "editor":
    case "window": return false;
  }
}

/** esc at the top: a window closes; a pane stays (its own × and cmd-w close it). */
function escape(v: DbView): boolean {
  if (!v.overlay) return false;

  v.closeWindow();

  return true;
}

/** Gives a panel the keyboard. */
export function setPanel(v: DbView, p: PanelId): void {
  v.panel = p;
  v.help = false;
  keepCopy(v);
  v.focusShown();
}

/** The window's own actions. */
function windowAct(v: DbView, action: string, cx: Context): boolean {
  const panel = /^panel-(conns|tables|structure|main|log)$/.exec(action)?.[1];
  const found = PANELS.find((p) => p === panel);

  if (found) setPanel(v, found);
  else if (action === "panel-next" || action === "panel-prev") {
    const i = PANELS.indexOf(v.panel) + (action === "panel-next" ? 1 : PANELS.length - 1);

    setPanel(v, PANELS[i % PANELS.length] ?? "conns");
  } else if (action === "query-new") v.addQuery("", cx);
  else if (action === "history") historyMenu(v, cx);
  else if (action === "refresh") refresh(v, cx);
  else if (action === "move") v.move(cx);
  else if (action === "help") v.help = !v.help;
  else if (action === "close") closeCopy(v);
  else if (action === "grow" || action === "shrink") resize(v, action === "grow" ? 1 : -1);
  else return false;

  return true;
}

/** + / -: the focused panel's edges move out or in (layout.ts edgesOf). */
function resize(v: DbView, dir: 1 | -1): void {
  const ds = v.dividers;
  const edges = edgesOf(v.place(), v.room(), (d) => ds.size(d));

  if (!edges.length) v.say("nothing to resize here: one panel shows", "failed");
  else if (!ds.stepAll(edges, dir)) v.say(dir > 0 ? "it's as big as it gets" : "it's as small as it gets", "done");
}

/** q: a window closes; a pane closes too (q already means close here). */
function closeCopy(v: DbView): void {
  if (v.overlay) {
    v.closeWindow();

    return;
  }

  const own = ownPane(v);

  if (own) run("pane.close", { pane: own });
}

/** Reads everything shown again: the folder's connections, the tables, the structure, the page. */
export function refresh(v: DbView, cx: Context): void {
  void discover(v, cx);

  if (!v.active) return;

  v.refreshCatalog(cx);

  if (v.struct.table) void loadStructure(v, v.struct.table, cx);

  if (v.rows.browse) void loadRows(v, cx, true);
}

/** A list's cursor moved by `by`, kept inside `n` rows. */
const step = (at: number, by: number, n: number): number => Math.max(0, Math.min(Math.max(0, n - 1), at + by));

function connAct(v: DbView, action: string, cx: Context): boolean {
  const c = connAtCursor(v);
  const n = connList(v).length;

  switch (action) {
    case "down": v.connAt = step(v.connAt, 1, n); break;
    case "up": v.connAt = step(v.connAt, -1, n); break;
    case "connect": if (c) void connect(v, c, cx); break;
    case "conn-new": openForm(v, null, cx); break;
    case "conn-edit": if (c) openForm(v, c, cx); break;
    case "conn-remove": if (c) confirmRemove(v, c, cx); break;
    case "conn-save": if (c) void saveFound(v, c, cx); break;
    case "conn-test": if (c) void test(v, c, cx); break;
    case "menu": if (c) connMenu(v, c, cx); break;
    default: return false;
  }

  return true;
}

/** The query tab names go into: the shown one, else a new one. */
function targetQuery(v: DbView, cx: Context) {
  return v.shownQuery() ?? v.queries[0] ?? v.addQuery("", cx);
}

/** Puts a name into the query at its caret and shows the query. */
export function insertName(v: DbView, name: string, cx: Context): void {
  const q = targetQuery(v, cx);

  insertAtCaret(q, name);
  v.mainTab = v.queries.indexOf(q) + 1;
  v.panel = "main";
  q.inResults = false;
  q.editor.focus();
}

/** A table's name for a statement (quoted where it must be). */
const tableSql = (v: DbView, schema: string | null, name: string): string => (v.active ? qualified(v.active.kind, { schema, name }) : name);

function tableAct(v: DbView, action: string, cx: Context): boolean {
  if (v.tablesTab === "schemas") return schemaAct(v, action, cx);

  const list = shownTables(v);
  const t = list[v.tableAt];

  switch (action) {
    case "down": v.tableAt = step(v.tableAt, 1, list.length); break;
    case "up": v.tableAt = step(v.tableAt, -1, list.length); break;
    case "subtab-next":
    case "subtab-prev": v.tablesTab = TABLES_TABS[(TABLES_TABS.indexOf(v.tablesTab) + (action === "subtab-next" ? 1 : 2)) % 3] ?? "tables"; v.tableAt = 0; break;
    case "open": if (t) openTable(v, t, cx); break;
    case "table-query": if (t) v.addQuery(`select * from ${tableSql(v, t.schema, t.name)} limit 100;`, cx); break;
    case "insert": if (t) insertName(v, tableSql(v, t.schema, t.name), cx); break;
    case "copy": if (t) cx.write_to_clipboard(t.name); break;
    case "export": if (t) openExport(v, { table: t }, cx); break;
    case "menu": if (t) tableMenu(v, t, cx); break;
    case "table-find": v.tableFind = v.tableFind ?? InputState.new({ placeholder: "a table's name" }); v.tableFind.focus(); break;
    default: return false;
  }

  return true;
}

/** Shows a table: its rows in the main view, its structure in [3]. */
export function openTable(v: DbView, t: Parameters<typeof browse>[1], cx: Context): void {
  browse(v, t, cx);
  void loadStructure(v, t, cx);
  v.mainTab = 0;
  v.structAt = 0;
  keepCopy(v);
}

function schemaAct(v: DbView, action: string, cx: Context): boolean {
  const list = schemasOf(v);

  switch (action) {
    case "down": v.tableAt = step(v.tableAt, 1, list.length + 1); break;
    case "up": v.tableAt = step(v.tableAt, -1, list.length + 1); break;
    case "subtab-next":
    case "subtab-prev": v.tablesTab = action === "subtab-next" ? "tables" : "views"; v.tableAt = 0; break;
    // The first row is "every schema".
    case "open": v.schema = v.tableAt === 0 ? null : list[v.tableAt - 1] ?? null; v.tablesTab = "tables"; v.tableAt = 0; break;
    case "insert": if (v.tableAt > 0 && v.active) insertName(v, quoteName(v.active.kind, list[v.tableAt - 1] ?? ""), cx); break;
    default: return false;
  }

  return true;
}

function structAct(v: DbView, action: string, cx: Context): boolean {
  const rows = structRows(v);
  const r = rows[v.structAt];

  switch (action) {
    case "down": v.structAt = step(v.structAt, 1, rows.length); break;
    case "up": v.structAt = step(v.structAt, -1, rows.length); break;
    case "subtab-next":
    case "subtab-prev": v.structTab = STRUCT_TABS[(STRUCT_TABS.indexOf(v.structTab) + (action === "subtab-next" ? 1 : 3)) % 4] ?? "columns"; v.structAt = 0; break;
    case "open": if (r) structOpen(v, r, cx); break;
    case "insert": if (r?.name && v.active) insertName(v, quoteName(v.active.kind, r.name), cx); break;
    case "copy": if (r) cx.write_to_clipboard(r.copy); break;
    case "menu": if (r) structMenu(v, r, cx); break;
    default: return false;
  }

  return true;
}

/** enter on a structure row: a key's other table opens; a column's name goes into the query. */
function structOpen(v: DbView, r: ReturnType<typeof structRows>[number], cx: Context): void {
  const other = r.table ? v.catalog.tables.find((t) => t.name === r.table) : undefined;

  if (other) openTable(v, other, cx);
  else if (r.name && v.active) insertName(v, quoteName(v.active.kind, r.name), cx);
}

function logAct(v: DbView, action: string, cx: Context): boolean {
  const line = v.log[v.logAt];

  switch (action) {
    case "down": v.logAt = step(v.logAt, 1, v.log.length); break;
    case "up": v.logAt = step(v.logAt, -1, v.log.length); break;
    case "open": if (line) v.addQuery(`${line.sql};`, cx); break;
    case "copy": if (line) cx.write_to_clipboard(line.sql); break;
    default: return false;
  }

  return true;
}
