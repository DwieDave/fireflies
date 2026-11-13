// A new pull request, as plain functions: no herdr imports, so scripts/
// tests them. prForm.ts draws the form and runs git and gh; this fills the
// title and body the way `gh pr create --fill` does, finds the repo's pull
// request template, reads git's answers, checks the form and builds
// `git push` and `gh pr create`.

import type { Candidate } from "./remotes.ts";

/** A commit between base and head. */
export interface Commit {
  readonly sha: string;
  readonly subject: string;
  readonly body: string;
}

/** gh's humanize: a branch name with - and _ as spaces. */
export const humanize = (branch: string | null | undefined): string => (branch ?? "").replace(/[-_]/g, " ");

/** A pull request's title and body. */
export interface Filled {
  readonly title: string;
  readonly body: string;
}

/** Title and body from the commits between base and head, oldest first,
 *  as `gh pr create --fill`: one commit gives its subject and body; more
 *  give the branch name and the subjects as a list. */
export function fillFrom(commits: readonly Commit[] | null | undefined, head: string | null | undefined): Filled {
  const list = commits ?? [];
  const [only] = list;

  if (list.length === 1 && only) return { title: only.subject, body: only.body.trim() };

  if (!list.length) return { title: humanize(head), body: "" };

  return { title: humanize(head), body: list.map((c) => `- ${c.subject}`).join("\n") };
}

// Where gh looks for a template: the repo's root, .github/ and docs/, any case.
const ONE = /^(\.github\/|docs\/)?pull_request_template(\.md)?$/i;
const MANY = /^(\.github\/|docs\/)?pull_request_template\/[^/]+\.md$/i;

/** The repo's pull request templates among its files: the single one first, then the named ones (PULL_REQUEST_TEMPLATE/*.md), by name. */
export function templatesIn(paths: readonly string[] | null | undefined): string[] {
  const one: string[] = [], many: string[] = [];

  for (const p of paths ?? []) {
    if (ONE.test(p)) one.push(p);
    else if (MANY.test(p)) many.push(p);
  }

  const rank = (p: string) => (p.toLowerCase().startsWith(".github/") ? 0 : p.includes("/") ? 2 : 1);

  one.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  many.sort((a, b) => a.localeCompare(b));

  return [...one, ...many];
}

/** The body to start with: the template when there is one, else the commits' (`fill`). */
export function startBody(template: string | null | undefined, fill: string | null | undefined): string {
  const t = (template ?? "").trim();

  if (!t) return fill ?? "";

  return t;
}

/** `git log --format=%H%x1f%s%x1f%b%x1e` output, newest first as git prints it, to [{ sha, subject, body }] oldest first. */
export function parseLog(text: string | null | undefined): Commit[] {
  return (text ?? "").split("\x1e").flatMap((record): Commit[] => {
    const r = record.replace(/^\n+/, "");

    if (!r.trim()) return [];

    const [sha = "", subject = "", body = ""] = r.split("\x1f");

    return [{ sha: sha.trim(), subject: subject.trim(), body: body.trim() }];
  }).reverse();
}

/** A changed file: lines added and deleted, or binary. */
export interface FileStat {
  readonly path: string;
  readonly add: number;
  readonly del: number;
  readonly binary: boolean;
}

/** The files a range changes, and the lines in all. */
export interface Numstat {
  readonly files: readonly FileStat[];
  readonly add: number;
  readonly del: number;
}

/** `git diff --numstat` output to { files: [{ path, add, del }], add, del }. */
export function parseNumstat(text: string | null | undefined): Numstat {
  const files: FileStat[] = [];
  let add = 0, del = 0;

  for (const line of (text ?? "").split("\n")) {
    const [, adds, dels, path] = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line) ?? [];

    if (adds === undefined || dels === undefined || path === undefined) continue;

    const a = adds === "-" ? 0 : Number(adds), d = dels === "-" ? 0 : Number(dels);

    files.push({ path, add: a, del: d, binary: adds === "-" });
    add += a;
    del += d;
  }

  return { files, add, del };
}

/** A local branch: where it tracks, how far ahead and behind, whether its upstream is gone. */
export interface LocalBranch {
  readonly name: string;
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly gone: boolean;
}

