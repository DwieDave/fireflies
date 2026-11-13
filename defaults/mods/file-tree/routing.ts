// Where a file this files pane opens goes (opening.ts uses it): each files
// pane (its slot) has an editor and a preview pane of its own in the shown
// tab, noted by slot in shared `file-tree.opened` { editor, preview }, each
// { slot } once known, else { path }: the file it was opened with (a pane
// the app made through editor.open / preview.open, whose slot comes later).
//
//   a preview file (state.ts isPreviewFile: a picture, a PDF, a clip, a
//   font, a database: what the preview draws and the editor doesn't edit):
//     an editor in the shown tab holding it: that tab (no second copy);
//     else this pane's editor: a new tab of it, drawn;
//     else this pane's preview pane: it shows the file (shared `preview.show`);
//     else a new preview pane, noted as this pane's.
//   any other file (code, Markdown, a table) goes to the editor
//   (editor-route.ts); with no editor of this pane's but its preview pane
//   there, the editor takes the preview pane's place: the preview's file its
//   first tab (drawn), this one the second, shown; the preview pane goes.
// A pane closed by hand (or moved to another tab) is no longer this pane's.

import type { PaneInfo } from "herdr";
import { panes, run, shared, setShared } from "herdr";
import type { Guarded } from "./guard.ts";
import { isNumber, isString, nullable, object, readShared, readSharedMap, sharedKey, sharedMapKey, writeShared, writeSharedMap } from "./guard.ts";
import type { EditorView, OpenRequest } from "./editor-route.ts";
import { EDITOR, OPEN_KEY, editorPaths, editorProps, filesOf, isScratchpad } from "./editor-route.ts";
import { keptFor } from "./tree.ts";
import type { default as Files } from "./main.ts";

export const PREVIEW = "preview";

/** One of this pane's own: its slot once known, else the file it opened with. */
export const isMine = object({}, { slot: isString, path: isString });

export type Mine = Guarded<typeof isMine>;

/** Each files pane's own editor and preview pane, by the files pane's slot. */
export const isOpened = object({}, { editor: nullable(isMine), preview: nullable(isMine) });

export type Opened = Guarded<typeof isOpened>;

export const OPENED = sharedMapKey("file-tree.opened", isOpened);

/** A file for the preview pane whose slot it names (preview/main.ts shows it). */
export const isShowRequest = object({ slot: isString, path: isString, n: isNumber }, { at: isNumber });

export const SHOW_KEY = sharedKey("preview.show", nullable(isShowRequest));

/** The file each preview pane shows, by its slot (preview/viewer-load.ts titleOf). */
const SHOWN = sharedMapKey("preview.paths", nullable(isString));

