// The grid of rows (a table's page, a query's result): columns as wide as
// their longest cell (the preview's table.ts measures them), numbers on the
// right, NULL apart from an empty text, a cursor cell, only the rows and
// columns in view drawn. The cursor moves by keys (moveGrid), a click picks a
// cell, a double click opens its whole value, a right click its menu, a click
// on a header sorts by that column, the wheel scrolls. Editing (cell-edit.ts)
// lays its overlay on top: a staged cell in yellow over a dithered tint, its old
// value on hover, a pip in its row's gutter, the edited cell an input.

import { div } from "gpui-kit";
import type { Color, Context, Element } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import type { InputState } from "gpui-base";
import type { Theme } from "herdr";
import type { Column } from "./table.ts";
import { table, oneLine } from "./table.ts";
import type { Cell, ResultSet } from "./parse-out.ts";
import type { GridAt } from "./state.ts";
import { dither, pip, stop } from "./kit.ts";

/** A character's width and a row's height, in px at the grid's text size. */
export const CH = 7.8;
export const ROW = 20;
export const HEAD = 22;
const PAD = 16;
const GUTTER_MIN = 28;

/** The grid's columns, measured once per result (table.ts: widths, numbers). */
export function columnsOf(set: ResultSet): readonly Column[] {
  const text = [set.columns.map((c) => c), ...set.rows.slice(0, 400).map((r) => r.map((v) => (v === null ? "null" : v)))];

  return table(text).cols;
}

/** A column's drawn width. */
export const colWidth = (c: Column): number => Math.ceil(Math.max(c.ch, 4) * CH) + PAD;

/** The row-number gutter's width for `n` rows. */
export const gutterWidth = (n: number): number => Math.max(GUTTER_MIN, String(n).length * CH + 14) + 10;

/** How many whole rows fit `height`. */
export const rowsIn = (height: number): number => Math.max(1, Math.floor((height - HEAD) / ROW));

/** The columns that fit `width` from `left` (at least one). */
export function colsIn(cols: readonly Column[], left: number, width: number): number {
  let used = 0;
  let n = 0;

  for (let i = left; i < cols.length; i++) {
    used += colWidth(cols[i] ?? { name: "", num: false, ch: 4 });

    if (used > width && n > 0) break;

    n++;
  }

  return Math.max(1, n);
}

/** The cursor moved by (dr, dc), kept inside the result and in view. `rows` / `width` are the view's. */
export function moveGrid(at: GridAt, set: ResultSet, cols: readonly Column[], dr: number, dc: number, rows: number, width: number): GridAt {
  const row = Math.max(0, Math.min(set.rows.length - 1, at.row + dr));
  const col = Math.max(0, Math.min(set.columns.length - 1, at.col + dc));
  const top = row < at.top ? row : row >= at.top + rows ? row - rows + 1 : at.top;
  let left = Math.min(at.left, col);

  while (left < col && col >= left + colsIn(cols, left, width - gutterWidth(set.rows.length))) left++;

  return { row, col, top: Math.max(0, top), left };
}

/** What the grid hands back: a cell picked, opened, its menu, a header to sort by, a scroll. */
export interface GridHandlers {
  readonly pick: (row: number, col: number, cx: Context) => void;
  readonly open: (row: number, col: number, cx: Context) => void;
  readonly menu: (row: number, col: number, cx: Context) => void;
  readonly sort: ((col: number, cx: Context) => void) | null;
  readonly scroll: (rows: number, cols: number, cx: Context) => void;
}

/** How the grid is drawn: its ids' prefix, size, whether its panel has the keyboard, the sorted column. */
export interface GridLook {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly active: boolean;
  readonly sort: { readonly column: string; readonly desc: boolean } | null;
  readonly types?: readonly string[] | undefined;
  readonly overlay?: GridOverlay | undefined;
}

