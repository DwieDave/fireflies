// An entry's menu in the overview: the actions the selected request already
// has by key or click (its options, yes/no but…, answer, peek, go to, put
// away), each with its key. Where it stands (@fireflies/menu-place): at the
// press on a right-click, under the selected entry when `m` opens it, in the
// middle when that entry isn't drawn (scrolled away, not measured yet).
//
// The overview is a popup itself, so the menu is drawn inside it (an
// absolute box over the rest), not as an overlay of its own.

import { div } from "gpui-kit";
import type { Element } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import type { Theme } from "herdr";
import { Array as Arr, Option } from "effect";
import { lit, menuBox } from "@fireflies/look";
import { placeMenu } from "@fireflies/menu-place";
import type { Anchor, Box, Pt, Rect } from "@fireflies/menu-place";
import type { Item } from "./model.ts";
import type { KeyContext } from "./open.ts";
import type { PermissionRequest, QuestionRequest } from "./request.ts";

/** One entry's action: the key that does it, what it says, what it does. */
export interface MenuEntry {
  readonly key: string;
  readonly label: string;
  readonly danger?: boolean;
  readonly go: (cx: KeyContext) => void;
}

/** An open menu: the request it is for, its entries, the chosen one, where it stands. */
export interface EntryMenu {
  readonly id: string;
  readonly title: string;
  readonly entries: readonly MenuEntry[];
  readonly at: Anchor;
  sel: number;
}

/** What the overview does for a request (overview.ts), for the menu to offer. */
export interface EntryActions {
  readonly answer: (option: number, cx: KeyContext) => void;
  readonly but: (kind: "yes" | "no") => void;
  readonly ask: () => void;
  readonly peek: () => void;
  readonly goTo: () => void;
  readonly putAway: () => void;
}

/** What the menu offers for `it`: what its keys do, in the key bar's order. `perm` and `asks` are
 *  its request when this mod can answer it (overview.ts permissionOf, questionsOf). */
export function menuEntries(it: Item, perm: PermissionRequest | null, asks: QuestionRequest | null, act: EntryActions): readonly MenuEntry[] {
  const out: MenuEntry[] = [];

  if (perm !== null) {
    for (const o of perm.options) out.push({ key: String(o.n), label: o.label, danger: o.kind === "no", go: (cx) => act.answer(o.n, cx) });

    if (perm.canAmend) {
      out.push({ key: "⇥", label: "Yes, but…", go: () => act.but("yes") });

      if (Arr.some(perm.options, (o) => o.kind === "no")) out.push({ key: "⇧⇥", label: "No, but…", go: () => act.but("no") });
    }
  }

  if (asks !== null) out.push({ key: "↵", label: "Answer…", go: () => act.ask() });

  out.push({ key: "p", label: "Peek", go: () => act.peek() });
  out.push({ key: "g", label: "Go to", go: () => act.goTo() });

  if (it.type === "other" && it.status === "error") out.push({ key: "x", label: "Put away", go: () => act.putAway() });

  return out;
}

/** `r` (window px, from on_bounds_change) in the view whose top left corner is `origin` (window px), over `zoom`. */
export const rectInView = (r: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }, origin: Pt, zoom: number): Rect => {
  const z = zoom > 0 ? zoom : 1;

  return { x: (r.x - origin.x) / z, y: (r.y - origin.y) / z, w: r.width / z, h: r.height / z };
};

/** A menu key: up/down (or j k) choose, enter runs the chosen one, an entry's own key runs it,
 *  escape (or m) closes. True when the key was the menu's; `close` after a run or escape. */
export function menuKey(m: EntryMenu, key: string, shift: boolean, cx: KeyContext, close: () => void): boolean {
  const n = m.entries.length;

  if (key === "escape" || key === "m" || key === "q") {
    close();

    return true;
  }

  if (key === "down" || key === "j" || key === "up" || key === "k") {
    m.sel = (m.sel + (key === "down" || key === "j" ? 1 : -1) + n) % n;

    return true;
  }

  const tab = shift ? "⇧⇥" : "⇥";
  const label = key === "tab" ? tab : key;
  const picked = key === "enter" ? Arr.get(m.entries, m.sel) : Arr.findFirst(m.entries, (e) => e.key === label);

  return Option.match(picked, {
    onNone: () => key === "enter",
    onSome: (entry) => {
      close();
      entry.go(cx);

      return true;
    },
  });
}

const ROW = 24;
const KEY_W = 34;

/** The menu's size (layout px): a row per entry, as wide as its longest label. */
export const menuSize = (m: EntryMenu): Box => ({
  width: Math.max(180, Math.min(380, KEY_W + 36 + Math.max(...Arr.map(m.entries, (e) => e.label.length * 7)))),
  height: 30 + m.entries.length * ROW + 8,
});

/** The menu over the overview of `room` (layout px): at its anchor, rows that run on a click,
 *  the one under the pointer chosen. `close` closes it. */
export function menuView(t: Theme, m: EntryMenu, room: Box, close: () => void): Element {
  const size = menuSize(m);
  const { x, y } = placeMenu(size, room, m.at);

  const rows = Arr.map(m.entries, (e, i) => {
    const on = i === m.sel;

    const row = h_flex().id(`ov-mi-${i}`).relative().h(ROW).px(10).gap(8).items_center().cursor_pointer()
      .on_mouse_move((_e, cx) => {
        if (m.sel !== i) {
          m.sel = i;
          cx.notify();
        }
      })
      .on_click((_e, cx) => {
        cx.stop_propagation();
        close();
        e.go(cx);
        cx.notify();
      });

    return (on ? lit(t, row, true) : row)
      .child(div().relative().w(KEY_W).flex_none().text_color(t.accent).child(e.key))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(e.danger === true ? t.blocked : on ? t.foreground : t.muted).child(e.label));
  });

  return menuBox(t, v_flex().id("ov-menu").absolute().left(x).top(y).w(size.width).h(size.height).py(4).text_size(11).overflow_hidden())
    .on_mouse_down_out((_e, cx) => {
      close();
      cx.notify();
    })
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_mouse_down("right", (_e, cx) => cx.stop_propagation())
    .child(div().h(22).px(10).flex().items_center().text_color(t.dim).truncate().child(m.title))
    .children(rows);
}
