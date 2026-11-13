import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";

// The preview's tables: CSV / TSV and SQLite (preview/table.js and its view).
// The mods import the app's modules; stand-ins record what they're asked (as preview.test.ts).
class Element {
  calls: [string, any[]][] = [];
  nodes: any[] = [];
  constructor(public kind = "div", public arg?: any) {
    return new Proxy(this, {
      get: (target, key: string, proxy) => key in target ? (target as any)[key] : (...args: any[]) => {
        if (key === "child") target.nodes.push(args[0]);
        else if (key === "children") target.nodes.push(...args[0]);
        else if (key === "when") { if (args[0]) args[1](proxy); }
        else target.calls.push([key, args]);
        return proxy;
      },
    });
  }
}
const call = (el: any, name: string) => el.calls.find(([k]: [string]) => k === name)?.[1];
/** Every element under `el`, depth first. */
const walk = (el: any): any[] => (el && typeof el === "object" && "nodes" in el ? [el, ...el.nodes.flatMap(walk)] : []);
const commands: [string, any][] = [];
const world: { panes: any[]; spaces: any[]; shared: Record<string, any> } = { panes: [], spaces: [], shared: {} };
const herdr = {
  props: () => ({}), theme: () => ({ background: "#080808", foreground: "#c6c6c6", hover: "#1c1c1c", ansi0: "#323437", ansi8: "#949494", accent: "#80a0ff", muted: "#949494", dim: "#5F6D6D" }),
  settings: () => ({ zoom: 1 }), exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  panes: () => world.panes, spaces: () => world.spaces, terminals: () => [] as any[],
  shared: (k: string) => world.shared[k] ?? null, setShared: (k: string, v: any) => { world.shared[k] = v; return null; },
  readTextFile: async () => null, writeTextFile: async () => null, watchFolder: () => new Promise(() => {}), nextCommand: () => new Promise(() => {}),
  focused: () => null, home: () => "/home/me", appHome: () => "/home/me/.config/herdr-app", window: () => ({ platform: "linux" }),
};
const kit = {
  View: class {}, div: () => new Element(), svg: (p: string) => new Element("svg", p), image: (p: string) => new Element("image", p),
  PathBuilder: { fill: () => new Element() }, Background: { checkerboard: () => ({}) },
};
const base = {
  h_flex: () => new Element(), v_flex: () => new Element(), v_virtual_list: () => new Element(), Scrollbar: { vertical: () => new Element() },
  VirtualListScrollHandle: { new: () => ({}) }, Editor: { new: () => new Element() }, EditorState: { new: () => ({}) },
};

/** A shipped mod file run with stand-ins for the app's modules (imports dropped,
 *  exports returned); `extra` fills in what its own imports would have. */
/** A mod file's keyhelp.js exports (imports stripped), when the file imports it. */
async function keyhelpOf(path: string, source: string, scope: Record<string, any>): Promise<Record<string, unknown>> {
  if (!/from "\.\/keyhelp\.js"/.test(source)) return {};
  const src = await readFile(new URL(`../defaults/mods/${path.replace(/[^/]+$/, "keyhelp.js")}`, import.meta.url), "utf8");
  const names: string[] = [];
  const body = src.replace(/^import [^;]*;\n/gm, "").replace(/^export (async function|function|const|class) (\w+)/gm, (_m, kind, n) => { names.push(n); return `${kind} ${n}`; });
  const s: Record<string, unknown> = { div: scope.div, PathBuilder: scope.PathBuilder, Background: scope.Background, h_flex: scope.h_flex, v_flex: scope.v_flex,
    settings: scope.settings ?? (() => ({ zoom: 1 })), appWindow: scope.appWindow ?? (() => ({ platform: "macos" })), window: scope.window ?? { paint_path: scope.div } };
  return new Function(...Object.keys(s), `${body}\nreturn { ${names.join(", ")} };`)(...Object.values(s));
}

