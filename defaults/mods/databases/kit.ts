// Nocturne's look for the Databases window, copied (a mod can't import
// another mod's files): the dither fill (nocturne/kit.ts), lazygit's panels
// with their titles cut into the 1-bit frame and the selected row's band
// (git/draw.ts), chips and empty states (github/kit.ts); the kinds' badges and
// the SQL editor's colours (editor/kinds.ts' syntaxColors).

import { div, svg, PathBuilder, Background } from "gpui-kit";
import type { Color, Context, Element, MouseButtonEvent, Size } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings, window as appWindow } from "herdr";
import type { Theme } from "herdr";
import type { Kind } from "./kinds.ts";
import { KIND_MARK } from "./kinds.ts";

export const ART = "mods/nocturne/art";

export const stop = (_e: MouseButtonEvent, cx: Context): void => cx.stop_propagation();

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

/** The app's zoom: lengths a script writes are drawn this much bigger. */
export function zoom(): number {
  const z = settings().zoom;

  return z > 0 ? z : 1;
}

/** A drawn length (a measured size, a pointer move) in the px scripts write. */
export const unzoom = (v: number): number => v / zoom();

export const unzoomSize = (size: Size): Size => ({ width: unzoom(size.width), height: unzoom(size.height) });

/** A layer filling its parent with a 50% checker dither (Retina on macOS). */
export function dither(color: Color, cell = 1): Element {
  const dpr = appWindow().platform === "macos" ? 2 : 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}

/** The dim under a popup inside the window (git's and github's: every in-window popup matches). */
export const POPUP_SCRIM: Color = "#0000008c";

export function popupScrim(id: string): Element {
  return div().id(id).absolute().inset_0().child(dither(POPUP_SCRIM, 1));
}

/** A frame's top or bottom edge with labels cut into it (git's edgeRow): the line stops at a label. */
function edgeRow(id: string, edge: Color, where: "top" | "bottom", left: Element | null, right: Element | null): Element {
  const line = () => div().h(1).bg(edge);
  const label = (el: Element) => h_flex().flex_none().min_w(0).px(4).gap(5).items_center().overflow_hidden().child(el);
  const row = h_flex().id(id).absolute().left(0).right(0).h(13).items_center().text_size(11);
  const placed = (where === "top" ? row.top(-6) : row.bottom(-6)).child(line().w(left ? 8 : 0).flex_none());
  const lead = left ? placed.child(label(left).flex_shrink(1)) : placed;
  const mid = lead.child(line().flex_1().min_w(8));

  // The right label (a count, a caption) gives way before the title's tabs.
  return right ? mid.child(label(right).flex_shrink(4)).child(line().w(8).flex_none()) : mid;
}

/** A panel's extras: `right` cut into its top edge, `foot` into its bottom, a press on its title. */
export interface PanelOptions {
  readonly right?: Element | null;
  readonly foot?: string | null;
  readonly onPress?: ((cx: Context) => void) | null;
}

/** A lazygit panel: a 1-bit frame with `title` cut into its top edge, accent when it has the keyboard. */
export function panel(t: Theme, id: string, title: readonly Element[], active: boolean, body: Element, options: PanelOptions = {}): Element {
  const { right = null, foot = null, onPress = null } = options;
  const edge = active ? t.accent : t.ansi0;
  const titled = h_flex().min_w(0).gap(5).items_center().overflow_hidden().children(title.map((el) => el.min_w(0).truncate()));

  return div().id(id).relative().flex().flex_col().min_h(0).min_w(0).border_l(1).border_r(1).border_color(edge)
    .on_mouse_down("left", (_e, cx) => {
      onPress?.(cx);
    })
    .child(div().relative().flex_1().min_h(0).pt(7).pb(2).overflow_hidden().child(body))
    .child(edgeRow(`${id}-top`, edge, "top", titled, right))
    .child(edgeRow(`${id}-bottom`, edge, "bottom", null, foot ? div().text_color(active ? t.accent : t.dim).child(foot) : null));
}

/** What else a title's tabs do: a press (that may become a drag), a double click, a right click,
 *  each tab dressed further (a drop target), its hover. */
export interface TabMore {
  readonly press?: (key: string, e: MouseButtonEvent, cx: Context) => void;
  readonly open?: (key: string, cx: Context) => void;
  readonly menu?: (key: string, cx: Context, e?: MouseButtonEvent) => void;
  readonly dress?: (key: string, el: Element) => Element;
  readonly tip?: (key: string) => string | null;
}

