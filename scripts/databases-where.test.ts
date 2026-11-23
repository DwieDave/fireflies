// Where a Databases connection is and whether it is connected (dbs.ts, connstate.ts, connmark.ts):
// a Postgres connection that names no database is in the server's default (`postgres`) and says
// so; the server's databases list (templates left out) and a pick reconnects with -d, remembered
// in a pinned record (never a secret) or, for a sent one, while the window lives; an empty
// database offers the others; one function says the state, and the head's mark, the [1] row's pip
// and the pin's hover all draw from it; a read that can't reach the server turns the mark.
// The client is a stand-in that answers as a server with made-up databases would; with
// FF_TEST_PG_BIN a throwaway PostgreSQL on 127.0.0.1:25433 answers instead (never his ports).
// Its own process: it stands in for "herdr".
import { test, expect, mock, describe } from "bun:test";
import { Deferred, Effect } from "effect";
import { found, standIn } from "./databases-host.ts";

const { h, theme, el, cx, until, flush, advance, services } = standIn();
const { files, commands, opened, closed, execs, written, stores } = h;
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Writes land in `written`; a real run (the throwaway server) also puts them on disk. */
let realFiles = false;

const { default: Databases } = await import("../defaults/mods/databases/main.ts");
(await import("../defaults/mods/databases/app.ts")).useServices(services);
const { runtime: dbRuntime } = await import("../defaults/mods/databases/app.ts");
const { viewRun } = await import("./databases-host.ts");
const runView = viewRun(dbRuntime);
const { command } = await import("../defaults/mods/databases/opening.ts");

function open(p: any) {
  h.props = p;
  const v: any = new Databases();
  v.init(p, cx);
  return v;
}
function render(v: any, width = 1100) {
  v.size = { width, height: 720 };
  h.drawn = [];
  v.render();
  return h.drawn;
}
const framed = (d: [string, any[]][]) => {
  const i = d.findIndex(([m, a]) => m === "id" && a[0] === "databases");
  const j = d.findIndex(([m], n) => n > i && m === "track_focus");
  return d.slice(i, j).some(([m]) => m === "border");
};
const texts = (d: [string, any[]][]) => d.filter(([m]) => m === "child").flatMap(([, a]) => a.filter((x) => typeof x === "string"));
const tips = (d: [string, any[]][]) => d.filter(([m]) => m === "tooltip").map(([, a]) => a[0]);
const key = (k: string, mods: any = {}) => ({ key: k, key_char: k.length === 1 ? k : undefined, modifiers: mods });
const fresh = () => { h.shared = {}; commands.length = 0; opened.length = 0; closed.length = 0; h.panes = []; h.focused = null; stores.clear(); execs.length = 0; written.length = 0; files.clear(); h.reply = found; realFiles = false; };

/** psql's flags of a run, from the runner's arguments (runner.ts runnerArgs: the client's own start at the 12th). */
function psqlArgsOf(args: readonly string[]): Record<string, string> {
  const own = args.slice(11);
  const out: Record<string, string> = {};
  for (let i = 0; i < own.length; i++) if (/^-[hpUd]$/.test(own[i] ?? "")) out[own[i]!.slice(1)] = own[++i] ?? "";
  return out;
}
const { tablesSql, hereOf, databasesSql, databasesOf } = await import("../defaults/mods/databases/catalog.ts");
const { clientFor } = await import("../defaults/mods/databases/clients.ts");
const { connState, stateTip, lostRun, RECHECK_AFTER } = await import("../defaults/mods/databases/connstate.ts");
const { emptyWords, whereNow } = await import("../defaults/mods/databases/dbs.ts");
const { modalKey } = await import("../defaults/mods/databases/popups.ts");
const { connectionsFile } = await import("../defaults/mods/databases/store.ts");

const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });

// ---- a made-up server: databases with their schemas and tables, answered as psql would

