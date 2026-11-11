// The links a Markdown run holds, in reading order, for tab / enter in the
// viewer (TextView draws them, but can't say where they are). No herdr
// imports: scripts/nocturne-markdown.test.ts checks them.

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
const plain = (s) => String(s).replace(/\\(.)/g, "$1").replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim();

/** `[{ text, href }]` in the order they read; code (fenced and `inline`) holds none. */
export function linksOf(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const defs = new Map(), prose = [];
  let fence = null;
  for (const line of lines) {
    const f = FENCE.exec(line);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; continue; }
    if (f) { fence = f[1]; continue; }
    const d = DEF.exec(line);
    if (d) { const key = d[1].toLowerCase(); if (!defs.has(key)) defs.set(key, d[2]); continue; }
    prose.push(line.replace(/(`+)[\s\S]*?\1/g, (m) => " ".repeat(m.length)));
  }
  const out = [];
  for (const m of prose.join("\n").matchAll(LINK)) {
    if (m[1] != null) out.push({ text: plain(m[1]), href: m[2] });
    else if (m[3] != null) {
      const href = defs.get((m[4] || m[3]).toLowerCase());
      if (href) out.push({ text: plain(m[3]), href });
    } else if (m[5] != null) out.push({ text: m[5], href: m[5] });
    else if (m[6] != null) out.push({ text: m[6], href: /^www\./i.test(m[6]) ? `https://${m[6]}` : m[6] });
    else if (m[7] != null) {
      const href = defs.get(m[7].toLowerCase());
      if (href) out.push({ text: plain(m[7]), href });
    }
  }
  return out;
}

/** Every link of a document's blocks (markdown.js `blocks`), each with its
 *  block's index: `{ text, href, part, image? }`. A line of images gives one
 *  entry per image. */
export function documentLinks(parts) {
  return parts.flatMap((p, part) => p.kind === "images"
    ? p.images.map((img) => ({ text: img.alt || img.src, href: img.src, part, image: true }))
    : linksOf(p.text).map((l) => ({ ...l, part })));
}

/** The next link from `at` (null: none chosen yet: going down, the first one
 *  in or after block `from`; going up, the last one in or before it), `dir`
 *  ±1, wrapping round. */
export function nextLink(links, at, dir, from = 0) {
  if (!links.length) return null;
  if (at == null || at < 0 || at >= links.length) {
    const i = dir > 0 ? links.findIndex((l) => l.part >= from) : links.findLastIndex((l) => l.part <= from);
    return i >= 0 ? i : dir > 0 ? 0 : links.length - 1;
  }
  return (at + dir + links.length) % links.length;
}

/** The heading block after (dir 1) or before (-1) block `at`, or null. */
export function nextHeading(parts, at, dir) {
  if (dir > 0) { for (let i = at + 1; i < parts.length; i++) if (parts[i].anchor) return i; return null; }
  for (let i = at - 1; i >= 0; i--) if (parts[i].anchor) return i;
  return null;
}