/** A panel title's parts: "[1] Name · Other · Other", the shown one bright, each a click target. */
export function titleTabs(t: Theme, id: string, num: string | null, tabs: readonly (readonly [key: string, label: string])[], shown: string, active: boolean, pick: (key: string, cx: Context) => void, more: TabMore = {}): Element[] {
  const parts: Element[] = [];

  if (num !== null) parts.push(div().flex_none().text_color(active ? t.accent : t.dim).child(`[${num}]`));

  tabs.forEach(([key, label], i) => {
    if (i > 0) parts.push(div().flex_none().text_color(t.dim).child("·"));

    const tip = more.tip?.(key) ?? null;

    const tab = div().id(`${id}-tab-${key}`).relative().flex_none().cursor_pointer()
      .text_color(key === shown ? (active ? t.foreground : t.muted) : t.dim).hover((s) => s.text_color(t.foreground))
      .when(tip !== null, (el) => el.tooltip(tip ?? ""))
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();

        if (e.click_count >= 2 && more.open) more.open(key, cx);
        else {
          pick(key, cx);
          more.press?.(key, e, cx);
        }

        cx.notify();
      })
      .when(Boolean(more.menu), (el) => el.on_mouse_down("right", (e, cx) => {
        cx.stop_propagation();
        more.menu?.(key, cx, e);
        cx.notify();
      }))
      .child(label);

    parts.push(more.dress ? more.dress(key, tab) : tab);
  });

  return parts;
}

/** A selected row's band: dither with an accent edge (dimmer when its panel hasn't the keyboard). */
export function band(t: Theme, active: boolean): Element[] {
  return [dither(active ? t.ansi0 : `${t.ansi0}88`, 1), div().absolute().left(0).top(0).bottom(0).w(2).bg(active ? t.accent : t.ansi8)];
}

/** A small text button; `on` gives it the dithered pressed look. */
export function chip(t: Theme, id: string, label: string | Element, on: boolean, action: (cx: Context) => void, color?: Color | null): Element {
  return h_flex().id(id).relative().h(20).px(7).flex_none().items_center().text_size(11).cursor_pointer()
    .text_color(on ? t.foreground : color ?? t.muted).hover((s) => s.text_color(t.foreground))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      action(cx);
      cx.notify();
    })
    .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)))
    .child(div().relative().child(label));
}

/** A kind's badge: its two letters in a 1 px box, in its colour. */
export function kindBadge(t: Theme, kind: Kind): Element {
  const color = { postgres: t.ansi4, mysql: t.ansi3, sqlite: t.ansi6, libsql: t.ansi10 }[kind];

  return div().flex_none().w(20).h(13).border(1).border_color(color).text_color(color).text_size(9).flex().items_center().justify_center().child(KIND_MARK[kind]);
}

/** A tone's colour. */
export const toneColor = (t: Theme, tone: "working" | "done" | "failed"): Color => (tone === "failed" ? t.blocked : tone === "done" ? t.done : t.working);

/** The nocturne pip (a dithered diamond) in a colour; `breathe` while something runs. */
export function pip(color: Color, size = 6, breathe = false): Element {
  const el = svg(`${ART}/pip.svg`).size(size).flex_none().text_color(color);

  return breathe ? el.loop("opacity", { from: 0.25, to: 1, period: 1200 }) : el;
}

/** The lock mark (read only). */
export const lock = (color: Color, size = 9): Element => svg(`${ART}/lock.svg`).size(size).flex_none().text_color(color);

/** A quiet middle-of-the-panel note, with the moon (its phase, 0..8) unless small. */
export function empty(t: Theme, title: string, note: string | null | undefined, moon: number | null = 8): Element {
  return v_flex().size_full().items_center().justify_center().gap(moon === null ? 4 : 10).px(16).text_size(11)
    .when(moon !== null, (el) => el.child(svg(`${ART}/moon-${moon ?? 8}.svg`).w(40).h(40).text_color(t.ansi8).opacity(0.6)
      .loop("opacity", { from: 0.35, to: 0.7, period: 5200 })))
    .child(div().text_center().text_color(t.muted).child(title))
    .when(Boolean(note), (el) => el.child(div().text_center().max_w(460).text_color(t.dim).child(note ?? "")));
}

/** A thin rule with a label (a group in a list: "found in ~/code/x"). */
export function groupRule(t: Theme, id: string, label: string): Element {
  return h_flex().id(id).h(20).px(10).pt(4).gap(8).items_center().text_size(10).text_color(t.ansi8)
    .child(div().flex_none().child(label))
    .child(div().relative().flex_1().h(1).child(dither(t.ansi0, 1)));
}

/** The SQL editor's colours by tree-sitter capture name (editor/kinds.ts' syntaxColors). */
export function syntaxColors(t: Theme) {
  return {
    keyword: t.ansi5, "keyword.operator": t.ansi5, conditional: t.ansi5, storageclass: t.ansi5,
    function: t.ansi12, "function.call": t.ansi12, type: t.ansi10, "type.builtin": t.ansi10, "type.qualifier": t.ansi5,
    string: t.ansi11, number: t.ansi3, float: t.ansi3, boolean: t.ansi3, comment: t.ansi8,
    field: t.ansi6, variable: t.foreground, parameter: t.ansi13, operator: t.ansi9, punctuation: t.ansi8,
  };
}

/** The editor's selection colour: moonfly blue, see-through (editor/kinds.ts). */
export const selectionColor = (t: Theme): string => `${t.ansi4.slice(0, 7)}66`;
