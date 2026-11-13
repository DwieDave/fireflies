// The rows of the git window's lists: which rows a list context shows
// (filtered), which record a row is (each has a field none of the others
// has), what the filter matches it by, and its identity for busy marks.

import type { CommitFile } from "./git.ts";
import type { Branch, Commit, ReflogEntry, Remote, RemoteBranch, StashEntry, StatusFile, Tag, TreeRow } from "./parse.ts";
import type { ListContext } from "./keys.ts";
import type { Checkout } from "./worktrees.ts";
import type { ReviewFile } from "./review.ts";
import { fileTree } from "./parse.ts";
import type { default as GitView } from "./main.ts";


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
export function rowKey(ctx: ListContext, x: Item | null) {
  if (!x) return null;

  if (ctx === "commits" || ctx === "subCommits" || ctx === "reflog") {
    const h = hashOf(x);

    return h ? `commit:${h}` : null;
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

/** The rows a list context shows (filtered). */
export function listItems(v: GitView, ctx: ListContext): readonly Item[] {
  const d = v.data;

  const list = ((): readonly Item[] => {
    switch (ctx) {
      case "status": return [{ kind: "status" }];
      case "files": {
        const files = (d.status?.files ?? []).filter((f) => !v.statusFilter || (v.statusFilter === "staged" ? f.staged : f.unstaged));

        return v.tree ? fileTree(files, v.collapsed) : files.map((f) => ({ kind: "file", path: f.path, name: f.path, depth: 0, file: f }));
      }

      case "review": return v.review.shown();
      case "worktrees": return d.worktrees;
      case "branches": return v.branchSort === "name" ? [...d.branches].sort((a, b) => (Number(b.head) - Number(a.head)) || a.name.localeCompare(b.name)) : d.branches;
      case "remotes": return d.remotes;
      case "tags": return d.tags;
      case "commits": return d.commits;
      case "reflog": return d.reflog;
      case "stash": return d.stash;
      case "remoteBranches": case "subCommits": case "commitFiles": {
        const s = v.subOfKind(ctx);

        if (s?.kind === "commitFiles") {
          const rows: readonly TreeRow<CommitFile>[] = v.tree ? fileTree<CommitFile>(s.items, v.collapsed) : s.items.map((f: CommitFile) => ({ kind: "file", path: f.path, name: f.path, depth: 0, file: f }));

          return rows;
        }

        return s?.items ?? [];
      }
    }
  })();

  const q = (v.filters[ctx] ?? "").toLowerCase();

  if (!q) return list;

  return list.filter((x) => words(x).some((s) => s && s.toLowerCase().includes(q)));
}
