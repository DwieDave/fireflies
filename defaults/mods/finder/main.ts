// Nocturne picker: find a file, or a line, in the space's folder, and open it
// in the editor. Nocturne's palette, given two modes: files (cmd-p,
// nocturne.picker) matches paths fuzzily and typo-tolerantly; grep
// (cmd-shift-f, nocturne.grep) searches the text as you type, its lines
// grouped by file. Both are fff's (the engine behind fff.nvim): git-ignored
// files stay out, and the folder's index is kept warm while it's used. In a
// wide window a preview shows the picked file around the line.
// Props: { mode: "files" | "grep", folder, folders? (to try, best first: the
// first that's there is searched), space? (the space's folder, named when none
// is there), on, query? (the box's first text), overlay }.
//
// Keys: up / down (ctrl-p / ctrl-n) pick, enter opens (grep: at the line),
// tab / shift-tab switch mode keeping the query, and so do the global keys
// inside it (cmd-shift-f to grep, cmd-p to files: nocturne/picker.ts sends
// "grep" / "files" to nextCommand()), ctrl-r regex (grep), ctrl-t fuzzy lines
// (grep), esc closes. The hint bar lists every one of them: the box takes
// typing, so there's no ? list here.
//
// Tab is the base's focus key (Root's Tab action, and the Input's indent)
// before any on_key_down hears it: bound to an action in the picker's own key
// context, it switches the mode instead.
//
// Rendering stays cheap at any repo size (a render has 50 ms): typing waits
// for a pause before it searches (fff runs off the window's thread), an
// answer to an older query is dropped, only the rows on screen are drawn (a
// virtual list), and each line is colored once, when it's first shown.

import { div, View, PathBuilder, Background } from "gpui-kit";
import type { AsyncContext, Color, Context, Element } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex, InputState, Input, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import * as herdr from "herdr";
import type { Theme } from "herdr";
import { props, theme, settings, closeOverlay, shared, setShared, exec, findFiles, grep, readTextFile, highlight, languageOf, home, keys, nextCommand, window as appWindow } from "herdr";
import { openInEditor } from "./editor-route.ts";
import type { Guarded } from "./guard.ts";
import { arrayOf, isString, literal, nullable, object, readShared, sharedKey, writeShared } from "./guard.ts";
import type { FoundFile, GrepRow, HeadRow, HitRun, LineRow, Mark, Mode, Run, Span } from "./logic.ts";
import { marks, split, nameRanges, dirRanges, grepRows, move, first, around, syntaxColors, colorRuns, lineRuns, PAUSE, previewWidth, previewLines, PREVIEW_LINE, otherMode, keyFor, firstFolder, goneNote } from "./logic.ts";

const ROW = 28;
const LINE = 24;
const HEAD = 26;
const FILES_LIMIT = 80;
const GREP_LIMIT = 400;
const CONTEXT = "NocturnePicker";
const SWITCH = "nocturne_picker::switch";

/** The command and its default key that open each mode (what its chip names). */
const GLOBAL = { files: ["nocturne.picker", "cmd-p"], grep: ["nocturne.grep", "cmd-shift-f"] } as const satisfies { readonly [M in Mode]: readonly [string, string] };

/** What the picker is opened with (nocturne/picker.ts, `openOverlay` adds `overlay`). */
const isPickerProps = object({}, {
  mode: isString,
  folder: nullable(isString),
  // To try, best first: the first that's there is searched.
  folders: arrayOf(isString),
  // The space's folder, named when none is there.
  space: nullable(isString),
  on: nullable(isString),
  // The box's first text.
  query: isString,
  overlay: isString,
});

type PickerProps = Guarded<typeof isPickerProps>;

const pickerProps = (p?: Props): PickerProps => {
  const own = props();

  if (isPickerProps(own)) return own;

  return isPickerProps(p) ? p : {};
};

