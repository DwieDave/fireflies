// Markdown in Nocturne's look: the GitHub window's PR bodies and comments,
// the Markdown viewer, and the editor's live preview. Shared by
// nocturne-github, nocturne-markdown and nocturne-editor. A mod can import
// only its own files, so each of them ships this same file;
// scripts/nocturne-markdown.test.ts fails when the copies differ: edit
// nocturne-markdown/markdown.js and copy it over.
//
// What the app draws natively inside every Markdown text (src/markdown.rs):
// math ($…$, $$…$$, a ```math fence), mermaid diagrams (a ```mermaid fence),
// code fences in tree-sitter colors. What this file adds around it: a document
// cut into blocks that know their source lines (so a preview can follow an
// editor), task lists you can tick, callouts (> [!NOTE], !!! note),
// footnotes, local images, front matter.

import { div, image } from "gpui-kit";
import { TextView, h_flex, v_flex } from "gpui-base";
import { exec, appHome } from "herdr";

/** Rendered Markdown in the theme's text, selectable. `onLink(url, cx)`
 *  takes link clicks (without it, web links open as the app opens them). */
export function markdown(t, id, text, { onLink, size = 12.5 } = {}) {
  let view = TextView.markdown(id, text).selectable(true);
  if (onLink) view = view.on_link_click(onLink);
  return div().text_size(size).text_color(t.foreground).child(view);
}

