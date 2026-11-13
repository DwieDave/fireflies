// Markdown commands, each a function from the text and a selection to the
// new text and selection: bold, italic, inline code, link, heading level up
// and down (and 0-6 straight), bullet list, numbered list, task box, tick,
// quote, code block, rule; and the enter that continues a list. Running one
// where it's already on takes it off again. The editor runs them (main.ts:
// cmd-. and a letter, vim's space .; the palette), in every Markdown view.
//
// A selection is { start, end } of { line, col } (zero-based, columns in
// JavaScript string units, as the editor's), start before end; a caret is a
// selection whose ends meet. Only the lines a command is about change: the
// rest of the text comes back as it was, byte for byte (CRLF files keep
// their line ends).

import type { EditorPosition } from "gpui-base";

/** A place: zero-based line, column in JavaScript string units. */
type Pos = EditorPosition;

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

/** A command's title, its menu key and the mark it writes. */
export type CommandInfo = readonly [title: string, key: string, mark: string];

/** Every command: name -> [title, menu key, the mark it writes]. The order is the menu's. */
export const COMMANDS = {
  bold: ["Bold", "b", "**"],
  italic: ["Italic", "i", "_"],
  code: ["Inline code", "`", "`"],
  link: ["Link", "k", "[](…)"],
  "heading-up": ["Heading level up", "h", "## → #"],
  "heading-down": ["Heading level down", "H", "# → ##"],
  bullets: ["Bullet list", "l", "-"],
  numbers: ["Numbered list", "n", "1."],
  task: ["Task box", "t", "- [ ]"],
  tick: ["Tick or untick", "x", "[x]"],
  quote: ["Quote", "q", ">"],
  fence: ["Code block", "c", "```"],
  rule: ["Rule", "r", "---"],
} as const satisfies { readonly [name: string]: CommandInfo };

/** A command's name (and heading-0 to heading-6). */
export type CommandName = keyof typeof COMMANDS;

/** The commands by name (a name from a key or the palette is data). */
const BY_NAME: ReadonlyMap<string, CommandInfo> = new Map<string, CommandInfo>(Object.entries(COMMANDS));

/** A command's [title, key, mark], or undefined for a name that isn't one. */
export const commandInfo = (name: string): CommandInfo | undefined => BY_NAME.get(name);

// The menu's digits: a heading of that level (0: back to text).
export const LEVELS = ["0", "1", "2", "3", "4", "5", "6"];

const HEADING = /^( {0,3})(#{1,6})(?:[ \t]+|$)/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const BULLET = /^(\s*)([-*+])(\s+)(?!\[[ xX]\](?:\s|$))/;
const ORDERED = /^(\s*)(\d{1,9})([.)])(\s+)(?!\[[ xX]\](?:\s|$))/;
const TASK = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)\[([ xX])\](\s|$)/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)/;
const QUOTE = /^( {0,3})>( ?)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

const pos = (line: number, col: number): Pos => ({ line, col });

const caret = (p: Pos): Sel => ({ start: p, end: p });

const before = (a: Pos, b: Pos): boolean => a.line < b.line || (a.line === b.line && a.col <= b.col);

export function ordered(sel: Sel): Sel {
  return before(sel.start, sel.end) ? sel : { start: sel.end, end: sel.start };
}

/** The text as lines, and how to join them back (its own line end). */
/** A text's lines and its line end. */
interface Split {
  readonly lines: string[];
  readonly eol: "\r\n" | "\n";
}

function split(text: string): Split {
  const t = text;
  const eol = /\r\n/.test(t) ? "\r\n" : "\n";

  return { lines: t.split(/\r?\n/), eol };
}

/** Runs a command: -> { text, sel } (sel ordered), or null when it changes nothing. */
export function run(name: string, text: string, sel: Sel): Done | null {
  const s = ordered(sel);
  const f: Action | undefined = name.startsWith("heading-") && /^heading-[0-6]$/.test(name) ? (t, x) => headingTo(t, x, Number(name.slice(8))) : ACTIONS.get(name);

  if (!f) return null;

  const r = f(text, s);

  if (!r || (r.text === text && same(r.sel, s))) return null;

  return r;
}

