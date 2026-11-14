// The context menus: a right click opens one at the pointer, `m` the same one
// on what the cursor is on (M a grid column's, T the main view's tab). A
// connection's, a table's or view's, a schema's, a structure row's, a cell's,
// a column header's, a row number's, a tab's, a log line's; the history as a
// menu (ctrl-h); the ask before a connection is removed. Each row names the
// action it does and shows that action's key from keys.ts (entry()), so the
// menu teaches the keys and can't drift from them or from `?`.

import type { Context } from "gpui-kit";
import type { Pt } from "./menu-place.ts";
import { inView } from "./menu-place.ts";
import { zoom } from "./kit.ts";
import { InputState } from "gpui-base";
import type { Conn } from "./kinds.ts";
import type { TableRef } from "./catalog.ts";
import { qualified, quoteName } from "./catalog.ts";
import type { MenuRow, QueryTab } from "./state.ts";
import type { Place } from "./keys.ts";
import { keyOf } from "./keys.ts";
import { connect, remove, saveFound, test } from "./conns.ts";
import { openForm } from "./conn-form.ts";
import { openExport } from "./export-form.ts";
import type { GridNow } from "./act-grid.ts";
import {
  closeQuery, copy, copyText, equalsSql, exportShown, filterTo, fitColumn, hideColumn, openFilter, rangeRows, rawCol, rowsText, setLocalSort, setSort,
  showColumns, shownGrid, showValue, sortColumn, widen,
} from "./act-grid.ts";
import { addressOf, disconnect, duplicateConn, insertName, openTable, refresh } from "./actions.ts";
import type { StructRow } from "./panels.ts";
import { changeAt } from "./edits.ts";
import { editableNow, liveEdits, stageNull, startEdit, undoCell } from "./cell-edit.ts";
import { WIDTH_STEP } from "./columns.ts";
import { everything, hasRange, rangeOf, rowsSelected, wholeRows } from "./select.ts";
import { runQuery } from "./query.ts";
import { saveQueries } from "./queries.ts";
import { countRows } from "./session.ts";
import { askForward, forwardRunning, stopForward } from "./forward.ts";
import type { default as DbView } from "./main.ts";

/** A menu row that does an action of a place: its key is that action's (none: no key does it). */
export function entry(place: Place, act: string | null, label: string, go: () => void, more: { readonly sub?: string; readonly danger?: boolean } = {}): MenuRow {
  const key = act ? keyOf(place, act) : undefined;

  return act && key ? { label, go, ...more, act, key } : { label, go, ...more };
}

/** Opens a menu over the view: at the press when a right click asked for it (atPointer), else at
 *  what the keys are on (the grid's cursor cell, found as it's drawn: popups.ts menuLayer), else in
 *  the middle (menu-place.ts). */
export function openMenu(v: DbView, title: string, rows: readonly MenuRow[]): void {
  const near = v.menuNear;

  v.menuNear = null;
  v.menu = rows.length ? { title, rows, at: 0, near } : null;
}

/** A press's place in the view (layout px): its window position less the view's origin (both
 *  known: the press's own place, exact wherever the view's root last heard the pointer), else
 *  the pointer as the root last saw it. */
export function pressPoint(v: DbView, e: { readonly position?: Pt } | null | undefined): Pt | null {
  const o = v.origin;

  return e?.position && o ? inView(e.position, o, zoom()) : v.pointer;
}

/** Runs `open` (a menu's) so the menu stands at the press `e`: a right click's way. */
export function atPointer(v: DbView, open: () => void, e?: { readonly position?: Pt } | null): void {
  v.menuNear = pressPoint(v, e);
  open();
  v.menuNear = null;
}

// ---- [1] a connection

