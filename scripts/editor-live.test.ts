// The editor's rendered view, its model (editor/live.ts): a text cut
// into units by their source lines, the unit at a line, the caret's walk from
// unit to unit, a unit's edit spliced back with every other byte kept (a
// corpus of Markdown, CRLF included), and a unit's range followed through
// edits made elsewhere (vim, the commands, undo).
import { test, expect, describe } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { units, unitAt, unitFor, neighbor, slice, splice, follow, itemParts, quoteBody, refs, step } from "../defaults/mods/editor/live.ts";

const DOC = [
  "# Title",                 // 0
  "",                        // 1
  "A paragraph with **bold**", // 2
  "and a second line.",      // 3
  "",                        // 4
  "- one",                   // 5
  "  more of one",           // 6
  "- [ ] two",               // 7
  "  - [x] nested",          // 8
  "1. first",                // 9
  "",                        // 10
  "> quoted",                // 11
  "> still",                 // 12
  "",                        // 13
  "```ts",                   // 14
  "let a = 1;",              // 15
  "",                        // 16
  "```",                     // 17
  "---",                     // 18
  "| a | b |",               // 19
  "|---|---|",               // 20
  "| 1 | 2 |",               // 21
  "",                        // 22
  "Setext",                  // 23
  "======",                  // 24
  "[ref]: https://x.dev",    // 25
].join("\n");

const kinds = (t: string) => units(t).map((u: any) => `${u.kind}${u.level ?? ""} ${u.from}-${u.to}`);

describe("units", () => {
  test("each kind, by its lines", () => {
    expect(kinds(DOC)).toEqual([
      "heading1 0-0", "para 2-3", "item 5-6", "item 7-7", "item 8-8", "item 9-9", "quote 11-12",
      "fence 14-17", "rule 18-18", "table 19-21", "heading1 23-24", "ref 25-25",
    ]);
  });
  test("items know their marker, number, box and indent", () => {
    const it = units(DOC).filter((u: any) => u.kind === "item");
    expect(it.map((u: any) => [u.marker, u.task, u.checked, u.indent, u.number ?? null])).toEqual([
      ["-", false, false, 0, null], ["-", true, false, 0, null], ["-", true, true, 2, null], ["1.", false, false, 0, 1],
    ]);
  });
  test("a fence's blank lines are its own, its language kept; an unclosed one runs to the end", () => {
    expect(units(DOC).find((u: any) => u.kind === "fence")).toMatchObject({ lang: "ts", from: 14, to: 17 });
    expect(kinds("a\n\n```\nx\n\ny")).toEqual(["para 0-0", "fence 2-5"]);
  });
  test("front matter, math, callouts, a footnote with its continuation", () => {
    expect(kinds("---\ntitle: x\n---\n\n$$\nx^2\n$$\n\n> [!NOTE]\n> hi\n\n[^a]: note\n    more")).toEqual(["front 0-2", "fence 4-6", "quote 8-9", "ref 11-12"]);
    expect(units("> [!WARNING] careful")[0].callout).toBe("warning");
  });
  test("--- under text is a heading, alone it's a rule; a lazy line stays in its item", () => {
    expect(kinds("text\n---")).toEqual(["heading2 0-1"]);
    expect(kinds("text\n\n---")).toEqual(["para 0-0", "rule 2-2"]);
    expect(kinds("- item\nlazy\n# h")).toEqual(["item 0-1", "heading1 2-2"]);
  });
  test("an item's indented paragraph after a blank line is still the item", () => {
    expect(kinds("- a\n\n  more a\n- b")).toEqual(["item 0-2", "item 3-3"]);
    expect(kinds("- a\n\nnot a")).toEqual(["item 0-0", "para 2-2"]);
  });
  test("empty text: no units; a caret there gets a blank unit", () => {
    expect(units("")).toEqual([]);
    expect(unitFor([], 0)).toEqual({ kind: "blank", from: 0, to: 0 });
  });
});

describe("the caret's unit and its walk", () => {
  const list = units(DOC);
  test("unitAt finds a line's unit, -1 between them", () => {
    expect(list[unitAt(list, 6)]).toMatchObject({ kind: "item", from: 5 });
    expect(unitAt(list, 4)).toBe(-1);
    expect(unitFor(list, 4)).toEqual({ kind: "blank", from: 4, to: 4 });
  });
  test("neighbors skip blank lines; none past the ends", () => {
    expect(neighbor(list, { from: 2, to: 3 }, 1)).toMatchObject({ from: 5 });
    expect(neighbor(list, { from: 2, to: 3 }, -1)).toMatchObject({ from: 0 });
    expect(neighbor(list, { from: 0, to: 0 }, -1)).toBeNull();
    expect(neighbor(list, { from: 25, to: 25 }, 1)).toBeNull();
  });
  test("up lands on the unit's last line, down on its first, the column kept or clamped", () => {
    expect(step(DOC, list, { from: 5, to: 6 }, -1, 12)).toMatchObject({ line: 3, col: 12 });
    expect(step(DOC, list, { from: 2, to: 3 }, 1, 30)).toMatchObject({ line: 5, col: 5 });
    expect(step(DOC, list, { from: 0, to: 0 }, -1, 0)).toBeNull();
  });
});

