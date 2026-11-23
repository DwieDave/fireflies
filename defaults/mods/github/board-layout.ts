// A Projects view laid out (board.ts's board): its columns and swimlanes,
// sorted and filtered, and carrying a card through them with the keyboard.
// No herdr imports, so scripts/ tests it.

import { Array as Arr, Option, Predicate, String as Str } from "effect";
import type { FilterContext } from "./board-filter.ts";
import { dateOf, iterationOf, lower, matches, namesOf, numberOf, parseFilter, selectOf, textOf, valuesOf } from "./board-filter.ts";
import type { Board, Field, Item, View } from "./board.ts";

// ---- a view as columns and lanes

/** The field a view's columns come from: its own, else Status, else the first single select. */
export function columnField(board: Board, view: View | null | undefined): Field | null {
  const by = view?.columnBy ?? "";
  const own = by === "" ? undefined : Option.getOrUndefined(Arr.findFirst(board.fields, (f) => f.id === by));

  if (own !== undefined && (own.type === "single" || own.type === "iteration")) return own;

  return Option.getOrNull(Option.orElse(Arr.findFirst(board.fields, (f) => f.type === "single" && lower(f.name) === "status"), () => Arr.findFirst(board.fields, (f) => f.type === "single")));
}

/** The key an item goes under for a field (column or lane); "" when it has none. */
export function groupKey(_board: Board, item: Item, field: Field | null | undefined): string {
  if (field === null || field === undefined) return "";

  const c = item.content, v = item.values.get(field.id);

  switch (field.type) {
    case "single": return selectOf(v)?.optionId ?? "";
    case "iteration": return iterationOf(v)?.iterationId ?? "";
    case "assignees": return c.assignees[0]?.login ?? "";
    case "labels": return c.labels[0]?.name ?? "";
    case "repo": return c.repo ?? "";
    case "milestone": return c.milestone ?? "";
    case "text": return textOf(v) ?? "";
    case "number": {
      const n = numberOf(v);

      return n === null ? "" : String(n);
    }

    case "date": return dateOf(v) ?? "";
    case "multi": return namesOf(v) ?? "";
    default: return "";
  }
}

/** A column or lane: its key ("" for the items without a value), its name and colour; an
 *  iteration's dates and whether it's over; `none`: the empty group. */
export interface Group {
  readonly key: string;
  readonly name: string;
  readonly color: string;
  readonly none?: true;
  readonly startDate?: string;
  readonly duration?: number;
  readonly done?: boolean;
}

/** A field's groups in order: [{ key, name, color }], with its empty group ("No Status") first, as GitHub draws them.
 *  Iterations that ended show only when an item still sits in them. */
export function groupsOf(board: Board, field: Field | null | undefined, items: readonly Item[]): Group[] {
  if (field === null || field === undefined) return [{ key: "", name: "Items", color: "GRAY" }];

  const none: Group = { key: "", name: `No ${field.name}`, color: "GRAY", none: true };

  if (field.type === "single") return [none, ...Arr.map(field.options, (o) => ({ key: o.id, name: o.name, color: o.color }))];

  if (field.type === "iteration") {
    const used = new Set(Arr.map(items, (i) => groupKey(board, i, field)));

    return [none, ...Arr.flatMap(field.iterations, (it) => (!it.done || used.has(it.id)
      ? [{ key: it.id, name: it.title, color: it.done ? "GRAY" : "BLUE", startDate: it.startDate, duration: it.duration, done: it.done }]
      : []))];
  }

  // Numbers in names in their order ("v2" before "v10").
  const keys = Arr.sort(Arr.dedupe(Arr.filter(Arr.map(items, (i) => groupKey(board, i, field)), Str.isNonEmpty)), (a: string, b: string) => Str.localeCompare(b, undefined, { numeric: true })(a));

  return [none, ...Arr.map(keys, (k) => ({ key: k, name: k, color: "GRAY" }))];
}

function sortValue(board: Board, item: Item, fieldId: string): string | number | null {
  const found = Arr.findFirst(board.fields, (x) => x.id === fieldId);

  if (Option.isNone(found)) return null;

  const f = found.value;

  const v = item.values.get(f.id);

  if (f.type === "single") {
    const id = selectOf(v)?.optionId;

    return Option.getOrNull(Arr.findFirstIndex(f.options, (o) => o.id === id));
  }

  if (f.type === "iteration") return iterationOf(v)?.startDate ?? null;

  if (f.type === "number") return numberOf(v);

  if (f.type === "title") return lower(item.content.title);

  return valuesOf(board, item, f)[0] ?? null;
}

/** -1 when `x` sorts before `y`, 1 after (one field's values are all numbers or all text). */
const before = (x: string | number, y: string | number): number => (Predicate.isNumber(x) && Predicate.isNumber(y) ? (x < y ? -1 : 1) : String(x) < String(y) ? -1 : 1);

