// The git window's own actions and the lists' (keys.ts): panels, screen
// modes, the menus of the whole repo (log, merge / rebase, diff mode, undo),
// push and pull, paging and ranges.

import { nextUndo, nextRedo, UNDO, REDO } from "./history.ts";
import { shq } from "./git.ts";
import type { Action } from "./keys.ts";
import type { MenuItem } from "./popups.ts";
import type { default as GitView } from "./main.ts";
import { openKeys } from "./bars.ts";
import { openPane, quit } from "./panes.ts";
import { loadMain } from "./content.ts";
import { cycleScreen, giveWay, moveBy, openFilter, pageRows, setContext, stepPanel, stepTab, toggleRange } from "./navigate.ts";
import { reload } from "./reads.ts";
import { editFile, recentRepos, switchRepo } from "./elsewhere.ts";
import type { Handler } from "./acting.ts";
import { spawn, push, pull, git, refOf } from "./acting.ts";
import { short } from "./draw.ts";

export const WINDOW_ACTIONS = {
  // ---- window
  keys: (v) => openKeys(v),
  quit: (v) => quit(v),
  back: (v) => giveWay(v),
  "focus-main": (v) => v.focusMain(),
  "open-pane": (v) => openPane(v, false),
  "open-pane-tab": (v) => openPane(v, true),
  "panel-prev": (v) => stepPanel(v, -1),
  "panel-next": (v) => stepPanel(v, 1),
  "panel:status": (v) => v.setPanel("status"),
  "panel:files": (v) => v.setPanel("files"),
  "panel:branches": (v) => v.setPanel("branches"),
  "panel:commits": (v) => v.setPanel("commits"),
  "panel:stash": (v) => v.setPanel("stash"),
  "main-up": (v) => v.scrollMain(-1),
  "main-down": (v) => v.scrollMain(1),
  refresh: (v) => reload(v, true),
  "screen-next": (v) => cycleScreen(v, 1),
  "screen-prev": (v) => cycleScreen(v, -1),
  "context-more": (v) => setContext(v, 1),
  "context-less": (v) => setContext(v, -1),
  whitespace: (v) => {
    v.ws = !v.ws;
    v.note(v.ws ? "Whitespace hidden in diffs" : "Whitespace shown in diffs");
    loadMain(v);
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
    items: recentRepos(v).map((r, i) => ({ key: i < 9 ? String(i + 1) : "", label: r.name, sub: r.folder, go: () => switchRepo(v, r.folder) })),
    empty: "No other repos in your spaces yet.",
  }),
  "all-branches-log": (v) => {
    v.allBranches = !v.allBranches;
    v.setPanel("commits");
    reload(v);
    v.note(v.allBranches ? "Commits: every branch" : "Commits: this branch");
  },
  "edit-config": (v) => editFile(v, ".git/config"),
  undo: (v) => undoRedo(v, "undo"),
  redo: (v) => undoRedo(v, "redo"),
  "merge-rebase-menu": (v) => mergeRebaseMenu(v),
  "diff-menu": (v) => diffMenu(v),
  push: (v) => push(v),
  pull: (v) => pull(v),
  fetch: (v) => git(v, "Fetch", ["fetch", "--all", "--prune"], { timeout: 120000, row: null }),


  // ---- lists
  down: (v) => moveBy(v, 1),
  up: (v) => moveBy(v, -1),
  "page-down": (v) => moveBy(v, pageRows(v)),
  "page-up": (v) => moveBy(v, -pageRows(v)),
  top: (v) => v.moveTo(0),
  bottom: (v) => v.moveTo(Infinity),
  filter: (v) => openFilter(v),
  "tab-next": (v) => stepTab(v, 1),
  "tab-prev": (v) => stepTab(v, -1),
  range: (v) => toggleRange(v),
  "range-down": (v) => {
    if (!v.range) toggleRange(v);

    moveBy(v, 1);
  },
  "range-up": (v) => {
    if (!v.range) toggleRange(v);

    moveBy(v, -1);
  },

} satisfies { readonly [A in Action]?: Handler };

/** The command git's in-progress operation goes on with. */
export function verbOf(s: NonNullable<GitView["data"]["state"]>) {
  switch (s) {
    case "rebasing": return "rebase";
    case "merging": return "merge";
    case "cherry-picking": return "cherry-pick";
    case "reverting": return "revert";
    case "bisecting": return "bisect";
  }
}

export function mergeRebaseMenu(v: GitView) {
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

export function diffMenu(v: GitView) {
  const r = refOf(v);
  const items: MenuItem[] = [];

  if (r) {
    items.push({
      key: "s", label: `Diff against ${short(r)}`, sub: "then pick another to compare",
      go: () => {
        v.diffBase = r;
        v.note(`Diff mode: ${short(r)} against the selection (W to leave)`);
        loadMain(v);
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
          loadMain(v);
        }
      },
    }),
  });

  if (v.diffBase) {
    items.push({
      key: "r", label: "Reverse the direction",
      go: () => {
        v.diffReverse = !v.diffReverse;
        loadMain(v);
      },
    });
    items.push({
      key: "x", label: "Leave diff mode",
      go: () => {
        v.diffBase = null;
        v.diffReverse = false;
        loadMain(v);
      },
    });
  }

  v.menu({ title: "Diffing", items });
}

export function undoRedo(v: GitView, what: "undo" | "redo") {
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
