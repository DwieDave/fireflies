// The inline Markdown commands (mdedit.ts runs them): bold, italic and
// inline code around the selection or the word at the caret (on again: off),
// and a link around it; and what they read on a line: the spans of a mark,
// the links.

import type { Done, Sel } from "./md-text.ts";
import { caret, pos, split } from "./md-text.ts";

// ---- inline marks

/** The code spans of a line, as [from, to) ranges including their backticks. */
function codeSpans(line: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /(`+)([\s\S]*?[^`])\1(?!`)/g;

  for (let m = re.exec(line); m; m = re.exec(line)) out.push([m.index, m.index + m[0].length]);

  return out;
}

/** An inline mark's kind. */
export type MarkKind = "bold" | "italic" | "code";

/** A marked span of a line: [from, to) with its marks, and the marks' lengths. */
export interface Span {
  readonly from: number;
  readonly to: number;
  readonly open: number;
  readonly close: number;
}

/** Spans of a mark on one line: [{ from, to, open, close }] (from/to include the marks;
 *  open/close: the marks' lengths). `kind`: bold, italic or code. */
export function spans(line: string, kind: MarkKind): Span[] {
  if (kind === "code") {
    return codeSpans(line).map(([from, to]) => {
      const n = (/^`+/.exec(line.slice(from))?.[0] ?? "").length;

      return { from, to, open: n, close: n };
    });
  }

  // Outside code: the code spans' text masked so marks inside them don't count.
  let masked = line;

  for (const [a, b] of codeSpans(line)) masked = masked.slice(0, a) + " ".repeat(b - a) + masked.slice(b);
  const out: Span[] = [];

  if (kind === "bold") {
    const re = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g;

    for (let m = re.exec(masked); m; m = re.exec(masked)) out.push({ from: m.index, to: m.index + m[0].length, open: 2, close: 2 });
  } else {
    // One * or _, not one of a pair; _ not inside a word (snake_case isn't italic).
    for (const e of ["\\*", "_"]) {
      const word = e === "_" ? ["(?<![\\p{L}\\p{N}])", "(?![\\p{L}\\p{N}])"] : ["", ""];
      const re = new RegExp(`${word[0]}(?<!${e}|\\\\)${e}(?![\\s${e}])((?:[^${e}]|${e}${e}[^${e}]+${e}${e})*?)(?<![\\s${e}\\\\])${e}(?!${e})${word[1]}`, "gu");

      for (let m = re.exec(masked); m; m = re.exec(masked)) out.push({ from: m.index, to: m.index + m[0].length, open: 1, close: 1 });
    }
  }

  // Bold and italic at once (***x***): italic sees the inner ones.
  if (kind === "italic") {
    const tri = /(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g;

    for (let m = tri.exec(masked); m; m = tri.exec(masked)) {
      const from = m.index;
      const to = m.index + m[0].length;

      if (!out.some((s) => s.from <= from && s.to >= to)) out.push({ from: from + 2, to: to - 2, open: 1, close: 1 });
    }
  }

  return out.sort((a, b) => a.from - b.from);
}

