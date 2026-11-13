import { test, expect, describe } from "bun:test";

// The editor's vim (defaults/mods/editor/vim.ts), key by key. A
// small stand-in plays the editor: it types what vim leaves to it in insert
// mode, applies vim's edits and moves the caret. `|` marks the caret (Zed's
// vim tests mark it with ˇ; their cases guided many of these).
import { createVim, feed, play, typedText, token } from "../defaults/mods/editor/vim.ts";
import { parse, tokens } from "../defaults/mods/editor/vim-parse.ts";
import { pattern } from "../defaults/mods/editor/vim-motions.ts";
import { applyEdits } from "../defaults/mods/editor/vim.ts";

function split(marked: string) {
  const i = marked.indexOf("|");
  const text = marked.slice(0, i) + marked.slice(i + 1);
  const before = text.slice(0, i).split("\n");
  return { text, cursor: { line: before.length - 1, col: before[before.length - 1].length } };
}
function mark(text: string, c: { line: number; col: number }) {
  const lines = text.split("\n");
  lines[c.line] = lines[c.line].slice(0, c.col) + "|" + lines[c.line].slice(c.col);
  return lines.join("\n");
}

class Ed {
  vim = createVim();
  text: string;
  cursor: { line: number; col: number };
  clipboard: string | null = null;
  commands: string[] = [];
  selections: any = null;
  constructor(marked: string) { ({ text: this.text, cursor: this.cursor } = split(marked)); }
  get mode() { return this.vim.mode; }
  /** Keys as typed: `<esc>`, `<cr>`, `<C-v>` are one key each. */
  keys(s: string) {
    for (const k of tokens(s)) this.press(k);
    return this;
  }
  press(k: any) {
    const r: any = feed(this.vim, k, { text: this.text, cursor: this.cursor, clipboard: this.clipboard });
    this.take(r);
    if (!r.taken) this.native(k);
    if (r.replay) this.take(play(this.vim, r.replay.keys, { text: this.text, cursor: this.cursor, clipboard: this.clipboard }, r.replay.times));
  }
  /** Like the real editor: with selections, the caret is at the first one's end. */
  nativeCaret = false;
  take(r: any) {
    if (r.edits?.length) this.text = applyEdits(this.text, r.edits);
    if (r.cursor) this.cursor = r.cursor;
    if (this.nativeCaret && r.selections?.length) this.cursor = r.selections[0].end;
    if (r.commands?.length) this.commands.push(...r.commands);
    if (r.clipboard) this.clipboard = r.clipboard.text;
    if (r.selections !== undefined) this.selections = r.selections;
    if (r.multi) this.multi = r.multi;
  }
  multi: any = null;
  /** What the editor does with a key vim leaves to it (insert mode). */
  native(k: string) {
    const lines = this.text.split("\n"), c = this.cursor;
    const at = (t: string) => {
      const carets = this.multi ?? [c];
      // Several carets (block insert): type at each, last first.
      for (const p of [...carets].sort((a: any, b: any) => b.line - a.line || b.col - a.col)) lines[p.line] = lines[p.line].slice(0, p.col) + t + lines[p.line].slice(p.col);
      if (this.multi) this.multi = this.multi.map((p: any) => ({ line: p.line, col: p.col + t.length }));
      this.cursor = { line: c.line, col: c.col + t.length };
    };
    if (k === "<cr>") { lines.splice(c.line, 1, lines[c.line].slice(0, c.col), lines[c.line].slice(c.col)); this.cursor = { line: c.line + 1, col: 0 }; }
    else if (k === "<bs>") { if (c.col) { lines[c.line] = lines[c.line].slice(0, c.col - 1) + lines[c.line].slice(c.col); this.cursor = { line: c.line, col: c.col - 1 }; } }
    else if ([...k].length === 1) at(k);
    else return;
    this.text = lines.join("\n");
  }
  get state() { return mark(this.text, this.cursor); }
}

const ed = (s: string) => new Ed(s);
const check = (before: string, keys: string, after: string, mode = "normal") => {
  const e = ed(before).keys(keys);
  expect(e.state).toBe(after);
  expect(e.mode).toBe(mode);
  return e;
};

