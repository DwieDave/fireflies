// A grid's columns as the person arranged them: widths dragged (or stepped by
// alt-← / alt-→), columns hidden, columns moved; and a query result's local
// sort (a table's sort is the database's ORDER BY: catalog.ts orderSql). What
// the grid draws is the result seen through that (shownOf): the columns in
// order without the hidden ones, a result's rows sorted, and the way back to
// the result as read (a shown column's index in it, a shown row's). A table's
// arrangement is kept per connection and table in shared state; a query tab's
// lives with the tab.

import { setShared, shared } from "herdr";
import type { Cell, ResultSet } from "./parse-out.ts";
import type { Column } from "./table.ts";
import type { Guarded } from "./guard.ts";
import { arrayOf, isNumber, isString, object, readSharedMap, sharedMapKey, writeSharedMap } from "./guard.ts";

/** How a grid's columns are arranged: widths by name (layout px), hidden names, names in order. */
export interface ColumnLayout {
  readonly widths: { readonly [name: string]: number };
  readonly hidden: readonly string[];
  readonly order: readonly string[];
}

export const NO_LAYOUT: ColumnLayout = { widths: {}, hidden: [], order: [] };

/** A column as the grid draws it: measured, or as wide as it was dragged (`px`). */
export interface GridColumn extends Column {
  readonly px?: number;
}

/** A width's bounds (layout px). */
export const MIN_WIDTH = 36;
export const MAX_WIDTH = 900;

/** One alt-← / alt-→ step (layout px). */
export const WIDTH_STEP = 24;

export const clampWidth = (px: number): number => Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, px)));

/** A local sort of a result: by a shown column's name, either way. */
export interface LocalSort {
  readonly column: string;
  readonly desc: boolean;
}

/** The result as the grid shows it, and the way back to it as read. */
export interface Shown {
  readonly set: ResultSet;
  /** Each shown column's index in the result as read. */
  readonly cols: readonly number[];
  /** Each shown row's index in the result as read (a local sort), or null: the same rows. */
  readonly rows: readonly number[] | null;
  /** How many of the result's columns are hidden. */
  readonly hidden: number;
}

/** The raw indexes of `names` in `columns`, each name taking the next column so named (a
 *  result may carry two `id`s). */
function indexesOf(columns: readonly string[], names: readonly string[]): number[] {
  const used = new Set<number>();
  const out: number[] = [];

  for (const n of names) {
    const i = columns.findIndex((c, k) => c === n && !used.has(k));

    if (i >= 0) {
      used.add(i);
      out.push(i);
    }
  }

  return out;
}

/** The result's columns in the layout's order: those it names first, the rest after, as read. */
export function orderOf(columns: readonly string[], layout: ColumnLayout): number[] {
  const first = indexesOf(columns, layout.order);

  return [...first, ...columns.flatMap((_c, i) => (first.includes(i) ? [] : [i]))];
}

/** Two cells compared for a sort: NULL last either way, numbers as numbers when both are. */
export function compareCells(a: Cell, b: Cell, num: boolean): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;

  if (num) {
    const x = Number(a.replace(/[ ,_]/g, "")), y = Number(b.replace(/[ ,_]/g, ""));

    if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y;
  }

  return a < b ? -1 : a > b ? 1 : 0;
}

const cache = new WeakMap<ResultSet, { readonly key: string; readonly shown: Shown }>();

/** The result seen through a layout (and a local sort). `num(i)`: whether raw column i holds
 *  numbers (sorted as numbers). Worked out once per result and arrangement. */
export function shownOf(raw: ResultSet, layout: ColumnLayout, sort: LocalSort | null, num: (i: number) => boolean = () => false): Shown {
  const key = JSON.stringify([layout.order, layout.hidden, sort]);
  const known = cache.get(raw);

  if (known?.key === key) return known.shown;

  const hiddenIdx = new Set(indexesOf(raw.columns, layout.hidden));
  let cols = orderOf(raw.columns, layout).filter((i) => !hiddenIdx.has(i));

  // Never every column hidden: the grid always has one to stand on.
  if (!cols.length) cols = raw.columns.length ? [0] : [];

  const by = sort ? raw.columns.indexOf(sort.column) : -1;

  const rows = by >= 0 && sort ? raw.rows.map((_r, i) => i).sort((a, b) => {
    const c = compareCells(raw.rows[a]?.[by] ?? null, raw.rows[b]?.[by] ?? null, num(by));
    // NULL stays last when descending; ties keep the order read.
    const nulls = (raw.rows[a]?.[by] ?? null) === null || (raw.rows[b]?.[by] ?? null) === null;

    return (sort.desc && !nulls ? -c : c) || a - b;
  }) : null;

  const plain = rows === null && cols.length === raw.columns.length && cols.every((c, i) => c === i);
  const pick = (r: readonly Cell[]): Cell[] => cols.map((c) => r[c] ?? null);

  const columns = cols.map((c) => raw.columns[c] ?? "");
  const picked = (rows ?? raw.rows.map((_r, i) => i)).map((i) => pick(raw.rows[i] ?? []));
  const types = raw.types;
  const set: ResultSet = plain ? raw : types ? { columns, types: cols.map((c) => types[c] ?? ""), rows: picked } : { columns, rows: picked };

  const shown: Shown = { set, cols, rows, hidden: raw.columns.length - cols.length };

  cache.set(raw, { key, shown });

  return shown;
}

