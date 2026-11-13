// The process deck's sorting, free of the view (defaults/mods/procs/sort.ts):
// Developer: "make the processes sortable by the columns too (cpu,mem,etc)".
// The order per column and direction in the tree (siblings at each level, a
// group by what's under it) and flat, the ports' columns, a click and the
// keys' steps, the record kept in shared state.
import { test, expect } from "bun:test";
import { PROC_COLS, PORT_COLS, isSorts, clickSort, stepSort, turnSort, numeric, sortTree, flatTree, sortPorts, firstDir, arrow } from "../defaults/mods/procs/sort.ts";
import { parsePs, parseComm, index, buildTree } from "../defaults/mods/procs/logic.ts";
import { COMM, PS, TERMS, PANES, SPACES } from "./fixtures/procs.ts";

const procs = parsePs(PS, parseComm(COMM));
const ix = index(procs);
const tree = buildTree({ procs, me: "dev", ix, terminals: TERMS, panes: PANES, spaces: SPACES } as any);
/** The keys at each level, depth first, as "key[kids…]". */
const shape = (nodes: readonly any[]): string[] => nodes.map((n) => (n.kids.length ? `${n.key}[${shape(n.kids).join(" ")}]` : n.key));
const pids = (nodes: readonly any[]) => nodes.map((n) => n.pid);

test("the columns, and which way each sorts first: the biggest numbers first, names and pids from the start", () => {
  expect([...PROC_COLS]).toEqual(["name", "cpu", "mem", "up", "pid"]);
  expect([...PORT_COLS]).toEqual(["port", "name", "where"]);
  expect(PROC_COLS.map(firstDir)).toEqual(["asc", "desc", "desc", "desc", "asc"]);
  expect([arrow("asc"), arrow("desc")]).toEqual(["↑", "↓"]);
});

test("a click sorts by its column; a second click turns it; another column starts its own way", () => {
  let s = clickSort(null, "cpu");
  expect(s).toEqual({ col: "cpu", dir: "desc" });
  s = clickSort(s, "cpu");
  expect(s).toEqual({ col: "cpu", dir: "asc" });
  expect(clickSort(s, "name")).toEqual({ col: "name", dir: "asc" });
});

test("s steps through the columns and back to the tree's own order; S turns the direction", () => {
  const seen: any[] = [];
  let s: any = null;
  for (let i = 0; i < 6; i++) { s = stepSort(s, PROC_COLS); seen.push(s?.col ?? null); }
  expect(seen).toEqual(["name", "cpu", "mem", "up", "pid", null]);
  expect(turnSort({ col: "mem", dir: "desc" })).toEqual({ col: "mem", dir: "asc" });
  expect(turnSort(null)).toBe(null);
  expect([numeric(null), numeric({ col: "name", dir: "asc" }), numeric({ col: "cpu", dir: "desc" })]).toEqual([false, false, true]);
});

test("no sort: the tree as built", () => {
  expect(sortTree(tree, null, ix.byPid)).toBe(tree);
});

test("the tree by cpu: the siblings at each level, a group by the sum of what's under it", () => {
  const s1 = (list: string[]) => list.find((x) => x.startsWith("s:s1"))!;
  const down = shape(sortTree(tree, { col: "cpu", dir: "desc" }, ix.byPid)).map((x) => x);
  // tA (t4: claude 3.1 + rustc 98.2 + cargo 0.4 …) before tB (t7: bun 0.2 + node 1.4 + esbuild 0).
  expect(down[0]).toMatch(/^s:s1\[t:tA\[.*\] t:tB\[/);
  // Another machine's space and "no pane" (t9, its process gone) sum to nothing: last going down, first going up, as they were.
  expect(down.slice(1)).toEqual(["s:s2", "s:~[x:t9]"]);
  const up = shape(sortTree(tree, { col: "cpu", dir: "asc" }, ix.byPid));
  expect(up.slice(0, 2)).toEqual(["s:s2", "s:~[x:t9]"]);
  expect(s1(up)).toMatch(/^s:s1\[t:tB\[.*\] t:tA\[/);
  // Inside t7: bun's children by their own cpu: node (1.4) has esbuild under it; one child only, so as is.
  expect(down[0]).toContain("x:t7[p:50112[p:50118[p:50121]]]");
});

test("the tree by memory, uptime, pid and name", () => {
  const first = (col: any, dir: any) => (sortTree(tree, { col, dir }, ix.byPid).find((n: any) => n.key === "s:s1") as any).kids.map((k: any) => k.key);
  expect(first("mem", "desc")).toEqual(["t:tA", "t:tB"]); // rustc's 1.9 GB under tA
  expect(first("mem", "asc")).toEqual(["t:tB", "t:tA"]);
  expect(first("up", "desc")).toEqual(["t:tA", "t:tB"]); // the shell 1:12:04 vs bun 38:10
  expect(first("pid", "asc")).toEqual(["t:tA", "t:tB"]); // 1467 vs 50112
  expect(first("pid", "desc")).toEqual(["t:tB", "t:tA"]);
  expect(first("name", "asc")).toEqual(["t:tB", "t:tA"]); // "api" before "claude"
});

test("the flat view: every process once, at one level, in the sort's order", () => {
  const flat = flatTree(tree, { col: "cpu", dir: "desc" }, ix.byPid);
  expect(pids(flat)).toEqual([52391, 41872, 50118, 52214, 50112, 1467, 52210, 50121]);
  expect(flat.every((n: any) => n.kids.length === 0)).toBe(true);
  expect(pids(flatTree(tree, { col: "mem", dir: "desc" }, ix.byPid))[0]).toBe(52391);
  expect(pids(flatTree(tree, { col: "pid", dir: "asc" }, ix.byPid))).toEqual([1467, 41872, 50112, 50118, 50121, 52210, 52214, 52391]);
});

test("the ports by port, process and where, each both ways; none: as listed", () => {
  const list = [
    { port: 8080, name: "claude", where: "fireflies › claude" },
    { port: 5173, name: "node", where: "fireflies › api" },
    { port: 6000, name: "cupsd", where: null },
  ];
  expect(sortPorts(list, null)).toBe(list);
  expect(sortPorts(list, { col: "port", dir: "asc" }).map((x) => x.port)).toEqual([5173, 6000, 8080]);
  expect(sortPorts(list, { col: "port", dir: "desc" }).map((x) => x.port)).toEqual([8080, 6000, 5173]);
  expect(sortPorts(list, { col: "name", dir: "asc" }).map((x) => x.name)).toEqual(["claude", "cupsd", "node"]);
  expect(sortPorts(list, { col: "name", dir: "desc" }).map((x) => x.name)).toEqual(["node", "cupsd", "claude"]);
  expect(sortPorts(list, { col: "where", dir: "asc" }).map((x) => x.port)).toEqual([5173, 8080, 6000]);
});

test("the record kept across opens: its shape", () => {
  expect(isSorts({ procs: { col: "cpu", dir: "desc" }, ports: null, flat: true })).toBe(true);
  expect(isSorts({ procs: { col: "gpu", dir: "desc" }, ports: null, flat: true })).toBe(false);
  expect(isSorts({ procs: null, ports: { col: "port", dir: "up" }, flat: false })).toBe(false);
});
