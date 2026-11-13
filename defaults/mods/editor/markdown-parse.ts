// Markdown cut into blocks (markdown.ts draws them): headings, lists and task
// items, fences, tables, quotes and callouts, footnotes and link definitions,
// images, front matter, each with the source lines it came from. Shared
// like markdown.ts: github, markdown and editor ship it unchanged.

import type { ImageRef, CalloutColor, TaskItem, Unkeyed, Block, Lines } from "./markdown.ts";
import { slug, fenced, isLocalSource, CALLOUTS, imagesAsLinks } from "./markdown.ts";

export const FENCE = /^ {0,3}(`{3,}|~{3,})/;
export const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
export const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
export const REF = /^ {0,3}\[(?!\^)[^\]]+\]:[ \t]*\S/;
export const FOOTNOTE = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]?(.*)$/;
export const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)/;
export const TASK = /^(\s*)([-*+]|\d{1,9}[.)])\s+\[([ xX])\](?=\s|$)\s?(.*)$/;
export const CALLOUT = /^ {0,3}>\s?\[!([A-Za-z-]+)\]([+-]?)[ \t]*(.*)$/;
export const ADMONITION = /^(!!!|\?\?\?\+?)[ \t]+([A-Za-z-]+)(?:[ \t]+"([^"]*)")?[ \t]*$/;
export const MATH_FENCE = /^ {0,3}\$\$/;
export const INDENTED = /^(\s{2,}|\t)\S/;

// A line holding only images: ![alt](src "title"), optionally wrapped in a link, or <img src>.
export const MD_IMAGE = /\[?!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*["')])?\s*\)(?:\]\([^)]*\))?/g;
export const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

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

export const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
export const sup = (n: number): string => String(n).split("").map((d) => SUP[Number(d)] ?? d).join("");

/** Footnote references `[^id]` as superscript links to their note, outside
 *  code spans; `number(id)` numbers them in the order they're first seen. */
export function footnoteRefs(line: string, number: (id: string) => number): string {
  return line.split(/(`+[^`]*`+)/).map((piece, i) => (i % 2 ? piece
    : piece.replace(/\[\^([^\]\s]+)\](?!:)/g, (_m, id: string) => `[${sup(number(id))}](#fn-${slug(id)})`))).join("");
}

/** A callout type's colour and name: its own, else the note's colour and the type, capitalised. */
export const calloutOf = (written: string): readonly [CalloutColor, string] =>
  CALLOUTS.get(written.toLowerCase()) ?? ["ansi4", written.slice(0, 1).toUpperCase() + written.slice(1).toLowerCase()];

/** A short, stable hash of a string (FNV-1a), for block keys. */
export function hash(s: string): string {
  let h = 0x811c9dc5;

  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }

  return (h >>> 0).toString(36);
}

export const indentOf = (s: string): number => s.replace(/\t/g, "    ").length;

/** The items of a list holding tasks: each item's first line, indent,
 *  marker, checked (null: not a task), and its text (continuations joined). */
