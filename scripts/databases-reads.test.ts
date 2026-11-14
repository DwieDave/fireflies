// The Databases window's reads (reads.ts, session.ts, folderenv.ts): nothing sits in "reading"
// without something running; a read shows its seconds, stops by esc or its chip, ends at its
// deadline; a missing client is said before anything is read, with the line to install it; the
// client is looked for in the space folder's direnv environment first; the Log names each run.
// Everything is a stand-in (kubectl, psql, direnv): no cluster, no server, no keychain touched.
// Its own process: it stands in for "herdr".
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
let execReply: (cmd: string, args: string[]) => any = found;
let overlayN = 0;
let platformNow = "linux";
mock.module("herdr", () => ({
  agents: () => [], appHome: () => "/tmp/herdr-test", home: () => "/home/me",
  closeOverlay: (id: string) => { closed.push(id); return null; },
  openOverlay: (spec: any) => { opened.push(spec); return `o${++overlayN}`; },
  exec: async (cmd: string, args: string[] = []) => { execs.push([cmd, ...args]); return execReply(cmd, args); },
  focused: () => focusedNow, hc: async () => ({ code: 1, stdout: "" }), keys: () => [], layout: () => null,
  nextCommand: () => new Promise(() => {}), notify: () => null, panes: () => panesNow, props: () => propsNow,
  readTextFile: async (p: string) => files.get(p) ?? null, writeTextFile: async (p: string, t: string) => { written.push([p, t]); return null; },
  pickFile: async () => null, pickFolder: async () => null,
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  settings: () => ({ zoom: 1, font_family: "Mono" }), shared: (k: string) => sharedState[k] ?? null, setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  spaces: () => [], terminals: () => [], theme: () => theme, window: () => ({ platform: platformNow }),
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
  timer: { after(_ms: number, f: Function) { f(cx); }, every() {} }, bind_keys() {}, write_to_clipboard: (t: string) => { clipboard = t; },
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
const fresh = () => { sharedState = {}; commands.length = 0; opened.length = 0; closed.length = 0; panesNow = []; focusedNow = null; stores.clear(); execs.length = 0; written.length = 0; execReply = found; };
const flush = () => new Promise((r) => setTimeout(r, 5));



// ---- the stand-ins: kubectl, the client lookup, the folder's direnv, the client runs (each can wait)

const { readIn, overdue } = await import("../defaults/mods/databases/reads.ts");
const { connectWords } = await import("../defaults/mods/databases/words.ts");
const { installLine, INSTALL } = await import("../defaults/mods/databases/clients.ts");
const { runnerArgs } = await import("../defaults/mods/databases/runner.ts");

const b64 = (s: string) => Buffer.from(s).toString("base64");
/** His shape: a pod's forward, the password and user from the pod's env (no database). */
const SOURCE = { from: "kubernetes", context: "nightjar-dev", namespace: "glowworm", name: "glowworm-pg-env", key: "POSTGRES_PASSWORD", userKey: "POSTGRES_USER" };
const ARGS = { kind: "postgres", name: "glowworm-pg-1 (nightjar-dev/glowworm)", host: "127.0.0.1", port: 15432, from: "port-forward pod/glowworm-pg-1 in nightjar-dev/glowworm", secret: SOURCE };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const never = () => new Promise<any>(() => {});

/** What each stand-in does now. */
let world: {
  kube: () => Promise<any>; psqlAt: string | null; folderPsql: string | null; direnv: null | (() => Promise<any>); run: (args: string[]) => Promise<any>; setup: string;
};
const PSQL_OUT = "";
const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
const reset = () => {
  fresh();
  world = {
    kube: async () => ok(`${b64("moth-lantern-42")}\n${b64("lantern")}\n`),
    psqlAt: null, folderPsql: null, direnv: null, run: async () => ok(PSQL_OUT), setup: "nix-darwin",
  };
  execReply = (cmd: string, args: string[]): any => {
    if (cmd === "kubectl") return world.kube();
    if (cmd === "sh" && args[2] === "ff-dir") return ok("/tmp/fireflies-db.abc\n");
    if (cmd === "sh" && args[2] === "ff-setup") return ok(`${world.setup}\n`);
    if (cmd === "sh" && args[2] === "lookup") {
      const inFolder = args[3] ? world.folderPsql : null;
      const path = args[4] === "psql" ? inFolder ?? world.psqlAt : null;
      return path ? ok(`${path}\n`) : { code: 1, stdout: "", stderr: "" };
    }
    if (cmd === "sh" && args[2] === "probe") return world.direnv ? ok(`dir\t${args[3]}\nstatus\t{"state":{"foundRC":{"allowed":0}}}\n`) : ok("");
    if (cmd === "direnv") return (world.direnv ?? (async () => ok("{}")))();
    if (cmd === "sh" && args[2] === "ff-db") return world.run(args);
    if (cmd === "sh" && args[2] === "ff-cancel") return ok("");
    return { code: 1, stdout: "", stderr: "" };
  };
};
const kubectlCalls = () => execs.filter((a) => a[0] === "kubectl");
const runs = () => execs.filter((a) => a[0] === "sh" && a[3] === "ff-db");
async function sent(args: any = ARGS, folder = "/w") {
  const v = open({ folder, overlay: "w1" });
  for (let i = 0; i < 4; i++) await flush();
  command(v, `databases.connect:${JSON.stringify(args)}`, cx);
  return v;
}
async function until(f: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!f()) { if (Date.now() > end) throw new Error("timed out waiting"); await sleep(5); }
}
const drawnText = (v: any) => texts(render(v)).join(" | ");

test("his case: a pod's forward, psql nowhere: the window says what to install at once, reads no secret, and never sits in reading", async () => {
  reset();
  const v = await sent();
  await until(() => v.catalog.error !== null);
  expect(v.catalog.busy).toBe(false);
  expect(v.reads).toEqual([]);
  expect(kubectlCalls()).toEqual([]);
  expect(v.catalog.error).toBe(`${INSTALL.postgres} (not on the app's PATH)`);
  const d = drawnText(v);
  expect(d).not.toContain("reading");
  expect(d).toContain("psql isn't here");
  expect(d).toContain("libpq alone has no psql");
  // The line to copy fits the machine: nix-darwin's package.
  expect(d).toContain(installLine("postgres", "nix-darwin"));
  expect(installLine("postgres", "nix-darwin")).toContain("pkgs.postgresql");
  expect(installLine("postgres", "brew")).toBe("brew install libpq && brew link --force libpq");
  expect(installLine("postgres", "nix")).toBe("nix profile install nixpkgs#postgresql");
  const copy = drawn.find(([m, a]) => m === "id" && a[0] === "tables-missing-copy");
  expect(copy).toBeTruthy();
  // The Log says what wasn't found, and where it was looked for.
  expect(v.log[0]).toMatchObject({ sql: "looking for psql", ok: false, run: "psql: not on the app's PATH" });
});

test("his case delivered twice (props and a command, at every moment), psql absent and present: busy never stays on", async () => {
  for (const psql of [null, "/run/current-system/sw/bin/psql"]) for (const second of [0, 3, 8, 15, 30]) {
    reset();
    world.psqlAt = psql;
    world.kube = async () => { await sleep(6); return ok(`${b64("moth-lantern-42")}\n${b64("lantern")}\n`); };
    world.run = async () => { await sleep(10); return ok(""); };
    const v = open({ folder: "/w", overlay: "w1", connect: ARGS });
    await sleep(second);
    command(v, `databases.connect:${JSON.stringify(ARGS)}`, cx);
    await until(() => !v.catalog.busy && !v.reads.length && (v.catalog.error !== null || runs().length > 0), 2000);
    await sleep(40);
    expect({ psql, second, busy: v.catalog.busy, reads: v.reads.length }).toEqual({ psql, second, busy: false, reads: 0 });
    expect(drawnText(v)).not.toContain("reading the tables");
  }
});

test("a read that throws: its panel says so, busy is cleared", async () => {
  reset();
  world.psqlAt = "/usr/bin/psql";
  const v = await sent();
  await until(() => !v.catalog.busy && runs().length > 0);
  v.logLine = () => { throw new Error("the log broke"); };
  v.refreshCatalog(cx);
  await until(() => !v.catalog.busy);
  expect(v.catalog.error).toBe("reading the tables failed: the log broke");
  expect(v.reads).toEqual([]);
});

test("a secret's read that never comes back: shown with its seconds and stop, ended at its deadline with words", async () => {
  reset();
  world.psqlAt = "/usr/bin/psql";
  world.kube = never;
  const v = await sent();
  await until(() => v.reads.length === 1);
  const r = readIn(v, "tables");
  expect(r.what).toBe("reading the password from secret glowworm-pg-env");
  expect(v.catalog.busy).toBe(false);
  let d = drawnText(v);
  expect(d).toContain("reading the password from secret glowworm-pg-env… 0 s");
  expect(d).toContain("esc stops it");
  expect(d).toContain("■ stop");
  // 21 s later (the window's tick, every second).
  overdue(v, r.at + 21000);
  await until(() => v.catalog.error !== null);
  expect(v.catalog.error).toBe("reading the password from secret glowworm-pg-env: no answer after 20 s · r tries again");
  expect(v.reads).toEqual([]);
  d = drawnText(v);
  expect(d).not.toContain("glowworm-pg-env…");
});

test("stop: esc ends a tables read and interrupts the client by its nonce; the chip does the same", async () => {
  reset();
  world.psqlAt = "/usr/bin/psql";
  world.run = never;
  const v = await sent();
  await until(() => readIn(v, "tables")?.what === "reading the tables" && readIn(v, "tables")?.nonce);
  const nonce = readIn(v, "tables").nonce;
  expect(drawnText(v)).toContain("reading the tables… 0 s");
  v.key(key("escape"), cx);
  await until(() => !v.catalog.busy);
  expect(v.catalog.error).toBe("reading the tables: stopped · r reads again");
  await until(() => execs.some((a) => a[3] === "ff-cancel"));
  expect(execs.find((a) => a[3] === "ff-cancel")?.at(-1)).toBe(`/tmp/fireflies-db.abc/pid-${nonce}`);
  // The window is still open: esc stopped the read, it didn't close.
  expect(closed).toEqual([]);
  // The chip: r reads again, a click on ■ stop ends it.
  v.key(key("r"), cx);
  await until(() => readIn(v, "tables")?.nonce);
  render(v);
  const stop = drawn.findIndex(([m, a]) => m === "id" && a[0] === "tables-read-stop");
  expect(stop).toBeGreaterThan(-1);
  const click = drawn.slice(stop).find(([m]) => m === "on_click")?.[1][0];
  click({}, cx);
  await until(() => !v.catalog.busy);
  expect(v.catalog.error).toBe("reading the tables: stopped · r reads again");
});

test("the Log names each client run: the program, its arguments, where it came from, its exit; nothing secret", async () => {
  reset();
  world.psqlAt = "/run/current-system/sw/bin/psql";
  world.run = async () => ({ code: 2, stdout: "", stderr: 'psql: error: connection to server at "127.0.0.1", port 15432 failed: timeout expired\n' });
  const v = await sent();
  await until(() => v.catalog.error !== null);
  const line = v.log[0];
  expect(line.sql).toBe("the tables");
  expect(line.run).toBe("/run/current-system/sw/bin/psql -X -A --csv -w -v ON_ERROR_STOP=1 -v FETCH_COUNT=500 -P null=␀ -h 127.0.0.1 -p 15432 -U lantern -d postgres · from the app's PATH · exit 2");
  expect(JSON.stringify(v.log)).not.toContain("moth-lantern-42");
  // A port that takes the connection and never answers: psql's deadline, said plainly.
  expect(v.catalog.error).toBe("nothing answered on 127.0.0.1:15432 within 10 s: something takes the connection, but no database speaks (a port-forward whose pod is gone does this) · timeout expired");
  // The deadline is in the runner (unless the environment sets one).
  expect(runnerArgs({ kind: "postgres", dir: "/d", program: "psql", args: [], script: "" }, "n")[1]).toContain("PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-10}; export PGCONNECT_TIMEOUT");
});

test("connect errors in words: refused, closed by a forward, other errors as they are", () => {
  const c: any = { kind: "postgres", host: "127.0.0.1", port: 15432 };
  const e = (message: string, index: number | null = null) => connectWords(c, { index, message, line: null, col: null, hint: null }).message;
  expect(e("Connection refused\n\tIs the server running")).toStartWith("nothing listens on 127.0.0.1:15432 (a port-forward that isn't running)");
  expect(e("server closed the connection unexpectedly")).toStartWith("the connection on 127.0.0.1:15432 was closed before the database answered");
  expect(e("password authentication failed for user \"lantern\"")).toBe("password authentication failed for user \"lantern\"");
  expect(e("timeout expired", 0)).toBe("timeout expired");
});

test("the client from the folder's environment (direnv): waited for, preferred, said where it came from; esc skips the wait", async () => {
  reset();
  world.psqlAt = "/run/current-system/sw/bin/psql";
  world.folderPsql = "/nix/store/abc-postgresql-17/bin/psql";
  let release: () => void = () => {};
  world.direnv = () => new Promise((r) => { release = () => r(ok(JSON.stringify({ PATH: "/nix/store/abc-postgresql-17/bin:/usr/bin" }))); });
  const v = await sent(ARGS, "/home/me/lanterns");
  await until(() => readIn(v, "tables") !== null);
  expect(readIn(v, "tables").what).toBe("loading ~/lanterns's environment (direnv)");
  expect(drawnText(v)).toContain("loading ~/lanterns's environment (direnv)… 0 s");
  expect(kubectlCalls()).toEqual([]);
  release();
  await until(() => runs().length > 0 && !v.catalog.busy);
  expect(runs()[0]?.[7]).toBe("/nix/store/abc-postgresql-17/bin/psql");
  // The client runs with the folder's PATH too.
  expect(runs()[0]?.[8]).toBe("/nix/store/abc-postgresql-17/bin:/usr/bin");
  expect(v.log.find((l: any) => l.sql === "the tables")?.run).toContain("· from ~/lanterns's environment (direnv) · exit 0");
  // Skipped: the app's PATH, said so.
  reset();
  world.psqlAt = "/run/current-system/sw/bin/psql";
  world.direnv = never;
  const w = await sent(ARGS, "/home/me/moths");
  await until(() => readIn(w, "tables") !== null);
  w.key(key("escape"), cx);
  await until(() => runs().length > 0 && !w.catalog.busy);
  expect(runs()[0]?.[7]).toBe("/run/current-system/sw/bin/psql");
  expect(w.log.find((l: any) => l.sql === "the tables")?.run).toContain("· from the app's PATH");
});

test("Postgres and MySQL structure reads no exact count (the estimate stands); # counts on demand", async () => {
  const { structureSql } = await import("../defaults/mods/databases/catalog.ts");
  for (const kind of ["postgres", "mysql"] as const) expect(structureSql(kind, { schema: "public", name: "lanterns" }).some((s: any) => /count\(\*\)/.test(s.text))).toBe(false);
  expect(structureSql("sqlite", { schema: null, name: "lanterns" }).some((s: any) => /count\(\*\)/.test(s.text))).toBe(true);
  reset();
  world.psqlAt = "/usr/bin/psql";
  world.run = async (args: string[]) => ok("");
  const v = await sent();
  await until(() => runs().length > 0 && !v.catalog.busy);
  v.catalog.tables = [{ schema: "public", name: "lanterns", type: "table", rows: 1200 }];
  v.panel = "tables";
  v.tableAt = 0;
  const before = runs().length;
  v.key(key("#"), cx);
  await until(() => runs().length > before);
  expect(v.log[0].sql).toBe("lanterns's rows counted");
});

test("said before connecting: a listed connection's row and the new-connection form name the missing client", async () => {
  reset();
  files.set("/tmp/herdr-test/data/databases/connections.json", JSON.stringify({ connections: [{ id: "pg-moth0001", name: "moth-lantern", kind: "postgres", host: "127.0.0.1", port: 15432, readonly: false, secret: "ask" }] }));
  const v = open({ folder: "/w", overlay: "w1" });
  for (let i = 0; i < 6; i++) await flush();
  await until(() => v.clients.has("postgres"));
  const d = drawnText(v);
  expect(d).toContain("no psql");
  expect(drawn.some(([m, a]) => m === "id" && a[0] === "conn-noclient-pg-moth0001")).toBe(true);
  expect(execs.filter((a) => a[0] === "kubectl" || a[3] === "ff-db")).toEqual([]);
  v.key(key("n"), cx);
  const f = drawnText(v);
  expect(f).toContain(`${INSTALL.postgres} · ${installLine("postgres", "nix-darwin")}`);
  files.clear();
});

/** A real psql (FF_TEST_PG_BIN; skipped without one) on a port that takes the connection and never answers. */
const PG_BIN = process.env.FF_TEST_PG_BIN ?? "";

describe.skipIf(!PG_BIN)("a real psql on a black-hole port", () => {
  test("it gives up at the connect deadline (the environment's PGCONNECT_TIMEOUT kept), said plainly", async () => {
    const { run } = await import("../defaults/mods/databases/runner.ts");
    const { parsePsql } = await import("../defaults/mods/databases/parse-out.ts");
    const hole = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {}, open() {} } });
    const dir = mkdtempSync(join(tmpdir(), "ff-hole-"));
    const io: any = {
      exec: async (cmd: string, args: string[] = []) => {
        const p = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, PGCONNECT_TIMEOUT: "2" } });
        const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
        return { code: await p.exited, stdout, stderr };
      },
      writeTextFile: async (p: string, t: string) => { await Bun.write(p, t); return null; },
    };
    const at = Date.now();
    const r = await run(io, { kind: "postgres", dir, program: join(PG_BIN, "psql"), args: ["-X", "-w", "-h", "127.0.0.1", "-p", String(hole.port), "-d", "postgres"], script: "select 1;" });
    const took = Date.now() - at;
    hole.stop(true);
    rmSync(dir, { recursive: true, force: true });
    expect(took).toBeLessThan(6000);
    const e = parsePsql(r.stdout, r.stderr, r.code, [false]).error;
    expect(e?.message).toBe("timeout expired");
    expect(connectWords({ kind: "postgres", host: "127.0.0.1", port: hole.port } as any, e!).message).toStartWith(`nothing answered on 127.0.0.1:${hole.port} within`);
  });
});

