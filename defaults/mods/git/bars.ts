// The git window's header (the repo, its branch and state, busy work) and
// options bar (the context's keys, a note), and the key lists they open: the ?
// overview and a row's right-click menu.

import { div, svg } from "gpui-kit";
import type { Context } from "gpui-kit";
import { h_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { Binding, KeyContext, ListContext } from "./keys.ts";
import { lookup, barKeys, menuKeys, bindings, keyLabel, isListContext } from "./keys.ts";
import { act } from "./actions.ts";
import type { MenuItem } from "./popups.ts";
import { keysHint } from "./keyhelp.ts";
import type { KeyRow, KeySection } from "./keyhelp.ts";
import type { Hint } from "./draw.ts";
import { ART, dither, chip, hints, short } from "./draw.ts";
import { CONTEXT_NAMES } from "./state.ts";
import { pathOf, nameOf, subjectOf } from "./items.ts";
import type { default as GitView } from "./main.ts";
import { openPane, quit } from "./panes.ts";
import { reload } from "./reads.ts";

/** A bar label: the first words before "/" or "…". */
export const shortLabel = (s: string) => (s.replace(/ \(.*\)$/, "").replace(/…$/, "").split(" / ")[0]?.split(",")[0]?.split(/ (?:into|the|with|from|to|as|on|of|this|last|all) /)[0] ?? "").toLowerCase();

/** Contexts whose right-click menu offers ctrl-p (the main view shows a diff for them). */
export const PANE_CONTEXTS: ReadonlySet<KeyContext> = new Set<KeyContext>(["files", "review", "commits", "subCommits", "reflog", "commitFiles", "stash", "staging", "main"]);

export function windowHeader(v: GitView, t: Theme) {
  const s = v.data.status;
  const where = v.git ? v.git.root.replace(/^\/(Users|home)\/[^/]+/, "~") : v.folder ?? "";
  const state = v.data.state;

  const head = h_flex().id("git-head").relative().h(34).flex_none().pl(12).pr(6).gap(10).items_center().text_size(11)
    .child(div().absolute().inset_0().opacity(0.5).child(dither(t.ansi0, 2)))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi8, 1)));

  const flying = v.busyText ? head.child(svg(`${ART}/wings.svg`).absolute().top(4).size(10).text_color(t.working)
    .loop("left", { from: 140, to: Math.max(300, v.size.width - 260), period: 9000 })
    .loop("opacity", { from: 0.3, to: 1, period: 800 })) : head;

  const named = flying
    .child(h_flex().relative().flex_none().gap(8).items_center()
      .child(svg(`${ART}/moon-6.svg`).size(16).text_color(t.foreground))
      .child(div().text_color(t.foreground).child("GIT")))
    .child(div().relative().flex_none().max_w(360).truncate().text_color(t.muted).child(v.on ? `${v.on}:${where}` : where));

  const branch = s
    ? named
      .child(div().relative().flex_none().text_color(t.ansi6).child(s.head ?? `(detached ${short(s.oid ?? "")})`))
      .when(s.ahead > 0, (e2) => e2.child(div().relative().flex_none().text_color(t.ansi4).child(`↑${s.ahead}`)))
      .when(s.behind > 0, (e2) => e2.child(div().relative().flex_none().text_color(t.ansi5).child(`↓${s.behind}`)))
    : named;

  const stated = state ? branch.child(h_flex().relative().flex_none().px(5).h(16).items_center().bg(t.ansi3).text_color(t.background).child(`${state.toUpperCase()} · m`)) : branch;
  const backed = v.backTo ? stated.child(chip(t, "git-back", "‹ GitHub", false, () => v.goBack(), t.dim)) : stated;
  const spaced = backed.child(div().flex_1());
  const busy = v.busyText ? spaced.child(div().relative().text_color(t.working).child(v.busyText)) : spaced;

  const keyed = busy
    .child(keysHint(t, "git-keys", v.popups.top?.kind === "keys", () => (v.popups.top?.kind === "keys" ? v.popups.close() : openKeys(v))).mx(4))
    .child(chip(t, "git-refresh", "↻", false, () => reload(v, true)));

  return v.overlay ? keyed.child(chip(t, "git-close", "✕", false, () => quit(v))) : keyed;
}

