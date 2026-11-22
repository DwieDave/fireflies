// The new pull request form's reads (prForm.ts runs them on the window): the
// clone's remotes and branches (git), GitHub's branches, people, labels and
// milestones, the pull request template; then, for base and head, the commits
// between them and whether head is on GitHub. A read the form can do without
// falls back to nothing where it says so (the person still writes the pull
// request); git's and gh's words otherwise.

import { Array as Arr, Effect, Predicate, String as Str } from "effect";
import { Exec, lastLine, redraw } from "@fireflies/kit";
import type { ExecOptions } from "@fireflies/kit";
import type { Repo } from "./gh.ts";
import { GhError, api, graphql, plain } from "./gh.ts";
import { NamedListSchema, NamedSchema, PrChoicesSchema } from "./model.ts";
import { candidates } from "./remotes.ts";
import { parseBranches, parseLog, parseNumstat, remoteFor, templatesIn } from "./pr-create.ts";
import type { PrForm } from "./prForm.ts";

const CHOICES = `query($owner: String!, $name: String!) { viewer { login }
  repository(owner: $owner, name: $name) {
    assignableUsers(first: 100) { nodes { login name } }
    labels(first: 100, orderBy: { field: NAME, direction: ASC }) { nodes { name description } }
    milestones(first: 50, states: OPEN, orderBy: { field: DUE_DATE, direction: ASC }) { nodes { title dueOn } } } }`;

/** exec's options for the clone (`timeout` in ms). */
const where = (repo: Repo, timeout: number): ExecOptions => (repo.on === null || repo.on === "" ? { cwd: repo.root, timeout } : { cwd: repo.root, on: repo.on, timeout });

/** git in the clone: its output, or a GhError with git's last words. */
export const git = (repo: Repo, args: readonly string[], timeout = 30000) => Exec.use((x) => x.run("git", args, where(repo, timeout))).pipe(
  Effect.mapError((e) => GhError.make({ message: `git couldn't run: ${e.message}` })),
  Effect.flatMap((r) => {
    const said = lastLine(r.stderr);

    return r.code === 0 ? Effect.succeed(r.stdout) : Effect.fail(GhError.make({ message: said === "" ? `git ${args[0] ?? ""} failed` : said }));
  }),
);