// nocturne/picker.ts's note of the open picker: { id, mode }.
const OPEN = sharedKey("nocturne.picker-open", nullable(object({ id: isString, mode: literal("files", "grep") })));

/** fff's file row: its path in the root, and what fff says of it. */
interface FileRow {
  readonly head: false;
  readonly path: string;
  readonly file: FoundFile;
}

/** A row of the list: a file (files), or a file's head or one of its lines (grep). */
type Row = FileRow | GrepRow;

/** The picked file around its line; `note` when it can't be shown. */
interface Preview {
  readonly path: string;
  readonly line: number;
  readonly count: number;
  readonly from: number;
  readonly lines: readonly string[];
  readonly runs: readonly (readonly Run[])[];
  readonly lang: string | null;
  readonly note: string | null;
}

/** The file and line the preview loads (a newer one drops an older load). */
interface Wanted {
  readonly path: string;
  readonly line: number;
}

/** A file's git state, in its color. */
function gitColor(t: Theme, g: string): Color {
  switch (g) {
    case "M": return t.ansi3;
    case "A": return t.ansi2;
    case "U": return t.ansi5;
    case "D": return t.ansi1;
    case "R": return t.ansi4;
    case "!": return t.ansi9;
    default: return t.dim;
  }
}

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
const zoom = (): number => settings().zoom || 1;

function dither(color: Color, cell = 1): Element {
  const dpr = appWindow().platform === "macos" ? 2 : 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}

const tilde = (p: string): string => {
  const h = home();

  return h && p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p;
};

export default class Picker extends View {
  static bound = false;
  mode: Mode = "files";
  on: string | null = null;
  // The folders to try; the root is the first one that's there, once
  // that's known (init's first task), the repository's top when it's one.
  folders: readonly string[] = [];
  space: string | null = null;
  root: string | null = null;
  finding = false;
  // The note when none of them is there.
  gone: string | null = null;
  regex = false;
  fuzzy = false;
  rows: Row[] = [];
  at = -1;
  // A line under the input: scanning, an error.
  note: string | null = null;
  total: number | null = null;
  files: number | null = null;
  ms: number | null = null;
  seq = 0;
  preview: Preview | null = null;
  want: Wanted | null = null;
  size = { width: 760, height: 520 };
  colors: ReadonlyMap<string, Color> = new Map();
  scroll: VirtualListScrollHandle | null = null;
  input: InputState | null = null;
  // Which answer the rows are: a click on an older list's row is dropped.
  gen = 0;
  typed = 0;

  override init(p: Props | undefined, cx: AsyncContext): void {
    const pr = pickerProps(p);

    this.mode = pr.mode === "grep" ? "grep" : "files";
    this.on = pr.on ?? null;
    this.folders = pr.folders?.length ? pr.folders : pr.folder ? [pr.folder] : [];
    this.space = pr.space ?? null;
    this.finding = this.folders.length > 0;
    this.colors = syntaxColors(theme());
    this.scroll = VirtualListScrollHandle.new();
    this.makeInput(pr.query ?? "");

    // The opener's note names this picker (again, after a reload of the mod).
    if (pr.overlay) writeShared(setShared, OPEN, { id: pr.overlay, mode: this.mode });

    cx.timer.after(200, () => this.input?.focus());

    if (!Picker.bound) {
      try {
        cx.bind_keys([
          { keystroke: "tab", action: SWITCH, context: CONTEXT },
          { keystroke: "shift-tab", action: SWITCH, context: CONTEXT },
        ]);
        Picker.bound = true;
      } catch {
        // The key handler still tries.
      }
    }

    // cmd-shift-f / cmd-p while it's open (nocturne/picker.ts): that mode, here.
    cx.spawn(async (cx) => {
      for (;;) {
        let c: string;

        try {
          c = await nextCommand();
        } catch {
          return;
        }

        if (c === "files" || c === "grep") {
          this.setMode(c, cx);
          cx.notify();
        }
      }
    });

    cx.spawn(async (cx) => {
      // A folder that was moved or deleted (a space's, a finished shell's)
      // is passed over; another machine's are searched nowhere yet.
      if (this.on) this.root = this.folders[0] ?? null;
      else {
        this.root = await firstFolder(this.folders, async (f) => {
          try {
            return (await exec("test", ["-d", f])).code === 0;
          } catch {
            return null;
          }
        });

        if (!this.root && this.folders.length) this.gone = goneNote(this.folders, this.space, tilde);
      }

      this.finding = false;

      // The repository's top, so the whole project is searched.
      if (this.root && !this.on) {
        const r = await exec("git", ["-C", this.root, "rev-parse", "--show-toplevel"]).catch(() => null);

        if (r?.code === 0 && r.stdout.trim()) this.root = r.stdout.trim();
      }

      this.query(cx);
    });
  }

