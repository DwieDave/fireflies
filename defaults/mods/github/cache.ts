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
// numbers, run ids, boards): decoded by StoredDocSchema where it's read (parse)
// and turned into Maps there (docOf); written back as objects (textOf). In
// between the document is Maps. A piece of an entry (a list, a PR's view, a
// run's jobs, a board) is known here only by when it was read (`at`): what
// it holds is proven where a tab reads it back (prs.ts, actions.ts,
// projects.ts hydrate), one piece at a time.

import { Array as Arr, Option, Order, Predicate, Record as Rec, Schema, String as Str } from "effect";
import type { Actor, Check, Job, Label, PrRow, PrView, ReviewComment, Run, Step } from "./model.ts";
import { maybe } from "./model.ts";

// 2: the repo is picked from the folder's remotes (remotes.ts); v1 could hold a fork's parent for it.
export const VERSION = 2;

// readTextFile/writeTextFile stop at 1 MiB; stay well under it.
export const MAX_BYTES = 768 * 1024;

/** How many of each piece are kept. */
export const LIMITS = { repos: 8, details: 16, jobs: 10, needs: 12, lists: 3, runs: 4, boards: 3 } as const;

/** A piece of a repo's entry (a list, a PR's view, a run's jobs, a board): when it was read.
 *  What else it holds is decoded where it's read back (its other fields are kept as they are). */
const PieceSchema = Schema.StructWithRest(Schema.Struct({ at: maybe(Schema.Finite) }), [Schema.Record(Schema.String, Schema.Unknown)]);

/** A piece as the cache handles it: only its `at` is known here. */
export interface Piece {
  readonly at?: number | null | undefined;
}

/** A part's pieces by key (a filter, a PR number, a run id, a project id). */
export type Pieces = ReadonlyMap<string, Piece>;

/** A repo as the cache keeps it (slimRepo): parent, the repo it forks; child, the fork the window
 *  came from (p switched to the parent). */
export const RepoRecordSchema = Schema.Struct({
  owner: Schema.String, name: Schema.String, full: Schema.String, host: Schema.String, root: Schema.String, on: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String), base: Schema.NullOr(Schema.String), branch: Schema.NullOr(Schema.String), parent: Schema.NullOr(Schema.String),
  child: Schema.NullOr(Schema.String),
});

export type RepoRecord = typeof RepoRecordSchema.Type;

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

/** A JSON object keyed by data (ids, numbers, folders), each value a piece. */
const stored = maybe(Schema.Record(Schema.String, PieceSchema));

/** An entry as the file holds it. */
const StoredEntrySchema = Schema.Struct({
  at: maybe(Schema.Finite),
  repo: maybe(RepoRecordSchema),
  prs: maybe(Schema.Struct({ lists: stored, details: stored })),
  actions: maybe(Schema.Struct({ runs: stored, jobs: stored, needs: stored })),
  projects: maybe(Schema.Struct({ list: maybe(PieceSchema), boards: stored })),
});

type StoredEntry = typeof StoredEntrySchema.Type;

/** The file. */
const StoredDocSchema = Schema.Struct({
  v: Schema.Literal(VERSION), folders: Schema.Record(Schema.String, Schema.String), repos: Schema.Record(Schema.String, StoredEntrySchema),
});

type StoredDoc = typeof StoredDocSchema.Type;

/** A JSON object keyed by data. */
type JsonMap<T> = { readonly [key: string]: T };

const toMap = <T>(json: JsonMap<T>): Map<string, T> => new Map(Rec.toEntries(json));

const toJson = <T>(map: ReadonlyMap<string, T>): JsonMap<T> => Rec.fromEntries(Arr.fromIterable(map));

const maps = (json: JsonMap<Piece> | null | undefined): Pieces | undefined => (json === null || json === undefined ? undefined : toMap(json));

const jsons = (map: Pieces | undefined): JsonMap<Piece> | undefined => (map === undefined ? undefined : toJson(map));

/** An entry read from the file. */
function entryOf(e: StoredEntry): Entry {
  return {
    at: e.at, repo: e.repo,
    prs: e.prs && { lists: maps(e.prs.lists), details: maps(e.prs.details) },
    actions: e.actions && { runs: maps(e.actions.runs), jobs: maps(e.actions.jobs), needs: maps(e.actions.needs) },
    projects: e.projects && { list: e.projects.list, boards: maps(e.projects.boards) },
  };
}

/** An entry as the file holds it (its pieces as they are: JSON text keeps what they hold). */
function storedEntry(e: Entry) {
  return {
    at: e.at, repo: e.repo,
    prs: e.prs && { lists: jsons(e.prs.lists), details: jsons(e.prs.details) },
    actions: e.actions && { runs: jsons(e.actions.runs), jobs: jsons(e.actions.jobs), needs: jsons(e.actions.needs) },
    projects: e.projects && { list: e.projects.list, boards: jsons(e.projects.boards) },
  };
}