/** A slot for an editor this pane makes itself (as editor/pane-tabs.ts newSlot). */
export const newEditorSlot = (): string => `ed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** This pane's own panes, as kept (a restart keeps them by its slot). */
export function openedOf(v: Files): Opened {
  return (v.slot ? readSharedMap(shared, OPENED).get(v.slot) : undefined) ?? {};
}

/** Notes this pane's own editor or preview pane (null: none now). */
export function noteMine(v: Files, which: "editor" | "preview", mine: Mine | null): void {
  if (!v.slot) return;

  const was = openedOf(v);
  const now: Opened = { editor: was.editor ?? null, preview: was.preview ?? null, [which]: mine };

  writeSharedMap(setShared, OPENED, keptFor(v, readSharedMap(shared, OPENED), v.slot, now));
}

/** A pane that can be a files pane's own editor or preview pane: on this
 *  computer, not parked; an editor not popped out, not a scratchpad. A
 *  preview pane's props ({ path, on, slot }) read as an editor's do. */
function canBeMine(p: PaneInfo, which: "editor" | "preview"): boolean {
  if (p.mod !== (which === "editor" ? EDITOR : PREVIEW) || p.parked || (editorProps(p).on ?? null) !== null) return false;

  return which === "preview" || (editorProps(p).popped !== true && !isScratchpad(p));
}

/** A pane in the shown tab that is this pane's own (`which`); one
 *  found by its file takes its slot from now on. Popped editor tabs, parked
 *  panes and scratchpads aren't. */
function own(v: Files, which: "editor" | "preview"): PaneInfo | null {
  const mine = openedOf(v)[which];

  if (!mine || v.on) return null;

  const tab = v.shownTab() ?? null;
  const fit = panes().filter((p) => p.tab === tab && canBeMine(p, which));
  const slotOf = (p: PaneInfo): string | null => editorProps(p).slot ?? null;
  const found = mine.slot ? fit.find((p) => slotOf(p) === mine.slot) : fit.find((p) => editorProps(p).path === mine.path);

  if (found && !mine.slot) {
    const slot = slotOf(found);

    if (slot) noteMine(v, which, { slot });
  }

  return found ?? null;
}

/** This pane's editor in the shown tab, or null. */
export const ownEditor = (v: Files): PaneInfo | null => own(v, "editor");

/** This pane's preview pane in the shown tab, or null. */
export const ownPreview = (v: Files): PaneInfo | null => own(v, "preview");

/** Whether an editor in the shown tab holds `abs` as a tab. */
export function heldInTab(v: Files, abs: string): boolean {
  const tab = v.shownTab() ?? null;
  const paths = editorPaths(shared);

  return panes().some((p) => p.mod === EDITOR && p.tab === tab && !p.parked && filesOf(p, paths).includes(abs));
}

/** The file a preview pane shows: as it noted (it steps through its folder), else its props'. */
export function previewFile(pane: PaneInfo): string | null {
  const slot = editorProps(pane).slot;
  const noted = slot ? readSharedMap(shared, SHOWN).get(slot) : undefined;

  return noted ?? editorProps(pane).path ?? null;
}

/** This pane's preview pane shows `abs` (it takes the keyboard). */
export function showInPreview(pane: PaneInfo, abs: string): void {
  const slot = editorProps(pane).slot;

  if (slot && previewFile(pane) !== abs) {
    writeShared(setShared, SHOW_KEY, { slot, path: abs, n: (readShared(shared, SHOW_KEY, null)?.n ?? 0) + 1, at: Date.now() });
  }

  run("pane.focus", { pane: pane.pane });
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** How a file goes to the editor: drawn to look at, or Markdown's view. */
export interface EditorAsk {
  readonly look?: boolean;
  readonly view?: EditorView | null;
}

/** The props of an editor this pane makes in its preview pane's place. */
interface NewEditorProps {
  path: string;
  slot: string;
  look?: true;
}

/** The editor in the preview pane's place: the preview's file its first tab
 *  (drawn), `abs` the second and shown (sent to the new editor's slot before
 *  it starts: editor/pane-start.ts opens it on its first frame); the preview
 *  pane goes. Noted as this pane's editor. */
export function editorForPreview(v: Files, preview: PaneInfo, abs: string, ask: EditorAsk): void {
  const slot = newEditorSlot();
  const first = previewFile(preview);

  const props: NewEditorProps = { path: abs, slot };

  if (first && first !== abs) {
    // `abs` waits for the new editor in shared editor.open, addressed to its slot.
    const request: Writable<OpenRequest> = { slot, path: abs, n: (readShared(shared, OPEN_KEY, null)?.n ?? 0) + 1, at: Date.now() };

    if (ask.look) request.look = true;

    if (ask.view) request.view = ask.view;

    writeShared(setShared, OPEN_KEY, request);
    props.path = first;
    props.look = true;
  } else if (ask.look) props.look = true;

  run("pane.split", { direction: "auto", pane: preview.pane, mod: EDITOR, props });
  run("pane.close", { pane: preview.pane });
  noteMine(v, "editor", { slot });
  noteMine(v, "preview", null);
}
