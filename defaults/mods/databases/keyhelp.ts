// Nocturne's one key help: the "? keys" entry that ends a bar and the keys
// overview ? opens, the same in every Nocturne pane, panel and window.
//
// This file is the source. A mod can't import another mod's files, so every
// Nocturne mod that lists its keys carries a byte-identical copy (its
// keyhelp.ts); scripts/keyhelp.test.ts fails when a copy drifts. Change it
// here, then copy it: for m in defaults/mods/*/keyhelp.ts; do cp
// defaults/mods/nocturne/keyhelp.ts "$m"; done (the mods listed in
// scripts/nocturne-mods.ts carry it; no stock mod has one)
//
//   hint(t, id, key, what)       a bar entry: the key in the accent, what it does dimmed
//   keysHint(t, id, on, toggle, key)  the bar's last entry, "? keys": bright while
//                                the overview is open; a click opens or closes it
//                                (`key`: what opens it where ? types, "cmd-k ?")
//   hintBar(t, id, list, opts)   a bar of entries: 22 px, a dithered rule on its
//                                top, `opts.right` (a note) right-aligned, "? keys" last
//   keysView(t, opts)            the overview, over the host's body (absolute,
//                                opaque): KEYS and a title, then each section's
//                                keys in an aligned column, sections side by side
//                                as the width allows, one under the other when
//                                narrow; long words wrap, never clip
//   keysKey(e, open)             what a key does to it: "toggle" (?), "close"
//                                (esc or q while open), else null
//   keysHeight(list, width)      its height in a host that size, one column (a dialog's)
//
// Lists are [[key, what], ...] or sections [{ title, keys: [[key, what], ...] }].
// Rows may carry `go` (git's runnable rows): `opts.cursor` marks one, a press runs it.

import { div, PathBuilder, Background } from "gpui-kit";
import type { Color, Context, Element, MouseButtonEvent } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings, window as appWindow } from "herdr";
import type { Theme } from "herdr";

/** One row: the key, what it does, and (git's runnable rows) what a press runs.
 *  git's rows also carry the key a press of the row's own letter runs (`key`)
 *  and whether it asks first (`danger`: drawn in the blocked colour). */
export type KeyRow = (readonly [key: string, what: string, go?: (cx: Context) => void]) & {
  readonly key?: string;
  readonly danger?: boolean;
};

/** A titled group of rows (`title` null: the list had no sections). */
export interface KeySection {
  readonly title: string | null;
  readonly keys: readonly KeyRow[];
}

/** [[key, what], ...], or sections. */
export type KeyList = readonly KeyRow[] | readonly KeySection[];

/** A key as keysKey reads it (GPUI's KeyEvent has these and more). */
export interface KeyPress {
  readonly key?: string | undefined;
  readonly key_char?: string | undefined;
  readonly modifiers?: { readonly platform?: boolean; readonly control?: boolean; readonly alt?: boolean } | undefined;
}

/** What a key does to the overview. */
export type KeysAction = "toggle" | "close";

/** hintBar's options: a note at the right, the "? keys" entry, where the rule goes. */
export interface HintBarOptions {
  readonly right?: Element | null;
  readonly keys?: { readonly on: boolean; readonly toggle: (cx: Context) => void } | null;
  /** true (the default): the bar sits at the foot of its host, its rule on top. */
  readonly foot?: boolean;
  readonly px?: number;
}

/** keysView's options. */
export interface KeysViewOptions {
  readonly id?: string;
  readonly title?: string;
  readonly list?: KeyList;
  /** The marked row's index among all rows (git's menu of rows). */
  readonly cursor?: number | null;
  /** A row clicked; without it a row with `go` runs that. */
  readonly pick?: ((row: KeyRow, cx: Context) => void) | null;
  readonly close?: ((cx: Context) => void) | null;
  /** One section under the other. */
  readonly narrow?: boolean;
}

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

/** The dither fill, as nocturne/kit.ts has it. */
function dither(color: Color, cell = 1): Element {
  const zoom = settings().zoom || 1;
  const dpr = appWindow().platform === "macos" ? 2 : 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

const stop = (_e: MouseButtonEvent, cx: Context): void => cx.stop_propagation();

// A section's column at its widest (layout px), and the key column's bounds:
// Departure Mono at 11 px is 7 px a character.
export const SECTION = 300;
const CHAR = 7;
const KEY_MIN = 48;
const KEY_MAX = 140;

/** A bar entry: `key` in the accent, `what` dimmed. */
export function hint(t: Theme, id: string, key: string, what?: string | null): Element {
  const el = h_flex().id(id).flex_none().gap(4).items_center().text_size(11)
    .child(div().text_color(t.accent).child(key));

  return what ? el.child(div().text_color(t.dim).child(what)) : el;
}

/** The bar's last entry, "? keys": bright while the overview is open; a click toggles it. */
export function keysHint(t: Theme, id: string, on: boolean, toggle: (cx: Context) => void, key = "?"): Element {
  return h_flex().id(id).flex_none().gap(4).items_center().text_size(11).cursor_pointer()
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      toggle(cx);
      cx.notify();
    })
    .child(div().text_color(t.accent).child(key))
    .child(div().text_color(on ? t.foreground : t.dim).child("keys"));
}

/** A bar: `list` ([key, what]) left, `options.right` right-aligned, "? keys" last
 *  (`options.keys`: { on, toggle }; without it, no ? entry). `options.foot` false: the rule under it. */
