// Nocturne files: a folder's tree in a pane, in Nocturne's 1-bit look, that
// hands what you pick to $EDITOR. Fireflies' shipped files mod, reworked: the
// same lazy listing, folder watch and git marks (a mod can't import another
// mod's files, so it isn't wrapped), but rooted where it was opened instead
// of following focus, and opening files in the editor instead of a preview.
// Opened from Nocturne's tab strip files button (or cmd-e) with props { folder, on }:
// the panel down the tab's right edge. A folder link (a terminal's cmd-click,
// `files.open`, Nocturne's "+ new" > Files) opens a pane of its own instead, props { path, on, slot }:
// beside the pane it came from, closed with q / esc, opening files beside itself.
//
// Each pane keeps its filters (dotfiles, git-ignored files: both left out
// unless settings.json `files` or H / I say otherwise; written once toggled)
// in shared `file-tree.filters` by slot. The filter line holds the
// filter, the two switches, + file / + folder and ? keys; narrower than the
// filter's whole placeholder allows (the docked panel), the filter takes a
// row of its own at full width and the rest the row under it (logic.ts
// lensLayout). `/`
// filters the tree as you type: fff's fuzzy index of the root (findFiles),
// hits under their folders; elsewhere (home, /, another machine) the folders
// already listed.
//
// Files open in the app's editor (editor, `editor.open`); folders,
// files on another machine and E go to $EDITOR. That one runs through this mod's bin/nocturne-edit (on another
// machine: `nocturne-edit` from its PATH) in a
// terminal pane beside this one. With nvim it listens on a socket per tab,
// so later picks open in that same nvim instead of a new pane.
//
// Click a file: select it (the keyboard comes here, the preview split follows).
// Double-click a file (enter, the menu's Open): a tab of the app's editor,
// whatever its kind (editor-route.ts `look`): a Markdown file in the editor's view for it
// (alt-double-click: as text), a picture, PDF, table, patch, font or clip
// drawn in its tab by the preview's viewer (alt-double-click: the system's
// app, or a table or patch as text). `p` (the menu's "Open in its viewer
// pane") opens Markdown in the Markdown viewer (markdown) and the
// rest in the preview (preview), panes of their own; so does
// another machine's file. Click a
// folder: fold it; double-click it: edit the folder in $EDITOR (the fold its
// first click made is undone). cmd-click marks or unmarks a row; shift-click
// marks every row from the last clicked one. Drag a row (or, pressed on a
// marked one, every marked row) onto a folder or below the rows (the root).
// Keys while it has focus:
//   j / k  ↓ ↑     move                 l →  unfold, or open a file
//   h ←            fold, or go to the parent row
//   enter          open a file, fold a folder    e  edit what's selected (as text; a picture: system app)
//   E              edit it in $EDITOR (a terminal beside)
//   p              its viewer (preview, Markdown) v  Neovim beside
//   -              root one folder up            .  root at the selected folder
//   [ / ]          back / forward through the folders rooted at (also alt-← / alt-→, ctrl-o / ctrl-i, backspace)
//   gg / G         top / bottom                  r  refresh
//   /              filter (esc clears)           H  dotfiles  I  ignored files
//   o              a folder in a new files pane  y  copy the path
//   w              an HTML file as a page in the web pane (the shown tab's: a new front tab; else one beside)
//   m              the right-click menu          q  close
//   a / A          new file / new folder: a name row in the selected folder, or beside the selected file
//                  (slashes make the folders on the way; a ending in / makes a folder; a new file opens as text;
//                  the filter line's + file / + folder chips and an empty folder's + new file do the same)
//   tab ⇧tab       ring the filter line's switches, + file, + folder, ? in turn; enter / space presses
//   R              rename: the name in an input, its stem selected; a path in it moves the item
//   x / P          cut the row / paste it in the selected folder (beside a selected file; the root with none)
//   d              delete: asks first (y or enter; anything else keeps it); the machine's trash, else permanently
//   ?              the keys, under the filter line (its ? chip too; ? or esc hides them)
//   t              mark / unmark the row and step down   V  mark a range while moving (V again ends it)
//   shift-↓ ↑      mark while moving
//   esc            the marks first; else a pane of its own: close; the panel: back to the pane the keyboard came from
//   space          the preview split on / off (the toolbar's split icon and the menu too)
//   J / K          scroll the preview (half a view; a PDF: a page), the keyboard stays here
//   < / >          the preview smaller / bigger (or drag the divider)
//
// The preview split: the selected file, shown in a part of this pane's own
// area by the preview pane's viewer (viewer.ts and the files it imports are
// preview's, copied unchanged; scripts/preview-shared.test.ts
// keeps them alike), mounted as a nested view so its loading never redraws
// the tree. A pane taller than wide has it at the bottom, one wider than tall
// at the right; near square (logic.ts SLACK) it stays where it was. Stepping
// loads only the row the selection rests on (REST ms); a folder shows what it
// holds. Text (code in the editor's colors, Markdown rendered), pictures,
// PDFs, tables, patches, databases, fonts and clips (never playing by
// themselves) show as the preview shows them, the first 256 KB of text; a
// binary or unreadable file says why in a line. On another machine only text
// is read. Each pane keeps its split (on, how big) by slot in shared
// `file-tree.look`. A native view (PDF, clip, font) steps aside while the
// menu is open, and goes when the split closes or a folder is picked.
//
// File operations run as one `sh -c` (logic.ts OPS) on the pane's machine,
// paths as their own arguments: nothing is overwritten (a target that exists
// is refused), the root can't be renamed, cut or deleted, a folder can't go
// into itself. Every one is in the right-click menu too (the empty space's:
// new file / folder, paste, in the root). While a name's input or the delete
// question is open, keys go to it. What's cut is shared (`file-tree.cut`,
// { on, items }): P in any files pane on that machine pastes it.
//
// Several rows: with marks, d, x, P, y and the menu on a marked row act on all
// of them (one delete question with the count and the first names; a marked
// folder covers what's in it); rename, open, edit and the viewers act on the
// keyboard's row. Each is tried, what failed is listed after with its reason.
// The hint line counts the marks; the preview follows the keyboard's row.
// A drag: the pane's own press, move and release, the row under the pointer
// found from the list's scroll offset (rows are ROW px); the target folder
// lights while a drop there is allowed (not into itself, its own folder or
// where it is), unfolds after resting UNFOLD ms, the list scrolls near its
// edges; esc, leaving the pane or a release elsewhere cancels; a press that
// doesn't move is a click.
//
// Every rename, move and delete that worked goes into shared
// `nocturne.files.changes` ([{ id, from, to, on, at }], newest last, 50 at
// most; a delete's `to` is null; a folder is one entry): editors follow it.
//
// Commands (keys.json, the palette, `herdr-app do file-tree.<c>`, to the
// focused files pane): keys (the ? overview), look (the preview split on / off).
//
// The keyboard: a copy takes it when its pane is the focused one as it opens
// (cmd-e's panel, files.open's pane), from pane.go ("focus"), and from
// cmd-e on an open panel (nocturne/files.ts focusFiles: "take-panel").

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import type { AsyncContext, Color, Context, Element, Entity, FocusHandle, KeyEvent, Modifiers, MouseButtonEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import * as herdr from "herdr";
import type { Theme } from "herdr";
import { editorProps, openInEditor } from "./editor-route.ts";
import { h_flex, v_flex, v_virtual_list, Scrollbar, VirtualListScrollHandle, InputState, Input } from "gpui-base";
import { props, theme, settings, exec, run, panes, spaces, terminals, focused, watchFolder, nextCommand, home, appHome, shared, setShared, findFiles, window as appWindow } from "herdr";
import type { Guarded } from "./guard.ts";
import { arrayOf, isString, nullable, object, readShared, readSharedList, readSharedMap, sharedKey, sharedListKey, sharedMapKey, writeShared, writeSharedMap } from "./guard.ts";
import type { Adds, At, Clip, Cut, CutItem, DraftRow, Entry, Filters, Found, HeadRow, HitRow, LookState, MenuItem, Moved, Nav, NewKind, Range, Row, Side, Size, Stop, TreeRow, Act } from "./logic.ts";
import { keyColumn, parent, filterDefaults, parseIgnored, isIgnored, isHidden, lists, fuzzy, grouped, nvimLaunch, menuItems, marks, newNav, navGo, navBack, navForward, lensLayout, toolbarFit, KEYS, ADDS, lensStops, lensStep, isHtml, fileUrl, webOpen, lookSide, lookSize, clampShare, dragShare, newLook, folderFacts, LOOK_STEP, DIVIDER, rangePaths, topLevel, deleteManyQuestion, dropRefusal, withChanges, cutItems, setMenuItems, treeTop, ROW_H, rowIndexAt, base, dirOf, join, relTo, resolveName, renameTarget, moveRefusal, stemRange, deleteQuestion, neighbour, movedFolders, parentsOf, cleanError, PROBE, OPS, isFilters, isLookEntry, isFileChange, isClip } from "./logic.ts";
import { keysHint, keysView, keysKey, SECTION } from "./keyhelp.ts";
// The preview split: the preview pane's own viewer (a copy of preview/viewer.ts).
import Viewer from "./viewer.ts";
import type { ViewerProps } from "./viewer.ts";

const ROW = 22;
const PER_FOLDER = 500;
const TOTAL = 5000;
const EDIT = "nocturne-edit";

/** The editor wrapper: the one this mod ships, here; another machine's own. */
const editTool = (on: string | null): string => (on ? EDIT : `${appHome()}/mods/file-tree/bin/${EDIT}`);

/** The app's viewer pane for a kind of file: the command that opens one there, and what the
 *  other way (alt-double-click, `e`) does instead. */
interface ViewerKind {
  readonly test: RegExp;
  readonly open: "markdown.open" | "preview.open";
  readonly other: "edit" | "system";
}

/** Files the app has a viewer for, by type: the command that opens one there,
 *  and what the other way (alt-double-click, `e`) does instead. */
const VIEWERS: readonly ViewerKind[] = [
  { test: /\.(md|markdown)$/i, open: "markdown.open", other: "edit" },
  // The preview (preview/kinds.ts KINDS); tables and patches are text: e edits them.
  { test: /\.(csv|tsv|diff|patch)$/i, open: "preview.open", other: "edit" },
  { test: /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|svg|avif|hei[cf]|pdf|sqlite3?|db3?|ttf|otf|ttc|woff2?|mp4|m4v|mov|mp3|m4a|aac|wav|aiff?|flac|caf)$/i, open: "preview.open", other: "system" },
];

export const viewerFor = (name: string): ViewerKind | null => VIEWERS.find((v) => v.test.test(name)) ?? null;

/** Markdown files open in the viewer (markdown.open), not the editor. */
export const isMarkdown = (name: string): boolean => viewerFor(name)?.open === "markdown.open";

const isEdit = (argv0: string | undefined): boolean => argv0 === EDIT || Boolean(argv0?.endsWith(`/${EDIT}`));

/** A git status letter's color (none for the folder's dot or a cut). */
function markColor(t: Theme, mark: string): Color | null {
  switch (mark) {
    case "A": return t.ansi2;
    case "M": return t.ansi3;
    case "D":
    case "U": return t.ansi1;
    default: return null;
  }
}

const ART = "mods/nocturne/art";
const MOD = "file-tree";
const ICONS = "mods/workspace-chrome";

/** What a pane is opened with: the panel { folder, on, slot } (nocturne/files.ts), a pane of
 *  its own { path, on, slot } (files.open, a folder link). */
const isFilesProps = object({}, { folder: nullable(isString), path: nullable(isString), on: nullable(isString), slot: nullable(isString) });

type FilesProps = Guarded<typeof isFilesProps>;

/** A mod pane's slot. */
const isSlotted = object({ slot: isString });

/** A panel's props: a pane of its own has a path. */
const isAlone = object({ path: isString });

/** A terminal of herdr-core's listing, the fields `editorPane` reads. */
const isTerminal = object({ address: isString }, { argv: nullable(arrayOf(isString)) });

/** Each pane's filters by slot (users' state: kept across restarts). */
const FILTERS = sharedMapKey(`${MOD}.filters`, isFilters);

/** What a pane of its own shows, for its header (the folder's name) and the app (files.open). */
const TITLES = sharedMapKey(`${MOD}.titles`, isString);

const PATHS = sharedMapKey(`${MOD}.paths`, isString);

/** The pane the keyboard came from into the panel (set by nocturne/files.ts). */
const FROM = sharedKey(`${MOD}.from`, nullable(isString));

/** What `x` cut, for `P` in any files pane: { on, items: [{ abs, dir, name }] }. */
const CUT = sharedKey(`${MOD}.cut`, nullable(isClip));

/** Each pane's preview split by slot: { on, right, bottom } (logic.ts newLook). */
const LOOK = sharedMapKey(`${MOD}.look`, isLookEntry);

/** Renames, moves and deletes done here, for the editors to follow (logic.ts withChanges). */
const CHANGES = sharedListKey("nocturne.files.changes", isFileChange);

/** How long the selection rests before the preview loads it (ms): stepping through doesn't. */
const REST = 90;

/** The viewer's native views (preview/viewer.ts nativeId): set aside under a menu, dropped with the split. */
const NATIVE_IDS = ["preview-pdf", "preview-media", "preview-quicklook"];

/** The list's key for the new file's or folder's input row. */
const DRAFT = "\u0000draft";
const HITS = 200;
const MENU_ROW = 20;

/** Two clicks on a row this close (ms) are a double click. */
const DOUBLE = 400;

/** A press that moves this far (px) is a drag; a folder under a drag unfolds
 *  after resting this long (ms); this close to the list's edge it scrolls. */
const SLOP = 4;
const UNFOLD = 700;
const EDGE = 18;
const zoom = (): number => settings().zoom || 1;

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

/** A 50% checker dither filling the parent (same as ../nocturne/kit.ts). */
function dither(color: Color, cell = 1): Element {
  const dpr = appWindow().platform === "macos" ? 2 : 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}

const stop = (_e: MouseButtonEvent, cx: Context): void => cx.stop_propagation();

/** The ring the filter line's stop wears under tab: a 1 px accent edge over it. */
const ring = (t: Theme): Element => div().absolute().inset_0().border(1).border_color(t.accent);

const tilde = (p: string | null): string => {
  const h = home();

  return !p ? "" : p === h ? "~" : p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p;
};