  /** The box's text. */
  value(): string {
    return this.input?.value() ?? "";
  }

  /** The text box, holding `value`; made again on a mode switch, as its
   *  placeholder names the mode. */
  makeInput(value: string): void {
    this.input?.release();

    const input = InputState.new({ placeholder: this.placeholder(), value });

    input.on("change", (_e, cx) => this.typing(cx));
    input.on("submit", () => this.open());
    input.focus();
    this.input = input;
  }

  placeholder(): string {
    return this.mode === "files" ? "find a file" : this.regex ? "grep (regex)" : this.fuzzy ? "grep (fuzzy lines)" : "grep";
  }

  dismiss(): void {
    const overlay = pickerProps().overlay;

    if (overlay !== undefined) closeOverlay(overlay);
  }

  /** Fireflies' last call: nocturne's cmd-p noted the open picker
   *  (nocturne/picker.ts); it's gone now, if the note is this one's. */
  override close(): void {
    const open = readShared(shared, OPEN, null);
    const me = pickerProps().overlay;

    if (!me || open?.id === me) writeShared(setShared, OPEN, null);
  }

  /** A key in the box: search once typing pauses (the newest text then). */
  typing(cx: Context): void {
    const n = ++this.typed;

    cx.timer.after(PAUSE[this.mode], (cx) => {
      if (n === this.typed) this.query(cx);
    });
  }

  /** Asks fff for the query; answers to older queries are dropped. */
  query(cx: Context): void {
    const q = this.value();
    const seq = ++this.seq;

    if (this.on) {
      this.note = "Files on another machine can't be searched here yet.";
      this.rows = [];
      cx.notify();

      return;
    }

    // The first search follows.
    if (this.finding) return;

    const root = this.root;

    if (!root) {
      this.note = this.gone ?? "No folder: open a terminal in the project first.";
      cx.notify();

      return;
    }

    const started = Date.now();

    cx.spawn(async (cx) => {
      try {
        if (this.mode === "files") {
          const r = await findFiles(root, q, { limit: FILES_LIMIT });

          if (seq !== this.seq) return;

          this.rows = r.files.map((f): FileRow => ({ head: false, path: f.path, file: f }));
          this.gen++;
          this.total = r.total;
          this.note = r.scanning ? "indexing the folder… (results grow)" : null;

          if (r.scanning) {
            cx.timer.after(800, (cx) => {
              if (seq === this.seq) this.query(cx);
            });
          }
        } else {
          const r = q.trim() ? await grep(root, q, { limit: GREP_LIMIT, mode: this.regex ? "regex" : this.fuzzy ? "fuzzy" : "plain" }) : { matches: [], files: 0, truncated: false, error: null, scanning: false };

          if (seq !== this.seq) return;

          this.rows = grepRows(r.matches);
          this.gen++;
          this.total = r.matches.length;
          this.files = r.files;
          this.note = r.error ? `regex: ${r.error} (searched as text)` : r.truncated ? "more matches: type more to narrow" : r.scanning ? "indexing the folder…" : null;
        }

        this.ms = Date.now() - started;
        this.at = first(this.rows);

        if (this.at >= 0) this.scroll?.scroll_to_item(this.at);

        this.loadPreview(cx);
      } catch (cause: unknown) {
        if (seq !== this.seq) return;

        this.rows = [];
        this.note = cause instanceof Error ? cause.message : String(cause);
      }

      cx.notify();
    });
  }

