// Markdown in Nocturne's look: the GitHub window's PR bodies and comments,
// the Markdown viewer, and the editor's live preview. Shared by
// github, markdown and editor. A mod can import
// only its own files, so each of them ships this same file;
// scripts/markdown.test.ts fails when the copies differ: edit
// markdown/markdown.ts and copy it over.
//
// What the app draws natively inside every Markdown text (src/markdown.rs):
// math ($…$, $$…$$, a ```math fence), mermaid diagrams (a ```mermaid fence),
// code fences in tree-sitter colors. What this file adds around it: a document
// cut into blocks that know their source lines (so a preview can follow an
// editor), task lists you can tick, callouts (> [!NOTE], !!! note),
// footnotes, local images, front matter.

import { div, image } from "gpui-kit";
import type { Color, Context, Element } from "gpui-kit";
import { TextView, h_flex, v_flex } from "gpui-base";
import { exec, appHome } from "herdr";
import type { Theme } from "herdr";

/** The theme colours a callout is drawn in. */
export type CalloutColor = "ansi1" | "ansi2" | "ansi3" | "ansi4" | "ansi5" | "ansi6" | "ansi8" | "ansi13";

/** A picture on a line of its own: its alt text and its source. */
export interface ImageRef {
  readonly alt: string;
  readonly src: string;
}

/** An item of a list holding tasks: its first line, its indent, its marker,
 *  whether it's ticked (null: not a task), its text (continuations joined). */
export interface TaskItem {
  readonly line: number;
  readonly indent: number;
  readonly marker: string;
  readonly checked: boolean | null;
  readonly text: string;
}

