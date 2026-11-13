// Keys in the rendered view's lit block (rendered.ts hands them here) and
// adding blocks: up / down past its first or last row step into the unit
// before or after; enter continues a list, task or quote (mdedit.ts enter),
// else makes a new paragraph below (a paragraph splits at the caret; vim's
// normal mode: enterBelow); undo and redo are the file's; a "+" or "add a
// block" puts an empty paragraph after a unit; a click lights a unit up.

import type { Context, KeyEvent } from "gpui-kit";
import type { EditorPosition } from "gpui-base";
import type { Unit } from "./live.ts";
import { step, unitFor } from "./live.ts";
import { enter } from "./mdedit.ts";
import { editBetween } from "./md-text.ts";
import type { Rendered } from "./rendered.ts";

type Pos = EditorPosition;

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

  if (plain && (k === "up" || k === "down")) return edge(v, k === "up" ? -1 : 1, cx);

  if (plain && k === "enter") return enterKey(v, cx);

  return false;
}

/** Enter: a list item, task or quote goes on (mdedit.ts); on the last line of any other block, a new paragraph below. */
function enterKey(v: Rendered, cx: Context): boolean {
  const sel = v.localSel();
  const r = enter(v.piece, sel);

  if (r) {
    const e = editBetween(v.block.value(), r.text);

    if (e) v.block.edit([e]);

    v.block.set_cursor(r.sel.start.line, r.sel.start.col);
    v.push(cx); // the edit's own change event comes after: the file has it now

    return true;
  }

  if (sel.start.line !== sel.end.line || sel.start.col !== sel.end.col) return false;

  const ls = v.piece.split("\n");
  const last = ls.length - 1;
  const lastText = ls[last] ?? "";
  const c = sel.start;

  // An empty block made here is the new block already: enter keeps it (no blank lines piling up).
  if (v.offersKinds()) return true;

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
  const crlf = /\r\n/.test(v.text ?? "");
  const nl = crlf ? "\r\n" : "\n";
  const rest = (ls[line] ?? "").slice(col);
  const next = ls[line + 1];
  // A blank line between, and one after it when something follows straight on.
  const tail = glue && next?.trim() ? nl : "";

  // At a paragraph line's end: its next line starts the new paragraph (no empty first line).
  const end = !glue && !rest ? { line: line + 1, col: 0 } : { line, col: (ls[line] ?? "").length };

  v.doc.editor.edit([{ start: { line, col }, end, text: nl + nl + rest + tail }]);
  v.doc.editor.set_cursor(line + 2, 0);
  v.made = line + 2;
  v.pull(cx);
  v.block.focus();
}

/** An empty paragraph after unit `u` (the "+" beside it, "add a block" under the last), lit, the caret in it. */
export function addAfter(v: Rendered, u: Unit | null, cx: Context): void {
  if (!u) {
    // An empty document: its first line.
    v.doc.editor.set_cursor(0, 0);
    v.made = 0;
    v.pull(cx);
    v.block.focus();

    return;
  }

  if (v.stale) v.recut(cx);

  const ls = v.lines();
  const at = Math.min(u.to, ls.length - 1);

  splitAt(v, at, (ls[at] ?? "").length, cx);
}

/** Up / down: within the block unless the caret is on its first / last row, else into the next unit. */
function edge(v: Rendered, dir: number, cx: Context): boolean {
  const c = v.block.cursor();
  const lines = v.piece.split("\n");
  const lastLine = lines.length - 1;
  const onEdge = dir < 0 ? c.line === 0 && firstRow(v, c) : c.line === lastLine && lastRow(v, c, lines);

  if (!onEdge) return false;

  return stepUnit(v, dir, c.col, cx);
}

/** Into the unit before (-1) or after (1); false at the document's ends. */
function stepUnit(v: Rendered, dir: number, col: number, cx: Context): boolean {
  if (v.stale) {
    v.recut(cx);
    v.units = v.all.filter((u) => u.to < v.range.from || u.from > v.range.to);
  }

  const s = step(v.text, v.units, v.range, dir, col);

  if (!s) return false;

  v.doc.editor.set_cursor(s.line, s.col);
  v.light(s.unit);
  v.mirror();
  v.measureSoon(cx);
  v.host.notify(cx);

  return true;
}

/** Whether the caret is on the first drawn row of the block's first line (a soft-wrapped line has more). */
function firstRow(v: Rendered, c: Pos): boolean {
  const a = v.block.bounds({ line: 0, col: 0 });
  const b = v.block.bounds(c);

  return !a || !b || Math.abs(a.y - b.y) < 2;
}

function lastRow(v: Rendered, c: Pos, lines: readonly string[]): boolean {
  const last = lines.length - 1;
  const a = v.block.bounds({ line: last, col: (lines[last] ?? "").length });
  const b = v.block.bounds(c);

  return !a || !b || Math.abs(a.y - b.y) < 2;
}

/** A click on a drawn unit: it lights up, the caret on its first line (`end`: its last). */
export function clickUnit(v: Rendered, clicked: Unit, cx: Context, end = false): void {
  let u = clicked;

  if (v.stale) {
    v.recut(cx);
    u = unitFor(v.all, u.from);
  }

  const ls = v.lines();
  const line = end ? u.to : u.from;

  v.doc.editor.set_cursor(line, end ? (ls[line] ?? "").length : 0);
  v.light(u);
  v.mirror();
  v.measureSoon(cx);
  v.block.focus();
  v.host.notify(cx);
}

