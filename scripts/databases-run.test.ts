// The Databases window's statements and runs (defaults/mods/databases):
// splitting a query into statements, what each one may change (the asks
// before it runs), the script a client reads, and the runner, for real
// against sqlite3 and recorded psql output. No secret on any argv.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitStatements, statementAt, blankLiterals, lineCol } from "../defaults/mods/databases/split.ts";
import { classify, worst, allowedReadOnly } from "../defaults/mods/databases/safety.ts";
import { scriptOf, MARK } from "../defaults/mods/databases/script.ts";
import { run, runnerArgs, privateDir, removeDir, cancel, RUNNER } from "../defaults/mods/databases/runner.ts";
import { parsePsql, parseSqlite, psqlError } from "../defaults/mods/databases/parse-out.ts";

const FIX = new URL("./fixtures/databases/", import.meta.url).pathname;

/** herdr's exec and writeTextFile, for real, recording every argv. */
function realIo(seen: string[][] = []) {
  return {
    seen,
    exec: async (cmd: string, args: string[] = [], options: { timeout?: number } = {}) => {
      seen.push([cmd, ...args]);
      const p = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
      const timer = setTimeout(() => p.kill(), options.timeout ?? 30000);
      const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      const code = await p.exited;
      clearTimeout(timer);
      return { code, stdout, stderr };
    },
    writeTextFile: async (path: string, text: string, expected: string | null) => {
      if (expected === null && existsSync(path)) throw new Error("exists");
      writeFileSync(path, text);
      return null;
    },
  };
}

describe("splitting statements", () => {
  test("semicolons inside strings, names, comments and $$ bodies don't split", () => {
    const text = "select 'a;b', \"c;d\" -- e;f\nfrom t; /* g;h */ insert into u values ($$x;y$$);\n  select 3";
    const list = splitStatements(text, "postgres");
    expect(list.map((s) => s.text)).toEqual(["select 'a;b', \"c;d\" -- e;f\nfrom t", "/* g;h */ insert into u values ($$x;y$$)", "select 3"]);
    expect(list[2]!.line).toBe(3);
    expect(text.slice(list[1]!.start, list[1]!.end)).toBe(list[1]!.text);
  });

  test("mysql: backticks, # comments and backslash escapes", () => {
    const list = splitStatements("select `a;b`, 'it\\'s;' # c;\n; select 2;", "mysql");
    expect(list.map((s) => s.text)).toEqual(["select `a;b`, 'it\\'s;' # c;", "select 2"]);
  });

  test("a sqlite trigger's body keeps its semicolons", () => {
    const text = "create trigger t after insert on a begin update b set n = n + 1; delete from c; end; select 1;";
    expect(splitStatements(text, "sqlite").map((s) => s.text)).toEqual(["create trigger t after insert on a begin update b set n = n + 1; delete from c; end", "select 1"]);
  });

  test("only comments is no statement", () => {
    expect(splitStatements("-- nothing\n/* here */\n", "sqlite")).toEqual([]);
  });

  test("the statement under the caret", () => {
    const text = "select 1;\nselect 2; \n\nselect 3;";
    const list = splitStatements(text, "sqlite");
    expect(statementAt(list, text, 3)!.text).toBe("select 1");
    expect(statementAt(list, text, text.indexOf("select 2") + 9)!.text).toBe("select 2"); // just after its ;
    expect(statementAt(list, text, text.indexOf("select 2") + 10)!.text).toBe("select 2"); // the space after it on its line
    expect(statementAt(list, text, text.indexOf("\n\n") + 1)!.text).toBe("select 3"); // an empty line: the next
    expect(statementAt(list, text, text.length)!.text).toBe("select 3");
    expect(lineCol("ab\ncd", 4)).toEqual({ line: 2, col: 2 });
  });

  test("blanking keeps lengths and hides literals", () => {
    const sql = "select 'drop' from \"x\" -- delete";
    const b = blankLiterals(sql, "postgres");
    expect(b.length).toBe(sql.length);
    expect(b).not.toContain("drop");
    expect(b).not.toContain("delete");
    expect(b).toContain("xxx");
  });
});

