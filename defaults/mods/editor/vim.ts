// Vim for the editor: a state machine over the text, no app calls, so
// scripts/nocturne-vim.test.ts can drive it key by key. The editor hands it
// every keystroke first (EditorState.on("key")); it answers whether it took
// the key and what to do: edits, where the caret goes, selections, the mode
// (so the caret's shape and the bar follow), registers for the clipboard,
// and commands for the editor (save, quit, find, definition...).
//
// Behaviour follows Vim (and Zed's vim mode, whose tests guided the cases;
// no code is taken from it): normal, insert, replace, visual (char, line,
// block) modes; counts; operators d c y > < g~ gu gU with motions and text
// objects; registers "a-z (A-Z appends), "0, "_ and "+ (the system
// clipboard); . repeat; q / @ macros; m / ` ' marks; / ? n N * #; f F t T ; ,;
// the ex line (:w :q :wq :x :e! :s :%s :<line> :noh); and a leader key
// (space) whose next keys a which-key popup shows.
//
// Insert mode keeps typing native (IME, autoclose, autoindent): the keys pass
// through, and what was typed is read back from the text when insert mode
// ends, for `.` and macros.

import type { KeyEvent } from "gpui-kit";
import type { EditorPosition } from "gpui-base";
import { isString, literal } from "./guard.ts";

/** Positions are { line, col }: zero-based, columns in JS string units. */
export type Pos = EditorPosition;

/** Vim's modes: normal, insert, replace and the three visual ones (char, line, block). */
export type Mode = "normal" | "insert" | "replace" | "visual" | "vline" | "vblock";

/** A key as vim takes it: a token (`x`, `<esc>`, `<C-r>`), or text a replay inserts. */
export type Key = string | Insertion;

/** Text typed in insert mode, replayed as one insertion (`.`, a macro). */
export interface Insertion {
  readonly insert: string;
}

/** A register's text and whether it holds whole lines. */
export interface Register {
  readonly text: string;
  readonly linewise: boolean;
}

/** f F t T: to or till a character, forward or back. */
export type FindKind = "f" | "F" | "t" | "T";

/** One edit: [start, end) replaced by `text` (EditorState.edit's). */
export interface Edit {
  readonly start: Pos;
  readonly end: Pos;
  readonly text: string;
}

/** A selection; `head`: which end the caret is at (visual and line-visual). */
export interface Selection {
  readonly start: Pos;
  readonly end: Pos;
  readonly head?: "start" | "end";
}

/** What the leader's next keys can be: an entry to run [command, label], or a node of more keys. */
export type LeaderEntry = readonly [command: string, label: string];

/** A node of the leader map: its name (the which-key popup's +name) and what each key
 *  (a typed character: data) does there, in the popup's order. */
export interface LeaderNode {
  readonly name: string;
  readonly keys: ReadonlyMap<string, LeaderStep>;
}

/** What a key after the leader is: an entry to run, or a node of more keys. */
export type LeaderStep = LeaderEntry | LeaderNode;

const node = (name: string, keys: readonly (readonly [string, LeaderStep])[]): LeaderNode => ({ name, keys: new Map(keys) });

/** A key of the which-key popup and what it does. */
export interface Which {
  readonly key: string;
  readonly label: string;
}

const isWord = (c: string | undefined): boolean => /[\p{L}\p{N}_]/u.test(c ?? "");

const isBlank = (c: string | undefined): boolean => c === " " || c === "\t";

const cls = (c: string | undefined, big: boolean): number => (c === undefined || c === "" ? -1 : isBlank(c) ? 0 : big ? 1 : isWord(c) ? 1 : 2);

const cmp = (a: Pos, b: Pos): number => a.line - b.line || a.col - b.col;

const minPos = (a: Pos, b: Pos): Pos => (cmp(a, b) <= 0 ? a : b);

const maxPos = (a: Pos, b: Pos): Pos => (cmp(a, b) <= 0 ? b : a);

/** `command` `n` times (a count). */
const times = (n: number, command: string): string[] => Array.from({ length: n }, () => command);

/** The default leader map: key sequences after the leader and what they do. */
export const LEADER: LeaderNode = node("leader", [
  ["f", node("find", [["f", ["picker", "files"]], ["g", ["grep", "grep"]], ["b", ["picker", "files"]]])],
  ["e", ["files-pane", "files pane"]],
  ["w", ["save", "save"]],
  ["q", ["quit", "close"]],
  ["b", node("tabs", [["n", ["next-tab", "next tab"]], ["p", ["prev-tab", "previous tab"]], ["d", ["close-tab", "close tab"]], ["l", ["tabs", "list tabs"]], ["<", ["move-tab-left", "move tab left"]], [">", ["move-tab-right", "move tab right"]], ["o", ["pop-out", "pop out into its own pane"]], ["i", ["pop-in", "into the editor beside"]], ["m", ["tab-menu", "tab menu"]]])],
  ["d", ["problems", "problems"]],
  ["h", ["hover", "hover"]],
  ["c", node("code", [["a", ["code-action", "code action"]], ["f", ["format", "format"]]])],
  ["r", node("refactor", [["n", ["rename", "rename"]]])],
  ["g", node("go", [["d", ["definition", "definition"]], ["r", ["references", "references"]]])],
  ["?", ["keys", "keys"]],
  ["u", node("toggle", [["w", ["wrap", "word wrap"]]])],
  ["m", node("markdown", [["p", ["preview", "view: rendered / split / preview / text"]], ["r", ["preview-rendered", "rendered"]], ["s", ["preview-split", "preview beside"]], ["v", ["preview-only", "preview only"]], ["t", ["preview-text", "text only"]]])],
  // The Markdown commands (mdedit.ts), by the letters cmd-. takes (the levels first, as the popup lists them).
  [".", node("markdown commands", [
    ["0", ["md-heading-0", "text"]], ["1", ["md-heading-1", "heading 1"]], ["2", ["md-heading-2", "heading 2"]], ["3", ["md-heading-3", "heading 3"]],
    ["b", ["md-bold", "bold"]], ["i", ["md-italic", "italic"]], ["`", ["md-code", "inline code"]], ["k", ["md-link", "link"]],
    ["h", ["md-heading-up", "heading up"]], ["H", ["md-heading-down", "heading down"]],
    ["l", ["md-bullets", "bullet list"]], ["n", ["md-numbers", "numbered list"]], ["t", ["md-task", "task box"]], ["x", ["md-tick", "tick"]],
    ["q", ["md-quote", "quote"]], ["c", ["md-fence", "code block"]], ["r", ["md-rule", "rule"]], ["p", ["md-image", "image from a file"]], ["v", ["md-image-paste", "paste an image"]],
  ])],
]);

/** Where insert mode began: the text and caret then, the keys that entered it. */
export interface InsertStart {
  text: string;
  cursor: Pos;
  keys: readonly Key[];
  typed?: boolean;
}

/** A macro being recorded into register `reg` (`append`: "A-Z adds to it). */
export interface Recording {
  readonly reg: string;
  readonly keys: Key[];
  readonly append: boolean;
}

/** The state of one editor's vim. */
export interface Vim {
  mode: Mode;
  /** The pending command's keys. */
  keys: string[];
  registers: Map<string, Register>;
  marks: Map<string, Pos>;
  /** Visual mode's other end. */
  anchor: Pos | null;
  /** Visual mode's caret (the editor's sits at the selection's end). */
  head: Pos | null;
  /** The column j / k keep to. */
  goal: number | null;
  /** For `.`. */
  lastChange: { readonly keys: readonly Key[]; readonly inserted: string | null } | null;
  recording: Recording | null;
  lastMacro: string | null;
  lastFind: { readonly kind: FindKind; readonly ch: string } | null;
  search: { readonly pattern: string; readonly back: boolean } | null;
  /** The ex line being typed, or null. */
  ex: string | null;
  /** While inserting. */
  insertStart: InsertStart | null;
  leader: string;
  leaderMap: LeaderNode;
  /** The leader map node being walked. */
  pendingLeader: LeaderNode | null;
  replaying: boolean;
  message: string | null;
  lastVisual: Mode | null;
  /** What was last yanked or deleted, for the system clipboard. */
  clipboard?: Register;
  /** The editor's indent unit (its tab size), and the view: half a page, the top line, rows shown. */
  indent: string | null;
  shiftCount: number;
  page: number | null;
  top: number | null;
  rows: number | null;
}

/** What createVim takes: the leader key and its map. */
export interface VimOptions {
  readonly leader?: string;
  readonly leaderMap?: LeaderNode;
}

