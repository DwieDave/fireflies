// Talking to GitHub through the gh CLI (its own login; this mod keeps no
// token). REST reads go through `gh api -i` with the last ETag, so an
// unchanged answer is a 304 that costs nothing against the rate limit and
// hands back the copy kept here. A space on another machine runs gh there.
//
// Everything gh prints is outside data: each read names the guard its answer
// must pass (model.ts, board.ts), and an answer that doesn't is an error, never
// a value of the wrong shape.

import { exec } from "herdr";
import type { ExecResult } from "herdr";
import type { Guard } from "./guard.ts";
import { isBoolean, isNumber, isString, nullable, object, parseJson } from "./guard.ts";
import { isList, maybe } from "./guards.ts";
import type { GqlVar } from "./model.ts";
import { isFileContent, parseHeaders } from "./model.ts";
import type { Slugged } from "./remotes.ts";
import { candidates, slug } from "./remotes.ts";

/** A repo on GitHub as the window knows it: the folder it's checked out in (`root`), the
 *  machine (`on`), its default branch (`base`), the folder's branch, the repo it forks
 *  (`parent`) and the fork the window came from (`child`, when p switched to the parent). */
export interface Repo {
  readonly owner: string;
  readonly name: string;
  readonly full: string;
  readonly host: string;
  readonly root: string;
  readonly on: string | null;
  readonly url: string | null;
  readonly base: string | null;
  branch: string | null;
  parent: string | null;
  child: string | null;
}

/** An answer kept for its ETag: what a 304 hands back. */
export interface Kept<T> {
  readonly etag: string | null;
  readonly data: T;
}

/** A REST read's result: the data (null: an empty answer), its ETag, and whether it changed. */
export interface Fetched<T> {
  readonly data: T | null;
  readonly etag: string | null;
  readonly changed: boolean;
}

/** How a REST answer is read: the guard it must pass, what's kept of it (slim), and the guard
 *  the kept copy passes when it's handed back. */
export interface Read<R, T> {
  readonly answer: Guard<R>;
  readonly slim: (raw: R) => T;
  readonly kept: Guard<T>;
}

/** An answer kept as it came. */
export const plain = <T>(guard: Guard<T>): Read<T, T> => ({ answer: guard, slim: (raw) => raw, kept: guard });

/** An answer kept slim. */
export const slimmed = <R, T>(answer: Guard<R>, slim: (raw: R) => T, kept: Guard<T>): Read<R, T> => ({ answer, slim, kept });

// `${on}|${path}` -> the last answer, slim, with its ETag; proven again by the reader's guard
// before it's handed back (one path, one reader).
const cache = new Map<string, { readonly etag: string | null; readonly data: unknown }>();

/** Why gh failed, in a person's words. */
function why(r: ExecResult | null): string {
  const err = (r?.stderr ?? "").trim();

  if (/not logged|gh auth login|authentication/i.test(err)) return "gh isn't logged in: run `gh auth login`.";

  if (/rate limit/i.test(err)) return "GitHub's rate limit is used up for now; trying again shortly.";

  if (/could not resolve|network|timeout|dial tcp|no such host/i.test(err)) return "GitHub can't be reached right now.";

  return err.split("\n").filter(Boolean).pop() || "gh didn't answer.";
}

/** Where gh runs: the folder, the machine, how long it may take. */
interface GhOptions {
  readonly cwd?: string;
  readonly on?: string | null;
  readonly timeout?: number | undefined;
}

/** exec's options, as gh passes them. */
interface ExecOptions {
  cwd?: string;
  on?: string;
  timeout: number;
}

