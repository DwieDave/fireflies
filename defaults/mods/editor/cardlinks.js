// The links in a hover card (the server's Markdown), as plain functions so
// scripts/editor-links.test.ts checks them: which links a card holds
// and where each goes. rust-analyzer links its docs to doc.rust-lang.org /
// docs.rs; TypeScript's {@link} points at `file:///…/x.ts#L12%2C5`; others
// write relative paths or `path:12:5`.

import { follow } from "./paths.js";

/** A link's words without Markdown's marks (`code`, *emphasis*). */
function plain(label) {
  // Emphasis marks only at a word's edge: `with_capacity` keeps its underscore.
  return String(label ?? "").replace(/`/g, "").replace(/(^|\s)[*_]+|[*_]+(?=\s|$)/g, "$1").replace(/\s+/g, " ").trim();
}

/** The links in a card's parts (hoverParts: `{ text }` paragraphs and
 *  `{ code }` blocks; only the text has links): inline `[label](url)` (not
 *  images), reference definitions `[label]: url`, `<url>` and bare http(s)
 *  addresses; each address once, in order. -> [{ label, url }] */
export function cardLinks(parts) {
  const out = [], seen = new Set();
  const add = (label, url) => {
    const u = String(url ?? "").trim().replace(/^<|>$/g, "");
    if (!u || u.startsWith("#") || seen.has(u)) return;
    seen.add(u);
    out.push({ label: label === url ? u : plain(label) || u, url: u });
  };
  for (const p of parts ?? []) {
    if (p?.text == null) continue;
    const t = String(p.text);
    const found = [];
    for (const m of t.matchAll(/(!?)\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/g)) if (!m[1]) found.push([m.index, m[2], m[3]]);
    for (const m of t.matchAll(/^[ \t]*\[([^\]]+)\]:[ \t]*(\S+)/gm)) found.push([m.index, m[1], m[2]]);
    for (const m of t.matchAll(/<((?:https?|file):\/\/[^>\s]+)>/g)) found.push([m.index, m[1], m[1]]);
    for (const m of t.matchAll(/(^|[^(<[\w/])(https?:\/\/[^\s<>()[\]]*[^\s<>()[\].,;:!?'"`])/g)) found.push([m.index + m[1].length, m[2], m[2]]);
    for (const [, label, url] of found.sort((a, b) => a[0] - b[0])) add(label, url);
  }
  return out;
}

/** Where a card's link goes, from the file the card is in:
 *  { kind: "web", url }                     http(s): a browser pane
 *  { kind: "file", path, line?, col? }      a file (file:// or a path; `#L12`,
 *                                           `#L12,5`, `#L12%2C5` or `:12:5`
 *                                           give its place, one-based): a tab
 *  { kind: "other", url }                   mailto: and the like: the system
 *  null                                     nothing to follow (an anchor) */
export function linkTarget(url, from) {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  // A place written after the path (`src/a.rs:12:5`), before follow() reads it as a scheme or a name.
  let place = null, href = raw;
  const tail = raw.match(/^(.*[^:\d]):(\d+)(?::(\d+))?$/);
  if (tail && !/^[a-z][a-z0-9+.-]*:\/\/[^/]*$/i.test(tail[1])) { href = tail[1]; place = { line: Number(tail[2]), col: tail[3] ? Number(tail[3]) : null }; }
  const to = follow(href, from ?? "/");
  if (!to || to.kind === "anchor") return null;
  if (to.kind === "web" || to.kind === "other") return { kind: to.kind, url: to.url };
  // `#L12`, `#L12,5`, `#L12%2C5`, `#L12C5`.
  let hash = href.includes("#") ? href.slice(href.indexOf("#") + 1) : "";
  try { hash = decodeURIComponent(hash); } catch { /* as written */ }
  const m = hash.match(/^L(\d+)(?:[,:C](\d+))?/i);
  if (m) place = { line: Number(m[1]), col: m[2] ? Number(m[2]) : null };
  return { kind: "file", path: to.path, line: place?.line ?? null, col: place?.col ?? null };
}

/** The short "where" beside a link's words: a web page's host, a file's name and line. */
export function linkWhere(to) {
  if (!to) return "";
  if (to.kind === "web") { try { return new URL(to.url).host; } catch { return to.url; } }
  if (to.kind === "file") return `${to.path.split("/").pop()}${to.line ? `:${to.line}` : ""}`;
  return to.url.split(":")[0];
}
