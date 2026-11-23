// The window's work with a connection: finding its client (in the space's
// direnv environment first, then the app's PATH), running statements with the
// secret handed over the safe way (runner.ts, hrana.ts), and the reads the
// panels show: the tables, a table's structure, a page of its rows. Each is an
// effect the view runs (v.run): a read the window closes or replaces is
// interrupted, its client cancelled, its panel's busy mark cleared.

import { Array as Arr, Clock, Effect, Option, Redacted, String as Str } from "effect";
import { appHome } from "herdr";
import { Exec, causeMessage, redraw } from "@fireflies/kit";
import { lookupIn } from "@fireflies/envrc";
import type { Conn, Kind } from "./kinds.ts";
import { onFile } from "./kinds.ts";
import { run, NO_KEYCHAIN_ITEM } from "./runner.ts";
import type { Outcome, RunError } from "./parse-out.ts";
import { parsePsql, parseSqlite, placed } from "./parse-out.ts";
import { parseMysql } from "./parse-mysql.ts";
import { runHrana } from "./hrana.ts";
import type { ScriptStatement } from "./script.ts";
import { scriptOf } from "./script.ts";
import type { MysqlFlavor } from "./clients.ts";
import { clientFor, flavorOf, INSTALL, PROGRAMS } from "./clients.ts";
import { connectWords } from "./words.ts";
import { endWords, reading } from "./reads.ts";
import { envPath, folderEnvReady, tilde } from "./folderenv.ts";
import { readSecret } from "./secrets.ts";
import type { Browse, TableRef } from "./catalog.ts";
import { browseSql, countsSql, hereOf, structureOf, structureSql, tablesOf, tablesSql } from "./catalog.ts";
import { hasDatabases, loadDatabases } from "./dbs.ts";
import { heard, lostRun } from "./connstate.ts";
import type { ClientFound, LogLine, Struct } from "./state.ts";
import { gridStart } from "./state.ts";
import { readsRowid } from "./edits.ts";
import { settleEdit } from "./cell-edit.ts";
import type { DbRun } from "./app.ts";
import type { default as DbView } from "./main.ts";

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

/** A run's failure that no statement made (the request's, the window's). */
const ownError = (message: string): RunError => ({ index: null, message, line: null, col: null, hint: null });

/** Which mysql client is at `path` (one `--version`; its name when that says nothing or can't run). */
const flavorFound = (path: string): Effect.Effect<MysqlFlavor, never, Exec> => Exec.use((x) => x.run(path, ["--version"], { timeout: 5000 })).pipe(
  Effect.map((r) => `${r.stdout}${r.stderr}`),
  // A client that won't run for its version: its name tells (flavorOf).
  Effect.orElseSucceed(() => ""),
  Effect.map((said) => flavorOf(said, path)),
);

/** The client for a kind: looked up once per window, in the folder's environment first (a
 *  project's flake or devenv brings its own), then on the app's PATH. Not kept while the folder's
 *  environment still loads (it may have one). */
export const clientOf = (v: DbView, kind: Kind): Effect.Effect<ClientFound, never, DbRun> => Effect.gen(function* () {
  const known = v.clients.get(kind);

  if (known !== undefined) return known;

  const folder = envPath(v);
  let found: ClientFound = { missing: INSTALL[kind] };

  for (const p of PROGRAMS[kind]) {
    const inFolder = folder !== null && Str.isNonEmpty(folder) ? yield* lookupIn(p, new Map([["PATH", folder]])) : Option.none<string>();
    const onApp = yield* lookupIn(p, null);
    const path = Option.orElse(inFolder, () => onApp);

    if (Option.isSome(path)) {
      const from = Option.isSome(inFolder) && !Option.contains(onApp, inFolder.value) ? "folder" : "app";

      // A mysql may be MariaDB's (their TLS flags differ): its --version says which.
      found = kind === "mysql" ? { path: path.value, from, flavor: yield* flavorFound(path.value) } : { path: path.value, from };

      break;
    }
  }

  if (v.env.kind !== "loading") v.clients.set(kind, found);

  return found;
});

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
  if ("missing" in found) return `${Arr.join(PROGRAMS[kind], " / ")}: ${clientFrom(v, found)}`;

  return `${found.path} ${Arr.join(args, " ")} · from ${clientFrom(v, found)}`;
}

/** A Log line's words while its run goes on. */
export const RUNNING = "running…";

/** A remote libSQL database's token: asked for (memory), the keychain's (none there: none sent), or
 *  none. A keychain that refused is the run's error, said, not a request sent without it. */
