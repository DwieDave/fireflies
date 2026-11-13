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
import type { ExecResult } from "herdr";
import { arrayOf, isBoolean, isNumber, isString, object, parseJson, readSharedList, readSharedMap, sharedListKey, sharedMapKey, writeSharedMap } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import { isList } from "./guards.ts";

export const JOBS = "scripts.jobs";

/** A job as the scripts mod queues it (scripts/runs.js enqueue). */
const isJob = object({}, { at: isNumber, name: isString, watch: isBoolean, steps: arrayOf(object({ hc: arrayOf(isString) }, { start: isBoolean })) });

type Job = Guarded<typeof isJob>;

const JOBS_KEY = sharedListKey(JOBS, isJob);

/** Runs to follow: address -> when it was started (ms). */
const TRACK = sharedMapKey("scripts.track", isNumber);

/** `hc run --json`'s answer, as far as it's read: the new terminal's address. */
const isStarted = object({ address: isString });

// A job left from before a restart is stale, not something to do now.
const STALE = 60000;

let working = false;

/** Jobs are waiting. */
export const pendingJobs = (): boolean => {
  const jobs = shared(JOBS);

  return isList(jobs) && jobs.length > 0;
};

/** Takes every waiting job (so another window's strip doesn't run them too)
 *  and runs them in order. */
export async function runJobs(): Promise<void> {
  if (working || !pendingJobs()) return;

  working = true;

  const jobs = readSharedList(shared, JOBS_KEY);

  setShared(JOBS, []);

  try {
    for (const job of jobs) if (Date.now() - (job.at ?? 0) < STALE) await runJob(job);
  } finally {
    working = false;
  }

  if (pendingJobs()) await runJobs();
}

async function runJob(job: Job): Promise<void> {
  for (const step of job.steps ?? []) {
    const r = await hc([...step.hc]).catch((cause: unknown): ExecResult => ({ code: -1, stdout: "", stderr: cause instanceof Error ? cause.message : String(cause) }));

    if (!step.start) continue;

    if (r.code !== 0) {
      notify({ title: `couldn't start ${job.name ?? "the script"}`, body: (r.stderr || r.stdout || "hc run failed").trim().split("\n").pop() ?? "", level: "error" });

      return;
    }

    // Started; without an address in the answer, there's nothing to follow.
    const address = parseJson(r.stdout, isStarted)?.address ?? null;

    if (!address) continue;

    // A short script can end before the strip ever sees it live: follow it from here.
    writeSharedMap(setShared, TRACK, new Map(readSharedMap(shared, TRACK)).set(address, Date.now()));

    if (job.watch) run("terminal.peek", { terminal: address, float: true });
  }
}
