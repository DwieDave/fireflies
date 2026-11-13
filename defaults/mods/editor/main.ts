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


import type { AsyncContext, Color, Context, Element, Entity, FocusHandle, KeyEvent, MouseButtonEvent, MouseMoveEvent } from "gpui-kit";
import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import type { EditorFindState, EditorHoverEvent, EditorState as EditorStateT, InputState as InputStateT } from "gpui-base";
import { h_flex, v_flex, EditorState, Editor, InputState, Input, TextView } from "gpui-base";
import type { Props } from "gpui-shell";
import type { PaneInfo, Theme } from "herdr";
import {
  props, theme, settings, run, panes, shared, setShared, readTextFile, writeTextFile, watchFolder, nextCommand, exec,
  home, appHome, languageOf, highlight, lspStart, lspRequest, lspNotify, lspNextMessage, lspRelease, setUnsaved, keys,
  window as appWindow,
} from "herdr";
import type { Guard, Guarded } from "./guard.ts";
import { isBoolean, isNumber, isString, nullable, object, oneOf, parseJson, readShared, readSharedMap, sharedKey, sharedMapKey, writeShared, writeSharedMap } from "./guard.ts";
import { isJsonObject, isList } from "./guards.ts";
import type { Bound, ColorRun, HoverPart, LanguageOptions, Problem, ProgressParams, ServerCaps, ServerNote, ServerState, SeverityColors, SyntaxColors, Work } from "./logic.ts";
import {
  languageSettings, serverCandidates, ROOTS, rootScript, pickRoot, languageId, uri, diagnostics, lineNotes, counts,
  diagnosticsAt, nextProblem, hoverParts, parseGoto, firstLocation, tilde, dirname, basename, syntaxColors, colorRuns, hintList, editorKeys, serverNote,
  cardPlace, busy, progressWord, changeBetween, incremental, cardMarkdown, appBindings, chordOf,
  isHover, isLocations, isLspDiagnostic, isProgressParams, isPublishedDiagnostics, isServerCaps,
} from "./logic.ts";
import type { Doc as VimDoc, FeedResult, Mode, Played } from "./vim.ts";
import { createVim, feed, play, token, beginInsert, CARET, MODE_NAME, applyEdits } from "./vim.ts";
import { MarkdownDoc, cacheImage, taskToggle, isLocalSource } from "./markdown.ts";
import { follow, join } from "./paths.ts";
import type { Stop } from "./form-keys.ts";
import { formKey, bindTab, tabActions } from "./form-keys.ts";
import { hint, keysHint, keysView, keysKey } from "./keyhelp.ts";
import type { EnvCache, KeptEnv } from "./envrc.ts";
import { projectEnv, lookup, wrap, cacheName, keptEnv, keptEnvText } from "./envrc.ts";
import { fileChanges, newestId, follow as followFiles } from "./follow.ts";
import type { Gap, Handover, LookAct, MenuAct, MenuItem, TabKind } from "./tabs.ts";
import {
  placeTab, afterClose, stepTab, restoreTabs, keptTabs, unsavedNote, tabLabels, tabWidth, visibleTabs, MORE, showStrip, DRAG_START, gapAt, dropIndex, stakeAt, moved, tabKind, startsDrawn, drawnAfter, LOOK_KEYS, lookAction, tabMenuItems, tabMenuKey, handover, handoverFor,
  HANDOVER_KEY, isKeptTabsNote, isMovedNote,
} from "./tabs.ts";
import { fileIcon, iconColor, iconSvg, ICON_SIZE } from "./file-icons.ts";
import Viewer from "./viewer.ts";
import type { EditorView, OpenRequest } from "./editor-route.ts";
import { OPEN_KEY, LAST_KEY, PATHS_KEY, filesOf, editorPaths, isEditorView, isScratchpad } from "./editor-route.ts";
import type { CardLink } from "./cardlinks.ts";
import { cardLinks, linkTarget, linkWhere } from "./cardlinks.ts";
import type { Picture, RenderedHost } from "./rendered.ts";
import { Rendered, editBetween } from "./rendered.ts";
import { units as liveUnits, unitFor } from "./live.ts";
import type { Sel } from "./mdedit.ts";
import { run as mdCommand, tickLine, commandInfo, COMMANDS as MD_COMMANDS, LEVELS as MD_LEVELS, active as mdActive } from "./mdedit.ts";
import type { AutosaveState } from "./scratch.ts";
import { isNote, noteName, Autosave } from "./scratch.ts";
import { assetPlace, imageMarkdown, insertImage, readClipboardImage, maybeCopiedImage, relative, isImagePath, stamp } from "./images.ts";
// Read off the module when used (pickFile): test stand-ins for herdr needn't know them all.
import * as herdr from "herdr";

// The find line's stops in tab order (form-keys.ts): the find field, Aa, ‹, ›
// and, replacing, the "with" field, replace, all.
const FIND_STOPS: readonly Stop[] = [{ id: "find", kind: "text" }, { id: "case", kind: "toggle" }, { id: "prev", kind: "button" }, { id: "next", kind: "button", submit: true }];
const REPLACE_STOPS: readonly Stop[] = [...FIND_STOPS, { id: "with", kind: "text" }, { id: "replace-one", kind: "button" }, { id: "replace-all", kind: "button" }];

const MOD = "editor";

// Each editor's file name by slot, for its pane header (nocturne/header.ts).
const TITLES = "editor.titles";
const TITLES_KEY = sharedMapKey(TITLES, isString);

// The app asks an editor already on a file to go somewhere (`editor.open` with a line):
// { path, n, line?, col? } (src/window.rs).
const GOTO = "editor.goto";
const GOTO_KEY = sharedKey(GOTO, nullable(object({ path: isString, n: isNumber }, { line: isNumber, col: isNumber })));
const POLL = 4000; // a file on another machine can't be watched
const CHANGE_DELAY = 40; // ms: edits typed together go to the server as one change (and before any question)

// How long a server runs on once its last editor closes (s): coming back to
// the project within it is instant. Fireflies keeps at most a few unused servers
// (least recently used stop first), so this is a ceiling, not a promise.
export const SERVER_IDLE = 15 * 60;

// The project environments kept on disk (envrc.ts): a second app start runs no nix.
const envFile = (dir: string): string => `${appHome()}/cache/editor/${cacheName(dir)}`;

const envCache: EnvCache = {
  async read(dir: string): Promise<KeptEnv | null> {
    return keptEnv(await readTextFile(envFile(dir)), dir);
  },
  async write(dir: string, value: KeptEnv): Promise<void> {
    const path = envFile(dir);
    const was = await readTextFile(path).catch(() => null);

    await writeTextFile(path, keptEnvText(dir, value), was).catch(() => null);
  },
};

const BAR = 30;
const FIND = 28;
const HINTS = 22;
const DRAWER = 132;
const ROW = 24;
const TABS = 26;

// The line numbers' room from the pane's left edge, as the top bar's inset (px):
// the gutter right-aligns them, so a 4-digit file's touched the border.
export const GUTTER_INSET = 12;

// The Markdown preview: how it shows, in the order the switch goes.
const VIEWS: readonly EditorView[] = ["rendered", "split", "preview", "text"];

// Under this width a split puts the preview under the text.
const SIDE_BY_SIDE = 760;

// Links to these open in the preview pane (preview); other files with a language in the editor.
const PREVIEWED = /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|svg|avif|hei[cf]|pdf|csv|tsv|sqlite3?|db3?|diff|patch|ttf|otf|ttc|woff2?|mp4|m4v|mov|mp3|m4a|aac|wav|aiff?|flac|caf)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;
const CARD_W = 520;

// A tab's name is cut past this (px); its full path is in the bar.
const MAX_TAB_NAME = 180;

/** A scratchpad's mark (nocturne's art: the "+ new" menu's tile has it too). */
const SCRATCH_MARK = "mods/nocturne/art/scratchpad.svg";

// A server that reported work within this long (ms) is still loading the
// workspace: rust-analyzer goes quiet for a moment between its phases, and
// an empty answer then means "not yet", not "nothing here".
const SETTLE = 2000;

const RECT = (): ReturnType<ReturnType<typeof PathBuilder.fill>["build"]> => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

const zoom = (): number => Number(settings().zoom) || 1;

/** A 50% checker dither filling the parent (as nocturne/kit.ts). */
function dither(color: Color, cell = 1): Element {
  const dpr = appWindow().platform === "macos" ? 2 : 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}

const stop = (_e: MouseButtonEvent, cx: Context): void => cx.stop_propagation();

