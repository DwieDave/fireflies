// The viewer's tables: a CSV or a database (sqlite, its tables), the rows in
// view, the columns' widths and starts, scrolling and the cursor, the table
// drawn with its rails.

import { Array as Arr, Effect, Option, Schema, String as Str } from "effect";
import { div } from "gpui-kit";
import type { Context, Element, Modifiers } from "gpui-kit";
import { h_flex } from "gpui-base";
// The Databases hand-off's calls by name: a stand-in herdr (the tests') needn't have them all.
import * as herdr from "herdr";
import type { Theme } from "herdr";
import { Exec, Files } from "@fireflies/kit";
import { FilesLive } from "@fireflies/kit/live";
import { sniffKind, route, count } from "./kinds.ts";
import { hexBytes } from "./image.ts";
import type { Column, Table } from "./table.ts";
import { parse as parseTable, table, oneLine, SQLITE_ARGS, TABLES_SQL, rowsSql, countSql, tablesOf, sqliteError } from "./table.ts";
import { nextFile } from "./diff.ts";
import { held, sh, waiting, blank, STAMP, unzoom, CH, ROW, GUTTER_MIN, CELL, checker, code } from "./viewer-state.ts";
import { failWith, failed, runRead, tools } from "./viewer-load.ts";
import type { default as Viewer } from "./viewer.ts";

/** Whether the Databases mod is installed (its folder in the app's mods). */
export const databasesInstalled = Effect.map(waiting(Files.use((f) => f.read(`${herdr.appHome()}/mods/databases/mod.json`))), Option.isSome);

/**
 * `databasesInstalled` for a caller not on Effect yet (the files pane's
 * start). Asked from a pane's start: a file that can't be read means "not
 * there", never a broken pane.
 */
export const hasDatabases = (): Promise<boolean> =>
  Effect.runPromise(databasesInstalled.pipe(Effect.orElseSucceed(() => false), Effect.provide(FilesLive)));

/** What the Databases window opens: a SQLite file, read only until the person says otherwise. */
const DatabasesConnect = Schema.Struct({ kind: Schema.Literal("sqlite"), path: Schema.String, readonly: Schema.Boolean, from: Schema.String });

const connectJson = Schema.encodeOption(Schema.fromJsonString(DatabasesConnect));

/** A SQLite file in the Databases window (its contract: nocturne.databases:{kind, path} in the
 *  nocturne layout, else its window opened on it), read only until the person says otherwise. */
export function openInDatabases(path: string, from: string): void {
  const args = { kind: "sqlite", path, readonly: true, from } as const;

  if (herdr.shared("layout") === "nocturne") {
    for (const json of Option.toArray(connectJson(args))) herdr.run(`nocturne.databases:${json}`);
  } else herdr.openOverlay({ mod: "databases", kind: "window", key: "databases", frame: "none", scrim: true, width: 0.88, height: 0.88, props: { connect: args } });
}

/** SQLite: its tables, then the chosen one's first rows (sqlite3, read only). */
export const loadDb = Effect.fnUntraced(function* (v: Viewer, gen: number) {
  const s = yield* sh(STAMP, [v.path], v.on);

  if (gen !== v.gen) return;

  if (s.code !== 0) {
    const e = failed(s);

    if (e !== v.error) failWith(v, e);

    return;
  }

  const [size = "", time = "", ...rest] = Str.split(s.stdout, "\n");
  const stamp = `${size}:${time}`;

  if (v.stamp === stamp && v.error === null) return;

  v.stamp = stamp;
  v.info = blank(Number(size));

  if (sniffKind(hexBytes(Arr.join(rest, " ")))?.kind !== "sqlite") {
    failWith(v, `Not a SQLite database${Number(size) > 0 ? "" : " (it's empty)"}`);

    return;
  }

  const how = route("sqlite", { tools: yield* tools(v) });

  v.how = how;

  if (how.how === "none") {
    failWith(v, how.why);

    return;
  }

  const list = yield* sqlite(v, TABLES_SQL);

  if (gen !== v.gen) return;

  if (list.code !== 0) {
    failWith(v, sqliteError(list.stderr));

    return;
  }

  const tables = tablesOf(list.stdout);

  // A file here (not on another machine) opens in the Databases window when it's installed;
  // its mod.json that can't be read counts as not installed.
  v.dbMod = v.on === null && (yield* databasesInstalled.pipe(Effect.orElseSucceed(() => false)));

  const was = v.db === null ? undefined : v.db.tables[v.db.at]?.name;
  const at = Option.getOrElse(Arr.findFirstIndex(tables, (x) => x.name === was), () => 0);

  v.db = { tables, at };

  if (tables.length === 0) {
    v.grid = null;
    v.note = null;
    v.error = null;
    v.busy = null;

    return;
  }

  yield* loadTable(v, gen);
});

/** One query on the database, as CSV. */
export const sqlite = (v: Viewer, sql: string) => waiting(Exec.use((x) => x.run("sqlite3", [...SQLITE_ARGS, v.path, sql], v.on === null ? undefined : { on: v.on })));

