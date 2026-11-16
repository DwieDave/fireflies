// Where the viewer's links and images go, as plain functions (no app calls),
// so scripts/markdown.test.ts can check them. The Markdown viewer and the
// editor import it (`@fireflies/markdown/paths`).

import { Array as Arr, Option, String as Str } from "effect";

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
export const dirname = (p: string): string => Str.replace(/\/[^/]*$/, "")(p) || "/";

/** The last part of a path. */
export const basename = (p: string): string => {
  const last = Arr.lastNonEmpty(Str.split(Str.replace(/\/+$/, "")(p), "/"));

  return Str.isEmpty(last) ? p : last;
};

/** `rel` against folder `dir`, with `.` and `..` folded away. */
export function join(dir: string, rel: string): string {
  const parts = Str.split(Str.startsWith("/")(rel) ? rel : `${dir}/${rel}`, "/");
  const out: string[] = [];

  for (const part of parts) {
    if (Str.isEmpty(part) || part === ".") continue;

    if (part === "..") out.pop();
    else out.push(part);
  }

  return "/" + Arr.join(out, "/");
}

/**
 * `s` with its %-escapes decoded; as written when one is malformed (a lone
 * `%` in a file name is a character, not an escape: the link still goes
 * somewhere).
 */
function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** What a link `href` in the document at `file` does, or null (nothing to follow). */
export function follow(href: string | null | undefined, file: string): Link | null {
  const url = Str.trim(href ?? "");

  if (Str.isEmpty(url)) return null;

  if (Str.startsWith("#")(url)) return url.length > 1 ? { kind: "anchor", anchor: Str.toLowerCase(decode(Str.slice(1)(url))) } : null;

  if (/^https?:\/\//i.test(url)) return { kind: "web", url };

  let path = url;

  if (/^file:/i.test(url)) path = Str.replace(/^file:(\/\/(localhost)?)?/i, "")(url);
  else if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return { kind: "other", url };

  const hash = Str.indexOf("#")(path);
  const anchor = Option.match(hash, { onNone: () => "", onSome: (at) => Str.toLowerCase(decode(Str.slice(at + 1)(path))) });

  path = decode(Str.replace(/\?.*$/, "")(Option.match(hash, { onNone: () => path, onSome: (at) => Str.slice(0, at)(path) })));

  if (Str.isEmpty(path)) return Str.isEmpty(anchor) ? null : { kind: "anchor", anchor };

  const full = Str.startsWith("/")(path) ? join("/", path) : join(dirname(file), path);

  if (isMarkdown(full)) return Str.isEmpty(anchor) ? { kind: "markdown", path: full } : { kind: "markdown", path: full, anchor };

  return { kind: "file", path: full };
}

/** A path with the home folder as `~`. */
export function tilde(path: string | null | undefined, home: string | null | undefined): string {
  if (path === null || path === undefined || Str.isEmpty(path) || home === null || home === undefined || Str.isEmpty(home)) return path ?? "";

  return path === home ? "~" : Str.startsWith(home + "/")(path) ? "~" + Str.slice(home.length)(path) : path;
}