/** A footnote: its id, its number, its anchor (`fn-…`), its text, its lines. */
export interface Footnote {
  readonly id: string;
  readonly n: number;
  readonly anchor: string;
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

/** What every block has: its source lines (0-based, inclusive) and the
 *  footnotes referenced in it (`fnref-…`, for the way back). */
interface Lines {
  readonly from: number;
  readonly to: number;
  readonly anchors?: readonly string[];
}

/** A block before its key. */
export type Unkeyed =
  /** Markdown (every heading starts one; `anchor`: its heading's). */
  | (Lines & { readonly kind: "md"; readonly text: string; readonly anchor?: string })
  /** A line of local images (TextView fetches only web ones). */
  | (Lines & { readonly kind: "images"; readonly images: readonly ImageRef[] })
  /** A list holding task items, tickable. */
  | (Lines & { readonly kind: "tasks"; readonly items: readonly TaskItem[] })
  /** > [!NOTE] and !!! note. */
  | (Lines & { readonly kind: "callout"; readonly type: string; readonly title: string; readonly color: CalloutColor; readonly folded: boolean; readonly text: string })
  /** The footnotes, gathered at the end. */
  | (Lines & { readonly kind: "footnotes"; readonly notes: readonly Footnote[] });

/** A block drawn on its own, with a stable `key` (its kind and text). */
export type Block = Unkeyed & { readonly key: string };

/** What MarkdownDoc.render draws with: link and task clicks, local images
 *  (`image(src)`: its absolute path and its name in the cache, undefined while
 *  copying, null when it can't be), the dither, focus, the text size and width,
 *  the zoom, a redraw, and the block the keyboard's link is in (`chosen`). */
export interface DocOptions {
  readonly onLink?: ((url: string, cx: Context) => void) | undefined;
  readonly onTask?: ((line: number, cx: Context) => void) | undefined;
  readonly onScroll?: ((cx: Context) => void) | undefined;
  readonly image?: ((src: string) => { readonly abs: string | null; readonly name: string | null | undefined }) | undefined;
  readonly onImage?: ((abs: string | null) => void) | undefined;
  readonly dither: (color: Color) => Element;
  readonly focused?: boolean | undefined;
  readonly size?: number | undefined;
  readonly maxWidth?: number | undefined;
  readonly unzoom: (px: number) => number;
  readonly notify: (cx: Context) => void;
  readonly chosen?: string | null | undefined;
}

/** Rendered Markdown's options: who takes link clicks, the text size. */
export interface MarkdownOptions {
  readonly onLink?: ((url: string, cx: Context) => void) | undefined;
  readonly size?: number;
}

/** Rendered Markdown in the theme's text, selectable. `onLink(url, cx)`
 *  takes link clicks (without it, web links open as the app opens them). */
export function markdown(t: Theme, id: string, text: string, options: MarkdownOptions = {}): Element {
  const { onLink, size = 12.5 } = options;
  const view = TextView.markdown(id, text).selectable(true);

  return div().text_size(size).text_color(t.foreground).child(onLink ? view.on_link_click(onLink) : view);
}

/** The text as one code block, for a raw view: a fence longer than any inside it. */
export function fenced(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`{3,}/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);

  return `${fence}\n${text}\n${fence}`;
}

/** A heading's anchor, as GitHub makes it: lowercase, links and marks gone,
 *  punctuation dropped (letters, digits, `-` and `_` stay), spaces to `-`. */
export function slug(heading: string): string {
  return heading
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
const INDENTED = /^(\s{2,}|\t)\S/;

// A line holding only images: ![alt](src "title"), optionally wrapped in a link, or <img src>.
const MD_IMAGE = /\[?!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*["')])?\s*\)(?:\]\([^)]*\))?/g;
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

/** Whether an image source is a file next to the document (not http, data: or another scheme). */
export function isLocalSource(src: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("//");
}

/** The images a line holds, when it holds nothing else (HTML wrappers aside). */
export function imageLine(line: string): ImageRef[] | null {
  const images: ImageRef[] = [];

  const rest = line
    .replace(MD_IMAGE, (_m, alt: string, src: string) => {
      images.push({ alt, src });

      return "";
    })
    .replace(HTML_IMAGE, (m, src: string) => {
      images.push({ alt: /\balt\s*=\s*["']([^"']*)["']/i.exec(m)?.[1] ?? "", src });

      return "";
    })
    .replace(/<\/?(p|div|a|picture|source|br|center)\b[^>]*>/gi, "");

  return images.length && !rest.trim() ? images : null;
}

/** Local images inside running text (TextView can't draw them) as links to the file. */
export function imagesAsLinks(line: string): string {
  return line.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(\s+["'(][^)]*["')])?\s*\)/g,
    (m, alt: string, src: string) => (isLocalSource(src) ? `[▧ ${alt || src.split("/").pop() || src}](${src})` : m));
}

const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sup = (n: number): string => String(n).split("").map((d) => SUP[Number(d)] ?? d).join("");

/** Footnote references `[^id]` as superscript links to their note, outside
 *  code spans; `number(id)` numbers them in the order they're first seen. */
export function footnoteRefs(line: string, number: (id: string) => number): string {
  return line.split(/(`+[^`]*`+)/).map((piece, i) => (i % 2 ? piece
    : piece.replace(/\[\^([^\]\s]+)\](?!:)/g, (_m, id: string) => `[${sup(number(id))}](#fn-${slug(id)})`))).join("");
}

/** Callout colors and names by type (a document names the type): GitHub's five
 *  and Obsidian's / MkDocs' others. */
export const CALLOUTS: ReadonlyMap<string, readonly [color: CalloutColor, name: string]> = new Map<string, readonly [CalloutColor, string]>([
  ["note", ["ansi4", "Note"]], ["info", ["ansi4", "Info"]], ["todo", ["ansi4", "Todo"]],
  ["tip", ["ansi2", "Tip"]], ["hint", ["ansi2", "Hint"]], ["success", ["ansi2", "Success"]], ["check", ["ansi2", "Check"]], ["done", ["ansi2", "Done"]],
  ["important", ["ansi5", "Important"]], ["example", ["ansi13", "Example"]],
  ["warning", ["ansi3", "Warning"]], ["attention", ["ansi3", "Attention"]],
  ["caution", ["ansi1", "Caution"]], ["danger", ["ansi1", "Danger"]], ["error", ["ansi1", "Error"]], ["bug", ["ansi1", "Bug"]], ["failure", ["ansi1", "Failure"]], ["fail", ["ansi1", "Fail"]],
  ["question", ["ansi6", "Question"]], ["help", ["ansi6", "Help"]], ["faq", ["ansi6", "FAQ"]],
  ["abstract", ["ansi6", "Abstract"]], ["summary", ["ansi6", "Summary"]], ["tldr", ["ansi6", "TL;DR"]],
  ["quote", ["ansi8", "Quote"]], ["cite", ["ansi8", "Cite"]],
]);

