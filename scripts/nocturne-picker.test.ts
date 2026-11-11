import { test, expect } from "bun:test";

// The picker's decisions (defaults/mods/nocturne-picker/logic.js).
import { marks, split, nameRanges, dirRanges, grepRows, move, first, around, lineRuns } from "../defaults/mods/nocturne-picker/logic.js";

test("matched characters are marked, ranges in any order and overlapping", () => {
  expect(marks("picker.rs", [[0, 1], [3, 4], [7, 9]])).toEqual([["p", true], ["ic", false], ["k", true], ["er.", false], ["rs", true]]);
  expect(marks("abc", [[1, 3], [0, 2]])).toEqual([["abc", true]]);
  expect(marks("abc", [])).toEqual([["abc", false]]);
  expect(marks("abc", [[2, 9]])).toEqual([["ab", false], ["c", true]]);
});

test("a path's ranges split between its name and its folder", () => {
  const path = "src/picker.rs"; // name starts at 4
  expect(split(path)).toEqual({ name: "picker.rs", dir: "src", at: 4 });
  expect(split("a.rs")).toEqual({ name: "a.rs", dir: "", at: 0 });
  expect(nameRanges(path, [[0, 1], [4, 6], [11, 13]])).toEqual([[0, 2], [7, 9]]);
  expect(dirRanges(path, [[0, 1], [4, 6]])).toEqual([[0, 1]]);
});

const matches = [
  { path: "a.rs", line: 3, col: 1, text: "x", ranges: [[0, 1]] },
  { path: "b.rs", line: 1, col: 0, text: "x", ranges: [[0, 1]] },
  { path: "a.rs", line: 9, col: 0, text: "x", ranges: [[0, 1]] },
];

test("grep's lines group by file in the order they came", () => {
  const rows = grepRows(matches);
  expect(rows.map((r) => (r.head ? `# ${r.path} ${r.count}` : `${r.path}:${r.match.line}`))).toEqual(["# a.rs 2", "a.rs:3", "a.rs:9", "# b.rs 1", "b.rs:1"]);
});

test("the keys move over lines, skipping heads, stopping at the ends", () => {
  const rows = grepRows(matches);
  expect(first(rows)).toBe(1);
  expect(move(rows, 1, 1)).toBe(2);
  expect(move(rows, 2, 1)).toBe(4);
  expect(move(rows, 4, 1)).toBe(4);
  expect(move(rows, 4, -1)).toBe(2);
  expect(move(rows, 1, -1)).toBe(1);
  expect(first([])).toBe(-1);
});

test("the preview shows the lines around the line, more below", () => {
  const text = Array.from({ length: 100 }, (_, i) => `l${i + 1}`).join("\n");
  const a = around(text, 50, 24);
  expect(a.from).toBe(42);
  expect(a.lines.length).toBe(24);
  expect(a.lines[50 - a.from]).toBe("l50");
  expect(around(text, 1, 24).from).toBe(1);
  const end = around(text, 100, 24);
  expect(end.lines[end.lines.length - 1]).toBe("l100");
  expect(around("one", 5, 24)).toEqual({ from: 1, lines: ["one"] });
});

test("a grep line's colored runs split where its matches start and end", () => {
  expect(lineRuns([["let ", "kw"], ["needle", null], [" = 1", null]], [[2, 8]])).toEqual([
    ["le", "kw", false], ["t ", "kw", true], ["need", null, true], ["le", null, false], [" = 1", null, false],
  ]);
  expect(lineRuns([["abc", null]], [])).toEqual([["abc", null, false]]);
});