/** A folder's entries, folders first, capped at PER_FOLDER (+1 to tell it was cut). */
async function directory(path: string, on: string | null): Promise<Entry[]> {
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "files", path], { on });

  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");

  const fields = r.stdout.split("\0");
  const out: Entry[] = [];

  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1] ?? "", dir: fields[i] === "d" });

  return out;
}

const byName = (a: Entry, b: Entry): number => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name);

/** A caught error's message. */
const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** The name input's row: a new file or folder in `dir` (after the row `after`), or a rename of `path`. */
type Draft = { readonly kind: NewKind; readonly dir: string; readonly after: string | null; busy: boolean; shown: boolean }
  | { readonly kind: "rename"; readonly path: string; readonly dir: boolean; readonly name: string; busy: boolean; shown: boolean };

/** An item a delete asks about. */
interface AskItem {
  readonly path: string;
  readonly dir: boolean;
  readonly name: string;
}

/** The delete question: one item, or a set; `trash` the machine's trash tool ("": permanently). */
type Ask = (AskItem & { readonly trash: string; readonly set?: undefined }) | { readonly set: readonly AskItem[]; readonly trash: string };

/** The right-click menu: its row, entries, where it opened, the entry the keys are on. */
interface Menu {
  readonly row: Row;
  readonly items: readonly MenuItem[];
  readonly at: At;
  n: number;
}

/** A line in the hint line (an error in red; `draft`: about the name input). */
interface Msg {
  readonly text: string;
  readonly error: boolean;
  readonly draft: boolean;
  readonly at: number;
}

/** How a line is said. */
interface SayHow {
  readonly error?: boolean;
  readonly draft?: boolean;
}

/** Rows being marked as the keyboard moves (V, shift-↑↓): from `anchor`, the marks before kept. */
interface MarkRange {
  readonly anchor: string;
  readonly base: ReadonlySet<string>;
  readonly shift: boolean;
}

/** Rows being dragged: where to (`into`, relative; null: nowhere), whether a drop there is
 *  allowed (else `why`), the pointer, what a drop would really move. */
interface Drag {
  readonly paths: readonly string[];
  into: string | null;
  ok: boolean;
  why: string | null;
  at: At;
  moving: readonly string[];
}

/** A row pressed, before it moves far enough to be a drag. */
interface Press {
  readonly path: string;
  readonly at: At;
}

/** A folder in the preview: its entries (null: being listed) or why it couldn't be. */
interface LookDir {
  readonly abs: string;
  readonly rel: string;
  readonly entries: readonly Entry[] | null;
  readonly error: string | null;
}

/** What the preview shows: a file or a folder (relative to the root). */
interface LookTarget {
  readonly abs: string;
  readonly rel: string;
  readonly dir: boolean;
}

/** What a pointer meets in the tree: a row, or the empty space under the rows (the root). */
type Hit = { readonly row: Row } | { readonly root: true };

/** One operation of a set: its OPS arguments, where it was, where it goes (null: deleted). */
interface SetOp {
  readonly abs: string;
  readonly args: readonly string[];
  readonly to: string | null;
}

/** Where the preview split is drawn: its side, and its px along it (null: no split). */
interface Geo {
  readonly side: Side | null;
  readonly px: number | null;
}

/** The shown tab, and the terminal pane of the $EDITOR this panel opened there. */
interface EditorPlace {
  readonly tab: string | undefined;
  readonly pane: herdr.PaneInfo | null;
}

/** Where the rows are in the pane (px). */
interface TreeBox {
  readonly top: number;
  readonly bottom: number;
  readonly right: number;
}

/** A failed operation: its exit code, its stderr. */
interface Outcome {
  readonly code: number;
  readonly stderr: string;
}

export default class Files extends View {
  on: string | null = null;
  slot: string | null = null;
  // A pane of its own (a folder link, files.open): closes itself, opens files beside itself.
  alone = false;
  filters: Filters = { hidden: false, ignored: false };
  query = "";
  hits: (HeadRow | HitRow)[] | null = null;
  note: string | null = null;
  seq = 0;
  typing = false;
  finding = false;
  // The filter line's stop tab / shift-tab rings (logic.ts lensStops), null: the list.
  stop: Stop | null = null;
  lensAdd: Adds = "both";
  lensRows: 1 | 2 = 1;
  menu: Menu | null = null;
  mouse: At = { x: 40, y: 40 };
  size: Size = { width: 400, height: 600 };
  input: InputState | null = null;
  // The name a new file or folder gets, or a rename's: an input row in the tree.
  draft: Draft | null = null;
  ask: Ask | null = null;
  msg: Msg | null = null;
  nameInput: InputState | null = null;
  naming = false;
  scroll: VirtualListScrollHandle | null = null;
  // Several rows: the marked ones (paths), the row a shift-click or a range
  // starts from, the range being marked (V, shift-↑↓), a row being dragged.
  marked = new Set<string>();
  anchor: string | null = null;
  range: MarkRange | null = null;
  drag: Drag | null = null;
  press: Press | null = null;
  handle: FocusHandle | null = null;
  nav: Nav = newNav();
  // The preview split: on or off and its shares, kept per pane like the filters.
  lookState: LookState = newLook();
  side: Side | null = null;
  lookAt: string | null = null;
  lookDir: LookDir | null = null;
  lookN = 0;
  lookProps: ViewerProps = { embedded: true, path: null, on: null };
  look: Entity | null = null;
  root = "";
  gen = 0;
  entries = new Map<string, readonly Entry[]>();
  folders = new Set<string>();
  pending = new Set<string>();
  // Git's status letter by absolute path; a folder with changes under it: "•".
  marks = new Map<string, string>();
  ignored: ReadonlySet<string> = new Set();
  error: string | null = null;
  limited = false;
  sel: string | null = null;
  want: string | null = null;
  pendingSel: string | null = null;
  watched: string | null = null;
  loading = false;
  again = false;
  branch: string | null = null;
  // What the filters leave out, counted by rows().
  cut: Cut = { hidden: 0, ignored: 0 };
  keysShown = false;
  editorSlot: string | null = null;
  copied = 0;
  copiedText: string | null = null;
  // The machine's trash tool, once asked ("": none).
  trash: string | null = null;
  geo: Geo = { side: null, px: null };
  listed: readonly Row[] = [];
  edging = 0;
  dropped = false;
  lastClick: { readonly path: string; readonly at: number } | null = null;
  mods: Modifiers | null = null;
  alt = false;
  gAt = 0;
  pressed: Row | null = null;
  dividerHover = false;
  dragging: Side | null = null;
  dragged: number | null = null;
  aside = false;

