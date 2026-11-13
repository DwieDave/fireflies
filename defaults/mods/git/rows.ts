// The rows of the git window's side lists, drawn: a row per context (Status,
// Files, Review, Worktrees, Branches, Remotes, Tags, Reflog, Stash), the
// Commits list's narrow and wide (half / full mode) rows, their colors.

import { div } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { Graph } from "./graph.ts";
import { widthOf } from "./graph.ts";
import type { DiffFile } from "./patch.ts";
import type { Commit } from "./parse.ts";
import { dirLetters, letters, age, initials } from "./parse.ts";
import type { ListContext } from "./keys.ts";
import { dither, graphCell, laneColors, letterColor } from "./draw.ts";
import type { DrawRow, TxtOptions } from "./state.ts";
import { WIDE_ROW, WIDE_LANE, LANE, ROW } from "./state.ts";
import { isCheckout, isReviewFile, hashOf, isBranch, isRemoteBranch, isTag, isTreeRow, isStash, isRemote, isReflog, isCommit } from "./items.ts";
import type { default as GitView } from "./main.ts";

export const T7 = (s: string, c: Color) => div().w(56).flex_none().text_color(c).child(s);

/** A review file's status letter and color. */
export function reviewLetter(t: Theme, status: DiffFile["status"]): readonly [string, Color] {
  switch (status) {
    case "added": return ["A", t.ansi2];
    case "modified": return ["M", t.ansi3];
    case "deleted": return ["D", t.ansi1];
    case "renamed": return ["R", t.ansi4];
    case "untracked": return ["U", t.ansi5];
  }
}

export function drawRow(v: GitView, t: Theme, ctx: ListContext, wide: boolean): DrawRow {
  const T = (s: string, c: Color, o?: TxtOptions) => txt(v, s, c, o);
  const none = () => div();

  switch (ctx) {
    case "status": return () => {
      const s = v.data.status;

      return rowLine(v, [
        s?.upstream ? h_flex().gap(2).child(T(`↑${s.ahead}`, t.ansi4)).child(T(`↓${s.behind}`, t.ansi5)) : null,
        T(v.git?.name ?? "", t.foreground), T("→", t.dim), T(s?.head ?? "(detached)", t.ansi6),
        v.data.state ? T(v.data.state.toUpperCase(), t.ansi3) : null,
      ]);
    };

    case "files": case "commitFiles": return fileRow(v, t, ctx);

    case "review": return (f, i, sel) => {
      if (!isReviewFile(f)) return div();

      const done = v.review.marks().has(f.key);
      const [letter, c] = reviewLetter(t, f.status);
      const slash = f.path.lastIndexOf("/");
      const box = div().id(`rv-box-${i}`).relative().size(10).flex_none().border(1).border_color(done ? t.ansi2 : t.ansi8);

      return rowLine(v, [
        (done ? box.child(dither(t.ansi2, 1)) : box)
          .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); v.review.toggle(f); cx.notify(); }),
        T(letter, c, { w: 8 }),
        h_flex().flex_1().min_w(0).gap(6).child(div().flex_none().truncate().text_color(done ? t.dim : sel ? t.foreground : t.muted).child(f.path.slice(slash + 1)))
          .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(slash > 0 ? f.path.slice(0, slash) : "")),
        T(f.binary ? "bin" : `${f.add + f.del}`, t.dim),
      ]);
    };

    case "worktrees": return worktreeRow(v, t);

    case "branches": return (b, _i, sel) => (isBranch(b) ? rowLine(v, [
      T(age(b.date), t.dim, { w: 26 }),
      T(b.head ? `* ${b.name}` : b.name, b.head ? t.ansi6 : sel ? t.foreground : t.muted),
      b.ahead ? T(`↑${b.ahead}`, t.ansi4) : null, b.behind ? T(`↓${b.behind}`, t.ansi5) : null,
      b.gone ? T("(upstream gone)", t.dim) : b.upstream && !b.ahead && !b.behind ? T("✓", t.ansi2) : null,
      wide ? T(b.subject, t.dim, { grow: true }) : null,
    ]) : none());
    case "remotes": return (r, _i, sel) => (isRemote(r) ? rowLine(v, [T(r.name, sel ? t.foreground : t.muted), T(r.url, t.dim, { grow: true })]) : none());
    case "remoteBranches": return (r, _i, sel) => (isRemoteBranch(r) ? rowLine(v, [T(age(r.date), t.dim, { w: 26 }), T(r.name, sel ? t.foreground : t.muted), wide ? T(r.subject, t.dim, { grow: true }) : null]) : none());
    case "tags": return (g, _i, sel) => (isTag(g) ? rowLine(v, [T("◆", t.ansi3), T(g.name, sel ? t.foreground : t.muted), T(g.subject, t.dim, { grow: true })]) : none());
    case "reflog": return (r, _i, sel) => (isReflog(r) ? rowLine(v, [T(r.short, t.ansi5, { w: 56 }), T(age(r.date), t.dim, { w: 26 }), T(r.subject, sel ? t.foreground : t.muted, { grow: true })]) : none());
    case "stash": return (s, _i, sel) => (isStash(s) ? rowLine(v, [T(String(s.index), t.dim, { w: 14 }), T(s.subject, sel ? t.foreground : t.muted, { grow: true })]) : none());
    case "commits": case "subCommits": return wide ? wideCommit(v, t, ctx) : commitRow(v, t, ctx);
  }
}

