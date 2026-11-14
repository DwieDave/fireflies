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
import { clientFor, INSTALL, PROGRAMS } from "./clients.ts";
import { connectWords } from "./words.ts";
import { endWords, reading } from "./reads.ts";
import { envPath, folderEnvReady, tilde } from "./folderenv.ts";
import { lookup } from "./envrc.ts";
import { readSecret } from "./secrets.ts";
import type { FileIo } from "./store.ts";
import type { Browse, TableRef } from "./catalog.ts";
import { browseSql, countsSql, hereOf, structureOf, structureSql, tablesOf, tablesSql } from "./catalog.ts";
import { hasDatabases, loadDatabases } from "./dbs.ts";
import { heard, lostRun } from "./connstate.ts";
import type { ClientFound, LogLine, Struct } from "./state.ts";
import { gridStart } from "./state.ts";
import { readsRowid } from "./edits.ts";
import { settleEdit } from "./cell-edit.ts";
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
  /** The run in the Log's words (the program, its arguments, where it came from, its exit). */
  readonly run?: string;
}

/** The client for a kind: looked up once per window, in the folder's environment first (a
 *  project's flake or devenv brings its own), then on the app's PATH. Not kept while the folder's
 *  environment still loads (it may have one). */
export async function clientOf(v: DbView, kind: Kind): Promise<ClientFound> {
  const known = v.clients.get(kind);

  if (known) return known;

  const programs = PROGRAMS[kind];
  const folder = envPath(v);
  let found: ClientFound = { missing: INSTALL[kind] };

  for (const p of programs) {
    const inFolder = folder ? await lookup(exec, p, new Map([["PATH", folder]])) : null;
    const onApp = await lookup(exec, p, null);
    const path = inFolder ?? onApp;

    if (path) {
      found = { path, from: inFolder && inFolder !== onApp ? "folder" : "app" };

      break;
    }
  }

  if (v.env.kind !== "loading") v.clients.set(kind, found);

  return found;
}

/** Where a client came from, in words: "~/lanterns's environment (direnv)" or "the app's PATH". */
export function clientFrom(v: DbView, f: ClientFound): string {
  if ("missing" in f) return v.env.kind === "ready" ? `not in ${tilde(v.env.dir)}'s environment (direnv) nor on the app's PATH` : "not on the app's PATH";

  return f.from === "folder" && v.env.kind === "ready" ? `${tilde(v.env.dir)}'s environment (direnv)` : "the app's PATH";
}

/** Whether the connection needs a password asked before it runs (asked once per window). */
export const needsPassword = (v: DbView, c: Conn): boolean => c.secret === "ask" && !v.secrets.has(c.id);

/** A run's line for the Log: the program and its arguments (nothing secret: clients.ts builds
 *  them), where the program came from. */
export function runLine(v: DbView, kind: Kind, found: ClientFound, args: readonly string[]): string {
  if ("missing" in found) return `${PROGRAMS[kind].join(" / ")}: ${clientFrom(v, found)}`;

  return `${found.path} ${args.join(" ")} · from ${clientFrom(v, found)}`;
}

/** A Log line's words while its run goes on. */
export const RUNNING = "running…";

/** Runs statements on a connection; `started` hears the run's nonce (for cancel). `label`: a
 *  read of the window's own (the tables, a structure): its run gets a line in the Log. */
