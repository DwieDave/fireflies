// What a menu a key opened stands at (menu-place.ts), in the view's layout
// px, while the view is wide: the grid's cursor cell when the main panel has
// the keys (keyedAnchor); the cursor's row of a list (a connection, a table,
// a schema, a database, a structure row, a log line: rowAnchor); the main
// panel's title for its tabs' menu (tabAnchor). Else nothing: the middle.
//
// A list's rows are 19 px (panels.ts listRow), [1]'s group rules 20
// (kit.ts groupRule) and [2]'s find line 22, under the panel's border and top
// padding, less how far the list is scrolled (its ScrollHandle's offset). The
// panels stack as chrome.ts body puts them: [1] at the column's top, [3] and
// [4] at its foot, each its divider's size, GAP_Y between.
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
import { GAP_X, GAP_Y, NARROW, RESULT_HEAD, editorDivider, wideDividers } from "./layout.ts";
import { GRAB } from "./dividers.ts";
import type { Place } from "./keys.ts";
import { connList } from "./conns.ts";
import { rowsBefore } from "./panels.ts";
import { zoom } from "./kit.ts";

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

/** A list row's height, a group rule's in [1], [2]'s find line (panels.ts). */
const LIST_ROW = 19;
const RULE = 20;
const FIND_LINE = 22;

/** The body's padding (chrome.ts body: 6, 12 on top), a panel's border and top padding (kit.ts panel). */
const PAD = 6;
const BODY_TOP = 12;
const BORDER = 1;
const PANEL_TOP = 7;

/** A wide view's panels (layout px, outer edges): the left column's three, the right one's two. */
function panels(v: DbView): { readonly conns: Rect; readonly tables: Rect; readonly structure: Rect; readonly main: Rect; readonly log: Rect | null } | null {
  if (v.size.width < NARROW) return null;

  const ds = v.dividers;
  const w = wideDividers(v.room(), (d) => ds.size(d));
  const left = ds.size(w.left);
  const top = TOP_BAR + BODY_TOP;
  const foot = TOP_BAR + v.bodyH - PAD;
  const connsH = ds.size(w.conns);
  const structH = ds.size(w.struct);
  const rx = PAD + left + GAP_X;
  const rw = v.size.width - PAD - rx;
  const logH = w.log ? ds.size(w.log) : 0;

  return {
    conns: { x: PAD, y: top, w: left, h: connsH },
    tables: { x: PAD, y: top + connsH + GAP_Y, w: left, h: foot - structH - GAP_Y - (top + connsH + GAP_Y) },
    structure: { x: PAD, y: foot - structH, w: left, h: structH },
    main: { x: rx, y: top, w: rw, h: (w.log ? foot - logH - GAP_Y : foot) - top },
    log: w.log ? { x: rx, y: foot - logH, w: rw, h: logH } : null,
  };
}

/** The list rows' scroll (layout px down). */
const scrolledOf = (h: { offset(): { readonly x: number; readonly y: number } }): number => -h.offset().y / (zoom() || 1);

/** The cursor's row of the list `place` shows ([1], [2] in any tab, [3]'s lists, [4]), while
 *  it's drawn inside its panel. */
export function rowAnchor(v: DbView, place: Place): Rect | null {
  const all = panels(v);

  if (!all) return null;

  // `over`: what stands over the list in the panel; `down`: the row's top in the list.
  const row = (box: Rect | null, over: number, down: number, scroll: { offset(): { readonly x: number; readonly y: number } }): Rect | null => {
    if (!box || down < 0) return null;

    const listTop = box.y + PANEL_TOP + over;
    const y = listTop + down - scrolledOf(scroll);

    if (y < listTop - 1 || y + LIST_ROW > box.y + box.h) return null;

    return { x: box.x + BORDER, y, w: box.w - 2 * BORDER, h: LIST_ROW };
  };

  if (place === "conns") return row(all.conns, 0, v.connAt * LIST_ROW + rowsBefore(connList(v), v.connAt) * RULE, v.scrolls.conns);

  if (place === "tables") {
    const find = v.tableFind && (v.tablesTab === "tables" || v.tablesTab === "views") ? FIND_LINE : 0;

    return row(all.tables, find, v.tableAt * LIST_ROW, v.scrolls.tables);
  }

  if (place === "structure") return v.structTab === "value" ? null : row(all.structure, 0, v.structAt * LIST_ROW, v.scrolls.structure);

  return place === "log" ? row(all.log, 0, v.logAt * LIST_ROW, v.scrolls.log) : null;
}

/** The main panel's title (its tabs: the Rows, the query tabs), what T's menu stands under. */
export function tabAnchor(v: DbView): Rect | null {
  const main = panels(v)?.main;

  return main ? { x: main.x + BORDER, y: main.y - PANEL_TOP, w: main.w - 2 * BORDER, h: PANEL_TOP * 2 } : null;
}