async function load(path: string, extra: Record<string, unknown> = {}): Promise<any> {
  const source = await readFile(new URL(`../defaults/mods/${path}`, import.meta.url), "utf8");
  const names: string[] = [];
  const body = source
    .replace(/^import .*;\n/gm, "")
    .replace(/^export default class (\w+)/m, (_m, n) => { names.push(`default: ${n}`); return `class ${n}`; })
    .replace(/^export (async function|function|const|class) (\w+)/gm, (_m, kind, n) => { names.push(n); return `${kind} ${n}`; })
    .replace(/^export const (\w+) = /gm, (_m, n) => { names.push(n); return `const ${n} = `; });
  const win = { paint_path: () => new Element() };
  const scope: Record<string, unknown> = { ...kit, ...base, ...herdr, appWindow: herdr.window, ...extra, window: win };
  Object.assign(scope, await keyhelpOf(path, source, scope));
  return new Function(...Object.keys(scope), `${body}\nreturn { ${names.join(", ")} };`)(...Object.values(scope));
}


const kinds = await load("preview/kinds.js");
const imageLogic = await load("preview/image.js", kinds);
const T = await load("preview/table.js");
const D = await load("preview/diff.js");
const { parse: parseTable, ...tableRest } = T;
const { parse: parsePatch, ...diffRest } = D;
const keyLogic = await load("preview/keys.js");
const logic = { ...kinds, ...keyLogic, ...imageLogic, ...tableRest, parseTable, ...diffRest, parsePatch, herdr: { ...herdr } };
const { separator, parse, table, numeric, columnName, oneLine, wholeLines, shownNote, tablesOf, sqliteError, rowsSql, countSql, quoteId, MAX_COLS, MIN_CH, MAX_CH } = T;
const text = (el: any) => walk(el).flatMap((e) => e.nodes.filter((n: any) => typeof n === "string"));

// ---- reading

test("the separator: a tab for .tsv, else what splits the first lines alike", () => {
  expect(separator("a\tb\n1\t2", "tsv")).toBe("\t");
  expect(separator("name,age\nAda,36\nAlan,41", "csv")).toBe(",");
  // European CSV: semicolons, decimal commas.
  expect(separator("name;price\nTea;3,50\nCake;4,20", "csv")).toBe(";");
  expect(separator('a,"b;c"\n1,"2;3"', "csv")).toBe(",");
  expect(separator("a|b|c\n1|2|3", "csv")).toBe("|");
  expect(separator("just one column\nvalue", "csv")).toBe(",");
});

test("rows: quotes, doubled quotes, line breaks inside quotes, CRLF, a BOM", () => {
  expect(parse('﻿a,b\r\n1,"x, y"\r\n2,"say ""hi"""\n3,"two\nlines"\n').rows).toEqual([["a", "b"], ["1", "x, y"], ["2", 'say "hi"'], ["3", "two\nlines"]]);
  expect(parse("a,b\n1,2").rows).toEqual([["a", "b"], ["1", "2"]]);
  expect(parse("a,,c\n,,\n").rows).toEqual([["a", "", "c"], ["", "", ""]]);
  expect(parse("a\tb\n1\t2", "\t").rows).toEqual([["a", "b"], ["1", "2"]]);
  // At most `max` rows, saying there was more.
  expect(parse("1\n2\n3\n4\n", ",", 2)).toEqual({ rows: [["1"], ["2"]], cut: true });
  expect(parse("1\n2\n", ",", 2)).toEqual({ rows: [["1"], ["2"]], cut: false });
});

test("a read cut short drops its half row", () => {
  expect(wholeLines("a,b\n1,2\n3,", true)).toBe("a,b\n1,2\n");
  expect(wholeLines("a,b\n1,2\n3,", false)).toBe("a,b\n1,2\n3,");
});

test("number columns align right; widths follow the longest cell, within bounds", () => {
  expect(["1", "-3.5", "1 204", "1,204,330", "1e-9", "12%", "0.5"].every(numeric)).toBe(true);
  expect(["", "abc", "1.2.3", "v1", "-", "2024-01-02"].some(numeric)).toBe(false);
  const t = table([["id", "name", "note", "score"], ["1", "Ada", "", "9.5"], ["2", "Alan Turing", "x".repeat(200), "8"], ["10", "Grace", "", "n/a"]]);
  expect(t.cols.map((c: any) => c.name)).toEqual(["id", "name", "note", "score"]);
  expect(t.cols.map((c: any) => c.num)).toEqual([true, false, false, false]);
  expect(t.cols.map((c: any) => c.ch)).toEqual([MIN_CH, 11, MAX_CH, 5]);
  expect(t.body.length).toBe(3);
  // Mostly numbers is numbers (one stray in ten).
  const mostly = table([["n"], ...Array.from({ length: 9 }, (_, i) => [String(i)]), ["-"]]);
  expect(mostly.cols[0].num).toBe(true);
});

