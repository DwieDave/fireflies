// Nocturne editor: one file, edited, in a pane beside where it was opened
// from: a source link clicked in a terminal (`path:42:7` goes there), a file
// picked in the files pane or the picker (cmd-p, cmd-shift-f), an "edit" in the
// Markdown viewer or the preview, or `editor.open {path, line?, col?}`.
// Props: { path, line?, col?, on?, slot }.
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
// is narrow), drawn as it's typed by the Markdown viewer's renderer
// (markdown.js): math, mermaid, colored code, tables, callouts, footnotes,
// local images. It follows the text's scrolling and the text follows it;
// ticking a task box writes the [x] into the text; links go where they point
// (a heading in it, another .md file in the editor). The bar's chip, cmd-shift-v
// and space m p go split -> preview -> text; space m s / m v / m t pick one.
//
// Vim (vim.js): new editors start as settings.json `editor.vim` says (default
// on); the pane's "vim" chip, `:novim` and cmd-k v switch this pane only, and
// the pane keeps that choice (its localStorage) over the default. Its leader is space (settings.json
// editor.leader): a which-key popup lists the keys after it.
// Keys while it has focus (keys.json `mod:nocturne-editor`), vim on or off:
// cmd-s save, cmd-f find (enter / shift-enter next / previous, esc closes),
// cmd-alt-f replace, cmd-l go to line, cmd-k n / cmd-k p next / previous
// problem, cmd-k m problems, cmd-k d definition, cmd-i hover, ctrl-= / ctrl--
// hover type more / less, cmd-r reload, cmd-k v vim on / off, cmd-k ? (vim:
// space ?) the keys over the hint bar, whose last entry it is, cmd-shift-v the
// Markdown preview. Without vim:
// cmd-z / cmd-shift-z undo / redo, ctrl-g go to line.

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex, EditorState, Editor, InputState, Input, TextView } from "gpui-base";
import {
  props, theme, settings, run, panes, shared, setShared, readTextFile, writeTextFile, watchFolder, nextCommand, exec,
  home, appHome, languageOf, highlight, lspStart, lspRequest, lspNotify, lspNextMessage, lspRelease, setUnsaved, notify,
  window as appWindow,
} from "herdr";
import {
  languageSettings, serverCandidates, ROOTS, rootScript, pickRoot, languageId, uri, diagnostics, lineNotes, counts,
  diagnosticsAt, nextProblem, hoverParts, parseGoto, firstLocation, tilde, dirname, basename, syntaxColors, colorRuns, hintList, editorKeys, serverNote,
  cardPlace, busy, progressWord, changeBetween, incremental, cardMarkdown,
} from "./logic.js";
import { createVim, feed, play, token, SHAPE, MODE_NAME, applyEdits } from "./vim.js";
import { MarkdownDoc, cacheImage, taskToggle, isLocalSource } from "./markdown.js";
import { follow, join } from "./paths.js";
import { formKey, bindTab, tabActions } from "./form-keys.js";
import { hint, keysHint, keysView, keysKey } from "./keyhelp.js";
import { projectEnv, lookup, wrap, cacheName } from "./envrc.js";
import { CHANGES, newestId, follow as followFiles } from "./follow.js";

// The find line's stops in tab order (form-keys.js): the find field, Aa, ‹, ›
// and, replacing, the "with" field, replace, all.
const FIND_STOPS = [{ id: "find", kind: "text" }, { id: "case", kind: "toggle" }, { id: "prev", kind: "button" }, { id: "next", kind: "button", submit: true }];
const REPLACE_STOPS = [...FIND_STOPS, { id: "with", kind: "text" }, { id: "replace-one", kind: "button" }, { id: "replace-all", kind: "button" }];

const MOD = "nocturne-editor";
// Each editor's file name by slot, for its pane header (nocturne/header.js).
const TITLES = "nocturne-editor.titles";
// The app asks an editor already on a file to go somewhere (`editor.open` with a line).
const GOTO = "nocturne-editor.goto";
const POLL = 4000; // a file on another machine can't be watched
const CHANGE_DELAY = 40; // ms: edits typed together go to the server as one change (and before any question)
// How long a server runs on once its last editor closes (s): coming back to
// the project within it is instant. Herdr keeps at most a few unused servers
// (least recently used stop first), so this is a ceiling, not a promise.
export const SERVER_IDLE = 15 * 60;
// The project environments kept on disk (envrc.js): a second app start runs no nix.
const envCache = {
  file: (dir) => `${appHome()}/cache/nocturne-editor/${cacheName(dir)}`,
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
const BAR = 30, FIND = 28, HINTS = 22, DRAWER = 132, ROW = 24;
// The line numbers' room from the pane's left edge, as the top bar's inset (px):
// the gutter right-aligns them, so a 4-digit file's touched the border.
export const GUTTER_INSET = 12;
// The Markdown preview: how it shows, in the order the switch goes.
const VIEWS = ["split", "preview", "text"];
// Under this width a split puts the preview under the text.
const SIDE_BY_SIDE = 760;
// Links to these open in the preview pane (nocturne-preview); other files with a language in the editor.
const PREVIEWED = /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|svg|avif|hei[cf]|pdf|csv|tsv|sqlite3?|db3?|diff|patch|ttf|otf|ttc|woff2?|mp4|m4v|mov|mp3|m4a|aac|wav|aiff?|flac|caf)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;
const CARD_W = 520;
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

/** The editor's selection (and, drawn from it, search matches): the accent
 *  at 40%, see-through so the syntax colors read on it. */
