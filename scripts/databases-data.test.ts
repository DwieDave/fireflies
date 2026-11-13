// The Databases window's data (defaults/mods/databases): mysql's XML, a
// remote libSQL database's answers, the catalog (for real against a SQLite
// file), connections found in a folder, exports, the history, and the
// keychain (a throwaway keychain, never Developer's). No secret reaches a
// file, an argv or shared state.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMysql, unescapeXml } from "../defaults/mods/databases/parse-mysql.ts";
import { parseHrana, pipelineBody, httpBase, runHrana } from "../defaults/mods/databases/hrana.ts";
import { scriptOf } from "../defaults/mods/databases/script.ts";
import { tablesSql, tablesOf, structureSql, structureOf, browseSql, countsSql, pgForeignKey, quoteText } from "../defaults/mods/databases/catalog.ts";
import { parsePsql, parseSqlite } from "../defaults/mods/databases/parse-out.ts";
import { run, privateDir, removeDir } from "../defaults/mods/databases/runner.ts";
import { sqliteArgs, clientFor } from "../defaults/mods/databases/clients.ts";
import { parseEnvFile, parseDbUrl, foundInVars, foundFile, mergeFound, FIND_SCRIPT } from "../defaults/mods/databases/discover.ts";
import { toCsv, toJson, toInserts, exportName, writeOut, exactNumber } from "../defaults/mods/databases/export.ts";
import { redact, addLine, saveSecret, readSecret } from "../defaults/mods/databases/secrets.ts";
import { readConnections, writeConnections, addHistory, withEntry } from "../defaults/mods/databases/store.ts";
import { where, connJson } from "../defaults/mods/databases/kinds.ts";

const FIX = new URL("./fixtures/databases/", import.meta.url).pathname;

/** sqlite3 and macOS's security are here (CI's Linux image may lack them: those tests skip). */
const SQLITE = Bun.which("sqlite3") !== null;
const KEYCHAIN = process.platform === "darwin" && Bun.which("security") !== null;

function realIo(seen: string[][] = []) {
  return {
    seen,
    exec: async (cmd: string, args: string[] = []) => {
      seen.push([cmd, ...args]);
      const p = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      return { code: await p.exited, stdout, stderr };
    },
    writeTextFile: async (path: string, text: string, expected: string | null) => {
      if (expected === null && existsSync(path)) throw new Error("exists");
      if (expected !== null && readFileSync(path, "utf8") !== expected) throw new Error("stale");
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, text);
      return null;
    },
    readTextFile: async (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null),
  };
}

describe("mysql --xml", () => {
  const statements = ["select id, name, note from lanterns order by id", "update lanterns set lit = 1 where owner = 2", "select * from lanterns where false", "select x\nfrm lanterns"];
  const script = scriptOf("mysql", statements.map((text, i) => ({ text, risk: i === 1 ? "write" : "read" })));

  test("NULL apart from the text NULL, entities read, row counts, an empty result", () => {
    const o = parseMysql(readFileSync(FIX + "mysql-run.xml", "utf8"), readFileSync(FIX + "mysql-run.err", "utf8"), 1, script.lines, statements);
    expect(o.results[0]!.set).toEqual({ columns: ["id", "name", "note"], rows: [["1", "Harbour <Watch> & Co", "NULL"], ["2", "two\nlines", null]] });
    expect(o.results[1]).toMatchObject({ index: 1, affected: 3, set: null });
    expect(o.results[2]!.set).toEqual({ columns: [], rows: [] });
    expect(o.error).toEqual({ index: 3, message: expect.stringContaining("near 'frm lanterns' at line 2"), line: 2, col: 1, hint: null });
    expect(script.lines).toEqual([2, 4, 7, 9]);
  });

  test("connecting fails before any statement", () => {
    const o = parseMysql("", readFileSync(FIX + "mysql-noserver.err", "utf8"), 1, script.lines, statements);
    expect(o.error).toMatchObject({ index: null, message: expect.stringContaining("Can't connect") });
    expect(unescapeXml("&#x41;&#66;&quot;")).toBe('AB"');
  });
});

