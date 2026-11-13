// The git window's side lists: windowed rows that follow the cursor, a
// history cut at its limit read further, the lanes running on below the last
// commit, the mouse on a row (press, double-click, right-click, wheel), and the
// splitters between columns.

import { div } from "gpui-kit";
import type { Context, MouseButtonEvent, ScrollWheelEvent } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import { LOG_LIMIT } from "./git.ts";
import type { ListContext } from "./keys.ts";
import { lookup } from "./keys.ts";
import { act } from "./actions.ts";
import { band, empty, graphPass, unzoom, rowWindow, busyMark } from "./draw.ts";
import type { ResizeOptions, DrawRow } from "./state.ts";
import { PANELS, WIDE_ROW, WIDE_LANE, LANE } from "./state.ts";
import { rowKey } from "./items.ts";
import { graphFor, shownWidth } from "./rows.ts";
import type { default as GitView } from "./main.ts";
import { contextMenu } from "./bars.ts";
import { loadMain, readMore } from "./content.ts";

/** A list body: only the rows in view are drawn (lazygit scrolls by row). */
export function sideList(v: GitView, t: Theme, ctx: ListContext, rowH: number, draw: DrawRow, active: boolean) {
  const rows = v.items(ctx);
  const n = rows.length;
  // The rows that fit, from the list's height: the row height can change
  // without a resize (Commits going wide), so a count kept from the last
  // resize would leave the bottom of the list empty.
  const px = v.listPx[ctx];
  const vis = px ? rowWindow(n, 0, px, rowH).vis : Math.max(1, v.vis[ctx] ?? 12);

  v.vis[ctx] = vis;

  let top = v.top[ctx] ?? 0;
  const sel = Math.min(v.sel[ctx] ?? 0, Math.max(0, n - 1));

  if (v.follow[ctx]) {
    if (sel < top) top = sel;

    if (sel >= top + vis) top = sel - vis + 1;

    v.follow[ctx] = false;
  }

  top = Math.max(0, Math.min(top, Math.max(0, n - vis)));
  v.top[ctx] = top;

  // The end of a history cut at its limit is in view: read further.
  if (n && top + vis >= n - 1 && v.cut(ctx) && (ctx === "commits" || ctx === "subCommits")) readMore(v, ctx);

  const range = v.range?.ctx === ctx ? [Math.min(v.range.anchor, sel), Math.max(v.range.anchor, sel)] as const : null;

  const shown = rows.slice(top, top + vis + 1).map((r, k) => {
    const i = top + k, isSel = i === sel, inRange = range !== null && i >= range[0] && i <= range[1];

    const row = div().id(`${ctx}-row-${i}`).relative().h(rowH).flex_none().w_full()
      .hover((s) => s.bg(`${t.ansi0}55`))
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); rowPress(v, ctx, i, e, cx); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); v.rowMenu(ctx, i, cx); });

    const banded = (isSel || inRange ? row.children(band(t, active && v.focus === "side")) : row)
      .child(draw(r, i, isSel).relative().size_full());

    return v.busyRows.size > 0 && v.busyRows.has(rowKey(ctx, r) ?? "") ? banded.children(busyMark(t, `${ctx}-busy-${i}`)) : banded;
  });

  const tail = n > 0 && top + vis >= n - 1 ? v.listTail(t, ctx, n - 1, rowH) : null;

  const body = div().id(`${ctx}-list`).relative().size_full().overflow_hidden()
    .on_size_change((size, cx) => {
      const h = unzoom(size.height);

      if (h !== v.listPx[ctx]) {
        v.listPx[ctx] = h;
        v.vis[ctx] = Math.max(1, Math.floor(h / rowH));
        cx.notify();
      }
    })
    .on_scroll_wheel((e, cx) => wheelList(v, ctx, e, rowH, n, cx))
    .child(v_flex().size_full().children(shown).children(tail ? [tail] : []));

  const scrolled = n > vis
    ? body.child(div().absolute().right(0).w(2).top(`${Math.round((top / n) * 100)}%`).h(`${Math.max(4, Math.round((vis / n) * 100))}%`).bg(active ? `${t.accent}aa` : `${t.ansi8}66`))
    : body;

  return n ? scrolled : scrolled.child(div().absolute().inset_0().child(empty(t, emptyText(v, ctx), null, { small: true })));
}

/** Whether a list holds a history cut at its limit (it goes further back).
 *  Not while filtered: the end of a filtered list isn't the history's. */
export function historyCut(v: GitView, ctx: ListContext) {
  if (v.filters[ctx]) return false;

  if (ctx === "commits") return v.data.commits.length >= v.commitLimit;

  if (ctx === "subCommits") {
    const s = v.subOfKind("subCommits");

    return s?.kind === "subCommits" && s.items.length >= (s.limit ?? LOG_LIMIT);
  }

  return false;
}

