// Every key the git window knows, lazygit's defaults (docs/keybindings in
// lazygit, 2025): one table drives the key handling, the options bar, the ?
// menu, the right-click menus and the coverage table in the report. Pure:
// tested in scripts/git.test.ts.
//
// Each binding: [context, keys, action, label, flags]. flags: "bar" shows it
// in the options bar, "menu" in the right-click menu, "danger" confirms first
// (lazygit's red entries), "hidden" leaves it out of ? (an alias).
//
// Contexts are the panel (or popup) with the keyboard; "global" and "list"
// apply under every panel. Review (diff's mode, a tab of the Files
// panel) takes space / a / s / ctrl-b for its own meaning there: lazygit's
// stage / stage all / stash stay on the Files tab. See REVIEW_CLASHES.

import type { KeyEvent } from "gpui-kit";
import { literal } from "./guard.ts";

/** Where a key applies: the panel (or popup) with the keyboard; "global" and
 *  "list" under every panel. */
export type KeyContext =
  | "global" | "list" | "status" | "files" | "review" | "worktrees" | "branches" | "remotes" | "remoteBranches"
  | "tags" | "commits" | "reflog" | "subCommits" | "commitFiles" | "stash" | "staging" | "main"
  | "menu" | "confirm" | "prompt" | "commit";

/** A row of the table as it's read: [context, keys, action, label, flags]. */
type Row = readonly [KeyContext, readonly string[], string, string, string];

