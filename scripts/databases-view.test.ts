// The Databases window's view (defaults/mods/databases): a window and a pane
// (docs/mods-in-panes.md: no frame or ✕ in a pane, esc leaves it, q closes
// it, the move both ways, commands to the copy with the keyboard, a pane's
// place kept per slot), narrow widths, the keys and menus, the asks before a
// write (twice for a DROP, refused on a read-only connection), a connection
// sent by another mod, and no secret in shared state or on an argv. herdr and
// gpui are stand-ins; the elements record what they're asked to draw.
// Its own process: it stands in for "herdr".
import { test, expect, mock } from "bun:test";

let sharedState: Record<string, unknown> = {};
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
mock.module("herdr", () => ({
  agents: () => [], appHome: () => "/tmp/herdr-test", home: () => "/home/me",
  closeOverlay: (id: string) => { closed.push(id); return null; },
  openOverlay: (spec: any) => { opened.push(spec); return `o${++overlayN}`; },
  exec: async (cmd: string, args: string[] = []) => { execs.push([cmd, ...args]); return execReply(cmd, args); },
  focused: () => focusedNow, hc: async () => ({ code: 1, stdout: "" }), keys: () => [], layout: () => null,
  nextCommand: () => new Promise(() => {}), notify: () => null, panes: () => panesNow, props: () => propsNow,
  readTextFile: async () => null, writeTextFile: async (p: string, t: string) => { written.push([p, t]); return null; },
  pickFile: async () => null, pickFolder: async () => null,
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  settings: () => ({ zoom: 1, font_family: "Mono" }), shared: (k: string) => sharedState[k] ?? null, setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  spaces: () => [], terminals: () => [], theme: () => theme, window: () => ({ platform: "linux" }),
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
const { runQuery } = await import("../defaults/mods/databases/query.ts");

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

const LITE = { id: "sq-1", name: "lantern.db", kind: "sqlite", path: "/w/lantern.db", readonly: false, secret: "none", origin: "saved" };
const PG = { id: "pg-1", name: "lantern-dev", kind: "postgres", host: "db", user: "ada", database: "lantern", readonly: false, secret: "ask", origin: "saved" };

test("as a pane: no frame, no ✕, the ⧉ to a window; the window has its frame, ✕ and ◧", () => {
  fresh();
  let d = render(open({ folder: "/w", slot: "s1" }));
  expect(framed(d)).toBe(false);
  expect(texts(d)).not.toContain("✕");
  expect(texts(d)).toContain("⧉");
  expect(tips(d)).toContain("Out to a window · ctrl-t");
  d = render(open({ folder: "/w", overlay: "w1" }));
  expect(framed(d)).toBe(true);
  expect(texts(d)).toContain("✕");
  expect(texts(d)).toContain("◧");
  expect(tips(d)).toContain("Into a pane · ctrl-t");
});

test("esc leaves a pane open, q closes its own pane; esc closes the window", () => {
  fresh();
  panesNow = [{ pane: "p9", mod: "databases", props: { slot: "x" } }, { pane: "p2", mod: "databases", props: { folder: "/w", slot: "s1" } }];
  const v = open({ folder: "/w", slot: "s1" });
  v.key(key("escape"), cx);
  expect(commands.filter(([n]) => n === "pane.close")).toEqual([]);
  v.key(key("q"), cx);
  expect(commands.filter(([n]) => n === "pane.close")).toEqual([["pane.close", { pane: "p2" }]]);
  const w = open({ folder: "/w", overlay: "w1" });
  w.key(key("escape"), cx);
  expect(closed).toContain("w1");
});

test("narrow: one panel, the others a row of numbered tabs; wide: every panel", () => {
  fresh();
  const v = open({ folder: "/w", slot: "s1" });
  let d = render(v, 520);
  expect(texts(d)).toEqual(expect.arrayContaining(["1 Connections", "2 Tables", "3 Structure", "0 Rows", "4 Log"]));
  for (const w of [260, 380, 639]) expect(() => render(v, w)).not.toThrow();
  d = render(v, 1100);
  expect(texts(d)).toEqual(expect.arrayContaining(["[1]", "[2]", "[3]", "[0]", "[4]"]));
});

test("moving: the window into a pane (handover, then the window steps aside) and a pane out to a window", () => {
  fresh();
  focusedNow = { pane: "p1" };
  const w = open({ folder: "/w", overlay: "w1" });
  w.panel = "structure";
  w.key(key("t", { control: true }), cx);
  const split = commands.find(([n]) => n === "pane.split");
  expect(split?.[1]).toMatchObject({ direction: "auto", mod: "databases", pane: "p1", props: { folder: "/w", on: null } });
  expect(split?.[1].props.slot).toMatch(/^[a-z0-9]+$/);
  expect(closed).toContain("w1");
  expect(sharedState["databases.handover"]).toMatchObject({ folder: "/w", panel: "structure" });
  // The new copy takes the handover and clears it.
  const p = open({ ...split?.[1].props });
  expect(p.panel).toBe("conns"); // its place comes once the saved list is read (start)
  fresh();
  panesNow = [{ pane: "p4", mod: "databases", props: { folder: "/w", slot: "s4" } }];
  const pane = open({ folder: "/w", slot: "s4" });
  pane.key(key("t", { control: true }), cx);
  expect(opened.at(-1)).toMatchObject({ mod: "databases", kind: "window", key: "databases", scrim: true, props: { folder: "/w" } });
  expect(commands).toContainEqual(["pane.close", { pane: "p4" }]);
});

test("commands go to the window while one is open, else to the focused pane", () => {
  fresh();
  panesNow = [{ pane: "pa", mod: "databases", props: { slot: "a" } }, { pane: "pb", mod: "databases", props: { slot: "b" } }];
  const a = open({ folder: "/w", slot: "a" });
  const b = open({ folder: "/w", slot: "b" });
  focusedNow = { pane: "pb" };
  command(a, "databases.panel-log", cx);
  command(b, "databases.panel-log", cx);
  expect([a.panel, b.panel]).toEqual(["conns", "log"]);
  const w = open({ folder: "/w", overlay: "w9" });
  command(b, "databases.panel-tables", cx);
  command(w, "databases.panel-tables", cx);
  expect([b.panel, w.panel]).toEqual(["log", "tables"]);
});

test("keys: panels by number and tab, ? the overview, n the form, m a row's menu with its keys", () => {
  fresh();
  const v = open({ folder: "/w", overlay: "w1" });
  v.saved = [LITE, PG];
  for (const [k, p] of [["2", "tables"], ["3", "structure"], ["0", "main"], ["4", "log"], ["1", "conns"]]) {
    v.key(key(k), cx);
    expect(v.panel).toBe(p);
  }
  v.key(key("tab"), cx);
  expect(v.panel).toBe("tables");
  v.key(key("tab", { shift: true }), cx);
  v.key(key("j"), cx);
  expect(v.connAt).toBe(1);
  v.key(key("m"), cx);
  expect(v.menu.rows.map((r: any) => [r.label, r.key ?? ""])).toEqual([["Connect", "enter"], ["Test", "t"], ["Edit…", "e"], ["New connection…", "n"], ["Remove…", "d"]]);
  v.key(key("escape"), cx);
  expect(v.menu).toBeNull();
  v.key(key("?"), cx);
  expect(v.help).toBe(true);
  expect(texts(render(v))).toContain("KEYS");
  v.key(key("escape"), cx);
  v.key(key("n"), cx);
  expect(v.form).not.toBeNull();
  expect(v.form.stops().map((s: any) => s.id)).toEqual(["kind", "name", "host", "port", "user", "database", "password", "ask", "readonly", "test", "save", "cancel"]);
  expect(v.form.inputs.get("password").masked).toBe(true);
  v.key(key("escape"), cx);
  expect(v.form).toBeNull();
});

test("the form: a URL pasted into the host fills the fields; a typed password goes to the keychain by security -i, never an argument", async () => {
  fresh();
  const v = open({ folder: "/w", overlay: "w1" });
  await flush();
  v.dir = "/tmp/fireflies-db.abc";
  execReply = () => ({ code: 0, stdout: "", stderr: "" });
  v.key(key("n"), cx);
  v.form.inputs.get("host").set_value("postgres://ada:pa%24s@db.local:6543/lantern");
  v.form.fromUrl();
  expect(["host", "port", "user", "database", "password"].map((f) => v.form.value(f))).toEqual(["db.local", "6543", "ada", "lantern", "pa$s"]);
  await v.form.save(cx);
  const saved = v.saved[0];
  expect(saved).toMatchObject({ kind: "postgres", host: "db.local", port: 6543, secret: "keychain" });
  const kc = written.find(([p]) => p.startsWith("/tmp/fireflies-db.abc/k-"));
  expect(kc?.[1]).toContain(`-a "${saved.id}"`);
  expect(kc?.[1]).toContain('-w "pa$s"');
  for (const argv of execs) expect(argv.join(" ")).not.toContain("pa$s");
  const file = written.find(([p]) => p.endsWith("/data/databases/connections.json"));
  expect(file?.[1]).not.toContain("pa$s");
  expect(JSON.stringify(sharedState)).not.toContain("pa$s");
});

/** A connected view with a query tab holding `sql`, the caret at its start (init's reads done). */
async function withQuery(conn: any, sql: string) {
  const v = open({ folder: "/w", overlay: "w1" });
  await flush();
  v.dir = "/tmp/fireflies-db.abc";
  v.saved = [conn];
  v.active = conn;
  const q = v.addQuery(sql, cx);
  return { v, q };
}

test("a write asks once; a DROP asks, then wants its name typed; nothing runs before", async () => {
  fresh();
  let { v, q } = await withQuery(LITE, "insert into tags(name) values ('x');");
  runQuery(v, q, false, cx);
  expect(v.ask).toMatchObject({ text: "Run insert into on lantern.db?", step: 1 });
  expect(execs.filter((a) => a[3] === "ff-db")).toEqual([]);
  v.key(key("escape"), cx);
  expect(v.ask).toBeNull();

  ({ v, q } = await withQuery(LITE, "drop table if exists tags;"));
  runQuery(v, q, false, cx);
  expect(v.ask.text).toBe("Drop table tags on lantern.db? It can't be undone.");
  v.key(key("y"), cx);
  expect(v.ask.step).toBe(2);
  v.ask.input.set_value("tag");
  v.key(key("enter"), cx);
  expect(v.ask).not.toBeNull(); // the wrong name: still asking
  expect(execs.some((a) => a.includes("ff-db"))).toBe(false);
  v.ask.input.set_value("tags");
  v.key(key("enter"), cx);
  await flush();
  expect(v.ask).toBeNull();
  expect(execs.some((a) => a[0] === "sh" && a[3] === "ff-db")).toBe(true);
});

test("a read-only connection refuses a write in the window; a read runs without asking", async () => {
  fresh();
  const { v, q } = await withQuery({ ...LITE, readonly: true }, "delete from tags where id = 1;");
  runQuery(v, q, false, cx);
  expect(v.ask).toBeNull();
  expect(v.note.text).toContain("is read only");
  q.editor.set_value("select * from tags;");
  runQuery(v, q, false, cx);
  await flush();
  expect(v.ask).toBeNull();
  const ran = execs.find((a) => a[3] === "ff-db");
  expect(ran?.slice(4, 9)).toEqual(["/tmp/fireflies-db.abc", expect.any(String), "sqlite", "/usr/bin/sqlite3", ""]);
  expect(ran).toContain("-readonly");
});

test("ctrl-enter runs from the editor, the selection when there is one; an error lands at its place", async () => {
  fresh();
  const { v, q } = await withQuery(LITE, "select 1;\nselect x\n  from t;");
  execReply = (cmd, args) => {
    if (cmd === "sh" && args[2] === "ff-db") return { code: 1, stdout: "__ff_stmt__ 0\n", stderr: "Parse error near line 4: no such column: x\n  select x   from t;\n         ^--- error here\n" };
    return found(cmd, args);
  };
  q.editor.caret = { line: 1, col: 3 };
  expect(q.editor.keys(key("enter", { control: true }), cx)).toBe(true);
  await flush(); await flush();
  expect(q.outcome.error).toMatchObject({ index: 0, message: "no such column: x", line: 1, col: 8 });
  expect(q.editor.diags[0]).toMatchObject({ line: 1, col: 7, severity: "error", message: "no such column: x" });
  expect(v.log[0]).toMatchObject({ ok: false, said: "no such column: x" });
  // A selection runs only what's selected.
  q.editor.sel = { start: { line: 0, col: 0 }, end: { line: 0, col: 9 }, text: "select 1;" };
  const picked = (await import("../defaults/mods/databases/query.ts")).pickStatements(q, "sqlite", false);
  expect(picked.map((s: any) => s.text)).toEqual(["select 1"]);
});

test("a connection another mod sends opens at once, unsaved, its origin said; a bad one is refused", async () => {
  fresh();
  const w = open({ folder: "/w", overlay: "w1" });
  command(w, `databases.connect:${JSON.stringify({ kind: "postgres", host: "127.0.0.1", port: 15432, name: "postgres :15432", from: "port-forward svc/postgres in prod", readonly: true })}`, cx);
  expect(w.sent[0]).toMatchObject({ kind: "postgres", host: "127.0.0.1", port: 15432, origin: "sent", from: "port-forward svc/postgres in prod", readonly: true });
  expect(w.active?.id).toBe(w.sent[0].id);
  expect(w.saved).toEqual([]);
  expect(texts(render(w))).toEqual(expect.arrayContaining(["sent here", "· port-forward svc/postgres in prod"]));
  command(w, "databases.connect:{\"kind\":\"oracle\"}", cx);
  expect(w.note.text).toContain("isn't a connection");
  // Opened with it in its props (nocturne.databases:{…} or openOverlay elsewhere): the same.
  const p = open({ folder: "/w", overlay: "w2", connect: { kind: "sqlite", path: "/w/a.db", from: "the files pane" } });
  await flush();
  expect(p.sent[0]).toMatchObject({ kind: "sqlite", path: "/w/a.db", name: "/w/a.db", from: "the files pane" });
});

test("an ask-each-time password: masked, in memory, handed to the runner as a one-shot file, never shared or an argument", async () => {
  fresh();
  const v = open({ folder: "/w", overlay: "w1" });
  await flush();
  v.dir = "/tmp/fireflies-db.abc";
  v.saved = [PG];
  v.connectTo(PG, cx);
  expect(v.password).not.toBeNull();
  expect(v.password.input.masked).toBe(true);
  v.password.input.set_value("hunter2");
  v.key(key("enter"), cx);
  await flush(); await flush();
  expect(v.secrets.get("pg-1")).toBe("hunter2");
  expect(written.some(([p, t]) => /\/s-[a-z0-9]+$/.test(p) && t === "hunter2")).toBe(true);
  for (const argv of execs) expect(argv.join(" ")).not.toContain("hunter2");
  expect(JSON.stringify(sharedState)).not.toContain("hunter2");
  await v.close();
  expect(v.secrets.size).toBe(0);
  expect(execs.at(-1)).toEqual(["rm", "-rf", "/tmp/fireflies-db.abc"]);
});

test("a pane keeps its place per slot and finds it again after a restart", () => {
  fresh();
  const v = open({ folder: "/w", slot: "keep1" });
  v.saved = [LITE];
  v.active = LITE;
  v.setPanel("structure");
  expect(JSON.parse(stores.get(JSON.stringify({ folder: "/w", slot: "keep1" }))!.get("copy")!)).toMatchObject({ conn: "sq-1", panel: "structure" });
});

test("grids: the cursor stays in view, the wheel scrolls, numbers go right, a JSON cell reads pretty", async () => {
  const g = await import("../defaults/mods/databases/grid.ts");
  const set = { columns: ["id", "name", "meta"], rows: Array.from({ length: 50 }, (_x, i) => [String(i), `n${i}`, '{"a":[1,2]}']) };
  const cols = g.columnsOf(set);
  expect(cols.map((c: any) => c.num)).toEqual([true, false, false]);
  let at = { row: 0, col: 0, top: 0, left: 0 };
  at = g.moveGrid(at, set, cols, 30, 0, g.rowsIn(222), 800);
  expect(at).toMatchObject({ row: 30, top: 21 });
  at = g.moveGrid(at, set, cols, 1e9, 9, 10, 800);
  expect(at).toMatchObject({ row: 49, col: 2 });
  expect(g.scrollGrid({ row: 0, col: 0, top: 0, left: 0 }, set, cols, 5, 0, 222)).toMatchObject({ top: 5, row: 5 });
  expect(g.prettyValue('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
  expect(g.prettyValue(null)).toBe("NULL");
  expect(g.rowText(set, 1)).toBe('1\tn1\t{"a":[1,2]}');
});
