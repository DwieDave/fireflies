// Nocturne editor: files, edited, in a pane beside where it was opened
// from: a source link clicked in a terminal (`path:42:7` goes there), a file
// picked in the files pane or the picker (cmd-p, cmd-shift-f), an "edit" in the
// Markdown viewer or the preview, or `editor.open {path, line?, col?}`.
// Props: { path, line?, col?, on?, slot } (the file it opened on).
//
// File tabs: the pane holds several files, a tab each on the strip along its
// top (tabs.js decides placement, closing, labels, what fits); with one file
// the strip isn't drawn and the bar names it with its unsaved mark. Drag a
// tab along the strip to move it (it lifts, a stake marks where it lands),
// or ]B / [B, :tabm, space b < / >, move-tab-left / -right. Each tab is a
// record (newDoc) with its own code editor (text, undo, caret, scroll), what's
// on disk, unsaved changes, server document, problems and Markdown preview;
// `this.path`, `this.editor`, ... are the shown tab's (TAB_FIELDS at the end),
// and what runs in the background for a tab (reading, watching, saving, its
// server) takes the tab. Definition, references, a card link and `:e` open
// files as tabs here; the files pane, the picker and the Markdown viewer send
// them through shared `editor.open` (editor-route.ts); the app's
// `editor.open` finds a file in any tab through shared `editor.paths`
// and shows it with `editor.goto`. Closing an edited tab asks on a
// line under the bar; the last tab closes the pane; the tabs come back after
// a restart (localStorage `tabs`, in their order). Keys: vim gt / gT, H / L
// (with one tab: the screen's top / bottom), ]b / [b, :bn :bp :bd :b N :ls,
// space b; next-tab / prev-tab / close-tab / move-tab-left / -right commands.
//
// Pop a tab out into an editor pane of its own beside (or a new tab of the
// window): the tab's menu (a right-click on it, space b m, tab-menu), space b
// o / :popout, pop-out, or a tab dragged off the strip and dropped on the
// pane. Its unsaved text, caret, scroll, Markdown view, wrap and drawn state
// go with it (shared `editor.handover`; undo stays behind: it lives
// in the editor it was typed in); the last tab popping out closes its pane.
// The popped pane (props.popped) keeps its file while it lives and takes no
// other files from the routing; space b i / :popin / pop-in moves its shown
// tab into the editor beside, as a tab.
//
// Every kind of file is a tab: what the preview shows (pictures, PDFs,
// tables, patches, databases, fonts, clips) is drawn in its tab by the
// preview's viewer (viewer.js, embedded: its slim bar, no keys of its own; a
// copy of preview's), the pane taking the keys (H / L, j / k scroll,
// e as text, p the preview pane, o the system's app, y the path, d close).
// Tables, patches and SVG switch between drawn and text (e, the bar's
// "drawn" chip, cmd-shift-v). A file opened to be looked at (a files pane's
// open, a terminal's link: `look`) starts drawn, a Markdown file in its
// preview; an edit opens the text.
//
// Links in the hover card (cardlinks.js) open on a click, and a keyboard
// card rings them with tab (enter follows): web pages in the shown tab's
// browser pane (`browser.open:{url, slot}`) or a new one beside,
// files as tabs here.
//
// The text is gpui-kit's code editor (undo, selection, clipboard, multiple
// carets, folding) with tree-sitter colors in moonfly's roles. Around it,
// Nocturne's way (the diff pane's): a bar (unsaved mark, name, folder, the
// problems' counts, the language server, language and indent, line:col), a
// find line, a problems drawer, lazygit's hints along the bottom, and a hover
// card for the symbol or problem under the pointer (cmd-i at the caret):
// the signature and docs from the server, every problem's whole message, and
// for TypeScript the type expanded or folded a level at a time (+ / -).
//
// A language server starts when an editor of its language opens (the first
// one found in the workspace's .envrc environment through direnv, else on
// PATH, envrc.js; or settings.json's `editor.languages.<id>.server`), is
// shared by every editor of that workspace, and stops a while after the last
// closes. Saving writes only if the file is still what was read (otherwise
// it says so); a change on disk reloads a clean file and offers a choice to
// an edited one. Closing an edited editor asks first.
//
// Markdown files get a live preview beside the text (under it when the pane
// is narrow; each tab keeps its view, an "edit" from the viewer turns it on), drawn as it's typed by the Markdown viewer's renderer
// (markdown.js): math, mermaid, colored code, tables, callouts, footnotes,
// local images. It follows the text's scrolling and the text follows it;
// ticking a task box writes the [x] into the text; links go where they point
// (a heading in it, another .md file in the editor). The bar's chip, cmd-shift-v
// and space m p go split -> preview -> text; space m s / m v / m t pick one.
//
// Rendered (rendered.js, live.js): the fourth Markdown view, the document
// drawn and typed into. The block the caret is in is its own Markdown in a
// second code editor (lit: dithered ground, accent rail, its kind at the
// corner); every keystroke goes into the tab's code editor as one edit of
// those lines, so save, undo and the unsaved mark are the text view's and
// untouched lines stay byte for byte. Up / down past a block's edge step into
// the next; enter continues a list, at another block's end starts a paragraph
// below; a "+" by a block and "add a block" under the last add one, an empty
// one offers the kinds; vim works over the whole text as on plain text (the
// lit lines follow its caret and visual selection). The preview's blocks
// aren't cut while the rendered view is shown (previewStale: cut on the way
// back). The view switch goes rendered -> split -> preview -> text (space m r: rendered).
// Pictures (images.js): in a Markdown file (rendered or text view) a pasted
// picture (cmd-v of a screenshot: the editor's paste_other; of a copied image
// file: its name is the clipboard's text, so cmd-v asks the clipboard first;
// vim's p in normal mode when the clipboard has no text) is saved beside the
// file (assets/<name>-<time>.png; a scratchpad's in <note>-assets/) and put
// in as an image block after the caret's block, one undoable edit (undo
// leaves the file). The clipboard's image is read with the system's tool
// (osascript, wl-paste / xclip, PowerShell): the app hands mods text only.
// md-image picks a file (the system's picker; a relative path), md-image-paste
// pastes; cmd-. p / v.
// The Markdown commands (mdedit.js) in every view but preview only: cmd-.
// (vim: space .) or the bar's "markdown" chip opens their list, a letter or a
// click runs one (b i ` k h H l n t x q c r, 0-6); commands md-<name>, md-menu.
//
// The scratchpad (scratch.ts): a tab on a note under `<app home>/scratchpad/`
// opens rendered, saves itself 600 ms after the typing and at once on close
// (never unsaved, never asks), titles itself "Scratchpad · <repo>"; its pane
// sends other files to an editor beside it (editor-route.ts skips it).
// nocturne.scratchpad opens it.
//
// Vim (vim.js): new editors start as settings.json `editor.vim` says (default
// on); the pane's "vim" chip, `:novim` and cmd-k v switch this pane only, and
// the pane keeps that choice (its localStorage) over the default. Its leader is space (settings.json
// editor.leader): a which-key popup lists the keys after it.
// Keys while it has focus (keys.json `mod:editor`), vim on or off:
// cmd-s save, cmd-f find (enter / shift-enter next / previous, esc closes),
// cmd-alt-f replace, cmd-l go to line, cmd-k n / cmd-k p next / previous
// problem, cmd-k m problems, cmd-k d definition, cmd-i hover, ctrl-= / ctrl--
// hover type more / less, cmd-r reload, cmd-k v vim on / off, cmd-k z word
// wrap on / off (vim: space u w, :set wrap / nowrap; the bar's "wrap" chip;
// the shown tab only), cmd-k ? (vim: space ?) the keys over the hint bar, whose
// last entry it is, cmd-shift-v the Markdown preview. Without vim:
// cmd-z / cmd-shift-z undo / redo, ctrl-g go to line.

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex, EditorState, Editor, InputState, Input, TextView } from "gpui-base";
import {
  props, theme, settings, run, panes, shared, setShared, readTextFile, writeTextFile, watchFolder, nextCommand, exec,
  home, appHome, languageOf, highlight, lspStart, lspRequest, lspNotify, lspNextMessage, lspRelease, setUnsaved, notify, keys,
  window as appWindow,
} from "herdr";
import {
  languageSettings, serverCandidates, ROOTS, rootScript, pickRoot, languageId, uri, diagnostics, lineNotes, counts,
  diagnosticsAt, nextProblem, hoverParts, parseGoto, firstLocation, tilde, dirname, basename, syntaxColors, colorRuns, hintList, editorKeys, serverNote,
  cardPlace, busy, progressWord, changeBetween, incremental, cardMarkdown, appBindings, chordOf,
} from "./logic.js";
import { createVim, feed, play, token, SHAPE, MODE_NAME, applyEdits } from "./vim.js";
import { MarkdownDoc, cacheImage, taskToggle, isLocalSource } from "./markdown.js";
import { follow, join } from "./paths.ts";
import { formKey, bindTab, tabActions } from "./form-keys.ts";
import { hint, keysHint, keysView, keysKey } from "./keyhelp.ts";
import { projectEnv, lookup, wrap, cacheName } from "./envrc.js";
import { fileChanges, newestId, follow as followFiles } from "./follow.ts";
import { placeTab, afterClose, stepTab, restoreTabs, keptTabs, unsavedNote, tabLabels, tabWidth, visibleTabs, MORE, showStrip, DRAG_START, gapAt, dropIndex, stakeAt, moved, tabKind, startsDrawn, drawnAfter, LOOK_KEYS, lookAction, tabMenuItems, tabMenuKey, handover, handoverFor } from "./tabs.js";
// Drawn tabs (a picture, a PDF, a table): the preview pane's own viewer, a copy
// of preview/viewer.js and what it imports (scripts/preview-shared.test.ts).
import Viewer from "./viewer.js";
import { OPEN, LAST, PATHS, HANDOVER, filesOf, editorPaths, isScratchpad } from "./editor-route.ts";
import { cardLinks, linkTarget, linkWhere } from "./cardlinks.js";
import { Rendered, editBetween } from "./rendered.js";
import { units as liveUnits, unitFor } from "./live.js";
import { run as mdCommand, tickLine, COMMANDS as MD_COMMANDS, LEVELS as MD_LEVELS, active as mdActive } from "./mdedit.js";
import { isNote, noteName, Autosave } from "./scratch.ts";
import { assetPlace, imageMarkdown, insertImage, readClipboardImage, maybeCopiedImage, relative, isImagePath, stamp } from "./images.js";
// Read off the module when used (pickFile): test stand-ins for herdr needn't know them all.
import * as herdr from "herdr";

// The find line's stops in tab order (form-keys.ts): the find field, Aa, ‹, ›
// and, replacing, the "with" field, replace, all.
const FIND_STOPS = [{ id: "find", kind: "text" }, { id: "case", kind: "toggle" }, { id: "prev", kind: "button" }, { id: "next", kind: "button", submit: true }];
const REPLACE_STOPS = [...FIND_STOPS, { id: "with", kind: "text" }, { id: "replace-one", kind: "button" }, { id: "replace-all", kind: "button" }];

const MOD = "editor";
// Each editor's file name by slot, for its pane header (nocturne/header.js).
const TITLES = "editor.titles";
// The app asks an editor already on a file to go somewhere (`editor.open` with a line).
const GOTO = "editor.goto";
const POLL = 4000; // a file on another machine can't be watched
const CHANGE_DELAY = 40; // ms: edits typed together go to the server as one change (and before any question)
// How long a server runs on once its last editor closes (s): coming back to
// the project within it is instant. Fireflies keeps at most a few unused servers
// (least recently used stop first), so this is a ceiling, not a promise.
export const SERVER_IDLE = 15 * 60;
// The project environments kept on disk (envrc.js): a second app start runs no nix.
const envCache = {
  file: (dir) => `${appHome()}/cache/editor/${cacheName(dir)}`,
  async read(dir) {
    const text = await readTextFile(this.file(dir));
    const kept = text ? JSON.parse(text) : null;
    return kept?.dir === dir ? kept : null;
  },
  async write(dir, value) {
    const path = this.file(dir);
    const was = await readTextFile(path).catch(() => null);
    await writeTextFile(path, JSON.stringify({ dir, ...value }), was).catch(() => {});
  },
};
const BAR = 30, FIND = 28, HINTS = 22, DRAWER = 132, ROW = 24, TABS = 26;
// The line numbers' room from the pane's left edge, as the top bar's inset (px):
// the gutter right-aligns them, so a 4-digit file's touched the border.
export const GUTTER_INSET = 12;
// The Markdown preview: how it shows, in the order the switch goes.
const VIEWS = ["rendered", "split", "preview", "text"];
// Under this width a split puts the preview under the text.
const SIDE_BY_SIDE = 760;
// Links to these open in the preview pane (preview); other files with a language in the editor.
const PREVIEWED = /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|svg|avif|hei[cf]|pdf|csv|tsv|sqlite3?|db3?|diff|patch|ttf|otf|ttc|woff2?|mp4|m4v|mov|mp3|m4a|aac|wav|aiff?|flac|caf)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;
const CARD_W = 520;
// A tab's name is cut past this (px); its full path is in the bar.
const MAX_TAB_NAME = 180;
// A server that reported work within this long (ms) is still loading the
// workspace: rust-analyzer goes quiet for a moment between its phases, and
// an empty answer then means "not yet", not "nothing here".
const SETTLE = 2000;

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
const zoom = () => Number(settings()?.zoom) || 1;
/** A 50% checker dither filling the parent (as nocturne/kit.js). */
function dither(color, cell = 1) {
  const dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}
