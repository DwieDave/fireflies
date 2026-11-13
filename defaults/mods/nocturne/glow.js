// The pointer's own firefly (sky.js): while the pointer is over the sidebar,
// open or folded, it carries a firefly's light. A small dithered diamond of a
// halo (art/fireglow-halo.svg) around a heart, a pixel + at the pointer's
// tip, in the theme's ansi11, a firefly's yellow-green that no status uses;
// within its inner reach the night's own pixels (stars, haze, the grass rim)
// light up in that color, in two square steps. It sits behind every name,
// plate and tick and above the backdrop, so text stays on top of it.
//
//   moves    trails the pointer by TRAIL ms, as a firefly drifts after it
//   glows    a firefly's signal, every PULSE ms: two quick blinks, then dark.
//            On each blink the heart turns from its + into a larger x, the
//            halo brightens and a square ring opens out from it; at rest
//            only the dim + and the halo show. The blinks are a few frames
//            (PULSE_FRAMES) the glow's own view steps through on timers, as a
//            sprite would: a native loop can't swap the heart's shape.
//   calm     (flight.js: the window isn't in front, or less motion is asked
//            for) it holds still: the resting +, no blinks, no trail
//   leaves   when the pointer leaves the sidebar it fades out
//
// It is a nested view (cx.new): a move rebuilds only this layer (about 0.1 ms
// of script), never the sky (about 4 ms), and moves inside one 2 px cell send
// nothing (sky.js pointer()). A blink's frames rebuild it too, nine times a
// PULSE, and never while it is calm, fading or gone.

import { View, div, svg } from "gpui-kit";
import { theme } from "herdr";
import { ART, dither } from "./kit.ts";

// The halo's half-width (fireglow-halo.svg is 48 px), the lit night's two
// steps (half-width, opacity). Readable first: the halo's dots stay darker
// than the sky's dimmest words, so only the heart is bright.
const R = 24;
const LIT = [[20, 0.3], [12, 0.6]];
// The trail; how long it takes to fade out once the pointer leaves (ms).
const TRAIL = { duration: 180, easing: "ease-out" };
const FADE = 360;
// The signal's period and its frames: [from ms, heart ("+" or "x"), its
// opacity, the halo's, the ring's size (px, 0: none) and opacity]. Two
// blinks, each a bright x with the ring opening out in four steps.
export const PULSE = 2800;
const BLINK = (at) => [
  [at, "x", 1, 0.5, 16, 0.9], [at + 80, "x", 1, 0.46, 20, 0.7],
  [at + 160, "+", 0.45, 0.34, 26, 0.45], [at + 240, "+", 0.5, 0.3, 32, 0.2],
];
export const PULSE_FRAMES = [[0, "+", 0.7, 0.24, 0, 0], ...BLINK(1860), ...BLINK(2180), [2500, "+", 0.7, 0.24, 0, 0]];
// Calm: held at rest.
const STILL = PULSE_FRAMES[0];

/** The signal's frame at `ms` into the pulse, and how long until the next one. */
export function pulseFrame(ms) {
  const t = ((ms % PULSE) + PULSE) % PULSE;
  let i = PULSE_FRAMES.length - 1;
  while (PULSE_FRAMES[i][0] > t) i--;
  const next = i + 1 < PULSE_FRAMES.length ? PULSE_FRAMES[i + 1][0] : PULSE;
  return { i, frame: PULSE_FRAMES[i], wait: next - t };
}

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
 *  { on, x, y, calm, gone, folded, h, lift, ox?, oy?, frame? } (frame: the
 *  pulse's, PULSE_FRAMES; the sky's height and
 *  how far its hills sit above its foot, layout px; folded: the rail, no
 *  haze; ox / oy: where the box it's drawn in sits in the sky, when that box
 *  isn't the sky).
 *  Gone, or never shown: nothing, so no timer runs while it can't be seen. */
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
  const [, shape, heartO, haloO, ring, ringO] = still ? STILL : (p.frame ?? STILL);
  const halo = svg(`${ART}/fireglow-halo.svg`).absolute().left(0).top(0).size(2 * R).text_color(light).opacity(haloO);
  // The heart: a + of 2 px cells, a 10 px x while it blinks, centered on the pointer's tip.
  const heart = svg(`${ART}/fireglow-${shape === "x" ? "x" : "plus"}.svg`).id("fireglow-heart").absolute().left(R - 5).top(R - 5).size(10)
    .text_color(light).opacity(heartO);
  // The ring opening out: a square of dithered 1 px sides.
  const side = (el) => el.absolute().child(dither(light, 1));
  const square = ring > 0 ? div().id("fireglow-ring").absolute().left(R - ring / 2).top(R - ring / 2).size(ring).opacity(ringO)
    .child(side(div().left(0).right(0).top(0).h(1))).child(side(div().left(0).right(0).bottom(0).h(1)))
    .child(side(div().top(0).bottom(0).left(0).w(1))).child(side(div().top(0).bottom(0).right(0).w(1))) : null;
  // Drawn in a box inside the sky (the rail's space list), it's moved by that box's place in it.
  let el = follow(div().id("fireglow").absolute().left(p.x - R - (p.ox ?? 0)).top(p.y - R - (p.oy ?? 0)).size(2 * R));
  el = p.on ? el.opacity(1) : el.opacity(0).transition("opacity", { duration: FADE, easing: "ease-out" });
  // The heart on a plate of the night, so the halo's dots don't run into its x (as the sky's fireflies sit on theirs).
  const plate = div().absolute().left(R - 7).top(R - 7).size(14).bg(t.background);
  return el.children(lit).child(halo).when(Boolean(square), (e) => e.child(square)).child(plate).child(heart);
}

/** The nested view (sky.js makes it with cx.new and feeds it set_props); it
 *  steps through the pulse's frames on timers while it shows and isn't calm. */
export class Fireglow extends View {
  init(props) { this.p = props ?? {}; this.tick = 0; }
  update(props) { this.p = props ?? {}; }
  render(cx) {
    const p = this.p;
    const lively = p.on && !p.calm && !p.gone;
    if (!lively) return drawGlow(theme(), p);
    const { frame, wait } = pulseFrame(Date.now());
    // One timer at a time: the next frame's, from the latest render.
    const tick = ++this.tick;
    cx?.timer?.after(Math.max(16, wait), (cx) => { if (this.tick === tick) cx.notify?.(); });
    return drawGlow(theme(), { ...p, frame });
  }
}
