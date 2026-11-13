import { test, expect } from "bun:test";
import {
  tone, pollEvery, FAST, SLOW, parseHeaders, needsFromWorkflow, jobColumns, jobParents, splitLog, logLine, duration, ago, checkRows, rollupTone,
} from "../defaults/mods/github/model.ts";

test("tone maps GitHub states to the window's colors", () => {
  expect(tone("in_progress", null)).toBe("working");
  expect(tone("queued", null)).toBe("queued");
  expect(tone("waiting", null)).toBe("queued");
  expect(tone("completed", "success")).toBe("done");
  expect(tone("completed", "failure")).toBe("failed");
  expect(tone("completed", "timed_out")).toBe("failed");
  expect(tone("completed", "cancelled")).toBe("stopped");
  expect(tone("completed", "skipped")).toBe("skipped");
  expect(tone("COMPLETED", "SUCCESS")).toBe("done");
});

test("polls fast only while something moves", () => {
  expect(pollEvery([{ status: "completed" }, { status: "in_progress" }])).toBe(FAST);
  expect(pollEvery([{ status: "queued" }])).toBe(FAST);
  expect(pollEvery([{ status: "completed" }])).toBe(SLOW);
  expect(pollEvery([])).toBe(SLOW);
  expect(pollEvery(undefined)).toBe(SLOW);
  expect([FAST, SLOW]).toEqual([3000, 60000]);
});

test("reads status, etag and body from gh api -i", () => {
  const ok = parseHeaders('HTTP/2.0 200 OK\r\nEtag: W/"abc"\r\nX-Ratelimit-Remaining: 9\r\n\r\n{"a":1}');
  expect(ok).toEqual({ status: 200, etag: 'W/"abc"', body: '{"a":1}' });
  const same = parseHeaders('HTTP/2.0 304 Not Modified\nEtag: "abc"\n\n');
  expect(same.status).toBe(304);
  expect(same.body).toBe("");
  expect(parseHeaders("").status).toBe(0);
});

const CI = `name: ci
on:
  pull_request:
jobs:
  platform-tests:
    strategy:
      matrix:
        include:
          - { platform: linux }
    runs-on: x
    steps:
      - run: echo needs: nothing
  test:
    needs: platform-tests # gate
    runs-on: x
  mac-dmg:
    name: Mac DMG
    needs: [platform-tests, "test"]
  publish:
    name: Publish \${{ matrix.os }}
    needs:
      - mac-dmg
      - test
other: 1
`;

test("reads jobs and their needs from a workflow", () => {
  const n = needsFromWorkflow(CI);
  expect([...n.keys()]).toEqual(["platform-tests", "test", "mac-dmg", "publish"]);
  expect(n.get("platform-tests")).toEqual({ name: null, needs: [] });
  expect(n.get("test")!.needs).toEqual(["platform-tests"]);
  expect(n.get("mac-dmg")).toEqual({ name: "Mac DMG", needs: ["platform-tests", "test"] });
  expect(n.get("publish")!.needs).toEqual(["mac-dmg", "test"]);
  expect(needsFromWorkflow("name: x\non: push\n").size).toBe(0);
});

const job = (name: string, started: string | null, completed: string | null) => ({ name, started_at: started, completed_at: completed });

test("lays jobs out in columns by needs, matrix and templated names included", () => {
  const jobs = [
    job("platform-tests (linux, ubuntu)", null, null), job("platform-tests (mac, macos)", null, null),
    job("Publish ubuntu", null, null), job("test", null, null), job("Mac DMG", null, null),
  ];
  const cols = jobColumns(jobs, needsFromWorkflow(CI)).map((c) => c.map((j) => j.name));
  expect(cols).toEqual([["platform-tests (linux, ubuntu)", "platform-tests (mac, macos)"], ["test"], ["Mac DMG"], ["Publish ubuntu"]]);
});

