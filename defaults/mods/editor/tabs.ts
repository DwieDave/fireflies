// The editor's file tabs, as data: no app calls, so scripts/editor-tabs.test.ts
// drives them. A pane holds several files (main.ts keeps one record per file:
// its text, undo, caret, scroll, unsaved changes, server document); these
// decide where a new tab goes, which one shows after a close, what comes back
// after a restart, what closing the pane asks, the names on the strip and
// which of them fit, whether the strip shows (from two tabs on), where a
// dragged tab lands, and whether a tab is text or drawn (the preview's
// viewer: a picture, a PDF, a table).

import type { KeyEvent } from "gpui-kit";
import type { EditorPosition, EditorState } from "gpui-base";
import type { Guarded } from "./guard.ts";
import { isBoolean, isNumber, isString, nullable, object, sharedKey } from "./guard.ts";
import type { EditorView } from "./editor-route.ts";
import { HANDOVER, isEditorView } from "./editor-route.ts";
import { isList } from "./guards.ts";
import type { KeyRow } from "./keyhelp.ts";
import { ICON_SIZE } from "./file-icons.ts";
import { kindOf } from "./kinds.ts";
import { basename, dirname } from "./logic.ts";

/** Where a file goes among the tabs: its index, and whether it's a new tab. */
export interface Placed {
  readonly index: number;
  readonly added: boolean;
}

/** Where a file opened in the pane goes: the index of its tab when it is
 *  open already, else a new tab right after the shown one. -> { index, added } */
export function placeTab(paths: readonly string[], active: number, path: string): Placed {
  const at = paths.indexOf(path);

  if (at >= 0) return { index: at, added: false };

  return { index: Math.min(paths.length, Math.max(0, active + 1)), added: true };
}

/** The tab shown after closing tab `index` of `count`: the next one, else the
 *  one before (null: none left). `active`: the one shown before the close. */
export function afterClose(count: number, active: number, index: number): number | null {
  if (count <= 1) return null;

  if (index !== active) return active > index ? active - 1 : active;

  return index < count - 1 ? index : index - 1;
}

/** The next (d 1) or previous (d -1) tab, wrapping. */
export function stepTab(count: number, active: number, d: number): number {
  if (count <= 0) return 0;

  return (((active + d) % count) + count) % count;
}

/** What the pane opens with: its tabs as kept (localStorage `tabs`), else the
 *  props' file (where the files pane moved it, localStorage `moved`), and
 *  which one shows. Files the props ask for that aren't kept get a tab. */
export function restoreTabs(kept: KeptTabsNote | null | undefined, path: string | null | undefined, moved: MovedNote | null | undefined): KeptTabs {
  let first = path ?? "";

  if (moved?.from === first && moved.to) first = moved.to;

  // The paths one by one: a name that isn't a file's is left out.
  const list = (kept?.paths ?? []).filter((p): p is string => isString(p) && p !== "");

  if (!list.length) return { paths: [first], active: 0 };

  const unique = [...new Set(list)];
  const shown = kept?.active;
  const active = Math.max(0, Math.min(unique.length - 1, shown !== undefined && Number.isInteger(shown) ? shown : 0));

  return { paths: unique, active };
}

/** The tabs a pane keeps (localStorage `tabs`): the files in order and the one shown. */
export interface KeptTabs {
  readonly paths: readonly string[];
  readonly active: number;
}

/** localStorage `tabs` as read back (this mod wrote it, maybe an older version): its
 *  paths are read one by one (restoreTabs). */
export const isKeptTabsNote = object({}, { paths: isList, active: isNumber });

export type KeptTabsNote = Guarded<typeof isKeptTabsNote>;

/** localStorage `moved`: the files pane moved this pane's file from `from` to `to`. */
export const isMovedNote = object({}, { from: isString, to: isString });

export type MovedNote = Guarded<typeof isMovedNote>;

/** What localStorage keeps: the files in order and the one shown. */
export function keptTabs(paths: readonly string[], active: number): KeptTabs {
  return { paths: [...paths], active };
}

/** A tab as closing the pane asks about it. */
export interface UnsavedDoc {
  readonly path: string;
  readonly dirty?: boolean;
  readonly deleted?: boolean;
}

/** The note closing the pane shows (setUnsaved), once for every file with
 *  unsaved changes: `docs` [{ path, dirty, deleted }]; null when none. */
export function unsavedNote(docs: readonly UnsavedDoc[]): string | null {
  const dirty = docs.filter((d) => d.dirty);
  const [only] = dirty;

  if (!only) return null;

  if (dirty.length === 1) return `${basename(only.path)}: ${only.deleted ? "deleted, unsaved" : "unsaved changes"}`;

  const names = dirty.map((d) => basename(d.path));

  return `${dirty.length} files with unsaved changes: ${names.slice(0, 4).join(", ")}${names.length > 4 ? ", …" : ""}`;
}