/** The text as one code block, for a raw view: a fence longer than any inside it. */
export function fenced(text) {
  const longest = Math.max(2, ...[...String(text).matchAll(/`{3,}/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}

/** A heading's anchor, as GitHub makes it: lowercase, links and marks gone,
 *  punctuation dropped (letters, digits, `-` and `_` stay), spaces to `-`. */
export function slug(heading) {
  return String(heading)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
    .replace(/ /g, "-");
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const REF = /^ {0,3}\[(?!\^)[^\]]+\]:[ \t]*\S/;
const FOOTNOTE = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]?(.*)$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)/;
const TASK = /^(\s*)([-*+]|\d{1,9}[.)])\s+\[([ xX])\](?=\s|$)\s?(.*)$/;
const CALLOUT = /^ {0,3}>\s?\[!([A-Za-z-]+)\]([+-]?)[ \t]*(.*)$/;
const ADMONITION = /^(!!!|\?\?\?\+?)[ \t]+([A-Za-z-]+)(?:[ \t]+"([^"]*)")?[ \t]*$/;
const MATH_FENCE = /^ {0,3}\$\$/;
// A line holding only images: ![alt](src "title"), optionally wrapped in a link, or <img src>.
const MD_IMAGE = /\[?!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*["')])?\s*\)(?:\]\([^)]*\))?/g;
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

/** Whether an image source is a file next to the document (not http, data: or another scheme). */
export function isLocalSource(src) {
  return !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("//");
}

/** The images a line holds, when it holds nothing else (HTML wrappers aside). */
export function imageLine(line) {
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

/** Local images inside running text (TextView can't draw them) as links to the file. */
export function imagesAsLinks(line) {
  return line.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(\s+["'(][^)]*["')])?\s*\)/g,
    (m, alt, src) => (isLocalSource(src) ? `[▧ ${alt || src.split("/").pop()}](${src})` : m));
}

const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sup = (n) => String(n).split("").map((d) => SUP[+d]).join("");

/** Footnote references `[^id]` as superscript links to their note, outside
 *  code spans; `number(id)` numbers them in the order they're first seen. */
export function footnoteRefs(line, number) {
  return line.split(/(`+[^`]*`+)/).map((piece, i) => (i % 2 ? piece
    : piece.replace(/\[\^([^\]\s]+)\](?!:)/g, (_m, id) => `[${sup(number(id))}](#fn-${slug(id)})`))).join("");
}

/** Callout colors and names: GitHub's five and Obsidian's / MkDocs' others. */
export const CALLOUTS = {
  note: ["ansi4", "Note"], info: ["ansi4", "Info"], todo: ["ansi4", "Todo"],
  tip: ["ansi2", "Tip"], hint: ["ansi2", "Hint"], success: ["ansi2", "Success"], check: ["ansi2", "Check"], done: ["ansi2", "Done"],
  important: ["ansi5", "Important"], example: ["ansi13", "Example"],
  warning: ["ansi3", "Warning"], attention: ["ansi3", "Attention"],
  caution: ["ansi1", "Caution"], danger: ["ansi1", "Danger"], error: ["ansi1", "Error"], bug: ["ansi1", "Bug"], failure: ["ansi1", "Failure"], fail: ["ansi1", "Fail"],
  question: ["ansi6", "Question"], help: ["ansi6", "Help"], faq: ["ansi6", "FAQ"],
  abstract: ["ansi6", "Abstract"], summary: ["ansi6", "Summary"], tldr: ["ansi6", "TL;DR"],
  quote: ["ansi8", "Quote"], cite: ["ansi8", "Cite"],
};

/** A short, stable hash of a string (FNV-1a), for block keys. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** The items of a list holding tasks: each item's first line, indent,
 *  marker, checked (null: not a task), and its text (continuations joined). */
function taskItems(lines, from) {
  const items = [];
  lines.forEach((line, i) => {
    const task = TASK.exec(line), list = LIST.exec(line);
    if (task) items.push({ line: from + i, indent: task[1].replace(/\t/g, "    ").length, marker: task[2], checked: task[3] !== " ", text: task[4] });
    else if (list) items.push({ line: from + i, indent: list[1].replace(/\t/g, "    ").length, marker: list[2], checked: null, text: line.slice(list[0].length) });
    else if (items.length) items[items.length - 1].text += "\n" + line.trim();
  });
  return items;
}

/** A document cut into blocks drawn one by one, each knowing its source lines
 *  (`from`..`to`, 0-based) and a stable `key` (its kind and text):
 *  { kind: "md", text, anchor? }      Markdown (every heading starts one)
 *  { kind: "images", images }         a line of local images (TextView fetches only web ones)
 *  { kind: "tasks", items }           a list holding task items, tickable
 *  { kind: "callout", type, title, text, color }   > [!NOTE] and !!! note
 *  { kind: "footnotes", notes }       the footnotes, gathered at the end
 *  Reference definitions are copied into every Markdown block so `[text][ref]`
 *  still resolves; footnote references become superscript links. A block also
 *  lists the footnotes referenced in it (`anchors`: fnref-…) for the way back. */
export function blocks(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  // First pass: reference and footnote definitions (outside fences).
  const refs = [], notes = new Map(), noteLines = new Set();
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], f = FENCE.exec(line);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null; continue; }
    if (f) { fence = f[1]; continue; }
    if (REF.test(line)) refs.push(line);
    const fn = FOOTNOTE.exec(line);
    if (fn) {
      const body = [fn[2]];
      noteLines.add(i);
      let j = i + 1;
      // Its continuation: indented lines, blank lines between them.
      while (j < lines.length && (/^(\s{2,}|\t)\S/.test(lines[j]) || (!lines[j].trim() && /^(\s{2,}|\t)\S/.test(lines[j + 1] ?? "")))) { body.push(lines[j].trim()); noteLines.add(j); j++; }
      if (!notes.has(fn[1])) notes.set(fn[1], { id: fn[1], text: body.join("\n"), from: i, to: j - 1 });
      i = j - 1;
    }
  }
  const numbers = new Map();
  const number = (id) => { if (!numbers.has(id)) numbers.set(id, numbers.size + 1); return numbers.get(id); };

  const out = [], seen = new Map();
  let run = null;
  const flush = () => {
    if (run && run.lines.some((l) => l.trim())) {
      // Trailing blank lines aren't the block's.
      while (!run.lines[run.lines.length - 1].trim()) run.lines.pop();
      out.push(classify(run, refs, number));
    }
    run = null;
  };
  const push = (i, line) => { (run ??= { from: i, lines: [] }).lines.push(line); };
  fence = null;
  let math = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Front matter: a YAML block at the very top, shown as such.
    if (i === 0 && /^---\s*$/.test(line)) {
      const end = lines.findIndex((l, j) => j > 0 && /^(---|\.\.\.)\s*$/.test(l));
      if (end > 0) { out.push({ kind: "md", text: fenced(lines.slice(1, end).join("\n")).replace(/^`+/, (m) => m + "yaml"), from: 0, to: end }); i = end; continue; }
    }
    if (noteLines.has(i)) { flush(); continue; }
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null;
      push(i, line);
      continue;
    }
    if (math) { if (/\$\$\s*$/.test(line)) math = false; push(i, line); continue; }
    if (f) { if (!run || !run.lines.some((l) => l.trim())) { flush(); } fence = f[1]; push(i, line); continue; }
    if (MATH_FENCE.test(line) && !/^\s*\$\$.+\$\$\s*$/.test(line)) { math = true; push(i, line); continue; }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      const base = slug(h[2] ?? "");
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      run = { from: i, lines: [line], anchor: n ? `${base}-${n}` : base };
      flush();
      continue;
    }
    // A setext heading: one line of text, then === or ---.
    if (SETEXT.test(line) && run && run.lines.length === 1 && run.lines[0].trim() && !LIST.test(run.lines[0]) && !/^\s*>/.test(run.lines[0])) {
      const base = slug(run.lines[0].trim());
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      run.lines.push(line);
      run.anchor = n ? `${base}-${n}` : base;
      flush();
      continue;
    }
    const images = imageLine(line);
    if (images && images.some((im) => isLocalSource(im.src))) {
      flush();
      out.push({ kind: "images", images, from: i, to: i });
      continue;
    }
    if (REF.test(line)) { flush(); continue; }
    if (!line.trim()) {
      // A blank line ends the block unless what follows belongs to it: an
      // indented continuation, or the next item of the same list.
      const next = lines.slice(i + 1).find((l) => l.trim());
      const inList = run && LIST.test(run.lines[0]);
      if (run && next != null && (/^(\s{2,}|\t)\S/.test(next) || (inList && LIST.test(next)))) { push(i, line); continue; }
      flush();
      continue;
    }
    // A list or quote right after a paragraph line starts its own block.
    if (run && run.lines.length && (TASK.test(line) && !LIST.test(run.lines[0]))) flush();
    push(i, imagesAsLinks(line));
  }
  flush();
  if (notes.size) {
    const list = [...notes.values()].sort((a, b) => (numbers.get(a.id) ?? 1e9) - (numbers.get(b.id) ?? 1e9) || a.from - b.from);
    for (const n of list) n.text = footnoteRefs(imagesAsLinks(n.text), number);
    out.push({ kind: "footnotes", notes: list.map((n) => ({ id: n.id, n: number(n.id), anchor: `fn-${slug(n.id)}`, text: n.text, from: n.from, to: n.to })), from: Math.min(...list.map((n) => n.from)), to: Math.max(...list.map((n) => n.to)) });
  }
  const count = new Map();
  for (const p of out) {
    const base = `${p.kind}-${hash(JSON.stringify(p.kind === "images" ? p.images : p.kind === "tasks" ? p.items : p.kind === "footnotes" ? p.notes : [p.text, p.title ?? ""]))}`;
    const n = count.get(base) ?? 0;
    count.set(base, n + 1);
    p.key = n ? `${base}-${n}` : base;
  }
  return out;
}

/** What a run of lines is: Markdown, a task list, a callout. */
function classify(run, refs, number) {
  const from = run.from, to = run.from + run.lines.length - 1;
  const refsIn = [];
  const withRefs = (lines) => lines.map((l) => {
    for (const m of l.matchAll(/\[\^([^\]\s]+)\](?!:)/g)) refsIn.push(`fnref-${slug(m[1])}`);
    return footnoteRefs(l, number);
  });
  const anchors = () => (refsIn.length ? { anchors: [...new Set(refsIn)] } : {});
  const body = (lines) => [...withRefs(lines), ...(refs.length ? ["", ...refs] : [])].join("\n");
  const first = run.lines[0];
  const callout = CALLOUT.exec(first);
  if (callout && run.lines.every((l) => /^\s{0,3}>/.test(l) || !l.trim())) {
    const type = callout[1].toLowerCase();
    const [color, name] = CALLOUTS[type] ?? ["ansi4", callout[1][0].toUpperCase() + callout[1].slice(1).toLowerCase()];
    const text = body(run.lines.slice(1).map((l) => l.replace(/^\s{0,3}>\s?/, "")));
    return { kind: "callout", type, title: callout[3] || name, color, folded: callout[2] === "-", text, from, to, ...anchors() };
  }
  const adm = ADMONITION.exec(first);
  if (adm) {
    const type = adm[2].toLowerCase();
    const [color, name] = CALLOUTS[type] ?? ["ansi4", adm[2][0].toUpperCase() + adm[2].slice(1).toLowerCase()];
    const text = body(run.lines.slice(1).map((l) => l.replace(/^( {4}|\t)/, "")));
    return { kind: "callout", type, title: adm[3] ?? name, color, folded: adm[1] === "???", text, from, to, ...anchors() };
  }
  if (LIST.test(first) && run.lines.some((l) => TASK.test(l))) {
    const items = taskItems(run.lines, from).map((it) => ({ ...it, text: body([it.text]) }));
    return { kind: "tasks", items, from, to, ...anchors() };
  }
  return { kind: "md", text: body(run.lines), from, to, ...(run.anchor ? { anchor: run.anchor } : {}), ...anchors() };
}

/** The edit that ticks or unticks the task on `line` of `text`:
 *  { line, col, text } replacing the one character inside its brackets, or null. */
export function taskToggle(text, line) {
  const l = String(text).replace(/\r\n?/g, "\n").split("\n")[line];
  const m = l == null ? null : TASK.exec(l);
  if (!m) return null;
  const col = l.indexOf("[", m[1].length + m[2].length) + 1;
  return { line, col, text: m[3] === " " ? "x" : " " };
}

/** Copies a local image into the app's cache, named by its contents (image()
 *  reads only under the app's folder); -> its name under `cache/<dir>`. */
export async function cacheImage(path, dir) {
  const script = 'mkdir -p "$2" && [ -f "$1" ] || exit 3; s=$(cksum < "$1" | cut -d" " -f1); n="$s.${1##*.}"; [ -f "$2/$n" ] || cp "$1" "$2/$n" || exit 4; printf %s "$n"';
  const r = await exec("sh", ["-c", script, "md-image", path, `${appHome()}/cache/${dir}`]).catch(() => null);
  return r?.code === 0 && r.stdout ? r.stdout.trim() : null;
}

const GAP = 12;
const PAD_TOP = 20, PAD_BOTTOM = 44;
// Blocks this far above and below the view are drawn too (and measured).
const OVERDRAW = 1.5;

/** A rendered document that scrolls: its blocks, their measured heights,
 *  where a source line is drawn and which line is at a height. Shared by the
 *  viewer and the editor's preview; each owns one. */
export class MarkdownDoc {
  constructor(prefix) {
    this.prefix = prefix;
    this.parts = [];
    this.heights = new Map(); // key -> measured height
    this.scrollY = 0;
    this.viewH = 400;
    this.width = 600;
    this.want = null; // an anchor to scroll to once measured
  }

  setText(text) {
    this.parts = text == null ? [] : blocks(text);
    const keys = new Set(this.parts.map((p) => p.key));
    for (const k of [...this.heights.keys()]) if (!keys.has(k)) this.heights.delete(k);
  }

  /** A block's height: measured, else a guess from its lines. */
  height(p) {
    const h = this.heights.get(p.key);
    if (h != null) return h;
    if (p.kind === "images") return 200;
    const lines = p.kind === "md" ? p.text.split("\n").length : p.to - p.from + 1;
    return 22 * lines + 8;
  }

  /** Each block's top (from the document's top, padding included) and the total height. */
  tops() {
    const tops = [];
    let y = PAD_TOP;
    for (const p of this.parts) { tops.push(y); y += this.height(p) + GAP; }
    return { tops, total: y - GAP + PAD_BOTTOM };
  }

  contentH() { return this.tops().total; }

  scroll(dy) {
    const max = Math.max(0, this.contentH() - this.viewH);
    this.scrollY = Math.max(0, Math.min(max, this.scrollY + dy));
  }

  setScroll(y) { this.scrollY = 0; this.scroll(y); }

  /** The block holding `anchor` (a heading or a footnote) at the top. */
  scrollTo(anchor) {
    const i = this.parts.findIndex((p) => p.anchor === anchor || p.anchors?.includes(anchor) || p.notes?.some((n) => n.anchor === anchor));
    if (i < 0) { this.want = null; return false; }
    this.want = this.parts.slice(0, i).some((p) => !this.heights.has(p.key)) ? anchor : null;
    this.setScroll(this.tops().tops[i] - 8);
    return true;
  }

  /** Where source line `line` (fractional) is drawn, from the document's top. */
  yOfLine(line) {
    const { tops } = this.tops();
    let best = -1;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (p.kind === "footnotes") continue;
      if (p.from <= line) best = i;
      if (p.from <= line && line <= p.to + 1) {
        const span = p.to - p.from + 1;
        return tops[i] + this.height(p) * Math.min(1, (line - p.from) / span);
      }
    }
    if (best < 0) return 0;
    // Between blocks (blank lines): the gap after the one before.
    return tops[best] + this.height(this.parts[best]) + GAP / 2;
  }

  /** The source line (fractional) drawn at height `y` from the document's top. */
  lineAtY(y) {
    const { tops } = this.tops();
    let prev = null;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (p.kind === "footnotes") continue;
      const h = this.height(p);
      if (y < tops[i]) {
        // In the gap above it: between the last block's end and this one's start.
        if (!prev) return p.from;
        const t = (y - prev.bottom) / Math.max(1, tops[i] - prev.bottom);
        return prev.to + 1 + Math.max(0, Math.min(1, t)) * Math.max(0, p.from - prev.to - 1);
      }
      if (y <= tops[i] + h) return p.from + ((y - tops[i]) / Math.max(1, h)) * (p.to - p.from + 1);
      prev = { to: p.to, bottom: tops[i] + h };
    }
    return prev ? prev.to + 1 : 0;
  }

  /** A block was measured: keep what's on screen in place when a block
   *  above it changes height. -> whether anything changed. */
  measured(key, h) {
    const old = this.heights.get(key);
    if (old != null && Math.abs(old - h) <= 1) return false;
    const i = this.parts.findIndex((p) => p.key === key);
    if (i >= 0) {
      const { tops } = this.tops();
      const was = old ?? this.height(this.parts[i]);
      if (tops[i] + was < this.scrollY && !this.want) this.scrollY += h - was;
    }
    this.heights.set(key, h);
    if (this.want) this.scrollTo(this.want);
    this.scroll(0);
    return true;
  }

  /** The scrolling document. `o`: { onLink(url, cx), onTask(line, cx),
   *  image(src) -> { abs, name } (name: undefined while copying, null: can't),
   *  onImage(abs), dither(color), focused, size, maxWidth, unzoom(px), notify(cx) }. */
  render(t, o) {
    const { tops, total } = this.tops();
    const lo = this.scrollY - this.viewH * OVERDRAW, hi = this.scrollY + this.viewH * (1 + OVERDRAW);
    const shown = [];
    for (let i = 0; i < this.parts.length; i++) {
      const top = tops[i], h = this.height(this.parts[i]);
      if (top + h >= lo && top <= hi) shown.push(i);
    }
    const first = shown.length ? tops[shown[0]] : 0;
    const max = Math.max(1, total - this.viewH), frac = Math.min(1, this.viewH / Math.max(1, total));
    return div().id(`${this.prefix}-view`).relative().flex_1().min_h(0).min_w(0).overflow_hidden()
      .on_size_change((size, cx) => {
        const h = o.unzoom(size.height), w = o.unzoom(size.width);
        if (Math.abs(h - this.viewH) > 1 || Math.abs(w - this.width) > 1) { this.viewH = h; this.width = w; this.scroll(0); o.notify(cx); }
      })
      .on_scroll_wheel((e, cx) => { this.scroll(-o.unzoom(e.delta?.y ?? 0)); o.onScroll?.(cx); o.notify(cx); })
      .child(h_flex().absolute().left(0).right(0).top(first - this.scrollY).justify_center()
        .child(v_flex().w_full().max_w(o.maxWidth ?? 780).px(24).gap(GAP).children(shown.map((i) => {
          const p = this.parts[i];
          return div().id(`${this.prefix}-${p.key}`).on_size_change((size, cx) => { if (this.measured(p.key, o.unzoom(size.height))) o.notify(cx); })
            .child(this.part(t, p, o));
        }))))
      .when(frac < 1, (el) => el.child(div().absolute().right(1).w(3)
        .top(Math.round((this.scrollY / max) * this.viewH * (1 - frac))).h(Math.max(16, Math.round(this.viewH * frac)))
        .child(o.dither(o.focused ? t.accent : t.ansi8))));
  }

  part(t, p, o) {
    const id = `${this.prefix}-${p.key}`;
    const size = o.size ?? 13;
    const md = (key, text) => markdown(t, key, text, { onLink: o.onLink, size });
    if (p.kind === "md") return md(`${id}-md`, p.text);
    if (p.kind === "images") return this.images(t, p, id, o);
    if (p.kind === "tasks") return this.tasks(t, p, id, o, md);
    if (p.kind === "callout") {
      const color = t[p.color] ?? t.accent;
      return v_flex().relative().pl(14).pr(12).py(8).gap(4)
        .child(div().absolute().inset_0().opacity(0.14).child(o.dither(color)))
        .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(color))
        .child(h_flex().relative().gap(8).items_center()
          .child(div().relative().size(8).flex_none().border(1).border_color(color).child(o.dither(color)))
          .child(div().text_size(size - 1).text_color(color).child(p.title)))
        .when(!!p.text.trim(), (el) => el.child(div().relative().child(md(`${id}-md`, p.text))));
    }
    if (p.kind === "footnotes") {
      return v_flex().gap(6).pt(4)
        .child(h_flex().gap(10).items_center().text_size(10.5).text_color(t.dim)
          .child(div().child("FOOTNOTES"))
          .child(div().relative().flex_1().h(1).opacity(0.6).child(o.dither(t.ansi8))))
        .children(p.notes.map((n) => h_flex().id(`${id}-${n.anchor}`).gap(8).items_start()
          .child(div().w(22).flex_none().text_size(size - 1).text_color(t.accent).child(`${n.n}.`))
          .child(div().flex_1().min_w(0).child(md(`${id}-${n.anchor}-md`, n.text)))
          .child(div().id(`${id}-${n.anchor}-back`).flex_none().text_color(t.dim).hover((s) => s.text_color(t.accent)).cursor_pointer()
            .on_click((_e, cx) => { cx.stop_propagation(); o.onLink(`#fnref-${n.anchor.slice(3)}`, cx); })
            .child("↩"))));
    }
    return div();
  }

  tasks(t, p, id, o, md) {
    const base = Math.min(...p.items.map((it) => it.indent));
    return v_flex().gap(3).children(p.items.map((it, j) => {
      const box = it.checked == null
        ? div().w(14).flex_none().text_color(t.dim).child(/^\d/.test(it.marker) ? it.marker : "•")
        : div().id(`${id}-box-${j}`).relative().size(12).mt(3).flex_none().border(1).border_color(it.checked ? t.accent : t.ansi8)
          .cursor_pointer().hover((s) => s.border_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); o.onTask?.(it.line, cx); })
          .when(it.checked, (el) => el.child(div().absolute().top(2).left(2).right(2).bottom(2).child(o.dither(t.accent))));
      return h_flex().id(`${id}-item-${j}`).gap(8).items_start().pl(Math.max(0, it.indent - base) * 7)
        .child(box)
        .child(div().flex_1().min_w(0).when(it.checked === true, (el) => el.opacity(0.6)).child(md(`${id}-item-${j}-md`, it.text || " ")));
    }));
  }

  images(t, p, id, o) {
    return v_flex().gap(6).children(p.images.map((img, j) => {
      const got = o.image?.(img.src) ?? { abs: null, name: null };
      if (got.name) return div().id(`${id}-imgbox-${j}`).flex().cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); o.onImage?.(got.abs); })
        .child(image(got.name).id(`${id}-img-${j}`).max_w_full().max_h(360));
      const label = got.name === undefined && got.abs ? "loading…" : img.alt || img.src;
      return markdown(t, `${id}-imgalt-${j}`, `[▧ ${label.replace(/[[\]]/g, "")}](${img.src})`, { onLink: o.onLink }).text_color(t.muted);
    }));
  }
}
