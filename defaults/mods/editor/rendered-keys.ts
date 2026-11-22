// Keys in the rendered view's lit block (rendered.ts hands them here) and
// adding blocks. The note reads as one document: the caret moves through
// blocks as through lines.
//
// - up / down past the block's first or last drawn row step into the block
//   before or after, onto its nearest row (the last one going up, the first
//   going down), at the same place in the text: the column on the row, the
//   blocks' marks (a heading's #, a task's box) taken off, so a caret in a
//   word lands in the word below, not in its box;
// - left at the block's start goes to the end of the block before, right at
//   its end to the start of the text of the one after;
// - enter continues a list, task or quote (mdedit.ts enter; on an empty item
//   at the list's end, the list ends and a new block starts under it), at the
//   very start of a block opens a new empty block above it (the caret in
//   it), else makes a new paragraph below (a paragraph splits at the caret;
//   vim's normal mode: enterBelow);
// - backspace at the start of a block's text takes its mark off (a heading,
//   item, task or quote becomes text); before its mark, at its very start,
//   it joins the block's text to the one before (its first line onto that
//   block's last, the mark and the blank lines between gone; a code block,
//   table or picture isn't joined: the caret goes to its end); in an empty
//   block it removes the block, the caret at the end of the one before;
//   delete at a block's end joins the next one's text on;
// - an empty block made here (enter, a "+", "add a block") that the caret
//   leaves without a key typed in it goes again, the lines it added with it:
//   the note's bytes are as they were (no blank lines piling up);
// - undo and redo are the file's; a click lights a unit up with the caret
//   about where the pointer pressed it.

import type { Context, KeyEvent } from "gpui-kit";
import type { EditorPosition } from "gpui-base";
import type { Range, Unit } from "./live.ts";
import { leadAt, leadOf, neighbor, rowAt, rowStarts, unitFor } from "./live.ts";
import { enter } from "./mdedit.ts";
import { caretTo, editBetween } from "./md-text.ts";
import type { Rendered } from "./rendered.ts";

type Pos = EditorPosition;

/** Kinds whose last line takes the next block's first on a join. */
const JOINS = new Set<Unit["kind"]>(["para", "heading", "item", "quote"]);

const samePos = (a: Pos, b: Pos): boolean => a.line === b.line && a.col === b.col;

/** A key in the block, before the block editor: -> true when taken. */
export function blockKey(v: Rendered, e: KeyEvent, cx: Context): boolean {
  v.syncCaret();

  if (v.host.onKey(e, cx)) return true;

  const k = e.key;
  const m = e.modifiers;
  const plain = !m.platform && !m.control && !m.alt && !m.shift;

  if (m.platform && !m.alt && !m.control && k === "z") {
    if (m.shift) v.doc.editor.redo();
    else v.doc.editor.undo();

    return true;
  }

  if (!plain) return false;

  if (k === "up" || k === "down") return edge(v, k === "up" ? -1 : 1, cx);

  if (k === "left" || k === "right") return side(v, k === "left" ? -1 : 1, cx);

  if (k === "enter") return enterKey(v, cx);

  if (k === "backspace") return backKey(v, cx);

  if (k === "delete") return deleteKey(v, cx);

  return false;
}

/** The block's caret when there's no selection, else null. */
function caretOnly(v: Rendered): Pos | null {
  const s = v.localSel();

  return samePos(s.start, s.end) ? s.start : null;
}

/** The units around the lit lines, cut again if the lit block was typed into. */
function fresh(v: Rendered, cx: Context | null | undefined): void {
  if (v.stale) v.recut(cx);

  v.units = v.all.filter((u) => u.to < v.range.from || u.from > v.range.to);
}

/** The lit lines grown to the whole units they touch (typed into, they may have become part of
 *  the unit before: a task's box taken off makes its line more of the task above). */
function around(v: Rendered): Range {
  let { from, to } = v.range;

  for (const u of v.all) {
    if (u.to < from || u.from > to) continue;

    from = Math.min(from, u.from);
    to = Math.max(to, u.to);
  }

  return { from, to };
}

