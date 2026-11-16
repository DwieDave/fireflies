// @fireflies/editor-route: which editor pane takes a file, as tabs (editor's
// tabs). A library (docs/effect-mods.md): the app serves this one copy to
// editor, file-tree, finder and markdown by name (`import { openInEditor }
// from "@fireflies/editor-route"`).
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
//
// Its shapes are Schemas (`OpenRequestSchema`, …); the shared keys carry the
// schema (the kit's `readShared`) and a guard made from it (`guard`, `entry`:
// guard.ts's `readShared` in the mods not on the kit yet), so both read alike.

import { Array as Arr, DateTime, Option, Predicate, Record as Rec, Schema } from "effect";
import { readShared, writeShared } from "@fireflies/kit";
import type * as Herdr from "herdr";
import type { PaneInfo, SpaceInfo } from "herdr";

export const EDITOR = "editor";

/** How the editor draws a Markdown file: rendered, side by side, the preview pane's look, its text. */
export const EditorViewSchema = Schema.Literals(["rendered", "split", "preview", "text"]);

export type EditorView = typeof EditorViewSchema.Type;

export const isEditorView: (value: unknown) => value is EditorView = Schema.is(EditorViewSchema);

/** A file for the editor whose slot it names (null: the next new editor), shared `editor.open`. */
export const OpenRequestSchema = Schema.Struct({
  slot: Schema.NullOr(Schema.String),
  path: Schema.String,
  n: Schema.Finite,
  line: Schema.optionalKey(Schema.Finite),
  col: Schema.optionalKey(Schema.Finite),
  view: Schema.optionalKey(EditorViewSchema),
  look: Schema.optionalKey(Schema.Boolean),
  at: Schema.optionalKey(Schema.Finite),
});

export type OpenRequest = typeof OpenRequestSchema.Type;

export const isOpenRequest: (value: unknown) => value is OpenRequest = Schema.is(OpenRequestSchema);

/** A shared() key both ways: the kit's (`schema`) and guard.ts's (`guard`). */
const sharedKeyOf = <A, I>(name: string, schema: Schema.Codec<A, I>) => ({ name, schema, guard: Schema.is(schema) });

export const OPEN = "editor.open";
export const OPEN_KEY = sharedKeyOf(OPEN, Schema.NullOr(OpenRequestSchema));

/** The editor that last had the keyboard (its slot). */
export const LAST = "editor.last";
export const LAST_KEY = sharedKeyOf(LAST, Schema.NullOr(Schema.String));

/** One editor's files in `editor.paths`: a list, or (written before tabs) one path. */
const PathsEntrySchema = Schema.Union([Schema.Array(Schema.String), Schema.String]);

type PathsEntry = typeof PathsEntrySchema.Type;

const isPathsEntry = Schema.is(PathsEntrySchema);

/** Every editor's files by slot (its tabs), for the app's `editor.open` too: a list,
 *  or (written before tabs) one path. Keys are slots (data): each entry is read on
 *  its own, one in another shape left out (guard.ts's `readSharedMap` reads it so). */
export const PATHS = "editor.paths";
export const PATHS_KEY = { name: PATHS, entry: isPathsEntry };

/** A tab popped out into a pane of its own, or moved into another editor:
 *  { slot, path, text?, saved?, caret, top, view, wrap, look, at } for the
 *  editor whose slot it names (its text with unsaved changes, where it was). */
export const HANDOVER = "editor.handover";

/** The props of an editor pane that routing reads (the editor has more). */
export const EditorPropsSchema = Schema.Struct({
  slot: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  on: Schema.optionalKey(Schema.NullOr(Schema.String)),
  popped: Schema.optionalKey(Schema.Boolean),
});

export type EditorProps = typeof EditorPropsSchema.Type;

export const isEditorProps: (value: unknown) => value is EditorProps = Schema.is(EditorPropsSchema);

const decodeProps = Schema.decodeUnknownOption(EditorPropsSchema);

/** A pane's props as an editor's (none when they aren't). */
export const editorProps = (pane: PaneInfo): EditorProps => Option.getOrElse(decodeProps(pane.props), () => ({}));

/** Every editor's files by slot, as `editor.paths` has them (an entry in another shape left out). */
export function editorPaths(read: typeof Herdr.shared): ReadonlyMap<string, PathsEntry> {
  const value: unknown = read(PATHS);

  if (!Predicate.isObject(value)) return new Map();

  return new Map(Arr.filter(Rec.toEntries(value), (entry): entry is [string, PathsEntry] => isPathsEntry(entry[1])));
}

/** A scratchpad's editor (it opened on a note under the app's folder,
 *  `…/scratchpad/<name>-<hash>.md`, @fireflies/scratch): a pane of its
 *  own that other files don't go to. */
