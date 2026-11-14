// Drags inside the window, by hand (gpui-kit drags only files from outside):
// a press on something draggable notes what it carries; once the pointer has
// moved a few px it's a drag, a ghost follows it with its label, and what
// it's over (a drop target says so by hover) is where it lands on the release.
// A press that never moved is a click. What drags: a table's or column's
// name (into a query's editor, a table onto the Rows tab), a query tab and a
// saved connection (to reorder them), a grid's header (to move the column; its
// right edge: the width), cells and row numbers (a range). Nothing that writes
// to a database starts from a drop. A target hears the pointer's moves (not
// its hover): overTarget marks it, the root's move reads it after.
//
// The view's root follows the pointer (main.ts: dividers.ts tracking's
// hooks); targets mark themselves with dropTarget().

import { div } from "gpui-kit";
import type { Context, Element, MouseButtonEvent, MouseMoveEvent, Point } from "gpui-kit";
import type { Theme } from "herdr";
import { dither, unzoom } from "./kit.ts";

/** Past this many layout px a press is a drag. */
export const DRAG_FROM = 4;

/** What a press carries and what its drop or click does. */
export interface Press {
  readonly kind: "name" | "tab" | "conn" | "column" | "width" | "cells" | "rows";
  /** Where it started (window, layout px). */
  readonly from: Point;
  /** The ghost's text while it's dragged (none: no ghost). */
  readonly label?: string;
  /** The drag moved the pointer (layout px from `from`): live work (a width). */
  readonly move?: (dx: number, dy: number, cx: Context) => void;
  /** The pointer is over a target now (a range follows it). */
  readonly over?: (target: string, cx: Context) => void;
  /** Released after a drag, over `target` (null: over nothing that takes it). */
  readonly drop?: (target: string | null, cx: Context) => void;
  /** Released without a drag. */
  readonly click?: (cx: Context) => void;
  /** Which targets take it (a key's prefix: "editor:", "tab:"). */
  readonly takes: readonly string[];
}

/** A press going on: what it carries, whether it's a drag, what it's over, where the ghost is. */
export interface Pressing extends Press {
  moved: boolean;
  target: string | null;
  /** The target the pointer's last move went over (targets say so before the view hears it). */
  hit: string | null;
  at: Point;
}

/** What owns the presses (the view). */
export interface PressOwner {
  press: Pressing | null;
}

/** A press starts at `e`. */
export function pressAt(o: PressOwner, e: Pick<MouseButtonEvent, "position">, p: Omit<Press, "from">): void {
  const from = { x: unzoom(e.position.x), y: unzoom(e.position.y) };

  o.press = { ...p, from, moved: false, target: null, hit: null, at: from };
}

/** The pointer moved over the view: a press becomes a drag past DRAG_FROM. `local`: the
 *  pointer inside the view (where the ghost goes). True: redraw. */
export function pressMove(o: PressOwner, e: Pick<MouseMoveEvent, "position"> & { readonly local_position?: Point }, cx: Context): boolean {
  const p = o.press;

  if (!p) return false;

  const x = unzoom(e.position.x), y = unzoom(e.position.y);
  const dx = x - p.from.x, dy = y - p.from.y;
  // The targets heard this move first (a child's handler runs before the root's): what it's over now.
  const hit = p.hit;
  const changed = hit !== p.target;

  p.hit = null;

  if (changed) {
    p.target = hit;

    if (hit) p.over?.(hit, cx);
  }

  if (!p.moved && Math.hypot(dx, dy) < DRAG_FROM) return changed;

  p.moved = true;
  p.at = e.local_position ? { x: unzoom(e.local_position.x), y: unzoom(e.local_position.y) } : { x, y };
  p.move?.(dx, dy, cx);

  return true;
}

/** The release: the drop (after a drag) or the click. True: something happened. */
export function pressUp(o: PressOwner, cx: Context): boolean {
  const p = o.press;

  if (!p) return false;

  o.press = null;

  if (p.moved) p.drop?.(p.target, cx);
  else p.click?.(cx);

  return true;
}

/** The pointer left the view: the press is dropped (a width drag keeps what it reached). */
export function pressLeave(o: PressOwner, cx: Context): boolean {
  const p = o.press;

  if (!p) return false;

  o.press = null;

  if (p.moved && p.kind === "width") p.drop?.(null, cx);

  return true;
}

/** Whether `target` takes the press going on. */
export const takes = (p: Press | null, target: string): boolean => Boolean(p?.takes.some((t) => target.startsWith(t)));

/** The pointer moved over a drop target (before the view's root hears the same move). */
export function overTarget(o: PressOwner, target: string): void {
  const p = o.press;

  if (p && takes(p, target)) p.hit = target;
}

/** An element as a drop target: it says when the pointer moves over it (a move, not a hover:
 *  GPUI holds an element's hover off while it is pressed), and shows it takes the drag. */
export function dropTarget(t: Theme, el: Element, o: PressOwner, target: string, mark = true): Element {
  const p = o.press;
  const lit = mark && p?.moved === true && p.target === target && takes(p, target);

  return el.on_mouse_move(() => overTarget(o, target))
    .when(lit, (x) => x.child(div().absolute().inset_0().border_1().border_color(t.accent)));
}

/** The ghost under the pointer while a press with a label is dragged. */
export function ghost(t: Theme, o: PressOwner): Element | null {
  const p = o.press;

  if (!p?.moved || !p.label) return null;

  return div().id("db-ghost").absolute().left(p.at.x + 12).top(p.at.y + 10).h(20).px(8).flex().items_center()
    .bg(t.background).border_1().border_color(p.target ? t.accent : t.ansi8).text_size(11).text_color(t.foreground)
    .child(div().absolute().inset_0().child(dither(`${t.ansi0}88`, 1)))
    .child(div().relative().max_w(320).truncate().child(p.label));
}