export function hintBar(t: Theme, id: string, list: readonly KeyRow[], options: HintBarOptions = {}): Element {
  const { right = null, keys = null, foot = true, px = 12 } = options;
  const rule = div().absolute().left(0).right(0).h(2).child(dither(t.ansi0, 1));

  const bar = h_flex().id(id).relative().h(22).flex_none().px(px).gap(12).items_center().text_size(11).overflow_hidden()
    .child(foot ? rule.top(0) : rule.bottom(0))
    .children(list.map(([k, w], i) => hint(t, `${id}-${i}`, k, w)))
    .child(div().flex_1());

  const withRight = right ? bar.child(right) : bar;

  return keys ? withRight.child(keysHint(t, `${id}-keys`, keys.on, keys.toggle)) : withRight;
}

/** Whether a list is sections (its first entry a section, not a row). */
const isSections = (list: KeyList): list is readonly KeySection[] => {
  const first = list[0];

  return first !== undefined && !Array.isArray(first);
};

/** [[k, w]] or [{ title, keys }] as sections; empty sections are left out. */
export function sectionsOf(list: KeyList): readonly KeySection[] {
  if (!list.length) return [];

  return isSections(list) ? list.filter((s) => s.keys.length > 0) : [{ title: null, keys: list }];
}

/** Every row of `list` in order (sections flattened). */
export function rowsOf(list: KeyList): readonly KeyRow[] {
  return sectionsOf(list).flatMap((s) => s.keys);
}

/** How tall the overview is for `list` in a host `width` px wide, one section
 *  under the other (layout px): its head, each row's lines as its words wrap. */
export function keysHeight(list: KeyList, width: number): number {
  let h = 26 + 10 + 12;

  for (const s of sectionsOf(list)) {
    const keyW = keyWidth(s.keys);
    const room = Math.max(60, width - 24 - 8 - keyW - 10);

    if (s.title) h += 18;

    for (const [, what] of s.keys) h += 18 * Math.max(1, Math.ceil((what.length * CHAR) / room)) + 2;

    h += 14;
  }

  return Math.ceil(h);
}

/** A section's key column: its longest key, within bounds. */
function keyWidth(keys: readonly KeyRow[]): number {
  return Math.min(KEY_MAX, Math.max(KEY_MIN, CHAR * Math.max(...keys.map(([k]) => k.length)) + 12));
}

/** What a key does to the overview: ? toggles it, esc or q close it while open. */
export function keysKey(e: KeyPress | null | undefined, open: boolean): KeysAction | null {
  const m = e?.modifiers;

  if (m?.platform || m?.control || m?.alt) return null;

  const c = e?.key_char;
  const k = e?.key;

  if (c === "?" || k === "?") return "toggle";

  if (open && (k === "escape" || k === "q")) return "close";

  return null;
}

/** What a click on a row runs: `pick`, else the row's own `go`, else nothing. */
const pressOf = (row: KeyRow, pick: ((row: KeyRow, cx: Context) => void) | null): ((cx: Context) => void) | null => {
  if (pick) return (cx) => pick(row, cx);

  return row[2] ?? null;
};

/** The overview: `options` { id, title, list, cursor?, pick?(row, cx), close?(cx), narrow? }.
 *  Fills its (relative) host; a click on it stays in it. `narrow`: one section under the other. */
export function keysView(t: Theme, options: KeysViewOptions = {}): Element {
  const { id = "keys", title = "", list = [], cursor = null, pick = null, close = null, narrow = false } = options;
  let n = 0;

  const row = (r: KeyRow, keyW: number): Element => {
    const [k, what] = r;
    const i = n++;
    const on = cursor === i;
    const press = pressOf(r, pick);
    const base = h_flex().id(`${id}-r${i}`).relative().min_h(18).gap(10).items_start().px(4);

    const clickable = press
      ? base.cursor_pointer().on_click((_e, cx) => {
        cx.stop_propagation();
        press(cx);
      })
      : base;

    const marked = on ? clickable.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)) : clickable;

    return marked
      .child(div().relative().w(keyW).flex_none().pt(1).text_color(t.accent).child(k))
      .child(div().relative().flex_1().min_w(0).pt(1).text_color(on ? t.foreground : r.danger ? t.blocked : t.muted).child(what));
  };

  const section = (s: KeySection, si: number): Element => {
    const keyW = keyWidth(s.keys);
    const base = v_flex().id(`${id}-s${si}`).gap(2).min_w(0);
    const sized = narrow ? base.w_full() : base.flex_basis(SECTION).flex_grow(1).max_w(SECTION + 120);
    const titled = s.title ? sized.child(div().pb(4).text_size(10).text_color(t.ansi8).child(s.title.toUpperCase())) : sized;

    return titled.children(s.keys.map((r) => row(r, keyW)));
  };

  const closer = h_flex().id(`${id}-close`).flex_none().gap(4).cursor_pointer();

  const head = h_flex().id(`${id}-head`).relative().h(26).flex_none().px(12).gap(8).items_center()
    .child(div().flex_none().text_size(10).text_color(t.ansi8).child("KEYS"));

  return v_flex().id(id).absolute().top(0).left(0).size_full().bg(t.background).text_size(11)
    .on_mouse_down("left", stop)
    .child((title ? head.child(div().min_w(0).truncate().text_color(t.muted).child(title)) : head)
      .child(div().flex_1())
      .child((close
        ? closer.on_click((_e, cx) => {
          cx.stop_propagation();
          close(cx);
          cx.notify();
        })
        : closer)
        .child(div().text_color(t.accent).child("? esc")).child(div().text_color(t.dim).child("close")))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1))))
    .child(div().id(`${id}-body`).flex_1().min_h(0).overflow_y_scroll()
      .child(h_flex().flex_wrap().items_start().px(12).pt(10).pb(12).gap_x(28).gap_y(14)
        .children(sectionsOf(list).map(section))));
}
