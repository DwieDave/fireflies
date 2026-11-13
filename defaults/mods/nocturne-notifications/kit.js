// The pieces of Nocturne's look this mod needs (a mod can't import another
// mod's files): the art folder, the dither fill, pips, logos, buttons. Same as
// ../nocturne/kit.js.

import { div, svg, PathBuilder, Background } from "gpui-kit";
import { settings, window as appWindow } from "herdr";

export const ART = "mods/nocturne/art";
export const ICON = (name) => `mods/workspace-chrome/${name}.svg`;
export const stop = (_e, cx) => cx.stop_propagation();

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

/** A layer filling its parent with a 50% checker dither, in `cell`-px squares (Retina on macOS). */
export function dither(color, cell = 1) {
  const zoom = Number(settings()?.zoom) || 1;
  const dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

// ---- the toolbar's ground (the same in ../nocturne/kit.js and
// ../nocturne-notifications/kit.js: the tools, the bell and "+ new" are
// blocks of their own, and the ground runs under all of them to the strip's
// right edge, each block drawing its stretch)

/** The toolbar's look: "ledge" (the tools on a raised, lit ledge of the
 *  horizon) or "plate" (the tools on a dithered plate the strip's height). */
export const TOOL_LOOK = "plate";

/** The ground under a block of the toolbar (layers filling it, behind its
 *  controls), in place of the tabs' plain horizon. */
export function toolGround(t, look = TOOL_LOOK) {
  const layer = () => div().absolute().left(0).right(0);
  if (look === "plate") return [
    layer().top(0).bottom(0).opacity(0.55).child(dither(t.ansi0, 1)), // the plate
    layer().bottom(0).h(2).child(dither(t.ansi8, 1)), // its foot: the horizon, lit
  ];
  return [
    layer().bottom(0).h(4).child(dither(t.ansi8, 1)), // the ledge, dithered
    layer().bottom(4).h(1).bg(t.ansi8).opacity(0.8), // its lit edge
  ];
}

/** Two "#rrggbb" colors mixed, `k` of the way from `a` to `b`; `a` when either isn't one. */
export function mix(a, b, k) {
  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null);
  const x = hex(a), y = hex(b);
  if (!x || !y) return a;
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, "0")).join("")}`;
}

/** A tool's plate under the pointer: on the plate a step brighter than it
 *  (ansi0 lifted toward ansi8, the text still reads on it); on the ledge ansi0. */
export function toolHover(t, look = TOOL_LOOK) {
  return look === "plate" ? mix(t.ansi0, t.ansi8, 0.3) : t.ansi0;
}

/** A small dithered diamond; `blink` for what needs the person. */
export function pip(color, size = 6, blink = false) {
  const el = svg(`${ART}/pip.svg`).size(size).flex_none().text_color(color);
  return blink ? el.loop("opacity", { from: 0.15, to: 1, period: 700, easing: "linear" }) : el;
}

/** An agent's dithered logo (Nocturne's art), tinted. */
export function logo(key, color, size = 12) {
  return svg(`${ART}/logo-${key || "agent"}.svg`).size(size).flex_none().text_color(color);
}

/** The 2 px dithered line under a header. */
export const horizon = (t, color) => div().absolute().left(0).right(0).bottom(0).h(2).child(dither(color ?? t.ansi0, 1));

/** Each type's color: permissions in blocked pink, questions the moon's blue, what needs a look amber. */
export const TYPE_COLOR = { permission: "blocked", question: "accent", other: "working" };

/** A square button: `strong` outlines in its color and fills on hover; the other is a quiet chip. */
export function button(t, id, label, color, strong, action, { off = false } = {}) {
  return div().id(id).flex_none().h(22).px(9).flex().items_center().gap(6).text_size(11)
    .border(1).border_color(off ? t.ansi0 : strong ? color : t.ansi0).text_color(off ? t.dim : strong ? color : t.muted)
    .when(!off, (el) => el.cursor_pointer().hover((s) => (strong ? s.bg(color).text_color(t.background) : s.text_color(t.foreground).bg(t.ansi0))))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => { cx.stop_propagation(); if (!off) action(cx); })
    .child(label);
}

/** A key cap in a hint line. */
export const kbd = (t, k) => div().flex_none().h(15).px(4).flex().items_center().border(1).border_color(t.ansi0).text_size(10).text_color(t.muted).child(k);
