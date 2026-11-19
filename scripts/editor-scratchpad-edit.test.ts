// The scratchpad edited as one document (Developer, 2026-11-16: "navigating
// blocks feels very unintuitive still, very robotical and non expecting",
// "adds random newlines on top of its markdown", "entering rows at a time too
// small textarea"): the rendered view driven by its key handlers as his keys
// would, on a note like his (a heading, a task list with long items, a blank
// line inside the list, a lone "- [ ] S", a blank line at the end). The caret
// crosses blocks as it crosses lines; enter in a list and a task list goes on
// and ends the list without the next text joining its last item; enter at a
// block's start opens a block above (no blank lines left at the top);
// backspace takes a mark off, joins blocks and removes an empty one; a new
// block left untouched leaves no blank lines; a long paragraph's box holds
// every row; what isn't edited keeps its bytes. The harness is
// editor-mdlive.test.ts's, its stand-in editor wrapping at 60 characters.
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
const toasts: any[] = [];
/** The app's panes, its focused pane and shared state, as herdr reports them. */
let panesNow: any[] = [];
let focusedNow: any = null;
let sharedNow: Record<string, unknown> = {};
const clipboard: string[] = [];
const writes: [string, string][] = [];
let propsNow: any = { path: "/p/notes.md", slot: "s1" };
let writeGate: Promise<void> | null = null; // a write held open (a slow disk)
const herdr: Record<string, any> = {
  settings: () => ({ zoom: 1, editor: { vim: false } }), window: () => ({ platform: "macos" }), appHome: () => "/tmp/app", home: () => "/home/a",
  props: () => propsNow, theme: () => theme, run: () => null,
  keys: () => [], panes: () => panesNow, focused: () => focusedNow, shared: (k: string) => sharedNow[k] ?? null, setShared: (k: string, v: unknown) => { sharedNow[k] = v; },
  readTextFile: async (p: string) => files[p] ?? null,
  writeTextFile: async (p: string, t: string, was: string | null) => {
    if ((files[p] ?? null) !== was) throw new Error("the file changed outside");
    if (writeGate) await writeGate;
    files[p] = t; writes.push([p, t]); return null;
  },
  watchFolder: () => new Promise(() => {}), nextCommand: () => new Promise(() => {}),
  exec: () => new Promise(() => {}), languageOf: (p: string) => (/\.md$/.test(p) ? "markdown" : null),
  highlight: () => [], lspStart: () => new Promise(() => {}), lspNotify: () => {}, lspRequest: () => Promise.resolve(null),
  lspNextMessage: () => new Promise(() => {}), lspRelease: () => null, setUnsaved: () => {}, notify: (n: any) => { toasts.push(n); },
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
    if (!end) this.focus(); // set_cursor_position focuses the editor (gpui-base); with an end it doesn't
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
  /** The window has one focus: an editor taking it takes it from every other. */
  focus() { for (const e of eds) e.focusedNow = false; this.focusedNow = true; } focused() { return this.focusedNow; }
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
    read_from_clipboard: () => null, write_to_clipboard: (t: string) => { clipboard.push(t); },
  };
}
function tick() { const due = later; later = []; for (const [, fn] of due) fn(cx()); settle(); }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); settle(); };
const key = (k: string, mods: any = {}, ch: string | null = null) => ({ key: k, key_char: ch ?? (k.length === 1 ? k : null), keystroke: k, modifiers: { shift: false, control: false, alt: false, platform: false, function: false, ...mods } });

const DOC = ["# Plan", "", "A paragraph that runs on.", "", "- one", "- two", "", "```", "code", "```", "", "Last words."].join("\n");

beforeEach(() => { panesNow = []; focusedNow = null; sharedNow = {}; eds = []; later = []; effects = []; writes.length = 0; store = {}; writeGate = null; for (const k of Object.keys(files)) delete files[k]; });

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

// ---- the caret crosses blocks as it crosses lines

