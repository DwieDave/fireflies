// The tab strip's drawing: each tab's number, favicon, title and ×, the drag's
// lift and stake, + at the end.

import { div, svg, image } from "gpui-kit";
import type { Context, Element, Point } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared } from "herdr";
import type { Theme } from "herdr";
import { readSharedList } from "./guard.ts";
import * as Tabs from "./tabs.ts";
import type { Tab } from "./tabs.ts";
import { openTab, showTab, closeTab, dragOver, dropTab, cancelDrag } from "./tab-ops.ts";
import { dither } from "./dither.ts";
import { tabIcon } from "./publish.ts";
import { openTabMenu } from "./tab-menu.ts";
import { ICONS, WEB_MARK } from "./props.ts";
import type Browser from "./main.ts";

/** The drop marker of a tab drag, as the app's strip (nocturne/tabdrag.ts):
 *  a 2 px accent bar capped top and bottom, at the left edge of its box. */
export function stake(t: Theme): Element {
  return div().absolute().left(-3).top(3).bottom(2).w(8)
    .child(div().absolute().left(3).top(0).bottom(0).w(2).bg(t.accent))
    .child(div().absolute().left(0).right(0).top(0).h(2).bg(t.accent))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent));
}

/** The dragged tab's lift, behind its words: a dither shadow, then a plate
 *  edged in the accent, clear of the horizon. */
export function lift(t: Theme): Element[] {
  return [
    div().absolute().left(5).right(0).top(6).bottom(2).child(dither(t.ansi0, 1)),
    div().absolute().left(2).right(3).top(3).bottom(4).bg(t.background).border(1).border_color(t.accent),
  ];
}

/** A tab's favicon before its title, else the web pane's mark in the tab's colour. */
export function tabMark(view: Browser, t: Theme, tab: Tab, bright: boolean): Element {
  const icon = tabIcon(view, tab);

  return icon ? image(icon).id(`webtab-icon-${tab.id}`).size(12).flex_none()
    : svg(WEB_MARK).id(`webtab-icon-${tab.id}`).size(12).flex_none().text_color(bright ? t.foreground : t.dim);
}

/** The tabs, over the bar (two or more): number, title, ×, and + at the
 *  end; the shown one bright on a dithered accent line, as the app's tabs.
 *  A click shows a tab, a middle click or × closes it; tab rings them. */
export function stripView(view: Browser, t: Theme): Element {
  const drag = view.drag;
  const pins = view.ownSlot ? readSharedList(shared, Tabs.PINS_LIST) : null;
  const pinned = (id: string) => pins !== null && Tabs.tabPinned(pins, view.slot, id);
  const stakeAt = drag ? Tabs.stakeBefore(view.tabs, drag.id, Tabs.dropIndex(view.tabs, drag.id, drag.gap)) : undefined;

  const item = (tab: Tab, i: number) => {
    const on = tab.id === view.tabs.active;
    const lifted = drag?.id === tab.id;
    const ringed = view.control(`tab:${tab.id}`, true, (cx) => showTab(view, tab.id, cx));

    return h_flex().id(`webtab-${tab.id}`).relative().flex_1().min_w(0).max_w(200).h_full().pl(8).pr(4).gap(6).items_center()
      .text_size(11).text_color(on || lifted ? t.foreground : t.muted)
      .hover((s) => s.text_color(t.foreground))
      // Dragged: lifted where it is, behind its words.
      .when(lifted, (el) => el.children(lift(t)))
      // A press may become a drag (dragOver); let go without one, it shows the tab.
      .on_mouse_down("left", (e, cx) => {
        view.stop(e, cx);
        view.pressed = { id: tab.id, x: e.position.x };
      })
      .on_mouse_move((e, cx) => dragOver(view, Tabs.gapAt(tab.id, e.local_position.x, e.bounds.width), e.position, cx))
      .on_mouse_up("left", (_e, cx) => {
        if (!view.drag && view.pressed?.id === tab.id) {
          view.claim();
          showTab(view, tab.id, cx);
          cx.notify();
        }
      })
      // Middle click closes it, as in a browser; a right-click opens its menu.
      .on_mouse_down("middle", (_e, cx) => {
        cx.stop_propagation();
        view.claim();
        closeTab(view, tab.id, cx);
        cx.notify();
      })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        view.claim();
        openTabMenu(view, tab.id, false);
      })
      // Pinned to the shelf: a small square in its corner, as the shelf's tiles.
      .when(pinned(tab.id), (el) => el.child(div().absolute().left(2).top(4).size(4).bg(on ? t.foreground : t.muted)))
      .child(div().flex_none().text_color(on || tab.page.loading ? t.accent : t.dim).child(i < 9 ? String(i + 1) : "·"))
      .child(tabMark(view, t, tab, on || lifted))
      .child(div().flex_1().min_w(0).truncate().child(Tabs.label(tab)))
      .child(div().id(`webtab-x-${tab.id}`).size(16).flex_none().flex().items_center().justify_center().text_color(t.dim)
        .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
        .on_mouse_down("left", (e, cx) => view.stop(e, cx))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          view.claim();
          closeTab(view, tab.id, cx);
          cx.notify();
        })
        .child(svg(`${ICONS}/x.svg`).size(10)))
      // Loading: its line runs dim; shown: the accent line it stands on.
      .when(on || tab.page.loading, (el) => el.child(div().absolute().left(6).right(6).bottom(0).h(2).child(dither(on ? t.accent : t.ansi8, 1))))
      .when(ringed, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
      .when(stakeAt === tab.id, (el) => el.child(stake(t)));
  };

  const items = view.tabs.list.map(item);
  const plusRinged = view.control("tab-new", true, (cx) => openTab(view, null, {}, cx));
  const end = (at: Point, cx: Context) => dragOver(view, { id: null, after: false }, at, cx);

  return h_flex().id("webtabs").relative().h(26).flex_none().pl(4).pr(6).gap(1).items_center().overflow_hidden()
    .on_mouse_up("left", (_e, cx) => dropTab(view, cx))
    .on_hover((hovered, cx) => {
      if (!hovered) cancelDrag(view, cx);
    })
    .when(Boolean(drag), (el) => el.cursor_grabbing())
    // The horizon the tabs stand on, as the app's tab strip.
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)))
    .children(items)
    // Past the last tab (+ and the room after it): the gap at the end.
    .child(div().id("webtab-new").relative().size(22).flex_none().flex().items_center().justify_center()
      .on_mouse_move((e, cx) => end(e.position, cx))
      .when(stakeAt === null, (el) => el.child(stake(t)))
      .text_color(plusRinged ? t.foreground : t.muted)
      .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
      .when(plusRinged, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
      .on_mouse_down("left", (e, cx) => view.stop(e, cx))
      .on_click((_e, cx) => {
        view.claim();
        openTab(view, null, {}, cx);
        cx.notify();
      })
      .child(svg(`${ICONS}/plus.svg`).size(12)))
    .child(div().id("webtab-end").flex_1().min_w(0).h_full().on_mouse_move((e, cx) => end(e.position, cx)));
}