const docOf = (d: StoredDoc): Doc => ({ v: d.v, folders: toMap(d.folders), repos: new Map(Arr.map(Rec.toEntries(d.repos), ([k, e]) => [k, entryOf(e)] as const)) });

/** A value as JSON text (what JSON.stringify writes: undefined fields left out); none for a value JSON can't hold. */
const jsonText = Schema.encodeOption(Schema.fromJsonString(Schema.Unknown));

/** JSON text as a JSON value; none for text that isn't JSON. */
const jsonValue = Schema.decodeOption(Schema.fromJsonString(Schema.Json));

/** The document as the file's text. */
export const textOf = (d: Doc): string => Option.getOrElse(jsonText({
  v: d.v, folders: toJson(d.folders), repos: toJson(new Map(Arr.map(Arr.fromIterable(d.repos), ([k, e]) => [k, storedEntry(e)] as const))),
}), () => `{"v":${VERSION},"folders":{},"repos":{}}`);

/** An empty cache document. */
export const blank = (): Doc => ({ v: VERSION, folders: new Map(), repos: new Map() });

const storedDoc = Schema.decodeOption(Schema.fromJsonString(StoredDocSchema));

/** A cache document read from disk, or a blank one when it's missing, broken or old. */
export function parse(text: string | null | undefined): Doc {
  return Option.match(storedDoc(text ?? ""), { onNone: blank, onSome: docOf });
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

  return key === undefined ? null : doc?.repos.get(key) ?? null;
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

const login = (a: Actor | null | undefined): Actor | null => (a === null || a === undefined ? null : { login: a.login ?? null });

const label = (l: Label): Label => ({ name: l.name, color: l.color });

export function slimRepo(r: RepoLike | null | undefined): RepoRecord | null {
  if (r === null || r === undefined) return null;

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
    reviewDecision: p.reviewDecision, updatedAt: p.updatedAt, rollup: p.rollup, tone: p.tone, author: login(p.author), labels: Arr.map(p.labels, label),
  };
}

const slimCheck = (c: Check): Check => ({
  __typename: c.__typename, name: c.name, context: c.context, workflowName: c.workflowName, status: c.status, conclusion: c.conclusion,
  state: c.state, detailsUrl: c.detailsUrl, targetUrl: c.targetUrl, startedAt: c.startedAt, completedAt: c.completedAt,
});

/** A pull request as the right panel draws it (gh pr view's JSON). */
export function slimPr(pr: PrView | null | undefined): PrView | null {
  if (pr === null || pr === undefined) return null;

  return {
    number: pr.number, title: pr.title, body: pr.body, isDraft: pr.isDraft, baseRefName: pr.baseRefName, headRefName: pr.headRefName,
    reviewDecision: pr.reviewDecision, url: pr.url, createdAt: pr.createdAt, updatedAt: pr.updatedAt, additions: pr.additions,
    deletions: pr.deletions, changedFiles: pr.changedFiles,
    author: login(pr.author),
    labels: Arr.map(pr.labels ?? [], label),
    statusCheckRollup: Arr.map(pr.statusCheckRollup ?? [], slimCheck),
    comments: Arr.map(pr.comments ?? [], (c) => ({ body: c.body, createdAt: c.createdAt, url: c.url, author: login(c.author) })),
    reviews: Arr.map(pr.reviews ?? [], (r) => ({ state: r.state, body: r.body, submittedAt: r.submittedAt, author: login(r.author) })),
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
    html_url: j.html_url, steps: Arr.map(j.steps ?? [], slimStep),
  };
}

// ---- secrets: never written

const SECRET_KEY = /^(token|access_?token|refresh_?token|oauth_?token|authorization|auth|password|passwd|secret|client_?secret|private_?key|api_?key|cookie)$/i;
const SECRET_TEXT = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;

const withoutUser = Str.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, "$1");

/** A URL without user:password@ in it. */
export function scrubUrl(u: string | null | undefined): string | null {
  return u === null || u === undefined ? null : withoutUser(u);
}

/** A copy without credential-named keys, GitHub tokens or URL credentials. */
export function scrub(v: Schema.Json): Schema.Json {
  if (Str.isString(v)) return Str.replace(SECRET_TEXT, "[redacted]")(withoutUser(v));

  if (isJsonArray(v)) return Arr.map(v, scrub);

  if (v === null || Predicate.isNumber(v) || Predicate.isBoolean(v)) return v;

  return Rec.fromEntries(Arr.flatMap(Rec.toEntries(v), ([k, x]): [string, Schema.Json][] => (SECRET_KEY.test(k) ? [] : [[k, scrub(x)]])));
}

const isJsonArray = (v: Schema.Json): v is Schema.JsonArray => Arr.isArray(v);

// ---- bounds

