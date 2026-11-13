// What the GitHub window keeps between openings: the last pull requests,
// PR details, runs, jobs, workflow needs and project boards it read, per repo, so a window
// shows them at once and reads GitHub again behind them (store.ts writes it
// to the app's data folder). Plain functions over plain JSON: no herdr
// imports, so scripts/ tests it.
//
// Only what the window draws is kept (slim*), the file stays under a byte
// budget (fit), the least recently opened repos go first (prune), and
// nothing that looks like a credential is ever written (scrub).
//
// The document is JSON as it is on disk, proven by isDoc where it's read
// (parse): its folders and repos, and in each repo's entry the pieces
// (a list, a PR's view, a run's jobs, a board) with when they were read
// (`at`). What a piece holds is proven where a tab reads it back
// (prs.ts, actions.ts, projects.ts hydrate), one piece at a time.

import type { Guarded } from "./guard.ts";
import { isNumber, isString, literal, nullable, object, parseJson } from "./guard.ts";
import type { Json, JsonMap } from "./guards.ts";
import { isJson, isJsonList, isJsonObject, mapOf, maybe } from "./guards.ts";
import type { Actor, Check, Job, Label, PrRow, PrView, ReviewComment, Run, Step } from "./model.ts";

// 2: the repo is picked from the folder's remotes (remotes.ts); v1 could hold a fork's parent for it.
export const VERSION = 2;

// readTextFile/writeTextFile stop at 1 MiB; stay well under it.
export const MAX_BYTES = 768 * 1024;

/** How many of each piece are kept. */
export const LIMITS = { repos: 8, details: 16, jobs: 10, needs: 12, lists: 3, runs: 4, boards: 3 } as const;

/** A piece of a repo's entry (a list, a PR's view, a run's jobs, a board): when it was read.
 *  What else it holds is proven where it's read back. */
export const isPiece = object({}, { at: maybe(isNumber) });

export type Piece = Guarded<typeof isPiece>;

const pieces = maybe(mapOf(isPiece));

/** A repo as the cache keeps it (slimRepo): parent, the repo it forks; child, the fork the window
 *  came from (p switched to the parent). */
export const isRepoRecord = object({
  owner: isString, name: isString, full: isString, host: isString, root: isString, on: nullable(isString), url: nullable(isString),
  base: nullable(isString), branch: nullable(isString), parent: nullable(isString), child: nullable(isString),
});

export type RepoRecord = Guarded<typeof isRepoRecord>;

/** A repo's entry: when it was last opened, the repo, and each tab's pieces by key. */
export const isEntry = object({}, {
  at: maybe(isNumber),
  repo: maybe(isRepoRecord),
  prs: maybe(object({}, { lists: pieces, details: pieces })),
  actions: maybe(object({}, { runs: pieces, jobs: pieces, needs: pieces })),
  projects: maybe(object({}, { list: maybe(isPiece), boards: pieces })),
});

export type Entry = Guarded<typeof isEntry>;

/** The whole file: each folder's repo (its key), each repo's entry. */
export const isDoc = object({ v: literal(VERSION), folders: mapOf(isString), repos: mapOf(isEntry) });

export type Doc = Guarded<typeof isDoc>;

/** An empty cache document. */
export const blank = (): Doc => ({ v: VERSION, folders: {}, repos: {} });

/** A cache document read from disk, or a blank one when it's missing, broken or old. */
export function parse(text: string | null | undefined): Doc {
  return parseJson(text ?? "", isDoc) ?? blank();
}

/** What a key is made of: the machine and the repo (or the folder). */
interface Keyed {
  readonly on?: string | null | undefined;
  readonly full?: string | null | undefined;
}

export const repoKey = (repo: Keyed | null | undefined): string => `${repo?.on ?? ""}|${repo?.full ?? ""}`;

export const folderKey = (folder: string | null | undefined, on: string | null | undefined): string => `${on ?? ""}|${folder ?? ""}`;

/** The repo entry a space's folder last showed (its repo and data), or null. */
export function lookup(doc: Doc | null | undefined, folder: string | null | undefined, on: string | null | undefined): Entry | null {
  const key = doc?.folders[folderKey(folder, on)];

  return key ? doc?.repos[key] ?? null : null;
}

