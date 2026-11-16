// @fireflies/envrc: a workspace's own environment for its language servers
// (and the databases' clients): when the file's folder (or one above it, up to
// the repository) has an .envrc, the server is looked up and started inside
// what direnv loads there (a dev shell's rust-analyzer, say), so nothing has
// to be installed globally. direnv's own allow list decides: an .envrc that
// isn't allowed is never loaded, and never allowed from here. Without an
// .envrc, the app's PATH, as before. A library (docs/effect-mods.md): the app
// serves this one copy to editor and databases by name.
//
//   probe(exec, folder)             the nearest .envrc's folder, direnv, its allow state, what it watches
//   projectEnv(exec, folder, ...)   what that means for servers (kinds below)
//   lookup(exec, program, env)      the program's path in that environment, or null
//   wrap(argv, path, env)           argv that runs it there (`env` sets the variables)
//
// `exec` is herdr's (passed in, so tests fake it); the work runs on the kit's
// `Exec` (imported here as `Programs`: `Exec` is the type of herdr's exec) (`probeIn`, `projectEnvIn`, `lookupIn`: what a mod on the kit calls).
// A first load of a flake's shell can take minutes; it runs once per folder
// while the editor stays usable, and is kept on disk (`cache`) keyed by the
// files direnv watches, so the next app start has it at once without running
// nix: it's refreshed behind the scenes then, and replaced when it changed.

import { Array as Arr, Deferred, Effect, Option, Record as Rec, Schema, String as Str } from "effect";
import { DecodeError, Exec as Programs, ExitError, execService, fileError } from "@fireflies/kit";
import type { ExecError } from "@fireflies/kit";
import type * as Herdr from "herdr";

/** herdr's exec (a test's stand-in). */
export type Exec = typeof Herdr.exec;

// What decides a direnv environment besides the .envrc: a flake, a classic
// nix shell, devenv. A change to any of them is a new environment.
export const WATCHED = [".envrc", ".env", "flake.nix", "flake.lock", "shell.nix", "default.nix", "devenv.nix", "devenv.lock", "devenv.yaml"];

// Up from the folder: the first .envrc, stopping at the repository's top
// (.git). Then, there: whether direnv is installed, a checksum of each file
// that decides what the environment is, and direnv's status. One process:
// each exec costs a few ms, and this runs every time an editor opens.
export const PROBE_SCRIPT = 'd=$1; while :; do if [ -f "$d/.envrc" ]; then break; fi; '
  + 'if [ -e "$d/.git" ] || [ "$d" = / ]; then exit 0; fi; d=$(dirname "$d"); done; '
  + 'printf "dir\\t%s\\n" "$d"; command -v direnv >/dev/null 2>&1 || { printf "direnv\\tnone\\n"; exit 0; }; cd "$d" || exit 0; '
  + `for f in ${Arr.join(WATCHED, " ")}; do [ -f "$f" ] && printf "sum\\t%s %s\\n" "$(cksum < "$f" | tr -s ' ' ' ')" "$f"; done; `
  + 'printf "status\\t"; direnv status --json 2>/dev/null | tr -d "\\n"; printf "\\n"';

// How long a first load may take (ms): a flake shell's first build.
export const LOAD_TIMEOUT = 600000;

/** direnv's change to the environment by variable name (names are data):
 *  a value, or null to unset it. */
export type EnvVars = ReadonlyMap<string, string | null>;

/** An environment as JSON has it (`direnv export json`, the disk's copy): every
 *  value a string or null. A Map past here (envOf). */
const EnvJsonSchema = Schema.Record(Schema.String, Schema.NullOr(Schema.String));

/** The environment of a decoded JSON object. */
const envOf = (json: { readonly [name: string]: string | null }): EnvVars => new Map(Rec.toEntries(json));

/** An environment the disk keeps for a folder: its watched files' sums and the variables. */
export interface KeptEnv {
  readonly key: string;
  readonly env: EnvVars;
}

/** What the disk keeps for a folder (the editor's cache file): { dir, key, env }. */
const KeptJsonSchema = Schema.Struct({ dir: Schema.String, key: Schema.String, env: EnvJsonSchema });

const readKept = Schema.decodeUnknownOption(Schema.fromJsonString(KeptJsonSchema));

const writeKept = Schema.encodeOption(Schema.fromJsonString(KeptJsonSchema));

/** A cache file's text as the environment kept for `dir` (null: none, another folder's, or
 *  not in that shape). */
