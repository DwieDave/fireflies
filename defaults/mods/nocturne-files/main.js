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
// in shared `nocturne-files.filters` by slot. The filter line holds the
// filter, the two switches, + file / + folder and ? keys; narrower than the
// filter's whole placeholder allows (the docked panel), the filter takes a
// row of its own at full width and the rest the row under it (logic.js
// lensLayout). `/`
// filters the tree as you type: fff's fuzzy index of the root (findFiles),
// hits under their folders; elsewhere (home, /, another machine) the folders
// already listed.
//
// Files open in the app's editor (nocturne-editor, `editor.open`); folders,
// files on another machine and E go to $EDITOR. That one runs through this mod's bin/nocturne-edit (on another
// machine: `nocturne-edit` from its PATH) in a
// terminal pane beside this one. With nvim it listens on a socket per tab,
// so later picks open in that same nvim instead of a new pane.
//
// Click a file: select it (the keyboard comes here, the preview split follows).
// Double-click a file (enter, the menu's Open): a tab of the app's editor,
// whatever its kind (editor-route.js `look`): a Markdown file in the editor's view for it
// (alt-double-click: as text), a picture, PDF, table, patch, font or clip
// drawn in its tab by the preview's viewer (alt-double-click: the system's
// app, or a table or patch as text). `p` (the menu's "Open in its viewer
// pane") opens Markdown in the Markdown viewer (nocturne-markdown) and the
// rest in the preview (nocturne-preview), panes of their own; so does
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
// area by the preview pane's viewer (viewer.js and the files it imports are
// nocturne-preview's, copied unchanged; scripts/nocturne-preview-shared.test.ts
// keeps them alike), mounted as a nested view so its loading never redraws
// the tree. A pane taller than wide has it at the bottom, one wider than tall
// at the right; near square (logic.js SLACK) it stays where it was. Stepping
// loads only the row the selection rests on (REST ms); a folder shows what it
// holds. Text (code in the editor's colors, Markdown rendered), pictures,
// PDFs, tables, patches, databases, fonts and clips (never playing by
// themselves) show as the preview shows them, the first 256 KB of text; a
// binary or unreadable file says why in a line. On another machine only text
// is read. Each pane keeps its split (on, how big) by slot in shared
// `nocturne-files.look`. A native view (PDF, clip, font) steps aside while the
// menu is open, and goes when the split closes or a folder is picked.
//
// File operations run as one `sh -c` (logic.js OPS) on the pane's machine,
// paths as their own arguments: nothing is overwritten (a target that exists
// is refused), the root can't be renamed, cut or deleted, a folder can't go
// into itself. Every one is in the right-click menu too (the empty space's:
// new file / folder, paste, in the root). While a name's input or the delete
// question is open, keys go to it. What's cut is shared (`nocturne-files.cut`,
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
// Commands (keys.json, the palette, `herdr-app do nocturne-files.<c>`, to the
// focused files pane): keys (the ? overview), look (the preview split on / off).
//
// The keyboard: a copy takes it when its pane is the focused one as it opens
// (cmd-e's panel, files.open's pane), from pane.go ("focus"), and from
// cmd-e on an open panel (nocturne/files.js focusFiles: "take-panel").

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import * as herdr from "herdr";
import { openInEditor } from "./editor-route.js";
import { h_flex, v_flex, v_virtual_list, Scrollbar, VirtualListScrollHandle, InputState, Input } from "gpui-base";
import { props, theme, settings, exec, run, panes, spaces, terminals, focused, watchFolder, nextCommand, home, appHome, shared, setShared, findFiles, window as appWindow } from "herdr";
import { keyColumn, parent, filterDefaults, parseIgnored, isIgnored, isHidden, lists, fuzzy, grouped, nvimLaunch, menuItems, marks, newNav, navGo, navBack, navForward, lensLayout, toolbarFit, KEYS, ADDS, lensStops, lensStep, isHtml, fileUrl, webOpen, lookSide, lookSize, clampShare, dragShare, newLook, folderFacts, LOOK_STEP, DIVIDER, rangePaths, topLevel, deleteManyQuestion, dropRefusal, withChanges, cutItems, setMenuItems, treeTop, ROW_H, rowIndexAt, base, dirOf, join, relTo, resolveName, renameTarget, moveRefusal, stemRange, deleteQuestion, neighbour, movedFolders, parentsOf, cleanError, PROBE, OPS } from "./logic.js";
import { keysHint, keysView, keysKey, SECTION } from "./keyhelp.js";
// The preview split: the preview pane's own viewer (a copy of nocturne-preview/viewer.js).
import Viewer from "./viewer.js";

const ROW = 22;
const PER_FOLDER = 500, TOTAL = 5000;
const EDIT = "nocturne-edit";
/** The editor wrapper: the one this mod ships, here; another machine's own. */
const editTool = (on) => (on ? EDIT : `${appHome()}/mods/nocturne-files/bin/${EDIT}`);
/** Files the app has a viewer for, by type: the command that opens one there,
 *  and what the other way (alt-double-click, `e`) does instead. */
const VIEWERS = [
  { test: /\.(md|markdown)$/i, open: "markdown.open", other: "edit" },
  // The preview (nocturne-preview/kinds.js KINDS); tables and patches are text: e edits them.
  { test: /\.(csv|tsv|diff|patch)$/i, open: "preview.open", other: "edit" },
  { test: /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|svg|avif|hei[cf]|pdf|sqlite3?|db3?|ttf|otf|ttc|woff2?|mp4|m4v|mov|mp3|m4a|aac|wav|aiff?|flac|caf)$/i, open: "preview.open", other: "system" },
];
export const viewerFor = (name) => VIEWERS.find((v) => v.test.test(name)) ?? null;
/** Markdown files open in the viewer (markdown.open), not the editor. */
export const isMarkdown = (name) => viewerFor(name)?.open === "markdown.open";
const isEdit = (argv0) => argv0 === EDIT || Boolean(argv0?.endsWith(`/${EDIT}`));
// Git status letter → theme color.
const MARK = { A: "ansi2", M: "ansi3", D: "ansi1", U: "ansi1" };
const ART = "mods/nocturne/art";
const MOD = "nocturne-files";
const ICONS = "mods/workspace-chrome";
const FILTERS = `${MOD}.filters`, TITLES = `${MOD}.titles`, PATHS = `${MOD}.paths`;
/** The pane the keyboard came from into the panel (set by nocturne/files.js). */
const FROM = `${MOD}.from`;
/** What `x` cut, for `P` in any files pane: { abs, on, dir, name }. */
const CUT = `${MOD}.cut`;
/** Each pane's preview split by slot: { on, right, bottom } (logic.js newLook). */
const LOOK = `${MOD}.look`;
/** How long the selection rests before the preview loads it (ms): stepping through doesn't. */
const REST = 90;
/** The viewer's native views (nocturne-preview/viewer.js nativeId): set aside under a menu, dropped with the split. */
const NATIVE_IDS = ["preview-pdf", "preview-media", "preview-quicklook"];
/** The list's key for the new file's or folder's input row. */
const DRAFT = "\u0000draft";
const HITS = 200, MENU_ROW = 20;
/** Two clicks on a row this close (ms) are a double click. */
const DOUBLE = 400;
/** Renames, moves and deletes done here, for the editors to follow (logic.js withChanges). */
const CHANGES = "nocturne.files.changes";
/** A press that moves this far (px) is a drag; a folder under a drag unfolds
 *  after resting this long (ms); this close to the list's edge it scrolls. */
const SLOP = 4, UNFOLD = 700, EDGE = 18;
const zoom = () => Number(settings()?.zoom) || 1;

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
/** A 50% checker dither filling the parent (same as ../nocturne/kit.js). */
function dither(color, cell = 1) {
  const dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}

const stop = (_e, cx) => cx.stop_propagation();
/** The ring the filter line's stop wears under tab: a 1 px accent edge over it. */
const ring = (t) => div().absolute().inset_0().border(1).border_color(t.accent);
const tilde = (p) => {
  const h = home();
  return !p ? "" : p === h ? "~" : p.startsWith(h + "/") ? "~" + p.slice(h.length) : p;
};

