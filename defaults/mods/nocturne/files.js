// The files pane (the nocturne-files mod): a narrow column along the tab's
// whole right edge, rooted at the focused pane's folder on its machine; files
// open in panes to its left (nocturne-files). "+ new" > Files (f) and cmd-e (nocturne.files)
// toggle it.

import { spaces, panes, focused, run } from "herdr";

const MOD = "nocturne-files";
const WIDTH = 280;

/** The files pane in the shown tab, if any. */
export function filesPane() {
  const tab = spaces().find((s) => s.active)?.tabs.find((c) => c.active)?.id;
  return panes().find((p) => p.mod === MOD && p.tab === tab) ?? null;
}

/** Opens the files pane at the focused pane's folder; closes it when it's there. */
export function toggleFiles() {
  const open = filesPane();
  if (open) return run("pane.close", { pane: open.pane });
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const folder = pane?.cwd || f?.cwd || space?.folder || null;
  run("pane.split", { edge: "right", px: WIDTH, mod: MOD, props: { folder, on: space?.machine ?? null } });
}
