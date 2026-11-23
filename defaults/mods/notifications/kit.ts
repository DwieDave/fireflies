// The pieces of the look this mod needs, drawn as the layout asks
// (@fireflies/look): Nocturne's dithered, square chrome in nocturne, upstream's
// plain one elsewhere (docs/plain-look.md). The toolbar's ground is
// @fireflies/toolground's.

import { div, svg } from "gpui-kit";
import type { Color, Context, Element, MouseButtonEvent } from "gpui-kit";
import type { Theme } from "herdr";
import { String as Str } from "effect";
import { ART, boxed, dithered, dot, edge, kbd as chip, pick, rule } from "@fireflies/look";
import type { ItemType } from "./model.ts";

export { TOOL_LOOK, toolGround, mix, toolHover } from "@fireflies/toolground";

export { fill } from "@fireflies/look";

export const stop = (_e: MouseButtonEvent, cx: Context): void => cx.stop_propagation();

/** What blinks (what needs the person): its opacity, 0.15 to 1 and back, 0.7 s. */
export const blinking = (el: Element): Element => el.loop("opacity", { from: 0.15, to: 1, period: 700, easing: "linear" });

/** A status pip (nocturne's dithered diamond, a round dot in a plain layout); `blink` for what needs the person. */
export function pip(color: Color, size = 6, blink = false): Element {
  const el = dot(color, size);

  return blink ? blinking(el) : el;
}

/** An agent's logo, tinted: its identity (the 1-bit mark Nocturne drew for it), in either look. */
export function logo(key: string, color: Color, size = 12): Element {
  return svg(`${ART}/logo-${Str.isEmpty(key) ? "agent" : key}.svg`).size(size).flex_none().text_color(color);
}

/** The line under a header: nocturne's dithered 2 px strip, a 1 px border line in a plain layout. */
export const horizon = (t: Theme, color?: Color): Element => rule(t, "bottom", color === undefined ? {} : { color });

/** Each type's color: permissions in blocked pink, questions the moon's blue, what needs a look amber. */
export const TYPE_COLOR = { permission: "blocked", question: "accent", other: "working" } as const satisfies { readonly [K in ItemType]: keyof Theme };

/** button()'s options: off, it can't be pressed. */
export interface ButtonOptions {
  readonly off?: boolean;
}

/** A button: `strong` outlines in its color and fills on hover; the other is a quiet chip. */
export function button(t: Theme, id: string, label: string, color: Color, strong: boolean, action: (cx: Context) => void, { off = false }: ButtonOptions = {}): Element {
  const lit = !off && strong;

  const el = div().id(id).flex_none().h(pick(22, 24)).px(9).flex().items_center().gap(6).text_size(pick(11, 12))
    .text_color(off ? t.dim : lit ? color : t.muted);

  return boxed(t, el, lit ? color : null)
    .when(!off, (b) => b.cursor_pointer().hover((s) => (strong ? s.bg(color).text_color(t.background) : s.text_color(t.foreground).bg(pick(edge(t), t.hover)))))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      cx.stop_propagation();

      if (!off) action(cx);
    })
    .child(label);
}

/** A key cap in a hint line: nocturne's square cap, a key chip in a plain layout. */
export const kbd = (t: Theme, k: string): Element =>
  dithered() ? div().flex_none().h(15).px(4).flex().items_center().border(1).border_color(edge(t)).text_size(10).text_color(t.muted).child(k) : chip(t, k);