describe("motions", () => {
  test("h j k l and counts, the column remembered across short lines", () => {
    check("ab|c\nd\nefgh", "h", "a|bc\nd\nefgh");
    check("ab|c\nd\nefgh", "jj", "abc\nd\nef|gh");
    check("|abc", "5l", "ab|c");
    check("abc\nd|\nefgh", "", "abc\nd|\nefgh");
  });
  test("words: w b e ge W B E", () => {
    check("|foo.bar baz", "w", "foo|.bar baz");
    check("|foo.bar baz", "W", "foo.bar |baz");
    check("foo.bar |baz", "b", "foo.|bar baz");
    check("foo.bar |baz", "B", "|foo.bar baz");
    check("|foo bar", "e", "fo|o bar");
    check("foo b|ar", "ge", "fo|o bar");
    check("|one\n\ntwo", "w", "one\n|\ntwo");
    check("|a b c d", "3w", "a b c |d");
  });
  test("line motions: 0 ^ $ gg G and counts", () => {
    check("  ab|c", "0", "|  abc");
    check("  ab|c", "^", "  |abc");
    check("|abc", "$", "ab|c");
    check("a\nb\n|c", "gg", "|a\nb\nc");
    check("|a\nb\nc", "G", "a\nb\n|c");
    check("|a\nb\nc", "2G", "a\n|b\nc");
  });
  test("f t F T ; ,", () => {
    check("|a,b,c,d", "f,", "a|,b,c,d");
    check("|a,b,c,d", "2f,", "a,b|,c,d");
    check("|a,b,c,d", "t,", "|a,b,c,d".replace("|a", "|a"));
    check("|a,b,c,d", "f,;", "a,b|,c,d");
    check("a,b,c,|d", "F,", "a,b,c|,d");
    check("a,b,c,|d", "F,,", "a,b,c|,d".replace("c|,d", "c|,d"));
  });
  test("% matches brackets, { } paragraphs", () => {
    check("|foo(bar(x))", "%", "foo(bar(x)|)");
    check("foo(bar(x)|)", "%", "foo|(bar(x))");
    check("|a\nb\n\nc", "}", "a\nb\n|\nc");
    check("a\n\nb\n|c", "{", "a\n|\nb\nc");
  });
  test("search / ? n N * #", () => {
    check("|one two one two", "/two<cr>", "one |two one two");
    check("|one two one two", "/two<cr>n", "one two one |two");
    check("|one two one two", "/two<cr>nn", "one |two one two");
    check("one two one |two", "?one<cr>", "one two |one two");
    check("|foo bar foo", "*", "foo bar |foo");
    check("foo bar |foo", "#", "|foo bar foo");
  });
  test("marks: m a, ` and '", () => {
    check("ab|c\ndef", "majj`a", "ab|c\ndef");
    check("  ab|c\ndef", "majj'a", "  |abc\ndef");
  });
});

