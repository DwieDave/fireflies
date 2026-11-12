// The rendered view of a Markdown tab (main.js view "rendered"): the document
// drawn as its units (live.js), the one the caret is in lit up as its own
// Markdown in a second code editor (the "block editor") that holds just those
// lines. The file's own editor keeps the whole text: every keystroke in the
// block is written into it as one edit of those lines, so saving, undo, the
// unsaved mark and the language server work as in the text view, and what
// isn't edited stays byte for byte. Edits made to the file's editor from
// elsewhere (vim, the Markdown commands, undo, a reload) come back into the
// block (pull).
//
// Keys in the block (blockKey): up / down past its first or last row step
// into the unit before or after (blank lines between are passed over), enter
// on a list item, task or quote starts the next one (mdedit.js enter), undo
// and redo are the file's. With vim, the keys go to vim over the whole text
// (its caret mapped there), and the block follows where vim put the caret.

import { div } from "gpui-kit";
import { h_flex, v_flex, EditorState, Editor } from "gpui-base";
import { units, unitFor, step, slice, splice, follow, itemParts, quoteBody, refs } from "./live.js";
import { enter } from "./mdedit.js";
import { markdown, CALLOUTS, imagesAsLinks, fenced } from "./markdown.js";

const GAP = 10, TIGHT = 3; // between units; between two list items
const PAD_TOP = 18, PAD_BOTTOM = 60;
const ROW = 20; // the block editor's line height at font 13 (measured when drawn)
const OVERDRAW = 1.2;

/** One edit taking `a` to `b`: the span between their common start and end, as editor positions. */
export function editBetween(a, b) {
  if (a === b) return null;
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const pos = (text, o) => { const before = text.slice(0, o).split("\n"); return { line: before.length - 1, col: before[before.length - 1].length }; };
  return { start: pos(a, s), end: pos(a, a.length - e), text: b.slice(s, b.length - e) };
}

/** What a unit is called, at the lit block's corner. */
export function kindWord(u) {
  if (!u) return "";
  if (u.kind === "heading") return `heading ${u.level}`;
  if (u.kind === "item") return u.task ? "task" : /^\d/.test(u.marker) ? "numbered item" : "list item";
  if (u.kind === "fence") return u.lang ? `code · ${u.lang}` : "code";
  if (u.kind === "quote") return u.callout ? `callout · ${u.callout}` : "quote";
  if (u.kind === "para") return "paragraph";
  if (u.kind === "ref") return "reference";
  if (u.kind === "front") return "front matter";
  if (u.kind === "blank") return "new block";
  return u.kind;
}

/** A tab's rendered view. `host`: the pane's hooks { colors, font, zoom(),
 *  dither(color), onKey(e, cx) -> taken (vim, the app's keys, the menu),
 *  link(url, cx), notify(cx) }. The block editor is made here, so this is
 *  built from init or an event (never a render). */
export class Rendered {
  constructor(doc, host) {
    this.doc = doc; // the tab (main.js newDoc): doc.editor, doc.text
    this.host = host;
    this.units = [];
    this.range = { from: 0, to: 0 }; // the lit unit's lines in the file
    this.unit = { kind: "blank", from: 0, to: 0 };
    this.text = null; // the file's text as last seen here
    this.expect = null; // the file's text after our own last push (its change event isn't news)
    this.heights = new Map();
    this.blockH = null; // the block editor's measured content height
    this.scrollY = 0;
    this.viewH = 400;
    this.reveal = true; // keep the lit block in view on the next draw
    this.block = EditorState.new({
      language: "markdown", value: "", font_family: host.font, font_size: 13,
      line_numbers: false, folding: false, soft_wrap: true, syntax: host.colors, selection: host.selection,
    });
    this.block.on("change", (_e, cx) => this.push(cx));
    this.block.on("key", (e, cx) => this.key(e, cx));
  }

  // ---- the text, both ways

  /** The file's text now (its editor's). */
  fileText() { return this.doc.editor.value(); }