export const BINDINGS = [
  // global
  ["global", ["?", "x"], "keys", "Keybindings menu", "bar"],
  ["global", ["q", "ctrl-c"], "quit", "Close the window", ""],
  ["global", ["escape"], "back", "Cancel / back", ""],
  ["global", ["1"], "panel:status", "Status panel", "hidden"],
  ["global", ["2"], "panel:files", "Files panel", "hidden"],
  ["global", ["3"], "panel:branches", "Branches panel", "hidden"],
  ["global", ["4"], "panel:commits", "Commits panel", "hidden"],
  ["global", ["5"], "panel:stash", "Stash panel", "hidden"],
  ["global", ["0"], "focus-main", "Focus main view", ""],
  ["global", ["h", "left"], "panel-prev", "Previous panel", ""],
  ["global", ["l", "right"], "panel-next", "Next panel", ""],
  ["global", ["tab"], "panel-next", "Next panel", "hidden"],
  ["global", ["shift-tab"], "panel-prev", "Previous panel", "hidden"],
  ["global", ["pageup", "K", "ctrl-u"], "main-up", "Scroll main view up", ""],
  ["global", ["pagedown", "J", "ctrl-d"], "main-down", "Scroll main view down", ""],
  ["global", ["P"], "push", "Push", "bar"],
  ["global", ["p"], "pull", "Pull", "bar"],
  ["global", ["R"], "refresh", "Refresh", ""],
  ["global", ["m"], "merge-rebase-menu", "Merge / rebase options", ""],
  ["global", [":"], "shell", "Run a shell command", ""],
  ["global", ["@"], "log-menu", "Command log options", ""],
  ["global", ["ctrl-r"], "recent-repos", "Switch to a recent repo", ""],
  ["global", ["z"], "undo", "Undo (reflog)", "danger"],
  ["global", ["Z"], "redo", "Redo (reflog)", "danger"],
  ["global", ["W", "ctrl-e"], "diff-menu", "Diffing options", ""],
  ["global", ["+"], "screen-next", "Next screen mode (normal / half / full)", ""],
  ["global", ["_"], "screen-prev", "Previous screen mode", ""],
  ["global", ["}"], "context-more", "More diff context", ""],
  ["global", ["{"], "context-less", "Less diff context", ""],
  ["global", ["ctrl-w"], "whitespace", "Toggle whitespace in diffs", ""],
  // Not lazygit's: its ctrl-p (custom patch options) isn't built here.
  ["global", ["ctrl-p"], "open-pane", "Open the main view as a pane beside", ""],
  ["global", ["ctrl-shift-p"], "open-pane-tab", "Open the main view in a new tab", ""],

  // every list
  ["list", ["j", "down"], "down", "Next item", ""],
  ["list", ["k", "up"], "up", "Previous item", ""],
  ["list", [","], "page-up", "Previous page", ""],
  ["list", ["."], "page-down", "Next page", ""],
  ["list", ["<", "home"], "top", "Scroll to top", ""],
  ["list", [">", "end"], "bottom", "Scroll to bottom", ""],
  ["list", ["/"], "filter", "Filter", ""],
  ["list", ["]"], "tab-next", "Next tab", ""],
  ["list", ["["], "tab-prev", "Previous tab", ""],
  ["list", ["v"], "range", "Toggle range select", ""],
  ["list", ["shift-down"], "range-down", "Range select down", "hidden"],
  ["list", ["shift-up"], "range-up", "Range select up", "hidden"],

  // status
  ["status", ["enter"], "recent-repos", "Switch to a recent repo", "bar menu"],
  ["status", ["a"], "all-branches-log", "Show all branch logs", "bar menu"],
  ["status", ["e"], "edit-config", "Edit .git/config", "menu"],

  // files
  ["files", ["space"], "stage", "Stage / unstage", "bar menu"],
  ["files", ["a"], "stage-all", "Stage / unstage all", "bar menu"],
  ["files", ["enter"], "stage-lines", "Stage lines / toggle directory", "bar menu"],
  ["files", ["c"], "commit", "Commit", "bar menu"],
  ["files", ["w"], "commit-no-verify", "Commit without hooks", "menu"],
  ["files", ["A"], "amend", "Amend last commit", "bar menu danger"],
  ["files", ["C"], "commit-editor", "Commit with the git editor", "menu"],
  ["files", ["d"], "discard-menu", "Discard…", "bar menu"],
  ["files", ["D"], "reset-menu", "Reset working tree…", "menu"],
  ["files", ["s"], "stash", "Stash all changes", "bar menu"],
  ["files", ["S"], "stash-menu", "Stash options…", "menu"],
  ["files", ["e"], "edit", "Edit file", "menu"],
  ["files", ["o"], "open", "Open file", "menu"],
  ["files", ["i"], "ignore-menu", "Ignore or exclude…", "menu"],
  ["files", ["r"], "refresh", "Refresh files", ""],
  ["files", ["f"], "fetch", "Fetch", "menu"],
  ["files", ["`"], "tree", "Toggle file tree", "bar menu"],
  ["files", ["-"], "collapse-all", "Collapse all", ""],
  ["files", ["="], "expand-all", "Expand all", ""],
  ["files", ["ctrl-o"], "copy-path", "Copy path", "menu"],
  ["files", ["ctrl-b"], "status-filter", "Filter by status…", "menu"],
  ["files", ["M"], "conflict-menu", "Merge conflict options…", ""],
  ["files", ["g"], "upstream-reset-menu", "Upstream reset options…", ""],

  // review: diff's mode, the Files panel's Review tab
  ["review", ["space"], "review-mark", "Mark reviewed, go to the next unreviewed", "bar menu"],
  ["review", ["a"], "review-all", "Every file reviewed (again: none)", "bar menu"],
  ["review", ["s"], "review-scope", "Scope: uncommitted / branch / PR", "bar menu"],
  ["review", ["ctrl-b"], "review-hide", "Hide tests / config / assets / docs…", "bar menu"],
  ["review", ["enter"], "review-open", "The file's diff", "bar menu"],
  ["review", ["e"], "edit", "Edit file", "menu"],
  ["review", ["o"], "open", "Open file", "menu"],
  ["review", ["ctrl-o"], "copy-path", "Copy path", "menu"],
  ["review", ["r"], "refresh", "Refresh", ""],

  // worktrees
  ["worktrees", ["space"], "worktree-switch", "Switch to it (its space, or a new one)", "bar menu"],
  ["worktrees", ["enter"], "worktree-here", "Look at it here (this window on it)", "bar menu"],
  ["worktrees", ["n"], "worktree-new", "New worktree…", "bar menu"],
  ["worktrees", ["d"], "worktree-remove", "Remove…", "bar menu danger"],
  ["worktrees", ["o"], "worktree-open-menu", "Open in…", "bar menu"],
  ["worktrees", ["R"], "worktree-rename", "Rename its branch", "menu"],
  ["worktrees", ["ctrl-o"], "worktree-copy-path", "Copy path", "menu"],
  ["worktrees", ["M"], "worktree-pick-merged", "Pick the merged ones", "menu"],
  ["worktrees", ["U"], "worktree-pick-unused", "Pick the unused ones (no space, no agent)", "menu"],
  ["worktrees", ["A"], "worktree-pick-all", "Pick all / none", "menu"],
  ["worktrees", ["X"], "worktree-prune", "Prune stale ones (folder gone)", "menu"],

  // local branches
  ["branches", ["space"], "checkout", "Checkout", "bar menu"],
  ["branches", ["n"], "branch-new", "New branch", "bar menu"],
  ["branches", ["N"], "move-commits-new-branch", "Move commits to a new branch", "menu"],
  ["branches", ["c"], "checkout-by-name", "Checkout by name", "menu"],
  ["branches", ["-"], "checkout-previous", "Checkout previous branch", "menu"],
  ["branches", ["F"], "force-checkout", "Force checkout", "menu danger"],
  ["branches", ["d"], "branch-delete-menu", "Delete…", "bar menu"],
  ["branches", ["r"], "rebase-onto", "Rebase onto this branch", "bar menu danger"],
  ["branches", ["M"], "merge-menu", "Merge into current…", "bar menu"],
  ["branches", ["f"], "fast-forward", "Fast-forward from upstream", "menu"],
  ["branches", ["T"], "tag-new", "New tag", "menu"],
  ["branches", ["g"], "reset-menu-ref", "Reset to this…", "menu"],
  ["branches", ["R"], "branch-rename", "Rename", "bar menu"],
  ["branches", ["u"], "upstream-menu", "Upstream options…", "menu"],
  ["branches", ["s"], "sort-menu", "Sort order…", "menu"],
  ["branches", ["o"], "pr-create", "Create pull request", "menu"],
  ["branches", ["O"], "pr-create-github", "Create pull request in the GitHub window", "menu"],
  ["branches", ["G"], "pr-open", "Open pull request in browser", "menu"],
  ["branches", ["w"], "worktree-of", "New worktree for this branch", "menu"],
  ["branches", ["ctrl-o"], "copy-name", "Copy name", "menu"],
  ["branches", ["enter"], "view-commits", "View commits", "bar menu"],

  // remotes
  ["remotes", ["enter"], "view-remote-branches", "View branches", "bar menu"],
  ["remotes", ["f"], "fetch-remote", "Fetch", "bar menu"],
  ["remotes", ["n"], "remote-new", "New remote", "bar menu"],
  ["remotes", ["e"], "remote-edit", "Edit name / url", "menu"],
  ["remotes", ["d"], "remote-remove", "Remove", "menu danger"],

  // a remote's branches (enter on a remote)
  ["remoteBranches", ["space"], "checkout-remote", "Checkout (new local branch)", "bar menu"],
  ["remoteBranches", ["n"], "branch-new", "New branch from it", "menu"],
  ["remoteBranches", ["M"], "merge-menu", "Merge into current…", "bar menu"],
  ["remoteBranches", ["r"], "rebase-onto", "Rebase onto it", "bar menu danger"],
  ["remoteBranches", ["d"], "remote-branch-delete", "Delete on the remote", "menu danger"],
  ["remoteBranches", ["u"], "set-upstream", "Set as upstream", "menu"],
  ["remoteBranches", ["g"], "reset-menu-ref", "Reset to this…", "menu"],
  ["remoteBranches", ["ctrl-o"], "copy-name", "Copy name", "menu"],
  ["remoteBranches", ["w"], "worktree-of", "New worktree for it (a local branch)", "menu"],
  ["remoteBranches", ["enter"], "view-commits", "View commits", "bar menu"],

  // tags
  ["tags", ["space"], "checkout", "Checkout (detached)", "bar menu"],
  ["tags", ["n"], "tag-new", "New tag", "bar menu"],
  ["tags", ["d"], "tag-delete-menu", "Delete…", "bar menu"],
  ["tags", ["P"], "tag-push", "Push tag", "bar menu"],
  ["tags", ["g"], "reset-menu-ref", "Reset to this…", "menu"],
  ["tags", ["ctrl-o"], "copy-name", "Copy name", "menu"],
  ["tags", ["w"], "worktree-of", "New worktree from this tag", "menu"],
  ["tags", ["enter"], "view-commits", "View commits", "bar menu"],

  // commits
  ["commits", ["enter"], "view-files", "View files", "bar menu"],
  ["commits", ["space"], "checkout-commit", "Checkout (detached)", "menu"],
  ["commits", ["n"], "branch-new", "New branch off this commit", "menu"],
  ["commits", ["r"], "reword", "Reword", "bar menu"],
  ["commits", ["R"], "reword-editor", "Reword with editor", "menu"],
  ["commits", ["s"], "squash", "Squash into the commit below", "bar menu danger"],
  ["commits", ["f"], "fixup", "Fixup into the commit below", "bar menu danger"],
  ["commits", ["F"], "fixup-commit", "Create fixup! commit for this", "menu"],
  ["commits", ["S"], "autosquash", "Apply fixup commits", "menu danger"],
  ["commits", ["d"], "drop", "Drop", "bar menu danger"],
  ["commits", ["e"], "edit-commit", "Edit (start interactive rebase)", "bar menu"],
  ["commits", ["i"], "rebase-interactive", "Interactive rebase of the branch", "menu"],
  ["commits", ["p"], "pick", "Pick (mid-rebase)", "menu"],
  ["commits", ["ctrl-j", "alt-down"], "move-down", "Move down", "bar menu"],
  ["commits", ["ctrl-k", "alt-up"], "move-up", "Move up", "menu"],
  ["commits", ["A"], "amend-commit", "Amend with staged changes", "menu danger"],
  ["commits", ["t"], "revert", "Revert", "menu danger"],
  ["commits", ["T"], "tag-new", "Tag this commit", "menu"],
  ["commits", ["C"], "cherry-copy", "Copy (cherry-pick)", "bar menu"],
  ["commits", ["V"], "cherry-paste", "Paste (cherry-pick)", "menu"],
  ["commits", ["c"], "cherry-legacy", "Copy (older lazygit key; v is range select now)", "hidden"],
  ["commits", ["g"], "reset-menu-ref", "Reset to this…", "bar menu"],
  ["commits", ["ctrl-r"], "cherry-reset", "Forget copied commits", ""],
  ["commits", ["ctrl-o"], "copy-hash", "Copy hash", "menu"],
  ["commits", ["y"], "copy-menu", "Copy attribute…", "menu"],
  ["commits", ["o"], "open-commit-browser", "Open in browser", "menu"],
  ["commits", ["w"], "worktree-of", "New worktree from this commit", "menu"],
  ["commits", ["*"], "select-branch-commits", "Select this branch's commits", ""],
  ["commits", ["ctrl-l"], "log-options", "Log options…", "menu"],

  // reflog
  ["reflog", ["space"], "checkout-commit", "Checkout (detached)", "bar menu"],
  ["reflog", ["n"], "branch-new", "New branch off this commit", "menu"],
  ["reflog", ["g"], "reset-menu-ref", "Reset to this…", "bar menu"],
  ["reflog", ["C"], "cherry-copy", "Copy (cherry-pick)", "menu"],
  ["reflog", ["ctrl-o"], "copy-hash", "Copy hash", "menu"],
  ["reflog", ["enter"], "view-files", "View files", "bar menu"],

  // a branch's or tag's commits (enter on it)
  ["subCommits", ["space"], "checkout-commit", "Checkout (detached)", "bar menu"],
  ["subCommits", ["n"], "branch-new", "New branch off this commit", "menu"],
  ["subCommits", ["g"], "reset-menu-ref", "Reset to this…", "menu"],
  ["subCommits", ["C"], "cherry-copy", "Copy (cherry-pick)", "menu"],
  ["subCommits", ["ctrl-o"], "copy-hash", "Copy hash", "menu"],
  ["subCommits", ["enter"], "view-files", "View files", "bar menu"],

  // a commit's (or stash entry's) files
  ["commitFiles", ["enter"], "focus-main", "Focus the file's diff", "bar menu"],
  ["commitFiles", ["c"], "checkout-file", "Checkout this version", "menu danger"],
  ["commitFiles", ["e"], "edit", "Edit file", "menu"],
  ["commitFiles", ["o"], "open", "Open file", "menu"],
  ["commitFiles", ["ctrl-o"], "copy-path", "Copy path", "menu"],
  ["commitFiles", ["`"], "tree", "Toggle file tree", "bar"],

  // stash
  ["stash", ["space"], "stash-apply", "Apply", "bar menu"],
  ["stash", ["g"], "stash-pop", "Pop", "bar menu"],
  ["stash", ["d"], "stash-drop", "Drop", "bar menu danger"],
  ["stash", ["n"], "stash-branch", "New branch from it", "menu"],
  ["stash", ["r"], "stash-rename", "Rename", "menu"],
  ["stash", ["enter"], "view-files", "View files", "bar menu"],

  // the main view, staging lines (enter on a file)
  ["staging", ["j", "down"], "line-down", "Next line", ""],
  ["staging", ["k", "up"], "line-up", "Previous line", ""],
  ["staging", ["h", "left"], "hunk-prev", "Previous hunk", ""],
  ["staging", ["l", "right"], "hunk-next", "Next hunk", ""],
  ["staging", ["space"], "stage-pick", "Stage / unstage the selection", "bar menu"],
  ["staging", ["a"], "hunk-mode", "Toggle hunk / line selection", "bar menu"],
  ["staging", ["v"], "range", "Toggle range select", "bar menu"],
  ["staging", ["tab"], "switch-side", "Switch to the staged / unstaged side", "bar menu"],
  ["staging", ["d"], "discard-pick", "Discard (unstaged) / unstage (staged)", "bar menu danger"],
  ["staging", ["e"], "edit", "Edit file", "menu"],
  ["staging", ["c"], "commit", "Commit", "bar menu"],
  ["staging", ["ctrl-o"], "copy-lines", "Copy selected lines", "menu"],
  ["staging", ["n"], "file-next", "Next file", ""],
  ["staging", ["N"], "file-prev", "Previous file", ""],
  ["staging", ["escape"], "back", "Back to the files", "bar"],

  // the main view, read only (0 or enter on a commit file)
  ["main", ["j", "down"], "line-down", "Scroll down", ""],
  ["main", ["k", "up"], "line-up", "Scroll up", ""],
  ["main", ["n"], "file-next", "Next file", ""],
  ["main", ["N"], "file-prev", "Previous file", ""],
  ["main", ["escape"], "back", "Back to the side panel", "bar"],

  // popups
  ["menu", ["enter"], "menu-run", "Run", "bar"],
  ["menu", ["escape"], "back", "Close", "bar"],
  ["confirm", ["enter", "y"], "confirm-yes", "Confirm", "bar"],
  ["confirm", ["escape", "n"], "back", "Cancel", "bar"],
  ["prompt", ["enter"], "prompt-ok", "Confirm", "bar"],
  ["prompt", ["escape"], "back", "Cancel", "bar"],
  ["commit", ["enter"], "commit-ok", "Commit", "bar"],
  ["commit", ["tab"], "commit-switch", "Summary / description", "bar"],
  ["commit", ["escape"], "back", "Close (keeps the draft)", "bar"],
] as const satisfies readonly Row[];

