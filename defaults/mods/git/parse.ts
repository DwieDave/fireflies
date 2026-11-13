// Reading git's plain output into the panels' rows. Pure: no herdr, so the
// tests run them on fixtures (scripts/git.test.ts). The formats are
// what git.js asks for: NUL-separated fields, porcelain v2 status.

import { literal } from "./guard.ts";

export const SEP = "\x1f"; // field separator in --format strings (%x1f)

/** One of a file's two status letters (index, work tree), as lazygit shows
 *  them: git's porcelain v2 letters with "." as " ", and "?" for untracked. */
export type Letter = " " | "M" | "T" | "A" | "D" | "R" | "C" | "U" | "?";

const isLetter = literal(" ", "M", "T", "A", "D", "R", "C", "U", "?");

/** A letter of porcelain v2's XY ("." is unchanged); one git adds later reads as modified. */
const letterOf = (c: string | undefined): Letter => {
  const l = c === "." ? " " : c;

  return isLetter(l) ? l : "M";
};

/** A changed path in the working tree (parseStatus). */
export interface StatusFile {
  readonly path: string;
  /** A rename's or copy's old path. */
  readonly from: string | null;
  readonly x: Letter;
  readonly y: Letter;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly untracked: boolean;
  readonly conflict: boolean;
}

/** The branch line and every changed path (parseStatus). */
export interface Status {
  readonly head: string | null;
  readonly oid: string | null;
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly files: readonly StatusFile[];
}

/** `git status --porcelain=v2 --branch -z --untracked-files=all`: the branch
 *  line and every changed path with lazygit's two status letters (index, work
 *  tree: "M ", " M", "MM", "A ", "??", "UU"…). */
export function parseStatus(text: string): Status {
  let head: string | null = null, oid: string | null = null, upstream: string | null = null, ahead = 0, behind = 0;
  const files: StatusFile[] = [];
  const parts = text.split("\0");

  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];

    if (!line) continue;

    if (line.startsWith("# ")) {
      const [, key, ...rest] = line.split(" ");
      const val = rest.join(" ");

      if (key === "branch.head") head = val === "(detached)" ? null : val;
      else if (key === "branch.oid") oid = val === "(initial)" ? null : val;
      else if (key === "branch.upstream") upstream = val;
      else if (key === "branch.ab") {
        const m = /\+(\d+) -(\d+)/.exec(val);

        if (m) {
          ahead = Number(m[1]);
          behind = Number(m[2]);
        }
      }

      continue;
    }

    const kind = line[0];
    const f = line.split(" ");

    if (kind === "1") files.push(file(f[1] ?? "", f.slice(8).join(" ")));
    else if (kind === "2") files.push(file(f[1] ?? "", f.slice(9).join(" "), parts[++i] ?? null));
    else if (kind === "u") files.push(file(f[1] ?? "", f.slice(10).join(" "), null, true));
    else if (kind === "?") files.push(file("??", line.slice(2)));
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  return { head, oid, upstream, ahead, behind, files };
}

function file(xy: string, path: string, from: string | null = null, conflicted = false): StatusFile {
  const x = letterOf(xy[0]), y = letterOf(xy[1]);
  const untracked = xy === "??";

  return {
    path, from, x: untracked ? "?" : x, y: untracked ? "?" : y,
    staged: !untracked && x !== " " && x !== "?",
    unstaged: untracked || (y !== " "),
    untracked, conflict: conflicted || x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D"),
  };
}

/** The status letters lazygit shows: "M ", " M", "??"… */
export const letters = (f: StatusFile) => (f.untracked ? "??" : `${f.x}${f.y}`);

/** `git for-each-ref refs/heads --format=BRANCH_FORMAT`. */
export const BRANCH_FORMAT = ["%(HEAD)", "%(refname:short)", "%(upstream:short)", "%(upstream:track)", "%(committerdate:unix)", "%(objectname)", "%(subject)"].join("%1f");

/** How far a branch is from its upstream ("[ahead 2, behind 1]", "[gone]"). */
export interface Track {
  readonly gone: boolean;
  readonly ahead: number;
  readonly behind: number;
}

/** A local branch. */
export interface Branch extends Track {
  /** Checked out here. */
  readonly head: boolean;
  readonly name: string;
  readonly upstream: string | null;
  readonly date: number;
  readonly oid: string;
  readonly subject: string;
}

/** A number git printed, 0 when there's none. */
const num = (s: string | undefined) => Number(s) || 0;

