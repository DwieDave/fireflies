// The editor's file tabs (nocturne-editor/tabs.js, main.js) and where files
// go (editor-route.js, copied into the files pane, the picker and the
// Markdown viewer): a tab per file with its own text, undo, caret and unsaved
// changes; switching, closing with and without unsaved changes, the last tab
// closing the pane, a file already open showing its tab, what a restart
// brings back, definition into another file, the files pane / picker /
// Markdown viewer sending files as tabs, one server listener for every tab,
// and vim's gt / :bn / :bd. A whole pane is built through init with herdr and
// gpui stand-ins (mock.module is process-wide: this file runs alone).
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

// ---- herdr: files on disk, shared state, panes, a language server the tests drive
let disk: Record<string, string> = {};
let sharedNow: Record<string, any> = {};
let storage: Record<string, string> = {};
let propsNow: any = {};
let paneList: any[] = [];
let spaceList: any[] = [];
let focusedPane: string | null = null;
const ran: any[] = [];
const notes: any[] = [];
const released: number[] = [];
const unsaved: any[] = [];
let starts = 0;
let answer: (method: string, params: any) => any = () => null;
let queue: any[] = [];
let wake: ((m: any) => void) | null = null;
const listens: number[] = [];
const herdr: Record<string, any> = {
  settings: () => ({ zoom: 1, editor: {} }), window: () => ({ platform: "macos" }), appHome: () => "/tmp/app", home: () => "/home/a",
  props: () => propsNow, theme: () => theme, run: (name: string, args?: any) => { ran.push(args === undefined ? [name] : [name, args]); return null; },
  keys: () => [], panes: () => paneList, spaces: () => spaceList, focused: () => (focusedPane ? { pane: focusedPane } : null),
  shared: (k: string) => sharedNow[k] ?? null, setShared: (k: string, v: any) => { sharedNow[k] = v; },
  readTextFile: async (p: string) => disk[p] ?? null, writeTextFile: async (p: string, text: string) => { disk[p] = text; }, watchFolder: () => new Promise(() => {}),
  nextCommand: () => new Promise(() => {}),
  // The environment and lookups answer at once: rust-analyzer is on PATH.
  exec: async (cmd: string, args: string[]) => (cmd === "sh" && /command -v|which/.test(args.join(" ")) ? { code: 0, stdout: "/bin/rust-analyzer\n", stderr: "" } : { code: 1, stdout: "", stderr: "" }),
  languageOf: (p: string) => (/\.rs$/.test(p) ? "rust" : /\.md$/.test(p) ? "markdown" : null),
  highlight: () => [], lspStart: async () => { starts++; return { id: 7, capabilities: { textDocumentSync: 2 } }; },
  lspNotify: (id: number, method: string, params: any) => { notes.push([method, params?.textDocument?.uri, id]); },
  lspRequest: async (_id: number, method: string, params: any) => answer(method, params),
  lspNextMessage: (id: number) => { listens.push(id); return queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => { wake = r; }); },
  lspRelease: (id: number) => { released.push(id); }, setUnsaved: (n: any) => { unsaved.push(n); }, notify: () => {},
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: () => new El(), image: () => new El(), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} set_selected_range() {} }
/** gpui-base's EditorState: its text, caret, undo stack (count), handlers. */
class Ed {
  v = ""; caret = { line: 0, col: 0 }; handlers: Record<string, any> = {}; hasKeys = true; undos = 0; lang: string;
  constructor(o: any) { this.lang = o?.language; }
  focused() { return this.hasKeys; }
  on(name: string, fn: any) { this.handlers[name] = fn; return true; }
  value() { return this.v; } set_value(v: string) { this.v = v; }
  /** Typing: the text changes and the editor says so. */
  type(s: string) { this.v += s; this.undos++; this.handlers.change?.({}, cx()); }
  cursor() { return { ...this.caret }; } set_cursor(line: number, col: number) { this.caret = { line, col }; }
  bounds() { return null; } set_language(l: string) { this.lang = l; }
  focus() {} set_tab_size() {} set_cursor_shape() {} set_diagnostics(list: any) { (this as any).diags = list; } set_line_notes() {} find_close() {} top_line() { return 0; }
  selection() { return { start: this.caret, end: this.caret, text: "" }; } edit() {} set_selections() {} scroll_to_line() {}
}
const eds: Ed[] = [];
mock.module("gpui-base", () => ({
  h_flex: () => new El(), v_flex: () => new El(), InputState: { new: () => new Input() }, Input: { new: () => new El() },
  TextView: { html: () => new El(), markdown: () => new El() }, EditorState: { new: (o: any) => { const e = new Ed(o); eds.push(e); return e; } }, Editor: { new: () => new El() },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
}));
(globalThis as any).window = { paint_path: () => new El() };
(globalThis as any).localStorage = { getItem: (k: string) => storage[k] ?? null, setItem: (k: string, v: string) => { storage[k] = String(v); } };