/** Each tab's label: the file's name, and for names two tabs share, the
 *  folder that tells them apart (its last part). -> [{ name, hint }] */
export function tabLabels(paths: readonly string[]): TabLabel[] {
  const names = paths.map((p) => basename(p) || "untitled");

  return paths.map((p, i) => {
    const name = names[i] ?? "untitled";
    const same = paths.filter((_q, j) => j !== i && names[j] === name);

    if (!same.length) return { name, hint: null };

    // The shortest tail of the folder that no twin shares.
    const parts = dirname(p).split("/").filter(Boolean);

    for (let n = 1; n <= parts.length; n++) {
      const tail = parts.slice(-n).join("/");

      if (same.every((q) => dirname(q).split("/").filter(Boolean).slice(-n).join("/") !== tail)) return { name, hint: tail };
    }

    return { name, hint: parts.slice(-1)[0] ?? "/" };
  });
}

/** A tab's label: the file's name, and the folder that tells twins apart. */
export interface TabLabel {
  readonly name: string;
  readonly hint: string | null;
}

/** A tab's width on the strip (px, unzoomed): its padding, the unsaved mark,
 *  the file's type mark (file-icons.ts), the name (cut at MAX_NAME), the
 *  folder hint and the close box. */
export const TAB_PAD = 10;

export const MAX_NAME = 26;

export const CHAR_W = 6.6;

export function tabWidth(label: TabLabel): number {
  const chars = Math.min(label.name.length, MAX_NAME) + (label.hint ? Math.min(label.hint.length, 18) + 3 : 0);

  return Math.round(TAB_PAD * 2 + 8 + 6 + ICON_SIZE + 6 + chars * CHAR_W + 6 + 14);
}

/** Which tabs fit in `room` px with the shown one among them: [from, to)
 *  and how many are left out on each side (the strip's ‹ n and n › marks
 *  take MORE px each). */
export const MORE = 30;

/** The tabs on the strip: [from, to), and how many are left out before and after. */
export interface Visible {
  readonly from: number;
  readonly to: number;
  readonly before: number;
  readonly after: number;
}

export function visibleTabs(widths: readonly number[], active: number, room: number): Visible {
  const n = widths.length;

  if (!n) return { from: 0, to: 0, before: 0, after: 0 };

  const total = widths.reduce((a, b) => a + b, 0);

  if (total <= room) return { from: 0, to: n, before: 0, after: 0 };

  const width = (i: number): number => widths[i] ?? 0;
  let from = Math.max(0, Math.min(active, n - 1));
  let to = from + 1;
  let used = width(from);
  const fits = (w: number, f: number, t: number): boolean => used + w + (f > 0 ? MORE : 0) + (t < n ? MORE : 0) <= room;

  // Grow to the right first (the tabs after the shown one), then to the left.
  for (;;) {
    if (to < n && fits(width(to), from, to + 1)) {
      used += width(to);
      to++;
      continue;
    }

    if (from > 0 && fits(width(from - 1), from - 1, to)) {
      from--;
      used += width(from);
      continue;
    }

    break;
  }

  return { from, to, before: from, after: n - to };
}

/** The strip shows from two tabs on: one file's name and unsaved mark are the bar's. */
export const showStrip = (count: number): boolean => count > 1;

// ---- moving a tab (a drag along the strip, ]B / [B, cmd-k < / >)

/** How far (px) a press moves before it's a drag rather than a click. */
export const DRAG_START = 4;

/** The gap the pointer is over in tab `index`: before it, or after it (its
 *  right half). `x`, `width`: the pointer's place in the tab, its width. */
export function gapAt(index: number, x: number, width: number): Gap {
  return { index, after: x >= width / 2 };
}

/** A gap between tabs: before tab `index` or after it; `index` null: past the last tab. */
export interface Gap {
  readonly index: number | null;
  readonly after?: boolean;
}

/** Where tab `from` of `count` ends up dropped into `gap` ({ index, after },
 *  or { index: null } the strip past the last tab): its new index, or null
 *  when the drop leaves it where it is (over itself or its own gaps). */
export function dropIndex(count: number, from: number, gap: Gap | null | undefined): number | null {
  if (!gap || from < 0 || from >= count) return null;

  let at: number;

  if (gap.index === null) at = count - 1;
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
export function stakeAt(count: number, from: number, to: number | null | undefined): { readonly before: number | null } | null {
  if (to === null || to === undefined) return null;

  const before = to < from ? to : to + 1;

  return { before: before >= count ? null : before };
}

/** The list with item `from` moved to index `to`. */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  const taken = out.splice(from, 1);

  out.splice(to, 0, ...taken);

  return out;
}

