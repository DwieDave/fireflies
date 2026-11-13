// Markdown commands, each a function from the text and a selection to the
// new text and selection: bold, italic, inline code, link, heading level up
// and down (and 0-6 straight), bullet list, numbered list, task box, tick,
// quote, code block, rule; and the enter that continues a list. Running one
// where it's already on takes it off again. The editor runs them (main.js:
// cmd-. and a letter, vim's space .; the palette), in every Markdown view.
//
// A selection is { start, end } of { line, col } (zero-based, columns in
// JavaScript string units, as the editor's), start before end; a caret is a
// selection whose ends meet. Only the lines a command is about change: the
// rest of the text comes back as it was, byte for byte (CRLF files keep
// their line ends).

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
};
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

const pos = (line, col) => ({ line, col });
const caret = (p) => ({ start: p, end: p });
const before = (a, b) => a.line < b.line || (a.line === b.line && a.col <= b.col);
export function ordered(sel) {
  return before(sel.start, sel.end) ? sel : { start: sel.end, end: sel.start };
}

/** The text as lines, and how to join them back (its own line end). */
function split(text) {
  const t = String(text);
  const eol = /\r\n/.test(t) ? "\r\n" : "\n";
  return { lines: t.split(/\r?\n/), eol };
}

/** Runs a command: -> { text, sel } (sel ordered), or null when it changes nothing. */
export function run(name, text, sel) {
  const s = ordered(sel);
  const f = name.startsWith("heading-") && /^heading-[0-6]$/.test(name) ? (t, x) => headingTo(t, x, Number(name.slice(8))) : ACTIONS[name];
  if (!f) return null;
  const r = f(String(text), s);
  if (!r || (r.text === text && same(r.sel, s))) return null;
  return r;
}

const same = (a, b) => a.start.line === b.start.line && a.start.col === b.start.col && a.end.line === b.end.line && a.end.col === b.end.col;

const ACTIONS = {
  bold: (t, s) => inline(t, s, "**", "bold"),
  italic: (t, s) => inline(t, s, "_", "italic"),
  code: (t, s) => inline(t, s, "`", "code"),
  link: (t, s) => link(t, s),
  "heading-up": (t, s) => heading(t, s, (l) => (l === 0 ? 1 : Math.max(1, l - 1))),
  "heading-down": (t, s) => heading(t, s, (l) => (l === 0 ? 0 : l === 6 ? 0 : l + 1)),
  bullets: (t, s) => bullets(t, s),
  numbers: (t, s) => numbers(t, s),
  task: (t, s) => task(t, s),
  tick: (t, s) => tick(t, s),
  quote: (t, s) => quote(t, s),
  fence: (t, s) => fence(t, s),
  rule: (t, s) => rule(t, s),
};

// ---- inline marks

/** The code spans of a line, as [from, to) ranges including their backticks. */
function codeSpans(line) {
  const out = [];
  const re = /(`+)([\s\S]*?[^`])\1(?!`)/g;
  let m;
  while ((m = re.exec(line))) out.push([m.index, m.index + m[0].length]);
  return out;
}

/** Spans of a mark on one line: [{ from, to, open, close }] (from/to include the marks;
 *  open/close: the marks' lengths). `kind`: bold, italic or code. */
export function spans(line, kind) {
  if (kind === "code") return codeSpans(line).map(([from, to]) => {
    const n = /^`+/.exec(line.slice(from))[0].length;
    return { from, to, open: n, close: n };
  });
  // Outside code: the code spans' text masked so marks inside them don't count.
  let masked = line;
  for (const [a, b] of codeSpans(line)) masked = masked.slice(0, a) + " ".repeat(b - a) + masked.slice(b);
  const out = [];
  let m;
  if (kind === "bold") {
    const re = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g;
    while ((m = re.exec(masked))) out.push({ from: m.index, to: m.index + m[0].length, open: 2, close: 2 });
  } else {
    // One * or _, not one of a pair; _ not inside a word (snake_case isn't italic).
    for (const e of ["\\*", "_"]) {
      const word = e === "_" ? ["(?<![\\p{L}\\p{N}])", "(?![\\p{L}\\p{N}])"] : ["", ""];
      const re = new RegExp(`${word[0]}(?<!${e}|\\\\)${e}(?![\\s${e}])((?:[^${e}]|${e}${e}[^${e}]+${e}${e})*?)(?<![\\s${e}\\\\])${e}(?!${e})${word[1]}`, "gu");
      while ((m = re.exec(masked))) out.push({ from: m.index, to: m.index + m[0].length, open: 1, close: 1 });
    }
  }
  // Bold and italic at once (***x***): italic sees the inner ones.
  if (kind === "italic") {
    const tri = /(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g;
    while ((m = tri.exec(masked))) if (!out.some((s) => s.from <= m.index && s.to >= m.index + m[0].length)) out.push({ from: m.index + 2, to: m.index + m[0].length - 2, open: 1, close: 1 });
  }
  return out.sort((a, b) => a.from - b.from);
}

