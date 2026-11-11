// The picker's decisions, as plain functions (scripts/nocturne-picker.test.ts):
// how a row's matched characters are marked, how grep's lines group by file,
// which row the keys move to, and what the preview shows around a line.

/** `text` cut into `[piece, marked]` by `[start, end]` ranges (any order,
 *  overlapping ones merged). */
export function marks(text, ranges) {
  const r = [...(ranges ?? [])].filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out = [];
  let at = 0;
  for (const [s0, e0] of r) {
    const s = Math.max(s0, at), e = Math.min(e0, text.length);
    if (e <= s) continue;
    if (s > at) out.push([text.slice(at, s), false]);
    const last = out[out.length - 1];
    if (last?.[1] && s === at) last[0] += text.slice(s, e);
    else out.push([text.slice(s, e), true]);
    at = e;
  }
  if (at < text.length) out.push([text.slice(at), false]);
  return out;
}

/** A path's file name and folder ("src/a/b.rs" → ["b.rs", "src/a"]), and
 *  where the name starts in it. */
export function split(path) {
  const i = path.lastIndexOf("/");
  return { name: path.slice(i + 1), dir: i > 0 ? path.slice(0, i) : "", at: i + 1 };
}

/** Ranges in a path moved onto its file name (dropping those in the folder). */
export function nameRanges(path, ranges) {
  const { at } = split(path);
  return (ranges ?? []).filter(([, e]) => e > at).map(([s, e]) => [Math.max(0, s - at), e - at]);
}

/** Ranges in a path that fall in its folder. */
export function dirRanges(path, ranges) {
  const { at } = split(path);
  return (ranges ?? []).filter(([s]) => s < at - 1).map(([s, e]) => [s, Math.min(e, at - 1)]);
}

/** Grep's matches as rows: a head per file (its count) and its lines, files
 *  in the order their first match came. Every row knows its match's index. */
export function grepRows(matches) {
  const files = new Map();
  for (const m of matches ?? []) {
    if (!files.has(m.path)) files.set(m.path, []);
    files.get(m.path).push(m);
  }
  const rows = [];
  for (const [path, list] of files) {
    rows.push({ head: true, path, count: list.length });
    for (const m of list) rows.push({ head: false, path, match: m });
  }
  return rows;
}

/** The next pickable row from `at` going `d` (1 / -1), skipping heads,
 *  stopping at the ends; -1 when there's none. */
export function move(rows, at, d) {
  const pick = (i) => i >= 0 && i < rows.length && !rows[i].head;
  let i = at;
  for (let n = 0; n < rows.length; n++) {
    const next = i + d;
    if (next < 0 || next >= rows.length) return pick(at) ? at : first(rows);
    i = next;
    if (pick(i)) return i;
  }
  return first(rows);
}

/** The first pickable row, or -1. */
export function first(rows) {
  return rows.findIndex((r) => !r.head);
}

/** The lines of `text` to show around one-based `line`: `{ from, lines }`
 *  (from one-based), about `around` lines on each side, more below near the top. */
export function around(text, line, count = 24) {
  const all = String(text ?? "").split("\n");
  const want = Math.max(1, line || 1);
  let from = Math.max(1, want - Math.floor(count / 3));
  const to = Math.min(all.length, from + count - 1);
  from = Math.max(1, Math.min(from, to - count + 1));
  return { from, lines: all.slice(from - 1, to) };
}

// The same moonfly colors as the editor's (nocturne-editor/logic.js): mods
// don't share modules, so the table is copied.

/** The moonfly roles (moonfly.vim's groups) a capture name colors with, from
 *  the theme's palette: `{ keyword: "#cf87e8", ... }` for EditorState's
 *  `syntax` and the hover's code. */
export function syntaxColors(t) {
  return {
    keyword: t.ansi5, "keyword.operator": t.ansi9, conditional: t.ansi5, repeat: t.ansi5, include: t.ansi5,
    function: t.ansi12, "function.builtin": t.ansi4, "function.macro": t.ansi13, constructor: t.ansi10,
    type: t.ansi10, "type.builtin": t.ansi10, tag: t.ansi10, attribute: t.ansi13, namespace: t.ansi6, module: t.ansi6,
    string: t.ansi11, "string.escape": t.ansi9, "string.special": t.ansi3, "string.regex": t.ansi3, character: t.ansi11, escape: t.ansi9,
    number: t.ansi3, float: t.ansi3, boolean: t.ansi3, constant: t.ansi3, "constant.builtin": t.ansi3,
    comment: t.ansi8, "comment.documentation": t.ansi8,
    property: t.ansi6, field: t.ansi6, label: t.ansi3, operator: t.ansi9,
    "variable.builtin": t.ansi4, "variable.parameter": t.foreground, embedded: t.foreground,
    "text.title": t.ansi4, "text.literal": t.ansi11, "text.uri": t.ansi6, "text.reference": t.ansi12, "text.emphasis": t.ansi5, "text.strong": t.ansi5,
    "punctuation.special": t.ansi9,
  };
}

/** The color for a capture name: its own, else its root's, else none. */
export function colorOf(colors, name) {
  if (colors[name]) return colors[name];
  const parts = name.split(".");
  for (let i = parts.length - 1; i > 0; i--) {
    const c = colors[parts.slice(0, i).join(".")];
    if (c) return c;
  }
  return null;
}

/** `text` cut into `[piece, color|null]` by highlight spans `[start, end, name]`. */
export function colorRuns(text, spans, colors) {
  const out = [];
  let at = 0;
  for (const [s, e, name] of spans ?? []) {
    if (s > at) out.push([text.slice(at, s), null]);
    if (e > s) out.push([text.slice(s, e), colorOf(colors, name)]);
    at = Math.max(at, e);
  }
  if (at < text.length) out.push([text.slice(at), null]);
  return out;
}
