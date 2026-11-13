// The process deck's drawing pieces: the night dither (as nocturne's kit.ts)
// and its cell, the zoom, an agent status's colour.

import { PathBuilder, Background } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import { settings, window as appWindow } from "herdr";
import type { Theme } from "herdr";

// The dither fill, copied from ../nocturne/kit.ts (a mod can't import another mod's files).
export const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

export const zoom = (): number => settings().zoom || 1;

export function dither(color: Color, cell = 1): Element {
  const dpr = appWindow().platform === "macos" ? 2 : 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}

// The dither's cell in device px: one layout px at the zoom (as dither() has it).
export const dotCell = (): number => Math.max(1, Math.round(zoom() * (appWindow().platform === "macos" ? 2 : 1)));

export const unzoom = (v: number): number => v / zoom();

/** An agent's status in its color, else null. */
export function toneOf(t: Theme, status: string | null): Color | null {
  switch (status) {
    case "working": return t.working;
    case "blocked": return t.blocked;
    case "done": return t.done;
    default: return null;
  }
}
