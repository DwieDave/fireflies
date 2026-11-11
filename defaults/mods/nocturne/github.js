// The GitHub window (nocturne-github): a floating window over the tab with
// the shown space's repo, toggled by cmd-shift-g (nocturne.github) and
// "+ new" > GitHub. The window says it's open in shared(WINDOW) and renews
// that every few seconds, so a stale note (an app restart) doesn't swallow a
// press.

import { openOverlay, closeOverlay, shared, setShared } from "herdr";
import { here } from "./panels.js";

const WINDOW = "nocturne-github.window";
const FRESH = 10000;

/** The open window's overlay id, or null. */
export function githubOpen() {
  const w = shared(WINDOW);
  return w?.id && Date.now() - (w.beat ?? 0) < FRESH ? w.id : null;
}

/** Opens the window over the tab, or closes it. */
export function toggleGithub() {
  const open = githubOpen();
  if (open) { closeOverlay(open); setShared(WINDOW, null); return; }
  const h = here();
  // A space attached to a folder shows that repo; otherwise the focused pane's.
  const folder = (h.space?.attached && h.space.folder) || h.folder;
  const id = openOverlay({ mod: "nocturne-github", kind: "window", key: "nocturne-github", frame: "none", scrim: true, width: 0.85, height: 0.85, resizable: { min: [520, 360] }, props: { folder, on: h.on } });
  setShared(WINDOW, { id, beat: Date.now() });
}
