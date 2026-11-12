// The editor's Markdown commands (nocturne-editor/mdedit.js): each from a
// text and a selection to the new text and selection, written here with `|`
// for a caret and «…» for a selection; running one again takes it off; the
// lines a command isn't about stay byte for byte.
import { test, expect, describe } from "bun:test";
import { run, enter, active, spans, links, tickLine, COMMANDS } from "../defaults/mods/nocturne-editor/mdedit.js";

type P = { line: number; col: number };
/** "a «b» c" or "a|b" -> { text, sel }. */
function parse(s: string) {
  const at = (i: number): P => { const before = s.slice(0, i).replace(/[«»|]/g, "").split("\n"); return { line: before.length - 1, col: before[before.length - 1].length }; };
  const c = s.indexOf("|"), a = s.indexOf("«"), b = s.indexOf("»");
  const text = s.replace(/[«»|]/g, "");
  if (c >= 0) { const p = at(c); return { text, sel: { start: p, end: p } }; }
  return { text, sel: { start: at(a), end: at(b) } };
}
function show(text: string, sel: { start: P; end: P }) {
  const lines = text.split("\n");
  const off = (p: P) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.col;
  const a = off(sel.start), b = off(sel.end);
  if (a === b) return text.slice(0, a) + "|" + text.slice(a);
  return text.slice(0, a) + "«" + text.slice(a, b) + "»" + text.slice(b);
}
const go = (name: string, s: string) => { const { text, sel } = parse(s); const r = run(name, text, sel); return r ? show(r.text, r.sel) : null; };
/** Runs it, then again on what came out: -> [once, twice]. */
const twice = (name: string, s: string) => {
  const once = go(name, s);
  return [once, once == null ? null : go(name, once)];
};

describe("inline marks", () => {
  test("bold wraps a selection and takes it off again", () => {
    expect(twice("bold", "a «word» here")).toEqual(["a **«word»** here", "a «word» here"]);
  });
  test("bold on the selection that includes its marks takes them off", () => {
    expect(go("bold", "a «**word**» here")).toBe("a «word» here");
  });
  test("a caret in a word bolds the word; inside bold text it comes off", () => {
    expect(go("bold", "a wo|rd here")).toBe("a **wo|rd** here");
    expect(go("bold", "a **wo|rd** here")).toBe("a wo|rd here");
  });
  test("a caret between words leaves the marks to type into", () => {
    expect(go("bold", "a | b")).toBe("a **|** b");
    expect(go("italic", "|")).toBe("_|_");
  });
  test("spaces at a selection's ends stay outside the marks", () => {
    expect(go("bold", "a« word »b")).toBe("a **«word»** b");
  });
  test("italic: _ written, * and _ both read", () => {
    expect(twice("italic", "x «y» z")).toEqual(["x _«y»_ z", "x «y» z"]);
    expect(go("italic", "x *y|y* z")).toBe("x y|y z");
    expect(go("italic", "x ***b|b*** z")).toBe("x **b|b** z");
  });
  test("italic doesn't take bold for itself", () => {
    expect(go("italic", "x **b|b** z")).toBe("x **_b|b_** z");
  });
  test("code: a span with backticks inside gets a longer fence", () => {
    expect(twice("code", "run «a`b» now")).toEqual(["run ``«a`b»`` now", "run «a`b» now"]);
    expect(go("code", "run «`x`» now")).toBe("run «x» now");
  });
  test("code: a caret inside a span takes it off; a caret in a word inserts the pair", () => {
    expect(go("code", "run `l|s` now")).toBe("run l|s now");
    expect(go("code", "a |b")).toBe("a `|`b");
  });
  test("marks inside a code span don't count", () => {
    expect(spans("`**x**` and **y**", "bold").map((s: any) => [s.from, s.to])).toEqual([[12, 17]]);
  });
  test("over lines: each line's part, and off again", () => {
    expect(twice("bold", "a «one\ntwo» b")).toEqual(["a **«one**\n**two»** b", "a «one\ntwo» b"]);
  });
});

