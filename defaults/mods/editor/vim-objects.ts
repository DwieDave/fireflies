// Vim's text objects (vim.ts): the span `iw`, `a(`, `it`, `ip` and the
// others cover around the caret, for an operator or visual mode.

import type { Pos } from "./vim.ts";
import type { Buffer } from "./vim-buffer.ts";
import { cls, cmp, isBlank } from "./vim-buffer.ts";

// ---- text objects: (buf, cursor, around, kind, count) -> { start, end, linewise? } (end exclusive)

/** Text an operator covers: [start, end), or the whole lines start..end (linewise). */
export interface Span {
  readonly start: Pos;
  readonly end: Pos;
  readonly linewise?: boolean;
}

/** The brackets an object names, open and close. */
const BRACKETS: ReadonlyMap<string, readonly [string, string]> = new Map<string, readonly [string, string]>([
  ["(", ["(", ")"]],
  [")", ["(", ")"]],
  ["b", ["(", ")"]],
  ["[", ["[", "]"]],
  ["]", ["[", "]"]],
  ["{", ["{", "}"]],
  ["}", ["{", "}"]],
  ["B", ["{", "}"]],
  ["<", ["<", ">"]],
  [">", ["<", ">"]],
]);

/** An HTML / XML tag in the text: where it is, its name, closing or self-closing. */
interface Tag {
  readonly s: number;
  readonly e: number;
  readonly name: string;
  readonly close: boolean;
  readonly self: boolean;
}

export function textObject(b: Buffer, p: Pos, around: boolean, kind: string, count: number): Span | null {
  const line = b.line(p.line);

  if (kind === "w" || kind === "W") return wordObject(p, around, kind, count, line);

  if (kind.length === 1 && `"'\``.includes(kind)) return quoteObject(p, around, kind, line);

  const pair = BRACKETS.get(kind);

  if (pair) return bracketObject(b, p, around, count, line, pair);

  if (kind === "t") return tagObject(b, p, around, count);

  if (kind === "p") return paraObject(b, p, around);

  return null;
}

/** A word (`iw` / `aw`, `W` the big word): its run of one kind of character, `a` with the blanks after (or before). */
function wordObject(p: Pos, around: boolean, kind: string, count: number, line: string): Span | null {
  const big = kind === "W";
  const c = (i: number): number => cls(line[i], big);
  let s = p.col;
  let e = p.col;
  const k = c(p.col);

  while (s > 0 && c(s - 1) === k) s--;

  while (e < line.length && c(e) === k) e++;

  for (let i = 1; i < count; i++) {
    const k2 = c(e);

    while (e < line.length && c(e) === k2) e++;
  }

  if (around) {
    if (k !== 0 && e < line.length && isBlank(line[e])) {
      while (e < line.length && isBlank(line[e])) e++;
    } else if (k !== 0) {
      while (s > 0 && isBlank(line[s - 1])) s--;
    } else {
      const k2 = c(e);

      while (e < line.length && c(e) === k2) e++;
    }
  }

  return { start: { line: p.line, col: s }, end: { line: p.line, col: e } };
}

/** A quoted string on the caret's line (`i"`, `a'`): between its quotes, `a` with them. */
function quoteObject(p: Pos, around: boolean, kind: string, line: string): Span | null {
  const q = kind;
  const idx: number[] = [];

  for (let i = 0; i < line.length; i++) if (line[i] === q && line[i - 1] !== "\\") idx.push(i);

  let open = -1;
  let close = -1;

  for (let i = 0; i + 1 < idx.length; i += 2) {
    const a = idx[i] ?? -1;
    const z = idx[i + 1] ?? -1;

    if (a <= p.col && p.col <= z) {
      open = a;
      close = z;
    }
  }

  if (open < 0) {
    const after = idx.find((i) => i > p.col);
    const j = after === undefined ? -1 : idx.indexOf(after);
    const end = idx[j + 1];

    if (after !== undefined && end !== undefined && j % 2 === 0) {
      open = after;
      close = end;
    }
  }

  if (open < 0) return null;

  if (!around) return { start: { line: p.line, col: open + 1 }, end: { line: p.line, col: close } };

  let e = close + 1;
  let s = open;

  if (e < line.length && isBlank(line[e])) while (e < line.length && isBlank(line[e])) e++;
  else while (s > 0 && isBlank(line[s - 1])) s--;

  return { start: { line: p.line, col: s }, end: { line: p.line, col: e } };
}

