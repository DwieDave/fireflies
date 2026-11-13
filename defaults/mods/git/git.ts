// The real git CLI through herdr's exec: reads (no locks, no index refresh,
// so the folder watch doesn't hear our own reads) and actions, each logged
// for the command log. Works on another machine (`on`) the same way: no
// files are written by this mod; patches, todos and messages travel in
// environment variables.

import { exec } from "herdr";
import type { ExecResult } from "herdr";
import { literal } from "./guard.ts";
import type { Branch, Commit, FullCommit, ReflogEntry, Remote, RemoteBranch, RepoState, StashEntry, Status, StatusFile, Tag, Worktree } from "./parse.ts";
import {
  parseStatus, parseLogFull, LOG_FULL_FORMAT, parseBranches, parseRemoteBranches, parseRemotes, parseTags, parseLog, parseReflog, parseStash, parseWorktrees, repoState,
  BRANCH_FORMAT, REMOTE_BRANCH_FORMAT, TAG_FORMAT, LOG_FORMAT, REFLOG_FORMAT, STASH_FORMAT,
} from "./parse.ts";
import type { DiffFile } from "./patch.ts";
import { parseDiff } from "./patch.ts";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "-c", "color.ui=false"];
const DIFF = ["--no-ext-diff", "--no-textconv", "--no-color", "-M", "--src-prefix=a/", "--dst-prefix=b/"];

// Never wait for a password or an editor: a prompt would hang the call.
const QUIET = ["GIT_TERMINAL_PROMPT=0", "GIT_EDITOR=true", "GIT_MERGE_AUTOEDIT=no", "GCM_INTERACTIVE=never", "GIT_SSH_COMMAND=ssh -o BatchMode=yes"];
export const LOG_LIMIT = 300; // commits a list reads at a time (more as its end comes into view)
export const LOG_FULL_LIMIT = 200; // the branch log's, with whole messages
const UNTRACKED_MAX = 40;