describe("a remote libSQL database (Hrana over HTTP, a fake server)", () => {
  const answer = (results: unknown) => JSON.stringify({ baton: null, base_url: null, results });

  test("the request: one batch, each step after the one before went well, and the token in a header only", async () => {
    let seen: any = null;
    const fetcher = async (url: string, init: any) => {
      seen = { url, ...init };
      return { status: 200, text: async () => answer([{ type: "ok", response: { type: "batch", result: {
        step_results: [{ cols: [{ name: "id", decltype: "INTEGER" }, { name: "b", decltype: "BLOB" }], rows: [[{ type: "integer", value: "1" }, { type: "blob", base64: "AP8=" }], [{ type: "float", value: 1.5 }, { type: "null" }]], affected_row_count: 0 }, null],
        step_errors: [null, { message: "SQLite error: no such table: x", code: "SQLITE_ERROR" }] } } }, { type: "ok", response: { type: "close" } }]) };
    };
    const o = await runHrana(fetcher, "libsql://edge-cache-dw.turso.io/", "tok-123", ["select 1", "select * from x"]);
    expect(seen.url).toBe("https://edge-cache-dw.turso.io/v2/pipeline");
    expect(seen.headers.authorization).toBe("Bearer tok-123");
    expect(seen.body).not.toContain("tok-123");
    expect(JSON.parse(seen.body).requests[0].batch.steps[1].condition).toEqual({ type: "ok", step: 0 });
    expect(o.results[0]!.set).toEqual({ columns: ["id", "b"], types: ["INTEGER", "BLOB"], rows: [["1", "x'00ff'"], ["1.5", null]] });
    expect(o.error).toEqual({ index: 1, message: "no such table: x", line: null, col: null, hint: null });
  });

  test("a refused token and a broken answer", () => {
    expect(parseHrana(401, "", 1).error!.message).toBe("the token was refused");
    expect(parseHrana(200, "{}", 1).error!.message).toBe("the server answered 200");
    expect(httpBase("https://x.turso.io/")).toBe("https://x.turso.io");
    expect(pipelineBody(["a"])).toBe('{"requests":[{"type":"batch","batch":{"steps":[{"stmt":{"sql":"a"}}]}},{"type":"close"}]}');
  });
});

