// The file picker and grep (the nocturne-picker mod): cmd-p (nocturne.picker)
// and cmd-shift-f (nocturne.grep) open it over the window, searching the
// space's folder (else the focused pane's); the same key again closes it.

import { spaces, panes, focused, openOverlay, closeOverlay, shared, setShared } from "herdr";

const KEY = "nocturne.picker-open";

/** The folder to search: the space's attached folder, else the focused pane's. */
export function pickerFolder() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return { folder: (space?.attached && space.folder) || pane?.cwd || f?.cwd || space?.folder || null, on: space?.machine ?? null };
}

/** Opens the picker in `mode` ("files" | "grep"); closes it when it's open. */
export function togglePicker(mode) {
  const open = shared(KEY);
  if (open?.id) {
    closeOverlay(open.id);
    setShared(KEY, null);
    if (open.mode === mode) return;
  }
  const { folder, on } = pickerFolder();
  const id = openOverlay({ mod: "nocturne-picker", kind: "dialog", frame: "none", width: 1040, height: 0.72, at: "top", offset: 60,
    props: { mode, folder, on } });
  setShared(KEY, { id, mode });
}