/** Everything a key can do: the table's action names ("panel:files" names its panel). */
export type Action = (typeof BINDINGS)[number][2];

/** A binding's flags (see the top). */
export type Flag = "bar" | "menu" | "danger" | "hidden";

const isFlag = literal("bar", "menu", "danger", "hidden");

/** One binding of the table: `key` the first of its keys (the one shown). */
export interface Binding {
  readonly context: KeyContext;
  readonly keys: readonly string[];
  readonly key: string;
  readonly action: Action;
  readonly label: string;
  readonly flags: ReadonlySet<Flag>;
}

/** The table, each row's keys and flags read as plain strings. */
const TABLE: readonly (readonly [KeyContext, readonly string[], Action, string, string])[] = BINDINGS;

/** Review's keys that mean something else on the Files tab, and why. */
export const REVIEW_CLASHES: readonly (readonly [key: string, review: string, files: string])[] = [
  ["space", "mark reviewed + next", "stage"],
  ["a", "all reviewed", "stage all"],
  ["s", "next scope", "stash"],
  ["ctrl-b", "hide tests/config/assets/docs", "filter by status"],
  ["enter", "the file's diff (read only)", "stage lines"],
];

/** The contexts that are lists (j/k, paging, filter apply): each panel's tabs and drill-ins. */
export type ListContext = "status" | "files" | "review" | "worktrees" | "branches" | "remotes" | "remoteBranches" | "tags" | "commits" | "reflog" | "subCommits" | "commitFiles" | "stash";

