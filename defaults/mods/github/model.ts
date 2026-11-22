// What the GitHub window knows about pull requests, runs, jobs, steps and
// checks, as plain functions over gh's JSON: no herdr imports, so scripts/
// tests it. Every answer gh prints is decoded with one of the Schemas here
// (gh.ts names the schema each read's answer must pass): a value of another
// shape is a typed error naming the read, never a value of the wrong type.

import { Array as Arr, Option, Schema, String as Str } from "effect";

export type { LogLine, NamedJob, Needs, NeedsOf, WorkflowJob } from "./workflow.ts";

export { jobColumns, jobParents, keyOf, logLine, needsFromWorkflow, splitLog } from "./workflow.ts";

// ---- shapes

/** A field GitHub may leave out or send as null (and a copy this window slimmed may not have). */
export const maybe = <S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema));

const text = maybe(Schema.String);

const count = maybe(Schema.Finite);

/** How the window colours a run, job, step or check. */
export const ToneSchema = Schema.Literals(["working", "queued", "done", "failed", "skipped", "stopped"]);

export type Tone = typeof ToneSchema.Type;

/** Someone on GitHub (an author, a commenter): GitHub's ghost has no login. */
export const ActorSchema = Schema.Struct({ login: text });

export type Actor = typeof ActorSchema.Type;

export const LabelSchema = Schema.Struct({ name: Schema.String, color: text });

export type Label = typeof LabelSchema.Type;

/** One of a pull request's checks (gh's statusCheckRollup): a check run, or a commit status
 *  (StatusContext: its `context` and `state`). */
export const CheckSchema = Schema.Struct({
  __typename: text, name: text, context: text, workflowName: text, status: text, conclusion: text, state: text,
  detailsUrl: text, targetUrl: text, startedAt: text, completedAt: text,
});

export type Check = typeof CheckSchema.Type;

/** A workflow run (REST `actions/runs`), the fields the window shows. */
export const RunSchema = Schema.Struct({
  id: Schema.Finite, name: text, display_title: text, status: text, conclusion: text, run_number: count, head_branch: text, head_sha: text,
  event: text, path: text, run_started_at: text, updated_at: text, html_url: text, created_at: text,
});

export type Run = typeof RunSchema.Type;

/** A job's step (REST `actions/runs/<id>/jobs`). */
export const StepSchema = Schema.Struct({ number: Schema.Finite, name: Schema.String, status: text, conclusion: text, started_at: text, completed_at: text });

export type Step = typeof StepSchema.Type;

export const JobSchema = Schema.Struct({
  id: Schema.Finite, name: text, status: text, conclusion: text, started_at: text, completed_at: text, html_url: text, steps: maybe(Schema.Array(StepSchema)),
});

export type Job = typeof JobSchema.Type;

/** A comment on a pull request (gh pr view's `comments`). */
const PrCommentSchema = Schema.Struct({ body: text, createdAt: text, url: text, author: maybe(ActorSchema) });

/** A review (gh pr view's `reviews`). */
const ReviewSchema = Schema.Struct({ state: text, body: text, submittedAt: text, author: maybe(ActorSchema) });

/** A pull request as the right panel draws it: `gh pr view --json` (prs.ts VIEW), or its slim copy. */
export const PrViewSchema = Schema.Struct({
  number: Schema.Finite, title: Schema.String,
  body: text, isDraft: maybe(Schema.Boolean), baseRefName: text, headRefName: text, reviewDecision: text, url: text, createdAt: text, updatedAt: text,
  additions: count, deletions: count, changedFiles: count, author: maybe(ActorSchema),
  labels: maybe(Schema.Array(LabelSchema)), statusCheckRollup: maybe(Schema.Array(CheckSchema)), comments: maybe(Schema.Array(PrCommentSchema)),
  reviews: maybe(Schema.Array(ReviewSchema)),
});

export type PrView = typeof PrViewSchema.Type;

/** A review (line) comment (REST `pulls/<n>/comments`). */
export const ReviewCommentSchema = Schema.Struct({
  body: text, created_at: text, path: text, line: count, original_line: count, in_reply_to_id: count, html_url: text, user: maybe(ActorSchema),
});

export type ReviewComment = typeof ReviewCommentSchema.Type;

/** A row of the pull request list, as prRows makes it (and the cache keeps it); `tone` once
 *  its view was read; its checks when a row carries them (a row the list was given whole). */
export const PrRowSchema = Schema.Struct({
  number: Schema.Finite, title: Schema.String, isDraft: Schema.Boolean, headRefName: Schema.NullOr(Schema.String), additions: Schema.Finite,
  deletions: Schema.Finite, reviewDecision: Schema.NullOr(Schema.String), updatedAt: Schema.NullOr(Schema.String), author: Schema.NullOr(ActorSchema),
  labels: Schema.Array(LabelSchema), rollup: Schema.NullOr(Schema.String), tone: maybe(ToneSchema), statusCheckRollup: maybe(Schema.Array(CheckSchema)),
});

