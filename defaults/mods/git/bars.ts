// The git window's header (the repo, its branch and state, busy work) and
// options bar (the context's keys, a note), and the key lists they open: the ?
// overview and a row's right-click menu.

import { Array as Arr, Option, String as Str } from "effect";
import { div, svg } from "gpui-kit";
import type { Context } from "gpui-kit";
import { h_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { Action, Binding, KeyContext, ListContext } from "./keys.ts";
import { lookup, barKeys, menuKeys, bindings, keyLabel, isListContext } from "./keys.ts";
import { act } from "./actions.ts";
import type { MenuItem } from "./popups.ts";
import { keysHint } from "@fireflies/keyhelp";
import type { KeyRow, KeySection } from "@fireflies/keyhelp";
import type { Hint } from "./draw.ts";
import { ART, dither, chip, hints, short } from "./draw.ts";
import { CONTEXT_NAMES } from "./state.ts";
import { pathOf, nameOf, subjectOf } from "./items.ts";
import type { default as GitView } from "./main.ts";
import { openPane, quit } from "./panes.ts";
import { reload } from "./reads.ts";
import { inPane, movable, move } from "./place.ts";
import { edge } from "@fireflies/tones";

/** A bar label: the first words before "/" or "…". */
export const shortLabel = (s: string): string => {
  const first = (text: string, sep: string | RegExp): string => Option.getOrElse(Arr.head(Str.split(text, sep)), () => "");
  const plain = Str.replace(/…$/, "")(Str.replace(/ \(.*\)$/, "")(s));

  return Str.toLowerCase(first(first(first(plain, " / "), ","), / (?:into|the|with|from|to|as|on|of|this|last|all) /));
};

/** The options bar's key names that differ from the key table's. */
const BAR_KEYS: ReadonlyMap<string, string> = new Map([["esc", "escape"], ["pgup", "pageup"], ["pgdn", "pagedown"]]);

/** Contexts whose right-click menu offers ctrl-p (the main view shows a diff for them). */
export const PANE_CONTEXTS: ReadonlySet<KeyContext> = new Set<KeyContext>(["files", "review", "commits", "subCommits", "reflog", "commitFiles", "stash", "staging", "main"]);

export function windowHeader(v: GitView, t: Theme) {
  const s = v.data.status;
  const where = v.git === null ? v.folder ?? "" : Str.replace(/^\/(Users|home)\/[^/]+/, "~")(v.git.root);
  const state = v.data.state;

  const head = h_flex().id("git-head").relative().h(34).flex_none().overflow_hidden().pl(12).pr(6).gap(10).items_center().text_size(11)
    .child(div().absolute().inset_0().opacity(0.5).child(dither(edge(t), 2)))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.muted, 1)));

  const flying = v.busyText !== null ? head.child(svg(`${ART}/wings.svg`).absolute().top(4).size(10).text_color(t.working)
    .loop("left", { from: 140, to: Math.max(300, v.size.width - 260), period: 9000 })
    .loop("opacity", { from: 0.3, to: 1, period: 800 })) : head;

  const named = flying
    .child(h_flex().relative().flex_none().gap(8).items_center()
      .child(svg(`${ART}/moon-6.svg`).size(16).text_color(t.foreground))
      .child(div().text_color(t.foreground).child("GIT")))
    .child(div().relative().flex_shrink(1).min_w(0).max_w(360).truncate().text_color(t.muted).child(v.on === null ? where : `${v.on}:${where}`));

  const branch = s !== null
    ? named
      .child(div().relative().flex_none().text_color(t.ansi6).child(s.head ?? `(detached ${short(s.oid ?? "")})`))
      .when(s.ahead > 0, (e2) => e2.child(div().relative().flex_none().text_color(t.ansi4).child(`↑${s.ahead}`)))
      .when(s.behind > 0, (e2) => e2.child(div().relative().flex_none().text_color(t.ansi5).child(`↓${s.behind}`)))
    : named;

  const stated = state === null ? branch : branch.child(h_flex().relative().flex_none().px(5).h(16).items_center().bg(t.ansi3).text_color(t.background).child(`${Str.toUpperCase(state)} · m`));
  const backed = v.backTo === null ? stated : stated.child(chip(t, "git-back", "‹ GitHub", false, () => v.goBack(), t.dim));
  const spaced = backed.child(div().flex_1());
  const busy = v.busyText === null ? spaced : spaced.child(div().relative().text_color(t.working).child(v.busyText));

  const keyed = busy
    .child(keysHint(t, "git-keys", v.popups.top?.kind === "keys", () => (v.popups.top?.kind === "keys" ? v.popups.close() : openKeys(v))).mx(4))
    .child(chip(t, "git-refresh", "↻", false, () => reload(v, true)));

  // Where the window's ✕ is, the move: ◧ into a pane, or from a pane ⧉ out to a window (place.ts).
  const moved = movable(v) ? keyed.child(chip(t, "git-move", inPane(v) ? "⧉" : "◧", false, () => move(v)).tooltip(inPane(v) ? "Out to a window · ctrl-t" : "Into a pane · ctrl-t")) : keyed;

  return v.overlay === null ? moved : moved.child(chip(t, "git-close", "✕", false, () => quit(v)));
}