describe("what a statement may change", () => {
  const risk = (sql: string, kind: "postgres" | "mysql" | "sqlite" = "postgres") => classify(sql, kind).risk;

  test("reads", () => {
    for (const s of ["select * from t", "SHOW tables", "explain select 1", "with a as (select 1) select * from a", "pragma table_info(t)", "pragma user_version", "values (1)", "describe t"]) {
      expect(risk(s, "sqlite")).toBe("read");
    }
    expect(risk("select 'drop table x'")).toBe("read");
  });

  test("session steps don't ask, but SET GLOBAL does", () => {
    expect(risk("begin")).toBe("session");
    expect(risk("set search_path = x")).toBe("session");
    expect(risk("SET GLOBAL max_connections = 5", "mysql")).toBe("write");
  });

  test("writes ask once", () => {
    for (const s of ["insert into t values (1)", "update t set a = 1 where id = 2", "delete from t where id = 1", "create table x (a int)", "pragma journal_mode = wal", "with d as (delete from t where a returning *) select * from d", "explain analyze update t set a = 1 where b"]) {
      expect(risk(s, "sqlite")).toBe("write");
    }
  });

  test("destructive ones ask twice and name what to type", () => {
    expect(classify("drop table if exists \"Old Orders\"", "postgres")).toEqual({ risk: "destructive", verb: "drop table", target: "Old Orders" });
    expect(classify("DROP TABLE public.orders_2019;", "postgres").target).toBe("orders_2019");
    expect(classify("truncate table `logs`", "mysql")).toMatchObject({ risk: "destructive", target: "logs" });
    expect(classify("delete from sessions", "sqlite")).toMatchObject({ risk: "destructive", verb: "delete every row", target: "sessions" });
    expect(classify("update users set admin = 1", "sqlite")).toMatchObject({ risk: "destructive", target: "users" });
    expect(classify("alter table users drop column email", "postgres")).toMatchObject({ risk: "destructive", target: "users" });
    expect(classify("drop materialized view if exists mv", "postgres")).toMatchObject({ verb: "drop materialized view", target: "mv" });
    expect(classify("explain analyze delete from t", "postgres").risk).toBe("destructive");
  });

  test("a batch is as risky as its worst, and read only allows reads and session steps", () => {
    const v = worst(["select 1", "delete from t", "insert into t values (1)"].map((s) => classify(s, "sqlite")));
    expect(v.risk).toBe("destructive");
    expect(allowedReadOnly(classify("select 1", "sqlite"))).toBe(true);
    expect(allowedReadOnly(classify("begin", "sqlite"))).toBe(true);
    expect(allowedReadOnly(classify("insert into t values (1)", "sqlite"))).toBe(false);
  });
});

describe("scripts", () => {
  test("markers between statements, and where each starts", () => {
    const s = scriptOf("postgres", [{ text: "select 1", risk: "read" }, { text: "select\n2", risk: "read" }]);
    expect(s.text).toBe(`\\echo ${MARK} 0\nselect 1;\n\\echo ${MARK} 1\nselect\n2;\n`);
    expect(s.lines).toEqual([2, 4]);
  });

  test("mysql: read only first, row counts after writes", () => {
    const s = scriptOf("mysql", [{ text: "update t set a = 1 where b", risk: "write" }], true);
    expect(s.text).toBe(`SET SESSION TRANSACTION READ ONLY;\nSELECT '${MARK} 0' AS __ff;\nupdate t set a = 1 where b;\nSELECT ROW_COUNT() AS __ff_affected;\n`);
    expect(s.lines).toEqual([3]);
  });
});

