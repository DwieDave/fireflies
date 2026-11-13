// The GitHub window's chrome (main.ts places it): its tabs, the top bar,
// the keys overview (?), the picker over the body (L's links, a right-click
// menu) and the yes / no asked in the bar.

import { div, svg } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { Guarded } from "./guard.ts";
import { literal } from "./guard.ts";
import type { Hint } from "./kit.ts";
import { dither, chip, stop, pip, band, ART, popupScrim } from "./kit.ts";
import { keysView } from "./keyhelp.ts";
import Prs from "./prs.ts";
import Actions from "./actions.ts";
import Projects from "./projects.ts";
import type { default as GitHub } from "./main.ts";

/** The window's tabs. */
export const isTabId = literal("prs", "actions", "projects");

export type TabId = Guarded<typeof isTabId>;

export const TABS: readonly (readonly [TabId, string])[] = [["prs", "Pull requests"], ["actions", "Actions"], ["projects", "Projects"]];

export const TAB_NAME = { prs: "pull requests", actions: "actions", projects: "projects" } as const satisfies { readonly [K in TabId]: string };

/** A yes / no asked in the bar. */
export interface Confirm {
  readonly text: string;
  readonly go: () => void;
}

/** The window's top bar: the moon, the repo (a fork's way across), the branch, the tabs, how fresh it is, ↻ and ✕. */
export function header(v: GitHub, t: Theme): Element {
  const live = v.state === "ready" && v.shown().interval() < 10000;
  const runningRuns = (v.actions.runs ?? []).filter((r) => r.status === "in_progress").length;
  const where = v.repo ? v.repo.full : v.folder ?? "";
  const prs = v.prs.list?.length ?? 0;

  const tabs = TABS.map(([id, label], i) => chip(t, `tab-${id}`,
    h_flex().gap(6).items_center()
      .child(div().text_color(v.tab === id ? t.accent : t.dim).child(String(i + 1)))
      .child(div().child(label))
      .when(id === "actions" && runningRuns > 0, (el) => el.child(pip(t, "working", 6)))
      .when(id === "prs" && prs > 0, (el) => el.child(div().text_color(t.dim).child(String(prs)))),
    v.tab === id, (cx) => v.setTab(id, cx)));

  const said = v.readWord();

  const word = (tone: "working" | "failed" | "done", color: Color, text: string, breathe = false) => h_flex().gap(5).items_center()
    .child(breathe ? div().loop("opacity", { from: 0.35, to: 1, period: 1100 }).child(pip(t, tone, 6)) : pip(t, tone, 6))
    .child(div().text_color(color).truncate().max_w(260).child(text));

  // Quiet: what's shown is never taken away; the bar only says how old it is.
  const status = v.busy && v.loud ? word("working", t.dim, said ? `updating… · ${said.replace(/^updated /, "")}` : "updating…", true)
    : v.stale ? word("failed", t.dim, said ? `couldn't update · ${said}` : "couldn't update")
    : live ? word("working", t.working, "live")
    : said ? word("done", t.dim, said) : div();

  const r = v.repo;

  // The bar is where the window drags from: presses on it aren't stopped.
  return h_flex().id("gh-head").relative().h(36).flex_none().pl(12).pr(6).gap(10).items_center().text_size(11)
    .child(div().absolute().inset_0().opacity(0.5).child(dither(t.ansi0, 2)))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi8, 1)))
    // A firefly drifts along the bar while something runs.
    .when(live, (el) => el.child(svg(`${ART}/wings.svg`).absolute().top(4).size(10).text_color(t.working)
      .loop("left", { from: 140, to: Math.max(300, v.size.width - 260), period: 9000 })
      .loop("opacity", { from: 0.3, to: 1, period: 800 })))
    .child(h_flex().relative().flex_none().gap(8).items_center()
      .child(svg(`${ART}/moon-6.svg`).size(16).text_color(t.foreground))
      .child(div().text_color(t.foreground).child("GITHUB")))
    .child(div().relative().flex_none().max_w(320).truncate().text_color(t.muted).child(where))
    .when(Boolean(r?.parent || r?.child), (el) => el.child(chip(t, "gh-fork",
      r?.parent ? `fork of ${r.parent}` : `‹ ${r?.child ?? ""}`, false, (cx) => v.switchFork(cx), t.dim)))
    .when(Boolean(r?.branch), (el) => el.child(div().relative().flex_none().text_color(t.ansi5).child(r?.branch ?? "")))
    .child(h_flex().relative().flex_none().gap(2).children(tabs))
    .child(div().flex_1())
    .child(div().relative().flex_none().child(status))
    .child(chip(t, "gh-refresh", "↻", false, (cx) => v.refresh(cx, true)))
    .when(Boolean(v.overlay), (el) => el.child(chip(t, "gh-close", "✕", false, () => v.closeWindow())));
}

