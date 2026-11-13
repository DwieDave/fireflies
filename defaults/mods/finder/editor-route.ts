// Which editor pane takes a file, as tabs (editor's tabs). The same
// file sits in editor, file-tree, finder and
// markdown (a mod can't import another's files);
// scripts/editor-tabs.test.ts fails when the copies differ: edit one,
// copy it to the others.
//
// An editor already showing the file in the shown tab shows it (its tab);
// a tab popped into a pane of its own takes no other files; else the editor the caller prefers (the one it sent files to before), the
// focused one, the one that last had the keyboard, the tab's first: the file
// opens there as a new tab (never in a scratchpad's pane), through shared `editor.open`
// { slot, path, line?, col?, view?, look?, n, at } (the editor whose slot it names
// opens it, n counts up). Every kind of file goes: a picture, a PDF, a table
// is drawn in its tab; `look` (opened to be looked at, not edited) starts a
// new tab drawn (Markdown takes the editor's view for it). With no editor in the shown
// tab, `editor.open` opens one beside the pane, as before; a `view` or `look`
// then waits for it in the same record with slot null.

import type * as Herdr from "herdr";
import type { PaneInfo, SpaceInfo } from "herdr";
import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, literal, nullable, object, oneOf, readShared, readSharedMap, sharedKey, sharedMapKey, writeShared } from "./guard.ts";

export const EDITOR = "editor";

/** How the editor draws a Markdown file: rendered, side by side, the preview pane's look, its text. */
export const isEditorView = literal("rendered", "split", "preview", "text");

export type EditorView = Guarded<typeof isEditorView>;

/** A file for the editor whose slot it names (null: the next new editor), shared `editor.open`. */
export const isOpenRequest = object(
  { slot: nullable(isString), path: isString, n: isNumber },
  { line: isNumber, col: isNumber, view: isEditorView, look: isBoolean, at: isNumber },
);

export type OpenRequest = Guarded<typeof isOpenRequest>;

export const OPEN = "editor.open";
export const OPEN_KEY = sharedKey(OPEN, nullable(isOpenRequest));

/** The editor that last had the keyboard (its slot). */
export const LAST = "editor.last";
export const LAST_KEY = sharedKey(LAST, nullable(isString));

/** Every editor's files by slot (its tabs), for the app's `editor.open` too: a list,
 *  or (written before tabs) one path. */
export const PATHS = "editor.paths";
export const PATHS_KEY = sharedMapKey(PATHS, oneOf(arrayOf(isString), isString));

/** A tab popped out into a pane of its own, or moved into another editor:
 *  { slot, path, text?, saved?, caret, top, view, wrap, look, at } for the
 *  editor whose slot it names (its text with unsaved changes, where it was). */
export const HANDOVER = "editor.handover";

/** The props of an editor pane that routing reads (the editor has more). */
export const isEditorProps = object({}, { slot: isString, path: isString, on: nullable(isString), popped: isBoolean });

export type EditorProps = Guarded<typeof isEditorProps>;

/** A pane's props as an editor's (none when they aren't). */
export const editorProps = (pane: PaneInfo): EditorProps => (isEditorProps(pane.props) ? pane.props : {});

/** Every editor's files by slot, as `editor.paths` has them. */
export const editorPaths = (read: typeof Herdr.shared): ReadonlyMap<string, readonly string[] | string> => readSharedMap(read, PATHS_KEY);

/** A scratchpad's editor (it opened on a note under the app's folder,
 *  `…/scratchpad/<name>-<hash>.md`, editor/scratch.ts): a pane of its
 *  own that other files don't go to. */
export function isScratchpad(pane: PaneInfo): boolean {
  return /\/scratchpad\/[^/]+-[0-9a-f]{8}\.md$/.test(editorProps(pane).path ?? "");
}

/** The files an editor pane holds: what it noted, else its props' file. */
export function filesOf(pane: PaneInfo, paths: ReadonlyMap<string, readonly string[] | string>): readonly string[] {
  const { slot, path } = editorProps(pane);
  const noted = slot === undefined ? undefined : paths.get(slot);

  if (noted !== undefined) return isString(noted) ? [noted] : noted;

  return path ? [path] : [];
}