  /** Starts on the file's text with the caret where the file's editor has it (switching to this view, a reload). */
  open(cx) {
    this.text = this.fileText();
    this.units = units(this.text);
    const at = this.doc.editor.cursor();
    this.light(unitFor(this.units, at.line), at);
    this.reveal = true;
    cx?.notify?.();
  }

  /** Lights `u` up: its lines into the block editor, the caret at `at` (file coordinates). */
  light(u, at) {
    this.unit = u;
    this.range = { from: u.from, to: u.to };
    const piece = slice(this.text, this.range);
    this.pulling = true;
    if (this.block.value() !== piece) this.block.set_value(piece);
    this.pulling = false;
    const line = Math.max(0, Math.min(this.range.to, at?.line ?? this.range.from)) - this.range.from;
    const lines = piece.split("\n");
    this.block.set_cursor(line, Math.min(at?.col ?? 0, (lines[line] ?? "").length));
    this.blockH = null;
    this.reveal = true;
    // The lit lines aren't drawn as well.
    const kind = u;
    this.recut();
    if (kind.kind === "blank") this.unit = kind;
  }

  /** The block was edited: its lines into the file as one edit. */
  push(cx) {
    if (this.pulling) return;
    const was = this.fileText();
    const r = splice(was, this.range, this.block.value());
    this.range = r.range;
    this.unit = { ...this.unit, from: r.range.from, to: r.range.to };
    const e = editBetween(was, r.text);
    this.text = r.text;
    this.expect = r.text;
    if (e) this.doc.editor.edit([e]);
    this.syncCaret();
    this.recut();
    this.blockH = null;
    this.host.notify(cx);
  }

  /** The file's editor changed (vim, a command, undo, a reload, our own push). */
  pull(cx) {
    const now = this.fileText();
    if (now === this.expect) { this.expect = null; this.text = now; return; }
    this.expect = null;
    const was = this.text ?? now;
    this.range = follow(was, now, this.range);
    this.text = now;
    this.recut();
    const at = this.doc.editor.cursor();
    // The caret left the lit lines: light up the unit it went to.
    if (at.line < this.range.from || at.line > this.range.to) this.light(unitFor(this.units, at.line), at);
    else {
      const piece = slice(now, this.range);
      this.pulling = true;
      if (this.block.value() !== piece) this.block.set_value(piece);
      this.pulling = false;
      this.block.set_cursor(at.line - this.range.from, at.col);
      this.unit = { ...this.unit, from: this.range.from, to: this.range.to };
      this.blockH = null;
    }
    this.reveal = true;
    this.host.notify(cx);
  }

  /** The units again, the lit range kept as one (it may hold blank lines while typed into). */
  recut() {
    const all = units(this.text);
    this.units = all.filter((u) => u.to < this.range.from || u.from > this.range.to);
    // The lit lines' kind as they are now (a command made a paragraph a heading).
    const same = all.find((u) => u.from === this.range.from && u.to === this.range.to);
    this.unit = same ?? { ...this.unit, from: this.range.from, to: this.range.to };
  }

  /** The block's caret and selection, put into the file's editor (before vim, a command, a save). */
  syncCaret() {
    const s = this.block.selection?.();
    const off = this.range.from;
    if (s && (s.start.line !== s.end.line || s.start.col !== s.end.col)) {
      this.doc.editor.set_cursor(s.start.line + off, s.start.col, { line: s.end.line + off, col: s.end.col });
    } else {
      const c = this.block.cursor();
      this.doc.editor.set_cursor(c.line + off, c.col);
    }
  }

  /** The selection in file coordinates. */
  selection() {
    const s = this.block.selection?.() ?? { start: this.block.cursor(), end: this.block.cursor() };
    const off = this.range.from;
    return { start: { line: s.start.line + off, col: s.start.col }, end: { line: s.end.line + off, col: s.end.col } };
  }

  // ---- keys

