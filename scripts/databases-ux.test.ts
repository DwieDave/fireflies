// The Databases window, mouse and keyboard first (defaults/mods/databases):
// a grid's columns arranged (widths by } { and by dragging the header's edge,
// hidden, moved; kept per table), sorting (the Rows tab's ORDER BY shown and
// quoted, a result's sort of what came back), a range (shift + arrows, a drag
// across cells, the row numbers, V, cmd-a; esc drops it) copied as TSV, rows
// as JSON / CSV / INSERT, the context menus per target with the keys they
// show (each key does what its row does), names dragged into a query, tabs
// and saved connections dragged to reorder, files dropped on the window, a
// tab renamed, a connection disconnected, duplicated, its address copied (no
// secret). The pure parts directly; the rest through the window's keys and
// handlers on a throwaway SQLite file (lanterns, moths). herdr and gpui are
// stand-ins; exec and files are real. Its own process: it stands in for "herdr".
import { test, expect, mock } from "bun:test";
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SQLITE = Bun.which("sqlite3") !== null;
const HOME = mkdtempSync(join(tmpdir(), "ff-dbux-home-"));
const closed: string[] = [];
const commands: [string, any][] = [];
let sharedState: Record<string, unknown> = {};

async function realExec(cmd: string, args: string[] = []) {
  const p = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, stdout, stderr };
}
mock.module("herdr", () => ({
  agents: () => [], appHome: () => HOME, home: () => "/home/me",
  closeOverlay: (id: string) => { closed.push(id); return null; }, openOverlay: () => "o1",
  exec: realExec, focused: () => null, hc: async () => ({ code: 1, stdout: "" }), keys: () => [], layout: () => null,
  nextCommand: () => new Promise(() => {}), notify: () => null, panes: () => [], props: () => null,
  readTextFile: async (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null),
  writeTextFile: async (p: string, t: string, expected: string | null) => { if (expected === null && existsSync(p)) throw new Error("exists"); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, t); return null; },
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
class Editor { text: string; constructor(o: any) { this.text = o.value ?? ""; } value() { return this.text; } on() { return true; } caretAt: any = null; cursor() { return { line: 0, col: 0 }; } set_cursor(line: number, col: number) { this.caretAt = { line, col }; } selection() { return { start: { line: 0, col: 0 }, end: { line: 0, col: 0 }, text: "" }; } set_diagnostics() {} focus() {} focused() { return false; } release() { return true; } }
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
  InputState: { new: (o: any) => new Input(o) }, Input: { new: () => el },
  EditorState: { new: (o: any) => new Editor(o) }, Editor: { new: () => el },
}));
(globalThis as any).window = { paint_path: () => el };
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} };
let clipboard = "";
const theme: any = new Proxy({}, { get: (_t, k) => (String(k).startsWith("ansi") ? "#808080" : "#c0c0c0") });
const cx: any = {
  spawn(f: Function) { void f(cx); }, notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {}, is_focused: () => false, release: () => true }),
  timer: { after(_ms: number, f: Function) { f(cx); }, every() {} }, bind_keys() {}, write_to_clipboard: (t: string) => { clipboard = t; },
};

const { default: Databases } = await import("../defaults/mods/databases/main.ts");
const { openTable } = await import("../defaults/mods/databases/actions.ts");
const { privateDir } = await import("../defaults/mods/databases/runner.ts");

const dirOf = mkdtempSync(join(tmpdir(), "ff-dbux-"));
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
  v.saved = [conn, { id: "pg-1", name: "moths", kind: "postgres", host: "db.invalid", port: 5433, user: "ada", database: "moths", readonly: false, secret: "keychain", origin: "saved" }];
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
    + "insert into lanterns(id, name, lumens, note) with recursive n(i) as (select 1 union all select i + 1 from n limit 250) select i, 'lantern ' || i, (i * 37) % 100, case when i = 2 then 'tab\there' else null end from n; "
    + "create view bright as select * from lanterns where lumens > 2000;"]);
}

const ux = {
  columns: await import("../defaults/mods/databases/columns.ts"),
  select: await import("../defaults/mods/databases/select.ts"),
  catalog: await import("../defaults/mods/databases/catalog.ts"),
  keys: await import("../defaults/mods/databases/keys.ts"),
  menus: await import("../defaults/mods/databases/menus.ts"),
  grid: await import("../defaults/mods/databases/act-grid.ts"),
  press: await import("../defaults/mods/databases/press.ts"),
  actions: await import("../defaults/mods/databases/actions.ts"),
  drops: await import("../defaults/mods/databases/drops.ts"),
  gridView: await import("../defaults/mods/databases/grid.ts"),
};

const SET = { columns: ["id", "name", "lumens", "note"], rows: [["1", "Wisp", "300", null], ["2", "Ember", "1200", "a\tb"], ["3", "Glim", "75", "say \"hi\""]] };

// ---- the pure parts

