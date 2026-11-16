// The small chrome around the mods' content, as the layout asks. Each draws in
// a dithered layout (nocturne) exactly what the mods draw there today; in a
// plain one (main, herdr-app's look) upstream's equivalent.
//
//   hairline(t, color)        an inline rule filling a row's rest (a section's head)
//   dot(color, size)          a status pip: nocturne's pip art, or a round dot
//   boxed(t, el, color)       a bordered chip or badge: square edge-toned, or rounded border-toned
//   glyph(t, text, plain, size)  a control's mark: the text glyph (◧ ⧉ ✕ ↻), or a line icon
//   frameBox(t, el)           a window's own frame (a deck not in a pane): its edge, or a rounded popover
//   button(t, el)             a filled button (Open settings): the edge tone, or upstream's raised one
//   heading(t, text)          a section's name: nocturne's caps in the muted tone, or upstream's dim words
//   menuBox(t, el)            a popup menu's box: nocturne's accent frame, or upstream's rounded popover
//   radius(n)                 (layout-look.ts) n px where corners round, 0 where they're square
//   pick(nocturne, plain)     a value by look (a size, a word): the first in nocturne, the second elsewhere
//   titleShown(inPane)        whether a mod draws its own title bar: always in nocturne; in a plain
//                             layout not in a pane, whose header already names it

import { div, svg } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import { String as Str } from "effect";
import type { Theme } from "herdr";
import { dithered } from "@fireflies/layout-look";
import { edge } from "@fireflies/tones";
import { fill } from "./paint.ts";
import { ART, PLAIN } from "./icons.ts";
import type { PlainIcon } from "./icons.ts";

/** An inline rule filling the rest of a row (flex_1): nocturne's dithered
 *  1 px line at 60%, or a 1 px line in the border tone. */
export function hairline(t: Theme, color: Color = t.muted): Element {
  if (!dithered()) return div().flex_1().h(1).bg(t.border);

  return div().flex_1().h(1).relative().opacity(0.6).child(fill(color, 1));
}

/** A status pip `size` px across: nocturne's pip art, or a round dot. */
export function dot(color: Color, size = 6): Element {
  if (dithered()) return svg(`${ART}/pip.svg`).size(size).flex_none().text_color(color);

  return div().size(size).flex_none().rounded(size).bg(color);
}

/** `el` with a 1 px border: nocturne's square, in `color` (the edge tone),
 *  or rounded, in `color` or the border tone. */
export function boxed(t: Theme, el: Element, color: Color | null = null): Element {
  if (dithered()) return el.border(1).border_color(color ?? edge(t));

  return el.border(1).border_color(color ?? t.border).rounded(5);
}

/** A control's mark: the text glyph nocturne draws (◧ ⧉ ✕ ↻ ‹), or the
 *  line icon `plain` at `size` px. */
export function glyph(text: string, plain: PlainIcon, size = 13): Element | string {
  if (dithered()) return text;

  return svg(`${PLAIN}/${plain}.svg`).size(size).flex_none();
}

/** A window's own frame (a mod drawn over the layout, not in a pane):
 *  nocturne's 1 px edge, or upstream's rounded popover with its border. */
export function frameBox(t: Theme, el: Element): Element {
  if (dithered()) return el.border(1).border_color(edge(t));

  return el.border(1).border_color(t.input).rounded(10).bg(t.popover).overflow_hidden();
}

/** A filled button: nocturne's edge-toned block, or upstream's raised one with its border. */
export function button(t: Theme, el: Element): Element {
  if (dithered()) return el.bg(edge(t)).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.muted));

  return el.bg(t.raised).border(1).border_color(t.input).rounded(6).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover));
}

/** A section's name (RUNS, SCRIPTS): nocturne's caps in the muted tone, or
 *  upstream's (the sidebar's "Spaces", "Agents") as written, dim. */
export function heading(t: Theme, text: string): Element {
  if (dithered()) return div().text_size(11).text_color(t.muted).child(Str.toUpperCase(text));

  return div().text_size(11.5).text_color(t.dim).child(Str.capitalize(text));
}

/** A popup menu's box (`el`, its rows inside): nocturne's square accent frame
 *  on the background, or upstream's rounded popover (the menu mod's). */
export function menuBox(t: Theme, el: Element): Element {
  if (dithered()) return el.bg(t.background).border(1).border_color(t.accent);

  return el.bg(t.popover).border(1).border_color(t.input).rounded(8);
}

/** Whether a mod draws its own title bar: nocturne draws it everywhere; a
 *  plain layout's pane has a header that names the mod already. */
export const titleShown = (inPane: boolean): boolean => dithered() || !inPane;

/** A value by look: `nocturne` in a dithered layout, `plain` elsewhere (a
 *  pixel font's 11 px is upstream's 12.5; a 9 px pixel icon a 12 px line icon). */
export const pick = <A>(nocturne: A, plain: A): A => (dithered() ? nocturne : plain);
