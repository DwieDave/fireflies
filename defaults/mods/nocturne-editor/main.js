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
// one found on PATH, or settings.json's `editor.languages.<id>.server`), is
// shared by every editor of that workspace, and stops a while after the last
// closes. Saving writes only if the file is still what was read (otherwise
// it says so); a change on disk reloads a clean file and offers a choice to
// an edited one. Closing an edited editor asks first.
//
// Keys while it has focus (keys.json `mod:nocturne-editor`): cmd-s save,
// cmd-f find (enter / shift-enter next / previous, esc closes), cmd-alt-f
// replace, ctrl-g / cmd-l go to line, f8 / shift-f8 next / previous problem,
// cmd-shift-m problems, f12 definition, cmd-i hover, ctrl-= / ctrl--
// hover type more / less, cmd-r reload. cmd-z / cmd-shift-z undo / redo.

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex, EditorState, Editor, InputState, Input, TextView } from "gpui-base";
import {
  props, theme, settings, run, shared, setShared, readTextFile, writeTextFile, watchFolder, nextCommand, exec,
  home, appHome, languageOf, highlight, lspStart, lspRequest, lspNotify, lspNextMessage, lspRelease, setUnsaved, notify,
  window as appWindow,
} from "herdr";
import {
  languageSettings, serverCandidates, ROOTS, rootScript, pickRoot, languageId, uri, diagnostics, lineNotes, counts,
  diagnosticsAt, nextProblem, hoverParts, parseGoto, firstLocation, tilde, dirname, basename, syntaxColors, colorRuns,
} from "./logic.js";

const MOD = "nocturne-editor";
// Each editor's file name by slot, for its pane header (nocturne/header.js).
const TITLES = "nocturne-editor.titles";
// The app asks an editor already on a file to go somewhere (`editor.open` with a line).
const GOTO = "nocturne-editor.goto";
const POLL = 4000; // a file on another machine can't be watched
const CHANGE_DELAY = 200; // ms of quiet before the server hears about an edit
const BAR = 30, FIND = 28, HINTS = 22, DRAWER = 132, ROW = 24;
const CARD_W = 520;

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
const zoom = () => Number(settings()?.zoom) || 1;
/** A 50% checker dither filling the parent (as nocturne/kit.js). */
function dither(color, cell = 1) {
  const dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}
const stop = (_e, cx) => cx.stop_propagation();

/** Which servers are on PATH, asked once per program. */
const found = new Map();
async function onPath(program) {
  if (!found.has(program)) found.set(program, exec("sh", ["-c", 'command -v "$1" >/dev/null 2>&1', "which", program]).then((r) => r.code === 0, () => false));
  return found.get(program);
}