test("columns: hidden, moved and sorted; the way back to the rows as read; never every column hidden", () => {
  const { shownOf, moveColumn, hide, showAll, setWidth, withWidths, NO_LAYOUT, compareCells } = ux.columns;
  let l = hide(NO_LAYOUT, SET.columns, "name")!;
  l = moveColumn(l, SET.columns, "note", "id");
  const s = shownOf(SET, l, null);
  expect(s.set.columns).toEqual(["note", "id", "lumens"]);
  expect(s.cols).toEqual([3, 0, 2]);
  expect(s.hidden).toBe(1);
  expect(s.set.rows[1]).toEqual(["a\tb", "2", "1200"]);
  // Numbers sort as numbers, NULL last both ways.
  const up = shownOf(SET, NO_LAYOUT, { column: "lumens", desc: false }, (i) => i === 2 || i === 0);
  expect(up.set.rows.map((r) => r[2])).toEqual(["75", "300", "1200"]);
  expect(up.rows).toEqual([2, 0, 1]);
  const notes = shownOf(SET, NO_LAYOUT, { column: "note", desc: true });
  expect(notes.set.rows.map((r) => r[3])).toEqual(["say \"hi\"", "a\tb", null]);
  expect(compareCells(null, "a", false)).toBe(1);
  // The last column shown stays.
  let only = NO_LAYOUT;
  for (const c of ["id", "name", "lumens"]) only = hide(only, SET.columns, c)!;
  expect(hide(only, SET.columns, "note")).toBe(null);
  expect(showAll(only).hidden).toEqual([]);
  // Widths by name, clamped.
  const w = setWidth(NO_LAYOUT, "name", 5000);
  expect(w.widths).toEqual({ name: 900 });
  expect(withWidths([{ name: "name", num: false, ch: 4 }], w)[0]).toEqual({ name: "name", num: false, ch: 4, px: 900 });
  expect(setWidth(w, "name", null).widths).toEqual({});
  // A result with two columns of one name: each found in turn.
  const twice = shownOf({ columns: ["id", "id"], rows: [["1", "2"]] }, moveColumn(NO_LAYOUT, ["id", "id"], "id", null), null);
  expect(twice.cols.slice().sort()).toEqual([0, 1]);
});

test("columns: a table's arrangement kept in shared state by connection and table, the newest 200", () => {
  const { keepLayout, keptLayout, tableKey, NO_LAYOUT, setWidth, KEEP_MAX } = ux.columns;
  sharedState = {};
  const k = tableKey("sq-1", null, "lanterns");
  keepLayout(k, { ...setWidth(NO_LAYOUT, "name", 210), hidden: ["note"], order: [] }, 1);
  expect(keptLayout(k)).toEqual({ widths: { name: 210 }, hidden: ["note"], order: [] });
  expect(keptLayout(tableKey("sq-1", "public", "lanterns"))).toEqual(NO_LAYOUT);
  for (let i = 0; i < KEEP_MAX + 5; i++) keepLayout(`t${i}`, setWidth(NO_LAYOUT, "a", 50), 10 + i);
  expect(Object.keys(sharedState["databases.columns"] as object).length).toBe(KEEP_MAX);
  expect(keptLayout(k)).toEqual(NO_LAYOUT);
  // A plain arrangement is forgotten; a bad entry reads as none.
  keepLayout("t300", NO_LAYOUT, 999);
  expect("t300" in (sharedState["databases.columns"] as object)).toBe(false);
  sharedState = { "databases.columns": { x: { at: 1, widths: [{ name: 3 }] } } };
  expect(keptLayout("x")).toEqual(NO_LAYOUT);
});

test("the ORDER BY: the page's statement says it, quoted for each engine; the line shows the same", () => {
  const { browseSql, orderSql } = ux.catalog;
  const b = { table: { schema: "public", name: "lanterns" }, sort: { column: 'lu"mens', desc: true }, filter: "", offset: 0, limit: 100 };
  expect((browseSql("postgres", b) as any).statements[0].text).toBe('select * from "public"."lanterns" order by "lu""mens" desc limit 100 offset 0');
  expect((browseSql("mysql", { ...b, sort: { column: "lu`mens", desc: false } }) as any).statements[0].text).toBe("select * from `public`.`lanterns` order by `lu``mens` asc limit 100 offset 0");
  expect(orderSql("sqlite", { column: "name", desc: false })).toBe('order by "name" asc');
});

test("a range copied: one cell as it is, a range as TSV (tabs, breaks and quotes quoted), rows in each format", () => {
  const { copied, rangeOf, stretched, everything, rowsSelected, hasRange, unselected, rowsOf } = ux.select;
  const at = { row: 0, col: 1, top: 0, left: 0 };
  expect(copied(SET, rangeOf(at))).toBe("Wisp");
  expect(copied(SET, rangeOf({ ...at, col: 3 }))).toBe("");
  const r = stretched(at, 2, 3);
  expect(hasRange(r)).toBe(true);
  expect(copied(SET, rangeOf(r))).toBe('Wisp\t300\tNULL\nEmber\t1200\t"a\tb"\nGlim\t75\t"say ""hi"""');
  expect(copied(SET, rangeOf(r), true).split("\n")[0]).toBe("name\tlumens\tnote");
  expect(rangeOf(everything(at, SET))).toEqual({ r0: 0, r1: 2, c0: 0, c1: 3 });
  expect(rangeOf(rowsSelected(at, SET, 2, 1))).toEqual({ r0: 1, r1: 2, c0: 0, c1: 3 });
  expect(hasRange(unselected(r))).toBe(false);
  expect(rowsOf(SET, [1], ["note"])).toEqual({ columns: ["id", "name", "lumens"], rows: [["2", "Ember", "1200"]] });
});

