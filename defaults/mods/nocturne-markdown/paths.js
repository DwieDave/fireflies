// Where the viewer's links and images go, as plain functions (no app calls),
// so scripts/nocturne-markdown.test.ts can check them.

/** Whether a path names a Markdown file. */
export const isMarkdown = (path) => /\.(md|markdown)$/i.test(String(path ?? ""));

/** The folder holding a path ("/" for a file at the top). */
export const dirname = (p) => String(p).replace(/\/[^/]*$/, "") || "/";

/** The last part of a path. */
export const basename = (p) => String(p).replace(/\/+$/, "").split("/").pop() || String(p);

/** `rel` against folder `dir`, with `.` and `..` folded away. */
export function join(dir, rel) {
  const parts = (rel.startsWith("/") ? rel : `${dir}/${rel}`).split("/");
  const out = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

function decode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** What a link in the document at `file` does:
 *  { kind: "anchor", anchor }                 a heading in this document
 *  { kind: "markdown", path, anchor? }        another Markdown file: this viewer goes there
 *  { kind: "file", path }                     another local file: the system opens it
 *  { kind: "web", url }                       http(s): the app opens it (settings `links`)
 *  { kind: "other", url }                     mailto: and the like: the system
 *  null                                       nothing to follow */
export function follow(href, file) {
  const url = String(href ?? "").trim();
  if (!url) return null;
  if (url.startsWith("#")) return url.length > 1 ? { kind: "anchor", anchor: decode(url.slice(1)).toLowerCase() } : null;
  if (/^https?:\/\//i.test(url)) return { kind: "web", url };
  let path = url;
  if (/^file:/i.test(url)) path = url.replace(/^file:(\/\/(localhost)?)?/i, "");
  else if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return { kind: "other", url };
  const hash = path.indexOf("#");
  const anchor = hash >= 0 ? decode(path.slice(hash + 1)).toLowerCase() : "";
  path = decode((hash >= 0 ? path.slice(0, hash) : path).replace(/\?.*$/, ""));
  if (!path) return anchor ? { kind: "anchor", anchor } : null;
  const full = path.startsWith("/") ? join("/", path) : join(dirname(file), path);
  if (isMarkdown(full)) return { kind: "markdown", path: full, ...(anchor ? { anchor } : {}) };
  return { kind: "file", path: full };
}

/** A path with the home folder as `~`. */
export function tilde(path, home) {
  if (!path || !home) return path ?? "";
  return path === home ? "~" : path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}