const { default: EditorPane } = await import("../defaults/mods/nocturne-editor/main.js");
const tabs = await import("../defaults/mods/nocturne-editor/tabs.js");
const route = await import("../defaults/mods/nocturne-editor/editor-route.js");
const { createVim, feed } = await import("../defaults/mods/nocturne-editor/vim.js");

let later: [number, (cx: any) => void][] = [];
function cx(): any {
  return {
    notified: 0, stop_propagation() {}, notify() { this.notified++; },
    timer: { after: (ms: number, fn: any) => later.push([ms, fn]), every() {} },
    spawn: (fn: any) => { fn(cx()); }, focus_handle: () => ({ focus() {}, is_focused: () => true }),
    read_from_clipboard: () => null, write_to_clipboard() {},
  };
}
const tick = () => { const due = later; later = []; for (const [, fn] of due) fn(cx()); };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

async function pane(path = "/p/src/a.rs", more: any = {}): Promise<any> {
  later = [];
  propsNow = { path, slot: "s1", ...more };
  paneList = [{ pane: "p1", tab: "t1", mod: "nocturne-editor", props: propsNow }];
  const p: any = new EditorPane();
  p.init({}, cx());
  await flush();
  tick();
  await flush();
  return p;
}
const key = (k: string, mods: any = {}) => ({ key: k, key_char: k.length === 1 ? k : null, keystroke: k, modifiers: { shift: false, control: false, alt: false, platform: false, function: false, ...mods } });

beforeEach(() => {
  disk = { "/p/src/a.rs": "fn a() {}\n", "/p/src/b.rs": "fn b() {}\n", "/p/lib/b.rs": "fn lib_b() {}\n", "/p/docs/n.md": "# N\n" };
  sharedNow = {}; storage = {}; ran.length = 0; notes.length = 0; released.length = 0; unsaved.length = 0; starts = 0; queue = []; wake = null; listens.length = 0;
  spaceList = [{ active: true, tabs: [{ id: "t1", active: true }] }]; focusedPane = null; eds.length = 0;
});

// ---- the tab model (tabs.js)

test("model: a new file goes right after the shown tab; an open one is found; closing shows the next, else the one before", () => {
  expect(tabs.placeTab(["a", "b", "c"], 0, "x")).toEqual({ index: 1, added: true });
  expect(tabs.placeTab(["a", "b", "c"], 2, "x")).toEqual({ index: 3, added: true });
  expect(tabs.placeTab(["a", "b", "c"], 0, "c")).toEqual({ index: 2, added: false });
  expect(tabs.afterClose(3, 1, 1)).toBe(1); // the next slides in
  expect(tabs.afterClose(3, 2, 2)).toBe(1); // the last: the one before
  expect(tabs.afterClose(3, 2, 0)).toBe(1); // another tab closed: the shown one stays (its index moves)
  expect(tabs.afterClose(3, 0, 2)).toBe(0);
  expect(tabs.afterClose(1, 0, 0)).toBe(null);
  expect([tabs.stepTab(3, 2, 1), tabs.stepTab(3, 0, -1), tabs.stepTab(3, 1, 1)]).toEqual([0, 2, 2]);
});

test("model: a restart brings back the kept tabs and the shown one; without any, the props' file (where the files pane moved it)", () => {
  expect(tabs.restoreTabs({ paths: ["/a", "/b", "/a"], active: 1 }, "/a", null)).toEqual({ paths: ["/a", "/b"], active: 1 });
  expect(tabs.restoreTabs({ paths: ["/a", "/b"], active: 9 }, "/a", null).active).toBe(1);
  expect(tabs.restoreTabs(null, "/a", null)).toEqual({ paths: ["/a"], active: 0 });
  expect(tabs.restoreTabs(null, "/a", { from: "/a", to: "/z" })).toEqual({ paths: ["/z"], active: 0 });
  expect(tabs.restoreTabs({ paths: [] }, "/a", null)).toEqual({ paths: ["/a"], active: 0 });
});

