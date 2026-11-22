// Where the view was last left in each space, so a window opened in a space
// comes back there, also after a restart: shared "databases.spaces" (shared()
// is persisted), keyed by the space's id, the newest SPACES_KEPT kept. A
// record holds the connection's id, the panel, the open table and the query
// tab; a connection another mod sent is kept as its request (isConnectArgs:
// never a secret), sent again on opening.

import { shared, setShared, spaces } from "herdr";
import type { Guarded } from "./guard.ts";
import { isNumber, isString, literal, object, readSharedMap, sharedMapKey, writeSharedMap } from "./guard.ts";
import { isConnectArgs } from "./state.ts";

export const SPACES_KEY = sharedMapKey("databases.spaces", object({ at: isNumber }, {
  conn: isString, panel: literal("conns", "tables", "structure", "main", "log"), table: isString, query: isNumber, sent: isConnectArgs,
}));

export type SpacePlace = Guarded<typeof SPACES_KEY.entry>;

/** How many spaces' records are kept (the least recently changed go first). */
export const SPACES_KEPT = 30;

/** The shown space's id (the space a view opens in), null before there is one. */
export const shownSpace = (): string | null => spaces().find((s) => s.active)?.id ?? null;

/** Where the view was last left in `space` (null: nothing kept there). */
export function spacePlace(space: string | null): SpacePlace | null {
  return space ? readSharedMap(shared, SPACES_KEY).get(space) ?? null : null;
}

/** The record without its time, to tell a change. */
const sameAs = (a: SpacePlace, b: Omit<SpacePlace, "at">): boolean =>
  JSON.stringify([a.conn, a.panel, a.table, a.query, a.sent]) === JSON.stringify([b.conn, b.panel, b.table, b.query, b.sent]);

/** Keeps where the view is now as `space`'s record (written only when it changed). */
export function keepSpacePlace(space: string | null, place: Omit<SpacePlace, "at">): void {
  if (!space) return;

  const map = new Map(readSharedMap(shared, SPACES_KEY));
  const was = map.get(space);

  if (was && sameAs(was, place)) return;

  // Kept oldest first, the newest last (a stable sort keeps that among records of the same ms).
  map.delete(space);
  map.set(space, { ...place, at: Date.now() });
  writeSharedMap(setShared, SPACES_KEY, new Map([...map].sort((a, b) => a[1].at - b[1].at).slice(-SPACES_KEPT)));
}
