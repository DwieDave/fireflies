// Dragging a tab along the strip (tabs.ts): where it lands, and the marks
// that say so. The tabs stay put while one is dragged: the dragged tab lifts
// where it is (raised on a plate edged in the accent, a dither shadow under
// it) and a stake, a 2 px accent bar capped top and bottom, stands in the gap
// it would drop into. The pointer's half of the tab under it picks the gap
// before or after that tab; the strip's space past the last tab is the gap
// at the end. A drop lands exactly on the stake; no stake (the pointer over
// the dragged tab or its own gaps): the drop changes nothing.

import { div } from "gpui-kit";
import type { Element } from "gpui-kit";
import type { Theme } from "herdr";
import { dither } from "./kit.ts";

/** How far (window px) a press moves before it's a drag rather than a click. */
export const DRAG_START = 4;

/** A gap between tabs: before `id`, after it, or the end (`id` null). */
export interface Gap {
  readonly id: string | null;
  readonly after: boolean;
}

/** The gap the pointer is over: before `id`, after it (its right half), or
 *  the end (`id` null). `x` and `width` are the pointer's place in the tab. */
export function gapAt(id: string | null, x: number, width: number): Gap {
  return { id, after: x >= width / 2 };
}

/**
 * tab.move's index (1-based, the place it ends up in) for dropping `dragged`
 * into `gap` among the space's tabs (`order`: their ids, hidden ones too),
 * or null when the drop leaves it where it is. A gap after a tab and the gap
 * before the next one are the same place.
 */
export function dropIndex(order: readonly string[], dragged: string, gap: Gap | null | undefined): number | null {
  if (!gap || !order.includes(dragged)) return null;

  const rest = order.filter((x) => x !== dragged);
  let at: number;

  if (gap.id == null) at = rest.length;
  else {
    const i = rest.indexOf(gap.id);

    if (i < 0) return null; // over the dragged tab itself

    at = i + (gap.after ? 1 : 0);
  }

  return order.indexOf(dragged) === at ? null : at + 1;
}

/** Where the stake stands: at the left edge of a tab, or the end (null). */
export interface StakeAt {
  readonly before: string | null;
}

/**
 * Where the stake stands for a drop at `index` (dropIndex's), among the
 * shown tabs (`shown`: ids, in strip order): `{ before: id }` for the left
 * edge of that tab, `{ before: null }` for the end. A gap after a tab is drawn
 * as the gap before the next shown one, so one place always looks the same.
 */
export function stakeAt(order: readonly string[], shown: readonly string[], dragged: string, index: number | null): StakeAt | null {
  if (index == null) return null;

  const rest = order.filter((x) => x !== dragged);
  // The first shown tab at or after the landing place, else the end.
  const next = rest.slice(index - 1).find((id) => shown.includes(id));

  return { before: next ?? null };
}

/** The stake: a 2 px accent bar with 8 px caps, at the left edge of its box. */
export function stake(t: Theme): Element {
  return div().absolute().left(-3).top(4).bottom(2).w(8)
    .child(div().absolute().left(3).top(0).bottom(0).w(2).bg(t.accent))
    .child(div().absolute().left(0).right(0).top(0).h(2).bg(t.accent))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent));
}

/** The dragged tab's lift, drawn behind its words: a dither shadow, then the
 *  plate edged in the accent, both 3 px off the horizon's way. */
export function lift(t: Theme): Element[] {
  return [
    div().absolute().left(6).right(0).top(9).bottom(2).child(dither(t.ansi0, 1)),
    div().absolute().left(3).right(3).top(5).bottom(5).bg(t.background).border(1).border_color(t.accent),
  ];
}
