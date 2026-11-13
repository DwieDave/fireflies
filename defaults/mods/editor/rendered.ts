// The rendered view of a Markdown tab (main.ts view "rendered"): the document
// drawn as its units (live.ts), the one the caret is in lit up as its own
// Markdown in a second code editor (the "block editor") that holds just those
// lines. The file's own editor keeps the whole text: every keystroke in the
// block is written into it as one edit of those lines, so saving, undo, the
// unsaved mark and the language server work as in the text view, and what
// isn't edited stays byte for byte. Edits made to the file's editor from
// elsewhere (vim, the Markdown commands, undo, a reload) come back into the
// block (pull).
//
// While it's typed into, the block is one stable thing: its editor is never
// emptied and refilled (set_value resets its caret, scroll and undo), only
// edited where the text differs; its height is the one measured last (or an
// estimate from its lines when that's grown), never dropped to a guess, so
// neither the caret nor the lit ground repaints from scratch on a key. A key
// costs work for the lit lines only: the file's lines and units are kept
// (cut again when the caret leaves a block it typed into), the other units
// keep their keys (named by their text, so moving down a line keeps their
// height and drawing), and nothing is split again per drawn unit.
//
// Keys in the block (key): up / down past its first or last row step into the
// unit before or after (blank lines between are passed over); enter on a list
// item, task or quote starts the next one (mdedit.ts enter); enter on the
// last line of any other block starts a new paragraph below it (the text
// after the caret goes with it; shift-enter: a line break inside the block);
// undo and redo are the file's. With vim, the keys go to vim over the whole
// text first (its caret mapped there), and the lit lines follow vim: the
// unit at its caret, or every unit its visual selection touches (the
// selection drawn in the block), so motions, counts and operators work across
// blocks as on plain text.
//
// Adding a block: a "+" left of the block under the pointer, and the "add a
// block" line under the last one, put an empty paragraph after it (lit, the
// caret in it); an empty block offers the kinds (heading, list, task, quote,
// code, rule, image) as chips a click or cmd-. and the kind's letter runs.
//
// Image blocks: a line holding only images (live.ts "image") draws each
// picture fitting the column and keeping its shape (at most IMAGE_H tall),
// from a copy under the app's cache made once per picture (main.ts
// loadImageSrcs, markdown.ts cacheImage; gpui decodes it once), so a key
// costs nothing for them; a picture on the web is drawn by the Markdown view,
// one that can't be found is a block saying so. A paste the block finds no
// text in (a screenshot) goes to the pane (main.ts pasteImage, images.ts).

import type { Color, Context, Element, KeyEvent } from "gpui-kit";
import { div, svg, image } from "gpui-kit";
import type { EditorPosition, EditorState as EditorStateT } from "gpui-base";
import { h_flex, v_flex, EditorState, Editor } from "gpui-base";
import type { Theme } from "herdr";
import type { Range, Unit } from "./live.ts";
import { units, unitFor, step, splice, itemParts, quoteBody } from "./live.ts";
import type { SyntaxColors } from "./logic.ts";
import type { Sel } from "./mdedit.ts";
import { enter } from "./mdedit.ts";
import { markdown, CALLOUTS, imagesAsLinks, fenced } from "./markdown.ts";

type Pos = EditorPosition;

const GAP = 10;
const TIGHT = 3; // between units; between two list items
const PAD_TOP = 18;
const PAD_BOTTOM = 60;
const ROW = 20; // the block editor's line height at font 13 (measured when drawn)
const CHAR = 7.8; // a code-font character's width at 13 px (measured when drawn)
const OVERDRAW = 1.2;
const ADD_H = 30; // the "add a block" line under the last unit
const KINDS_H = 26; // an empty block's row of kinds
const PLUS = "mods/workspace-chrome/plus.svg";

/** A kind an empty block offers: [Markdown command (mdedit.ts), word, its letter after cmd-.]. */
export type BlockKind = readonly [command: string, word: string, letter: string];

/** The kinds an empty block offers: [Markdown command (mdedit.ts), word, its letter after cmd-.]. */
export const KINDS: readonly BlockKind[] = [["heading-1", "heading", "1"], ["bullets", "list", "l"], ["task", "task", "t"], ["quote", "quote", "q"], ["fence", "code", "c"], ["rule", "rule", "r"], ["image", "image", "p"]];

const IMAGE_H = 560; // the tallest a picture is drawn (it keeps its shape, the column's width at most)

/** One edit: [start, end) replaced by `text`, as editor positions. */
export interface TextEdit {
  readonly start: Pos;
  readonly end: Pos;
  readonly text: string;
}

/** One edit taking `a` to `b`: the span between their common start and end, as editor positions. */
export function editBetween(a: string, b: string): TextEdit | null {
  if (a === b) return null;

  let s = 0;

  while (s < a.length && s < b.length && a[s] === b[s]) s++;

  let e = 0;

  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;

  const pos = (text: string, o: number): Pos => {
    const before = text.slice(0, o).split("\n");

    return { line: before.length - 1, col: (before.at(-1) ?? "").length };
  };

  return { start: pos(a, s), end: pos(a, a.length - e), text: b.slice(s, b.length - e) };
}

/** What a unit is called, at the lit block's corner. */
export function kindWord(u: Unit | null | undefined): string {
  if (!u) return "";

  switch (u.kind) {
    case "heading":
      return `heading ${u.level}`;
    case "item":
      return u.task ? "task" : /^\d/.test(u.marker) ? "numbered item" : "list item";
    case "fence":
      return u.lang ? `code · ${u.lang}` : "code";
    case "quote":
      return u.callout ? `callout · ${u.callout}` : "quote";
    case "para":
      return "paragraph";
    case "ref":
      return "reference";
    case "front":
      return "front matter";
    case "blank":
      return "new block";
    default:
      return u.kind;
  }
}

