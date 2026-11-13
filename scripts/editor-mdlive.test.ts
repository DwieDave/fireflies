// The rendered Markdown view as Developer types into it (editor's
// rendered.ts through the whole pane): a block that stays one stable thing
// while typed into (its editor never emptied and refilled, its height never
// dropped to a guess), no character lost through autosaves and reloads, work
// per key that doesn't grow with the document; adding blocks by keys and by
// pointer; vim over the whole text across blocks; the bar's way to the
// Markdown commands. The editor stand-in behaves as gpui-base's does where
// it matters: set_value fires no change and resets the caret, an edit's
// change event comes after the keystroke (when the effects flush), typing
// lands where the caret is. mock.module is process-wide: this file runs alone.
import { test, expect, mock, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";

class El {
  kids: any[] = [];
  calls: Record<string, any[]> = {};
  constructor() {
    return new Proxy(this, {
      get: (t, k: string, proxy) => k in t ? (t as any)[k] : k === "then" ? undefined : (...a: any[]) => {
        if (k === "child") t.kids.push(a[0]);
        else if (k === "children") t.kids.push(...a[0]);
        else if (k === "when") { if (a[0]) a[1](proxy); }
        else if (k === "map") return a[0](proxy);
        else (t.calls[k] ??= []).push(a);
        return proxy;
      },
    });
  }
}
const texts = (e: any): string[] => typeof e === "string" ? [e] : e instanceof Object && "kids" in e ? e.kids.flatMap(texts) : [];
const all = (e: any): any[] => (e?.kids ? [e, ...e.kids.flatMap(all)] : []);
const byId = (root: any, id: string) => all(root).find((x) => x.calls?.id?.[0]?.[0] === id);
const click = (el: any) => el.calls.on_click[0][0]({}, cx());
const theme: any = new Proxy({}, { get: () => "#808080" });

// ---- herdr
const files: Record<string, string> = {};
const writes: [string, string][] = [];
let propsNow: any = { path: "/p/notes.md", slot: "s1" };
let writeGate: Promise<void> | null = null; // a write held open (a slow disk)
const herdr: Record<string, any> = {
  settings: () => ({ zoom: 1, editor: { vim: false } }), window: () => ({ platform: "macos" }), appHome: () => "/tmp/app", home: () => "/home/a",
  props: () => propsNow, theme: () => theme, run: () => null,
  keys: () => [], panes: () => [], shared: () => null, setShared: () => {},
  readTextFile: async (p: string) => files[p] ?? null,
  writeTextFile: async (p: string, t: string, was: string | null) => {
    if ((files[p] ?? null) !== was) throw new Error("the file changed outside");
    if (writeGate) await writeGate;
    files[p] = t; writes.push([p, t]); return null;
  },
  watchFolder: () => new Promise(() => {}), nextCommand: () => new Promise(() => {}),
  exec: () => new Promise(() => {}), languageOf: (p: string) => (/\.md$/.test(p) ? "markdown" : null),
  highlight: () => [], lspStart: () => new Promise(() => {}), lspNotify: () => {}, lspRequest: () => Promise.resolve(null),
  lspNextMessage: () => new Promise(() => {}), lspRelease: () => null, setUnsaved: () => {}, notify: () => {},
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: () => new El(), image: () => new El(), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} set_selected_range() {} }

// ---- gpui-base's EditorState, as it behaves for this