/** What editorFor looks at: herdr's panes(), the tab, the file and the machine;
 *  the focused pane, a slot the caller sent files to, shared LAST and PATHS. */
export interface EditorQuery {
  readonly panes: readonly PaneInfo[];
  readonly tab: string | null;
  readonly path: string;
  readonly on?: string | null;
  readonly focused?: string | null;
  readonly prefer?: string | null;
  readonly last?: string | null;
  readonly paths?: ReadonlyMap<string, readonly string[] | string>;
}

/** An editor pane with the slot routing found on it. */
interface Editor {
  readonly pane: PaneInfo;
  readonly slot: string;
  readonly popped: boolean;
}

/** The editor pane in tab `tab` that takes `path` (on machine `on`), or null.
 *  A tab popped into a pane of its own (props.popped) keeps its file there,
 *  but other files don't go to it. */
export function editorFor(query: EditorQuery): PaneInfo | null {
  const { panes, tab, path, on = null, focused = null, prefer = null, last = null, paths = new Map() } = query;

  const all = panes.flatMap((pane): Editor[] => {
    const p = editorProps(pane);

    return pane.mod === EDITOR && pane.tab === tab && !pane.parked && p.slot && (p.on ?? null) === on && !isScratchpad(pane)
      ? [{ pane, slot: p.slot, popped: p.popped === true }]
      : [];
  });

  const holder = all.find((e) => filesOf(e.pane, paths).includes(path));

  if (holder) return holder.pane;

  const eds = all.filter((e) => !e.popped);
  const chosen = eds.find((e) => e.slot === prefer) ?? eds.find((e) => e.pane.pane === focused) ?? eds.find((e) => e.slot === last) ?? eds[0];

  return chosen?.pane ?? null;
}

/** The shown tab's id, from herdr's spaces(). */
export function shownTab(spaces: readonly SpaceInfo[]): string | null {
  return spaces.find((s) => s.active)?.tabs.find((c) => c.active)?.id ?? null;
}

/** What herdr calls openInEditor makes (herdr itself, or a test's stand-in). */
export type EditorHost = Pick<typeof Herdr, "run" | "panes" | "spaces" | "focused" | "shared" | "setShared">;

/** A file to open: where (line, col), beside which pane when a new editor opens,
 *  on which machine, the editor the caller sent files to, how a Markdown file
 *  is drawn, and whether it's opened to be looked at. */
export interface OpenFile {
  readonly path: string;
  readonly line?: number | null;
  readonly col?: number | null;
  readonly on?: string | null;
  readonly pane?: string | null;
  readonly prefer?: string | null;
  readonly view?: EditorView | null;
  readonly look?: boolean;
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** Opens `file.path` in the shown tab's editor as a tab, else in a new editor
 *  through `editor.open` beside `file.pane`. -> the editor pane it went to, or
 *  null (a new one). */
export function openInEditor(h: EditorHost, file: OpenFile): PaneInfo | null {
  const { path, line = null, col = null, on = null, pane = null, prefer = null, view = null, look = false } = file;
  const target = editorFor({ panes: h.panes(), tab: shownTab(h.spaces()), focused: h.focused()?.pane ?? null, prefer, last: readShared(h.shared, LAST_KEY, null), paths: editorPaths(h.shared), path, on });
  const request: Writable<OpenRequest> = { slot: null, path, n: (readShared(h.shared, OPEN_KEY, null)?.n ?? 0) + 1, at: Date.now() };

  if (view) request.view = view;

  if (look) request.look = true;

  if (target) {
    request.slot = editorProps(target).slot ?? null;

    if (line) {
      request.line = line;
      request.col = col ?? 1;
    }

    writeShared(h.setShared, OPEN_KEY, request);
    h.run("pane.focus", { pane: target.pane });

    return target;
  }

  if (view || look) writeShared(h.setShared, OPEN_KEY, request);

  const args: Writable<{ path: string; line?: number; col?: number; pane?: string; on?: string; look?: true }> = { path };

  if (line) {
    args.line = line;
    args.col = col ?? 1;
  }

  if (pane) args.pane = pane;

  if (on) args.on = on;

  if (look) args.look = true;

  h.run("editor.open", args);

  return null;
}