/** What editing lays over the grid: a cell's staged change, a row with changes, the edited cell. */
export interface GridOverlay {
  readonly change: (r: number, c: number) => { readonly was: Cell; readonly now: Cell } | null;
  readonly marked: (r: number) => boolean;
  readonly editing: { readonly row: number; readonly col: number; readonly input: InputState; readonly isNull: boolean } | null;
}

/** The edited cell is at least this wide (an input needs room). */
const EDIT_MIN = 150;

/** A cell's text and colour. */
function cellLook(t: Theme, v: Cell, num: boolean): readonly [string, Color] {
  if (v === null) return ["null", t.dim];

  // An empty text, apart from NULL.
  if (v === "") return ["''", t.ansi8];

  return [oneLine(v), num ? t.ansi3 : t.foreground];
}

function header(t: Theme, look: GridLook, set: ResultSet, cols: readonly Column[], shown: readonly number[], gutter: number, h: GridHandlers): Element {
  const cells = shown.map((i) => {
    const name = set.columns[i] ?? "";
    const sorted = look.sort?.column === name;
    const c = cols[i] ?? { name, num: false, ch: 4 };
    // The name whole first: the type only where it fits beside it.
    const fits = (name.length + 2 + (look.types?.[i]?.length ?? 0)) * CH + PAD <= colWidth(c);
    const type = fits ? look.types?.[i] : undefined;

    return h_flex().id(`${look.id}-h-${i}`).relative().flex_none().w(colWidth(c)).h(HEAD).px(8).gap(6).items_center().overflow_hidden()
      .border_r(1).border_color(t.ansi0).cursor_pointer()
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        h.sort?.(i, cx);
        cx.notify();
      })
      .child(div().flex_none().truncate().text_color(sorted ? t.accent : t.foreground).child(`${name}${sorted ? (look.sort?.desc ? " ↓" : " ↑") : ""}`))
      .when(Boolean(type), (el) => el.child(div().flex_shrink(1).min_w(0).truncate().text_color(t.dim).child(type ?? "")));
  });

  return h_flex().relative().h(HEAD).flex_none()
    .child(div().absolute().inset_0().child(dither(`${t.ansi0}99`, 1)))
    .child(div().relative().flex_none().w(gutter))
    .children(cells);
}

/** The edited cell: an input in an accent box, as wide as it needs. */
function editCell(t: Theme, look: GridLook, r: number, i: number, c: Column, ed: NonNullable<GridOverlay["editing"]>): Element {
  return div().id(`${look.id}-c-${r}-${i}`).relative().flex_none().w(Math.max(EDIT_MIN, colWidth(c))).h(ROW).px(4).flex().items_center().overflow_hidden()
    .bg(t.background).border_1().border_color(t.accent)
    .on_mouse_down("left", stop)
    .child(Input.new(ed.input).flex_1().text_size(11.2).text_color(t.foreground))
    .when(ed.isNull, (el) => el.child(div().flex_none().pl(4).text_color(t.ansi3).child("NULL")));
}

