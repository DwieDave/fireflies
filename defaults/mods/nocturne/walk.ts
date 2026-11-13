// The walk: nocturne.agent-next / nocturne.agent-prev (the layout's cmd-] /
// cmd-[ in place of the core's agent.next / agent.prev). It goes through the
// agents in the order the sidebar shows them (pinned ones first, kit.ts
// sortedAgents), then on through the jar's shelf (every tile in shelf order:
// web pages, editors, files, plain shells; pins.ts jarItems + onShelf), then
// back to the first agent; backwards the other way round.
// Each shelf item is a stop of its own, also when several share a pane (a pin
// of one web tab): its jar key tells them apart.
// Pure functions: no herdr imports at run time, so the tests can load this file.

import type { JarItem } from "./pins.ts";

/** A stop of the walk: an agent (its address), or a shelf item. */
export type WalkStop = { readonly key: string; readonly agent: string } | { readonly key: string; readonly item: JarItem };

/** What the walk reads of focused(). */
export interface WalkFocus {
  readonly pane: string | null;
  readonly terminal: string | null;
  readonly shown: string | null;
}

/**
 * The walk's stops, in order: `agents` (addresses, the sidebar's order), then
 * `shelf` (jar items on the shelf, in shelf order).
 *   { key: address, agent: address }   an agent
 *   { key: jar key, item }             a shelf item (goes through kit.ts goToPin)
 * An agent pinned as a shelf terminal too is walked once, as an agent.
 */
export function walkStops(agents: readonly string[], shelf: readonly JarItem[]): WalkStop[] {
  const seen = new Set(agents);

  return [
    ...agents.map((a): WalkStop => ({ key: a, agent: a })),
    ...shelf.flatMap((it): WalkStop[] => (seen.has(it.key) ? [] : [{ key: it.key, item: it }])),
  ];
}

/** A stop's shelf item, or null (an agent). */
const itemOf = (s: WalkStop): JarItem | null => ("item" in s ? s.item : null);

/** The pane a stop's shelf item is in, or undefined (an agent, a terminal without one). */
function paneOf(s: WalkStop): string | undefined {
  const it = itemOf(s);

  return it && "pane" in it ? it.pane?.pane : undefined;
}

/**
 * Where the walk stands (an index in `stops`, or -1): the agent shown in the
 * focused pane, else the shelf item holding the focus. Shelf items that share
 * the focused pane (tab pins) are told apart by `last`, the key the walk went
 * to last; else the first of them.
 * `f`: focused() ({ pane, terminal, shown }).
 */
export function walkAt(stops: readonly WalkStop[], f: WalkFocus | null | undefined, last: string | null = null): number {
  if (!f) return -1;

  const term = f.shown ?? f.terminal;

  if (term) {
    const i = stops.findIndex((s) => ("agent" in s && s.agent === term) || (itemOf(s)?.kind !== "pane" && itemOf(s)?.key === term));

    if (i >= 0) return i;
  }

  if (!f.pane) return -1;

  const here = stops.flatMap((s, i): (readonly [WalkStop, number])[] => (paneOf(s) === f.pane ? [[s, i]] : []));
  const at = here.find(([s]) => s.key === last) ?? here[0];

  return at ? at[1] : -1;
}

/** The stop `dir` (+1 next, -1 previous) from `at`, wrapping both ways; from
 *  nowhere (-1) next starts at the first stop, previous at the last. Null: no stops. */
export function walkNext(stops: readonly WalkStop[], at: number, dir: number): WalkStop | null {
  const n = stops.length;

  if (!n) return null;

  if (at < 0) return stops[dir > 0 ? 0 : n - 1] ?? null;

  return stops[(((at + dir) % n) + n) % n] ?? null;
}
