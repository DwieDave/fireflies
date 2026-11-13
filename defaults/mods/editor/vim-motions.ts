// Vim's motions (vim.ts): where a key moves the caret from a place, and how
// an operator takes that span (inclusive, linewise); the word, paragraph,
// bracket, find and search steps they use.

import type { FindKind, Pos, Vim } from "./vim.ts";
import type { Buffer } from "./vim-buffer.ts";
import { cls, cmp, isBlank, isWord } from "./vim-buffer.ts";

// ---- motions: (buf, from, count, vim, arg) -> { to, inclusive?, linewise?, exclusive? } | null

/** Where a motion goes, and how an operator takes it. */
export interface Motion {
  readonly to: Pos;
  readonly inclusive?: boolean;
  readonly exclusive?: boolean;
  readonly linewise?: boolean;
  readonly keepGoal?: boolean;
  readonly stayInLine?: boolean;
  readonly eol?: boolean;
  readonly word?: boolean;
  readonly jump?: boolean;
}

function wordForward(b: Buffer, p: Pos, big: boolean, count: number): Pos {
  let q = p;

  for (let i = 0; i < count; i++) {
    const start = cls(b.at(q), big);
    let n: Pos | null = q;

    // Skip the rest of this word, then blanks and newlines (an empty line stops).
    if (start > 0) while ((n = b.next(q)) && cls(b.at(n), big) === start && b.at(n) !== "\n") q = n;

    n = b.next(q);

    if (!n) return { line: q.line, col: b.len(q.line) };

    q = n;

    for (;;) {
      const c = b.at(q);

      if (c === "\n") {
        const nn = b.next(q);

        if (!nn) break;

        q = nn;

        if (b.len(q.line) === 0) break;

        continue;
      }

      if (!isBlank(c)) break;

      const nn = b.next(q);

      if (!nn) break;

      q = nn;
    }
  }

  return q;
}

export function wordEnd(b: Buffer, p: Pos, big: boolean, count: number): Pos {
  let q = p;

  for (let i = 0; i < count; i++) {
    let n = b.next(q);

    if (!n) return q;

    q = n;

    while (cls(b.at(q), big) <= 0 && (n = b.next(q))) q = n;

    const c = cls(b.at(q), big);

    while ((n = b.next(q)) && cls(b.at(n), big) === c && b.at(n) !== "\n") q = n;
  }

  return q;
}

function wordBack(b: Buffer, p: Pos, big: boolean, count: number): Pos {
  let q = p;

  for (let i = 0; i < count; i++) {
    let n = b.prev(q);

    if (!n) return q;

    q = n;

    while (cls(b.at(q), big) <= 0 && (n = b.prev(q))) {
      if (b.len(q.line) === 0 && q.col === 0 && cmp(q, p) < 0) break;

      q = n;
    }

    const c = cls(b.at(q), big);

    while ((n = b.prev(q)) && cls(b.at(n), big) === c && b.at(n) !== "\n") q = n;
  }

  return q;
}

function wordEndBack(b: Buffer, p: Pos, big: boolean, count: number): Pos {
  let q = p;

  for (let i = 0; i < count; i++) {
    const c0 = cls(b.at(q), big);
    let n: Pos | null;

    while ((n = b.prev(q)) && cls(b.at(n), big) === c0 && c0 > 0) q = n;

    n = b.prev(q);

    if (!n) return q;

    q = n;

    while (cls(b.at(q), big) <= 0 && (n = b.prev(q))) q = n;
  }

  return q;
}

/** Each bracket and its partner. */
const PAIRS: ReadonlyMap<string, string> = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  [")", "("],
  ["]", "["],
  ["}", "{"],
]);

function matchPair(b: Buffer, p: Pos): Pos | null {
  // The first bracket at or after the caret on its line, then its partner.
  const q = { ...p };

  while (q.col < b.len(q.line) && !PAIRS.has(b.at(q))) q.col++;

  const c = b.at(q);
  const other = PAIRS.get(c);

  if (other === undefined) return null;

  const open = "([{".includes(c);
  let depth = 0;
  let n: Pos | null = q;

  while (n) {
    const ch = b.at(n);

    if (ch === c) depth++;
    else if (ch === other && --depth === 0) return n;

    n = open ? b.next(n) : b.prev(n);
  }

  return null;
}

function paragraph(b: Buffer, p: Pos, dir: number, count: number): Pos {
  let l = p.line;

  for (let i = 0; i < count; i++) {
    while (l + dir >= 0 && l + dir <= b.last && b.len(l + dir) === 0) l += dir;

    while (l + dir >= 0 && l + dir <= b.last && b.len(l + dir) !== 0) l += dir;

    l = Math.max(0, Math.min(b.last, l + dir));
  }

  return { line: l, col: dir > 0 && l === b.last && b.len(l) ? b.len(l) - 1 : 0 };
}