type Server = Record<string, { schema: string; name: string; type: "table" | "view" }[]>;
const SERVER: Server = {
  postgres: [],
  lantern: [{ schema: "lanterns", name: "lanterns", type: "table" }, { schema: "lanterns", name: "wicks", type: "table" }, { schema: "moths", name: "moths", type: "table" }, { schema: "moths", name: "bright", type: "view" }],
  glowworm: [{ schema: "public", name: "glows", type: "table" }],
};
let server: Server = SERVER;
/** What the stand-in psql does: answer, or fail as psql does when the server is gone (exit 2). */
let gone = false;
let user = "app";

/** One psql run of the window's script (its file, by the run's nonce), as a server answers it. */
function psqlRun(args: string[]): any {
  const [dir, n] = [args[3], args[4]];
  const script = files.get(`${dir}/q-${n}.sql`) ?? "";
  const a = psqlArgsOf(args);
  if (gone) return { code: 2, stdout: "", stderr: `psql: error: connection to server at "127.0.0.1", port 25433 failed: Connection refused` };
  const db = a.d ?? "postgres";
  if (!(db in server)) return { code: 2, stdout: "", stderr: `psql: error: connection to server at "127.0.0.1", port 25433 failed: FATAL:  database "${db}" does not exist` };
  const out: string[] = [];
  script.split("\n").forEach((line, i, all) => {
    const m = /^\\echo __ff_stmt__ (\d+)$/.exec(line);
    if (!m) return;
    const sql = all[i + 1] ?? "";
    out.push(`__ff_stmt__ ${m[1]}`);
    if (sql.includes("from pg_class c")) out.push("schema,name,type,estimate", ...server[db]!.map((t) => `${t.schema},${t.name},${t.type},-1`));
    else if (sql.includes("current_database()")) out.push("db,who", `${db},${user}`);
    else if (sql.includes("from pg_database")) out.push("name,size", ...Object.keys(server).sort().map((d) => `${d},${sql.includes("pg_database_size") ? 8 * 1024 * 1024 : "␀"}`));
    else if (/^select 1;?$/.test(sql)) out.push("?column?", "1");
  });
  return ok(`${out.join("\n")}\n`);
}

const reset = () => {
  fresh();
  server = SERVER;
  gone = false;
  user = "app";
  h.reply = (cmd: string, args: string[]): any => {
    if (cmd === "sh" && args[2] === "ff-dir") return ok("/tmp/fireflies-db.abc\n");
    if (cmd === "sh" && args[2] === "ff-setup") return ok("nix-darwin\n");
    if (cmd === "sh" && args[2] === "lookup") return args[4] === "psql" ? ok("/run/current-system/sw/bin/psql\n") : { code: 1, stdout: "", stderr: "" };
    if (cmd === "sh" && args[2] === "ff-db") return psqlRun(args);
    if (cmd === "sh" && args[2] === "ff-cancel") return ok("");
    return { code: 1, stdout: "", stderr: "" };
  };
};
const runs = () => execs.filter((a) => a[0] === "sh" && a[3] === "ff-db").map((a) => psqlArgsOf(a.slice(1)));
const drawnText = (v: any, width = 1100) => texts(render(v, width)).join(" | ");

/** His shape: a pod's forward to a Postgres server, user given, no database named. */
const SENT = { kind: "postgres", name: "lantern-postgresql-1 (nightjar-dev/glowworm)", host: "127.0.0.1", port: 25433, user: "app", from: "port-forward pod/lantern-postgresql-1 in nightjar-dev/glowworm" };

async function sent(args: any = SENT) {
  const v = open({ folder: "/w", overlay: "w1" });
  for (let i = 0; i < 4; i++) await flush();
  command(v, `databases.connect:${JSON.stringify(args)}`, cx);
  await until(() => v.alive !== null && !v.catalog.busy && !v.reads.length);
  return v;
}

// ---- item 1: where it is

test("no database named: psql goes to postgres, and the head and [2]'s caption say it is the server's default", async () => {
  reset();
  expect(clientFor({ id: "x", name: "x", kind: "postgres", host: "127.0.0.1", port: 25433, readonly: false, secret: "none", origin: "sent" })?.args.join(" ")).toContain("-d postgres");
  const v = await sent();
  expect(runs()[0]).toMatchObject({ d: "postgres", U: "app" });
  expect(v.catalog.here).toEqual({ database: "postgres", user: "app" });
  expect(whereNow(v.active, v.catalog.here)).toEqual({ database: "postgres", fallback: true, user: "app" });
  const d = drawnText(v);
  expect(d).toContain("connected");
  expect(d).toContain("postgres");
  expect(d).toContain("(the server's default: none was named)");
  expect(d).toContain("as | app");
  expect(d).toContain("in postgres");
  // The head's address leaves the database to the mark.
  expect(d).toContain("127.0.0.1:25433");
});

