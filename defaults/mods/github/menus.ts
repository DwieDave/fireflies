// Where the window's menus stand (menu-place.ts): a right-click's at the press,
// a key's beside what it belongs to (the selected row, the selected card),
// nothing known yet in the middle. A list or a board says where it was drawn
// (`keepBox`, window px, from its on_bounds_change); a row in it is found by
// its index, its height and how far the list is scrolled.

import type { Anchor, Rect } from "@fireflies/menu-place";
import type { Host } from "./host.ts";
import { unzoom } from "./kit.ts";

/** A list's scroll handle: how far its content is moved (window px, negative down). */
interface Scrolled {
  offset(): { readonly x: number; readonly y: number };
}

/** A drawn element's bounds, as on_bounds_change gives them (window px). */
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Bounds as a rectangle. */
export const rectOf = (b: Bounds): Rect => ({ x: b.x, y: b.y, w: b.width, h: b.height });

/** Row `i` (each `h` layout px tall, the first `top` px down) of the list `id`, in the body: what a
 *  key's menu stands beside. Null (the middle) before the list was drawn or with no row chosen. */
export function rowAt(app: Host, id: string, i: number, h: number, scroll: Scrolled | null, top = 0): Anchor {
  const box = app.boxOf(id);

  if (box === null || i < 0) return null;

  const y = box.y + top + i * h + (scroll === null ? 0 : unzoom(scroll.offset().y));

  // A row scrolled out of sight: the menu stands at the list's edge it went past.
  return { x: box.x, y: Math.max(box.y, Math.min(box.y + box.h - h, y)), w: box.w, h };
}

/** The element `id` (a card on a board), in the body: what a key's menu stands beside. */
export const boxAt = (app: Host, id: string): Anchor => app.boxOf(id);
