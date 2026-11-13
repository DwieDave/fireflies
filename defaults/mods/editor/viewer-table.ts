// The viewer's tables: a CSV or a database (sqlite, its tables), the rows in
// view, the columns' widths and starts, scrolling and the cursor, the table
// drawn with its rails. Shared like viewer.ts.

import { div } from "gpui-kit";
import type { Context, Element, Modifiers } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec } from "herdr";
import type { ExecResult, Theme } from "herdr";
import { sniffKind, route, count } from "./kinds.ts";
import { hexBytes } from "./image.ts";
import type { Column, Table } from "./table.ts";
import { parse as parseTable, table, oneLine, SQLITE_ARGS, TABLES_SQL, rowsSql, countSql, tablesOf, sqliteError } from "./table.ts";
import { nextFile } from "./diff.ts";
import { held, sh, blank, STAMP, unzoom, CH, ROW, failure, GUTTER_MIN, CELL, checker, code } from "./viewer-state.ts";
import { failWith, failed, tools } from "./viewer-load.ts";
import type { default as Viewer } from "./viewer.ts";

/** SQLite: its tables, then the chosen one's first rows (sqlite3, read only). */
export async function loadDb(v: Viewer, cx: Context, gen: number): Promise<void> {
  const s = await sh(STAMP, [v.path], v.on);

  if (gen !== v.gen) return;

  if (s.code !== 0) {
    const e = failed(s);

    if (e !== v.error) failWith(v, cx, e);

    return;
  }

  const [size = "", time = "", ...rest] = s.stdout.split("\n");
  const stamp = `${size}:${time}`;

  if (v.stamp === stamp && !v.error) return;

  v.stamp = stamp;
  v.info = blank(Number(size));

  if (sniffKind(hexBytes(rest.join(" ")))?.kind !== "sqlite") {
    failWith(v, cx, `Not a SQLite database${Number(size) ? "" : " (it's empty)"}`);

    return;
  }

  const how = route("sqlite", { tools: await tools(v) });

  v.how = how;

  if (how.how === "none") {
    failWith(v, cx, how.why);

    return;
  }

  const list = await sqlite(v, TABLES_SQL);

  if (gen !== v.gen) return;

  if (list.code !== 0) {
    failWith(v, cx, sqliteError(list.stderr));

    return;
  }

  const tables = tablesOf(list.stdout);
  const was = v.db ? v.db.tables[v.db.at]?.name : undefined;
  const at = Math.max(0, tables.findIndex((x) => x.name === was));

  v.db = { tables, at };

  if (!tables.length) {
    v.grid = null;
    v.note = null;
    v.error = null;
    v.busy = null;
    cx.notify();

    return;
  }

  await loadTable(v, cx, gen);
}

/** One query on the database, as CSV. */
export function sqlite(v: Viewer, sql: string): Promise<ExecResult> {
  return exec("sqlite3", [...SQLITE_ARGS, v.path, sql], v.on ? { on: v.on } : undefined).catch(failure);
}

export async function loadTable(v: Viewer, cx: Context, gen: number): Promise<void> {
  const db = v.db;
  const t = db?.tables[db.at];

  if (!t) return;

  const [rows, n] = await Promise.all([sqlite(v, rowsSql(t.name)), sqlite(v, countSql(t.name))]);

  if (gen !== v.gen || (v.db ? v.db.tables[v.db.at] : undefined) !== t) return;

  if (rows.code !== 0) {
    failWith(v, cx, sqliteError(rows.stderr));

    return;
  }

  const total = Number(parseTable(n.stdout).rows[1]?.[0] ?? 0);
  let parsed: readonly (readonly string[])[] = parseTable(rows.stdout).rows;

  // An empty table prints nothing, not even its header: ask for the columns.
  if (!parsed.length) {
    const cols = await sqlite(v, `SELECT name FROM pragma_table_info(${"'" + t.name.replace(/'/g, "''") + "'"});`);

    parsed = [parseTable(cols.stdout).rows.slice(1).map((r) => r[0] ?? "")];
  }

  const grid = table(parsed);
  const shownRows = total > grid.body.length ? `first ${count(grid.body.length)} of ${count(total)} rows` : null;

  v.grid = grid;
  v.note = grid.wide ? [shownRows, `${grid.cols.length} of ${grid.wide} columns`].filter(Boolean).join(" · ") : shownRows;
  v.sy = 0;
  v.sx = 0;
  v.cursor = 0;
  v.error = null;
  v.busy = null;
  cx.notify();
}

export function pickTableOf(v: Viewer, i: number, cx: Context): void {
  const db = v.db;

  if (!db?.tables.length) return;

  const n = db.tables.length;

  v.db = { ...db, at: ((i % n) + n) % n };
  v.busy = "Reading…";
  cx.notify();

  const gen = v.gen;

  cx.spawn(async (cx) => loadTable(v, cx, gen));
}

export function rowCount(v: Viewer): number {
  return v.grid ? v.grid.body.length : v.patch ? v.patch.rows.length : 0;
}