describe("psql's output (recorded from postgres 17)", () => {
  const out = readFileSync(FIX + "psql-run.out", "utf8");
  const err = readFileSync(FIX + "psql-run.err", "utf8");

  test("rows, NULL apart from empty text, tags, and the error in its statement", () => {
    const o = parsePsql(out.replaceAll("__FF__", MARK), err, 3, [false, false, true, false, false, false]);
    // the fixture's markers count from 1
    const byIndex = new Map(o.results.map((r) => [r.index, r]));
    const rows = byIndex.get(1)!.set!;
    expect(rows.columns).toEqual(["id", "name", "lumens", "lit", "meta"]);
    expect(rows.rows[1]).toEqual(["2", 'Moth "Lure", No. 4', "1420", null, null]);
    expect(rows.rows[2]![1]).toBe("");
    expect(rows.rows[3]![1]).toBe("two\nlines");
    expect(byIndex.get(2)).toMatchObject({ affected: 1, tag: "UPDATE 1", set: null });
    expect(byIndex.get(3)!.set).toEqual({ columns: ["n"], rows: [["0"]] });
    expect(o.error).toEqual({ index: 4, message: 'relation "lantern" does not exist', line: 1, col: 15, hint: null });
  });

  test("an error's line, column and hint inside a statement", () => {
    const e = psqlError('psql:/tmp/q.sql:3: ERROR:  function nope_fn(integer) does not exist\nLINE 3:   nope_fn(2);\n          ^\nHINT:  No function matches.\n', 0);
    expect(e).toEqual({ index: 0, message: "function nope_fn(integer) does not exist", line: 3, col: 3, hint: "No function matches." });
  });

  test("connecting fails before any statement", () => {
    const e = psqlError(readFileSync(FIX + "psql-nodb.err", "utf8"), null);
    expect(e).toMatchObject({ index: null, message: 'database "nosuch" does not exist' });
  });
});

