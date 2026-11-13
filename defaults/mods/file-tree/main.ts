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
// Double-click a file (enter, the menu's Open): a preview file (a picture,
// PDF, font, clip, database) in this pane's own preview pane, one file at a
// time, unless this pane's editor is in the tab: then a drawn tab of it; any
// other file a tab of the app's editor (editor-route.ts `look`): Markdown in
// the editor's view for it (alt-double-click: as text), a table or patch
// drawn. With this pane's preview pane there and no editor of its own, the
// editor takes the preview pane's place, its file the first tab
// (routing.ts). alt-double-click on a preview file: the system's app.
// `p` (the menu's "Open in its viewer pane") opens Markdown in the Markdown
// viewer (markdown) and the rest in the preview (this pane's preview pane);
// so does another machine's file. Click a
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

import { View, div } from "gpui-kit";
import type { AsyncContext, Context, Element, Entity, FocusHandle, KeyEvent, Modifiers } from "gpui-kit";
import type { Props } from "gpui-shell";
import * as herdr from "herdr";
import type { Theme } from "herdr";
import { v_flex, VirtualListScrollHandle, InputState } from "gpui-base";
import { props, theme, settings, run, panes, spaces, focused, nextCommand, home, shared, setShared } from "herdr";
import { readShared, readSharedMap, writeSharedMap } from "./guard.ts";
import type { Filters, HeadRow, HitRow, Nav, Row, TreeRow, Act } from "./logic.ts";
import { filterDefaults, newNav, navGo, navBack, navForward, rangePaths } from "./logic.ts";
// The preview split: the preview pane's own viewer (a copy of preview/viewer.ts).
import type { Menu, Draft, Ask, Msg, MarkRange, Drag, Press, LookDir, Geo, FilesProps, SayHow, Hit } from "./state.ts";
import { isFilesProps, FILTERS, LOOK, MOD, isAlone, FROM, NATIVE_IDS, DRAFT, DOUBLE } from "./state.ts";
import { keptFor, loadFolderOf, refreshTree, reroot, shownRows, toggleFolder, treeRows, watchTree } from "./tree.ts";
import { mountLook, scrollLookBy, toggleLook, placeLook } from "./look.ts";
import { enterRow, reveal, runSearch } from "./search.ts";
import { editPath, openFileAt, ownPane, publish } from "./opening.ts";
import { menuBox, menuKey, openMenu, runAct } from "./menu.ts";
import { commitDraft, endDraft, selectStem, withDraft } from "./file-ops.ts";
import { ghost, hitAt, markToggle, moveSet, unmark, withPointer } from "./drag.ts";
import { drawKeysStrip, drawLens, drawToolbar, footer } from "./toolbar.ts";
import { drawFolderView, drawRow, drawSplit, selectRow, settleSelection, listOf, listBody } from "./list-view.ts";
import { keyDown } from "./input.ts";
import type { Adds, Cut, Stop } from "./fit.ts";
import type { At, Entry, LookState, Side } from "./split-size.ts";
import type { Size } from "./image.ts";
import { newLook, DIVIDER } from "./split-size.ts";
import type { ViewerProps } from "./viewer-state.ts";
import { hasDatabases } from "./viewer-table.ts";