export const loadTable = Effect.fnUntraced(function* (v: Viewer, gen: number) {
  const db = v.db;
  const t = db?.tables[db.at];

  if (t === undefined) return;

  const [rows, n] = yield* Effect.all([sqlite(v, rowsSql(t.name)), sqlite(v, countSql(t.name))], { concurrency: 2 });

  if (gen !== v.gen || (v.db === null ? undefined : v.db.tables[v.db.at]) !== t) return;

  if (rows.code !== 0) {
    failWith(v, sqliteError(rows.stderr));

    return;
  }

  const total = Number(parseTable(n.stdout).rows[1]?.[0] ?? 0);
  let parsed: readonly (readonly string[])[] = parseTable(rows.stdout).rows;

  // An empty table prints nothing, not even its header: ask for the columns.
  if (parsed.length === 0) {
    const cols = yield* sqlite(v, `SELECT name FROM pragma_table_info(${"'" + Str.replace(/'/g, "''")(t.name) + "'"});`);

    parsed = [Arr.map(parseTable(cols.stdout).rows.slice(1), (r) => r[0] ?? "")];
  }

  const grid = table(parsed);
  const shownRows = total > grid.body.length ? `first ${count(grid.body.length)} of ${count(total)} rows` : null;

  v.grid = grid;
  v.note = grid.wide > 0 ? Arr.join(Arr.filter([shownRows, `${grid.cols.length} of ${grid.wide} columns`], (x) => x !== null), " · ") : shownRows;
  v.sy = 0;
  v.sx = 0;
  v.cursor = 0;
  v.error = null;
  v.busy = null;
});

export function pickTableOf(v: Viewer, i: number, cx: Context): void {
  const db = v.db;

  if (db === null || db.tables.length === 0) return;

  const n = db.tables.length;

  v.db = { ...db, at: ((i % n) + n) % n };
  v.busy = "Reading…";
  cx.notify();
  runRead(v, v.gen, loadTable(v, v.gen));
}

export function rowCount(v: Viewer): number {
  return v.grid !== null ? v.grid.body.length : v.patch !== null ? v.patch.rows.length : 0;
}

/** Rows that fit under the header, in element px. */
export function visibleRowsOf(v: Viewer): number {
  return Math.max(1, Math.floor((unzoom(v.port.height) - (v.grid === null ? 0 : ROW)) / ROW));
}

/** The row numbers' column. */
export function gutterOf(v: Viewer): number {
  return Math.max(GUTTER_MIN, String(rowCount(v)).length * CH + 2 * CELL);
}

export function colWidth(c: Column): number {
  return c.ch * CH + 2 * CELL;
}

/** How wide the table's columns are together. */
export function tableWidthOf(v: Viewer): number {
  let w = 0;

  for (const c of v.grid?.cols ?? []) w += colWidth(c);

  return w;
}

/** Where each column starts, for h / l. */
export function colStartsOf(v: Viewer): number[] {
  let x = 0;

  return Arr.map(v.grid?.cols ?? [], (c) => {
    const at = x;

    x += colWidth(c);

    return at;
  });
}

/** Scrolls by element px, kept in bounds. */
export function scrollBy(v: Viewer, dx: number, dy: number): void {
  const room = unzoom(v.port.height) - (v.grid === null ? 0 : ROW);
  const maxY = Math.max(0, rowCount(v) * ROW - room);
  const maxX = Math.max(0, v.tableWidth() - (unzoom(v.port.width) - v.gutter()));

  v.sy = Math.max(0, Math.min(maxY, v.sy + dy));
  v.sx = v.grid === null ? 0 : Math.max(0, Math.min(maxX, v.sx + dx));
}

/** Moves the cursor row (and the view with it, when it leaves). */
export function moveToRow(v: Viewer, row: number): void {
  const n = rowCount(v);

  if (n === 0) return;

  v.cursor = Math.max(0, Math.min(n - 1, row));

  const top = Math.ceil(v.sy / ROW);
  const shown = v.visibleRows();

  if (v.cursor < top) scrollBy(v, 0, v.cursor * ROW - v.sy);
  else if (v.cursor >= top + shown) scrollBy(v, 0, (v.cursor - shown + 1) * ROW - v.sy);
}

/** The next / previous column start (h, l). */
export function columnAt(v: Viewer, dir: number): void {
  const starts = v.colStarts();
  const to = dir > 0 ? Arr.findFirst(starts, (x) => x > v.sx + 1) : Arr.findLast(starts, (x) => x < v.sx - 1);

  scrollBy(v, Option.getOrElse(to, () => (dir > 0 ? v.tableWidth() : 0)) - v.sx, 0);
}