/** Whether a context is a list. */
export const isListContext = literal("status", "files", "review", "worktrees", "branches", "remotes", "remoteBranches", "tags", "commits", "reflog", "subCommits", "commitFiles", "stash");

/** Contexts that are lists (j/k, paging, filter apply). */
export const LISTS: ReadonlySet<KeyContext> = new Set<KeyContext>(["status", "files", "review", "worktrees", "branches", "remotes", "remoteBranches", "tags", "commits", "reflog", "subCommits", "commitFiles", "stash"]);

/** The binding a key does in a context: the context's own first, then the
 *  list keys (for a list), then the global ones. */
export function lookup(context: KeyContext, key: string): Binding | null {
  const order: KeyContext[] = [context, ...(LISTS.has(context) ? ["list" as const] : []), ...(isPopup(context) ? [] : ["global" as const])];

  for (const c of order) {
    const b = TABLE.find(([ctx, keys]) => ctx === c && keys.includes(key));

    if (b) return toBinding(b);
  }

  return null;
}

export const isPopup = (c: KeyContext) => c === "menu" || c === "confirm" || c === "prompt" || c === "commit";

const toBinding = ([context, keys, action, label, flags]: (typeof TABLE)[number]): Binding => ({
  context, keys, key: keys[0] ?? "", action, label, flags: new Set(flags.split(" ").filter(isFlag)),
});

