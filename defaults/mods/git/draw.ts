// Nocturne's look for the git window, copied (a mod can't import another
// mod's files): the dither fill, lazygit's panels with their titles cut into
// the 1-bit frame, the selected row's band, chips and the options bar (from
// github/kit.ts), the diff lines (diff's), and the commit
// graph drawn as dithered 2 px lines with square elbows.

import { Array as Arr, Match, Option, String as Str } from "effect";
import { div, svg, PathBuilder, Background } from "gpui-kit";
import type { ClickEvent, Color, Context, Element, MouseButtonEvent } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings, window as appWindow } from "herdr";
import * as herdr from "herdr";
import type { Theme } from "herdr";
import type { GraphRow } from "./graph.ts";
import { segments } from "./graph.ts";
import type { DiffRow } from "./patch.ts";
import { keysHint } from "@fireflies/keyhelp";
import { edge as edgeTone } from "@fireflies/tones";
import { flat } from "@fireflies/layout-look";
import { dithered, kbd, panel as card, rule, veil } from "@fireflies/look";

/** A changed line's tint: added green, removed red; none for the rest. */
function tintOf(t: Theme, kind: DiffRow["kind"]): Color | null {
  if (kind === "+") return t.ansi2;

  return kind === "-" ? t.ansi1 : null;
}

/** A diff line's text color: git's notes dim, context muted, changes bright. */
function inkOf(t: Theme, kind: DiffRow["kind"]): Color {
  if (kind === "\\") return t.dim;

  return kind === " " ? t.muted : t.foreground;
}

export const ART = "mods/nocturne/art";

export const stop = (_e: MouseButtonEvent, cx: Context) => cx.stop_propagation();

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

/** What every row of one draw shares, read from the app once per draw
 *  (drawing() runs the draw): a dithered row would otherwise ask the app for
 *  its settings, platform and layout on every row of every scroll step. */
interface Frame {
  readonly zoom: number;
  readonly dpr: number;
  readonly dithered: boolean;
}

let frame: Frame | null = null;

const readZoom = () => {
  const z = Number(settings().zoom);

  return z > 0 ? z : 1;
};

/** Runs `draw` with the app's zoom, platform and look read once for it. */
export function drawing<A>(draw: () => A): A {
  frame = { zoom: readZoom(), dpr: appWindow().platform === "macos" ? 2 : 1, dithered: flat(POPUP_SCRIM, 1) === null };

  try {
    return draw();
  } finally {
    frame = null;
  }
}

export function zoom() {
  return frame?.zoom ?? readZoom();
}

export const unzoom = (v: number) => v / zoom();

/** Whether this draw is nocturne's dithered look (read once per draw), else
 *  the plain one (herdr-app's default layout: docs/plain-look.md). */
export const isDithered = (): boolean => frame?.dithered ?? dithered();

export const unzoomSize = (size: { readonly width: number; readonly height: number }) => ({ width: unzoom(size.width), height: unzoom(size.height) });

/** A layer filling its parent with a 50% checker dither (Retina on macOS). */
export function dither(color: Color, cell = 1): Element {
  if (frame?.dithered !== true) {
    const plain = flat(color, cell);

    if (plain !== null) return plain;
  }

  const dpr = frame?.dpr ?? (appWindow().platform === "macos" ? 2 : 1);

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}

/** The dim under a popup inside the window (a menu, a confirm, a prompt):
 *  black, dithered, light enough that the window stays readable under it.
 *  Every in-window popup dims with this one (github's kit.ts too). */
export const POPUP_SCRIM: Color = "#0000008c";

/** The layer that dims the window under an in-window popup (POPUP_SCRIM). */
export function popupScrim(id: string) {
  if (!isDithered()) return veil(id);

  return div().id(id).absolute().inset_0().child(dither(POPUP_SCRIM, 1));
}

/** The graph's lane colors, by index (graph.ts LANE_COLORS). */
export const laneColors = (t: Theme): readonly Color[] => [t.ansi4, t.ansi2, t.ansi5, t.ansi6, t.ansi3, t.ansi13, t.ansi10, t.ansi12];

/** Lane `i`'s color. */
const laneColor = (t: Theme, colors: readonly Color[], i: number) => colors[i % colors.length] ?? colors[0] ?? t.muted;

/** lazygit's status letter colors: staged green, unstaged red. */
export const letterColor = (t: Theme, ch: string, staged: boolean) => (ch === " " ? t.dim : ch === "?" ? t.ansi1 : ch === "U" ? t.ansi3 : staged ? t.ansi2 : t.ansi1);