/** A callout type's colour and name: its own, else the note's colour and the type, capitalised. */
const calloutOf = (written: string): readonly [CalloutColor, string] =>
  CALLOUTS.get(written.toLowerCase()) ?? ["ansi4", written.slice(0, 1).toUpperCase() + written.slice(1).toLowerCase()];

/** A short, stable hash of a string (FNV-1a), for block keys. */
function hash(s: string): string {
  let h = 0x811c9dc5;

  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }

  return (h >>> 0).toString(36);
}

const indentOf = (s: string): number => s.replace(/\t/g, "    ").length;

/** The items of a list holding tasks: each item's first line, indent,
 *  marker, checked (null: not a task), and its text (continuations joined). */
function taskItems(lines: readonly string[], from: number): TaskItem[] {
  const items: TaskItem[] = [];

  lines.forEach((line, i) => {
    const task = TASK.exec(line);
    const list = LIST.exec(line);
    const last = items.at(-1);

    if (task) items.push({ line: from + i, indent: indentOf(task[1] ?? ""), marker: task[2] ?? "", checked: task[3] !== " ", text: task[4] ?? "" });
    else if (list) items.push({ line: from + i, indent: indentOf(list[1] ?? ""), marker: list[2] ?? "", checked: null, text: line.slice(list[0].length) });
    else if (last) items[items.length - 1] = { ...last, text: last.text + "\n" + line.trim() };
  });

  return items;
}

/** A run of lines collected into one block, from line `from`. */
interface LineRun {
  readonly from: number;
  readonly lines: string[];
  anchor?: string;
}

/** Whether a fence line `f` closes the fence opened with `open`. */
const closes = (f: RegExpExecArray | null, open: string, line: string): boolean => {
  const mark = f?.[1];

  return Boolean(f && mark && mark[0] === open[0] && mark.length >= open.length && !line.slice(f[0].length).trim());
};

/** A footnote definition, gathered in the first pass. */
interface NoteDraft {
  readonly id: string;
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

/** What the first pass finds: reference definitions, footnotes, and the lines footnotes take. */
interface Definitions {
  readonly refs: string[];
  readonly notes: Map<string, NoteDraft>;
  readonly noteLines: Set<number>;
}

/** The first pass: reference definitions and footnotes (outside fences). */
function definitions(lines: readonly string[]): Definitions {
  const refs: string[] = [];
  const notes = new Map<string, NoteDraft>();
  const noteLines = new Set<number>();
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const f = FENCE.exec(line);

    if (fence) {
      if (closes(f, fence, line)) fence = null;

      continue;
    }

    if (f) {
      fence = f[1] ?? null;

      continue;
    }

    if (REF.test(line)) refs.push(line);

    const fn = FOOTNOTE.exec(line);
    const id = fn?.[1];

    if (fn && id) {
      const body = [fn[2] ?? ""];
      let j = i + 1;

      noteLines.add(i);

      // Its continuation: indented lines, blank lines between them.
      for (let next = lines[j]; next !== undefined && (INDENTED.test(next) || (!next.trim() && INDENTED.test(lines[j + 1] ?? ""))); next = lines[j]) {
        body.push(next.trim());
        noteLines.add(j);
        j++;
      }

      if (!notes.has(id)) notes.set(id, { id, text: body.join("\n"), from: i, to: j - 1 });

      i = j - 1;
    }
  }

  return { refs, notes, noteLines };
}

