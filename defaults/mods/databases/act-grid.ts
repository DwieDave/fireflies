// The grids' actions (keys.ts' rows and results tables): moving the cursor,
// a range (shift + arrows, V, cmd-a, esc drops it), the cell's whole value
// (the Structure panel's Value tab), copying (a cell's value, a range as TSV,
// rows as JSON / CSV / INSERTs), export, the menus; a column's width (alt-← /
// alt-→, a drag on its header's edge), hiding and moving it; sorting: on the
// Rows tab the database's ORDER BY, on a query's result a sort of the rows
// that came back. The grid shown is the result seen through its columns'
// arrangement (columns.ts): shownGrid() says both and the way between them.

import type { Context } from "gpui-kit";
import { InputState } from "gpui-base";
import type { Column } from "./table.ts";
import type { Cell, ResultSet } from "./parse-out.ts";
import type { GridAt, QueryTab } from "./state.ts";
import { cellAt, columnsOf, measuredWidth, moveGrid, rowsIn } from "./grid.ts";
import { loadRows } from "./session.ts";
import { cellMenu, columnMenu, tabMenu } from "./menus.ts";
import { openExport } from "./export-form.ts";
import { saveQueries } from "./queries.ts";
import { stageNull, startEdit, undoCell } from "./cell-edit.ts";
import type { ColumnLayout, GridColumn, Shown } from "./columns.ts";
import { WIDTH_STEP, clampWidth, hide, keepLayout, keptLayout, moveColumn, setWidth, shownOf, showAll, tableKey, withWidths } from "./columns.ts";
import { copied, everything, hasRange, rangeOf, rowsOf, rowsSelected, unselected } from "./select.ts";
import { toCsv, toInserts, toJson } from "./export.ts";
import { qualified, quoteName, quoteText } from "./catalog.ts";
import type { default as DbView } from "./main.ts";

const measured = new WeakMap<ResultSet, readonly Column[]>();

/** A result's columns, measured once. */
export function colsOf(set: ResultSet): readonly Column[] {
  const known = measured.get(set);

  if (known) return known;

  const cols = columnsOf(set);

  measured.set(set, cols);

  return cols;
}

/** The grid shown now: the result as read and as shown, its columns as drawn, its cursor, its
 *  arrangement and sort; on a query tab, the tab. */
export interface GridNow {
  readonly place: "rows" | "results";
  readonly raw: ResultSet;
  readonly shown: Shown;
  readonly set: ResultSet;
  readonly cols: readonly GridColumn[];
  readonly at: GridAt;
  readonly put: (at: GridAt) => void;
  readonly layout: ColumnLayout;
  /** The arrangement changed (`keep`: a table's is kept for the next time). */
  readonly arrange: (l: ColumnLayout, keep: boolean) => void;
  /** The sort the header marks: the table's ORDER BY or the result's own. */
  readonly sort: { readonly column: string; readonly desc: boolean } | null;
  readonly q: QueryTab | null;
}

/** The Rows tab's arrangement: the table's kept one, read when the table changes. */
export function rowsLayout(v: DbView): ColumnLayout {
  const b = v.rows.browse;

  if (!b || !v.active) return v.columnsAt?.layout ?? keptLayout("");

  const key = tableKey(v.active.id, b.table.schema, b.table.name);

  if (v.columnsAt?.key !== key) v.columnsAt = { key, layout: keptLayout(key) };

  return v.columnsAt.layout;
}

/** The grid shown now (the Rows tab's or the shown query's), or null. */
export function shownGrid(v: DbView): GridNow | null {
  const q = v.shownQuery();

  if (q) {
    const raw = q.outcome?.results[q.shown]?.set ?? null;

    if (!raw) return null;

    const nums = colsOf(raw);
    const shown = shownOf(raw, q.layout, q.sort, (i) => nums[i]?.num ?? false);

    return {
      place: "results", raw, shown, set: shown.set, cols: withWidths(colsOf(shown.set), q.layout), at: q.at, put: (at) => { q.at = at; },
      layout: q.layout, arrange: (l) => { q.layout = l; }, sort: q.sort, q,
    };
  }

  const raw = v.rows.set;

  if (!raw) return null;

  const layout = rowsLayout(v);
  const shown = shownOf(raw, layout, null);

  return {
    place: "rows", raw, shown, set: shown.set, cols: withWidths(colsOf(shown.set), layout), at: v.rows.at, put: (at) => { v.rows.at = at; },
    layout,
    arrange: (l, keep) => {
      const key = v.columnsAt?.key;

      if (!key) return;

      v.columnsAt = { key, layout: l };

      if (keep) keepLayout(key, l);
    },
    sort: v.rows.browse?.sort ?? null, q: null,
  };
}