export function connMenu(v: DbView, c: Conn, cx: Context): void {
  const live = v.active?.id === c.id;
  const address = addressOf(c);

  const rows: MenuRow[] = [
    live ? entry("conns", "disconnect", "Disconnect", () => disconnect(v), { sub: "its tables close; the query tabs stay" })
      : entry("conns", "connect", "Connect", () => void connect(v, c, cx)),
    entry("conns", "conn-test", "Test", () => void test(v, c, cx)),
    entry("conns", "conn-edit", "Edit…", () => openForm(v, c, cx)),
    entry("conns", "conn-duplicate", "Duplicate…", () => duplicateConn(v, c, cx), { sub: "a new one with its fields; the password isn't copied" }),
    entry("conns", "copy", "Copy its address", () => copy(v, address, cx), { sub: address }),
  ];

  if (c.origin !== "saved") rows.push(entry("conns", "conn-pin", "Pin it", () => void saveFound(v, c, cx), { sub: pinWords(c) }));

  // Its forward: stop the running one, or start it (the ask shows what it runs).
  const fwd = c.forward ? forwardRunning(c.forward) : null;

  if (c.forward && fwd?.live) rows.push(entry("conns", null, `Stop its forward (localhost:${c.forward.local})`, () => stopForward(v, c, cx), { sub: `${c.forward.target} in ${c.forward.context}/${c.forward.namespace}; the Kubernetes window lists it too` }));
  else if (c.forward) rows.push(entry("conns", null, "Start its forward…", () => askForward(v, c, "down", cx), { sub: `${c.forward.target} :${c.forward.remote} → localhost:${c.forward.local}` }));

  rows.push(entry("conns", "conn-new", "New connection…", () => openForm(v, null, cx)));

  if (c.origin === "saved") rows.push(entry("conns", "conn-pin", "Unpin it…", () => confirmRemove(v, c, cx), { sub: "every Databases window drops it", danger: true }));
  else if (c.origin === "sent") rows.push(entry("conns", "conn-remove", "Remove…", () => confirmRemove(v, c, cx), { danger: true }));

  openMenu(v, c.name, rows);
}

/** Asks before a connection goes (its keychain item and history with it). */
export function confirmRemove(v: DbView, c: Conn, cx: Context): void {
  if (c.origin !== "saved") {
    v.ask = { verdict: { risk: "write", verb: "remove", target: null }, text: `Remove ${c.name}? It was never pinned.`, step: 1, input: null, go: () => void remove(v, c, cx) };

    return;
  }

  const what = c.secret === "kubernetes" ? "its password stays in the cluster's secret; its history goes" : c.secret === "keychain" ? "its password leaves the keychain and its history goes too" : "its history goes too";

  v.ask = { verdict: { risk: "write", verb: "unpin", target: null }, text: `Unpin ${c.name}? Every Databases window drops it; ${what}.`, step: 1, input: null, go: () => void remove(v, c, cx) };
}

/** What pinning a connection keeps, in words (the menu's line under "Pin it"). */
export function pinWords(c: Conn): string {
  const pw = c.secret === "kubernetes" && c.source ? `its password read from secret ${c.source.name} at each connect` : "its password in the keychain";

  return `every Databases window lists it, after a restart too; ${pw}${c.forward ? "; its forward started again when asked" : ""}`;
}

// ---- [2] a table, a view, a schema

/** A statement in a new query tab, run there: what it does is shown, and it asks as any run does
 *  (twice for a destructive one, refused on a read-only connection). */
function runInTab(v: DbView, sql: string, cx: Context): void {
  runQuery(v, v.addQuery(sql, cx), false, cx);
}

export function tableMenu(v: DbView, t: TableRef, cx: Context): void {
  const kind = v.active?.kind ?? "sqlite";
  const name = qualified(kind, t);
  const view = t.type === "view";
  const empty = kind === "postgres" || kind === "mysql" ? `truncate table ${name};` : `delete from ${name};`;
  const asked = "in a query tab; it asks twice, its name typed";

  openMenu(v, `${t.name}${view ? " · view" : ""}`, [
    entry("tables", "open", "Rows and structure", () => openTable(v, t, cx)),
    entry("tables", "table-query", "Select it in a query", () => void v.addQuery(`select * from ${name} limit 100;`, cx)),
    entry("tables", "count", "Count its rows", () => void countRows(v, t, cx), { sub: "exactly: it reads every row (the list shows the server's estimate)" }),
    entry("tables", "insert", "Its name into the query", () => insertName(v, name, cx), { sub: "or drag the row into the query" }),
    entry("tables", "copy", "Copy its name", () => copy(v, t.name, cx)),
    entry("tables", "export", "Export…", () => openExport(v, { table: t }, cx)),
    ...(view ? [] : [entry("tables", null, "Empty it…", () => runInTab(v, empty, cx), { sub: `${empty} · ${asked}`, danger: true })]),
    entry("tables", null, view ? "Drop the view…" : "Drop it…", () => runInTab(v, `drop ${view ? "view" : "table"} ${name};`, cx), { sub: asked, danger: true }),
  ]);
}

