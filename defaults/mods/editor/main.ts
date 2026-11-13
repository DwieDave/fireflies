// Nocturne editor: files, edited, in a pane beside where it was opened
// from: a source link clicked in a terminal (`path:42:7` goes there), a file
// picked in the files pane or the picker (cmd-p, cmd-shift-f), an "edit" in the
// Markdown viewer or the preview, or `editor.open {path, line?, col?}`.
// Props: { path, line?, col?, on?, slot } (the file it opened on).
//
// File tabs: the pane holds several files, a tab each on the strip along its
// top (tabs.ts decides placement, closing, labels, what fits); with one file
// the strip isn't drawn and the bar names it with its unsaved mark. Drag a
// tab along the strip to move it (it lifts, a stake marks where it lands),
// or ]B / [B, :tabm, space b < / >, move-tab-left / -right. Each tab is a
// record (newDoc) with its own code editor (text, undo, caret, scroll), what's
// on disk, unsaved changes, server document, problems and Markdown preview;
// `this.path`, `this.editor`, ... are the shown tab's (tab-fields.ts TAB_FIELDS),
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
// preview's viewer (viewer.ts, embedded: its slim bar, no keys of its own; a
// copy of preview's), the pane taking the keys (H / L, j / k scroll,
// e as text, p the preview pane, o the system's app, y the path, d close).
// Tables, patches and SVG switch between drawn and text (e, the bar's
// "drawn" chip, cmd-shift-v). A file opened to be looked at (a files pane's
// open, a terminal's link: `look`) starts drawn, a Markdown file in its
// preview; an edit opens the text.
//
// Links in the hover card (cardlinks.ts) open on a click, and a keyboard
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
// PATH, envrc.ts; or settings.json's `editor.languages.<id>.server`), is
// shared by every editor of that workspace, and stops a while after the last
// closes. Saving writes only if the file is still what was read (otherwise
// it says so); a change on disk reloads a clean file and offers a choice to
// an edited one. Closing an edited editor asks first.
//
// Markdown files get a live preview beside the text (under it when the pane
// is narrow; each tab keeps its view, an "edit" from the viewer turns it on), drawn as it's typed by the Markdown viewer's renderer
// (markdown.ts): math, mermaid, colored code, tables, callouts, footnotes,
// local images. It follows the text's scrolling and the text follows it;
// ticking a task box writes the [x] into the text; links go where they point
// (a heading in it, another .md file in the editor). The bar's chip, cmd-shift-v
// and space m p go split -> preview -> text; space m s / m v / m t pick one.
//
// Rendered (rendered.ts, live.ts): the fourth Markdown view, the document
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
// Pictures (images.ts): in a Markdown file (rendered or text view) a pasted
// picture (cmd-v of a screenshot: the editor's paste_other; of a copied image
// file: its name is the clipboard's text, so cmd-v asks the clipboard first;
// vim's p in normal mode when the clipboard has no text) is saved beside the
// file (assets/<name>-<time>.png; a scratchpad's in <note>-assets/) and put
// in as an image block after the caret's block, one undoable edit (undo
// leaves the file). The clipboard's image is read with the system's tool
// (osascript, wl-paste / xclip, PowerShell): the app hands mods text only.
// md-image picks a file (the system's picker; a relative path), md-image-paste
// pastes; cmd-. p / v.
// The Markdown commands (mdedit.ts) in every view but preview only: cmd-.
// (vim: space .) or the bar's "markdown" chip opens their list, a letter or a
// click runs one (b i ` k h H l n t x q c r, 0-6); commands md-<name>, md-menu.
//
// The scratchpad (scratch.ts): a tab on a note under `<app home>/scratchpad/`
// opens rendered, saves itself 600 ms after the typing and at once on close
// (never unsaved, never asks), titles itself "Scratchpad · <repo>"; its pane
// sends other files to an editor beside it (editor-route.ts skips it).
// nocturne.scratchpad opens it.
//
// Vim (vim.ts): new editors start as settings.json `editor.vim` says (default
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
//
// This file holds the pane's state, init, render and the methods others call
// (tests, callbacks, the parts below where an import would go in a circle);
// the work is in its parts, functions over the pane: pane-start.ts (init's
// steps, what render answers), pane-frame.ts (the frame drawn), pane-tabs.ts,
// tab-menu.ts, drawn-tabs.ts, file-io.ts, lsp-client.ts, card.ts,
// card-view.ts, find.ts, pane-vim.ts, pane-commands.ts, md-pane.ts,
// preview-pane.ts, pane-bar.ts, pane-lines.ts; what they share is pane-kit.ts's,
// the shown tab's fields tab-fields.ts's.

