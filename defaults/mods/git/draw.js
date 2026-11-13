// Nocturne's look for the git window, copied (a mod can't import another
// mod's files): the dither fill, lazygit's panels with their titles cut into
// the 1-bit frame, the selected row's band, chips and the options bar (from
// github/kit.js), the diff lines (diff's), and the commit
// graph drawn as dithered 2 px lines with square elbows.

import { div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings, window as appWindow } from "herdr";
import * as herdr from "herdr";
import { segments } from "./graph.js";
import { keysHint } from "./keyhelp.js";

export const ART = "mods/nocturne/art";
export const stop = (_e, cx) => cx.stop_propagation();

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

export function zoom() {
  const z = Number(settings()?.zoom);
  return z > 0 ? z : 1;
}
export const unzoom = (v) => v / zoom();
export const unzoomSize = (size) => ({ width: unzoom(size.width), height: unzoom(size.height) });

/** A layer filling its parent with a 50% checker dither (Retina on macOS). */
export function dither(color, cell = 1) {
  const dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}

/** The dim under a popup inside the window (a menu, a confirm, a prompt):
 *  black, dithered, light enough that the window stays readable under it.
 *  Every in-window popup dims with this one (github's kit.js too). */
export const POPUP_SCRIM = "#0000008c";

/** The layer that dims the window under an in-window popup (POPUP_SCRIM). */
export function popupScrim(id) {
  return div().id(id).absolute().inset_0().child(dither(POPUP_SCRIM, 1));
}

/** The graph's lane colors, by index (graph.js LANE_COLORS). */
export const laneColors = (t) => [t.ansi4, t.ansi2, t.ansi5, t.ansi6, t.ansi3, t.ansi13 ?? t.ansi5, t.ansi10 ?? t.ansi2, t.ansi12 ?? t.ansi4];

/** lazygit's status letter colors: staged green, unstaged red. */
export const letterColor = (t, ch, staged) => (ch === " " ? t.dim : ch === "?" ? t.ansi1 : ch === "U" ? t.ansi3 : staged ? t.ansi2 : t.ansi1);

/** A frame's top or bottom edge with labels cut into it, lazygit's way: the
 *  1 px line runs up to a label, stops, and goes on after it, so no line is
 *  drawn behind the text at any zoom. The row is 13 px tall and centered on
 *  the frame's edge (its line lands on the edge's pixel row). `left` and
 *  `right` are the labels (elements, or null). */
export function edgeRow(t, id, edge, where, left, right) {
  const line = () => div().h(1).bg(edge);
  const label = (el) => h_flex().flex_none().min_w(0).px(4).gap(5).items_center().overflow_hidden().child(el);
  return h_flex().id(id).absolute().left(0).right(0).h(13).items_center().text_size(11)
    .when(where === "top", (el) => el.top(-6)).when(where === "bottom", (el) => el.bottom(-6))
    .child(line().w(left ? 8 : 0).flex_none())
    .when(Boolean(left), (el) => el.child(label(left).flex_shrink(1)))
    .child(line().flex_1().min_w(8))
    .when(Boolean(right), (el) => el.child(label(right)).child(line().w(8).flex_none()));
}

/** A lazygit panel: 1-bit frame, `title` (elements) cut into the top edge,
 *  accent when it has the keyboard; `right` (a chip) and `foot` cut into the
 *  top and bottom edges on the right. */
export function panel(t, id, title, active, body, { foot = null, right = null, onTitle = null } = {}) {
  const edge = active ? t.accent : t.ansi0;
  // A long title ends in an ellipsis inside the frame, before the right chip.
  const head = h_flex().min_w(0).gap(5).items_center().overflow_hidden().children(title.map((el) => el?.min_w ? el.min_w(0).truncate() : el))
    .when(Boolean(onTitle), (el) => el.id(`${id}-title-hit`).on_mouse_down("left", (e, cx) => { cx.stop_propagation(); onTitle(e, cx); }));
  return div().id(id).relative().flex().flex_col().min_h(0).min_w(0).border_l(1).border_r(1).border_color(edge)
    .child(div().relative().flex_1().min_h(0).pt(7).pb(2).overflow_hidden().child(body))
    .child(edgeRow(t, `${id}-top`, edge, "top", head, right))
    .child(edgeRow(t, `${id}-bottom`, edge, "bottom", null, foot ? div().text_color(active ? t.accent : t.dim).child(foot) : null));
}

