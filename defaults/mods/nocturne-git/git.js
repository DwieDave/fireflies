// The real git CLI through herdr's exec: reads (no locks, no index refresh,
// so the folder watch doesn't hear our own reads) and actions, each logged
// for the command log. Works on another machine (`on`) the same way: no
// files are written by this mod; patches, todos and messages travel in
// environment variables.

import { exec } from "herdr";
import {
  parseStatus, parseBranches, parseRemoteBranches, parseRemotes, parseTags, parseLog, parseReflog, parseStash, parseWorktrees, repoState,
  BRANCH_FORMAT, REMOTE_BRANCH_FORMAT, TAG_FORMAT, LOG_FORMAT, REFLOG_FORMAT, STASH_FORMAT,
} from "./parse.js";
import { parseDiff } from "./patch.js";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "-c", "color.ui=false"];
const DIFF = ["--no-ext-diff", "--no-textconv", "--no-color", "-M", "--src-prefix=a/", "--dst-prefix=b/"];
// Never wait for a password or an editor: a prompt would hang the call.
const QUIET = ["GIT_TERMINAL_PROMPT=0", "GIT_EDITOR=true", "GIT_MERGE_AUTOEDIT=no", "GCM_INTERACTIVE=never", "GIT_SSH_COMMAND=ssh -o BatchMode=yes"];
export const LOG_LIMIT = 300;
const UNTRACKED_MAX = 40;

