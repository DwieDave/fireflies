// The scratchpad: a Markdown note that belongs to a repository but isn't in
// it. Shared by nocturne (the command that opens it: nocturne.scratchpad) and
// editor (the pane that edits it, saving as it's typed). A mod can
// import only its own files, so each ships this same file;
// scripts/nocturne-scratchpad.test.ts fails when the copies differ: edit
// editor/scratch.ts and copy it over.
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
// belongs to ({ name, dir, machine?, repo }), for agents and people looking for one.

import type { ExecResult, exec as herdrExec, readTextFile as herdrRead, writeTextFile as herdrWrite } from "herdr";
import type { Guarded } from "./guard.ts";
import { isBoolean, isString, object, parseJsonMap } from "./guard.ts";

export const DIR = "scratchpad";
export const INDEX = "index.json";

/** Saved this long after the last key (ms); closing the pane saves at once. */
export const AUTOSAVE = 600;

/** What a note belongs to: the repository's name, its common dir (else the
 *  folder), and whether a git repository holds it. */
export interface Owner {
  readonly name: string;
  readonly dir: string;
  readonly repo: boolean;
}

/** A note found for a folder: where it is, and what it belongs to. */
export interface Note extends Owner {
  readonly path: string;
}

/** An entry of index.json (the note's file name is its key). */
export const isIndexEntry = object({ name: isString, dir: isString }, { machine: isString, repo: isBoolean });

export type IndexEntry = Guarded<typeof isIndexEntry>;

/** What locate() reads and writes with (herdr's, or a test's stand-ins). */
export interface ScratchIo {
  readonly exec: typeof herdrExec;
  readonly appHome: string;
  readonly readTextFile: typeof herdrRead;
  readonly writeTextFile: typeof herdrWrite;
}

/** A short, stable hash of a string (FNV-1a, 8 hex digits). */
export function hash(s: string): string {
  let h = 0x811c9dc5;

  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }

  return (h >>> 0).toString(16).padStart(8, "0");
}

const trimSlash = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, "") : p);
const base = (p: string): string => trimSlash(p).split("/").pop() || p;

const parent = (p: string): string => {
  const t = trimSlash(p);
  const i = t.lastIndexOf("/");

  return i > 0 ? t.slice(0, i) : "/";
};

function normalize(p: string): string {
  const out: string[] = [];

  for (const part of p.split("/")) {
    if (!part || part === ".") continue;

    if (part === "..") out.pop();
    else out.push(part);
  }

  return "/" + out.join("/");
}

/** A path made absolute against `cwd` (git prints the common dir relative to it, ".git" in the main worktree). */
export function absolute(path: string, cwd: string): string {
  const p = path.trim();

  return normalize(p.startsWith("/") ? p : `${trimSlash(cwd)}/${p}`);
}

/** The repository's name from its common dir: `~/code/app/.git` -> app,
 *  a bare `~/code/app.git` -> app, a submodule's `.git/modules/x` -> x. */
export function repoName(commonDir: string): string {
  const d = trimSlash(commonDir);

  if (base(d) === ".git") return base(parent(d));

  return base(d).replace(/\.git$/, "") || "repo";
}

/** What a folder's note belongs to. `exec` is herdr's; `on`: the machine of a
 *  space on another one. */