type P = { line: number; col: number };
// Line starts, cut once per text (the stand-in's own cost kept out of the mod's).
let startsFor = "", starts: number[] = [0];
const lineStarts = (text: string) => {
  if (text !== startsFor) { starts = [0]; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1); startsFor = text; }
  return starts;
};
const off = (text: string, p: P) => (lineStarts(text)[p.line] ?? text.length) + p.col;
const at = (text: string, o: number): P => { const b = text.slice(0, o).split("\n"); return { line: b.length - 1, col: b[b.length - 1].length }; };
const cmp = (a: P, b: P) => a.line - b.line || a.col - b.col;
/** Change events wait here until the keystroke's effects flush (settle). */
let effects: (() => void)[] = [];
/** Time spent in the stand-in's own text work (not the mod's). */
let standIn = 0;
/** Time in the mod's handlers for a key (its key handler and the change events after). */
let modTime = 0;
function settle() { for (let i = 0; i < 50 && effects.length; i++) { const q = effects; effects = []; for (const f of q) f(); } }
class Ed {
  v = ""; anchor: P = { line: 0, col: 0 }; head: P = { line: 0, col: 0 }; handlers: Record<string, any> = {}; opts: any; focusedNow = false;
  undos: [string, P][] = []; redos: [string, P][] = []; setValues = 0;
  constructor(o: any) { this.opts = o; }
  on(name: string, fn: any) { this.handlers[name] = fn; return true; }
  value() { return this.v; }
  emit() { effects.push(() => this.handlers.change?.({}, cx())); }
  /** No change event; caret, scroll and undo reset (gpui-base). */
  set_value(v: string) { this.v = v; this.anchor = this.head = { line: 0, col: 0 }; this.undos = []; this.setValues++; }
  cursor() { return { ...this.head }; }
  set_cursor(line: number, col: number, end?: P) {
    const t0 = performance.now();
    try { this.setCursorNow(line, col, end); } finally { standIn += performance.now() - t0; }
  }
  setCursorNow(line: number, col: number, end?: P) {
    const st = lineStarts(this.v);
    const len = (l: number) => (l + 1 < st.length ? st[l + 1] - 1 : this.v.length) - st[l];
    const clamp = (p: P) => { const l = Math.max(0, Math.min(st.length - 1, p.line)); return { line: l, col: Math.max(0, Math.min(len(l), p.col)) }; };
    this.anchor = clamp({ line, col }); this.head = end ? clamp(end) : { ...this.anchor };
  }
  selection() { const [s, e] = cmp(this.anchor, this.head) <= 0 ? [this.anchor, this.head] : [this.head, this.anchor]; const v = this.v; return { start: { ...s }, end: { ...e }, get text() { return v.slice(off(v, s), off(v, e)); } }; }
  set_selections(list: { start: P; end: P }[]) { const s = list[0]; if (s) { this.anchor = { ...s.start }; this.head = { ...s.end }; } }
  edit(list: any[]) {
    const t0 = performance.now();
    try { this.editNow(list); } finally { standIn += performance.now() - t0; }
  }
  editNow(list: any[]) {
    this.undos.push([this.v, this.head]); this.redos = [];
    const caret = off(this.v, this.head);
    let moved = caret;
    for (const e of [...list].sort((x, y) => off(this.v, y.start) - off(this.v, x.start))) {
      const s = off(this.v, e.start), en = off(this.v, e.end);
      if (s < caret) moved += e.text.length - (Math.min(en, caret) - s);
      this.v = this.v.slice(0, s) + e.text + this.v.slice(en);
    }
    this.anchor = this.head = at(this.v, Math.max(0, Math.min(this.v.length, moved)));
    this.emit();
  }
  undo() { const u = this.undos.pop(); if (!u) return; this.redos.push([this.v, this.head]); this.v = u[0]; this.anchor = this.head = u[1]; this.emit(); }
  redo() { const r = this.redos.pop(); if (!r) return; this.undos.push([this.v, this.head]); this.v = r[0]; this.anchor = this.head = r[1]; this.emit(); }
  /** A key as gpui delivers it: the key handler first; untaken text lands at the caret. */
  press(k: string, mods: any = {}, ch: string | null = null) {
    const e = key(k, mods, ch);
    const t0 = performance.now();
    const taken = this.handlers.key?.(e, cx());
    modTime += performance.now() - t0;
    if (!taken) {
      const text = ch ?? (k === "enter" ? "\n" : k === "space" ? " " : k.length === 1 ? k : null);
      if (text != null && !mods.platform && !mods.control) {
        const s = this.selection();
        this.undos.push([this.v, this.head]);
        this.v = this.v.slice(0, off(this.v, s.start)) + text + this.v.slice(off(this.v, s.end));
        this.anchor = this.head = at(this.v, off(this.v, s.start) + text.length);
        this.emit();
      } else if (k === "backspace") {
        const o = off(this.v, this.head);
        if (o > 0) { this.v = this.v.slice(0, o - 1) + this.v.slice(o); this.anchor = this.head = at(this.v, o - 1); this.emit(); }
      }
    }
    const t1 = performance.now();
    settle();
    modTime += performance.now() - t1;
    return taken;
  }
  bounds(p: P) {
    // Soft wrap at 60 characters, 18 px rows: where a place was drawn.
    const ls = this.v.split("\n");
    let row = 0;
    for (let l = 0; l < p.line; l++) row += Math.max(1, Math.ceil((ls[l]?.length ?? 0) / 60));
    row += Math.floor(Math.max(0, p.col - 1) / 60);
    return { x: (p.col % 60) * 8, y: 10 + row * 18, width: 8, height: 18, view: { x: 0, y: 10, width: 480, height: 400 } };
  }
  focus() { this.focusedNow = true; } focused() { return this.focusedNow; }
  set_tab_size() {} set_cursor_shape() {} set_diagnostics() {} set_line_notes() {} find_close() {} top_line() { return 0; } scroll_to_line() {} set_soft_wrap() {}
  find() { return { query: "", count: 0, current: null, active: false }; }
}
let eds: Ed[] = [];
mock.module("gpui-base", () => ({
  h_flex: () => new El(), v_flex: () => new El(), InputState: { new: () => new Input() }, Input: { new: () => new El() },
  TextView: { html: () => new El(), markdown: (_id: string, md: string) => { const e: any = new El(); e.kids.push(md); return e; } },
  EditorState: { new: (o: any) => { const e = new Ed(o); eds.push(e); return e; } }, Editor: { new: () => new El() },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
}));
(globalThis as any).window = { paint_path: () => new El() };
let store: Record<string, string> = {};
(globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };

