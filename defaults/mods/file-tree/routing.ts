// Where a file this files pane opens goes (opening.ts uses it): each files
// pane (its slot) has an editor and a preview pane of its own in the shown
// tab, noted by slot in shared `file-tree.opened` { editor, preview }, each
// { slot } once known, else { path }: the file it was opened with (a pane
// the app made through editor.open / preview.open, whose slot comes later).
//
//   a preview file (state.ts isPreviewFile: a picture, a PDF, a clip, a
//   font, a database: what the preview draws and the editor doesn't edit)
//   goes to a preview pane, never the editor:
//     this pane's preview pane: it shows the file (shared `preview.show`);
//     else preview.open beside: the app shows it in a preview pane already
//     in the tab (the one that last had the keyboard, else the first) or
//     makes one; noted as this pane's by the file.
//   any other file (code, Markdown, a table) goes to the editor
//   (editor-route.ts), beside; the preview pane stays a preview.
// A pane closed by hand (or moved to another tab) is no longer this pane's.

import { Array as Arr, Option, Schema } from "effect";
import type { PaneInfo } from "herdr";
import { panes, run, shared, setShared } from "herdr";
import { mapOf, readShared, sharedKey, writeShared } from "@fireflies/kit";
import type { EditorView } from "@fireflies/editor-route";
import { EDITOR, editorProps, isScratchpad } from "@fireflies/editor-route";
import { keptFor } from "./tree.ts";
import type { default as Files } from "./main.ts";

export const PREVIEW = "preview";

/** One of this pane's own: its slot once known, else the file it opened with. */
export const MineSchema = Schema.Struct({ slot: Schema.optionalKey(Schema.String), path: Schema.optionalKey(Schema.String) });

export type Mine = typeof MineSchema.Type;

/** Each files pane's own editor and preview pane, by the files pane's slot. */
export const OpenedSchema = Schema.Struct({ editor: Schema.optionalKey(Schema.NullOr(MineSchema)), preview: Schema.optionalKey(Schema.NullOr(MineSchema)) });

export type Opened = typeof OpenedSchema.Type;

export const OPENED = sharedKey("file-tree.opened", mapOf(OpenedSchema));

/** A file for the preview pane whose slot it names (preview/main.ts shows it). */
export const ShowRequestSchema = Schema.Struct({ slot: Schema.String, path: Schema.String, n: Schema.Finite, at: Schema.optionalKey(Schema.Finite) });

export const SHOW_KEY = sharedKey("preview.show", Schema.NullOr(ShowRequestSchema));

/** The file each preview pane shows, by its slot (preview/viewer-load.ts titleOf). */
const SHOWN = sharedKey("preview.paths", mapOf(Schema.NullOr(Schema.String)));

/** This pane's own panes, as kept (a restart keeps them by its slot). */
export function openedOf(v: Files): Opened {
  return (v.slot !== null && v.slot !== "" ? readShared(shared, OPENED, new Map()).get(v.slot) : undefined) ?? {};
}

/** Notes this pane's own editor or preview pane (null: none now). */
export function noteMine(v: Files, which: "editor" | "preview", mine: Mine | null): void {
  if (v.slot === null || v.slot === "") return;

  const was = openedOf(v);
  const now: Opened = { editor: was.editor ?? null, preview: was.preview ?? null, [which]: mine };

  writeShared(setShared, OPENED, keptFor(v, readShared(shared, OPENED, new Map()), v.slot, now));
}

/** A pane that can be a files pane's own editor or preview pane: on this
 *  computer, not parked; an editor not popped out, not a scratchpad. A
 *  preview pane's props ({ path, on, slot }) read as an editor's do. */
function canBeMine(p: PaneInfo, which: "editor" | "preview"): boolean {
  if (p.mod !== (which === "editor" ? EDITOR : PREVIEW) || p.parked || (editorProps(p).on ?? null) !== null) return false;

  return which === "preview" || (editorProps(p).popped !== true && !isScratchpad(p));
}

/** A pane in the shown tab that is this pane's own (`which`); one
 *  found by its file (a preview pane: the file it shows now, the app may have
 *  sent it to one already there) takes its slot from now on. Popped editor
 *  tabs, parked panes and scratchpads aren't. */
function own(v: Files, which: "editor" | "preview"): PaneInfo | null {
  const mine = openedOf(v)[which];

  if ((mine === null || mine === undefined) || (v.on !== null && v.on !== "")) return null;

  const tab = v.shownTab() ?? null;
  const fit = Arr.filter(panes(), (p) => p.tab === tab && canBeMine(p, which));
  const slotOf = (p: PaneInfo): string | null => editorProps(p).slot ?? null;
  const fileOf = (p: PaneInfo): string | null => (which === "preview" ? previewFile(p) : editorProps(p).path ?? null);
  const found = mine.slot !== undefined && mine.slot !== "" ? Option.getOrUndefined(Arr.findFirst(fit, (p) => slotOf(p) === mine.slot)) : Option.getOrUndefined(Arr.findFirst(fit, (p) => fileOf(p) === mine.path));

  if (found !== undefined && (mine.slot === undefined || mine.slot === "")) {
    const slot = slotOf(found);

    if (slot !== null && slot !== "") noteMine(v, which, { slot });
  }

  return found ?? null;
}

/** This pane's editor in the shown tab, or null. */
export const ownEditor = (v: Files): PaneInfo | null => own(v, "editor");

/** This pane's preview pane in the shown tab, or null. */
export const ownPreview = (v: Files): PaneInfo | null => own(v, "preview");

/** The file a preview pane shows: as it noted (it steps through its folder), else its props'. */
export function previewFile(pane: PaneInfo): string | null {
  const slot = editorProps(pane).slot;
  const noted = slot !== undefined && slot !== "" ? readShared(shared, SHOWN, new Map()).get(slot) : undefined;

  return noted ?? editorProps(pane).path ?? null;
}

/** This pane's preview pane shows `abs` (it takes the keyboard). */
export function showInPreview(pane: PaneInfo, abs: string): void {
  const slot = editorProps(pane).slot;

  if ((slot !== undefined && slot !== "") && previewFile(pane) !== abs) {
    writeShared(setShared, SHOW_KEY, { slot, path: abs, n: (readShared(shared, SHOW_KEY, null)?.n ?? 0) + 1, at: Date.now() });
  }

  run("pane.focus", { pane: pane.pane });
}

/** How a file goes to the editor: drawn to look at, or Markdown's view. */
export interface EditorAsk {
  readonly look?: boolean;
  readonly view?: EditorView | null;
}