export async function owner(exec: typeof herdrExec, folder: string, on: string | null = null): Promise<Owner> {
  // Absolute and resolved (git 2.31+): a main worktree's ".git" and a linked
  // worktree's /private/var/… path name one folder only so. Older git: as printed.
  const ask = (args: readonly string[]): Promise<ExecResult | null> =>
    exec("git", ["rev-parse", ...args, "--git-common-dir"], on ? { cwd: folder, on } : { cwd: folder }).catch(() => null);

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
export function fileName(who: Pick<Owner, "name" | "dir">, on: string | null = null): string {
  const safe = who.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "note";

  return `${safe}-${hash(`${on ? `${on}:` : ""}${who.dir}`)}.md`;
}

/** The note's path under the app's folder. */
export function notePath(appHome: string, who: Pick<Owner, "name" | "dir">, on: string | null = null): string {
  return `${trimSlash(appHome)}/${DIR}/${fileName(who, on)}`;
}

/** Whether `path` is a scratchpad note (under `<app home>/scratchpad/`). */
export function isNote(path: string | null | undefined, appHome: string | null | undefined): boolean {
  const p = path ?? "";

  if (!appHome) return false;

  const folder = `${trimSlash(appHome)}/${DIR}/`;

  return p.startsWith(folder) && p.endsWith(".md") && !p.slice(folder.length).includes("/");
}

/** The repository's name back from a note's file name (`app-1a2b3c4d.md` -> app). */
export function noteName(path: string): string {
  const m = /([^/]+)-[0-9a-f]{8}\.md$/.exec(path);

  return m?.[1] ?? base(path).replace(/\.md$/, "");
}

/** The index with this note in it (a new map; the same one when it's there already). */
export function indexed(index: ReadonlyMap<string, IndexEntry>, path: string, who: Owner, on: string | null = null): ReadonlyMap<string, IndexEntry> {
  const key = base(path);
  const entry: IndexEntry = on ? { name: who.name, dir: who.dir, machine: on, repo: who.repo } : { name: who.name, dir: who.dir, repo: who.repo };
  const was = index.get(key);

  if (was && was.name === entry.name && was.dir === entry.dir && (was.machine ?? null) === on && was.repo === entry.repo) return index;

  return new Map([...index, [key, entry]]);
}

/** Finds (and records in the index) the note for a folder. The index is a
 *  nicety: failing to write it doesn't stop the note opening. */
export async function locate(io: ScratchIo, folder: string, on: string | null = null): Promise<Note> {
  const who = await owner(io.exec, folder, on);
  const path = notePath(io.appHome, who, on);
  const indexPath = `${trimSlash(io.appHome)}/${DIR}/${INDEX}`;

  try {
    const text = await io.readTextFile(indexPath);
    const index = (text ? parseJsonMap(text, isIndexEntry) : undefined) ?? new Map<string, IndexEntry>();
    const next = indexed(index, path, who, on);

    if (next !== index) await io.writeTextFile(indexPath, JSON.stringify(Object.fromEntries(next), null, 2) + "\n", text);
  } catch {
    // A nicety.
  }

  return { path, ...who };
}

/** Where an autosave is: written, waiting out the delay, writing, or the last write failed. */
export type AutosaveState = "saved" | "pending" | "saving" | "error";

/** What an Autosave writes with: the save, a timer (`fn` returns the write; the
 *  timer returns a cancel function), the delay, and who hears its state. */
export interface AutosaveOptions {
  readonly write: () => Promise<void>;
  readonly timer: (ms: number, fn: () => Promise<void>) => () => void;
  readonly delay?: number;
  readonly onState?: (state: AutosaveState) => void;
}

/** Saving as it's typed: `touch()` on every change writes `delay` ms after the
 *  last one; `flush()` writes now (closing the pane). */
export class Autosave {
  state: AutosaveState = "saved";
  /** When the last write ended (ms). */
  at: number | null = null;
  private readonly options: AutosaveOptions;
  private cancel: (() => void) | null = null;
  /** The write under way. */
  private running: Promise<void> | null = null;
  /** A change came while writing: write once more after. */
  private again = false;

  constructor(options: AutosaveOptions) {
    this.options = options;
  }

  private set(state: AutosaveState): void {
    if (this.state === state) return;

    this.state = state;
    this.options.onState?.(state);
  }

  /** A change: (re)starts the wait. */
  touch(): void {
    this.cancel?.();
    this.set("pending");
    this.cancel = this.options.timer(this.options.delay ?? AUTOSAVE, () => {
      this.cancel = null;

      return this.run();
    });
  }

  /** Writes now if anything waits; resolves once what's typed is written. */
  async flush(): Promise<void> {
    if (this.cancel) {
      this.cancel();
      this.cancel = null;

      return this.run();
    }

    if (this.running) return this.running;
  }

  private run(): Promise<void> {
    if (this.running) {
      this.again = true;

      return this.running;
    }

    this.set("saving");
    this.running = this.writeOnce();

    return this.running;
  }

  private async writeOnce(): Promise<void> {
    let ok = true;

    try {
      await this.options.write();
    } catch {
      ok = false;
    }

    this.running = null;
    this.at = Date.now();

    if (this.again) {
      this.again = false;

      return this.run();
    }

    // Typed again while it wrote: that wait is still on, and the state says so
    // (a "saved" note would let a change on disk replace what's typed).
    this.set(!ok ? "error" : this.cancel ? "pending" : "saved");
  }
}
