// What a menu a key opened stands at (menu-place.ts): the grid's cursor cell,
// in the view's layout px, when the main panel has the keys and the view is
// wide; else nothing (the menu stands in the middle).
//
// The cell's place is the layout's own numbers, measured from the view's inner
// corner (inside a window's 1 px border: where its pointer events and the menu
// layer start, as the real engine reports them): the top bar (chrome.ts db-head, 34), the body's padding (chrome.ts body: 6, 12
// on top), the left column and its gap (layout.ts), the panel's border and
// top padding (kit.ts panel: 1, 7), what stands over the grid (the Rows
// tab's filter line, 24; a query's editor, its divider and the result line),
// then the grid's own (grid.ts: the row numbers, the header, its rows from the
// first one shown, its columns from the first one shown).

import type { default as DbView } from "./main.ts";
import type { Rect } from "./menu-place.ts";
import { shownGrid } from "./act-grid.ts";
import { HEAD, ROW, colWidth, gutterWidth } from "./grid.ts";
import { GAP_X, NARROW, RESULT_HEAD, editorDivider, wideDividers } from "./layout.ts";
import { GRAB } from "./dividers.ts";

/** The top bar's height (chrome.ts db-head). */
export const TOP_BAR = 34;

/** The Rows tab's filter line over its grid (main-view.ts filterLine). */
const FILTER_LINE = 24;

/** The grid's top left corner in the view (layout px), wide; null when narrow. */
export function gridOrigin(v: DbView): { readonly x: number; readonly y: number } | null {
  if (v.size.width < NARROW) return null;

  const ds = v.dividers;
  const left = ds.size(wideDividers(v.room(), (d) => ds.size(d)).left);
  const x = 6 + left + GAP_X + 1;
  const top = TOP_BAR + 12 + 7;
  const q = v.shownQuery();
  const over = q ? ds.size(editorDivider(v.queryBox)) + GRAB + RESULT_HEAD : FILTER_LINE;

  return { x, y: top + over };
}

/** The grid's cursor cell, when the main panel has the keys and shows a grid. */
export function keyedAnchor(v: DbView): Rect | null {
  if (v.panel !== "main") return null;

  const g = shownGrid(v);
  const o = gridOrigin(v);

  if (!g || !o) return null;

  const { at, cols, set } = g;

  if (at.row < at.top || at.col < at.left) return null;

  let x = o.x + gutterWidth(set.rows.length);

  for (let c = at.left; c < at.col; c++) x += colWidth(cols[c] ?? { name: "", num: false, ch: 4 });

  const w = colWidth(cols[at.col] ?? { name: "", num: false, ch: 4 });

  return { x, y: o.y + HEAD + (at.row - at.top) * ROW, w, h: ROW };
}