const tokenOf = (v: DbView, c: Conn): Effect.Effect<Option.Option<Redacted.Redacted>, string, DbRun> => {
  if (c.secret === "ask") return Effect.succeed(Option.map(Option.fromUndefinedOr(v.secrets.get(c.id)), Redacted.make));

  if (c.secret !== "keychain") return Effect.succeed(Option.none());

  return Effect.mapError(readSecret(c.id), (e) => `the keychain didn't give its token: ${e.message}`);
};

/** A statement as the pipeline takes it. */
const hranaOf = (s: ScriptStatement) => (s.args !== undefined ? { sql: s.text, args: s.args } : { sql: s.text });

/** Runs statements on a connection; `started` hears the run's nonce (for cancel). `label`: a
 *  read of the window's own (the tables, a structure): its run gets a line in the Log, which says
 *  "stopped" when the run is interrupted (the window's stop, a newer read, the window closing). */
export const runOn = (v: DbView, c: Conn, statements: readonly ScriptStatement[], started?: (nonce: string) => void, limit?: number, label?: string): Effect.Effect<Ran, never, DbRun> => Effect.gen(function* () {
  const at = yield* Clock.currentTimeMillis;

  if (c.kind === "libsql" && c.url !== undefined && Str.isNonEmpty(c.url)) {
    const url = c.url;
    const o: Outcome = yield* tokenOf(v, c).pipe(
      Effect.flatMap((token) => runHrana(url, Option.getOrNull(token), Arr.map(statements, hranaOf))),
      Effect.catch((said) => Effect.succeed<Outcome>({ results: [], error: ownError(said), cut: false })),
    );

    // An error of no statement is the request's own (the server not reached, the token refused).
    heard(v, c, o.error === null || o.error.index !== null, o.error?.message ?? null, yield* Clock.currentTimeMillis);

    return { ...o, ms: (yield* Clock.currentTimeMillis) - at };
  }

  const found = yield* clientOf(v, c.kind);
  const client = clientFor(c, "flavor" in found ? found.flavor : undefined);
  const dir = v.dir;

  if (client === null || "missing" in found || dir === null) {
    const message = "missing" in found ? `${found.missing} (${clientFrom(v, found)})` : `the window's private folder couldn't be made${v.dirProblem === null ? "" : `: ${v.dirProblem}`}`;

    if (label !== undefined && Str.isNonEmpty(label)) v.logLine({ sql: label, ok: false, ms: 0, said: message, conn: c.name, run: runLine(v, c.kind, found, client?.args ?? []) });

    return { results: [], error: ownError(message), cut: false, ms: 0, run: runLine(v, c.kind, found, []) };
  }

  const script = scriptOf(c.kind, statements, c.readonly);
  // Asked for, or read from a cluster's secret at connect (kube.ts): both in the window's memory.
  const secret = c.secret === "ask" || c.secret === "kubernetes" ? v.secrets.get(c.id) ?? null : null;

  // The run is named in the Log as it starts (a run stopped or never answering is named too).
  const runs = runLine(v, c.kind, found, client.args);
  const pending: LogLine | null = label !== undefined && Str.isNonEmpty(label) ? { sql: label, ok: true, ms: 0, said: RUNNING, conn: c.name, run: runs } : null;
  const settle = (done: LogLine) => {
    if (pending !== null) v.log = Arr.map(v.log, (l) => (l === pending ? done : l));
  };

  if (pending !== null) v.logLine(pending);

  const r = yield* run({
    kind: c.kind, dir, program: found.path, args: client.args, script: script.text, path: envPath(v),
    account: c.secret === "keychain" ? c.id : null, secret, readonly: c.readonly, limit,
  }, started).pipe(Effect.onInterrupt(() => Effect.sync(() => {
    if (pending !== null) settle({ ...pending, said: "stopped", run: `${runs} · stopped` });
  })));

  const texts = Arr.map(statements, (s) => s.text);
  const writes = Arr.map(statements, (s) => s.risk !== "read");

  const o = onFile(c) ? parseSqlite(r.stdout, r.stderr, r.code, texts, r.cut, writes)
    : c.kind === "postgres" ? parsePsql(r.stdout, r.stderr, r.code, writes, r.cut)
    : parseMysql(r.stdout, r.stderr, r.code, script.lines, texts, r.cut);

  const error = o.error !== null ? connectWords(c, placed(o.error, texts)) : null;
  const line = `${runs} · exit ${r.code}`;
  const stopped = r.code === 130 || r.code === 137;

  // What the run says of the connection (connstate.ts): an answer, or the connection gone.
  if (!stopped && r.code !== NO_KEYCHAIN_ITEM) heard(v, c, !lostRun(c.kind, r.code, r.stderr), error?.message ?? null, yield* Clock.currentTimeMillis);

  // Interrupted or killed (the window's stop): said so, not as the shell's words for it.
  if (pending !== null) settle({ sql: pending.sql, ok: error === null, ms: r.ms, said: stopped ? "stopped" : error !== null ? error.message : `exit ${r.code}`, conn: c.name, run: line });

  return { ...o, error, ms: r.ms, noSecret: r.code === NO_KEYCHAIN_ITEM, run: line };
});