describe("links", () => {
  test("a selection becomes the text, the url selected to type over", () => {
    expect(go("link", "see «the plan» now")).toBe("see [the plan](«url») now");
  });
  test("a caret in a word links the word", () => {
    expect(go("link", "see pl|an now")).toBe("see [plan](«url») now");
  });
  test("nothing there: [text](url) with the text selected", () => {
    expect(go("link", "see |")).toBe("see [«text»](url)");
  });
  test("a URL selected becomes the target, the caret in the text", () => {
    expect(go("link", "«https://x.dev/a»")).toBe("[|](https://x.dev/a)");
  });
  test("on a link: back to its text", () => {
    expect(go("link", "see [the pl|an](docs/plan.md) now")).toBe("see the pl|an now");
  });
  test("links() finds text and url, not images", () => {
    expect(links("![i](a.png) [t](u)")).toEqual([{ from: 12, to: 18, text: [13, 14], url: [16, 17] }]);
  });
});

describe("headings", () => {
  test("up: text -> # ; ## -> # ; # stays", () => {
    expect(go("heading-up", "Ti|tle")).toBe("# Ti|tle");
    expect(go("heading-up", "## Ti|tle")).toBe("# Ti|tle");
    expect(go("heading-up", "# Ti|tle")).toBeNull();
  });
  test("down: # -> ## ... ###### -> text; text stays", () => {
    expect(go("heading-down", "# Ti|tle")).toBe("## Ti|tle");
    expect(go("heading-down", "###### Ti|tle")).toBe("Ti|tle");
    expect(go("heading-down", "Ti|tle")).toBeNull();
  });
  test("up then down comes back", () => {
    const up = go("heading-up", "## a|b")!;
    expect(go("heading-down", up)).toBe("## a|b");
  });
  test("a level straight, 0 back to text; closing #s go", () => {
    expect(go("heading-3", "a|b")).toBe("### a|b");
    expect(go("heading-0", "## a|b ##")).toBe("a|b");
  });
  test("a caret in the marks lands at the text", () => {
    expect(go("heading-down", "#| Title")).toBe("## |Title");
  });
  test("setext headings become ATX, their underline gone", () => {
    expect(go("heading-down", "Ti|tle\n=====\nnext")).toBe("## Ti|tle\nnext");
    expect(go("heading-up", "Ti|tle\n-----")).toBe("# Ti|tle");
  });
  test("the other lines stay as they were", () => {
    expect(go("heading-up", "keep  \r\n|x\r\nkeep\t")).toBe("keep  \r\n# |x\r\nkeep\t");
  });
});

describe("lists, tasks, quotes", () => {
  test("bullets on and off over lines; blank lines between stay blank", () => {
    expect(twice("bullets", "«a\n\nb»")).toEqual(["- «a\n\n- b»", "«a\n\nb»"]);
  });
  test("bullets from a numbered list and from tasks", () => {
    expect(go("bullets", "1. a|")).toBe("- a|");
    expect(go("bullets", "- [x] a|")).toBe("- a|");
  });
  test("bullets keep the indent", () => {
    expect(go("bullets", "  a|")).toBe("  - a|");
  });
  test("numbers count on, and come off", () => {
    expect(twice("numbers", "«a\nb\nc»")).toEqual(["1. «a\n2. b\n3. c»", "«a\nb\nc»"]);
  });
  test("numbers go on from an item above", () => {
    expect(go("numbers", "1. a\n2. b\n|c")).toBe("1. a\n2. b\n3. |c");
  });
  test("task: a box on a line, a bullet, a numbered item; off again keeps the bullet", () => {
    expect(twice("task", "do |it")).toEqual(["- [ ] do |it", "- do |it"]);
    expect(go("task", "- do |it")).toBe("- [ ] do |it");
    expect(go("task", "2. do |it")).toBe("2. [ ] do |it");
  });
  test("tick: [ ] <-> [x]; mixed lines all ticked first", () => {
    expect(twice("tick", "- [ ] a|")).toEqual(["- [x] a|", "- [ ] a|"]);
    expect(go("tick", "«- [x] a\n- [ ] b»")).toBe("«- [x] a\n- [x] b»");
    expect(go("tick", "plain |line")).toBeNull();
  });
  test("tickLine ticks the task on a line (a click on its box)", () => {
    expect(tickLine("a\n- [ ] b", 1)!.text).toBe("a\n- [x] b");
    expect(tickLine("a\n- b", 1)).toBeNull();
  });
  test("quote on and off, blank lines inside keep the quote going", () => {
    expect(twice("quote", "«a\n\nb»")).toEqual(["> «a\n>\n> b»", "«a\n\nb»"]);
    expect(go("quote", "|")).toBe("> |");
  });
});

