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

/** The grid for `order` (pane ids): rows of ids. */
export function gridRows(order, columns = null) {
  const n = order.length;
  if (!n) return [];
  const c = Math.max(1, Math.min(n, Math.round(columns ?? Math.ceil(Math.sqrt(n)))));
  const rows = [];
  for (let i = 0; i < n; i += c) rows.push(order.slice(i, i + c));
  return rows;
}

/** The moves that build it: [{ pane, out: true }] to the holding tab, then
 *  [{ pane, target, edge }] back. Nothing for fewer than two panes. */
export function gridMoves(order, columns = null) {
  if (order.length < 2) return [];
  const rows = gridRows(order, columns);
  const out = order.slice(1).map((pane) => ({ pane, out: true }));
  const leaders = rows.slice(1).map((r, i) => ({ pane: r[0], target: rows[i][0], edge: "bottom" }));
  const fill = rows.flatMap((r) => r.slice(1).map((pane, i) => ({ pane, target: r[i], edge: "right" })));
  return [...out, ...leaders, ...fill];
}

/** Plays `moves` on a tree of { row | column: [...] } / pane id strings, as
 *  the app's pane.move does (a split beside a pane joins its parent when the
 *  axis matches, else wraps the pane): what the tab ends up as. For tests. */
export function simulate(order, moves) {
  let root = order[0];
  const axisOf = (edge) => (edge === "right" || edge === "left" ? "row" : "column");
  const insert = (node, target, pane, axis) => {
    if (node === target) return { [axis]: [node, pane] };
    const key = node.row ? "row" : "column";
    const kids = node[key];
    const i = kids.indexOf(target);
    if (i >= 0 && key === axis) { kids.splice(i + 1, 0, pane); return node; }
    return { [key]: kids.map((k) => (typeof k === "string" ? (k === target ? insert(k, target, pane, axis) : k) : insert(k, target, pane, axis))) };
  };
  for (const m of moves) {
    if (m.out) continue;
    root = insert(root, m.target, m.pane, axisOf(m.edge));
  }
  return root;
}
