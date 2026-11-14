// A range of cells in a grid: the cursor and an anchor (shift + arrows, a
// drag across cells or row numbers, V for whole rows, cmd-a for everything),
// and what copying it gives: one cell's plain value, a range as TSV (a
// spreadsheet takes it as it is), rows as JSON, CSV or INSERTs.

import type { Cell, ResultSet } from "./parse-out.ts";
import type { GridAt } from "./state.ts";

/** A range: its first and last rows and columns (inclusive). */
export interface Range {
  readonly r0: number;
  readonly r1: number;
  readonly c0: number;
  readonly c1: number;
}

/** Whether the cursor has a range (more than its own cell). */
export const hasRange = (at: GridAt): boolean => Boolean(at.anchor && (at.anchor.row !== at.row || at.anchor.col !== at.col));

/** The cursor's range (its own cell when it has none). */
export function rangeOf(at: GridAt): Range {
  const a = at.anchor ?? { row: at.row, col: at.col };

  return { r0: Math.min(a.row, at.row), r1: Math.max(a.row, at.row), c0: Math.min(a.col, at.col), c1: Math.max(a.col, at.col) };
}

export const inRange = (g: Range, r: number, c: number): boolean => r >= g.r0 && r <= g.r1 && c >= g.c0 && c <= g.c1;

/** Whether the range spans whole rows (every column of `width`). */
export const wholeRows = (g: Range, width: number): boolean => g.c0 === 0 && g.c1 >= width - 1;

/** The cursor at (row, col) with its range from `anchor` (the cursor's cell when none was set). */
export function stretched(at: GridAt, row: number, col: number): GridAt {
  return { ...at, anchor: at.anchor ?? { row: at.row, col: at.col }, row, col };
}

/** Every cell selected, the cursor at the last. */
export function everything(at: GridAt, set: ResultSet): GridAt {
  if (!set.rows.length || !set.columns.length) return at;

  return { ...at, anchor: { row: 0, col: 0 }, row: set.rows.length - 1, col: set.columns.length - 1 };
}

/** Rows `from`..`to` whole (the row numbers clicked or dragged, V). */
export function rowsSelected(at: GridAt, set: ResultSet, from: number, to: number): GridAt {
  return { ...at, anchor: { row: from, col: 0 }, row: to, col: Math.max(0, set.columns.length - 1) };
}

/** The range dropped (the cursor stays). */
export const unselected = (at: GridAt): GridAt => ({ ...at, anchor: null });

/** A TSV field: quoted when it holds a tab, a line break or a quote (as spreadsheets read it). */
const tsvField = (v: Cell): string => {
  const s = v === null ? "NULL" : v;

  return /[\t\r\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** What copying gives: one cell's value as it is, a range as TSV (no header; `header` adds the
 *  column names as its first line). */
export function copied(set: ResultSet, g: Range, header = false): string {
  if (g.r0 === g.r1 && g.c0 === g.c1 && !header) return set.rows[g.r0]?.[g.c0] ?? "";

  const cols = Array.from({ length: g.c1 - g.c0 + 1 }, (_x, k) => g.c0 + k);
  const lines: string[] = [];

  if (header) lines.push(cols.map((c) => tsvField(set.columns[c] ?? "")).join("\t"));

  for (let r = g.r0; r <= g.r1; r++) lines.push(cols.map((c) => tsvField(set.rows[r]?.[c] ?? null)).join("\t"));

  return lines.join("\n");
}

/** Some rows of a result, every column (or without those named in `skip`): for JSON, CSV, INSERTs. */
export function rowsOf(set: ResultSet, rows: readonly number[], skip: readonly string[] = []): ResultSet {
  const keep = set.columns.map((c, i) => (skip.includes(c) ? -1 : i)).filter((i) => i >= 0);

  return {
    columns: keep.map((i) => set.columns[i] ?? ""),
    rows: rows.map((r) => keep.map((i) => set.rows[r]?.[i] ?? null)),
  };
}
