// The scratchpad edited as one document (Developer, 2026-11-16: "adds random
// newlines on top of its markdown"): the rendered view driven by its key
// handlers as his keys would, on a note like his (a heading, a task list with
// long items, a blank line inside the list, a lone "- [ ] S", a blank line at
// the end). Enter at a block's start opens a block above (no blank lines left
// at the top); a new block left untouched leaves no blank lines, on disk too.
// The harness is editor-mdlive.test.ts's, its stand-in editor wrapping at 60
// characters.
// mock.module is process-wide: this file runs alone.
import { test, expect, mock, beforeEach } from "bun:test";

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

/** The rows a text is drawn in at 60 characters a row: words wrap whole, a space hangs at a row's end. */
function drawnRows(text: string): { line: number; start: number; end: number; lineEnd: number }[] {
  const out: { line: number; start: number; end: number; lineEnd: number }[] = [];
  text.split("\n").forEach((l, line) => {
    let s = 0;
    for (;;) {
      if (l.length - s <= 60) { out.push({ line, start: s, end: l.length, lineEnd: l.length }); break; }
      const sp = l.lastIndexOf(" ", s + 60);
      let n = sp > s ? sp + 1 : s + 60;
      while (l[n] === " ") n++;
      if (n >= l.length) { out.push({ line, start: s, end: l.length, lineEnd: l.length }); break; }
      out.push({ line, start: s, end: n, lineEnd: l.length });
      s = n;
    }
  });
  return out;
}

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
      } else if (k === "delete") {
        const o = off(this.v, this.head);
        if (o < this.v.length) { this.v = this.v.slice(0, o) + this.v.slice(o + 1); this.emit(); }
      } else if (k === "left" || k === "right") {
        const o = Math.max(0, Math.min(this.v.length, off(this.v, this.head) + (k === "left" ? -1 : 1)));
        this.anchor = this.head = at(this.v, o);
      } else if (k === "up" || k === "down") {
        // A drawn row up or down (soft wrap as bounds draws it), at the same x.
        const rows = drawnRows(this.v);
        const i = rows.findIndex((r) => r.line === this.head.line && r.start <= this.head.col && this.head.col <= r.end && !(this.head.col === r.end && r.end !== r.lineEnd));
        const j = i + (k === "up" ? -1 : 1);
        const to = rows[j];
        if (i >= 0 && to) { const x = this.head.col - rows[i].start; this.anchor = this.head = { line: to.line, col: Math.min(to.end, to.start + x) }; }
      }
    }
    const t1 = performance.now();
    settle();
    modTime += performance.now() - t1;
    return taken;
  }
  /** How far the editor has scrolled inside its box (px). */
  scrolled = 0;
  bounds(p: P) {
    // Soft wrap at 60 characters, words whole, 18 px rows: where a place was drawn.
    const rows = drawnRows(this.v);
    const i = Math.max(0, rows.findIndex((r) => r.line === p.line && r.start <= p.col && (p.col < r.end || r.end === r.lineEnd)));
    const r = rows[i];
    return { x: (p.col - r.start) * 8, y: 14 + i * 18 - this.scrolled, width: 8, height: 18, view: { x: 0, y: 10, width: 484, height: 400 } };
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
const { KINDS } = await import("../defaults/mods/editor/rendered-units.ts");
const { litHeight, wrappedRows } = await import("../defaults/mods/editor/rendered-column.ts");

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


// ---- a note like Developer's

const LONG = "Browser fullscreen: let a page go fullscreen, a video site says the browser can't do it today and it should";
const NOTE = [
  "# Ideas",
  `- [ ] ${LONG}`,
  "- [x] Find out why port forwards drop",
  "- [ ] Scratchpad: blocks should feel like one document",
  "",
  "- [ ] Editor type checking of the mods",
  "- [ ] S",
  "",
].join("\n");
const PATH = "/tmp/app/scratchpad/fireflies-c6ebf457.md";

/** The scratchpad on NOTE (or `text`), the lit block 60 characters wide, measured. */
async function note(text = NOTE, vim = false): Promise<any> {
  const p = await pane(PATH, text, vim);
  R(p).litW = 484;
  tick();
  return p;
}
/** The caret onto file line `line` (its block lit, the caret at its start), as a click would. */
const onLine = (p: any, line: number) => { clickLine(p, line, false); tick(); };
const press = (p: any, k: string, n = 1) => { let taken = false; for (let i = 0; i < n; i++) taken = block(p).press(k); tick(); return taken; };
/** The file's caret. */
const caret = (p: any) => main(p).cursor();
/** The note's lines now. */
const lines = (p: any) => main(p).value().split("\n");
/** The note written to disk after the autosave's wait. */
const saved = async () => { tick(); await flush(); tick(); await flush(); return files[PATH]; };

// ---- enter at a block's start, a new block left untouched

test("enter at the very start of the note opens a block above the heading: no blank lines left at the top", async () => {
  const p = await note();
  expect(caret(p)).toEqual({ line: 0, col: 0 });
  press(p, "enter");
  // A new block above, the caret in it; the heading where it was below it.
  expect(R(p).offersKinds()).toBe(true);
  expect(lines(p).slice(0, 3)).toEqual(["", "", "# Ideas"]);
  // Left untouched (down, back to the heading): the note is as it was, its first byte "#".
  press(p, "down");
  expect(main(p).value()).toBe(NOTE);
  expect(block(p).value()).toBe("# Ideas");
  // Typed into, it stays: a paragraph above the heading.
  block(p).set_cursor(0, 0);
  press(p, "enter");
  type(p, "Today");
  press(p, "down");
  expect(main(p).value()).toBe("Today\n\n" + NOTE);
});


test("enter, enter at a block's end and walking away leaves no blank lines; nor does a + left empty", async () => {
  const p = await note();
  block(p).set_cursor(0, 7);
  press(p, "enter");
  expect(R(p).offersKinds()).toBe(true);
  press(p, "enter"); // on the new empty block: it stays one block
  press(p, "up");
  expect(main(p).value()).toBe(NOTE);
  // "add a block" under the last one, then a click elsewhere.
  click(byId(p.renderedView(theme), "rendered-add"));
  settle();
  expect(R(p).offersKinds()).toBe(true);
  R(p).clickUnit(R(p).units[0], cx());
  settle();
  expect(main(p).value()).toBe(NOTE);
  expect(await saved()).toBe(NOTE);
});

