// The panels, title bars and foot keys of the mods' windows and panes, as the
// layout asks. In a dithered layout (nocturne) exactly what the mods draw
// today: lazygit's 1-bit frames with their titles cut into the edge, the
// dithered title plate with the moon and the caps name. In a plain one
// (main, herdr-app's look) Developer's pick, concept A, "cards": each panel a
// rounded card on the canvas, a header row with its tabs as a segmented
// control, the focused card in an accent border, keys as kbd chips.
//
//   canvas(t, el)             the ground the panels stand on: their gutters and padding
//   panel(t, id, title, active, body, options)   a panel: a lazygit frame, or a card
//   segmented(t, list)        a card header's tabs (Files · Review · Worktrees) as a segmented control
//   kbd(t, key)               a key as a chip (the foot's keys)
//   titleBar(t, bar, parts)   a window's title bar: the plate, its mark, its name, then `parts`
//   tag(t, el)                a value set apart in a title bar (the branch): plain only
//
// The sizes are picked so the five-panel windows (git) keep their rows at
// Developer's window sizes and zoom 0.9: a 6 px gutter and padding (not the
// concept's 10), a 26 px card header (the concept's 36 cost a row a panel),
// rows from the header's foot down. A panel sized to its content (git's
// status, stash) grows by the header and keeps every row; the flexible ones
// give up about one row each. In a pane (main's panes are cards already) the
// pane is the canvas: the panels are cards in it, with no second outer card
// and no own title bar (titleShown()).

import { div, svg } from "gpui-kit";
import type { Color, Context, Element, MouseButtonEvent } from "gpui-kit";
import { Array as Arr, String as Str } from "effect";
import { h_flex } from "gpui-base";
import type { Theme } from "herdr";
import { dithered } from "@fireflies/layout-look";
import { edge } from "@fireflies/tones";
import { plate } from "./paint.ts";
import { icon } from "./icons.ts";
import type { PlainIcon } from "./icons.ts";

/** Between two cards, and around them. */
export const GUTTER = 6;

/** A card's header row. */
export const CARD_HEAD = 26;

/** A plain layout's window title bar (titleBar()). */
export const TITLE_BAR = 40;

/** A card's corners, a window's. */
const CARD_RADIUS = 8;

/** The ground the panels stand on (`el`, their column or row): unchanged in
 *  nocturne (its frames meet edge to edge); in a plain layout the canvas
 *  tone with GUTTER between the cards and around them. */
export function canvas(t: Theme, el: Element): Element {
  if (dithered()) return el;

  return el.bg(t.canvas).p(GUTTER).gap(GUTTER);
}

/** A frame's top or bottom edge with labels cut into it, lazygit's way (git's
 *  draw.ts edgeRow, the nocturne look): the 1 px line runs up to a label,
 *  stops, and goes on after it. */
function edgeRow(id: string, color: Color, where: "top" | "bottom", left: Element | null, right: Element | null): Element {
  const line = () => div().h(1).bg(color);
  const label = (el: Element) => h_flex().flex_none().min_w(0).px(4).gap(5).items_center().overflow_hidden().child(el);
  const row = h_flex().id(id).absolute().left(0).right(0).h(13).items_center().text_size(11);
  const placed = (where === "top" ? row.top(-6) : row.bottom(-6)).child(line().w(left === null ? 0 : 8).flex_none());
  const lead = left === null ? placed : placed.child(label(left).flex_shrink(1));
  const mid = lead.child(line().flex_1().min_w(8));

  return right === null ? mid : mid.child(label(right)).child(line().w(8).flex_none());
}

/** A panel's extras: `foot` (a count, a position) and `right` (a chip) on its
 *  edges (nocturne) or in its header (a card), a press on its title. */
export interface PanelOptions {
  readonly foot?: string | null;
  readonly right?: Element | null;
  readonly onTitle?: ((e: MouseButtonEvent, cx: Context) => void) | null;
}

/** A panel holding `body`: in nocturne a lazygit frame, `title` (elements)
 *  cut into the top edge, accent while it has the keyboard (git's panel(),
 *  call for call); in a plain layout a rounded card, `title` in its header
 *  row with `right` and `foot` at the header's end, an accent border while
 *  it has the keyboard. */
