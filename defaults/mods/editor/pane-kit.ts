// What the editor pane's files share (main.ts and its parts): a tab's
// record (Doc) and the pane's other records, sizes, and small helpers.

import type { CardLink } from "./cardlinks.ts";
import type { EditorView } from "./editor-route.ts";
import type { Guarded } from "./guard.ts";
import { isBoolean, isNumber, isString, nullable, object, sharedMapKey } from "./guard.ts";
import type { ColorRun, LanguageOptions, ServerNote, ServerState } from "./logic.ts";
import type { HoverPart, Problem, SeverityColors, Work } from "./lsp-replies.ts";
import type { MarkdownDoc } from "./markdown.ts";
import type { Rendered } from "./rendered.ts";
import type { Autosave, AutosaveState } from "./scratch.ts";
import type { Handover, TabKind } from "./tabs.ts";
import type { EditorFindState, EditorState as EditorStateT } from "gpui-base";
import type { Color, Context, Element, FocusHandle, MouseButtonEvent } from "gpui-kit";
import { Background, PathBuilder } from "gpui-kit";
import type { PaneInfo, Theme } from "herdr";
import { settings, window as appWindow } from "herdr";

export const MOD = "editor";

// Each editor's file name by slot, for its pane header (nocturne/header.ts).
export const TITLES = "editor.titles";

export const TITLES_KEY = sharedMapKey(TITLES, isString);

export const BAR = 30;

export const FIND = 28;

export const HINTS = 22;

// The line numbers' room from the pane's left edge, as the top bar's inset (px):
// the gutter right-aligns them, so a 4-digit file's touched the border.
export const GUTTER_INSET = 12;

// Links to these open in the preview pane (preview); other files with a language in the editor.
export const PREVIEWED = /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|svg|avif|hei[cf]|pdf|csv|tsv|sqlite3?|db3?|diff|patch|ttf|otf|ttc|woff2?|mp4|m4v|mov|mp3|m4a|aac|wav|aiff?|flac|caf)$/i;

export const RECT = (): ReturnType<ReturnType<typeof PathBuilder.fill>["build"]> => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

export const zoom = (): number => Number(settings().zoom) || 1;

/** A 50% checker dither filling the parent (as nocturne/kit.ts). */
export function dither(color: Color, cell = 1): Element {
  const dpr = appWindow().platform === "macos" ? 2 : 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}

export const stop = (_e: MouseButtonEvent, cx: Context): void => cx.stop_propagation();

/** The editor's selection (and, drawn from it, search matches): the accent
 *  at 40%, see-through so the syntax colors read on it. */
export function selectionColor(t: Pick<Theme, "accent">): string {
  return t.accent.slice(0, 7) + "66";
}

/** The props an editor pane is opened with: its file (and place), its machine, its
 *  slot, opened to be looked at, popped out of another editor. */
export const isPaneProps = object({}, { path: isString, line: isNumber, col: isNumber, on: nullable(isString), slot: isString, look: isBoolean, popped: isBoolean });

/** A pane's props as an editor's (none when they aren't). */
export type PaneProps = Guarded<typeof isPaneProps>;

export const paneProps = (pane: PaneInfo): PaneProps => (isPaneProps(pane.props) ? pane.props : {});

/** A command's pane and machine arguments, each only where there is one. */
// A type (not an interface): it goes to herdr's run(), which takes an object of arguments.
export type WhereArgs = { pane?: string; on?: string };

export function whereArgs(pane: string | null | undefined, on: string | null): WhereArgs {
  const out: WhereArgs = {};

  if (pane) out.pane = pane;

  if (on !== null) out.on = on;

  return out;
}

/** A tab's state: unloaded (not shown yet), loading, ready, missing (a new file), error. */
export type DocState = "unloaded" | "loading" | "ready" | "missing" | "error";

/** A place to go once a tab is read: one-based line and column. */
export interface Go {
  readonly line: number;
  readonly col?: number | null;
}

/** A hover's answer for a place: its parts, and whether TypeScript can say more. */
export interface HoverAnswer {
  readonly parts: readonly HoverPart[];
  readonly more: boolean;
}

/** What a find has found: how many, and which one is current. */
export type FindCount = Pick<EditorFindState, "count" | "current">;

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
export type CardPart = { readonly code: string; readonly lang: string | null; lines?: ColorRun[][] } | { readonly text: string; md?: string };

/** What the card says when there's no answer: what's the case, and what to do. */
export type CardNote = Pick<ServerNote, "text" | "fix">;

/** The hover card: its place, asked with the keyboard or the pointer's, the problems
 *  there, the server's answer, the type depth, what it waits on, its scroll, its links. */
export interface Card {
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
export type Answer = "save" | "discard" | "keep";

/** The viewer's props for a drawn tab (viewer.ts isViewerProps). */
export interface ViewerPropsNow {
  readonly embedded: true;
  readonly path: string | null;
  readonly on: string | null;
  readonly scroll: { readonly n: number; readonly dir: number } | null;
  readonly reload: number;
}

export const isLspPos = object({ line: isNumber, character: isNumber });

/** A caught error's words. */
export const errorText = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** `el` tracking `handle` (made in init; a pane put together without init has none). */
export function focusOn(el: Element, handle: FocusHandle | null): Element {
  return handle ? el.track_focus(handle) : el;
}

/** The herdr session a tab's server answers on (null: not running). */
export const serverId = (s: ServerState | null | undefined): number | null => (s?.status === "ready" ? s.id : null);

/** A server's name, once it has one (starting, ready, stopped). */
export const serverName = (s: ServerState | null | undefined): string | null => (s?.status === "starting" || s?.status === "ready" || s?.status === "exited" ? s.name : null);

/** What a question to the server adds to its place: TypeScript's hover depth, references' context. */
export interface LspExtra {
  readonly verbosityLevel?: number;
  readonly context?: { readonly includeDeclaration: boolean };
}

/** A problem's code and source, as the drawer and the card show them. */
export const codeAndSource = (p: Problem): string => [p.code, p.source].filter((x) => x !== null && x !== "").join(" · ");

/** The colors of the severities (the drawer, the card). */
export const severityColors = (t: Theme): SeverityColors => ({ error: t.ansi1, warning: t.ansi3, info: t.ansi4, hint: t.dim });
