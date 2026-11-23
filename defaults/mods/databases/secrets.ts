// Passwords and tokens: in the system keychain (macOS `security`), item
// service KEYCHAIN_SERVICE, account the connection's id, or nowhere but the
// window's memory. Saving never puts the secret in an argument: the window
// writes one `security -i` command to a file in its private folder (0700),
// security reads it from stdin, the file goes. Also what the query history
// keeps of a statement that holds one (CREATE USER … PASSWORD '…').

import { Effect, Option, Redacted, Schema, String as Str } from "effect";
import { Exec, Files, replaceWith } from "@fireflies/kit";
import type { ExecError, FileError, StaleFile } from "@fireflies/kit";
import { KEYCHAIN_SERVICE, nonce } from "./runner.ts";

/** The keychain refused or failed (its words: a denied access, a locked keychain, a refused line). */
export class KeychainError extends Schema.TaggedError<KeychainError, { readonly brand: unique symbol }>()("KeychainError", {
  message: Schema.String,
}) {}

/** security's exit when the keychain has no such item. */
const NO_ITEM = 44;

/** security's own words for a failure (its last line), else its exit. */
const saidBy = (text: string, code: number): string => {
  const said = Str.trim(text);

  return Str.isNonEmpty(said) ? said : `security exited with ${code}`;
};

/** A value inside "double quotes" for `security -i`'s command line. */
const quoted = (s: string): string => `"${Str.replace(/"/g, '\\"')(Str.replace(/\\/g, "\\\\")(s))}"`;

/** The `security -i` line that stores (or replaces) a connection's secret. */
export function addLine(account: string, label: string, secret: string): string {
  return `add-generic-password -U -s ${quoted(KEYCHAIN_SERVICE)} -a ${quoted(account)} -l ${quoted(label)} -w ${quoted(secret)}\n`;
}

/** Stores a connection's secret in the keychain (the `security -i` line in a one-shot file of the
 *  private folder, removed by the same shell that reads it). */
export const saveSecret = (dir: string, account: string, label: string, secret: string): Effect.Effect<void, KeychainError | ExecError | FileError | StaleFile, Exec | Files> => Effect.gen(function* () {
  if (/[\n\r]/.test(secret)) return yield* KeychainError.make({ message: "a password can't hold a line break" });

  const file = `${dir}/k-${yield* nonce}`;

  yield* Files.use((f) => f.write(file, addLine(account, label, secret), null));

  const r = yield* Exec.use((x) => x.run("sh", ["-c", 'security -i < "$1" 2>&1; r=$?; rm -f "$1"; exit $r', "ff-keychain", file]));
  // security -i reports a failed command on its output and still exits 0.
  const said = Str.trim(r.stdout);

  if (r.code !== 0 || /error|failed|denied/i.test(said)) return yield* KeychainError.make({ message: saidBy(said, r.code) });
});

/** The secret itself (a remote libSQL token, for its request's header): none when the keychain has
 *  no item for it; a keychain that refused says why (a denied access isn't "no token"). */
export const readSecret = (account: string): Effect.Effect<Option.Option<Redacted.Redacted>, KeychainError | ExecError, Exec> => Effect.gen(function* () {
  const r = yield* Exec.use((x) => x.run("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"]));

  if (r.code === NO_ITEM) return Option.none();

  if (r.code !== 0) return yield* KeychainError.make({ message: saidBy(r.stderr, r.code) });

  return Option.some(Redacted.make(Str.replace(/\n$/, "")(r.stdout)));
});

/** Removes the connection's secret from the keychain (its connection is removed); none there is done too. */
export const deleteSecret = (account: string): Effect.Effect<void, KeychainError | ExecError, Exec> => Effect.gen(function* () {
  const r = yield* Exec.use((x) => x.run("security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account]));

  if (r.code !== 0 && r.code !== NO_ITEM) return yield* KeychainError.make({ message: saidBy(r.stderr, r.code) });
});

// A literal after PASSWORD, IDENTIFIED BY, or a token= / password= in a URL.
const SECRET_LITERALS = /((?:password|identified\s+(?:with\s+\S+\s+)?by|secret|token)\s*(?:=\s*)?)('(?:[^']|'')*'|"(?:[^"]|"")*"|\$\$.*?\$\$)/gi;

/** A statement as the history keeps it: a password or token literal blanked. */
export function redact(sql: string): string {
  const literals = replaceWith(SECRET_LITERALS, (m) => `${m[1] ?? ""}'•••'`)(sql);

  return Str.replace(/(:\/\/[^:/@\s]*:)[^@\s]*@/g, "$1•••@")(literals);
}
