// Editing cells in the Databases window (defaults/mods/databases): each
// engine's quoting (quotes, backslashes, line breaks, non-ASCII, a value that
// reads as SQL, MySQL's backslash escapes either way), the changes staged by
// row key (through pages, sorting and filtering), which grids and cells can be
// edited, the save's statements per engine (one UPDATE per row by its primary
// key, the old values in the WHERE, a guard after each, one transaction), and
// a real round trip against a throwaway SQLite file: saved, a row changed
// elsewhere refused with nothing written, a failing statement rolled back.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bound, literal, refusal, stillHolds, textLiteral, typeOf, utf8Hex } from "../defaults/mods/databases/quote.ts";
import { changeAt, counted, editability, noEdits, readsRowid, rowChanged, shownCell, stage, unstage, cellRefusal } from "../defaults/mods/databases/edits.ts";
import { guardSql, saveError, saveStatements } from "../defaults/mods/databases/save-sql.ts";
import { pipelineBody } from "../defaults/mods/databases/hrana.ts";
import { scriptOf } from "../defaults/mods/databases/script.ts";
import { run } from "../defaults/mods/databases/runner.ts";
import { sqliteArgs } from "../defaults/mods/databases/clients.ts";
import { parseSqlite, csvSet } from "../defaults/mods/databases/parse-out.ts";
import { browseSql } from "../defaults/mods/databases/catalog.ts";

const SQLITE = Bun.which("sqlite3") !== null;

/** The awkward values every engine's quoting is tried with. */
const NASTY = ["it's", "a\\b", "line\nbreak", "Grüße · 灯 🏮", "'; DROP TABLE lanterns; --", "\\'", "''", "tab\there", "%_", "$$x$$", ":name", "\\\\n"];