test("down from the heading lands in the first task's text, not in its box; up comes back to the same letter", async () => {
  const p = await note();
  expect(block(p).value()).toBe("# Ideas");
  block(p).set_cursor(0, 4); // "# Id|eas"
  press(p, "down");
  expect(block(p).value()).toBe(`- [ ] ${LONG}`);
  expect(caret(p)).toEqual({ line: 1, col: 8 }); // "- [ ] Br|owser"
  press(p, "up");
  expect(block(p).value()).toBe("# Ideas");
  expect(caret(p)).toEqual({ line: 0, col: 4 });
});

test("down through a long task's wrapped rows, then into the next task's text at the same column (the text drawn right of the boxes)", async () => {
  const p = await note();
  press(p, "down");
  // Down inside the long task is the editor's own: its second drawn row.
  block(p).set_cursor(0, 10);
  expect(press(p, "down")).toBe(false);
  expect(block(p).cursor().col).toBeGreaterThan(60);
  const row2 = block(p).bounds(block(p).cursor()).x / 8;
  // Its last row: down leaves it for the next task, the caret under where it was.
  press(p, "down");
  expect(block(p).value()).toBe("- [x] Find out why port forwards drop");
  expect(caret(p)).toEqual({ line: 2, col: 6 + row2 });
});

test("up into a long task lands on its last drawn row, not its first", async () => {
  const p = await note();
  onLine(p, 2);
  expect(block(p).value()).toBe("- [x] Find out why port forwards drop");
  block(p).set_cursor(0, 10); // "- [x] Find| out": 4 into its text
  press(p, "up");
  expect(block(p).value()).toBe(`- [ ] ${LONG}`);
  const c = block(p).cursor();
  const rows = drawnRows(block(p).value());
  expect(c.col).toBeGreaterThanOrEqual(rows.at(-1)!.start);
  expect(block(p).bounds(c).x / 8).toBe(4);
});

test("the blank line inside the list is passed over both ways; the lone \"- [ ] S\" is reached and left", async () => {
  const p = await note();
  for (let i = 0; i < 4; i++) press(p, "down");
  expect(block(p).value()).toBe("- [ ] Scratchpad: blocks should feel like one document");
  press(p, "down");
  expect(block(p).value()).toBe("- [ ] Editor type checking of the mods");
  press(p, "down");
  expect(block(p).value()).toBe("- [ ] S");
  expect(caret(p).line).toBe(6);
  // At the note's end down stays: the editor's own key.
  expect(press(p, "down")).toBe(false);
  press(p, "up");
  press(p, "up");
  expect(block(p).value()).toBe("- [ ] Scratchpad: blocks should feel like one document");
});

test("left at a block's start goes to the end of the block before; right at its end to the next block's text", async () => {
  const p = await note();
  onLine(p, 2);
  block(p).set_cursor(0, 0);
  expect(press(p, "left")).toBe(true);
  expect(block(p).value()).toBe(`- [ ] ${LONG}`);
  expect(caret(p)).toEqual({ line: 1, col: LONG.length + 6 });
  expect(press(p, "right")).toBe(true);
  expect(block(p).value()).toBe("- [x] Find out why port forwards drop");
  expect(caret(p)).toEqual({ line: 2, col: 6 }); // after the box
  // Inside a block they're the editor's own.
  expect(press(p, "right")).toBe(false);
  expect(block(p).cursor()).toEqual({ line: 0, col: 7 });
});

test("a click lights a block with the caret about where it was pressed, not at its start", async () => {
  const p = await note();
  const v = p.renderedView(theme);
  const row = byId(v, "rd-item-" + R(p).hashOf(R(p).src(R(p).units.find((u: any) => u.from === 2))));
  expect(row).toBeTruthy();
  // Pressed 14 characters into the item's text (its box and gap are 26 px).
  row.calls.on_mouse_down[0][1]({ local_position: { x: 26 + 14 * 8 + 2, y: 6 }, bounds: { x: 0, y: 0, width: 700, height: 20 }, position: { x: 0, y: 0 } }, cx());
  row.calls.on_click[0][0]({}, cx());
  settle();
  expect(block(p).value()).toBe("- [x] Find out why port forwards drop");
  expect(caret(p)).toEqual({ line: 2, col: 6 + 14 });
});

