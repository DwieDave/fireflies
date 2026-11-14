// Moving a whole tab to another space (tab.move {id, space}: every pane, its
// arrangement and sizes, parked panes and focus go with it, and it is shown
// there): where it can go, in the order the sidebar lists the spaces.
// The sidebar (spaces.ts rows) publishes its rows as it draws them, worktree
// spaces under their repo's, in shared SPACE_ROWS:
//   [{ id, depth }]   id: a space; depth: 1 for a linked worktree's space,
//                     listed under its repo's, else 0
// A space it hasn't listed (no sidebar drawn yet) follows in Fireflies' order.
// Pure functions: no herdr imports at run time, so the tests can load this file.

import type { SpaceInfo } from "herdr";
import { isNumber, isString, object, sharedListKey } from "./guard.ts";
import type { SpaceRow } from "./spaces.ts";

/** shared() key: the sidebar's space rows, [{ id, depth }]. */
export const SPACE_ROWS = "nocturne.space-rows";
export const SPACE_ROWS_KEY = sharedListKey(SPACE_ROWS, object({ id: isString, depth: isNumber }));

/** A sidebar row as published: a space and its indent. */
export interface SpaceRowOf {
  readonly id: string;
  readonly depth: number;
}

/** A space a tab can move to, and its indent in the sidebar. */
export interface SpaceTarget {
  readonly space: SpaceInfo;
  readonly depth: number;
}

/** Where tab `tab` can move (TabMove's `to`), and what moving it does. */
export interface TabMove {
  /** Its space now. */
  readonly from: SpaceInfo;
  /** The other spaces on its machine, the sidebar's order. */
  readonly to: SpaceTarget[];
  /** It is its space's last tab: moving it closes that space. */
  readonly last: boolean;
}

/**
 * Where tab `tab` can go: every other space on its machine (a tab's
 * terminals stay on theirs), in the sidebar's order (`rows`, SPACE_ROWS),
 * spaces it doesn't list after them in `all`'s order. Null: no such tab.
 */
export function tabMove(tab: string | null | undefined, all: readonly SpaceInfo[], rows: readonly SpaceRowOf[] = []): TabMove | null {
  const from = all.find((s) => s.tabs.some((c) => c.id === tab));

  if (!from) return null;

  const machine = from.machine ?? null;
  const ok = (s: SpaceInfo) => s.id !== from.id && (s.machine ?? null) === machine;
  const byId = new Map(all.map((s) => [s.id, s]));
  const listed = new Set<string>();
  const to: SpaceTarget[] = [];

  for (const r of rows) {
    const s = byId.get(r.id);

    if (!s || listed.has(s.id)) continue;

    listed.add(s.id);

    if (ok(s)) to.push({ space: s, depth: r.depth > 0 ? 1 : 0 });
  }

  for (const s of all) if (!listed.has(s.id) && ok(s)) to.push({ space: s, depth: 0 });

  return { from, to, last: from.tabs.length === 1 };
}

/** The rows to publish for the sidebar's spaces ({ s, depth } rows; headers skipped). */
export function spaceRowsOf(rows: readonly SpaceRow[]): SpaceRowOf[] {
  return rows.flatMap((r) => ("s" in r ? [{ id: r.s.id, depth: r.depth }] : []));
}
