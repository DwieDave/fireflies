// The git actions of the Worktrees tab (keys.ts): switching, opening,
// making, renaming, picking and removing worktrees (worktrees.ts does the git
// and spaces work, checkouts.ts the window's part).

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

    if (w) goToWorktree(v, w);
  },
  "worktree-here": (v) => {
    const w = checkoutOf(v);

    if (!w) return;

    if (w.prunable) return v.error("Its folder is gone: X prunes it.");

    if (w.path === v.git?.root) return v.note("This window is on it already");

    switchRepo(v, w.path);
  },
  "worktree-new": (v) => newWorktree(v),
  "worktree-of": (v) => {
    const x = it(v);

    if (!x) return;

    const hash = hashOf(x);

    if (hash || isTag(x) || v.ctx() === "tags") {
      const base = hash ?? nameOf(x);

      return base ? newWorktree(v, { base, label: hash ? hash.slice(0, 7) : base }) : undefined;
    }

    if (isRemoteBranch(x)) {
      // A remote branch: a local branch of the same name that tracks it.
      const local = v.data.branches.find((b) => b.name === x.branch);

      return local ? newWorktree(v, { value: x.branch }) : newWorktree(v, { value: x.branch, base: x.name, label: x.name, track: true });
    }

    const name = nameOf(x);

    if (!name) return;

    const taken = v.data.worktrees.find((w) => w.branch === name);

    if (taken) return v.error(`${name} is checked out in ${v.tilde(taken.path)} already: space there goes to it.`);

    newWorktree(v, { value: name, now: true });
  },
  "worktree-remove": (v) => removeWorktrees(v),
  "worktree-open-menu": (v) => {
    const w = checkoutOf(v);

    if (!w) return;

    const on = v.on;

    v.menu({
      title: `Open ${v.tilde(w.path)}`,
      items: [
        { key: "f", label: "In a files pane", go: () => herdrRun("files.open", on ? { path: w.path, on } : { path: w.path }) },
        { key: "e", label: "In the editor ($EDITOR, a floating terminal)", go: () => editIn(v, w.path) },
        { key: "t", label: "A terminal tab there, in this space", go: () => herdrRun("tab.new", { folder: w.path }) },
        { key: "o", label: "In the system's file manager", go: () => herdrRun("files.open", on ? { path: w.path, in: "system", on } : { path: w.path, in: "system" }) },
      ],
    });
  },
  "worktree-rename": (v) => {
    const w = checkoutOf(v);
    const branch = w?.branch;

    if (!branch) return v.error("A detached checkout has no branch to rename.");

    v.prompt({
      title: `Rename branch ${branch}`, value: branch,
      ok: (name) => { if (name.trim() && name.trim() !== branch) git(v, "Rename branch", ["branch", "-m", branch, name.trim()]); },
    });
  },
  "worktree-copy-path": (v, cx) => {
    const w = checkoutOf(v);

    if (w) v.copy(w.path, cx);
  },
  "worktree-pick-all": (v) => {
    const all = v.data.worktrees.filter((w) => !w.main);

    v.wtPicked = v.wtPicked.size ? new Set() : new Set(all.map((w) => w.path));
  },
  "worktree-pick-unused": (v) => {
    const occ = v.occupancy();

    v.wtPicked = new Set(v.data.worktrees.flatMap((w) => (!w.main && !occ.get(w.path)?.spaces.length && !occ.get(w.path)?.agents.length ? [w.path] : [])));
    v.note(v.wtPicked.size ? `${v.wtPicked.size} unused picked: d removes them, esc lets go` : "Every worktree has a space or an agent");
  },
  "worktree-pick-merged": (v) => pickMergedWorktrees(v),
  "worktree-prune": (v) => {
    const stale = v.data.worktrees.filter((w) => w.prunable);

    if (!stale.length) return v.note("Nothing to prune: every worktree's folder is there");

    v.ask({
      title: "Prune worktrees", text: `Forget ${stale.length} worktree${stale.length === 1 ? "" : "s"} whose folder is gone?`, lines: stale.map((w) => [v.tilde(w.path), "dim"] as const),
      go: () => git(v, "Prune worktrees", ["worktree", "prune"]),
    });
  },

} satisfies { readonly [A in Action]?: Handler };
