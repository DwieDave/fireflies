// What the files pane decides without drawing: which entries its filters
// keep, git's ignored list, search results grouped under their folders, the
// right-click menu and how Neovim opens a file or folder. main.ts draws.

import type { InputRange } from "gpui-base";
import type { PaneInfo, Settings } from "herdr";
import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, nullable, object } from "./guard.ts";
import type { KeyRow } from "./keyhelp.ts";

export const parent = (p: string): string => p.replace(/\/[^/]+$/, "") || "/";

export const base = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

export const dirOf = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** A `[start, end)` range of characters (fff's or fuzzy's matched characters). */
export type Range = readonly [number, number];

/** What a pane lists: dotfiles, git-ignored files. */
export interface Filters {
  readonly hidden: boolean;
  readonly ignored: boolean;
}

/** A pane's filters as kept in shared `file-tree.filters` (an older entry may have one of them). */
export const isFilters = object({}, { hidden: isBoolean, ignored: isBoolean });

/** settings.json `files`: what a new pane lists. Unset, dotfiles and
 *  git-ignored files are left out (H and I show them; the chips count them). */
export function filterDefaults(settings: Partial<Pick<Settings, "files">> | null | undefined): Filters {
  const f = settings?.files;

  return { hidden: f?.hidden === true, ignored: f?.ignored === true };
}

/** `git ls-files -z --others --ignored --exclude-standard --directory` (run in
 *  the root) as a set of paths relative to the root; folders without their "/". */
export function parseIgnored(stdout: string): Set<string> {
  return new Set(stdout.split("\0").flatMap((p) => (p ? [p.replace(/\/$/, "")] : [])));
}

/** Whether git ignores `path` (relative to the root): it, or a folder it's in, is listed. */
export function isIgnored(path: string, ignored: ReadonlySet<string> | null): boolean {
  if (!ignored?.size) return false;

  for (let p = path; p; p = dirOf(p)) if (ignored.has(p)) return true;

  return false;
}

/** Any part of the path starts with a dot. */
export const isHidden = (path: string): boolean => path.split("/").some((s) => s.startsWith("."));

/** Whether a pane with these filters lists `path` (relative to the root). */
export function lists(path: string, filters: Filters, ignored: ReadonlySet<string> | null): boolean {
  if (!filters.hidden && isHidden(path)) return false;

  if (!filters.ignored && isIgnored(path, ignored)) return false;

  return true;
}

/** Characters of `text` matching `query` in order, case-insensitively (the
 *  search's fallback where the index can't go): [start, end) ranges, or null. */
export function fuzzy(query: string, text: string): [number, number][] | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  const s = text.toLowerCase();

  if (!q) return [];

  // Prefer the match in the name: search from the last part's start first.
  const tryFrom = (from: number): [number, number][] | null => {
    const out: [number, number][] = [];
    let i = from;

    for (const c of q) {
      const at = s.indexOf(c, i);

      if (at < 0) return null;

      const last = out.at(-1);

      if (last && last[1] === at) last[1] = at + 1;
      else out.push([at, at + 1]);

      i = at + 1;
    }

    return out;
  };

  return tryFrom(text.lastIndexOf("/") + 1) ?? tryFrom(0);
}

/** A row of the list: where it is (relative to the root), its name, a folder or not, how deep. */
interface RowBase {
  readonly path: string;
  readonly name: string;
  readonly dir: boolean;
  readonly depth: number;
}

/** A row of the tree: an entry of a listed folder (`ignored`: git ignores it). */
export interface TreeRow extends RowBase {
  readonly ignored: boolean;
  readonly head?: undefined;
  readonly hit?: undefined;
  readonly draft?: undefined;
  readonly ranges?: undefined;
  readonly git?: undefined;
}

/** A search's folder line: its hits are under it. */
export interface HeadRow extends RowBase {
  readonly dir: true;
  readonly head: true;
  readonly ignored?: undefined;
  readonly hit?: undefined;
  readonly draft?: undefined;
  readonly ranges?: undefined;
  readonly git?: undefined;
}

/** A search's hit: a file, its matched characters in its name, its git state. */
export interface HitRow extends RowBase {
  readonly dir: false;
  readonly hit: true;
  readonly ranges: readonly Range[];
  readonly git: string | null;
  readonly ignored?: undefined;
  readonly head?: undefined;
  readonly draft?: undefined;
}