export function keptEnv(text: string | null, dir: string): KeptEnv | null {
  const kept = text === null || text === "" ? Option.none() : readKept(text);

  return Option.match(Option.filter(kept, (k) => k.dir === dir), { onNone: () => null, onSome: (k) => ({ key: k.key, env: envOf(k.env) }) });
}

/** The cache file's text for `dir`'s kept environment. */
export function keptEnvText(dir: string, value: KeptEnv): string {
  // Names and string-or-null values always encode: the fallback is never taken.
  return Option.getOrElse(writeKept({ dir, key: value.key, env: Rec.fromEntries(value.env) }), () => "");
}

/** The disk's environments by folder. */
export interface EnvCache {
  read(dir: string): Promise<KeptEnv | null>;
  write(dir: string, value: KeptEnv): Promise<void>;
}

/** Why a load failed: direnv exited non-zero, said something that isn't an environment, or couldn't run. */
type LoadError = ExitError | DecodeError | ExecError;

/** A loaded environment of a folder: the sums it's for, and the load (editors opened meanwhile wait on it). */
interface Load {
  readonly key: string;
  readonly env: Deferred.Deferred<EnvVars, LoadError>;
}

// Loaded environments by folder: { key, env (a Deferred) }, so editors opened
// meanwhile wait on the same load, and a changed key loads again.
const loads = new Map<string, Load>();

/** Forgets every loaded environment (tests). */
export function forgetEnvs(): void {
  loads.clear();
}

/** The probe's findings. */
export interface Probe {
  /** The .envrc's folder (null: none). */
  readonly dir: string | null;
  /** direnv is installed. */
  readonly direnv: boolean;
  /** direnv: 0 allowed, 1 not yet, 2 denied, null: unknown. */
  readonly allowed: number | null;
  /** The watched files' checksums. */
  readonly key: string;
}

/** `direnv status --json`, the part read: whether the .envrc is allowed. */
const StatusSchema = Schema.Struct({
  state: Schema.optionalKey(Schema.Struct({
    foundRC: Schema.optionalKey(Schema.NullOr(Schema.Struct({ allowed: Schema.optionalKey(Schema.NullOr(Schema.Finite)) }))),
  })),
});

const readStatus = Schema.decodeUnknownOption(Schema.fromJsonString(StatusSchema));

/** The probe's output (`k\tv` lines) as its findings. */
function probeOf(stdout: string): Probe {
  let dir: string | null = null;
  let direnv = true;
  let allowed: number | null = null;
  const sums: string[] = [];

  for (const line of Str.split(stdout, "\n")) {
    const at = Str.indexOf("\t")(line);

    if (Option.isNone(at)) continue;

    const tab = at.value;
    const k = Str.slice(0, tab)(line);
    const v = Str.slice(tab + 1)(line);

    if (k === "dir") dir = v;
    else if (k === "direnv") direnv = v !== "none";
    else if (k === "sum") sums.push(v);
    // An old direnv without --json: unknown.
    else if (k === "status") allowed = Option.getOrNull(Option.flatMap(readStatus(v), (s) => Option.fromNullishOr(s.state?.foundRC?.allowed)));
  }

  return { dir, direnv, allowed, key: Arr.join(sums, "\n") };
}

/** The probe's findings, on `Exec`. A probe that couldn't run finds nothing (no .envrc: the app's PATH). */
export const probeIn = Effect.fnUntraced(function* (folder: string) {
  const r = yield* Effect.option(Programs.use((exec) => exec.run("sh", ["-c", PROBE_SCRIPT, "probe", folder])));

  return probeOf(Option.match(r, { onNone: () => "", onSome: (x) => x.stdout }));
});

/** The probe's findings: { dir } (null: no .envrc), { direnv } (false: not
 *  installed), { allowed } (direnv: 0 allowed, 1 not yet, 2 denied, null:
 *  unknown), { key } (the watched files' checksums). */
export function probe(exec: Exec, folder: string): Promise<Probe> {
  return Effect.runPromise(Effect.provideService(probeIn(folder), Programs, execService(exec)));
}

/** The folder holding the nearest .envrc above `folder` (up to the repository), or null. */
export function envrcDir(exec: Exec, folder: string): Promise<string | null> {
  return probe(exec, folder).then((p) => p.dir);
}

/** What a folder's environment is for its language servers (kinds below). */
export type ProjectEnv =
  | { readonly kind: "none" }
  | { readonly kind: "no-direnv"; readonly dir: string }
  | { readonly kind: "blocked"; readonly dir: string; readonly denied: boolean }
  | { readonly kind: "ready"; readonly dir: string; readonly env: EnvVars; readonly cached: boolean }
  | { readonly kind: "failed"; readonly dir: string; readonly note: string };

