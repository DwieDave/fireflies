// Item 32: the Databases window comes back where it was last left in its space (lastview.ts):
// the connection (a sent one sent again), the open table and the panel, kept in shared
// "databases.spaces" (persisted) under the space's id; another space opens as before, and a
// connection that doesn't come up leaves the list shown with why. The harness is
// databases-where.test.ts's (its made-up Postgres server). Its own process: it stands in for "herdr".
import { test, expect, mock, describe } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let sharedState: Record<string, unknown> = {};
const files = new Map<string, string>();
let propsNow: any = null;
let panesNow: any[] = [];
let focusedNow: any = null;
const commands: [string, any][] = [];
const opened: any[] = [];
const closed: string[] = [];
const execs: string[][] = [];
const written: [string, string][] = [];
/** The default answers: the clients are found (envrc.ts lookup), anything else fails quietly. */
const found = (cmd: string, args: string[]) => (cmd === "sh" && args[2] === "lookup" ? { code: 0, stdout: `/usr/bin/${args[4]}\n`, stderr: "" } : { code: 1, stdout: "", stderr: "" });
let execReply: (cmd: string, args: string[], opts?: any) => any = found;
/** Writes land in `written`; a real run (the throwaway server) also puts them on disk. */
let realFiles = false;
let overlayN = 0;
let platformNow = "linux";
mock.module("herdr", () => ({
  agents: () => [], appHome: () => "/tmp/herdr-test", home: () => "/home/me",
  closeOverlay: (id: string) => { closed.push(id); return null; },
  openOverlay: (spec: any) => { opened.push(spec); return `o${++overlayN}`; },
  exec: async (cmd: string, args: string[] = [], opts: any = {}) => { execs.push([cmd, ...args]); return execReply(cmd, args, opts); },
  focused: () => focusedNow, hc: async () => ({ code: 1, stdout: "" }), keys: () => [], layout: () => null,
  nextCommand: () => new Promise(() => {}), notify: () => null, panes: () => panesNow, props: () => propsNow,
  readTextFile: async (p: string) => files.get(p) ?? null, writeTextFile: async (p: string, t: string) => { written.push([p, t]); files.set(p, t); if (realFiles) await Bun.write(p, t); return null; },
  pickFile: async () => null, pickFolder: async () => null,
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  settings: () => ({ zoom: 1, font_family: "Mono" }), shared: (k: string) => sharedState[k] ?? null, setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  spaces: () => spacesNow, terminals: () => [], theme: () => theme, window: () => ({ platform: platformNow }),
}));

let drawn: [string, any[]][] = [];
const el: any = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined
    : k === "when" ? (on: unknown, add: (e: unknown) => unknown) => { drawn.push(["when", []]); return on ? add(el) : el; }
    : k === "map" ? (f: (e: unknown) => unknown) => f(el)
    : (...args: any[]) => { drawn.push([String(k), args]); return el; }),
  apply: () => el,
});
class View {}
mock.module("gpui-kit", () => ({ View, div: () => el, svg: () => el, image: () => el, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
const handle = () => ({ scroll_to_item() {}, offset: () => ({ x: 0, y: 0 }), release: () => true });
class Input { v = ""; masked = false; constructor(o: any = {}) { this.v = o.value ?? ""; } on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} release() { return true; } set_masked(m: boolean) { this.masked = m; } }
/** The SQL editor: its text, caret and selection; what the window asks of it. */
class Editor {
  text: string; caret = { line: 0, col: 0 }; sel: any = null; diags: any[] = []; keys: any = null; focusedNow = false;
  constructor(o: any) { this.text = o.value ?? ""; }
  value() { return this.text; } set_value(v: string) { this.text = v; }
  on(ev: string, f: any) { if (ev === "key") this.keys = f; return true; }
  cursor() { return this.caret; } set_cursor(line: number, col: number) { this.caret = { line, col }; }
  selection() { return this.sel ?? { start: this.caret, end: this.caret, text: "" }; }
  set_diagnostics(d: any[]) { this.diags = d; } edit(e: any[]) { for (const x of e) this.text = this.text.slice(0, x.start.col) + x.text + this.text.slice(x.end.col); }
  focus() { this.focusedNow = true; } focused() { return this.focusedNow; } release() { return true; }
}
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, ScrollHandle: { new: handle },
  InputState: { new: (o: any) => new Input(o) }, Input: { new: () => el },
  EditorState: { new: (o: any) => new Editor(o) }, Editor: { new: () => el },
}));
(globalThis as any).window = { paint_path: () => el };
const theme: any = new Proxy({}, { get: (_t, k) => (String(k).startsWith("ansi") ? "#808080" : "#c0c0c0") });

