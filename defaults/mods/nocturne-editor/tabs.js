// The editor's file tabs, as data: no app calls, so scripts/nocturne-editor-tabs.test.ts
// drives them. A pane holds several files (main.js keeps one record per file:
// its text, undo, caret, scroll, unsaved changes, server document); these
// decide where a new tab goes, which one shows after a close, what comes back
// after a restart, what closing the pane asks, the names on the strip and
// which of them fit.

import { basename, dirname } from "./logic.js";

/** Where a file opened in the pane goes: the index of its tab when it is
 *  open already, else a new tab right after the shown one. -> { index, added } */
export function placeTab(paths, active, path) {
  const at = paths.indexOf(path);
  if (at >= 0) return { index: at, added: false };
  return { index: Math.min(paths.length, Math.max(0, active + 1)), added: true };
}

/** The tab shown after closing tab `index` of `count`: the next one, else the
 *  one before (null: none left). `active`: the one shown before the close. */
export function afterClose(count, active, index) {
  if (count <= 1) return null;
  if (index !== active) return active > index ? active - 1 : active;
  return index < count - 1 ? index : index - 1;
}

/** The next (d 1) or previous (d -1) tab, wrapping. */
export function stepTab(count, active, d) {
  if (count <= 0) return 0;
  return (((active + d) % count) + count) % count;
}

/** What the pane opens with: its tabs as kept (localStorage `tabs`), else the
 *  props' file (where the files pane moved it, localStorage `moved`), and
 *  which one shows. Files the props ask for that aren't kept get a tab. */
export function restoreTabs(kept, path, moved) {
  let first = path ?? "";
  if (moved && moved.from === first && moved.to) first = moved.to;
  const list = Array.isArray(kept?.paths) ? kept.paths.filter((p) => typeof p === "string" && p) : [];
  if (!list.length) return { paths: [first], active: 0 };
  const unique = [...new Set(list)];
  const active = Math.max(0, Math.min(unique.length - 1, Number.isInteger(kept.active) ? kept.active : 0));
  return { paths: unique, active };
}

/** What localStorage keeps: the files in order and the one shown. */
export function keptTabs(paths, active) {
  return { paths: [...paths], active };
}

/** The note closing the pane shows (setUnsaved), once for every file with
 *  unsaved changes: `docs` [{ path, dirty, deleted }]; null when none. */
export function unsavedNote(docs) {
  const dirty = docs.filter((d) => d.dirty);
  if (!dirty.length) return null;
  if (dirty.length === 1) return `${basename(dirty[0].path)}: ${dirty[0].deleted ? "deleted, unsaved" : "unsaved changes"}`;
  const names = dirty.map((d) => basename(d.path));
  return `${dirty.length} files with unsaved changes: ${names.slice(0, 4).join(", ")}${names.length > 4 ? ", …" : ""}`;
}

/** Each tab's label: the file's name, and for names two tabs share, the
 *  folder that tells them apart (its last part). -> [{ name, hint }] */
export function tabLabels(paths) {
  const names = paths.map((p) => basename(p) || "untitled");
  return paths.map((p, i) => {
    const same = paths.filter((q, j) => j !== i && names[j] === names[i]);
    if (!same.length) return { name: names[i], hint: null };
    // The shortest tail of the folder that no twin shares.
    const parts = dirname(p).split("/").filter(Boolean);
    for (let n = 1; n <= parts.length; n++) {
      const tail = parts.slice(-n).join("/");
      if (same.every((q) => dirname(q).split("/").filter(Boolean).slice(-n).join("/") !== tail)) return { name: names[i], hint: tail };
    }
    return { name: names[i], hint: parts.slice(-1)[0] ?? "/" };
  });
}

/** A tab's width on the strip (px, unzoomed): its padding, the unsaved mark,
 *  the name (cut at MAX_NAME), the folder hint and the close box. */
export const TAB_PAD = 10, MAX_NAME = 26, CHAR_W = 6.6;
export function tabWidth(label) {
  const chars = Math.min(label.name.length, MAX_NAME) + (label.hint ? Math.min(label.hint.length, 18) + 3 : 0);
  return Math.round(TAB_PAD * 2 + 8 + 6 + chars * CHAR_W + 6 + 14);
}

/** Which tabs fit in `room` px with the shown one among them: [from, to)
 *  and how many are left out on each side (the strip's ‹ n and n › marks
 *  take MORE px each). */
export const MORE = 30;
export function visibleTabs(widths, active, room) {
  const n = widths.length;
  if (!n) return { from: 0, to: 0, before: 0, after: 0 };
  const total = widths.reduce((a, b) => a + b, 0);
  if (total <= room) return { from: 0, to: n, before: 0, after: 0 };
  let from = Math.max(0, Math.min(active, n - 1)), to = from + 1, used = widths[from];
  const fits = (w, f, t) => used + w + (f > 0 ? MORE : 0) + (t < n ? MORE : 0) <= room;
  // Grow to the right first (the tabs after the shown one), then to the left.
  for (;;) {
    if (to < n && fits(widths[to], from, to + 1)) { used += widths[to]; to++; continue; }
    if (from > 0 && fits(widths[from - 1], from - 1, to)) { from--; used += widths[from]; continue; }
    break;
  }
  return { from, to, before: from, after: n - to };
}