describe.skipIf(!SQLITE)("the catalog, for real against SQLite", () => {
  const dir = mkdtempSync(join(tmpdir(), "ffcat-"));
  const db = join(dir, "lanterns.db");
  if (SQLITE) Bun.spawnSync(["sqlite3", db, `
    create table users (id integer primary key, handle text not null unique);
    create table lanterns (id integer primary key, name text not null, owner_id integer references users(id) on delete cascade, lumens integer default 800, meta blob);
    create index lanterns_owner_idx on lanterns(owner_id);
    create view bright as select * from lanterns where lumens > 1000;
    insert into users(handle) values ('ada'), ('kestrel');
    insert into lanterns(name, owner_id, lumens) values ('Harbour Watch', 1, 1600), ('Paper Moon', 2, 720), ('O''Brien', 1, null);`]);
  const sqlite = async (statements: { text: string; risk: "read" }[]) => {
    const io = realIo();
    const d = (await privateDir(io))!;
    const r = await run(io, { kind: "sqlite", dir: d, program: "sqlite3", args: sqliteArgs(db, true), script: scriptOf("sqlite", statements).text, readonly: true });
    await removeDir(io, d);
    return parseSqlite(r.stdout, r.stderr, r.code, statements.map((s) => s.text));
  };

  test("tables and views, then their counts", async () => {
    const tables = tablesOf("sqlite", await sqlite(tablesSql("sqlite")));
    expect(tables).toEqual([
      { schema: null, name: "lanterns", type: "table", rows: null }, { schema: null, name: "users", type: "table", rows: null }, { schema: null, name: "bright", type: "view", rows: null }]);
    const counts = await sqlite(countsSql("sqlite", tables));
    expect(counts.results.map((r) => r.set!.rows[0]![0])).toEqual(["3", "2"]);
  });

  test("a table's structure: columns, indexes, keys both ways, its count", async () => {
    const lanterns = structureOf("sqlite", await sqlite(structureSql("sqlite", { schema: null, name: "lanterns" })), "lanterns");
    expect(lanterns.columns[0]).toEqual({ name: "id", type: "INTEGER", nullable: true, default: null, pk: true });
    expect(lanterns.columns[1]).toMatchObject({ name: "name", nullable: false });
    expect(lanterns.columns[3]).toMatchObject({ name: "lumens", default: "800" });
    expect(lanterns.indexes).toEqual([{ name: "lanterns_owner_idx", kind: "", method: "", columns: "owner_id" }]);
    expect(lanterns.keys).toEqual([{ name: "fk0", from: "lanterns", fromColumns: "owner_id", to: "users", toColumns: "id", onDelete: "cascade", incoming: false }]);
    expect(lanterns.count).toBe(3);
    const users = structureOf("sqlite", await sqlite(structureSql("sqlite", { schema: null, name: "users" })), "users");
    expect(users.keys).toEqual([{ name: "fk", from: "lanterns", fromColumns: "owner_id", to: "users", toColumns: "id", onDelete: "cascade", incoming: true }]);
    expect(users.indexes[0]).toMatchObject({ kind: "unique", columns: "handle" });
  });

  test("a page: sorted, filtered, counted; a filter that is a statement of its own is refused", async () => {
    const b = browseSql("sqlite", { table: { schema: null, name: "lanterns" }, sort: { column: "lumens", desc: true }, filter: "where lumens > 700", offset: 0, limit: 200 });
    if (!("statements" in b)) throw new Error("refused");
    const o = await sqlite(b.statements);
    expect(o.results[0]!.set!.rows.map((r) => r[1])).toEqual(["Harbour Watch", "Paper Moon"]);
    expect(o.results[1]!.set!.rows[0]![0]).toBe("2");
    expect(browseSql("sqlite", { table: { schema: null, name: "t" }, sort: null, filter: "1 = 1; drop table t", offset: 0, limit: 10 })).toEqual({ refused: expect.any(String) });
    expect(browseSql("sqlite", { table: { schema: null, name: "t" }, sort: null, filter: "1 = 1); delete from t where (1", offset: 0, limit: 10 })).toEqual({ refused: expect.any(String) });
  });

  test("Postgres' structure, recorded", () => {
    const out = readFileSync(FIX + "psql-catalog.out", "utf8").replaceAll("__FF__", "__ff_stmt__");
    const o = parsePsql(out, "", 0, [false, false, false, false, false, false]);
    const tables = tablesOf("postgres", { ...o, results: o.results.filter((r) => r.index === 1).map((r) => ({ ...r, index: 0 })) });
    expect(tables.map((t) => `${t.schema}.${t.name}:${t.type}`)).toEqual(["billing.invoices:table", "public.lanterns:table", "public.users:table", "public.bright:view"]);
    const s = structureOf("postgres", { ...o, results: o.results.filter((r) => r.index > 1).map((r) => ({ ...r, index: r.index - 2 })) }, "lanterns");
    expect(s.columns[0]).toEqual({ name: "id", type: "bigint", nullable: false, default: "nextval('lanterns_id_seq'::regclass)", pk: true });
    expect(s.indexes.map((i) => [i.name, i.kind, i.columns])).toEqual([["lanterns_pkey", "primary", "id"], ["lanterns_owner_idx", "", "owner_id"]]);
    expect(s.keys).toEqual([{ name: "lanterns_owner_id_fkey", from: "lanterns", fromColumns: "owner_id", to: "users", toColumns: "id", onDelete: "cascade", incoming: false }]);
    expect(s.count).toBe(4);
    expect(pgForeignKey("FOREIGN KEY (a, b) REFERENCES s.t(x, y)")).toEqual({ fromColumns: "a, b", to: "s.t", toColumns: "x, y", onDelete: null });
    expect(quoteText("mysql", "a\\'b")).toBe("'a\\\\''b'");
  });
});