const WORD = /[\p{L}\p{N}_'-]/u;

/** The word around column `col` of `line`: [from, to), or null between words. */
function wordAt(line, col) {
  let a = col, b = col;
  while (a > 0 && WORD.test(line[a - 1]) && line[a - 1] !== "_") a--;
  while (b < line.length && WORD.test(line[b]) && line[b] !== "_") b++;
  return a < b ? [a, b] : null;
}

/** Bold, italic or inline code on and off. */
function inline(text, s, mark, kind) {
  const { lines, eol } = split(text);
  if (s.start.line !== s.end.line) {
    // Over lines: each line's part, as one selection each would.
    let sel = s, out = text;
    const all = [];
    for (let l = s.start.line; l <= s.end.line; l++) {
      const line = lines[l];
      const a = l === s.start.line ? s.start.col : 0, b = l === s.end.line ? s.end.col : line.length;
      if (a < b && line.slice(a, b).trim()) all.push([l, a, b]);
    }
    const on = all.length > 0 && all.every(([l, a, b]) => spanCovering(lines[l], kind, a, b));
    for (const [l, a, b] of all.reverse()) {
      const r = inlineLine(lines[l], a, b, mark, kind, on);
      lines[l] = r.line;
      if (l === s.end.line) sel = { start: sel.start, end: pos(l, r.b) };
      if (l === s.start.line) sel = { start: pos(l, r.a), end: sel.end };
    }
    out = lines.join(eol);
    return { text: out, sel };
  }
  const l = s.start.line, line = lines[l];
  let a = s.start.col, b = s.end.col;
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
function spanCovering(line, kind, a, b) {
  // Each end inside the marked text, or right at the span's outer edge (the marks selected too).
  return spans(line, kind).find((sp) => {
    const inner = [sp.from + sp.open, sp.to - sp.close];
    const okA = a === sp.from || (inner[0] <= a && a <= inner[1]);
    const okB = b === sp.to || (inner[0] <= b && b <= inner[1]);
    return okA && okB;
  }) ?? null;
}

const unwrap = (line, sp) => line.slice(0, sp.from) + line.slice(sp.from + sp.open, sp.to - sp.close) + line.slice(sp.to);

/** One line's [a, b): marked (on false) or unmarked (on true); -> the line and where [a, b) went. */
function inlineLine(line, a, b, mark, kind, on) {
  if (on) {
    const sp = spanCovering(line, kind, a, b);
    if (!sp) return { line, a, b };
    const na = a <= sp.from + sp.open ? sp.from : a - sp.open;
    const nb = b >= sp.to - sp.close ? sp.to - sp.open - sp.close : b - sp.open;
    return { line: unwrap(line, sp), a: na, b: nb };
  }
  // Spaces at the ends stay outside the marks (`** x**` isn't bold).
  while (a < b && /\s/.test(line[a])) a++;
  while (b > a && /\s/.test(line[b - 1])) b--;
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

const LINK = /(!?)\[((?:[^\[\]]|\[[^\]]*\])*)\]\(([^()\s]*(?:\([^()]*\))?[^()\s]*)(?:\s+"[^"]*")?\)/g;

/** The links of a line: [{ from, to, text: [from, to), url: [from, to) }]. */
export function links(line) {
  const out = [];
  let m;
  LINK.lastIndex = 0;
  while ((m = LINK.exec(line))) {
    if (m[1]) continue; // an image
    const t0 = m.index + 1, t1 = t0 + m[2].length, u0 = t1 + 2;
    out.push({ from: m.index, to: m.index + m[0].length, text: [t0, t1], url: [u0, u0 + m[3].length] });
  }
  return out;
}

function link(text, s) {
  const { lines, eol } = split(text);
  if (s.start.line !== s.end.line) return null;
  const l = s.start.line, line = lines[l];
  let a = s.start.col, b = s.end.col;
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
function lineRange(s) {
  const last = s.end.line > s.start.line && s.end.col === 0 ? s.end.line - 1 : s.end.line;
  return [s.start.line, last];
}

/** Applies per-line changes ({ at, del, ins } at column `at`: delete `del`, insert `ins`) and moves the selection with them. */
function edits(text, s, change) {
  const { lines, eol } = split(text);
  const [from, to] = lineRange(s);
  const done = new Map();
  for (let l = from; l <= to; l++) {
    const c = change(lines[l], l, lines);
    if (!c) continue;
    lines[l] = lines[l].slice(0, c.at) + c.ins + lines[l].slice(c.at + c.del);
    done.set(l, c);
  }
  if (!done.size) return null;
  const move = (p) => {
    const c = done.get(p.line);
    if (!c || p.col < c.at) return p;
    if (p.col < c.at + c.del) return pos(p.line, c.at + c.ins.length);
    return pos(p.line, p.col - c.del + c.ins.length);
  };
  return { text: lines.join(eol), sel: { start: move(s.start), end: move(s.end) } };
}

/** A line's heading level (0: none; setext's are 1 and 2 by the line under them). */
export function headingLevel(lines, l) {
  const h = HEADING.exec(lines[l] ?? "");
  if (h) return h[2].length;
  const next = lines[l + 1];
  if (next != null && (lines[l] ?? "").trim() && SETEXT.test(next) && !ITEM.test(lines[l]) && !QUOTE.test(lines[l]) && !FENCE.test(lines[l])) return next.trim()[0] === "=" ? 1 : 2;
  return 0;
}

function heading(text, s, step) {
  return setLevels(text, s, (l, lines) => step(headingLevel(lines, l)));
}

function headingTo(text, s, n) {
  return setLevels(text, s, () => n);
}

/** Every selected line (with text) to the level `want(line, lines)` gives; setext headings become ATX (their underline goes). */
function setLevels(text, s, want) {
  const { lines, eol } = split(text);
  const [from, to] = lineRange(s);
  let sel = s;
  const drop = [];
  let changed = false;
  for (let l = from; l <= to; l++) {
    const line = lines[l];
    if (!line.trim() && from !== to) continue;
    const was = headingLevel(lines, l);
    const n = want(l, lines);
    const h = HEADING.exec(line);
    const setext = !h && was > 0;
    if (n === was) continue;
    // The heading's own text, its indent kept, closing #s dropped.
    const indent = h ? h[1] : /^\s*/.exec(line)[0];
    const startOld = h ? h[0].length : indent.length;
    const body = (h ? line.slice(startOld).replace(/[ \t]+#+[ \t]*$/, "") : line.slice(startOld));
    const prefix = n ? `${indent}${"#".repeat(n)} ` : indent;
    lines[l] = prefix + body;
    if (setext) drop.push(l + 1);
    changed = true;
    const move = (p) => (p.line !== l ? p : pos(l, Math.max(prefix.length, Math.min(prefix.length + body.length, p.col - startOld + prefix.length))));
    sel = { start: move(sel.start), end: move(sel.end) };
  }
  if (!changed) return null;
  for (const l of drop.reverse()) {
    lines.splice(l, 1);
    const up = (p) => (p.line > l ? pos(p.line - 1, p.col) : p.line === l ? pos(l - 1, lines[l - 1].length) : p);
    sel = { start: up(sel.start), end: up(sel.end) };
  }
  return { text: lines.join(eol), sel };
}

/** The lines with text among the selected ones. */
function texted(text, s) {
  const { lines } = split(text);
  const [from, to] = lineRange(s);
  const out = [];
  for (let l = from; l <= to; l++) if (lines[l].trim() || from === to) out.push(l);
  return { lines, out };
}

function bullets(text, s) {
  const { lines, out } = texted(text, s);
  const all = out.every((l) => BULLET.test(lines[l]));
  return edits(text, s, (line, l) => {
    if (!out.includes(l)) return null;
    if (all) { const m = BULLET.exec(line); return { at: m[1].length, del: m[0].length - m[1].length, ins: "" }; }
    const t = TASK.exec(line);
    if (t) return { at: t[1].length, del: t[0].length - t[1].length, ins: "- " };
    const o = ORDERED.exec(line);
    if (o) return { at: o[1].length, del: o[0].length - o[1].length, ins: "- " };
    if (BULLET.test(line)) return null;
    const q = /^\s*/.exec(line)[0].length;
    return { at: q, del: 0, ins: "- " };
  });
}

function numbers(text, s) {
  const { lines, out } = texted(text, s);
  const all = out.every((l) => ORDERED.test(lines[l]));
  // Numbering goes on from an item just above at the same indent.
  const prev = ORDERED.exec(lines[out[0] - 1] ?? "");
  let n = prev ? Number(prev[2]) + 1 : 1;
  return edits(text, s, (line, l) => {
    if (!out.includes(l)) return null;
    if (all) { const m = ORDERED.exec(line); return { at: m[1].length, del: m[0].length - m[1].length, ins: "" }; }
    const mark = `${n++}. `;
    const t = TASK.exec(line);
    if (t) return { at: t[1].length, del: t[2].length + t[3].length, ins: mark.trimEnd() + " " };
    const b = BULLET.exec(line) ?? ORDERED.exec(line);
    if (b) return { at: b[1].length, del: b[0].length - b[1].length, ins: mark };
    const q = /^\s*/.exec(line)[0].length;
    return { at: q, del: 0, ins: mark };
  });
}

function task(text, s) {
  const { lines, out } = texted(text, s);
  const all = out.every((l) => TASK.test(lines[l]));
  return edits(text, s, (line, l) => {
    if (!out.includes(l)) return null;
    const t = TASK.exec(line);
    if (all) { const at = t[1].length + t[2].length + t[3].length; return { at, del: 3 + (t[5] ? 1 : 0), ins: "" }; }
    if (t) return null;
    const i = ITEM.exec(line);
    if (i) { const at = i[1].length + i[2].length; return { at, del: i[3].length, ins: " [ ] " }; }
    const q = /^\s*/.exec(line)[0].length;
    return { at: q, del: 0, ins: "- [ ] " };
  });
}

function tick(text, s) {
  const { lines, out } = texted(text, s);
  const tasks = out.filter((l) => TASK.test(lines[l]));
  if (!tasks.length) return null;
  const check = tasks.some((l) => TASK.exec(lines[l])[4] === " ");
  return edits(text, s, (line, l) => {
    if (!tasks.includes(l)) return null;
    const t = TASK.exec(line);
    const at = t[1].length + t[2].length + t[3].length + 1;
    return { at, del: 1, ins: check ? "x" : " " };
  });
}

/** The edit that ticks or unticks the task on one line (a click on its box): -> { text, sel } or null. */
export function tickLine(text, line) {
  return tick(String(text), caret(pos(line, 0)));
}

function quote(text, s) {
  const { lines } = split(text);
  const [from, to] = lineRange(s);
  const own = [];
  for (let l = from; l <= to; l++) own.push(l);
  const withText = own.filter((l) => lines[l].trim());
  const all = withText.length > 0 && withText.every((l) => QUOTE.test(lines[l]));
  return edits(text, s, (line, l) => {
    if (all) { const m = QUOTE.exec(line); return m ? { at: m[1].length, del: 1 + m[2].length, ins: "" } : null; }
    if (!line.trim()) return from === to ? { at: 0, del: line.length, ins: "> " } : { at: 0, del: line.length, ins: ">" };
    return { at: 0, del: 0, ins: "> " };
  });
}

/** The fenced block holding line `l`: { open, close } line numbers, or null. */
export function fenceAround(lines, l) {
  let open = null, mark = null;
  for (let i = 0; i < lines.length; i++) {
    const f = FENCE.exec(lines[i]);
    if (open == null) {
      if (f) { open = i; mark = f[1]; }
    } else if (f && f[1][0] === mark[0] && f[1].length >= mark.length && !lines[i].slice(f[0].length).trim()) {
      if (open <= l && l <= i) return { open, close: i };
      open = null; mark = null;
    }
    if (i > l && open == null) return null;
  }
  return null;
}

function fence(text, s) {
  const { lines, eol } = split(text);
  const [from, to] = lineRange(s);
  const around = fenceAround(lines, from);
  if (around && around.close >= to) {
    // In a code block: its fences go.
    lines.splice(around.close, 1);
    lines.splice(around.open, 1);
    const move = (p) => {
      if (p.line === around.open) return pos(p.line, 0);
      if (p.line === around.close) return pos(around.close - 2, lines[around.close - 2]?.length ?? 0);
      return pos(p.line - (p.line > around.close ? 2 : p.line > around.open ? 1 : 0), p.col);
    };
    return { text: lines.join(eol), sel: { start: move(s.start), end: move(s.end) } };
  }
  const longest = Math.max(2, ...lines.slice(from, to + 1).map((l) => /^\s*(`+)/.exec(l)?.[1].length ?? 0));
  const mark = "`".repeat(longest + 1);
  if (from === to && !lines[from].trim()) {
    lines.splice(from, 1, mark, "", mark);
    return { text: lines.join(eol), sel: caret(pos(from + 1, 0)) };
  }
  lines.splice(to + 1, 0, mark);
  lines.splice(from, 0, mark);
  const move = (p) => pos(p.line + 1, p.col);
  return { text: lines.join(eol), sel: { start: move(s.start), end: move(s.end) } };
}

function rule(text, s) {
  const { lines, eol } = split(text);
  const l = s.end.line;
  if (!lines[l].trim()) {
    // An empty line becomes the rule; a line follows it to type on.
    const needBlankAbove = l > 0 && lines[l - 1].trim() ? [""] : [];
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
export function enter(text, s) {
  if (s.start.line !== s.end.line || s.start.col !== s.end.col) return null;
  const { lines, eol } = split(text);
  const l = s.start.line, line = lines[l], col = s.start.col;
  if (fenceAround(lines, l)) return null;
  const t = TASK.exec(line), i = ITEM.exec(line), q = QUOTE.exec(line);
  let marker = null, head = 0;
  if (t) { head = t[0].length; marker = t[1] + (/^\d/.test(t[2]) ? `${Number(t[2].slice(0, -1)) + 1}${t[2].slice(-1)}` : t[2]) + t[3] + "[ ] "; }
  else if (i) { head = i[0].length; marker = i[1] + (/^\d/.test(i[2]) ? `${Number(i[2].slice(0, -1)) + 1}${i[2].slice(-1)}` : i[2]) + (i[3] || " "); }
  else if (q) { head = q[0].length; marker = q[1] + ">" + (q[2] || " "); }
  if (marker == null || col < head) return null;
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
export function active(text, sel) {
  const s = ordered(sel);
  const { lines } = split(text);
  const on = new Set();
  const l = s.start.line, line = lines[l] ?? "";
  if (s.start.line === s.end.line) {
    for (const kind of ["bold", "italic", "code"]) if (spanCovering(line, kind, s.start.col, s.end.col)) on.add(kind);
    if (links(line).some((k) => k.from < s.start.col && s.end.col < k.to)) on.add("link");
  }
  const lv = headingLevel(lines, l);
  if (lv) on.add(`heading-${lv}`);
  if (TASK.test(line)) { on.add("task"); if (TASK.exec(line)[4] !== " ") on.add("tick"); }
  else if (BULLET.test(line)) on.add("bullets");
  else if (ORDERED.test(line)) on.add("numbers");
  if (QUOTE.test(line)) on.add("quote");
  if (fenceAround(lines, l)) on.add("fence");
  return on;
}
