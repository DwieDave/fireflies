// What the Databases window's actions do (keys.ts names them): the window's
// own (panels, history, read again, move, close, keys) and the lists' (the
// connections, the tables, the structure, the log). The grids' are
// act-grid.ts's. act() takes a key's name or an action's own name (a
// databases.<action> command) and says whether it did something.

import type { Context } from "gpui-kit";
import { InputState } from "gpui-base";
import { home, run } from "herdr";
import type { Binding, Place } from "./keys.ts";
import { BINDINGS, actionsFor } from "./keys.ts";
import { PANELS, STRUCT_TABS, TABLES_TABS, gridStart } from "./state.ts";
import type { PanelId } from "./state.ts";
import type { Conn, ConnDraft } from "./kinds.ts";
import { DEFAULT_PORT, onFile, tilde } from "./kinds.ts";
import { connAtCursor, connList, connect, discover, saveFound, test } from "./conns.ts";
import { writeConnections } from "./store.ts";
import { IO, browse, dataHome, loadRows, loadStructure } from "./session.ts";
import { insertAtCaret } from "./query.ts";
import { saveQueries } from "./queries.ts";
import { copy, gridAct } from "./act-grid.ts";
import { connMenu, historyMenu, logMenu, schemaMenu, structMenu, tableMenu, confirmRemove } from "./menus.ts";
import { openForm } from "./conn-form.ts";
import { openExport } from "./export-form.ts";
import { keepCopy, ownPane } from "./opening.ts";
import { quoteName, qualified } from "./catalog.ts";
import { schemasOf, shownTables, structRows } from "./panels.ts";
import { edgesOf } from "./layout.ts";
import { counted } from "./edits.ts";
import { beforeLeaving, discardAll, openReview, runSave } from "./cell-edit.ts";
import type { default as DbView } from "./main.ts";

/** Whether `name` is an action of the place's or the window's table (a command by name). */
const isAction = (place: Place, name: string): boolean => [...BINDINGS[place], ...BINDINGS.window].some((b: Binding) => b[2] === name);

/** Does what a key (or an action's name) asks in a place; false when it means nothing there. */
export function act(v: DbView, place: Place, key: string, cx: Context): boolean {
  const bound = actionsFor(place, key);
  const actions = bound.length ? bound : isAction(place, key) ? [key] : [];

  // A key may mean more than one thing here (esc: drop the selection, else …): the first that acts.
  for (const action of actions) if (windowAct(v, action, cx) || placeAct(v, place, action, cx)) return true;

  return key === "escape" ? escape(v) : false;
}

/** An action of a place's own. */
function placeAct(v: DbView, place: Place, action: string, cx: Context): boolean {
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
  // databases.save with the review open runs it (a command doesn't reach the review's y).
  else if (action === "save") {
    if (v.review) runSave(v, cx);
    else openReview(v);
  }
  else if (action === "discard") discardAll(v);
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

  if (own) beforeLeaving(v, "close", () => run("pane.close", { pane: own }));
}

/** Reads everything shown again: the folder's connections, the tables, the structure, the page. */
export function refresh(v: DbView, cx: Context): void {
  if (counted(v.edits).cells) {
    beforeLeaving(v, "read it again", () => refresh(v, cx));

    return;
  }

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
    case "conn-duplicate": if (c) duplicateConn(v, c, cx); break;
    case "disconnect": if (!v.active) v.say("nothing is connected", "failed"); else disconnect(v); break;
    case "copy": if (c) copy(v, addressOf(c), cx); break;
    case "conn-down":
    case "conn-up": if (c) moveConn(v, c, action === "conn-down" ? 1 : -1, cx); break;
    case "menu": if (c) connMenu(v, c, cx); break;
    default: return false;
  }

  return true;
}

/** Where a connection is, as a URL a client takes, never a password (a file: its path). */
export function addressOf(c: Conn): string {
  if (c.kind === "libsql" && c.url) return c.url;

  if (onFile(c)) return tilde(c.path ?? "", home());

  const scheme = c.kind === "postgres" ? "postgresql" : "mysql";
  const port = c.port && c.port !== DEFAULT_PORT[c.kind] ? `:${c.port}` : "";

  return `${scheme}://${c.user ? `${encodeURIComponent(c.user)}@` : ""}${c.host || "localhost"}${port}${c.database ? `/${encodeURIComponent(c.database)}` : ""}`;
}