/** Reads started (each busy flag knows whose it is). */
let reads = 0;

/** A bug's throw in a read: the panel says it (as its own error) instead of the read hanging busy. */
const failedWith = (what: string, set: (words: string) => void) => Effect.catchDefect((defect: unknown) => Effect.sync(() => set(`${what} failed: ${causeMessage(defect)}`)));

/** Reads the active connection's tables (and, for SQLite, counts them): a read of [2], stoppable,
 *  busy cleared however it ends. */
export const loadTables = (v: DbView): Effect.Effect<void, never, DbRun> => Effect.suspend(() => {
  const c = v.active;

  if (c === null) return Effect.void;

  const cat = v.catalog;
  const mine = ++reads;

  cat.busy = true;
  cat.by = mine;

  return Effect.gen(function* () {
    yield* redraw;
    yield* folderEnvReady(v);

    const e = yield* reading(v, "reading the tables", "tables", (started) => runOn(v, c, tablesSql(c.kind), started, undefined, "the tables"));

    if (v.active !== c || v.catalog !== cat) return;

    if (!("value" in e)) {
      cat.error = endWords(e, "reading the tables");

      // No answer in time: the connection isn't known to stand (a stop says nothing of it).
      if ("late" in e) heard(v, c, false, cat.error, yield* Clock.currentTimeMillis);

      return;
    }

    const o = e.value;

    if (o.noSecret === true) {
      v.askPassword(c, true);

      return;
    }

    cat.error = o.error !== null ? o.error.message : null;
    cat.tables = o.error !== null ? [] : tablesOf(c.kind, o);
    cat.here = o.error !== null ? null : hereOf(c.kind, o);
    v.connected(c, o.error === null);
    yield* redraw;

    // An empty database: the server's others are read, so its words can offer them (dbs.ts).
    if (o.error === null && cat.tables.length === 0 && hasDatabases(c)) v.run(loadDatabases(v));

    if (o.error === null && (c.kind === "sqlite" || c.kind === "libsql")) yield* countTables(v, c);
  }).pipe(
    failedWith("reading the tables", (words) => {
      if (v.catalog === cat) cat.error = words;
    }),
    Effect.ensuring(Effect.andThen(Effect.sync(() => {
      if (cat.by === mine) cat.busy = false;
    }), redraw)),
  );
});

/** SQLite keeps no estimate: count each table (one run). */
const countTables = (v: DbView, c: Conn): Effect.Effect<void, never, DbRun> => Effect.gen(function* () {
  const list = countsSql(c.kind, v.catalog.tables);

  if (list.length === 0) return;

  const e = yield* reading(v, "counting the rows", "tables", (started) => runOn(v, c, list, started));

  if (v.active !== c || !("value" in e)) return;

  const counted = Arr.filter(v.catalog.tables, (t) => t.type === "table");

  for (const r of e.value.results) {
    const t = counted[r.index];
    const n = Number(r.set?.rows[0]?.[0]);

    if (t !== undefined && Number.isFinite(n)) v.catalog.tables = Arr.map(v.catalog.tables, (x) => (x === t ? { ...x, rows: n } : x));
  }

  yield* redraw;
});

/** Reads a table's structure into the Structure panel (a read of [3]). Postgres and MySQL give
 *  the server's estimate of its rows; an exact count is asked for (countRows). */
export const loadStructure = (v: DbView, t: TableRef): Effect.Effect<void, never, DbRun> => Effect.suspend(() => {
  const c = v.active;

  if (c === null) return Effect.void;

  const s: Struct = { table: t, data: v.struct.table?.name === t.name ? v.struct.data : null, busy: true, error: null };

  v.struct = s;

  return Effect.gen(function* () {
    yield* redraw;

    const e = yield* reading(v, `reading ${t.name}'s structure`, "structure", (started) => runOn(v, c, structureSql(c.kind, t), started, undefined, `${t.name}'s structure`));

    if (v.active !== c || v.struct !== s) return;

    if (!("value" in e)) {
      s.error = endWords(e, `reading ${t.name}'s structure`);

      return;
    }

    const o = e.value;

    s.data = o.error !== null ? null : structureOf(c.kind, o, t.name);
    s.error = o.error?.message ?? null;

    // A count read now is better than the server's estimate.
    const count = s.data?.count ?? null;

    if (count !== null) v.catalog.tables = Arr.map(v.catalog.tables, (x) => (x.name === t.name && x.schema === t.schema ? { ...x, rows: count } : x));

    // A SQLite table without a primary key: its rows read again with their rowid, so they can be edited.
    const b = v.rows.browse;

    if (b !== null && b.rowid !== true && b.table.name === t.name && s.data !== null && readsRowid(c.kind, s.data.columns, t.type)) {
      v.rows.browse = { ...b, rowid: true };
      v.run(loadRows(v, true), { key: "rows" });
    }
  }).pipe(
    failedWith(`reading ${t.name}'s structure`, (words) => {
      s.error = words;
    }),
    Effect.ensuring(Effect.andThen(Effect.sync(() => {
      s.busy = false;
    }), redraw)),
  );
});

