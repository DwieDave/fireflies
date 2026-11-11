// The git window (nocturne-git): lazygit in Nocturne's look and the review
// of a repo's changes, floating over the tab like the GitHub window. Toggled
// by cmd-g (nocturne.git; nocturne.lazygit, its old name, does the same),
// the tab strip's git button, "+ new" > Git and the palette. The window says
// it's open in shared(WINDOW) and renews that every few seconds, so a stale
// note (an app restart) doesn't swallow a press.

import { openOverlay, closeOverlay, shared, setShared } from "herdr";
import { here } from "./panels.js";

const WINDOW = "nocturne-git.window";
const FRESH = 10000;

/** The open git window's overlay id, or null. */
export function gitOpen() {
  const w = shared(WINDOW);
  return w?.id && Date.now() - (w.beat ?? 0) < FRESH ? w.id : null;
}

/** Opens the git window over the tab, or closes it. review: on the Files
 *  panel's Review tab (what the Diff entry opened before). */
export function toggleGit({ review = false } = {}) {
  const open = gitOpen();
  if (open) { closeOverlay(open); setShared(WINDOW, null); return; }
  const h = here();
  const folder = (h.space?.attached && h.space.folder) || h.folder;
  const id = openOverlay({ mod: "nocturne-git", kind: "window", key: "nocturne-git", frame: "none", width: 0.88, height: 0.88, resizable: { min: [420, 300] },
    props: { folder, on: h.on, ...(review ? { review: true } : {}) } });
  setShared(WINDOW, { id, beat: Date.now(), folder });
}
