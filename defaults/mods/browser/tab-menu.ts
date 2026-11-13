// A tab's menu and its pin on the shelf: pinning a tab (nocturne's records),
// the shelf's wish to show one, the menu as a popup copy of this mod, its
// keys and its picks.

import { div } from "gpui-kit";
import type { AsyncContext, Context, Element, KeyEvent } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { shared, setShared, run, openOverlay } from "herdr";
import type { Theme } from "herdr";
import { isNull, isNumber, isString, nullable, object, oneOf, parseJson, readShared, readSharedList, sharedKey, writeShared } from "./guard.ts";
import * as Tabs from "./tabs.ts";
import type { MenuRow } from "./tabs.ts";
import { showTab, closeTab, stepTab } from "./tab-ops.ts";
import { dither } from "./dither.ts";
import { keyOf, closeOwn } from "./props.ts";
import type { TabMenu } from "./props.ts";
import type Browser from "./main.ts";

// A tab to show once this pane is on screen (nocturne's goToPin): { slot, tab, at }.
export const SHOW = sharedKey("browser.show", nullable(object({ tab: isString }, { slot: oneOf(isString, isNumber, isNull), at: isNumber })));

// How long such a wish holds (ms): long enough for a tab or space switch.
export const SHOW_FOR = 5000;

// The tab's menu: a row's height, the rule between its sections.
export const MENU_ROW = 26, MENU_RULE = 9, MENU_W = 250;

/** Tab `id` is pinned to the shelf. */
export function tabPinned(view: Browser, id: string): boolean {
  return view.ownSlot && Tabs.tabPinned(readSharedList(shared, Tabs.PINS_LIST), view.slot, id);
}

/** This pane can pin a tab: it has a slot (the shelf finds it again by it) and is found. */
export function canPin(view: Browser): boolean {
  return Boolean(view.ownSlot && view.ownPane());
}

/** Pins tab `id` to the shelf, or unpins it. */
export function togglePin(view: Browser, id: string) {
  const me = view.ownSlot ? view.ownPane() : null;
  const props = me ? Tabs.paneProps(me) : null;

  if (!me || !props || !view.tabs.list.some((t) => t.id === id)) return;

  writeShared(setShared, Tabs.PINS_KEY, Tabs.pinTab(readSharedList(shared, Tabs.PINS_LIST), { pane: me.pane, props }, id, !tabPinned(view, id), Date.now()));
}

/** `show:{ slot, tab }` (a tab's tile on the shelf): the pane with that slot shows it. */
export function showCommand(view: Browser, value: string, cx: Context) {
  const a = Tabs.showArgs(value);

  if (!a || !view.ownSlot || a.slot !== view.slot) return;

  const w = readShared(shared, SHOW, null);

  if (w?.slot === view.slot) writeShared(setShared, SHOW, null);

  showTab(view, a.tab, cx);
  view.claim();
}

/** A tab the shelf asked for while this pane wasn't on screen (SHOW): shown now. */
export function takeShow(view: Browser, cx: Context) {
  const w = readShared(shared, SHOW, null);

  if (!w || !view.ownSlot || String(w.slot) !== view.slot) return;

  writeShared(setShared, SHOW, null);

  if (Date.now() - (w.at ?? Number.NaN) <= SHOW_FOR) showTab(view, w.tab, cx);
}

// ---- the tab's menu: this mod as a popup (props { tabMenu })

/** Opens tab `id`'s menu: at the pointer (a right-click), or in the middle
 *  from the keyboard (`keyboard`: m in the bar), as Nocturne's menus open. */
export function openTabMenu(view: Browser, id: string, keyboard: boolean) {
  const index = Tabs.indexOf(view.tabs, id);
  const tab = view.tabs.list[index];

  if (!tab) return;

  const menu: TabMenu = { slot: view.ownSlot ? view.slot : null, tab: id, title: Tabs.label(tab), pinned: tabPinned(view, id),
    canPin: canPin(view), index, count: view.tabs.list.length };

  const rows = Tabs.menuRows(menu);
  const height = rows.flat().length * MENU_ROW + (rows.length - 1) * MENU_RULE + MENU_ROW + 10;

  openOverlay({ mod: "browser", kind: keyboard ? "dialog" : "popup", frame: "none", width: MENU_W, height, props: { tabMenu: menu } });
}

