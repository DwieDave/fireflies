// The rows of the git window's lists: which rows a list context shows
// (filtered), which record a row is (each has a field none of the others
// has), what the filter matches it by, and its identity for busy marks.

import { Array as Arr, Order, String as Str } from "effect";
import type { CommitFile } from "./git.ts";
import type { Branch, Commit, ReflogEntry, Remote, RemoteBranch, StashEntry, StatusFile, Tag, TreeRow } from "./parse.ts";
import type { ListContext } from "./keys.ts";
import type { Checkout } from "./worktrees.ts";
import type { ReviewFile } from "./review.ts";
import { fileTree } from "./parse.ts";
import type { default as GitView } from "./main.ts";


const NO_FILES: readonly StatusFile[] = [];

/** The Status panel's one row. */
export interface StatusRow {
  readonly kind: "status";
}

/** A row of any list: what items(ctx) gives for its context. */
export type Item =
  | StatusRow | TreeRow<StatusFile> | TreeRow<CommitFile> | ReviewFile | Checkout
  | Branch | Remote | Tag | Commit | ReflogEntry | StashEntry | RemoteBranch;

// Which record a row is: each has a field none of the others has.
export const isBranch = (x: Item | null): x is Branch => x !== null && "gone" in x;
export const isCommit = (x: Item | null): x is Commit => x !== null && "parents" in x;
export const isReflog = (x: Item | null): x is ReflogEntry => x !== null && "selector" in x;
export const isStash = (x: Item | null): x is StashEntry => x !== null && "index" in x;
export const isRemote = (x: Item | null): x is Remote => x !== null && "push" in x;
export const isRemoteBranch = (x: Item | null): x is RemoteBranch => x !== null && "remote" in x;
export const isTag = (x: Item | null): x is Tag => x !== null && "annotated" in x;
export const isCheckout = (x: Item | null): x is Checkout => x !== null && "prunable" in x;
export const isReviewFile = (x: Item | null): x is ReviewFile => x !== null && "hunks" in x;
export const isTreeRow = (x: Item | null): x is TreeRow<StatusFile> | TreeRow<CommitFile> => x !== null && "depth" in x;

/** The working-tree files among a folder row's (a commit's files are not). */
export const workFiles = (files: readonly (StatusFile | CommitFile)[]): StatusFile[] => Arr.filter(files, (f): f is StatusFile => "staged" in f);

/** A Files row's working-tree file (not a directory's). */
export function statusFileOf(x: Item | null): StatusFile | null {
  if (!isTreeRow(x) || x.kind !== "file") return null;

  const f = x.file;

  return "staged" in f ? f : null;
}

/** A row's path: a file's, a directory's, a worktree's. */
export function pathOf(x: Item | null): string | null {
  if (x === null) return null;

  if ("path" in x) return x.path;

  return null;
}

/** A row's name: a branch's, a tag's, a remote's, a file row's. */
export function nameOf(x: Item | null): string | null {
  return x !== null && "name" in x ? x.name : null;
}

/** A row's commit hash: a commit's, a reflog entry's, a stash entry's. */
export function hashOf(x: Item | null): string | null {
  return x !== null && "hash" in x ? x.hash : null;
}

/** A row's subject: a branch's last commit's, a commit's, a tag's, a stash entry's. */
export function subjectOf(x: Item | null): string | null {
  return x !== null && "subject" in x ? x.subject : null;
}

/** What the filter matches a row by. */
export function words(x: Item): (string | null)[] {
  return [nameOf(x), pathOf(x), subjectOf(x), hashOf(x), isRemote(x) ? x.url : null, isRemoteBranch(x) || isCheckout(x) ? x.branch : null];
}

/** A list row's identity for busy marks: the same thing in any list (a
 *  branch, a commit, a file), so a row keeps its mark through a reload. */
