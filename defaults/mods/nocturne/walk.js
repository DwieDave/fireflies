// The walk: nocturne.agent-next / nocturne.agent-prev (the layout's cmd-] /
// cmd-[ in place of the core's agent.next / agent.prev). It goes through the
// agents in the order the sidebar shows them (pinned ones first, kit.js
// sortedAgents), then on through the jar's shelf (every tile in shelf order:
// web pages, editors, files, plain shells; pins.js jarItems + onShelf), then
// back to the first agent; backwards the other way round.
// Each shelf item is a stop of its own, also when several share a pane (a pin
// of one web tab): its jar key tells them apart.
// Pure functions: no herdr imports, so the tests can load this file.

/**
 * The walk's stops, in order: `agents` (addresses, the sidebar's order), then
 * `shelf` (jar items on the shelf, in shelf order).
 *   { key: address, agent: address }   an agent
 *   { key: jar key, item }             a shelf item (goes through kit.js goToPin)
 * An agent pinned as a shelf terminal too is walked once, as an agent.
 */
export function walkStops(agents, shelf) {
  const seen = new Set(agents);
  return [
    ...agents.map((a) => ({ key: a, agent: a })),
    ...shelf.filter((it) => !seen.has(it.key)).map((it) => ({ key: it.key, item: it })),
  ];
}

/**
 * Where the walk stands (an index in `stops`, or -1): the agent shown in the
 * focused pane, else the shelf item holding the focus. Shelf items that share
 * the focused pane (tab pins) are told apart by `last`, the key the walk went
 * to last; else the first of them.
 * `f`: focused() ({ pane, terminal, shown }).
 */
export function walkAt(stops, f, last = null) {
  if (!f) return -1;
  const term = f.shown ?? f.terminal;
  if (term) {
    const i = stops.findIndex((s) => s.agent === term || (s.item && s.item.kind !== "pane" && s.item.key === term));
    if (i >= 0) return i;
  }
  if (!f.pane) return -1;
  const here = stops.map((s, i) => [s, i]).filter(([s]) => s.item?.pane?.pane === f.pane);
  if (!here.length) return -1;
  return (here.find(([s]) => s.key === last) ?? here[0])[1];
}

/** The stop `dir` (+1 next, -1 previous) from `at`, wrapping both ways; from
 *  nowhere (-1) next starts at the first stop, previous at the last. Null: no stops. */
export function walkNext(stops, at, dir) {
  const n = stops.length;
  if (!n) return null;
  if (at < 0) return stops[dir > 0 ? 0 : n - 1];
  return stops[(((at + dir) % n) + n) % n];
}
