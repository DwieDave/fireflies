// The rendered view's column (rendered.ts draws through it): the rows placed
// top to bottom and scrolled (the lit block kept in view), only those near
// the view drawn, the scrollbar; the lit block's box (its block editor, its
// kind at the corner, the kinds under an empty one) and its height, measured
// from where its editor drew its last line, else estimated from its lines.

import type { Context, Element } from "gpui-kit";
import { div } from "gpui-kit";
import { h_flex, v_flex, Editor } from "gpui-base";
import type { Unit } from "./live.ts";
import type { Rendered, Row, ViewOptions } from "./rendered.ts";
import { addView, emptyView, kindsView, unitView, ADD_H, KINDS_H } from "./rendered-units.ts";

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

/** How many rows `text` takes in a box `width` px wide, `cw` px a character (an estimate: words wrap whole). */
export function wrappedRows(text: string, width: number, cw = CHAR): number {
  const cols = Math.max(8, Math.floor((width - 4) / cw));
  let n = 0;

  for (const l of text.split("\n")) n += Math.max(1, Math.ceil(l.replace(/\t/g, "    ").length / cols));

  return n;
}

/** The rows placed: each one's top, the column's height, the lit row's index (-1: none). */
interface Placed {
  readonly tops: readonly number[];
  readonly total: number;
  readonly li: number;
}

/** A row's height as drawn (the lit one's, or its own). */
const rowH = (v: Rendered, r: Row): number => (r.lit ? litHeight(v) : v.height(r.key, r.u));

/** Places the rows top to bottom; scrolls the lit block into view (with room around it) when
 *  it asks to be shown, and keeps the scroll within the column. */
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

  if (v.reveal && li >= 0) {
    const top = tops[li] ?? 0;
    const bottom = top + litHeight(v);

    if (top - 24 < v.scrollY) v.scrollY = Math.max(0, top - 24);
    else if (bottom + 24 > v.scrollY + v.viewH) v.scrollY = Math.max(0, bottom + 24 - v.viewH);

    v.reveal = false;
  }

  v.scrollY = Math.max(0, Math.min(v.scrollY, Math.max(0, total - v.viewH)));
  v.litTop = li >= 0 ? (tops[li] ?? 0) - v.scrollY : 0;

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
    .child(v.host.dither(o.focused ? o.t.accent : o.t.ansi8));
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

/** The lit block's height: its editor's content as measured, or (grown since) as its lines would wrap;
 *  an empty block has its kinds under it. */
export function litHeight(v: Rendered): number {
  // Measured: that height, grown by the rows the text has gained since (never shrunk to an
  // estimate, so it doesn't jump between the two on a key). Not yet: the estimate, a little
  // slack in it (a box a little short lets the editor scroll inside it).
  const rows = wrappedRows(v.piece, v.litW, v.cw);

  const h =
    v.blockH === null
      ? rows * v.rowH + 6
      : v.blockHFor === v.piece
        ? v.blockH
        : v.blockH + Math.max(0, rows - wrappedRows(v.blockHFor ?? "", v.litW, v.cw)) * v.rowH;

  return Math.min(h, Math.max(ROW * 3, v.viewH - 60)) + 10 + (v.offersKinds() ? KINDS_H : 0);
}

/** Measures the block editor's content from where it drew its last line; its row and character size too. */
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

  const h = (b.y + b.height - b.view.y) / z + 2;
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
    .pr(92)
    .py(5)
    .child(div().absolute().inset_0().opacity(0.22).child(v.host.dither(t.ansi0)))
    .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent))
    .child(div().absolute().right(8).top(5).text_size(10.5).text_color(t.dim).child(kindWord(v.unit)))
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