const { default: EditorPane } = await import("../defaults/mods/editor/main.ts");
const { KINDS, wrappedRows } = await import("../defaults/mods/editor/rendered.ts");

let later: [number, (cx: any) => void][] = [];
function cx(): any {
  return {
    stop_propagation() {}, notify() {},
    timer: { after: (ms: number, fn: any) => later.push([ms, fn]), every() {} },
    spawn: (fn: any) => { fn(cx()); }, focus_handle: () => ({ focus() {}, is_focused: () => false }),
    read_from_clipboard: () => null, write_to_clipboard() {},
  };
}
function tick() { const due = later; later = []; for (const [, fn] of due) fn(cx()); settle(); }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); settle(); };
const key = (k: string, mods: any = {}, ch: string | null = null) => ({ key: k, key_char: ch ?? (k.length === 1 ? k : null), keystroke: k, modifiers: { shift: false, control: false, alt: false, platform: false, function: false, ...mods } });

const DOC = ["# Plan", "", "A paragraph that runs on.", "", "- one", "- two", "", "```", "code", "```", "", "Last words."].join("\n");

beforeEach(() => { eds = []; later = []; effects = []; writes.length = 0; store = {}; writeGate = null; for (const k of Object.keys(files)) delete files[k]; });

async function pane(path = "/p/notes.md", text = DOC, vim = false): Promise<any> {
  files[path] = text;
  propsNow = { path, slot: "s1" };
  store = { preview: "rendered" };
  const p: any = new EditorPane();
  p.init({}, cx());
  await flush();
  p.paneVim = vim;
  p.vimSettled(vim);
  p.size = { width: 900, height: 700 };
  tick();
  return p;
}
const main = (p: any): Ed => p.cur.editor;
const R = (p: any) => p.cur.rendered;
const block = (p: any): Ed => R(p).block;
const type = (p: any, s: string) => { for (const ch of s) block(p).press(ch === " " ? "space" : ch, {}, ch); };
/** The caret into unit at file line `line` by a click on it. */
const clickLine = (p: any, line: number, end = true) => { const u = [...R(p).units, R(p).unit].find((x: any) => x.from <= line && line <= x.to); R(p).clickUnit(u, cx(), end); settle(); };

// ---- typing stays put

