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
// The file is JSON objects keyed by data (folders, repos, list filters, PR
// numbers, run ids, boards): proven by isStoredDoc where it's read (parse)
// and turned into Maps there (docOf); written back as objects (textOf). In
// between the document is Maps. A piece of an entry (a list, a PR's view, a
// run's jobs, a board) is known here only by when it was read (`at`): what
// it holds is proven where a tab reads it back (prs.ts, actions.ts,
// projects.ts hydrate), one piece at a time.

import type { Guarded } from "./guard.ts";
import { isNumber, isString, literal, nullable, object, parseJson } from "./guard.ts";
import type { Json, JsonMap } from "./guards.ts";
import { isJson, isJsonList, isJsonObject, mapOf, maybe, toJson, toMap } from "./guards.ts";
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

/** A part's pieces by key (a filter, a PR number, a run id, a project id). */
export type Pieces = ReadonlyMap<string, Piece>;

/** A repo as the cache keeps it (slimRepo): parent, the repo it forks; child, the fork the window
 *  came from (p switched to the parent). */
export const isRepoRecord = object({
  owner: isString, name: isString, full: isString, host: isString, root: isString, on: nullable(isString), url: nullable(isString),
  base: nullable(isString), branch: nullable(isString), parent: nullable(isString), child: nullable(isString),
});

export type RepoRecord = Guarded<typeof isRepoRecord>;

/** A repo's entry: when it was last opened, the repo, and each tab's pieces by key. */
export interface Entry {
  readonly at?: number | null | undefined;
  readonly repo?: RepoRecord | null | undefined;
  readonly prs?: { readonly lists?: Pieces | undefined; readonly details?: Pieces | undefined } | null | undefined;
  readonly actions?: { readonly runs?: Pieces | undefined; readonly jobs?: Pieces | undefined; readonly needs?: Pieces | undefined } | null | undefined;
  readonly projects?: { readonly list?: Piece | null | undefined; readonly boards?: Pieces | undefined } | null | undefined;
}

/** The whole document: each folder's repo (its key), each repo's entry. */
export interface Doc {
  readonly v: typeof VERSION;
  readonly folders: ReadonlyMap<string, string>;
  readonly repos: ReadonlyMap<string, Entry>;
}

// ---- the file: objects keyed by data, as they are on disk

const stored = maybe(mapOf(isPiece));

/** An entry as the file holds it. */
const isStoredEntry = object({}, {
  at: maybe(isNumber),
  repo: maybe(isRepoRecord),
  prs: maybe(object({}, { lists: stored, details: stored })),
  actions: maybe(object({}, { runs: stored, jobs: stored, needs: stored })),
  projects: maybe(object({}, { list: maybe(isPiece), boards: stored })),
});

type StoredEntry = Guarded<typeof isStoredEntry>;

/** The file. */
const isStoredDoc = object({ v: literal(VERSION), folders: mapOf(isString), repos: mapOf(isStoredEntry) });

type StoredDoc = Guarded<typeof isStoredDoc>;

const maps = (json: JsonMap<Piece> | null | undefined): Pieces | undefined => (json ? toMap(json) : undefined);

const jsons = (map: Pieces | undefined): JsonMap<Piece> | undefined => (map ? toJson(map) : undefined);

/** An entry read from the file. */
function entryOf(e: StoredEntry): Entry {
  return {
    at: e.at, repo: e.repo,
    prs: e.prs && { lists: maps(e.prs.lists), details: maps(e.prs.details) },
    actions: e.actions && { runs: maps(e.actions.runs), jobs: maps(e.actions.jobs), needs: maps(e.actions.needs) },
    projects: e.projects && { list: e.projects.list, boards: maps(e.projects.boards) },
  };
}

/** An entry as the file holds it. */
function storedEntry(e: Entry): StoredEntry {
  return {
    at: e.at, repo: e.repo,
    prs: e.prs && { lists: jsons(e.prs.lists), details: jsons(e.prs.details) },
    actions: e.actions && { runs: jsons(e.actions.runs), jobs: jsons(e.actions.jobs), needs: jsons(e.actions.needs) },
    projects: e.projects && { list: e.projects.list, boards: jsons(e.projects.boards) },
  };
}

const docOf = (d: StoredDoc): Doc => ({ v: d.v, folders: toMap(d.folders), repos: new Map([...toMap(d.repos)].map(([k, e]) => [k, entryOf(e)])) });

/** The document as the file's text. */
export const textOf = (d: Doc): string => JSON.stringify({ v: d.v, folders: toJson(d.folders), repos: toJson(new Map([...d.repos].map(([k, e]) => [k, storedEntry(e)]))) });

/** An empty cache document. */
export const blank = (): Doc => ({ v: VERSION, folders: new Map(), repos: new Map() });

