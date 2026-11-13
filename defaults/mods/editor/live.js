// The rendered view's model (main.js "rendered"): a Markdown text cut into
// units, each a run of source lines drawn as one thing; the unit the caret is
// in is edited as its own Markdown (a second code editor holding just those
// lines), the rest stay drawn. The file's own editor keeps the whole text, so
// what isn't edited stays byte for byte.
//
// A unit: { kind, from, to } (0-based lines, `to` included) and per kind:
//   heading  { level }               an ATX line, or setext's two
//   para                             lines of text (HTML, images, anything else)
//   item     { indent, marker, task, checked, number }  one list item and its continuation
//   quote    { callout }              > lines (callout: [!NOTE] and the like)
//   fence    { lang }                 ``` or ~~~ block (math: $$ … $$, lang "math")
//   table                            | lines under a header and its |---| row
//   rule                             --- *** ___
//   ref                              [x]: url and [^note]: text definitions
//   front                            front matter (--- yaml --- at the top)
//   image    { images: [{ alt, src }] }  a line holding only images (![alt](src),
//                                    <img src>), drawn as the pictures
// Blank lines between units belong to none; a caret on one gets a one-line
// "blank" unit of its own (unitFor), so there's always somewhere to type.

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const MATH = /^ {0,3}\$\$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]|$)/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(?:(\s+)|$)/;
const TASK = /^(\s*)([-*+]|\d{1,9}[.)])\s+\[([ xX])\](?:\s|$)/;
const QUOTE = /^ {0,3}>/;
const CALLOUT = /^ {0,3}>\s?\[!([A-Za-z-]+)\]/;
const REF = /^ {0,3}\[[^\]]+\]:/;
// The same image line as markdown.js's imageLine (a module this one can't import: it draws).
const MD_IMAGE = /\[?!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*["')])?\s*\)(?:\]\([^)]*\))?/g;
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const TABLE_RULE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

const blank = (l) => l == null || !l.trim();
const width = (s) => s.replace(/\t/g, "    ").length;

/** The text's lines (a CRLF file's \r dropped: `eol` puts it back). */
export function lines(text) {
  const t = String(text ?? "");
  return { lines: t.split("\n").map((l) => l.replace(/\r$/, "")), eol: /\r\n/.test(t) ? "\r\n" : "\n" };
}

/** The images a line holds when it holds nothing else, or null. */
export function imageLine(line) {
  if (!line || !/!\[|<img\b/i.test(line)) return null;
  const images = [];
  let rest = line.replace(MD_IMAGE, (_m, alt, src) => { images.push({ alt, src }); return ""; });
  rest = rest.replace(HTML_IMAGE, (m, src) => {
    const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(m)?.[1] ?? "";
    images.push({ alt, src });
    return "";
  });
  rest = rest.replace(/<\/?(p|div|a|picture|source|br|center)\b[^>]*>/gi, "");
  return images.length && !rest.trim() ? images : null;
}

/** Whether a line starts something of its own (ends a paragraph or an item's lazy text). */
function starts(line) {
  return HEADING.test(line) || FENCE.test(line) || MATH.test(line) || QUOTE.test(line) || ITEM.test(line) || RULE.test(line) || REF.test(line) || Boolean(imageLine(line));
}

/** The text's units, in order, not overlapping. */
export function units(text) {
  const { lines: ls } = lines(text);
  const out = [];
  let i = 0;
  // Front matter.
  if (/^---\s*$/.test(ls[0] ?? "")) {
    const end = ls.findIndex((l, j) => j > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end > 0) { out.push({ kind: "front", from: 0, to: end }); i = end + 1; }
  }
  while (i < ls.length) {
    const line = ls[i];
    if (blank(line)) { i++; continue; }
    const f = FENCE.exec(line);
    if (f) {
      const mark = f[1];
      let j = i + 1;
      while (j < ls.length) {
        const g = FENCE.exec(ls[j]);
        if (g && g[1][0] === mark[0] && g[1].length >= mark.length && !g[2].trim()) break;
        j++;
      }
      const to = Math.min(j, ls.length - 1);
      out.push({ kind: "fence", from: i, to, lang: f[2].trim().split(/\s+/)[0] || "" });
      i = to + 1;
      continue;
    }
    if (MATH.test(line) && !/^\s*\$\$.+\$\$\s*$/.test(line)) {
      let j = i + 1;
      while (j < ls.length && !/\$\$\s*$/.test(ls[j])) j++;
      const to = Math.min(j, ls.length - 1);
      out.push({ kind: "fence", from: i, to, lang: "math" });
      i = to + 1;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) { out.push({ kind: "heading", from: i, to: i, level: h[1].length }); i++; continue; }
    if (RULE.test(line)) { out.push({ kind: "rule", from: i, to: i }); i++; continue; }
    if (REF.test(line)) {
      let j = i;
      // A footnote's indented continuation goes with it.
      while (j + 1 < ls.length && /^(\s{2,}|\t)\S/.test(ls[j + 1])) j++;
      out.push({ kind: "ref", from: i, to: j });
      i = j + 1;
      continue;
    }
    if (QUOTE.test(line)) {
      let j = i;
      while (j + 1 < ls.length && QUOTE.test(ls[j + 1])) j++;
      const c = CALLOUT.exec(line);
      out.push({ kind: "quote", from: i, to: j, ...(c ? { callout: c[1].toLowerCase() } : {}) });
      i = j + 1;
      continue;
    }
    const it = ITEM.exec(line);
    if (it) {
      const indent = width(it[1]);
      const content = width(it[0]);
      let j = i;
      // Its continuation: lines indented past its marker, lazy text lines,
      // blank lines followed by more of it.
      for (;;) {
        const next = ls[j + 1];
        if (next == null) break;
        if (blank(next)) {
          let k = j + 1;
          while (k < ls.length && blank(ls[k])) k++;
          if (k < ls.length && width(/^\s*/.exec(ls[k])[0]) >= content && !ITEM.test(ls[k])) { j = k; continue; }
          break;
        }
        if (ITEM.test(next)) break;
        if (width(/^\s*/.exec(next)[0]) >= content) { j++; continue; }
        if (starts(next)) break;
        j++; // lazy continuation
      }
      const t = TASK.exec(line);
      out.push({
        kind: "item", from: i, to: j, indent, marker: it[2],
        ...(/^\d/.test(it[2]) ? { number: Number(it[2].slice(0, -1)) } : {}),
        task: Boolean(t), checked: t ? t[3] !== " " : false,
      });
      i = j + 1;
      continue;
    }
    // A line of images only: a block of its own, drawn as the pictures.
    const img = imageLine(line);
    if (img) { out.push({ kind: "image", from: i, to: i, images: img }); i++; continue; }
    // A table: a | line with its |---| rule under it, and the | lines after.
    if (line.includes("|") && TABLE_RULE.test(ls[i + 1] ?? "") && (ls[i + 1] ?? "").includes("-")) {
      let j = i + 1;
      while (j + 1 < ls.length && !blank(ls[j + 1]) && ls[j + 1].includes("|")) j++;
      out.push({ kind: "table", from: i, to: j });
      i = j + 1;
      continue;
    }
    // A paragraph, up to a blank line or a line that starts something else;
    // a setext underline makes it a heading.
    let j = i;
    let setext = 0;
    while (j + 1 < ls.length && !blank(ls[j + 1])) {
      const next = ls[j + 1];
      if (SETEXT.test(next) && j === i) { setext = next.trim()[0] === "=" ? 1 : 2; j++; break; }
      if (starts(next) && !(SETEXT.test(next))) break;
      if (SETEXT.test(next)) break;
      j++;
    }
    out.push(setext ? { kind: "heading", from: i, to: j, level: setext } : { kind: "para", from: i, to: j });
    i = j + 1;
  }
  return out;
}

/** The unit holding `line` (index), or -1 when it's a blank line between them. */
export function unitAt(list, line) {
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1, u = list[m];
    if (line < u.from) hi = m - 1;
    else if (line > u.to) lo = m + 1;
    else return m;
  }
  return -1;
}

/** The unit to edit at `line`: the one holding it, else a blank line of its own. */
export function unitFor(list, line) {
  const i = unitAt(list, line);
  return i >= 0 ? list[i] : { kind: "blank", from: line, to: line };
}

/** The unit before or after a range (dir -1 / 1), skipping blank lines; null at the ends. */
export function neighbor(list, range, dir) {
  if (dir < 0) {
    for (let i = list.length - 1; i >= 0; i--) if (list[i].to < range.from) return list[i];
  } else {
    for (const u of list) if (u.from > range.to) return u;
  }
  return null;
}

/** The text of lines [from, to] (no line ends but "\n"). */
export function slice(text, range) {
  return lines(text).lines.slice(range.from, range.to + 1).join("\n");
}

/** The whole text with lines [from, to] replaced by `piece` ("\n"-separated);
 *  -> { text, range } (the range the piece now covers). Every other line,
 *  and the file's own line ends, stay as they were. */
export function splice(text, range, piece) {
  const t = String(text ?? "");
  const eol = /\r\n/.test(t) ? "\r\n" : "\n";
  const raw = t.split("\n");
  const add = String(piece).split("\n").map((l) => (eol === "\r\n" ? l + "\r" : l));
  // The last line of a CRLF file has no \r after it.
  const lastWas = range.to >= raw.length - 1;
  if (eol === "\r\n" && lastWas) add[add.length - 1] = add[add.length - 1].replace(/\r$/, "");
  const next = [...raw.slice(0, range.from), ...add, ...raw.slice(range.to + 1)];
  return { text: next.join("\n"), range: { from: range.from, to: range.from + add.length - 1 } };
}

/** Where a range of lines went when the text changed from `a` to `b`: the
 *  changed lines found by their common start and end; a range the change
 *  touches (or meets) grows to hold it, one after it moves. */
export function follow(a, b, range) {
  if (a === b) return range;
  const x = String(a).split("\n"), y = String(b).split("\n");
  let s = 0;
  while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let e = 0;
  while (e < x.length - s && e < y.length - s && x[x.length - 1 - e] === y[y.length - 1 - e]) e++;
  const oldEnd = x.length - e; // old lines [s, oldEnd) became new lines [s, newEnd)
  const newEnd = y.length - e;
  const d = newEnd - oldEnd;
  const last = Math.max(0, y.length - 1);
  // Wholly above the range (an insertion right at its first line counts as in it).
  if (oldEnd <= range.from && s < range.from) return { from: Math.min(range.from + d, last), to: Math.min(range.to + d, last) };
  // Below it: lines after it changed (an insertion right under it counts as in it).
  if (s > range.to + 1 || (s === range.to + 1 && oldEnd > s)) return range;
  const from = Math.min(range.from, s, last);
  return { from, to: Math.min(Math.max(range.to + d, newEnd - 1, from), last) };
}

/** A list item's parts for drawing: the marker's text and the content lines,
 *  the marker's room and the item's indent taken off. */
export function itemParts(text, u) {
  const ls = lines(text).lines.slice(u.from, u.to + 1);
  const first = ls[0] ?? "";
  const t = TASK.exec(first), it = ITEM.exec(first);
  const head = t ? t[0] : it ? it[0] : "";
  const pad = width(head);
  const body = [first.slice(head.length), ...ls.slice(1).map((l) => {
    let n = 0, k = 0;
    while (k < l.length && n < pad && (l[k] === " " || l[k] === "\t")) { n += l[k] === "\t" ? 4 : 1; k++; }
    return l.slice(k);
  })];
  return { marker: it ? it[2] : "-", body: body.join("\n").replace(/\s+$/, "") };
}

/** A quote's lines without their > marks (one level). */
export function quoteBody(text, u) {
  return lines(text).lines.slice(u.from, u.to + 1).map((l) => l.replace(/^ {0,3}>\s?/, "")).join("\n");
}

/** The reference definitions of the text, for a unit drawn alone (so [text][ref] resolves). */
export function refs(text, list) {
  const ls = lines(text).lines;
  return list.filter((u) => u.kind === "ref").map((u) => ls.slice(u.from, u.to + 1).join("\n")).filter((r) => !/^\s*\[\^/.test(r)).join("\n");
}

/** Where up / down go from the caret's unit: -> { unit, line, col } or null.
 *  Up lands on the unit's last line, down on its first, at the same column (or the line's end). */
export function step(text, list, range, dir, col) {
  const u = neighbor(list, range, dir);
  if (!u) return null;
  const ls = lines(text).lines;
  const line = dir < 0 ? u.to : u.from;
  return { unit: u, line, col: Math.min(col, (ls[line] ?? "").length) };
}
