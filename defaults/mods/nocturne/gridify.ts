// Gridify (nocturne.gridify; the palette, cmd-alt-g, the pane header's grid
// button and the even-out popup's "Grid"): every placed pane of the shown
// tab, in its order (panes(): splits left to right, top to bottom), into an
// even grid (grid.js), then even shares (pane.equalize all). Terminals and
// mods keep running; parked panes stay parked; focus stays where it was.
// The sky runs it (sky.js), since a pane's own header goes and comes back
// as its pane moves.

import { panes, spaces, run } from "herdr";
import type { AsyncContext } from "gpui-kit";
import { gridMoves } from "./grid.ts";

const HOLD = "⧉ gridify";
const STEP = 25; // ms between looks while a move lands
const PATIENCE = 2000; // ms a move gets to land

/** Waits until `ok()` holds (or PATIENCE runs out); says which. */
async function until(cx: AsyncContext, ok: () => boolean): Promise<boolean> {
  for (let waited = 0; waited < PATIENCE; waited += STEP) {
    if (ok()) return true;
    await cx.sleep(STEP);
  }

  return ok();
}

let busy = false;

/** Gridifies the shown tab (or `tab`), `columns` wide (default: about square). */
export async function gridify(cx: AsyncContext, { tab = null, columns = null }: { readonly tab?: string | null; readonly columns?: number | null } = {}): Promise<void> {
  if (busy) return;
  const space = spaces().find((s) => (tab ? s.tabs.some((c) => c.id === tab) : s.active));
  const home = tab ?? space?.tabs.find((c) => c.active)?.id;

  if (!space || !home) return;
  const placed = panes().filter((p) => p.tab === home && !p.parked);
  const order = placed.map((p) => p.pane);
  const moves = gridMoves(order, columns);

  if (!moves.length) return;
  const focused = placed.find((p) => p.focused)?.pane ?? order[0];
  const zoomed = placed.find((p) => p.zoomed);

  if (zoomed) run("pane.zoom", { pane: zoomed.pane });

  busy = true;

  try {
    let hold: string | null = null;

    for (const m of moves) {
      if ("out" in m) {
        run("pane.move", hold ? { pane: m.pane, tab: hold } : { pane: m.pane, name: HOLD, space: space.id });
        await until(cx, () => {
          const p = panes().find((x) => x.pane === m.pane);

          return Boolean(p) && p?.tab !== home;
        });
        hold ??= panes().find((x) => x.pane === m.pane)?.tab ?? null;

        if (!hold) return;
      } else {
        run("pane.move", { pane: m.pane, target: m.target, edge: m.edge });

        if (!await until(cx, () => panes().find((x) => x.pane === m.pane)?.tab === home)) return;
      }
    }

    run("pane.equalize", { scope: "all", pane: focused });
    run("pane.focus", { pane: focused });
  } finally {
    busy = false;
  }
}