describe("splice and the round trip", () => {
  const corpus: [string, string][] = [["DOC", DOC], ["crlf", DOC.replace(/\n/g, "\r\n")], ["no final newline", "a\n\n- b"], ["final newline", "a\n\n- b\n"], ["tabs and trailing spaces", "-\ta  \n\t- b\t\n\n> c  \n"]];
  for (const dir of ["defaults", "docs", "."]) {
    let files: string[] = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { /* none */ }
    for (const f of files) corpus.push([join(dir, f), readFileSync(join(dir, f), "utf8")]);
  }
  test("the corpus has real files in it", () => {
    expect(corpus.length).toBeGreaterThan(6);
  });
  for (const [name, text] of corpus) {
    test(`${name}: units cover every line with text once, in order`, () => {
      const list = units(text);
      const ls = text.split("\n").map((l) => l.replace(/\r$/, ""));
      let last = -1;
      for (const u of list) { expect(u.from).toBeGreaterThan(last); expect(u.to).toBeGreaterThanOrEqual(u.from); last = u.to; }
      ls.forEach((l, i) => { if (l.trim()) expect(unitAt(list, i)).toBeGreaterThanOrEqual(0); });
    });
    test(`${name}: every unit put back as it was gives the text byte for byte`, () => {
      for (const u of units(text)) expect(splice(text, u, slice(text, u)).text).toBe(text);
    });
    test(`${name}: editing one unit leaves every other line as it was`, () => {
      const list = units(text);
      if (!list.length) return;
      const u = list[Math.floor(list.length / 2)];
      const r = splice(text, u, slice(text, u) + "\nadded");
      const a = text.split("\n"), b = r.text.split("\n");
      expect(b.slice(0, u.from)).toEqual(a.slice(0, u.from));
      expect(b.slice(u.to + 2)).toEqual(a.slice(u.to + 1));
      expect(r.range).toEqual({ from: u.from, to: u.to + 1 });
    });
  }
  test("CRLF: the new lines get \\r\\n too, the last line none", () => {
    expect(splice("a\r\nb\r\nc", { from: 1, to: 1 }, "x\ny").text).toBe("a\r\nx\r\ny\r\nc");
    expect(splice("a\r\nb", { from: 1, to: 1 }, "x\ny").text).toBe("a\r\nx\r\ny");
    expect(slice("a\r\nb\r\nc", { from: 0, to: 1 })).toBe("a\nb");
  });
});

describe("follow: the caret's range through edits made elsewhere", () => {
  const r = { from: 2, to: 3 };
  test("an edit above moves it, one below leaves it", () => {
    expect(follow("x\ny\na\nb\nz", "x\nnew\ny\na\nb\nz", r)).toEqual({ from: 3, to: 4 });
    expect(follow("x\ny\na\nb\nz\nw", "x\ny\na\nb\nz\nW", r)).toEqual(r);
  });
  test("a line opened under it (vim o) or above it (O) grows it", () => {
    expect(follow("x\ny\na\nb\nz", "x\ny\na\nb\n\nz", r)).toEqual({ from: 2, to: 4 });
    expect(follow("x\ny\na\nb\nz", "x\ny\n\na\nb\nz", r)).toEqual({ from: 2, to: 4 });
  });
  test("lines of it deleted shrink it; all of it gone leaves one line", () => {
    expect(follow("x\ny\na\nb\nz", "x\ny\na\nz", r)).toEqual({ from: 2, to: 2 });
    expect(follow("x\ny\na\nb\nz", "x\ny\nz", r)).toEqual({ from: 2, to: 2 });
  });
  test("an edit inside it keeps it", () => {
    expect(follow("x\ny\na\nb\nz", "x\ny\nA\nb\nz", r)).toEqual(r);
  });
});

test("an item's body, a quote's body, the references", () => {
  const list = units(DOC);
  expect(itemParts(DOC, list[2])).toEqual({ marker: "-", body: "one\nmore of one" });
  expect(itemParts(DOC, list[3])).toEqual({ marker: "-", body: "two" });
  expect(itemParts(DOC, list[5])).toEqual({ marker: "1.", body: "first" });
  expect(quoteBody(DOC, list[6])).toBe("quoted\nstill");
  expect(refs(DOC, list)).toBe("[ref]: https://x.dev");
});
