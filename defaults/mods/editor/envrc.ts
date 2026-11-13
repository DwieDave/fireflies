// A workspace's own environment for its language servers: when the file's
// folder (or one above it, up to the repository) has an .envrc, the server is
// looked up and started inside what direnv loads there (a dev shell's
// rust-analyzer, say), so nothing has to be installed globally. direnv's own
// allow list decides: an .envrc that isn't allowed is never loaded, and never
// allowed from here. Without an .envrc, the app's PATH, as before.
//
//   probe(exec, folder)             the nearest .envrc's folder, direnv, its allow state, what it watches
//   projectEnv(exec, folder, ...)   what that means for servers (kinds below)
//   lookup(exec, program, env)      the program's path in that environment, or null
//   wrap(argv, path, env)           argv that runs it there (`env` sets the variables)
//
// `exec` is herdr's (passed in, so tests fake it). A first load of a flake's
// shell can take minutes; it runs once per folder while the editor stays
// usable, and is kept on disk (`cache`) keyed by the files direnv watches, so
// the next app start has it at once without running nix: it's refreshed
// behind the scenes then, and replaced when it changed.

import type * as Herdr from "herdr";
import { isNumber, isString, nullable, object, parseJson } from "./guard.ts";
import { isList } from "./guards.ts";

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
  + `for f in ${WATCHED.join(" ")}; do [ -f "$f" ] && printf "sum\\t%s %s\\n" "$(cksum < "$f" | tr -s ' ' ' ')" "$f"; done; `
  + 'printf "status\\t"; direnv status --json 2>/dev/null | tr -d "\\n"; printf "\\n"';

// How long a first load may take (ms): a flake shell's first build.
export const LOAD_TIMEOUT = 600000;

/** direnv's change to the environment by variable name (names are data):
 *  a value, or null to unset it. */
export type EnvVars = ReadonlyMap<string, string | null>;

/** An environment as JSON has it (`direnv export json`, the disk's copy): every value a
 *  string or null. Only the parse's result: it's a Map past here (envOf). */
function isEnvJson(value: unknown): value is { readonly [name: string]: string | null } {
  if (typeof value !== "object" || value === null || isList(value)) return false;

  return Object.keys(value).every((name) => {
    const v: unknown = Object.getOwnPropertyDescriptor(value, name)?.value;

    return v === null || isString(v);
  });
}

/** The environment of a proven JSON object. */
const envOf = (json: { readonly [name: string]: string | null }): EnvVars => new Map(Object.entries(json));

/** An environment the disk keeps for a folder: its watched files' sums and the variables. */
export interface KeptEnv {
  readonly key: string;
  readonly env: EnvVars;
}

/** What the disk keeps for a folder (main.ts's cache file): { dir, key, env }. */
const isKeptJson = object({ dir: isString, key: isString, env: isEnvJson });

/** A cache file's text as the environment kept for `dir` (null: none, another folder's, or
 *  not in that shape). */
export function keptEnv(text: string | null, dir: string): KeptEnv | null {
  const kept = text ? parseJson(text, isKeptJson) : undefined;

  return kept?.dir === dir ? { key: kept.key, env: envOf(kept.env) } : null;
}

/** The cache file's text for `dir`'s kept environment. */
export function keptEnvText(dir: string, value: KeptEnv): string {
  return JSON.stringify({ dir, key: value.key, env: Object.fromEntries(value.env) });
}

/** The disk's environments by folder. */
export interface EnvCache {
  read(dir: string): Promise<KeptEnv | null>;
  write(dir: string, value: KeptEnv): Promise<void>;
}

/** A loaded environment of a folder: the sums it's for, and the load (editors opened meanwhile wait on it). */
interface Load {
  readonly key: string;
  readonly env: Promise<EnvVars>;
}

// Loaded environments by folder: { key, env (a promise) }, so editors opened
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
const isStatus = object({}, { state: object({}, { foundRC: nullable(object({}, { allowed: nullable(isNumber) })) }) });

/** The probe's findings: { dir } (null: no .envrc), { direnv } (false: not
 *  installed), { allowed } (direnv: 0 allowed, 1 not yet, 2 denied, null:
 *  unknown), { key } (the watched files' checksums). */
export async function probe(exec: Exec, folder: string): Promise<Probe> {
  const r = await exec("sh", ["-c", PROBE_SCRIPT, "probe", folder]).catch(() => null);
  let dir: string | null = null;
  let direnv = true;
  let allowed: number | null = null;
  const sums: string[] = [];

  for (const line of (r?.stdout ?? "").split("\n")) {
    const tab = line.indexOf("\t");

    if (tab < 0) continue;

    const k = line.slice(0, tab);
    const v = line.slice(tab + 1);

    if (k === "dir") dir = v;
    else if (k === "direnv") direnv = v !== "none";
    else if (k === "sum") sums.push(v);
    // An old direnv without --json: unknown.
    else if (k === "status") allowed = parseJson(v, isStatus)?.state?.foundRC?.allowed ?? null;
  }

  return { dir, direnv, allowed, key: sums.join("\n") };
}

