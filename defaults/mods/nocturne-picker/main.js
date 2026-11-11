// Nocturne picker: find a file, or a line, in the space's folder, and open it
// in the editor. Nocturne's palette, given two modes: files (cmd-p,
// nocturne.picker) matches paths fuzzily and typo-tolerantly; grep
// (cmd-shift-f, nocturne.grep) searches the text as you type, its lines
// grouped by file. Both are fff's (the engine behind fff.nvim): git-ignored
// files stay out, and the folder's index is kept warm while it's used. In a
// wide window a preview shows the picked file around the line.
// Props: { mode: "files" | "grep", folder, on, overlay }.
//
// Keys: up / down (ctrl-p / ctrl-n) pick, enter opens (grep: at the line),
// tab switches mode keeping the query, ctrl-r regex (grep), ctrl-t fuzzy
// lines (grep), esc closes.

import { div } from "gpui-kit";
import { View } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { props, theme, settings, closeOverlay, setShared, run, exec, findFiles, grep, readTextFile, highlight, languageOf, home, window as appWindow } from "herdr";
import { PathBuilder, Background } from "gpui-kit";
import { marks, split, nameRanges, dirRanges, grepRows, move, first, around, syntaxColors, colorRuns } from "./logic.js";

const ROW = 28, LINE = 24, HEAD = 26;
const FILES_LIMIT = 80, GREP_LIMIT = 400;
const PREVIEW_MIN = 860; // the overlay's width from which the preview shows
const GIT = { M: "ansi3", A: "ansi2", U: "ansi5", D: "ansi1", R: "ansi4", "!": "ansi9" };

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
const zoom = () => Number(settings()?.zoom) || 1;
function dither(color, cell = 1) {
  const dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}
const tilde = (p) => { const h = home(); return h && p.startsWith(h + "/") ? "~" + p.slice(h.length) : p; };