/** A heading's anchor: its slug, numbered from the second time it's seen. */
const anchorOf = (seen: Map<string, number>, text: string): string => {
  const base = slug(text);
  const n = seen.get(base) ?? 0;

  seen.set(base, n + 1);

  return n ? `${base}-${n}` : base;
};

/** What a block's key is made from. */
const keyText = (p: Unkeyed): string => {
  switch (p.kind) {
    case "images": return JSON.stringify(p.images);
    case "tasks": return JSON.stringify(p.items);
    case "footnotes": return JSON.stringify(p.notes);
    case "callout": return JSON.stringify([p.text, p.title]);
    case "md": return JSON.stringify([p.text, ""]);
  }
};

/** A document cut into blocks drawn one by one, each knowing its source lines
 *  (`from`..`to`, 0-based) and a stable `key` (its kind and text); see Block.
 *  Reference definitions are copied into every Markdown block so `[text][ref]`
 *  still resolves; footnote references become superscript links. A block also
 *  lists the footnotes referenced in it (`anchors`: fnref-…) for the way back. */
export function blocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const { refs, notes, noteLines } = definitions(lines);
  const numbers = new Map<string, number>();

  const number = (id: string): number => {
    const known = numbers.get(id);

    if (known !== undefined) return known;

    const n = numbers.size + 1;

    numbers.set(id, n);

    return n;
  };

  const out: Unkeyed[] = [];
  const seen = new Map<string, number>();
  let run: LineRun | null = null;

  const flush = (): void => {
    if (run && run.lines.some((l) => l.trim())) {
      // Trailing blank lines aren't the block's.
      while (!(run.lines.at(-1) ?? "x").trim()) run.lines.pop();

      out.push(classify(run, refs, number));
    }

    run = null;
  };

  const push = (i: number, line: string): void => {
    run ??= { from: i, lines: [] };
    run.lines.push(line);
  };

  let fence: string | null = null;
  let math = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Front matter: a YAML block at the very top, shown as such.
    if (i === 0 && /^---\s*$/.test(line)) {
      const end = lines.findIndex((l, j) => j > 0 && /^(---|\.\.\.)\s*$/.test(l));

      if (end > 0) {
        out.push({ kind: "md", text: fenced(lines.slice(1, end).join("\n")).replace(/^`+/, (m) => m + "yaml"), from: 0, to: end });
        i = end;

        continue;
      }
    }

    if (noteLines.has(i)) {
      flush();

      continue;
    }

    const f = FENCE.exec(line);

    if (fence) {
      if (closes(f, fence, line)) fence = null;

      push(i, line);

      continue;
    }

    if (math) {
      if (/\$\$\s*$/.test(line)) math = false;

      push(i, line);

      continue;
    }

    if (f) {
      if (!run || !run.lines.some((l) => l.trim())) flush();

      fence = f[1] ?? null;
      push(i, line);

      continue;
    }

    if (MATH_FENCE.test(line) && !/^\s*\$\$.+\$\$\s*$/.test(line)) {
      math = true;
      push(i, line);

      continue;
    }

    const h = HEADING.exec(line);

    if (h) {
      flush();
      run = { from: i, lines: [line], anchor: anchorOf(seen, h[2] ?? "") };
      flush();

      continue;
    }

    // A setext heading: one line of text, then === or ---.
    const only = run?.lines.length === 1 ? run.lines[0] : undefined;

    if (run && SETEXT.test(line) && only?.trim() && !LIST.test(only) && !/^\s*>/.test(only)) {
      run.lines.push(line);
      run.anchor = anchorOf(seen, only.trim());
      flush();

      continue;
    }

    const images = imageLine(line);

    if (images?.some((im) => isLocalSource(im.src))) {
      flush();
      out.push({ kind: "images", images, from: i, to: i });

      continue;
    }

    if (REF.test(line)) {
      flush();

      continue;
    }

    if (!line.trim()) {
      // A blank line ends the block unless what follows belongs to it: an
      // indented continuation, or the next item of the same list.
      const next = lines.slice(i + 1).find((l) => l.trim());
      const inList = LIST.test(run?.lines[0] ?? "");

      if (run && next !== undefined && (INDENTED.test(next) || (inList && LIST.test(next)))) {
        push(i, line);

        continue;
      }

      flush();

      continue;
    }

    // A list or quote right after a paragraph line starts its own block.
    if (run?.lines.length && TASK.test(line) && !LIST.test(run.lines[0] ?? "")) flush();

    push(i, imagesAsLinks(line));
  }

  flush();

  if (notes.size) {
    const list = [...notes.values()].sort((a, b) => (numbers.get(a.id) ?? 1e9) - (numbers.get(b.id) ?? 1e9) || a.from - b.from);
    const drafts = list.map((n) => ({ ...n, text: footnoteRefs(imagesAsLinks(n.text), number) }));

    out.push({
      kind: "footnotes",
      notes: drafts.map((n) => ({ id: n.id, n: number(n.id), anchor: `fn-${slug(n.id)}`, text: n.text, from: n.from, to: n.to })),
      from: Math.min(...drafts.map((n) => n.from)),
      to: Math.max(...drafts.map((n) => n.to)),
    });
  }

  const count = new Map<string, number>();

  return out.map((p) => {
    const base = `${p.kind}-${hash(keyText(p))}`;
    const n = count.get(base) ?? 0;

    count.set(base, n + 1);

    return { ...p, key: n ? `${base}-${n}` : base };
  });
}

/** What a run of lines is: Markdown, a task list, a callout. */
function classify(run: LineRun, refs: readonly string[], number: (id: string) => number): Unkeyed {
  const from = run.from;
  const to = run.from + run.lines.length - 1;
  const refsIn: string[] = [];

  const withRefs = (lines: readonly string[]): string[] => lines.map((l) => {
    for (const m of l.matchAll(/\[\^([^\]\s]+)\](?!:)/g)) refsIn.push(`fnref-${slug(m[1] ?? "")}`);

    return footnoteRefs(l, number);
  });

  const body = (lines: readonly string[]): string => [...withRefs(lines), ...(refs.length ? ["", ...refs] : [])].join("\n");
  const lines = (): Lines => (refsIn.length ? { from, to, anchors: [...new Set(refsIn)] } : { from, to });
  const first = run.lines[0] ?? "";
  const callout = CALLOUT.exec(first);

  if (callout && run.lines.every((l) => /^\s{0,3}>/.test(l) || !l.trim())) {
    const written = callout[1] ?? "";
    const [color, name] = calloutOf(written);
    const text = body(run.lines.slice(1).map((l) => l.replace(/^\s{0,3}>\s?/, "")));

    return { kind: "callout", type: written.toLowerCase(), title: callout[3] || name, color, folded: callout[2] === "-", text, ...lines() };
  }

  const adm = ADMONITION.exec(first);

  if (adm) {
    const written = adm[2] ?? "";
    const [color, name] = calloutOf(written);
    const text = body(run.lines.slice(1).map((l) => l.replace(/^( {4}|\t)/, "")));

    return { kind: "callout", type: written.toLowerCase(), title: adm[3] ?? name, color, folded: adm[1] === "???", text, ...lines() };
  }

  if (LIST.test(first) && run.lines.some((l) => TASK.test(l))) {
    const items = taskItems(run.lines, from).map((it) => ({ ...it, text: body([it.text]) }));

    return { kind: "tasks", items, ...lines() };
  }

  const text = body(run.lines);

  return run.anchor ? { kind: "md", text, anchor: run.anchor, ...lines() } : { kind: "md", text, ...lines() };
}

/** The edit that ticks or unticks the task on `line` of `text`: the one
 *  character inside its brackets (1-based column), or null. */
export function taskToggle(text: string, line: number): { readonly line: number; readonly col: number; readonly text: string } | null {
  const l = text.replace(/\r\n?/g, "\n").split("\n")[line];
  const m = l === undefined ? null : TASK.exec(l);

  if (!l || !m) return null;

  const col = l.indexOf("[", (m[1] ?? "").length + (m[2] ?? "").length) + 1;

  return { line, col, text: m[3] === " " ? "x" : " " };
}

/** Copies a local image into the app's cache, named by its contents (image()
 *  reads only under the app's folder): its name under `cache/<dir>`, or null. */
export async function cacheImage(path: string, dir: string): Promise<string | null> {
  const script = 'mkdir -p "$2" && [ -f "$1" ] || exit 3; s=$(cksum < "$1" | cut -d" " -f1); n="$s.${1##*.}"; [ -f "$2/$n" ] || cp "$1" "$2/$n" || exit 4; printf %s "$n"';
  const r = await exec("sh", ["-c", script, "md-image", path, `${appHome()}/cache/${dir}`]).catch(() => null);

  return r?.code === 0 && r.stdout ? r.stdout.trim() : null;
}

/** Each block's top, and the document's height. */
export interface Tops {
  readonly tops: readonly number[];
  readonly total: number;
}

const GAP = 12;
const PAD_TOP = 20;
const PAD_BOTTOM = 44;

// Blocks this far above and below the view are drawn too (and measured).
const OVERDRAW = 1.5;

/** A rendered document that scrolls: its blocks, their measured heights,
 *  where a source line is drawn and which line is at a height. Shared by the
 *  viewer and the editor's preview; each owns one. */
export class MarkdownDoc {
  readonly prefix: string;
  parts: Block[] = [];
  /** Each block's measured height, by key. */
  heights = new Map<string, number>();
  scrollY = 0;
  viewH = 400;
  width = 600;
  /** An anchor to scroll to once measured. */
  want: string | null = null;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  setText(text: string | null | undefined): void {
    this.parts = text === null || text === undefined ? [] : blocks(text);

    const keys = new Set(this.parts.map((p) => p.key));

    for (const k of this.heights.keys()) if (!keys.has(k)) this.heights.delete(k);
  }

  /** A block's height: measured, else a guess from its lines. */
  height(p: Block): number {
    const h = this.heights.get(p.key);

    if (h !== undefined) return h;

    if (p.kind === "images") return 200;

    const lines = p.kind === "md" ? p.text.split("\n").length : p.to - p.from + 1;

    return 22 * lines + 8;
  }

  /** Each block's top (from the document's top, padding included) and the total height. */
  tops(): Tops {
    const tops: number[] = [];
    let y = PAD_TOP;

    for (const p of this.parts) {
      tops.push(y);
      y += this.height(p) + GAP;
    }

    return { tops, total: y - GAP + PAD_BOTTOM };
  }

  contentH(): number {
    return this.tops().total;
  }

  scroll(dy: number): void {
    const max = Math.max(0, this.contentH() - this.viewH);

    this.scrollY = Math.max(0, Math.min(max, this.scrollY + dy));
  }

  setScroll(y: number): void {
    this.scrollY = 0;
    this.scroll(y);
  }

  /** The block holding `anchor` (a heading or a footnote) at the top. */
  scrollTo(anchor: string): boolean {
    const i = this.parts.findIndex((p) => (p.kind === "md" && p.anchor === anchor) || p.anchors?.includes(anchor) || (p.kind === "footnotes" && p.notes.some((n) => n.anchor === anchor)));

    if (i < 0) {
      this.want = null;

      return false;
    }

    this.want = this.parts.slice(0, i).some((p) => !this.heights.has(p.key)) ? anchor : null;
    this.setScroll((this.tops().tops[i] ?? 0) - 8);

    return true;
  }

  /** Where source line `line` (fractional) is drawn, from the document's top. */
  yOfLine(line: number): number {
    const { tops } = this.tops();
    let best: { readonly top: number; readonly part: Block } | null = null;

    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      const top = tops[i] ?? 0;

      if (!p || p.kind === "footnotes") continue;

      if (p.from <= line) best = { top, part: p };

      if (p.from <= line && line <= p.to + 1) {
        const span = p.to - p.from + 1;

        return top + this.height(p) * Math.min(1, (line - p.from) / span);
      }
    }

    if (!best) return 0;

    // Between blocks (blank lines): the gap after the one before.
    return best.top + this.height(best.part) + GAP / 2;
  }

  /** The source line (fractional) drawn at height `y` from the document's top. */
  lineAtY(y: number): number {
    const { tops } = this.tops();
    let prev: { readonly to: number; readonly bottom: number } | null = null;

    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      const top = tops[i] ?? 0;

      if (!p || p.kind === "footnotes") continue;

      const h = this.height(p);

      if (y < top) {
        // In the gap above it: between the last block's end and this one's start.
        if (!prev) return p.from;

        const t = (y - prev.bottom) / Math.max(1, top - prev.bottom);

        return prev.to + 1 + Math.max(0, Math.min(1, t)) * Math.max(0, p.from - prev.to - 1);
      }

      if (y <= top + h) return p.from + ((y - top) / Math.max(1, h)) * (p.to - p.from + 1);

      prev = { to: p.to, bottom: top + h };
    }

    return prev ? prev.to + 1 : 0;
  }

  /** A block was measured: keep what's on screen in place when a block
   *  above it changes height. Whether anything changed. */
  measured(key: string, h: number): boolean {
    const old = this.heights.get(key);

    if (old !== undefined && Math.abs(old - h) <= 1) return false;

    const i = this.parts.findIndex((p) => p.key === key);
    const part = this.parts[i];

    if (part) {
      const was = old ?? this.height(part);

      if ((this.tops().tops[i] ?? 0) + was < this.scrollY && !this.want) this.scrollY += h - was;
    }

    this.heights.set(key, h);

    if (this.want) this.scrollTo(this.want);

    this.scroll(0);

    return true;
  }

  /** The scrolling document (see DocOptions). */
  render(t: Theme, o: DocOptions): Element {
    const { tops, total } = this.tops();
    const lo = this.scrollY - this.viewH * OVERDRAW;
    const hi = this.scrollY + this.viewH * (1 + OVERDRAW);

    const shown = this.parts.flatMap((p, i) => {
      const top = tops[i] ?? 0;

      return top + this.height(p) >= lo && top <= hi ? [{ p, top }] : [];
    });

    const first = shown[0]?.top ?? 0;
    const max = Math.max(1, total - this.viewH);
    const frac = Math.min(1, this.viewH / Math.max(1, total));

    const view = div().id(`${this.prefix}-view`).relative().flex_1().min_h(0).min_w(0).overflow_hidden()
      .on_size_change((size, cx) => {
        const h = o.unzoom(size.height);
        const w = o.unzoom(size.width);

        if (Math.abs(h - this.viewH) > 1 || Math.abs(w - this.width) > 1) {
          this.viewH = h;
          this.width = w;
          this.scroll(0);
          o.notify(cx);
        }
      })
      .on_scroll_wheel((e, cx) => {
        this.scroll(-o.unzoom(e.delta.y));
        o.onScroll?.(cx);
        o.notify(cx);
      })
      .child(h_flex().absolute().left(0).right(0).top(first - this.scrollY).justify_center()
        .child(v_flex().w_full().max_w(o.maxWidth ?? 780).px(24).gap(GAP).children(shown.map(({ p }) => {
          const block = div().id(`${this.prefix}-${p.key}`).relative().on_size_change((size, cx) => {
            if (this.measured(p.key, o.unzoom(size.height))) o.notify(cx);
          });

          return (p.key === o.chosen ? block.child(div().absolute().left(-12).top(0).bottom(0).w(2).bg(t.accent)) : block).child(this.part(t, p, o));
        }))));

    if (frac >= 1) return view;

    return view.child(div().absolute().right(1).w(3)
      .top(Math.round((this.scrollY / max) * this.viewH * (1 - frac))).h(Math.max(16, Math.round(this.viewH * frac)))
      .child(o.dither(o.focused ? t.accent : t.ansi8)));
  }

  part(t: Theme, p: Block, o: DocOptions): Element {
    const id = `${this.prefix}-${p.key}`;
    const size = o.size ?? 13;
    const md = (key: string, text: string): Element => markdown(t, key, text, { onLink: o.onLink, size });

    switch (p.kind) {
      case "md": return md(`${id}-md`, p.text);
      case "images": return this.images(t, p.images, id, o);
      case "tasks": return this.tasks(t, p.items, id, o, md);

      case "callout": {
        const color = t[p.color];

        const box = v_flex().relative().pl(14).pr(12).py(8).gap(4)
          .child(div().absolute().inset_0().opacity(0.14).child(o.dither(color)))
          .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(color))
          .child(h_flex().relative().gap(8).items_center()
            .child(div().relative().size(8).flex_none().border(1).border_color(color).child(o.dither(color)))
            .child(div().text_size(size - 1).text_color(color).child(p.title)));

        return p.text.trim() ? box.child(div().relative().child(md(`${id}-md`, p.text))) : box;
      }

      case "footnotes":
        return v_flex().gap(6).pt(4)
          .child(h_flex().gap(10).items_center().text_size(10.5).text_color(t.dim)
            .child(div().child("FOOTNOTES"))
            .child(div().relative().flex_1().h(1).opacity(0.6).child(o.dither(t.ansi8))))
          .children(p.notes.map((n) => h_flex().id(`${id}-${n.anchor}`).gap(8).items_start()
            .child(div().w(22).flex_none().text_size(size - 1).text_color(t.accent).child(`${n.n}.`))
            .child(div().flex_1().min_w(0).child(md(`${id}-${n.anchor}-md`, n.text)))
            .child(div().id(`${id}-${n.anchor}-back`).flex_none().text_color(t.dim).hover((s) => s.text_color(t.accent)).cursor_pointer()
              .on_click((_e, cx) => {
                cx.stop_propagation();
                o.onLink?.(`#fnref-${n.anchor.slice(3)}`, cx);
              })
              .child("↩"))));
    }
  }

  tasks(t: Theme, items: readonly TaskItem[], id: string, o: DocOptions, md: (key: string, text: string) => Element): Element {
    const base = Math.min(...items.map((it) => it.indent));

    return v_flex().gap(3).children(items.map((it, j) => {
      const box = it.checked === null
        ? div().w(14).flex_none().text_color(t.dim).child(/^\d/.test(it.marker) ? it.marker : "•")
        : this.tickBox(t, it, `${id}-box-${j}`, o);

      const words = div().flex_1().min_w(0);

      return h_flex().id(`${id}-item-${j}`).gap(8).items_start().pl(Math.max(0, it.indent - base) * 7)
        .child(box)
        .child((it.checked === true ? words.opacity(0.6) : words).child(md(`${id}-item-${j}-md`, it.text || " ")));
    }));
  }

  /** A task's box: a click ticks or unticks it. */
  tickBox(t: Theme, it: TaskItem, id: string, o: DocOptions): Element {
    const box = div().id(id).relative().size(12).mt(3).flex_none().border(1).border_color(it.checked ? t.accent : t.ansi8)
      .cursor_pointer().hover((s) => s.border_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        o.onTask?.(it.line, cx);
      });

    return it.checked ? box.child(div().absolute().top(2).left(2).right(2).bottom(2).child(o.dither(t.accent))) : box;
  }

  images(t: Theme, images: readonly ImageRef[], id: string, o: DocOptions): Element {
    return v_flex().gap(6).children(images.map((img, j) => {
      const got = o.image?.(img.src) ?? { abs: null, name: null };

      if (got.name) {
        return div().id(`${id}-imgbox-${j}`).flex().cursor_pointer()
          .on_click((_e, cx) => {
            cx.stop_propagation();
            o.onImage?.(got.abs);
          })
          .child(image(got.name).id(`${id}-img-${j}`).max_w_full().max_h(360));
      }

      const label = got.name === undefined && got.abs ? "loading…" : img.alt || img.src;

      return markdown(t, `${id}-imgalt-${j}`, `[▧ ${label.replace(/[[\]]/g, "")}](${img.src})`, { onLink: o.onLink }).text_color(t.muted);
    }));
  }
}