test("ragged rows, no header, too many columns", () => {
  const t = table([["a"], ["1", "2", "3"]]);
  expect(t.cols.map((c: any) => c.name)).toEqual(["a", "B", "C"]);
  expect([columnName(0), columnName(25), columnName(26), columnName(701)]).toEqual(["A", "Z", "AA", "ZZ"]);
  const wide = table([Array.from({ length: MAX_COLS + 5 }, (_, i) => `c${i}`)]);
  expect([wide.cols.length, wide.wide]).toEqual([MAX_COLS, MAX_COLS + 5]);
  expect(oneLine("a\nb\tc")).toBe("a⏎b→c");
});

test("what's left out is said plainly", () => {
  expect(shownNote({ shown: 50000, total: 1204330, partial: true, wide: 0, cols: 9 })).toBe("first 50 000 of about 1 204 330 rows");
  expect(shownNote({ shown: 900, total: 900, partial: true, wide: 0, cols: 9 })).toBe("first 900 rows");
  expect(shownNote({ shown: 10, total: 10, partial: false, wide: 1024, cols: 200 })).toBe("200 of 1 024 columns");
  expect(shownNote({ shown: 10, total: 10, partial: false, wide: 0, cols: 3 })).toBe("");
});

// ---- SQLite

test("SQLite: names quoted, tables read from sqlite3's CSV, errors in plain words", () => {
  expect(quoteId('we"ird')).toBe('"we""ird"');
  expect(rowsSql("users")).toBe('SELECT * FROM "users" LIMIT 1000;');
  expect(countSql("a b")).toBe('SELECT count(*) AS n FROM "a b";');
  expect(tablesOf("name,type\r\nposts,table\r\nusers,table\r\nactive,view\r\n")).toEqual([{ name: "posts", type: "table" }, { name: "users", type: "table" }, { name: "active", type: "view" }]);
  expect(tablesOf("")).toEqual([]);
  expect(sqliteError("Error: in prepare, file is not a database (26)\n")).toBe("file is not a database");
  expect(sqliteError("Parse error near line 1: no such table: x")).toBe("no such table: x");
  expect(sqliteError("")).toBe("sqlite3 couldn't read it");
  expect(kinds.sniffKind([..."SQLite format 3\0"].map((c) => c.charCodeAt(0)))).toEqual({ kind: "sqlite" });
  expect(kinds.route("sqlite", { tools: [] }).how).toBe("none");
  expect(kinds.route("sqlite", { tools: ["sqlite3"] }).how).toBe("table");
});

// ---- the view

/** A preview showing `grid`, in an 800 × 600 pane. */
async function tableView(rows: string[][], extra: Record<string, any> = {}) {
  const { default: PreviewView } = await load("preview/viewer.js", logic);
  const view: any = Object.create(PreviewView.prototype);
  Object.assign(view, {
    path: "/data/people.csv", kind: "table", how: { how: "table" }, on: null, slot: "s1", handle: { focus() {}, is_focused: () => true },
    port: { width: 800, height: 600 }, names: ["people.csv", "zoo.csv"], info: { bytes: 4096 }, grid: { ...table(rows), sep: "," },
    sy: 0, sx: 0, cursor: 0, copied: 0, gen: 1, note: null, ...extra,
  });
  return view;
}

test("a CSV: header row, row numbers, cells; facts and the folder's place in the bar", async () => {
  const view = await tableView([["name", "age"], ["Ada", "36"], ["Alan", "41"]]);
  const words = text(view.render());
  expect(words).toEqual(expect.arrayContaining(["CSV", "people.csv", "2 rows × 2 columns · 4.0 KB", "1/2", "name", "age", "Ada", "36", "1", "2", "files", "open", "copy"]));
  // The number column is right-aligned.
  const cell36 = walk(view.render()).find((e) => e.nodes.includes("36"));
  expect(call(cell36, "text_right")).toBeDefined();
  const cellAda = walk(view.render()).find((e) => e.nodes.includes("Ada"));
  expect(call(cellAda, "text_right")).toBeUndefined();
});

