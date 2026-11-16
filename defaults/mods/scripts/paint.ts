// The script runner's colours: a run's tone. Its chrome (the fills, rules,
// heads, rows) is @fireflies/look's, drawn as the layout asks.

import type { Color } from "gpui-kit";
import type { Theme } from "herdr";
import type { Tone } from "./runs.ts";


/** A run's state in the theme's colors. */
export function toneColor(t: Theme, k: Tone): Color {
  switch (k) {
    case "running": return t.working;
    case "ok": return t.done;
    case "failed": return t.blocked;
    case "stopped": return t.dim;
  }
}
