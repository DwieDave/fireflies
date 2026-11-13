// The file picker and grep (the finder mod): cmd-p (nocturne.picker)
// and cmd-shift-f (nocturne.grep) open it over the window, searching the
// space's folder (else the focused pane's). The same key again closes it; the
// other one switches the open picker to its mode in place, the query kept.

import { spaces, panes, focused, openOverlay, closeOverlay, shared, setShared, run } from "herdr";
import { folderCandidates } from "./folders.js";

const KEY = "nocturne.picker-open";

/** The folders to search, best first (folderCandidates): the picker searches
 *  the first one that's there, as one that was moved or deleted can still
 *  be a space's folder. `folder`: the first; `space`: the space's own, which
 *  the picker names when none is there. */
export function pickerFolder() {
  const space = spaces().find((s) => s.active), f = focused(), all = panes();
  const pane = f?.pane ? all.find((p) => p.pane === f.pane) : null;
  const folders = folderCandidates(space, pane, f, all);
  return { folder: folders[0] ?? null, folders, space: space?.folder || null, on: space?.machine ?? null };
}

/** Opens the picker in `mode` ("files" | "grep"); closes it when it's open
 *  in that mode, switches it when it's open in the other. Most of the window
 *  (a share of it): the list beside a preview that fills its height. */
export function togglePicker(mode) {
  const open = shared(KEY);
  if (open?.id) {
    if (open.mode !== mode) {
      // The picker hears it on nextCommand() and keeps the note's mode current.
      run(`finder.${mode}`);
      setShared(KEY, { ...open, mode });
      return;
    }
    closeOverlay(open.id);
    setShared(KEY, null);
    return;
  }
  const { folder, folders, space, on } = pickerFolder();
  const id = openOverlay({ mod: "finder", kind: "dialog", frame: "none", width: 0.92, height: 0.88,
    props: { mode, folder, folders, space, on } });
  setShared(KEY, { id, mode });
}
