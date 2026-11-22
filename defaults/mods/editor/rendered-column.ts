// The rendered view's column (rendered.ts draws through it): the rows placed
// top to bottom and scrolled (the lit block kept in view), only those near
// the view drawn, the scrollbar; the lit block's box (its block editor, its
// kind at the corner unless the bar names it, the kinds under an empty one) and its height, measured
// from where its editor drew its last line, else estimated from its lines.

import type { Context, Element } from "gpui-kit";
import { div } from "gpui-kit";
import { h_flex, v_flex, Editor } from "gpui-base";
import type { Unit } from "./live.ts";
import { rowStarts } from "./live.ts";
import type { Rendered, Row, ViewOptions } from "./rendered.ts";
import { addView, emptyView, kindsView, unitView, ADD_H, KINDS_H } from "./rendered-units.ts";
import { edge } from "@fireflies/tones";

const PAD_TOP = 18;
const PAD_BOTTOM = 60;
export const ROW = 20; // the block editor's line height at font 13 (measured when drawn)
export const CHAR = 7.8; // a code-font character's width at 13 px (measured when drawn)
const OVERDRAW = 1.2;

/** What a unit is called, at the lit block's corner. */
export function kindWord(u: Unit | null | undefined): string {
  if (!u) return "";

  switch (u.kind) {
    case "heading":
      return `heading ${u.level}`;
    case "item":
      return u.task ? "task" : /^\d/.test(u.marker) ? "numbered item" : "list item";
    case "fence":
      return u.lang ? `code · ${u.lang}` : "code";
    case "quote":
      return u.callout ? `callout · ${u.callout}` : "quote";
    case "para":
      return "paragraph";
    case "ref":
      return "reference";
    case "front":
      return "front matter";
    case "blank":
      return "new block";
    default:
      return u.kind;
  }
}

/** How many characters a row of a box `width` px wide holds, `cw` px a character. */
export function wrapCols(width: number, cw = CHAR): number {
  return Math.max(8, Math.floor((width - 4) / cw));
}

/** How many rows `text` takes in a box `width` px wide, `cw` px a character (an estimate: words
 *  wrap whole, as the block editor wraps them). */
export function wrappedRows(text: string, width: number, cw = CHAR): number {
  const cols = wrapCols(width, cw);
  let n = 0;

  for (const l of text.split("\n")) n += rowStarts(l, cols).length;

  return n;
}

/** The caret's row in the lit block, from the block's top (layout px): the rows its text up
 *  to the caret takes as it wraps. */
function caretY(v: Rendered): number {
  const c = v.block.cursor();
  const lines = v.piece.split("\n");
  const upTo = [...lines.slice(0, c.line), (lines[c.line] ?? "").slice(0, c.col)].join("\n");

  return v.padTop + (wrappedRows(upTo, v.litW, v.cw) - 1) * v.rowH;
}

/** The rows placed: each one's top, the column's height, the lit row's index (-1: none). */
interface Placed {
  readonly tops: readonly number[];
  readonly total: number;
  readonly li: number;
}

/** A row's height as drawn (the lit one's, or its own). */
const rowH = (v: Rendered, r: Row): number => (r.lit ? litHeight(v) : v.height(r.key, r.u));

/** Places the rows top to bottom; puts a kept line back at the top (a reload: rendered.ts
 *  keepTop), else scrolls the lit block into view (with room around it) when it asks to be
 *  shown, or the caret's row when typed into (follow); keeps the scroll within the column and notes the unit at the top. */
