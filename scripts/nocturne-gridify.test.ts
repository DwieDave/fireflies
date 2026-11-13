import { test, expect } from "bun:test";
import { gridRows, gridMoves, simulate } from "../defaults/mods/nocturne/grid.ts";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

test("1..9 panes: about square, rows filled left to right", () => {
  const shapes = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => gridRows(ids(n)).map((r) => r.length));
  expect(shapes).toEqual([[1], [2], [2, 1], [2, 2], [3, 2], [3, 3], [3, 3, 1], [3, 3, 2], [3, 3, 3]]);
  expect(gridRows(ids(5))).toEqual([["p1", "p2", "p3"], ["p4", "p5"]]);
});

test("columns can be asked for, within 1..n", () => {
  expect(gridRows(ids(6), 2).map((r) => r.length)).toEqual([2, 2, 2]);
  expect(gridRows(ids(3), 9).map((r) => r.length)).toEqual([3]);
  expect(gridRows(ids(3), 0).map((r) => r.length)).toEqual([1, 1, 1]);
});

test("fewer than two panes: nothing to move", () => {
  expect(gridMoves([])).toEqual([]);
  expect(gridMoves(["p1"])).toEqual([]);
});

test("every pane but the first leaves, then comes back once", () => {
  for (let n = 2; n <= 9; n++) {
    const m = gridMoves(ids(n));
    const out = m.filter((x) => x.out).map((x) => x.pane);
    const back = m.filter((x) => !x.out).map((x) => x.pane);
    expect(out).toEqual(ids(n).slice(1));
    expect([...back].sort()).toEqual(ids(n).slice(1).sort());
    // Each one comes back beside a pane that's already there.
    const there = new Set(["p1"]);
    for (const x of m.filter((y) => !y.out)) { expect(there.has(x.target)).toBe(true); there.add(x.pane); }
  }
});

test("the result is a column of rows, in order", () => {
  const grid = (n: number, c: number | null = null) => simulate(ids(n), gridMoves(ids(n), c));
  expect(grid(2)).toEqual({ row: ["p1", "p2"] });
  expect(grid(4)).toEqual({ column: [{ row: ["p1", "p2"] }, { row: ["p3", "p4"] }] });
  expect(grid(5)).toEqual({ column: [{ row: ["p1", "p2", "p3"] }, { row: ["p4", "p5"] }] });
  expect(grid(6)).toEqual({ column: [{ row: ["p1", "p2", "p3"] }, { row: ["p4", "p5", "p6"] }] });
  expect(grid(7)).toEqual({ column: [{ row: ["p1", "p2", "p3"] }, { row: ["p4", "p5", "p6"] }, "p7"] });
  expect(grid(9)).toEqual({ column: [1, 4, 7].map((i) => ({ row: [`p${i}`, `p${i + 1}`, `p${i + 2}`] })) });
  expect(grid(6, 6)).toEqual({ row: ids(6) });
});

test("mixed splits: the tab's pane order decides, not its old shape", () => {
  // row[ column[a, b], c, column[d, row[e, f]] ] lists as a b c d e f.
  const order = ["a", "b", "c", "d", "e", "f"];
  expect(simulate(order, gridMoves(order))).toEqual({ column: [{ row: ["a", "b", "c"] }, { row: ["d", "e", "f"] }] });
});