/** `git for-each-ref --format=%(refname:short)%09%(upstream:short)%09%(upstream:track)` output: [{ name, upstream, ahead, behind, gone }]. */
export function parseBranches(text: string | null | undefined): LocalBranch[] {
  const out: LocalBranch[] = [];

  for (const line of (text ?? "").split("\n")) {
    if (!line.trim()) continue;

    const [name = "", upstream = "", track = ""] = line.split("\t");

    out.push({
      name, upstream: upstream || null,
      ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
      gone: /gone/.test(track),
    });
  }

  return out;
}

/** The remote that holds the repo (`owner/name` on `host`), among the folder's (remotes.ts candidates), or null. */
export function remoteFor(candidates: readonly Candidate[] | null | undefined, full: string, host = "github.com"): string | null {
  return (candidates ?? []).find((c) => c.full.toLowerCase() === full.toLowerCase() && c.host === host)?.remote ?? null;
}

/** Head's state for pushPlan: the remote, the branch, whether GitHub has it, local commits it doesn't, tracking. */
export interface PushState {
  readonly remote: string | null;
  readonly head: string;
  readonly onRemote: boolean;
  readonly ahead?: number;
  readonly tracking?: boolean;
}

/** Why head needs pushing, and the git push argv. */
export interface PushPlan {
  readonly why: string;
  readonly args: readonly string[];
}

/** Whether head needs pushing before the pull request can point at it:
 *  null (it's there and current), or { why, args } with the git push argv.
 *  `onRemote`: GitHub has the branch; `ahead`: local commits it doesn't. */
export function pushPlan({ remote, head, onRemote, ahead = 0, tracking = false }: PushState): PushPlan | null {
  if (!remote || !head) return null;

  if (!onRemote) return { why: `${head} isn't on ${remote} yet`, args: ["push", "--set-upstream", remote, head] };

  if (ahead > 0) return { why: `${ahead} commit${ahead === 1 ? "" : "s"} of ${head} not on ${remote}`, args: tracking ? ["push", remote, head] : ["push", "--set-upstream", remote, head] };

  return null;
}

/** The new pull request form's answers (and a fork's owner, for a pull request into its parent). */
export interface PrFields {
  readonly base: string;
  readonly head: string;
  readonly title: string;
  readonly body?: string;
  readonly draft?: boolean;
  readonly reviewers?: readonly string[];
  readonly assignees?: readonly string[];
  readonly labels?: readonly string[];
  readonly milestone?: string;
  readonly headOwner?: string | null;
}

/** What's wrong with the form, per field. */
export interface PrErrors {
  base?: string;
  head?: string;
  title?: string;
}

/** What's wrong with the form, per field: { base?, head?, title? }. `commits`: between base and head, once read. */
export function prErrors(f: PrFields, { commits = null }: { readonly commits?: readonly Commit[] | null } = {}): PrErrors {
  const e: PrErrors = {};

  if (!f.base) e.base = "Pick the branch to merge into.";

  if (!f.head) e.head = "Pick the branch with the changes.";

  if (f.base && f.head && f.base === f.head && !f.headOwner) e.head = "Head and base are the same branch.";

  if (!f.title.trim()) e.title = "A pull request needs a title.";

  if (!e.head && !e.base && commits && commits.length === 0) e.head = `No commits between ${f.base} and ${f.head}.`;

  return e;
}

/** `gh pr create` argv (without -R). `headOwner`: a fork's owner, for a pull request into its parent. */
export function prArgs(f: PrFields): string[] {
  const args = ["pr", "create", "--base", f.base, "--head", f.headOwner ? `${f.headOwner}:${f.head}` : f.head, "--title", f.title.trim(), "--body", f.body ?? ""];

  if (f.draft) args.push("--draft");

  const lists = [["--reviewer", f.reviewers], ["--assignee", f.assignees], ["--label", f.labels]] as const;

  for (const [flag, list] of lists) if (list?.length) args.push(flag, list.join(","));

  if (f.milestone) args.push("--milestone", f.milestone);

  return args;
}

/** The new pull request's number, from what gh printed (its URL). */
export function createdNumber(out: string | null | undefined): number | null {
  const n = /\/pull\/(\d+)/.exec(out ?? "")?.[1];

  return n === undefined ? null : Number(n);
}
