// Nocturne's look for the git window, copied (a mod can't import another
// mod's files): the dither fill, lazygit's panels with their titles cut into
// the 1-bit frame, the selected row's band, chips and the options bar (from
// github/kit.ts), the diff lines (diff's), and the commit
// graph drawn as dithered 2 px lines with square elbows.

import { div, svg, PathBuilder, Background } from "gpui-kit";
import type { ClickEvent, Color, Context, Element, MouseButtonEvent } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings, window as appWindow } from "herdr";
import * as herdr from "herdr";
import type { Theme } from "herdr";
import type { GraphRow } from "./graph.ts";
import { segments } from "./graph.ts";
import type { DiffRow } from "./patch.ts";
import { keysHint } from "./keyhelp.ts";

export const ART = "mods/nocturne/art";

export const stop = (_e: MouseButtonEvent, cx: Context) => cx.stop_propagation();

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

export function zoom() {
  const z = Number(settings().zoom);

  return z > 0 ? z : 1;
}

export const unzoom = (v: number) => v / zoom();

export const unzoomSize = (size: { readonly width: number; readonly height: number }) => ({ width: unzoom(size.width), height: unzoom(size.height) });

/** A layer filling its parent with a 50% checker dither (Retina on macOS). */
export function dither(color: Color, cell = 1): Element {
  const dpr = appWindow().platform === "macos" ? 2 : 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}

/** The dim under a popup inside the window (a menu, a confirm, a prompt):
 *  black, dithered, light enough that the window stays readable under it.
 *  Every in-window popup dims with this one (github's kit.ts too). */
export const POPUP_SCRIM: Color = "#0000008c";

/** The layer that dims the window under an in-window popup (POPUP_SCRIM). */
export function popupScrim(id: string) {
  return div().id(id).absolute().inset_0().child(dither(POPUP_SCRIM, 1));
}

/** The graph's lane colors, by index (graph.ts LANE_COLORS). */
export const laneColors = (t: Theme): readonly Color[] => [t.ansi4, t.ansi2, t.ansi5, t.ansi6, t.ansi3, t.ansi13, t.ansi10, t.ansi12];

/** Lane `i`'s color. */
const laneColor = (colors: readonly Color[], i: number) => colors[i % colors.length] ?? colors[0] ?? "#808080";

/** lazygit's status letter colors: staged green, unstaged red. */
export const letterColor = (t: Theme, ch: string, staged: boolean) => (ch === " " ? t.dim : ch === "?" ? t.ansi1 : ch === "U" ? t.ansi3 : staged ? t.ansi2 : t.ansi1);

/** A color: a theme's by name, or one of its own. */
export type Ink = keyof Theme | Color;

const isOwn = (c: Ink): c is Color => c.startsWith("#");

/** `c` in theme `t`. */
export const ink = (t: Theme, c: Ink): Color => (isOwn(c) ? c : t[c]);

/** A run of text in a color (a log or text row's parts). */
export type Part = readonly [text: string, ink: Ink];

/** A row of the main view: a diff's row (its file's `path` for the colors),
 *  a file's head, a branch log's row (its graph row `g`, `w` lanes wide;
 *  `node`: the commit's own line), or text in parts. */
export type MainRow =
  | (DiffRow & { readonly path?: string })
  | { readonly kind: "file"; readonly text: string; readonly sub?: string }
  | { readonly kind: "log"; readonly g: GraphRow; readonly w: number; readonly node: boolean; readonly head?: boolean; readonly parts: readonly Part[] }
  | { readonly kind: "text"; readonly parts: readonly Part[] };

/** A frame's top or bottom edge with labels cut into it, lazygit's way: the
 *  1 px line runs up to a label, stops, and goes on after it, so no line is
 *  drawn behind the text at any zoom. The row is 13 px tall and centered on
 *  the frame's edge (its line lands on the edge's pixel row). `left` and
 *  `right` are the labels (elements, or null). */
export function edgeRow(_t: Theme, id: string, edge: Color, where: "top" | "bottom", left: Element | null, right: Element | null) {
  const line = () => div().h(1).bg(edge);
  const label = (el: Element) => h_flex().flex_none().min_w(0).px(4).gap(5).items_center().overflow_hidden().child(el);
  const row = h_flex().id(id).absolute().left(0).right(0).h(13).items_center().text_size(11);
  const placed = (where === "top" ? row.top(-6) : row.bottom(-6)).child(line().w(left ? 8 : 0).flex_none());
  const lead = left ? placed.child(label(left).flex_shrink(1)) : placed;
  const mid = lead.child(line().flex_1().min_w(8));

  return right ? mid.child(label(right)).child(line().w(8).flex_none()) : mid;
}