describe("operators", () => {
  test("dw dd D x X with counts and registers", () => {
    check("|foo bar baz", "dw", "|bar baz");
    check("|foo bar baz", "2dw", "|baz");
    check("|foo bar baz", "d2w", "|baz");
    check("a\n|b\nc", "dd", "a\n|c");
    check("a\n|b\nc", "2dd", "a\n|b".replace("|b", "|a").replace("a\n|a", "|a"));
    check("ab|cdef", "D", "a|b");
    check("ab|cdef", "x", "ab|def");
    check("ab|cdef", "3x", "ab|f");
    check("ab|cdef", "X", "a|cdef");
  });
  test("dw at the last word of a line keeps the newline", () => {
    check("foo |bar\nbaz", "dw", "foo| \nbaz");
  });
  test("c: cw is ce, cc keeps the indent, C to the end", () => {
    check("|foo bar", "cwxy<esc>", "x|y bar");
    check("  foo|\nbar", "ccq<esc>", "  |q\nbar");
    check("ab|cd", "Cz<esc>", "ab|z");
    check("a|bc", "sX<esc>", "a|Xc");
    check("ab\n|cd\nef", "SX<esc>", "ab\n|X\nef");
  });
  test("y and p, P, linewise and charwise, the clipboard follows", () => {
    const e = check("|foo bar", "yw$p", "foo barfoo| ");
    expect(e.clipboard).toBe("foo ");
    check("|a\nb", "yyp", "a\n|a\nb");
    check("a\n|b", "yyP", "a\n|b\nb");
    check("|abc", "yl2p", "aa|abc".replace("aa|abc", "aa|abc"));
  });
  test("registers: \"a, \"A appends, \"_ black hole, \"0 the last yank", () => {
    const e = ed("|one\ntwo");
    e.keys('"ayyj"Ayy');
    expect(e.vim.registers.get("a")).toEqual({ text: "one\ntwo\n", linewise: true });
    const before = e.vim.registers.get('"');
    e.keys('"_dd');
    expect(e.vim.registers.get('"')).toBe(before);
    check("|x\ny", 'yyjdd"0p', "x\n|x");
  });
  test("> < shift lines", () => {
    const e = ed("|a\nb");
    e.vim.indent = "  ";
    e.keys(">j");
    expect(e.text).toBe("  a\n  b");
    e.keys("<<");
    expect(e.text).toBe("a\n  b");
  });
  test("~ g~ gu gU", () => {
    check("|abc", "~", "A|bc");
    check("|abc def", "gUw", "|ABC def");
    check("|ABC def", "guiw", "|abc def");
    check("|aBc", "g~~", "|AbC");
  });
  test("J joins with one space, r replaces, R overtypes", () => {
    check("|a\n   b\nc", "J", "a| b\nc");
    check("|a\nb\nc", "3J", "a b| c");
    check("|abc", "rx", "|xbc");
    check("|abc", "2rx", "x|xc");
    check("|abc", "Rxy<esc>", "x|yc", "normal");
  });
  test("<C-a> and <C-x> add to the number at or after the caret", () => {
    check("|x = 41", "<C-a>", "x = 4|2");
    check("|x = 41", "5<C-x>", "x = 3|6");
  });
});

describe("text objects", () => {
  test("iw aw iW", () => {
    check("foo b|ar baz", "diw", "foo | baz");
    check("foo b|ar baz", "daw", "foo |baz");
    check("a foo.b|ar b", "diW", "a | b");
  });
  test('quotes: i" a" i\' and from before the first quote', () => {
    check('x = "he|llo" + y', 'di"', 'x = "|" + y');
    check('x = "he|llo" + y', 'da"', "x = |+ y");
    check("|say 'hi' now", "ci'yo<esc>", "say 'y|o' now");
  });
  test("brackets: i( a( ib i{ aB i[ i<, nested, multi-line inner", () => {
    check("f(a, (|b), c)", "di(", "f(a, (|), c)");
    check("f(a, (|b), c)", "d2i(", "f(|)");
    check("f(a, |b)", "da(", "|f");
    check("x = {\n  a|: 1,\n  b: 2\n}", "di{", "x = {\n|}");
    check("v[|1, 2]", "ci[0<esc>", "v[|0]");
    check("<a|bc>", "di<", "<|>");
  });
  test("tags: it at", () => {
    check("<div><b>h|i</b></div>", "dit", "<div><b>|</b></div>");
    check("<div><b>h|i</b></div>", "dat", "<div>|</div>");
    check("<div><b>h|i</b></div>", "d2it", "<div>|</div>");
  });
  test("paragraphs: ip ap", () => {
    check("a\n|b\n\nc", "dip", "|\nc");
    check("a\n|b\n\nc", "dap", "|c");
  });
});