  override init(p: Props | undefined, cx: AsyncContext): void {
    const own = props();
    const pr: FilesProps = isFilesProps(own) ? own : isFilesProps(p) ? p : {};
    const slot = pr.slot ?? null;

    this.on = pr.on ?? null;
    this.slot = slot;
    this.alone = Boolean(pr.path);

    const kept = slot ? readSharedMap(shared, FILTERS).get(slot) : undefined;

    this.filters = kept ? { hidden: kept.hidden === true, ignored: kept.ignored === true } : filterDefaults(settings());

    const input = InputState.new({ placeholder: "filter files" });

    input.on("change", (_e, cx) => {
      this.query = input.value();
      this.search(cx);
    });

    input.on("focus", (_e, cx) => {
      this.typing = true;
      cx.notify();
    });

    input.on("blur", (_e, cx) => {
      this.typing = false;
      this.finding = false;
      cx.notify();
    });

    input.on("submit", (_e, cx) => {
      this.enter(cx);
      cx.notify();
    });

    this.input = input;

    const name = InputState.new({ placeholder: "name" });

    name.on("focus", (_e, cx) => {
      this.naming = true;
      this.selectStem();
      cx.notify();
    });

    name.on("blur", (_e, cx) => {
      if (this.naming && this.draft && !this.draft.busy) this.endDraft(cx, false);

      this.naming = false;
      cx.notify();
    });

    name.on("change", (_e, cx) => {
      if (this.msg?.draft) this.msg = null;

      cx.notify();
    });

    name.on("submit", (_e, cx) => {
      this.commitDraft(cx);
      cx.notify();
    });

    this.nameInput = name;
    this.scroll = VirtualListScrollHandle.new();
    this.handle = cx.focus_handle();

    const look = slot ? readSharedMap(shared, LOOK).get(slot) : undefined;

    this.lookState = { ...newLook(), ...look };
    this.lookProps = { embedded: true, path: null, on: this.on };

    if (this.lookState.on) this.mountLook(cx);

    this.reroot(pr.path || pr.folder || home(), cx);

    // Opened as the focused pane (cmd-e, files.open): the keyboard comes here,
    // which the app leaves with the window for a mod pane. Again a little
    // later, as the editor does, in case the window took it back meanwhile.
    for (const ms of [0, 120, 400]) {
      cx.timer.after(ms, (cx) => {
        if (this.isFocusedPane() && !this.typing && !this.finding) this.takeKeys(cx);
      });
    }

    // Remote folders can't be watched: poll those instead.
    cx.timer.every(this.on ? 15000 : 30000, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = (await nextCommand()).replace(`${MOD}.`, "");

        if (c === "focus" || (c === "take-panel" && !this.alone && this.isFocusedPane())) this.takeKeys(cx);
        else if (c === "keys" && (this.alone || this.isFocusedPane())) this.keysShown = !this.keysShown;
        else if (c === "look" && (this.alone || this.isFocusedPane())) this.toggleLook(cx);

        cx.notify();
      }
    });
  }

  /** The filter's text. */
  typed(): string {
    return this.input?.value() ?? "";
  }

  focus(): void {
    this.handle?.focus();
  }

  // ---- the keyboard

  /** This copy's pane is the app's focused one. */
  isFocusedPane(): boolean {
    const mine = this.me() ?? (this.alone ? null : this.panel());

    return Boolean(mine && focused()?.pane === mine.pane);
  }

  /** The shown tab's id. */
  shownTab(): string | undefined {
    return spaces().find((s) => s.active)?.tabs.find((c) => c.active)?.id;
  }

  /** The panel in the shown tab (a pane without a path of its own). */
  panel(): herdr.PaneInfo | null {
    const tab = this.shownTab();

    return panes().find((p) => p.mod === MOD && p.tab === tab && !isAlone(p.props)) ?? null;
  }

  /** Takes the keyboard, with a row picked so j / k start somewhere. */
  takeKeys(cx: Context | null): void {
    this.focus();

    if (!this.sel) {
      const rows = this.shown();

      if (rows.length) this.select(rows, 0);
    }

    cx?.notify();
  }

  /** esc in the panel: the keyboard back to the pane it came from (else the pane to the left). */
  leave(): void {
    const from = readShared(shared, FROM, null);
    const mine = this.me() ?? this.panel();

    if (from && from !== mine?.pane && panes().some((p) => p.pane === from)) run("pane.focus", { pane: from });
    else run("pane.go", { direction: "left" });
  }

  // ---- the folders visited

  /** Roots the tree at `folder`, remembered for back. */
  go(folder: string, cx: Context): void {
    const step = navGo(this.nav, this.root, folder);

    if (!step) return;

    this.nav = step.nav;
    this.reroot(step.to, cx);
  }

  /** Back: the folder before (with none, the parent); the folder left is picked there. */
  back(cx: Context): void {
    const step = navBack(this.nav, this.root);

    if (!step) return;

    const from = this.root;

    this.nav = step.nav;
    this.reroot(step.to, cx);
    this.pendingSel = from;
  }

  forward(cx: Context): void {
    const step = navForward(this.nav, this.root);

    if (!step) return;

    this.nav = step.nav;
    this.reroot(step.to, cx);
  }

  // ---- the tree

  reroot(folder: string, cx: Context): void {
    this.root = folder;
    this.gen++;
    this.entries = new Map();
    this.folders = new Set();
    this.pending = new Set();
    this.marks = new Map();
    this.ignored = new Set();
    this.error = null;
    this.limited = false;
    this.sel = null;
    this.marked = new Set();
    this.range = null;
    this.anchor = null;
    this.watched = null;

    if (this.query) this.clearSearch(cx);

    this.refresh(cx);
  }

  async loadFolder(path: string, gen: number): Promise<void> {
    const entries = await directory(path ? `${this.root}/${path}` : this.root, this.on);

    if (gen !== this.gen || (path && !this.folders.has(path))) return;

    let used = 0;

    for (const [p, e] of this.entries) if (p !== path) used += e.length;

    const room = Math.max(0, Math.min(PER_FOLDER, TOTAL - used));

    if (entries.length > room) this.limited = true;

    this.entries.set(path, entries.slice(0, room).sort(byName));
  }

  refresh(cx: Context): void {
    if (this.loading) {
      this.again = true;

      return;
    }

    const gen = this.gen;
    const root = this.root;
    const on = this.on;

    this.loading = true;
    this.limited = false;
    cx.spawn(async (cx) => {
      try {
        for (const path of ["", ...this.folders]) {
          if (gen !== this.gen) return;

          await this.loadFolder(path, gen);
        }

        const marks = new Map<string, string>();
        let ignored = new Set<string>();
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: root, on }).catch(() => null);

        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would fire again.
          const st = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd: root, on }).catch(() => null);
          const base = top.stdout.trim();

          if (st?.code === 0) {
            for (const entry of st.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
              const xy = entry.slice(0, 2);
              const mark = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
              const abs = `${base}/${entry.slice(3)}`;

              marks.set(abs, mark);

              // A folder carries a dot when anything under it changed.
              for (let d = parent(abs); d.length > base.length && !marks.has(d); d = parent(d)) marks.set(d, "•");
            }
          }

          // What git ignores here, relative to the root (an ignored folder once, not its files).
          const ig = await exec("git", ["--no-optional-locks", "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"], { cwd: root, on }).catch(() => null);

          if (ig?.code === 0) ignored = parseIgnored(ig.stdout);

          this.branch = (await exec("git", ["branch", "--show-current"], { cwd: root, on }).catch(() => null))?.stdout.trim() || null;
        } else this.branch = null;

        if (gen !== this.gen) return;

        this.marks = marks;
        this.ignored = ignored;
        this.error = null;
        this.watch(cx);
      } catch (cause: unknown) {
        if (gen === this.gen) this.error = messageOf(cause);
      } finally {
        this.loading = false;
        cx.notify();

        if (this.again) {
          this.again = false;
          this.refresh(cx);
        }
      }
    });
  }

  watch(cx: Context): void {
    if (this.on || this.watched === this.root) return;

    const root = this.root;

    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);

          if (this.watched === root) {
            this.refresh(cx);
            this.reloadLook();
          }
        }
      } catch {
        if (this.watched === root) this.watched = null;
      }
    });
  }

  toggle(path: string, cx: Context): void {
    if (this.folders.has(path)) {
      for (const f of this.folders) {
        if (f === path || f.startsWith(`${path}/`)) {
          this.folders.delete(f);
          this.entries.delete(f);
        }
      }
    } else {
      this.folders.add(path);

      if (!this.entries.has(path) && !this.pending.has(path)) {
        const gen = this.gen;

        this.pending.add(path);
        cx.spawn(async (cx) => {
          try {
            await this.loadFolder(path, gen);
          } catch (cause: unknown) {
            if (gen === this.gen) this.error = messageOf(cause);
          } finally {
            this.pending.delete(path);
            cx.notify();
          }
        });
      }
    }

    cx.notify();
  }

  /** The visible rows, depth-first: { path, name, dir, depth, ignored }; what
   *  the filters leave out is counted in `this.cut`. */
  rows(): TreeRow[] {
    const out: TreeRow[] = [];
    const cut = { hidden: 0, ignored: 0 };

    const walk = (prefix: string, depth: number): void => {
      if (out.length >= TOTAL || depth > 40) return;

      for (const e of this.entries.get(prefix) ?? []) {
        if (out.length >= TOTAL) break;

        const path = prefix ? `${prefix}/${e.name}` : e.name;

        if (!lists(path, this.filters, this.ignored)) {
          if (!this.filters.hidden && isHidden(path)) cut.hidden++;
          else cut.ignored++;

          continue;
        }

        out.push({ path, name: e.name, dir: e.dir, depth, ignored: isIgnored(path, this.ignored) });

        if (e.dir && this.folders.has(path)) walk(path, depth + 1);
      }
    };

    walk("", 0);
    this.cut = cut;

    return out;
  }

  /** What the list shows: the search's hits while there's a query, else the tree. */
  shown(): readonly Row[] {
    return this.query.trim() && this.hits ? this.hits : this.rows();
  }

  /** The row at `path` in the list. */
  rowAt(path: string | null): Row | null {
    return path === null ? null : this.shown().find((r) => r.path === path) ?? null;
  }

  /** The slots of the files panes there are now (a kept entry of another is dropped). */
  liveSlots(): Set<string> {
    return new Set(panes().flatMap((p) => (p.mod === MOD && isSlotted(p.props) && p.props.slot ? [p.props.slot] : [])));
  }

  /** `map` with this pane's `value` under its slot, the panes that are gone left out. */
  kept<T>(map: ReadonlyMap<string, T>, slot: string, value: T): Map<string, T> {
    const live = this.liveSlots();
    const out = new Map<string, T>();

    for (const [k, v] of map) if (live.has(k)) out.set(k, v);

    out.set(slot, value);

    return out;
  }

  // ---- filters

  setFilter(name: keyof Filters, cx: Context): void {
    this.filters = name === "hidden" ? { ...this.filters, hidden: !this.filters.hidden } : { ...this.filters, ignored: !this.filters.ignored };

    // Kept per pane, by slot; panes that are gone drop out.
    if (this.slot) writeSharedMap(setShared, FILTERS, this.kept(readSharedMap(shared, FILTERS), this.slot, this.filters));

    if (this.query.trim()) this.search(cx);

    cx.notify();
  }

  // ---- the preview split

  /** The viewer (the preview pane's, viewer.ts), made once: a nested view, so
   *  its reading and drawing redraw only it, never the tree. */
  mountLook(cx: Context): void {
    if (!this.look) this.look = cx.new(Viewer, this.lookProps);
  }

  /** space, the toolbar's switch, the menu's entry: the split on or off. */
  toggleLook(cx: Context): void {
    const on = !this.lookState.on;

    this.saveLook({ ...this.lookState, on });
    this.lookAt = null;
    this.lookDir = null;

    if (on) this.mountLook(cx);
    else {
      this.natives("dispose");
      this.setLook({ ...this.lookProps, path: null });
    }

    cx.notify();
  }

  /** Keeps this pane's split (on, shares) by slot, as its filters; panes that are gone drop out. */
  saveLook(next: LookState): void {
    this.lookState = next;

    if (!this.slot) return;

    writeSharedMap(setShared, LOOK, this.kept(readSharedMap(shared, LOOK), this.slot, next));
  }

  /** New props for the viewer (it applies them on its next render). */
  setLook(next: ViewerProps): void {
    this.lookProps = next;
    this.look?.set_props(next);
  }

  /** Every native view the viewer may have (a PDF, a clip, a font): `action` on it. */
  natives(action: "dispose"): void;
  natives(action: "setVisible", args: { readonly visible: boolean }): void;
  natives(action: string, args: { readonly visible: boolean } | null = null): void {
    for (const id of NATIVE_IDS) {
      try {
        herdr.nativeViewCall(id, action, args ? { visible: args.visible } : {});
      } catch {
        // None of that kind.
      }
    }
  }

  /** What the preview shows: the selected row, else the root. */
  lookTarget(): LookTarget {
    const row = this.rowAt(this.sel);

    if (!row) return { abs: this.root, rel: "", dir: true };

    return { abs: join(this.root, row.path), rel: row.path, dir: Boolean(row.dir || row.head) };
  }

  /** From render: once the selection rests REST ms on a row, the preview
   *  shows it. Stepping on cancels the wait, so only the row rested on loads. */
  follow(cx: Context): void {
    const target = this.lookTarget();
    const key = `${target.dir ? "d" : "f"}:${target.abs}`;

    if (key === this.lookAt) return;

    this.lookAt = key;
    cx.timer.after(REST, (cx) => {
      if (this.lookAt === key && this.lookState.on) {
        this.showLook(target, cx);
        cx.notify();
      }
    });
  }

  /** A file to the viewer; a folder: its summary, drawn here (the viewer lets go of what it showed). */
  showLook(target: LookTarget, cx: Context): void {
    if (!target.dir) {
      this.lookDir = null;
      this.setLook({ ...this.lookProps, path: target.abs, on: this.on });

      return;
    }

    this.natives("dispose");
    this.setLook({ ...this.lookProps, path: null });

    const listed = this.entries.get(target.rel);

    this.lookDir = { abs: target.abs, rel: target.rel, entries: listed ?? null, error: null };

    if (listed) return;

    cx.spawn(async (cx) => {
      let entries: Entry[] | null = null;
      let error: string | null = null;

      try {
        entries = (await directory(target.abs, this.on)).sort(byName);
      } catch (cause: unknown) {
        error = cleanError(messageOf(cause));
      }

      if (this.lookDir?.abs !== target.abs) return;

      this.lookDir = { abs: target.abs, rel: target.rel, entries, error };
      cx.notify();
    });
  }

  /** The folder changed on disk: the preview reads its file again (unchanged ones stay as they are). */
  reloadLook(): void {
    if (this.lookState.on && this.lookProps.path) this.setLook({ ...this.lookProps, reload: ++this.lookN });
  }

  /** J / K: the preview scrolls, the keyboard stays in the tree. */
  scrollLook(dir: number): void {
    if (this.lookState.on && this.lookProps.path) this.setLook({ ...this.lookProps, scroll: { n: ++this.lookN, dir } });
  }

  /** < / >: the preview smaller or bigger, both parts keeping their least. */
  resizeLook(dir: number): void {
    if (!this.lookState.on) return;

    const side = this.side ?? lookSide(this.size);
    const f = clampShare(this.size, side, this.lookState[side] + dir * LOOK_STEP);

    if (f !== null) this.saveLook(side === "right" ? { ...this.lookState, right: f } : { ...this.lookState, bottom: f });
  }

  // ---- search

  /** Hits for the query, under their folders: fff's index of the root
   *  (findFiles); where it can't go (home, /, another machine), the folders
   *  listed so far. */
  search(cx: Context): void {
    const q = this.query.trim();
    const seq = ++this.seq;

    if (!q) {
      this.hits = null;
      this.note = null;
      cx.notify();

      return;
    }

    const root = this.root;

    const done = (files: readonly Found[], note: string | null): void => {
      if (seq !== this.seq) return;

      const hits = grouped(files.filter((f) => lists(f.path, this.filters, this.ignored)).slice(0, HITS));
      const i = hits.findIndex((r) => !r.head);

      this.hits = hits;
      this.note = note;
      this.sel = hits[i]?.path ?? null;

      if (i >= 0) this.scroll?.scroll_to_item(i);

      cx.notify();
    };

    if (this.on) {
      done(this.loaded(q), "searching the folders listed so far");

      return;
    }

    cx.spawn(async (cx) => {
      try {
        const r = await findFiles(root, q, { limit: HITS });

        if (seq !== this.seq || root !== this.root) return;

        done(r.files, r.scanning ? "indexing the folder… (hits grow)" : null);

        if (r.scanning) {
          cx.timer.after(800, (cx) => {
            if (seq === this.seq) this.search(cx);
          });
        }
      } catch {
        done(this.loaded(q), "searching the folders listed so far");
      }
    });
  }

  /** Files listed so far that match `q` fuzzily, closest first. */
  loaded(q: string): Found[] {
    const out: { readonly path: string; readonly ranges: readonly Range[] }[] = [];

    for (const [prefix, entries] of this.entries) {
      for (const e of entries) {
        if (e.dir) continue;

        const path = prefix ? `${prefix}/${e.name}` : e.name;
        const ranges = fuzzy(q, path);

        if (ranges) out.push({ path, ranges });
      }
    }

    const spread = (f: { readonly path: string; readonly ranges: readonly Range[] }): number => f.ranges.length * 100 + f.path.length;

    return out.sort((a, b) => spread(a) - spread(b));
  }

  /** `/` and a click on the filter line: draws the filter's input, then gives
   *  it the keyboard. An input that isn't drawn can't take the focus (and its
   *  "focus" event, which turns `typing` on and so draws it, never comes), so
   *  the focus waits for the frames after this one. */
  startFind(cx: Context): void {
    this.finding = true;

    for (const ms of [16, 60, 200]) {
      cx.timer.after(ms, () => {
        if (this.finding && !this.typing) this.input?.focus();
      });
    }

    cx.notify();
  }

  /** w, the menu's "Open in a web pane": an HTML file (relative to the root) as
   *  a page in the web pane (logic.ts webOpen): a new front tab in the shown
   *  tab's one, else a new one beside this pane. Enter keeps opening it as before. */
  openWeb(path: string, cx: Context): void {
    if (!isHtml(path)) {
      this.say(`w opens HTML pages in a web pane: “${base(path)}” isn't one`, cx);

      return;
    }

    if (this.on) {
      this.say("A page on another machine can't open in the web pane", cx);

      return;
    }

    const tab = this.shownTab();
    const browsers = panes().filter((p) => p.tab === tab && p.mod === "browser");
    const from = (this.me() ?? (this.alone ? null : this.panel()))?.pane ?? null;
    const slot = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const [name, args] = webOpen(fileUrl(`${this.root}/${path}`), { browsers, from, slot });

    if (args === undefined) run(name);
    else run(name, args);
  }

  /** The filter line's stop `stop` pressed (enter / space on its ring). */
  pressStop(stop: Stop, cx: Context): void {
    if (stop === "hidden" || stop === "ignored") this.setFilter(stop, cx);
    else if (stop === "keys") this.keysShown = !this.keysShown;
    else this.addNew(stop === "add-file" ? "file" : "folder", cx);
  }

  /** + file / + folder (the filter line's chips, the empty folder's line):
   *  `a` / `A`'s name row, in the selected folder (beside a selected file),
   *  in the root with nothing selected. */
  addNew(kind: NewKind, cx: Context): void {
    this.stop = null;

    const row = this.shown().find((r) => r.path === this.sel && !r.head) ?? null;

    this.startDraft(kind, row, cx);
  }

  clearSearch(cx: Context | null): void {
    this.query = "";
    this.hits = null;
    this.note = null;
    this.seq++;
    this.finding = false;
    this.input?.set_value("");
    this.focus();
    cx?.notify();
  }

  /** Shows a folder from the hits in the tree: the search ends, it unfolds there. */
  reveal(path: string, cx: Context): void {
    this.clearSearch(cx);

    const parts = path.split("/");

    for (let n = 1; n <= parts.length; n++) {
      const p = parts.slice(0, n).join("/");

      if (!this.folders.has(p)) this.toggle(p, cx);
    }

    this.want = path;
  }

  /** Enter: a hit opens (a folder shows in the tree); in the tree, a file opens and a folder folds. */
  enter(cx: Context): void {
    const row = this.rowAt(this.sel);

    if (!row) return;

    if (row.head) this.reveal(row.path, cx);
    else if (row.dir) this.toggle(row.path, cx);
    else this.openFile(row.path, cx);
  }

  // ---- the editor

  /** This copy's own pane (found by its slot). */
  me(): herdr.PaneInfo | null {
    const slot = this.slot;

    return slot ? panes().find((p) => p.mod === MOD && isSlotted(p.props) && p.props.slot === slot) ?? null : null;
  }

  /** The shown tab, and the editor pane this panel opened there (nocturne-edit's terminal). */
  editorPane(): EditorPlace {
    const tab = this.shownTab();
    const ours = new Set(terminals().flatMap((x) => (isTerminal(x) && isEdit(x.argv?.[0]) ? [x.address] : [])));

    return { tab, pane: panes().find((p) => p.tab === tab && p.terminal && ours.has(p.terminal)) ?? null };
  }

  /** Where files open: beside a pane of its own; from the panel, beside the tab's first other pane. */
  beside(): herdr.PaneInfo | null {
    if (this.alone) {
      const me = this.me();

      if (me) return me;
    }

    const tab = this.shownTab();

    return panes().find((p) => p.tab === tab && p.mod !== MOD && !p.parked)
      ?? panes().find((p) => p.tab === tab && p.mod === MOD) ?? null;
  }

  /** Edits a file (relative to the root) in the app's editor (editor),
   *  beside this tab's other panes; a folder, or a file on another machine, in
   *  $EDITOR (terminalEdit). */
  edit(path: string, cx: Context): void {
    const row = this.rowAt(path);

    if (this.on || !path || row?.dir) {
      this.terminalEdit(path, cx);

      return;
    }

    const beside = this.beside();
    // As a tab of the editor this pane sent files to, else the shown tab's
    // editor; with none, a new one beside (editor-route.ts). Markdown edited
    // as text opens with its preview beside it.
    const to = openInEditor(herdr, { path: `${this.root}/${path}`, pane: beside?.pane ?? null, prefer: this.editorSlot, view: isMarkdown(path) ? "split" : viewerFor(path) ? "text" : null });

    if (to) this.editorSlot = editorProps(to).slot ?? null;
  }

  /** Opens a file to look at it in the editor as a tab, whatever its kind (a
   *  picture, a PDF, a table drawn in its tab, Markdown in the editor's view for it): the
   *  editor this pane sent files to, else the shown tab's; with none, a new
   *  one beside (editor-route.ts). */
  openLooked(path: string): void {
    const beside = this.beside();
    const to = openInEditor(herdr, { path: `${this.root}/${path}`, pane: beside?.pane ?? null, prefer: this.editorSlot, look: true });

    if (to) this.editorSlot = editorProps(to).slot ?? null;
  }

  /** Opens a file or folder (relative to the root; "" is the root) in $EDITOR: in this
   *  tab's nvim when it is listening, else in a new terminal pane to this one's left. */
  terminalEdit(path: string, cx: Context): void {
    const abs = path ? `${this.root}/${path}` : this.root;
    const { tab, pane } = this.editorPane();
    // One socket per tab; ids from other machines carry a "machine/" prefix.
    const key = (tab ?? "default").replace(/[^A-Za-z0-9_-]/g, "_");
    // Left of this pane: the files column stays on the tab's right edge.
    const self = this.me() ?? panes().find((p) => p.tab === tab && p.mod === MOD);
    const argv = [editTool(this.on), "--listen", key, abs];
    const open = (): null => run("terminal.open", self ? { argv, folder: this.root, place: "left", pane: self.pane } : { argv, folder: this.root, place: "left" });

    if (!pane) {
      open();

      return;
    }

    cx.spawn(async () => {
      const r = await exec(editTool(this.on), ["--remote", key, abs], { cwd: this.root, on: this.on }).catch(() => null);

      if (r?.code === 0) run("pane.focus", { pane: pane.pane });
      else open();
    });
  }

  /** Neovim (the one on PATH) in a new terminal beside: on a file, in its
   *  folder; on a folder (or the root), `nvim .` there. */
  nvim(row: Row | null): void {
    const path = row?.path ?? "";
    const { argv, folder } = nvimLaunch(path ? `${this.root}/${path}` : this.root, !path || Boolean(row?.dir));
    const self = this.me() ?? (this.alone ? null : panes().find((p) => p.tab === this.editorPane().tab && p.mod === MOD));
    const place = this.alone ? "auto" : "left";

    run("terminal.open", self ? { argv, folder, place, pane: self.pane } : { argv, folder, place });
  }

  /** A folder (relative to the root) in a new files pane of its own. */
  openPane(path: string): void {
    const beside = this.beside();
    const at = path ? `${this.root}/${path}` : this.root;

    run("files.open", { path: at, ...(beside ? { pane: beside.pane } : null), ...(this.on ? { on: this.on } : null) });
  }

  /** The copied note goes after a moment. */
  copiedNow(cx: Context): void {
    const at = Date.now();

    this.copied = at;
    cx.timer.after(1400, (cx) => {
      if (this.copied === at) {
        this.copied = 0;
        cx.notify();
      }
    });
  }

  /** y with marks: every marked path, one a line. */
  copySet(cx: Context): void {
    const rows = this.setOf(this.rowAt(this.sel));
    const paths = rows.map((r) => this.abs(r.path)).map((a) => (this.on ? `${this.on}:${a}` : a));

    cx.write_to_clipboard(paths.join("\n"));
    this.copiedText = `${paths.length} paths copied`;
    this.copiedNow(cx);
  }

  copy(path: string, cx: Context): void {
    if (this.marked.size && (!path || this.marked.has(path) || path === this.sel)) {
      this.copySet(cx);

      return;
    }

    const abs = path ? `${this.root}/${path}` : this.root;

    cx.write_to_clipboard(this.on ? `${this.on}:${abs}` : abs);
    this.copiedText = null;
    this.copiedNow(cx);
  }

  /** Closes this pane (the panel too); from the panel, the keyboard goes back where it came from.
   *  Not close(): Fireflies calls that as cleanup once the pane is gone. */
  closePane(): void {
    const me = this.me() ?? (this.alone ? null : this.panel());

    if (!me) return;

    const from = readShared(shared, FROM, null);
    const had = focused()?.pane === me.pane;

    run("pane.close", { pane: me.pane });

    if (!this.alone && had && from && from !== me.pane && panes().some((p) => p.pane === from)) run("pane.focus", { pane: from });
  }

  /** p: a file in the app's viewer pane for it (the preview, Markdown), on
   *  purpose; others in the editor. */
  preview(row: Row | undefined, cx: Context): void {
    if (row && !row.dir && !row.head) this.openViewer(row.path, cx);
  }

  /** Opens a file as a tab of the editor, whatever its kind: Markdown in its
   *  preview, a picture, PDF or table drawn (look), other text to edit; on
   *  another machine the viewers' panes, as before (the editor's drawn tabs
   *  read this computer's files). `other` (alt-double-click, `e`): Markdown,
   *  tables and patches as text, a picture in the system's app. */
  openFile(path: string, cx: Context, other = false): void {
    const viewer = viewerFor(path);

    if (!viewer || (other && viewer.other === "edit")) this.edit(path, cx);
    else if (other) run(viewer.open, { path: `${this.root}/${path}`, in: "system", ...(this.on ? { on: this.on } : null) });
    else if (this.on) this.openViewer(path, cx);
    else this.openLooked(path);
  }

  /** A file in the app's viewer pane for it (the Markdown viewer, the
   *  preview), beside this tab's editor or its first other pane (else this
   *  one); a file without one in the editor. */
  openViewer(path: string, cx: Context): void {
    const viewer = viewerFor(path);

    if (!viewer) {
      this.edit(path, cx);

      return;
    }

    const beside = (this.alone ? this.me() : null) ?? this.editorPane().pane ?? this.beside();

    run(viewer.open, { path: `${this.root}/${path}`, ...(beside ? { pane: beside.pane } : null), ...(this.on ? { on: this.on } : null) });
  }

  /** Tells the pane header which folder a pane of its own shows, and the app
   *  (files.open finds the pane already on a folder) where it is rooted. */
  publish(): void {
    const slot = this.slot;

    if (!this.alone || !slot) return;

    const live = this.liveSlots();
    const name = this.root === "/" ? "/" : this.root.split("/").pop() ?? "";

    for (const [key, value] of [[TITLES, name], [PATHS, this.root]] as const) {
      const was = readSharedMap(shared, key);

      if (was.get(slot) === value && [...was.keys()].every((k) => live.has(k) || k === slot)) continue;

      writeSharedMap(setShared, key, this.kept(was, slot, value));
    }
  }

  // ---- the menu

  /** The empty space's row: the root. */
  rootRow(): TreeRow {
    return { path: "", name: this.root, dir: true, depth: 0, ignored: false };
  }

  openMenu(row: Row, cx: Context | null): void {
    // On a marked row (with others marked): the set's entries first.
    const set = row.path && this.marked.has(row.path) ? this.setOf(row) : [];
    const clip = Boolean(this.clip());

    const all = set.length > 1 ? setMenuItems(row, set.length, { pane: this.alone, clip, look: this.lookState.on })
      : menuItems(row, { pane: this.alone, clip, look: this.lookState.on, web: !this.on, viewer: !row.dir && Boolean(viewerFor(row.path)) });

    const items = row.head ? all.filter((x) => x.act !== "root") : all;

    this.sel = row.path || this.sel;
    this.menu = { row, items, at: { ...this.mouse }, n: 0 };
    this.focus();
    cx?.notify();
  }

  act(act: Act, row: Row, cx: Context): void {
    const p = row.path;

    switch (act) {
      case "toggle":
        if (row.head) this.reveal(p, cx);
        else this.toggle(p, cx);

        break;
      case "pane": this.openPane(p); break;
      case "root": this.go(p ? `${this.root}/${p}` : this.root, cx); break;
      case "edit": this.edit(p, cx); break;
      case "nvim": this.nvim(row); break;
      case "open": this.openFile(p, cx); break;
      case "viewer": this.openViewer(p, cx); break;
      case "other":
        if (viewerFor(p)?.other === "system") this.openFile(p, cx, true);
        else this.edit(p, cx);

        break;
      case "terminal": this.terminalEdit(p, cx); break;
      case "web": this.openWeb(p, cx); break;
      case "copy": this.copy(p, cx); break;
      case "close": this.closePane(); break;
      case "new-file": this.startDraft("file", row, cx); break;
      case "new-folder": this.startDraft("folder", row, cx); break;
      case "rename": this.startRename(row, cx); break;
      case "cut": this.cutRow(row, cx); break;
      case "paste": this.paste(row, cx); break;
      case "delete": this.askDelete(row, cx); break;
      case "look": this.toggleLook(cx); break;
      case "delete-set": this.askDelete(row, cx); break;
      case "cut-set": this.cutRow(row, cx); break;
      case "copy-set": this.copySet(cx); break;
      case "unmark": this.unmark(); break;
    }
  }

  menuKey(e: KeyEvent, cx: Context): void {
    const m = this.menu;

    if (!m) return;

    const k = e.key;
    const char = e.modifiers.shift && /^[a-z]$/.test(k) ? k.toUpperCase() : k;

    if (k === "escape" || k === "m") this.menu = null;
    else if (k === "j" || k === "down") m.n = Math.min(m.items.length - 1, m.n + 1);
    else if (k === "k" || k === "up") m.n = Math.max(0, m.n - 1);
    else if (k === "enter") {
      this.menu = null;

      const it = m.items[m.n];

      if (it) this.act(it.act, m.row, cx);
    } else {
      const it = m.items.find((x) => x.key === char && x.key !== "enter");

      if (!it) return;

      this.menu = null;
      this.act(it.act, m.row, cx);
    }

    cx.stop_propagation();
    cx.notify();
  }

  // ---- file operations: new, rename / move, cut / paste, delete

  /** A line in the hint line until the next key (an error in red). */
  say(text: string, cx: Context | null, { error = true, draft = false }: SayHow = {}): void {
    const at = Date.now();

    this.msg = { text, error, draft, at };
    cx?.timer.after(8000, (cx) => {
      if (this.msg?.at === at) {
        this.msg = null;
        cx.notify();
      }
    });
  }

  /** Runs one of OPS's operations on this pane's machine: true when it worked;
   *  otherwise the reason is said in the pane and the tree is listed again. */
  async fileOp(args: readonly string[], name: string, cx: Context): Promise<boolean> {
    const r = await this.runOp(args);

    if (r.code === 0) return true;

    this.say(this.why(r, name), cx, { draft: r.code === 3 });
    this.refresh(cx);

    return false;
  }

  /** One of OPS's operations on this pane's machine: its exit code and stderr. */
  async runOp(args: readonly string[]): Promise<Outcome> {
    try {
      return await exec("sh", ["-c", OPS, "files-op", ...args], { on: this.on });
    } catch (cause: unknown) {
      return { code: -1, stderr: messageOf(cause) };
    }
  }

  /** Why an operation on `name` failed, in a line. */
  why(r: Outcome, name: string): string {
    return r.code === 3 ? `“${name}” already exists` : r.code === 4 ? `“${name}” isn't there anymore`
      : r.code === 5 ? `“${name}” couldn't go to the Trash` : cleanError(r.stderr);
  }

  /** Renames, moves and deletes that worked ({ from, to } absolute; `to`
   *  null for a delete; a folder once, with its own paths), appended to the
   *  shared record the editors follow. */
  recordChanges(entries: readonly Moved[]): void {
    if (entries.length) setShared(CHANGES.name, withChanges(readSharedList(shared, CHANGES), entries, this.on, Date.now()));
  }

  /** After `rel` moved to `to` (relative, or null: out of the tree or
   *  deleted): its unfolded folders follow it, its listings go, a cut of it is used up. */
  forget(rel: string | null, to: string | null, abs: string): void {
    if (rel !== null) {
      this.folders = movedFolders(this.folders, rel, to);

      for (const k of this.entries.keys()) if (k === rel || k.startsWith(`${rel}/`)) this.entries.delete(k);
    }

    const all = cutItems(this.clip());
    const left = all.filter((c) => c.abs !== abs && !c.abs.startsWith(`${abs}/`));

    if (this.clip() && left.length !== all.length) writeShared(setShared, CUT, left.length ? { on: this.on, items: left } : null);
  }

  /** The machine's trash tool ("" where there is none: deletes are permanent), asked once. */
  async trashTool(): Promise<string> {
    if (this.trash === null) {
      const r = await exec("sh", ["-c", PROBE, "files-trash-probe"], { on: this.on }).catch(() => null);

      this.trash = r?.code === 0 ? r.stdout.trim() : "";
    }

    return this.trash;
  }

  abs(rel: string): string {
    return join(this.root, rel);
  }

  /** Shows `abs` once the tree is listed again: its folders unfold, the
   *  selection lands on it. Outside the root, or hidden by a filter: said. */
  landOn(abs: string, cx: Context, done: string): string | null {
    // From the search's hits: the search ends, the result shows in the tree.
    if (this.query) this.clearSearch(cx);

    const rel = relTo(this.root, abs);

    if (rel === null) this.say(`${done} ${tilde(abs)}`, cx, { error: false });
    else if (rel && !lists(rel, this.filters, this.ignored)) this.say(`${done} “${base(rel)}”: ${isHidden(rel) ? "dotfiles are hidden (H)" : "ignored files are hidden (I)"}`, cx, { error: false });
    else if (rel) {
      for (const p of parentsOf(rel)) this.folders.add(p);

      this.want = rel;
    }

    this.refresh(cx);

    return rel;
  }

  /** a / A: an input row for the new file's or folder's name, in the
   *  selected folder (unfolded), beside the selected file, or in the root. */
  startDraft(kind: NewKind, row: Row | null | undefined, cx: Context): void {
    if (this.query) this.clearSearch(cx);

    let dir = "";
    let after: string | null = null;

    if (row?.path) {
      dir = row.dir ? row.path : dirOf(row.path);
      after = row.path;

      for (const p of parentsOf(row.path)) if (!this.folders.has(p)) this.toggle(p, cx);

      if (row.dir && !this.folders.has(row.path)) this.toggle(row.path, cx);
    }

    this.draft = { kind, dir, after, busy: false, shown: false };
    this.msg = null;
    this.nameInput?.set_value("");
    this.nameInput?.focus();
    cx.notify();
  }

  /** R: the row's name in the input, its stem selected. */
  startRename(row: Row | null | undefined, cx: Context): void {
    if (!row?.path) {
      this.say("The tree's root can't be renamed", cx);

      return;
    }

    const name = base(row.path);

    this.draft = { kind: "rename", path: row.path, dir: row.dir, name, busy: false, shown: false };
    this.sel = row.path;
    this.msg = null;
    this.nameInput?.set_value(name);
    this.nameInput?.focus();
    this.selectStem();
    cx.notify();
  }

  selectStem(): void {
    const d = this.draft;

    if (d?.kind === "rename" && this.nameInput?.value() === d.name) this.nameInput.set_selected_range(stemRange(d.name, d.dir));
  }

  /** Closes the input; the keyboard back on the tree. */
  endDraft(cx: Context | null, focus = true): void {
    this.draft = null;

    if (this.msg?.draft) this.msg = null;

    if (focus) this.focus();

    cx?.notify();
  }

  /** Enter in the input: creates, or renames / moves. A refusal or a failure
   *  leaves the input open to fix the name. */
  commitDraft(cx: Context): void {
    const d = this.draft;

    if (!d || d.busy) return;

    const typed = this.nameInput?.value() ?? "";
    const at = this.on ? null : home();

    if (d.kind === "rename") {
      const src = this.abs(d.path);
      const t = renameTarget(src, typed, at);

      if (t.error !== undefined) this.say(t.error, cx, { draft: true });
      else if (t.abs === src) this.endDraft(cx);
      else this.move(src, t.abs, d.path, cx, "Moved to");

      return;
    }

    const r = resolveName(this.abs(d.dir), typed, at);

    if (r.error !== undefined) {
      this.say(r.error, cx, { draft: true });

      return;
    }

    const folder = d.kind === "folder" || r.folder;

    d.busy = true;
    cx.spawn(async (cx) => {
      const ok = await this.fileOp([folder ? "folder" : "file", r.abs], base(r.abs), cx);

      d.busy = false;

      if (ok && this.draft === d) this.endDraft(cx);

      if (ok) {
        const rel = this.landOn(r.abs, cx, "Made");

        // A new file opens to be written: its text (a Markdown file with its preview beside).
        if (!folder && rel) this.edit(rel, cx);
      }

      cx.notify();
    });
  }

  /** Moves `src` to `dst` (absolute; `rel`: src in the tree). Unfolded folders
   *  under it stay unfolded where it lands; a cut of it is used up. */
  move(src: string, dst: string, rel: string | null, cx: Context, done: string): void {
    const why = moveRefusal(src, dst, this.root);

    if (why) {
      this.say(why, cx, { draft: Boolean(this.draft) });

      return;
    }

    const d = this.draft;

    if (d) d.busy = true;

    cx.spawn(async (cx) => {
      const ok = await this.fileOp(["move", src, dst], base(dst), cx);

      if (d) d.busy = false;

      if (ok && d && this.draft === d) this.endDraft(cx);

      if (ok) {
        this.recordChanges([{ from: src, to: dst }]);
        this.forget(rel, relTo(this.root, dst) || null, src);
        this.landOn(dst, cx, done);
      }

      cx.notify();
    });
  }

  /** What's cut on this pane's machine, or null. */
  clip(): Clip | null {
    const c = readShared(shared, CUT, null);

    return c && (c.on ?? null) === this.on ? c : null;
  }

  /** Whether `abs` is cut (on this machine). */
  isCut(abs: string): boolean {
    return cutItems(this.clip()).some((c) => c.abs === abs);
  }

  /** x: cuts the row for P (again on the same row: uncut); with marks, all of them. */
  cutRow(row: Row | null | undefined, cx: Context): void {
    const set = this.setOf(row ?? null);

    if (set.length > 1) {
      const items = set.map((r): CutItem => ({ abs: this.abs(r.path), dir: r.dir, name: base(r.path) }));

      writeShared(setShared, CUT, { on: this.on, items });
      this.say(`Cut ${items.length} items: P pastes them in the selected folder`, cx, { error: false });

      return;
    }

    if (!row?.path) {
      this.say("The tree's root can't be moved", cx);

      return;
    }

    const abs = this.abs(row.path);

    if (this.isCut(abs) && cutItems(this.clip()).length === 1) {
      writeShared(setShared, CUT, null);

      return;
    }

    writeShared(setShared, CUT, { on: this.on, items: [{ abs, dir: row.dir, name: base(row.path) }] });
    this.say(`Cut “${base(row.path)}”: P pastes it in the selected folder`, cx, { error: false });
  }

  /** P: moves what's cut into the selected folder (beside a selected file; the root with none). */
  paste(row: Row | null | undefined, cx: Context): void {
    const c = readShared(shared, CUT, null);
    const items = cutItems(c);
    const first = items[0];

    if (!c || !first) {
      this.say("Nothing is cut: x cuts a row", cx);

      return;
    }

    if ((c.on ?? null) !== this.on) {
      this.say("It was cut on another machine", cx);

      return;
    }

    const into = this.abs(!row?.path ? "" : row.dir ? row.path : dirOf(row.path));

    if (items.length === 1) this.move(first.abs, join(into, first.name), relTo(this.root, first.abs), cx, "Moved to");
    else this.moveSet(items.map((x) => x.abs), into, cx);
  }

  /** d: asks first (the item named, a folder's contents, trash or permanently);
   *  with marks, once for all of them (the count and the first names). */
  askDelete(row: Row | null | undefined, cx: Context): void {
    const set = this.setOf(row ?? null);
    const path = row?.path;

    if (set.length <= 1 && !path) {
      this.say("The tree's root can't be deleted", cx);

      return;
    }

    cx.spawn(async (cx) => {
      const trash = await this.trashTool();

      if (set.length > 1) this.ask = { set: set.map((r) => ({ path: r.path, dir: r.dir, name: base(r.path) })), trash };
      else if (row && path) {
        this.ask = { path, dir: row.dir, name: base(path), trash };
        this.sel = path;
      }

      cx.notify();
    });
  }

  // ---- several rows at once

  /** The marked rows in the tree's order (none: []). */
  markedRows(): Row[] {
    if (!this.marked.size) return [];

    return this.shown().filter((r) => this.marked.has(r.path) && !r.head && !r.draft);
  }

  /** The rows an action on `row` covers: every marked one (a folder's
   *  contents go with it) when there are marks and `row` is one of them or the
   *  keyboard's; else `row` alone. */
  setOf(row: Row | null): Row[] {
    const marked = this.markedRows();

    if (!marked.length || (row?.path && !this.marked.has(row.path) && row.path !== this.sel)) return row?.path ? [row] : [];

    const keep = new Set(topLevel(marked.map((r) => r.path)));

    return marked.filter((r) => keep.has(r.path));
  }

  /** t, cmd-click: marks or unmarks a row. */
  markToggle(path: string): void {
    if (!path || path === DRAFT) return;

    const next = new Set(this.marked);

    if (next.has(path)) next.delete(path);
    else next.add(path);

    this.marked = next;
    this.anchor = path;
  }

  /** Marks the rows from the range's start to the keyboard's row (the marks before it kept). */
  markRange(to: string | null): void {
    const r = this.range;
    const rows = this.shown();

    if (!r) return;

    const a = rows.findIndex((x) => x.path === r.anchor);
    const b = rows.findIndex((x) => x.path === to);

    if (a < 0 || b < 0) return;

    this.marked = new Set([...r.base, ...rangePaths(rows, a, b)]);
  }

  /** esc: the marks and a range go. */
  unmark(): void {
    this.marked = new Set();
    this.range = null;
  }

  /** Moves the set (absolute paths) into `into`, each tried; what failed is
   *  said afterwards with its reason. Nothing is overwritten. */
  moveSet(paths: readonly string[], into: string, cx: Context): void {
    const items = topLevel(paths).filter((p) => parent(p) !== into);
    const why = dropRefusal(topLevel(paths), into);

    if (why) {
      this.say(why, cx);

      return;
    }

    this.runSet(items.map((abs) => ({ abs, args: ["move", abs, join(into, base(abs))], to: join(into, base(abs)) })), cx, (n) => `Moved ${n} ${n === 1 ? "item" : "items"} to ${tilde(into)}`);
  }

  // ---- drag and drop

  /** Where the rows are in the pane (px): under the header, left of a preview at the right, above one at the bottom. */
  treeBox(): TreeBox {
    const g = this.geo;

    return {
      top: treeTop(this.lensRows) - 4,
      bottom: this.size.height - (g.side === "bottom" && g.px !== null ? g.px + DIVIDER : 0),
      right: this.size.width - (g.side === "right" && g.px !== null ? g.px + DIVIDER : 0),
    };
  }

  /** How far the list is scrolled (layout px down). */
  scrolled(): number {
    return -(this.scroll?.offset().y ?? 0) / zoom();
  }

  /** What's under the pointer `at` (pane px): a row ({ row }), the empty
   *  space below the rows ({ root }), or nothing. Rows are ROW_H px each,
   *  from the list's scroll offset (VirtualListScrollHandle.offset). */
  hitAt(at: At | null): Hit | null {
    const box = this.treeBox();

    if (!at || this.keysShown || at.y < box.top || at.y > box.bottom || at.x > box.right) return null;

    const list = this.listed;
    const i = rowIndexAt(at.y, this.scrolled(), treeTop(this.lensRows));
    const row = list[i];

    if (i >= 0 && row) return { row };

    return i >= list.length ? { root: true } : null;
  }

  /** A left press (no cmd / shift / alt) on a row: a drag starts once it moves SLOP px. */
  pressAt(e: MouseButtonEvent): void {
    this.press = null;

    const m = e.modifiers;

    if (m.platform || m.shift || m.alt || this.draft || this.typing || !e.local_position || !this.scroll) return;

    const at = { x: e.local_position.x / zoom(), y: e.local_position.y / zoom() };
    const hit = this.hitAt(at);

    if (hit && "row" in hit && hit.row.path !== DRAFT && !hit.row.head) this.press = { path: hit.row.path, at };
  }

  /** The pointer moved with the button held: the drag starts, or aims. A
   *  press on a marked row drags every marked row. */
  dragMove(at: At, cx: Context): void {
    const press = this.press;

    if (!press) return;

    let d = this.drag;

    if (!d) {
      if (Math.hypot(at.x - press.at.x, at.y - press.at.y) < SLOP) return;

      const p = press.path;
      const paths = this.marked.has(p) ? topLevel(this.markedRows().map((r) => r.path)) : [p];

      d = { paths, into: null, ok: false, why: null, at, moving: [] };
      this.drag = d;
      this.menu = null;
    }

    d.at = at;
    this.aim(d, this.hitAt(at), cx);
    this.edgeScroll(at, cx);
    cx.notify();
  }

  /** The drop target under the pointer: a folder row, or the root below the
   *  rows; lit when the drop is allowed (dropRefusal). A closed folder
   *  unfolds after resting UNFOLD ms under it. */
  aim(d: Drag, hit: Hit | null, cx: Context): void {
    const row = hit && "row" in hit ? hit.row : null;
    const into = hit && "root" in hit ? "" : row?.dir ? row.path : null;

    if (into === d.into) return;

    d.into = into;

    if (into === null) {
      d.ok = false;
      d.why = null;

      return;
    }

    d.why = dropRefusal(d.paths.map((p) => this.abs(p)), this.abs(into));
    d.ok = !d.why;
    // What a drop here really moves: the rows already in the target stay.
    d.moving = d.paths.filter((p) => dirOf(p) !== into);

    if (into && row && !row.head && !this.folders.has(into)) {
      cx.timer.after(UNFOLD, (cx) => {
        if (this.drag?.into === into && !this.folders.has(into)) {
          this.toggle(into, cx);
          cx.notify();
        }
      });
    }
  }

  /** Near the rows' top or bottom edge, the list scrolls a row at a time while the drag stays there. */
  edgeScroll(at: At, cx: Context): void {
    const box = this.treeBox();
    const dir = at.y < box.top + EDGE ? -1 : at.y > box.bottom - EDGE ? 1 : 0;

    if (dir === this.edging) return;

    this.edging = dir;

    if (!dir) return;

    const step = (cx: Context): void => {
      const d = this.drag;

      if (!d || this.edging !== dir) return;

      const first = Math.floor(this.scrolled() / ROW_H);
      const shown = Math.max(1, Math.floor((box.bottom - box.top) / ROW_H) - 1);
      const to = dir < 0 ? first - 1 : first + shown;

      if (to >= 0 && to < this.listed.length) this.scroll?.scroll_to_item(to);

      this.aim(d, this.hitAt(d.at), cx);
      cx.notify();
      cx.timer.after(90, step);
    };

    step(cx);
  }

  /** The release: an allowed drop moves the dragged rows into the target; anything else cancels. */
  dragEnd(cx: Context): boolean {
    const d = this.drag;

    this.press = null;

    if (!d) return false;

    this.cancelDrag();

    if (!d.ok || d.into === null) return true;

    const into = this.abs(d.into);
    const only = d.paths.length === 1 ? d.paths[0] : undefined;

    if (only !== undefined) {
      const src = this.abs(only);

      this.move(src, join(into, base(src)), only, cx, "Moved to");
    } else this.moveSet(d.paths.map((p) => this.abs(p)), into, cx);

    return true;
  }

  /** esc, the pointer leaving the pane, a release where nothing takes it: the drag ends, nothing moves. */
  cancelDrag(): void {
    this.drag = null;
    this.press = null;
    this.edging = 0;
  }

  /** Runs the set's operations one by one: what worked is recorded and
   *  forgotten in the tree; failures are listed once all are tried. */
  runSet(ops: readonly SetOp[], cx: Context, said: (n: number) => string): void {
    cx.spawn(async (cx) => {
      const done: SetOp[] = [];
      const failed: string[] = [];

      for (const op of ops) {
        const r = await this.runOp(op.args);

        if (r.code === 0) done.push(op);
        else failed.push(`“${base(op.abs)}”: ${this.why(r, base(op.abs)).replace(/^“[^”]*” /, "")}`);
      }

      this.recordChanges(done.map((op) => ({ from: op.abs, to: op.to })));

      for (const op of done) this.forget(relTo(this.root, op.abs), op.to ? relTo(this.root, op.to) || null : null, op.abs);

      this.unmark();

      const ok = said(done.length);

      this.say(failed.length ? `${ok}; ${failed.length} failed: ${failed.join(" · ")}` : ok, cx, { error: failed.length > 0 });

      if (this.query.trim()) this.search(cx);

      this.refresh(cx);
      cx.notify();
    });
  }

  /** The delete question's keys: y or enter deletes, anything else keeps it. */
  askKey(a: Ask, e: KeyEvent, cx: Context): void {
    const k = e.key;
    const m = e.modifiers;

    this.ask = null;

    if (!m.platform && !m.control && !m.alt && (k === "enter" || k === "y")) this.remove(a, cx);

    cx.stop_propagation();
    cx.notify();
  }

  remove(a: Ask, cx: Context): void {
    if (a.set) {
      const verb = a.trash ? "Moved" : "Deleted";
      const where = a.trash ? " to the Trash" : "";

      this.runSet(a.set.map((x) => ({ abs: this.abs(x.path), args: ["delete", a.trash, this.abs(x.path)], to: null })), cx,
        (n) => `${verb} ${n} ${n === 1 ? "item" : "items"}${where}`);

      return;
    }

    const next = neighbour(this.shown(), a.path);
    const abs = this.abs(a.path);

    cx.spawn(async (cx) => {
      if (await this.fileOp(["delete", a.trash, abs], a.name, cx)) {
        this.recordChanges([{ from: abs, to: null }]);
        this.forget(a.path, null, abs);
        this.want = next;

        // From the search's hits: they're looked up again without it.
        if (this.query.trim()) this.search(cx);

        this.say(a.trash ? `Moved “${a.name}” to the Trash` : `Deleted “${a.name}”`, cx, { error: false });
        this.refresh(cx);
      }

      cx.notify();
    });
  }

  /** The rows with the new name's input row where it will appear. */
  withDraft(rows: readonly Row[]): readonly Row[] {
    const d = this.draft;

    if (!d || d.kind === "rename") return rows;

    let at = 0;

    if (d.after !== null) {
      const i = rows.findIndex((r) => r.path === d.after);

      at = i >= 0 ? i + 1 : d.dir ? rows.findIndex((r) => r.path === d.dir) + 1 : 0;
    }

    const folder = d.kind === "folder" || (this.nameInput?.value() ?? "").endsWith("/");
    const row: DraftRow = { path: DRAFT, name: "", dir: folder, depth: d.dir ? d.dir.split("/").length : 0, draft: true };

    return [...rows.slice(0, at), row, ...rows.slice(at)];
  }

  // ---- input

  select(rows: readonly Row[], i: number): void {
    if (!rows.length) return;

    const n = Math.max(0, Math.min(rows.length - 1, i));

    this.sel = rows[n]?.path ?? null;
    this.scroll?.scroll_to_item(n);
  }

  /** One step through the hits while typing (folder lines skipped). */
  step(d: number): void {
    const rows = this.shown();
    let i = rows.findIndex((r) => r.path === this.sel);

    do i += d; while (rows[i]?.head);

    if (rows[i]) this.select(rows, i);
  }

  /** A click on a row: a file is selected (the preview follows), a double
   *  click opens it (alt: the other way); a folder folds, a double click edits
   *  it in $EDITOR (its first click's fold undone); a search's folder line
   *  shows that folder in the tree. */
  pick(path: string, cx: Context): void {
    // A click in the name's input row places the caret; it doesn't open the row.
    if (path === DRAFT || (this.draft?.kind === "rename" && this.draft.path === path)) return;

    // The release that ends a drag isn't a click.
    if (this.drag || this.dropped) {
      this.dropped = false;

      return;
    }

    const rows = this.shown();
    const row = rows.find((r) => r.path === path);

    if (!row) return;

    const mods = this.mods;

    // cmd-click: the row joins or leaves the marks (the keyboard's row too, the
    // first time, as a selection grows in Finder); shift-click: every row from
    // the last clicked one to this one.
    if ((mods?.platform || mods?.shift) && !row.head) {
      if (mods.shift) {
        const a = rows.findIndex((r) => r.path === (this.anchor ?? this.sel));
        const b = rows.indexOf(row);

        this.marked = new Set(rangePaths(rows, a < 0 ? b : a, b));
      } else {
        if (!this.marked.size && this.sel && this.sel !== path && rows.some((r) => r.path === this.sel && !r.head)) this.marked = new Set([this.sel]);

        this.markToggle(path);
      }

      this.sel = path;
      this.lastClick = null;
      this.range = null;
      this.focus();
      cx.notify();

      return;
    }

    // A plain click: one row, the marks go.
    if (this.marked.size) this.unmark();

    this.anchor = path;

    const now = Date.now();
    const again = this.lastClick?.path === path && now - this.lastClick.at < DOUBLE;

    // A double click is used up: a third click selects again.
    this.lastClick = again ? null : { path, at: now };
    this.sel = path;
    this.focus();

    if (row.head) this.reveal(path, cx);
    else if (!row.dir) {
      if (again) this.openFile(path, cx, this.alt);
    } else if (again) {
      // Undo the first click's fold.
      this.toggle(path, cx);
      this.edit(path, cx);
    } else this.toggle(path, cx);

    cx.notify();
  }

  key(e: KeyEvent, cx: Context): void {
    if (this.menu) {
      this.menuKey(e, cx);

      return;
    }

    if (this.ask) {
      this.askKey(this.ask, e, cx);

      return;
    }

    const k = e.key;
    const m = e.modifiers;

    const done = (): void => {
      cx.stop_propagation();
      cx.notify();
    };

    // A drag: esc cancels it, other keys wait.
    if (this.drag) {
      if (k === "escape") this.cancelDrag();

      done();

      return;
    }

    if (this.draft) {
      // Typing goes to the name; esc gives up (enter is the input's submit).
      if (k !== "escape") return;

      this.endDraft(cx);
      done();

      return;
    }

    if (this.msg && !this.typing) this.msg = null;

    if (this.typing) {
      // Typing goes to the filter; these steer the hits (enter is the input's submit).
      if (k === "escape") this.clearSearch(cx);
      else if (k === "down" || (m.control && k === "n")) this.step(1);
      else if (k === "up" || (m.control && k === "p")) this.step(-1);
      else if (k === "tab") this.focus();
      else return;

      done();

      return;
    }

    // Back and forward, the browser's and vim's jump list's way too.
    if ((m.alt && k === "left") || (m.control && k === "o")) {
      this.back(cx);
      done();

      return;
    }

    if ((m.alt && k === "right") || (m.control && k === "i")) {
      this.forward(cx);
      done();

      return;
    }

    if (m.platform || m.control || m.alt) return;

    // ? (shift-/ on most layouts: check what was typed before "/" filters).
    // The keys overview (keyhelp.ts): ? opens it, ? esc q close it; meanwhile it takes every key.
    const help = keysKey(e, this.keysShown);

    if (help || this.keysShown) {
      if (help) this.keysShown = help === "toggle" ? !this.keysShown : false;

      done();

      return;
    }

    // tab / shift-tab ring the filter line's switches, + file / + folder and ? keys
    // in turn, then the list again; enter or space presses the ringed one, esc
    // leaves it, any other key leaves it and does what it does in the list.
    if (k === "tab") {
      this.stop = lensStep(lensStops(this.lensAdd), this.stop, m.shift ? -1 : 1);
      done();

      return;
    }

    if (this.stop) {
      if (k === "enter" || k === "space" || k === "escape") {
        if (k === "escape") this.stop = null;
        else this.pressStop(this.stop, cx);

        done();

        return;
      }

      this.stop = null;
    }

    const upper = m.shift || /^[A-Z]$/.test(k);
    const low = k.toLowerCase();
    const rows = this.shown();
    const i = rows.findIndex((r) => r.path === this.sel);
    const row = rows[i];

    // A move ends a shift-range; in V's range it grows the range.
    const moved = (to: number): void => {
      this.select(rows, to);

      if (this.range) this.markRange(this.sel);
    };

    if (this.range?.shift && !m.shift && ["j", "k", "down", "up"].includes(k)) this.range = null;

    if (k === "escape" && (this.marked.size || this.range)) this.unmark();
    else if (m.shift && (k === "down" || k === "up") && row) {
      // shift-↑↓: marks while moving, from where it started.
      if (!this.range) this.range = { anchor: row.path, base: new Set(this.marked), shift: true };

      moved(k === "down" ? i + 1 : i - 1);
      this.markRange(this.sel);
    } else if (low === "v" && upper) {
      // V: a range from here, as vim's line-wise visual mode; V again keeps the marks and ends it.
      if (this.range) this.range = null;
      else if (row) {
        this.range = { anchor: row.path, base: new Set(this.marked), shift: false };
        this.markRange(row.path);
      }
    } else if (k === "t" && row && !row.head) {
      this.markToggle(row.path);
      this.select(rows, i + 1);
    } else if (k === "space") this.toggleLook(cx);
    else if (low === "j" && upper) this.scrollLook(1);
    else if (low === "k" && upper) this.scrollLook(-1);
    else if (k === "<" || (k === "," && m.shift)) this.resizeLook(-1);
    else if (k === ">" || (k === "." && m.shift)) this.resizeLook(1);
    else if (low === "h" && upper) this.setFilter("hidden", cx);
    else if (low === "i" && upper) this.setFilter("ignored", cx);
    else if (low === "a") this.startDraft(upper ? "folder" : "file", row ?? null, cx);
    else if (low === "r" && upper) this.startRename(row, cx);
    else if (low === "p" && upper) this.paste(row ?? null, cx);
    else if (k === "x") this.cutRow(row, cx);
    else if (k === "d") this.askDelete(row, cx);
    else if (k === "/" || e.key_char === "/") this.startFind(cx);
    else if (k === "escape") {
      if (this.query) this.clearSearch(cx);
      else if (this.alone) this.closePane();
      else this.leave();
    } else if (k === "q") this.closePane();
    else if (k === "[" || k === "backspace") this.back(cx);
    else if (k === "]") this.forward(cx);
    else if (k === "j" || k === "down") moved(i + 1);
    else if (k === "k" || k === "up") moved(i < 0 ? 0 : i - 1);
    else if (low === "g" && upper) {
      moved(rows.length - 1);
      this.gAt = 0;
    } else if (k === "g") {
      if (Date.now() - this.gAt < 500) {
        this.gAt = 0;
        moved(0);
      } else this.gAt = Date.now();
    } else if ((k === "l" || k === "right" || k === "enter") && row?.head) this.reveal(row.path, cx);
    else if ((k === "l" || k === "right") && row) {
      if (!row.dir) this.openFile(row.path, cx);
      else if (!this.folders.has(row.path)) this.toggle(row.path, cx);
      else this.select(rows, i + 1);
    } else if ((k === "h" || k === "left") && row && !row.hit) {
      if (row.dir && this.folders.has(row.path)) this.toggle(row.path, cx);
      else if (row.depth > 0) this.select(rows, rows.findIndex((r) => r.path === parent(row.path)));
    } else if (k === "enter" && row) {
      if (row.dir) this.toggle(row.path, cx);
      else this.openFile(row.path, cx);
    } else if (k === "E" || (low === "e" && m.shift)) this.terminalEdit(row?.path ?? "", cx);
    else if (k === "e") {
      if (row && !row.dir && viewerFor(row.path)?.other === "system") this.openFile(row.path, cx, true);
      else this.edit(row?.path ?? "", cx);
    } else if (k === "v") this.nvim(row ?? null);
    else if (k === "w" && row && !row.dir) this.openWeb(row.path, cx);
    else if (k === "p") this.preview(row, cx);
    else if (k === "o") this.openPane(row?.dir ? row.path : "");
    else if (k === "y") this.copy(row?.path ?? "", cx);
    else if (k === "m") this.openMenu(row ?? this.rootRow(), cx);
    else if (k === "-") {
      const from = this.root;

      this.go(parent(this.root), cx);
      this.pendingSel = from;
    } else if (k === "." && row) {
      const into = row.dir ? row.path : row.path.includes("/") ? parent(row.path) : "";

      if (into) this.go(`${this.root}/${into}`, cx);
    } else if (k === "r") this.refresh(cx);
    else return;

    done();
  }

  // ---- parts

  chip(t: Theme, id: string, label: string, action: (cx: Context) => void, on = true): Element {
    return h_flex().id(id).relative().h(20).px(6).flex_none().items_center()
      .text_color(on ? t.muted : t.ansi0).when(on, (el) => el.hover((s) => s.text_color(t.foreground)))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        if (on) action(cx);

        cx.notify();
      })
      .child(div().relative().child(label));
  }

  toolbar(t: Theme, w: number, focused: boolean): Element {
    let changed = 0;

    for (const m of this.marks.values()) if (m !== "•") changed++;

    const name = this.root === "/" ? "/" : this.root.split("/").pop() ?? "";
    const fit = toolbarFit(w, { alone: this.alone, branch: this.branch, changed, name });
    const branch = this.branch;

    return h_flex().id("nf-toolbar").relative().h(34).flex_none().px(10).gap(8).items_center().text_size(11).overflow_hidden()
      .when(fit.eyebrow, (el) => el.child(div().flex_none().text_color(focused ? t.accent : t.ansi8).child("FILES")))
      .child(this.chip(t, "nf-back", "‹", (cx) => this.back(cx), this.root !== "/" || this.nav.past.length > 0))
      .child(this.chip(t, "nf-forward", "›", (cx) => this.forward(cx), this.nav.future.length > 0))
      .child(h_flex().flex_1().min_w(0).gap(6).items_baseline()
        .child(div().flex_shrink(1).min_w(fit.name).truncate().text_color(t.foreground).child(name))
        .when(fit.path, (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(tilde(parent(this.root))))))
      .children(fit.branch && branch ? [div().flex_none().max_w(140).truncate().text_color(t.ansi2).child(branch)] : [])
      .when(fit.changed, (el) => el.child(div().flex_none().text_color(t.ansi3).child(`±${changed}`)))
      .when(fit.look, (el) => el.child(this.lookChip(t)))
      .when(fit.edit, (el) => el.child(this.chip(t, "nf-edit", "edit", (cx) => this.edit("", cx))))
      .when(fit.close, (el) => el.child(h_flex().id("nf-close").relative().size(20).flex_none().items_center().justify_center()
        .text_color(t.muted).hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click(() => this.closePane())
        .child(svg(`${ICONS}/x.svg`).size(12))))
      // The keyboard is here: the rule under the toolbar lights up.
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(focused ? t.accent : t.ansi0, 1)));
  }

  /** The preview split's switch: where it opens (right or bottom), lit while it's on. */
  lookChip(t: Theme): Element {
    const on = this.lookState.on;
    const side = this.side ?? lookSide(this.size);

    return h_flex().id("nf-look-chip").relative().size(20).flex_none().items_center().justify_center()
      .text_color(on ? t.accent : t.muted).hover((s) => s.text_color(on ? t.accent : t.foreground))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        this.toggleLook(cx);
        cx.notify();
      })
      .child(svg(`mods/${MOD}/look-${side}.svg`).relative().size(12));
  }

  /** A folder in the preview: its name, what it holds (as the filters list it), its first entries. */
  folderView(t: Theme, d: LookDir): Element {
    const entries = (d.entries ?? []).filter((e) => lists(d.rel ? `${d.rel}/${e.name}` : e.name, this.filters, this.ignored));
    const facts = d.error ? "" : d.entries ? folderFacts(entries) : "listing…";

    const bar = h_flex().id("nf-look-bar").relative().h(26).flex_none().px(10).gap(8).items_center().text_size(11).overflow_hidden()
      .child(div().flex_none().text_color(t.ansi8).child("DIR"))
      .child(div().flex_shrink(1).min_w(0).truncate().text_color(t.foreground).child(d.abs === "/" ? "/" : base(d.abs)))
      .when(Boolean(facts), (el) => el.child(div().flex_shrink(1).min_w(0).truncate().text_color(t.dim).child(facts)))
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.ansi0, 1)));

    const list = v_flex().flex_1().min_h(0).overflow_hidden().py(4).text_size(12)
      .children(d.error ? [div().px(12).py(6).text_size(11).text_color(t.dim).child(d.error)] : [])
      .children(entries.slice(0, 120).map((e, i) => h_flex().id(`nf-lk-${i}`).h(20).flex_none().px(12).gap(6).items_center()
        .child(svg(`mods/files/${e.dir ? "folder" : "file"}.svg`).relative().size(12).flex_none().text_color(e.dir ? t.ansi4 : t.dim))
        .child(div().min_w(0).truncate().text_color(e.dir ? t.foreground : t.muted).child(e.name))));

    return v_flex().id("nf-look-dir").size_full().bg(t.background).child(bar).child(list);
  }

  /** The tree (with its hint line) and the preview, split along `side`; the
   *  preview `px` along it. The divider drags; its line lights while it does. */
  split(t: Theme, side: Side, px: number, list: Element, foot: Element | null): Element {
    const right = side === "right";

    // h_flex centers its items: the tree's column is stretched to the split's height by hand.
    const tree = v_flex().id("nf-treecol").relative().flex_1().min_w(0).min_h(0).when(right, (el) => el.h_full())
      .child(list).children(foot ? [foot] : []);

    // At rest a dotted rule; under the pointer or held, a lit band the width of the grab area.
    const lit = Boolean(this.dragging) || this.dividerHover;
    const band = lit ? DIVIDER - 2 : 1;
    const at = Math.floor((DIVIDER - band) / 2);
    const line = dither(lit ? t.accent : t.ansi8, 1);

    const divider = div().id("nf-divider").relative().flex_none()
      .when(right, (el) => el.w(DIVIDER).h_full().cursor_col_resize().child(div().absolute().top(0).bottom(0).left(at).w(band).child(line)))
      .when(!right, (el) => el.h(DIVIDER).w_full().cursor_row_resize().child(div().absolute().left(0).right(0).top(at).h(band).child(line)))
      .on_hover((over, cx) => {
        if (over !== this.dividerHover) {
          this.dividerHover = over;
          cx.notify();
        }
      })
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        this.dragging = side;
        this.focus();
        cx.notify();
      });

    const shown = this.lookDir ? this.folderView(t, this.lookDir) : this.look;

    const look = div().id("nf-look").relative().flex_none().overflow_hidden()
      .when(right, (el) => el.w(px).h_full()).when(!right, (el) => el.h(px).w_full())
      // A right-click here isn't a row's: no menu.
      .on_mouse_down("right", stop)
      .children(shown ? [shown] : []);

    return (right ? h_flex() : v_flex()).id("nf-split").relative().flex_1().min_h(0).min_w(0).child(tree).child(divider).child(look);
  }

  /** A filter's switch: an open eye while that kind is listed; a shut one,
   *  the label struck through and how many it leaves out, while it's hidden. */
  filterChip(t: Theme, id: string, label: string, on: boolean, cut: number, action: (cx: Context) => void, ringed = false): Element {
    return h_flex().id(id).relative().h(20).px(4).gap(4).flex_none().items_center()
      .when(ringed, (el) => el.child(ring(t)))
      .hover((s) => s.bg(`${t.ansi0}55`))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => action(cx))
      .child(svg(on ? `${ICONS}/eye.svg` : `mods/${MOD}/eye-off.svg`).relative().size(11).flex_none().text_color(on ? t.dim : t.ansi3))
      .when(Boolean(label), (el) => el.child(div().relative().text_color(t.muted).when(!on, (el) => el.line_through()).child(label)))
      .when(!on && cut > 0, (el) => el.child(div().relative().text_color(t.ansi3).child(String(cut))));
  }

  /** + file / + folder (or a bare +): `a` / `A`'s name row; the accent +, a muted word. */
  addChip(t: Theme, kind: NewKind, label: string, ringed: boolean): Element {
    const word = label.replace(/^\+\s*/, "");

    return h_flex().id(`nf-add-${kind}`).relative().h(20).px(4).gap(7).flex_none().items_center().text_color(t.muted)
      .hover((s) => s.bg(`${t.ansi0}55`).text_color(t.foreground))
      .when(ringed, (el) => el.child(ring(t)))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        this.addNew(kind, cx);
        cx.notify();
      })
      .child(div().relative().text_color(t.accent).child("+"))
      .when(Boolean(word), (el) => el.child(div().relative().child(word)));
  }

  /** The line under the toolbar: the filter as you type, the two switches,
   *  the new-item chips and ? keys. Narrow (the docked panel), two rows
   *  (logic.ts lensLayout): the filter at full width, a click anywhere on its
   *  row starts it; the switches and chips on the row under it. */
  lens(t: Theme, w: number, found: number): Element {
    const live = this.typing || this.finding || Boolean(this.query);
    const cut = this.cut;
    const searching = Boolean(this.query.trim());
    // What fits this width: the placeholder shortens, then the switches' labels; then two rows.
    const fit = lensLayout(w, { cut: { hidden: this.filters.hidden ? 0 : cut.hidden, ignored: this.filters.ignored ? 0 : cut.ignored }, count: searching ? found : null });
    const [hLabel, iLabel] = fit.labels;

    this.lensAdd = fit.add;
    this.lensRows = fit.rows;

    const at = this.stop;
    const row = (id: string): Element => h_flex().id(id).relative().h(26).flex_none().pl(10).pr(6).gap(6).items_center().text_size(11).overflow_hidden();

    const find = h_flex().id("nf-find").relative().flex_1().min_w(0).h_full().items_center().overflow_hidden()
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        this.startFind(cx);
      })
      .child(live && this.input
        ? Input.new(this.input).flex_1().min_w(0).h_full().text_size(11).text_color(t.foreground)
        : h_flex().min_w(0).gap(5).text_color(t.dim)
          .child(div().flex_none().text_color(t.accent).child("/"))
          .when(Boolean(fit.find), (el) => el.child(div().min_w(0).truncate().child(fit.find))));

    const icon = svg(`${ICONS}/search.svg`).relative().size(11).flex_none().text_color(this.typing ? t.accent : t.dim);
    const count = searching && fit.count ? [div().flex_none().text_color(t.dim).child(`${found}`)] : [];
    const adds: readonly (readonly [NewKind, string])[] = ADDS[fit.add];

    const chips = [
      this.filterChip(t, "nf-hidden", hLabel, this.filters.hidden, fit.cuts ? cut.hidden : 0, (cx) => this.setFilter("hidden", cx), at === "hidden"),
      this.filterChip(t, "nf-ignored", iLabel, this.filters.ignored, fit.cuts ? cut.ignored : 0, (cx) => this.setFilter("ignored", cx), at === "ignored"),
      ...adds.map(([kind, label]) => this.addChip(t, kind, label, at === `add-${kind}`)),
    ];

    // ? keys: the line's last item (keyhelp.ts).
    const keys = keysHint(t, "nf-keys", this.keysShown, () => {
      this.keysShown = !this.keysShown;
    }).relative().h(20).px(4)
      .when(at === "keys", (el) => el.child(ring(t)));

    const rule = (): Element => div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.ansi0, 1));

    if (fit.rows === 1) return row("nf-lens").child(icon).child(find).children(count).children(chips).child(keys).child(rule());

    // Two rows: the filter's own row takes a click anywhere (the icon, the gap, the count too).
    return v_flex().id("nf-lens").relative().flex_none()
      .child(row("nf-lens-find").cursor_text()
        .on_mouse_down("left", (_e, cx) => {
          cx.stop_propagation();
          this.startFind(cx);
        })
        // Typing: the field's own frame, so it reads as a place to type.
        .when(live, (el) => el.child(div().absolute().left(4).right(4).top(3).bottom(3).border(1).border_color(this.typing ? t.accent : t.ansi0)))
        .child(icon).child(find).children(count)
        .when(Boolean(this.query), (el) => el.child(div().flex_none().text_color(t.dim).child("esc clears")))
        .child(div().absolute().left(10).right(10).bottom(0).h(1).opacity(0.5).child(dither(t.ansi0, 1))))
      .child(row("nf-lens-chips").children(chips).child(div().flex_1()).child(keys).child(rule()));
  }

  /** `?`: every key, in the list's place (keyhelp.ts); one column at the panel's width. */
  keysStrip(t: Theme, width = this.size.width): Element {
    return keysView(t, { id: "nf-keys-strip", title: "files", list: KEYS, narrow: width < 2 * SECTION, close: () => {
      this.keysShown = false;
    } });
  }

  /** Text with the matched characters in the accent. */
  matched(t: Theme, id: string, text: string, ranges: readonly Range[], color: Color): Element {
    return h_flex().relative().flex_1().min_w(0).overflow_hidden()
      .children(marks(text, ranges).map(([piece, hit], j) => div().id(`${id}-${j}`).flex_none().text_color(hit ? t.accent : color).child(piece)));
  }

  row(t: Theme, r: Row, focused: boolean): Element {
    // The name's input (a new item's row, or the row being renamed) in place of the name.
    const editing = Boolean(r.draft) || (this.draft?.kind === "rename" && this.draft.path === r.path);
    const sel = editing || (r.path === this.sel && !this.draft);
    const open = r.dir && this.folders.has(r.path);
    const cut = !r.draft && this.isCut(this.abs(r.path));
    const ask = this.ask;
    const doomed = ask ? (ask.set ? ask.set.some((x) => x.path === r.path) : ask.path === r.path) : false;
    // Marked (t, cmd-click, a range); dragged; the folder a drop would land in.
    const marked = this.marked.has(r.path);
    const dragged = Boolean(this.drag?.paths.includes(r.path));
    const target = Boolean(this.drag?.ok) && this.drag?.into === r.path && r.path !== "";
    const mark = cut ? "cut" : r.hit ? (r.git && markColor(t, r.git) ? r.git : null) : this.marks.get(`${this.root}/${r.path}`) ?? null;
    const hidden = r.name.startsWith(".");
    const tinted = mark && mark !== "•" ? markColor(t, mark) : null;
    const color = doomed ? t.ansi1 : cut ? t.dim : sel ? t.foreground : tinted ?? (hidden || r.ignored ? t.dim : r.dir ? t.foreground : t.muted);
    const input = this.nameInput;

    const name = editing && input ? Input.new(input).flex_1().min_w(0).h(ROW).text_size(12).text_color(t.foreground)
      : r.hit ? this.matched(t, `nf-m-${r.path}`, r.name, r.ranges, cut ? t.dim : color)
      : div().relative().flex_1().min_w(0).truncate().text_color(r.head || dragged ? t.dim : marked ? t.accent : color).child(r.name);

    return h_flex().id(`nf-${r.path}`).relative().h(ROW).w_full().pl(8 + r.depth * 14).pr(10).gap(6).items_center()
      .hover((s) => s.bg(`${t.ansi0}55`))
      // A marked row: a light accent dither and a dotted accent edge on the left.
      .when(marked && !sel, (el) => el.child(dither(`${t.accent}30`, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).child(dither(t.accent, 1))))
      .when(sel, (el) => el.child(dither(focused ? t.ansi0 : `${t.ansi0}88`, 1))
        .when(marked, (el) => el.child(dither(`${t.accent}30`, 1)))
        .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(focused ? t.accent : t.ansi8)))
      // The folder a drop goes into: framed in the accent.
      .when(target, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)).child(dither(`${t.accent}40`, 1)))
      // Indent guides: one dotted rule per level.
      .children(Array.from({ length: r.depth }, (_, d) => div().absolute().top(0).bottom(0).left(14 + d * 14).w(1).opacity(0.5).child(dither(t.ansi0, 1))))
      .child(r.head ? div().w(10).flex_none() : r.dir ? svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).relative().size(10).flex_none().text_color(t.dim) : div().w(10).flex_none())
      .child(svg(`mods/files/${r.dir ? "folder" : "file"}.svg`).relative().size(12).flex_none()
        .text_color(r.dir ? (open ? t.accent : t.ansi4) : t.dim))
      .child(name)
      .children(mark && !editing ? [div().relative().flex_none().when(mark !== "cut", (el) => el.w(8))
        .text_color(mark === "•" || mark === "cut" ? t.ansi3 : markColor(t, mark) ?? t.ansi3).child(mark)] : []);
  }

  menuBox(t: Theme, m: Menu): Element {
    const w = Math.min(240, this.size.width - 16);
    const h = m.items.length * MENU_ROW + 20;
    // The key column fits its widest key on one line (7 px a character at size 11, as git's menus).
    const keyW = keyColumn(m.items);
    const x = Math.max(8, Math.min(m.at.x, this.size.width - w - 8));
    const y = Math.max(8, Math.min(m.at.y, this.size.height - h - 8));

    const edge = (where: "top" | "bottom"): Element => h_flex().absolute().left(0).right(0).h(13).items_center().text_size(11)
      .when(where === "top", (el) => el.top(-6)).when(where === "bottom", (el) => el.bottom(-6))
      .child(div().h(1).w(8).flex_none().bg(t.accent))
      .when(where === "top", (el) => el.child(div().flex_shrink(1).min_w(0).px(4).truncate().text_color(t.foreground).child(m.row.path ? m.row.name.split("/").pop() ?? "" : tilde(this.root))))
      .child(div().h(1).flex_1().min_w(8).bg(t.accent));

    const rows = m.items.map((it, i) => h_flex().id(`nf-mi-${i}`).relative().h(MENU_ROW).px(10).gap(10).items_center().text_size(11)
      .hover((s) => s.bg(`${t.ansi0}66`))
      .on_mouse_move((_e, cx) => {
        if (m.n !== i) {
          m.n = i;
          cx.notify();
        }
      })
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.menu = null;
        this.act(it.act, m.row, cx);
        cx.notify();
      })
      .when(i === m.n, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
      .child(div().relative().w(keyW).min_w(keyW).flex_none().overflow_hidden().text_color(t.accent).child(it.key))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(i === m.n ? t.foreground : t.muted).child(it.label)));

    return div().id("nf-menu-layer").absolute().inset_0()
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        this.menu = null;
        cx.notify();
      })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.menu = null;
        cx.notify();
      })
      .child(v_flex().id("nf-menu").absolute().left(x).top(y).w(w).pt(10).pb(6).bg(t.background).border_l(1).border_r(1).border_color(t.accent)
        .on_mouse_down("left", stop)
        .children(rows)
        .child(edge("top")).child(edge("bottom")));
  }

  /** A key and what it does in the hint line, clickable. */
  hintKey(t: Theme, id: string, key: string, label: string, action: (cx: Context) => void): Element {
    return h_flex().id(id).relative().flex_none().gap(4).items_center()
      .hover((s) => s.bg(`${t.ansi0}55`))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        action(cx);
        cx.notify();
      })
      .child(div().text_color(t.accent).child(key))
      .child(div().text_color(t.muted).child(label));
  }

  /** The hint line at the bottom: the delete question, the name input's keys,
   *  what an operation said, else the copy, search and listing notes. */
  footer(t: Theme, searching: boolean): Element | null {
    const line = (): Element => v_flex().id("nf-foot").flex_none().px(10).py(4).gap(3).text_size(10).text_color(t.dim).border_t(1).border_color(t.ansi0);
    const keys = (...ks: Element[]): Element => h_flex().flex_wrap().gap_x(12).gap_y(2).children(ks);
    const d = this.drag;

    if (d) {
      return line().child(div().text_color(d.ok ? t.foreground : t.dim)
        .child(d.into === null ? `Drop on a folder, or below the rows for ${tilde(this.root)} · esc cancels`
          : d.ok ? `Drop: ${this.dragLabel(d)} into ${d.into ? `${base(d.into)}/` : tilde(this.root)}${d.moving.length < d.paths.length ? ` (${d.paths.length - d.moving.length} already there)` : ""}`
          : d.why ?? ""));
    }

    const a = this.ask;

    if (a) {
      return line()
        .child(div().text_color(a.trash ? t.foreground : t.ansi1).child(a.set ? deleteManyQuestion(a.set, Boolean(a.trash)) : deleteQuestion(a.name, a.dir, Boolean(a.trash))))
        .child(keys(
          this.hintKey(t, "nf-ask-yes", "y", a.trash ? "move to the Trash" : "delete", (cx) => {
            this.ask = null;
            this.remove(a, cx);
          }),
          this.hintKey(t, "nf-ask-no", "esc", "keep it", () => {
            this.ask = null;
          })));
    }

    const draft = this.draft;

    if (draft) {
      const rename = draft.kind === "rename";

      const what = draft.kind === "rename" ? `Rename “${draft.name}”: a path moves it`
        : `New ${draft.kind} in ${draft.dir ? `${base(draft.dir)}/` : tilde(this.root)}${draft.kind === "file" ? ": end with / for a folder" : ""}`;

      const msg = this.msg;

      return line()
        .children(msg ? [div().text_color(msg.error ? t.ansi1 : t.foreground).child(msg.text)] : [])
        .child(div().text_color(t.foreground).child(what))
        .child(keys(
          this.hintKey(t, "nf-draft-ok", "enter", rename ? "rename" : "create", (cx) => this.commitDraft(cx)),
          this.hintKey(t, "nf-draft-no", "esc", "cancel", (cx) => this.endDraft(cx))));
    }

    const text = this.msg ? this.msg.text : this.copied ? this.copiedText ?? "path copied" : searching && this.note ? this.note
      : this.limited ? `Listing cut at ${PER_FOLDER} per folder, ${TOTAL} in all` : null;

    // Marks: how many, and what acts on them.
    if (!text && this.marked.size) {
      const n = this.marked.size;

      return line()
        .child(div().text_color(t.accent).child(`${n} marked${this.range ? " · marking a range (V ends)" : ""}`))
        .child(keys(
          this.hintKey(t, "nf-set-d", "d", "delete", (cx) => this.askDelete(this.markedRows()[0], cx)),
          this.hintKey(t, "nf-set-x", "x", "cut", (cx) => this.cutRow(this.markedRows()[0], cx)),
          this.hintKey(t, "nf-set-y", "y", "copy paths", (cx) => this.copySet(cx)),
          this.hintKey(t, "nf-set-esc", "esc", "unmark", () => this.unmark())));
    }

    if (!text) return null;

    return line().child(div().text_color(this.msg?.error ? t.ansi1 : t.dim).child(text));
  }

  empty(t: Theme, title: string, hint: string | null, add = false): Element {
    return v_flex().flex_1().min_h(0).items_center().justify_center().gap(10).px(16).text_size(11)
      .child(svg(`${ART}/moon-8.svg`).w(44).h(44).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child(title))
      .children(hint ? [div().text_center().text_color(t.ansi8).child(hint)] : [])
      // An empty folder: its first file, as a / + file make it.
      .when(add, (el) => el.child(h_flex().id("nf-empty-add").relative().h(20).px(6).gap(7).items_center().text_color(t.muted)
        .hover((s) => s.bg(`${t.ansi0}55`).text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => {
          this.addNew("file", cx);
          cx.notify();
        })
        .child(div().text_color(t.accent).child("+")).child(div().child("new file")).child(div().text_color(t.ansi8).child("a"))));
  }

  /** The divider's drag ends: its share is kept. */
  endDivider(): boolean {
    const side = this.dragging;

    if (!side) return false;

    if (this.dragged !== null) this.saveLook(side === "right" ? { ...this.lookState, right: this.dragged } : { ...this.lookState, bottom: this.dragged });

    this.dragging = null;
    this.dragged = null;

    return true;
  }

  override render(cx: Context): Element {
    const t = theme();
    const rows = this.shown();

    this.publish();

    if (this.pendingSel && rows.length) {
      const back = this.pendingSel.startsWith(`${this.root}/`) ? this.pendingSel.slice(this.root.length + 1).split("/")[0] : null;

      this.pendingSel = null;

      if (back) {
        const i = rows.findIndex((r) => r.path === back);

        if (i >= 0) this.select(rows, i);
      }
    }

    if (this.want) {
      const i = rows.findIndex((r) => r.path === this.want);

      if (i >= 0) {
        this.want = null;
        this.select(rows, i);
      }
    }

    if (this.sel && !this.want && !rows.some((r) => r.path === this.sel)) this.sel = null;

    const focused = Boolean(this.handle?.is_focused()) || this.typing || this.naming;
    // The new item's input row where it will appear, put on screen once.
    const list = this.withDraft(rows);

    this.listed = list;

    // Marks on rows no longer shown (folded away, filtered out, gone) drop out.
    if (this.marked.size && !this.drag) {
      const shownNow = new Set(rows.map((r) => r.path));

      if ([...this.marked].some((p) => !shownNow.has(p))) this.marked = new Set([...this.marked].filter((p) => shownNow.has(p)));
    }

    const draft = this.draft;

    if (draft && !draft.shown) {
      const i = list.findIndex((r) => r.draft || (draft.kind === "rename" && r.path === draft.path));

      if (i >= 0) {
        draft.shown = true;
        this.scroll?.scroll_to_item(i);
      }
    }

    const w = this.size.width;
    const searching = Boolean(this.query.trim());
    let body: Element;

    if (searching && this.hits && !rows.length) body = this.empty(t, "No files match", this.note ?? `“${this.query.trim()}” under ${tilde(this.root)}`);
    else if (searching && !this.hits) body = this.empty(t, "Searching…", null);
    else if (this.error && !list.length) body = this.empty(t, "Can't read this folder", this.error);
    else if (!list.length) body = this.empty(t, this.loading ? "Listing files…" : "Nothing here", this.loading ? null : tilde(this.root), !this.loading);
    else {
      const rowsList = v_virtual_list("nf-rows", list.length, ROW, (i) => list[i]?.path ?? "",
        (range) => list.slice(range.start, range.end).map((r) => this.row(t, r, focused)))
        .on_item_click((path, cx) => this.pick(path, cx))
        // The pane's own right press comes after this and opens the menu for the row.
        .on_item_secondary_click((path) => {
          this.pressed = rows.find((r) => r.path === path) ?? null;
        })
        .size_full();

      body = div().id("nf-tree").relative().flex_1().min_h(0).py(4).text_size(12)
        // A drop below the rows goes into the root: the list framed in the accent.
        .when(Boolean(this.drag?.ok) && this.drag?.into === "", (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
        .child(this.scroll ? rowsList.track_scroll(this.scroll) : rowsList)
        .child(Scrollbar.vertical("nf-rows").absolute().inset_0());
    }

    const foot = this.footer(t, searching);
    // The preview split: its side follows the pane's shape; no room for both parts, no split.
    const side = this.lookState.on && this.look ? lookSide(this.size, this.side) : null;

    if (side) this.side = side;

    const px = side ? lookSize(this.size, side, this.dragged ?? this.lookState[side]) : null;

    if (px !== null) this.follow(cx);

    this.geo = { side, px };

    // A native view (PDF, clip, font) would cover the menu: set aside while it's open.
    const aside = Boolean(this.menu) && px !== null;

    if (aside !== this.aside) {
      this.aside = aside;
      cx.timer.after(0, () => this.natives("setVisible", { visible: !aside }));
    }

    const treeW = side === "right" && px !== null ? this.size.width - px - DIVIDER : this.size.width;
    // ?: the keys in the list's place, the toolbar and filter line stay (keyhelp.ts).
    const area = this.keysShown ? div().relative().flex_1().min_h(0).child(this.keysStrip(t, treeW)) : body;
    const menu = this.menu;
    const drag = this.drag;

    const el = v_flex().id("file-tree").relative().size_full().bg(t.background).text_color(t.foreground)
      .on_key_down((e, cx) => this.key(e, cx))
      // A row's click comes after this: alt-double-click opens a Markdown file as text.
      .on_mouse_down("left", (e, cx) => {
        if (this.endDivider()) cx.notify();

        this.alt = e.modifiers.alt;
        // A row's click comes after this: cmd and shift mark rather than open.
        this.mods = e.modifiers;
        this.pressAt(e);

        // A click in the name's input keeps it (a click on another row ends it: pick).
        if (!this.draft) this.focus();

        // A click elsewhere keeps what the delete question was about.
        if (this.ask) {
          this.ask = null;
          cx.notify();
        }
      })
      .on_mouse_down("right", (e, cx) => {
        if (e.local_position) this.mouse = { x: e.local_position.x / zoom(), y: e.local_position.y / zoom() };

        const row = this.pressed ?? this.rootRow();

        this.pressed = null;
        this.openMenu(row, cx);
      })
      .on_mouse_move((e, cx) => {
        this.mouse = { x: e.local_position.x / zoom(), y: e.local_position.y / zoom() };

        // The divider follows the pointer while it's held.
        if (this.dragging) {
          const f = dragShare(this.size, this.dragging, this.mouse);

          if (f !== null && f !== this.dragged) {
            this.dragged = f;
            cx.notify();
          }
        } else if (this.press) this.dragMove(this.mouse, cx);
        // A row held and moved: dragged.
      })
      .on_mouse_up("left", (_e, cx) => {
        const ended = this.endDivider();

        if (this.dragEnd(cx) || ended) cx.notify();
      })
      .on_hover((over, cx) => {
        if (over) return;

        const ended = this.endDivider();

        if (ended || this.drag) {
          this.cancelDrag();
          cx.notify();
        }
      })
      .on_size_change((size, cx) => {
        const s = { width: size.width / zoom(), height: size.height / zoom() };

        if (Math.abs(s.width - this.size.width) > 1 || Math.abs(s.height - this.size.height) > 1) {
          this.size = s;
          cx.notify();
        }
      })
      .child(this.toolbar(t, w, focused))
      .child(this.lens(t, w, rows.filter((r) => !r.head).length))
      .children(side === null || px === null ? [area, ...(foot ? [foot] : [])] : [this.split(t, side, px, area, foot)])
      .children(menu ? [this.menuBox(t, menu)] : [])
      // What's dragged, beside the pointer.
      .children(drag ? [this.ghost(t, drag)] : []);

    return this.handle ? el.track_focus(this.handle) : el;
  }

  /** What a drag carries, as said: the name, or how many (over a target: how many it would move). */
  dragLabel(d: Drag): string {
    const list = d.ok ? d.moving : d.paths;

    return list.length === 1 ? `“${base(list[0] ?? "")}”` : `${list.length} items`;
  }

  /** The dragged rows' label at the pointer: the name, or how many. */
  ghost(t: Theme, d: Drag): Element {
    const list = d.ok ? d.moving : d.paths;
    const n = list.length;
    const first = list[0] ?? "";
    const x = Math.min(d.at.x + 14, Math.max(0, this.size.width - 160));
    const y = d.at.y + 10;

    return h_flex().id("nf-ghost").absolute().left(x).top(y).max_w(200).h(20).px(8).gap(6).items_center().text_size(11)
      .bg(t.background).border_1().border_color(d.ok ? t.accent : t.ansi8)
      .child(svg(`mods/files/${n === 1 && !this.rowAt(first)?.dir ? "file" : "folder"}.svg`).relative().size(11).flex_none().text_color(d.ok ? t.accent : t.dim))
      .child(div().min_w(0).truncate().text_color(d.ok ? t.foreground : t.muted).child(n === 1 ? base(first) : `${n} items`));
  }
}
