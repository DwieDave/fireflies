// Shared pieces: art paths, the dither fill, status words and pips.
// Every color comes from theme() (the moonfly theme), never a literal.

import { div, svg, PathBuilder, Background } from "gpui-kit";
import { settings, window as appWindow, terminals, hc, home } from "herdr";

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

/** Status order: what needs the person first. */
export const RANK = { blocked: 0, done: 1, working: 2, idle: 3 };

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