/** What else projectEnv takes (below). */
export interface ProjectEnvOptions {
  readonly loading?: (dir: string) => void;
  readonly cache?: EnvCache | null;
  readonly fresh?: boolean;
  readonly refreshed?: (env: EnvVars) => void;
}

/** The last line direnv wrote that says something (its errors end its output). */
function lastWords(stderr: string): string {
  const said = Arr.flatMap(Str.split(stderr, "\n"), (l) => {
    const words = Str.trim(Str.replace(/^direnv: /, "")(l));

    return words === "" ? [] : [words];
  });

  return Option.getOrElse(Arr.last(said), () => "");
}

const readEnv = Schema.decodeUnknownOption(Schema.fromJsonString(EnvJsonSchema));

/** direnv's environment for `dir`, without its own bookkeeping (DIRENV_*):
 *  those change with every load and would make each start look like a new server. */
const exportEnv = Effect.fnUntraced(function* (dir: string) {
  const exec = yield* Programs;
  const r = yield* exec.run("direnv", ["export", "json"], { cwd: dir, timeout: LOAD_TIMEOUT });

  if (r.code !== 0) {
    const said = lastWords(r.stderr);

    return yield* ExitError.make({ command: "direnv", code: r.code, stderr: r.stderr, message: said === "" ? `direnv exited with ${r.code}` : said });
  }

  // Nothing to change (no output) is an empty environment.
  const all = Str.isEmpty(Str.trim(r.stdout)) ? Option.some({}) : readEnv(r.stdout);

  if (Option.isNone(all)) return yield* DecodeError.make({ what: "direnv export json", message: "direnv's environment isn't JSON of names and values" });

  return new Map(Arr.filter(Rec.toEntries(all.value), ([k]) => !Str.startsWith("DIRENV_")(k))) satisfies EnvVars;
});

function same(a: EnvVars, b: EnvVars): boolean {
  return a.size === b.size && Arr.every(Arr.fromIterable(a), ([k, v]) => b.has(k) && b.get(k) === v);
}

/** What the disk keeps for `dir`, none when there's no cache or its read failed (then direnv loads). */
const keptOf = (cache: EnvCache | null, dir: string): Effect.Effect<Option.Option<KeptEnv>> =>
  cache === null
    ? Effect.succeedNone
    : Effect.map(Effect.option(Effect.tryPromise({ try: () => cache.read(dir), catch: fileError(dir) })), Option.flatMap(Option.fromNullOr));

/** Writes the disk's copy; a failed write only costs the next start a load. */
const keep = (cache: EnvCache | null, dir: string, value: KeptEnv): Effect.Effect<void> =>
  cache === null ? Effect.void : Effect.ignore(Effect.tryPromise({ try: () => cache.write(dir, value), catch: fileError(dir) }));

/** Behind a kept environment: what direnv says now (nix-direnv answers from its own cache
 *  in ~0.1 s); a change is kept, used from now on and said. A failure keeps the kept one: a
 *  real failure shows at the next uncached load. */
const refresh = (dir: string, key: string, kept: EnvVars, options: ProjectEnvOptions) =>
  Effect.ignore(Effect.flatMap(exportEnv(dir), (env) => {
    if (same(env, kept)) return Effect.void;

    return Effect.flatMap(Deferred.make<EnvVars, LoadError>(), (done) => {
      loads.set(dir, { key, env: done });

      return Deferred.succeed(done, env).pipe(
        Effect.andThen(keep(options.cache ?? null, dir, { key, env })),
        Effect.andThen(Effect.sync(() => options.refreshed?.(env))),
      );
    });
  }));

/** The load for `dir` under `key`: the one under way or done, the disk's (refreshed behind
 *  it), or a new one; and whether it came from the disk. */
const loadFor = Effect.fnUntraced(function* (dir: string, key: string, options: ProjectEnvOptions) {
  const was = loads.get(dir);
  const fresh = options.fresh === true;

  if (!fresh && was !== undefined && was.key === key) return { load: was, cached: false };

  const cache = options.cache ?? null;
  const kept = fresh ? Option.none<KeptEnv>() : yield* keptOf(cache, dir);
  const done = yield* Deferred.make<EnvVars, LoadError>();
  const load: Load = { key, env: done };

  loads.set(dir, load);

  if (Option.isSome(kept) && kept.value.key === key) {
    yield* Deferred.succeed(done, kept.value.env);
    yield* Effect.forkDetach(refresh(dir, key, kept.value.env, options), { startImmediately: true });

    return { load, cached: true };
  }

  options.loading?.(dir);
  // One load for every editor of the folder: run apart from this caller, which only waits on it.
  yield* Effect.forkDetach(Deferred.into(Effect.tap(exportEnv(dir), (env) => keep(cache, dir, { key, env })), done), { startImmediately: true });

  return { load, cached: false };
});