export default class Picker extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    this.mode = pr.mode === "grep" ? "grep" : "files";
    this.on = pr.on ?? null;
    this.root = pr.folder ?? null;
    this.regex = false;
    this.fuzzy = false;
    this.rows = [];
    this.at = -1;
    this.note = null; // a line under the input: scanning, an error
    this.total = null;
    this.ms = null;
    this.seq = 0;
    this.preview = null; // { path, from, lines, line }
    this.size = { width: 760, height: 520 };
    this.colors = syntaxColors(theme());
    this.scroll = ScrollHandle.new();
    this.input = InputState.new({ placeholder: this.placeholder() });
    this.input.on("change", (_e, cx) => this.query(cx));
    this.input.on("submit", (e, cx) => this.open(e?.secondary));
    this.input.focus();
    cx.timer.after(200, () => this.input.focus());
    cx.spawn(async (cx) => {
      // The repository's top, so the whole project is searched.
      if (this.root && !this.on) {
        const r = await exec("git", ["-C", this.root, "rev-parse", "--show-toplevel"]).catch(() => null);
        if (r?.code === 0 && r.stdout.trim()) this.root = r.stdout.trim();
      }
      this.query(cx);
    });
  }

  placeholder() {
    return this.mode === "files" ? "find a file" : this.regex ? "grep (regex)" : this.fuzzy ? "grep (fuzzy lines)" : "grep";
  }

  dismiss() {
    closeOverlay(props()?.overlay);
  }

  /** Herdr's last call: nocturne's cmd-p noted the open picker
   *  (nocturne/picker.js); it's gone now. */
  async close() { setShared("nocturne.picker-open", null); }

  /** Asks fff for the query; answers to older queries are dropped. */
  query(cx) {
    const q = this.input.value();
    const seq = ++this.seq;
    if (this.on) { this.note = "Files on another machine can't be searched here yet."; this.rows = []; cx.notify(); return; }
    if (!this.root) { this.note = "No folder: open a terminal in the project first."; cx.notify(); return; }
    const started = Date.now();
    cx.spawn(async (cx) => {
      try {
        if (this.mode === "files") {
          const r = await findFiles(this.root, q, { limit: FILES_LIMIT });
          if (seq !== this.seq) return;
          this.rows = r.files.map((f) => ({ head: false, path: f.path, file: f }));
          this.total = r.total;
          this.note = r.scanning ? "indexing the folder… (results grow)" : null;
          if (r.scanning) cx.timer.after(800, (cx) => { if (seq === this.seq) this.query(cx); });
        } else {
          const r = q.trim() ? await grep(this.root, q, { limit: GREP_LIMIT, mode: this.regex ? "regex" : this.fuzzy ? "fuzzy" : "plain" }) : { matches: [], files: 0 };
          if (seq !== this.seq) return;
          this.rows = grepRows(r.matches);
          this.total = r.matches.length;
          this.files = r.files;
          this.note = r.error ? `regex: ${r.error} (searched as text)` : r.truncated ? "more matches: type more to narrow" : r.scanning ? "indexing the folder…" : null;
        }
        this.ms = Date.now() - started;
        this.at = first(this.rows);
        this.loadPreview(cx);
      } catch (e) {
        if (seq !== this.seq) return;
        this.rows = []; this.note = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  switchMode(cx) {
    this.mode = this.mode === "files" ? "grep" : "files";
    this.rows = []; this.at = -1; this.preview = null;
    this.query(cx);
  }

  pick(d, cx) {
    if (!this.rows.length) return;
    this.at = move(this.rows, this.at, d);
    this.scroll.scroll_to_item(Math.max(0, this.at));
    this.loadPreview(cx);
    cx.notify();
  }

  /** The picked file around its line, when the preview shows. */
  loadPreview(cx) {
    const r = this.rows[this.at];
    if (!r || this.size.width < PREVIEW_MIN) { this.preview = null; return; }
    const path = `${this.root}/${r.path}`, line = r.match?.line ?? 1;
    if (this.preview?.path === path && this.preview.line === line) return;
    const want = { path, line };
    this.want = want;
    cx.spawn(async (cx) => {
      let text = null;
      try { text = await readTextFile(path); } catch { /* too big or unreadable */ }
      if (this.want !== want) return;
      if (text == null || text.includes("\0")) { this.preview = { path, line, from: 1, lines: [], note: text == null ? "can't show this file" : "binary file" }; cx.notify(); return; }
      const { from, lines } = around(text, line, 40);
      this.preview = { path, line, from, lines, lang: languageOf(path) };
      cx.notify();
    });
  }

  open(split) {
    const r = this.rows[this.at];
    if (!r || r.head) return;
    const path = `${this.root}/${r.path}`;
    this.dismiss();
    if (r.match) run("editor.open", { path, line: r.match.line, col: r.match.col + 1 });
    else run("editor.open", { path });
  }

  // ---- drawing

  render(cx) {
    const t = theme();
    const wide = this.size.width >= PREVIEW_MIN;
    const code = settings()?.font_family || "JetBrains Mono";
    const count = this.mode === "files"
      ? (this.total != null ? `${this.rows.length} of ${this.total}` : "")
      : this.input.value().trim() ? `${this.total ?? 0} lines${this.files != null ? ` in ${this.files} files` : ""}` : "";
    const modeChip = (m) => div().id(`mode-${m}`).px(9).py(3).text_color(this.mode === m ? t.background : t.dim)
      .when(this.mode === m, (el) => el.bg(t.accent))
      .when(this.mode !== m, (el) => el.hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { this.switchMode(cx); }))
      .child(m);
    const hint = (k, what) => h_flex().flex_none().gap(4).child(div().text_color(t.accent).child(k)).child(div().text_color(t.dim).child(what));
    return v_flex().id("nocturne-picker").size_full().bg(t.background).border(1).border_color(t.ansi0).text_size(11)
      .on_size_change((size, cx) => { this.size = size; this.loadPreview(cx); cx.notify(); })
      .on_key_down((e, cx) => {
        const k = e.keystroke;
        if (k === "escape") return this.dismiss();
        if (k === "down" || k === "ctrl-n") this.pick(1, cx);
        else if (k === "up" || k === "ctrl-p") this.pick(-1, cx);
        else if (k === "pagedown") { for (let i = 0; i < 10; i++) this.pick(1, cx); }
        else if (k === "pageup") { for (let i = 0; i < 10; i++) this.pick(-1, cx); }
        else if (k === "tab" || k === "shift-tab") this.switchMode(cx);
        else if (k === "ctrl-r" && this.mode === "grep") { this.regex = !this.regex; this.fuzzy = false; this.query(cx); }
        else if (k === "ctrl-t" && this.mode === "grep") { this.fuzzy = !this.fuzzy; this.regex = false; this.query(cx); }
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().relative().h(48).flex_none().px(16).gap(12).items_center()
        .child(div().relative().size(22).flex_none().flex().items_center().justify_center()
          .child(div().absolute().inset_0().opacity(0.35).child(dither(t.accent, 1)))
          .child(div().relative().text_size(13).text_color(t.foreground).child(this.mode === "files" ? "›" : "/")))
        .child(Input.new(this.input).flex_1().h_full().text_size(13).text_color(t.foreground).when(this.mode === "grep", (el) => el.font_family(code)))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(count))
        .when(this.mode === "grep", (el) => el
          .child(div().id("grep-regex").flex_none().px(5).border(1).border_color(this.regex ? t.accent : t.ansi0).text_color(this.regex ? t.accent : t.dim)
            .on_click((_e, cx) => { this.regex = !this.regex; this.fuzzy = false; this.query(cx); }).child(".*")))
        .child(h_flex().flex_none().border(1).border_color(t.ansi0).child(modeChip("files")).child(modeChip("grep")))
        .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1))))
      .when(!!this.note, (el) => el.child(div().px(16).py(4).text_color(t.ansi3).child(this.note)))
      .child(h_flex().flex_1().min_h(0)
        .child(div().id("picker-list").relative().flex_1().min_w(0).h_full().py(4).overflow_y_scrollbar().track_scroll(this.scroll)
          .children(this.rows.map((r, i) => this.mode === "files" ? this.fileRow(t, r, i) : r.head ? this.headRow(t, r, i) : this.lineRow(t, r, i, code)))
          .when(!this.rows.length && !this.note, (el) => el.child(div().px(16).py(10).text_color(t.dim)
            .child(this.mode === "files" ? (this.input.value() ? "No file matches." : "") : this.input.value().trim() ? "No line matches." : "Type to search the text of every file."))))
        .when(wide && !!this.preview, (el) => el.child(this.previewView(t, code))))
      .child(h_flex().relative().h(26).flex_none().px(16).gap(14).items_center().text_size(10)
        .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
        .child(hint("↑↓", "pick")).child(hint("enter", this.mode === "files" ? "edit" : "edit at line"))
        .child(hint("tab", this.mode === "files" ? "grep" : "files"))
        .when(this.mode === "grep", (el) => el.child(hint("ctrl-r", "regex")).child(hint("ctrl-t", "fuzzy")))
        .child(hint("esc", "close"))
        .child(div().flex_1())
        .child(div().text_color(t.dim).truncate().child(this.root ? `${tilde(this.root)} · .gitignore respected${this.ms != null ? ` · ${this.ms} ms` : ""}` : "")));
  }

  selected(t, el, sel) {
    return el.when(sel, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)));
  }

  pieces(t, parts, base) {
    return parts.map(([piece, on], j) => div().text_color(on ? t.accent : base).child(piece));
  }

  fileRow(t, r, i) {
    const { name, dir } = split(r.path);
    const g = r.file.git;
    const sel = i === this.at;
    return this.selected(t, h_flex().id(`file-${i}`).relative().h(ROW).flex_none().px(16).gap(10).items_center().text_size(12)
      .hover((s) => s.bg(t.ansi0 + "55"))
      .on_click((_e, cx) => { this.at = i; this.open(); }), sel)
      .child(div().relative().w(10).flex_none().text_size(11).text_color(g ? t[GIT[g]] ?? t.dim : t.dim).child(g ?? ""))
      .child(h_flex().relative().flex_none().children(this.pieces(t, marks(name, nameRanges(r.path, r.file.ranges)), t.foreground)))
      .child(h_flex().relative().flex_1().min_w(0).overflow_hidden().children(this.pieces(t, marks(dir, dirRanges(r.path, r.file.ranges)), t.dim)));
  }

  headRow(t, r, i) {
    const { name, dir } = split(r.path);
    return h_flex().id(`head-${i}`).h(HEAD).flex_none().px(16).pb(4).gap(10).items_end().text_size(10).text_color(t.muted)
      .child(div().flex_none().text_size(11).text_color(t.foreground).child(name))
      .child(div().flex_none().max_w(320).truncate().child(dir))
      .child(div().relative().flex_1().h(1).mb(5).opacity(0.6).child(dither(t.ansi8, 1)))
      .child(div().flex_none().child(String(r.count)));
  }

  lineRow(t, r, i, code) {
    const m = r.match;
    const sel = i === this.at;
    // The line, colored by its language, the matches over it.
    const text = m.text.replace(/\t/g, "  ").slice(0, 300);
    const spans = highlight(text, r.path);
    const runs = colorRuns(text, spans, this.colors);
    const hits = new Set();
    for (const [s, e] of m.ranges) for (let k = s; k < e; k++) hits.add(k);
    const out = [];
    let at = 0;
    for (const [piece, color] of runs) {
      // Split each colored run where a match starts or ends.
      let start = 0;
      for (let k = 1; k <= piece.length; k++) {
        if (k === piece.length || hits.has(at + k) !== hits.has(at + start)) {
          out.push([piece.slice(start, k), color, hits.has(at + start)]);
          start = k;
        }
      }
      at += piece.length;
    }
    return this.selected(t, h_flex().id(`line-${i}`).relative().h(LINE).flex_none().pl(26).pr(16).gap(10).items_center()
      .hover((s) => s.bg(t.ansi0 + "55"))
      .on_click((_e, cx) => { this.at = i; this.open(); }), sel)
      .child(div().relative().w(40).flex_none().text_right().font_family(code).text_size(11.5).text_color(t.dim).child(String(m.line)))
      .child(h_flex().relative().flex_1().min_w(0).overflow_hidden().font_family(code).text_size(12)
        .children(out.map(([piece, color, hit], j) => div().id(`l-${i}-${j}`).flex_none()
          .text_color(hit ? t.background : color ?? t.foreground).when(hit, (el) => el.bg(t.accent)).child(piece))));
  }

  previewView(t, code) {
    const p = this.preview;
    const rel = p.path.startsWith(this.root + "/") ? p.path.slice(this.root.length + 1) : p.path;
    let lines = [];
    if (p.lines.length) {
      const text = p.lines.join("\n");
      const spans = highlight(text, p.path);
      let at = 0;
      lines = p.lines.map((line) => {
        const end = at + line.length;
        const mine = spans.filter(([s, e]) => e > at && s < end).map(([s, e, n]) => [Math.max(s, at) - at, Math.min(e, end) - at, n]);
        at = end + 1;
        return colorRuns(line.replace(/\t/g, "  "), mine, this.colors);
      });
    }
    return v_flex().id("picker-preview").w(Math.round(this.size.width * 0.5)).flex_none().h_full().border_l(1).border_color(t.ansi0)
      .child(h_flex().h(26).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.ansi0).text_color(t.dim)
        .child(div().text_color(t.foreground).truncate().child(rel))
        .child(div().child(`${p.line}`))
        .child(div().flex_1())
        .child(div().child(p.lang ?? "")))
      .when(!!p.note, (el) => el.child(div().px(14).py(10).text_color(t.dim).child(p.note)))
      .child(v_flex().flex_1().min_h(0).pt(6).overflow_hidden().font_family(code).text_size(12)
        .children(lines.map((runs, k) => {
          const n = p.from + k;
          const hit = n === p.line;
          return h_flex().id(`pv-${k}`).relative().h(20).flex_none().items_center()
            .when(hit, (el) => el.bg(t.accent + "14").child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
            .child(div().w(48).flex_none().text_right().pr(12).text_color(hit ? t.foreground : t.dim).child(String(n)))
            .child(h_flex().flex_1().min_w(0).overflow_hidden().children(runs.map(([piece, color], j) => div().id(`pv-${k}-${j}`).flex_none().text_color(color ?? t.foreground).child(piece))));
        })));
  }
}