  /** Tab, a chip, or the other mode's global key: the other mode, the
   *  query kept. */
  switchMode(cx: Context): void {
    this.setMode(otherMode(this.mode), cx);
  }

  setMode(mode: Mode, cx: Context): void {
    if (mode === this.mode) return;

    this.mode = mode;
    this.rows = [];
    this.at = -1;
    this.preview = null;
    this.total = null;
    this.note = null;
    this.makeInput(this.value());

    // nocturne/picker.ts's note follows, so the same key again closes it.
    const open = readShared(shared, OPEN, null);

    if (open?.id) writeShared(setShared, OPEN, { ...open, mode });

    this.query(cx);
  }

  pick(d: number, cx: Context): void {
    if (!this.rows.length) return;

    this.at = move(this.rows, this.at, d);
    this.scroll?.scroll_to_item(Math.max(0, this.at));
    this.loadPreview(cx);
    cx.notify();
  }

  /** The picked file around its line, when the preview shows. */
  loadPreview(cx: Context): void {
    const r = this.rows[this.at];

    if (!r || !previewWidth(this.size.width)) {
      this.preview = null;

      return;
    }

    const path = `${this.root}/${r.path}`;
    const line = "match" in r ? r.match.line : 1;
    // As many lines as fill its height, the hit a third of the way down.
    const count = previewLines(this.size.height);

    if (this.preview?.path === path && this.preview.line === line && this.preview.count >= count) return;

    const want = { path, line };

    this.want = want;
    cx.spawn(async (cx) => {
      let text: string | null = null;

      try {
        text = await readTextFile(path);
      } catch {
        // Too big or unreadable.
      }

      if (this.want !== want) return;

      if (text === null || text.includes("\0")) {
        this.preview = { path, line, count: 0, from: 1, lines: [], runs: [], lang: null, note: text === null ? "can't show this file" : "binary file" };
        cx.notify();

        return;
      }

      const { from, lines } = around(text, line, count);

      this.preview = { path, line, count, from, lines, runs: this.previewRuns(path, lines), lang: languageOf(path), note: null };
      cx.notify();
    });
  }

  /** The preview's lines in their colors, worked out once per file and line. */
  previewRuns(path: string, lines: readonly string[]): Run[][] {
    if (!lines.length) return [];

    const spans = highlight(lines.join("\n"), path);
    let at = 0;

    return lines.map((line) => {
      const end = at + line.length;
      const start = at;
      const mine = spans.flatMap(([s, e, n]): Span[] => (e > start && s < end ? [[Math.max(s, start) - start, Math.min(e, end) - start, n]] : []));

      at = end + 1;

      return colorRuns(line.replace(/\t/g, "  "), mine, this.colors);
    });
  }

  /** A row clicked in the list (its key: the answer and the index). */
  clicked(key: string): void {
    const [gen, i] = key.split(":").map(Number);
    const r = i === undefined ? undefined : this.rows[i];

    if (gen !== this.gen || i === undefined || !r || r.head) return;

    this.at = i;
    this.open();
  }

  open(): void {
    const r = this.rows[this.at];

    if (!r || r.head) return;

    const path = `${this.root}/${r.path}`;

    this.dismiss();
    // The focused editor, else the shown tab's, takes it as a tab; with none, a new one (editor-route.ts).
    // A file picked (no line): opened to be looked at, as a files pane's open: a picture or a
    // table drawn, Markdown in the editor's view for it. A grep hit: the text at its line.
    openInEditor(herdr, "match" in r ? { path, line: r.match.line, col: r.match.col + 1 } : { path, look: true });
  }