/** The new file's or folder's name input, where it will appear. */
export interface DraftRow extends RowBase {
  readonly draft: true;
  readonly ignored?: undefined;
  readonly head?: undefined;
  readonly hit?: undefined;
  readonly ranges?: undefined;
  readonly git?: undefined;
}

/** A row the list shows. */
export type Row = TreeRow | HeadRow | HitRow | DraftRow;

/** What a search finds: a file (relative to the root), its matched characters, its git state. */
export interface Found {
  readonly path: string;
  readonly ranges?: readonly Range[];
  readonly git?: string | null;
}

/** Search hits ({ path, ranges, git }, best first) as rows: each folder once,
 *  where its best hit ranks, its hits under it; files at the root stand alone.
 *  `ranges` move onto the name. */
export function grouped(files: readonly Found[]): (HeadRow | HitRow)[] {
  const groups = new Map<string, Found[]>();

  for (const f of files) {
    const dir = dirOf(f.path);
    const list = groups.get(dir);

    if (list) list.push(f);
    else groups.set(dir, [f]);
  }

  const rows: (HeadRow | HitRow)[] = [];

  for (const [dir, hits] of groups) {
    if (dir) rows.push({ path: dir, name: dir, dir: true, depth: 0, head: true });

    for (const f of hits) {
      const cut = dir ? dir.length + 1 : 0;
      const ranges = (f.ranges ?? []).flatMap(([a, b]): Range[] => (b - cut > Math.max(0, a - cut) ? [[Math.max(0, a - cut), b - cut]] : []));

      rows.push({ path: f.path, name: base(f.path), dir: false, depth: dir ? 1 : 0, ranges, git: f.git ?? null, hit: true });
    }
  }

  return rows;
}

/** Neovim's argv and the folder it starts in. */
export interface Launch {
  readonly argv: readonly string[];
  readonly folder: string;
}

/** Neovim on a file (in its folder) or in a folder (`nvim .` there). */
export function nvimLaunch(abs: string, dir: boolean): Launch {
  return dir ? { argv: ["nvim", "."], folder: abs } : { argv: ["nvim", abs], folder: parent(abs) };
}

/** What a menu entry does (the pane's `act`). */
export type Act = "toggle" | "pane" | "root" | "edit" | "nvim" | "open" | "viewer" | "web" | "other" | "terminal"
  | "new-file" | "new-folder" | "rename" | "cut" | "paste" | "delete" | "copy" | "look" | "close"
  | "delete-set" | "cut-set" | "copy-set" | "unmark";

/** A menu entry: its key, what it says, what it does. */
export interface MenuItem {
  readonly key: string;
  readonly label: string;
  readonly act: Act;
}

/** What a menu is for: a row (`path` "" is the root, the empty space). */
export interface MenuTarget {
  readonly path: string;
  readonly dir: boolean;
}

/** What the menu offers besides the row's own entries. */
export interface MenuOptions {
  readonly pane?: boolean;
  readonly clip?: boolean;
  readonly look?: boolean;
  readonly web?: boolean;
  readonly viewer?: boolean;
}

/** The right-click menu for a row: [{ key, label, act }], `act` naming the
 *  pane's action. Folders and files differ; the root (empty space, `path` "")
 *  can't fold, reroot, be renamed, cut or deleted. `pane`: a pane of its own
 *  (it closes); `clip`: something is cut (paste shows); `look`: the preview
 *  split is open (its entry hides it); `viewer`: the file has a viewer pane
 *  (Markdown, the preview's kinds). */