/** A shown column's index in the result as read. */
export const rawCol = (g: GridNow, c: number): number => g.shown.cols[c] ?? c;

/** A shown row's index in the result as read. */
export const rawRow = (g: GridNow, r: number): number => g.shown.rows?.[r] ?? r;

/** The cursor moved by (rows, columns), in view; `stretch` keeps (or starts) the range. */
function move(v: DbView, dr: number, dc: number, stretch = false): void {
  const g = shownGrid(v);

  if (!g || !g.set.rows.length) return;

  const at = moveGrid(g.at, g.set, g.cols, dr, dc, rowsIn(v.gridSize.height), v.gridSize.width);

  g.put(stretch ? { ...at, anchor: g.at.anchor ?? { row: g.at.row, col: g.at.col } } : at);
}

/** The picked cell into the Value tab (in a narrow view, that panel shows). */
export function showValue(v: DbView): void {
  v.structTab = "value";

  if (v.size.width < 640) v.panel = "structure";
}

/** What copying the cursor's cell or range gives (y, cmd-c): one cell's value, a range as TSV. */
export function copyText(g: GridNow): string {
  return copied(g.set, rangeOf(g.at));
}

/** The rows the cursor's range spans (or its row), as shown. */
export function rangeRows(g: GridNow): number[] {
  const r = rangeOf(g.at);

  return Array.from({ length: r.r1 - r.r0 + 1 }, (_x, k) => r.r0 + k);
}

/** A copy of rows' formats: TSV (as shown), JSON, CSV, INSERTs (every column read; a SQLite rowid
 *  the window read for itself left out). */
export type RowFormat = "tsv" | "json" | "csv" | "insert";

/** Rows (shown indexes; the range's when none are given) in a format. */
export function rowsText(v: DbView, g: GridNow, format: RowFormat, rows: readonly number[] = rangeRows(g)): string {
  if (format === "tsv") return rows.map((r) => copied(g.set, { r0: r, r1: r, c0: 0, c1: Math.max(0, g.set.columns.length - 1) })).join("\n");

  const set = rowsOf(g.raw, rows.map((r) => rawRow(g, r)), v.rows.browse?.rowid && g.place === "rows" ? ["rowid"] : []);

  if (format === "json") return toJson(set);

  if (format === "csv") return toCsv(set);

  const b = v.rows.browse;
  const kind = v.active?.kind ?? "sqlite";

  return toInserts(set, kind, b && g.place === "rows" ? qualified(kind, b.table) : quoteName(kind, g.q?.name ?? "result"));
}

/** A grid's actions; false when the action means nothing here. */
export function gridAct(v: DbView, place: "rows" | "results", action: string, cx: Context): boolean {
  const g = shownGrid(v);
  const big = 1e9;

  switch (action) {
    case "left": move(v, 0, -1); break;
    case "right": move(v, 0, 1); break;
    case "down": move(v, 1, 0); break;
    case "up": move(v, -1, 0); break;
    case "select-left": move(v, 0, -1, true); break;
    case "select-right": move(v, 0, 1, true); break;
    case "select-down": move(v, 1, 0, true); break;
    case "select-up": move(v, -1, 0, true); break;
    case "select-all": if (g) g.put(everything(g.at, g.set)); break;
    case "select-row": if (g) selectRow(g); break;
    case "unselect": if (!g || !hasRange(g.at)) return false; g.put(unselected(g.at)); break;
    case "first": move(v, -big, 0); break;
    case "last": move(v, big, 0); break;
    case "value": showValue(v); break;
    case "copy": if (g) copy(v, copyText(g), cx); break;
    case "copy-row": if (g) copy(v, rowsText(v, g, "tsv"), cx); break;
    case "menu": if (g) cellMenu(v, g.at.row, g.at.col, cx); break;
    case "column-menu": if (g) columnMenu(v, g.at.col, cx); break;
    case "tab-menu": tabMenu(v, v.mainTab, cx); break;
    case "export": exportShown(v, cx); break;
    case "cell-edit": startEdit(v); break;
    case "wider":
    case "narrower": if (g) widen(v, g, g.at.col, action === "wider" ? WIDTH_STEP : -WIDTH_STEP); break;
    case "hide": if (g) hideColumn(v, g, g.at.col); break;
    case "sort": if (g) sortColumn(v, g.set.columns[g.at.col] ?? null, cx); break;
    case "tab-next":
    case "tab-prev": v.mainTab = (v.mainTab + (action === "tab-next" ? 1 : v.queries.length)) % (v.queries.length + 1); v.focusShown(); break;
    default: return place === "rows" ? rowsAct(v, action, cx) : resultsAct(v, action, cx);
  }

  return true;
}

