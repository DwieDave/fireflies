// The pieces of the look this pane needs beyond @fireflies/look: status pips
// that breathe while working and blink while blocked.

import { div } from "gpui-kit";
import type { Element } from "gpui-kit";
import type { Status, Theme } from "herdr";
import { dot } from "@fireflies/look";

/** A status pip (nocturne's diamond, else a round dot) in the status color; working breathes, blocked blinks. */
export function pip(t: Theme, status: Status | null, size = 6): Element {
  if (status === null || status === "idle") return div().size(size).flex_none();

  const el = dot(t[status], size);

  if (status === "working") return el.loop("opacity", { from: 0.3, to: 1, period: 1600 });

  if (status === "blocked") return el.loop("opacity", { from: 0.15, to: 1, period: 700, easing: "linear" });

  return el;
}
