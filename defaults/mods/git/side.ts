// The git window's side panels: a numbered panel with its tabs or drill-in
// title, its screen-mode chip, its list and filter, and the column they stack in.

import { div } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import type { Theme } from "herdr";
import { panel } from "./draw.ts";
import type { Panel, Tab, SideOptions } from "./state.ts";
import { PANELS, isTabbed, TABS, WIDE_ROW, ROW } from "./state.ts";
import { drawRow } from "./rows.ts";
import { sideList } from "./lists.ts";
import type { default as GitView } from "./main.ts";
import { loadMain } from "./content.ts";
import { cycleScreen } from "./navigate.ts";

export function tabsTitle(v: GitView, t: Theme, p: Panel, active: boolean, num: number): Element[] {
  const parts = [div().text_color(active ? t.accent : t.dim).child(`[${num}]`)];
  const s = v.sub(p);

  if (s) {
    parts.push(div().text_color(t.foreground).child(s.kind === "subCommits" ? "Commits" : s.kind === "remoteBranches" ? "Remote branches" : "Files"));
    parts.push(div().text_color(t.dim).child(`· ${s.title}`));

    return parts;
  }

  if (!isTabbed(p)) {
    parts.push(div().text_color(active ? t.foreground : t.muted).child(p === "status" ? "Status" : "Stash"));

    return parts;
  }

  const tabs: readonly (readonly [Tab, string])[] = TABS[p];

  tabs.forEach(([id, label], k) => {
    if (k) parts.push(div().text_color(t.ansi0).child("-"));

    const on = v.tabOf[p] === id;

    // The open tab of the focused panel is lit in the accent, lazygit's
    // way: an underline would sit below the edge row, on the first row.
    parts.push(div().id(`tab-${p}-${id}`).text_color(on ? (active ? t.accent : t.muted) : t.dim)
      .hover((st) => st.text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        v.panel = p;
        v.focus = "side";
        v.setTab(id);
        cx.notify();
      })
      .child(label));
  });

  return parts;
}

/** The ⤢ that cycles a panel's screen mode (the mouse's + and _). */
export function modeChip(v: GitView, t: Theme, p: Panel) {
  const big = v.panel === p && v.mode !== "normal";

  return div().id(`mode-${p}`).px(2).text_color(big ? t.accent : t.dim).hover((s) => s.text_color(t.foreground))
    .tooltip(big ? `${v.mode} screen: + / _ cycle, click to shrink` : "Widen (+): half, then full screen")
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();

      if (v.panel !== p) {
        v.panel = p;
        v.focus = "side";
        v.mode = "normal";
      }

      cycleScreen(v, 1);
      loadMain(v);
      cx.notify();
    })
    .child(big ? "⤡" : "⤢");
}

export function sidePanel(v: GitView, t: Theme, p: Panel, options: SideOptions = {}) {
  const { wide = false, compact = false } = options;
  const active = v.panel === p && v.focus === "side" && !v.popups.open;
  const num = PANELS.indexOf(p) + 1;
  const ctx = v.ctxOf(p);
  const n = v.items(ctx).length;
  const isCommits = ctx === "commits" || ctx === "subCommits";
  const rowH = wide && isCommits ? WIDE_ROW : ROW;
  const filtering = v.filtering?.ctx === ctx ? v.filtering : null;
  const count = n ? `${Math.min((v.sel[ctx] ?? 0) + 1, n)} of ${n}${v.cut(ctx) ? "+" : ""}` : null;
  const reviewed = ctx === "review" && v.review.files.length ? `${v.review.scopeName()} · ${v.review.summary()}` : count;
  const filter = v.filters[ctx];
  const foot = filter && !filtering ? `/${filter} · ${reviewed ?? "0"}` : reviewed;

  const list = v_flex().size_full()
    .child(div().flex_1().min_h(0).child(sideList(v, t, ctx, rowH, drawRow(v, t, ctx, wide), active)));

  const body = filtering
    ? list.child(h_flex().h(22).mx(4).mb(2).px(6).gap(6).items_center().border(1).border_color(t.accent).text_size(11)
      .child(div().text_color(t.accent).child("/")).child(Input.new(filtering.input).flex_1().text_size(11).text_color(t.foreground)))
    : list;

  return panel(t, `panel-${p}`, tabsTitle(v, t, p, active, num), active, body, {
    foot: compact || p === "status" ? null : foot,
    right: p === "status" ? null : modeChip(v, t, p),
    onTitle: (e, cx) => {
      v.handle?.focus();
      v.panel = p;
      v.focus = "side";
      v.staging = null;

      if (e.click_count === 2) cycleScreen(v, 1);

      loadMain(v);
      cx.notify();
    },
  }).on_mouse_down("left", (_e, cx) => {
    v.handle?.focus();

    if (v.panel !== p || v.focus !== "side") {
      v.panel = p;
      v.focus = "side";
      v.staging = null;
      loadMain(v);
    }

    cx.notify();
  });
}

export function sideColumn(v: GitView, t: Theme, panels: readonly Panel[], compact = false) {
  return v_flex().size_full().gap(12).pt(7).children(panels.map((p) => {
    const el = sidePanel(v, t, p, { compact });
    const focusedHere = v.panel === p;

    if (p === "status") return el.h(30).flex_none();

    if (p === "stash" && !focusedHere) return el.h(v.data.stash.length ? Math.min(3, v.data.stash.length) * ROW + 20 : 30).flex_none();

    return el.flex_grow(focusedHere && !compact ? 2.2 : 1).flex_basis(0).min_h(30);
  }));
}
