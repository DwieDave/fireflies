// The links a Markdown run holds, in reading order, for tab / enter in the
// viewer (TextView draws them, but can't say where they are). No herdr
// imports: scripts/markdown.test.ts checks them.

import type { Block } from "./markdown.ts";

/** A link as read: its text and where it goes. */
export interface TextLink {
  readonly text: string;
  readonly href: string;
}

/** A link of a document: the index of its block, and whether it's a picture. */
export type DocLink = TextLink & { readonly part: number; readonly image?: true };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DEF = /^ {0,3}\[([^\]]+)\]:[ \t]*<?([^\s>]+)>?/;

// One pass, earliest match first: an image (skipped), [text](url "title"),
// [text][ref] / [text][], <scheme:...>, a bare web address, [ref].
const LINK = new RegExp([
  /!\[[^\]]*\]\([^)]*\)/.source,
  /\[((?:[^\]\\]|\\.)+)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/.source,
  /\[((?:[^\]\\]|\\.)+)\]\[([^\]]*)\]/.source,
  /<((?:https?|mailto|ftp):[^>\s]+)>/.source,
  /\b((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"*_~])/.source,
  /\[((?:[^\]\\]|\\.)+)\]/.source,
].join("|"), "gi");

/** Link text as read: marks and escapes dropped. */
const plain = (s: string): string => s.replace(/\\(.)/g, "$1").replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim();

/** `[{ text, href }]` in the order they read; code (fenced and `inline`) holds none. */
export function linksOf(text: string): TextLink[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const defs = new Map<string, string>();
  const prose: string[] = [];
  let fence: string | null = null;

  for (const line of lines) {
    const mark = FENCE.exec(line)?.[1];

    if (fence !== null) {
      if (mark !== undefined && mark[0] === fence[0] && mark.length >= fence.length) fence = null;

      continue;
    }

    if (mark !== undefined) {
      fence = mark;

      continue;
    }

    const d = DEF.exec(line);
    const name = d?.[1];
    const target = d?.[2];

    if (name !== undefined && target !== undefined) {
      const key = name.toLowerCase();

      if (!defs.has(key)) defs.set(key, target);

      continue;
    }

    prose.push(line.replace(/(`+)[\s\S]*?\1/g, (m) => " ".repeat(m.length)));
  }

  const out: TextLink[] = [];

  for (const m of prose.join("\n").matchAll(LINK)) {
    const [, inline, url, refText, ref, auto, bare, short] = m;

    if (inline !== undefined && url !== undefined) out.push({ text: plain(inline), href: url });
    else if (refText !== undefined) {
      const href = defs.get((ref || refText).toLowerCase());

      if (href) out.push({ text: plain(refText), href });
    } else if (auto !== undefined) out.push({ text: auto, href: auto });
    else if (bare !== undefined) out.push({ text: bare, href: /^www\./i.test(bare) ? `https://${bare}` : bare });
    else if (short !== undefined) {
      const href = defs.get(short.toLowerCase());

      if (href) out.push({ text: plain(short), href });
    }
  }

  return out;
}

/** The text a block's links are read from. */
function textOf(p: Block): string {
  switch (p.kind) {
    case "md":
    case "callout":
      return p.text;
    case "tasks":
      return p.items.map((x) => x.text).join("\n");
    case "footnotes":
      return p.notes.map((x) => x.text).join("\n");
    case "images":
      return "";
  }
}

/** Every link of a document's blocks (markdown.ts `blocks`), each with its
 *  block's index: `{ text, href, part, image? }`. A line of images gives one
 *  entry per image. */
export function documentLinks(parts: readonly Block[]): DocLink[] {
  return parts.flatMap((p, part): DocLink[] => (p.kind === "images"
    ? p.images.map((img) => ({ text: img.alt || img.src, href: img.src, part, image: true }))
    : linksOf(textOf(p)).map((l) => ({ ...l, part }))));
}

/** The index of the last item of `list` that `test` holds for, else -1. */
export function lastIndex<T>(list: readonly T[], test: (item: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i];

    if (item !== undefined && test(item)) return i;
  }

  return -1;
}

/** The next link from `at` (null: none chosen yet: going down, the first one
 *  in or after block `from`; going up, the last one in or before it), `dir`
 *  ±1, wrapping round. */
export function nextLink(links: readonly DocLink[], at: number | null, dir: number, from = 0): number | null {
  if (!links.length) return null;

  if (at === null || at < 0 || at >= links.length) {
    const i = dir > 0 ? links.findIndex((l) => l.part >= from) : lastIndex(links, (l) => l.part <= from);

    if (i >= 0) return i;

    return dir > 0 ? 0 : links.length - 1;
  }

  return (at + dir + links.length) % links.length;
}

/** A block's heading anchor, when it starts with a heading. */
export const anchorOf = (p: Block | undefined): string | undefined => (p?.kind === "md" ? p.anchor : undefined);

/** The heading block after (dir 1) or before (-1) block `at`, or null. */
export function nextHeading(parts: readonly Block[], at: number, dir: number): number | null {
  if (dir > 0) {
    for (let i = at + 1; i < parts.length; i++) if (anchorOf(parts[i])) return i;

    return null;
  }

  for (let i = at - 1; i >= 0; i--) if (anchorOf(parts[i])) return i;

  return null;
}
