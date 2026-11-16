// @fireflies/scratch: the scratchpad, a Markdown note that belongs to a
// repository but isn't in it. Used by nocturne (the command that opens it:
// nocturne.scratchpad) and editor (the pane that edits it, saving as it's
// typed). A library (docs/effect-mods.md): the app serves this one copy to
// both by name (`import { locate } from "@fireflies/scratch"`).
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
//
// The finding runs on the kit's services (`ownerOf`, `locateIn`: `Exec`,
// `Files`); `owner` and `locate` run them over the functions a caller hands
// in (herdr's, or a test's).

import { Array as Arr, DateTime, Effect, Option, Predicate, Record as Rec, Schema, String as Str } from "effect";
import { Exec, Files, execService, filesService } from "@fireflies/kit";
import type { exec as herdrExec, readTextFile as herdrRead, writeTextFile as herdrWrite } from "herdr";

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
export const IndexEntrySchema = Schema.Struct({
  name: Schema.String,
  dir: Schema.String,
  machine: Schema.optionalKey(Schema.String),
  repo: Schema.optionalKey(Schema.Boolean),
});

export type IndexEntry = typeof IndexEntrySchema.Type;

export const isIndexEntry: (value: unknown) => value is IndexEntry = Schema.is(IndexEntrySchema);

/** index.json as read: JSON whose entries are each looked at on their own (one
 *  in another shape is left out, the others kept). */
const readIndexText = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));

/** index.json as written: two-space indented, for people and agents reading it. */
const writeIndexText = Schema.encodeOption(Schema.fromJsonString(Schema.Record(Schema.String, IndexEntrySchema), { space: 2 }));

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
    h ^= Option.getOrElse(Str.charCodeAt(i)(s), () => 0);
    h = Math.imul(h, 0x01000193);
  }

  return Str.padStart(8, "0")((h >>> 0).toString(16));
}

const trimSlash = (p: string): string => (p.length > 1 ? Str.replace(/\/+$/, "")(p) : p);

const base = (p: string): string => {
  const last = Option.getOrElse(Arr.last(Str.split(trimSlash(p), "/")), () => "");

  return last === "" ? p : last;
};

const parent = (p: string): string => {
  const t = trimSlash(p);

  return Option.match(Option.filter(Str.lastIndexOf("/")(t), (i) => i > 0), { onNone: () => "/", onSome: (i) => Str.slice(0, i)(t) });
};

function normalize(p: string): string {
  const out: string[] = [];

  for (const part of Str.split(p, "/")) {
    if (part === "" || part === ".") continue;

    if (part === "..") out.pop();
    else out.push(part);
  }

  return "/" + Arr.join(out, "/");
}

/** A path made absolute against `cwd` (git prints the common dir relative to it, ".git" in the main worktree). */
export function absolute(path: string, cwd: string): string {
  const p = Str.trim(path);

  return normalize(Str.startsWith("/")(p) ? p : `${trimSlash(cwd)}/${p}`);
}

/** The repository's name from its common dir: `~/code/app/.git` -> app,
 *  a bare `~/code/app.git` -> app, a submodule's `.git/modules/x` -> x. */
export function repoName(commonDir: string): string {
  const d = trimSlash(commonDir);

  if (base(d) === ".git") return base(parent(d));

  const name = Str.replace(/\.git$/, "")(base(d));

  return name === "" ? "repo" : name;
}

/** What a folder's note belongs to, asking git through `Exec`; `on`: the machine
 *  of a space on another one. A git that can't run or answers nothing (not a
 *  repository, too old to say) gives the folder its own note. */
export const ownerOf = Effect.fnUntraced(function* (folder: string, on: string | null = null) {
  const exec = yield* Exec;
  const options = on === null || on === "" ? { cwd: folder } : { cwd: folder, on };
  // Absolute and resolved (git 2.31+): a main worktree's ".git" and a linked
  // worktree's /private/var/… path name one folder only so. Older git: as printed.
  // A git that couldn't run is the folder's own note (the caller says so, scratchpad.ts).
  const ask = (args: readonly string[]) => Effect.option(exec.run("git", ["rev-parse", ...args, "--git-common-dir"], options));
  const first = yield* ask(["--path-format=absolute"]);
  const tooOld = Option.exists(first, (r) => r.code !== 0 && /path-format/.test(r.stderr));
  const answer = tooOld ? yield* ask([]) : first;
  const out = Option.match(answer, { onNone: () => "", onSome: (r) => (r.code === 0 ? Str.trim(r.stdout) : "") });

  if (out !== "") {
    const dir = absolute(out, folder);

    return { name: repoName(dir), dir, repo: true } satisfies Owner;
  }

  const dir = trimSlash(folder);
  const name = base(dir);

  return { name: name === "" ? "home" : name, dir, repo: false } satisfies Owner;
});

/** What a folder's note belongs to. `exec` is herdr's; `on`: the machine of a
 *  space on another one. */
export function owner(exec: typeof herdrExec, folder: string, on: string | null = null): Promise<Owner> {
  return Effect.runPromise(Effect.provideService(ownerOf(folder, on), Exec, execService(exec)));
}

