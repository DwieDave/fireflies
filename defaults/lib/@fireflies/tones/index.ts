// @fireflies/tones: the tones the Nocturne mods draw with that the theme has
// no name for, derived from the colors it does name, so every mod follows the
// theme a person picks (moonfly, paper, their own themes/<name>.json) as
// Fireflies itself does. With moonfly each lands on the hex the mods were
// designed in. A library (docs/effect-mods.md): the app serves this one copy
// to every mod by name (`import { edge } from "@fireflies/tones"`).
//
//   edge(t)       lines, plates, dithers, the lit row, faint text: the theme's
//                 `input` (its stronger border) laid opaque over its background
//                 (moonfly: #323437; paper: #d9d9d9)
//   tone(t, k)    a step `k` of the way from the background to the edge
//                 (a zebra row, a grid's rule)
//   over(c, under)  a color with alpha laid over another, opaque "#rrggbb"

import { Option, String as Str } from "effect";
import type { Color } from "gpui-kit";
import type { Theme } from "herdr";

/** A color's red, green and blue (0..255) and its alpha (0..1). */
type Rgba = readonly [number, number, number, number];

const HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A "#rrggbb" or "#rrggbbaa" color's channels and alpha, or none. */
function parts(c: Color | undefined): Option.Option<Rgba> {
  if (c === undefined || !HEX.test(c)) return Option.none();

  const at = (i: number) => Number.parseInt(Str.slice(i, i + 2)(c), 16);

  return Option.some([at(1), at(3), at(5), c.length === 9 ? at(7) / 255 : 1]);
}

const hex2 = (v: number) => Str.padStart(2, "0")(Math.round(v).toString(16));

/** The color a step `k` (0..1) of the way from `from` to `to`, opaque. */
const between = (from: Rgba, to: Rgba, k: number): Color =>
  `#${hex2(from[0] + (to[0] - from[0]) * k)}${hex2(from[1] + (to[1] - from[1]) * k)}${hex2(from[2] + (to[2] - from[2]) * k)}`;

/** `c` laid over `under` as opaque "#rrggbb" (an opaque `c` as it is, in six
 *  digits); `c` unchanged when either isn't a hex color. */
export function over(c: Color, under: Color): Color {
  return Option.match(Option.all([parts(c), parts(under)]), {
    onNone: () => c,
    onSome: ([a, b]) => between(b, a, a[3]),
  });
}

/** The last edge worked out, by the two colors it came from: a render asks
 *  for it on every row, and the theme seldom changes. */
let last: { readonly input: Color; readonly background: Color; readonly edge: Color } | null = null;

/** The edge tone: lines, plates, dithers, the lit row, faint text. Always
 *  "#rrggbb", so `${edge(t)}55` adds an alpha of its own. */
export function edge(t: Theme): Color {
  if (last === null || last.input !== t.input || last.background !== t.background) last = { input: t.input, background: t.background, edge: over(t.input, t.background) };

  return last.edge;
}

/** A step `k` (0..1) of the way from the background to the edge. */
export function tone(t: Theme, k: number): Color {
  return Option.match(Option.all([parts(edge(t)), parts(over(t.background, t.background))]), {
    onNone: () => edge(t),
    onSome: ([e, b]) => between(b, e, k),
  });
}