/** How many rows `text` takes in a box `width` px wide, `cw` px a character (an estimate: words wrap whole). */
export function wrappedRows(text: string, width: number, cw = CHAR): number {
  const cols = Math.max(8, Math.floor((width - 4) / cw));
  let n = 0;

  for (const l of text.split("\n")) n += Math.max(1, Math.ceil(l.replace(/\t/g, "    ").length / cols));

  return n;
}

const samePos = (a: Pos | null | undefined, b: Pos | null | undefined): boolean => Boolean(a && b) && a?.line === b?.line && a?.col === b?.col;

/** A picture of an image block: its file (null: on the web) and its cached copy's name
 *  (null: it can't be found, undefined: being copied). */
export interface Picture {
  readonly abs: string | null;
  readonly name: string | null | undefined;
}

/** What the rendered view asks of its pane (main.ts renderedHost). */
export interface RenderedHost {
  readonly font: string;
  readonly colors: SyntaxColors;
  readonly selection: string;
  readonly zoom: () => number;
  readonly dither: (color: Color) => Element;
  readonly moon?: (t: Theme) => Element;
  /** A key before the block editor (vim, the app's keys, the menu): true when taken. */
  readonly onKey: (e: KeyEvent, cx: Context) => boolean;
  readonly link: (url: string, cx: Context) => void;
  readonly notify: (cx: Context | null | undefined) => void;
  readonly mdRun?: (name: string, cx: Context) => void;
  readonly image?: (src: string) => Picture;
  readonly loadImages?: (srcs: readonly string[], cx: Context) => void;
  readonly pasteImage?: (cx: Context) => void;
  readonly mdMenu?: (cx: Context) => void;
  readonly vim?: () => boolean;
}

/** The tab the view draws (main.ts newDoc): its file's own editor. */
export interface RenderedDoc {
  readonly editor: EditorStateT;
}

/** What the view draws with: the theme, whether it has the keyboard, an empty scratchpad's
 *  words, a task box's click, the column's width and how to take the zoom off px. */
export interface ViewOptions {
  readonly t: Theme;
  readonly focused: boolean;
  readonly empty?: { readonly title: string; readonly detail: string; readonly hint?: string } | null;
  readonly onTask: (line: number, cx: Context) => void;
  readonly maxWidth?: number;
  readonly unzoom: (px: number) => number;
}

/** A caret and the selection's other end. */
interface Placed {
  readonly anchor: Pos;
  readonly head: Pos;
}

/** A drawn row: its unit, lit or not, its key and its gap above. */
interface Row {
  readonly u: Unit;
  readonly lit: boolean;
  readonly key: string;
  readonly gap: number;
}

/** The text after a splice of the lit lines, their range now and whether the file is CRLF. */
interface Spliced {
  readonly text: string;
  readonly range: Range;
  readonly crlf: boolean;
}

/** Where the lit lines start in a text (kept between keys). */
interface Pre {
  readonly text: string;
  readonly from: number;
  readonly at: number;
  readonly crlf: boolean;
}

/** A tab's rendered view. `host`: the pane's hooks { colors, font, zoom(),
 *  dither(color), onKey(e, cx) -> taken (vim, the app's keys, the menu),
 *  link(url, cx), notify(cx), mdRun(name, cx), mdMenu(cx), vim() -> on }.
 *  The block editor is made here, so this is built from init or an event
 *  (never a render). */
export class Rendered {
  doc: RenderedDoc; // the tab (main.ts newDoc): doc.editor
  host: RenderedHost;
  all: Unit[] = []; // every unit of the text (as last cut; `stale` once the lit lines were typed into)
  units: Unit[] = []; // the units drawn: all but the lit lines
  stale = false;
  range: Range = { from: 0, to: 0 }; // the lit lines in the file
  unit: Unit = { kind: "blank", from: 0, to: 0 };
  text: string | null = null; // the file's text as last seen here
  ls: string[] | null = null; // its lines (no \r), cut once per text
  refsText: string | null = null;
  piece = ""; // the block editor's text as last put there or taken from it
  placed: Placed | null = null; // the block's caret / selection as last put there
  heights = new Map<string, number>();
  hashes = new Map<string, string>();
  /** Each unit's own text (kept on it: a unit moved down keeps it). */
  srcs = new WeakMap<Unit, string>();
  blockH: number | null = null; // the block editor's measured content height
  blockHFor: string | null = null; // the text it was measured with
  litW = 600; // the block editor's width (layout px)
  cw = CHAR;
  rowH = ROW;
  scrollY = 0;
  viewH = 400;
  litTop = 0;
  reveal = true; // keep the lit block in view on the next draw
  hover: string | null = null; // the drawn unit under the pointer (its key): its "+" shows
  pushing = false;
  pre: Pre | null = null;
  made: number | null = null; // the line of an empty block made here (enter, a +)
  block: EditorStateT;

  constructor(doc: RenderedDoc, host: RenderedHost) {
    this.doc = doc;
    this.host = host;
    this.block = EditorState.new({
      language: "markdown",
      value: "",
      font_family: host.font,
      font_size: 13,
      line_numbers: false,
      folding: false,
      soft_wrap: true,
      syntax: host.colors,
      selection: host.selection,
    });
    this.block.on("change", (_e, cx) => this.push(cx));
    this.block.on("key", (e, cx) => this.key(e, cx));
    // A paste the block found no text in (a screenshot): the pane saves it and puts an image block there.
    this.block.on("paste_other", (_e, cx) => this.host.pasteImage?.(cx));
  }

  // ---- the text

  /** The file's text now (its editor's). */
  fileText(): string {
    return this.doc.editor.value();
  }

  setText(t: string): void {
    if (t === this.text) return;

    this.text = t;
    this.ls = null;
    this.refsText = null;
  }

