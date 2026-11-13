// Connections found in the shown space's folder without typing: a database
// URL in its .env files or its direnv environment (DATABASE_URL and the like,
// libSQL's URL with its token, Postgres' PG* variables) and SQLite files in it
// (checked by their header). Found ones are read only until the person says
// otherwise. A password or token found with them is handed back apart from
// the connection (Found.secret): the window keeps it in memory only.

import type { Conn, Kind } from "./kinds.ts";
import { baseName } from "./kinds.ts";

/** A connection found, where it came from, and its password or token (memory only), if any. */
export interface Found {
  readonly conn: Conn;
  readonly secret: string | null;
}

/** A URL's parts. */
export interface DbUrl {
  readonly kind: Kind;
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly database?: string;
  readonly path?: string;
  /** libSQL: the URL without its token. */
  readonly url?: string;
  readonly password: string | null;
}

/** The .env files read, in order (a later one wins). */
export const ENV_FILES = [".env", ".env.local", ".env.development", ".env.development.local"];

/** An .env file's variables: NAME=value, `export` and quotes taken off, comments left out. */
export function parseEnvFile(text: string): Map<string, string> {
  const out = new Map<string, string>();

  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);

    if (!m?.[1]) continue;

    let v = (m[2] ?? "").trim();
    const q = v[0];

    if ((q === '"' || q === "'") && v.indexOf(q, 1) > 0) v = v.slice(1, v.indexOf(q, 1));
    else v = v.replace(/\s+#.*$/, "");

    out.set(m[1], v);
  }

  return out;
}

const dec = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const SCHEMES: ReadonlyMap<string, Kind> = new Map([
  ["postgres", "postgres"], ["postgresql", "postgres"], ["mysql", "mysql"], ["mariadb", "mysql"], ["mysql2", "mysql"],
  ["libsql", "libsql"], ["sqlite", "sqlite"], ["sqlite3", "sqlite"], ["file", "sqlite"],
]);

/** The parts of a server's place that are there (a missing one stays out, not undefined). */
interface ServerParts {
  readonly user: string | undefined;
  readonly host: string | undefined;
  readonly port: number | undefined;
  readonly database: string | undefined;
}

/** `base` with each of `parts` that is there. */
function withParts<T extends object>(base: T, parts: ServerParts): T & Partial<{ user: string; host: string; port: number; database: string }> {
  const out: T & Partial<{ user: string; host: string; port: number; database: string }> = { ...base };

  if (parts.user !== undefined) out.user = parts.user;

  if (parts.host !== undefined) out.host = parts.host;

  if (parts.port !== undefined) out.port = parts.port;

  if (parts.database !== undefined) out.database = parts.database;

  return out;
}

/** A server URL's parts: scheme://user:password@host:port/database?params. */
function serverUrl(kind: Kind, rest: string): DbUrl {
  const m = /^\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^/:?]*|\[[^\]]*\])(?::(\d+))?(?:\/([^?]*))?/.exec(rest);
  const password = m?.[2] ? dec(m[2]) : null;
  const user = m?.[1] ? dec(m[1]) : undefined;
  const host = m?.[3] || undefined;
  const port = m?.[4] ? Number(m[4]) : undefined;
  const database = m?.[5] ? dec(m[5]) : undefined;

  return withParts({ kind, password }, { user, host, port, database });
}

/** A libSQL URL: its token (authToken in the query) taken out. */
function libsqlUrl(scheme: string, rest: string): DbUrl {
  const [base = "", query = ""] = rest.split("?");
  const token = query.split("&").map((p) => p.split("=")).find(([k]) => k === "authToken" || k === "auth_token")?.[1] ?? null;
  const url = `${scheme === "libsql" ? "libsql" : scheme}:${base}`.replace(/\/+$/, "");

  return { kind: "libsql", url, password: token ? dec(token) : null };
}