test("the tables read also asks where it landed; MySQL's user is its name without the host", () => {
  expect(tablesSql("postgres").map((s: any) => s.text)[1]).toBe("select current_database() as db, current_user as who");
  expect(tablesSql("sqlite")).toHaveLength(1);
  const o = (rows: string[][]) => ({ results: [{ index: 0, set: { columns: [], rows: [] } }, { index: 1, set: { columns: ["db", "who"], rows } }], error: null, cut: false });
  expect(hereOf("postgres", o([["lantern", "app"]]) as any)).toEqual({ database: "lantern", user: "app" });
  expect(hereOf("mysql", o([[null as any, "root@localhost"]]) as any)).toEqual({ database: null, user: "root" });
  expect(hereOf("sqlite", o([["x", "y"]]) as any)).toBe(null);
});

test("the server's databases: templates and those that take no connections left out, sizes only asked", () => {
  const pg = databasesSql("postgres")[0].text;
  expect(pg).toContain("where not datistemplate and datallowconn");
  expect(pg).not.toContain("pg_database_size");
  expect(databasesSql("postgres", true)[0].text).toContain("case when has_database_privilege(datname, 'CONNECT') then pg_database_size(datname) end");
  expect(databasesSql("mysql")[0].text).toContain("not in ('mysql','information_schema','performance_schema','sys')");
  expect(databasesSql("sqlite")).toEqual([]);
  expect(databasesOf({ results: [{ index: 0, set: { columns: ["name", "size"], rows: [["api", null], ["lantern", "8192"]] } }], error: null, cut: false } as any)).toEqual([{ name: "api", size: null }, { name: "lantern", size: 8192 }]);
});

test("an empty database with several others: it names them, enter opens the list; a pick reconnects with -d and lists its tables and schemas", async () => {
  reset();
  server = { ...SERVER, moth: [] };
  const v = await sent();
  await until(() => v.dbs?.list.length === 4);
  const e = emptyWords(v);
  expect(e).toMatchObject({ title: "postgres (the server's default: none was named) has no tables", enter: "list", others: ["glowworm", "lantern", "moth"] });
  expect(e.note).toBe("3 other databases on this server: glowworm, lantern, moth · enter opens the list");
  const d = drawnText(v);
  expect(d).toContain("postgres (the server's default: none was named) has no tables");
  expect(d).toContain("the list · b");
  // enter on the empty Tables tab: the Databases tab, the cursor on the database it's in.
  v.panel = "tables";
  v.key(key("enter"), cx);
  expect(v.tablesTab).toBe("databases");
  await until(() => !v.dbs.busy);
  expect(v.tableAt).toBe(3);
  const listed = drawnText(v);
  expect(listed).toContain("connected here");
  for (const n of ["glowworm", "lantern", "moth"]) expect(listed).toContain(n);
  // j to lantern (k from postgres: glowworm, lantern, moth, postgres in order), enter connects.
  v.tableAt = 1;
  v.key(key("enter"), cx);
  await until(() => v.active.database === "lantern" && !v.catalog.busy && v.alive?.ok);
  expect(runs().at(-1)).toMatchObject({ d: "lantern" });
  expect(v.catalog.tables.map((t: any) => `${t.schema}.${t.name}`)).toEqual(["lanterns.lanterns", "lanterns.wicks", "moths.moths", "moths.bright"]);
  const { schemasOf } = await import("../defaults/mods/databases/panels.ts");
  expect(schemasOf(v)).toEqual(["lanterns", "moths"]);
  expect(v.tablesTab).toBe("tables");
  const after = drawnText(v);
  expect(after).toContain("in lantern");
  expect(after).not.toContain("(the server's default");
  // The secret stays in memory and nothing asked again; a sent one keeps the pick while the window lives.
  expect(v.picked.get(v.active.id)).toBe("lantern");
  command(v, `databases.connect:${JSON.stringify(SENT)}`, cx);
  await until(() => !v.catalog.busy && v.alive?.ok && runs().length > 0);
  expect(v.active.database).toBe("lantern");
  expect(runs().at(-1)).toMatchObject({ d: "lantern" });
});