/** The measured columns with the dragged widths laid on. */
export const withWidths = (cols: readonly Column[], layout: ColumnLayout): GridColumn[] =>
  cols.map((c) => {
    const px = layout.widths[c.name];

    return px === undefined ? c : { ...c, px };
  });

/** A column's width set (null: back to its measured width). */
export function setWidth(layout: ColumnLayout, name: string, px: number | null): ColumnLayout {
  const { [name]: _was, ...rest } = layout.widths;

  return { ...layout, widths: px === null ? rest : { ...rest, [name]: clampWidth(px) } };
}

/** A column hidden; false when it's the last one shown (the layout as it is). */
export function hide(layout: ColumnLayout, columns: readonly string[], name: string): ColumnLayout | null {
  const left = columns.filter((c) => c !== name && !layout.hidden.includes(c));

  if (!left.length || layout.hidden.includes(name)) return null;

  return { ...layout, hidden: [...layout.hidden, name] };
}

/** Every column shown again. */
export const showAll = (layout: ColumnLayout): ColumnLayout => ({ ...layout, hidden: [] });

/** A column moved to stand before shown column `to` (past the last: at the end). The order is
 *  kept over every column, the hidden ones where they were. */
export function moveColumn(layout: ColumnLayout, columns: readonly string[], name: string, to: string | null): ColumnLayout {
  const all = orderOf(columns, layout).map((i) => columns[i] ?? "");
  const from = all.indexOf(name);

  if (from < 0 || name === to) return layout;

  all.splice(from, 1);

  const at = to === null ? all.length : all.indexOf(to);

  all.splice(at < 0 ? all.length : at, 0, name);

  return { ...layout, order: all };
}

/** Whether a layout changes anything. */
export const plainLayout = (l: ColumnLayout): boolean => !Object.keys(l.widths).length && !l.hidden.length && !l.order.length;

// ---- kept per table

const isWidth = object({ name: isString, px: isNumber });
const isKept = object({ at: isNumber }, { widths: arrayOf(isWidth), hidden: arrayOf(isString), order: arrayOf(isString) });

type Kept = Guarded<typeof isKept>;

/** The tables' arrangements: by connection and table, the most recent KEEP_MAX. */
export const COLUMNS_KEY = sharedMapKey("databases.columns", isKept);

export const KEEP_MAX = 200;

/** A table's key in the kept arrangements. */
export const tableKey = (conn: string, schema: string | null, name: string): string => `${conn}/${schema ?? ""}/${name}`;

/** The arrangement kept for a table (none: the plain one). */
export function keptLayout(key: string): ColumnLayout {
  const k = readSharedMap(shared, COLUMNS_KEY).get(key);

  if (!k) return NO_LAYOUT;

  return { widths: Object.fromEntries((k.widths ?? []).map((w) => [w.name, clampWidth(w.px)])), hidden: k.hidden ?? [], order: k.order ?? [] };
}

/** A table's arrangement kept (a plain one forgotten); the oldest go past KEEP_MAX. */
export function keepLayout(key: string, layout: ColumnLayout, now = Date.now()): void {
  const all = new Map(readSharedMap(shared, COLUMNS_KEY));

  all.delete(key);

  if (!plainLayout(layout)) {
    const kept: Kept = { at: now, widths: Object.entries(layout.widths).map(([name, px]) => ({ name, px })), hidden: layout.hidden, order: layout.order };

    all.set(key, kept);
  }

  const newest = [...all.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, KEEP_MAX);

  writeSharedMap(setShared, COLUMNS_KEY, new Map(newest));
}