export function schemaMenu(v: DbView, schema: string | null, cx: Context): void {
  const kind = v.active?.kind ?? "postgres";

  openMenu(v, schema ?? "every schema", [
    entry("tables", "open", schema ? "Its tables" : "Every schema's tables", () => { v.schema = schema; v.tablesTab = "tables"; v.tableAt = 0; }),
    ...(schema ? [
      entry("tables", "insert", "Its name into the query", () => insertName(v, quoteName(kind, schema), cx)),
      entry("tables", "copy", "Copy its name", () => copy(v, schema, cx)),
    ] : []),
  ]);
}

// ---- [3] a structure row

export function structMenu(v: DbView, r: StructRow, cx: Context): void {
  const kind = v.active?.kind ?? "sqlite";
  const rows: MenuRow[] = [];
  const other = r.table ? v.catalog.tables.find((t) => t.name === r.table) : undefined;

  if (other) rows.push(entry("structure", "open", `Open ${other.name}`, () => openTable(v, other, cx)));

  if (r.name) rows.push(entry("structure", "insert", "The name into the query", () => insertName(v, quoteName(kind, r.name ?? ""), cx), { sub: "or drag the row into the query" }));

  rows.push(entry("structure", "copy", "Copy", () => copy(v, r.copy, cx), { sub: r.copy }));
  openMenu(v, r.name ?? r.copy, rows);
}

// ---- [0] the grids: a cell, a column's header, a row's number, a tab

/** The rows a row's menu copies: the selected whole rows when it's among them, else it alone. */
function rowsFor(g: GridNow, row: number): number[] {
  const r = rangeOf(g.at);

  return hasRange(g.at) && wholeRows(r, g.set.columns.length) && row >= r.r0 && row <= r.r1 ? rangeRows(g) : [row];
}

/** Copying rows in each format, as menu rows. */
function rowCopies(v: DbView, g: GridNow, rows: readonly number[], cx: Context): MenuRow[] {
  const what = rows.length > 1 ? `the ${rows.length} rows` : "the row";

  return [
    entry(g.place, "copy-row", `Copy ${what}`, () => copy(v, rowsText(v, g, "tsv", rows), cx), { sub: "tab-separated, as shown" }),
    entry(g.place, null, `Copy ${what} as JSON`, () => copy(v, rowsText(v, g, "json", rows), cx)),
    entry(g.place, null, `Copy ${what} as CSV`, () => copy(v, rowsText(v, g, "csv", rows), cx)),
    ...(g.place === "rows" ? [entry(g.place, null, `Copy ${what} as INSERT`, () => copy(v, rowsText(v, g, "insert", rows), cx))] : []),
  ];
}

export function cellMenu(v: DbView, row: number, col: number, cx: Context): void {
  const g = shownGrid(v);

  if (!g) return;

  const column = g.set.columns[col] ?? "";
  const place = g.place;
  const range = hasRange(g.at);
  const value = g.set.rows[row]?.[col];
  const rows: MenuRow[] = [];

  // Editing: only where the rows can be (else no row for it: c says why).
  if (place === "rows" && !("why" in editableNow(v)) && !range) {
    const changed = g.raw ? changeAt(liveEdits(v), g.raw, row, column) : null;

    rows.push(
      entry(place, "cell-edit", `Change ${column}…`, () => { startEdit(v); }),
      entry(place, "cell-null", "Set it NULL", () => stageNull(v)),
      ...(changed ? [entry(place, "cell-undo", "Undo this change", () => undoCell(v), { sub: `back to ${changed.was ?? "NULL"}` })] : []),
    );
  }

  rows.push(
    entry(place, "value", "Its whole value", () => showValue(v), { sub: "in [3] Value" }),
    entry(place, "copy", range ? "Copy the selection" : "Copy the value", () => copy(v, copyText(g), cx), { sub: range ? "tab-separated: a spreadsheet takes it" : "as it is" }),
    entry(place, "select-all", "Select every cell", () => g.put(everything(g.at, g.set)), { sub: "shift + arrows, a drag or the row numbers select some" }),
    ...rowCopies(v, g, rowsFor(g, row), cx),
  );

  if (place === "rows" && value !== undefined) {
    const where = equalsSql(v, column, value);

    rows.push(entry(place, null, "Filter by this value", () => filterTo(v, where, cx), { sub: `where ${where}` }));
  }

  rows.push(
    entry(place, "sort", `Sort by ${column}`, () => sortColumn(v, column, cx), { sub: place === "rows" ? "ORDER BY: ↑, ↓, off" : "the rows that came back: ↑, ↓, off" }),
    entry(place, "column-menu", `${column}'s menu…`, () => columnMenu(v, col, cx)),
    entry(place, "export", "Export…", () => exportShown(v, cx)),
  );

  openMenu(v, `${column} · row ${row + 1}${range ? " · a selection" : ""}`, rows);
}