const same = (a: Sel, b: Sel): boolean => a.start.line === b.start.line && a.start.col === b.start.col && a.end.line === b.end.line && a.end.col === b.end.col;

/** A command: the text and the ordered selection to what it makes (null: nothing). */
type Action = (text: string, s: Sel) => Done | null;

const ACTIONS: ReadonlyMap<string, Action> = new Map<string, Action>([
  ["bold", (t, s) => inline(t, s, "**", "bold")],
  ["italic", (t, s) => inline(t, s, "_", "italic")],
  ["code", (t, s) => inline(t, s, "`", "code")],
  ["link", link],
  ["heading-up", (t, s) => heading(t, s, (l) => (l === 0 ? 1 : Math.max(1, l - 1)))],
  ["heading-down", (t, s) => heading(t, s, (l) => (l === 0 ? 0 : l === 6 ? 0 : l + 1))],
  ["bullets", bullets],
  ["numbers", numbers],
  ["task", task],
  ["tick", tick],
  ["quote", quote],
  ["fence", fence],
  ["rule", rule],
]);

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
function inline(text: string, s: Sel, mark: string, kind: MarkKind): Done {
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
function spanCovering(line: string, kind: MarkKind, a: number, b: number): Span | null {
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

function link(text: string, s: Sel): Done | null {
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

// ---- line-wise commands

/** The lines a selection is about: a selection ending at column 0 of a later line leaves that line out. */
function lineRange(s: Sel): [number, number] {
  const last = s.end.line > s.start.line && s.end.col === 0 ? s.end.line - 1 : s.end.line;

  return [s.start.line, last];
}

/** Applies per-line changes ({ at, del, ins } at column `at`: delete `del`, insert `ins`) and moves the selection with them. */
/** A change to one line: at column `at`, delete `del` characters and insert `ins`. */
interface LineEdit {
  readonly at: number;
  readonly del: number;
  readonly ins: string;
}

function edits(text: string, s: Sel, change: (line: string, l: number) => LineEdit | null): Done | null {
  const { lines, eol } = split(text);
  const [from, to] = lineRange(s);
  const done = new Map<number, LineEdit>();

  for (let l = from; l <= to; l++) {
    const line = lines[l] ?? "";
    const c = change(line, l);

    if (!c) continue;

    lines[l] = line.slice(0, c.at) + c.ins + line.slice(c.at + c.del);
    done.set(l, c);
  }

  if (!done.size) return null;

  const move = (p: Pos): Pos => {
    const c = done.get(p.line);

    if (!c || p.col < c.at) return p;

    if (p.col < c.at + c.del) return pos(p.line, c.at + c.ins.length);

    return pos(p.line, p.col - c.del + c.ins.length);
  };

  return { text: lines.join(eol), sel: { start: move(s.start), end: move(s.end) } };
}

/** A line's heading level (0: none; setext's are 1 and 2 by the line under them). */
export function headingLevel(lines: readonly string[], l: number): number {
  const line = lines[l] ?? "";
  const h = HEADING.exec(line);

  if (h) return (h[2] ?? "").length;

  const next = lines[l + 1];

  if (next !== undefined && line.trim() && SETEXT.test(next) && !ITEM.test(line) && !QUOTE.test(line) && !FENCE.test(line)) return next.trim()[0] === "=" ? 1 : 2;

  return 0;
}

function heading(text: string, s: Sel, step: (level: number) => number): Done | null {
  return setLevels(text, s, (l, lines) => step(headingLevel(lines, l)));
}

function headingTo(text: string, s: Sel, n: number): Done | null {
  return setLevels(text, s, () => n);
}

/** Every selected line (with text) to the level `want(line, lines)` gives; setext headings become ATX (their underline goes). */
function setLevels(text: string, s: Sel, want: (l: number, lines: readonly string[]) => number): Done | null {
  const { lines, eol } = split(text);
  const [from, to] = lineRange(s);
  let sel = s;
  const drop: number[] = [];
  let changed = false;

  for (let l = from; l <= to; l++) {
    const line = lines[l] ?? "";

    if (!line.trim() && from !== to) continue;
    const was = headingLevel(lines, l);
    const n = want(l, lines);
    const h = HEADING.exec(line);
    const setext = !h && was > 0;

    if (n === was) continue;
    // The heading's own text, its indent kept, closing #s dropped.
    const indent = h ? (h[1] ?? "") : (/^\s*/.exec(line)?.[0] ?? "");
    const startOld = h ? h[0].length : indent.length;
    const body = (h ? line.slice(startOld).replace(/[ \t]+#+[ \t]*$/, "") : line.slice(startOld));
    const prefix = n ? `${indent}${"#".repeat(n)} ` : indent;
    lines[l] = prefix + body;

    if (setext) drop.push(l + 1);
    changed = true;
    const move = (p: Pos): Pos => (p.line !== l ? p : pos(l, Math.max(prefix.length, Math.min(prefix.length + body.length, p.col - startOld + prefix.length))));
    sel = { start: move(sel.start), end: move(sel.end) };
  }

  if (!changed) return null;

  for (const l of drop.reverse()) {
    lines.splice(l, 1);
    const up = (p: Pos): Pos => (p.line > l ? pos(p.line - 1, p.col) : p.line === l ? pos(l - 1, (lines[l - 1] ?? "").length) : p);
    sel = { start: up(sel.start), end: up(sel.end) };
  }

  return { text: lines.join(eol), sel };
}

/** The lines with text among the selected ones. */
/** The selected lines that have text, and a line by its number. */
interface Texted {
  readonly lines: readonly string[];
  readonly out: readonly number[];
  readonly at: (l: number) => string;
}

function texted(text: string, s: Sel): Texted {
  const { lines } = split(text);
  const [from, to] = lineRange(s);
  const out: number[] = [];
  const at = (l: number): string => lines[l] ?? "";

  for (let l = from; l <= to; l++) if (at(l).trim() || from === to) out.push(l);

  return { lines, out, at };
}

/** The length of a regex group (0 when it didn't take part). */
const len = (g: string | undefined): number => (g ?? "").length;

/** A line's leading white space. */
const indentOf = (line: string): number => len(/^\s*/.exec(line)?.[0]);

function bullets(text: string, s: Sel): Done | null {
  const { out, at } = texted(text, s);
  const all = out.every((l) => BULLET.test(at(l)));

  return edits(text, s, (line, l) => {
    if (!out.includes(l)) return null;

    if (all) {
      const m = BULLET.exec(line);

      return m ? { at: len(m[1]), del: m[0].length - len(m[1]), ins: "" } : null;
    }

    const t = TASK.exec(line);

    if (t) return { at: len(t[1]), del: t[0].length - len(t[1]), ins: "- " };

    const o = ORDERED.exec(line);

    if (o) return { at: len(o[1]), del: o[0].length - len(o[1]), ins: "- " };

    if (BULLET.test(line)) return null;

    return { at: indentOf(line), del: 0, ins: "- " };
  });
}

function numbers(text: string, s: Sel): Done | null {
  const { out, at } = texted(text, s);
  const all = out.every((l) => ORDERED.test(at(l)));
  // Numbering goes on from an item just above at the same indent.
  const prev = ORDERED.exec(at((out[0] ?? 0) - 1));
  let n = prev ? Number(prev[2]) + 1 : 1;

  return edits(text, s, (line, l) => {
    if (!out.includes(l)) return null;

    if (all) {
      const m = ORDERED.exec(line);

      return m ? { at: len(m[1]), del: m[0].length - len(m[1]), ins: "" } : null;
    }

    const mark = `${n++}. `;
    const t = TASK.exec(line);

    if (t) return { at: len(t[1]), del: len(t[2]) + len(t[3]), ins: mark.trimEnd() + " " };

    const b = BULLET.exec(line) ?? ORDERED.exec(line);

    if (b) return { at: len(b[1]), del: b[0].length - len(b[1]), ins: mark };

    return { at: indentOf(line), del: 0, ins: mark };
  });
}

function task(text: string, s: Sel): Done | null {
  const { out, at } = texted(text, s);
  const all = out.every((l) => TASK.test(at(l)));

  return edits(text, s, (line, l) => {
    if (!out.includes(l)) return null;

    const t = TASK.exec(line);

    if (all) return t ? { at: len(t[1]) + len(t[2]) + len(t[3]), del: 3 + (t[5] ? 1 : 0), ins: "" } : null;

    if (t) return null;

    const i = ITEM.exec(line);

    if (i) return { at: len(i[1]) + len(i[2]), del: len(i[3]), ins: " [ ] " };

    return { at: indentOf(line), del: 0, ins: "- [ ] " };
  });
}

function tick(text: string, s: Sel): Done | null {
  const { out, at } = texted(text, s);
  const tasks = out.filter((l) => TASK.test(at(l)));

  if (!tasks.length) return null;

  const check = tasks.some((l) => TASK.exec(at(l))?.[4] === " ");

  return edits(text, s, (line, l) => {
    if (!tasks.includes(l)) return null;

    const t = TASK.exec(line);

    return t ? { at: len(t[1]) + len(t[2]) + len(t[3]) + 1, del: 1, ins: check ? "x" : " " } : null;
  });
}

/** The edit that ticks or unticks the task on one line (a click on its box): -> { text, sel } or null. */
export function tickLine(text: string, line: number): Done | null {
  return tick(text, caret(pos(line, 0)));
}

function quote(text: string, s: Sel): Done | null {
  const { lines } = split(text);
  const [from, to] = lineRange(s);
  const own: number[] = [];

  for (let l = from; l <= to; l++) own.push(l);

  const withText = own.filter((l) => (lines[l] ?? "").trim());
  const all = withText.length > 0 && withText.every((l) => QUOTE.test(lines[l] ?? ""));

  return edits(text, s, (line) => {
    if (all) {
      const m = QUOTE.exec(line);

      return m ? { at: len(m[1]), del: 1 + len(m[2]), ins: "" } : null;
    }

    if (!line.trim()) return from === to ? { at: 0, del: line.length, ins: "> " } : { at: 0, del: line.length, ins: ">" };

    return { at: 0, del: 0, ins: "> " };
  });
}

/** The fenced block holding line `l`: { open, close } line numbers, or null. */
export function fenceAround(lines: readonly string[], l: number): { readonly open: number; readonly close: number } | null {
  let open: number | null = null;
  let mark = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const f = FENCE.exec(line);
    const fm = f?.[1] ?? "";

    if (open === null) {
      if (f) {
        open = i;
        mark = fm;
      }
    } else if (f && fm[0] === mark[0] && fm.length >= mark.length && !line.slice(f[0].length).trim()) {
      if (open <= l && l <= i) return { open, close: i };

      open = null;
      mark = "";
    }

    if (i > l && open === null) return null;
  }

  return null;
}

function fence(text: string, s: Sel): Done | null {
  const { lines, eol } = split(text);
  const [from, to] = lineRange(s);
  const around = fenceAround(lines, from);

  if (around && around.close >= to) {
    // In a code block: its fences go.
    lines.splice(around.close, 1);
    lines.splice(around.open, 1);

    const move = (p: Pos): Pos => {
      if (p.line === around.open) return pos(p.line, 0);

      if (p.line === around.close) return pos(around.close - 2, lines[around.close - 2]?.length ?? 0);

      return pos(p.line - (p.line > around.close ? 2 : p.line > around.open ? 1 : 0), p.col);
    };

    return { text: lines.join(eol), sel: { start: move(s.start), end: move(s.end) } };
  }

  const longest = Math.max(2, ...lines.slice(from, to + 1).map((l) => len(/^\s*(`+)/.exec(l)?.[1])));
  const mark = "`".repeat(longest + 1);

  if (from === to && !(lines[from] ?? "").trim()) {
    lines.splice(from, 1, mark, "", mark);

    return { text: lines.join(eol), sel: caret(pos(from + 1, 0)) };
  }

  lines.splice(to + 1, 0, mark);
  lines.splice(from, 0, mark);
  const move = (p: Pos): Pos => pos(p.line + 1, p.col);

  return { text: lines.join(eol), sel: { start: move(s.start), end: move(s.end) } };
}

function rule(text: string, s: Sel): Done {
  const { lines, eol } = split(text);
  const l = s.end.line;

  if (!(lines[l] ?? "").trim()) {
    // An empty line becomes the rule; a line follows it to type on.
    const needBlankAbove = l > 0 && (lines[l - 1] ?? "").trim() ? [""] : [];
    lines.splice(l, 1, ...needBlankAbove, "---", "");
    const at = l + needBlankAbove.length + 1;

    return { text: lines.join(eol), sel: caret(pos(at, 0)) };
  }

  // After the line: a blank line first (or --- under text is a heading).
  lines.splice(l + 1, 0, "", "---", "");

  return { text: lines.join(eol), sel: caret(pos(l + 3, 0)) };
}

// ---- enter in a list

/** Enter at the caret on a list item, task or quote: the next line starts the
 *  same way (`- `, `2. `, `- [ ] `, `> `); on an empty one the marker goes
 *  instead. -> { text, sel }, or null to let the editor take it. */
export function enter(text: string, s: Sel): Done | null {
  if (s.start.line !== s.end.line || s.start.col !== s.end.col) return null;

  const { lines, eol } = split(text);
  const l = s.start.line;
  const line = lines[l] ?? "";
  const col = s.start.col;

  if (fenceAround(lines, l)) return null;

  const t = TASK.exec(line);
  const i = ITEM.exec(line);
  const q = QUOTE.exec(line);
  // The next item's marker: a number counts up.
  const next = (m: string): string => (/^\d/.test(m) ? `${Number(m.slice(0, -1)) + 1}${m.slice(-1)}` : m);
  let marker: string | null = null;
  let head = 0;

  if (t) {
    head = t[0].length;
    marker = (t[1] ?? "") + next(t[2] ?? "") + (t[3] ?? "") + "[ ] ";
  } else if (i) {
    head = i[0].length;
    marker = (i[1] ?? "") + next(i[2] ?? "") + (i[3] || " ");
  } else if (q) {
    head = q[0].length;
    marker = (q[1] ?? "") + ">" + (q[2] || " ");
  }

  if (marker === null || col < head) return null;

  if (!line.slice(head).trim()) {
    // An empty item: enter ends the list (the marker goes).
    lines[l] = "";

    return { text: lines.join(eol), sel: caret(pos(l, 0)) };
  }

  lines.splice(l, 1, line.slice(0, col), marker + line.slice(col));

  return { text: lines.join(eol), sel: caret(pos(l + 1, marker.length)) };
}

// ---- what's on at the caret

/** The commands that are on at a selection: inline marks around it, the line's
 *  heading, list, task, quote, code block. -> a Set of command names. */
export function active(text: string, sel: Sel): Set<string> {
  const s = ordered(sel);
  const { lines } = split(text);
  const on = new Set<string>();
  const l = s.start.line;
  const line = lines[l] ?? "";

  if (s.start.line === s.end.line) {
    for (const kind of ["bold", "italic", "code"] as const) if (spanCovering(line, kind, s.start.col, s.end.col)) on.add(kind);

    if (links(line).some((k) => k.from < s.start.col && s.end.col < k.to)) on.add("link");
  }

  const lv = headingLevel(lines, l);

  if (lv) on.add(`heading-${lv}`);
  const t = TASK.exec(line);

  if (t) {
    on.add("task");

    if (t[4] !== " ") on.add("tick");
  }
  else if (BULLET.test(line)) on.add("bullets");
  else if (ORDERED.test(line)) on.add("numbers");

  if (QUOTE.test(line)) on.add("quote");

  if (fenceAround(lines, l)) on.add("fence");

  return on;
}