/** Items in a view's order: its sort fields, else their project position. Empty values go last. */
export function sortItems(board: Board, items: readonly Item[], sort: View["sort"] | null | undefined): readonly Item[] {
  if (sort === null || sort === undefined || sort.length === 0) return items;

  const at = new Map(Arr.map(items, (x, i) => [x.id, i]));

  return [...items].sort((a, b) => {
    for (const s of sort) {
      const x = sortValue(board, a, s.field), y = sortValue(board, b, s.field);

      if (x === y) continue;

      if (x === null) return 1;

      if (y === null) return -1;

      return before(x, y) * s.dir;
    }

    return (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0);
  });
}

/** What GitHub doesn't keep for a view: the folded columns and lanes, each column's limit. */
export interface Local {
  readonly folded?: readonly string[];
  readonly lanesFolded?: readonly string[];
  readonly limits?: ReadonlyMap<string, number>;
}

/** A column of a drawn view: its group, its items, their count, its limit and whether it's folded. */
export interface Column extends Group {
  readonly items: readonly Item[];
  readonly count: number;
  readonly limit: number | null;
  readonly folded: boolean;
}

/** A swimlane: its group's key (null: the one lane of a view without group-by), each column's items. */
export interface Lane {
  readonly key: string | null;
  readonly name: string;
  readonly color?: string;
  readonly done?: boolean | undefined;
  readonly folded: boolean;
  readonly cells: readonly (readonly Item[])[];
  readonly count?: number;
}

/** A view drawn as a board. */
export interface Layout {
  readonly field: Field | null;
  readonly lane: Field | null;
  readonly columns: readonly Column[];
  readonly lanes: readonly Lane[];
  readonly shown: number;
  readonly total: number;
  readonly sorted: boolean;
}

/** A view drawn as a board: { field, lane, columns: [{ key, name, color, count, limit, folded, items }],
 *  lanes: [{ key, name, folded, cells: [[item]] }] (one lane, key null, when the view has no group-by), shown, total }.
 *  `text` is the filter bar's, added to the view's own filter; `local` holds what GitHub doesn't keep
 *  for a view (limits, folded columns and lanes). */
export function layout(board: Board, view: View | null | undefined, text = "", local: Local = {}, ctx: FilterContext = {}): Layout {
  const field = columnField(board, view);
  const by = view?.groupBy ?? "";
  const laneField = by === "" ? null : Option.getOrNull(Arr.findFirst(board.fields, (f) => f.id === by && f.id !== field?.id));
  const filter = parseFilter(`${view?.filter ?? ""} ${text}`);
  const live = Arr.filter(board.items, (i) => !i.archived);
  const shown = sortItems(board, Arr.filter(live, (i) => matches(board, i, filter, { me: board.viewer, ...ctx })), view?.sort);
  const folded = new Set(local.folded ?? []), lanesFolded = new Set(local.lanesFolded ?? []), limits = local.limits ?? new Map<string, number>();
  const groups = groupsOf(board, field, live);

  // "No Status" shows only when something is in it.
  const columns = Arr.flatMap(groups, (g): Column[] => {
    const items = Arr.filter(shown, (i) => groupKey(board, i, field) === g.key);
    const limit = limits.get(g.key) ?? 0;

    return g.none !== true || items.length > 0 ? [{ ...g, items, count: items.length, limit: limit > 0 ? limit : null, folded: folded.has(g.key) }] : [];
  });

  const lanes: readonly Lane[] = laneField === null
    ? [{ key: null, name: "", folded: false, cells: Arr.map(columns, (c) => c.items) }]
    : Arr.flatMap(groupsOf(board, laneField, live), (g): Lane[] => {
      const cells = Arr.map(columns, (c) => Arr.filter(c.items, (i) => groupKey(board, i, laneField) === g.key));

      return Arr.some(cells, (c) => c.length > 0)
        ? [{ key: g.key, name: g.name, color: g.color, done: g.done, cells, folded: lanesFolded.has(g.key), count: Arr.reduce(cells, 0, (n, c) => n + c.length) }]
        : [];
    });

  return { field, lane: laneField, columns, lanes, shown: shown.length, total: live.length, sorted: Boolean(view?.sort.length) };
}

// ---- moving with the keyboard

/** Each column's items top to bottom (what j / k walk through). */
export type Grid = readonly (readonly Item[])[];

/** A place in a grid (row -1: an empty column). */
export interface At {
  readonly col: number;
  readonly row: number;
}

/** A card being carried: its id, where it was picked up, where it would land now. */
export interface Carry extends At {
  readonly id: string;
  readonly from: At;
}

/** A key's way: a direction, or to the top or bottom. */
export type Dir = "left" | "right" | "up" | "down" | "top" | "bottom";

/** Each column's items top to bottom across the lanes (folded lanes skipped): what j / k walk through. */
export function grid(lay: Layout): Grid {
  return Arr.map(lay.columns, (_, ci) => Arr.flatMap(Arr.filter(lay.lanes, (l) => !l.folded), (l: Lane) => l.cells[ci] ?? []));
}

