// How the player's bar looks where the theme leaves it to us: the seams'
// tone (seamTone, a step darker than the icons' dim) and each glyph's lift
// onto the bar's middle line (GLYPH_DROP, lift).

import type { Color } from "gpui-kit";
import type { Theme } from "herdr";

/** Two "#rrggbb" colors mixed, `k` of the way from `a` to `b`; `a` when either
 *  isn't one (../nocturne/toolground.ts's mix: a mod can't import another's files). */
export function mix(a: Color, b: Color, k: number): Color {
  const ch = (c: Color) => (/^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null);
  const x = ch(a);
  const y = ch(b);

  if (!x || !y) return a;

  return `#${x.map((v, i) => Math.round(v + ((y[i] ?? v) - v) * k).toString(16).padStart(2, "0")).join("")}`;
}

/** The seams' and the ⋯ menu's rules' tone: a third of the way from the
 *  icons' dim to ansi0, the bar's hover (moonfly: #5f6d6d → #505a5b). One
 *  step darker than the dim they had, still there. */
export const seamTone = (t: Theme): Color => mix(t.dim, t.ansi0, 1 / 3);

/**
 * How far each glyph's ink sits below the middle of its box, in em. An svg
 * centres its drawing on its box; a glyph sits by its font's line box, and
 * each one's ink lands differently. Measured on the bar at zoom 0.9 (2×
 * pixels, 11 px text: 19.8 px to the em), where ❚❚ and ◧ sat 1.6 px low, ⇱
 * 1.5, ✕ 1, ↩ « » ⤓ about 0.5, and ? 0.5 high (▶ and ⋯ weren't on the
 * shot: none). In em, so the lift scales
 * with the text size and the zoom: the same at zoom 1, and in the ⋯ menu.
 */
export const GLYPH_DROP: ReadonlyMap<string, number> = new Map([
  ["↩", 0.035], ["«", 0.025], ["❚❚", 0.08], ["»", 0.025], ["◧", 0.085], ["⤓", 0.025], ["⇱", 0.075], ["?", -0.025], ["✕", 0.05],
]);

/** How far up a glyph is moved at text size `size` (px) to centre its ink. */
export const lift = (glyph: string, size: number): number => Math.round((GLYPH_DROP.get(glyph) ?? 0) * size * 100) / 100;