// 4-space indents, a reusable workflow's jobs ("caller / job"), names with
// expressions in the middle, and jobs that haven't run yet.
const DEPLOY = `name: Build and Publish
on: push
jobs:
    detect:
        name: Detect changed services
        runs-on: x
    gitops-prod:
        name: Update GitOps manifests
        needs: detect
        if: github.ref == 'refs/heads/main'
    build-web:
        name: Build web
        needs: [detect]
        uses: ./.github/workflows/build.yml
    gitops-preview:
        name: Update GitOps manifests (\${{ inputs.env }} preview)
        needs:
            - build-web
    deploy-preview:
        name: Deploy PR preview environment
        needs: build-web
`;

const ran = (id: number, name: string, status = "completed", conclusion: string | null = "success") => ({ id, name, status, conclusion, started_at: null, completed_at: null });

test("reads needs at any indent", () => {
  const n = needsFromWorkflow(DEPLOY);
  expect([...n.keys()]).toEqual(["detect", "gitops-prod", "build-web", "gitops-preview", "deploy-preview"]);
  expect(n.get("gitops-prod")!.needs).toEqual(["detect"]);
  expect(n.get("build-web")).toEqual({ name: "Build web", needs: ["detect"] });
  expect(n.get("gitops-preview")!.needs).toEqual(["build-web"]);
  expect(n.get("deploy-preview")!.needs).toEqual(["build-web"]);
});

test("every job links to the jobs it needs, including ones that haven't run", () => {
  const jobs = [
    ran(1, "Detect changed services"), ran(2, "Update GitOps manifests", "completed", "skipped"),
    ran(3, "Build web / build"), ran(4, "Update GitOps manifests (staging preview)", "queued", null),
    ran(5, "Deploy PR preview environment", "pending", null),
  ];
  const needs = needsFromWorkflow(DEPLOY);
  expect(jobColumns(jobs, needs).map((c) => c.map((j) => j.id))).toEqual([[1], [2, 3], [4, 5]]);
  const parents = jobParents(jobs, needs)!;
  expect(Object.fromEntries(parents)).toEqual({ 1: [], 2: [1], 3: [1], 4: [3], 5: [3] });
  expect(jobParents(jobs, new Map())).toBeNull();
  expect(jobParents([ran(9, "unknown")], needs)).toBeNull();
});

test("without a workflow, jobs fall into waves by time; queued ones stay in the open wave", () => {
  const jobs = [
    job("a", "2026-11-09T16:14:21Z", "2026-11-09T16:17:42Z"), job("b", "2026-11-09T16:14:21Z", "2026-11-09T16:17:57Z"),
    job("gate", "2026-11-09T16:17:59Z", "2026-11-09T16:18:03Z"), job("later", null, null),
  ];
  expect(jobColumns(jobs, new Map()).map((c) => c.map((j) => j.name))).toEqual([["a", "b"], ["gate", "later"]]);
  expect(jobColumns([], new Map())).toEqual([]);
});

const step = (number: number, name: string, started: string, completed: string, conclusion = "success") =>
  ({ number, name, started_at: `2026-11-09T16:${started}Z`, completed_at: `2026-11-09T16:${completed}Z`, conclusion });
const line = (t: string, s: string) => `job\tUNKNOWN STEP\t2026-11-09T16:${t}.1234567Z ${s}`;