test("the wheel: down and up by rows, sideways by a column, shift turns it sideways", () => {
  const { wheelStep } = ux.gridView;
  expect(wheelStep(0, -60, false)).toEqual([3, 0]);
  expect(wheelStep(-30, 2, false)).toEqual([0, 1]);
  expect(wheelStep(0, -60, true)).toEqual([0, 1]);
  expect(wheelStep(0, 40, true)).toEqual([0, -1]);
});

test("files dropped: a SQLite file is a connection, a .sql file a query tab, anything else says so", () => {
  const { droppedAs } = ux.drops;
  expect(["/a/x.db", "/a/x.sqlite3", "/a/x.DB3", "/a/q.sql", "/a/x.csv"].map(droppedAs)).toEqual(["sqlite", "sqlite", "sqlite", "sql", null]);
});

test("the key tables: no key twice in a place (but esc's fall-through), the new grid keys, nothing a field types", () => {
  const { BINDINGS, actionsFor, keyOf } = ux.keys;
  for (const [place, list] of Object.entries(BINDINGS)) {
    const seen = new Map<string, string>();
    for (const [keys, , a] of list as any[]) for (const k of keys) {
      if (seen.has(k) && k !== "escape") throw new Error(`${place}: ${k} is ${seen.get(k)} and ${a}`);
      seen.set(k, a);
    }
  }
  for (const place of ["rows", "results"] as const) {
    expect(["o", "O", "{", "}", "H", "V", "T", "m", "cmd-a", "cmd-c", "shift-down"].map((k) => actionsFor(place, k)[0]))
      .toEqual(["sort", "column-menu", "narrower", "wider", "hide", "select-row", "tab-menu", "menu", "select-all", "copy", "select-down"]);
  }
  expect(actionsFor("results", "escape")).toEqual(["unselect", "edit"]);
  expect(actionsFor("rows", "s")).toEqual(["sort"]);
  expect(keyOf("conns", "menu")).toBe("m");
  expect(keyOf("rows", "query-new")).toBe("ctrl-n");
  expect(keyOf("rows", "select-down")).toBe("shift-↓");
  for (const place of ["conns", "tables", "structure", "rows", "results", "log"] as const) expect(keyOf(place, "menu")).toBe("m");
});

test.skipIf(!SQLITE)("o sorts the table by ORDER BY (shown on the WHERE line), a header's click too; a result sorts what came back, said as such", async () => {
  seed();
  const v = await opened();
  v.key(key("l"), cx); v.key(key("l"), cx); // lumens
  v.key(key("o"), cx);
  await until(() => !v.rows.busy && v.rows.browse.sort !== null);
  expect(v.rows.browse.sort).toEqual({ column: "lumens", desc: false });
  expect(v.rows.set.rows.slice(0, 4).map((r: any) => r[2])).toEqual(["0", "0", "1", "1"]);
  expect(render(v)).toEqual(expect.arrayContaining(["order by", '"lumens" asc']));
  v.key(key("s"), cx);
  await until(() => !v.rows.busy && v.rows.browse.sort?.desc === true);
  expect(v.rows.set.rows[0][2]).toBe("99");
  // A header's click (a press released where it started): the next step, off.
  const g = ux.grid.shownGrid(v);
  ux.press.pressAt(v, { position: { x: 100, y: 10 } }, { kind: "column", takes: ["col:"], click: (x: any) => ux.grid.sortColumn(v, g!.set.columns[2], x) });
  ux.press.pressUp(v, cx);
  await until(() => !v.rows.busy && v.rows.browse.sort === null);
  expect(render(v)).not.toContain("order by");
  // A query's result: its own sort, NULL last, the header marked and the line saying it's here.
  const q = v.addQuery("select id, note from lanterns where id <= 3 order by id;", cx);
  const { runQuery } = await import("../defaults/mods/databases/query.ts");
  runQuery(v, q, false, cx);
  await until(() => q.outcome !== null && !q.running);
  q.inResults = true;
  v.key(key("l"), cx);
  v.key(key("o"), cx); v.key(key("o"), cx);
  expect(q.sort).toEqual({ column: "note", desc: true });
  const shown = ux.grid.shownGrid(v)!;
  expect(shown.set.rows.map((r: any) => r[0])).toEqual(["2", "1", "3"]);
  expect(render(v)).toContain("sorted here by note ↓");
  expect(q.outcome.results[0].set.rows.map((r: any) => r[0])).toEqual(["1", "2", "3"]);
});

