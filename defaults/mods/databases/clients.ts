// Which client speaks to a connection and with what arguments: machine
// formats only (psql's CSV, mysql's XML, sqlite3's CSV), never asking on a
// terminal (psql -w), NULL printed as NULL_MARK. No secret is an argument:
// runner.ts hands the password over. A remote libSQL database has no client:
// hrana.ts speaks to it over HTTP. Also what to install when a client is
// missing (said, never done).

import { String as Str } from "effect";
import type { Conn, Kind, SslMode } from "./kinds.ts";
import { DEFAULT_PORT, onFile } from "./kinds.ts";
import { NULL_MARK } from "./script.ts";

/** A client to run: the programs to look for (the first found), and its arguments. */
export interface Client {
  readonly programs: readonly string[];
  readonly args: readonly string[];
}

/** The programs that speak each kind (a remote libSQL database: none, it's HTTP). */
export const PROGRAMS = { postgres: ["psql"], mysql: ["mysql", "mariadb"], sqlite: ["sqlite3"], libsql: ["sqlite3"] } as const satisfies { readonly [K in Kind]: readonly string[] };

/** How to get a missing client, in a person's words (on nix, psql comes with postgresql: the
 *  libpq package is the library alone, without psql). */
export const INSTALL = {
  postgres: "Postgres needs psql: brew install libpq (then brew link --force libpq); on nix psql comes with postgresql (pkgs.postgresql in the system's packages or the project's flake; libpq alone has no psql)",
  mysql: "MySQL needs mysql or mariadb: brew install mysql-client; on nix pkgs.mariadb (the client comes with it) in the system's packages or the project's flake",
  sqlite: "SQLite needs sqlite3: brew install sqlite; on nix pkgs.sqlite in the system's packages or the project's flake",
  libsql: "A libSQL file needs sqlite3: brew install sqlite; on nix pkgs.sqlite in the system's packages or the project's flake",
} as const satisfies { readonly [K in Kind]: string };

/** How a machine gets its programs: nix-darwin (darwin-rebuild), brew, a nix profile, or none known. */
export type Setup = "nix-darwin" | "brew" | "nix" | "other";

/** The one script that tells the setup apart (the app's PATH). */
export const SETUP_SCRIPT = "command -v darwin-rebuild >/dev/null 2>&1 && { echo nix-darwin; exit 0; }; command -v brew >/dev/null 2>&1 && { echo brew; exit 0; }; command -v nix >/dev/null 2>&1 && { echo nix; exit 0; }; echo other";

/** The machine's setup (one exec of SETUP_SCRIPT; "other" when it can't tell). */
export async function setupOf(exec: (cmd: string, args: string[]) => Promise<{ readonly code: number; readonly stdout: string }>): Promise<Setup> {
  const r = await exec("sh", ["-c", SETUP_SCRIPT, "ff-setup"]).catch(() => null);
  const s = r?.stdout.trim();

  return s === "nix-darwin" || s === "brew" || s === "nix" ? s : "other";
}

/** The nix package that brings a kind's client. */
const NIX = { postgres: "postgresql", mysql: "mariadb", sqlite: "sqlite", libsql: "sqlite" } as const satisfies { readonly [K in Kind]: string };

/** The brew line that brings a kind's client. */
const BREW = { postgres: "brew install libpq && brew link --force libpq", mysql: "brew install mysql-client", sqlite: "brew install sqlite", libsql: "brew install sqlite" } as const satisfies { readonly [K in Kind]: string };

/** The line to copy for this machine's setup (said, never run). */
export function installLine(kind: Kind, setup: Setup): string {
  if (setup === "nix-darwin") return `pkgs.${NIX[kind]}`;

  if (setup === "nix") return `nix profile install nixpkgs#${NIX[kind]}`;

  return BREW[kind];
}

/** Where the copied line goes, in words. */
export function installHow(setup: Setup): string {
  if (setup === "nix-darwin") return "into environment.systemPackages (nix-darwin), then darwin-rebuild switch; or the project's flake";

  return setup === "nix" ? "in a terminal (or pkgs.… in the project's flake)" : "in a terminal";
}

/** What a nix setup gets wrong about a kind's client, or null. */
export const NIX_NOTE = { postgres: "on nix psql comes with postgresql: libpq alone has no psql", mysql: null, sqlite: null, libsql: null } as const satisfies { readonly [K in Kind]: string | null };

/** A conninfo value, quoted (libpq: single quotes, a quote or backslash escaped). */
const conninfo = (s: string): string => `'${s.replace(/[\\']/g, (ch) => `\\${ch}`)}'`;

/** psql's arguments: CSV, no psqlrc, stop at the first error, never prompt, rows fetched 500 at a
 *  time. An sslmode goes into -d's conninfo (`dbname='…' sslmode=…`): the Log's line shows it, and
 *  it beats a PGSSLMODE the app's environment may hold. */