  /** The text's lines, \r dropped (cut once per text). */
  lines(): string[] {
    this.ls ??= (this.text ?? "").split("\n").map((l) => l.replace(/\r$/, ""));

    return this.ls;
  }

  /** The text of lines [from, to]. */
  sliceOf(r: Range): string {
    return this.lines().slice(r.from, r.to + 1).join("\n");
  }

  /** A unit's own text (kept for it: a unit moved down keeps it). */
  src(u: Unit): string {
    const kept = this.srcs.get(u);

    if (kept !== undefined) return kept;

    const text = this.sliceOf(u);

    this.srcs.set(u, text);

    return text;
  }

  /** Cuts the whole text into units again (and has the pictures it shows copied where they can be drawn). */
  recut(cx: Context | null | undefined): void {
    this.all = units(this.text);
    this.stale = false;
    this.askImages(cx);
  }

  /** The pictures of the image blocks, copied once each where they can be drawn (main.ts loadImageSrcs). */
  askImages(cx: Context | null | undefined): void {
    const srcs = this.all.flatMap((u) => (u.kind === "image" ? u.images.map((im) => im.src) : []));

    if (srcs.length && cx) this.host.loadImages?.(srcs, cx);
  }

  /** The units drawn (every one outside the lit lines), and the lit lines' kind as they are now. */
  split(): void {
    const { from, to } = this.range;

    this.units = this.all.filter((u) => u.to < from || u.from > to);
    this.unit = this.kindOf(this.piece, from, to);
  }

  /** The kind of lines [from, to] holding `piece`: the one unit they make, else the first's; empty: a new block. */
  kindOf(piece: string, from: number, to: number): Unit {
    if (!piece.trim()) return { kind: "blank", from, to };

    const local = units(piece).filter((u) => from === 0 || u.kind !== "front");
    const u: Unit = local[0] ?? { kind: "para", from, to };

    return { ...u, from, to };
  }

  /** Starts on the file's text with the caret where the file's editor has it (switching to this view, a reload). */
  open(cx: Context | null | undefined): void {
    this.setText(this.fileText());
    this.recut(cx);
    this.lightAt(cx, true);
    this.reveal = true;
    cx?.notify();
  }

  /** The file's caret and selection: { anchor, head } (file coordinates). */
  fileSel(): Placed {
    const s = this.doc.editor.selection();
    const head = this.doc.editor.cursor();
    const anchor = samePos(head, s.start) ? s.end : s.start;

    return { anchor, head };
  }

  /** The lines to light for the file's caret: the unit holding it, or every unit its selection touches. */
  wanted(): Range {
    const { anchor, head } = this.fileSel();
    const lo = Math.min(anchor.line, head.line);
    const hi = Math.max(anchor.line, head.line);
    const a = unitFor(this.all, lo);
    const b = unitFor(this.all, hi);

    return { from: Math.min(a.from, lo), to: Math.max(b.to, hi) };
  }

  /** Lights the lines the file's caret (and selection) is on. `force`: even when they're lit already. */
  lightAt(cx: Context | null | undefined, force = false): void {
    if (this.stale) this.recut(cx);

    const r = this.wanted();

    if (force || r.from !== this.range.from || r.to !== this.range.to) this.light(r);
    else this.split();

    this.mirror();
    this.measureSoon(cx);
    this.host.notify(cx);
  }

  /** Lights lines `r` up: their text into the block editor. `inPlace`: the same
   *  block changed under it, edited where it differs. */
  light(r: Range, inPlace = false): void {
    const was = this.range;

    this.range = { from: r.from, to: r.to };

    const piece = this.sliceOf(this.range);

    if (this.block.value() !== piece) {
      if (inPlace && was.from === r.from) this.editBlock(piece);
      else {
        // Another block: its text replaces the editor's (a fresh height, caret and scroll).
        this.block.set_value(piece);
        this.placed = null;

        if (this.blockHFor !== piece) this.blockH = null;
      }
    }

    this.piece = piece;
    this.reveal = true;
    this.split();
  }

  /** The file's caret and selection into the block (where it isn't already). */
  mirror(): void {
    const { anchor, head } = this.fileSel();
    const off = this.range.from;
    const n = this.piece.split("\n");

    const clamp = (p: Pos): Pos => {
      const line = Math.max(0, Math.min(n.length - 1, p.line - off));

      return { line, col: Math.max(0, Math.min((n[line] ?? "").length, p.col)) };
    };

    const a = clamp(anchor);
    const h = clamp(head);
    const s = this.block.selection();
    const c = this.block.cursor();
    const bAnchor = samePos(c, s.start) ? s.end : s.start;

    if (samePos(c, h) && samePos(bAnchor, a)) {
      this.placed = { anchor: a, head: h };

      return;
    }

    if (samePos(a, h)) this.block.set_cursor(h.line, h.col);
    else this.block.set_cursor(a.line, a.col, h);

    this.placed = { anchor: a, head: h };
  }