test("splits a job's log into its steps by markers and time", () => {
  const steps = [
    step(1, "Set up job", "14:22", "14:24"),
    step(3, "Run dtolnay/rust-toolchain@683b", "14:30", "14:39"),
    step(4, "Run mlugg/setup-zig@d143", "14:39", "14:48"),
    step(7, "Windows deps", "16:25", "16:25", "skipped"),
    step(9, "Build tests", "16:25", "17:13"),
    step(12, "Tests", "17:13", "17:35"),
    step(31, "Post Run mlugg/setup-zig@d143", "17:38", "17:40"),
    step(33, "Complete job", "17:40", "17:41"),
  ];
  const log = [
    "﻿" + line("14:22", "Current runner version"),
    line("14:30", "##[group]Run dtolnay/rust-toolchain@683b"),
    line("14:30", "##[group]Run if [[ -z $toolchain ]]; then"),
    line("14:39", "##[group]Run if [ -z \"${CARGO_INCREMENTAL+set}\" ]; then"), // the composite action, still step 3
    line("14:39", "##[group]Run mlugg/setup-zig@d143"),
    line("16:25", "##[group]Run cargo test"),
    line("16:30", "\x1b[1mCompiling^[[0m herdr"),
    line("17:13", "##[group]Run only=()"), // a named run: step, same second the last one ended
    line("17:20", "##[error]boom"),
    line("17:38", "Post job cleanup."),
    line("17:40", "Cleaning up orphan processes"),
  ].join("\n");
  const m = splitLog(log, steps);
  expect(m.get(1)).toEqual(["Current runner version"]);
  expect(m.get(3)!.length).toBe(3);
  expect(m.get(4)).toEqual(["##[group]Run mlugg/setup-zig@d143"]);
  expect(m.has(7)).toBe(false);
  expect(m.get(9)).toEqual(["##[group]Run cargo test", "Compiling herdr"]);
  expect(m.get(12)).toEqual(["##[group]Run only=()", "##[error]boom"]);
  expect(m.get(31)).toEqual(["Post job cleanup."]);
  expect(m.get(33)).toEqual(["Cleaning up orphan processes"]);
});

test("a log for steps that never started is empty, not a crash", () => {
  expect(splitLog("x\ty\tz", [{ number: 1, name: "a", started_at: null, completed_at: null, conclusion: null }]).size).toBe(0);
  expect(splitLog("", []).size).toBe(0);
});

test("log lines know their kind", () => {
  expect(logLine("##[group]Run x")).toEqual({ kind: "group", text: "Run x" });
  expect(logLine("##[endgroup]")).toBeNull();
  expect(logLine("##[error]bad")).toEqual({ kind: "error", text: "bad" });
  expect(logLine("##[warning]hm")).toEqual({ kind: "warning", text: "hm" });
  expect(logLine("a\tb").text).toBe("a    b");
});

test("durations and ages read like people say them", () => {
  expect(duration("2026-11-09T16:00:00Z", "2026-11-09T16:00:12Z")).toBe("12s");
  expect(duration("2026-11-09T16:00:00Z", "2026-11-09T16:03:04Z")).toBe("3m 04s");
  expect(duration("2026-11-09T16:00:00Z", "2026-11-09T17:02:00Z")).toBe("1h 02m");
  expect(duration(null, null)).toBe("—");
  expect(duration("2026-11-09T16:00:00Z", null, Date.parse("2026-11-09T16:00:05Z"))).toBe("5s");
  const now = Date.parse("2026-11-09T16:00:00Z");
  expect(ago("2026-11-09T15:59:50Z", now)).toBe("now");
  expect(ago("2026-11-09T15:56:00Z", now)).toBe("4m");
  expect(ago("2026-11-07T16:00:00Z", now)).toBe("2d");
});

test("a PR's checks become rows pointing at their runs", () => {
  const rows = checkRows([
    { __typename: "CheckRun", name: "platform-tests (linux)", workflowName: "ci", status: "COMPLETED", conclusion: "SUCCESS",
      detailsUrl: "https://github.com/o/r/actions/runs/42652702731/job/129282999707", startedAt: "a", completedAt: "b" },
    { __typename: "CheckRun", name: "test", workflowName: "ci", status: "IN_PROGRESS", conclusion: "", detailsUrl: "https://github.com/o/r/actions/runs/5/job/6" },
    { __typename: "StatusContext", context: "vercel", state: "PENDING", targetUrl: "https://vercel.com/x" },
  ]);
  expect(rows.map((r) => [r.name, r.tone, r.runId, r.jobId])).toEqual([
    ["platform-tests (linux)", "done", 42652702731, 129282999707], ["test", "working", 5, 6], ["vercel", "queued", null, null],
  ]);
  expect(rollupTone(rows)).toBe("working");
  expect(rollupTone([])).toBeNull();
});
