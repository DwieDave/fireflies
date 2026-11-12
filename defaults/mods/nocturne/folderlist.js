// The new-space picker's list (newspace.js), without drawing or asking
// anything: where the folders come from and in what order, the fuzzy match,
// the typed path and its completion, a space's name from its folder. No
// imports, so its tests run it as is.
//
// Sources, best first, each folder once:
//   here     the focused pane's folder (its git checkout's top when in one)
//   spaces   every space's folder (a second space on a repo is common)
//   near     git checkouts and worktrees beside those folders, and the
//            worktrees of their repos
//   recent   folders spaces were made in or attached to here before
// Home is never a row: "no folder" (a space starting in ~) is its own row.

/** How many recent folders are kept (shared(RECENT)). */
export const RECENT_MAX = 20;
/** How many near folders are listed before typing narrows them. */
export const NEAR_MAX = 12;

/** `p` with home as ~. */
export function tilde(p, home) {
  if (!p) return p;
  return p === home ? "~" : home && p.startsWith(home + "/") ? "~" + p.slice(home.length) : p;
}

/** A typed folder as a path: ~ is home, a relative one is under home, no trailing /. */
export function untilde(p, home) {
  let out = p === "~" ? home : p.startsWith("~/") ? home + p.slice(1) : p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) ? p : `${home}/${p}`;
  while (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

/** A folder's last name: what a space made in it is called when nobody names it. */
export function folderName(p, home) {
  if (!p || p === home) return "~";
  const parts = p.replace(/\/+$/, "").split("/");
  return parts.at(-1) || "/";
}

/** The parent folder of `p` ("/" at the top). */
export function parentOf(p) {
  const s = p.replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  return i <= 0 ? "/" : s.slice(0, i);
}

/** Typing a path: the field starts with ~ or /. */
export const isPath = (q) => /^(~|\/)/.test(q.trim());

/** A typed path split where the folder ends: `dir` (absolute) to list, the
 *  `prefix` of a name in it, and `shown`: the dir as typed, ending in /.
 *  "~/co" → { dir: home, prefix: "co", shown: "~/" }. */
export function splitPath(q, home) {
  const s = q.trim();
  if (s === "~") return { dir: home, prefix: "", shown: "~/" };
  const cut = s.lastIndexOf("/");
  const shown = s.slice(0, cut + 1);
  return { dir: untilde(shown || "/", home), prefix: s.slice(cut + 1), shown };
}

/**
 * Fuzzy: `q`'s letters in order in `text`, case-insensitive. Null when they
 * aren't; else a score (letters in a run, at the start or after a separator
 * count more; a short text more) and the matched letters' places.
 */
export function fuzzy(q, text) {
  const needle = q.toLowerCase(), hay = text.toLowerCase();
  if (!needle) return { score: 0, hits: [] };
  const hits = [];
  let score = 0, from = 0, last = -2;
  for (const ch of needle) {
    const i = hay.indexOf(ch, from);
    if (i < 0) return null;
    hits.push(i);
    score += 1 + (i === last + 1 ? 3 : 0) + (i === 0 || /[-_./ ]/.test(hay[i - 1]) ? 2 : 0);
    last = i;
    from = i + 1;
  }
  return { score: score - hay.length * 0.02, hits };
}

/**
 * The listed folders in order, each once, home and empty ones left out.
 * `here`: a path or null; `spaces`: [{ path, branch? }]; `near`: [{ path,
 * worktree? }]; `recent`: paths. A row: { path, name, from, tag }, where
 * `tag` is the branch, "worktree", "git", or "".
 */
export function sources({ here = null, spaces = [], near = [], recent = [], home = "", git = new Set() }) {
  const seen = new Set([home, ""]);
  const out = [];
  const add = (path, from, tag = "") => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    out.push({ path, name: folderName(path, home), from, tag });
  };
  if (here) add(here.path ?? here, "here", here.branch ?? (git.has(here.path ?? here) ? "git" : ""));
  for (const s of spaces) add(s.path, "spaces", s.branch ?? (git.has(s.path) ? "git" : ""));
  for (const n of near.slice(0, NEAR_MAX)) add(n.path, "near", n.worktree ? "worktree" : "git");
  for (const r of recent) add(r, "recent", git.has(r) ? "git" : "");
  return out;
}

/** The rows matching `q`, best first: a match on the name beats one on the
 *  path; ties keep the sources' order. Each gets `hits` (places in its name). */