/** The nearest line above (-1) or below (1) the lit lines with something on it, or null. */
function filledLine(v: Rendered, dir: number): number | null {
  const ls = v.lines();

  for (let l = dir < 0 ? v.range.from - 1 : v.range.to + 1; l >= 0 && l < ls.length; l += dir) if (ls[l]?.trim()) return l;

  return null;
}

/** The file's line end. */
const eolOf = (v: Rendered): string => (/\r\n/.test(v.text ?? "") ? "\r\n" : "\n");

/** Lights the unit at file line `line`, the caret at `col`. */
function goTo(v: Rendered, line: number, col: number, cx: Context): void {
  caretTo(v.doc.editor, line, col);
  v.light(unitFor(v.all, line));
  v.mirror();
  v.measureSoon(cx);
  v.host.notify(cx);
}

/** An edit of the file made here, the view brought up to it without lighting from the change event. */
function editFile(v: Rendered, start: Pos, end: Pos, text: string, cx: Context | null | undefined): void {
  v.pushing = true;

  try {
    v.doc.editor.edit([{ start, end, text }]);
  } finally {
    v.pushing = false;
  }

  v.setText(v.fileText());
  v.recut(cx);
}

/** An empty block made here that the caret leaves untouched: the lines it added go (the note
 *  as it was). -> the lines removed, null when there were none. */
export function dropMade(v: Rendered, cx: Context | null | undefined): Range | null {
  const span = v.madeSpan;
  const at = v.made;

  v.madeSpan = null;

  if (!span || at === null || at < span.from || at > span.to) return null;

  v.setText(v.fileText());

  const ls = v.lines();

  if (span.to >= ls.length || ls.slice(span.from, span.to + 1).some((l) => l.trim())) return null;

  v.made = null;

  if (span.to + 1 < ls.length) editFile(v, { line: span.from, col: 0 }, { line: span.to + 1, col: 0 }, "", cx);
  else if (span.from > 0) editFile(v, { line: span.from - 1, col: (ls[span.from - 1] ?? "").length }, { line: span.to, col: (ls[span.to] ?? "").length }, "", cx);
  else editFile(v, { line: 0, col: 0 }, { line: span.to, col: (ls[span.to] ?? "").length }, "", cx);

  return span;
}

/** A line's number after `span` was removed. */
const shifted = (line: number, span: Range | null): number => (span && line > span.to ? line - (span.to - span.from + 1) : line);

/** Into the unit before (-1) or after (1), the caret where `place` puts it there; an untouched
 *  new block goes first. False at the document's ends (the block editor's own key then). */
function leave(v: Rendered, dir: number, place: (u: Unit, dir: number, ls: readonly string[]) => Pos, cx: Context): boolean {
  const span = dropMade(v, cx);

  fresh(v, cx);

  // The new block is gone: its neighbours are the units around where it stood.
  const range: Range = span ? { from: span.from, to: span.from - 1 } : around(v);
  const list = v.all.filter((u) => u.to < range.from || u.from > range.to);
  let d = dir;
  let u = neighbor(list, range, d);

  if (!u && span) {
    d = -dir;
    u = neighbor(list, range, d);
  }

  if (!u) {
    if (span) goTo(v, Math.min(span.from, Math.max(0, v.lines().length - 1)), 0, cx);

    return Boolean(span);
  }

  const p = place(u, d, v.lines());

  goTo(v, p.line, p.col, cx);

  return true;
}

// ---- up and down

/** Where the caret is drawn: its column on its row, and the mark's width when that row is
 *  the line's first (the column then counts from the line's start, mark and all). */
interface Seen {
  readonly vc: number;
  readonly lead: number;
}

/** How many characters a row of the lit block holds. */
const colsOf = (v: Rendered): number => Math.max(8, Math.floor((v.litW - 4) / v.cw));

/** The caret's place on its drawn row: from where the editor drew it when it has, else as its
 *  line would wrap. */
