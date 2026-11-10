// A parked pane's chip in the row under the tab (pane.park; the layout's
// pane.parked look): a pane header in small. Its mark, its pip while it
// works or needs the person, its name, then a dithered band that lights
// up under the pointer. The app draws the frame and handles the pointer:
// a click puts the pane back, a drag moves the chip or drops it in the tab.
// Props from the app: { pane, terminal }.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, theme } from "herdr";
import { dither, pip } from "./kit.js";
import { mark, paneName } from "./header.js";

export default class Parked {
  init() {
    this.hovered = false;
  }

  render() {
    const t = theme();
    const p = panes().find((x) => x.pane === props()?.pane);
    if (!p) return div();
    const lit = this.hovered;
    const st = p.status;
    return h_flex().id(`park-${p.pane}`).size_full().overflow_hidden().px(10).gap(8).items_center().bg(t.background)
      .text_size(11)
      .on_hover((h, cx) => { this.hovered = h; cx.notify(); })
      .child(mark(t, { ...p, focused: lit }))
      .when(Boolean(st) && st !== "idle", (el) => el.child(pip(t, st)))
      .child(div().min_w(0).truncate().text_color(lit ? t.foreground : t.muted).child(paneName(p)))
      .child(div().flex_1().min_w(8).h(6).relative().child(dither(lit ? t.accent : t.ansi0, 2)));
  }
}