export function rank(rows, q, home) {
  const s = q.trim();
  if (!s) return rows.map((r) => ({ ...r, hits: [] }));
  return rows
    .map((r, i) => {
      const name = fuzzy(s, r.name);
      const path = name ? null : fuzzy(s, tilde(r.path, home));
      const best = name ? { score: name.score + 10, hits: name.hits } : path && { score: path.score, hits: [] };
      return best && { ...r, hits: best.hits, score: best.score, i };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ score: _s, i: _i, ...r }) => r);
}

/**
 * The rows for a typed path: the folder itself first when the field ends
 * in / (enter takes it), then its subfolders starting with the prefix
 * (case-insensitive; hidden ones only once the prefix starts with a dot),
 * then the others that merely contain it. `names`: the folder's subfolder
 * names; `git`: the ones that are checkouts.
 */
export function pathRows(q, home, names, git = new Set()) {
  const { dir, prefix, shown } = splitPath(q, home);
  const p = prefix.toLowerCase();
  const visible = names.filter((n) => p.startsWith(".") || !n.startsWith(".")).sort((a, b) => a.localeCompare(b));
  const starts = visible.filter((n) => n.toLowerCase().startsWith(p));
  const inside = p ? visible.filter((n) => !n.toLowerCase().startsWith(p) && n.toLowerCase().includes(p)) : [];
  const row = (n) => {
    const path = dir === "/" ? `/${n}` : `${dir}/${n}`;
    const at = n.toLowerCase().indexOf(p);
    return { path, name: n, from: "path", tag: git.has(n) ? "git" : "", hits: p ? [...p].map((_, k) => at + k) : [] };
  };
  const self = !prefix && dir !== home ? [{ path: dir, name: folderName(dir, home), from: "self", tag: git.has(".") ? "git" : "", hits: [] }] : [];
  return { dir, shown, rows: [...self, ...starts.map(row), ...inside.map(row)] };
}

/** What tab makes of the field with `row` under the cursor: its path, ~'d, with a / to step inside. */
export function complete(row, home) {
  if (!row?.path) return null;
  const t = tilde(row.path, home);
  return t.endsWith("/") ? t : `${t}/`;
}

/** What the dim rest of the field shows: the cursor row's name past the typed prefix. */
export function ghost(q, row, home) {
  if (!row?.path || !isPath(q)) return "";
  const { prefix } = splitPath(q, home);
  if (!prefix || row.from === "self" || !row.name.toLowerCase().startsWith(prefix.toLowerCase())) return "";
  return `${row.name.slice(prefix.length)}/`;
}

/** The field one folder up (shift-tab while typing a path): "~/a/b/" → "~/a/". */
export function up(q) {
  const s = q.trim().replace(/\/+$/, "");
  if (!s || s === "~" || s === "") return q;
  const cut = s.lastIndexOf("/");
  return cut < 0 ? q : s.slice(0, cut + 1);
}

/** The recent list with `path` first, at most RECENT_MAX. */
export function remember(list, path) {
  const old = Array.isArray(list) ? list.filter((p) => typeof p === "string" && p !== path) : [];
  return [path, ...old].slice(0, RECENT_MAX);
}

/** The space.new arguments for `folder` (null: no folder, a space in home)
 *  and a typed `name` (its folder's name, or empty: unnamed, so Herdr calls
 *  it after its folder). */
export function newArgs(folder, name, home) {
  const n = (name ?? "").trim();
  const path = folder ?? home;
  const named = n && n !== folderName(path, home) ? { name: n } : {};
  return { ...named, folder: path, machine: "" };
}

/** The parents to look beside: each folder's and its repo's main checkout's, each once, home's own not. */
export function nearParents(folders, home) {
  const out = [];
  for (const f of folders) {
    if (!f || f === home) continue;
    const p = parentOf(f);
    if (p !== "/" && !out.includes(p)) out.push(p);
  }
  return out;
}

/** `git worktree list --porcelain` → the worktree paths. */
export function worktreePaths(stdout) {
  return String(stdout ?? "").split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9).trim()).filter(Boolean);
}

/** `find <parent> -mindepth 2 -maxdepth 2 -name .git` → [{ path, worktree }]:
 *  a .git folder is a checkout, a .git file a linked worktree (`files`: the
 *  ones `-type f` found). */
export function checkoutsFrom(stdout, files = new Set()) {
  return String(stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean)
    .map((g) => ({ path: g.replace(/\/\.git$/, ""), worktree: files.has(g) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** `s` at most `n` characters, its end kept: "…/coding/fireflies" (cut at a / when one is near). */
export function tail(s, n) {
  const str = String(s ?? "");
  const max = Math.max(4, n);
  if (str.length <= max) return str;
  const rest = str.slice(str.length - (max - 1));
  const cut = rest.indexOf("/");
  return `…${cut > 0 && cut < rest.length / 2 ? rest.slice(cut) : rest}`;
}
