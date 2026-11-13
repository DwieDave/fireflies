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
import type { Context, Element } from "gpui-kit";
import type { Props, TransitionPolicy } from "gpui-shell";
import { theme } from "herdr";
import type { Theme } from "herdr";
import { isBoolean, isNumber, literal, nullable, object } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import { isList } from "./guards.ts";
import { ART, dither } from "./kit.ts";

// The halo's half-width (fireglow-halo.svg is 48 px), the lit night's two
// steps (half-width, opacity). Readable first: the halo's dots stay darker
// than the sky's dimmest words, so only the heart is bright.
const R = 24;
const LIT: readonly (readonly [number, number])[] = [[20, 0.3], [12, 0.6]];

// The trail; how long it takes to fade out once the pointer leaves (ms).
const TRAIL: TransitionPolicy = { duration: 180, easing: "ease-out" };
const FADE = 360;

/** The heart's shape: a + at rest, an x on a blink. */
const isHeart = literal("+", "x");

/** A frame of the signal: [from ms, heart, its opacity, the halo's, the ring's size (px, 0: none) and opacity]. */
export type Frame = readonly [number, Guarded<typeof isHeart>, number, number, number, number];

/** A frame, as the sky hands it on in the glow's props. */
const isFrame = (value: unknown): value is Frame =>
  isList(value) && value.length === 6 && isNumber(value[0]) && isHeart(value[1]) && isNumber(value[2]) && isNumber(value[3]) && isNumber(value[4]) && isNumber(value[5]);

// The signal's period and its frames. Two blinks, each a bright x with the
// ring opening out in four steps.
export const PULSE = 2800;

const BLINK = (at: number): Frame[] => [
  [at, "x", 1, 0.5, 16, 0.9], [at + 80, "x", 1, 0.46, 20, 0.7],
  [at + 160, "+", 0.45, 0.34, 26, 0.45], [at + 240, "+", 0.5, 0.3, 32, 0.2],
];

// Calm: held at rest.
const STILL: Frame = [0, "+", 0.7, 0.24, 0, 0];

export const PULSE_FRAMES: readonly Frame[] = [STILL, ...BLINK(1860), ...BLINK(2180), [2500, "+", 0.7, 0.24, 0, 0]];

/** A frame of the pulse: which, the frame, and how long until the next one (ms). */
export interface PulseAt {
  readonly i: number;
  readonly frame: Frame;
  readonly wait: number;
}

/** The signal's frame at `ms` into the pulse, and how long until the next one. */
export function pulseFrame(ms: number): PulseAt {
  const t = ((ms % PULSE) + PULSE) % PULSE;
  let i = PULSE_FRAMES.length - 1;

  while (i > 0 && (PULSE_FRAMES[i]?.[0] ?? 0) > t) i--;

  const next = PULSE_FRAMES[i + 1]?.[0] ?? PULSE;

  return { i, frame: PULSE_FRAMES[i] ?? STILL, wait: next - t };
}

/** A place in the sky (layout px). */
export interface GlowAt {
  readonly x: number;
  readonly y: number;
}

/** Where the glow goes for a pointer at `local` in the sky (as drawn, so
 *  zoomed): layout px, snapped to the art's 2 px cells, so the dither stays on
 *  its grid and moves inside one cell change nothing. */
export function placeGlow(local: { readonly x: number; readonly y: number } | null | undefined, zoom = 1): GlowAt {
  const z = zoom || 1;
  const snap = (v: number | undefined) => Math.round((v || 0) / z / 2) * 2;

  return { x: snap(local?.x), y: snap(local?.y) };
}

/** The glow's place now: shown or leaving, where, and whether calm. */
export interface GlowPlace {
  readonly on: boolean;
  readonly x: number;
  readonly y: number;
  readonly calm: boolean;
}

/** The glow's next place for a pointer move (`local`: where in the sky, as
 *  drawn; null: it left), or null when nothing changes. `was`: what it has
 *  now ({ on, x, y, calm }). Leaving keeps it where it was, fading there. */
export function nextGlow(was: GlowPlace | null | undefined, local: { readonly x: number; readonly y: number } | null | undefined, zoom: number, calm: boolean): GlowPlace | null {
  if (!local) return was?.on ? { on: false, x: was.x, y: was.y, calm: Boolean(calm) } : null;

  const at = { on: true, ...placeGlow(local, zoom), calm: Boolean(calm) };

  if (was?.on && at.x === was.x && at.y === was.y && at.calm === Boolean(was.calm)) return null;

  return at;
}

/** How long after the pointer left the faded glow leaves the tree (ms). */
export const GONE_AFTER = FADE + 40;

/** The glow's props (the sky's set_props): see drawGlow. */
const isGlowProps = object({}, {
  on: isBoolean, x: nullable(isNumber), y: nullable(isNumber), calm: isBoolean, gone: isBoolean, folded: isBoolean,
  h: isNumber, lift: isNumber, ox: isNumber, oy: isNumber, frame: isFrame,
});