describe("connections found in a folder", () => {
  test(".env files: quotes, export, comments", () => {
    const vars = parseEnvFile('# x\nexport DATABASE_URL="postgres://ada:p%40ss@db.local:6543/lantern?sslmode=require"\nREDIS_URL=redis://x\nTURSO_DATABASE_URL=libsql://edge.turso.io\nTURSO_AUTH_TOKEN=tok # the token\nDB_FILE_URL=file:./dev.db\n');
    expect(vars.get("TURSO_AUTH_TOKEN")).toBe("tok");
    const found = foundInVars(vars, ".env", "/w/app");
    expect(found.map((f) => [f.conn.name, f.conn.kind, where(f.conn), f.secret, f.conn.readonly, f.conn.secret])).toEqual([
      ["DATABASE_URL", "postgres", "db.local:6543/lantern", "p@ss", true, "ask"],
      ["TURSO_DATABASE_URL", "libsql", "edge.turso.io", "tok", true, "ask"],
      ["DB_FILE_URL", "sqlite", "/w/app/dev.db", null, true, "none"],
    ]);
    // The found connection itself holds no secret, and what's kept of it neither.
    for (const f of found) expect(JSON.stringify(connJson(f.conn))).not.toMatch(/p@ss|p%40ss|tok/);
  });

  test("URLs of every kind", () => {
    expect(parseDbUrl("mysql://root@127.0.0.1:3307/shop")).toEqual({ kind: "mysql", password: null, user: "root", host: "127.0.0.1", port: 3307, database: "shop" });
    expect(parseDbUrl("libsql://x.turso.io?authToken=abc")).toEqual({ kind: "libsql", url: "libsql://x.turso.io", password: "abc" });
    expect(parseDbUrl("sqlite:///var/data/a.db")).toEqual({ kind: "sqlite", path: "/var/data/a.db", password: null });
    expect(parseDbUrl("https://example.com")).toBeNull();
  });

  test("PG* variables, and one connection when the .env and direnv both have it", () => {
    const pg = foundInVars(new Map([["PGHOST", "/run/pg"], ["PGDATABASE", "app"], ["PGPASSWORD", "pw"]]), "direnv", "/w");
    expect(pg[0]).toMatchObject({ conn: { kind: "postgres", host: "/run/pg", database: "app", name: "app" }, secret: "pw" });
    const a = foundInVars(new Map([["DATABASE_URL", "postgres://h/db"]]), ".env", "/w");
    const b = foundInVars(new Map([["DATABASE_URL", "postgres://h/db"]]), "direnv", "/w");
    expect(mergeFound([a, b]).map((f) => f.conn.from)).toEqual(["direnv · DATABASE_URL"]);
  });

  test.skipIf(!SQLITE)("SQLite files by their header, past dependencies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fffind-"));
    mkdirSync(join(dir, "data"));
    mkdirSync(join(dir, "node_modules"));
    Bun.spawnSync(["sqlite3", join(dir, "data/app.db"), "create table t(a)"]);
    Bun.spawnSync(["sqlite3", join(dir, "node_modules/dep.db"), "create table t(a)"]);
    writeFileSync(join(dir, "fake.db"), "not a database at all");
    const r = await realIo().exec("sh", ["-c", FIND_SCRIPT, "find", dir]);
    expect(r.stdout.trim().split("\n")).toEqual([join(dir, "data/app.db")]);
    expect(foundFile(join(dir, "data/app.db"), dir).conn).toMatchObject({ name: "data/app.db", kind: "sqlite", readonly: true });
  });
});

describe("exports", () => {
  const set = { columns: ["id", "name", "zip", "note"], rows: [["1", 'a "b", c', "01234", null], ["20", "two\nlines", "99", ""]] };

  test("CSV, JSON and SQL inserts", () => {
    expect(toCsv(set)).toBe('id,name,zip,note\n1,"a ""b"", c",01234,\n20,"two\nlines",99,\n');
    expect(JSON.parse(toJson(set))).toEqual([{ id: 1, name: 'a "b", c', zip: "01234", note: null }, { id: 20, name: "two\nlines", zip: "99", note: "" }]);
    expect(toInserts(set, "mysql", "`t`")).toBe("INSERT INTO `t` (`id`, `name`, `zip`, `note`) VALUES (1, 'a \"b\", c', '01234', NULL);\nINSERT INTO `t` (`id`, `name`, `zip`, `note`) VALUES (20, 'two\nlines', '99', '');\n");
    expect(exportName("public lanterns", "json", new Date("2026-11-13T10:00:00Z"))).toBe("public_lanterns-2026-11-13.json");
    expect([exactNumber("1.50"), exactNumber("1.5"), exactNumber("007"), exactNumber("1e3")]).toEqual([true, true, false, false]);
  });

  test("a file bigger than writeTextFile takes, in parts", async () => {
    const io = realIo();
    const d = (await privateDir(io))!;
    const out = join(mkdtempSync(join(tmpdir(), "ffexp-")), "big.csv");
    const text = "é".repeat(1_200_000);
    expect(await writeOut(io, d, out, text)).toBeNull();
    expect(readFileSync(out, "utf8")).toBe(text);
    expect(readdirSync(d)).toEqual([]);
    await removeDir(io, d);
  });
});