/** A color: a theme's by name, or one of its own. */
export type Ink = keyof Theme | Color;

const isOwn = (c: Ink): c is Color => Str.startsWith("#")(c);

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
  const placed = (where === "top" ? row.top(-6) : row.bottom(-6)).child(line().w(left === null ? 0 : 8).flex_none());
  const lead = left === null ? placed : placed.child(label(left).flex_shrink(1));
  const mid = lead.child(line().flex_1().min_w(8));

  return right === null ? mid : mid.child(label(right)).child(line().w(8).flex_none());
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
  // A plain layout's panel is a card (@fireflies/look).
  if (!isDithered()) return card(t, id, title, active, body, options);

  const { foot = null, right = null, onTitle = null } = options;
  const edge = active ? t.accent : edgeTone(t);
  // A long title ends in an ellipsis inside the frame, before the right chip.
  const titled = h_flex().min_w(0).gap(5).items_center().overflow_hidden().children(Arr.map(title, (el) => el.min_w(0).truncate()));
  const head = onTitle !== null ? titled.id(`${id}-title-hit`).on_mouse_down("left", (e, cx) => { cx.stop_propagation(); onTitle(e, cx); }) : titled;

  return div().id(id).relative().flex().flex_col().min_h(0).min_w(0).border_l(1).border_r(1).border_color(edge)
    .child(div().relative().flex_1().min_h(0).pt(7).pb(2).overflow_hidden().child(body))
    .child(edgeRow(t, `${id}-top`, edge, "top", head, right))
    .child(edgeRow(t, `${id}-bottom`, edge, "bottom", null, foot === null ? null : div().text_color(active ? t.accent : t.dim).child(foot)));
}

/** A selected row's band: dither with an accent edge (dimmer off focus). */
export function band(t: Theme, active: boolean) {
  // Plain: the theme's selected fill (hover's off focus), rounded, as look's lit().
  if (!isDithered()) return [div().absolute().inset_0().rounded(6).bg(active ? t.selected : t.hover)];

  return [dither(active ? edgeTone(t) : `${edgeTone(t)}88`, 1), div().absolute().left(0).top(0).bottom(0).w(2).bg(active ? t.accent : t.muted)];
}