/** A selected row's band: dither with an accent edge (dimmer off focus). */
export function band(t, active) {
  return [dither(active ? t.ansi0 : t.ansi0 + "88", 1), div().absolute().left(0).top(0).bottom(0).w(2).bg(active ? t.accent : t.ansi8)];
}

/** A small text button; `on` gives it the dithered pressed look. */
export function chip(t, id, label, on, action, color) {
  return h_flex().id(id).relative().h(20).px(7).flex_none().items_center().text_size(11)
    .text_color(on ? t.foreground : color ?? t.muted).hover((s) => s.text_color(t.foreground).bg(t.ansi0 + "66"))
    .on_mouse_down("left", stop)
    .on_click((e, cx) => { cx.stop_propagation(); action(e, cx); cx.notify(); })
    .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)))
    .child(div().relative().child(label));
}

/** The options bar: the keys that do something now (each clickable), the
 *  context's on the left; on the right `ends` (the global keys), `right`
 *  (a note, or where to go next) and, last of all, `help` (? keys). */
export function hints(t, list, right, onPress, { ends = [], help = null } = {}) {
  const hint = (id) => ([key, what, ctx], i) => h_flex().id(`git-${id}-${i}`).flex_none().gap(4)
    .when(Boolean(ctx), (el) => el.child(div().text_size(10).text_color(t.ansi8).child(ctx)))
    .when(!ctx, (el) => el
      .hover((s) => s.bg(t.ansi0 + "66"))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { onPress?.(key, cx); cx.notify(); })
      .child(div().text_color(t.accent).child(key))
      .child(div().text_color(t.dim).child(what)));
  return h_flex().id("git-hints").relative().h(22).flex_none().px(10).gap(12).items_center().text_size(11).overflow_hidden()
    .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
    .children(list.map(hint("hint")))
    .child(div().flex_1())
    .children(ends.map(hint("end")))
    .when(Boolean(right), (el) => el.child(right))
    // ? keys last (keyhelp.js), as every Nocturne bar.
    .when(Boolean(help), (el) => el.child(keysHint(t, "git-help-0", false, (cx) => onPress?.(help[0], cx), help[0])));
}

/** A quiet middle-of-the-panel note, with the moon. */
export function empty(t, title, hint, { moon = 8, small = false } = {}) {
  return v_flex().size_full().items_center().justify_center().gap(small ? 4 : 10).px(16).text_size(11)
    .when(!small, (el) => el.child(svg(`${ART}/moon-${moon}.svg`).w(40).h(40).text_color(t.ansi8).opacity(0.6)
      .loop("opacity", { from: 0.35, to: 0.7, period: 5200 })))
    .child(div().text_center().text_color(small ? t.dim : t.foreground).child(title))
    .when(Boolean(hint), (el) => el.child(div().text_center().max_w(420).text_color(t.ansi8).child(hint)));
}

/** One row of the commit graph: `lane` px per lane, `h` px tall. Lines are
 *  2 px: a solid core in the lane color at 70%, dithered over it, so they
 *  read like lazygit's box lines and still look Nocturne. `head`: HEAD's
 *  node gets a ring. `dimFrom`: lanes past this index are quieter. */