function placeRows(v: Rendered, rows: readonly Row[]): Placed {
  const tops: number[] = [];
  let y = PAD_TOP;

  for (const r of rows) {
    y += r.gap;
    tops.push(y);
    y += rowH(v, r);
  }

  const total = y + ADD_H + PAD_BOTTOM;
  const li = rows.findIndex((r) => r.lit);

  const keep = v.keep;

  if (keep) {
    // The unit holding the kept line, else the first after it (it fell between units).
    let i = rows.findIndex((r) => r.u.to >= keep.line);

    if (i < 0) i = rows.length - 1;

    const r = rows[i];

    if (r) v.scrollY = (tops[i] ?? 0) + (r.u.from === keep.line ? Math.min(keep.dy, rowH(v, r)) : 0);

    v.keep = null;
    v.reveal = false;
  } else if (v.reveal && li >= 0) {
    const top = tops[li] ?? 0;
    const bottom = top + litHeight(v);

    if (top - 24 < v.scrollY) v.scrollY = Math.max(0, top - 24);
    else if (bottom + 24 > v.scrollY + v.viewH) v.scrollY = Math.max(0, bottom + 24 - v.viewH);

    v.reveal = false;
  } else if (v.follow && li >= 0) {
    // Typed into: the caret's row stays in view with room around it, the view still while it is.
    const y = (tops[li] ?? 0) + Math.min(caretY(v), Math.max(0, litHeight(v) - v.rowH));

    if (y - 24 < v.scrollY) v.scrollY = Math.max(0, y - 24);
    else if (y + v.rowH + 24 > v.scrollY + v.viewH) v.scrollY = y + v.rowH + 24 - v.viewH;
  }

  v.follow = false;
  v.scrollY = Math.max(0, Math.min(v.scrollY, Math.max(0, total - v.viewH)));
  v.litTop = li >= 0 ? (tops[li] ?? 0) - v.scrollY : 0;

  // The unit at the top (the last one starting above the view's top edge, else the first).
  let top = 0;

  while (top + 1 < rows.length && (tops[top + 1] ?? 0) <= v.scrollY) top++;

  const at = rows[top];

  v.topAt = at ? { line: at.u.from, dy: v.scrollY - (tops[top] ?? 0) } : null;

  return { tops, total, li };
}

/** The rows near the view (and the lit one): their indexes. */
function shownRows(v: Rendered, rows: readonly Row[], tops: readonly number[]): number[] {
  const lo = v.scrollY - v.viewH * OVERDRAW;
  const hi = v.scrollY + v.viewH * (1 + OVERDRAW);

  return rows.flatMap((r, i) => {
    const top = tops[i] ?? 0;

    return r.lit || (top + v.height(r.key, r.u) >= lo && top <= hi) ? [i] : [];
  });
}

/** The shown rows drawn, each after its gap; a spacer where unshown rows sit between two shown ones. */
function rowKids(v: Rendered, rows: readonly Row[], tops: readonly number[], shown: readonly number[], o: ViewOptions): Element[] {
  let last: number | null = null;
  const kids: Element[] = [];

  for (const i of shown) {
    const r = rows[i];

    if (!r) continue;

    const before = last === null ? undefined : rows[last];

    if (last !== null && before && i !== last + 1) kids.push(div().h((tops[i] ?? 0) - r.gap - ((tops[last] ?? 0) + rowH(v, before))).flex_none());

    kids.push(div().flex_none().h(r.gap));
    kids.push(r.lit ? litView(v, o) : unitView(v, r, o));
    last = i;
  }

  return kids;
}

/** The scrollbar at the right edge: dithered, the accent while the view has the keyboard. */
function scrollbar(v: Rendered, o: ViewOptions, total: number): Element {
  const max = Math.max(1, total - v.viewH);
  const frac = Math.min(1, v.viewH / Math.max(1, total));

  return div()
    .absolute()
    .right(1)
    .w(3)
    .top(Math.round((v.scrollY / max) * v.viewH * (1 - frac)))
    .h(Math.max(16, Math.round(v.viewH * frac)))
    .child(v.host.dither(o.focused ? o.t.accent : o.t.muted));
}

/** The view: the column of rows (only those near the view drawn), scrolled by the wheel. */
export function columnView(v: Rendered, o: ViewOptions): Element {
  const { t } = o;
  const rows = v.rows();
  const { tops, total } = placeRows(v, rows);
  const shown = shownRows(v, rows, tops);
  const firstShown = shown[0];
  const first = firstShown === undefined ? 0 : (tops[firstShown] ?? 0) - (rows[firstShown]?.gap ?? 0);
  const lastUnit = rows.at(-1)?.u ?? null;
  const empty = o.empty;
  // "add a block" under the last block (not under an empty one that offers its kinds already).
  const adds = !(lastUnit?.kind === "blank" && v.offersKinds()) && (!shown.length || shown.at(-1) === rows.length - 1);

  return div()
    .id("editor-rendered")
    .relative()
    .flex_1()
    .min_h(0)
    .min_w(0)
    .overflow_hidden()
    .bg(t.background)
    .on_size_change((size, cx) => {
      const h = o.unzoom(size.height);

      if (Math.abs(h - v.viewH) > 1) {
        v.viewH = h;
        v.host.notify(cx);
      }
    })
    .on_scroll_wheel((e, cx) => {
      v.scrollY = Math.max(0, Math.min(Math.max(0, total - v.viewH), v.scrollY - o.unzoom(e.delta.y)));
      v.host.notify(cx);
    })
    .child(
      h_flex()
        .absolute()
        .left(0)
        .right(0)
        .top(first - v.scrollY)
        .justify_center()
        .child(
          v_flex()
            .w_full()
            .max_w(o.maxWidth ?? 760)
            .px(28)
            .when(Boolean(empty), (el) => (empty ? el.child(emptyView(v, t, empty)) : el))
            .children(rowKids(v, rows, tops, shown, o))
            .when(adds, (el) => el.child(addView(v, o, lastUnit))),
        ),
    )
    .when(v.viewH < total, (el) => el.child(scrollbar(v, o, total)));
}

