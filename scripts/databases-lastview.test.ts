// Item 32: the Databases window comes back where it was last left in its space (lastview.ts):
// the connection (a sent one sent again), the open table and the panel, kept in shared
// "databases.spaces" (persisted) under the space's id; another space opens as before, and a
// connection that doesn't come up leaves the list shown with why. The harness is
// databases-where.test.ts's (its made-up Postgres server). Its own process: it stands in for "herdr".
import { test, expect, mock, describe } from "bun:test";
import { found, standIn } from "./databases-host.ts";

const { h, theme, el, cx, forget, until, flush, advance, services } = standIn();
const { files, commands, opened, closed, execs, written, stores } = h;
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Writes land in `written`; a real run (the throwaway server) also puts them on disk. */
let realFiles = false;

const { default: Databases } = await import("../defaults/mods/databases/main.ts");
(await import("../defaults/mods/databases/app.ts")).useServices(services);
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
const fresh = () => { forget(); h.shared = {}; commands.length = 0; opened.length = 0; closed.length = 0; h.panes = []; h.focused = null; stores.clear(); execs.length = 0; written.length = 0; files.clear(); h.reply = found; realFiles = false; };

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
const inSpace = (id: string) => { h.spaces = [{ id, active: true, tabs: [] }, { id: id === "sA" ? "sB" : "sA", active: false, tabs: [] }]; };
const { SPACES_KEY, SPACES_KEPT, keepSpacePlace } = await import("../defaults/mods/databases/lastview.ts");

/** A window opened in `space`, its start (and any reconnect) settled. */
async function windowIn(space: string) {
  inSpace(space);
  const v = open({ folder: "/w", overlay: `w-${space}` });
  for (let i = 0; i < 4; i++) await flush();
  await until(() => !v.catalog.busy && !v.reads.length);
  return v;
}

test("the place is written on change under the space's id, never a secret; it comes back in the same space, not in another", async () => {
  reset();
  const v = await windowIn("sA");
  command(v, `databases.connect:${JSON.stringify({ ...SENT, database: "glowworm" })}`, cx);
  await until(() => v.catalog.tables.length > 0 && !v.reads.length);
  await until(() => (h.shared[SPACES_KEY.name] as any)?.sA !== undefined);
  expect((h.shared[SPACES_KEY.name] as any).sA).toMatchObject({ sent: { database: "glowworm" } });
  command(v, "databases.table:glows", cx);
  await until(() => v.rows.browse !== null && !v.reads.length);
  const kept: any = (h.shared[SPACES_KEY.name] as any).sA;
  expect(kept).toMatchObject({ table: "glows", sent: { kind: "postgres", host: "127.0.0.1", port: 25433, database: "glowworm" } });
  expect(JSON.stringify(kept)).not.toMatch(/password|secret/i);
  expect((h.shared[SPACES_KEY.name] as any).sB).toBeUndefined();

  // A new window (also after a restart: shared() is what's persisted) in the same space.
  execs.length = 0;
  const again = await windowIn("sA");
  await until(() => again.rows.browse !== null && !again.reads.length);
  expect(again.active?.name).toBe(SENT.name);
  expect(runs().some((r) => r.d === "glowworm")).toBe(true);
  expect(again.rows.browse.table.name).toBe("glows");
  expect(again.panel).toBe(kept.panel ?? "tables");

  // Another space: opens as before, nothing connected.
  execs.length = 0;
  const other = await windowIn("sB");
  expect(other.active).toBe(null);
  expect(runs()).toEqual([]);
});

test("a kept connection that doesn't come up: the connection list, the error said, no hang", async () => {
  reset();
  keepSpacePlace("sA", { panel: "main", table: "glows", sent: { ...SENT, database: "glowworm" } as any });
  gone = true;
  const v = await windowIn("sA");
  await until(() => v.panel === "conns" && v.note !== null);
  expect(v.catalog.busy).toBe(false);
  expect(drawnText(v)).toContain("couldn't connect to");
  expect(v.rows.browse).toBe(null);
});

test("a disconnect is kept too (the space opens unconnected); only the newest spaces are kept", async () => {
  reset();
  for (let i = 0; i < SPACES_KEPT + 5; i++) keepSpacePlace(`s${i}`, { panel: "conns", query: i });
  const map = h.shared[SPACES_KEY.name] as any;
  expect(Object.keys(map)).toHaveLength(SPACES_KEPT);
  expect(map.s0).toBeUndefined();
  expect(map[`s${SPACES_KEPT + 4}`]).toMatchObject({ query: SPACES_KEPT + 4 });
  keepSpacePlace("sA", { panel: "conns" });
  const v = await windowIn("sA");
  expect(v.active).toBe(null);
});