test("a run the stop killed is said as stopped in the Log", async () => {
  reset();
  world.psqlAt = "/usr/bin/psql";
  let kill: () => void = () => {};
  world.run = () => new Promise((r) => { kill = () => r({ code: 137, stdout: "", stderr: "ff-db: line 24: 4242 Killed: 9  sh -c …" }); });
  const v = await sent();
  await until(() => readIn(v, "tables")?.nonce);
  command(v, "databases.stop", cx);
  kill();
  await until(() => v.log[0]?.said !== "running…");
  expect(v.log[0]).toMatchObject({ sql: "the tables", ok: false, said: "stopped" });
  expect(v.log[0].run).toEndWith("· exit 137");
});

test("databases.stop does what esc does to a read going on", async () => {
  reset();
  world.psqlAt = "/usr/bin/psql";
  world.run = never;
  const v = await sent();
  await until(() => readIn(v, "tables")?.nonce);
  command(v, "databases.stop", cx);
  await until(() => !v.catalog.busy);
  expect(v.catalog.error).toBe("reading the tables: stopped · r reads again");
  // The stopped run is named in the Log all the same (as it started: it never answered).
  expect(v.log[0]).toMatchObject({ sql: "the tables", said: "running…" });
  expect(v.log[0].run).toStartWith("/usr/bin/psql -X -A --csv");
});