/** A new connection's form with a connection's fields (not its password: nothing secret is copied). */
export function duplicateConn(v: DbView, c: Conn, cx: Context): void {
  const { source, ...rest } = c;
  const draft: ConnDraft = { ...rest, id: `copy:${c.id}`, name: `${c.name} copy`, origin: "found", secret: c.secret === "ask" ? "ask" : "none" };

  // A cluster's secret is where the password lives, not the password: the copy reads it too.
  if (c.secret === "kubernetes" && source) {
    draft.secret = "kubernetes";
    draft.source = source;
  }

  openForm(v, draft, cx);
}

/** Closes the connection: its tables, structure and rows go (changes not saved are asked about
 *  first); the query tabs stay, they're the connection's and are kept. */
export function disconnect(v: DbView): void {
  const c = v.active;

  if (!c) return;

  if (counted(v.edits).cells) {
    beforeLeaving(v, `disconnect from ${c.name}`, () => disconnect(v));

    return;
  }

  void saveQueries(v);
  v.active = null;
  v.catalog = { tables: [], error: null, busy: false };
  v.struct = { table: null, data: null, busy: false, error: null };
  v.rows = { browse: null, set: null, total: null, error: null, busy: false, at: gridStart(), filtering: false };
  v.edits = null;
  v.cellEdit = null;
  v.columnsAt = null;
  v.history = [];
  v.mainTab = 0;
  v.say(`disconnected from ${c.name}`, "done");
  keepCopy(v);
}

/** A saved connection moved `by` places among the saved ones (J / K, a drag), kept. */
export function moveConn(v: DbView, c: Conn, by: number, cx: Context): void {
  const i = v.saved.findIndex((s) => s.id === c.id);

  if (i < 0) {
    v.say("only saved connections keep an order (s saves it)", "failed");

    return;
  }

  placeConn(v, c, Math.max(0, Math.min(v.saved.length - 1, i + by)), cx);
}

/** A saved connection put at place `to` among the saved ones, kept; the cursor goes with it. */
export function placeConn(v: DbView, c: Conn, to: number, cx: Context): void {
  const i = v.saved.findIndex((s) => s.id === c.id);

  if (i < 0 || i === to) return;

  const list = v.saved.filter((s) => s.id !== c.id);

  list.splice(to, 0, c);
  v.saved = list;
  v.connAt = to;
  void writeConnections(IO, dataHome(), list).then(() => cx.notify());
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
    case "copy": if (t) copy(v, t.name, cx); break;
    case "export": if (t) openExport(v, { table: t }, cx); break;
    case "menu": if (t) tableMenu(v, t, cx); break;
    case "table-find": openFind(v); break;
    default: return false;
  }

  return true;
}

/** Shows a table: its rows in the main view, its structure in [3]. */
export function openTable(v: DbView, t: Parameters<typeof browse>[1], cx: Context): void {
  const e = v.edits;

  if (e && counted(e).cells && (e.table.name !== t.name || e.table.schema !== t.schema)) {
    beforeLeaving(v, `open ${t.name}`, () => openTable(v, t, cx));

    return;
  }

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
    case "copy": if (v.tableAt > 0) copy(v, list[v.tableAt - 1] ?? "", cx); break;
    case "menu": schemaMenu(v, v.tableAt === 0 ? null : list[v.tableAt - 1] ?? null, cx); break;
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
    case "copy": if (r) copy(v, r.copy, cx); break;
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
    case "copy": if (line) copy(v, line.sql, cx); break;
    case "menu": if (line) logMenu(v, v.logAt, cx); break;
    default: return false;
  }

  return true;
}

/** The find line over the tables (f): it has the keyboard until ↓, enter or esc (popups.ts lineKey),
 *  or a click elsewhere; a click back into it gives it the keyboard again. */
function openFind(v: DbView): void {
  let find = v.tableFind;

  if (!find) {
    const input = InputState.new({ placeholder: "a table's name" });

    input.on("focus", () => {
      v.findTyping = true;
    });
    input.on("blur", () => {
      v.findTyping = false;
    });
    find = input;
    v.tableFind = input;
  }

  v.findTyping = true;
  find.focus();
}
