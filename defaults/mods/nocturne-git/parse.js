// Reading git's plain output into the panels' rows. Pure: no herdr, so the
// tests run them on fixtures (scripts/nocturne-git.test.ts). The formats are
// what git.js asks for: NUL-separated fields, porcelain v2 status.

export const SEP = "\x1f"; // field separator in --format strings (%x1f)

/** `git status --porcelain=v2 --branch -z --untracked-files=all`: the branch
 *  line and every changed path with lazygit's two status letters (index, work
 *  tree: "M ", " M", "MM", "A ", "??", "UU"…). */
export function parseStatus(text) {
  const out = { head: null, oid: null, upstream: null, ahead: 0, behind: 0, files: [] };
  const parts = text.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line) continue;
    if (line.startsWith("# ")) {
      const [, key, ...rest] = line.split(" ");
      const val = rest.join(" ");
      if (key === "branch.head") out.head = val === "(detached)" ? null : val;
      else if (key === "branch.oid") out.oid = val === "(initial)" ? null : val;
      else if (key === "branch.upstream") out.upstream = val;
      else if (key === "branch.ab") {
        const m = /\+(\d+) -(\d+)/.exec(val);
        if (m) { out.ahead = +m[1]; out.behind = +m[2]; }
      }
      continue;
    }
    const kind = line[0];
    if (kind === "1") {
      const f = line.split(" ");
      out.files.push(file(f[1], f.slice(8).join(" ")));
    } else if (kind === "2") {
      const f = line.split(" ");
      const entry = file(f[1], f.slice(9).join(" "));
      entry.from = parts[++i] ?? null;
      out.files.push(entry);
    } else if (kind === "u") {
      const f = line.split(" ");
      const entry = file(f[1], f.slice(10).join(" "));
      entry.conflict = true;
      out.files.push(entry);
    } else if (kind === "?") {
      out.files.push(file("??", line.slice(2)));
    }
  }
  out.files.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function file(xy, path) {
  const x = xy[0] === "." ? " " : xy[0], y = xy[1] === "." ? " " : xy[1];
  const untracked = xy === "??";
  return {
    path, from: null, x: untracked ? "?" : x, y: untracked ? "?" : y,
    staged: !untracked && x !== " " && x !== "?",
    unstaged: untracked || (y !== " "),
    untracked, conflict: x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D"),
  };
}

/** The status letters lazygit shows: "M ", " M", "??"… */
export const letters = (f) => (f.untracked ? "??" : `${f.x}${f.y}`);

/** `git for-each-ref refs/heads --format=BRANCH_FORMAT`. */
export const BRANCH_FORMAT = ["%(HEAD)", "%(refname:short)", "%(upstream:short)", "%(upstream:track)", "%(committerdate:unix)", "%(objectname)", "%(subject)"].join("%1f");

export function parseBranches(text) {
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [head, name, upstream, track, date, oid, subject] = line.split(SEP);
    const ab = trackOf(track ?? "");
    out.push({ head: head === "*", name, upstream: upstream || null, ...ab, date: +date || 0, oid, subject: subject ?? "" });
  }
  // The checked-out branch first, then by recency (lazygit's default sort).
  out.sort((a, b) => (b.head - a.head) || (b.date - a.date));
  return out;
}

/** "[ahead 2, behind 1]" / "[gone]" / "". */
export function trackOf(track) {
  return {
    gone: /\bgone\b/.test(track),
    ahead: +(/ahead (\d+)/.exec(track)?.[1] ?? 0),
    behind: +(/behind (\d+)/.exec(track)?.[1] ?? 0),
  };
}

/** `git for-each-ref refs/remotes --format=REMOTE_BRANCH_FORMAT`. */
export const REMOTE_BRANCH_FORMAT = ["%(refname:short)", "%(committerdate:unix)", "%(objectname)", "%(subject)", "%(symref)"].join("%1f");

export function parseRemoteBranches(text) {
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [name, date, oid, subject, symref] = line.split(SEP);
    if (symref) continue; // origin/HEAD -> origin/main
    const slash = name.indexOf("/");
    if (slash < 0) continue; // the bare remote name for-each-ref gives a symref
    out.push({ name, remote: name.slice(0, slash), branch: name.slice(slash + 1), date: +date || 0, oid, subject: subject ?? "" });
  }
  out.sort((a, b) => b.date - a.date);
  return out;
}