function seen(v: Rendered, c: Pos): Seen {
  const text = v.piece.split("\n")[c.line] ?? "";
  const starts = rowStarts(text, colsOf(v));
  const k = rowAt(starts, c.col);
  let vc = c.col - (starts[k] ?? 0);
  let first = k === 0;
  const a = v.block.bounds({ line: c.line, col: 0 });
  const b = v.block.bounds(c);
  const z = v.host.zoom() || 1;

  if (a && b && v.cw > 0) {
    vc = Math.max(0, Math.round((b.x - a.x) / z / v.cw));
    first = Math.abs(a.y - b.y) < 2;
  }

  return { vc, lead: first ? leadAt(v.unit, v.range.from + c.line, text) : 0 };
}

/** The column on file line `line` of `u` that is the same place in the text as `s`: on its
 *  last row going up (-1), its first going down (1). */
function landing(u: Unit, line: number, text: string, dir: number, s: Seen, cols: number): number {
  const starts = rowStarts(text, cols);
  const k = dir < 0 ? starts.length - 1 : 0;
  const rs = starts[k] ?? 0;
  const end = k + 1 < starts.length ? (starts[k + 1] ?? text.length) - 1 : text.length;
  const lead = k === 0 ? leadAt(u, line, text) : 0;
  const into = s.vc - s.lead;
  const col = into < 0 ? rs + s.vc : rs + lead + into;

  return Math.max(rs, Math.min(end, col));
}

/** Up / down: within the block unless the caret is on its first / last row, else into the next unit. */
function edge(v: Rendered, dir: number, cx: Context): boolean {
  const c = v.block.cursor();
  const lines = v.piece.split("\n");
  const lastLine = lines.length - 1;
  const onEdge = dir < 0 ? c.line === 0 && firstRow(v, c) : c.line === lastLine && lastRow(v, c, lines);

  if (!onEdge) return false;

  const s = seen(v, c);
  const cols = colsOf(v);

  return leave(
    v,
    dir,
    (u, d, ls) => {
      const line = d < 0 ? u.to : u.from;

      return { line, col: landing(u, line, ls[line] ?? "", d, s, cols) };
    },
    cx,
  );
}

/** Whether the caret is on the first drawn row of the block's first line (a soft-wrapped line has more). */
function firstRow(v: Rendered, c: Pos): boolean {
  const a = v.block.bounds({ line: 0, col: 0 });
  const b = v.block.bounds(c);

  if (a && b) return Math.abs(a.y - b.y) < 2;

  return rowAt(rowStarts(v.piece.split("\n")[0] ?? "", colsOf(v)), c.col) === 0;
}

function lastRow(v: Rendered, c: Pos, lines: readonly string[]): boolean {
  const last = lines.length - 1;
  const a = v.block.bounds({ line: last, col: (lines[last] ?? "").length });
  const b = v.block.bounds(c);

  if (a && b) return Math.abs(a.y - b.y) < 2;

  const starts = rowStarts(lines[last] ?? "", colsOf(v));

  return rowAt(starts, c.col) === starts.length - 1;
}

// ---- left and right

/** Left at the block's start: the end of the block before; right at its end: the start of the
 *  text of the block after. */
function side(v: Rendered, dir: number, cx: Context): boolean {
  const c = caretOnly(v);

  if (!c) return false;

  const lines = v.piece.split("\n");
  const last = lines.length - 1;
  const atEdge = dir < 0 ? c.line === 0 && c.col === 0 : c.line === last && c.col >= (lines[last] ?? "").length;

  if (!atEdge) return false;

  return leave(v, dir, (u, d, ls) => (d < 0 ? { line: u.to, col: (ls[u.to] ?? "").length } : { line: u.from, col: leadAt(u, u.from, ls[u.from]) }), cx);
}

// ---- enter

/** Enter: a list item, task or quote goes on (mdedit.ts); at a block's very start a new block
 *  above it; on the last line of any other block, a new paragraph below. */
