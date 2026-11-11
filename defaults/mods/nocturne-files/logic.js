// What the files pane decides without drawing: which entries its filters
// keep, git's ignored list, search results grouped under their folders, the
// right-click menu and how Neovim opens a file or folder. main.js draws.

export const parent = (p) => p.replace(/\/[^/]+$/, "") || "/";
const base = (p) => p.slice(p.lastIndexOf("/") + 1);
const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** settings.json `files`: what a new pane lists (both, unless set). */
export function filterDefaults(settings) {
  const f = settings?.files ?? {};
  return { hidden: f.hidden !== false, ignored: f.ignored !== false };
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
 *  pane's action. Folders and files differ; `pane`: a pane of its own (it
 *  closes). */
export function menuItems(row, { pane = false } = {}) {
  const items = row.dir
    ? [
        { key: "enter", label: "Fold / unfold", act: "toggle" },
        { key: "o", label: "Open in a new files pane", act: "pane" },
        { key: ".", label: "Root the tree here", act: "root" },
        { key: "e", label: "Open in $EDITOR", act: "edit" },
        { key: "v", label: "Open in Neovim", act: "nvim" },
      ]
    : [
        { key: "enter", label: "Open", act: "open" },
        { key: "e", label: "Edit as text", act: "other" },
        { key: "E", label: "Open in $EDITOR", act: "terminal" },
        { key: "v", label: "Open in Neovim", act: "nvim" },
      ];
  items.push({ key: "y", label: "Copy path", act: "copy" });
  if (pane) items.push({ key: "q", label: "Close this pane", act: "close" });
  return items;
}

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

/** The filter line's parts that fit `w`, richest first: the input's
 *  placeholder ("filter files", "filter" or only the /) and the two switches'
 *  labels ("full": dotfiles / ignored, "short": .* / ign, "icon": the eye
 *  alone). `cut`: how many each switch leaves out; `count`: the hits shown. */
/** What ? lists under the filter line, ? keys last. */
export const KEYS = [["j k", "move"], ["h l", "fold / open"], ["enter", "open"], ["e", "edit"], ["E", "$EDITOR"], ["p", "viewer"],
  ["v", "Neovim"], ["o", "new pane"], ["y", "copy path"], ["m", "menu"], ["/", "filter"], ["H I", "dotfiles / ignored"],
  ["- .", "root up / here"], ["[ ]", "back / forward"], ["gg G", "top / bottom"], ["r", "refresh"], ["q", "close"], ["?", "keys"]];
/** The ? chip's width on the filter line (px). */
const KEYS_CHIP = 15;

export function lensFit(w, { cut = { hidden: 0, ignored: 0 }, count = null } = {}) {
  const LABELS = { full: ["dotfiles", "ignored"], short: [".*", "ign"], icon: ["", ""] };
  const variants = [
    ["filter files", "full", true], ["filter files", "short", true], ["filter", "short", true],
    ["", "short", true], ["", "icon", true], ["", "icon", false],
  ];
  for (const [find, chips, cuts] of variants) {
    const fit = { find, chips, cuts, count: count != null };
    if (lensWidth(fit, LABELS[chips], cut, count) <= w) return { ...fit, labels: LABELS[chips] };
  }
  return { find: "", chips: "icon", cuts: false, count: false, labels: LABELS.icon };
}

/** How wide the filter line is with `fit` (logical px); the ? chip ends it. */
function lensWidth(fit, [h, i], cut, count) {
  const find = CH + (fit.find ? 5 + fit.find.length * CH : 0);
  const parts = [11, find, chipW(h, fit.cuts ? cut.hidden : 0), chipW(i, fit.cuts ? cut.ignored : 0), KEYS_CHIP];
  if (fit.count) parts.push(String(count).length * CH);
  return 16 + parts.reduce((a, b) => a + b, 0) + 6 * (parts.length - 1);
}

/** The toolbar's parts that fit `w`: back, forward and the folder's name
 *  always (`name`: the px it keeps, up to NAME, before it truncates); then, as
 *  room allows, the close button (a pane of its own: its header has one too),
 *  the changed count, the edit button, the branch, the FILES eyebrow and the
 *  folder's parent path. */
export const NAME = 56;
export function toolbarFit(w, { alone = false, branch = null, changed = 0, name = "" } = {}) {
  const fit = { close: false, changed: false, edit: false, branch: false, eyebrow: false, path: false, name: 0 };
  const want = Math.min(NAME, name.length * CH);
  fit.name = Math.max(Math.min(want, 3 * CH), Math.min(want, w - 20 - 19 - 19 - 8 * 2));
  let used = 20 + 19 + 19 + want, n = 3;
  const room = (px) => used + px + 8 * n <= w;
  const take = (key, px) => { if (room(px)) { fit[key] = true; used += px; n++; } };
  if (alone) take("close", 20);
  if (changed > 0) take("changed", (String(changed).length + 1) * CH);
  take("edit", 12 + 4 * CH);
  if (branch) take("branch", Math.min(140, branch.length * CH));
  take("eyebrow", 5 * CH);
  take("path", 80);
  return fit;
}
