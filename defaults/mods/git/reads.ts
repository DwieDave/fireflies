// Reading the repo into the git window: opening it, everything at once, a
// drill-in's list, again on changes (the folder watched) and on a timer.
// Each is a run on the copy's reads lane (main.ts `read`), so it ends with
// the window and never overlaps another read.

import { Array as Arr, Effect, Option, Record as Rec } from "effect";
import { watchFolder } from "herdr";
import { fileError } from "@fireflies/kit";
import { Git, LOG_LIMIT } from "./git.ts";
import type { GitError } from "./git.ts";
import { layoutGraph } from "./graph.ts";
import * as WT from "./worktrees.ts";
import type { Sub } from "./state.ts";
import { loadStaging } from "./staging.ts";
import { loadMain } from "./content.ts";
import { worktreeIntent } from "./checkouts.ts";
import type { GitServices } from "./fx.ts";
import type { default as GitView } from "./main.ts";

/** Opens the repo holding the window's folder: everything read, the folder watched, where worktrees go. */
export function start(v: GitView): void {
  v.read(Effect.gen(function* () {
    const folder = v.folder;

    if (folder === null) {
      v.state = "norepo";

      return;
    }

    const opened = yield* Git.open(folder, v.on, (e) => v.logged(e)).pipe(
      // git that couldn't run at all: "not a repo", with why beside it.
      Effect.catchTag("ExecError", (e) => Effect.sync(() => { v.openError = e.message; }).pipe(Effect.as(Option.none<Git>()))),
    );

    if (Option.isNone(opened)) {
      v.state = "norepo";

      return;
    }

    v.git = opened.value;
    v.state = "ready";
    yield* loadAll(v);
    watch(v);

    // Where new worktrees go only words a dialog's note: a machine or a settings.json that can't say leaves the default there.
    if (v.on !== null && v.userHome === null) v.userHome = yield* WT.userHomeOn(v.on).pipe(Effect.orElseSucceed(() => null));

    if (v.userHome !== null) v.wtRoot = yield* WT.rootFor(v.userHome).pipe(Effect.orElseSucceed(() => null));

    worktreeIntent(v);
  }));
}

/** Reads again whenever the repo's folder changes (a local repo; a remote one has the timer only). */
export function watch(v: GitView): void {
  const g = v.git;

  if (v.on !== null || v.watching || g === null) return;

  const change = Effect.tryPromise({ try: () => watchFolder(g.root), catch: fileError(g.root) });

  v.watching = true;
  v.run$(Effect.forever(Effect.flatMap(change, (paths) => Effect.sync(() => {
    // Our own index writes show up too; a refresh is cheap and idempotent.
    if (Arr.isReadonlyArrayNonEmpty(paths)) reload(v);
  }))).pipe(
    // A folder that can't be watched (gone, not allowed): the timer still reads it.
    Effect.catchTag("FileError", () => Effect.sync(() => { v.watching = false; })),
  ), { redraw: false });
}

/** Everything again (`loud`: says so on the options bar); one waiting reload is enough. */
export function reload(v: GitView, loud = false): void {
  if (v.state !== "ready" || v.reloadQueued) return;

  v.reloadQueued = true;
  v.read(Effect.gen(function* () {
    v.reloadQueued = false;
    yield* loadAll(v);

    if (loud) v.note("Refreshed");
  }));
}

/** The review tab's changes again. */
export function reloadReview(v: GitView): void {
  v.read(Effect.gen(function* () {
    yield* v.review.load();
    pickShownPath(v);
    v.clampAll();
    loadMain(v);
  }));
}

/** A review pane opened on a file starts on it. */
export function pickShownPath(v: GitView): void {
  const path = v.show?.kind === "review" ? v.show.path : undefined;

  if (path === undefined || v.pickedPath) return;

  const i = Arr.findFirstIndex(v.review.shown(), (f) => f.path === path);

  if (Option.isSome(i)) {
    v.sel.review = i.value;
    v.follow.review = true;
    v.pickedPath = true;
  }
}

/** Every list of the repo, the open drill-ins, the review and the staging view. */
export function loadAll(v: GitView): Effect.Effect<void, GitError, GitServices> {
  return Effect.gen(function* () {
    const g = v.git;

    if (g === null) return;

    const [status, branches, remotes, remoteBranches, tags, stash, worktrees, state] = yield* Effect.all([
      g.status(), g.branches(), g.remotes(), g.remoteBranches(), g.tags(), g.stash(), WT.listWorktrees(g), g.state(),
    ], { concurrency: "unbounded" });

    if (v.data.main === null) v.data.main = (yield* g.mainBranch()) ?? undefined;

    const main = v.data.main ?? null;
    const limit = v.commitLimit;
    const commits = yield* g.log("HEAD", { all: v.allBranches, limit });

    const [unpushed, notMain] = yield* Effect.all([
      status.upstream === null ? Effect.succeed<ReadonlySet<string>>(new Set(Arr.map(commits, (c) => c.hash))) : g.only("HEAD", "@{u}", limit),
      main !== null && status.head !== main ? g.only("HEAD", main, limit) : Effect.succeed<ReadonlySet<string>>(new Set<string>()),
    ], { concurrency: "unbounded" });

    v.data = { ...v.data, status, branches, remotes, remoteBranches, tags, stash, worktrees, state, commits, unpushed, notMain };
    v.graph = layoutGraph(commits);

    if (v.ctxOf(v.panel) === "reflog" || Arr.isReadonlyArrayNonEmpty(v.data.reflog)) v.data.reflog = yield* g.reflog();

    yield* Effect.forEach(Arr.flatten(Rec.values(v.subs)), (s) => loadSub(v, s), { concurrency: 1, discard: true });

    if (v.tabOf.files === "review" || Arr.isReadonlyArrayNonEmpty(v.review.files)) {
      yield* v.review.load();
      pickShownPath(v);
    }

    if (v.staging !== null) yield* loadStaging(v);

    v.clampAll();
    loadMain(v);
  });
}

/** A drill-in's list: a ref's commits, a remote's branches, a commit's files. */
export function loadSub(v: GitView, s: Sub): Effect.Effect<void, GitError, GitServices> {
  return Effect.gen(function* () {
    const g = v.git;

    if (g === null) return;

    if (s.kind === "subCommits") {
      s.items = yield* g.log(s.ref, { limit: s.limit ?? LOG_LIMIT });
      s.graph = layoutGraph(s.items);
    } else if (s.kind === "remoteBranches") s.items = Arr.filter(v.data.remoteBranches, (r) => r.remote === s.remote);
    else s.items = yield* g.commitFiles(s.hash);
  });
}
