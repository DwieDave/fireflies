// The script runner's jobs: what the deck (scripts) asks to be done
// to runs: start, stop, restart, dismiss. The deck closes the moment a
// script is picked, and work started in a closed overlay's tasks is dropped
// with it, so the deck only queues the `hc` calls in shared(JOBS) and the tab
// strip, which lives as long as the window, runs them (runJobs: on its next
// render, which the queueing itself causes, and on its timer).
//
// A job: { at, name, watch?, steps: [{ hc: argv, start? }] }, in order. A
// `start` step is `hc run --json`: its address is followed until it ends
// (scripts.js trackRuns) and, with `watch`, floated over the tab; when it
// fails, a toast says why.

import { hc, run, shared, setShared, notify } from "herdr";

export const JOBS = "scripts.jobs";
const TRACK = "scripts.track";
// A job left from before a restart is stale, not something to do now.
const STALE = 60000;

let working = false;

/** Jobs are waiting. */
export const pendingJobs = () => Array.isArray(shared(JOBS)) && shared(JOBS).length > 0;

/** Takes every waiting job (so another window's strip doesn't run them too)
 *  and runs them in order. */
export async function runJobs() {
  if (working || !pendingJobs()) return;
  working = true;
  const jobs = shared(JOBS);
  setShared(JOBS, []);
  try {
    for (const job of jobs) if (Date.now() - (job?.at ?? 0) < STALE) await runJob(job);
  } finally {
    working = false;
  }
  if (pendingJobs()) await runJobs();
}

async function runJob(job) {
  for (const step of job.steps ?? []) {
    const r = await hc(step.hc).catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
    if (!step.start) continue;
    if (r.code !== 0) {
      notify({ title: `couldn't start ${job.name}`, body: (r.stderr || r.stdout || "hc run failed").trim().split("\n").pop(), level: "error" });
      return;
    }
    let address = null;
    try { address = JSON.parse(r.stdout).address ?? null; } catch { /* started; address unknown */ }
    if (!address) continue;
    // A short script can end before the strip ever sees it live: follow it from here.
    setShared(TRACK, { ...(shared(TRACK) ?? {}), [address]: Date.now() });
    if (job.watch) run("terminal.peek", { terminal: address, float: true });
  }
}