/** Where base is in this clone: the remote's copy, else a local branch of that name (null: neither). */
const baseRef = (f: PrForm, base: string) => Effect.gen(function* () {
  const tries = [...(f.baseRemote === null ? [] : [`refs/remotes/${f.baseRemote}/${base}`]), `refs/heads/${base}`];

  for (const ref of tries) {
    const there = yield* Effect.isSuccess(git(f.repo, ["rev-parse", "--verify", "--quiet", ref]));

    if (there) return Str.replace(/^refs\/(remotes|heads)\//, "")(ref);
  }

  return null;
});

/** Whether head is on GitHub: false when GitHub says it isn't (404), null when that couldn't be asked. */
const onGitHub = (f: PrForm, head: string) => api(f.repo, `repos/${f.headRepo}/branches/${encodeURIComponent(head)}`, plain(NamedSchema), { fresh: true }).pipe(
  Effect.as<boolean | null>(true),
  Effect.catchTag("GhStatus", (e) => Effect.succeed(e.status === 404 ? false : null)),
  Effect.orElseSucceed(() => null),
);

/** Base or head changed: what's between them, whether head is on GitHub, and the fill. */
export const reread = (f: PrForm) => Effect.gen(function* () {
  const base = f.form.text("base"), head = f.form.text("head");
  const gen = ++f.gen;

  f.range = base !== "" && head !== "" ? { base, head, commits: null, stat: null, error: "" } : null;
  f.headState = null;
  yield* redraw;

  if (base === "" || head === "") return;

  const ref = yield* baseRef(f, base);
  const unfetched = { error: `${base} isn't fetched here: fetch to see the commits.` };

  const [log, stat, onRemote] = yield* Effect.all([
    ref === null ? Effect.succeed(unfetched) : git(f.repo, ["log", "--format=%H%x1f%s%x1f%b%x1e", "-n", "200", `${ref}..${head}`]).pipe(Effect.catch((e) => Effect.succeed({ error: e.message }))),
    // The files are extra: a diff git refuses shows none.
    ref === null ? Effect.succeed("") : Effect.orElseSucceed(git(f.repo, ["diff", "--numstat", `${ref}...${head}`]), () => ""),
    onGitHub(f, head),
  ], { concurrency: 3 });

  if (gen !== f.gen || f.closed) return;

  f.range = { base, head, commits: Predicate.isString(log) ? parseLog(log) : null, stat: parseNumstat(stat), error: Predicate.isString(log) ? "" : log.error };
  f.headState = { head, onRemote };
  f.fill();
  f.syncPush();
  yield* redraw;
});

/** The clone's remotes (no remote or branch settings: exit 1, none), which pick where head and base live; then the range. */
export const readRemotes = (f: PrForm) => Effect.gen(function* () {
  const cfg = yield* Effect.orElseSucceed(git(f.repo, ["config", "--get-regexp", "^(remote|branch)\\."]), () => "");
  const list = candidates(cfg, f.repo.branch);

  f.remote = remoteFor(list, f.headRepo, f.repo.host);
  f.baseRemote = remoteFor(list, f.repo.full, f.repo.host) ?? f.remote;
  yield* reread(f);
});

/** The clone's branches, newest first (a clone git can't list offers none). */
export const readLocal = (f: PrForm) => Effect.gen(function* () {
  const out = yield* Effect.orElseSucceed(git(f.repo, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)%09%(upstream:short)%09%(upstream:track)", "refs/heads"]), () => "");

  f.local = parseBranches(out);
  yield* redraw;
});

/** GitHub's branches, the default one first (unreadable: none offered for base but what's typed). */
export const readRemoteBranches = (f: PrForm) => Effect.gen(function* () {
  const repo = f.repo;

  const names = yield* api(repo, `repos/${repo.full}/branches?per_page=100`, plain(NamedListSchema)).pipe(
    Effect.map(({ data }) => Arr.map(data ?? [], (b) => b.name)),
    Effect.orElseSucceed((): string[] => []),
  );

  const base = repo.base ?? "";

  f.remoteBranches = base !== "" && names.includes(base) ? [base, ...Arr.filter(names, (n) => n !== base)] : names;
  yield* redraw;
});

/** Who can be assigned, the labels and open milestones, and who I am (unreadable: empty lists). */
export const readChoices = (f: PrForm) => Effect.gen(function* () {
  const [owner = "", name = ""] = Str.split(f.repo.full, "/");
  const d = yield* Effect.orElseSucceed(graphql(f.repo, CHOICES, PrChoicesSchema, [["owner", owner], ["name", name]], { partial: true }), () => null);
  const r = d?.repository;

  f.choices = {
    me: d?.viewer?.login ?? null,
    users: r?.assignableUsers?.nodes ?? [], labels: r?.labels?.nodes ?? [], milestones: r?.milestones?.nodes ?? [],
  };
  yield* redraw;
});

/** The repo's pull request template, which starts the body (none found or readable: an empty start). */
export const readTemplate = (f: PrForm) => Effect.gen(function* () {
  const files = yield* Effect.orElseSucceed(git(f.repo, ["ls-files", "--", ":(icase)pull_request_template*", ":(icase).github/pull_request_template*", ":(icase)docs/pull_request_template*"]), () => "");

  f.templates = templatesIn(Arr.filter(Str.split(files, "\n"), Str.isNonEmpty));

  const [first] = f.templates;

  if (first === undefined) return;

  f.template = yield* Effect.orElseSucceed(git(f.repo, ["show", `HEAD:${first}`]), () => "");
  f.fill();
  yield* redraw;
});
