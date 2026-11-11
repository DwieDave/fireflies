// Shared pieces: art paths, the dither fill, status words and pips.
// Every color comes from theme() (the moonfly theme), never a literal.

import { div, svg, PathBuilder, Background } from "gpui-kit";
import { settings, window as appWindow, terminals, hc, home, run, agents, focused } from "herdr";
import { AT_LABEL, isPinned, sortAgents, moveInJar } from "./pins.js";

export const ART = "mods/nocturne/art";
export const FONT = "Departure Mono";

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

/** A layer filling its parent with a 50% checker dither, in `cell`-px squares.
 *  The checkerboard counts device pixels; herdr exposes no scale factor, so
 *  macOS is taken as Retina (2x). */
export function dither(color, cell = 1) {
  const zoom = Number(settings()?.zoom) || 1;
  const dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

/** Where a drop-down opened by a press on a tab-strip button goes: its top
 *  on the strip's horizon (the row is 36 px, the button 24 centered in it),
 *  its right edge on the button's, so it hangs under the button without
 *  covering it (a second press then lands on the button and closes it).
 *  `width`: the drop-down's, in layout px. Null when the press has no bounds. */
export function dropBelow(e, width) {
  const b = e?.bounds, l = e?.local_position;
  if (!b || !l || !e.position) return null;
  const zoom = Number(settings()?.zoom) || 1;
  const left = e.position.x - l.x, top = e.position.y - l.y;
  return { x: Math.round(Math.max(8, left + b.width - width * zoom)), y: Math.round(top + b.height + 6 * zoom) };
}

/** The label holding the name a person gave a pane's terminal (the pane menu's
 *  and a firefly's "Rename"). It lives on the terminal, so the name follows it
 *  to another pane or tab, and ends with it. */
export const NAME_LABEL = "nocturne.name";

/** The name a person gave this terminal (an address), or null. */
export function givenName(terminal) {
  return (terminal && terminals().find((x) => x.address === terminal)?.labels?.[NAME_LABEL]) || null;
}

/** Names a terminal; "" takes the name away, so it goes by its program's again. */
export function nameTerminal(terminal, name) {
  return hc(["label", terminal, `${NAME_LABEL}=${name.trim()}`]).catch(() => {});
}

/** A terminal's labels (an address), {} if it's gone. */
export const labelsOf = (terminal) => terminals().find((x) => x.address === terminal)?.labels ?? {};

/** Pinned to the jar at the top of the sky (pins.js: Herdr's herdr.pinned label). */
export const pinned = (terminal) => isPinned(labelsOf(terminal));

/** Pins a terminal's agent to the top of the sky, or unpins it: Herdr's
 *  terminal.pin, and the time it joined the jar (its order there). */
export function pin(terminal, on = !pinned(terminal)) {
  if (!terminal) return;
  run("terminal.pin", { terminal, pinned: on });
  hc(["label", terminal, `${AT_LABEL}=${on ? Date.now() : ""}`]).catch(() => {});
}

/** The sidebar's agent order (pins.js sortAgents): { pinned, rest, all }. */
export const sortedAgents = () => sortAgents([...agents()], agentRank, labelsOf);

/** Moves a pinned agent one step up (-1) or down (+1) in the jar. */
export function movePin(terminal, dir) {
  for (const [t, kv] of moveInJar(sortedAgents().pinned, terminal, dir, Date.now())) hc(["label", t, kv]).catch(() => {});
}

/** The focused pane's terminal (keys and the palette pin it). */
export const focusedTerminal = () => focused()?.terminal ?? null;

/** Program keys with a dithered logo in art/logo-*.svg. */
export const LOGO = { claude: "claude", "claude-code": "claude", opencode: "opencode", pi: "pi", codex: "codex" };

/** Where a space is now: its first terminal's live folder, else where it was made. */
export function place(s, all) {
  const tabs = new Set(s.tabs.map((c) => c.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

/** A space's folder: the one it's attached to (space.new folder, space.folder),
 *  else where it is now (place). Its repo, GitHub and lazygit go by this. Home
 *  holds no repo: a space attached there goes by where it is now too. */
export function spaceFolder(s, all) {
  if (!s) return null;
  const mine = s.attached && s.folder && !(s.machine == null && s.folder.replace(/\/+$/, "") === home());
  return (mine && s.folder) || place(s, all);
}

export const WORD = { working: "working", blocked: "needs you", done: "done", idle: "resting" };

/** Status order: what needs the person first, then what's busy, then what's at rest. */
export const RANK = { blocked: 0, working: 1, done: 2, idle: 3 };

/** At rest: done or resting. Both sidebars set these on the ground by the
 *  hills, below the awake ones (needs you, working, running a command). */
export const atRest = (a) => a.status === "idle" || a.status === "done";

/** An agent's place in every list: needs you, working, running a command it
 *  started (working, but waiting on a shell), done, resting. */
export const agentRank = (a) => (a.status === "working" ? (a.command ? 1.5 : 1) : RANK[a.status] ?? 3);

/** A small dithered diamond in the status color; working breathes, blocked blinks. */
export function pip(t, status, size = 6) {
  if (!status || status === "idle") return div().size(size).flex_none();
  const el = svg(`${ART}/pip.svg`).size(size).flex_none().text_color(t[status]);
  if (status === "working") return el.loop("opacity", { from: 0.3, to: 1, period: 1600 });
  if (status === "blocked") return el.loop("opacity", { from: 0.15, to: 1, period: 700, easing: "linear" });
  return el;
}

/** Uppercase eyebrow label. */
export function eyebrow(t, text) {
  return div().text_size(11).text_color(t.ansi8).child(text.toUpperCase());
}

/** A stable small number from a string, for per-agent drift. */
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---- the keyboard cursor (nav.js): one look across the chrome

/** On a row (a space, a firefly, a usage window): the popup's current-row
 *  look, a dithered band with a blue edge. `el` must be relative. */
export function navRow(t, el, on) {
  return on ? el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)) : el;
}

/** On a button or a chip: a square blue ring around it. `el` must be relative. */
export function navRing(t, el, on) {
  return on ? el.child(div().absolute().top(0).left(0).size_full().border(1).border_color(t.accent)) : el;
}

// The open sky's firefly square: the dots of art/glow.svg span 8..34 of its
// 40 px; the ticks sit 2 px off them.
export const GLOW_SQUARE = { at: 8, size: 26 };
export const TICK_OUT = 2;

/** The blue corner ticks: a 4 px corner in the accent at a thing's top left
 *  and one at its bottom right, `out` px outside its box (0: on its corners).
 *  What's shown wears them: the shown space (its row in the open sidebar, its
 *  initials on the rail) and the focused agent (its firefly's square in the
 *  open sky, its cell on the rail). */
export function cornerTicks(t, out = 3) {
  const tick = (pos) => div().absolute().size(4).border_color(t.accent)
    .when(pos === "top", (el) => el.left(-out).top(-out).border_t(1).border_l(1))
    .when(pos === "bottom", (el) => el.right(-out).bottom(-out).border_b(1).border_r(1));
  return [tick("top"), tick("bottom")];
}