/** A database URL's parts, or null. `folder` resolves a relative file. */
export function parseDbUrl(text: string, folder = ""): DbUrl | null {
  const m = /^([a-z][a-z0-9+]*):(.*)$/i.exec(text.trim());
  const scheme = m?.[1]?.toLowerCase() ?? "";
  const kind = SCHEMES.get(scheme.replace(/\+.*$/, ""));
  const rest = m?.[2] ?? "";

  if (!kind) return null;

  if (kind === "libsql" || (scheme === "https" && rest.includes("turso.io"))) return libsqlUrl(scheme, rest);

  if (kind === "sqlite") {
    // sqlite:///abs, sqlite:rel, file:./dev.db (Prisma), file:/abs
    const p = rest.replace(/^\/\/(?=\/)/, "").replace(/\?.*$/, "");
    const path = p.startsWith("/") ? p : `${folder.replace(/\/$/, "")}/${p.replace(/^\.\//, "")}`;

    return p ? { kind, path, password: null } : null;
  }

  return serverUrl(kind, rest);
}

/** Variables that hold a database's URL: their names say so (…URL, …DSN, DATABASE…), their value parses. */
const looksLikeUrlName = (name: string): boolean => /(URL|DSN|URI)$|DATABASE/.test(name);

/** A found connection's id: stable for its source, so a selection survives a fresh look. */
const foundId = (source: string): string => `found:${source}`;

/** Connections in a set of variables (an .env file's, direnv's): every database URL, libSQL's
 *  token beside its URL, Postgres' PG* variables. `source` names them (".env", "direnv"). */
export function foundInVars(vars: ReadonlyMap<string, string | null>, source: string, folder: string): Found[] {
  const out: Found[] = [];
  const get = (k: string): string | null => vars.get(k) ?? null;
  const token = get("TURSO_AUTH_TOKEN") ?? get("LIBSQL_AUTH_TOKEN") ?? get("DATABASE_AUTH_TOKEN");

  for (const [name, value] of vars) {
    if (!value || !looksLikeUrlName(name)) continue;

    const u = parseDbUrl(value, folder);

    if (!u) continue;

    const { password, ...parts } = u;
    const conn: Conn = { ...parts, id: foundId(`${source}:${name}`), name, readonly: true, secret: password || (u.kind === "libsql" && token) ? "ask" : "none", origin: "found", from: `${source} · ${name}` };

    out.push({ conn, secret: password ?? (u.kind === "libsql" ? token : null) });
  }

  const host = get("PGHOST");
  const db = get("PGDATABASE");

  if (host || db) {
    const pw = get("PGPASSWORD");

    const base = { id: foundId(`${source}:PG`), name: db ?? "PGHOST", kind: "postgres" as const, readonly: true, secret: pw ? "ask" as const : "none" as const, origin: "found" as const, from: `${source} · PG*` };
    const port = get("PGPORT");
    const conn: Conn = withParts(base, { host: host ?? undefined, port: port ? Number(port) : undefined, user: get("PGUSER") ?? undefined, database: db ?? undefined });

    out.push({ conn, secret: pw });
  }

  return out;
}

/** A SQLite file found in the folder. */
export function foundFile(path: string, folder: string): Found {
  const rel = path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : baseName(path);

  return { conn: { id: foundId(`file:${path}`), name: rel, kind: "sqlite", path, readonly: true, secret: "none", origin: "found", from: "a file in the folder" }, secret: null };
}

// Up to 4 levels down, past dependencies and build output: files named like a database that start
// with SQLite's header. One process; at most 40 files.
export const FIND_SCRIPT = 'cd "$1" 2>/dev/null || exit 0; find . -maxdepth 4 \\( -name node_modules -o -name .git -o -name target -o -name .direnv -o -name dist -o -name build -o -name .venv -o -name vendor \\) -prune -o -type f \\( -name "*.db" -o -name "*.sqlite" -o -name "*.sqlite3" -o -name "*.db3" \\) -size +0 -print 2>/dev/null | head -n 200 | while IFS= read -r f; do [ "$(head -c 15 "$f" 2>/dev/null)" = "SQLite format 3" ] && printf "%s\\n" "$1/${f#./}"; done | head -n 40';

/** What makes two found connections the same one (direnv often loads the .env too). */
const sameKey = (c: Conn): string => [c.name, c.kind, c.host, c.port, c.user, c.database, c.path, c.url].join("|");

/** Every connection found once: a later list's (a later .env file, direnv) wins for the same one. */
export function mergeFound(lists: readonly (readonly Found[])[]): Found[] {
  const byKey = new Map<string, Found>();

  for (const list of lists) for (const f of list) byKey.set(sameKey(f.conn), f);

  return [...byKey.values()];
}