/** `tab_act:{ slot, tab, act }`: a pick in a tab's menu, for the pane it names. */
export function tabAct(view: Browser, value: string, cx: Context) {
  const a = parseJson(value, object({ tab: isString }, { slot: oneOf(isString, isNumber, isNull), act: isString }));

  if (!a || !(a.slot !== null && a.slot !== undefined ? view.ownSlot && String(a.slot) === view.slot : view.mine())) return;

  if (!view.tabs.list.some((t) => t.id === a.tab)) return;

  view.claim();

  if (a.act === "pin") togglePin(view, a.tab);
  else if (a.act === "left" || a.act === "right") stepTab(view, a.tab, a.act === "right" ? 1 : -1);
  else if (a.act === "close") closeTab(view, a.tab, cx);
  else if (a.act === "show") showTab(view, a.tab, cx);
}

export function initMenu(view: Browser, menu: TabMenu, cx: AsyncContext) {
  const handle = cx.focus_handle();

  view.menu = menu;
  view.rows = Tabs.menuRows(menu).flat();
  view.cursor = Tabs.menuStep(view.rows, -1, 1);
  view.handle = handle;
  handle.focus();
  cx.timer.after(120, () => handle.focus());
}

/** A row picked: to the pane (its copy acts), and the menu goes. */
export function pickRow(view: Browser, row: MenuRow | undefined) {
  const menu = view.menu;

  if (!row?.enabled || !menu) return;

  closeOwn();
  run(`browser.tab_act:${JSON.stringify({ slot: menu.slot, tab: menu.tab, act: row.act })}`);
}

/** The menu's keys: ↑ ↓ j k move (over the rows that can be picked), enter picks, esc q close. */
export function menuKey(view: Browser, e: KeyEvent, cx: Context) {
  const k = keyOf(e);

  if (k === "down" || k === "j" || k === "up" || k === "k") view.cursor = Tabs.menuStep(view.rows, view.cursor, k === "down" || k === "j" ? 1 : -1);
  else if (k === "enter") pickRow(view, view.rows[view.cursor]);
  else if (k === "escape" || k === "q") closeOwn();
  else return;

  cx.stop_propagation();
  cx.notify();
}

/** The menu: the tab's name, then its rows in sections, a dithered rule between. */
export function renderMenu(view: Browser, t: Theme, menu: TabMenu): Element {
  const sections = Tabs.menuRows(menu);
  let n = 0;

  const row = (r: MenuRow) => {
    const i = n++, on = i === view.cursor && r.enabled;

    return h_flex().id(`tm-${r.act}`).relative().h(MENU_ROW).flex_none().px(12).items_center().text_size(12)
      .text_color(!r.enabled ? t.ansi0 : on ? t.foreground : t.muted)
      .on_hover((h, cx) => {
        if (h && r.enabled && view.cursor !== i) {
          view.cursor = i;
          cx.notify();
        }
      })
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => pickRow(view, r))
      .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
      .child(div().relative().flex_1().min_w(0).truncate().child(r.name));
  };

  const root = v_flex().id("tab-menu").size_full().bg(t.background).border(1).border_color(t.ansi0).py(4);

  return (view.handle ? root.track_focus(view.handle) : root)
    .on_key_down((e, cx) => menuKey(view, e, cx))
    .on_scroll_wheel((e, cx) => {
      if (Math.abs(e.delta.y) >= 1) {
        view.cursor = Tabs.menuStep(view.rows, view.cursor, e.delta.y > 0 ? -1 : 1);
        cx.notify();
      }
    })
    .child(div().h(MENU_ROW).flex_none().px(12).flex().items_center().text_size(11).text_color(t.dim).truncate().child(menu.title))
    .children(sections.flatMap((part, k) => [
      ...(k ? [div().relative().h(MENU_RULE).flex_none().mx(12).child(div().absolute().left(0).right(0).top(4).h(1).child(dither(t.ansi8, 1)))] : []),
      ...part.map(row),
    ]));
}