test("model: closing the pane asks once, naming every file with unsaved changes", () => {
  expect(tabs.unsavedNote([{ path: "/a.rs", dirty: false }])).toBe(null);
  expect(tabs.unsavedNote([{ path: "/a.rs", dirty: true }, { path: "/b.rs" }])).toBe("a.rs: unsaved changes");
  expect(tabs.unsavedNote([{ path: "/a.rs", dirty: true, deleted: true }])).toBe("a.rs: deleted, unsaved");
  expect(tabs.unsavedNote([{ path: "/a.rs", dirty: true }, { path: "/x/b.rs", dirty: true }])).toBe("2 files with unsaved changes: a.rs, b.rs");
});

test("model: two tabs of the same name show the folder that tells them apart; long rows keep the shown tab in view", () => {
  expect(tabs.tabLabels(["/p/src/b.rs", "/p/lib/b.rs", "/p/a.rs"])).toEqual([{ name: "b.rs", hint: "src" }, { name: "b.rs", hint: "lib" }, { name: "a.rs", hint: null }]);
  expect(tabs.tabLabels(["/x/src/m.rs", "/y/src/m.rs"])).toEqual([{ name: "m.rs", hint: "x/src" }, { name: "m.rs", hint: "y/src" }]);
  expect(tabs.visibleTabs([100, 100, 100], 0, 400)).toEqual({ from: 0, to: 3, before: 0, after: 0 });
  const w = Array(10).fill(100);
  const v = tabs.visibleTabs(w, 7, 400);
  expect(v.from <= 7 && 7 < v.to).toBe(true);
  expect(v.before + v.after + (v.to - v.from)).toBe(10);
  expect((v.to - v.from) * 100 + (v.before ? tabs.MORE : 0) + (v.after ? tabs.MORE : 0)).toBeLessThanOrEqual(400);
  // A name past the cut is drawn cut: its width stops growing.
  expect(tabs.tabWidth({ name: "x".repeat(200), hint: null })).toBe(tabs.tabWidth({ name: "x".repeat(tabs.MAX_NAME), hint: null }));
});

// ---- one pane, several files

test("open, switch, keep: each tab has its own text, undo, caret and unsaved changes; the strip shows them", async () => {
  const p = await pane();
  expect(p.docs.length).toBe(1);
  const a = p.editor;
  expect(a.value()).toBe("fn a() {}\n");
  a.type("// edited");
  a.set_cursor(0, 4);
  p.openFile("/p/src/b.rs", cx());
  await flush();
  expect(p.docs.map((d: any) => d.path)).toEqual(["/p/src/a.rs", "/p/src/b.rs"]);
  expect(p.path).toBe("/p/src/b.rs");
  expect(p.editor).not.toBe(a);
  expect(p.editor.value()).toBe("fn b() {}\n");
  expect(p.dirty).toBe(false);
  // Back to a: its text, undo, caret and unsaved mark are as left.
  p.select(p.docs[0], cx());
  expect([p.editor, p.editor.value(), p.editor.undos, p.editor.cursor(), p.dirty]).toEqual([a, "fn a() {}\n// edited", 1, { line: 0, col: 4 }, true]);
  // The strip: both names, the unsaved mark dithered on a, the shown one lit.
  const strip = p.tabStrip(theme);
  expect(texts(strip).filter((s) => s.endsWith(".rs"))).toEqual(["a.rs", "b.rs"]);
  expect(byId(strip, "editor-tab-mark-0").kids.length).toBe(1);
  expect(byId(strip, "editor-tab-mark-1").kids.length).toBe(0);
  // A click on a tab shows it; the pane header's name follows.
  click(byId(strip, "editor-tab-1"));
  expect(p.path).toBe("/p/src/b.rs");
  expect(sharedNow["nocturne-editor.titles"].s1).toBe("b.rs");
  // Kept for a restart and noted for the files pane, the picker and the app.
  expect(JSON.parse(storage.tabs)).toEqual({ paths: ["/p/src/a.rs", "/p/src/b.rs"], active: 1 });
  expect(sharedNow["nocturne-editor.paths"].s1).toEqual(["/p/src/a.rs", "/p/src/b.rs"]);
});