export async function runOn(v: DbView, c: Conn, statements: readonly ScriptStatement[], started?: (nonce: string) => void, limit?: number, label?: string): Promise<Ran> {
  const at = Date.now();

  if (c.kind === "libsql" && c.url) {
    const token = c.secret === "ask" ? v.secrets.get(c.id) ?? null : c.secret === "keychain" ? await readSecret(IO, c.id) : null;
    const o = await runHrana(FETCH, c.url, token, statements.map((s) => (s.args ? { sql: s.text, args: s.args } : { sql: s.text })));

    // An error of no statement is the request's own (the server not reached, the token refused).
    heard(v, c, !(o.error && o.error.index === null), o.error?.message ?? null);

    return { ...o, ms: Date.now() - at };
  }

  const client = clientFor(c);
  const found = await clientOf(v, c.kind);
  const dir = v.dir;

  if (!client || "missing" in found || !dir) {
    const message = "missing" in found ? `${found.missing} (${clientFrom(v, found)})` : "the window's private folder couldn't be made";

    if (label) v.logLine({ sql: label, ok: false, ms: 0, said: message, conn: c.name, run: runLine(v, c.kind, found, client?.args ?? []) });

    return { results: [], error: { index: null, message, line: null, col: null, hint: null }, cut: false, ms: 0, run: runLine(v, c.kind, found, []) };
  }

  const script = scriptOf(c.kind, statements, c.readonly);
  // Asked for, or read from a cluster's secret at connect (kube.ts): both in the window's memory.
  const secret = c.secret === "ask" || c.secret === "kubernetes" ? v.secrets.get(c.id) ?? null : null;

  // The run is named in the Log as it starts (a run stopped or never answering is named too).
  const runs = `${runLine(v, c.kind, found, client.args)}`;
  const pending: LogLine | null = label ? { sql: label, ok: true, ms: 0, said: RUNNING, conn: c.name, run: runs } : null;

  if (pending) v.logLine(pending);

  const r = await run(IO, {
    kind: c.kind, dir, program: found.path, args: client.args, script: script.text, path: envPath(v),
    account: c.secret === "keychain" ? c.id : null, secret, readonly: c.readonly, limit,
  }, started);

  const texts = statements.map((s) => s.text);
  const writes = statements.map((s) => s.risk !== "read");

  const o = onFile(c) ? parseSqlite(r.stdout, r.stderr, r.code, texts, r.cut, writes)
    : c.kind === "postgres" ? parsePsql(r.stdout, r.stderr, r.code, writes, r.cut)
    : parseMysql(r.stdout, r.stderr, r.code, script.lines, texts, r.cut);

  const error = o.error ? connectWords(c, placed(o.error, texts)) : null;
  const line = `${runs} · exit ${r.code}`;
  const stopped = r.code === 130 || r.code === 137;

  // What the run says of the connection (connstate.ts): an answer, or the connection gone.
  if (!stopped && r.code !== NO_KEYCHAIN_ITEM) heard(v, c, !lostRun(c.kind, r.code, r.stderr), error?.message ?? null);

  if (pending) {
    // Interrupted or killed (the window's stop): said so, not as the shell's words for it.
    const done: LogLine = { sql: pending.sql, ok: !error, ms: r.ms, said: stopped ? "stopped" : error ? error.message : `exit ${r.code}`, conn: c.name, run: line };

    v.log = v.log.map((l) => (l === pending ? done : l));
  }

  return { ...o, error, ms: r.ms, noSecret: r.code === NO_KEYCHAIN_ITEM, run: line };
}

/** Reads the active connection's tables (and, for SQLite, counts them): a read of [2], stoppable,
 *  busy cleared however it ends. */
export async function loadTables(v: DbView, cx: Context): Promise<void> {
  cx = v.held(cx);

  const c = v.active;

  if (!c) return;

  const cat = v.catalog;
  const mine = ++reads;

  cat.busy = true;
  cat.by = mine;
  cx.notify();

  try {
    await folderEnvReady(v, cx);

    const e = await reading(v, "reading the tables", "tables", cx, (started) => runOn(v, c, tablesSql(c.kind), started, undefined, "the tables"));

    if (v.active !== c || v.catalog !== cat) return;

    if (!("value" in e)) {
      cat.error = endWords(e, "reading the tables");

      // No answer in time: the connection isn't known to stand (a stop says nothing of it).
      if ("late" in e) heard(v, c, false, cat.error);

      return;
    }

    const o = e.value;

    if (o.noSecret) {
      v.askPassword(c, true, cx);

      return;
    }

    cat.error = o.error ? o.error.message : null;
    cat.tables = o.error ? [] : tablesOf(c.kind, o);
    cat.here = o.error ? null : hereOf(c.kind, o);
    v.connected(c, !o.error);
    cx.notify();

    // An empty database: the server's others are read, so its words can offer them (dbs.ts).
    if (!o.error && !cat.tables.length && hasDatabases(c)) void loadDatabases(v, cx);

    if (!o.error && (c.kind === "sqlite" || c.kind === "libsql")) await countTables(v, c, cx);
  } catch (error) {
    if (v.catalog === cat) cat.error = `reading the tables failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    if (cat.by === mine) cat.busy = false;

    cx.notify();
  }
}

/** Reads started (each busy flag knows whose it is). */
let reads = 0;

/** SQLite keeps no estimate: count each table (one run). */
async function countTables(v: DbView, c: Conn, cx: Context): Promise<void> {
  cx = v.held(cx);

  const list = countsSql(c.kind, v.catalog.tables);

  if (!list.length) return;

  const e = await reading(v, "counting the rows", "tables", cx, (started) => runOn(v, c, list, started));

  if (v.active !== c || !("value" in e)) return;

  const counted = v.catalog.tables.filter((t) => t.type === "table");

  for (const r of e.value.results) {
    const t = counted[r.index];
    const n = Number(r.set?.rows[0]?.[0]);

    if (t && Number.isFinite(n)) v.catalog.tables = v.catalog.tables.map((x) => (x === t ? { ...x, rows: n } : x));
  }

  cx.notify();
}

/** Reads a table's structure into the Structure panel (a read of [3]). Postgres and MySQL give
 *  the server's estimate of its rows; an exact count is asked for (countRows). */
export async function loadStructure(v: DbView, t: TableRef, cx: Context): Promise<void> {
  cx = v.held(cx);

  const c = v.active;

  if (!c) return;

  const s: Struct = { table: t, data: v.struct.table?.name === t.name ? v.struct.data : null, busy: true, error: null };

  v.struct = s;
  cx.notify();

  try {
    const e = await reading(v, `reading ${t.name}'s structure`, "structure", cx, (started) => runOn(v, c, structureSql(c.kind, t), started, undefined, `${t.name}'s structure`));

    if (v.active !== c || v.struct !== s) return;

    if (!("value" in e)) {
      s.error = endWords(e, `reading ${t.name}'s structure`);

      return;
    }

    const o = e.value;

    s.data = o.error ? null : structureOf(c.kind, o, t.name);
    s.error = o.error?.message ?? null;

    // A count read now is better than the server's estimate.
    const count = s.data?.count ?? null;

    if (count !== null) v.catalog.tables = v.catalog.tables.map((x) => (x.name === t.name && x.schema === t.schema ? { ...x, rows: count } : x));

    // A SQLite table without a primary key: its rows read again with their rowid, so they can be edited.
    const b = v.rows.browse;

    if (b && !b.rowid && b.table.name === t.name && s.data && readsRowid(c.kind, s.data.columns, t.type)) {
      v.rows.browse = { ...b, rowid: true };
      void loadRows(v, cx, true);
    }
  } catch (error) {
    s.error = `reading ${t.name}'s structure failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    s.busy = false;
    cx.notify();
  }
}

/** Counts a table's rows exactly (asked for: on a big table it reads every row). */
export async function countRows(v: DbView, t: TableRef, cx: Context): Promise<void> {
  cx = v.held(cx);

  const c = v.active;

  if (!c) return;

  try {
    const e = await reading(v, `counting ${t.name}'s rows`, "tables", cx, (started) => runOn(v, c, countsSql(c.kind, [{ ...t, type: "table" }]), started, undefined, `${t.name}'s rows counted`));

    if (v.active !== c) return;

    const n = "value" in e ? Number(e.value.results[0]?.set?.rows[0]?.[0]) : NaN;

    if (!("value" in e)) v.say(endWords(e, `counting ${t.name}'s rows`) ?? "", "failed");
    else if (e.value.error) v.say(`${t.name}: ${e.value.error.message}`, "failed");
    else if (Number.isFinite(n)) {
      v.catalog.tables = v.catalog.tables.map((x) => (x.name === t.name && x.schema === t.schema ? { ...x, rows: n } : x));
      v.say(`${t.name}: ${n} rows, counted`, "done");
    }
  } catch (error) {
    v.say(`counting ${t.name}'s rows failed: ${error instanceof Error ? error.message : String(error)}`, "failed");
  } finally {
    cx.notify();
  }
}

