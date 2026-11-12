// Nocturne's one key help: the "? keys" entry that ends a bar and the keys
// overview ? opens, the same in every Nocturne pane, panel and window.
//
// This file is the source. A mod can't import another mod's files, so every
// nocturne mod that lists its keys carries a byte-identical copy (its
// keyhelp.js); scripts/keyhelp.test.ts fails when a copy drifts. Change it
// here, then copy it: for m in defaults/mods/nocturne-*/keyhelp.js; do cp
// defaults/mods/nocturne/keyhelp.js "$m"; done
//
//   hint(t, id, key, what)       a bar entry: the key in the accent, what it does dimmed
//   keysHint(t, id, on, toggle, key)  the bar's last entry, "? keys": bright while
//                                the overview is open; a click opens or closes it
//                                (`key`: what opens it where ? types, "cmd-k ?")
//   hintBar(t, id, list, opts)   a bar of entries: 22 px, a dithered rule on its
//                                top, `opts.right` (a note) right-aligned, "? keys" last
//   keysView(t, opts)            the overview, over the host's body (absolute,
//                                opaque): KEYS and a title, then each section's
//                                keys in an aligned column, sections side by side
//                                as the width allows, one under the other when
//                                narrow; long words wrap, never clip
//   keysKey(e, open)             what a key does to it: "toggle" (?), "close"
//                                (esc or q while open), else null
//   keysHeight(list, width)      its height in a host that size, one column (a dialog's)
//
// Lists are [[key, what], ...] or sections [{ title, keys: [[key, what], ...] }].
// Rows may carry `go` (git's runnable rows): `opts.cursor` marks one, a press runs it.

import { div, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings, window as appWindow } from "herdr";

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
/** The dither fill, as nocturne/kit.js has it. */
function dither(color, cell = 1) {
  const zoom = Number(settings()?.zoom) || 1, dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}
const stop = (_e, cx) => cx.stop_propagation();

// A section's column at its widest (layout px), and the key column's bounds:
// Departure Mono at 11 px is 7 px a character.
export const SECTION = 300;
const CHAR = 7, KEY_MIN = 48, KEY_MAX = 140;

/** A bar entry: `key` in the accent, `what` dimmed. */
export function hint(t, id, key, what) {
  return h_flex().id(id).flex_none().gap(4).items_center().text_size(11)
    .child(div().text_color(t.accent).child(key))
    .when(Boolean(what), (el) => el.child(div().text_color(t.dim).child(what)));
}

/** The bar's last entry, "? keys": bright while the overview is open; a click toggles it. */
export function keysHint(t, id, on, toggle, key = "?") {
  return h_flex().id(id).flex_none().gap(4).items_center().text_size(11).cursor_pointer()
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => { cx.stop_propagation(); toggle(cx); cx.notify(); })
    .child(div().text_color(t.accent).child(key))
    .child(div().text_color(on ? t.foreground : t.dim).child("keys"));
}

/** A bar: `list` ([key, what]) left, `opts.right` right-aligned, "? keys" last
 *  (`opts.keys`: { on, toggle }; without it, no ? entry). `opts.foot` false: the rule under it. */
export function hintBar(t, id, list, { right = null, keys = null, foot = true, px = 12 } = {}) {
  return h_flex().id(id).relative().h(22).flex_none().px(px).gap(12).items_center().text_size(11).overflow_hidden()
    .child(div().absolute().left(0).right(0).h(2).when(foot, (el) => el.top(0)).when(!foot, (el) => el.bottom(0)).child(dither(t.ansi0, 1)))
    .children(list.map(([k, w], i) => hint(t, `${id}-${i}`, k, w)))
    .child(div().flex_1())
    .when(Boolean(right), (el) => el.child(right))
    .when(Boolean(keys), (el) => el.child(keysHint(t, `${id}-keys`, keys.on, keys.toggle)));
}

/** [[k, w]] or [{ title, keys }] as sections. */
export function sectionsOf(list) {
  if (!Array.isArray(list) || !list.length) return [];
  return Array.isArray(list[0]) ? [{ title: null, keys: list }] : list.filter((s) => s?.keys?.length);
}

