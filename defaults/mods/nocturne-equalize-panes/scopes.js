// What the popup offers (no herdr imports: bun tests it). Each scope is a
// pane.equalize call: "all" evens every row and column of the tab, "row" the
// panes side by side with this one, "column" the panes stacked with it.

export const SCOPES = [
  { scope: "all", key: "a", name: "All panes", icon: "even-all", words: "equalize even balance grid every" },
  { scope: "row", key: "r", name: "This row", icon: "even-row", words: "equalize even balance side by side widths" },
  { scope: "column", key: "c", name: "This column", icon: "even-column", words: "equalize even balance stacked heights" },
];

/** The popup's rows for a pane in a tab of `count` panes: nothing to even out
 *  with one pane. A pane without a row (or column) gets an error back from
 *  the app and nothing changes. */
export function rows(pane, count) {
  return SCOPES.map((s) => ({ ...s, args: pane ? { scope: s.scope, pane } : { scope: s.scope }, off: count < 2 }));
}

/** The keys bound to pane.equalize with this scope ("pane.equalize" alone is "all"), as keys.json spells them. */
export function shortcut(bindings, scope) {
  const actions = scope === "all" ? ["pane.equalize", "pane.equalize:all"] : [`pane.equalize:${scope}`];
  return bindings.find((b) => actions.includes(b.action) && b.section !== "terminal")?.keys ?? "";
}