export default class EditorPane extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    this.path = pr.path ?? "";
    this.on = pr.on ?? null;
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
    this.card = null; // the hover card: { line, col, x, y, parts, problems, level, more, keyboard }
    this.overCard = false;
    this.origin = { x: 0, y: 0 };
    this.size = { width: 800, height: 600 };
    this.message = null; // a short note in the bar (saved, reloaded, an error)
    this.handle = cx.focus_handle();

    const t = theme();
    this.colors = syntaxColors(t);
    this.editor = EditorState.new({
      language: this.lang, value: "", font_family: settings()?.font_family || "JetBrains Mono", font_size: 13,
      line_numbers: true, folding: true, soft_wrap: !!this.opts.soft_wrap, syntax: this.colors,
    });
    this.editor.set_tab_size(this.opts.tab_size, this.opts.insert_spaces === false);
    this.editor.on("change", (_e, cx) => this.changed(cx));
    this.editor.on("hover", (e, cx) => this.hovered(e, cx));
    this.findInput = InputState.new({ placeholder: "find" });
    this.findInput.on("change", (_e, cx) => this.search(cx));
    this.findInput.on("submit", (e, cx) => this.step(e?.shift ? -1 : 1, cx));
    this.replaceInput = InputState.new({ placeholder: "replace with" });
    this.replaceInput.on("submit", (e, cx) => this.replace(!!e?.secondary, cx));
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
        this.editor.set_cursor(at.line, at.col);
        this.say("reloaded: it changed on disk");
        this.didChange(cx, true);
        cx.notify();
        return;
      }
      if (error) { this.state = "error"; this.error = error; cx.notify(); return; }
      if (text == null) { this.state = "missing"; this.saved = null; this.editor.set_value(""); }
      else { this.state = "ready"; this.saved = text; this.editor.set_value(text); }
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
    cx.spawn(async (cx) => {
      for (;;) {
        let changed;
        try { changed = await watchFolder(dir); } catch { return; }
        if (!changed.some((p) => basename(p) === basename(this.path) || p === dir)) continue;
        this.load(cx, null, true);
      }
    });
  }

  changed(cx) {
    const dirty = this.editor.value() !== (this.saved ?? "");
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

  async startServer(cx) {
    if (this.on) { this.server = { status: "none", note: "no language server for another machine's files" }; return; }
    const candidates = serverCandidates(this.lang, this.opts);
    if (!candidates.length) { this.server = { status: "none", note: this.opts.server === false ? "language server off (settings.json)" : null }; cx.notify(); return; }
    let pick = null;
    for (const c of candidates) if (await onPath(c.argv[0])) { pick = c; break; }
    if (!pick) { this.server = { status: "none", note: `no language server on PATH (${candidates.map((c) => c.argv[0]).join(", ")})` }; cx.notify(); return; }
    const dir = dirname(this.path);
    const markers = ROOTS[this.lang]?.markers ?? [];
    const r = await exec("sh", ["-c", rootScript(markers), "root", dir]).catch(() => null);
    const root = pickRoot(this.lang, r?.stdout, dir);
    this.server = { status: "starting", argv: pick.argv, root, name: basename(pick.argv[0]) };
    cx.notify();
    let started;
    try { started = await lspStart({ argv: pick.argv, root, settings: pick.settings }); }
    catch (e) { this.server = { ...this.server, status: "exited", note: String(e?.message ?? e) }; cx.notify(); return; }
    this.server = { ...this.server, id: started.id, caps: started.capabilities ?? {}, status: "ready" };
    this.version = 1;
    lspNotify(started.id, "textDocument/didOpen", { textDocument: { uri: uri(this.path), languageId: languageId(this.lang, this.path), version: this.version, text: this.editor.value() } });
    this.listen(started.id, cx);
    cx.notify();
  }

  listen(id, cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        let m;
        try { m = await lspNextMessage(id); } catch { return; }
        if (m.method === "textDocument/publishDiagnostics" && m.params?.uri === uri(this.path)) {
          this.setProblems(diagnostics(m.params.diagnostics));
          cx.notify();
        } else if (m.method === "$/exit") {
          this.server = { ...this.server, status: "exited", id: null, note: (m.params?.stderr ?? []).slice(-1)[0] ?? "it stopped" };
          cx.notify();
          return;
        }
      }
    });
  }

  setProblems(list) {
    this.problems = list;
    const t = theme();
    const colors = { error: t.ansi1, warning: t.ansi3, info: t.ansi4, hint: t.dim };
    this.editor.set_diagnostics(list);
    this.editor.set_line_notes(lineNotes(list, colors).map((n) => ({ ...n, color: n.color + "bb" })));
  }

  /** Tells the server about an edit, after a moment of quiet. */
  didChange(cx, now) {
    if (this.server?.id == null) return;
    const v = ++this.version;
    const send = () => {
      if (v !== this.version || this.server?.id == null) return;
      lspNotify(this.server.id, "textDocument/didChange", { textDocument: { uri: uri(this.path), version: v }, contentChanges: [{ text: this.editor.value() }] });
    };
    if (now) send();
    else cx.timer.after(CHANGE_DELAY, send);
  }

  async request(method, extra = {}, line, col) {
    if (this.server?.id == null) return null;
    const at = line == null ? this.editor.cursor() : { line, col };
    return lspRequest(this.server.id, method, { textDocument: { uri: uri(this.path) }, position: { line: at.line, character: at.col }, ...extra });
  }

  async definition(cx) {
    let loc = null;
    try { loc = firstLocation(await this.request("textDocument/definition")); } catch (e) { this.say(String(e?.message ?? e), true); }
    if (!loc) { if (this.server?.id != null) this.say("no definition found"); cx.notify(); return; }
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
    this.showCard(e.line, e.col, { x: e.x, y: e.y, h: e.height }, cx);
  }

  /** The card for a place: its problems now, the server's hover when it answers. */
  showCard(line, col, at, cx, level = 0) {
    const here = diagnosticsAt(this.problems, line, col);
    const card = { line, col, at, problems: here, parts: [], level, more: false, keyboard: !at, waiting: this.server?.id != null };
    this.card = here.length || card.waiting ? card : null;
    cx.notify();
    if (!card.waiting) return;
    const verbosity = this.lang === "typescript" || this.lang === "tsx" || this.lang === "javascript" ? { verbosityLevel: level } : {};
    this.request("textDocument/hover", verbosity, line, col).then((h) => {
      if (this.card !== card) return;
      card.waiting = false;
      card.parts = hoverParts(h?.contents);
      card.more = !!h?.canIncreaseVerbosityLevel;
      if (!card.parts.length && !card.problems.length) this.card = null;
      cx.notify();
    }, () => { if (this.card === card) { card.waiting = false; if (!card.problems.length) this.card = null; cx.notify(); } });
  }

  /** TypeScript's expandable hover: one level more (1) or less (-1). */
  hoverLevel(d, cx) {
    const c = this.card;
    if (!c) return;
    const level = Math.max(0, c.level + d);
    if (level === c.level || (d > 0 && !c.more)) return;
    this.showCard(c.line, c.col, c.at, cx, level);
  }

  // ---- moving around

  goto(line, col, cx) {
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
    this.showCard(d.line, d.col, null, cx);
  }

  // ---- find

  openFind(replace) {
    this.mode = replace ? "replace" : "find";
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

  closeFind(cx) {
    if (this.mode === "find" || this.mode === "replace") this.editor.find_close();
    this.mode = null;
    this.editor.focus();
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
    if (c === "hover") { const at = this.editor.cursor(); return this.showCard(at.line, at.col, null, cx); }
    if (c === "hover-more") return this.hoverLevel(1, cx);
    if (c === "hover-less") return this.hoverLevel(-1, cx);
    if (c === "reload") { this.dirty = false; return this.load(cx, null, false); }
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
    const goto = shared(GOTO);
    if (goto && goto.path === this.path && goto.n !== this.seenGoto) {
      this.seenGoto = goto.n;
      if (this.state !== "loading") this.goto(goto.line - 1, (goto.col ?? 1) - 1, cx);
    }
    const code = settings()?.font_family || "JetBrains Mono";
    return v_flex().id("nocturne-editor").relative().size_full().bg(t.background).text_size(11)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_mouse_move((e) => { if (e.local_position) this.origin = { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y }; })
      .on_key_down((e, cx) => {
        if (e.keystroke === "escape") {
          if (this.mode) { this.closeFind(cx); cx.stop_propagation(); }
          else if (this.card) { this.card = null; cx.notify(); cx.stop_propagation(); }
        }
      })
      .child(this.bar(t))
      .when(this.conflict, (el) => el.child(this.conflictLine(t)))
      .when(this.mode != null, (el) => el.child(this.findLine(t)))
      .child(this.body(t, code))
      .when(this.drawer, (el) => el.child(this.drawerView(t)))
      .child(this.hints(t))
      .when(!!this.card, (el) => el.child(this.cardView(t, code)));
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
    const server = s?.status === "ready" ? [t.ansi2, s.name] : s?.status === "starting" ? [t.ansi3, `${s.name}…`] : s?.status === "exited" ? [t.ansi1, `${s.name ?? "server"} stopped`] : null;
    const msg = this.message && Date.now() - this.message.at < 4000 ? this.message : null;
    return h_flex().id("editor-bar").h(BAR).flex_none().px(12).gap(10).items_center().border_b(1).border_color(t.ansi0)
      .child(div().relative().size(8).flex_none().border(1).border_color(this.dirty ? t.ansi3 : t.ansi0)
        .when(this.dirty, (el) => el.child(dither(t.ansi3, 1))))
      .child(div().flex_none().text_color(t.foreground).child(basename(this.path) || "untitled"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(narrow ? "" : dir))
      .when(!!msg, (el) => el.child(div().flex_none().text_color(msg.bad ? t.ansi1 : t.ansi2).truncate().max_w(260).child(msg.text)))
      .when(c.error > 0, (el) => el.child(sev(c.error, t.ansi1, "bar-errors")))
      .when(c.warning > 0, (el) => el.child(sev(c.warning, t.ansi3, "bar-warnings")))
      .when(!!server && !narrow, (el) => el.child(h_flex().id("bar-server").flex_none().gap(6).items_center().text_color(t.muted)
        .child(div().size(6).bg(server[0])).child(server[1])))
      .when(!narrow, (el) => el.child(h_flex().flex_none().h(18).px(6).items_center().border(1).border_color(t.ansi0).text_color(t.muted)
        .child(`${this.lang} · ${this.opts.insert_spaces === false ? "tab" : `${this.opts.tab_size} sp`}`)))
      .when(!!at, (el) => el.child(div().flex_none().text_color(t.dim).child(`${at.line + 1}:${at.col + 1}`)));
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
    const chip = (id, label, on, go) => div().id(id).flex_none().h(18).px(6).flex().items_center().border(1)
      .border_color(on ? t.accent : t.ansi0).text_color(on ? t.accent : t.muted)
      .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { go(cx); cx.notify(); }).child(label);
    const hint = (k, what) => h_flex().flex_none().gap(4).child(div().text_color(t.accent).child(k)).child(div().text_color(t.dim).child(what));
    const line = this.mode === "line";
    const count = this.find.count ? `${(this.find.current ?? 0) + 1} / ${this.find.count}` : this.findInput.value() ? "none" : "";
    return v_flex().id("editor-find").relative().flex_none()
      .child(h_flex().h(FIND).px(12).gap(10).items_center()
        .child(div().flex_none().text_color(t.accent).child(line ? "line" : "find"))
        .child(div().w(line ? 160 : 240).flex_none().h(20).border_b(1).border_color(t.accent)
          .child(Input.new(line ? this.lineInput : this.findInput).size_full().text_size(12).font_family(settings()?.font_family || "JetBrains Mono")))
        .when(!line, (el) => el
          .child(div().flex_none().text_color(this.find.count ? t.foreground : t.dim).child(count))
          .child(chip("find-case", "Aa", this.caseSensitive, (cx) => { this.caseSensitive = !this.caseSensitive; this.search(cx); }))
          .child(chip("find-prev", "‹", false, (cx) => this.step(-1, cx)))
          .child(chip("find-next", "›", false, (cx) => this.step(1, cx))))
        .child(div().flex_1())
        .when(this.size.width > 560, (el) => el.child(line ? hint("enter", "go") : hint("enter", "next")).child(line ? div() : hint("shift-enter", "prev")).child(hint("esc", "close"))))
      .when(this.mode === "replace", (el) => el.child(h_flex().h(FIND).px(12).gap(10).items_center()
        .child(div().flex_none().text_color(t.accent).child("with"))
        .child(div().w(240).flex_none().h(20).border_b(1).border_color(t.ansi0)
          .child(Input.new(this.replaceInput).size_full().text_size(12).font_family(settings()?.font_family || "JetBrains Mono")))
        .child(chip("replace-one", "replace", false, (cx) => this.replace(false, cx)))
        .child(chip("replace-all", "all", false, (cx) => this.replace(true, cx)))))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }

  body(t, code) {
    if (this.state === "error") return this.note(t, "Can't edit this file", this.error);
    if (this.state === "loading") return this.note(t, "Reading…", null);
    return div().id("editor-body").relative().flex_1().min_h(0)
      .when(this.state === "missing", (el) => el.child(div().absolute().top(6).right(14).text_color(t.dim).child("new file: cmd-s creates it")))
      .child(Editor.new(this.editor).size_full().font_family(code));
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
        .child(h_flex().gap(4).child(div().text_color(t.accent).child("f8")).child(div().text_color(t.dim).child("next"))))
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
    const list = this.mode === "line" ? [["enter", "go"], ["esc", "close"]]
      : this.mode ? [["enter", "next"], ["shift-enter", "prev"], ...(this.mode === "replace" ? [["cmd-enter", "replace all"]] : []), ["esc", "close"]]
      : [["cmd-s", "save"], ["cmd-f", "find"], ["ctrl-g", "line"], ["f8", "problem"], ...(this.server?.id != null ? [["f12", "definition"], ["cmd-i", "hover"]] : []), ["cmd-p", "files"], ["cmd-shift-f", "grep"]];
    return h_flex().id("editor-hints").relative().h(HINTS).flex_none().px(10).gap(14).items_center().overflow_hidden()
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
      .children(list.map(([k, what], i) => h_flex().id(`editor-hint-${i}`).flex_none().gap(4)
        .child(div().text_color(t.accent).child(k)).child(div().text_color(t.dim).child(what))));
  }

  /** Highlighted code, line by line, in the card. */
  codeBlock(t, text, lang, code) {
    const spans = lang ? highlight(text, lang) : [];
    const lines = [];
    let at = 0;
    for (const line of text.split("\n")) {
      const end = at + line.length;
      const mine = spans.filter(([s, e]) => e > at && s < end).map(([s, e, n]) => [Math.max(s, at) - at, Math.min(e, end) - at, n]);
      lines.push(colorRuns(line, mine, this.colors));
      at = end + 1;
    }
    return v_flex().px(12).py(8).font_family(code).text_size(12).children(lines.slice(0, 40).map((runs, i) =>
      h_flex().id(`card-code-${i}`).flex_wrap().children(runs.map(([piece, color], j) =>
        div().id(`card-run-${i}-${j}`).text_color(color ?? t.foreground).child(piece)))));
  }

  cardView(t, code) {
    const c = this.card;
    const sevColor = { error: t.ansi1, warning: t.ansi3, info: t.ansi4, hint: t.dim };
    const z = zoom();
    const w = Math.min(CARD_W, this.size.width - 24);
    // Under the word, else above it; the keyboard's card sits at the top.
    let left = 12, top = BAR + 8;
    if (c.at) {
      left = Math.max(8, Math.min((c.at.x - this.origin.x) / z, this.size.width - w - 8));
      const below = (c.at.y - this.origin.y + (c.at.h ?? 18)) / z + 4;
      top = below + 220 > this.size.height ? Math.max(8, (c.at.y - this.origin.y) / z - 224) : below;
    }
    const lang = this.lang === "tsx" ? "typescript" : this.lang;
    const parts = c.parts.map((p, i) => p.code != null
      ? this.codeBlock(t, p.code, p.lang ? (languageOf(p.lang) ?? lang) : lang, code)
      : div().id(`card-text-${i}`).px(12).py(8).text_color(t.muted).child(TextView.markdown(`card-md-${i}`, p.text)));
    const expandable = lang === "typescript" || lang === "javascript";
    const ctrl = (id, label, on, go) => div().id(id).flex_none().w(18).h(18).flex().items_center().justify_center().border(1)
      .border_color(on ? t.ansi0 : t.background).text_color(on ? t.foreground : t.dim)
      .when(on, (el) => el.hover((s) => s.border_color(t.accent)).on_click((_e, cx) => { go(cx); cx.notify(); })).child(label);
    return v_flex().id("editor-card").absolute().left(left).top(top).w(w).max_h(Math.max(160, this.size.height - top - HINTS - 8))
      .bg(t.background).border(1).border_color(t.ansi0).shadow_lg().overflow_hidden()
      .on_hover((h, cx) => { this.overCard = h; if (!h && !c.keyboard) cx.timer.after(250, (cx) => { if (!this.overCard) { this.card = null; cx.notify(); } }); })
      .on_mouse_down("left", stop)
      .children(c.problems.map((d, i) => v_flex().id(`card-problem-${i}`).relative().border_b(1).border_color(t.ansi0)
        .child(div().absolute().left(0).right(0).top(0).h(3).child(dither(sevColor[d.severity], 1)))
        .child(div().px(12).pt(9).pb(4).text_size(11.5).text_color(t.foreground).font_family(code).child(d.message))
        .when(d.related.length > 0, (el) => el.children(d.related.slice(0, 4).map((r, j) => div().id(`card-rel-${i}-${j}`).px(12).text_color(t.dim)
          .child(`${r.path ? basename(r.path) : ""}:${r.line + 1}  ${r.message}`))))
        .child(h_flex().px(12).pb(8).gap(12).text_size(10).text_color(t.dim)
          .child(div().text_color(sevColor[d.severity]).child(d.severity))
          .child(div().child([d.code, d.source].filter(Boolean).join(" · "))))))
      .when(c.waiting, (el) => el.child(div().px(12).py(8).text_color(t.dim).child("asking the language server…")))
      .child(div().id("card-parts").max_h(Math.max(120, Math.min(360, this.size.height - top - HINTS - 120))).overflow_y_scrollbar().child(v_flex().children(parts)))
      .when(c.parts.length > 0, (el) => el.child(h_flex().h(24).flex_none().px(12).gap(12).items_center().border_t(1).border_color(t.ansi0).text_size(10).text_color(t.dim)
        .child(div().child(this.server?.name ?? ""))
        .when(expandable, (el) => el
          .child(ctrl("card-less", "−", c.level > 0, (cx) => this.hoverLevel(-1, cx)))
          .child(div().child(`type depth ${c.level}`))
          .child(ctrl("card-more", "+", c.more, (cx) => this.hoverLevel(1, cx))))
        .child(div().flex_1())
        .child(h_flex().gap(4).child(div().text_color(t.accent).child("f12")).child(div().child("definition")))));
  }
}
