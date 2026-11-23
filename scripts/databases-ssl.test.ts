// A connection's sslmode (defaults/mods/databases/kinds.ts SSL_MODES): kept in
// connections.json and through a picked database and a pin, handed to psql in -d's conninfo and
// to mysql as its own flag (MySQL's --ssl-mode, MariaDB's --skip-ssl / --ssl-verify-server-cert),
// the form's ssl toggle by key (an edit that leaves it keeps a pasted require), read from a pasted
// URL and a found DATABASE_URL or PGSSLMODE, and carried or refused by databases.connect.
// Clients and files are stand-ins. Its own process: it stands in for "herdr".
import { test, expect, mock, describe } from "bun:test";
import { found, standIn } from "./databases-host.ts";

const { h, theme, el, cx, until, flush, advance, services } = standIn();
const { files, commands, opened, closed, execs, written, stores } = h;

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
const fresh = () => { files.clear(); h.shared = {}; commands.length = 0; opened.length = 0; closed.length = 0; h.panes = []; h.focused = null; stores.clear(); execs.length = 0; written.length = 0; h.reply = found; };

const { connOf, connJson, isConnJson, sslProblem } = await import("../defaults/mods/databases/kinds.ts");
const { clientFor, flavorOf, mysqlSslArgs } = await import("../defaults/mods/databases/clients.ts");
const { readConnections, changeConnections } = await import("../defaults/mods/databases/store.ts");
const { Effect } = await import("effect");
const { filesTest } = await import("@fireflies/kit/testing");
const { parseDbUrl, foundInVars, parseEnvFile } = await import("../defaults/mods/databases/discover.ts");
const { withDatabase } = await import("../defaults/mods/databases/dbs.ts");
const { saveFound } = await import("../defaults/mods/databases/conns.ts");
const { sslWords } = await import("../defaults/mods/databases/conn-form.ts");
const { connectArgsOf } = await import("../defaults/mods/nocturne/databases.ts");

const PG = { id: "pg-1", name: "lantern", kind: "postgres", host: "db.local", port: 6543, user: "ada", database: "lantern", readonly: false, secret: "none", origin: "saved" } as const;
const MY = { id: "my-1", name: "shop", kind: "mysql", host: "127.0.0.1", port: 3307, user: "root", database: "shop", readonly: false, secret: "none", origin: "saved" } as const;
/** The -d of psql's arguments. */
const dOf = (args: readonly string[]) => args[args.indexOf("-d") + 1];
/** The client's own arguments of the window's runs (runner.ts runnerArgs: they start at the 12th). */
const runArgs = () => execs.filter((a) => a[0] === "sh" && a[3] === "ff-db").map((a) => a.slice(12));

describe("the field", () => {
  test("saved and read back; an unknown value isn't a connection; absent stays absent", () => {
    const files = new Map<string, string>();
    return Effect.runPromise(Effect.provide(Effect.gen(function* () {
    yield* changeConnections("/h", () => [{ ...PG, sslmode: "require" }, { ...MY, sslmode: "disable" }, { ...PG, id: "pg-2" }] as any);
    const doc = JSON.parse([...files.values()][0]!);
    expect(doc.connections.map((c: any) => c.sslmode)).toEqual(["require", "disable", undefined]);
    const back = yield* readConnections("/h");
    expect(back.map((c) => c.sslmode)).toEqual(["require", "disable", undefined]);
    expect("sslmode" in back[2]!).toBe(false);
    expect(isConnJson({ ...connJson(PG as any), sslmode: "false" })).toBe(false);
    expect(isConnJson({ ...connJson(PG as any), sslmode: "verify-full" })).toBe(true);
    expect(connOf({ ...connJson(PG as any), sslmode: "verify-ca" }).sslmode).toBe("verify-ca");
    }), filesTest(files).layer));
  });

  test("a picked database keeps it", () => {
    expect(withDatabase({ ...PG, sslmode: "disable" } as any, "other")).toMatchObject({ database: "other", sslmode: "disable" });
    expect(withDatabase({ ...PG, sslmode: "disable" } as any, null).sslmode).toBe("disable");
  });

  test("the check's words", () => {
    expect(sslProblem("require")).toBeNull();
    expect(sslProblem("false")).toBe('sslmode "false" isn\'t one of disable, allow, prefer, require, verify-ca, verify-full');
  });
});

