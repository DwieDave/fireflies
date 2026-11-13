// The process deck under the pointer: a click on a row, the wheel, the
// scrollbar's thumb dragged.

import { div } from "gpui-kit";
import type { ClickEvent, Context, Element, MouseMoveEvent, ScrollWheelEvent } from "gpui-kit";
import type { Theme } from "herdr";
import { wheelDelta, scrollBy } from "./logic.ts";
import type { ListTab } from "./state.ts";
import { THUMB_MIN, BAR_HIT } from "./state.ts";
import { zoom, unzoom, dither } from "./paint.ts";
import { moveTo } from "./listing.ts";
import { activate } from "./actions.ts";
import type { default as ProcsDeck } from "./main.ts";

/** A click on a row: the cursor goes there; a double click does what enter does. */
export function clickRow(v: ProcsDeck, e: ClickEvent, i: number, cx: Context): void {
  const items = v.list();

  moveTo(v, items, i);
  v.focus();

  if (e.click_count >= 2) activate(v, items, i);

  cx.notify();
}

/** The wheel over a list (a mouse's lines or a trackpad's pixels): the rows move, the
 *  cursor stays on its row (a key brings it back into sight). */
export function wheelList(v: ProcsDeck, tab: ListTab, e: ScrollWheelEvent, row: number, max: number, cx: Context): void {
  cx.stop_propagation();

  const to = scrollBy(v.scroll[tab], wheelDelta(e, row, zoom()), max);

  v.follow = false;

  if (to !== v.scroll[tab]) {
    v.scroll[tab] = to;
    cx.notify();
  }
}

/** A list's scrollbar while its rows overflow: a 2 px dithered thumb along the right edge.
 *  Drag it; a press on the strip beside it brings the thumb there first. */
export function scrollbar(v: ProcsDeck, t: Theme, tab: ListTab, total: number, view: number): Element[] {
  if (total <= view) return [];

  const room = total - view;
  const th = Math.max(THUMB_MIN, Math.round((view * view) / total));
  const ty = Math.round((v.scroll[tab] / room) * (view - th));
  const ratio = room / Math.max(1, view - th);

  return [div().id(`bar-${tab}`).absolute().top(0).right(0).w(BAR_HIT).h(view).cursor_pointer()
    .on_mouse_down("left", (e, cx) => {
      cx.stop_propagation();

      const y = unzoom(e.local_position?.y ?? 0);

      if (y < ty || y > ty + th) v.scroll[tab] = scrollBy(0, (y - th / 2) * ratio, room);

      v.drag = { tab, at: e.position.y, from: v.scroll[tab], ratio, room };
      v.follow = false;
      v.focus();
      cx.notify();
    })
    .child(div().absolute().right(2).top(ty).w(2).h(th).child(dither(v.drag?.tab === tab ? t.accent : t.ansi8, 1)))];
}

/** The scrollbar's thumb follows the pointer while it's held. */
export function dragTo(v: ProcsDeck, e: MouseMoveEvent, cx: Context): void {
  const d = v.drag;

  if (!d) return;

  const to = scrollBy(d.from, unzoom(e.position.y - d.at) * d.ratio, d.room);

  if (to !== v.scroll[d.tab]) {
    v.scroll[d.tab] = to;
    cx.notify();
  }
}
