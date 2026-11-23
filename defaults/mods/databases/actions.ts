// What the Databases window's actions do (keys.ts names them): the window's
// own (panels, history, read again, move, close, keys) and the lists' (the
// connections, the tables, the structure, the log). The grids' are
// act-grid.ts's. act() takes a key's name or an action's own name (a
// databases.<action> command) and says whether it did something.

import type { Context } from "gpui-kit";
import { InputState } from "gpui-base";
import { home, run } from "herdr";
import { Array as Arr, Option, String as Str } from "effect";
import type { Binding, Place } from "./keys.ts";
import { BINDINGS, actionsFor } from "./keys.ts";
import { PANELS, STRUCT_TABS, gridStart, tablesTabsOf } from "./state.ts";
import type { PanelId } from "./state.ts";
import type { Conn, ConnDraft } from "./kinds.ts";
import { DEFAULT_PORT, onFile, tilde } from "./kinds.ts";
import { connAtCursor, connList, connect, discover, saveFound, test } from "./conns.ts";
import { changePinned, togglePin } from "./pinned.ts";
import { browse, countRows, loadRows, loadStructure } from "./session.ts";
import { insertAtCaret } from "./query.ts";
import { saveQueries } from "./queries.ts";
import { copy, gridAct } from "./act-grid.ts";
import { connMenu, historyMenu, logMenu, schemaMenu, structMenu, tableMenu, confirmRemove } from "./menus.ts";
import { openForm } from "./conn-form.ts";
import { openExport } from "./export-form.ts";
import { keepCopy, ownPane } from "./opening.ts";
import { quoteName, qualified } from "./catalog.ts";
import { schemasOf, shownTables, structRows, tableCursor } from "./panels.ts";
import { edgesOf } from "./layout.ts";
import { counted } from "./edits.ts";
import { beforeLeaving, discardAll, openReview, runSave } from "./cell-edit.ts";
import { stopReads } from "./reads.ts";
import { dbRows, enterEmpty, loadDatabases, showDatabases, useDatabase } from "./dbs.ts";
import { dbMenu, stateMenu } from "./connmark.ts";
import type { default as DbView } from "./main.ts";

/** Whether `name` is an action of the place's or the window's table (a command by name). */
const isAction = (place: Place, name: string): boolean => Arr.some([...BINDINGS[place], ...BINDINGS.window], (b: Binding) => b[2] === name);

