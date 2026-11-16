// The process deck's row menu drawn and driven: Nocturne's menu (the files
// pane's and the editor's tab menu: accent edges, the row's name in the top
// edge, a key column, a dithered band on the entry under the cursor) at the
// pointer (flipped left or up near the deck's edges), or under the selected
// row when m opened it (above it near the foot): menu-place.ts. j k ↑ ↓ move, enter runs, an entry's key
// runs it, esc or m closes; a click outside, or a second right-click, closes.

import { div } from "gpui-kit";
import type { Context, Element, KeyEvent, MouseButtonEvent } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { Item } from "./state.ts";
import { W, H, PROW, ROW } from "./state.ts";
import type { Menu } from "./menu.ts";
import type { Anchor, Pt, Rect } from "./menu-place.ts";
import { placeMenu } from "./menu-place.ts";
import { menuEntries, runAct } from "./menu.ts";
import { dither, unzoom } from "./paint.ts";
import { moveTo, procOf } from "./listing.ts";
import type { default as ProcsDeck } from "./main.ts";
import { edge as edgeTone } from "./tones.ts";

export const MENU_W = 288;
export const MENU_ROW = 20;

/** The menu's height: its entries and the air its edges take. */
export const menuH = (n: number): number => n * MENU_ROW + 16;

/** The menu's corner in the deck (menu-place.ts): past the press, flipped near the edges; under
 *  the row (above it near the foot); whole inside the deck. */
export function menuPlace(m: Pick<Menu, "at">, n: number, deck: { readonly w: number; readonly h: number } = { w: W - 2, h: H - 2 }): Pt {
  return placeMenu({ width: MENU_W, height: menuH(n) }, { width: deck.w, height: deck.h }, m.at);
}

/** The selected row (deck px) as the lists last drew it: what a key's menu stands at. */
export function selectedRow(v: ProcsDeck): Rect {
  const h = v.tab === "ports" ? PROW : ROW;

  return { x: 0, y: v.selY - h, w: v.width, h };
}

/** Opens the menu for the row at `i` of the shown list, at `at` (deck px: a press, or the row's
 *  rectangle): the row is selected. */
export function openMenu(v: ProcsDeck, items: readonly Item[], i: number, at: Anchor): void {
  const item = items[i];

  if (!item) return;

  moveTo(v, items, i);

  const entries = menuEntries(v, item);

  if (!entries.length) return;

  v.ask = null;
  v.menu = { key: item.key, entries, at: at ?? selectedRow(v), n: 0 };
  v.focus();
}

/** A right press on the deck: a second one closes the menu; one on a row (the row noted it,
 *  as its own handler runs first) opens it there, under the pointer. */
export function rightPress(v: ProcsDeck, e: MouseButtonEvent, cx: Context): void {
  const row = v.pressed;

  v.pressed = null;

  if (v.menu) {
    v.menu = null;
    cx.notify();

    return;
  }

  if (row === null) return;

  const items = v.list();
  const i = items.findIndex((x) => x.key === row);
  const p = e.local_position ?? e.position;

  openMenu(v, items, i, { x: unzoom(p.x), y: unzoom(p.y) });
  cx.notify();
}

/** The menu's row, still in the list (a refresh may have taken it). */
function menuItem(v: ProcsDeck, m: Menu): { item: Item; items: readonly Item[] } | null {
  const items = v.list();
  const item = items.find((x) => x.key === m.key);

  return item ? { item, items } : null;
}

/** Runs entry `n` of the open menu on its row; the menu closes. */
export function pick(v: ProcsDeck, n: number, cx: Context): void {
  const m = v.menu;

  v.menu = null;

  const e = m?.entries[n];
  const at = m ? menuItem(v, m) : null;

  if (!e || !at) return;

  v.follow = true;
  runAct(v, e.act, at.item, at.items, cx);
}

/** A key while the menu is open: j k ↑ ↓ move, enter runs, an entry's key runs it, esc, m and q close. */
export function menuKey(v: ProcsDeck, m: Menu, e: KeyEvent, cx: Context): void {
  const k = e.key.toLowerCase();
  const key = e.modifiers.shift && /^[a-z]$/.test(k) ? k.toUpperCase() : k === " " ? "space" : k;

  // q closes it too, as in every menu (unless an entry is q's).
  if (k === "escape" || k === "m" || (key === "q" && !m.entries.some((x) => x.key === "q"))) v.menu = null;
  else if (k === "j" || k === "down") m.n = Math.min(m.entries.length - 1, m.n + 1);
  else if ((k === "k" && !e.modifiers.shift) || k === "up") m.n = Math.max(0, m.n - 1);
  else if (k === "enter") pick(v, m.n, cx);
  else {
    const n = m.entries.findIndex((x) => x.key === key);

    if (n < 0) return;

    pick(v, n, cx);
  }

  cx.stop_propagation();
  cx.notify();
}

/** The menu over the deck: a layer that closes it on a press outside, the box at its place. */
export function menuBox(v: ProcsDeck, t: Theme, m: Menu): Element {
  const at = menuPlace(m, m.entries.length, { w: v.width, h: v.deckH() - 2 });
  const keyW = Math.max(30, ...m.entries.map((x) => x.key.length * 7 + 12));
  const found = menuItem(v, m);
  const it = found?.item;
  const title = !it ? "" : "port" in it ? `:${it.port} ${it.name}` : it.node.kind === "proc" ? `${procOf(v, it.node.pid)?.name ?? ""} ${it.node.pid}` : it.node.kind === "term" ? it.node.address : it.node.name;

  const close = (cx: Context): void => {
    cx.stop_propagation();
    v.menu = null;
    cx.notify();
  };

  const edge = (top: boolean): Element => h_flex().absolute().left(0).right(0).h(13).items_center().text_size(11)
    .when(top, (el) => el.top(-6)).when(!top, (el) => el.bottom(-6))
    .child(div().h(1).w(8).flex_none().bg(t.accent))
    .when(top, (el) => el.child(div().flex_shrink(1).min_w(0).px(4).truncate().bg(t.background).text_color(t.foreground).child(title)))
    .child(div().h(1).flex_1().min_w(8).bg(t.accent));

  const rows = m.entries.map((x, i) => h_flex().id(`pm-${i}`).relative().h(MENU_ROW).px(10).gap(10).items_center().text_size(11).cursor_pointer()
    .on_mouse_move((_e, cx) => {
      if (m.n !== i) {
        m.n = i;
        cx.notify();
      }
    })
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => {
      cx.stop_propagation();
      pick(v, i, cx);
      v.focus();
      cx.notify();
    })
    .when(i === m.n, (el) => el.child(dither(edgeTone(t), 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(x.danger ? t.blocked : t.accent)))
    .child(div().relative().w(keyW).flex_none().text_color(x.danger ? t.blocked : t.accent).child(x.key))
    .child(div().relative().flex_1().min_w(0).truncate().text_color(i === m.n ? (x.danger ? t.blocked : t.foreground) : t.muted).child(x.label)));

  return div().id("pm-layer").absolute().top(0).left(0).size_full()
    .on_mouse_down("left", (_e, cx) => close(cx))
    .on_mouse_down("right", (_e, cx) => close(cx))
    .child(v_flex().id("pm-menu").absolute().left(at.x).top(at.y).w(MENU_W).pt(8).pb(8).bg(t.background).border_l(1).border_r(1).border_color(t.accent)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .children(rows)
      .child(edge(true)).child(edge(false)));
}