export function optionsBar(v: GitView, t: Theme) {
  const ctx = v.ctx();

  // The context's keys on the left; the global ones (push, pull) at the
  // right end, and the help key (?) last of all.
  const keys: readonly (readonly [key: string, what: string, global: boolean])[] = v.show && ctx === "main"
    ? [["q", "close", false], ["j/k", "scroll", false], ["J/K", "page", false], ["n/N", "file", false], ["{ }", "context", false], ["?", "keys", true]]
    : ctx === "filter" ? [["enter", "keep", false], ["esc", "clear", false]]
    : (ctx === "keys" ? bindings("global").filter((b) => b.flags.has("bar")) : barKeys(ctx)).map((b) => [keyLabel(b.key), shortLabel(b.label), b.context === "global"] as const);

  const help = keys.find(([k]) => k === "?") ?? null;
  const list = keys.flatMap((x): Hint[] => (x !== help && !x[2] ? [[x[0], x[1]]] : []));
  const ends = keys.flatMap((x): Hint[] => (x !== help && x[2] ? [[x[0], x[1]]] : []));
  const note = v.noteText;

  const right = note ? div().text_color(note.tone === "failed" ? t.blocked : t.done).truncate().max_w(420).child(note.text)
    : v.copied.length ? div().text_color(t.ansi5).child(`${v.copied.length} copied · V paste`)
    : div().text_color(t.dim).child(v.show ? "q closes v pane" : "1-5 panels · + widen");

  return hints(t, [["", "", CONTEXT_NAMES[ctx].toUpperCase()], ...list], right, (key, cx) => {
    if (v.show && ctx === "main" && key === "?") return openKeys(v);

    if (ctx === "keys" || ctx === "filter") return;

    const b = lookup(ctx, key === "esc" ? "escape" : key === "pgup" ? "pageup" : key === "pgdn" ? "pagedown" : key);

    if (b) act(v, b.action, cx);
  }, { ends, help: help ? [help[0], help[1]] : null });
}

/** ?: every key of the focused context, the list's and the window's, as
 *  keyhelp.ts's overview; a row runs its action (j k enter, or its key). */
export function openKeys(v: GitView) {
  const ctx = v.ctx();
  const own = bindings(isListContext(ctx) || ctx === "staging" || ctx === "main" ? ctx : v.ctxOf(v.panel));
  const glob = bindings("global").filter((b) => !b.flags.has("hidden"));
  const list = isListContext(ctx) ? bindings("list").filter((b) => !b.flags.has("hidden")) : [];
  const row = (b: Binding): KeyRow => Object.assign([b.keys.map(keyLabel).join(" "), b.label, (cx: Context) => v.run(b.action, cx)] as const, { key: b.keys[0] ?? "", danger: b.flags.has("danger") });

  const sections: KeySection[] = [{ title: CONTEXT_NAMES[ctx], keys: own.filter((b) => !b.flags.has("hidden")).map(row) },
    ...(list.length ? [{ title: "list", keys: list.map(row) }] : []),
    { title: "global", keys: glob.map(row) }];

  v.popups.keys({ title: `git · ${CONTEXT_NAMES[ctx]}`, sections: sections.filter((s) => s.keys.length) });
}

/** A row's right-click menu: its context's actions with their keys. */
export function contextMenu(v: GitView, ctx: ListContext | "staging" | "main") {
  const items: MenuItem[] = menuKeys(ctx).map((b) => ({ key: keyLabel(b.key), label: b.label, danger: b.flags.has("danger"), go: (cx: Context) => v.run(b.action, cx) }));

  if (!v.show && PANE_CONTEXTS.has(ctx)) {
    items.push({ key: "ctrl-p", label: "Open the diff as a pane", go: () => openPane(v, false) });
    items.push({ key: "ctrl-shift-p", label: "Open the diff in a new tab", go: () => openPane(v, true) });
  }

  const x = v.item(ctx);
  const title = nameOf(x) ?? pathOf(x) ?? subjectOf(x) ?? CONTEXT_NAMES[ctx];

  v.menu({ title: title.slice(0, 60), items, at: { x: v.mouse.x, y: v.mouse.y } });
}