test.skipIf(!SQLITE)("widths: } and { step the cursor's column, a drag on the header's edge sets it, a double click fits it; kept for the table", async () => {
  seed();
  sharedState = {};
  let v = await opened();
  v.key(key("l"), cx);
  const before = ux.gridView.colWidth(ux.grid.shownGrid(v)!.cols[1]);
  v.key(key("}"), cx); v.key(key("}"), cx); v.key(key("{"), cx);
  expect(ux.grid.shownGrid(v)!.cols[1].px).toBe(before + 24);
  // The header's edge dragged 80 px right (zoom 1): live, kept on release.
  const h = (v as any);
  const e = { position: { x: 300, y: 50 }, local_position: { x: before + 20, y: 4 }, click_count: 1, modifiers: { shift: false } };
  ux.press.pressAt(h, e, { kind: "width", takes: [], move: (dx: number) => { const g = ux.grid.shownGrid(v)!; g.arrange(ux.columns.setWidth(g.layout, "name", before + 24 + dx), false); }, drop: () => { const g = ux.grid.shownGrid(v)!; g.arrange(g.layout, true); } });
  ux.press.pressMove(h, { position: { x: 380, y: 50 } }, cx);
  ux.press.pressUp(h, cx);
  expect(ux.grid.shownGrid(v)!.cols[1].px).toBe(before + 104);
  expect((sharedState["databases.columns"] as any)["sq-1//lanterns"].widths).toEqual([{ name: "name", px: before + 104 }]);
  // The next window on the same table has it.
  const kept = sharedState;
  v = await opened();
  sharedState = kept;
  v.columnsAt = null;
  expect(ux.grid.shownGrid(v)!.cols[1].px).toBe(before + 104);
  ux.grid.fitColumn(ux.grid.shownGrid(v)!, 1);
  expect(ux.grid.shownGrid(v)!.cols[1].px).toBe(undefined);
});

test.skipIf(!SQLITE)("H hides a column, its menu shows it again; an edit after it lands on the right column", async () => {
  seed();
  sharedState = {};
  const v = await opened();
  v.key(key("l"), cx);
  v.key(key("H"), cx);
  const g = ux.grid.shownGrid(v)!;
  expect(g.set.columns).toEqual(["id", "lumens", "note"]);
  expect(v.note.text).toBe("name hidden · the column's menu (O) shows it again");
  expect(render(v)).toContain("1 hidden · show");
  // The cursor's column is lumens now: c edits lumens, staged by the row's id.
  v.key(key("c"), cx);
  expect(v.cellEdit.column).toBe("lumens");
  v.cellEdit.input.type("7");
  v.key(key("enter"), cx);
  v.key(key("w"), cx);
  expect(v.review.statements[1].text).toContain('SET "lumens" = 7 WHERE "id" = 1');
  v.key(key("escape"), cx);
  v.key(key("U"), cx);
  v.key(key("d"), cx);
  // O: the column's menu, with the hidden one back.
  v.key(key("O"), cx);
  const show = v.menu.rows.find((r: any) => r.label.startsWith("Show every column"));
  expect(show.label).toBe("Show every column (1 hidden)");
  show.go();
  v.menu = null;
  expect(ux.grid.shownGrid(v)!.set.columns).toEqual(["id", "name", "lumens", "note"]);
  // Never the last one.
  for (const c of [0, 0, 0]) { ux.grid.hideColumn(v, ux.grid.shownGrid(v)!, c); }
  ux.grid.hideColumn(v, ux.grid.shownGrid(v)!, 0);
  expect(ux.grid.shownGrid(v)!.set.columns).toEqual(["note"]);
  expect(v.note.text).toBe("the last column shown stays");
});

test.skipIf(!SQLITE)("a column dragged onto another header takes its place; dragged into a query, its quoted name goes in", async () => {
  seed();
  sharedState = {};
  const v = await opened();
  const g = ux.grid.shownGrid(v)!;
  ux.press.pressAt(v, { position: { x: 0, y: 0 } }, { kind: "column", label: "id", takes: ["col:"], drop: (to: any) => ux.grid.moveTo(ux.grid.shownGrid(v)!, 0, to === "col:2" ? 3 : null) });
  ux.press.overTarget(v, "col:2");
  ux.press.pressMove(v, { position: { x: 60, y: 0 } }, cx);
  expect(v.press.target).toBe("col:2");
  ux.press.pressUp(v, cx);
  expect(ux.grid.shownGrid(v)!.set.columns).toEqual(["name", "lumens", "id", "note"]);
  expect(v.rows.at.col).toBe(2);
  void g;
});

