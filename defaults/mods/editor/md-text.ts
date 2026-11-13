// A Markdown text as the commands (mdedit.ts, md-inline.ts) see it: a
// selection of { line, col } places (zero-based, columns in JavaScript string
// units, as the editor's), what a command makes, and the text's lines with
// its own line end (CRLF files keep theirs).

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
