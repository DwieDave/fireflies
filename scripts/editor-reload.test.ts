// A file the editor shows changes on disk (an agent's edit, a formatter) and
// is read again: the line Developer was reading stays at the top (of the
// text, the preview and the rendered view, a scratchpad's too), the caret and
// selection stay on the text they were on, and the editor doesn't take the
// keyboard. Lines added or removed above move all of that with them
// (editor's keep-place.ts, file-io.ts reloadFromDisk). The editor stand-in
// scrolls as gpui-base's does where it matters: set_value goes back to the
// top, set_cursor reveals the caret (and, without an end, focuses), and the
// first frame after the selection's place in the text changed scrolls to the
// caret when it's out of view. mock.module is process-wide: this file runs alone.
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
const theme: any = new Proxy({}, { get: () => "#808080" });

// ---- herdr
const files: Record<string, string> = {};
let propsNow: any = { path: "/p/a.ts", slot: "s1" };
const herdr: Record<string, any> = {
  settings: () => ({ zoom: 1, editor: { vim: false } }), window: () => ({ platform: "macos" }), appHome: () => "/tmp/app", home: () => "/home/a",
  props: () => propsNow, theme: () => theme, run: () => null,
  keys: () => [], panes: () => [], shared: () => null, setShared: () => {},
  readTextFile: async (p: string) => files[p] ?? null,
  writeTextFile: async (p: string, t: string) => { files[p] = t; return null; },
  watchFolder: () => new Promise(() => {}), nextCommand: () => new Promise(() => {}),
  exec: () => new Promise(() => {}), languageOf: (p: string) => (/\.md$/.test(p) ? "markdown" : /\.ts$/.test(p) ? "typescript" : null),
  highlight: () => [], lspStart: () => new Promise(() => {}), lspNotify: () => {}, lspRequest: () => Promise.resolve(null),
  lspNextMessage: () => new Promise(() => {}), lspRelease: () => null, setUnsaved: () => {}, notify: () => {},
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: () => new El(), image: () => new El(), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} set_selected_range() {} }

// ---- gpui-base's EditorState, as it scrolls

type P = { line: number; col: number };
const VIEW = 20; // rows in view
const cmp = (a: P, b: P) => a.line - b.line || a.col - b.col;
const offOf = (text: string, p: P) => text.split("\n").slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.col;
class Ed {
  v = ""; anchor: P = { line: 0, col: 0 }; head: P = { line: 0, col: 0 }; top = 0; handlers: Record<string, any> = {}; focusedNow = false;
  painted: number | null = null; // the selection's place in the text on the last frame
  constructor(_o: any) {}
  on(name: string, fn: any) { this.handlers[name] = fn; return true; }
  value() { return this.v; }
  lines() { return this.v.split("\n").length; }
  /** Caret, selection and scroll back to the start; no change event. */
  set_value(v: string) { this.v = v; this.anchor = this.head = { line: 0, col: 0 }; this.top = 0; }
  cursor() { return { ...this.head }; }
  set_cursor(line: number, col: number, end?: P) {
    this.anchor = { line, col };
    this.head = end ? { ...end } : { line, col };
    if (!end) this.focusedNow = true; // set_cursor_position focuses the editor
    this.reveal();
  }
  reveal() {
    const l = this.head.line;
    if (l < this.top) this.top = Math.max(0, l - 3);
    else if (l >= this.top + VIEW) this.top = l - VIEW + 4;
  }
  selection() { const [s, e] = cmp(this.anchor, this.head) <= 0 ? [this.anchor, this.head] : [this.head, this.anchor]; return { start: { ...s }, end: { ...e }, text: "" }; }
  top_line() { return this.top; }
  scroll_to_line(l: number) { this.top = Math.max(0, Math.min(this.lines() - 1, l)); }
  /** A frame: a selection whose place in the text changed since the last one is scrolled to. */
  paint() {
    const o = offOf(this.v, this.head);
    if (this.painted !== null && o !== this.painted) this.reveal();
    this.painted = o;
  }
  focus() { this.focusedNow = true; } focused() { return this.focusedNow; }
  set_tab_size() {} set_cursor_shape() {} set_diagnostics() {} set_line_notes() {} find_close() {} set_soft_wrap() {} set_language() {}
  set_selections(list: { start: P; end: P }[]) { const s = list[0]; if (s) { this.anchor = { ...s.start }; this.head = { ...s.end }; } }
  edit() {} undo() {} redo() {}
  bounds() { return null; }
  find() { return { query: "", count: 0, current: null, active: false }; }
}
mock.module("gpui-base", () => ({
  h_flex: () => new El(), v_flex: () => new El(), InputState: { new: () => new Input() }, Input: { new: () => new El() },
  TextView: { html: () => new El(), markdown: () => new El() },
  EditorState: { new: (o: any) => new Ed(o) }, Editor: { new: () => new El() },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
}));
(globalThis as any).window = { paint_path: () => new El() };
let store: Record<string, string> = {};
(globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };

const { default: EditorPane } = await import("../defaults/mods/editor/main.ts");
const { lineAfter } = await import("../defaults/mods/editor/keep-place.ts");

let later: [number, (cx: any) => void][] = [];
function cx(): any {
  return {
    stop_propagation() {}, notify() {},
    timer: { after: (ms: number, fn: any) => later.push([ms, fn]), every() {} },
    spawn: (fn: any) => { fn(cx()); }, focus_handle: () => ({ focus() {}, is_focused: () => false }),
    read_from_clipboard: () => null, write_to_clipboard() {},
  };
}
function tick() { const due = later; later = []; for (const [, fn] of due) fn(cx()); }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

beforeEach(() => { later = []; store = {}; for (const k of Object.keys(files)) delete files[k]; });

async function pane(path: string, text: string, view = "text"): Promise<any> {
  files[path] = text;
  propsNow = { path, slot: "s1" };
  store = { preview: view };
  const p: any = new EditorPane();
  p.init({}, cx());
  await flush();
  p.size = { width: 900, height: 700 };
  tick();
  return p;
}
const ed = (p: any): Ed => p.cur.editor;
/** The file changed on disk and the watcher read it again; a frame drawn, the timers run. */
async function changeOnDisk(p: any, text: string) {
  files[p.cur.path] = text;
  p.load(cx(), null, true, p.cur);
  await flush();
  ed(p).paint();
  tick();
}
const numbered = (n: number, word = "line") => Array.from({ length: n }, (_, i) => `${word} ${i}`);
const lineAt = (p: any, l: number) => ed(p).value().split("\n")[l];

// ---- where a line goes

test("a line's place in the new text: before the change, after it, inside it, gone", () => {
  const was = numbered(10);
  // Untouched lines above the change keep their number; below it they move with it.
  expect(lineAfter(was, [...was.slice(0, 8), "new", ...was.slice(8)], 3)).toBe(3);
  expect(lineAfter(was, ["a", "b", ...was], 3)).toBe(5);
  expect(lineAfter(was, was.slice(2), 5)).toBe(3);
  // Lines added above and a change below: the line in the changed stretch is found by its text.
  const now = ["a", "b", "c", ...was.slice(0, 7), "changed", ...was.slice(8)];
  expect(lineAfter(was, now, 4)).toBe(7);
  // The line itself rewritten: where it was, found by the lines after it.
  expect(lineAfter(was, ["x", ...was.slice(0, 4), "rewritten", ...was.slice(5, 9), "y"], 4)).toBe(5);
  // The line itself gone: its place, just above the next line still there.
  expect(lineAfter(was, ["x", ...was.slice(0, 4), ...was.slice(5, 9), "y"], 4)).toBe(4);
  // Nothing of it left: the same number, within the text.
  expect(lineAfter(was, ["only"], 6)).toBe(0);
  expect(lineAfter(["a", "b", "c"], ["x", "y", "z", "w"], 1)).toBe(1);
});

// ---- the text

test("the text: the same line at the top, the caret on its text, lines added above, no keyboard taken", async () => {
  const p = await pane("/p/a.ts", numbered(200).join("\n"));
  ed(p).set_cursor(45, 3, { line: 45, col: 3 });
  ed(p).scroll_to_line(40.5);
  ed(p).paint();
  ed(p).focusedNow = false;
  // Before: set_value went back to line 0 and set_cursor jumped to the caret (and took the keyboard).
  await changeOnDisk(p, ["// added", "// by", "// an agent", ...numbered(200)].join("\n"));
  expect(lineAt(p, Math.floor(ed(p).top_line()))).toBe("line 40");
  expect(ed(p).top_line()).toBeCloseTo(43.5);
  expect(ed(p).cursor()).toEqual({ line: 48, col: 3 });
  expect(ed(p).focusedNow).toBe(false);
  // Lines taken away above: up again by as many.
  await changeOnDisk(p, numbered(200).slice(10).join("\n"));
  expect(lineAt(p, Math.floor(ed(p).top_line()))).toBe("line 40");
  expect(ed(p).cursor()).toEqual({ line: 35, col: 3 });
  // A change below the view leaves everything where it was.
  await changeOnDisk(p, [...numbered(200).slice(10, 150), "tail", ...numbered(200).slice(150)].join("\n"));
  expect(ed(p).top_line()).toBeCloseTo(30.5);
  expect(ed(p).cursor()).toEqual({ line: 35, col: 3 });
});