// ---- enter

test("enter in a task list makes the next task; on that empty task it ends the list, and what's typed then is a paragraph of its own", async () => {
  const p = await note();
  for (let i = 0; i < 6; i++) press(p, "down");
  expect(block(p).value()).toBe("- [ ] S");
  block(p).set_cursor(0, 7);
  press(p, "enter");
  expect(lines(p).slice(6, 8)).toEqual(["- [ ] S", "- [ ] "]);
  expect(caret(p)).toEqual({ line: 7, col: 6 });
  press(p, "enter");
  // The list ends: the empty task gone, a blank line, the new block.
  expect(lines(p).slice(6, 9)).toEqual(["- [ ] S", "", ""]);
  expect(R(p).offersKinds()).toBe(true);
  type(p, "Later");
  expect(lines(p).slice(6, 9)).toEqual(["- [ ] S", "", "Later"]);
  tick();
  // Its own paragraph, not more of the task above.
  R(p).recut(cx());
  expect(R(p).all.find((u: any) => u.from === 8)?.kind).toBe("para");
});

test("enter in a plain list makes the next item; in the middle of an item it splits there", async () => {
  const p = await note(["- one", "- two", ""].join("\n"));
  block(p).set_cursor(0, 5);
  press(p, "enter");
  expect(main(p).value()).toBe(["- one", "- ", "- two", ""].join("\n"));
  type(p, "half");
  block(p).set_cursor(1, 4); // "- ha|lf"
  press(p, "enter");
  expect(main(p).value()).toBe(["- one", "- ha", "- lf", "- two", ""].join("\n"));
});

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

// ---- backspace and delete

test("backspace at a task's text start takes its box off; again, the line joins the task above", async () => {
  const p = await note();
  onLine(p, 2);
  block(p).set_cursor(0, 6);
  expect(press(p, "backspace")).toBe(true);
  expect(lines(p)[2]).toBe("Find out why port forwards drop");
  expect(caret(p)).toEqual({ line: 2, col: 0 });
  press(p, "backspace");
  expect(lines(p)[1]).toBe(`- [ ] ${LONG}Find out why port forwards drop`);
  expect(caret(p)).toEqual({ line: 1, col: LONG.length + 6 });
  expect(lines(p).length).toBe(NOTE.split("\n").length - 1);
});

test("backspace at a paragraph's start joins it to the one before, the blank lines between gone", async () => {
  const p = await note(["First words.", "", "", "Second words.", ""].join("\n"));
  press(p, "down");
  expect(block(p).value()).toBe("Second words.");
  block(p).set_cursor(0, 0);
  press(p, "backspace");
  expect(main(p).value()).toBe("First words.Second words.\n");
  expect(caret(p)).toEqual({ line: 0, col: 12 });
  // A heading's mark goes the same way.
  const q = await note(["# Title", "Text", ""].join("\n"));
  block(q).set_cursor(0, 2);
  press(q, "backspace");
  expect(main(q).value()).toBe(["Title", "Text", ""].join("\n"));
});

test("backspace in an empty block removes it and goes to the end of the block before; a code block isn't joined", async () => {
  const p = await note(["Text", "", "```", "code", "```", "", "After", ""].join("\n"));
  press(p, "down");
  press(p, "down");
  press(p, "down");
  press(p, "down");
  expect(block(p).value()).toBe("After");
  block(p).set_cursor(0, 0);
  press(p, "backspace");
  // Nothing joins a code block: the caret goes to its end.
  expect(main(p).value()).toBe(["Text", "", "```", "code", "```", "", "After", ""].join("\n"));
  expect(caret(p)).toEqual({ line: 4, col: 3 });
  // An empty block made at "After"'s end, then backspace: gone, the caret back at "After"'s end.
  press(p, "down");
  block(p).set_cursor(0, 5);
  press(p, "enter");
  expect(R(p).offersKinds()).toBe(true);
  press(p, "backspace");
  expect(main(p).value()).toBe(["Text", "", "```", "code", "```", "", "After", ""].join("\n"));
  expect(caret(p)).toEqual({ line: 6, col: 5 });
});

