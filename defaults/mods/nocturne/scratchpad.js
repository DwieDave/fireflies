// The scratchpad (nocturne.scratchpad: the palette, the "+ new" menu, a key):
// the shown space's repository's note, in the editor beside the focused pane
// (or the editor already open on it there). The note lives under the app's
// folder, one per repository and shared by its worktrees (scratch.js); the
// editor knows it by its path and saves it as it's typed.

// Read off the module when used: test stand-ins for herdr needn't know them all.
import * as herdr from "herdr";
import { here } from "./panels.js";
import { locate } from "./scratch.js";

/** The folder whose repository the note is for: the focused pane's, else the space's, else home. */
export function scratchFolder(h = here()) {
  return h.folder ?? h.space?.folder ?? herdr.home();
}

/** Opens the note: -> its path (null when it couldn't be found). */
export async function openScratchpad() {
  const h = here();
  let note;
  try { note = await locate({ exec: herdr.exec, appHome: herdr.appHome(), readTextFile: herdr.readTextFile, writeTextFile: herdr.writeTextFile }, scratchFolder(h), h.on); } catch { return null; }
  herdr.run("editor.open", { path: note.path, ...(h.pane ? { pane: h.pane } : {}) });
  return note.path;
}
