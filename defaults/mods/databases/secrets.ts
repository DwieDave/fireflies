// Passwords and tokens: in the system keychain (macOS `security`), item
// service KEYCHAIN_SERVICE, account the connection's id, or nowhere but the
// window's memory. Saving never puts the secret in an argument: the window
// writes one `security -i` command to a file in its private folder (0700),
// security reads it from stdin, the file goes. Also what the query history
// keeps of a statement that holds one (CREATE USER … PASSWORD '…').

import type { RunIo } from "./runner.ts";
import { KEYCHAIN_SERVICE, nonce } from "./runner.ts";

/** A value inside "double quotes" for `security -i`'s command line. */
const quoted = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The `security -i` line that stores (or replaces) a connection's secret. */
export function addLine(account: string, label: string, secret: string): string {
  return `add-generic-password -U -s ${quoted(KEYCHAIN_SERVICE)} -a ${quoted(account)} -l ${quoted(label)} -w ${quoted(secret)}\n`;
}

/** Stores a connection's secret in the keychain; resolves with what went wrong, or null. */
export async function saveSecret(io: RunIo, dir: string, account: string, label: string, secret: string): Promise<string | null> {
  if (/[\n\r]/.test(secret)) return "a password can't hold a line break";

  const file = `${dir}/k-${nonce()}`;

  try {
    await io.writeTextFile(file, addLine(account, label, secret), null);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  const r = await io.exec("sh", ["-c", 'security -i < "$1" 2>&1; r=$?; rm -f "$1"; exit $r', "ff-keychain", file]).catch(() => null);

  if (!r) return "couldn't run security";

  // security -i reports a failed command on its output and still exits 0.
  const said = r.stdout.trim();

  return r.code === 0 && !/error|failed|denied/i.test(said) ? null : said || `security exited with ${r.code}`;
}

/** Whether the keychain holds the connection's secret (not reading it). */
export async function hasSecret(io: RunIo, account: string): Promise<boolean> {
  const r = await io.exec("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account]).catch(() => null);

  return r?.code === 0;
}

/** The secret itself (a remote libSQL token, for fetch's header): kept in memory only. */
export async function readSecret(io: RunIo, account: string): Promise<string | null> {
  const r = await io.exec("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"]).catch(() => null);

  return r?.code === 0 ? r.stdout.replace(/\n$/, "") : null;
}

/** Removes the connection's secret from the keychain (its connection is removed). */
export async function deleteSecret(io: RunIo, account: string): Promise<void> {
  await io.exec("security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account]).catch(() => null);
}

// A literal after PASSWORD, IDENTIFIED BY, or a token= / password= in a URL.
const SECRET_LITERALS = /((?:password|identified\s+(?:with\s+\S+\s+)?by|secret|token)\s*(?:=\s*)?)('(?:[^']|'')*'|"(?:[^"]|"")*"|\$\$.*?\$\$)/gi;

/** A statement as the history keeps it: a password or token literal blanked. */
export function redact(sql: string): string {
  return sql.replace(SECRET_LITERALS, (_m, lead: string) => `${lead}'•••'`).replace(/(:\/\/[^:/@\s]*:)[^@\s]*@/g, "$1•••@");
}