test("a file already open shows its tab (at the line asked for), no second tab", async () => {
  const p = await pane();
  p.openFile("/p/src/b.rs", cx());
  await flush();
  p.openFile("/p/src/a.rs", cx(), { line: 3, col: 2 });
  expect(p.docs.length).toBe(2);
  expect(p.path).toBe("/p/src/a.rs");
  expect(p.editor.cursor()).toEqual({ line: 2, col: 1 });
});

test("closing: a clean tab closes, the next shows; an edited one asks (keep / discard / save); the last closes the pane", async () => {
  const p = await pane();
  p.openFile("/p/src/b.rs", cx());
  p.openFile("/p/docs/n.md", cx());
  await flush();
  p.select(p.docs[1], cx());
  p.closeTab(cx());
  expect(p.docs.map((d: any) => d.path)).toEqual(["/p/src/a.rs", "/p/docs/n.md"]);
  expect(p.path).toBe("/p/docs/n.md");
  // Edited: the question's line, and nothing closes yet.
  p.editor.type("more");
  expect(unsaved.at(-1)).toBe("n.md: unsaved changes");
  p.closeTab(cx());
  expect(p.asking?.doc.path).toBe("/p/docs/n.md");
  expect(texts(p.askLine(theme)).join(" ")).toMatch(/n\.md has unsaved changes/);
  expect(p.docs.length).toBe(2);
  // esc keeps it (the question holds the keys, before vim).
  expect(p.vimKey(key("escape"), cx())).toBe(true);
  expect([p.asking, p.docs.length]).toEqual([null, 2]);
  // s saves, then closes.
  p.closeTab(cx());
  p.vimKey(key("s"), cx());
  await flush();
  expect(disk["/p/docs/n.md"]).toBe("# N\nmore");
  expect(p.docs.map((d: any) => d.path)).toEqual(["/p/src/a.rs"]);
  // d discards: the last tab closes the pane, without the app asking again.
  p.editor.type("x");
  p.closeTab(cx());
  p.vimKey(key("d"), cx());
  expect(ran.at(-1)).toEqual(["pane.close", { pane: "p1", confirmed: true }]);
});

test("closing the pane asks once for every edited tab (setUnsaved), and :q refuses while any tab is edited", async () => {
  const p = await pane();
  p.editor.type("1");
  p.openFile("/p/src/b.rs", cx());
  await flush();
  p.editor.type("2");
  expect(unsaved.at(-1)).toBe("2 files with unsaved changes: a.rs, b.rs");
  p.vimCommand("quit", cx());
  expect(p.message.text).toMatch(/E37: unsaved changes in a\.rs, b\.rs/);
  expect(ran.some((r) => r[0] === "pane.close")).toBe(false);
});

test("a restart brings the tabs back, the shown one read, the others when first shown", async () => {
  storage.tabs = JSON.stringify({ paths: ["/p/src/a.rs", "/p/src/b.rs", "/p/docs/n.md"], active: 1 });
  const p = await pane();
  expect(p.docs.map((d: any) => [d.path, d.state])).toEqual([["/p/src/a.rs", "unloaded"], ["/p/src/b.rs", "ready"], ["/p/docs/n.md", "unloaded"]]);
  expect(p.editor.value()).toBe("fn b() {}\n");
  p.stepTab(1, cx());
  await flush();
  expect([p.path, p.state, p.view]).toEqual(["/p/docs/n.md", "ready", "split"]);
});

test("definition in another file opens it as a tab of this editor, at its place", async () => {
  const p = await pane();
  answer = (method) => (method === "textDocument/definition" ? { uri: "file:///p/src/b.rs", range: { start: { line: 4, character: 3 } } } : null);
  await p.definitionNow(cx());
  await flush();
  expect(p.path).toBe("/p/src/b.rs");
  expect(p.editor.cursor()).toEqual({ line: 4, col: 3 });
  expect(ran.some((r) => r[0] === "editor.open")).toBe(false);
  answer = () => null;
});

