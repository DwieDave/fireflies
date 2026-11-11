// A workspace's own environment for its language servers: when the file's
// folder (or one above it, up to the repository) has an .envrc, the server is
// looked up and started inside what direnv loads there (a dev shell's
// rust-analyzer, say), so nothing has to be installed globally. direnv's own
// allow list decides: an .envrc that isn't allowed is never loaded, and never
// allowed from here. Without an .envrc, the app's PATH, as before.
//
//   envrcDir(exec, folder)          the folder holding the nearest .envrc, or null
//   projectEnv(exec, folder, ...)   what that means for servers (kinds below)
//   lookup(exec, program, env)      the program's path in that environment, or null
//   wrap(argv, path, env)           argv that runs it there (`env` sets the variables)
//
// `exec` is herdr's (passed in, so tests fake it). A first load of a flake's
// shell can take minutes: it runs once per folder, while the editor stays
// usable, and every editor of the workspace shares it after.

// Up from the folder: the first .envrc, stopping at the repository's top (.git).
export const ENVRC_SCRIPT = 'd=$1; while :; do if [ -f "$d/.envrc" ]; then printf %s "$d"; exit 0; fi; '
  + 'if [ -e "$d/.git" ] || [ "$d" = / ]; then exit 0; fi; d=$(dirname "$d"); done';
// How long a first load may take (ms): a flake shell's first build.
export const LOAD_TIMEOUT = 600000;

// Loaded environments by folder: a promise, so editors opened meanwhile wait on the same load.
const loads = new Map();

/** Forgets every loaded environment (tests; an .envrc edited). */
export function forgetEnvs() { loads.clear(); }

/** The folder holding the nearest .envrc above `folder` (up to the repository), or null. */
export async function envrcDir(exec, folder) {
  const r = await exec("sh", ["-c", ENVRC_SCRIPT, "envrc", folder]).catch(() => null);
  return r?.code === 0 && r.stdout ? r.stdout : null;
}

/**
 * What a folder's environment is for its language servers:
 *   { kind: "none" }                      no .envrc: the app's PATH
 *   { kind: "no-direnv", dir }            an .envrc, and no direnv to load it
 *   { kind: "blocked", dir, denied }      direnv hasn't been allowed there (or was denied)
 *   { kind: "ready", dir, env }           loaded: env is direnv's change ({ NAME: value | null })
 *   { kind: "failed", dir, note }         direnv tried and failed (its last words)
 * `loading(dir)` is called when a load starts that isn't already done.
 */
export async function projectEnv(exec, folder, { loading } = {}) {
  const dir = await envrcDir(exec, folder);
  if (!dir) return { kind: "none" };
  const has = await exec("sh", ["-c", 'command -v direnv >/dev/null 2>&1']).catch(() => null);
  if (has?.code !== 0) return { kind: "no-direnv", dir };
  // Asked every time (cheap): an allow or a revoke takes effect at the next start.
  const st = await exec("direnv", ["status", "--json"], { cwd: dir }).catch(() => null);
  let allowed = null;
  try { allowed = JSON.parse(st?.stdout ?? "")?.state?.foundRC?.allowed ?? null; } catch { /* old direnv: below */ }
  // direnv: 0 allowed, 1 not allowed yet, 2 denied.
  if (allowed !== 0) return { kind: "blocked", dir, denied: allowed === 2 };
  if (!loads.has(dir)) {
    loading?.(dir);
    loads.set(dir, exec("direnv", ["export", "json"], { cwd: dir, timeout: LOAD_TIMEOUT }).then((r) => {
      if (r.code !== 0) throw new Error(lastWords(r.stderr) || `direnv exited with ${r.code}`);
      return r.stdout.trim() ? JSON.parse(r.stdout) : {};
    }));
  }
  try {
    return { kind: "ready", dir, env: await loads.get(dir) };
  } catch (e) {
    loads.delete(dir); // next time, again
    return { kind: "failed", dir, note: String(e?.message ?? e) };
  }
}

/** The last line direnv wrote that says something (its errors end its output). */
function lastWords(stderr) {
  return String(stderr ?? "").split("\n").map((l) => l.replace(/^direnv: /, "").trim()).filter(Boolean).at(-1) ?? "";
}

/** The program's absolute path in `env`'s PATH (else the app's), or null. */
export async function lookup(exec, program, env = null) {
  const path = env?.PATH;
  const script = path ? 'PATH=$1; command -v "$2"' : 'command -v "$2"';
  const r = await exec("sh", ["-c", script, "lookup", path ?? "", program]).catch(() => null);
  const found = r?.code === 0 ? r.stdout.trim() : "";
  return found.startsWith("/") ? found : null;
}

/** argv that runs the server at `path` with `env`'s variables (null: unset). */
export function wrap(argv, path, env = null) {
  const vars = Object.entries(env ?? {});
  if (!vars.length) return [path, ...argv.slice(1)];
  return ["env", ...vars.flatMap(([k, v]) => (v == null ? ["-u", k] : [])), ...vars.filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`), path, ...argv.slice(1)];
}