function row(t: Theme, look: GridLook, set: ResultSet, cols: readonly Column[], shown: readonly number[], gutter: number, r: number, at: GridAt, h: GridHandlers): Element {
  const cur = r === at.row;
  const data = set.rows[r] ?? [];
  const o = look.overlay;
  const ed = o?.editing?.row === r ? o.editing : null;

  const cells = shown.map((i) => {
    const c = cols[i] ?? { name: "", num: false, ch: 4 };

    if (ed?.col === i) return editCell(t, look, r, i, c, ed);

    const change = o?.change(r, i) ?? null;
    const [text, plain] = cellLook(t, change ? change.now : data[i] ?? null, c.num);
    const color = change ? t.ansi3 : plain;
    const picked = cur && i === at.col;

    return div().id(`${look.id}-c-${r}-${i}`).relative().flex_none().w(colWidth(c)).h(ROW).px(8).flex().items_center().overflow_hidden()
      .border_r(1).border_color("#1c1d1f")
      .when(c.num, (el) => el.justify_end())
      .when(change !== null, (el) => el.child(dither(`${t.ansi3}2e`, 1)).tooltip(`was: ${change?.was === null ? "NULL" : change?.was === "" ? "'' (empty)" : oneLine(change?.was ?? "")}`))
      .when(picked, (el) => el.border_1().border_color(look.active ? t.accent : t.ansi8).bg(`${t.accent}1a`))
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();

        if (e.click_count >= 2) h.open(r, i, cx);
        else h.pick(r, i, cx);

        cx.notify();
      })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        h.menu(r, i, cx);
        cx.notify();
      })
      .child(div().relative().truncate().text_color(color).child(text));
  });

  const marked = o?.marked(r) ?? false;

  return h_flex().id(`${look.id}-r-${r}`).relative().h(ROW).flex_none()
    .when(r % 2 === 1, (el) => el.bg("#0d0d0e"))
    .when(cur, (el) => el.child(div().absolute().inset_0().child(dither(`${t.ansi0}66`, 1))))
    .child(h_flex().relative().flex_none().w(gutter).pl(4).pr(8).gap(4).items_center().text_color(cur ? t.foreground : t.dim)
      .child(marked ? pip(t.ansi3, 6) : div().w(6))
      .child(div().flex_1().flex().justify_end().child(String(r + 1))))
    .children(cells);
}

/** The grid, the rows and columns in view. */
export function grid(t: Theme, look: GridLook, set: ResultSet, cols: readonly Column[], at: GridAt, h: GridHandlers): Element {
  const gutter = gutterWidth(set.rows.length);
  const fit = rowsIn(look.height);
  const n = colsIn(cols, at.left, look.width - gutter);
  const shown = Array.from({ length: Math.min(n + 1, set.columns.length - at.left) }, (_x, k) => at.left + k);
  const end = Math.min(set.rows.length, at.top + fit);
  const rows: Element[] = [];

  for (let r = at.top; r < end; r++) rows.push(row(t, look, set, cols, shown, gutter, r, at, h));

  return v_flex().id(look.id).relative().size_full().overflow_hidden().text_size(11.2)
    .on_scroll_wheel((e, cx) => {
      const dy = e.delta.y, dx = e.delta.x;
      const by = Math.abs(dy) >= Math.abs(dx) ? Math.round(-dy / ROW) || -Math.sign(dy) : 0;
      const across = Math.abs(dx) > Math.abs(dy) ? -Math.sign(dx) : 0;

      h.scroll(by, across, cx);
      cx.notify();
    })
    .child(header(t, look, set, cols, shown, gutter, h))
    .children(rows);
}

/** The view scrolled by (rows, cols), the cursor kept inside it. */
export function scrollGrid(at: GridAt, set: ResultSet, cols: readonly Column[], by: number, across: number, height: number): GridAt {
  const fit = rowsIn(height);
  const top = Math.max(0, Math.min(Math.max(0, set.rows.length - fit), at.top + by));
  const left = Math.max(0, Math.min(Math.max(0, set.columns.length - 1), at.left + across));
  const row = Math.max(top, Math.min(top + fit - 1, at.row));
  const col = Math.max(left, at.col);

  return { row: Math.min(row, Math.max(0, set.rows.length - 1)), col: Math.min(col, Math.max(0, cols.length - 1)), top, left };
}

/** The picked cell's value. */
export const cellAt = (set: ResultSet | null, at: GridAt): Cell | undefined => set?.rows[at.row]?.[at.col];

/** A row as tab-separated text (copying a row). */
export const rowText = (set: ResultSet, r: number): string => (set.rows[r] ?? []).map((v) => (v === null ? "NULL" : v)).join("\t");

/** A cell's whole value for reading: JSON pretty-printed when it is JSON. */
export function prettyValue(v: Cell): string {
  if (v === null) return "NULL";

  const s = v.trim();

  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      return v;
    }
  }

  return v;
}
