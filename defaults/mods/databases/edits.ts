// The changes staged on a table's rows before they're saved: each row known by
// its key (the primary key's values as read, or SQLite's rowid), each changed
// cell by its column's name with the value read and the value now, so a change
// stays with its row through pages, sorting and filtering. Also which grids
// can be edited (a table's own rows with a key, on a connection that writes)
// and which cells (not a blob, not the rowid, one line). Plain functions: no
// app calls (scripts/databases-edit.test.ts).

import type { Kind } from "./kinds.ts";
import type { Cell, ResultSet } from "./parse-out.ts";
import type { Browse, ColumnInfo, TableRef } from "./catalog.ts";
import { typeOf } from "./quote.ts";

/** A changed cell: what was read, what it is now. */
export interface CellChange {
  readonly was: Cell;
  readonly now: Cell;
}

/** A row's changes: its key's values (as read) and each changed cell by column. */
export interface RowChanges {
  readonly key: readonly Cell[];
  readonly cells: ReadonlyMap<string, CellChange>;
}

/** The changes staged on one table of one connection, row by row (by the key's values). */
export interface Edits {
  readonly conn: string;
  readonly table: Pick<TableRef, "schema" | "name">;
  readonly keyCols: readonly string[];
  readonly rows: ReadonlyMap<string, RowChanges>;
}

/** SQLite's own row id, read as a first column where a table has no primary key. */
export const ROWID = "rowid";

/** A row's key: its id (for the map) and the key's values; null when a key column is missing. */
export function rowKeyOf(set: ResultSet, r: number, keyCols: readonly string[]): { readonly id: string; readonly values: readonly Cell[] } | null {
  const row = set.rows[r];

  if (!row) return null;

  const values: Cell[] = [];

  for (const k of keyCols) {
    const i = set.columns.indexOf(k);

    if (i < 0) return null;

    values.push(row[i] ?? null);
  }

  return { id: JSON.stringify(values), values };
}

/** The change staged on a cell of the shown rows, or null. */
export function changeAt(edits: Edits | null, set: ResultSet, r: number, column: string): CellChange | null {
  if (!edits) return null;

  const key = rowKeyOf(set, r, edits.keyCols);

  return key ? edits.rows.get(key.id)?.cells.get(column) ?? null : null;
}

/** Whether a shown row has a change staged. */
export function rowChanged(edits: Edits | null, set: ResultSet, r: number): boolean {
  if (!edits) return false;

  const key = rowKeyOf(set, r, edits.keyCols);

  return key ? edits.rows.has(key.id) : false;
}

/** The cell's value as shown: the staged one, else as read. */
export function shownCell(edits: Edits | null, set: ResultSet, r: number, c: number): Cell {
  const read = set.rows[r]?.[c] ?? null;
  const change = changeAt(edits, set, r, set.columns[c] ?? "");

  return change ? change.now : read;
}

/** A new, empty set of changes for a table. */
export const noEdits = (conn: string, table: Pick<TableRef, "schema" | "name">, keyCols: readonly string[]): Edits => ({ conn, table, keyCols, rows: new Map() });

/** `edits` with a cell's value staged as `now` (the change dropped when `now` is what was read). */
export function stage(edits: Edits, set: ResultSet, r: number, column: string, now: Cell): Edits {
  const key = rowKeyOf(set, r, edits.keyCols);
  const c = set.columns.indexOf(column);

  if (!key || c < 0) return edits;

  const before = edits.rows.get(key.id);
  const was = before?.cells.get(column)?.was ?? set.rows[r]?.[c] ?? null;
  const cells = new Map(before?.cells ?? []);

  if (now === was) cells.delete(column);
  else cells.set(column, { was, now });

  const rows = new Map(edits.rows);

  if (cells.size) rows.set(key.id, { key: key.values, cells });
  else rows.delete(key.id);

  return { ...edits, rows };
}

/** `edits` without the change on a shown cell. */
export function unstage(edits: Edits, set: ResultSet, r: number, column: string): Edits {
  const change = changeAt(edits, set, r, column);

  return change ? stage(edits, set, r, column, change.was) : edits;
}

/** How many cells are changed, in how many rows. */
export interface Counted {
  readonly cells: number;
  readonly rows: number;
}

/** How many cells are changed, in how many rows. */
export function counted(edits: Edits | null): Counted {
  if (!edits) return { cells: 0, rows: 0 };

  let cells = 0;

  for (const r of edits.rows.values()) cells += r.cells.size;

  return { cells, rows: edits.rows.size };
}

/** "3 changes", "1 change". */
export const changesWord = (n: number): string => `${n} change${n === 1 ? "" : "s"}`;

/** What the editability is worked out from: the connection, the grid, the table and its structure. */
export interface GridFacts {
  readonly kind: Kind;
  readonly connName: string;
  readonly readonly: boolean;
  /** "rows": a table's page; "results": a query's result. */
  readonly grid: "rows" | "results";
  readonly browse: Browse | null;
  /** The browsed table as the catalog lists it (a view or a table). */
  readonly table: Pick<TableRef, "type"> | null;
  /** The browsed table's columns, once its structure is read (null: not yet). */
  readonly columns: readonly ColumnInfo[] | null;
  readonly set: ResultSet | null;
}

/** Whether the grid's rows can be edited: the key that tells them apart, or why not. */
export type Editability = { readonly keyCols: readonly string[] } | { readonly why: string };

/** Whether the shown grid can be edited, and by which key. */
export function editability(f: GridFacts): Editability {
  if (f.grid === "results") return { why: "a query's result isn't editable: open its table in [2] to edit its rows" };

  const b = f.browse;

  if (!b || !f.set) return { why: "no rows to edit" };

  if (f.readonly) return { why: `${f.connName} is read only (e on the connection changes that)` };

  if (f.table?.type === "view") return { why: `${b.table.name} is a view: its rows aren't edited here` };

  if (!f.columns) return { why: "reading its structure… a moment" };

  const keyCols = f.columns.filter((c) => c.pk).map((c) => c.name);

  if (keyCols.length) {
    const missing = keyCols.find((k) => !f.set?.columns.includes(k));

    return missing ? { why: `its key ${missing} isn't in the rows` } : { keyCols };
  }

  if ((f.kind === "sqlite" || f.kind === "libsql") && f.set.columns[0] === ROWID && b.rowid) return { keyCols: [ROWID] };

  return { why: `${b.table.name} has no primary key: its rows can't be told apart for an UPDATE` };
}

/** Why one cell can't be edited (null: it can): the rowid, a blob, a value over several lines. */
export function cellRefusal(e: Editability, columns: readonly ColumnInfo[] | null, column: string, value: Cell): string | null {
  if ("why" in e) return e.why;

  if (column === ROWID && e.keyCols[0] === ROWID) return "the rowid is SQLite's own: it isn't edited";

  const type = columns?.find((c) => c.name === column)?.type ?? "";

  if (typeOf(type) === "blob") return `${column} holds a blob: it isn't edited here`;

  if (value !== null && /[\r\n]/.test(value)) return "a value over several lines: change it with an UPDATE in a query (ctrl-n)";

  return null;
}

/** Whether a table without a primary key is read with its rowid (SQLite and a libSQL file;
 *  a table WITHOUT ROWID always has a primary key). */
export const readsRowid = (kind: Kind, columns: readonly ColumnInfo[], type: "table" | "view"): boolean =>
  (kind === "sqlite" || kind === "libsql") && type === "table" && columns.length > 0 && !columns.some((c) => c.pk || /^(rowid|oid|_rowid_)$/i.test(c.name));