  /** The block was edited (typed into): its lines into the file as one edit. */
  push(cx: Context): void {
    const v = this.block.value();

    if (v === this.piece) return; // our own edit coming back, or nothing new

    const was = this.piece;
    const from = this.range.from;
    const before = this.text ?? this.fileText();
    const e = editBetween(was, v);
    const r = this.spliced(before, v);
    const delta = r.range.to - r.range.from - (this.range.to - this.range.from);
    const crlf = r.crlf;

    this.piece = v;
    this.range = r.range;

    // The units after the lit lines move with them (their text, keys and heights kept);
    // those that were inside them are cut again once the caret leaves.
    const oldTo = r.range.to - delta;

    this.all = this.all.flatMap((u): Unit[] => {
      if (!(u.to < from || u.from > oldTo)) return [];

      if (!(delta && u.from > oldTo)) return [u];

      const movedUnit: Unit = { ...u, from: u.from + delta, to: u.to + delta };
      const kept = this.srcs.get(u);

      if (kept !== undefined) this.srcs.set(movedUnit, kept);

      return [movedUnit];
    });
    this.stale = true;
    this.setText(r.text);

    if (e) {
      // The file's change event comes back to pull: nothing to do there, the text is this already.
      this.pushing = true;

      try {
        this.doc.editor.edit([{ start: { line: e.start.line + from, col: e.start.col }, end: { line: e.end.line + from, col: e.end.col }, text: crlf ? e.text.replace(/\n/g, "\r\n") : e.text }]);
      } finally {
        this.pushing = false;
      }
    }

    this.syncCaret(true);
    this.split();
    this.measureSoon(cx);
    this.host.notify(cx);
  }

  /** The file's editor changed (vim, a command, undo, a reload, our own push), or vim moved its caret. */
  pull(cx: Context | null | undefined): void {
    if (this.pushing) return;

    const now = this.fileText();

    if (now !== this.text) {
      this.setText(now);
      this.recut(cx);
      // What's lit is the caret's now, its lines as they are (on the same first line, edited
      // in place: vim's x, a command, undo keep the block's caret and scroll).
      this.light(this.wanted(), true);
      this.mirror();
      this.measureSoon(cx);
      this.reveal = true;
      this.host.notify(cx);

      return;
    }

    // The text is ours already: the caret moved (vim), maybe out of the lit lines.
    const r = this.wanted();

    if (r.from < this.range.from || r.to > this.range.to || (!this.stale && (r.from !== this.range.from || r.to !== this.range.to))) {
      this.lightAt(cx, true);
      this.reveal = true;

      return;
    }

    this.mirror();
    this.host.notify(cx);
  }

  /** The text with the lit lines replaced by `piece` (live.ts splice, without cutting the
   *  whole text into lines on every key: where the lit lines start is kept). */
  spliced(text: string, piece: string): Spliced {
    let pre = this.pre;

    if (pre?.text !== text || pre.from !== this.range.from) {
      let at = 0;

      for (let i = 0; i < this.range.from && at >= 0; i++) {
        const n = text.indexOf("\n", at);

        at = n < 0 ? -1 : n + 1;
      }

      if (at < 0) return { ...splice(text, this.range, piece), crlf: /\r\n/.test(text) };

      pre = { text, from: this.range.from, at, crlf: text.includes("\r\n") };
      this.pre = pre;
    }

    const { at, crlf } = pre;
    let end = at;

    for (let i = this.range.from; i <= this.range.to; i++) {
      const n = text.indexOf("\n", end);

      if (n < 0) {
        end = text.length;
        break;
      }

      end = i === this.range.to ? n : n + 1;
    }

    const old = text.slice(at, end);
    const raw = crlf ? piece.split("\n").join("\r\n") + (old.endsWith("\r") ? "\r" : "") : piece;
    const next = text.slice(0, at) + raw + text.slice(end);

    this.pre = { text: next, from: this.range.from, at, crlf };

    return { text: next, range: { from: this.range.from, to: this.range.from + piece.split("\n").length - 1 }, crlf };
  }

  /** The block's text made `piece` by editing only where it differs (its caret, scroll and undo stay). */
  editBlock(piece: string): void {
    const e = editBetween(this.block.value(), piece);

    this.piece = piece;

    if (e) this.block.edit([e]);
  }

  /** The block's caret and selection, put into the file's editor (before vim, a command, a save):
   *  only when it moved there (a click, typing), so vim's own selection keeps its direction. */
  syncCaret(force = false): void {
    const s = this.block.selection();
    const c = this.block.cursor();
    const anchor = !samePos(s.start, s.end) ? (samePos(c, s.start) ? s.end : s.start) : c;

    if (!force && this.placed && samePos(this.placed.head, c) && samePos(this.placed.anchor, anchor)) return;

    const off = this.range.from;

    if (samePos(anchor, c)) this.doc.editor.set_cursor(c.line + off, c.col);
    else this.doc.editor.set_cursor(anchor.line + off, anchor.col, { line: c.line + off, col: c.col });

    this.placed = { anchor, head: c };
  }

  /** The selection in file coordinates. */
  selection(): Sel {
    const s = this.block.selection();
    const off = this.range.from;

    return { start: { line: s.start.line + off, col: s.start.col }, end: { line: s.end.line + off, col: s.end.col } };
  }

  // ---- keys

  /** A key in the block, before the block editor: -> true when taken. */
  key(e: KeyEvent, cx: Context): boolean {
    this.syncCaret();

    if (this.host.onKey(e, cx)) return true;

    const k = e.key;
    const m = e.modifiers;
    const plain = !m.platform && !m.control && !m.alt && !m.shift;

    if (m.platform && !m.alt && !m.control && k === "z") {
      if (m.shift) this.doc.editor.redo();
      else this.doc.editor.undo();

      return true;
    }

    if (plain && (k === "up" || k === "down")) return this.edge(k === "up" ? -1 : 1, cx);

    if (plain && k === "enter") return this.enterKey(cx);

    return false;
  }

