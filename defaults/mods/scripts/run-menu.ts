// A run's menu: a right-click on a run's row opens it at the pointer, m on
// the cursor's run under its row (above it near the deck's foot): menu-place.ts.
// Its entries are what the row's chips and keys do, each with its key, which
// works without the menu too: watch (w, enter), run it again (R), stop it
// (x, it asks first, as the chip does) or remove it from the list (x). j k
// ↑ ↓ move, enter or an entry's key runs it, esc, q or m close it; a press
// beside it closes it.

import { div } from "gpui-kit";
import type { Context, Element, KeyEvent, MouseButtonEvent } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { Anchor, Rect } from "@fireflies/menu-place";
import { placeMenu } from "@fireflies/menu-place";
import type { Run } from "./runs.ts";
import { allRuns } from "./runs.ts";
import type { Act } from "./state.ts";
import { ROW, SECTION } from "./state.ts";
import { menuBox } from "@fireflies/look";
import { DECK_W, deckHeight, headHeight, unzoom } from "./place.ts";
import { band } from "./rows-view.ts";
import type { default as ScriptsDeck } from "./main.ts";

/** The open menu: its run, what it stands at (deck px: a press, or the run's row), the entry under the cursor. */
export interface RunMenu {
  readonly address: string;
  readonly at: Anchor;
  n: number;
}

/** An entry: its key, its words, what it does. */
interface Entry {
  readonly key: string;
  readonly label: string;
  readonly act: Act;
}

const MENU_W = 220;
const MENU_ROW = 22;

/** A run's entries. */
export function runEntries(r: Run): readonly Entry[] {
  return [
    { key: "w", label: r.live ? "Watch it" : "Its output", act: "watch" },
    { key: "R", label: r.live ? "Run it again (stops this one first)" : "Run it again", act: "again" },
    r.live ? { key: "x", label: "Stop it…", act: "stop" } : { key: "x", label: "Remove it from the list", act: "dismiss" },
  ];
}

/** Run `i`'s row in the deck (deck px), less how far the runs are scrolled. */
export function runRect(v: ScriptsDeck, i: number): Rect {
  const scrolled = -v.runsScroll.offset().y;

  return { x: 0, y: headHeight(v) + SECTION + i * ROW - unzoom(scrolled), w: v.width || DECK_W, h: ROW };
}

/** Opens run `i`'s menu at `at` (deck px; a key's: its row). */
export function openRunMenu(v: ScriptsDeck, i: number, at: Anchor = runRect(v, i)): void {
  const r = allRuns()[i];

  if (!r) return;

  v.cursor = i;
  v.runMenu = { address: r.address, at, n: 0 };
}

/** A right press on run `i`'s row: its menu at the press (the row's own place plus where in it). */
export function rightPress(v: ScriptsDeck, i: number, e: MouseButtonEvent): void {
  const l = e.local_position;
  const row = runRect(v, i);

  openRunMenu(v, i, l ? { x: unzoom(l.x), y: row.y + unzoom(l.y) } : row);
}

/** The menu's run, while it's still listed. */
const runOf = (m: RunMenu): Run | null => allRuns().find((r) => r.address === m.address) ?? null;

/** Runs entry `n`; the menu closes. */
function pick(v: ScriptsDeck, m: RunMenu, n: number, cx: Context): void {
  const r = runOf(m);
  const e = r ? runEntries(r)[n] : undefined;

  v.runMenu = null;

  if (r && e) v.act(e.act, r, cx);
}

/** A key while the menu is open (it takes every key). */
export function runMenuKey(v: ScriptsDeck, m: RunMenu, e: KeyEvent, cx: Context): void {
  const r = runOf(m);
  const k = e.key.toLowerCase();
  const key = e.modifiers.shift && /^[a-z]$/.test(k) ? k.toUpperCase() : k;
  const list = r ? runEntries(r) : [];

  if (!r || k === "escape" || k === "q" || k === "m") v.runMenu = null;
  else if (k === "j" || k === "down") m.n = Math.min(list.length - 1, m.n + 1);
  else if (k === "k" || k === "up") m.n = Math.max(0, m.n - 1);
  else if (k === "enter") pick(v, m, m.n, cx);
  else {
    const n = list.findIndex((x) => x.key === key);

    if (n >= 0) pick(v, m, n, cx);
  }

  cx.stop_propagation();
  cx.notify();
}

/** The open menu's layer, or nothing. */
export function runMenuLayer(v: ScriptsDeck, t: Theme): Element[] {
  const menu = v.runMenu ? runMenuView(v, t, v.runMenu) : null;

  return menu ? [menu] : [];
}

/** The menu over the deck: a layer that closes it on a press beside it, the box at its place. */
export function runMenuView(v: ScriptsDeck, t: Theme, m: RunMenu): Element | null {
  const r = runOf(m);

  if (!r) return null;

  const list = runEntries(r);
  const at = placeMenu({ width: MENU_W, height: list.length * MENU_ROW + 12 }, { width: v.width || DECK_W, height: deckHeight(v) }, m.at);

  const close = (cx: Context): void => {
    cx.stop_propagation();
    v.runMenu = null;
    cx.notify();
  };

  const rows = list.map((x, n) => band(h_flex().id(`rm-${n}`).relative().h(MENU_ROW).px(10).gap(10).items_center().text_size(11).cursor_pointer()
    .text_color(n === m.n ? t.foreground : t.muted)
    .on_mouse_move((_e, cx) => {
      if (m.n !== n) {
        m.n = n;
        cx.notify();
      }
    })
    .on_click((_e, cx) => {
      cx.stop_propagation();
      pick(v, m, n, cx);
      cx.notify();
    }), t, n === m.n)
    .child(div().relative().w(14).flex_none().text_color(t.accent).child(x.key))
    .child(div().relative().flex_1().min_w(0).truncate().child(x.label)));

  return div().id("rm-layer").absolute().inset_0()
    .on_mouse_down("left", (_e, cx) => close(cx))
    .on_mouse_down("right", (_e, cx) => close(cx))
    .child(menuBox(t, v_flex().id("rm-menu").absolute().left(at.x).top(at.y).w(MENU_W).py(6))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(div().px(10).pb(4).text_size(10).text_color(t.muted).truncate().child(r.name))
      .children(rows));
}
