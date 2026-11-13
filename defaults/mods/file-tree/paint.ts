// The files pane's small drawing pieces: the night dither, the filter line's
// focus ring, a git letter's colour, a file's type mark (file-icons.ts).

import { div, svg, PathBuilder, Background } from "gpui-kit";
import type { Color, Context, Element, MouseButtonEvent } from "gpui-kit";
import type { Theme } from "herdr";
import { settings, window as appWindow } from "herdr";
import { fileIcon, iconColor, iconSvg, ICON_SIZE } from "./file-icons.ts";
import { MOD } from "./state.ts";

/** A git status letter's color (none for the folder's dot or a cut). */
export function markColor(t: Theme, mark: string): Color | null {
  switch (mark) {
    case "A": return t.ansi2;
    case "M": return t.ansi3;
    case "D":
    case "U": return t.ansi1;
    default: return null;
  }
}

export const zoom = (): number => settings().zoom || 1;

export const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

/** A 50% checker dither filling the parent (same as ../nocturne/kit.ts). */
export function dither(color: Color, cell = 1): Element {
  const dpr = appWindow().platform === "macos" ? 2 : 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}

export const stop = (_e: MouseButtonEvent, cx: Context): void => cx.stop_propagation();

/** The ring the filter line's stop wears under tab: a 1 px accent edge over it. */
export const ring = (t: Theme): Element => div().absolute().inset_0().border(1).border_color(t.accent);

/** A file's type mark (file-icons.ts) in place of the one generic file mark:
 *  a row of the tree or the search's hits, an entry of a folder's look. */
export function typeMark(t: Theme, name: string, id: string): Element {
  const icon = fileIcon(name);

  return div().id(id).relative().flex_none().size(ICON_SIZE).child(svg(iconSvg(icon, MOD)).size(ICON_SIZE).text_color(iconColor(icon, t)));
}