export function rowKey(v: Viewer, k: string, m: Modifiers, cx: Context): boolean {
  const page = Math.max(1, v.visibleRows() - 1);

  if (k === "j" || k === "down") moveToRow(v, v.cursor + 1);
  else if (k === "k" || k === "up") moveToRow(v, v.cursor - 1);
  else if (k === "J" || (k === "j" && m.shift === true) || k === "pagedown") {
    scrollBy(v, 0, page * ROW);
    moveToRow(v, v.cursor + page);
  } else if (k === "K" || (k === "k" && m.shift === true) || k === "pageup") {
    scrollBy(v, 0, -page * ROW);
    moveToRow(v, v.cursor - page);
  } else if ((k === "g" && m.shift !== true) || k === "home") moveToRow(v, 0);
  else if (k === "G" || (k === "g" && m.shift === true) || k === "end") moveToRow(v, rowCount(v) - 1);
  else if (v.grid !== null && (k === "h" || k === "left")) columnAt(v, -1);
  else if (v.grid !== null && (k === "l" || k === "right")) columnAt(v, 1);
  else if (v.patch !== null && (k === "}" || k === "{")) {
    const to = nextFile(held(v).starts, v.cursor, k === "}" ? 1 : -1);

    if (to !== null) {
      moveToRow(v, to);
      scrollBy(v, 0, to * ROW - v.sy);
    }
  } else if (v.db !== null && (k === "t" || k === "T")) v.pickTable(v.db.at + (k === "T" || m.shift === true ? -1 : 1), cx);
  else return false;

  return true;
}

/** A table: header row and row numbers stay put, the cells scroll both ways. */
export function tableView(view: Viewer, t: Theme, g: Table, focused: boolean): Element[] {
  const font = code();
  const gut = view.gutter();
  const roomW = unzoom(view.port.width) - gut;
  const roomH = unzoom(view.port.height) - ROW;
  const [first, last] = shownRange(view);

  const cell = (c: Column, v: string, head: boolean): Element => {
    const el = div().w(colWidth(c)).flex_none().px(CELL).truncate();

    return (c.num && !head ? el.text_right() : el).text_color(head ? t.foreground : v === "" ? t.dim : t.foreground).child(oneLine(v));
  };

  const rows: Element[] = [];

  for (let r = first; r < last; r++) {
    const row = g.body[r] ?? [];
    const cur = r === view.cursor;
    const line = h_flex().absolute().left(0).top(ROW + r * ROW - view.sy).h(ROW).w_full().items_center();

    rows.push((cur ? line.bg(t.hover) : line)
      .child(div().w(gut).flex_none().h_full().flex().items_center().justify_end().pr(CELL).text_color(cur ? t.accent : t.dim).child(String(r + 1)))
      .child(div().relative().flex_1().min_w(0).h_full().overflow_hidden()
        .child(h_flex().absolute().top(0).h_full().items_center().left(-view.sx)
          .children(Arr.map(g.cols, (c, i) => cell(c, row[i] ?? "", false))))));
  }

  const head = h_flex().absolute().left(0).top(0).h(ROW).w_full().items_center().bg(t.background)
    .child(div().w(gut).flex_none())
    .child(div().relative().flex_1().min_w(0).h_full().overflow_hidden()
      .child(h_flex().absolute().top(0).h_full().items_center().left(-view.sx)
        .children(Arr.map(g.cols, (c) => cell(c, c.name, true)))))
    .child(div().absolute().left(0).right(0).bottom(0).h(1).child(checker(t.muted, 1)));

  const body = g.body.length === 0 ? [div().absolute().left(gut + CELL).top(ROW + 8).text_color(t.dim).child("No rows")] : rows;

  return [div().absolute().inset_0().font_family(font).text_size(12).children([...body, head, ...rowRails(view, t, focused, ROW, roomH, roomW, gut)])];
}

/** Dithered rails for rows that don't all fit: right (rows), bottom (columns). */
export function rowRails(v: Viewer, t: Theme, focused: boolean, top: number, roomH: number, roomW: number, left: number): Element[] {
  const out: Element[] = [];
  const color = focused ? t.accent : t.muted;
  const total = rowCount(v) * ROW;

  if (total > roomH + 1) {
    const h = Math.max(16, roomH * (roomH / total));
    const y = top + (v.sy / Math.max(1, total - roomH)) * (roomH - h);

    out.push(div().absolute().right(1).w(3).top(y).h(h).child(checker(color, 1)));
  }

  const width = v.tableWidth();

  if (v.grid !== null && width > roomW + 1) {
    const w = Math.max(16, roomW * (roomW / width));
    const x = left + (v.sx / Math.max(1, width - roomW)) * (roomW - w);

    out.push(div().absolute().bottom(1).h(3).left(x).w(w).child(checker(color, 1)));
  }

  return out;
}

/** The rows on screen, from the scroll position. */
export function shownRange(v: Viewer): readonly [first: number, last: number] {
  const first = Math.max(0, Math.floor(v.sy / ROW));
  const last = Math.min(rowCount(v), first + v.visibleRows() + 2);

  return [first, last];
}