test("an empty database with exactly one other: it names it, enter connects to it; with none: says so", async () => {
  reset();
  server = { postgres: [], lantern: SERVER.lantern! };
  const v = await sent();
  await until(() => v.dbs?.list.length === 2);
  expect(emptyWords(v)).toMatchObject({ note: "1 other database on this server: lantern · enter connects to it", enter: { use: "lantern" }, others: ["lantern"] });
  v.panel = "tables";
  v.key(key("enter"), cx);
  await until(() => v.active.database === "lantern" && !v.catalog.busy && v.alive?.ok);
  expect(v.catalog.tables).toHaveLength(4);
  reset();
  server = { postgres: [] };
  const w = await sent();
  await until(() => w.dbs?.list.length === 1);
  expect(emptyWords(w)).toMatchObject({ note: "and the server has no other database app may connect to", enter: null });
});

test("b and the head's database open the Databases tab; [ ] go round the kind's four tabs; a file has none", async () => {
  reset();
  const v = await sent({ ...SENT, database: "lantern" });
  v.panel = "conns";
  v.key(key("b"), cx);
  expect([v.panel, v.tablesTab]).toEqual(["tables", "databases"]);
  await until(() => !v.dbs.busy && v.dbs.list.length === 3);
  expect(v.tableAt).toBe(1);
  v.key(key("]"), cx);
  expect(v.tablesTab).toBe("tables");
  v.key(key("["), cx);
  expect(v.tablesTab).toBe("databases");
  v.key(key("["), cx);
  expect(v.tablesTab).toBe("schemas");
  // The head's database is a click target that does the same.
  const d = render(v);
  const at = d.findIndex(([m, a]) => m === "id" && a[0] === "db-where-db");
  expect(at).toBeGreaterThan(-1);
  const { tablesTabsOf } = await import("../defaults/mods/databases/state.ts");
  expect(tablesTabsOf("mysql")).toEqual(["tables", "views", "databases"]);
  expect(tablesTabsOf("sqlite")).toEqual(["tables", "views", "schemas"]);
});

test("a pinned connection keeps the pick in its record (no secret in the file); MySQL lists every database first", async () => {
  reset();
  const pinned = { id: "pg-lantern1", name: "lantern", kind: "postgres", host: "127.0.0.1", port: 25433, user: "app", secret: "kubernetes", source: { from: "kubernetes", context: "nightjar-dev", namespace: "glowworm", name: "lantern-app", key: "password", databaseKey: "dbname" } };
  files.set(connectionsFile("/tmp/herdr-test"), JSON.stringify({ connections: [pinned] }));
  h.reply = ((base) => (cmd: string, args: string[], o: any) => (cmd === "kubectl" ? ok(`${Buffer.from("moth-lantern-42").toString("base64")}\n${Buffer.from("postgres").toString("base64")}\n`) : base(cmd, args, o)))(h.reply);
  const v = open({ folder: "/w", overlay: "w1" });
  for (let i = 0; i < 6; i++) await flush();
  v.connectTo(v.saved[0], cx);
  await until(() => v.alive?.ok && !v.catalog.busy && !v.reads.length);
  // The secret said postgres; a pick of lantern goes into the record and wins at the next connect.
  const { showDatabases, useDatabase } = await import("../defaults/mods/databases/dbs.ts");
  showDatabases(v, cx);
  await until(() => !v.dbs.busy);
  useDatabase(v, "lantern", cx);
  await until(() => v.active.database === "lantern" && v.alive?.ok && !v.catalog.busy);
  await until(() => JSON.parse(files.get(connectionsFile("/tmp/herdr-test")) ?? "{}").connections?.[0]?.database === "lantern");
  const file = files.get(connectionsFile("/tmp/herdr-test")) ?? "";
  expect(JSON.parse(file).connections[0]).toMatchObject({ id: "pg-lantern1", database: "lantern", source: { name: "lantern-app", key: "password" } });
  expect(JSON.parse(file).connections[0].source.databaseKey).toBe(undefined);
  expect(file).not.toContain("moth-lantern-42");
  // A restarted window connects to lantern, the secret read again (its database key no longer asked).
  const w = open({ folder: "/w", overlay: "w2" });
  for (let i = 0; i < 6; i++) await flush();
  w.connectTo(w.saved[0], cx);
  await until(() => w.alive?.ok && !w.catalog.busy && !w.reads.length);
  expect(runs().at(-1)).toMatchObject({ d: "lantern" });
  expect(w.secrets.get("pg-lantern1")).toBe("moth-lantern-42");
  // MySQL's tab: every database first (none named: every database's tables).
  const { dbRows } = await import("../defaults/mods/databases/dbs.ts");
  const fake: any = { active: { id: "m", kind: "mysql" }, dbs: { conn: "m", list: [{ name: "lantern", size: null }], busy: false, error: null, sized: false } };
  expect(dbRows(fake)).toEqual([null, "lantern"]);
});