/** A panel's extras: `foot` and `right` cut into its bottom and top edges, a press on its title. */
export interface PanelOptions {
  readonly foot?: string | null;
  readonly right?: Element | null;
  readonly onTitle?: ((e: MouseButtonEvent, cx: Context) => void) | null;
}

/** A lazygit panel: 1-bit frame, `title` (elements) cut into the top edge,
 *  accent when it has the keyboard; `right` (a chip) and `foot` cut into the
 *  top and bottom edges on the right. */
export function panel(t: Theme, id: string, title: readonly Element[], active: boolean, body: Element, options: PanelOptions = {}) {
  const { foot = null, right = null, onTitle = null } = options;
  const edge = active ? t.accent : t.ansi0;
  // A long title ends in an ellipsis inside the frame, before the right chip.
  const titled = h_flex().min_w(0).gap(5).items_center().overflow_hidden().children(title.map((el) => el.min_w(0).truncate()));
  const head = onTitle ? titled.id(`${id}-title-hit`).on_mouse_down("left", (e, cx) => { cx.stop_propagation(); onTitle(e, cx); }) : titled;

  return div().id(id).relative().flex().flex_col().min_h(0).min_w(0).border_l(1).border_r(1).border_color(edge)
    .child(div().relative().flex_1().min_h(0).pt(7).pb(2).overflow_hidden().child(body))
    .child(edgeRow(t, `${id}-top`, edge, "top", head, right))
    .child(edgeRow(t, `${id}-bottom`, edge, "bottom", null, foot ? div().text_color(active ? t.accent : t.dim).child(foot) : null));
}

/** A selected row's band: dither with an accent edge (dimmer off focus). */
export function band(t: Theme, active: boolean) {
  return [dither(active ? t.ansi0 : `${t.ansi0}88`, 1), div().absolute().left(0).top(0).bottom(0).w(2).bg(active ? t.accent : t.ansi8)];
}

/** A small text button; `on` gives it the dithered pressed look. */
export function chip(t: Theme, id: string, label: string | Element, on: boolean, action: (e: ClickEvent, cx: Context) => void, color?: Color | null) {
  const el = h_flex().id(id).relative().h(20).px(7).flex_none().items_center().text_size(11)
    .text_color(on ? t.foreground : color ?? t.muted).hover((s) => s.text_color(t.foreground).bg(`${t.ansi0}66`))
    .on_mouse_down("left", stop)
    .on_click((e, cx) => { cx.stop_propagation(); action(e, cx); cx.notify(); });

  return (on ? el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)) : el)
    .child(div().relative().child(label));
}

/** One entry of the options bar: [key, what it does] or, with a third item, a context's quiet name. */
export type Hint = readonly [key: string, what: string, ctx?: string | null];

/** The bar's right end: the global keys, and the keys entry (help[0] the key). */
export interface HintsOptions {
  readonly ends?: readonly Hint[];
  readonly help?: Hint | null;
}

/** The options bar: the keys that do something now (each clickable), the
 *  context's on the left; on the right `ends` (the global keys), `right`
 *  (a note, or where to go next) and, last of all, `help` (? keys). */
export function hints(t: Theme, list: readonly Hint[], right: Element | null, onPress: ((key: string, cx: Context) => void) | null, options: HintsOptions = {}) {
  const { ends = [], help = null } = options;

  const hint = (id: string) => ([key, what, ctx]: Hint, i: number) => {
    const el = h_flex().id(`git-${id}-${i}`).flex_none().gap(4);

    if (ctx) return el.child(div().text_size(10).text_color(t.ansi8).child(ctx));

    return el
      .hover((s) => s.bg(`${t.ansi0}66`))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { onPress?.(key, cx); cx.notify(); })
      .child(div().text_color(t.accent).child(key))
      .child(div().text_color(t.dim).child(what));
  };

  const bar = h_flex().id("git-hints").relative().h(22).flex_none().px(10).gap(12).items_center().text_size(11).overflow_hidden()
    .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
    .children(list.map(hint("hint")))
    .child(div().flex_1())
    .children(ends.map(hint("end")));

  const noted = right ? bar.child(right) : bar;

  // ? keys last (keyhelp.ts), as every Nocturne bar.
  return help ? noted.child(keysHint(t, "git-help-0", false, (cx) => onPress?.(help[0], cx), help[0])) : noted;
}