export type GlowProps = Guarded<typeof isGlowProps>;

/** The glow, drawn: what the nested view renders for its props
 *  { on, x, y, calm, gone, folded, h, lift, ox?, oy?, frame? } (frame: the
 *  pulse's, PULSE_FRAMES; the sky's height and
 *  how far its hills sit above its foot, layout px; folded: the rail, no
 *  haze; ox / oy: where the box it's drawn in sits in the sky, when that box
 *  isn't the sky).
 *  Gone, or never shown: nothing, so no timer runs while it can't be seen. */
export function drawGlow(t: Theme, p: GlowProps): Element {
  if (p.gone || (!p.on && p.x == null)) return div();

  const x = p.x ?? 0;
  const y = p.y ?? 0;
  const still = p.calm || !p.on;
  const light = t.ansi11;
  const follow = (el: Element) => (p.calm ? el : el.transition("left", TRAIL).transition("top", TRAIL));
  // The night lit: copies of the backdrop in the light's color, each moved
  // against its window so it stays on the backdrop, the trail too.
  const h = p.h ?? 800;
  const lift = p.lift ?? 0;

  const lit = LIT.map(([s, o], k) => {
    const ox = x - s;
    const oy = y - s;
    const art = (name: string, i: number) => follow(svg(`${ART}/${name}.svg`).id(`fireglow-lit-${k}-${i}`).absolute().left(-ox).w(480));

    return div().absolute().left(R - s).top(R - s).size(2 * s).overflow_hidden().opacity(o)
      .child(art("stars", 0).top(-oy).h(900).text_color(light))
      .when(!p.folded, (el) => el.child(art("haze", 1).top(h - lift - 1400 - oy).h(1400).text_color(light).opacity(0.5)))
      .child(art("hills-fill", 2).top(h - lift - 144 - oy).h(144).text_color(t.background))
      .child(art("hills-rim", 3).top(h - lift - 144 - oy).h(144).text_color(light));
  });

  const [, heartMark, heartO, haloO, ring, ringO] = still ? STILL : (p.frame ?? STILL);
  const halo = svg(`${ART}/fireglow-halo.svg`).absolute().left(0).top(0).size(2 * R).text_color(light).opacity(haloO);

  // The heart: a + of 2 px cells, a 10 px x while it blinks, centered on the pointer's tip.
  const heart = svg(`${ART}/fireglow-${heartMark === "x" ? "x" : "plus"}.svg`).id("fireglow-heart").absolute().left(R - 5).top(R - 5).size(10)
    .text_color(light).opacity(heartO);

  // The ring opening out: a square of dithered 1 px sides.
  const side = (el: Element) => el.absolute().child(dither(light, 1));

  const square = ring > 0 ? div().id("fireglow-ring").absolute().left(R - ring / 2).top(R - ring / 2).size(ring).opacity(ringO)
    .child(side(div().left(0).right(0).top(0).h(1))).child(side(div().left(0).right(0).bottom(0).h(1)))
    .child(side(div().top(0).bottom(0).left(0).w(1))).child(side(div().top(0).bottom(0).right(0).w(1))) : null;

  // Drawn in a box inside the sky (the rail's space list), it's moved by that box's place in it.
  const box = follow(div().id("fireglow").absolute().left(x - R - (p.ox ?? 0)).top(y - R - (p.oy ?? 0)).size(2 * R));
  const el = p.on ? box.opacity(1) : box.opacity(0).transition("opacity", { duration: FADE, easing: "ease-out" });
  // The heart on a plate of the night, so the halo's dots don't run into its x (as the sky's fireflies sit on theirs).
  const plate = div().absolute().left(R - 7).top(R - 7).size(14).bg(t.background);

  return el.children(lit).child(halo).when(Boolean(square), (e) => (square ? e.child(square) : e)).child(plate).child(heart);
}

/** The glow's props as handed over: proven, else none. */
const glowProps = (props: Props | undefined): GlowProps => (isGlowProps(props) ? props : {});

/** The nested view (sky.js makes it with cx.new and feeds it set_props); it
 *  steps through the pulse's frames on timers while it shows and isn't calm. */
export class Fireglow extends View {
  p: GlowProps = {};
  tick = 0;

  override init(props: Props | undefined): void {
    this.p = glowProps(props);
    this.tick = 0;
  }

  override update(props: Props | undefined): void {
    this.p = glowProps(props);
  }

  override render(cx: Context): Element {
    const p = this.p;
    const lively = p.on && !p.calm && !p.gone;

    if (!lively) return drawGlow(theme(), p);

    const { frame, wait } = pulseFrame(Date.now());
    // One timer at a time: the next frame's, from the latest render.
    const tick = ++this.tick;

    cx.timer.after(Math.max(16, wait), (later) => {
      if (this.tick === tick) later.notify();
    });

    return drawGlow(theme(), { ...p, frame });
  }
}