/** A cache document read from disk, or a blank one when it's missing, broken or old. */
export function parse(text: string | null | undefined): Doc {
  const d = parseJson(text ?? "", isStoredDoc);

  return d ? docOf(d) : blank();
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
  const key = doc?.folders.get(folderKey(folder, on));

  return key ? doc?.repos.get(key) ?? null : null;
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
export const entryFor = (repo: RepoLike): Entry => ({
  at: 0, repo: slimRepo(repo), prs: { lists: new Map(), details: new Map() }, actions: { runs: new Map(), jobs: new Map(), needs: new Map() },
  projects: { list: null, boards: new Map() },
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

/** Keeps the newest `n` entries of a map of { at } values. */
export function newest<K, T extends Piece>(map: ReadonlyMap<K, T> | null | undefined, n: number): Map<K, T> {
  return new Map([...(map ?? [])].sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).slice(0, Math.max(0, n)));
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
  const repos = new Map([...newest(doc.repos, limits.repos)].map(([k, e]) => [k, pruneEntry(e, limits)]));
  const folders = new Map([...doc.folders].filter(([, k]) => repos.has(k)));

  return { v: VERSION, folders, repos };
}

/** A kind of piece, in the order fit drops them (oldest first within it). */
type Which = "prs.details" | "projects.boards" | "prs.lists" | "actions.jobs" | "actions.needs" | "actions.runs";

const WHICH: readonly Which[] = ["prs.details", "projects.boards", "prs.lists", "actions.jobs", "actions.needs", "actions.runs"];

const NONE: Pieces = new Map();

/** An entry's pieces of one kind. */
function piecesOf(e: Entry, which: Which): Pieces {
  switch (which) {
    case "prs.details": return e.prs?.details ?? NONE;
    case "prs.lists": return e.prs?.lists ?? NONE;
    case "projects.boards": return e.projects?.boards ?? NONE;
    case "actions.jobs": return e.actions?.jobs ?? NONE;
    case "actions.needs": return e.actions?.needs ?? NONE;
    case "actions.runs": return e.actions?.runs ?? NONE;
  }
}

/** The entry with its pieces of one kind replaced. */
function withPieces(e: Entry, which: Which, map: Pieces): Entry {
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
  const repos = new Map<string, Entry>();

  for (const [k, e] of doc.repos) {
    if (dropped.has(dropKey(k, "", ""))) continue;

    let kept = e;

    for (const which of WHICH) {
      const all = piecesOf(e, which);
      const left = new Map([...all].filter(([id]) => !dropped.has(dropKey(k, which, id))));

      if (left.size !== all.size) kept = withPieces(kept, which, left);
    }

    repos.set(k, kept);
  }

  return { ...doc, repos };
}

/** The document as text under `max` bytes: drops the oldest pieces (whole repos
 *  other than `keep`, then details, jobs, needs, lists) until it fits. */
export function fit(doc: Doc, max = MAX_BYTES, keep: string | null = null): string {
  let d = prune(doc);
  let text = textOf(d);

  if (bytes(text) <= max) return text;

  const pieces: Droppable[] = [];

  for (const [k, e] of d.repos) {
    if (k !== keep) pieces.push({ at: e.at ?? 0, repo: k });

    for (const which of WHICH) for (const [id, x] of piecesOf(e, which)) pieces.push({ at: x.at ?? 0, repo: k, which, id });
  }

  pieces.sort((a, b) => a.at - b.at);

  // Drop in growing batches: each round costs one stringify.
  const dropped = new Set<string>();
  const batch = Math.max(1, Math.ceil(pieces.length / 16));

  for (let i = 0; i < pieces.length; i += batch) {
    for (const p of pieces.slice(i, i + batch)) dropped.add(dropKey(p.repo, p.which ?? "", p.id ?? ""));

    d = prune(without(d, dropped));
    text = textOf(d);

    if (bytes(text) <= max) return text;
  }

  return textOf(blank());
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

/** Puts this window's entry for `repo` (seen in `folder`) into the document read from disk:
 *  other repos (other windows') stay as they are. Returns the text to write. */
export function merge(disk: string | Doc | null | undefined, folder: string | null | undefined, entry: Entry, now = Date.now(), max = MAX_BYTES): string {
  const d = isString(disk) ? parse(disk) : disk ?? blank();
  const key = repoKey(entry.repo);
  // Written as the file holds it, read back as JSON, scrubbed, and proven an entry before it goes in.
  const json = parseJson(JSON.stringify({ ...storedEntry(entry), at: now }), isJson);
  const clean = json === undefined ? undefined : scrub(json);

  if (!isStoredEntry(clean)) return fit(d, max, key);

  const repos = new Map(d.repos).set(key, entryOf(clean));
  const folders = folder ? new Map(d.folders).set(folderKey(folder, entry.repo?.on), key) : d.folders;

  return fit({ v: VERSION, folders, repos }, max, key);
}