describe("the runner, for real with sqlite3", () => {
  const dbDir = mkdtempSync(join(tmpdir(), "ffdb-"));
  const db = join(dbDir, "t.db");
  Bun.spawnSync(["sqlite3", db, "create table t(id integer primary key, name text, v real); insert into t values (1,'a,b',1.5),(2,null,null),(3,'',2);"]);
  const args = (ro = false) => ["-batch", "-bail", "-csv", "-header", "-nullvalue", "␀", "-cmd", ".changes on", ...(ro ? ["-readonly"] : []), db];

  test("the private folder is 0700 and goes away", async () => {
    const io = realIo();
    const dir = (await privateDir(io))!;
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    await removeDir(io, dir);
    expect(existsSync(dir)).toBe(false);
  });

  test("rows, changes, an error placed in its statement, and nothing left behind", async () => {
    const io = realIo();
    const dir = (await privateDir(io))!;
    const statements = ["select * from t order by id", "update t set v = 3 where id = 2", "select x from\n  t"];
    const script = scriptOf("sqlite", statements.map((text) => ({ text, risk: classify(text, "sqlite").risk })));
    const r = await run(io, { kind: "sqlite", dir, program: "sqlite3", args: args(), script: script.text });
    const o = parseSqlite(r.stdout, r.stderr, r.code, statements);
    expect(o.results[0]!.set!.rows).toEqual([["1", "a,b", "1.5"], ["2", null, null], ["3", "", "2.0"]]);
    expect(o.results[1]!.affected).toBe(1);
    expect(o.error).toEqual({ index: 2, message: "no such column: x", line: 1, col: 8, hint: null });
    expect(readdirSync(dir)).toEqual([]);
    await removeDir(io, dir);
  });

  test("read only refuses a write in sqlite3 itself", async () => {
    const io = realIo();
    const dir = (await privateDir(io))!;
    const r = await run(io, { kind: "sqlite", dir, program: "sqlite3", args: args(true), script: scriptOf("sqlite", [{ text: "delete from t", risk: "destructive" }]).text, readonly: true });
    expect(parseSqlite(r.stdout, r.stderr, r.code, ["delete from t"]).error!.message).toContain("readonly");
    await removeDir(io, dir);
  });

  test("output past the limit is cut", async () => {
    const io = realIo();
    const dir = (await privateDir(io))!;
    const r = await run(io, { kind: "sqlite", dir, program: "sqlite3", args: args(), script: scriptOf("sqlite", [{ text: "with recursive n(i) as (select 1 union all select i + 1 from n limit 100000) select i, 'xxxxxxxxxx' from n", risk: "read" }]).text, limit: 4096 });
    expect(r.cut).toBe(true);
    expect(r.code).toBe(0);
    expect(r.stdout.length).toBeLessThanOrEqual(4096);
    await removeDir(io, dir);
  });

  test("a missing client says so", async () => {
    const io = realIo();
    const dir = (await privateDir(io))!;
    const r = await run(io, { kind: "postgres", dir, program: "psql-not-here", args: [], script: "select 1;\n" });
    expect(r.code).toBe(127);
    expect(r.stderr).toContain("psql-not-here isn't installed");
    await removeDir(io, dir);
  });

  test("a one-shot secret reaches the client's environment, never an argument, and is deleted", async () => {
    const io = realIo();
    const dir = (await privateDir(io))!;
    // A stand-in client that prints the environment's password and its own arguments.
    const fake = join(dbDir, "fake-psql");
    writeFileSync(fake, '#!/bin/sh\nprintf "pw=%s ro=%s args=%s\\n" "$PGPASSWORD" "$PGOPTIONS" "$*"\n', { mode: 0o755 });
    const secret = "s3cr3t 'quoted' \"pw\" $HOME";
    const r = await run(io, { kind: "postgres", dir, program: fake, args: ["-X"], script: "select 1;\n", secret, readonly: true });
    expect(r.stdout).toContain(`pw=${secret} ro=-c default_transaction_read_only=on args=-X -f ${dir}/q-`);
    for (const argv of io.seen) expect(argv.join(" ")).not.toContain("s3cr3t");
    expect(readdirSync(dir)).toEqual([]);
    await removeDir(io, dir);
  });

  test("mysql gets its password in a 0600 option file that's gone afterwards", async () => {
    const io = realIo();
    const dir = (await privateDir(io))!;
    const fake = join(dbDir, "fake-mysql");
    writeFileSync(fake, '#!/bin/sh\nf=${1#--defaults-extra-file=}; stat -f "%Lp" "$f"; cat "$f"\n', { mode: 0o755 });
    const r = await run(io, { kind: "mysql", dir, program: fake, args: ["--xml"], script: "select 1;\n", secret: 'p"a\\ss' });
    expect(r.stdout).toBe('600\n[client]\npassword="p\\"a\\\\ss"\n');
    expect(readdirSync(dir)).toEqual([]);
    await removeDir(io, dir);
  });

  test("cancel interrupts a running client", async () => {
    const io = realIo();
    const dir = (await privateDir(io))!;
    const fake = join(dbDir, "fake-slow");
    writeFileSync(fake, "#!/bin/sh\nexec sleep 20\n", { mode: 0o755 });
    let n = "";
    const at = Date.now();
    const going = run(io, { kind: "sqlite", dir, program: fake, args: [], script: "select 1;\n" }, (x) => { n = x; });
    for (let i = 0; i < 50 && !existsSync(`${dir}/pid-${n}`); i++) await Bun.sleep(50);
    await cancel(io, dir, n);
    const r = await going;
    expect(Date.now() - at).toBeLessThan(8000);
    expect(r.code).not.toBe(0);
    await removeDir(io, dir);
  }, 15000);

  test("the argv carries no secret by construction", () => {
    const argv = runnerArgs({ kind: "postgres", dir: "/tmp/fireflies-db.x", program: "psql", args: ["-h", "db", "-U", "ada"], script: "", account: "pg-abc", secret: "hunter2" }, "n1");
    expect(argv.join(" ")).not.toContain("hunter2");
    expect(argv[1]).toBe(RUNNER);
  });
});