export default class Files extends View {
  on: string | null = null;
  slot: string | null = null;
  // A pane of its own (a folder link, files.open): closes itself, opens files beside itself.
  alone = false;
  // The Databases mod is installed: a database file's menu offers it (b).
  dbMod = false;
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
    cx.spawn(async (cx) => {
      this.dbMod = await hasDatabases();
      cx.notify();
    });

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
      enterRow(this, cx);
      cx.notify();
    });

    this.input = input;

    const name = InputState.new({ placeholder: "name" });

    name.on("focus", (_e, cx) => {
      this.naming = true;
      selectStem(this);
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
      commitDraft(this, cx);
      cx.notify();
    });

    this.nameInput = name;
    this.scroll = VirtualListScrollHandle.new();
    this.handle = cx.focus_handle();

    const look = slot ? readSharedMap(shared, LOOK).get(slot) : undefined;

    this.lookState = { ...newLook(), ...look };
    this.lookProps = { embedded: true, path: null, on: this.on };

    if (this.lookState.on) mountLook(this, cx);

    reroot(this, pr.path || pr.folder || home(), cx);

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
        else if (c === "look" && (this.alone || this.isFocusedPane())) toggleLook(this, cx);

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
    const mine = ownPane(this) ?? (this.alone ? null : this.panel());

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

      if (rows.length) selectRow(this, rows, 0);
    }

    cx?.notify();
  }

  /** esc in the panel: the keyboard back to the pane it came from (else the pane to the left). */
  leave(): void {
    const from = readShared(shared, FROM, null);
    const mine = ownPane(this) ?? this.panel();

    if (from && from !== mine?.pane && panes().some((p) => p.pane === from)) run("pane.focus", { pane: from });
    else run("pane.go", { direction: "left" });
  }

  // ---- the folders visited

  /** Roots the tree at `folder`, remembered for back. */
  go(folder: string, cx: Context): void {
    const step = navGo(this.nav, this.root, folder);

    if (!step) return;

    this.nav = step.nav;
    reroot(this, step.to, cx);
  }

  /** Back: the folder before (with none, the parent); the folder left is picked there. */
  back(cx: Context): void {
    const step = navBack(this.nav, this.root);

    if (!step) return;

    const from = this.root;

    this.nav = step.nav;
    reroot(this, step.to, cx);
    this.pendingSel = from;
  }

  forward(cx: Context): void {
    const step = navForward(this.nav, this.root);

    if (!step) return;

    this.nav = step.nav;
    reroot(this, step.to, cx);
  }

  // ---- the tree

  async loadFolder(path: string, gen: number): Promise<void> {
    return loadFolderOf(this, path, gen);
  }

  refresh(cx: Context): void {
    return refreshTree(this, cx);
  }

  watch(cx: Context): void {
    return watchTree(this, cx);
  }

  toggle(path: string, cx: Context): void {
    return toggleFolder(this, path, cx);
  }

  /** The visible rows, depth-first: { path, name, dir, depth, ignored }; what
   *  the filters leave out is counted in `this.cut`. */
  rows(): TreeRow[] {
    return treeRows(this);
  }

  /** What the list shows: the search's hits while there's a query, else the tree. */
  shown(): readonly Row[] {
    return shownRows(this);
  }

  // ---- filters

  setFilter(name: keyof Filters, cx: Context): void {
    this.filters = name === "hidden" ? { ...this.filters, hidden: !this.filters.hidden } : { ...this.filters, ignored: !this.filters.ignored };

    // Kept per pane, by slot; panes that are gone drop out.
    if (this.slot) writeSharedMap(setShared, FILTERS, keptFor(this, readSharedMap(shared, FILTERS), this.slot, this.filters));

    if (this.query.trim()) this.search(cx);

    cx.notify();
  }

  // ---- the preview split

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

  /** J / K: the preview scrolls, the keyboard stays in the tree. */
  scrollLook(dir: number): void {
    return scrollLookBy(this, dir);
  }

  // ---- search

  /** Hits for the query, under their folders: fff's index of the root
   *  (findFiles); where it can't go (home, /, another machine), the folders
   *  listed so far. */
  search(cx: Context): void {
    return runSearch(this, cx);
  }

  // ---- the editor

  /** Edits a file (relative to the root) in the app's editor (editor),
   *  beside this tab's other panes; a folder, or a file on another machine, in
   *  $EDITOR (terminalEdit). */
  edit(path: string, cx: Context): void {
    return editPath(this, path, cx);
  }

  /** Opens a file: a preview file in this pane's preview pane unless its
   *  editor is there, else a tab of the editor (routing.ts): Markdown in its
   *  view, a table drawn (look), other text to edit; on
   *  another machine the viewers' panes, as before (the editor's drawn tabs
   *  read this computer's files). `other` (alt-double-click, `e`): Markdown,
   *  tables and patches as text, a picture in the system's app. */
  openFile(path: string, cx: Context, other = false): void {
    return openFileAt(this, path, cx, other);
  }

  // ---- the menu

  openMenu(row: Row, cx: Context | null): void {
    return openMenu(this, row, cx);
  }

  act(act: Act, row: Row, cx: Context): void {
    return runAct(this, act, row, cx);
  }

  menuKey(e: KeyEvent, cx: Context): void {
    return menuKey(this, e, cx);
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

  /** Closes the input; the keyboard back on the tree. */
  endDraft(cx: Context | null, focus = true): void {
    return endDraft(this, cx, focus);
  }

  // ---- several rows at once

  /** esc: the marks and a range go. */
  unmark(): void {
    return unmark(this);
  }

  /** Moves the set (absolute paths) into `into`, each tried; what failed is
   *  said afterwards with its reason. Nothing is overwritten. */
  moveSet(paths: readonly string[], into: string, cx: Context): void {
    return moveSet(this, paths, into, cx);
  }

  // ---- drag and drop

  /** What's under the pointer `at` (pane px): a row ({ row }), the empty
   *  space below the rows ({ root }), or nothing. Rows are ROW_H px each,
   *  from the list's scroll offset (VirtualListScrollHandle.offset). */
  hitAt(at: At | null): Hit | null {
    return hitAt(this, at);
  }

  /** The rows with the new name's input row where it will appear. */
  withDraft(rows: readonly Row[]): readonly Row[] {
    return withDraft(this, rows);
  }

  // ---- input

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

        markToggle(this, path);
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

    if (row.head) reveal(this, path, cx);
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
    keyDown(this, e, cx);
  }

  // ---- parts

  toolbar(t: Theme, w: number, focused: boolean): Element {
    return drawToolbar(this, t, w, focused);
  }

  /** A folder in the preview: its name, what it holds (as the filters list it), its first entries. */
  folderView(t: Theme, d: LookDir): Element {
    return drawFolderView(this, t, d);
  }

  /** The tree (with its hint line) and the preview, split along `side`; the
   *  preview `px` along it. The divider drags; its line lights while it does. */
  split(t: Theme, side: Side, px: number, list: Element, foot: Element | null): Element {
    return drawSplit(this, t, side, px, list, foot);
  }

  /** The line under the toolbar: the filter as you type, the two switches,
   *  the new-item chips and ? keys. Narrow (the docked panel), two rows
   *  (logic.ts lensLayout): the filter at full width, a click anywhere on its
   *  row starts it; the switches and chips on the row under it. */
  lens(t: Theme, w: number, found: number): Element {
    return drawLens(this, t, w, found);
  }

  /** `?`: every key, in the list's place (keyhelp.ts); one column at the panel's width. */
  keysStrip(t: Theme, width = this.size.width): Element {
    return drawKeysStrip(this, t, width);
  }

  row(t: Theme, r: Row, focused: boolean): Element {
    return drawRow(this, t, r, focused);
  }

  override render(cx: Context): Element {
    const t = theme();
    const rows = this.shown();

    publish(this);
    settleSelection(this, rows);

    const focused = Boolean(this.handle?.is_focused()) || this.typing || this.naming;
    const list = listOf(this, rows);
    const w = this.size.width;
    const searching = Boolean(this.query.trim());
    const body = listBody(this, t, rows, list, focused);
    const foot = footer(this, t, searching);
    const { side, px } = placeLook(this, cx);

    const treeW = side === "right" && px !== null ? this.size.width - px - DIVIDER : this.size.width;
    // ?: the keys in the list's place, the toolbar and filter line stay (keyhelp.ts).
    const area = this.keysShown ? div().relative().flex_1().min_h(0).child(this.keysStrip(t, treeW)) : body;
    const menu = this.menu;
    const drag = this.drag;

    const root = v_flex().id("file-tree").relative().size_full().bg(t.background).text_color(t.foreground)
      .on_key_down((e, cx) => this.key(e, cx));

    const el = withPointer(this, root)
      .child(this.toolbar(t, w, focused))
      .child(this.lens(t, w, rows.filter((r) => !r.head).length))
      .children(side === null || px === null ? [area, ...(foot ? [foot] : [])] : [this.split(t, side, px, area, foot)])
      .children(menu ? [menuBox(this, t, menu)] : [])
      // What's dragged, beside the pointer.
      .children(drag ? [ghost(this, t, drag)] : []);

    return this.handle ? el.track_focus(this.handle) : el;
  }

}