export function taskItems(lines: readonly string[], from: number): TaskItem[] {
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
export interface LineRun {
  readonly from: number;
  readonly lines: string[];
  anchor?: string;
}

/** Whether a fence line `f` closes the fence opened with `open`. */
export const closes = (f: RegExpExecArray | null, open: string, line: string): boolean => {
  const mark = f?.[1];

  return Boolean(f && mark && mark[0] === open[0] && mark.length >= open.length && !line.slice(f[0].length).trim());
};

/** A footnote definition, gathered in the first pass. */
export interface NoteDraft {
  readonly id: string;
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

/** What the first pass finds: reference definitions, footnotes, and the lines footnotes take. */
export interface Definitions {
  readonly refs: string[];
  readonly notes: Map<string, NoteDraft>;
  readonly noteLines: Set<number>;
}

/** The first pass: reference definitions and footnotes (outside fences). */
export function definitions(lines: readonly string[]): Definitions {
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
export const anchorOf = (seen: Map<string, number>, text: string): string => {
  const base = slug(text);
  const n = seen.get(base) ?? 0;

  seen.set(base, n + 1);

  return n ? `${base}-${n}` : base;
};

/** What a block's key is made from. */
export const keyText = (p: Unkeyed): string => {
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
  const { numbers, number } = numbering();

  const cut = new Cut(refs, number);
  const out = cut.out;
  const seen = new Map<string, number>();

  let fence: string | null = null;
  let math = false;
  const front = frontMatter(lines);

  if (front) out.push(front);

  for (let i = front ? front.to + 1 : 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (noteLines.has(i)) {
      cut.flush();

      continue;
    }

    const f = FENCE.exec(line);

    if (fence) {
      if (closes(f, fence, line)) fence = null;

      cut.push(i, line);

      continue;
    }

    if (math) {
      if (/\$\$\s*$/.test(line)) math = false;

      cut.push(i, line);

      continue;
    }

    if (f) {
      if (!cut.run || !cut.run.lines.some((l) => l.trim())) cut.flush();

      fence = f[1] ?? null;
      cut.push(i, line);

      continue;
    }

    if (MATH_FENCE.test(line) && !/^\s*\$\$.+\$\$\s*$/.test(line)) {
      math = true;
      cut.push(i, line);

      continue;
    }

    const h = HEADING.exec(line);

    if (h) {
      cut.flush();
      cut.run = { from: i, lines: [line], anchor: anchorOf(seen, h[2] ?? "") };
      cut.flush();

      continue;
    }

    // A setext heading: one line of text, then === or ---.
    const only = cut.run?.lines.length === 1 ? cut.run.lines[0] : undefined;

    if (cut.run && SETEXT.test(line) && only?.trim() && !LIST.test(only) && !/^\s*>/.test(only)) {
      cut.run.lines.push(line);
      cut.run.anchor = anchorOf(seen, only.trim());
      cut.flush();

      continue;
    }

    const images = imageLine(line);

    if (images?.some((im) => isLocalSource(im.src))) {
      cut.flush();
      out.push({ kind: "images", images, from: i, to: i });

      continue;
    }

    if (REF.test(line)) {
      cut.flush();

      continue;
    }

    if (!line.trim()) {
      if (cut.run && continues(cut.run, lines, i)) {
        cut.push(i, line);

        continue;
      }

      cut.flush();

      continue;
    }

    // A list or quote right after a paragraph line starts its own block.
    if (cut.run?.lines.length && TASK.test(line) && !LIST.test(cut.run.lines[0] ?? "")) cut.flush();

    cut.push(i, imagesAsLinks(line));
  }

  cut.flush();

  if (notes.size) out.push(footnoteBlock(notes, numbers, number));

  return keyed(out);
}

/** The blocks being cut: the run of lines so far, and the blocks done. */
class Cut {
  readonly out: Unkeyed[] = [];
  run: LineRun | null = null;
  readonly refs: readonly string[];
  readonly number: (id: string) => number;

  constructor(refs: readonly string[], number: (id: string) => number) {
    this.refs = refs;
    this.number = number;
  }

  /** The run so far becomes a block (when it holds more than blank lines). */
  flush(): void {
    const run = this.run;

    if (run && run.lines.some((l) => l.trim())) {
      // Trailing blank lines aren't the block's.
      while (!(run.lines.at(-1) ?? "x").trim()) run.lines.pop();

      this.out.push(classify(run, this.refs, this.number));
    }

    this.run = null;
  }

  /** A line joins the run (one starts at `i`). */
  push(i: number, line: string): void {
    this.run ??= { from: i, lines: [] };
    this.run.lines.push(line);
  }
}

/** Footnote numbers by id, and the function that hands them out. */
interface Numbering {
  readonly numbers: ReadonlyMap<string, number>;
  readonly number: (id: string) => number;
}

/** Footnote numbers in the order they're first referenced. */
function numbering(): Numbering {
  const numbers = new Map<string, number>();

  const number = (id: string): number => {
    const known = numbers.get(id);

    if (known !== undefined) return known;

    const n = numbers.size + 1;

    numbers.set(id, n);

    return n;
  };

  return { numbers, number };
}

/** Front matter: a YAML block at the very top, shown as such. */
function frontMatter(lines: readonly string[]): Unkeyed | null {
  if (!/^---\s*$/.test(lines[0] ?? "")) return null;

  const end = lines.findIndex((l, j) => j > 0 && /^(---|\.\.\.)\s*$/.test(l));

  return end > 0 ? { kind: "md", text: fenced(lines.slice(1, end).join("\n")).replace(/^`+/, (m) => m + "yaml"), from: 0, to: end } : null;
}

/** A blank line at `i` ends the block unless what follows belongs to it: an
 *  indented continuation, or the next item of the same list. */
function continues(run: LineRun, lines: readonly string[], i: number): boolean {
  const next = lines.slice(i + 1).find((l) => l.trim());
  const inList = LIST.test(run.lines[0] ?? "");

  return next !== undefined && (INDENTED.test(next) || (inList && LIST.test(next)));
}

/** The footnotes block at the end: in the order they're referenced, numbered. */
function footnoteBlock(notes: ReadonlyMap<string, NoteDraft>, numbers: ReadonlyMap<string, number>, number: (id: string) => number): Unkeyed {
  const list = [...notes.values()].sort((a, b) => (numbers.get(a.id) ?? 1e9) - (numbers.get(b.id) ?? 1e9) || a.from - b.from);
  const drafts = list.map((n) => ({ ...n, text: footnoteRefs(imagesAsLinks(n.text), number) }));

  return {
    kind: "footnotes",
    notes: drafts.map((n) => ({ id: n.id, n: number(n.id), anchor: `fn-${slug(n.id)}`, text: n.text, from: n.from, to: n.to })),
    from: Math.min(...drafts.map((n) => n.from)),
    to: Math.max(...drafts.map((n) => n.to)),
  };
}

/** Each block's key: its kind and a hash of its text, numbered when two are alike. */
function keyed(out: readonly Unkeyed[]): Block[] {
  const count = new Map<string, number>();

  return out.map((p) => {
    const base = `${p.kind}-${hash(keyText(p))}`;
    const n = count.get(base) ?? 0;

    count.set(base, n + 1);

    return { ...p, key: n ? `${base}-${n}` : base };
  });
}

/** What a run of lines is: Markdown, a task list, a callout. */
export function classify(run: LineRun, refs: readonly string[], number: (id: string) => number): Unkeyed {
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

