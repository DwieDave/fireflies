// The process deck's sorting, free of the view (tested in
// scripts/procs-sort.test.ts). Developer: "make the processes sortable by the
// columns too (cpu,mem,etc)". A click on a column's head sorts by it, a
// second click turns the direction; s steps through the columns (and back to
// the tree's own order), S turns the direction.
//
// processes  name, cpu, mem, up, pid. In the tree, the siblings at each level
//            sort: a process by its own number, a terminal, tab or space by
//            what's under it (cpu and memory summed, the longest uptime, the
//            lowest pid, its own name). For cpu and memory a flat list of
//            every process reads better (what's eating the machine, as top
//            shows it, without a busy process hiding under a quiet group):
//            while a number column sorts, v switches tree / flat.
// ports      port, process, where.
//
// The choice is kept in shared "procs.sort": while the deck lives and across
// its opens.

import type { Index, ProcNode, TabNode, TermNode, TreeNode } from "./logic.ts";
import type { Guarded } from "./guard.ts";
import { isBoolean, literal, nullable, object, sharedKey } from "./guard.ts";

export const PROC_COLS = ["name", "cpu", "mem", "up", "pid"] as const;
export const PORT_COLS = ["port", "name", "where"] as const;

export type ProcCol = (typeof PROC_COLS)[number];

export type PortCol = (typeof PORT_COLS)[number];

export type Dir = "asc" | "desc";

const isDir = literal("asc", "desc");
const isProcSort = nullable(object({ col: literal(...PROC_COLS), dir: isDir }));
const isPortSort = nullable(object({ col: literal(...PORT_COLS), dir: isDir }));

/** Each tab's sort (null: the tree's own order, the ports as listed) and the flat view. */
export const isSorts = object({ procs: isProcSort, ports: isPortSort, flat: isBoolean });

export type Sorts = Guarded<typeof isSorts>;

export type ProcSort = Guarded<typeof isProcSort>;

export type PortSort = Guarded<typeof isPortSort>;

export const NO_SORT: Sorts = { procs: null, ports: null, flat: false };

/** The sorts, kept across the deck's opens. */
export const SORT = sharedKey("procs.sort", nullable(isSorts));

/** A column's first direction: the biggest numbers first, names and ports from the start. */
export const firstDir = (col: string): Dir => (col === "cpu" || col === "mem" || col === "up" ? "desc" : "asc");

/** A click on a column's head: that column, or the other way when it already sorts. */
export function clickSort<C extends string>(cur: { readonly col: C; readonly dir: Dir } | null, col: C): { readonly col: C; readonly dir: Dir } {
  return cur?.col === col ? { col, dir: cur.dir === "asc" ? "desc" : "asc" } : { col, dir: firstDir(col) };
}

/** s: the next column, after the last back to no sort. */
export function stepSort<C extends string>(cur: { readonly col: C; readonly dir: Dir } | null, cols: readonly C[]): { readonly col: C; readonly dir: Dir } | null {
  const i = cur ? cols.indexOf(cur.col) : -1;
  const next = cols[i + 1];

  return next === undefined ? null : { col: next, dir: firstDir(next) };
}

/** S: the other direction (no sort stays none). */
export const turnSort = <C extends string>(cur: { readonly col: C; readonly dir: Dir } | null): { readonly col: C; readonly dir: Dir } | null =>
  (cur ? { col: cur.col, dir: cur.dir === "asc" ? "desc" : "asc" } : null);

/** Whether a sort is on a number column (the flat view is offered then). */
export const numeric = (s: ProcSort): boolean => s !== null && s.col !== "name";

/** What a node sorts by: a process's own numbers, a group's from what's under it. */
interface Values {
  readonly name: string;
  readonly cpu: number;
  readonly mem: number;
  readonly up: number;
  readonly pid: number;
}

type ByPid = Index["byPid"];