export function rowLine(v: GitView, kids: readonly (Element | null)[], pad = 8) {
  return h_flex().px(pad).gap(7).items_center().text_size(11).overflow_hidden().children(kids.flatMap((k) => (k ? [k.relative()] : [])));
}

export function txt(v: GitView, s: string, color: Color, options: TxtOptions = {}) {
  const { w = null, grow = false } = options;

  if (grow) return div().flex_1().min_w(0).truncate().text_color(color).child(s);

  const el = div().flex_none().text_color(color).child(s);

  return w ? el.w(w) : el;
}

/** The graph column's width in lanes for the rows in view (list() sets
 *  the top before it draws them). */
export function shownWidth(v: GitView, ctx: ListContext, g: Graph) {
  const top = v.top[ctx] ?? 0;

  return widthOf(g.rows, top, top + Math.max(1, v.vis[ctx] ?? 12) + 1);
}

export function graphFor(v: GitView, ctx: ListContext): Graph | null {
  if (v.noGraph || v.filters[ctx]) return null;

  const s = v.sub();

  return ctx === "subCommits" ? (s?.kind === "subCommits" ? s.graph : null) : v.graph;
}

export function hashColor(v: GitView, t: Theme, c: Commit) {
  if (v.data.unpushed.has(c.hash)) return t.ansi1;

  if (v.data.notMain.size && !v.data.notMain.has(c.hash)) return t.ansi2;

  return t.ansi3;
}

export function authorColor(v: GitView, t: Theme, name: string) {
  const cs = [t.ansi5, t.ansi6, t.ansi4, t.ansi3, t.ansi2, t.ansi13, t.ansi10, t.ansi12];
  let h = 0;

  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;

  return cs[h % cs.length] ?? t.ansi5;
}

export function refChips(v: GitView, t: Theme, c: Commit) {
  return c.refs.flatMap((r) => {
    if (r.kind === "detached") return [];

    const color = r.kind === "tag" ? t.ansi3 : r.kind === "ref" ? t.ansi5 : t.ansi6;

    return [div().flex_none().text_color(color).child(r.kind === "tag" ? `◆ ${r.name}` : r.kind === "head" ? `${r.name} ✱` : r.name)];
  });
}

export function commitRow(v: GitView, t: Theme, ctx: ListContext): DrawRow {
  const g = graphFor(v, ctx);

  return (c, i, sel) => {
    if (!isCommit(c)) return div();

    const row = g?.rows[i];
    const copied = v.copied.some((x) => x.hash === c.hash);

    return rowLine(v, [
      T7(c.short, hashColor(v, t, c)),
      div().w(18).flex_none().text_color(authorColor(v, t, c.author)).child(initials(c.author)),
      g && row ? graphCell(t, row, shownWidth(v, ctx, g), { lane: LANE, h: ROW, head: v.isHead(c) }) : null,
      copied ? div().flex_none().px(3).bg(`${t.ansi5}44`).text_color(t.ansi5).child("copied") : null,
      ...refChips(v, t, c),
      div().flex_1().min_w(0).truncate().text_color(sel ? t.foreground : t.muted).child(c.subject),
    ], 6);
  };
}