describe("the clients", () => {
  test("psql: the sslmode in -d's conninfo; none: -d as before", () => {
    expect(dOf(clientFor(PG as any)!.args)).toBe("lantern");
    expect(dOf(clientFor({ ...PG, sslmode: "disable" } as any)!.args)).toBe("dbname='lantern' sslmode=disable");
    expect(dOf(clientFor({ ...PG, sslmode: "require" } as any)!.args)).toBe("dbname='lantern' sslmode=require");
    // No database named: the server's default, quoted the same way; a quote or backslash escaped.
    const { database: _d, ...none } = PG;
    expect(dOf(clientFor({ ...none, sslmode: "disable" } as any)!.args)).toBe("dbname='postgres' sslmode=disable");
    expect(dOf(clientFor({ ...PG, database: "it's a\\b", sslmode: "verify-full" } as any)!.args)).toBe("dbname='it\\'s a\\\\b' sslmode=verify-full");
    // Nothing else moves.
    const plain = clientFor(PG as any)!.args;
    const off = clientFor({ ...PG, sslmode: "disable" } as any)!.args;
    expect(off.filter((a) => a !== dOf(off))).toEqual(plain.filter((a) => a !== dOf(plain)));
  });

  test("mysql: MySQL's --ssl-mode, MariaDB's own flags, none without an sslmode", () => {
    const ssl = (c: any, f?: any) => clientFor(c, f)!.args.filter((a) => a.startsWith("--ssl") || a.startsWith("--skip-ssl"));
    expect(ssl(MY)).toEqual([]);
    expect(ssl(MY, "mariadb")).toEqual([]);
    expect(ssl({ ...MY, sslmode: "disable" })).toEqual(["--ssl-mode=DISABLED"]);
    expect(ssl({ ...MY, sslmode: "require" })).toEqual(["--ssl-mode=REQUIRED"]);
    expect(ssl({ ...MY, sslmode: "disable" }, "mariadb")).toEqual(["--skip-ssl"]);
    expect(ssl({ ...MY, sslmode: "require" }, "mariadb")).toEqual(["--ssl", "--ssl-verify-server-cert"]);
    expect(mysqlSslArgs("prefer", "mysql")).toEqual(["--ssl-mode=PREFERRED"]);
    expect(mysqlSslArgs("allow", "mysql")).toEqual(["--ssl-mode=PREFERRED"]);
    expect(mysqlSslArgs("verify-ca", "mysql")).toEqual(["--ssl-mode=VERIFY_CA"]);
    expect(mysqlSslArgs("verify-full", "mysql")).toEqual(["--ssl-mode=VERIFY_IDENTITY"]);
    expect(mysqlSslArgs("prefer", "mariadb")).toEqual([]);
    // The flags come before the database (the last argument).
    expect(clientFor({ ...MY, sslmode: "disable" } as any)!.args.at(-1)).toBe("shop");
    // A file has none.
    expect(clientFor({ id: "s", name: "s", kind: "sqlite", path: "/a.db", readonly: false, secret: "none", origin: "saved", sslmode: "disable" } as any)!.args.join(" ")).not.toContain("ssl");
  });

  test("which mysql: its --version (MariaDB's mysql says so), else its name", () => {
    expect(flavorOf("/nix/store/x-mariadb-client-11.4.13/bin/mysql from 11.4.13-MariaDB, client 15.2 for osx14.0 (arm64) using  EditLine wrapper\n", "/usr/bin/mysql")).toBe("mariadb");
    expect(flavorOf("mysql  Ver 15.1 Distrib 10.6.12-MariaDB, for Linux (x86_64)", "/usr/bin/mysql")).toBe("mariadb");
    expect(flavorOf("/nix/store/x-mysql-8.4.11/bin/mysql  Ver 8.4.11 for macos26.6 on arm64 (Source distribution)\n", "/usr/bin/mysql")).toBe("mysql");
    expect(flavorOf("", "/opt/bin/mariadb")).toBe("mariadb");
    expect(flavorOf("", "/opt/bin/mysql")).toBe("mysql");
  });
});

