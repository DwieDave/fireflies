// The grids' actions (keys.ts' rows and results tables): moving the cursor,
// the cell's whole value (the Structure panel's Value tab), copying, export,
// a cell's menu; on the Rows tab sorting by a column, the WHERE filter line and
// the pages; on a query's results the result sets and back to the editor.

import type { Context } from "gpui-kit";
import { InputState } from "gpui-base";
import type { Column } from "./table.ts";
import type { ResultSet } from "./parse-out.ts";
import type { GridAt, QueryTab } from "./state.ts";
import { cellAt, columnsOf, moveGrid, rowText, rowsIn } from "./grid.ts";
import { loadRows } from "./session.ts";
import { cellMenu } from "./menus.ts";
import { openExport } from "./export-form.ts";
import { saveQueries } from "./queries.ts";
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

/** The grid shown now: its result and cursor (the Rows tab's or the shown query's), or null. */
export function shownGrid(v: DbView): { readonly set: ResultSet; readonly at: GridAt; readonly put: (at: GridAt) => void } | null {
  const q = v.shownQuery();

  if (q) {
    const set = q.outcome?.results[q.shown]?.set ?? null;

    return set ? { set, at: q.at, put: (at) => { q.at = at; } } : null;
  }

  const set = v.rows.set;

  return set ? { set, at: v.rows.at, put: (at) => { v.rows.at = at; } } : null;
}

/** The cursor moved by (rows, columns), in view. */
function move(v: DbView, dr: number, dc: number): void {
  const g = shownGrid(v);

  if (!g || !g.set.rows.length) return;

  g.put(moveGrid(g.at, g.set, colsOf(g.set), dr, dc, rowsIn(v.gridSize.height), v.gridSize.width));
}

/** The picked cell into the Value tab (in a narrow view, that panel shows). */
export function showValue(v: DbView): void {
  v.structTab = "value";

  if (v.size.width < 640) v.panel = "structure";
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
    case "first": move(v, -big, 0); break;
    case "last": move(v, big, 0); break;
    case "value": showValue(v); break;
    case "copy": if (g) cx.write_to_clipboard(cellAt(g.set, g.at) ?? ""); break;
    case "copy-row": if (g) cx.write_to_clipboard(rowText(g.set, g.at.row)); break;
    case "menu": if (g) cellMenu(v, g.at.row, g.at.col, cx); break;
    case "export": exportShown(v, cx); break;
    case "tab-next":
    case "tab-prev": v.mainTab = (v.mainTab + (action === "tab-next" ? 1 : v.queries.length)) % (v.queries.length + 1); v.focusShown(); break;
    default: return place === "rows" ? rowsAct(v, action, cx) : resultsAct(v, action, cx);
  }

  return true;
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
    case "sort": sortBy(v, v.rows.set?.columns[v.rows.at.col] ?? null, cx); break;
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

/** Sorts the Rows tab by a column: ascending, then descending, then as the table has them. */
export function sortBy(v: DbView, column: string | null, cx: Context): void {
  const b = v.rows.browse;

  if (!b || !column) return;

  const s = b.sort;
  const sort = s?.column !== column ? { column, desc: false } : s.desc ? null : { column, desc: true };

  v.rows.browse = { ...b, sort, offset: 0 };
  void loadRows(v, cx, true);
}

/** The filter line opens with the filter as it is. */
export function openFilter(v: DbView): void {
  const input = InputState.new({ placeholder: "a WHERE clause: lumens > 600 and lit", value: v.rows.browse?.filter ?? "" });

  v.filterInput = input;
  v.rows.filtering = true;
  input.focus();
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
