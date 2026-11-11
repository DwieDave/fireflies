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