/** A context's own bindings (no list / global ones), in table order. */
export function bindings(context: KeyContext): Binding[] {
  return TABLE.flatMap((b) => (b[0] === context ? [toBinding(b)] : []));
}

/** The options bar: the context's "bar" keys, then a few global ones. */
export function barKeys(context: KeyContext): Binding[] {
  const own = bindings(context).filter((b) => b.flags.has("bar"));

  if (isPopup(context)) return own;

  return [...own, ...bindings("global").filter((b) => b.flags.has("bar"))];
}

/** The right-click menu of a row: its context's "menu" bindings. */
export function menuKeys(context: KeyContext): Binding[] {
  return bindings(context).filter((b) => b.flags.has("menu"));
}

/** What keyName reads of a key event. */
export type KeyPress = Pick<KeyEvent, "key" | "key_char" | "modifiers">;

/** A key event's name as the table writes it: "j", "G", "?", "space",
 *  "enter", "ctrl-j", "alt-up", "shift-down". Null for keys the window
 *  leaves to the app (cmd-…). */
export function keyName(e: KeyPress) {
  const m = e.modifiers;

  if (m.platform || m.function) return null;

  const k = e.key.toLowerCase();

  if (m.control) return m.shift ? `ctrl-shift-${k}` : `ctrl-${k}`;

  if (m.alt) return k === "up" || k === "down" ? `alt-${k}` : null;

  const c = e.key_char;

  if (c && c.length === 1 && c.trim()) return c;

  if (m.shift && (k === "up" || k === "down" || k === "tab")) return `shift-${k}`;

  return k;
}

/** A key as the bar and menus write it. */
export function keyLabel(k: string) {
  switch (k) {
    case "escape": return "esc";
    case "pageup": return "pgup";
    case "pagedown": return "pgdn";
    default: return k;
  }
}