/** A folder's entries, folders first, capped at PER_FOLDER (+1 to tell it was cut). */
async function directory(path, on) {
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "files", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    this.on = pr.on ?? null;
    this.slot = pr.slot ?? null;
    // A pane of its own (a folder link, files.open): closes itself, opens files beside itself.
    this.alone = Boolean(pr.path);
    this.filters = (this.slot && shared(FILTERS)?.[this.slot]) || filterDefaults(settings());
    this.query = ""; this.hits = null; this.seq = 0; this.typing = false; this.finding = false;
    // The filter line's stop tab / shift-tab rings (logic.js lensStops), null: the list.
    this.stop = null; this.lensAdd = "both";
    this.menu = null; this.mouse = { x: 40, y: 40 }; this.size = { width: 400, height: 600 };
    this.input = InputState.new({ placeholder: "filter files" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); this.search(cx); });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; this.finding = false; cx.notify(); });
    this.input.on("submit", (_e, cx) => { this.enter(cx); cx.notify(); });
    // The name a new file or folder gets, or a rename's: an input row in the tree.
    this.draft = null; this.ask = null; this.msg = null;
    this.nameInput = InputState.new({ placeholder: "name" });
    this.nameInput.on("focus", (_e, cx) => { this.naming = true; this.selectStem(); cx.notify(); });
    this.nameInput.on("blur", (_e, cx) => { if (this.naming && this.draft && !this.draft.busy) this.endDraft(cx, false); this.naming = false; cx.notify(); });
    this.nameInput.on("change", (_e, cx) => { if (this.msg?.draft) this.msg = null; cx.notify(); });
    this.nameInput.on("submit", (_e, cx) => { this.commitDraft(cx); cx.notify(); });
    this.scroll = VirtualListScrollHandle.new();
    // Several rows: the marked ones (paths), the row a shift-click or a range
    // starts from, the range being marked (V, shift-↑↓), a row being dragged.
    this.marked = new Set(); this.anchor = null; this.range = null; this.drag = null; this.press = null;
    this.handle = cx.focus_handle();
    this.nav = newNav();
    // The preview split: on or off and its shares, kept per pane like the filters.
    this.lookState = { ...newLook(), ...((this.slot && shared(LOOK)?.[this.slot]) || {}) };
    this.side = null; this.lookAt = null; this.lookDir = null; this.lookN = 0;
    this.lookProps = { embedded: true, path: null, on: this.on };
    if (this.lookState.on) this.mountLook(cx);
    this.reroot(pr.path || pr.folder || home(), cx);
    // Opened as the focused pane (cmd-e, files.open): the keyboard comes here,
    // which the app leaves with the window for a mod pane. Again a little
    // later, as the editor does, in case the window took it back meanwhile.
    for (const ms of [0, 120, 400]) cx.timer.after(ms, (cx) => { if (this.isFocusedPane() && !this.typing && !this.finding) this.takeKeys(cx); });
    // Remote folders can't be watched: poll those instead.
    cx.timer.every(this.on ? 15000 : 30000, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(`${MOD}.`, "");
        if (c === "focus" || (c === "take-panel" && !this.alone && this.isFocusedPane())) this.takeKeys(cx);
        else if (c === "keys" && (this.alone || this.isFocusedPane())) this.keysShown = !this.keysShown;
        else if (c === "look" && (this.alone || this.isFocusedPane())) this.toggleLook(cx);
        cx.notify();
      }
    });
  }

  // ---- the keyboard

  /** This copy's pane is the app's focused one. */
  isFocusedPane() {
    const mine = this.me() ?? (this.alone ? null : this.panel());
    return Boolean(mine && focused()?.pane === mine.pane);
  }

  /** The panel in the shown tab (a pane without a path of its own). */
  panel() {
    const tab = spaces().find((s) => s.active)?.tabs.find((c) => c.active)?.id;
    return panes().find((p) => p.mod === MOD && p.tab === tab && !p.props?.path) ?? null;
  }

  /** Takes the keyboard, with a row picked so j / k start somewhere. */
  takeKeys(cx) {
    this.handle.focus();
    if (!this.sel) { const rows = this.shown(); if (rows.length) this.select(rows, 0); }
    cx?.notify();
  }

  /** esc in the panel: the keyboard back to the pane it came from (else the pane to the left). */
  leave() {
    const from = shared(FROM), mine = this.me() ?? this.panel();
    if (from && from !== mine?.pane && panes().some((p) => p.pane === from)) run("pane.focus", { pane: from });
    else run("pane.go", { direction: "left" });
  }

  // ---- the folders visited

  /** Roots the tree at `folder`, remembered for back. */
  go(folder, cx) {
    const step = navGo(this.nav, this.root, folder);
    if (!step) return;
    this.nav = step.nav;
    this.reroot(step.to, cx);
  }

  /** Back: the folder before (with none, the parent); the folder left is picked there. */
  back(cx) {
    const step = navBack(this.nav, this.root);
    if (!step) return;
    const from = this.root;
    this.nav = step.nav;
    this.reroot(step.to, cx);
    this.pendingSel = from;
  }

  forward(cx) {
    const step = navForward(this.nav, this.root);
    if (!step) return;
    this.nav = step.nav;
    this.reroot(step.to, cx);
  }

  // ---- the tree

  reroot(folder, cx) {
    this.root = folder;
    this.gen = (this.gen ?? 0) + 1;
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set();
    this.marks = {}; this.ignored = new Set(); this.error = null; this.limited = false; this.sel = null;
    this.marked = new Set(); this.range = null; this.anchor = null;
    this.watched = null;
    if (this.query) this.clearSearch(cx);
    this.refresh(cx);
  }

  async loadFolder(path, gen) {
    const entries = await directory(path ? `${this.root}/${path}` : this.root, this.on);
    if (gen !== this.gen || (path && !this.folders.has(path))) return;
    const used = [...this.entries].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    const room = Math.max(0, Math.min(PER_FOLDER, TOTAL - used));
    if (entries.length > room) this.limited = true;
    this.entries.set(path, entries.slice(0, room).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
  }

  refresh(cx) {
    if (this.loading) { this.again = true; return; }
    const gen = this.gen, root = this.root, on = this.on;
    this.loading = true;
    this.limited = false;
    cx.spawn(async (cx) => {
      try {
        for (const path of ["", ...this.folders]) {
          if (gen !== this.gen) return;
          await this.loadFolder(path, gen);
        }
        const marks = {};
        let ignored = new Set();
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: root, on }).catch(() => null);
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would fire again.
          const st = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd: root, on }).catch(() => null);
          const base = top.stdout.trim();
          if (st?.code === 0) for (const entry of st.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            const mark = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
            const abs = `${base}/${entry.slice(3)}`;
            marks[abs] = mark;
            // A folder carries a dot when anything under it changed.
            for (let d = parent(abs); d.length > base.length && !(d in marks); d = parent(d)) marks[d] = "•";
          }
          // What git ignores here, relative to the root (an ignored folder once, not its files).
          const ig = await exec("git", ["--no-optional-locks", "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"], { cwd: root, on }).catch(() => null);
          if (ig?.code === 0) ignored = parseIgnored(ig.stdout);
          this.branch = (await exec("git", ["branch", "--show-current"], { cwd: root, on }).catch(() => null))?.stdout.trim() || null;
        } else this.branch = null;
        if (gen !== this.gen) return;
        this.marks = marks; this.ignored = ignored; this.error = null;
        this.watch(cx);
      } catch (e) { if (gen === this.gen) this.error = String(e?.message ?? e); }
      finally {
        this.loading = false;
        cx.notify();
        if (this.again) { this.again = false; this.refresh(cx); }
      }
    });
  }

  watch(cx) {
    if (this.on || this.watched === this.root) return;
    const root = this.watched = this.root;
    cx.spawn(async (cx) => {
      try { while (this.watched === root) { await watchFolder(root); if (this.watched === root) { this.refresh(cx); this.reloadLook(); } } }
      catch { if (this.watched === root) this.watched = null; }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const f of [...this.folders]) if (f === path || f.startsWith(path + "/")) { this.folders.delete(f); this.entries.delete(f); }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const gen = this.gen;
        this.pending.add(path);
        cx.spawn(async (cx) => {
          try { await this.loadFolder(path, gen); }
          catch (e) { if (gen === this.gen) this.error = String(e?.message ?? e); }
          finally { this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  /** The visible rows, depth-first: { path, name, dir, depth, ignored }; what
   *  the filters leave out is counted in `this.cut`. */
  rows(prefix = "", depth = 0, out = [], cut = (this.cut = { hidden: 0, ignored: 0 })) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const e of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (!lists(path, this.filters, this.ignored)) {
        if (!this.filters.hidden && isHidden(path)) cut.hidden++;
        else cut.ignored++;
        continue;
      }
      out.push({ path, name: e.name, dir: e.dir, depth, ignored: isIgnored(path, this.ignored) });
      if (e.dir && this.folders.has(path)) this.rows(path, depth + 1, out, cut);
    }
    return out;
  }

  /** What the list shows: the search's hits while there's a query, else the tree. */
  shown() {
    return this.query?.trim() && this.hits ? this.hits : this.rows();
  }

  // ---- filters

  setFilter(name, cx) {
    this.filters = { ...this.filters, [name]: !this.filters[name] };
    if (this.slot) {
      // Kept per pane, by slot; panes that are gone drop out.
      const live = new Set(panes().filter((p) => p.mod === MOD).map((p) => p.props?.slot).filter(Boolean));
      const all = Object.fromEntries(Object.entries(shared(FILTERS) ?? {}).filter(([k]) => live.has(k)));
      setShared(FILTERS, { ...all, [this.slot]: this.filters });
    }
    if (this.query.trim()) this.search(cx);
    cx.notify();
  }

  // ---- the preview split

  /** The viewer (the preview pane's, viewer.js), made once: a nested view, so
   *  its reading and drawing redraw only it, never the tree. */
  mountLook(cx) {
    if (!this.look && cx?.new) this.look = cx.new(Viewer, this.lookProps);
  }

  /** space, the toolbar's switch, the menu's entry: the split on or off. */
  toggleLook(cx) {
    const on = !this.lookState.on;
    this.saveLook({ on });
    this.lookAt = null; this.lookDir = null;
    if (on) this.mountLook(cx);
    else { this.natives("dispose"); this.setLook({ path: null }); }
    cx?.notify();
  }

  /** Keeps this pane's split (on, shares) by slot, as its filters; panes that are gone drop out. */
  saveLook(change) {
    this.lookState = { ...this.lookState, ...change };
    if (!this.slot) return;
    const live = new Set(panes().filter((p) => p.mod === MOD).map((p) => p.props?.slot).filter(Boolean));
    const all = Object.fromEntries(Object.entries(shared(LOOK) ?? {}).filter(([k]) => live.has(k)));
    setShared(LOOK, { ...all, [this.slot]: this.lookState });
  }

  /** New props for the viewer (it applies them on its next render). */
  setLook(change) {
    this.lookProps = { ...this.lookProps, ...change };
    this.look?.set_props(this.lookProps);
  }

  /** Every native view the viewer may have (a PDF, a clip, a font): `action` on it. */
  natives(action, args) {
    for (const id of NATIVE_IDS) { try { herdr.nativeViewCall?.(id, action, args ?? {}); } catch { /* none of that kind */ } }
  }

  /** What the preview shows: the selected row, else the root. */
  lookTarget() {
    const row = this.sel ? this.shown().find((r) => r.path === this.sel) : null;
    if (!row) return { abs: this.root, rel: "", dir: true };
    return { abs: join(this.root, row.path), rel: row.path, dir: Boolean(row.dir || row.head) };
  }

  /** From render: once the selection rests REST ms on a row, the preview
   *  shows it. Stepping on cancels the wait, so only the row rested on loads. */
  follow(cx) {
    const target = this.lookTarget(), key = `${target.dir ? "d" : "f"}:${target.abs}`;
    if (key === this.lookAt) return;
    this.lookAt = key;
    cx?.timer?.after(REST, (cx) => { if (this.lookAt === key && this.lookState.on) { this.showLook(target, cx); cx.notify(); } });
  }

  /** A file to the viewer; a folder: its summary, drawn here (the viewer lets go of what it showed). */
  showLook(target, cx) {
    if (!target.dir) { this.lookDir = null; this.setLook({ path: target.abs, on: this.on }); return; }
    this.natives("dispose");
    this.setLook({ path: null });
    const listed = this.entries.get(target.rel);
    this.lookDir = { ...target, entries: listed ?? null, error: null };
    if (listed) return;
    cx.spawn(async (cx) => {
      let entries = null, error = null;
      try { entries = (await directory(target.abs, this.on)).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)); }
      catch (e) { error = cleanError(e?.message ?? e); }
      if (this.lookDir?.abs !== target.abs) return;
      this.lookDir = { ...target, entries, error };
      cx.notify();
    });
  }

  /** The folder changed on disk: the preview reads its file again (unchanged ones stay as they are). */
  reloadLook() {
    if (this.lookState.on && this.lookProps.path) this.setLook({ reload: ++this.lookN });
  }

  /** J / K: the preview scrolls, the keyboard stays in the tree. */
  scrollLook(dir) {
    if (this.lookState.on && this.lookProps.path) this.setLook({ scroll: { n: ++this.lookN, dir } });
  }

  /** < / >: the preview smaller or bigger, both parts keeping their least. */
  resizeLook(dir) {
    if (!this.lookState.on) return;
    const side = this.side ?? lookSide(this.size);
    const f = clampShare(this.size, side, this.lookState[side] + dir * LOOK_STEP);
    if (f != null) this.saveLook({ [side]: f });
  }

  // ---- search

  /** Hits for the query, under their folders: fff's index of the root
   *  (findFiles); where it can't go (home, /, another machine), the folders
   *  listed so far. */
  search(cx) {
    const q = this.query.trim(), seq = ++this.seq;
    if (!q) { this.hits = null; this.note = null; cx.notify(); return; }
    const root = this.root, keep = (f) => lists(f.path, this.filters, this.ignored);
    const done = (files, note) => {
      if (seq !== this.seq) return;
      this.hits = grouped(files.filter(keep).slice(0, HITS));
      this.note = note;
      const rows = this.hits, i = rows.findIndex((r) => !r.head);
      this.sel = rows[i]?.path ?? null;
      if (i >= 0) this.scroll.scroll_to_item(i);
      cx.notify();
    };
    if (this.on) return done(this.loaded(q), "searching the folders listed so far");
    cx.spawn(async (cx) => {
      try {
        const r = await findFiles(root, q, { limit: HITS });
        if (seq !== this.seq || root !== this.root) return;
        done(r.files, r.scanning ? "indexing the folder… (hits grow)" : null);
        if (r.scanning) cx.timer.after(800, (cx) => { if (seq === this.seq) this.search(cx); });
      } catch { done(this.loaded(q), "searching the folders listed so far"); }
    });
  }

  /** Files listed so far that match `q` fuzzily, closest first. */
  loaded(q) {
    const out = [];
    for (const [prefix, entries] of this.entries) for (const e of entries) {
      if (e.dir) continue;
      const path = prefix ? `${prefix}/${e.name}` : e.name, ranges = fuzzy(q, path);
      if (ranges) out.push({ path, ranges });
    }
    const spread = (f) => f.ranges.length * 100 + f.path.length;
    return out.sort((a, b) => spread(a) - spread(b));
  }

  /** `/` and a click on the filter line: draws the filter's input, then gives
   *  it the keyboard. An input that isn't drawn can't take the focus (and its
   *  "focus" event, which turns `typing` on and so draws it, never comes), so
   *  the focus waits for the frames after this one. */
  startFind(cx) {
    this.finding = true;
    for (const ms of [16, 60, 200]) cx?.timer?.after?.(ms, () => { if (this.finding && !this.typing) this.input.focus(); });
    cx?.notify();
  }

  /** w, the menu's "Open in a web pane": an HTML file (relative to the root) as
   *  a page in the web pane (logic.js webOpen): a new front tab in the shown
   *  tab's one, else a new one beside this pane. Enter keeps opening it as before. */
  openWeb(path, cx) {
    if (!isHtml(path)) return this.say(`w opens HTML pages in a web pane: “${base(path)}” isn't one`, cx);
    if (this.on) return this.say("A page on another machine can't open in the web pane", cx);
    const tab = spaces().find((s) => s.active)?.tabs.find((c) => c.active)?.id;
    const browsers = panes().filter((p) => p.tab === tab && p.mod === "nocturne-browser");
    const from = (this.me() ?? (this.alone ? null : this.panel()))?.pane ?? null;
    const slot = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const [name, args] = webOpen(fileUrl(`${this.root}/${path}`), { browsers, from, slot });
    run(name, ...(args === undefined ? [] : [args]));
  }

  /** The filter line's stop `stop` pressed (enter / space on its ring). */
  pressStop(stop, cx) {
    if (stop === "hidden" || stop === "ignored") this.setFilter(stop, cx);
    else if (stop === "keys") this.keysShown = !this.keysShown;
    else if (stop.startsWith("add-")) this.addNew(stop.slice(4), cx);
  }

  /** + file / + folder (the filter line's chips, the empty folder's line):
   *  `a` / `A`'s name row, in the selected folder (beside a selected file),
   *  in the root with nothing selected. */
  addNew(kind, cx) {
    this.stop = null;
    const row = this.shown().find((r) => r.path === this.sel && !r.head) ?? null;
    this.startDraft(kind, row, cx);
  }

  clearSearch(cx) {
    this.query = ""; this.hits = null; this.note = null; this.seq++; this.finding = false;
    this.input.set_value("");
    this.handle.focus();
    cx?.notify();
  }

  /** Shows a folder from the hits in the tree: the search ends, it unfolds there. */
  reveal(path, cx) {
    this.clearSearch(cx);
    const parts = path.split("/");
    for (let n = 1; n <= parts.length; n++) {
      const p = parts.slice(0, n).join("/");
      if (!this.folders.has(p)) this.toggle(p, cx);
    }
    this.want = path;
  }

  /** Enter: a hit opens (a folder shows in the tree); in the tree, a file opens and a folder folds. */
  enter(cx) {
    const row = this.shown().find((r) => r.path === this.sel);
    if (!row) return;
    if (row.head) this.reveal(row.path, cx);
    else if (row.dir) this.toggle(row.path, cx);
    else this.openFile(row.path, cx);
  }

  // ---- the editor

  /** This copy's own pane (found by its slot). */
  me() {
    return this.slot ? panes().find((p) => p.mod === MOD && p.props?.slot === this.slot) ?? null : null;
  }

  /** The shown tab, and the editor pane this panel opened there (nocturne-edit's terminal). */
  editorPane() {
    const tab = spaces().find((s) => s.active)?.tabs.find((c) => c.active)?.id;
    const ours = new Set(terminals().filter((x) => isEdit(x.argv?.[0])).map((x) => x.address));
    return { tab, pane: panes().find((p) => p.tab === tab && p.terminal && ours.has(p.terminal)) ?? null };
  }

  /** Where files open: beside a pane of its own; from the panel, beside the tab's first other pane. */
  beside() {
    if (this.alone) { const me = this.me(); if (me) return me; }
    const tab = spaces().find((s) => s.active)?.tabs.find((c) => c.active)?.id;
    return panes().find((p) => p.tab === tab && p.mod !== MOD && !p.parked)
      ?? panes().find((p) => p.tab === tab && p.mod === MOD);
  }

  /** Edits a file (relative to the root) in the app's editor (nocturne-editor),
   *  beside this tab's other panes; a folder, or a file on another machine, in
   *  $EDITOR (terminalEdit). */
  edit(path, cx) {
    const row = this.shown().find((r) => r.path === path);
    if (this.on || !path || row?.dir) return this.terminalEdit(path, cx);
    const beside = this.beside();
    // As a tab of the editor this pane sent files to, else the shown tab's
    // editor; with none, a new one beside (editor-route.js). Markdown edited
    // as text opens with its preview beside it.
    const to = openInEditor(herdr, { path: `${this.root}/${path}`, pane: beside?.pane ?? null, prefer: this.editorSlot ?? null, view: isMarkdown(path) ? "split" : viewerFor(path) ? "text" : null });
    if (to) this.editorSlot = to.props.slot;
  }

  /** Opens a file to look at it in the editor as a tab, whatever its kind (a
   *  picture, a PDF, a table drawn in its tab, Markdown in the editor's view for it): the
   *  editor this pane sent files to, else the shown tab's; with none, a new
   *  one beside (editor-route.js). */
  openLooked(path, cx) {
    const beside = this.beside();
    const to = openInEditor(herdr, { path: `${this.root}/${path}`, pane: beside?.pane ?? null, prefer: this.editorSlot ?? null, look: true });
    if (to) this.editorSlot = to.props.slot;
  }

  /** Opens a file or folder (relative to the root; "" is the root) in $EDITOR: in this
   *  tab's nvim when it is listening, else in a new terminal pane to this one's left. */
  terminalEdit(path, cx) {
    const abs = path ? `${this.root}/${path}` : this.root;
    const { tab, pane } = this.editorPane();
    // One socket per tab; ids from other machines carry a "machine/" prefix.
    const key = String(tab ?? "default").replace(/[^A-Za-z0-9_-]/g, "_");
    // Left of this pane: the files column stays on the tab's right edge.
    const self = this.me() ?? panes().find((p) => p.tab === tab && p.mod === MOD);
    const open = () => run("terminal.open", { argv: [editTool(this.on), "--listen", key, abs], folder: this.root, place: "left", ...(self ? { pane: self.pane } : {}) });
    if (!pane) return open();
    cx.spawn(async () => {
      const r = await exec(editTool(this.on), ["--remote", key, abs], { cwd: this.root, on: this.on }).catch(() => null);
      if (r?.code === 0) run("pane.focus", { pane: pane.pane });
      else open();
    });
  }

  /** Neovim (the one on PATH) in a new terminal beside: on a file, in its
   *  folder; on a folder (or the root), `nvim .` there. */
  nvim(row) {
    const path = row?.path ?? "";
    const { argv, folder } = nvimLaunch(path ? `${this.root}/${path}` : this.root, !path || row.dir);
    const self = this.me() ?? (this.alone ? null : panes().find((p) => p.tab === this.editorPane().tab && p.mod === MOD));
    run("terminal.open", { argv, folder, place: this.alone ? "auto" : "left", ...(self ? { pane: self.pane } : {}) });
  }

  /** A folder (relative to the root) in a new files pane of its own. */
  openPane(path) {
    const beside = this.beside();
    run("files.open", { path: path ? `${this.root}/${path}` : this.root, ...(beside ? { pane: beside.pane } : {}), ...(this.on ? { on: this.on } : {}) });
  }

  /** y with marks: every marked path, one a line. */
  copySet(cx) {
    const rows = this.setOf(this.shown().find((r) => r.path === this.sel) ?? null);
    const paths = rows.map((r) => this.abs(r.path)).map((a) => (this.on ? `${this.on}:${a}` : a));
    cx.write_to_clipboard(paths.join("\n"));
    this.copiedText = `${paths.length} paths copied`;
    const at = this.copied = Date.now();
    cx.timer.after(1400, (cx) => { if (this.copied === at) { this.copied = 0; cx.notify(); } });
  }

  copy(path, cx) {
    if (this.marked?.size && (!path || this.marked?.has(path) || path === this.sel)) return this.copySet(cx);
    const abs = path ? `${this.root}/${path}` : this.root;
    cx.write_to_clipboard(this.on ? `${this.on}:${abs}` : abs);
    this.copiedText = null;
    const at = this.copied = Date.now();
    cx.timer.after(1400, (cx) => { if (this.copied === at) { this.copied = 0; cx.notify(); } });
  }

  /** Closes this pane (the panel too); from the panel, the keyboard goes back where it came from.
   *  Not close(): Fireflies calls that as cleanup once the pane is gone. */
  closePane() {
    const me = this.me() ?? (this.alone ? null : this.panel());
    if (!me) return;
    const from = shared(FROM), had = focused()?.pane === me.pane;
    run("pane.close", { pane: me.pane });
    if (!this.alone && had && from && from !== me.pane && panes().some((p) => p.pane === from)) run("pane.focus", { pane: from });
  }

  /** p: a file in the app's viewer pane for it (the preview, Markdown), on
   *  purpose; others in the editor. */
  preview(row, cx) {
    if (row && !row.dir && !row.head) this.openViewer(row.path, cx);
  }

  /** Opens a file as a tab of the editor, whatever its kind: Markdown in its
   *  preview, a picture, PDF or table drawn (look), other text to edit; on
   *  another machine the viewers' panes, as before (the editor's drawn tabs
   *  read this computer's files). `other` (alt-double-click, `e`): Markdown,
   *  tables and patches as text, a picture in the system's app. */
  openFile(path, cx, other) {
    const viewer = viewerFor(path);
    if (!viewer || (other && viewer.other === "edit")) return this.edit(path, cx);
    if (other) return run(viewer.open, { path: `${this.root}/${path}`, in: "system", ...(this.on ? { on: this.on } : {}) });
    if (this.on) return this.openViewer(path, cx);
    this.openLooked(path, cx);
  }

  /** A file in the app's viewer pane for it (the Markdown viewer, the
   *  preview), beside this tab's editor or its first other pane (else this
   *  one); a file without one in the editor. */
  openViewer(path, cx) {
    const viewer = viewerFor(path);
    if (!viewer) return this.edit(path, cx);
    const beside = (this.alone && this.me()) || this.editorPane().pane || this.beside();
    run(viewer.open, { path: `${this.root}/${path}`, ...(beside ? { pane: beside.pane } : {}), ...(this.on ? { on: this.on } : {}) });
  }

  /** Tells the pane header which folder a pane of its own shows, and the app
   *  (files.open finds the pane already on a folder) where it is rooted. */
  publish() {
    if (!this.alone || !this.slot) return;
    const live = new Set(panes().filter((p) => p.mod === MOD).map((p) => p.props?.slot).filter(Boolean));
    const name = this.root === "/" ? "/" : this.root.split("/").pop();
    for (const [key, value] of [[TITLES, name], [PATHS, this.root]]) {
      const was = shared(key) ?? {};
      if (was[this.slot] === value && Object.keys(was).every((k) => live.has(k) || k === this.slot)) continue;
      setShared(key, { ...Object.fromEntries(Object.entries(was).filter(([k]) => live.has(k))), [this.slot]: value });
    }
  }

  // ---- the menu

  openMenu(row, cx) {
    // On a marked row (with others marked): the set's entries first.
    const set = row.path && this.marked?.has(row.path) ? this.setOf(row) : [];
    let items = set.length > 1 ? setMenuItems(row, set.length, { pane: this.alone, clip: Boolean(this.clip()), look: this.lookState.on })
      : menuItems(row, { pane: this.alone, clip: Boolean(this.clip()), look: this.lookState.on, web: !this.on, viewer: !row.dir && Boolean(viewerFor(row.path ?? "")) });
    if (row.head) items = items.filter((x) => x.act !== "root");
    this.sel = row.path || this.sel;
    this.menu = { row, items, at: { ...this.mouse }, n: 0 };
    this.handle.focus();
    cx?.notify();
  }

  act(act, row, cx) {
    const p = row.path;
    if (act === "toggle") row.head ? this.reveal(p, cx) : this.toggle(p, cx);
    else if (act === "pane") this.openPane(p);
    else if (act === "root") this.go(p ? `${this.root}/${p}` : this.root, cx);
    else if (act === "edit") this.edit(p, cx);
    else if (act === "nvim") this.nvim(row);
    else if (act === "open") this.openFile(p, cx);
    else if (act === "viewer") this.openViewer(p, cx);
    else if (act === "other") viewerFor(p)?.other === "system" ? this.openFile(p, cx, true) : this.edit(p, cx);
    else if (act === "terminal") this.terminalEdit(p, cx);
    else if (act === "web") this.openWeb(p, cx);
    else if (act === "copy") this.copy(p, cx);
    else if (act === "close") this.closePane();
    else if (act === "new-file") this.startDraft("file", row, cx);
    else if (act === "new-folder") this.startDraft("folder", row, cx);
    else if (act === "rename") this.startRename(row, cx);
    else if (act === "cut") this.cutRow(row, cx);
    else if (act === "paste") this.paste(row, cx);
    else if (act === "delete") this.askDelete(row, cx);
    else if (act === "look") this.toggleLook(cx);
    else if (act === "delete-set") this.askDelete(row, cx);
    else if (act === "cut-set") this.cutRow(row, cx);
    else if (act === "copy-set") this.copySet(cx);
    else if (act === "unmark") this.unmark();
  }

  menuKey(e, cx) {
    const m = this.menu, k = e.key, shift = e.modifiers?.shift;
    const char = shift && /^[a-z]$/.test(k) ? k.toUpperCase() : k;
    if (k === "escape" || k === "m") this.menu = null;
    else if (k === "j" || k === "down") m.n = Math.min(m.items.length - 1, m.n + 1);
    else if (k === "k" || k === "up") m.n = Math.max(0, m.n - 1);
    else if (k === "enter") { this.menu = null; this.act(m.items[m.n].act, m.row, cx); }
    else {
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
  say(text, cx, { error = true, draft = false } = {}) {
    const at = Date.now();
    this.msg = { text, error, draft, at };
    cx?.timer?.after(8000, (cx) => { if (this.msg?.at === at) { this.msg = null; cx.notify(); } });
  }

  /** Runs one of OPS's operations on this pane's machine: true when it worked;
   *  otherwise the reason is said in the pane and the tree is listed again. */
  async fileOp(args, name, cx) {
    const r = await this.runOp(args);
    if (r.code === 0) return true;
    this.say(this.why(r, name), cx, { draft: r.code === 3 });
    this.refresh(cx);
    return false;
  }

  /** One of OPS's operations on this pane's machine: its exit code and stderr. */
  async runOp(args) {
    try { return await exec("sh", ["-c", OPS, "files-op", ...args], { on: this.on }); }
    catch (e) { return { code: -1, stderr: String(e?.message ?? e) }; }
  }

  /** Why an operation on `name` failed, in a line. */
  why(r, name) {
    return r.code === 3 ? `“${name}” already exists` : r.code === 4 ? `“${name}” isn't there anymore`
      : r.code === 5 ? `“${name}” couldn't go to the Trash` : cleanError(r.stderr);
  }

  /** Renames, moves and deletes that worked ({ from, to } absolute; `to`
   *  null for a delete; a folder once, with its own paths), appended to the
   *  shared record the editors follow. */
  recordChanges(entries) {
    if (entries.length) setShared(CHANGES, withChanges(shared(CHANGES), entries, this.on, Date.now()));
  }

  /** After `rel` moved to `to` (relative, or null: out of the tree or
   *  deleted): its unfolded folders follow it, its listings go, a cut of it is used up. */
  forget(rel, to, abs) {
    if (rel != null) {
      this.folders = movedFolders(this.folders, rel, to);
      for (const k of [...this.entries.keys()]) if (k === rel || k.startsWith(`${rel}/`)) this.entries.delete(k);
    }
    const left = cutItems(this.clip()).filter((c) => c.abs !== abs && !c.abs.startsWith(`${abs}/`));
    if (this.clip() && left.length !== cutItems(this.clip()).length) setShared(CUT, left.length ? { on: this.on ?? null, items: left } : null);
  }

  /** The machine's trash tool ("" where there is none: deletes are permanent), asked once. */
  async trashTool() {
    if (this.trash == null) {
      const r = await exec("sh", ["-c", PROBE, "files-trash-probe"], { on: this.on }).catch(() => null);
      this.trash = r?.code === 0 ? r.stdout.trim() : "";
    }
    return this.trash;
  }

  abs(rel) { return join(this.root, rel); }

  /** Shows `abs` once the tree is listed again: its folders unfold, the
   *  selection lands on it. Outside the root, or hidden by a filter: said. */
  landOn(abs, cx, done) {
    // From the search's hits: the search ends, the result shows in the tree.
    if (this.query) this.clearSearch(cx);
    const rel = relTo(this.root, abs);
    if (rel == null) this.say(`${done} ${tilde(abs)}`, cx, { error: false });
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
  startDraft(kind, row, cx) {
    if (this.query) this.clearSearch(cx);
    let dir = "", after = null;
    if (row?.path) {
      dir = row.dir ? row.path : dirOf(row.path);
      after = row.path;
      for (const p of parentsOf(row.path)) if (!this.folders.has(p)) this.toggle(p, cx);
      if (row.dir && !this.folders.has(row.path)) this.toggle(row.path, cx);
    }
    this.draft = { kind, dir, after };
    this.msg = null;
    this.nameInput.set_value("");
    this.nameInput.focus();
    cx?.notify();
  }

  /** R: the row's name in the input, its stem selected. */
  startRename(row, cx) {
    if (!row?.path) return this.say("The tree's root can't be renamed", cx);
    const name = base(row.path);
    this.draft = { kind: "rename", path: row.path, dir: row.dir, name };
    this.sel = row.path;
    this.msg = null;
    this.nameInput.set_value(name);
    this.nameInput.focus();
    this.selectStem();
    cx?.notify();
  }

  selectStem() {
    const d = this.draft;
    if (d?.kind === "rename" && this.nameInput.value() === d.name) this.nameInput.set_selected_range?.(stemRange(d.name, d.dir));
  }

  /** Closes the input; the keyboard back on the tree. */
  endDraft(cx, focus = true) {
    this.draft = null;
    if (this.msg?.draft) this.msg = null;
    if (focus) this.handle.focus();
    cx?.notify();
  }

  /** Enter in the input: creates, or renames / moves. A refusal or a failure
   *  leaves the input open to fix the name. */
  commitDraft(cx) {
    const d = this.draft;
    if (!d || d.busy) return;
    const typed = this.nameInput.value(), at = this.on ? null : home();
    if (d.kind === "rename") {
      const src = this.abs(d.path), t = renameTarget(src, typed, at);
      if (t.error) return this.say(t.error, cx, { draft: true });
      if (t.abs === src) return this.endDraft(cx);
      return this.move(src, t.abs, d.path, cx, "Moved to");
    }
    const r = resolveName(this.abs(d.dir), typed, at);
    if (r.error) return this.say(r.error, cx, { draft: true });
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
  move(src, dst, rel, cx, done) {
    const why = moveRefusal(src, dst, this.root);
    if (why) return this.say(why, cx, { draft: Boolean(this.draft) });
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
  clip() {
    const c = shared(CUT);
    return c && (c.on ?? null) === (this.on ?? null) ? c : null;
  }

  /** Whether `abs` is cut (on this machine). */
  isCut(abs) { return cutItems(this.clip()).some((c) => c.abs === abs); }

  /** x: cuts the row for P (again on the same row: uncut); with marks, all of them. */
  cutRow(row, cx) {
    const set = this.setOf(row);
    if (set.length > 1) {
      const items = set.map((r) => ({ abs: this.abs(r.path), dir: Boolean(r.dir), name: base(r.path) }));
      setShared(CUT, { on: this.on ?? null, items });
      return this.say(`Cut ${items.length} items: P pastes them in the selected folder`, cx, { error: false });
    }
    if (!row?.path) return this.say("The tree's root can't be moved", cx);
    const abs = this.abs(row.path);
    if (this.isCut(abs) && cutItems(this.clip()).length === 1) { setShared(CUT, null); return; }
    setShared(CUT, { on: this.on ?? null, items: [{ abs, dir: Boolean(row.dir), name: base(row.path) }] });
    this.say(`Cut “${base(row.path)}”: P pastes it in the selected folder`, cx, { error: false });
  }

  /** P: moves what's cut into the selected folder (beside a selected file; the root with none). */
  paste(row, cx) {
    const c = shared(CUT), items = cutItems(c);
    if (!items.length) return this.say("Nothing is cut: x cuts a row", cx);
    if ((c.on ?? null) !== (this.on ?? null)) return this.say("It was cut on another machine", cx);
    const into = this.abs(!row?.path ? "" : row.dir ? row.path : dirOf(row.path));
    if (items.length === 1) return this.move(items[0].abs, join(into, items[0].name), relTo(this.root, items[0].abs), cx, "Moved to");
    this.moveSet(items.map((x) => x.abs), into, cx);
  }

  /** d: asks first (the item named, a folder's contents, trash or permanently);
   *  with marks, once for all of them (the count and the first names). */
  askDelete(row, cx) {
    const set = this.setOf(row);
    if (set.length <= 1 && !row?.path) return this.say("The tree's root can't be deleted", cx);
    cx.spawn(async (cx) => {
      const trash = await this.trashTool();
      if (set.length > 1) this.ask = { set: set.map((r) => ({ path: r.path, dir: Boolean(r.dir), name: base(r.path) })), trash };
      else {
        const path = row.path;
        this.ask = { path, dir: Boolean(row.dir), name: base(path), trash };
        this.sel = path;
      }
      cx.notify();
    });
  }

  // ---- several rows at once

  /** The marked rows in the tree's order (none: []). */
  markedRows() {
    if (!this.marked?.size) return [];
    return this.shown().filter((r) => this.marked?.has(r.path) && !r.head && !r.draft);
  }

  /** The rows an action on `row` covers: every marked one (a folder's
   *  contents go with it) when there are marks and `row` is one of them or the
   *  keyboard's; else `row` alone. */
  setOf(row) {
    const marked = this.markedRows();
    if (!marked.length || (row?.path && !this.marked?.has(row.path) && row.path !== this.sel)) return row?.path ? [row] : [];
    const keep = new Set(topLevel(marked.map((r) => r.path)));
    return marked.filter((r) => keep.has(r.path));
  }

  /** t, cmd-click: marks or unmarks a row. */
  markToggle(path) {
    if (!path || path === DRAFT) return;
    const next = new Set(this.marked);
    next.has(path) ? next.delete(path) : next.add(path);
    this.marked = next;
    this.anchor = path;
  }

  /** Marks the rows from the range's start to the keyboard's row (the marks before it kept). */
  markRange(to) {
    const r = this.range, rows = this.shown();
    if (!r) return;
    const a = rows.findIndex((x) => x.path === r.anchor), b = rows.findIndex((x) => x.path === to);
    if (a < 0 || b < 0) return;
    this.marked = new Set([...r.base, ...rangePaths(rows, a, b)]);
  }

  /** esc: the marks and a range go. */
  unmark() {
    this.marked = new Set(); this.range = null;
  }

  /** Moves the set (absolute paths) into `into`, each tried; what failed is
   *  said afterwards with its reason. Nothing is overwritten. */
  moveSet(paths, into, cx) {
    const items = topLevel(paths).filter((p) => parent(p) !== into);
    const why = dropRefusal(topLevel(paths), into);
    if (why) return this.say(why, cx);
    this.runSet(items.map((abs) => ({ abs, args: ["move", abs, join(into, base(abs))], to: join(into, base(abs)) })), cx, (n) => `Moved ${n} ${n === 1 ? "item" : "items"} to ${tilde(into)}`);
  }

  // ---- drag and drop

  /** Where the rows are in the pane (px): under the header, left of a preview at the right, above one at the bottom. */
  treeBox() {
    const g = this.geo ?? {};
    return {
      top: treeTop(this.lensRows ?? 1) - 4,
      bottom: this.size.height - (g.side === "bottom" && g.px != null ? g.px + DIVIDER : 0),
      right: this.size.width - (g.side === "right" && g.px != null ? g.px + DIVIDER : 0),
    };
  }

  /** What's under the pointer `at` (pane px): a row ({ row }), the empty
   *  space below the rows ({ root }), or nothing. Rows are ROW_H px each,
   *  from the list's scroll offset (VirtualListScrollHandle.offset). */
  hitAt(at) {
    const box = this.treeBox();
    if (!at || this.keysShown || at.y < box.top || at.y > box.bottom || at.x > box.right) return null;
    const list = this.listed ?? [];
    const scrolled = -(this.scroll.offset?.()?.y ?? 0) / zoom();
    const i = rowIndexAt(at.y, scrolled, treeTop(this.lensRows ?? 1));
    if (i >= 0 && i < list.length) return { row: list[i] };
    return i >= list.length ? { root: true } : null;
  }

  /** A left press (no cmd / shift / alt) on a row: a drag starts once it moves SLOP px. */
  pressAt(e) {
    this.press = null;
    const m = e?.modifiers ?? {};
    if (m.platform || m.shift || m.alt || this.draft || this.typing || !e?.local_position || !this.scroll.offset) return;
    const at = { x: e.local_position.x / zoom(), y: e.local_position.y / zoom() };
    const hit = this.hitAt(at);
    if (hit?.row && hit.row.path !== DRAFT && !hit.row.head) this.press = { path: hit.row.path, at };
  }

  /** The pointer moved with the button held: the drag starts, or aims. A
   *  press on a marked row drags every marked row. */
  dragMove(at, cx) {
    if (!this.press) return;
    if (!this.drag) {
      if (Math.hypot(at.x - this.press.at.x, at.y - this.press.at.y) < SLOP) return;
      const p = this.press.path;
      const paths = this.marked?.has(p) ? topLevel(this.markedRows().map((r) => r.path)) : [p];
      this.drag = { paths, into: null, ok: false, why: null, at };
      this.menu = null;
    }
    this.drag.at = at;
    this.aim(this.hitAt(at), cx);
    this.edgeScroll(at, cx);
    cx.notify();
  }

  /** The drop target under the pointer: a folder row, or the root below the
   *  rows; lit when the drop is allowed (dropRefusal). A closed folder
   *  unfolds after resting UNFOLD ms under it. */
  aim(hit, cx) {
    const d = this.drag;
    const into = hit?.root ? "" : hit?.row?.dir ? hit.row.path : null;
    if (into === d.into) return;
    d.into = into;
    if (into == null) { d.ok = false; d.why = null; return; }
    d.why = dropRefusal(d.paths.map((p) => this.abs(p)), this.abs(into));
    d.ok = !d.why;
    // What a drop here really moves: the rows already in the target stay.
    d.moving = d.paths.filter((p) => dirOf(p) !== into);
    if (into && !hit.row.head && !this.folders.has(into)) {
      cx?.timer?.after(UNFOLD, (cx) => { if (this.drag?.into === into && !this.folders.has(into)) { this.toggle(into, cx); cx.notify(); } });
    }
  }

  /** Near the rows' top or bottom edge, the list scrolls a row at a time while the drag stays there. */
  edgeScroll(at, cx) {
    const box = this.treeBox();
    const dir = at.y < box.top + EDGE ? -1 : at.y > box.bottom - EDGE ? 1 : 0;
    if (dir === (this.edging ?? 0)) return;
    this.edging = dir;
    if (!dir) return;
    const step = (cx) => {
      if (!this.drag || this.edging !== dir) return;
      const list = this.listed ?? [], scrolled = -(this.scroll.offset?.()?.y ?? 0) / zoom();
      const first = Math.floor(scrolled / ROW_H), shown = Math.max(1, Math.floor((box.bottom - box.top) / ROW_H) - 1);
      const to = dir < 0 ? first - 1 : first + shown;
      if (to >= 0 && to < list.length) this.scroll.scroll_to_item(to);
      this.aim(this.hitAt(this.drag.at), cx);
      cx.notify();
      cx.timer.after(90, step);
    };
    step(cx);
  }

  /** The release: an allowed drop moves the dragged rows into the target; anything else cancels. */
  dragEnd(cx) {
    const d = this.drag;
    this.press = null;
    if (!d) return false;
    this.cancelDrag();
    if (!d.ok) return true;
    const into = this.abs(d.into);
    if (d.paths.length === 1) {
      const src = this.abs(d.paths[0]);
      this.move(src, join(into, base(src)), d.paths[0], cx, "Moved to");
    } else this.moveSet(d.paths.map((p) => this.abs(p)), into, cx);
    return true;
  }

  /** esc, the pointer leaving the pane, a release where nothing takes it: the drag ends, nothing moves. */
  cancelDrag() {
    this.drag = null; this.press = null; this.edging = 0;
  }

  /** Runs the set's operations one by one: what worked is recorded and
   *  forgotten in the tree; failures are listed once all are tried. */
  runSet(ops, cx, said) {
    cx.spawn(async (cx) => {
      const done = [], failed = [];
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
  askKey(e, cx) {
    const a = this.ask, k = e.key, m = e.modifiers ?? {};
    this.ask = null;
    if (!m.platform && !m.control && !m.alt && (k === "enter" || k === "y")) this.remove(a, cx);
    cx.stop_propagation();
    cx.notify();
  }

  remove(a, cx) {
    if (a.set) {
      const verb = a.trash ? "Moved" : "Deleted", where = a.trash ? " to the Trash" : "";
      return this.runSet(a.set.map((x) => ({ abs: this.abs(x.path), args: ["delete", a.trash, this.abs(x.path)], to: null })), cx,
        (n) => `${verb} ${n} ${n === 1 ? "item" : "items"}${where}`);
    }
    const next = neighbour(this.shown(), a.path), abs = this.abs(a.path);
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
  withDraft(rows) {
    const d = this.draft;
    if (!d || d.kind === "rename") return rows;
    let at = 0;
    if (d.after != null) {
      const i = rows.findIndex((r) => r.path === d.after);
      at = i >= 0 ? i + 1 : d.dir ? rows.findIndex((r) => r.path === d.dir) + 1 : 0;
    }
    const folder = d.kind === "folder" || this.nameInput.value().endsWith("/");
    const row = { path: DRAFT, name: "", dir: folder, depth: d.dir ? d.dir.split("/").length : 0, draft: true };
    return [...rows.slice(0, at), row, ...rows.slice(at)];
  }

  // ---- input

  select(rows, i) {
    if (!rows.length) return;
    const n = Math.max(0, Math.min(rows.length - 1, i));
    this.sel = rows[n].path;
    this.scroll.scroll_to_item(n);
  }

  /** One step through the hits while typing (folder lines skipped). */
  step(d) {
    const rows = this.shown();
    let i = rows.findIndex((r) => r.path === this.sel);
    do i += d; while (rows[i]?.head);
    if (rows[i]) this.select(rows, i);
  }

  /** A click on a row: a file is selected (the preview follows), a double
   *  click opens it (alt: the other way); a folder folds, a double click edits
   *  it in $EDITOR (its first click's fold undone); a search's folder line
   *  shows that folder in the tree. */
  pick(path, cx) {
    // A click in the name's input row places the caret; it doesn't open the row.
    if (path === DRAFT || (this.draft?.kind === "rename" && this.draft.path === path)) return;
    // The release that ends a drag isn't a click.
    if (this.drag || this.dropped) { this.dropped = false; return; }
    const rows = this.shown(), row = rows.find((r) => r.path === path);
    if (!row) return;
    const mods = this.mods ?? {};
    // cmd-click: the row joins or leaves the marks (the keyboard's row too, the
    // first time, as a selection grows in Finder); shift-click: every row from
    // the last clicked one to this one.
    if ((mods.platform || mods.shift) && !row.head) {
      if (mods.shift) {
        const a = rows.findIndex((r) => r.path === (this.anchor ?? this.sel)), b = rows.indexOf(row);
        this.marked = new Set(rangePaths(rows, a < 0 ? b : a, b));
      } else {
        if (!this.marked?.size && this.sel && this.sel !== path && rows.some((r) => r.path === this.sel && !r.head)) this.marked = new Set([this.sel]);
        this.markToggle(path);
      }
      this.sel = path; this.lastClick = null; this.range = null;
      this.handle.focus();
      cx.notify();
      return;
    }
    // A plain click: one row, the marks go.
    if (this.marked?.size) this.unmark();
    this.anchor = path;
    const now = Date.now(), again = this.lastClick?.path === path && now - this.lastClick.at < DOUBLE;
    // A double click is used up: a third click selects again.
    this.lastClick = again ? null : { path, at: now };
    this.sel = path;
    this.handle.focus();
    if (row.head) this.reveal(path, cx);
    else if (!row.dir) { if (again) this.openFile(path, cx, this.alt); }
    else if (again) { this.toggle(path, cx); this.edit(path, cx); } // undo the first click's fold
    else this.toggle(path, cx);
    cx.notify();
  }

  key(e, cx) {
    if (this.menu) return this.menuKey(e, cx);
    if (this.ask) return this.askKey(e, cx);
    const k = e.key, m = e.modifiers ?? {};
    // A drag: esc cancels it, other keys wait.
    if (this.drag) {
      if (k === "escape") this.cancelDrag();
      cx.stop_propagation(); cx.notify(); return;
    }
    if (this.draft) {
      // Typing goes to the name; esc gives up (enter is the input's submit).
      if (k !== "escape") return;
      this.endDraft(cx);
      cx.stop_propagation();
      cx.notify();
      return;
    }
    if (this.msg && !this.typing) this.msg = null;
    if (this.typing) {
      // Typing goes to the filter; these steer the hits (enter is the input's submit).
      if (k === "escape") this.clearSearch(cx);
      else if (k === "down" || (m.control && k === "n")) this.step(1);
      else if (k === "up" || (m.control && k === "p")) this.step(-1);
      else if (k === "tab") this.handle.focus();
      else return;
      cx.stop_propagation();
      cx.notify();
      return;
    }
    // Back and forward, the browser's and vim's jump list's way too.
    if ((m.alt && k === "left") || (m.control && k === "o")) { this.back(cx); cx.stop_propagation(); cx.notify(); return; }
    if ((m.alt && k === "right") || (m.control && k === "i")) { this.forward(cx); cx.stop_propagation(); cx.notify(); return; }
    if (m.platform || m.control || m.alt) return;
    // ? (shift-/ on most layouts: check what was typed before "/" filters).
    // The keys overview (keyhelp.js): ? opens it, ? esc q close it; meanwhile it takes every key.
    const help = keysKey(e, this.keysShown);
    if (help || this.keysShown) {
      if (help) this.keysShown = help === "toggle" ? !this.keysShown : false;
      cx.stop_propagation(); cx.notify(); return;
    }
    // tab / shift-tab ring the filter line's switches, + file / + folder and ? keys
    // in turn, then the list again; enter or space presses the ringed one, esc
    // leaves it, any other key leaves it and does what it does in the list.
    if (k === "tab") { this.stop = lensStep(lensStops(this.lensAdd), this.stop, m.shift ? -1 : 1); cx.stop_propagation(); cx.notify(); return; }
    if (this.stop) {
      if (k === "enter" || k === "space" || k === "escape") {
        if (k === "escape") this.stop = null; else this.pressStop(this.stop, cx);
        cx.stop_propagation(); cx.notify(); return;
      }
      this.stop = null;
    }
    const upper = m.shift || /^[A-Z]$/.test(k), low = k.toLowerCase();
    const rows = this.shown(), i = rows.findIndex((r) => r.path === this.sel), row = rows[i];
    // A move ends a shift-range; in V's range it grows the range.
    const moved = (to) => { this.select(rows, to); if (this.range) this.markRange(this.sel); };
    if (this.range?.shift && !m.shift && ["j", "k", "down", "up"].includes(k)) this.range = null;
    if (k === "escape" && (this.marked?.size || this.range)) this.unmark();
    else if (m.shift && (k === "down" || k === "up") && row) {
      // shift-↑↓: marks while moving, from where it started.
      if (!this.range) this.range = { anchor: row.path, base: new Set(this.marked), shift: true };
      moved(k === "down" ? i + 1 : i - 1);
      this.markRange(this.sel);
    }
    else if (low === "v" && upper) {
      // V: a range from here, as vim's line-wise visual mode; V again keeps the marks and ends it.
      if (this.range) this.range = null;
      else if (row) { this.range = { anchor: row.path, base: new Set(this.marked) }; this.markRange(row.path); }
    }
    else if (k === "t" && row && !row.head) { this.markToggle(row.path); this.select(rows, i + 1); }
    else if (k === "space") this.toggleLook(cx);
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
    else if (k === "escape") { if (this.query) this.clearSearch(cx); else if (this.alone) this.closePane(); else this.leave(); }
    else if (k === "q") this.closePane();
    else if (k === "[" || k === "backspace") this.back(cx);
    else if (k === "]") this.forward(cx);
    else if (k === "j" || k === "down") moved(i + 1);
    else if (k === "k" || k === "up") moved(i < 0 ? 0 : i - 1);
    else if (low === "g" && upper) { moved(rows.length - 1); this.gAt = 0; }
    else if (k === "g") {
      if (Date.now() - (this.gAt ?? 0) < 500) { this.gAt = 0; moved(0); }
      else this.gAt = Date.now();
    } else if ((k === "l" || k === "right" || k === "enter") && row?.head) this.reveal(row.path, cx);
    else if ((k === "l" || k === "right") && row) {
      if (!row.dir) this.openFile(row.path, cx);
      else if (!this.folders.has(row.path)) this.toggle(row.path, cx);
      else this.select(rows, i + 1);
    } else if ((k === "h" || k === "left") && row && !row.hit) {
      if (row.dir && this.folders.has(row.path)) this.toggle(row.path, cx);
      else if (row.depth > 0) this.select(rows, rows.findIndex((r) => r.path === parent(row.path)));
    } else if (k === "enter" && row) row.dir ? this.toggle(row.path, cx) : this.openFile(row.path, cx);
    else if (k === "E" || (low === "e" && m.shift)) this.terminalEdit(row?.path ?? "", cx);
    else if (k === "e") row && !row.dir && viewerFor(row.path)?.other === "system" ? this.openFile(row.path, cx, true) : this.edit(row?.path ?? "", cx);
    else if (k === "v") this.nvim(row ?? null);
    else if (k === "w" && row && !row.dir) this.openWeb(row.path, cx);
    else if (k === "p") this.preview(row, cx);
    else if (k === "o") this.openPane(row?.dir ? row.path : "");
    else if (k === "y") this.copy(row?.path ?? "", cx);
    else if (k === "m") this.openMenu(row ?? { path: "", name: this.root, dir: true }, cx);
    else if (k === "-") { const from = this.root; this.go(parent(this.root), cx); this.pendingSel = from; }
    else if (k === "." && row) {
      const into = row.dir ? row.path : row.path.includes("/") ? parent(row.path) : "";
      if (into) this.go(`${this.root}/${into}`, cx);
    }
    else if (k === "r") this.refresh(cx);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // ---- parts

  chip(t, id, label, action, on = true) {
    return h_flex().id(id).relative().h(20).px(6).flex_none().items_center()
      .text_color(on ? t.muted : t.ansi0).when(on, (el) => el.hover((s) => s.text_color(t.foreground)))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { if (on) action(cx); cx.notify(); })
      .child(div().relative().child(label));
  }

  toolbar(t, w, focused) {
    const changed = Object.values(this.marks).filter((m) => m !== "•").length;
    const name = this.root === "/" ? "/" : this.root.split("/").pop();
    const fit = toolbarFit(w, { alone: this.alone, branch: this.branch, changed, name });
    return h_flex().id("nf-toolbar").relative().h(34).flex_none().px(10).gap(8).items_center().text_size(11).overflow_hidden()
      .when(fit.eyebrow, (el) => el.child(div().flex_none().text_color(focused ? t.accent : t.ansi8).child("FILES")))
      .child(this.chip(t, "nf-back", "‹", (cx) => this.back(cx), this.root !== "/" || this.nav.past.length > 0))
      .child(this.chip(t, "nf-forward", "›", (cx) => this.forward(cx), this.nav.future.length > 0))
      .child(h_flex().flex_1().min_w(0).gap(6).items_baseline()
        .child(div().flex_shrink(1).min_w(fit.name).truncate().text_color(t.foreground).child(name))
        .when(fit.path, (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(tilde(parent(this.root))))))
      .when(fit.branch, (el) => el.child(div().flex_none().max_w(140).truncate().text_color(t.ansi2).child(this.branch)))
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
  lookChip(t) {
    const on = this.lookState.on, side = this.side ?? lookSide(this.size);
    return h_flex().id("nf-look-chip").relative().size(20).flex_none().items_center().justify_center()
      .text_color(on ? t.accent : t.muted).hover((s) => s.text_color(on ? t.accent : t.foreground))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { this.toggleLook(cx); cx.notify(); })
      .child(svg(`mods/${MOD}/look-${side}.svg`).relative().size(12));
  }

  /** A folder in the preview: its name, what it holds (as the filters list it), its first entries. */
  folderView(t) {
    const d = this.lookDir;
    const entries = (d.entries ?? []).filter((e) => lists(d.rel ? `${d.rel}/${e.name}` : e.name, this.filters, this.ignored));
    const facts = d.error ? "" : d.entries ? folderFacts(entries) : "listing…";
    const bar = h_flex().id("nf-look-bar").relative().h(26).flex_none().px(10).gap(8).items_center().text_size(11).overflow_hidden()
      .child(div().flex_none().text_color(t.ansi8).child("DIR"))
      .child(div().flex_shrink(1).min_w(0).truncate().text_color(t.foreground).child(d.abs === "/" ? "/" : base(d.abs)))
      .when(Boolean(facts), (el) => el.child(div().flex_shrink(1).min_w(0).truncate().text_color(t.dim).child(facts)))
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.ansi0, 1)));
    const list = v_flex().flex_1().min_h(0).overflow_hidden().py(4).text_size(12)
      .when(Boolean(d.error), (el) => el.child(div().px(12).py(6).text_size(11).text_color(t.dim).child(d.error)))
      .children(entries.slice(0, 120).map((e, i) => h_flex().id(`nf-lk-${i}`).h(20).flex_none().px(12).gap(6).items_center()
        .child(svg(`mods/files/${e.dir ? "folder" : "file"}.svg`).relative().size(12).flex_none().text_color(e.dir ? t.ansi4 : t.dim))
        .child(div().min_w(0).truncate().text_color(e.dir ? t.foreground : t.muted).child(e.name))));
    return v_flex().id("nf-look-dir").size_full().bg(t.background).child(bar).child(list);
  }

  /** The tree (with its hint line) and the preview, split along `side`; the
   *  preview `px` along it. The divider drags; its line lights while it does. */
  split(t, side, px, list, foot) {
    const right = side === "right";
    // h_flex centers its items: the tree's column is stretched to the split's height by hand.
    const tree = v_flex().id("nf-treecol").relative().flex_1().min_w(0).min_h(0).when(right, (el) => el.h_full())
      .child(list).when(Boolean(foot), (el) => el.child(foot));
    // At rest a dotted rule; under the pointer or held, a lit band the width of the grab area.
    const lit = Boolean(this.dragging) || this.dividerHover;
    const band = lit ? DIVIDER - 2 : 1, at = Math.floor((DIVIDER - band) / 2);
    const line = dither(lit ? t.accent : t.ansi8, 1);
    const divider = div().id("nf-divider").relative().flex_none()
      .when(right, (el) => el.w(DIVIDER).h_full().cursor_col_resize().child(div().absolute().top(0).bottom(0).left(at).w(band).child(line)))
      .when(!right, (el) => el.h(DIVIDER).w_full().cursor_row_resize().child(div().absolute().left(0).right(0).top(at).h(band).child(line)))
      .on_hover((over, cx) => { if (over !== Boolean(this.dividerHover)) { this.dividerHover = over; cx.notify(); } })
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.dragging = side; this.handle.focus(); cx.notify(); });
    const look = div().id("nf-look").relative().flex_none().overflow_hidden()
      .when(right, (el) => el.w(px).h_full()).when(!right, (el) => el.h(px).w_full())
      // A right-click here isn't a row's: no menu.
      .on_mouse_down("right", stop)
      .child(this.lookDir ? this.folderView(t) : this.look);
    return (right ? h_flex() : v_flex()).id("nf-split").relative().flex_1().min_h(0).min_w(0).child(tree).child(divider).child(look);
  }

  /** A filter's switch: an open eye while that kind is listed; a shut one,
   *  the label struck through and how many it leaves out, while it's hidden. */
  filterChip(t, id, label, on, cut, action, ringed = false) {
    return h_flex().id(id).relative().h(20).px(4).gap(4).flex_none().items_center()
      .when(ringed, (el) => el.child(ring(t)))
      .hover((s) => s.bg(t.ansi0 + "55"))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => action(cx))
      .child(svg(on ? `${ICONS}/eye.svg` : `mods/${MOD}/eye-off.svg`).relative().size(11).flex_none().text_color(on ? t.dim : t.ansi3))
      .when(Boolean(label), (el) => el.child(div().relative().text_color(t.muted).when(!on, (el) => el.line_through()).child(label)))
      .when(!on && cut > 0, (el) => el.child(div().relative().text_color(t.ansi3).child(String(cut))));
  }

  /** + file / + folder (or a bare +): `a` / `A`'s name row; the accent +, a muted word. */
  addChip(t, kind, label, ringed) {
    const word = label.replace(/^\+\s*/, "");
    return h_flex().id(`nf-add-${kind}`).relative().h(20).px(4).gap(7).flex_none().items_center().text_color(t.muted)
      .hover((s) => s.bg(t.ansi0 + "55").text_color(t.foreground))
      .when(ringed, (el) => el.child(ring(t)))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { this.addNew(kind, cx); cx.notify(); })
      .child(div().relative().text_color(t.accent).child("+"))
      .when(Boolean(word), (el) => el.child(div().relative().child(word)));
  }

  /** The line under the toolbar: the filter as you type, the two switches,
   *  the new-item chips and ? keys. Narrow (the docked panel), two rows
   *  (logic.js lensLayout): the filter at full width, a click anywhere on its
   *  row starts it; the switches and chips on the row under it. */
  lens(t, w, found) {
    const live = this.typing || this.finding || Boolean(this.query);
    const cut = this.cut ?? { hidden: 0, ignored: 0 };
    const searching = Boolean(this.query.trim());
    // What fits this width: the placeholder shortens, then the switches' labels; then two rows.
    const fit = lensLayout(w, { cut: { hidden: this.filters.hidden ? 0 : cut.hidden, ignored: this.filters.ignored ? 0 : cut.ignored }, count: searching ? found : null });
    const [hLabel, iLabel] = fit.labels;
    this.lensAdd = fit.add;
    this.lensRows = fit.rows;
    const at = this.stop;
    const row = (id) => h_flex().id(id).relative().h(26).flex_none().pl(10).pr(6).gap(6).items_center().text_size(11).overflow_hidden();
    const find = h_flex().id("nf-find").relative().flex_1().min_w(0).h_full().items_center().overflow_hidden()
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.startFind(cx); })
      .child(live
        ? Input.new(this.input).flex_1().min_w(0).h_full().text_size(11).text_color(t.foreground)
        : h_flex().min_w(0).gap(5).text_color(t.dim)
          .child(div().flex_none().text_color(t.accent).child("/"))
          .when(Boolean(fit.find), (el) => el.child(div().min_w(0).truncate().child(fit.find))));
    const icon = svg(`${ICONS}/search.svg`).relative().size(11).flex_none().text_color(this.typing ? t.accent : t.dim);
    const count = searching && fit.count ? div().flex_none().text_color(t.dim).child(`${found}`) : null;
    const chips = [
      this.filterChip(t, "nf-hidden", hLabel, this.filters.hidden, fit.cuts ? cut.hidden : 0, (cx) => this.setFilter("hidden", cx), at === "hidden"),
      this.filterChip(t, "nf-ignored", iLabel, this.filters.ignored, fit.cuts ? cut.ignored : 0, (cx) => this.setFilter("ignored", cx), at === "ignored"),
      ...ADDS[fit.add].map(([kind, label]) => this.addChip(t, kind, label, at === `add-${kind}`)),
    ];
    // ? keys: the line's last item (keyhelp.js).
    const keys = keysHint(t, "nf-keys", Boolean(this.keysShown), () => { this.keysShown = !this.keysShown; }).relative().h(20).px(4)
      .when(at === "keys", (el) => el.child(ring(t)));
    const rule = () => div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.ansi0, 1));
    if (fit.rows === 1) {
      return row("nf-lens").child(icon).child(find).when(Boolean(count), (el) => el.child(count)).children(chips).child(keys).child(rule());
    }
    // Two rows: the filter's own row takes a click anywhere (the icon, the gap, the count too).
    return v_flex().id("nf-lens").relative().flex_none()
      .child(row("nf-lens-find").cursor_text()
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.startFind(cx); })
        // Typing: the field's own frame, so it reads as a place to type.
        .when(live, (el) => el.child(div().absolute().left(4).right(4).top(3).bottom(3).border(1).border_color(this.typing ? t.accent : t.ansi0)))
        .child(icon).child(find).when(Boolean(count), (el) => el.child(count))
        .when(Boolean(this.query), (el) => el.child(div().flex_none().text_color(t.dim).child("esc clears")))
        .child(div().absolute().left(10).right(10).bottom(0).h(1).opacity(0.5).child(dither(t.ansi0, 1))))
      .child(row("nf-lens-chips").children(chips).child(div().flex_1()).child(keys).child(rule()));
  }

  /** `?`: every key, in the list's place (keyhelp.js); one column at the panel's width. */
  keysStrip(t, width = this.size.width) {
    return keysView(t, { id: "nf-keys-strip", title: "files", list: KEYS, narrow: width < 2 * SECTION, close: () => { this.keysShown = false; } });
  }


  /** Text with the matched characters in the accent. */
  matched(t, id, text, ranges, color) {
    return h_flex().relative().flex_1().min_w(0).overflow_hidden()
      .children(marks(text, ranges).map(([piece, hit], j) => div().id(`${id}-${j}`).flex_none().text_color(hit ? t.accent : color).child(piece)));
  }

  row(t, r, focused) {
    // The name's input (a new item's row, or the row being renamed) in place of the name.
    const editing = r.draft || (this.draft?.kind === "rename" && this.draft.path === r.path);
    const sel = editing || (r.path === this.sel && !this.draft), open = r.dir && this.folders.has(r.path);
    const cut = !r.draft && this.isCut(this.abs(r.path));
    const doomed = this.ask?.path === r.path || Boolean(this.ask?.set?.some((x) => x.path === r.path));
    // Marked (t, cmd-click, a range); dragged; the folder a drop would land in.
    const marked = this.marked?.has(r.path), dragged = Boolean(this.drag?.paths.includes(r.path));
    const target = Boolean(this.drag?.ok) && this.drag.into === r.path && r.path !== "";
    const mark = cut ? "cut" : r.hit ? r.git && MARK[r.git] ? r.git : null : this.marks[`${this.root}/${r.path}`];
    const hidden = r.name.startsWith(".");
    const color = doomed ? t.ansi1 : cut ? t.dim : sel ? t.foreground : mark && mark !== "•" ? t[MARK[mark]] : hidden || r.ignored ? t.dim : r.dir ? t.foreground : t.muted;
    return h_flex().id(`nf-${r.path}`).relative().h(ROW).w_full().pl(8 + r.depth * 14).pr(10).gap(6).items_center()
      .hover((s) => s.bg(t.ansi0 + "55"))
      // A marked row: a light accent dither and a dotted accent edge on the left.
      .when(marked && !sel, (el) => el.child(dither(t.accent + "30", 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).child(dither(t.accent, 1))))
      .when(sel, (el) => el.child(dither(focused ? t.ansi0 : t.ansi0 + "88", 1))
        .when(marked, (el) => el.child(dither(t.accent + "30", 1)))
        .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(focused ? t.accent : t.ansi8)))
      // The folder a drop goes into: framed in the accent.
      .when(target, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)).child(dither(t.accent + "40", 1)))
      // Indent guides: one dotted rule per level.
      .children(Array.from({ length: r.depth }, (_, d) => div().absolute().top(0).bottom(0).left(14 + d * 14).w(1).opacity(0.5).child(dither(t.ansi0, 1))))
      .child(r.head ? div().w(10).flex_none() : r.dir ? svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).relative().size(10).flex_none().text_color(t.dim) : div().w(10).flex_none())
      .child(svg(`mods/files/${r.dir ? "folder" : "file"}.svg`).relative().size(12).flex_none()
        .text_color(r.dir ? (open ? t.accent : t.ansi4) : t.dim))
      .child(editing ? Input.new(this.nameInput).flex_1().min_w(0).h(ROW).text_size(12).text_color(t.foreground)
        : r.hit ? this.matched(t, `nf-m-${r.path}`, r.name, r.ranges, cut ? t.dim : color)
        : div().relative().flex_1().min_w(0).truncate().text_color(r.head || dragged ? t.dim : marked ? t.accent : color).child(r.name))
      .when(Boolean(mark) && !editing, (el) => el.child(div().relative().flex_none().when(mark !== "cut", (el) => el.w(8))
        .text_color(mark === "•" || mark === "cut" ? t.ansi3 : t[MARK[mark]]).child(mark)));
  }

  menuBox(t) {
    const m = this.menu, w = Math.min(240, this.size.width - 16);
    const h = m.items.length * MENU_ROW + 20;
    // The key column fits its widest key on one line (7 px a character at size 11, as nocturne-git's menus).
    const keyW = keyColumn(m.items);
    const x = Math.max(8, Math.min(m.at.x, this.size.width - w - 8)), y = Math.max(8, Math.min(m.at.y, this.size.height - h - 8));
    const edge = (where) => h_flex().absolute().left(0).right(0).h(13).items_center().text_size(11)
      .when(where === "top", (el) => el.top(-6)).when(where === "bottom", (el) => el.bottom(-6))
      .child(div().h(1).w(8).flex_none().bg(t.accent))
      .when(where === "top", (el) => el.child(div().flex_shrink(1).min_w(0).px(4).truncate().text_color(t.foreground).child(m.row.path ? m.row.name.split("/").pop() : tilde(this.root))))
      .child(div().h(1).flex_1().min_w(8).bg(t.accent));
    const rows = m.items.map((it, i) => h_flex().id(`nf-mi-${i}`).relative().h(MENU_ROW).px(10).gap(10).items_center().text_size(11)
      .hover((s) => s.bg(t.ansi0 + "66"))
      .on_mouse_move((_e, cx) => { if (m.n !== i) { m.n = i; cx.notify(); } })
      .on_click((_e, cx) => { cx.stop_propagation(); this.menu = null; this.act(it.act, m.row, cx); cx.notify(); })
      .when(i === m.n, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
      .child(div().relative().w(keyW).min_w(keyW).flex_none().overflow_hidden().text_color(t.accent).child(it.key))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(i === m.n ? t.foreground : t.muted).child(it.label)));
    return div().id("nf-menu-layer").absolute().inset_0()
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.menu = null; cx.notify(); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu = null; cx.notify(); })
      .child(v_flex().id("nf-menu").absolute().left(x).top(y).w(w).pt(10).pb(6).bg(t.background).border_l(1).border_r(1).border_color(t.accent)
        .on_mouse_down("left", stop)
        .children(rows)
        .child(edge("top")).child(edge("bottom")));
  }

  /** A key and what it does in the hint line, clickable. */
  hintKey(t, id, key, label, action) {
    return h_flex().id(id).relative().flex_none().gap(4).items_center()
      .hover((s) => s.bg(t.ansi0 + "55"))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { action(cx); cx.notify(); })
      .child(div().text_color(t.accent).child(key))
      .child(div().text_color(t.muted).child(label));
  }

  /** The hint line at the bottom: the delete question, the name input's keys,
   *  what an operation said, else the copy, search and listing notes. */
  footer(t, searching) {
    const line = () => v_flex().id("nf-foot").flex_none().px(10).py(4).gap(3).text_size(10).text_color(t.dim).border_t(1).border_color(t.ansi0);
    const keys = (...ks) => h_flex().flex_wrap().gap_x(12).gap_y(2).children(ks);
    if (this.drag) {
      const d = this.drag;
      return line().child(div().text_color(d.ok ? t.foreground : t.dim)
        .child(d.into == null ? `Drop on a folder, or below the rows for ${tilde(this.root)} · esc cancels`
          : d.ok ? `Drop: ${this.dragLabel(d)} into ${d.into ? `${base(d.into)}/` : tilde(this.root)}${d.moving.length < d.paths.length ? ` (${d.paths.length - d.moving.length} already there)` : ""}`
          : d.why));
    }
    if (this.ask) {
      const a = this.ask;
      return line()
        .child(div().text_color(a.trash ? t.foreground : t.ansi1).child(a.set ? deleteManyQuestion(a.set, Boolean(a.trash)) : deleteQuestion(a.name, a.dir, Boolean(a.trash))))
        .child(keys(
          this.hintKey(t, "nf-ask-yes", "y", a.trash ? "move to the Trash" : "delete", (cx) => { this.ask = null; this.remove(a, cx); }),
          this.hintKey(t, "nf-ask-no", "esc", "keep it", () => { this.ask = null; })));
    }
    if (this.draft) {
      const d = this.draft, rename = d.kind === "rename";
      const where = rename ? "" : ` in ${d.dir ? `${base(d.dir)}/` : tilde(this.root)}`;
      const what = rename ? `Rename “${d.name}”: a path moves it` : `New ${d.kind}${where}${d.kind === "file" ? ": end with / for a folder" : ""}`;
      return line()
        .when(Boolean(this.msg), (el) => el.child(div().text_color(this.msg.error ? t.ansi1 : t.foreground).child(this.msg.text)))
        .child(div().text_color(t.foreground).child(what))
        .child(keys(
          this.hintKey(t, "nf-draft-ok", "enter", rename ? "rename" : "create", (cx) => this.commitDraft(cx)),
          this.hintKey(t, "nf-draft-no", "esc", "cancel", (cx) => this.endDraft(cx))));
    }
    const text = this.msg ? this.msg.text : this.copied ? this.copiedText ?? "path copied" : searching && this.note ? this.note
      : this.limited ? `Listing cut at ${PER_FOLDER} per folder, ${TOTAL} in all` : null;
    // Marks: how many, and what acts on them.
    if (!text && this.marked?.size) {
      const n = this.marked?.size;
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

  empty(t, title, hint, add = false) {
    return v_flex().flex_1().min_h(0).items_center().justify_center().gap(10).px(16).text_size(11)
      .child(svg(`${ART}/moon-8.svg`).w(44).h(44).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child(title))
      .when(Boolean(hint), (el) => el.child(div().text_center().text_color(t.ansi8).child(hint)))
      // An empty folder: its first file, as a / + file make it.
      .when(add, (el) => el.child(h_flex().id("nf-empty-add").relative().h(20).px(6).gap(7).items_center().text_color(t.muted)
        .hover((s) => s.bg(t.ansi0 + "55").text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { this.addNew("file", cx); cx.notify(); })
        .child(div().text_color(t.accent).child("+")).child(div().child("new file")).child(div().text_color(t.ansi8).child("a"))));
  }

  render(cx) {
    const t = theme();
    const rows = this.shown();
    this.publish();
    if (this.pendingSel && rows.length) {
      const back = this.pendingSel.startsWith(this.root + "/") ? this.pendingSel.slice(this.root.length + 1).split("/")[0] : null;
      this.pendingSel = null;
      if (back) { const i = rows.findIndex((r) => r.path === back); if (i >= 0) this.select(rows, i); }
    }
    if (this.want) { const i = rows.findIndex((r) => r.path === this.want); if (i >= 0) { this.want = null; this.select(rows, i); } }
    if (this.sel && !this.want && !rows.some((r) => r.path === this.sel)) this.sel = null;
    const focused = this.handle.is_focused() || this.typing || this.naming;
    // The new item's input row where it will appear, put on screen once.
    const list = this.listed = this.withDraft(rows);
    // Marks on rows no longer shown (folded away, filtered out, gone) drop out.
    if (this.marked?.size && !this.drag) {
      const shownNow = new Set(rows.map((r) => r.path));
      if ([...this.marked].some((p) => !shownNow.has(p))) this.marked = new Set([...this.marked].filter((p) => shownNow.has(p)));
    }
    if (this.draft && !this.draft.shown) {
      const i = list.findIndex((r) => r.draft || r.path === this.draft.path);
      if (i >= 0) { this.draft.shown = true; this.scroll.scroll_to_item(i); }
    }
    const w = this.size.width;
    const searching = Boolean(this.query.trim());
    let body;
    if (searching && this.hits && !rows.length) body = this.empty(t, "No files match", this.note ?? `“${this.query.trim()}” under ${tilde(this.root)}`);
    else if (searching && !this.hits) body = this.empty(t, "Searching…", null);
    else if (this.error && !list.length) body = this.empty(t, "Can't read this folder", this.error);
    else if (!list.length) body = this.empty(t, this.loading ? "Listing files…" : "Nothing here", this.loading ? null : tilde(this.root), !this.loading);
    else body = div().id("nf-tree").relative().flex_1().min_h(0).py(4).text_size(12)
      // A drop below the rows goes into the root: the list framed in the accent.
      .when(Boolean(this.drag?.ok) && this.drag.into === "", (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
      .child(v_virtual_list("nf-rows", list.length, ROW, (i) => list[i].path,
        (range) => list.slice(range.start, range.end).map((r) => this.row(t, r, focused)))
        .on_item_click((path, cx) => this.pick(path, cx))
        // The pane's own right press comes after this and opens the menu for the row.
        .on_item_secondary_click((path) => { this.pressed = rows.find((r) => r.path === path) ?? null; })
        .size_full().track_scroll(this.scroll))
      .child(Scrollbar.vertical("nf-rows").absolute().inset_0());
    const foot = this.footer(t, searching);
    // The preview split: its side follows the pane's shape; no room for both parts, no split.
    const side = this.lookState.on && this.look ? (this.side = lookSide(this.size, this.side)) : null;
    const px = side ? lookSize(this.size, side, this.dragged ?? this.lookState[side]) : null;
    if (px != null) this.follow(cx);
    this.geo = { side, px };
    // A native view (PDF, clip, font) would cover the menu: set aside while it's open.
    const aside = Boolean(this.menu) && px != null;
    if (aside !== Boolean(this.aside)) { this.aside = aside; cx?.timer?.after(0, () => this.natives("setVisible", { visible: !aside })); }
    const treeW = side === "right" && px != null ? this.size.width - px - DIVIDER : this.size.width;
    // ?: the keys in the list's place, the toolbar and filter line stay (keyhelp.js).
    const area = this.keysShown ? div().relative().flex_1().min_h(0).child(this.keysStrip(t, treeW)) : body;
    const endDrag = () => {
      if (!this.dragging) return false;
      if (this.dragged != null) this.saveLook({ [this.dragging]: this.dragged });
      this.dragging = null; this.dragged = null;
      return true;
    };
    return v_flex().id("nocturne-files").relative().size_full().bg(t.background).text_color(t.foreground).track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      // A row's click comes after this: alt-double-click opens a Markdown file as text.
      .on_mouse_down("left", (e, cx) => {
        if (endDrag()) cx?.notify();
        this.alt = Boolean(e?.modifiers?.alt);
        // A row's click comes after this: cmd and shift mark rather than open.
        this.mods = e?.modifiers ?? {};
        this.pressAt(e);
        // A click in the name's input keeps it (a click on another row ends it: pick).
        if (!this.draft) this.handle.focus();
        // A click elsewhere keeps what the delete question was about.
        if (this.ask) { this.ask = null; cx?.notify(); }
      })
      .on_mouse_down("right", (e, cx) => {
        if (e?.local_position) this.mouse = { x: e.local_position.x / zoom(), y: e.local_position.y / zoom() };
        const row = this.pressed ?? { path: "", name: this.root, dir: true };
        this.pressed = null;
        this.openMenu(row, cx);
      })
      .on_mouse_move((e, cx) => {
        if (e.local_position) this.mouse = { x: e.local_position.x / zoom(), y: e.local_position.y / zoom() };
        // The divider follows the pointer while it's held.
        if (this.dragging && e.local_position) { const f = dragShare(this.size, this.dragging, this.mouse); if (f != null && f !== this.dragged) { this.dragged = f; cx.notify(); } }
        // A row held and moved: dragged.
        else if (this.press && e.local_position) this.dragMove(this.mouse, cx);
      })
      .on_mouse_up("left", (_e, cx) => { if (endDrag() | this.dragEnd(cx)) cx.notify(); })
      .on_hover((over, cx) => { if (!over && (endDrag() | Boolean(this.drag))) { this.cancelDrag(); cx.notify(); } })
      .on_size_change((size, cx) => {
        const s = { width: size.width / zoom(), height: size.height / zoom() };
        if (Math.abs(s.width - this.size.width) > 1 || Math.abs(s.height - this.size.height) > 1) { this.size = s; cx.notify(); }
      })
      .child(this.toolbar(t, w, focused))
      .child(this.lens(t, w, rows.filter((r) => !r.head).length))
      .when(px == null, (el) => el.child(area).when(Boolean(foot), (el) => el.child(foot)))
      .when(px != null, (el) => el.child(this.split(t, side, px, area, foot)))
      .when(Boolean(this.menu), (el) => el.child(this.menuBox(t)))
      // What's dragged, beside the pointer.
      .when(Boolean(this.drag), (el) => el.child(this.ghost(t)));
  }

  /** What a drag carries, as said: the name, or how many (over a target: how many it would move). */
  dragLabel(d) {
    const list = d.ok && d.moving ? d.moving : d.paths;
    return list.length === 1 ? `“${base(list[0])}”` : `${list.length} items`;
  }

  /** The dragged rows' label at the pointer: the name, or how many. */
  ghost(t) {
    const d = this.drag, list = d.ok && d.moving ? d.moving : d.paths, n = list.length;
    const x = Math.min(d.at.x + 14, Math.max(0, this.size.width - 160)), y = d.at.y + 10;
    return h_flex().id("nf-ghost").absolute().left(x).top(y).max_w(200).h(20).px(8).gap(6).items_center().text_size(11)
      .bg(t.background).border_1().border_color(d.ok ? t.accent : t.ansi8)
      .child(svg(`mods/files/${n === 1 && !this.shown().find((r) => r.path === list[0])?.dir ? "file" : "folder"}.svg`).relative().size(11).flex_none().text_color(d.ok ? t.accent : t.dim))
      .child(div().min_w(0).truncate().text_color(d.ok ? t.foreground : t.muted).child(n === 1 ? base(list[0]) : `${n} items`));
  }
}
