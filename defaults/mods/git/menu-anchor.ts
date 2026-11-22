// What a menu a key opened for the selected row stands at (menu-place.ts):
// that row, in the window's layout px, from the layout's own numbers (as
// databases/menu-anchor.ts does for its grid): the header (bars.ts git-head,
// 34) and the body's top padding (4), the body's side padding (6), the side
// column's top padding (side.ts sideColumn, 7) and the gap between its panels
// (12), each panel as drawn (sidePanel's on_size_change: panelPx), the panel's
// border (draw.ts panel: 1) and its list's top padding (7), then the rows from
// the first one shown (lists.ts sideList: top, rowPx). Null where that row
// isn't drawn (the main view has the keys, a narrow window showing the main
// view, a row scrolled out of sight): the menu stands in the middle.

import { Array as Arr, Option } from "effect";
import type { Rect } from "@fireflies/menu-place";
import type { ListContext } from "./keys.ts";
import type { Panel } from "./state.ts";
import { NARROW, PANELS } from "./state.ts";
import type { default as GitView } from "./main.ts";

/** The header's height and the body's top padding (main.ts render). */
const BODY_TOP = 34 + 4;

/** The body's padding at the sides (main-view.ts windowBody). */
const SIDE_PAD = 6;

/** A side column's top padding and the gap between its panels (side.ts sideColumn). */
const COLUMN_TOP = 7;
const PANEL_GAP = 12;

/** A splitter's width (lists.ts splitter). */
const SPLITTER = 6;

/** A panel's border and its body's top padding (draw.ts panel). */
const BORDER = 1;
const LIST_TOP = 7;

/** Where the panel showing `p` stands: its column's left edge and the panels stacked above it
 *  in that column (one panel alone when it has a column of its own), or null when not drawn. */
function column(v: GitView, p: Panel): { readonly x: number; readonly above: readonly Panel[] } | null {
  const w = v.size.width;

  if (v.show !== null) return p === "files" && (w >= NARROW || v.focus !== "main") ? { x: SIDE_PAD, above: [] } : null;

  if (w < NARROW) return v.focus === "main" ? null : { x: SIDE_PAD, above: PANELS.slice(0, PANELS.indexOf(p)) };

  if (v.mode === "full") return v.panel === p && v.focus !== "main" ? { x: SIDE_PAD, above: [] } : null;

  if (v.mode === "half") {
    if (v.panel === p) return { x: SIDE_PAD + (v.railW ?? Math.round(Math.max(230, Math.min(300, w * 0.22)))) + SPLITTER, above: [] };

    const rail = Arr.filter(PANELS, (q) => q !== v.panel);

    return { x: SIDE_PAD, above: rail.slice(0, rail.indexOf(p)) };
  }

  return { x: SIDE_PAD, above: PANELS.slice(0, PANELS.indexOf(p)) };
}

/** The selected row of list `ctx` (the row a key acts on), while it's drawn. */
export function rowAnchor(v: GitView, ctx: ListContext): Rect | null {
  const p = Option.getOrUndefined(Arr.findFirst(PANELS, (q) => v.ctxOf(q) === ctx));

  if (p === undefined || v.focus !== "side") return null;

  const col = column(v, p);
  const box = v.panelPx[p];
  const rowH = v.rowPx[ctx];

  if (col === null || box === undefined || rowH === undefined || rowH === 0) return null;

  let y = BODY_TOP + COLUMN_TOP;

  for (const q of col.above) {
    const h = v.panelPx[q]?.height;

    if (h === undefined) return null;

    y += h + PANEL_GAP;
  }

  const at = (v.sel[ctx] ?? 0) - (v.top[ctx] ?? 0);

  if (at < 0 || at >= (v.vis[ctx] ?? 0)) return null;

  return { x: col.x + BORDER, y: y + LIST_TOP + at * rowH, w: box.width - 2 * BORDER, h: rowH };
}