export type PrRow = typeof PrRowSchema.Type;

/** A run, job, step or check: what tone() and duration() read. */
export interface Timed {
  readonly status?: string | null | undefined;
  readonly conclusion?: string | null | undefined;
  readonly started_at?: string | null | undefined;
  readonly completed_at?: string | null | undefined;
}

/** A conclusion and the tone it gives. */
const CONCLUDED = new Map<string, Tone>([
  ["success", "done"], ["neutral", "done"], ["failure", "failed"], ["timed_out", "failed"], ["startup_failure", "failed"], ["action_required", "failed"],
  ["skipped", "skipped"], ["cancelled", "stopped"], ["stale", "stopped"],
]);

/** A run's, job's, step's or check's state as one of the window's tones. */
export function tone(status: string | null | undefined, conclusion: string | null | undefined): Tone {
  const s = Str.toLowerCase(status ?? ""), c = Str.toLowerCase(conclusion ?? "");

  if (s === "in_progress") return "working";

  if (s !== "" && s !== "completed") return "queued"; // queued, waiting, pending, requested

  return CONCLUDED.get(c) ?? (s === "completed" ? "done" : "queued");
}

const LIVE = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

/** Poll fast while anything shown still moves, slowly otherwise. */
export const FAST = 3000, SLOW = 60000;

export function pollEvery(items: readonly Timed[] | null | undefined): number {
  return Arr.some(items ?? [], (x) => LIVE.has(Str.toLowerCase(x.status ?? ""))) ? FAST : SLOW;
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
export function parseHeaders(out: string): Answer {
  const cut = Str.search(out, /\r?\n\r?\n/);
  const head = Option.match(cut, { onNone: () => out, onSome: (at) => Str.slice(0, at)(out) });
  const body = Option.match(cut, { onNone: () => "", onSome: (at) => Str.replace(/^\r?\n\r?\n/, "")(Str.slice(at)(out)) });
  const status = Number(/^HTTP\/[\d.]+ (\d+)/.exec(head)?.[1] ?? 0);
  const etag = /^etag:\s*(.+?)\s*$/im.exec(head)?.[1] ?? null;

  return { status, etag, body };
}

/** A time GitHub wrote, in ms (NaN for none). */
const parsed = (v: string | null | undefined): number => (v === null || v === undefined || v === "" ? NaN : Date.parse(v));

const two = (n: number): string => Str.padStart(2, "0")(String(n));

/** "12s", "3m 04s", "1h 02m"; "—" before it started. `now` for still running. */
export function duration(start: string | null | undefined, end: string | null | undefined, now: number): string {
  const a = parsed(start);

  if (!Number.isFinite(a)) return "—";

  const b = end === null || end === undefined || end === "" ? now : Date.parse(end);
  const s = Math.max(0, Math.round((b - a) / 1000));

  if (s < 60) return `${s}s`;

  if (s < 3600) return `${Math.floor(s / 60)}m ${two(s % 60)}s`;

  return `${Math.floor(s / 3600)}h ${two(Math.floor((s % 3600) / 60))}m`;
}

/** "now", "4m", "3h", "2d": how long ago `t` (ms) was at `now`. */
function agoMs(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));

  if (s < 45) return "now";

  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;

  if (s < 86400) return `${Math.round(s / 3600)}h`;

  return `${Math.round(s / 86400)}d`;
}