describe("URLs", () => {
  test("a URL's sslmode: postgres' sslmode, mysql's ssl-mode and sslMode; an unknown one: none", () => {
    expect(parseDbUrl("postgres://ada@db/lantern?sslmode=require")).toEqual({ kind: "postgres", password: null, user: "ada", host: "db", database: "lantern", sslmode: "require" });
    expect(parseDbUrl("postgresql://ada@db/lantern?application_name=x&sslmode=disable")?.sslmode).toBe("disable");
    expect(parseDbUrl("postgres://ada@db/lantern?sslmode=nope")).toEqual({ kind: "postgres", password: null, user: "ada", host: "db", database: "lantern" });
    expect(parseDbUrl("postgres://ada@db/lantern")?.sslmode).toBeUndefined();
    expect(parseDbUrl("mysql://root@127.0.0.1:3307/shop?ssl-mode=DISABLED")?.sslmode).toBe("disable");
    expect(parseDbUrl("mysql://root@127.0.0.1:3307/shop?sslMode=VERIFY_IDENTITY")?.sslmode).toBe("verify-full");
    expect(parseDbUrl("mysql://root@127.0.0.1:3307/shop?sslmode=require")?.sslmode).toBe("require");
    // Postgres has no ssl-mode.
    expect(parseDbUrl("postgres://db/x?ssl-mode=DISABLED")?.sslmode).toBeUndefined();
  });

  test("a DATABASE_URL found in a folder's .env, and direnv's PGSSLMODE", () => {
    const vars = parseEnvFile('DATABASE_URL="postgres://ada:p%40ss@db.local:6543/lantern?sslmode=require"\nSHOP_URL=mysql://root@127.0.0.1/shop?ssl-mode=DISABLED\n');
    const found = foundInVars(vars, ".env", "/w/app");
    expect(found.map((f) => [f.conn.name, f.conn.sslmode])).toEqual([["DATABASE_URL", "require"], ["SHOP_URL", "disable"]]);
    const pg = foundInVars(new Map([["PGHOST", "127.0.0.1"], ["PGDATABASE", "lantern"], ["PGSSLMODE", "disable"]]), "direnv", "/w");
    expect(pg[0]?.conn).toMatchObject({ host: "127.0.0.1", database: "lantern", sslmode: "disable" });
    expect(foundInVars(new Map([["PGHOST", "h"], ["PGSSLMODE", "weird"]]), "direnv", "/w")[0]?.conn.sslmode).toBeUndefined();
  });
});

/** The form's stops' ids. */
const ids = (v: any): string[] => v.form.stops().map((s: any) => s.id);
/** Tab until the form is at `id`. */
function tabTo(v: any, id: string) {
  for (let i = 0; i < 20 && ids(v)[v.form.at] !== id; i++) v.key(key("tab"), cx);
  expect(ids(v)[v.form.at]).toBe(id);
}

