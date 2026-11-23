// The files pane's state: its sizes and limits, what it's opened with (props),
// its shared records (filters, titles, the cut, the preview split, the changes
// editors follow), the app's viewers by kind of file, a folder's listing, and
// the shapes the pane holds (the name row, the delete question, the menu, a
// drag, the preview's target). main.ts's Files holds these fields.

import { Array as Arr, Option, Schema, String as Str } from "effect";
import type * as herdr from "herdr";
import { exec, home, appHome } from "herdr";
import { listOf, mapOf, sharedKey } from "@fireflies/kit";
import type { MenuItem, Row } from "./logic.ts";
import { ClipSchema, FileChangeSchema, FiltersSchema } from "./logic.ts";
import type { At, Entry, Side } from "./split-size.ts";
import type { Anchor } from "@fireflies/menu-place";
import type { NewKind } from "./fit.ts";
import { LookEntrySchema } from "./split-size.ts";

export const ROW = 22;
export const PER_FOLDER = 500;
export const TOTAL = 5000;
export const EDIT = "nocturne-edit";

/** The editor wrapper: the one this mod ships, here; another machine's own. */
export const editTool = (on: string | null): string => (on !== null && on !== "" ? EDIT : `${appHome()}/mods/file-tree/bin/${EDIT}`);

/** The app's viewer pane for a kind of file: the command that opens one there, and what the
 *  other way (alt-double-click, `e`) does instead. */
export interface ViewerKind {
  readonly test: RegExp;
  readonly open: "markdown.open" | "preview.open";
  readonly other: "edit" | "system";
}

/** Files the app has a viewer for, by type: the command that opens one there,
 *  and what the other way (alt-double-click, `e`) does instead. */
export const VIEWERS: readonly ViewerKind[] = [
  { test: /\.(md|markdown)$/i, open: "markdown.open", other: "edit" },
  // The preview (preview/kinds.ts KINDS); tables and patches are text: e edits them.
  { test: /\.(csv|tsv|diff|patch)$/i, open: "preview.open", other: "edit" },
  { test: /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|svg|avif|hei[cf]|pdf|sqlite3?|db3?|ttf|otf|ttc|woff2?|mp4|m4v|mov|mp3|m4a|aac|wav|aiff?|flac|caf)$/i, open: "preview.open", other: "system" },
];

export const viewerFor = (name: string): ViewerKind | null => Option.getOrUndefined(Arr.findFirst(VIEWERS, (v) => v.test.test(name))) ?? null;

/** A preview file: one the preview draws and the editor doesn't edit (a
 *  picture, SVG too, a PDF, a database, a font, a clip): from the files pane
 *  it opens in the preview pane unless the pane's editor is there (routing.ts). */
export const isPreviewFile = (name: string): boolean => viewerFor(name)?.other === "system";

/** Markdown files open in the viewer (markdown.open), not the editor. */
export const isMarkdown = (name: string): boolean => viewerFor(name)?.open === "markdown.open";

export const isEdit = (argv0: string | undefined): boolean => argv0 === EDIT || Boolean(argv0?.endsWith(`/${EDIT}`));

export const ART = "mods/nocturne/art";
export const MOD = "file-tree";
export const ICONS = "mods/workspace-chrome";

/** What a pane is opened with: the panel { folder, on, slot } (nocturne/files.ts), a pane of
 *  its own { path, on, slot } (files.open, a folder link). */
const optionalText = Schema.optionalKey(Schema.NullOr(Schema.String));

export const FilesPropsSchema = Schema.Struct({ folder: optionalText, path: optionalText, on: optionalText, slot: optionalText });

export const isFilesProps = Schema.is(FilesPropsSchema);

export type FilesProps = typeof FilesPropsSchema.Type;

/** A mod pane's slot. */
export const isSlotted = Schema.is(Schema.Struct({ slot: Schema.String }));

/** A panel's props: a pane of its own has a path. */
export const isAlone = Schema.is(Schema.Struct({ path: Schema.String }));

/** A terminal of herdr-core's listing, the fields `editorPane` reads. */
export const isTerminal = Schema.is(Schema.Struct({ address: Schema.String, argv: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))) }));

/** Each pane's filters by slot (users' state: kept across restarts). */
export const FILTERS = sharedKey(`${MOD}.filters`, mapOf(FiltersSchema));

/** What a pane of its own shows, for its header (the folder's name) and the app (files.open). */
export const TITLES = sharedKey(`${MOD}.titles`, mapOf(Schema.String));

export const PATHS = sharedKey(`${MOD}.paths`, mapOf(Schema.String));

/** The pane the keyboard came from into the panel (set by nocturne/files.ts). */
export const FROM = sharedKey(`${MOD}.from`, Schema.NullOr(Schema.String));

/** What `x` cut, for `P` in any files pane: { on, items: [{ abs, dir, name }] }. */
export const CUT = sharedKey(`${MOD}.cut`, Schema.NullOr(ClipSchema));

/** Each pane's preview split by slot: { on, right, bottom } (logic.ts newLook). */
export const LOOK = sharedKey(`${MOD}.look`, mapOf(LookEntrySchema));