test.skipIf(!SQLITE)("a range: shift + arrows, a drag across cells, the row numbers, V, cmd-a; cmd-c copies TSV; esc drops it before it closes", async () => {
  seed();
  sharedState = {};
  const v = await opened();
  v.key(key("down", { shift: true }), cx);
  v.key(key("right", { shift: true }), cx);
  v.key(key("c", { platform: true }), cx);
  expect(clipboard).toBe("1\tlantern 1\n2\tlantern 2");
  expect(v.note.text).toBe("copied 2 lines");
  v.key(key("escape"), cx);
  expect(v.rows.at.anchor).toBe(null);
  expect(closed).toEqual([]);
  // A drag from a cell across others (the cells hear the pointer before the view).
  const shown = ux.grid.shownGrid(v)!;
  void shown;
  v.rows.at = { ...v.rows.at, row: 1, col: 1 };
  ux.press.pressAt(v, { position: { x: 0, y: 0 } }, { kind: "cells", takes: ["cell:"], over: (to: string) => { const m = /cell:(\d+):(\d+)/.exec(to)!; v.rows.at = { ...v.rows.at, anchor: { row: 1, col: 1 }, row: Number(m[1]), col: Number(m[2]) }; } });
  ux.press.overTarget(v, "cell:2:3");
  ux.press.pressMove(v, { position: { x: 90, y: 30 } }, cx);
  ux.press.pressUp(v, cx);
  v.key(key("y"), cx);
  expect(clipboard).toBe("lantern 2\t74\t\"tab\there\"\nlantern 3\t11\tNULL");
  // V: whole rows; Y copies them; cmd-a everything.
  v.key(key("V"), cx);
  v.key(key("Y"), cx);
  expect(clipboard.split("\n")).toEqual(["2\tlantern 2\t74\t\"tab\there\"", "3\tlantern 3\t11\tNULL"]);
  v.key(key("a", { platform: true }), cx);
  expect(ux.select.rangeOf(v.rows.at)).toEqual({ r0: 0, r1: v.rows.set.rows.length - 1, c0: 0, c1: 3 });
  v.key(key("escape"), cx);
  v.key(key("escape"), cx);
  expect(closed).toEqual(["w1"]);
  closed.length = 0;
});

test.skipIf(!SQLITE)("the menus: each target's rows, and each key a row shows does what the row does where it opened", async () => {
  seed();
  sharedState = {};
  const v = await opened();
  const check = (place: string) => {
    for (const r of v.menu.rows) if (r.key) expect([place, r.label, ux.keys.actionsFor(place as any, r.key === "esc" ? "escape" : r.key.replace("↓", "down"))]).toEqual([place, r.label, expect.arrayContaining([r.act])]);
  };
  const labels = () => v.menu.rows.map((r: any) => r.label);
  // A cell: edit, value, copies, filter by it, sort, the column's menu, export.
  v.key(key("l"), cx);
  v.key(key("m"), cx);
  expect(labels()).toEqual(["Change name…", "Set it NULL", "Its whole value", "Copy the value", "Select every cell", "Copy the row", "Copy the row as JSON", "Copy the row as CSV", "Copy the row as INSERT", "Filter by this value", "Sort by name", "name's menu…", "Export…"]);
  check("rows");
  v.menu.rows.find((r: any) => r.label === "Copy the row as INSERT").go();
  expect(clipboard).toBe(`INSERT INTO "lanterns" ("id", "name", "lumens", "note") VALUES (1, 'lantern 1', 37, NULL);\n`);
  v.key(key("m"), cx);
  v.menu.rows.find((r: any) => r.label === "Copy the row as JSON").go();
  expect(JSON.parse(clipboard)).toEqual([{ id: 1, name: "lantern 1", lumens: 37, note: null }]);
  v.key(key("m"), cx);
  v.menu.rows.find((r: any) => r.label === "Filter by this value").go();
  await until(() => !v.rows.busy && v.rows.browse.filter !== "");
  expect(v.rows.browse.filter).toBe(`"name" = 'lantern 1'`);
  expect(v.rows.set.rows.length).toBe(1);
  // The column's menu (O): its sort with s on the next step, hide, widths, its name.
  v.key(key("O"), cx);
  expect(labels()).toEqual(["Sort ascending (ORDER BY … asc)", "Sort descending (ORDER BY … desc)", "Not sorted  ✓", "Filter by this column…", "Hide it", "Wider", "Narrower", "Its name into the query", "Copy its name"]);
  expect(v.menu.rows[0].key).toBe("o");
  check("rows");
  v.menu = null;
  // The tab's menu (T) on the Rows tab.
  v.key(key("T"), cx);
  expect(labels()).toEqual(["Read it again", "Clear the filter", "Export…", "Select it in a query", "New query tab", "History…"]);
  check("rows");
  v.menu.rows[1].go();
  await until(() => !v.rows.busy && v.rows.browse.filter === "");
  // A row's number.
  ux.menus.rowMenu(v, 2, cx);
  expect(labels()).toEqual(["Select it", "Copy the row", "Copy the row as JSON", "Copy the row as CSV", "Copy the row as INSERT"]);
  check("rows");
  v.menu = null;
  // A table, a view: the destructive ones only through a run (asked twice).
  v.panel = "tables";
  v.key(key("m"), cx);
  expect(labels()).toEqual(["Rows and structure", "Select it in a query", "Count its rows", "Its name into the query", "Copy its name", "Export…", "Empty it…", "Drop it…"]);
  check("tables");
  const empty = v.menu.rows.find((r: any) => r.label === "Empty it…");
  v.menu = null;
  empty.go();
  expect(v.ask.verdict.risk).toBe("destructive");
  expect(v.shownQuery().editor.value()).toBe('delete from "lanterns";');
  v.key(key("escape"), cx);
  expect(sql("select count(*) from lanterns")).toBe("250");
  v.panel = "tables";
  v.key(key("]"), cx);
  expect(v.tablesTab).toBe("views");
  v.key(key("m"), cx);
  expect(v.menu.title).toBe("bright · view");
  expect(labels().at(-1)).toBe("Drop the view…");
  expect(labels()).not.toContain("Empty it…");
  v.menu = null;
  // A connection: disconnect when it's the one, its address (no secret), duplicate.
  v.panel = "conns";
  v.connAt = 0;
  v.key(key("m"), cx);
  expect(labels()).toEqual(["Disconnect", "Test", "Edit…", "Duplicate…", "Copy its address", "New connection…", "Unpin it…"]);
  check("conns");
  v.menu = null;
  v.connAt = 1;
  v.key(key("y"), cx);
  expect(clipboard).toBe("postgresql://ada@db.invalid:5433/moths");
  v.key(key("D"), cx);
  expect([v.form.editing.name, v.form.editing.secret, v.form.value("password"), v.form.value("host")]).toEqual(["moths copy", "none", "", "db.invalid"]);
  v.form = null;
  // The log: a line's menu.
  v.logLine({ sql: "select * from moths", ok: false, ms: 1, said: "no such table: moths", conn: "lantern.db" });
  v.panel = "log";
  v.key(key("m"), cx);
  expect(labels()).toEqual(["Into a query tab", "Copy the statement", "Copy what it said"]);
  check("log");
  v.menu = null;
  // A query tab's menu: run, rename, duplicate, close, the others.
  const q = v.queries[0];
  ux.menus.tabMenu(v, 1, cx);
  expect(labels()).toEqual(["Run the statement", "Run every statement", "Rename…", "Duplicate", "Close", "Close the others", "New query tab", "History…"]);
  expect(v.menu.rows[0].key).toBe("ctrl-enter");
  v.menu = null;
  void q;
});

