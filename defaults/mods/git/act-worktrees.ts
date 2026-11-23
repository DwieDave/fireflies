// The git actions of the Worktrees tab (keys.ts): switching, opening,
// making, renaming, picking and removing worktrees (worktrees.ts does the git
// and spaces work, checkouts.ts the window's part).

import { Array as Arr, Option, String as Str } from "effect";
import { run as herdrRun } from "herdr";
import type { Action } from "./keys.ts";
import { isRemoteBranch, isTag, hashOf, nameOf } from "./items.ts";
import { goToWorktree, newWorktree, pickMergedWorktrees, removeWorktrees } from "./checkouts.ts";
import { editIn, switchRepo } from "./elsewhere.ts";
import type { Handler } from "./acting.ts";
import { checkoutOf, git, it } from "./acting.ts";

export const WORKTREE_ACTIONS = {
  // ---- worktrees (worktrees.ts does the git and spaces work)
  "worktree-switch": (v) => {
    const w = checkoutOf(v);

    if (w !== null) goToWorktree(v, w);
  },
  "worktree-here": (v) => {
    const w = checkoutOf(v);

    if (w === null) return;

    if (w.prunable) return v.error("Its folder is gone: X prunes it.");

    if (w.path === v.git?.root) return v.note("This window is on it already");

    switchRepo(v, w.path);
  },
  "worktree-new": (v) => newWorktree(v),
  "worktree-of": (v) => {
    const x = it(v);

    if (x === null) return;

    const hash = hashOf(x);

    if (hash !== null || isTag(x) || v.ctx() === "tags") {
      const base = hash ?? nameOf(x);

      return base === null ? undefined : newWorktree(v, { base, label: hash === null ? base : Str.slice(0, 7)(hash) });
    }

    if (isRemoteBranch(x)) {
      // A remote branch: a local branch of the same name that tracks it.
      const local = Arr.some(v.data.branches, (b) => b.name === x.branch);

      return local ? newWorktree(v, { value: x.branch }) : newWorktree(v, { value: x.branch, base: x.name, label: x.name, track: true });
    }

    const name = nameOf(x);

    if (name === null) return;

    const taken = Arr.findFirst(v.data.worktrees, (w) => w.branch === name);

    if (Option.isSome(taken)) return v.error(`${name} is checked out in ${v.tilde(taken.value.path)} already: space there goes to it.`);

    newWorktree(v, { value: name, now: true });
  },
  "worktree-remove": (v) => removeWorktrees(v),
  "worktree-open-menu": (v) => {
    const w = checkoutOf(v);

    if (w === null) return;

    const on = v.on;

    v.menu({
      title: `Open ${v.tilde(w.path)}`,
      items: [
        { key: "f", label: "In a files pane", go: () => herdrRun("files.open", on === null ? { path: w.path } : { path: w.path, on }) },
        { key: "e", label: "In the editor ($EDITOR, a floating terminal)", go: () => editIn(v, w.path) },
        { key: "t", label: "A terminal tab there, in this space", go: () => herdrRun("tab.new", { folder: w.path }) },
        { key: "o", label: "In the system's file manager", go: () => herdrRun("files.open", on === null ? { path: w.path, in: "system" } : { path: w.path, in: "system", on }) },
      ],
    });
  },
  "worktree-rename": (v) => {
    const w = checkoutOf(v);
    const branch = w?.branch;

    if (branch === null || branch === undefined) return v.error("A detached checkout has no branch to rename.");

    v.prompt({
      title: `Rename branch ${branch}`, value: branch,
      ok: (name) => {
        const to = Str.trim(name);

        if (Str.isNonEmpty(to) && to !== branch) git(v, "Rename branch", ["branch", "-m", branch, to]);
      },
    });
  },
  "worktree-copy-path": (v, cx) => {
    const w = checkoutOf(v);

    if (w !== null) v.copy(w.path, cx);
  },
  "worktree-pick-all": (v) => {
    const all = Arr.filter(v.data.worktrees, (w) => !w.main);

    v.wtPicked = v.wtPicked.size > 0 ? new Set() : new Set(Arr.map(all, (w) => w.path));
  },
  "worktree-pick-unused": (v) => {
    const occ = v.occupancy();

    v.wtPicked = new Set(Arr.flatMap(v.data.worktrees, (w) => (!w.main && (occ.get(w.path)?.spaces.length ?? 0) === 0 && (occ.get(w.path)?.agents.length ?? 0) === 0 ? [w.path] : [])));
    v.note(v.wtPicked.size > 0 ? `${v.wtPicked.size} unused picked: d removes them, esc lets go` : "Every worktree has a space or an agent");
  },
  "worktree-pick-merged": (v) => pickMergedWorktrees(v),
  "worktree-prune": (v) => {
    const stale = Arr.filter(v.data.worktrees, (w) => w.prunable);

    if (!Arr.isReadonlyArrayNonEmpty(stale)) return v.note("Nothing to prune: every worktree's folder is there");

    v.ask({
      title: "Prune worktrees", text: `Forget ${stale.length} worktree${stale.length === 1 ? "" : "s"} whose folder is gone?`, lines: Arr.map(stale, (w) => [v.tilde(w.path), "dim"] as const),
      go: () => git(v, "Prune worktrees", ["worktree", "prune"]),
    });
  },

} satisfies { readonly [A in Action]?: Handler };