/** Rows that fit under the header, in element px. */
export function visibleRowsOf(v: Viewer): number {
  return Math.max(1, Math.floor((unzoom(v.port.height) - (v.grid ? ROW : 0)) / ROW));
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

  return (v.grid?.cols ?? []).map((c) => {
    const at = x;

    x += colWidth(c);

    return at;
  });
}

/** Scrolls by element px, kept in bounds. */
export function scrollBy(v: Viewer, dx: number, dy: number): void {
  const room = unzoom(v.port.height) - (v.grid ? ROW : 0);
  const maxY = Math.max(0, rowCount(v) * ROW - room);
  const maxX = Math.max(0, v.tableWidth() - (unzoom(v.port.width) - v.gutter()));

  v.sy = Math.max(0, Math.min(maxY, v.sy + dy));
  v.sx = v.grid ? Math.max(0, Math.min(maxX, v.sx + dx)) : 0;
}

/** Moves the cursor row (and the view with it, when it leaves). */
export function moveToRow(v: Viewer, row: number): void {
  const n = rowCount(v);

  if (!n) return;

  v.cursor = Math.max(0, Math.min(n - 1, row));

  const top = Math.ceil(v.sy / ROW);
  const shown = v.visibleRows();

  if (v.cursor < top) scrollBy(v, 0, v.cursor * ROW - v.sy);
  else if (v.cursor >= top + shown) scrollBy(v, 0, (v.cursor - shown + 1) * ROW - v.sy);
}

/** The next / previous column start (h, l). */
export function columnAt(v: Viewer, dir: number): void {
  const starts = v.colStarts();
  const to = dir > 0 ? starts.find((x) => x > v.sx + 1) : [...starts].reverse().find((x) => x < v.sx - 1);

  scrollBy(v, (to ?? (dir > 0 ? v.tableWidth() : 0)) - v.sx, 0);
}

export function rowKey(v: Viewer, k: string, m: Modifiers, cx: Context): boolean {
  const page = Math.max(1, v.visibleRows() - 1);

  if (k === "j" || k === "down") moveToRow(v, v.cursor + 1);
  else if (k === "k" || k === "up") moveToRow(v, v.cursor - 1);
  else if (k === "J" || (k === "j" && m.shift) || k === "pagedown") {
    scrollBy(v, 0, page * ROW);
    moveToRow(v, v.cursor + page);
  } else if (k === "K" || (k === "k" && m.shift) || k === "pageup") {
    scrollBy(v, 0, -page * ROW);
    moveToRow(v, v.cursor - page);
  } else if ((k === "g" && !m.shift) || k === "home") moveToRow(v, 0);
  else if (k === "G" || (k === "g" && m.shift) || k === "end") moveToRow(v, rowCount(v) - 1);
  else if (v.grid && (k === "h" || k === "left")) columnAt(v, -1);
  else if (v.grid && (k === "l" || k === "right")) columnAt(v, 1);
  else if (v.patch && (k === "}" || k === "{")) {
    const to = nextFile(held(v).starts, v.cursor, k === "}" ? 1 : -1);

    if (to !== null) {
      moveToRow(v, to);
      scrollBy(v, 0, to * ROW - v.sy);
    }
  } else if (v.db && (k === "t" || k === "T")) v.pickTable(v.db.at + (k === "T" || m.shift ? -1 : 1), cx);
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
          .children(g.cols.map((c, i) => cell(c, row[i] ?? "", false))))));
  }

  const head = h_flex().absolute().left(0).top(0).h(ROW).w_full().items_center().bg(t.background)
    .child(div().w(gut).flex_none())
    .child(div().relative().flex_1().min_w(0).h_full().overflow_hidden()
      .child(h_flex().absolute().top(0).h_full().items_center().left(-view.sx)
        .children(g.cols.map((c) => cell(c, c.name, true)))))
    .child(div().absolute().left(0).right(0).bottom(0).h(1).child(checker(t.ansi8, 1)));

  const body = !g.body.length ? [div().absolute().left(gut + CELL).top(ROW + 8).text_color(t.dim).child("No rows")] : rows;

  return [div().absolute().inset_0().font_family(font).text_size(12).children([...body, head, ...rowRails(view, t, focused, ROW, roomH, roomW, gut)])];
}

/** Dithered rails for rows that don't all fit: right (rows), bottom (columns). */
export function rowRails(v: Viewer, t: Theme, focused: boolean, top: number, roomH: number, roomW: number, left: number): Element[] {
  const out: Element[] = [];
  const color = focused ? t.accent : t.ansi8;
  const total = rowCount(v) * ROW;

  if (total > roomH + 1) {
    const h = Math.max(16, roomH * (roomH / total));
    const y = top + (v.sy / Math.max(1, total - roomH)) * (roomH - h);

    out.push(div().absolute().right(1).w(3).top(y).h(h).child(checker(color, 1)));
  }

  const width = v.tableWidth();

  if (v.grid && width > roomW + 1) {
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