test.skipIf(!SQLITE)("a menu by right click stands at the press (the view's origin learned from its moves); by key at the cursor's cell", async () => {
  seed();
  const v = await opened();
  render(v);
  // The root's move handler (dividers.ts tracking: the first one registered) learns where the view
  // sits in the window: a window overlay 60 px in and 40 px down.
  const rootMove = drawn.find(([m]) => m === "on_mouse_move")?.[1].at(-1);
  rootMove({ position: { x: 300, y: 200 }, local_position: { x: 240, y: 160 }, modifiers: {} }, cx);
  expect(v.origin).toEqual({ x: 60, y: 40 });
  // A press far from where the root last heard the pointer: the menu stands at the press.
  ux.menus.atPointer(v, () => ux.menus.cellMenu(v, 0, 0, cx), { position: { x: 560, y: 400 } });
  expect(v.menu.near).toEqual({ x: 500, y: 360 });
  v.menu = null;
  // Every right press drawn passes its press: each menu it opens stands there.
  render(v);
  const rights = drawn.filter(([m, a]) => m === "on_mouse_down" && a[0] === "right").map(([, a]) => a.at(-1));
  let menus = 0;
  for (const press of rights) {
    v.menu = null;
    press({ button: "right", click_count: 1, position: { x: 760, y: 520 }, modifiers: {} }, cx);
    if (!v.menu) continue;
    menus++;
    expect(v.menu.near).toEqual({ x: 700, y: 480 });
  }
  // The panels' rows, the query tabs, the grid's header, cells and row numbers.
  expect(menus).toBeGreaterThan(6);
  v.menu = null;
  // By key, the main panel with the keys: under the cursor's cell (the Rows tab: under the filter
  // line), found as the menu is drawn (a window resized since moves it with the cell).
  const anchor = await import("../defaults/mods/databases/menu-anchor.ts");
  const popups = await import("../defaults/mods/databases/popups.ts");
  v.panel = "main";
  v.rows.at = { row: 0, col: 0, top: 0, left: 0 };
  v.key(key("m"), cx);
  expect(v.menu.near).toBe(null);
  const left = 6 + 330 + 6 + 1;
  const first = { x: left + ux.gridView.gutterWidth(v.rows.set.rows.length), y: 34 + 12 + 7 + 24 + 22, w: ux.gridView.colWidth(ux.grid.shownGrid(v).cols[0]), h: 20 };
  expect(anchor.keyedAnchor(v)).toEqual(first);
  const drawnAt = () => {
    drawn = [];
    popups.menuLayer({}, v);
    const i = drawn.findIndex(([m, a]) => m === "id" && a[0] === "db-menu-box");
    const after = drawn.slice(i);
    return { x: after.find(([m]) => m === "left")?.[1][0], y: after.find(([m]) => m === "top")?.[1][0] };
  };
  expect(drawnAt()).toEqual({ x: Math.round(first.x), y: first.y + 20 });
  // The window wider (the left column with it): the menu follows the cell.
  v.size = { width: 1600, height: 720 };
  expect(drawnAt().x).toBe(Math.round(6 + 400 + 6 + 1 + ux.gridView.gutterWidth(v.rows.set.rows.length)));
  v.size = { width: 1100, height: 720 };
  v.menu = null;
  // The cursor two rows down and a column on: the cell moved with it.
  v.rows.at = { row: 2, col: 1, top: 0, left: 0 };
  expect(anchor.keyedAnchor(v).y).toBe(34 + 12 + 7 + 24 + 22 + 40);
  expect(anchor.keyedAnchor(v).x).toBe(left + ux.gridView.gutterWidth(v.rows.set.rows.length) + ux.gridView.colWidth(ux.grid.shownGrid(v).cols[0]));
  // Another panel with the keys: the middle.
  v.panel = "log";
  v.logLine({ sql: "select 1", ok: true, ms: 1, said: "", conn: "lantern.db" });
  v.key(key("m"), cx);
  expect(v.menu.near).toBe(null);
  expect(anchor.keyedAnchor(v)).toBe(null);
  v.menu = null;
  // The head mark's menu (connmark.ts): C with the grid's keys stands in the middle, not at the cell;
  // a click on the mark (a click carries no position) at the pointer as the root last heard it.
  v.panel = "main";
  v.key(key("C"), cx);
  expect(v.menu.title).toContain("lantern.db");
  expect(v.menu.cell).toBe(false);
  expect(v.menu.near).toBe(null);
  v.menu = null;
  const mark = await import("../defaults/mods/databases/connmark.ts");
  v.pointer = { x: 120, y: 18 };
  ux.menus.atPointer(v, () => mark.stateMenu(v, cx));
  expect(v.menu.near).toEqual({ x: 120, y: 18 });
});

