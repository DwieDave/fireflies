// The new-space picker's drawing (newspace.ts draws with it): a row of the
// list, its name with the matched letters lit, the head with the field and esc,
// the foot that says what enter does, with the keys that apply.

import { div, svg } from "gpui-kit";
import type { Context, Element, MouseButtonEvent } from "gpui-kit";
import { h_flex, Input } from "gpui-base";
import type { InputState } from "gpui-base";
import type { SpaceInfo, Theme } from "herdr";
import { dither } from "./kit.ts";
import { tilde, isPath, folderName, tail, parentOf } from "./folderlist.ts";
import type { RankedRow } from "./folderlist.ts";

/** A row's height, the head's and the foot's (layout px). */
export const ROW = 26;
export const HEAD = 34;
export const FOOT = 28;

const chrome = (n: string) => `mods/workspace-chrome/${n}.svg`;
const stop = (_e: MouseButtonEvent, cx: Context) => cx.stop_propagation();

/** A long name in the footer: its start. */
const short = (n: string) => (n.length > 22 ? `${n.slice(0, 20)}…` : n);

/** A row of the picker: a folder, "browse…", or "no folder". */
export type PickRow =
  | (RankedRow & { readonly id: string; readonly kind: "folder" })
  | { readonly id: string; readonly kind: "browse"; readonly name: string; readonly say: string }
  | { readonly id: string; readonly kind: "loose"; readonly name: string; readonly say: string };

/** What a row asks of the picker: the pointer over it, a click on it. */
export interface RowActs {
  hoverRow(i: number, cx: Context): void;
  pickRow(i: number, cx: Context): void;
}

/** A row's name, the matched letters in the accent. */
export function nameText(t: Theme, r: { readonly name: string; readonly hits?: readonly number[] }, on: boolean): Element {
  const base = on ? t.foreground : t.muted;
  const hits = r.hits ?? [];

  if (!hits.length) return div().flex_none().text_color(base).child(r.name);

  return h_flex().flex_none().children([...r.name].map((ch, i) => div().text_color(hits.includes(i) ? t.accent : base).child(ch)));
}

/** Row `i`: its mark, name, where it is (or what it does) and its tag; `on`: the cursor's. */
export function pickRow(t: Theme, r: PickRow, i: number, on: boolean, home: string, acts: RowActs): Element {
  const folder = r.kind === "folder" ? r : null;
  const icon = r.kind === "browse" ? "search" : r.kind === "loose" ? "square" : folder?.from === "here" ? "terminal" : folder?.tag === "worktree" ? "git-branch" : "folder";
  const tag = folder?.tag ?? "";
  const tagColor = tag === "now" ? t.accent : tag && !["git", "worktree"].includes(tag) ? t.done : t.dim;
  // Where the folder is (its parent's path, the end of it in the room the name and
  // tag leave); a typed path's own subfolders need none: the heading says it.
  const room = 58 - r.name.length - tag.length;
  const where = !folder || folder.from === "path" ? "" : folder.from === "self" || folder.from === "typed" ? tilde(folder.path, home) : `${tilde(parentOf(folder.path), home)}/`;
  const words = folder ? (room >= 10 ? tail(where, room) : "") : r.kind === "folder" ? "" : r.say;

  return h_flex().id(`ns-row-${i}`).relative().h(ROW).flex_none().px(12).gap(10).items_center().text_size(11)
    .on_mouse_down("left", stop)
    // The pointer moving over a row takes the cursor; one resting where the list
    // opens doesn't (enter would pick the row under it, not "here").
    .on_mouse_move((_e, cx) => acts.hoverRow(i, cx))
    .on_click((_e, cx) => acts.pickRow(i, cx))
    .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
    .child(svg(chrome(icon)).size(12).flex_none().relative().text_color(on || !folder ? t.accent : t.ansi8))
    .child(div().relative().flex_none().child(nameText(t, r, on)))
    .child(div().relative().flex_1().min_w(0).truncate().text_color(t.dim).child(words))
    .when(Boolean(tag), (el) => el.child(div().relative().flex_none().text_color(tagColor).child(tag)));
}

/** What the footer's words read from the picker. */
export interface SayState {
  readonly error: string;
  readonly naming: { readonly folder: string | null } | null;
  /** The name typed so far (naming). */
  readonly name: string;
  readonly cursor: number;
  readonly query: string;
  readonly space: SpaceInfo | null;
  readonly home: string;
}

/** What enter does now, in words (the footer). */
export function sayNow(s: SayState, all: readonly PickRow[]): string {
  if (s.error) return s.error;

  if (s.naming) {
    const f = s.naming.folder;

    return `"${short(s.name || (f ? folderName(f, s.home) : "~"))}" in ${f ? tail(tilde(f, s.home), 26) : "~"}`;
  }

  const r = all[s.cursor];

  if (!r) return isPath(s.query) ? `in ${tail(s.query, 32)}` : "";

  if (r.kind === "browse") return "pick a folder in the system's browser";

  if (s.space) {
    if (r.kind === "loose") return `${s.space.name} detaches, back to ~`;

    if (r.from === "now") return `${s.space.name} stays where it is`;

    return `${s.space.name} moves to ${tail(tilde(r.path, s.home), 24)}`;
  }

  if (r.kind === "loose") return "a space with no folder, in ~";

  return `"${short(r.name)}" in ${tail(tilde(r.path, s.home), 26)}`;
}

/** The field (the filter, or the name with its label), framed in the accent. */
export function fieldBox(t: Theme, state: InputState | null, label: string | null): Element {
  return h_flex().id(label ? "ns-name-field" : "ns-field").flex_1().min_w(0).h(22).px(6).gap(6).items_center()
    .border(1).border_color(t.accent).bg(t.background)
    .when(Boolean(label), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(label ?? "")))
    .when(Boolean(state), (el) => (state ? el.child(Input.new(state).flex_1().h_full().text_size(11).text_color(t.foreground)) : el));
}

/** The head: the title, the field, esc. */
export function pickerHead(t: Theme, title: string, field: Element, onEsc: (cx: Context) => void): Element {
  return h_flex().relative().h(HEAD).flex_none().px(12).gap(8).items_center().text_size(11)
    .child(div().flex_none().text_color(t.foreground).child(title))
    .child(field)
    .child(div().id("ns-esc").flex_none().px(5).h(18).flex().items_center().text_color(t.muted)
      .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => onEsc(cx))
      .child("esc"))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
}

/** What the foot shows: what enter does, whether that's an error, tab's completion, the mode. */
export interface FootState {
  readonly say: string;
  readonly error: boolean;
  readonly ghost: string;
  readonly naming: boolean;
  readonly attaching: boolean;
}

/** The foot: what enter does, and the keys that apply now. */
export function pickerFoot(t: Theme, f: FootState): Element {
  const hint = (k: string, w: string) => h_flex().flex_none().gap(4).child(div().text_color(t.accent).child(k)).child(div().text_color(t.dim).child(w));

  return h_flex().id("ns-foot").relative().h(FOOT).flex_none().px(12).gap(12).items_center().text_size(11)
    .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
    .child(div().id("ns-say").flex_1().min_w(0).truncate().text_color(f.error ? t.blocked : t.muted).child(f.say))
    .when(Boolean(f.ghost), (el) => el.child(hint("tab", f.ghost)))
    .when(!f.ghost && !f.naming, (el) => el.child(hint("enter", f.attaching ? "attach" : "make")))
    .when(!f.ghost && !f.naming && !f.attaching, (el) => el.child(hint("⌘enter", "name it")))
    .when(f.naming, (el) => el.child(hint("enter", "make")).child(hint("esc", "back")));
}
