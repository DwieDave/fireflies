// The pieces of Nocturne's look this pane needs (a mod can't import another
// mod's files): the art folder, the dither fill and status pips. Same as
// ../nocturne/kit.js.

import { div, svg, PathBuilder, Background } from "gpui-kit";
import { settings, window as appWindow } from "herdr";

export const ART = "mods/nocturne/art";

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

/** A layer filling its parent with a 50% checker dither, in `cell`-px squares (Retina on macOS). */
export function dither(color, cell = 1) {
  const zoom = Number(settings()?.zoom) || 1;
  const dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

/** A small dithered diamond in the status color; working breathes, blocked blinks. */
export function pip(t, status, size = 6) {
  if (!status || status === "idle") return div().size(size).flex_none();
  const el = svg(`${ART}/pip.svg`).size(size).flex_none().text_color(t[status]);
  if (status === "working") return el.loop("opacity", { from: 0.3, to: 1, period: 1600 });
  if (status === "blocked") return el.loop("opacity", { from: 0.15, to: 1, period: 700, easing: "linear" });
  return el;
}
