// The space folder's environment for the clients: a project whose .envrc
// (a nix flake's shell, devenv) Developer already allowed brings its own psql
// or mysql, so the window looks there first and on the app's PATH after
// (envrc.ts: direnv is never allowed from here, nothing is built unasked
// beyond what direnv itself does for an allowed .envrc). The load starts when
// the window opens, beside the first connect; a client lookup waits for it as
// a read (seconds shown, esc skips it: the app's PATH then). Which client ran
// and from where is said in the Log (session.ts).

import type { Context } from "gpui-kit";
import { exec, home } from "herdr";
import { projectEnv } from "./envrc.ts";
import type { EnvVars } from "./envrc.ts";
import { reading } from "./reads.ts";
import type { default as DbView } from "./main.ts";

/** The folder's environment: none (no .envrc, a remote folder), loading, ready (its PATH and
 *  variables), or there and not used (direnv missing, not allowed, failed: `note` says which). */
export type FolderEnv =
  | { readonly kind: "none" }
  | { readonly kind: "loading"; readonly done: Promise<void> }
  | { readonly kind: "ready"; readonly dir: string; readonly path: string | null; readonly env: EnvVars }
  | { readonly kind: "unused"; readonly dir: string; readonly note: string };

/** A folder as a person reads it (~ for the home). */
export const tilde = (p: string): string => (p.startsWith(home()) ? `~${p.slice(home().length)}` : p);

/** Starts loading the folder's environment (once per window). */
export function loadFolderEnv(v: DbView, cx: Context): Promise<void> {
  cx = v.held(cx);

  const folder = v.folder;

  if (!folder || v.on) return Promise.resolve();

  const done = settleEnv(v, folder).then(() => {
    v.clients.clear();
    cx.notify();
  });

  v.env = { kind: "loading", done };

  return done;
}

/** Loads the folder's environment into v.env (never rejects: a failure is "unused" with its words). */
async function settleEnv(v: DbView, folder: string): Promise<void> {
  try {
    const e = await projectEnv(exec, folder);

    v.env = e.kind === "ready" ? { kind: "ready", dir: e.dir, path: e.env.get("PATH") ?? null, env: e.env }
      : e.kind === "none" ? { kind: "none" }
      : { kind: "unused", dir: e.dir, note: e.kind === "no-direnv" ? "direnv isn't installed" : e.kind === "blocked" ? (e.denied ? "its .envrc is denied" : "its .envrc isn't allowed (direnv allow)") : e.note };
  } catch (error) {
    v.env = { kind: "unused", dir: folder, note: error instanceof Error ? error.message : String(error) };
  }
}

/** Waits for the folder's environment while it loads (a read of `panel`; esc skips it). */
export async function folderEnvReady(v: DbView, cx: Context): Promise<void> {
  cx = v.held(cx);

  const e = v.env;

  if (e.kind !== "loading") return;

  const what = `loading ${v.folder ? tilde(v.folder) : "the folder"}'s environment (direnv)`;
  const ended = await reading(v, what, "tables", cx, () => e.done).catch(() => null);

  // Skipped (esc) or late: the app's PATH until the load ends by itself (then the folder's again).
  if (v.env === e && !(ended && "value" in ended)) v.env = { kind: "unused", dir: v.folder ?? "", note: "skipped: the app's PATH is used" };
}

/** The PATH clients run with: the folder's when it's ready, else the app's (null). */
export const envPath = (v: DbView): string | null => (v.env.kind === "ready" ? v.env.path : null);