test("delete at a block's end joins the next block's text on (its mark off)", async () => {
  const p = await note(["Words", "", "- more", ""].join("\n"));
  block(p).set_cursor(0, 5);
  press(p, "delete");
  expect(main(p).value()).toBe("Wordsmore\n");
});

// ---- the box grows with its text

test("a long paragraph typed into: its box always holds every row, measured or not yet", async () => {
  const p = await note(["Start", ""].join("\n"));
  block(p).set_cursor(0, 5);
  for (let i = 0; i < 30; i++) {
    type(p, " word");
    // Before the measure (30 ms later): never shorter than the rows its text takes.
    const rows = drawnRows(block(p).value()).length;
    expect(litHeight(R(p))).toBeGreaterThanOrEqual(rows * 18 + 10);
    tick();
    expect(litHeight(R(p))).toBeGreaterThanOrEqual(rows * 18 + 10);
  }
});

test("measured while the editor had scrolled inside a box too short, the whole text still counts", async () => {
  const p = await note(["x ".repeat(100), ""].join("\n"));
  block(p).scrolled = 18; // one row out of sight at the top
  R(p).measure(cx());
  expect(R(p).blockH).toBeGreaterThanOrEqual(drawnRows(block(p).value()).length * 18);
});

// ---- the note's bytes

test("every edit leaves the note's first byte, and every line it didn't touch, as they were", async () => {
  const edits: [string, (p: any) => void][] = [
    ["enter at the start, left untouched", (p) => { press(p, "enter"); press(p, "down"); }],
    ["enter at the heading's end, left", (p) => { block(p).set_cursor(0, 7); press(p, "enter"); press(p, "up"); }],
    ["a new task typed", (p) => { press(p, "down"); block(p).set_cursor(0, LONG.length + 6); press(p, "enter"); type(p, "new"); }],
    ["a box taken off and back", (p) => { onLine(p, 2); block(p).set_cursor(0, 6); press(p, "backspace"); main(p).undo(); settle(); }],
    ["the caret walked down and up", (p) => { for (let i = 0; i < 6; i++) press(p, "down"); for (let i = 0; i < 6; i++) press(p, "up"); }],
    ["left and right across every block", (p) => { for (let i = 0; i < 400; i++) press(p, "right"); for (let i = 0; i < 400; i++) press(p, "left"); }],
    ["backspace at the note's start", (p) => { press(p, "backspace"); }],
  ];
  for (const [what, act] of edits) {
    const p = await note();
    act(p);
    const now = main(p).value();
    expect([what, now[0]]).toEqual([what, "#"]);
    const was = NOTE.split("\n");
    const kept = now.split("\n");
    // The heading and the lines after the long task are kept byte for byte (an edit there excepted).
    expect([what, kept[0]]).toEqual([what, was[0]]);
    expect([what, kept.slice(-4)]).toEqual([what, was.slice(-4)]);
    const disk = await saved();
    if (disk !== now) console.log(what, JSON.stringify(writes.map((w) => w[1].slice(0, 20))), JSON.stringify(disk?.slice(0,20)), JSON.stringify(now.slice(0,20)), p.cur.saveState, p.cur.conflict);
    expect([what, disk === undefined || disk === now]).toEqual([what, true]);
  }
});

// ---- the bar (Developer, 2026-11-16: "Scratchpad toolbar way to overcrowded: multiple
// \"markdown\" labels"; he picked concept A, "quiet line, one menu")