test("one server for every tab: one listener, diagnostics to the tab of their file, let go when its last tab closes", async () => {
  const p = await pane();
  p.openFile("/p/src/b.rs", cx());
  await flush();
  expect(p.docs.map((d: any) => d.server?.id)).toEqual([7, 7]);
  expect(notes.filter((n) => n[0] === "textDocument/didOpen").map((n) => n[1])).toEqual(["file:///p/src/a.rs", "file:///p/src/b.rs"]);
  // One queue for the server (herdr keeps one per copy): one listener.
  expect(new Set(listens).size).toBe(1);
  expect(p.listening.size).toBe(1);
  const diag = { method: "textDocument/publishDiagnostics", params: { uri: "file:///p/src/a.rs", diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, severity: 1, message: "bad" }] } };
  wake?.(diag);
  await flush();
  expect([p.docs[0].problems.length, p.docs[1].problems.length]).toEqual([1, 0]);
  // b closes: its document goes, the server stays for a.
  p.closeTab(cx());
  expect(notes.at(-1).slice(0, 2)).toEqual(["textDocument/didClose", "file:///p/src/b.rs"]);
  expect(released).toEqual([]);
  // The pane goes: a's document and the server.
  await p.close();
  expect(released).toEqual([7]);
});

test("the app's editor.open on a file in a background tab shows that tab (the goto record, with or without a line)", async () => {
  const p = await pane();
  p.openFile("/p/src/b.rs", cx());
  await flush();
  sharedNow["nocturne-editor.goto"] = { path: "/p/src/a.rs", n: 1 };
  p.render(cx());
  tick();
  expect(p.path).toBe("/p/src/a.rs");
  sharedNow["nocturne-editor.goto"] = { path: "/p/src/b.rs", line: 2, col: 5, n: 2 };
  p.render(cx());
  tick();
  expect([p.path, p.editor.cursor()]).toEqual(["/p/src/b.rs", { line: 1, col: 4 }]);
  // A file this pane doesn't hold: not its business.
  sharedNow["nocturne-editor.goto"] = { path: "/elsewhere.rs", n: 3 };
  p.render(cx());
  tick();
  expect(p.docs.length).toBe(2);
});

test("a file sent to this editor (shared nocturne-editor.open by slot) opens as a tab; another slot's request is left alone", async () => {
  const p = await pane();
  sharedNow["nocturne-editor.open"] = { slot: "other", path: "/p/src/b.rs", n: 1 };
  p.render(cx());
  tick();
  expect(p.docs.length).toBe(1);
  sharedNow["nocturne-editor.open"] = { slot: "s1", path: "/p/docs/n.md", view: "preview", n: 2 };
  p.render(cx());
  tick();
  await flush();
  expect([p.path, p.view]).toEqual(["/p/docs/n.md", "preview"]);
  // The editor with the keyboard notes itself for the next file.
  tick();
  expect(sharedNow["nocturne-editor.last"]).toBe("s1");
});

test("an editor opened for a Markdown viewer's edit starts with the preview on", async () => {
  storage.preview = "text";
  sharedNow["nocturne-editor.open"] = { slot: null, path: "/p/docs/n.md", view: "split", n: 4, at: Date.now() };
  const p = await pane("/p/docs/n.md");
  expect(p.view).toBe("split");
});

// ---- where files go (editor-route.js)

const ed = (pane: string, slot: string, tab = "t1", path?: string, extra: any = {}) => ({ pane, tab, mod: "nocturne-editor", props: { slot, path, ...extra } });

test("route: the editor holding the file, else the caller's, the focused one, the last with the keyboard, the tab's first; other tabs and machines don't count", () => {
  const panes = [{ pane: "f", tab: "t1", mod: "nocturne-files", props: {} }, ed("e1", "s1", "t1", "/a.rs"), ed("e2", "s2", "t1", "/b.rs"), ed("e3", "s3", "t2", "/c.rs"), ed("e4", "s4", "t1", "/d.rs", { on: "box" })];
  const pick = (o: any) => route.editorFor({ panes, tab: "t1", path: "/x.rs", ...o })?.pane ?? null;
  expect(pick({})).toBe("e1");
  expect(pick({ last: "s2" })).toBe("e2");
  expect(pick({ last: "s2", focused: "e1" })).toBe("e1");
  expect(pick({ last: "s1", focused: "e1", prefer: "s2" })).toBe("e2");
  // Already open (its tabs, as noted): that editor, whatever else.
  expect(pick({ path: "/z.rs", paths: { s2: ["/b.rs", "/z.rs"] }, focused: "e1" })).toBe("e2");
  expect(pick({ path: "/c.rs" })).toBe("e1"); // e3 is in another tab
  expect(pick({ tab: "t3" })).toBe(null);
  expect(route.editorFor({ panes, tab: "t1", path: "/x", on: "box" })?.pane).toBe("e4");
});

