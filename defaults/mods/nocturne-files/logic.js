// What the files pane decides without drawing: which entries its filters
// keep, git's ignored list, search results grouped under their folders, the
// right-click menu and how Neovim opens a file or folder. main.js draws.

export const parent = (p) => p.replace(/\/[^/]+$/, "") || "/";
export const base = (p) => p.slice(p.lastIndexOf("/") + 1);
export const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** settings.json `files`: what a new pane lists. Unset, dotfiles and
 *  git-ignored files are left out (H and I show them; the chips count them). */
export function filterDefaults(settings) {
  const f = settings?.files ?? {};
  return { hidden: f.hidden === true, ignored: f.ignored === true };
}

/** `git ls-files -z --others --ignored --exclude-standard --directory` (run in
 *  the root) as a set of paths relative to the root; folders without their "/". */
export function parseIgnored(stdout) {
  return new Set(String(stdout ?? "").split("\0").filter(Boolean).map((p) => p.replace(/\/$/, "")));
}

/** Whether git ignores `path` (relative to the root): it, or a folder it's in, is listed. */
export function isIgnored(path, ignored) {
  if (!ignored?.size) return false;
  for (let p = path; p; p = dirOf(p)) if (ignored.has(p)) return true;
  return false;
}

/** Any part of the path starts with a dot. */
export const isHidden = (path) => path.split("/").some((s) => s.startsWith("."));

/** Whether a pane with these filters lists `path` (relative to the root). */
export function lists(path, filters, ignored) {
  if (!filters.hidden && isHidden(path)) return false;
  if (!filters.ignored && isIgnored(path, ignored)) return false;
  return true;
}

/** Characters of `text` matching `query` in order, case-insensitively (the
 *  search's fallback where the index can't go): [start, end) ranges, or null. */
export function fuzzy(query, text) {
  const q = query.toLowerCase().replace(/\s+/g, ""), s = text.toLowerCase();
  if (!q) return [];
  // Prefer the match in the name: search from the last part's start first.
  const tryFrom = (from) => {
    const out = [];
    let i = from;
    for (const c of q) {
      const at = s.indexOf(c, i);
      if (at < 0) return null;
      if (out.length && out[out.length - 1][1] === at) out[out.length - 1][1] = at + 1;
      else out.push([at, at + 1]);
      i = at + 1;
    }
    return out;
  };
  return tryFrom(text.lastIndexOf("/") + 1) ?? tryFrom(0);
}

/** Search hits ({ path, ranges, git }, best first) as rows: each folder once,
 *  where its best hit ranks, its hits under it; files at the root stand alone.
 *  `ranges` move onto the name. */
export function grouped(files) {
  const groups = new Map();
  for (const f of files) {
    const dir = dirOf(f.path);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(f);
  }
  const rows = [];
  for (const [dir, hits] of groups) {
    if (dir) rows.push({ path: dir, name: dir, dir: true, depth: 0, head: true });
    for (const f of hits) {
      const cut = dir ? dir.length + 1 : 0;
      const ranges = (f.ranges ?? []).map(([a, b]) => [Math.max(0, a - cut), b - cut]).filter(([a, b]) => b > a);
      rows.push({ path: f.path, name: base(f.path), dir: false, depth: dir ? 1 : 0, ranges, git: f.git ?? null, hit: true });
    }
  }
  return rows;
}

/** Neovim on a file (in its folder) or in a folder (`nvim .` there). */
export function nvimLaunch(abs, dir) {
  return dir ? { argv: ["nvim", "."], folder: abs } : { argv: ["nvim", abs], folder: parent(abs) };
}

/** The right-click menu for a row: [{ key, label, act }], `act` naming the
 *  pane's action. Folders and files differ; the root (empty space, `path` "")
 *  can't fold, reroot, be renamed, cut or deleted. `pane`: a pane of its own
 *  (it closes); `clip`: something is cut (paste shows); `look`: the preview
 *  split is open (its entry hides it). */