/** Quotes an argument for the command log (and a pasted shell). */
export const shq = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`);

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
export type CommitStatus = "A" | "C" | "D" | "M" | "R" | "T" | "U" | "X" | "B";

const isCommitStatus = literal("A", "C", "D", "M", "R", "T", "U", "X", "B");

/** A file a commit (or stash entry) changed; `from` a rename's or copy's old path. */
export interface CommitFile {
  readonly status: CommitStatus;
  readonly from?: string;
  readonly path: string;
}

/** What review shows: "work" (uncommitted), "branch" (since the branch left main), "pr" (a pull request). */
export type Scope = "work" | "branch" | "pr";

/** A review's files, and what they're since (the base, "#12"), null for uncommitted work. */
export interface Changes {
  readonly files: readonly DiffFile[];
  readonly since: string | null;
}

export class Git {
  readonly root: string;
  readonly on: string | null;
  readonly onLog: Logger;

  /** `log(entry)` hears every action: { title, cmd, ok, out, at }. */
  constructor(root: string, on: string | null, log?: Logger) {
    this.root = root;
    this.on = on;
    this.onLog = log ?? (() => {});
  }

  /** The repo holding `folder`, or null. */
  static async open(folder: string, on: string | null, log?: Logger) {
    const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });

    if (r.code !== 0) return null;

    return new Git(r.stdout.trim(), on, log);
  }

  get name() { return this.root.split("/").pop() ?? this.root; }

  read(args: readonly string[], opts: ReadOptions = {}) {
    return exec("git", [...READ, ...args], { cwd: this.root, on: this.on, timeout: opts.timeout ?? 30000 });
  }

  async text(args: readonly string[], opts?: ReadOptions) {
    const r = await this.read(args, opts);

    return r.code === 0 ? r.stdout : "";
  }

  /** Runs an action. `env`: extra variables (a patch, a todo, a message).
   *  `shell`: a sh -c script instead of git args (for pipes); `shown` is
   *  what the command log shows then. Resolves { ok, out, err, code }. */
  async run(title: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
    const { env = {}, shell = null, shown = null, timeout = 60000 } = options;

    const vars = [...QUIET, ...ENV_NAMES.flatMap((k) => {
      const v = env[k];

      return v === undefined ? [] : [`${k}=${v}`];
    })];

    const argv = shell ? [...vars, "sh", "-c", shell] : [...vars, "git", ...args];
    const cmd = shown ?? `git ${args.map(shq).join(" ")}`;
    const entry: LogEntry = { title, cmd, ok: null, out: "", at: Date.now() };

    this.onLog(entry);

    let r: ExecResult;

    try {
      r = await exec("env", argv, { cwd: this.root, on: this.on, timeout });
    } catch (cause: unknown) {
      r = { code: -1, stdout: "", stderr: cause instanceof Error ? cause.message : String(cause) };
    }

    entry.ok = r.code === 0;
    entry.out = (r.stdout + (r.stderr ? `\n${r.stderr}` : "")).trim();
    this.onLog(entry);

    return { ok: r.code === 0, out: r.stdout, err: (r.stderr || r.stdout).trim(), code: r.code };
  }

  /** A patch on stdin of `git apply` (from an environment variable). */
  apply(title: string, patch: string, flags: readonly string[]) {
    return this.run(title, [], {
      env: { NOCTURNE_GIT_PATCH: patch },
      shell: `printf '%s' "$NOCTURNE_GIT_PATCH" | git apply ${flags.join(" ")} -`,
      shown: `git apply ${flags.join(" ")} <patch>`,
    });
  }

  /** An interactive rebase whose todo history.ts wrote. */
  rebase(title: string, base: string | null, todo: string, env: Env = {}) {
    return this.run(title, ["rebase", "-i", "--autostash", ...(base ? [base] : ["--root"])], {
      env: { ...env, NOCTURNE_GIT_TODO: todo, GIT_SEQUENCE_EDITOR: `sh -c 'printf "%s" "$NOCTURNE_GIT_TODO" > "$1"' -` },
      timeout: 120000,
    });
  }

  // ---- reads

  async status(): Promise<Status> { return parseStatus(await this.text(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"])); }

  async branches(): Promise<Branch[]> { return parseBranches(await this.text(["for-each-ref", "refs/heads", `--format=${BRANCH_FORMAT}`])); }

  async remoteBranches(): Promise<RemoteBranch[]> { return parseRemoteBranches(await this.text(["for-each-ref", "refs/remotes", `--format=${REMOTE_BRANCH_FORMAT}`])); }

  async remotes(): Promise<Remote[]> { return parseRemotes(await this.text(["remote", "-v"])); }

  async tags(): Promise<Tag[]> { return parseTags(await this.text(["for-each-ref", "refs/tags", "--sort=-creatordate", `--format=${TAG_FORMAT}`])); }

  async stash(): Promise<StashEntry[]> { return parseStash(await this.text(["stash", "list", `--format=${STASH_FORMAT}`])); }

  async worktrees(): Promise<Worktree[]> { return parseWorktrees(await this.text(["worktree", "list", "--porcelain"])); }

  async reflog(n = 200): Promise<ReflogEntry[]> { return parseReflog(await this.text(["log", "-g", `-${n}`, `--format=${REFLOG_FORMAT}`])); }

  /** Commits of `ref` (HEAD), newest first, in topo order like lazygit's graph.
   *  all: every branch (the Status panel's "all branch logs"). */
  async log(ref = "HEAD", options: LogOptions = {}): Promise<Commit[]> {
    const { all = false, limit = LOG_LIMIT } = options;
    const r = await this.read(["log", ...(all ? ["--all"] : [ref]), "--topo-order", "--decorate=full", `-${limit}`, `--format=${LOG_FORMAT}`, "--"]);

    return r.code === 0 ? parseLog(r.stdout) : [];
  }

  /** A ref's history with whole messages, for the branch log in the main view. */
  async logFull(ref: string, limit = LOG_FULL_LIMIT): Promise<FullCommit[]> {
    const r = await this.read(["log", ref, "--topo-order", "--decorate=full", `-${limit}`, `--format=${LOG_FULL_FORMAT}`, "--"]);

    return r.code === 0 ? parseLogFull(r.stdout) : [];
  }

  /** Hashes of `ref` not on `not` (unpushed, or not on main), as a Set. */
  async only(ref: string, not: string | null, limit = LOG_LIMIT): Promise<Set<string>> {
    if (!not) return new Set();

    const r = await this.read(["rev-list", `--max-count=${limit}`, ref, `^${not}`, "--"]);

    return new Set(r.code === 0 ? r.stdout.split("\n").filter(Boolean) : []);
  }

  /** The repo's main branch: origin/HEAD's, else main or master. */
  async mainBranch() {
    const h = await this.read(["rev-parse", "--abbrev-ref", "origin/HEAD"]);

    if (h.code === 0) return h.stdout.trim().replace(/^origin\//, "");

    for (const b of ["main", "master", "trunk", "develop"]) if ((await this.read(["rev-parse", "--verify", "-q", `refs/heads/${b}`])).code === 0) return b;

    return null;
  }

  /** What the repo is in the middle of (rebasing, merging…), or null. */
  async state(): Promise<RepoState | null> {
    const r = await exec("sh", ["-c", 'cd "$(git rev-parse --git-dir)" 2>/dev/null && ls -d rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG 2>/dev/null'], { cwd: this.root, on: this.on });
    const exists = new Set(r.stdout.split("\n").filter(Boolean).map((n) => n.trim()));

    return repoState(exists);
  }

  // ---- diffs for the main view

  /** A working-tree file's unstaged (cached false) or staged diff, parsed. */
  async fileDiff(f: Pick<StatusFile, "path" | "untracked" | "from">, options: DiffOptions = {}) {
    const { cached = false, context = 3, ws = false } = options;
    const flags = [...DIFF, `-U${context}`, ...(ws ? ["-w"] : [])];

    if (f.untracked && !cached) {
      const r = await this.read(["diff", ...flags, "--no-index", "--", "/dev/null", f.path]);

      return parseDiff(r.stdout)[0] ?? null;
    }

    const r = await this.read(["diff", ...flags, ...(cached ? ["--cached"] : []), "--", f.path, ...(f.from ? [f.from] : [])]);

    return parseDiff(r.stdout)[0] ?? null;
  }

  /** A commit: its header fields and every file's diff. */
  async show(hash: string, options: DiffOptions = {}): Promise<Shown | null> {
    const { context = 3, ws = false, path = null } = options;
    const r = await this.read(["show", ...DIFF, `-U${context}`, ...(ws ? ["-w"] : []), "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%B%x1e", hash, "--", ...(path ? [path] : [])]);

    if (r.code !== 0) return null;

    const cut = r.stdout.indexOf("\x1e");
    const [h = "", parents, author = "", email = "", date, refs = "", body] = r.stdout.slice(0, cut).split("\x1f");

    return { hash: h, parents: parents ? parents.split(" ") : [], author, email, date: Number(date), refs, body: (body ?? "").trim(), files: parseDiff(r.stdout.slice(cut + 1)) };
  }

  /** The files a commit (or stash entry) changed: [{ path, status }]. */
  async commitFiles(hash: string): Promise<CommitFile[]> {
    const r = await this.read(["show", "--format=", "--name-status", "-M", "-z", hash, "--"]);
    const out: CommitFile[] = [];
    const parts = r.stdout.split("\0").filter((x, i, a) => x || i < a.length - 1);

    for (let i = 0; i < parts.length; i++) {
      const s = (parts[i] ?? "").trim();
      const letter = s[0];
      const status = isCommitStatus(letter) ? letter : "X";

      if (!s) continue;

      if (status === "R" || status === "C") {
        out.push({ status, from: parts[i + 1] ?? "", path: parts[i + 2] ?? "" });
        i += 2;
      } else {
        out.push({ status, path: parts[i + 1] ?? "" });
        i += 1;
      }
    }

    return out;
  }

  /** A stash entry's patch. */
  async stashShow(ref: string, opts: DiffOptions = {}) {
    const r = await this.read(["stash", "show", "-p", "--include-untracked", ...DIFF, `-U${opts.context ?? 3}`, ref]);

    if (r.code === 0) return parseDiff(r.stdout);

    const r2 = await this.read(["stash", "show", "-p", ...DIFF, ref]);

    return parseDiff(r2.stdout);
  }

  /** A diff between two refs (W, the diffing menu). */
  async between(a: string, b: string | null, opts: DiffOptions = {}) {
    const r = await this.read(["diff", ...DIFF, `-U${opts.context ?? 3}`, ...(opts.ws ? ["-w"] : []), a, ...(b ? [b] : []), "--", ...(opts.path ? [opts.path] : [])]);

    return parseDiff(r.stdout);
  }

  // ---- review (diff's scopes)

  /** Changes in a scope: "work" (uncommitted: staged, unstaged, untracked) or
   *  "branch" (since the branch left `base`, uncommitted included). */
  async review(scope: Scope, base: string | null, hasHead: boolean): Promise<Changes> {
    let from = hasHead ? "HEAD" : null, since: string | null = null;

    if (scope === "branch" && base) {
      const mb = await this.read(["merge-base", "HEAD", base]);

      if (mb.code === 0) {
        from = mb.stdout.trim();
        since = base;
      }
    }

    const diff = await this.read(["diff", ...DIFF, ...(from ? [from] : ["--cached"])]);
    const files = parseDiff(diff.stdout);
    const untracked = (await this.read(["ls-files", "--others", "--exclude-standard", "-z"])).stdout.split("\0").filter(Boolean);

    for (const [i, path] of untracked.entries()) {
      if (i < UNTRACKED_MAX) {
        const u = await this.read(["diff", ...DIFF, "--no-index", "--", "/dev/null", path]);
        const [f] = parseDiff(u.stdout);

        if (f) {
          files.push({ ...f, status: "untracked", path });
          continue;
        }
      }

      files.push({ path, old: null, status: "untracked", add: 0, del: 0, binary: false, hunks: [], header: [] });
    }

    files.sort((a, b) => a.path.localeCompare(b.path));

    return { files, since };
  }

  /** A pull request's changes (`gh pr diff`; `repo` "owner/name" names a fork's parent). */
  async prReview(pr: number, repo: string | null = null): Promise<Changes> {
    const d = await exec("gh", ["pr", "diff", String(pr), "--color=never", ...(repo ? ["-R", repo] : [])], { cwd: this.root, on: this.on, timeout: 60000 });

    if (d.code !== 0) throw new Error(d.stderr.trim().split("\n").pop() || `gh pr diff ${pr} failed`);

    const files = parseDiff(d.stdout);

    files.sort((a, b) => a.path.localeCompare(b.path));

    return { files, since: `#${pr}` };
  }
}

/** A key for a file's diff: a review mark holds while the diff is unchanged. */
export function diffKey(f: Pick<DiffFile, "path" | "hunks">) {
  let h = 2166136261;
  const s = f.path + JSON.stringify(f.hunks);

  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);

  return `${f.path}:${(h >>> 0).toString(36)}`;
}
