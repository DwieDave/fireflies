// Reading git's plain output into the panels' rows. Pure: no herdr, so the
// tests run them on fixtures (scripts/git.test.ts). The formats are
// what git.ts asks for: NUL-separated fields, porcelain v2 status. Each row's
// shape is a Schema (its type taken from it); a letter or a number git prints
// that isn't one we know reads as a stated fallback, never as a wrong type.

import { Array as Arr, Option, Order, Schema, String as Str } from "effect";

export const SEP = "\x1f"; // field separator in --format strings (%x1f)

/** One of a file's two status letters (index, work tree), as lazygit shows
 *  them: git's porcelain v2 letters with "." as " ", and "?" for untracked. */
export const LetterSchema = Schema.Literals([" ", "M", "T", "A", "D", "R", "C", "U", "?"]);

export type Letter = typeof LetterSchema.Type;

const isLetter = Schema.is(LetterSchema);

/** A letter of porcelain v2's XY ("." is unchanged); one git adds later reads as modified. */
const letterOf = (c: string | undefined): Letter => {
  const l = c === "." ? " " : c;

  return isLetter(l) ? l : "M";
};

/** Paths in the order git's lists and the trees show them. */
export const byLocale: Order.Order<string> = Order.make((a, b) => Str.localeCompare(b)(a));

/** Rows ordered by their path. */
export const byPath = <R extends { readonly path: string }>(): Order.Order<R> => Order.mapInput(byLocale, (r: R) => r.path);

/** Newest first, by a unix `date`. */
const newest = <R extends { readonly date: number }>(): Order.Order<R> => Order.flip(Order.mapInput(Order.Number, (r: R) => r.date));

/** A changed path in the working tree (parseStatus). */
export const StatusFileSchema = Schema.Struct({
  path: Schema.String,
  /** A rename's or copy's old path. */
  from: Schema.NullOr(Schema.String),
  x: LetterSchema,
  y: LetterSchema,
  staged: Schema.Boolean,
  unstaged: Schema.Boolean,
  untracked: Schema.Boolean,
  conflict: Schema.Boolean,
});

export type StatusFile = typeof StatusFileSchema.Type;

/** The branch line and every changed path (parseStatus). */
export const StatusSchema = Schema.Struct({
  head: Schema.NullOr(Schema.String),
  oid: Schema.NullOr(Schema.String),
  upstream: Schema.NullOr(Schema.String),
  ahead: Schema.Finite,
  behind: Schema.Finite,
  files: Schema.Array(StatusFileSchema),
});

export type Status = typeof StatusSchema.Type;

/** A number git printed, 0 when there's none (or it isn't one). */
const num = (s: string | undefined): number => {
  const n = Number(s ?? "");

  return Number.isFinite(n) ? n : 0;
};

/** Field `i` of a split line, "" when the line has fewer. */
const at = (fields: readonly string[], i: number): string => Option.getOrElse(Arr.get(fields, i), () => "");

/** The non-blank lines of `text`. */
const lines = (text: string): string[] => Arr.filter(Str.split(text, "\n"), (l) => Str.isNonEmpty(Str.trim(l)));

/** The fields of `line` from `i` on, joined by `sep` again (a path or a subject holding the separator). */
const rest = (fields: readonly string[], i: number, sep: string): string => Arr.join(Arr.drop(fields, i), sep);

/** The branch line's fields of a status being read. */
type Head = { -readonly [K in Exclude<keyof Status, "files">]: Status[K] };

/** One `# branch.*` header line of porcelain v2 into the status being read. */
function header(s: Head, line: string): void {
  const fields = Str.split(line, " ");
  const key = at(fields, 1);
  const val = rest(fields, 2, " ");

  if (key === "branch.head") s.head = val === "(detached)" ? null : val;
  else if (key === "branch.oid") s.oid = val === "(initial)" ? null : val;
  else if (key === "branch.upstream") s.upstream = val;
  else if (key === "branch.ab") {
    const m = /\+(\d+) -(\d+)/.exec(val);

    if (m !== null) {
      s.ahead = num(m[1]);
      s.behind = num(m[2]);
    }
  }
}