// ---- item 2: the mark

test("the state function's every state, and the head's mark, the row's pip and the pin's hover all say it", async () => {
  reset();
  const v = open({ folder: "/w", overlay: "w1" });
  for (let i = 0; i < 4; i++) await flush();
  expect(connState(v, null)).toEqual({ kind: "off" });
  expect(drawnText(v)).toContain("not connected");
  // Connecting: a client that waits.
  // While held, client runs wait; release lets every waiting one answer.
  const gate = () => Effect.runSync(Deferred.make<void>());
  let hold = true;
  let opening = gate();
  const release = () => { hold = false; Effect.runSync(Deferred.succeed(opening, undefined)); opening = gate(); };
  const base = h.reply;
  h.reply = (cmd: string, args: readonly string[], o: any) => (cmd === "sh" && args[2] === "ff-db" && hold ? Effect.andThen(Deferred.await(opening), Effect.sync(() => psqlRun([...args]))) : base(cmd, args, o));
  command(v, `databases.connect:${JSON.stringify({ ...SENT, readonly: true })}`, cx);
  await until(() => v.catalog.busy && v.reads.length > 0);
  expect(connState(v, v.active).kind).toBe("connecting");
  let d = render(v);
  expect(texts(d)).toContain("connecting…");
  expect(texts(d)).toContain("read only");
  expect(d.some(([m, a]) => m === "loop" && a[0] === "opacity")).toBe(true);
  release();
  await until(() => v.alive?.ok && !v.catalog.busy && !v.reads.length);
  const s = connState(v, v.active);
  expect(s.kind).toBe("connected");
  const tip = stateTip(s, whereNow(v.active, v.catalog.here), true);
  expect(tip).toContain("Connected since ");
  expect(tip).toContain("in postgres (the server's default: none was named) as app");
  expect(tip).toContain("read only");
  // The three places: the head's mark, the row's pip, the pin's hover.
  d = render(v);
  const all = tips(d);
  expect(all.filter((x) => x.startsWith("Connected since "))).toHaveLength(2);
  expect(all.some((x) => x.startsWith("P or a click pins it") && x.includes(" · connected · in postgres as app"))).toBe(true);
  // Reading again (r): connected, breathing.
  hold = true;
  v.refreshCatalog(cx);
  expect(connState(v, v.active).kind).toBe("reading");
  release();
  await until(() => !v.catalog.busy);
  // Failed: the server gone, the next read says so everywhere.
  h.reply = base;
  gone = true;
  v.refreshCatalog(cx);
  await until(() => !v.catalog.busy && v.alive && !v.alive.ok);
  const f = connState(v, v.active);
  expect(f.kind).toBe("failed");
  expect(f.why).toContain("nothing listens on 127.0.0.1:25433");
  d = render(v);
  expect(texts(d)).toContain("not connected");
  expect(tips(d).filter((x) => x.startsWith("Not connected: nothing listens"))).toHaveLength(2);
  expect(tips(d).some((x) => x.includes(" · not connected: nothing listens"))).toBe(true);
  // Another connection's row: off (its pip dim, no state in its hover).
  expect(connState(v, { ...v.active, id: "other" })).toEqual({ kind: "off" });
});