describe("quoting per engine", () => {
  test("types read from declarations", () => {
    expect(["integer", "INT", "bigint", "int(11) unsigned", "smallint", "INTEGER", "serial", "int4"].map(typeOf)).toEqual(Array(8).fill("int"));
    expect(["interval", "point", "text", "varchar(40)", "character(3)", "uuid", "timestamp with time zone", ""].map(typeOf)).toEqual(Array(8).fill("text"));
    expect(["real", "double precision", "float", "float8", "DOUBLE"].map(typeOf)).toEqual(Array(5).fill("float"));
    expect(["numeric(10,2)", "decimal(5,1)"].map(typeOf)).toEqual(["decimal", "decimal"]);
    expect(["boolean", "bool", "tinyint(1)"].map(typeOf)).toEqual(["bool", "bool", "bool"]);
    expect(["bytea", "BLOB", "varbinary(16)", "binary(4)", "longblob"].map(typeOf)).toEqual(Array(5).fill("blob"));
    expect(["json", "jsonb"].map(typeOf)).toEqual(["json", "json"]);
  });

  test("SQLite and libSQL: quotes doubled, nothing else touched", () => {
    expect(textLiteral("sqlite", "it's")).toBe("'it''s'");
    expect(textLiteral("sqlite", "a\\b")).toBe("'a\\b'");
    expect(textLiteral("libsql", "'; DROP TABLE lanterns; --")).toBe("'''; DROP TABLE lanterns; --'");
    expect(textLiteral("sqlite", "line\nbreak")).toBe("'line\nbreak'");
  });

  test("Postgres: a backslash makes it an E'' string, the same under either standard_conforming_strings", () => {
    expect(textLiteral("postgres", "it's")).toBe("'it''s'");
    expect(textLiteral("postgres", "a\\b")).toBe("E'a\\\\b'");
    expect(textLiteral("postgres", "\\'")).toBe("E'\\\\'''");
    expect(textLiteral("postgres", "$$x$$")).toBe("'$$x$$'");
    expect(textLiteral("postgres", "Grüße · 灯 🏮")).toBe("'Grüße · 灯 🏮'");
  });

  test("MySQL: a backslash makes it hex bytes, read the same with or without NO_BACKSLASH_ESCAPES", () => {
    expect(textLiteral("mysql", "it's")).toBe("'it''s'");
    expect(textLiteral("mysql", "a\\b")).toBe("_utf8mb4 X'615C62'");
    expect(textLiteral("mysql", "\\'")).toBe("_utf8mb4 X'5C27'");
    expect(utf8Hex("é灯🏮")).toBe("C3A9E781AFF09F8FAE");
    // No backslash left anywhere a client or the server could read as an escape.
    for (const v of NASTY) expect(textLiteral("mysql", v).includes("\\")).toBe(false);
  });

  test("every engine's literal is one closed string: no quote left open, the SQL-looking value inside it", () => {
    for (const kind of ["sqlite", "postgres", "mysql"] as const) {
      for (const v of NASTY) {
        const l = textLiteral(kind, v);
        const body = l.replace(/^(E|_utf8mb4 X)?'/, "").replace(/'$/, "");
        // Inside, every quote is doubled: the literal can't end early.
        expect(body.replace(/''/g, "")).not.toContain("'");
      }
    }
  });

  test("values by their column's type: numbers as typed, yes / no per engine, NULL apart from 'NULL', blobs refused", () => {
    expect(literal("postgres", "42", "int")).toEqual({ sql: "42" });
    expect(literal("postgres", " +7 ", "int")).toEqual({ sql: "7" });
    expect(literal("postgres", "4.5", "int")).toEqual({ refused: "it takes a whole number" });
    expect(literal("mysql", "-1.5e3", "float")).toEqual({ sql: "-1.5e3" });
    expect(literal("postgres", "NaN", "float")).toEqual({ sql: "'NaN'" });
    expect(literal("postgres", "yes", "bool")).toEqual({ sql: "TRUE" });
    expect(literal("mysql", "false", "bool")).toEqual({ sql: "0" });
    expect(literal("sqlite", "t", "bool")).toEqual({ sql: "1" });
    expect(literal("sqlite", "maybe", "bool")).toEqual({ refused: "it takes true or false" });
    expect(literal("sqlite", null, "text")).toEqual({ sql: "NULL" });
    expect(literal("sqlite", "NULL", "text")).toEqual({ sql: "'NULL'" });
    expect(literal("sqlite", "", "text")).toEqual({ sql: "''" });
    expect(literal("postgres", "\\x00", "blob")).toEqual({ refused: "a blob can't be edited here" });
    expect(refusal("a\0b", "text")).toBe("a value can't hold a NUL character");
    expect(literal("postgres", '{"a": 1}', "json")).toEqual({ sql: "'{\"a\": 1}'" });
  });

  test("Hrana's bound values: typed, never pasted", () => {
    expect(bound("42", "int")).toEqual({ type: "integer", value: "42" });
    expect(bound("1.5", "float")).toEqual({ type: "float", value: 1.5 });
    expect(bound("true", "bool")).toEqual({ type: "integer", value: "1" });
    expect(bound("'; drop", "text")).toEqual({ type: "text", value: "'; drop" });
    expect(bound(null, "text")).toEqual({ type: "null" });
  });

  test("the old value's check: compared as the client printed it", () => {
    expect(stillHolds("postgres", "lit", "boolean", "t")).toBe("\"lit\" = 't'");
    expect(stillHolds("postgres", "meta", "json", "{\"a\": 1}")).toBe("\"meta\"::text = '{\"a\": 1}'");
    expect(stillHolds("postgres", "code", "character(3)", "ab ")).toBe("\"code\" = 'ab '");
    expect(stillHolds("postgres", "name", "character varying(40)", "x")).toBe("\"name\" = 'x'");
    expect(stillHolds("mysql", "name", "varchar(40)", "a\\b")).toBe("CAST(`name` AS CHAR) = _utf8mb4 X'615C62'");
    expect(stillHolds("sqlite", "v", "real", "0.3")).toBe("CAST(\"v\" AS TEXT) = '0.3'");
    expect(stillHolds("sqlite", "v", "real", null)).toBe("\"v\" IS NULL");
    expect(stillHolds("libsql", "v", "text", "x", true)).toBe("CAST(\"v\" AS TEXT) = ?");
  });
});

const SET = { columns: ["id", "name", "lumens"], rows: [["1", "Ember", "400"], ["2", "Wisp", null], ["3", "", "650"]] };
const TABLE = { schema: null, name: "lanterns" };