test("typing at speed into a paragraph, through autosaves and reloads: every character kept, the block one stable thing", async () => {
  const NOTE = "/tmp/app/scratchpad/app-0a1b2c3d.md";
  const p = await pane(NOTE, DOC);
  clickLine(p, 2);
  const b = block(p);
  const sets = b.setValues;
  // The block's box as drawn (its size change reports it): 60 characters to a row, as the stand-in wraps.
  R(p).litW = 484;
  R(p).measure(cx());
  let lastH = R(p).litHeight();
  let typed = "";
  const words = "the quick brown fox jumps over the lazy dog ";
  for (let i = 0; i < 320; i++) {
    const ch = words[i % words.length];
    type(p, ch);
    typed += ch;
    if (i % 25 === 24) {
      // The autosave's wait runs out: it writes (the measure timers run too).
      tick();
      await flush();
    }
    if (i === 100) {
      // The watcher: the note read back while the write is under way (our own text): not news.
      writeGate = new Promise((r) => setTimeout(r, 5));
      tick();
      p.load(cx(), null, true, p.cur);
      await new Promise((r) => setTimeout(r, 10));
      await flush();
      writeGate = null;
    }
    if (i === 200) {
      // The watcher again, after the write: the text on disk is what was written.
      p.load(cx(), null, true, p.cur);
      await flush();
    }
    // The lit block: the same element and editor, never emptied and refilled, its height never shrinking to a guess.
    expect(R(p).block).toBe(b);
    const v = p.renderedView(theme);
    expect(byId(v, "rendered-lit")).toBeTruthy();
    const h = R(p).litHeight();
    expect(h).toBeGreaterThanOrEqual(lastH);
    lastH = h;
    if (i % 40 === 0) R(p).measure(cx());
  }
  expect(b.setValues).toBe(sets);
  expect(main(p).value()).toBe(DOC.replace("A paragraph that runs on.", "A paragraph that runs on." + typed));
  expect(b.value()).toBe("A paragraph that runs on." + typed);
  expect(b.cursor()).toEqual({ line: 0, col: ("A paragraph that runs on." + typed).length });
  // It ends written, with nothing in between asking (no conflict line).
  tick();
  await flush();
  expect(files[NOTE]).toBe(main(p).value());
  expect(p.cur.conflict).toBe(false);
  expect(p.cur.saveState).toBe("saved");
});

test("a change on disk from elsewhere while typing never replaces what's typed and not yet written", async () => {
  const NOTE = "/tmp/app/scratchpad/app-0a1b2c3d.md";
  const p = await pane(NOTE, DOC);
  clickLine(p, 2);
  type(p, " more");
  files[NOTE] = DOC + "\nan agent's line";
  p.load(cx(), null, true, p.cur);
  await flush();
  expect(main(p).value()).toContain("runs on. more");
  expect(p.cur.conflict).toBe(true);
});

test("the autosave says pending, not saved, when a key came while it wrote", async () => {
  const { Autosave } = await import("../defaults/mods/editor/scratch.ts");
  let release: () => void = () => {};
  const timers: (() => any)[] = [];
  const a = new Autosave({ write: () => new Promise<void>((r) => { release = r; }), timer: (_ms: number, fn: any) => { timers.push(fn); return () => {}; } });
  a.touch();
  const run = timers.shift()!();
  a.touch(); // typed again while the write is under way
  release();
  await run;
  expect(a.state).toBe("pending");
});