/** Renames, moves and deletes done here, for the editors to follow (logic.ts withChanges). */
export const CHANGES = sharedKey("nocturne.files.changes", listOf(FileChangeSchema));

/** How long the selection rests before the preview loads it (ms): stepping through doesn't. */
export const REST = 90;

/** The viewer's native views (preview/viewer.ts nativeId): set aside under a menu, dropped with the split. */
export const NATIVE_IDS = ["preview-pdf", "preview-media", "preview-quicklook"];

/** The list's key for the new file's or folder's input row. */
export const DRAFT = "\u0000draft";
export const HITS = 200;
export const MENU_ROW = 20;

/** Two clicks on a row this close (ms) are a double click. */
export const DOUBLE = 400;

/** A press that moves this far (px) is a drag; a folder under a drag unfolds
 *  after resting this long (ms); this close to the list's edge it scrolls. */
export const SLOP = 4;
export const UNFOLD = 700;
export const EDGE = 18;

export const tilde = (p: string | null): string => {
  const h = home();

  return p === null || p === "" ? "" : p === h ? "~" : Str.startsWith(`${h}/`)(p) ? `~${Str.slice(h.length)(p)}` : p;
};

/** A folder's entries, folders first, capped at PER_FOLDER (+1 to tell it was cut). */
export async function directory(path: string, on: string | null): Promise<Entry[]> {
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "files", path], { on });

  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");

  const fields = Str.split(r.stdout, "\0");
  const out: Entry[] = [];

  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1] ?? "", dir: fields[i] === "d" });

  return out;
}

export const byName = (a: Entry, b: Entry): number => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name);

/** A caught error's message. */
export const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** The name input's row: a new file or folder in `dir` (after the row `after`), or a rename of `path`. */
export type Draft = { readonly kind: NewKind; readonly dir: string; readonly after: string | null; busy: boolean; shown: boolean }
  | { readonly kind: "rename"; readonly path: string; readonly dir: boolean; readonly name: string; busy: boolean; shown: boolean };

/** An item a delete asks about. */
export interface AskItem {
  readonly path: string;
  readonly dir: boolean;
  readonly name: string;
}

/** The delete question: one item, or a set; `trash` the machine's trash tool ("": permanently). */
export type Ask = (AskItem & { readonly trash: string; readonly set?: undefined }) | { readonly set: readonly AskItem[]; readonly trash: string };

/** The right-click menu: its row, entries, where it opened, the entry the keys are on. */
export interface Menu {
  readonly row: Row;
  readonly items: readonly MenuItem[];
  /** The press (pane px), the row a key opened it for, or null (the middle): menu-place.ts. */
  readonly at: Anchor;
  n: number;
}

/** A line in the hint line (an error in red; `draft`: about the name input). */
export interface Msg {
  readonly text: string;
  readonly error: boolean;
  readonly draft: boolean;
  readonly at: number;
}

/** How a line is said. */
export interface SayHow {
  readonly error?: boolean;
  readonly draft?: boolean;
}

/** Rows being marked as the keyboard moves (V, shift-↑↓): from `anchor`, the marks before kept. */
export interface MarkRange {
  readonly anchor: string;
  readonly base: ReadonlySet<string>;
  readonly shift: boolean;
}

/** Rows being dragged: where to (`into`, relative; null: nowhere), whether a drop there is
 *  allowed (else `why`), the pointer, what a drop would really move. */
export interface Drag {
  readonly paths: readonly string[];
  into: string | null;
  ok: boolean;
  why: string | null;
  at: At;
  moving: readonly string[];
}

/** A row pressed, before it moves far enough to be a drag. */
export interface Press {
  readonly path: string;
  readonly at: At;
}

/** A folder in the preview: its entries (null: being listed) or why it couldn't be. */
export interface LookDir {
  readonly abs: string;
  readonly rel: string;
  readonly entries: readonly Entry[] | null;
  readonly error: string | null;
}

/** What the preview shows: a file or a folder (relative to the root). */
export interface LookTarget {
  readonly abs: string;
  readonly rel: string;
  readonly dir: boolean;
}

/** What a pointer meets in the tree: a row, or the empty space under the rows (the root). */
export type Hit = { readonly row: Row } | { readonly root: true };

/** One operation of a set: its OPS arguments, where it was, where it goes (null: deleted). */
export interface SetOp {
  readonly abs: string;
  readonly args: readonly string[];
  readonly to: string | null;
}

/** Where the preview split is drawn: its side, and its px along it (null: no split). */
export interface Geo {
  readonly side: Side | null;
  readonly px: number | null;
}

/** The shown tab, and the terminal pane of the $EDITOR this panel opened there. */
export interface EditorPlace {
  readonly tab: string | undefined;
  readonly pane: herdr.PaneInfo | null;
}

/** Where the rows are in the pane (px). */
export interface TreeBox {
  readonly top: number;
  readonly bottom: number;
  readonly right: number;
}

/** A failed operation: its exit code, its stderr. */
export interface Outcome {
  readonly code: number;
  readonly stderr: string;
}