/** A bracket pair around the caret (`i(`, `a{`; `count` pairs out): inside it, `a` with the brackets. */
function bracketObject(b: Buffer, p: Pos, around: boolean, count: number, line: string, pair: readonly [string, string]): Span | null {
  const [o, c] = pair;
  let open: Pos | null = null;
  let depth = 0;
  let q: Pos | null = { ...p };
  let n = 0;
  // Outward from the caret (count levels).
  let levels = count;

  if (b.at(q) === o) {
    open = q;
    levels--;

    if (levels > 0) q = b.prev(q);
  }

  while (levels > 0 && q) {
    const ch = b.at(q);

    if (ch === c && cmp(q, p) !== 0) depth++;
    else if (ch === o) {
      if (depth === 0) {
        open = q;
        levels--;
      } else depth--;
    }

    if (levels > 0) q = b.prev(q);

    if (++n > 1e6) break;
  }

  if (!open) return null;

  depth = 0;
  q = b.next(open);

  let close: Pos | null = null;

  while (q) {
    const ch = b.at(q);

    if (ch === o) depth++;
    else if (ch === c) {
      if (depth === 0) {
        close = q;
        break;
      }

      depth--;
    }

    q = b.next(q);
  }

  if (!close) return null;

  if (around) return { start: open, end: b.next(close) ?? { line: close.line, col: close.col + 1 } };

  let s = b.next(open) ?? open;
  const e = close;

  // A block on its own lines: inner is the lines between.
  if (s.col === b.len(s.line) && s.line < e.line) {
    const lines = b.line(e.line).slice(0, e.col).trim() === "";

    if (lines && e.line - s.line >= 2) return { start: { line: s.line + 1, col: 0 }, end: { line: e.line - 1, col: b.len(e.line - 1) }, linewise: true };

    s = { line: s.line + 1, col: 0 };
  }

  return { start: s, end: e };
}

/** An HTML / XML tag pair around the caret (`it`, `at`; `count` pairs out). */
function tagObject(b: Buffer, p: Pos, around: boolean, count: number): Span | null {
  const text = b.all();
  const at = b.offset(p);
  const tags: Tag[] = [];
  const re = /<\/?([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g;

  for (let m = re.exec(text); m; m = re.exec(text)) tags.push({ s: m.index, e: m.index + m[0].length, name: m[1] ?? "", close: m[0][1] === "/", self: m[2] === "/" });

  const stack: Tag[] = [];
  const pairs: [Tag, Tag][] = [];

  for (const t of tags) {
    if (t.self) continue;

    if (!t.close) stack.push(t);
    else {
      for (let i = stack.length - 1; i >= 0; i--) {
        const opened = stack[i];

        if (opened?.name === t.name) {
          pairs.push([opened, t]);
          stack.length = i;
          break;
        }
      }
    }
  }

  const enclosing = pairs.filter(([o, c]) => o.s <= at && at < c.e).sort((x, y) => x[1].e - x[0].s - (y[1].e - y[0].s));
  const pick = enclosing[Math.min(count, enclosing.length) - 1];

  if (!pick) return null;

  const [o, c] = pick;

  return around ? { start: b.pos(o.s), end: b.pos(c.e) } : { start: b.pos(o.e), end: b.pos(c.s) };
}

/** A paragraph (`ip`: its lines, or the blank run; `ap` with the run after). */
function paraObject(b: Buffer, p: Pos, around: boolean): Span | null {
  const blank = (l: number): boolean => b.line(l).trim() === "";
  const k = blank(p.line);
  let s = p.line;
  let e = p.line;

  while (s > 0 && blank(s - 1) === k) s--;

  while (e < b.last && blank(e + 1) === k) e++;

  if (around) while (e < b.last && blank(e + 1) !== k) e++;

  return { start: { line: s, col: 0 }, end: { line: e, col: b.len(e) }, linewise: true };
}
