// The toolbar's ground: the tools (nocturne's tab strip), the bell
// (notifications) and "+ new" are blocks of their own, and the ground runs
// under all of them to the strip's right edge, each block drawing its stretch.
// With it the dither fill it is drawn with, so it needs nothing from a kit
// (the kits import it and pass it on).
//
// A mod can't import another mod's files, so this file is in nocturne and in
// notifications, byte for byte (scripts/nocturne-tab-seam.test.ts checks). Edit
// one, copy it over the other.

import { div, PathBuilder, Background } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import { settings, window as appWindow } from "herdr";
import type { Theme } from "herdr";

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

/** A layer filling its parent with a 50% checker dither, in `cell`-px squares.
 *  The checkerboard counts device pixels; herdr exposes no scale factor, so
 *  macOS is taken as Retina (2x). */
export function dither(color: Color, cell = 1): Element {
  const zoom = settings().zoom || 1;
  const dpr = appWindow().platform === "macos" ? 2 : 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

/** "ledge" (the tools on a raised, lit ledge of the horizon) or "plate" (the
 *  tools on a dithered plate the strip's height). */
export type ToolLook = "ledge" | "plate";

/** The toolbar's look. */
export const TOOL_LOOK: ToolLook = "plate";

/** The ground under a block of the toolbar (layers filling it, behind its
 *  controls), in place of the tabs' plain horizon. */
export function toolGround(t: Theme, look: ToolLook = TOOL_LOOK): Element[] {
  const layer = () => div().absolute().left(0).right(0);

  if (look === "plate") {
    return [
      layer().top(0).bottom(0).opacity(0.55).child(dither(t.ansi0, 1)), // the plate
      layer().bottom(0).h(2).child(dither(t.ansi8, 1)), // its foot: the horizon, lit
    ];
  }

  return [
    layer().bottom(0).h(4).child(dither(t.ansi8, 1)), // the ledge, dithered
    layer().bottom(4).h(1).bg(t.ansi8).opacity(0.8), // its lit edge
  ];
}

/** A "#rrggbb" color's three channels, or null when it isn't one. */
function channels(c: Color): readonly [number, number, number] | null {
  if (!/^#[0-9a-f]{6}$/i.test(c)) return null;

  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

const hex2 = (v: number) => Math.round(v).toString(16).padStart(2, "0");

/** Two "#rrggbb" colors mixed, `k` of the way from `a` to `b`; `a` when either isn't one. */
export function mix(a: Color, b: Color, k: number): Color {
  const x = channels(a);
  const y = channels(b);

  if (!x || !y) return a;

  return `#${hex2(x[0] + (y[0] - x[0]) * k)}${hex2(x[1] + (y[1] - x[1]) * k)}${hex2(x[2] + (y[2] - x[2]) * k)}`;
}

/** A tool's plate under the pointer: on the plate a step brighter than it
 *  (ansi0 lifted toward ansi8, the text still reads on it); on the ledge ansi0. */
export function toolHover(t: Theme, look: ToolLook = TOOL_LOOK): Color {
  return look === "plate" ? mix(t.ansi0, t.ansi8, 0.3) : t.ansi0;
}
