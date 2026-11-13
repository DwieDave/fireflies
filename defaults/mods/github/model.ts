// What the GitHub window knows about runs, jobs, steps, logs and checks, as
// plain functions over gh's JSON: no herdr imports, so scripts/ tests it.

import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, literal, nullable, object } from "./guard.ts";
import { isList, maybe } from "./guards.ts";

// ---- what gh hands back, proven where it's read (gh.ts, the tabs' reads)

/** How the window colours a run, job, step or check. */
export const isTone = literal("working", "queued", "done", "failed", "skipped", "stopped");

export type Tone = Guarded<typeof isTone>;

const text = maybe(isString);

/** Someone on GitHub (an author, a commenter): GitHub's ghost has no login. */
export const isActor = object({}, { login: text });

export type Actor = Guarded<typeof isActor>;

export const isLabel = object({ name: isString }, { color: text });

export type Label = Guarded<typeof isLabel>;

/** One of a pull request's checks (gh's statusCheckRollup): a check run, or a commit status
 *  (StatusContext: its `context` and `state`). */
export const isCheck = object({}, {
  __typename: text, name: text, context: text, workflowName: text, status: text, conclusion: text, state: text,
  detailsUrl: text, targetUrl: text, startedAt: text, completedAt: text,
});

export type Check = Guarded<typeof isCheck>;

/** A workflow run (REST `actions/runs`), the fields the window shows. */
export const isRun = object({ id: isNumber }, {
  name: text, display_title: text, status: text, conclusion: text, run_number: maybe(isNumber), head_branch: text, head_sha: text,
  event: text, path: text, run_started_at: text, updated_at: text, html_url: text, created_at: text,
});

export type Run = Guarded<typeof isRun>;

/** A job's step (REST `actions/runs/<id>/jobs`). */
export const isStep = object({ number: isNumber, name: isString }, { status: text, conclusion: text, started_at: text, completed_at: text });

export type Step = Guarded<typeof isStep>;

export const isJob = object({ id: isNumber }, {
  name: text, status: text, conclusion: text, started_at: text, completed_at: text, html_url: text, steps: maybe(arrayOf(isStep)),
});

export type Job = Guarded<typeof isJob>;

/** A comment on a pull request (gh pr view's `comments`). */
export const isPrComment = object({}, { body: text, createdAt: text, url: text, author: maybe(isActor) });

/** A review (gh pr view's `reviews`). */
export const isReview = object({}, { state: text, body: text, submittedAt: text, author: maybe(isActor) });

/** A pull request as the right panel draws it: `gh pr view --json` (prs.js VIEW), or its slim copy. */
export const isPrView = object({ number: isNumber, title: isString }, {
  body: text, isDraft: maybe(isBoolean), baseRefName: text, headRefName: text, reviewDecision: text, url: text, createdAt: text, updatedAt: text,
  additions: maybe(isNumber), deletions: maybe(isNumber), changedFiles: maybe(isNumber), author: maybe(isActor),
  labels: maybe(arrayOf(isLabel)), statusCheckRollup: maybe(arrayOf(isCheck)), comments: maybe(arrayOf(isPrComment)), reviews: maybe(arrayOf(isReview)),
});

export type PrView = Guarded<typeof isPrView>;

/** A review (line) comment (REST `pulls/<n>/comments`). */
export const isReviewComment = object({}, {
  body: text, created_at: text, path: text, line: maybe(isNumber), original_line: maybe(isNumber), in_reply_to_id: maybe(isNumber),
  html_url: text, user: maybe(isActor),
});

export type ReviewComment = Guarded<typeof isReviewComment>;

/** A row of the pull request list, as prRows makes it (and the cache keeps it); `tone` once
 *  its view was read; its checks when a row carries them (a row the list was given whole). */