test("a long table: only the rows on screen are drawn; keys move the cursor and the view", async () => {
  const rows = [["n"], ...Array.from({ length: 5000 }, (_, i) => [String(i + 1)])];
  const view = await tableView(rows);
  const cx = { notify() {}, stop_propagation() {} };
  const drawn = () => text(view.render()).filter((s: string) => /^\d+$/.test(s));
  // 600 px: about 26 rows (twice: row number and cell), not 5000.
  expect(drawn().length).toBeLessThan(80);
  view.key({ key: "G", modifiers: { shift: true } }, cx);
  expect(view.cursor).toBe(4999);
  expect(view.sy).toBe(5000 * 22 - (600 - 22));
  expect(drawn()).toContain("5000");
  view.key({ key: "g", modifiers: {} }, cx);
  expect([view.cursor, view.sy]).toEqual([0, 0]);
  view.key({ key: "j", modifiers: {} }, cx);
  view.key({ key: "pagedown", modifiers: {} }, cx);
  expect(view.cursor).toBe(1 + view.visibleRows() - 1);
  // Scroll moves the view, not the cursor.
  view.wheel({ modifiers: {}, delta: { x: 0, y: -220 } }, cx);
  expect(view.sy).toBeGreaterThan(220);
});

test("a wide table scrolls across by column; the row numbers stay", async () => {
  const head = Array.from({ length: 30 }, (_, i) => `column_${i}`);
  const view = await tableView([head, head.map((_, i) => `value ${i}`)]);
  const cx = { notify() {}, stop_propagation() {} };
  expect(view.tableWidth()).toBeGreaterThan(800);
  view.key({ key: "l", modifiers: {} }, cx);
  const second = view.colStarts()[1];
  expect(view.sx).toBe(second);
  view.key({ key: "h", modifiers: {} }, cx);
  expect(view.sx).toBe(0);
  // Shift + wheel goes across; never past the last column.
  view.wheel({ modifiers: { shift: true }, delta: { x: 0, y: -100000 } }, cx);
  expect(view.sx).toBe(view.tableWidth() - (800 - view.gutter()));
});

test("a note says what's left out; a click picks the row", async () => {
  const view = await tableView([["a"], ["1"], ["2"]], { note: "first 50 000 of about 1 204 330 rows" });
  expect(text(view.render())).toContain("first 50 000 of about 1 204 330 rows");
  const body = walk(view.render()).find((e) => call(e, "id")?.[0] === "preview-view");
  call(body, "on_mouse_down")[1]({ local_position: { x: 100, y: 22 * 2 + 5 } }, { notify() {} });
  expect(view.cursor).toBe(1);
});

test("a SQLite database: its tables as chips, the chosen one as a table; t steps tables", async () => {
  const view = await tableView([["id", "email"], ["1", "a@b.c"]], {
    path: "/data/app.db", kind: "sqlite", names: [], db: { tables: [{ name: "users", type: "table" }, { name: "posts", type: "table" }, { name: "recent", type: "view" }], at: 0 },
  });
  const words = text(view.render());
  expect(words).toEqual(expect.arrayContaining(["DB", "app.db", "3 tables · 4.0 KB", "users", "posts", "recent (view)", "a@b.c"]));
  const picked: number[] = [];
  view.pickTable = (i: number) => picked.push(i);
  view.key({ key: "t", modifiers: {} }, { notify() {}, stop_propagation() {} });
  view.key({ key: "T", modifiers: { shift: true } }, { notify() {}, stop_propagation() {} });
  expect(picked).toEqual([1, -1]);
  // An empty database says so.
  view.db = { tables: [], at: 0 }; view.grid = null;
  expect(text(view.render())).toEqual(expect.arrayContaining(["No tables", "This database is empty."]));
});

test("no sqlite3: it says so and offers the system's app", async () => {
  const view = await tableView([["a"]], { path: "/data/app.db", kind: "sqlite", error: kinds.route("sqlite", { tools: [] }).why });
  expect(text(view.render())).toEqual(expect.arrayContaining(["Can't preview this database", "Reading a database needs sqlite3, and it isn't installed", "open in its app  o"]));
});