/** The note's moon and size. */
export interface EmptyOptions {
  readonly moon?: number;
  readonly small?: boolean;
}

/** A quiet middle-of-the-panel note, with the moon. */
export function empty(t: Theme, title: string, hint: string | null = null, options: EmptyOptions = {}) {
  const { moon = 8, small = false } = options;
  const note = v_flex().size_full().items_center().justify_center().gap(small ? 4 : 10).px(16).text_size(11);

  const lit = small ? note : note.child(svg(`${ART}/moon-${moon}.svg`).w(40).h(40).text_color(t.ansi8).opacity(0.6)
    .loop("opacity", { from: 0.35, to: 0.7, period: 5200 }));

  const titled = lit.child(div().text_center().text_color(small ? t.dim : t.foreground).child(title));

  return hint ? titled.child(div().text_center().max_w(420).text_color(t.ansi8).child(hint)) : titled;
}

/** A graph cell's size: `lane` px per lane, `h` px tall; `head` rings HEAD's node, `big` a larger node. */
export interface CellOptions {
  readonly lane?: number;
  readonly h?: number;
  readonly head?: boolean;
  readonly big?: boolean;
}

/** One row of the commit graph: `lane` px per lane, `h` px tall. Lines are
 *  2 px: a solid core in the lane color at 70%, dithered over it, so they
 *  read like lazygit's box lines and still look Nocturne. `head`: HEAD's
 *  node gets a ring. */
export function graphCell(t: Theme, row: GraphRow, width: number, options: CellOptions = {}) {
  const { lane = 12, h = 18, head = false, big = false } = options;
  const colors = laneColors(t);
  const s = segments(row);
  const cx = (i: number) => i * lane + Math.floor(lane / 2) - 1;
  const mid = Math.floor(h / 2) - 1;
  const seg = (color: Color, x: number, y: number, w: number, hh: number) => div().absolute().left(x).top(y).w(Math.max(2, w)).h(Math.max(2, hh)).bg(`${color}99`).child(dither(color, 1));
  const kids: Element[] = [];

  for (const v of s.v) {
    const y0 = v.from === 0 ? 0 : v.from === 0.5 ? mid : h;
    const y1 = v.to === 0.5 ? mid + 2 : h;

    kids.push(seg(laneColor(colors, v.color), cx(v.lane), y0, 2, y1 - y0));
  }

  for (const x of s.h) kids.push(seg(laneColor(colors, x.color), cx(x.from), mid, cx(x.to) - cx(x.from) + 2, 2));

  const n = s.node, color = laneColor(colors, n.color);
  const size = big ? 9 : 7;
  const nx = cx(n.lane) + 1 - Math.floor(size / 2), ny = mid + 1 - Math.floor(size / 2);

  if (n.merge) kids.push(div().absolute().left(nx).top(ny).size(size).bg(t.background).border(2).border_color(color));
  else kids.push(big ? svg(`${ART}/pip.svg`).absolute().left(nx).top(ny).size(size).text_color(color) : div().absolute().left(nx).top(ny).size(size).bg(color));

  if (head) kids.push(div().absolute().left(nx - 2).top(ny - 2).size(size + 4).border(1).border_color(color));

  return div().relative().flex_none().h(h).w(width * lane + 2).children(kids);
}

/** A pass's size: `lane` px per lane, `h` px tall. */
export interface PassOptions {
  readonly lane?: number;
  readonly h?: number;
}

/** The lanes running past a commit's other rows (its author, date and
 *  message in the branch log): `after` (a graph row's after) as straight
 *  lines through the whole row, in the same colors and places as graphCell. */
export function graphPass(t: Theme, after: readonly (number | null)[], width: number, options: PassOptions = {}) {
  const { lane = 12, h = 18 } = options;
  const colors = laneColors(t);
  const cx = (i: number) => i * lane + Math.floor(lane / 2) - 1;

  const kids = after.flatMap((c, i) => {
    if (c == null) return [];

    const color = laneColor(colors, c);

    return [div().absolute().left(cx(i)).top(0).w(2).h(h).bg(`${color}99`).child(dither(color, 1))];
  });

  return div().relative().flex_none().h(h).w(width * lane + 2).children(kids);
}