test.skipIf(!SQLITE)("drags: a table's name into the query (quoted), onto the Rows tab it opens; a query tab and a saved connection to another place", async () => {
  seed();
  sharedState = {};
  const v = await opened();
  // A new tab's caret is after its text (a name dropped goes there).
  const q = v.addQuery("select *\nfrom ", cx);
  expect(q.editor.caretAt).toEqual({ line: 1, col: 5 });
  q.editor.cursor = () => ({ line: 0, col: 14 });
  let put = "";
  q.editor.edit = (e: any[]) => { put = e[0].text; };
  q.editor.set_cursor = () => {};
  const t = v.catalog.tables.find((x: any) => x.name === "lanterns");
  const press = () => ux.press.pressAt(v, { position: { x: 0, y: 0 } }, { kind: "name", label: '"lanterns"', takes: ["editor:", "tab:0"], drop: (to: any, x: any) => { if (to?.startsWith("editor:")) ux.actions.insertName(v, '"lanterns"', x); else if (to === "tab:0") ux.actions.openTable(v, t, x); } });
  press();
  // Over nothing: no drop.
  ux.press.pressMove(v, { position: { x: 30, y: 30 } }, cx);
  ux.press.pressUp(v, cx);
  expect(put).toBe("");
  press();
  ux.press.overTarget(v, `editor:${q.id}`);
  ux.press.pressMove(v, { position: { x: 30, y: 30 }, local_position: { x: 40, y: 50 } }, cx);
  expect(render(v)).toContain('"lanterns"');
  ux.press.pressUp(v, cx);
  expect(put).toBe('"lanterns"');
  // A press that never moved is no drag.
  press();
  ux.press.overTarget(v, `editor:${q.id}`);
  ux.press.pressMove(v, { position: { x: 1, y: 1 } }, cx);
  ux.press.pressUp(v, cx);
  expect(v.press).toBe(null);
  // Query tabs: the third onto the first's place.
  v.queries = [];
  for (const n of ["a", "b", "c"]) v.addQuery(n, cx).name = n;
  const { moveQuery } = await import("../defaults/mods/databases/main-view.ts");
  moveQuery(v, 3, /^tab:(\d+)$/.exec("tab:1"));
  expect([v.queries.map((x: any) => x.name), v.mainTab]).toEqual([["c", "a", "b"], 1]);
  moveQuery(v, 1, /^tab:(\d+)$/.exec("tab:3"));
  expect(v.queries.map((x: any) => x.name)).toEqual(["a", "b", "c"]);
  // A saved connection: J moves it down, kept in connections.json (the file is the truth: it holds them).
  mkdirSync(join(HOME, "data/databases"), { recursive: true });
  writeFileSync(join(HOME, "data/databases/connections.json"), JSON.stringify({ connections: v.saved.map(({ origin, ...c }: any) => c) }));
  v.panel = "conns";
  v.connAt = 0;
  v.key(key("J"), cx);
  await until(() => existsSync(join(HOME, "data/databases/connections.json")));
  expect(v.saved.map((c: any) => c.name)).toEqual(["moths", "lantern.db"]);
  expect(v.connAt).toBe(1);
  await until(() => JSON.parse(readFileSync(join(HOME, "data/databases/connections.json"), "utf8")).connections[0].name === "moths");
  expect(readFileSync(join(HOME, "data/databases/connections.json"), "utf8")).not.toContain("password");
});