/** A handler's cx as the app hands it out: it speaks for one call and refuses once that call has
 *  returned (after an await it's gone). `end()` is the call returning. */
function callCx() {
  let live = true;
  const gone = () => { throw new TypeError("cx is no longer valid: it was captured during an earlier call and used later. Use cx.spawn or take cx from the callback arguments instead."); };
  const one: any = new Proxy({}, { get: (_t, k) => (live ? cx[k as string] : gone()) });
  return { cx: one, end: () => { live = false; } };
}

test("a key's or a click's cx ends with its call: a table opened by enter still reads its rows and structure", async () => {
  reset();
  world.psqlAt = "/usr/bin/psql";
  world.run = async () => { await sleep(5); return ok(""); };
  const v = await sent();
  await until(() => runs().length > 0 && !v.catalog.busy);
  v.catalog.tables = [{ schema: "public", name: "lanterns", type: "table", rows: 1200 }];
  v.panel = "tables";
  v.tableAt = 0;
  const before = runs().length;
  const call = callCx();
  v.key(key("enter"), call.cx);
  call.end();
  await until(() => runs().length >= before + 2 && !v.rows.busy && !v.struct.busy);
  expect(v.rows.error).toBeNull();
  expect(v.struct.error).toBeNull();
  expect(v.reads).toEqual([]);

  // The same for a count asked by key (it says what it counted, not that its cx went away).
  const count = callCx();
  v.key(key("#"), count.cx);
  count.end();
  await until(() => v.log[0].sql === "lanterns's rows counted" && v.log[0].said !== "running…");
  await flush();
  expect(drawnText(v)).not.toContain("no longer valid");
});
