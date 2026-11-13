// What each key table action (keys.ts) does: the real git CLI through
// git.ts, with lazygit's confirms for destructive ones, prompts and menus
// (popups.ts) for what needs an answer. `v` is the window (main.ts): it owns
// the data, the selection, the popups and the command log. The handlers sit
// in act-*.ts by what they act on (acting.ts has what they share); this file
// joins their tables and runs one.

import type { Context } from "gpui-kit";
import type { Action } from "./keys.ts";
import type { default as GitView } from "./main.ts";
import type { Handler } from "./acting.ts";
import { WINDOW_ACTIONS } from "./act-window.ts";
import { FILE_ACTIONS } from "./act-files.ts";
import { WORKTREE_ACTIONS } from "./act-worktrees.ts";
import { BRANCH_ACTIONS } from "./act-branches.ts";
import { COMMIT_ACTIONS } from "./act-commits.ts";

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

/** Every action of the key table, by its name. */
const ACTIONS = { ...WINDOW_ACTIONS, ...FILE_ACTIONS, ...WORKTREE_ACTIONS, ...BRANCH_ACTIONS, ...COMMIT_ACTIONS } satisfies { readonly [A in Action]?: Handler };
