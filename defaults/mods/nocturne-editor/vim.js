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

/** Positions are { line, col }: zero-based, columns in JS string units. */

const isWord = (c) => /[\p{L}\p{N}_]/u.test(c);
const isBlank = (c) => c === " " || c === "\t";
const cls = (c, big) => (c === undefined || c === "" ? -1 : isBlank(c) ? 0 : big ? 1 : isWord(c) ? 1 : 2);
const cmp = (a, b) => a.line - b.line || a.col - b.col;
const minPos = (a, b) => (cmp(a, b) <= 0 ? a : b);
const maxPos = (a, b) => (cmp(a, b) <= 0 ? b : a);

/** The default leader map: key sequences after the leader and what they do. */
export const LEADER = {
  f: { name: "find", f: ["picker", "files"], g: ["grep", "grep"], b: ["picker", "files"] },
  e: ["files-pane", "files pane"],
  w: ["save", "save"],
  q: ["quit", "close"],
  b: { name: "tabs", n: ["next-tab", "next tab"], p: ["prev-tab", "previous tab"], d: ["close-tab", "close tab"], l: ["tabs", "list tabs"] },
  d: ["problems", "problems"],
  h: ["hover", "hover"],
  c: { name: "code", a: ["code-action", "code action"], f: ["format", "format"] },
  r: { name: "refactor", n: ["rename", "rename"] },
  g: { name: "go", d: ["definition", "definition"], r: ["references", "references"] },
  "?": ["keys", "keys"],
  u: { name: "toggle", w: ["wrap", "word wrap"] },
  m: { name: "markdown", p: ["preview", "view: rendered / split / preview / text"], r: ["preview-rendered", "rendered"], s: ["preview-split", "preview beside"], v: ["preview-only", "preview only"], t: ["preview-text", "text only"] },
  // The Markdown commands (mdedit.js), by the letters cmd-. takes.
  ".": {
    name: "markdown commands",
    b: ["md-bold", "bold"], i: ["md-italic", "italic"], "`": ["md-code", "inline code"], k: ["md-link", "link"],
    h: ["md-heading-up", "heading up"], H: ["md-heading-down", "heading down"],
    l: ["md-bullets", "bullet list"], n: ["md-numbers", "numbered list"], t: ["md-task", "task box"], x: ["md-tick", "tick"],
    q: ["md-quote", "quote"], c: ["md-fence", "code block"], r: ["md-rule", "rule"], p: ["md-image", "image from a file"], v: ["md-image-paste", "paste an image"],
    0: ["md-heading-0", "text"], 1: ["md-heading-1", "heading 1"], 2: ["md-heading-2", "heading 2"], 3: ["md-heading-3", "heading 3"],
  },
};

export function createVim(options = {}) {
  return {
    mode: "normal", // normal | insert | replace | visual | vline | vblock
    keys: [], // the pending command's keys
    registers: {},
    marks: {},
    anchor: null, // visual mode's other end
    lastChange: null, // { keys, inserted } for `.`
    recording: null, // { reg, keys }
    lastMacro: null,
    lastFind: null, // { kind: "f"|"F"|"t"|"T", ch }
    search: null, // { pattern, back }
    ex: null, // the ex line being typed, or null
    insertStart: null, // { text, cursor, keys } while inserting
    leader: options.leader ?? " ",
    leaderMap: options.leaderMap ?? LEADER,
    pendingLeader: null, // the leader map node being walked
    replaying: false,
    message: null,
  };
}

/** The key a keystroke event names: a typed character, else `<esc>`,
 *  `<cr>`, `<bs>`, `<tab>`, `<C-r>`, `<up>`...; null for one vim leaves to
 *  the app (cmd combinations). */
export function token(e) {
  const m = e.modifiers ?? {};
  if (m.platform || m.command || m.cmd) return null;
  const k = e.key;
  const named = { escape: "<esc>", enter: "<cr>", backspace: "<bs>", tab: "<tab>", up: "<up>", down: "<down>", left: "<left>", right: "<right>", delete: "<del>", home: "<home>", end: "<end>", pageup: "<pgup>", pagedown: "<pgdn>", space: " " };
  if (m.control) {
    if (k === "[") return "<esc>";
    return k.length === 1 ? `<C-${k.toLowerCase()}>` : named[k] ? `<C-${named[k].slice(1, -1)}>` : null;
  }
  if (m.alt) return null;
  if (named[k] && k !== "space") return named[k];
  if (e.key_char != null && e.key_char !== "") return e.key_char;
  if (k === "space") return " ";
  return k.length === 1 ? (m.shift ? k.toUpperCase() : k) : null;
}

// ---- the buffer

/** A working copy of the text the keys act on; edits are recorded as they're made. */
class Buffer {
  constructor(text, cursor) {
    this.lines = String(text).split("\n");
    this.cursor = { ...cursor };
    this.edits = [];
  }
  get last() { return this.lines.length - 1; }
  line(n) { return this.lines[n] ?? ""; }
  len(n) { return this.line(n).length; }
  clamp(p, insert) {
    const line = Math.max(0, Math.min(this.last, p.line));
    const max = insert ? this.len(line) : Math.max(0, this.len(line) - 1);
    return { line, col: Math.max(0, Math.min(max, p.col)) };
  }
  text(a, b) {
    if (a.line === b.line) return this.line(a.line).slice(a.col, b.col);
    const out = [this.line(a.line).slice(a.col)];
    for (let l = a.line + 1; l < b.line; l++) out.push(this.line(l));
    out.push(this.line(b.line).slice(0, b.col));
    return out.join("\n");
  }
  /** Replaces [a, b) with `text`, records the edit; -> the end of the new text. */
  replace(a, b, text) {
    const head = this.line(a.line).slice(0, a.col), tail = this.line(b.line).slice(b.col);
    const parts = String(text).split("\n");
    const repl = parts.map((p, i) => (i === 0 ? head : "") + p + (i === parts.length - 1 ? tail : ""));
    this.lines.splice(a.line, b.line - a.line + 1, ...repl);
    this.edits.push({ start: { ...a }, end: { ...b }, text: String(text) });
    const endLine = a.line + parts.length - 1;
    return { line: endLine, col: (parts.length === 1 ? a.col : 0) + parts[parts.length - 1].length };
  }
  /** Character after/before p across lines (newline between lines). */
  at(p) { return p.col < this.len(p.line) ? this.line(p.line)[p.col] : p.line < this.last ? "\n" : ""; }
  next(p) { return p.col < this.len(p.line) ? { line: p.line, col: p.col + 1 } : p.line < this.last ? { line: p.line + 1, col: 0 } : null; }
  prev(p) { return p.col > 0 ? { line: p.line, col: p.col - 1 } : p.line > 0 ? { line: p.line - 1, col: this.len(p.line - 1) } : null; }
  firstNonBlank(n) { const m = this.line(n).match(/^\s*/); return { line: n, col: Math.min(m[0].length, Math.max(0, this.len(n) - (m[0].length === this.len(n) ? 1 : 0))) }; }
  offset(p) { let o = 0; for (let l = 0; l < p.line; l++) o += this.len(l) + 1; return o + p.col; }
  pos(o) { let l = 0; while (l < this.last && o > this.len(l)) { o -= this.len(l) + 1; l++; } return { line: l, col: Math.min(o, this.len(l)) }; }
  all() { return this.lines.join("\n"); }
}

// ---- motions: (buf, from, count, vim, arg) -> { to, inclusive?, linewise?, exclusive? } | null

function wordForward(b, p, big, count) {
  let q = p;
  for (let i = 0; i < count; i++) {
    const start = cls(b.at(q), big);
    let n = q;
    // Skip the rest of this word, then blanks and newlines (an empty line stops).
    if (start > 0) while ((n = b.next(q)) && cls(b.at(n), big) === start && b.at(n) !== "\n") q = n;
    n = b.next(q);
    if (!n) return { line: q.line, col: b.len(q.line) };
    q = n;
    while (true) {
      const c = b.at(q);
      if (c === "\n") { const nn = b.next(q); if (!nn) break; q = nn; if (b.len(q.line) === 0) break; continue; }
      if (!isBlank(c)) break;
      const nn = b.next(q); if (!nn) break; q = nn;
    }
  }
  return q;
}