test("a key's work doesn't grow with the document: a long file stays well inside the frame's budget", async () => {
  const big = readFileSync("defaults/AGENTS.md", "utf8");
  const p = await pane("/p/big.md", big);
  const prof: Record<string, number> = {};
  if (process.env.PROF) {
    const wrap = (obj: any, names: string[], tag: string) => { for (const n of names) { const f = obj[n]; if (typeof f !== "function") continue; obj[n] = function (...a: any[]) { const t = performance.now(); try { return f.apply(this, a); } finally { prof[tag + n] = (prof[tag + n] ?? 0) + performance.now() - t; } }; } };
    wrap(Object.getPrototypeOf(R(p)), ["push", "pull", "split", "kindOf", "syncCaret", "mirror", "wanted", "recut", "measureSoon", "rows", "view", "lines", "fileSel"], "R.");
    wrap(Object.getPrototypeOf(p), ["changed", "didChange", "refreshPreview", "noteUnsaved", "title", "blockKey", "vimKey", "publish", "keepTabs"], "P.");
    (globalThis as any).__prof = prof;
  }
  const line = big.split("\n").findIndex((l, i) => i > 1000 && /^[A-Z][a-z].{40,}$/.test(l));
  clickLine(p, line);
  p.renderedView(theme);
  const proto = Object.getPrototypeOf(R(p));
  const cuts = { units: 0, lines: 0, hashes: 0 };
  const [recut, lines, hashOf] = [proto.recut, proto.lines, proto.hashOf];
  proto.recut = function () { cuts.units++; return recut.call(this); };
  proto.lines = function () { if (!this.ls) cuts.lines++; return lines.call(this); };
  proto.hashOf = function (s: string) { if (!this.hashes.has(s)) cuts.hashes++; return hashOf.call(this, s); };
  const t0 = performance.now();
  let tt = 0, tv = 0;
  standIn = 0; modTime = 0;
  for (let i = 0; i < 40; i++) { const a = performance.now(); type(p, "x"); const b = performance.now(); p.renderedView(theme); tv += performance.now() - b; tt += b - a; }
  void t0;
  const each = (modTime - standIn + tv) / 40;
  // What doesn't happen per key: the whole text cut into units or lines again, the units' keys hashed again.
  expect(cuts).toEqual({ units: 0, lines: 0, hashes: 0 });
  if (process.env.PROF) console.log(JSON.stringify(Object.fromEntries(Object.entries(prof).map(([k, v]) => [k, +(v / 40).toFixed(3)]))));
  if (process.env.PROF) console.log("type", tt / 40, "mod", (modTime - standIn) / 40, "view", tv / 40, "stand-in", standIn / 40);
  Object.assign(proto, { recut, lines, hashOf });
  // And the time (a shared machine: a loose bound; QuickJS runs it some 30x slower than Bun, in a 50 ms render budget).
  expect(each).toBeLessThan(4);
  const lit = R(p).range;
  expect(main(p).value().split("\n")[lit.to].endsWith("x".repeat(40))).toBe(true);
  expect(main(p).value().length).toBe(big.length + 40);
});

test("the units around the block keep their keys when it grows a line (their heights and drawing stay)", async () => {
  const p = await pane();
  clickLine(p, 2);
  const keys = () => R(p).rows().filter((r: any) => !r.lit).map((r: any) => r.key);
  const before = keys();
  block(p).press("enter", { shift: true }, "\n"); // a line break inside the paragraph
  type(p, "second line");
  expect(main(p).value()).toContain("A paragraph that runs on.\nsecond line\n\n- one");
  expect(keys()).toEqual(before);
});

test("the lit block's height: measured, or as its lines wrap when they've grown since", () => {
  expect(wrappedRows("short", 480, 8)).toBe(1);
  expect(wrappedRows("x".repeat(130), 480, 8)).toBe(3);
  expect(wrappedRows("a\nb\n", 480, 8)).toBe(3);
});

// ---- adding blocks: keys

test("enter at a paragraph's end starts a paragraph below; text after the caret goes with it", async () => {
  const p = await pane();
  clickLine(p, 2);
  block(p).press("enter");
  expect(main(p).value()).toBe(DOC.replace("runs on.\n", "runs on.\n\n\n"));
  expect(R(p).unit.kind).toBe("blank");
  expect(R(p).range).toEqual({ from: 4, to: 4 });
  type(p, "New one");
  expect(main(p).value()).toBe(DOC.replace("runs on.\n", "runs on.\n\nNew one\n"));
  // In the middle of the last line: it splits there.
  clickLine(p, 0);
  block(p).set_cursor(0, 2);
  block(p).press("enter");
  expect(main(p).value().startsWith("# \n\nPlan\n\nA paragraph")).toBe(true);
  expect(block(p).value()).toBe("Plan");
});

test("enter after a heading, after a code block's closing line, at a list's end; inside code it's a new line", async () => {
  const p = await pane();
  clickLine(p, 0);
  block(p).press("enter");
  expect(main(p).value().startsWith("# Plan\n\n\n\nA paragraph")).toBe(true);
  expect(R(p).unit.kind).toBe("blank");
  // Inside a code block: the editor's own new line.
  const q = await pane();
  clickLine(q, 8);
  expect(R(q).unit.kind).toBe("fence");
  block(q).set_cursor(1, 4);
  expect(block(q).press("enter")).toBe(false);
  // At the closing fence's end: a new block.
  block(q).set_cursor(3, 3);
  expect(block(q).press("enter")).toBe(true);
  expect(main(q).value()).toContain("```\ncode\n\n```\n\n\n\nLast words.");
});