export function parseBranches(text: string): Branch[] {
  const out: Branch[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    const [head, name = "", upstream, track, date, oid = "", subject] = line.split(SEP);

    out.push({ head: head === "*", name, upstream: upstream || null, ...trackOf(track ?? ""), date: num(date), oid, subject: subject ?? "" });
  }

  // The checked-out branch first, then by recency (lazygit's default sort).
  out.sort((a, b) => (Number(b.head) - Number(a.head)) || (b.date - a.date));

  return out;
}

/** "[ahead 2, behind 1]" / "[gone]" / "". */
export function trackOf(track: string): Track {
  return {
    gone: /\bgone\b/.test(track),
    ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
  };
}

/** `git for-each-ref refs/remotes --format=REMOTE_BRANCH_FORMAT`. */
export const REMOTE_BRANCH_FORMAT = ["%(refname:short)", "%(committerdate:unix)", "%(objectname)", "%(subject)", "%(symref)"].join("%1f");

/** A remote's branch: "origin/main" is remote "origin", branch "main". */
export interface RemoteBranch {
  readonly name: string;
  readonly remote: string;
  readonly branch: string;
  readonly date: number;
  readonly oid: string;
  readonly subject: string;
}

export function parseRemoteBranches(text: string): RemoteBranch[] {
  const out: RemoteBranch[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    const [name = "", date, oid = "", subject, symref] = line.split(SEP);

    if (symref) continue; // origin/HEAD -> origin/main

    const slash = name.indexOf("/");

    if (slash < 0) continue; // the bare remote name for-each-ref gives a symref

    out.push({ name, remote: name.slice(0, slash), branch: name.slice(slash + 1), date: num(date), oid, subject: subject ?? "" });
  }

  out.sort((a, b) => b.date - a.date);

  return out;
}

/** A remote, its fetch and push urls. */
export interface Remote {
  readonly name: string;
  readonly url: string;
  readonly push: string;
}

/** `git remote -v`: each remote once, with its fetch url. */
export function parseRemotes(text: string): Remote[] {
  const seen = new Map<string, Remote>();

  for (const line of text.split("\n")) {
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
    const [, name, url, way] = m ?? [];

    if (name === undefined || url === undefined) continue;

    const r = seen.get(name) ?? { name, url, push: url };

    seen.set(name, way === "fetch" ? { ...r, url } : { ...r, push: url });
  }

  return [...seen.values()];
}

/** `git for-each-ref refs/tags --sort=-creatordate --format=TAG_FORMAT`. */
export const TAG_FORMAT = ["%(refname:short)", "%(creatordate:unix)", "%(objectname)", "%(*objectname)", "%(contents:subject)"].join("%1f");

/** A tag; `oid` is the commit it points at (an annotated one's, peeled). */
export interface Tag {
  readonly name: string;
  readonly date: number;
  readonly oid: string;
  readonly annotated: boolean;
  readonly subject: string;
}

export function parseTags(text: string): Tag[] {
  const out: Tag[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    const [name = "", date, oid = "", peeled, subject] = line.split(SEP);

    out.push({ name, date: num(date), oid: peeled || oid, annotated: Boolean(peeled), subject: subject ?? "" });
  }

  return out;
}

/** `git log --format=LOG_FORMAT`: hash, parents, author, dates, refs, subject. */
export const LOG_FORMAT = ["%H", "%P", "%an", "%ae", "%at", "%D", "%s"].join("%x1f");

/** What a ref on a commit is (%D): HEAD's branch, a detached HEAD, a tag, a local branch, another ref (a remote's). */
export type RefKind = "head" | "detached" | "tag" | "branch" | "ref";

export interface Ref {
  readonly kind: RefKind;
  readonly name: string;
}

/** A commit in a list (parseLog). */
export interface Commit {
  readonly hash: string;
  readonly short: string;
  readonly parents: readonly string[];
  readonly author: string;
  readonly email: string;
  readonly date: number;
  readonly refs: readonly Ref[];
  readonly subject: string;
}

/** A commit with its whole message (parseLogFull). */
export interface FullCommit extends Commit {
  readonly message: string;
}

export function parseLog(text: string): Commit[] {
  const out: Commit[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    const [hash = "", parents, author = "", email = "", date, refs, ...subject] = line.split(SEP);

    out.push({ hash, short: hash.slice(0, 7), parents: parents ? parents.split(" ") : [], author, email, date: num(date), refs: parseRefs(refs ?? ""), subject: subject.join(SEP) });
  }

  return out;
}

/** `git log --format=LOG_FULL_FORMAT`: as parseLog, with the whole message
 *  (body included), records ended by %x1e (a message can span lines). */
export const LOG_FULL_FORMAT = ["%H", "%P", "%an", "%ae", "%at", "%D", "%B"].join("%x1f") + "%x1e";