/** A small text button; `on` gives it the dithered pressed look. */
export function chip(t: Theme, id: string, label: string | Element, on: boolean, action: (e: ClickEvent, cx: Context) => void, color?: Color | null) {
  const el = h_flex().id(id).relative().h(20).px(7).flex_none().items_center().text_size(11)
    .text_color(on ? t.foreground : color ?? t.muted).hover((s) => s.text_color(t.foreground).bg(`${edgeTone(t)}66`))
    .on_mouse_down("left", stop)
    .on_click((e, cx) => { cx.stop_propagation(); action(e, cx); cx.notify(); });

  const pressed = (): Element => (isDithered() ? el.child(dither(edgeTone(t), 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)) : el.rounded(5).bg(t.selected));

  return (on ? pressed() : el).child(div().relative().child(label));
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

    if (ctx !== null && ctx !== undefined && Str.isNonEmpty(ctx)) return el.child(div().text_size(10).text_color(t.muted).child(ctx));

    return el
      .hover((s) => s.bg(`${edgeTone(t)}66`))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { onPress?.(key, cx); cx.notify(); })
      .child(isDithered() ? div().text_color(t.accent).child(key) : kbd(t, key))
      .child(div().text_color(t.dim).child(what));
  };

  const bar = h_flex().id("git-hints").relative().h(22).flex_none().px(10).gap(12).items_center().text_size(11).overflow_hidden()
    .child(isDithered() ? div().absolute().left(0).right(0).top(0).h(2).child(dither(edgeTone(t), 1)) : rule(t, "top"))
    .children(Arr.map(list, hint("hint")))
    .child(div().flex_1())
    .children(Arr.map(ends, hint("end")));

  const noted = right === null ? bar : bar.child(right);

  // ? keys last (keyhelp.ts), as every Nocturne bar.
  return help === null ? noted : noted.child(keysHint(t, "git-help-0", false, (cx) => onPress?.(help[0], cx), help[0]));
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

  // The moon is nocturne's art: a plain layout's note is the words alone.
  const lit = small || !isDithered() ? note : note.child(svg(`${ART}/moon-${moon}.svg`).w(40).h(40).text_color(t.muted).opacity(0.6)
    .loop("opacity", { from: 0.35, to: 0.7, period: 5200 }));

  const titled = lit.child(div().text_center().text_color(small ? t.dim : t.foreground).child(title));

  return hint === null ? titled : titled.child(div().text_center().max_w(420).text_color(t.muted).child(hint));
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

  // Where a vertical segment starts: the top, the middle or the bottom.
  const yOf = (from: number): number => {
    if (from === 0) return 0;

    return from === 0.5 ? mid : h;
  };

  for (const v of s.v) {
    const y0 = yOf(v.from);
    const y1 = v.to === 0.5 ? mid + 2 : h;

    kids.push(seg(laneColor(t, colors, v.color), cx(v.lane), y0, 2, y1 - y0));
  }

  for (const x of s.h) kids.push(seg(laneColor(t, colors, x.color), cx(x.from), mid, cx(x.to) - cx(x.from) + 2, 2));

  const n = s.node, color = laneColor(t, colors, n.color);
  const size = big ? 9 : 7;
  const nx = cx(n.lane) + 1 - Math.floor(size / 2), ny = mid + 1 - Math.floor(size / 2);

  // Plain: round nodes and ring, no pixel art (the lanes stay as they are).
  const round = (el: Element, d: number): Element => (isDithered() ? el : el.rounded(d));

  if (n.merge) kids.push(round(div().absolute().left(nx).top(ny).size(size).bg(t.background).border(2).border_color(color), size));
  else if (big && isDithered()) kids.push(svg(`${ART}/pip.svg`).absolute().left(nx).top(ny).size(size).text_color(color));
  else kids.push(round(div().absolute().left(nx).top(ny).size(size).bg(color), size));

  if (head) kids.push(round(div().absolute().left(nx - 2).top(ny - 2).size(size + 4).border(1).border_color(color), size + 4));

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

  const kids = Arr.flatMap(after, (c, i) => {
    if (c == null) return [];

    const color = laneColor(t, colors, c);

    return [div().absolute().left(cx(i)).top(0).w(2).h(h).bg(`${color}99`).child(dither(color, 1))];
  });

  return div().relative().flex_none().h(h).w(width * lane + 2).children(kids);
}

/** Below the branch log's last row: the lanes still open there (the log
 *  cut at its limit) run on to the bottom of the view, laid out as the log
 *  rows are. Null when nothing is open (a root commit) or not a log row. */
export function logTail(t: Theme, row: MainRow | null | undefined, h: number) {
  if (row?.kind !== "log" || !Arr.some(row.g.after, (c) => c !== null && c !== undefined)) return null;

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
    case "comment": return t.muted;
    case "property": case "field": case "namespace": case "module": return t.ansi6;
    case "operator": case "escape": return t.ansi9;
    case "attribute": return t.ansi13;
    default: return null;
  }
}

/** herdr.highlight's spans by file and line text: a scroll step parses
 *  only the lines it brings into view, not every line in view again. Cleared
 *  whole when it grows past HIGHLIGHT_CACHE lines. */
type Spans = ReturnType<NonNullable<typeof herdr.highlight>>;

const highlights = new Map<string, Spans>();

export const HIGHLIGHT_CACHE = 20_000;

function highlighted(text: string, path: string): Spans {
  const key = `${path}\0${text}`;
  const known = highlights.get(key);

  if (known !== undefined) return known;

  // An app without herdr.highlight (or a test's stand-in) draws plain text.
  const spans = herdr.highlight?.(text, path) ?? [];

  if (highlights.size >= HIGHLIGHT_CACHE) highlights.clear();

  highlights.set(key, spans);

  return spans;
}

/** Syntax spans for a diff line's text, by the file's language: tree-sitter
 *  (herdr.highlight) in moonfly's roles, `base` between them; null for plain
 *  text (no grammar, nothing to color, a very long line). Each line is
 *  highlighted on its own: a line inside a multi-line string or comment can
 *  be colored as code. */