export function menuItems(row: MenuTarget, { pane = false, clip = false, look = false, web = true, viewer = false }: MenuOptions = {}): MenuItem[] {
  const root = row.dir && !row.path;

  const items: MenuItem[] = row.dir
    ? [
        ...(root ? [] : [{ key: "enter", label: "Fold / unfold", act: "toggle" } as const]),
        { key: "o", label: "Open in a new files pane", act: "pane" },
        ...(root ? [] : [{ key: ".", label: "Root the tree here", act: "root" } as const]),
        { key: "e", label: "Open in $EDITOR", act: "edit" },
        { key: "v", label: "Open in Neovim", act: "nvim" },
      ]
    : [
        { key: "enter", label: "Open", act: "open" },
        // A file with a viewer pane (Markdown, a picture, a PDF): there, beside, instead of a tab of the editor.
        ...(viewer ? [{ key: "p", label: "Open in its viewer pane", act: "viewer" } as const] : []),
        ...(web && isHtml(row.path) ? [{ key: "w", label: "Open in a web pane", act: "web" } as const] : []),
        { key: "e", label: "Edit as text", act: "other" },
        { key: "E", label: "Open in $EDITOR", act: "terminal" },
        { key: "v", label: "Open in Neovim", act: "nvim" },
      ];

  const where = root ? "" : row.dir ? " in it" : " beside it";

  items.push({ key: "a", label: `New file${where}`, act: "new-file" }, { key: "A", label: `New folder${where}`, act: "new-folder" });

  if (!root) items.push({ key: "R", label: "Rename / move", act: "rename" }, { key: "x", label: "Cut", act: "cut" });

  if (clip) items.push({ key: "P", label: row.dir ? (root ? "Paste here" : "Paste in it") : "Paste beside it", act: "paste" });

  if (!root) items.push({ key: "d", label: "Delete…", act: "delete" });

  items.push({ key: "y", label: "Copy path", act: "copy" });
  items.push({ key: "space", label: look ? "Hide the preview" : "Show the preview", act: "look" });

  if (pane) items.push({ key: "q", label: "Close this pane", act: "close" });

  return items;
}

// ---- a page in the web pane

/** An HTML page: w (and the menu's "Open in a web pane") shows it in browser. */
export const isHtml = (path: string): boolean => /\.html?$/i.test(path);

/** A local file's file:// URL, each part of its path percent-encoded. */
export const fileUrl = (abs: string): string => `file://${abs.split("/").map(encodeURIComponent).join("/")}`;

/** A web pane's props: its slot (browser.open's target). */
const isSlotted = object({ slot: isString });

/** What `w` runs: browser.open on a web pane, or a new web pane split beside. */
export type WebRun = readonly [name: string] | readonly [name: "pane.split", args: SplitArgs];

/** pane.split's arguments for a new web pane. */
export type SplitArgs = {
  readonly direction: "auto";
  readonly pane?: string;
  readonly mod: "browser";
  readonly props: { readonly url: string; readonly slot: string };
};

/** Where `w` sends a page from: the shown tab's web panes, the files pane, a new pane's slot. */
export interface WebFrom {
  readonly browsers?: readonly Pick<PaneInfo, "props">[];
  readonly from?: string | null;
  readonly slot: string;
}

/** Where `w` sends a page: the shown tab's web pane (a new front tab in it,
 *  browser.open), else a new web pane split beside `from` (the files
 *  pane; with none, the focused one). `browsers`: browser panes in
 *  the shown tab; `slot`: a new pane's. A run() call as [name, args]. */
export function webOpen(url: string, { browsers = [], from = null, slot }: WebFrom): WebRun {
  for (const b of browsers) {
    if (isSlotted(b.props) && b.props.slot) return [`browser.open:${JSON.stringify({ url, slot: b.props.slot })}`];
  }

  return ["pane.split", from ? { direction: "auto", pane: from, mod: "browser", props: { url, slot } } : { direction: "auto", mod: "browser", props: { url, slot } }];
}

