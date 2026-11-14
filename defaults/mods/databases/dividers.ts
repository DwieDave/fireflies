// Dividers between panels, dragged to resize them: the grab area (the gap
// between two panels, a dithered mark on hover, the accent line while held,
// the resize pointer), the drag (live, clamped so no panel vanishes), the
// keyboard step (+ / = grows the focused panel, - shrinks it: each of its
// edges moves out or in by STEP), the reset (a double click on a divider), and
// the sizes kept as { [divider's key]: px }, saved once a drag, a step or a
// reset ends (the owner says where, and proves what it reads back: shared
// state through its guard, the mod's store).
//
// Self-contained (it imports only gpui-kit and herdr), so another mod copies
// it as it is: the Databases window's panels (chrome.ts) and query split
// (main-view.ts) use it; the Kubernetes mod (fireflies-k8s) carries a copy.
// scripts/databases-dividers.test.ts is its test.
//
// How a view uses it:
//   const ds = new Dividers(kept, (sizes) => save(sizes));
//   const d = { key: "left", axis: "x", side: 1, min: 200, max: width - 320, start: 300 };
//   ... .child(leftPanel.w(ds.size(d))).child(divider(t, "split-left", d, ds, 6)).child(rest)
//   root: tracking(view, ds, cx => cx.notify()); keys: ds.stepAll(edges, +1 | -1)

import { div } from "gpui-kit";
import type { Color, Context, Element, MouseButtonEvent, MouseMoveEvent, Point } from "gpui-kit";
import { settings } from "herdr";
import type { Theme } from "herdr";

/** Which way a divider drags: "x" between panels side by side, "y" between stacked ones. */
export type Axis = "x" | "y";

/** A divider: the size of one panel next to it (`side` 1: the panel before it, left or above,
 *  grows as the pointer moves right or down; -1: the panel after it). `min` and `max` bound
 *  that panel now (max: the room left once the other side has its least), `start` is its size
 *  never dragged (and after a reset). */
export interface Divider {
  readonly key: string;
  readonly axis: Axis;
  readonly side: 1 | -1;
  readonly min: number;
  readonly max: number;
  readonly start: number;
}

/** The sizes kept: each divider's panel size in layout px, by the divider's key. */
export type Sizes = { readonly [key: string]: number };

/** One + / - step, in layout px. */
export const STEP = 24;

/** The grab area across a divider, at least (layout px). */
export const GRAB = 6;

/** The keys, as the ? overview and the key bar name them (the owner binds them). */
export const GROW_KEYS: readonly string[] = ["+", "="];

export const SHRINK_KEYS: readonly string[] = ["-"];

/** An edge of a focused panel: the divider, and +1 when growing that divider's size grows the
 *  focused panel (it is the sized one), -1 when it shrinks it (the panel on its other side). */
export interface Edge {
  readonly divider: Divider;
  readonly sign: 1 | -1;
}

/** A size kept inside its divider's bounds (whole px; `min` wins over a `max` below it). */
export function clampSize(d: Divider, px: number): number {
  return Math.round(Math.max(d.min, Math.min(Math.max(d.min, d.max), px)));
}

/** The app's zoom: pointer positions come back drawn, the sizes are layout px. */
function zoom(): number {
  const z = settings().zoom;

  return z > 0 ? z : 1;
}

/** A pointer position along an axis, in layout px. */
export const along = (axis: Axis, p: Point): number => (axis === "x" ? p.x : p.y) / zoom();

/** A drag going on: which divider, where the pointer and the panel started. */
interface Drag {
  readonly divider: Divider;
  readonly at: number;
  readonly from: number;
}

/** A view's dividers: the kept sizes, the drag going on, and the steps. */
export class Dividers {
  sizes: Sizes;
  drag: Drag | null = null;
  /** The divider under the pointer (its mark shows). */
  hovered: string | null = null;
  readonly #save: (sizes: Sizes) => void;

  constructor(kept: Sizes, save: (sizes: Sizes) => void) {
    this.sizes = { ...kept };
    this.#save = save;
  }

  /** The divider's panel size now: kept (or its start), inside its bounds. */
  size(d: Divider): number {
    const kept = this.sizes[d.key];

    return clampSize(d, kept !== undefined && Number.isFinite(kept) ? kept : d.start);
  }

  /** Whether `key` is being dragged. */
  dragging(key: string): boolean {
    return this.drag?.divider.key === key;
  }

  /** A press on the divider at `pointer` (layout px along its axis): the drag starts. */
  down(d: Divider, pointer: number): void {
    this.drag = { divider: d, at: pointer, from: this.size(d) };
  }