/** Commits in half / full mode: B's constellation rows. */
export function wideCommit(v: GitView, t: Theme, ctx: ListContext): DrawRow {
  const g = graphFor(v, ctx);
  const colors = laneColors(t);
  const list = v.items(ctx);
  const firstOnMain = v.data.notMain.size ? list.findIndex((c) => !v.data.notMain.has(hashOf(c) ?? "")) : -1;

  return (c, i, sel) => {
    if (!isCommit(c)) return div();

    const row = g?.rows[i];
    const lane = row ? colors[row.color % colors.length] ?? t.accent : t.accent;

    const flags = c.refs.flatMap((r) => {
      if (r.kind === "detached") return [];

      const color = r.kind === "tag" ? t.ansi3 : lane;

      return [r.kind === "ref"
        ? div().flex_none().h(15).px(5).flex().items_center().border(1).border_color(t.ansi5).text_size(10).text_color(t.ansi5).child(r.name)
        : div().flex_none().h(15).px(5).flex().items_center().bg(color).text_size(10).text_color(t.background).child(r.kind === "tag" ? `◆ ${r.name}` : r.name)];
    });

    const copied = v.copied.some((x) => x.hash === c.hash);
    const ahead = v.data.unpushed.has(c.hash);
    const head = h_flex().gap(7).items_center().text_size(11).children(flags);
    const marked = copied ? head.child(div().flex_none().px(3).bg(`${t.ansi5}44`).text_color(t.ansi5).child("copied")) : head;

    const line = h_flex().pl(4).pr(8).gap(8).items_center().overflow_hidden()
      .child(g && row ? graphCell(t, row, shownWidth(v, ctx, g), { lane: WIDE_LANE, h: WIDE_ROW, head: v.isHead(c), big: true }).relative() : div())
      .child(v_flex().relative().flex_1().min_w(0).gap(2).justify_center()
        .child(marked.child(div().flex_1().min_w(0).truncate().text_color(sel || v.data.notMain.has(c.hash) ? t.foreground : t.muted).child(c.subject)))
        .child(h_flex().gap(8).text_size(10).text_color(t.dim)
          .child(div().flex_none().text_color(ahead ? t.ansi1 : hashColor(v, t, c)).child(`${c.short}${ahead ? " ↑" : ""}`))
          .child(div().flex_none().text_color(authorColor(v, t, c.author)).child(c.author))
          .child(div().flex_none().child(age(c.date)))));

    return i === firstOnMain && firstOnMain > 0
      ? line.child(h_flex().absolute().left(g ? shownWidth(v, ctx, g) * WIDE_LANE + 8 : 8).right(8).top(0).h(1).child(dither(t.ansi8, 1)))
        .child(div().absolute().right(10).top(-6).px(4).bg(t.background).text_size(10).text_color(t.ansi4).child(`↑ ${firstOnMain} not on ${v.data.main ?? ""}`))
      : line;
  };
}

/** A Files or commit files row: a folder (its files' letters) or a file. */
function fileRow(v: GitView, t: Theme, ctx: ListContext): DrawRow {
  const T = (s: string, c: Color, o?: TxtOptions) => txt(v, s, c, o);

  return (r, _i, sel) => {
    if (!isTreeRow(r)) return div();

    if (r.kind === "dir") {
      const files = r.files;
      const l = ctx === "files" ? dirLetters(files.flatMap((f) => ("staged" in f ? [f] : []))) : null;

      return rowLine(v, [div().w(r.depth * 12).flex_none(), T(r.open ? "▾" : "▸", t.dim),
        l ? h_flex().child(T(l.x, letterColor(t, l.x, true))).child(T(l.y, letterColor(t, l.y, false))) : null,
        T(r.name, t.muted, { grow: true }), T(String(r.files.length), t.dim)]);
    }

    const f = r.file;

    if ("status" in f) {
      const c = f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : f.status === "M" ? t.ansi3 : f.status === "R" ? t.ansi4 : t.muted;

      return rowLine(v, [div().w(r.depth * 12 + (v.tree ? 12 : 0)).flex_none(), T(f.status, c, { w: 10 }), T(f.from ? `${f.from} → ${r.name}` : r.name, sel ? t.foreground : t.muted, { grow: true })]);
    }

    const [x = " ", y = " "] = letters(f);
    const color = f.conflict ? t.ansi3 : f.untracked ? t.ansi1 : f.staged && !f.unstaged ? t.ansi2 : sel ? t.foreground : t.muted;

    return rowLine(v, [div().w(r.depth * 12 + (v.tree ? 12 : 0)).flex_none(),
      h_flex().w(16).flex_none().child(T(x, letterColor(t, x, true))).child(T(y, letterColor(t, y, false))),
      T(f.from ? `${f.from} → ${r.name}` : r.name, color, { grow: true })]);
  };
}

/** A Worktrees row. */
function worktreeRow(v: GitView, t: Theme): DrawRow {
  const T = (s: string, c: Color, o?: TxtOptions) => txt(v, s, c, o);
    // * this window's checkout, ◆ picked for d; then the branch, what's
    // in it (agents, open in a space), how old its last commit is, where.
    const occ = v.occupancy();

    return (w, _i, sel) => {
      if (!isCheckout(w)) return div();

      const o = occ.get(w.path) ?? { spaces: [], agents: [] };
      const picked = v.wtPicked.has(w.path);
      const mark = picked ? ["◆", t.ansi5] as const : w.path === v.git?.root ? ["*", t.ansi6] as const : [" ", t.dim] as const;
      const busy = o.agents.length ? [`${o.agents.length} agent${o.agents.length === 1 ? "" : "s"}`, o.agents.some((a) => a.status === "blocked") ? t.ansi1 : t.working] as const : null;

      return rowLine(v, [
        T(mark[0], mark[1], { w: 8 }),
        T(w.branch ?? `(detached) ${(w.head ?? "").slice(0, 7)}`, w.branch ? (sel ? t.foreground : t.ansi6) : t.ansi3),
        w.main ? T("main", t.dim) : null,
        w.prunable ? T("folder gone", t.ansi1) : w.locked ? T("locked", t.ansi3) : null,
        T(v.tilde(w.path), t.dim, { grow: true }),
        busy ? T(busy[0], busy[1]) : o.spaces.length ? T("open", t.accent) : null,
        w.at ? T(age(w.at), t.dim) : null,
      ]);
    };
}