test("a scratchpad's bar: vim's mode, the caret's block, the save, format and more; \"markdown\" nowhere, no language, indent or line:col", async () => {
  const p = await note(NOTE, true);
  const frame = p.render(cx());
  const bar = byId(frame, "editor-bar");
  const words = texts(bar);
  expect(words).toContain("heading 1");
  expect(words).toContain("saved");
  expect(words).toContain("format");
  expect(words).toContain("space .");
  expect(words.join(" ")).not.toMatch(/markdown|2 sp|\d+:\d+|every worktree|scratchpad/);
  expect(byId(bar, "bar-more")).toBeTruthy();
  // The hint row along the foot doesn't say it again; the lit block has no kind at its corner.
  expect(texts(byId(frame, "editor-hints"))).not.toContain("markdown");
  expect(texts(byId(frame, "rendered-lit"))).not.toContain("heading 1");
  // The caret's block, as it moves.
  press(p, "down");
  expect(texts(byId(p.render(cx()), "editor-bar"))).toContain("task");
  // Another file keeps its bar.
  const q = await pane("/p/notes.md", NOTE);
  expect(texts(byId(q.render(cx()), "editor-bar")).join(" ")).toMatch(/markdown/);
});

test("format opens the Markdown commands (titled format); more opens its menu, a letter or a click runs an entry, anything else closes it", async () => {
  const p = await note();
  click(byId(p.render(cx()), "bar-md"));
  expect(p.mdMenu).toBeTruthy();
  expect(texts(byId(p.render(cx()), "editor-md-menu"))).toContain("cmd-.  format");
  p.mdMenu = null;
  click(byId(p.render(cx()), "bar-more"));
  expect(p.moreMenu).toBeTruthy();
  const menu = byId(p.render(cx()), "editor-more-menu");
  expect(texts(menu)).toEqual(expect.arrayContaining(["Copy its path", "Rendered", "Text", "Split with the preview", "Word wrap", "Vim"]));
  // y: the path copied, a toast says so; the menu closes.
  toasts.length = 0; clipboard.length = 0;
  expect(block(p).press("y")).toBe(true);
  expect(clipboard).toEqual([PATH]);
  expect(toasts[0]).toMatchObject({ title: "copied the scratchpad's path", level: "success" });
  expect(p.moreMenu).toBeNull();
  expect(main(p).value()).toBe(NOTE);
  // A click on an entry: the text view.
  click(byId(p.render(cx()), "bar-more"));
  click(byId(p.render(cx()), "more-text"));
  expect(p.view).toBe("text");
  expect(p.moreMenu).toBeNull();
  // Any other key closes it, typing nothing.
  click(byId(p.render(cx()), "bar-more"));
  p.command("preview-rendered", cx());
  tick();
  block(p).press("q");
  expect(p.moreMenu).toBeNull();
  expect(main(p).value()).toBe(NOTE);
});

// ---- the keyboard stays where he types (Developer, 2026-11-16: "Scratchpad randomly looses text focus")

/** An editor pane `slot` on the note, as the app lists it. */
const editorPane = (pane: string, slot: string, more: any = {}) => ({ pane, tab: "c1", mod: "editor", props: { path: PATH, slot }, focused: false, parked: false, title: "editor", zoomed: false, ...more });

test("a copy of the scratchpad loaded out of sight (pinned to the shelf, parked) doesn't take the keyboard from the pane being typed in", async () => {
  // He types in pane p1; the pinned copy (p9, slot s1) loads parked.
  panesNow = [editorPane("p1", "s0", { focused: true }), editorPane("p9", "s1", { parked: true })];
  focusedNow = { pane: "p1" };
  const p = await note();
  for (let i = 0; i < 4; i++) tick();
  expect(block(p).focusedNow).toBe(false);
  expect(main(p).focusedNow).toBe(false);
  // The same copy when it is the focused pane (opened where he is): it takes it.
  panesNow = [editorPane("p9", "s1", { focused: true })];
  focusedNow = { pane: "p9" };
  const q = await note();
  for (let i = 0; i < 4; i++) tick();
  expect(block(q).focusedNow).toBe(true);
});