/** The lit block's height: its editor's content as measured, grown by the rows its text has
 *  gained since, and never less than its lines take as they wrap (a box too short scrolls the
 *  editor inside it: its first row slips out of sight); an empty block has its kinds under it. */
export function litHeight(v: Rendered): number {
  const rows = wrappedRows(v.piece, v.litW, v.cw);
  const estimate = rows * v.rowH + 6;
  const measured = v.blockH === null ? 0 : v.blockHFor === v.piece ? v.blockH : v.blockH + Math.max(0, rows - wrappedRows(v.blockHFor ?? "", v.litW, v.cw)) * v.rowH;

  return Math.min(Math.max(measured, estimate), Math.max(ROW * 3, v.viewH - 60)) + 10 + (v.offersKinds() ? KINDS_H : 0);
}

/** Measures the block editor's content from where it drew its first and last lines (so an
 *  editor scrolled inside a box that was short still measures its whole text); its row and
 *  character size too. */
export function measureBlock(v: Rendered, cx: Context): void {
  const lines = v.piece.split("\n");
  const last = lines.length - 1;
  const first = lines[0] ?? "";
  const b = v.block.bounds({ line: last, col: (lines[last] ?? "").length });

  if (!b?.view) return;

  const z = v.host.zoom();

  if (b.height > 4) v.rowH = b.height / z;

  const a0 = v.block.bounds({ line: 0, col: 0 });
  const a1 = first.length ? v.block.bounds({ line: 0, col: 1 }) : null;

  if (a0 && a1 && a1.y === a0.y && a1.x > a0.x) v.cw = (a1.x - a0.x) / z;

  // The room above the first row, kept from a measure where it was in view.
  if (a0 && a0.y >= b.view.y) v.padTop = (a0.y - b.view.y) / z;

  const top = a0 ? a0.y : b.view.y;
  const h = (b.y + b.height - top) / z + v.padTop + 2;
  const changed = h > 4 && Math.abs((v.blockH ?? -1) - h) > 1;

  if (h > 4) {
    v.blockH = h;
    v.blockHFor = v.piece;
  }

  if (changed) v.host.notify(cx);
}

/** The lit block: its block editor on a dithered ground with the accent rail, its kind at the
 *  corner, the kinds under an empty one. */
function litView(v: Rendered, o: ViewOptions): Element {
  const { t } = o;
  const h = litHeight(v);
  const empty = v.offersKinds();

  return div()
    .id("rendered-lit")
    .relative()
    .flex_none()
    .h(h)
    .ml(-12)
    .mr(-12)
    .pl(12)
    .pr(o.kindInBar ? 12 : 92)
    .py(5)
    // A right-click here is the block editor's own (cut, copy, paste), not the pane's (a scratchpad's more menu).
    .on_mouse_down("right", (_e, cx) => cx.stop_propagation())
    .child(div().absolute().inset_0().opacity(0.22).child(v.host.dither(edge(t))))
    .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent))
    .when(!o.kindInBar, (el) => el.child(div().absolute().right(8).top(5).text_size(10.5).text_color(t.dim).child(kindWord(v.unit))))
    .child(
      v_flex()
        .relative()
        .size_full()
        .child(
          div()
            .id("rendered-lit-box")
            .relative()
            .flex_1()
            .min_h(0)
            .w_full()
            .on_size_change((s, cx) => {
              v.litW = o.unzoom(s.width);
              cx.timer.after(0, (cx) => v.measure(cx));
            })
            .child(Editor.new(v.block).size_full().font_family(v.host.font)),
        )
        .when(empty, (el) => el.child(kindsView(v, o))),
    );
}
