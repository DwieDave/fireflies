// The page scrolled by its keys while the bar has the keyboard (the pane
// focused, not the address field, not the page itself): ↑ ↓ ← → a line, page
// up / down and space / shift-space a screen, home / end to the top / bottom.
// The native view's browser.scroll does it (both engines); once the page has
// the keyboard (enter, i, a click) the page takes these keys itself, and a
// field in it keeps them.

/** browser.scroll's arguments (native view): how far, which way, which axis. */
export type Scroll = {
  readonly by: "line" | "page" | "end";
  readonly dir: 1 | -1;
  readonly axis: "y" | "x";
};

const SCROLLS = new Map<string, Scroll>([
  ["up", { by: "line", dir: -1, axis: "y" }],
  ["down", { by: "line", dir: 1, axis: "y" }],
  ["left", { by: "line", dir: -1, axis: "x" }],
  ["right", { by: "line", dir: 1, axis: "x" }],
  ["pageup", { by: "page", dir: -1, axis: "y" }],
  ["pagedown", { by: "page", dir: 1, axis: "y" }],
  ["home", { by: "end", dir: -1, axis: "y" }],
  ["end", { by: "end", dir: 1, axis: "y" }],
  ["space", { by: "page", dir: 1, axis: "y" }],
]);

/** The scroll a key asks for (`key` as props.ts keyOf names it), null for any other key. */
export function scrollOf(key: string, shift: boolean): Scroll | null {
  if (key === "space" && shift) return { by: "page", dir: -1, axis: "y" };

  return SCROLLS.get(key) ?? null;
}