/** `git status --porcelain=v2 --branch -z --untracked-files=all`: the branch
 *  line and every changed path with lazygit's two status letters (index, work
 *  tree: "M ", " M", "MM", "A ", "??", "UU"…). */
export function parseStatus(text: string): Status {
  const s: Head = { head: null, oid: null, upstream: null, ahead: 0, behind: 0 };
  const files: StatusFile[] = [];
  const parts = Str.split(text, "\0");

  for (let i = 0; i < parts.length; i++) {
    const line = at(parts, i);

    if (Str.isEmpty(line)) continue;

    if (Str.startsWith("# ")(line)) {
      header(s, line);
      continue;
    }

    const kind = Str.slice(0, 1)(line);
    const f = Str.split(line, " ");

    if (kind === "1") files.push(file(at(f, 1), rest(f, 8, " ")));
    else if (kind === "2") files.push(file(at(f, 1), rest(f, 9, " "), Option.getOrNull(Arr.get(parts, ++i))));
    else if (kind === "u") files.push(file(at(f, 1), rest(f, 10, " "), null, true));
    else if (kind === "?") files.push(file("??", Str.slice(2)(line)));
  }

  return { ...s, files: Arr.sort(files, byPath<StatusFile>()) };
}

function file(xy: string, path: string, from: string | null = null, conflicted = false): StatusFile {
  const x = letterOf(Str.slice(0, 1)(xy)), y = letterOf(Str.slice(1, 2)(xy));
  const untracked = xy === "??";
  const both = (a: Letter) => x === a && y === a;

  return {
    path, from, x: untracked ? "?" : x, y: untracked ? "?" : y,
    staged: !untracked && x !== " " && x !== "?",
    unstaged: untracked || y !== " ",
    untracked, conflict: conflicted || x === "U" || y === "U" || both("A") || both("D"),
  };
}

/** The status letters lazygit shows: "M ", " M", "??"… */
export const letters = (f: StatusFile): string => (f.untracked ? "??" : `${f.x}${f.y}`);

/** `git for-each-ref refs/heads --format=BRANCH_FORMAT`. */
export const BRANCH_FORMAT = Arr.join(["%(HEAD)", "%(refname:short)", "%(upstream:short)", "%(upstream:track)", "%(committerdate:unix)", "%(objectname)", "%(subject)"], "%1f");

/** How far a branch is from its upstream ("[ahead 2, behind 1]", "[gone]"). */
const TrackFields = { gone: Schema.Boolean, ahead: Schema.Finite, behind: Schema.Finite };

export const TrackSchema = Schema.Struct(TrackFields);

export type Track = typeof TrackSchema.Type;

/** A local branch: checked out here (`head`), its upstream, its last commit. */
export const BranchSchema = Schema.Struct({
  ...TrackFields,
  head: Schema.Boolean,
  name: Schema.String,
  upstream: Schema.NullOr(Schema.String),
  date: Schema.Finite,
  oid: Schema.String,
  subject: Schema.String,
});

export type Branch = typeof BranchSchema.Type;

/** A field git leaves empty as null. */
const orNull = (s: string): string | null => (Str.isEmpty(s) ? null : s);

/** The checked-out branch first, then by recency (lazygit's default sort). */
const HEAD_FIRST: Order.Order<Branch> = Order.combine(Order.flip(Order.mapInput(Order.Boolean, (b: Branch) => b.head)), newest<Branch>());

export function parseBranches(text: string): Branch[] {
  const out = Arr.map(lines(text), (line): Branch => {
    const f = Str.split(line, SEP);

    return { head: at(f, 0) === "*", name: at(f, 1), upstream: orNull(at(f, 2)), ...trackOf(at(f, 3)), date: num(at(f, 4)), oid: at(f, 5), subject: at(f, 6) };
  });

  return Arr.sort(out, HEAD_FIRST);
}

