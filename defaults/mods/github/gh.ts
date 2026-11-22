// Talking to GitHub through the gh CLI (its own login; this mod keeps no
// token), on the kit's `Exec`. REST reads go through `gh api -i` with the
// last ETag, so an unchanged answer is a 304 that costs nothing against the
// rate limit and hands back the copy kept here. A space on another machine
// runs gh there.
//
// Everything gh prints is outside data: each read names the Schema its answer
// must pass (model.ts, board.ts), and an answer that doesn't is a `Misread`
// (the person's words, and where the answer differed), never a value of the
// wrong shape. What can go wrong is typed: gh couldn't run or said no
// (`GhError`, in a person's words), GitHub answered a status (`GhStatus`).

import { Array as Arr, Effect, Option, Predicate, Schema, String as Str } from "effect";
import { Exec, decodeJsonOption, lastLine } from "@fireflies/kit";
import type { Codec, ExecError, ExecOptions } from "@fireflies/kit";
import type { ExecResult } from "herdr";
import type { GqlVar } from "./model.ts";
import { FileContentSchema, maybe, parseHeaders } from "./model.ts";
import type { Slugged } from "./remotes.ts";
import { candidates, slug } from "./remotes.ts";

/** gh couldn't run, or ran and said no: `message` in a person's words. */
export class GhError extends Schema.TaggedError<GhError, { readonly brand: unique symbol }>()("GhError", {
  message: Schema.String,
}) {}

/** GitHub answered a REST read with a status that isn't a success (404: not there). */
export class GhStatus extends Schema.TaggedError<GhStatus, { readonly brand: unique symbol }>()("GhStatus", {
  status: Schema.Finite,
  message: Schema.String,
}) {}

/** GitHub's answer wasn't the shape the window reads: `message` for the person, `detail` where it differed. */
export class Misread extends Schema.TaggedError<Misread, { readonly brand: unique symbol }>()("Misread", {
  message: Schema.String,
  detail: Schema.String,
}) {}

/** Whatever a read of GitHub can fail with. */
export type GitHubFailure = GhError | GhStatus | Misread;

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

/** How a REST answer is read: its decoder, what's kept of it (slim), and the test the kept
 *  copy passes when it's handed back. */
export interface Read<R, T> {
  readonly answer: Codec<R, unknown>;
  readonly slim: (raw: R) => T;
  readonly kept: Codec<T, unknown>;
}

/** An answer kept as it came. */
export const plain = <A>(schema: Codec<A, unknown>): Read<A, A> => ({ answer: schema, slim: (raw) => raw, kept: schema });

/** An answer kept slim. */
export const slimmed = <R, T>(answer: Codec<R, unknown>, slim: (raw: R) => T, kept: Codec<T, unknown>): Read<R, T> => ({ answer, slim, kept });

// `${on}|${path}` -> the last answer, slim, with its ETag; proven again by the reader's schema
// before it's handed back (one path, one reader). Shared by every copy of the window in this run.
const etags = new Map<string, { readonly etag: string | null; readonly data: unknown }>();

const RATE = "GitHub's rate limit is used up for now; trying again shortly.";

/** Why gh failed, in a person's words. */
function why(r: ExecResult): string {
  const err = Str.trim(r.stderr);

  if (/not logged|gh auth login|authentication/i.test(err)) return "gh isn't logged in: run `gh auth login`.";

  if (/rate limit/i.test(err)) return RATE;

  if (/could not resolve|network|timeout|dial tcp|no such host/i.test(err)) return "GitHub can't be reached right now.";

  const said = lastLine(err);

  return said === "" ? "gh didn't answer." : said;
}

/** gh couldn't start: the person's words for it. */
const unrun = (e: ExecError): GhError => GhError.make({
  message: /ENOENT|not found|cannot start|No such file/i.test(e.message) ? "gh isn't installed: the GitHub window talks to GitHub through the gh CLI." : e.message,
});

/** exec's options for a folder on a machine (`timeout` in ms, 30 s by default). */
const where = (cwd: string, on: string | null | undefined, timeout?: number): ExecOptions => {
  const machine = on === null || on === undefined || on === "" ? {} : { on };

  return timeout === undefined ? { cwd, ...machine } : { cwd, ...machine, timeout };
};

