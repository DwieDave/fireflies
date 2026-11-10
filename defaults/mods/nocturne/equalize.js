// Even out panes (the nocturne-equalize-panes popup): the pane header's ▦
// button and the pane menu's "Even out panes…" open it over a pane. The
// palette and keys run pane.equalize {scope} without it.

import { openOverlay } from "herdr";

/** Opens the popup (at the pointer) for a pane; without one, the focused pane. */
export function openEqualize(pane) {
  openOverlay({ mod: "nocturne-equalize-panes", kind: "popup", frame: "none", width: 230, height: 134, props: pane ? { pane } : {} });
}
