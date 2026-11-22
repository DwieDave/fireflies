// The Actions tab's reads (actions.ts calls them), as effects on the
// window's runtime: the runs (ETag'd) and the selected run's jobs with its
// workflow file (for the graph's `needs:`), both at once; a finished job's
// log. What a read can't do is a typed failure the window shows on its bar
// (main.ts); a read of a repo no longer shown is dropped.

import { Array as Arr, Clock, Effect, Option, Order, String as Str } from "effect";
import { redraw } from "@fireflies/kit";
import type { Repo } from "./gh.ts";
import { api, fileAt, ghRun, slimmed } from "./gh.ts";
import type { Run } from "./model.ts";
import { JobListSchema, JobsSchema, RunListSchema, RunSchema, RunsSchema, needsFromWorkflow, splitLog } from "./model.ts";
import { slimJob, slimRun, LIMITS } from "./cache.ts";
import type { ReadOptions } from "./host.ts";
import { settled } from "./run-actions.ts";
import type { default as Actions, JobLog } from "./actions.ts";

/** A run opened from a PR's check: read on its own while the list doesn't hold it. A run GitHub
 *  no longer has (404) is let go; another failure is the read's. */
const readExtra = (v: Actions, repo: Repo, id: number) => api(repo, `repos/${repo.full}/actions/runs/${id}`, slimmed(RunSchema, slimRun, RunSchema)).pipe(
  Effect.tap((r) => Effect.sync(() => {
    if (r.data !== null) v.extra.set(id, r.data);
  })),
  Effect.asVoid,
  Effect.catchTag("GhStatus", (e) => (e.status === 404 ? Effect.sync(() => { v.extra.delete(id); }) : Effect.fail(e))),
);

/** Reads the runs, then the selected run's jobs (and its workflow, at once). `fresh`: past the ETags. */
export const pollActions = (v: Actions, { fresh = false }: ReadOptions) => Effect.gen(function* () {
  const repo = v.app.repo;

  if (repo === null) return;

  const branch = v.branchKey();
  const q = branch === "" ? "" : `&branch=${encodeURIComponent(branch)}`;
  const kept = v.runsCache.get(branch);
  // The selected run's jobs are read with the list when the cache already knows the run.
  const early = v.run();
  const prior = kept?.etag === null || kept?.etag === undefined ? null : { etag: kept.etag, data: kept.list };

  const [{ data, etag }] = yield* Effect.all([
    api(repo, `repos/${repo.full}/actions/runs?per_page=40${q}`, slimmed(RunListSchema, (d) => Arr.map(d.workflow_runs ?? [], slimRun), RunsSchema), { fresh, prior }),
    early === null ? Effect.void : pollRun(v, fresh, early),
    Effect.forEach(Arr.fromIterable(v.extra.keys()), (id) => readExtra(v, repo, id), { concurrency: 4, discard: true }),
  ], { concurrency: "unbounded" });

  if (v.app.repo !== repo || v.branchKey() !== branch) return;

  const at = yield* Clock.currentTimeMillis;

  v.runsCache.set(branch, { list: data ?? [], etag, at });
  v.useRuns();
  v.expected = settled(v.expected, v.list());

  if (v.sel === null || !Arr.some(v.list(), (r) => r.id === v.sel)) v.sel = v.list()[0]?.id ?? null;

  yield* redraw;

  const now = v.run();

  if (now !== null && now.id !== early?.id) yield* pollRun(v, fresh, now);
  else if (early !== null && now !== null) v.pickJob(true);
});

/** The run's workflow file's jobs and needs (an empty map: GitHub has no such file there). */
const readNeeds = (repo: Repo, r: Run) => Effect.map(fileAt(repo, Str.replace(/@.*$/, "")(r.path ?? ""), r.head_sha ?? ""), (yaml) =>
  Option.match(yaml, { onNone: () => new Map(), onSome: needsFromWorkflow }));

/** Newest first, by when they were read. */
const byRead = Order.flip(Order.mapInput(Order.Number, ([, t]: readonly [number, { readonly at: number }]) => t.at));

/** Keeps the jobs of the runs read last (twice the cache's limit at most). */
function trimJobs(v: Actions): void {
  if (v.jobs.size <= LIMITS.jobs * 2) return;

  const keep = new Set(Arr.map(Arr.take(Arr.sort(Arr.fromIterable(v.jobTags), byRead), LIMITS.jobs), ([id]) => id));

  for (const id of v.jobs.keys()) {
    if (keep.has(id)) continue;

    v.jobs.delete(id);
    v.jobTags.delete(id);
  }
}

/** A run's jobs, and its workflow's needs the first time (a workflow that can't be read now is
 *  asked again next time; the graph lays the jobs out by time meanwhile). */
export const pollRun = (v: Actions, fresh: boolean, r: Run) => Effect.gen(function* () {
  const repo = v.app.repo;

  if (repo === null) return;

  const key = v.needsKey(r);
  const tag = v.jobTags.get(r.id), had = v.jobs.get(r.id);
  const wants = (r.path ?? "") !== "" && !v.needs.has(key);
  const prior = tag?.etag === null || tag?.etag === undefined || had === undefined ? null : { etag: tag.etag, data: had };

  const [{ data, etag }, needs] = yield* Effect.all([
    api(repo, `repos/${repo.full}/actions/runs/${r.id}/jobs?per_page=100&filter=latest`, slimmed(JobListSchema, (d) => Arr.map(d.jobs ?? [], slimJob), JobsSchema), { fresh, prior }),
    wants ? Effect.option(readNeeds(repo, r)) : Effect.succeedNone,
  ], { concurrency: 2 });

  if (v.app.repo !== repo) return;

  const at = yield* Clock.currentTimeMillis;

  v.jobs.set(r.id, data ?? []);
  v.jobTags.set(r.id, { etag, at });
  trimJobs(v);

  if (Option.isSome(needs)) {
    v.needs.set(key, needs.value);
    v.needsAt.set(key, at);
  }

  if (r.id === v.run()?.id) v.pickJob(true);
});

/** A finished job's log by step (kept: a finished log doesn't change), or gh's words why not. */
export const readLog = (v: Actions, repo: Repo, id: number) => Effect.gen(function* () {
  const steps = Option.getOrElse(Option.flatMap(Arr.findFirst(v.jobsOf(v.run()) ?? [], (j) => j.id === id), (j) => Option.fromNullishOr(j.steps)), () => []);

  const log = yield* ghRun(repo, ["run", "view", "--job", String(id), "--log"], 90000).pipe(Effect.match({
    onFailure: (e): JobLog => ({ error: e.message }),
    onSuccess: (out): JobLog => splitLog(out, steps),
  }));

  v.logs.set(id, log);
}).pipe(Effect.ensuring(Effect.sync(() => v.logBusy.delete(id))));