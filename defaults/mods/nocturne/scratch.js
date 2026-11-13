// The scratchpad: a Markdown note that belongs to a repository but isn't in
// it. Shared by nocturne (the command that opens it: nocturne.scratchpad) and
// editor (the pane that edits it, saving as it's typed). A mod can
// import only its own files, so each ships this same file;
// scripts/nocturne-scratchpad.test.ts fails when the copies differ: edit
// editor/scratch.js and copy it over.
//
// Where a note lives: `<app home>/scratchpad/<name>-<hash>.md`, one per
// repository. The repository is found by git's common dir (`git rev-parse
// --git-common-dir`), which every worktree of a repository shares, so each
// worktree opens the same note (git's resolved path: a symlinked folder and its
// target are one repository). `name` is the repository's folder name,
// `hash` a short hash of the common dir (and the machine, for a space on
// another machine), so two repositories with one name keep two notes. A
// folder outside any repository gets a note of its own the same way.
// `<app home>/scratchpad/index.json` maps each note's file name to what it
// belongs to ({ name, dir, machine }), for agents and people looking for one.

export const DIR = "scratchpad";
export const INDEX = "index.json";
// Saved this long after the last key (ms); closing the pane saves at once.
export const AUTOSAVE = 600;

/** A short, stable hash of a string (FNV-1a, 8 hex digits). */
export function hash(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const trimSlash = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
const base = (p) => trimSlash(p).split("/").pop() || p;
const parent = (p) => { const t = trimSlash(p); const i = t.lastIndexOf("/"); return i > 0 ? t.slice(0, i) : "/"; };

/** A path made absolute against `cwd` (git prints the common dir relative to it, ".git" in the main worktree). */
export function absolute(path, cwd) {
  const p = String(path).trim();
  if (p.startsWith("/")) return normalize(p);
  return normalize(`${trimSlash(cwd)}/${p}`);
}

function normalize(p) {
  const out = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop(); else out.push(part);
  }
  return "/" + out.join("/");
}

/** The repository's name from its common dir: `~/code/app/.git` -> app,
 *  a bare `~/code/app.git` -> app, a submodule's `.git/modules/x` -> x. */
export function repoName(commonDir) {
  const d = trimSlash(commonDir);
  if (base(d) === ".git") return base(parent(d));
  return base(d).replace(/\.git$/, "") || "repo";
}

/** What a folder's note belongs to: { name, dir, repo } (repo: whether a git
 *  repository holds it; dir: its common dir, else the folder). `exec` is
 *  herdr's; `on`: the machine of a space on another one. */
export async function owner(exec, folder, on = null) {
  // Absolute and resolved (git 2.31+): a main worktree's ".git" and a linked
  // worktree's /private/var/… path name one folder only so. Older git: as printed.
  const ask = (args) => exec("git", ["rev-parse", ...args, "--git-common-dir"], { cwd: folder, ...(on ? { on } : {}) }).catch(() => null);
  let r = await ask(["--path-format=absolute"]);
  if (r?.code !== 0 && /path-format/.test(r?.stderr ?? "")) r = await ask([]);
  const out = r?.code === 0 ? r.stdout.trim() : "";
  if (out) {
    const dir = absolute(out, folder);
    return { name: repoName(dir), dir, repo: true };
  }
  const dir = trimSlash(folder);
  return { name: base(dir) || "home", dir, repo: false };
}

/** A note's file name: the name made safe for a file, and the hash. */
export function fileName({ name, dir }, on = null) {
  const safe = String(name).replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "note";
  return `${safe}-${hash(`${on ? `${on}:` : ""}${dir}`)}.md`;
}

/** The note's path under the app's folder. */
export function notePath(appHome, who, on = null) {
  return `${trimSlash(appHome)}/${DIR}/${fileName(who, on)}`;
}

/** Whether `path` is a scratchpad note (under `<app home>/scratchpad/`). */
export function isNote(path, appHome) {
  const p = String(path ?? "");
  return Boolean(appHome) && p.startsWith(`${trimSlash(appHome)}/${DIR}/`) && p.endsWith(".md") && !p.slice(trimSlash(appHome).length + DIR.length + 2).includes("/");
}

/** The repository's name back from a note's file name (`app-1a2b3c4d.md` -> app). */
export function noteName(path) {
  const m = /([^/]+)-[0-9a-f]{8}\.md$/.exec(String(path));
  return m ? m[1] : base(String(path)).replace(/\.md$/, "");
}

/** The index with this note in it (a new object; the same one when it's there already). */
export function indexed(index, path, who, on = null) {
  const key = base(path);
  const entry = { name: who.name, dir: who.dir, ...(on ? { machine: on } : {}), repo: Boolean(who.repo) };
  const was = index?.[key];
  if (was && was.name === entry.name && was.dir === entry.dir && (was.machine ?? null) === (on ?? null) && was.repo === entry.repo) return index;
  return { ...(index ?? {}), [key]: entry };
}

/** Finds (and records in the index) the note for a folder: -> { path, name, dir, repo }.
 *  `io`: { exec, appHome, readTextFile, writeTextFile }. The index is a nicety:
 *  failing to write it doesn't stop the note opening. */
export async function locate(io, folder, on = null) {
  const who = await owner(io.exec, folder, on);
  const path = notePath(io.appHome, who, on);
  const indexPath = `${trimSlash(io.appHome)}/${DIR}/${INDEX}`;
  try {
    const text = await io.readTextFile(indexPath);
    let index = {};
    try { index = text ? JSON.parse(text) : {}; } catch { index = {}; }
    const next = indexed(index, path, who, on);
    if (next !== index) await io.writeTextFile(indexPath, JSON.stringify(next, null, 2) + "\n", text ?? null);
  } catch { /* a nicety */ }
  return { path, ...who };
}

/** Saving as it's typed: `touch()` on every change writes `delay` ms after the
 *  last one; `flush()` writes now (closing the pane). `write()` is the save
 *  (async); `timer(ms, fn)` schedules `fn` (it returns the write) and returns a cancel function. The
 *  state: "saved" | "pending" (waiting out the delay) | "saving" | "error". */
export class Autosave {
  constructor({ write, timer, delay = AUTOSAVE, onState }) {
    this.write = write;
    this.timer = timer;
    this.delay = delay;
    this.onState = onState ?? (() => {});
    this.state = "saved";
    this.cancel = null;
    this.running = null; // the write under way
    this.again = false; // a change came while writing: write once more after
    this.at = null; // when the last write ended (ms)
  }

  set(state) { if (this.state !== state) { this.state = state; this.onState(state); } }

  /** A change: (re)starts the wait. */
  touch() {
    this.cancel?.();
    this.set("pending");
    this.cancel = this.timer(this.delay, () => { this.cancel = null; return this.run(); });
  }

  /** Writes now if anything waits; resolves once what's typed is written. */
  async flush() {
    if (this.cancel) { this.cancel(); this.cancel = null; return this.run(); }
    if (this.running) return this.running;
  }

  async run() {
    if (this.running) { this.again = true; return this.running; }
    this.set("saving");
    this.running = (async () => {
      let ok = true;
      try { await this.write(); } catch { ok = false; }
      this.running = null;
      this.at = Date.now();
      if (this.again) { this.again = false; return this.run(); }
      // Typed again while it wrote: that wait is still on, and the state says so
      // (a "saved" note would let a change on disk replace what's typed).
      this.set(!ok ? "error" : this.cancel ? "pending" : "saved");
    })();
    return this.running;
  }
}