/** ?: every key of the tab and the window (keyhelp.ts). */
export function helpPanel(v: GitHub, t: Theme): Element {
  const fork = v.tab === "projects" ? "F" : "p F";
  const r = v.repo;
  const forkRow: Hint[] = r?.parent ? [[fork, `the parent, ${r.parent}`]] : r?.child ? [[fork, `back to the fork, ${r.child}`]] : [];
  const all: Hint[] = [["1 2 3 [ ]", "pull requests / actions / projects"], ["r", "read again now"], ...forkRow, ["esc q", "close (from the top)"], ["?", "keys"]];
  const tab = v.tab === "prs" ? Prs.help() : v.tab === "projects" ? Projects.help() : Actions.help();
  const name = TAB_NAME[v.tab];

  return keysView(t, {
    id: "gh-help", title: `GitHub · ${name}`, list: [{ title: name, keys: tab }, { title: "window", keys: all }], close: () => {
      v.help = false;
    },
  });
}

/** The picker (L's links, a right-click menu) over the body, its cursor kept in view. */
export function pickerPanel(v: GitHub, t: Theme): Element {
  const p = v.picker;

  if (!p) return div();

  // The cursor stays in view in a long list (the box's first child is the title).
  if (p.shownAt !== p.at) {
    p.shownAt = p.at;
    v.pickerScroll.scroll_to_item(p.at + 1);
  }

  const rows = p.rows.map((r, i) => h_flex().id(`pick-${i}`).relative().h(r.sub ? 34 : 24).flex_none().px(10).gap(10).items_center().cursor_pointer()
    .hover((s) => s.bg(`${t.ansi0}55`))
    .when(i === p.at, (el) => el.children(band(t, true)))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      v.picker = null;
      r.go(cx);
      cx.notify();
    })
    .child(div().relative().w(14).flex_none().text_color(i === p.at ? t.accent : t.dim).child(i < 9 ? String(i + 1) : ""))
    .child(v_flex().relative().flex_1().min_w(0)
      .child(div().truncate().text_color(i === p.at ? t.foreground : t.muted).child(r.label))
      .when(Boolean(r.sub), (el) => el.child(div().truncate().text_size(10).text_color(t.dim).child(r.sub ?? "")))));

  return div().id("gh-picker").absolute().inset_0().flex().items_center().justify_center().text_size(12)
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      v.picker = null;
      cx.notify();
    })
    .child(popupScrim("gh-picker-scrim"))
    .child(v_flex().id("gh-picker-box").w(560).max_h(420).bg(t.background).border(1).border_color(t.accent).py(4).overflow_y_scroll().track_scroll(v.pickerScroll)
      .on_mouse_down("left", stop)
      .child(div().px(10).pb(4).text_size(10).text_color(t.ansi8).child(p.title))
      .children(rows));
}

/** A yes / no asked in the bar. */
export function confirmBar(v: GitHub, t: Theme, c: Confirm): Element {
  return h_flex().id("gh-confirm").relative().h(30).flex_none().px(12).gap(12).items_center().text_size(12)
    .child(dither(`${t.ansi3}44`, 1))
    .child(div().relative().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.text))
    .child(chip(t, "gh-yes", "y  yes", false, () => {
      v.confirm = null;
      c.go();
    }, t.ansi3))
    .child(chip(t, "gh-no", "esc  no", false, () => {
      v.confirm = null;
    }));
}
