// The pointer's own firefly (sky.js): while the pointer is over the sidebar,
// open or folded, it carries a firefly's light. A wide faint dithered halo
// (art/lantern.svg) around a heart, a four-point twinkle like the brightest
// stars, at the pointer's tip, in the theme's ansi11, a firefly's
// yellow-green that no status uses; within its inner
// reach the night's own pixels (stars, haze, the grass rim) light up in that
// color, in two square steps. It sits behind every name, plate and tick and
// above the backdrop, so text stays on top of it.
//
//   moves    trails the pointer by TRAIL ms, as a firefly drifts after it
//   glows    the halo breathes slowly; the heart flashes in a firefly's
//            rhythm: dark, then a quick glow
//   calm     (flight.js: the window isn't in front, or less motion is asked
//            for) it holds still: no breathing, no flashing, no trail
//   leaves   when the pointer leaves the sidebar it fades out
//
// It is a nested view (cx.new): a move rebuilds only this layer (about 0.1 ms
// of script), never the sky (about 4 ms), and moves inside one 2 px cell send
// nothing (sky.js pointer()).

import { View, div, svg } from "gpui-kit";
import { theme } from "herdr";
import { ART } from "./kit.js";

// The halo's half-width (lantern.svg is 112 px), the lit night's two steps
// (half-width, opacity). Readable first: the halo's dots stay darker than
// the sky's dimmest words, so only the heart is bright, and it's 6 px, its
// middle on the pointer's tip, under the arrow.
const R = 56;
const LIT = [[40, 0.35], [24, 0.7]];
// The trail; how long it takes to fade out once the pointer leaves (ms).
const TRAIL = { duration: 180, easing: "ease-out" };
const FADE = 360;
// The halo breathes (period, ms; opacity there and back), its dots always
// darker than the sky's dimmest words; the heart flashes.
const BREATHE = { from: 0.24, to: 0.4, period: 2600, easing: "ease-in-out" };
const FLASH = { from: 0.15, to: 1, period: 1900, easing: "ease-in" };
// Calm: held at these.
const STILL = { halo: 0.32, heart: 0.8 };

/** Where the glow goes for a pointer at `local` in the sky (as drawn, so
 *  zoomed): layout px, snapped to the art's 2 px cells, so the dither stays on
 *  its grid and moves inside one cell change nothing. */
export function placeGlow(local, zoom = 1) {
  const z = Number(zoom) || 1;
  const snap = (v) => Math.round((Number(v) || 0) / z / 2) * 2;
  return { x: snap(local?.x), y: snap(local?.y) };
}

/** The glow's next place for a pointer move (`local`: where in the sky, as
 *  drawn; null: it left), or null when nothing changes. `was`: what it has
 *  now ({ on, x, y, calm }). Leaving keeps it where it was, fading there. */
export function nextGlow(was, local, zoom, calm) {
  if (!local) return was?.on ? { on: false, x: was.x, y: was.y, calm: Boolean(calm) } : null;
  const at = { on: true, ...placeGlow(local, zoom), calm: Boolean(calm) };
  if (was?.on && at.x === was.x && at.y === was.y && at.calm === Boolean(was.calm)) return null;
  return at;
}

/** How long after the pointer left the faded glow leaves the tree (ms). */
export const GONE_AFTER = FADE + 40;

/** The glow, drawn: what the nested view renders for its props
 *  { on, x, y, calm, gone, folded, h, lift, ox?, oy? } (the sky's height and
 *  how far its hills sit above its foot, layout px; folded: the rail, no
 *  haze; ox / oy: where the box it's drawn in sits in the sky, when that box
 *  isn't the sky).
 *  Gone, or never shown: nothing, so no loop runs while it can't be seen. */
export function drawGlow(t, p) {
  if (p.gone || (!p.on && p.x == null)) return div();
  const still = p.calm || !p.on;
  const light = t.ansi11;
  const follow = (el) => (p.calm ? el : el.transition("left", TRAIL).transition("top", TRAIL));
  // The night lit: copies of the backdrop in the light's color, each moved
  // against its window so it stays on the backdrop, the trail too.
  const h = p.h ?? 800, lift = p.lift ?? 0;
  const lit = LIT.map(([s, o], k) => {
    const ox = p.x - s, oy = p.y - s;
    const art = (name, i) => follow(svg(`${ART}/${name}.svg`).id(`fireglow-lit-${k}-${i}`).absolute().left(-ox).w(480));
    return div().absolute().left(R - s).top(R - s).size(2 * s).overflow_hidden().opacity(o)
      .child(art("stars", 0).top(-oy).h(900).text_color(light))
      .when(!p.folded, (el) => el.child(art("haze", 1).top(h - lift - 1400 - oy).h(1400).text_color(light).opacity(0.5)))
      .child(art("hills-fill", 2).top(h - lift - 144 - oy).h(144).text_color(t.background))
      .child(art("hills-rim", 3).top(h - lift - 144 - oy).h(144).text_color(light));
  });
  const halo = svg(`${ART}/lantern.svg`).absolute().left(0).top(0).size(2 * R).text_color(light);
  // The heart: a 2 px cell and one cell each way, on the art's grid.
  const heart = div().absolute().left(R - 3).top(R - 3).size(6)
    .child(div().absolute().left(0).top(2).w(6).h(2).bg(light))
    .child(div().absolute().left(2).top(0).w(2).h(6).bg(light));
  // Drawn in a box inside the sky (the rail's space list), it's moved by that box's place in it.
  let el = follow(div().id("fireglow").absolute().left(p.x - R - (p.ox ?? 0)).top(p.y - R - (p.oy ?? 0)).size(2 * R));
  el = p.on ? el.opacity(1) : el.opacity(0).transition("opacity", { duration: FADE, easing: "ease-out" });
  return el.children(lit)
    .child(still ? halo.opacity(STILL.halo) : halo.loop("opacity", BREATHE))
    .child(still ? heart.opacity(STILL.heart) : heart.loop("opacity", FLASH));
}

/** The nested view (sky.js makes it with cx.new and feeds it set_props). */
export class Fireglow extends View {
  init(props) { this.p = props ?? {}; }
  update(props) { this.p = props ?? {}; }
  render() { return drawGlow(theme(), this.p); }
}
