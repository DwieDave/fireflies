// How a firefly flies and glows, by status (sky.js draws them).
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
import { exec, window as appWindow } from "herdr";

const FLIGHT = {
  working: { x: 3, y: 3, px: 5200, py: 3100, glow: [0.15, 1], pg: 2100, ease: "ease-in" },
  blocked: { x: 4, y: 3, px: 1700, py: 940, glow: [0.35, 1], pg: 650, ease: "linear" },
  done: { glow: [0.3, 0.6], pg: 4800, ease: "ease-in-out" },
  idle: { glow: [0, 0.28], pg: 7400, ease: "ease-in" },
};

let reduced = false;
let asked = 0;
const ASK_EVERY = 60_000;

/** Asks the system whether it wants less motion (macOS, GNOME), at most once a minute. */
function askReduced() {
  if (Date.now() - asked < ASK_EVERY) return;
  asked = Date.now();
  const mac = appWindow()?.platform === "macos";
  const [cmd, args] = mac ? ["defaults", ["read", "com.apple.universalaccess", "reduceMotion"]]
    : ["gsettings", ["get", "org.gnome.desktop.interface", "enable-animations"]];
  exec(cmd, args).then((r) => {
    const out = String(r?.stdout ?? "").trim();
    reduced = mac ? r?.code === 0 && out === "1" : r?.code === 0 && out === "false";
  }).catch(() => {});
}

/** The system asks for less motion (last answer). */
export function reducedMotion() {
  askReduced();
  return reduced;
}

/** Nothing should fly: the window isn't in front, or less motion is asked for. */
export function calm() {
  return appWindow()?.active === false || reducedMotion();
}

/** The flight path, wrapped around `el` (a 40 px firefly): layers that swing
 *  left and top at their own periods. `el` unchanged when it doesn't fly. */
export function fly(el, status, h, still) {
  const f = FLIGHT[status];
  if (!f?.x || still || calm()) return el;
  const px = f.px + (h % 1300), py = f.py + ((h >> 4) % 900);
  const layer = (child) => div().absolute().top(0).left(0).size(40).child(child);
  return layer(layer(el).loop("top", { from: -f.y, to: f.y, period: py }))
    .loop("left", { from: -f.x, to: f.x, period: px });
}

/** The glow's flash, for an svg glow layer. Held still when calm (blocked
 *  still blinks under reduced motion while the window's in front). */
export function flash(el, status, h) {
  const f = FLIGHT[status];
  if (!f) return el;
  if (calm() && !(status === "blocked" && appWindow()?.active !== false)) return el.opacity(f.glow[1] * (status === "idle" ? 0 : 0.8));
  return el.loop("opacity", { from: f.glow[0], to: f.glow[1], period: f.pg + (h % 900), easing: f.ease });
}

/** A few pixels of dust where a flying firefly has been: tiny dithered
 *  specks around its slot that twinkle out of step. */
export function dust(status, h, dot) {
  if (!FLIGHT[status]?.x || calm()) return [];
  return [[4, 30, 1300], [32, 6, 1900], [34, 28, 2500]].map(([x, y, p], i) =>
    dot().absolute().left(x).top(y).size(2).opacity(0)
      .loop("opacity", { from: 0, to: 0.7, period: p + ((h >> (i * 3)) % 700), easing: "ease-in" }));
}