describe("the changes, staged by row", () => {
  test("a change stays with its row's key through another page, a sort or a filter", () => {
    let e = noEdits("sq-1", TABLE, ["id"]);
    e = stage(e, SET, 1, "name", "Will-o'-wisp");
    e = stage(e, SET, 1, "lumens", "120");
    e = stage(e, SET, 2, "name", null);
    expect(counted(e)).toEqual({ cells: 3, rows: 2 });
    // The same rows read again in another order (sorted by name desc).
    const sorted = { columns: ["id", "name", "lumens"], rows: [["2", "Wisp", null], ["1", "Ember", "400"], ["3", "", "650"]] };
    expect(changeAt(e, sorted, 0, "name")).toEqual({ was: "Wisp", now: "Will-o'-wisp" });
    expect(shownCell(e, sorted, 0, 2)).toBe("120");
    expect(shownCell(e, sorted, 1, 1)).toBe("Ember");
    expect(rowChanged(e, sorted, 1)).toBe(false);
    // A page without the row shows nothing of it; it's still staged.
    expect(rowChanged(e, { columns: SET.columns, rows: [["9", "x", "1"]] }, 0)).toBe(false);
    expect(counted(e).cells).toBe(3);
  });

  test("set back to what was read, the change goes; NULL and '' are apart; undo one cell", () => {
    let e = noEdits("sq-1", TABLE, ["id"]);
    e = stage(e, SET, 0, "name", "Cinder");
    e = stage(e, SET, 0, "name", "Ember");
    expect(counted(e)).toEqual({ cells: 0, rows: 0 });
    e = stage(e, SET, 2, "name", null);
    expect(changeAt(e, SET, 2, "name")).toEqual({ was: "", now: null });
    e = stage(e, SET, 1, "lumens", "");
    expect(changeAt(e, SET, 1, "lumens")).toEqual({ was: null, now: "" });
    e = unstage(e, SET, 2, "name");
    expect(counted(e)).toEqual({ cells: 1, rows: 1 });
  });

  test("which grids can be edited, and why not", () => {
    const columns = [{ name: "id", type: "integer", nullable: false, default: null, pk: true }, { name: "name", type: "text", nullable: true, default: null, pk: false }];
    const browse = { table: TABLE, sort: null, filter: "", offset: 0, limit: 200 };
    const facts = { kind: "sqlite", connName: "lantern.db", readonly: false, grid: "rows", browse, table: { type: "table" }, columns, set: SET } as const;
    expect(editability(facts)).toEqual({ keyCols: ["id"] });
    expect(editability({ ...facts, grid: "results" })).toEqual({ why: "a query's result isn't editable: open its table in [2] to edit its rows" });
    expect(editability({ ...facts, readonly: true })).toEqual({ why: "lantern.db is read only (e on the connection changes that)" });
    expect(editability({ ...facts, table: { type: "view" } })).toEqual({ why: "lanterns is a view: its rows aren't edited here" });
    expect(editability({ ...facts, columns: null })).toEqual({ why: "reading its structure… a moment" });
    const nokey = columns.map((c) => ({ ...c, pk: false }));
    expect(editability({ ...facts, kind: "postgres", columns: nokey })).toEqual({ why: "lanterns has no primary key: its rows can't be told apart for an UPDATE" });
    // SQLite without a primary key: read with its rowid, edited by it.
    expect(readsRowid("sqlite", nokey, "table")).toBe(true);
    expect(readsRowid("postgres", nokey, "table")).toBe(false);
    expect(readsRowid("sqlite", columns, "table")).toBe(false);
    const withRowid = { columns: ["rowid", "id", "name"], rows: [["7", "1", "a"]] };
    expect(editability({ ...facts, columns: nokey, browse: { ...browse, rowid: true }, set: withRowid })).toEqual({ keyCols: ["rowid"] });
    expect(browseSql("sqlite", { ...browse, rowid: true })).toEqual({ statements: [{ text: "select rowid, * from \"lanterns\" limit 200 offset 0", risk: "read" }] });
    // Cells: the rowid, a blob, a value over several lines.
    expect(cellRefusal({ keyCols: ["rowid"] }, nokey, "rowid", "7")).toContain("SQLite's own");
    expect(cellRefusal({ keyCols: ["id"] }, [...columns, { name: "pic", type: "blob", nullable: true, default: null, pk: false }], "pic", "x'00'")).toContain("blob");
    expect(cellRefusal({ keyCols: ["id"] }, columns, "name", "a\nb")).toContain("several lines");
    expect(cellRefusal({ keyCols: ["id"] }, columns, "name", "ok")).toBe(null);
  });
});

