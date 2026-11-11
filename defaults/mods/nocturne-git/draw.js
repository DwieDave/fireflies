// Nocturne's look for the git window, copied (a mod can't import another
// mod's files): the dither fill, lazygit's panels with their titles cut into
// the 1-bit frame, the selected row's band, chips and the options bar (from
// nocturne-github/kit.js), the diff lines (nocturne-diff's), and the commit
// graph drawn as dithered 2 px lines with square elbows.

import { div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings, window as appWindow } from "herdr";
import { segments } from "./graph.js";

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

/** The graph's lane colors, by index (graph.js LANE_COLORS). */
export const laneColors = (t) => [t.ansi4, t.ansi2, t.ansi5, t.ansi6, t.ansi3, t.ansi13 ?? t.ansi5, t.ansi10 ?? t.ansi2, t.ansi12 ?? t.ansi4];

/** lazygit's status letter colors: staged green, unstaged red. */
export const letterColor = (t, ch, staged) => (ch === " " ? t.dim : ch === "?" ? t.ansi1 : ch === "U" ? t.ansi3 : staged ? t.ansi2 : t.ansi1);

/** A lazygit panel: 1-bit frame, `title` (elements) cut into the top edge,
 *  accent when it has the keyboard; `foot` cut into the bottom edge. */
export function panel(t, id, title, active, body, { foot = null, right = null, onTitle = null } = {}) {
  const edge = active ? t.accent : t.ansi0;
  return div().id(id).relative().flex().flex_col().min_h(0).min_w(0).border(1).border_color(edge)
    .child(div().relative().flex_1().min_h(0).pt(7).pb(2).overflow_hidden().child(body))
    .child(h_flex().id(`${id}-title`).absolute().top(-7).left(8).right(8).h(13).gap(6).items_center().text_size(11)
      .child(h_flex().px(4).gap(5).bg(t.background).items_center().children(title)
        .when(Boolean(onTitle), (el) => el.id(`${id}-title-hit`).on_mouse_down("left", (e, cx) => { cx.stop_propagation(); onTitle(e, cx); })))
      .child(div().flex_1())
      .when(Boolean(right), (el) => el.child(h_flex().px(4).bg(t.background).items_center().gap(4).child(right))))
    .when(Boolean(foot), (el) => el.child(div().absolute().right(8).bottom(-7).px(4).bg(t.background).text_size(11).text_color(active ? t.accent : t.dim).child(foot)));
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

/** The options bar: the keys that do something now (each clickable). */
export function hints(t, list, right, onPress) {
  return h_flex().id("git-hints").relative().h(22).flex_none().px(10).gap(12).items_center().text_size(11).overflow_hidden()
    .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
    .children(list.map(([key, what, ctx], i) => h_flex().id(`git-hint-${i}`).flex_none().gap(4)
      .when(Boolean(ctx), (el) => el.child(div().text_size(10).text_color(t.ansi8).child(ctx)))
      .when(!ctx, (el) => el
        .hover((s) => s.bg(t.ansi0 + "66"))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { onPress?.(key, cx); cx.notify(); })
        .child(div().text_color(t.accent).child(key))
        .child(div().text_color(t.dim).child(what)))))
    .child(div().flex_1())
    .when(Boolean(right), (el) => el.child(right));
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

/** Syntax spans for a diff line's text: null today (plain text). The editor
 *  branch's herdr.highlight(text, lang) plugs in here and nowhere else:
 *  return [{ text, color }] and diffLine draws them. */
export function codeSpans(_text, _path, _t) {
  return null;
}

/** One diff row in the main view (nocturne-diff's look): a dithered bar for
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
  if (row.kind === "text") {
    return h_flex().h(h).w_full().items_center().px(10).text_size(11).overflow_hidden()
      .children((row.parts ?? [[row.text, "foreground"]]).map(([s, c], i) => div().id(`tx-${i}`).flex_none().text_color(t[c] ?? c).child(s)));
  }
  const tint = row.kind === "+" ? t.ansi2 : row.kind === "-" ? t.ansi1 : null;
  const spans = row.kind === "\\" ? null : codeSpans(row.text, path, t);
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