test("the mark turns when a read can't reach the server: a page of rows on a forward that died", async () => {
  reset();
  const v = await sent({ ...SENT, database: "lantern" });
  expect(connState(v, v.active).kind).toBe("connected");
  gone = true;
  const { browse } = await import("../defaults/mods/databases/session.ts");
  browse(v, v.catalog.tables[0], cx);
  await until(() => !v.rows.busy && v.rows.error !== null);
  expect(connState(v, v.active)).toMatchObject({ kind: "failed" });
  expect(drawnText(v)).toContain("not connected");
  // A statement's own error is an answer: the server spoke, the mark stays lit.
  expect(lostRun("postgres", 3, "ERROR:  relation \"x\" does not exist")).toBe(false);
  expect(lostRun("postgres", 2, "")).toBe(true);
  expect(lostRun("mysql", 1, "ERROR 2003 (HY000): Can't connect to MySQL server on '127.0.0.1:3306' (61)")).toBe(true);
  expect(lostRun("mysql", 1, "ERROR 1146 (42S02) at line 2: Table 'x.y' doesn't exist")).toBe(false);
});

test("the focus coming back after a while asks the connection once more; a dead port turns the mark with words", async () => {
  reset();
  const v = await sent();
  const n = runs().length;
  // Shortly after an answer: nothing is asked.
  v.handle = { focus() {}, is_focused: () => true, release: () => true };
  render(v);
  await runView(v.tick());
  expect(runs().length).toBe(n);
  // A while after: one select 1.
  v.handle = { focus() {}, is_focused: () => false, release: () => true };
  render(v);
  v.alive.at -= RECHECK_AFTER + 1000;
  gone = true;
  v.handle = { focus() {}, is_focused: () => true, release: () => true };
  render(v);
  await runView(v.tick());
  await until(() => !v.checking);
  expect(runs().length).toBe(n + 1);
  expect(files.get(`/tmp/fireflies-db.abc/q-${execs.filter((a) => a[3] === "ff-db").at(-1)?.[5]}.sql`)).toContain("select 1;");
  expect(connState(v, v.active)).toMatchObject({ kind: "failed" });
  expect(v.log[0]).toMatchObject({ sql: "a check that it answers", ok: false });
});

test("the mark's menu (a click, C): reconnect, the databases, copy, disconnect, each with its key", async () => {
  reset();
  const v = await sent();
  v.panel = "tables";
  v.key(key("C"), cx);
  expect(v.menu.title).toBe("lantern-postgresql-1 (nightjar-dev/glowworm) · connected");
  expect(v.menu.rows.map((r: any) => [r.label, r.key ?? null])).toEqual([
    ["Read it again", "r"], ["Reconnect", null], ["The server's databases…", "b"], ["Test", "t"], ["Copy its address", "y"], ["Disconnect", "x"],
  ]);
  // The mark is a click target in the head.
  const d = render(v);
  expect(d.some(([m, a]) => m === "id" && a[0] === "db-state")).toBe(true);
  v.menu.rows[2].go();
  expect(v.tablesTab).toBe("databases");
  v.menu = null;
  v.menu = null;
  v.key(key("C"), cx);
  v.menu.rows.at(-1).go();
  expect(v.active).toBe(null);
  expect(connState(v, null)).toEqual({ kind: "off" });
});

test("narrow: the mark stays, its words go (in its hover)", async () => {
  reset();
  const v = await sent();
  const narrow = render(v, 500);
  expect(narrow.some(([m, a]) => m === "id" && a[0] === "db-state")).toBe(true);
  expect(texts(narrow)).not.toContain("connected");
  expect(tips(narrow).some((x) => x.startsWith("Connected since "))).toBe(true);
});

test("b and C type in the window's fields", async () => {
  reset();
  const v = await sent();
  const q = v.addQuery("");
  const { startRename } = await import("../defaults/mods/databases/menus.ts");
  startRename(v, q);
  expect(["b", "C"].map((k) => modalKey(v, key(k), cx))).toEqual(["typing", "typing"]);
});