// ---- drawn tabs: what the preview shows, as a tab (viewer.ts, kinds.ts)

/** What a file is as a tab: "look" (drawn only: pictures, PDFs, databases,
 *  fonts, clips), "either" (drawn or as text: tables, patches, SVG) or "text". */
export function tabKind(path: string): TabKind {
  const kind = kindOf(path);

  if (!kind) return "text";

  if (kind === "table" || kind === "diff" || /\.svg$/i.test(path)) return "either";

  return "look";
}

/** What a file is as a tab (tabKind). */
export type TabKind = "look" | "either" | "text";

/** How a request asks for a file: opened to be looked at, and the view asked for. */
export interface Asked {
  readonly look?: boolean;
  readonly view?: EditorView | null;
}

/** A view that shows the text. */
const isTextView = (view: EditorView | null): boolean => view === "text" || view === "split" || view === "rendered";

/** Whether a new tab of `path` starts drawn: always for "look" files; an
 *  "either" one when it was opened to be looked at (`look`: a files pane's
 *  open, a terminal's link) and no text view was asked for. */
export function startsDrawn(path: string, { look = false, view = null }: Asked = {}): boolean {
  const k = tabKind(path);

  if (k === "look") return true;

  if (k === "either") return view === "preview" || (look && !isTextView(view));

  return false;
}

/** Where a request takes an open tab: `view` "preview" draws an "either"
 *  file, "text" / "split" / "rendered" show its text; a "look" file stays
 *  drawn; `look` alone (an open, not an edit) leaves an open tab as it is.
 *  -> true (drawn), false (text) or null (unchanged). */
export function drawnAfter(path: string, { view = null }: Asked = {}): boolean | null {
  const k = tabKind(path);

  if (k === "look") return true;

  if (k === "text" || !view) return null;

  return view === "preview" ? true : isTextView(view) ? false : null;
}

/** A drawn tab's keys (the keys overview lists them). */
export const LOOK_KEYS: readonly KeyRow[] = [
  ["H L gt gT", "previous / next tab"], ["]b [b", "next / previous tab"], ["]B [B", "move the tab right / left"],
  ["j k J K", "scroll (tables, patches, a PDF's pages)"], ["e", "as text (a table, patch or SVG)"],
  ["p", "in the preview pane"], ["o", "the system's app"], ["y", "copy the path"], ["d", "close the tab"], ["?", "keys"],
];

/** What a key on a drawn tab does. */
export type LookAct = "prev-tab" | "next-tab" | "move-tab-right" | "move-tab-left" | "down" | "up" | "text" | "pane" | "system" | "copy" | "close" | "keys";

/** The keys (typed, a pending prefix included) and what they do. */
const LOOK_ACTS: ReadonlyMap<string, LookAct> = new Map<string, LookAct>([
  ["H", "prev-tab"], ["gT", "prev-tab"], ["[b", "prev-tab"], ["L", "next-tab"], ["gt", "next-tab"], ["]b", "next-tab"],
  ["]B", "move-tab-right"], ["[B", "move-tab-left"],
  ["j", "down"], ["J", "down"], ["down", "down"], ["pagedown", "down"], ["space", "down"], ["k", "up"], ["K", "up"], ["up", "up"], ["pageup", "up"],
  ["e", "text"], ["p", "pane"], ["o", "system"], ["y", "copy"], ["d", "close"], ["?", "keys"],
]);

/** What a key on a drawn tab came to: what to do, whether it's taken, what waits for the next key. */
export interface LookKey {
  readonly act: LookAct | null;
  readonly taken: boolean;
  readonly pending: string;
}

/** The character a key types (shift-h is H, a German ? is ?), else the key's name (down, space). */
function typed(e: KeyEvent, space: boolean): string {
  const key = e.key;
  const ch = e.key_char;

  if (isString(ch) && ch.length === 1 && (space || ch !== " ")) return ch;

  return key.length === 1 ? (e.modifiers.shift ? key.toUpperCase() : key) : key;
}

/** A key on a drawn tab, after `pending` (g, ] or [ waiting for the next):
 *  -> { act, taken, pending }. Keys with cmd / ctrl / alt go on to the app. */