export function createVim(options: VimOptions = {}): Vim {
  return {
    mode: "normal",
    keys: [],
    registers: new Map(),
    marks: new Map(),
    anchor: null,
    head: null,
    goal: null,
    lastChange: null,
    recording: null,
    lastMacro: null,
    lastFind: null,
    search: null,
    ex: null,
    insertStart: null,
    leader: options.leader ?? " ",
    leaderMap: options.leaderMap ?? LEADER,
    pendingLeader: null,
    replaying: false,
    message: null,
    lastVisual: null,
    indent: null,
    shiftCount: 1,
    page: null,
    top: null,
    rows: null,
  };
}

/** Keys with a name of their own, as vim spells them. */
const NAMED: ReadonlyMap<string, string> = new Map([
  ["escape", "<esc>"],
  ["enter", "<cr>"],
  ["backspace", "<bs>"],
  ["tab", "<tab>"],
  ["up", "<up>"],
  ["down", "<down>"],
  ["left", "<left>"],
  ["right", "<right>"],
  ["delete", "<del>"],
  ["home", "<home>"],
  ["end", "<end>"],
  ["pageup", "<pgup>"],
  ["pagedown", "<pgdn>"],
  ["space", " "],
]);

/** The key a keystroke event names: a typed character, else `<esc>`,
 *  `<cr>`, `<bs>`, `<tab>`, `<C-r>`, `<up>`...; null for one vim leaves to
 *  the app (cmd combinations). */
export function token(e: KeyEvent): string | null {
  const m = e.modifiers;

  if (m.platform) return null;

  const k = e.key;
  const named = NAMED.get(k);

  if (m.control) {
    if (k === "[") return "<esc>";

    return k.length === 1 ? `<C-${k.toLowerCase()}>` : named ? `<C-${named.slice(1, -1)}>` : null;
  }

  if (m.alt) return null;

  if (named && k !== "space") return named;

  if (isString(e.key_char) && e.key_char !== "") return e.key_char;

  if (k === "space") return " ";

  return k.length === 1 ? (m.shift ? k.toUpperCase() : k) : null;
}

// ---- the buffer

