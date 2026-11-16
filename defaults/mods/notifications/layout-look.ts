// The look the shown layout asks for, beyond its colors (tones.ts): Nocturne's
// dithered, square one, or a plain one (Fireflies' default layout, `main`,
// upstream herdr-app's look, or a person's own). Read from what the layout
// already says, so a layout chooses it and the mods follow:
//
//   dithered()     its scrim is dithered (`"scrim": {"dither": true}`, as
//                  nocturne's is): 1-bit checker fills; else flat fills
//   square()       `"corners": "square"`; else the corners round as asked
//   flat(c, cell)  what a dither function draws instead in a plain layout:
//                  a flat layer of `c` at half strength (what the checker
//                  averages to); null where the checker stays (a dithered
//                  layout, or a coarse checker, cell > 2, that is a pattern of
//                  its own: a picture's transparency)
//   radius(n)      `n` px for a rounded box, 0 in a square layout
//
// When the layout can't be read the look is Nocturne's.
//
// This file is the source. A mod can't import another mod's files, so every
// mod listed in scripts/nocturne-mods.ts (and nocturne) carries a
// byte-identical copy; scripts/themes.test.ts fails when a copy drifts:
// for m in defaults/mods/*/layout-look.ts; do cp defaults/mods/nocturne/layout-look.ts "$m"; done

import { div } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import * as herdr from "herdr";
import type { Guarded } from "./guard.ts";
import { isBoolean, isString, object } from "./guard.ts";

/** What a layout's root says about the look. */
export interface Look {
  readonly dithered: boolean;
  readonly square: boolean;
}

/** Nocturne's look: what a layout that can't be read gets. */
const NOCTURNE: Look = { dithered: true, square: true };

/** What the look reads of a layout's root (layout()): its scrim and corners. */
const isLookRoot = object({}, { scrim: object({}, { dither: isBoolean }), corners: isString });

export type LookRoot = Guarded<typeof isLookRoot>;

/** The look a layout's root asks for. */
export const lookOf = (root: LookRoot): Look => ({ dithered: root.scrim?.dither === true, square: root.corners === "square" });

/** The shown layout's look, read now (Nocturne's when it can't be read). */
function readLook(): Look {
  const root = herdr.layout();

  return isLookRoot(root) ? lookOf(root) : NOCTURNE;
}

/** The last look worked out, by the shown layout's name: dither() asks on
 *  every row, and layout() hands over the whole tree. A switch of layout
 *  changes the name; an edit of the shown layout's scrim or corners shows
 *  from the next switch or start. */
let shownLook: { name: string; look: Look } | null = null;

/** The shown layout's look. */
export function lookNow(): Look {
  try {
    const name = herdr.shared("layout");

    if (!isString(name) || name === "") return readLook();

    if (shownLook?.name !== name) shownLook = { name, look: readLook() };

    return shownLook.look;
  } catch {
    return NOCTURNE;
  }
}

export const dithered = (): boolean => lookNow().dithered;

export const square = (): boolean => lookNow().square;

/** A dither's stand-in in a plain layout (see the top), or null. */
export function flat(color: Color, cell = 1): Element | null {
  if (cell > 2 || dithered()) return null;

  return div().absolute().top(0).left(0).size_full().bg(color).opacity(0.5);
}

/** `n` px for a rounded box; 0 where the layout's corners are square. */
export const radius = (n: number): number => (square() ? 0 : n);