/** Where an item is in a grid: { col, row } or null. */
export function find(g: Grid, id: string | null | undefined): At | null {
  for (const [c, col] of g.entries()) {
    const r = Arr.findFirstIndex(col, (i) => i.id === id);

    if (Option.isSome(r)) return { col: c, row: r.value };
  }

  return null;
}

/** The selection moved by a key ("left" "right" "up" "down" "top" "bottom"), skipping folded columns:
 *  { col, row } (row -1 in an empty column). */
export function step(g: Grid, at: At | null, dir: Dir, folded: readonly boolean[] = []): At | null {
  const n = g.length;

  if (n === 0) return at;

  const { col, row } = at ?? { col: 0, row: 0 };

  if (dir === "left" || dir === "right") {
    const d = dir === "left" ? -1 : 1;
    let c = col + d;

    while (c >= 0 && c < n && folded[c] === true) c += d;

    const len = g[c]?.length;

    if (len === undefined) return { col, row };

    return { col: c, row: len > 0 ? Math.min(Math.max(0, row), len - 1) : -1 };
  }

  const len = g[col]?.length ?? 0;

  if (len === 0) return { col, row: -1 };

  if (dir === "up") return { col, row: Math.max(0, row - 1) };

  if (dir === "down") return { col, row: Math.min(len - 1, row + 1) };

  if (dir === "top") return { col, row: 0 };

  return { col, row: len - 1 };
}

/** Picks up the selected card: { id, from: { col, row }, col, row } (where it would land now). */
export function pickUp(g: Grid, at: At | null): Carry | null {
  const it = at === null ? undefined : g[at.col]?.[at.row];

  return at !== null && it !== undefined ? { id: it.id, from: { col: at.col, row: at.row }, col: at.col, row: at.row } : null;
}

/** How a carried card moves: past folded columns, and whether the view sorts it. */
export interface CarryOptions {
  readonly folded?: readonly boolean[];
  readonly sorted?: boolean;
}

/** The carried card moved one key: h / l to the next unfolded column (landing at the same height, or the end),
 *  j / k within the column. `sorted`: the view orders cards by a field, so only the column changes. */
export function carry(g: Grid, c: Carry | null, dir: Dir, { folded = [], sorted = false }: CarryOptions = {}): Carry | null {
  if (c === null) return c;

  const rest = (col: number) => Arr.filter(g[col] ?? [], (i) => i.id !== c.id).length;

  if (dir === "left" || dir === "right") {
    const d = dir === "left" ? -1 : 1;
    let col = c.col + d;

    while (col >= 0 && col < g.length && folded[col] === true) col += d;

    if (col < 0 || col >= g.length) return c;

    return { ...c, col, row: sorted ? 0 : Math.min(c.row, rest(col)) };
  }

  if (sorted) return c;

  const max = rest(c.col);

  if (dir === "up") return { ...c, row: Math.max(0, c.row - 1) };

  if (dir === "down") return { ...c, row: Math.min(max, c.row + 1) };

  if (dir === "top") return { ...c, row: 0 };

  return { ...c, row: max };
}

/** The grid as it looks while a card is carried: out of its column, into its landing spot. */
export function carried(g: Grid, c: Carry | null): Grid {
  if (c === null) return g;

  const it = g[c.from.col]?.[c.from.row];

  if (it === undefined) return g;

  return Arr.map(g, (col, i) => {
    const kept = Arr.filter(col, (x) => x.id !== c.id);

    return i === c.col ? [...Arr.take(kept, c.row), it, ...Arr.drop(kept, c.row)] : kept;
  });
}

/** A drop: the card, its new column's key (absent: the same column), the card it now follows
 *  (absent: no reorder, null: first). */
export interface Dropped {
  readonly id: string;
  column?: string;
  afterId?: string | null;
}

/** What dropping the carried card means: { id, column: the new column key or undefined (same), afterId (undefined:
 *  no reorder, null: first) } or null when nothing changes. `cols` are the layout's columns (for their keys). */
export function drop(g: Grid, c: Carry | null, cols: readonly Group[], { sorted = false }: CarryOptions = {}): Dropped | null {
  if (c === null) return null;

  const moved = c.col !== c.from.col, at = carried(g, c)[c.col] ?? [];
  const i = Option.getOrElse(Arr.findFirstIndex(at, (x) => x.id === c.id), () => -1);
  const before = i > 0 ? at[i - 1]?.id ?? null : null;
  const wasBefore = c.from.row > 0 ? g[c.from.col]?.[c.from.row - 1]?.id ?? null : null;
  const reorder = !sorted && (moved || before !== wasBefore);

  if (!moved && !reorder) return null;

  const out: Dropped = { id: c.id };
  const column = cols[c.col]?.key;

  if (moved && column !== undefined) out.column = column;

  if (reorder) out.afterId = before;

  return out;
}