/** The page size of the Rows tab. */
export const PAGE = 200;

/** Reads the Rows tab's page (the table, its sort, filter and offset). */
export async function loadRows(v: DbView, cx: Context, keepCursor = false): Promise<void> {
  cx = v.held(cx);

  const c = v.active;
  const b = v.rows.browse;

  if (!c || !b) return;

  settleEdit(v);

  const sql = browseSql(c.kind, b);

  if ("refused" in sql) {
    v.rows.error = sql.refused;
    cx.notify();

    return;
  }

  const rows = v.rows;
  const mine = ++reads;

  rows.busy = true;
  rows.by = mine;
  cx.notify();

  try {
    const e = await reading(v, `reading ${b.table.name}'s rows`, "rows", cx, (started) => runOn(v, c, sql.statements, started, undefined, `${b.table.name}'s rows`));

    if (v.active !== c || v.rows !== rows || rows.browse !== b) return;

    if (!("value" in e)) {
      rows.error = endWords(e, `reading ${b.table.name}'s rows`);

      return;
    }

    const o = e.value;

    rows.error = o.error ? o.error.message : null;

    const set = o.results.find((r) => r.index === 0)?.set ?? null;
    const columns = v.struct.data && v.struct.table?.name === b.table.name ? v.struct.data.columns.map((x) => x.name) : [];

    // An empty page prints no header: the structure's columns stand in.
    rows.set = o.error ? null : set ?? { columns, rows: [] };

    const counted = o.results.find((r) => r.index === 1)?.set?.rows[0]?.[0];

    rows.total = counted !== undefined && counted !== null ? Number(counted) : b.filter.trim() ? null : v.tableRows(b.table);

    if (!keepCursor) rows.at = gridStart();
  } catch (error) {
    rows.error = `reading ${b.table.name}'s rows failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    if (rows.by === mine) rows.busy = false;

    cx.notify();
  }
}

/** Opens a table in the Rows tab (sorted and filtered as asked, from its first page). */
export function browse(v: DbView, t: TableRef, cx: Context, b: Partial<Pick<Browse, "sort" | "filter">> = {}): void {
  v.rows.browse = { table: { schema: t.schema, name: t.name }, sort: b.sort ?? null, filter: b.filter ?? "", offset: 0, limit: PAGE };
  v.rows.set = null;
  v.rows.total = t.rows;
  v.rows.error = null;
  void loadRows(v, cx);
}