  /** The pointer moved to `pointer` (layout px along the drag's axis): the panel follows. */
  move(pointer: number): boolean {
    const g = this.drag;

    if (!g) return false;

    const px = clampSize(g.divider, g.from + (pointer - g.at) * g.divider.side);

    if (this.sizes[g.divider.key] === px) return false;

    this.sizes = { ...this.sizes, [g.divider.key]: px };

    return true;
  }

  /** The release (or the pointer leaving the view): the drag ends and the size is kept. */
  up(): boolean {
    if (!this.drag) return false;

    this.drag = null;
    this.#save(this.sizes);

    return true;
  }

  /** The divider's panel `by` px bigger (smaller when negative), kept. */
  step(d: Divider, by: number): boolean {
    const px = clampSize(d, this.size(d) + by);

    if (px === this.size(d)) return false;

    this.sizes = { ...this.sizes, [d.key]: px };
    this.#save(this.sizes);

    return true;
  }

  /** The focused panel grown (+1) or shrunk (-1) by STEP at each of its edges; false: none moved. */
  stepAll(edges: readonly Edge[], dir: 1 | -1): boolean {
    let moved = false;

    for (const e of edges) {
      const before = this.size(e.divider);
      const px = clampSize(e.divider, before + STEP * dir * e.sign);

      if (px === before) continue;

      this.sizes = { ...this.sizes, [e.divider.key]: px };
      moved = true;
    }

    if (moved) this.#save(this.sizes);

    return moved;
  }

  /** The divider back to its start size (a double click), kept. */
  reset(key: string): boolean {
    if (this.sizes[key] === undefined) return false;

    const { [key]: _gone, ...rest } = this.sizes;

    this.sizes = rest;
    this.#save(this.sizes);

    return true;
  }
}

/** The grab area between two panels: `thick` px across (the gap they leave), the resize pointer,
 *  a thin line with a grip on hover, the accent line while held; a press starts the drag, a
 *  double click resets the size. */
export function divider(t: Theme, id: string, d: Divider, ds: Dividers, thick = GRAB): Element {
  const across = Math.max(GRAB, thick);
  const x = d.axis === "x";
  const held = ds.dragging(d.key);
  const shown = held || ds.hovered === d.key;

  const line = (color: Color, w: number) => div().absolute()
    .when(x, (el) => el.top(0).bottom(0).left(Math.floor((across - w) / 2)).w(w))
    .when(!x, (el) => el.left(0).right(0).top(Math.floor((across - w) / 2)).h(w)).bg(color);

  // The grip: a short bright piece in the middle of the line.
  const grip = (color: Color) => div().absolute()
    .when(x, (el) => el.top("50%").left(Math.floor((across - 4) / 2)).w(4).h(18).mt(-9))
    .when(!x, (el) => el.left("50%").top(Math.floor((across - 4) / 2)).h(4).w(18).ml(-9)).bg(color);

  return div().id(id).relative().flex_none()
    .when(x, (el) => el.w(across).h_full().cursor_col_resize())
    .when(!x, (el) => el.h(across).w_full().cursor_row_resize())
    .on_hover((over, cx) => {
      ds.hovered = over ? d.key : ds.hovered === d.key ? null : ds.hovered;
      cx.notify();
    })
    .on_mouse_down("left", (e: MouseButtonEvent, cx: Context) => {
      cx.stop_propagation();

      if (e.click_count >= 2) {
        ds.drag = null;
        ds.reset(d.key);
      } else ds.down(d, along(d.axis, e.position));

      cx.notify();
    })
    .when(shown, (el) => el.child(line(held ? t.accent : t.ansi8, held ? 2 : 1)).child(grip(held ? t.accent : t.ansi8)));
}

/** What else the root follows besides the dividers (one handler each per element, so a view
 *  with its own drags hands them in here): true from one asks for a redraw. */
export interface Also {
  readonly move?: (e: MouseMoveEvent, cx: Context) => boolean;
  readonly up?: (cx: Context) => boolean;
  readonly leave?: (cx: Context) => boolean;
}

/** The view's root follows a drag: the pointer's moves resize, a release or leaving the view ends
 *  it (and saves), the resize pointer stays while it's held. */
export function tracking(el: Element, ds: Dividers, also: Also = {}): Element {
  const axis = ds.drag?.divider.axis ?? null;

  return el
    .when(axis === "x", (e) => e.cursor_col_resize())
    .when(axis === "y", (e) => e.cursor_row_resize())
    .on_mouse_move((e, cx) => {
      const g = ds.drag;
      const moved = g ? ds.move(along(g.divider.axis, e.position)) : false;

      if (also.move?.(e, cx) || moved) cx.notify();
    })
    .on_mouse_up("left", (_e, cx) => {
      const up = ds.up();

      if (also.up?.(cx) || up) cx.notify();
    })
    .on_hover((over, cx) => {
      if (over) return;

      const up = ds.up();

      if (also.leave?.(cx) || up) cx.notify();
    });
}
