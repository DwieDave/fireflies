// The script runner's drawing pieces: a tone's colour, the night dither (as
// nocturne's kit.ts), a section's eyebrow.

import { div, PathBuilder, Background } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import { settings, window as appWindow } from "herdr";
import type { Theme } from "herdr";
import type { Tone } from "./runs.ts";

/** A run's state in the theme's colors. */
export function toneColor(t: Theme, k: Tone): Color {
  switch (k) {
    case "running": return t.working;
    case "ok": return t.done;
    case "failed": return t.blocked;
    case "stopped": return t.dim;
  }
}

// The dither fill, copied from ../nocturne/kit.ts (a mod can't import another mod's files).
export const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

export function dither(color: Color, cell = 1): Element {
  const zoom = settings().zoom || 1;
  const dpr = appWindow().platform === "macos" ? 2 : 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

export const eyebrow = (t: Theme, text: string) => div().text_size(11).text_color(t.ansi8).child(text.toUpperCase());