/** A repo as gh.ts hands it over (what slimRepo keeps of it). */
export interface RepoLike {
  readonly owner: string;
  readonly name: string;
  readonly full: string;
  readonly host?: string | null | undefined;
  readonly root: string;
  readonly on?: string | null | undefined;
  readonly url?: string | null | undefined;
  readonly base?: string | null | undefined;
  readonly branch?: string | null | undefined;
  readonly parent?: string | null | undefined;
  readonly child?: string | null | undefined;
}

/** A fresh entry for a repo. */
export const entryFor = (repo: RepoLike) => ({
  at: 0, repo: slimRepo(repo), prs: { lists: {}, details: {} }, actions: { runs: {}, jobs: {}, needs: {} }, projects: { list: null, boards: {} },
});

// ---- slim: only the fields the window shows

const login = (a: Actor | null | undefined): Actor | null => (a ? { login: a.login ?? null } : null);

const label = (l: Label): Label => ({ name: l.name, color: l.color });

export function slimRepo(r: RepoLike | null | undefined): RepoRecord | null {
  if (!r) return null;

  // parent: the repo this one forks; child: the fork the window came from (p switched to the parent).
  return {
    owner: r.owner, name: r.name, full: r.full, host: r.host ?? "github.com", root: r.root, on: r.on ?? null, url: scrubUrl(r.url),
    base: r.base ?? null, branch: r.branch ?? null, parent: r.parent ?? null, child: r.child ?? null,
  };
}

/** A pull request's row in the list. */
export function slimPrRow(p: PrRow): PrRow {
  return {
    number: p.number, title: p.title, isDraft: p.isDraft, headRefName: p.headRefName, additions: p.additions, deletions: p.deletions,
    reviewDecision: p.reviewDecision, updatedAt: p.updatedAt, rollup: p.rollup, tone: p.tone, author: login(p.author), labels: p.labels.map(label),
  };
}

const slimCheck = (c: Check): Check => ({
  __typename: c.__typename, name: c.name, context: c.context, workflowName: c.workflowName, status: c.status, conclusion: c.conclusion,
  state: c.state, detailsUrl: c.detailsUrl, targetUrl: c.targetUrl, startedAt: c.startedAt, completedAt: c.completedAt,
});

/** A pull request as the right panel draws it (gh pr view's JSON). */
export function slimPr(pr: PrView | null | undefined): PrView | null {
  if (!pr) return null;

  return {
    number: pr.number, title: pr.title, body: pr.body, isDraft: pr.isDraft, baseRefName: pr.baseRefName, headRefName: pr.headRefName,
    reviewDecision: pr.reviewDecision, url: pr.url, createdAt: pr.createdAt, updatedAt: pr.updatedAt, additions: pr.additions,
    deletions: pr.deletions, changedFiles: pr.changedFiles,
    author: login(pr.author),
    labels: (pr.labels ?? []).map(label),
    statusCheckRollup: (pr.statusCheckRollup ?? []).map(slimCheck),
    comments: (pr.comments ?? []).map((c) => ({ body: c.body, createdAt: c.createdAt, url: c.url, author: login(c.author) })),
    reviews: (pr.reviews ?? []).map((r) => ({ state: r.state, body: r.body, submittedAt: r.submittedAt, author: login(r.author) })),
  };
}

/** A review (line) comment, from the REST API. */
export function slimReviewComment(c: ReviewComment): ReviewComment {
  return {
    body: c.body, created_at: c.created_at, path: c.path, line: c.line, original_line: c.original_line, in_reply_to_id: c.in_reply_to_id,
    html_url: c.html_url, user: login(c.user),
  };
}

/** A workflow run, from the REST API (its full answer is ~12 KB a run). */
export function slimRun(r: Run): Run {
  return {
    id: r.id, name: r.name, display_title: r.display_title, status: r.status, conclusion: r.conclusion, run_number: r.run_number,
    head_branch: r.head_branch, head_sha: r.head_sha, event: r.event, path: r.path, run_started_at: r.run_started_at,
    updated_at: r.updated_at, html_url: r.html_url,
  };
}

