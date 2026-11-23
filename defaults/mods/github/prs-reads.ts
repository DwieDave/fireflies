// The Pull requests tab's reads (prs.ts calls them), as effects on the
// window's runtime: the list (GraphQL) and the shown pull request's view with
// its review comments, at once; then the view of the one the list put first,
// if that's another. What a read can't do is a typed failure the window says
// on its bar; a read of another filter or repo than the one shown is dropped.

import { Array as Arr, Clock, Effect, Option } from "effect";
import { redraw } from "@fireflies/kit";
import type { Repo } from "./gh.ts";
import { api, ghJson, graphql, slimmed } from "./gh.ts";
import type { PrFilter, PrRow } from "./model.ts";
import { PrListSchema, PrViewSchema, ReviewCommentsSchema, SLOW, prListQuery, prRows } from "./model.ts";
import { LIMITS, newest, slimReviewComment } from "./cache.ts";
import type { ReadOptions } from "./host.ts";
import type { default as Prs } from "./prs.ts";

/** What `gh pr view --json` is asked for: what the right panel draws (no state, no mergeable: GitHub computes those slowly). */
const VIEW = "number,title,body,author,isDraft,baseRefName,headRefName,labels,reviewDecision,statusCheckRollup,url,createdAt,updatedAt,comments,reviews,additions,deletions,changedFiles";

/** The pull requests `filter` shows. */
const readList = (repo: Repo, filter: PrFilter) => {
  const { query, vars } = prListQuery(filter, repo.full);

  return Effect.map(graphql(repo, query, PrListSchema, vars), prRows);
};

/** A pull request's view and its review comments (kept for its ETag). The review comments are extra: a read
 *  of them that fails keeps the last ones, and the view still shows. */
export const readDetail = (v: Prs, repo: Repo, p: PrRow, fresh: boolean) => Effect.gen(function* () {
  const d = v.details.get(p.number);
  const prior = d?.reviewTag === null || d?.reviewTag === undefined ? null : { etag: d.reviewTag, data: d.review };
  const kept = { data: d?.review ?? [], etag: d?.reviewTag ?? null, changed: false };

  const [pr, review] = yield* Effect.all([
    ghJson(repo, ["pr", "view", String(p.number), "--json", VIEW], PrViewSchema),
    Effect.orElseSucceed(api(repo, `repos/${repo.full}/pulls/${p.number}/comments?per_page=100`, slimmed(ReviewCommentsSchema, (a) => Arr.map(a, slimReviewComment), ReviewCommentsSchema), { fresh, prior }), () => kept),
  ], { concurrency: 2 });

  if (v.app.repo !== repo) return;

  const at = yield* Clock.currentTimeMillis;

  v.details.set(p.number, { pr, review: review.data ?? [], reviewTag: review.etag, at });

  if (v.details.size > LIMITS.details * 2) {
    const keep = new Set(newest(v.details, LIMITS.details).keys());

    for (const n of v.details.keys()) if (!keep.has(n)) v.details.delete(n);
  }
});

/** The list as read: kept for its filter, the selection kept on it (or on the PR asked for). False when the
 *  filter or repo changed meanwhile (the read is dropped). */
function gotList(v: Prs, repo: Repo, filter: PrFilter, rows: PrRow[], at: number): boolean {
  if (v.filter !== filter || v.app.repo !== repo) return false;

  v.lists.set(filter, { list: rows, at });
  v.list = rows;
  v.listAt = at;

  const want = v.want;
  const wanted = want === null ? Option.none() : Arr.findFirstIndex(rows, (p) => p.number === want);

  if (Option.isSome(wanted)) {
    v.sel = want;
    v.want = null;
    v.focus = "list";
    v.scrollY = 0;
    v.checkSel = 0;
    v.listScroll.scroll_to_item(wanted.value);
  }

  if (v.sel === null || !Arr.some(rows, (p) => p.number === v.sel)) v.sel = rows[0]?.number ?? null;

  v.follow();

  return true;
}

/** Reads GitHub: the list, and the shown PR's view beside it (both at once). all: past the timers; fresh: past the ETags. */
export const pollPrs = (v: Prs, { all = false, fresh = false }: ReadOptions) => Effect.gen(function* () {
  const repo = v.app.repo;

  if (repo === null) return;

  const now = yield* Clock.currentTimeMillis, filter = v.filter;
  // The PR shown now (a cached list's) is read while the list is.
  const first = v.current();
  let dropped = false;

  const list = all || v.list === null || now - v.listAt >= SLOW
    ? Effect.flatMap(readList(repo, filter), (rows) => Effect.gen(function* () {
      const at = yield* Clock.currentTimeMillis;

      dropped = !gotList(v, repo, filter, rows, at);

      if (!dropped) yield* redraw;
    }))
    : Effect.void;

  yield* Effect.all([list, first !== null && v.wantsDetail(first, all, now) ? readDetail(v, repo, first, fresh) : Effect.void], { concurrency: 2, discard: true });

  if (dropped) return;

  const p = v.current();

  if (p !== null && p.number !== first?.number && v.wantsDetail(p, all, now)) yield* readDetail(v, repo, p, fresh);

  v.follow();
});
