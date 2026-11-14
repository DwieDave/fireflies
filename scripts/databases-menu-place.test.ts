// Where a menu opens (defaults/mods/databases/menu-place.ts, the same file the
// Kubernetes mod carries): at a press, its top left corner just past the
// press, flipped left or up near the view's right and bottom edges, never
// under the press, whole inside the view; at a row or a node (a key opened
// it), under it, above it near the foot; nothing: the middle. A press in
// window px taken into the view's layout px at zoom 1 and Developer's 0.9.
import { describe, expect, test } from "bun:test";
import { GAP, MARGIN, inView, originOf, placeMenu } from "../defaults/mods/databases/menu-place.ts";

const room = { width: 1000, height: 700 };
const menu = { width: 300, height: 200 };

/** Whether the menu at `at` covers the point `p`. */
const covers = (at: { x: number; y: number }, p: { x: number; y: number }) =>
  p.x >= at.x && p.x <= at.x + menu.width && p.y >= at.y && p.y <= at.y + menu.height;

/** Whether the menu at `at` is whole inside the room, its margin kept. */
const whole = (at: { x: number; y: number }) =>
  at.x >= MARGIN && at.y >= MARGIN && at.x + menu.width <= room.width - MARGIN && at.y + menu.height <= room.height - MARGIN;

describe("a menu the pointer opened", () => {
  test("in the open: its top left corner just right of and below the press", () => {
    expect(placeMenu(menu, room, { x: 100, y: 120 })).toEqual({ x: 100 + GAP, y: 120 + GAP });
  });

  test("near each corner: flipped away from the edge, whole, never under the press", () => {
    const corners = [
      { x: 20, y: 20 },
      { x: 980, y: 20 },
      { x: 20, y: 690 },
      { x: 980, y: 690 },
    ];
    const got = corners.map((p) => placeMenu(menu, room, p));

    expect(got).toEqual([
      { x: 20 + GAP, y: 20 + GAP },
      { x: 980 - GAP - 300, y: 20 + GAP },
      { x: 20 + GAP, y: 690 - GAP - 200 },
      { x: 980 - GAP - 300, y: 690 - GAP - 200 },
    ]);

    for (const [i, at] of got.entries()) {
      expect(whole(at)).toBe(true);
      expect(covers(at, corners[i] ?? { x: 0, y: 0 })).toBe(false);
    }
  });

  test("right at an edge (closer than the margin): still whole", () => {
    const at = placeMenu(menu, room, { x: 2, y: 3 });

    expect(at).toEqual({ x: MARGIN, y: MARGIN });
    expect(whole(at)).toBe(true);
  });

  test("a menu taller than either side of the press: kept whole, beside the press", () => {
    const tall = { width: 300, height: 600 };
    const at = placeMenu(tall, room, { x: 400, y: 350 });

    expect(at.y).toBe(room.height - MARGIN - 600);
    expect(at.x).toBe(400 + GAP);
  });

  test("a menu wider than the view: at the margin", () => {
    expect(placeMenu({ width: 2000, height: 100 }, room, { x: 500, y: 100 }).x).toBe(MARGIN);
  });
});

describe("a menu a key opened", () => {
  const row = { x: 220, y: 300, w: 600, h: 22 };

  test("under its row at the row's left edge", () => {
    expect(placeMenu(menu, room, row)).toEqual({ x: 220, y: 322 });
  });

  test("a row near the foot: above it", () => {
    expect(placeMenu(menu, room, { ...row, y: 600 })).toEqual({ x: 220, y: 400 });
  });

  test("a node near the right edge: its right edges lined up", () => {
    expect(placeMenu(menu, room, { x: 850, y: 100, w: 120, h: 40 })).toEqual({ x: 970 - 300, y: 140 });
  });

  test("nothing to stand at: the middle", () => {
    expect(placeMenu(menu, room, null)).toEqual({ x: 350, y: Math.round(500 / 2.4) });
  });
});

describe("a press taken into the view", () => {
  // A window overlay at 0.88 of the app window sits 60 px in and 40 px down; a pane elsewhere again.
  const press = { x: 460, y: 220 };

  test("at zoom 1: the window position less the view's origin", () => {
    const origin = originOf({ position: { x: 300, y: 100 }, local_position: { x: 240, y: 60 } });

    expect(origin).toEqual({ x: 60, y: 40 });
    expect(inView(press, origin, 1)).toEqual({ x: 400, y: 180 });
  });

  test("at Developer's zoom 0.9: the layout px are the drawn px over the zoom", () => {
    const at = inView(press, { x: 60, y: 40 }, 0.9);

    expect(at.x).toBeCloseTo(400 / 0.9);
    expect(at.y).toBeCloseTo(180 / 0.9);
  });

  test("a zoom of 0 (not read yet) counts as 1", () => {
    expect(inView(press, { x: 0, y: 0 }, 0)).toEqual(press);
  });
});
