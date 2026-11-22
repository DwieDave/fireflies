// Where the window was last left in each space, so a window opened in a space
// comes back there, also after a restart: shared "github.spaces" (shared() is
// persisted), keyed by the space's id, the newest SPACES_KEPT kept. A record
// is what the window keeps anyway (kept.ts: its folder, tab and each tab's
// selection, filter and sizes) and when it was kept; it is used when the
// window opens on the same folder. Read entry by entry (the kit's mapOf): a
// space's record in another shape is left out, the others still read.

import { Array as Arr, Option, Order, Schema } from "effect";
import { shared, setShared, spaces } from "herdr";
import { mapOf, readShared, sharedKey, writeShared } from "@fireflies/kit";
import type { Kept } from "./kept.ts";
import { KeptSchema, sameKept } from "./kept.ts";

/** A space's record: what the window kept there, and when (ms). */
const SpaceKeptSchema = Schema.Struct({ ...KeptSchema.fields, at: Schema.Finite });

type SpaceKept = typeof SpaceKeptSchema.Type;

export const SPACES_KEY = sharedKey("github.spaces", mapOf(SpaceKeptSchema));

/** How many spaces' records are kept (the least recently changed go first). */
export const SPACES_KEPT = 30;

/** The shown space's id (the space a window opens in), null before there is one. */
export const shownSpace = (): string | null => Option.getOrNull(Option.map(Arr.findFirst(spaces(), (s) => s.active), (s) => s.id));

/** What the window kept in `space` (null: nothing kept there). */
export function spaceKept(space: string | null): Kept | null {
  return space === null ? null : readShared(shared, SPACES_KEY, new Map()).get(space) ?? null;
}

/** Oldest first: the newest is last, and a stable sort keeps that among records of the same ms. */
const byAge = Order.mapInput(Order.Number, ([, k]: readonly [string, SpaceKept]) => k.at);

/** Keeps `kept` as `space`'s record at `now` (written only when it changed). */
export function keepSpace(space: string | null, kept: Kept, now: number): void {
  if (space === null) return;

  const map = new Map(readShared(shared, SPACES_KEY, new Map()));
  const was = map.get(space);

  if (was !== undefined && sameKept(was, kept)) return;

  map.delete(space);
  map.set(space, { ...kept, at: now });
  writeShared(setShared, SPACES_KEY, new Map(Arr.takeRight(Arr.sort(Arr.fromIterable(map), byAge), SPACES_KEPT)));
}
