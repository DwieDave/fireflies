// The scratchpad (nocturne.scratchpad: the palette, the "+ new" menu's tile, a
// key; nocturne.scratchpad-tab: in a tab of its own): the shown space's
// repository's note, in the editor beside the focused pane (or the editor
// already open on it there). The note lives under the app's folder, one per
// repository and shared by its worktrees (scratch.js); the editor knows it by
// its path and saves it as it's typed.
//
// Finding the note awaits git, so it runs in sky.js's command loop (the
// sidebar, alive as long as the layout): the palette and the "+ new" menu
// close their own overlay on a pick, and a promise whose copy is gone never
// settles (gpui-kit's scheduler leaves it pending). They run the command
// (askScratchpad), never openScratchpad themselves. Whatever goes wrong says
// so in a toast.

// Read off the module when used: test stand-ins for herdr needn't know them all.
import * as herdr from "herdr";
import { here } from "./panels.js";
import { locate } from "./scratch.js";

/** The folder whose repository the note is for: the focused pane's, else the space's, else home. */
export function scratchFolder(h = here()) {
  return h.folder ?? h.space?.folder ?? herdr.home();
}

/** From a copy that may go away (a menu, the palette): the long-lived one opens it. */
export function askScratchpad(inTab = false) {
  herdr.run(inTab ? "nocturne.scratchpad-tab" : "nocturne.scratchpad");
}

const fail = (title, body) => {
  try { herdr.notify({ title, body: String(body ?? ""), level: "error" }); } catch { /* nowhere to say it */ }
};

/** Opens the note (`inTab`: in a tab of its own): -> its path, null when it
 *  couldn't (a toast says why). */
export async function openScratchpad(inTab = false) {
  let h, note;
  try {
    h = here();
    // git failing isn't the end: the folder gets a note of its own (scratch.js owner); a toast says so.
    let gitError = null;
    const exec = (...a) => herdr.exec(...a).catch((e) => { gitError = e; throw e; });
    note = await locate({ exec, appHome: herdr.appHome(), readTextFile: herdr.readTextFile, writeTextFile: herdr.writeTextFile }, scratchFolder(h), h.on);
    if (gitError) {
      try { herdr.notify({ title: "scratchpad: git didn't answer", body: `this folder's own note opened (${String(gitError?.message ?? gitError)})`, level: "warning" }); } catch { /* a nicety */ }
    }
  } catch (e) {
    fail("couldn't find the scratchpad", e?.message ?? e);
    return null;
  }
  try {
    // A refusal (no pane to split, no editor mod) comes back as the app's own toast.
    // The note is this machine's (under its app folder), whatever machine the space is on.
    herdr.run("editor.open", { path: note.path, ...(inTab ? { in: "tab" } : h.pane ? { pane: h.pane } : {}) });
  } catch (e) {
    fail("couldn't open the scratchpad", e?.message ?? e);
    return null;
  }
  return note.path;
}