/** A column's header menu: its sort (the database's on a table, the result's own), filter, width,
 *  hide, the hidden ones back, its name. */
export function columnMenu(v: DbView, col: number, cx: Context): void {
  const g = shownGrid(v);

  if (!g) return;

  const name = g.set.columns[col] ?? "";
  const place = g.place;
  const kind = v.active?.kind ?? "sqlite";
  const now = g.sort?.column === name ? g.sort.desc ? "desc" : "asc" : "off";
  // s goes ↑, ↓, off: its key shows on the one it would do next.
  const next = now === "off" ? "asc" : now === "asc" ? "desc" : "off";

  const sort = (to: "asc" | "desc" | "off") => {
    const s = to === "off" ? null : { column: name, desc: to === "desc" };

    if (g.q) setLocalSort(v, g.q, s);
    else setSort(v, s, cx);
  };

  const sortRow = (to: "asc" | "desc" | "off", label: string) => entry(place, to === next ? "sort" : null, `${label}${to === now ? "  ✓" : ""}`, () => sort(to));
  const c = g.cols[col];
  const raw = rawCol(g, col);
  const type = g.raw.types?.[raw] ?? (place === "rows" ? v.columnTypes()?.[raw] : undefined);

  const rows: MenuRow[] = [
    sortRow("asc", place === "rows" ? "Sort ascending (ORDER BY … asc)" : "Sort ascending (here)"),
    sortRow("desc", place === "rows" ? "Sort descending (ORDER BY … desc)" : "Sort descending (here)"),
    sortRow("off", place === "rows" ? "Not sorted" : "As the database answered"),
  ];

  if (place === "rows") rows.push(entry(place, "filter", "Filter by this column…", () => openFilter(v, `${quoteName(kind, name)} `)));

  rows.push(
    entry(place, "hide", "Hide it", () => hideColumn(v, g, col)),
    ...(g.shown.hidden ? [entry(place, null, `Show every column (${g.shown.hidden} hidden)`, () => showColumns(g))] : []),
    entry(place, "wider", "Wider", () => widen(v, g, col, WIDTH_STEP), { sub: "or drag the header's right edge" }),
    entry(place, "narrower", "Narrower", () => widen(v, g, col, -WIDTH_STEP)),
    ...(c && g.layout.widths[c.name] !== undefined ? [entry(place, null, "Fit it to its cells", () => fitColumn(g, col), { sub: "a double click on its edge too" })] : []),
    entry(place, null, "Its name into the query", () => insertName(v, quoteName(kind, name), cx), { sub: "or drag the header into the query" }),
    entry(place, null, "Copy its name", () => copy(v, name, cx)),
  );

  openMenu(v, `${name}${type ? ` · ${type}` : ""}`, rows);
}

/** A row number's menu: select it, copy it (or the selected rows it's among). */
export function rowMenu(v: DbView, row: number, cx: Context): void {
  const g = shownGrid(v);

  if (!g) return;

  const rows = rowsFor(g, row);

  openMenu(v, rows.length > 1 ? `rows ${(rows[0] ?? 0) + 1}–${(rows.at(-1) ?? 0) + 1}` : `row ${row + 1}`, [
    entry(g.place, "select-row", "Select it", () => g.put(rowsSelected({ ...g.at, row }, g.set, row, row))),
    ...rowCopies(v, g, rows, cx),
  ]);
}