function enterKey(v: Rendered, cx: Context): boolean {
  const c = caretOnly(v);

  // An empty item at the list's end: the list ends, a new block under it.
  if (c && endsList(v, c)) {
    endList(v, c, cx);

    return true;
  }

  const sel = v.localSel();
  const r = enter(v.piece, sel);

  if (r) {
    const e = editBetween(v.block.value(), r.text);

    if (e) v.block.edit([e]);

    v.block.set_cursor(r.sel.start.line, r.sel.start.col);
    v.push(cx); // the edit's own change event comes after: the file has it now

    return true;
  }

  if (!c) return false;

  const ls = v.piece.split("\n");
  const last = ls.length - 1;
  const lastText = ls[last] ?? "";

  // An empty block made here is the new block already: enter keeps it (no blank lines piling up).
  if (v.offersKinds()) return true;

  // At the block's very start: a new block above it, the caret in it (nothing moves from under it).
  if (c.line === 0 && c.col === 0 && v.piece.trim() && v.unit.kind !== "front") {
    openAbove(v, cx);

    return true;
  }

  // A paragraph splits at the caret on any of its lines (the lines after go with the rest).
  if (v.unit.kind === "para" && c.line < last) {
    splitAt(v, v.range.from + c.line, c.col, cx, false);

    return true;
  }

  if (c.line !== last || v.unit.kind === "blank" || v.unit.kind === "front") return false;

  // Inside a code block, enter is a new line (its closing line's end makes a block).
  if (v.unit.kind === "fence" && !(c.col >= lastText.length && last > 0)) return false;

  if ((v.unit.kind === "item" || v.unit.kind === "quote") && c.col < lastText.length) return false;

  splitAt(v, v.range.to, c.col, cx);

  return true;
}

/** Whether the caret is on an empty list item (its marker only) that ends its list. */
function endsList(v: Rendered, c: Pos): boolean {
  if (v.unit.kind !== "item") return false;

  const line = v.piece.split("\n")[c.line] ?? "";
  const lead = leadOf(line);

  if (!lead || c.col < lead || line.slice(lead).trim() || c.line !== v.range.to - v.range.from) return false;

  const next = v.lines()[v.range.to + 1];

  return next === undefined || !next.trim();
}

/** The list ends at its empty last item: the marker goes, an empty block in its place (a blank
 *  line before it when the list is right above, so what's typed isn't more of its last item). */
function endList(v: Rendered, c: Pos, cx: Context): void {
  const line = v.range.from + c.line;
  const ls = v.lines();
  const glue = line > 0 && Boolean(ls[line - 1]?.trim());
  const nl = eolOf(v);

  v.doc.editor.edit([{ start: { line, col: 0 }, end: { line, col: (ls[line] ?? "").length }, text: glue ? nl : "" }]);

  const made = glue ? line + 1 : line;

  caretTo(v.doc.editor, made, 0);
  v.made = made;
  v.pull(cx);
  v.madeSpan = { from: line, to: made };
  v.block.focus();
}

/** A new empty block above the lit one, the caret in it. */
function openAbove(v: Rendered, cx: Context): void {
  const at = v.range.from;
  const ls = v.lines();
  const nl = eolOf(v);
  // A blank line before it too when a block ends right above (else it'd be more of that one).
  const glue = at > 0 && Boolean(ls[at - 1]?.trim());

  v.doc.editor.edit([{ start: { line: at, col: 0 }, end: { line: at, col: 0 }, text: glue ? nl + nl + nl : nl + nl }]);

  const made = glue ? at + 1 : at;

  caretTo(v.doc.editor, made, 0);
  v.made = made;
  v.pull(cx);
  v.madeSpan = { from: at, to: at + (glue ? 2 : 1) };
  v.block.focus();
}

/** Vim's enter in normal mode (nothing pending): a new block below the lit one, as enter at
 *  its end does, vim in insert mode in it (an empty block made here: insert mode in it). The
 *  caller has put vim in insert mode; -> false when it's no block enter makes one after. */
