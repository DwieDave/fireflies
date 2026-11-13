// What each key table action (keys.ts) does: the real git CLI through
// git.ts, with lazygit's confirms for destructive ones, prompts and menus
// (popups.ts) for what needs an answer. `v` is the window (main.ts): it owns
// the data, the selection, the popups and the command log.

import type { Context } from "gpui-kit";
import { run as herdrRun, setShared } from "herdr";
import type { Rewrite } from "./history.ts";
import { rewrite, nextUndo, nextRedo, UNDO, REDO } from "./history.ts";
import { partialPatch } from "./patch.ts";
import type { Env } from "./git.ts";
import { shq } from "./git.ts";
import type { Action } from "./keys.ts";
import type { MenuItem } from "./popups.ts";
import type { StatusFile } from "./parse.ts";
import type { default as GitView, ExecOptions, Item, SpawnOptions } from "./main.ts";
import { isBranch, isCheckout, isCommit, isReflog, isRemote, isRemoteBranch, isStash, isTag, isTreeRow, hashOf, nameOf, statusFileOf } from "./main.ts";

const MSG_COMMIT = (flags: string) => `printf '%s' "$NOCTURNE_GIT_MSG" | git commit --cleanup=strip ${flags} -F -`;

/** What an action does; false: it doesn't apply here (the key falls through). */
type Handler = (v: GitView, cx: Context) => boolean | void;

/** Runs `action` for the window's current context. Returns false when the
 *  action doesn't apply here (the key falls through), or isn't one. */
export function act(v: GitView, action: string, cx: Context) {
  const fn = handlerOf(action);

  if (!fn) return false;

  return fn(v, cx) !== false;
}

/** An action's handler, when `action` names one. */
function handlerOf(action: string): Handler | null {
  for (const [name, fn] of Object.entries(ACTIONS)) if (name === action) return fn;

  return null;
}

const it = (v: GitView) => v.item();

/** A git action that reloads after; errors open lazygit's error popup. */
function git(v: GitView, title: string, args: readonly string[], opts?: ExecOptions) { v.exec(title, args, opts); }

/** Runs `fn` on the action queue; a quiet spawn when the result isn't kept. */
function spawn(v: GitView, fn: () => Promise<void>, options?: SpawnOptions) {
  v.spawn(async () => { await fn(); }, options);
}

/** The ref a branch / tag / commit / remote branch row stands for. */
function refOf(v: GitView, x: Item | null = it(v)): string | null {
  if (!x) return null;

  return hashOf(x) ?? (isRemoteBranch(x) ? x.name : null) ?? nameOf(x);
}

/** A row's working-tree files: a directory's, a file's. */
function filesOf(rows: readonly Item[]): StatusFile[] {
  return rows.flatMap((r) => {
    if (!isTreeRow(r)) return [];

    if (r.kind === "dir") return r.files.flatMap((f) => ("staged" in f ? [f] : []));

    const f = statusFileOf(r);

    return f ? [f] : [];
  });
}

/** The selected row when it's a branch. */
const branchOf = (v: GitView) => {
  const x = it(v);

  return isBranch(x) ? x : null;
};

/** The selected row when it's a commit. */
const commitOf = (v: GitView) => {
  const x = it(v);

  return isCommit(x) ? x : null;
};

/** The selected row when it's a remote. */
const remoteOf = (v: GitView) => {
  const x = it(v);

  return isRemote(x) ? x : null;
};

/** The selected row when it's a stash entry. */
const stashOf = (v: GitView) => {
  const x = it(v);

  return isStash(x) ? x : null;
};

/** The selected row when it's a checkout. */
const checkoutOf = (v: GitView) => {
  const x = it(v);

  return isCheckout(x) ? x : null;
};