  // ---- drawing

  override render(_cx: Context): Element {
    const t = theme();
    const wide = previewWidth(this.size.width) > 0;
    const bound = keys();

    const key = (m: Mode): string => {
      const [action, fallback] = GLOBAL[m];

      return keyFor(bound, action, fallback);
    };

    const other = otherMode(this.mode);
    const code = settings().font_family || "JetBrains Mono";
    const typed = this.value();

    const count = this.mode === "files"
      ? (this.total === null ? "" : `${this.rows.length} of ${this.total}`)
      : typed.trim() ? `${this.total ?? 0} lines${this.files === null ? "" : ` in ${this.files} files`}` : "";

    // Each chip carries its key; the one shown is lit.
    const modeChip = (m: Mode): Element => h_flex().id(`mode-${m}`).px(9).py(3).gap(8).items_center().text_color(this.mode === m ? t.background : t.dim)
      .when(this.mode === m, (el) => el.bg(t.accent))
      .when(this.mode !== m, (el) => el.hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => {
        this.setMode(m, cx);
        cx.notify();
      }))
      .child(div().child(m))
      .child(div().text_size(9.5).text_color(this.mode === m ? t.background : t.ansi8).opacity(this.mode === m ? 0.75 : 1).child(key(m)));

    const hint = (k: string, what: string): Element => h_flex().flex_none().gap(4).child(div().text_color(t.accent).child(k)).child(div().text_color(t.dim).child(what));

    // Two keys for one thing: "tab / cmd-shift-f grep".
    const hint2 = (a: string, b: string, what: string): Element => h_flex().flex_none().gap(4).child(div().text_color(t.accent).child(a)).child(div().text_color(t.ansi8).child("/"))
      .child(div().text_color(t.accent).child(b)).child(div().text_color(t.dim).child(what));

    const note = this.note;
    const shown = wide ? this.preview : null;