export function selectionColor(t) {
  return String(t.accent ?? "#80a0ff").slice(0, 7) + "66";
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
    this.path = pr.path ?? "";
    this.openedAt = Date.now(); // the language server's timeline counts from here (mark)
    this.on = pr.on ?? null;
    // Renamed, moved or deleted from the files pane (follow.js): only what
    // comes after this start counts. A pane that followed its file before a
    // restart opens it where it went (its props keep the first path).
    this.firstPath = this.path;
    this.seenChange = newestId(shared(CHANGES));
    this.deleted = false; // the file was deleted (the files pane): a save writes it again
    try { const m = JSON.parse(localStorage.getItem("moved") ?? "null"); if (m?.from === this.path && m.to) this.path = m.to; } catch { /* a nicety */ }
    this.slot = pr.slot ?? null;
    this.lang = languageOf(this.path) ?? "text";
    this.opts = languageSettings(settings()?.editor, this.lang);
    this.saved = null; // the text as on disk, when last read or written
    this.state = "loading"; // loading | ready | missing | error
    this.error = null;
    this.dirty = false;
    this.conflict = false; // the file changed on disk while edited
    this.problems = []; // diagnostics()
    this.drawer = false;
    this.mode = null; // null | "find" | "replace" | "line"
    this.find = { count: 0, current: null };
    this.caseSensitive = false;
    this.server = null; // { id, argv, root, status: "starting" | "ready" | "exited" | "none", note }
    this.version = 1;
    this.sent = null; // the text the server has (its last didOpen / didChange)
    this.progress = new Map(); // the server's work under way ($/progress): token -> { title, message, percentage }
    this.hovers = new Map(); // answers by place, level and version: asking again is instant
    // The hover card: { line, col, keyboard, problems, parts, level, more, pending, note, scroll }.
    // It sits at its place in the text (editor.bounds), under the word or above it.
    this.card = null;
    this.overCard = false;
    this.size = { width: 800, height: 600 };
    this.message = null; // a short note in the bar (saved, reloaded, an error)
    this.handle = cx.focus_handle();
    bindTab(cx); // tab / shift-tab reach the key handler (form-keys.js)
    // Vim: the pane's own switch, else settings.json editor.vim (default on).
    const leader = String(settings()?.editor?.leader ?? "space");
    this.vim = createVim({ leader: leader === "space" ? " " : leader === "comma" ? "," : leader.slice(0, 1) || " " });
    this.which = null; // the leader's next keys
    this.pending = ""; // keys typed toward a command
    this.text = ""; // the text as last read from the editor (vim reads it)
    this.searchMark = null;

    const t = theme();
    this.colors = syntaxColors(t);
    this.editor = EditorState.new({
      language: this.lang, value: "", font_family: settings()?.font_family || "JetBrains Mono", font_size: 13,
      line_numbers: true, folding: true, soft_wrap: !!this.opts.soft_wrap, syntax: this.colors,
      // The theme's selection is moonfly's border tone, hard to see on its
      // background: moonfly blue at 40% stands out and keeps text readable.
      selection: selectionColor(t),
    });
    this.editor.set_tab_size(this.opts.tab_size, this.opts.insert_spaces === false);
    this.vim.indent = this.opts.insert_spaces === false ? "\t" : " ".repeat(this.opts.tab_size);
    this.editor.on("key", (e, cx) => this.vimKey(e, cx));
    // This pane's own vim switch, if it was flipped here before.
    try { const v = localStorage.getItem("vim"); this.paneVim = v === "on" ? true : v === "off" ? false : null; } catch { this.paneVim = null; }
    this.editor.set_cursor_shape(this.vimOn() ? SHAPE.normal : "bar");
    this.vimWas = this.vimOn();
    this.editor.on("change", (_e, cx) => this.changed(cx));
    this.editor.on("hover", (e, cx) => this.hovered(e, cx));
    // The editor losing the keyboard closes the card (and watchFocus, while
    // one is open: the editor's blur doesn't reach mods every time).
    this.editor.on("blur", (_e, cx) => this.closeCard(cx));
    // Markdown: the live preview and how it shows (the pane remembers).
    this.markdown = this.lang === "markdown";
    this.preview = new MarkdownDoc("pv");
    this.images = new Map(); // abs path -> cache name | null (can't) | undefined (copying)
    let view = null;
    try { view = localStorage.getItem("preview"); } catch { /* the default */ }
    this.view = VIEWS.includes(view) ? view : "split";
    this.driver = "editor"; // which side scrolled last: the other follows
    this.previewHandle = cx.focus_handle();
    // The keys overview takes the keyboard while it's open (? would type into the file).
    this.keysHandle = cx.focus_handle();
    this.editor.on("scroll", (_e, cx) => {
      // The card stays at its word: drawn again where the word went (and once
      // more a frame later, when the scrolled text has been laid out).
      if (this.card) { cx.notify(); cx.timer.after(16, (cx) => cx.notify()); }
      if (Date.now() - (this.previewDrove ?? 0) < 150) return;
      this.driver = "editor";
      if (this.markdown && this.view === "split") cx.notify();
    });
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

    this.title();
    this.load(cx, pr.line ? { line: pr.line, col: pr.col ?? 1 } : null);
    if (this.on) cx.timer.every(POLL, (cx) => this.load(cx, null, true));
    else if (this.path) this.watch(cx);
    // A newly opened editor takes the keyboard.
    for (const ms of [0, 120, 400]) cx.timer.after(ms, () => this.editor.focus());
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(`${MOD}.`, "");
        this.command(c, cx);
        cx.notify();
      }
    });
  }

  // ---- the file

  title() {
    if (!this.slot) return;
    const name = basename(this.path) + (this.dirty ? " ●" : "");
    const all = shared(TITLES) ?? {};
    if (all[this.slot] !== name) setShared(TITLES, { ...all, [this.slot]: name });
  }

  // ---- the files pane's renames, moves and deletes (follow.js)

  /** Acts on the change record's entries newer than the last seen (from a task, never a render). */
  followChanges(cx) {
    const r = followFiles(shared(CHANGES), this.seenChange, this.path, this.on);
    this.seenChange = r.seen;
    if (r.path !== this.path) this.moveTo(r.path, cx);
    if (r.deleted && !this.deleted) this.markDeleted(cx);
    cx.notify();
  }

  /** The file is at `to` now: the buffer, its edits, caret, scroll and undo
   *  stay; the name, the folder, the language and the server's document follow. */
  moveTo(to, cx) {
    const from = this.path, s = this.server;
    if (s?.id != null) lspNotify(s.id, "textDocument/didClose", { textDocument: { uri: uri(from) } });
    this.path = to;
    this.deleted = false;
    try { localStorage.setItem("moved", JSON.stringify({ from: this.firstPath, to })); } catch { /* a nicety */ }
    const lang = languageOf(to) ?? "text";
    if (lang !== this.lang) {
      // Another language: its grammar, settings and server.
      this.lang = lang;
      this.opts = languageSettings(settings()?.editor, lang);
      this.editor.set_language(lang);
      this.markdown = lang === "markdown";
      if (s?.id != null) lspRelease(s.id);
      this.server = null;
      this.setProblems([]);
      if (this.state === "ready") this.startServer(cx);
    } else if (s?.id != null) {
      this.version += 1;
      this.sent = this.editor.value();
      lspNotify(s.id, "textDocument/didOpen", { textDocument: { uri: uri(to), languageId: languageId(lang, to), version: this.version, text: this.sent } });
    }
    if (!this.on) this.watch(cx);
    setUnsaved(this.dirty ? `${basename(to)}: unsaved changes` : null);
    this.title();
    this.say(`moved to ${tilde(dirname(to), home())}`);
  }

  /** The file was deleted: the editor keeps its text and says so; a save writes it again. */
  markDeleted(cx) {
    this.deleted = true;
    this.saved = null; // a save creates it (writeTextFile's "new file")
    this.conflict = false;
    this.dirty = this.editor.value() !== "";
    setUnsaved(this.dirty ? `${basename(this.path)}: deleted, unsaved` : null);
    this.title();
    cx?.notify?.();
  }

  /** Reads the file; `go`: the place to put the caret after. `quiet`: a poll
   *  or a change on disk, which leaves an edited buffer alone. */
  load(cx, go, quiet) {
    if (!this.path) { this.state = "error"; this.error = "No file given: editor.open {path}."; return; }
    cx.spawn(async (cx) => {
      let text = null, error = null;
      try {
        text = await readTextFile(this.path, { on: this.on });
        if (text != null && text.includes("\0")) { text = null; error = "Not a text file: it holds binary data."; }
      } catch (e) { error = String(e?.message ?? e); }
      if (quiet) {
        if (text == null || text === this.saved) return;
        if (this.dirty) { if (text !== this.editor.value()) this.conflict = true; cx.notify(); return; }
        const at = this.editor.cursor();
        this.saved = text;
        this.editor.set_value(text);
        this.text = text;
        if (this.markdown) this.refreshPreview(cx, true);
        this.editor.set_cursor(at.line, at.col);
        this.say("reloaded: it changed on disk");
        this.didChange(cx, true);
        // What's in the editor is what's on disk now: saved, as far as the
        // server goes (rust-analyzer runs cargo check on a save, so an agent's
        // edit shows its errors as one of Developer's would).
        if (this.server?.id != null) lspNotify(this.server.id, "textDocument/didSave", { textDocument: { uri: uri(this.path) }, text });
        cx.notify();
        return;
      }
      if (error) { this.state = "error"; this.error = error; cx.notify(); return; }
      if (text == null) { this.state = "missing"; this.saved = null; this.editor.set_value(""); }
      else { this.state = "ready"; this.saved = text; this.editor.set_value(text); }
      this.text = text ?? "";
      if (this.markdown) this.refreshPreview(cx, true);
      this.dirty = false; this.conflict = false;
      setUnsaved(null);
      this.title();
      if (go) this.goto(go.line - 1, go.col - 1, cx);
      cx.notify();
      if (this.state === "ready" && !this.server) this.startServer(cx);
    });
  }

  /** Waits for the file's folder to change, and reads the file again. */
  watch(cx) {
    const dir = dirname(this.path);
    // A moved file's editor watches its new folder; the old loop ends.
    const gen = this.watchGen = (this.watchGen ?? 0) + 1;
    cx.spawn(async (cx) => {
      for (;;) {
        let changed;
        try { changed = await watchFolder(dir); } catch { return; }
        if (gen !== this.watchGen) return;
        if (!changed.some((p) => basename(p) === basename(this.path) || p === dir)) continue;
        this.load(cx, null, true);
      }
    });
  }

  changed(cx) {
    this.text = this.editor.value();
    this.hovers.clear();
    // Typing closes the card.
    if (this.card) this.closeCard(cx);
    if (this.markdown) this.refreshPreview(cx);
    const dirty = this.text !== (this.saved ?? "");
    if (dirty !== this.dirty) {
      this.dirty = dirty;
      setUnsaved(dirty ? `${basename(this.path)}: unsaved changes` : null);
      this.title();
    }
    this.didChange(cx);
    cx.notify();
  }

  async save(cx) {
    if (this.state === "error") return;
    let text = this.editor.value();
    if (this.opts.format_on_save && this.opts.format) text = await this.format(text, cx) ?? text;
    try {
      // Only over what was read: a file someone else changed isn't overwritten.
      await writeTextFile(this.path, text, this.saved);
      this.saved = text;
      this.state = "ready";
      this.deleted = false;
      this.dirty = this.editor.value() !== text;
      this.conflict = false;
      setUnsaved(this.dirty ? `${basename(this.path)}: unsaved changes` : null);
      this.title();
      this.say("saved");
      if (this.server?.id != null) lspNotify(this.server.id, "textDocument/didSave", { textDocument: { uri: uri(this.path) }, text });
      else if (!this.server) this.startServer(cx);
    } catch (e) {
      this.say(String(e?.message ?? e), true);
      if (/changed outside/.test(String(e?.message ?? e))) this.conflict = true;
    }
    cx.notify();
  }

  /** Runs settings.json's `format` on the text (it reads stdin, prints the
   *  result); puts the result in as one undoable edit. Null when it fails. */
  async format(text, cx) {
    const tmp = `${appHome()}/cache/nocturne-editor/format-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await writeTextFile(tmp, text, null);
      const r = await exec("sh", ["-c", 'f="$1"; shift; "$@" < "$f"', "format", tmp, ...this.opts.format], { cwd: dirname(this.path) });
      exec("rm", ["-f", tmp]).catch(() => {});
      if (r.code !== 0 || !r.stdout) { this.say(`formatter failed: ${(r.stderr || "").split("\n")[0]}`, true); return null; }
      if (r.stdout !== text) {
        const lines = text.split("\n");
        this.editor.edit([{ start: { line: 0, col: 0 }, end: { line: lines.length - 1, col: lines[lines.length - 1].length }, text: r.stdout }]);
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
  mark(what) {
    console.debug(`lsp ${basename(this.path)} +${Date.now() - this.openedAt}ms ${what}`);
  }

  /** Starts (or joins) the file's language server as the editor opens, so it
   *  is warm by the time anything is asked: the project's environment from
   *  disk when nothing it depends on changed (envrc.js), the lookups side by
   *  side, then herdr's session for this server and workspace. `fresh`: the
   *  kept environment's server is gone (garbage-collected): load it anew. */
  async startServer(cx, fresh = false) {
    if (this.on) { this.server = { status: "none", why: "remote" }; return; }
    const candidates = serverCandidates(this.lang, this.opts);
    if (!candidates.length) { this.server = { status: "none", why: this.opts.server === false ? "off" : "unknown" }; cx.notify(); return; }
    const names = candidates.map((c) => basename(c.argv[0]));
    const dir = dirname(this.path);
    // The workspace's own environment first (envrc.js): its .envrc, through direnv.
    this.mark("start");
    const env = await projectEnv(exec, dir, {
      cache: envCache, fresh,
      loading: (at) => { this.server = { status: "env", envrc: at, names }; this.mark("environment: loading with direnv"); cx.notify(); },
    });
    this.mark(`environment: ${env.kind}${env.cached ? " (kept on disk; refreshing behind)" : ""}`);
    const inEnv = env.kind === "ready" ? env.env : null;
    // Every candidate's path and the workspace root at once: each is a process.
    const markers = ROOTS[this.lang]?.markers ?? [];
    const [paths, r] = await Promise.all([
      Promise.all(candidates.map((c) => (c.argv[0].startsWith("/") ? c.argv[0] : lookup(exec, c.argv[0], inEnv)))),
      exec("sh", ["-c", rootScript(markers), "root", dir]).catch(() => null),
    ]);
    const at = paths.findIndex(Boolean);
    const pick = at >= 0 ? candidates[at] : null, path = paths[at] ?? null;
    if (!pick && env.cached && !fresh) return this.startServer(cx, true);
    // Not there: why, for the bar and the hover card (logic.js serverNote).
    const envNote = env.kind === "none" ? {} : { envrc: env.dir, envKind: env.kind, envNote: env.note ?? null, denied: env.denied ?? false };
    if (!pick) { this.server = { status: "none", why: "missing", names, ...envNote }; this.cardState(cx); cx.notify(); return; }
    this.mark(`lookup: ${path ?? "none"}`);
    const root = pickRoot(this.lang, r?.stdout, dir);
    const argv = wrap(pick.argv, path, inEnv);
    this.server = { status: "starting", argv, root, name: basename(pick.argv[0]), ...envNote };
    this.progress.clear();
    cx.notify();
    let started;
    this.mark("lspStart");
    try { started = await lspStart({ argv, root, settings: pick.settings, idle: SERVER_IDLE }); }
    catch (e) { this.server = { ...this.server, status: "exited", note: String(e?.message ?? e) }; this.cardState(cx); cx.notify(); return; }
    this.server = { ...this.server, id: started.id, caps: started.capabilities ?? {}, status: "ready" };
    this.mark("initialized");
    this.lastWork = Date.now();
    this.version = 1;
    this.sent = this.editor.value();
    lspNotify(started.id, "textDocument/didOpen", { textDocument: { uri: uri(this.path), languageId: languageId(this.lang, this.path), version: this.version, text: this.sent } });
    this.listen(started.id, cx);
    this.cardState(cx);
    cx.notify();
  }

  listen(id, cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        let m;
        try { m = await lspNextMessage(id); } catch { return; }
        if (this.server?.id !== id) return;
        if (m.method === "textDocument/publishDiagnostics" && m.params?.uri === uri(this.path)) {
          this.setProblems(diagnostics(m.params.diagnostics));
          cx.notify();
        } else if (m.method === "$/progress") {
          this.progressed(m.params, cx);
        } else if (m.method === "$/exit") {
          this.server = { ...this.server, status: "exited", id: null, note: (m.params?.stderr ?? []).slice(-1)[0] ?? "it stopped" };
          this.progress.clear();
          this.cardState(cx);
          cx.notify();
          return;
        }
      }
    });
  }

  /** The server's work under way, for the bar ("indexing 120/340") and a
   *  waiting card, which asks again once the work answers wait on is done. */
  progressed(params, cx) {
    const token = String(params?.token), v = params?.value ?? {};
    const wasBusy = busy(this.progress);
    if (!/\b(cargo check|check|clippy|flycheck)\b/i.test(v.title ?? this.progress.get(token)?.title ?? "")) this.lastWork = Date.now();
    if (v.kind === "begin") { this.progress.set(token, { title: v.title ?? "", message: v.message ?? "", percentage: v.percentage }); this.mark(`begin ${v.title}`); }
    else if (v.kind === "report" && this.progress.has(token)) Object.assign(this.progress.get(token), v.message != null ? { message: v.message } : {}, v.percentage != null ? { percentage: v.percentage } : {});
    else if (v.kind === "end") { this.mark(`end ${this.progress.get(token)?.title ?? token}`); this.progress.delete(token); }
    else return;
    if (v.kind === "end" && !busy(this.progress)) { this.hovers.clear(); if (wasBusy) this.cardState(cx); }
    // Reports come by the hundred while it indexes: one redraw per frame or so.
    if (this.redrawSoon) return;
    this.redrawSoon = true;
    cx.timer.after(50, (cx) => { this.redrawSoon = false; cx.notify(); });
  }

  setProblems(list) {
    this.problems = list;
    const t = theme();
    const colors = { error: t.ansi1, warning: t.ansi3, info: t.ansi4, hint: t.dim };
    this.editor.set_diagnostics(list);
    this.editor.set_line_notes(lineNotes(list, colors).map((n) => ({ ...n, color: n.color + "bb" })));
  }

  /** Tells the server about an edit: what changed since it last heard, as one
   *  ranged change (the whole text for servers that want it, or when another
   *  editor has the file open too: their buffers differ), a moment after the
   *  typing, or at once (`now`; before every question). */
  didChange(cx, now) {
    if (this.server?.id == null) return;
    if (now) return this.flush();
    if (this.flushDue) return;
    this.flushDue = true;
    cx.timer.after(CHANGE_DELAY, () => this.flush());
  }

  flush() {
    this.flushDue = false;
    const s = this.server;
    if (s?.id == null) return;
    const text = this.editor.value();
    if (text === this.sent) return;
    const alone = panes().filter((p) => p.mod === MOD && p.props?.path === this.firstPath).length <= 1;
    const change = this.sent != null && alone && incremental(s.caps) ? changeBetween(this.sent, text) : { text };
    this.sent = text;
    lspNotify(s.id, "textDocument/didChange", { textDocument: { uri: uri(this.path), version: ++this.version }, contentChanges: [change] });
  }

  /** A question about a place (the caret by default). `key`: a newer question
   *  with the same key cancels this one at the server (herdr's lspRequest). */
  async request(method, extra = {}, line, col, key) {
    if (this.server?.id == null) return null;
    this.flush();
    const at = line == null ? this.editor.cursor() : { line, col };
    return lspRequest(this.server.id, method, { textDocument: { uri: uri(this.path) }, position: { line: at.line, character: at.col }, ...extra }, key ? { key } : undefined);
  }

  async definition(cx) {
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
    if (loc.path === this.path) this.goto(loc.line, loc.col, cx);
    else run("editor.open", { path: loc.path, line: loc.line + 1, col: loc.col + 1 });
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
    const verbosity = this.lang === "typescript" || this.lang === "tsx" || this.lang === "javascript" ? { verbosityLevel: card.level } : {};
    this.request("textDocument/hover", verbosity, card.line, card.col, "hover").then((h) => {
      if (this.card !== card) return;
      const answer = { parts: hoverParts(h?.contents), more: !!h?.canIncreaseVerbosityLevel };
      // Nothing yet while the workspace loads: wait for it, then ask again.
      if (!answer.parts.length && this.settling()) return this.askAgain(card, cx);
      this.hovers.set(key, answer);
      this.answered(card, answer, cx);
    }, (e) => {
      if (this.card !== card || /cancelled/.test(String(e?.message ?? e))) return;
      // Changed under it while loading ("content modified"): asked again when the work is done.
      if (this.settling()) return this.askAgain(card, cx);
      card.pending = false;
      if (card.keyboard && !card.problems.length) card.note = { text: `${s.name ?? "The language server"} didn't answer${e?.message ? `: ${e.message}` : "."}`, fix: null };
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

  /** A key on the find line, as every form takes them (form-keys.js): tab /
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
    this.editor.focus();
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

  /** Vim's state when it's turned on or off. */
  vimSettled(on) {
    this.vim.mode = "normal"; this.vim.keys = []; this.vim.ex = null; this.vim.pendingLeader = null;
    this.which = null; this.pending = "";
    this.editor.set_cursor_shape(on ? SHAPE.normal : "bar");
    this.vimWas = on;
  }

  /** A keystroke, before the editor sees it: vim's, or the editor's (false). */
  vimKey(e, cx) {
    if (this.cardKey(e, cx)) return true;
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
    return { text: this.text, cursor: this.editor.cursor(), clipboard, page: lines };
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
    const me = () => panes().find((p) => p.mod === MOD && p.props?.slot === this.slot);
    switch (name) {
      case "save": return this.save(cx);
      case "save-quit": return this.save(cx).then(() => { if (!this.dirty) run("pane.close", { ...(me() ? { pane: me().pane } : {}) }); });
      case "quit": if (this.dirty) return this.say("E37: unsaved changes (:q! discards them)", true); return run("pane.close", { ...(me() ? { pane: me().pane } : {}) });
      case "quit!": setUnsaved(null); this.dirty = false; return run("pane.close", { ...(me() ? { pane: me().pane } : {}), confirmed: true });
      case "reload": if (this.dirty) return this.say("E37: unsaved changes (:e! discards them)", true); return this.load(cx, null, false);
      case "reload!": this.dirty = false; return this.load(cx, null, false);
      case "edit": return run("editor.open", { path: arg.startsWith("/") ? arg : `${dirname(this.path)}/${arg}` });
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
      case "preview": case "preview-split": case "preview-only": case "preview-text": return this.command(name, cx);
      case "set": return this.say(`:set ${arg ?? ""}: only :novim is known`);
      case "write": return this.say("E: :w <file> isn't supported; :w saves this file", true);
      default: return;
    }
  }

  async references(cx) {
    let list = null;
    try { list = await this.request("textDocument/references", { context: { includeDeclaration: false } }); } catch (e) { return this.say(String(e?.message ?? e), true); }
    if (!list?.length) { this.say("no references"); cx.notify(); return; }
    this.say(`${list.length} reference${list.length === 1 ? "" : "s"}: going to the first`);
    const loc = firstLocation(list);
    if (loc.path === this.path) this.goto(loc.line, loc.col, cx);
    else run("editor.open", { path: loc.path, line: loc.line + 1, col: loc.col + 1 });
    cx.notify();
  }

  async formatNow(cx) {
    if (this.opts.format) { await this.format(this.editor.value(), cx); cx.notify(); return; }
    if (this.server?.id == null) return this.say("no formatter: settings.json editor format");
    try {
      const edits = await lspRequest(this.server.id, "textDocument/formatting", { textDocument: { uri: uri(this.path) }, options: { tabSize: this.opts.tab_size, insertSpaces: this.opts.insert_spaces !== false } });
      if (edits?.length) this.editor.edit(edits.map((e) => ({ start: { line: e.range.start.line, col: e.range.start.character }, end: { line: e.range.end.line, col: e.range.end.character }, text: e.newText })));
      this.say("formatted");
    } catch (e) { this.say(String(e?.message ?? e), true); }
    cx.notify();
  }

  // ---- commands (keys.json mod:nocturne-editor)

  command(c, cx) {
    if (c === "focus") return this.editor.focus();
    if (c === "save") return this.save(cx);
    if (c === "find") return this.openFind(false);
    if (c === "replace") return this.openFind(true);
    if (c === "line") { this.mode = "line"; this.lineInput.set_value(""); return this.lineInput.focus(); }
    if (c === "next-problem") return this.problem(1, cx);
    if (c === "prev-problem") return this.problem(-1, cx);
    if (c === "problems") { this.drawer = !this.drawer; return; }
    if (c === "definition") return this.definition(cx);
    // cmd-i (vim: K) opens the card at the caret, and closes an open one.
    if (c === "hover") { if (this.card) return this.closeCard(cx); const at = this.editor.cursor(); return this.showCard(at.line, at.col, true, cx); }
    if (c === "hover-more") return this.hoverLevel(1, cx);
    if (c === "hover-less") return this.hoverLevel(-1, cx);
    if (c === "reload") { this.dirty = false; return this.load(cx, null, false); }
    if (c === "vim") return this.toggleVim(cx);
    if (c === "keys") return this.toggleKeys(!this.keysShown);
    if (c === "preview") return this.setView(VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length], cx);
    if (c === "preview-split") return this.setView("split", cx);
    if (c === "preview-only") return this.setView("preview", cx);
    if (c === "preview-text") return this.setView("text", cx);
  }

  // ---- the Markdown preview

  /** Splits the text into the preview's blocks again (now, or after a moment of typing). */
  refreshPreview(cx, now) {
    const apply = (cx) => {
      this.previewDue = false;
      this.preview.setText(this.text);
      this.loadImages(cx);
      cx.notify();
    };
    if (now) return apply(cx);
    if (this.previewDue) return;
    this.previewDue = true;
    cx.timer.after(40, (cx) => apply(cx));
  }

  /** Split, preview only or text only; the pane remembers. */
  setView(view, cx) {
    if (!this.markdown) return this.say("the preview is for Markdown files");
    this.view = view;
    try { localStorage.setItem("preview", view); } catch { /* a nicety */ }
    this.driver = "editor";
    if (view === "preview") cx.timer.after(0, () => this.previewHandle.focus());
    else this.editor.focus();
    this.say(view === "split" ? "preview beside the text" : view === "preview" ? "preview only (e: back to the text)" : "text only");
    cx.notify();
  }

  /** Copies the document's local images where they can be drawn. */
  loadImages(cx) {
    if (this.on) return;
    for (const part of this.preview.parts) {
      if (part.kind !== "images") continue;
      for (const img of part.images) {
        if (!isLocalSource(img.src)) continue;
        const abs = join(dirname(this.path), decodeURI(img.src.split(/[?#]/)[0]));
        if (this.images.has(abs)) continue;
        if (!IMAGE_EXT.test(abs)) { this.images.set(abs, null); continue; }
        this.images.set(abs, undefined);
        cx.spawn(async (cx) => { this.images.set(abs, await cacheImage(abs, MOD)); cx.notify(); });
      }
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
      if (!this.preview.scrollTo(anchor)) return;
      // The text goes there too: the heading's line.
      const part = this.preview.parts.find((p) => p.anchor === anchor || p.anchors?.includes(anchor) || p.notes?.some((n) => n.anchor === anchor));
      const line = part?.notes?.find((n) => n.anchor === anchor)?.from ?? part?.from;
      if (line != null && this.view !== "preview") { this.previewDrove = Date.now(); this.driver = "preview"; this.editor.set_cursor(line, 0); this.editor.scroll_to_line(line); }
    };
    if (to.kind === "anchor") here(to.anchor);
    else if (to.kind === "markdown") {
      if (to.path === this.path) { if (to.anchor) here(to.anchor); }
      else run("editor.open", { path: to.path, ...(me ? { pane: me.pane } : {}), ...(this.on ? { on: this.on } : {}) });
    } else if (to.kind === "web") run("app.open_url", { url: to.url });
    else if (to.kind === "file" && PREVIEWED.test(to.path)) run("preview.open", { path: to.path, ...(me ? { pane: me.pane } : {}), ...(this.on ? { on: this.on } : {}) });
    else if (to.kind === "file" && languageOf(to.path)) run("editor.open", { path: to.path, ...(me ? { pane: me.pane } : {}), ...(this.on ? { on: this.on } : {}) });
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
        onImage: (abs) => { const me = panes().find((p) => p.mod === MOD && p.props?.slot === this.slot); run("preview.open", { path: abs, ...(me ? { pane: me.pane } : {}) }); },
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
    if (this.server?.id != null) {
      lspNotify(this.server.id, "textDocument/didClose", { textDocument: { uri: uri(this.path) } });
      lspRelease(this.server.id);
    }
    setUnsaved(null);
    if (this.slot) {
      const all = { ...(shared(TITLES) ?? {}) };
      delete all[this.slot];
      setShared(TITLES, all);
    }
  }

  // ---- drawing

  render(cx) {
    const t = theme();
    if (this.vimWas !== undefined && this.vimWas !== this.vimOn()) this.vimSettled(this.vimOn());
    const goto = shared(GOTO);
    // A newer rename, move or delete from the files pane: answered after this render.
    if (newestId(shared(CHANGES)) > this.seenChange) cx.timer.after(0, (cx) => this.followChanges(cx));
    if (goto && goto.path === this.path && goto.n !== this.seenGoto) {
      this.seenGoto = goto.n;
      if (this.state !== "loading") this.goto(goto.line - 1, (goto.col ?? 1) - 1, cx);
    }
    const code = settings()?.font_family || "JetBrains Mono";
    return v_flex().id("nocturne-editor").relative().size_full().bg(t.background).text_size(11)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_key_down((e, cx) => {
        // The editor's own keys came through vimKey; these are the pane's
        // others (the find line, the preview): esc closes the card, then find.
        if (e.key !== "escape") return;
        if (this.card) { this.closeCard(cx); cx.stop_propagation(); }
        else if (this.mode) { this.closeFind(cx); cx.stop_propagation(); }
      })
      // A click outside the card closes it (the card keeps its own).
      .on_mouse_down("left", (_e, cx) => this.closeCard(cx))
      .child(this.bar(t))
      .when(this.conflict, (el) => el.child(this.conflictLine(t)))
      .when(this.mode != null, (el) => el.child(this.findLine(t)))
      .when(this.vim.ex != null, (el) => el.child(this.exLine(t, code)))
      // ?: the keys in the file's place (the file folds away, kept), the bars stay (keyhelp.js).
      .when(Boolean(this.keysShown), (el) => el.child(div().relative().flex_1().min_h(0).child(this.keysStrip(t))))
      .child(this.keysShown ? div().h(0).flex_none().overflow_hidden().child(this.body(t, code)) : this.body(t, code))
      .when(this.drawer && !this.keysShown, (el) => el.child(this.drawerView(t)))
      .child(this.hints(t))
      .map((el) => { const card = this.card ? this.cardView(t, code) : null; return card ? el.child(card) : el; })
      .when(!!this.which?.length && this.vimOn(), (el) => el.child(this.whichView(t)));
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
      .child(div().relative().size(8).flex_none().border(1).border_color(this.dirty ? t.ansi3 : t.ansi0)
        .when(this.dirty, (el) => el.child(dither(t.ansi3, 1))))
      .child(div().flex_none().text_color(t.foreground).child(basename(this.path) || "untitled"))
      .when(this.deleted, (el) => el.child(div().id("bar-deleted").flex_none().text_color(t.ansi1).child("deleted · cmd-s writes it again")))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(narrow ? "" : dir))
      .when(!!msg, (el) => el.child(div().flex_none().text_color(msg.bad ? t.ansi1 : t.ansi2).truncate().max_w(260).child(msg.text)))
      .when(c.error > 0, (el) => el.child(sev(c.error, t.ansi1, "bar-errors")))
      .when(c.warning > 0, (el) => el.child(sev(c.warning, t.ansi3, "bar-warnings")))
      .when(!!server && !narrow, (el) => el.child(h_flex().id("bar-server").flex_none().gap(6).items_center().text_color(t.muted)
        .child(div().size(6).bg(server[0])).child(server[1])))
      .when(!narrow, (el) => el.child(h_flex().flex_none().h(18).px(6).items_center().border(1).border_color(t.ansi0).text_color(t.muted)
        .child(`${this.lang} · ${this.opts.insert_spaces === false ? "tab" : `${this.opts.tab_size} sp`}`)))
      .when(vim && !!this.pending, (el) => el.child(div().flex_none().text_color(t.foreground).child(this.pending)))
      .when(!!at, (el) => el.child(div().flex_none().text_color(t.dim).child(`${at.line + 1}:${at.col + 1}`)))
      .when(this.markdown, (el) => el.child(div().id("bar-preview").flex_none().h(18).px(6).flex().items_center().border(1)
        .border_color(this.view === "text" ? t.ansi0 : t.ansi5).text_color(this.view === "text" ? t.dim : t.ansi5).hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => this.command("preview", cx)).child(this.view)))
      .child(div().id("bar-vim").flex_none().h(18).px(6).flex().items_center().border(1).border_color(vim ? t.accent : t.ansi0)
        .text_color(vim ? t.accent : t.dim).hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => this.toggleVim(cx)).child("vim"));
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
      this.say("yours is kept: cmd-s writes it over theirs");
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
    const list = hintList({ mode: this.mode, vim: this.vimOn(), vimMode: this.vim.mode, server: this.server?.id != null, markdown: this.markdown, view: this.view });
    // The keys entry (the last) is keyhelp.js's: its key is the chord that opens it here.
    const help = list.at(-1)?.[1] === "keys" ? list.at(-1) : null;
    const rest = help ? list.slice(0, -1) : list;
    return h_flex().id("editor-hints").relative().h(HINTS).flex_none().px(10).gap(14).items_center().overflow_hidden()
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
      .children(rest.map(([k, what], i) => hint(t, `editor-hint-${i}`, k, what)))
      .when(Boolean(help), (el) => el.child(div().flex_1()).child(keysHint(t, "editor-hint-keys", Boolean(this.keysShown), () => this.toggleKeys(!this.keysShown), help[0])));
  }

  /** Opens or closes the keys overview; it holds the keyboard while open, the file gets it back after. */
  toggleKeys(on) {
    this.keysShown = on;
    if (on) this.keysHandle.focus();
    else if (this.view === "preview") this.previewHandle.focus();
    else this.editor.focus();
  }

  /** The keys entry (space ? / cmd-k ?): every key, in the file's place (keyhelp.js); ? esc q close it. */
  keysStrip(t) {
    return div().id("editor-keys-host").absolute().top(0).left(0).size_full().track_focus(this.keysHandle)
      .on_key_down((e, cx) => {
        const k = keysKey(e, true);
        if (k) this.toggleKeys(false);
        cx.stop_propagation();
        cx.notify();
      })
      .child(keysView(t, { id: "editor-keys", title: this.vimOn() ? "editor · vim" : "editor", list: editorKeys(this.vimOn()), close: () => this.toggleKeys(false) }));
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

  /** How far down the pane the text starts: the bar, and whatever lines sit
   *  between it and the text (a conflict, find / replace, vim's ex line). */
  textTop() {
    return BAR + (this.conflict ? FIND : 0) + (this.mode === "replace" ? 2 * FIND : this.mode ? FIND : 0) + (this.vim.ex != null ? FIND : 0);
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
    if (!c.keyboard && !c.problems.length && !c.parts.length) return null;
    const anchor = this.cardAnchor(c);
    if (!anchor) return null;
    if (c.keyboard && !c.drawn) { c.drawn = true; this.mark(`card drawn ${Date.now() - c.opened}ms after it was asked${c.pending ? `, waiting: ${this.waitWords()}` : ""}`); }
    const footH = 24;
    const natural = c.contentH != null ? c.contentH + footH + 2 : null;
    // The pane's size comes in window pixels (zoomed); the card is placed in layout units.
    const z = zoom();
    const place = cardPlace(anchor, { width: this.size.width / z, height: this.size.height / z }, { width: CARD_W, height: natural }, { top: BAR, bottom: HINTS });
    const sevColor = { error: t.ansi1, warning: t.ansi3, info: t.ansi4, hint: t.dim };
    const lang = this.lang === "tsx" ? "typescript" : this.lang;
    const parts = c.parts.map((p, i) => p.code != null
      ? this.codeBlock(t, p, p.lang ? (languageOf(p.lang) ?? lang) : lang, code)
      : div().id(`card-text-${i}`).px(12).py(8).text_color(t.muted).child(TextView.markdown(`card-md-${i}`, p.md ??= cardMarkdown(p.text))));
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
      .children(parts);
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
        .when(overflow, (el) => el.child(key("ctrl-d ctrl-u", "scroll")))
        .child(div().flex_1())
        .child(key("esc", "close")));
    return place.above ? box.bottom(place.bottom) : box.top(place.top);
  }
}
