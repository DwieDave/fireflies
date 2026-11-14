// Where a menu opens. A menu the pointer opened stands at the press: its top
// left corner just right of and below it, flipped left or up where the view
// has no room, never under the press (a release there would pick a row), and
// whole inside the view. A menu a key opened stands at what it belongs to
// (the selected row or cell, the focused node): under it at its left edge,
// above it when there's no room below. Nothing to stand at: the middle.
//
// The press comes in window px (an event's `position`); the menu is laid out
// in the view's layout px, its top left corner the view's. So the press is
// taken less the view's origin in the window (learned from the view's own
// pointer moves: their position less their local position) and over the app's
// zoom. An element's `local_position` is no help: it is the pressed element's.
//
// Self-contained (it imports nothing), so another mod copies it as it is: the
// Databases window (popups.ts) uses it, the Kubernetes mod (fireflies-k8s
// mod/menu-place.ts) carries a copy. scripts/databases-menu-place.test.ts is
// its test.

/** A point, in whichever px the caller says. */
export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** A rectangle in the view (layout px): what a keyed menu stands at. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A size (layout px). */
export interface Box {
  readonly width: number;
  readonly height: number;
}

/** What a menu stands at: a press (a point) or a thing (a rectangle); null: the middle. */
export type Anchor = Pt | Rect | null;

/** The least room kept between a menu and the view's edges. */
export const MARGIN = 8;

/** How far from the press the menu's corner stands (so the press isn't on it). */
export const GAP = 2;

/** The view's origin in the window (window px), from a pointer event over the view itself. */
export function originOf(e: { readonly position: Pt; readonly local_position: Pt }): Pt {
  return { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y };
}

/** A press's place in the view (layout px): its window position less the view's origin, over the zoom. */
export function inView(position: Pt, origin: Pt, zoom: number): Pt {
  const z = zoom > 0 ? zoom : 1;

  return { x: (position.x - origin.x) / z, y: (position.y - origin.y) / z };
}

const isRect = (a: Pt | Rect): a is Rect => "w" in a && "h" in a;

/** Along one axis: `after` (right of / below the anchor) when the menu fits there, else `before`
 *  (left of / above it) when it fits there, else as close to the side with more room as the view
 *  allows (whole when it can be). */
function side(after: number, before: number, len: number, room: number): number {
  const most = room - MARGIN - len;

  if (after <= most) return Math.max(MARGIN, after);

  if (before >= MARGIN) return before;

  return Math.max(MARGIN, Math.min(most, after));
}

/** The menu's top left corner in the view (layout px, rounded), for a menu of `size` in a view of `room`. */
export function placeMenu(size: Box, room: Box, at: Anchor): Pt {
  if (!at) {
    return { x: Math.max(MARGIN, Math.round((room.width - size.width) / 2)), y: Math.max(MARGIN, Math.round((room.height - size.height) / 2.4)) };
  }

  if (isRect(at)) {
    return {
      x: Math.round(side(at.x, at.x + at.w - size.width, size.width, room.width)),
      y: Math.round(side(at.y + at.h, at.y - size.height, size.height, room.height)),
    };
  }

  return {
    x: Math.round(side(at.x + GAP, at.x - GAP - size.width, size.width, room.width)),
    y: Math.round(side(at.y + GAP, at.y - GAP - size.height, size.height, room.height)),
  };
}