/** Every row of `list` in order (sections flattened). */
export function rowsOf(list) {
  return sectionsOf(list).flatMap((s) => s.keys);
}

/** How tall the overview is for `list` in a host `width` px wide, one section
 *  under the other (layout px): its head, each row's lines as its words wrap. */
export function keysHeight(list, width) {
  const sections = sectionsOf(list);
  let h = 26 + 10 + 12;
  for (const s of sections) {
    const keyW = keyWidth(s.keys);
    const room = Math.max(60, width - 24 - 8 - keyW - 10);
    if (s.title) h += 18;
    for (const [, what] of s.keys) h += 18 * Math.max(1, Math.ceil((String(what ?? "").length * CHAR) / room)) + 2;
    h += 14;
  }
  return Math.ceil(h);
}

/** A section's key column: its longest key, within bounds. */
function keyWidth(keys) {
  return Math.min(KEY_MAX, Math.max(KEY_MIN, CHAR * Math.max(...keys.map(([k]) => String(k).length)) + 12));
}

/** What a key does to the overview: ? toggles it, esc or q close it while open. */
export function keysKey(e, open) {
  const m = e?.modifiers ?? {};
  if (m.platform || m.control || m.alt) return null;
  const c = e?.key_char, k = e?.key;
  if (c === "?" || k === "?") return "toggle";
  if (open && (k === "escape" || k === "q")) return "close";
  return null;
}

/** The overview: `opts` { id, title, list, cursor?, pick?(row, cx), close?(cx), narrow? }.
 *  Fills its (relative) host; a click on it stays in it. `narrow`: one section under the other. */
export function keysView(t, { id = "keys", title = "", list = [], cursor = null, pick = null, close = null, narrow = false } = {}) {
  const sections = sectionsOf(list);
  let n = 0;
  const section = (s, si) => {
    const keyW = keyWidth(s.keys);
    return v_flex().id(`${id}-s${si}`).gap(2).min_w(0)
      .map((el) => (narrow ? el.w_full() : el.flex_basis(SECTION).flex_grow(1).max_w(SECTION + 120)))
      .when(Boolean(s.title), (el) => el.child(div().pb(4).text_size(10).text_color(t.ansi8).child(String(s.title).toUpperCase())))
      .children(s.keys.map((row) => {
        const [k, what, go] = row;
        const i = n++;
        const on = cursor === i;
        return h_flex().id(`${id}-r${i}`).relative().min_h(18).gap(10).items_start().px(4)
          .when(Boolean(go || pick), (el) => el.cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); (pick ?? (() => go?.(cx)))(row, cx); }))
          .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
          .child(div().relative().w(keyW).flex_none().pt(1).text_color(t.accent).child(String(k)))
          .child(div().relative().flex_1().min_w(0).pt(1).text_color(on ? t.foreground : row.danger ? t.blocked : t.muted).child(String(what ?? "")));
      }));
  };
  return v_flex().id(id).absolute().top(0).left(0).size_full().bg(t.background).text_size(11)
    .on_mouse_down("left", stop)
    .child(h_flex().id(`${id}-head`).relative().h(26).flex_none().px(12).gap(8).items_center()
      .child(div().flex_none().text_size(10).text_color(t.ansi8).child("KEYS"))
      .when(Boolean(title), (el) => el.child(div().min_w(0).truncate().text_color(t.muted).child(title)))
      .child(div().flex_1())
      .child(h_flex().id(`${id}-close`).flex_none().gap(4).cursor_pointer()
        .when(Boolean(close), (el) => el.on_click((_e, cx) => { cx.stop_propagation(); close(cx); cx.notify(); }))
        .child(div().text_color(t.accent).child("? esc")).child(div().text_color(t.dim).child("close")))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1))))
    .child(div().id(`${id}-body`).flex_1().min_h(0).overflow_y_scroll()
      .child(h_flex().flex_wrap().items_start().px(12).pt(10).pb(12).gap_x(28).gap_y(14)
        .children(sections.map(section))));
}
