// The editor's file tabs, as data: no app calls, so scripts/editor-tabs.test.ts
// drives them. A pane holds several files (main.js keeps one record per file:
// its text, undo, caret, scroll, unsaved changes, server document); these
// decide where a new tab goes, which one shows after a close, what comes back
// after a restart, what closing the pane asks, the names on the strip and
// which of them fit, whether the strip shows (from two tabs on), where a
// dragged tab lands, and whether a tab is text or drawn (the preview's
// viewer: a picture, a PDF, a table).

import { basename, dirname } from "./logic.js";
import { kindOf } from "./kinds.js";

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

/** The strip shows from two tabs on: one file's name and unsaved mark are the bar's. */
export const showStrip = (count) => count > 1;

// ---- moving a tab (a drag along the strip, ]B / [B, cmd-k < / >)

/** How far (px) a press moves before it's a drag rather than a click. */
export const DRAG_START = 4;

/** The gap the pointer is over in tab `index`: before it, or after it (its
 *  right half). `x`, `width`: the pointer's place in the tab, its width. */
export function gapAt(index, x, width) {
  return { index, after: x >= width / 2 };
}

/** Where tab `from` of `count` ends up dropped into `gap` ({ index, after },
 *  or { index: null } the strip past the last tab): its new index, or null
 *  when the drop leaves it where it is (over itself or its own gaps). */
export function dropIndex(count, from, gap) {
  if (!gap || from < 0 || from >= count) return null;
  let at;
  if (gap.index == null) at = count - 1;
  else {
    if (gap.index === from) return null;
    // The place among the others, then counted with the dragged one out.
    at = gap.index + (gap.after ? 1 : 0);
    if (at > from) at -= 1;
  }
  return at === from ? null : at;
}

/** Where the stake stands for a drop of `from` at `to` (dropIndex's): at the
 *  left edge of tab `before` (an index in the strip as it is), or at the end
 *  (`before` null). A gap after a tab is drawn as the one before the next. */
export function stakeAt(count, from, to) {
  if (to == null) return null;
  const before = to < from ? to : to + 1;
  return { before: before >= count ? null : before };
}