/** The main view's tab `n` (0 the Rows, else a query tab): its menu. */
export function tabMenu(v: DbView, n: number, cx: Context): void {
  const q = n > 0 ? v.queries[n - 1] : null;

  if (q) {
    queryTabMenu(v, q, cx);

    return;
  }

  const b = v.rows.browse;
  const g = shownGrid(v);
  const rows: MenuRow[] = [];

  if (b && v.active) {
    rows.push(entry("rows", "refresh", "Read it again", () => refresh(v, cx)));

    if (b.filter) rows.push(entry("rows", null, "Clear the filter", () => filterTo(v, "", cx), { sub: `where ${b.filter}` }));

    if (b.sort) rows.push(entry("rows", null, "Not sorted", () => setSort(v, null, cx), { sub: `order by ${b.sort.column}` }));

    if (g?.shown.hidden) rows.push(entry("rows", null, `Show every column (${g.shown.hidden} hidden)`, () => showColumns(g)));

    rows.push(
      entry("rows", "export", "Export…", () => exportShown(v, cx)),
      entry("rows", null, "Select it in a query", () => void v.addQuery(`select * from ${qualified(v.active?.kind ?? "sqlite", b.table)} limit 100;`, cx)),
    );
  }

  rows.push(entry("rows", "query-new", "New query tab", () => void v.addQuery("", cx)));

  if (v.active) rows.push(entry("rows", "history", "History…", () => historyMenu(v, cx), { sub: "what ran on this connection" }));

  openMenu(v, b ? `Rows · ${b.table.name}` : "Rows", rows);
}

function queryTabMenu(v: DbView, q: QueryTab, cx: Context): void {
  const others = v.queries.length > 1;

  openMenu(v, q.name, [
    entry("editor", "run", "Run the statement", () => runQuery(v, q, false, cx), { sub: "under the caret, or the selection" }),
    entry("editor", "run-all", "Run every statement", () => runQuery(v, q, true, cx)),
    entry("results", null, "Rename…", () => startRename(v, q), { sub: "a double click on the tab too" }),
    entry("results", null, "Duplicate", () => {
      const copyOf = v.addQuery(q.editor.value(), cx);

      copyOf.name = `${q.name} copy`;
    }),
    entry("results", "query-close", "Close", () => closeQuery(v, q, cx)),
    ...(others ? [entry("results", null, "Close the others", () => closeOthers(v, q))] : []),
    entry("results", "query-new", "New query tab", () => void v.addQuery("", cx)),
    entry("results", "history", "History…", () => historyMenu(v, cx), { sub: "what ran on this connection" }),
  ]);
}

/** Every query tab but `q` closed. */
export function closeOthers(v: DbView, q: QueryTab): void {
  v.queries = [q];
  v.mainTab = 1;
  v.queriesDirty = true;
  void saveQueries(v);
  v.focusShown();
}

/** A query tab's name asked for (enter keeps it, esc leaves it). */
export function startRename(v: DbView, q: QueryTab): void {
  const input = InputState.new({ placeholder: "the tab's name", value: q.name });

  v.rename = { tab: q, input };
  input.focus();
}

/** The rename kept (an empty name leaves it as it was). */
export function keepRename(v: DbView): void {
  const r = v.rename;

  if (!r) return;

  const name = r.input.value().trim().slice(0, 60);

  if (name) {
    r.tab.name = name;
    v.queriesDirty = true;
  }

  v.rename = null;
  v.focusShown();
}

// ---- [4] a log line

export function logMenu(v: DbView, i: number, cx: Context): void {
  const line = v.log[i];

  if (!line) return;

  openMenu(v, line.sql.replace(/\s+/g, " ").slice(0, 80), [
    entry("log", "open", "Into a query tab", () => void v.addQuery(`${line.sql};`, cx), { sub: "not run" }),
    entry("log", "copy", "Copy the statement", () => copy(v, line.sql, cx)),
    ...(line.ok ? [] : [entry("log", null, "Copy what it said", () => copy(v, line.said, cx), { sub: line.said })]),
  ]);
}

/** How long ago, in a few letters. */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));

  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
}

/** The connection's history (ctrl-h): picking one opens it in a new query tab. */
export function historyMenu(v: DbView, cx: Context): void {
  if (!v.active) {
    v.say("connect first: the history is the connection's", "failed");

    return;
  }

  if (!v.history.length) {
    v.say(v.active.origin === "saved" ? "nothing run here yet" : "a connection that isn't saved keeps no history", "working");

    return;
  }

  openMenu(v, `history · ${v.active.name}`, v.history.slice(0, 60).map((h) => ({
    label: h.sql.replace(/\s+/g, " ").slice(0, 160),
    sub: `${ago(h.at)} ago${h.ok === false ? " · failed" : ""}${h.rows !== undefined ? ` · ${h.rows} rows` : ""}${h.ms !== undefined ? ` · ${h.ms} ms` : ""}`,
    go: () => void v.addQuery(`${h.sql}${h.sql.trimEnd().endsWith(";") ? "" : ";"}`, cx),
  })));
}