/** A working copy of the text the keys act on; edits are recorded as they're made. */
class Buffer {
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

// ---- motions: (buf, from, count, vim, arg) -> { to, inclusive?, linewise?, exclusive? } | null

/** Where a motion goes, and how an operator takes it. */
interface Motion {
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

function wordEnd(b: Buffer, p: Pos, big: boolean, count: number): Pos {
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

function searchFrom(b: Buffer, p: Pos, pat: string, back: boolean, count: number): Pos | null {
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

function motion(b: Buffer, vim: Vim, key: string, count: number, arg: string | undefined, hasCount: boolean): Motion | null {
  const p = b.cursor;
  const page = vim.page ?? 15;

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

const MOTION_ARG = new Set(["f", "F", "t", "T", "`", "'"]);
const MOTIONS = new Set(["h", "j", "k", "l", "<left>", "<right>", "<up>", "<down>", "<bs>", " ", "+", "-", "_", "<cr>", "0", "^", "$", "<home>", "<end>", "w", "W", "b", "B", "e", "E", "ge", "gE", "gg", "G", "}", "{", "%", "f", "F", "t", "T", ";", ",", "n", "N", "*", "#", "`", "'", "<C-d>", "<C-u>", "<C-f>", "<C-b>", "<pgup>", "<pgdn>", "<C-n>", "<C-p>", "<C-j>", "H", "M", "L"]);

// ---- text objects: (buf, cursor, around, kind, count) -> { start, end, linewise? } (end exclusive)

/** Text an operator covers: [start, end), or the whole lines start..end (linewise). */
interface Span {
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

function textObject(b: Buffer, p: Pos, around: boolean, kind: string, count: number): Span | null {
  const line = b.line(p.line);

  if (kind === "w" || kind === "W") {
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

  if (kind.length === 1 && `"'\``.includes(kind)) {
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

  const pair = BRACKETS.get(kind);

  if (pair) {
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

  if (kind === "t") {
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

  if (kind === "p") {
    const blank = (l: number): boolean => b.line(l).trim() === "";
    const k = blank(p.line);
    let s = p.line;
    let e = p.line;

    while (s > 0 && blank(s - 1) === k) s--;

    while (e < b.last && blank(e + 1) === k) e++;

    if (around) while (e < b.last && blank(e + 1) !== k) e++;

    return { start: { line: s, col: 0 }, end: { line: e, col: b.len(e) }, linewise: true };
  }

  return null;
}

// ---- the machine

/** Why a register is set: a yank fills "0, a delete "1-"9 or "-. */
type RegKind = "yank" | "delete";

function setReg(vim: Vim, name: string | null, text: string, linewise: boolean, kind: RegKind): void {
  if (name === "_") return;

  const value = { text, linewise };

  if (name && /[A-Z]/.test(name)) {
    const r = vim.registers.get(name.toLowerCase());

    vim.registers.set(name.toLowerCase(), r ? { text: r.text + (r.linewise && !linewise ? "\n" : "") + text, linewise: r.linewise || linewise } : value);
  } else if (name && name !== '"') vim.registers.set(name, value);

  vim.registers.set('"', value);

  if (kind === "yank" && (!name || name === '"')) vim.registers.set("0", value);

  if (kind === "delete" && (!name || name === '"')) {
    if (linewise || text.includes("\n")) {
      for (let i = 9; i > 1; i--) {
        const was = vim.registers.get(String(i - 1));

        if (was) vim.registers.set(String(i), was);
      }

      vim.registers.set("1", value);
    } else vim.registers.set("-", value);
  }

  // Everything yanked or deleted also goes to the system clipboard (clipboard=unnamedplus).
  vim.clipboard = { text, linewise };
}

function getReg(vim: Vim, name: string | null, clipboard: string | null | undefined): Register | null {
  if (name === "+" || name === "*") return clipboard ? { text: clipboard, linewise: clipboard.endsWith("\n") } : (vim.registers.get("+") ?? null);

  if (!name || name === '"') {
    // Another app's copy wins over the last yank when it differs.
    const own = vim.registers.get('"');

    if (clipboard !== null && clipboard !== undefined && clipboard !== "" && clipboard !== own?.text && clipboard !== (own?.text ?? "") + "\n") return { text: clipboard, linewise: clipboard.endsWith("\n") && !own };

    return own ?? null;
  }

  return vim.registers.get(name.toLowerCase()) ?? null;
}

/** The range an operator covers from a motion. -> { start, end, linewise } */
function rangeOf(b: Buffer, from: Pos, m: Motion): Span {
  const start = minPos(from, m.to);
  let end = maxPos(from, m.to);

  if (m.linewise) return { start: { line: start.line, col: 0 }, end: { line: end.line, col: b.len(end.line) }, linewise: true };

  if (m.inclusive) end = { line: end.line, col: Math.min(b.len(end.line), end.col + 1) };

  // `cw` on a word is `ce`; `dw` at a line's last word stops at the line end.
  if (m.word && end.line > start.line) end = { line: start.line, col: b.len(start.line) };

  return { start, end, linewise: false };
}

function deleteLines(b: Buffer, s: number, e: number): Pos {
  // Lines s..e whole, with their newline.
  if (e < b.last) return b.replace({ line: s, col: 0 }, { line: e + 1, col: 0 }, "");

  if (s > 0) return b.replace({ line: s - 1, col: b.len(s - 1) }, { line: e, col: b.len(e) }, "");

  return b.replace({ line: s, col: 0 }, { line: e, col: b.len(e) }, "");
}

/** An operator: delete, change, yank, indent, outdent, case. */
const isOperator = literal("d", "c", "y", ">", "<", "g~", "gu", "gU", "~");

type Operator = "d" | "c" | "y" | ">" | "<" | "g~" | "gu" | "gU" | "~";

function applyOperator(b: Buffer, vim: Vim, op: Operator, r: Span, reg: string | null, out: FeedResult): void {
  const textOf = (): string => (r.linewise ? b.text({ line: r.start.line, col: 0 }, { line: r.end.line, col: b.len(r.end.line) }) + "\n" : b.text(r.start, r.end));
  const linewise = r.linewise === true;

  switch (op) {
    case "y":
      setReg(vim, reg, textOf(), linewise, "yank");
      b.cursor = r.linewise ? { line: r.start.line, col: b.cursor.col } : r.start;
      clipboardTo(out, vim);

      return;
    case "d": {
      setReg(vim, reg, textOf(), linewise, "delete");
      clipboardTo(out, vim);

      if (r.linewise) {
        deleteLines(b, r.start.line, r.end.line);
        b.cursor = b.firstNonBlank(Math.min(r.start.line, b.last));
      } else {
        b.replace(r.start, r.end, "");
        b.cursor = b.clamp(r.start);
      }

      return;
    }

    case "c": {
      setReg(vim, reg, textOf(), linewise, "delete");
      clipboardTo(out, vim);

      if (r.linewise) {
        const indent = b.line(r.start.line).match(/^\s*/)?.[0] ?? "";

        b.replace({ line: r.start.line, col: 0 }, { line: r.end.line, col: b.len(r.end.line) }, indent);
        b.cursor = { line: r.start.line, col: indent.length };
      } else {
        b.replace(r.start, r.end, "");
        b.cursor = r.start;
      }

      enterInsert(vim, b);

      return;
    }

    case ">":
    case "<": {
      const unit = vim.indent ?? "  ";

      for (let l = r.start.line; l <= r.end.line; l++) {
        const line = b.line(l);

        if (op === ">") {
          if (line.length) b.replace({ line: l, col: 0 }, { line: l, col: 0 }, unit.repeat(vim.shiftCount));
        } else {
          const n = Math.min((line.match(/^ */)?.[0] ?? "").length, unit.length * vim.shiftCount);
          const tabs = line.startsWith("\t") ? 1 : 0;

          if (n || tabs) b.replace({ line: l, col: 0 }, { line: l, col: n || tabs }, "");
        }
      }

      b.cursor = b.firstNonBlank(r.start.line);

      return;
    }

    case "g~":
    case "gu":
    case "gU":
    case "~": {
      const from = r.linewise ? { line: r.start.line, col: 0 } : r.start;
      const to = r.linewise ? { line: r.end.line, col: b.len(r.end.line) } : r.end;
      const t = b.text(from, to);

      const f = (s: string): string =>
        op === "gu"
          ? s.toLowerCase()
          : op === "gU"
            ? s.toUpperCase()
            : [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join("");

      b.replace(from, to, f(t));
      b.cursor = r.linewise ? { line: r.start.line, col: b.cursor.col } : r.start;
    }
  }
}

/** What was yanked or deleted, for the editor to put on the system clipboard. */
function clipboardTo(out: FeedResult, vim: Vim): void {
  if (vim.clipboard) out.clipboard = vim.clipboard;
}

function enterInsert(vim: Vim, b: Buffer, mode: Mode = "insert"): void {
  vim.mode = mode;
  vim.insertStart = { text: b.all(), cursor: { ...b.cursor }, keys: [] };
}

function put(b: Buffer, vim: Vim, reg: string | null, after: boolean, count: number, clipboard: string | null | undefined): void {
  const r = getReg(vim, reg, clipboard);

  if (!r) return;

  const text = r.text.repeat(count);

  if (r.linewise) {
    const body = text.endsWith("\n") ? text.slice(0, -1) : text;

    if (after) {
      b.replace({ line: b.cursor.line, col: b.len(b.cursor.line) }, { line: b.cursor.line, col: b.len(b.cursor.line) }, "\n" + body);
      b.cursor = b.firstNonBlank(b.cursor.line + 1);
    } else {
      b.replace({ line: b.cursor.line, col: 0 }, { line: b.cursor.line, col: 0 }, body + "\n");
      b.cursor = b.firstNonBlank(b.cursor.line);
    }
  } else {
    const at = after && b.len(b.cursor.line) ? { line: b.cursor.line, col: b.cursor.col + 1 } : b.cursor;
    const end = b.replace(at, at, text);

    b.cursor = text.includes("\n") ? at : b.clamp({ line: end.line, col: end.col - 1 });
  }
}

/** A parsed command: its register and count, and an operator with its line, object or
 *  motion, or a key (with its argument: f's character, m's mark...). */
export interface Command {
  readonly done: true;
  readonly reg: string | null;
  readonly count: number;
  readonly has: boolean;
  readonly op?: Operator;
  readonly line?: boolean;
  readonly obj?: string;
  readonly around?: boolean;
  readonly key?: string;
  readonly arg?: string;
}

/** Visual mode's keys: operators act at once on the selection. */
const VISUAL_KEYS = new Set(["d", "c", "y", ">", "<", "x", "X", "D", "Y", "C", "S", "R", "p", "P", "J", "o", "O", "I", "A", "~", "u", "U", "s", "v", "V", "<C-v>", "<del>"]);

/** A count typed before a command (null: none), and where the command goes on. */
interface CountAt {
  readonly count: number | null;
  readonly next: number;
}

/** The digits of a count at keys[i] (a leading 0 is a motion), and the index after them. */
function countAt(keys: readonly string[], from: number): CountAt {
  let i = from;
  let s = "";

  while (i < keys.length && /[0-9]/.test(keys[i] ?? "") && !(s === "" && keys[i] === "0")) s += keys[i++] ?? "";

  return { count: s ? Number(s) : null, next: i };
}

export function parseVisual(keys: readonly string[]): Command | null | false {
  let i = 0;
  let reg: string | null = null;

  if (keys[0] === '"') {
    if (keys.length < 2) return null;

    reg = keys[1] ?? null;
    i = 2;
  }

  const c = countAt(keys, i);

  i = c.next;

  const k = keys[i];

  if (k === undefined) return null;

  const count = c.count ?? 1;
  const has = c.count !== null;

  if (VISUAL_KEYS.has(k)) return { done: true, reg, key: k, count, has };

  if (k === "r") {
    const arg = keys[i + 1];

    return arg === undefined ? null : { done: true, reg, key: "r", arg, count, has };
  }

  if (k === "g") {
    const next = keys[i + 1];

    if (next === undefined) return null;

    const g = "g" + next;

    if (g === "gu" || g === "gU" || g === "g~") return { done: true, reg, key: g, count, has };

    if (g === "gv" || g === "gJ") return { done: true, reg, key: g, count, has };
  }

  return parse(keys);
}

/** Parses a pending normal-mode command; -> { done, reg, count, op, key, arg, obj } or null (needs more keys) or false (invalid). */
export function parse(keys: readonly string[]): Command | null | false {
  let i = 0;
  let reg: string | null = null;

  if (keys[i] === '"') {
    if (keys.length < 2) return null;

    reg = keys[1] ?? null;
    i = 2;
  }

  const c = countAt(keys, i);
  const count = c.count;

  i = c.next;

  if (i >= keys.length) return null;

  if (keys[i] === "g" && i + 1 >= keys.length) return null;

  const named = keys[i] === "g" ? "g" + (keys[i + 1] ?? "") : (keys[i] ?? "");

  if (isOperator(named) && named !== "~") {
    const op = named;

    i += op.length;

    const oc = countAt(keys, i);
    const opCount = oc.count;

    i = oc.next;

    if (i >= keys.length) return null;

    const total = (count ?? 1) * (opCount ?? 1);
    const has = count !== null || opCount !== null;
    // dd cc yy >> << g~~ guu gUU (and gugu...)
    const last = op.at(-1);

    if (keys[i] === last || (op.length === 2 && keys[i] === "g" && keys[i + 1] === op[1])) return { done: true, reg, op, line: true, count: total, has };

    if (keys[i] === "i" || keys[i] === "a") {
      const obj = keys[i + 1];

      if (obj === undefined) return null;

      return { done: true, reg, op, obj, around: keys[i] === "a", count: total, has };
    }

    let key = keys[i] ?? "";

    if (key === "g") {
      if (i + 1 >= keys.length) return null;

      key = "g" + (keys[i + 1] ?? "");
      i++;
    }

    if (!MOTIONS.has(key)) return false;

    if (MOTION_ARG.has(key)) {
      const arg = keys[i + 1];

      if (arg === undefined) return null;

      return { done: true, reg, op, key, arg, count: total, has };
    }

    return { done: true, reg, op, key, count: total, has };
  }

  let key = keys[i] ?? "";

  if (key === "g" || key === "Z" || key === "[" || key === "]" || key === "z") {
    if (i + 1 >= keys.length) return null;

    key = key + (keys[i + 1] ?? "");
    i++;
  }

  if (MOTION_ARG.has(key) || ["r", "m", "q", "@"].includes(key)) {
    const arg = keys[i + 1];

    if (arg === undefined) return null;

    return { done: true, reg, key, arg, count: count ?? 1, has: count !== null };
  }

  return { done: true, reg, key, count: count ?? 1, has: count !== null };
}

/** The editor's text as vim acts on it: its text and caret, the system clipboard's text,
 *  half a page, the top line and rows shown, how many tabs the pane has. */
export interface Doc {
  readonly text: string;
  readonly cursor: Pos;
  readonly clipboard?: string | null;
  readonly page?: number;
  readonly top?: number;
  readonly rows?: number;
  readonly tabs?: number;
}

/** Keys to play again: a macro, or `.` (`repeat`). */
export interface Replay {
  readonly keys: readonly Key[];
  readonly times: number;
  readonly repeat?: boolean;
}

/** What a key came to (what changed; omitted keys mean unchanged). */
export interface FeedResult {
  taken: boolean;
  commands: string[];
  edits?: Edit[];
  cursor?: Pos;
  selections?: Selection[] | null;
  mode?: Mode;
  clipboard?: Register;
  message?: string;
  ex?: string | null;
  pending?: string;
  which?: Which[] | null;
  recording?: null;
  replay?: Replay;
  multi?: Pos[];
  keepGoal?: boolean;
  search?: string;
}

/** The mode as it is now (a command may have changed it since it was looked at). */
const modeOf = (vim: Vim): Mode => vim.mode;

const isVisual = (mode: Mode): boolean => mode === "visual" || mode === "vline" || mode === "vblock";

/**
 * Feeds one key. `doc`: { text, cursor, clipboard? } as the editor has them
 * now. -> { taken, edits, cursor, selections, mode, commands, clipboard,
 * message, ex, pending, which } (what changed; omitted keys mean unchanged).
 */
export function feed(vim: Vim, key: Key | null | undefined, doc: Doc): FeedResult {
  const out: FeedResult = { taken: true, commands: [] };

  if (key === null || key === undefined) return { taken: false, commands: [] };

  // Macro recording (not of the q that ends it).
  if (vim.recording && !vim.replaying && !(vim.mode !== "insert" && vim.keys.length === 0 && key === "q")) vim.recording.keys.push(key);

  if (vim.ex !== null) return exKey(vim, vim.ex, key, doc, out);

  if (vim.mode === "insert" || vim.mode === "replace") return insertKey(vim, key, doc, out);

  // Text to insert only comes while inserting (a replay's).
  if (!isString(key)) return out;

  // In visual modes the editor's caret sits at the selection's end, not on
  // vim's head: the head is vim's own.
  const visual = isVisual(vim.mode);
  const b = new Buffer(doc.text, visual && vim.head ? vim.head : doc.cursor);

  vim.page = doc.page ?? vim.page;
  vim.top = doc.top ?? vim.top;
  vim.rows = doc.rows ?? vim.rows;

  if (vim.pendingLeader) return leaderKey(vim, vim.pendingLeader, key, out);

  if (vim.keys.length === 0 && key === vim.leader && vim.mode === "normal") {
    vim.pendingLeader = vim.leaderMap;
    out.which = whichOf(vim.pendingLeader);

    return out;
  }

  if (key === "<esc>") {
    vim.keys = [];

    if (vim.mode !== "normal") {
      vim.mode = "normal";
      vim.anchor = null;
      vim.head = null;
      out.mode = "normal";
      out.cursor = b.clamp(b.cursor);
      out.selections = null;
    }

    out.taken = true;
    out.pending = "";

    return out;
  }

  if (key === ":" && vim.keys.length === 0) {
    vim.ex = vim.mode.startsWith("v") ? "'<,'>" : "";

    if (vim.mode !== "normal") {
      const anchor = vim.anchor ?? b.cursor;

      vim.marks.set("<", minPos(anchor, b.cursor));
      vim.marks.set(">", maxPos(anchor, b.cursor));
    }

    out.ex = vim.ex;

    return out;
  }

  if ((key === "/" || key === "?") && vim.keys.length === 0) {
    vim.ex = key;
    out.ex = key;

    return out;
  }

  // q ends a recording.
  if (vim.recording && vim.keys.length === 0 && key === "q" && vim.mode === "normal") {
    out.message = `recorded @${stopRecording(vim) ?? ""}`;
    out.recording = null;

    return out;
  }

  vim.keys.push(key);

  // Visual mode: i / a then an object extends the selection over it (viw, va").
  if ((vim.mode === "visual" || vim.mode === "vline") && (vim.keys[0] === "i" || vim.keys[0] === "a")) {
    const [ia, obj] = vim.keys;

    if (obj === undefined) {
      out.pending = vim.keys.join("");

      return out;
    }

    vim.keys = [];

    const r = textObject(b, b.cursor, ia === "a", obj, 1);

    if (r) {
      if (r.linewise && vim.mode === "visual") vim.mode = "vline";

      vim.anchor = r.start;
      b.cursor = cmp(r.end, r.start) > 0 ? (b.prev(r.end) ?? r.end) : r.end;
    }

    out.cursor = b.cursor;
    out.mode = vim.mode;
    out.selections = visualSelections(vim.mode, vim.anchor ?? b.cursor, b);
    out.pending = "";
    vim.head = { ...b.cursor };

    return out;
  }

  const cmd = isVisual(vim.mode) ? parseVisual(vim.keys) : parse(vim.keys);

  if (cmd === null) {
    out.pending = vim.keys.join("");

    return out;
  }

  const keys = vim.keys;

  vim.keys = [];
  out.pending = "";

  if (cmd === false) return out;

  const before = { ...b.cursor };
  const result = vim.mode.startsWith("v") ? visualCommand(vim, cmd, b, doc, out) : normalCommand(vim, cmd, b, doc, out);

  if (result === "unknown") {
    out.taken = !(keys.length === 1 && (keys[0] ?? "").startsWith("<C-"));

    return out;
  }

  // Only a change counts for `.` (not undo, `.` itself, motions or yanks).
  const changed = result === true;
  // The mode the command left (it may have entered insert mode).
  const mode = modeOf(vim);

  if (changed && !vim.replaying && mode !== "insert") vim.lastChange = { keys, inserted: null };

  if (changed && mode === "insert" && vim.insertStart) vim.insertStart.keys = keys;

  out.edits = b.edits;

  if (mode === "normal" || mode === "insert" || mode === "replace") out.cursor = mode === "normal" ? b.clamp(b.cursor) : b.clamp(b.cursor, true);
  else out.cursor = b.cursor;

  if (cmp(before, b.cursor) !== 0 && !out.keepGoal) vim.goal = null;

  out.mode = vim.mode;

  if (isVisual(vim.mode)) {
    out.selections = visualSelections(vim.mode, vim.anchor ?? b.cursor, b);
    vim.head = { ...b.cursor };
  } else vim.head = null;

  return out;
}

function whichOf(at: LeaderNode): Which[] {
  return [...at.keys].map(([k, v]) => ({ key: k === " " ? "space" : k, label: isEntry(v) ? v[1] : `+${v.name}` }));
}

/** A leader entry to run, not a node of more keys. */
const isEntry = (step: LeaderStep): step is LeaderEntry => Array.isArray(step);

function leaderKey(vim: Vim, at: LeaderNode, key: string, out: FeedResult): FeedResult {
  if (key === "<esc>") {
    vim.pendingLeader = null;
    out.which = null;

    return out;
  }

  const next = at.keys.get(key);

  if (next === undefined) {
    vim.pendingLeader = null;
    out.which = null;
    out.message = `leader: nothing on ${key}`;

    return out;
  }

  if (isEntry(next)) {
    vim.pendingLeader = null;
    out.which = null;
    out.commands.push(next[0]);

    return out;
  }

  vim.pendingLeader = next;
  out.which = whichOf(next);

  return out;
}

/** What a command came to: a change (true), none (false), only commands for the editor
 *  ("nochange"), a key vim doesn't know ("unknown"), or an object still to come. */
type Outcome = boolean | "nochange" | "unknown" | "pending-object";

function normalCommand(vim: Vim, cmd: Command, b: Buffer, doc: Doc, out: FeedResult): Outcome {
  const p = b.cursor;
  const n = cmd.count;

  if (cmd.op) {
    let r: Span;

    if (cmd.line) {
      const e = Math.min(b.last, p.line + n - 1);

      r = { start: { line: p.line, col: 0 }, end: { line: e, col: b.len(e) }, linewise: true };
    } else if (cmd.obj !== undefined) {
      const o = textObject(b, p, cmd.around === true, cmd.obj, n);

      if (!o) return false;

      r = o;
    } else {
      // `cw` on a non-blank changes to the end of this word (and n - 1 more).
      const key = cmd.key;

      if (key === undefined) return false;

      let m: Motion | null;

      if (cmd.op === "c" && (key === "w" || key === "W") && cls(b.at(p), key === "W") > 0) {
        const big = key === "W";
        const k = cls(b.at(p), big);
        let q = { ...p };
        let nn: Pos | null;

        while ((nn = b.next(q)) && b.at(nn) !== "\n" && cls(b.at(nn), big) === k) q = nn;

        if (n > 1) q = wordEnd(b, q, big, n - 1);

        m = { to: q, inclusive: true };
      } else m = motion(b, vim, key, n, cmd.arg, cmd.has);

      if (!m) return false;

      r = rangeOf(b, p, m);

      if ((key === "j" || key === "k") && m.to.line === p.line && n > 0 && key === "j" && p.line === b.last) return false;
    }

    if (cmp(r.start, r.end) === 0 && !r.linewise && cmd.op !== "c") return false;

    applyOperator(b, vim, cmd.op, r, cmd.reg, out);

    return cmd.op !== "y";
  }

  const key = cmd.key ?? "";

  // H / L: the pane's previous / next file tab while it has several (a count:
  // that many); with one, the screen's top / bottom line as in Vim.
  if ((key === "H" || key === "L") && (doc.tabs ?? 1) > 1) {
    out.commands.push(...times(n, key === "H" ? "prev-tab" : "next-tab"));

    return false;
  }

  if (MOTIONS.has(key)) {
    const m = motion(b, vim, key, n, cmd.arg, cmd.has);

    if (!m) return false;

    if (m.jump) vim.marks.set("`", { ...p });

    if (m.keepGoal) {
      vim.goal ??= p.col;
      out.keepGoal = true;
    }

    b.cursor = m.to;

    if (m.eol) {
      vim.goal = 1e9;
      out.keepGoal = true;
    }

    return false;
  }

  const arg = cmd.arg ?? "";

  switch (key) {
    case "i":
      enterInsert(vim, b);

      return true;
    case "a":
      b.cursor = { line: p.line, col: Math.min(b.len(p.line), p.col + 1) };
      enterInsert(vim, b);

      return true;
    case "I":
      b.cursor = b.firstNonBlank(p.line);

      if (b.len(p.line) && b.line(p.line).trim() === "") b.cursor = { line: p.line, col: b.len(p.line) };

      enterInsert(vim, b);

      return true;
    case "gI":
      b.cursor = { line: p.line, col: 0 };
      enterInsert(vim, b);

      return true;
    case "A":
      b.cursor = { line: p.line, col: b.len(p.line) };
      enterInsert(vim, b);

      return true;
    case "o":
    case "O": {
      const indent = (b.line(p.line).match(/^\s*/)?.[0] ?? "") + (key === "o" && /[{([:]\s*$/.test(b.line(p.line)) ? (vim.indent ?? "  ") : "");

      if (key === "o") {
        b.replace({ line: p.line, col: b.len(p.line) }, { line: p.line, col: b.len(p.line) }, "\n" + indent);
        b.cursor = { line: p.line + 1, col: indent.length };
      } else {
        b.replace({ line: p.line, col: 0 }, { line: p.line, col: 0 }, indent + "\n");
        b.cursor = { line: p.line, col: indent.length };
      }

      enterInsert(vim, b);

      return true;
    }

    case "x":
    case "<del>": {
      if (!b.len(p.line)) return false;

      const e = Math.min(b.len(p.line), p.col + n);

      applyOperator(b, vim, "d", { start: p, end: { line: p.line, col: e } }, cmd.reg, out);

      return true;
    }

    case "X": {
      if (!p.col) return false;

      applyOperator(b, vim, "d", { start: { line: p.line, col: Math.max(0, p.col - n) }, end: p }, cmd.reg, out);

      return true;
    }

    case "s": {
      const e = Math.min(b.len(p.line), p.col + n);

      applyOperator(b, vim, "c", { start: p, end: { line: p.line, col: e } }, cmd.reg, out);

      return true;
    }

    case "S":
    case "cc": {
      const e = Math.min(b.last, p.line + n - 1);

      applyOperator(b, vim, "c", { start: { line: p.line, col: 0 }, end: { line: e, col: b.len(e) }, linewise: true }, cmd.reg, out);

      return true;
    }

    case "D": {
      const e = Math.min(b.last, p.line + n - 1);

      applyOperator(b, vim, "d", { start: p, end: { line: e, col: b.len(e) } }, cmd.reg, out);
      b.cursor = b.clamp(b.cursor);

      return true;
    }

    case "C": {
      const e = Math.min(b.last, p.line + n - 1);

      applyOperator(b, vim, "c", { start: p, end: { line: e, col: b.len(e) } }, cmd.reg, out);

      return true;
    }

    case "Y": {
      const e = Math.min(b.last, p.line + n - 1);

      applyOperator(b, vim, "y", { start: { line: p.line, col: 0 }, end: { line: e, col: b.len(e) }, linewise: true }, cmd.reg, out);
      b.cursor = p;

      return false;
    }

    case "p":
    case "P":
      put(b, vim, cmd.reg, key === "p", n, doc.clipboard);

      return true;
    case "r": {
      if (p.col + n > b.len(p.line)) return false;

      const ch = arg === "<cr>" ? "\n" : arg;

      if (ch.length !== 1 && ch !== "\n") return false;

      b.replace(p, { line: p.line, col: p.col + n }, ch === "\n" ? "\n" : ch.repeat(n));
      b.cursor = ch === "\n" ? { line: p.line + 1, col: 0 } : { line: p.line, col: p.col + n - 1 };

      return true;
    }

    case "R":
      enterInsert(vim, b, "replace");

      return true;
    case "J":
    case "gJ": {
      const last = Math.min(b.last, p.line + Math.max(1, n - 1));

      if (last === p.line) return false;

      for (let l = p.line; l < last; l++) {
        const end = b.len(p.line);
        const nextLine = b.line(p.line + 1);
        const lead = key === "J" ? (nextLine.match(/^\s*/)?.[0] ?? "").length : 0;
        const sep = key === "J" && end > 0 && nextLine.trim() !== "" && !nextLine.trim().startsWith(")") ? " " : "";
        const trail = key === "J" ? (b.line(p.line).match(/\s*$/)?.[0] ?? "").length : 0;

        b.replace({ line: p.line, col: end - trail }, { line: p.line + 1, col: lead }, sep);
        b.cursor = { line: p.line, col: end - trail };
      }

      return true;
    }

    case "~": {
      const e = Math.min(b.len(p.line), p.col + n);

      if (e === p.col) return false;

      applyOperator(b, vim, "~", { start: p, end: { line: p.line, col: e } }, null, out);
      b.cursor = b.clamp({ line: p.line, col: e });

      return true;
    }

    case "u":
      out.commands.push(...times(n, "undo"));

      return "nochange";
    case "<C-r>":
      out.commands.push(...times(n, "redo"));

      return "nochange";
    case ".":
      return repeat(vim, out, cmd.has ? n : null);
    case "v":
      vim.mode = "visual";
      vim.anchor = { ...p };

      return false;
    case "V":
      vim.mode = "vline";
      vim.anchor = { ...p };

      return false;
    case "<C-v>":
      vim.mode = "vblock";
      vim.anchor = { ...p };

      return false;
    case "gv": {
      const s = vim.marks.get("<");
      const e = vim.marks.get(">");

      if (!s) return false;

      vim.mode = vim.lastVisual ?? "visual";
      vim.anchor = s;
      b.cursor = e ?? s;

      return false;
    }

    case "m":
      if (/[a-zA-Z]/.test(arg)) vim.marks.set(arg, { ...p });

      return false;
    case "q": {
      if (vim.recording) return false;

      if (!/[a-z0-9"]/i.test(arg)) return false;

      vim.recording = { reg: arg.toLowerCase(), keys: [], append: /[A-Z]/.test(arg) };
      out.message = `recording @${vim.recording.reg}`;

      return false;
    }

    case "@": {
      const r = arg === "@" ? vim.lastMacro : arg;
      const reg = r === null ? undefined : vim.registers.get(r);

      if (!reg) return false;

      vim.lastMacro = r;
      out.replay = { keys: tokens(reg.text), times: n };

      return false;
    }

    case "gd":
      out.commands.push("definition");

      return false;
    // The pane's file tabs: gt / gT (a count: that tab), ]b / [b.
    case "gt":
      out.commands.push(cmd.has ? `tab:${n}` : "next-tab");

      return false;
    case "gT":
    case "[b":
      out.commands.push(...times(n, "prev-tab"));

      return false;
    case "]b":
      out.commands.push(...times(n, "next-tab"));

      return false;
    // ]B / [B: the shown tab one place right / left (a count: that many).
    case "]B":
      out.commands.push(...times(n, "move-tab-right"));

      return false;
    case "[B":
      out.commands.push(...times(n, "move-tab-left"));

      return false;
    case "gr":
      out.commands.push("references");

      return false;
    case "K":
      out.commands.push("hover");

      return false;
    case "]d":
      out.commands.push("next-problem");

      return false;
    case "[d":
      out.commands.push("prev-problem");

      return false;
    case "gx":
      out.commands.push("open-link");

      return false;
    case "zz":
      out.commands.push("center");

      return false;
    case "ZZ":
      out.commands.push("save-quit");

      return false;
    case "ZQ":
      out.commands.push("quit!");

      return false;
    case "<C-o>":
      out.commands.push("back");

      return false;
    case "<C-g>":
      out.message = "file info";
      out.commands.push("info");

      return false;
    case "<C-a>":
    case "<C-x>": {
      const line = b.line(p.line);
      const re = /-?\d+/g;
      let m = re.exec(line);

      while (m && m.index + m[0].length <= p.col) m = re.exec(line);

      if (!m) return false;

      const v = Number(m[0]) + (key === "<C-a>" ? n : -n);

      b.replace({ line: p.line, col: m.index }, { line: p.line, col: m.index + m[0].length }, String(v));
      b.cursor = { line: p.line, col: m.index + String(v).length - 1 };

      return true;
    }

    default:
      return "unknown";
  }
}

/** Keys from a register's text (a recorded macro). */
export function tokens(text: string): string[] {
  const out: string[] = [];
  const re = /<[^<>\s]+>|[\s\S]/gu;

  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[0]);

  return out;
}

/** The selections of a visual mode from `a` (the anchor) to `c` (the caret). */
function visualSelections(mode: Mode, a: Pos, b: Buffer, c: Pos = b.cursor): Selection[] {
  if (mode === "visual") {
    const s = minPos(a, c);
    const e = maxPos(a, c);

    return [{ start: s, end: { line: e.line, col: Math.min(b.len(e.line), e.col + 1) }, head: cmp(c, a) < 0 ? "start" : "end" }];
  }

  if (mode === "vline") {
    const s = Math.min(a.line, c.line);
    const e = Math.max(a.line, c.line);

    return [{ start: { line: s, col: 0 }, end: { line: e, col: b.len(e) }, head: c.line < a.line ? "start" : "end" }];
  }

  const s = Math.min(a.line, c.line);
  const e = Math.max(a.line, c.line);
  const l = Math.min(a.col, c.col);
  const r = Math.max(a.col, c.col) + 1;
  const out: Selection[] = [];

  for (let line = s; line <= e; line++) out.push({ start: { line, col: Math.min(l, b.len(line)) }, end: { line, col: Math.min(r, b.len(line)) } });

  return out;
}

function visualRange(vim: Vim, b: Buffer): Span {
  const a = vim.anchor ?? b.cursor;
  const c = b.cursor;

  if (vim.mode === "vline") {
    const s = Math.min(a.line, c.line);
    const e = Math.max(a.line, c.line);

    return { start: { line: s, col: 0 }, end: { line: e, col: b.len(e) }, linewise: true };
  }

  const s = minPos(a, c);
  const e = maxPos(a, c);

  return { start: s, end: { line: e.line, col: Math.min(b.len(e.line), e.col + 1) }, linewise: false };
}

function leaveVisual(vim: Vim, b: Buffer): void {
  const anchor = vim.anchor ?? b.cursor;

  vim.marks.set("<", minPos(anchor, b.cursor));
  vim.marks.set(">", maxPos(anchor, b.cursor));
  vim.lastVisual = vim.mode;
  vim.mode = "normal";
  vim.anchor = null;
}

/** What a visual key does to the selection (an operator, or one of the line-wise ones). */
type VisualOp = Operator | "D" | "Y" | "C" | "S";

/** Visual mode's keys and the operators they are. */
const VISUAL_OPS: ReadonlyMap<string, VisualOp> = new Map<string, VisualOp>([
  ["d", "d"],
  ["x", "d"],
  ["<del>", "d"],
  ["y", "y"],
  ["c", "c"],
  ["s", "c"],
  [">", ">"],
  ["<", "<"],
  ["~", "~"],
  ["u", "gu"],
  ["U", "gU"],
  ["gu", "gu"],
  ["gU", "gU"],
  ["g~", "g~"],
  ["X", "D"],
  ["D", "D"],
  ["Y", "Y"],
  ["C", "C"],
  ["S", "S"],
  ["R", "S"],
]);

function visualCommand(vim: Vim, cmd: Command, b: Buffer, doc: Doc, out: FeedResult): Outcome {
  const key = cmd.key ?? cmd.op ?? "";
  const n = cmd.count;

  if (!cmd.op && MOTIONS.has(key)) {
    const m = motion(b, vim, key, n, cmd.arg, cmd.has);

    if (m) {
      if (m.keepGoal) {
        vim.goal ??= b.cursor.col;
        out.keepGoal = true;
      }

      b.cursor = m.to;
    }

    return false;
  }

  // Text objects extend the selection: viw, va(, vip.
  if (!cmd.op && (key === "i" || key === "a")) return "pending-object";

  const block = vim.mode === "vblock";
  const r = visualRange(vim, b);
  const op: VisualOp | undefined = cmd.op ?? VISUAL_OPS.get(key);

  switch (key) {
    case "o": {
      const a = vim.anchor ?? b.cursor;

      vim.anchor = { ...b.cursor };
      b.cursor = a;

      return false;
    }

    case "v":
    case "V":
    case "<C-v>": {
      const want = key === "v" ? "visual" : key === "V" ? "vline" : "vblock";

      if (vim.mode === want) {
        leaveVisual(vim, b);

        return false;
      }

      vim.mode = want;

      return false;
    }

    case "J": {
      leaveVisual(vim, b);
      b.cursor = r.start;

      return normalCommand(vim, { done: true, reg: null, key: "J", count: Math.max(2, r.end.line - r.start.line + 1), has: false }, b, doc, out);
    }

    case "p":
    case "P": {
      const reg = getReg(vim, cmd.reg, doc.clipboard);

      if (!reg) return false;

      const old = b.text(r.start, r.end) + (r.linewise ? "\n" : "");

      leaveVisual(vim, b);

      if (r.linewise) {
        b.replace(r.start, r.end, reg.text.replace(/\n$/, ""));
        b.cursor = b.firstNonBlank(r.start.line);
      } else {
        const end = b.replace(r.start, r.end, reg.linewise ? "\n" + reg.text.replace(/\n$/, "") + "\n" : reg.text);

        b.cursor = b.clamp({ line: end.line, col: Math.max(0, end.col - 1) });
      }

      if (key === "p") setReg(vim, null, old, r.linewise === true, "delete");

      clipboardTo(out, vim);

      return true;
    }

    case "r": {
      leaveVisual(vim, b);

      const start = vim.marks.get("<") ?? r.start;
      const ranges: readonly Span[] = block ? visualSelections("vblock", start, b, vim.marks.get(">") ?? start) : [r];

      for (const s of [...ranges].reverse()) {
        const t = b.text(s.start, s.end);

        b.replace(s.start, s.end, t.replace(/[^\n]/g, cmd.arg ?? ""));
      }

      b.cursor = r.start;

      return true;
    }

    case "I":
    case "A": {
      if (!block) {
        leaveVisual(vim, b);
        b.cursor = key === "I" ? r.start : { line: r.end.line, col: r.end.col };
        enterInsert(vim, b);

        return true;
      }

      const sels = visualSelections(vim.mode, vim.anchor ?? b.cursor, b);

      leaveVisual(vim, b);

      // One caret per line of the block: typing goes to all.
      const multi = sels.map((s) => (key === "I" ? s.start : s.end));

      out.multi = multi;
      b.cursor = multi[0] ?? b.cursor;
      enterInsert(vim, b);

      return true;
    }
  }

  if (!op) {
    leaveVisual(vim, b);

    return "unknown";
  }

  if (block && (op === "d" || op === "c" || op === "y" || op === "~" || op === "gu" || op === "gU")) {
    const sels = visualSelections(vim.mode, vim.anchor ?? b.cursor, b);

    leaveVisual(vim, b);

    const first = sels[0]?.start ?? b.cursor;
    const texts = sels.map((s) => b.text(s.start, s.end));

    if (op === "y") {
      setReg(vim, cmd.reg, texts.join("\n"), false, "yank");
      clipboardTo(out, vim);
      b.cursor = first;

      return false;
    }

    if (op === "d" || op === "c") {
      setReg(vim, cmd.reg, texts.join("\n"), false, "delete");
      clipboardTo(out, vim);

      for (const s of [...sels].reverse()) b.replace(s.start, s.end, "");

      b.cursor = first;

      if (op === "c") {
        out.multi = sels.map((s) => s.start);
        enterInsert(vim, b);
      }

      return true;
    }

    for (const s of [...sels].reverse()) applyOperator(b, vim, op, { start: s.start, end: s.end }, null, out);

    b.cursor = first;

    return true;
  }

  leaveVisual(vim, b);

  if (op === "D" || op === "Y" || op === "C" || op === "S") {
    const lr = { start: { line: r.start.line, col: 0 }, end: { line: r.end.line, col: b.len(r.end.line) }, linewise: true };

    applyOperator(b, vim, op === "Y" ? "y" : op === "D" ? "d" : "c", lr, cmd.reg, out);

    return op !== "Y";
  }

  if (op === ">" || op === "<") vim.shiftCount = n;

  applyOperator(b, vim, op, r, cmd.reg, out);
  vim.shiftCount = 1;

  if (op === "y") {
    b.cursor = r.start;

    return false;
  }

  return true;
}

/** `.`: the last change again (at the caret, `count` times when given). */
function repeat(vim: Vim, out: FeedResult, count: number | null): Outcome {
  const last = vim.lastChange;

  if (!last) return false;

  const keys: Key[] = count ? stripCount(last.keys, count) : [...last.keys];

  out.replay = { keys: last.inserted === null ? keys : [...keys, { insert: last.inserted }, "<esc>"], times: 1, repeat: true };

  return "nochange";
}

function stripCount(keys: readonly Key[], count: number): Key[] {
  const text = (k: Key | undefined): string => (isString(k) ? k : "");
  let i = 0;

  if (keys[0] === '"') i = 2;

  let j = i;

  while ((j < keys.length && /[1-9]/.test(text(keys[j]))) || (j > i && /[0-9]/.test(text(keys[j])))) j++;

  return [...keys.slice(0, i), ...String(count), ...keys.slice(j)];
}

function insertKey(vim: Vim, key: Key, doc: Doc, out: FeedResult): FeedResult {
  if (vim.insertStart && !vim.replaying) vim.insertStart.typed = true;

  if (key === "<esc>") {
    // What was typed since insert mode began, for `.` and macros: the text
    // that differs between then and now, as one insertion at the start.
    const st = vim.insertStart;
    const inserted = st ? typedText(st.text, doc.text) : "";

    if (st && !vim.replaying) vim.lastChange = { keys: st.keys, inserted };

    vim.mode = "normal";
    vim.insertStart = null;

    const b = new Buffer(doc.text, doc.cursor);

    out.cursor = b.clamp({ line: doc.cursor.line, col: Math.max(0, doc.cursor.col - 1) });
    out.mode = "normal";
    out.selections = null;

    return out;
  }

  // Replaying (a macro, `.`): the editor doesn't type, so the keys become edits.
  if (vim.replaying) {
    const b = new Buffer(doc.text, doc.cursor);

    if (!isString(key)) b.cursor = b.replace(b.cursor, b.cursor, key.insert);
    else if (key === "<cr>") b.cursor = b.replace(b.cursor, b.cursor, "\n" + (b.line(b.cursor.line).match(/^\s*/)?.[0] ?? ""));
    else if (key === "<bs>") {
      const pr = b.prev(b.cursor);

      if (pr) {
        b.replace(pr, b.cursor, "");
        b.cursor = pr;
      }
    } else if (key === "<tab>") b.cursor = b.replace(b.cursor, b.cursor, vim.indent ?? "  ");
    else if ([...key].length === 1) {
      if (vim.mode === "replace" && b.cursor.col < b.len(b.cursor.line)) b.cursor = b.replace(b.cursor, { line: b.cursor.line, col: b.cursor.col + 1 }, key);
      else b.cursor = b.replace(b.cursor, b.cursor, key);
    }

    out.edits = b.edits;
    out.cursor = b.cursor;

    return out;
  }

  if (vim.mode === "replace" && isString(key) && [...key].length === 1) {
    // Overtype: the editor would insert; replace the next character instead.
    const b = new Buffer(doc.text, doc.cursor);

    if (b.cursor.col < b.len(b.cursor.line)) {
      b.replace(b.cursor, { line: b.cursor.line, col: b.cursor.col + 1 }, key);
      out.edits = b.edits;
      out.cursor = { line: b.cursor.line, col: b.cursor.col + 1 };

      return out;
    }
  }

  // Everything else is the editor's: typing, IME, arrows, backspace.
  out.taken = false;

  return out;
}

/** The text inserted between `before` and `after` (one contiguous change). */
export function typedText(before: string, after: string): string {
  let s = 0;

  while (s < before.length && s < after.length && before[s] === after[s]) s++;

  let e = 0;

  while (e < before.length - s && e < after.length - s && before[before.length - 1 - e] === after[after.length - 1 - e]) e++;

  return after.slice(s, after.length - e);
}

// ---- the ex line

function exKey(vim: Vim, ex: string, key: Key, doc: Doc, out: FeedResult): FeedResult {
  if (key === "<esc>") {
    vim.ex = null;
    out.ex = null;

    return out;
  }

  if (key === "<bs>") {
    vim.ex = !ex.length || ex === "/" || ex === "?" ? null : ex.slice(0, -1);
    out.ex = vim.ex;

    return out;
  }

  if (key === "<cr>") {
    vim.ex = null;
    out.ex = null;

    return runEx(vim, ex, doc, out);
  }

  if (isString(key) && [...key].length === 1) vim.ex = ex + key;
  else if (key === "<tab>") vim.ex = ex + "\t";

  out.ex = vim.ex;

  return out;
}

/** Runs an ex line (`:w`, `:%s/a/b/g`, `/pattern`...). */
export function runEx(vim: Vim, line: string, doc: Doc, out: FeedResult): FeedResult {
  const b = new Buffer(doc.text, doc.cursor);

  if (line.startsWith("/") || line.startsWith("?")) {
    const back = line[0] === "?";
    const pat = line.slice(1) || vim.search?.pattern;

    if (!pat) return out;

    vim.search = { pattern: pat, back };

    const to = searchFrom(b, b.cursor, pat, back, 1);

    if (!to) {
      out.message = `not found: ${pat}`;

      return out;
    }

    vim.marks.set("`", { ...b.cursor });
    out.cursor = to;
    out.search = pat;

    if (vim.mode !== "normal") {
      b.cursor = to;
      out.selections = visualSelections(vim.mode, vim.anchor ?? to, b);
    }

    return out;
  }

  const wasVisual = vim.mode !== "normal" && vim.mode !== "insert";

  if (wasVisual) {
    vim.mode = "normal";
    vim.anchor = null;
    out.mode = "normal";
    out.selections = null;
  }

  let rest = line.trim();

  // A range: %, ., $, numbers, '<,'>, 'a, +n, -n.
  const addr = (): number | null | undefined => {
    const digits = /^(\d+)/.exec(rest);

    if (digits) {
      rest = rest.slice(digits[0].length);

      return Number(digits[1]) - 1;
    }

    if (rest[0] === ".") {
      rest = rest.slice(1);

      return b.cursor.line;
    }

    if (rest[0] === "$") {
      rest = rest.slice(1);

      return b.last;
    }

    const mark = /^'([a-z<>])/.exec(rest);

    if (mark) {
      rest = rest.slice(2);

      return vim.marks.get(mark[1] ?? "")?.line ?? null;
    }

    return undefined;
  };

  let from: number | null = null;
  let to: number | null = null;

  if (rest[0] === "%") {
    from = 0;
    to = b.last;
    rest = rest.slice(1);
  } else {
    const a = addr();

    if (a !== undefined) {
      from = a;
      to = a;

      for (let m = /^([+-])(\d*)/.exec(rest); m?.[0]; m = /^([+-])(\d*)/.exec(rest)) {
        const d = Number(m[2] || 1) * (m[1] === "+" ? 1 : -1);

        from = (to ?? b.cursor.line) + d;
        to = from;
        rest = rest.slice(m[0].length);
      }

      if (rest[0] === ",") {
        rest = rest.slice(1);

        const c = addr();

        to = c === undefined ? from : c;
      }
    }
  }

  const parts = /^([a-zA-Z]*)(!?)\s*(.*)$/s.exec(rest);
  const name = parts ? (parts[1] ?? "") : rest;
  const bang = parts?.[2] ?? "";
  const arg = parts?.[3] ?? "";

  if (!name && from !== null) {
    out.cursor = b.firstNonBlank(Math.max(0, Math.min(b.last, to ?? 0)));
    vim.marks.set("`", { ...b.cursor });

    return out;
  }

  const one = from ?? b.cursor.line;
  const two = to ?? one;

  switch (name) {
    case "w":
    case "write":
      out.commands.push(arg ? `write:${arg}` : "save");

      return out;
    case "wq":
    case "x":
    case "xit":
    case "exit":
      out.commands.push("save-quit");

      return out;
    case "q":
    case "quit":
    case "close":
      out.commands.push(bang ? "quit!" : "quit");

      return out;
    case "wa":
    case "wall":
      out.commands.push("save");

      return out;
    case "e":
    case "edit":
      out.commands.push(arg ? `edit:${arg}` : bang ? "reload!" : "reload");

      return out;
    case "noh":
    case "nohlsearch":
      out.commands.push("nohlsearch");

      return out;
    // The pane's file tabs, as buffers: :bn :bp :bd(!) :b N :ls, and :tabn :tabp :tabc.
    case "bn":
    case "bnext":
    case "tabn":
    case "tabnext":
      out.commands.push("next-tab");

      return out;
    case "bp":
    case "bprevious":
    case "bN":
    case "bNext":
    case "tabp":
    case "tabprevious":
    case "tabN":
      out.commands.push("prev-tab");

      return out;
    case "bd":
    case "bdelete":
    case "bw":
    case "bwipeout":
    case "tabc":
    case "tabclose":
      out.commands.push(bang ? "close-tab!" : "close-tab");

      return out;
    // :popout (the shown tab into a pane of its own beside), :popin (into the editor beside).
    case "popout":
    case "popo":
      out.commands.push("pop-out");

      return out;
    case "popin":
    case "popi":
      out.commands.push("pop-in");

      return out;
    // :tabm N (that place, 0 the first), :tabm +N / -N (that many right / left), :tabm (the end).
    case "tabm":
    case "tabmove": {
      const a = arg.trim();

      if (a && !/^[+-]?\d+$/.test(a)) {
        out.message = "E474: :tabm takes N, +N or -N";

        return out;
      }

      out.commands.push(`move-tab:${a || "$"}`);

      return out;
    }

    case "b":
    case "buffer":
      if (!/^\d+$/.test(arg.trim())) {
        out.message = "E94: :b takes a tab number (:ls lists them)";

        return out;
      }

      out.commands.push(`tab:${arg.trim()}`);

      return out;
    case "ls":
    case "buffers":
    case "files":
      out.commands.push("tabs");

      return out;
    case "u":
    case "undo":
      out.commands.push("undo");

      return out;
    case "red":
    case "redo":
      out.commands.push("redo");

      return out;
    case "d":
    case "delete": {
      setReg(vim, null, b.text({ line: one, col: 0 }, { line: two, col: b.len(two) }) + "\n", true, "delete");
      clipboardTo(out, vim);
      deleteLines(b, Math.min(one, two), Math.max(one, two));
      out.edits = b.edits;
      out.cursor = b.firstNonBlank(Math.min(one, b.last));

      return out;
    }

    case "y":
    case "yank":
      setReg(vim, null, b.text({ line: one, col: 0 }, { line: two, col: b.len(two) }) + "\n", true, "yank");
      clipboardTo(out, vim);

      return out;
    case "j":
    case "join": {
      b.cursor = { line: Math.min(one, two), col: 0 };
      normalCommand(vim, { done: true, reg: null, key: "J", count: Math.max(2, Math.abs(two - one) + 1), has: false }, b, doc, out);
      out.edits = b.edits;
      out.cursor = b.cursor;

      return out;
    }

    case "s":
    case "substitute":
    case "": {
      if (name === "" && !arg) return out;

      const sub = /^([^\w\s\\])((?:\\.|(?!\1).)*)\1((?:\\.|(?!\1).)*)(?:\1([gci]*))?$/s.exec(name === "" ? rest : arg);

      if (!sub) {
        out.message = "E486: substitute needs /pattern/replacement/";

        return out;
      }

      const pat = sub[2] ?? "";
      const rep = sub[3] ?? "";
      const flags = sub[4] ?? "";
      const re = pattern(pat || vim.search?.pattern || "");
      const global = flags.includes("g");
      const ignore = flags.includes("i");
      const rx = new RegExp(re.source, (global ? "g" : "") + (ignore || re.flags.includes("i") ? "i" : ""));

      const replacement = rep
        .replace(/\\(\d)/g, "$$$1")
        .replace(/(^|[^\\])&/g, "$1$$&")
        .replace(/\\&/g, "&")
        .replace(/\\n/g, "\n")
        .replace(/\\\//g, "/");

      let count = 0;
      let lastLine: number | null = null;

      for (let l = Math.min(one, two); l <= Math.max(one, two) && l <= b.last; l++) {
        const old = b.line(l);

        const next = old.replace(rx, (found: string) => {
          count++;

          return found.replace(new RegExp(rx.source, rx.flags.replace("g", "")), replacement);
        });

        if (next !== old) {
          b.replace({ line: l, col: 0 }, { line: l, col: old.length }, next);
          lastLine = l + (next.split("\n").length - 1);
          l += next.split("\n").length - 1;
        }
      }

      if (pat) vim.search = { pattern: pat, back: false };

      if (!count) {
        out.message = `pattern not found: ${pat}`;

        return out;
      }

      out.edits = b.edits;
      out.cursor = b.firstNonBlank(lastLine ?? b.cursor.line);
      out.message = `${count} substitution${count === 1 ? "" : "s"}`;

      return out;
    }

    case "set":
      out.commands.push(`set:${arg}`);

      return out;
    case "vim":
    case "novim":
      out.commands.push("vim");

      return out;
    default:
      out.message = `E492: not an editor command: ${line}`;

      return out;
  }
}

/** Ends a macro recording: the register gets the keys. -> the register name. */
export function stopRecording(vim: Vim): string | null {
  const r = vim.recording;

  if (!r) return null;

  vim.recording = null;

  const text = r.keys.map((k) => (isString(k) ? k : k.insert)).join("");
  const prev = r.append ? (vim.registers.get(r.reg)?.text ?? "") : "";

  vim.registers.set(r.reg, { text: prev + text, linewise: false });

  return r.reg;
}

/** The caret's shape for a mode. */
// Visual modes: a bar, where the editor draws its caret (the selection's edge).
export const CARET = { normal: "block", visual: "bar", vline: "bar", vblock: "bar", insert: "bar", replace: "underline" } as const satisfies Readonly<Record<Mode, "block" | "bar" | "underline">>;

/** The mode's name in the bar. */
export const MODE_NAME = { normal: "NORMAL", insert: "INSERT", replace: "REPLACE", visual: "VISUAL", vline: "V-LINE", vblock: "V-BLOCK" } as const satisfies Readonly<Record<Mode, string>>;

/** Applies edits to a text, in order (each one against the text after the previous); for tests and replays. */
export function applyEdits(text: string, edits: readonly Edit[] | null | undefined): string {
  const b = new Buffer(text, { line: 0, col: 0 });

  for (const e of edits ?? []) b.replace(e.start, e.end, e.text);

  return b.all();
}

/** What playing keys came to: the edits in order, the caret, the mode, the selections,
 *  commands, the clipboard, a message and the text after them. */
export interface Played {
  edits: Edit[];
  commands: string[];
  cursor: Pos;
  mode: Mode;
  selections?: Selection[] | null;
  clipboard?: Register;
  message?: string;
  text?: string;
}

/** Plays keys (a macro, `.`) `times` times against `doc` as if typed, with
 *  insert-mode text applied as edits: -> the edits in order, the final
 *  caret, mode and selections, commands and messages. */
export function play(vim: Vim, keys: readonly Key[], doc: Doc, times = 1): Played {
  let text = doc.text;
  let cursor = { ...doc.cursor };
  const res: Played = { edits: [], commands: [], cursor, mode: vim.mode };
  const was = vim.replaying;

  vim.replaying = true;

  try {
    for (let i = 0; i < times; i++) {
      for (const k of keys) {
        const r = feed(vim, k, { ...doc, text, cursor });

        absorb(res, r);

        if (r.edits?.length) text = applyEdits(text, r.edits);

        if (r.cursor) cursor = r.cursor;

        if (r.replay) {
          const nested = play(vim, r.replay.keys, { ...doc, text, cursor }, r.replay.times);

          absorb(res, nested);

          if (nested.edits.length) text = applyEdits(text, nested.edits);

          cursor = nested.cursor;
        }
      }
    }
  } finally {
    vim.replaying = was;
  }

  res.cursor = cursor;
  res.mode = vim.mode;
  res.text = text;

  return res;
}

function absorb(res: Played, r: Pick<FeedResult, "edits" | "commands" | "selections" | "clipboard" | "message">): void {
  if (r.edits?.length) res.edits.push(...r.edits);

  if (r.commands.length) res.commands.push(...r.commands);

  if (r.selections !== undefined) res.selections = r.selections;

  if (r.clipboard !== undefined) res.clipboard = r.clipboard;

  if (r.message !== undefined) res.message = r.message;
}