test("an empty block offers the kinds; each makes that block (a click, or cmd-. and its letter)", async () => {
  const want: Record<string, string> = { "heading-1": "# ", bullets: "- ", task: "- [ ] ", quote: "> ", fence: "```\n\n```", rule: "---\n" };
  // (image asks for a file: its own test, scripts/editor-images.test.ts)
  for (const [name, , letter] of KINDS.filter(([n]: string[]) => n !== "image")) {
    const p = await pane();
    clickLine(p, 2);
    block(p).press("enter");
    const v = p.renderedView(theme);
    expect(texts(byId(v, "rendered-kinds"))).toContain("make it");
    if (name === "rule" || name === "fence") click(byId(v, `rendered-kind-${name}`));
    else { block(p).press(".", { platform: true }); block(p).press(letter); }
    settle();
    expect(main(p).value()).toBe(DOC.replace("runs on.\n", `runs on.\n\n${want[name]}\n`));
  }
});

// ---- adding blocks: the pointer

test("the + beside a block (on hover) and \"add a block\" under the last one add an empty paragraph there, lit", async () => {
  const p = await pane();
  clickLine(p, 0);
  const rows = R(p).rows();
  const item = rows.find((r: any) => !r.lit && r.u.kind === "item");
  // Hovering shows its +.
  let v = p.renderedView(theme);
  byId(v, `rd-${item.key}`).calls.on_hover[0][0](true, cx());
  v = p.renderedView(theme);
  const plus = byId(v, `rd-${item.key}-add`);
  expect(plus).toBeTruthy();
  click(plus);
  settle();
  // Between two list items: blank lines around it, so it's a paragraph of its own.
  expect(main(p).value()).toBe(DOC.replace("- one\n", "- one\n\n\n\n"));
  expect(R(p).unit.kind).toBe("blank");
  expect(block(p).focusedNow).toBe(true);
  // The line under the last block.
  const q = await pane();
  click(byId(q.renderedView(theme), "rendered-add"));
  settle();
  expect(main(q).value()).toBe(DOC + "\n\n");
  expect(R(q).range).toEqual({ from: 13, to: 13 });
  type(q, "after");
  expect(main(q).value()).toBe(DOC + "\n\nafter");
  // Not under an empty block: that one offers its kinds.
  expect(byId(q.renderedView(theme), "rendered-add")).toBeTruthy();
  const e = await pane("/p/empty.md", "");
  expect(byId(e.renderedView(theme), "rendered-add")).toBeFalsy();
  expect(byId(e.renderedView(theme), "rendered-kinds")).toBeTruthy();
});

test("the bar's markdown chip opens the commands' list; a row and a level are clickable", async () => {
  const p = await pane();
  clickLine(p, 2);
  const chip = byId(p.bar(theme), "bar-md");
  expect(texts(chip)).toEqual(["markdown", "cmd-."]);
  click(chip);
  expect(p.mdMenu).toBeTruthy();
  block(p).set_cursor(0, 3);
  click(byId(p.mdMenuView(theme), "md-menu-bold"));
  settle();
  expect(main(p).value()).toContain("A **paragraph** that");
  click(chip);
  click(byId(p.mdMenuView(theme), "md-menu-level-2"));
  settle();
  expect(main(p).value()).toContain("## A **paragraph** that");
});

// ---- vim across blocks

const vimPane = async (text = DOC) => { const p = await pane("/p/notes.md", text, true); return p; };
const keys = (p: any, s: string) => { for (const ch of s) block(p).press(ch === " " ? "space" : ch, {}, ch); };

test("vim: j / k and counts walk the whole text, blank lines too; the block follows", async () => {
  const p = await vimPane();
  keys(p, "j");
  expect(main(p).cursor().line).toBe(1);
  expect(R(p).unit.kind).toBe("blank");
  keys(p, "j");
  expect(block(p).value()).toBe("A paragraph that runs on.");
  keys(p, "5j");
  expect(main(p).cursor().line).toBe(7);
  expect(R(p).unit.kind).toBe("fence");
  keys(p, "3k");
  expect(main(p).cursor().line).toBe(4);
  expect(block(p).value()).toBe("- one");
});

