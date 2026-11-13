// Moving around the git window: panels and their tabs, the cursor, ranges,
// folded folders, drill-ins, the filter, the screen mode, the diff's context,
// and esc (the innermost thing gives way first).

import { InputState } from "gpui-base";
import { fileTree } from "./parse.ts";
import type { Panel, Sub, Tab, NewSub } from "./state.ts";
import { PANELS, isTabbed, TABS, MODES } from "./state.ts";
import { statusFileOf } from "./items.ts";
import { closePane, quit } from "./panes.ts";
import { loadStaging, startStaging, stepLine } from "./staging.ts";
import { loadMain } from "./content.ts";
import type { default as GitView } from "./main.ts";
import { loadSub } from "./reads.ts";

export function setPanel(v: GitView, p: Panel) {
  if (v.show && p !== "files") return;

  if (v.panel === p && v.focus === "side") return;

  v.panel = p;
  v.focus = "side";
  v.staging = null;
  v.range = null;
  ensureLoaded(v);
  loadMain(v);
}

export function ensureLoaded(v: GitView) {
  const ctx = v.ctxOf(v.panel);
  const g = v.git;

  if (ctx === "reflog" && !v.data.reflog.length && g) {
    v.reads.push(async () => {
      v.data.reflog = await g.reflog();
      loadMain(v);
    });
  }

  if (ctx === "review" && v.review.state === "idle") v.reloadReview();
}

export function stepPanel(v: GitView, d: number) {
  if (v.focus === "main") {
    giveWay(v);

    return;
  }

  const i = PANELS.indexOf(v.panel);

  v.setPanel(PANELS[(i + d + PANELS.length) % PANELS.length] ?? "status");
}

export function setTab(v: GitView, id: Tab) {
  if (id === "files" || id === "review" || id === "worktrees") v.tabOf.files = id;
  else if (id === "branches" || id === "remotes" || id === "tags") v.tabOf.branches = id;
  else v.tabOf.commits = id;

  const p = id === "files" || id === "review" || id === "worktrees" ? "files" : id === "commits" || id === "reflog" ? "commits" : "branches";

  v.subs[p] = [];
  v.range = null;
  ensureLoaded(v);
  loadMain(v);
}

export function stepTab(v: GitView, d: number) {
  const p = v.panel;

  if (!isTabbed(p) || v.sub()) return;

  const tabs: readonly (readonly [Tab, string])[] = TABS[p];
  const i = tabs.findIndex(([t]) => t === v.tabOf[p]);
  const next = tabs[(i + d + tabs.length) % tabs.length];

  if (next) v.setTab(next[0]);
}

export function moveBy(v: GitView, d: number) {
  const ctx = v.ctxOf(v.panel), n = v.items(ctx).length;

  if (!n) return;

  v.sel[ctx] = Math.max(0, Math.min(n - 1, (v.sel[ctx] ?? 0) + d));
  v.follow[ctx] = true;
  v.mainTop = 0;
  loadMain(v);
}

export function moveTo(v: GitView, i: number) {
  const ctx = v.ctxOf(v.panel), n = v.items(ctx).length;

  v.sel[ctx] = Math.max(0, Math.min(n - 1, i === Infinity ? n - 1 : i));
  v.follow[ctx] = true;
  v.mainTop = 0;
  loadMain(v);
}

export function pageRows(v: GitView) { return Math.max(1, (v.vis[v.ctxOf(v.panel)] ?? 10) - 1); }

export function toggleRange(v: GitView) {
  const ctx = v.ctxOf(v.panel);

  if (v.focus === "main" && v.staging) {
    v.staging.anchor = v.staging.anchor === null ? v.staging.cur : null;
    v.staging.hunkMode = false;

    return;
  }

  v.range = v.range ? null : { ctx, anchor: v.sel[ctx] ?? 0 };
}

export function toggleDir(v: GitView, path: string) {
  if (v.collapsed.has(path)) v.collapsed.delete(path);
  else v.collapsed.add(path);
}