/** The folder holding the nearest .envrc above `folder` (up to the repository), or null. */
export async function envrcDir(exec: Exec, folder: string): Promise<string | null> {
  return (await probe(exec, folder)).dir;
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
export async function projectEnv(exec: Exec, folder: string, { loading, cache = null, fresh = false, refreshed }: ProjectEnvOptions = {}): Promise<ProjectEnv> {
  const p = await probe(exec, folder);

  if (!p.dir) return { kind: "none" };

  const dir = p.dir;

  if (!p.direnv) return { kind: "no-direnv", dir };

  // Asked every time (it's in the probe): an allow or a revoke takes effect at the next start.
  if (p.allowed !== 0) return { kind: "blocked", dir, denied: p.allowed === 2 };

  const key = p.key;
  let cached = false;
  let load = loads.get(dir);

  if (fresh || !load || load.key !== key) {
    const kept = !fresh && cache ? await Promise.resolve(cache.read(dir)).catch(() => null) : null;

    if (kept && kept.key === key) {
      cached = true;
      load = { key, env: Promise.resolve(kept.env) };
      loads.set(dir, load);
      // Behind the scenes: what direnv says now (nix-direnv answers from its own cache in ~0.1 s).
      exportEnv(exec, dir).then(
        (env) => {
          if (same(env, kept.env)) return;

          loads.set(dir, { key, env: Promise.resolve(env) });
          void cache?.write(dir, { key, env });
          refreshed?.(env);
        },
        () => {
          /* the kept one stays; a real failure shows at the next uncached load */
        },
      );
    } else {
      loading?.(dir);

      const env = exportEnv(exec, dir);

      load = { key, env };
      loads.set(dir, load);
      env.then(
        (e) => cache?.write(dir, { key, env: e }),
        () => {},
      );
    }
  }

  try {
    return { kind: "ready", dir, env: await load.env, cached };
  } catch (error) {
    if (loads.get(dir)?.key === key) loads.delete(dir); // next time, again

    return { kind: "failed", dir, note: error instanceof Error ? error.message : String(error) };
  }
}

/** direnv's environment for `dir`, without its own bookkeeping (DIRENV_*):
 *  those change with every load and would make each start look like a new server. */
async function exportEnv(exec: Exec, dir: string): Promise<EnvVars> {
  const r = await exec("direnv", ["export", "json"], { cwd: dir, timeout: LOAD_TIMEOUT });

  if (r.code !== 0) throw new Error(lastWords(r.stderr) || `direnv exited with ${r.code}`);

  const all = r.stdout.trim() ? parseJson(r.stdout, isEnvJson) : {};

  if (all === undefined) throw new Error("direnv's environment isn't JSON of names and values");

  return new Map([...envOf(all)].filter(([k]) => !k.startsWith("DIRENV_")));
}

function same(a: EnvVars, b: EnvVars): boolean {
  return a.size === b.size && [...a].every(([k, v]) => b.has(k) && b.get(k) === v);
}

/** The last line direnv wrote that says something (its errors end its output). */
function lastWords(stderr: string): string {
  return stderr.split("\n").flatMap((l) => {
    const said = l.replace(/^direnv: /, "").trim();

    return said ? [said] : [];
  }).at(-1) ?? "";
}

/** The program's absolute path in `env`'s PATH (else the app's), or null. */
export async function lookup(exec: Exec, program: string, env: EnvVars | null = null): Promise<string | null> {
  const path = env?.get("PATH");
  const script = path ? 'PATH=$1; command -v "$2"' : 'command -v "$2"';
  const r = await exec("sh", ["-c", script, "lookup", path ?? "", program]).catch(() => null);
  const found = r?.code === 0 ? r.stdout.trim() : "";

  return found.startsWith("/") ? found : null;
}

/** argv that runs the server at `path` with `env`'s variables (null: unset). */
export function wrap(argv: readonly string[], path: string, env: EnvVars | null = null): string[] {
  const vars = [...(env ?? [])];

  if (!vars.length) return [path, ...argv.slice(1)];

  return ["env", ...vars.flatMap(([k, v]) => (v === null ? ["-u", k] : [])), ...vars.flatMap(([k, v]) => (v === null ? [] : [`${k}=${v}`])), path, ...argv.slice(1)];
}

/** A file name for a folder's kept environment (FNV-1a of the path). */
export function cacheName(dir: string): string {
  let h = 0x811c9dc5;

  for (let i = 0; i < dir.length; i++) {
    h ^= dir.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }

  return `env-${h.toString(16).padStart(8, "0")}.json`;
}