/** Copies, and says how much. */
export function copy(v: DbView, text: string, cx: Context): void {
  cx.write_to_clipboard(text);

  const lines = text.split("\n").length;

  v.say(lines > 1 ? `copied ${lines} lines` : "copied", "done");
}

/** V: the cursor's row whole; again, back to the cell. With a range of rows, they stay whole. */
function selectRow(g: GridNow): void {
  const r = rangeOf(g.at);
  const whole = hasRange(g.at) && r.c0 === 0 && r.c1 >= g.set.columns.length - 1;

  if (whole && r.r0 === r.r1) g.put(unselected(g.at));
  else g.put(rowsSelected(g.at, g.set, hasRange(g.at) ? (g.at.anchor?.row ?? g.at.row) : g.at.row, g.at.row));
}

/** A column `by` px wider (narrower when negative), kept for the table. */
export function widen(v: DbView, g: GridNow, col: number, by: number): void {
  const c = g.cols[col];

  if (!c) return;

  const now = c.px ?? measuredWidth(c);
  const px = clampWidth(now + by);

  if (px === now) {
    v.say(by > 0 ? "it's as wide as it gets" : "it's as narrow as it gets", "done");

    return;
  }

  g.arrange(setWidth(g.layout, c.name, px), true);
}

/** A column back to the width of its cells. */
export function fitColumn(g: GridNow, col: number): void {
  const name = g.set.columns[col];

  if (name !== undefined) g.arrange(setWidth(g.layout, name, null), true);
}

/** A column hidden (never the last one shown); the cursor stays on the column it was on, or the next. */
export function hideColumn(v: DbView, g: GridNow, col: number): void {
  const name = g.set.columns[col] ?? "";
  const next = hide(g.layout, g.raw.columns, name);

  if (!next) {
    v.say("the last column shown stays", "failed");

    return;
  }

  g.arrange(next, true);
  g.put({ ...g.at, anchor: null, col: Math.max(0, Math.min(g.at.col, g.set.columns.length - 2)), left: Math.min(g.at.left, Math.max(0, g.set.columns.length - 2)) });
  v.say(`${name} hidden · the column's menu (O) shows it again`, "done");
}

/** Every column shown again. */
export function showColumns(g: GridNow): void {
  g.arrange(showAll(g.layout), true);
}

/** A column moved to stand before shown column `to` (null: last); the cursor goes with it. */
export function moveTo(g: GridNow, col: number, to: number | null): void {
  const name = g.set.columns[col];

  if (name === undefined) return;

  const next = moveColumn(g.layout, g.raw.columns, name, to === null ? null : g.set.columns[to] ?? null);

  g.arrange(next, true);

  const after = shownOf(g.raw, next, g.q?.sort ?? null).set.columns.indexOf(name);

  if (after >= 0) g.put({ ...g.at, anchor: null, col: after });
}

/** Export what the main view shows: the table (its page, its filter) or the query's result. */
export function exportShown(v: DbView, cx: Context): void {
  const q = v.shownQuery();
  const set = q?.outcome?.results[q.shown]?.set ?? null;
  const t = v.rows.browse ? v.catalog.tables.find((x) => x.name === v.rows.browse?.table.name && x.schema === v.rows.browse.table.schema) : undefined;

  if (q && set) openExport(v, { result: set, name: q.name }, cx);
  else if (!q && t) openExport(v, { table: t }, cx);
}

function rowsAct(v: DbView, action: string, cx: Context): boolean {
  const b = v.rows.browse;

  if (!b) return false;

  switch (action) {
    case "cell-null": stageNull(v); break;
    case "cell-undo": undoCell(v); break;
    case "filter": openFilter(v); break;
    case "page-next":
      if (v.rows.set && v.rows.set.rows.length >= b.limit) {
        v.rows.browse = { ...b, offset: b.offset + b.limit };
        void loadRows(v, cx);
      }

      break;
    case "page-prev":
      if (b.offset > 0) {
        v.rows.browse = { ...b, offset: Math.max(0, b.offset - b.limit) };
        void loadRows(v, cx);
      }

      break;
    default: return false;
  }

  return true;
}

