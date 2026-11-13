// Editing cells in the Databases window, through its keys and handlers, on a
// throwaway SQLite file for real: c (and a double click) edits the cursor's
// cell, enter keeps, esc drops, tab moves on, ctrl-n NULL; the changes stay
// with their rows through pages and sorting; w shows the statements, y saves
// them and the rows are read again; leaving, reading again or closing with
// changes asks first; q types a q while editing; what can't be edited says why.
// herdr and gpui are stand-ins (the elements record what they're asked to
// draw); exec and files are real. Its own process: it stands in for "herdr".
import { test, expect, mock } from "bun:test";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SQLITE = Bun.which("sqlite3") !== null;
const closed: string[] = [];
const commands: [string, any][] = [];
let sharedState: Record<string, unknown> = {};

async function realExec(cmd: string, args: string[] = []) {
  const p = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, stdout, stderr };
}
mock.module("herdr", () => ({
  agents: () => [], appHome: () => "/tmp/herdr-test-none", home: () => "/home/me",
  closeOverlay: (id: string) => { closed.push(id); return null; }, openOverlay: () => "o1",
  exec: realExec, focused: () => null, hc: async () => ({ code: 1, stdout: "" }), keys: () => [], layout: () => null,
  nextCommand: () => new Promise(() => {}), notify: () => null, panes: () => [], props: () => null,
  readTextFile: async () => null,
  writeTextFile: async (p: string, t: string, expected: string | null) => { if (expected === null && existsSync(p)) throw new Error("exists"); writeFileSync(p, t); return null; },
  pickFile: async () => null, pickFolder: async () => null, run: (name: string, args: any) => { commands.push([name, args]); return null; },
  settings: () => ({ zoom: 1, font_family: "Mono" }), shared: (k: string) => sharedState[k] ?? null, setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  spaces: () => [], terminals: () => [], theme: () => theme, window: () => ({ platform: "linux" }),
}));

let drawn: [string, any[]][] = [];
const el: any = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined
    : k === "when" ? (on: unknown, add: (e: unknown) => unknown) => (on ? add(el) : el)
    : k === "map" ? (f: (e: unknown) => unknown) => f(el)
    : (...args: any[]) => { drawn.push([String(k), args]); return el; }),
  apply: () => el,
});
class View {}
mock.module("gpui-kit", () => ({ View, div: () => el, svg: () => el, image: () => el, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
/** An input: its text, its change handler (typing calls it). */
class Input {
  v = ""; handlers: Record<string, Function> = {}; focused = false;
  constructor(o: any = {}) { this.v = o.value ?? ""; }
  on(ev: string, f: Function) { this.handlers[ev] = f; return true; }
  value() { return this.v; } set_value(v: string) { this.v = v; } focus() { this.focused = true; } release() { return true; } set_masked() {}
  type(v: string) { this.v = v; this.handlers.change?.({}, cx); }
}
class Editor { text: string; constructor(o: any) { this.text = o.value ?? ""; } value() { return this.text; } on() { return true; } cursor() { return { line: 0, col: 0 }; } selection() { return { start: { line: 0, col: 0 }, end: { line: 0, col: 0 }, text: "" }; } set_diagnostics() {} focus() {} focused() { return false; } release() { return true; } }
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
  InputState: { new: (o: any) => new Input(o) }, Input: { new: () => el },
  EditorState: { new: (o: any) => new Editor(o) }, Editor: { new: () => el },
}));
(globalThis as any).window = { paint_path: () => el };
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} };
const theme: any = new Proxy({}, { get: (_t, k) => (String(k).startsWith("ansi") ? "#808080" : "#c0c0c0") });
const cx: any = {
  spawn(f: Function) { void f(cx); }, notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {}, is_focused: () => false, release: () => true }),
  timer: { after(_ms: number, f: Function) { f(cx); }, every() {} }, bind_keys() {}, write_to_clipboard() {},
};

const { default: Databases } = await import("../defaults/mods/databases/main.ts");
const { openTable } = await import("../defaults/mods/databases/actions.ts");
const { privateDir } = await import("../defaults/mods/databases/runner.ts");