/** Does what a key (or an action's name) asks in a place; false when it means nothing there. */
export function act(v: DbView, place: Place, key: string, cx: Context): boolean {
  // esc stops a read going on (the tables, a secret, the folder's environment) before anything else.
  if (key === "escape" && place !== "editor" && stopReads(v)) {
    v.say("stopped", "done");

    return true;
  }

  const bound = actionsFor(place, key);
  const actions = bound.length !== 0 ? bound : isAction(place, key) ? [key] : [];

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
  if (v.overlay === null || Str.isEmpty(v.overlay)) return false;

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
  const found = Option.getOrUndefined(Arr.findFirst(PANELS, (p) => p === panel));

  if (found !== undefined) setPanel(v, found);
  else if (action === "panel-next" || action === "panel-prev") {
    const i = PANELS.indexOf(v.panel) + (action === "panel-next" ? 1 : PANELS.length - 1);

    setPanel(v, PANELS[i % PANELS.length] ?? "conns");
  } else if (action === "query-new") v.addQuery("");
  else if (action === "history") historyMenu(v, cx);
  else if (action === "refresh") refresh(v, cx);
  else if (action === "databases") showDatabases(v, cx);
  else if (action === "conn-menu") stateMenu(v, cx);
  else if (action === "move") v.move(cx);
  else if (action === "help") v.help = !v.help;
  else if (action === "close") closeCopy(v);
  else if (action === "grow" || action === "shrink") resize(v, action === "grow" ? 1 : -1);
  // databases.save with the review open runs it (a command doesn't reach the review's y).
  else if (action === "save") {
    if (v.review !== null) runSave(v);
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

  if (edges.length === 0) v.say("nothing to resize here: one panel shows", "failed");
  else if (!ds.stepAll(edges, dir)) v.say(dir > 0 ? "it's as big as it gets" : "it's as small as it gets", "done");
}

/** q: a window closes; a pane closes too (q already means close here). */
function closeCopy(v: DbView): void {
  if (v.overlay !== null && Str.isNonEmpty(v.overlay)) {
    v.closeWindow();

    return;
  }

  const own = ownPane(v);

  if (own !== null && Str.isNonEmpty(own)) beforeLeaving(v, "close", () => run("pane.close", { pane: own }));
}

/** Reads everything shown again: the folder's connections, the tables, the structure, the page. */
export function refresh(v: DbView, cx: Context): void {
  if (counted(v.edits).cells !== 0) {
    beforeLeaving(v, "read it again", () => refresh(v, cx));

    return;
  }

  v.run(discover(v));

  if (v.active === null) return;

  v.refreshCatalog();

  if (v.struct.table !== null) v.run(loadStructure(v, v.struct.table), { key: "structure" });

  if (v.rows.browse !== null) v.run(loadRows(v, true), { key: "rows" });
}

/** A list's cursor moved by `by`, kept inside `n` rows. */
const step = (at: number, by: number, n: number): number => Math.max(0, Math.min(Math.max(0, n - 1), at + by));

function connAct(v: DbView, action: string, cx: Context): boolean {
  const c = connAtCursor(v);
  const n = connList(v).length;

  switch (action) {
    case "down": v.connAt = step(v.connAt, 1, n); break;
    case "up": v.connAt = step(v.connAt, -1, n); break;
    case "connect": if (c !== null) v.run(connect(v, c)); break;
    case "conn-new": openForm(v, null, cx); break;
    case "conn-edit": if (c !== null) openForm(v, c, cx); break;
    case "conn-remove": if (c !== null) confirmRemove(v, c); break;
    case "conn-save": if (c !== null) v.run(saveFound(v, c)); break;
    case "conn-pin": if (c !== null) togglePin(v, c); break;
    case "conn-test": if (c !== null) v.run(test(v, c)); break;
    case "conn-duplicate": if (c !== null) duplicateConn(v, c, cx); break;
    case "disconnect": if (v.active === null) v.say("nothing is connected", "failed"); else disconnect(v); break;
    case "copy": if (c !== null) copy(v, addressOf(c), cx); break;
    case "conn-down":
    case "conn-up": if (c !== null) moveConn(v, c, action === "conn-down" ? 1 : -1, cx); break;
    case "menu": if (c !== null) connMenu(v, c, cx); break;
    default: return false;
  }

  return true;
}

/** Where a connection is, as a URL a client takes, never a password (a file: its path). */
export function addressOf(c: Conn): string {
  if (c.kind === "libsql" && (c.url !== undefined && Str.isNonEmpty(c.url))) return c.url;

  if (onFile(c)) return tilde(c.path ?? "", home());

  const scheme = c.kind === "postgres" ? "postgresql" : "mysql";
  const port = (c.port !== undefined && c.port !== 0) && c.port !== DEFAULT_PORT[c.kind] ? `:${c.port}` : "";

  return `${scheme}://${c.user !== undefined && Str.isNonEmpty(c.user) ? `${encodeURIComponent(c.user)}@` : ""}${c.host || "localhost"}${port}${c.database !== undefined && Str.isNonEmpty(c.database) ? `/${encodeURIComponent(c.database)}` : ""}`;
}

/** A new connection's form with a connection's fields (not its password: nothing secret is copied). */
export function duplicateConn(v: DbView, c: Conn, cx: Context): void {
  const { source, ...rest } = c;
  const draft: ConnDraft = { ...rest, id: `copy:${c.id}`, name: `${c.name} copy`, origin: "found", secret: c.secret === "ask" ? "ask" : "none" };

  // A cluster's secret is where the password lives, not the password: the copy reads it too.
  if (c.secret === "kubernetes" && source !== undefined) {
    draft.secret = "kubernetes";
    draft.source = source;
  }

  openForm(v, draft, cx);
}

/** Closes the connection: its tables, structure and rows go (changes not saved are asked about
 *  first); the query tabs stay, they're the connection's and are kept. */
export function disconnect(v: DbView): void {
  const c = v.active;

  if (c === null) return;

  if (counted(v.edits).cells !== 0) {
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
  const i = Option.getOrElse(Arr.findFirstIndex(v.saved, (s) => s.id === c.id), () => -1);

  if (i < 0) {
    v.say("only saved connections keep an order (s saves it)", "failed");

    return;
  }

  placeConn(v, c, Math.max(0, Math.min(v.saved.length - 1, i + by)), cx);
}

/** A saved connection put at place `to` among the saved ones, kept; the cursor goes with it. */
export function placeConn(v: DbView, c: Conn, to: number, cx: Context): void {
  const i = Option.getOrElse(Arr.findFirstIndex(v.saved, (s) => s.id === c.id), () => -1);

  if (i < 0 || i === to) return;

  const list = Arr.filter(v.saved, (s) => s.id !== c.id);

  list.splice(to, 0, c);
  v.saved = list;
  v.connAt = to;
  // On the file as it is now: before the one that stands at `to` here (else last).
  const before = list[to + 1]?.id ?? null;

  v.run(changePinned(v, (now) => {
    const rest = Arr.filter(now, (s) => s.id !== c.id);
    const at = before !== null && Str.isNonEmpty(before) ? Option.getOrElse(Arr.findFirstIndex(rest, (s) => s.id === before), () => -1) : -1;
    const kept = Option.getOrUndefined(Arr.findFirst(now, (s) => s.id === c.id)) ?? c;

    rest.splice(at < 0 ? rest.length : at, 0, kept);

    return rest;
  }));
}

/** The query tab names go into: the shown one, else a new one. */
function targetQuery(v: DbView, cx: Context) {
  return v.shownQuery() ?? v.queries[0] ?? v.addQuery("");
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
const tableSql = (v: DbView, schema: string | null, name: string): string => (v.active !== null ? qualified(v.active.kind, { schema, name }) : name);

/** [ / ]: the next or previous of the kind's tabs in [2] (the Databases tab read when it shows). */
function nextTablesTab(v: DbView, by: 1 | -1, cx: Context): void {
  const tabs = tablesTabsOf(v.active?.kind ?? "postgres");
  const at = Math.max(0, tabs.indexOf(v.tablesTab));
  const next = tabs[(at + by + tabs.length) % tabs.length] ?? "tables";

  if (next === "databases") showDatabases(v, cx);
  else {
    v.tablesTab = next;
    v.tableAt = 0;
  }
}

function tableAct(v: DbView, action: string, cx: Context): boolean {
  if (action === "subtab-next" || action === "subtab-prev") {
    nextTablesTab(v, action === "subtab-next" ? 1 : -1, cx);

    return true;
  }

  if (v.tablesTab === "schemas") return schemaAct(v, action, cx);

  if (v.tablesTab === "databases") return dbAct(v, action, cx);

  const list = shownTables(v);

  // The list read again shorter: the cursor stands on its last row (drawn there too).
  v.tableAt = tableCursor(v, list.length);

  const t = list[v.tableAt];

  switch (action) {
    case "down": v.tableAt = step(v.tableAt, 1, list.length); break;
    case "up": v.tableAt = step(v.tableAt, -1, list.length); break;
    // An empty database: enter connects to the server's one other database, or opens the list.
    case "open": if (t !== undefined) openTable(v, t); else return enterEmpty(v, cx); break;
    case "table-query": if (t !== undefined) v.addQuery(`select * from ${tableSql(v, t.schema, t.name)} limit 100;`); break;
    case "insert": if (t !== undefined) insertName(v, tableSql(v, t.schema, t.name), cx); break;
    case "copy": if (t !== undefined) copy(v, t.name, cx); break;
    case "export": if (t !== undefined) openExport(v, { table: t }, cx); break;
    case "count": if (t !== undefined) v.run(countRows(v, t)); break;
    case "menu": if (t !== undefined) tableMenu(v, t, cx); break;
    case "table-find": openFind(v); break;
    default: return false;
  }

  return true;
}

/** Shows a table: its rows in the main view, its structure in [3]. */
export function openTable(v: DbView, t: Parameters<typeof browse>[1]): void {
  const e = v.edits;

  if (e !== null && counted(e).cells !== 0 && (e.table.name !== t.name || e.table.schema !== t.schema)) {
    beforeLeaving(v, `open ${t.name}`, () => openTable(v, t));

    return;
  }

  browse(v, t);
  v.run(loadStructure(v, t), { key: "structure" });
  v.mainTab = 0;
  v.structAt = 0;
  keepCopy(v);
}

function schemaAct(v: DbView, action: string, cx: Context): boolean {
  const list = schemasOf(v);

  switch (action) {
    case "down": v.tableAt = step(v.tableAt, 1, list.length + 1); break;
    case "up": v.tableAt = step(v.tableAt, -1, list.length + 1); break;
    // The first row is "every schema".
    case "open": v.schema = v.tableAt === 0 ? null : list[v.tableAt - 1] ?? null; v.tablesTab = "tables"; v.tableAt = 0; break;
    case "insert": if (v.tableAt > 0 && v.active !== null) insertName(v, quoteName(v.active.kind, list[v.tableAt - 1] ?? ""), cx); break;
    case "copy": if (v.tableAt > 0) copy(v, list[v.tableAt - 1] ?? "", cx); break;
    case "menu": schemaMenu(v, v.tableAt === 0 ? null : list[v.tableAt - 1] ?? null, cx); break;
    default: return false;
  }

  return true;
}

/** The Databases tab: enter connects to the database (MySQL's first row: every database). */
function dbAct(v: DbView, action: string, cx: Context): boolean {
  const list = dbRows(v);
  const at = Math.min(v.tableAt, Math.max(0, list.length - 1));
  const name = list[at];
  const has = at < list.length;

  switch (action) {
    case "down": v.tableAt = step(v.tableAt, 1, list.length); break;
    case "up": v.tableAt = step(v.tableAt, -1, list.length); break;
    case "open": if (has) useDatabase(v, name ?? null); break;
    case "insert": if ((name !== null && name !== undefined && Str.isNonEmpty(name)) && v.active !== null) insertName(v, quoteName(v.active.kind, name), cx); break;
    case "copy": if (name !== null && name !== undefined && Str.isNonEmpty(name)) copy(v, name, cx); break;
    case "count": v.run(loadDatabases(v, true)); break;
    case "menu": if (has) dbMenu(v, name ?? null, cx); break;
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
    case "open": if (r !== undefined) structOpen(v, r, cx); break;
    case "insert": if ((r?.name !== null && r?.name !== undefined && Str.isNonEmpty(r?.name)) && v.active !== null) insertName(v, quoteName(v.active.kind, r.name), cx); break;
    case "copy": if (r !== undefined) copy(v, r.copy, cx); break;
    case "menu": if (r !== undefined) structMenu(v, r, cx); break;
    default: return false;
  }

  return true;
}

/** enter on a structure row: a key's other table opens; a column's name goes into the query. */
function structOpen(v: DbView, r: ReturnType<typeof structRows>[number], cx: Context): void {
  const other = r.table !== null && Str.isNonEmpty(r.table) ? Option.getOrUndefined(Arr.findFirst(v.catalog.tables, (t) => t.name === r.table)) : undefined;

  if (other !== undefined) openTable(v, other);
  else if ((r.name !== null && Str.isNonEmpty(r.name)) && v.active !== null) insertName(v, quoteName(v.active.kind, r.name), cx);
}

function logAct(v: DbView, action: string, cx: Context): boolean {
  const line = v.log[v.logAt];

  switch (action) {
    case "down": v.logAt = step(v.logAt, 1, v.log.length); break;
    case "up": v.logAt = step(v.logAt, -1, v.log.length); break;
    case "open": if (line !== undefined) v.addQuery(`${line.sql};`); break;
    case "copy": if (line !== undefined) copy(v, line.sql, cx); break;
    case "menu": if (line !== undefined) logMenu(v, v.logAt, cx); break;
    default: return false;
  }

  return true;
}

/** The find line over the tables (f): it has the keyboard until ↓, enter or esc (popups.ts lineKey),
 *  or a click elsewhere; a click back into it gives it the keyboard again. */
function openFind(v: DbView): void {
  let find = v.tableFind;

  if (find === null) {
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
