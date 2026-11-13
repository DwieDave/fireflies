// The git window's right side and its layouts: the main view (a diff, staging
// lines over the other side, a log), its windowed lists, the command log under
// it, and how the side panels and the main view share the window in each
// screen mode, narrow, and as a ctrl-p pane.

import { div, svg } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings } from "herdr";
import type { Theme } from "herdr";
import { isChange } from "./patch.ts";
import { act } from "./actions.ts";
import type { MainRow } from "./draw.ts";
import { panel, empty, logTail, diffLine, unzoom, short, rowWindow } from "./draw.ts";
import type { Show, MainListOptions } from "./state.ts";
import { PANELS, ROW, NARROW } from "./state.ts";
import { splitter } from "./lists.ts";
import { sideColumn, sidePanel } from "./side.ts";
import type { default as GitView } from "./main.ts";
import { contextMenu } from "./bars.ts";
import { openPane } from "./panes.ts";
import { pickedKeys, switchSide } from "./staging.ts";
import { readMore } from "./content.ts";

export function mainPanel(v: GitView, t: Theme) {
  const active = v.focus === "main" && !v.popups.open;
  const code = settings().font_family || "JetBrains Mono";
  const s = v.staging;
  const m = v.main;
  const narrow = v.size.width < NARROW;

  if (s) {
    const keys = pickedKeys(v);
    const mine = mainList(v, t, "main-diff", s.rows, (r, i) => diffLine(t, r, { code, compact: narrow, pick: r.kind !== "@" && keys.has(`${r.hunk}:${r.line}`), cursor: i === s.cur, active, path: s.file.path }), { follow: s.cur, key: "staging" });
    const title = (on: boolean, label: string) => [div().text_color(on ? t.foreground : t.dim).child(label)];
    const right = div().text_color(t.dim).child(`${s.file.path}${s.hunkMode ? " · hunk" : s.anchor !== null ? " · range" : ""}`);
    const a = panel(t, "main-a", title(true, s.side === "staged" ? "Staged changes" : "Unstaged changes"), active, mine, { right, foot: active ? "tab: other side · a: hunk mode" : null }).flex_grow(1.4).flex_basis(0);

    if (!s.other) return v_flex().size_full().gap(12).pt(7).child(a);

    const b = panel(t, "main-b", title(false, s.side === "staged" ? "Unstaged changes" : "Staged changes"), false,
      mainList(v, t, "main-other", s.other, (r) => diffLine(t, r, { code, compact: narrow, active: false, path: s.file.path }), { key: "other" }),
      { onTitle: (_e, cx) => { switchSide(v); cx.notify(); } }).flex_grow(0.8).flex_basis(0);

    return v_flex().size_full().gap(12).pt(7).child(s.side === "staged" ? b : a).child(s.side === "staged" ? a : b);
  }

  const rows = m?.rows ?? [];
  const rowH = m?.rowH ?? ROW;

  const body = !m ? empty(t, v.state === "ready" ? "Reading…" : "", null, { small: true })
    : !rows.length ? empty(t, "Nothing to show", null, { small: true })
    : mainList(v, t, "main-diff", rows, (r) => diffLine(t, r, { code, compact: narrow, path: ("path" in r ? r.path : undefined) ?? m.path ?? null, active, h: rowH }), { key: "main", rowH });

  // ⧉: what this view shows, as a pane (shift: a new tab), like a pane header's split.
  const asPane = !v.show && rows.length ? div().id("main-as-pane").px(3).flex_none().text_color(t.dim).hover((st) => st.text_color(t.accent).bg(`${t.ansi0}66`))
    .tooltip("Open as a pane beside (ctrl-p) · shift: in a new tab (ctrl-shift-p)")
    .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); openPane(v, e.modifiers.shift); cx.notify(); })
    .child(svg("mods/workspace-chrome/panel-right.svg").size(11).text_color(t.dim)) : null;

  const base = v.diffBase;
  const extras = base || asPane ? h_flex().gap(8).items_center() : null;
  const withBase = extras && base ? extras.child(div().text_color(t.ansi3).child(`diff mode: ${short(base)} (W)`)) : extras;
  const right = withBase && asPane ? withBase.child(asPane) : withBase;

  const one = panel(t, "main-a", [div().text_color(active ? t.foreground : t.muted).child(m?.title ?? "")], active, body, {
    right,
    onTitle: (_e, cx) => { v.focusMain(); cx.notify(); },
  }).flex_grow(1.4).flex_basis(0);

  const second = m?.second;
  const parts = [one];

  if (second) {
    parts.push(panel(t, "main-b", [div().text_color(t.dim).child(second.title)], false,
      mainList(v, t, "main-second", second.rows, (r) => diffLine(t, r, { code, compact: narrow, active: false, path: m.path ?? null }), { key: "second" })).flex_grow(0.8).flex_basis(0));
  }

  return v_flex().size_full().gap(12).pt(7).children(parts);
}

