// Gridify's plan (no herdr imports: bun tests it). A tab's placed panes, in
// order, become an even grid: ceil(sqrt(n)) columns (or `columns`), rows
// filled left to right, a short last row stretched to the full width.
//
// pane.move can't move a pane inside its own tab, so the grid is built by
// way of a holding tab: every pane but the first leaves for it, then comes
// back beside a pane already placed. Row leaders come back first, each below
// the one before (a column of rows' first panes); then each row fills to the
// right of its leader, which wraps the leader in that row. pane.move only
// targets panes, so this order is what makes the result a column of rows
// rather than splits nested inside splits.

import { isString } from "./guard.ts";

/** A move that builds the grid: to the holding tab, or back beside a placed pane. */
export type GridMove =
  | { readonly pane: string; readonly out: true }
  | { readonly pane: string; readonly target: string; readonly edge: "bottom" | "right" };

/** A tab's tree as simulate() plays it: a pane id, or a row or column of trees. */
export type GridNode = string | { readonly row: GridNode[] } | { readonly column: GridNode[] };

/** A tree that is one pane. */
const isPane = (node: GridNode): node is string => isString(node);

/** The grid for `order` (pane ids): rows of ids. */
export function gridRows(order: readonly string[], columns: number | null = null): string[][] {
  const n = order.length;

  if (!n) return [];

  const c = Math.max(1, Math.min(n, Math.round(columns ?? Math.ceil(Math.sqrt(n)))));
  const rows: string[][] = [];

  for (let i = 0; i < n; i += c) rows.push(order.slice(i, i + c));

  return rows;
}

/** The moves that build it: [{ pane, out: true }] to the holding tab, then
 *  [{ pane, target, edge }] back. Nothing for fewer than two panes. */
export function gridMoves(order: readonly string[], columns: number | null = null): GridMove[] {
  if (order.length < 2) return [];

  const rows = gridRows(order, columns);
  const out = order.slice(1).map((pane): GridMove => ({ pane, out: true }));

  const leaders = rows.slice(1).flatMap((r, i): GridMove[] => {
    const pane = r[0];
    const target = rows[i]?.[0];

    return pane && target ? [{ pane, target, edge: "bottom" }] : [];
  });

  const fill = rows.flatMap((r) => r.slice(1).flatMap((pane, i): GridMove[] => {
    const target = r[i];

    return target ? [{ pane, target, edge: "right" }] : [];
  }));

  return [...out, ...leaders, ...fill];
}

/** Plays `moves` on a tree of { row | column: [...] } / pane id strings, as
 *  the app's pane.move does (a split beside a pane joins its parent when the
 *  axis matches, else wraps the pane): what the tab ends up as. For tests. */
export function simulate(order: readonly string[], moves: readonly GridMove[]): GridNode | undefined {
  let root: GridNode | undefined = order[0];
  const axisOf = (edge: "bottom" | "right") => (edge === "right" ? "row" : "column");
  const split = (axis: "row" | "column", kids: GridNode[]): GridNode => (axis === "row" ? { row: kids } : { column: kids });

  const insert = (node: GridNode, target: string, pane: string, axis: "row" | "column"): GridNode => {
    if (node === target) return split(axis, [node, pane]);

    if (isPane(node)) return node;

    const key = "row" in node ? "row" : "column";
    const kids = "row" in node ? node.row : node.column;
    const i = kids.indexOf(target);

    if (i >= 0 && key === axis) {
      kids.splice(i + 1, 0, pane);

      return node;
    }

    return split(key, kids.map((k) => (isPane(k) && k !== target ? k : insert(k, target, pane, axis))));
  };

  for (const m of moves) {
    if ("out" in m || root === undefined) continue;

    root = insert(root, m.target, m.pane, axisOf(m.edge));
  }

  return root;
}