test("the app's editor.open on the note moves only the pane it focused; one from before a pane started isn't for it", async () => {
  // A record from earlier (shared keeps the last one): a pane starting now leaves it.
  sharedNow["editor.goto"] = { path: PATH, n: 5 };
  panesNow = [editorPane("p1", "s0", { focused: true }), editorPane("p9", "s1")];
  focusedNow = { pane: "p1" };
  const p = await note();
  const opened: string[] = [];
  p.openFile = (path: string) => { opened.push(path); };
  p.render(cx());
  tick();
  expect(opened).toEqual([]);
  // A new one while another pane is focused: not this pane's to answer.
  sharedNow["editor.goto"] = { path: PATH, n: 6, line: 3 };
  p.render(cx());
  tick();
  expect(opened).toEqual([]);
  // A new one with this pane focused (the app focuses the pane it picked): it goes there.
  focusedNow = { pane: "p9" };
  sharedNow["editor.goto"] = { path: PATH, n: 7, line: 3 };
  p.render(cx());
  tick();
  expect(opened).toEqual([PATH]);
});

test("its own autosave read back from disk changes nothing: no reload, the block not refilled, the keyboard kept", async () => {
  const p = await note();
  block(p).focus();
  block(p).set_cursor(0, 7);
  type(p, " now");
  const sets = block(p).setValues;
  // The write, and the folder's change event reading the note back mid-write and after.
  writeGate = new Promise((ok) => setTimeout(ok, 5));
  tick();
  await flush();
  p.load(cx(), null, true);
  await new Promise((ok) => setTimeout(ok, 10));
  await flush();
  p.load(cx(), null, true);
  await flush();
  tick();
  expect(files[PATH]).toBe(NOTE.replace("# Ideas", "# Ideas now"));
  expect(block(p).setValues).toBe(sets);
  expect(block(p).focusedNow).toBe(true);
  expect(p.cur.conflict).toBe(false);
  expect(caret(p)).toEqual({ line: 0, col: 11 });
});

// ---- the save keeps his place (Developer, 2026-11-19: "Scratchpad sometimes looses cursor (insert mode) on saving/on saved")

test("typing in insert mode, the save and its echo leave the keyboard, insert mode and the caret where they were, also with a second copy of the note open (it reloads what was saved)", async () => {
  // He types in this copy (p9) ...
  panesNow = [editorPane("p9", "s1", { focused: true })];
  focusedNow = { pane: "p9" };
  const p = await note(NOTE, true);
  // ... and the note is open in another pane too (p1, out of his way).
  panesNow = [editorPane("p9", "s1", { focused: true }), editorPane("p1", "s0")];
  focusedNow = { pane: "p1" };
  const q = await note(NOTE, true);
  // Its caret where it was last used: in the heading he is about to type into.
  block(q).set_cursor(0, 2);
  R(q).syncCaret(true);
  focusedNow = { pane: "p9" };
  block(p).focus();
  block(p).set_cursor(0, 7);
  press(p, "i");
  expect(p.vim.mode).toBe("insert");
  type(p, " now");
  // Typing kept the keyboard in his block (not the file's editor, which isn't drawn).
  expect(block(p).focusedNow).toBe(true);
  // The save, the write's echo in this copy, and the other copy reading the note again.
  expect(await saved()).toBe(NOTE.replace("# Ideas", "# Ideas now"));
  p.load(cx(), null, true);
  q.load(cx(), null, true);
  await flush();
  tick();
  expect(main(q).value()).toBe(NOTE.replace("# Ideas", "# Ideas now"));
  expect(block(p).focusedNow).toBe(true);
  expect(block(q).focusedNow).toBe(false);
  expect(main(p).focusedNow).toBe(false);
  expect(main(q).focusedNow).toBe(false);
  expect(p.vim.mode).toBe("insert");
  expect(caret(p)).toEqual({ line: 0, col: 11 });
  // What he types next lands where he was.
  type(p, "!");
  expect(main(p).value().split("\n")[0]).toBe("# Ideas now!");
});