export function menuItems(row, { pane = false, clip = false, look = false } = {}) {
  const root = row.dir && !row.path;
  const items = row.dir
    ? [
        ...(root ? [] : [{ key: "enter", label: "Fold / unfold", act: "toggle" }]),
        { key: "o", label: "Open in a new files pane", act: "pane" },
        ...(root ? [] : [{ key: ".", label: "Root the tree here", act: "root" }]),
        { key: "e", label: "Open in $EDITOR", act: "edit" },
        { key: "v", label: "Open in Neovim", act: "nvim" },
      ]
    : [
        { key: "enter", label: "Open", act: "open" },
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

// ---- file operations: names, paths, the shell that does them

/** `a/b` under `dir` (absolute); the root "/" without a double slash. */
export const join = (dir, name) => (name ? (dir === "/" ? `/${name}` : `${dir}/${name}`) : dir);

/** `abs` relative to `root`: "" for the root itself, null outside it. */
export function relTo(root, abs) {
  if (abs === root) return "";
  const pre = root === "/" ? "/" : `${root}/`;
  return abs.startsWith(pre) ? abs.slice(pre.length) : null;
}

/** Where a typed name points, from the folder `dir` (absolute): a relative
 *  path, an absolute one, or `~/…` (`home`; null on another machine). `.` and
 *  `..` steps resolve; a trailing `/` makes it a folder. { abs, folder } or
 *  { error }. */
export function resolveName(dir, typed, home) {
  const text = String(typed ?? "");
  if (!text.trim()) return { error: "Type a name" };
  let start = dir;
  let rest = text;
  if (text.startsWith("/")) start = "/";
  else if (text === "~" || text.startsWith("~/")) {
    if (!home) return { error: "~ is this Mac's home: type the path" };
    start = home; rest = text.slice(1);
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

/** What a rename's text resolves to for `src` (absolute): a name or path
 *  from its folder; ending in `/`, into that folder under its own name. */
export function renameTarget(src, typed, home) {
  const r = resolveName(parent(src), typed, home);
  if (r.error) return r;
  return { abs: r.folder ? join(r.abs, base(src)) : r.abs };
}

/** Why moving `src` to `dst` (both absolute) isn't allowed, or null. */
export function moveRefusal(src, dst, root) {
  if (src === root) return "The tree's root can't be moved";
  if (dst === src) return "It's already there";
  if (dst.startsWith(`${src}/`)) return "A folder can't go into itself";
  return null;
}

/** The part of a name a rename selects: the stem, not the extension
 *  (`.env`, `Makefile`, a folder: all of it). UTF-16 offsets, as the input takes. */
export function stemRange(name, dir = false) {
  const dot = name.lastIndexOf(".");
  return { start: 0, end: dir || dot <= 0 ? name.length : dot };
}

/** The question before a delete: the item named, a folder's contents too,
 *  "permanently" where the machine has no trash. */
export function deleteQuestion(name, dir, trash) {
  const what = dir ? `“${name}/” and everything in it` : `“${name}”`;
  return trash ? `Move ${what} to the Trash?` : `Delete ${what} permanently?`;
}

/** The row to select once `path` is deleted: the next one past it (and what
 *  it held), else the one before. */
export function neighbour(rows, path) {
  const i = rows.findIndex((r) => r.path === path);
  if (i < 0) return null;
  const inside = (r) => r.path === path || r.path.startsWith(`${path}/`);
  const next = rows.slice(i + 1).find((r) => !inside(r) && !r.head);
  if (next) return next.path;
  for (let j = i - 1; j >= 0; j--) if (!rows[j].head) return rows[j].path;
  return null;
}

/** Unfolded folders (relative paths) after `from` moved to `to` (null: out of the tree). */
export function movedFolders(folders, from, to) {
  const out = new Set();
  for (const f of folders) {
    if (f !== from && !f.startsWith(`${from}/`)) out.add(f);
    else if (to != null) out.add(to + f.slice(from.length));
  }
  return out;
}

/** The folders to unfold so `rel` shows (its parents). */
export function parentsOf(rel) {
  const parts = rel.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** A failed command's stderr as one line: macOS's trash wraps its reason in
 *  an NSError dump; the shell's "sh: line 1:" goes. */
export function cleanError(stderr) {
  const s = String(stderr ?? "").trim();
  const ns = s.match(/Code=\d+ "(.+?)" UserInfo/);
  if (ns) return ns[1];
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

/** `text` cut into [piece, matched] runs by `ranges`, for drawing the matched characters apart. */
export function marks(text, ranges) {
  const out = [];
  let at = 0;
  for (const [s0, e0] of [...(ranges ?? [])].sort((a, b) => a[0] - b[0])) {
    const s = Math.max(s0, at), e = Math.min(e0, text.length);
    if (e <= s) continue;
    if (s > at) out.push([text.slice(at, s), false]);
    out.push([text.slice(s, e), true]);
    at = e;
  }
  if (at < text.length) out.push([text.slice(at), false]);
  return out;
}

/** The menu's key column width (layout px, before zoom): its widest key at 7 px a character, plus room. */
export const keyColumn = (items) => Math.max(30, ...items.map((x) => String(x.key ?? "").length * 7 + 14));

// ---- the folders visited: back and forward

/** No folders visited yet. */
export const newNav = () => ({ past: [], future: [] });

/** Going to `to` from `root`: `root` goes on the back list, the forward list
 *  empties (as in a browser). null: already there. */
export function navGo(nav, root, to) {
  if (!to || to === root) return null;
  return { to, nav: { past: [...nav.past, root].slice(-50), future: [] } };
}

/** Back: the folder before; with none, up to the parent (forward comes back).
 *  null: nowhere to go (the top of the disk). */
export function navBack(nav, root) {
  const to = nav.past.length ? nav.past[nav.past.length - 1] : parent(root);
  if (to === root) return null;
  return { to, nav: { past: nav.past.slice(0, -1), future: [...nav.future, root] } };
}

/** Forward: undoes a back. null: nothing ahead. */
export function navForward(nav, root) {
  if (!nav.future.length) return null;
  return { to: nav.future[nav.future.length - 1], nav: { past: [...nav.past, root], future: nav.future.slice(0, -1) } };
}

// ---- the header in any width

/** About how wide a character is at the header's size 11 (logical px). */
export const CH = 7;
const chipW = (label, cut) => 8 + 11 + (label ? 4 + label.length * CH : 0) + (cut > 0 ? 4 + String(cut).length * CH : 0);

/** What ? lists under the filter line, ? keys last. */
export const KEYS = [["j k  ↑ ↓", "move"], ["h l  ← →", "fold / open"], ["enter", "open"], ["e", "edit"], ["E", "$EDITOR"], ["p", "viewer"],
  ["space", "preview on / off"], ["J K", "scroll the preview"], ["< >", "preview smaller / bigger"],
  ["t", "mark · unmark"], ["V", "mark a range (V ends)"], ["⇧↑ ⇧↓", "mark while moving"],
  ["v", "Neovim"], ["o", "new pane"], ["y", "copy path"], ["a A", "new file / folder"], ["R", "rename · move"], ["x P", "cut / paste"],
  ["d", "delete"], ["m", "menu"], ["/", "filter"], ["↑↓ ctrl-n ctrl-p", "filter: pick"], ["tab ⇧tab", "filter: to list"], ["H I", "dotfiles / ignored"],
  ["tab ⇧tab", "switches, + file"],
  ["- .", "root up / here"], ["[ ]  ⌫", "back / forward"], ["alt-← alt-→", "back / forward"], ["ctrl-o ctrl-i", "back / forward"], ["gg G", "top / bottom"],
  ["r", "refresh"], ["esc", "unmark · clear filter · leave"], ["q", "close"], ["?", "keys"]];
/** The filter line's stops for tab / shift-tab (`add`: lensFit's): its two
 *  switches, the new-item chips drawn, the keys chip. */
export function lensStops(add = "both") {
  return ["hidden", "ignored", ...ADDS[add].map(([kind]) => `add-${kind}`), "keys"];
}

/** tab (+1) / shift-tab (-1) from stop `at` (null: the list) over `stops`;
 *  past either end it's the list again (null). */
export function lensStep(stops, at, dir) {
  const i = at == null ? (dir > 0 ? -1 : stops.length) : stops.indexOf(at);
  const next = i + dir;
  return next < 0 || next >= stops.length ? null : stops[next];
}

/** "? keys" on the filter line (keyhelp.js), px: 4 + "?" + 4 + "keys" + 4 at 7 px a character. */
const KEYS_CHIP = 47;

/** The new-item chips by `fit.add`: "+ file" and "+ folder", "+ file" alone, or "+". */
export const ADDS = { both: [["file", "+ file"], ["folder", "+ folder"]], file: [["file", "+ file"]], plus: [["file", "+"]] };
/** A new-item chip's width (px 4 each side). */
export const addW = (label) => 8 + label.length * CH;

/** The filter line's parts that fit `w`, richest first: the input's
 *  placeholder ("filter files", "filter" or only the /), the two switches'
 *  labels ("full": dotfiles / ignored, "short": .* / ign, "icon": the eye
 *  alone) and the new-item chips (`add`, ADDS: "+ folder" goes first, then
 *  "+ file" shortens to "+"). `cut`: how many each switch leaves out;
 *  `count`: the hits shown. */
export function lensFit(w, { cut = { hidden: 0, ignored: 0 }, count = null } = {}) {
  const LABELS = { full: ["dotfiles", "ignored"], short: [".*", "ign"], icon: ["", ""] };
  const variants = [
    ["filter files", "full", true, "both"], ["filter files", "full", true, "file"], ["filter files", "short", true, "both"], ["filter files", "short", true, "file"],
    ["filter", "short", true, "file"], ["", "short", true, "file"], ["", "short", true, "plus"],
    ["", "icon", true, "plus"], ["", "icon", false, "plus"],
  ];
  for (const [find, chips, cuts, add] of variants) {
    const fit = { find, chips, cuts, add, count: count != null };
    if (lensWidth(fit, LABELS[chips], cut, count) <= w) return { ...fit, labels: LABELS[chips] };
  }
  return { find: "", chips: "icon", cuts: false, add: "plus", count: false, labels: LABELS.icon };
}

/** How wide the filter line is with `fit` (logical px); the ? chip ends it. */
function lensWidth(fit, [h, i], cut, count) {
  const find = CH + (fit.find ? 5 + fit.find.length * CH : 0);
  const parts = [11, find, chipW(h, fit.cuts ? cut.hidden : 0), chipW(i, fit.cuts ? cut.ignored : 0), ...ADDS[fit.add].map(([, l]) => addW(l)), KEYS_CHIP];
  if (fit.count) parts.push(String(count).length * CH);
  return 16 + parts.reduce((a, b) => a + b, 0) + 6 * (parts.length - 1);
}

/** The toolbar's parts that fit `w`: back, forward and the folder's name
 *  always (`name`: the px it keeps, up to NAME, before it truncates); then, as
 *  room allows, the close button (a pane of its own: its header has one too),
 *  the changed count, the preview's switch, the edit button, the branch, the FILES eyebrow and the
 *  folder's parent path. */
export const NAME = 56;
export function toolbarFit(w, { alone = false, branch = null, changed = 0, name = "" } = {}) {
  const fit = { close: false, changed: false, look: false, edit: false, branch: false, eyebrow: false, path: false, name: 0 };
  const want = Math.min(NAME, name.length * CH);
  fit.name = Math.max(Math.min(want, 3 * CH), Math.min(want, w - 20 - 19 - 19 - 8 * 2));
  let used = 20 + 19 + 19 + want, n = 3;
  const room = (px) => used + px + 8 * n <= w;
  const take = (key, px) => { if (room(px)) { fit[key] = true; used += px; n++; } };
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

/** Where a pane `size` ({ width, height }, layout px) puts its preview:
 *  "right" when clearly wider than tall, "bottom" when clearly taller; in
 *  between where it `was` (first time: right if at least as wide). */
export function lookSide(size, was = null) {
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
export const LOOK_MIN = { bottom: { tree: 110, look: 96 }, right: { tree: 150, look: 160 } };
/** A new pane's preview share, and one < / > step. */
export const LOOK_SHARE = 0.5;
export const LOOK_STEP = 0.06;

/** The room the split shares along `side`: the pane's width, or its height under the header. */
export const lookRoom = (size, side) => (side === "right" ? size.width : size.height - LOOK_TOP) - DIVIDER;

/** `share` kept so both parts get their least; null: the room can't hold both. */
export function clampShare(size, side, share) {
  const room = lookRoom(size, side), min = LOOK_MIN[side];
  if (room < min.tree + min.look) return null;
  const f = Number.isFinite(share) ? share : LOOK_SHARE;
  return Math.max(min.look / room, Math.min((room - min.tree) / room, f));
}

/** The preview's size (px along `side`) for its `share`; null: no room for it. */
export function lookSize(size, side, share) {
  const f = clampShare(size, side, share);
  return f == null ? null : Math.round(lookRoom(size, side) * f);
}

/** The share a divider dragged to `at` ({ x, y } in the pane, layout px) gives. */
export function dragShare(size, side, at) {
  const room = lookRoom(size, side);
  const look = side === "right" ? size.width - at.x - DIVIDER / 2 : size.height - at.y - DIVIDER / 2;
  return clampShare(size, side, look / room);
}

/** Each pane's preview, as kept in shared state by slot: { on, right, bottom } (shares). */
export const newLook = () => ({ on: false, right: LOOK_SHARE, bottom: LOOK_SHARE });

/** A folder's summary in the preview: "3 folders · 12 files". */
export function folderFacts(entries) {
  const dirs = entries.filter((e) => e.dir).length, files = entries.length - dirs;
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  return entries.length ? `${n(dirs, "folder", "folders")} · ${n(files, "file", "files")}` : "empty";
}

// ---- several rows: marks, sets, drag and drop, the changes record

/** The paths of `rows` from index `a` to `b` (either order), search folder lines left out. */
export function rangePaths(rows, a, b) {
  const [from, to] = a <= b ? [a, b] : [b, a];
  return rows.slice(Math.max(0, from), to + 1).filter((r) => !r.head && !r.draft).map((r) => r.path);
}

/** The paths a set acts on: one under another one in the set goes with it
 *  (a marked folder covers what's inside it), the root never. */
export function topLevel(paths) {
  const all = [...new Set(paths)].filter(Boolean);
  return all.filter((p) => !all.some((q) => q !== p && p.startsWith(`${q}/`)));
}

/** The delete question for several items: the count, the first few names, trash or permanently. */
export function deleteManyQuestion(items, trash) {
  const names = items.slice(0, 3).map((x) => `“${x.name}${x.dir ? "/" : ""}”`).join(", ");
  const more = items.length > 3 ? ` and ${items.length - 3} more` : "";
  return `${trash ? "Move" : "Delete"} ${items.length} items (${names}${more})${trash ? " to the Trash" : " permanently"}?`;
}

/** Why `items` (absolute paths) can't be dropped into `into`, or null. Items
 *  already in it are left where they are; all of them there is a refusal. */
export function dropRefusal(items, into) {
  if (!items.length) return "Nothing to move";
  if (items.some((p) => p === into)) return "A folder can't go into itself";
  if (items.some((p) => into.startsWith(`${p}/`))) return "A folder can't go into its own folder";
  if (items.every((p) => parent(p) === into)) return "It's already there";
  return null;
}

/** The shared record of renames, moves and deletes (`nocturne.files.changes`)
 *  with `entries` ({ from, to }) appended: newest last, at most 50, each with
 *  an `id` one past the last and the machine and time. */
export const CHANGES_MAX = 50;
export function withChanges(list, entries, on, at) {
  const out = Array.isArray(list) ? [...list] : [];
  let id = out.length ? Number(out[out.length - 1].id) || 0 : 0;
  for (const e of entries) out.push({ id: ++id, from: e.from, to: e.to ?? null, on: on ?? null, at });
  return out.slice(-CHANGES_MAX);
}

/** What's cut, as a list ({ abs, dir, name } each), from shared `nocturne-files.cut`
 *  (a set now, a single item before). */
export function cutItems(c) {
  if (!c) return [];
  if (Array.isArray(c.items)) return c.items;
  return c.abs ? [{ abs: c.abs, dir: Boolean(c.dir), name: c.name ?? base(c.abs) }] : [];
}

/** The right-click menu for a set of `n` marked rows: what acts on all of
 *  them first, then the clicked row's own entries that act on it alone. */
export function setMenuItems(row, n, { pane = false, clip = false, look = false } = {}) {
  const own = menuItems(row, { pane, clip: false, look }).filter((x) => !["delete", "cut", "copy", "paste", "rename", "new-file", "new-folder"].includes(x.act));
  return [
    { key: "d", label: `Delete ${n} items…`, act: "delete-set" },
    { key: "x", label: `Cut ${n} items`, act: "cut-set" },
    { key: "y", label: `Copy ${n} paths`, act: "copy-set" },
    ...(clip ? [{ key: "P", label: row.dir ? "Paste in it" : "Paste beside it", act: "paste" }] : []),
    { key: "esc", label: "Unmark all", act: "unmark" },
    ...own,
  ];
}

/** The tree's geometry for the pointer: rows start TREE_TOP px below the
 *  pane's top (toolbar, filter line, the list's padding), ROW px each. */
export const TREE_TOP = 34 + 26 + 4;
export const ROW_H = 22;

/** The index of the row under `y` (pane px) with the list scrolled `scrolled`
 *  px down: -1 above the rows. */
export const rowIndexAt = (y, scrolled) => Math.floor((y - TREE_TOP + scrolled) / ROW_H);
