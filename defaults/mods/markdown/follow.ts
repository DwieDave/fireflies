// Files renamed, moved or deleted from the files pane, followed by the editors
// and viewers showing them. The files pane records each change in
// shared("nocturne.files.changes"): an array, newest last, at most 50 entries,
// each { id, from, to, on, at } (absolute paths; `to` null for a delete; `on`
// the machine or null; `id` grows with every entry). A folder is one entry
// with its own paths: a file under it matches by prefix. The record is kept
// across restarts, so an editor acts only on entries newer than the newest
// one it saw when it started. The editor ships the same file (a mod can't
// import another's files); scripts/editor-follow.test.ts fails when the
// copies differ: edit one, copy it over.

import type { shared } from "herdr";
import type { Guarded } from "./guard.ts";
import { isNumber, isString, nullable, object, readSharedList, sharedListKey } from "./guard.ts";

/** One rename, move or delete (`to` null), as the files pane writes it. */
export const isFileChange = object({ id: isNumber, from: isString, to: nullable(isString) }, { on: nullable(isString), at: isNumber });

export type FileChange = Guarded<typeof isFileChange>;

export const CHANGES = "nocturne.files.changes";

export const CHANGES_KEY = sharedListKey(CHANGES, isFileChange);

/** What happened to a file: moved to `to`, or deleted. */
export type Change = { readonly to: string } | { readonly deleted: true };

/** Where a file ends up after the changes newer than `seen`: its path, whether
 *  it was deleted there, and the newest id now seen. */
export interface Followed {
  readonly path: string;
  readonly deleted: boolean;
  readonly seen: number;
}

/** The record's entries (one in another shape is left out). */
export const fileChanges = (read: typeof shared): readonly FileChange[] => readSharedList(read, CHANGES_KEY);

/** The newest entry's id in `list` (0 for none). */
export function newestId(list: readonly FileChange[]): number {
  let n = 0;

  for (const e of list) n = Math.max(n, e.id);

  return n;
}

/** A path with macOS's /private folded off /var, /tmp and /etc (they are
 *  links into /private): the files tree may hold one form, an editor the other. */
export function fold(path: string): string {
  return path.replace(/^\/private(?=\/(?:var|tmp|etc)(?:\/|$))/, "").replace(/\/+$/, "");
}

/** What one entry means for the file at `path` on machine `on` (null: this
 *  computer): null (not this file), { to } (moved there), { deleted: true }.
 *  Paths compare with /private folded; the new path keeps `path`'s form. */
export function changeFor(entry: Pick<FileChange, "from" | "to" | "on">, path: string, on: string | null = null): Change | null {
  if (!path || (entry.on ?? null) !== on) return null;

  const from = fold(entry.from);
  const here = fold(path);
  const under = here.startsWith(`${from}/`);

  if (here !== from && !under) return null;

  if (entry.to === null) return { deleted: true };

  // In the form the editor held: /private kept when it had it.
  const folded = fold(entry.to);
  const to = path.startsWith("/private/") && /^\/(?:var|tmp|etc)(?:\/|$)/.test(folded) ? `/private${folded}` : folded;

  return { to: under ? to + here.slice(from.length) : to };
}

/** Every entry of `list` newer than `seen`, in order, applied to the file at
 *  `path`: where it ends up, whether it was deleted there, and the newest id
 *  now seen. A move after a delete (put back) clears the delete. */
export function follow(list: readonly FileChange[], seen: number, path: string, on: string | null = null): Followed {
  let at = path;
  let deleted = false;
  let newest = seen;

  for (const e of list) {
    if (e.id <= seen) continue;

    newest = Math.max(newest, e.id);

    const c = changeFor(e, at, on);

    if (!c) continue;

    if ("deleted" in c) deleted = true;
    else {
      at = c.to;
      deleted = false;
    }
  }

  return { path: at, deleted, seen: newest };
}