/** Staged changes on lanterns: a text with a quote, a NULL, a number. */
function staged() {
  let e = noEdits("x", TABLE, ["id"]);
  e = stage(e, SET, 0, "name", "it's lit");
  e = stage(e, SET, 1, "name", null);
  e = stage(e, SET, 1, "lumens", "120");
  return e;
}
const TYPES = new Map([["id", "integer"], ["name", "text"], ["lumens", "integer"]]);

describe("the save's statements", () => {
  test("SQLite: BEGIN, one UPDATE per row by its key with the old values, a guard after each, COMMIT", () => {
    const r = saveStatements({ kind: "sqlite", bind: false, types: TYPES }, staged());
    if (!("statements" in r)) throw new Error("refused");
    expect(r.statements.map((s) => [s.role, s.text, s.risk])).toEqual([
      ["begin", "BEGIN", "session"],
      ["update", "UPDATE \"lanterns\" SET \"name\" = 'it''s lit' WHERE \"id\" = 1 AND CAST(\"name\" AS TEXT) = 'Ember'", "write"],
      ["guard", guardSql("sqlite"), "read"],
      ["update", "UPDATE \"lanterns\" SET \"name\" = NULL, \"lumens\" = 120 WHERE \"id\" = 2 AND CAST(\"name\" AS TEXT) = 'Wisp' AND \"lumens\" IS NULL", "write"],
      ["guard", guardSql("sqlite"), "read"],
      ["commit", "COMMIT", "session"],
    ]);
    expect(r.statements[3]?.where).toBe("id = 2");
  });

  test("Postgres: schema-qualified, psql's :ROW_COUNT guard; MySQL: START TRANSACTION, backticks, the sql_mode guard right after each UPDATE", () => {
    const e = { ...staged(), table: { schema: "public", name: "lanterns" } };
    const pg = saveStatements({ kind: "postgres", bind: false, types: TYPES }, e);
    if (!("statements" in pg)) throw new Error("refused");
    expect(pg.statements[1]?.text).toBe("UPDATE \"public\".\"lanterns\" SET \"name\" = 'it''s lit' WHERE \"id\" = 1 AND \"name\" = 'Ember'");
    expect(pg.statements[2]?.text).toBe("SELECT 1 / :ROW_COUNT AS changed");
    const my = saveStatements({ kind: "mysql", bind: false, types: TYPES }, e);
    if (!("statements" in my)) throw new Error("refused");
    expect(my.statements[0]?.text).toBe("START TRANSACTION");
    expect(my.statements[1]?.text).toBe("UPDATE `public`.`lanterns` SET `name` = 'it''s lit' WHERE `id` = 1 AND CAST(`name` AS CHAR) = 'Ember'");
    // The script asks no ROW_COUNT() between an UPDATE and its guard.
    const script = scriptOf("mysql", my.statements).text;
    expect(script).not.toMatch(/UPDATE[^\n]*;\nSELECT ROW_COUNT/);
    expect(script).toContain("SET @@session.sql_mode = IF(ROW_COUNT() > 0, @@session.sql_mode, 'fireflies: 0 rows changed');");
  });

  test("Turso over Hrana: the same statements with every value bound to a ?", () => {
    const r = saveStatements({ kind: "libsql", bind: true, types: TYPES }, staged());
    if (!("statements" in r)) throw new Error("refused");
    const u = r.statements[3];
    expect(u?.text).toBe("UPDATE \"lanterns\" SET \"name\" = ?, \"lumens\" = ? WHERE \"id\" = ? AND CAST(\"name\" AS TEXT) = ? AND \"lumens\" IS NULL");
    expect(u?.args).toEqual([{ type: "null" }, { type: "integer", value: "120" }, { type: "integer", value: "2" }, { type: "text", value: "Wisp" }]);
    const body = JSON.parse(pipelineBody(r.statements.map((s) => (s.args ? { sql: s.text, args: s.args } : { sql: s.text }))));
    expect(body.requests[0].batch.steps[3]).toEqual({ stmt: { sql: u?.text, args: [{ type: "null" }, { type: "integer", value: "120" }, { type: "integer", value: "2" }, { type: "text", value: "Wisp" }] }, condition: { type: "ok", step: 2 } });
    // No value of the person's in any statement's text.
    expect(r.statements.some((s) => s.text.includes("it's lit") || s.text.includes("Wisp"))).toBe(false);
  });

  test("a change that can't be written is refused before anything runs", () => {
    const e = stage(noEdits("x", TABLE, ["id"]), SET, 0, "lumens", "bright");
    expect(saveStatements({ kind: "sqlite", bind: false, types: TYPES }, e)).toEqual({ refused: "lumens: it takes a whole number" });
  });

  test("a failed save in the row's words", () => {
    const r = saveStatements({ kind: "sqlite", bind: false, types: TYPES }, staged());
    if (!("statements" in r)) throw new Error("refused");
    const err = (index: number | null, message: string) => ({ results: [], error: { index, message, line: null, col: null, hint: null }, cut: false });
    expect(saveError(r.statements, err(4, "integer overflow"))).toBe("id = 2: 0 rows changed: the row was changed elsewhere (or is gone) · nothing was saved");
    expect(saveError(r.statements, err(3, "NOT NULL constraint failed: lanterns.name"))).toBe("id = 2: NOT NULL constraint failed: lanterns.name · nothing was saved");
    expect(saveError(r.statements, err(null, "unable to open database"))).toBe("unable to open database · nothing was saved");
    expect(saveError(r.statements, { results: [], error: null, cut: false })).toBe(null);
  });
});