const slimStep = (s: Step): Step => ({
  number: s.number, name: s.name, status: s.status, conclusion: s.conclusion, started_at: s.started_at, completed_at: s.completed_at,
});

export function slimJob(j: Job): Job {
  return {
    id: j.id, name: j.name, status: j.status, conclusion: j.conclusion, started_at: j.started_at, completed_at: j.completed_at,
    html_url: j.html_url, steps: (j.steps ?? []).map(slimStep),
  };
}

// ---- secrets: never written

const SECRET_KEY = /^(token|access_?token|refresh_?token|oauth_?token|authorization|auth|password|passwd|secret|client_?secret|private_?key|api_?key|cookie)$/i;
const SECRET_TEXT = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;

/** A URL without user:password@ in it. */
export function scrubUrl(u: string | null | undefined): string | null {
  return isString(u) ? u.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, "$1") : u ?? null;
}

/** A copy without credential-named keys, GitHub tokens or URL credentials. */
export function scrub(v: Json): Json {
  if (isString(v)) return (scrubUrl(v) ?? "").replace(SECRET_TEXT, "[redacted]");

  if (isJsonList(v)) return v.map(scrub);

  if (!isJsonObject(v)) return v;

  return Object.fromEntries(Object.entries(v).flatMap(([k, x]): [string, Json][] => (x === undefined || SECRET_KEY.test(k) ? [] : [[k, scrub(x)]])));
}

// ---- bounds

/** Keeps the newest `n` entries of an object of { at } values. */
export function newest<T extends Piece>(obj: JsonMap<T> | null | undefined, n: number): JsonMap<T> {
  const kept = Object.entries(obj ?? {}).sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0)).slice(0, Math.max(0, n));

  return Object.fromEntries(kept);
}

/** How many of each piece prune keeps. */
export type Limits = { readonly [K in keyof typeof LIMITS]: number };

function pruneEntry(e: Entry, limits: Limits): Entry {
  const kept: Entry = {
    ...e,
    prs: { lists: newest(e.prs?.lists, limits.lists), details: newest(e.prs?.details, limits.details) },
    actions: { runs: newest(e.actions?.runs, limits.runs), jobs: newest(e.actions?.jobs, limits.jobs), needs: newest(e.actions?.needs, limits.needs) },
  };

  // Projects (projects.ts): the picker's list and the last boards opened.
  return e.projects ? { ...kept, projects: { list: e.projects.list ?? null, boards: newest(e.projects.boards, limits.boards) } } : kept;
}

/** Bounds every part of the document by count: the last repos opened, and in each the newest details, jobs, needs, lists. */
export function prune(doc: Doc, limits: Limits = LIMITS): Doc {
  const repos = Object.fromEntries(Object.entries(newest(doc.repos, limits.repos)).flatMap(([k, e]): [string, Entry][] => (e ? [[k, pruneEntry(e, limits)]] : [])));
  const folders = Object.fromEntries(Object.entries(doc.folders).flatMap(([f, k]): [string, string][] => (k !== undefined && repos[k] ? [[f, k]] : [])));

  return { v: VERSION, folders, repos };
}

/** A kind of piece, in the order fit drops them (oldest first within it). */
type Which = "prs.details" | "projects.boards" | "prs.lists" | "actions.jobs" | "actions.needs" | "actions.runs";

const WHICH: readonly Which[] = ["prs.details", "projects.boards", "prs.lists", "actions.jobs", "actions.needs", "actions.runs"];

/** An entry's pieces of one kind. */
function piecesOf(e: Entry, which: Which): JsonMap<Piece> {
  switch (which) {
    case "prs.details": return e.prs?.details ?? {};
    case "prs.lists": return e.prs?.lists ?? {};
    case "projects.boards": return e.projects?.boards ?? {};
    case "actions.jobs": return e.actions?.jobs ?? {};
    case "actions.needs": return e.actions?.needs ?? {};
    case "actions.runs": return e.actions?.runs ?? {};
  }
}