test("the text: a caret out of view doesn't pull the view to it, a selection stays on its text", async () => {
  const p = await pane("/p/a.ts", numbered(200).join("\n"));
  ed(p).set_cursor(5, 0, { line: 6, col: 4 });
  ed(p).scroll_to_line(120);
  ed(p).paint();
  await changeOnDisk(p, ["// one", "// two", ...numbered(200)].join("\n"));
  // The frame after the reload scrolled to the moved caret; the line went back to the top.
  expect(ed(p).top_line()).toBe(122);
  expect(ed(p).selection().start).toEqual({ line: 7, col: 0 });
  expect(ed(p).selection().end).toEqual({ line: 8, col: 4 });
  // The caret's own line rewritten: it stays on that line, its column within the new text.
  ed(p).set_cursor(130, 6, { line: 130, col: 6 });
  ed(p).scroll_to_line(125);
  ed(p).paint();
  const now = ed(p).value().split("\n");
  now[130] = "ab";
  await changeOnDisk(p, now.join("\n"));
  expect(ed(p).cursor()).toEqual({ line: 130, col: 2 });
  expect(ed(p).top_line()).toBe(125);
});

test("cmd-r reads the file again and keeps the place too", async () => {
  const p = await pane("/p/a.ts", numbered(200).join("\n"));
  ed(p).set_cursor(70, 1, { line: 70, col: 1 });
  ed(p).scroll_to_line(60);
  ed(p).paint();
  files["/p/a.ts"] = ["x", ...numbered(200)].join("\n");
  p.command("reload", cx());
  await flush();
  ed(p).paint();
  tick();
  expect(lineAt(p, ed(p).top_line())).toBe("line 60");
  expect(ed(p).cursor()).toEqual({ line: 71, col: 1 });
});

// ---- Markdown: the preview and the rendered view

const paras = (n: number) => Array.from({ length: n }, (_, i) => `Paragraph ${i} of the notes.`).join("\n\n");

test("the preview: the same text at its top after lines were added above", async () => {
  const p = await pane("/p/n.md", paras(80), "preview");
  const doc = p.cur.preview;
  doc.viewH = 400;
  doc.setScroll(doc.yOfLine(60) - 4);
  const before = doc.lineAtY(doc.scrollY + 4);
  await changeOnDisk(p, "# Added\n\nAn agent's intro.\n\n" + paras(80));
  expect(doc.lineAtY(doc.scrollY + 4)).toBeCloseTo(before + 4, 0);
});

async function renderedKeeps(path: string) {
  const p = await pane(path, paras(80), "rendered");
  const R = p.cur.rendered;
  R.viewH = 400;
  // The caret in paragraph 10 (line 20), the view scrolled to paragraph 50 (line 100).
  ed(p).set_cursor(20, 3, { line: 20, col: 3 });
  R.lightAt(cx(), true);
  p.renderedView(theme);
  R.reveal = false;
  // Put paragraph 50 at the top, 5 px into it (the wheel scrolls it there).
  for (let y = 0; y < 100000; y += 5) { R.scrollY = y; p.renderedView(theme); if (R.topAt?.line === 100) break; }
  R.scrollY += 5;
  p.renderedView(theme);
  expect(R.topAt).toEqual({ line: 100, dy: expect.any(Number) });
  const dy = R.topAt.dy;
  await changeOnDisk(p, "# Added\n\nAn agent's intro.\n\n" + paras(80));
  p.renderedView(theme);
  // Paragraph 50 is at line 104 now, still at the top; the caret's block lit, not scrolled to.
  expect(R.topAt).toEqual({ line: 104, dy });
  expect(ed(p).cursor()).toEqual({ line: 24, col: 3 });
  expect(R.range).toEqual({ from: 24, to: 24 });
  // A later move of the caret reveals its block again (the kept line is used once).
  R.reveal = true;
  p.renderedView(theme);
  expect(R.topAt.line).toBeLessThanOrEqual(24);
}

test("the rendered view: the same block at the top after lines were added above, the caret's block lit", async () => {
  await renderedKeeps("/p/n.md");
});

test("a scratchpad note (the rendered view) keeps its place the same way", async () => {
  await renderedKeeps("/tmp/app/scratchpad/app-0a1b2c3d.md");
});
