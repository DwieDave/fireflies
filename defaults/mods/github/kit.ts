// The GitHub window's look, drawn through @fireflies/look: Nocturne's 1-bit
// night look where the layout is dithered (its lazygit-style panels, chips,
// pips, the key bar, empty states with the moon), herdr-app's plain look
// elsewhere (cards, flat fills, round dots, kbd chips: docs/plain-look.md,
// concept A). The tone colors and the zoom helpers too.

import { div, svg } from "gpui-kit";
import type { Color, Context, Element, MouseButtonEvent, Size } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings } from "herdr";
import type { Theme } from "herdr";
import { Array as Arr, String as Str } from "effect";
import { hint, keysHint } from "@fireflies/keyhelp";
import { dithered, dot, edge as edgeTone, fill, heading, icon, panel as card, rule } from "@fireflies/look";
import type { Tone } from "./model.ts";

export { ART, fill as dither, lit, veil, radius, pick, dithered, glyph, icon } from "@fireflies/look";

/** Items `start` up to `end` of a list (a virtual list's range). */
export const within = <A>(xs: readonly A[], start: number, end: number): A[] => Arr.take(Arr.drop(xs, start), Math.max(0, end - start));

export const stop = (_e: MouseButtonEvent, cx: Context): void => cx.stop_propagation();

/** The app's zoom: lengths a script writes are drawn this much bigger, while
 *  sizes (on_size_change) and pointer positions come back as drawn. */
export function zoom(): number {
  const z = settings().zoom;

  return z > 0 ? z : 1;
}

/** A drawn length (a measured size, a pointer move) in the px scripts write. */
export const unzoom = (v: number): number => v / zoom();

/** A measured { width, height } in the px scripts write. */
export const unzoomSize = (size: Size): Size => ({ width: unzoom(size.width), height: unzoom(size.height) });

/** Which way a splitter drags: "x" between panels side by side, "y" between stacked ones. */
export type Axis = "x" | "y";

/** The 6px gap between two panels, dragged to resize them: `axis` "x" for
 *  side by side, "y" for stacked; `onDown(e, cx)` starts the drag. */
export function splitter(t: Theme, id: string, axis: Axis, dragging: boolean, onDown: (e: MouseButtonEvent, cx: Context) => void): Element {
  const line = div().absolute().when(axis === "x", (el) => el.top(0).bottom(0).left(2).w(2)).when(axis === "y", (el) => el.left(0).right(0).top(2).h(2));

  return div().id(id).relative().flex_none()
    .when(axis === "x", (el) => el.w(6).h_full().cursor_col_resize()).when(axis === "y", (el) => el.h(6).w_full().cursor_row_resize())
    .hover((s) => s.bg(dithered() ? edgeTone(t) : t.hover))
    .on_mouse_down("left", (e, cx) => {
      cx.stop_propagation();
      onDown(e, cx);
      cx.notify();
    })
    .when(dragging, (el) => el.child(line.bg(t.accent)));
}

/** A tone (model.ts) -> its theme color. */
export function toneColor(t: Theme, tone: Tone | null | undefined): Color {
  switch (tone) {
    case "working": return t.working;
    case "done": return t.done;
    case "failed": return t.blocked;
    case "skipped": return edgeTone(t);
    default: return t.muted;
  }
}

/** A tone in words. */
export const TONE_WORD = {
  working: "running", done: "passed", failed: "failed", queued: "queued", stopped: "cancelled", skipped: "skipped",
} as const satisfies { readonly [K in Tone]: string };

/** A small mark in the tone's color: running breathes, failed blinks once in a
 *  while, queued is a hollow dim ring (nocturne's dithered diamond, a round dot
 *  in a plain layout). */
export function pip(t: Theme, tone: Tone | null | undefined, size = 7): Element {
  if (tone === null || tone === undefined) return div().size(size).flex_none();

  if (tone === "queued" || tone === "skipped") {
    const ring = div().size(size).flex_none().border(1).border_color(toneColor(t, tone));

    return (dithered() ? ring : ring.rounded(size)).when(tone === "queued", (el) => el.loop("opacity", { from: 0.35, to: 0.9, period: 2200 }));
  }

  const el = dot(toneColor(t, tone), size);

  if (tone === "working") return el.loop("opacity", { from: 0.25, to: 1, period: 1200 });

  if (tone === "failed") return el.loop("opacity", { from: 0.55, to: 1, period: 2600 });

  return el;
}

/** A section's label: nocturne's small caps, upstream's heading. */
export function eyebrow(t: Theme, text: string): Element {
  if (!dithered()) return heading(t, text);

  return div().text_size(10).text_color(t.muted).child(Str.toUpperCase(text));
}

/** A panel's extras: a short label on the right of its title. */
export interface PanelOptions {
  readonly right?: string | Element | null | undefined;
}

/** A panel: in nocturne a lazygit-style 1-bit frame with its title in a
 *  20 px head over a dithered rule, accent when it has the keyboard; in a
 *  plain layout a card (look's panel) with the title and `right` in its header. */
