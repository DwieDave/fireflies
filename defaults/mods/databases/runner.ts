// Running a client (psql, mysql, sqlite3) without a secret on any command
// line: every run is `sh -c RUNNER` with arguments that hold nothing secret
// (the window's private folder, a run's nonce, the client, the keychain
// item's account). The statements are a file in the private folder (0700,
// made when the window opens: privateDir); a password comes from the keychain
// inside the shell (`security … -w`, into the client's environment or a 0600
// option file), or from a one-shot file the window wrote there, read and
// deleted before the client starts. Output is cut at `limit` bytes; the
// client's pid is kept, so cancel() can interrupt it (psql then cancels the
// query on the server, mysql kills it, sqlite3 stops).

import type { ExecResult } from "herdr";
import type { Kind } from "./kinds.ts";

/** What the runner uses of the app (herdr's exec and writeTextFile; a test's stand-ins). */
export interface RunIo {
  readonly exec: (cmd: string, args?: string[], options?: { cwd?: string; on?: string | null; timeout?: number }) => Promise<ExecResult>;
  readonly writeTextFile: (path: string, text: string, expected: string | null) => Promise<null>;
}

/** The keychain's service for the window's passwords and tokens (the account is the connection's id). */
export const KEYCHAIN_SERVICE = "fireflies.databases";

/** The runner's exit when the keychain has no item for the connection. */
export const NO_KEYCHAIN_ITEM = 97;

/** Bytes of output kept of one run. */
export const OUTPUT_LIMIT = 8 * 1024 * 1024;

/** How long one run may take (exec's own cap). */
export const RUN_TIMEOUT = 600000;

// $1 private folder, $2 nonce, $3 kind, $4 client, $5 PATH ("" keeps the app's),
// $6 keychain account ("": none), $7 "1" read only, $8 output limit, then the client's own arguments.
// The password reaches only the client: PGPASSWORD (postgres) or a 0600 [client] file (mysql),
// written by the printf builtin, so it is in no process's arguments. The client runs as a child
// that writes its own pid and then becomes the client (exec), so a cancel interrupts the client itself.
export const RUNNER = String.raw`d=$1; n=$2; kind=$3; prog=$4; p=$5; acct=$6; ro=$7; lim=$8; shift 8
[ -n "$p" ] && PATH=$p && export PATH
q="$d/q-$n.sql"; s="$d/s-$n"; rc="$d/rc-$n"; pid="$d/pid-$n"; cnf="$d/my-$n.cnf"
trap 'rm -f "$q" "$s" "$rc" "$pid" "$cnf"' EXIT
command -v "$prog" >/dev/null 2>&1 || { echo "fireflies-db: $prog isn't installed" >&2; exit 127; }
pw=
if [ -f "$s" ]; then pw=$(cat "$s"); rm -f "$s"
elif [ -n "$acct" ]; then pw=$(security find-generic-password -s ${KEYCHAIN_SERVICE} -a "$acct" -w 2>/dev/null) || { echo "fireflies-db: the keychain has no password for this connection" >&2; exit ${NO_KEYCHAIN_ITEM}; }
fi
case $kind in
postgres)
  if [ -n "$pw" ]; then PGPASSWORD=$pw; export PGPASSWORD; fi
  if [ -n "$ro" ]; then PGOPTIONS="-c default_transaction_read_only=on"; export PGOPTIONS; fi
  set -- "$@" -f "$q";;
mysql)
  if [ -n "$pw" ]; then
    e=$(printf '%s' "$pw" | sed 's/\\/\\\\/g; s/"/\\"/g')
    (umask 077; printf '[client]\npassword="%s"\n' "$e" > "$cnf")
    e=
    set -- "--defaults-extra-file=$cnf" "$@"
  fi;;
esac
pw=
{ sh -c 'echo $$ > "$1"; shift; exec "$@" < "$0"' "$q" "$pid" "$prog" "$@"; echo $? > "$rc"; } | head -c "$lim"
r=$(cat "$rc" 2>/dev/null); [ -n "$r" ] || r=141
exit "$r"`;