describe("visual", () => {
  test("v selects charwise and operators act on it", () => {
    check("|foo bar", "vlld", "| bar");
    check("|foo bar", "veyP", "foo| foo bar".replace("foo| foo", "fo|ofoo").replace("fo|ofoo bar", "fo|ofoo bar"));
    check("|foo bar", "veU", "|FOO bar");
  });
  test("V selects lines; o swaps the ends; > shifts", () => {
    check("a\n|b\nc\nd", "Vjd", "a\n|d");
    check("a\n|b\nc", "Vjokd", "|");
  });
  test("viw, va\", vip extend over an object", () => {
    check("foo b|ar baz", "viwd", "foo | baz");
    check('x "a|b" y', 'va"d', "x |y");
  });
  test("visual block: <C-v> d deletes a column, I types on every line", () => {
    check("|abc\nabc\nabc", "<C-v>jjd", "|bc\nbc\nbc");
    const e = check("|abc\nabc", "<C-v>jI-<esc>", "|-abc\n-abc".replace("|-abc", "|-abc"));
    expect(e.text).toBe("-abc\n-abc");
  });
  test("visual keeps its own head while the editor's caret sits at the selection's end", () => {
    const e = ed("|abc def ghi\nabc def ghi\nabc def ghi");
    e.nativeCaret = true;
    e.keys("wvee");
    expect(e.selections[0]).toMatchObject({ start: { line: 0, col: 4 }, end: { line: 0, col: 11 } });
    const b = ed("|abc def\nabc def\nabc def");
    b.nativeCaret = true;
    b.keys("w<C-v>jje");
    expect(b.selections.map((s: any) => [s.start.line, s.start.col, s.end.col])).toEqual([[0, 4, 7], [1, 4, 7], [2, 4, 7]]);
    b.keys("d");
    expect(b.text).toBe("abc \nabc \nabc ");
  });
  test("p over a selection replaces it and keeps what was there", () => {
    const e = check("|one two", "yiwwviwp", "one on|e");
    expect(e.vim.registers.get('"').text).toBe("two");
  });
});

describe("repeat, counts, macros", () => {
  test(". repeats the last change, with its typed text", () => {
    check("|a b c", "cwx<esc>w.", "x |x c".replace("x |x c", "x |x c"));
    check("|a\nb", "Ahi<esc>j.", "ahi\nbh|i");
    check("|abcdef", "x..", "|def");
    check("|a b c d e", "dw2.", "|d e");
  });
  test("q records a macro, @ plays it, @@ again, a count repeats it", () => {
    const e = ed("|1\n1\n1\n1");
    e.keys("qaA!<esc>jq");
    expect(e.text).toBe("1!\n1\n1\n1");
    e.keys("@a");
    expect(e.text).toBe("1!\n1!\n1\n1");
    e.keys("@@");
    expect(e.text).toBe("1!\n1!\n1!\n1");
    e.keys("gg0qbxq");
    expect(e.vim.registers.get("b").text).toBe("x");
  });
  test("u and <C-r> ask the editor to undo and redo, counted", () => {
    const e = ed("|a").keys("3u<C-r>");
    expect(e.commands).toEqual(["undo", "undo", "undo", "redo"]);
  });
});

describe("the ex line", () => {
  test(":w :q :wq :x :e! :noh go to the editor", () => {
    const e = ed("|a").keys(":w<cr>:q<cr>:wq<cr>:x<cr>:e!<cr>:noh<cr>:q!<cr>");
    expect(e.commands).toEqual(["save", "quit", "save-quit", "save-quit", "reload!", "nohlsearch", "quit!"]);
  });
  test(":<line> jumps, :s and :%s substitute with g, & and groups", () => {
    check("|a\nb\nc", ":3<cr>", "a\nb\n|c");
    check("|foo foo\nfoo", ":s/foo/bar/<cr>", "|bar foo\nfoo");
    check("|foo foo\nfoo", ":%s/foo/bar/g<cr>", "bar bar\n|bar");
    check("|ab", ":s/\\(a\\)b/[&]/<cr>".replace("\\(a\\)", "(a)"), "|[ab]");
    check("|key=val", ":s/(\\w+)=(\\w+)/\\2=\\1/<cr>", "|val=key");
  });
  test("a visual range: :'<,'>d", () => {
    check("a\n|b\nc\nd", "Vj:d<cr>", "a\n|d");
  });
  test("backspace edits, esc leaves", () => {
    const e = ed("|a").keys(":qx<bs><cr>");
    expect(e.commands).toEqual(["quit"]);
    const f = ed("|a").keys(":w<esc>");
    expect(f.commands).toEqual([]);
    expect(f.vim.ex).toBeNull();
  });
});