/** `git remote -v`: each remote once, with its fetch url. */
export function parseRemotes(text) {
  const seen = new Map();
  for (const line of text.split("\n")) {
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
    if (!m) continue;
    const r = seen.get(m[1]) ?? { name: m[1], url: m[2], push: m[2] };
    if (m[3] === "fetch") r.url = m[2]; else r.push = m[2];
    seen.set(m[1], r);
  }
  return [...seen.values()];
}

/** `git for-each-ref refs/tags --sort=-creatordate --format=TAG_FORMAT`. */
export const TAG_FORMAT = ["%(refname:short)", "%(creatordate:unix)", "%(objectname)", "%(*objectname)", "%(contents:subject)"].join("%1f");

export function parseTags(text) {
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [name, date, oid, peeled, subject] = line.split(SEP);
    out.push({ name, date: +date || 0, oid: peeled || oid, annotated: Boolean(peeled), subject: subject ?? "" });
  }
  return out;
}

/** `git log --format=LOG_FORMAT`: hash, parents, author, dates, refs, subject. */
export const LOG_FORMAT = ["%H", "%P", "%an", "%ae", "%at", "%D", "%s"].join("%x1f");

export function parseLog(text) {
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [hash, parents, author, email, date, refs, ...subject] = line.split(SEP);
    out.push({ hash, short: hash.slice(0, 7), parents: parents ? parents.split(" ") : [], author, email, date: +date || 0, refs: parseRefs(refs ?? ""), subject: subject.join(SEP) });
  }
  return out;
}

/** `git log --format=LOG_FULL_FORMAT`: as parseLog, with the whole message
 *  (body included), records ended by %x1e (a message can span lines). */
export const LOG_FULL_FORMAT = ["%H", "%P", "%an", "%ae", "%at", "%D", "%B"].join("%x1f") + "%x1e";

export function parseLogFull(text) {
  const out = [];
  for (let rec of text.split("\x1e")) {
    rec = rec.replace(/^\n+/, "");
    if (!rec.trim()) continue;
    const [hash, parents, author, email, date, refs, ...body] = rec.split(SEP);
    const message = body.join(SEP).replace(/\s+$/, "");
    out.push({ hash, short: hash.slice(0, 7), parents: parents ? parents.split(" ") : [], author, email, date: +date || 0, refs: parseRefs(refs ?? ""), subject: message.split("\n")[0], message });
  }
  return out;
}

/** git's relative date: "8 minutes ago", "2 days ago", "3 months ago". */
export function relativeDate(unix, now = Date.now() / 1000) {
  const s = Math.max(0, Math.round(now - unix));
  const n = (v, unit) => `${v} ${unit}${v === 1 ? "" : "s"} ago`;
  if (s < 90) return n(s, "second");
  if (s < 90 * 60) return n(Math.round(s / 60), "minute");
  if (s < 36 * 3600) return n(Math.round(s / 3600), "hour");
  if (s < 14 * 86400) return n(Math.round(s / 86400), "day");
  if (s < 10 * 7 * 86400) return n(Math.round(s / (7 * 86400)), "week");
  if (s < 365 * 86400) return n(Math.round(s / (30 * 86400)), "month");
  return n(Math.round(s / (365 * 86400)), "year");
}