/** The entry with its pieces of one kind replaced. */
function withPieces(e: Entry, which: Which, map: JsonMap<Piece>): Entry {
  switch (which) {
    case "prs.details": return { ...e, prs: { ...e.prs, details: map } };
    case "prs.lists": return { ...e, prs: { ...e.prs, lists: map } };
    case "projects.boards": return e.projects ? { ...e, projects: { ...e.projects, boards: map } } : e;
    case "actions.jobs": return { ...e, actions: { ...e.actions, jobs: map } };
    case "actions.needs": return { ...e, actions: { ...e.actions, needs: map } };
    case "actions.runs": return { ...e, actions: { ...e.actions, runs: map } };
  }
}

/** Something fit can drop: a whole repo (no `which`), or one piece of it. */
interface Droppable {
  readonly at: number;
  readonly repo: string;
  readonly which?: Which;
  readonly id?: string;
}

const dropKey = (repo: string, which: Which | "", id: string) => JSON.stringify([repo, which, id]);

/** The document without what was dropped. */
function without(doc: Doc, dropped: ReadonlySet<string>): Doc {
  const repos = Object.entries(doc.repos).flatMap(([k, e]): [string, Entry][] => {
    if (!e || dropped.has(dropKey(k, "", ""))) return [];

    let kept = e;

    for (const which of WHICH) {
      const all = piecesOf(e, which);
      const left = Object.fromEntries(Object.entries(all).filter(([id]) => !dropped.has(dropKey(k, which, id))));

      if (Object.keys(left).length !== Object.keys(all).length) kept = withPieces(kept, which, left);
    }

    return [[k, kept]];
  });

  return { ...doc, repos: Object.fromEntries(repos) };
}

/** The document as text under `max` bytes: drops the oldest pieces (whole repos
 *  other than `keep`, then details, jobs, needs, lists) until it fits. */
export function fit(doc: Doc, max = MAX_BYTES, keep: string | null = null): string {
  let d = prune(doc);
  let text = JSON.stringify(d);

  if (bytes(text) <= max) return text;

  const pieces: Droppable[] = [];

  for (const [k, e] of Object.entries(d.repos)) {
    if (!e) continue;

    if (k !== keep) pieces.push({ at: e.at ?? 0, repo: k });

    for (const which of WHICH) for (const [id, x] of Object.entries(piecesOf(e, which))) pieces.push({ at: x?.at ?? 0, repo: k, which, id });
  }

  pieces.sort((a, b) => a.at - b.at);

  // Drop in growing batches: each round costs one stringify.
  const dropped = new Set<string>();
  const batch = Math.max(1, Math.ceil(pieces.length / 16));

  for (let i = 0; i < pieces.length; i += batch) {
    for (const p of pieces.slice(i, i + batch)) dropped.add(dropKey(p.repo, p.which ?? "", p.id ?? ""));

    d = prune(without(d, dropped));
    text = JSON.stringify(d);

    if (bytes(text) <= max) return text;
  }

  return JSON.stringify(blank());
}

/** A text's length in UTF-8 bytes. */
function bytes(s: string): number {
  let n = 0;

  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);

    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00) {
      // A surrogate pair: one character of 4 bytes.
      n += 4;
      i++;
    } else n += 3;
  }

  return n;
}

/** What merge writes for a repo: anything this window keeps of it, with its repo. */
export interface Written {
  readonly repo?: RepoRecord | null | undefined;
}

/** Puts this window's entry for `repo` (seen in `folder`) into the document read from disk:
 *  other repos (other windows') stay as they are. Returns the text to write. */
export function merge(disk: string | Doc | null | undefined, folder: string | null | undefined, entry: Written, now = Date.now(), max = MAX_BYTES): string {
  const d = isString(disk) ? parse(disk) : disk ?? blank();
  const key = repoKey(entry.repo);
  // Written as JSON, read back as JSON, scrubbed, and proven an entry before it goes in.
  const json = parseJson(JSON.stringify({ ...entry, at: now }), isJson);
  const clean = json === undefined ? undefined : scrub(json);

  if (!isEntry(clean)) return fit(d, max, key);

  const repos = { ...d.repos, [key]: clean };
  const folders = folder ? { ...d.folders, [folderKey(folder, entry.repo?.on)]: key } : d.folders;

  return fit({ v: VERSION, folders, repos }, max, key);
}