const stores = new Map<string, Map<string, string>>();
(globalThis as any).localStorage = {
  getItem: (k: string) => stores.get(JSON.stringify(propsNow))?.get(k) ?? null,
  setItem: (k: string, v: string) => { const key = JSON.stringify(propsNow); if (!stores.has(key)) stores.set(key, new Map()); stores.get(key)!.set(k, v); },
};

let clipboard = "";
const cx: any = {
  spawn(f: Function) { void f(cx); }, notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {}, is_focused: () => false, release: () => true }),
  timer: { after(ms: number, f: Function) { if (ms < 1000) f(cx); return { cancel() {} }; }, every() {} }, bind_keys() {}, write_to_clipboard: (t: string) => { clipboard = t; },
};

const { default: Databases } = await import("../defaults/mods/databases/main.ts");
const { command } = await import("../defaults/mods/databases/opening.ts");

function open(p: any) {
  propsNow = p;
  const v: any = new Databases();
  v.init(p, cx);
  return v;
}
function render(v: any, width = 1100) {
  v.size = { width, height: 720 };
  drawn = [];
  v.render();
  return drawn;
}
const framed = (d: [string, any[]][]) => {
  const i = d.findIndex(([m, a]) => m === "id" && a[0] === "databases");
  const j = d.findIndex(([m], n) => n > i && m === "track_focus");
  return d.slice(i, j).some(([m]) => m === "border");
};
const texts = (d: [string, any[]][]) => d.filter(([m]) => m === "child").flatMap(([, a]) => a.filter((x) => typeof x === "string"));
const tips = (d: [string, any[]][]) => d.filter(([m]) => m === "tooltip").map(([, a]) => a[0]);
const key = (k: string, mods: any = {}) => ({ key: k, key_char: k.length === 1 ? k : undefined, modifiers: mods });
const fresh = () => { sharedState = {}; commands.length = 0; opened.length = 0; closed.length = 0; panesNow = []; focusedNow = null; stores.clear(); execs.length = 0; written.length = 0; files.clear(); execReply = found; realFiles = false; };
const flush = () => new Promise((r) => setTimeout(r, 5));

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!f()) { if (Date.now() > end) throw new Error("timed out waiting"); await sleep(5); }
}
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
  execReply = (cmd: string, args: string[]): any => {
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
let spacesNow: any[] = [];
const inSpace = (id: string) => { spacesNow = [{ id, active: true, tabs: [] }, { id: id === "sA" ? "sB" : "sA", active: false, tabs: [] }]; };
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
  await until(() => (sharedState[SPACES_KEY.name] as any)?.sA !== undefined);
  expect((sharedState[SPACES_KEY.name] as any).sA).toMatchObject({ sent: { database: "glowworm" } });
  command(v, "databases.table:glows", cx);
  await until(() => v.rows.browse !== null && !v.reads.length);
  const kept: any = (sharedState[SPACES_KEY.name] as any).sA;
  expect(kept).toMatchObject({ table: "glows", sent: { kind: "postgres", host: "127.0.0.1", port: 25433, database: "glowworm" } });
  expect(JSON.stringify(kept)).not.toMatch(/password|secret/i);
  expect((sharedState[SPACES_KEY.name] as any).sB).toBeUndefined();

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
  const map = sharedState[SPACES_KEY.name] as any;
  expect(Object.keys(map)).toHaveLength(SPACES_KEPT);
  expect(map.s0).toBeUndefined();
  expect(map[`s${SPACES_KEPT + 4}`]).toMatchObject({ query: SPACES_KEPT + 4 });
  keepSpacePlace("sA", { panel: "conns" });
  const v = await windowIn("sA");
  expect(v.active).toBe(null);
});