export function codeSpans(text: string, path: string | null | undefined, t: Theme, base: Color = t.foreground): Span[] | null {
  if (path === null || path === undefined || Str.isEmpty(path) || Str.isEmpty(text) || text.length > 2000) return null;

  const spans = highlighted(text, path);

  if (!Arr.isReadonlyArrayNonEmpty(spans)) return null;

  const color = (name: string): Color => Match.value(name).pipe(
    Match.when("variable.builtin", () => t.ansi4),
    Match.when("string.escape", () => t.ansi9),
    Match.orElse(() => roleColor(t, name) ?? roleColor(t, Option.getOrElse(Arr.head(Str.split(name, ".")), () => "")) ?? base),
  );

  const out: Span[] = [];
  let at = 0;

  for (const [s, e, name] of spans) {
    if (s > at) out.push({ text: Str.substring(at, s)(text), color: base });

    if (e > s) out.push({ text: Str.substring(s, e)(text), color: color(name) });

    at = Math.max(at, e);
  }

  if (at < text.length) out.push({ text: Str.slice(at)(text), color: base });

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
      .child(dither(edgeTone(t), 2))
      .child(div().relative().flex_none().px(4).bg(t.background).text_color(t.accent).child(compact ? Str.replace(/^@@ | @@$/g, "")(row.range) : row.range));

    return Str.isEmpty(row.text) ? head : head.child(div().relative().min_w(0).truncate().px(4).bg(t.background).text_color(t.muted).child(row.text));
  }

  if (row.kind === "file") {
    const head = h_flex().h(h).w_full().relative().items_center().px(8).gap(10).text_size(11)
      .child(dither(edgeTone(t), 2))
      .child(div().relative().flex_none().px(4).bg(t.background).text_color(t.accent).child(row.text));

    return row.sub === undefined || Str.isEmpty(row.sub) ? head : head.child(div().relative().px(4).bg(t.background).text_color(t.muted).child(row.sub));
  }

  if (row.kind === "log") {
    // The branch log (lazygit's git log --graph): the lanes, then the text.
    const graph = row.node ? graphCell(t, row.g, row.w, { lane: 10, h, head: row.head ?? false }) : graphPass(t, row.g.after, row.w, { lane: 10, h });

    return h_flex().h(h).w_full().items_center().pl(6).pr(10).gap(6).text_size(11.5).overflow_hidden()
      .child(graph)
      .child(h_flex().flex_1().min_w(0).overflow_hidden().children(Arr.map(row.parts, ([s, c], i) => div().id(`lg-${i}`).flex_none().text_color(ink(t, c)).child(s))));
  }

  if (row.kind === "text") {
    return h_flex().h(h).w_full().items_center().px(10).text_size(11).overflow_hidden()
      .children(Arr.map(row.parts, ([s, c], i) => div().id(`tx-${i}`).flex_none().text_color(ink(t, c)).child(s)));
  }

  const tint = tintOf(t, row.kind);
  const spans = row.kind === "\\" ? null : codeSpans(row.text, path, t, row.kind === " " ? t.muted : t.foreground);
  const text = div().flex_1().min_w(0).truncate().pr(8).text_color(inkOf(t, row.kind));
  const { n, o } = row;
  const line = h_flex().h(h).w_full().relative().items_center().text_size(compact ? 11.5 : 12);
  const font = code === undefined ? line : line.font_family(code);
  const tinted = tint === null ? font : font.bg(`${tint}16`);
  const picked = pick ? tinted.bg(`${active ? t.accent : t.muted}26`) : tinted;

  const numbered = picked.child(div().w(3).h_full().flex_none().relative().map((el) => (tint === null ? el : el.child(dither(tint, 1)))))
    .map((el) => (compact ? el.child(num(n ?? o, 34)) : el.child(num(o, 38)).child(num(n, 38))))
    .child(div().w(compact ? 12 : 14).flex_none().text_color(tint ?? t.dim).child(row.kind === "+" || row.kind === "-" ? row.kind : ""))
    .child(spans === null ? text.child(Str.isEmpty(row.text) ? " " : row.text) : text.child(h_flex().children(Arr.map(spans, (s, i) => div().id(`sp-${i}`).flex_none().text_color(s.color).child(s.text)))));

  return cursor
    ? numbered.child(div().absolute().left(0).top(0).bottom(0).w(2).bg(active ? t.accent : t.muted))
      .child(isDithered() ? div().absolute().inset_0().border(1).border_color(`${active ? t.accent : t.muted}aa`) : div().absolute().inset_0().border(1).border_color(`${active ? t.accent : t.muted}aa`).rounded(4))
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
export const short = (r: string): string => (/^[0-9a-f]{40}$/.test(r) ? Str.slice(0, 7)(r) : r);

/** A main-view row of one text in one ink. */
export const text = (s: string, color: Ink = "foreground"): MainRow => ({ kind: "text", parts: [[s, color]] });