export function panel(t: Theme, id: string, title: string, active: boolean, body: Element, { right = null }: PanelOptions = {}): Element {
  const extra = right === null || right === "" ? null : right;

  if (!dithered()) {
    return card(t, id, [div().text_color(active ? t.foreground : t.muted).child(title)], active, body, { right: Str.isString(extra) ? div().text_color(t.dim).child(extra) : extra });
  }

  const edge = active ? t.accent : edgeTone(t);

  return v_flex().id(id).relative().min_h(0).min_w(0).border(1).border_color(edge)
    // A long title ends in an ellipsis inside its own panel; the right label (short) keeps its room.
    .child(h_flex().relative().h(20).flex_none().min_w(0).px(8).gap(8).items_center().text_size(11).overflow_hidden()
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(fill(edge, 1)))
      .child(div().relative().flex_shrink(1).min_w(0).truncate().text_color(active ? t.foreground : t.muted).child(title))
      .child(div().flex_1())
      .when(extra !== null, (el) => el.child(div().relative().flex_none().text_color(t.dim).child(extra ?? ""))))
    .child(div().relative().flex_1().min_h(0).child(body));
}

/** A chip's pressed look: nocturne's dithered band with an accent foot, the selected fill in a plain layout. */
function pressed(t: Theme, el: Element): Element {
  if (!dithered()) return el.bg(t.selected).rounded(5);

  return el.child(fill(edgeTone(t), 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent));
}

/** A small text button; `on` gives it the pressed look. */
export function chip(t: Theme, id: string, label: string | Element, on: boolean, action: (cx: Context) => void, color?: Color | null): Element {
  const base = h_flex().id(id).relative().h(20).px(7).flex_none().items_center().text_size(11)
    .text_color(on ? t.foreground : color ?? t.muted).hover((s) => s.text_color(t.foreground))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      action(cx);
      cx.notify();
    });

  return (on ? pressed(t, base) : base).child(div().relative().child(label));
}

/** A key bar's entry: the key and what it does. */
export type Hint = readonly [key: string, what: string];

/** The key bar's ? entry: whether the keys show, and how to flip them. */
export interface KeysToggle {
  readonly on: boolean;
  readonly toggle: (cx: Context) => void;
}

/** lazygit's options bar: the keys that do something now. */
export function hints(t: Theme, list: readonly Hint[], right: Element | null, keys: KeysToggle | null = null): Element {
  // The help entry (? keys, keyhelp.ts) ends the bar, after the right-aligned note too.
  const help = Arr.filter(list, ([key]) => key === "?"), rest = Arr.filter(list, ([key]) => key !== "?");

  return h_flex().id("gh-hints").relative().h(22).flex_none().px(10).gap(12).items_center().text_size(11).overflow_hidden()
    .child(rule(t, "top"))
    .children(Arr.map(rest, ([key, what], i) => hint(t, `gh-hint-${i}`, key, what)))
    .child(div().flex_1())
    .when(right !== null, (el) => (right === null ? el : el.child(right)))
    .when(help.length > 0, (el) => el.child(keysHint(t, "gh-hint-keys", keys?.on === true, (cx) => keys?.toggle(cx))));
}

/** An empty state's moon (its phase, 0..8) and whether it's a small one, without the moon. */
export interface EmptyOptions {
  readonly moon?: number;
  readonly small?: boolean;
}

/** A quiet middle-of-the-panel note, with the moon (none in a plain layout). */
export function empty(t: Theme, title: string, note: string | null | undefined, { moon = 8, small = false }: EmptyOptions = {}): Element {
  const art = icon(`moon-${moon}`, null);
  const said = note ?? "";

  return v_flex().size_full().items_center().justify_center().gap(small ? 6 : 10).px(16).text_size(11)
    .when(!small && art !== null, (el) => el.child(svg(art ?? "").w(40).h(40).text_color(t.muted).opacity(0.6)
      .loop("opacity", { from: 0.35, to: 0.7, period: 5200 })))
    .child(div().text_center().text_color(t.foreground).child(title))
    .when(said !== "", (el) => el.child(div().text_center().max_w(420).text_color(t.muted).child(said)));
}

/** A running bar: a sweep across its parent (dithered in nocturne), for what's in progress. */
export function sweep(_t: Theme, color: Color, width = 400): Element {
  return div().absolute().top(0).bottom(0).w(48).opacity(0.5).child(fill(color, 1))
    .loop("left", { from: -48, to: width, period: 1800, easing: "linear" });
}

/** How the window's note reads: working on it, done, or failed. */
export type NoteTone = "working" | "done" | "failed";

/** The note at the right of the key bar: what happened, how it went, when (it goes after a few seconds). */
export interface Note {
  readonly text: string;
  readonly tone: NoteTone;
  readonly at: number;
}

/** A note said at `at` (ms). */
export const noteOf = (text: string, tone: NoteTone, at: number): Note => ({ text, tone, at });

/** The theme's ansi colour `n` (0..15), else ansi8. */
export function ansiColor(t: Theme, n: number | null | undefined): Color {
  switch (n) {
    case 0: return t.ansi0;
    case 1: return t.ansi1;
    case 2: return t.ansi2;
    case 3: return t.ansi3;
    case 4: return t.ansi4;
    case 5: return t.ansi5;
    case 6: return t.ansi6;
    case 7: return t.ansi7;
    case 9: return t.ansi9;
    case 10: return t.ansi10;
    case 11: return t.ansi11;
    case 12: return t.ansi12;
    case 13: return t.ansi13;
    case 14: return t.ansi14;
    case 15: return t.ansi15;
    default: return t.ansi8;
  }
}