/** Below a commit list's last row: its open lanes run on to the bottom
 *  edge (history cut at the limit, or the panel taller than the list), so
 *  no line ends in the air. */
export function listTail(v: GitView, t: Theme, ctx: ListContext, last: number, rowH: number) {
  if (ctx !== "commits" && ctx !== "subCommits") return null;

  const g = graphFor(v, ctx), row = g?.rows[last];

  if (!g || !row || !row.after.some((c) => c != null)) return null;

  const wide = rowH === WIDE_ROW;
  const h = Math.max(rowH, v.listPx[ctx] ?? 600);
  const lanes = graphPass(t, row.after, shownWidth(v, ctx, g), { lane: wide ? WIDE_LANE : LANE, h });
  const tail = h_flex().id(`${ctx}-tail`).flex_1().min_h(0).w_full().items_start().overflow_hidden();

  return wide ? tail.pl(4).child(lanes) : tail.px(6).gap(7).child(div().w(56).flex_none()).child(div().w(18).flex_none()).child(lanes);
}

export function emptyText(v: GitView, ctx: ListContext) {
  if (v.filters[ctx]) return `Nothing matches "${v.filters[ctx] ?? ""}"`;

  switch (ctx) {
    case "files": return "Nothing changed: the work tree is clean";
    case "review": return v.review.state === "loading" ? "Reading changes…" : v.review.state === "error" ? v.review.error : `Nothing changed (${v.review.scopeName()})`;
    case "branches": return "No branches";
    case "remotes": return "No remotes: n adds one";
    case "tags": return "No tags";
    case "commits": return "No commits yet";
    case "reflog": return "Empty reflog";
    case "stash": return "Nothing stashed";
    case "worktrees": return "No worktrees";
    case "remoteBranches": return "No branches on this remote";
    case "subCommits": case "commitFiles": return "Reading…";
    default: return "Empty";
  }
}

export function wheelList(v: GitView, ctx: ListContext, e: ScrollWheelEvent, rowH: number, n: number, cx: Context) {
  cx.stop_propagation();

  const dy = unzoom(e.delta.y);

  v.wheelAcc += dy / rowH;

  const steps = Math.trunc(v.wheelAcc);

  if (!steps) return;

  v.wheelAcc -= steps;

  const vis = v.vis[ctx] ?? 10;

  v.top[ctx] = Math.max(0, Math.min(Math.max(0, n - vis), (v.top[ctx] ?? 0) - steps));
  cx.notify();
}

export function rowPress(v: GitView, ctx: ListContext, i: number, e: MouseButtonEvent, cx: Context) {
  const p = PANELS.find((x) => v.ctxOf(x) === ctx) ?? v.panel;
  const was = v.panel === p && v.focus === "side" && (v.sel[ctx] ?? 0) === i;

  v.handle?.focus();

  if (v.panel !== p || v.focus !== "side") {
    v.panel = p;
    v.focus = "side";
    v.staging = null;
  }

  if (e.modifiers.shift) {
    if (!v.range) v.range = { ctx, anchor: v.sel[ctx] ?? 0 };
  } else if (!was) v.range = null;

  v.sel[ctx] = i;
  v.mainTop = 0;
  loadMain(v);

  if (e.click_count === 2) {
    const b = lookup(ctx, "enter");

    if (b) act(v, b.action, cx);
  }

  cx.notify();
}

export function rowMenu(v: GitView, ctx: ListContext, i: number, cx: Context) {
  const p = PANELS.find((x) => v.ctxOf(x) === ctx) ?? v.panel;

  v.panel = p;
  v.focus = "side";
  v.staging = null;
  v.sel[ctx] = i;
  loadMain(v);
  contextMenu(v, ctx);
  cx.notify();
}

export function splitter(view: GitView, t: Theme, id: string, axis: "x" | "y", key: string, from: number, set: (v: number) => void, opts: ResizeOptions) {
  const on = view.resizing?.key === key;
  const el = div().id(id).relative().flex_none();
  const sized = axis === "x" ? el.w(6).h_full().cursor_col_resize() : el.h(6).w_full().cursor_row_resize();

  const live = sized
    .hover((s) => s.bg(`${t.ansi0}88`))
    .on_mouse_down("left", (e, cx) => {
      cx.stop_propagation();
      resize(view, e, key, from, set, { axis, ...opts });
      cx.notify();
    });

  const line = div().absolute();

  return on ? live.child((axis === "x" ? line.top(0).bottom(0).left(2).w(2) : line.left(0).right(0).top(2).h(2)).bg(t.accent)) : live;
}

export function resize(view: GitView, e: MouseButtonEvent, key: string, from: number, set: (v: number) => void, options: ResizeOptions = {}) {
  const { min = 160, max = 4000, sign = 1, axis = "x" } = options;

  view.resizing = { key, axis, at: axis === "x" ? e.position.x : e.position.y, from, set, min, max: Math.max(min, max), sign };
}