/** Runs gh: its exit and output whatever the code; a gh that can't run is a `GhError`. */
const gh = (args: readonly string[], options: ExecOptions) => Exec.use((exec) => Effect.mapError(exec.run("gh", args, { timeout: 30000, ...options }), unrun));

/** Runs git in the repo's folder; a git that can't run is a `GhError` (not "no repo here"). */
const git = (args: readonly string[], options: ExecOptions) => Exec.use((exec) =>
  Effect.mapError(exec.run("git", args, options), (e) => GhError.make({ message: `git couldn't run: ${e.message}` })));

/** The answer GitHub gave wasn't the shape the window reads. */
const misread = (what: string) => (e: Schema.SchemaError | string) => Misread.make({
  message: `GitHub's answer to ${what} wasn't understood.`, detail: Str.isString(e) ? e : e.message,
});

const VIEW = "nameWithOwner,defaultBranchRef,url,isFork,parent";

/** `gh repo view --json` (VIEW). */
const RepoViewSchema = Schema.Struct({
  nameWithOwner: Schema.String, url: maybe(Schema.String), isFork: maybe(Schema.Boolean),
  parent: maybe(Schema.Struct({ name: maybe(Schema.String), owner: maybe(Schema.Struct({ login: maybe(Schema.String) })) })),
  defaultBranchRef: maybe(Schema.Struct({ name: maybe(Schema.String) })),
});

const repoView = Schema.decodeUnknownEffect(Schema.fromJsonString(RepoViewSchema));

const gone = (r: ExecResult): boolean => /could not resolve to a repository|HTTP 404|not found/i.test(r.stderr);

/** The folder a repo is asked about in, its machine and branch. */
export interface RepoPlace {
  readonly root: string;
  readonly on: string | null;
  readonly branch?: string | null;
}

/** A string that is there and not empty. */
const given = (s: string | null | undefined): s is string => s !== null && s !== undefined && s !== "";

/** GitHub's word on a repo ({ full, host }, or null: the folder's, as gh resolves it), for a folder of it.
 *  `quiet`: a repo GitHub doesn't know is null rather than an error. */
export const viewRepo = Effect.fnUntraced(function* (want: Slugged | null, place: RepoPlace, quiet?: boolean) {
  const { root, on, branch = null } = place;
  const r = yield* gh(["repo", "view", ...(want === null ? [] : [slug(want)]), "--json", VIEW], where(root, on));

  if (r.code !== 0) {
    if (quiet === true && gone(r)) return null;

    if (/no git remotes|not a git|none of the git remotes|could not determine/i.test(r.stderr)) return null;

    return yield* GhError.make({ message: why(r) });
  }

  const j = yield* Effect.mapError(repoView(r.stdout), misread("gh repo view"));
  const [owner, name = ""] = Str.split(j.nameWithOwner, "/");
  const p = j.parent;
  const login = p?.owner?.login, parentName = p?.name;
  const parent = j.isFork === true && given(login) && given(parentName) ? `${login}/${parentName}` : null;

  const repo: Repo = {
    owner, name, full: j.nameWithOwner, host: want?.host ?? "github.com", root, on: on ?? null, url: j.url ?? null,
    base: j.defaultBranchRef?.name ?? null, branch, parent, child: null,
  };

  return repo;
});

/** The GitHub repo of a folder: { owner, name, full, host, root, on, url, base, branch, parent }, or null when it has none.
 *  Which repo is picked from the folder's remotes (remotes.ts: gh's default, the branch's push remote, origin, …),
 *  not by gh's guess, which in a fork with an `upstream` remote is the parent. */
export const repoOf = Effect.fnUntraced(function* (folder: string | null | undefined, on: string | null) {
  if (!given(folder)) return null;

  const top = yield* git(["rev-parse", "--show-toplevel"], where(folder, on));

  if (top.code !== 0) return null; // not a git checkout

  const root = Str.trim(top.stdout);

  const [cfg, br] = yield* Effect.all([
    // Exit 1: no such keys (no remotes, no branch settings).
    git(["config", "--get-regexp", "^(remote|branch)\\."], where(root, on)),
    git(["branch", "--show-current"], where(root, on)),
  ], { concurrency: 2 });

  const current = Str.trim(br.stdout);
  const branch = current === "" ? null : current;
  const list = candidates(cfg.code === 0 ? cfg.stdout : "", branch);

  // No remote on a known GitHub host (an enterprise host by another name): gh picks, as it always did.
  if (list.length === 0) return yield* viewRepo(null, { root, on, branch });

  for (const c of list) {
    const r = yield* viewRepo(c, { root, on, branch }, true);

    if (r !== null) return r;
  }

  return null;
});

