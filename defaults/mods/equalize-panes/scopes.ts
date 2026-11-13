// What the popup offers (no herdr imports: bun tests it). Each scope is a
// pane.equalize call: "all" evens every row and column of the tab, "row" the
// panes side by side with this one, "column" the panes stacked with it.
// "grid" rearranges the tab's panes into an even grid first (Nocturne's
// nocturne.gridify, which evens it out after).

export type Scope = "all" | "row" | "column" | "grid";

/** One way to even out: its key in the popup, its name, its icon (an svg of this mod) and
 *  the palette's words for it. */
export interface ScopeEntry {
  readonly scope: Scope;
  readonly key: string;
  readonly name: string;
  readonly icon: string;
  readonly words: string;
  /** A command of its own instead of pane.equalize. */
  readonly command?: "nocturne.gridify";
}

export const SCOPES: readonly ScopeEntry[] = [
  { scope: "all", key: "a", name: "All panes", icon: "even-all", words: "equalize even balance grid every" },
  { scope: "row", key: "r", name: "This row", icon: "even-row", words: "equalize even balance side by side widths" },
  { scope: "column", key: "c", name: "This column", icon: "even-column", words: "equalize even balance stacked heights" },
  { scope: "grid", key: "g", name: "As a grid", icon: "grid", words: "gridify tile arrange rearrange", command: "nocturne.gridify" },
];

/** pane.equalize's arguments (the pane left out for the focused one); gridify takes none. */
export type EqualizeArgs = { readonly scope: Scope; readonly pane: string } | { readonly scope: Scope } | Readonly<Record<never, never>>;

/** A row of the popup: its scope, the command it runs and with what, and whether it is off. */
export interface ScopeRow extends Omit<ScopeEntry, "command"> {
  readonly command: "pane.equalize" | "nocturne.gridify";
  readonly args: EqualizeArgs;
  readonly off: boolean;
}

/** pane.equalize's arguments for `scope` on `pane` (null: the focused one). */
const equalizeArgs = (scope: Scope, pane: string | null): EqualizeArgs => (pane === null ? { scope } : { scope, pane });

/** The popup's rows for a pane in a tab of `count` panes: nothing to even out
 *  with one pane. A pane without a row (or column) gets an error back from
 *  the app and nothing changes. */
export function rows(pane: string | null, count: number): ScopeRow[] {
  return SCOPES.map((s) => ({ ...s, command: s.command ?? "pane.equalize", args: s.command === undefined ? equalizeArgs(s.scope, pane) : {}, off: count < 2 }));
}

/** A key binding as herdr's `keys()` lists it. */
export interface Binding {
  readonly section: string;
  readonly keys: string;
  readonly action: string;
}

/** The keys bound to pane.equalize with this scope ("pane.equalize" alone is "all"), as keys.json spells them. */
export function shortcut(bindings: readonly Binding[], scope: Scope): string {
  const actions = scope === "all" ? ["pane.equalize", "pane.equalize:all"] : scope === "grid" ? ["nocturne.gridify"] : [`pane.equalize:${scope}`];

  return bindings.find((b) => actions.includes(b.action) && b.section !== "terminal")?.keys ?? "";
}