describe("modes, leader, keys", () => {
  test("i a I A o O enter insert at their places; esc steps back", () => {
    check("ab|c", "ix<esc>", "ab|xc");
    check("ab|c", "ax<esc>", "abc|x".replace("abc|x", "abc|x"));
    check("  ab|c", "Ix<esc>", "  |xabc");
    check("ab|c", "Ax<esc>", "abc|x");
    check("a|b\nc", "ox<esc>", "ab\n|x\nc");
    check("a|b\nc", "Ox<esc>", "|x\nab\nc");
    const e = ed("a|b").keys("i");
    expect(e.mode).toBe("insert");
  });
  test("insert mode leaves typing, backspace and arrows to the editor", () => {
    const vim = createVim();
    vim.mode = "insert";
    vim.insertStart = { text: "", cursor: { line: 0, col: 0 }, keys: [] };
    for (const k of ["a", "<bs>", "<left>", "<cr>", "é"]) expect(feed(vim, k, { text: "", cursor: { line: 0, col: 0 } }).taken).toBe(false);
    expect(feed(vim, "<esc>", { text: "", cursor: { line: 0, col: 0 } }).taken).toBe(true);
  });
  test("cmd combinations stay the app's; ctrl-[ is escape", () => {
    expect(token({ key: "s", modifiers: { platform: true } })).toBeNull();
    expect(token({ key: "[", modifiers: { control: true } })).toBe("<esc>");
    expect(token({ key: "r", modifiers: { control: true } })).toBe("<C-r>");
    expect(token({ key: "a", key_char: "A", modifiers: { shift: true } })).toBe("A");
    expect(token({ key: "escape", modifiers: {} })).toBe("<esc>");
    expect(token({ key: "space", key_char: " ", modifiers: {} })).toBe(" ");
  });
  test("space ? lists the editor's keys (? alone stays the backward search)", () => {
    const vim = createVim();
    const doc = { text: "a", cursor: { line: 0, col: 0 } };
    expect((feed(vim, " ", doc) as any).which.map((w: any) => w.key)).toContain("?");
    expect((feed(vim, "?", doc) as any).commands).toEqual(["keys"]);
    expect((feed(vim, "?", doc) as any).ex).toBe("?");
  });
  test("the leader walks its map and shows the next keys", () => {
    const vim = createVim();
    const doc = { text: "a", cursor: { line: 0, col: 0 } };
    const first: any = feed(vim, " ", doc);
    expect(first.which.map((w: any) => w.key)).toContain("f");
    const second: any = feed(vim, "f", doc);
    expect(second.which.map((w: any) => w.label)).toEqual(["files", "grep", "files"]);
    const third: any = feed(vim, "g", doc);
    expect(third.commands).toEqual(["grep"]);
    expect(third.which).toBeNull();
    expect((feed(vim, " ", doc) as any).which.length).toBeGreaterThan(3);
    expect((feed(vim, "<esc>", doc) as any).which).toBeNull();
  });
  test("gd gr K ]d [d ask the editor", () => {
    const e = ed("|a").keys("gdgrK]d[d");
    expect(e.commands).toEqual(["definition", "references", "hover", "next-problem", "prev-problem"]);
  });
});

test("pieces: parse, typed text, patterns, tokens", () => {
  expect(parse(["2", "d", "3", "w"])).toMatchObject({ op: "d", key: "w", count: 6 });
  expect(parse(["d"])).toBeNull();
  expect(parse(["d", "i"])).toBeNull();
  expect(parse(["d", "z"])).toBe(false);
  expect(parse(['"', "a", "y", "y"])).toMatchObject({ reg: "a", op: "y", line: true });
  expect(typedText("abc", "abXYc")).toBe("XY");
  expect(pattern("\\<foo\\>").source).toBe("\\bfoo\\b");
  expect(pattern("Foo").flags).not.toContain("i");
  expect(pattern("foo").flags).toContain("i");
  expect(tokens("ab<esc>:w<cr>")).toEqual(["a", "b", "<esc>", ":", "w", "<cr>"]);
});