/** s on a column: the Rows tab asks the database (ORDER BY), a result sorts what came back. Each
 *  goes ascending, descending, then as it was. */
export function sortColumn(v: DbView, column: string | null, cx: Context): void {
  const q = v.shownQuery();

  if (!q) {
    sortBy(v, column, cx);

    return;
  }

  if (!column) return;

  const s = q.sort;

  setLocalSort(v, q, s?.column !== column ? { column, desc: false } : s.desc ? null : { column, desc: true });
}

/** A result's own sort set (or none): the cursor stays on its row number. */
export function setLocalSort(v: DbView, q: QueryTab, sort: QueryTab["sort"]): void {
  q.sort = sort;
  q.at = { ...q.at, anchor: null };
  v.say(sort ? `sorted here: the ${q.outcome?.cut ? "first rows that came back" : "rows that came back"}, by ${sort.column} ${sort.desc ? "↓" : "↑"}` : "as the database answered", "done");
}

/** Sorts the Rows tab by a column: ascending, then descending, then as the table has them. */
export function sortBy(v: DbView, column: string | null, cx: Context): void {
  const b = v.rows.browse;

  if (!b || !column) return;

  const s = b.sort;

  setSort(v, s?.column !== column ? { column, desc: false } : s.desc ? null : { column, desc: true }, cx);
}

/** The Rows tab's ORDER BY set (null: none), read again from the first page. */
export function setSort(v: DbView, sort: { readonly column: string; readonly desc: boolean } | null, cx: Context): void {
  const b = v.rows.browse;

  if (!b) return;

  v.rows.browse = { ...b, sort, offset: 0 };
  void loadRows(v, cx, true);
}

/** The filter line opens with the filter as it is (or `text`, the caret after it). */
export function openFilter(v: DbView, text?: string): void {
  const input = InputState.new({ placeholder: "a WHERE clause: lumens > 600 and lit", value: text ?? v.rows.browse?.filter ?? "" });

  v.filterInput = input;
  v.rows.filtering = true;
  input.focus();
}

/** The condition that keeps a column's value: `"col" = 'v'`, `"col" is null`. */
export function equalsSql(v: DbView, column: string, value: Cell): string {
  const kind = v.active?.kind ?? "sqlite";
  const name = quoteName(kind, column);

  return value === null ? `${name} is null` : `${name} = ${quoteText(kind, value)}`;
}

/** The Rows tab filtered to a condition at once (a read, from the first page). */
export function filterTo(v: DbView, where: string, cx: Context): void {
  const b = v.rows.browse;

  if (!b) return;

  v.rows.browse = { ...b, filter: where, offset: 0 };
  void loadRows(v, cx);
}

/** The filter line's text applied (enter), from the first page. */
export function applyFilter(v: DbView, cx: Context): void {
  const b = v.rows.browse;
  const text = v.filterInput?.value() ?? "";

  v.rows.filtering = false;
  v.filterInput = null;
  v.focusSelf();

  if (!b) return;

  v.rows.browse = { ...b, filter: text.trim(), offset: 0 };
  void loadRows(v, cx);
}

function resultsAct(v: DbView, action: string, cx: Context): boolean {
  const q = v.shownQuery();

  if (!q) return false;

  switch (action) {
    case "edit": q.inResults = false; q.editor.focus(); break;
    case "result-next":
    case "result-prev": q.shown = Math.max(0, Math.min((q.outcome?.results.length ?? 1) - 1, q.shown + (action === "result-next" ? 1 : -1))); break;
    case "query-close": closeQuery(v, q, cx); break;
    default: return false;
  }

  return true;
}

/** Closes a query tab (its text goes; the connection keeps the others). */
export function closeQuery(v: DbView, q: QueryTab, _cx: Context): void {
  v.queries = v.queries.filter((x) => x !== q);
  v.mainTab = Math.min(v.mainTab, v.queries.length);
  v.queriesDirty = true;
  void saveQueries(v);
  v.focusShown();
}

/** The picked cell's value in the grid shown. */
export const cellNow = (g: GridNow): Cell | undefined => cellAt(g.set, g.at);
