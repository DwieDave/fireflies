// Nocturne's look for the GitHub window: the dither fill and pips (copied
// from ../nocturne/kit.js and ../nocturne-agents/kit.js: a mod can't import
// another mod's files), the tone colors, lazygit-style panels, chips, the
// key bar and empty states.

import { div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings, window as appWindow } from "herdr";
import { hint, keysHint } from "./keyhelp.js";

export const ART = "mods/nocturne/art";
export const stop = (_e, cx) => cx.stop_propagation();

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

/** The app's zoom: lengths a script writes are drawn this much bigger, while
 *  sizes (on_size_change) and pointer positions come back as drawn. */
export function zoom() {
  const z = Number(settings()?.zoom);
  return z > 0 ? z : 1;
}

/** A drawn length (a measured size, a pointer move) in the px scripts write. */
export const unzoom = (v) => v / zoom();

/** A measured { width, height } in the px scripts write. */
export const unzoomSize = (size) => ({ width: unzoom(size.width), height: unzoom(size.height) });

/** The 6px gap between two panels, dragged to resize them: `axis` "x" for
 *  side by side, "y" for stacked; `onDown(e, cx)` starts the drag. */
export function splitter(t, id, axis, dragging, onDown) {
  const line = div().absolute().when(axis === "x", (el) => el.top(0).bottom(0).left(2).w(2)).when(axis === "y", (el) => el.left(0).right(0).top(2).h(2));
  return div().id(id).relative().flex_none()
    .when(axis === "x", (el) => el.w(6).h_full().cursor_col_resize()).when(axis === "y", (el) => el.h(6).w_full().cursor_row_resize())
    .hover((s) => s.bg(t.ansi0))
    .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); onDown(e, cx); cx.notify(); })
    .when(dragging, (el) => el.child(line.bg(t.accent)));
}

/** A layer filling its parent with a 50% checker dither, in `cell`-px squares (Retina on macOS). */
export function dither(color, cell = 1) {
  const dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}

/** The dim under a popup inside the window (a picker, a confirm): black,
 *  dithered, light enough that the window stays readable under it. The same
 *  as nocturne-git's (draw.js POPUP_SCRIM): every in-window popup matches. */
export const POPUP_SCRIM = "#0000008c";

/** The layer that dims the window under an in-window popup (POPUP_SCRIM). */
export function popupScrim(id) {
  return div().id(id).absolute().inset_0().child(dither(POPUP_SCRIM, 1));
}

/** A tone (model.js) -> its theme color. */
export function toneColor(t, tone) {
  return { working: t.working, done: t.done, failed: t.blocked, queued: t.ansi8, stopped: t.ansi8, skipped: t.ansi0 }[tone] ?? t.ansi8;
}

/** A tone in words. */
export const TONE_WORD = { working: "running", done: "passed", failed: "failed", queued: "queued", stopped: "cancelled", skipped: "skipped" };

/** A small dithered diamond in the tone's color: running breathes, failed
 *  blinks once in a while, queued is a hollow dim ring. */
export function pip(t, tone, size = 7) {
  if (!tone) return div().size(size).flex_none();
  if (tone === "queued" || tone === "skipped") {
    return div().size(size).flex_none().border(1).border_color(toneColor(t, tone))
      .when(tone === "queued", (el) => el.loop("opacity", { from: 0.35, to: 0.9, period: 2200 }));
  }
  const el = svg(`${ART}/pip.svg`).size(size).flex_none().text_color(toneColor(t, tone));
  if (tone === "working") return el.loop("opacity", { from: 0.25, to: 1, period: 1200 });
  if (tone === "failed") return el.loop("opacity", { from: 0.55, to: 1, period: 2600 });
  return el;
}

/** Uppercase eyebrow label. */
export function eyebrow(t, text) {
  return div().text_size(10).text_color(t.ansi8).child(String(text).toUpperCase());
}

/** A lazygit panel: a 1-bit frame with its title cut into the top edge,
 *  accent when it has the keyboard. */
export function panel(t, id, title, active, body, { right } = {}) {
  const edge = active ? t.accent : t.ansi0;
  return v_flex().id(id).relative().min_h(0).min_w(0).border(1).border_color(edge)
    .child(h_flex().relative().h(20).flex_none().px(8).gap(8).items_center().text_size(11)
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(edge, 1)))
      .child(div().relative().text_color(active ? t.foreground : t.muted).child(title))
      .child(div().flex_1())
      .when(Boolean(right), (el) => el.child(div().relative().flex_none().text_color(t.dim).child(right))))
    .child(div().relative().flex_1().min_h(0).child(body));
}

/** A small text button; `on` gives it the dithered pressed look. */
export function chip(t, id, label, on, action, color) {
  return h_flex().id(id).relative().h(20).px(7).flex_none().items_center().text_size(11)
    .text_color(on ? t.foreground : color ?? t.muted).hover((s) => s.text_color(t.foreground))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => { cx.stop_propagation(); action(cx); cx.notify(); })
    .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)))
    .child(div().relative().child(label));
}

/** lazygit's options bar: the keys that do something now. */
export function hints(t, list, right, keys = null) {
  // The help entry (? keys, keyhelp.js) ends the bar, after the right-aligned note too.
  const help = list.filter(([key]) => key === "?"), rest = list.filter(([key]) => key !== "?");
  return h_flex().id("gh-hints").relative().h(22).flex_none().px(10).gap(12).items_center().text_size(11).overflow_hidden()
    .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
    .children(rest.map(([key, what], i) => hint(t, `gh-hint-${i}`, key, what)))
    .child(div().flex_1())
    .when(Boolean(right), (el) => el.child(right))
    .when(help.length > 0, (el) => el.child(keysHint(t, "gh-hint-keys", Boolean(keys?.on), (cx) => keys?.toggle?.(cx))));
}

/** A quiet middle-of-the-panel note, with the moon. */
export function empty(t, title, hint, { moon = 8, small = false } = {}) {
  return v_flex().size_full().items_center().justify_center().gap(small ? 6 : 10).px(16).text_size(11)
    .when(!small, (el) => el.child(svg(`${ART}/moon-${moon}.svg`).w(40).h(40).text_color(t.ansi8).opacity(0.6)
      .loop("opacity", { from: 0.35, to: 0.7, period: 5200 })))
    .child(div().text_center().text_color(t.foreground).child(title))
    .when(Boolean(hint), (el) => el.child(div().text_center().max_w(420).text_color(t.ansi8).child(hint)));
}

/** A selected row's band: dither with an accent edge (as Nocturne's lists). */
export function band(t, active) {
  return [dither(active ? t.ansi0 : t.ansi0 + "88", 1), div().absolute().left(0).top(0).bottom(0).w(2).bg(active ? t.accent : t.ansi8)];
}

/** A running bar: a dithered sweep across its parent, for what's in progress. */
export function sweep(t, color, width = 400) {
  return div().absolute().top(0).bottom(0).w(48).opacity(0.5).child(dither(color, 1))
    .loop("left", { from: -48, to: width, period: 1800, easing: "linear" });
}