  /** Enter: a list item, task or quote goes on (mdedit.ts); on the last line of any other block, a new paragraph below. */
  enterKey(cx: Context): boolean {
    const sel = this.localSel();
    const r = enter(this.piece, sel);

    if (r) {
      const e = editBetween(this.block.value(), r.text);

      if (e) this.block.edit([e]);

      this.block.set_cursor(r.sel.start.line, r.sel.start.col);
      this.push(cx); // the edit's own change event comes after: the file has it now

      return true;
    }

    if (sel.start.line !== sel.end.line || sel.start.col !== sel.end.col) return false;

    const ls = this.piece.split("\n");
    const last = ls.length - 1;
    const lastText = ls[last] ?? "";
    const c = sel.start;

    if (c.line !== last || this.unit.kind === "blank" || this.unit.kind === "front") return false;

    // Inside a code block, enter is a new line (its closing line's end makes a block).
    if (this.unit.kind === "fence" && !(c.col >= lastText.length && last > 0)) return false;

    if ((this.unit.kind === "item" || this.unit.kind === "quote") && c.col < lastText.length) return false;

    this.splitAt(this.range.to, c.col, cx);

    return true;
  }

  /** A new paragraph after file line `line`, from column `col` (the rest of the line goes into it). */
  splitAt(line: number, col: number, cx: Context): void {
    const ls = this.lines();
    const crlf = /\r\n/.test(this.text ?? "");
    const nl = crlf ? "\r\n" : "\n";
    const rest = (ls[line] ?? "").slice(col);
    const next = ls[line + 1];
    // A blank line between, and one after it when something follows straight on.
    const tail = next?.trim() ? nl : "";

    this.doc.editor.edit([{ start: { line, col }, end: { line, col: (ls[line] ?? "").length }, text: nl + nl + rest + tail }]);
    this.doc.editor.set_cursor(line + 2, 0);
    this.made = line + 2;
    this.pull(cx);
    this.block.focus();
  }

  /** Whether the lit block offers the kinds: an empty one made here (enter, a +), or an empty
   *  document; not a blank line vim's j passes over (the layout stays still there). */
  offersKinds(): boolean {
    return this.unit.kind === "blank" && (this.made === this.range.from || !this.all.length);
  }

  /** An empty paragraph after unit `u` (the "+" beside it, "add a block" under the last), lit, the caret in it. */
  addAfter(u: Unit | null, cx: Context): void {
    if (!u) {
      // An empty document: its first line.
      this.doc.editor.set_cursor(0, 0);
      this.made = 0;
      this.pull(cx);
      this.block.focus();

      return;
    }

    if (this.stale) this.recut(cx);

    const ls = this.lines();
    const at = Math.min(u.to, ls.length - 1);

    this.splitAt(at, (ls[at] ?? "").length, cx);
  }

  localSel(): Sel {
    return this.block.selection();
  }

  /** Up / down: within the block unless the caret is on its first / last row, else into the next unit. */
  edge(dir: number, cx: Context): boolean {
    const c = this.block.cursor();
    const lines = this.piece.split("\n");
    const lastLine = lines.length - 1;
    const onEdge = dir < 0 ? c.line === 0 && this.firstRow(c) : c.line === lastLine && this.lastRow(c, lines);

    if (!onEdge) return false;

    return this.stepUnit(dir, c.col, cx);
  }

  /** Into the unit before (-1) or after (1); false at the document's ends. */
  stepUnit(dir: number, col: number, cx: Context): boolean {
    if (this.stale) {
      this.recut(cx);
      this.units = this.all.filter((u) => u.to < this.range.from || u.from > this.range.to);
    }

    const s = step(this.text, this.units, this.range, dir, col);

    if (!s) return false;

    this.doc.editor.set_cursor(s.line, s.col);
    this.light(s.unit);
    this.mirror();
    this.measureSoon(cx);
    this.host.notify(cx);

    return true;
  }

  /** Whether the caret is on the first drawn row of the block's first line (a soft-wrapped line has more). */
  firstRow(c: Pos): boolean {
    const a = this.block.bounds({ line: 0, col: 0 });
    const b = this.block.bounds(c);

    return !a || !b || Math.abs(a.y - b.y) < 2;
  }

  lastRow(c: Pos, lines: readonly string[]): boolean {
    const last = lines.length - 1;
    const a = this.block.bounds({ line: last, col: (lines[last] ?? "").length });
    const b = this.block.bounds(c);

    return !a || !b || Math.abs(a.y - b.y) < 2;
  }

  /** A click on a drawn unit: it lights up, the caret on its first line (`end`: its last). */
  clickUnit(clicked: Unit, cx: Context, end = false): void {
    let u = clicked;

    if (this.stale) {
      this.recut(cx);
      u = unitFor(this.all, u.from);
    }

    const ls = this.lines();
    const line = end ? u.to : u.from;

    this.doc.editor.set_cursor(line, end ? (ls[line] ?? "").length : 0);
    this.light(u);
    this.mirror();
    this.measureSoon(cx);
    this.block.focus();
    this.host.notify(cx);
  }

  focus(): void {
    this.block.focus();
  }

  focused(): boolean {
    return this.block.focused();
  }

  // ---- drawing

  /** Every unit's height: measured, else a guess from its lines. */
  height(key: string, u: Unit): number {
    const h = this.heights.get(key);

    if (h !== undefined) return h;

    return (u.to - u.from + 1) * 22 + (u.kind === "heading" ? 12 : u.kind === "fence" ? 24 : 4);
  }

  hashOf(s: string): string {
    let h = this.hashes.get(s);

    if (h === undefined) {
      if (this.hashes.size > 4 * this.all.length + 64) this.hashes.clear();

      h = hash(s);
      this.hashes.set(s, h);
    }

    return h;
  }

  /** The units with the lit one in its place, each with a key (its kind and text: the
   *  same wherever it moves) and its gap above. */
  rows(): Row[] {
    const out: Row[] = [];
    let lit = false;
    let prev: Unit | null = null;
    const seen = new Map<string, number>();

    const push = (u: Unit, isLit: boolean): void => {
      const base = isLit ? "lit" : `${u.kind}-${this.hashOf(this.src(u))}`;
      const n = seen.get(base) ?? 0;

      seen.set(base, n + 1);

      const gap = !prev ? 0 : prev.kind === "item" && u.kind === "item" ? TIGHT : GAP;

      out.push({ u, lit: isLit, key: n ? `${base}-${n}` : base, gap });
      prev = u;
    };

    for (const u of this.units) {
      if (!lit && u.from > this.range.to) {
        push(this.unit, true);
        lit = true;
      }

      push(u, false);
    }

    if (!lit) push(this.unit, true);

    return out;
  }