/** What api, graphql and ghJson read of a repo. */
export interface Where {
  readonly host?: string | null | undefined;
  readonly full: string;
  readonly root: string;
  readonly on?: string | null | undefined;
}

/** gh api's --hostname for a repo off github.com. */
const hostArgs = (repo: Where): string[] => (given(repo.host) && repo.host !== "github.com" ? ["--hostname", repo.host] : []);

/** How a REST read goes: past the ETag (`fresh`), or with the copy a 304 hands back (`prior`). */
export interface ApiOptions<T> {
  readonly fresh?: boolean;
  readonly prior?: Kept<T> | null | undefined;
}

const MessageSchema = Schema.Struct({ message: maybe(Schema.String) });

const messageOf = decodeJsonOption(MessageSchema);

/** The copy a 304 hands back: `prior` (with an ETag and data), else the last answer kept here, unless `fresh`. */
function keptFor<R, T>(key: string, read: Read<R, T>, { fresh = false, prior = null }: ApiOptions<T>): Kept<T> | null {
  if (fresh) return null;

  if (prior !== null && prior !== undefined && given(prior.etag) && prior.data !== null) return prior;

  const here = etags.get(key);

  return here !== undefined && Schema.is(read.kept)(here.data) ? { etag: here.etag, data: here.data } : null;
}

/** A REST read: { data, etag, changed } (changed false when GitHub said 304).
 *  `prior` ({ etag, data }, e.g. from the window's cache) is what a 304 hands
 *  back; without it the last answer kept here is. `read.slim` shrinks the answer
 *  before it's kept (only what the window draws). `fresh` skips the ETag. */
export const api = <R, T>(repo: Where, path: string, read: Read<R, T>, options: ApiOptions<T> = {}): Effect.Effect<Fetched<T>, GitHubFailure, Exec> => Effect.gen(function* () {
  const key = `${repo.on ?? ""}|${path}`;
  const kept = keptFor(key, read, options);
  const tag = kept?.etag ?? null;
  const args = ["api", "-i", ...hostArgs(repo), ...(given(tag) ? ["-H", `If-None-Match: ${tag}`] : []), path];
  const r = yield* gh(args, where(repo.root, repo.on));
  const { status, etag, body } = parseHeaders(r.stdout);

  if (status === 304 && kept !== null) return { data: kept.data, etag: kept.etag, changed: false };

  if (status >= 200 && status < 300) {
    const raw = Str.isEmpty(body) ? null : yield* Effect.mapError(Schema.decodeEffect(Schema.fromJsonString(read.answer))(body), misread(path));
    const data = raw === null ? null : read.slim(raw);

    etags.set(key, { etag, data });

    return { data, etag, changed: true };
  }

  if (status !== 0) {
    const said = Option.getOrNull(Option.flatMap(messageOf(body), (m) => Option.fromNullishOr(m.message))) ?? `GitHub said ${status}`;

    return yield* GhStatus.make({ status, message: status === 403 && /rate limit/i.test(said) ? RATE : said });
  }

  return yield* GhError.make({ message: why(r) });
});

/** An error GraphQL reports beside (or instead of) its data. */
const GqlErrorSchema = Schema.Struct({ message: maybe(Schema.String), type: maybe(Schema.String) });

type GqlError = typeof GqlErrorSchema.Type;

const errorsOf = decodeJsonOption(Schema.NullOr(Schema.Struct({ errors: maybe(Schema.Array(Schema.Unknown)) })));

const gqlError = Schema.decodeUnknownOption(GqlErrorSchema);

/** Some data came back (an object, whatever its fields). */
const someData = decodeJsonOption(Schema.Struct({ data: Schema.Struct({}) }));

/** gh's output, or "null" when it printed nothing. */
const outOf = (r: ExecResult): string => (Str.isEmpty(r.stdout) ? "null" : r.stdout);