function psqlArgs(c: Conn): string[] {
  const out = ["-X", "-A", "--csv", "-w", "-v", "ON_ERROR_STOP=1", "-v", "FETCH_COUNT=500", "-P", `null=${NULL_MARK}`];

  if (c.host !== undefined && Str.isNonEmpty(c.host)) out.push("-h", c.host);

  if ((c.port !== undefined && c.port !== 0) && c.port !== DEFAULT_PORT.postgres) out.push("-p", String(c.port));

  if (c.user !== undefined && Str.isNonEmpty(c.user)) out.push("-U", c.user);

  const database = c.database || "postgres";

  out.push("-d", c.sslmode !== undefined ? `dbname=${conninfo(database)} sslmode=${c.sslmode}` : database);

  return out;
}

/** Which mysql client was found: Oracle's MySQL or MariaDB's (also installed as `mysql`). Their
 *  TLS flags differ. */
export type MysqlFlavor = "mysql" | "mariadb";

/** The flavor from the client's `--version` ("… from 11.4.13-MariaDB, client 15.2 …"), else from its name. */
export function flavorOf(version: string, path: string): MysqlFlavor {
  return /MariaDB/.test(version) || (Str.isEmpty(Str.trim(version)) && Str.endsWith("/mariadb")(path)) ? "mariadb" : "mysql";
}

/** MySQL's --ssl-mode for each sslmode (it has no allow: preferred is the nearest). The verify
 *  modes need a CA (--ssl-ca, which the window doesn't set): the client says so when it's missing. */
const MYSQL_SSL = { disable: "DISABLED", allow: "PREFERRED", prefer: "PREFERRED", require: "REQUIRED", "verify-ca": "VERIFY_CA", "verify-full": "VERIFY_IDENTITY" } as const satisfies { readonly [M in SslMode]: string };

/** MariaDB's flags for each sslmode. Its client tries TLS by default (11.4 on); --ssl alone still
 *  goes on in plain when the server has none, so only --ssl-verify-server-cert insists on TLS (and
 *  checks the certificate: 11.4 takes a self-signed one when a password is used). */
const MARIADB_SSL = { disable: ["--skip-ssl"], allow: [], prefer: [], require: ["--ssl", "--ssl-verify-server-cert"], "verify-ca": ["--ssl", "--ssl-verify-server-cert"], "verify-full": ["--ssl", "--ssl-verify-server-cert"] } as const satisfies { readonly [M in SslMode]: readonly string[] };

/** The client's TLS flags for an sslmode (none when it has none). */
export function mysqlSslArgs(mode: SslMode | undefined, flavor: MysqlFlavor): string[] {
  if (mode === undefined) return [];

  return flavor === "mariadb" ? [...MARIADB_SSL[mode]] : [`--ssl-mode=${MYSQL_SSL[mode]}`];
}

/** mysql's arguments: XML (NULL apart from 'NULL'), batch, a connect timeout, its TLS flags. */
function mysqlArgs(c: Conn, flavor: MysqlFlavor): string[] {
  const out = ["--xml", "--batch", "--connect-timeout=10", ...mysqlSslArgs(c.sslmode, flavor)];

  if (c.host !== undefined && Str.isNonEmpty(c.host)) out.push("-h", c.host);

  if ((c.port !== undefined && c.port !== 0) && c.port !== DEFAULT_PORT.mysql) out.push("-P", String(c.port));

  if (c.user !== undefined && Str.isNonEmpty(c.user)) out.push("-u", c.user);

  if (c.database !== undefined && Str.isNonEmpty(c.database)) out.push(c.database);

  return out;
}

/** sqlite3's arguments: CSV with a header, stop at the first error, changed rows told. */
export function sqliteArgs(path: string, readonly: boolean): string[] {
  return ["-batch", "-bail", "-csv", "-header", "-nullvalue", NULL_MARK, "-cmd", ".changes on", ...(readonly ? ["-readonly"] : []), path];
}

/** The client for a connection, or null (a remote libSQL database). `flavor`: which mysql client
 *  runs it (session.ts clientOf finds out). */
export function clientFor(c: Conn, flavor: MysqlFlavor = "mysql"): Client | null {
  if (c.kind === "libsql" && (c.url !== undefined && Str.isNonEmpty(c.url))) return null;

  if (onFile(c)) return { programs: PROGRAMS.sqlite, args: sqliteArgs(c.path ?? "", c.readonly) };

  return c.kind === "postgres" ? { programs: PROGRAMS.postgres, args: psqlArgs(c) } : { programs: PROGRAMS.mysql, args: mysqlArgs(c, flavor) };
}