export function parseLogFull(text: string): FullCommit[] {
  const out: FullCommit[] = [];

  for (const record of text.split("\x1e")) {
    const rec = record.replace(/^\n+/, "");

    if (!rec.trim()) continue;

    const [hash = "", parents, author = "", email = "", date, refs, ...body] = rec.split(SEP);
    const message = body.join(SEP).replace(/\s+$/, "");

    out.push({ hash, short: hash.slice(0, 7), parents: parents ? parents.split(" ") : [], author, email, date: num(date), refs: parseRefs(refs ?? ""), subject: message.split("\n")[0] ?? "", message });
  }

  return out;
}

/** git's relative date: "8 minutes ago", "2 days ago", "3 months ago". */
export function relativeDate(unix: number, now = Date.now() / 1000) {
  const s = Math.max(0, Math.round(now - unix));
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? "" : "s"} ago`;

  if (s < 90) return n(s, "second");

  if (s < 90 * 60) return n(Math.round(s / 60), "minute");

  if (s < 36 * 3600) return n(Math.round(s / 3600), "hour");

  if (s < 14 * 86400) return n(Math.round(s / 86400), "day");

  if (s < 10 * 7 * 86400) return n(Math.round(s / (7 * 86400)), "week");

  if (s < 365 * 86400) return n(Math.round(s / (30 * 86400)), "month");

  return n(Math.round(s / (365 * 86400)), "year");
}

/** %D: "HEAD -> main, origin/main, tag: v1" into [{ kind, name }]. */
export function parseRefs(d: string): Ref[] {
  const out: Ref[] = [];

  for (const part of d.split(", ")) {
    const s = part.trim();

    if (!s) continue;

    // Full names (git log --decorate=full) say what a ref is; a short name
    // with a slash could be a local feat/x or a remote's origin/x.
    if (s.startsWith("HEAD -> ")) out.push({ kind: "head", name: s.slice(8).replace(/^refs\/heads\//, "") });
    else if (s === "HEAD") out.push({ kind: "detached", name: "HEAD" });
    else if (s.startsWith("tag: ")) out.push({ kind: "tag", name: s.slice(5).replace(/^refs\/tags\//, "") });
    else if (s.endsWith("/HEAD")) continue;
    else if (s.startsWith("refs/heads/")) out.push({ kind: "branch", name: s.slice(11) });
    else if (s.startsWith("refs/remotes/")) out.push({ kind: "ref", name: s.slice(13) });
    else if (s.startsWith("refs/")) out.push({ kind: "ref", name: s.replace(/^refs\/[^/]+\//, "") });
    else out.push({ kind: s.includes("/") ? "ref" : "branch", name: s });
  }

  return out;
}

/** `git log -g --format=REFLOG_FORMAT`: the reflog, newest first. */
export const REFLOG_FORMAT = ["%H", "%gd", "%gs", "%ct"].join("%x1f");

/** One reflog entry: where HEAD went (`hash`) and what moved it (`subject`). */
export interface ReflogEntry {
  readonly hash: string;
  readonly short: string;
  readonly selector: string;
  readonly subject: string;
  readonly date: number;
}

export function parseReflog(text: string): ReflogEntry[] {
  const out: ReflogEntry[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    const [hash = "", selector = "", subject, date] = line.split(SEP);

    out.push({ hash, short: hash.slice(0, 7), selector, subject: subject ?? "", date: num(date) });
  }

  return out;
}

/** `git stash list --format=STASH_FORMAT`. */
export const STASH_FORMAT = ["%gd", "%ct", "%gs", "%H"].join("%x1f");

/** A stash entry: stash@{index}. */
export interface StashEntry {
  readonly ref: string;
  readonly index: number;
  readonly date: number;
  readonly subject: string;
  readonly hash: string;
}

export function parseStash(text: string): StashEntry[] {
  const out: StashEntry[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    const [ref = "", date, subject, hash = ""] = line.split(SEP);
    const index = Number(/\{(\d+)\}/.exec(ref)?.[1] ?? out.length);

    out.push({ ref, index, date: num(date), subject: subject ?? "", hash });
  }

  return out;
}

/** A checkout of the repo (`git worktree list --porcelain`). */
export interface Worktree {
  readonly path: string;
  readonly head: string | null;
  readonly branch: string | null;
  readonly bare: boolean;
  readonly detached: boolean;
  readonly locked: boolean;
  readonly prunable: boolean;
}

/** `git worktree list --porcelain`. */
export function parseWorktrees(text: string): Worktree[] {
  const out: Worktree[] = [];
  let w: { -readonly [K in keyof Worktree]: Worktree[K] } | null = null;

  for (const line of text.split("\n")) {
    if (line.startsWith("worktree ")) {
      w = { path: line.slice(9), head: null, branch: null, bare: false, detached: false, locked: false, prunable: false };
      out.push(w);
    } else if (!w) continue;
    else if (line.startsWith("HEAD ")) w.head = line.slice(5);
    else if (line.startsWith("branch ")) w.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (line === "bare") w.bare = true;
    else if (line === "detached") w.detached = true;
    else if (line.startsWith("locked")) w.locked = true;
    else if (line.startsWith("prunable")) w.prunable = true;
  }

  return out;
}

/** What the repo is in the middle of. */
export type RepoState = "rebasing" | "merging" | "cherry-picking" | "reverting" | "bisecting";

/** What the repo is in the middle of, from the files under .git (git.ts reads which exist). */
export function repoState(exists: ReadonlySet<string>): RepoState | null {
  if (exists.has("rebase-merge") || exists.has("rebase-apply")) return "rebasing";

  if (exists.has("MERGE_HEAD")) return "merging";

  if (exists.has("CHERRY_PICK_HEAD")) return "cherry-picking";

  if (exists.has("REVERT_HEAD")) return "reverting";

  if (exists.has("BISECT_LOG")) return "bisecting";

  return null;
}

/** Short age: "4m", "3h", "2d", "5w", "1y" (lazygit's recency column). */
export function age(unix: number, now = Date.now() / 1000) {
  const s = Math.max(0, now - unix);

  if (s < 60) return `${Math.floor(s)}s`;

  if (s < 3600) return `${Math.floor(s / 60)}m`;

  if (s < 86400) return `${Math.floor(s / 3600)}h`;

  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;

  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 7))}w`;

  return `${Math.floor(s / (86400 * 365))}y`;
}