function findChar(b: Buffer, p: Pos, kind: FindKind, ch: string, count: number): Pos | null {
  const line = b.line(p.line);
  let col = p.col;

  for (let i = 0; i < count; i++) {
    if (kind === "f" || kind === "t") {
      const from = col + (kind === "t" && i === 0 ? 2 : 1);
      const at = line.indexOf(ch, kind === "t" && i > 0 ? col + 2 : from - (kind === "t" ? 1 : 0));

      if (at < 0) return null;

      col = at;
    } else {
      const at = line.lastIndexOf(ch, col - (kind === "T" && i === 0 ? 2 : 1));

      if (at < 0) return null;

      col = at;
    }
  }

  if (kind === "t") col -= 1;

  if (kind === "T") col += 1;

  return { line: p.line, col };
}

/** The other way: f and F, t and T. */
function flipped(kind: FindKind): FindKind {
  switch (kind) {
    case "f":
      return "F";
    case "F":
      return "f";
    case "t":
      return "T";
    case "T":
      return "t";
  }
}

/** A Vim pattern as a JS RegExp: \< \> word edges, \c ignore case, smart case. */
export function pattern(p: string): RegExp {
  let flags = "g";
  let src = p;

  if (src.includes("\\c")) {
    flags += "i";
    src = src.replace(/\\c/g, "");
  } else if (!/[A-Z]/.test(src)) flags += "i";

  src = src.replace(/\\[<>]/g, "\\b");

  try {
    return new RegExp(src, flags);
  } catch {
    return new RegExp(src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  }
}

export function searchFrom(b: Buffer, p: Pos, pat: string, back: boolean, count: number): Pos | null {
  const text = b.all();
  const re = pattern(pat);
  const hits: number[] = [];

  for (let m = re.exec(text); m; m = re.exec(text)) {
    hits.push(m.index);

    if (m[0] === "") re.lastIndex++;

    if (hits.length > 100000) break;
  }

  const first = hits[0];
  const last = hits.at(-1);

  if (first === undefined || last === undefined) return null;

  let at = b.offset(p);

  for (let i = 0; i < count; i++) at = back ? ([...hits].reverse().find((h) => h < at) ?? last) : (hits.find((h) => h > at) ?? first);

  return b.pos(at);
}

function wordUnder(b: Buffer, p: Pos): string {
  const line = b.line(p.line);
  let s = p.col;
  let e = p.col;

  if (!isWord(line[s] ?? "")) {
    while (s < line.length && !isWord(line[s])) s++;

    e = s;
  }

  while (s > 0 && isWord(line[s - 1])) s--;

  while (e < line.length && isWord(line[e])) e++;

  return line.slice(s, e);
}

export function motion(b: Buffer, vim: Vim, key: string, count: number, arg: string | undefined, hasCount: boolean): Motion | null {
  const p = b.cursor;
  const page = vim.page ?? 15;

  return lineMotion(b, vim, key, count, p) ?? wordMotion(b, key, count, hasCount, p) ?? findMotion(b, vim, key, count, arg, p) ?? screenMotion(b, vim, key, count, hasCount, p, page) ?? null;
}

/** Steps along and across lines: h l j k + - _ 0 ^ $. */
function lineMotion(b: Buffer, vim: Vim, key: string, count: number, p: Pos): Motion | null {
  switch (key) {
    case "h":
    case "<left>":
    case "<bs>":
      return { to: { line: p.line, col: Math.max(0, p.col - count) }, exclusive: true };
    case "l":
    case "<right>":
    case " ":
      return { to: { line: p.line, col: Math.min(b.len(p.line), p.col + count) }, exclusive: true, stayInLine: true };
    case "j":
    case "<down>":
    case "<C-n>":
    case "<C-j>":
      return { to: { line: Math.min(b.last, p.line + count), col: vim.goal ?? p.col }, linewise: true, keepGoal: true };
    case "k":
    case "<up>":
    case "<C-p>":
      return { to: { line: Math.max(0, p.line - count), col: vim.goal ?? p.col }, linewise: true, keepGoal: true };
    case "+":
    case "<cr>":
      return { to: b.firstNonBlank(Math.min(b.last, p.line + count)), linewise: true };
    case "-":
      return { to: b.firstNonBlank(Math.max(0, p.line - count)), linewise: true };
    case "_":
      return { to: b.firstNonBlank(Math.min(b.last, p.line + count - 1)), linewise: true };
    case "0":
    case "<home>":
      return { to: { line: p.line, col: 0 }, exclusive: true };
    case "^":
      return { to: b.firstNonBlank(p.line), exclusive: true };
    case "$":
    case "<end>": {
      const l = Math.min(b.last, p.line + count - 1);

      return { to: { line: l, col: Math.max(0, b.len(l) - 1) }, inclusive: true, eol: true };
    }

    default:
      return null;
  }
}

/** Words, the text's ends, paragraphs and the matching bracket: w W b B e E ge gE gg G } { %. */
function wordMotion(b: Buffer, key: string, count: number, hasCount: boolean, p: Pos): Motion | null {
  switch (key) {
    case "w":
      return { to: wordForward(b, p, false, count), exclusive: true, word: true };
    case "W":
      return { to: wordForward(b, p, true, count), exclusive: true, word: true };
    case "b":
      return { to: wordBack(b, p, false, count), exclusive: true };
    case "B":
      return { to: wordBack(b, p, true, count), exclusive: true };
    case "e":
      return { to: wordEnd(b, p, false, count), inclusive: true };
    case "E":
      return { to: wordEnd(b, p, true, count), inclusive: true };
    case "ge":
      return { to: wordEndBack(b, p, false, count), inclusive: true };
    case "gE":
      return { to: wordEndBack(b, p, true, count), inclusive: true };
    case "gg":
      return { to: b.firstNonBlank(hasCount ? Math.min(b.last, count - 1) : 0), linewise: true, jump: true };
    case "G":
      return { to: b.firstNonBlank(hasCount ? Math.min(b.last, count - 1) : b.last), linewise: true, jump: true };
    case "}":
      return { to: paragraph(b, p, 1, count), exclusive: true, jump: true };
    case "{":
      return { to: paragraph(b, p, -1, count), exclusive: true, jump: true };
    case "%": {
      if (hasCount) return { to: b.firstNonBlank(Math.min(b.last, Math.floor((count * (b.last + 1) + 99) / 100) - 1)), linewise: true };

      const q = matchPair(b, p);

      return q && { to: q, inclusive: true, jump: true };
    }

    default:
      return null;
  }
}

/** Finds and searches: f F t T ; , n N * #, and marks ` '. */
function findMotion(b: Buffer, vim: Vim, key: string, count: number, arg: string | undefined, p: Pos): Motion | null {
  switch (key) {
    case "f":
    case "F":
    case "t":
    case "T": {
      if (arg === undefined) return null;

      vim.lastFind = { kind: key, ch: arg };

      const q = findChar(b, p, key, arg, count);

      return q && { to: q, inclusive: key === "f" || key === "t", exclusive: key === "F" || key === "T" };
    }

    case ";":
    case ",": {
      const f = vim.lastFind;

      if (!f) return null;

      const kind = key === ";" ? f.kind : flipped(f.kind);
      const q = findChar(b, p, kind, f.ch, count);

      return q && { to: q, inclusive: kind === "f" || kind === "t", exclusive: kind === "F" || kind === "T" };
    }

    case "n":
    case "N": {
      const s = vim.search;

      if (!s) return null;

      const q = searchFrom(b, p, s.pattern, key === "N" ? !s.back : s.back, count);

      return q && { to: q, exclusive: true, jump: true };
    }

    case "*":
    case "#": {
      const w = wordUnder(b, p);

      if (!w) return null;

      const search = { pattern: `\\<${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\>`, back: key === "#" };

      vim.search = search;

      const q = searchFrom(b, p, search.pattern, key === "#", count);

      return q && { to: q, exclusive: true, jump: true };
    }

    case "`":
    case "'": {
      const m = vim.marks.get(arg ?? "");

      if (!m) return null;

      return key === "'" ? { to: b.firstNonBlank(Math.min(b.last, m.line)), linewise: true, jump: true } : { to: b.clamp(m), exclusive: true, jump: true };
    }

    // The screen's top / middle / bottom line (H M L; a count: that many from the top / bottom).
    default:
      return null;
  }
}

/** The screen and pages: H M L, ctrl-d / ctrl-u, ctrl-f / ctrl-b. */
function screenMotion(b: Buffer, vim: Vim, key: string, count: number, hasCount: boolean, p: Pos, page: number): Motion | null {
  switch (key) {
    case "H":
    case "M":
    case "L": {
      const top = Math.max(0, Math.min(b.last, vim.top ?? 0));
      const bottom = Math.max(top, Math.min(b.last, top + (vim.rows ?? 2 * page) - 1));
      const line = key === "H" ? Math.min(bottom, top + count - 1) : key === "L" ? Math.max(top, bottom - count + 1) : Math.floor((top + bottom) / 2);

      return { to: b.firstNonBlank(line), linewise: true, jump: true };
    }

    case "<C-d>":
      return { to: { line: Math.min(b.last, p.line + (hasCount ? count : page)), col: p.col }, linewise: true };
    case "<C-u>":
      return { to: { line: Math.max(0, p.line - (hasCount ? count : page)), col: p.col }, linewise: true };
    case "<C-f>":
    case "<pgdn>":
      return { to: { line: Math.min(b.last, p.line + 2 * page * count), col: p.col }, linewise: true };
    case "<C-b>":
    case "<pgup>":
      return { to: { line: Math.max(0, p.line - 2 * page * count), col: p.col }, linewise: true };
    default:
      return null;
  }
}

export const MOTION_ARG = new Set(["f", "F", "t", "T", "`", "'"]);
export const MOTIONS = new Set(["h", "j", "k", "l", "<left>", "<right>", "<up>", "<down>", "<bs>", " ", "+", "-", "_", "<cr>", "0", "^", "$", "<home>", "<end>", "w", "W", "b", "B", "e", "E", "ge", "gE", "gg", "G", "}", "{", "%", "f", "F", "t", "T", ";", ",", "n", "N", "*", "#", "`", "'", "<C-d>", "<C-u>", "<C-f>", "<C-b>", "<pgup>", "<pgdn>", "<C-n>", "<C-p>", "<C-j>", "H", "M", "L"]);
