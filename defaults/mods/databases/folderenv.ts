// The space folder's environment for the clients: a project whose .envrc
// (a nix flake's shell, devenv) Developer already allowed brings its own psql
// or mysql, so the window looks there first and on the app's PATH after
// (envrc.ts: direnv is never allowed from here, nothing is built unasked
// beyond what direnv itself does for an allowed .envrc). The load starts when
// the window opens, beside the first connect; a client lookup waits for it as
// a read (seconds shown, esc skips it: the app's PATH then). Which client ran
// and from where is said in the Log (session.ts).

import { Deferred, Effect, String as Str } from "effect";
import { home } from "herdr";
import { redraw } from "@fireflies/kit";
import { projectEnvIn } from "@fireflies/envrc";
import type { EnvVars, ProjectEnv } from "@fireflies/envrc";
import { reading } from "./reads.ts";
import type { DbRun } from "./app.ts";
import type { default as DbView } from "./main.ts";

/** The folder's environment: none (no .envrc, a remote folder), loading, ready (its PATH and
 *  variables), or there and not used (direnv missing, not allowed, failed: `note` says which). */
export type FolderEnv =
  | { readonly kind: "none" }
  | { readonly kind: "loading"; readonly done: Deferred.Deferred<void> }
  | { readonly kind: "ready"; readonly dir: string; readonly path: string | null; readonly env: EnvVars }
  | { readonly kind: "unused"; readonly dir: string; readonly note: string };

/** A folder as a person reads it (~ for the home). */
export const tilde = (p: string): string => (Str.startsWith(home())(p) ? `~${Str.slice(Str.length(home()))(p)}` : p);

/** What direnv's answer means for the clients. */
function envOf(e: ProjectEnv): FolderEnv {
  switch (e.kind) {
    case "ready": return { kind: "ready", dir: e.dir, path: e.env.get("PATH") ?? null, env: e.env };
    case "none": return { kind: "none" };
    case "no-direnv": return { kind: "unused", dir: e.dir, note: "direnv isn't installed" };
    case "blocked": return { kind: "unused", dir: e.dir, note: e.denied ? "its .envrc is denied" : "its .envrc isn't allowed (direnv allow)" };
    case "failed": return { kind: "unused", dir: e.dir, note: e.note };
  }
}

/** Starts loading the folder's environment (once per window): v.env is "loading" from this call
 *  on (a connect started next waits for it), and the effect returned loads it; v.env then says how
 *  it went (a load that failed is "unused", with direnv's words); the clients are looked for again
 *  after it. Waiting on it is `folderEnvReady`'s (a read: its seconds shown, esc skips it). */
export function loadFolderEnv(v: DbView): Effect.Effect<void, never, DbRun> {
  const folder = v.folder;

  if (folder === null || Str.isEmpty(folder) || (v.on !== null && Str.isNonEmpty(v.on))) return Effect.void;

  // However many wait on it (a connect, the clients' lookup), it loads once.
  const done = Deferred.makeUnsafe<void>();

  v.env = { kind: "loading", done };

  // Those waiting go on once v.env says how it went (or the load was interrupted: the window closed).
  return Effect.gen(function* () {
    const env = yield* Effect.map(projectEnvIn(folder), envOf);

    // A skip (esc) while it loaded set the app's PATH: the folder's takes over now it's there.
    v.env = env;
    v.clients.clear();
    yield* redraw;
  }).pipe(Effect.ensuring(Deferred.succeed(done, undefined)));
}

/** Waits for the folder's environment while it loads (a read; esc skips it: the app's PATH then). */
export const folderEnvReady = (v: DbView): Effect.Effect<void, never, DbRun> => Effect.gen(function* () {
  const e = v.env;

  if (e.kind !== "loading") return;

  const what = `loading ${v.folder !== null && Str.isNonEmpty(v.folder) ? tilde(v.folder) : "the folder"}'s environment (direnv)`;
  const ended = yield* reading(v, what, "tables", () => Deferred.await(e.done));

  // Skipped (esc) or late: the app's PATH until the load ends by itself (then the folder's again).
  if (v.env === e && !("value" in ended)) v.env = { kind: "unused", dir: v.folder ?? "", note: "skipped: the app's PATH is used" };
});

/** The PATH clients run with: the folder's when it's ready, else the app's (null). */
export const envPath = (v: DbView): string | null => (v.env.kind === "ready" ? v.env.path : null);