describe("the form's ssl toggle, by key", () => {
  test("postgres and mysql have it, a file doesn't; on by default (no sslmode), space turns it off (disable) and on again", async () => {
    fresh();
    const v = open({ folder: "/w", overlay: "f1" });
    await flush();
    v.key(key("n"), cx);
    expect(v.form).toBeTruthy();
    expect(ids(v)).toEqual(["kind", "name", "host", "port", "user", "database", "password", "ask", "ssl", "readonly", "test", "save", "cancel"]);
    expect(v.form.ssl()).toBe(true);
    expect("sslmode" in v.form.conn("x")).toBe(false);
    expect(texts(render(v))).toContain("client default");
    tabTo(v, "ssl");
    v.key(key("space"), cx);
    expect(v.form.ssl()).toBe(false);
    expect(v.form.conn("x").sslmode).toBe("disable");
    expect(texts(render(v))).toContain("sslmode=disable");
    v.key(key("space"), cx);
    expect(v.form.ssl()).toBe(true);
    expect("sslmode" in v.form.conn("x")).toBe(false);
    // mysql: the kind stepped by key keeps the toggle; sqlite drops it (and the field).
    v.key(key("space"), cx);
    tabTo(v, "kind");
    v.key(key("right"), cx);
    expect(v.form.kind).toBe("mysql");
    expect(ids(v)).toContain("ssl");
    expect(v.form.conn("x").sslmode).toBe("disable");
    v.key(key("right"), cx);
    expect(v.form.kind).toBe("sqlite");
    expect(ids(v)).not.toContain("ssl");
    expect("sslmode" in v.form.conn("x")).toBe(false);
    v.key(key("right"), cx);
    expect(v.form.kind).toBe("libsql");
    v.key(key("right"), cx);
    expect(v.form.kind).toBe("postgres");
    expect(v.form.conn("x").sslmode).toBe("disable");
  });

  test("an edit that leaves the toggle keeps a pasted require (shown beside it); off and on again comes back to it", async () => {
    fresh();
    const v = open({ folder: "/w", overlay: "f2" });
    await flush();
    v.saved = [connOf({ ...connJson(PG as any), sslmode: "require" })];
    v.key(key("1"), cx);
    v.connAt = 0;
    v.key(key("e"), cx);
    expect(v.form.editing?.id).toBe("pg-1");
    expect(v.form.conn("pg-1").sslmode).toBe("require");
    expect(texts(render(v))).toContain("sslmode=require");
    tabTo(v, "ssl");
    v.key(key("space"), cx);
    expect(v.form.conn("pg-1").sslmode).toBe("disable");
    v.key(key("space"), cx);
    expect(v.form.conn("pg-1").sslmode).toBe("require");
    // Saved: the file has it.
    v.dir = "/tmp/fireflies-db.abc";
    tabTo(v, "save");
    v.key(key("enter"), cx);
    await flush(); await flush();
    const file = written.filter(([p]) => p.endsWith("/data/databases/connections.json")).at(-1);
    expect(JSON.parse(file?.[1] ?? "{}").connections[0]).toMatchObject({ id: "pg-1", sslmode: "require" });
  });

  test("a URL pasted into the host fills it (none in the URL: the client's default)", async () => {
    fresh();
    const v = open({ folder: "/w", overlay: "f3" });
    await flush();
    v.key(key("n"), cx);
    v.form.inputs.get("host").set_value("postgres://ada@db/lantern?sslmode=require");
    v.form.fromUrl();
    expect(v.form.conn("x")).toMatchObject({ kind: "postgres", host: "db", user: "ada", database: "lantern", sslmode: "require" });
    v.form.inputs.get("host").set_value("mysql://root@127.0.0.1:3307/shop?ssl-mode=DISABLED");
    v.form.fromUrl();
    expect(v.form.conn("x")).toMatchObject({ kind: "mysql", port: 3307, sslmode: "disable" });
    expect(v.form.ssl()).toBe(false);
    // Turned on again: no other sslmode was given, so the client's default.
    v.form.flip("ssl");
    expect("sslmode" in v.form.conn("x")).toBe(false);
    v.form.inputs.get("host").set_value("postgres://ada@db/lantern");
    v.form.fromUrl();
    expect("sslmode" in v.form.conn("x")).toBe(false);
    expect(sslWords(undefined)).toBe("client default");
  });
});