/** Below the branch log's last row: the lanes still open there (the log
 *  cut at its limit) run on to the bottom of the view, laid out as the log
 *  rows are. Null when nothing is open (a root commit) or not a log row. */
export function logTail(t: Theme, row: MainRow | null | undefined, h: number) {
  if (row?.kind !== "log" || !row.g.after.some((c) => c != null)) return null;

  return h_flex().id("log-tail").flex_1().min_h(0).w_full().items_start().pl(6).overflow_hidden()
    .child(graphPass(t, row.g.after, row.w, { lane: 10, h }));
}

/** A run of a diff line's text in its syntax color. */
export interface Span {
  readonly text: string;
  readonly color: Color;
}

/** The theme's color for a syntax role (moonfly's), or null for none. */
function roleColor(t: Theme, role: string): Color | null {
  switch (role) {
    case "keyword": return t.ansi5;
    case "function": return t.ansi12;
    case "type": case "constructor": case "tag": return t.ansi10;
    case "string": case "character": return t.ansi11;
    case "number": case "float": case "boolean": case "constant": case "label": return t.ansi3;
    case "comment": return t.ansi8;
    case "property": case "field": case "namespace": case "module": return t.ansi6;
    case "operator": case "escape": return t.ansi9;
    case "attribute": return t.ansi13;
    default: return null;
  }
}

/** Syntax spans for a diff line's text, by the file's language: tree-sitter
 *  (herdr.highlight) in moonfly's roles, `base` between them; null for plain
 *  text (no grammar, nothing to color, a very long line). Each line is
 *  highlighted on its own: a line inside a multi-line string or comment can
 *  be colored as code. */
export function codeSpans(text: string, path: string | null | undefined, t: Theme, base: Color = t.foreground): Span[] | null {
  if (!path || !text || text.length > 2000) return null;

  // An app without herdr.highlight (or a test's stand-in) draws plain text.
  const spans = herdr.highlight?.(text, path) ?? [];

  if (!spans.length) return null;

  const color = (name: string) => (name === "variable.builtin" ? t.ansi4 : name === "string.escape" ? t.ansi9 : roleColor(t, name) ?? roleColor(t, name.split(".")[0] ?? "") ?? base);
  const out: Span[] = [];
  let at = 0;

  for (const [s, e, name] of spans) {
    if (s > at) out.push({ text: text.slice(at, s), color: base });

    if (e > s) out.push({ text: text.slice(s, e), color: color(name) });

    at = Math.max(at, e);
  }

  if (at < text.length) out.push({ text: text.slice(at), color: base });

  return out;
}

/** How a diff row draws: the code font, one number column (`compact`), in
 *  the staging selection (`pick`), the selection's moving line (`cursor`),
 *  the view having the keyboard (`active`), its file (for the colors), its height. */
export interface LineOptions {
  readonly code?: string;
  readonly compact?: boolean;
  readonly pick?: boolean;
  readonly cursor?: boolean;
  readonly active?: boolean;
  readonly path?: string | null;
  readonly h?: number;
}

/** One diff row in the main view (diff's look): a dithered bar for
 *  + and -, old and new numbers (one column when compact), the text. `pick`:
 *  in the staging selection; `cursor`: the line the selection moves. */