/** What a folder's environment is for its language servers, on `Exec` (projectEnv). */
export const projectEnvIn = Effect.fnUntraced(function* (folder: string, options: ProjectEnvOptions = {}) {
  const p = yield* probeIn(folder);

  if (p.dir === null || p.dir === "") return { kind: "none" } satisfies ProjectEnv;

  const dir = p.dir;

  if (!p.direnv) return { kind: "no-direnv", dir } satisfies ProjectEnv;

  // Asked every time (it's in the probe): an allow or a revoke takes effect at the next start.
  if (p.allowed !== 0) return { kind: "blocked", dir, denied: p.allowed === 2 } satisfies ProjectEnv;

  const { load, cached } = yield* loadFor(dir, p.key, options);

  return yield* Deferred.await(load.env).pipe(
    Effect.map((env): ProjectEnv => ({ kind: "ready", dir, env, cached })),
    Effect.catch((error) => Effect.sync((): ProjectEnv => {
      // Next time, again.
      if (loads.get(dir)?.key === p.key) loads.delete(dir);

      return { kind: "failed", dir, note: error.message };
    })),
  );
});

/**
 * What a folder's environment is for its language servers:
 *   { kind: "none" }                      no .envrc: the app's PATH
 *   { kind: "no-direnv", dir }            an .envrc, and no direnv to load it
 *   { kind: "blocked", dir, denied }      direnv hasn't been allowed there (or was denied)
 *   { kind: "ready", dir, env, cached }   loaded: env is direnv's change ({ NAME: value | null });
 *                                         cached: from the disk, a refresh runs behind it
 *   { kind: "failed", dir, note }         direnv tried and failed (its last words)
 * Options:
 *   loading(dir)     a load starts that the editor will wait on
 *   cache            { read(dir) -> {key, env} | null, write(dir, {key, env}) }: the disk's
 *   fresh            skip what's kept (a cached shell whose server is gone: garbage-collected)
 *   refreshed(env)   the refresh behind a cached environment found it changed
 */
export function projectEnv(exec: Exec, folder: string, options: ProjectEnvOptions = {}): Promise<ProjectEnv> {
  return Effect.runPromise(Effect.provideService(projectEnvIn(folder, options), Programs, execService(exec)));
}

/** The program's absolute path in `env`'s PATH (else the app's), or none; a lookup that
 *  couldn't run finds nothing (the server is then "not found", as when it isn't there). */
export const lookupIn = Effect.fnUntraced(function* (program: string, env: EnvVars | null = null) {
  const exec = yield* Programs;
  const path = env?.get("PATH") ?? null;
  const script = path === null || path === "" ? 'command -v "$2"' : 'PATH=$1; command -v "$2"';
  const r = yield* Effect.option(exec.run("sh", ["-c", script, "lookup", path ?? "", program]));
  const found = Option.match(r, { onNone: () => "", onSome: (x) => (x.code === 0 ? Str.trim(x.stdout) : "") });

  return Str.startsWith("/")(found) ? Option.some(found) : Option.none<string>();
});

/** The program's absolute path in `env`'s PATH (else the app's), or null. */
export function lookup(exec: Exec, program: string, env: EnvVars | null = null): Promise<string | null> {
  return Effect.runPromise(Effect.provideService(Effect.map(lookupIn(program, env), Option.getOrNull), Programs, execService(exec)));
}

/** argv that runs the server at `path` with `env`'s variables (null: unset). */
export function wrap(argv: readonly string[], path: string, env: EnvVars | null = null): string[] {
  const vars = Arr.fromIterable(env ?? []);

  if (vars.length === 0) return [path, ...Arr.drop(argv, 1)];

  const unset = Arr.flatMap(vars, ([k, v]) => (v === null ? ["-u", k] : []));
  const set = Arr.flatMap(vars, ([k, v]) => (v === null ? [] : [`${k}=${v}`]));

  return ["env", ...unset, ...set, path, ...Arr.drop(argv, 1)];
}

/** A file name for a folder's kept environment (FNV-1a of the path). */
export function cacheName(dir: string): string {
  let h = 0x811c9dc5;

  for (let i = 0; i < dir.length; i++) {
    h ^= Option.getOrElse(Str.charCodeAt(i)(dir), () => 0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }

  return `env-${Str.padStart(8, "0")(h.toString(16))}.json`;
}