/** Quotes an argument for the command log (and a pasted shell). */
export const shq = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${String(a).replace(/'/g, "'\\''")}'`);

export class Git {
  /** `log(entry)` hears every action: { title, cmd, ok, out, at }. */
  constructor(root, on, log) {
    this.root = root; this.on = on ?? null; this.onLog = log ?? (() => {});
  }

  /** The repo holding `folder`, or null. */
  static async open(folder, on, log) {
    const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on: on ?? undefined });
    if (r.code !== 0) return null;
    return new Git(r.stdout.trim(), on, log);
  }

  get name() { return this.root.split("/").pop(); }

  read(args, opts = {}) {
    return exec("git", [...READ, ...args], { cwd: this.root, on: this.on ?? undefined, timeout: opts.timeout ?? 30000 });
  }

  async text(args, opts) {
    const r = await this.read(args, opts);
    return r.code === 0 ? r.stdout : "";
  }

  /** Runs an action. `env`: extra variables (a patch, a todo, a message).
   *  `shell`: a sh -c script instead of git args (for pipes); `shown` is
   *  what the command log shows then. Resolves { ok, out, err, code }. */
  async run(title, args, { env = {}, shell = null, shown = null, timeout = 60000 } = {}) {
    const vars = [...QUIET, ...Object.entries(env).map(([k, v]) => `${k}=${v}`)];
    const argv = shell ? [...vars, "sh", "-c", shell] : [...vars, "git", ...args];
    const cmd = shown ?? `git ${args.map(shq).join(" ")}`;
    const entry = { title, cmd, ok: null, out: "", at: Date.now() };
    this.onLog(entry);
    let r;
    try {
      r = await exec("env", argv, { cwd: this.root, on: this.on ?? undefined, timeout });
    } catch (e) {
      r = { code: -1, stdout: "", stderr: String(e?.message ?? e) };
    }
    entry.ok = r.code === 0;
    entry.out = (r.stdout + (r.stderr ? `\n${r.stderr}` : "")).trim();
    this.onLog(entry);
    return { ok: r.code === 0, out: r.stdout, err: (r.stderr || r.stdout).trim(), code: r.code };
  }

  /** A patch on stdin of `git apply` (from an environment variable). */
  apply(title, patch, flags) {
    return this.run(title, [], {
      env: { NOCTURNE_GIT_PATCH: patch },
      shell: `printf '%s' "$NOCTURNE_GIT_PATCH" | git apply ${flags.join(" ")} -`,
      shown: `git apply ${flags.join(" ")} <patch>`,
    });
  }

  /** An interactive rebase whose todo history.js wrote. */
  rebase(title, base, todo, env = {}) {
    return this.run(title, ["rebase", "-i", "--autostash", ...(base ? [base] : ["--root"])], {
      env: { ...env, NOCTURNE_GIT_TODO: todo, GIT_SEQUENCE_EDITOR: `sh -c 'printf "%s" "$NOCTURNE_GIT_TODO" > "$1"' -` },
      timeout: 120000,
    });
  }

  // ---- reads

  async status() { return parseStatus(await this.text(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"])); }
  async branches() { return parseBranches(await this.text(["for-each-ref", "refs/heads", `--format=${BRANCH_FORMAT}`])); }
  async remoteBranches() { return parseRemoteBranches(await this.text(["for-each-ref", "refs/remotes", `--format=${REMOTE_BRANCH_FORMAT}`])); }
  async remotes() { return parseRemotes(await this.text(["remote", "-v"])); }
  async tags() { return parseTags(await this.text(["for-each-ref", "refs/tags", "--sort=-creatordate", `--format=${TAG_FORMAT}`])); }
  async stash() { return parseStash(await this.text(["stash", "list", `--format=${STASH_FORMAT}`])); }
  async worktrees() { return parseWorktrees(await this.text(["worktree", "list", "--porcelain"])); }
  async reflog(n = 200) { return parseReflog(await this.text(["log", "-g", `-${n}`, `--format=${REFLOG_FORMAT}`])); }

  /** Commits of `ref` (HEAD), newest first, in topo order like lazygit's graph.
   *  all: every branch (the Status panel's "all branch logs"). */
  async log(ref = "HEAD", { all = false, limit = LOG_LIMIT } = {}) {
    const r = await this.read(["log", ...(all ? ["--all"] : [ref]), "--topo-order", `-${limit}`, `--format=${LOG_FORMAT}`, "--"]);
    return r.code === 0 ? parseLog(r.stdout) : [];
  }

  /** Hashes of `ref` not on `not` (unpushed, or not on main), as a Set. */
  async only(ref, not, limit = LOG_LIMIT) {
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
  async state() {
    const r = await exec("sh", ["-c", 'cd "$(git rev-parse --git-dir)" 2>/dev/null && ls -d rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG 2>/dev/null'], { cwd: this.root, on: this.on ?? undefined });
    const exists = Object.fromEntries(r.stdout.split("\n").filter(Boolean).map((n) => [n.trim(), true]));
    return repoState(exists);
  }

  // ---- diffs for the main view

  /** A working-tree file's unstaged (cached false) or staged diff, parsed. */
  async fileDiff(f, { cached = false, context = 3, ws = false } = {}) {
    const flags = [...DIFF, `-U${context}`, ...(ws ? ["-w"] : [])];
    if (f.untracked && !cached) {
      const r = await this.read(["diff", ...flags, "--no-index", "--", "/dev/null", f.path]);
      return parseDiff(r.stdout)[0] ?? null;
    }
    const r = await this.read(["diff", ...flags, ...(cached ? ["--cached"] : []), "--", f.path, ...(f.from ? [f.from] : [])]);
    return parseDiff(r.stdout)[0] ?? null;
  }

  /** A commit: its header fields and every file's diff. */
  async show(hash, { context = 3, ws = false, path = null } = {}) {
    const r = await this.read(["show", ...DIFF, `-U${context}`, ...(ws ? ["-w"] : []), "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%B%x1e", hash, "--", ...(path ? [path] : [])]);
    if (r.code !== 0) return null;
    const cut = r.stdout.indexOf("\x1e");
    const [h, parents, author, email, date, refs, body] = r.stdout.slice(0, cut).split("\x1f");
    return { hash: h, parents: parents ? parents.split(" ") : [], author, email, date: +date, refs, body: (body ?? "").trim(), files: parseDiff(r.stdout.slice(cut + 1)) };
  }

  /** The files a commit (or stash entry) changed: [{ path, status }]. */
  async commitFiles(hash) {
    const r = await this.read(["show", "--format=", "--name-status", "-M", "-z", hash, "--"]);
    const out = [];
    const parts = r.stdout.split("\0").filter((x, i, a) => x || i < a.length - 1);
    for (let i = 0; i < parts.length; i++) {
      const s = parts[i].trim();
      if (!s) continue;
      if (s[0] === "R" || s[0] === "C") { out.push({ status: s[0], from: parts[i + 1], path: parts[i + 2] }); i += 2; }
      else { out.push({ status: s[0], path: parts[i + 1] }); i += 1; }
    }
    return out;
  }

  /** A stash entry's patch. */
  async stashShow(ref, opts = {}) {
    const r = await this.read(["stash", "show", "-p", "--include-untracked", ...DIFF, `-U${opts.context ?? 3}`, ref]);
    if (r.code === 0) return parseDiff(r.stdout);
    const r2 = await this.read(["stash", "show", "-p", ...DIFF, ref]);
    return parseDiff(r2.stdout);
  }

  /** A diff between two refs (W, the diffing menu). */
  async between(a, b, opts = {}) {
    const r = await this.read(["diff", ...DIFF, `-U${opts.context ?? 3}`, ...(opts.ws ? ["-w"] : []), a, ...(b ? [b] : []), "--", ...(opts.path ? [opts.path] : [])]);
    return parseDiff(r.stdout);
  }

  // ---- review (nocturne-diff's scopes)

  /** Changes in a scope: "work" (uncommitted: staged, unstaged, untracked) or
   *  "branch" (since the branch left `base`, uncommitted included). */
  async review(scope, base, hasHead) {
    let from = hasHead ? "HEAD" : null, since = null;
    if (scope === "branch" && base) {
      const mb = await this.read(["merge-base", "HEAD", base]);
      if (mb.code === 0) { from = mb.stdout.trim(); since = base; }
    }
    const diff = await this.read(["diff", ...DIFF, ...(from ? [from] : ["--cached"])]);
    const files = parseDiff(diff.stdout);
    const untracked = (await this.read(["ls-files", "--others", "--exclude-standard", "-z"])).stdout.split("\0").filter(Boolean);
    for (const [i, path] of untracked.entries()) {
      if (i < UNTRACKED_MAX) {
        const u = await this.read(["diff", ...DIFF, "--no-index", "--", "/dev/null", path]);
        const [f] = parseDiff(u.stdout);
        if (f) { f.status = "untracked"; f.path = path; files.push(f); continue; }
      }
      files.push({ path, old: null, status: "untracked", add: 0, del: 0, binary: false, hunks: [], header: [] });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, since };
  }

  /** A pull request's changes (`gh pr diff`; `repo` "owner/name" names a fork's parent). */
  async prReview(pr, repo = null) {
    const d = await exec("gh", ["pr", "diff", String(pr), "--color=never", ...(repo ? ["-R", repo] : [])], { cwd: this.root, on: this.on ?? undefined, timeout: 60000 });
    if (d.code !== 0) throw new Error(d.stderr.trim().split("\n").pop() || `gh pr diff ${pr} failed`);
    const files = parseDiff(d.stdout);
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, since: `#${pr}` };
  }
}

/** A key for a file's diff: a review mark holds while the diff is unchanged. */
export function diffKey(f) {
  let h = 2166136261;
  const s = f.path + JSON.stringify(f.hunks ?? []);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `${f.path}:${(h >>> 0).toString(36)}`;
}
