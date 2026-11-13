// The Databases window's connections: the four kinds it speaks, what a
// connection holds (never a password or a token: those live in the keychain,
// or in memory while the window is open: secrets.ts), and how one is named and
// placed in words. Pure, so scripts/databases-*.test.ts check it.

import type { Guarded } from "./guard.ts";
import { isBoolean, isNumber, isString, literal, object } from "./guard.ts";

/** The kinds of database the window speaks. */
export const isKind = literal("postgres", "mysql", "sqlite", "libsql");

export type Kind = Guarded<typeof isKind>;

export const KINDS: readonly Kind[] = ["postgres", "mysql", "sqlite", "libsql"];

/** How a connection gets its password or token:
 *  keychain  the system keychain's item (secrets.ts), read when it runs
 *  ask       asked when it connects, kept in memory while the window is open
 *  pgpass    the client's own file (~/.pgpass, ~/.my.cnf), read by the client
 *  none      it has none (a SQLite file, a local server that trusts its socket) */
export const isSecret = literal("keychain", "ask", "pgpass", "none");

export type Secret = Guarded<typeof isSecret>;

/** Where a connection came from: saved by the person, found in the shown
 *  space's folder (its .env, direnv, a *.db), or sent by another mod. */
export type Origin = "saved" | "found" | "sent";

/** A connection as connections.json keeps it (and as found / sent ones are
 *  held in memory): no secret in any field. */
export const isConnJson = object({ id: isString, name: isString, kind: isKind }, {
  host: isString, port: isNumber, user: isString, database: isString, path: isString, url: isString, readonly: isBoolean, secret: isSecret,
});

export type ConnJson = Guarded<typeof isConnJson>;

/** A connection the window works with. */
export interface Conn {
  readonly id: string;
  readonly name: string;
  readonly kind: Kind;
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly database?: string;
  /** A SQLite or local libSQL file. */
  readonly path?: string;
  /** A remote libSQL database (https://… or libsql://…), never with its token. */
  readonly url?: string;
  readonly readonly: boolean;
  readonly secret: Secret;
  readonly origin: Origin;
  /** Where a found or sent one came from, in words (".env · DATABASE_URL", "port :5432 (postgres in t3)"). */
  readonly from?: string;
}

/** A connection being put together field by field (a form's, a request's). */
export type ConnDraft = { -readonly [K in keyof Conn]: Conn[K] };

/** A connection from its kept JSON (a saved one). */
export function connOf(j: ConnJson): Conn {
  return { ...j, readonly: j.readonly ?? false, secret: j.secret ?? (j.kind === "sqlite" ? "none" : "keychain"), origin: "saved" };
}

/** What connections.json keeps of a connection: the fields, never its origin's words or a secret. */
export function connJson(c: Conn): ConnJson {
  const { origin: _origin, from: _from, ...kept } = c;

  return kept;
}

/** The kind's short mark (the row's badge). */
export const KIND_MARK = { postgres: "pg", mysql: "my", sqlite: "sq", libsql: "ls" } as const satisfies { readonly [K in Kind]: string };

/** The kind in words. */
export const KIND_NAME = { postgres: "Postgres", mysql: "MySQL · MariaDB", sqlite: "SQLite", libsql: "libSQL · Turso" } as const satisfies { readonly [K in Kind]: string };

/** A server's port when none is given. */
export const DEFAULT_PORT = { postgres: 5432, mysql: 3306, sqlite: 0, libsql: 0 } as const satisfies { readonly [K in Kind]: number };

/** Whether the kind works on a file here (SQLite, a local libSQL file) rather than a server. */
export const onFile = (c: Pick<Conn, "kind" | "url">): boolean => c.kind === "sqlite" || (c.kind === "libsql" && !c.url);

/** The last part of a path. */
export const baseName = (path: string): string => path.split("/").filter(Boolean).at(-1) ?? path;

/** `~/…` for a path under home. */
export const tilde = (path: string, home: string): string => (home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path);

/** Where a connection points, in a few words: "localhost:5432/lantern", "~/code/x/data.db", "edge.turso.io". */
export function where(c: Conn, home = ""): string {
  if (c.kind === "libsql" && c.url) return c.url.replace(/^[a-z]+:\/\//, "").replace(/\/$/, "");

  if (onFile(c)) return tilde(c.path ?? "", home);

  const host = c.host || "localhost";
  const port = c.port && c.port !== DEFAULT_PORT[c.kind] ? `:${c.port}` : "";

  return `${host}${port}${c.database ? `/${c.database}` : ""}`;
}

/** A new connection's id: its kind and a few random letters (also the keychain item's account). */
export function newId(kind: Kind, random: () => number = Math.random): string {
  const letters = Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36)] ?? "x").join("");

  return `${KIND_MARK[kind]}-${letters}`;
}