/** The list with item `from` moved to index `to`. */
export function moved(list, from, to) {
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

// ---- drawn tabs: what the preview shows, as a tab (viewer.js, kinds.js)

/** What a file is as a tab: "look" (drawn only: pictures, PDFs, databases,
 *  fonts, clips), "either" (drawn or as text: tables, patches, SVG) or "text". */
export function tabKind(path) {
  const kind = kindOf(path);
  if (!kind) return "text";
  if (kind === "table" || kind === "diff" || /\.svg$/i.test(String(path))) return "either";
  return "look";
}

/** Whether a new tab of `path` starts drawn: always for "look" files; an
 *  "either" one when it was opened to be looked at (`look`: a files pane's
 *  open, a terminal's link) and no text view was asked for. */
export function startsDrawn(path, { look = false, view = null } = {}) {
  const k = tabKind(path);
  if (k === "look") return true;
  if (k === "either") return view === "preview" || (look && !["text", "split", "rendered"].includes(view));
  return false;
}

/** Where a request takes an open tab: `view` "preview" draws an "either"
 *  file, "text" / "split" / "rendered" show its text; a "look" file stays
 *  drawn; `look` alone (an open, not an edit) leaves an open tab as it is.
 *  -> true (drawn), false (text) or null (unchanged). */
export function drawnAfter(path, { view = null } = {}) {
  const k = tabKind(path);
  if (k === "look") return true;
  if (k === "text" || !view) return null;
  return view === "preview" ? true : ["text", "split", "rendered"].includes(view) ? false : null;
}

/** A drawn tab's keys (the keys overview lists them). */
export const LOOK_KEYS = [
  ["H L gt gT", "previous / next tab"], ["]b [b", "next / previous tab"], ["]B [B", "move the tab right / left"],
  ["j k J K", "scroll (tables, patches, a PDF's pages)"], ["e", "as text (a table, patch or SVG)"],
  ["p", "in the preview pane"], ["o", "the system's app"], ["y", "copy the path"], ["d", "close the tab"], ["?", "keys"],
];

const LOOK_ACTS = {
  H: "prev-tab", gT: "prev-tab", "[b": "prev-tab", L: "next-tab", gt: "next-tab", "]b": "next-tab",
  "]B": "move-tab-right", "[B": "move-tab-left",
  j: "down", J: "down", down: "down", pagedown: "down", space: "down", k: "up", K: "up", up: "up", pageup: "up",
  e: "text", p: "pane", o: "system", y: "copy", d: "close", "?": "keys",
};

/** A key on a drawn tab, after `pending` (g, ] or [ waiting for the next):
 *  -> { act, taken, pending }. Keys with cmd / ctrl / alt go on to the app. */
export function lookAction(pending, e) {
  const m = e?.modifiers ?? {}, key = String(e?.key ?? "");
  if (["shift", "control", "alt", "platform", "function", "capslock"].includes(key)) return { act: null, taken: false, pending };
  if (m.platform || m.control || m.alt) return { act: null, taken: false, pending: "" };
  if (key === "escape") return { act: null, taken: Boolean(pending), pending: "" };
  // The typed character (shift-h is H, a German ? is ?), else the key's name (down, space).
  const ch = typeof e?.key_char === "string" && e.key_char.length === 1 && e.key_char !== " " ? e.key_char : key.length === 1 ? (m.shift ? key.toUpperCase() : key) : key;
  if (!pending && (ch === "g" || ch === "]" || ch === "[")) return { act: null, taken: true, pending: ch };
  const act = LOOK_ACTS[(pending ?? "") + ch] ?? null;
  return { act, taken: Boolean(act) || Boolean(pending), pending: "" };
}

// ---- the tab's menu (a right-click on a tab, space b m, the tab-menu command)

/** The tab menu's entries for tab `index` of `count`: pop out (beside, or
 *  to a tab of its own), into the editor beside (`others`: another editor in
 *  the window's tab), move left / right, close, close the others. */
export function tabMenuItems({ count, index, others = false, scratch = false }) {
  return [
    ...(scratch ? [] : [{ key: "o", act: "pop-out", label: "Pop out into its own pane" }, { key: "t", act: "pop-out-tab", label: "Pop out into a new tab" }]),
    ...(others && !scratch ? [{ key: "i", act: "pop-in", label: "Move into the editor beside" }] : []),
    ...(index > 0 ? [{ key: "h", act: "move-left", label: "Move left" }] : []),
    ...(index < count - 1 ? [{ key: "l", act: "move-right", label: "Move right" }] : []),
    { key: "d", act: "close", label: "Close" },
    ...(count > 1 ? [{ key: "D", act: "close-others", label: "Close the others" }] : []),
  ];
}

/** A key in the tab menu: j k ↑ ↓ move (wrapping), enter / space run the
 *  marked entry, an entry's letter runs it, esc closes. -> { at, act, close } */
export function tabMenuKey(items, at, e) {
  const key = String(e?.key ?? ""), m = e?.modifiers ?? {};
  if (m.platform || m.control || m.alt) return { at, act: null, close: false, taken: false };
  const ch = typeof e?.key_char === "string" && e.key_char.length === 1 ? e.key_char : key.length === 1 ? (m.shift ? key.toUpperCase() : key) : key;
  const n = items.length;
  if (key === "escape") return { at, act: null, close: true, taken: true };
  if (key === "down" || ch === "j") return { at: (at + 1) % n, act: null, close: false, taken: true };
  if (key === "up" || ch === "k") return { at: (at + n - 1) % n, act: null, close: false, taken: true };
  if (key === "enter" || key === "space") return { at, act: items[at]?.act ?? null, close: true, taken: true };
  const hit = items.find((x) => x.key === ch);
  return hit ? { at, act: hit.act, close: true, taken: true } : { at, act: null, close: false, taken: true };
}

/** What a tab hands to the editor it goes to (popped out, or moved into
 *  another): its text when it has unsaved changes, what's on disk, the caret,
 *  the first line shown, its Markdown view, wrap, drawn. Undo stays behind:
 *  it lives in the editor it was typed in. */
export function handover(d, slot, now = Date.now()) {
  let caret = { line: 0, col: 0 }, top = 0;
  try { caret = d.editor?.cursor?.() ?? caret; } catch { /* the start */ }
  try { top = Number(d.editor?.top_line?.()) || 0; } catch { /* the top */ }
  return {
    slot, path: d.path, text: d.dirty ? d.editor.value() : null, saved: d.saved ?? null,
    caret, top, view: d.view ?? null, wrap: Boolean(d.softWrap), look: Boolean(d.look), at: now,
  };
}

/** A handover meant for this editor (`slot`) and file, fresh (10 s). */
export function handoverFor(h, slot, path, now = Date.now()) {
  return h && h.slot === slot && h.path === path && now - (h.at ?? 0) < 10000 ? h : null;
}