/** herdr's exec and writeTextFile, for real. */
const io = {
  exec: async (cmd: string, args: string[] = []) => {
    const p = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, stdout, stderr };
  },
  writeTextFile: async (path: string, text: string, expected: string | null) => {
    if (expected === null && existsSync(path)) throw new Error("exists");
    writeFileSync(path, text);
    return null;
  },
};

describe("a real round trip on a throwaway SQLite file", () => {
  const dir = mkdtempSync(join(tmpdir(), "ff-dbedit-"));
  const db = join(dir, "lantern.db");
  const sql = (q: string) => Bun.spawnSync(["sqlite3", "-csv", "-header", "-nullvalue", "␀", db, q]).stdout.toString();
  const rows = () => csvSet(sql("select id, name, lumens, glow from lanterns order by id"))?.rows;
  const types = new Map([["id", "integer"], ["name", "text"], ["lumens", "integer"], ["glow", "real"]]);

  async function save(e: ReturnType<typeof noEdits>) {
    const r = saveStatements({ kind: "sqlite", bind: false, types }, e);
    if (!("statements" in r)) throw new Error(r.refused);
    const script = scriptOf("sqlite", r.statements).text;
    const out = await run(io, { kind: "sqlite", dir, program: "sqlite3", args: sqliteArgs(db, false), script });
    const o = parseSqlite(out.stdout, out.stderr, out.code, r.statements.map((s) => s.text), out.cut, r.statements.map((s) => s.risk !== "read"));
    return saveError(r.statements, o);
  }

  test.skipIf(!SQLITE)("edit → save → read again: quotes, a NULL, '' and a float that doesn't print short", async () => {
    Bun.spawnSync(["sqlite3", db, "create table lanterns(id integer primary key, name text not null default '', lumens integer, glow real); insert into lanterns values (1,'Ember',400,0.1+0.2),(2,'Wisp',null,1.5),(3,'Moth',650,null);"]);
    const read = csvSet(sql("select * from lanterns order by id"));
    if (!read) throw new Error("no rows");
    let e = noEdits("x", TABLE, ["id"]);
    for (const v of NASTY.slice(0, 5)) e = stage(e, read, 0, "name", v);
    e = stage(e, read, 0, "glow", "2.5");
    e = stage(e, read, 1, "lumens", null);
    e = stage(e, read, 2, "name", "");
    expect(await save(e)).toBe(null);
    expect(rows()).toEqual([["1", "'; DROP TABLE lanterns; --", "400", "2.5"], ["2", "Wisp", null, "1.5"], ["3", "", "650", null]]);
    // Each awkward value round-trips exactly.
    for (const v of NASTY) {
      const now = csvSet(sql("select * from lanterns order by id"));
      if (!now) throw new Error("no rows");
      expect(await save(stage(noEdits("x", TABLE, ["id"]), now, 1, "name", v))).toBe(null);
      expect(rows()?.[1]?.[1]).toBe(v);
    }
  });

  test.skipIf(!SQLITE)("a row changed elsewhere since it was read: refused at its guard, and the other rows' changes not written either", async () => {
    const read = csvSet(sql("select * from lanterns order by id"));
    if (!read) throw new Error("no rows");
    let e = noEdits("x", TABLE, ["id"]);
    e = stage(e, read, 0, "lumens", "1");
    e = stage(e, read, 2, "lumens", "3");
    // Someone else changes row 3 after it was read.
    Bun.spawnSync(["sqlite3", db, "update lanterns set lumens = 999 where id = 3"]);
    const before = rows();
    expect(await save(e)).toBe("id = 3: 0 rows changed: the row was changed elsewhere (or is gone) · nothing was saved");
    expect(rows()).toEqual(before);
  });

  test.skipIf(!SQLITE)("a statement the database refuses: the run stops, nothing written, the error names the row", async () => {
    const read = csvSet(sql("select * from lanterns order by id"));
    if (!read) throw new Error("no rows");
    let e = noEdits("x", TABLE, ["id"]);
    e = stage(e, read, 0, "lumens", "7");
    e = stage(e, read, 1, "name", null);
    const before = rows();
    expect(await save(e)).toBe("id = 2: NOT NULL constraint failed: lanterns.name · nothing was saved");
    expect(rows()).toEqual(before);
  });

  test.skipIf(!SQLITE)("a float read back as sqlite3 printed it still matches its old-value check", async () => {
    Bun.spawnSync(["sqlite3", db, "update lanterns set glow = 0.1 + 0.2 where id = 2"]);
    const read = csvSet(sql("select * from lanterns order by id"));
    if (!read) throw new Error("no rows");
    expect(await save(stage(noEdits("x", TABLE, ["id"]), read, 1, "glow", "0.75"))).toBe(null);
    expect(rows()?.[1]?.[3]).toBe("0.75");
  });

  test.skipIf(!SQLITE)("a table without a primary key, edited by its rowid", async () => {
    Bun.spawnSync(["sqlite3", db, "create table notes(body text); insert into notes values ('a'),('b');"]);
    const read = csvSet(sql("select rowid, * from notes"));
    if (!read) throw new Error("no rows");
    const r = saveStatements({ kind: "sqlite", bind: false, types: new Map([["body", "text"]]) }, stage(noEdits("x", { schema: null, name: "notes" }, ["rowid"]), read, 1, "body", "b!"));
    if (!("statements" in r)) throw new Error("refused");
    expect(r.statements[1]?.text).toBe("UPDATE \"notes\" SET \"body\" = 'b!' WHERE \"rowid\" = 2 AND CAST(\"body\" AS TEXT) = 'b'");
    const out = await run(io, { kind: "sqlite", dir, program: "sqlite3", args: sqliteArgs(db, false), script: scriptOf("sqlite", r.statements).text });
    expect(out.code).toBe(0);
    expect(csvSet(sql("select body from notes order by rowid"))?.rows).toEqual([["a"], ["b!"]]);
  });
});

