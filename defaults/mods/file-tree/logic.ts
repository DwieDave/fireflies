// What the files pane decides without drawing: which entries its filters
// keep, git's ignored list, search results grouped under their folders, the
// right-click menu and how Neovim opens a file or folder. main.ts draws.

import type { PaneInfo, Settings } from "herdr";
import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, nullable, object } from "./guard.ts";
import type { Entry } from "./split-size.ts";
import type { Listed } from "./ops.ts";

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
