// Even out panes (the equalize-panes popup): the pane header's ▦
// button and the pane menu's "Even out panes…" open it over a pane. The
// palette and keys run pane.equalize {scope} without it.

import { openOverlay } from "herdr";
import { keyedSpec } from "./kit.ts";

/** Opens the popup (at the pointer; from the strip's keys under the header's ▦: kit.ts
 *  keyedSpec) for a pane; without one, the focused pane. */
export function openEqualize(pane: string | null | undefined): void {
  openOverlay(keyedSpec({ mod: "equalize-panes", kind: "popup", frame: "none", width: 230, height: 160, props: pane ? { pane } : {} }));
}
