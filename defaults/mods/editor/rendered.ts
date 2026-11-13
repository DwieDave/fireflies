// The rendered view of a Markdown tab (main.ts view "rendered"): the document
// drawn as its units (live.ts), the one the caret is in lit up as its own
// Markdown in a second code editor (the "block editor") that holds just those
// lines. The file's own editor keeps the whole text: every keystroke in the
// block is written into it as one edit of those lines, so saving, undo, the
// unsaved mark and the language server work as in the text view, and what
// isn't edited stays byte for byte. Edits made to the file's editor from
// elsewhere (vim, the Markdown commands, undo, a reload) come back into the
// block (pull). This file keeps that state and the syncing; the column and
// the lit block's box are rendered-column.ts's, the drawn units
// rendered-units.ts's, the keys and adding blocks rendered-keys.ts's.
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
// last line of any other block (on any line of a paragraph) starts a new
// paragraph below it (the text after the caret goes with it; shift-enter: a
// line break inside the block; on an empty new block it stays as it is);
// with vim in normal mode, enter makes the new block below the lit one and
// types into it (main.ts vimKey);
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
import type { EditorPosition, EditorState as EditorStateT } from "gpui-base";
import { EditorState } from "gpui-base";
import type { Theme } from "herdr";
import type { Range, Unit } from "./live.ts";
import { units, unitFor, splice } from "./live.ts";
import type { SyntaxColors } from "./logic.ts";
import type { Sel } from "./md-text.ts";
import { editBetween } from "./md-text.ts";
import { columnView, litHeight, measureBlock, CHAR, ROW } from "./rendered-column.ts";
import { blockKey, clickUnit, enterBelow } from "./rendered-keys.ts";
import { GAP } from "./rendered-units.ts";

type Pos = EditorPosition;

const TIGHT = 3; // between units; between two list items

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
export interface Row {
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
    this.block.on("key", (e, cx) => blockKey(this, e, cx));
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

  // ---- keys (rendered-keys.ts)

  /** Whether the lit block offers the kinds: an empty one made here (enter, a +), or an empty
   *  document; not a blank line vim's j passes over (the layout stays still there). */
  offersKinds(): boolean {
    return this.unit.kind === "blank" && (this.made === this.range.from || !this.all.length);
  }

  localSel(): Sel {
    return this.block.selection();
  }

  /** Vim's enter in normal mode: a new block below (rendered-keys.ts enterBelow). */
  enterBelow(cx: Context): boolean {
    return enterBelow(this, cx);
  }

  /** A click on a drawn unit: it lights up (rendered-keys.ts clickUnit). */
  clickUnit(clicked: Unit, cx: Context, end = false): void {
    clickUnit(this, clicked, cx, end);
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

  /** The view: `o` { t, focused, empty: { title, detail } (an empty scratchpad), onTask(line, cx),
   *  maxWidth, unzoom(px) } (rendered-column.ts). */
  view(o: ViewOptions): Element {
    return columnView(this, o);
  }

  /** The lit block's height (rendered-column.ts). */
  litHeight(): number {
    return litHeight(this);
  }

  /** Measures the block editor's content (rendered-column.ts). */
  measure(cx: Context): void {
    measureBlock(this, cx);
  }

  /** Measures the block editor again a moment after a change (once it's drawn). */
  measureSoon(cx: Context | null | undefined): void {
    cx?.timer.after(30, (cx) => this.measure(cx));
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
