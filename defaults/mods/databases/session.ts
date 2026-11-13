// The window's work with a connection: finding its client (in the space's
// direnv environment first, then the app's PATH), running statements with the
// secret handed over the safe way (runner.ts, hrana.ts), and the reads the
// panels show: the tables, a table's structure, a page of its rows.

import type { Context } from "gpui-kit";
import { exec, writeTextFile, readTextFile, appHome } from "herdr";
import type { Conn, Kind } from "./kinds.ts";
import { onFile } from "./kinds.ts";
import type { RunIo } from "./runner.ts";
import { run, NO_KEYCHAIN_ITEM } from "./runner.ts";
import type { Outcome } from "./parse-out.ts";
import { parsePsql, parseSqlite, placed } from "./parse-out.ts";
import { parseMysql } from "./parse-mysql.ts";
import { runHrana } from "./hrana.ts";
import type { Fetch } from "./hrana.ts";
import type { ScriptStatement } from "./script.ts";
import { scriptOf } from "./script.ts";
import { clientFor, INSTALL } from "./clients.ts";
import { lookup } from "./envrc.ts";
import { readSecret } from "./secrets.ts";
import type { FileIo } from "./store.ts";
import type { Browse, TableRef } from "./catalog.ts";
import { browseSql, countsSql, structureOf, structureSql, tablesOf, tablesSql } from "./catalog.ts";
import type { ClientFound } from "./state.ts";
import { gridStart } from "./state.ts";
import type { default as DbView } from "./main.ts";

/** herdr's exec and files, as the runner and the store take them. */
export const IO: RunIo & FileIo = { exec, writeTextFile, readTextFile };

/** fetch for a remote libSQL database. */
const FETCH: Fetch = async (url, init) => {
  const r = await fetch(url, { method: init.method, headers: { ...init.headers }, body: init.body });

  return { status: r.status, text: () => r.text() };
};

/** The data folder (appHome) once. */
export const dataHome = (): string => appHome();

/** A run's answer and how long it took. */
export interface Ran extends Outcome {
  readonly ms: number;
  /** The keychain had no item for the connection (ask for the password). */
  readonly noSecret?: boolean;
}

/** The client for a kind: looked up once per window (the direnv PATH first). */
export async function clientOf(v: DbView, kind: Kind): Promise<ClientFound> {
  const known = v.clients.get(kind);

  if (known) return known;

  const programs = kind === "postgres" ? ["psql"] : kind === "mysql" ? ["mysql", "mariadb"] : ["sqlite3"];
  const env = v.envPath ? new Map([["PATH", v.envPath]]) : null;
  let found: ClientFound = { missing: INSTALL[kind] };

  for (const p of programs) {
    const path = await lookup(exec, p, env);

    if (path) {
      found = { path };

      break;
    }
  }

  v.clients.set(kind, found);

  return found;
}

/** Whether the connection needs a password asked before it runs (asked once per window). */
export const needsPassword = (v: DbView, c: Conn): boolean => c.secret === "ask" && !v.secrets.has(c.id);

/** Runs statements on a connection; `started` hears the run's nonce (for cancel). */
export async function runOn(v: DbView, c: Conn, statements: readonly ScriptStatement[], started?: (nonce: string) => void, limit?: number): Promise<Ran> {
  const at = Date.now();

  if (c.kind === "libsql" && c.url) {
    const token = c.secret === "ask" ? v.secrets.get(c.id) ?? null : c.secret === "keychain" ? await readSecret(IO, c.id) : null;
    const o = await runHrana(FETCH, c.url, token, statements.map((s) => s.text));

    return { ...o, ms: Date.now() - at };
  }

  const client = clientFor(c);
  const found = await clientOf(v, c.kind);
  const dir = v.dir;

  if (!client || "missing" in found || !dir) {
    const message = "missing" in found ? found.missing : "the window's private folder couldn't be made";

    return { results: [], error: { index: null, message, line: null, col: null, hint: null }, cut: false, ms: 0 };
  }

  const script = scriptOf(c.kind, statements, c.readonly);
  const secret = c.secret === "ask" ? v.secrets.get(c.id) ?? null : null;

  const r = await run(IO, {
    kind: c.kind, dir, program: found.path, args: client.args, script: script.text, path: v.envPath,
    account: c.secret === "keychain" ? c.id : null, secret, readonly: c.readonly, limit,
  }, started);

  const texts = statements.map((s) => s.text);
  const writes = statements.map((s) => s.risk !== "read");

  const o = onFile(c) ? parseSqlite(r.stdout, r.stderr, r.code, texts, r.cut, writes)
    : c.kind === "postgres" ? parsePsql(r.stdout, r.stderr, r.code, writes, r.cut)
    : parseMysql(r.stdout, r.stderr, r.code, script.lines, texts, r.cut);

  return { ...o, error: o.error ? placed(o.error, texts) : null, ms: r.ms, noSecret: r.code === NO_KEYCHAIN_ITEM };
}