/** "[ahead 2, behind 1]" / "[gone]" / "". */
export function trackOf(track: string): Track {
  return {
    gone: /\bgone\b/.test(track),
    ahead: num(/ahead (\d+)/.exec(track)?.[1]),
    behind: num(/behind (\d+)/.exec(track)?.[1]),
  };
}

/** `git for-each-ref refs/remotes --format=REMOTE_BRANCH_FORMAT`. */
export const REMOTE_BRANCH_FORMAT = Arr.join(["%(refname:short)", "%(committerdate:unix)", "%(objectname)", "%(subject)", "%(symref)"], "%1f");

/** A remote's branch: "origin/main" is remote "origin", branch "main". */
export const RemoteBranchSchema = Schema.Struct({
  name: Schema.String,
  remote: Schema.String,
  branch: Schema.String,
  date: Schema.Finite,
  oid: Schema.String,
  subject: Schema.String,
});

export type RemoteBranch = typeof RemoteBranchSchema.Type;

export function parseRemoteBranches(text: string): RemoteBranch[] {
  const out = Arr.flatMap(lines(text), (line): RemoteBranch[] => {
    const f = Str.split(line, SEP);
    const name = at(f, 0);

    if (Str.isNonEmpty(at(f, 4))) return []; // origin/HEAD -> origin/main

    // The bare remote name for-each-ref gives a symref has no slash.
    return Option.match(Str.indexOf("/")(name), {
      onNone: () => [],
      onSome: (slash) => [{ name, remote: Str.slice(0, slash)(name), branch: Str.slice(slash + 1)(name), date: num(at(f, 1)), oid: at(f, 2), subject: at(f, 3) }],
    });
  });

  return Arr.sort(out, newest<RemoteBranch>());
}

/** A remote, its fetch and push urls. */
export const RemoteSchema = Schema.Struct({ name: Schema.String, url: Schema.String, push: Schema.String });

export type Remote = typeof RemoteSchema.Type;

/** `git remote -v`: each remote once, with its fetch url. */
export function parseRemotes(text: string): Remote[] {
  const seen = new Map<string, Remote>();

  for (const line of Str.split(text, "\n")) {
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(Str.trim(line));
    const name = m?.[1], url = m?.[2];

    if (name === undefined || url === undefined) continue;

    const r = seen.get(name) ?? { name, url, push: url };

    seen.set(name, m?.[3] === "fetch" ? { ...r, url } : { ...r, push: url });
  }

  return Arr.fromIterable(seen.values());
}

/** `git for-each-ref refs/tags --sort=-creatordate --format=TAG_FORMAT`. */
export const TAG_FORMAT = Arr.join(["%(refname:short)", "%(creatordate:unix)", "%(objectname)", "%(*objectname)", "%(contents:subject)"], "%1f");

/** A tag; `oid` is the commit it points at (an annotated one's, peeled). */
export const TagSchema = Schema.Struct({ name: Schema.String, date: Schema.Finite, oid: Schema.String, annotated: Schema.Boolean, subject: Schema.String });

export type Tag = typeof TagSchema.Type;

export function parseTags(text: string): Tag[] {
  return Arr.map(lines(text), (line): Tag => {
    const f = Str.split(line, SEP);
    const peeled = at(f, 3);

    return { name: at(f, 0), date: num(at(f, 1)), oid: Str.isNonEmpty(peeled) ? peeled : at(f, 2), annotated: Str.isNonEmpty(peeled), subject: at(f, 4) };
  });
}

/** `git log --format=LOG_FORMAT`: hash, parents, author, dates, refs, subject. */
export const LOG_FORMAT = Arr.join(["%H", "%P", "%an", "%ae", "%at", "%D", "%s"], "%x1f");

/** What a ref on a commit is (%D): HEAD's branch, a detached HEAD, a tag, a local branch, another ref (a remote's). */
export const RefKindSchema = Schema.Literals(["head", "detached", "tag", "branch", "ref"]);

export type RefKind = typeof RefKindSchema.Type;

export const RefSchema = Schema.Struct({ kind: RefKindSchema, name: Schema.String });

export type Ref = typeof RefSchema.Type;