describe("databases.connect", () => {
  test("carries it onto the sent connection, psql's -d and mysql's flag; a pin keeps it", async () => {
    fresh();
    const v = open({ folder: "/w", overlay: "c1" });
    await flush();
    v.dir = "/tmp/fireflies-db.abc";
    command(v, `databases.connect:${JSON.stringify({ kind: "postgres", host: "127.0.0.1", port: 15432, database: "lantern", user: "ada", from: "port-forward svc/lantern-db", sslmode: "disable" })}`, cx);
    await flush(); await flush();
    expect(v.sent[0]?.sslmode).toBe("disable");
    expect(runArgs().map(dOf)).toContain("dbname='lantern' sslmode=disable");
    await runView(saveFound(v, v.sent[0]));
    const file = written.filter(([p]) => p.endsWith("/data/databases/connections.json")).at(-1);
    expect(JSON.parse(file?.[1] ?? "{}").connections[0]).toMatchObject({ host: "127.0.0.1", port: 15432, sslmode: "disable" });
  });

  test("mysql: MariaDB's client gets --skip-ssl, MySQL's --ssl-mode=DISABLED", async () => {
    for (const [version, flag] of [["mysql from 11.4.13-MariaDB, client 15.2", "--skip-ssl"], ["mysql  Ver 8.4.11 for macos26.6 on arm64", "--ssl-mode=DISABLED"]] as const) {
      fresh();
      h.reply = (cmd, args) => (cmd === "/usr/bin/mysql" && args[0] === "--version" ? { code: 0, stdout: `${version}\n`, stderr: "" } : found(cmd, args));
      const v = open({ folder: "/w", overlay: `c-${flag}` });
      await flush();
      v.dir = "/tmp/fireflies-db.abc";
      command(v, `databases.connect:${JSON.stringify({ kind: "mysql", host: "127.0.0.1", port: 13306, database: "shop", sslmode: "disable" })}`, cx);
      await flush(); await flush();
      const args = runArgs()[0] ?? [];
      expect(args).toContain(flag);
      expect(args.filter((a) => /ssl/.test(a))).toEqual(flag === "--skip-ssl" ? ["--skip-ssl"] : ["--ssl-mode=DISABLED"]);
      // Looked up once per window.
      expect(execs.filter((a) => a[0] === "/usr/bin/mysql" && a[1] === "--version").length).toBe(1);
    }
  });

  test("an unknown sslmode refuses the request in words; a file's is left out; nocturne's guard lets it through", async () => {
    fresh();
    const v = open({ folder: "/w", overlay: "c2" });
    await flush();
    command(v, `databases.connect:${JSON.stringify({ kind: "postgres", host: "127.0.0.1", port: 15432, sslmode: "false" })}`, cx);
    await flush();
    expect(v.sent).toEqual([]);
    expect(v.note?.text).toBe('databases.connect: sslmode "false" isn\'t one of disable, allow, prefer, require, verify-ca, verify-full');
    command(v, `databases.connect:${JSON.stringify({ kind: "sqlite", path: "/w/a.db", sslmode: "disable" })}`, cx);
    await flush();
    expect(v.sent[0]?.kind).toBe("sqlite");
    expect("sslmode" in v.sent[0]).toBe(false);
    const args = { kind: "postgres", host: "127.0.0.1", port: 15432, sslmode: "disable" };
    expect(connectArgsOf(JSON.stringify({ ...args, as: "pane" }))).toEqual({ ...args, as: "pane" } as any);
  });

  test("opened with it in its props (nocturne.databases:{…})", async () => {
    fresh();
    const v = open({ folder: "/w", overlay: "c3", connect: { kind: "postgres", host: "127.0.0.1", port: 15432, database: "lantern", sslmode: "disable" } });
    await flush(); await flush();
    expect(v.sent[0]?.sslmode).toBe("disable");
  });
});