export function enterBelow(v: Rendered, cx: Context): boolean {
  const ls = v.piece.split("\n");
  const last = ls.length - 1;

  v.block.set_cursor(last, (ls[last] ?? "").length);
  v.syncCaret(true);

  return enterKey(v, cx) || v.offersKinds();
}

/** A new paragraph after file line `line`, from column `col` (the rest of the line goes into
 *  it). `glue`: a blank line after it too when a block follows straight on (false: the caret's
 *  inside a paragraph, its lines after go with the rest). */
export function splitAt(v: Rendered, line: number, col: number, cx: Context, glue = true): void {
  const ls = v.lines();
  const nl = eolOf(v);
  const rest = (ls[line] ?? "").slice(col);
  const next = ls[line + 1];
  // A blank line between, and one after it when something follows straight on.
  const tail = glue && next?.trim() ? nl : "";

  // At a paragraph line's end: its next line starts the new paragraph (no empty first line).
  const end = !glue && !rest ? { line: line + 1, col: 0 } : { line, col: (ls[line] ?? "").length };

  v.doc.editor.edit([{ start: { line, col }, end, text: nl + nl + rest + tail }]);
  caretTo(v.doc.editor, line + 2, 0);
  v.made = line + 2;
  v.pull(cx);

  // An empty new block: the lines it added, to take away again if it's left untouched.
  if (glue && !rest) v.madeSpan = { from: line + 1, to: line + 2 + (tail ? 1 : 0) };

  v.block.focus();
}

/** An empty paragraph after unit `u` (the "+" beside it, "add a block" under the last), lit, the caret in it. */
export function addAfter(v: Rendered, u: Unit | null, cx: Context): void {
  const span = dropMade(v, cx);

  if (!u) {
    // An empty document: its first line.
    caretTo(v.doc.editor, 0, 0);
    v.made = 0;
    v.pull(cx);
    v.block.focus();

    return;
  }

  if (v.stale) v.recut(cx);

  const ls = v.lines();
  const at = Math.min(shifted(u.to, span), ls.length - 1);

  splitAt(v, at, (ls[at] ?? "").length, cx);
}

// ---- backspace and delete

/** Backspace at the block's start: its mark off, else joined to the block before; an empty block goes. */
function backKey(v: Rendered, cx: Context): boolean {
  const c = caretOnly(v);

  if (!c || c.line !== 0) return false;

  if (!v.piece.trim()) return dropEmpty(v, -1, cx);

  const first = v.piece.split("\n")[0] ?? "";
  const lead = leadAt(v.unit, v.range.from, first);

  if (lead > 0 && c.col > 0 && c.col <= lead) {
    // The mark goes: a heading, item, task or quote becomes text.
    v.block.edit([{ start: { line: 0, col: 0 }, end: { line: 0, col: lead }, text: "" }]);
    v.block.set_cursor(0, 0);
    v.push(cx);

    return true;
  }

  if (c.col !== 0) return false;

  fresh(v, cx);

  const line = filledLine(v, -1);

  if (line === null) return true;

  const prev = unitFor(v.all, line);
  const end = { line, col: (v.lines()[line] ?? "").length };

  // A code block, a table, a picture: the caret goes to its end, nothing joins.
  if (!JOINS.has(prev.kind) || !JOINS.has(v.unit.kind)) {
    goTo(v, end.line, end.col, cx);

    return true;
  }

  // Its text joins on, its mark off (as delete at the end of the block before does).
  v.doc.editor.edit([{ start: end, end: { line: v.range.from, col: lead }, text: "" }]);
  caretTo(v.doc.editor, end.line, end.col);
  v.pull(cx);

  return true;
}

