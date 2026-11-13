// Vim's working copy of the text (vim.ts): its lines, the caret, places
// stepped, compared and clamped, the kinds of characters a word is made of,
// and the edits made to it, recorded for the editor.

import type { Edit, Pos } from "./vim.ts";

export const isWord = (c: string | undefined): boolean => /[\p{L}\p{N}_]/u.test(c ?? "");

export const isBlank = (c: string | undefined): boolean => c === " " || c === "\t";

export const cls = (c: string | undefined, big: boolean): number => (c === undefined || c === "" ? -1 : isBlank(c) ? 0 : big ? 1 : isWord(c) ? 1 : 2);

export const cmp = (a: Pos, b: Pos): number => a.line - b.line || a.col - b.col;

export const minPos = (a: Pos, b: Pos): Pos => (cmp(a, b) <= 0 ? a : b);

export const maxPos = (a: Pos, b: Pos): Pos => (cmp(a, b) <= 0 ? b : a);

/** `command` `n` times (a count). */
export const times = (n: number, command: string): string[] => Array.from({ length: n }, () => command);
// ---- the buffer

/** A working copy of the text the keys act on; edits are recorded as they're made. */
export class Buffer {
  lines: string[];
  cursor: Pos;
  edits: Edit[] = [];

  constructor(text: string, cursor: Pos) {
    this.lines = text.split("\n");
    this.cursor = { ...cursor };
  }

  get last(): number {
    return this.lines.length - 1;
  }

  line(n: number): string {
    return this.lines[n] ?? "";
  }

  len(n: number): number {
    return this.line(n).length;
  }

  clamp(p: Pos, insert = false): Pos {
    const line = Math.max(0, Math.min(this.last, p.line));
    const max = insert ? this.len(line) : Math.max(0, this.len(line) - 1);

    return { line, col: Math.max(0, Math.min(max, p.col)) };
  }

  text(a: Pos, b: Pos): string {
    if (a.line === b.line) return this.line(a.line).slice(a.col, b.col);

    const out = [this.line(a.line).slice(a.col)];

    for (let l = a.line + 1; l < b.line; l++) out.push(this.line(l));

    out.push(this.line(b.line).slice(0, b.col));

    return out.join("\n");
  }

  /** Replaces [a, b) with `text`, records the edit; -> the end of the new text. */
  replace(a: Pos, b: Pos, text: string): Pos {
    const head = this.line(a.line).slice(0, a.col);
    const tail = this.line(b.line).slice(b.col);
    const parts = text.split("\n");
    const repl = parts.map((p, i) => (i === 0 ? head : "") + p + (i === parts.length - 1 ? tail : ""));

    this.lines.splice(a.line, b.line - a.line + 1, ...repl);
    this.edits.push({ start: { ...a }, end: { ...b }, text });

    const endLine = a.line + parts.length - 1;

    return { line: endLine, col: (parts.length === 1 ? a.col : 0) + (parts.at(-1) ?? "").length };
  }

  /** Character after/before p across lines (newline between lines). */
  at(p: Pos): string {
    return p.col < this.len(p.line) ? (this.line(p.line)[p.col] ?? "") : p.line < this.last ? "\n" : "";
  }

  next(p: Pos): Pos | null {
    return p.col < this.len(p.line) ? { line: p.line, col: p.col + 1 } : p.line < this.last ? { line: p.line + 1, col: 0 } : null;
  }

  prev(p: Pos): Pos | null {
    return p.col > 0 ? { line: p.line, col: p.col - 1 } : p.line > 0 ? { line: p.line - 1, col: this.len(p.line - 1) } : null;
  }

  firstNonBlank(n: number): Pos {
    const lead = (this.line(n).match(/^\s*/)?.[0] ?? "").length;

    return { line: n, col: Math.min(lead, Math.max(0, this.len(n) - (lead === this.len(n) ? 1 : 0))) };
  }

  offset(p: Pos): number {
    let o = 0;

    for (let l = 0; l < p.line; l++) o += this.len(l) + 1;

    return o + p.col;
  }

  pos(offset: number): Pos {
    let o = offset;
    let l = 0;

    while (l < this.last && o > this.len(l)) {
      o -= this.len(l) + 1;
      l++;
    }

    return { line: l, col: Math.min(o, this.len(l)) };
  }

  all(): string {
    return this.lines.join("\n");
  }
}
