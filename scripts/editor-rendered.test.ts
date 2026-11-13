// The editor's rendered view and the scratchpad, as a whole pane built
// through init with herdr and gpui stand-ins (mock.module is process-wide:
// this file runs alone): the caret's block written into the file's text with
// every other byte kept, up / down across blocks, enter continuing a list,
// cmd-. and a letter, vim over the whole text with the block following, undo
// through the file's editor, ticking a box; a scratchpad that opens rendered,
// never shows unsaved, writes a moment after the typing and at once on close,
// and sends other files to an editor beside it.
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
const theme: any = new Proxy({}, { get: () => "#808080" });

// ---- herdr
const files: Record<string, string> = {};
const writes: [string, string][] = [];
const ran: any[] = [];
let unsaved: any[] = [];
let propsNow: any = { path: "/p/notes.md", slot: "s1" };
const herdr: Record<string, any> = {
  settings: () => ({ zoom: 1, editor: { vim: false } }), window: () => ({ platform: "macos" }), appHome: () => "/tmp/app", home: () => "/home/a",
  props: () => propsNow, theme: () => theme, run: (name: string, args?: any) => { ran.push([name, args]); return null; },
  keys: () => [], panes: () => [], shared: () => null, setShared: () => {},
  readTextFile: async (p: string) => files[p] ?? null,
  writeTextFile: async (p: string, t: string, was: string | null) => {
    if ((files[p] ?? null) !== was) throw new Error("the file changed outside");
    files[p] = t; writes.push([p, t]); return null;
  },
  watchFolder: () => new Promise(() => {}), nextCommand: () => new Promise(() => {}),
  exec: () => new Promise(() => {}), languageOf: (p: string) => (/\.md$/.test(p) ? "markdown" : /\.rs$/.test(p) ? "rust" : null),
  highlight: () => [], lspStart: () => new Promise(() => {}), lspNotify: () => {}, lspRequest: () => Promise.resolve(null),
  lspNextMessage: () => new Promise(() => {}), lspRelease: () => null, setUnsaved: (v: any) => { unsaved.push(v); }, notify: () => {},
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: () => new El(), image: () => new El(), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} set_selected_range() {} }