/** A new editor pane's slot (its shared records' key). */
const newSlot = (): string => `ed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Where a dragged tab lands: a 2 px accent bar capped top and bottom, at the
 *  left edge of its box (as the app's tab strip, nocturne/tabdrag.ts). */
function tabStake(t: Theme): Element {
  return div()
    .absolute()
    .left(-3)
    .top(3)
    .bottom(2)
    .w(8)
    .child(div().absolute().left(3).top(0).bottom(0).w(2).bg(t.accent))
    .child(div().absolute().left(0).right(0).top(0).h(2).bg(t.accent))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent));
}

/** The editor's selection (and, drawn from it, search matches): the accent
 *  at 40%, see-through so the syntax colors read on it. */
export function selectionColor(t: Pick<Theme, "accent">): string {
  return t.accent.slice(0, 7) + "66";
}

/** A Markdown command's entry in the list: [title, its letter after cmd-., what it writes]. */
type MdEntry = readonly [title: string, key: string, mark: string];

/** The image commands in the list (main.ts, not mdedit.ts: they ask the clipboard or a picker):
 *  name -> [title, its letter after cmd-., what it writes]. */
const MD_IMAGE: ReadonlyMap<string, MdEntry> = new Map<string, MdEntry>([
  ["image", ["Image from a file", "p", "![](…)"]],
  ["image-paste", ["Paste an image", "v", "assets/"]],
]);

/** A command of the list by name: mdedit's, or one of the image ones. */
const mdEntry = (name: string): MdEntry | undefined => commandInfo(name) ?? MD_IMAGE.get(name);

/** The Markdown commands that, from a caret in the rendered view, take the caret's whole block. */
const WHOLE_BLOCK = new Set(["bullets", "numbers", "task", "tick", "quote", "fence"]);

/** cmd-. (ctrl-. off the Mac): the Markdown commands' list. */
export function isMdMenuKey(e: KeyEvent): boolean {
  const m = e.modifiers;
  const mod = appWindow().platform === "macos" ? m.platform && !m.control : m.control && !m.platform;

  return e.key === "." && mod && !m.alt && !m.shift;
}

/** The props an editor pane is opened with: its file (and place), its machine, its
 *  slot, opened to be looked at, popped out of another editor. */
const isPaneProps = object({}, { path: isString, line: isNumber, col: isNumber, on: nullable(isString), slot: isString, look: isBoolean, popped: isBoolean });

/** A pane's props as an editor's (none when they aren't). */
type PaneProps = Guarded<typeof isPaneProps>;

const paneProps = (pane: PaneInfo): PaneProps => (isPaneProps(pane.props) ? pane.props : {});

/** A command's pane and machine arguments, each only where there is one. */
// A type (not an interface): it goes to herdr's run(), which takes an object of arguments.
type WhereArgs = { pane?: string; on?: string };

function whereArgs(pane: string | null | undefined, on: string | null): WhereArgs {
  const out: WhereArgs = {};

  if (pane) out.pane = pane;

  if (on !== null) out.on = on;

  return out;
}

/** A tab's state: unloaded (not shown yet), loading, ready, missing (a new file), error. */
type DocState = "unloaded" | "loading" | "ready" | "missing" | "error";

/** A place to go once a tab is read: one-based line and column. */
interface Go {
  readonly line: number;
  readonly col?: number | null;
}

/** A hover's answer for a place: its parts, and whether TypeScript can say more. */
interface HoverAnswer {
  readonly parts: readonly HoverPart[];
  readonly more: boolean;
}

/** What a find has found: how many, and which one is current. */
type FindCount = Pick<EditorFindState, "count" | "current">;

/** A tab: a file's record (newDoc). */
export interface Doc {
  path: string;
  firstPath: string;
  lang: string;
  opts: LanguageOptions;
  /** The language server's timeline counts from here (mark). */
  openedAt: number;
  /** The file was deleted (the files pane): a save writes it again. */
  deleted: boolean;
  /** The text as on disk, when last read or written. */
  saved: string | null;
  state: DocState;
  error: string | null;
  dirty: boolean;
  /** The file changed on disk while edited. */
  conflict: boolean;
  problems: Problem[];
  server: ServerState | null;
  version: number;
  /** The text the server has (its last didOpen / didChange). */
  sent: string | null;
  /** The server's work under way ($/progress): token -> { title, message, percentage }. */
  progress: Map<string, Work>;
  /** Answers by place, level and version: asking again is instant. */
  hovers: Map<string, HoverAnswer>;
  /** The text as last read from the editor (vim reads it). */
  text: string;
  find: FindCount;
  searchMark: string | null;
  markdown: boolean;
  preview: MarkdownDoc;
  /** abs path -> cache name | null (can't) | undefined (copying). */
  images: Map<string, string | null | undefined>;
  view: EditorView;
  /** Which side scrolled last: the other follows. */
  driver: "editor" | "preview";
  previewDrove: number;
  previewDue: boolean;
  previewStale: boolean;
  flushDue: boolean;
  lastWork: number;
  watchGen: number;
  watched: boolean;
  /** Drawn by the preview's viewer (tabs.ts tabKind): "look" files always, "either" ones until shown as text. */
  kind: TabKind;
  look: boolean;
  softWrap: boolean;
  editor: EditorStateT;
  rendered: Rendered | null;
  scratch: boolean;
  autosave: Autosave | null;
  saveState: AutosaveState;
  /** The text an autosave is writing now. */
  writing: string | null;
  /** Handed over from another editor: its text, caret and scroll once read. */
  hand: Handover | null;
  go: Go | null;
  gone: boolean;
}

/** A part of the card: the hover's code, colored once (`lines`), or its text, as the card's Markdown (`md`). */
type CardPart = { readonly code: string; readonly lang: string | null; lines?: ColorRun[][] } | { readonly text: string; md?: string };

/** What the card says when there's no answer: what's the case, and what to do. */
type CardNote = Pick<ServerNote, "text" | "fix">;

/** The hover card: its place, asked with the keyboard or the pointer's, the problems
 *  there, the server's answer, the type depth, what it waits on, its scroll, its links. */
interface Card {
  readonly line: number;
  readonly col: number;
  readonly keyboard: boolean;
  readonly problems: readonly Problem[];
  parts: CardPart[];
  readonly level: number;
  more: boolean;
  pending: boolean;
  note: CardNote | null;
  scroll: number;
  readonly opened: number;
  asked: number | null;
  inflight: number;
  reasked: boolean;
  waitingOn: boolean;
  links: CardLink[];
  link: number | null;
  contentH: number | null;
  viewH: number | null;
  drawn: boolean;
}

/** The answers the close question offers. */
type Answer = "save" | "discard" | "keep";

const ANSWERS: readonly Answer[] = ["save", "discard", "keep"];

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

/** The viewer's props for a drawn tab (viewer.ts isViewerProps). */
interface ViewerPropsNow {
  readonly embedded: true;
  readonly path: string | null;
  readonly on: string | null;
  readonly scroll: { readonly n: number; readonly dir: number } | null;
  readonly reload: number;
}

/** A change to the viewer's props. */
type ViewerChange = Partial<Pick<ViewerPropsNow, "scroll" | "reload">>;

/** The viewer's props as the engine takes them. */
const viewerPropsOf = (v: ViewerPropsNow): Props => ({ embedded: v.embedded, path: v.path, on: v.on, scroll: v.scroll, reload: v.reload });

/** An `editor.open:{…}` command's argument. */
const isOpenArg = object({}, { path: isString, line: nullable(isNumber), col: nullable(isNumber), view: nullable(isEditorView) });

/** A server's formatting answer: edits in LSP ranges. */
const isTextEdits = (value: unknown): value is readonly { readonly range: { readonly start: { readonly line: number; readonly character: number }; readonly end: { readonly line: number; readonly character: number } }; readonly newText: string }[] =>
  isList(value) && value.every((e) => isTextEdit(e));

const isLspPos = object({ line: isNumber, character: isNumber });
const isTextEdit = object({ range: object({ start: isLspPos, end: isLspPos }), newText: isString });

/** `$/exit`'s params: the server's last lines. */
const isExitParams = object({}, { stderr: oneOf(isList) });

/** A caught error's words. */
const errorText = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** `el` tracking `handle` (made in init; a pane put together without init has none). */
function focusOn(el: Element, handle: FocusHandle | null): Element {
  return handle ? el.track_focus(handle) : el;
}

/** The herdr session a tab's server answers on (null: not running). */
const serverId = (s: ServerState | null | undefined): number | null => (s?.status === "ready" ? s.id : null);

/** A server's name, once it has one (starting, ready, stopped). */
const serverName = (s: ServerState | null | undefined): string | null => (s?.status === "starting" || s?.status === "ready" || s?.status === "exited" ? s.name : null);

/** What a question to the server adds to its place: TypeScript's hover depth, references' context. */
interface LspExtra {
  readonly verbosityLevel?: number;
  readonly context?: { readonly includeDeclaration: boolean };
}

/** A problem as the code editor underlines it. */
function editorProblem(p: Problem): Parameters<EditorStateT["set_diagnostics"]>[0][number] {
  const at = { line: p.line, col: p.col, end_line: p.end_line, end_col: p.end_col, severity: p.severity, message: p.message };

  if (p.code !== null && p.source !== null) return { ...at, code: p.code, source: p.source };

  if (p.code !== null) return { ...at, code: p.code };

  if (p.source !== null) return { ...at, source: p.source };

  return at;
}

/** A problem's code and source, as the drawer and the card show them. */
const codeAndSource = (p: Problem): string => [p.code, p.source].filter((x) => x !== null && x !== "").join(" · ");

/** The colors of the severities (the drawer, the card). */
const severityColors = (t: Theme): SeverityColors => ({ error: t.ansi1, warning: t.ansi3, info: t.ansi4, hint: t.dim });

/** The bar's color for vim's mode. */
function modeColorOf(t: Theme, mode: Mode): Color {
  switch (mode) {
    case "insert":
      return t.ansi2;
    case "replace":
      return t.ansi1;
    case "visual":
    case "vline":
    case "vblock":
      return t.ansi5;
    case "normal":
      return t.accent;
  }
}

/** The preview's own leader keys (space m …) and the commands they run. */
const PREVIEW_LEADER: ReadonlyMap<string, string> = new Map([
  ["mp", "preview"],
  ["ms", "preview-split"],
  ["mv", "preview-only"],
  ["mt", "preview-text"],
]);

export default class EditorPane extends View {
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
  cur: Doc | null = null;
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

  /** The shown tab (init makes one before anything asks). */
  shown(): Doc {
    if (!this.cur) throw new Error("the editor has no tab yet");

    return this.cur;
  }

  override init(p: Props | undefined, cx: AsyncContext): void {
    const raw = props() ?? p;
    const pr: PaneProps = isPaneProps(raw) ? raw : {};

    this.on = pr.on ?? null;
    this.slot = pr.slot ?? null;
    this.seenChange = newestId(fileChanges(shared));
    this.seenOpen = readShared(shared, OPEN_KEY, null)?.n ?? 0;
    this.menuHandle = cx.focus_handle();
    this.handle = cx.focus_handle();
    bindTab(cx); // tab / shift-tab reach the key handler (form-keys.ts)

    // Vim: the pane's own switch, else settings.json editor.vim (default on).
    const leader = settings().editor.leader ?? "space";

    this.vim = createVim({ leader: leader === "space" ? " " : leader === "comma" ? "," : leader.slice(0, 1) || " " });

    // This pane's own vim switch, if it was flipped here before.
    try {
      const v = localStorage.getItem("vim");

      this.paneVim = v === "on" ? true : v === "off" ? false : null;
    } catch {
      this.paneVim = null;
    }

    this.vimWas = this.vimOn();
    this.colors = syntaxColors(theme());

    // Markdown: how the preview shows (the pane remembers; each tab keeps its own after).
    let view: string | null = null;

    try {
      view = localStorage.getItem("preview");
    } catch {
      /* the default */
    }

    this.defaultView = isEditorView(view) ? view : "split";
    this.previewHandle = cx.focus_handle();
    this.lookHandle = cx.focus_handle();
    this.viewerProps = { embedded: true, path: null, on: this.on, scroll: null, reload: 0 };
    this.keysHandle = cx.focus_handle();

    const findInput = InputState.new({ placeholder: "find" });

    findInput.on("change", (_e, cx) => this.search(cx));
    findInput.on("submit", (e, cx) => this.step(e.shift ? -1 : 1, cx));

    const replaceInput = InputState.new({ placeholder: "replace with" });

    replaceInput.on("submit", (e, cx) => this.replace(Boolean(e.secondary), cx));
    // A click into a field moves the find line's stop with it.
    findInput.on("focus", () => {
      this.findAt = "find";
    });
    replaceInput.on("focus", () => {
      this.findAt = "with";
    });

    const lineInput = InputState.new({ placeholder: "line or line:column" });

    lineInput.on("submit", (_e, cx) => this.goLine(cx));
    this.findInput = findInput;
    this.replaceInput = replaceInput;
    this.lineInput = lineInput;

    // The tabs: as kept (a restart), else the props' file (where the files
    // pane moved it: its props keep the first path).
    const stored = (name: string): string | null => {
      try {
        return localStorage.getItem(name);
      } catch {
        return null; // none kept
      }
    };

    const keptText = stored("tabs");
    const movedText = stored("moved");
    const keptTabsNote = keptText ? (parseJson(keptText, isKeptTabsNote) ?? null) : null;
    const start = restoreTabs(keptTabsNote, pr.path ?? "", movedText ? (parseJson(movedText, isMovedNote) ?? null) : null);
    const keptAny = (keptTabsNote?.paths?.length ?? 0) > 0;
    // The props' file opened to be looked at (a terminal's link: `look`) starts drawn.
    const req = readShared(shared, OPEN_KEY, null);
    const asked = req && req.slot === null && req.path === pr.path && Date.now() - (req.at ?? 0) < 10000 ? req : null;
    // A tab popped out of another editor into this new one: what it had (tabs.ts handover).
    const handed = keptAny ? null : handoverFor(readShared(shared, HANDOVER_KEY, null), pr.slot, pr.path);

    this.docs = start.paths.map((path) => this.newDoc(path, path === pr.path && !keptAny ? { look: pr.look === true || asked?.look === true, view: asked?.view ?? null, hand: handed } : {}));

    const first = this.docs[start.active] ?? this.docs[0];

    if (!first) throw new Error("restoreTabs gives a tab at least");

    this.cur = first;

    // The props' line goes to the props' file (editor.open opened this pane on it).
    let go: Go | null = null;

    if (pr.line) {
      this.cur = this.docs.find((x) => x.path === pr.path) ?? first;
      go = { line: pr.line, col: pr.col ?? 1 };
    }

    // An "edit" from the Markdown viewer asked for the preview (editor-route.ts: slot null).
    if (asked?.view && asked.path === this.cur.path && this.cur.markdown) this.cur.view = asked.view;

    this.select(this.cur, cx, go, true);
    // The tabs it restored, told to the routing now: shared PATHS outlives a
    // restart, and an entry from before (a scratchpad note this pane no longer
    // holds) would send the app's editor.open to a pane that ignores it.
    this.publish();

    if (this.on) {
      cx.timer.every(POLL, (cx) => {
        for (const d of this.docs) if (d.state !== "unloaded" && d.state !== "loading") this.load(cx, null, true, d);
      });
    }

    // A newly opened editor takes the keyboard.
    for (const ms of [0, 120, 400]) cx.timer.after(ms, () => this.focusText());

    cx.spawn(async (cx) => {
      for (;;) {
        const c = (await nextCommand()).replace(`${MOD}.`, "");

        this.command(c, cx);
        cx.notify();
      }
    });
  }

  /** A file's record: its own code editor (text, undo, caret, scroll,
   *  folds), what's on disk, unsaved changes, its server document, problems
   *  and Markdown preview. Read when first shown (`state` "unloaded" till then). */
  newDoc(path: string, { look = false, view = null, hand = null }: { readonly look?: boolean; readonly view?: EditorView | null; readonly hand?: Handover | null } = {}): Doc {
    const lang = languageOf(path) ?? "text";
    const opts = languageSettings(settings().editor, lang);
    const t = theme();
    const markdown = lang === "markdown";
    const kind = tabKind(path);
    // Word wrap in this tab: the language's soft_wrap until cmd-k z / space u w
    // / :set wrap / the bar's chip switch it (this tab only, not written to settings).
    const softWrap = Boolean(opts.soft_wrap);

    const editor = EditorState.new({
      language: lang,
      value: "",
      font_family: settings().font_family || "JetBrains Mono",
      font_size: 13,
      line_numbers: true,
      folding: true,
      soft_wrap: softWrap,
      syntax: this.colors ?? syntaxColors(t),
      // The theme's selection is moonfly's border tone, hard to see on its
      // background: moonfly blue at 40% stands out and keeps text readable.
      selection: selectionColor(t),
    });

    const d: Doc = {
      path,
      firstPath: path,
      lang,
      opts,
      openedAt: Date.now(),
      deleted: false,
      saved: null,
      state: "unloaded",
      error: null,
      dirty: false,
      conflict: false,
      problems: [],
      server: null,
      version: 1,
      sent: null,
      progress: new Map(),
      hovers: new Map(),
      text: "",
      find: { count: 0, current: null },
      searchMark: null,
      markdown,
      preview: new MarkdownDoc("pv"),
      images: new Map(),
      // Markdown takes the view asked for, else the pane's (rendered, split, preview, text: its last pick).
      view: markdown && view ? view : this.defaultView,
      driver: "editor",
      previewDrove: 0,
      previewDue: false,
      previewStale: false,
      flushDue: false,
      lastWork: 0,
      watchGen: 0,
      watched: false,
      kind,
      look: startsDrawn(path, { look, view }),
      softWrap,
      editor,
      rendered: null,
      scratch: isNote(path, appHome()),
      autosave: null,
      saveState: "saved",
      writing: null,
      hand: null,
      go: null,
      gone: false,
    };

    // Handed over from another editor: its view and drawn state now, its text, caret and scroll once read (load).
    if (hand) {
      if (d.markdown && hand.view) d.view = hand.view;

      if (d.kind === "either") d.look = hand.look;

      d.hand = hand;
    }

    editor.set_tab_size(opts.tab_size, opts.insert_spaces === false);

    if (d.hand && d.hand.wrap !== d.softWrap) {
      d.softWrap = d.hand.wrap;
      editor.set_soft_wrap(d.softWrap);
    }

    editor.on("key", (e, cx) => this.vimKey(e, cx));
    editor.set_cursor_shape(this.vimOn() ? CARET.normal : "bar");
    editor.on("change", (_e, cx) => this.changed(cx, d));
    // A paste the editor found no text in (a screenshot): a Markdown file takes it as an image block.
    editor.on("paste_other", (_e, cx) => {
      if (d.markdown && d === this.cur) void this.pasteImage(cx);
    });
    editor.on("hover", (e, cx) => {
      if (d === this.cur) this.hovered(e, cx);
    });
    // The editor losing the keyboard closes the card (and watchFocus, while
    // one is open: the editor's blur doesn't reach mods every time).
    editor.on("blur", (_e, cx) => this.closeCard(cx));

    // Markdown: the rendered view's block editor (rendered.ts); a scratchpad
    // note (scratch.ts) opens rendered and saves itself as it's typed.
    if (d.markdown) d.rendered = new Rendered(d, this.renderedHost());

    if (d.scratch) {
      d.view = "rendered";
      d.saveState = "saved";
      d.autosave = new Autosave({
        write: () => this.autosaveWrite(d),
        timer: (ms, fn) => this.autosaveTimer(ms, fn),
        onState: (st) => {
          d.saveState = st;
        },
      });
    }

    editor.on("scroll", (_e, cx) => {
      if (d !== this.cur) return;

      // The card stays at its word: drawn again where the word went (and once
      // more a frame later, when the scrolled text has been laid out).
      if (this.card) {
        cx.notify();
        cx.timer.after(16, (cx) => cx.notify());
      }

      if (Date.now() - d.previewDrove < 150) return;

      d.driver = "editor";

      if (d.markdown && d.view === "split") cx.notify();
    });

    return d;
  }

  /** Every file record (a pane built without init has the one it was given). */
  allDocs(): Doc[] {
    return this.docs.length ? this.docs : this.cur ? [this.cur] : [];
  }

  // ---- the shown tab's fields (TAB_FIELDS): `this.path` is the shown tab's path, and so on

  get path(): string {
    return this.shown().path;
  }

  set path(v: string) {
    this.shown().path = v;
  }

  get firstPath(): string {
    return this.shown().firstPath;
  }

  set firstPath(v: string) {
    this.shown().firstPath = v;
  }

  get lang(): string {
    return this.shown().lang;
  }

  set lang(v: string) {
    this.shown().lang = v;
  }

  get opts(): LanguageOptions {
    return this.shown().opts;
  }

  set opts(v: LanguageOptions) {
    this.shown().opts = v;
  }

  get openedAt(): number {
    return this.shown().openedAt;
  }

  set openedAt(v: number) {
    this.shown().openedAt = v;
  }

  get deleted(): boolean {
    return this.shown().deleted;
  }

  set deleted(v: boolean) {
    this.shown().deleted = v;
  }

  get saved(): string | null {
    return this.shown().saved;
  }

  set saved(v: string | null) {
    this.shown().saved = v;
  }

  get state(): DocState {
    return this.shown().state;
  }

  set state(v: DocState) {
    this.shown().state = v;
  }

  get error(): string | null {
    return this.shown().error;
  }

  set error(v: string | null) {
    this.shown().error = v;
  }

  get dirty(): boolean {
    return this.shown().dirty;
  }

  set dirty(v: boolean) {
    this.shown().dirty = v;
  }

  get conflict(): boolean {
    return this.shown().conflict;
  }

  set conflict(v: boolean) {
    this.shown().conflict = v;
  }

  get problems(): Problem[] {
    return this.shown().problems;
  }

  set problems(v: Problem[]) {
    this.shown().problems = v;
  }

  get server(): ServerState | null {
    return this.shown().server;
  }

  set server(v: ServerState | null) {
    this.shown().server = v;
  }

  get version(): number {
    return this.shown().version;
  }

  set version(v: number) {
    this.shown().version = v;
  }

  get sent(): string | null {
    return this.shown().sent;
  }

  set sent(v: string | null) {
    this.shown().sent = v;
  }

  get progress(): Map<string, Work> {
    return this.shown().progress;
  }

  set progress(v: Map<string, Work>) {
    this.shown().progress = v;
  }

  get hovers(): Map<string, HoverAnswer> {
    return this.shown().hovers;
  }

  set hovers(v: Map<string, HoverAnswer>) {
    this.shown().hovers = v;
  }

  get text(): string {
    return this.shown().text;
  }

  set text(v: string) {
    this.shown().text = v;
  }

  get find(): FindCount {
    return this.shown().find;
  }

  set find(v: FindCount) {
    this.shown().find = v;
  }

  get searchMark(): string | null {
    return this.shown().searchMark;
  }

  set searchMark(v: string | null) {
    this.shown().searchMark = v;
  }

  get markdown(): boolean {
    return this.shown().markdown;
  }

  set markdown(v: boolean) {
    this.shown().markdown = v;
  }

  get preview(): MarkdownDoc {
    return this.shown().preview;
  }

  set preview(v: MarkdownDoc) {
    this.shown().preview = v;
  }

  get images(): Map<string, string | null | undefined> {
    return this.shown().images;
  }

  set images(v: Map<string, string | null | undefined>) {
    this.shown().images = v;
  }

  get view(): EditorView {
    return this.shown().view;
  }

  set view(v: EditorView) {
    this.shown().view = v;
  }

  get driver(): "editor" | "preview" {
    return this.shown().driver;
  }

  set driver(v: "editor" | "preview") {
    this.shown().driver = v;
  }

  get previewDrove(): number {
    return this.shown().previewDrove;
  }

  set previewDrove(v: number) {
    this.shown().previewDrove = v;
  }

  get previewDue(): boolean {
    return this.shown().previewDue;
  }

  set previewDue(v: boolean) {
    this.shown().previewDue = v;
  }

  get flushDue(): boolean {
    return this.shown().flushDue;
  }

  set flushDue(v: boolean) {
    this.shown().flushDue = v;
  }

  get lastWork(): number {
    return this.shown().lastWork;
  }

  set lastWork(v: number) {
    this.shown().lastWork = v;
  }

  get watchGen(): number {
    return this.shown().watchGen;
  }

  set watchGen(v: number) {
    this.shown().watchGen = v;
  }

  get editor(): EditorStateT {
    return this.shown().editor;
  }

  set editor(v: EditorStateT) {
    this.shown().editor = v;
  }

  get softWrap(): boolean {
    return this.shown().softWrap;
  }

  set softWrap(v: boolean) {
    this.shown().softWrap = v;
  }

  get rendered(): Rendered | null {
    return this.shown().rendered;
  }

  set rendered(v: Rendered | null) {
    this.shown().rendered = v;
  }

  get scratch(): boolean {
    return this.shown().scratch;
  }

  set scratch(v: boolean) {
    this.shown().scratch = v;
  }

  get autosave(): Autosave | null {
    return this.shown().autosave;
  }

  set autosave(v: Autosave | null) {
    this.shown().autosave = v;
  }

  get saveState(): AutosaveState {
    return this.shown().saveState;
  }

  set saveState(v: AutosaveState) {
    this.shown().saveState = v;
  }

  get writing(): string | null {
    return this.shown().writing;
  }

  set writing(v: string | null) {
    this.shown().writing = v;
  }

  get previewStale(): boolean {
    return this.shown().previewStale;
  }

  set previewStale(v: boolean) {
    this.shown().previewStale = v;
  }

  get kind(): TabKind {
    return this.shown().kind;
  }

  set kind(v: TabKind) {
    this.shown().kind = v;
  }

  get look(): boolean {
    return this.shown().look;
  }

  set look(v: boolean) {
    this.shown().look = v;
  }

  get watched(): boolean {
    return this.shown().watched;
  }

  set watched(v: boolean) {
    this.shown().watched = v;
  }

  // ---- the tabs

  /** Shows tab `d`: the card, find line and vim's pending keys go; read the
   *  first time; `go` { line, col } (one-based) puts the caret there. */
  select(d: Doc, cx: Context, go: Go | null = null, first = false): void {
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
      if (!d.watched && !this.on && d.path) {
        d.watched = true;
        this.watch(cx, d);
      }
    } else if (d.state === "unloaded") {
      d.state = "loading";
      this.load(cx, go, false, d);

      if (!this.on && d.path) this.watch(cx, d);
    } else if (go && d.state !== "loading") this.goto(go.line - 1, (go.col ?? 1) - 1, cx);
    else if (go) d.go = go;

    this.title();
    this.keepTabs();

    if (!first || d.look) {
      if (d.look) cx.timer.after(0, () => this.lookHandle?.focus());
      else if (d.markdown && d.view === "preview") cx.timer.after(0, () => this.previewHandle?.focus());
      else if (d.markdown && d.view === "rendered" && d.state !== "loading") {
        d.rendered?.open(cx);
        this.focusText();
      } else this.focusText();
    }

    cx.notify();
  }

  /** Opens `path` here as a tab (the one showing it, if open) and shows it;
   *  `line` / `col` one-based; `view` a Markdown file's view, or "preview" /
   *  "text" for a table, patch or SVG (drawn or as text); `look`: opened to be
   *  looked at (a new tab of a picture or table starts drawn). */
  openFile(path: string, cx: Context, { line = null, col = null, view = null, look = false }: { readonly line?: number | null; readonly col?: number | null; readonly view?: EditorView | null; readonly look?: boolean } = {}): void {
    if (!path) return;

    // A scratchpad's pane is the note's own: other files open in an editor beside it.
    if (this.docs.length && this.docs.every((d) => d.scratch) && !isNote(path, appHome())) {
      const me = this.me();

      const where = whereArgs(me?.pane, null);

      run("editor.open", line ? { path, line, col: col ?? 1, ...where } : { path, ...where });

      return;
    }

    const at = placeTab(
      this.docs.map((d) => d.path),
      this.docs.indexOf(this.shown()),
      path,
    );

    if (at.added) this.docs.splice(at.index, 0, this.newDoc(path, { look, view, hand: handoverFor(readShared(shared, HANDOVER_KEY, null), this.slot, path) }));

    const d = this.docs[at.index];

    if (!d) return;

    if (!at.added) {
      if (view && d.markdown) d.view = view;

      const drawn = drawnAfter(path, { view });

      if (drawn !== null && drawn !== d.look) this.setDrawn(d, drawn, cx, false);
    }

    this.select(d, cx, line && !d.look ? { line, col: col ?? 1 } : null);
    this.publish();
  }

  // ---- popping a tab out into a pane of its own, and back in

  /** Tab `d` into a new editor pane of its own: beside this one (`where`
   *  "beside"), or in a new tab of the window ("tab"); what it had goes with
   *  it (handover) and it leaves this strip without asking (its unsaved text
   *  went too). The last tab popping out closes this pane. */
  popOut(cx: Context, d: Doc | null = this.cur, where: "beside" | "tab" = "beside"): void {
    if (!d) return;

    if (d.scratch) return this.say("the scratchpad is a pane of its own");

    const me = this.me();
    const slot = newSlot();

    writeShared(setShared, HANDOVER_KEY, handover(d, slot));

    const paneProps = this.on ? { path: d.path, slot, popped: true, on: this.on } : { path: d.path, slot, popped: true };

    if (where === "tab" || !me) run("tab.new", { mod: MOD, props: paneProps, name: basename(d.path) });
    else run("pane.split", { direction: "auto", pane: me.pane, mod: MOD, props: paneProps });

    this.leave(cx, d);
  }

  /** The shown tab into another editor of this window's tab, as a tab there
   *  (the one that last had the keyboard, else the first): what it had goes
   *  with it; this pane closes when it was its last tab. */
  popIn(cx: Context, d: Doc | null = this.cur): void {
    if (!d || d.scratch) return;

    const target = this.otherEditor();

    if (!target) return this.say("no other editor in this tab");

    writeShared(setShared, HANDOVER_KEY, handover(d, target.slot));
    writeShared(setShared, OPEN_KEY, { slot: target.slot, path: d.path, n: (readShared(shared, OPEN_KEY, null)?.n ?? 0) + 1, at: Date.now() });
    run("pane.focus", { pane: target.pane });
    this.leave(cx, d);
  }

  /** Another editor in this pane's window tab (not a scratchpad's), for popIn: its pane and slot. */
  otherEditor(): { readonly pane: string; readonly slot: string } | null {
    const me = this.me();

    if (!me) return null;

    const eds = panes().flatMap((p) => {
      const pp = paneProps(p);

      return p.mod === MOD && p.tab === me.tab && p.pane !== me.pane && !p.parked && pp.slot && (pp.on ?? null) === this.on && !isScratchpad(p) ? [{ pane: p.pane, slot: pp.slot }] : [];
    });

    const last = readShared(shared, LAST_KEY, null);

    return eds.find((p) => p.slot === last) ?? eds[0] ?? null;
  }

  /** Tab `d` goes from here without asking: it lives on elsewhere. */
  leave(cx: Context, d: Doc): void {
    d.dirty = false;
    this.closeTab(cx, d, true);
  }

  // ---- the tab's menu

  /** Opens the menu of tab `index` (the shown one by default): a right-click
   *  on it, space b m, the tab-menu command. */
  openTabMenu(cx: Context, index = this.docs.indexOf(this.shown())): void {
    const d = this.docs[index];

    if (!d) return;

    const items = tabMenuItems({ count: this.docs.length, index, others: Boolean(this.otherEditor()), scratch: d.scratch });

    this.tabMenu = { index, at: 0, items };
    this.closeCard(cx);
    cx.timer.after(0, () => this.menuHandle?.focus());
    cx.notify();
  }

  closeTabMenu(cx: Context, refocus = true): void {
    if (!this.tabMenu) return;

    this.tabMenu = null;

    if (refocus) this.focusText();

    cx.notify();
  }

  /** Runs a tab menu entry on its tab. */
  tabMenuAct(act: MenuAct, cx: Context): void {
    const m = this.tabMenu;
    const d = this.docs[m?.index ?? this.docs.indexOf(this.shown())];

    this.closeTabMenu(cx, act === "move-left" || act === "move-right");

    if (!d) return;

    const i = this.docs.indexOf(d);

    if (act === "pop-out") this.popOut(cx, d, "beside");
    else if (act === "pop-out-tab") this.popOut(cx, d, "tab");
    else if (act === "pop-in") this.popIn(cx, d);
    else if (act === "move-left") this.moveTab(i, i - 1, cx);
    else if (act === "move-right") this.moveTab(i, i + 1, cx);
    else if (act === "close") this.closeTab(cx, d);
    else this.closeOthers(cx, d);

    cx.notify();
  }

  /** Every tab but `d` closes; those with unsaved changes stay (and say so). */
  closeOthers(cx: Context, d: Doc = this.shown()): void {
    const kept = this.docs.filter((x) => x !== d && x.dirty);

    for (const x of this.docs.filter((x) => x !== d && !x.dirty)) this.closeTab(cx, x, true);

    if (this.cur !== d) this.select(d, cx);

    if (kept.length) this.say(`${kept.length} kept: unsaved changes (${kept.map((x) => basename(x.path)).join(", ")})`);
  }

  tabMenuKeyDown(e: KeyEvent, cx: Context): void {
    const m = this.tabMenu;

    if (!m) return;

    const r = tabMenuKey(m.items, m.at, e);

    if (!r.taken) return;

    cx.stop_propagation();
    m.at = r.at;

    if (r.act) return this.tabMenuAct(r.act, cx);

    if (r.close) return this.closeTabMenu(cx);

    cx.notify();
  }

  /** The menu, under its tab on the strip (at the bar's left with one tab). */
  tabMenuView(t: Theme): Element {
    const m = this.tabMenu;

    if (!m) return div();

    const z = zoom();
    const x = Math.max(4, Math.min(this.tabX?.(m.index) ?? 8, this.size.width / z - 236));

    const row = (it: MenuItem, i: number): Element =>
      h_flex()
        .id(`editor-tab-menu-${it.act}`)
        .relative()
        .h(22)
        .px(10)
        .gap(10)
        .items_center()
        .text_color(i === m.at ? t.foreground : t.muted)
        .when(i === m.at, (el) => el.child(div().absolute().inset_0().opacity(0.6).child(dither(t.ansi0, 1))).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
        .hover((s) => s.text_color(t.foreground))
        .on_mouse_move(() => {
          if (m.at !== i) m.at = i;
        })
        .on_click((_e, cx) => {
          this.tabMenuAct(it.act, cx);
          cx.notify();
        })
        .child(div().relative().w(14).flex_none().text_color(t.accent).child(it.key))
        .child(div().relative().flex_1().child(it.label));

    return focusOn(div().id("editor-tab-menu").absolute().top(this.stripH()).left(x).w(228).py(4).bg(t.background).border(1).border_color(t.accent), this.menuHandle)
      .on_key_down((e, cx) => this.tabMenuKeyDown(e, cx))
      .on_mouse_down("left", stop)
      .child(div().absolute().left(4).right(-4).top(4).bottom(-4).child(dither(t.ansi0, 1)))
      .child(div().absolute().inset_0().bg(t.background))
      .children(m.items.map(row));
  }

  // ---- drawn tabs (the preview's viewer)

  /** The viewer, made once, when a drawn tab first shows: a nested view, so
   *  its reading and drawing redraw only it. */
  mountViewer(cx: Context): void {
    this.viewer ??= cx.new(Viewer, viewerPropsOf(this.viewerProps));
  }

  /** The viewer's props for the shown tab: its file when drawn, none
   *  otherwise (a native view, a PDF's or a clip's, goes with it). */
  syncViewer(change: ViewerChange = {}): void {
    const d = this.cur;
    const path = d?.look ? d.path : null;

    if (path === this.viewerProps.path && !Object.keys(change).length) return;

    this.viewerProps = { ...this.viewerProps, path, on: this.on, ...change };
    this.viewer?.set_props(viewerPropsOf(this.viewerProps));
  }

  /** Tab `d` drawn (true) or as text (false); a "look" file (a picture)
   *  stays drawn. `focus`: the shown tab takes the keyboard after. */
  setDrawn(d: Doc, drawn: boolean, cx: Context, focus = true): void {
    const on = d.kind === "look" ? true : d.kind === "text" ? false : drawn;

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

    if (focus) {
      if (on) this.lookHandle?.focus();
      else this.focusText();
    }

    cx.notify();
  }

  /** e, the bar's chip, cmd-shift-v on a table, patch or SVG: drawn <-> text. */
  toggleDrawn(cx: Context): void {
    const d = this.shown();

    if (d.kind === "look") return this.say(`This ${d.path.split(".").pop() ?? ""} is drawn only: o opens the system's app`);

    if (d.kind === "text") return this.say("Not a kind the preview draws");

    this.setDrawn(d, !d.look, cx);
  }

  /** A key on a drawn tab (tabs.ts lookAction): tabs, scrolling, as text,
   *  the preview pane, the system's app, the path, close, the keys. */
  lookKey(e: KeyEvent, cx: Context): void {
    if (this.keysShown) return;

    const r = lookAction(this.lookPending, e);

    this.lookPending = r.pending;

    if (!r.taken) return;

    cx.stop_propagation();

    if (r.act) this.lookAct(r.act, cx);

    cx.notify();
  }

  lookAct(act: LookAct, cx: Context): void {
    const d = this.shown();
    const me = this.me();
    const where = { path: d.path, ...whereArgs(me?.pane, this.on) };

    switch (act) {
      case "next-tab":
        return this.stepTab(1, cx);
      case "prev-tab":
        return this.stepTab(-1, cx);
      case "move-tab-right":
        return this.stepMove(1, cx);
      case "move-tab-left":
        return this.stepMove(-1, cx);
      case "down":
      case "up":
        this.scrollN += 1;

        return this.syncViewer({ scroll: { n: this.scrollN, dir: act === "down" ? 1 : -1 } });
      case "text":
        return this.toggleDrawn(cx);
      case "pane":
        run("preview.open", where);

        return;
      case "system":
        run("preview.open", { path: d.path, in: "system", ...whereArgs(null, this.on) });

        return;
      case "copy":
        try {
          cx.write_to_clipboard(this.on ? `${this.on}:${d.path}` : d.path);
        } catch {
          /* no clipboard */
        }

        return this.say("path copied");
      case "close":
        return this.closeTab(cx);
      case "keys":
        return this.toggleKeys(!this.keysShown);
    }
  }

  /** A file a link points at (a card's, the Markdown preview's, a drawn
   *  picture's): drawn kinds as a drawn tab here, another machine's in the
   *  preview beside (the viewer reads only this computer's pictures). */
  openLooked(path: string, cx: Context): void {
    if (this.on) {
      const me = this.me();

      run("preview.open", { path, ...whereArgs(me?.pane, null), on: this.on });

      return;
    }

    this.openFile(path, cx, { look: true });
  }

  /** The next (1) or previous (-1) tab. */
  stepTab(dir: number, cx: Context): void {
    if (this.docs.length < 2) return this.say("one tab");

    const next = this.docs[stepTab(this.docs.length, this.docs.indexOf(this.shown()), dir)];

    if (next) this.select(next, cx);
  }

  /** Moves tab `from` to index `to` (a drag's drop, ]B / [B, :tabm): the
   *  order is kept for a restart and told to the routing (shared PATHS). */
  moveTab(from: number, toIndex: number | null, cx: Context | null = null): void {
    const n = this.docs.length;

    if (from < 0 || from >= n || toIndex === null) return;

    const to = Math.max(0, Math.min(n - 1, toIndex));

    if (to === from) return;

    this.docs = moved(this.docs, from, to);
    this.keepTabs();
    this.publish();
    cx?.notify();
  }

  /** The shown tab one place right (1) or left (-1); `:tabm`'s "N", "+N",
   *  "-N" or "$" (the end) as `spec`. */
  stepMove(dir: number, cx: Context, spec: string | null = null): void {
    const n = this.docs.length;
    const i = this.docs.indexOf(this.shown());

    if (n < 2) return this.say("one tab");

    const to = spec === null ? i + dir : spec === "$" ? n - 1 : /^[+-]/.test(spec) ? i + Number(spec) : Number(spec);

    if (!(to >= 0 && to < n)) return this.say(dir < 0 || (spec ?? "").startsWith("-") ? "the first tab" : "the last tab");

    this.moveTab(i, to, cx);
  }

  // ---- dragging a tab along the strip (tabs.ts)

  /** The pointer moved over a gap with a press down: past DRAG_START it's a
   *  drag, and the gap it's over is where the stake stands. */
  dragOver(gap: Gap, e: MouseMoveEvent, cx: Context): void {
    const p = this.tabPress;

    if (!p) return;

    if (!this.tabDrag) {
      if (Math.abs(e.position.x - p.x) < DRAG_START) return;

      this.tabDrag = { from: p.index, gap: null, out: false };
    }

    const g = this.tabDrag.gap;

    if (g && g.index === gap.index && g.after === gap.after && !this.tabDrag.out) return;

    this.tabDrag.gap = gap;
    this.tabDrag.out = false;
    cx.notify();
  }

  /** The press let go on the strip: a drag drops where its stake stands. */
  dropTab(cx: Context): void {
    const d = this.tabDrag;

    this.tabDrag = null;
    this.tabPress = null;

    if (!d) return;

    this.moveTab(d.from, dropIndex(this.docs.length, d.from, d.gap), cx);
    cx.notify();
  }

  /** The pointer left the strip with a tab dragged: over the pane it's
   *  dropped out (popped into a pane of its own); off the pane it ends. */
  leaveStrip(cx: Context): void {
    if (!this.tabDrag) {
      this.tabPress = null;

      return;
    }

    this.tabDrag.out = true;
    this.tabDrag.gap = null;
    cx.notify();
  }

  /** A tab dragged off the strip, let go over the pane: popped out beside. */
  dropOut(cx: Context): void {
    const d = this.tabDrag ? this.docs[this.tabDrag.from] : undefined;

    this.tabDrag = null;
    this.tabPress = null;

    if (d) this.popOut(cx, d, "beside");

    cx.notify();
  }

  /** Over the pane while a tab is dragged off the strip: where it goes. */
  dropZone(t: Theme): Element {
    const drag = this.tabDrag;

    if (!drag) return div();

    const d = this.docs[drag.from];

    return div()
      .id("editor-drop-out")
      .absolute()
      .left(8)
      .right(8)
      .top(this.stripH() + 6)
      .bottom(8)
      .border(1)
      .border_color(t.accent)
      .child(div().absolute().inset_0().opacity(0.18).child(dither(t.accent, 1)))
      .child(
        v_flex()
          .absolute()
          .inset_0()
          .items_center()
          .justify_center()
          .gap(4)
          .child(div().text_color(t.foreground).child(`let go: ${basename(d?.path ?? "")} into its own pane`))
          .child(div().text_color(t.dim).child("back on the strip: moves it there · off the pane: nothing")),
      );
  }

  /** The pointer left the pane: the drag ends where it started. */
  cancelDrag(cx: Context): void {
    const dragging = Boolean(this.tabDrag);

    this.tabDrag = null;
    this.tabPress = null;

    if (dragging) cx.notify();
  }

  /** Closes tab `d` (the shown one by default): with unsaved changes it
   *  asks first (the question's line: save, discard, keep), unless
   *  `confirmed`. The last tab closes the pane. */
  closeTab(cx: Context, d: Doc | null = this.cur, confirmed = false): void {
    if (!d) return;

    if (d.dirty && !confirmed) {
      if (d !== this.cur) this.select(d, cx);

      this.asking = { doc: d, at: "save" };
      cx.notify();

      return;
    }

    this.asking = null;
    void d.autosave?.flush();

    if (this.docs.length <= 1) {
      d.dirty = false;
      this.noteUnsaved();

      const me = this.me();

      run("pane.close", { ...whereArgs(me?.pane, null), confirmed: true });

      return;
    }

    const i = this.docs.indexOf(d);
    const next = afterClose(this.docs.length, this.docs.indexOf(this.shown()), i);

    this.releaseDoc(d);
    this.docs.splice(i, 1);

    const show = (next === null ? undefined : this.docs[next]) ?? this.docs[0];

    if (show && (show !== this.cur || d === this.cur)) this.select(show, cx);

    this.noteUnsaved();
    this.title();
    this.keepTabs();
    this.publish();
    cx.notify();
  }

  /** The question on closing an edited tab: save and close, discard, or keep it open. */
  answerClose(choice: Answer, cx: Context): void {
    const a = this.asking;

    if (!a) return;

    this.asking = null;

    if (choice === "keep") {
      this.editor.focus();
      cx.notify();

      return;
    }

    if (choice === "discard") return this.closeTab(cx, a.doc, true);

    // Save, then close if it was written.
    void this.later(cx, async (cx) => {
      await this.saveNow(cx, a.doc);

      if (!a.doc.dirty) this.closeTab(cx, a.doc, true);

      cx.notify();
    });
  }

  /** A tab going: its server document closes, the server is let go when no
   *  other tab uses it, its folder watch ends. */
  releaseDoc(d: Doc): void {
    d.watchGen += 1;
    d.gone = true;

    const id = serverId(d.server);

    if (id === null) return;

    lspNotify(id, "textDocument/didClose", { textDocument: { uri: uri(d.path) } });

    if (!this.allDocs().some((x) => x !== d && serverId(x.server) === id)) {
      lspRelease(id);
      this.listening.delete(id);
    }
  }

  /** This copy's own pane (found by its slot). */
  me(): { readonly pane: string; readonly tab: string } | null {
    return panes().find((p) => p.mod === MOD && paneProps(p).slot === this.slot) ?? null;
  }

  /** The tabs as kept for a restart (localStorage). */
  keepTabs(): void {
    if (!this.docs.length) return;

    try {
      localStorage.setItem("tabs", JSON.stringify(keptTabs(this.docs.map((d) => d.path), this.docs.indexOf(this.shown()))));
    } catch {
      /* a nicety */
    }
  }

  /** Every file here, for the files pane, the picker and the app's
   *  editor.open to find the editor holding one (shared PATHS by slot). */
  publish(): void {
    const slot = this.slot;

    if (!slot) return;

    const live = new Set(panes().flatMap((p) => (p.mod === MOD && paneProps(p).slot ? [paneProps(p).slot] : [])));
    const was = editorPaths(shared);
    const mine = this.allDocs().map((d) => d.path);

    if (JSON.stringify(was.get(slot)) === JSON.stringify(mine) && [...was.keys()].every((k) => live.has(k) || k === slot)) return;

    const next = new Map([...was].filter(([k]) => live.has(k)));

    next.set(slot, mine);
    writeSharedMap(setShared, PATHS_KEY, next);
  }

  /** What closing the pane asks: every tab with unsaved changes, once. */
  noteUnsaved(): void {
    setUnsaved(unsavedNote(this.allDocs()));
  }

  // ---- the file

  /** The pane header's name (nocturne/header.ts): the shown tab's. */
  title(): void {
    const slot = this.slot;

    if (!slot) return;

    const name = this.scratch ? `Scratchpad · ${noteName(this.path)}` : basename(this.path) + (this.dirty ? " ●" : "");
    const all = readSharedMap(shared, TITLES_KEY);

    if (all.get(slot) !== name) writeSharedMap(setShared, TITLES_KEY, new Map([...all, [slot, name]]));
  }

  // ---- the files pane's renames, moves and deletes (follow.ts)

  /** Acts on the change record's entries newer than the last seen, for every
   *  tab (from a task, never a render). */
  followChanges(cx: Context): void {
    const list = fileChanges(shared);
    const from = this.seenChange;
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
  moveTo(to: string, cx: Context, d: Doc = this.shown()): void {
    const from = d.path;
    const id = serverId(d.server);

    if (d.look) {
      d.path = to;
      d.deleted = false;
      d.kind = tabKind(to);

      if (d.kind === "text") {
        d.look = false;
        d.state = "unloaded";
      }

      if (d === this.cur) {
        this.syncViewer();

        if (!d.look) this.select(d, cx, null, true);
      }

      this.title();
      this.keepTabs();
      this.publish();

      return;
    }

    if (id !== null) lspNotify(id, "textDocument/didClose", { textDocument: { uri: uri(from) } });

    d.path = to;
    d.deleted = false;

    const own = props();

    if (d.firstPath === ((isPaneProps(own) ? own.path : undefined) ?? d.firstPath)) {
      try {
        localStorage.setItem("moved", JSON.stringify({ from: d.firstPath, to }));
      } catch {
        /* a nicety */
      }
    }

    const lang = languageOf(to) ?? "text";

    if (lang !== d.lang) {
      // Another language: its grammar, settings and server.
      d.lang = lang;
      d.opts = languageSettings(settings().editor, lang);
      d.editor.set_language(lang);
      d.markdown = lang === "markdown";

      if (id !== null && !this.allDocs().some((x) => x !== d && serverId(x.server) === id)) {
        lspRelease(id);
        this.listening.delete(id);
      }

      d.server = null;
      this.setProblems([], d);

      if (d.state === "ready") void this.startServer(cx, false, d);
    } else if (id !== null) {
      d.version += 1;
      d.sent = d.editor.value();
      lspNotify(id, "textDocument/didOpen", { textDocument: { uri: uri(to), languageId: languageId(lang, to), version: d.version, text: d.sent } });
    }

    if (!this.on && d.state !== "unloaded") this.watch(cx, d);

    this.noteUnsaved();
    this.title();
    this.keepTabs();
    this.publish();

    if (d === this.cur) this.say(`moved to ${tilde(dirname(to), home())}`);
  }

  /** The file was deleted: the editor keeps its text and says so; a save writes it again. */
  markDeleted(cx: Context, d: Doc = this.shown()): void {
    d.deleted = true;
    d.saved = null; // a save creates it (writeTextFile's "new file")
    d.conflict = false;
    d.dirty = d.editor.value() !== "";
    this.noteUnsaved();
    this.title();
    cx.notify();
  }

  /** Reads tab `d`'s file; `go`: the place to put the caret after. `quiet`: a
   *  poll or a change on disk, which leaves an edited buffer alone. */
  load(cx: Context, go: Go | null, quiet: boolean, d: Doc = this.shown()): void {
    // Drawn: the viewer reads it; a change on disk draws it again.
    if (d.look) {
      if (d === this.cur && quiet) this.syncViewer({ reload: this.viewerProps.reload + 1 });

      return;
    }

    if (!d.path) {
      d.state = "error";
      d.error = "No file given: editor.open {path}.";

      return;
    }

    cx.spawn(async (cx) => {
      let text: string | null = null;
      let error: string | null = null;

      try {
        text = await readTextFile(d.path, { on: this.on });

        if (text !== null && text.includes("\0")) {
          text = null;
          error = "Not a text file: it holds binary data.";
        }
      } catch (cause) {
        error = errorText(cause);
      }

      if (d.gone) return;

      if (quiet) {
        // Our own write (the autosave's, maybe read while it was under way) isn't news.
        if (text === null || text === d.saved || text === d.writing) return;

        // Edited (a scratchpad: typed but not written yet): it asks, never drops what's typed.
        if (d.dirty || (d.scratch && d.saveState !== "saved")) {
          if (text !== d.editor.value()) d.conflict = true;

          cx.notify();

          return;
        }

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
        const id = serverId(d.server);

        if (id !== null) lspNotify(id, "textDocument/didSave", { textDocument: { uri: uri(d.path) }, text });

        cx.notify();

        return;
      }

      if (error) {
        d.state = "error";
        d.error = error;
        cx.notify();

        return;
      }

      if (text === null) {
        d.state = "missing";
        d.saved = null;
        d.editor.set_value("");
      } else {
        d.state = "ready";
        d.saved = text;
        d.editor.set_value(text);
      }

      // Handed over with unsaved changes: that text, unsaved here too.
      const hand = d.hand;

      d.hand = null;

      if (hand?.text !== null && hand?.text !== undefined) d.editor.set_value(hand.text);

      d.text = hand?.text ?? text ?? "";

      if (d.markdown) this.refreshPreview(cx, true, d);

      d.dirty = hand?.text !== null && hand?.text !== undefined && hand.text !== (d.saved ?? "");
      d.conflict = false;

      if (hand) {
        d.editor.set_cursor(hand.caret.line, hand.caret.col);

        if (hand.top) d.editor.scroll_to_line(hand.top);
      }

      this.noteUnsaved();
      this.title();

      const place = go ?? d.go;

      d.go = null;

      if (place && d === this.cur) this.goto(place.line - 1, (place.col ?? 1) - 1, cx);

      if (d.markdown && d.view === "rendered") {
        d.rendered?.open(cx);

        if (d === this.cur) this.focusText();
      }

      cx.notify();

      if (d.state === "ready" && !d.server) void this.startServer(cx, false, d);
    });
  }

  /** Waits for tab `d`'s folder to change, and reads its file again. */
  watch(cx: Context, d: Doc = this.shown()): void {
    const dir = dirname(d.path);

    // A moved file's tab watches its new folder; the old loop ends (and a closed tab's).
    d.watchGen += 1;

    const gen = d.watchGen;

    cx.spawn(async (cx) => {
      for (;;) {
        let changed: string[];

        try {
          changed = await watchFolder(dir);
        } catch {
          return;
        }

        if (gen !== d.watchGen || d.gone) return;

        if (!changed.some((p) => basename(p) === basename(d.path) || p === dir)) continue;

        this.load(cx, null, true, d);
      }
    });
  }

  changed(cx: Context, d: Doc = this.shown()): void {
    d.text = d.editor.value();
    d.hovers.clear();

    // Typing closes the card.
    if (this.card && d === this.cur) this.closeCard(cx);

    // The preview's blocks are cut again only where they're shown (rendered draws its own):
    // a keystroke in the rendered view doesn't re-split the whole document.
    if (d.markdown && d.view !== "rendered") this.refreshPreview(cx, false, d);
    else if (d.markdown) d.previewStale = true;

    if (d.markdown && d.view === "rendered") d.rendered?.pull(cx);

    if (d.scratch) {
      // A scratchpad saves itself: never unsaved, written a moment after the typing.
      if (d.text !== (d.saved ?? "")) {
        this.timerCx = cx;
        d.autosave?.touch();
      }

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

  save(cx: Context): Promise<void> {
    const d = this.shown();

    return this.later(cx, (cx) => this.saveNow(cx, d));
  }

  async saveNow(cx: Context, d: Doc = this.shown()): Promise<void> {
    if (d.state === "error" || d.state === "unloaded" || d.state === "loading") return;

    let text = d.editor.value();

    if (d.opts.format_on_save && d.opts.format) text = (await this.format(text, cx, d)) ?? text;

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

      const id = serverId(d.server);

      if (id !== null) lspNotify(id, "textDocument/didSave", { textDocument: { uri: uri(d.path) }, text });
      else if (!d.server) void this.startServer(cx, false, d);
    } catch (cause) {
      this.say(errorText(cause), true);

      if (/changed outside/.test(errorText(cause))) d.conflict = true;
    }

    cx.notify();
  }

  /** Runs settings.json's `format` on the text (it reads stdin, prints the
   *  result); puts the result in as one undoable edit. Null when it fails. */
  async format(text: string, _cx: Context, d: Doc = this.shown()): Promise<string | null> {
    const tmp = `${appHome()}/cache/editor/format-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      await writeTextFile(tmp, text, null);

      const r = await exec("sh", ["-c", 'f="$1"; shift; "$@" < "$f"', "format", tmp, ...(d.opts.format ?? [])], { cwd: dirname(d.path) });

      exec("rm", ["-f", tmp]).catch(() => null);

      if (r.code !== 0 || !r.stdout) {
        this.say(`formatter failed: ${r.stderr.split("\n")[0] ?? ""}`, true);

        return null;
      }

      if (r.stdout !== text) {
        const lines = text.split("\n");

        d.editor.edit([{ start: { line: 0, col: 0 }, end: { line: lines.length - 1, col: (lines.at(-1) ?? "").length }, text: r.stdout }]);
      }

      return r.stdout;
    } catch (cause) {
      this.say(`formatter: ${errorText(cause)}`, true);

      return null;
    }
  }

  say(text: string, bad = false): void {
    this.message = { text, bad, at: Date.now() };
  }

  // ---- language server

  /** A step of the way to the server's answers, for a look at where the time
   *  goes: `HERDR_APP_LOG=info,gpui_shell::script=debug` prints them. */
  mark(what: string, d: Doc | null = this.cur): void {
    console.debug(`lsp ${basename(d?.path ?? "")} +${Date.now() - (d?.openedAt ?? Date.now())}ms ${what}`);
  }

  /** Starts (or joins) tab `d`'s language server as it opens, so it is warm
   *  by the time anything is asked: the project's environment from disk when
   *  nothing it depends on changed (envrc.ts), the lookups side by side, then
   *  herdr's session for this server and workspace (one per project: every
   *  tab and editor of it shares it). `fresh`: the kept environment's server
   *  is gone (garbage-collected): load it anew. */
  async startServer(cx: Context, fresh = false, d: Doc = this.shown()): Promise<void> {
    const redraw = (): void => {
      if (d === this.cur) this.cardState(cx);

      cx.notify();
    };

    if (this.on) {
      d.server = { status: "none", why: "remote" };

      return;
    }

    const candidates = serverCandidates(d.lang, d.opts);

    if (!candidates.length) {
      d.server = { status: "none", why: d.opts.server === false ? "off" : "unknown" };
      cx.notify();

      return;
    }

    const names = candidates.map((c) => basename(c.argv[0] ?? ""));
    const dir = dirname(d.path);

    // The workspace's own environment first (envrc.ts): its .envrc, through direnv.
    this.mark("start", d);

    const env = await projectEnv(exec, dir, {
      cache: envCache,
      fresh,
      loading: (at) => {
        d.server = { status: "env", envrc: at, names };
        this.mark("environment: loading with direnv", d);
        cx.notify();
      },
    });

    if (d.gone) return;

    this.mark(`environment: ${env.kind}${env.kind === "ready" && env.cached ? " (kept on disk; refreshing behind)" : ""}`, d);

    const inEnv = env.kind === "ready" ? env.env : null;
    // Every candidate's path and the workspace root at once: each is a process.
    const markers = ROOTS.get(d.lang)?.markers ?? [];

    const [paths, r] = await Promise.all([
      Promise.all(candidates.map((c) => {
        const program = c.argv[0] ?? "";

        return program.startsWith("/") ? Promise.resolve(program) : lookup(exec, program, inEnv);
      })),
      exec("sh", ["-c", rootScript(markers), "root", dir]).catch(() => null),
    ]);

    if (d.gone) return;

    const at = paths.findIndex(Boolean);
    const pick = at >= 0 ? candidates[at] : undefined;
    const path = paths[at] ?? null;

    if (!pick && env.kind === "ready" && env.cached && !fresh) return this.startServer(cx, true, d);

    // Not there: why, for the bar and the hover card (logic.ts serverNote).
    const envNote =
      env.kind === "none"
        ? {}
        : env.kind === "blocked"
          ? { envrc: env.dir, envKind: env.kind, envNote: null, denied: env.denied }
          : env.kind === "failed"
            ? { envrc: env.dir, envKind: env.kind, envNote: env.note, denied: false }
            : { envrc: env.dir, envKind: env.kind, envNote: null, denied: false };

    if (!pick || path === null) {
      d.server = { status: "none", why: "missing", names, ...envNote };
      redraw();

      return;
    }

    this.mark(`lookup: ${path}`, d);

    const root = pickRoot(d.lang, r?.stdout, dir);
    const argv = wrap(pick.argv, path, inEnv);
    const name = basename(pick.argv[0] ?? "");

    d.server = { status: "starting", argv, root, name, ...envNote };
    cx.notify();

    let started: Awaited<ReturnType<typeof lspStart>>;

    this.mark("lspStart", d);

    // The settings go out as the server's own (an object; another JSON value isn't sent).
    const settingsOut = isJsonObject(pick.settings) ? pick.settings : null;

    try {
      started = await lspStart({ argv, root, settings: settingsOut, idle: SERVER_IDLE });
    } catch (cause) {
      d.server = { status: "exited", name, note: errorText(cause), ...envNote };
      redraw();

      return;
    }

    const id = started.id;

    if (d.gone) {
      // Closed while it started: let go unless another tab holds it.
      if (!this.allDocs().some((x) => serverId(x.server) === id)) lspRelease(id);

      return;
    }

    const caps: ServerCaps = isServerCaps(started.capabilities) ? started.capabilities : {};

    d.server = { status: "ready", argv, root, name, id, caps, ...envNote };
    this.mark("initialized", d);

    // The server's work is the server's: tabs sharing it share what's under way.
    const sibling = this.allDocs().find((x) => x !== d && serverId(x.server) === id);

    if (sibling) {
      d.progress = sibling.progress;
      d.lastWork = sibling.lastWork;
    } else {
      d.progress.clear();
      d.lastWork = Date.now();
    }

    d.version = 1;
    d.sent = d.editor.value();
    lspNotify(id, "textDocument/didOpen", { textDocument: { uri: uri(d.path), languageId: languageId(d.lang, d.path), version: d.version, text: d.sent } });
    this.listen(id, cx);
    redraw();
  }

  /** The server's messages, once per server however many tabs use it
   *  (herdr keeps one queue per copy): diagnostics go to the tab of their
   *  file, work and an exit to every tab on it. */
  listen(id: number, cx: Context): void {
    if (this.listening.has(id)) return;

    this.listening.add(id);

    const on = (): Doc[] => this.allDocs().filter((d) => serverId(d.server) === id);

    cx.spawn(async (cx) => {
      for (;;) {
        let m: Awaited<ReturnType<typeof lspNextMessage>>;

        try {
          m = await lspNextMessage(id);
        } catch {
          this.listening.delete(id);

          return;
        }

        if (!this.listening.has(id) || !on().length) {
          this.listening.delete(id);

          return;
        }

        if (m.method === "textDocument/publishDiagnostics") {
          const params = m.params;

          if (!isPublishedDiagnostics(params)) continue;

          const d = on().find((x) => uri(x.path) === params.uri);

          if (d) {
            // Each diagnostic as LSP has it; one in another shape is left out.
            this.setProblems(diagnostics(params.diagnostics.filter((x) => isLspDiagnostic(x))), d);
            cx.notify();
          }
        } else if (m.method === "$/progress") {
          if (isProgressParams(m.params)) this.progressed(m.params, cx, id);
        } else if (m.method === "$/exit") {
          const stderr = isExitParams(m.params) ? (m.params.stderr ?? []) : [];
          const lastLine = stderr.at(-1);
          const note = isString(lastLine) ? lastLine : "it stopped";

          for (const d of on()) {
            const s = d.server;

            d.server = { status: "exited", name: s && "name" in s ? s.name : "server", note };
            d.progress.clear();
          }

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
  progressed(params: ProgressParams, cx: Context, id: number | null = serverId(this.cur?.server)): void {
    const docs = this.allDocs().filter((d) => serverId(d.server) === id);
    const d0 = docs.find((d) => d === this.cur) ?? docs[0] ?? this.cur;

    if (!d0) return;

    const progress = d0.progress;
    const token = String(params.token);
    const v = params.value;
    const wasBusy = busy(progress);

    if (!/\b(cargo check|check|clippy|flycheck)\b/i.test(v.title ?? progress.get(token)?.title ?? "")) {
      const now = Date.now();

      for (const d of docs.length ? docs : [d0]) d.lastWork = now;
    }

    if (v.kind === "begin") {
      progress.set(token, v.percentage === undefined ? { title: v.title ?? "", message: v.message ?? "" } : { title: v.title ?? "", message: v.message ?? "", percentage: v.percentage });
      this.mark(`begin ${v.title ?? ""}`, d0);
    } else if (v.kind === "report") {
      const work = progress.get(token);

      if (!work) return;

      if (v.message !== undefined) work.message = v.message;

      if (v.percentage !== undefined) work.percentage = v.percentage;
    } else {
      this.mark(`end ${progress.get(token)?.title ?? token}`, d0);
      progress.delete(token);
    }

    if (v.kind === "end" && !busy(progress)) {
      for (const d of docs.length ? docs : [d0]) d.hovers.clear();

      if (wasBusy && d0 === this.cur) this.cardState(cx);
    }

    // Reports come by the hundred while it indexes: one redraw per frame or so.
    if (this.redrawSoon) return;

    this.redrawSoon = true;
    cx.timer.after(50, (cx) => {
      this.redrawSoon = false;
      cx.notify();
    });
  }

  setProblems(list: Problem[], d: Doc = this.shown()): void {
    d.problems = list;

    const t = theme();
    const colors = { error: t.ansi1, warning: t.ansi3, info: t.ansi4, hint: t.dim };

    d.editor.set_diagnostics(list.map((p) => editorProblem(p)));
    d.editor.set_line_notes(lineNotes(list, colors).map((n) => ({ ...n, color: n.color + "bb" })));
  }

  /** Tells the server about an edit: what changed since it last heard, as one
   *  ranged change (the whole text for servers that want it, or when another
   *  editor has the file open too: their buffers differ), a moment after the
   *  typing, or at once (`now`; before every question). */
  didChange(cx: Context, now: boolean, d: Doc = this.shown()): void {
    if (serverId(d.server) === null) return;

    if (now) return this.flush(d);

    if (d.flushDue) return;

    d.flushDue = true;
    cx.timer.after(CHANGE_DELAY, () => this.flush(d));
  }

  flush(d: Doc = this.shown()): void {
    d.flushDue = false;

    const s = d.server;

    if (s?.status !== "ready") return;

    const text = d.editor.value();

    if (text === d.sent) return;

    // Another editor pane holding the file (any of its tabs): their buffers differ.
    const paths = editorPaths(shared);
    const alone = !panes().some((p) => p.mod === MOD && paneProps(p).slot !== this.slot && filesOf(p, paths).includes(d.path));
    const change = (d.sent !== null && alone && incremental(s.caps) ? changeBetween(d.sent, text) : null) ?? { text };

    d.sent = text;
    d.version += 1;
    lspNotify(s.id, "textDocument/didChange", { textDocument: { uri: uri(d.path), version: d.version }, contentChanges: [change] });
  }

  /** A question about a place (the caret by default). `key`: a newer question
   *  with the same key cancels this one at the server (herdr's lspRequest). */
  async request<T>(method: string, guard: Guard<T>, extra: LspExtra = {}, line: number | null = null, col: number | null = null, key: string | null = null): Promise<T | null> {
    const id = serverId(this.server);

    if (id === null) return null;

    this.flush();

    const at = line === null ? this.editor.cursor() : { line, col: col ?? 0 };
    const answer = await lspRequest(id, method, { textDocument: { uri: uri(this.path) }, position: { line: at.line, character: at.col }, ...extra }, key ? { key } : undefined);

    // An answer in another shape counts as none.
    return guard(answer) ? answer : null;
  }

  definition(cx: Context): Promise<void> {
    return this.later(cx, (cx) => this.definitionNow(cx));
  }

  async definitionNow(cx: Context): Promise<void> {
    let loc = null;

    try {
      loc = firstLocation(await this.request("textDocument/definition", isLocations, {}, null, null, "definition"));
    } catch (cause) {
      if (!/cancelled/.test(errorText(cause))) this.say(errorText(cause), true);
    }

    if (!loc) {
      // Still loading the workspace: say so, rather than "not found".
      const work = busy(this.progress) ? progressWord(this.progress) : null;

      if (work) this.say(`${serverName(this.server) ?? "the server"} is busy: ${work}`);
      else if (serverId(this.server) !== null) this.say("no definition found");
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

  hovered(e: EditorHoverEvent, cx: Context): void {
    if (!e.hovering) {
      // Leaving the word: the card goes unless the pointer went onto it.
      cx.timer.after(250, (cx) => {
        if (!this.overCard && this.card && !this.card.keyboard) {
          this.card = null;
          cx.notify();
        }
      });

      return;
    }

    // A card asked for with the keyboard stays until it's closed.
    if (this.card?.keyboard) return;

    if (e.line === undefined || e.col === undefined) return;

    this.showCard(e.line, e.col, false, cx);
  }

  /** The card for a place: its problems at once, the server's hover when it
   *  answers. `keyboard`: asked for (cmd-i, K, a problem gone to); the
   *  pointer's card says nothing when there's nothing to say. */
  showCard(line: number, col: number, keyboard: boolean, cx: Context, level = 0): void {
    const here = diagnosticsAt(this.problems, line, col);

    const card: Card = {
      line,
      col,
      keyboard,
      problems: here,
      parts: [],
      level,
      more: false,
      pending: true,
      note: null,
      scroll: 0,
      opened: Date.now(),
      asked: null,
      inflight: 0,
      reasked: false,
      waitingOn: false,
      links: [],
      link: null,
      contentH: null,
      viewH: null,
      drawn: false,
    };

    this.card = card;
    this.watchFocus(card, cx);
    this.cardState(cx);
    cx.notify();
  }

  /** The card's question, as the server stands: answered from what's known,
   *  asked, or waiting (with what it waits for) until the server can answer;
   *  called again when it can (started, done indexing, stopped). */
  cardState(cx: Context): void {
    const card = this.card;

    if (!card?.pending) return;

    const s = this.server;
    const key = `${card.line}:${card.col}:${card.level}`;
    const known = this.hovers.get(key);

    if (known) return this.answered(card, known, cx);

    if (serverId(s) === null) {
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
  ask(card: Card, cx: Context): void {
    const key = `${card.line}:${card.col}:${card.level}`;
    const verbosity = this.lang === "typescript" || this.lang === "tsx" || this.lang === "javascript" ? { verbosityLevel: card.level } : {};

    card.inflight += 1;
    cx.spawn(async (cx) => {
      let hover = null;
      let error: string | null = null;

      try {
        hover = await this.request("textDocument/hover", isHover, verbosity, card.line, card.col, "hover");
      } catch (cause) {
        error = errorText(cause);
      }

      card.inflight -= 1;

      const answer: HoverAnswer | null = error === null ? { parts: hoverParts(hover?.contents), more: hover?.canIncreaseVerbosityLevel === true } : null;

      // Something to say: kept for the place, and into the card open there.
      if (answer?.parts.length) {
        this.hovers.set(key, answer);

        const open = this.card;

        if (open?.pending && `${open.line}:${open.col}:${open.level}` === key) this.answered(open, answer, cx);

        return;
      }

      if (this.card !== card || !card.pending || card.inflight > 0) return; // gone, filled, or a newer ask decides

      // Nothing yet while the workspace loads ("content modified", or null): ask again.
      if (this.settling()) return this.askAgain(card, cx);

      if (error !== null && /cancelled/.test(error)) {
        if (!card.reasked) {
          card.reasked = true;

          return this.ask(card, cx);
        }

        error = "the question was cancelled twice";
      }

      if (answer) {
        this.hovers.set(key, answer);

        return this.answered(card, answer, cx);
      }

      card.pending = false;

      if (card.keyboard && !card.problems.length) card.note = { text: `${serverName(this.server) ?? "The language server"} didn't answer${error ? `: ${error}` : "."}`, fix: null };
      else if (!card.problems.length) this.card = null;

      cx.notify();
    });
  }

  /** The server is still loading the workspace: work under way, or some
   *  reported a moment ago (it pauses between phases). */
  settling(): boolean {
    return busy(this.progress) || Date.now() - this.lastWork < SETTLE;
  }

  /** A waiting card asks again: when the work ends (progressed), and once a
   *  second meanwhile, since a server can answer before it's all done. */
  askAgain(card: Card, cx: Context): void {
    card.waitingOn = true;
    cx.notify();
    cx.timer.after(1000, (cx) => {
      if (this.card === card && card.pending) this.cardState(cx);
    });
  }

  answered(card: Card, answer: HoverAnswer, cx: Context): void {
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
      if (card.keyboard) card.note = this.serverNote(true);
      else if (this.card === card) this.card = null;
    }

    cx.notify();
  }

  /** What a waiting card says: what the answer waits for. */
  waitWords(): string {
    const s = this.server;
    const name = serverName(s) ?? "the language server";

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
  watchFocus(card: Card, cx: Context): void {
    const had = this.editor.focused();

    const check = (cx: Context): void => {
      if (this.card !== card) return;

      const has = this.editor.focused();

      if (had && !has) return this.closeCard(cx);

      cx.timer.after(200, check);
    };

    cx.timer.after(200, check);
  }

  closeCard(cx: Context | null): void {
    if (!this.card) return;

    this.card = null;
    this.overCard = false;
    cx?.notify();
  }

  /** Why the hover has nothing (logic.ts serverNote), the paths as ~. */
  serverNote(empty = false): ServerNote | null {
    return serverNote(this.server, this.lang, { empty, tilde: (p) => tilde(p, home()) });
  }

  /** TypeScript's expandable hover: one level more (1) or less (-1). */
  hoverLevel(d: number, cx: Context): void {
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
  cardKey(e: KeyEvent, cx: Context): boolean {
    const c = this.card;

    if (!c) return false;

    const k = e.key;
    const m = e.modifiers;

    if (["shift", "control", "alt", "platform", "function", "capslock"].includes(k)) return false;

    const plain = !m.platform && !m.control && !m.alt;

    if (k === "escape" && plain && !m.shift) {
      this.closeCard(cx);

      return true;
    }

    // A card asked for with the keyboard: tab / shift-tab ring its links, enter follows the ringed one.
    const links = c.links;

    if (c.keyboard && links.length && k === "tab" && !m.platform && !m.control && !m.alt) {
      const n = links.length;

      c.link = c.link === null ? (m.shift ? n - 1 : 0) : (c.link + (m.shift ? n - 1 : 1)) % n;
      cx.notify();

      return true;
    }

    const ringed = c.link === null ? undefined : links[c.link];

    if (ringed && k === "enter" && plain && !m.shift) {
      this.followLink(ringed.url, cx);

      return true;
    }

    const page = Math.max(40, Math.round((c.viewH ?? 200) * 0.6));
    const scroll = m.control && !m.platform && !m.alt && (k === "d" || k === "u") ? (k === "d" ? page : -page) : plain && (k === "pagedown" || k === "pageup") ? (k === "pagedown" ? page : -page) : 0;

    if (scroll && this.cardOverflows()) {
      c.scroll = Math.max(0, Math.min((c.contentH ?? 0) - (c.viewH ?? 0), c.scroll + scroll));
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
  appKey(e: KeyEvent): boolean {
    const now = Date.now();
    let known = this.appKeys;

    if (!known || now - known.at > 3000) {
      let list: ReturnType<typeof keys> = [];

      try {
        list = keys();
      } catch {
        /* no keys: none taken */
      }

      known = { at: now, map: appBindings(list, MOD, "nocturne") };
      this.appKeys = known;
    }

    const bound = known.map.get(chordOf(e.keystroke));

    if (!bound) return false;

    if (bound.args === undefined) run(bound.command);
    else run(bound.command, bound.args);

    return true;
  }

  /** A link from the hover card: a web page in the shown tab's browser pane
   *  (a new one beside this editor when there's none), a file as a tab of
   *  this editor at its line (a picture, a PDF: the preview beside), mailto:
   *  and the like through the system. */
  followLink(url: string, cx: Context): void {
    const to = linkTarget(url, this.path);

    if (!to) return;

    this.closeCard(cx);

    if (to.kind !== "file") {
      if (to.kind === "web") this.openWeb(to.url);
      else run("app.open_url", { url: to.url, in: "system" });
    } else if (PREVIEWED.test(to.path)) this.openLooked(to.path, cx);
    else this.openFile(to.path, cx, { line: to.line, col: to.col });

    cx.notify();
  }

  /** A web page in a browser pane: the one in this editor's tab (browser's
   *  `open` command, by its slot: a new tab there, in front, with the keyboard),
   *  else a new browser pane beside this editor (app.open_url in the app). */
  openWeb(url: string): void {
    const me = this.me();
    const browser = me ? panes().find((p) => p.mod === "browser" && p.tab === me.tab && !p.parked && paneProps(p).slot) : undefined;
    const slot = browser ? paneProps(browser).slot : undefined;

    if (slot) {
      run(`browser.open:${JSON.stringify({ url, slot })}`);

      return;
    }

    run("app.open_url", { url, in: "app" });
  }

  /** Whether a card is drawn: the keyboard's always, the pointer's once it has something. */
  cardShown(c: Card): boolean {
    return c.keyboard || c.problems.length > 0 || c.parts.length > 0;
  }

  /** Runs `work` in a task: its cx lasts past an await, where an editor
   *  event's (a key, a click) refuses notify and timers once that call has
   *  returned. Resolves with what `work` returns. */
  later<T>(cx: Context, work: (cx: AsyncContext) => Promise<T> | T): Promise<T> {
    return new Promise((resolve, reject) =>
      cx.spawn(async (cx) => {
        try {
          resolve(await work(cx));
        } catch (cause) {
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        }
      }),
    );
  }

  cardOverflows(): boolean {
    const c = this.card;

    return Boolean(c) && (c?.contentH ?? 0) > (c?.viewH ?? 0) + 1;
  }

  // ---- moving around

  goto(line: number, col: number, cx: Context): void {
    this.closeCard(cx);
    this.editor.set_cursor(line, col);
    // Before the first layout there's nothing to scroll: try again once drawn.
    cx.timer.after(60, () => this.editor.set_cursor(line, col));

    // The rendered view lights the block holding that line.
    const d = this.cur;

    if (d?.markdown && d.view === "rendered" && d.rendered) {
      d.rendered.open(cx);
      d.rendered.focus();

      return;
    }

    this.editor.focus();
  }

  goLine(cx: Context): void {
    const g = parseGoto(this.lineInput?.value());

    if (!g) return;

    this.mode = null;
    this.goto(g.line - 1, g.col - 1, cx);
    cx.notify();
  }

  problem(dir: number, cx: Context): void {
    const at = this.editor.cursor();
    const d = nextProblem(this.problems, at.line, at.col, dir);

    if (!d) return this.say("no problems");

    this.goto(d.line, d.col, cx);
    this.showCard(d.line, d.col, true, cx);
  }

  // ---- find

  openFind(replace: boolean): void {
    this.mode = replace ? "replace" : "find";
    this.findAt = "find";

    const sel = this.editor.selection();

    if (sel.text && !sel.text.includes("\n")) this.findInput?.set_value(sel.text);

    this.findInput?.focus();
  }

  search(cx: Context): void {
    const q = this.findInput?.value() ?? "";

    if (q) this.find = this.editor.find(q, { case_sensitive: this.caseSensitive });
    else {
      this.editor.find_close();
      this.find = { count: 0, current: null };
    }

    cx.notify();
  }

  step(d: number, cx: Context): void {
    if (!this.findInput?.value()) return;

    this.find = d > 0 ? this.editor.find_next() : this.editor.find_prev();
    cx.notify();
  }

  replace(all: boolean, cx: Context): void {
    if (!this.findInput?.value()) return;

    this.find = this.editor.replace(this.replaceInput?.value() ?? "", all);
    cx.notify();
  }

  /** The find line's keyboard to stop `id`: a field's input, or the line itself for a chip. */
  findGo(id: string): void {
    this.findAt = id;

    if (id === "find") this.findInput?.focus();
    else if (id === "with") this.replaceInput?.focus();
    else this.handle?.focus();
  }

  /** A key on the find line, as every form takes them (form-keys.ts): tab /
   *  shift-tab walk its fields and chips, wrapping; space / enter press a
   *  chip (Aa flips); a field keeps its own enter (next, or replace). */
  findKey(e: KeyEvent, cx: Context): void {
    if (this.mode !== "find" && this.mode !== "replace") return;

    const stops = this.mode === "replace" ? REPLACE_STOPS : FIND_STOPS;
    const i = Math.max(0, stops.findIndex((s) => s.id === this.findAt));
    const here = stops[i];
    const a = formKey(stops, i, e.key, e.modifiers, e.key_char ?? null);

    if (!a || !here || a.act === "type" || (a.act === "submit" && here.kind === "text")) return;

    const id = here.id;

    if (a.act === "move") this.findGo(stops[a.to]?.id ?? "find");
    else if (a.act === "cancel") this.closeFind(cx);
    else if (a.act === "flip" || (a.act === "press" && id === "case")) {
      this.caseSensitive = !this.caseSensitive;
      this.search(cx);
    } else if (a.act === "press" && id === "prev") this.step(-1, cx);
    else if (a.act === "press" && (id === "replace-one" || id === "replace-all")) this.replace(id === "replace-all", cx);
    else if (a.act === "press" || a.act === "submit") this.step(1, cx);
    else if (a.act !== "none") return;

    cx.stop_propagation();
    cx.notify();
  }

  closeFind(cx: Context): void {
    if (this.mode === "find" || this.mode === "replace") this.editor.find_close();

    this.mode = null;

    if (this.view === "rendered" && this.cur?.rendered) this.cur.rendered.focus();
    else this.editor.focus();

    cx.notify();
  }

  // ---- vim

  /** Vim in this pane: its own switch when flipped (remembered for the pane),
   *  else settings.json's default `editor.vim` (on unless false). */
  vimOn(): boolean {
    return this.paneVim ?? settings().editor.vim !== false;
  }

  /** The pane's switch (the vim chip, cmd-k v, :novim): this pane only. */
  toggleVim(cx: Context): void {
    const on = !this.vimOn();

    this.paneVim = on;

    try {
      localStorage.setItem("vim", on ? "on" : "off");
    } catch {
      /* a nicety */
    }

    this.vimSettled(on);
    this.say(on ? "vim on in this pane" : "vim off in this pane");
    cx.notify();
  }

  /** Word wrap on or off in the shown tab (cmd-k z, space u w, :set wrap, the bar's chip). */
  setWrap(on: boolean | null, cx: Context): void {
    this.softWrap = on === null ? !this.softWrap : on;
    this.editor.set_soft_wrap(this.softWrap);
    this.say(this.softWrap ? "word wrap on" : "word wrap off");
    cx.notify();
  }

  /** Vim's state when it's turned on or off. */
  vimSettled(on: boolean): void {
    this.vim.mode = "normal";
    this.vim.keys = [];
    this.vim.ex = null;
    this.vim.pendingLeader = null;
    this.which = null;
    this.pending = "";
    this.editor.set_cursor_shape(on ? CARET.normal : "bar");
    this.vimWas = on;
  }

  /** A keystroke, before the editor sees it: vim's, or the editor's (false). */
  vimKey(e: KeyEvent, cx: Context): boolean {
    if (this.asking && this.askKey(e, cx)) return true;

    // The Markdown commands' list (cmd-.): its letter runs one.
    if (this.mdMenu) return this.mdMenuKey(e, cx);

    if (this.markdown && isMdMenuKey(e)) {
      this.openMdMenu(cx);

      return true;
    }

    if (this.cardKey(e, cx)) return true;

    if (this.appKey(e)) return true;

    if (this.markdown && !this.mode && this.imagePasteKey(e, cx)) return true;

    if (!this.vimOn() || this.state === "loading" || this.mode) return false;

    const k = token(e);

    if (k === null) return false;

    if (k === "<cr>" && this.renderedEnter(cx)) return true;

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

  /** Vim's enter in the rendered view, normal mode with nothing pending: not the `<cr>` motion
   *  (the caret dropping onto the blank line between blocks looked like nothing) but a new block
   *  below the lit one, typed into (rendered.ts enterBelow); `.` appends it again (as `A`). */
  renderedEnter(cx: Context): boolean {
    const d = this.cur;
    const v = this.vim;
    const rendered = d?.view === "rendered" ? d.rendered : null;

    if (!d || !rendered || v.mode !== "normal" || v.keys.length || v.ex !== null || v.pendingLeader || v.replaying) return false;

    const text = d.editor.value();
    const line = rendered.range.to;
    const end = { line, col: (text.split("\n")[line] ?? "").replace(/\r$/, "").length };

    beginInsert(v, text, end, ["A"]);

    if (!rendered.enterBelow(cx)) {
      v.mode = "normal";
      v.insertStart = null;

      return false;
    }

    cx.notify();

    return true;
  }

  /** The text as vim acts on it (vim.ts Doc): the text, the caret, the clipboard, the screen, the tabs. */
  doc(cx: Context): VimDoc {
    if (!this.text && this.state === "ready") this.text = this.editor.value();

    const lines = Math.max(4, Math.floor((this.size.height - BAR - HINTS) / 20 / 2));
    let clipboard: string | null = null;

    try {
      clipboard = cx.read_from_clipboard() ?? null;
    } catch {
      /* no clipboard */
    }

    // The screen's lines (H M L) and the tabs (H / L step them when there are several).
    let top = 0;

    try {
      top = Number(this.editor.top_line()) || 0;
    } catch {
      /* the first line */
    }

    return { text: this.text, cursor: this.editor.cursor(), clipboard, page: lines, top, rows: 2 * lines, tabs: this.allDocs().length };
  }

  /** What vim decided: one undoable edit for all its edits, the caret,
   *  selections, the mode's caret shape, the clipboard, commands. */
  vimApply(r: FeedResult | Played, doc: VimDoc, cx: Context): void {
    if (r.edits?.length) {
      const after = applyEdits(doc.text, r.edits);
      const d = editBetween(doc.text, after);

      if (d) this.editor.edit([d]);

      this.text = after;
    }

    const multi = "multi" in r ? r.multi : undefined;

    if (multi) this.editor.set_selections(multi.map((p) => ({ start: p, end: p })));
    else if (r.selections) this.editor.set_selections(r.selections.map((s) => (s.head === "start" ? { start: s.end, end: s.start } : { start: s.start, end: s.end })));
    else if (r.cursor) this.editor.set_cursor(r.cursor.line, r.cursor.col);

    if (r.mode) this.editor.set_cursor_shape(CARET[r.mode]);

    if (r.clipboard) cx.write_to_clipboard(r.clipboard.text);

    if ("which" in r && r.which !== undefined) this.which = r.which;

    if ("pending" in r && r.pending !== undefined) this.pending = r.pending;

    if (r.message) this.say(r.message, /^E\d/.test(r.message) || r.message.startsWith("not found"));

    if ("search" in r && r.search) {
      this.searchMark = r.search;
      this.find = this.editor.find(r.search.replace(/\\[<>]/g, ""), {});
    }

    for (const c of r.commands) this.vimCommand(c, cx);
  }

  vimCommand(c: string, cx: Context): void {
    const colon = c.indexOf(":");
    const name = colon >= 0 ? c.slice(0, colon) : c;
    const arg = colon >= 0 ? c.slice(colon + 1) : null;

    const closeHere = (confirmed: boolean): void => {
      const me = this.me();

      run("pane.close", confirmed ? { ...whereArgs(me?.pane, null), confirmed: true } : whereArgs(me?.pane, null));
    };

    // :q closes the pane with every tab: none may hold unsaved changes (:q! drops them).
    const edited = (): string[] => this.allDocs().flatMap((d) => (d.dirty ? [basename(d.path)] : []));

    switch (name) {
      case "save":
        void this.save(cx);

        return;
      case "save-quit":
        void this.save(cx).then(() => {
          if (!edited().length) closeHere(false);
          else this.say(`E37: unsaved changes in ${edited().join(", ")}`, true);
        });

        return;
      case "quit":
        if (edited().length) return this.say(`E37: unsaved changes in ${edited().join(", ")} (:q! discards them)`, true);

        return closeHere(false);
      case "quit!":
        for (const d of this.allDocs()) d.dirty = false;

        setUnsaved(null);

        return closeHere(true);
      case "reload":
        if (this.dirty) return this.say("E37: unsaved changes (:e! discards them)", true);

        return this.load(cx, null, false);
      case "reload!":
        this.dirty = false;

        return this.load(cx, null, false);
      // :e file opens it as a tab here.
      case "edit": {
        const file = arg ?? "";

        return this.openFile(file.startsWith("/") ? file : file.startsWith("~/") ? `${home()}/${file.slice(2)}` : join(dirname(this.path), file), cx);
      }

      case "next-tab":
        return this.stepTab(1, cx);
      case "prev-tab":
        return this.stepTab(-1, cx);
      case "tab": {
        const n = Number(arg);
        const d = this.docs[n - 1];

        if (!(n >= 1 && n <= this.docs.length) || !d) return this.say(`E86: no tab ${arg ?? ""}`, true);

        return this.select(d, cx);
      }

      case "close-tab":
        return this.closeTab(cx);
      case "close-tab!":
        return this.closeTab(cx, this.cur, true);
      case "move-tab-left":
        return this.stepMove(-1, cx);
      case "move-tab-right":
        return this.stepMove(1, cx);
      case "move-tab":
        return this.stepMove(0, cx, arg);
      case "pop-out":
        return this.popOut(cx);
      case "pop-out-tab":
        return this.popOut(cx, this.cur, "tab");
      case "pop-in":
        return this.popIn(cx);
      case "tab-menu":
        return this.openTabMenu(cx);
      case "tabs":
        return this.say(this.docs.map((d, i) => `${i + 1}${d === this.cur ? "%" : ""} ${basename(d.path)}${d.dirty ? " +" : ""}`).join("  "));
      case "undo":
        return this.editor.undo();
      case "redo":
        return this.editor.redo();
      case "nohlsearch":
        this.editor.find_close();
        this.searchMark = null;

        return;
      case "definition":
      case "next-problem":
      case "prev-problem":
      case "hover":
      case "problems":
        return this.command(name, cx);
      case "references":
        void this.references(cx);

        return;
      case "picker":
        run("nocturne.picker");

        return;
      case "grep":
        run("nocturne.grep");

        return;
      case "files-pane":
        run("nocturne.files");

        return;
      case "format":
        void this.formatNow(cx);

        return;
      case "code-action":
      case "rename":
        return this.say(`${name}: not here yet`);
      case "vim":
        return this.toggleVim(cx);
      case "keys":
        return this.command("keys", cx);
      case "preview":
      case "preview-split":
      case "preview-only":
      case "preview-text":
      case "preview-rendered":
      case "md-menu":
        return this.command(name, cx);
      case "set": {
        const opt = (arg ?? "").trim();

        if (opt === "wrap" || opt === "nowrap") return this.setWrap(opt === "wrap", cx);

        if (opt === "wrap!" || opt === "invwrap") return this.setWrap(null, cx);

        return this.say(`:set ${opt}: only :set wrap / nowrap / wrap! and :novim are known`);
      }

      case "wrap":
        return this.setWrap(null, cx);
      case "write":
        return this.say("E: :w <file> isn't supported; :w saves this file", true);
      default:
        // space . and a letter: a Markdown command (mdedit.ts).
        if (name.startsWith("md-")) this.mdRun(name.slice(3), cx);
    }
  }

  references(cx: Context): Promise<void> {
    return this.later(cx, (cx) => this.referencesNow(cx));
  }

  async referencesNow(cx: Context): Promise<void> {
    let answer = null;

    try {
      answer = await this.request("textDocument/references", isLocations, { context: { includeDeclaration: false } });
    } catch (cause) {
      return this.say(errorText(cause), true);
    }

    const count = isList(answer) ? answer.length : 0;

    if (!count) {
      this.say("no references");
      cx.notify();

      return;
    }

    this.say(`${count} reference${count === 1 ? "" : "s"}: going to the first`);

    const loc = firstLocation(answer);

    if (!loc) return;

    if (loc.path === this.path) this.goto(loc.line, loc.col, cx);
    else this.openFile(loc.path, cx, { line: loc.line + 1, col: loc.col + 1 });

    cx.notify();
  }

  formatNow(cx: Context): Promise<void> {
    return this.later(cx, (cx) => this.formatting(cx));
  }

  async formatting(cx: Context): Promise<void> {
    const d = this.shown();

    if (d.opts.format) {
      await this.format(d.editor.value(), cx, d);
      cx.notify();

      return;
    }

    const id = serverId(d.server);

    if (id === null) return this.say("no formatter: settings.json editor format");

    try {
      const edits = await lspRequest(id, "textDocument/formatting", { textDocument: { uri: uri(d.path) }, options: { tabSize: d.opts.tab_size, insertSpaces: d.opts.insert_spaces !== false } });

      if (isTextEdits(edits) && edits.length) d.editor.edit(edits.map((e) => ({ start: { line: e.range.start.line, col: e.range.start.character }, end: { line: e.range.end.line, col: e.range.end.character }, text: e.newText })));

      this.say("formatted");
    } catch (cause) {
      this.say(errorText(cause), true);
    }

    cx.notify();
  }

  // ---- commands (keys.json mod:editor)

  command(c: string, cx: Context): void {
    if (c === "focus") return this.view === "rendered" && this.cur?.rendered ? this.cur.rendered.focus() : this.editor.focus();

    if (c === "save") {
      void this.save(cx);

      return;
    }

    if (c === "find") return this.openFind(false);

    if (c === "replace") return this.openFind(true);

    if (c === "line") {
      this.mode = "line";
      this.lineInput?.set_value("");

      return this.lineInput?.focus();
    }

    if (c === "next-problem") return this.problem(1, cx);

    if (c === "prev-problem") return this.problem(-1, cx);

    if (c === "problems") {
      this.drawer = !this.drawer;

      return;
    }

    if (c === "definition") {
      void this.definition(cx);

      return;
    }

    // cmd-i (vim: K) opens the card at the caret, and closes an open one.
    // (A pointer's card still waiting isn't on screen: cmd-i opens the caret's then.)
    if (c === "hover") {
      if (this.card && this.cardShown(this.card)) return this.closeCard(cx);

      const at = this.editor.cursor();

      return this.showCard(at.line, at.col, true, cx);
    }

    if (c === "hover-more") return this.hoverLevel(1, cx);

    if (c === "hover-less") return this.hoverLevel(-1, cx);

    if (c === "reload") {
      this.dirty = false;

      return this.load(cx, null, false);
    }

    if (c === "vim") return this.toggleVim(cx);

    if (c === "wrap") return this.setWrap(null, cx);

    if (c === "keys") return this.toggleKeys(!this.keysShown);

    if (c === "preview" && this.kind === "either") return this.toggleDrawn(cx);

    if (c === "preview") return this.setView(VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length] ?? "split", cx);

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
      const arg = parseJson(c.slice(5), isOpenArg);

      if (!arg) return this.say('open: needs {"path": …}', true);

      const path = arg.path ?? "";

      if (!path) return;

      return this.openFile(path.startsWith("/") ? path : join(dirname(this.path), path), cx, { line: arg.line ?? null, col: arg.col ?? null, view: arg.view ?? null });
    }
  }

  // ---- the rendered view and the Markdown commands

  /** The keyboard to the shown tab's text: the rendered view's block, else the code editor. */
  focusText(): void {
    const d = this.cur;

    if (!d) return;

    if (d.look) this.lookHandle?.focus();
    else if (d.markdown && d.view === "rendered" && d.rendered) d.rendered.focus();
    else d.editor.focus();
  }

  /** What a tab's rendered view (rendered.ts) asks of the pane. */
  renderedHost(): RenderedHost {
    return {
      font: settings().font_family || "JetBrains Mono",
      colors: this.colors ?? syntaxColors(theme()),
      selection: selectionColor(theme()),
      zoom,
      dither: (color) => dither(color, 1),
      moon: (t) => svg("mods/nocturne/art/moon-8.svg").w(44).h(44).text_color(t.ansi8),
      onKey: (e, cx) => this.blockKey(e, cx),
      link: (url, cx) => this.previewLink(url, cx),
      notify: (cx) => cx?.notify(),
      mdRun: (name, cx) => this.mdRun(name, cx),
      image: (src) => this.image(src),
      loadImages: (srcs, cx) => this.loadImageSrcs(srcs, cx),
      pasteImage: (cx) => void this.pasteImage(cx),
      mdMenu: (cx) => this.openMdMenu(cx),
      vim: () => this.vimOn(),
    };
  }

  /** A key in the rendered view's block, before it: what the code editor would
   *  take first (the close question, the card, the app's keys, cmd-., vim over
   *  the whole text); the block then follows the caret. */
  blockKey(e: KeyEvent, cx: Context): boolean {
    const d = this.cur;
    const taken = this.vimKey(e, cx);

    if (d?.rendered) {
      if (taken) d.rendered.pull(cx);

      d.rendered.block.set_cursor_shape(this.vimOn() ? CARET[this.vim.mode] : "bar");
    }

    return taken;
  }

  /** Opens the Markdown commands' list (cmd-., vim: space .) at the caret. */
  openMdMenu(cx: Context): void {
    if (!this.markdown) return this.say("the Markdown commands are for Markdown files");

    this.mdMenu = { at: Date.now() };
    cx.notify();
  }

  /** A key while the list is open: a command's letter (a digit: that heading level) runs it; anything else closes it. */
  mdMenuKey(e: KeyEvent, cx: Context): boolean {
    const k = e.key;
    const m = e.modifiers;

    if (["shift", "control", "alt", "platform", "function", "capslock"].includes(k)) return true;

    this.mdMenu = null;

    const ch = isString(e.key_char) && e.key_char.length === 1 ? e.key_char : m.shift && k.length === 1 ? k.toUpperCase() : k;

    if (!m.platform && !m.control) {
      const name = MD_LEVELS.includes(ch) ? `heading-${ch}` : (Object.keys(MD_COMMANDS).find((n) => commandInfo(n)?.[1] === ch) ?? [...MD_IMAGE].find(([, entry]) => entry[1] === ch)?.[0]);

      if (name) this.mdRun(name, cx);
    }

    cx.notify();

    return true;
  }

  /** Runs a Markdown command (mdedit.ts) on the shown tab's text and selection, as one undoable edit. */
  mdRun(name: string, cx: Context): void {
    this.mdMenu = null;

    const d = this.cur;

    if (!d?.markdown) return this.say("the Markdown commands are for Markdown files");

    if (name === "image") return this.pickImage(cx);

    if (name === "image-paste") {
      void this.pasteImage(cx);

      return;
    }

    if (d.state !== "ready" && d.state !== "missing") return;

    const rendered = d.view === "rendered" ? d.rendered : null;
    const text = d.editor.value();
    let sel: Sel = rendered ? rendered.selection() : d.editor.selection();
    // In the rendered view a caret stands for its whole block where a command
    // works line by line (a quote, a list, a code block); headings stay the caret's line.
    const caret = sel.start.line === sel.end.line && sel.start.col === sel.end.col ? sel.start : null;
    const whole = rendered && caret && WHOLE_BLOCK.has(name);

    if (rendered && whole) sel = { start: { line: rendered.range.from, col: 0 }, end: { line: rendered.range.to, col: text.split("\n")[rendered.range.to]?.replace(/\r$/, "").length ?? 0 } };

    let r = mdCommand(name, text, sel);

    if (r && whole && caret) {
      // The caret back where it was, moved with its line.
      const line = caret.line + (r.sel.start.line - sel.start.line);
      const was = text.split("\n")[caret.line] ?? "";
      const now = r.text.split("\n")[line] ?? "";
      const at = { line, col: Math.max(0, Math.min(now.length, caret.col + now.length - was.length)) };

      r = { text: r.text, sel: { start: at, end: at } };
    }

    const title = mdEntry(name)?.[0] ?? name.replace("heading-", "heading ");

    if (!r) {
      this.say(`${title.toLowerCase()}: nothing to change here`);
      cx.notify();

      return;
    }

    const e = editBetween(text, r.text);

    if (e) d.editor.edit([e]);

    const { start, end } = r.sel;

    if (start.line === end.line && start.col === end.col) d.editor.set_cursor(start.line, start.col);
    else d.editor.set_cursor(start.line, start.col, end);

    // The rendered view follows the file's caret and selection (its block, edited in place).
    if (rendered) {
      rendered.pull(cx);
      rendered.focus();
    }

    this.changed(cx, d);
  }

  /** A task box clicked in the rendered view: [ ] <-> [x], one undoable edit. */
  tickRendered(line: number, cx: Context): void {
    const d = this.shown();
    const text = d.editor.value();
    const r = tickLine(text, line);

    if (!r) return;

    const e = editBetween(text, r.text);

    if (e) d.editor.edit([e]);

    this.changed(cx, d);
  }

  /** A scratchpad's write: only over what was read (another pane on the same note
   *  may have written it); a note changed elsewhere asks as a file does. */
  async autosaveWrite(d: Doc): Promise<void> {
    const text = d.editor.value();

    d.writing = text;

    try {
      await writeTextFile(d.path, text, d.saved);
    } catch (cause) {
      d.writing = null;

      if (/changed outside/.test(errorText(cause))) {
        const disk = await readTextFile(d.path).catch(() => null);

        if (disk === text) {
          d.saved = text;

          return;
        }

        d.conflict = true;
      }

      throw cause instanceof Error ? cause : new Error(String(cause));
    }

    d.saved = text;
    d.writing = null;
    d.state = "ready";
    d.deleted = false;
  }

  /** The autosave's wait: a timer from the last change's task; the write in a task of its own. */
  autosaveTimer(ms: number, fn: () => Promise<void>): () => void {
    let off = false;
    const cx = this.timerCx;

    if (!cx) {
      void fn();

      return () => {};
    }

    cx.timer.after(ms, (cx) => {
      if (off) return;

      cx.spawn(async (cx) => {
        try {
          await fn();
        } catch {
          /* the state says */
        }

        cx.notify();
      });
    });

    return () => {
      off = true;
    };
  }

  /** The rendered view of the shown tab. */
  renderedView(t: Theme): Element {
    const d = this.shown();
    const rendered = d.rendered;

    if (!rendered) return div();

    const empty =
      d.scratch && !d.editor.value().trim()
        ? { title: `A page for ${noteName(d.path)}`, detail: "Kept under the app's folder, out of the repository; every worktree of it opens this one.", hint: `type, or ${this.vimOn() ? "space ." : "cmd-."} for the Markdown commands` }
        : null;

    return rendered.view({
      t,
      focused: rendered.focused(),
      empty,
      maxWidth: 760,
      unzoom: (v) => v / zoom(),
      onTask: (line, cx) => this.tickRendered(line, cx),
    });
  }

  /** The Markdown commands' list, which-key style, by the lit block (rendered) or the bar. */
  mdMenuView(t: Theme): Element {
    const d = this.shown();
    const sel = d.view === "rendered" && d.rendered ? d.rendered.selection() : d.editor.selection();
    const on = mdActive(d.editor.value(), sel);
    const names: string[] = Object.keys(MD_COMMANDS);
    const inline = names.slice(0, 4);
    const heads = names.slice(4, 6);
    const blocks = names.slice(6);

    const row = (n: string): Element => {
      const [title, key, mark] = mdEntry(n) ?? [n, "", ""];
      const lit = on.has(n) || (n.startsWith("heading") && [...on].some((x) => /^heading-\d/.test(x)));

      // A click runs it too (the pointer's way; the letter is the keyboard's).
      return h_flex()
        .id(`md-menu-${n}`)
        .gap(10)
        .px(4)
        .ml(-4)
        .cursor_pointer()
        .hover((s) => s.bg(t.ansi0))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.mdRun(n, cx);
          cx.notify();
        })
        .child(div().w(18).flex_none().text_color(t.accent).child(key))
        .child(
          div()
            .flex_1()
            .text_color(lit ? t.ansi5 : t.foreground)
            .child(title.replace(/^Heading level /, "level ")),
        )
        .child(div().flex_none().pl(12).text_color(t.dim).child(mark));
    };

    const group = (name: string): Element => div().text_size(10.5).text_color(t.dim).mt(4).child(name);
    // Under the lit block (rendered), above it when it doesn't fit there; under the bar in the text views.
    const MENU_H = 270;
    const paneH = this.size.height / zoom();
    let top = this.textTop() + 8;

    if (d.view === "rendered" && d.rendered) {
      const litTop = this.textTop() + d.rendered.litTop;
      const litBottom = litTop + d.rendered.litHeight();

      top = litBottom + 6 + MENU_H < paneH - HINTS ? litBottom + 6 : Math.max(this.textTop() + 4, litTop - MENU_H - 6);
    }

    return v_flex()
      .id("editor-md-menu")
      .absolute()
      .right(16)
      .top(top)
      .w(400)
      .bg(t.background)
      .border(1)
      .border_color(t.ansi0)
      .shadow_lg()
      .child(
        h_flex()
          .relative()
          .h(24)
          .px(12)
          .gap(10)
          .items_center()
          .child(div().text_color(t.accent).child(this.vimOn() ? "space .  markdown" : "cmd-.  markdown"))
          .child(div().relative().flex_1().min_w(40).h(1).opacity(0.6).child(dither(t.ansi8, 1)))
          .child(div().text_color(t.dim).child("esc")),
      )
      .child(
        h_flex()
          .px(12)
          .pb(10)
          .gap(22)
          .items_start()
          .child(
            v_flex()
              .flex_1()
              .gap(2)
              .child(group("inline"))
              .children(inline.map(row))
              .child(group("heading"))
              .children(heads.map(row))
              // 0-6: a digit each, clickable (0: back to text).
              .child(
                h_flex()
                  .gap(4)
                  .items_center()
                  .child(div().pr(4).text_color(t.foreground).child("level"))
                  .children(
                    MD_LEVELS.map((n) =>
                      div()
                        .id(`md-menu-level-${n}`)
                        .w(16)
                        .h(16)
                        .flex()
                        .items_center()
                        .justify_center()
                        .border(1)
                        .border_color(t.ansi0)
                        .text_color(t.accent)
                        .cursor_pointer()
                        .hover((s) => s.border_color(t.accent))
                        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                        .on_click((_e, cx) => {
                          cx.stop_propagation();
                          this.mdRun(`heading-${n}`, cx);
                          cx.notify();
                        })
                        .child(n),
                    ),
                  ),
              ),
          )
          .child(
            v_flex()
              .flex_1()
              .gap(2)
              .child(group("blocks"))
              .children(blocks.map(row))
              .child(group("image"))
              .children([...MD_IMAGE.keys()].map(row)),
          ),
      );
  }

  // ---- the Markdown preview

  /** Splits the text into the preview's blocks again (now, or after a moment of typing). */
  refreshPreview(cx: Context, now: boolean, d: Doc = this.shown()): void {
    const apply = (cx: Context): void => {
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
  setView(view: EditorView, cx: Context): void {
    if (!this.markdown) return this.say("the preview is for Markdown files");

    this.view = view;
    this.defaultView = view;

    try {
      localStorage.setItem("preview", view);
    } catch {
      /* a nicety */
    }

    this.driver = "editor";

    const d = this.shown();

    if (view === "rendered") d.rendered?.open(cx);
    else if (d.previewStale) {
      d.previewStale = false;
      this.refreshPreview(cx, true);
    }

    if (view === "preview") cx.timer.after(0, () => this.previewHandle?.focus());
    else this.focusText();

    this.say(view === "rendered" ? "rendered: type into it" : view === "split" ? "preview beside the text" : view === "preview" ? "preview only (e: back to the text)" : "text only");
    cx.notify();
  }

  /** Copies the document's local images where they can be drawn. */
  loadImages(cx: Context, d: Doc = this.shown()): void {
    if (this.on) return;

    for (const part of d.preview.parts) {
      if (part.kind !== "images") continue;

      for (const img of part.images) this.copyImage(img.src, cx, d);
    }
  }

  /** One picture's copy where it can be drawn (once: cacheImage names it by content). */
  copyImage(src: string, cx: Context, d: Doc): void {
    if (!isLocalSource(src)) return;

    const abs = join(dirname(d.path), decodeURI(src.split(/[?#]/)[0] ?? ""));

    if (d.images.has(abs)) return;

    if (!IMAGE_EXT.test(abs)) {
      d.images.set(abs, null);

      return;
    }

    d.images.set(abs, undefined);
    cx.spawn(async (cx) => {
      d.images.set(abs, await cacheImage(abs, MOD));
      cx.notify();
    });
  }

  // ---- images: pasted, picked, drawn (images.ts)

  /** cmd-v (and vim's p / P in normal mode) when the clipboard may hold a picture: a copied
   *  image file (its name is the clipboard's text) or no text at all (vim's p; cmd-v without
   *  text comes as the editor's paste_other). Taken: the clipboard is asked, and what isn't a
   *  picture is pasted as before. */
  imagePasteKey(e: KeyEvent, cx: Context): boolean {
    const m = e.modifiers;
    const mac = appWindow().platform === "macos";
    const cmdV = e.key === "v" && (mac ? m.platform && !m.control : m.control && !m.platform) && !m.alt && !m.shift;
    const vimP = this.vimOn() && this.vim.mode === "normal" && !this.vim.keys.length && !this.vim.pendingLeader && this.vim.ex === null && (e.key === "p" || e.key_char === "P") && !m.platform && !m.control && !m.alt && !this.imagePassP;

    if (!cmdV && !vimP) return false;

    let text: string | null = null;

    try {
      text = cx.read_from_clipboard() ?? null;
    } catch {
      /* no clipboard */
    }

    if (cmdV && !maybeCopiedImage(text)) return false;

    if (vimP && text && !maybeCopiedImage(text)) return false;

    cx.spawn(async (cx) => {
      const done = await this.pasteImage(cx, { quiet: true });

      if (done) return;

      if (cmdV && text !== null) this.typeText(text, cx);
      else if (vimP) {
        this.imagePassP = true;

        try {
          this.vimKey(e, cx);
        } finally {
          this.imagePassP = false;
        }

        this.cur?.rendered?.pull(cx);
      }

      cx.notify();
    });

    return true;
  }

  /** Text at the caret, as the editor's own paste would (one edit). */
  typeText(text: string, cx: Context): void {
    const d = this.shown();
    const rendered = d.view === "rendered" ? d.rendered : null;
    const s = rendered ? rendered.selection() : d.editor.selection();

    d.editor.edit([{ start: s.start, end: s.end, text }]);

    const lines = text.split("\n");
    const line = s.start.line + lines.length - 1;
    const col = (lines.length > 1 ? 0 : s.start.col) + (lines.at(-1) ?? "").length;

    d.editor.set_cursor(line, col);

    if (rendered) rendered.pull(cx);

    this.changed(cx, d);
  }

  /** The clipboard's picture into the shown Markdown tab: saved beside it (images.ts
   *  assetPlace) and an image block at the caret. -> whether there was one. */
  async pasteImage(cx: Context, { quiet = false }: { readonly quiet?: boolean } = {}): Promise<boolean> {
    const d = this.cur;

    if (!d?.markdown || !d.path || this.on) {
      if (!quiet) this.say("pasting a picture works in a Markdown file on this machine", true);

      return false;
    }

    const tmp = `${appHome()}/cache/${MOD}/clip-${stamp()}-${Math.random().toString(36).slice(2, 6)}.png`;

    await herdr.exec("mkdir", ["-p", dirname(tmp)]).catch(() => null);

    const got = await readClipboardImage(herdr.exec, appWindow().platform, tmp);

    if (!got) {
      if (!quiet) this.say("the clipboard holds no picture");

      cx.notify();

      return false;
    }

    const ext = got.kind === "file" ? (got.path.split(".").pop() || "png").toLowerCase() : "png";
    const place = assetPlace(d.path, { scratch: d.scratch, ext });
    // Into its place: the clipboard's PNG moved, a copied file copied (the original stays where it was).
    const r = await herdr.exec("sh", ["-c", 'mkdir -p "$1" && if [ "$4" = file ]; then cp "$2" "$3"; else mv "$2" "$3"; fi', "paste-image", place.dir, got.path, place.path, got.kind]).catch(() => null);

    if (r?.code !== 0) {
      this.say(`couldn't save the picture: ${(r?.stderr ?? "").trim() || "no answer"}`, true);
      cx.notify();

      return true;
    }

    const alt = got.kind === "file" ? basename(got.path).replace(/\.[^.]+$/, "") : "";

    this.insertImageBlock(imageMarkdown(place.rel, alt), cx);
    this.say(`pasted: ${place.rel}`);

    return true;
  }

  /** The system's file picker: an image block for the chosen picture (a relative path to it). */
  pickImage(cx: Context): void {
    const d = this.cur;

    if (!d?.path || this.on) return this.say("pick a picture in a file on this machine", true);

    cx.spawn(async (cx) => {
      const file = await herdr.pickFile({ prompt: "Insert" }).catch(() => null);

      if (!file) return;

      if (!isImagePath(file)) {
        this.say(`not a picture: ${basename(file)}`, true);
        cx.notify();

        return;
      }

      this.insertImageBlock(imageMarkdown(relative(dirname(d.path), file), basename(file).replace(/\.[^.]+$/, "")), cx);
      cx.notify();
    });
  }

  /** An image line at the caret (its own block: the caret's blank line, else after its block), one undoable edit. */
  insertImageBlock(md: string, cx: Context): void {
    const d = this.shown();
    const rendered = d.view === "rendered" ? d.rendered : null;
    const text = d.editor.value();
    const caret = rendered ? rendered.selection().end.line : d.editor.cursor().line;
    // After the caret's whole block (the lit lines; in the text view the unit holding the caret).
    const end = rendered && caret >= rendered.range.from && caret <= rendered.range.to ? (rendered.unit.kind !== "blank" ? rendered.range.to : caret) : unitFor(liveUnits(text), caret).to;
    const r = insertImage(text, caret, md, end);
    const e = editBetween(text, r.text);

    if (e) d.editor.edit([e]);

    d.editor.set_cursor(r.line, 0);

    if (rendered) {
      rendered.pull(cx);
      rendered.focus();
    }

    this.changed(cx, d);
  }

  /** Copies the pictures of `srcs` where they can be drawn (once each: cacheImage names them by content). */
  loadImageSrcs(srcs: readonly string[], cx: Context): void {
    const d = this.cur;

    if (!d || this.on) return;

    for (const src of srcs) this.copyImage(src, cx, d);
  }

  image(src: string): Picture {
    if (!isLocalSource(src) || this.on) return { abs: null, name: null };

    const abs = join(dirname(this.path), decodeURI(src.split(/[?#]/)[0] ?? ""));
    const name = this.images.get(abs);

    return { abs, name: name ? `cache/${MOD}/${name}` : name };
  }

  /** A preview link: a heading here, another Markdown file in the editor,
   *  pictures and the like in the preview pane, web pages as the app opens them. */
  previewLink(href: string, cx: Context): void {
    const to = follow(href, this.path);

    if (!to) return;

    const here = (anchor: string): void => {
      const d = this.shown();

      if (d.previewStale) {
        d.previewStale = false;
        d.preview.setText(d.text);
      }

      if (!this.preview.scrollTo(anchor)) return;

      // The text goes there too: the heading's line.
      const part = this.preview.parts.find((p) => (p.kind === "md" && p.anchor === anchor) || p.anchors?.includes(anchor) || (p.kind === "footnotes" && p.notes.some((n) => n.anchor === anchor)));
      const line = (part?.kind === "footnotes" ? part.notes.find((n) => n.anchor === anchor)?.from : undefined) ?? part?.from;

      if (line !== undefined && this.view !== "preview") {
        this.previewDrove = Date.now();
        this.driver = "preview";
        this.editor.set_cursor(line, 0);
        this.editor.scroll_to_line(line);
      }
    };

    if (to.kind === "anchor") here(to.anchor);
    else if (to.kind === "markdown") {
      if (to.path === this.path) {
        if (to.anchor) here(to.anchor);
      } else this.openFile(to.path, cx);
    } else if (to.kind === "web") run("app.open_url", { url: to.url });
    else if (to.kind === "file" && PREVIEWED.test(to.path)) this.openLooked(to.path, cx);
    else if (to.kind === "file" && languageOf(to.path)) this.openFile(to.path, cx);
    else if (!this.on) {
      const platform = appWindow().platform;
      const opener = platform === "windows" ? null : platform === "macos" ? "open" : "xdg-open";

      if (opener) exec(opener, [to.kind === "file" ? to.path : to.url]).catch(() => null);
    }

    cx.notify();
  }

  /** A task box ticked in the preview: [ ] <-> [x] in the text, one undoable edit. */
  tick(line: number, cx: Context): void {
    const edit = taskToggle(this.text, line);

    if (!edit) return;

    this.editor.edit([{ start: { line, col: edit.col }, end: { line, col: edit.col + 1 }, text: edit.text }]);
    this.changed(cx);
  }

  /** Keys while the preview alone has the keyboard: the viewer's scrolling, and back to the text. */
  previewKey(e: KeyEvent, cx: Context): void {
    const k = e.key;
    const m = e.modifiers;

    if (m.platform || m.alt) return;

    const doc = this.preview;
    const page = Math.max(80, doc.viewH / 2);

    if (this.leaderAt && Date.now() - this.leaderAt < 1500) {
      const seq = this.leaderKeys + k;

      if (seq === "m") {
        this.leaderKeys = "m";
        cx.stop_propagation();

        return;
      }

      this.leaderAt = 0;
      this.leaderKeys = "";

      const go = PREVIEW_LEADER.get(seq);

      if (go) {
        this.command(go, cx);
        cx.stop_propagation();
        cx.notify();
      }

      return;
    }

    if (m.control) {
      if (k === "d") doc.scroll(page);
      else if (k === "u") doc.scroll(-page);
      else return;
    } else if (k === "j" || k === "down") doc.scroll(60);
    else if (k === "k" || k === "up") doc.scroll(-60);
    else if (k === "d" || k === "pagedown") doc.scroll(page);
    else if (k === "u" || k === "pageup") doc.scroll(-page);
    else if (k === "G" || (k === "g" && m.shift) || k === "end") doc.scroll(1e9);
    else if (k === "g" || k === "home") {
      if (k === "home" || Date.now() - this.gAt < 500) {
        this.gAt = 0;
        doc.scrollY = 0;
      } else this.gAt = Date.now();
    } else if (k === "space" && this.vimOn()) {
      this.leaderAt = Date.now();
      this.leaderKeys = "";
    } else if (k === "space") doc.scroll(page);
    else if (k === "e" || k === "i" || k === "escape") return this.setView("split", cx);
    else return;

    cx.stop_propagation();
    cx.notify();
  }

  /** The preview, following the text when the text scrolled last. */
  previewView(t: Theme): Element {
    const doc = this.preview;

    if (this.view === "split" && this.driver === "editor") {
      const top = this.editor.top_line();

      if (top !== null) doc.setScroll(doc.yOfLine(top) - 4);
    }

    const focused = this.view === "preview" && this.previewHandle?.is_focused() === true;

    return focusOn(v_flex().id("editor-preview").relative().flex_1().min_w(0).min_h(0).bg(t.background), this.previewHandle)
      .on_key_down((e, cx) => this.previewKey(e, cx))
      .on_mouse_down("left", () => {
        if (this.view === "preview") this.previewHandle?.focus();
      })
      .child(
        doc.render(t, {
          onLink: (url, cx) => this.previewLink(url, cx),
          onTask: (line, cx) => this.tick(line, cx),
          image: (src) => this.image(src),
          // A drawn picture: a drawn tab here (through the open record, answered with a context in render).
          onImage: (abs) => {
            if (this.slot && abs) writeShared(setShared, OPEN_KEY, { slot: this.slot, path: abs, look: true, n: (readShared(shared, OPEN_KEY, null)?.n ?? 0) + 1, at: Date.now() });
          },
          dither: (color) => dither(color, 1),
          focused,
          size: 13,
          maxWidth: this.view === "preview" ? 780 : 720,
          unzoom: (v) => v / zoom(),
          notify: (cx) => cx.notify(),
          onScroll: () => {
            // The preview scrolled by hand: the text follows it.
            this.driver = "preview";

            if (this.view !== "split") return;

            this.previewDrove = Date.now();
            this.editor.scroll_to_line(doc.lineAtY(doc.scrollY + 4));
          },
        }),
      );
  }

  override async close(): Promise<void> {
    // A scratchpad writes what waits before it goes.
    await Promise.all(this.allDocs().map((d) => d.autosave?.flush().catch(() => null)));

    const ids = new Set<number>();

    for (const d of this.allDocs()) {
      d.gone = true;

      const id = serverId(d.server);

      if (id === null) continue;

      lspNotify(id, "textDocument/didClose", { textDocument: { uri: uri(d.path) } });
      ids.add(id);
    }

    for (const id of ids) lspRelease(id);

    setUnsaved(null);

    const slot = this.slot;

    if (slot) {
      const titles = readSharedMap(shared, TITLES_KEY);

      if (titles.has(slot)) writeSharedMap(setShared, TITLES_KEY, new Map([...titles].filter(([k]) => k !== slot)));

      const paths = editorPaths(shared);

      if (paths.has(slot)) writeSharedMap(setShared, PATHS_KEY, new Map([...paths].filter(([k]) => k !== slot)));
    }
  }

  // ---- drawing

  override render(cx: Context): Element {
    const t = theme();

    if (this.vimWas !== null && this.vimWas !== this.vimOn()) this.vimSettled(this.vimOn());

    const goto = readShared(shared, GOTO_KEY, null);

    // A newer rename, move or delete from the files pane: answered after this render.
    if (newestId(fileChanges(shared)) > this.seenChange) cx.timer.after(0, (cx) => this.followChanges(cx));

    // The app's editor.open on a file one of the tabs holds: that tab, at the line asked for.
    if (goto && goto.n !== this.seenGoto && this.allDocs().some((d) => d.path === goto.path)) {
      this.seenGoto = goto.n;
      cx.timer.after(0, (cx) => {
        this.openFile(goto.path, cx, { line: goto.line ?? null, col: goto.col ?? null });
        cx.notify();
      });
    }

    // A file sent to this editor as a tab (editor-route.ts: the files pane, the picker, the Markdown viewer).
    const req: OpenRequest | null = readShared(shared, OPEN_KEY, null);

    if (req && req.slot === this.slot && this.slot && req.n !== this.seenOpen) {
      this.seenOpen = req.n;
      cx.timer.after(0, (cx) => {
        this.openFile(req.path, cx, { line: req.line ?? null, col: req.col ?? null, view: req.view ?? null, look: req.look === true });
        cx.notify();
      });
    }

    // The shown drawn tab's viewer, made once: a nested view, so its reading redraws only it.
    if (this.cur?.look) this.mountViewer(cx);

    // The editor that last had the keyboard, for the files pane and the picker to send files to.
    const slot = this.slot;

    if (slot && (this.editor.focused() || (this.look && this.lookHandle?.is_focused() === true)) && readShared(shared, LAST_KEY, null) !== slot) {
      cx.timer.after(0, () => {
        if (readShared(shared, LAST_KEY, null) !== slot) writeShared(setShared, LAST_KEY, slot);
      });
    }

    const code = settings().font_family || "JetBrains Mono";
    const card = this.card ? this.cardView(t, code) : null;
    const tabMenu = this.tabMenu;
    const drag = this.tabDrag;
    const asking = this.asking;
    const page = this.look ? this.lookView(t) : this.body(t, code);

    return v_flex()
      .id("editor")
      .relative()
      .size_full()
      .bg(t.background)
      .text_size(11)
      .on_size_change((size, cx) => {
        this.size = size;
        cx.notify();
      })
      .on_key_down((e, cx) => {
        // The editor's own keys came through vimKey; these are the pane's
        // others (the find line, the preview): esc closes the card, then find.
        if (e.key !== "escape") return;

        if (this.card) {
          this.closeCard(cx);
          cx.stop_propagation();
        } else if (this.mode) {
          this.closeFind(cx);
          cx.stop_propagation();
        }
      })
      // A click outside the card closes it (the card keeps its own), and the tab menu.
      .on_mouse_down("left", (_e, cx) => {
        this.closeCard(cx);
        this.closeTabMenu(cx, false);
      })
      // A tab dragged off the strip and let go over the pane: popped out beside (tabs.ts).
      .on_mouse_up("left", (_e, cx) => {
        if (this.tabDrag?.out) this.dropOut(cx);
      })
      .on_hover((over, cx) => {
        if (!over) this.cancelDrag(cx);
      })
      .when(showStrip(this.allDocs().length), (el) => el.child(this.tabStrip(t)))
      // A drawn tab: the viewer's slim bar says what it is; the editor's is for text.
      .when(!this.look, (el) => el.child(this.bar(t)))
      .when(Boolean(asking), (el) => (asking ? el.child(this.askLine(t)) : el))
      .when(this.conflict, (el) => el.child(this.conflictLine(t)))
      .when(this.mode !== null, (el) => el.child(this.findLine(t)))
      .when(this.vim.ex !== null, (el) => el.child(this.exLine(t, code)))
      // ?: the keys in the file's place (the file folds away, kept), the bars stay (keyhelp.ts).
      .when(this.keysShown, (el) => el.child(div().relative().flex_1().min_h(0).child(this.keysStrip(t))))
      .child(this.keysShown ? div().h(0).flex_none().overflow_hidden().child(page) : page)
      .when(this.drawer && !this.keysShown && !this.look, (el) => el.child(this.drawerView(t)))
      .child(this.hints(t))
      .when(Boolean(card), (el) => (card ? el.child(card) : el))
      .when(Boolean(this.which?.length) && this.vimOn(), (el) => el.child(this.whichView(t)))
      .when(Boolean(this.mdMenu) && this.markdown, (el) => el.child(this.mdMenuView(t)))
      .when(Boolean(drag?.out), (el) => (drag ? el.child(this.dropZone(t)) : el))
      .when(Boolean(tabMenu), (el) => (tabMenu ? el.child(this.tabMenuView(t)) : el));
  }

  bar(t: Theme): Element {
    const c = counts(this.problems);
    const dir = tilde(dirname(this.path), home());
    const at = this.state === "ready" || this.state === "missing" ? this.editor.cursor() : null;
    const narrow = this.size.width < 520;

    const sev = (n: number, color: Color, id: string): Element =>
      h_flex()
        .id(id)
        .flex_none()
        .gap(5)
        .items_center()
        .on_click((_e, cx) => {
          this.drawer = !this.drawer;
          cx.notify();
        })
        .child(div().relative().size(7).border(1).border_color(color).child(dither(color, 1)))
        .child(div().text_color(color).child(String(n)));

    const s = this.server;
    // The server's word (logic.ts serverNote): running, starting, loading the
    // project's .envrc, stopped, or why there's none ("direnv allow").
    const word = serverNote(s, this.lang, { tilde: (p) => tilde(p, home()) })?.short ?? "";
    // A running server's own words for what it's doing: "indexing 120/340"
    // while answers wait on it (yellow), "· cargo check" beside its name after.
    const work = s?.status === "ready" ? progressWord(this.progress) : null;
    const envKind = s && "envKind" in s ? s.envKind : undefined;

    const server: readonly [Color, string] | null =
      s?.status === "ready" && work
        ? busy(this.progress)
          ? [t.ansi3, work]
          : [t.ansi2, `${s.name} · ${work}`]
        : s?.status === "ready"
          ? [t.ansi2, s.name]
          : s?.status === "starting" || s?.status === "env" || envKind === "blocked"
            ? [t.ansi3, word]
            : s?.status === "exited" || envKind === "failed"
              ? [t.ansi1, word]
              : word
                ? [t.dim, word]
                : null;

    const msg = this.message && Date.now() - this.message.at < 4000 ? this.message : null;
    const vim = this.vimOn();
    const modeColor = modeColorOf(t, this.vim.mode);
    const recording = this.vim.recording;

    return h_flex()
      .id("editor-bar")
      .h(BAR)
      .flex_none()
      .px(12)
      .gap(10)
      .items_center()
      .border_b(1)
      .border_color(t.ansi0)
      .when(vim, (el) =>
        el.child(
          div()
            .id("bar-mode")
            .relative()
            .flex_none()
            .h(18)
            .px(6)
            .flex()
            .items_center()
            .child(div().absolute().inset_0().opacity(0.3).child(dither(modeColor, 1)))
            .child(div().relative().text_color(modeColor).child(MODE_NAME[this.vim.mode])),
        ),
      )
      .when(vim && Boolean(recording), (el) => (recording ? el.child(div().flex_none().text_color(t.ansi1).child(`rec @${recording.reg}`)) : el))
      // One file (no strip): its unsaved mark and name are here, as before tabs.
      .when(!showStrip(this.allDocs().length), (el) =>
        el
          .when(!this.scratch, (el) =>
            el.child(
              div()
                .id("bar-mark")
                .relative()
                .size(8)
                .flex_none()
                .border(1)
                .border_color(this.dirty ? t.ansi3 : t.ansi0)
                .when(this.dirty, (el) => el.child(dither(t.ansi3, 1))),
            ),
          )
          .child(this.typeMark(t, this.shown(), "bar-icon", true))
          .child(
            div()
              .id("bar-name")
              .flex_none()
              .max_w(MAX_TAB_NAME * 1.5)
              .truncate()
              .text_color(t.foreground)
              .child(this.scratch ? "scratchpad" : basename(this.path) || "untitled"),
          ),
      )
      .when(this.deleted, (el) => el.child(div().id("bar-deleted").flex_none().text_color(t.ansi1).child("deleted · cmd-s writes it again")))
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_color(t.dim)
          .child(narrow ? "" : this.scratch ? `${noteName(this.path)} · every worktree of it` : dir),
      )
      // A scratchpad: saving… while it waits to write, saved after (green), what went wrong (red).
      .when(this.scratch, (el) => {
        const st = this.saveState;
        const color = st === "error" ? t.ansi1 : st === "saved" ? t.ansi2 : t.ansi3;

        return el.child(
          h_flex()
            .id("bar-autosave")
            .flex_none()
            .gap(6)
            .items_center()
            .text_color(color)
            .child(div().relative().size(7).border(1).border_color(color).child(dither(color, 1)))
            .child(st === "error" ? "not saved" : st === "saved" ? "saved" : "saving…"),
        );
      })
      .when(Boolean(msg), (el) =>
        msg
          ? el.child(
              div()
                .flex_none()
                .text_color(msg.bad ? t.ansi1 : t.ansi2)
                .truncate()
                .max_w(260)
                .child(msg.text),
            )
          : el,
      )
      .when(c.error > 0, (el) => el.child(sev(c.error, t.ansi1, "bar-errors")))
      .when(c.warning > 0, (el) => el.child(sev(c.warning, t.ansi3, "bar-warnings")))
      .when(Boolean(server) && !narrow, (el) => (server ? el.child(h_flex().id("bar-server").flex_none().gap(6).items_center().text_color(t.muted).child(div().size(6).bg(server[0])).child(server[1])) : el))
      .when(!narrow, (el) =>
        el.child(
          h_flex()
            .flex_none()
            .h(18)
            .px(6)
            .items_center()
            .border(1)
            .border_color(t.ansi0)
            .text_color(t.muted)
            .child(`${this.lang} · ${this.opts.insert_spaces === false ? "tab" : `${this.opts.tab_size} sp`}`),
        ),
      )
      .when(vim && Boolean(this.pending), (el) => el.child(div().flex_none().text_color(t.foreground).child(this.pending)))
      .when(Boolean(at), (el) => (at ? el.child(div().flex_none().text_color(t.dim).child(`${at.line + 1}:${at.col + 1}`)) : el))
      // The Markdown commands' list (cmd-., vim: space .), found from the bar: a click opens it.
      .when(this.markdown && this.view !== "preview" && !narrow, (el) =>
        el.child(
          h_flex()
            .id("bar-md")
            .flex_none()
            .h(18)
            .px(6)
            .gap(6)
            .items_center()
            .border(1)
            .border_color(this.mdMenu ? t.accent : t.ansi0)
            .text_color(this.mdMenu ? t.accent : t.muted)
            .hover((s) => s.text_color(t.foreground).border_color(t.ansi8))
            .tooltip("bold, headings, lists, tasks, quotes, code: the Markdown commands")
            .on_click((_e, cx) => {
              if (this.mdMenu) {
                this.mdMenu = null;
                this.focusText();
                cx.notify();
              } else {
                this.openMdMenu(cx);
                this.focusText();
              }
            })
            .child("markdown")
            .child(div().text_color(t.dim).child(vim ? "space ." : "cmd-.")),
        ),
      )
      .when(this.markdown, (el) =>
        el.child(
          div()
            .id("bar-preview")
            .flex_none()
            .h(18)
            .px(6)
            .flex()
            .items_center()
            .border(1)
            .border_color(this.view === "text" ? t.ansi0 : t.ansi5)
            .text_color(this.view === "text" ? t.dim : t.ansi5)
            .hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => this.command("preview", cx))
            .child(this.view),
        ),
      )
      // A table, patch or SVG as text: drawn again (e in the drawn tab comes back here).
      .when(this.kind === "either", (el) =>
        el.child(
          div()
            .id("bar-drawn")
            .flex_none()
            .h(18)
            .px(6)
            .flex()
            .items_center()
            .border(1)
            .border_color(t.ansi0)
            .text_color(t.dim)
            .hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => {
              this.setDrawn(this.shown(), true, cx);
              cx.notify();
            })
            .child("drawn"),
        ),
      )
      .when(!narrow || this.softWrap, (el) =>
        el.child(
          div()
            .id("bar-wrap")
            .flex_none()
            .h(18)
            .px(6)
            .flex()
            .items_center()
            .border(1)
            .border_color(this.softWrap ? t.ansi4 : t.ansi0)
            .text_color(this.softWrap ? t.ansi4 : t.dim)
            .hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => this.setWrap(null, cx))
            .child("wrap"),
        ),
      )
      .child(
        div()
          .id("bar-vim")
          .flex_none()
          .h(18)
          .px(6)
          .flex()
          .items_center()
          .border(1)
          .border_color(vim ? t.accent : t.ansi0)
          .text_color(vim ? t.accent : t.dim)
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => this.toggleVim(cx))
          .child("vim"),
      );
  }

  /** The strip's height: none with one tab. */
  stripH(): number {
    return showStrip(this.allDocs().length) ? TABS : 0;
  }

  /** The file tabs along the pane's top (from two files on): each file's
   *  unsaved mark, name (with the folder that tells two of the same name
   *  apart) and ×; the shown one lit (a dithered band, an accent edge). Those
   *  that don't fit fold into ‹ n / n › at the ends, the shown one always in
   *  view. A press dragged along the strip moves its tab: it lifts where it
   *  is and a stake stands in the gap it drops into; the wheel steps tabs. */
  /** A file's type mark (file-icons.ts) before its name: tinted by its kind, dimmed on a tab
   *  not shown; a scratchpad's is the scratchpad's own mark. */
  typeMark(t: Theme, d: Doc, id: string, on: boolean): Element {
    const icon = fileIcon(d.path);
    const src = d.scratch ? SCRATCH_MARK : iconSvg(icon, MOD);

    return div()
      .id(id)
      .relative()
      .flex_none()
      .size(ICON_SIZE)
      .opacity(on ? 1 : 0.5)
      .child(svg(src).size(ICON_SIZE).text_color(d.scratch ? t.accent : iconColor(icon, t)));
  }

  tabStrip(t: Theme): Element {
    const docs = this.allDocs();

    // A scratchpad's tab says so, with its repository (its file is named for the app).
    const labels = tabLabels(docs.map((d) => d.path)).map((l, i) => {
      const d = docs[i];

      return d?.scratch ? { ...l, name: "scratchpad", hint: noteName(d.path) } : l;
    });

    const z = zoom();
    const room = this.size.width / z - 8;
    const active = this.cur ? docs.indexOf(this.cur) : -1;
    const widths = labels.map((l) => tabWidth(l));
    const fit = visibleTabs(widths, active, room);

    // Where each drawn tab starts (px, unzoomed): the tab menu opens under it.
    this.tabX = (i) => (i < fit.from || i >= fit.to ? 8 : (fit.before > 0 ? MORE : 0) + widths.slice(fit.from, i).reduce((a, b) => a + b, 0));

    const drag = this.tabDrag;
    const stake = drag ? stakeAt(docs.length, drag.from, dropIndex(docs.length, drag.from, drag.gap)) : null;
    // The landing place among the drawn tabs: one folded away stands at the edge.
    const stakeBefore = stake === null ? undefined : stake.before === null || stake.before >= fit.to ? null : Math.max(stake.before, fit.from);

    const more = (id: string, text: string, dir: number): Element =>
      h_flex()
        .id(id)
        .relative()
        .h_full()
        .w(MORE)
        .flex_none()
        .justify_center()
        .items_center()
        .text_color(t.dim)
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          this.stepTab(dir, cx);
          cx.notify();
        })
        .child(text);

    const tab = (d: Doc, i: number): Element => {
      const on = d === this.cur;
      const l = labels[i] ?? { name: basename(d.path), hint: null };
      const bad = d.state === "error" || d.deleted;
      const lifted = drag?.from === i;
      const hint = l.hint;

      return (
        h_flex()
          .id(`editor-tab-${i}`)
          .relative()
          .h_full()
          .flex_none()
          .pl(10)
          .pr(6)
          .gap(6)
          .items_center()
          .border_r(1)
          .border_color(t.ansi0)
          .text_color(on || lifted ? t.foreground : t.muted)
          .when(on && !lifted, (el) => el.child(div().absolute().inset_0().opacity(0.45).child(dither(t.ansi0, 1))).child(div().absolute().left(0).right(0).top(0).h(2).bg(t.accent)))
          // Dragged: lifted where it is (a plate edged in the accent, a dither shadow), behind its words.
          .when(lifted, (el) => el.child(div().absolute().left(5).right(-1).top(5).bottom(1).child(dither(t.ansi0, 1))).child(div().absolute().left(2).right(2).top(2).bottom(4).bg(t.background).border(1).border_color(t.accent)))
          .when(!on && !drag, (el) => el.hover((s) => s.text_color(t.foreground)))
          .on_mouse_down("left", (e) => {
            this.tabPress = { index: i, x: e.position.x };
          })
          .on_mouse_move((e, cx) => this.dragOver(gapAt(i, e.local_position.x, e.bounds.width), e, cx))
          // A click (no drag) shows the tab; a drag drops in the strip's mouse up.
          .on_click((_e, cx) => {
            if (this.tabDrag) return;

            this.select(d, cx);
            cx.notify();
          })
          // Middle click closes it, as the app's tab strip does; a right-click opens its menu.
          .on_mouse_down("middle", (_e, cx) => {
            cx.stop_propagation();
            this.closeTab(cx, d);
            cx.notify();
          })
          .on_mouse_down("right", (_e, cx) => {
            cx.stop_propagation();
            this.openTabMenu(cx, i);
            cx.notify();
          })
          // Unsaved: the bar's yellow dithered square; nothing when clean.
          .child(
            div()
              .id(`editor-tab-mark-${i}`)
              .relative()
              .size(7)
              .flex_none()
              .border(1)
              .border_color(d.dirty ? t.ansi3 : bad ? t.ansi1 : on ? t.ansi8 : t.ansi0)
              .when(d.dirty, (el) => el.child(dither(t.ansi3, 1))),
          )
          .child(this.typeMark(t, d, `editor-tab-icon-${i}`, on || lifted))
          .child(div().relative().flex_none().max_w(MAX_TAB_NAME).truncate().child(l.name))
          .when(Boolean(hint), (el) => (hint ? el.child(div().relative().flex_none().max_w(120).truncate().text_color(t.dim).child(hint)) : el))
          .child(
            div()
              .id(`editor-tab-close-${i}`)
              .relative()
              .flex_none()
              .size(14)
              .flex()
              .items_center()
              .justify_center()
              .text_color(on ? t.muted : t.ansi8)
              .hover((s) => s.text_color(t.ansi1))
              .on_mouse_down("left", stop)
              .on_click((_e, cx) => {
                cx.stop_propagation();
                this.closeTab(cx, d);
                cx.notify();
              })
              .child("×"),
          )
          .when(stakeBefore === i, (el) => el.child(tabStake(t)))
      );
    };

    // Past the last tab: the gap at the end, wide enough to aim at.
    const end = div()
      .id("editor-tabs-end")
      .relative()
      .flex_1()
      .min_w(24)
      .h_full()
      .on_mouse_move((e, cx) => this.dragOver({ index: null, after: false }, e, cx))
      .when(stakeBefore === null, (el) => el.child(tabStake(t)));

    return h_flex()
      .id("editor-tabs")
      .relative()
      .h(TABS)
      .flex_none()
      .items_center()
      .overflow_hidden()
      .bg(t.background)
      .on_mouse_up("left", (_e, cx) => this.dropTab(cx))
      .on_hover((hovered, cx) => {
        if (!hovered) this.leaveStrip(cx);
      })
      .when(Boolean(drag), (el) => el.cursor_grabbing())
      .on_scroll_wheel((e, cx) => {
        const dy = e.delta.y;

        if (Math.abs(dy) >= 1) {
          this.stepTab(dy > 0 ? -1 : 1, cx);
          cx.notify();
        }
      })
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.ansi0, 1)))
      .when(fit.before > 0, (el) => el.child(more("editor-tabs-before", `‹ ${fit.before}`, -1)))
      .children(docs.slice(fit.from, fit.to).map((d, j) => tab(d, fit.from + j)))
      .child(end)
      .when(fit.after > 0, (el) => el.child(more("editor-tabs-after", `${fit.after} ›`, 1)));
  }

  /** Closing a tab with unsaved changes asks here: save and close, discard, or keep. */
  askLine(t: Theme): Element {
    const a = this.asking;

    if (!a) return div();

    const chip = (id: Answer, label: string, k: string): Element =>
      div()
        .id(`editor-ask-${id}`)
        .flex_none()
        .h(18)
        .px(6)
        .flex()
        .items_center()
        .gap(6)
        .border(1)
        .border_color(a.at === id ? t.accent : t.ansi0)
        .text_color(a.at === id ? t.foreground : t.muted)
        .when(a.at === id, (el) => el.bg(t.ansi0))
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          this.answerClose(id, cx);
          cx.notify();
        })
        .child(div().child(label))
        .child(div().text_color(t.accent).child(k));

    return h_flex()
      .id("editor-ask")
      .relative()
      .h(FIND)
      .flex_none()
      .px(12)
      .gap(10)
      .items_center()
      .child(div().absolute().inset_0().opacity(0.25).child(dither(t.ansi3, 1)))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(t.ansi3).child(`${basename(a.doc.path)} has unsaved changes. Close it?`))
      .child(chip("save", "save & close", "s"))
      .child(chip("discard", "discard", "d"))
      .child(chip("keep", "keep open", "esc"));
  }

  /** The question's keys (it holds the keyboard while it shows): s / d / esc
   *  (n) answer, tab / ← → move between the answers, enter / space press. */
  askKey(e: KeyEvent, cx: Context): boolean {
    const a = this.asking;
    const k = e.key;
    const m = e.modifiers;

    if (!a) return false;

    if (["shift", "control", "alt", "platform", "function", "capslock"].includes(k)) return false;

    if (m.platform) return false;

    const i = ANSWERS.indexOf(a.at);
    const n = ANSWERS.length;

    if (k === "escape" || k === "n") this.answerClose("keep", cx);
    else if (k === "s" || k === "y") this.answerClose("save", cx);
    else if (k === "d") this.answerClose("discard", cx);
    else if (k === "enter" || k === "space") this.answerClose(a.at, cx);
    else if (k === "tab" || k === "right" || k === "l") a.at = ANSWERS[(i + (m.shift && k === "tab" ? n - 1 : 1)) % n] ?? a.at;
    else if (k === "left" || k === "h") a.at = ANSWERS[(i + n - 1) % n] ?? a.at;

    cx.notify();

    return true;
  }

  /** Vim's ex line (`:`, `/`, `?`), under the bar. */
  exLine(t: Theme, code: string): Element {
    const ex = this.vim.ex ?? "";
    const lead = ex.startsWith("/") || ex.startsWith("?") ? (ex[0] ?? ":") : ":";
    const body = lead === ":" ? ex : ex.slice(1);
    const ui = settings().ui_font_family || "Geist";

    return h_flex()
      .id("editor-ex")
      .relative()
      .h(FIND)
      .flex_none()
      .px(12)
      .gap(2)
      .items_center()
      .font_family(code)
      .text_size(12.5)
      .child(div().flex_none().text_color(t.accent).child(lead))
      .child(div().flex_none().text_color(t.foreground).child(body))
      .child(div().w(7).h(15).flex_none().bg(t.foreground))
      .child(div().flex_1())
      .child(h_flex().flex_none().gap(4).font_family(ui).text_size(11).child(div().text_color(t.accent).child("enter")).child(div().text_color(t.dim).child("run")))
      .child(h_flex().flex_none().gap(4).font_family(ui).text_size(11).child(div().text_color(t.accent).child("esc")).child(div().text_color(t.dim).child("cancel")))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }

  /** The leader's next keys, which-key style, bottom right over the text. */
  whichView(t: Theme): Element {
    const list = this.which ?? [];
    const cols = list.length > 6 ? 2 : 1;
    const rows = Math.ceil(list.length / cols);

    return v_flex()
      .id("editor-which")
      .absolute()
      .right(12)
      .bottom(HINTS + 8)
      .bg(t.background)
      .border(1)
      .border_color(t.ansi0)
      .shadow_lg()
      .child(
        h_flex()
          .relative()
          .h(24)
          .px(12)
          .gap(10)
          .items_center()
          .child(div().text_color(t.accent).child(this.pending ? `leader ${this.pending}` : "leader"))
          .child(div().relative().flex_1().min_w(40).h(1).opacity(0.6).child(dither(t.ansi8, 1)))
          .child(div().text_color(t.dim).child("esc")),
      )
      .child(
        h_flex()
          .px(12)
          .pb(8)
          .gap(18)
          .children(
            Array.from({ length: cols }, (_, c) =>
              v_flex()
                .gap(2)
                .children(
                  list.slice(c * rows, (c + 1) * rows).map((w, i) =>
                    h_flex()
                      .id(`which-${c}-${i}`)
                      .gap(10)
                      .child(div().w(36).text_color(t.accent).child(w.key))
                      .child(
                        div()
                          .text_color(w.label.startsWith("+") ? t.ansi5 : t.foreground)
                          .child(w.label),
                      ),
                  ),
                ),
            ),
          ),
      );
  }

  conflictLine(t: Theme): Element {
    const chip = (id: string, go: (cx: Context) => void): Element =>
      div()
        .id(id)
        .flex_none()
        .px(6)
        .h(18)
        .flex()
        .items_center()
        .border(1)
        .border_color(t.ansi0)
        .text_color(t.foreground)
        .hover((s) => s.border_color(t.accent))
        .on_click((_e, cx) => {
          go(cx);
          cx.notify();
        });

    return h_flex()
      .id("editor-conflict")
      .relative()
      .h(FIND)
      .flex_none()
      .px(12)
      .gap(10)
      .items_center()
      .child(div().absolute().inset_0().opacity(0.25).child(dither(t.ansi3, 1)))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(t.ansi3).child("Changed on disk while you edited it."))
      .child(
        chip("conflict-reload", (cx) => {
          this.dirty = false;
          setUnsaved(null);
          this.load(cx, null, false);
        }).child("reload theirs"),
      )
      .child(
        chip("conflict-keep", (cx) => {
          this.conflict = false;
          this.keepMine(cx);
        }).child("keep mine"),
      );
  }

  /** Keeping my version: what's on disk now becomes what saving replaces. */
  keepMine(cx: Context): void {
    cx.spawn(async (cx) => {
      try {
        this.saved = await readTextFile(this.path, { on: this.on });
      } catch {
        /* saved stays */
      }

      // A scratchpad writes yours over theirs by itself.
      if (this.scratch) {
        this.timerCx = cx;
        this.autosave?.touch();
        this.say("yours is kept: written in a moment");
      } else this.say("yours is kept: cmd-s writes it over theirs");

      cx.notify();
    });
  }

  findLine(t: Theme): Element {
    // A chip with the keyboard wears the dialogs' ring: a band, an accent edge.
    const chip = (id: string, label: string, on: boolean, go: (cx: Context) => void): Element =>
      div()
        .id(id)
        .flex_none()
        .h(18)
        .px(6)
        .flex()
        .items_center()
        .border(1)
        .border_color(on || this.findAt === id ? t.accent : t.ansi0)
        .text_color(on ? t.accent : this.findAt === id ? t.foreground : t.muted)
        .when(this.findAt === id, (el) => el.bg(t.ansi0))
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          go(cx);
          cx.notify();
        })
        .child(label);

    const hint = (k: string, what: string): Element => h_flex().flex_none().gap(4).child(div().text_color(t.accent).child(k)).child(div().text_color(t.dim).child(what));
    const line = this.mode === "line";
    const count = this.find.count ? `${(this.find.current ?? 0) + 1} / ${this.find.count}` : this.findInput?.value() ? "none" : "";
    const font = settings().font_family || "JetBrains Mono";
    const input = line ? this.lineInput : this.findInput;
    const replaceInput = this.replaceInput;

    return focusOn(v_flex().id("editor-find").relative().flex_none(), this.handle)
      .on_key_down((e, cx) => this.findKey(e, cx))
      .map((el) => tabActions(el, (e, cx) => this.findKey(e, cx)))
      .child(
        h_flex()
          .h(FIND)
          .px(12)
          .gap(10)
          .items_center()
          .child(
            div()
              .flex_none()
              .text_color(t.accent)
              .child(line ? "line" : "find"),
          )
          .child(
            div()
              .w(line ? 160 : 240)
              .flex_none()
              .h(20)
              .border_b(1)
              .border_color(t.accent)
              .when(Boolean(input), (el) => (input ? el.child(Input.new(input).size_full().text_size(12).font_family(font)) : el)),
          )
          .when(!line, (el) =>
            el
              .child(
                div()
                  .flex_none()
                  .text_color(this.find.count ? t.foreground : t.dim)
                  .child(count),
              )
              .child(
                chip("case", "Aa", this.caseSensitive, (cx) => {
                  this.caseSensitive = !this.caseSensitive;
                  this.search(cx);
                }),
              )
              .child(chip("prev", "‹", false, (cx) => this.step(-1, cx)))
              .child(chip("next", "›", false, (cx) => this.step(1, cx))),
          )
          .child(div().flex_1())
          .when(this.size.width > 560, (el) =>
            el
              .child(line ? hint("enter", "go") : hint("enter", "next"))
              .child(line ? div() : hint("shift-enter", "prev"))
              .child(line ? div() : hint("tab ⇧tab", "move"))
              .child(hint("esc", "close")),
          ),
      )
      .when(this.mode === "replace", (el) =>
        el.child(
          h_flex()
            .h(FIND)
            .px(12)
            .gap(10)
            .items_center()
            .child(div().flex_none().text_color(t.accent).child("with"))
            .child(
              div()
                .w(240)
                .flex_none()
                .h(20)
                .border_b(1)
                .border_color(this.findAt === "with" ? t.accent : t.ansi0)
                .when(Boolean(replaceInput), (el) => (replaceInput ? el.child(Input.new(replaceInput).size_full().text_size(12).font_family(font)) : el)),
            )
            .child(chip("replace-one", "replace", false, (cx) => this.replace(false, cx)))
            .child(chip("replace-all", "all", false, (cx) => this.replace(true, cx)))
            .child(div().flex_1())
            .when(this.size.width > 560, (el) => el.child(hint("enter", "replace")).child(hint(appWindow().platform === "macos" ? "⌘enter" : "ctrl-enter", "all"))),
        ),
      )
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }

  body(t: Theme, code: string): Element {
    if (this.state === "error") return this.note(t, "Can't edit this file", this.error);

    if (this.state === "loading") return this.note(t, "Reading…", null);

    const text = div()
      .id("editor-body")
      .relative()
      .flex_1()
      .min_h(0)
      .min_w(0)
      .pl(GUTTER_INSET)
      .when(this.state === "missing", (el) => el.child(div().absolute().top(6).right(14).text_color(t.dim).child("new file: cmd-s creates it")))
      .child(Editor.new(this.editor).size_full().font_family(code));

    const d = this.shown();

    if (d.markdown && d.view === "rendered" && d.rendered) return this.renderedView(t);

    if (!this.markdown || this.view === "text") return text;

    if (this.view === "preview") return this.previewView(t);

    const side = this.size.width >= SIDE_BY_SIDE;

    const rule = div()
      .relative()
      .flex_none()
      .when(side, (el) => el.w(1).h_full())
      .when(!side, (el) => el.h(1).w_full())
      .child(dither(t.ansi8, 1));

    // A plain row: h_flex centers its children, which would leave them no height.
    return (side ? div().flex().flex_row() : div().flex().flex_col())
      .id("editor-split")
      .flex_1()
      .min_h(0)
      .min_w(0)
      .child(text)
      .child(rule)
      .child(this.previewView(t));
  }

  note(t: Theme, title: string, detail: string | null): Element {
    return v_flex()
      .flex_1()
      .min_h(0)
      .items_center()
      .justify_center()
      .gap(10)
      .px(16)
      .child(svg("mods/nocturne/art/moon-8.svg").w(44).h(44).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child(title))
      .when(Boolean(detail), (el) => (detail ? el.child(div().text_center().text_color(t.ansi8).child(detail)) : el));
  }

  drawerView(t: Theme): Element {
    const sevColor = severityColors(t);
    const at = this.editor.cursor();
    const s = this.server;
    const empty = !this.problems.length;
    const none = s?.status === "ready" ? "No problems." : s?.status === "exited" ? s.note : s?.status === "starting" ? "The language server is starting…" : "No language server for this file.";

    return v_flex()
      .id("editor-problems")
      .h(DRAWER)
      .flex_none()
      .border_t(1)
      .border_color(t.ansi0)
      .child(
        h_flex()
          .relative()
          .h(ROW)
          .flex_none()
          .px(12)
          .gap(12)
          .items_center()
          .text_color(t.muted)
          .child(div().text_color(t.foreground).child("PROBLEMS"))
          .child(div().text_color(t.dim).child(`${this.problems.length}`))
          .child(div().relative().flex_1().h(1).opacity(0.6).child(dither(t.ansi8, 1)))
          .child(
            h_flex()
              .gap(4)
              .child(
                div()
                  .text_color(t.accent)
                  .child(this.vimOn() ? "]d" : "cmd-k n"),
              )
              .child(div().text_color(t.dim).child("next")),
          ),
      )
      .child(
        empty
          ? div().px(12).py(8).text_color(t.dim).child(none)
          : div()
              .id("problems-list")
              .flex_1()
              .min_h(0)
              .overflow_y_scrollbar()
              .children(
                this.problems.map((d, i) => {
                  const sel = d.line === at.line;
                  const color = sevColor[d.severity];

                  return h_flex()
                    .id(`problem-${i}`)
                    .relative()
                    .h(ROW)
                    .flex_none()
                    .px(12)
                    .gap(10)
                    .items_center()
                    .text_color(t.muted)
                    .hover((s) => s.bg(`${t.ansi0}55`))
                    .on_click((_e, cx) => {
                      this.goto(d.line, d.col, cx);
                      cx.notify();
                    })
                    .when(sel, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
                    .child(div().relative().size(7).flex_none().border(1).border_color(color).child(dither(color, 1)))
                    .child(div().relative().w(54).flex_none().text_color(t.dim).child(`${d.line + 1}:${d.col + 1}`))
                    .child(div().relative().flex_1().min_w(0).truncate().text_color(t.foreground).child(d.message.split("\n")[0] ?? ""))
                    .child(div().relative().flex_none().text_color(t.dim).child(codeAndSource(d)));
                }),
              ),
      );
  }

  hints(t: Theme): Element {
    if (this.look) return this.lookHints(t);

    const list = hintList({ mode: this.mode, vim: this.vimOn(), vimMode: this.vim.mode, server: serverId(this.server) !== null, markdown: this.markdown, view: this.view });
    // The keys entry (the last) is keyhelp.ts's: its key is the chord that opens it here.
    const last = list.at(-1);
    const help = last?.[1] === "keys" ? last : null;
    const rest = help ? list.slice(0, -1) : list;

    return h_flex()
      .id("editor-hints")
      .relative()
      .h(HINTS)
      .flex_none()
      .px(10)
      .gap(14)
      .items_center()
      .overflow_hidden()
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
      .children(rest.map(([k, what], i) => hint(t, `editor-hint-${i}`, k, what)))
      .when(Boolean(help), (el) => (help ? el.child(div().flex_1()).child(keysHint(t, "editor-hint-keys", this.keysShown, () => this.toggleKeys(!this.keysShown), help[0])) : el));
  }

  /** A drawn tab's body: the viewer, the pane's keys (lookKey). */
  lookView(t: Theme): Element {
    return focusOn(div().id("editor-look").relative().flex_1().min_h(0).min_w(0).flex().flex_col(), this.lookHandle)
      .on_key_down((e, cx) => this.lookKey(e, cx))
      .on_mouse_down("left", () => this.lookHandle?.focus())
      .child(this.viewer ? div().flex_1().min_h(0).child(this.viewer) : this.note(t, "Opening…", null));
  }

  /** A drawn tab's hints along the bottom: each one a button too. */
  lookHints(t: Theme): Element {
    const d = this.shown();

    const list: readonly (readonly [string, string, LookAct])[] = [
      ...(this.allDocs().length > 1 ? [["H L", "tabs", "next-tab"] as const] : []),
      ...(d.kind === "either" ? [["e", "text", "text"] as const] : []),
      ["p", "preview pane", "pane"],
      ["o", "open", "system"],
      ["y", "path", "copy"],
      ["d", "close", "close"],
    ];

    return h_flex()
      .id("editor-hints")
      .relative()
      .h(HINTS)
      .flex_none()
      .px(10)
      .gap(14)
      .items_center()
      .overflow_hidden()
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
      .children(
        list.map(([k, what, act], i) =>
          h_flex()
            .id(`editor-look-hint-${i}`)
            .flex_none()
            .gap(4)
            .items_center()
            .text_color(t.dim)
            .hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => {
              this.lookAct(act, cx);
              cx.notify();
            })
            .child(div().text_color(t.accent).child(k))
            .child(div().child(what)),
        ),
      )
      .child(div().flex_1())
      .child(keysHint(t, "editor-hint-keys", this.keysShown, () => this.toggleKeys(!this.keysShown), "?"));
  }

  /** Opens or closes the keys overview; it holds the keyboard while open, the file gets it back after. */
  toggleKeys(on: boolean): void {
    this.keysShown = on;

    if (on) this.keysHandle?.focus();
    else if (this.look) this.lookHandle?.focus();
    else if (this.view === "preview") this.previewHandle?.focus();
    else if (this.view === "rendered" && this.cur?.rendered) this.cur.rendered.focus();
    else this.editor.focus();
  }

  /** The keys entry (space ? / cmd-k ?): every key, in the file's place (keyhelp.ts); ? esc q close it. */
  keysStrip(t: Theme): Element {
    return focusOn(div().id("editor-keys-host").absolute().top(0).left(0).size_full(), this.keysHandle)
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
  codeBlock(t: Theme, part: Extract<CardPart, { code: string }>, lang: string, code: string): Element {
    let lines = part.lines;

    if (!lines) {
      const text = part.code;
      const spans = lang ? highlight(text, lang) : [];
      const colors = this.colors ?? syntaxColors(t);
      const made: ColorRun[][] = [];
      let at = 0;

      for (const line of text.split("\n")) {
        const end = at + line.length;
        const start = at;
        const mine = spans.flatMap(([s, e, n]): [number, number, string][] => (e > start && s < end ? [[Math.max(s, start) - start, Math.min(e, end) - start, n]] : []));

        made.push(colorRuns(line, mine, colors));
        at = end + 1;
      }

      lines = made;
      part.lines = made;
    }

    return v_flex()
      .px(12)
      .py(8)
      .font_family(code)
      .text_size(12)
      .children(
        lines.slice(0, 200).map((runs, i) =>
          h_flex()
            .id(`card-code-${i}`)
            .flex_wrap()
            .children(
              runs.map(([piece, color], j) =>
                div()
                  .id(`card-run-${i}-${j}`)
                  .text_color(color ?? t.foreground)
                  .child(piece),
              ),
            ),
        ),
      );
  }

  /** The card's links under its text: an arrow for where it goes (↗ the web,
   *  → a file), its words, and the host or file:line; the ringed one (tab)
   *  wears the dialogs' ring, enter follows it; a click follows any. */
  cardLinksView(t: Theme, c: Card): Element {
    const list = c.links.slice(0, 12);

    return v_flex()
      .id("card-links")
      .relative()
      .px(8)
      .pt(6)
      .pb(8)
      .gap(1)
      .child(
        h_flex()
          .relative()
          .h(16)
          .px(4)
          .gap(8)
          .items_center()
          .text_size(10)
          .text_color(t.dim)
          .child(div().flex_none().child("LINKS"))
          .child(div().relative().flex_1().h(1).opacity(0.6).child(dither(t.ansi8, 1)))
          .when(c.links.length > list.length, (el) => el.child(div().flex_none().child(`${list.length} of ${c.links.length}`))),
      )
      .children(
        list.map((l, i) => {
          const to = linkTarget(l.url, this.path);
          const on = c.link === i;
          const color = to?.kind === "web" ? t.ansi4 : to?.kind === "file" ? t.ansi5 : t.dim;

          return h_flex()
            .id(`card-link-${i}`)
            .relative()
            .h(20)
            .px(4)
            .gap(8)
            .items_center()
            .border(1)
            .border_color(on ? t.accent : t.background)
            .text_color(on ? t.foreground : t.muted)
            .when(on, (el) => el.bg(t.ansi0))
            .hover((s) => s.text_color(t.foreground).border_color(t.ansi0))
            .on_mouse_down("left", stop)
            .on_click((_e, cx) => this.followLink(l.url, cx))
            .child(
              div()
                .flex_none()
                .w(12)
                .text_color(color)
                .child(to?.kind === "web" ? "↗" : to?.kind === "file" ? "→" : "·"),
            )
            .child(div().flex_1().min_w(0).truncate().child(l.label))
            .child(div().flex_none().max_w(200).truncate().text_color(t.dim).child(linkWhere(to)));
        }),
      );
  }

  /** How far down the pane the text starts: the bar, and whatever lines sit
   *  between it and the text (a conflict, find / replace, vim's ex line). */
  textTop(): number {
    return this.stripH() + BAR + (this.asking ? FIND : 0) + (this.conflict ? FIND : 0) + (this.mode === "replace" ? 2 * FIND : this.mode ? FIND : 0) + (this.vim.ex !== null ? FIND : 0);
  }

  /** The card's word in pane coordinates (unzoomed), from where the editor
   *  last drew it; null when it's off screen. */
  cardAnchor(c: Card): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null {
    const b = this.editor.bounds({ line: c.line, col: c.col });

    if (!b?.view) return null;

    const z = zoom();
    const x = (b.x - b.view.x) / z;
    const y = (b.y - b.view.y) / z;
    const h = b.height / z;

    // Scrolled out of the text's own box: it waits there until the word is back.
    if (y + h < 0 || y > b.view.height / z) return null;

    return { x: x + GUTTER_INSET, y: y + this.textTop(), w: b.width / z, h };
  }

  /** The card, at its word: under it, or above it near the pane's foot;
   *  null while there's nothing to show (a pointer's card still waiting) or
   *  its word is off screen. */
  cardView(t: Theme, code: string): Element | null {
    const c = this.card;

    if (!c) return null;

    const waiting = c.pending && !c.problems.length;

    if (!this.cardShown(c)) return null;

    const anchor = this.cardAnchor(c);

    if (!anchor) return null;

    if (c.keyboard && !c.drawn) {
      c.drawn = true;
      this.mark(`card drawn ${Date.now() - c.opened}ms after it was asked${c.pending ? `, waiting: ${this.waitWords()}` : ""}`);
    }

    const footH = 24;
    // The pane's size comes in window pixels (zoomed); the card is placed in layout units.
    const z = zoom();
    const place = cardPlace(anchor, { width: this.size.width / z, height: this.size.height / z }, { width: CARD_W }, { top: this.stripH() + BAR, bottom: HINTS });
    const sevColor = severityColors(t);
    const lang = this.lang === "tsx" ? "typescript" : this.lang;

    const parts = c.parts.map((p, i) => {
      if ("code" in p) return this.codeBlock(t, p, p.lang ? (languageOf(p.lang) ?? lang) : lang, code);

      p.md ??= cardMarkdown(p.text);

      return div()
        .id(`card-text-${i}`)
        .px(12)
        .py(8)
        .text_color(t.muted)
        .child(TextView.markdown(`card-md-${i}`, p.md).on_link_click((url, cx) => this.followLink(url, cx)));
    });

    const expandable = (lang === "typescript" || lang === "javascript") && c.parts.length > 0;

    const ctrl = (id: string, label: string, on: boolean, go: (cx: Context) => void): Element =>
      div()
        .id(id)
        .flex_none()
        .w(18)
        .h(18)
        .flex()
        .items_center()
        .justify_center()
        .border(1)
        .border_color(on ? t.ansi0 : t.background)
        .text_color(on ? t.foreground : t.dim)
        .when(on, (el) =>
          el
            .hover((s) => s.border_color(t.accent))
            .on_click((_e, cx) => {
              go(cx);
              cx.notify();
            }),
        )
        .child(label);

    const key = (k: string, what: string): Element => h_flex().flex_none().gap(4).child(div().text_color(t.accent).child(k)).child(div().child(what));
    const vim = this.vimOn();
    const overflow = this.cardOverflows();
    const note = c.note;

    // What the card holds: its problems, what it waits for or why there's
    // nothing, and the server's answer; scrolled by its own offset (keys, wheel).
    const content = v_flex()
      .id("card-content")
      .relative()
      .top(-c.scroll)
      .flex_none()
      .on_size_change((size, cx) => {
        const h = size.height / zoom();

        if (Math.abs((c.contentH ?? -1) - h) > 0.5) {
          c.contentH = h;
          cx.notify();
        }
      })
      .children(
        c.problems.map((d, i) =>
          v_flex()
            .id(`card-problem-${i}`)
            .relative()
            .border_b(1)
            .border_color(t.ansi0)
            .child(div().absolute().left(0).right(0).top(0).h(3).child(dither(sevColor[d.severity], 1)))
            .child(div().px(12).pt(9).pb(4).text_size(11.5).text_color(t.foreground).font_family(code).child(d.message))
            .when(d.related.length > 0, (el) =>
              el.children(
                d.related.slice(0, 4).map((r, j) =>
                  div()
                    .id(`card-rel-${i}-${j}`)
                    .px(12)
                    .text_color(t.dim)
                    .child(`${r.path ? basename(r.path) : ""}:${r.line + 1}  ${r.message}`),
                ),
              ),
            )
            .child(
              h_flex()
                .px(12)
                .pb(8)
                .gap(12)
                .text_size(10)
                .text_color(t.dim)
                .child(div().text_color(sevColor[d.severity]).child(d.severity))
                .child(div().child(codeAndSource(d))),
            ),
        ),
      )
      .when(c.pending && c.keyboard, (el) =>
        el.child(
          h_flex()
            .id("card-wait")
            .px(12)
            .py(8)
            .gap(8)
            .items_center()
            .child(div().relative().size(6).flex_none().child(dither(t.ansi3, 1)))
            .child(div().flex_1().min_w(0).text_color(t.dim).child(this.waitWords())),
        ),
      )
      // No answer to give: what's the case, and what to do about it.
      .when(Boolean(note), (el) =>
        note
          ? el.child(
              v_flex()
                .id("card-note")
                .px(12)
                .py(8)
                .gap(4)
                .child(div().text_color(t.foreground).child(note.text))
                .when(Boolean(note.fix), (e2) => (note.fix ? e2.child(div().text_color(t.dim).child(note.fix)) : e2)),
            )
          : el,
      )
      .children(parts)
      .when(c.links.length > 0, (el) => el.child(this.cardLinksView(t, c)));

    const box = v_flex()
      .id("editor-card")
      .absolute()
      .left(place.left)
      .w(place.width)
      .max_h(place.maxH)
      .bg(t.background)
      .border(1)
      .border_color(waiting ? t.ansi8 : t.ansi0)
      .shadow_lg()
      .overflow_hidden()
      .on_hover((h, cx) => {
        this.overCard = h;

        if (!h && !c.keyboard) {
          cx.timer.after(250, (cx) => {
            if (!this.overCard && this.card === c) {
              this.card = null;
              cx.notify();
            }
          });
        }
      })
      .on_mouse_down("left", stop)
      .child(
        div()
          .id("card-scroll")
          .relative()
          .min_h(0)
          .overflow_hidden()
          .on_size_change((size, cx) => {
            const h = size.height / zoom();

            if (Math.abs((c.viewH ?? -1) - h) > 0.5) {
              c.viewH = h;
              cx.notify();
            }
          })
          .on_scroll_wheel((e, cx) => {
            if (!this.cardOverflows()) return;

            c.scroll = Math.max(0, Math.min((c.contentH ?? 0) - (c.viewH ?? 0), c.scroll - e.delta.y / zoom()));
            cx.stop_propagation();
            cx.notify();
          })
          .child(content),
      )
      // Its keys, and how it closes.
      .child(
        h_flex()
          .id("card-foot")
          .h(footH)
          .flex_none()
          .px(12)
          .gap(12)
          .items_center()
          .overflow_hidden()
          .border_t(1)
          .border_color(t.ansi0)
          .text_size(10)
          .text_color(t.dim)
          // The server's name, unless the type depth needs the room.
          .when(c.parts.length > 0 && !expandable, (el) => el.child(div().flex_none().child(serverName(this.server) ?? "")))
          .when(expandable, (el) =>
            el
              .child(ctrl("card-less", "−", c.level > 0, (cx) => this.hoverLevel(-1, cx)))
              .child(div().flex_none().child(`type depth ${c.level}`))
              .child(ctrl("card-more", "+", c.more, (cx) => this.hoverLevel(1, cx)))
              .child(div().flex_none().text_color(t.accent).child("ctrl-−/=")),
          )
          .when(c.parts.length > 0 && serverId(this.server) !== null, (el) => el.child(key(vim ? "gd" : "cmd-k d", "definition")))
          .when(c.keyboard && c.links.length > 0, (el) => el.child(key("tab", "links")))
          .when(overflow, (el) => el.child(key("ctrl-d ctrl-u", "scroll")))
          .child(div().flex_1())
          .child(key("esc", "close")),
      );

    return place.above ? box.bottom(place.bottom) : box.top(place.top);
  }
}

// What each tab keeps for its file (newDoc): the pane's `this.path`,
// `this.editor`, `this.dirty`, ... are the shown tab's (the accessors above).
// Methods that run for a tab in the background (reading, watching, saving,
// its server) take the tab.
export const TAB_FIELDS: readonly (keyof Doc)[] = [
  "path", "firstPath", "lang", "opts", "openedAt", "deleted", "saved", "state", "error", "dirty", "conflict", "problems", "server", "version", "sent", "progress", "hovers", "text", "find", "searchMark", "markdown", "preview", "images", "view", "driver", "previewDrove", "previewDue", "flushDue", "lastWork", "watchGen", "editor", "softWrap", "rendered", "scratch", "autosave", "saveState", "writing", "previewStale", "kind", "look", "watched"
];