export function optionsBar(v: GitView, t: Theme) {
  const ctx = v.ctx();

  // The context's keys on the left; the global ones (push, pull) at the
  // right end, and the help key (?) last of all.
  const keys: readonly (readonly [key: string, what: string, global: boolean])[] = v.show !== null && ctx === "main"
    ? [["q", "close", false], ["j/k", "scroll", false], ["J/K", "page", false], ["n/N", "file", false], ["{ }", "context", false], ["?", "keys", true]]
    : ctx === "filter" ? [["enter", "keep", false], ["esc", "clear", false]]
    : Arr.map(ctx === "keys" ? Arr.filter(bindings("global"), (b) => b.flags.has("bar")) : barKeys(ctx), (b) => [keyLabel(b.key), shortLabel(b.label), b.context === "global"] as const);

  const help = Option.getOrNull(Arr.findFirst(keys, ([k]) => k === "?"));
  const list = Arr.flatMap(keys, (x): Hint[] => (x !== help && !x[2] ? [[x[0], x[1]]] : []));
  const ends = Arr.flatMap(keys, (x): Hint[] => (x !== help && x[2] ? [[x[0], x[1]]] : []));
  const note = v.noteText;

  const right = note !== null ? div().text_color(note.tone === "failed" ? t.blocked : t.done).truncate().max_w(420).child(note.text)
    : Arr.isReadonlyArrayNonEmpty(v.copied) ? div().text_color(t.ansi5).child(`${v.copied.length} copied · V paste`)
    : div().text_color(t.dim).child(v.show === null ? "1-5 panels · + widen" : "q closes this pane");

  return hints(t, [["", "", Str.toUpperCase(CONTEXT_NAMES[ctx])], ...list], right, (key, cx) => {
    if (v.show !== null && ctx === "main" && key === "?") return openKeys(v);

    if (ctx === "keys" || ctx === "filter") return;

    const b = lookup(ctx, BAR_KEYS.get(key) ?? key);

    if (b !== null) act(v, b.action, cx);
  }, { ends, help: help === null ? null : [help[0], help[1]] });
}

/** ?: every key of the focused context, the list's and the window's, as
 *  keyhelp.ts's overview; a row runs its action (j k enter, or its key). */
export function openKeys(v: GitView) {
  const ctx = v.ctx();
  const own = bindings(isListContext(ctx) || ctx === "staging" || ctx === "main" ? ctx : v.ctxOf(v.panel));
  const shown = (bs: readonly Binding[]): readonly Binding[] => Arr.filter(bs, (b) => !b.flags.has("hidden"));
  const glob = shown(bindings("global"));
  const list = isListContext(ctx) ? shown(bindings("list")) : [];
  const row = (b: Binding): KeyRow => Object.assign([Arr.join(Arr.map(b.keys, keyLabel), " "), b.label, (cx: Context) => v.run(b.action, cx)] as const, { key: b.keys[0] ?? "", danger: b.flags.has("danger") });

  const sections: KeySection[] = [{ title: CONTEXT_NAMES[ctx], keys: Arr.map(shown(own), row) },
    ...(Arr.isReadonlyArrayNonEmpty(list) ? [{ title: "list", keys: Arr.map(list, row) }] : []),
    { title: "global", keys: Arr.map(glob, row) }];

  v.popups.keys({ title: `git · ${CONTEXT_NAMES[ctx]}`, sections: Arr.filter(sections, (s) => Arr.isReadonlyArrayNonEmpty(s.keys)) });
}

/** A row's right-click menu: its context's actions with their keys. */
export function contextMenu(v: GitView, ctx: ListContext | "staging" | "main") {
  // At the press; a menu an entry opens (Discard…, Reset to this…) stands there too.
  const at = { x: v.mouse.x, y: v.mouse.y };

  const go = (action: Action, cx: Context) => {
    v.menuNear = at;
    v.run(action, cx);
    v.menuNear = undefined;
  };

  const items: MenuItem[] = Arr.map(menuKeys(ctx), (b) => ({ key: keyLabel(b.key), label: b.label, danger: b.flags.has("danger"), go: (cx: Context) => go(b.action, cx) }));

  if (v.show === null && PANE_CONTEXTS.has(ctx)) {
    items.push({ key: "ctrl-p", label: "Open the diff as a pane", go: () => openPane(v, false) });
    items.push({ key: "ctrl-shift-p", label: "Open the diff in a new tab", go: () => openPane(v, true) });
  }

  const x = v.item(ctx);
  const title = nameOf(x) ?? pathOf(x) ?? subjectOf(x) ?? CONTEXT_NAMES[ctx];

  v.menu({ title: Str.slice(0, 60)(title), items, at });
}