export function lookAction(pending: string, e: KeyEvent): LookKey {
  const m = e.modifiers;
  const key = e.key;

  if (["shift", "control", "alt", "platform", "function", "capslock"].includes(key)) return { act: null, taken: false, pending };

  if (m.platform || m.control || m.alt) return { act: null, taken: false, pending: "" };

  if (key === "escape") return { act: null, taken: Boolean(pending), pending: "" };

  // The typed character (shift-h is H, a German ? is ?), else the key's name (down, space).
  const ch = typed(e, false);

  if (!pending && (ch === "g" || ch === "]" || ch === "[")) return { act: null, taken: true, pending: ch };

  const act = LOOK_ACTS.get(pending + ch) ?? null;

  return { act, taken: Boolean(act) || Boolean(pending), pending: "" };
}

// ---- the tab's menu (a right-click on a tab, space b m, the tab-menu command)

/** What the tab menu does. */
export type MenuAct = "pop-out" | "pop-out-tab" | "pop-in" | "move-left" | "move-right" | "close" | "close-others";

/** An entry of the tab menu: its letter, what it does, its words. */
export interface MenuItem {
  readonly key: string;
  readonly act: MenuAct;
  readonly label: string;
}

/** The tab a menu is for: how many tabs, its index, another editor beside, a scratchpad's. */
export interface MenuFor {
  readonly count: number;
  readonly index: number;
  readonly others?: boolean;
  readonly scratch?: boolean;
}

/** What a key in the tab menu came to: the marked entry, what to run, whether it closes. */
export interface MenuKey {
  readonly at: number;
  readonly act: MenuAct | null;
  readonly close: boolean;
  readonly taken: boolean;
}

/** The tab menu's entries for tab `index` of `count`: pop out (beside, or
 *  to a tab of its own), into the editor beside (`others`: another editor in
 *  the window's tab), move left / right, close, close the others. */
export function tabMenuItems({ count, index, others = false, scratch = false }: MenuFor): MenuItem[] {
  const item = (key: string, act: MenuAct, label: string): MenuItem => ({ key, act, label });

  return [
    ...(scratch ? [] : [item("o", "pop-out", "Pop out into its own pane"), item("t", "pop-out-tab", "Pop out into a new tab")]),
    ...(others && !scratch ? [item("i", "pop-in", "Move into the editor beside")] : []),
    ...(index > 0 ? [item("h", "move-left", "Move left")] : []),
    ...(index < count - 1 ? [item("l", "move-right", "Move right")] : []),
    item("d", "close", "Close"),
    ...(count > 1 ? [item("D", "close-others", "Close the others")] : []),
  ];
}

/** A key in the tab menu: j k ↑ ↓ move (wrapping), enter / space run the
 *  marked entry, an entry's letter runs it, esc closes. -> { at, act, close } */
export function tabMenuKey(items: readonly MenuItem[], at: number, e: KeyEvent): MenuKey {
  const key = e.key;
  const m = e.modifiers;

  if (m.platform || m.control || m.alt) return { at, act: null, close: false, taken: false };

  const ch = typed(e, true);
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
export function handover(d: HandoverFrom, slot: string, now = Date.now()): Handover {
  let caret: EditorPosition = { line: 0, col: 0 };
  let top = 0;

  try {
    caret = d.editor?.cursor() ?? caret;
  } catch {
    /* the start */
  }

  try {
    top = Number(d.editor?.top_line()) || 0;
  } catch {
    /* the top */
  }

  return {
    slot,
    path: d.path,
    text: d.dirty ? (d.editor?.value() ?? null) : null,
    saved: d.saved ?? null,
    caret,
    top,
    view: d.view ?? null,
    wrap: Boolean(d.softWrap),
    look: Boolean(d.look),
    at: now,
  };
}

/** The tab being handed over: its file, its editor, unsaved changes, what's on disk, its view. */
export interface HandoverFrom {
  readonly path: string;
  readonly editor?: Pick<EditorState, "cursor" | "top_line" | "value"> | null;
  readonly dirty?: boolean;
  readonly saved?: string | null;
  readonly view?: EditorView | null;
  readonly softWrap?: boolean;
  readonly look?: boolean;
}

/** Shared `editor.handover`: a tab on its way to the editor whose slot it names (this mod's
 *  copies write and read it). */
export const isHandover = object({
  slot: isString,
  path: isString,
  text: nullable(isString),
  saved: nullable(isString),
  caret: object({ line: isNumber, col: isNumber }),
  top: isNumber,
  view: nullable(isEditorView),
  wrap: isBoolean,
  look: isBoolean,
  at: isNumber,
});

export type Handover = Guarded<typeof isHandover>;

export const HANDOVER_KEY = sharedKey(HANDOVER, nullable(isHandover));

/** A handover meant for this editor (`slot`) and file, fresh (10 s). */
export function handoverFor(h: Handover | null | undefined, slot: string | null | undefined, path: string | null | undefined, now = Date.now()): Handover | null {
  return h && h.slot === slot && h.path === path && now - h.at < 10000 ? h : null;
}