  /** A key in the block, before the block editor: -> true when taken. */
  key(e, cx) {
    this.syncCaret();
    if (this.host.onKey(e, cx)) return true;
    const k = e.key, m = e.modifiers ?? {};
    const plain = !m.platform && !m.control && !m.alt && !m.shift;
    if (m.platform && !m.alt && !m.control && k === "z") {
      if (m.shift) this.doc.editor.redo(); else this.doc.editor.undo();
      return true;
    }
    if (plain && (k === "up" || k === "down")) return this.edge(k === "up" ? -1 : 1, cx);
    if (plain && k === "enter") {
      const r = enter(slice(this.text, this.range), this.localSel());
      if (!r) return false;
      this.block.set_value(r.text);
      this.block.set_cursor(r.sel.start.line, r.sel.start.col);
      return true;
    }
    return false;
  }

  localSel() {
    const s = this.block.selection?.() ?? { start: this.block.cursor(), end: this.block.cursor() };
    return s;
  }

  /** Up / down: within the block unless the caret is on its first / last row, else into the next unit. */
  edge(dir, cx) {
    const c = this.block.cursor();
    const lines = this.block.value().split("\n");
    const lastLine = lines.length - 1;
    const onEdge = dir < 0 ? c.line === 0 && this.firstRow(c) : c.line === lastLine && this.lastRow(c, lines);
    if (!onEdge) return false;
    return this.stepUnit(dir, c.col, cx);
  }

  /** Into the unit before (-1) or after (1); false at the document's ends. */
  stepUnit(dir, col, cx) {
    const s = step(this.text, this.units, this.range, dir, col);
    if (!s) return false;
    this.text = this.fileText();
    this.units = units(this.text);
    this.light(s.unit, { line: s.line, col: s.col });
    this.syncCaret();
    this.host.notify(cx);
    return true;
  }

  /** Whether the caret is on the first drawn row of the block's first line (a soft-wrapped line has more). */
  firstRow(c) {
    const a = this.block.bounds?.({ line: 0, col: 0 }), b = this.block.bounds?.(c);
    return !a || !b || Math.abs(a.y - b.y) < 2;
  }

  lastRow(c, lines) {
    const last = lines.length - 1;
    const a = this.block.bounds?.({ line: last, col: lines[last].length }), b = this.block.bounds?.(c);
    return !a || !b || Math.abs(a.y - b.y) < 2;
  }

  /** A click on a drawn unit: it lights up, the caret on its first line (`end`: its last). */
  clickUnit(u, cx, end = false) {
    this.text = this.fileText();
    this.units = units(this.text);
    const lines = this.text.split("\n");
    const line = end ? u.to : u.from;
    this.light(u, { line, col: end ? (lines[line] ?? "").replace(/\r$/, "").length : 0 });
    this.syncCaret();
    this.block.focus();
    this.host.notify(cx);
  }

  focus() { this.block.focus(); }
  focused() { return this.block.focused?.() ?? false; }

  // ---- drawing

  /** Every unit's height: measured, else a guess from its lines. */
  height(key, u) {
    const h = this.heights.get(key);
    if (h != null) return h;
    return (u.to - u.from + 1) * 22 + (u.kind === "heading" ? 12 : u.kind === "fence" ? 24 : 4);
  }

