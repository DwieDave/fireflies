// How a firefly flies and glows, by status (sky.ts draws them).
//
//   working   drifts on a slow looping path: two swings at unrelated
//             periods, so the path keeps turning (a lazy figure eight that
//             never quite repeats), and flashes the way fireflies do: dark
//             most of the time, a short glow, in its own rhythm
//   blocked   the same path, faster and wider, glowing bright and quick
//   done      settles: no flight, a dim glow that breathes slowly
//   idle      rests in the grass, blinking now and then, faintly
//
// Only the firefly moves; its name stays put, so it reads at a glance.
// Every loop runs natively (about 30 fps, only while drawn). Calm (the
// window isn't the active one, or the system asks for less motion): nothing
// flies; glows hold still at what they say (reduced motion keeps only the
// blocked one's blink: that's the news). Each agent's periods come from its
// address, so no two fly in step.

import { div } from "gpui-kit";
import type { Element } from "gpui-kit";
import type { MotionEasing } from "gpui-shell";
import { exec, window as appWindow } from "herdr";
import type { Status } from "herdr";

/** A glow's flash: its opacity range, period and easing. */
interface Glow {
  readonly glow: readonly [number, number];
  readonly pg: number;
  readonly ease: MotionEasing;
  /** It doesn't fly. */
  readonly x?: undefined;
}

/** A glow that flies too: its swing (px) and periods (ms) left and top. */
interface Flying extends Omit<Glow, "x"> {
  readonly x: number;
  readonly y: number;
  readonly px: number;
  readonly py: number;
}

/** Each status's glow; working and blocked fly too. */
interface Flights {
  readonly working: Flying;
  readonly blocked: Flying;
  readonly done: Glow;
  readonly idle: Glow;
}

const FLIGHT: Flights = {
  working: { x: 3, y: 3, px: 5200, py: 3100, glow: [0.15, 1], pg: 2100, ease: "ease-in" },
  blocked: { x: 4, y: 3, px: 1700, py: 940, glow: [0.35, 1], pg: 650, ease: "linear" },
  done: { glow: [0.3, 0.6], pg: 4800, ease: "ease-in-out" },
  idle: { glow: [0, 0.28], pg: 7400, ease: "ease-in" },
};

/** A status's flight, if it flies. */
function flightOf(status: Status | null | undefined): Flying | null {
  const f = status ? FLIGHT[status] : null;

  return f?.x === undefined ? null : f;
}

let reduced = false;
let asked = 0;
const ASK_EVERY = 60_000;

/** Asks the system whether it wants less motion (macOS, GNOME), at most once a minute. */
function askReduced(): void {
  if (Date.now() - asked < ASK_EVERY) return;
  asked = Date.now();
  const mac = appWindow().platform === "macos";
  const ask = mac ? exec("defaults", ["read", "com.apple.universalaccess", "reduceMotion"]) : exec("gsettings", ["get", "org.gnome.desktop.interface", "enable-animations"]);

  ask.then((r) => {
    const out = r.stdout.trim();

    reduced = mac ? r.code === 0 && out === "1" : r.code === 0 && out === "false";
  }).catch(() => {});
}

/** The system asks for less motion (last answer). */
export function reducedMotion(): boolean {
  askReduced();

  return reduced;
}

/** Nothing should fly: the window isn't in front, or less motion is asked for. */
export function calm(): boolean {
  return !appWindow().active || reducedMotion();
}

/** The flight path, wrapped around `el` (a 40 px firefly): layers that swing
 *  left and top at their own periods. `el` unchanged when it doesn't fly. */
export function fly(el: Element, status: Status | null | undefined, h: number, still: boolean): Element {
  const f = flightOf(status);

  if (!f || still || calm()) return el;

  const px = f.px + (h % 1300);
  const py = f.py + ((h >> 4) % 900);
  const layer = (child: Element) => div().absolute().top(0).left(0).size(40).child(child);

  return layer(layer(el).loop("top", { from: -f.y, to: f.y, period: py }))
    .loop("left", { from: -f.x, to: f.x, period: px });
}

/** The glow's flash, for an svg glow layer. Held still when calm (blocked
 *  still blinks under reduced motion while the window's in front). */
export function flash(el: Element, status: Status | null | undefined, h: number): Element {
  const f = status ? FLIGHT[status] : null;

  if (!f) return el;

  if (calm() && !(status === "blocked" && appWindow().active)) return el.opacity(f.glow[1] * (status === "idle" ? 0 : 0.8));

  return el.loop("opacity", { from: f.glow[0], to: f.glow[1], period: f.pg + (h % 900), easing: f.ease });
}

/** A few pixels of dust where a flying firefly has been: tiny dithered
 *  specks around its slot that twinkle out of step. */
export function dust(status: Status | null | undefined, h: number, dot: () => Element): Element[] {
  if (!flightOf(status) || calm()) return [];

  const specks: readonly (readonly [number, number, number])[] = [[4, 30, 1300], [32, 6, 1900], [34, 28, 2500]];

  return specks.map(([x, y, p], i) =>
    dot().absolute().left(x).top(y).size(2).opacity(0)
      .loop("opacity", { from: 0, to: 0.7, period: p + ((h >> (i * 3)) % 700), easing: "ease-in" }));
}