export function rowKey(ctx: ListContext, x: Item | null): string | null {
  if (x === null) return null;

  if (ctx === "commits" || ctx === "subCommits" || ctx === "reflog") {
    const h = hashOf(x);

    return h === null || Str.isEmpty(h) ? null : `commit:${h}`;
  }

  if (ctx === "branches") return `branch:${nameOf(x) ?? ""}`;

  if (ctx === "files" || ctx === "review" || ctx === "commitFiles") {
    const p = pathOf(x);

    return p !== null ? `file:${p}` : null;
  }

  if (ctx === "worktrees") return `wt:${pathOf(x) ?? ""}`;

  if (ctx === "stash") return isStash(x) ? `stash:${x.ref}` : null;

  if (ctx === "tags" || ctx === "remotes" || ctx === "remoteBranches") return `${ctx}:${nameOf(x) ?? ""}`;

  return null;
}

/** The last tree built from a list of files, by the view's tree settings:
 *  each draw asks for a list's rows more than once, and a scroll step changes
 *  none of what the tree is built from. */
const trees = new WeakMap<readonly object[], { readonly key: string; readonly rows: readonly Item[] }>();

function treeOf<F extends { readonly path: string }>(v: GitView, files: readonly F[], build: () => readonly Item[]): readonly Item[] {
  const key = `${v.tree}|${v.statusFilter ?? ""}|${Arr.join(Arr.fromIterable(v.collapsed), "\0")}`;
  const known = trees.get(files);

  if (known?.key === key) return known.rows;

  const rows = build();

  trees.set(files, { key, rows });

  return rows;
}

/** Branches by name, the checked-out one first. */
interface Named {
  readonly head: boolean;
  readonly name: string;
}

const byHeadThenName: Order.Order<Named> = Order.combine(
  Order.mapInput(Order.Boolean, (b: Named) => !b.head),
  Order.mapInput((a: string, b: string) => Str.localeCompare(b)(a), (b: Named) => b.name),
);

/** The rows a list context shows (filtered). */
export function listItems(v: GitView, ctx: ListContext): readonly Item[] {
  const d = v.data;

  const list = ((): readonly Item[] => {
    switch (ctx) {
      case "status": return [{ kind: "status" }];
      case "files": return treeOf(v, d.status?.files ?? NO_FILES, () => {
        const files = Arr.filter(d.status?.files ?? [], (f) => v.statusFilter === null || f[v.statusFilter]);

        return v.tree ? fileTree(files, v.collapsed) : Arr.map(files, (f) => ({ kind: "file", path: f.path, name: f.path, depth: 0, file: f }));
      });

      case "review": return v.review.shown();
      case "worktrees": return d.worktrees;
      case "branches": return v.branchSort === "name" ? Arr.sort(d.branches, byHeadThenName) : d.branches;
      case "remotes": return d.remotes;
      case "tags": return d.tags;
      case "commits": return d.commits;
      case "reflog": return d.reflog;
      case "stash": return d.stash;
      case "remoteBranches": case "subCommits": case "commitFiles": {
        const s = v.subOfKind(ctx);

        if (s?.kind === "commitFiles") {
          return treeOf(v, s.items, () => {
            const rows: readonly TreeRow<CommitFile>[] = v.tree ? fileTree<CommitFile>(s.items, v.collapsed) : Arr.map(s.items, (f: CommitFile) => ({ kind: "file", path: f.path, name: f.path, depth: 0, file: f }));

            return rows;
          });
        }

        return s?.items ?? [];
      }
    }
  })();

  const q = Str.toLowerCase(v.filters[ctx] ?? "");

  if (Str.isEmpty(q)) return list;

  return Arr.filter(list, (x) => Arr.some(words(x), (s) => s !== null && Str.includes(q)(Str.toLowerCase(s))));
}

/** Whether a range selection [a, b] highlights row `i`: it holds the row,
 *  or the row is an open folder and every row under it that stands for files
 *  (a file, a folded folder) lies in the range, at any depth. */
export function rangeHolds(rows: readonly Item[], i: number, range: readonly [number, number]): boolean {
  const [a, b] = range;

  if (i >= a && i <= b) return true;

  const r = rows[i] ?? null;

  if (!isTreeRow(r) || r.kind !== "dir" || !r.open) return false;

  let any = false;

  for (let j = i + 1; j < rows.length; j++) {
    const x = rows[j] ?? null;

    if (!isTreeRow(x) || x.depth <= r.depth) break;

    if (x.kind === "dir" && x.open) continue;

    if (j < a || j > b) return false;

    any = true;
  }

  return any;
}