/** A main-view list: windowed like the side lists; the wheel scrolls it. */
export function mainList<R extends MainRow>(view: GitView, t: Theme, id: string, rows: readonly R[], draw: (r: R, i: number) => Element, options: MainListOptions = {}) {
  const { follow = null, key = "main", rowH = ROW } = options;
  // As list(): the rows that fit come from the height, at this list's row
  // height (a diff's and the branch log's differ).
  const px = view.mainPx[key];
  const vis = px ? rowWindow(rows.length, 0, px, rowH).vis : 30;
  const staging = view.staging;
  let top = key === "staging" ? (staging?.top ?? 0) : key === "main" ? view.mainTop : (view.otherTop[key] ?? 0);

  if (follow !== null) {
    if (follow < top + 1) top = Math.max(0, follow - 2);

    if (follow >= top + vis - 1) top = follow - vis + 3;
  }

  top = Math.max(0, Math.min(top, Math.max(0, rows.length - vis)));

  const setTop = (v: number) => {
    if (key === "staging") {
      if (view.staging) view.staging.top = v;
    } else if (key === "main") view.mainTop = v;
    else view.otherTop[key] = v;
  };

  setTop(top);

  if (key === "main" || key === "staging") view.mainVis = vis;

  if (key === "main" && view.main?.more && rows === view.main.rows && top + vis >= rows.length - 1) readMore(view, "main");

  const last = rows[rows.length - 1];
  const tail = top + vis >= rows.length - 1 ? logTail(t, last, px ?? 600) : null;

  const list = div().id(id).relative().size_full().overflow_hidden()
    .on_size_change((size, cx) => {
      const h = unzoom(size.height);

      if (h !== view.mainPx[key]) {
        view.mainPx[key] = h;
        cx.notify();
      }
    })
    .on_scroll_wheel((e, cx) => {
      cx.stop_propagation();
      view.mainWheel += unzoom(e.delta.y) / rowH;

      const steps = Math.trunc(view.mainWheel);

      if (!steps) return;

      view.mainWheel -= steps;
      setTop(Math.max(0, Math.min(Math.max(0, rows.length - vis), top - steps)));
      cx.notify();
    })
    .on_mouse_down("left", (e, cx) => {
      view.handle?.focus();

      const s = view.staging;

      if (key === "staging" && s) {
        // A click picks the line under the pointer; shift extends a range.
        const y = unzoom(e.local_position?.y ?? 0);
        const i = top + Math.floor(y / rowH);

        if (isChange(s.rows[i])) {
          if (e.modifiers.shift) {
            if (s.anchor === null) s.anchor = s.cur;
          } else s.anchor = null;

          s.cur = i;
        }

        if (e.click_count === 2) act(view, "stage-pick", cx);
      }

      if (view.focus !== "main" && (key === "main" || key === "staging") && rows.length) view.focusMain();

      cx.notify();
    })
    .on_mouse_down("right", (_e, cx) => {
      cx.stop_propagation();

      if (view.staging || view.focus === "main") contextMenu(view, view.staging ? "staging" : "main");

      cx.notify();
    })
    .child(v_flex().size_full().children(rows.slice(top, top + vis + 1).map((r, k) => draw(r, top + k).id(`${id}-${top + k}`).flex_none()))
      .children(tail ? [tail] : []));

  return rows.length > vis
    ? list.child(div().absolute().right(0).w(2).top(`${Math.round((top / rows.length) * 100)}%`).h(`${Math.max(3, Math.round((vis / rows.length) * 100))}%`).bg(`${t.ansi8}66`))
    : list;
}