async function gh(args: string[], { cwd, on, timeout = 30000 }: GhOptions = {}): Promise<ExecResult> {
  const options: ExecOptions = { timeout };

  if (cwd !== undefined) options.cwd = cwd;

  if (on) options.on = on;

  try {
    return await exec("gh", args, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    throw new Error(/ENOENT|not found|cannot start|No such file/i.test(msg) ? "gh isn't installed: the GitHub window talks to GitHub through the gh CLI." : msg, { cause: err });
  }
}

/** The answer GitHub gave wasn't the shape the window reads. */
const misread = (what: string) => new Error(`GitHub's answer to ${what} wasn't understood.`);

const VIEW = "nameWithOwner,defaultBranchRef,url,isFork,parent";

/** `gh repo view --json` (VIEW). */
const isRepoView = object({ nameWithOwner: isString }, {
  url: maybe(isString), isFork: maybe(isBoolean),
  parent: maybe(object({}, { name: maybe(isString), owner: maybe(object({}, { login: maybe(isString) })) })),
  defaultBranchRef: maybe(object({}, { name: maybe(isString) })),
});

const gone = (r: ExecResult) => /could not resolve to a repository|HTTP 404|not found/i.test(r.stderr);

/** The GitHub repo of a folder: { owner, name, full, host, root, on, url, base, branch, parent }, or null when it has none.
 *  Which repo is picked from the folder's remotes (remotes.ts: gh's default, the branch's push remote, origin, …),
 *  not by gh's guess, which in a fork with an `upstream` remote is the parent. */
export async function repoOf(folder: string | null | undefined, on: string | null): Promise<Repo | null> {
  if (!folder) return null;

  const where = (cwd: string) => (on ? { cwd, on } : { cwd });
  const top = await exec("git", ["rev-parse", "--show-toplevel"], where(folder)).catch(() => null);

  if (!top || top.code !== 0) return null;

  const root = top.stdout.trim();

  const [cfg, br] = await Promise.all([
    exec("git", ["config", "--get-regexp", "^(remote|branch)\\."], where(root)).catch(() => null),
    exec("git", ["branch", "--show-current"], where(root)).catch(() => null),
  ]);

  const branch = br?.stdout.trim() || null;
  const list = candidates(cfg?.code === 0 ? cfg.stdout : "", branch);

  // No remote on a known GitHub host (an enterprise host by another name): gh picks, as it always did.
  if (!list.length) return viewRepo(null, { root, on, branch });

  for (const c of list) {
    const r = await viewRepo(c, { root, on, branch }, { quiet: true });

    if (r) return r;
  }

  return null;
}

/** The folder a repo is asked about in, its machine and branch. */
export interface RepoPlace {
  readonly root: string;
  readonly on: string | null;
  readonly branch?: string | null;
}

/** GitHub's word on a repo ({ full, host }, or null: the folder's, as gh resolves it), for a folder of it. */
export async function viewRepo(want: Slugged | null, { root, on, branch = null }: RepoPlace, { quiet = false } = {}): Promise<Repo | null> {
  const r = await gh(["repo", "view", ...(want ? [slug(want)] : []), "--json", VIEW], { cwd: root, on });

  if (r.code !== 0) {
    if (quiet && gone(r)) return null;

    if (/no git remotes|not a git|none of the git remotes|could not determine/i.test(r.stderr)) return null;

    throw new Error(why(r));
  }

  const j = parseJson(r.stdout, isRepoView);

  if (!j) throw misread("gh repo view");

  const [owner = "", name = ""] = j.nameWithOwner.split("/");
  const p = j.parent;
  const parent = j.isFork && p?.owner?.login && p.name ? `${p.owner.login}/${p.name}` : null;

  return {
    owner, name, full: j.nameWithOwner, host: want?.host ?? "github.com", root, on: on ?? null, url: j.url ?? null,
    base: j.defaultBranchRef?.name ?? null, branch, parent, child: null,
  };
}

/** What api, graphql and ghJson read of a repo. */
export interface Where {
  readonly host?: string | null | undefined;
  readonly full: string;
  readonly root: string;
  readonly on?: string | null | undefined;
}

/** gh api's --hostname for a repo off github.com. */
const hostArgs = (repo: Where) => (repo.host && repo.host !== "github.com" ? ["--hostname", repo.host] : []);

/** How a REST read goes: past the ETag (`fresh`), or with the copy a 304 hands back (`prior`). */
export interface ApiOptions<T> {
  readonly fresh?: boolean;
  readonly prior?: Kept<T> | null | undefined;
}

const isMessage = object({}, { message: maybe(isString) });

/** A REST read: { data, etag, changed } (changed false when GitHub said 304).
 *  `prior` ({ etag, data }, e.g. from the window's cache) is what a 304 hands
 *  back; without it the last answer kept here is. `read.slim` shrinks the answer
 *  before it's kept (only what the window draws). `fresh` skips the ETag. */
export async function api<R, T>(repo: Where, path: string, read: Read<R, T>, { fresh = false, prior = null }: ApiOptions<T> = {}): Promise<Fetched<T>> {
  const key = `${repo.on ?? ""}|${path}`;
  const here = cache.get(key);
  const mine: Kept<T> | null = here && read.kept(here.data) ? { etag: here.etag, data: here.data } : null;
  const kept = fresh ? null : prior?.etag && prior.data !== null ? prior : mine;
  const args = ["api", "-i", ...hostArgs(repo), ...(kept?.etag ? ["-H", `If-None-Match: ${kept.etag}`] : []), path];
  const r = await gh(args, { cwd: repo.root, on: repo.on ?? null });
  const { status, etag, body } = parseHeaders(r.stdout);

  if (status === 304 && kept) return { data: kept.data, etag: kept.etag, changed: false };

  if (status >= 200 && status < 300) {
    const raw = body ? parseJson(body, read.answer) : null;

    if (raw === undefined) throw misread(path);

    const data = raw === null ? null : read.slim(raw);

    cache.set(key, { etag, data });

    return { data, etag, changed: true };
  }

  if (status) {
    const msg = parseJson(body, isMessage)?.message ?? `GitHub said ${status}`;

    throw new Error(status === 403 && /rate limit/i.test(msg) ? "GitHub's rate limit is used up for now; trying again shortly." : msg);
  }

  throw new Error(why(r));
}

/** An error GraphQL reports beside (or instead of) its data. */
const isErrors = object({}, { errors: maybe(isList) });

const isError = object({}, { message: maybe(isString), type: maybe(isString) });

/** Sends a GraphQL document: gh's output, and the errors GitHub reported in it. */
async function send(repo: Where, query: string, vars: readonly GqlVar[]) {
  const args = ["api", "graphql", ...hostArgs(repo), "-f", `query=${query}`];

  for (const [k, v] of vars) args.push(isNumber(v) ? "-F" : "-f", `${k}=${v}`);

  const r = await gh(args, { cwd: repo.root, on: repo.on ?? null });
  const errors = (parseJson(r.stdout || "null", nullable(isErrors))?.errors ?? []).filter((e) => isError(e));

  return { r, errors };
}

/** How a GraphQL read treats errors: `partial`, data that came back beside them is used. */
export interface GraphqlOptions {
  readonly partial?: boolean;
}

/** A GraphQL read (only the fields asked for): its `data`, proven by `guard`. `partial`: data that
 *  came back beside errors (one owner GitHub won't show, say) is used, unless a scope is missing. */
export async function graphql<T>(repo: Where, query: string, guard: Guard<T>, vars: readonly GqlVar[] = [], { partial = false }: GraphqlOptions = {}): Promise<T> {
  const { r, errors } = await send(repo, query, vars);
  const answer = parseJson(r.stdout || "null", object({ data: guard }));
  const data = answer?.data;
  const some = data !== undefined && data !== null;

  if (answer && some && !errors.length) return answer.data;

  if (partial && answer && some && !errors.some((e) => e.type === "INSUFFICIENT_SCOPES")) return answer.data;

  if (errors.length) throw new Error(errors[0]?.message ?? "GitHub didn't answer.");

  if (parseJson(r.stdout || "null", object({ data: object({}) }))) throw misread("a GraphQL read");

  throw new Error(why(r));
}

/** A GraphQL mutation whose answer isn't read: done, or an error with GitHub's words. */
export async function mutate(repo: Where, query: string, vars: readonly GqlVar[] = []): Promise<void> {
  const { r, errors } = await send(repo, query, vars);

  if (errors.length) throw new Error(errors[0]?.message ?? "GitHub didn't answer.");

  if (!parseJson(r.stdout || "null", object({ data: object({}) }))) throw new Error(why(r));
}

/** A gh command that prints JSON (`gh pr list --json ...`), proven by `guard`. */
export async function ghJson<T>(repo: Where, args: readonly string[], guard: Guard<T>): Promise<T> {
  const r = await gh([...args, "-R", slug(repo)], { cwd: repo.root, on: repo.on ?? null });

  if (r.code !== 0) throw new Error(why(r));

  const out = parseJson(r.stdout || "null", guard);

  if (out === undefined) throw misread(`gh ${args.slice(0, 2).join(" ")}`);

  return out;
}

/** What a gh command run for its text or its effect did. */
export interface Ran {
  readonly ok: boolean;
  readonly out: string;
  readonly err: string;
}

/** A gh command run for its text or its effect: { ok, out, err }. */
export async function ghRun(repo: Where, args: readonly string[], { timeout }: { readonly timeout?: number } = {}): Promise<Ran> {
  const r = await gh([...args, "-R", slug(repo)], { cwd: repo.root, on: repo.on ?? null, timeout });

  return { ok: r.code === 0, out: r.stdout, err: r.code === 0 ? "" : why(r) };
}

/** A file of the repo at a commit (the workflow behind a run), or null. */
export async function fileAt(repo: Where, path: string, ref: string): Promise<string | null> {
  try {
    const { data } = await api(repo, `repos/${repo.full}/contents/${path}?ref=${encodeURIComponent(ref)}`, plain(isFileContent));

    return data?.content ? atob(data.content.replace(/\s/g, "")) : null;
  } catch {
    return null;
  }
}