/** A node's values (groups summed over every process under them), each node's once. */
function valuesOf(byPid: ByPid): (n: TreeNode) => Values {
  const memo = new Map<TreeNode, Values>();

  const sum = (n: TreeNode): Values => {
    const known = memo.get(n);

    if (known) return known;

    let v: Values;

    if (n.kind === "proc") {
      const p = byPid.get(n.pid);

      v = { name: (p?.name ?? "").toLowerCase(), cpu: p?.cpu ?? 0, mem: p?.rss ?? 0, up: p?.secs ?? 0, pid: n.pid };
    } else {
      const all = procsUnder(n).map(sum);

      v = { name: n.name.toLowerCase(), cpu: all.reduce((a, x) => a + x.cpu, 0), mem: all.reduce((a, x) => a + x.mem, 0),
        up: Math.max(0, ...all.map((x) => x.up)), pid: Math.min(Number.MAX_SAFE_INTEGER, ...all.map((x) => x.pid)) };
    }

    memo.set(n, v);

    return v;
  };

  return sum;
}

/** Every process in a subtree, each once, depth first. */
export function procsUnder(n: TreeNode, seen = new Set<number>()): ProcNode[] {
  const out: ProcNode[] = [];

  if (n.kind === "proc") {
    if (seen.has(n.pid)) return out;

    seen.add(n.pid);
    out.push(n);
  }

  for (const k of n.kids) out.push(...procsUnder(k, seen));

  return out;
}

/** The order a sort puts two nodes in (ties: as they were; the sort is stable). */
function comparer(s: NonNullable<ProcSort>, byPid: ByPid): (a: TreeNode, b: TreeNode) => number {
  const val = valuesOf(byPid);
  const sign = s.dir === "asc" ? 1 : -1;

  return (a, b) => {
    const x = val(a);
    const y = val(b);

    if (s.col === "name") return sign * (x.name < y.name ? -1 : x.name > y.name ? 1 : 0);

    return sign * (x[s.col] - y[s.col]);
  };
}

/** The tree with the siblings at every level in the sort's order (none: as it was). */
export function sortTree(tree: readonly TreeNode[], s: ProcSort, byPid: ByPid): readonly TreeNode[] {
  if (!s) return tree;

  const cmp = comparer(s, byPid);
  const order = <T extends TreeNode>(list: readonly T[]): T[] => [...list].sort(cmp);
  const proc = (n: ProcNode): ProcNode => ({ ...n, kids: order(n.kids.map(proc)) });
  const term = (n: TermNode): TermNode => ({ ...n, kids: order(n.kids.map(proc)) });
  const tab = (n: TabNode): TabNode => ({ ...n, kids: order(n.kids.map(term)) });

  return order(tree.map((n): TreeNode => {
    switch (n.kind) {
      case "proc": return proc(n);
      case "term": return term(n);
      case "tab": return tab(n);
      case "space": return { ...n, kids: order(n.kids.map((k) => (k.kind === "tab" ? tab(k) : term(k)))) };
    }
  }));
}

/** The flat view: every process in the tree as a row of its own, in the sort's order. */
export function flatTree(tree: readonly TreeNode[], s: ProcSort, byPid: ByPid): readonly ProcNode[] {
  const seen = new Set<number>();
  const all = tree.flatMap((n) => procsUnder(n, seen)).map((p): ProcNode => ({ ...p, kids: [] }));

  return s ? [...all].sort(comparer(s, byPid)) : all;
}

/** A port as the ports tab sorts it. */
export interface PortRow {
  readonly port: number;
  readonly name: string;
  readonly where: string | null;
}

/** The ports in the sort's order (none: as listed, this app's first); where-less ones last by where. */
export function sortPorts<T extends PortRow>(list: readonly T[], s: PortSort): readonly T[] {
  if (!s) return list;

  const sign = s.dir === "asc" ? 1 : -1;
  const text = (v: string | null): string => (v ?? "￿").toLowerCase();

  return [...list].sort((a, b) => {
    if (s.col === "port") return sign * (a.port - b.port);

    const x = s.col === "name" ? text(a.name) : text(a.where);
    const y = s.col === "name" ? text(b.name) : text(b.where);

    return sign * (x < y ? -1 : x > y ? 1 : 0) || a.port - b.port;
  });
}

/** The arrow a sorted column's head carries. */
export const arrow = (dir: Dir): string => (dir === "asc" ? "↑" : "↓");
