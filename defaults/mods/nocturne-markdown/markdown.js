// Markdown in Nocturne's look: the GitHub window's PR bodies and comments,
// and the Markdown viewer. Shared by nocturne-github and nocturne-markdown.
// A mod can import only its own files, so each of them ships this same file;
// scripts/markdown.test.ts fails when the copies differ: edit
// nocturne-markdown/markdown.js and copy it over.

import { div } from "gpui-kit";
import { TextView } from "gpui-base";

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
const REF = /^ {0,3}\[[^\]]+\]:[ \t]*\S/;
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

/** A document cut into blocks the viewer draws one by one: Markdown runs
 *  (each heading starts one, so anchors know where they are) and lines of
 *  local images (TextView only fetches web images). Reference definitions
 *  are copied into every run so `[text][ref]` still resolves.
 *  -> [{ kind: "md", text, anchor? } | { kind: "images", images: [{ alt, src }] }] */
export function blocks(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const refs = [];
  let fence = null;
  for (const line of lines) {
    const f = FENCE.exec(line);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null; continue; }
    if (f) { fence = f[1]; continue; }
    if (REF.test(line)) refs.push(line);
  }
  const out = [], seen = new Map();
  let run = null;
  const flush = () => {
    if (run && run.lines.some((l) => l.trim())) {
      out.push({ kind: "md", text: [...run.lines, ...(refs.length ? ["", ...refs] : [])].join("\n"), ...(run.anchor ? { anchor: run.anchor } : {}) });
    }
    run = null;
  };
  fence = null;
  for (const line of lines) {
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null;
      (run ??= { lines: [] }).lines.push(line);
      continue;
    }
    if (f) { fence = f[1]; (run ??= { lines: [] }).lines.push(line); continue; }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      const base = slug(h[2] ?? "");
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      run = { lines: [line], anchor: n ? `${base}-${n}` : base };
      continue;
    }
    const images = imageLine(line);
    if (images && images.some((i) => isLocalSource(i.src))) {
      flush();
      out.push({ kind: "images", images });
      continue;
    }
    if (REF.test(line)) continue;
    (run ??= { lines: [] }).lines.push(imagesAsLinks(line));
  }
  flush();
  return out;
}