// ---- file operations: names, paths, the shell that does them

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
interface Listed {
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

/** A piece of text and whether it matched. */
export type Mark = readonly [piece: string, matched: boolean];

/** `text` cut into [piece, matched] runs by `ranges`, for drawing the matched characters apart. */
export function marks(text: string, ranges: readonly Range[]): Mark[] {
  const out: Mark[] = [];
  let at = 0;

  for (const [s0, e0] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const s = Math.max(s0, at);
    const e = Math.min(e0, text.length);

    if (e <= s) continue;

    if (s > at) out.push([text.slice(at, s), false]);

    out.push([text.slice(s, e), true]);
    at = e;
  }

  if (at < text.length) out.push([text.slice(at), false]);

  return out;
}

/** The menu's key column width (layout px, before zoom): its widest key at 7 px a character, plus room. */
export const keyColumn = (items: readonly { readonly key: string }[]): number => Math.max(30, ...items.map((x) => x.key.length * 7 + 14));

// ---- the folders visited: back and forward

/** The folders visited: back (oldest first) and forward (the next last). */
export interface Nav {
  readonly past: readonly string[];
  readonly future: readonly string[];
}

/** Where a step goes, and the history after it. */
export interface NavStep {
  readonly to: string;
  readonly nav: Nav;
}

/** No folders visited yet. */
export const newNav = (): Nav => ({ past: [], future: [] });

/** Going to `to` from `root`: `root` goes on the back list, the forward list
 *  empties (as in a browser). null: already there. */
export function navGo(nav: Nav, root: string, to: string): NavStep | null {
  if (!to || to === root) return null;

  return { to, nav: { past: [...nav.past, root].slice(-50), future: [] } };
}

/** Back: the folder before; with none, up to the parent (forward comes back).
 *  null: nowhere to go (the top of the disk). */
export function navBack(nav: Nav, root: string): NavStep | null {
  const to = nav.past.at(-1) ?? parent(root);

  if (to === root) return null;

  return { to, nav: { past: nav.past.slice(0, -1), future: [...nav.future, root] } };
}

/** Forward: undoes a back. null: nothing ahead. */
export function navForward(nav: Nav, root: string): NavStep | null {
  const to = nav.future.at(-1);

  if (to === undefined) return null;

  return { to, nav: { past: [...nav.past, root], future: nav.future.slice(0, -1) } };
}

// ---- the header in any width

/** About how wide a character is at the header's size 11 (logical px). */
export const CH = 7;

const chipW = (label: string, cut: number): number => 8 + 11 + (label ? 4 + label.length * CH : 0) + (cut > 0 ? 4 + String(cut).length * CH : 0);

/** What ? lists under the filter line, ? keys last. */
export const KEYS: readonly KeyRow[] = [["j k  ↑ ↓", "move"], ["h l  ← →", "fold / open"], ["enter", "open"], ["e", "edit"], ["E", "$EDITOR"], ["p", "viewer"],
  ["space", "preview on / off"], ["J K", "scroll the preview"], ["< >", "preview smaller / bigger"],
  ["t", "mark · unmark"], ["V", "mark a range (V ends)"], ["⇧↑ ⇧↓", "mark while moving"],
  ["v", "Neovim"], ["w", "HTML: in a web pane"], ["o", "new pane"], ["y", "copy path"], ["a A", "new file / folder"], ["R", "rename · move"], ["x P", "cut / paste"],
  ["d", "delete"], ["m", "menu"], ["/", "filter"], ["↑↓ ctrl-n ctrl-p", "filter: pick"], ["tab ⇧tab", "filter: to list"], ["H I", "dotfiles / ignored"],
  ["tab ⇧tab", "switches, + file"],
  ["- .", "root up / here"], ["[ ]  ⌫", "back / forward"], ["alt-← alt-→", "back / forward"], ["ctrl-o ctrl-i", "back / forward"], ["gg G", "top / bottom"],
  ["r", "refresh"], ["esc", "unmark · clear filter · leave"], ["q", "close"], ["?", "keys"]];

/** Which new-item chips show: "+ file" and "+ folder", "+ file" alone, or "+". */
export type Adds = "both" | "file" | "plus";

/** What a new-item chip makes. */
export type NewKind = "file" | "folder";

/** A stop of the filter line that tab rings. */
export type Stop = "hidden" | "ignored" | "add-file" | "add-folder" | "keys";

/** The new-item chips by `fit.add`: "+ file" and "+ folder", "+ file" alone, or "+". */
export const ADDS = {
  both: [["file", "+ file"], ["folder", "+ folder"]],
  file: [["file", "+ file"]],
  plus: [["file", "+"]],
} as const satisfies { readonly [A in Adds]: readonly (readonly [NewKind, string])[] };

/** The filter line's stops for tab / shift-tab (`add`: lensFit's): its two
 *  switches, the new-item chips drawn, the keys chip. */
export function lensStops(add: Adds = "both"): Stop[] {
  const adds: readonly (readonly [NewKind, string])[] = ADDS[add];

  return ["hidden", "ignored", ...adds.map(([kind]): Stop => (kind === "file" ? "add-file" : "add-folder")), "keys"];
}

/** tab (+1) / shift-tab (-1) from stop `at` (null: the list) over `stops`;
 *  past either end it's the list again (null). */
export function lensStep(stops: readonly Stop[], at: Stop | null, dir: number): Stop | null {
  const i = at === null ? (dir > 0 ? -1 : stops.length) : stops.indexOf(at);

  return stops[i + dir] ?? null;
}

/** "? keys" on the filter line (keyhelp.ts), px: 4 + "?" + 4 + "keys" + 4 at 7 px a character. */
const KEYS_CHIP = 47;

/** A new-item chip's width (px 4 each side). */
export const addW = (label: string): number => 8 + label.length * CH;

/** How the switches are labelled: whole words, short, or the eye alone. */
export type ChipLabels = "full" | "short" | "icon";

const LABELS = { full: ["dotfiles", "ignored"], short: [".*", "ign"], icon: ["", ""] } as const satisfies { readonly [L in ChipLabels]: readonly [string, string] };

/** How many each switch leaves out. */
export interface Cut {
  readonly hidden: number;
  readonly ignored: number;
}

/** The filter line's parts that fit a width. */
export interface LensFit {
  readonly find: string;
  readonly chips: ChipLabels;
  readonly cuts: boolean;
  readonly add: Adds;
  readonly count: boolean;
  readonly labels: readonly [string, string];
}

/** What the filter line counts: what each switch leaves out, the hits shown (null: no search). */
export interface LensCounts {
  readonly cut?: Cut;
  readonly count?: number | null;
}

/** The filter line's parts that fit `w`, richest first: the input's
 *  placeholder ("filter files", "filter" or only the /), the two switches'
 *  labels ("full": dotfiles / ignored, "short": .* / ign, "icon": the eye
 *  alone) and the new-item chips (`add`, ADDS: "+ folder" goes first, then
 *  "+ file" shortens to "+"). `cut`: how many each switch leaves out;
 *  `count`: the hits shown. */
export function lensFit(w: number, { cut = { hidden: 0, ignored: 0 }, count = null }: LensCounts = {}): LensFit {
  const variants: readonly (readonly [string, ChipLabels, boolean, Adds])[] = [
    ["filter files", "full", true, "both"], ["filter files", "full", true, "file"], ["filter files", "short", true, "both"], ["filter files", "short", true, "file"],
    ["filter", "short", true, "file"], ["", "short", true, "file"], ["", "short", true, "plus"],
    ["", "icon", true, "plus"], ["", "icon", false, "plus"],
  ];

  for (const [find, chips, cuts, add] of variants) {
    const fit = { find, chips, cuts, add, count: count !== null, labels: LABELS[chips] };

    if (lensWidth(fit, cut, count) <= w) return fit;
  }

  return { find: "", chips: "icon", cuts: false, add: "plus", count: false, labels: LABELS.icon };
}

/** The filter line in one row or two. */
export interface LensLayout extends LensFit {
  readonly rows: 1 | 2;
}

/** The filter line as it fits `w`: one line while the filter keeps its whole
 *  placeholder ("filter files") beside the switches; narrower (the docked
 *  panel, about 280 px), two rows, so there's room to type and to read what
 *  was typed: the filter at full width (with its hit count), and under it
 *  the switches, the new-item chips and ? keys, as they fit (chipsFit). */
export function lensLayout(w: number, { cut = { hidden: 0, ignored: 0 }, count = null }: LensCounts = {}): LensLayout {
  const one = lensFit(w, { cut, count });

  if (one.find === "filter files") return { rows: 1, ...one };

  return { rows: 2, find: "filter files", count: count !== null, ...chipsFit(w, cut) };
}

/** The second row's parts that fit a width. */
export interface ChipsFit {
  readonly chips: ChipLabels;
  readonly cuts: boolean;
  readonly add: Adds;
  readonly labels: readonly [string, string];
}

/** The second row of a two-row filter line: the switches' labels, their
 *  counts and the new-item chips that fit `w`, richest first. */
export function chipsFit(w: number, cut: Cut = { hidden: 0, ignored: 0 }): ChipsFit {
  const variants: readonly (readonly [ChipLabels, boolean, Adds])[] = [["full", true, "both"], ["full", true, "file"], ["short", true, "both"], ["short", true, "file"], ["short", true, "plus"], ["icon", true, "plus"], ["icon", false, "plus"]];

  for (const [chips, cuts, add] of variants) {
    const [h, i] = LABELS[chips];
    const adds: readonly (readonly [NewKind, string])[] = ADDS[add];
    const parts = [chipW(h, cuts ? cut.hidden : 0), chipW(i, cuts ? cut.ignored : 0), ...adds.map(([, l]) => addW(l)), KEYS_CHIP];
    let sum = 0;

    for (const p of parts) sum += p;

    if (16 + sum + 6 * (parts.length - 1) <= w) return { chips, cuts, add, labels: LABELS[chips] };
  }

  return { chips: "icon", cuts: false, add: "plus", labels: LABELS.icon };
}

/** How wide the filter line is with `fit` (logical px); the ? chip ends it. */
function lensWidth(fit: LensFit, cut: Cut, count: number | null): number {
  const [h, i] = fit.labels;
  const find = CH + (fit.find ? 5 + fit.find.length * CH : 0);
  const adds: readonly (readonly [NewKind, string])[] = ADDS[fit.add];
  const parts = [11, find, chipW(h, fit.cuts ? cut.hidden : 0), chipW(i, fit.cuts ? cut.ignored : 0), ...adds.map(([, l]) => addW(l)), KEYS_CHIP];

  if (fit.count) parts.push(String(count).length * CH);

  let sum = 0;

  for (const p of parts) sum += p;

  return 16 + sum + 6 * (parts.length - 1);
}

/** The toolbar's parts that fit `w`: back, forward and the folder's name
 *  always (`name`: the px it keeps, up to NAME, before it truncates); then, as
 *  room allows, the close button (a pane of its own: its header has one too),
 *  the changed count, the preview's switch, the edit button, the branch, the FILES eyebrow and the
 *  folder's parent path. */
export const NAME = 56;

/** Which of the toolbar's parts show, and the px the name keeps. */
export interface ToolbarFit {
  close: boolean;
  changed: boolean;
  look: boolean;
  edit: boolean;
  branch: boolean;
  eyebrow: boolean;
  path: boolean;
  name: number;
}

/** What the toolbar holds: a pane of its own (a close button), the branch, how many changed, the folder's name. */
export interface ToolbarHas {
  readonly alone?: boolean;
  readonly branch?: string | null;
  readonly changed?: number;
  readonly name?: string;
}

/** The parts of the toolbar that can go when it's narrow. */
type Optional = Exclude<keyof ToolbarFit, "name">;

export function toolbarFit(w: number, { alone = false, branch = null, changed = 0, name = "" }: ToolbarHas = {}): ToolbarFit {
  const fit: ToolbarFit = { close: false, changed: false, look: false, edit: false, branch: false, eyebrow: false, path: false, name: 0 };
  const want = Math.min(NAME, name.length * CH);

  fit.name = Math.max(Math.min(want, 3 * CH), Math.min(want, w - 20 - 19 - 19 - 8 * 2));

  let used = 20 + 19 + 19 + want;
  let n = 3;
  const room = (px: number): boolean => used + px + 8 * n <= w;

  const take = (key: Optional, px: number): void => {
    if (room(px)) {
      fit[key] = true;
      used += px;
      n++;
    }
  };

  if (alone) take("close", 20);

  if (changed > 0) take("changed", (String(changed).length + 1) * CH);

  // The preview split's switch: an icon.
  take("look", 20);
  take("edit", 12 + 4 * CH);

  if (branch) take("branch", Math.min(140, branch.length * CH));

  take("eyebrow", 5 * CH);
  take("path", 80);

  return fit;
}

// ---- the preview split

/** How much wider than tall (or taller than wide) a pane is before its
 *  preview moves: near square it stays where it was, so it doesn't flip. */
export const SLACK = 1.2;

/** Where the preview is: at the pane's right, or at its bottom. */
export type Side = "right" | "bottom";

/** A pane's size (layout px). */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Where a pane `size` ({ width, height }, layout px) puts its preview:
 *  "right" when clearly wider than tall, "bottom" when clearly taller; in
 *  between where it `was` (first time: right if at least as wide). */
export function lookSide(size: Size, was: Side | null = null): Side {
  const { width: w, height: h } = size;

  if (w > h * SLACK) return "right";

  if (h > w * SLACK) return "bottom";

  return was ?? (w >= h ? "right" : "bottom");
}

/** The toolbar and the filter line above the split (px). */
export const LOOK_TOP = 34 + 26;

/** The divider's grab area (px); its line is 1 px in the middle. */
export const DIVIDER = 5;

/** What each part keeps at least (px along the split), by side. */
export const LOOK_MIN = { bottom: { tree: 110, look: 96 }, right: { tree: 150, look: 160 } } as const satisfies { readonly [S in Side]: { readonly tree: number; readonly look: number } };

/** A new pane's preview share, and one < / > step. */
export const LOOK_SHARE = 0.5;

export const LOOK_STEP = 0.06;

/** The room the split shares along `side`: the pane's width, or its height under the header. */
export const lookRoom = (size: Size, side: Side): number => (side === "right" ? size.width : size.height - LOOK_TOP) - DIVIDER;

/** `share` kept so both parts get their least; null: the room can't hold both. */
export function clampShare(size: Size, side: Side, share: number): number | null {
  const room = lookRoom(size, side);
  const min = LOOK_MIN[side];

  if (room < min.tree + min.look) return null;

  const f = Number.isFinite(share) ? share : LOOK_SHARE;

  return Math.max(min.look / room, Math.min((room - min.tree) / room, f));
}

/** The preview's size (px along `side`) for its `share`; null: no room for it. */
export function lookSize(size: Size, side: Side, share: number): number | null {
  const f = clampShare(size, side, share);

  return f === null ? null : Math.round(lookRoom(size, side) * f);
}

/** A point in the pane (layout px). */
export interface At {
  readonly x: number;
  readonly y: number;
}

/** The share a divider dragged to `at` ({ x, y } in the pane, layout px) gives. */
export function dragShare(size: Size, side: Side, at: At): number | null {
  const room = lookRoom(size, side);
  const look = side === "right" ? size.width - at.x - DIVIDER / 2 : size.height - at.y - DIVIDER / 2;

  return clampShare(size, side, look / room);
}

/** A pane's preview split, kept in shared state by slot: on, and its share at each side. */
export interface LookState {
  readonly on: boolean;
  readonly right: number;
  readonly bottom: number;
}

/** An entry of shared `file-tree.look` (an older one may lack a field: the default fills it). */
export const isLookEntry = object({}, { on: isBoolean, right: isNumber, bottom: isNumber });

/** Each pane's preview, as kept in shared state by slot: { on, right, bottom } (shares). */
export const newLook = (): LookState => ({ on: false, right: LOOK_SHARE, bottom: LOOK_SHARE });

/** An entry of a folder: its name, a folder or not. */
export interface Entry {
  readonly name: string;
  readonly dir: boolean;
}

/** A folder's summary in the preview: "3 folders · 12 files". */
export function folderFacts(entries: readonly Entry[]): string {
  const dirs = entries.filter((e) => e.dir).length;
  const files = entries.length - dirs;
  const n = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;

  return entries.length ? `${n(dirs, "folder", "folders")} · ${n(files, "file", "files")}` : "empty";
}

// ---- several rows: marks, sets, drag and drop, the changes record

/** The paths of `rows` from index `a` to `b` (either order), search folder lines left out. */
export function rangePaths(rows: readonly Listed[], a: number, b: number): string[] {
  const [from, to] = a <= b ? [a, b] : [b, a];

  return rows.slice(Math.max(0, from), to + 1).flatMap((r) => (r.head || r.draft ? [] : [r.path]));
}

/** The paths a set acts on: one under another one in the set goes with it
 *  (a marked folder covers what's inside it), the root never. */
export function topLevel(paths: readonly string[]): string[] {
  const all = [...new Set(paths)].filter(Boolean);

  return all.filter((p) => !all.some((q) => q !== p && p.startsWith(`${q}/`)));
}

/** The delete question for several items: the count, the first few names, trash or permanently. */
export function deleteManyQuestion(items: readonly Entry[], trash: boolean): string {
  const names = items.slice(0, 3).map((x) => `“${x.name}${x.dir ? "/" : ""}”`).join(", ");
  const more = items.length > 3 ? ` and ${items.length - 3} more` : "";

  return `${trash ? "Move" : "Delete"} ${items.length} items (${names}${more})${trash ? " to the Trash" : " permanently"}?`;
}

/** Why `items` (absolute paths) can't be dropped into `into`, or null. Items
 *  already in it are left where they are; all of them there is a refusal. */
export function dropRefusal(items: readonly string[], into: string): string | null {
  if (!items.length) return "Nothing to move";

  if (items.some((p) => p === into)) return "A folder can't go into itself";

  if (items.some((p) => into.startsWith(`${p}/`))) return "A folder can't go into its own folder";

  if (items.every((p) => parent(p) === into)) return "It's already there";

  return null;
}

/** One rename, move or delete (`to` null) in shared `nocturne.files.changes`, as the
 *  editors' follow.ts reads it (isFileChange there): the same fields. */
export const isFileChange = object({ id: isNumber, from: isString, to: nullable(isString) }, { on: nullable(isString), at: isNumber });

export type FileChange = Guarded<typeof isFileChange>;

/** A rename or move (`to`), or a delete (`to` null), absolute paths. */
export interface Moved {
  readonly from: string;
  readonly to?: string | null;
}

/** The shared record of renames, moves and deletes (`nocturne.files.changes`)
 *  with `entries` ({ from, to }) appended: newest last, at most 50, each with
 *  an `id` one past the last and the machine and time. */
export const CHANGES_MAX = 50;

export function withChanges(list: readonly FileChange[], entries: readonly Moved[], on: string | null, at: number): FileChange[] {
  const out = [...list];
  let id = out.at(-1)?.id ?? 0;

  for (const e of entries) out.push({ id: ++id, from: e.from, to: e.to ?? null, on, at });

  return out.slice(-CHANGES_MAX);
}

/** One item cut for P: where it is, a folder or not, its name. */
export const isCutItem = object({ abs: isString, dir: isBoolean, name: isString });

export type CutItem = Guarded<typeof isCutItem>;

/** Shared `file-tree.cut`, what P pastes: { on, items } (a set), or, as written before, one { abs, dir, name, on }. */
export const isClip = object({}, { on: nullable(isString), items: arrayOf(isCutItem), abs: isString, dir: isBoolean, name: isString });

export type Clip = Guarded<typeof isClip>;

/** What's cut, as a list ({ abs, dir, name } each), from shared `file-tree.cut`
 *  (a set now, a single item before). */
export function cutItems(c: Clip | null): readonly CutItem[] {
  if (!c) return [];

  if (c.items) return c.items;

  return c.abs ? [{ abs: c.abs, dir: Boolean(c.dir), name: c.name ?? base(c.abs) }] : [];
}

/** The right-click menu for a set of `n` marked rows: what acts on all of
 *  them first, then the clicked row's own entries that act on it alone. */
export function setMenuItems(row: MenuTarget, n: number, { pane = false, clip = false, look = false }: MenuOptions = {}): MenuItem[] {
  const alone: readonly Act[] = ["delete", "cut", "copy", "paste", "rename", "new-file", "new-folder"];
  const own = menuItems(row, { pane, clip: false, look }).filter((x) => !alone.includes(x.act));

  return [
    { key: "d", label: `Delete ${n} items…`, act: "delete-set" },
    { key: "x", label: `Cut ${n} items`, act: "cut-set" },
    { key: "y", label: `Copy ${n} paths`, act: "copy-set" },
    ...(clip ? [{ key: "P", label: row.dir ? "Paste in it" : "Paste beside it", act: "paste" } as const] : []),
    { key: "esc", label: "Unmark all", act: "unmark" },
    ...own,
  ];
}

/** The tree's geometry for the pointer: rows start TREE_TOP px below the
 *  pane's top (toolbar, filter line, the list's padding), ROW px each;
 *  treeTop(2) with the filter line in two rows (lensLayout). */
export const LENS_ROW = 26;

export const treeTop = (rows = 1): number => 34 + LENS_ROW * rows + 4;

export const TREE_TOP = treeTop(1);

export const ROW_H = 22;

/** The index of the row under `y` (pane px) with the list scrolled `scrolled`
 *  px down: -1 above the rows. `top`: where the rows start (treeTop). */
export const rowIndexAt = (y: number, scrolled: number, top = TREE_TOP): number => Math.floor((y - top + scrolled) / ROW_H);