/** A throwaway PostgreSQL's bin folder (FF_TEST_PG_BIN; skipped without one): initdb in a temp
 *  folder, a Unix socket only, stopped and removed after. */
const PG_BIN = process.env.FF_TEST_PG_BIN ?? "";

describe.skipIf(!PG_BIN)("a real round trip on a throwaway PostgreSQL", () => {
  const base = mkdtempSync(join(tmpdir(), "ff-pg-"));
  const data = join(base, "data");
  const psqlArgs = ["-X", "-A", "--csv", "-w", "-v", "ON_ERROR_STOP=1", "-P", "null=␀", "-h", base, "-d", "postgres"];
  const sh = (cmd: string, args: string[]) => Bun.spawnSync([join(PG_BIN, cmd), ...args], { stdout: "pipe", stderr: "pipe" });
  const sql = (q: string) => csvSet(sh("psql", [...psqlArgs, "-c", q]).stdout.toString())?.rows;
  const types = new Map([["id", "integer"], ["name", "text"], ["lit", "boolean"], ["code", "character(3)"], ["glow", "real"]]);

  async function save(e: ReturnType<typeof noEdits>) {
    const r = saveStatements({ kind: "postgres", bind: false, types }, e);
    if (!("statements" in r)) throw new Error(r.refused);
    const { parsePsql } = await import("../defaults/mods/databases/parse-out.ts");
    const out = await run(io, { kind: "postgres", dir: base, program: join(PG_BIN, "psql"), args: psqlArgs, script: scriptOf("postgres", r.statements).text });
    return saveError(r.statements, parsePsql(out.stdout, out.stderr, out.code, r.statements.map((s) => s.risk !== "read"), out.cut));
  }

  test("saved, a row changed elsewhere refused at its guard, a refused value rolled back", async () => {
    expect(sh("initdb", ["-D", data, "-A", "trust", "-U", process.env.USER ?? "postgres"]).exitCode).toBe(0);
    // The server keeps no pipe of ours open (its output goes to a log), so the start returns.
    const started = Bun.spawnSync([join(PG_BIN, "pg_ctl"), "-D", data, "-l", join(base, "log"), "-o", `-k ${base} -c listen_addresses=''`, "-w", "start"], { stdout: "ignore", stderr: "ignore" });
    expect(started.exitCode).toBe(0);
    try {
      sh("psql", [...psqlArgs, "-c", "create table lanterns(id integer primary key, name text not null, lit boolean, code character(3), glow real); insert into lanterns values (1,'Ember',true,'ab',0.1),(2,'Wisp',null,'x',1.5);"]);
      const read = csvSet(sh("psql", [...psqlArgs, "-c", "select * from lanterns order by id"]).stdout.toString());
      if (!read) throw new Error("no rows");
      let e = noEdits("x", TABLE, ["id"]);
      e = stage(e, read, 0, "name", "it's a\\b 灯");
      e = stage(e, read, 0, "lit", "no");
      e = stage(e, read, 1, "code", "yz");
      e = stage(e, read, 1, "glow", "2.25");
      expect(await save(e)).toBe(null);
      expect(sql("select id, name, lit, code, glow from lanterns order by id")).toEqual([["1", "it's a\\b 灯", "f", "ab ", "0.1"], ["2", "Wisp", null, "yz ", "2.25"]]);
      // Changed elsewhere after it was read: the guard stops it, nothing written.
      const again = csvSet(sh("psql", [...psqlArgs, "-c", "select * from lanterns order by id"]).stdout.toString());
      if (!again) throw new Error("no rows");
      let f = noEdits("x", TABLE, ["id"]);
      f = stage(f, again, 0, "name", "mine");
      f = stage(f, again, 1, "name", "mine too");
      sh("psql", [...psqlArgs, "-c", "update lanterns set name = 'theirs' where id = 2"]);
      expect(await save(f)).toBe("id = 2: 0 rows changed: the row was changed elsewhere (or is gone) · nothing was saved");
      expect(sql("select name from lanterns order by id")).toEqual([["it's a\\b 灯"], ["theirs"]]);
      // NOT NULL refused by the server: rolled back, the row named.
      const third = csvSet(sh("psql", [...psqlArgs, "-c", "select * from lanterns order by id"]).stdout.toString());
      if (!third) throw new Error("no rows");
      const g = stage(stage(noEdits("x", TABLE, ["id"]), third, 0, "lit", "yes"), third, 1, "name", null);
      expect(await save(g)).toContain("id = 2: null value in column \"name\"");
      expect(sql("select lit from lanterns where id = 1")).toEqual([["f"]]);
    } finally {
      Bun.spawnSync([join(PG_BIN, "pg_ctl"), "-D", data, "-m", "immediate", "stop"], { stdout: "ignore", stderr: "ignore" });
      Bun.spawnSync(["rm", "-rf", base]);
    }
  }, 60000);
});