  /** The view: `o` { t, focused, empty: { title, detail } (an empty scratchpad), onTask(line, cx), maxWidth, unzoom(px) }. */
  view(o: ViewOptions): Element {
    const { t } = o;
    const rows = this.rows();
    const tops: number[] = [];
    let y = PAD_TOP;
    // The row's height as drawn (the lit one's, or its own).
    const rowH = (r: Row): number => (r.lit ? this.litHeight() : this.height(r.key, r.u));
    const topOf = (i: number): number => tops[i] ?? 0;

    for (const r of rows) {
      y += r.gap;
      tops.push(y);
      y += rowH(r);
    }

    const total = y + ADD_H + PAD_BOTTOM;
    const li = rows.findIndex((r) => r.lit);

    if (this.reveal && li >= 0) {
      // The lit block in view, with room around it.
      const top = topOf(li);
      const bottom = top + this.litHeight();

      if (top - 24 < this.scrollY) this.scrollY = Math.max(0, top - 24);
      else if (bottom + 24 > this.scrollY + this.viewH) this.scrollY = Math.max(0, bottom + 24 - this.viewH);

      this.reveal = false;
    }

    this.scrollY = Math.max(0, Math.min(this.scrollY, Math.max(0, total - this.viewH)));
    this.litTop = li >= 0 ? topOf(li) - this.scrollY : 0;

    const lo = this.scrollY - this.viewH * OVERDRAW;
    const hi = this.scrollY + this.viewH * (1 + OVERDRAW);
    const shown = rows.flatMap((r, i) => (r.lit || (topOf(i) + this.height(r.key, r.u) >= lo && topOf(i) <= hi) ? [i] : []));
    const firstShown = shown[0];
    const first = firstShown === undefined ? 0 : topOf(firstShown) - (rows[firstShown]?.gap ?? 0);
    const max = Math.max(1, total - this.viewH);
    const frac = Math.min(1, this.viewH / Math.max(1, total));
    let last: number | null = null;
    const kids: Element[] = [];

    for (const i of shown) {
      const r = rows[i];

      if (!r) continue;

      // A gap where unshown rows sit between two shown ones.
      const before = last === null ? undefined : rows[last];

      if (last !== null && before && i !== last + 1) kids.push(div().h(topOf(i) - r.gap - (topOf(last) + rowH(before))).flex_none());

      kids.push(div().flex_none().h(r.gap));
      kids.push(r.lit ? this.litView(o) : this.unitView(r, o));
      last = i;
    }

    const lastUnit = rows.at(-1)?.u ?? null;
    const empty = o.empty;

    return div()
      .id("editor-rendered")
      .relative()
      .flex_1()
      .min_h(0)
      .min_w(0)
      .overflow_hidden()
      .bg(t.background)
      .on_size_change((size, cx) => {
        const h = o.unzoom(size.height);

        if (Math.abs(h - this.viewH) > 1) {
          this.viewH = h;
          this.host.notify(cx);
        }
      })
      .on_scroll_wheel((e, cx) => {
        this.scrollY = Math.max(0, Math.min(Math.max(0, total - this.viewH), this.scrollY - o.unzoom(e.delta.y)));
        this.host.notify(cx);
      })
      .child(
        h_flex()
          .absolute()
          .left(0)
          .right(0)
          .top(first - this.scrollY)
          .justify_center()
          .child(
            v_flex()
              .w_full()
              .max_w(o.maxWidth ?? 760)
              .px(28)
              .when(Boolean(empty), (el) => (empty ? el.child(this.emptyView(t, empty)) : el))
              .children(kids)
              // Under the last block (not under an empty one that offers its kinds already).
              .when(!(lastUnit?.kind === "blank" && this.offersKinds()) && (!shown.length || shown.at(-1) === rows.length - 1), (el) => el.child(this.addView(o, lastUnit))),
          ),
      )
      .when(frac < 1, (el) =>
        el.child(
          div()
            .absolute()
            .right(1)
            .w(3)
            .top(Math.round((this.scrollY / max) * this.viewH * (1 - frac)))
            .h(Math.max(16, Math.round(this.viewH * frac)))
            .child(this.host.dither(o.focused ? t.accent : t.ansi8)),
        ),
      );
  }

  /** The lit block's height: its editor's content as measured, or (grown since) as its lines would wrap;
   *  an empty block has its kinds under it. */
  litHeight(): number {
    // Measured: that height, grown by the rows the text has gained since (never shrunk to an
    // estimate, so it doesn't jump between the two on a key). Not yet: the estimate, a little
    // slack in it (a box a little short lets the editor scroll inside it).
    const rows = wrappedRows(this.piece, this.litW, this.cw);

    const h =
      this.blockH === null
        ? rows * this.rowH + 6
        : this.blockHFor === this.piece
          ? this.blockH
          : this.blockH + Math.max(0, rows - wrappedRows(this.blockHFor ?? "", this.litW, this.cw)) * this.rowH;

    return Math.min(h, Math.max(ROW * 3, this.viewH - 60)) + 10 + (this.offersKinds() ? KINDS_H : 0);
  }

  /** Measures the block editor again a moment after a change (once it's drawn). */
  measureSoon(cx: Context | null | undefined): void {
    cx?.timer.after(30, (cx) => this.measure(cx));
  }