/** %D: "HEAD -> main, origin/main, tag: v1" into [{ kind, name }]. */
export function parseRefs(d) {
  const out = [];
  for (let s of d.split(", ")) {
    s = s.trim();
    if (!s) continue;
    // Full names (git log --decorate=full) say what a ref is; a short name
    // with a slash could be a local feat/x or a remote's origin/x.
    if (s.startsWith("HEAD -> ")) out.push({ kind: "head", name: s.slice(8).replace(/^refs\/heads\//, "") });
    else if (s === "HEAD") out.push({ kind: "detached", name: "HEAD" });
    else if (s.startsWith("tag: ")) out.push({ kind: "tag", name: s.slice(5).replace(/^refs\/tags\//, "") });
    else if (s.endsWith("/HEAD")) continue;
    else if (s.startsWith("refs/heads/")) out.push({ kind: "branch", name: s.slice(11) });
    else if (s.startsWith("refs/remotes/")) out.push({ kind: "ref", name: s.slice(13) });
    else if (s.startsWith("refs/")) out.push({ kind: "ref", name: s.replace(/^refs\/[^/]+\//, "") });
    else out.push({ kind: s.includes("/") ? "ref" : "branch", name: s });
  }
  return out;
}

/** `git log -g --format=REFLOG_FORMAT`: the reflog, newest first. */
export const REFLOG_FORMAT = ["%H", "%gd", "%gs", "%ct"].join("%x1f");

export function parseReflog(text) {
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [hash, selector, subject, date] = line.split(SEP);
    out.push({ hash, short: hash.slice(0, 7), selector, subject: subject ?? "", date: +date || 0 });
  }
  return out;
}

/** `git stash list --format=STASH_FORMAT`. */
export const STASH_FORMAT = ["%gd", "%ct", "%gs", "%H"].join("%x1f");

export function parseStash(text) {
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [ref, date, subject, hash] = line.split(SEP);
    const index = +(/\{(\d+)\}/.exec(ref)?.[1] ?? out.length);
    out.push({ ref, index, date: +date || 0, subject: subject ?? "", hash });
  }
  return out;
}

/** `git worktree list --porcelain`. */
export function parseWorktrees(text) {
  const out = [];
  let w = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("worktree ")) { w = { path: line.slice(9), head: null, branch: null, bare: false, detached: false, locked: false, prunable: false }; out.push(w); }
    else if (!w) continue;
    else if (line.startsWith("HEAD ")) w.head = line.slice(5);
    else if (line.startsWith("branch ")) w.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (line === "bare") w.bare = true;
    else if (line === "detached") w.detached = true;
    else if (line.startsWith("locked")) w.locked = true;
    else if (line.startsWith("prunable")) w.prunable = true;
  }
  return out;
}

/** What the repo is in the middle of, from the files under .git (git.js reads which exist). */
export function repoState(exists) {
  if (exists["rebase-merge"] || exists["rebase-apply"]) return "rebasing";
  if (exists.MERGE_HEAD) return "merging";
  if (exists.CHERRY_PICK_HEAD) return "cherry-picking";
  if (exists.REVERT_HEAD) return "reverting";
  if (exists.BISECT_LOG) return "bisecting";
  return null;
}

/** Short age: "4m", "3h", "2d", "5w", "1y" (lazygit's recency column). */
export function age(unix, now = Date.now() / 1000) {
  const s = Math.max(0, now - unix);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 7))}w`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

/** Initials for the author column: "Developer Stahl-Gruber" -> "DS". */
export function initials(name) {
  const words = String(name ?? "").split(/[\s._]+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** The files as a tree: directories first, folded where `collapsed` says,
 *  single-child directories joined ("src/keys/shipped"). Each row: { kind:
 *  "dir" | "file", path, name, depth, file?, files (under a dir) }. */
export function fileTree(files, collapsed = new Set()) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (const p of parts.slice(0, -1)) {
      if (!node.dirs.has(p)) node.dirs.set(p, { dirs: new Map(), files: [] });
      node = node.dirs.get(p);
    }
    node.files.push(f);
  }
  const rows = [];
  const all = (n) => [...n.files, ...[...n.dirs.values()].flatMap(all)];
  const walk = (node, prefix, depth) => {
    for (const [name, child] of [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      // Join a chain of directories that hold one directory and nothing else.
      let label = name, path = prefix ? `${prefix}/${name}` : name, n = child;
      while (n.files.length === 0 && n.dirs.size === 1) {
        const [[k, v]] = [...n.dirs.entries()];
        label += `/${k}`; path += `/${k}`; n = v;
      }
      const under = all(n);
      rows.push({ kind: "dir", path, name: label, depth, files: under, open: !collapsed.has(path) });
      if (!collapsed.has(path)) walk(n, path, depth + 1);
    }
    for (const f of node.files.sort((a, b) => a.path.localeCompare(b.path))) {
      rows.push({ kind: "file", path: f.path, name: f.path.split("/").pop(), depth, file: f });
    }
  };
  walk(root, "", 0);
  return rows;
}

/** A directory's status letters: staged if all its files are, etc. */
export function dirLetters(files) {
  const x = files.every((f) => f.staged && !f.unstaged) ? "M" : files.some((f) => f.staged) ? "M" : " ";
  const y = files.some((f) => f.unstaged) ? (files.every((f) => f.untracked) ? "?" : "M") : " ";
  return { x, y, staged: files.every((f) => f.staged && !f.unstaged), some: files.some((f) => f.staged) };
}
