// The real git CLI through the kit's Exec: reads (no locks, no index refresh,
// so the folder watch doesn't hear our own reads) and actions, each logged
// for the command log. Works on another machine (`on`) the same way: no
// files are written by this mod; patches, todos and messages travel in
// environment variables.
//
// A read that git refuses fails with an ExitError carrying git's last words
// (a corrupt repo, a ref that isn't one), where it used to read as an empty
// list. The few reads whose non-zero exit is an answer say so where they
// run: `log` in a repo without commits (128), `diff --no-index` with
// differences (1), the .git listing (`ls` of names that aren't there).

import { Array as Arr, Clock, Effect, Option, Schema, String as Str } from "effect";
import type { ExecResult } from "herdr";
import { Exec, ExitError, execOk, lastLine } from "@fireflies/kit";
import type { ExecError } from "@fireflies/kit";
import type { Branch, Commit, FullCommit, ReflogEntry, Remote, RemoteBranch, RepoState, StashEntry, Status, StatusFile, Tag, Worktree } from "./parse.ts";
import {
  parseStatus, parseLogFull, LOG_FULL_FORMAT, parseBranches, parseRemoteBranches, parseRemotes, parseTags, parseLog, parseReflog, parseStash, parseWorktrees, repoState,
  BRANCH_FORMAT, REMOTE_BRANCH_FORMAT, TAG_FORMAT, LOG_FORMAT, REFLOG_FORMAT, STASH_FORMAT, byPath, baseName,
} from "./parse.ts";
import type { DiffFile } from "./patch.ts";
import { HunkSchema, parseDiff } from "./patch.ts";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "-c", "color.ui=false"];
const DIFF = ["--no-ext-diff", "--no-textconv", "--no-color", "-M", "--src-prefix=a/", "--dst-prefix=b/"];

// Never wait for a password or an editor: a prompt would hang the call.
const QUIET = ["GIT_TERMINAL_PROMPT=0", "GIT_EDITOR=true", "GIT_MERGE_AUTOEDIT=no", "GCM_INTERACTIVE=never", "GIT_SSH_COMMAND=ssh -o BatchMode=yes"];
export const LOG_LIMIT = 300; // commits a list reads at a time (more as its end comes into view)
export const LOG_FULL_LIMIT = 200; // the branch log's, with whole messages
const UNTRACKED_MAX = 40;

/** What a git read or action can fail with: git couldn't run, or it refused. */
export type GitError = ExecError | ExitError;

