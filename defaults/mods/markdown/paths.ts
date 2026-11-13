// Where the viewer's links and images go, as plain functions (no app calls),
// so scripts/markdown.test.ts can check them. The editor ships the same file
// (a mod can't import another's files); scripts/markdown.test.ts fails when
// the copies differ: edit one, copy it over.

/** What a link does (follow()). */
export type Link =
  /** A heading in this document. */
  | { readonly kind: "anchor"; readonly anchor: string }
  /** Another Markdown file: the viewer goes there (to its heading `anchor`). */
  | { readonly kind: "markdown"; readonly path: string; readonly anchor?: string }
  /** Another local file: the system opens it. */
  | { readonly kind: "file"; readonly path: string }
  /** http(s): the app opens it (settings `links`). */
  | { readonly kind: "web"; readonly url: string }
  /** mailto: and the like: the system. */
  | { readonly kind: "other"; readonly url: string };

/** Whether a path names a Markdown file. */
export const isMarkdown = (path: string | null | undefined): boolean => /\.(md|markdown)$/i.test(path ?? "");

/** The folder holding a path ("/" for a file at the top). */
export const dirname = (p: string): string => p.replace(/\/[^/]*$/, "") || "/";

/** The last part of a path. */
export const basename = (p: string): string => p.replace(/\/+$/, "").split("/").pop() || p;

/** `rel` against folder `dir`, with `.` and `..` folded away. */
export function join(dir: string, rel: string): string {
  const parts = (rel.startsWith("/") ? rel : `${dir}/${rel}`).split("/");
  const out: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") continue;

    if (part === "..") out.pop();
    else out.push(part);
  }

  return "/" + out.join("/");
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** What a link `href` in the document at `file` does, or null (nothing to follow). */
export function follow(href: string | null | undefined, file: string): Link | null {
  const url = (href ?? "").trim();

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

  if (isMarkdown(full)) return anchor ? { kind: "markdown", path: full, anchor } : { kind: "markdown", path: full };

  return { kind: "file", path: full };
}

/** A path with the home folder as `~`. */
export function tilde(path: string | null | undefined, home: string | null | undefined): string {
  if (!path || !home) return path ?? "";

  return path === home ? "~" : path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}
