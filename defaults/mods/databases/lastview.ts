// Where the view was last left in each space, so a window opened in a space
// comes back there, also after a restart: shared "databases.spaces" (shared()
// is persisted), keyed by the space's id, the newest SPACES_KEPT kept. A
// record holds the connection's id, the panel, the open table and the query
// tab; a connection another mod sent is kept as its request (ConnectArgsSchema:
// never a secret), sent again on opening.

import { shared, setShared, spaces } from "herdr";
import { Array as Arr, Equal, Option, Order, Schema, String as Str } from "effect";
import { mapOf, readShared, sharedKey, writeShared } from "@fireflies/kit";
import { ConnectArgsSchema, KeptCopySchema } from "./state.ts";
import { nowMs } from "./app.ts";

const SpacePlaceSchema = Schema.Struct({ ...KeptCopySchema.fields, at: Schema.Finite, sent: Schema.optionalKey(ConnectArgsSchema) });

export const SPACES_KEY = sharedKey("databases.spaces", mapOf(SpacePlaceSchema));

export type SpacePlace = typeof SpacePlaceSchema.Type;

/** How many spaces' records are kept (the least recently changed go first). */
export const SPACES_KEPT = 30;

/** The shown space's id (the space a view opens in), null before there is one. */
export const shownSpace = (): string | null => Option.getOrNull(Option.map(Arr.findFirst(spaces(), (s) => s.active), (s) => s.id));

const noPlaces: ReadonlyMap<string, SpacePlace> = new Map();

/** Where the view was last left in `space` (null: nothing kept there). */
export function spacePlace(space: string | null): SpacePlace | null {
  return space !== null && Str.isNonEmpty(space) ? readShared(shared, SPACES_KEY, noPlaces).get(space) ?? null : null;
}

/** The record without its time, to tell a change. */
const sameAs = (a: SpacePlace, b: Omit<SpacePlace, "at">): boolean => Equal.equals([a.conn, a.panel, a.table, a.query, a.sent], [b.conn, b.panel, b.table, b.query, b.sent]);

/** Keeps where the view is now as `space`'s record (written only when it changed). */
export function keepSpacePlace(space: string | null, place: Omit<SpacePlace, "at">): void {
  if (space === null || Str.isEmpty(space)) return;

  const map = new Map(readShared(shared, SPACES_KEY, noPlaces));
  const was = map.get(space);

  if (was !== undefined && sameAs(was, place)) return;

  // Kept oldest first, the newest last (a stable sort keeps that among records of the same ms).
  map.delete(space);
  map.set(space, { ...place, at: nowMs() });
  writeShared(setShared, SPACES_KEY, new Map(Arr.takeRight(Arr.sort([...map], Order.mapInput(Order.Number, (e: readonly [string, SpacePlace]) => e[1].at)), SPACES_KEPT)));
}