    return v_flex().id("finder").size_full().bg(t.background).border(1).border_color(t.ansi0).text_size(11)
      .key_context(CONTEXT)
      .on_action(SWITCH, (_e, cx) => {
        this.switchMode(cx);
        cx.notify();
      })
      // Logical px in, the zoomed px every w() / h() here is drawn in out.
      .on_size_change((size, cx) => {
        this.size = { width: size.width / zoom(), height: size.height / zoom() };
        this.loadPreview(cx);
        cx.notify();
      })
      .on_key_down((e, cx) => {
        const k = e.keystroke;

        if (k === "escape") {
          this.dismiss();

          return;
        }

        if (k === "down" || k === "ctrl-n") this.pick(1, cx);
        else if (k === "up" || k === "ctrl-p") this.pick(-1, cx);
        else if (k === "pagedown") {
          for (let i = 0; i < 10; i++) this.pick(1, cx);
        } else if (k === "pageup") {
          for (let i = 0; i < 10; i++) this.pick(-1, cx);
        } else if (k === "tab" || k === "shift-tab") this.switchMode(cx);
        else if (k === "ctrl-r" && this.mode === "grep") {
          this.regex = !this.regex;
          this.fuzzy = false;
          this.query(cx);
        } else if (k === "ctrl-t" && this.mode === "grep") {
          this.fuzzy = !this.fuzzy;
          this.regex = false;
          this.query(cx);
        } else return;

        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().relative().h(48).flex_none().px(16).gap(12).items_center()
        .child(div().relative().size(22).flex_none().flex().items_center().justify_center()
          .child(div().absolute().inset_0().opacity(0.35).child(dither(t.accent, 1)))
          .child(div().relative().text_size(13).text_color(t.foreground).child(this.mode === "files" ? "›" : "/")))
        .children(this.input ? [Input.new(this.input).flex_1().h_full().text_size(13).text_color(t.foreground).when(this.mode === "grep", (el) => el.font_family(code))] : [])
        .child(div().flex_none().text_size(10).text_color(t.dim).child(count))
        .when(this.mode === "grep", (el) => el
          .child(div().id("grep-regex").flex_none().px(5).border(1).border_color(this.regex ? t.accent : t.ansi0).text_color(this.regex ? t.accent : t.dim)
            .on_click((_e, cx) => {
              this.regex = !this.regex;
              this.fuzzy = false;
              this.query(cx);
            }).child(".*")))
        .child(h_flex().flex_none().border(1).border_color(t.ansi0).child(modeChip("files")).child(modeChip("grep")))
        .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1))))
      .children(note === null ? [] : [div().px(16).py(4).text_color(t.ansi3).child(note)])
      .child(h_flex().flex_1().min_h(0)
        .child(div().id("picker-list").relative().flex_1().min_w(0).h_full().py(4)
          .when(this.rows.length > 0, (el) => el.child(this.list(t, code)).child(Scrollbar.vertical("picker-rows").absolute().inset_0()))
          .when(!this.rows.length && note === null, (el) => el.child(div().px(16).py(10).text_color(t.dim)
            .child(this.mode === "files" ? (typed ? "No file matches." : "") : typed.trim() ? "No line matches." : "Type to search the text of every file."))))
        .children(shown ? [this.previewView(t, code, shown)] : []))
      // The keys wrap onto a second line in a narrow window rather than run off it.
      .child(h_flex().relative().flex_wrap().min_h(26).flex_none().px(16).py(6).gap_x(14).gap_y(4).items_center().text_size(10)
        .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
        .child(hint2("↑↓", "ctrl-p ctrl-n", "pick")).child(hint("pgup pgdn", "page")).child(hint("enter", this.mode === "files" ? "edit" : "edit at line"))
        .child(hint2("tab", key(other), other))
        .when(this.mode === "grep", (el) => el.child(hint("ctrl-r", "regex")).child(hint("ctrl-t", "fuzzy")))
        .child(hint("esc", "close"))
        .child(div().flex_1())
        .child(div().min_w(0).text_color(t.dim).truncate().child(this.root ? `${tilde(this.root)} · .gitignore respected${this.ms === null ? "" : ` · ${this.ms} ms`}` : "")));
  }

  /** The rows, only those on screen drawn: files are one height, grep's
   *  file heads and lines their own. */
  list(t: Theme, code: string): Element {
    const rows = this.rows;
    const gen = this.gen;
    const sizes = this.mode === "files" ? ROW : rows.map((r) => (r.head ? HEAD : LINE));

    const list = v_virtual_list("picker-rows", rows.length, sizes, (i) => `${gen}:${i}`,
      (range) => rows.slice(range.start, range.end).map((r, k) => {
        const i = range.start + k;

        return "file" in r ? this.fileRow(t, r, i) : r.head ? this.headRow(t, r, i) : this.lineRow(t, r, i, code);
      }))
      .on_item_click((key) => this.clicked(key))
      .size_full();

    return this.scroll ? list.track_scroll(this.scroll) : list;
  }

  /** The picked row: a flat accent tint and the bar, clear on moonfly's
   *  near-black while the text on it stays readable. */
  selected(t: Theme, el: Element, sel: boolean): Element {
    return el.when(sel, (el) => el.bg(`${t.accent}2e`).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)));
  }

  pieces(t: Theme, parts: readonly Mark[], base: Color): Element[] {
    return parts.map(([piece, on]) => div().text_color(on ? t.accent : base).child(piece));
  }

  fileRow(t: Theme, r: FileRow, i: number): Element {
    const { name, dir } = split(r.path);
    const g = r.file.git;
    const sel = i === this.at;

    return this.selected(t, h_flex().id(`file-${i}`).relative().h(ROW).flex_none().px(16).gap(10).items_center().text_size(12)
      .hover((s) => s.bg(`${t.ansi0}55`)), sel)
      .child(div().relative().w(10).flex_none().text_size(11).text_color(g ? gitColor(t, g) : t.dim).child(g ?? ""))
      .child(h_flex().relative().flex_none().children(this.pieces(t, marks(name, nameRanges(r.path, r.file.ranges)), t.foreground)))
      .child(h_flex().relative().flex_1().min_w(0).overflow_hidden().children(this.pieces(t, marks(dir, dirRanges(r.path, r.file.ranges)), sel ? t.muted : t.dim)));
  }

  headRow(t: Theme, r: HeadRow, i: number): Element {
    const { name, dir } = split(r.path);

    return h_flex().id(`head-${i}`).h(HEAD).flex_none().px(16).pb(4).gap(10).items_end().text_size(10).text_color(t.muted)
      .child(div().flex_none().text_size(11).text_color(t.foreground).child(name))
      .child(div().flex_none().max_w(320).truncate().child(dir))
      .child(div().relative().flex_1().h(1).mb(5).opacity(0.6).child(dither(t.ansi8, 1)))
      .child(div().flex_none().child(String(r.count)));
  }

  /** The line, colored by its language, the matches over it: worked out the
   *  first time the row shows, kept on the row after. */
  lineRuns(r: LineRow): readonly HitRun[] {
    if (r.runs) return r.runs;

    const text = r.match.text.replace(/\t/g, "  ").slice(0, 300);
    const runs = lineRuns(colorRuns(text, highlight(text, r.path), this.colors), r.match.ranges);

    r.runs = runs;

    return runs;
  }

  lineRow(t: Theme, r: LineRow, i: number, code: string): Element {
    const m = r.match;
    const sel = i === this.at;
    const out = this.lineRuns(r);

    return this.selected(t, h_flex().id(`line-${i}`).relative().h(LINE).flex_none().pl(26).pr(16).gap(10).items_center()
      .hover((s) => s.bg(`${t.ansi0}55`)), sel)
      .child(div().relative().w(40).flex_none().text_right().font_family(code).text_size(11.5).text_color(t.dim).child(String(m.line)))
      .child(h_flex().relative().flex_1().min_w(0).overflow_hidden().font_family(code).text_size(12)
        .children(out.map(([piece, color, hit], j) => div().id(`l-${i}-${j}`).flex_none()
          .text_color(hit ? t.background : color ?? t.foreground).when(hit, (el) => el.bg(t.accent)).child(piece))));
  }

  previewView(t: Theme, code: string, p: Preview): Element {
    const root = this.root ?? "";
    const rel = p.path.startsWith(`${root}/`) ? p.path.slice(root.length + 1) : p.path;

    return v_flex().id("picker-preview").w(previewWidth(this.size.width)).flex_none().h_full().border_l(1).border_color(t.ansi0)
      .child(h_flex().h(26).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.ansi0).text_color(t.dim)
        .child(div().text_color(t.foreground).truncate().child(rel))
        .child(div().child(`${p.line}`))
        .child(div().flex_1())
        .child(div().child(p.lang ?? "")))
      .children(p.note === null ? [] : [div().px(14).py(10).text_color(t.dim).child(p.note)])
      .child(v_flex().flex_1().min_h(0).pt(6).overflow_hidden().font_family(code).text_size(12)
        .children(p.runs.map((runs, k) => {
          const n = p.from + k;
          const hit = n === p.line;

          return h_flex().id(`pv-${k}`).relative().h(PREVIEW_LINE).flex_none().items_center()
            .when(hit, (el) => el.bg(`${t.accent}14`).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
            .child(div().w(48).flex_none().text_right().pr(12).text_color(hit ? t.foreground : t.dim).child(String(n)))
            .child(h_flex().flex_1().min_w(0).overflow_hidden().children(runs.map(([piece, color], j) => div().id(`pv-${k}-${j}`).flex_none().text_color(color ?? t.foreground).child(piece))));
        })));
  }
}