const CommitFields = {
  hash: Schema.String,
  short: Schema.String,
  parents: Schema.Array(Schema.String),
  author: Schema.String,
  email: Schema.String,
  date: Schema.Finite,
  refs: Schema.Array(RefSchema),
  subject: Schema.String,
};

/** A commit in a list (parseLog). */
export const CommitSchema = Schema.Struct(CommitFields);

export type Commit = typeof CommitSchema.Type;

/** A commit with its whole message (parseLogFull). */
export const FullCommitSchema = Schema.Struct({ ...CommitFields, message: Schema.String });

export type FullCommit = typeof FullCommitSchema.Type;

/** %P: the parents' hashes, none for a root commit. */
const parentsOf = (s: string): string[] => (Str.isEmpty(s) ? [] : Str.split(s, " "));

/** A commit's fields from a LOG_FORMAT line (the subject, or the body, from field 6 on). */
function commitOf(f: readonly string[]): Commit {
  const hash = at(f, 0);

  return { hash, short: Str.slice(0, 7)(hash), parents: parentsOf(at(f, 1)), author: at(f, 2), email: at(f, 3), date: num(at(f, 4)), refs: parseRefs(at(f, 5)), subject: rest(f, 6, SEP) };
}

export function parseLog(text: string): Commit[] {
  return Arr.map(lines(text), (line) => commitOf(Str.split(line, SEP)));
}

/** `git log --format=LOG_FULL_FORMAT`: as parseLog, with the whole message
 *  (body included), records ended by %x1e (a message can span lines). */
export const LOG_FULL_FORMAT = Arr.join(["%H", "%P", "%an", "%ae", "%at", "%D", "%B"], "%x1f") + "%x1e";

export function parseLogFull(text: string): FullCommit[] {
  return Arr.flatMap(Str.split(text, "\x1e"), (record): FullCommit[] => {
    const rec = Str.replace(/^\n+/, "")(record);

    if (Str.isEmpty(Str.trim(rec))) return [];

    const c = commitOf(Str.split(rec, SEP));
    const message = Str.trimEnd(c.subject);

    return [{ ...c, subject: Arr.headNonEmpty(Str.split(message, "\n")), message }];
  });
}