export function diffLine(t: Theme, row: MainRow, options: LineOptions = {}) {
  const { code, compact = false, pick = false, cursor = false, active = true, path = null, h = 18 } = options;
  const num = (n: number | undefined, w: number) => div().w(w).flex_none().text_right().pr(6).text_color(t.dim).child(n === undefined ? "" : String(n));

  if (row.kind === "@") {
    const head = h_flex().h(h).w_full().relative().items_center().px(8).gap(10).text_size(11).overflow_hidden()
      .child(dither(t.ansi0, 2))
      .child(div().relative().flex_none().px(4).bg(t.background).text_color(t.accent).child(compact ? row.range.replace(/^@@ | @@$/g, "") : row.range));

    return row.text ? head.child(div().relative().min_w(0).truncate().px(4).bg(t.background).text_color(t.muted).child(row.text)) : head;
  }

  if (row.kind === "file") {
    const head = h_flex().h(h).w_full().relative().items_center().px(8).gap(10).text_size(11)
      .child(dither(t.ansi0, 2))
      .child(div().relative().flex_none().px(4).bg(t.background).text_color(t.accent).child(row.text));

    return row.sub ? head.child(div().relative().px(4).bg(t.background).text_color(t.muted).child(row.sub)) : head;
  }

  if (row.kind === "log") {
    // The branch log (lazygit's git log --graph): the lanes, then the text.
    const graph = row.node ? graphCell(t, row.g, row.w, { lane: 10, h, head: row.head ?? false }) : graphPass(t, row.g.after, row.w, { lane: 10, h });

    return h_flex().h(h).w_full().items_center().pl(6).pr(10).gap(6).text_size(11.5).overflow_hidden()
      .child(graph)
      .child(h_flex().flex_1().min_w(0).overflow_hidden().children(row.parts.map(([s, c], i) => div().id(`lg-${i}`).flex_none().text_color(ink(t, c)).child(s))));
  }

  if (row.kind === "text") {
    return h_flex().h(h).w_full().items_center().px(10).text_size(11).overflow_hidden()
      .children(row.parts.map(([s, c], i) => div().id(`tx-${i}`).flex_none().text_color(ink(t, c)).child(s)));
  }

  const tint = row.kind === "+" ? t.ansi2 : row.kind === "-" ? t.ansi1 : null;
  const spans = row.kind === "\\" ? null : codeSpans(row.text, path, t, row.kind === " " ? t.muted : t.foreground);
  const text = div().flex_1().min_w(0).truncate().pr(8).text_color(row.kind === "\\" ? t.dim : row.kind === " " ? t.muted : t.foreground);
  const { n, o } = row;
  const line = h_flex().h(h).w_full().relative().items_center().text_size(compact ? 11.5 : 12);
  const font = code === undefined ? line : line.font_family(code);
  const tinted = tint ? font.bg(`${tint}16`) : font;
  const picked = pick ? tinted.bg(`${active ? t.accent : t.ansi8}26`) : tinted;

  const numbered = picked.child(div().w(3).h_full().flex_none().relative().when(tint !== null, (el) => (tint ? el.child(dither(tint, 1)) : el)))
    .map((el) => (compact ? el.child(num(n ?? o, 34)) : el.child(num(o, 38)).child(num(n, 38))))
    .child(div().w(compact ? 12 : 14).flex_none().text_color(tint ?? t.dim).child(row.kind === "+" || row.kind === "-" ? row.kind : ""))
    .child(spans ? text.child(h_flex().children(spans.map((s, i) => div().id(`sp-${i}`).flex_none().text_color(s.color).child(s.text)))) : text.child(row.text || " "));

  return cursor
    ? numbered.child(div().absolute().left(0).top(0).bottom(0).w(2).bg(active ? t.accent : t.ansi8))
      .child(div().absolute().inset_0().border(1).border_color(`${active ? t.accent : t.ansi8}aa`))
    : numbered;
}

/** The rows a windowed list draws: `vis` whole rows fit `px` (its height in
 *  layout units: the measured window px over the zoom, draw.ts unzoom), and
 *  `top` is clamped so the last row ends inside the list, never under its
 *  edge. Shared by the side lists and the main view. */
export function rowWindow(n: number, top: number, px: number, rowH: number) {
  const vis = Math.max(1, Math.floor(px / rowH));

  return { vis, top: Math.max(0, Math.min(top, Math.max(0, n - vis))) };
}

/** A busy row's mark, over the row (it keeps its width): a dithered sweep
 *  running through it and the command log's spinner at its right end. */
export function busyMark(t: Theme, id: string) {
  return [
    div().absolute().top(0).bottom(0).w(40).opacity(0.45).child(dither(t.working, 1)).loop("left", { from: -40, to: 360, period: 1600, easing: "linear" }),
    h_flex().id(id).absolute().top(0).bottom(0).right(0).w(22).items_center().justify_center().bg(t.background).text_size(11)
      .child(div().text_color(t.working).frames(["░", "▒", "▓", "█", "▓", "▒"], 120)),
  ];
}

/** A commit hash as shown: its first seven. */
export const short = (r: string) => (/^[0-9a-f]{40}$/.test(r) ? r.slice(0, 7) : r);

/** A main-view row of one text in one ink. */
export const text = (s: string, color: Ink = "foreground"): MainRow => ({ kind: "text", parts: [[s, color]] });
