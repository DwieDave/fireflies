// Which client speaks to a connection and with what arguments: machine
// formats only (psql's CSV, mysql's XML, sqlite3's CSV), never asking on a
// terminal (psql -w), NULL printed as NULL_MARK. No secret is an argument:
// runner.ts hands the password over. A remote libSQL database has no client:
// hrana.ts speaks to it over HTTP. Also what to install when a client is
// missing (said, never done).

import type { Conn, Kind } from "./kinds.ts";
import { DEFAULT_PORT, onFile } from "./kinds.ts";
import { NULL_MARK } from "./script.ts";

/** A client to run: the programs to look for (the first found), and its arguments. */
export interface Client {
  readonly programs: readonly string[];
  readonly args: readonly string[];
}

/** The programs that speak each kind (a remote libSQL database: none, it's HTTP). */
export const PROGRAMS = { postgres: ["psql"], mysql: ["mysql", "mariadb"], sqlite: ["sqlite3"], libsql: ["sqlite3"] } as const satisfies { readonly [K in Kind]: readonly string[] };

/** How to get a missing client, in a person's words. */
export const INSTALL = {
  postgres: "Postgres needs psql: brew install libpq (then brew link --force libpq), or nix profile install nixpkgs#postgresql",
  mysql: "MySQL needs mysql or mariadb: brew install mysql-client, or nix profile install nixpkgs#mariadb",
  sqlite: "SQLite needs sqlite3: brew install sqlite, or nix profile install nixpkgs#sqlite",
  libsql: "A libSQL file needs sqlite3: brew install sqlite, or nix profile install nixpkgs#sqlite",
} as const satisfies { readonly [K in Kind]: string };

/** psql's arguments: CSV, no psqlrc, stop at the first error, never prompt, rows fetched 500 at a time. */
function psqlArgs(c: Conn): string[] {
  const out = ["-X", "-A", "--csv", "-w", "-v", "ON_ERROR_STOP=1", "-v", "FETCH_COUNT=500", "-P", `null=${NULL_MARK}`];

  if (c.host) out.push("-h", c.host);

  if (c.port && c.port !== DEFAULT_PORT.postgres) out.push("-p", String(c.port));

  if (c.user) out.push("-U", c.user);

  out.push("-d", c.database || "postgres");

  return out;
}

/** mysql's arguments: XML (NULL apart from 'NULL'), batch, a connect timeout. */
function mysqlArgs(c: Conn): string[] {
  const out = ["--xml", "--batch", "--connect-timeout=10"];

  if (c.host) out.push("-h", c.host);

  if (c.port && c.port !== DEFAULT_PORT.mysql) out.push("-P", String(c.port));

  if (c.user) out.push("-u", c.user);

  if (c.database) out.push(c.database);

  return out;
}

/** sqlite3's arguments: CSV with a header, stop at the first error, changed rows told. */
export function sqliteArgs(path: string, readonly: boolean): string[] {
  return ["-batch", "-bail", "-csv", "-header", "-nullvalue", NULL_MARK, "-cmd", ".changes on", ...(readonly ? ["-readonly"] : []), path];
}

/** The client for a connection, or null (a remote libSQL database). */
export function clientFor(c: Conn): Client | null {
  if (c.kind === "libsql" && c.url) return null;

  if (onFile(c)) return { programs: PROGRAMS.sqlite, args: sqliteArgs(c.path ?? "", c.readonly) };

  return c.kind === "postgres" ? { programs: PROGRAMS.postgres, args: psqlArgs(c) } : { programs: PROGRAMS.mysql, args: mysqlArgs(c) };
}