  /** Measures the block editor's content from where it drew its last line; its row and character size too. */
  measure(cx: Context): void {
    const lines = this.piece.split("\n");
    const last = lines.length - 1;
    const first = lines[0] ?? "";
    const b = this.block.bounds({ line: last, col: (lines[last] ?? "").length });

    if (!b?.view) return;

    const z = this.host.zoom();

    if (b.height > 4) this.rowH = b.height / z;

    const a0 = this.block.bounds({ line: 0, col: 0 });
    const a1 = first.length ? this.block.bounds({ line: 0, col: 1 }) : null;

    if (a0 && a1 && a1.y === a0.y && a1.x > a0.x) this.cw = (a1.x - a0.x) / z;

    const h = (b.y + b.height - b.view.y) / z + 2;
    const changed = h > 4 && Math.abs((this.blockH ?? -1) - h) > 1;

    if (h > 4) {
      this.blockH = h;
      this.blockHFor = this.piece;
    }

    if (changed) this.host.notify(cx);
  }

  litView(o: ViewOptions): Element {
    const { t } = o;
    const h = this.litHeight();
    const empty = this.offersKinds();

    return div()
      .id("rendered-lit")
      .relative()
      .flex_none()
      .h(h)
      .ml(-12)
      .mr(-12)
      .pl(12)
      .pr(92)
      .py(5)
      .child(div().absolute().inset_0().opacity(0.22).child(this.host.dither(t.ansi0)))
      .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent))
      .child(div().absolute().right(8).top(5).text_size(10.5).text_color(t.dim).child(kindWord(this.unit)))
      .child(
        v_flex()
          .relative()
          .size_full()
          .child(
            div()
              .id("rendered-lit-box")
              .relative()
              .flex_1()
              .min_h(0)
              .w_full()
              .on_size_change((s, cx) => {
                this.litW = o.unzoom(s.width);
                cx.timer.after(0, (cx) => this.measure(cx));
              })
              .child(Editor.new(this.block).size_full().font_family(this.host.font)),
          )
          .when(empty, (el) => el.child(this.kindsView(o))),
      );
  }

  /** An empty block's kinds: a click runs one; cmd-. (vim: space .) and its letter do too. */
  kindsView(o: ViewOptions): Element {
    const { t } = o;
    const lead = this.host.vim?.() ? "space ." : "cmd-.";

    return h_flex()
      .id("rendered-kinds")
      .h(KINDS_H)
      .flex_none()
      .gap(4)
      .items_center()
      .text_size(11)
      .child(div().flex_none().pr(4).text_color(t.dim).child("make it"))
      .children(
        KINDS.map(([name, word, letter]) =>
          h_flex()
            .id(`rendered-kind-${name}`)
            .relative()
            .flex_none()
            .h(18)
            .px(6)
            .gap(5)
            .items_center()
            .border(1)
            .border_color(t.ansi0)
            .text_color(t.muted)
            .cursor_pointer()
            .hover((s) => s.border_color(t.accent).text_color(t.foreground))
            .tooltip(`${lead} ${letter}`)
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.host.mdRun?.(name, cx);
            })
            .child(div().relative().child(word))
            .child(div().relative().text_size(10).text_color(t.dim).child(letter)),
        ),
      )
      .child(div().flex_1())
      .child(div().flex_none().text_color(t.dim).child(`${lead} more`));
  }

  /** The line under the last block: "add a block" (an empty paragraph after it). */
  addView(o: ViewOptions, after: Unit | null): Element {
    const { t } = o;

    return h_flex()
      .id("rendered-add")
      .relative()
      .h(ADD_H)
      .mt(GAP)
      .ml(-22)
      .flex_none()
      .gap(8)
      .items_center()
      .cursor_pointer()
      .text_color(t.dim)
      .hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.addAfter(after, cx);
      })
      .child(div().relative().size(14).flex_none().border(1).border_color(t.ansi8).flex().items_center().justify_center().child(svg(PLUS).size(10).text_color(t.accent)))
      .child(div().flex_none().text_size(11.5).child("add a block"))
      .child(div().relative().flex_1().h(1).opacity(0.5).child(this.host.dither(t.ansi8)))
      .child(div().flex_none().text_size(10.5).child("or enter at a block's end"));
  }

  emptyView(t: Theme, empty: NonNullable<ViewOptions["empty"]>): Element {
    return v_flex()
      .id("rendered-empty")
      .items_center()
      .gap(8)
      .pt(30)
      .pb(22)
      .text_center()
      .child(div().relative().size(44).opacity(0.55).child(this.host.moon?.(t) ?? div()))
      .child(div().text_color(t.foreground).text_size(12).child(empty.title))
      .child(div().text_color(t.muted).child(empty.detail))
      .child(div().text_color(t.dim).child(empty.hint ?? ""));
  }

  /** An image block: each picture fits the column and keeps its shape (drawn from its cached
   *  copy: decoded once, not per key); one on the web is drawn by the Markdown view; one that
   *  can't be found says so. */
  imagesView(u: Extract<Unit, { kind: "image" }>, id: string, o: ViewOptions, md: (key: string, text: string) => Element): Element {
    const { t } = o;

    return v_flex()
      .gap(8)
      .children(
        u.images.map((im, j) => {
          const got = this.host.image?.(im.src) ?? { abs: null, name: null };

          if (got.name) {
            return div().id(`${id}-img-${j}`).flex().child(image(got.name).id(`${id}-pic-${j}`).max_w_full().max_h(IMAGE_H));
          }

          if (!got.abs) return md(`${id}-web-${j}`, `![${im.alt}](${im.src})`);

          const missing = got.name === null;
          const color = missing ? t.ansi1 : t.dim;

          return h_flex()
            .id(`${id}-img-${j}`)
            .relative()
            .h(56)
            .px(14)
            .gap(10)
            .items_center()
            .child(div().absolute().inset_0().opacity(0.12).child(this.host.dither(color)))
            .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(color))
            .child(div().relative().size(10).flex_none().border(1).border_color(color))
            .child(
              v_flex()
                .relative()
                .min_w(0)
                .child(div().text_color(missing ? t.ansi1 : t.muted).child(missing ? "picture not found" : "loading the picture…"))
                .child(div().truncate().text_size(11).text_color(t.dim).child(im.src)),
            );
        }),
      );
  }

  /** The reference definitions of the text, for a unit drawn alone (so [text][ref] resolves); once per text. */
  refsOf(): string {
    this.refsText ??= this.all
      .flatMap((u) => {
        const r = u.kind === "ref" ? this.src(u) : null;

        return r === null || /^\s*\[\^/.test(r) ? [] : [r];
      })
      .join("\n");

    return this.refsText;
  }

  unitView(r: Row, o: ViewOptions): Element {
    const { t } = o;
    const u = r.u;
    const id = `rd-${r.key}`;
    const size = 13;
    const md = (key: string, text: string): Element => markdown(t, key, text, { onLink: (url, cx) => this.host.link(url, cx), size });

    const withRefs = (text: string): string => {
      const rf = this.refsOf();

      return rf ? `${text}\n\n${rf}` : text;
    };

    const src = this.src(u);
    const local = { from: 0, to: u.to - u.from };
    let body: Element;

    if (u.kind === "item") {
      const p = itemParts(src, local);

      const mark = u.task
        ? div()
            .id(`${id}-box`)
            .relative()
            .size(12)
            .mt(4)
            .flex_none()
            .border(1)
            .border_color(u.checked ? t.accent : t.ansi8)
            .cursor_pointer()
            .hover((s) => s.border_color(t.foreground))
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => {
              cx.stop_propagation();
              o.onTask(u.from, cx);
            })
            .when(u.checked, (el) => el.child(div().absolute().top(2).left(2).right(2).bottom(2).child(this.host.dither(t.accent))))
        : div()
            .w(18)
            .flex_none()
            .text_color(t.dim)
            .child(/^\d/.test(p.marker) ? p.marker : "•");

      body = h_flex()
        .gap(8)
        .items_start()
        .pl(u.indent * 7)
        .child(mark)
        .child(
          div()
            .flex_1()
            .min_w(0)
            .when(u.checked, (el) => el.opacity(0.6))
            .child(md(`${id}-md`, withRefs(imagesAsLinks(p.body)) || " ")),
        );
    } else if (u.kind === "quote" && u.callout) {
      const lines = quoteBody(src, local).split("\n");
      const head = /^\[![A-Za-z-]+\][+-]?\s*(.*)$/.exec(lines[0] ?? "");
      const [ck, name] = CALLOUTS.get(u.callout) ?? ["ansi4", u.callout];
      const color = t[ck];
      const rest = lines.slice(1).join("\n");

      body = v_flex()
        .relative()
        .pl(14)
        .pr(12)
        .py(8)
        .gap(4)
        .child(div().absolute().inset_0().opacity(0.14).child(this.host.dither(color)))
        .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(color))
        .child(
          h_flex()
            .relative()
            .gap(8)
            .items_center()
            .child(div().relative().size(8).flex_none().border(1).border_color(color).child(this.host.dither(color)))
            .child(
              div()
                .text_size(size - 1)
                .text_color(color)
                .child(head?.[1] || name),
            ),
        )
        .when(Boolean(rest.trim()), (el) => el.child(div().relative().child(md(`${id}-md`, withRefs(rest)))));
    } else if (u.kind === "image") {
      body = this.imagesView(u, id, o, md);
    } else if (u.kind === "rule") {
      body = div().relative().h(13).flex().items_center().child(div().relative().w_full().h(1).opacity(0.6).child(this.host.dither(t.ansi8)));
    } else if (u.kind === "ref") {
      body = div().text_color(t.dim).font_family(this.host.font).text_size(11.5).child(src);
    } else if (u.kind === "front") {
      body = md(
        `${id}-md`,
        fenced(src.split("\n").slice(1, -1).join("\n")).replace(/^`+/, (m) => m + "yaml"),
      );
    } else {
      body = md(`${id}-md`, u.kind === "fence" ? src : withRefs(imagesAsLinks(src)));
    }

    const hovered = this.hover === r.key;

    return div()
      .id(id)
      .relative()
      .flex_none()
      .on_size_change((box, cx) => {
        const h = o.unzoom(box.height);
        const was = this.heights.get(r.key);

        if (was === undefined || Math.abs(was - h) > 1) {
          this.heights.set(r.key, h);
          this.host.notify(cx);
        }
      })
      .on_hover((on, cx) => {
        const next = on ? r.key : this.hover === r.key ? null : this.hover;

        if (next !== this.hover) {
          this.hover = next;
          this.host.notify(cx);
        }
      })
      .cursor_text()
      .on_click((_e, cx) => this.clickUnit(u, cx, false))
      .child(body)
      // Its "+": an empty paragraph after it (shown while the pointer is over it).
      .when(hovered, (el) =>
        el.child(
          div()
            .id(`${id}-add`)
            .absolute()
            .left(-24)
            .top(1)
            .size(16)
            .flex()
            .items_center()
            .justify_center()
            .border(1)
            .border_color(t.ansi8)
            .bg(t.background)
            .cursor_pointer()
            .hover((s) => s.border_color(t.accent))
            .tooltip("add a block after this one")
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.hover = null;
              this.addAfter(u, cx);
            })
            .child(svg(PLUS).size(10).text_color(t.accent)),
        ),
      );
  }
}

/** A short hash of a string (FNV-1a), for unit keys. */
function hash(s: string): string {
  let h = 0x811c9dc5;

  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }

  return (h >>> 0).toString(36);
}