/** Initials for the author column: "Developer Smith-Jones" -> "DS". */
export function initials(name: string) {
  const words = name.split(/[\s._]+/).filter(Boolean);
  const first = words[0] ?? "", last = words[words.length - 1] ?? "";

  if (!words.length) return "?";

  if (words.length === 1) return first.slice(0, 2).toUpperCase();

  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

/** A row of the files as a tree: a directory (the files under it, whether
 *  it's unfolded) or a file. */
export type TreeRow<F> =
  | { readonly kind: "dir"; readonly path: string; readonly name: string; readonly depth: number; readonly files: readonly F[]; readonly open: boolean }
  | { readonly kind: "file"; readonly path: string; readonly name: string; readonly depth: number; readonly file: F };

interface Node<F> {
  readonly dirs: Map<string, Node<F>>;
  readonly files: F[];
}

/** The files as a tree: directories first, folded where `collapsed` says,
 *  single-child directories joined ("src/keys/shipped"). */
export function fileTree<F extends { readonly path: string }>(files: readonly F[], collapsed: ReadonlySet<string> = new Set()): TreeRow<F>[] {
  const root: Node<F> = { dirs: new Map(), files: [] };

  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;

    for (const p of parts.slice(0, -1)) {
      const next = node.dirs.get(p) ?? { dirs: new Map(), files: [] };

      node.dirs.set(p, next);
      node = next;
    }

    node.files.push(f);
  }

  const rows: TreeRow<F>[] = [];
  const all = (n: Node<F>): F[] => [...n.files, ...[...n.dirs.values()].flatMap(all)];

  const walk = (node: Node<F>, prefix: string, depth: number) => {
    for (const [name, child] of [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      // Join a chain of directories that hold one directory and nothing else.
      let label = name, path = prefix ? `${prefix}/${name}` : name, n = child;
      let only = n.files.length === 0 && n.dirs.size === 1 ? [...n.dirs.entries()][0] : undefined;

      while (only) {
        const [k, v] = only;

        label += `/${k}`;
        path += `/${k}`;
        n = v;
        only = n.files.length === 0 && n.dirs.size === 1 ? [...n.dirs.entries()][0] : undefined;
      }

      const under = all(n);

      rows.push({ kind: "dir", path, name: label, depth, files: under, open: !collapsed.has(path) });

      if (!collapsed.has(path)) walk(n, path, depth + 1);
    }

    for (const f of node.files.sort((a, b) => a.path.localeCompare(b.path))) {
      rows.push({ kind: "file", path: f.path, name: f.path.split("/").pop() ?? f.path, depth, file: f });
    }
  };

  walk(root, "", 0);

  return rows;
}

/** A directory's status letters: staged if all its files are, etc. */
export function dirLetters(files: readonly StatusFile[]) {
  const x = files.every((f) => f.staged && !f.unstaged) ? "M" : files.some((f) => f.staged) ? "M" : " ";
  const y = files.some((f) => f.unstaged) ? (files.every((f) => f.untracked) ? "?" : "M") : " ";

  return { x, y, staged: files.every((f) => f.staged && !f.unstaged), some: files.some((f) => f.staged) };
}