describe("history and saved connections", () => {
  test("a password literal never reaches the history", () => {
    expect(redact("create user ada with password 'hunter2'")).toBe("create user ada with password '•••'");
    expect(redact("CREATE USER 'a'@'%' IDENTIFIED BY \"x\";")).toBe("CREATE USER 'a'@'%' IDENTIFIED BY '•••';");
    expect(redact("select 'postgres://u:pw@h/db'")).toBe("select 'postgres://u:•••@h/db'");
    const list = withEntry([{ sql: "select 1", at: 1 }], { sql: "  select 1 ", at: 2 });
    expect(list).toEqual([{ sql: "select 1", at: 2 }]);
  });

  test("written and read back, found ones never written", async () => {
    const home = mkdtempSync(join(tmpdir(), "ffhome-"));
    const io = realIo();
    await writeConnections(io, home, [
      { id: "pg-1", name: "lantern-dev", kind: "postgres", host: "localhost", user: "ada", database: "lantern", readonly: false, secret: "keychain", origin: "saved" },
      { id: "found:x", name: "DATABASE_URL", kind: "postgres", readonly: true, secret: "ask", origin: "found", from: ".env · DATABASE_URL" },
    ]);
    const text = readFileSync(join(home, "data/databases/connections.json"), "utf8");
    expect(text).not.toContain("DATABASE_URL");
    expect(await readConnections(io, home)).toEqual([{ id: "pg-1", name: "lantern-dev", kind: "postgres", host: "localhost", user: "ada", database: "lantern", readonly: false, secret: "keychain", origin: "saved" }]);
    const h = await addHistory(io, home, "pg-1", { sql: "alter user x password 'pw'", at: 5, ok: true });
    expect(h[0]!.sql).toBe("alter user x password '•••'");
    expect(readFileSync(join(home, "data/databases/history/pg-1.json"), "utf8")).not.toContain("'pw'");
  });

  test("clients never carry a secret", () => {
    const c = clientFor({ id: "pg-1", name: "x", kind: "postgres", host: "h", port: 6543, user: "ada", database: "d", readonly: false, secret: "keychain", origin: "saved" })!;
    expect(c).toEqual({ programs: ["psql"], args: ["-X", "-A", "--csv", "-w", "-v", "ON_ERROR_STOP=1", "-v", "FETCH_COUNT=500", "-P", "null=␀", "-h", "h", "-p", "6543", "-U", "ada", "-d", "d"] });
    expect(clientFor({ id: "l", name: "x", kind: "libsql", url: "libsql://x", readonly: false, secret: "keychain", origin: "saved" })).toBeNull();
  });
});

describe.skipIf(!KEYCHAIN)("the keychain (a throwaway one)", () => {
  test("saved through security -i from a file: nothing on an argv, the file gone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ffkc-"));
    const kc = join(dir, "t.keychain-db");
    Bun.spawnSync(["security", "create-keychain", "-p", "t", kc]);
    Bun.spawnSync(["security", "unlock-keychain", "-p", "t", kc]);
    const seen: string[][] = [];
    const io = realIo(seen);
    const d = (await privateDir(io))!;
    const secret = `p a"ss\\w0rd $HOME 'x'`;
    // The same line saveSecret writes, aimed at the throwaway keychain (its last argument).
    const line = addLine("pg-1", "Fireflies database lantern-dev", secret).replace(/\n$/, ` "${kc}"\n`);
    writeFileSync(join(d, "k"), line);
    const r = Bun.spawnSync(["sh", "-c", 'security -i < "$1"', "x", join(d, "k")]);
    expect(r.exitCode).toBe(0);
    const back = Bun.spawnSync(["security", "find-generic-password", "-s", "fireflies.databases", "-a", "pg-1", "-w", kc]);
    expect(back.stdout.toString().trim()).toBe(secret);
    // saveSecret's own path: a line break is refused before anything is written.
    expect(await saveSecret(io, d, "pg-2", "x", "a\nb")).toContain("line break");
    for (const argv of seen) expect(argv.join(" ")).not.toContain("w0rd");
    await removeDir(io, d);
    Bun.spawnSync(["security", "delete-keychain", kc]);
    expect(typeof readSecret).toBe("function");
  });
});

describe("shared copies", () => {
  test("databases' table.ts is the preview's and its envrc.ts the editor's, byte for byte", () => {
    const mods = new URL("../defaults/mods/", import.meta.url).pathname;
    expect(readFileSync(`${mods}databases/table.ts`, "utf8")).toBe(readFileSync(`${mods}preview/table.ts`, "utf8"));
    expect(readFileSync(`${mods}databases/envrc.ts`, "utf8")).toBe(readFileSync(`${mods}editor/envrc.ts`, "utf8"));
  });
});