test("route: with an editor the file goes to it as a tab and it gets the focus; with none, editor.open as before", () => {
  const h = { ...herdr };
  paneList = [ed("e1", "s1", "t1", "/a.rs")];
  const to = route.openInEditor(h, { path: "/p/x.rs", line: 4, col: 2 });
  expect(to?.pane).toBe("e1");
  expect(sharedNow["nocturne-editor.open"]).toMatchObject({ slot: "s1", path: "/p/x.rs", line: 4, col: 2, n: 1 });
  expect(ran.at(-1)).toEqual(["pane.focus", { pane: "e1" }]);
  paneList = [];
  expect(route.openInEditor(h, { path: "/p/y.md", pane: "f", view: "split" })).toBe(null);
  expect(ran.at(-1)).toEqual(["editor.open", { path: "/p/y.md", pane: "f" }]);
  expect(sharedNow["nocturne-editor.open"]).toMatchObject({ slot: null, path: "/p/y.md", view: "split", n: 2 });
});

test("route: the copies in the files pane, the picker and the Markdown viewer are the editor's, byte for byte", () => {
  const read = (m: string) => readFileSync(new URL(`../defaults/mods/${m}/editor-route.js`, import.meta.url), "utf8");
  for (const m of ["nocturne-files", "nocturne-picker", "nocturne-markdown"]) expect(read(m)).toBe(read("nocturne-editor"));
});

