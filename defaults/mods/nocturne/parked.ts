// A parked pane's chip in the row under the tab (pane.park; the layout's
// pane.parked look): a pane header in small. Its mark, its pip while it
// works or needs the person, its name, then a dithered band that lights
// up under the pointer. The app draws the frame and handles the pointer:
// a click puts the pane back, a drag moves the chip or drops it in the tab.
// Props from the app: { pane, terminal }. The tab strip's keyboard (tabs.ts)
// walks the chips as its last row; the one under its cursor (shared(nav.ts
// CURSOR)) is lit and ringed: enter puts it back, x closes it, m its menu.

import { div } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, theme, shared } from "herdr";
import { isString, object, readShared } from "./guard.ts";
import { dither, pip, navRing } from "./kit.ts";
import { CURSOR_KEY } from "./nav.ts";
import { mark, paneName } from "./header.ts";


/** A chip's props from the app: its pane. */
const isChipProps = object({}, { pane: isString });

export default class Parked {
  hovered = false;

  init(): void {
    this.hovered = false;
  }

  render(): Element {
    const t = theme();
    const pr = props();
    const pane = isChipProps(pr) ? pr.pane : undefined;
    const p = panes().find((x) => x.pane === pane);

    if (!p) return div();

    const c = readShared(shared, CURSOR_KEY, null);
    const on = c?.region === "parked" && c.pane === p.pane;
    const lit = this.hovered || on;
    const st = p.status;

    return h_flex().id(`park-${p.pane}`).size_full().overflow_hidden().px(10).gap(8).items_center().bg(t.background)
      .text_size(11)
      .on_hover((h, cx) => {
        this.hovered = h;
        cx.notify();
      })
      .child(mark(t, { ...p, focused: lit }))
      .when(Boolean(st) && st !== "idle", (el) => el.child(pip(t, st)))
      .child(div().min_w(0).truncate().text_color(lit ? t.foreground : t.muted).child(paneName(p)))
      .child(div().flex_1().min_w(8).h(6).relative().child(dither(lit ? t.accent : t.ansi0, 2)))
      .relative().map((el) => navRing(t, el, on));
  }
}