/** Sends a GraphQL document: gh's output, and the errors GitHub reported in it (the ones in its shape). */
const send = (repo: Where, query: string, vars: readonly GqlVar[]) => Effect.map(
  gh(["api", "graphql", ...hostArgs(repo), "-f", `query=${query}`, ...Arr.flatMap(vars, ([k, v]) => [Predicate.isNumber(v) ? "-F" : "-f", `${k}=${v}`])], where(repo.root, repo.on)),
  (r) => {
    const listed = Option.getOrNull(Option.flatMap(errorsOf(outOf(r)), (a) => Option.fromNullishOr(a?.errors))) ?? [];

    return { r, errors: Arr.getSomes(Arr.map(listed, (e) => gqlError(e))) };
  },
);

/** GitHub's first error, as an error. */
const firstError = (errors: readonly GqlError[]): GhError => GhError.make({ message: errors[0]?.message ?? "GitHub didn't answer." });

/** How a GraphQL read treats errors: `partial`, data that came back beside them is used. */
export interface GraphqlOptions {
  readonly partial?: boolean;
}

/** A GraphQL read (only the fields asked for): its `data`, decoded by `schema`. `partial`: data that
 *  came back beside errors (one owner GitHub won't show, say) is used, unless a scope is missing. */
export const graphql = <A, I>(repo: Where, query: string, schema: Codec<A, I>, vars: readonly GqlVar[] = [], { partial = false }: GraphqlOptions = {}): Effect.Effect<A, GitHubFailure, Exec> => Effect.gen(function* () {
  const { r, errors } = yield* send(repo, query, vars);
  const answer = decodeJsonOption(Schema.Struct({ data: schema }))(outOf(r));

  if (Option.isSome(answer)) {
    if (errors.length === 0) return answer.value.data;

    if (partial && !Arr.some(errors, (e) => e.type === "INSUFFICIENT_SCOPES")) return answer.value.data;
  }

  if (errors.length > 0) return yield* firstError(errors);

  if (Option.isSome(someData(outOf(r)))) return yield* misread("a GraphQL read")("the data had another shape");

  return yield* GhError.make({ message: why(r) });
});

/** A GraphQL mutation whose answer isn't read: done, or an error with GitHub's words. */
export const mutate = (repo: Where, query: string, vars: readonly GqlVar[] = []): Effect.Effect<void, GhError, Exec> => Effect.gen(function* () {
  const { r, errors } = yield* send(repo, query, vars);

  if (errors.length > 0) return yield* firstError(errors);

  if (Option.isNone(someData(outOf(r)))) return yield* GhError.make({ message: why(r) });
});

/** A gh command that prints JSON (`gh pr list --json ...`), decoded by `schema`. */
export const ghJson = <A, I>(repo: Where, args: readonly string[], schema: Codec<A, I>): Effect.Effect<A, GhError | Misread, Exec> => Effect.gen(function* () {
  const r = yield* gh([...args, "-R", slug(repo)], where(repo.root, repo.on));

  if (r.code !== 0) return yield* GhError.make({ message: why(r) });

  return yield* Effect.mapError(Schema.decodeEffect(Schema.fromJsonString(schema))(outOf(r)), misread(`gh ${Arr.join(Arr.take(args, 2), " ")}`));
});

/** A gh command run for its text or its effect: its stdout, or a `GhError` saying why it failed. */
export const ghRun = (repo: Where, args: readonly string[], timeout?: number): Effect.Effect<string, GhError, Exec> => Effect.flatMap(
  gh([...args, "-R", slug(repo)], where(repo.root, repo.on, timeout)),
  (r) => (r.code === 0 ? Effect.succeed(r.stdout) : Effect.fail(GhError.make({ message: why(r) }))),
);

const fromBase64 = Schema.decodeEffect(Schema.StringFromBase64);

/** A file of the repo at a commit (the workflow behind a run): its text (UTF-8), none when GitHub
 *  has no such file there (404). Any other failure is the caller's to say. */
export const fileAt = (repo: Where, path: string, ref: string): Effect.Effect<Option.Option<string>, GitHubFailure, Exec> => Effect.gen(function* () {
  const { data } = yield* api(repo, `repos/${repo.full}/contents/${path}?ref=${encodeURIComponent(ref)}`, plain(FileContentSchema));
  const content = data?.content;

  if (!given(content)) return Option.none();

  const decoded = yield* Effect.mapError(fromBase64(Str.replace(/\s/g, "")(content)), misread(path));

  return Option.some(decoded);
}).pipe(Effect.catchTag("GhStatus", (e) => (e.status === 404 ? Effect.succeedNone : Effect.fail(e))));