const WORD = /[\p{L}\p{N}_'-]/u;

/** The word around column `col` of `line`: [from, to), or null between words. */
function wordAt(line: string, col: number): [number, number] | null {
  let a = col;
  let b = col;
  const word = (c: string | undefined): boolean => c !== undefined && WORD.test(c) && c !== "_";

  while (a > 0 && word(line[a - 1])) a--;

  while (b < line.length && word(line[b])) b++;

  return a < b ? [a, b] : null;
}

/** Bold, italic or inline code on and off. */
export function inline(text: string, s: Sel, mark: string, kind: MarkKind): Done {
  const { lines, eol } = split(text);
  const lineAt = (l: number): string => lines[l] ?? "";

  if (s.start.line !== s.end.line) {
    // Over lines: each line's part, as one selection each would.
    let sel = s;
    const all: [number, number, number][] = [];

    for (let l = s.start.line; l <= s.end.line; l++) {
      const line = lineAt(l);
      const a = l === s.start.line ? s.start.col : 0;
      const b = l === s.end.line ? s.end.col : line.length;

      if (a < b && line.slice(a, b).trim()) all.push([l, a, b]);
    }

    const on = all.length > 0 && all.every(([l, a, b]) => spanCovering(lineAt(l), kind, a, b));

    for (const [l, a, b] of all.reverse()) {
      const r = inlineLine(lineAt(l), a, b, mark, kind, on);

      lines[l] = r.line;

      if (l === s.end.line) sel = { start: sel.start, end: pos(l, r.b) };

      if (l === s.start.line) sel = { start: pos(l, r.a), end: sel.end };
    }

    return { text: lines.join(eol), sel };
  }

  const l = s.start.line;
  const line = lineAt(l);
  const a = s.start.col;
  const b = s.end.col;

  if (a === b) {
    const span = spanCovering(line, kind, a, a);

    if (span) {
      // Inside marked text: the marks come off.
      const r = unwrap(line, span);
      lines[l] = r;
      const col = a <= span.from + span.open ? span.from : a >= span.to - span.close ? span.to - span.open - span.close : a - span.open;

      return { text: lines.join(eol), sel: caret(pos(l, col)) };
    }

    const w = kind === "code" ? null : wordAt(line, a);

    if (w) {
      lines[l] = line.slice(0, w[0]) + mark + line.slice(w[0], w[1]) + mark + line.slice(w[1]);

      return { text: lines.join(eol), sel: caret(pos(l, a + mark.length)) };
    }

    lines[l] = line.slice(0, a) + mark + mark + line.slice(a);

    return { text: lines.join(eol), sel: caret(pos(l, a + mark.length)) };
  }

  const on = Boolean(spanCovering(line, kind, a, b));
  const r = inlineLine(line, a, b, mark, kind, on);
  lines[l] = r.line;

  return { text: lines.join(eol), sel: { start: pos(l, r.a), end: pos(l, r.b) } };
}

/** The span of `kind` holding [a, b) (or the selection is the span, marks and all). */
export function spanCovering(line: string, kind: MarkKind, a: number, b: number): Span | null {
  // Each end inside the marked text, or right at the span's outer edge (the marks selected too).
  return spans(line, kind).find((sp) => {
    const lo = sp.from + sp.open;
    const hi = sp.to - sp.close;
    const okA = a === sp.from || (lo <= a && a <= hi);
    const okB = b === sp.to || (lo <= b && b <= hi);

    return okA && okB;
  }) ?? null;
}

const unwrap = (line: string, sp: Span): string => line.slice(0, sp.from) + line.slice(sp.from + sp.open, sp.to - sp.close) + line.slice(sp.to);

/** One line's [a, b): marked (on false) or unmarked (on true); -> the line and where [a, b) went. */
/** One line after a mark went on or off, and where its [a, b) went. */
interface Marked {
  readonly line: string;
  readonly a: number;
  readonly b: number;
}

function inlineLine(line: string, from: number, to: number, mark: string, kind: MarkKind, on: boolean): Marked {
  let a = from;
  let b = to;

  if (on) {
    const sp = spanCovering(line, kind, a, b);

    if (!sp) return { line, a, b };
    const na = a <= sp.from + sp.open ? sp.from : a - sp.open;
    const nb = b >= sp.to - sp.close ? sp.to - sp.open - sp.close : b - sp.open;

    return { line: unwrap(line, sp), a: na, b: nb };
  }

  // Spaces at the ends stay outside the marks (`** x**` isn't bold).
  while (a < b && /\s/.test(line[a] ?? "")) a++;

  while (b > a && /\s/.test(line[b - 1] ?? "")) b--;

  if (a === b) return { line, a, b };
  let m = mark;

  if (kind === "code") {
    const longest = Math.max(0, ...[...line.slice(a, b).matchAll(/`+/g)].map((x) => x[0].length));
    m = "`".repeat(longest + 1);
    const pad = line[a] === "`" || line[b - 1] === "`" ? " " : "";

    return { line: line.slice(0, a) + m + pad + line.slice(a, b) + pad + m + line.slice(b), a: a + m.length + pad.length, b: b + m.length + pad.length };
  }

  return { line: line.slice(0, a) + m + line.slice(a, b) + m + line.slice(b), a: a + m.length, b: b + m.length };
}

// ---- links

const LINK = /(!?)\[((?:[^[\]]|\[[^\]]*\])*)\]\(([^()\s]*(?:\([^()]*\))?[^()\s]*)(?:\s+"[^"]*")?\)/g;

/** The links of a line: [{ from, to, text: [from, to), url: [from, to) }]. */
export function links(line: string): LineLink[] {
  const out: LineLink[] = [];

  LINK.lastIndex = 0;

  for (let m = LINK.exec(line); m; m = LINK.exec(line)) {
    if (m[1]) continue; // an image

    const t0 = m.index + 1;
    const t1 = t0 + (m[2] ?? "").length;
    const u0 = t1 + 2;

    out.push({ from: m.index, to: m.index + m[0].length, text: [t0, t1], url: [u0, u0 + (m[3] ?? "").length] });
  }

  return out;
}

/** A link on a line: [from, to), its text's and its address's [from, to). */
export interface LineLink {
  readonly from: number;
  readonly to: number;
  readonly text: readonly [number, number];
  readonly url: readonly [number, number];
}

export function link(text: string, s: Sel): Done | null {
  const { lines, eol } = split(text);

  if (s.start.line !== s.end.line) return null;

  const l = s.start.line;
  const line = lines[l] ?? "";
  let a = s.start.col;
  let b = s.end.col;
  const inside = links(line).find((k) => k.from <= a && b <= k.to && (a < k.to || a === b));

  if (inside && a === b && a > inside.from && a < inside.to) {
    // On a link: back to its text.
    const label = line.slice(inside.text[0], inside.text[1]);
    lines[l] = line.slice(0, inside.from) + label + line.slice(inside.to);
    const col = Math.min(inside.from + label.length, Math.max(inside.from, a - 1));

    return { text: lines.join(eol), sel: caret(pos(l, col)) };
  }

  if (a === b) {
    const w = wordAt(line, a);

    if (w) [a, b] = w;
  }

  const label = line.slice(a, b);
  const looksUrl = /^(https?:\/\/|www\.|mailto:)\S+$/.test(label);

  if (looksUrl) {
    // A URL selected: it's the target; the text is to type.
    lines[l] = line.slice(0, a) + "[](" + label + ")" + line.slice(b);

    return { text: lines.join(eol), sel: caret(pos(l, a + 1)) };
  }

  const body = label || "text";
  lines[l] = line.slice(0, a) + "[" + body + "](url)" + line.slice(b);
  const u = a + 1 + body.length + 2;

  // The url is selected to type over; with nothing selected, the text first.
  return { text: lines.join(eol), sel: label ? { start: pos(l, u), end: pos(l, u + 3) } : { start: pos(l, a + 1), end: pos(l, a + 1 + body.length) } };
}