  /** The units with the lit one in its place, each with a key and its gap above. */
  rows() {
    const out = [];
    let lit = false, prev = null;
    const seen = new Map();
    const push = (u, isLit) => {
      const base = isLit ? "lit" : `${u.kind}-${u.from}-${u.to}-${hash(slice(this.text, u))}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const gap = !prev ? 0 : prev.kind === "item" && u.kind === "item" ? TIGHT : GAP;
      out.push({ u, lit: isLit, key: n ? `${base}-${n}` : base, gap });
      prev = u;
    };
    for (const u of this.units) {
      if (!lit && u.from > this.range.to) { push(this.unit, true); lit = true; }
      push(u, false);
    }
    if (!lit) push(this.unit, true);
    return out;
  }

  /** The view: `o` { t, focused, empty: { title, detail } (an empty scratchpad), onTask(line, cx), maxWidth, unzoom(px) }. */
  view(o) {
    const { t } = o;
    const rows = this.rows();
    const tops = [];
    let y = PAD_TOP;
    for (const r of rows) { y += r.gap; tops.push(y); y += r.lit ? this.litHeight() : this.height(r.key, r.u); }
    const total = y + PAD_BOTTOM;
    const li = rows.findIndex((r) => r.lit);
    if (this.reveal && li >= 0) {
      // The lit block in view, with room around it.
      const top = tops[li], bottom = top + this.litHeight();
      if (top - 24 < this.scrollY) this.scrollY = Math.max(0, top - 24);
      else if (bottom + 24 > this.scrollY + this.viewH) this.scrollY = Math.max(0, bottom + 24 - this.viewH);
      this.reveal = false;
    }
    this.scrollY = Math.max(0, Math.min(this.scrollY, Math.max(0, total - this.viewH)));
    this.litTop = li >= 0 ? tops[li] - this.scrollY : 0;
    const lo = this.scrollY - this.viewH * OVERDRAW, hi = this.scrollY + this.viewH * (1 + OVERDRAW);
    const shown = rows.map((r, i) => i).filter((i) => rows[i].lit || (tops[i] + (this.height(rows[i].key, rows[i].u)) >= lo && tops[i] <= hi));
    const first = shown.length ? tops[shown[0]] - rows[shown[0]].gap : 0;
    const max = Math.max(1, total - this.viewH), frac = Math.min(1, this.viewH / Math.max(1, total));
    let last = null;
    const kids = [];
    for (const i of shown) {
      const r = rows[i];
      // A gap where unshown rows sit between two shown ones.
      if (last != null && i !== last + 1) kids.push(div().h(tops[i] - r.gap - (tops[last] + (rows[last].lit ? this.litHeight() : this.height(rows[last].key, rows[last].u)))).flex_none());
      kids.push(div().flex_none().h(r.gap));
      kids.push(r.lit ? this.litView(o) : this.unitView(r, o));
      last = i;
    }
    return div().id("editor-rendered").relative().flex_1().min_h(0).min_w(0).overflow_hidden().bg(t.background)
      .on_size_change((size, cx) => { const h = o.unzoom(size.height); if (Math.abs(h - this.viewH) > 1) { this.viewH = h; this.host.notify(cx); } })
      .on_scroll_wheel((e, cx) => { this.scrollY = Math.max(0, Math.min(Math.max(0, total - this.viewH), this.scrollY - o.unzoom(e.delta?.y ?? 0))); this.host.notify(cx); })
      .child(h_flex().absolute().left(0).right(0).top(first - this.scrollY).justify_center()
        .child(v_flex().w_full().max_w(o.maxWidth ?? 760).px(28)
          .when(Boolean(o.empty), (el) => el.child(this.emptyView(o)))
          .children(kids)))
      .when(frac < 1, (el) => el.child(div().absolute().right(1).w(3)
        .top(Math.round((this.scrollY / max) * this.viewH * (1 - frac))).h(Math.max(16, Math.round(this.viewH * frac)))
        .child(this.host.dither(o.focused ? t.accent : t.ansi8))));
  }

  /** The lit block's height: its editor's measured content, else its lines. */
  litHeight() {
    const lines = Math.max(1, this.block.value().split("\n").length);
    const h = this.blockH ?? lines * ROW;
    return Math.min(h, Math.max(ROW * 3, this.viewH - 60)) + 10;
  }

  /** Measures the block editor's content from where it drew its last line. */
  measure(cx) {
    const lines = this.block.value().split("\n");
    const last = lines.length - 1;
    const b = this.block.bounds?.({ line: last, col: lines[last].length });
    if (!b?.view) return;
    const z = this.host.zoom();
    const h = (b.y + b.height - b.view.y) / z + 2;
    if (h > 4 && Math.abs((this.blockH ?? -1) - h) > 1) { this.blockH = h; this.host.notify(cx); }
  }

  litView(o) {
    const { t } = o;
    const h = this.litHeight();
    return div().id("rendered-lit").relative().flex_none().h(h).ml(-12).mr(-12).pl(12).pr(92).py(5)
      .child(div().absolute().inset_0().opacity(0.22).child(this.host.dither(t.ansi0)))
      .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent))
      .child(div().absolute().right(8).top(5).text_size(10.5).text_color(t.dim).child(kindWord(this.unit)))
      .child(div().relative().size_full()
        .on_size_change((_s, cx) => cx.timer.after(0, (cx) => this.measure(cx)))
        .child(Editor.new(this.block).size_full().font_family(this.host.font)));
  }

  emptyView(o) {
    const { t } = o;
    return v_flex().id("rendered-empty").items_center().gap(8).pt(30).pb(22).text_center()
      .child(div().relative().size(44).opacity(0.55).child(this.host.moon?.(t) ?? div()))
      .child(div().text_color(t.foreground).text_size(12).child(o.empty.title))
      .child(div().text_color(t.muted).child(o.empty.detail))
      .child(div().text_color(t.dim).child(o.empty.hint));
  }

  unitView(r, o) {
    const { t } = o;
    const u = r.u, id = `rd-${r.key}`;
    const size = 13;
    const md = (key, text) => markdown(t, key, text, { onLink: (url, cx) => this.host.link(url, cx), size });
    const withRefs = (text) => { const rf = refs(this.text, this.units); return rf ? `${text}\n\n${rf}` : text; };
    let body;
    if (u.kind === "item") {
      const p = itemParts(this.text, u);
      const mark = u.task
        ? div().id(`${id}-box`).relative().size(12).mt(4).flex_none().border(1).border_color(u.checked ? t.accent : t.ansi8)
          .cursor_pointer().hover((s) => s.border_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); o.onTask(u.from, cx); })
          .when(u.checked, (el) => el.child(div().absolute().top(2).left(2).right(2).bottom(2).child(this.host.dither(t.accent))))
        : div().w(18).flex_none().text_color(t.dim).child(/^\d/.test(p.marker) ? p.marker : "•");
      body = h_flex().gap(8).items_start().pl(u.indent * 7)
        .child(mark)
        .child(div().flex_1().min_w(0).when(u.checked, (el) => el.opacity(0.6)).child(md(`${id}-md`, withRefs(imagesAsLinks(p.body)) || " ")));
    } else if (u.kind === "quote" && u.callout) {
      const lines = quoteBody(this.text, u).split("\n");
      const head = /^\[![A-Za-z-]+\][+-]?\s*(.*)$/.exec(lines[0]);
      const [ck, name] = CALLOUTS[u.callout] ?? ["ansi4", u.callout];
      const color = t[ck] ?? t.accent;
      const rest = lines.slice(1).join("\n");
      body = v_flex().relative().pl(14).pr(12).py(8).gap(4)
        .child(div().absolute().inset_0().opacity(0.14).child(this.host.dither(color)))
        .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(color))
        .child(h_flex().relative().gap(8).items_center()
          .child(div().relative().size(8).flex_none().border(1).border_color(color).child(this.host.dither(color)))
          .child(div().text_size(size - 1).text_color(color).child(head?.[1] || name)))
        .when(!!rest.trim(), (el) => el.child(div().relative().child(md(`${id}-md`, withRefs(rest)))));
    } else if (u.kind === "rule") {
      body = div().relative().h(13).flex().items_center().child(div().relative().w_full().h(1).opacity(0.6).child(this.host.dither(t.ansi8)));
    } else if (u.kind === "ref") {
      body = div().text_color(t.dim).font_family(this.host.font).text_size(11.5).child(slice(this.text, u));
    } else if (u.kind === "front") {
      body = md(`${id}-md`, fenced(slice(this.text, { from: u.from + 1, to: u.to - 1 })).replace(/^`+/, (m) => m + "yaml"));
    } else {
      const src = slice(this.text, u);
      body = md(`${id}-md`, u.kind === "fence" ? src : withRefs(imagesAsLinks(src)));
    }
    return div().id(id).relative().flex_none()
      .on_size_change((size, cx) => { const h = o.unzoom(size.height); const was = this.heights.get(r.key); if (was == null || Math.abs(was - h) > 1) { this.heights.set(r.key, h); this.host.notify(cx); } })
      .cursor_text()
      .on_click((e, cx) => this.clickUnit(u, cx, false))
      .child(body);
  }
}

/** A short hash of a string (FNV-1a), for unit keys. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