function wordEnd(b, p, big, count) {
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

function wordBack(b, p, big, count) {
  let q = p;
  for (let i = 0; i < count; i++) {
    let n = b.prev(q);
    if (!n) return q;
    q = n;
    while (cls(b.at(q), big) <= 0 && (n = b.prev(q))) { if (b.len(q.line) === 0 && q.col === 0 && cmp(q, p) < 0) break; q = n; }
    const c = cls(b.at(q), big);
    while ((n = b.prev(q)) && cls(b.at(n), big) === c && b.at(n) !== "\n") q = n;
  }
  return q;
}

function wordEndBack(b, p, big, count) {
  let q = p;
  for (let i = 0; i < count; i++) {
    const c0 = cls(b.at(q), big);
    let n;
    while ((n = b.prev(q)) && cls(b.at(n), big) === c0 && c0 > 0) q = n;
    n = b.prev(q); if (!n) return q; q = n;
    while (cls(b.at(q), big) <= 0 && (n = b.prev(q))) q = n;
  }
  return q;
}

const PAIRS = { "(": ")", "[": "]", "{": "}", ")": "(", "]": "[", "}": "{" };

function matchPair(b, p) {
  // The first bracket at or after the caret on its line, then its partner.
  let q = { ...p };
  while (q.col < b.len(q.line) && !PAIRS[b.at(q)]) q.col++;
  const c = b.at(q);
  if (!PAIRS[c]) return null;
  const open = "([{".includes(c), other = PAIRS[c];
  let depth = 0, n = q;
  while (n) {
    const ch = b.at(n);
    if (ch === c) depth++;
    else if (ch === other && --depth === 0) return n;
    n = open ? b.next(n) : b.prev(n);
  }
  return null;
}

function paragraph(b, p, dir, count) {
  let l = p.line;
  for (let i = 0; i < count; i++) {
    while (l + dir >= 0 && l + dir <= b.last && b.len(l + dir) === 0) l += dir;
    while (l + dir >= 0 && l + dir <= b.last && b.len(l + dir) !== 0) l += dir;
    l = Math.max(0, Math.min(b.last, l + dir));
  }
  return { line: l, col: dir > 0 && l === b.last && b.len(l) ? b.len(l) - 1 : 0 };
}

function findChar(b, p, kind, ch, count) {
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

/** A Vim pattern as a JS RegExp: \< \> word edges, \c ignore case, smart case. */
export function pattern(p) {
  let flags = "g";
  let src = String(p);
  if (src.includes("\\c")) { flags += "i"; src = src.replace(/\\c/g, ""); }
  else if (!/[A-Z]/.test(src)) flags += "i";
  src = src.replace(/\\[<>]/g, "\\b");
  try { return new RegExp(src, flags); } catch { return new RegExp(src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags); }
}

function searchFrom(b, p, pat, back, count) {
  const text = b.all(), re = pattern(pat);
  const hits = [];
  let m;
  while ((m = re.exec(text))) { hits.push(m.index); if (m[0] === "") re.lastIndex++; if (hits.length > 100000) break; }
  if (!hits.length) return null;
  let at = b.offset(p);
  for (let i = 0; i < count; i++) {
    const next = back ? [...hits].reverse().find((h) => h < at) ?? hits[hits.length - 1] : hits.find((h) => h > at) ?? hits[0];
    at = next;
  }
  return b.pos(at);
}

function wordUnder(b, p) {
  const line = b.line(p.line);
  let s = p.col, e = p.col;
  if (!isWord(line[s] ?? "")) { while (s < line.length && !isWord(line[s])) s++; e = s; }
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e);
}

function motion(b, vim, key, count, arg, hasCount) {
  const p = b.cursor;
  switch (key) {
    case "h": case "<left>": case "<bs>": return { to: { line: p.line, col: Math.max(0, p.col - count) }, exclusive: true };
    case "l": case "<right>": case " ": return { to: { line: p.line, col: Math.min(b.len(p.line), p.col + count) }, exclusive: true, stayInLine: true };
    case "j": case "<down>": case "<C-n>": case "<C-j>": return { to: { line: Math.min(b.last, p.line + count), col: vim.goal ?? p.col }, linewise: true, keepGoal: true };
    case "k": case "<up>": case "<C-p>": return { to: { line: Math.max(0, p.line - count), col: vim.goal ?? p.col }, linewise: true, keepGoal: true };
    case "+": case "<cr>": return { to: b.firstNonBlank(Math.min(b.last, p.line + count)), linewise: true };
    case "-": return { to: b.firstNonBlank(Math.max(0, p.line - count)), linewise: true };
    case "_": return { to: b.firstNonBlank(Math.min(b.last, p.line + count - 1)), linewise: true };
    case "0": case "<home>": return { to: { line: p.line, col: 0 }, exclusive: true };
    case "^": return { to: b.firstNonBlank(p.line), exclusive: true };
    case "$": case "<end>": { const l = Math.min(b.last, p.line + count - 1); return { to: { line: l, col: Math.max(0, b.len(l) - 1) }, inclusive: true, eol: true }; }
    case "w": return { to: wordForward(b, p, false, count), exclusive: true, word: true };
    case "W": return { to: wordForward(b, p, true, count), exclusive: true, word: true };
    case "b": return { to: wordBack(b, p, false, count), exclusive: true };
    case "B": return { to: wordBack(b, p, true, count), exclusive: true };
    case "e": return { to: wordEnd(b, p, false, count), inclusive: true };
    case "E": return { to: wordEnd(b, p, true, count), inclusive: true };
    case "ge": return { to: wordEndBack(b, p, false, count), inclusive: true };
    case "gE": return { to: wordEndBack(b, p, true, count), inclusive: true };
    case "gg": return { to: b.firstNonBlank(hasCount ? Math.min(b.last, count - 1) : 0), linewise: true, jump: true };
    case "G": return { to: b.firstNonBlank(hasCount ? Math.min(b.last, count - 1) : b.last), linewise: true, jump: true };
    case "}": return { to: paragraph(b, p, 1, count), exclusive: true, jump: true };
    case "{": return { to: paragraph(b, p, -1, count), exclusive: true, jump: true };
    case "%": { if (hasCount) return { to: b.firstNonBlank(Math.min(b.last, Math.floor(((count) * (b.last + 1) + 99) / 100) - 1)), linewise: true }; const q = matchPair(b, p); return q && { to: q, inclusive: true, jump: true }; }
    case "f": case "F": case "t": case "T": { vim.lastFind = { kind: key, ch: arg }; const q = findChar(b, p, key, arg, count); return q && { to: q, inclusive: key === "f" || key === "t", exclusive: key === "F" || key === "T" }; }
    case ";": case ",": {
      const f = vim.lastFind; if (!f) return null;
      const kind = key === ";" ? f.kind : { f: "F", F: "f", t: "T", T: "t" }[f.kind];
      const q = findChar(b, p, kind, f.ch, count); return q && { to: q, inclusive: kind === "f" || kind === "t", exclusive: kind === "F" || kind === "T" };
    }
    case "n": case "N": { const s = vim.search; if (!s) return null; const q = searchFrom(b, p, s.pattern, key === "N" ? !s.back : s.back, count); return q && { to: q, exclusive: true, jump: true }; }
    case "*": case "#": { const w = wordUnder(b, p); if (!w) return null; vim.search = { pattern: `\\<${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\>`, back: key === "#" }; const q = searchFrom(b, p, vim.search.pattern, key === "#", count); return q && { to: q, exclusive: true, jump: true }; }
    case "`": case "'": { const m = vim.marks[arg]; if (!m) return null; return key === "'" ? { to: b.firstNonBlank(Math.min(b.last, m.line)), linewise: true, jump: true } : { to: b.clamp(m), exclusive: true, jump: true }; }
    case "<C-d>": return { to: { line: Math.min(b.last, p.line + (hasCount ? count : vim.page ?? 15)), col: p.col }, linewise: true };
    case "<C-u>": return { to: { line: Math.max(0, p.line - (hasCount ? count : vim.page ?? 15)), col: p.col }, linewise: true };
    case "<C-f>": case "<pgdn>": return { to: { line: Math.min(b.last, p.line + 2 * (vim.page ?? 15) * count), col: p.col }, linewise: true };
    case "<C-b>": case "<pgup>": return { to: { line: Math.max(0, p.line - 2 * (vim.page ?? 15) * count), col: p.col }, linewise: true };
    default: return null;
  }
}

const MOTION_ARG = new Set(["f", "F", "t", "T", "`", "'"]);
const MOTIONS = new Set(["h", "j", "k", "l", "<left>", "<right>", "<up>", "<down>", "<bs>", " ", "+", "-", "_", "<cr>", "0", "^", "$", "<home>", "<end>", "w", "W", "b", "B", "e", "E", "ge", "gE", "gg", "G", "}", "{", "%", "f", "F", "t", "T", ";", ",", "n", "N", "*", "#", "`", "'", "<C-d>", "<C-u>", "<C-f>", "<C-b>", "<pgup>", "<pgdn>", "<C-n>", "<C-p>", "<C-j>"]);

// ---- text objects: (buf, cursor, around, kind, count) -> { start, end, linewise? } (end exclusive)

function textObject(b, p, around, kind, count) {
  const line = b.line(p.line);
  if (kind === "w" || kind === "W") {
    const big = kind === "W";
    const c = (i) => cls(line[i], big);
    let s = p.col, e = p.col;
    const k = c(p.col);
    while (s > 0 && c(s - 1) === k) s--;
    while (e < line.length && c(e) === k) e++;
    for (let i = 1; i < count; i++) { const k2 = c(e); while (e < line.length && c(e) === k2) e++; }
    if (around) {
      if (k !== 0 && e < line.length && isBlank(line[e])) { while (e < line.length && isBlank(line[e])) e++; }
      else if (k !== 0) { while (s > 0 && isBlank(line[s - 1])) s--; }
      else { const k2 = c(e); while (e < line.length && c(e) === k2) e++; }
    }
    return { start: { line: p.line, col: s }, end: { line: p.line, col: e } };
  }
  if (`"'\``.includes(kind)) {
    const q = kind;
    const idx = [];
    for (let i = 0; i < line.length; i++) if (line[i] === q && line[i - 1] !== "\\") idx.push(i);
    let open = -1, close = -1;
    for (let i = 0; i + 1 < idx.length; i += 2) if (idx[i] <= p.col && p.col <= idx[i + 1]) { open = idx[i]; close = idx[i + 1]; }
    if (open < 0) { const after = idx.find((i) => i > p.col); const j = idx.indexOf(after); if (after != null && j + 1 < idx.length && j % 2 === 0) { open = after; close = idx[j + 1]; } }
    if (open < 0) return null;
    if (!around) return { start: { line: p.line, col: open + 1 }, end: { line: p.line, col: close } };
    let e = close + 1, s = open;
    if (e < line.length && isBlank(line[e])) while (e < line.length && isBlank(line[e])) e++;
    else while (s > 0 && isBlank(line[s - 1])) s--;
    return { start: { line: p.line, col: s }, end: { line: p.line, col: e } };
  }
  const brackets = { "(": "()", ")": "()", b: "()", "[": "[]", "]": "[]", "{": "{}", "}": "{}", B: "{}", "<": "<>", ">": "<>" };
  if (brackets[kind]) {
    const [o, c] = brackets[kind];
    let open = null, depth = 0, q = { ...p };
    let n = 0;
    // Outward from the caret (count levels).
    let levels = count;
    if (b.at(q) === o) { open = q; levels--; if (levels > 0) q = b.prev(q); }
    while (levels > 0 && q) {
      const ch = b.at(q);
      if (ch === c && cmp(q, p) !== 0) depth++;
      else if (ch === o) { if (depth === 0) { open = q; levels--; } else depth--; }
      if (levels > 0) q = b.prev(q);
      if (++n > 1e6) break;
    }
    if (!open) return null;
    depth = 0; q = b.next(open);
    let close = null;
    while (q) {
      const ch = b.at(q);
      if (ch === o) depth++;
      else if (ch === c) { if (depth === 0) { close = q; break; } depth--; }
      q = b.next(q);
    }
    if (!close) return null;
    if (around) return { start: open, end: b.next(close) ?? { line: close.line, col: close.col + 1 } };
    let s = b.next(open), e = close;
    // A block on its own lines: inner is the lines between.
    if (s.col === b.len(s.line) && s.line < e.line) {
      const lines = b.line(e.line).slice(0, e.col).trim() === "";
      if (lines && e.line - s.line >= 2) return { start: { line: s.line + 1, col: 0 }, end: { line: e.line - 1, col: b.len(e.line - 1) }, linewise: true };
      s = { line: s.line + 1, col: 0 };
    }
    return { start: s, end: e };
  }
  if (kind === "t") {
    const text = b.all(), at = b.offset(p);
    const tags = [];
    const re = /<\/?([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g;
    let m;
    while ((m = re.exec(text))) tags.push({ s: m.index, e: m.index + m[0].length, name: m[1], close: m[0][1] === "/", self: m[2] === "/" });
    const stack = [], pairs = [];
    for (const t of tags) {
      if (t.self) continue;
      if (!t.close) stack.push(t);
      else { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name === t.name) { pairs.push([stack[i], t]); stack.length = i; break; } }
    }
    const around_ = pairs.filter(([o, c]) => o.s <= at && at < c.e).sort((x, y) => (x[1].e - x[0].s) - (y[1].e - y[0].s));
    const pick = around_[Math.min(count, around_.length) - 1];
    if (!pick) return null;
    const [o, c] = pick;
    return around ? { start: b.pos(o.s), end: b.pos(c.e) } : { start: b.pos(o.e), end: b.pos(c.s) };
  }
  if (kind === "p") {
    const blank = (l) => b.line(l).trim() === "";
    const k = blank(p.line);
    let s = p.line, e = p.line;
    while (s > 0 && blank(s - 1) === k) s--;
    while (e < b.last && blank(e + 1) === k) e++;
    if (around) while (e < b.last && blank(e + 1) !== k) e++;
    return { start: { line: s, col: 0 }, end: { line: e, col: b.len(e) }, linewise: true };
  }
  return null;
}

// ---- the machine

function setReg(vim, name, text, linewise, kind) {
  if (name === "_") return;
  const value = { text, linewise: !!linewise };
  if (name && /[A-Z]/.test(name)) {
    const r = vim.registers[name.toLowerCase()];
    vim.registers[name.toLowerCase()] = r ? { text: r.text + (r.linewise && !linewise ? "\n" : "") + text, linewise: r.linewise || linewise } : value;
  } else if (name && name !== '"') vim.registers[name] = value;
  vim.registers['"'] = value;
  if (kind === "yank" && (!name || name === '"')) vim.registers["0"] = value;
  if (kind === "delete" && (!name || name === '"')) {
    if (linewise || text.includes("\n")) { for (let i = 9; i > 1; i--) if (vim.registers[String(i - 1)]) vim.registers[String(i)] = vim.registers[String(i - 1)]; vim.registers["1"] = value; }
    else vim.registers["-"] = value;
  }
  // Everything yanked or deleted also goes to the system clipboard (clipboard=unnamedplus).
  vim.clipboard = { text, linewise: !!linewise };
}

function getReg(vim, name, clipboard) {
  if (name === "+" || name === "*") return clipboard ? { text: clipboard, linewise: clipboard.endsWith("\n") } : vim.registers["+"] ?? null;
  if (!name || name === '"') {
    // Another app's copy wins over the last yank when it differs.
    const own = vim.registers['"'];
    if (clipboard != null && clipboard !== "" && clipboard !== own?.text && clipboard !== (own?.text ?? "") + "\n") return { text: clipboard, linewise: clipboard.endsWith("\n") && !own };
    return own ?? null;
  }
  return vim.registers[name.toLowerCase()] ?? null;
}

/** The range an operator covers from a motion. -> { start, end, linewise } */
function rangeOf(b, from, m, op) {
  let start = minPos(from, m.to), end = maxPos(from, m.to);
  if (m.linewise) return { start: { line: start.line, col: 0 }, end: { line: end.line, col: b.len(end.line) }, linewise: true };
  if (m.inclusive) end = { line: end.line, col: Math.min(b.len(end.line), end.col + 1) };
  // `cw` on a word is `ce`; `dw` at a line's last word stops at the line end.
  if (m.word && end.line > start.line) end = { line: start.line, col: b.len(start.line) };
  return { start, end, linewise: false };
}

function deleteLines(b, s, e) {
  // Lines s..e whole, with their newline.
  if (e < b.last) return b.replace({ line: s, col: 0 }, { line: e + 1, col: 0 }, "");
  if (s > 0) return b.replace({ line: s - 1, col: b.len(s - 1) }, { line: e, col: b.len(e) }, "");
  return b.replace({ line: s, col: 0 }, { line: e, col: b.len(e) }, "");
}

function applyOperator(b, vim, op, r, reg, out) {
  const textOf = () => (r.linewise ? b.text({ line: r.start.line, col: 0 }, { line: r.end.line, col: b.len(r.end.line) }) + "\n" : b.text(r.start, r.end));
  switch (op) {
    case "y": setReg(vim, reg, textOf(), r.linewise, "yank"); b.cursor = r.linewise ? { line: r.start.line, col: b.cursor.col } : r.start; out.clipboard = vim.clipboard; return;
    case "d": {
      setReg(vim, reg, textOf(), r.linewise, "delete"); out.clipboard = vim.clipboard;
      if (r.linewise) { deleteLines(b, r.start.line, r.end.line); b.cursor = b.firstNonBlank(Math.min(r.start.line, b.last)); }
      else { b.replace(r.start, r.end, ""); b.cursor = b.clamp(r.start); }
      return;
    }
    case "c": {
      setReg(vim, reg, textOf(), r.linewise, "delete"); out.clipboard = vim.clipboard;
      if (r.linewise) {
        const indent = b.line(r.start.line).match(/^\s*/)[0];
        b.replace({ line: r.start.line, col: 0 }, { line: r.end.line, col: b.len(r.end.line) }, indent);
        b.cursor = { line: r.start.line, col: indent.length };
      } else { b.replace(r.start, r.end, ""); b.cursor = r.start; }
      enterInsert(vim, b);
      return;
    }
    case ">": case "<": {
      const unit = vim.indent ?? "  ";
      for (let l = r.start.line; l <= r.end.line; l++) {
        const line = b.line(l);
        if (op === ">") { if (line.length) b.replace({ line: l, col: 0 }, { line: l, col: 0 }, unit.repeat(vim.shiftCount ?? 1)); }
        else { const n = Math.min((line.match(/^ */)[0].length), unit.length * (vim.shiftCount ?? 1)); const tabs = line.startsWith("\t") ? 1 : 0; if (n || tabs) b.replace({ line: l, col: 0 }, { line: l, col: n || tabs }, ""); }
      }
      b.cursor = b.firstNonBlank(r.start.line);
      return;
    }
    case "g~": case "gu": case "gU": case "~": {
      const t = b.text(r.linewise ? { line: r.start.line, col: 0 } : r.start, r.linewise ? { line: r.end.line, col: b.len(r.end.line) } : r.end);
      const f = op === "gu" ? (s) => s.toLowerCase() : op === "gU" ? (s) => s.toUpperCase() : (s) => [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join("");
      b.replace(r.linewise ? { line: r.start.line, col: 0 } : r.start, r.linewise ? { line: r.end.line, col: b.len(r.end.line) } : r.end, f(t));
      b.cursor = r.linewise ? { line: r.start.line, col: b.cursor.col } : r.start;
      return;
    }
  }
}

function enterInsert(vim, b, mode = "insert") {
  vim.mode = mode;
  vim.insertStart = { text: b.all(), cursor: { ...b.cursor }, keys: [] };
}

function put(b, vim, reg, after, count, clipboard, out) {
  const r = getReg(vim, reg, clipboard);
  if (!r) return;
  const text = r.text.repeat(count);
  if (r.linewise) {
    const body = text.endsWith("\n") ? text.slice(0, -1) : text;
    if (after) { b.replace({ line: b.cursor.line, col: b.len(b.cursor.line) }, { line: b.cursor.line, col: b.len(b.cursor.line) }, "\n" + body); b.cursor = b.firstNonBlank(b.cursor.line + 1); }
    else { b.replace({ line: b.cursor.line, col: 0 }, { line: b.cursor.line, col: 0 }, body + "\n"); b.cursor = b.firstNonBlank(b.cursor.line); }
  } else {
    const at = after && b.len(b.cursor.line) ? { line: b.cursor.line, col: b.cursor.col + 1 } : b.cursor;
    const end = b.replace(at, at, text);
    b.cursor = text.includes("\n") ? at : b.clamp({ line: end.line, col: end.col - 1 });
  }
}

/** Visual mode's keys: operators act at once on the selection. */
const VISUAL_KEYS = new Set(["d", "c", "y", ">", "<", "x", "X", "D", "Y", "C", "S", "R", "p", "P", "J", "o", "O", "I", "A", "~", "u", "U", "s", "v", "V", "<C-v>", "<del>"]);
export function parseVisual(keys) {
  let i = 0, reg = null;
  if (keys[0] === '"') { if (keys.length < 2) return null; reg = keys[1]; i = 2; }
  let s = "";
  while (i < keys.length && /[0-9]/.test(keys[i]) && !(s === "" && keys[i] === "0")) s += keys[i++];
  if (i >= keys.length) return null;
  const count = s ? Number(s) : 1, has = !!s;
  const k = keys[i];
  if (VISUAL_KEYS.has(k)) return { done: true, reg, key: k, count, has };
  if (k === "r") return i + 1 < keys.length ? { done: true, reg, key: "r", arg: keys[i + 1], count, has } : null;
  if (k === "g") {
    if (i + 1 >= keys.length) return null;
    const g = "g" + keys[i + 1];
    if (g === "gu" || g === "gU" || g === "g~") return { done: true, reg, key: g, count, has };
    if (g === "gv" || g === "gJ") return { done: true, reg, key: g, count, has };
  }
  return parse(keys);
}

/** Parses a pending normal-mode command; -> { done, reg, count, op, key, arg, obj } or null (needs more keys) or false (invalid). */
export function parse(keys) {
  let i = 0;
  let reg = null, count = null, op = null, opCount = null;
  const k = () => keys[i];
  if (k() === '"') { if (keys.length < 2) return null; reg = keys[1]; i = 2; }
  const num = () => { let s = ""; while (i < keys.length && /[0-9]/.test(keys[i]) && !(s === "" && keys[i] === "0")) s += keys[i++]; return s ? Number(s) : null; };
  count = num();
  if (i >= keys.length) return null;
  const two = (a) => keys[i] === a[0] && keys[i + 1] === a[1];
  if (keys[i] === "g" && i + 1 >= keys.length) return null;
  if (["d", "c", "y", ">", "<"].includes(keys[i]) || (keys[i] === "g" && ["~", "u", "U"].includes(keys[i + 1]))) {
    op = keys[i] === "g" ? "g" + keys[i + 1] : keys[i];
    i += op.length;
    opCount = num();
    if (i >= keys.length) return null;
    const total = (count ?? 1) * (opCount ?? 1), has = count != null || opCount != null;
    // dd cc yy >> << g~~ guu gUU (and gugu...)
    const last = op[op.length - 1];
    if (keys[i] === last || (op.length === 2 && keys[i] === "g" && keys[i + 1] === op[1])) return { done: true, reg, op, line: true, count: total, has };
    if (keys[i] === "i" || keys[i] === "a") { if (i + 1 >= keys.length) return null; return { done: true, reg, op, obj: keys[i + 1], around: keys[i] === "a", count: total, has }; }
    let key = keys[i];
    if (key === "g") { if (i + 1 >= keys.length) return null; key = "g" + keys[i + 1]; i++; }
    if (!MOTIONS.has(key)) return false;
    if (MOTION_ARG.has(key)) { if (i + 1 >= keys.length) return null; return { done: true, reg, op, key, arg: keys[i + 1], count: total, has }; }
    return { done: true, reg, op, key, count: total, has };
  }
  let key = keys[i];
  if (key === "g" || key === "Z" || key === "[" || key === "]" || key === "z") { if (i + 1 >= keys.length) return null; key = key + keys[i + 1]; i++; }
  if (MOTION_ARG.has(key) || ["r", "m", "q", "@"].includes(key)) { if (i + 1 >= keys.length) return null; return { done: true, reg, key, arg: keys[i + 1], count: count ?? 1, has: count != null }; }
  void two;
  return { done: true, reg, key, count: count ?? 1, has: count != null };
}

/**
 * Feeds one key. `doc`: { text, cursor, clipboard? } as the editor has them
 * now. -> { taken, edits, cursor, selections, mode, commands, clipboard,
 * message, ex, pending, which } (what changed; omitted keys mean unchanged).
 */
export function feed(vim, key, doc) {
  const out = { taken: true, commands: [] };
  if (key == null) return { taken: false };
  // Macro recording (not of the q that ends it).
  if (vim.recording && !vim.replaying && !(vim.mode !== "insert" && vim.keys.length === 0 && key === "q")) vim.recording.keys.push(key);
  if (vim.ex != null) return exKey(vim, key, doc, out);
  if (vim.mode === "insert" || vim.mode === "replace") return insertKey(vim, key, doc, out);
  // In visual modes the editor's caret sits at the selection's end, not on
  // vim's head: the head is vim's own.
  const visual = vim.mode === "visual" || vim.mode === "vline" || vim.mode === "vblock";
  const b = new Buffer(doc.text, visual && vim.head ? vim.head : doc.cursor);
  vim.page = doc.page ?? vim.page;
  if (vim.pendingLeader) return leaderKey(vim, key, b, out);
  if (vim.keys.length === 0 && key === vim.leader && (vim.mode === "normal")) {
    vim.pendingLeader = vim.leaderMap;
    out.which = whichOf(vim.pendingLeader);
    return out;
  }
  if (key === "<esc>") {
    vim.keys = [];
    if (vim.mode !== "normal") { vim.mode = "normal"; vim.anchor = null; vim.head = null; out.mode = "normal"; out.cursor = b.clamp(b.cursor); out.selections = null; }
    out.taken = true; out.pending = "";
    return out;
  }
  if (key === ":" && vim.keys.length === 0) {
    vim.ex = vim.mode.startsWith("v") || vim.mode === "vblock" ? "'<,'>" : "";
    if (vim.mode !== "normal") { vim.marks["<"] = minPos(vim.anchor, b.cursor); vim.marks[">"] = maxPos(vim.anchor, b.cursor); }
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
    out.message = `recorded @${stopRecording(vim)}`;
    out.recording = null;
    return out;
  }
  vim.keys.push(key);
  // Visual mode: i / a then an object extends the selection over it (viw, va").
  if ((vim.mode === "visual" || vim.mode === "vline") && (vim.keys[0] === "i" || vim.keys[0] === "a")) {
    if (vim.keys.length < 2) { out.pending = vim.keys.join(""); return out; }
    const [ia, obj] = vim.keys;
    vim.keys = [];
    const r = textObject(b, b.cursor, ia === "a", obj, 1);
    if (r) {
      if (r.linewise && vim.mode === "visual") vim.mode = "vline";
      vim.anchor = r.start;
      b.cursor = cmp(r.end, r.start) > 0 ? (b.prev(r.end) ?? r.end) : r.end;
    }
    out.cursor = b.cursor; out.mode = vim.mode; out.selections = visualSelections(vim, b); out.pending = "";
    vim.head = { ...b.cursor };
    return out;
  }
  const cmd = vim.mode === "visual" || vim.mode === "vline" || vim.mode === "vblock" ? parseVisual(vim.keys) : parse(vim.keys);
  if (cmd === null) { out.pending = vim.keys.join(""); return out; }
  const keys = vim.keys;
  vim.keys = [];
  out.pending = "";
  if (cmd === false) return out;
  const before = { ...b.cursor };
  const result = vim.mode.startsWith("v") || vim.mode === "vblock" ? visualCommand(vim, cmd, b, doc, out) : normalCommand(vim, cmd, b, doc, out);
  if (result === "unknown") { out.taken = !(keys.length === 1 && keys[0].startsWith("<C-")); return out; }
  // Only a change counts for `.` (not undo, `.` itself, motions or yanks).
  const changed = result === true;
  if (changed && !vim.replaying && vim.mode !== "insert") vim.lastChange = { keys, inserted: null };
  if (changed && vim.mode === "insert") vim.insertStart.keys = keys;
  out.edits = b.edits;
  if (vim.mode === "normal" || vim.mode === "insert" || vim.mode === "replace") out.cursor = vim.mode === "normal" ? b.clamp(b.cursor) : b.clamp(b.cursor, true);
  else out.cursor = b.cursor;
  if (cmp(before, b.cursor) !== 0 && !out.keepGoal) vim.goal = null;
  out.mode = vim.mode;
  if (vim.mode === "visual" || vim.mode === "vline" || vim.mode === "vblock") { out.selections = visualSelections(vim, b); vim.head = { ...b.cursor }; }
  else vim.head = null;
  return out;
}

function whichOf(node) {
  return Object.entries(node).filter(([k]) => k !== "name").map(([k, v]) => ({ key: k === " " ? "space" : k, label: Array.isArray(v) ? v[1] : `+${v.name ?? k}` }));
}

function leaderKey(vim, key, b, out) {
  if (key === "<esc>") { vim.pendingLeader = null; out.which = null; return out; }
  const next = vim.pendingLeader[key];
  if (!next) { vim.pendingLeader = null; out.which = null; out.message = `leader: nothing on ${key}`; return out; }
  if (Array.isArray(next)) { vim.pendingLeader = null; out.which = null; out.commands.push(next[0]); return out; }
  vim.pendingLeader = next;
  out.which = whichOf(next);
  return out;
}

function normalCommand(vim, cmd, b, doc, out) {
  const p = b.cursor, n = cmd.count;
  if (cmd.op) {
    let r;
    if (cmd.line) {
      const e = Math.min(b.last, p.line + n - 1);
      r = { start: { line: p.line, col: 0 }, end: { line: e, col: b.len(e) }, linewise: true };
      if (cmd.op === "<" || cmd.op === ">") r.linewise = true;
    } else if (cmd.obj) {
      r = textObject(b, p, cmd.around, cmd.obj, n);
      if (!r) return false;
    } else {
      // `cw` on a non-blank changes to the end of this word (and n - 1 more).
      let key = cmd.key;
      let m;
      if (cmd.op === "c" && (key === "w" || key === "W") && cls(b.at(p), key === "W") > 0) {
        const big = key === "W", k = cls(b.at(p), big);
        let q = { ...p }, nn;
        while ((nn = b.next(q)) && b.at(nn) !== "\n" && cls(b.at(nn), big) === k) q = nn;
        if (n > 1) q = wordEnd(b, q, big, n - 1);
        m = { to: q, inclusive: true };
      } else m = motion(b, vim, key, n, cmd.arg, cmd.has);
      if (!m) return false;
      r = rangeOf(b, p, m, cmd.op);
      if ((key === "j" || key === "k") && m.to.line === p.line && n > 0 && key === "j" && p.line === b.last) return false;
    }
    if (r.end && r.start && cmp(r.start, r.end) === 0 && !r.linewise && cmd.op !== "c") return false;
    applyOperator(b, vim, cmd.op, r, cmd.reg, out);
    return cmd.op !== "y";
  }
  const key = cmd.key;
  if (MOTIONS.has(key)) {
    const m = motion(b, vim, key, n, cmd.arg, cmd.has);
    if (!m) return false;
    if (m.jump) vim.marks["`"] = { ...p };
    if (m.keepGoal) { if (vim.goal == null) vim.goal = p.col; out.keepGoal = true; }
    b.cursor = m.to;
    if (m.eol) { vim.goal = 1e9; out.keepGoal = true; }
    return false;
  }
  switch (key) {
    case "i": enterInsert(vim, b); return true;
    case "a": b.cursor = { line: p.line, col: Math.min(b.len(p.line), p.col + 1) }; enterInsert(vim, b); return true;
    case "I": b.cursor = b.firstNonBlank(p.line); if (b.len(p.line) && b.line(p.line).trim() === "") b.cursor = { line: p.line, col: b.len(p.line) }; enterInsert(vim, b); return true;
    case "gI": b.cursor = { line: p.line, col: 0 }; enterInsert(vim, b); return true;
    case "A": b.cursor = { line: p.line, col: b.len(p.line) }; enterInsert(vim, b); return true;
    case "o": case "O": {
      const indent = b.line(p.line).match(/^\s*/)[0] + (key === "o" && /[{([:]\s*$/.test(b.line(p.line)) ? (vim.indent ?? "  ") : "");
      if (key === "o") { b.replace({ line: p.line, col: b.len(p.line) }, { line: p.line, col: b.len(p.line) }, "\n" + indent); b.cursor = { line: p.line + 1, col: indent.length }; }
      else { b.replace({ line: p.line, col: 0 }, { line: p.line, col: 0 }, indent + "\n"); b.cursor = { line: p.line, col: indent.length }; }
      enterInsert(vim, b); return true;
    }
    case "x": case "<del>": { if (!b.len(p.line)) return false; const e = Math.min(b.len(p.line), p.col + n); applyOperator(b, vim, "d", { start: p, end: { line: p.line, col: e } }, cmd.reg, out); return true; }
    case "X": { if (!p.col) return false; applyOperator(b, vim, "d", { start: { line: p.line, col: Math.max(0, p.col - n) }, end: p }, cmd.reg, out); return true; }
    case "s": { const e = Math.min(b.len(p.line), p.col + n); applyOperator(b, vim, "c", { start: p, end: { line: p.line, col: e } }, cmd.reg, out); return true; }
    case "S": case "cc": { const e = Math.min(b.last, p.line + n - 1); applyOperator(b, vim, "c", { start: { line: p.line, col: 0 }, end: { line: e, col: b.len(e) }, linewise: true }, cmd.reg, out); return true; }
    case "D": { const e = Math.min(b.last, p.line + n - 1); applyOperator(b, vim, "d", { start: p, end: { line: e, col: b.len(e) } }, cmd.reg, out); b.cursor = b.clamp(b.cursor); return true; }
    case "C": { const e = Math.min(b.last, p.line + n - 1); applyOperator(b, vim, "c", { start: p, end: { line: e, col: b.len(e) } }, cmd.reg, out); return true; }
    case "Y": { const e = Math.min(b.last, p.line + n - 1); applyOperator(b, vim, "y", { start: { line: p.line, col: 0 }, end: { line: e, col: b.len(e) }, linewise: true }, cmd.reg, out); b.cursor = p; return false; }
    case "p": case "P": put(b, vim, cmd.reg, key === "p", n, doc.clipboard, out); return true;
    case "r": {
      if (p.col + n > b.len(p.line)) return false;
      const ch = cmd.arg === "<cr>" ? "\n" : cmd.arg;
      if (ch.length !== 1 && ch !== "\n") return false;
      b.replace(p, { line: p.line, col: p.col + n }, ch === "\n" ? "\n" : ch.repeat(n));
      b.cursor = ch === "\n" ? { line: p.line + 1, col: 0 } : { line: p.line, col: p.col + n - 1 };
      return true;
    }
    case "R": enterInsert(vim, b, "replace"); return true;
    case "J": case "gJ": {
      const last = Math.min(b.last, p.line + Math.max(1, n - 1));
      if (last === p.line) return false;
      for (let l = p.line; l < last; l++) {
        const end = b.len(p.line), nextLine = b.line(p.line + 1);
        const lead = key === "J" ? nextLine.match(/^\s*/)[0].length : 0;
        const sep = key === "J" && end > 0 && nextLine.trim() !== "" && !nextLine.trim().startsWith(")") ? " " : "";
        const trail = key === "J" ? b.line(p.line).match(/\s*$/)[0].length : 0;
        b.replace({ line: p.line, col: end - trail }, { line: p.line + 1, col: lead }, sep);
        b.cursor = { line: p.line, col: end - trail };
      }
      return true;
    }
    case "~": { const e = Math.min(b.len(p.line), p.col + n); if (e === p.col) return false; applyOperator(b, vim, "~", { start: p, end: { line: p.line, col: e } }, null, out); b.cursor = b.clamp({ line: p.line, col: e }); return true; }
    case "u": out.commands.push(...Array(n).fill("undo")); return "nochange";
    case "<C-r>": out.commands.push(...Array(n).fill("redo")); return "nochange";
    case ".": return repeat(vim, b, doc, out, cmd.has ? n : null);
    case "v": vim.mode = "visual"; vim.anchor = { ...p }; return false;
    case "V": vim.mode = "vline"; vim.anchor = { ...p }; return false;
    case "<C-v>": vim.mode = "vblock"; vim.anchor = { ...p }; return false;
    case "gv": { const s = vim.marks["<"], e = vim.marks[">"]; if (!s) return false; vim.mode = vim.lastVisual ?? "visual"; vim.anchor = s; b.cursor = e; return false; }
    case "m": if (/[a-zA-Z]/.test(cmd.arg)) vim.marks[cmd.arg] = { ...p }; return false;
    case "q": {
      if (vim.recording) return false;
      if (!/[a-z0-9"]/i.test(cmd.arg)) return false;
      vim.recording = { reg: cmd.arg.toLowerCase(), keys: [], append: /[A-Z]/.test(cmd.arg) };
      out.message = `recording @${vim.recording.reg}`;
      return false;
    }
    case "@": {
      const r = cmd.arg === "@" ? vim.lastMacro : cmd.arg;
      const reg = vim.registers[r];
      if (!reg) return false;
      vim.lastMacro = r;
      out.replay = { keys: tokens(reg.text), times: n };
      return false;
    }
    case "gd": out.commands.push("definition"); return false;
    // The pane's file tabs: gt / gT (a count: that tab), ]b / [b.
    case "gt": out.commands.push(cmd.has ? `tab:${n}` : "next-tab"); return false;
    case "gT": case "[b": out.commands.push(...Array(n).fill("prev-tab")); return false;
    case "]b": out.commands.push(...Array(n).fill("next-tab")); return false;
    case "gr": out.commands.push("references"); return false;
    case "K": out.commands.push("hover"); return false;
    case "]d": out.commands.push("next-problem"); return false;
    case "[d": out.commands.push("prev-problem"); return false;
    case "gx": out.commands.push("open-link"); return false;
    case "zz": out.commands.push("center"); return false;
    case "ZZ": out.commands.push("save-quit"); return false;
    case "ZQ": out.commands.push("quit!"); return false;
    case "<C-o>": out.commands.push("back"); return false;
    case "<C-g>": out.message = "file info"; out.commands.push("info"); return false;
    case "<C-a>": case "<C-x>": {
      const line = b.line(p.line);
      const re = /-?\d+/g; let m;
      while ((m = re.exec(line))) if (m.index + m[0].length > p.col) break;
      if (!m) return false;
      const v = Number(m[0]) + (key === "<C-a>" ? n : -n);
      b.replace({ line: p.line, col: m.index }, { line: p.line, col: m.index + m[0].length }, String(v));
      b.cursor = { line: p.line, col: m.index + String(v).length - 1 };
      return true;
    }
    default: return "unknown";
  }
}

/** Keys from a register's text (a recorded macro). */
export function tokens(text) {
  const out = [];
  const re = /<[^<>\s]+>|[\s\S]/gu;
  let m;
  while ((m = re.exec(text))) out.push(m[0]);
  return out;
}

function visualSelections(vim, b) {
  const a = vim.anchor, c = b.cursor;
  if (vim.mode === "visual") {
    const s = minPos(a, c), e = maxPos(a, c);
    return [{ start: s, end: { line: e.line, col: Math.min(b.len(e.line), e.col + 1) }, head: cmp(c, a) < 0 ? "start" : "end" }];
  }
  if (vim.mode === "vline") {
    const s = Math.min(a.line, c.line), e = Math.max(a.line, c.line);
    return [{ start: { line: s, col: 0 }, end: { line: e, col: b.len(e) }, head: c.line < a.line ? "start" : "end" }];
  }
  const s = Math.min(a.line, c.line), e = Math.max(a.line, c.line), l = Math.min(a.col, c.col), r = Math.max(a.col, c.col) + 1;
  const out = [];
  for (let line = s; line <= e; line++) out.push({ start: { line, col: Math.min(l, b.len(line)) }, end: { line, col: Math.min(r, b.len(line)) } });
  return out;
}

function visualRange(vim, b) {
  const a = vim.anchor, c = b.cursor;
  if (vim.mode === "vline") { const s = Math.min(a.line, c.line), e = Math.max(a.line, c.line); return { start: { line: s, col: 0 }, end: { line: e, col: b.len(e) }, linewise: true }; }
  const s = minPos(a, c), e = maxPos(a, c);
  return { start: s, end: { line: e.line, col: Math.min(b.len(e.line), e.col + 1) }, linewise: false };
}

function leaveVisual(vim, b) {
  vim.marks["<"] = minPos(vim.anchor, b.cursor);
  vim.marks[">"] = maxPos(vim.anchor, b.cursor);
  vim.lastVisual = vim.mode;
  vim.mode = "normal";
  vim.anchor = null;
}

function visualCommand(vim, cmd, b, doc, out) {
  const key = cmd.key ?? cmd.op;
  const n = cmd.count;
  if (!cmd.op && MOTIONS.has(key)) {
    const m = motion(b, vim, key, n, cmd.arg, cmd.has);
    if (m) { if (m.keepGoal) { if (vim.goal == null) vim.goal = b.cursor.col; out.keepGoal = true; } b.cursor = m.to; }
    return false;
  }
  // Text objects extend the selection: viw, va(, vip.
  if (!cmd.op && (key === "i" || key === "a")) return "pending-object";
  const block = vim.mode === "vblock";
  const r = visualRange(vim, b);
  const op = cmd.op ?? { d: "d", x: "d", "<del>": "d", y: "y", c: "c", s: "c", ">": ">", "<": "<", "~": "~", u: "gu", U: "gU", gu: "gu", gU: "gU", "g~": "g~", X: "D", D: "D", Y: "Y", C: "C", S: "S", R: "S" }[key];
  switch (key) {
    case "o": { const a = vim.anchor; vim.anchor = { ...b.cursor }; b.cursor = a; return false; }
    case "v": case "V": case "<C-v>": {
      const want = key === "v" ? "visual" : key === "V" ? "vline" : "vblock";
      if (vim.mode === want) { leaveVisual(vim, b); return false; }
      vim.mode = want; return false;
    }
    case "J": { leaveVisual(vim, b); b.cursor = r.start; return normalCommand(vim, { key: "J", count: Math.max(2, r.end.line - r.start.line + 1) }, b, doc, out); }
    case "p": case "P": {
      const reg = getReg(vim, cmd.reg, doc.clipboard);
      if (!reg) return false;
      const old = b.text(r.start, r.end) + (r.linewise ? "\n" : "");
      leaveVisual(vim, b);
      if (r.linewise) { b.replace(r.start, r.end, reg.text.replace(/\n$/, "")); b.cursor = b.firstNonBlank(r.start.line); }
      else { const end = b.replace(r.start, r.end, reg.linewise ? "\n" + reg.text.replace(/\n$/, "") + "\n" : reg.text); b.cursor = b.clamp({ line: end.line, col: Math.max(0, end.col - 1) }); }
      if (key === "p") setReg(vim, null, old, r.linewise, "delete");
      out.clipboard = vim.clipboard;
      return true;
    }
    case "r": {
      leaveVisual(vim, b);
      const sels = block ? visualSelections({ ...vim, mode: "vblock", anchor: vim.marks["<"] }, Object.assign(Object.create(Buffer.prototype), b, { cursor: vim.marks[">"] })) : null;
      const ranges = sels ?? [r];
      for (const s of [...ranges].reverse()) { const t = b.text(s.start, s.end); b.replace(s.start, s.end, t.replace(/[^\n]/g, cmd.arg)); }
      b.cursor = r.start;
      return true;
    }
    case "I": case "A": {
      if (!block) { leaveVisual(vim, b); b.cursor = key === "I" ? r.start : { line: r.end.line, col: r.end.col }; enterInsert(vim, b); return true; }
      const sels = visualSelections(vim, b);
      leaveVisual(vim, b);
      // One caret per line of the block: typing goes to all.
      out.multi = sels.map((s) => (key === "I" ? s.start : s.end));
      b.cursor = out.multi[0];
      enterInsert(vim, b);
      return true;
    }
  }
  if (!op) { leaveVisual(vim, b); return "unknown"; }
  if (block && (op === "d" || op === "c" || op === "y" || op === "~" || op === "gu" || op === "gU")) {
    const sels = visualSelections(vim, b);
    leaveVisual(vim, b);
    const texts = sels.map((s) => b.text(s.start, s.end));
    if (op === "y") { setReg(vim, cmd.reg, texts.join("\n"), false, "yank"); out.clipboard = vim.clipboard; b.cursor = sels[0].start; return false; }
    if (op === "d" || op === "c") {
      setReg(vim, cmd.reg, texts.join("\n"), false, "delete"); out.clipboard = vim.clipboard;
      for (const s of [...sels].reverse()) b.replace(s.start, s.end, "");
      b.cursor = sels[0].start;
      if (op === "c") { out.multi = sels.map((s) => s.start); enterInsert(vim, b); }
      return true;
    }
    for (const s of [...sels].reverse()) applyOperator(b, vim, op, { start: s.start, end: s.end }, null, out);
    b.cursor = sels[0].start;
    return true;
  }
  leaveVisual(vim, b);
  if (op === "D" || op === "X" || op === "Y" || op === "C" || op === "S") {
    const lr = { start: { line: r.start.line, col: 0 }, end: { line: r.end.line, col: b.len(r.end.line) }, linewise: true };
    applyOperator(b, vim, op === "Y" ? "y" : op === "D" ? "d" : "c", lr, cmd.reg, out);
    return op !== "Y";
  }
  if (op === ">" || op === "<") vim.shiftCount = n;
  applyOperator(b, vim, op, r, cmd.reg, out);
  vim.shiftCount = 1;
  if (op === "y") { b.cursor = r.start; return false; }
  return true;
}

/** `.`: the last change again (at the caret, `count` times when given). */
function repeat(vim, b, doc, out, count) {
  const last = vim.lastChange;
  if (!last) return false;
  out.replay = { keys: (count ? stripCount(last.keys, count) : last.keys).concat(last.inserted != null ? [{ insert: last.inserted }, "<esc>"] : []), times: 1, repeat: true };
  return "nochange";
}

function stripCount(keys, count) {
  let i = 0;
  if (keys[0] === '"') i = 2;
  let j = i;
  while (j < keys.length && /[1-9]/.test(keys[j]) || (j > i && /[0-9]/.test(keys[j]))) j++;
  return [...keys.slice(0, i), ...String(count), ...keys.slice(j)];
}

function insertKey(vim, key, doc, out) {
  if (vim.insertStart && !vim.replaying) vim.insertStart.typed = true;
  if (key === "<esc>") {
    // What was typed since insert mode began, for `.` and macros: the text
    // that differs between then and now, as one insertion at the start.
    const st = vim.insertStart;
    const inserted = st ? typedText(st.text, doc.text) : "";
    if (st && !vim.replaying) vim.lastChange = { keys: st.keys ?? [], inserted };
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
    if (typeof key === "object" && key.insert != null) { const end = b.replace(b.cursor, b.cursor, key.insert); b.cursor = end; }
    else if (key === "<cr>") { const end = b.replace(b.cursor, b.cursor, "\n" + b.line(b.cursor.line).match(/^\s*/)[0]); b.cursor = end; }
    else if (key === "<bs>") { const pr = b.prev(b.cursor); if (pr) { b.replace(pr, b.cursor, ""); b.cursor = pr; } }
    else if (key === "<tab>") { const end = b.replace(b.cursor, b.cursor, vim.indent ?? "  "); b.cursor = end; }
    else if (typeof key === "string" && [...key].length === 1) {
      if (vim.mode === "replace" && b.cursor.col < b.len(b.cursor.line)) b.cursor = b.replace(b.cursor, { line: b.cursor.line, col: b.cursor.col + 1 }, key);
      else b.cursor = b.replace(b.cursor, b.cursor, key);
    }
    out.edits = b.edits; out.cursor = b.cursor;
    return out;
  }
  if (vim.mode === "replace" && typeof key === "string" && [...key].length === 1) {
    // Overtype: the editor would insert; replace the next character instead.
    const b = new Buffer(doc.text, doc.cursor);
    if (b.cursor.col < b.len(b.cursor.line)) { b.replace(b.cursor, { line: b.cursor.line, col: b.cursor.col + 1 }, key); out.edits = b.edits; out.cursor = { line: b.cursor.line, col: b.cursor.col + 1 }; return out; }
  }
  // Everything else is the editor's: typing, IME, arrows, backspace.
  out.taken = false;
  return out;
}

/** The text inserted between `before` and `after` (one contiguous change). */
export function typedText(before, after) {
  let s = 0;
  while (s < before.length && s < after.length && before[s] === after[s]) s++;
  let e = 0;
  while (e < before.length - s && e < after.length - s && before[before.length - 1 - e] === after[after.length - 1 - e]) e++;
  return after.slice(s, after.length - e);
}

// ---- the ex line

function exKey(vim, key, doc, out) {
  if (key === "<esc>") { vim.ex = null; out.ex = null; return out; }
  if (key === "<bs>") { if (!vim.ex.length || vim.ex === "/" || vim.ex === "?") vim.ex = null; else vim.ex = vim.ex.slice(0, -1); out.ex = vim.ex; return out; }
  if (key === "<cr>") { const line = vim.ex; vim.ex = null; out.ex = null; return runEx(vim, line, doc, out); }
  if (typeof key === "string" && [...key].length === 1) vim.ex += key;
  else if (key === "<tab>") vim.ex += "\t";
  out.ex = vim.ex;
  return out;
}

/** Runs an ex line (`:w`, `:%s/a/b/g`, `/pattern`...). */
export function runEx(vim, line, doc, out) {
  const b = new Buffer(doc.text, doc.cursor);
  if (line.startsWith("/") || line.startsWith("?")) {
    const back = line[0] === "?";
    const pat = line.slice(1) || vim.search?.pattern;
    if (!pat) return out;
    vim.search = { pattern: pat, back };
    const to = searchFrom(b, b.cursor, pat, back, 1);
    if (!to) { out.message = `not found: ${pat}`; return out; }
    vim.marks["`"] = { ...b.cursor };
    out.cursor = to; out.search = pat;
    if (vim.mode !== "normal") { b.cursor = to; out.selections = visualSelections(vim, b); }
    return out;
  }
  const wasVisual = vim.mode !== "normal" && vim.mode !== "insert";
  if (wasVisual) { vim.mode = "normal"; vim.anchor = null; out.mode = "normal"; out.selections = null; }
  let rest = line.trim();
  // A range: %, ., $, numbers, '<,'>, 'a, +n, -n.
  const addr = () => {
    let m;
    if ((m = rest.match(/^(\d+)/))) { rest = rest.slice(m[0].length); return Number(m[1]) - 1; }
    if (rest[0] === ".") { rest = rest.slice(1); return b.cursor.line; }
    if (rest[0] === "$") { rest = rest.slice(1); return b.last; }
    if ((m = rest.match(/^'([a-z<>])/))) { rest = rest.slice(2); return vim.marks[m[1]]?.line ?? null; }
    return undefined;
  };
  let from = null, to = null;
  if (rest[0] === "%") { from = 0; to = b.last; rest = rest.slice(1); }
  else {
    const a = addr();
    if (a !== undefined) {
      from = to = a;
      let m;
      while ((m = rest.match(/^([+-])(\d*)/)) && m[0]) { const d = Number(m[2] || 1) * (m[1] === "+" ? 1 : -1); from = to = (to ?? b.cursor.line) + d; rest = rest.slice(m[0].length); }
      if (rest[0] === ",") { rest = rest.slice(1); const c = addr(); to = c === undefined ? from : c; }
    }
  }
  const cmd = rest.match(/^([a-zA-Z]*)(!?)\s*(.*)$/s) ?? [null, rest, "", ""];
  const [, name, bang, arg] = cmd;
  if (!name && from != null) { out.cursor = b.firstNonBlank(Math.max(0, Math.min(b.last, to))); vim.marks["`"] = { ...b.cursor }; return out; }
  const one = from ?? b.cursor.line, two = to ?? one;
  switch (name) {
    case "w": case "write": out.commands.push(arg ? `write:${arg}` : "save"); return out;
    case "wq": case "x": case "xit": case "exit": out.commands.push("save-quit"); return out;
    case "q": case "quit": case "close": out.commands.push(bang ? "quit!" : "quit"); return out;
    case "wa": case "wall": out.commands.push("save"); return out;
    case "e": case "edit": out.commands.push(arg ? `edit:${arg}` : bang ? "reload!" : "reload"); return out;
    case "noh": case "nohlsearch": out.commands.push("nohlsearch"); return out;
    // The pane's file tabs, as buffers: :bn :bp :bd(!) :b N :ls, and :tabn :tabp :tabc.
    case "bn": case "bnext": case "tabn": case "tabnext": out.commands.push("next-tab"); return out;
    case "bp": case "bprevious": case "bN": case "bNext": case "tabp": case "tabprevious": case "tabN": out.commands.push("prev-tab"); return out;
    case "bd": case "bdelete": case "bw": case "bwipeout": case "tabc": case "tabclose": out.commands.push(bang ? "close-tab!" : "close-tab"); return out;
    case "b": case "buffer": if (!/^\d+$/.test(arg.trim())) { out.message = "E94: :b takes a tab number (:ls lists them)"; return out; } out.commands.push(`tab:${arg.trim()}`); return out;
    case "ls": case "buffers": case "files": out.commands.push("tabs"); return out;
    case "u": case "undo": out.commands.push("undo"); return out;
    case "red": case "redo": out.commands.push("redo"); return out;
    case "d": case "delete": {
      setReg(vim, null, b.text({ line: one, col: 0 }, { line: two, col: b.len(two) }) + "\n", true, "delete"); out.clipboard = vim.clipboard;
      deleteLines(b, Math.min(one, two), Math.max(one, two));
      out.edits = b.edits; out.cursor = b.firstNonBlank(Math.min(one, b.last)); return out;
    }
    case "y": case "yank": setReg(vim, null, b.text({ line: one, col: 0 }, { line: two, col: b.len(two) }) + "\n", true, "yank"); out.clipboard = vim.clipboard; return out;
    case "j": case "join": { b.cursor = { line: Math.min(one, two), col: 0 }; normalCommand(vim, { key: "J", count: Math.max(2, Math.abs(two - one) + 1) }, b, doc, out); out.edits = b.edits; out.cursor = b.cursor; return out; }
    case "s": case "substitute": case "": {
      if (name === "" && !arg) return out;
      const sub = (name === "" ? rest : arg).match(/^([^\w\s\\])((?:\\.|(?!\1).)*)\1((?:\\.|(?!\1).)*)(?:\1([gci]*))?$/s);
      if (!sub) { out.message = "E486: substitute needs /pattern/replacement/"; return out; }
      const [, , pat, rep, flags = ""] = sub;
      const re = pattern(pat || vim.search?.pattern || "");
      const global = flags.includes("g");
      const ignore = flags.includes("i");
      const rx = new RegExp(re.source, (global ? "g" : "") + (ignore || re.flags.includes("i") ? "i" : ""));
      const replacement = rep.replace(/\\(\d)/g, "$$$1").replace(/(^|[^\\])&/g, "$1$$&").replace(/\\&/g, "&").replace(/\\n/g, "\n").replace(/\\\//g, "/");
      let count = 0, lastLine = null;
      for (let l = Math.min(one, two); l <= Math.max(one, two) && l <= b.last; l++) {
        const old = b.line(l);
        const next = old.replace(rx, (...m) => { count++; return m[0].replace(new RegExp(rx.source, rx.flags.replace("g", "")), replacement); });
        if (next !== old) { b.replace({ line: l, col: 0 }, { line: l, col: old.length }, next); lastLine = l + (next.split("\n").length - 1); l += next.split("\n").length - 1; }
      }
      if (pat) vim.search = { pattern: pat, back: false };
      if (!count) { out.message = `pattern not found: ${pat}`; return out; }
      out.edits = b.edits; out.cursor = b.firstNonBlank(lastLine ?? b.cursor.line);
      out.message = `${count} substitution${count === 1 ? "" : "s"}`;
      return out;
    }
    case "set": out.commands.push(`set:${arg}`); return out;
    case "vim": case "novim": out.commands.push("vim"); return out;
    default: out.message = `E492: not an editor command: ${line}`; return out;
  }
}

/** Ends a macro recording: the register gets the keys. -> the register name. */
export function stopRecording(vim) {
  const r = vim.recording;
  if (!r) return null;
  vim.recording = null;
  const text = r.keys.map((k) => (typeof k === "string" ? k : k.insert ?? "")).join("");
  const prev = r.append ? vim.registers[r.reg]?.text ?? "" : "";
  vim.registers[r.reg] = { text: prev + text, linewise: false };
  return r.reg;
}

/** The caret's shape for a mode. */
// Visual modes: a bar, where the editor draws its caret (the selection's edge).
export const SHAPE = { normal: "block", visual: "bar", vline: "bar", vblock: "bar", insert: "bar", replace: "underline" };
/** The mode's name in the bar. */
export const MODE_NAME = { normal: "NORMAL", insert: "INSERT", replace: "REPLACE", visual: "VISUAL", vline: "V-LINE", vblock: "V-BLOCK" };

/** Applies edits to a text, in order (each one against the text after the previous); for tests and replays. */
export function applyEdits(text, edits) {
  const b = new Buffer(text, { line: 0, col: 0 });
  for (const e of edits ?? []) {
    const lines = b.lines;
    void lines;
    b.replace(e.start, e.end, e.text);
  }
  return b.all();
}

/** Plays keys (a macro, `.`) `times` times against `doc` as if typed, with
 *  insert-mode text applied as edits: -> the edits in order, the final
 *  caret, mode and selections, commands and messages. */
export function play(vim, keys, doc, times = 1) {
  let text = doc.text, cursor = { ...doc.cursor };
  const res = { edits: [], commands: [], cursor, mode: vim.mode, selections: undefined, clipboard: undefined, message: undefined };
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
  } finally { vim.replaying = was; }
  res.cursor = cursor; res.mode = vim.mode; res.text = text;
  return res;
}

function absorb(res, r) {
  if (r.edits?.length) res.edits.push(...r.edits);
  if (r.commands?.length) res.commands.push(...r.commands);
  if (r.selections !== undefined) res.selections = r.selections;
  if (r.clipboard !== undefined) res.clipboard = r.clipboard;
  if (r.message !== undefined) res.message = r.message;
}
