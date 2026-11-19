// A run's re-run and cancel on the Actions tab (actions.ts): asked in the
// bar, sent through gh once y says so (with that key's cx), then the run is
// read again with a backoff (model.ts soon) until GitHub shows the change: a
// re-run queued or running, a cancel finished. GitHub shows either a few
// seconds after it took it; past EXPECT_FOR the tab's own pace is back.

import { ghRun } from "./gh.ts";
import type { Run } from "./model.ts";
import { soon } from "./model.ts";
import type { default as Actions } from "./actions.ts";

/** A run's re-run or cancel. */
export type RunAction = "failed" | "all" | "cancel" | "job";

/** A re-run or cancel GitHub took: the run, whether it's to show moving (a re-run) or finished
 *  (a cancel), when it was sent, and the reads since that didn't show it. */
export interface Expected {
  readonly id: number;
  readonly live: boolean;
  readonly since: number;
  readonly reads: number;
}

/** How long a re-run or cancel is read again sooner than the pace, at most. */
const EXPECT_FOR = 60000;

/** The wait before the next read: the tab's pace, or sooner while a change is expected. */
export function paced(e: Expected | null, pace: number): number {
  return e && Date.now() - e.since < EXPECT_FOR ? Math.min(pace, soon(e.reads)) : pace;
}

/** After a read of the list: null once the expected change shows (or the bound passed), else one more read counted. */
export function settled(e: Expected | null, list: readonly Run[]): Expected | null {
  if (!e) return null;

  const r = list.find((x) => x.id === e.id);
  const shown = r && (r.status !== "completed") === e.live;

  return shown || Date.now() - e.since >= EXPECT_FOR ? null : { ...e, reads: e.reads + 1 };
}

/** R / A / e / X: asks, then re-runs or cancels the selected run (or its job), and expects the change. */
export function runAction(tab: Actions, what: RunAction): void {
  const app = tab.app, r = tab.run(), repo = app.repo;

  if (!r || !repo) return;

  const t = `#${r.run_number ?? ""} ${r.name ?? ""}`;

  const expect = (live: boolean) => () => {
    if (live) tab.jobs.delete(r.id);

    tab.expected = { id: r.id, live, since: Date.now(), reads: 0 };
  };

  if (what === "failed") app.ask(`Re-run the failed jobs of ${t}?`, (cx) => app.act(ghRun(repo, ["run", "rerun", String(r.id), "--failed"]), `Re-running failed jobs of ${t}.`, cx, expect(true)));
  else if (what === "all") app.ask(`Re-run every job of ${t}?`, (cx) => app.act(ghRun(repo, ["run", "rerun", String(r.id)]), `Re-running ${t}.`, cx, expect(true)));
  else if (what === "cancel") app.ask(`Cancel ${t}?`, (cx) => app.act(ghRun(repo, ["run", "cancel", String(r.id)]), `Cancelling ${t}.`, cx, expect(false)));
  else {
    const j = tab.job();

    if (j) app.ask(`Re-run the job "${j.name ?? ""}"?`, (cx) => app.act(ghRun(repo, ["run", "rerun", "--job", String(j.id)]), `Re-running ${j.name ?? ""}.`, cx, expect(true)));
  }
}
