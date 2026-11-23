// @fireflies/layout-look: the look the shown layout asks for, beyond its
// colors (@fireflies/tones): Nocturne's dithered, square one, or a plain one
// (Fireflies' default layout, `main`, upstream herdr-app's look, or a
// person's own). Read from what the layout already says, so a layout chooses
// it and the mods follow:
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
// When the layout can't be read the look is Nocturne's. A library
// (docs/effect-mods.md): the app serves this one copy to every mod by name
// (`import { flat } from "@fireflies/layout-look"`).

import { Option, Schema } from "effect";
import { sharedKey } from "@fireflies/kit";
import { div } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import * as herdr from "herdr";

/** What a layout's root says about the look. */
export interface Look {
  readonly dithered: boolean;
  readonly square: boolean;
}

/** Nocturne's look: what a layout that can't be read gets. */
const NOCTURNE: Look = { dithered: true, square: true };

/** What the look reads of a layout's root (layout()): its scrim and corners,
 *  each left out or in this shape (the rest of the layout isn't looked at). */
const LookRootSchema = Schema.Struct({
  scrim: Schema.optionalKey(Schema.Struct({ dither: Schema.optionalKey(Schema.Boolean) })),
  corners: Schema.optionalKey(Schema.String),
});

export type LookRoot = typeof LookRootSchema.Type;

const decodeRoot = Schema.decodeUnknownOption(LookRootSchema);

/** The shown layout's name, as shared("layout") holds it. */
const LAYOUT = sharedKey("layout", Schema.NonEmptyString);

/** The look a layout's root asks for. */
export const lookOf = (root: LookRoot): Look => ({ dithered: root.scrim?.dither === true, square: root.corners === "square" });

/** The app's answer, or none when the call threw (a window going away, a test without it). */
function attempt<A>(read: () => A): Option.Option<A> {
  try {
    return Option.some(read());
  } catch {
    return Option.none();
  }
}

/** The shown layout's look, read now (Nocturne's when it can't be read). */
const readLook = (): Look => Option.match(Option.flatMap(attempt(() => herdr.layout()), decodeRoot), { onNone: () => NOCTURNE, onSome: lookOf });

/** The last look worked out, by the shown layout's name: dither() asks on
 *  every row, and layout() hands over the whole tree. A switch of layout
 *  changes the name; an edit of the shown layout's scrim or corners shows
 *  from the next switch or start. */
let shownLook: { readonly name: string; readonly look: Look } | null = null;

const decodeName = Schema.decodeUnknownOption(LAYOUT.schema);

/** The last value of the app's "layout" key and the name it decoded to: the
 *  schema runs when the value changes, not on every ask (dither() asks on
 *  every plate of every row of a draw). */
let shownName: { readonly raw: unknown; readonly name: Option.Option<string> } | null = null;

function nameNow(): Option.Option<string> {
  const raw = Option.getOrUndefined(attempt(() => herdr.shared(LAYOUT.name)));

  if (shownName !== null && shownName.raw === raw) return shownName.name;

  const name = decodeName(raw);

  shownName = { raw, name };

  return name;
}

/** The shown layout's look. */
export function lookNow(): Look {
  return Option.match(nameNow(), {
    onNone: readLook,
    onSome: (name) => {
      if (shownLook?.name !== name) shownLook = { name, look: readLook() };

      return shownLook.look;
    },
  });
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
