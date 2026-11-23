// The commands sent to the git window (keys.json's git.<action>, the toggle's
// focus, nocturne's refresh): read one after another for as long as the copy
// is open, each acted on by the one copy it's for (place.ts).

import { Effect, String as Str } from "effect";
import type { FocusHandle } from "gpui-kit";
import { Commands } from "@fireflies/kit";
import { act } from "./actions.ts";
import { reload } from "./reads.ts";
import { actsOnCommands, toPane, toWindow } from "./place.ts";
import type { GitServices } from "./fx.ts";
import type { default as GitView } from "./main.ts";

/** The commands, one after another, for as long as the copy is open. */
export function listen(v: GitView, handle: FocusHandle): Effect.Effect<never, never, GitServices> {
  return Effect.forever(Effect.flatMap(Commands.use((c) => c.next), (c) => Effect.sync(() => command(v, Str.replace(/^git\./, "")(c), handle))));
}

/** One command: what it does in this copy. */
export function command(v: GitView, c: string, handle: FocusHandle): void {
  const cx = v.acx;

  if (c === "focus") handle.focus();
  else if (c === "refresh") reload(v, true);
  else if (c === "review") {
    v.setPanel("files");
    v.setTab("review");
  }
  // keys.json can bind any key table action: git.<action>
  // (panel-commits for panel:commits).
  // One copy acts: the window while one is open, else the pane with the keyboard (place.ts).
  else if (!actsOnCommands(v) || cx === null) { /* another copy's */ }
  else if (c === "to-pane") toPane(v);
  else if (c === "to-window") toWindow(v);
  else if (v.popups.open) {
    if (c === "back") v.popups.close();
    else if (c === "menu-run" || c === "confirm-yes" || c === "prompt-ok" || c === "commit-ok") v.popups.ok(cx);
  } else if (v.state === "ready") act(v, Str.replace(/^panel-/, "panel:")(c), cx);

  cx?.notify();
}
