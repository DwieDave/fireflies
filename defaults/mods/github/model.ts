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

/** A pull request as the right panel draws it: `gh pr view --json` (prs.ts VIEW), or its slim copy. */
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

/** Waiting for GitHub to show something it took (a dispatched run, a re-run, a cancel): the wait
 *  before the read after `n` reads that didn't show it yet. 1, 2, 3, 5, 8 s, then every 10 s. */
const BACKOFF = [1000, 2000, 3000, 5000, 8000];

export const soon = (n: number): number => BACKOFF[Math.max(0, n)] ?? 10000;

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

// A workflow's needs and a job's log by its steps live in workflow.ts.
export type { LogLine, NamedJob, Needs, NeedsOf, WorkflowJob } from "./workflow.ts";

export { jobColumns, jobParents, keyOf, logLine, needsFromWorkflow, splitLog } from "./workflow.ts";

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
