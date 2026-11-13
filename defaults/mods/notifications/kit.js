// The pieces of Nocturne's look this mod needs (a mod can't import another
// mod's files): the art folder, the dither fill, pips, logos, buttons. Same as
// ../nocturne/kit.js.

import { div, svg } from "gpui-kit";
// The toolbar's ground and the dither fill: toolground.ts (the same file in
// ../nocturne and ../notifications).
import { dither } from "./toolground.ts";
export { dither, TOOL_LOOK, toolGround, mix, toolHover } from "./toolground.ts";

export const ART = "mods/nocturne/art";
export const ICON = (name) => `mods/workspace-chrome/${name}.svg`;
export const stop = (_e, cx) => cx.stop_propagation();

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
