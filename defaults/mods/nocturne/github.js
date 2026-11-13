// The GitHub window (github): a floating window over the tab with
// the shown space's repo, toggled by cmd-shift-g (nocturne.github) and
// "+ new" > GitHub. The window says it's open in shared(WINDOW) and renews
// that every few seconds, so a stale note (an app restart) doesn't swallow a
// press.

import { openOverlay, closeOverlay, shared, setShared, run } from "herdr";
import { here } from "./panels.js";

const WINDOW = "github.window";
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
  openWindow({});
}

function openWindow(more) {
  const h = here();
  // A space attached to a folder shows that repo; otherwise the focused pane's.
  const folder = (h.space?.attached && h.space.folder) || h.folder;
  const id = openOverlay({ mod: "github", kind: "window", key: "github", frame: "none", scrim: true, width: 0.85, height: 0.85, resizable: { min: [520, 360] }, props: { folder, on: h.on, ...more } });
  setShared(WINDOW, { id, beat: Date.now() });
}

/** nocturne.github-pr / nocturne.github-run (the palette, keys.json, the git
 *  window's branches panel): the window on a new pull request or on running a
 *  workflow; an open window gets the form in place. The git window leaves its
 *  branch in shared("github.create") first. */
export function githubForm(what) {
  if (githubOpen()) run(what === "pr" ? "github.new-pr" : "github.run-workflow");
  else openWindow({ tab: what === "pr" ? "prs" : "actions", create: what, at: Date.now() });
}