/** "now", "4m", "3h", "2d": how long ago. */
export function ago(when: string | null | undefined, now: number): string {
  const t = parsed(when);

  return Number.isFinite(t) ? agoMs(t, now) : "";
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

/** The number a link names after `re`'s group, or null. */
const idIn = (re: RegExp, url: string): number | null => {
  const id = re.exec(url)?.[1];

  return id === undefined ? null : Number(id);
};

/** One check (gh's statusCheckRollup) as a row: name, tone, the run it's in. */
function checkRow(c: Check): CheckRow {
  const commit = c.__typename === "StatusContext";
  const status = commit ? (c.state === "PENDING" || c.state === "EXPECTED" ? "pending" : "completed") : c.status;
  const conclusion = commit ? c.state : c.conclusion;
  const url = c.detailsUrl ?? c.targetUrl ?? null;

  return {
    name: c.name ?? c.context ?? "check", workflow: c.workflowName ?? null,
    tone: tone(status, conclusion), status: Str.toLowerCase(status ?? ""),
    runId: idIn(/\/actions\/runs\/(\d+)/, url ?? ""), jobId: idIn(/\/job\/(\d+)/, url ?? ""), url,
    started: c.startedAt ?? null, ended: c.completedAt ?? null,
  };
}

/** A PR's checks (gh's statusCheckRollup) as rows: name, tone, the run it's in. */
export const checkRows = (rollup: readonly Check[] | null | undefined): CheckRow[] => Arr.map(rollup ?? [], checkRow);

const WORST: readonly Tone[] = ["failed", "working", "queued", "done", "stopped", "skipped"];

/** The checks together: the worst tone wins (failed, working, queued, done). */
export function rollupTone(rows: readonly { readonly tone: Tone }[]): Tone | null {
  const tones = new Set(Arr.map(rows, (r) => r.tone));

  return Option.getOrNull(Arr.findFirst(WORST, (t) => tones.has(t)));
}

// ---- the pull request list, in one GraphQL read of only the fields its rows
// show: gh pr list --json statusCheckRollup reads every check of every PR
// (100 contexts each); a row only needs the rollup's state.

const ROW_FIELDS = "number title isDraft headRefName additions deletions reviewDecision updatedAt author { login } labels(first: 8) { nodes { name color } } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }";

export const PR_LIMIT = 60;

/** The list's filters: every open pull request, mine, the ones waiting for my review. */
export const PrFilterSchema = Schema.Literals(["all", "mine", "review"]);

export type PrFilter = typeof PrFilterSchema.Type;

/** A GraphQL variable: its name and value (a number goes as -F, typed). */
export type GqlVar = readonly [name: string, value: string | number];

/** A query and its variables. */
export interface GqlRead {
  readonly query: string;
  readonly vars: readonly GqlVar[];
}

/** The query and variables for a filter's open PRs, newest first (as gh pr list orders them). */
export function prListQuery(filter: PrFilter, full: string, limit = PR_LIMIT): GqlRead {
  const [owner, name = ""] = Str.split(full, "/");

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

/** A GraphQL connection's nodes. */
export const nodesOf = <S extends Schema.Top>(item: S) => maybe(Schema.Struct({ nodes: maybe(Schema.Array(item)) }));

/** A pull request node of prListQuery's answer. */
const PrNodeSchema = Schema.Struct({
  number: Schema.Finite, title: Schema.String,
  isDraft: maybe(Schema.Boolean), headRefName: text, additions: count, deletions: count, reviewDecision: text, updatedAt: text,
  author: maybe(ActorSchema), labels: nodesOf(LabelSchema),
  commits: nodesOf(Schema.Struct({ commit: maybe(Schema.Struct({ statusCheckRollup: maybe(Schema.Struct({ state: text })) })) })),
});

type PrNode = typeof PrNodeSchema.Type;

/** A list whose items are decoded one by one (an issue in a search's answer is an empty node). */
const Items = maybe(Schema.Array(Schema.Unknown));

/** prListQuery's answer: the search's nodes, or the repository's. */
export const PrListSchema = Schema.Struct({
  search: maybe(Schema.Struct({ nodes: Items })),
  repository: maybe(Schema.Struct({ pullRequests: maybe(Schema.Struct({ nodes: Items })) })),
});

export type PrList = typeof PrListSchema.Type;

const prNode = Schema.decodeUnknownOption(PrNodeSchema);

/** A node as a row: { number, title, ..., rollup } (rollup: SUCCESS, FAILURE, PENDING, ...). */
const rowOf = (n: PrNode): PrRow => ({
  number: n.number, title: n.title, isDraft: n.isDraft === true, headRefName: n.headRefName ?? null,
  additions: n.additions ?? 0, deletions: n.deletions ?? 0, reviewDecision: n.reviewDecision ?? null, updatedAt: n.updatedAt ?? null,
  author: n.author === null || n.author === undefined ? null : { login: n.author.login },
  labels: Arr.map(n.labels?.nodes ?? [], (l) => ({ name: l.name, color: l.color })),
  rollup: n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
});

/** The rows of a prListQuery answer; a node of another shape is left out. */
export function prRows(data: PrList | null | undefined): PrRow[] {
  const nodes = data?.search?.nodes ?? data?.repository?.pullRequests?.nodes ?? [];

  return Arr.map(Arr.getSomes(Arr.map(nodes, (n) => prNode(n))), rowOf);
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
  if (p === null || p === undefined) return null;

  if (p.tone !== undefined) return p.tone;

  if (p.statusCheckRollup !== null && p.statusCheckRollup !== undefined) return rollupTone(checkRows(p.statusCheckRollup));

  return ROLLUP.get(p.rollup ?? "") ?? null;
}

/** "just now", "2m ago", "3h ago": when the shown data was read. */
export function readAgo(at: number | null | undefined, now: number): string {
  if (at === null || at === undefined || at === 0) return "";

  const a = agoMs(at, now);

  return a === "now" ? "just now" : `${a} ago`;
}

/** A web link found in some Markdown: where it goes and what it says. */
export interface WebLink {
  readonly url: string;
  readonly label: string;
}

const LINK = /(!?)\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>()[\]"'`]+)/gi;

/** The web links in some Markdown texts, for `L` (the keyboard's way to a
 *  link in a PR or a card): [label](url), <url> and bare http(s) URLs, each
 *  url once, in reading order. Images are left out. */
export function linksIn(texts: readonly (string | null | undefined)[]): WebLink[] {
  const out: WebLink[] = [], seen = new Set<string>();

  const add = (link: string, label?: string) => {
    const url = Str.replace(/[.,;:!?)\]]+$/, "")(link);

    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;

    const said = Str.trim(label ?? "");

    seen.add(url);
    out.push({ url, label: said === "" ? url : said });
  };

  for (const t of texts) {
    const s = Str.replace(/```[\s\S]*?```/g, "")(t ?? "");

    for (const [, bang, label, target, angled, bare] of Str.matchAll(LINK)(s)) {
      if (target !== undefined && target !== "") {
        if (bang !== "!") add(target, label);
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
export const NamedSchema = Schema.Struct({ name: Schema.String });

export const NamedListSchema = Schema.Array(NamedSchema);

/** A repo's deployment environments (REST `environments`). */
export const EnvironmentsSchema = Schema.Struct({ environments: maybe(Schema.Array(NamedSchema)) });

/** A workflow (`gh workflow list --json id,name,path,state`). */
export const WorkflowSchema = Schema.Struct({ id: Schema.Finite, name: Schema.String, path: Schema.String, state: Schema.String });

export type Workflow = typeof WorkflowSchema.Type;

/** `gh workflow list` prints nothing (null) when there are none. */
export const WorkflowsSchema = Schema.NullOr(Schema.Array(WorkflowSchema));

/** A page of runs (REST `actions/runs`, a workflow's `runs`). */
export const RunListSchema = Schema.Struct({ workflow_runs: maybe(Schema.Array(RunSchema)) });

export const RunsSchema = Schema.Array(RunSchema);

/** A run's jobs (REST `actions/runs/<id>/jobs`). */
export const JobListSchema = Schema.Struct({ jobs: maybe(Schema.Array(JobSchema)) });

export const JobsSchema = Schema.Array(JobSchema);

export const ReviewCommentsSchema = Schema.Array(ReviewCommentSchema);

/** A file of the repo (REST `contents`): base64. */
export const FileContentSchema = Schema.Struct({ content: text });

/** The new pull request form's lists: who can be assigned, the labels, the open milestones. */
export const PrChoicesSchema = Schema.Struct({
  viewer: maybe(ActorSchema),
  repository: maybe(Schema.Struct({
    assignableUsers: nodesOf(Schema.Struct({ login: Schema.String, name: text })),
    labels: nodesOf(Schema.Struct({ name: Schema.String, description: text })),
    milestones: nodesOf(Schema.Struct({ title: Schema.String, dueOn: text })),
  })),
});

export type PrChoices = typeof PrChoicesSchema.Type;

// ---- guards over the schemas, for the readers that still take guards (gh.ts api, graphql)

export const isTone = Schema.is(ToneSchema);
export const isActor = Schema.is(ActorSchema);
export const isLabel = Schema.is(LabelSchema);
export const isCheck = Schema.is(CheckSchema);
export const isRun = Schema.is(RunSchema);
export const isStep = Schema.is(StepSchema);
export const isJob = Schema.is(JobSchema);
export const isPrView = Schema.is(PrViewSchema);
export const isReviewComment = Schema.is(ReviewCommentSchema);
export const isPrRow = Schema.is(PrRowSchema);
export const isPrFilter = Schema.is(PrFilterSchema);
export const isPrList = Schema.is(PrListSchema);
export const isNamed = Schema.is(NamedSchema);
export const isNamedList = Schema.is(NamedListSchema);
export const isEnvironments = Schema.is(EnvironmentsSchema);
export const isWorkflow = Schema.is(WorkflowSchema);
export const isWorkflows = Schema.is(WorkflowsSchema);
export const isRunList = Schema.is(RunListSchema);
export const isRuns = Schema.is(RunsSchema);
export const isJobList = Schema.is(JobListSchema);
export const isJobs = Schema.is(JobsSchema);
export const isReviewComments = Schema.is(ReviewCommentsSchema);
export const isFileContent = Schema.is(FileContentSchema);
export const isPrChoices = Schema.is(PrChoicesSchema);