export function panel(t: Theme, id: string, title: readonly Element[], active: boolean, body: Element, options: PanelOptions = {}): Element {
  const { foot = null, right = null, onTitle = null } = options;
  const titled = h_flex().min_w(0).gap(5).items_center().overflow_hidden().children(Arr.map(title, (el) => el.min_w(0).truncate()));
  const head = onTitle === null ? titled : titled.id(`${id}-title-hit`).on_mouse_down("left", (e, cx) => { cx.stop_propagation(); onTitle(e, cx); });

  if (dithered()) {
    const color = active ? t.accent : edge(t);

    return div().id(id).relative().flex().flex_col().min_h(0).min_w(0).border_l(1).border_r(1).border_color(color)
      .child(div().relative().flex_1().min_h(0).pt(7).pb(2).overflow_hidden().child(body))
      .child(edgeRow(`${id}-top`, color, "top", head, right))
      .child(edgeRow(`${id}-bottom`, color, "bottom", null, foot === null ? null : div().text_color(active ? t.accent : t.dim).child(foot)));
  }

  const header = h_flex().id(`${id}-head`).h(CARD_HEAD).flex_none().pl(10).pr(6).gap(8).items_center().text_size(12)
    .child(head.flex_1())
    .when(right !== null, (el) => (right === null ? el : el.child(right)))
    .when(foot !== null, (el) => el.child(div().flex_none().text_size(11).text_color(active ? t.accent : t.dim).child(foot ?? "")));

  return div().id(id).relative().flex().flex_col().min_h(0).min_w(0).bg(t.background).border(1).border_color(active ? t.accent : t.border).rounded(CARD_RADIUS).overflow_hidden()
    .child(header)
    .child(div().relative().flex_1().min_h(0).px(4).pb(4).overflow_hidden().child(body));
}

/** One tab of a card's header. */
export interface Tab {
  readonly id: string;
  readonly label: string;
  readonly on: boolean;
  readonly go?: ((cx: Context) => void) | null;
}

/** A card header's tabs as a segmented control: a sunk track, the shown tab
 *  raised in it. Plain layouts only: nocturne's panels keep their own title. */
export function segmented(t: Theme, list: readonly Tab[]): Element {
  return h_flex().flex_none().p(2).gap(2).rounded(7).bg(t.canvas).border(1).border_color(t.border)
    .children(Arr.map(list, (x) => {
      const pill = div().id(x.id).h(18).px(8).flex().items_center().rounded(5).text_size(11.5)
        .text_color(x.on ? t.foreground : t.muted).when(x.on, (el) => el.bg(t.raised))
        .when(!x.on, (el) => el.hover((s) => s.text_color(t.foreground)));

      const go = x.go ?? null;

      return go === null ? pill : pill.cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); go(cx); cx.notify(); });
    }));
}

/** A key as a chip (a foot's keys in a plain layout): mono, raised, bordered. */
export function kbd(t: Theme, key: string): Element {
  return div().flex_none().h(18).px(5).flex().items_center().rounded(4).bg(t.raised).border(1).border_color(t.border)
    .text_size(10.5).text_color(t.foreground).child(key);
}

/** A window's title bar's mark and name. */
export interface Bar {
  readonly id: string;
  /** Its nocturne art (a moon phase) and its line icon. */
  readonly art: string;
  readonly plain: PlainIcon;
  /** Its name as written ("Git"): nocturne shows it in caps. */
  readonly title: string;
}

/** A window's title bar, then `parts` (the path, the branch, the chips): in
 *  nocturne the dithered plate with the moon and the caps name, 34 px (git's
 *  windowHeader); in a plain layout a 40 px header row, the line icon and the
 *  name, a 1 px line under it. */
export function titleBar(t: Theme, bar: Bar, parts: readonly Element[]): Element {
  if (dithered()) {
    return h_flex().id(bar.id).relative().h(34).flex_none().overflow_hidden().pl(12).pr(6).gap(10).items_center().text_size(11)
      .children(plate(t))
      .child(h_flex().relative().flex_none().gap(8).items_center()
        .child(svg(icon(bar.art, bar.plain)).size(16).text_color(t.foreground))
        .child(div().text_color(t.foreground).child(Str.toUpperCase(bar.title))))
      .children(parts);
  }

  return h_flex().id(bar.id).relative().h(TITLE_BAR).flex_none().overflow_hidden().pl(14).pr(8).gap(10).items_center().text_size(12.5)
    .bg(t.background).border_b(1).border_color(t.border)
    .child(h_flex().flex_none().gap(8).items_center()
      .child(svg(icon(bar.art, bar.plain)).size(15).text_color(t.muted))
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child(bar.title)))
    .children(parts);
}

/** A value set apart in a title bar (the branch): a raised, rounded tag in a
 *  plain layout; as it is in nocturne. */
export function tag(t: Theme, el: Element): Element {
  if (dithered()) return el;

  return el.h(22).px(8).flex().items_center().rounded(6).bg(t.raised);
}
