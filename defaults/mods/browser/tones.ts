// The tones the Nocturne mods draw with that the theme has no name for,
// derived from the colors it does name, so every mod follows the theme a
// person picks (moonfly, paper, their own themes/<name>.json) as Fireflies
// itself does. With moonfly each lands on the hex the mods were designed in.
//
// This file is the source. A mod can't import another mod's files, so every
// mod listed in scripts/nocturne-mods.ts (and nocturne) carries a
// byte-identical copy; scripts/themes.test.ts fails when a copy drifts:
// for m in defaults/mods/*/tones.ts; do cp defaults/mods/nocturne/tones.ts "$m"; done
//
//   edge(t)       lines, plates, dithers, the lit row, faint text: the theme's
//                 `input` (its stronger border) laid opaque over its background
//                 (moonfly: #323437; paper: #d9d9d9)
//   tone(t, k)    a step `k` of the way from the background to the edge
//                 (a zebra row, a grid's rule)
//   over(c, under)  a color with alpha laid over another, opaque "#rrggbb"

import type { Color } from "gpui-kit";
import type { Theme } from "herdr";

/** A "#rrggbb" or "#rrggbbaa" color's channels and alpha (0..1), or null. */
function parts(c: Color | undefined): readonly [number, number, number, number] | null {
  if (c === undefined || !/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) return null;

  const at = (i: number) => parseInt(c.slice(i, i + 2), 16);

  return [at(1), at(3), at(5), c.length === 9 ? at(7) / 255 : 1];
}

const hex2 = (v: number) => Math.round(v).toString(16).padStart(2, "0");

/** `c` laid over `under` as opaque "#rrggbb" (an opaque `c` as it is, in six
 *  digits); `c` unchanged when either isn't a hex color. */
export function over(c: Color, under: Color): Color {
  const a = parts(c);
  const b = parts(under);

  if (!a || !b) return c;

  const k = a[3];

  return `#${hex2(b[0] + (a[0] - b[0]) * k)}${hex2(b[1] + (a[1] - b[1]) * k)}${hex2(b[2] + (a[2] - b[2]) * k)}`;
}

/** The last edge worked out, by the two colors it came from: a render asks
 *  for it on every row, and the theme seldom changes. */
let last: { input: Color; background: Color; edge: Color } | null = null;

/** The edge tone: lines, plates, dithers, the lit row, faint text. Always
 *  "#rrggbb", so `${edge(t)}55` adds an alpha of its own. */
export function edge(t: Theme): Color {
  if (!last || last.input !== t.input || last.background !== t.background) last = { input: t.input, background: t.background, edge: over(t.input, t.background) };

  return last.edge;
}

/** A step `k` (0..1) of the way from the background to the edge. */
export function tone(t: Theme, k: number): Color {
  const e = parts(edge(t));
  const b = parts(over(t.background, t.background));

  if (!e || !b) return edge(t);

  return `#${hex2(b[0] + (e[0] - b[0]) * k)}${hex2(b[1] + (e[1] - b[1]) * k)}${hex2(b[2] + (e[2] - b[2]) * k)}`;
}