/** git's relative date at `now` (unix seconds): "8 minutes ago", "2 days ago", "3 months ago". */
export function relativeDate(unix: number, now: number): string {
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

/** One part of %D as a ref, or none (a remote's HEAD). Full names (git log
 *  --decorate=full) say what a ref is; a short name with a slash could be a
 *  local feat/x or a remote's origin/x. */
function refOf(s: string): Ref[] {
  const after = (n: number, prefix: RegExp | null = null) => {
    const name = Str.slice(n)(s);

    return prefix === null ? name : Str.replace(prefix, "")(name);
  };

  if (Str.startsWith("HEAD -> ")(s)) return [{ kind: "head", name: after(8, /^refs\/heads\//) }];

  if (s === "HEAD") return [{ kind: "detached", name: "HEAD" }];

  if (Str.startsWith("tag: ")(s)) return [{ kind: "tag", name: after(5, /^refs\/tags\//) }];

  if (Str.endsWith("/HEAD")(s)) return [];

  if (Str.startsWith("refs/heads/")(s)) return [{ kind: "branch", name: after(11) }];

  if (Str.startsWith("refs/remotes/")(s)) return [{ kind: "ref", name: after(13) }];

  if (Str.startsWith("refs/")(s)) return [{ kind: "ref", name: Str.replace(/^refs\/[^/]+\//, "")(s) }];

  return [{ kind: Str.includes("/")(s) ? "ref" : "branch", name: s }];
}

/** %D: "HEAD -> main, origin/main, tag: v1" into [{ kind, name }]. */
export function parseRefs(d: string): Ref[] {
  return Arr.flatMap(Str.split(d, ", "), (part) => {
    const s = Str.trim(part);

    return Str.isEmpty(s) ? [] : refOf(s);
  });
}

/** `git log -g --format=REFLOG_FORMAT`: the reflog, newest first. */
export const REFLOG_FORMAT = Arr.join(["%H", "%gd", "%gs", "%ct"], "%x1f");

/** One reflog entry: where HEAD went (`hash`) and what moved it (`subject`). */
export const ReflogEntrySchema = Schema.Struct({ hash: Schema.String, short: Schema.String, selector: Schema.String, subject: Schema.String, date: Schema.Finite });

export type ReflogEntry = typeof ReflogEntrySchema.Type;

export function parseReflog(text: string): ReflogEntry[] {
  return Arr.map(lines(text), (line): ReflogEntry => {
    const f = Str.split(line, SEP);
    const hash = at(f, 0);

    return { hash, short: Str.slice(0, 7)(hash), selector: at(f, 1), subject: at(f, 2), date: num(at(f, 3)) };
  });
}

/** `git stash list --format=STASH_FORMAT`. */
export const STASH_FORMAT = Arr.join(["%gd", "%ct", "%gs", "%H"], "%x1f");

/** A stash entry: stash@{index}. */
export const StashEntrySchema = Schema.Struct({ ref: Schema.String, index: Schema.Finite, date: Schema.Finite, subject: Schema.String, hash: Schema.String });

export type StashEntry = typeof StashEntrySchema.Type;

export function parseStash(text: string): StashEntry[] {
  return Arr.map(lines(text), (line, i): StashEntry => {
    const f = Str.split(line, SEP);
    const ref = at(f, 0);
    const index = /\{(\d+)\}/.exec(ref)?.[1];

    return { ref, index: index === undefined ? i : num(index), date: num(at(f, 1)), subject: at(f, 2), hash: at(f, 3) };
  });
}

/** A checkout of the repo (`git worktree list --porcelain`). */
export const WorktreeFields = {
  path: Schema.String,
  head: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  bare: Schema.Boolean,
  detached: Schema.Boolean,
  locked: Schema.Boolean,
  prunable: Schema.Boolean,
};

export const WorktreeSchema = Schema.Struct(WorktreeFields);

export type Worktree = typeof WorktreeSchema.Type;

/** A worktree being read: its fields, set line by line. */
type Building = { -readonly [K in keyof Worktree]: Worktree[K] };

/** One attribute line of a worktree's block into `w`. */
function attribute(w: Building, line: string): void {
  if (Str.startsWith("HEAD ")(line)) w.head = Str.slice(5)(line);
  else if (Str.startsWith("branch ")(line)) w.branch = Str.replace(/^refs\/heads\//, "")(Str.slice(7)(line));
  else if (line === "bare") w.bare = true;
  else if (line === "detached") w.detached = true;
  else if (Str.startsWith("locked")(line)) w.locked = true;
  else if (Str.startsWith("prunable")(line)) w.prunable = true;
}

/** `git worktree list --porcelain`. */
export function parseWorktrees(text: string): Worktree[] {
  const out: Building[] = [];

  for (const line of Str.split(text, "\n")) {
    if (Str.startsWith("worktree ")(line)) out.push({ path: Str.slice(9)(line), head: null, branch: null, bare: false, detached: false, locked: false, prunable: false });
    else Option.map(Arr.last(out), (w) => attribute(w, line));
  }

  return out;
}

/** What the repo is in the middle of. */
export const RepoStateSchema = Schema.Literals(["rebasing", "merging", "cherry-picking", "reverting", "bisecting"]);

export type RepoState = typeof RepoStateSchema.Type;

/** What the repo is in the middle of, from the files under .git (git.ts reads which exist). */
export function repoState(exists: ReadonlySet<string>): RepoState | null {
  if (exists.has("rebase-merge") || exists.has("rebase-apply")) return "rebasing";

  if (exists.has("MERGE_HEAD")) return "merging";

  if (exists.has("CHERRY_PICK_HEAD")) return "cherry-picking";

  if (exists.has("REVERT_HEAD")) return "reverting";

  if (exists.has("BISECT_LOG")) return "bisecting";

  return null;
}

/** Short age at `now` (unix seconds): "4m", "3h", "2d", "5w", "1y" (lazygit's recency column). */
export function age(unix: number, now: number): string {
  const s = Math.max(0, now - unix);

  if (s < 60) return `${Math.floor(s)}s`;

  if (s < 3600) return `${Math.floor(s / 60)}m`;

  if (s < 86400) return `${Math.floor(s / 3600)}h`;

  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;

  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 7))}w`;

  return `${Math.floor(s / (86400 * 365))}y`;
}

/** Initials for the author column: "Developer Smith-Jones" -> "DS". */
export function initials(name: string): string {
  const words = Arr.filter(Str.split(name, /[\s._]+/), Str.isNonEmpty);

  return Option.match(Arr.head(words), {
    onNone: () => "?",
    onSome: (first) => Str.toUpperCase(words.length === 1 ? Str.slice(0, 2)(first) : Str.slice(0, 1)(first) + Str.slice(0, 1)(Option.getOrElse(Arr.last(words), () => first))),
  });
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

/** A path's last part. */
export const baseName = (path: string): string => Arr.lastNonEmpty(Str.split(path, "/"));

/** Every file under a tree node. */
const allUnder = <F>(n: Node<F>): F[] => [...n.files, ...Arr.flatMap(Arr.fromIterable(n.dirs.values()), allUnder)];

/** A directory that holds one directory and nothing else: that one. */
const onlyChild = <F>(n: Node<F>): Option.Option<readonly [string, Node<F>]> => (n.files.length === 0 && n.dirs.size === 1 ? Arr.head(Arr.fromIterable(n.dirs.entries())) : Option.none());

/** The files as a tree: directories first, folded where `collapsed` says,
 *  single-child directories joined ("src/keys/shipped"). */
export function fileTree<F extends { readonly path: string }>(files: readonly F[], collapsed: ReadonlySet<string> = new Set()): TreeRow<F>[] {
  const root: Node<F> = { dirs: new Map(), files: [] };

  for (const f of files) {
    let node = root;

    for (const p of Arr.dropRight(Str.split(f.path, "/"), 1)) {
      const next = node.dirs.get(p) ?? { dirs: new Map(), files: [] };

      node.dirs.set(p, next);
      node = next;
    }

    node.files.push(f);
  }

  const rows: TreeRow<F>[] = [];
  const byName = Order.mapInput(byLocale, ([name]: readonly [string, Node<F>]) => name);

  const walk = (node: Node<F>, prefix: string, depth: number) => {
    for (const [name, child] of Arr.sort(Arr.fromIterable(node.dirs.entries()), byName)) {
      // Join a chain of directories that hold one directory and nothing else.
      let label = name, path = Str.isEmpty(prefix) ? name : `${prefix}/${name}`, n = child;

      for (let only = onlyChild(n); Option.isSome(only); only = onlyChild(n)) {
        const [k, v] = only.value;

        label += `/${k}`;
        path += `/${k}`;
        n = v;
      }

      const open = !collapsed.has(path);

      rows.push({ kind: "dir", path, name: label, depth, files: allUnder(n), open });

      if (open) walk(n, path, depth + 1);
    }

    for (const f of Arr.sort(node.files, byPath<F>())) rows.push({ kind: "file", path: f.path, name: baseName(f.path), depth, file: f });
  };

  walk(root, "", 0);

  return rows;
}

/** A directory's two status letters, whether all its files are staged, whether some are. */
export interface DirLetters {
  readonly x: string;
  readonly y: string;
  readonly staged: boolean;
  readonly some: boolean;
}

/** A directory's status letters: staged if all its files are, etc. */
export function dirLetters(files: readonly StatusFile[]): DirLetters {
  const staged = Arr.every(files, (f) => f.staged && !f.unstaged);
  const some = Arr.some(files, (f) => f.staged);
  const unstaged = Arr.some(files, (f) => f.unstaged);
  const y = !unstaged ? " " : Arr.every(files, (f) => f.untracked) ? "?" : "M";

  return { x: staged || some ? "M" : " ", y, staged, some };
}