const stop = (_e, cx) => cx.stop_propagation();
/** A new editor pane's slot (its shared records' key). */
const newSlot = () => `ed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Where a dragged tab lands: a 2 px accent bar capped top and bottom, at the
 *  left edge of its box (as the app's tab strip, nocturne/tabdrag.js). */
function tabStake(t) {
  return div().absolute().left(-3).top(3).bottom(2).w(8)
    .child(div().absolute().left(3).top(0).bottom(0).w(2).bg(t.accent))
    .child(div().absolute().left(0).right(0).top(0).h(2).bg(t.accent))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent));
}

/** The editor's selection (and, drawn from it, search matches): the accent
 *  at 40%, see-through so the syntax colors read on it. */
export function selectionColor(t) {
  return String(t.accent ?? "#80a0ff").slice(0, 7) + "66";
}

/** The image commands in the list (main.js, not mdedit.js: they ask the clipboard or a picker):
 *  name -> [title, its letter after cmd-., what it writes]. */
const MD_IMAGE = { image: ["Image from a file", "p", "![](…)"], "image-paste": ["Paste an image", "v", "assets/"] };

/** The Markdown commands that, from a caret in the rendered view, take the caret's whole block. */
const WHOLE_BLOCK = new Set(["bullets", "numbers", "task", "tick", "quote", "fence"]);

/** cmd-. (ctrl-. off the Mac): the Markdown commands' list. */
export function isMdMenuKey(e) {
  const m = e?.modifiers ?? {};
  const mod = appWindow()?.platform === "macos" ? m.platform && !m.control : m.control && !m.platform;
  return e?.key === "." && mod && !m.alt && !m.shift;
}

/** One edit taking `a` to `b`: the span between their common start and end. */
function diff(a, b) {
  if (a === b) return null;
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const pos = (text, o) => { const before = text.slice(0, o).split("\n"); return { line: before.length - 1, col: before[before.length - 1].length }; };
  return { start: pos(a, s), end: pos(a, a.length - e), text: b.slice(s, b.length - e) };
}

export default class EditorPane extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    this.on = pr.on ?? null;
    this.slot = pr.slot ?? null;
    // Renamed, moved or deleted from the files pane (follow.ts): only what
    // comes after this start counts.
    this.seenChange = newestId(fileChanges(shared));
    // Files sent here as tabs (editor-route.ts): only requests after this start.
    this.seenOpen = shared(OPEN)?.n ?? 0;
    this.drawer = false;
    this.mode = null; // null | "find" | "replace" | "line"
    this.caseSensitive = false;
    // The hover card: { line, col, keyboard, problems, parts, level, more, pending, note, scroll, link }.
    // It sits at its place in the text (editor.bounds), under the word or above it.
    this.card = null;
    this.overCard = false;
    this.size = { width: 800, height: 600 };
    this.message = null; // a short note in the bar (saved, reloaded, an error)
    this.asking = null; // closing a tab with unsaved changes: { doc, at } (the question's line)
    this.tabPress = null; this.tabDrag = null; // a press on a tab, and the drag it became: { from, gap, out } (tabs.js)
    this.tabMenu = null; // the tab's menu: { index, at, items }
    this.menuHandle = cx.focus_handle();
    this.listening = new Set(); // the servers this pane hears (one queue per server for every tab)
    this.handle = cx.focus_handle();
    bindTab(cx); // tab / shift-tab reach the key handler (form-keys.ts)
    // Vim: the pane's own switch, else settings.json editor.vim (default on).
    const leader = String(settings()?.editor?.leader ?? "space");
    this.vim = createVim({ leader: leader === "space" ? " " : leader === "comma" ? "," : leader.slice(0, 1) || " " });
    this.which = null; // the leader's next keys
    this.pending = ""; // keys typed toward a command
    // This pane's own vim switch, if it was flipped here before.
    try { const v = localStorage.getItem("vim"); this.paneVim = v === "on" ? true : v === "off" ? false : null; } catch { this.paneVim = null; }
    this.vimWas = this.vimOn();
    this.colors = syntaxColors(theme());
    // Markdown: how the preview shows (the pane remembers; each tab keeps its own after).
    let view = null;
    try { view = localStorage.getItem("preview"); } catch { /* the default */ }
    this.defaultView = VIEWS.includes(view) ? view : "split";
    this.previewHandle = cx.focus_handle();
    // A drawn tab: the pane's keys while it shows, and the viewer's props (one viewer, the shown tab's file).
    this.lookHandle = cx.focus_handle();
    this.viewerProps = { embedded: true, path: null, on: this.on, scroll: null, reload: 0 };
    this.lookPending = "";
    // The keys overview takes the keyboard while it's open (? would type into the file).
    this.keysHandle = cx.focus_handle();
    this.findInput = InputState.new({ placeholder: "find" });
    this.findInput.on("change", (_e, cx) => this.search(cx));
    this.findInput.on("submit", (e, cx) => this.step(e?.shift ? -1 : 1, cx));
    this.replaceInput = InputState.new({ placeholder: "replace with" });
    this.replaceInput.on("submit", (e, cx) => this.replace(!!e?.secondary, cx));
    // A click into a field moves the find line's stop with it.
    this.findInput.on("focus", () => { this.findAt = "find"; });
    this.replaceInput.on("focus", () => { this.findAt = "with"; });
    this.lineInput = InputState.new({ placeholder: "line or line:column" });
    this.lineInput.on("submit", (_e, cx) => this.goLine(cx));

    // The tabs: as kept (a restart), else the props' file (where the files
    // pane moved it: its props keep the first path).
    let kept = null, moved = null;
    try { kept = JSON.parse(localStorage.getItem("tabs") ?? "null"); } catch { /* none kept */ }
    try { moved = JSON.parse(localStorage.getItem("moved") ?? "null"); } catch { /* a nicety */ }
    const start = restoreTabs(kept, pr.path ?? "", moved);
    // The props' file opened to be looked at (a terminal's link: `look`) starts drawn.
    const req = shared(OPEN);
    const asked = req && req.slot == null && req.path === pr.path && Date.now() - (req.at ?? 0) < 10000 ? req : null;
    // A tab popped out of another editor into this new one: what it had (tabs.js handover).
    const handed = !kept?.paths?.length ? handoverFor(shared(HANDOVER), pr.slot, pr.path) : null;
    this.docs = start.paths.map((path) => this.newDoc(path, path === pr.path && !kept?.paths?.length ? { look: Boolean(pr.look || asked?.look), view: asked?.view ?? null, hand: handed } : {}));
    this.cur = this.docs[start.active];
    // The props' line goes to the props' file (editor.open opened this pane on it).
    let go = null;
    if (pr.line) {
      const d = this.docs.find((x) => x.path === pr.path) ?? this.cur;
      this.cur = d;
      go = { line: pr.line, col: pr.col ?? 1 };
    }
    // An "edit" from the Markdown viewer asked for the preview (editor-route.ts: slot null).
    if (asked?.view && asked.path === this.cur.path && this.cur.markdown && VIEWS.includes(asked.view)) this.cur.view = asked.view;
    this.select(this.cur, cx, go, true);
    // The tabs it restored, told to the routing now: shared PATHS outlives a
    // restart, and an entry from before (a scratchpad note this pane no longer
    // holds) would send the app's editor.open to a pane that ignores it.
    this.publish();
    if (this.on) cx.timer.every(POLL, (cx) => { for (const d of this.docs) if (d.state !== "unloaded" && d.state !== "loading") this.load(cx, null, true, d); });
    // A newly opened editor takes the keyboard.
    for (const ms of [0, 120, 400]) cx.timer.after(ms, () => this.focusText());
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(`${MOD}.`, "");
        this.command(c, cx);
        cx.notify();
      }
    });
  }

  /** A file's record: its own code editor (text, undo, caret, scroll,
   *  folds), what's on disk, unsaved changes, its server document, problems
   *  and Markdown preview. Read when first shown (`state` "unloaded" till then). */
  newDoc(path, { look = false, view = null, hand = null } = {}) {
    const lang = languageOf(path) ?? "text";
    const opts = languageSettings(settings()?.editor, lang);
    const d = {
      path, firstPath: path, lang, opts,
      openedAt: Date.now(), // the language server's timeline counts from here (mark)
      deleted: false, // the file was deleted (the files pane): a save writes it again
      saved: null, // the text as on disk, when last read or written
      state: "unloaded", // unloaded | loading | ready | missing | error
      error: null, dirty: false,
      conflict: false, // the file changed on disk while edited
      problems: [], // diagnostics()
      server: null, // { id, argv, root, status: "starting" | "ready" | "exited" | "none", note }
      version: 1,
      sent: null, // the text the server has (its last didOpen / didChange)
      progress: new Map(), // the server's work under way ($/progress): token -> { title, message, percentage }
      hovers: new Map(), // answers by place, level and version: asking again is instant
      text: "", // the text as last read from the editor (vim reads it)
      find: { count: 0, current: null }, searchMark: null,
      markdown: lang === "markdown", preview: new MarkdownDoc("pv"),
      images: new Map(), // abs path -> cache name | null (can't) | undefined (copying)
      view: this.defaultView ?? "split",
      driver: "editor", // which side scrolled last: the other follows
      // Drawn by the preview's viewer (tabs.js tabKind): "look" files always, "either" ones until shown as text.
      kind: tabKind(path), look: startsDrawn(path, { look, view }),
    };
    // Markdown takes the view asked for, else the pane's (rendered, split, preview, text: its last pick).
    if (d.markdown && VIEWS.includes(view)) d.view = view;
    // Handed over from another editor: its view and drawn state now, its text, caret and scroll once read (load).
    if (hand) {
      if (d.markdown && VIEWS.includes(hand.view)) d.view = hand.view;
      if (d.kind === "either") d.look = Boolean(hand.look);
      d.hand = hand;
    }
    const t = theme();
    // Word wrap in this tab: the language's soft_wrap until cmd-k z / space u w
    // / :set wrap / the bar's chip switch it (this tab only, not written to settings).
    d.softWrap = !!opts.soft_wrap;
    d.editor = EditorState.new({
      language: lang, value: "", font_family: settings()?.font_family || "JetBrains Mono", font_size: 13,
      line_numbers: true, folding: true, soft_wrap: d.softWrap, syntax: this.colors,
      // The theme's selection is moonfly's border tone, hard to see on its
      // background: moonfly blue at 40% stands out and keeps text readable.
      selection: selectionColor(t),
    });
    d.editor.set_tab_size(opts.tab_size, opts.insert_spaces === false);
    if (d.hand && Boolean(d.hand.wrap) !== d.softWrap) { d.softWrap = Boolean(d.hand.wrap); d.editor.set_soft_wrap?.(d.softWrap); }
    d.editor.on("key", (e, cx) => this.vimKey(e, cx));
    d.editor.set_cursor_shape(this.vimOn() ? SHAPE.normal : "bar");
    d.editor.on("change", (_e, cx) => this.changed(cx, d));
    // A paste the editor found no text in (a screenshot): a Markdown file takes it as an image block.
    d.editor.on("paste_other", (_e, cx) => { if (d.markdown && d === this.cur) this.pasteImage(cx); });
    d.editor.on("hover", (e, cx) => { if (d === this.cur) this.hovered(e, cx); });
    // The editor losing the keyboard closes the card (and watchFocus, while
    // one is open: the editor's blur doesn't reach mods every time).
    d.editor.on("blur", (_e, cx) => this.closeCard(cx));
    // Markdown: the rendered view's block editor (rendered.js); a scratchpad
    // note (scratch.ts) opens rendered and saves itself as it's typed.
    if (d.markdown) d.rendered = new Rendered(d, this.renderedHost());
    d.scratch = isNote(path, appHome());
    if (d.scratch) {
      d.view = "rendered";
      d.saveState = "saved";
      d.autosave = new Autosave({ write: () => this.autosaveWrite(d), timer: (ms, fn) => this.autosaveTimer(ms, fn), onState: (st) => { d.saveState = st; } });
    }
    d.editor.on("scroll", (_e, cx) => {
      if (d !== this.cur) return;
      // The card stays at its word: drawn again where the word went (and once
      // more a frame later, when the scrolled text has been laid out).
      if (this.card) { cx.notify(); cx.timer.after(16, (cx) => cx.notify()); }
      if (Date.now() - (d.previewDrove ?? 0) < 150) return;
      d.driver = "editor";
      if (d.markdown && d.view === "split") cx.notify();
    });
    return d;
  }

  /** Every file record (a pane built without init has the one it was given). */
  allDocs() {
    return this.docs ?? (this.cur ? [this.cur] : []);
  }

  // ---- the tabs

  /** Shows tab `d`: the card, find line and vim's pending keys go; read the
   *  first time; `go` { line, col } (one-based) puts the caret there. */
  select(d, cx, go = null, first = false) {
    if (d !== this.cur || first) {
      if (!first) {
        this.closeCard(cx);
        if (this.mode === "find" || this.mode === "replace") this.editor.find_close();
        this.mode = null;
        this.asking = null;
        this.keysShown = false;
        // A tab's menu belongs to the tab it opened on: another one shown closes it.
        this.tabMenu = null;
      }
      this.cur = d;
      this.vimSettled(this.vimOn());
    }
    this.vim.indent = d.opts.insert_spaces === false ? "\t" : " ".repeat(d.opts.tab_size);
    if (d.look) this.mountViewer(cx);
    this.syncViewer();
    if (d.look) {
      // Drawn: the viewer reads it; its folder's changes draw it again (load).
      if (!d.watched && !this.on && d.path) { d.watched = true; this.watch(cx, d); }
    } else if (d.state === "unloaded") {
      d.state = "loading";
      this.load(cx, go, false, d);
      if (!this.on && d.path) this.watch(cx, d);
    } else if (go && d.state !== "loading") this.goto(go.line - 1, (go.col ?? 1) - 1, cx);
    else if (go) d.go = go;
    this.title();
    this.keepTabs();
    if (!first || d.look) {
      if (d.look) cx?.timer?.after?.(0, () => this.lookHandle.focus());
      else if (d.markdown && d.view === "preview") cx.timer.after(0, () => this.previewHandle.focus());
      else if (d.markdown && d.view === "rendered" && d.state !== "loading") { d.rendered.open(cx); this.focusText(); }
      else this.focusText();
    }
    cx?.notify?.();
  }

  /** Opens `path` here as a tab (the one showing it, if open) and shows it;
   *  `line` / `col` one-based; `view` a Markdown file's view, or "preview" /
   *  "text" for a table, patch or SVG (drawn or as text); `look`: opened to be
   *  looked at (a new tab of a picture or table starts drawn). */
  openFile(path, cx, { line = null, col = null, view = null, look = false } = {}) {
    if (!path) return;
    // A scratchpad's pane is the note's own: other files open in an editor beside it.
    if (this.docs?.length && this.docs.every((d) => d.scratch) && !isNote(path, appHome())) {
      run("editor.open", { path, ...(line ? { line, col: col ?? 1 } : {}), ...(this.me() ? { pane: this.me().pane } : {}) });
      return;
    }
    const at = placeTab(this.docs.map((d) => d.path), this.docs.indexOf(this.cur), path);
    if (at.added) this.docs.splice(at.index, 0, this.newDoc(path, { look, view, hand: handoverFor(shared(HANDOVER), this.slot, path) }));
    const d = this.docs[at.index];
    if (!at.added) {
      if (view && d.markdown && VIEWS.includes(view)) d.view = view;
      const drawn = drawnAfter(path, { view });
      if (drawn != null && drawn !== d.look) this.setDrawn(d, drawn, cx, false);
    }
    this.select(d, cx, line && !d.look ? { line, col: col ?? 1 } : null);
    this.publish();
  }

  // ---- popping a tab out into a pane of its own, and back in

  /** Tab `d` into a new editor pane of its own: beside this one (`where`
   *  "beside"), or in a new tab of the window ("tab"); what it had goes with
   *  it (handover) and it leaves this strip without asking (its unsaved text
   *  went too). The last tab popping out closes this pane. */
  popOut(cx, d = this.cur, where = "beside") {
    if (!d) return;
    if (d.scratch) return this.say("the scratchpad is a pane of its own");
    const me = this.me();
    const slot = newSlot();
    setShared(HANDOVER, handover(d, slot));
    const props = { path: d.path, slot, popped: true, ...(this.on ? { on: this.on } : {}) };
    if (where === "tab" || !me) run("tab.new", { mod: MOD, props, name: basename(d.path) });
    else run("pane.split", { direction: "auto", pane: me.pane, mod: MOD, props });
    this.leave(cx, d);
  }

  /** The shown tab into another editor of this window's tab, as a tab there
   *  (the one that last had the keyboard, else the first): what it had goes
   *  with it; this pane closes when it was its last tab. */
  popIn(cx, d = this.cur) {
    if (!d || d.scratch) return;
    const target = this.otherEditor();
    if (!target) return this.say("no other editor in this tab");
    setShared(HANDOVER, handover(d, target.props.slot));
    setShared(OPEN, { slot: target.props.slot, path: d.path, n: (shared(OPEN)?.n ?? 0) + 1, at: Date.now() });
    run("pane.focus", { pane: target.pane });
    this.leave(cx, d);
  }

  /** Another editor in this pane's window tab (not a scratchpad's), for popIn. */
  otherEditor() {
    const me = this.me();
    if (!me) return null;
    const eds = panes().filter((p) => p.mod === MOD && p.tab === me.tab && p.pane !== me.pane && !p.parked && p.props?.slot && (p.props?.on ?? null) === (this.on ?? null) && !isScratchpad(p));
    return eds.find((p) => p.props.slot === shared(LAST)) ?? eds[0] ?? null;
  }

  /** Tab `d` goes from here without asking: it lives on elsewhere. */
  leave(cx, d) {
    d.dirty = false;
    this.closeTab(cx, d, true);
  }

  // ---- the tab's menu

  /** Opens the menu of tab `index` (the shown one by default): a right-click
   *  on it, space b m, the tab-menu command. */
  openTabMenu(cx, index = this.docs.indexOf(this.cur)) {
    const d = this.docs[index];
    if (!d) return;
    const items = tabMenuItems({ count: this.docs.length, index, others: Boolean(this.otherEditor()), scratch: Boolean(d.scratch) });
    this.tabMenu = { index, at: 0, items };
    this.closeCard(cx);
    cx?.timer?.after?.(0, () => this.menuHandle.focus());
    cx?.notify?.();
  }

  closeTabMenu(cx, refocus = true) {
    if (!this.tabMenu) return;
    this.tabMenu = null;
    if (refocus) this.focusText();
    cx?.notify?.();
  }

  /** Runs a tab menu entry on its tab. */
  tabMenuAct(act, cx) {
    const m = this.tabMenu;
    const d = this.docs[m?.index ?? this.docs.indexOf(this.cur)];
    this.closeTabMenu(cx, act === "move-left" || act === "move-right");
    if (!d) return;
    const i = this.docs.indexOf(d);
    if (act === "pop-out") this.popOut(cx, d, "beside");
    else if (act === "pop-out-tab") this.popOut(cx, d, "tab");
    else if (act === "pop-in") this.popIn(cx, d);
    else if (act === "move-left") this.moveTab(i, i - 1, cx);
    else if (act === "move-right") this.moveTab(i, i + 1, cx);
    else if (act === "close") this.closeTab(cx, d);
    else if (act === "close-others") this.closeOthers(cx, d);
    cx?.notify?.();
  }

  /** Every tab but `d` closes; those with unsaved changes stay (and say so). */
  closeOthers(cx, d = this.cur) {
    const kept = this.docs.filter((x) => x !== d && x.dirty);
    for (const x of this.docs.filter((x) => x !== d && !x.dirty)) this.closeTab(cx, x, true);
    if (this.cur !== d) this.select(d, cx);
    if (kept.length) this.say(`${kept.length} kept: unsaved changes (${kept.map((x) => basename(x.path)).join(", ")})`);
  }

  tabMenuKeyDown(e, cx) {
    const m = this.tabMenu;
    if (!m) return;
    const r = tabMenuKey(m.items, m.at, e);
    if (!r.taken) return;
    cx?.stop_propagation?.();
    m.at = r.at;
    if (r.act) return this.tabMenuAct(r.act, cx);
    if (r.close) return this.closeTabMenu(cx);
    cx?.notify?.();
  }

  /** The menu, under its tab on the strip (at the bar's left with one tab). */
  tabMenuView(t) {
    const m = this.tabMenu;
    const z = zoom();
    const x = Math.max(4, Math.min(this.tabX?.(m.index) ?? 8, this.size.width / z - 236));
    const row = (it, i) => h_flex().id(`editor-tab-menu-${it.act}`).relative().h(22).px(10).gap(10).items_center()
      .text_color(i === m.at ? t.foreground : t.muted)
      .when(i === m.at, (el) => el.child(div().absolute().inset_0().opacity(0.6).child(dither(t.ansi0, 1))).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
      .hover((s) => s.text_color(t.foreground))
      .on_mouse_move(() => { if (m.at !== i) { m.at = i; } })
      .on_click((_e, cx) => { this.tabMenuAct(it.act, cx); cx.notify(); })
      .child(div().relative().w(14).flex_none().text_color(t.accent).child(it.key))
      .child(div().relative().flex_1().child(it.label));
    return div().id("editor-tab-menu").absolute().top(this.stripH()).left(x).w(228).py(4).bg(t.background).border(1).border_color(t.accent)
      .track_focus(this.menuHandle)
      .on_key_down((e, cx) => this.tabMenuKeyDown(e, cx))
      .on_mouse_down("left", stop)
      .child(div().absolute().left(4).right(-4).top(4).bottom(-4).child(dither(t.ansi0, 1)))
      .child(div().absolute().inset_0().bg(t.background))
      .children(m.items.map(row));
  }

  // ---- drawn tabs (the preview's viewer)

  /** The viewer, made once, when a drawn tab first shows: a nested view, so
   *  its reading and drawing redraw only it. */
  mountViewer(cx) {
    if (!this.viewer && cx?.new) this.viewer = cx.new(Viewer, this.viewerProps);
  }

  /** The viewer's props for the shown tab: its file when drawn, none
   *  otherwise (a native view, a PDF's or a clip's, goes with it). */
  syncViewer(change = {}) {
    const d = this.cur;
    const path = d?.look ? d.path : null;
    if (path === this.viewerProps.path && !Object.keys(change).length) return;
    this.viewerProps = { ...this.viewerProps, path, on: this.on, ...change };
    this.viewer?.set_props?.(this.viewerProps);
  }

  /** Tab `d` drawn (true) or as text (false); a "look" file (a picture)
   *  stays drawn. `focus`: the shown tab takes the keyboard after. */
  setDrawn(d, on, cx, focus = true) {
    if (d.kind === "look") on = true;
    if (d.kind === "text") on = false;
    if (on === d.look) return;
    d.look = on;
    if (d !== this.cur) return;
    if (on) this.mountViewer(cx);
    this.syncViewer();
    if (!on && d.state === "unloaded") {
      d.state = "loading";
      this.load(cx, null, false, d);
      if (!this.on && d.path) this.watch(cx, d);
    }
    if (focus) { if (on) this.lookHandle.focus(); else this.focusText(); }
    cx?.notify?.();
  }

  /** e, the bar's chip, cmd-shift-v on a table, patch or SVG: drawn <-> text. */
  toggleDrawn(cx) {
    const d = this.cur;
    if (d.kind === "look") return this.say(`This ${d.path.split(".").pop()} is drawn only: o opens the system's app`);
    if (d.kind === "text") return this.say("Not a kind the preview draws");
    this.setDrawn(d, !d.look, cx);
  }

  /** A key on a drawn tab (tabs.js lookAction): tabs, scrolling, as text,
   *  the preview pane, the system's app, the path, close, the keys. */
  lookKey(e, cx) {
    if (this.keysShown) return;
    const r = lookAction(this.lookPending, e);
    this.lookPending = r.pending;
    if (!r.taken) return;
    cx?.stop_propagation?.();
    if (r.act) this.lookAct(r.act, cx);
    cx?.notify?.();
  }

  lookAct(act, cx) {
    const d = this.cur, me = this.me(), on = this.on ? { on: this.on } : {};
    switch (act) {
      case "next-tab": return this.stepTab(1, cx);
      case "prev-tab": return this.stepTab(-1, cx);
      case "move-tab-right": return this.stepMove(1, cx);
      case "move-tab-left": return this.stepMove(-1, cx);
      case "down": case "up": this.scrollN = (this.scrollN ?? 0) + 1; return this.syncViewer({ scroll: { n: this.scrollN, dir: act === "down" ? 1 : -1 } });
      case "text": return this.toggleDrawn(cx);
      case "pane": return run("preview.open", { path: d.path, ...(me ? { pane: me.pane } : {}), ...on });
      case "system": return run("preview.open", { path: d.path, in: "system", ...on });
      case "copy": try { cx?.write_to_clipboard?.(this.on ? `${this.on}:${d.path}` : d.path); } catch { /* no clipboard */ } return this.say("path copied");
      case "close": return this.closeTab(cx);
      case "keys": return this.toggleKeys(!this.keysShown);
    }
  }

  /** A file a link points at (a card's, the Markdown preview's, a drawn
   *  picture's): drawn kinds as a drawn tab here, another machine's in the
   *  preview beside (the viewer reads only this computer's pictures). */
  openLooked(path, cx) {
    if (this.on) { const me = this.me(); return run("preview.open", { path, ...(me ? { pane: me.pane } : {}), on: this.on }); }
    this.openFile(path, cx, { look: true });
  }

  /** The next (1) or previous (-1) tab. */
  stepTab(dir, cx) {
    if (this.docs.length < 2) return this.say("one tab");
    this.select(this.docs[stepTab(this.docs.length, this.docs.indexOf(this.cur), dir)], cx);
  }

  /** Moves tab `from` to index `to` (a drag's drop, ]B / [B, :tabm): the
   *  order is kept for a restart and told to the routing (shared PATHS). */
  moveTab(from, to, cx) {
    const n = this.docs.length;
    if (from < 0 || from >= n || to == null) return;
    to = Math.max(0, Math.min(n - 1, to));
    if (to === from) return;
    this.docs = moved(this.docs, from, to);
    this.keepTabs();
    this.publish();
    cx?.notify?.();
  }

  /** The shown tab one place right (1) or left (-1); `:tabm`'s "N", "+N",
   *  "-N" or "$" (the end) as `spec`. */
  stepMove(dir, cx, spec = null) {
    const n = this.docs.length, i = this.docs.indexOf(this.cur);
    if (n < 2) return this.say("one tab");
    let to;
    if (spec == null) to = i + dir;
    else if (spec === "$") to = n - 1;
    else if (/^[+-]/.test(spec)) to = i + Number(spec);
    else to = Number(spec);
    if (!(to >= 0 && to < n)) return this.say(dir < 0 || /^-/.test(spec ?? "") ? "the first tab" : "the last tab");
    this.moveTab(i, to, cx);
  }

  // ---- dragging a tab along the strip (tabs.js)

  /** The pointer moved over a gap with a press down: past DRAG_START it's a
   *  drag, and the gap it's over is where the stake stands. */
  dragOver(gap, e, cx) {
    const p = this.tabPress;
    if (!p) return;
    if (!this.tabDrag) {
      if (Math.abs((e?.position?.x ?? p.x) - p.x) < DRAG_START) return;
      this.tabDrag = { from: p.index, gap: null };
    }
    const g = this.tabDrag.gap;
    if (g && g.index === gap.index && g.after === gap.after && !this.tabDrag.out) return;
    this.tabDrag.gap = gap;
    this.tabDrag.out = false;
    cx?.notify?.();
  }

  /** The press let go on the strip: a drag drops where its stake stands. */
  dropTab(cx) {
    const d = this.tabDrag;
    this.tabDrag = null;
    this.tabPress = null;
    if (!d) return;
    this.moveTab(d.from, dropIndex(this.docs.length, d.from, d.gap), cx);
    cx?.notify?.();
  }

  /** The pointer left the strip with a tab dragged: over the pane it's
   *  dropped out (popped into a pane of its own); off the pane it ends. */
  leaveStrip(cx) {
    if (!this.tabDrag) { this.tabPress = null; return; }
    this.tabDrag.out = true;
    this.tabDrag.gap = null;
    cx?.notify?.();
  }

  /** A tab dragged off the strip, let go over the pane: popped out beside. */
  dropOut(cx) {
    const d = this.docs[this.tabDrag?.from];
    this.tabDrag = null;
    this.tabPress = null;
    if (d) this.popOut(cx, d, "beside");
    cx?.notify?.();
  }

  /** Over the pane while a tab is dragged off the strip: where it goes. */
  dropZone(t) {
    const d = this.docs[this.tabDrag.from];
    return div().id("editor-drop-out").absolute().left(8).right(8).top(this.stripH() + 6).bottom(8).border(1).border_color(t.accent)
      .child(div().absolute().inset_0().opacity(0.18).child(dither(t.accent, 1)))
      .child(v_flex().absolute().inset_0().items_center().justify_center().gap(4)
        .child(div().text_color(t.foreground).child(`let go: ${basename(d?.path ?? "")} into its own pane`))
        .child(div().text_color(t.dim).child("back on the strip: moves it there · off the pane: nothing")));
  }

  /** The pointer left the pane: the drag ends where it started. */
  cancelDrag(cx) {
    const dragging = Boolean(this.tabDrag);
    this.tabDrag = null;
    this.tabPress = null;
    if (dragging) cx?.notify?.();
  }

  /** Closes tab `d` (the shown one by default): with unsaved changes it
   *  asks first (the question's line: save, discard, keep), unless
   *  `confirmed`. The last tab closes the pane. */
  closeTab(cx, d = this.cur, confirmed = false) {
    if (!d) return;
    if (d.dirty && !confirmed) {
      if (d !== this.cur) this.select(d, cx);
      this.asking = { doc: d, at: "save" };
      cx?.notify?.();
      return;
    }
    this.asking = null;
    d.autosave?.flush();
    if (this.docs.length <= 1) {
      d.dirty = false;
      this.noteUnsaved();
      const me = this.me();
      return run("pane.close", { ...(me ? { pane: me.pane } : {}), confirmed: true });
    }
    const i = this.docs.indexOf(d), next = afterClose(this.docs.length, this.docs.indexOf(this.cur), i);
    this.releaseDoc(d);
    this.docs.splice(i, 1);
    const show = this.docs[next] ?? this.docs[0];
    if (show !== this.cur || d === this.cur) this.select(show, cx);
    this.noteUnsaved();
    this.title();
    this.keepTabs();
    this.publish();
    cx?.notify?.();
  }

  /** The question on closing an edited tab: save and close, discard, or keep it open. */
  answerClose(choice, cx) {
    const a = this.asking;
    if (!a) return;
    this.asking = null;
    if (choice === "keep") { this.editor.focus(); cx?.notify?.(); return; }
    if (choice === "discard") return this.closeTab(cx, a.doc, true);
    // Save, then close if it was written.
    this.later(cx, async (cx) => {
      await this.saveNow(cx, a.doc);
      if (!a.doc.dirty) this.closeTab(cx, a.doc, true);
      cx.notify();
    });
  }

  /** A tab going: its server document closes, the server is let go when no
   *  other tab uses it, its folder watch ends. */
  releaseDoc(d) {
    d.watchGen = (d.watchGen ?? 0) + 1;
    d.gone = true;
    const id = d.server?.id;
    if (id == null) return;
    lspNotify(id, "textDocument/didClose", { textDocument: { uri: uri(d.path) } });
    if (!this.allDocs().some((x) => x !== d && x.server?.id === id)) { lspRelease(id); this.listening?.delete(id); }
  }

  /** This copy's own pane (found by its slot). */
  me() {
    return panes().find((p) => p.mod === MOD && p.props?.slot === this.slot) ?? null;
  }

  /** The tabs as kept for a restart (localStorage). */
  keepTabs() {
    if (!this.docs) return;
    try { localStorage.setItem("tabs", JSON.stringify(keptTabs(this.docs.map((d) => d.path), this.docs.indexOf(this.cur)))); } catch { /* a nicety */ }
  }

  /** Every file here, for the files pane, the picker and the app's
   *  editor.open to find the editor holding one (shared PATHS by slot). */
  publish() {
    if (!this.slot) return;
    const live = new Set(panes().filter((p) => p.mod === MOD).map((p) => p.props?.slot).filter(Boolean));
    const was = shared(PATHS) ?? {};
    const mine = this.allDocs().map((d) => d.path);
    if (JSON.stringify(was[this.slot]) === JSON.stringify(mine) && Object.keys(was).every((k) => live.has(k) || k === this.slot)) return;
    setShared(PATHS, { ...Object.fromEntries(Object.entries(was).filter(([k]) => live.has(k))), [this.slot]: mine });
  }

  /** What closing the pane asks: every tab with unsaved changes, once. */
  noteUnsaved() {
    setUnsaved(unsavedNote(this.allDocs()));
  }

  // ---- the file

  /** The pane header's name (nocturne/header.js): the shown tab's. */
  title() {
    if (!this.slot) return;
    const name = this.scratch ? `Scratchpad · ${noteName(this.path)}` : basename(this.path) + (this.dirty ? " ●" : "");
    const all = shared(TITLES) ?? {};
    if (all[this.slot] !== name) setShared(TITLES, { ...all, [this.slot]: name });
  }

  // ---- the files pane's renames, moves and deletes (follow.ts)

  /** Acts on the change record's entries newer than the last seen, for every
   *  tab (from a task, never a render). */
  followChanges(cx) {
    const list = fileChanges(shared), from = this.seenChange;
    let seen = from;
    for (const d of this.allDocs()) {
      const r = followFiles(list, from, d.path, this.on);
      seen = Math.max(seen, r.seen);
      if (r.path !== d.path) this.moveTo(r.path, cx, d);
      if (r.deleted && !d.deleted) this.markDeleted(cx, d);
    }
    this.seenChange = seen;
    cx.notify();
  }

  /** The file is at `to` now: the buffer, its edits, caret, scroll and undo
   *  stay; the name, the folder, the language and the server's document follow. */
  moveTo(to, cx, d = this.cur) {
    const from = d.path, s = d.server;
    if (d.look) {
      d.path = to; d.deleted = false; d.kind = tabKind(to);
      if (d.kind === "text") { d.look = false; d.state = "unloaded"; }
      if (d === this.cur) { this.syncViewer(); if (!d.look) this.select(d, cx, null, true); }
      this.title(); this.keepTabs(); this.publish();
      return;
    }
    if (s?.id != null) lspNotify(s.id, "textDocument/didClose", { textDocument: { uri: uri(from) } });
    d.path = to;
    d.deleted = false;
    if (d.firstPath === (props()?.path ?? d.firstPath)) try { localStorage.setItem("moved", JSON.stringify({ from: d.firstPath, to })); } catch { /* a nicety */ }
    const lang = languageOf(to) ?? "text";
    if (lang !== d.lang) {
      // Another language: its grammar, settings and server.
      d.lang = lang;
      d.opts = languageSettings(settings()?.editor, lang);
      d.editor.set_language(lang);
      d.markdown = lang === "markdown";
      if (s?.id != null && !this.allDocs().some((x) => x !== d && x.server?.id === s.id)) { lspRelease(s.id); this.listening?.delete(s.id); }
      d.server = null;
      this.setProblems([], d);
      if (d.state === "ready") this.startServer(cx, false, d);
    } else if (s?.id != null) {
      d.version += 1;
      d.sent = d.editor.value();
      lspNotify(s.id, "textDocument/didOpen", { textDocument: { uri: uri(to), languageId: languageId(lang, to), version: d.version, text: d.sent } });
    }
    if (!this.on && d.state !== "unloaded") this.watch(cx, d);
    this.noteUnsaved();
    this.title();
    this.keepTabs();
    this.publish();
    if (d === this.cur) this.say(`moved to ${tilde(dirname(to), home())}`);
  }

  /** The file was deleted: the editor keeps its text and says so; a save writes it again. */
  markDeleted(cx, d = this.cur) {
    d.deleted = true;
    d.saved = null; // a save creates it (writeTextFile's "new file")
    d.conflict = false;
    d.dirty = d.editor.value() !== "";
    this.noteUnsaved();
    this.title();
    cx?.notify?.();
  }

  /** Reads tab `d`'s file; `go`: the place to put the caret after. `quiet`: a
   *  poll or a change on disk, which leaves an edited buffer alone. */
  load(cx, go, quiet, d = this.cur) {
    // Drawn: the viewer reads it; a change on disk draws it again.
    if (d.look) { if (d === this.cur && quiet) this.syncViewer({ reload: (this.viewerProps.reload ?? 0) + 1 }); return; }
    if (!d.path) { d.state = "error"; d.error = "No file given: editor.open {path}."; return; }
    cx.spawn(async (cx) => {
      let text = null, error = null;
      try {
        text = await readTextFile(d.path, { on: this.on });
        if (text != null && text.includes("\0")) { text = null; error = "Not a text file: it holds binary data."; }
      } catch (e) { error = String(e?.message ?? e); }
      if (d.gone) return;
      if (quiet) {
        // Our own write (the autosave's, maybe read while it was under way) isn't news.
        if (text == null || text === d.saved || text === d.writing) return;
        // Edited (a scratchpad: typed but not written yet): it asks, never drops what's typed.
        if (d.dirty || (d.scratch && d.saveState !== "saved")) { if (text !== d.editor.value()) d.conflict = true; cx.notify(); return; }
        const at = d.editor.cursor();
        d.saved = text;
        d.editor.set_value(text);
        d.text = text;
        if (d.markdown) this.refreshPreview(cx, true, d);
        d.editor.set_cursor(at.line, at.col);
        if (d.view === "rendered") d.rendered?.open(cx);
        if (d === this.cur && !d.scratch) this.say("reloaded: it changed on disk");
        this.didChange(cx, true, d);
        // What's in the editor is what's on disk now: saved, as far as the
        // server goes (rust-analyzer runs cargo check on a save, so an agent's
        // edit shows its errors as one of Developer's would).
        if (d.server?.id != null) lspNotify(d.server.id, "textDocument/didSave", { textDocument: { uri: uri(d.path) }, text });
        cx.notify();
        return;
      }
      if (error) { d.state = "error"; d.error = error; cx.notify(); return; }
      if (text == null) { d.state = "missing"; d.saved = null; d.editor.set_value(""); }
      else { d.state = "ready"; d.saved = text; d.editor.set_value(text); }
      // Handed over with unsaved changes: that text, unsaved here too.
      const hand = d.hand;
      d.hand = null;
      if (hand?.text != null && d.state !== "error") d.editor.set_value(hand.text);
      d.text = hand?.text ?? text ?? "";
      if (d.markdown) this.refreshPreview(cx, true, d);
      d.dirty = hand?.text != null && hand.text !== (d.saved ?? ""); d.conflict = false;
      if (hand) { const c = hand.caret ?? { line: 0, col: 0 }; d.editor.set_cursor(c.line, c.col); if (hand.top) d.editor.scroll_to_line?.(hand.top); }
      this.noteUnsaved();
      this.title();
      go ??= d.go;
      d.go = null;
      if (go && d === this.cur) this.goto(go.line - 1, (go.col ?? 1) - 1, cx);
      if (d.markdown && d.view === "rendered") { d.rendered.open(cx); if (d === this.cur) this.focusText(); }
      cx.notify();
      if (d.state === "ready" && !d.server) this.startServer(cx, false, d);
    });
  }

  /** Waits for tab `d`'s folder to change, and reads its file again. */
  watch(cx, d = this.cur) {
    const dir = dirname(d.path);
    // A moved file's tab watches its new folder; the old loop ends (and a closed tab's).
    const gen = d.watchGen = (d.watchGen ?? 0) + 1;
    cx.spawn(async (cx) => {
      for (;;) {
        let changed;
        try { changed = await watchFolder(dir); } catch { return; }
        if (gen !== d.watchGen || d.gone) return;
        if (!changed.some((p) => basename(p) === basename(d.path) || p === dir)) continue;
        this.load(cx, null, true, d);
      }
    });
  }

  changed(cx, d = this.cur) {
    d.text = d.editor.value();
    d.hovers.clear();
    // Typing closes the card.
    if (this.card && d === this.cur) this.closeCard(cx);
    // The preview's blocks are cut again only where they're shown (rendered draws its own):
    // a keystroke in the rendered view doesn't re-split the whole document.
    if (d.markdown && d.view !== "rendered") this.refreshPreview(cx, false, d);
    else if (d.markdown) d.previewStale = true;
    if (d.markdown && d.view === "rendered") d.rendered.pull(cx);
    if (d.scratch) {
      // A scratchpad saves itself: never unsaved, written a moment after the typing.
      if (d.text !== (d.saved ?? "")) { this.timerCx = cx; d.autosave.touch(); }
      this.didChange(cx, false, d);
      cx.notify();
      return;
    }
    const dirty = d.text !== (d.saved ?? "");
    if (dirty !== d.dirty) {
      d.dirty = dirty;
      this.noteUnsaved();
      this.title();
    }
    this.didChange(cx, false, d);
    cx.notify();
  }

  save(cx) {
    const d = this.cur;
    return this.later(cx, (cx) => this.saveNow(cx, d));
  }

  async saveNow(cx, d = this.cur) {
    if (d.state === "error" || d.state === "unloaded" || d.state === "loading") return;
    let text = d.editor.value();
    if (d.opts.format_on_save && d.opts.format) text = await this.format(text, cx, d) ?? text;
    try {
      // Only over what was read: a file someone else changed isn't overwritten.
      await writeTextFile(d.path, text, d.saved);
      d.saved = text;
      d.state = "ready";
      d.deleted = false;
      d.dirty = d.editor.value() !== text;
      d.conflict = false;
      this.noteUnsaved();
      this.title();
      this.say(d === this.cur ? "saved" : `saved ${basename(d.path)}`);
      if (d.server?.id != null) lspNotify(d.server.id, "textDocument/didSave", { textDocument: { uri: uri(d.path) }, text });
      else if (!d.server) this.startServer(cx, false, d);
    } catch (e) {
      this.say(String(e?.message ?? e), true);
      if (/changed outside/.test(String(e?.message ?? e))) d.conflict = true;
    }
    cx.notify();
  }

  /** Runs settings.json's `format` on the text (it reads stdin, prints the
   *  result); puts the result in as one undoable edit. Null when it fails. */
  async format(text, cx, d = this.cur) {
    const tmp = `${appHome()}/cache/editor/format-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await writeTextFile(tmp, text, null);
      const r = await exec("sh", ["-c", 'f="$1"; shift; "$@" < "$f"', "format", tmp, ...d.opts.format], { cwd: dirname(d.path) });
      exec("rm", ["-f", tmp]).catch(() => {});
      if (r.code !== 0 || !r.stdout) { this.say(`formatter failed: ${(r.stderr || "").split("\n")[0]}`, true); return null; }
      if (r.stdout !== text) {
        const lines = text.split("\n");
        d.editor.edit([{ start: { line: 0, col: 0 }, end: { line: lines.length - 1, col: lines[lines.length - 1].length }, text: r.stdout }]);
      }
      return r.stdout;
    } catch (e) {
      this.say(`formatter: ${e?.message ?? e}`, true);
      return null;
    }
  }

  say(text, bad) {
    this.message = { text, bad: !!bad, at: Date.now() };
  }

  // ---- language server

  /** A step of the way to the server's answers, for a look at where the time
   *  goes: `HERDR_APP_LOG=info,gpui_shell::script=debug` prints them. */
  mark(what, d = this.cur) {
    console.debug(`lsp ${basename(d?.path ?? "")} +${Date.now() - (d?.openedAt ?? Date.now())}ms ${what}`);
  }

  /** Starts (or joins) tab `d`'s language server as it opens, so it is warm
   *  by the time anything is asked: the project's environment from disk when
   *  nothing it depends on changed (envrc.js), the lookups side by side, then
   *  herdr's session for this server and workspace (one per project: every
   *  tab and editor of it shares it). `fresh`: the kept environment's server
   *  is gone (garbage-collected): load it anew. */
  async startServer(cx, fresh = false, d = this.cur) {
    const redraw = () => { if (d === this.cur) this.cardState(cx); cx.notify(); };
    if (this.on) { d.server = { status: "none", why: "remote" }; return; }
    const candidates = serverCandidates(d.lang, d.opts);
    if (!candidates.length) { d.server = { status: "none", why: d.opts.server === false ? "off" : "unknown" }; cx.notify(); return; }
    const names = candidates.map((c) => basename(c.argv[0]));
    const dir = dirname(d.path);
    // The workspace's own environment first (envrc.js): its .envrc, through direnv.
    this.mark("start", d);
    const env = await projectEnv(exec, dir, {
      cache: envCache, fresh,
      loading: (at) => { d.server = { status: "env", envrc: at, names }; this.mark("environment: loading with direnv", d); cx.notify(); },
    });
    if (d.gone) return;
    this.mark(`environment: ${env.kind}${env.cached ? " (kept on disk; refreshing behind)" : ""}`, d);
    const inEnv = env.kind === "ready" ? env.env : null;
    // Every candidate's path and the workspace root at once: each is a process.
    const markers = ROOTS[d.lang]?.markers ?? [];
    const [paths, r] = await Promise.all([
      Promise.all(candidates.map((c) => (c.argv[0].startsWith("/") ? c.argv[0] : lookup(exec, c.argv[0], inEnv)))),
      exec("sh", ["-c", rootScript(markers), "root", dir]).catch(() => null),
    ]);
    if (d.gone) return;
    const at = paths.findIndex(Boolean);
    const pick = at >= 0 ? candidates[at] : null, path = paths[at] ?? null;
    if (!pick && env.cached && !fresh) return this.startServer(cx, true, d);
    // Not there: why, for the bar and the hover card (logic.js serverNote).
    const envNote = env.kind === "none" ? {} : { envrc: env.dir, envKind: env.kind, envNote: env.note ?? null, denied: env.denied ?? false };
    if (!pick) { d.server = { status: "none", why: "missing", names, ...envNote }; redraw(); return; }
    this.mark(`lookup: ${path ?? "none"}`, d);
    const root = pickRoot(d.lang, r?.stdout, dir);
    const argv = wrap(pick.argv, path, inEnv);
    d.server = { status: "starting", argv, root, name: basename(pick.argv[0]), ...envNote };
    cx.notify();
    let started;
    this.mark("lspStart", d);
    try { started = await lspStart({ argv, root, settings: pick.settings, idle: SERVER_IDLE }); }
    catch (e) { d.server = { ...d.server, status: "exited", note: String(e?.message ?? e) }; redraw(); return; }
    if (d.gone) {
      // Closed while it started: let go unless another tab holds it.
      if (!this.allDocs().some((x) => x.server?.id === started.id)) lspRelease(started.id);
      return;
    }
    d.server = { ...d.server, id: started.id, caps: started.capabilities ?? {}, status: "ready" };
    this.mark("initialized", d);
    // The server's work is the server's: tabs sharing it share what's under way.
    const sibling = this.allDocs().find((x) => x !== d && x.server?.id === started.id);
    if (sibling) { d.progress = sibling.progress; d.lastWork = sibling.lastWork; }
    else { d.progress.clear(); d.lastWork = Date.now(); }
    d.version = 1;
    d.sent = d.editor.value();
    lspNotify(started.id, "textDocument/didOpen", { textDocument: { uri: uri(d.path), languageId: languageId(d.lang, d.path), version: d.version, text: d.sent } });
    this.listen(started.id, cx);
    redraw();
  }

  /** The server's messages, once per server however many tabs use it
   *  (herdr keeps one queue per copy): diagnostics go to the tab of their
   *  file, work and an exit to every tab on it. */
  listen(id, cx) {
    this.listening ??= new Set();
    if (this.listening.has(id)) return;
    this.listening.add(id);
    const on = () => this.allDocs().filter((d) => d.server?.id === id);
    cx.spawn(async (cx) => {
      for (;;) {
        let m;
        try { m = await lspNextMessage(id); } catch { this.listening.delete(id); return; }
        if (!this.listening.has(id) || !on().length) { this.listening.delete(id); return; }
        if (m.method === "textDocument/publishDiagnostics") {
          const d = on().find((x) => uri(x.path) === m.params?.uri);
          if (d) { this.setProblems(diagnostics(m.params.diagnostics), d); cx.notify(); }
        } else if (m.method === "$/progress") {
          this.progressed(m.params, cx, id);
        } else if (m.method === "$/exit") {
          const note = (m.params?.stderr ?? []).slice(-1)[0] ?? "it stopped";
          for (const d of on()) { d.server = { ...d.server, status: "exited", id: null, note }; d.progress.clear(); }
          this.listening.delete(id);
          this.cardState(cx);
          cx.notify();
          return;
        }
      }
    });
  }

  /** The server's work under way, for the bar ("indexing 120/340") and a
   *  waiting card, which asks again once the work answers wait on is done.
   *  `id`: the server (default: the shown tab's). */
  progressed(params, cx, id = this.server?.id) {
    const docs = this.allDocs().filter((d) => d.server?.id === id);
    const d0 = docs.find((d) => d === this.cur) ?? docs[0] ?? this.cur;
    const progress = d0.progress;
    const token = String(params?.token), v = params?.value ?? {};
    const wasBusy = busy(progress);
    if (!/\b(cargo check|check|clippy|flycheck)\b/i.test(v.title ?? progress.get(token)?.title ?? "")) { const now = Date.now(); for (const d of docs.length ? docs : [d0]) d.lastWork = now; }
    if (v.kind === "begin") { progress.set(token, { title: v.title ?? "", message: v.message ?? "", percentage: v.percentage }); this.mark(`begin ${v.title}`, d0); }
    else if (v.kind === "report" && progress.has(token)) Object.assign(progress.get(token), v.message != null ? { message: v.message } : {}, v.percentage != null ? { percentage: v.percentage } : {});
    else if (v.kind === "end") { this.mark(`end ${progress.get(token)?.title ?? token}`, d0); progress.delete(token); }
    else return;
    if (v.kind === "end" && !busy(progress)) { for (const d of docs.length ? docs : [d0]) d.hovers.clear(); if (wasBusy && d0 === this.cur) this.cardState(cx); }
    // Reports come by the hundred while it indexes: one redraw per frame or so.
    if (this.redrawSoon) return;
    this.redrawSoon = true;
    cx.timer.after(50, (cx) => { this.redrawSoon = false; cx.notify(); });
  }

  setProblems(list, d = this.cur) {
    d.problems = list;
    const t = theme();
    const colors = { error: t.ansi1, warning: t.ansi3, info: t.ansi4, hint: t.dim };
    d.editor.set_diagnostics(list);
    d.editor.set_line_notes(lineNotes(list, colors).map((n) => ({ ...n, color: n.color + "bb" })));
  }

  /** Tells the server about an edit: what changed since it last heard, as one
   *  ranged change (the whole text for servers that want it, or when another
   *  editor has the file open too: their buffers differ), a moment after the
   *  typing, or at once (`now`; before every question). */
  didChange(cx, now, d = this.cur) {
    if (d.server?.id == null) return;
    if (now) return this.flush(d);
    if (d.flushDue) return;
    d.flushDue = true;
    cx.timer.after(CHANGE_DELAY, () => this.flush(d));
  }

  flush(d = this.cur) {
    d.flushDue = false;
    const s = d.server;
    if (s?.id == null) return;
    const text = d.editor.value();
    if (text === d.sent) return;
    // Another editor pane holding the file (any of its tabs): their buffers differ.
    const paths = editorPaths(shared);
    const alone = !panes().some((p) => p.mod === MOD && p.props?.slot !== this.slot && filesOf(p, paths).includes(d.path));
    const change = d.sent != null && alone && incremental(s.caps) ? changeBetween(d.sent, text) : { text };
    d.sent = text;
    lspNotify(s.id, "textDocument/didChange", { textDocument: { uri: uri(d.path), version: ++d.version }, contentChanges: [change] });
  }

  /** A question about a place (the caret by default). `key`: a newer question
   *  with the same key cancels this one at the server (herdr's lspRequest). */
  async request(method, extra = {}, line, col, key) {
    if (this.server?.id == null) return null;
    this.flush();
    const at = line == null ? this.editor.cursor() : { line, col };
    return lspRequest(this.server.id, method, { textDocument: { uri: uri(this.path) }, position: { line: at.line, character: at.col }, ...extra }, key ? { key } : undefined);
  }

  definition(cx) {
    return this.later(cx, (cx) => this.definitionNow(cx));
  }

  async definitionNow(cx) {
    let loc = null;
    try { loc = firstLocation(await this.request("textDocument/definition", {}, undefined, undefined, "definition")); }
    catch (e) { if (!/cancelled/.test(String(e?.message ?? e))) this.say(String(e?.message ?? e), true); }
    if (!loc) {
      // Still loading the workspace: say so, rather than "not found".
      const work = busy(this.progress) ? progressWord(this.progress) : null;
      if (work) this.say(`${this.server?.name ?? "the server"} is busy: ${work}`);
      else if (this.server?.id != null) this.say("no definition found");
      else this.say(this.serverNote()?.short || "no language server");
      cx.notify();
      return;
    }
    this.closeCard(cx);
    // Another file: a tab of this editor (the one showing it, if open).
    if (loc.path === this.path) this.goto(loc.line, loc.col, cx);
    else this.openFile(loc.path, cx, { line: loc.line + 1, col: loc.col + 1 });
  }

  // ---- the hover card

  hovered(e, cx) {
    if (!e.hovering) {
      // Leaving the word: the card goes unless the pointer went onto it.
      cx.timer.after(250, (cx) => { if (!this.overCard && this.card && !this.card.keyboard) { this.card = null; cx.notify(); } });
      return;
    }
    // A card asked for with the keyboard stays until it's closed.
    if (this.card?.keyboard) return;
    this.showCard(e.line, e.col, false, cx);
  }

  /** The card for a place: its problems at once, the server's hover when it
   *  answers. `keyboard`: asked for (cmd-i, K, a problem gone to); the
   *  pointer's card says nothing when there's nothing to say. */
  showCard(line, col, keyboard, cx, level = 0) {
    const here = diagnosticsAt(this.problems, line, col);
    const card = { line, col, keyboard: !!keyboard, problems: here, parts: [], level, more: false, pending: true, note: null, scroll: 0, opened: Date.now() };
    this.card = card;
    this.watchFocus(card, cx);
    this.cardState(cx);
    cx.notify();
  }

  /** The card's question, as the server stands: answered from what's known,
   *  asked, or waiting (with what it waits for) until the server can answer;
   *  called again when it can (started, done indexing, stopped). */
  cardState(cx) {
    const card = this.card;
    if (!card?.pending) return;
    const s = this.server;
    const key = `${card.line}:${card.col}:${card.level}`;
    if (this.hovers.has(key)) return this.answered(card, this.hovers.get(key), cx);
    if (s?.id == null) {
      // No server to ask yet: starting, loading the environment (the card
      // waits, saying so), or none (the note says why and what to do).
      const coming = !s || s.status === "starting" || s.status === "env";
      card.note = card.keyboard && !coming ? this.serverNote() : null;
      if (!coming) card.pending = false;
      if (!coming && !card.keyboard && !card.problems.length) this.card = null;
      return;
    }
    card.note = null;
    card.asked ??= Date.now();
    this.ask(card, cx);
  }

  /** Asks the server about a card's place. The answer comes in a task of its
   *  own: an editor event's cx (vim's K, the pointer's hover, a click) is
   *  bound to that call and refuses notify and timers once it has returned,
   *  which left cards at "Asking…" with their answer already in hand. Any
   *  answer for the place fills the card open there, whichever ask brought
   *  it; when the last ask ends without one, the card asks again (the
   *  workspace still loading; a cancel, once) or says why: it never sits
   *  asking with nothing out. */
  ask(card, cx) {
    const key = `${card.line}:${card.col}:${card.level}`;
    const verbosity = this.lang === "typescript" || this.lang === "tsx" || this.lang === "javascript" ? { verbosityLevel: card.level } : {};
    card.inflight = (card.inflight ?? 0) + 1;
    cx.spawn(async (cx) => {
      let h = null, error = null;
      try { h = await this.request("textDocument/hover", verbosity, card.line, card.col, "hover"); } catch (e) { error = e; }
      card.inflight -= 1;
      const answer = error ? null : { parts: hoverParts(h?.contents), more: !!h?.canIncreaseVerbosityLevel };
      // Something to say: kept for the place, and into the card open there.
      if (answer?.parts.length) {
        this.hovers.set(key, answer);
        const open = this.card;
        if (open?.pending && `${open.line}:${open.col}:${open.level}` === key) this.answered(open, answer, cx);
        return;
      }
      if (this.card !== card || !card.pending || card.inflight > 0) return; // gone, filled, or a newer ask decides
      const why = String(error?.message ?? error ?? "");
      // Nothing yet while the workspace loads ("content modified", or null): ask again.
      if (this.settling()) return this.askAgain(card, cx);
      if (/cancelled/.test(why)) {
        if (!card.reasked) { card.reasked = true; return this.ask(card, cx); }
        error = new Error("the question was cancelled twice");
      }
      if (!error) {
        this.hovers.set(key, answer);
        return this.answered(card, answer, cx);
      }
      card.pending = false;
      if (card.keyboard && !card.problems.length) card.note = { text: `${this.server?.name ?? "The language server"} didn't answer${error?.message ? `: ${error.message}` : "."}`, fix: null };
      else if (!card.problems.length) this.card = null;
      cx.notify();
    });
  }

  /** The server is still loading the workspace: work under way, or some
   *  reported a moment ago (it pauses between phases). */
  settling() {
    return busy(this.progress) || Date.now() - (this.lastWork ?? 0) < SETTLE;
  }

  /** A waiting card asks again: when the work ends (progressed), and once a
   *  second meanwhile, since a server can answer before it's all done. */
  askAgain(card, cx) {
    card.waitingOn = true;
    cx.notify();
    cx.timer.after(1000, (cx) => { if (this.card === card && card.pending) this.cardState(cx); });
  }

  answered(card, answer, cx) {
    if (card.keyboard && card.pending) this.mark(`hover answered ${Date.now() - card.opened}ms after it was asked`);
    card.pending = false;
    card.waitingOn = false;
    card.parts = answer.parts.map((p) => ({ ...p }));
    card.more = answer.more;
    // Its links (the docs' web pages, files): tab walks them, enter follows (cardKey).
    card.links = cardLinks(card.parts);
    card.link = null;
    // Nothing here: asked for, the card says so; passing over, it goes.
    if (!card.parts.length && !card.problems.length) {
      if (card.keyboard) card.note = this.serverNote(true); else if (this.card === card) this.card = null;
    }
    cx.notify();
  }

  /** What a waiting card says: what the answer waits for. */
  waitWords() {
    const s = this.server, name = s?.name ?? "the language server";
    if (!s || s.status === "env") return s?.envrc ? `Loading this project's environment (${tilde(s.envrc, home())}/.envrc)…` : "Finding the language server…";
    if (s.status === "starting") return `Starting ${name}…`;
    const work = busy(this.progress) ? progressWord(this.progress) : null;
    if (work) return `${name}: ${work}${work.endsWith("…") ? "" : "."} The answer comes when it's done.`;
    if (this.settling()) return `${name} is loading the workspace. The answer comes when it's done.`;
    return `Asking ${name}…`;
  }

  /** While the card is open: the editor going from having the keyboard to
   *  not having it (the find line, another pane) closes it. A pointer's card
   *  over an editor that never had the keyboard stays. */
  watchFocus(card, cx) {
    const had = this.editor.focused?.() ?? false;
    const check = (cx) => {
      if (this.card !== card) return;
      const has = this.editor.focused?.() ?? false;
      if (had && !has) return this.closeCard(cx);
      cx.timer.after(200, check);
    };
    cx.timer.after(200, check);
  }

  closeCard(cx) {
    if (!this.card) return;
    this.card = null;
    this.overCard = false;
    cx?.notify?.();
  }

  /** Why the hover has nothing (logic.js serverNote), the paths as ~. */
  serverNote(empty = false) {
    return serverNote(this.server, this.lang, { empty, tilde: (p) => tilde(p, home()) });
  }

  /** TypeScript's expandable hover: one level more (1) or less (-1). */
  hoverLevel(d, cx) {
    const c = this.card;
    if (!c) return;
    const level = Math.max(0, c.level + d);
    if (level === c.level || (d > 0 && !c.more)) return;
    this.showCard(c.line, c.col, c.keyboard, cx, level);
  }

  /** A key while the card is open, before vim and the editor: esc closes it
   *  (and does nothing else), ctrl-d / ctrl-u and page down / up scroll a long
   *  one. True when taken. Other keys go on; when one moves the caret or the
   *  text, the card goes (checked once the editor has had the key). */
  cardKey(e, cx) {
    const c = this.card;
    if (!c) return false;
    const k = e.key, m = e.modifiers ?? {};
    if (["shift", "control", "alt", "platform", "function", "capslock"].includes(k)) return false;
    const plain = !m.platform && !m.control && !m.alt;
    if (k === "escape" && plain && !m.shift) { this.closeCard(cx); return true; }
    // A card asked for with the keyboard: tab / shift-tab ring its links, enter follows the ringed one.
    const links = c.links ?? [];
    if (c.keyboard && links.length && k === "tab" && !m.platform && !m.control && !m.alt) {
      const n = links.length;
      c.link = c.link == null ? (m.shift ? n - 1 : 0) : (c.link + (m.shift ? n - 1 : 1)) % n;
      cx.notify();
      return true;
    }
    if (c.link != null && links[c.link] && k === "enter" && plain && !m.shift) { this.followLink(links[c.link].url, cx); return true; }
    const page = Math.max(40, Math.round((c.viewH ?? 200) * 0.6));
    const scroll = m.control && !m.platform && !m.alt && (k === "d" || k === "u") ? (k === "d" ? page : -page)
      : plain && (k === "pagedown" || k === "pageup") ? (k === "pagedown" ? page : -page) : 0;
    if (scroll && this.cardOverflows()) {
      c.scroll = Math.max(0, Math.min((c.contentH ?? 0) - (c.viewH ?? 0), (c.scroll ?? 0) + scroll));
      cx.notify();
      return true;
    }
    // App keys (cmd-…) are commands: cmd-i closes it, gd / cmd-k d go.
    if (m.platform) return false;
    // (Typing closes it through the change it makes.)
    const was = this.editor.cursor();
    cx.timer.after(0, (cx) => {
      if (this.card !== c) return;
      const now = this.editor.cursor();
      if (now.line !== was.line || now.col !== was.col) this.closeCard(cx);
    });
    return false;
  }

  /** The app's keys win over the code editor's own keymap: a chord keys.json
   *  binds for the window (global, Nocturne's) and this editor's section
   *  doesn't is run as the app's command here and taken, so the editor does
   *  nothing with it. The editor's keymap binds cmd-alt-up / down (a caret
   *  above / below), cmd-] / cmd-[ (indent) and cmd-shift-f (replace), which
   *  ate pane.go, agent.next / prev and grep. keys.json is read again after a
   *  few seconds, so an edit there counts. */
  appKey(e) {
    const now = Date.now();
    if (!this.appKeys || now - this.appKeys.at > 3000) {
      let list = [];
      try { list = keys() ?? []; } catch { /* no keys: none taken */ }
      this.appKeys = { at: now, map: appBindings(list, MOD, "nocturne") };
    }
    const bound = this.appKeys.map.get(chordOf(e.keystroke ?? ""));
    if (!bound) return false;
    run(bound.command, ...(bound.args === undefined ? [] : [bound.args]));
    return true;
  }

  /** A link from the hover card: a web page in the shown tab's browser pane
   *  (a new one beside this editor when there's none), a file as a tab of
   *  this editor at its line (a picture, a PDF: the preview beside), mailto:
   *  and the like through the system. */
  followLink(url, cx) {
    const to = linkTarget(url, this.path);
    if (!to) return;
    this.closeCard(cx);
    if (to.kind === "web") this.openWeb(to.url);
    else if (to.kind === "other") run("app.open_url", { url: to.url, in: "system" });
    else if (PREVIEWED.test(to.path)) this.openLooked(to.path, cx);
    else this.openFile(to.path, cx, { line: to.line, col: to.col });
    cx?.notify?.();
  }

  /** A web page in a browser pane: the one in this editor's tab (browser's
   *  `open` command, by its slot: a new tab there, in front, with the keyboard),
   *  else a new browser pane beside this editor (app.open_url in the app). */
  openWeb(url) {
    const me = this.me();
    const browser = me && panes().find((p) => p.mod === "browser" && p.tab === me.tab && !p.parked && p.props?.slot);
    if (browser) return run(`browser.open:${JSON.stringify({ url, slot: browser.props.slot })}`);
    run("app.open_url", { url, in: "app" });
  }

  /** Whether a card is drawn: the keyboard's always, the pointer's once it has something. */
  cardShown(c) {
    return c.keyboard || c.problems.length > 0 || c.parts.length > 0;
  }

  /** Runs `work` in a task: its cx lasts past an await, where an editor
   *  event's (a key, a click) refuses notify and timers once that call has
   *  returned. Resolves with what `work` returns. */
  later(cx, work) {
    return new Promise((resolve, reject) => cx.spawn(async (cx) => { try { resolve(await work(cx)); } catch (e) { reject(e); } }));
  }

  cardOverflows() {
    const c = this.card;
    return !!c && (c.contentH ?? 0) > (c.viewH ?? 0) + 1;
  }

  // ---- moving around

  goto(line, col, cx) {
    this.closeCard(cx);
    this.editor.set_cursor(line, col);
    // Before the first layout there's nothing to scroll: try again once drawn.
    cx.timer.after(60, () => this.editor.set_cursor(line, col));
    // The rendered view lights the block holding that line.
    const d = this.cur;
    if (d?.markdown && d.view === "rendered" && d.rendered) { d.rendered.open(cx); d.rendered.focus(); return; }
    this.editor.focus();
  }

  goLine(cx) {
    const g = parseGoto(this.lineInput.value());
    if (!g) return;
    this.mode = null;
    this.goto(g.line - 1, g.col - 1, cx);
    cx.notify();
  }

  problem(dir, cx) {
    const at = this.editor.cursor();
    const d = nextProblem(this.problems, at.line, at.col, dir);
    if (!d) return this.say("no problems");
    this.goto(d.line, d.col, cx);
    this.showCard(d.line, d.col, true, cx);
  }

  // ---- find

  openFind(replace) {
    this.mode = replace ? "replace" : "find";
    this.findAt = "find";
    const sel = this.editor.selection();
    if (sel.text && !sel.text.includes("\n")) this.findInput.set_value(sel.text);
    this.findInput.focus();
  }

  search(cx) {
    const q = this.findInput.value();
    this.find = q ? this.editor.find(q, { case_sensitive: this.caseSensitive }) : (this.editor.find_close(), { count: 0, current: null });
    cx.notify();
  }

  step(d, cx) {
    if (!this.findInput.value()) return;
    this.find = d > 0 ? this.editor.find_next() : this.editor.find_prev();
    cx.notify();
  }

  replace(all, cx) {
    if (!this.findInput.value()) return;
    this.find = this.editor.replace(this.replaceInput.value(), all);
    cx.notify();
  }

  /** The find line's keyboard to stop `id`: a field's input, or the line itself for a chip. */
  findGo(id) {
    this.findAt = id;
    if (id === "find") this.findInput.focus();
    else if (id === "with") this.replaceInput.focus();
    else this.handle.focus();
  }

  /** A key on the find line, as every form takes them (form-keys.ts): tab /
   *  shift-tab walk its fields and chips, wrapping; space / enter press a
   *  chip (Aa flips); a field keeps its own enter (next, or replace). */
  findKey(e, cx) {
    if (this.mode !== "find" && this.mode !== "replace") return;
    const stops = this.mode === "replace" ? REPLACE_STOPS : FIND_STOPS;
    const i = Math.max(0, stops.findIndex((s) => s.id === this.findAt));
    const a = formKey(stops, i, e.key, e.modifiers ?? {}, e.key_char);
    if (!a || a.act === "type" || (a.act === "submit" && stops[i].kind === "text")) return;
    const id = stops[i].id;
    if (a.act === "move") this.findGo(stops[a.to].id);
    else if (a.act === "cancel") this.closeFind(cx);
    else if (a.act === "flip" || (a.act === "press" && id === "case")) { this.caseSensitive = !this.caseSensitive; this.search(cx); }
    else if (a.act === "press" && id === "prev") this.step(-1, cx);
    else if (a.act === "press" && (id === "replace-one" || id === "replace-all")) this.replace(id === "replace-all", cx);
    else if (a.act === "press" || a.act === "submit") this.step(1, cx);
    else if (a.act !== "none") return;
    cx.stop_propagation();
    cx.notify();
  }

  closeFind(cx) {
    if (this.mode === "find" || this.mode === "replace") this.editor.find_close();
    this.mode = null;
    if (this.view === "rendered" && this.cur?.rendered) this.cur.rendered.focus();
    else this.editor.focus();
    cx.notify();
  }

  // ---- vim

  /** Vim in this pane: its own switch when flipped (remembered for the pane),
   *  else settings.json's default `editor.vim` (on unless false). */
  vimOn() { return this.paneVim ?? settings()?.editor?.vim !== false; }

  /** The pane's switch (the vim chip, cmd-k v, :novim): this pane only. */
  toggleVim(cx) {
    const on = !this.vimOn();
    this.paneVim = on;
    try { localStorage.setItem("vim", on ? "on" : "off"); } catch { /* a nicety */ }
    this.vimSettled(on);
    this.say(on ? "vim on in this pane" : "vim off in this pane");
    cx.notify();
  }

  /** Word wrap on or off in the shown tab (cmd-k z, space u w, :set wrap, the bar's chip). */
  setWrap(on, cx) {
    this.softWrap = on == null ? !this.softWrap : Boolean(on);
    this.editor.set_soft_wrap(this.softWrap);
    this.say(this.softWrap ? "word wrap on" : "word wrap off");
    cx?.notify();
  }

  /** Vim's state when it's turned on or off. */
  vimSettled(on) {
    this.vim.mode = "normal"; this.vim.keys = []; this.vim.ex = null; this.vim.pendingLeader = null;
    this.which = null; this.pending = "";
    this.editor.set_cursor_shape(on ? SHAPE.normal : "bar");
    this.vimWas = on;
  }

  /** A keystroke, before the editor sees it: vim's, or the editor's (false). */
  vimKey(e, cx) {
    if (this.asking && this.askKey(e, cx)) return true;
    // The Markdown commands' list (cmd-.): its letter runs one.
    if (this.mdMenu) return this.mdMenuKey(e, cx);
    if (this.markdown && isMdMenuKey(e)) { this.openMdMenu(cx); return true; }
    if (this.cardKey(e, cx)) return true;
    if (this.appKey(e)) return true;
    if (this.markdown && !this.mode && this.imagePasteKey(e, cx)) return true;
    if (!this.vimOn() || this.state === "loading" || this.mode) return false;
    const k = token(e);
    if (k == null) return false;
    const doc = this.doc(cx);
    const r = feed(this.vim, k, doc);
    if (!r.taken) return false;
    this.vimApply(r, doc, cx);
    if (r.replay) {
      const now = this.doc(cx);
      this.vimApply(play(this.vim, r.replay.keys, now, r.replay.times), now, cx);
    }
    cx.notify();
    return true;
  }

  doc(cx) {
    if (!this.text && this.state === "ready") this.text = this.editor.value();
    const lines = Math.max(4, Math.floor((this.size.height - BAR - HINTS) / 20 / 2));
    let clipboard = null;
    try { clipboard = cx.read_from_clipboard() ?? null; } catch { /* no clipboard */ }
    // The screen's lines (H M L) and the tabs (H / L step them when there are several).
    let top = 0;
    try { top = Number(this.editor.top_line?.()) || 0; } catch { /* the first line */ }
    return { text: this.text, cursor: this.editor.cursor(), clipboard, page: lines, top, rows: 2 * lines, tabs: this.allDocs().length };
  }

  /** What vim decided: one undoable edit for all its edits, the caret,
   *  selections, the mode's caret shape, the clipboard, commands. */
  vimApply(r, doc, cx) {
    if (r.edits?.length) {
      const after = applyEdits(doc.text, r.edits);
      const d = diff(doc.text, after);
      if (d) this.editor.edit([d]);
      this.text = after;
    }
    if (r.multi) this.editor.set_selections(r.multi.map((p) => ({ start: p, end: p })));
    else if (r.selections) this.editor.set_selections(r.selections.map((s) => (s.head === "start" ? { start: s.end, end: s.start } : s)));
    else if (r.cursor) this.editor.set_cursor(r.cursor.line, r.cursor.col);
    if (r.mode) this.editor.set_cursor_shape(SHAPE[r.mode] ?? "block");
    if (r.clipboard) cx.write_to_clipboard(r.clipboard.text);
    if (r.which !== undefined) this.which = r.which;
    if (r.pending !== undefined) this.pending = r.pending;
    if (r.message) this.say(r.message, /^E\d/.test(r.message) || r.message.startsWith("not found"));
    if (r.search) { this.searchMark = r.search; this.find = this.editor.find(r.search.replace(/\\[<>]/g, ""), {}); }
    for (const c of r.commands ?? []) this.vimCommand(c, cx);
  }

  vimCommand(c, cx) {
    const [name, arg] = c.includes(":") ? [c.slice(0, c.indexOf(":")), c.slice(c.indexOf(":") + 1)] : [c, null];
    const me = () => this.me();
    // :q closes the pane with every tab: none may hold unsaved changes (:q! drops them).
    const edited = () => this.allDocs().filter((d) => d.dirty).map((d) => basename(d.path));
    switch (name) {
      case "save": return this.save(cx);
      case "save-quit": return this.save(cx).then(() => { if (!edited().length) run("pane.close", { ...(me() ? { pane: me().pane } : {}) }); else this.say(`E37: unsaved changes in ${edited().join(", ")}`, true); });
      case "quit": if (edited().length) return this.say(`E37: unsaved changes in ${edited().join(", ")} (:q! discards them)`, true); return run("pane.close", { ...(me() ? { pane: me().pane } : {}) });
      case "quit!": for (const d of this.allDocs()) d.dirty = false; setUnsaved(null); return run("pane.close", { ...(me() ? { pane: me().pane } : {}), confirmed: true });
      case "reload": if (this.dirty) return this.say("E37: unsaved changes (:e! discards them)", true); return this.load(cx, null, false);
      case "reload!": this.dirty = false; return this.load(cx, null, false);
      // :e file opens it as a tab here.
      case "edit": return this.openFile(arg.startsWith("/") ? arg : arg.startsWith("~/") ? `${home()}/${arg.slice(2)}` : join(dirname(this.path), arg), cx);
      case "next-tab": return this.stepTab(1, cx);
      case "prev-tab": return this.stepTab(-1, cx);
      case "tab": { const n = Number(arg); if (!(n >= 1 && n <= this.docs.length)) return this.say(`E86: no tab ${arg}`, true); return this.select(this.docs[n - 1], cx); }
      case "close-tab": return this.closeTab(cx);
      case "close-tab!": return this.closeTab(cx, this.cur, true);
      case "move-tab-left": return this.stepMove(-1, cx);
      case "move-tab-right": return this.stepMove(1, cx);
      case "move-tab": return this.stepMove(0, cx, arg);
      case "pop-out": return this.popOut(cx);
      case "pop-out-tab": return this.popOut(cx, this.cur, "tab");
      case "pop-in": return this.popIn(cx);
      case "tab-menu": return this.openTabMenu(cx);
      case "tabs": return this.say(this.docs.map((d, i) => `${i + 1}${d === this.cur ? "%" : ""} ${basename(d.path)}${d.dirty ? " +" : ""}`).join("  "));
      case "undo": return this.editor.undo();
      case "redo": return this.editor.redo();
      case "nohlsearch": this.editor.find_close(); this.searchMark = null; return;
      case "definition": case "next-problem": case "prev-problem": case "hover": case "problems":
        return this.command(name === "problems" ? "problems" : name, cx);
      case "references": return this.references(cx);
      case "picker": return run("nocturne.picker");
      case "grep": return run("nocturne.grep");
      case "files-pane": return run("nocturne.files");
      case "format": return this.formatNow(cx);
      case "code-action": case "rename": return this.say(`${name}: not here yet`);
      case "vim": return this.toggleVim(cx);
      case "keys": return this.command("keys", cx);
      case "preview": case "preview-split": case "preview-only": case "preview-text": case "preview-rendered": case "md-menu": return this.command(name, cx);
      case "set": {
        const opt = String(arg ?? "").trim();
        if (opt === "wrap" || opt === "nowrap") return this.setWrap(opt === "wrap", cx);
        if (opt === "wrap!" || opt === "invwrap") return this.setWrap(null, cx);
        return this.say(`:set ${opt}: only :set wrap / nowrap / wrap! and :novim are known`);
      }
      case "wrap": return this.setWrap(null, cx);
      case "write": return this.say("E: :w <file> isn't supported; :w saves this file", true);
      default:
        // space . and a letter: a Markdown command (mdedit.js).
        if (name.startsWith("md-")) return this.mdRun(name.slice(3), cx);
        return;
    }
  }

  references(cx) {
    return this.later(cx, (cx) => this.referencesNow(cx));
  }

  async referencesNow(cx) {
    let list = null;
    try { list = await this.request("textDocument/references", { context: { includeDeclaration: false } }); } catch (e) { return this.say(String(e?.message ?? e), true); }
    if (!list?.length) { this.say("no references"); cx.notify(); return; }
    this.say(`${list.length} reference${list.length === 1 ? "" : "s"}: going to the first`);
    const loc = firstLocation(list);
    if (loc.path === this.path) this.goto(loc.line, loc.col, cx);
    else this.openFile(loc.path, cx, { line: loc.line + 1, col: loc.col + 1 });
    cx.notify();
  }

  formatNow(cx) {
    return this.later(cx, (cx) => this.formatting(cx));
  }

  async formatting(cx) {
    const d = this.cur;
    if (d.opts.format) { await this.format(d.editor.value(), cx, d); cx.notify(); return; }
    if (d.server?.id == null) return this.say("no formatter: settings.json editor format");
    try {
      const edits = await lspRequest(d.server.id, "textDocument/formatting", { textDocument: { uri: uri(d.path) }, options: { tabSize: d.opts.tab_size, insertSpaces: d.opts.insert_spaces !== false } });
      if (edits?.length) d.editor.edit(edits.map((e) => ({ start: { line: e.range.start.line, col: e.range.start.character }, end: { line: e.range.end.line, col: e.range.end.character }, text: e.newText })));
      this.say("formatted");
    } catch (e) { this.say(String(e?.message ?? e), true); }
    cx.notify();
  }

  // ---- commands (keys.json mod:editor)

  command(c, cx) {
    if (c === "focus") return this.view === "rendered" && this.cur?.rendered ? this.cur.rendered.focus() : this.editor.focus();
    if (c === "save") return this.save(cx);
    if (c === "find") return this.openFind(false);
    if (c === "replace") return this.openFind(true);
    if (c === "line") { this.mode = "line"; this.lineInput.set_value(""); return this.lineInput.focus(); }
    if (c === "next-problem") return this.problem(1, cx);
    if (c === "prev-problem") return this.problem(-1, cx);
    if (c === "problems") { this.drawer = !this.drawer; return; }
    if (c === "definition") return this.definition(cx);
    // cmd-i (vim: K) opens the card at the caret, and closes an open one.
    // (A pointer's card still waiting isn't on screen: cmd-i opens the caret's then.)
    if (c === "hover") { if (this.card && this.cardShown(this.card)) return this.closeCard(cx); const at = this.editor.cursor(); return this.showCard(at.line, at.col, true, cx); }
    if (c === "hover-more") return this.hoverLevel(1, cx);
    if (c === "hover-less") return this.hoverLevel(-1, cx);
    if (c === "reload") { this.dirty = false; return this.load(cx, null, false); }
    if (c === "vim") return this.toggleVim(cx);
    if (c === "wrap") return this.setWrap(null, cx);
    if (c === "keys") return this.toggleKeys(!this.keysShown);
    if (c === "preview" && this.kind === "either") return this.toggleDrawn(cx);
    if (c === "preview") return this.setView(VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length], cx);
    if (c === "preview-split") return this.setView("split", cx);
    if (c === "preview-only") return this.setView("preview", cx);
    if (c === "preview-text") return this.setView("text", cx);
    if (c === "preview-rendered") return this.setView("rendered", cx);
    if (c === "md-menu") return this.openMdMenu(cx);
    if (c.startsWith("md-")) return this.mdRun(c.slice(3), cx);
    if (c === "next-tab") return this.stepTab(1, cx);
    if (c === "prev-tab") return this.stepTab(-1, cx);
    if (c === "close-tab") return this.closeTab(cx);
    if (c === "move-tab-left") return this.stepMove(-1, cx);
    if (c === "move-tab-right") return this.stepMove(1, cx);
    if (c === "pop-out") return this.popOut(cx);
    if (c === "pop-out-tab") return this.popOut(cx, this.cur, "tab");
    if (c === "pop-in") return this.popIn(cx);
    if (c === "tab-menu") return this.openTabMenu(cx);
    // `editor.open:{"path","line"?,"col"?,"view"?}`: a file as a tab of the focused editor.
    if (c.startsWith("open:")) {
      let a = null;
      try { a = JSON.parse(c.slice(5)); } catch { return this.say("open: needs {\"path\": …}", true); }
      const path = String(a?.path ?? "");
      if (!path) return;
      return this.openFile(path.startsWith("/") ? path : join(dirname(this.path), path), cx, { line: a.line ?? null, col: a.col ?? null, view: a.view ?? null });
    }
  }

  // ---- the rendered view and the Markdown commands

  /** The keyboard to the shown tab's text: the rendered view's block, else the code editor. */
  focusText() {
    const d = this.cur;
    if (d?.look) this.lookHandle?.focus();
    else if (d?.markdown && d.view === "rendered" && d.rendered) d.rendered.focus();
    else this.editor?.focus();
  }

  /** What a tab's rendered view (rendered.js) asks of the pane. */
  renderedHost() {
    return {
      font: settings()?.font_family || "JetBrains Mono", colors: this.colors, selection: selectionColor(theme()),
      zoom, dither: (color) => dither(color, 1),
      moon: (t) => svg("mods/nocturne/art/moon-8.svg").w(44).h(44).text_color(t.ansi8),
      onKey: (e, cx) => this.blockKey(e, cx),
      link: (url, cx) => this.previewLink(url, cx),
      notify: (cx) => cx?.notify?.(),
      mdRun: (name, cx) => this.mdRun(name, cx),
      image: (src) => this.image(src),
      loadImages: (srcs, cx) => this.loadImageSrcs(srcs, cx),
      pasteImage: (cx) => this.pasteImage(cx),
      mdMenu: (cx) => this.openMdMenu(cx),
      vim: () => this.vimOn(),
    };
  }

  /** A key in the rendered view's block, before it: what the code editor would
   *  take first (the close question, the card, the app's keys, cmd-., vim over
   *  the whole text); the block then follows the caret. */
  blockKey(e, cx) {
    const d = this.cur;
    const taken = this.vimKey(e, cx);
    if (d?.rendered) {
      if (taken) d.rendered.pull(cx);
      d.rendered.block.set_cursor_shape(this.vimOn() ? (SHAPE[this.vim.mode] ?? "block") : "bar");
    }
    return taken;
  }

  /** Opens the Markdown commands' list (cmd-., vim: space .) at the caret. */
  openMdMenu(cx) {
    if (!this.markdown) return this.say("the Markdown commands are for Markdown files");
    this.mdMenu = { at: Date.now() };
    cx?.notify?.();
  }

  /** A key while the list is open: a command's letter (a digit: that heading level) runs it; anything else closes it. */
  mdMenuKey(e, cx) {
    const k = e.key, m = e.modifiers ?? {};
    if (["shift", "control", "alt", "platform", "function", "capslock"].includes(k)) return true;
    this.mdMenu = null;
    const ch = e.key_char && e.key_char.length === 1 ? e.key_char : m.shift && k.length === 1 ? k.toUpperCase() : k;
    if (!m.platform && !m.control) {
      const name = MD_LEVELS.includes(ch) ? `heading-${ch}` : Object.keys(MD_COMMANDS).find((n) => MD_COMMANDS[n][1] === ch)
        ?? Object.keys(MD_IMAGE).find((n) => MD_IMAGE[n][1] === ch);
      if (name) this.mdRun(name, cx);
    }
    cx?.notify?.();
    return true;
  }

  /** Runs a Markdown command (mdedit.js) on the shown tab's text and selection, as one undoable edit. */
  mdRun(name, cx) {
    this.mdMenu = null;
    const d = this.cur;
    if (!d?.markdown) return this.say("the Markdown commands are for Markdown files");
    if (name === "image") return this.pickImage(cx);
    if (name === "image-paste") return this.pasteImage(cx);
    if (d.state !== "ready" && d.state !== "missing") return;
    const rendered = d.view === "rendered" ? d.rendered : null;
    const text = d.editor.value();
    let sel = rendered ? rendered.selection() : d.editor.selection();
    // In the rendered view a caret stands for its whole block where a command
    // works line by line (a quote, a list, a code block); headings stay the caret's line.
    const caret = sel.start.line === sel.end.line && sel.start.col === sel.end.col ? sel.start : null;
    const whole = rendered && caret && WHOLE_BLOCK.has(name);
    if (whole) sel = { start: { line: rendered.range.from, col: 0 }, end: { line: rendered.range.to, col: text.split("\n")[rendered.range.to]?.replace(/\r$/, "").length ?? 0 } };
    let r = mdCommand(name, text, sel);
    if (r && whole) {
      // The caret back where it was, moved with its line.
      const line = caret.line + (r.sel.start.line - sel.start.line);
      const was = text.split("\n")[caret.line] ?? "", now = r.text.split("\n")[line] ?? "";
      const at = { line, col: Math.max(0, Math.min(now.length, caret.col + now.length - was.length)) };
      r = { text: r.text, sel: { start: at, end: at } };
    }
    const title = MD_COMMANDS[name]?.[0] ?? name.replace("heading-", "heading ");
    if (!r) { this.say(`${title.toLowerCase()}: nothing to change here`); cx?.notify?.(); return; }
    const e = editBetween(text, r.text);
    if (e) d.editor.edit([e]);
    const { start, end } = r.sel;
    d.editor.set_cursor(start.line, start.col, start.line === end.line && start.col === end.col ? undefined : end);
    // The rendered view follows the file's caret and selection (its block, edited in place).
    if (rendered) { rendered.pull(cx); rendered.focus(); }
    this.changed(cx, d);
  }

  /** A task box clicked in the rendered view: [ ] <-> [x], one undoable edit. */
  tickRendered(line, cx) {
    const d = this.cur;
    const text = d.editor.value();
    const r = tickLine(text, line);
    if (!r) return;
    const e = editBetween(text, r.text);
    if (e) d.editor.edit([e]);
    this.changed(cx, d);
  }

  /** A scratchpad's write: only over what was read (another pane on the same note
   *  may have written it); a note changed elsewhere asks as a file does. */
  async autosaveWrite(d) {
    const text = d.editor.value();
    d.writing = text;
    try {
      await writeTextFile(d.path, text, d.saved);
    } catch (e) {
      d.writing = null;
      if (/changed outside/.test(String(e?.message ?? e))) {
        const disk = await readTextFile(d.path).catch(() => null);
        if (disk === text) { d.saved = text; return; }
        d.conflict = true;
      }
      throw e;
    }
    d.saved = text;
    d.writing = null;
    d.state = "ready";
    d.deleted = false;
  }

  /** The autosave's wait: a timer from the last change's task; the write in a task of its own. */
  autosaveTimer(ms, fn) {
    let off = false;
    const cx = this.timerCx;
    if (!cx?.timer) { fn(); return () => {}; }
    cx.timer.after(ms, (cx) => {
      if (off) return;
      cx.spawn(async (cx) => { try { await fn(); } catch { /* the state says */ } cx.notify(); });
    });
    return () => { off = true; };
  }

  /** The rendered view of the shown tab. */
  renderedView(t) {
    const d = this.cur;
    const empty = d.scratch && !d.editor.value().trim()
      ? { title: `A page for ${noteName(d.path)}`, detail: "Kept under the app's folder, out of the repository; every worktree of it opens this one.", hint: `type, or ${this.vimOn() ? "space ." : "cmd-."} for the Markdown commands` }
      : null;
    return d.rendered.view({
      t, focused: d.rendered.focused(), empty, maxWidth: 760, unzoom: (v) => v / zoom(),
      onTask: (line, cx) => this.tickRendered(line, cx),
    });
  }

  /** The Markdown commands' list, which-key style, by the lit block (rendered) or the bar. */
  mdMenuView(t) {
    const d = this.cur;
    const sel = d.view === "rendered" ? d.rendered.selection() : d.editor.selection();
    const on = mdActive(d.editor.value(), sel);
    const names = Object.keys(MD_COMMANDS);
    const inline = names.slice(0, 4), heads = names.slice(4, 6), blocks = names.slice(6);
    const row = (n) => {
      const [title, key, mark] = MD_COMMANDS[n] ?? MD_IMAGE[n];
      const lit = on.has(n) || (n.startsWith("heading") && [...on].some((x) => /^heading-\d/.test(x)));
      // A click runs it too (the pointer's way; the letter is the keyboard's).
      return h_flex().id(`md-menu-${n}`).gap(10).px(4).ml(-4).cursor_pointer().hover((s) => s.bg(t.ansi0))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); this.mdRun(n, cx); cx.notify(); })
        .child(div().w(18).flex_none().text_color(t.accent).child(key))
        .child(div().flex_1().text_color(lit ? t.ansi5 : t.foreground).child(title.replace(/^Heading level /, "level ")))
        .child(div().flex_none().pl(12).text_color(t.dim).child(mark));
    };
    const group = (name) => div().text_size(10.5).text_color(t.dim).mt(4).child(name);
    // Under the lit block (rendered), above it when it doesn't fit there; under the bar in the text views.
    const MENU_H = 270, paneH = this.size.height / zoom();
    let top = this.textTop() + 8;
    if (d.view === "rendered") {
      const litTop = this.textTop() + (d.rendered.litTop ?? 0), litBottom = litTop + d.rendered.litHeight();
      top = litBottom + 6 + MENU_H < paneH - HINTS ? litBottom + 6 : Math.max(this.textTop() + 4, litTop - MENU_H - 6);
    }
    return v_flex().id("editor-md-menu").absolute().right(16).top(top).w(400).bg(t.background).border(1).border_color(t.ansi0).shadow_lg()
      .child(h_flex().relative().h(24).px(12).gap(10).items_center()
        .child(div().text_color(t.accent).child(this.vimOn() ? "space .  markdown" : "cmd-.  markdown"))
        .child(div().relative().flex_1().min_w(40).h(1).opacity(0.6).child(dither(t.ansi8, 1)))
        .child(div().text_color(t.dim).child("esc")))
      .child(h_flex().px(12).pb(10).gap(22).items_start()
        .child(v_flex().flex_1().gap(2).child(group("inline")).children(inline.map(row)).child(group("heading")).children(heads.map(row))
          // 0-6: a digit each, clickable (0: back to text).
          .child(h_flex().gap(4).items_center().child(div().pr(4).text_color(t.foreground).child("level"))
            .children(MD_LEVELS.map((n) => div().id(`md-menu-level-${n}`).w(16).h(16).flex().items_center().justify_center().border(1).border_color(t.ansi0)
              .text_color(t.accent).cursor_pointer().hover((s) => s.border_color(t.accent))
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .on_click((_e, cx) => { cx.stop_propagation(); this.mdRun(`heading-${n}`, cx); cx.notify(); }).child(n)))))
        .child(v_flex().flex_1().gap(2).child(group("blocks")).children(blocks.map(row))
          .child(group("image")).children(Object.keys(MD_IMAGE).map(row))));
  }

  // ---- the Markdown preview

  /** Splits the text into the preview's blocks again (now, or after a moment of typing). */
  refreshPreview(cx, now, d = this.cur) {
    const apply = (cx) => {
      d.previewDue = false;
      d.preview.setText(d.text);
      this.loadImages(cx, d);
      cx.notify();
    };
    if (now) return apply(cx);
    if (d.previewDue) return;
    d.previewDue = true;
    cx.timer.after(40, (cx) => apply(cx));
  }

  /** Split, preview only or text only: this tab's, and what the pane's new
   *  Markdown tabs start with (it remembers). */
  setView(view, cx) {
    if (!this.markdown) return this.say("the preview is for Markdown files");
    this.view = view;
    this.defaultView = view;
    try { localStorage.setItem("preview", view); } catch { /* a nicety */ }
    this.driver = "editor";
    if (view === "rendered") this.cur?.rendered?.open(cx);
    else if (this.cur?.previewStale) { this.cur.previewStale = false; this.refreshPreview(cx, true); }
    if (view === "preview") cx.timer.after(0, () => this.previewHandle.focus());
    else this.focusText();
    this.say(view === "rendered" ? "rendered: type into it" : view === "split" ? "preview beside the text" : view === "preview" ? "preview only (e: back to the text)" : "text only");
    cx.notify();
  }

  /** Copies the document's local images where they can be drawn. */
  loadImages(cx, d = this.cur) {
    if (this.on) return;
    for (const part of d.preview.parts) {
      if (part.kind !== "images") continue;
      for (const img of part.images) {
        if (!isLocalSource(img.src)) continue;
        const abs = join(dirname(d.path), decodeURI(img.src.split(/[?#]/)[0]));
        if (d.images.has(abs)) continue;
        if (!IMAGE_EXT.test(abs)) { d.images.set(abs, null); continue; }
        d.images.set(abs, undefined);
        cx.spawn(async (cx) => { d.images.set(abs, await cacheImage(abs, MOD)); cx.notify(); });
      }
    }
  }

  // ---- images: pasted, picked, drawn (images.js)

  /** cmd-v (and vim's p / P in normal mode) when the clipboard may hold a picture: a copied
   *  image file (its name is the clipboard's text) or no text at all (vim's p; cmd-v without
   *  text comes as the editor's paste_other). Taken: the clipboard is asked, and what isn't a
   *  picture is pasted as before. */
  imagePasteKey(e, cx) {
    const m = e.modifiers ?? {};
    const mac = appWindow()?.platform === "macos";
    const cmdV = e.key === "v" && (mac ? m.platform && !m.control : m.control && !m.platform) && !m.alt && !m.shift;
    const vimP = this.vimOn() && this.vim.mode === "normal" && !this.vim.keys?.length && !this.vim.pendingLeader && !this.vim.ex
      && (e.key === "p" || e.key_char === "P") && !m.platform && !m.control && !m.alt && !this.imagePassP;
    if (!cmdV && !vimP) return false;
    let text = null;
    try { text = cx.read_from_clipboard?.() ?? null; } catch { /* no clipboard */ }
    if (cmdV && !maybeCopiedImage(text)) return false;
    if (vimP && text && !maybeCopiedImage(text)) return false;
    cx.spawn(async (cx) => {
      const done = await this.pasteImage(cx, { quiet: true });
      if (done) return;
      if (cmdV && text != null) this.typeText(text, cx);
      else if (vimP) { this.imagePassP = true; try { this.vimKey(e, cx); } finally { this.imagePassP = false; } this.cur?.rendered?.pull(cx); }
      cx.notify();
    });
    return true;
  }

  /** Text at the caret, as the editor's own paste would (one edit). */
  typeText(text, cx) {
    const d = this.cur;
    const rendered = d.view === "rendered" ? d.rendered : null;
    const s = rendered ? rendered.selection() : d.editor.selection();
    d.editor.edit([{ start: s.start, end: s.end, text }]);
    const lines = text.split("\n");
    const line = s.start.line + lines.length - 1, col = (lines.length > 1 ? 0 : s.start.col) + lines[lines.length - 1].length;
    d.editor.set_cursor(line, col);
    if (rendered) rendered.pull(cx);
    this.changed(cx, d);
  }

  /** The clipboard's picture into the shown Markdown tab: saved beside it (images.js
   *  assetPlace) and an image block at the caret. -> whether there was one. */
  async pasteImage(cx, { quiet = false } = {}) {
    const d = this.cur;
    if (!d?.markdown || !d.path || this.on) { if (!quiet) this.say("pasting a picture works in a Markdown file on this machine", true); return false; }
    const tmp = `${appHome()}/cache/${MOD}/clip-${stamp()}-${Math.random().toString(36).slice(2, 6)}.png`;
    await herdr.exec("mkdir", ["-p", dirname(tmp)]).catch(() => null);
    const got = await readClipboardImage(herdr.exec, appWindow()?.platform, tmp);
    if (!got) { if (!quiet) this.say("the clipboard holds no picture"); cx?.notify?.(); return false; }
    const ext = got.kind === "file" ? (got.path.split(".").pop() || "png").toLowerCase() : "png";
    const place = assetPlace(d.path, { scratch: Boolean(d.scratch), ext });
    // Into its place: the clipboard's PNG moved, a copied file copied (the original stays where it was).
    const r = await herdr.exec("sh", ["-c", 'mkdir -p "$1" && if [ "$4" = file ]; then cp "$2" "$3"; else mv "$2" "$3"; fi', "paste-image", place.dir, got.path, place.path, got.kind]).catch(() => null);
    if (r?.code !== 0) { this.say(`couldn't save the picture: ${String(r?.stderr ?? "").trim() || "no answer"}`, true); cx?.notify?.(); return true; }
    const alt = got.kind === "file" ? basename(got.path).replace(/\.[^.]+$/, "") : "";
    this.insertImageBlock(imageMarkdown(place.rel, alt), cx);
    this.say(`pasted: ${place.rel}`);
    return true;
  }

  /** The system's file picker: an image block for the chosen picture (a relative path to it). */
  pickImage(cx) {
    const d = this.cur;
    if (!d?.path || this.on) return this.say("pick a picture in a file on this machine", true);
    if (typeof herdr.pickFile !== "function") return this.say("no file picker here", true);
    cx.spawn(async (cx) => {
      const file = await herdr.pickFile({ prompt: "Insert" }).catch(() => null);
      if (!file) return;
      if (!isImagePath(file)) { this.say(`not a picture: ${basename(file)}`, true); cx.notify(); return; }
      this.insertImageBlock(imageMarkdown(relative(dirname(d.path), file), basename(file).replace(/\.[^.]+$/, "")), cx);
      cx.notify();
    });
  }

  /** An image line at the caret (its own block: the caret's blank line, else after its block), one undoable edit. */
  insertImageBlock(md, cx) {
    const d = this.cur;
    const rendered = d.view === "rendered" ? d.rendered : null;
    const text = d.editor.value();
    const caret = rendered ? rendered.selection().end.line : d.editor.cursor().line;
    // After the caret's whole block (the lit lines; in the text view the unit holding the caret).
    const end = rendered && caret >= rendered.range.from && caret <= rendered.range.to ? (rendered.unit.kind !== "blank" ? rendered.range.to : caret)
      : unitFor(liveUnits(text), caret).to;
    const r = insertImage(text, caret, md, end);
    const e = editBetween(text, r.text);
    if (e) d.editor.edit([e]);
    d.editor.set_cursor(r.line, 0);
    if (rendered) { rendered.pull(cx); rendered.focus(); }
    this.changed(cx, d);
  }

  /** Copies the pictures of `srcs` where they can be drawn (once each: cacheImage names them by content). */
  loadImageSrcs(srcs, cx) {
    const d = this.cur;
    if (!d || this.on || !cx?.spawn) return;
    for (const src of srcs) {
      if (!isLocalSource(src)) continue;
      const abs = join(dirname(d.path), decodeURI(src.split(/[?#]/)[0]));
      if (d.images.has(abs)) continue;
      if (!IMAGE_EXT.test(abs)) { d.images.set(abs, null); continue; }
      d.images.set(abs, undefined);
      cx.spawn(async (cx) => { d.images.set(abs, await cacheImage(abs, MOD)); cx.notify(); });
    }
  }

  image(src) {
    if (!isLocalSource(src) || this.on) return { abs: null, name: null };
    const abs = join(dirname(this.path), decodeURI(src.split(/[?#]/)[0]));
    const name = this.images.get(abs);
    return { abs, name: name ? `cache/${MOD}/${name}` : name };
  }

  /** A preview link: a heading here, another Markdown file in the editor,
   *  pictures and the like in the preview pane, web pages as the app opens them. */
  previewLink(href, cx) {
    const to = follow(href, this.path);
    if (!to) return;
    const me = panes().find((p) => p.mod === MOD && p.props?.slot === this.slot);
    const here = (anchor) => {
      if (this.cur?.previewStale) { this.cur.previewStale = false; this.cur.preview.setText(this.cur.text); }
      if (!this.preview.scrollTo(anchor)) return;
      // The text goes there too: the heading's line.
      const part = this.preview.parts.find((p) => p.anchor === anchor || p.anchors?.includes(anchor) || p.notes?.some((n) => n.anchor === anchor));
      const line = part?.notes?.find((n) => n.anchor === anchor)?.from ?? part?.from;
      if (line != null && this.view !== "preview") { this.previewDrove = Date.now(); this.driver = "preview"; this.editor.set_cursor(line, 0); this.editor.scroll_to_line(line); }
    };
    if (to.kind === "anchor") here(to.anchor);
    else if (to.kind === "markdown") {
      if (to.path === this.path) { if (to.anchor) here(to.anchor); }
      else this.openFile(to.path, cx);
    } else if (to.kind === "web") run("app.open_url", { url: to.url });
    else if (to.kind === "file" && PREVIEWED.test(to.path)) this.openLooked(to.path, cx);
    else if (to.kind === "file" && languageOf(to.path)) this.openFile(to.path, cx);
    else if (!this.on) {
      const opener = appWindow()?.platform === "windows" ? null : appWindow()?.platform === "macos" ? "open" : "xdg-open";
      if (opener) exec(opener, [to.kind === "file" ? to.path : to.url]).catch(() => null);
    }
    cx.notify();
  }

  /** A task box ticked in the preview: [ ] <-> [x] in the text, one undoable edit. */
  tick(line, cx) {
    const edit = taskToggle(this.text, line);
    if (!edit) return;
    this.editor.edit([{ start: { line, col: edit.col }, end: { line, col: edit.col + 1 }, text: edit.text }]);
    this.changed(cx);
  }

  /** Keys while the preview alone has the keyboard: the viewer's scrolling, and back to the text. */
  previewKey(e, cx) {
    const k = e.key, m = e.modifiers ?? {};
    if (m.platform || m.alt) return;
    const doc = this.preview, page = Math.max(80, doc.viewH / 2);
    if (this.leaderAt && Date.now() - this.leaderAt < 1500) {
      const seq = (this.leaderKeys ?? "") + k;
      if (seq === "m") { this.leaderKeys = "m"; cx.stop_propagation(); return; }
      this.leaderAt = 0; this.leaderKeys = "";
      const go = { mp: "preview", ms: "preview-split", mv: "preview-only", mt: "preview-text" }[seq];
      if (go) { this.command(go, cx); cx.stop_propagation(); cx.notify(); }
      return;
    }
    if (m.control) {
      if (k === "d") doc.scroll(page); else if (k === "u") doc.scroll(-page); else return;
    } else if (k === "j" || k === "down") doc.scroll(60);
    else if (k === "k" || k === "up") doc.scroll(-60);
    else if (k === "d" || k === "pagedown") doc.scroll(page);
    else if (k === "u" || k === "pageup") doc.scroll(-page);
    else if (k === "G" || (k === "g" && m.shift) || k === "end") doc.scroll(1e9);
    else if (k === "g" || k === "home") {
      if (k === "home" || Date.now() - (this.gAt ?? 0) < 500) { this.gAt = 0; doc.scrollY = 0; } else this.gAt = Date.now();
    } else if (k === "space" && this.vimOn()) { this.leaderAt = Date.now(); this.leaderKeys = ""; }
    else if (k === "space") doc.scroll(page);
    else if (k === "e" || k === "i" || k === "escape") return this.setView("split", cx);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  /** The preview, following the text when the text scrolled last. */
  previewView(t) {
    const doc = this.preview;
    if (this.view === "split" && this.driver === "editor") {
      const top = this.editor.top_line();
      if (top != null) doc.setScroll(doc.yOfLine(top) - 4);
    }
    const focused = this.view === "preview" && this.previewHandle.is_focused();
    return v_flex().id("editor-preview").relative().flex_1().min_w(0).min_h(0).bg(t.background)
      .track_focus(this.previewHandle)
      .on_key_down((e, cx) => this.previewKey(e, cx))
      .on_mouse_down("left", () => { if (this.view === "preview") this.previewHandle.focus(); })
      .child(doc.render(t, {
        onLink: (url, cx) => this.previewLink(url, cx),
        onTask: (line, cx) => this.tick(line, cx),
        image: (src) => this.image(src),
        // A drawn picture: a drawn tab here (through the open record, answered with a context in render).
        onImage: (abs) => { if (this.slot) setShared(OPEN, { slot: this.slot, path: abs, look: true, n: (shared(OPEN)?.n ?? 0) + 1, at: Date.now() }); },
        dither: (color) => dither(color, 1),
        focused, size: 13, maxWidth: this.view === "preview" ? 780 : 720, unzoom: (v) => v / zoom(),
        notify: (cx) => cx.notify(),
        onScroll: () => {
          // The preview scrolled by hand: the text follows it.
          this.driver = "preview";
          if (this.view !== "split") return;
          this.previewDrove = Date.now();
          this.editor.scroll_to_line(doc.lineAtY(doc.scrollY + 4));
        },
      }));
  }

  async close() {
    // A scratchpad writes what waits before it goes.
    await Promise.all(this.allDocs().filter((d) => d.autosave).map((d) => d.autosave.flush().catch(() => {})));
    const ids = new Set();
    for (const d of this.allDocs()) {
      d.gone = true;
      if (d.server?.id == null) continue;
      lspNotify(d.server.id, "textDocument/didClose", { textDocument: { uri: uri(d.path) } });
      ids.add(d.server.id);
    }
    for (const id of ids) lspRelease(id);
    setUnsaved(null);
    if (this.slot) {
      for (const key of [TITLES, PATHS]) {
        const all = { ...(shared(key) ?? {}) };
        if (!(this.slot in all)) continue;
        delete all[this.slot];
        setShared(key, all);
      }
    }
  }

  // ---- drawing

  render(cx) {
    const t = theme();
    if (this.vimWas !== undefined && this.vimWas !== this.vimOn()) this.vimSettled(this.vimOn());
    const goto = shared(GOTO);
    // A newer rename, move or delete from the files pane: answered after this render.
    if (newestId(fileChanges(shared)) > this.seenChange) cx.timer.after(0, (cx) => this.followChanges(cx));
    // The app's editor.open on a file one of the tabs holds: that tab, at the line asked for.
    if (goto && goto.n !== this.seenGoto && this.allDocs().some((d) => d.path === goto.path)) {
      this.seenGoto = goto.n;
      cx.timer.after(0, (cx) => { this.openFile(goto.path, cx, { line: goto.line ?? null, col: goto.col ?? null }); cx.notify(); });
    }
    // A file sent to this editor as a tab (editor-route.ts: the files pane, the picker, the Markdown viewer).
    const req = shared(OPEN);
    if (req && req.slot === this.slot && this.slot && req.n !== this.seenOpen) {
      this.seenOpen = req.n;
      cx.timer.after(0, (cx) => { this.openFile(req.path, cx, { line: req.line ?? null, col: req.col ?? null, view: req.view ?? null, look: Boolean(req.look) }); cx.notify(); });
    }
    // The editor that last had the keyboard, for the files pane and the picker to send files to.
    // The shown drawn tab's viewer, made once: a nested view, so its reading redraws only it.
    if (this.cur?.look) this.mountViewer(cx);
    if (this.slot && (this.editor.focused?.() || (this.look && this.lookHandle.is_focused?.())) && shared(LAST) !== this.slot) cx.timer.after(0, () => { if (shared(LAST) !== this.slot) setShared(LAST, this.slot); });
    const code = settings()?.font_family || "JetBrains Mono";
    return v_flex().id("editor").relative().size_full().bg(t.background).text_size(11)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_key_down((e, cx) => {
        // The editor's own keys came through vimKey; these are the pane's
        // others (the find line, the preview): esc closes the card, then find.
        if (e.key !== "escape") return;
        if (this.card) { this.closeCard(cx); cx.stop_propagation(); }
        else if (this.mode) { this.closeFind(cx); cx.stop_propagation(); }
      })
      // A click outside the card closes it (the card keeps its own), and the tab menu.
      .on_mouse_down("left", (_e, cx) => { this.closeCard(cx); this.closeTabMenu(cx, false); })
      // A tab dragged off the strip and let go over the pane: popped out beside (tabs.js).
      .on_mouse_up("left", (_e, cx) => { if (this.tabDrag?.out) this.dropOut(cx); })
      .on_hover((over, cx) => { if (!over) this.cancelDrag(cx); })
      .when(showStrip(this.allDocs().length), (el) => el.child(this.tabStrip(t)))
      // A drawn tab: the viewer's slim bar says what it is; the editor's is for text.
      .when(!this.look, (el) => el.child(this.bar(t)))
      .when(Boolean(this.asking), (el) => el.child(this.askLine(t)))
      .when(this.conflict, (el) => el.child(this.conflictLine(t)))
      .when(this.mode != null, (el) => el.child(this.findLine(t)))
      .when(this.vim.ex != null, (el) => el.child(this.exLine(t, code)))
      // ?: the keys in the file's place (the file folds away, kept), the bars stay (keyhelp.ts).
      .when(Boolean(this.keysShown), (el) => el.child(div().relative().flex_1().min_h(0).child(this.keysStrip(t))))
      .child(this.keysShown ? div().h(0).flex_none().overflow_hidden().child(this.look ? this.lookView(t) : this.body(t, code)) : this.look ? this.lookView(t) : this.body(t, code))
      .when(this.drawer && !this.keysShown && !this.look, (el) => el.child(this.drawerView(t)))
      .child(this.hints(t))
      .map((el) => { const card = this.card ? this.cardView(t, code) : null; return card ? el.child(card) : el; })
      .when(!!this.which?.length && this.vimOn(), (el) => el.child(this.whichView(t)))
      .when(Boolean(this.mdMenu) && this.markdown, (el) => el.child(this.mdMenuView(t)))
      .when(Boolean(this.tabDrag?.out), (el) => el.child(this.dropZone(t)))
      .when(Boolean(this.tabMenu), (el) => el.child(this.tabMenuView(t)));
  }

  bar(t) {
    const c = counts(this.problems);
    const dir = tilde(dirname(this.path), home());
    const at = this.state === "ready" || this.state === "missing" ? this.editor.cursor() : null;
    const narrow = this.size.width < 520;
    const sev = (n, color, id) => h_flex().id(id).flex_none().gap(5).items_center()
      .on_click((_e, cx) => { this.drawer = !this.drawer; cx.notify(); })
      .child(div().relative().size(7).border(1).border_color(color).child(dither(color, 1)))
      .child(div().text_color(color).child(String(n)));
    const s = this.server;
    // The server's word (logic.js serverNote): running, starting, loading the
    // project's .envrc, stopped, or why there's none ("direnv allow").
    const word = serverNote(s, this.lang, { tilde: (p) => tilde(p, home()) })?.short;
    // A running server's own words for what it's doing: "indexing 120/340"
    // while answers wait on it (yellow), "· cargo check" beside its name after.
    const work = s?.status === "ready" ? progressWord(this.progress) : null;
    const server = s?.status === "ready" && work ? (busy(this.progress) ? [t.ansi3, work] : [t.ansi2, `${s.name} · ${work}`])
      : s?.status === "ready" ? [t.ansi2, s.name]
      : s?.status === "starting" || s?.status === "env" || s?.envKind === "blocked" ? [t.ansi3, word]
      : s?.status === "exited" || s?.envKind === "failed" ? [t.ansi1, word]
      : word ? [t.dim, word] : null;
    const msg = this.message && Date.now() - this.message.at < 4000 ? this.message : null;
    const vim = this.vimOn();
    const modeColor = { normal: t.accent, insert: t.ansi2, replace: t.ansi1, visual: t.ansi5, vline: t.ansi5, vblock: t.ansi5 }[this.vim.mode] ?? t.accent;
    return h_flex().id("editor-bar").h(BAR).flex_none().px(12).gap(10).items_center().border_b(1).border_color(t.ansi0)
      .when(vim, (el) => el.child(div().id("bar-mode").relative().flex_none().h(18).px(6).flex().items_center()
        .child(div().absolute().inset_0().opacity(0.3).child(dither(modeColor, 1)))
        .child(div().relative().text_color(modeColor).child(MODE_NAME[this.vim.mode] ?? "NORMAL"))))
      .when(vim && !!this.vim.recording, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`rec @${this.vim.recording.reg}`)))
      // One file (no strip): its unsaved mark and name are here, as before tabs.
      .when(!showStrip(this.allDocs().length), (el) => el
        .when(!this.scratch, (el) => el.child(div().id("bar-mark").relative().size(8).flex_none().border(1).border_color(this.dirty ? t.ansi3 : t.ansi0)
          .when(this.dirty, (el) => el.child(dither(t.ansi3, 1)))))
        .child(div().id("bar-name").flex_none().max_w(MAX_TAB_NAME * 1.5).truncate().text_color(t.foreground).child(this.scratch ? "scratchpad" : basename(this.path) || "untitled")))
      .when(this.deleted, (el) => el.child(div().id("bar-deleted").flex_none().text_color(t.ansi1).child("deleted · cmd-s writes it again")))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(narrow ? "" : this.scratch ? `${noteName(this.path)} · every worktree of it` : dir))
      // A scratchpad: saving… while it waits to write, saved after (green), what went wrong (red).
      .when(Boolean(this.scratch), (el) => {
        const st = this.saveState ?? "saved";
        const color = st === "error" ? t.ansi1 : st === "saved" ? t.ansi2 : t.ansi3;
        return el.child(h_flex().id("bar-autosave").flex_none().gap(6).items_center().text_color(color)
          .child(div().relative().size(7).border(1).border_color(color).child(dither(color, 1)))
          .child(st === "error" ? "not saved" : st === "saved" ? "saved" : "saving…"));
      })
      .when(!!msg, (el) => el.child(div().flex_none().text_color(msg.bad ? t.ansi1 : t.ansi2).truncate().max_w(260).child(msg.text)))
      .when(c.error > 0, (el) => el.child(sev(c.error, t.ansi1, "bar-errors")))
      .when(c.warning > 0, (el) => el.child(sev(c.warning, t.ansi3, "bar-warnings")))
      .when(!!server && !narrow, (el) => el.child(h_flex().id("bar-server").flex_none().gap(6).items_center().text_color(t.muted)
        .child(div().size(6).bg(server[0])).child(server[1])))
      .when(!narrow, (el) => el.child(h_flex().flex_none().h(18).px(6).items_center().border(1).border_color(t.ansi0).text_color(t.muted)
        .child(`${this.lang} · ${this.opts.insert_spaces === false ? "tab" : `${this.opts.tab_size} sp`}`)))
      .when(vim && !!this.pending, (el) => el.child(div().flex_none().text_color(t.foreground).child(this.pending)))
      .when(!!at, (el) => el.child(div().flex_none().text_color(t.dim).child(`${at.line + 1}:${at.col + 1}`)))
      // The Markdown commands' list (cmd-., vim: space .), found from the bar: a click opens it.
      .when(this.markdown && this.view !== "preview" && !narrow, (el) => el.child(h_flex().id("bar-md").flex_none().h(18).px(6).gap(6).items_center().border(1)
        .border_color(this.mdMenu ? t.accent : t.ansi0).text_color(this.mdMenu ? t.accent : t.muted).hover((s) => s.text_color(t.foreground).border_color(t.ansi8))
        .tooltip("bold, headings, lists, tasks, quotes, code: the Markdown commands")
        .on_click((_e, cx) => { if (this.mdMenu) { this.mdMenu = null; this.focusText(); cx.notify(); } else { this.openMdMenu(cx); this.focusText(); } })
        .child("markdown").child(div().text_color(t.dim).child(vim ? "space ." : "cmd-."))))
      .when(this.markdown, (el) => el.child(div().id("bar-preview").flex_none().h(18).px(6).flex().items_center().border(1)
        .border_color(this.view === "text" ? t.ansi0 : t.ansi5).text_color(this.view === "text" ? t.dim : t.ansi5).hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => this.command("preview", cx)).child(this.view)))
      // A table, patch or SVG as text: drawn again (e in the drawn tab comes back here).
      .when(this.kind === "either", (el) => el.child(div().id("bar-drawn").flex_none().h(18).px(6).flex().items_center().border(1)
        .border_color(t.ansi0).text_color(t.dim).hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { this.setDrawn(this.cur, true, cx); cx.notify(); }).child("drawn")))
      .when(!narrow || this.softWrap, (el) => el.child(div().id("bar-wrap").flex_none().h(18).px(6).flex().items_center().border(1)
        .border_color(this.softWrap ? t.ansi4 : t.ansi0).text_color(this.softWrap ? t.ansi4 : t.dim).hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => this.setWrap(null, cx)).child("wrap")))
      .child(div().id("bar-vim").flex_none().h(18).px(6).flex().items_center().border(1).border_color(vim ? t.accent : t.ansi0)
        .text_color(vim ? t.accent : t.dim).hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => this.toggleVim(cx)).child("vim"));
  }

  /** The strip's height: none with one tab. */
  stripH() {
    return showStrip(this.allDocs().length) ? TABS : 0;
  }

  /** The file tabs along the pane's top (from two files on): each file's
   *  unsaved mark, name (with the folder that tells two of the same name
   *  apart) and ×; the shown one lit (a dithered band, an accent edge). Those
   *  that don't fit fold into ‹ n / n › at the ends, the shown one always in
   *  view. A press dragged along the strip moves its tab: it lifts where it
   *  is and a stake stands in the gap it drops into; the wheel steps tabs. */
  tabStrip(t) {
    const docs = this.allDocs();
    // A scratchpad's tab says so, with its repository (its file is named for the app).
    const labels = tabLabels(docs.map((d) => d.path)).map((l, i) => (docs[i].scratch ? { ...l, name: "scratchpad", hint: noteName(docs[i].path) } : l));
    const z = zoom();
    const room = this.size.width / z - 8;
    const active = docs.indexOf(this.cur);
    const widths = labels.map(tabWidth);
    const fit = visibleTabs(widths, active, room);
    // Where each drawn tab starts (px, unzoomed): the tab menu opens under it.
    this.tabX = (i) => (i < fit.from || i >= fit.to ? 8 : (fit.before > 0 ? MORE : 0) + widths.slice(fit.from, i).reduce((a, b) => a + b, 0));
    const drag = this.tabDrag;
    const stake = drag ? stakeAt(docs.length, drag.from, dropIndex(docs.length, drag.from, drag.gap)) : null;
    // The landing place among the drawn tabs: one folded away stands at the edge.
    const stakeBefore = stake == null ? undefined : stake.before == null || stake.before >= fit.to ? null : Math.max(stake.before, fit.from);
    const more = (id, text, dir) => h_flex().id(id).relative().h_full().w(MORE).flex_none().justify_center().items_center().text_color(t.dim)
      .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { this.stepTab(dir, cx); cx.notify(); }).child(text);
    const tab = (d, i) => {
      const on = d === this.cur, l = labels[i];
      const bad = d.state === "error" || d.deleted;
      const lifted = drag?.from === i;
      return h_flex().id(`editor-tab-${i}`).relative().h_full().flex_none().pl(10).pr(6).gap(6).items_center().border_r(1).border_color(t.ansi0)
        .text_color(on || lifted ? t.foreground : t.muted)
        .when(on && !lifted, (el) => el.child(div().absolute().inset_0().opacity(0.45).child(dither(t.ansi0, 1)))
          .child(div().absolute().left(0).right(0).top(0).h(2).bg(t.accent)))
        // Dragged: lifted where it is (a plate edged in the accent, a dither shadow), behind its words.
        .when(lifted, (el) => el
          .child(div().absolute().left(5).right(-1).top(5).bottom(1).child(dither(t.ansi0, 1)))
          .child(div().absolute().left(2).right(2).top(2).bottom(4).bg(t.background).border(1).border_color(t.accent)))
        .when(!on && !drag, (el) => el.hover((s) => s.text_color(t.foreground)))
        .on_mouse_down("left", (e, _cx) => { this.tabPress = { index: i, x: e?.position?.x ?? 0 }; })
        .on_mouse_move((e, cx) => this.dragOver(gapAt(i, e?.local_position?.x ?? 0, e?.bounds?.width ?? 1), e, cx))
        // A click (no drag) shows the tab; a drag drops in the strip's mouse up.
        .on_click((_e, cx) => { if (this.tabDrag) return; this.select(d, cx); cx.notify(); })
        // Middle click closes it, as the app's tab strip does; a right-click opens its menu.
        .on_mouse_down("middle", (_e, cx) => { cx.stop_propagation(); this.closeTab(cx, d); cx.notify(); })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openTabMenu(cx, i); cx.notify(); })
        // Unsaved: the bar's yellow dithered square; nothing when clean.
        .child(div().id(`editor-tab-mark-${i}`).relative().size(7).flex_none().border(1)
          .border_color(d.dirty ? t.ansi3 : bad ? t.ansi1 : on ? t.ansi8 : t.ansi0)
          .when(d.dirty, (el) => el.child(dither(t.ansi3, 1))))
        .child(div().relative().flex_none().max_w(MAX_TAB_NAME).truncate().child(l.name))
        .when(Boolean(l.hint), (el) => el.child(div().relative().flex_none().max_w(120).truncate().text_color(t.dim).child(l.hint)))
        .child(div().id(`editor-tab-close-${i}`).relative().flex_none().size(14).flex().items_center().justify_center()
          .text_color(on ? t.muted : t.ansi8).hover((s) => s.text_color(t.ansi1))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); this.closeTab(cx, d); cx.notify(); })
          .child("×"))
        .when(stakeBefore === i, (el) => el.child(tabStake(t)));
    };
    // Past the last tab: the gap at the end, wide enough to aim at.
    const end = div().id("editor-tabs-end").relative().flex_1().min_w(24).h_full()
      .on_mouse_move((e, cx) => this.dragOver({ index: null, after: false }, e, cx))
      .when(stakeBefore === null, (el) => el.child(tabStake(t)));
    return h_flex().id("editor-tabs").relative().h(TABS).flex_none().items_center().overflow_hidden().bg(t.background)
      .on_mouse_up("left", (_e, cx) => this.dropTab(cx))
      .on_hover((hovered, cx) => { if (!hovered) this.leaveStrip(cx); })
      .when(Boolean(drag), (el) => el.cursor_grabbing())
      .on_scroll_wheel((e, cx) => { const dy = e?.delta?.y ?? 0; if (Math.abs(dy) >= 1) { this.stepTab(dy > 0 ? -1 : 1, cx); cx.notify(); } })
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.ansi0, 1)))
      .when(fit.before > 0, (el) => el.child(more("editor-tabs-before", `‹ ${fit.before}`, -1)))
      .children(docs.slice(fit.from, fit.to).map((d, j) => tab(d, fit.from + j)))
      .child(end)
      .when(fit.after > 0, (el) => el.child(more("editor-tabs-after", `${fit.after} ›`, 1)));
  }

  /** Closing a tab with unsaved changes asks here: save and close, discard, or keep. */
  askLine(t) {
    const a = this.asking;
    const chip = (id, label, k) => div().id(`editor-ask-${id}`).flex_none().h(18).px(6).flex().items_center().gap(6).border(1)
      .border_color(a.at === id ? t.accent : t.ansi0).text_color(a.at === id ? t.foreground : t.muted)
      .when(a.at === id, (el) => el.bg(t.ansi0))
      .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { this.answerClose(id, cx); cx.notify(); })
      .child(div().child(label)).child(div().text_color(t.accent).child(k));
    return h_flex().id("editor-ask").relative().h(FIND).flex_none().px(12).gap(10).items_center()
      .child(div().absolute().inset_0().opacity(0.25).child(dither(t.ansi3, 1)))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(t.ansi3).child(`${basename(a.doc.path)} has unsaved changes. Close it?`))
      .child(chip("save", "save & close", "s"))
      .child(chip("discard", "discard", "d"))
      .child(chip("keep", "keep open", "esc"));
  }

  /** The question's keys (it holds the keyboard while it shows): s / d / esc
   *  (n) answer, tab / ← → move between the answers, enter / space press. */
  askKey(e, cx) {
    const a = this.asking, k = e.key, m = e.modifiers ?? {};
    if (["shift", "control", "alt", "platform", "function", "capslock"].includes(k)) return false;
    if (m.platform) return false;
    const order = ["save", "discard", "keep"];
    const i = order.indexOf(a.at);
    if (k === "escape" || k === "n") this.answerClose("keep", cx);
    else if (k === "s" || k === "y") this.answerClose("save", cx);
    else if (k === "d") this.answerClose("discard", cx);
    else if (k === "enter" || k === "space") this.answerClose(a.at, cx);
    else if (k === "tab" || k === "right" || k === "l") a.at = order[(i + (m.shift && k === "tab" ? order.length - 1 : 1)) % order.length];
    else if (k === "left" || k === "h") a.at = order[(i + order.length - 1) % order.length];
    cx.notify();
    return true;
  }

  /** Vim's ex line (`:`, `/`, `?`), under the bar. */
  exLine(t, code) {
    const ex = this.vim.ex ?? "";
    const lead = ex.startsWith("/") || ex.startsWith("?") ? ex[0] : ":";
    const body = lead === ":" ? ex : ex.slice(1);
    return h_flex().id("editor-ex").relative().h(FIND).flex_none().px(12).gap(2).items_center().font_family(code).text_size(12.5)
      .child(div().flex_none().text_color(t.accent).child(lead))
      .child(div().flex_none().text_color(t.foreground).child(body))
      .child(div().w(7).h(15).flex_none().bg(t.foreground))
      .child(div().flex_1())
      .child(h_flex().flex_none().gap(4).font_family(settings()?.ui_font_family || "Geist").text_size(11).child(div().text_color(t.accent).child("enter")).child(div().text_color(t.dim).child("run")))
      .child(h_flex().flex_none().gap(4).font_family(settings()?.ui_font_family || "Geist").text_size(11).child(div().text_color(t.accent).child("esc")).child(div().text_color(t.dim).child("cancel")))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }

  /** The leader's next keys, which-key style, bottom right over the text. */
  whichView(t) {
    const list = this.which ?? [];
    const cols = list.length > 6 ? 2 : 1;
    const rows = Math.ceil(list.length / cols);
    return v_flex().id("editor-which").absolute().right(12).bottom(HINTS + 8).bg(t.background).border(1).border_color(t.ansi0).shadow_lg()
      .child(h_flex().relative().h(24).px(12).gap(10).items_center()
        .child(div().text_color(t.accent).child(this.pending ? `leader ${this.pending}` : "leader"))
        .child(div().relative().flex_1().min_w(40).h(1).opacity(0.6).child(dither(t.ansi8, 1)))
        .child(div().text_color(t.dim).child("esc")))
      .child(h_flex().px(12).pb(8).gap(18).children(Array.from({ length: cols }, (_, c) => v_flex().gap(2).children(
        list.slice(c * rows, (c + 1) * rows).map((w, i) => h_flex().id(`which-${c}-${i}`).gap(10)
          .child(div().w(36).text_color(t.accent).child(w.key))
          .child(div().text_color(w.label.startsWith("+") ? t.ansi5 : t.foreground).child(w.label)))))));
  }

  conflictLine(t) {
    const chip = (id, label, go) => div().id(id).flex_none().px(6).h(18).flex().items_center().border(1).border_color(t.ansi0).text_color(t.foreground)
      .hover((s) => s.border_color(t.accent)).on_click((_e, cx) => { go(cx); cx.notify(); });
    return h_flex().id("editor-conflict").relative().h(FIND).flex_none().px(12).gap(10).items_center()
      .child(div().absolute().inset_0().opacity(0.25).child(dither(t.ansi3, 1)))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(t.ansi3).child("Changed on disk while you edited it."))
      .child(chip("conflict-reload", "reload theirs", (cx) => { this.dirty = false; setUnsaved(null); this.load(cx, null, false); }).child("reload theirs"))
      .child(chip("conflict-keep", "keep mine", (cx) => { this.conflict = false; this.keepMine(cx); }).child("keep mine"));
  }

  /** Keeping my version: what's on disk now becomes what saving replaces. */
  keepMine(cx) {
    cx.spawn(async (cx) => {
      try { this.saved = await readTextFile(this.path, { on: this.on }); } catch { /* saved stays */ }
      // A scratchpad writes yours over theirs by itself.
      if (this.scratch) { this.timerCx = cx; this.autosave.touch(); this.say("yours is kept: written in a moment"); }
      else this.say("yours is kept: cmd-s writes it over theirs");
      cx.notify();
    });
  }

  findLine(t) {
    // A chip with the keyboard wears the dialogs' ring: a band, an accent edge.
    const chip = (id, label, on, go) => div().id(id).flex_none().h(18).px(6).flex().items_center().border(1)
      .border_color(on || this.findAt === id ? t.accent : t.ansi0).text_color(on ? t.accent : this.findAt === id ? t.foreground : t.muted)
      .when(this.findAt === id, (el) => el.bg(t.ansi0))
      .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { go(cx); cx.notify(); }).child(label);
    const hint = (k, what) => h_flex().flex_none().gap(4).child(div().text_color(t.accent).child(k)).child(div().text_color(t.dim).child(what));
    const line = this.mode === "line";
    const count = this.find.count ? `${(this.find.current ?? 0) + 1} / ${this.find.count}` : this.findInput.value() ? "none" : "";
    return v_flex().id("editor-find").relative().flex_none()
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.findKey(e, cx))
      .map((el) => tabActions(el, (e, cx) => this.findKey(e, cx)))
      .child(h_flex().h(FIND).px(12).gap(10).items_center()
        .child(div().flex_none().text_color(t.accent).child(line ? "line" : "find"))
        .child(div().w(line ? 160 : 240).flex_none().h(20).border_b(1).border_color(t.accent)
          .child(Input.new(line ? this.lineInput : this.findInput).size_full().text_size(12).font_family(settings()?.font_family || "JetBrains Mono")))
        .when(!line, (el) => el
          .child(div().flex_none().text_color(this.find.count ? t.foreground : t.dim).child(count))
          .child(chip("case", "Aa", this.caseSensitive, (cx) => { this.caseSensitive = !this.caseSensitive; this.search(cx); }))
          .child(chip("prev", "‹", false, (cx) => this.step(-1, cx)))
          .child(chip("next", "›", false, (cx) => this.step(1, cx))))
        .child(div().flex_1())
        .when(this.size.width > 560, (el) => el.child(line ? hint("enter", "go") : hint("enter", "next")).child(line ? div() : hint("shift-enter", "prev")).child(line ? div() : hint("tab ⇧tab", "move")).child(hint("esc", "close"))))
      .when(this.mode === "replace", (el) => el.child(h_flex().h(FIND).px(12).gap(10).items_center()
        .child(div().flex_none().text_color(t.accent).child("with"))
        .child(div().w(240).flex_none().h(20).border_b(1).border_color(this.findAt === "with" ? t.accent : t.ansi0)
          .child(Input.new(this.replaceInput).size_full().text_size(12).font_family(settings()?.font_family || "JetBrains Mono")))
        .child(chip("replace-one", "replace", false, (cx) => this.replace(false, cx)))
        .child(chip("replace-all", "all", false, (cx) => this.replace(true, cx)))
        .child(div().flex_1())
        .when(this.size.width > 560, (el) => el.child(hint("enter", "replace")).child(hint(appWindow()?.platform === "macos" ? "⌘enter" : "ctrl-enter", "all")))))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }

  body(t, code) {
    if (this.state === "error") return this.note(t, "Can't edit this file", this.error);
    if (this.state === "loading") return this.note(t, "Reading…", null);
    const text = div().id("editor-body").relative().flex_1().min_h(0).min_w(0).pl(GUTTER_INSET)
      .when(this.state === "missing", (el) => el.child(div().absolute().top(6).right(14).text_color(t.dim).child("new file: cmd-s creates it")))
      .child(Editor.new(this.editor).size_full().font_family(code));
    if (this.markdown && this.view === "rendered") return this.renderedView(t);
    if (!this.markdown || this.view === "text") return text;
    if (this.view === "preview") return this.previewView(t);
    const side = this.size.width >= SIDE_BY_SIDE;
    const rule = div().relative().flex_none().when(side, (el) => el.w(1).h_full()).when(!side, (el) => el.h(1).w_full()).child(dither(t.ansi8, 1));
    // A plain row: h_flex centers its children, which would leave them no height.
    return (side ? div().flex().flex_row() : div().flex().flex_col()).id("editor-split").flex_1().min_h(0).min_w(0)
      .child(text).child(rule).child(this.previewView(t));
  }

  note(t, title, detail) {
    return v_flex().flex_1().min_h(0).items_center().justify_center().gap(10).px(16)
      .child(svg("mods/nocturne/art/moon-8.svg").w(44).h(44).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child(title))
      .when(!!detail, (el) => el.child(div().text_center().text_color(t.ansi8).child(detail)));
  }

  drawerView(t) {
    const sevColor = { error: t.ansi1, warning: t.ansi3, info: t.ansi4, hint: t.dim };
    const at = this.editor.cursor();
    const s = this.server;
    const empty = !this.problems.length;
    return v_flex().id("editor-problems").h(DRAWER).flex_none().border_t(1).border_color(t.ansi0)
      .child(h_flex().relative().h(ROW).flex_none().px(12).gap(12).items_center().text_color(t.muted)
        .child(div().text_color(t.foreground).child("PROBLEMS"))
        .child(div().text_color(t.dim).child(`${this.problems.length}`))
        .child(div().relative().flex_1().h(1).opacity(0.6).child(dither(t.ansi8, 1)))
        .child(h_flex().gap(4).child(div().text_color(t.accent).child(this.vimOn() ? "]d" : "cmd-k n")).child(div().text_color(t.dim).child("next"))))
      .child(empty
        ? div().px(12).py(8).text_color(t.dim).child(s?.status === "ready" ? "No problems." : s?.note ?? (s?.status === "starting" ? "The language server is starting…" : "No language server for this file."))
        : div().id("problems-list").flex_1().min_h(0).overflow_y_scrollbar().children(this.problems.map((d, i) => {
          const sel = d.line === at.line;
          const color = sevColor[d.severity];
          return h_flex().id(`problem-${i}`).relative().h(ROW).flex_none().px(12).gap(10).items_center().text_color(t.muted)
            .hover((s) => s.bg(t.ansi0 + "55"))
            .on_click((_e, cx) => { this.goto(d.line, d.col, cx); cx.notify(); })
            .when(sel, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
            .child(div().relative().size(7).flex_none().border(1).border_color(color).child(dither(color, 1)))
            .child(div().relative().w(54).flex_none().text_color(t.dim).child(`${d.line + 1}:${d.col + 1}`))
            .child(div().relative().flex_1().min_w(0).truncate().text_color(t.foreground).child(d.message.split("\n")[0]))
            .child(div().relative().flex_none().text_color(t.dim).child([d.code, d.source].filter(Boolean).join(" · ")));
        })));
  }

  hints(t) {
    if (this.look) return this.lookHints(t);
    const list = hintList({ mode: this.mode, vim: this.vimOn(), vimMode: this.vim.mode, server: this.server?.id != null, markdown: this.markdown, view: this.view });
    // The keys entry (the last) is keyhelp.ts's: its key is the chord that opens it here.
    const help = list.at(-1)?.[1] === "keys" ? list.at(-1) : null;
    const rest = help ? list.slice(0, -1) : list;
    return h_flex().id("editor-hints").relative().h(HINTS).flex_none().px(10).gap(14).items_center().overflow_hidden()
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
      .children(rest.map(([k, what], i) => hint(t, `editor-hint-${i}`, k, what)))
      .when(Boolean(help), (el) => el.child(div().flex_1()).child(keysHint(t, "editor-hint-keys", Boolean(this.keysShown), () => this.toggleKeys(!this.keysShown), help[0])));
  }

  /** A drawn tab's body: the viewer, the pane's keys (lookKey). */
  lookView(t) {
    return div().id("editor-look").relative().flex_1().min_h(0).min_w(0).flex().flex_col()
      .track_focus(this.lookHandle)
      .on_key_down((e, cx) => this.lookKey(e, cx))
      .on_mouse_down("left", () => this.lookHandle.focus())
      .child(this.viewer ? div().flex_1().min_h(0).child(this.viewer) : this.note(t, "Opening…", null));
  }

  /** A drawn tab's hints along the bottom: each one a button too. */
  lookHints(t) {
    const d = this.cur;
    const list = [
      ...(this.allDocs().length > 1 ? [["H L", "tabs", "next-tab"]] : []),
      ...(d.kind === "either" ? [["e", "text", "text"]] : []),
      ["p", "preview pane", "pane"], ["o", "open", "system"], ["y", "path", "copy"], ["d", "close", "close"],
    ];
    return h_flex().id("editor-hints").relative().h(HINTS).flex_none().px(10).gap(14).items_center().overflow_hidden()
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
      .children(list.map(([k, what, act], i) => h_flex().id(`editor-look-hint-${i}`).flex_none().gap(4).items_center().text_color(t.dim)
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { this.lookAct(act, cx); cx.notify(); })
        .child(div().text_color(t.accent).child(k)).child(div().child(what))))
      .child(div().flex_1())
      .child(keysHint(t, "editor-hint-keys", Boolean(this.keysShown), () => this.toggleKeys(!this.keysShown), "?"));
  }

  /** Opens or closes the keys overview; it holds the keyboard while open, the file gets it back after. */
  toggleKeys(on) {
    this.keysShown = on;
    if (on) this.keysHandle.focus();
    else if (this.look) this.lookHandle.focus();
    else if (this.view === "preview") this.previewHandle.focus();
    else if (this.view === "rendered" && this.cur?.rendered) this.cur.rendered.focus();
    else this.editor.focus();
  }

  /** The keys entry (space ? / cmd-k ?): every key, in the file's place (keyhelp.ts); ? esc q close it. */
  keysStrip(t) {
    return div().id("editor-keys-host").absolute().top(0).left(0).size_full().track_focus(this.keysHandle)
      .on_key_down((e, cx) => {
        const k = keysKey(e, true);
        if (k) this.toggleKeys(false);
        cx.stop_propagation();
        cx.notify();
      })
      .child(keysView(t, { id: "editor-keys", title: this.vimOn() ? "editor · vim" : "editor", list: this.look ? LOOK_KEYS : editorKeys(this.vimOn()), close: () => this.toggleKeys(false) }));
  }

  /** Highlighted code, line by line, in the card: colored once per answer
   *  (kept on the part), not at every frame. */
  codeBlock(t, part, lang, code) {
    if (!part.lines) {
      const text = part.code;
      const spans = lang ? highlight(text, lang) : [];
      part.lines = [];
      let at = 0;
      for (const line of text.split("\n")) {
        const end = at + line.length;
        const mine = spans.filter(([s, e]) => e > at && s < end).map(([s, e, n]) => [Math.max(s, at) - at, Math.min(e, end) - at, n]);
        part.lines.push(colorRuns(line, mine, this.colors));
        at = end + 1;
      }
    }
    return v_flex().px(12).py(8).font_family(code).text_size(12).children(part.lines.slice(0, 200).map((runs, i) =>
      h_flex().id(`card-code-${i}`).flex_wrap().children(runs.map(([piece, color], j) =>
        div().id(`card-run-${i}-${j}`).text_color(color ?? t.foreground).child(piece)))));
  }

  /** The card's links under its text: an arrow for where it goes (↗ the web,
   *  → a file), its words, and the host or file:line; the ringed one (tab)
   *  wears the dialogs' ring, enter follows it; a click follows any. */
  cardLinksView(t, c) {
    const list = c.links.slice(0, 12);
    return v_flex().id("card-links").relative().px(8).pt(6).pb(8).gap(1)
      .child(h_flex().relative().h(16).px(4).gap(8).items_center().text_size(10).text_color(t.dim)
        .child(div().flex_none().child("LINKS"))
        .child(div().relative().flex_1().h(1).opacity(0.6).child(dither(t.ansi8, 1)))
        .when(c.links.length > list.length, (el) => el.child(div().flex_none().child(`${list.length} of ${c.links.length}`))))
      .children(list.map((l, i) => {
        const to = linkTarget(l.url, this.path), on = c.link === i;
        const color = to?.kind === "web" ? t.ansi4 : to?.kind === "file" ? t.ansi5 : t.dim;
        return h_flex().id(`card-link-${i}`).relative().h(20).px(4).gap(8).items_center().border(1)
          .border_color(on ? t.accent : t.background).text_color(on ? t.foreground : t.muted)
          .when(on, (el) => el.bg(t.ansi0))
          .hover((s) => s.text_color(t.foreground).border_color(t.ansi0))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => this.followLink(l.url, cx))
          .child(div().flex_none().w(12).text_color(color).child(to?.kind === "web" ? "↗" : to?.kind === "file" ? "→" : "·"))
          .child(div().flex_1().min_w(0).truncate().child(l.label))
          .child(div().flex_none().max_w(200).truncate().text_color(t.dim).child(linkWhere(to)));
      }));
  }

  /** How far down the pane the text starts: the bar, and whatever lines sit
   *  between it and the text (a conflict, find / replace, vim's ex line). */
  textTop() {
    return this.stripH() + BAR + (this.asking ? FIND : 0) + (this.conflict ? FIND : 0) + (this.mode === "replace" ? 2 * FIND : this.mode ? FIND : 0) + (this.vim.ex != null ? FIND : 0);
  }

  /** The card's word in pane coordinates (unzoomed), from where the editor
   *  last drew it; null when it's off screen. */
  cardAnchor(c) {
    const b = this.editor.bounds?.({ line: c.line, col: c.col });
    if (!b?.view) return null;
    const z = zoom();
    const x = (b.x - b.view.x) / z, y = (b.y - b.view.y) / z, h = b.height / z;
    // Scrolled out of the text's own box: it waits there until the word is back.
    if (y + h < 0 || y > b.view.height / z) return null;
    return { x: x + GUTTER_INSET, y: y + this.textTop(), w: b.width / z, h };
  }

  /** The card, at its word: under it, or above it near the pane's foot;
   *  null while there's nothing to show (a pointer's card still waiting) or
   *  its word is off screen. */
  cardView(t, code) {
    const c = this.card;
    const waiting = c.pending && !c.problems.length;
    if (!this.cardShown(c)) return null;
    const anchor = this.cardAnchor(c);
    if (!anchor) return null;
    if (c.keyboard && !c.drawn) { c.drawn = true; this.mark(`card drawn ${Date.now() - c.opened}ms after it was asked${c.pending ? `, waiting: ${this.waitWords()}` : ""}`); }
    const footH = 24;
    // The pane's size comes in window pixels (zoomed); the card is placed in layout units.
    const z = zoom();
    const place = cardPlace(anchor, { width: this.size.width / z, height: this.size.height / z }, { width: CARD_W }, { top: this.stripH() + BAR, bottom: HINTS });
    const sevColor = { error: t.ansi1, warning: t.ansi3, info: t.ansi4, hint: t.dim };
    const lang = this.lang === "tsx" ? "typescript" : this.lang;
    const parts = c.parts.map((p, i) => p.code != null
      ? this.codeBlock(t, p, p.lang ? (languageOf(p.lang) ?? lang) : lang, code)
      : div().id(`card-text-${i}`).px(12).py(8).text_color(t.muted)
        .child(TextView.markdown(`card-md-${i}`, p.md ??= cardMarkdown(p.text)).on_link_click((url, cx) => this.followLink(url, cx))));
    const expandable = (lang === "typescript" || lang === "javascript") && c.parts.length > 0;
    const ctrl = (id, label, on, go) => div().id(id).flex_none().w(18).h(18).flex().items_center().justify_center().border(1)
      .border_color(on ? t.ansi0 : t.background).text_color(on ? t.foreground : t.dim)
      .when(on, (el) => el.hover((s) => s.border_color(t.accent)).on_click((_e, cx) => { go(cx); cx.notify(); })).child(label);
    const key = (k, what) => h_flex().flex_none().gap(4).child(div().text_color(t.accent).child(k)).child(div().child(what));
    const vim = this.vimOn();
    const overflow = this.cardOverflows();
    // What the card holds: its problems, what it waits for or why there's
    // nothing, and the server's answer; scrolled by its own offset (keys, wheel).
    const content = v_flex().id("card-content").relative().top(-(c.scroll ?? 0)).flex_none()
      .on_size_change((size, cx) => { const h = size.height / zoom(); if (Math.abs((c.contentH ?? -1) - h) > 0.5) { c.contentH = h; cx.notify(); } })
      .children(c.problems.map((d, i) => v_flex().id(`card-problem-${i}`).relative().border_b(1).border_color(t.ansi0)
        .child(div().absolute().left(0).right(0).top(0).h(3).child(dither(sevColor[d.severity], 1)))
        .child(div().px(12).pt(9).pb(4).text_size(11.5).text_color(t.foreground).font_family(code).child(d.message))
        .when(d.related.length > 0, (el) => el.children(d.related.slice(0, 4).map((r, j) => div().id(`card-rel-${i}-${j}`).px(12).text_color(t.dim)
          .child(`${r.path ? basename(r.path) : ""}:${r.line + 1}  ${r.message}`))))
        .child(h_flex().px(12).pb(8).gap(12).text_size(10).text_color(t.dim)
          .child(div().text_color(sevColor[d.severity]).child(d.severity))
          .child(div().child([d.code, d.source].filter(Boolean).join(" · "))))))
      .when(c.pending && c.keyboard, (el) => el.child(h_flex().id("card-wait").px(12).py(8).gap(8).items_center()
        .child(div().relative().size(6).flex_none().child(dither(t.ansi3, 1)))
        .child(div().flex_1().min_w(0).text_color(t.dim).child(this.waitWords()))))
      // No answer to give: what's the case, and what to do about it.
      .when(Boolean(c.note), (el) => el.child(v_flex().id("card-note").px(12).py(8).gap(4)
        .child(div().text_color(t.foreground).child(c.note.text))
        .when(Boolean(c.note.fix), (e2) => e2.child(div().text_color(t.dim).child(c.note.fix)))))
      .children(parts)
      .when((c.links ?? []).length > 0, (el) => el.child(this.cardLinksView(t, c)));
    const box = v_flex().id("editor-card").absolute().left(place.left).w(place.width).max_h(place.maxH)
      .bg(t.background).border(1).border_color(waiting ? t.ansi8 : t.ansi0).shadow_lg().overflow_hidden()
      .on_hover((h, cx) => { this.overCard = h; if (!h && !c.keyboard) cx.timer.after(250, (cx) => { if (!this.overCard && this.card === c) { this.card = null; cx.notify(); } }); })
      .on_mouse_down("left", stop)
      .child(div().id("card-scroll").relative().min_h(0).overflow_hidden()
        .on_size_change((size, cx) => { const h = size.height / zoom(); if (Math.abs((c.viewH ?? -1) - h) > 0.5) { c.viewH = h; cx.notify(); } })
        .on_scroll_wheel((e, cx) => {
          if (!this.cardOverflows()) return;
          c.scroll = Math.max(0, Math.min(c.contentH - c.viewH, (c.scroll ?? 0) - (e.delta?.y ?? 0) / zoom()));
          cx.stop_propagation();
          cx.notify();
        })
        .child(content))
      // Its keys, and how it closes.
      .child(h_flex().id("card-foot").h(footH).flex_none().px(12).gap(12).items_center().overflow_hidden().border_t(1).border_color(t.ansi0).text_size(10).text_color(t.dim)
        // The server's name, unless the type depth needs the room.
        .when(c.parts.length > 0 && !expandable, (el) => el.child(div().flex_none().child(this.server?.name ?? "")))
        .when(expandable, (el) => el
          .child(ctrl("card-less", "−", c.level > 0, (cx) => this.hoverLevel(-1, cx)))
          .child(div().flex_none().child(`type depth ${c.level}`))
          .child(ctrl("card-more", "+", c.more, (cx) => this.hoverLevel(1, cx)))
          .child(div().flex_none().text_color(t.accent).child("ctrl-−/=")))
        .when(c.parts.length > 0 && this.server?.id != null, (el) => el.child(key(vim ? "gd" : "cmd-k d", "definition")))
        .when(c.keyboard && (c.links ?? []).length > 0, (el) => el.child(key("tab", "links")))
        .when(overflow, (el) => el.child(key("ctrl-d ctrl-u", "scroll")))
        .child(div().flex_1())
        .child(key("esc", "close")));
    return place.above ? box.bottom(place.bottom) : box.top(place.top);
  }
}

// What each tab keeps for its file (newDoc): the pane's `this.path`,
// `this.editor`, `this.dirty`, ... are the shown tab's. Methods that run for a
// tab in the background (reading, watching, saving, its server) take the tab.
export const TAB_FIELDS = ["path", "firstPath", "lang", "opts", "openedAt", "deleted", "saved", "state", "error", "dirty", "conflict",
  "problems", "server", "version", "sent", "progress", "hovers", "text", "find", "searchMark", "markdown", "preview", "images",
  "view", "driver", "previewDrove", "previewDue", "flushDue", "lastWork", "watchGen", "editor", "softWrap",
  "rendered", "scratch", "autosave", "saveState", "writing", "previewStale", "kind", "look", "watched"];
for (const f of TAB_FIELDS) {
  Object.defineProperty(EditorPane.prototype, f, {
    configurable: true,
    // A pane put together without init (the tests) gets one tab on first use.
    get() { return (this.cur ??= {})[f]; },
    set(v) { (this.cur ??= {})[f] = v; },
  });
}