import { openTabs, runLoops, startFields, watchShared } from "./pane-start.ts";
import { paneFrame } from "./pane-frame.ts";
import type { EditorView } from "./editor-route.ts";
import type { Guard } from "./guard.ts";
import type { Bound, ServerNote, SyntaxColors } from "./logic.ts";
import type { Problem, ProgressParams } from "./lsp-replies.ts";
import type { Picture } from "./rendered.ts";
import type { Gap, MenuItem } from "./tabs.ts";
import type { Doc as VimDoc } from "./vim.ts";
import { createVim } from "./vim.ts";
import type { EditorHoverEvent, InputState as InputStateT } from "gpui-base";
import type { AsyncContext, Context, Element, Entity, FocusHandle, KeyEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import type { Theme } from "herdr";
import { props, theme } from "herdr";
import type { Answer, Card, Doc, Go, LspExtra, PaneProps, ViewerPropsNow } from "./pane-kit.ts";
import { isPaneProps, serverId } from "./pane-kit.ts";
import { cardLinksView, cardView, textTop } from "./card-view.ts";
import { cardState, closeCard, followLink, later, onHover, serverNoteOf, showCard } from "./card.ts";
import { lookHints, lookKeyDown, openLooked } from "./drawn-tabs.ts";
import { followChanges, loadDoc, onChanged, save, saveNow, say, setTitle, watch } from "./file-io.ts";
import { findKey, gotoPlace, replaceFound, step } from "./find.ts";
import { definitionNow, onProgress, request, setProblems, startServer } from "./lsp-client.ts";
import { focusText, mdMenuView, renderedView, tickRendered } from "./md-pane.ts";
import { bar, stripH, tabStrip } from "./pane-bar.ts";
import { command } from "./pane-commands.ts";
import { askLine, bodyView, hints, keysStrip, noteView, toggleKeys } from "./pane-lines.ts";
import { closeTab, leave, openFile, ownPane, popIn, popOut, select, stepMove, stepShownTab } from "./pane-tabs.ts";
import { setWrap, vimCommand, vimDoc, vimKey, vimOn, vimSettled } from "./pane-vim.ts";
import { closePane, imageOf, previewLink, setView, tick } from "./preview-pane.ts";
import { closeTabMenu, openTabMenu, tabMenuKeyDown, tabMenuView } from "./tab-menu.ts";
import { TabFields } from "./tab-fields.ts";


/** The tab menu: its tab, the marked entry, the entries. */
interface TabMenu {
  readonly index: number;
  at: number;
  readonly items: readonly MenuItem[];
}

/** A tab dragged along the strip: from where, the gap it's over, off the strip. */
interface TabDrag {
  readonly from: number;
  gap: Gap | null;
  out: boolean;
}

export default class EditorPane extends TabFields {
  on: string | null = null;

  slot: string | null = null;

  /** Renamed, moved or deleted from the files pane (follow.ts): only what comes after this start counts. */
  seenChange = 0;

  /** Files sent here as tabs (editor-route.ts): only requests after this start. */
  seenOpen = 0;

  seenGoto: number | null = null;

  drawer = false;

  mode: "find" | "replace" | "line" | null = null;

  caseSensitive = false;

  findAt = "find";

  // The hover card: { line, col, keyboard, problems, parts, level, more, pending, note, scroll, link }.
  // It sits at its place in the text (editor.bounds), under the word or above it.
  card: Card | null = null;

  overCard = false;

  size = { width: 800, height: 600 };

  /** A short note in the bar (saved, reloaded, an error). */
  message: { readonly text: string; readonly bad: boolean; readonly at: number } | null = null;

  /** Closing a tab with unsaved changes: { doc, at } (the question's line). */
  asking: { readonly doc: Doc; at: Answer } | null = null;

  /** A press on a tab, and the drag it became (tabs.ts). */
  tabPress: { readonly index: number; readonly x: number } | null = null;

  tabDrag: TabDrag | null = null;

  /** The tab's menu. */
  tabMenu: TabMenu | null = null;

  /** Where each drawn tab starts on the strip (px, unzoomed): the tab menu opens under it. */
  tabX: ((i: number) => number) | null = null;

  menuHandle: FocusHandle | null = null;

  /** The servers this pane hears (one queue per server for every tab). */
  listening = new Set<number>();

  handle: FocusHandle | null = null;

  vim = createVim();

  /** The leader's next keys. */
  which: { readonly key: string; readonly label: string }[] | null = null;

  /** Keys typed toward a command. */
  pending = "";

  /** This pane's own vim switch, if it was flipped here before. */
  paneVim: boolean | null = null;

  vimWas: boolean | null = null;

  colors: SyntaxColors | null = null;

  /** Markdown: how the preview shows (the pane remembers; each tab keeps its own after). */
  defaultView: EditorView = "split";

  previewHandle: FocusHandle | null = null;

  /** A drawn tab: the pane's keys while it shows, and the viewer's props (one viewer, the shown tab's file). */
  lookHandle: FocusHandle | null = null;

  viewerProps: ViewerPropsNow = { embedded: true, path: null, on: null, scroll: null, reload: 0 };

  viewer: Entity | null = null;

  lookPending = "";

  scrollN = 0;

  /** The keys overview takes the keyboard while it's open (? would type into the file). */
  keysHandle: FocusHandle | null = null;

  keysShown = false;

  findInput: InputStateT | null = null;

  replaceInput: InputStateT | null = null;

  lineInput: InputStateT | null = null;

  /** The tabs, and the shown one. */
  docs: Doc[] = [];

  /** The app's keys over the editor's, read again after a few seconds. */
  appKeys: { readonly at: number; readonly map: ReadonlyMap<string, Bound> } | null = null;

  /** The Markdown commands' list, open since. */
  mdMenu: { readonly at: number } | null = null;

  /** The context of the last change, for the autosave's timer. */
  timerCx: Context | null = null;

  /** The preview's own leader (space m …) and gg. */
  leaderAt = 0;

  leaderKeys = "";

  gAt = 0;

  /** vim's p let through to vim (no picture on the clipboard). */
  imagePassP = false;

  redrawSoon = false;

  override init(p: Props | undefined, cx: AsyncContext): void {
    const raw = props() ?? p;
    const pr: PaneProps = isPaneProps(raw) ? raw : {};

    startFields(this, pr, cx);
    openTabs(this, pr, cx);
    runLoops(this, cx);
  }

  /** Every file record (a pane built without init has the one it was given). */
  allDocs(): Doc[] {
    return this.docs.length ? this.docs : this.cur ? [this.cur] : [];
  }

  /** Shows tab `d`: the card, find line and vim's pending keys go; read the
   *  first time; `go` { line, col } (one-based) puts the caret there. */
  select(d: Doc, cx: Context, go: Go | null = null, first = false): void {
    select(this, d, cx, go, first);
  }

  /** Opens `path` here as a tab (the one showing it, if open) and shows it;
   *  `line` / `col` one-based; `view` a Markdown file's view, or "preview" /
   *  "text" for a table, patch or SVG (drawn or as text); `look`: opened to be
   *  looked at (a new tab of a picture or table starts drawn). */
  openFile(path: string, cx: Context, at: { readonly line?: number | null; readonly col?: number | null; readonly view?: EditorView | null; readonly look?: boolean } = {}): void {
    openFile(this, path, cx, at);
  }

  /** Tab `d` into a new editor pane of its own: beside this one (`where`
   *  "beside"), or in a new tab of the window ("tab"); what it had goes with
   *  it (handover) and it leaves this strip without asking (its unsaved text
   *  went too). The last tab popping out closes this pane. */
  popOut(cx: Context, d: Doc | null = this.cur, where: "beside" | "tab" = "beside"): void {
    popOut(this, cx, d, where);
  }

  /** The shown tab into another editor of this window's tab, as a tab there
   *  (the one that last had the keyboard, else the first): what it had goes
   *  with it; this pane closes when it was its last tab. */
  popIn(cx: Context, d: Doc | null = this.cur): void {
    popIn(this, cx, d);
  }

  /** Tab `d` goes from here without asking: it lives on elsewhere. */
  leave(cx: Context, d: Doc): void {
    leave(this, cx, d);
  }

  /** Opens the menu of tab `index` (the shown one by default): a right-click
   *  on it, space b m, the tab-menu command. */
  openTabMenu(cx: Context, index = this.docs.indexOf(this.shown())): void {
    openTabMenu(this, cx, index);
  }

  closeTabMenu(cx: Context, refocus = true): void {
    closeTabMenu(this, cx, refocus);
  }

  tabMenuKeyDown(e: KeyEvent, cx: Context): void {
    tabMenuKeyDown(this, e, cx);
  }

  /** The menu, under its tab on the strip (at the bar's left with one tab). */
  tabMenuView(t: Theme): Element {
    return tabMenuView(this, t);
  }

  /** A key on a drawn tab (tabs.ts lookAction): tabs, scrolling, as text,
   *  the preview pane, the system's app, the path, close, the keys. */
  lookKey(e: KeyEvent, cx: Context): void {
    lookKeyDown(this, e, cx);
  }

  /** A file a link points at (a card's, the Markdown preview's, a drawn
   *  picture's): drawn kinds as a drawn tab here, another machine's in the
   *  preview beside (the viewer reads only this computer's pictures). */
  openLooked(path: string, cx: Context): void {
    openLooked(this, path, cx);
  }

  /** The next (1) or previous (-1) tab. */
  stepTab(dir: number, cx: Context): void {
    stepShownTab(this, dir, cx);
  }

  /** The shown tab one place right (1) or left (-1); `:tabm`'s "N", "+N",
   *  "-N" or "$" (the end) as `spec`. */
  stepMove(dir: number, cx: Context, spec: string | null = null): void {
    stepMove(this, dir, cx, spec);
  }

  /** Closes tab `d` (the shown one by default): with unsaved changes it
   *  asks first (the question's line: save, discard, keep), unless
   *  `confirmed`. The last tab closes the pane. */
  closeTab(cx: Context, d: Doc | null = this.cur, confirmed = false): void {
    closeTab(this, cx, d, confirmed);
  }

  /** This copy's own pane (found by its slot). */
  me(): { readonly pane: string; readonly tab: string } | null {
    return ownPane(this);
  }

  /** The pane header's name (nocturne/header.ts): the shown tab's. */
  title(): void {
    setTitle(this);
  }

  /** Acts on the change record's entries newer than the last seen, for every
   *  tab (from a task, never a render). */
  followChanges(cx: Context): void {
    followChanges(this, cx);
  }

  /** Reads tab `d`'s file; `go`: the place to put the caret after. `quiet`: a
   *  poll or a change on disk, which leaves an edited buffer alone. */
  load(cx: Context, go: Go | null, quiet: boolean, d: Doc = this.shown()): void {
    loadDoc(this, cx, go, quiet, d);
  }

  /** Waits for tab `d`'s folder to change, and reads its file again. */
  watch(cx: Context, d: Doc = this.shown()): void {
    watch(this, cx, d);
  }

  changed(cx: Context, d: Doc = this.shown()): void {
    onChanged(this, cx, d);
  }

  save(cx: Context): Promise<void> {
    return save(this, cx);
  }

  saveNow(cx: Context, d: Doc = this.shown()): Promise<void> {
    return saveNow(this, cx, d);
  }

  say(text: string, bad = false): void {
    say(this, text, bad);
  }

  /** Starts (or joins) tab `d`'s language server as it opens, so it is warm
   *  by the time anything is asked: the project's environment from disk when
   *  nothing it depends on changed (envrc.ts), the lookups side by side, then
   *  herdr's session for this server and workspace (one per project: every
   *  tab and editor of it shares it). `fresh`: the kept environment's server
   *  is gone (garbage-collected): load it anew. */
  startServer(cx: Context, fresh = false, d: Doc = this.shown()): Promise<void> {
    return startServer(this, cx, fresh, d);
  }

  /** The server's work under way, for the bar ("indexing 120/340") and a
   *  waiting card, which asks again once the work answers wait on is done.
   *  `id`: the server (default: the shown tab's). */
  progressed(params: ProgressParams, cx: Context, id: number | null = serverId(this.cur?.server)): void {
    onProgress(this, params, cx, id);
  }

  setProblems(list: Problem[], d: Doc = this.shown()): void {
    setProblems(this, list, d);
  }

  /** A question about a place (the caret by default). `key`: a newer question
   *  with the same key cancels this one at the server (herdr's lspRequest). */
  request<T>(method: string, guard: Guard<T>, extra: LspExtra = {}, line: number | null = null, col: number | null = null, key: string | null = null): Promise<T | null> {
    return request(this, method, guard, extra, line, col, key);
  }

  definitionNow(cx: Context): Promise<void> {
    return definitionNow(this, cx);
  }

  hovered(e: EditorHoverEvent, cx: Context): void {
    onHover(this, e, cx);
  }

  /** The card for a place: its problems at once, the server's hover when it
   *  answers. `keyboard`: asked for (cmd-i, K, a problem gone to); the
   *  pointer's card says nothing when there's nothing to say. */
  showCard(line: number, col: number, keyboard: boolean, cx: Context, level = 0): void {
    showCard(this, line, col, keyboard, cx, level);
  }

  /** The card's question, as the server stands: answered from what's known,
   *  asked, or waiting (with what it waits for) until the server can answer;
   *  called again when it can (started, done indexing, stopped). */
  cardState(cx: Context): void {
    cardState(this, cx);
  }

  closeCard(cx: Context | null): void {
    closeCard(this, cx);
  }

  /** Why the hover has nothing (logic.ts serverNote), the paths as ~. */
  serverNote(empty = false): ServerNote | null {
    return serverNoteOf(this, empty);
  }

  /** A link from the hover card: a web page in the shown tab's browser pane
   *  (a new one beside this editor when there's none), a file as a tab of
   *  this editor at its line (a picture, a PDF: the preview beside), mailto:
   *  and the like through the system. */
  followLink(url: string, cx: Context): void {
    followLink(this, url, cx);
  }

  /** Runs `work` in a task: its cx lasts past an await, where an editor
   *  event's (a key, a click) refuses notify and timers once that call has
   *  returned. Resolves with what `work` returns. */
  later<T>(cx: Context, work: (cx: AsyncContext) => Promise<T> | T): Promise<T> {
    return later(this, cx, work);
  }

  goto(line: number, col: number, cx: Context): void {
    gotoPlace(this, line, col, cx);
  }

  step(d: number, cx: Context): void {
    step(this, d, cx);
  }

  replace(all: boolean, cx: Context): void {
    replaceFound(this, all, cx);
  }

  /** A key on the find line, as every form takes them (form-keys.ts): tab /
   *  shift-tab walk its fields and chips, wrapping; space / enter press a
   *  chip (Aa flips); a field keeps its own enter (next, or replace). */
  findKey(e: KeyEvent, cx: Context): void {
    findKey(this, e, cx);
  }

  /** Vim in this pane: its own switch when flipped (remembered for the pane),
   *  else settings.json's default `editor.vim` (on unless false). */
  vimOn(): boolean {
    return vimOn(this);
  }

  /** Word wrap on or off in the shown tab (cmd-k z, space u w, :set wrap, the bar's chip). */
  setWrap(on: boolean | null, cx: Context): void {
    setWrap(this, on, cx);
  }

  /** Vim's state when it's turned on or off. */
  vimSettled(on: boolean): void {
    vimSettled(this, on);
  }

  /** A keystroke, before the editor sees it: vim's, or the editor's (false). */
  vimKey(e: KeyEvent, cx: Context): boolean {
    return vimKey(this, e, cx);
  }

  /** The text as vim acts on it (vim.ts Doc): the text, the caret, the clipboard, the screen, the tabs. */
  doc(cx: Context): VimDoc {
    return vimDoc(this, cx);
  }

  vimCommand(c: string, cx: Context): void {
    vimCommand(this, c, cx);
  }

  command(c: string, cx: Context): void {
    command(this, c, cx);
  }

  /** The keyboard to the shown tab's text: the rendered view's block, else the code editor. */
  focusText(): void {
    focusText(this);
  }

  /** A task box clicked in the rendered view: [ ] <-> [x], one undoable edit. */
  tickRendered(line: number, cx: Context): void {
    tickRendered(this, line, cx);
  }

  /** The rendered view of the shown tab. */
  renderedView(t: Theme): Element {
    return renderedView(this, t);
  }

  /** The Markdown commands' list, which-key style, by the lit block (rendered) or the bar. */
  mdMenuView(t: Theme): Element {
    return mdMenuView(this, t);
  }

  /** Split, preview only or text only: this tab's, and what the pane's new
   *  Markdown tabs start with (it remembers). */
  setView(view: EditorView, cx: Context): void {
    setView(this, view, cx);
  }

  image(src: string): Picture {
    return imageOf(this, src);
  }

  /** A preview link: a heading here, another Markdown file in the editor,
   *  pictures and the like in the preview pane, web pages as the app opens them. */
  previewLink(href: string, cx: Context): void {
    previewLink(this, href, cx);
  }

  /** A task box ticked in the preview: [ ] <-> [x] in the text, one undoable edit. */
  tick(line: number, cx: Context): void {
    tick(this, line, cx);
  }

  override close(): Promise<void> {
    return closePane(this);
  }

  override render(cx: Context): Element {
    watchShared(this, cx);

    return paneFrame(this, theme());
  }

  bar(t: Theme): Element {
    return bar(this, t);
  }

  /** The strip's height: none with one tab. */
  stripH(): number {
    return stripH(this);
  }

  tabStrip(t: Theme): Element {
    return tabStrip(this, t);
  }

  /** Closing a tab with unsaved changes asks here: save and close, discard, or keep. */
  askLine(t: Theme): Element {
    return askLine(this, t);
  }

  body(t: Theme, code: string): Element {
    return bodyView(this, t, code);
  }

  note(t: Theme, title: string, detail: string | null): Element {
    return noteView(this, t, title, detail);
  }

  hints(t: Theme): Element {
    return hints(this, t);
  }

  /** A drawn tab's hints along the bottom: each one a button too. */
  lookHints(t: Theme): Element {
    return lookHints(this, t);
  }

  /** Opens or closes the keys overview; it holds the keyboard while open, the file gets it back after. */
  toggleKeys(on: boolean): void {
    toggleKeys(this, on);
  }

  /** The keys entry (space ? / cmd-k ?): every key, in the file's place (keyhelp.ts); ? esc q close it. */
  keysStrip(t: Theme): Element {
    return keysStrip(this, t);
  }

  /** The card's links under its text: an arrow for where it goes (↗ the web,
   *  → a file), its words, and the host or file:line; the ringed one (tab)
   *  wears the dialogs' ring, enter follows it; a click follows any. */
  cardLinksView(t: Theme, c: Card): Element {
    return cardLinksView(this, t, c);
  }

  /** How far down the pane the text starts: the bar, and whatever lines sit
   *  between it and the text (a conflict, find / replace, vim's ex line). */
  textTop(): number {
    return textTop(this);
  }

  /** The card, at its word: under it, or above it near the pane's foot;
   *  null while there's nothing to show (a pointer's card still waiting) or
   *  its word is off screen. */
  cardView(t: Theme, code: string): Element | null {
    return cardView(this, t, code);
  }
}