test("the picker opens into the focused editor, else the shown tab's; the files pane into the one it sent files to", async () => {
  const pick = readFileSync(new URL("../defaults/mods/nocturne-picker/main.js", import.meta.url), "utf8");
  expect(pick).toMatch(/openInEditor\(herdr, \{ path, \.\.\.\(r\.match/);
  const files = readFileSync(new URL("../defaults/mods/nocturne-files/main.js", import.meta.url), "utf8");
  expect(files).toMatch(/openInEditor\(herdr, \{ path: `\$\{this\.root\}\/\$\{path\}`, pane: beside\?\.pane \?\? null, prefer: this\.editorSlot/);
  // The picker's case: a terminal focused, the shown tab's editor takes it.
  paneList = [{ pane: "t", tab: "t1", terminal: "x" }, ed("e1", "s1", "t1", "/a.rs")];
  focusedPane = "t";
  route.openInEditor(herdr, { path: "/p/q.rs" });
  expect(ran.at(-1)).toEqual(["pane.focus", { pane: "e1" }]);
});

// ---- vim's tab keys

test("vim: gt / gT / 3gt, ]b / [b, :bn :bp :bd :bd! :b 2 :ls, space b n / p / d", () => {
  const doc = { text: "abc\n", cursor: { line: 0, col: 0 }, clipboard: null, page: 10 };
  const run = (keys: string[]) => { const v = createVim(); const out: string[] = []; for (const k of keys) out.push(...(feed(v, k, doc).commands ?? [])); return out; };
  expect(run(["g", "t"])).toEqual(["next-tab"]);
  expect(run(["g", "T"])).toEqual(["prev-tab"]);
  expect(run(["3", "g", "t"])).toEqual(["tab:3"]);
  expect(run(["]", "b"])).toEqual(["next-tab"]);
  expect(run(["[", "b"])).toEqual(["prev-tab"]);
  const ex = (line: string) => run([":", ...line.split(""), "<cr>"]);
  expect(ex("bn")).toEqual(["next-tab"]);
  expect(ex("bp")).toEqual(["prev-tab"]);
  expect(ex("bd")).toEqual(["close-tab"]);
  expect(ex("bd!")).toEqual(["close-tab!"]);
  expect(ex("b 2")).toEqual(["tab:2"]);
  expect(ex("ls")).toEqual(["tabs"]);
  expect(run([" ", "b", "n"])).toEqual(["next-tab"]);
  expect(run([" ", "b", "d"])).toEqual(["close-tab"]);
});

test("the pane runs vim's tab commands and the app's next-tab / prev-tab / close-tab", async () => {
  const p = await pane();
  p.openFile("/p/src/b.rs", cx());
  p.openFile("/p/docs/n.md", cx());
  await flush();
  p.vimCommand("tab:1", cx());
  expect(p.path).toBe("/p/src/a.rs");
  p.command("prev-tab", cx());
  expect(p.path).toBe("/p/docs/n.md");
  p.vimCommand("next-tab", cx());
  expect(p.path).toBe("/p/src/a.rs");
  p.vimCommand("tabs", cx());
  expect(p.message.text).toBe("1% a.rs  2 b.rs  3 n.md");
  p.command("close-tab", cx());
  expect(p.docs.length).toBe(2);
  p.vimCommand("edit:../lib/b.rs", cx());
  await flush();
  expect(p.path).toBe("/p/lib/b.rs");
  // Two b.rs: the strip tells them apart.
  expect(texts(p.tabStrip(theme))).toEqual(expect.arrayContaining(["src", "lib"]));
});

// ---- links in the hover card (cardlinks.js)

const links = await import("../defaults/mods/nocturne-editor/cardlinks.js");

test("card links: inline (not images), reference definitions, <autolinks> and bare addresses, each once, in order", () => {
  const parts = [
    { code: "fn push(&mut self, value: T)", lang: "rust" },
    { text: "Appends to the back of a [`Vec`](https://doc.rust-lang.org/std/vec/struct.Vec.html). ![logo](logo.png)\nSee <https://docs.rs/x> and https://example.org/a_b. Also [`Vec`](https://doc.rust-lang.org/std/vec/struct.Vec.html) again." },
    { text: "[helper]: file:///p/src/util.ts#L12%2C5\n[local](../lib/b.rs:3:2)" },
  ];
  expect(links.cardLinks(parts)).toEqual([
    { label: "Vec", url: "https://doc.rust-lang.org/std/vec/struct.Vec.html" },
    { label: "https://docs.rs/x", url: "https://docs.rs/x" },
    { label: "https://example.org/a_b", url: "https://example.org/a_b" },
    { label: "helper", url: "file:///p/src/util.ts#L12%2C5" },
    { label: "local", url: "../lib/b.rs:3:2" },
  ]);
  expect(links.cardLinks([{ code: "https://not.a.link" }, { text: "[top](#heading)" }])).toEqual([]);
  // Underscores inside a name stay; emphasis around words goes.
  expect(links.cardLinks([{ text: "[`with_capacity`](https://a/b) and [**bold** _it_](https://c)" }]).map((l: any) => l.label)).toEqual(["with_capacity", "bold it"]);
});

test("card links: where each goes: web pages, file:// with #L12 / #L12,5 / %2C, relative paths, path:line:col, mailto, anchors", () => {
  const from = "/p/src/a.rs";
  expect(links.linkTarget("https://doc.rust-lang.org/std/", from)).toEqual({ kind: "web", url: "https://doc.rust-lang.org/std/" });
  expect(links.linkTarget("file:///p/src/util.ts#L12%2C5", from)).toEqual({ kind: "file", path: "/p/src/util.ts", line: 12, col: 5 });
  expect(links.linkTarget("file:///p/src/util.ts#L7", from)).toEqual({ kind: "file", path: "/p/src/util.ts", line: 7, col: null });
  expect(links.linkTarget("file:///p/My%20Docs/x.ts#L3,9", from)).toEqual({ kind: "file", path: "/p/My Docs/x.ts", line: 3, col: 9 });
  expect(links.linkTarget("../lib/b.rs", from)).toEqual({ kind: "file", path: "/p/lib/b.rs", line: null, col: null });
  expect(links.linkTarget("../lib/b.rs:3:2", from)).toEqual({ kind: "file", path: "/p/lib/b.rs", line: 3, col: 2 });
  expect(links.linkTarget("/abs/notes.md", from)).toEqual({ kind: "file", path: "/abs/notes.md", line: null, col: null });
  expect(links.linkTarget("https://x.example:8080", from)).toEqual({ kind: "web", url: "https://x.example:8080" });
  expect(links.linkTarget("mailto:a@b.c", from)).toEqual({ kind: "other", url: "mailto:a@b.c" });
  expect(links.linkTarget("#section", from)).toBe(null);
  expect([links.linkWhere(links.linkTarget("https://docs.rs/x/1", from)), links.linkWhere(links.linkTarget("../lib/b.rs:3", from))]).toEqual(["docs.rs", "b.rs:3"]);
});

/** A pane with a keyboard card open on an answer holding links. */
async function cardWithLinks(): Promise<any> {
  const p = await pane();
  answer = (method) => (method === "textDocument/hover" ? { contents: { kind: "markdown", value: "```rust\nfn x()\n```\nSee [`Vec`](https://doc.rust-lang.org/std/vec/struct.Vec.html) and [util](file:///p/src/b.rs#L3%2C2)." } } : null);
  p.command("hover", cx());
  await flush();
  return p;
}

test("the card's links: tab rings them (wrapping, shift-tab back), enter follows the ringed one; the list draws the ring", async () => {
  const p = await cardWithLinks();
  expect(p.card.links.map((l: any) => l.label)).toEqual(["Vec", "util"]);
  expect(p.vimKey(key("tab"), cx())).toBe(true);
  expect(p.card.link).toBe(0);
  p.vimKey(key("tab"), cx());
  p.vimKey(key("tab"), cx());
  expect(p.card.link).toBe(0);
  p.vimKey(key("tab", { shift: true }), cx());
  expect(p.card.link).toBe(1);
  const view = p.cardLinksView(theme, p.card);
  expect(texts(view)).toEqual(expect.arrayContaining(["LINKS", "↗", "Vec", "doc.rust-lang.org", "→", "util", "b.rs:3"]));
  // The ringed row: the accent edge and the band.
  expect(byId(view, "card-link-1").calls.border_color[0][0]).toBe(theme.accent);
  expect(byId(view, "card-link-1").calls.bg).toBeDefined();
  expect(byId(view, "card-link-0").calls.bg).toBeUndefined();
  // enter: the file opens as a tab of this editor, at its line; the card closes.
  expect(p.vimKey(key("enter"), cx())).toBe(true);
  await flush();
  expect([p.card, p.path, p.editor.cursor()]).toEqual([null, "/p/src/b.rs", { line: 2, col: 1 }]);
  expect(p.docs.length).toBe(2);
});

test("a web link: the shown tab's browser pane gets it (nocturne-browser.open by slot); with none, a browser pane beside", async () => {
  const p = await cardWithLinks();
  paneList.push({ pane: "w1", tab: "t1", mod: "nocturne-browser", props: { slot: "web1", url: "https://x" } });
  p.followLink("https://doc.rust-lang.org/std/vec/struct.Vec.html", cx());
  expect(ran.at(-1)).toEqual([`nocturne-browser.open:${JSON.stringify({ url: "https://doc.rust-lang.org/std/vec/struct.Vec.html", slot: "web1" })}`]);
  expect(p.card).toBe(null);
  // A browser in another tab doesn't count.
  paneList[1].tab = "t2";
  p.followLink("https://docs.rs/x", cx());
  expect(ran.at(-1)).toEqual(["app.open_url", { url: "https://docs.rs/x", in: "app" }]);
  // The pointer: TextView's link click goes the same way.
  const c2 = await cardWithLinks();
  const md = all(c2.cardView(theme, "mono") ?? new El()).find((x: any) => x.calls?.on_link_click);
  void md; // (the card isn't drawn without a word on screen; the handler is wired in cardView, checked below)
  const src = readFileSync(new URL("../defaults/mods/nocturne-editor/main.js", import.meta.url), "utf8");
  expect(src).toMatch(/\.on_link_click\(\(url, cx\) => this\.followLink\(url, cx\)\)/);
});

test("a pointer's card doesn't ring links on tab (the key goes on to vim / the text); a picture link opens in the preview beside", async () => {
  const p = await cardWithLinks();
  p.card.keyboard = false;
  p.vimKey(key("tab"), cx());
  expect(p.card?.link ?? null).toBe(null);
  p.followLink("../shot.png", cx());
  expect(ran.at(-1)).toEqual(["preview.open", { path: "/p/shot.png", pane: "p1" }]);
});
