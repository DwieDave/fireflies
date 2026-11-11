// The files pane (the nocturne-files mod): a narrow column along the tab's
// whole right edge, rooted at the focused pane's folder on its machine; files
// open in panes to its left (nocturne-files). "+ new" > Files (f) and cmd-e (nocturne.files)
// toggle it. Folder links open files panes of their own (props.path,
// `files.open`): those aren't the panel, and stay when it toggles.
//
// cmd-e is the keyboard's way in and out (focusFiles): it opens the panel
// with the keyboard in it, moves the keyboard into an open one, and closes
// it once the keyboard is there, back to the pane it came from (FROM; esc
// in the panel goes back there too and leaves it open).

import { spaces, panes, focused, run, shared, setShared } from "herdr";

const MOD = "nocturne-files";
const WIDTH = 280;
/** The pane the keyboard came from into the panel (nocturne-files reads it on esc). */
export const FROM = "nocturne-files.from";

/** The files panel in the shown tab, if any (not a files pane of its own). */
export function filesPane() {
  const tab = spaces().find((s) => s.active)?.tabs.find((c) => c.active)?.id;
  return panes().find((p) => p.mod === MOD && p.tab === tab && !p.props?.path) ?? null;
}

/** A slot names a files pane, so it keeps its own filters. */
export const filesSlot = () => `files-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Opens the files pane at the focused pane's folder; closes it when it's there. */
export function toggleFiles() {
  const open = filesPane();
  if (open) return closeFiles(open);
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const folder = pane?.cwd || f?.cwd || space?.folder || null;
  run("pane.split", { edge: "right", px: WIDTH, mod: MOD, props: { folder, on: space?.machine ?? null, slot: filesSlot() } });
}

/** Closes the panel; the keyboard goes back to where it came from. */
function closeFiles(open) {
  const from = shared(FROM), had = focused()?.pane === open.pane;
  run("pane.close", { pane: open.pane });
  if (had && from && from !== open.pane && panes().some((p) => p.pane === from)) run("pane.focus", { pane: from });
}

/** cmd-e (nocturne.files): the panel with the keyboard in it (opening it if
 *  need be); pressed in the panel, closes it. */
export function focusFiles() {
  const open = filesPane(), here = focused()?.pane ?? null;
  if (open && here === open.pane) return closeFiles(open);
  setShared(FROM, here);
  if (!open) return toggleFiles(); // the new pane is focused and takes the keyboard itself
  run("pane.focus", { pane: open.pane });
  // pane.focus leaves the keys with the window; the panel takes them.
  run("nocturne-files.take-panel");
}