export function graphCell(t, row, width, { lane = 12, h = 18, head = false, big = false } = {}) {
  const colors = laneColors(t);
  const s = segments(row);
  const cx = (i) => i * lane + Math.floor(lane / 2) - 1;
  const mid = Math.floor(h / 2) - 1;
  const seg = (color, x, y, w, hh) => div().absolute().left(x).top(y).w(Math.max(2, w)).h(Math.max(2, hh)).bg(color + "99").child(dither(color, 1));
  const kids = [];
  for (const v of s.v) {
    const y0 = v.from === 0 ? 0 : v.from === 0.5 ? mid : h;
    const y1 = v.to === 0.5 ? mid + 2 : h;
    kids.push(seg(colors[v.color], cx(v.lane), y0, 2, y1 - y0));
  }
  for (const x of s.h) kids.push(seg(colors[x.color], cx(x.from), mid, cx(x.to) - cx(x.from) + 2, 2));
  const n = s.node, color = colors[n.color];
  const size = big ? 9 : 7;
  const nx = cx(n.lane) + 1 - Math.floor(size / 2), ny = mid + 1 - Math.floor(size / 2);
  if (n.merge) kids.push(div().absolute().left(nx).top(ny).size(size).bg(t.background).border(2).border_color(color));
  else kids.push(big ? svg(`${ART}/pip.svg`).absolute().left(nx).top(ny).size(size).text_color(color) : div().absolute().left(nx).top(ny).size(size).bg(color));
  if (head) kids.push(div().absolute().left(nx - 2).top(ny - 2).size(size + 4).border(1).border_color(color));
  return div().relative().flex_none().h(h).w(width * lane + 2).children(kids);
}

/** The lanes running past a commit's other rows (its author, date and
 *  message in the branch log): `after` (a graph row's after) as straight
 *  lines through the whole row, in the same colors and places as graphCell. */
export function graphPass(t, after, width, { lane = 12, h = 18 } = {}) {
  const colors = laneColors(t);
  const cx = (i) => i * lane + Math.floor(lane / 2) - 1;
  const kids = (after ?? []).flatMap((c, i) => (c == null ? [] : [div().absolute().left(cx(i)).top(0).w(2).h(h).bg(colors[c] + "99").child(dither(colors[c], 1))]));
  return div().relative().flex_none().h(h).w(width * lane + 2).children(kids);
}

/** Below the branch log's last row: the lanes still open there (the log
 *  cut at its limit) run on to the bottom of the view, laid out as the log
 *  rows are. Null when nothing is open (a root commit) or not a log row. */
export function logTail(t, row, h) {
  if (row?.kind !== "log" || !(row.g?.after ?? []).some((c) => c != null)) return null;
  return h_flex().id("log-tail").flex_1().min_h(0).w_full().items_start().pl(6).overflow_hidden()
    .child(graphPass(t, row.g.after, row.w, { lane: 10, h }));
}

/** Syntax spans for a diff line's text, by the file's language: tree-sitter
 *  (herdr.highlight) in moonfly's roles, `base` between them; null for plain
 *  text (no grammar, nothing to color, a very long line). Each line is
 *  highlighted on its own: a line inside a multi-line string or comment can
 *  be colored as code. */
export function codeSpans(text, path, t, base = t.foreground) {
  if (!path || !text || text.length > 2000) return null;
  // An app without herdr.highlight (or a test's stand-in) draws plain text.
  const spans = herdr.highlight?.(text, path) ?? [];
  if (!spans.length) return null;
  const role = { keyword: t.ansi5, function: t.ansi12, type: t.ansi10, constructor: t.ansi10, tag: t.ansi10, string: t.ansi11,
    character: t.ansi11, number: t.ansi3, float: t.ansi3, boolean: t.ansi3, constant: t.ansi3, comment: t.ansi8, property: t.ansi6,
    field: t.ansi6, operator: t.ansi9, attribute: t.ansi13, namespace: t.ansi6, module: t.ansi6, label: t.ansi3, escape: t.ansi9 };
  const color = (name) => (name === "variable.builtin" ? t.ansi4 : name === "string.escape" ? t.ansi9 : role[name] ?? role[name.split(".")[0]] ?? base);
  const out = [];
  let at = 0;
  for (const [s, e, name] of spans) {
    if (s > at) out.push({ text: text.slice(at, s), color: base });
    if (e > s) out.push({ text: text.slice(s, e), color: color(name) });
    at = Math.max(at, e);
  }
  if (at < text.length) out.push({ text: text.slice(at), color: base });
  return out;
}