export const isPrRow = object({
  number: isNumber, title: isString, isDraft: isBoolean, headRefName: nullable(isString), additions: isNumber, deletions: isNumber,
  reviewDecision: nullable(isString), updatedAt: nullable(isString), author: nullable(isActor), labels: arrayOf(isLabel), rollup: nullable(isString),
}, { tone: maybe(isTone), statusCheckRollup: maybe(arrayOf(isCheck)) });

export type PrRow = Guarded<typeof isPrRow>;

/** A run, job, step or check: what tone() and duration() read. */
export interface Timed {
  readonly status?: string | null | undefined;
  readonly conclusion?: string | null | undefined;
  readonly started_at?: string | null | undefined;
  readonly completed_at?: string | null | undefined;
}

/** A run's, job's, step's or check's state as one of the window's tones. */
export function tone(status: string | null | undefined, conclusion: string | null | undefined): Tone {
  const s = (status ?? "").toLowerCase(), c = (conclusion ?? "").toLowerCase();

  if (s === "in_progress") return "working";

  if (s && s !== "completed") return "queued"; // queued, waiting, pending, requested

  if (c === "success" || c === "neutral") return "done";

  if (c === "failure" || c === "timed_out" || c === "startup_failure" || c === "action_required") return "failed";

  if (c === "skipped") return "skipped";

  if (c === "cancelled" || c === "stale") return "stopped";

  return s === "completed" ? "done" : "queued";
}

const LIVE = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

/** Poll fast while anything shown still moves, slowly otherwise. */
export const FAST = 3000, SLOW = 60000;

export function pollEvery(items: readonly Timed[] | null | undefined): number {
  return (items ?? []).some((x) => LIVE.has((x.status ?? "").toLowerCase())) ? FAST : SLOW;
}

/** What `gh api -i` printed: the status (0: none), the ETag and the body. */
export interface Answer {
  readonly status: number;
  readonly etag: string | null;
  readonly body: string;
}

/** `gh api -i` output: the status line, the ETag and the body. */
export function parseHeaders(text: string): Answer {
  const cut = text.search(/\r?\n\r?\n/);
  const head = cut < 0 ? text : text.slice(0, cut);
  const body = cut < 0 ? "" : text.slice(cut).replace(/^\r?\n\r?\n/, "");
  const status = Number(/^HTTP\/[\d.]+ (\d+)/.exec(head)?.[1] ?? 0);
  const etag = /^etag:\s*(.+?)\s*$/im.exec(head)?.[1] ?? null;

  return { status, etag, body };
}

/** A job of a workflow file: its `name:` and the jobs it `needs:`. */
export interface WorkflowJob {
  name: string | null;
  needs: string[];
}

/** A job of a workflow as read back: its name and what it needs. */
export interface NeedsOf {
  readonly name: string | null;
  readonly needs: readonly string[];
}

/** A workflow's jobs by key. */
export type Needs = ReadonlyMap<string, NeedsOf>;

/** The `jobs:` of a workflow file: key -> { name, needs }. A tiny reader for
 *  the shapes GitHub accepts (`needs: a`, `needs: [a, b]`, a block list), at
 *  any indent; anything it can't read is left out (the graph then falls back
 *  to timing). */
export function needsFromWorkflow(yaml: string | null | undefined): Map<string, WorkflowJob> {
  const out = new Map<string, WorkflowJob>();
  const lines = (yaml ?? "").split(/\r?\n/);
  const start = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));

  if (start < 0) return out;

  // indent: the job keys'; prop: the current job's keys' (2 or 4 deeper, whatever the file uses).
  let indent: number | null = null, prop: number | null = null, job: WorkflowJob | null = null, list = false;
  const clean = (v: string) => v.replace(/\s#.*$/, "").trim().replace(/^["']|["']$/g, "");

  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const pad = line.length - line.trimStart().length;

    if (pad === 0) break; // the next top-level key

    indent ??= pad;

    if (pad <= indent) {
      const key = /^\s*["']?([A-Za-z0-9_-]+)["']?:\s*(#.*)?$/.exec(line)?.[1];

      job = key !== undefined && pad === indent ? { name: null, needs: [] } : null;

      if (job && key !== undefined) out.set(key, job);

      prop = null;
      list = false;

      continue;
    }

    if (!job) continue;

    prop ??= pad;

    if (pad <= prop) list = false;

    const kv = /^\s*(name|needs):\s*(.*)$/.exec(line);

    if (pad === prop && kv) {
      const v = clean(kv[2] ?? "");

      if (kv[1] === "name") job.name = v || null;
      else if (v.startsWith("[")) job.needs = v.slice(1, v.lastIndexOf("]")).split(",").map(clean).filter(Boolean);
      else if (v) job.needs = [v];
      else list = true;

      continue;
    }

    if (list && pad > prop) {
      const item = /^\s*-\s*(.+)$/.exec(line)?.[1];

      if (item !== undefined) job.needs.push(clean(item));
    }
  }

  return out;
}