/** Counts a table's rows exactly (asked for: on a big table it reads every row). */
export const countRows = (v: DbView, t: TableRef): Effect.Effect<void, never, DbRun> => Effect.gen(function* () {
  const c = v.active;

  if (c === null) return;

  const e = yield* reading(v, `counting ${t.name}'s rows`, "tables", (started) => runOn(v, c, countsSql(c.kind, [{ ...t, type: "table" }]), started, undefined, `${t.name}'s rows counted`));

  if (v.active !== c) return;

  if (!("value" in e)) {
    v.say(endWords(e, `counting ${t.name}'s rows`) ?? "", "failed");

    return;
  }

  const n = Number(e.value.results[0]?.set?.rows[0]?.[0]);

  if (e.value.error !== null) v.say(`${t.name}: ${e.value.error.message}`, "failed");
  else if (Number.isFinite(n)) {
    v.catalog.tables = Arr.map(v.catalog.tables, (x) => (x.name === t.name && x.schema === t.schema ? { ...x, rows: n } : x));
    v.say(`${t.name}: ${n} rows, counted`, "done");
  }
}).pipe(failedWith(`counting ${t.name}'s rows`, (words) => v.say(words, "failed")));

/** The page size of the Rows tab. */
export const PAGE = 200;

/** Reads the Rows tab's page (the table, its sort, filter and offset). Run under the "rows" key: a
 *  newer page asked for replaces it. */
export const loadRows = (v: DbView, keepCursor = false): Effect.Effect<void, never, DbRun> => Effect.suspend(() => {
  const c = v.active;
  const b = v.rows.browse;

  if (c === null || b === null) return Effect.void;

  settleEdit(v);

  const sql = browseSql(c.kind, b);

  if ("refused" in sql) {
    v.rows.error = sql.refused;

    return redraw;
  }

  const rows = v.rows;
  const mine = ++reads;

  rows.busy = true;
  rows.by = mine;

  return Effect.gen(function* () {
    yield* redraw;

    const e = yield* reading(v, `reading ${b.table.name}'s rows`, "rows", (started) => runOn(v, c, sql.statements, started, undefined, `${b.table.name}'s rows`));

    if (v.active !== c || v.rows !== rows || rows.browse !== b) return;

    if (!("value" in e)) {
      rows.error = endWords(e, `reading ${b.table.name}'s rows`);

      return;
    }

    const o = e.value;

    rows.error = o.error !== null ? o.error.message : null;

    const set = Option.getOrNull(Option.flatMap(Arr.findFirst(o.results, (r) => r.index === 0), (r) => Option.fromNullOr(r.set)));
    const columns = v.struct.data !== null && v.struct.table?.name === b.table.name ? Arr.map(v.struct.data.columns, (x) => x.name) : [];

    // An empty page prints no header: the structure's columns stand in.
    rows.set = o.error !== null ? null : set ?? { columns, rows: [] };

    const counted = Option.getOrUndefined(Arr.findFirst(o.results, (r) => r.index === 1))?.set?.rows[0]?.[0];

    rows.total = counted !== undefined && counted !== null ? Number(counted) : Str.isNonEmpty(Str.trim(b.filter)) ? null : v.tableRows(b.table);

    if (!keepCursor) rows.at = gridStart();
  }).pipe(
    failedWith(`reading ${b.table.name}'s rows`, (words) => {
      rows.error = words;
    }),
    Effect.ensuring(Effect.andThen(Effect.sync(() => {
      if (rows.by === mine) rows.busy = false;
    }), redraw)),
  );
});

/** Opens a table in the Rows tab (sorted and filtered as asked, from its first page). */
export function browse(v: DbView, t: TableRef, b: Partial<Pick<Browse, "sort" | "filter">> = {}): void {
  v.rows.browse = { table: { schema: t.schema, name: t.name }, sort: b.sort ?? null, filter: b.filter ?? "", offset: 0, limit: PAGE };
  v.rows.set = null;
  v.rows.total = t.rows;
  v.rows.error = null;
  v.run(loadRows(v), { key: "rows" });
}