// ---- a throwaway PostgreSQL (FF_TEST_PG_BIN), the window's own client runs against it

const PG_BIN = process.env.FF_TEST_PG_BIN ?? "";

describe.skipIf(!PG_BIN)("a real PostgreSQL 18 on 127.0.0.1:25433", () => {
  test("no database named: the default, the empty words, the list without templates, a pick that lists its tables and schemas", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const base = mkdtempSync(join(tmpdir(), "ff-dbw-"));
    const pg = (cmd: string, args: string[]) => Bun.spawnSync([join(PG_BIN, cmd), ...args], { stdout: "pipe", stderr: "pipe" });
    const q = (u: string, db: string, sql: string) => pg("psql", ["-X", "-q", "-h", "127.0.0.1", "-p", "25433", "-U", u, "-d", db, "-v", "ON_ERROR_STOP=1", "-c", sql]);
    expect(pg("initdb", ["-D", join(base, "data"), "-A", "trust", "-U", "postgres"]).exitCode).toBe(0);
    expect(Bun.spawnSync([join(PG_BIN, "pg_ctl"), "-D", join(base, "data"), "-l", join(base, "log"), "-o", `-p 25433 -k ${base} -c listen_addresses=127.0.0.1`, "-w", "start"], { stdout: "ignore", stderr: "ignore" }).exitCode).toBe(0);
    try {
      q("postgres", "postgres", "create role app login");
      q("postgres", "postgres", "create database lantern owner app");
      expect(q("app", "lantern", "create schema lanterns; create schema moths; create table lanterns.lanterns(id int primary key); create table moths.moths(id int); create view moths.bright as select * from moths.moths").exitCode).toBe(0);
      reset();
      realFiles = true;
      process.env.PATH = `${PG_BIN}:${process.env.PATH}`;
      h.reply = (cmd: string, args: string[]): any => {
        const r = Bun.spawnSync([cmd, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
        return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
      };
      const v = open({ folder: base, overlay: "w1" });
      for (let i = 0; i < 6; i++) await flush();
      command(v, `databases.connect:${JSON.stringify(SENT)}`, cx);
      await until(() => v.alive !== null && !v.catalog.busy && !v.reads.length, 15000);
      expect(v.catalog.error).toBe(null);
      expect(v.catalog.here).toEqual({ database: "postgres", user: "app" });
      await until(() => v.dbs?.list.length > 0 && !v.dbs.busy, 15000);
      expect(v.dbs.list.map((d: any) => d.name)).toEqual(["lantern", "postgres"]);
      expect(emptyWords(v)).toMatchObject({ note: "1 other database on this server: lantern · enter connects to it" });
      v.panel = "tables";
      v.key(key("enter"), cx);
      await until(() => v.active.database === "lantern" && v.alive?.ok && !v.catalog.busy && !v.reads.length, 15000);
      expect(v.catalog.here).toEqual({ database: "lantern", user: "app" });
      expect(v.catalog.tables.map((t: any) => `${t.schema}.${t.name}:${t.type}`)).toEqual(["lanterns.lanterns:table", "moths.moths:table", "moths.bright:view"]);
      // Sizes on demand.
      const { loadDatabases } = await import("../defaults/mods/databases/dbs.ts");
      await runView(loadDatabases(v, true));
      expect(v.dbs.list.every((d: any) => typeof d.size === "number" && d.size > 0)).toBe(true);
      // The server stops: the next read turns the mark.
      Bun.spawnSync([join(PG_BIN, "pg_ctl"), "-D", join(base, "data"), "-m", "immediate", "stop"], { stdout: "ignore", stderr: "ignore" });
      v.refreshCatalog(cx);
      await until(() => !v.catalog.busy && !v.reads.length, 15000);
      expect(connState(v, v.active).kind).toBe("failed");
    } finally {
      Bun.spawnSync([join(PG_BIN, "pg_ctl"), "-D", join(base, "data"), "-m", "immediate", "stop"], { stdout: "ignore", stderr: "ignore" });
      rmSync(base, { recursive: true, force: true });
    }
  }, 60000);
});
