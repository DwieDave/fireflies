// The editor pane's shown tab (main.ts EditorPane builds on this): the
// tab's record (a Doc) and its fields as the pane's own, so `this.path` is
// the shown tab's path, `this.editor` its editor, and so on (TAB_FIELDS).

import type { EditorView } from "./editor-route.ts";
import type { LanguageOptions, ServerState } from "./logic.ts";
import type { Problem, Work } from "./lsp-replies.ts";
import type { MarkdownDoc } from "./markdown.ts";
import type { Rendered } from "./rendered.ts";
import type { Autosave, AutosaveState } from "./scratch.ts";
import type { TabKind } from "./tabs.ts";
import type { EditorState as EditorStateT } from "gpui-base";
import { View } from "gpui-kit";
import type { Doc, DocState, FindCount, HoverAnswer } from "./pane-kit.ts";

// What each tab keeps for its file (newDoc): the pane's `this.path`,
// `this.editor`, `this.dirty`, ... are the shown tab's (the accessors below).
// Methods that run for a tab in the background (reading, watching, saving,
// its server) take the tab.
export const TAB_FIELDS: readonly (keyof Doc)[] = [
  "path", "firstPath", "lang", "opts", "openedAt", "deleted", "saved", "state", "error", "dirty", "conflict", "problems", "server", "version", "sent", "progress", "hovers", "text", "find", "searchMark", "markdown", "preview", "images", "view", "driver", "previewDrove", "previewDue", "flushDue", "lastWork", "watchGen", "editor", "softWrap", "rendered", "scratch", "autosave", "saveState", "writing", "previewStale", "kind", "look", "watched"
];

/** The shown tab's fields as the pane's own (TAB_FIELDS). */
export abstract class TabFields extends View {
  /** The shown tab (main.ts keeps the tabs). */
  cur: Doc | null = null;

  /** The shown tab (init makes one before anything asks). */
  shown(): Doc {
    if (!this.cur) throw new Error("the editor has no tab yet");

    return this.cur;
  }

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
}