/** Delete at the block's end: the next block's text (its mark off) joins on; an empty block goes. */
function deleteKey(v: Rendered, cx: Context): boolean {
  const c = caretOnly(v);

  if (!c) return false;

  const lines = v.piece.split("\n");
  const last = lines.length - 1;

  if (c.line !== last || c.col < (lines[last] ?? "").length) return false;

  if (!v.piece.trim()) return dropEmpty(v, 1, cx);

  fresh(v, cx);

  const line = filledLine(v, 1);

  if (line === null) return true;

  const next = unitFor(v.all, line);

  if (!JOINS.has(next.kind) || !JOINS.has(v.unit.kind)) return true;

  const ls = v.lines();
  const at = { line: v.range.to, col: (ls[v.range.to] ?? "").length };

  v.doc.editor.edit([{ start: at, end: { line, col: leadAt(next, line, ls[line]) }, text: "" }]);
  caretTo(v.doc.editor, at.line, at.col);
  v.pull(cx);

  return true;
}

/** The lit block is empty: it goes (a new block's lines, or its blank line and the break before
 *  it), the caret to the end of the block before (-1) or the start of the one after (1). */
function dropEmpty(v: Rendered, dir: number, cx: Context): boolean {
  let span = dropMade(v, cx);

  if (!span) {
    const at = v.range.from;
    const ls = v.lines();

    if (ls.length <= 1) return true;

    if (at > 0) editFile(v, { line: at - 1, col: (ls[at - 1] ?? "").length }, { line: at, col: (ls[at] ?? "").length }, "", cx);
    else editFile(v, { line: 0, col: 0 }, { line: 1, col: 0 }, "", cx);

    span = { from: at, to: at };
  }

  const ls = v.lines();
  const before = [...v.all].reverse().find((u) => u.to < span.from) ?? null;
  const after = v.all.find((u) => u.from >= span.from) ?? null;

  if (dir < 0 ? before : !after && before) {
    if (before) goTo(v, before.to, (ls[before.to] ?? "").length, cx);
  } else if (after) goTo(v, after.from, leadAt(after, after.from, ls[after.from]), cx);
  else goTo(v, 0, 0, cx);

  return true;
}

// ---- the pointer

/** A click on a drawn unit: it lights up, the caret about where the pointer pressed it (its
 *  first line's start when that isn't known; `end`: its last line's end). */
export function clickUnit(v: Rendered, clicked: Unit, cx: Context, end = false): void {
  const press = v.press;

  v.press = null;

  const span = dropMade(v, cx);
  let u = clicked;

  if (span) u = unitFor(v.all, shifted(clicked.from, span));
  else if (v.stale) {
    v.recut(cx);
    u = unitFor(v.all, u.from);
  }

  const ls = v.lines();
  const at = press && !end ? pressedAt(v, u, ls, press) : { line: end ? u.to : u.from, col: end ? (ls[u.to] ?? "").length : 0 };

  caretTo(v.doc.editor, at.line, at.col);
  v.light(u);
  v.mirror();
  v.measureSoon(cx);
  v.block.focus();
  v.host.notify(cx);
}

/** Where in its text a press on a drawn unit was (an estimate: the drawn unit's rows as its
 *  lines wrap at its width, a character as wide as the block editor's). */
function pressedAt(v: Rendered, u: Unit, ls: readonly string[], press: { readonly x: number; readonly y: number; readonly w: number }): Pos {
  // A list item's text starts right of its mark.
  const inset = u.kind === "item" ? 26 + u.indent * 7 : u.kind === "quote" ? 14 : 0;
  const cols = Math.max(8, Math.floor((press.w - inset) / v.cw));
  const want = Math.max(0, Math.floor(press.y / Math.max(1, v.rowH)));
  let row = 0;

  for (let line = u.from; line <= u.to; line++) {
    const text = ls[line] ?? "";
    const lead = leadAt(u, line, text);
    const starts = rowStarts(text.slice(lead), cols);

    if (row + starts.length > want || line === u.to) {
      const k = Math.min(starts.length - 1, want - row);
      const rs = starts[k] ?? 0;
      const rowEnd = k + 1 < starts.length ? (starts[k + 1] ?? 0) - 1 : text.length - lead;
      const col = rs + Math.round(Math.max(0, press.x - inset) / v.cw);

      return { line, col: lead + Math.max(rs, Math.min(rowEnd, col)) };
    }

    row += starts.length;
  }

  return { line: u.from, col: 0 };
}