export function isScratchpad(pane: PaneInfo): boolean {
  return /\/scratchpad\/[^/]+-[0-9a-f]{8}\.md$/.test(editorProps(pane).path ?? "");
}

/** The files an editor pane holds: what it noted, else its props' file. */
export function filesOf(pane: PaneInfo, paths: ReadonlyMap<string, readonly string[] | string>): readonly string[] {
  const { slot, path } = editorProps(pane);
  const noted = slot === undefined ? undefined : paths.get(slot);

  if (noted !== undefined) return Predicate.isString(noted) ? [noted] : noted;

  return path === undefined || path === "" ? [] : [path];
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

/** The editors in tab `tab` on machine `on` that routing may use (not parked, not a scratchpad). */
function editorsIn(panes: readonly PaneInfo[], tab: string | null, on: string | null): Editor[] {
  return Arr.flatMap(panes, (pane): Editor[] => {
    const p = editorProps(pane);
    const slot = p.slot ?? "";

    return pane.mod === EDITOR && pane.tab === tab && !pane.parked && slot !== "" && (p.on ?? null) === on && !isScratchpad(pane)
      ? [{ pane, slot, popped: p.popped === true }]
      : [];
  });
}

/** The editor pane in tab `tab` that takes `path` (on machine `on`), or null.
 *  A tab popped into a pane of its own (props.popped) keeps its file there,
 *  but other files don't go to it. */
export function editorFor(query: EditorQuery): PaneInfo | null {
  const { panes, tab, path, on = null, focused = null, prefer = null, last = null, paths = new Map() } = query;
  const all = editorsIn(panes, tab, on);
  const holder = Arr.findFirst(all, (e) => Arr.contains(filesOf(e.pane, paths), path));

  if (Option.isSome(holder)) return holder.value.pane;

  const eds = Arr.filter(all, (e) => !e.popped);

  const chosen = Arr.findFirst(eds, (e) => e.slot === prefer).pipe(
    Option.orElse(() => Arr.findFirst(eds, (e) => e.pane.pane === focused)),
    Option.orElse(() => Arr.findFirst(eds, (e) => e.slot === last)),
    Option.orElse(() => Arr.head(eds)),
  );

  return Option.match(chosen, { onNone: () => null, onSome: (e) => e.pane });
}

/** The shown tab's id, from herdr's spaces(). */
export function shownTab(spaces: readonly SpaceInfo[]): string | null {
  return Arr.findFirst(spaces, (s) => s.active).pipe(
    Option.flatMap((s) => Arr.findFirst(s.tabs, (c) => c.active)),
    Option.match({ onNone: () => null, onSome: (c) => c.id }),
  );
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

/** A line to go to: a positive one (0 and none mean the file's top). */
const lineOf = (line: number | null): Option.Option<number> => (line !== null && line > 0 ? Option.some(line) : Option.none());

/** Opens `file.path` in the shown tab's editor as a tab, else in a new editor
 *  through `editor.open` beside `file.pane`. -> the editor pane it went to, or
 *  null (a new one). */
export function openInEditor(h: EditorHost, file: OpenFile): PaneInfo | null {
  const { path, line = null, col = null, on = null, pane = null, prefer = null, view = null, look = false } = file;
  const target = editorFor({ panes: h.panes(), tab: shownTab(h.spaces()), focused: h.focused()?.pane ?? null, prefer, last: readShared(h.shared, LAST_KEY, null), paths: editorPaths(h.shared), path, on });
  const n = (readShared(h.shared, OPEN_KEY, null)?.n ?? 0) + 1;
  const request: Writable<OpenRequest> = { slot: null, path, n, at: DateTime.toEpochMillis(DateTime.nowUnsafe()) };
  const at = lineOf(line);

  if (view !== null) request.view = view;

  if (look) request.look = true;

  if (target !== null) {
    request.slot = editorProps(target).slot ?? null;

    if (Option.isSome(at)) {
      request.line = at.value;
      request.col = col ?? 1;
    }

    writeShared(h.setShared, OPEN_KEY, request);
    h.run("pane.focus", { pane: target.pane });

    return target;
  }

  if (view !== null || look) writeShared(h.setShared, OPEN_KEY, request);

  const args: Writable<{ path: string; line?: number; col?: number; pane?: string; on?: string; look?: true }> = { path };

  if (Option.isSome(at)) {
    args.line = at.value;
    args.col = col ?? 1;
  }

  if (pane !== null && pane !== "") args.pane = pane;

  if (on !== null && on !== "") args.on = on;

  if (look) args.look = true;

  h.run("editor.open", args);

  return null;
}
