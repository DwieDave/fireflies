// The file picker and grep (the nocturne-picker mod): cmd-p (nocturne.picker)
// and cmd-shift-f (nocturne.grep) open it over the window, searching the
// space's folder (else the focused pane's). The same key again closes it; the
// other one switches the open picker to its mode in place, the query kept.

import { spaces, panes, focused, openOverlay, closeOverlay, shared, setShared, run } from "herdr";

const KEY = "nocturne.picker-open";

/** The folder to search: the space's attached folder, else the focused pane's. */
export function pickerFolder() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return { folder: (space?.attached && space.folder) || pane?.cwd || f?.cwd || space?.folder || null, on: space?.machine ?? null };
}

/** Opens the picker in `mode` ("files" | "grep"); closes it when it's open
 *  in that mode, switches it when it's open in the other. Most of the window
 *  (a share of it): the list beside a preview that fills its height. */
export function togglePicker(mode) {
  const open = shared(KEY);
  if (open?.id) {
    if (open.mode !== mode) {
      // The picker hears it on nextCommand() and keeps the note's mode current.
      run(`nocturne-picker.${mode}`);
      setShared(KEY, { ...open, mode });
      return;
    }
    closeOverlay(open.id);
    setShared(KEY, null);
    return;
  }
  const { folder, on } = pickerFolder();
  const id = openOverlay({ mod: "nocturne-picker", kind: "dialog", frame: "none", width: 0.92, height: 0.88,
    props: { mode, folder, on } });
  setShared(KEY, { id, mode });
}
