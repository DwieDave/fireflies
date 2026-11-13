// The git window (git): lazygit in Nocturne's look and the review
// of a repo's changes, floating over the tab like the GitHub window. Toggled
// by cmd-g (nocturne.git; nocturne.lazygit, its old name, does the same),
// the tab strip's git button, "+ new" > Git and the palette; opened on its
// Worktrees tab by everything that made, opened or removed worktrees. The window says
// it's open in shared(WINDOW) and renews that every few seconds, so a stale
// note (an app restart) doesn't swallow a press.

import { openOverlay, closeOverlay, shared, setShared, spaces, panes } from "herdr";
import { isNumber, isString, nullable, object, readShared, sharedKey, writeShared } from "./guard.ts";
import { here } from "./panels.ts";
import { spaceFolder } from "./kit.ts";

/** The git window's note that it's open: its overlay, renewed every few seconds (the git mod writes it too). */
const WINDOW = sharedKey("git.window", nullable(object({ id: isString }, { beat: isNumber, folder: nullable(isString) })));
const FRESH = 10000;

/** The open git window's overlay id, or null. */
export function gitOpen(): string | null {
  const w = readShared(shared, WINDOW, null);

  return w?.id && Date.now() - (w.beat ?? 0) < FRESH ? w.id : null;
}

/** What the git window does on its Worktrees tab (the git mod reads it from its props): make a
 *  worktree (`branch` at once, opened with `tab` / `argv`), remove the space's, or list them. */
export type WorktreesAsk = { action: "new" | "remove" | "open"; space?: string; branch?: string; tab?: string; argv?: readonly string[] };

/** The git window's props. */
type GitProps = { folder: string | null; on: string | null; review?: true; worktrees?: WorktreesAsk };

/** How the git window opens (toggleGit). */
export interface GitOpening {
  readonly review?: boolean;
  readonly worktrees?: WorktreesAsk | null;
}

/** Opens the git window over the tab, or closes it. review: on the Files
 *  panel's Review tab (what the Diff entry opened before); worktrees: on
 *  the Worktrees tab (see openWorktrees). */
export function toggleGit({ review = false, worktrees = null }: GitOpening = {}): void {
  const open = gitOpen();

  if (open) {
    closeOverlay(open);
    writeShared(setShared, WINDOW, null);

    return;
  }

  const h = here();
  const props: GitProps = { folder: (h.space?.attached && h.space.folder) || h.folder, on: h.on };

  if (review) props.review = true;

  if (worktrees) props.worktrees = worktrees;

  openGitWindow(props);
}

function openGitWindow(props: GitProps): void {
  const id = openOverlay({ mod: "git", kind: "window", key: "git", frame: "none", scrim: true, width: 0.88, height: 0.88, resizable: { min: [420, 300] }, props });

  writeShared(setShared, WINDOW, { id, beat: Date.now(), folder: props.folder });
}

/** What openWorktrees is asked: for which space, and what to do. */
export interface WorktreesOpening {
  readonly space?: string | null;
  readonly action?: WorktreesAsk["action"];
  readonly branch?: string;
  readonly tab?: string;
  readonly argv?: readonly string[];
}

/** The git window on its Worktrees tab (what the worktree dialog and the
 *  worktrees pane were), for a space (default: the shown one): `action`
 *  "new" asks for a branch (or makes `branch` at once, opening it with
 *  `tab` / `argv`), "remove" removes the space's worktree (it asks),
 *  "open" lists them. An open window gives way to it. */
export function openWorktrees({ space = null, action = "open", branch, tab, argv }: WorktreesOpening = {}): void {
  const open = gitOpen();

  if (open) {
    closeOverlay(open);
    writeShared(setShared, WINDOW, null);
  }

  const h = here();
  const s = space ? spaces().find((x) => x.id === space) : h.space;
  const folder = s ? spaceFolder(s, panes()) : h.folder;
  const worktrees: WorktreesAsk = { action };

  if (s) worktrees.space = s.id;

  if (branch) worktrees.branch = branch;

  if (tab) worktrees.tab = tab;

  if (argv) worktrees.argv = argv;

  openGitWindow({ folder, on: s ? (s.machine ?? null) : h.on, worktrees });
}
