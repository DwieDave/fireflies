// The agent graph's drawing pieces: a toolbar chip.

import { div } from "gpui-kit";
import type { Color, Context, Element } from "gpui-kit";
import type { Theme } from "herdr";
import { stop } from "./state.ts";

export function chip(t: Theme, id: string, label: string, action: (cx: Context) => void, color?: Color): Element {
  return div().id(id).flex_none().px(6).h(20).flex().items_center().text_size(11).text_color(color ?? t.muted)
    .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      action(cx);
    })
    .child(label);
}