/** Newest first, by when each was read. */
const byNewest = <K, T extends Piece>(): Order.Order<readonly [K, T]> => Order.flip(Order.mapInput(Order.Number, (x: readonly [K, T]) => x[1].at ?? 0));

/** Keeps the newest `n` entries of a map of { at } values. */
export function newest<K, T extends Piece>(map: ReadonlyMap<K, T> | null | undefined, n: number): Map<K, T> {
  return new Map(Arr.take(Arr.sort(Arr.fromIterable(map ?? []), byNewest<K, T>()), Math.max(0, n)));
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
  return e.projects === null || e.projects === undefined ? kept : { ...kept, projects: { list: e.projects.list ?? null, boards: newest(e.projects.boards, limits.boards) } };
}

/** Bounds every part of the document by count: the last repos opened, and in each the newest details, jobs, needs, lists. */
export function prune(doc: Doc, limits: Limits = LIMITS): Doc {
  const repos = new Map(Arr.map(Arr.fromIterable(newest(doc.repos, limits.repos)), ([k, e]) => [k, pruneEntry(e, limits)] as const));
  const folders = new Map(Arr.filter(Arr.fromIterable(doc.folders), ([, k]) => repos.has(k)));

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
    case "projects.boards": return e.projects === null || e.projects === undefined ? e : { ...e, projects: { ...e.projects, boards: map } };
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

/** A droppable's key: its repo, kind and id, apart from each other whatever they hold. */
const dropKey = (repo: string, which: Which | "", id: string): string => `${repo}\u0000${which}\u0000${id}`;

/** The document without what was dropped. */
function without(doc: Doc, dropped: ReadonlySet<string>): Doc {
  const repos = new Map<string, Entry>();

  for (const [k, e] of doc.repos) {
    if (dropped.has(dropKey(k, "", ""))) continue;

    let kept = e;

    for (const which of WHICH) {
      const all = piecesOf(e, which);
      const left = new Map(Arr.filter(Arr.fromIterable(all), ([id]) => !dropped.has(dropKey(k, which, id))));

      if (left.size !== all.size) kept = withPieces(kept, which, left);
    }

    repos.set(k, kept);
  }

  return { ...doc, repos };
}

/** Everything fit could drop, oldest first: whole repos other than `keep`, and every piece. */
function droppable(d: Doc, keep: string | null): Droppable[] {
  const pieces: Droppable[] = [];

  for (const [k, e] of d.repos) {
    if (k !== keep) pieces.push({ at: e.at ?? 0, repo: k });

    for (const which of WHICH) for (const [id, x] of piecesOf(e, which)) pieces.push({ at: x.at ?? 0, repo: k, which, id });
  }

  return Arr.sort(pieces, Order.mapInput(Order.Number, (p: Droppable) => p.at));
}

/** A text's length in UTF-8 bytes. */
const bytes = (s: string): number => new TextEncoder().encode(s).length;

/** The document as text under `max` bytes: drops the oldest pieces (whole repos
 *  other than `keep`, then details, jobs, needs, lists) until it fits. */
export function fit(doc: Doc, max = MAX_BYTES, keep: string | null = null): string {
  let d = prune(doc);
  let text = textOf(d);

  if (bytes(text) <= max) return text;

  const pieces = droppable(d, keep);

  // Drop in growing batches: each round costs one stringify.
  const dropped = new Set<string>();
  const batch = Math.max(1, Math.ceil(pieces.length / 16));

  for (let i = 0; i < pieces.length; i += batch) {
    for (const p of Arr.take(Arr.drop(pieces, i), batch)) dropped.add(dropKey(p.repo, p.which ?? "", p.id ?? ""));

    d = prune(without(d, dropped));
    text = textOf(d);

    if (bytes(text) <= max) return text;
  }

  return textOf(blank());
}

const storedEntryOf = Schema.decodeUnknownOption(StoredEntrySchema);

/** Puts this window's entry for `repo` (seen in `folder`) into the document read from disk:
 *  other repos (other windows') stay as they are. Returns the text to write. */
export function merge(disk: string | Doc | null | undefined, folder: string | null | undefined, entry: Entry, now: number, max = MAX_BYTES): string {
  const d = Str.isString(disk) ? parse(disk) : disk ?? blank();
  const key = repoKey(entry.repo);
  // Written as the file holds it, read back as JSON, scrubbed, and decoded as an entry before it goes in.
  const clean = Option.flatMap(Option.flatMap(Option.flatMap(jsonText({ ...storedEntry(entry), at: now }), jsonValue), (json) => Option.some(scrub(json))), storedEntryOf);

  if (Option.isNone(clean)) return fit(d, max, key);

  const repos = new Map(d.repos).set(key, entryOf(clean.value));
  const folders = folder === null || folder === undefined || folder === "" ? d.folders : new Map(d.folders).set(folderKey(folder, entry.repo?.on), key);

  return fit({ v: VERSION, folders, repos }, max, key);
}