/** A pane in the text view (vim on plain text): the reference. */
async function textPane(text = DOC) {
  const p = await pane("/p/plain.md", text, true);
  p.command("preview-text", cx());
  settle();
  return p;
}
/** Feeds keys to an editor as typed: "<esc>", "<C-r>" and the like, else one character each. */
function feedKeys(ed: Ed, s: string) {
  for (const m of s.matchAll(/<(esc|C-r|cr)>|./gs)) {
    const t = m[0];
    if (t === "<esc>") ed.press("escape");
    else if (t === "<C-r>") ed.press("r", { control: true });
    else if (t === "<cr>") ed.press("enter");
    else ed.press(t === " " ? "space" : t, {}, t);
  }
}
/** The same keys in the rendered view and on plain text: the same text, caret and selection. */
async function asOnPlainText(keys: string, text = DOC) {
  const r = await vimPane(text), t = await textPane(text);
  feedKeys(block(r), keys);
  feedKeys(main(t), keys);
  expect(main(r).value()).toBe(main(t).value());
  expect(main(r).cursor()).toEqual(main(t).cursor());
  expect(r.vim.mode).toBe(t.vim.mode);
  const sr = main(r).selection(), st = main(t).selection();
  expect([sr.start, sr.end]).toEqual([st.start, st.end]);
  return r;
}

test("vim: motions across blocks act as on plain text (} { G gg w b e $ counts)", async () => {
  for (const k of ["}", "}}", "}}}{", "G", "Ggg", "3G", "jjw", "jjwwwwwww", "5jb", "Gkkk", "jj$", "jje", "10j", "4jx", "2}dd"]) await asOnPlainText(k);
  // The block follows: } from the top lands on the blank line, lit as an empty block.
  const p = await asOnPlainText("}");
  expect(R(p).unit.kind).toBe("blank");
  // A blank line passed over isn't offered as a new block (no kinds row: the layout stays still).
  expect(R(p).offersKinds()).toBe(false);
  expect(byId(p.renderedView(theme), "rendered-kinds")).toBeFalsy();
  const q = await asOnPlainText("G");
  expect(block(q).value()).toBe("Last words.");
});

test("vim: operators and edits across blocks act as on plain text", async () => {
  for (const k of ["jjdd", "jjddu", "jjddu<C-r>", "dj", "jjd}", "jjyyGp", "jjcwThe<esc>", "jjAend<esc>j.", "oone<esc>", "Gotwo<esc>", "GOup<esc>", "jjJ", "jjd2j", "4jdG", "jjxxx..u", ">>", "jjguu", "4jcc* new<esc>"]) await asOnPlainText(k);
});

test("vim: visual mode across blocks acts as on plain text, every block it touches lit and the selection in the block", async () => {
  for (const k of ["jjvjj", "jjvjjd", "jjvjjkk", "jjVjj", "jjVjjd", "GVkkk", "GVkkky", "jjvjjc<esc>", "4jVjj>"]) await asOnPlainText(k);
  const p = await asOnPlainText("jjvjj");
  // From the paragraph to the first list item: both lit, the blank line between, the selection drawn in the block.
  expect(R(p).range).toEqual({ from: 2, to: 4 });
  expect(block(p).value()).toBe("A paragraph that runs on.\n\n- one");
  expect(block(p).selection().start).toEqual({ line: 0, col: 0 });
  expect(block(p).selection().end).toEqual({ line: 2, col: 1 }); // vim's visual takes the character under the caret
  // Upward from the end: the head is the top, the lit lines reach it.
  const q = await asOnPlainText("GVkkk");
  expect(R(q).range).toEqual({ from: 7, to: 11 });
  expect(block(q).cursor().line).toBe(1);
});

test("vim: insert mode types into the block; the arrows step out of it at its edges", async () => {
  const p = await vimPane();
  keys(p, "jj");
  keys(p, "A");
  type(p, " Yes.");
  expect(main(p).value()).toContain("runs on. Yes.");
  block(p).press("down");
  expect(main(p).cursor().line).toBe(4);
  block(p).press("escape");
  expect(p.vim.mode).toBe("normal");
});
