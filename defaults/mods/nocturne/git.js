// The git window (git): lazygit in Nocturne's look and the review
// of a repo's changes, floating over the tab like the GitHub window. Toggled
// by cmd-g (nocturne.git; nocturne.lazygit, its old name, does the same),
// the tab strip's git button, "+ new" > Git and the palette; opened on its
// Worktrees tab by everything that made, opened or removed worktrees. The window says
// it's open in shared(WINDOW) and renews that every few seconds, so a stale
// note (an app restart) doesn't swallow a press.

import { openOverlay, closeOverlay, shared, setShared, spaces, panes } from "herdr";
import { here } from "./panels.js";
import { spaceFolder } from "./kit.js";

const WINDOW = "git.window";
const FRESH = 10000;

/** The open git window's overlay id, or null. */
export function gitOpen() {
  const w = shared(WINDOW);
  return w?.id && Date.now() - (w.beat ?? 0) < FRESH ? w.id : null;
}

/** Opens the git window over the tab, or closes it. review: on the Files
 *  panel's Review tab (what the Diff entry opened before); worktrees: on
 *  the Worktrees tab (see openWorktrees). */
export function toggleGit({ review = false, worktrees = null } = {}) {
  const open = gitOpen();
  if (open) { closeOverlay(open); setShared(WINDOW, null); return; }
  const h = here();
  const folder = (h.space?.attached && h.space.folder) || h.folder;
  openGitWindow({ folder, on: h.on, ...(review ? { review: true } : {}), ...(worktrees ? { worktrees } : {}) });
}

function openGitWindow(props) {
  const id = openOverlay({ mod: "git", kind: "window", key: "git", frame: "none", scrim: true, width: 0.88, height: 0.88, resizable: { min: [420, 300] }, props });
  setShared(WINDOW, { id, beat: Date.now(), folder: props.folder });
}

/** The git window on its Worktrees tab (what the worktree dialog and the
 *  worktrees pane were), for a space (default: the shown one): `action`
 *  "new" asks for a branch (or makes `branch` at once, opening it with
 *  `tab` / `argv`), "remove" removes the space's worktree (it asks),
 *  "open" lists them. An open window gives way to it. */
export function openWorktrees({ space = null, action = "open", branch, tab, argv } = {}) {
  const open = gitOpen();
  if (open) { closeOverlay(open); setShared(WINDOW, null); }
  const h = here();
  const s = space ? spaces().find((x) => x.id === space) : h.space;
  const folder = s ? spaceFolder(s, panes()) : h.folder;
  const worktrees = { action, ...(s ? { space: s.id } : {}), ...(branch ? { branch } : {}), ...(tab ? { tab } : {}), ...(argv ? { argv } : {}) };
  openGitWindow({ folder, on: s ? s.machine ?? null : h.on, worktrees });
}