/** A `name:` as a test of the shown name: `${{ … }}` matches anything. */
function nameTest(name: string): (s: string) => boolean {
  if (!name.includes("${{")) return (s) => s === name;

  const re = new RegExp(`^${name.split(/\$\{\{.*?\}\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);

  return (s) => re.test(s);
}

/** What keyOf reads of an API job. */
export interface NamedJob {
  readonly id: number;
  readonly name?: string | null | undefined;
}

/** Which workflow job an API job is: its key, by `name:` or key. The shown
 *  name may carry a matrix's " (…)" and, for a reusable workflow's jobs, the
 *  caller's name before " / ". The fullest form that matches any job wins,
 *  so "Deploy (prod)" finds `name: Deploy (${{ env }})` before `name: Deploy`. */
export function keyOf(job: NamedJob, needs: Needs): string | null {
  const shown = job.name ?? "";
  const caller = shown.split(" / ")[0] ?? shown;
  const tries = [...new Set([shown, caller, shown.replace(/ \(.*\)$/, ""), caller.replace(/ \(.*\)$/, "")])];
  const tests = [...needs].map(([key, j]) => [key, nameTest(j.name ?? key)] as const);

  for (const s of tries) for (const [key, test] of tests) if (s === key || test(s)) return key;

  return null;
}

/** Which jobs each job waits for, by `needs:`: job id -> parent job ids
 *  ([] for a first job). null when the workflow's needs aren't known (the
 *  columns then come from timing, and each column follows the one before). */
export function jobParents(jobs: readonly NamedJob[] | null | undefined, needs: Needs | null | undefined): Map<number, number[]> | null {
  if (!needs?.size) return null;

  const list = [...(jobs ?? [])];
  const keys = list.map((j) => keyOf(j, needs));

  if (!keys.some(Boolean)) return null;

  const byKey = new Map<string, number[]>();

  list.forEach((j, i) => {
    const key = keys[i];

    if (!key) return;

    const ids = byKey.get(key) ?? [];

    byKey.set(key, ids);
    ids.push(j.id);
  });

  const out = new Map<number, number[]>();

  list.forEach((j, i) => {
    const key = keys[i];

    out.set(j.id, key ? (needs.get(key)?.needs ?? []).flatMap((k) => byKey.get(k) ?? []) : []);
  });

  return out;
}

/** The jobs in columns, left to right: by `needs:` when the workflow says,
 *  else in waves by time (a job that started after every job of a wave
 *  finished starts the next one). Each column keeps the API's order. */
export function jobColumns<J extends NamedJob & Timed>(jobs: readonly J[] | null | undefined, needs: Needs | null | undefined): J[][] {
  const list = [...(jobs ?? [])];

  if (!list.length) return [];

  const keys = list.map((j) => (needs?.size ? keyOf(j, needs) : null));

  if (needs && keys.some(Boolean)) {
    const memo = new Map<string, number>();

    const depth = (key: string, seen = new Set<string>()): number => {
      const known = memo.get(key);

      if (known !== undefined) return known;

      if (seen.has(key)) return 0;

      seen.add(key);

      const d = Math.max(-1, ...(needs.get(key)?.needs ?? []).flatMap((k) => (needs.has(k) ? [depth(k, seen)] : []))) + 1;

      memo.set(key, d);

      return d;
    };

    const cols: J[][] = [];

    list.forEach((j, i) => {
      const key = keys[i];
      const d = key ? depth(key) : 0;
      const col = cols[d] ?? [];

      cols[d] = col;
      col.push(j);
    });

    // A depth no job has is a hole in the array: left out.
    return cols.filter((col) => Array.isArray(col));
  }

  const at = (v: string | null | undefined) => (v ? Date.parse(v) : NaN);
  const byStart = list.map((j, i) => ({ j, i, s: at(j.started_at) })).sort((a, b) => (a.s || Infinity) - (b.s || Infinity) || a.i - b.i);
  const cols: (typeof byStart)[] = [];
  let wave: typeof byStart = [], end = -Infinity;

  for (const x of byStart) {
    if (wave.length && Number.isFinite(x.s) && x.s >= end && Number.isFinite(end)) {
      cols.push(wave);
      wave = [];
      end = -Infinity;
    }

    wave.push(x);

    const e = at(x.j.completed_at);

    end = Number.isFinite(e) && end !== Infinity ? Math.max(end, e) : Infinity;
  }

  if (wave.length) cols.push(wave);

  return cols.map((c) => c.sort((a, b) => a.i - b.i).map((x) => x.j));
}

// Color codes, real or as gh prints them without a terminal ("^[[36;1m").
// The escape character (27) goes in as itself: a regex literal may not name a control character.
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`(?:${ESC}|\\^\\[)\\[[0-9;?]*[A-Za-z]`, "g");
const STAMP = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?Z ?/;
const sec = (v: string | null | undefined) => (v ? Math.floor(Date.parse(v) / 1000) : NaN);

/**
 * A job's log split into its steps: step number -> lines (no timestamps).
 * `gh run view --job <id> --log` prefixes every line "job\tstep\t" (often
 * "UNKNOWN STEP"), so lines are placed by time and markers: a
 * `##[group]<name>` naming a later step starts it (an action's step is
 * named "Run owner/action@ref", as its group is); a `##[group]Run ...` starts
 * the next step when that one has a name of its own (a `run:` with `name:`)
 * and has begun; a line later than its step's end moves on to the step
 * running then; the runner's "Post job cleanup." and "Cleaning up orphan
 * processes" open the post steps and "Complete job". Skipped steps get nothing.
 */
export function splitLog(text: string | null | undefined, steps: readonly Step[] | null | undefined): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const live = [...(steps ?? [])].filter((s) => s.conclusion !== "skipped" && s.started_at).sort((a, b) => a.number - b.number);

  if (!live.length) return out;

  for (const s of live) out.set(s.number, []);

  let cur = 0;

  for (const whole of (text ?? "").split("\n")) {
    const raw = whole.replace(/\r$/, "");

    if (!raw) continue;

    const parts = raw.split("\t");
    let line = (parts.length >= 3 ? parts.slice(2).join("\t") : raw).replace(/^\uFEFF/, "");
    const m = STAMP.exec(line);
    const ts = m ? Math.floor(Date.parse(`${m[1] ?? ""}Z`) / 1000) : NaN;

    line = (m ? line.slice(m[0].length) : line).replace(/^\uFEFF/, "").replace(ANSI, "");

    const shown = line;
    const strong = shown.startsWith("##[group]") ? live.findIndex((s, i) => i > cur && `##[group]${s.name}` === shown) : -1;

    // The runner's own lines that open its post steps and the last one.
    const runner = shown === "Post job cleanup." ? (s: Step) => s.name.startsWith("Post ")
      : shown === "Cleaning up orphan processes" ? (s: Step) => s.name === "Complete job" : null;

    const opens = runner ? live.findIndex((s, i) => i > cur && runner(s)) : -1;

    if (strong >= 0) cur = strong;
    else if (opens >= 0) cur = opens;
    else if (shown.startsWith("##[group]Run ")) {
      const next = live[cur + 1];

      if (next && !next.name.startsWith("Run ") && !(ts < sec(next.started_at))) cur++;
    } else if (Number.isFinite(ts)) {
      for (let next = live[cur + 1]; next && ts > sec(live[cur]?.completed_at) && ts >= sec(next.started_at); next = live[cur + 1]) cur++;
    }

    const step = live[cur];

    if (step) out.get(step.number)?.push(shown);
  }

  return out;
}

/** A log line as drawn: a group's title, an error, a warning, a notice, debug, or plain. */
export interface LogLine {
  readonly kind: "group" | "error" | "warning" | "notice" | "debug" | "plain";
  readonly text: string;
}

/** How a log line looks: a group's title, an error, a warning, or plain. */
export function logLine(line: string): LogLine | null {
  if (line.startsWith("##[group]")) return { kind: "group", text: line.slice(9) };

  if (line.startsWith("##[endgroup]")) return null;

  if (line.startsWith("##[error]")) return { kind: "error", text: line.slice(9) };

  if (line.startsWith("##[warning]")) return { kind: "warning", text: line.slice(11) };

  if (line.startsWith("##[notice]")) return { kind: "notice", text: line.slice(10) };

  if (line.startsWith("##[debug]")) return { kind: "debug", text: line.slice(9) };

  return { kind: "plain", text: line.replace(/\t/g, "    ") };
}

/** "12s", "3m 04s", "1h 02m"; "—" before it started. `now` for still running. */
export function duration(start: string | null | undefined, end: string | null | undefined, now = Date.now()): string {
  const a = start ? Date.parse(start) : NaN;

  if (!Number.isFinite(a)) return "—";

  const b = end ? Date.parse(end) : now;
  const s = Math.max(0, Math.round((b - a) / 1000));

  if (s < 60) return `${s}s`;

  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;

  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** "now", "4m", "3h", "2d": how long ago. */
export function ago(when: string | null | undefined, now = Date.now()): string {
  const t = when ? Date.parse(when) : NaN;

  if (!Number.isFinite(t)) return "";

  const s = Math.max(0, Math.round((now - t) / 1000));

  return s < 45 ? "now" : s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
}

/** A check as a row of the checks panel. */
export interface CheckRow {
  readonly name: string;
  readonly workflow: string | null;
  readonly tone: Tone;
  readonly status: string;
  readonly runId: number | null;
  readonly jobId: number | null;
  readonly url: string | null;
  readonly started: string | null;
  readonly ended: string | null;
}

/** A PR's checks (gh's statusCheckRollup) as rows: name, tone, the run it's in. */
export function checkRows(rollup: readonly Check[] | null | undefined): CheckRow[] {
  return (rollup ?? []).map((c) => {
    const commit = c.__typename === "StatusContext";
    const status = commit ? (c.state === "PENDING" || c.state === "EXPECTED" ? "pending" : "completed") : c.status;
    const conclusion = commit ? c.state : c.conclusion;
    const url = c.detailsUrl ?? c.targetUrl ?? null;
    const run = /\/actions\/runs\/(\d+)/.exec(url ?? "")?.[1];
    const job = /\/job\/(\d+)/.exec(url ?? "")?.[1];

    return {
      name: c.name ?? c.context ?? "check", workflow: c.workflowName ?? null,
      tone: tone(status, conclusion), status: (status ?? "").toLowerCase(),
      runId: run === undefined ? null : Number(run), jobId: job === undefined ? null : Number(job), url,
      started: c.startedAt ?? null, ended: c.completedAt ?? null,
    };
  });
}

const WORST: readonly Tone[] = ["failed", "working", "queued", "done", "stopped", "skipped"];

/** The checks together: the worst tone wins (failed, working, queued, done). */
export function rollupTone(rows: readonly { readonly tone: Tone }[]): Tone | null {
  const tones = new Set(rows.map((r) => r.tone));

  return WORST.find((t) => tones.has(t)) ?? null;
}

// ---- the pull request list, in one GraphQL read of only the fields its rows
// show: gh pr list --json statusCheckRollup reads every check of every PR
// (100 contexts each); a row only needs the rollup's state.

const ROW_FIELDS = "number title isDraft headRefName additions deletions reviewDecision updatedAt author { login } labels(first: 8) { nodes { name color } } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }";

export const PR_LIMIT = 60;

/** The list's filters: every open pull request, mine, the ones waiting for my review. */
export const isPrFilter = literal("all", "mine", "review");

export type PrFilter = Guarded<typeof isPrFilter>;

/** A GraphQL variable: its name and value (a number goes as -F, typed). */
export type GqlVar = readonly [name: string, value: string | number];

/** A query and its variables. */
export interface GqlRead {
  readonly query: string;
  readonly vars: readonly GqlVar[];
}

/** The query and variables for a filter's open PRs, newest first (as gh pr list orders them). */
export function prListQuery(filter: PrFilter, full: string, limit = PR_LIMIT): GqlRead {
  const [owner = "", name = ""] = full.split("/");

  if (filter === "mine" || filter === "review") {
    const who = filter === "mine" ? "author:@me" : "review-requested:@me";

    return {
      query: `query($q: String!, $n: Int!) { search(query: $q, type: ISSUE, first: $n) { nodes { ... on PullRequest { ${ROW_FIELDS} } } } }`,
      vars: [["q", `repo:${full} is:pr is:open ${who} sort:created-desc`], ["n", limit]],
    };
  }

  return {
    query: `query($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) { pullRequests(states: OPEN, first: $n, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { ${ROW_FIELDS} } } } }`,
    vars: [["owner", owner], ["name", name], ["n", limit]],
  };
}

const nodesOf = <T>(item: (value: unknown) => value is T) => maybe(object({}, { nodes: maybe(arrayOf(item)) }));

/** A pull request node of prListQuery's answer. */
const isPrNode = object({ number: isNumber, title: isString }, {
  isDraft: maybe(isBoolean), headRefName: text, additions: maybe(isNumber), deletions: maybe(isNumber), reviewDecision: text, updatedAt: text,
  author: maybe(isActor), labels: nodesOf(isLabel),
  commits: nodesOf(object({}, { commit: maybe(object({}, { statusCheckRollup: maybe(object({}, { state: text })) })) })),
});

/** prListQuery's answer: the search's nodes (an issue there is an empty node), or the repository's. */
export const isPrList = object({}, {
  search: maybe(object({}, { nodes: maybe(isList) })),
  repository: maybe(object({}, { pullRequests: maybe(object({}, { nodes: maybe(isList) })) })),
});

export type PrList = Guarded<typeof isPrList>;

/** The rows of a prListQuery answer: { number, title, ..., rollup } (rollup: SUCCESS, FAILURE, PENDING, ...). */
export function prRows(data: PrList | null | undefined): PrRow[] {
  const nodes = data?.search?.nodes ?? data?.repository?.pullRequests?.nodes ?? [];

  return nodes.filter((n) => isPrNode(n)).map((n): PrRow => ({
    number: n.number, title: n.title, isDraft: Boolean(n.isDraft), headRefName: n.headRefName ?? null,
    additions: n.additions ?? 0, deletions: n.deletions ?? 0, reviewDecision: n.reviewDecision ?? null, updatedAt: n.updatedAt ?? null,
    author: n.author ? { login: n.author.login } : null,
    labels: (n.labels?.nodes ?? []).map((l) => ({ name: l.name, color: l.color })),
    rollup: n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
  }));
}

const ROLLUP = new Map<string, Tone>([["SUCCESS", "done"], ["FAILURE", "failed"], ["ERROR", "failed"], ["PENDING", "working"], ["EXPECTED", "queued"]]);

/** What rowTone reads: a row's tone once its view was read, its checks, its rollup's state. */
export interface Toned {
  readonly tone?: Tone | null | undefined;
  readonly statusCheckRollup?: readonly Check[] | null | undefined;
  readonly rollup?: string | null | undefined;
}

/** A list row's tone: from the PR's checks once its view was read, else its rollup's state. */
export function rowTone(p: Toned | null | undefined): Tone | null {
  if (!p) return null;

  if (p.tone !== undefined) return p.tone;

  if (p.statusCheckRollup) return rollupTone(checkRows(p.statusCheckRollup));

  return ROLLUP.get(p.rollup ?? "") ?? null;
}

/** "just now", "2m ago", "3h ago": when the shown data was read. */
export function readAgo(at: number | null | undefined, now = Date.now()): string {
  if (!at) return "";

  const a = ago(new Date(at).toISOString(), now);

  return a === "now" ? "just now" : `${a} ago`;
}

/** A web link found in some Markdown: where it goes and what it says. */
export interface WebLink {
  readonly url: string;
  readonly label: string;
}

/** The web links in some Markdown texts, for `L` (the keyboard's way to a
 *  link in a PR or a card): [label](url), <url> and bare http(s) URLs, each
 *  url once, in reading order. Images are left out. */
export function linksIn(texts: readonly (string | null | undefined)[]): WebLink[] {
  const out: WebLink[] = [], seen = new Set<string>();

  const add = (link: string, label?: string) => {
    const url = link.replace(/[.,;:!?)\]]+$/, "");

    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;

    seen.add(url);
    out.push({ url, label: label?.trim() || url });
  };

  for (const text of texts) {
    const s = (text ?? "").replace(/```[\s\S]*?```/g, "");
    const re = /(!?)\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>()[\]"'`]+)/gi;

    for (const [, bang, label, target, angled, bare] of s.matchAll(re)) {
      if (target) {
        if (!bang) add(target, label);
      } else {
        const url = angled ?? bare;

        if (url !== undefined) add(url);
      }
    }
  }

  return out;
}

// ---- the other answers the window reads (the forms', the run lists')

/** A branch or a tag (REST `branches`, `tags`): its name. */
export const isNamed = object({ name: isString });

export const isNamedList = arrayOf(isNamed);

/** A repo's deployment environments (REST `environments`). */
export const isEnvironments = object({}, { environments: maybe(arrayOf(isNamed)) });

/** A workflow (`gh workflow list --json id,name,path,state`). */
export const isWorkflow = object({ id: isNumber, name: isString, path: isString, state: isString });

export type Workflow = Guarded<typeof isWorkflow>;

/** `gh workflow list` prints nothing (null) when there are none. */
export const isWorkflows = maybe(arrayOf(isWorkflow));

/** A page of runs (REST `actions/runs`, a workflow's `runs`). */
export const isRunList = object({}, { workflow_runs: maybe(arrayOf(isRun)) });

export const isRuns = arrayOf(isRun);

/** A run's jobs (REST `actions/runs/<id>/jobs`). */
export const isJobList = object({}, { jobs: maybe(arrayOf(isJob)) });

export const isJobs = arrayOf(isJob);

export const isReviewComments = arrayOf(isReviewComment);

/** A file of the repo (REST `contents`): base64. */
export const isFileContent = object({}, { content: text });

const connection = <T>(item: (value: unknown) => value is T) => maybe(object({}, { nodes: maybe(arrayOf(item)) }));

/** The new pull request form's lists: who can be assigned, the labels, the open milestones. */
export const isPrChoices = object({}, {
  viewer: maybe(isActor),
  repository: maybe(object({}, {
    assignableUsers: connection(object({ login: isString }, { name: text })),
    labels: connection(object({ name: isString }, { description: text })),
    milestones: connection(object({ title: isString }, { dueOn: text })),
  })),
});

export type PrChoices = Guarded<typeof isPrChoices>;