describe("code blocks and rules", () => {
  test("a fence around the lines, off again from inside", () => {
    expect(twice("fence", "«a\nb»")).toEqual(["```\n«a\nb»\n```", "«a\nb»"]);
  });
  test("an empty line becomes an empty block, the caret inside", () => {
    expect(go("fence", "x\n|\ny")).toBe("x\n```\n|\n```\ny");
  });
  test("a block holding ``` gets a longer fence", () => {
    expect(go("fence", "«```\nx»")).toBe("````\n«```\nx»\n````");
  });
  test("a caret in a block takes its fences off", () => {
    expect(go("fence", "```ts\nlet |a\n```\nafter")).toBe("let |a\nafter");
  });
  test("rule: after the line, with a blank line so the text stays text", () => {
    expect(go("rule", "te|xt\nnext")).toBe("text\n\n---\n|\nnext");
    expect(go("rule", "text\n|")).toBe("text\n\n---\n|");
  });
});

describe("enter in a list", () => {
  const ent = (s: string) => { const { text, sel } = parse(s); const r = enter(text, sel); return r ? show(r.text, r.sel) : null; };
  test("the next item starts the same way", () => {
    expect(ent("- one|")).toBe("- one\n- |");
    expect(ent("1. one|")).toBe("1. one\n2. |");
    expect(ent("  - [x] done|")).toBe("  - [x] done\n  - [ ] |");
    expect(ent("> said|")).toBe("> said\n> |");
  });
  test("in the middle of an item, the rest goes along", () => {
    expect(ent("- on|e")).toBe("- on\n- |e");
  });
  test("an empty item ends the list", () => {
    expect(ent("- a\n- |")).toBe("- a\n|");
  });
  test("plain text, a code block, a selection: the editor's own enter", () => {
    expect(ent("text|")).toBeNull();
    expect(ent("```\n- a|\n```")).toBeNull();
    expect(ent("- «a»")).toBeNull();
  });
});

test("active: what's on at the caret", () => {
  const on = (s: string) => { const { text, sel } = parse(s); return [...active(text, sel)].sort(); };
  expect(on("**_a|b_**")).toEqual(["bold", "italic"]);
  expect(on("- [x] **a|**")).toEqual(["bold", "task", "tick"]);
  expect(on("## T|")).toEqual(["heading-2"]);
  expect(on("> 1. a|")).toEqual(["quote"]);
  expect(on("```\nx|\n```")).toEqual(["fence"]);
  expect(on("see [a|b](u)")).toEqual(["link"]);
});

test("every command has a title, a menu key of its own and a mark", () => {
  const keys = Object.values(COMMANDS).map((c: any) => c[1]);
  expect(new Set(keys).size).toBe(keys.length);
  for (const [name, c] of Object.entries(COMMANDS) as any) {
    expect(c[0].length).toBeGreaterThan(2);
    expect(go(name, "|") === null || typeof go(name, "|") === "string").toBe(true);
  }
});