/** Reads the active connection's tables (and, for SQLite, counts them). */
export async function loadTables(v: DbView, cx: Context): Promise<void> {
  const c = v.active;

  if (!c) return;

  v.catalog.busy = true;
  cx.notify();

  const o = await runOn(v, c, tablesSql(c.kind));

  if (v.active !== c) return;

  v.catalog.busy = false;

  if (o.noSecret) {
    v.askPassword(c, true, cx);

    return;
  }

  v.catalog.error = o.error ? o.error.message : null;
  v.catalog.tables = o.error ? [] : tablesOf(c.kind, o);
  v.connected(c, !o.error);
  cx.notify();

  if (!o.error && (c.kind === "sqlite" || c.kind === "libsql")) await countTables(v, c, cx);
}

/** SQLite keeps no estimate: count each table (one run). */
async function countTables(v: DbView, c: Conn, cx: Context): Promise<void> {
  const list = countsSql(c.kind, v.catalog.tables);

  if (!list.length) return;

  const o = await runOn(v, c, list);

  if (v.active !== c) return;

  const counted = v.catalog.tables.filter((t) => t.type === "table");

  for (const r of o.results) {
    const t = counted[r.index];
    const n = Number(r.set?.rows[0]?.[0]);

    if (t && Number.isFinite(n)) v.catalog.tables = v.catalog.tables.map((x) => (x === t ? { ...x, rows: n } : x));
  }

  cx.notify();
}

/** Reads a table's structure into the Structure panel. */
export async function loadStructure(v: DbView, t: TableRef, cx: Context): Promise<void> {
  const c = v.active;

  if (!c) return;

  v.struct = { table: t, data: v.struct.table?.name === t.name ? v.struct.data : null, busy: true, error: null };
  cx.notify();

  const o = await runOn(v, c, structureSql(c.kind, t));

  if (v.active !== c || v.struct.table !== t) return;

  v.struct = { table: t, data: o.error ? null : structureOf(c.kind, o, t.name), busy: false, error: o.error?.message ?? null };

  // A count read now is better than the server's estimate.
  const count = v.struct.data?.count ?? null;

  if (count !== null) v.catalog.tables = v.catalog.tables.map((x) => (x.name === t.name && x.schema === t.schema ? { ...x, rows: count } : x));

  cx.notify();
}

/** The page size of the Rows tab. */
export const PAGE = 200;

/** Reads the Rows tab's page (the table, its sort, filter and offset). */
export async function loadRows(v: DbView, cx: Context, keepCursor = false): Promise<void> {
  const c = v.active;
  const b = v.rows.browse;

  if (!c || !b) return;

  const sql = browseSql(c.kind, b);

  if ("refused" in sql) {
    v.rows.error = sql.refused;
    cx.notify();

    return;
  }

  v.rows.busy = true;
  cx.notify();

  const o = await runOn(v, c, sql.statements);

  if (v.active !== c || v.rows.browse !== b) return;

  v.rows.busy = false;
  v.rows.error = o.error ? o.error.message : null;

  const set = o.results.find((r) => r.index === 0)?.set ?? null;
  const columns = v.struct.data && v.struct.table?.name === b.table.name ? v.struct.data.columns.map((x) => x.name) : [];

  // An empty page prints no header: the structure's columns stand in.
  v.rows.set = o.error ? null : set ?? { columns, rows: [] };

  const counted = o.results.find((r) => r.index === 1)?.set?.rows[0]?.[0];

  v.rows.total = counted !== undefined && counted !== null ? Number(counted) : b.filter.trim() ? null : v.tableRows(b.table);

  if (!keepCursor) v.rows.at = gridStart();

  cx.notify();
}

/** Opens a table in the Rows tab (sorted and filtered as asked, from its first page). */
export function browse(v: DbView, t: TableRef, cx: Context, b: Partial<Pick<Browse, "sort" | "filter">> = {}): void {
  v.rows.browse = { table: { schema: t.schema, name: t.name }, sort: b.sort ?? null, filter: b.filter ?? "", offset: 0, limit: PAGE };
  v.rows.set = null;
  v.rows.total = t.rows;
  v.rows.error = null;
  void loadRows(v, cx);
}
