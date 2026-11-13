// Reading the repo into the git window: opening it, everything at once, a
// drill-in's list, again on changes (the folder watched) and on a timer.

import { watchFolder } from "herdr";
import { Git, LOG_LIMIT } from "./git.ts";
import { layoutGraph } from "./graph.ts";
import * as WT from "./worktrees.ts";
import type { Sub } from "./state.ts";
import { loadStaging } from "./staging.ts";
import { loadMain } from "./content.ts";
import { worktreeIntent } from "./checkouts.ts";
import type { default as GitView } from "./main.ts";

export function start(v: GitView) {
  v.reads.push(async () => {
    if (!v.folder) {
      v.state = "norepo";

      return;
    }

    v.git = await Git.open(v.folder, v.on, (e) => v.logged(e));

    if (!v.git) {
      v.state = "norepo";

      return;
    }

    v.state = "ready";
    await loadAll(v);
    watch(v);

    if (v.on && !v.userHome) v.userHome = await WT.userHomeOn(v.on).catch(() => null);

    worktreeIntent(v);
  });
}

export function watch(v: GitView) {
  const g = v.git;

  if (v.on || v.watching || !g) return;

  v.watching = true;
  v.reads.push(async (cx) => {
    cx.spawn(async () => {
      try {
        for (;;) {
          const paths = await watchFolder(g.root);

          if (v.closed) return;

          // Our own index writes show up too; a refresh is cheap and idempotent.
          if (paths.length) reload(v);
        }
      } catch { v.watching = false; }
    });
  });
}

export function reload(v: GitView, loud = false) {
  if (v.state !== "ready" || v.reloadQueued) return;

  v.reloadQueued = true;
  v.reads.push(async () => {
    v.reloadQueued = false;
    await loadAll(v);

    if (loud) v.note("Refreshed");
  });
}

export async function reloadNow(v: GitView) { await loadAll(v); }

export function reloadReview(v: GitView) {
  v.reads.push(async () => {
    await v.review.load();
    pickShownPath(v);
    v.clampAll();
    loadMain(v);
  });
}

/** A review pane opened on a file starts on it. */
export function pickShownPath(v: GitView) {
  const path = v.show?.kind === "review" ? v.show.path : undefined;

  if (path === undefined || v.pickedPath) return;

  const i = v.review.shown().findIndex((f) => f.path === path);

  if (i >= 0) {
    v.sel.review = i;
    v.follow.review = true;
    v.pickedPath = true;
  }
}

export async function loadAll(v: GitView) {
  const g = v.git;

  if (!g) return;

  const [status, branches, remotes, remoteBranches, tags, stash, worktrees, state] = await Promise.all([
    g.status(), g.branches(), g.remotes(), g.remoteBranches(), g.tags(), g.stash(), WT.listWorktrees(g), g.state(),
  ]);

  if (v.data.main === null) v.data.main = (await g.mainBranch()) ?? undefined;

  const main = v.data.main || null;
  const limit = v.commitLimit;
  const commits = await g.log("HEAD", { all: v.allBranches, limit });

  const [unpushed, notMain] = await Promise.all([
    status.upstream ? g.only("HEAD", "@{u}", limit) : Promise.resolve(new Set(commits.map((c) => c.hash))),
    main && status.head !== main ? g.only("HEAD", main, limit) : Promise.resolve(new Set<string>()),
  ]);

  v.data = { ...v.data, status, branches, remotes, remoteBranches, tags, stash, worktrees, state, commits, unpushed, notMain };
  v.graph = layoutGraph(commits);

  if (v.ctxOf(v.panel) === "reflog" || v.data.reflog.length) v.data.reflog = await g.reflog();

  for (const s of Object.values(v.subs).flat()) await loadSub(v, s);

  if (v.tabOf.files === "review" || v.review.files.length) {
    await v.review.load();
    pickShownPath(v);
  }

  if (v.staging) await loadStaging(v);

  v.clampAll();
  loadMain(v);
}

export async function loadSub(v: GitView, s: Sub) {
  const g = v.git;

  if (!g) return;

  if (s.kind === "subCommits") {
    s.items = await g.log(s.ref, { limit: s.limit ?? LOG_LIMIT });
    s.graph = layoutGraph(s.items);
  } else if (s.kind === "remoteBranches") s.items = v.data.remoteBranches.filter((r) => r.remote === s.remote);
  else s.items = await g.commitFiles(s.hash);
}
