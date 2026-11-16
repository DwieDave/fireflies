// The paint under the mods' chrome: in a dithered layout (nocturne) the 1-bit
// checker fills they are drawn with today, element for element; in a plain one
// (main, herdr-app's look) what upstream draws: flat fills, 1 px lines, the
// theme's selected tone, black at 35% under a dialog.
//
//   fill(color, cell)         a layer filling its parent: a checker, or the color flat at half strength
//   rule(t, at, options)      a bar's edge: a dithered 2 px strip, or a 1 px line in the border tone
//   lit(t, el, active)        a chosen row: the dithered band with an accent edge, or the selected fill
//   veil(id)                  what dims a window under an in-window popup
//   plate(t)                  the ground of a window's title bar (titleBar() draws on it)

import { div, PathBuilder, Background } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import { settings, window as appWindow } from "herdr";
import type { Theme } from "herdr";
import { dithered } from "@fireflies/layout-look";
import { edge } from "@fireflies/tones";

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

/** The checker's square in device pixels: `cell` layout px at the zoom; herdr
 *  gives no scale factor, so macOS counts as Retina (2x). */
function cellPx(cell: number): number {
  const zoom = settings().zoom || 1;
  const dpr = appWindow().platform === "macos" ? 2 : 1;

  return Math.max(1, Math.round(cell * zoom * dpr));
}

/** A layer filling its parent: in a dithered layout a 50% checker of `color`
 *  in `cell`-px squares (the mods' own dither()); in a plain one the color
 *  flat at half strength, what the checker averages to. A coarse checker
 *  (cell > 2: a picture's transparency) stays a checker everywhere. */
export function fill(color: Color, cell = 1): Element {
  const layer = cell > 2 || dithered()
    ? window.paint_path(RECT(), Background.checkerboard(color, cellPx(cell)))
    : div().bg(color).opacity(0.5);

  return layer.absolute().top(0).left(0).size_full();
}

/** Where a rule runs along its bar. */
export type Edge = "top" | "bottom";

/** A rule's options: its height in the dithered look (2 px, a bar's; 1 for a
 *  hairline), its color (the edge tone), its strength. */
export interface RuleOptions {
  readonly height?: number;
  readonly color?: Color;
  readonly opacity?: number;
}

/** A bar's edge along `at`: in a dithered layout a strip of `fill(color)`
 *  `height` px tall (2: the mods' bars), in a plain one a 1 px line in the
 *  theme's border tone. */
export function rule(t: Theme, at: Edge, options: RuleOptions = {}): Element {
  const { height = 2, color = edge(t), opacity = 1 } = options;
  const strip = div().absolute().left(0).right(0);
  const placed = at === "top" ? strip.top(0) : strip.bottom(0);

  if (!dithered()) return placed.h(1).bg(t.border);

  const sized = placed.h(height);

  return (opacity < 1 ? sized.opacity(opacity) : sized).child(fill(color, 1));
}

/** A chosen row's look's options: the accent edge's color, the band's tone. */
export interface LitOptions {
  readonly mark?: Color;
  readonly band?: Color;
}

/** `el` (a relative row) as the chosen one: in a dithered layout the band the
 *  mods draw (a checker of the edge tone, dimmer off focus, and a 2 px accent
 *  edge on the left); in a plain one the theme's selected fill (hover's off
 *  focus), rounded where the layout's corners round. */
export function lit(t: Theme, el: Element, active: boolean, options: LitOptions = {}): Element {
  if (!dithered()) return el.bg(active ? t.selected : t.hover).rounded(6);

  const band = options.band ?? (active ? edge(t) : `${edge(t)}88`);
  const mark = options.mark ?? (active ? t.accent : t.muted);

  return el.child(fill(band, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(mark));
}

/** Black over the window under an in-window popup: the mods' dithered veil
 *  (#0000008c in 1-px squares), or upstream's flat black at 35%. */
export function veil(id: string): Element {
  const layer = div().id(id).absolute().inset_0();

  return dithered() ? layer.child(fill("#0000008c", 1)) : layer.bg("#00000059");
}

/** The ground of a window's title bar, behind its content: the dithered plate
 *  and its lit foot (nocturne), or the popover tone with a 1 px line under it. */
export function plate(t: Theme): Element[] {
  if (!dithered()) return [div().absolute().inset_0().bg(t.popover), div().absolute().left(0).right(0).bottom(0).h(1).bg(t.border)];

  return [div().absolute().inset_0().opacity(0.5).child(fill(edge(t), 2)), div().absolute().left(0).right(0).bottom(0).h(2).child(fill(t.muted, 1))];
}