/** One run of a client. */
export interface RunSpec {
  readonly kind: Kind;
  /** The private folder (privateDir). */
  readonly dir: string;
  /** The client: its name (looked up in PATH) or path. */
  readonly program: string;
  /** The client's arguments (no secret: clients.ts builds them). */
  readonly args: readonly string[];
  /** The statements for the client (script.ts). */
  readonly script: string;
  /** A PATH to look the client up in (the space's direnv environment), or null for the app's. */
  readonly path?: string | null;
  /** The keychain item's account to read the password from, or null. */
  readonly account?: string | null;
  /** A password asked for (memory only): written as a one-shot 0600 file, never an argument. */
  readonly secret?: string | null;
  readonly readonly?: boolean;
  readonly limit?: number | undefined;
  readonly timeout?: number;
}

/** A run's output: what the client printed (stdout cut at the limit), its errors, its exit. */
export interface RunOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
  readonly cut: boolean;
  readonly ms: number;
}

/** A text's length in UTF-8 bytes (what head -c counted). */
export function utf8Length(s: string): number {
  let n = 0;

  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;

    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }

  return n;
}

let nonces = 0;

/** A run's nonce: unique within the window, safe in a file name. */
export const nonce = (): string => `${Date.now().toString(36)}${(nonces++).toString(36)}`;

/** The argv of a run (what `ps` could show): nothing secret in it. */
export function runnerArgs(spec: RunSpec, n: string): string[] {
  return ["-c", RUNNER, "ff-db", spec.dir, n, spec.kind, spec.program, spec.path ?? "", spec.account ?? "", spec.readonly ? "1" : "", String(spec.limit ?? OUTPUT_LIMIT), ...spec.args];
}

/** Runs the client on the script; `started(n)` hears the nonce (for cancel). Never rejects: a
 *  failure to start is a result with its words on stderr. */
export async function run(io: RunIo, spec: RunSpec, started?: (n: string) => void): Promise<RunOutput> {
  const n = nonce();
  const at = Date.now();

  try {
    await io.writeTextFile(`${spec.dir}/q-${n}.sql`, spec.script, null);

    if (spec.secret) await io.writeTextFile(`${spec.dir}/s-${n}`, spec.secret, null);

    started?.(n);

    const r = await io.exec("sh", runnerArgs(spec, n), { timeout: spec.timeout ?? RUN_TIMEOUT });
    const limit = spec.limit ?? OUTPUT_LIMIT;
    // head -c counts bytes: a cut output is the limit's worth (or the client died of the closed pipe).
    const cut = r.code === 141 || utf8Length(r.stdout) >= limit;

    return { stdout: r.stdout, stderr: r.stderr, code: cut && r.code === 141 ? 0 : r.code, cut, ms: Date.now() - at };
  } catch (error) {
    // The one-shot secret file must not outlive a run that never started.
    if (spec.secret) await io.exec("rm", ["-f", `${spec.dir}/s-${n}`]).catch(() => null);

    return { stdout: "", stderr: error instanceof Error ? error.message : String(error), code: -1, cut: false, ms: Date.now() - at };
  }
}

/** Interrupts a run (SIGINT to the client), then kills it if it's still there after 2 s. */
export async function cancel(io: RunIo, dir: string, n: string): Promise<void> {
  const script = 'p=$(cat "$1" 2>/dev/null) || exit 0; kill -INT "$p" 2>/dev/null; sleep 2; kill -KILL "$p" 2>/dev/null; exit 0';

  await io.exec("sh", ["-c", script, "ff-cancel", `${dir}/pid-${n}`], { timeout: 10000 }).catch(() => null);
}

/** The window's private folder: a new 0700 folder in the temp folder (mktemp -d), or null. */
export async function privateDir(io: RunIo): Promise<string | null> {
  const r = await io.exec("sh", ["-c", 'umask 077; mktemp -d "${TMPDIR:-/tmp}/fireflies-db.XXXXXX"', "ff-dir"]).catch(() => null);
  const dir = r?.code === 0 ? r.stdout.trim() : "";

  return dir.startsWith("/") ? dir : null;
}

/** Removes the private folder and anything a run left in it. */
export async function removeDir(io: RunIo, dir: string): Promise<void> {
  if (!/\/fireflies-db\.[A-Za-z0-9]+$/.test(dir)) return;

  await io.exec("rm", ["-rf", dir]).catch(() => null);
}
