// The 1-bit dither fill the bar, the strip and the menu draw with.

import { PathBuilder, Background } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import { settings, window as appWindow } from "herdr";

export const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

export function dither(color: Color, cell = 1): Element {
  const zoom = settings().zoom || 1, dpr = appWindow().platform === "macos" ? 2 : 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}