/** One diff row in the main view (diff's look): a dithered bar for
 *  + and -, old and new numbers (one column when compact), the text. `pick`:
 *  in the staging selection; `cursor`: the line the selection moves. */
export function diffLine(t, row, { code, compact = false, pick = false, cursor = false, active = true, path = null, h = 18 } = {}) {
  const num = (n, w) => div().w(w).flex_none().text_right().pr(6).text_color(t.dim).child(n == null ? "" : String(n));
  if (row.kind === "@") {
    return h_flex().h(h).w_full().relative().items_center().px(8).gap(10).text_size(11).overflow_hidden()
      .child(dither(t.ansi0, 2))
      .child(div().relative().flex_none().px(4).bg(t.background).text_color(t.accent).child(compact ? row.range.replace(/^@@ | @@$/g, "") : row.range))
      .when(Boolean(row.text), (el) => el.child(div().relative().min_w(0).truncate().px(4).bg(t.background).text_color(t.muted).child(row.text)));
  }
  if (row.kind === "file") {
    return h_flex().h(h).w_full().relative().items_center().px(8).gap(10).text_size(11)
      .child(dither(t.ansi0, 2))
      .child(div().relative().flex_none().px(4).bg(t.background).text_color(t.accent).child(row.text))
      .when(Boolean(row.sub), (el) => el.child(div().relative().px(4).bg(t.background).text_color(t.muted).child(row.sub)));
  }
  if (row.kind === "log") {
    // The branch log (lazygit's git log --graph): the lanes, then the text.
    const graph = row.node ? graphCell(t, row.g, row.w, { lane: 10, h, head: row.head }) : graphPass(t, row.g.after, row.w, { lane: 10, h });
    return h_flex().h(h).w_full().items_center().pl(6).pr(10).gap(6).text_size(11.5).overflow_hidden()
      .child(graph)
      .child(h_flex().flex_1().min_w(0).overflow_hidden().children((row.parts ?? []).map(([s, c], i) => div().id(`lg-${i}`).flex_none().text_color(t[c] ?? c).child(s))));
  }
  if (row.kind === "text") {
    return h_flex().h(h).w_full().items_center().px(10).text_size(11).overflow_hidden()
      .children((row.parts ?? [[row.text, "foreground"]]).map(([s, c], i) => div().id(`tx-${i}`).flex_none().text_color(t[c] ?? c).child(s)));
  }
  const tint = row.kind === "+" ? t.ansi2 : row.kind === "-" ? t.ansi1 : null;
  const spans = row.kind === "\\" ? null : codeSpans(row.text, path, t, row.kind === " " ? t.muted : t.foreground);
  const text = div().flex_1().min_w(0).truncate().pr(8).text_color(row.kind === "\\" ? t.dim : row.kind === " " ? t.muted : t.foreground);
  return h_flex().h(h).w_full().relative().items_center().font_family(code).text_size(compact ? 11.5 : 12)
    .when(Boolean(tint), (el) => el.bg(tint + "16"))
    .when(pick, (el) => el.bg((active ? t.accent : t.ansi8) + "26"))
    .child(div().w(3).h_full().flex_none().relative().when(Boolean(tint), (el) => el.child(dither(tint, 1))))
    .when(compact, (el) => el.child(num(row.n ?? row.o, 34)))
    .when(!compact, (el) => el.child(num(row.o, 38)).child(num(row.n, 38)))
    .child(div().w(compact ? 12 : 14).flex_none().text_color(tint ?? t.dim).child(row.kind === "+" || row.kind === "-" ? row.kind : ""))
    .child(spans ? text.child(h_flex().children(spans.map((s, i) => div().id(`sp-${i}`).flex_none().text_color(s.color).child(s.text)))) : text.child(row.text || " "))
    .when(cursor, (el) => el.child(div().absolute().left(0).top(0).bottom(0).w(2).bg(active ? t.accent : t.ansi8))
      .child(div().absolute().inset_0().border(1).border_color((active ? t.accent : t.ansi8) + "aa")));
}
