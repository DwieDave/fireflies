// The files pane's file operations, the pure part: names typed into paths,
// what a rename or move may do, the delete question, the row after a delete,
// the folders a move takes along, git's errors cleaned, the trash probe and
// the one shell script (OPS) that does every operation.

import type { InputRange } from "gpui-base";
import { parent, base } from "./logic.ts";

/** `a/b` under `dir` (absolute); the root "/" without a double slash. */
export const join = (dir: string, name: string): string => (name ? (dir === "/" ? `/${name}` : `${dir}/${name}`) : dir);

/** `abs` relative to `root`: "" for the root itself, null outside it. */
export function relTo(root: string, abs: string): string | null {
  if (abs === root) return "";

  const pre = root === "/" ? "/" : `${root}/`;

  return abs.startsWith(pre) ? abs.slice(pre.length) : null;
}

/** A typed name that points somewhere, or why it doesn't. */
export type Resolved = { readonly abs: string; readonly folder: boolean; readonly error?: undefined } | { readonly error: string };

/** Where a typed name points, from the folder `dir` (absolute): a relative
 *  path, an absolute one, or `~/…` (`home`; null on another machine). `.` and
 *  `..` steps resolve; a trailing `/` makes it a folder. { abs, folder } or
 *  { error }. */
export function resolveName(dir: string, typed: string, home: string | null = null): Resolved {
  const text = typed;

  if (!text.trim()) return { error: "Type a name" };

  let start = dir;
  let rest = text;

  if (text.startsWith("/")) start = "/";
  else if (text === "~" || text.startsWith("~/")) {
    if (!home) return { error: "~ is this Mac's home: type the path" };

    start = home;
    rest = text.slice(1);
  }

  const parts = start.split("/").filter(Boolean);

  for (const s of rest.split("/")) {
    if (s === "..") parts.pop();
    else if (s && s !== ".") parts.push(s);
  }

  const last = text.split("/").filter(Boolean).pop() ?? "";

  if (!parts.length || last === "." || last === "..") return { error: `“${text}” isn't a name` };

  return { abs: `/${parts.join("/")}`, folder: text.endsWith("/") };
}

/** Where a rename lands, or why it can't. */
export type Target = { readonly abs: string; readonly error?: undefined } | { readonly error: string };

/** What a rename's text resolves to for `src` (absolute): a name or path
 *  from its folder; ending in `/`, into that folder under its own name. */
export function renameTarget(src: string, typed: string, home: string | null = null): Target {
  const r = resolveName(parent(src), typed, home);

  if (r.error !== undefined) return r;

  return { abs: r.folder ? join(r.abs, base(src)) : r.abs };
}

/** Why moving `src` to `dst` (both absolute) isn't allowed, or null. */
export function moveRefusal(src: string, dst: string, root: string): string | null {
  if (src === root) return "The tree's root can't be moved";

  if (dst === src) return "It's already there";

  if (dst.startsWith(`${src}/`)) return "A folder can't go into itself";

  return null;
}

/** The part of a name a rename selects: the stem, not the extension
 *  (`.env`, `Makefile`, a folder: all of it). UTF-16 offsets, as the input takes. */
export function stemRange(name: string, dir = false): InputRange {
  const dot = name.lastIndexOf(".");

  return { start: 0, end: dir || dot <= 0 ? name.length : dot };
}

/** The question before a delete: the item named, a folder's contents too,
 *  "permanently" where the machine has no trash. */
export function deleteQuestion(name: string, dir: boolean, trash: boolean): string {
  const what = dir ? `“${name}/” and everything in it` : `“${name}”`;

  return trash ? `Move ${what} to the Trash?` : `Delete ${what} permanently?`;
}

/** A row as `neighbour` and `rangePaths` read it. */
export interface Listed {
  readonly path: string;
  readonly head?: boolean | undefined;
  readonly draft?: boolean | undefined;
}

/** The row to select once `path` is deleted: the next one past it (and what
 *  it held), else the one before. */
export function neighbour(rows: readonly Listed[], path: string): string | null {
  const i = rows.findIndex((r) => r.path === path);

  if (i < 0) return null;

  const inside = (r: Listed): boolean => r.path === path || r.path.startsWith(`${path}/`);
  const next = rows.slice(i + 1).find((r) => !inside(r) && !r.head);

  if (next) return next.path;

  for (let j = i - 1; j >= 0; j--) {
    const r = rows[j];

    if (r && !r.head) return r.path;
  }

  return null;
}

/** Unfolded folders (relative paths) after `from` moved to `to` (null: out of the tree). */
export function movedFolders(folders: Iterable<string>, from: string, to: string | null): Set<string> {
  const out = new Set<string>();

  for (const f of folders) {
    if (f !== from && !f.startsWith(`${from}/`)) out.add(f);
    else if (to !== null) out.add(to + f.slice(from.length));
  }

  return out;
}

/** The folders to unfold so `rel` shows (its parents). */
export function parentsOf(rel: string): string[] {
  const parts = rel.split("/");

  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** A failed command's stderr as one line: macOS's trash wraps its reason in
 *  an NSError dump; the shell's "sh: line 1:" goes. */
export function cleanError(stderr: string): string {
  const s = stderr.trim();
  const ns = /Code=\d+ "(.+?)" UserInfo/.exec(s);

  if (ns?.[1] !== undefined) return ns[1];

  const line = s.split("\n").filter(Boolean).pop() ?? "";

  return line.replace(/^(sh|files-op): (line \d+: )?/, "") || "It didn't work";
}

/** The machine's trash, run as `sh -c PROBE files-trash-probe`: its path
 *  (macOS's /usr/bin/trash; gio or trash-cli's trash-put elsewhere), or
 *  nothing (deletes are permanent there). */
export const PROBE = `if [ "$(uname)" = Darwin ]; then [ -x /usr/bin/trash ] && echo /usr/bin/trash; exit 0; fi
command -v gio >/dev/null 2>&1 && gio trash --help >/dev/null 2>&1 && { command -v gio; exit 0; }
command -v trash-put 2>/dev/null; exit 0`;

/** Every operation, as `sh -c OPS files-op <op> <paths…>` (paths absolute,
 *  each its own argument; -- before them, except macOS's trash, which
 *  takes no options marker and trashes a file named "--" instead).
 *  Exit 3: the target exists; 4: the source is gone; 5: the trash left it.
 *  Nothing is overwritten: new files with noclobber, moves with mv -n and a
 *  check that the source went. */
export const OPS = `op=$1; shift
gone() { [ ! -e "$1" ] && [ ! -L "$1" ]; }
up() { mkdir -p -- "$(dirname -- "$1")"; }
case $op in
file) gone "$1" || exit 3; up "$1" && (set -C; : > "$1") ;;
folder) gone "$1" || exit 3; up "$1" && mkdir -- "$1" ;;
move) gone "$1" && exit 4
  if [ "$1" -ef "$2" ]; then mv -- "$1" "$2"; exit; fi
  gone "$2" || exit 3
  up "$2" && mv -n -- "$1" "$2" || exit
  gone "$1" || exit 3 ;;
delete) gone "$2" && exit 4
  case \${1##*/} in
  trash) "$1" "$2" || exit ;;
  gio) "$1" trash -- "$2" || exit ;;
  trash-put) "$1" -- "$2" || exit ;;
  *) rm -r -- "$2" </dev/null || exit ;;
  esac
  gone "$2" || exit 5 ;;
*) echo "unknown operation $op" >&2; exit 2 ;;
esac`;