export function logPanel(v: GitView, t: Theme) {
  const shown = v.logs.slice(-40);

  const lines = shown.flatMap((e, i) => {
    const title = h_flex().id(`log-t-${i}`).gap(6).text_size(11).child(div().text_color(e.ok === false ? t.ansi1 : t.foreground).child(e.title));

    return [
      e.ok === null ? title.child(div().text_color(t.working).frames(["░", "▒", "▓", "█", "▓", "▒"], 120)) : title,
      div().id(`log-c-${i}`).pl(12).text_size(11).truncate().text_color(e.ok === false ? `${t.ansi1}cc` : t.ansi6).child(e.cmd),
    ];
  });

  const vis = Math.max(1, Math.floor((v.logH - 14) / 15));
  const body = v_flex().size_full().px(10).justify_end().overflow_hidden().children(lines.slice(-vis));

  return panel(t, "panel-log", [div().text_color(t.muted).child("Command log")], false,
    lines.length ? body : body.child(div().text_size(11).text_color(t.dim).child("What git runs shows here (@ for options).")),
    { right: div().text_color(t.dim).child("@") }).size_full();
}

export function mainColumn(view: GitView, t: Theme) {
  const column = v_flex().flex_1().min_w(0).h_full()
    .child(div().flex_1().min_h(0).child(mainPanel(view, t)));

  return view.showLog
    ? column
      .child(splitter(view, t, "split-log", "y", "log", view.logH, (v) => { view.logH = v; }, { min: 50, max: Math.max(60, view.size.height - 200), sign: -1 }))
      .child(div().h(view.logH).flex_none().pt(6).child(logPanel(view, t)))
    : column;
}

/** A ctrl-p pane: the one diff, or the review list beside its diff. */
export function showBody(view: GitView, t: Theme, show: Show) {
  if (show.kind !== "review") return div().size_full().px(6).pb(4).child(mainPanel(view, t));

  if (view.size.width < NARROW) return div().size_full().px(6).pb(4).child(view.focus === "main" ? mainPanel(view, t) : sidePanel(view, t, "files").size_full().mt(7));

  const sideW = view.sideW ?? Math.round(Math.max(220, Math.min(360, view.size.width * 0.3)));

  return h_flex().size_full().px(6).pb(4)
    .child(div().w(sideW).flex_none().h_full().pt(7).child(sidePanel(view, t, "files").size_full()))
    .child(splitter(view, t, "split-side", "x", "side", sideW, (v) => { view.sideW = v; }, { min: 160, max: view.size.width * 0.7 }))
    .child(div().flex_1().min_w(0).h_full().child(mainPanel(view, t)));
}

export function windowBody(gv: GitView, t: Theme) {
  if (gv.show) return showBody(gv, t, gv.show);

  const w = gv.size.width;
  const narrow = w < NARROW;

  if (narrow) {
    // One thing at a time: the side panels, or the main view (enter / esc).
    if (gv.focus === "main") return div().size_full().px(6).pb(4).child(mainPanel(gv, t));

    return div().size_full().px(6).pb(4).child(sideColumn(gv, t, PANELS));
  }

  if (gv.mode === "full") {
    return div().size_full().px(6).pb(4).pt(7).child(gv.focus === "main" ? mainPanel(gv, t) : sidePanel(gv, t, gv.panel, { wide: true }).size_full());
  }

  if (gv.mode === "half") {
    const railW = gv.railW ?? Math.round(Math.max(230, Math.min(300, w * 0.22)));
    const midW = gv.midW ?? Math.round(Math.max(360, Math.min(620, w * 0.38)));
    const rail = PANELS.filter((p) => p !== gv.panel);

    return h_flex().size_full().px(6).pb(4)
      .child(div().w(railW).flex_none().h_full().child(sideColumn(gv, t, rail, true)))
      .child(splitter(gv, t, "split-rail", "x", "rail", railW, (v) => { gv.railW = v; }, { min: 180, max: w * 0.4 }))
      .child(div().w(midW).flex_none().h_full().pt(7).child(sidePanel(gv, t, gv.panel, { wide: true }).size_full()))
      .child(splitter(gv, t, "split-mid", "x", "mid", midW, (v) => { gv.midW = v; }, { min: 280, max: w * 0.7 }))
      .child(mainColumn(gv, t));
  }

  const sideW = gv.sideW ?? Math.round(Math.max(280, Math.min(520, w * 0.34)));

  return h_flex().size_full().px(6).pb(4)
    .child(div().w(sideW).flex_none().h_full().child(sideColumn(gv, t, PANELS)))
    .child(splitter(gv, t, "split-side", "x", "side", sideW, (v) => { gv.sideW = v; }, { min: 200, max: w * 0.7 }))
    .child(mainColumn(gv, t));
}
