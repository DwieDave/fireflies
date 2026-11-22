// Where the window was last left in each space, so a window opened in a space
// comes back there, also after a restart: shared "github.spaces" (shared() is
// persisted), keyed by the space's id, the newest SPACES_KEPT kept. A record
// is what the window keeps anyway (place.ts isKept: its folder, tab and each
// tab's selection, filter and sizes); it is used when the window opens on the
// same folder.

import { shared, setShared, spaces } from "herdr";
import { isNumber, object, readSharedMap, sharedMapKey, writeSharedMap } from "./guard.ts";
import type { Kept } from "./place.ts";
import { isKept } from "./place.ts";

const isSpaceKept = (value: unknown): value is Kept & { readonly at: number } => isKept(value) && object({ at: isNumber })(value);

export const SPACES_KEY = sharedMapKey("github.spaces", isSpaceKept);

/** How many spaces' records are kept (the least recently changed go first). */
export const SPACES_KEPT = 30;

/** The shown space's id (the space a window opens in), null before there is one. */
export const shownSpace = (): string | null => spaces().find((s) => s.active)?.id ?? null;

/** What the window kept in `space` (null: nothing kept there). */
export function spaceKept(space: string | null): Kept | null {
  return space ? readSharedMap(shared, SPACES_KEY).get(space) ?? null : null;
}

/** Keeps `kept` as `space`'s record (written only when it changed). */
export function keepSpace(space: string | null, kept: Kept): void {
  if (!space) return;

  const map = new Map(readSharedMap(shared, SPACES_KEY));
  const was = map.get(space);

  if (was && JSON.stringify({ ...was, at: 0 }) === JSON.stringify({ ...kept, at: 0 })) return;

  // Kept oldest first, the newest last (a stable sort keeps that among records of the same ms).
  map.delete(space);
  map.set(space, { ...kept, at: Date.now() });
  writeSharedMap(setShared, SPACES_KEY, new Map([...map].sort((a, b) => a[1].at - b[1].at).slice(-SPACES_KEPT)));
}