/** A note's file name: the name made safe for a file, and the hash. */
export function fileName(who: Pick<Owner, "name" | "dir">, on: string | null = null): string {
  const safe = Str.slice(0, 60)(Str.replace(/^-+|-+$/g, "")(Str.replace(/[^\p{L}\p{N}._-]+/gu, "-")(who.name)));
  const machine = on === null || on === "" ? "" : `${on}:`;

  return `${safe === "" ? "note" : safe}-${hash(`${machine}${who.dir}`)}.md`;
}

/** The note's path under the app's folder. */
export function notePath(appHome: string, who: Pick<Owner, "name" | "dir">, on: string | null = null): string {
  return `${trimSlash(appHome)}/${DIR}/${fileName(who, on)}`;
}

/** Whether `path` is a scratchpad note (under `<app home>/scratchpad/`). */
export function isNote(path: string | null | undefined, appHome: string | null | undefined): boolean {
  const p = path ?? "";

  if (appHome === null || appHome === undefined || appHome === "") return false;

  const folder = `${trimSlash(appHome)}/${DIR}/`;

  return Str.startsWith(folder)(p) && Str.endsWith(".md")(p) && !Str.includes("/")(Str.slice(folder.length)(p));
}

/** The repository's name back from a note's file name (`app-1a2b3c4d.md` -> app). */
export function noteName(path: string): string {
  return Option.getOrElse(
    Option.flatMap(Str.match(/([^/]+)-[0-9a-f]{8}\.md$/)(path), (m) => Option.fromUndefinedOr(m[1])),
    () => Str.replace(/\.md$/, "")(base(path)),
  );
}

/** The index with this note in it (a new map; the same one when it's there already). */
export function indexed(index: ReadonlyMap<string, IndexEntry>, path: string, who: Owner, on: string | null = null): ReadonlyMap<string, IndexEntry> {
  const key = base(path);
  const machine = on === null || on === "" ? null : on;
  const entry: IndexEntry = machine === null ? { name: who.name, dir: who.dir, repo: who.repo } : { name: who.name, dir: who.dir, machine, repo: who.repo };
  const was = index.get(key);

  if (was !== undefined && was.name === entry.name && was.dir === entry.dir && (was.machine ?? null) === machine && was.repo === entry.repo) return index;

  return new Map([...index, [key, entry]]);
}

/** index.json's text as its entries (none, or not JSON of entries: empty). */
const indexOf = (text: Option.Option<string>): ReadonlyMap<string, IndexEntry> =>
  new Map(Arr.filter(Rec.toEntries(Option.getOrElse(Option.flatMap(text, readIndexText), () => ({}))), (e): e is [string, IndexEntry] => isIndexEntry(e[1])));

/** Records the note in index.json: read, add, write if it changed, against the text read
 *  (another window writing meanwhile: read again and retry, twice). */
const record = Effect.fnUntraced(function* (indexPath: string, path: string, who: Owner, on: string | null) {
  const files = yield* Files;
  const text = yield* files.read(indexPath);
  const index = indexOf(text);
  const next = indexed(index, path, who, on);

  if (next === index) return;

  const written = writeIndexText(Rec.fromEntries(next));

  if (Option.isSome(written)) yield* files.write(indexPath, `${written.value}\n`, Option.getOrNull(text));
});

/** Finds (and records in the index) the note for a folder, on the kit's services.
 *  The index is a nicety: failing to write it doesn't stop the note opening. */
export const locateIn = Effect.fnUntraced(function* (appHome: string, folder: string, on: string | null = null) {
  const who = yield* ownerOf(folder, on);
  const path = notePath(appHome, who, on);

  yield* record(`${trimSlash(appHome)}/${DIR}/${INDEX}`, path, who, on).pipe(
    Effect.retry({ times: 2, while: Predicate.isTagged("StaleFile") }),
    // A nicety: the note opens without it.
    Effect.ignore,
  );

  return { path, ...who } satisfies Note;
});

/** Finds (and records in the index) the note for a folder, with `io`'s functions. */
export function locate(io: ScratchIo, folder: string, on: string | null = null): Promise<Note> {
  return Effect.runPromise(locateIn(io.appHome, folder, on).pipe(
    Effect.provideService(Exec, execService(io.exec)),
    Effect.provideService(Files, filesService(io.readTextFile, io.writeTextFile)),
  ));
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
  flush(): Promise<void> {
    const cancel = this.cancel;

    if (cancel !== null) {
      cancel();
      this.cancel = null;

      return this.run();
    }

    return this.running ?? Promise.resolve();
  }

  private run(): Promise<void> {
    if (this.running !== null) {
      this.again = true;

      return this.running;
    }

    this.set("saving");
    this.running = this.writeOnce();

    return this.running;
  }

  /** One write; a failed one is the "error" state (the note keeps what's typed, the next change tries again). */
  private writeOnce(): Promise<void> {
    return this.options.write().then(() => true, () => false).then((ok) => {
      this.running = null;
      this.at = DateTime.toEpochMillis(DateTime.nowUnsafe());

      if (this.again) {
        this.again = false;

        return this.run();
      }

      // Typed again while it wrote: that wait is still on, and the state says so
      // (a "saved" note would let a change on disk replace what's typed).
      this.set(!ok ? "error" : this.cancel === null ? "saved" : "pending");

      return undefined;
    });
  }
}