const ACTIONS = {
  // ---- window
  keys: (v) => v.openKeys(),
  quit: (v) => v.quit(),
  back: (v) => v.back(),
  "focus-main": (v) => v.focusMain(),
  "open-pane": (v) => v.openPane(false),
  "open-pane-tab": (v) => v.openPane(true),
  "panel-prev": (v) => v.stepPanel(-1),
  "panel-next": (v) => v.stepPanel(1),
  "panel:status": (v) => v.setPanel("status"),
  "panel:files": (v) => v.setPanel("files"),
  "panel:branches": (v) => v.setPanel("branches"),
  "panel:commits": (v) => v.setPanel("commits"),
  "panel:stash": (v) => v.setPanel("stash"),
  "main-up": (v) => v.scrollMain(-1),
  "main-down": (v) => v.scrollMain(1),
  refresh: (v) => v.reload(true),
  "screen-next": (v) => v.screen(1),
  "screen-prev": (v) => v.screen(-1),
  "context-more": (v) => v.setContext(1),
  "context-less": (v) => v.setContext(-1),
  whitespace: (v) => {
    v.ws = !v.ws;
    v.note(v.ws ? "Whitespace hidden in diffs" : "Whitespace shown in diffs");
    v.loadMain();
  },
  "log-menu": (v) => v.menu({
    title: "Command log",
    items: [
      { key: "t", label: v.showLog ? "Hide the command log" : "Show the command log", go: () => { v.showLog = !v.showLog; } },
      { key: "c", label: "Clear it", go: () => { v.logs = []; } },
    ],
  }),
  shell: (v) => v.prompt({
    title: "Shell command", placeholder: "runs in the repo's folder (sh -c)", history: v.shellHistory,
    ok: (cmd) => {
      const g = v.git;

      if (!cmd.trim() || !g) return;

      v.shellHistory = [cmd, ...v.shellHistory.filter((c) => c !== cmd)].slice(0, 30);
      spawn(v, async () => {
        const r = await g.run("Shell command", [], { shell: cmd, shown: cmd, timeout: 600000 });

        if (r.out.trim() || r.err) v.showOutput(cmd, (r.out + (r.ok ? "" : `\n${r.err}`)).trim(), r.ok);

        await v.reloadNow();
      }, { row: null });
    },
  }),
  "recent-repos": (v) => v.menu({
    title: "Recent repos",
    items: v.recentRepos().map((r, i) => ({ key: i < 9 ? String(i + 1) : "", label: r.name, sub: r.folder, go: () => v.switchRepo(r.folder) })),
    empty: "No other repos in your spaces yet.",
  }),
  "all-branches-log": (v) => {
    v.allBranches = !v.allBranches;
    v.setPanel("commits");
    v.reload();
    v.note(v.allBranches ? "Commits: every branch" : "Commits: this branch");
  },
  "edit-config": (v) => v.editFile(".git/config"),
  undo: (v) => undoRedo(v, "undo"),
  redo: (v) => undoRedo(v, "redo"),
  "merge-rebase-menu": (v) => mergeRebaseMenu(v),
  "diff-menu": (v) => diffMenu(v),
  push: (v) => push(v),
  pull: (v) => pull(v),
  fetch: (v) => git(v, "Fetch", ["fetch", "--all", "--prune"], { timeout: 120000, row: null }),

  // ---- lists
  down: (v) => v.move(1),
  up: (v) => v.move(-1),
  "page-down": (v) => v.move(v.page()),
  "page-up": (v) => v.move(-v.page()),
  top: (v) => v.moveTo(0),
  bottom: (v) => v.moveTo(Infinity),
  filter: (v) => v.openFilter(),
  "tab-next": (v) => v.stepTab(1),
  "tab-prev": (v) => v.stepTab(-1),
  range: (v) => v.toggleRange(),
  "range-down": (v) => {
    if (!v.range) v.toggleRange();

    v.move(1);
  },
  "range-up": (v) => {
    if (!v.range) v.toggleRange();

    v.move(-1);
  },

  // ---- files
  stage: (v) => {
    const files = filesOf(v.pickedRows());

    if (!files.length) return;

    const allStaged = files.every((f) => f.staged && !f.unstaged);
    const paths = files.flatMap((f) => (f.from ? [f.path, f.from] : [f.path]));

    if (allStaged) return git(v, "Unstage", ["reset", "-q", "--", ...paths]);

    return git(v, "Stage", ["add", "-A", "--", ...paths]);
  },
  "stage-all": (v) => {
    const files = v.data.status?.files ?? [];

    if (files.length && files.every((f) => f.staged && !f.unstaged)) return git(v, "Unstage all", ["reset", "-q"]);

    return git(v, "Stage all", ["add", "-A"]);
  },
  "stage-lines": (v) => {
    const r = it(v);

    if (!isTreeRow(r)) return;

    if (r.kind === "dir") return v.toggleDir(r.path);

    const f = statusFileOf(r);

    if (!f) return;

    if (f.conflict) return conflictMenu(v);

    v.startStaging(f);
  },
  commit: (v) => commit(v, ""),
  "commit-no-verify": (v) => commit(v, "--no-verify"),
  amend: (v) => v.ask({
    title: "Amend last commit", text: "Amend the last commit with what's staged? Its message stays.", danger: true,
    go: () => git(v, "Amend commit", [], { env: {}, shell: "git commit --amend --no-edit --allow-empty", shown: "git commit --amend --no-edit" }),
  }),
  "commit-editor": (v) => v.terminal(["git", "commit"], "git commit"),
  "discard-menu": (v) => discardMenu(v),
  "reset-menu": (v) => v.menu({
    title: "Reset the working tree",
    items: [
      { key: "x", label: "Nuke working tree", sub: "reset --hard; clean -fd", danger: true, go: () => v.ask({ title: "Nuke working tree", text: "Throw away every change and untracked file?", danger: true, go: () => git(v, "Nuke working tree", [], { shell: "git reset -q --hard HEAD && git clean -fd", shown: "git reset --hard HEAD && git clean -fd" }) }) },
      { key: "u", label: "Discard unstaged changes", sub: "checkout -- .", danger: true, go: () => v.ask({ title: "Discard unstaged", text: "Discard every unstaged change?", danger: true, go: () => git(v, "Discard unstaged", ["checkout", "--", "."]) }) },
      { key: "c", label: "Discard untracked files", sub: "clean -fd", danger: true, go: () => v.ask({ title: "Discard untracked", text: "Delete every untracked file?", danger: true, go: () => git(v, "Discard untracked", ["clean", "-fd"]) }) },
      { key: "S", label: "Unstage everything", sub: "reset --mixed HEAD", go: () => git(v, "Mixed reset", ["reset", "-q", "--mixed", "HEAD"]) },
      { key: "h", label: "Hard reset", sub: "reset --hard HEAD", danger: true, go: () => v.ask({ title: "Hard reset", text: "Reset to HEAD, losing every tracked change?", danger: true, go: () => git(v, "Hard reset", ["reset", "--hard", "HEAD"]) }) },
    ],
  }),
  stash: (v) => stashPrompt(v, [], "Stash all changes"),
  "stash-menu": (v) => v.menu({
    title: "Stash options",
    items: [
      { key: "a", label: "Stash all changes", go: () => stashPrompt(v, [], "Stash all changes") },
      { key: "i", label: "Stash all, untracked included", go: () => stashPrompt(v, ["--include-untracked"], "Stash all with untracked") },
      { key: "s", label: "Stash staged changes", go: () => stashPrompt(v, ["--staged"], "Stash staged") },
      { key: "u", label: "Stash unstaged changes", go: () => stashPrompt(v, ["--keep-index"], "Stash unstaged") },
    ],
  }),
  edit: (v) => {
    const p = v.itemPath();

    if (!p) return false;

    v.editFile(p);

    return true;
  },
  open: (v) => {
    const p = v.itemPath();

    if (!p) return false;

    v.openFile(p);

    return true;
  },
  "ignore-menu": (v) => {
    const p = v.itemPath();

    if (!p) return false;

    const add = (file: string, what: string) => git(v, what, [], { env: { NOCTURNE_GIT_LINE: `/${p}` }, shell: `printf '%s\\n' "$NOCTURNE_GIT_LINE" >> "${file}"`, shown: `echo /${p} >> ${file}` });

    v.menu({
      title: `Ignore ${p}`,
      items: [
        { key: "i", label: "Add to .gitignore", go: () => add(".gitignore", "Ignore file") },
        { key: "e", label: "Add to .git/info/exclude", go: () => add("$(git rev-parse --git-path info/exclude)", "Exclude file") },
      ],
    });

    return true;
  },
  tree: (v) => {
    v.tree = !v.tree;
    v.moveTo(0);
  },
  "collapse-all": (v) => v.collapseAll(true),
  "expand-all": (v) => v.collapseAll(false),
  "copy-path": (v, cx) => {
    const p = v.itemPath();

    if (!p) return false;

    v.copy(p, cx);

    return true;
  },
  "status-filter": (v) => v.menu({
    title: "Filter files by status",
    items: [
      { key: "s", label: "Staged only", go: () => { v.statusFilter = "staged"; } },
      { key: "u", label: "Unstaged only", go: () => { v.statusFilter = "unstaged"; } },
      { key: "r", label: "Every file", go: () => { v.statusFilter = null; } },
    ],
  }),
  "conflict-menu": (v) => conflictMenu(v),
  "upstream-reset-menu": (v) => upstreamResetMenu(v),

  // ---- review (diff's)
  "review-mark": (v) => v.review.markAndNext(),
  "review-all": (v) => v.review.markAll(),
  "review-scope": (v) => v.review.nextScope(),
  "review-hide": (v) => v.review.hideMenu(),
  "review-open": (v) => v.focusMain(),

  // ---- worktrees (worktrees.ts does the git and spaces work)
  "worktree-switch": (v) => {
    const w = checkoutOf(v);

    if (w) v.goToWorktree(w);
  },
  "worktree-here": (v) => {
    const w = checkoutOf(v);

    if (!w) return;

    if (w.prunable) return v.error("Its folder is gone: X prunes it.");

    if (w.path === v.git?.root) return v.note("This window is on it already");

    v.switchRepo(w.path);
  },
  "worktree-new": (v) => v.newWorktree(),
  "worktree-of": (v) => {
    const x = it(v);

    if (!x) return;

    const hash = hashOf(x);

    if (hash || isTag(x) || v.ctx() === "tags") {
      const base = hash ?? nameOf(x);

      return base ? v.newWorktree({ base, label: hash ? hash.slice(0, 7) : base }) : undefined;
    }

    if (isRemoteBranch(x)) {
      // A remote branch: a local branch of the same name that tracks it.
      const local = v.data.branches.find((b) => b.name === x.branch);

      return local ? v.newWorktree({ value: x.branch }) : v.newWorktree({ value: x.branch, base: x.name, label: x.name, track: true });
    }

    const name = nameOf(x);

    if (!name) return;

    const taken = v.data.worktrees.find((w) => w.branch === name);

    if (taken) return v.error(`${name} is checked out in ${v.tilde(taken.path)} already: space there goes to it.`);

    v.newWorktree({ value: name, now: true });
  },
  "worktree-remove": (v) => v.removeWorktrees(),
  "worktree-open-menu": (v) => {
    const w = checkoutOf(v);

    if (!w) return;

    const on = v.on;

    v.menu({
      title: `Open ${v.tilde(w.path)}`,
      items: [
        { key: "f", label: "In a files pane", go: () => herdrRun("files.open", on ? { path: w.path, on } : { path: w.path }) },
        { key: "e", label: "In the editor ($EDITOR, a floating terminal)", go: () => v.editIn(w.path) },
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
  "worktree-pick-merged": (v) => v.pickMergedWorktrees(),
  "worktree-prune": (v) => {
    const stale = v.data.worktrees.filter((w) => w.prunable);

    if (!stale.length) return v.note("Nothing to prune: every worktree's folder is there");

    v.ask({
      title: "Prune worktrees", text: `Forget ${stale.length} worktree${stale.length === 1 ? "" : "s"} whose folder is gone?`, lines: stale.map((w) => [v.tilde(w.path), "dim"] as const),
      go: () => git(v, "Prune worktrees", ["worktree", "prune"]),
    });
  },

  // ---- branches
  checkout: (v) => {
    const r = refOf(v);

    if (r) checkoutRef(v, r);
  },
  "branch-new": (v) => {
    const base = refOf(v);

    v.prompt({ title: base ? `New branch from ${short(base)}` : "New branch", placeholder: "name", ok: (name) => { if (name.trim()) git(v, "New branch", ["checkout", "-b", name.trim(), ...(base ? [base] : [])]); } });
  },
  "checkout-by-name": (v) => v.prompt({ title: "Checkout branch", placeholder: "a branch, tag or commit; - for the previous one", ok: (name) => { if (name.trim()) checkoutRef(v, name.trim()); } }),
  "checkout-previous": (v) => git(v, "Checkout previous branch", ["checkout", "-"]),
  "force-checkout": (v) => {
    const r = refOf(v);

    if (r) v.ask({ title: "Force checkout", text: `Check out ${r}, throwing away local changes?`, danger: true, go: () => git(v, "Force checkout", ["checkout", "-f", r]) });
  },
  "branch-delete-menu": (v) => {
    const b = branchOf(v);
    const g = v.git;

    if (!b || !g) return;

    if (b.head) return v.error("You can't delete the branch you're on.");

    const remote = b.upstream && !b.gone ? b.upstream : null;

    const delLocal = () => spawn(v, async () => {
      const r = await g.run("Delete branch", ["branch", "-d", b.name]);

      if (r.ok) return v.reloadNow();

      if (/not fully merged/.test(r.err)) v.ask({ title: "Force delete", text: `${b.name} isn't fully merged. Delete it anyway?`, danger: true, go: () => git(v, "Force delete branch", ["branch", "-D", b.name]) });
      else v.error(r.err);
    });

    const delRemote = (up: string) => {
      const [rem = "", ...rest] = up.split("/");

      git(v, "Delete remote branch", ["push", rem, "--delete", rest.join("/")], { timeout: 120000 });
    };

    const both: MenuItem[] = remote ? [
      { key: "r", label: `Delete remote branch ${remote}`, danger: true, go: () => v.ask({ title: "Delete remote branch", text: `Delete ${remote} on the remote?`, danger: true, go: () => delRemote(remote) }) },
      { key: "b", label: "Delete both", danger: true, go: () => v.ask({ title: "Delete both", text: `Delete ${b.name} here and ${remote} on the remote?`, danger: true, go: () => { delRemote(remote); delLocal(); } }) },
    ] : [];

    v.menu({
      title: `Delete ${b.name}`,
      items: [
        { key: "c", label: "Delete local branch", danger: true, go: () => v.ask({ title: "Delete branch", text: `Delete the local branch ${b.name}?`, danger: true, go: delLocal }) },
        ...both,
      ],
    });
  },
  "rebase-onto": (v) => {
    const r = refOf(v);
    const cur = v.data.status?.head;

    if (!r || r === cur) return v.error("Pick another branch to rebase onto.");

    v.ask({ title: "Rebase", text: `Rebase ${cur ?? "HEAD"} onto ${short(r)}?`, danger: true, go: () => git(v, "Rebase branch", ["rebase", "--autostash", r], { timeout: 120000 }) });
  },
  "merge-menu": (v) => {
    const r = refOf(v);
    const cur = v.data.status?.head ?? "HEAD";

    if (!r) return;

    v.menu({
      title: `Merge ${short(r)} into ${cur}`,
      items: [
        { key: "m", label: "Merge", sub: "git merge", go: () => git(v, "Merge", ["merge", "--no-edit", r], { timeout: 120000 }) },
        { key: "f", label: "Fast-forward only", sub: "--ff-only", go: () => git(v, "Merge (fast-forward)", ["merge", "--ff-only", r]) },
        { key: "n", label: "Always a merge commit", sub: "--no-ff", go: () => git(v, "Merge (no fast-forward)", ["merge", "--no-ff", "--no-edit", r]) },
        { key: "s", label: "Squash merge", sub: "--squash, then commit", go: () => git(v, "Squash merge", ["merge", "--squash", r]) },
      ],
    });
  },
  "fast-forward": (v) => {
    const b = branchOf(v);

    if (!b?.upstream) return v.error(`${b?.name ?? "This branch"} has no upstream.`);

    if (b.head) return git(v, "Fast-forward", [], { shell: "git fetch && git merge --ff-only @{u}", shown: "git fetch && git merge --ff-only @{u}", timeout: 120000 });

    const [rem = "", ...rest] = b.upstream.split("/");

    return git(v, "Fast-forward", ["fetch", rem, `${rest.join("/")}:${b.name}`], { timeout: 120000 });
  },
  "tag-new": (v) => {
    const r = refOf(v) ?? "HEAD";

    v.prompt({
      title: `New tag on ${short(r)}`, placeholder: "name",
      ok: (name) => {
        if (!name.trim()) return;

        v.prompt({
          title: "Tag message (empty: a lightweight tag)", placeholder: "",
          ok: (msg) => git(v, "New tag", ["tag", ...(msg.trim() ? ["-a", "-m", msg.trim()] : []), name.trim(), r]),
        });
      },
    });
  },
  "reset-menu-ref": (v) => {
    const r = refOf(v);

    if (!r) return;

    v.menu({
      title: `Reset ${v.data.status?.head ?? "HEAD"} to ${short(r)}`,
      items: [
        { key: "s", label: "Soft reset", sub: "keep changes staged", go: () => git(v, "Soft reset", ["reset", "--soft", r]) },
        { key: "m", label: "Mixed reset", sub: "keep changes unstaged", go: () => git(v, "Mixed reset", ["reset", "--mixed", r]) },
        { key: "h", label: "Hard reset", sub: "discard changes", danger: true, go: () => v.ask({ title: "Hard reset", text: `Reset to ${short(r)}, discarding every change?`, danger: true, go: () => git(v, "Hard reset", ["reset", "--hard", r]) }) },
      ],
    });
  },
  "branch-rename": (v) => {
    const b = branchOf(v);

    if (!b) return;

    v.prompt({ title: `Rename ${b.name}`, value: b.name, ok: (n) => { if (n.trim() && n.trim() !== b.name) git(v, "Rename branch", ["branch", "-m", b.name, n.trim()]); } });
  },
  "upstream-menu": (v) => {
    const b = branchOf(v);

    if (!b) return;

    const items: MenuItem[] = [
      { key: "s", label: "Set upstream…", go: () => v.prompt({ title: `Upstream of ${b.name}`, value: b.upstream ?? `origin/${b.name}`, ok: (u) => { if (u.trim()) git(v, "Set upstream", ["branch", `--set-upstream-to=${u.trim()}`, b.name]); } }) },
    ];

    if (b.upstream) items.push({ key: "u", label: `Unset upstream (${b.upstream})`, go: () => git(v, "Unset upstream", ["branch", "--unset-upstream", b.name]) });

    if (b.head && b.upstream) items.push({ key: "g", label: "Reset to upstream…", go: () => upstreamResetMenu(v) });

    v.menu({ title: `Upstream of ${b.name}`, items });
  },
  "sort-menu": (v) => v.menu({
    title: "Sort branches",
    items: [
      { key: "r", label: "Recency", go: () => { v.branchSort = "date"; } },
      { key: "a", label: "Alphabetical", go: () => { v.branchSort = "name"; } },
    ],
  }),
  "pr-create": (v) => {
    const b = branchOf(v);

    if (b) gh(v, "Create pull request", ["pr", "create", "--web", "--head", b.name]);
  },
  // The GitHub window's form (github's prForm.ts) on this branch: it reads the branch from shared state.
  "pr-create-github": (v) => {
    const b = branchOf(v);

    if (!b) return;

    setShared("github.create", { folder: v.folder, on: v.on, head: b.name, at: Date.now() });
    herdrRun("nocturne.github-pr");
  },
  "pr-open": (v) => {
    const b = branchOf(v);

    if (b) gh(v, "Open pull request", ["pr", "view", b.name, "--web"]);
  },
  "copy-name": (v, cx) => {
    const name = nameOf(it(v));

    if (name !== null) v.copy(name, cx);
  },
  "view-commits": (v) => {
    const r = refOf(v);

    if (r) v.enterSub({ kind: "subCommits", ref: r, title: short(r) });
  },

  // ---- remotes
  "view-remote-branches": (v) => {
    const r = remoteOf(v);

    if (r) v.enterSub({ kind: "remoteBranches", remote: r.name, title: r.name });
  },
  "fetch-remote": (v) => {
    const r = remoteOf(v);

    if (r) git(v, `Fetch ${r.name}`, ["fetch", "--prune", r.name], { timeout: 120000 });
  },
  "remote-new": (v) => v.prompt({
    title: "New remote: name", placeholder: "upstream",
    ok: (name) => {
      if (!name.trim()) return;

      v.prompt({ title: `Url of ${name.trim()}`, placeholder: "git@github.com:owner/repo.git", ok: (url) => { if (url.trim()) git(v, "Add remote", ["remote", "add", name.trim(), url.trim()]); } });
    },
  }),
  "remote-edit": (v) => {
    const r = remoteOf(v);
    const g = v.git;

    if (!r || !g) return;

    v.prompt({
      title: `Rename ${r.name}`, value: r.name,
      ok: (name) => v.prompt({
        title: `Url of ${name.trim() || r.name}`, value: r.url,
        ok: (url) => spawn(v, async () => {
          let n = r.name;

          if (name.trim() && name.trim() !== r.name) {
            const x = await g.run("Rename remote", ["remote", "rename", r.name, name.trim()]);

            if (!x.ok) return v.error(x.err);

            n = name.trim();
          }

          if (url.trim() && url.trim() !== r.url) {
            const x = await g.run("Set remote url", ["remote", "set-url", n, url.trim()]);

            if (!x.ok) return v.error(x.err);
          }

          await v.reloadNow();
        }),
      }),
    });
  },
  "remote-remove": (v) => {
    const r = remoteOf(v);

    if (r) v.ask({ title: "Remove remote", text: `Remove the remote ${r.name}? Local branches stay.`, danger: true, go: () => git(v, "Remove remote", ["remote", "remove", r.name]) });
  },
  "checkout-remote": (v) => {
    const r = it(v);

    if (!isRemoteBranch(r)) return;

    const local = v.data.branches.find((b) => b.name === r.branch);

    if (local) return checkoutRef(v, r.branch);

    git(v, "Checkout remote branch", ["checkout", "-b", r.branch, "--track", r.name]);
  },
  "remote-branch-delete": (v) => {
    const r = it(v);

    if (isRemoteBranch(r)) v.ask({ title: "Delete remote branch", text: `Delete ${r.name} on ${r.remote}?`, danger: true, go: () => git(v, "Delete remote branch", ["push", r.remote, "--delete", r.branch], { timeout: 120000 }) });
  },
  "set-upstream": (v) => {
    const name = nameOf(it(v));

    if (name !== null) git(v, "Set upstream", ["branch", `--set-upstream-to=${name}`]);
  },

  // ---- tags
  "tag-delete-menu": (v) => {
    const tg = it(v);

    if (!isTag(tg)) return;

    v.menu({
      title: `Delete tag ${tg.name}`,
      items: [
        { key: "c", label: "Delete local tag", danger: true, go: () => v.ask({ title: "Delete tag", text: `Delete the tag ${tg.name} here?`, danger: true, go: () => git(v, "Delete tag", ["tag", "-d", tg.name]) }) },
        ...v.data.remotes.map((r, i) => ({ key: i ? "" : "r", label: `Delete on ${r.name}`, danger: true, go: () => v.ask({ title: "Delete remote tag", text: `Delete the tag ${tg.name} on ${r.name}?`, danger: true, go: () => git(v, "Delete remote tag", ["push", r.name, "--delete", `refs/tags/${tg.name}`], { timeout: 120000 }) }) })),
      ],
    });
  },
  "tag-push": (v) => {
    const tg = it(v);

    if (!isTag(tg)) return;

    const remotes = v.data.remotes;
    const only = remotes.length === 1 ? remotes[0] : undefined;

    if (only) return git(v, "Push tag", ["push", only.name, `refs/tags/${tg.name}`], { timeout: 120000 });

    v.menu({ title: `Push ${tg.name} to`, items: remotes.map((r, i) => ({ key: String(i + 1), label: r.name, sub: r.url, go: () => git(v, "Push tag", ["push", r.name, `refs/tags/${tg.name}`], { timeout: 120000 }) })), empty: "No remotes." });
  },

  // ---- commits
  "view-files": (v) => {
    const c = it(v);

    if (isCommit(c)) v.enterSub({ kind: "commitFiles", hash: c.hash, title: c.short, stash: false });
    else if (isStash(c)) v.enterSub({ kind: "commitFiles", hash: c.hash, title: c.ref, stash: true });
    else {
      const hash = hashOf(c);

      if (hash) v.enterSub({ kind: "commitFiles", hash, title: isReflog(c) ? c.short : short(hash), stash: false });
    }
  },
  "checkout-commit": (v) => {
    const c = commitOf(v);

    if (c) v.ask({ title: "Checkout commit", text: `Check out ${short(c.hash)} as a detached HEAD?`, go: () => git(v, "Checkout commit", ["checkout", c.hash]) });
  },
  reword: (v) => {
    const c = commitOf(v);
    const g = v.git;

    if (!c || !g) return;

    if (v.rebasing()) return v.error("Mid-rebase: press m to continue or abort first.");

    spawn(v, async () => {
      const msg = (await g.text(["log", "-1", "--format=%B", c.hash])).trim();

      v.commitPopup({
        title: `Reword ${short(c.hash)}`, value: msg,
        ok: (m) => {
          if (v.isHead(c)) return git(v, "Reword", [], { env: { NOCTURNE_GIT_MSG: m }, shell: MSG_COMMIT("--amend --only --allow-empty"), shown: "git commit --amend --only -m <message>" });

          rebaseRewrite(v, "reword", { NOCTURNE_GIT_MSG: m });
        },
      });
    });
  },
  "reword-editor": (v) => {
    const c = commitOf(v);

    if (!c) return;

    if (v.isHead(c)) return v.terminal(["git", "commit", "--amend", "--only"], "git commit --amend --only");

    const plan = rewrite(v.commitList(), v.commitIndex(), "edit");

    if ("error" in plan) return v.error(plan.error);

    const todo = plan.todo.replace(/^edit /m, "reword ");

    v.terminal(["env", `NOCTURNE_GIT_TODO=${todo}`, `GIT_SEQUENCE_EDITOR=sh -c 'printf "%s" "$NOCTURNE_GIT_TODO" > "$1"' -`, "git", "rebase", "-i", "--autostash", ...(plan.base ? [plan.base] : ["--root"])], `git rebase -i (reword ${short(c.hash)})`);
  },
  squash: (v) => confirmRewrite(v, "squash", "Squash", "Squash this commit into the one below it? Their messages are combined."),
  fixup: (v) => confirmRewrite(v, "fixup", "Fixup", "Meld this commit into the one below it? Its message is dropped."),
  drop: (v) => confirmRewrite(v, "drop", "Drop commit", "Drop this commit from the branch?"),
  "edit-commit": (v) => rebaseRewrite(v, "edit"),
  "move-down": (v) => rebaseRewrite(v, "move-down", {}, () => v.move(1)),
  "move-up": (v) => rebaseRewrite(v, "move-up", {}, () => v.move(-1)),
  pick: (v) => (v.rebasing() ? v.error("Picking todo entries mid-rebase isn't here yet: press m to continue, or i for git's own todo.") : v.error("Pick only applies mid-rebase.")),
  "rebase-interactive": (v) => {
    const c = commitOf(v);

    if (!c) return;

    const base = c.parents[0];

    v.terminal(["git", "rebase", "-i", "--autostash", ...(base ? [base] : ["--root"])], `git rebase -i ${base ? short(base) : "--root"}`);
  },
  "fixup-commit": (v) => {
    const c = commitOf(v);

    if (c) git(v, "Create fixup commit", ["commit", `--fixup=${c.hash}`]);
  },
  autosquash: (v) => {
    const c = commitOf(v);

    if (!c) return;

    const parent = c.parents[0];

    v.ask({
      title: "Apply fixup commits", text: `Squash every fixup! commit above ${short(c.hash)} into its target?`, danger: true,
      go: () => git(v, "Apply fixup commits", ["rebase", "-i", "--autosquash", "--autostash", ...(parent ? [parent] : ["--root"])], { env: { GIT_SEQUENCE_EDITOR: "true" }, timeout: 120000 }),
    });
  },
  "amend-commit": (v) => {
    const c = commitOf(v);

    if (!c) return;

    if (!(v.data.status?.files ?? []).some((f) => f.staged)) return v.error("Nothing is staged to amend with.");

    const parent = c.parents[0] ?? "--root";

    v.ask({
      title: "Amend commit", text: `Amend ${short(c.hash)} with what's staged?`, danger: true,
      go: () => (v.isHead(c)
        ? git(v, "Amend commit", ["commit", "--amend", "--no-edit"])
        : git(v, "Amend commit", [], { env: { GIT_SEQUENCE_EDITOR: "true" }, shell: `git commit --fixup=${c.hash} && git rebase -i --autosquash --autostash ${parent}`, shown: `git commit --fixup=${short(c.hash)} && git rebase -i --autosquash ${short(parent)}`, timeout: 120000 })),
    });
  },
  revert: (v) => {
    const c = commitOf(v);

    if (!c) return;

    v.ask({ title: "Revert", text: `Make a commit that undoes ${short(c.hash)}?`, danger: true, go: () => git(v, "Revert commit", ["revert", "--no-edit", ...(c.parents.length > 1 ? ["-m", "1"] : []), c.hash]) });
  },
  "cherry-copy": (v) => cherryCopy(v),
  "cherry-paste": (v) => {
    const g = v.git;

    if (!v.copied.length || !g) return v.error("Nothing copied: C on a commit copies it.");

    const list = [...v.copied].sort((a, b) => a.date - b.date).map((c) => c.hash);

    v.ask({
      title: "Cherry-pick", text: `Paste ${list.length} commit${list.length === 1 ? "" : "s"} onto ${v.data.status?.head ?? "HEAD"}?`,
      go: () => spawn(v, async () => {
        const r = await g.run("Cherry-pick", ["cherry-pick", ...list], { timeout: 120000 });

        if (r.ok) v.copied = [];
        else v.error(r.err);

        await v.reloadNow();
      }),
    });
  },
  "cherry-reset": (v) => {
    v.copied = [];
    v.note("Copied commits forgotten");
  },
  "cherry-legacy": (v) => cherryCopy(v),
  "copy-hash": (v, cx) => {
    const hash = hashOf(it(v));

    if (hash) v.copy(hash, cx);
  },
  "copy-menu": (v) => {
    const c = commitOf(v);
    const g = v.git;

    if (!c || !g) return;

    spawn(v, async () => {
      const [msg, diff] = await Promise.all([g.text(["log", "-1", "--format=%B", c.hash]), g.text(["show", "--format=", c.hash])]);
      const url = commitUrl(v, c.hash);

      v.menu({
        title: `Copy from ${short(c.hash)}`,
        items: [
          { key: "c", label: "Hash", sub: c.hash, go: (cx2) => v.copy(c.hash, cx2) },
          { key: "s", label: "Subject", sub: c.subject, go: (cx2) => v.copy(c.subject, cx2) },
          { key: "m", label: "Message", go: (cx2) => v.copy(msg.trim(), cx2) },
          { key: "a", label: "Author", sub: `${c.author} <${c.email}>`, go: (cx2) => v.copy(`${c.author} <${c.email}>`, cx2) },
          { key: "d", label: "Diff", go: (cx2) => v.copy(diff, cx2) },
          ...(url ? [{ key: "u", label: "Url", sub: url, go: (cx2: Context) => v.copy(url, cx2) }] : []),
        ],
      });
    });
  },
  "open-commit-browser": (v) => {
    const hash = hashOf(it(v));
    const url = hash && commitUrl(v, hash);

    if (!url) return v.error("No GitHub-style remote to open it on.");

    herdrRun("app.open_url", { url, in: "system" });
  },
  "select-branch-commits": (v) => {
    const list = v.commitList();
    const n = list.findIndex((c) => !v.data.notMain.has(c.hash));

    if (n <= 0) return v.note("Every shown commit is on the main branch.");

    v.selectRange(0, n - 1);
  },
  "log-options": (v) => v.menu({
    title: "Log options",
    items: [
      { key: "g", label: v.noGraph ? "Show the graph" : "Hide the graph", go: () => { v.noGraph = !v.noGraph; } },
      { key: "a", label: v.allBranches ? "Only this branch" : "Every branch", go: () => { v.allBranches = !v.allBranches; v.reload(); } },
      { key: "+", label: "Wide commits (screen mode)", sub: "+ / _", go: () => { v.panel = "commits"; v.screen(1); } },
    ],
  }),

  // ---- commit files
  "checkout-file": (v) => {
    const path = v.itemPath(), s = v.sub();

    if (!path || s?.kind !== "commitFiles") return;

    v.ask({ title: "Checkout file", text: `Replace ${path} in your work tree with its version in ${short(s.hash)}?`, danger: true, go: () => git(v, "Checkout file", ["checkout", s.hash, "--", path]) });
  },

  // ---- stash
  "stash-apply": (v) => {
    const s = stashOf(v);

    if (s) git(v, "Apply stash", ["stash", "apply", s.ref]);
  },
  "stash-pop": (v) => {
    const s = stashOf(v);

    if (s) v.ask({ title: "Pop stash", text: `Apply ${s.ref} and drop it from the stash?`, go: () => git(v, "Pop stash", ["stash", "pop", s.ref]) });
  },
  "stash-drop": (v) => {
    const s = stashOf(v);

    if (s) v.ask({ title: "Drop stash", text: `Drop ${s.ref} (${s.subject})?`, danger: true, go: () => git(v, "Drop stash", ["stash", "drop", s.ref]) });
  },
  "stash-branch": (v) => {
    const s = stashOf(v);

    if (s) v.prompt({ title: `New branch from ${s.ref}`, placeholder: "name", ok: (n) => { if (n.trim()) git(v, "Branch from stash", ["stash", "branch", n.trim(), s.ref]); } });
  },
  "stash-rename": (v) => {
    const s = stashOf(v);

    if (!s) return;

    v.prompt({
      title: `Rename ${s.ref}`, value: s.subject.replace(/^On [^:]+: /, ""),
      ok: (m) => git(v, "Rename stash", [], { env: { NOCTURNE_GIT_MSG: m }, shell: `h=$(git rev-parse ${shq(s.ref)}) && git stash drop -q ${shq(s.ref)} && git stash store -m "$NOCTURNE_GIT_MSG" "$h"`, shown: `git stash drop ${s.ref} && git stash store -m <message> <hash>` }),
    });
  },

  // ---- staging lines
  "line-down": (v) => (v.staging ? v.stepLine(1) : v.scrollMain(1, 1)),
  "line-up": (v) => (v.staging ? v.stepLine(-1) : v.scrollMain(-1, 1)),
  "hunk-next": (v) => v.stepHunk(1),
  "hunk-prev": (v) => v.stepHunk(-1),
  "hunk-mode": (v) => {
    if (v.staging) {
      v.staging.hunkMode = !v.staging.hunkMode;
      v.staging.anchor = null;
    }
  },
  "switch-side": (v) => v.switchSide(),
  "stage-pick": (v) => stagePick(v),
  "discard-pick": (v) => discardPick(v),
  "copy-lines": (v, cx) => {
    const s = v.staging;

    if (!s) return;

    const keys = v.pickedKeys();
    const text = s.rows.flatMap((r) => (keys.has(`${r.hunk}:${r.line}`) ? [r.text] : [])).join("\n");

    v.copy(text, cx);
  },
  "file-next": (v) => v.stepFile(1),
  "file-prev": (v) => v.stepFile(-1),
} satisfies { readonly [A in Action]?: Handler };

const short = (r: string) => (/^[0-9a-f]{40}$/.test(r) ? r.slice(0, 7) : r);

/** C: copies the picked commits (again: forgets one), for V to paste. */
function cherryCopy(v: GitView) {
  for (const c of v.pickedRows()) {
    if (!isCommit(c) && !isReflog(c) && !isStash(c)) continue;

    const i = v.copied.findIndex((x) => x.hash === c.hash);

    if (i >= 0) v.copied.splice(i, 1);
    else v.copied.push({ hash: c.hash, subject: c.subject, date: c.date });
  }

  v.note(v.copied.length ? `${v.copied.length} commit${v.copied.length === 1 ? "" : "s"} copied: V pastes them, ctrl-r forgets them` : "Copied commits forgotten");
}

function checkoutRef(v: GitView, ref: string) {
  const g = v.git;

  if (!g) return;

  spawn(v, async () => {
    const r = await g.run("Checkout", ["checkout", ref]);

    if (r.ok) return v.reloadNow();

    if (/would be overwritten|commit your changes or stash/i.test(r.err)) {
      v.ask({ title: "Checkout", text: `Your local changes would be overwritten. Stash them, check out ${short(ref)}, then pop them back?`, go: () => git(v, "Autostash checkout", [], { shell: `git stash push -q -m "git autostash" && git checkout ${shq(ref)} && git stash pop -q`, shown: `git stash && git checkout ${ref} && git stash pop` }) });
    } else v.error(r.err);

    await v.reloadNow();
  });
}

function commit(v: GitView, flags: string) {
  const files = v.data.status?.files ?? [];
  const g = v.git;

  if (!files.length || !g) return v.error("Nothing to commit: the work tree is clean.");

  const go = () => v.commitPopup({
    title: flags ? "Commit (no hooks)" : "Commit", draft: true,
    ok: (m) => git(v, "Commit", [], { env: { NOCTURNE_GIT_MSG: m }, shell: MSG_COMMIT(flags), shown: `git commit ${flags ? `${flags} ` : ""}-m <message>` }),
  });

  if (!files.some((f) => f.staged)) {
    return v.ask({
      title: "Nothing staged", text: "No files are staged. Stage every change and commit?",
      go: async () => {
        const r = await g.run("Stage all", ["add", "-A"]);

        if (!r.ok) return v.error(r.err);

        await v.reloadNow();
        go();
      },
    });
  }

  go();
}

function discardMenu(v: GitView) {
  const files = filesOf(v.pickedRows());
  const g = v.git;
  const first = files[0];

  if (!first || !g) return;

  const what = files.length === 1 ? first.path : `${files.length} files`;

  const all = () => spawn(v, async () => {
    const untracked = files.flatMap((f) => (f.untracked ? [f.path] : []));
    const added = files.flatMap((f) => (!f.untracked && f.x === "A" ? [f.path] : []));
    const tracked = files.flatMap((f) => (f.untracked || f.x === "A" ? [] : f.from ? [f.path, f.from] : [f.path]));

    if (tracked.length) {
      const r = await g.run("Discard changes", ["checkout", "HEAD", "--", ...tracked]);

      if (!r.ok) return v.error(r.err);
    }

    if (added.length) {
      const r = await g.run("Discard new files", [], { shell: `git rm -q -f --cached -- ${added.map(shq).join(" ")} && rm -f -- ${added.map(shq).join(" ")}`, shown: `git rm --cached ${added.join(" ")} && rm ${added.join(" ")}` });

      if (!r.ok) return v.error(r.err);
    }

    if (untracked.length) {
      const r = await g.run("Discard untracked", ["clean", "-fd", "--", ...untracked]);

      if (!r.ok) return v.error(r.err);
    }

    await v.reloadNow();
  });

  const items: MenuItem[] = [{ key: "x", label: "Discard all changes", danger: true, go: () => v.ask({ title: "Discard", text: `Discard every change to ${what}?`, danger: true, go: all }) }];

  if (files.some((f) => f.staged && f.unstaged)) {
    items.push({ key: "u", label: "Discard unstaged changes", danger: true, go: () => v.ask({ title: "Discard unstaged", text: `Discard the unstaged changes to ${what}?`, danger: true, go: () => git(v, "Discard unstaged", ["checkout", "--", ...files.flatMap((f) => (f.unstaged && !f.untracked ? [f.path] : []))]) }) });
  }

  v.menu({ title: `Discard ${what}`, items });
}

function conflictMenu(v: GitView) {
  const f = statusFileOf(it(v));

  if (!f?.conflict) return v.error("No merge conflict in this file.");

  v.menu({
    title: `Conflict in ${f.path}`,
    items: [
      { key: "o", label: "Use ours", sub: "checkout --ours", go: () => git(v, "Use ours", [], { shell: `git checkout --ours -- ${shq(f.path)} && git add -- ${shq(f.path)}`, shown: `git checkout --ours ${f.path} && git add ${f.path}` }) },
      { key: "t", label: "Use theirs", sub: "checkout --theirs", go: () => git(v, "Use theirs", [], { shell: `git checkout --theirs -- ${shq(f.path)} && git add -- ${shq(f.path)}`, shown: `git checkout --theirs ${f.path} && git add ${f.path}` }) },
      { key: "e", label: "Edit the file", go: () => v.editFile(f.path) },
      { key: "a", label: "Mark as resolved", sub: "git add", go: () => git(v, "Mark resolved", ["add", "--", f.path]) },
    ],
  });
}

function upstreamResetMenu(v: GitView) {
  const up = v.data.status?.upstream;

  if (!up) return v.error("This branch has no upstream.");

  v.menu({
    title: `Reset to ${up}`,
    items: [
      { key: "s", label: "Soft reset", go: () => git(v, "Soft reset to upstream", ["reset", "--soft", up]) },
      { key: "m", label: "Mixed reset", go: () => git(v, "Mixed reset to upstream", ["reset", "--mixed", up]) },
      { key: "h", label: "Hard reset", danger: true, go: () => v.ask({ title: "Hard reset", text: `Reset to ${up}, discarding local commits and changes?`, danger: true, go: () => git(v, "Hard reset to upstream", ["reset", "--hard", up]) }) },
    ],
  });
}

function stashPrompt(v: GitView, flags: readonly string[], title: string) {
  if (!(v.data.status?.files ?? []).length) return v.error("Nothing to stash.");

  v.prompt({ title, placeholder: "message (optional)", ok: (m) => git(v, title, ["stash", "push", ...flags, ...(m.trim() ? ["-m", m.trim()] : [])]) });
}

function confirmRewrite(v: GitView, action: Rewrite, title: string, text: string) {
  if (v.rebasing()) return v.error("Mid-rebase: press m to continue or abort first.");

  const plan = rewrite(v.commitList(), v.commitIndex(), action);

  if ("error" in plan) return v.error(plan.error);

  v.ask({ title, text, danger: true, go: () => rebaseRewrite(v, action) });
}

/** A rewrite's name in the command log. */
function rewriteTitle(action: Rewrite) {
  switch (action) {
    case "squash": return "Squash";
    case "fixup": return "Fixup";
    case "drop": return "Drop commit";
    case "reword": return "Reword";
    case "edit": return "Edit commit";
    case "move-down": return "Move commit down";
    case "move-up": return "Move commit up";
  }
}

function rebaseRewrite(v: GitView, action: Rewrite, env: Env = {}, after?: () => void) {
  if (v.rebasing()) return v.error("Mid-rebase: press m to continue or abort first.");

  const plan = rewrite(v.commitList(), v.commitIndex(), action);
  const g = v.git;

  if ("error" in plan) return v.error(plan.error);

  if (!g) return;

  spawn(v, async () => {
    const r = await g.rebase(rewriteTitle(action), plan.base, plan.todo, env);

    if (!r.ok && !/stopped at|Stopped at/i.test(r.out + r.err)) v.error(r.err);
    else if (action === "edit") v.note("Rebase stopped at the commit: change it, amend, then m to continue");
    else after?.();

    await v.reloadNow();
  });
}

/** The command git's in-progress operation goes on with. */
function verbOf(s: NonNullable<GitView["data"]["state"]>) {
  switch (s) {
    case "rebasing": return "rebase";
    case "merging": return "merge";
    case "cherry-picking": return "cherry-pick";
    case "reverting": return "revert";
    case "bisecting": return "bisect";
  }
}

function mergeRebaseMenu(v: GitView) {
  const s = v.data.state;

  if (!s) return v.error("Not merging or rebasing.");

  const verb = verbOf(s);

  if (verb === "bisect") return v.menu({ title: "Bisect", items: [{ key: "r", label: "Reset bisect", go: () => git(v, "Bisect reset", ["bisect", "reset"]) }] });

  v.menu({
    title: `${s.slice(0, 1).toUpperCase()}${s.slice(1)}`,
    items: [
      { key: "c", label: "Continue", sub: `git ${verb} --continue`, go: () => git(v, `Continue ${verb}`, [verb, "--continue"], { timeout: 120000 }) },
      { key: "a", label: "Abort", sub: `git ${verb} --abort`, danger: true, go: () => v.ask({ title: `Abort ${verb}`, text: `Abort the ${verb}?`, danger: true, go: () => git(v, `Abort ${verb}`, [verb, "--abort"]) }) },
      ...(verb !== "merge" ? [{ key: "s", label: "Skip this commit", sub: `git ${verb} --skip`, go: () => git(v, `Skip`, [verb, "--skip"]) }] : []),
    ],
  });
}

function diffMenu(v: GitView) {
  const r = refOf(v);
  const items: MenuItem[] = [];

  if (r) {
    items.push({
      key: "s", label: `Diff against ${short(r)}`, sub: "then pick another to compare",
      go: () => {
        v.diffBase = r;
        v.note(`Diff mode: ${short(r)} against the selection (W to leave)`);
        v.loadMain();
      },
    });
  }

  items.push({
    key: "e", label: "Enter a ref to diff against",
    go: () => v.prompt({
      title: "Diff against", placeholder: "a branch, tag or commit",
      ok: (x) => {
        if (x.trim()) {
          v.diffBase = x.trim();
          v.loadMain();
        }
      },
    }),
  });

  if (v.diffBase) {
    items.push({
      key: "r", label: "Reverse the direction",
      go: () => {
        v.diffReverse = !v.diffReverse;
        v.loadMain();
      },
    });
    items.push({
      key: "x", label: "Leave diff mode",
      go: () => {
        v.diffBase = null;
        v.diffReverse = false;
        v.loadMain();
      },
    });
  }

  v.menu({ title: "Diffing", items });
}

function undoRedo(v: GitView, what: "undo" | "redo") {
  const g = v.git;

  if (!g) return;

  spawn(v, async () => {
    const reflog = await g.reflog(100);
    const step = what === "undo" ? nextUndo(reflog) : nextRedo(reflog);

    if (!step) return v.error(what === "undo" ? "Nothing to undo." : "Nothing to redo.");

    const dirty = (v.data.status?.files ?? []).length > 0;

    v.ask({
      title: what === "undo" ? "Undo" : "Redo",
      text: `${step.says}${step.hard && dirty ? " (your uncommitted changes are stashed and put back)" : ""}?`, danger: step.hard,
      go: () => git(v, step.says, [], {
        env: { GIT_REFLOG_ACTION: what === "undo" ? UNDO : REDO },
        shell: step.hard && dirty ? `git stash push -q -u -m "git ${what}" && git ${step.args.map(shq).join(" ")} && git stash pop -q` : `git ${step.args.map(shq).join(" ")}`,
        shown: `git ${step.args.join(" ")}`,
      }),
    });
  }, { row: null }); // the whole repo moves, not one row
}

function push(v: GitView) {
  const s = v.data.status;
  const g = v.git;
  const head = s?.head;

  if (!s || !head || !g) return v.error("Not on a branch: nothing to push.");

  const go = (args: readonly string[], title = "Push") => spawn(v, async () => {
    // The pushed branch's row spins (whichever row is selected).
    v.busy(`Pushing ${head}…`);

    const r = await g.run(title, args, { timeout: 300000 });

    v.busy(null);

    if (r.ok) return v.reloadNow();

    if (/rejected|non-fast-forward|fetch first/i.test(r.err)) {
      v.ask({ title: "Force push", text: `${head} was rejected: the remote has commits you don't. Force push (with lease)?`, danger: true, go: () => go(["push", "--force-with-lease"], "Force push") });
    } else v.error(r.err);

    await v.reloadNow();
  }, { row: `branch:${head}` });

  if (s.upstream) return go(["push"]);

  const remote = v.data.remotes[0]?.name;

  if (!remote) return v.error("No remote to push to: add one in Branches › Remotes (n).");

  v.prompt({
    title: "Push to (upstream)", value: `${remote} ${head}`,
    ok: (x) => {
      const [r, b] = x.trim().split(/\s+/);

      if (r) go(["push", "--set-upstream", r, b ?? head]);
    },
  });
}

function pull(v: GitView) {
  const s = v.data.status;
  const g = v.git;
  const head = s?.head;

  if (!s || !head || !g) return v.error("Not on a branch: nothing to pull.");

  const go = (args: readonly string[]) => spawn(v, async () => {
    v.busy(`Pulling ${head}…`);

    const r = await g.run("Pull", args, { timeout: 300000 });

    v.busy(null);

    if (!r.ok) v.error(r.err);

    await v.reloadNow();
  }, { row: `branch:${head}` });

  if (s.upstream) return go(["pull", "--no-edit"]);

  const remote = v.data.remotes[0]?.name;

  if (!remote) return v.error("No remote to pull from.");

  v.prompt({
    title: "Pull from (and set as upstream)", value: `${remote}/${head}`,
    ok: (x) => spawn(v, async () => {
      const r = await g.run("Set upstream", ["branch", `--set-upstream-to=${x.trim()}`]);

      if (!r.ok) return v.error(r.err);

      go(["pull", "--no-edit"]);
    }),
  });
}

function gh(v: GitView, title: string, args: readonly string[]) {
  const g = v.git;

  if (!g) return;

  spawn(v, async () => {
    const r = await g.run(title, [], { shell: `gh ${args.map(shq).join(" ")}`, shown: `gh ${args.join(" ")}` });

    if (!r.ok) v.error(r.err);
  }, { row: null });
}

/** https://host/owner/repo/commit/<hash> from the first remote's url, if it's a GitHub-style one. */
function commitUrl(v: GitView, hash: string) {
  const url = v.data.remotes.find((r) => r.name === "origin")?.url ?? v.data.remotes[0]?.url;

  if (!url) return null;

  const m = /^(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?\/?$/.exec(url);

  return m ? `https://${m[1] ?? ""}/${m[2] ?? ""}/commit/${hash}` : null;
}

// ---- staging lines

function stagePick(v: GitView) {
  const s = v.staging;
  const g = v.git;
  const diff = s?.diff;

  if (!s || !diff || !g) return;

  const keys = v.pickedKeys();

  if (!keys.size) return;

  const reverse = s.side === "staged";
  const patch = partialPatch(diff, keys, { reverse });

  if (!patch) return;

  spawn(v, async () => {
    if (!reverse && s.file.untracked) {
      const r = await g.run("Intent to add", ["add", "-N", "--", s.file.path]);

      if (!r.ok) return v.error(r.err);

      // The diff of an intent-to-add file is the same lines: apply as a change to an empty file.
      s.diff = { ...diff, status: "added" };
    }

    const r = await g.apply(reverse ? "Unstage lines" : "Stage lines", patch, reverse ? ["--cached", "-R", "--recount"] : ["--cached", "--recount"]);

    if (!r.ok) v.error(r.err);

    s.anchor = null;
    await v.reloadNow();
  });
}

function discardPick(v: GitView) {
  const s = v.staging;
  const g = v.git;

  if (!s?.diff || !g) return;

  if (s.side === "staged") return stagePick(v); // lazygit: d on the staged side unstages

  const keys = v.pickedKeys();

  if (!keys.size) return;

  const patch = partialPatch(s.diff, keys, { reverse: true });

  if (!patch) return;

  v.ask({
    title: "Discard lines", text: `Discard ${keys.size} changed line${keys.size === 1 ? "" : "s"} from ${s.file.path}?`, danger: true,
    go: () => spawn(v, async () => {
      const r = await g.apply("Discard lines", patch, ["-R", "--recount"]);

      if (!r.ok) v.error(r.err);

      s.anchor = null;
      await v.reloadNow();
    }),
  });
}
