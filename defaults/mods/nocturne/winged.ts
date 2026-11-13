// An agent's winged mark: its program's logo (art/logo-*.svg, else the
// program's own icon, else art/logo-agent.svg) with the little wings
// (art/wings.svg) over its shoulders, one colour for both. The sidebar's
// firefly (meadow.ts), an agent's tab (tabs.ts) and its pane header
// (header.ts) all draw it from here, so the three can't drift.
//
// Its geometry in cells of a 16 px mark (scaled for a smaller one): a box 25
// wide and 18 tall, the wings across its top (25 x 8), the mark 4 in and 2
// down, so the wings' roots sit on its shoulders and the mark covers them.
// The wings beat by folding: a clip anchored at their base shortens and grows,
// so the tips dip behind the mark, pixels kept whole.

import { div, svg, image } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import type { Status, Theme } from "herdr";
import { ART, LOGO, statusColor } from "./kit.ts";
import { calm } from "./flight.ts";

/** What the mark is drawn from: an agent's program (its key, its own icon and
 *  whether to tint it) and the app it reports. AgentInfo and a terminal's
 *  PaneInfo both are. */
export interface Winged {
  readonly program?: { readonly key: string; readonly icon?: string | null; readonly tint?: boolean } | undefined;
  readonly app?: string | null | undefined;
}

/** The wings' fold while they beat: there and back in `period` ms, the tips
 *  dipping `fold` cells (of 8) behind the mark. */
export interface Beat {
  readonly period: number;
  readonly fold: number;
}

/** The size the strip's tabs and the pane headers draw the mark at (layout px). */
export const CHROME_MARK = 12;

/** A working agent's wings in a tab or a header: a slow, small beat (one cell). */
export const CHROME_BEAT: Beat = { period: 2400, fold: 1 };

/** A box's width and height (layout px). */
export interface Box {
  readonly w: number;
  readonly h: number;
}

/** The box a `size` px mark takes with its wings (layout px). */
export const wingedBox = (size: number): Box => ({ w: (25 * size) / 16, h: (18 * size) / 16 });

/** The agent's mark, `size` px: a dithered logo (art/logo-*.svg), else its program's own icon, else a bot. */
export function flyMark(a: Winged, color: Color, size = 16): Element {
  const p = a.program;
  const key = LOGO.get(p?.key ?? "") ?? LOGO.get(a.app ?? "");

  if (key) return svg(`${ART}/logo-${key}.svg`).size(size).text_color(color);

  if (p?.icon) return p.tint !== false ? svg(p.icon).size(size).text_color(color) : image(p.icon).size(size);

  return svg(`${ART}/logo-agent.svg`).size(size).text_color(color);
}

/** The wings for a `size` px mark, folding in `beat` (null: held still). */
function wings(color: Color, size: number, beat: Beat | null): Element {
  const s = size / 16;

  const clip = div().absolute().left(0).top(0).w(25 * s).h(8 * s).overflow_hidden()
    .child(svg(`${ART}/wings.svg`).absolute().bottom(0).left(0).w(25 * s).h(8 * s).text_color(color));

  if (!beat) return clip;

  return clip.loop("top", { from: 0, to: beat.fold * s, period: beat.period, easing: "linear" })
    .loop("height", { from: 8 * s, to: (8 - beat.fold) * s, period: beat.period, easing: "linear" });
}

/** The agent's mark with its wings, `size` px for the mark (its box: wingedBox),
 *  in `color`; the wings fold in `beat`, or hold still. */
export function wingedMark(a: Winged, color: Color, size = 16, beat: Beat | null = null): Element {
  const s = size / 16;
  const box = wingedBox(size);

  return div().relative().w(box.w).h(box.h).flex_none()
    .child(wings(color, size, beat))
    .child(div().absolute().left(4 * s).top(2 * s).size(size).child(flyMark(a, color, size)));
}

/**
 * An agent's one mark on its tab and in its pane header: the sidebar's
 * winged mark (CHROME_MARK px) in the colour the sidebar gives its status.
 * Working, its wings beat a little and slowly (CHROME_BEAT; held still when
 * the window is in the back or less motion is asked for); blocked, it blinks;
 * done and resting, it holds still.
 */
export function statusMark(t: Theme, a: Winged, status: Status, id: string): Element {
  const el = div().id(id).flex_none()
    .child(wingedMark(a, statusColor(t, status), CHROME_MARK, status === "working" && !calm() ? CHROME_BEAT : null));

  return status === "blocked" ? el.loop("opacity", { from: 0.15, to: 1, period: 700, easing: "linear" }) : el;
}