type P = { line: number; col: number };
const off = (text: string, p: P) => text.split("\n").slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.col;
/** gpui-base's EditorState: text, caret and selection, edits applied, its handlers fired as the app does. */
class Ed {
  v = ""; a: P = { line: 0, col: 0 }; b: P = { line: 0, col: 0 }; handlers: Record<string, any> = {}; opts: any; focusedNow = false;
  undos: string[] = []; redos: string[] = [];
  constructor(o: any) { this.opts = o; }
  on(name: string, fn: any) { this.handlers[name] = fn; return true; }
  value() { return this.v; }
  set_value(v: string) { this.v = v; this.a = this.b = { line: 0, col: 0 }; }
  cursor() { return { ...this.b }; }
  set_cursor(line: number, col: number, end?: P) { this.a = { line, col }; this.b = end ? { ...end } : { line, col }; }
  selection() { const [s, e] = off(this.v, this.a) <= off(this.v, this.b) ? [this.a, this.b] : [this.b, this.a]; return { start: { ...s }, end: { ...e }, text: this.v.slice(off(this.v, s), off(this.v, e)) }; }
  edit(list: any[]) {
    this.undos.push(this.v);
    for (const e of [...list].sort((x, y) => off(this.v, y.start) - off(this.v, x.start))) this.v = this.v.slice(0, off(this.v, e.start)) + e.text + this.v.slice(off(this.v, e.end));
    this.handlers.change?.({}, cx());
  }
  undo() { const u = this.undos.pop(); if (u == null) return; this.redos.push(this.v); this.v = u; this.handlers.change?.({}, cx()); }
  redo() { const r = this.redos.pop(); if (r == null) return; this.undos.push(this.v); this.v = r; this.handlers.change?.({}, cx()); }
  /** Typing: the text becomes `v`, the caret at `at`, the change event fires. */
  type(v: string, at: P) { this.v = v; this.a = this.b = at; this.handlers.change?.({}, cx()); }
  bounds() { return { x: 0, y: 10, width: 8, height: 18, view: { x: 0, y: 0, width: 600, height: 400 } }; }
  focus() { this.focusedNow = true; } focused() { return this.focusedNow; }
  set_tab_size() {} set_cursor_shape() {} set_diagnostics() {} set_line_notes() {} find_close() {} top_line() { return 0; } set_selections() {} scroll_to_line() {} set_soft_wrap() {}
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
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const key = (k: string, mods: any = {}, ch: string | null = null) => ({ key: k, key_char: ch ?? (k.length === 1 ? k : null), keystroke: k, modifiers: { shift: false, control: false, alt: false, platform: false, function: false, ...mods } });

const NOTE = ["# Notes", "", "First **para**", "goes on.", "", "- one", "- two", "", "> said", "", "```", "x = 1", "```"].join("\n");

beforeEach(() => { eds = []; later = []; writes.length = 0; ran.length = 0; unsaved = []; store = {}; for (const k of Object.keys(files)) delete files[k]; });

/** A pane on `path` (its text on disk), vim on or off, shown in the rendered view. */
async function pane(path = "/p/notes.md", text = NOTE, vim = false): Promise<any> {
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
const block = (p: any): Ed => p.cur.rendered.block;

test("a Markdown file opens rendered (the pane remembers the view); the block holds the caret's unit", async () => {
  const p = await pane();
  expect(p.view).toBe("rendered");
  expect(block(p).opts).toMatchObject({ language: "markdown", line_numbers: false, soft_wrap: true });
  expect(block(p).value()).toBe("# Notes");
  // Drawn: the other units as Markdown, the lit block as an editor, its kind at the corner.
  const v = p.renderedView(theme);
  const words = texts(v);
  expect(words).toContain("First **para**\ngoes on.");
  expect(words).toContain("heading 1");
  // The lit unit is drawn once: as its source, not rendered as well.
  expect(words.filter((w) => w.includes("# Notes")).length).toBe(0);
  expect(byId(v, "rendered-lit")).toBeTruthy();
});

test("typing into the block writes those lines into the file, every other byte kept", async () => {
  const p = await pane();
  block(p).type("# Notes, today", { line: 0, col: 14 });
  expect(main(p).value()).toBe(NOTE.replace("# Notes", "# Notes, today"));
  // A new line inside the block stays in it while typed into.
  block(p).type("# Notes, today\n\nmore", { line: 2, col: 4 });
  expect(main(p).value()).toBe(NOTE.replace("# Notes", "# Notes, today\n\nmore"));
  expect(p.cur.rendered.range).toEqual({ from: 0, to: 2 });
  expect(p.dirty).toBe(true);
  expect(unsaved.at(-1)).toBeTruthy();
});

test("down past the block's last line lights the next unit; up comes back, the column kept", async () => {
  const p = await pane();
  block(p).set_cursor(0, 5);
  expect(block(p).handlers.key(key("down"), cx())).toBe(true);
  expect(block(p).value()).toBe("First **para**\ngoes on.");
  expect(block(p).cursor()).toEqual({ line: 0, col: 5 });
  expect(main(p).cursor()).toEqual({ line: 2, col: 5 });
  // Down inside a two-line block is the block's own.
  expect(block(p).handlers.key(key("down"), cx())).toBe(false);
  block(p).set_cursor(1, 3);
  block(p).handlers.key(key("down"), cx());
  expect(block(p).value()).toBe("- one");
  block(p).handlers.key(key("up"), cx());
  expect(block(p).value()).toBe("First **para**\ngoes on.");
  expect(block(p).cursor()).toEqual({ line: 1, col: 3 });
  // At the first unit, up stays.
  block(p).set_cursor(0, 0);
  block(p).handlers.key(key("up"), cx());
  expect(block(p).handlers.key(key("up"), cx())).toBe(false);
});

test("enter on a list item starts the next one; on an empty one it ends the list", async () => {
  const p = await pane();
  block(p).handlers.key(key("down"), cx());
  block(p).set_cursor(1, 0);
  block(p).handlers.key(key("down"), cx());
  expect(block(p).value()).toBe("- one");
  block(p).set_cursor(0, 5);
  expect(block(p).handlers.key(key("enter"), cx())).toBe(true);
  // set_value in the stand-in doesn't fire change; the app's does: fire it.
  block(p).handlers.change({}, cx());
  expect(main(p).value()).toBe(NOTE.replace("- one", "- one\n- "));
  expect(block(p).cursor()).toEqual({ line: 1, col: 2 });
});

test("cmd-. then a letter runs a Markdown command at the caret (b: bold the word; again: off)", async () => {
  const p = await pane();
  block(p).handlers.key(key("down"), cx());
  block(p).set_cursor(1, 2); // "goes on."
  expect(block(p).handlers.key(key(".", { platform: true }), cx())).toBe(true);
  expect(p.mdMenu).toBeTruthy();
  expect(texts(p.mdMenuView(theme))).toContain("cmd-.  markdown");
  expect(byId(p.mdMenuView(theme), "editor-md-menu").calls.top[0][0]).toBeGreaterThan(p.textTop() + (p.cur.rendered.litTop ?? 0));
  block(p).handlers.key(key("b"), cx());
  expect(p.mdMenu).toBeNull();
  expect(main(p).value()).toBe(NOTE.replace("goes on.", "**goes** on."));
  expect(block(p).value()).toBe("First **para**\n**goes** on.");
  block(p).handlers.key(key(".", { platform: true }), cx());
  block(p).handlers.key(key("b"), cx());
  expect(main(p).value()).toBe(NOTE);
  // esc closes the list and changes nothing.
  block(p).handlers.key(key(".", { platform: true }), cx());
  block(p).handlers.key(key("escape"), cx());
  expect([p.mdMenu, main(p).value()]).toEqual([null, NOTE]);
});

test("a command that makes the lines another kind lights them as that kind; the palette's commands run the same", async () => {
  const p = await pane();
  block(p).handlers.key(key("down"), cx());
  p.command("md-heading-up", cx());
  expect(main(p).value()).toBe(NOTE.replace("First **para**", "# First **para**"));
  // The heading is a block of its own now (the line under it a paragraph): lit alone.
  expect(p.cur.rendered.unit.kind).toBe("heading");
  expect(block(p).value()).toBe("# First **para**");
  p.command("md-quote", cx());
  expect(main(p).value()).toContain("> # First **para**\ngoes on.");
  expect(p.cur.rendered.unit.kind).toBe("quote");
});

test("cmd-z and cmd-shift-z in the block are the file's undo and redo", async () => {
  const p = await pane();
  block(p).type("# Changed", { line: 0, col: 9 });
  expect(main(p).value()).toContain("# Changed");
  block(p).handlers.key(key("z", { platform: true }), cx());
  expect(main(p).value()).toBe(NOTE);
  expect(block(p).value()).toBe("# Notes");
  block(p).handlers.key(key("z", { platform: true, shift: true }), cx());
  expect(block(p).value()).toBe("# Changed");
});

test("vim over the whole text: j walks out of the block and the block follows; dd deletes in the file", async () => {
  const p = await pane("/p/notes.md", NOTE, true);
  expect(block(p).value()).toBe("# Notes");
  block(p).handlers.key(key("j"), cx());
  block(p).handlers.key(key("j"), cx());
  expect(main(p).cursor().line).toBe(2);
  expect(block(p).value()).toBe("First **para**\ngoes on.");
  block(p).handlers.key(key("d"), cx());
  block(p).handlers.key(key("d"), cx());
  expect(main(p).value()).toBe(NOTE.replace("First **para**\n", ""));
  expect(block(p).value()).toBe("goes on.");
  // space . b: the Markdown commands from vim's leader.
  block(p).handlers.key(key("space", {}, " "), cx());
  block(p).handlers.key(key("."), cx());
  block(p).handlers.key(key("b"), cx());
  expect(main(p).value()).toContain("**goes** on.");
});

test("a task box clicked in the rendered view ticks it in the file", async () => {
  const p = await pane("/p/t.md", "# T\n\n- [ ] a\n- [x] b");
  p.tickRendered(2, cx());
  expect(main(p).value()).toBe("# T\n\n- [x] a\n- [x] b");
});

test("the view switch goes rendered -> split -> preview -> text; the hints name cmd-. and the arrows", async () => {
  const p = await pane();
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) { p.command("preview", cx()); seen.push(p.view); }
  expect(seen).toEqual(["split", "preview", "text", "rendered"]);
  const h = texts(p.hints(theme)).join(" ");
  expect(h).toContain("cmd-.");
  expect(h).toContain("blocks");
});

// ---- the scratchpad

const NOTE_PATH = "/tmp/app/scratchpad/app-0a1b2c3d.md";

test("a scratchpad opens rendered, titled for its repository, and never shows unsaved", async () => {
  const p = await pane(NOTE_PATH, "");
  store = {};
  expect(p.scratch).toBe(true);
  expect(p.view).toBe("rendered");
  expect(texts(p.bar(theme)).join(" ")).toContain("app · every worktree of it");
  expect(texts(p.bar(theme))).toContain("saved");
  // Empty: whose page it is, where it's kept.
  expect(texts(p.renderedView(theme)).join(" ")).toContain("A page for app");
  block(p).type("hello", { line: 0, col: 5 });
  expect(p.dirty).toBe(false);
  expect(unsaved.filter(Boolean)).toEqual([]);
  expect(texts(p.bar(theme))).toContain("saving…");
});

test("a scratchpad writes a moment after the typing, once for a burst, and at once on close", async () => {
  const p = await pane(NOTE_PATH, "a");
  block(p).type("ab", { line: 0, col: 2 });
  block(p).type("abc", { line: 0, col: 3 });
  expect(writes).toEqual([]);
  // The waits that were cut short do nothing; the last one writes.
  tick();
  await flush();
  expect(writes).toEqual([[NOTE_PATH, "abc"]]);
  expect(p.saveState).toBe("saved");
  block(p).type("abcd", { line: 0, col: 4 });
  await p.close();
  expect(writes.at(-1)).toEqual([NOTE_PATH, "abcd"]);
});

test("a scratchpad that doesn't exist yet is created by its first write", async () => {
  propsNow = { path: NOTE_PATH, slot: "s1" };
  const p: any = new EditorPane();
  p.init({}, cx());
  await flush();
  tick();
  expect(p.state).toBe("missing");
  block(p).type("first", { line: 0, col: 5 });
  tick();
  await flush();
  expect(files[NOTE_PATH]).toBe("first");
});

test("other files sent to a scratchpad's pane open in an editor beside it", async () => {
  const p = await pane(NOTE_PATH, "x");
  p.openFile("/p/src/a.rs", cx(), { line: 3 });
  expect(ran.find(([n]) => n === "editor.open")).toEqual(["editor.open", { path: "/p/src/a.rs", line: 3, col: 1 }]);
  expect(p.docs.length).toBe(1);
});