test.skipIf(!SQLITE)("files dropped on the window: a SQLite file connects (not saved), a .sql file opens in a tab (not run)", async () => {
  seed();
  const v = await opened();
  const file = join(dirOf, "moths.sql");
  writeFileSync(file, "delete from lanterns;");
  const { dropFiles } = ux.drops;
  dropFiles(v, ["/x/notes.txt"], cx);
  expect(v.note.text).toBe("only a SQLite file (.db, .sqlite, .sqlite3, .db3) or a .sql file opens here");
  dropFiles(v, [file], cx);
  await until(() => v.queries.some((q: any) => q.name === "moths"));
  expect(v.shownQuery().editor.value()).toBe("delete from lanterns;");
  expect(v.ask).toBe(null);
  expect(sql("select count(*) from lanterns")).toBe("250");
  dropFiles(v, [DB], cx);
  expect(v.sent[0]).toMatchObject({ kind: "sqlite", path: DB, origin: "sent", from: "dropped here" });
  await until(() => !v.catalog.busy && v.active?.origin === "sent");
  expect(v.catalog.tables.map((t: any) => t.name)).toContain("lanterns");
});

test.skipIf(!SQLITE)("a tab renamed (a double click, its menu): enter keeps it, esc leaves it, the window's keys type in it", async () => {
  seed();
  const v = await opened();
  const q = v.addQuery("", cx);
  ux.menus.startRename(v, q);
  for (const k of ["o", "O", "q", "{", "H", "?", "1"]) expect(v.key(key(k), cx)).toBe(undefined);
  const { modalKey } = await import("../defaults/mods/databases/popups.ts");
  expect(["o", "O", "{", "}", "H", "V", "T", "m", "q", "1"].map((k) => modalKey(v, key(k), cx))).toEqual(Array(10).fill("typing"));
  v.rename.input.set_value("lumens by night");
  modalKey(v, key("enter"), cx);
  expect([q.name, v.rename]).toEqual(["lumens by night", null]);
  ux.menus.startRename(v, q);
  v.rename.input.set_value("nope");
  modalKey(v, key("escape"), cx);
  expect(q.name).toBe("lumens by night");
  // The grid's new keys type in the filter and the cell edit too.
  v.panel = "main";
  v.mainTab = 0;
  ux.grid.openFilter(v);
  expect(["o", "O", "{", "}", "H", "V", "T"].map((k) => modalKey(v, key(k), cx))).toEqual(Array(7).fill("typing"));
});

test.skipIf(!SQLITE)("disconnect: the tables close, the query tabs stay; changes not saved ask first", async () => {
  seed();
  const v = await opened();
  v.key(key("c"), cx);
  v.cellEdit.input.type("99");
  v.key(key("enter"), cx);
  v.panel = "conns";
  v.connAt = 0;
  v.key(key("x"), cx);
  expect(v.active).not.toBe(null);
  expect(v.menu.title).toContain("aren't saved");
  v.menu = null;
  v.key(key("U"), cx);
  v.key(key("d"), cx);
  const tabs = v.queries.length;
  v.key(key("x"), cx);
  expect([v.active, v.catalog.tables.length, v.rows.browse, v.queries.length]).toEqual([null, 0, null, tabs]);
  expect(v.note.text).toBe("disconnected from lantern.db");
  v.key(key("x"), cx);
  expect(v.note.text).toBe("nothing is connected");
});

test.skipIf(!SQLITE)("a sorted column is at least as wide as its name and mark, however far { narrows it", async () => {
  seed();
  sharedState = {};
  const v = await opened();
  v.key(key("l"), cx); v.key(key("l"), cx); // lumens
  for (let i = 0; i < 12; i++) v.key(key("{"), cx);
  const narrow = ux.grid.shownGrid(v)!.cols[2];
  expect(ux.gridView.colWidth(narrow)).toBe(36);
  v.key(key("o"), cx);
  await until(() => !v.rows.busy && v.rows.browse.sort !== null);
  const least = ux.gridView.sortedWidth("lumens");
  expect(ux.gridView.colWidth(ux.grid.shownGrid(v)!.cols[2])).toBe(least);
  v.key(key("{"), cx);
  expect(v.note.text).toBe("it's as narrow as it gets");
  expect(ux.gridView.colWidth(ux.grid.shownGrid(v)!.cols[2])).toBe(least);
  // Its least width is no dragged one: fitting is offered only for that.
  ux.grid.fitColumn(ux.grid.shownGrid(v)!, 2);
  v.key(key("O"), cx);
  expect(v.menu.rows.map((r: any) => r.label)).not.toContain("Fit it to its cells");
  v.menu = null;
  expect(ux.gridView.colWidth(ux.grid.shownGrid(v)!.cols[2])).toBe(least);
});

test("a menu's shortcuts: a row with its own key shows that alone, the others take 1-9 in order; a digit picks among those", async () => {
  const { digitsOf } = await import("../defaults/mods/databases/popups.ts");
  const rows = [{ label: "a", key: "c", go() {} }, { label: "b", go() {} }, { label: "c", key: "y", go() {} }, { label: "d", go() {} }];
  expect(digitsOf(rows)).toEqual([null, 1, null, 2]);
  expect(digitsOf(Array.from({ length: 11 }, (_x, i) => ({ label: String(i), go() {} }))).slice(8)).toEqual([9, null, null]);
});
