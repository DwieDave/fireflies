// Files renamed, moved or deleted from the files pane, followed by the editors
// showing them. The files pane records each change in
// shared("nocturne.files.changes"): an array, newest last, at most 50 entries,
// each { id, from, to, on, at } (absolute paths; `to` null for a delete; `on`
// the machine or null; `id` grows with every entry). A folder is one entry
// with its own paths: a file under it matches by prefix. The record is kept
// across restarts, so an editor acts only on entries newer than the newest
// one it saw when it started.

export const CHANGES = "nocturne.files.changes";

/** The newest entry's id in `list` (0 for none). */
export function newestId(list) {
  return (Array.isArray(list) ? list : []).reduce((n, e) => Math.max(n, Number(e?.id) || 0), 0);
}

/** A path with macOS's /private folded off /var, /tmp and /etc (they are
 *  links into /private): the files tree may hold one form, an editor the other. */
export function fold(path) {
  return String(path ?? "").replace(/^\/private(?=\/(?:var|tmp|etc)(?:\/|$))/, "").replace(/\/+$/, "");
}

/** What one entry means for the file at `path` on machine `on` (null: this
 *  computer): null (not this file), { to } (moved there), { deleted: true }.
 *  Paths compare with /private folded; the new path keeps `path`'s form. */
export function changeFor(entry, path, on = null) {
  if (!entry || typeof entry.from !== "string" || !path) return null;
  if ((entry.on ?? null) !== (on ?? null)) return null;
  const from = fold(entry.from), here = fold(path);
  const under = here.startsWith(`${from}/`);
  if (here !== from && !under) return null;
  if (entry.to == null) return { deleted: true };
  // In the form the editor held: /private kept when it had it.
  let to = fold(entry.to);
  if (path.startsWith("/private/") && /^\/(?:var|tmp|etc)(?:\/|$)/.test(to)) to = `/private${to}`;
  return { to: under ? to + here.slice(from.length) : to };
}

/** Every entry of `list` newer than `seen`, in order, applied to the file at
 *  `path`: where it ends up, whether it was deleted there, and the newest id
 *  now seen. A move after a delete (put back) clears the delete. */
export function follow(list, seen, path, on = null) {
  let at = path, deleted = false, newest = seen;
  for (const e of Array.isArray(list) ? list : []) {
    const id = Number(e?.id) || 0;
    if (id <= seen) continue;
    newest = Math.max(newest, id);
    const c = changeFor(e, at, on);
    if (!c) continue;
    if (c.deleted) deleted = true;
    else { at = c.to; deleted = false; }
  }
  return { path: at, deleted, seen: newest };
}
