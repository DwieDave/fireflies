// A Markdown text as the commands (mdedit.ts, md-inline.ts) see it: a
// selection of { line, col } places (zero-based, columns in JavaScript string
// units, as the editor's), what a command makes, and the text's lines with
// its own line end (CRLF files keep theirs); the one edit taking a text to
// another (editBetween: the rendered view and the commands edit only where
// the text differs).

import type { EditorPosition } from "gpui-base";

/** A place: zero-based line, column in JavaScript string units. */
export type Pos = EditorPosition;

/** A selection, start before end once ordered; a caret when its ends meet. */
export interface Sel {
  readonly start: Pos;
  readonly end: Pos;
}

/** What a command made: the text and the selection after it. */
export interface Done {
  readonly text: string;
  readonly sel: Sel;
}

export const pos = (line: number, col: number): Pos => ({ line, col });

export const caret = (p: Pos): Sel => ({ start: p, end: p });

export const before = (a: Pos, b: Pos): boolean => a.line < b.line || (a.line === b.line && a.col <= b.col);

export function ordered(sel: Sel): Sel {
  return before(sel.start, sel.end) ? sel : { start: sel.end, end: sel.start };
}

/** The text as lines, and how to join them back (its own line end). */
/** A text's lines and its line end. */
export interface Split {
  readonly lines: string[];
  readonly eol: "\r\n" | "\n";
}

export function split(text: string): Split {
  const t = text;
  const eol = /\r\n/.test(t) ? "\r\n" : "\n";

  return { lines: t.split(/\r?\n/), eol };
}

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
