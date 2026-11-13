// The pieces of Nocturne's look this pane needs (a mod can't import another
// mod's files): the art folders and the dither fill. Same as ../nocturne/kit.js.

import { PathBuilder, Background } from "gpui-kit";
import { settings, window as appWindow } from "herdr";

/** Nocturne's sky art (moon, stars, hills, glow, pip). */
export const ART = "mods/nocturne/art";
/** This pane's own: the candle flame and the sheep (art/generate.py). */
export const OWN = "mods/nocturne-usage/art";

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

/** A layer filling its parent with a 50% checker dither, in `cell`-px squares (Retina on macOS). */
export function dither(color, cell = 1) {
  const zoom = Number(settings()?.zoom) || 1;
  const dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}