/** Quotes an argument for the command log (and a pasted shell). */
export const shq = (a: string): string => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${Str.replace(/'/g, "'\\''")(a)}'`);

/** Arguments quoted and joined, as a shell line shows them. */
export const shell = (args: readonly string[]): string => Arr.join(Arr.map(args, shq), " ");

/** One action in the command log; heard when it starts (`ok` null) and again when it ends. */
export interface LogEntry {
  readonly title: string;
  readonly cmd: string;
  ok: boolean | null;
  out: string;
  readonly at: number;
}

/** Hears every action (Git's `log`). */
export type Logger = (entry: LogEntry) => void;

/** The variables an action hands git (a patch, a todo, a message travel this way, never as files). */
export interface Env {
  readonly NOCTURNE_GIT_PATCH?: string;
  readonly NOCTURNE_GIT_TODO?: string;
  readonly NOCTURNE_GIT_MSG?: string;
  readonly NOCTURNE_GIT_LINE?: string;
  readonly GIT_SEQUENCE_EDITOR?: string;
  readonly GIT_REFLOG_ACTION?: string;
}

const ENV_NAMES = ["NOCTURNE_GIT_PATCH", "NOCTURNE_GIT_TODO", "NOCTURNE_GIT_MSG", "NOCTURNE_GIT_LINE", "GIT_SEQUENCE_EDITOR", "GIT_REFLOG_ACTION"] as const satisfies readonly (keyof Env)[];

/** How an action runs: `env` extra variables; `shell` a sh -c script instead
 *  of git's arguments (for pipes), `shown` what the command log shows then. */
export interface RunOptions {
  readonly env?: Env;
  readonly shell?: string | null;
  readonly shown?: string | null;
  readonly timeout?: number;
}

/** How an action went: `err` is what to show when it failed. */
export interface RunResult {
  readonly ok: boolean;
  readonly out: string;
  readonly err: string;
  readonly code: number;
}

export interface ReadOptions {
  readonly timeout?: number;
}

/** A list of commits: every branch's (`all`), at most `limit`. */
export interface LogOptions {
  readonly all?: boolean;
  readonly limit?: number;
}

/** How a diff is read: staged (`cached`), lines of context, ignoring whitespace (`ws`), one path. */
export interface DiffOptions {
  readonly cached?: boolean;
  readonly context?: number;
  readonly ws?: boolean;
  readonly path?: string | null;
}

/** A commit as `git show` gives it, every file's diff included. */
export interface Shown {
  readonly hash: string;
  readonly parents: readonly string[];
  readonly author: string;
  readonly email: string;
  readonly date: number;
  /** %D as git printed it. */
  readonly refs: string;
  readonly body: string;
  readonly files: readonly DiffFile[];
}

/** A file's letter in `--name-status`: added, copied, deleted, modified, renamed, type changed, unmerged, unknown, broken. */
export const CommitStatusSchema = Schema.Literals(["A", "C", "D", "M", "R", "T", "U", "X", "B"]);

export type CommitStatus = typeof CommitStatusSchema.Type;

const isCommitStatus = Schema.is(CommitStatusSchema);

/** A file a commit (or stash entry) changed; `from` a rename's or copy's old path. */
export const CommitFileSchema = Schema.Struct({ status: CommitStatusSchema, from: Schema.optionalKey(Schema.String), path: Schema.String });

export type CommitFile = typeof CommitFileSchema.Type;

/** What review shows: "work" (uncommitted), "branch" (since the branch left main), "pr" (a pull request). */
export const ScopeSchema = Schema.Literals(["work", "branch", "pr"]);

export type Scope = typeof ScopeSchema.Type;

/** A review's files, and what they're since (the base, "#12"), null for uncommitted work. */
export interface Changes {
  readonly files: readonly DiffFile[];
  readonly since: string | null;
}

/** git's refusal as an ExitError: its last line, else what it ran. */
export const refused = (what: string, r: ExecResult): ExitError => {
  const said = lastLine(r.stderr);

  return ExitError.make({ command: what, code: r.code, stderr: r.stderr, message: Str.isEmpty(said) ? `${what} exited ${r.code}` : said });
};

/** The trimmed lines of `text` that aren't blank. */
export const nonBlank = (text: string, sep = "\n"): string[] => Arr.filter(Arr.map(Str.split(text, sep), Str.trim), Str.isNonEmpty);

/** The %x1f fields of `git show --format=…%x1e`'s head. */
const field = (fields: readonly string[], i: number): string => Option.getOrElse(Arr.get(fields, i), () => "");

/** Parses `git show --name-status -z` into files. */
function nameStatus(out: string): CommitFile[] {
  const parts = Arr.filter(Str.split(out, "\0"), (x, i) => Str.isNonEmpty(x) || i < Str.split(out, "\0").length - 1);
  const files: CommitFile[] = [];

  for (let i = 0; i < parts.length; i++) {
    const s = Str.trim(field(parts, i));

    if (Str.isEmpty(s)) continue;

    const letter = Str.slice(0, 1)(s);
    const status = isCommitStatus(letter) ? letter : "X";

    if (status === "R" || status === "C") {
      files.push({ status, from: field(parts, i + 1), path: field(parts, i + 2) });
      i += 2;
    } else {
      files.push({ status, path: field(parts, i + 1) });
      i += 1;
    }
  }

  return files;
}

export class Git {
  readonly root: string;
  readonly on: string | null;
  readonly onLog: Logger;

  /** `log(entry)` hears every action: { title, cmd, ok, out, at }. */
  constructor(root: string, on: string | null, log: Logger = () => {}) {
    this.root = root;
    this.on = on;
    this.onLog = log;
  }

  /** The repo holding `folder`, or none (not a repo); an ExecError when git couldn't run. */
  static open(folder: string, on: string | null, log?: Logger): Effect.Effect<Option.Option<Git>, ExecError, Exec> {
    return Effect.map(Exec.use((x) => x.run("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on })),
      (r) => (r.code === 0 ? Option.some(new Git(Str.trim(r.stdout), on, log)) : Option.none()));
  }

  get name(): string { return baseName(this.root); }

  /** A read: its exit and output, whatever the code. */
  read(args: readonly string[], opts: ReadOptions = {}): Effect.Effect<ExecResult, ExecError, Exec> {
    return Exec.use((x) => x.run("git", [...READ, ...args], { cwd: this.root, on: this.on, timeout: opts.timeout ?? 30000 }));
  }

  /** A read git must answer: its stdout, or an ExitError with git's last words. */
  out(args: readonly string[], opts?: ReadOptions): Effect.Effect<string, GitError, Exec> {
    return Effect.flatMap(this.read(args, opts), (r) => (r.code === 0 ? Effect.succeed(r.stdout) : Effect.fail(refused(`git ${args[0] ?? ""}`, r))));
  }

  /** A read whose refusal is an empty answer (each caller says when git exits non-zero for it). */
  outOrEmpty(args: readonly string[]): Effect.Effect<string, ExecError, Exec> {
    return Effect.map(this.read(args), (r) => (r.code === 0 ? r.stdout : ""));
  }

  /** Runs an action. `env`: extra variables (a patch, a todo, a message).
   *  `shell`: a sh -c script instead of git args (for pipes); `shown` is
   *  what the command log shows then. Never fails: a git that couldn't run
   *  is a result with code -1 and the reason, as a refusal is. */
  run(title: string, args: readonly string[], options: RunOptions = {}): Effect.Effect<RunResult, never, Exec> {
    const { env = {}, shell: script = null, shown = null, timeout = 60000 } = options;
    const vars = [...QUIET, ...Arr.flatMap(ENV_NAMES, (k) => Option.match(Option.fromUndefinedOr(env[k]), { onNone: () => [], onSome: (v) => [`${k}=${v}`] }))];
    const argv = script === null ? [...vars, "git", ...args] : [...vars, "sh", "-c", script];
    const log = this.onLog;
    const root = this.root, on = this.on;

    return Effect.gen(function* () {
      const entry: LogEntry = { title, cmd: shown ?? `git ${shell(args)}`, ok: null, out: "", at: yield* Clock.currentTimeMillis };

      log(entry);

      const r = yield* Exec.use((x) => x.run("env", argv, { cwd: root, on, timeout })).pipe(
        // git that couldn't run (gone, timed out) is a failed action like any other: its reason in the log and the error popup.
        Effect.catchTag("ExecError", (e) => Effect.succeed<ExecResult>({ code: -1, stdout: "", stderr: e.message })),
      );

      entry.ok = r.code === 0;
      entry.out = Str.trim(r.stdout + (Str.isEmpty(r.stderr) ? "" : `\n${r.stderr}`));
      log(entry);

      return { ok: r.code === 0, out: r.stdout, err: Str.trim(Str.isEmpty(r.stderr) ? r.stdout : r.stderr), code: r.code };
    });
  }

  /** A patch on stdin of `git apply` (from an environment variable). */
  apply(title: string, patch: string, flags: readonly string[]): Effect.Effect<RunResult, never, Exec> {
    const f = Arr.join(flags, " ");

    return this.run(title, [], { env: { NOCTURNE_GIT_PATCH: patch }, shell: `printf '%s' "$NOCTURNE_GIT_PATCH" | git apply ${f} -`, shown: `git apply ${f} <patch>` });
  }

  /** An interactive rebase whose todo history.ts wrote. */
  rebase(title: string, base: string | null, todo: string, env: Env = {}): Effect.Effect<RunResult, never, Exec> {
    return this.run(title, ["rebase", "-i", "--autostash", ...(base === null ? ["--root"] : [base])], {
      env: { ...env, NOCTURNE_GIT_TODO: todo, GIT_SEQUENCE_EDITOR: `sh -c 'printf "%s" "$NOCTURNE_GIT_TODO" > "$1"' -` },
      timeout: 120000,
    });
  }

  // ---- reads

  status(): Effect.Effect<Status, GitError, Exec> { return Effect.map(this.out(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]), parseStatus); }

  branches(): Effect.Effect<Branch[], GitError, Exec> { return Effect.map(this.out(["for-each-ref", "refs/heads", `--format=${BRANCH_FORMAT}`]), parseBranches); }

  remoteBranches(): Effect.Effect<RemoteBranch[], GitError, Exec> { return Effect.map(this.out(["for-each-ref", "refs/remotes", `--format=${REMOTE_BRANCH_FORMAT}`]), parseRemoteBranches); }

  remotes(): Effect.Effect<Remote[], GitError, Exec> { return Effect.map(this.out(["remote", "-v"]), parseRemotes); }

  tags(): Effect.Effect<Tag[], GitError, Exec> { return Effect.map(this.out(["for-each-ref", "refs/tags", "--sort=-creatordate", `--format=${TAG_FORMAT}`]), parseTags); }

  stash(): Effect.Effect<StashEntry[], GitError, Exec> { return Effect.map(this.out(["stash", "list", `--format=${STASH_FORMAT}`]), parseStash); }

  worktrees(): Effect.Effect<Worktree[], GitError, Exec> { return Effect.map(this.out(["worktree", "list", "--porcelain"]), parseWorktrees); }

  /** The reflog, newest first (none yet in a repo without commits). */
  // git exits 128 in a repo without commits: no reflog yet.
  reflog(n = 200): Effect.Effect<ReflogEntry[], ExecError, Exec> { return Effect.map(this.outOrEmpty(["log", "-g", `-${n}`, `--format=${REFLOG_FORMAT}`]), parseReflog); }

  /** Commits of `ref` (HEAD), newest first, in topo order like lazygit's graph.
   *  all: every branch (the Status panel's "all branch logs"). None in a repo
   *  without commits, or for a ref that isn't one. */
  log(ref = "HEAD", options: LogOptions = {}): Effect.Effect<Commit[], ExecError, Exec> {
    const { all = false, limit = LOG_LIMIT } = options;

    return Effect.map(this.outOrEmpty(["log", ...(all ? ["--all"] : [ref]), "--topo-order", "--decorate=full", `-${limit}`, `--format=${LOG_FORMAT}`, "--"]), parseLog);
  }

  /** A ref's history with whole messages, for the branch log in the main view. */
  logFull(ref: string, limit = LOG_FULL_LIMIT): Effect.Effect<FullCommit[], ExecError, Exec> {
    return Effect.map(this.outOrEmpty(["log", ref, "--topo-order", "--decorate=full", `-${limit}`, `--format=${LOG_FULL_FORMAT}`, "--"]), parseLogFull);
  }

  /** Hashes of `ref` not on `not` (unpushed, or not on main), as a Set; empty when either isn't a ref. */
  only(ref: string, not: string | null, limit = LOG_LIMIT): Effect.Effect<ReadonlySet<string>, ExecError, Exec> {
    if (not === null) return Effect.succeed(new Set<string>());

    return Effect.map(this.outOrEmpty(["rev-list", `--max-count=${limit}`, ref, `^${not}`, "--"]), (out) => new Set(nonBlank(out)));
  }

  /** The repo's main branch: origin/HEAD's, else main or master. */
  mainBranch(): Effect.Effect<string | null, ExecError, Exec> {
    return Effect.gen({ self: this }, function* () {
      const h = yield* this.read(["rev-parse", "--abbrev-ref", "origin/HEAD"]);

      if (h.code === 0) return Str.replace(/^origin\//, "")(Str.trim(h.stdout));

      for (const b of ["main", "master", "trunk", "develop"]) if ((yield* this.read(["rev-parse", "--verify", "-q", `refs/heads/${b}`])).code === 0) return b;

      return null;
    });
  }

  /** What the repo is in the middle of (rebasing, merging…), or null. `ls`
   *  exits non-zero for each name that isn't there: its stdout is the answer. */
  state(): Effect.Effect<RepoState | null, ExecError, Exec> {
    const script = 'cd "$(git rev-parse --git-dir)" 2>/dev/null && ls -d rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG 2>/dev/null';

    return Effect.map(Exec.use((x) => x.run("sh", ["-c", script], { cwd: this.root, on: this.on })), (r) => repoState(new Set(nonBlank(r.stdout))));
  }

  // ---- diffs for the main view

  /** A diff git must give: exit 0, or 1 for "there are differences" (`--no-index`). */
  diffOut(args: readonly string[]): Effect.Effect<DiffFile[], GitError, Exec> {
    return Effect.flatMap(this.read(args), (r) => (r.code <= 1 && r.code >= 0 ? Effect.succeed(parseDiff(r.stdout)) : Effect.fail(refused(`git ${args[0] ?? ""}`, r))));
  }

  /** A working-tree file's unstaged (cached false) or staged diff, parsed. */
  fileDiff(f: Pick<StatusFile, "path" | "untracked" | "from">, options: DiffOptions = {}): Effect.Effect<DiffFile | null, GitError, Exec> {
    const { cached = false, context = 3, ws = false } = options;
    const flags = [...DIFF, `-U${context}`, ...(ws ? ["-w"] : [])];

    const args = f.untracked && !cached
      ? ["diff", ...flags, "--no-index", "--", "/dev/null", f.path]
      : ["diff", ...flags, ...(cached ? ["--cached"] : []), "--", f.path, ...(f.from === null ? [] : [f.from])];

    return Effect.map(this.diffOut(args), (files) => Option.getOrNull(Arr.head(files)));
  }

  /** A commit: its header fields and every file's diff; none when it isn't a commit. */
  show(hash: string, options: DiffOptions = {}): Effect.Effect<Option.Option<Shown>, ExecError, Exec> {
    const { context = 3, ws = false, path = null } = options;
    const args = ["show", ...DIFF, `-U${context}`, ...(ws ? ["-w"] : []), "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%B%x1e", hash, "--", ...(path === null ? [] : [path])];

    return Effect.map(this.read(args), (r): Option.Option<Shown> => {
      if (r.code !== 0) return Option.none();

      const cut = Option.getOrElse(Str.indexOf("\x1e")(r.stdout), () => r.stdout.length);
      const f = Str.split(Str.slice(0, cut)(r.stdout), "\x1f");
      const parents = field(f, 1);

      return Option.some({
        hash: field(f, 0), parents: Str.isEmpty(parents) ? [] : Str.split(parents, " "), author: field(f, 2), email: field(f, 3), date: Number(field(f, 4)),
        refs: field(f, 5), body: Str.trim(field(f, 6)), files: parseDiff(Str.slice(cut + 1)(r.stdout)),
      });
    });
  }

  /** The files a commit (or stash entry) changed: [{ path, status }]. */
  commitFiles(hash: string): Effect.Effect<CommitFile[], GitError, Exec> {
    return Effect.map(this.out(["show", "--format=", "--name-status", "-M", "-z", hash, "--"]), nameStatus);
  }

  /** A stash entry's patch (untracked files included where git can). */
  stashShow(ref: string, opts: DiffOptions = {}): Effect.Effect<DiffFile[], GitError, Exec> {
    return Effect.gen({ self: this }, function* () {
      const r = yield* this.read(["stash", "show", "-p", "--include-untracked", ...DIFF, `-U${opts.context ?? 3}`, ref]);

      if (r.code === 0) return parseDiff(r.stdout);

      // A git older than --include-untracked: the tracked changes.
      const tracked = yield* this.out(["stash", "show", "-p", ...DIFF, ref]);

      return parseDiff(tracked);
    });
  }

  /** A diff between two refs (W, the diffing menu); a ref that isn't one is git's refusal. */
  between(a: string, b: string | null, opts: DiffOptions = {}): Effect.Effect<DiffFile[], GitError, Exec> {
    const { context = 3, ws = false, path = null } = opts;

    return this.diffOut(["diff", ...DIFF, `-U${context}`, ...(ws ? ["-w"] : []), a, ...(b === null ? [] : [b]), "--", ...(path === null ? [] : [path])]);
  }

  // ---- review (diff's scopes)

  /** Changes in a scope: "work" (uncommitted: staged, unstaged, untracked) or
   *  "branch" (since the branch left `base`, uncommitted included). */
  review(scope: Scope, base: string | null, hasHead: boolean): Effect.Effect<Changes, GitError, Exec> {
    return Effect.gen({ self: this }, function* () {
      let from = hasHead ? "HEAD" : null, since: string | null = null;

      if (scope === "branch" && base !== null) {
        const mb = yield* this.read(["merge-base", "HEAD", base]);

        if (mb.code === 0) {
          from = Str.trim(mb.stdout);
          since = base;
        }
      }

      const files = yield* this.diffOut(["diff", ...DIFF, ...(from === null ? ["--cached"] : [from])]);
      const others = yield* this.out(["ls-files", "--others", "--exclude-standard", "-z"]);
      const untracked = Arr.filter(Str.split(others, "\0"), Str.isNonEmpty);

      const added = yield* Effect.forEach(untracked, (path, i) => Effect.map(
        i < UNTRACKED_MAX ? this.diffOut(["diff", ...DIFF, "--no-index", "--", "/dev/null", path]) : Effect.succeed([]),
        (diffs): DiffFile => Option.match(Arr.head(diffs), {
          onNone: () => ({ path, old: null, status: "untracked", add: 0, del: 0, binary: false, hunks: [], header: [] }),
          onSome: (f) => ({ ...f, status: "untracked", path }),
        }),
      ), { concurrency: 1 });

      return { files: Arr.sort([...files, ...added], byPath<DiffFile>()), since };
    });
  }

  /** A pull request's changes (`gh pr diff`; `repo` "owner/name" names a fork's parent). */
  prReview(pr: number, repo: string | null = null): Effect.Effect<Changes, GitError, Exec> {
    return Effect.map(execOk("gh", ["pr", "diff", String(pr), "--color=never", ...(repo === null ? [] : ["-R", repo])], { cwd: this.root, on: this.on, timeout: 60000 }),
      (out) => ({ files: Arr.sort(parseDiff(out), byPath<DiffFile>()), since: `#${pr}` }));
  }
}

const hunksJson = Schema.encodeOption(Schema.fromJsonString(Schema.Array(HunkSchema)));

/** A key for a file's diff: a review mark holds while the diff is unchanged. */
export function diffKey(f: Pick<DiffFile, "path" | "hunks">): string {
  let h = 2166136261;
  // The hunks as the JSON diff's marks were always keyed by (diff.reviewed keeps them).
  const s = f.path + Option.getOrElse(hunksJson(f.hunks), () => "");

  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ Option.getOrElse(Str.charCodeAt(s, i), () => 0), 16777619);

  return `${f.path}:${(h >>> 0).toString(36)}`;
}