export function collapseAll(v: GitView, fold: boolean) {
  if (!fold) {
    v.collapsed.clear();

    return;
  }

  const s = v.sub();
  const files: readonly { readonly path: string }[] = v.ctxOf(v.panel) === "commitFiles" ? (s?.kind === "commitFiles" ? s.items : []) : v.data.status?.files ?? [];

  for (const r of fileTree(files)) if (r.kind === "dir") v.collapsed.add(r.path);
}

export function enterSub(v: GitView, n: NewSub) {
  const p = v.panel;
  const s: Sub = n.kind === "subCommits" ? { ...n, items: [], graph: null } : { ...n, items: [] };

  v.subs[p] = [...v.subs[p], s];
  v.sel[s.kind] = 0;
  v.top[s.kind] = 0;
  v.reads.push(async () => {
    await loadSub(v, s);
    loadMain(v);
  });
}

export function openFilter(v: GitView) {
  const ctx = v.ctxOf(v.panel);
  const input = InputState.new({ placeholder: "filter", value: v.filters[ctx] ?? "" });

  input.on("change", (_e, cx) => {
    v.filters[ctx] = input.value();
    v.sel[ctx] = 0;
    v.top[ctx] = 0;
    cx.notify();
  });
  input.on("submit", (_e, cx) => {
    v.filtering = null;
    v.handle?.focus();
    loadMain(v);
    cx.notify();
  });
  v.filtering = { ctx, input };
  input.focus();
  v.later(() => { if (v.filtering?.input === input) input.focus(); });
}

/** esc: the innermost thing gives way first. */
export function giveWay(v: GitView) {
  if (v.filtering) {
    const c = v.filtering.ctx;

    v.filtering = null;
    v.filters[c] = "";
    v.handle?.focus();

    return;
  }

  if (v.show && v.show.kind !== "review") {
    closePane(v);

    return;
  }

  if (v.focus === "main") {
    v.focus = "side";
    v.staging = null;
    loadMain(v);

    return;
  }

  if (v.range) {
    v.range = null;

    return;
  }

  const ctx = v.ctxOf(v.panel);

  if (ctx === "worktrees" && v.wtPicked.size) {
    v.wtPicked = new Set();

    return;
  }

  if (v.filters[ctx]) {
    v.filters[ctx] = "";

    return;
  }

  if (v.sub()) {
    v.subs[v.panel] = v.subs[v.panel].slice(0, -1);
    loadMain(v);

    return;
  }

  if (v.diffBase) {
    v.diffBase = null;
    loadMain(v);

    return;
  }

  if (v.copied.length && (ctx === "commits" || ctx === "reflog" || ctx === "subCommits")) {
    v.copied = [];
    v.note("Copied commits forgotten");

    return;
  }

  if (v.mode !== "normal") {
    v.mode = "normal";

    return;
  }

  quit(v, true);
}

export function focusMain(v: GitView) {
  const ctx = v.ctxOf(v.panel);

  if (ctx === "files") {
    const f = statusFileOf(v.item());

    if (f) return startStaging(v, f);
  }

  if (!v.main?.rows.length) return;

  v.focus = "main";
}

export function cycleScreen(v: GitView, d: number) {
  v.mode = MODES[(MODES.indexOf(v.mode) + d + MODES.length) % MODES.length] ?? "normal";
  v.focus = "side";
  v.saveState();
}

export function setContext(v: GitView, d: number) {
  v.context = Math.max(0, Math.min(30, v.context + d));
  v.note(`Diff context: ${v.context} lines`);

  if (v.staging) v.reads.push(async () => { await loadStaging(v); });

  loadMain(v);
}

export function scrollMain(v: GitView, d: number, lines: number | null = null) {
  const n = (v.staging?.rows ?? v.main?.rows ?? []).length;
  const step = lines ?? Math.max(4, Math.floor((v.mainVis ?? 20) / 2));

  if (v.staging && lines === null) {
    stepLine(v, d * step);

    return;
  }

  v.mainTop = Math.max(0, Math.min(Math.max(0, n - 4), v.mainTop + d * step));
}