const dirOf = mkdtempSync(join(tmpdir(), "ff-dbedit-view-"));
const DB = join(dirOf, "lantern.db");
const sql = (q: string) => Bun.spawnSync(["sqlite3", "-separator", "|", "-nullvalue", "NULL", DB, q]).stdout.toString().trim();
const key = (k: string, mods: any = {}) => ({ key: k, key_char: k.length === 1 ? k : undefined, modifiers: { shift: false, control: false, alt: false, platform: false, ...mods } });
const texts = () => drawn.filter(([m]) => m === "child").flatMap(([, a]) => a.filter((x) => typeof x === "string"));
/** Waits until `ok` holds (a run is a real process). */
async function until(ok: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A window connected to the throwaway file, `lanterns` open in the Rows tab. */
async function opened(readonly = false) {
  sharedState = {};
  const v: any = new Databases();
  v.init({ folder: dirOf, overlay: "w1" }, cx);
  await until(() => v.dir !== null);
  v.size = { width: 1100, height: 720 };
  const conn = { id: "sq-1", name: "lantern.db", kind: "sqlite", path: DB, readonly, secret: "none", origin: "saved" };
  v.saved = [conn];
  await v.connectTo(conn, cx);
  await until(() => !v.catalog.busy && v.catalog.tables.length > 0);
  openTable(v, v.catalog.tables.find((t: any) => t.name === "lanterns"), cx);
  await until(() => v.rows.set !== null && v.struct.data !== null && !v.rows.busy);
  v.panel = "main";
  return v;
}
const render = (v: any) => { drawn = []; v.render(); return texts(); };

function seed() {
  Bun.spawnSync(["sqlite3", DB, "drop table if exists lanterns; drop view if exists bright; create table lanterns(id integer primary key, name text not null, lumens integer, note text); "
    + "insert into lanterns(id, name, lumens, note) with recursive n(i) as (select 1 union all select i + 1 from n limit 250) select i, 'lantern ' || i, i * 10, null from n; "
    + "create view bright as select * from lanterns where lumens > 2000;"]);
}

test.skipIf(!SQLITE)("c edits the cursor's cell, enter keeps it staged, nothing written; w shows the statements, y saves them", async () => {
  seed();
  const v = await opened();
  v.key(key("l"), cx); // name
  v.key(key("c"), cx);
  expect(v.cellEdit?.column).toBe("name");
  expect(v.cellEdit.input.value()).toBe("lantern 1");
  v.cellEdit.input.type("it's lit");
  v.key(key("enter"), cx);
  expect(v.cellEdit).toBe(null);
  expect(render(v)).toEqual(expect.arrayContaining(["it's lit", "1 change · not saved", "· 1 change"]));
  expect(sql("select name from lanterns where id = 1")).toBe("lantern 1");
  // The next row: NULL in a column that takes it (ctrl-n), and the key bar's undo.
  v.key(key("j"), cx);
  v.key(key("l"), cx); // lumens
  v.key(key("c"), cx);
  v.key(key("n", { control: true }), cx);
  expect(v.cellEdit.isNull).toBe(true);
  v.key(key("enter"), cx);
  // NOT NULL refuses NULL, the edit stays open.
  v.key(key("h"), cx);
  v.key(key("N"), cx);
  expect(v.note.text).toBe("name: it can't be NULL (NOT NULL)");
  v.key(key("w"), cx);
  expect(v.review.statements.map((s: any) => s.text)).toEqual([
    "BEGIN",
    "UPDATE \"lanterns\" SET \"name\" = 'it''s lit' WHERE \"id\" = 1 AND CAST(\"name\" AS TEXT) = 'lantern 1'",
    "SELECT CASE WHEN changes() = 0 THEN abs(-9223372036854775807 - 1) END AS changed",
    "UPDATE \"lanterns\" SET \"lumens\" = NULL WHERE \"id\" = 2 AND CAST(\"lumens\" AS TEXT) = '20'",
    "SELECT CASE WHEN changes() = 0 THEN abs(-9223372036854775807 - 1) END AS changed",
    "COMMIT",
  ]);
  expect(render(v)).toEqual(expect.arrayContaining(["Save 2 changes to lanterns", "2 rows · one transaction", "id = 1", "id = 2", "esc  back"]));
  v.key(key("y"), cx);
  await until(() => v.review === null && !v.rows.busy);
  expect(sql("select id, name, lumens from lanterns where id <= 2")).toBe("1|it's lit|10\n2|lantern 2|NULL");
  expect(v.edits).toBe(null);
  expect(v.note.text).toBe("saved 2 changes to lanterns");
  expect(v.rows.set.rows[0][1]).toBe("it's lit");
  expect(v.log.map((l: any) => l.said)).toEqual(["saved", "saved"]);
});

test.skipIf(!SQLITE)("esc drops an edit; tab keeps it and edits the next cell; q types a q while editing", async () => {
  seed();
  const v = await opened();
  v.key(key("l"), cx);
  v.key(key("c"), cx);
  v.cellEdit.input.type("Wisp");
  v.key(key("escape"), cx);
  expect([v.cellEdit, v.edits]).toEqual([null, null]);
  v.key(key("c"), cx);
  v.cellEdit.input.type("Wisp");
  v.key(key("tab"), cx);
  expect(v.cellEdit.column).toBe("lumens");
  v.cellEdit.input.type("bright");
  v.key(key("q"), cx);
  expect(closed).toEqual([]);
  // A number column takes a number: refused, the edit stays.
  v.key(key("enter"), cx);
  expect(v.note.text).toBe("lumens: it takes a whole number");
  expect(v.cellEdit.column).toBe("lumens");
  v.cellEdit.input.type("77");
  v.key(key("tab", { shift: true }), cx);
  expect(v.cellEdit.column).toBe("name");
  v.key(key("escape"), cx);
  expect(v.edits.rows.size).toBe(1);
});

test.skipIf(!SQLITE)("a double click edits a table's cell; changes stay with their rows through pages and sorting; u undoes, U discards", async () => {
  seed();
  const v = await opened();
  render(v);
  const at = drawn.findIndex(([m, a]) => m === "id" && a[0] === "rows-grid-c-0-1");
  const press = drawn.slice(at).find(([m, a]) => m === "on_mouse_down" && a[0] === "left")?.[1][1];
  press({ click_count: 2 }, cx);
  expect(v.cellEdit?.column).toBe("name");
  v.cellEdit.input.type("first");
  v.key(key("enter"), cx);
  v.key(key(">"), cx);
  await until(() => !v.rows.busy && v.rows.browse.offset === 200);
  expect(v.rows.set.rows[0][0]).toBe("201");
  v.key(key("<"), cx);
  await until(() => !v.rows.busy && v.rows.browse.offset === 0);
  expect(render(v)).toContain("first");
  // Sorted by id descending, the row is last on page 2: still changed there.
  v.key(key("h"), cx);
  v.key(key("s"), cx);
  await until(() => !v.rows.busy);
  v.key(key("s"), cx);
  await until(() => !v.rows.busy && v.rows.browse.sort?.desc === true);
  v.key(key(">"), cx);
  await until(() => !v.rows.busy && v.rows.browse.offset === 200);
  const last = v.rows.set.rows.length - 1;
  expect(v.rows.set.rows[last][0]).toBe("1");
  v.rows.at = { row: last, col: 1, top: last - 5, left: 0 };
  expect(render(v)).toContain("first");
  v.key(key("u"), cx);
  expect(v.edits.rows.size).toBe(0);
  v.key(key("N"), cx);
  expect(v.note.text).toContain("NOT NULL");
  v.rows.at = { ...v.rows.at, col: 2 };
  v.key(key("N"), cx);
  v.key(key("U"), cx);
  expect(v.menu.title).toBe("Discard 1 change to lanterns?");
  v.key(key("d"), cx);
  expect(v.edits).toBe(null);
});

test.skipIf(!SQLITE)("leaving the table, reading again or closing with changes asks: stay, discard, or save first", async () => {
  seed();
  const v = await opened();
  v.key(key("l"), cx);
  v.key(key("c"), cx);
  v.cellEdit.input.type("Moth");
  v.key(key("enter"), cx);
  v.key(key("r"), cx);
  expect(v.menu.rows.map((r: any) => [r.label, r.key])).toEqual([["Save them, then read it again", "w"], ["Discard them and read it again", "d"], ["Stay", "esc"]]);
  v.key(key("escape"), cx);
  expect([v.menu, v.edits.rows.size]).toEqual([null, 1]);
  v.key(key("escape"), cx); // esc at the top closes the window: asked first
  expect(closed).toEqual([]);
  expect(v.menu.title).toBe("1 change to lanterns aren't saved");
  v.key(key("escape"), cx);
  // Another table: asked; save first, then it opens.
  openTable(v, { schema: null, name: "bright", type: "view", rows: null }, cx);
  v.key(key("w"), cx);
  expect(v.review.table).toBe("lanterns");
  v.key(key("enter"), cx);
  await until(() => v.review === null && v.rows.browse.table.name === "bright" && !v.rows.busy);
  expect(sql("select name from lanterns where id = 1")).toBe("Moth");
  // A view isn't edited: the key says why.
  v.panel = "main";
  v.key(key("c"), cx);
  expect(v.note.text).toBe("bright is a view: its rows aren't edited here");
  // Closing with nothing staged closes at once.
  v.key(key("q"), cx);
  expect(closed).toEqual(["w1"]);
});

test.skipIf(!SQLITE)("a row changed elsewhere: the save stops at its guard, nothing written, the changes stay staged", async () => {
  seed();
  const v = await opened();
  v.key(key("l"), cx);
  v.key(key("c"), cx);
  v.cellEdit.input.type("mine");
  v.key(key("enter"), cx);
  Bun.spawnSync(["sqlite3", DB, "update lanterns set name = 'theirs' where id = 1"]);
  v.key(key("w"), cx);
  v.key(key("y"), cx);
  await until(() => v.review?.busy === false && v.review.error !== null);
  expect(v.review.error).toEqual({ index: 2, message: "id = 1: 0 rows changed: the row was changed elsewhere (or is gone) · nothing was saved" });
  expect(render(v)).toEqual(expect.arrayContaining(["nothing was saved: the changes stay staged", "y  try again"]));
  expect(sql("select name from lanterns where id = 1")).toBe("theirs");
  v.key(key("escape"), cx);
  expect(v.edits.rows.size).toBe(1);
  expect(v.log[0].said).toBe("rolled back");
});

test.skipIf(!SQLITE)("what isn't edited says why: a read-only connection, a query's result, a table without a key (SQLite: by its rowid)", async () => {
  seed();
  const ro = await opened(true);
  ro.key(key("c"), cx);
  expect(ro.note.text).toBe("lantern.db is read only (e on the connection changes that)");
  ro.key(key("w"), cx);
  expect(ro.note.text).toBe("nothing to save: c changes a cell");
  const v = await opened();
  const q = v.addQuery("select 1", cx);
  q.inResults = true;
  q.outcome = { results: [{ index: 0, set: { columns: ["1"], rows: [["1"]] }, affected: null, tag: null }], error: null, cut: false };
  v.key(key("c"), cx);
  expect(v.note.text).toBe("a query's result isn't editable: open its table in [2] to edit its rows");
  // A table without a primary key is read with its rowid, and edited by it.
  Bun.spawnSync(["sqlite3", DB, "create table notes(body text); insert into notes values ('a'), ('b');"]);
  v.mainTab = 0;
  v.refreshCatalog(cx);
  await until(() => v.catalog.tables.some((t: any) => t.name === "notes"));
  openTable(v, v.catalog.tables.find((t: any) => t.name === "notes"), cx);
  await until(() => v.rows.browse.rowid === true && v.rows.set?.columns[0] === "rowid" && !v.rows.busy);
  v.panel = "main";
  v.key(key("c"), cx);
  expect(v.note.text).toBe("the rowid is SQLite's own: it isn't edited");
  v.key(key("l"), cx);
  v.key(key("c"), cx);
  v.cellEdit.input.type("b!");
  v.key(key("enter"), cx);
  v.key(key("w"), cx);
  expect(v.review.statements[1].text).toBe("UPDATE \"notes\" SET \"body\" = 'b!' WHERE \"rowid\" = 1 AND CAST(\"body\" AS TEXT) = 'a'");
});

test("the keys are in ? and the bar: c, N, u in the rows; w and U for the window", async () => {
  const { helpSections, barHints } = await import("../defaults/mods/databases/keys.ts");
  const rows = helpSections("rows");
  expect(rows[0]?.keys).toEqual(expect.arrayContaining([["c", "change the cell (a double click too)"], ["N", "the cell to NULL"], ["u", "undo the cell's change"]]));
  expect(rows[1]?.keys).toEqual(expect.arrayContaining([["w cmd-s ctrl-s", "save the changes (the statements shown first)"], ["U", "discard every change"], ["+ =", "grow the panel (drag a gap; double click: back)"], ["-", "shrink the panel"]]));
  expect(barHints("rows")[0]).toEqual(["c", "change the cell"]);
  void privateDir;
});

test.skipIf(!SQLITE)("databases.set:<text>: fills the edited cell's input, or stages the cursor's cell as typed", async () => {
  seed();
  const v = await opened();
  const { command } = await import("../defaults/mods/databases/opening.ts");
  v.key(key("l"), cx);
  command(v, "databases.set:Harbour", cx);
  expect(v.edits.rows.size).toBe(1);
  v.key(key("l"), cx);
  command(v, "databases.cell-edit", cx);
  command(v, "databases.set:12", cx);
  expect(v.cellEdit.input.value()).toBe("12");
  v.key(key("enter"), cx);
  command(v, "databases.set:lots", cx);
  expect(v.note.text).toBe("lumens: it takes a whole number");
  expect(render(v)).toEqual(expect.arrayContaining(["Harbour", "12", "2 changes · not saved"]));
});
