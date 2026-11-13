// The editor's file tabs (editor/tabs.ts, main.js) and where files
// go (editor-route.ts, copied into the files pane, the picker and the
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
let zoomNow = 1;
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
  settings: () => ({ zoom: zoomNow, editor: {} }), window: () => ({ platform: "macos" }), appHome: () => "/tmp/app", home: () => "/home/a",
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
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: (src: string) => Object.assign(new El(), { src }), image: () => new El(), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
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
  focus() {} set_soft_wrap() {} set_tab_size() {} set_cursor_shape() {} set_diagnostics(list: any) { (this as any).diags = list; } set_line_notes() {} find_close() {} top_line() { return 0; }
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

const { default: EditorPane } = await import("../defaults/mods/editor/main.ts");
const tabs = await import("../defaults/mods/editor/tabs.ts");
const route = await import("../defaults/mods/editor/editor-route.ts");
const icons = await import("../defaults/mods/editor/file-icons.ts");
const { createVim, feed } = await import("../defaults/mods/editor/vim.ts");

let later: [number, (cx: any) => void][] = [];
function cx(): any {
  return {
    notified: 0, stop_propagation() {}, notify() { this.notified++; },
    timer: { after: (ms: number, fn: any) => later.push([ms, fn]), every() {} },
    spawn: (fn: any) => { fn(cx()); }, focus_handle: () => ({ focus() {}, is_focused: () => true }),
    read_from_clipboard: () => null, write_to_clipboard(t: string) { clip.push(t); },
    // A nested view (the drawn tabs' viewer): its class and the props it was given.
    new: (C: any, props: any) => ({ C, props, set_props(p: any) { this.props = p; } }),
  };
}
const clip: string[] = [];
const tick = () => { const due = later; later = []; for (const [, fn] of due) fn(cx()); };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

async function pane(path = "/p/src/a.rs", more: any = {}): Promise<any> {
  later = [];
  propsNow = { path, slot: "s1", ...more };
  paneList = [{ pane: "p1", tab: "t1", mod: "editor", props: propsNow }];
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
  zoomNow = 1; sharedNow = {}; storage = {}; ran.length = 0; notes.length = 0; released.length = 0; unsaved.length = 0; starts = 0; queue = []; wake = null; listens.length = 0;
  spaceList = [{ active: true, tabs: [{ id: "t1", active: true }] }]; focusedPane = null; eds.length = 0;
});

// ---- the tab model (tabs.ts)

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
  expect(sharedNow["editor.titles"].s1).toBe("b.rs");
  // Kept for a restart and noted for the files pane, the picker and the app.
  expect(JSON.parse(storage.tabs)).toEqual({ paths: ["/p/src/a.rs", "/p/src/b.rs"], active: 1 });
  expect(sharedNow["editor.paths"].s1).toEqual(["/p/src/a.rs", "/p/src/b.rs"]);
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
  sharedNow["editor.goto"] = { path: "/p/src/a.rs", n: 1 };
  p.render(cx());
  tick();
  expect(p.path).toBe("/p/src/a.rs");
  sharedNow["editor.goto"] = { path: "/p/src/b.rs", line: 2, col: 5, n: 2 };
  p.render(cx());
  tick();
  expect([p.path, p.editor.cursor()]).toEqual(["/p/src/b.rs", { line: 1, col: 4 }]);
  // A file this pane doesn't hold: not its business.
  sharedNow["editor.goto"] = { path: "/elsewhere.rs", n: 3 };
  p.render(cx());
  tick();
  expect(p.docs.length).toBe(2);
});

test("a file sent to this editor (shared editor.open by slot) opens as a tab; another slot's request is left alone", async () => {
  const p = await pane();
  sharedNow["editor.open"] = { slot: "other", path: "/p/src/b.rs", n: 1 };
  p.render(cx());
  tick();
  expect(p.docs.length).toBe(1);
  sharedNow["editor.open"] = { slot: "s1", path: "/p/docs/n.md", view: "preview", n: 2 };
  p.render(cx());
  tick();
  await flush();
  expect([p.path, p.view]).toEqual(["/p/docs/n.md", "preview"]);
  // The editor with the keyboard notes itself for the next file.
  tick();
  expect(sharedNow["editor.last"]).toBe("s1");
});

test("an editor opened for a Markdown viewer's edit starts with the preview on", async () => {
  storage.preview = "text";
  sharedNow["editor.open"] = { slot: null, path: "/p/docs/n.md", view: "split", n: 4, at: Date.now() };
  const p = await pane("/p/docs/n.md");
  expect(p.view).toBe("split");
});

test("a restart: an editor whose editor.paths entry is from before (a scratchpad note it no longer holds) says the tabs it has, so the app's editor.open doesn't send the note to it", async () => {
  const note = "/app/scratchpad/p-1a2b3c4d.md";
  sharedNow["editor.paths"] = { s1: ["/p/src/a.rs", note], gone: [note] };
  storage.tabs = JSON.stringify({ paths: ["/p/src/a.rs", "/p/src/b.rs"], active: 0 });
  await pane("/p/src/a.rs");
  // Its own entry is its tabs; a slot no pane has any more goes.
  expect(sharedNow["editor.paths"]).toEqual({ s1: ["/p/src/a.rs", "/p/src/b.rs"] });
  expect(route.filesOf(paneList[0], route.editorPaths((k: string) => sharedNow[k] ?? null))).not.toContain(note);
});

// ---- where files go (editor-route.ts)

// Props as the app hands them (JSON: a key is there with a value, or not there).
const ed = (pane: string, slot: string, tab = "t1", path?: string, extra: any = {}) => ({ pane, tab, mod: "editor", props: { slot, ...(path ? { path } : {}), ...extra } });

test("route: the editor holding the file, else the caller's, the focused one, the last with the keyboard, the tab's first; other tabs and machines don't count", () => {
  const panes = [{ pane: "f", tab: "t1", mod: "file-tree", props: {} }, ed("e1", "s1", "t1", "/a.rs"), ed("e2", "s2", "t1", "/b.rs"), ed("e3", "s3", "t2", "/c.rs"), ed("e4", "s4", "t1", "/d.rs", { on: "box" })];
  const pick = (o: any) => route.editorFor({ panes, tab: "t1", path: "/x.rs", ...o })?.pane ?? null;
  expect(pick({})).toBe("e1");
  expect(pick({ last: "s2" })).toBe("e2");
  expect(pick({ last: "s2", focused: "e1" })).toBe("e1");
  expect(pick({ last: "s1", focused: "e1", prefer: "s2" })).toBe("e2");
  // Already open (its tabs, as noted): that editor, whatever else.
  expect(pick({ path: "/z.rs", paths: new Map([["s2", ["/b.rs", "/z.rs"]]]), focused: "e1" })).toBe("e2");
  expect(pick({ path: "/c.rs" })).toBe("e1"); // e3 is in another tab
  expect(pick({ tab: "t3" })).toBe(null);
  expect(route.editorFor({ panes, tab: "t1", path: "/x", on: "box" })?.pane).toBe("e4");
});

test("route: with an editor the file goes to it as a tab and it gets the focus; with none, editor.open as before", () => {
  const h = { ...herdr };
  paneList = [ed("e1", "s1", "t1", "/a.rs")];
  const to = route.openInEditor(h, { path: "/p/x.rs", line: 4, col: 2 });
  expect(to?.pane).toBe("e1");
  expect(sharedNow["editor.open"]).toMatchObject({ slot: "s1", path: "/p/x.rs", line: 4, col: 2, n: 1 });
  expect(ran.at(-1)).toEqual(["pane.focus", { pane: "e1" }]);
  paneList = [];
  expect(route.openInEditor(h, { path: "/p/y.md", pane: "f", view: "split" })).toBe(null);
  expect(ran.at(-1)).toEqual(["editor.open", { path: "/p/y.md", pane: "f" }]);
  expect(sharedNow["editor.open"]).toMatchObject({ slot: null, path: "/p/y.md", view: "split", n: 2 });
});

test("route: the copies in the files pane, the picker and the Markdown viewer are the editor's, byte for byte", () => {
  const read = (m: string) => readFileSync(new URL(`../defaults/mods/${m}/editor-route.ts`, import.meta.url), "utf8");
  for (const m of ["file-tree", "finder", "markdown"]) expect(read(m)).toBe(read("editor"));
});

test("the picker opens into the focused editor, else the shown tab's; the files pane into the one it sent files to", async () => {
  const pick = readFileSync(new URL("../defaults/mods/finder/main.ts", import.meta.url), "utf8");
  expect(pick).toMatch(/openInEditor\(herdr, "match" in r \? \{ path, line/);
  const files = readFileSync(new URL("../defaults/mods/file-tree/opening.ts", import.meta.url), "utf8");
  expect(files).toMatch(/openInEditor\(herdr, \{ path: `\$\{v\.root\}\/\$\{path\}`, pane: beside\?\.pane \?\? null, prefer: v\.editorSlot/);
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
  // The command with its file: a tab, at its line (a relative path: the shown file's folder's).
  p.command('open:{"path":"../docs/n.md","line":1,"view":"text"}', cx());
  await flush();
  expect([p.path, p.view]).toEqual(["/p/docs/n.md", "text"]);
  p.command('open:{"path":"/p/lib/b.rs"}', cx());
  // Two b.rs: the strip tells them apart.
  expect(texts(p.tabStrip(theme))).toEqual(expect.arrayContaining(["src", "lib"]));
});

// ---- links in the hover card (cardlinks.ts)

const links = await import("../defaults/mods/editor/cardlinks.ts");

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

test("a web link: the shown tab's browser pane gets it (browser.open by slot); with none, a browser pane beside", async () => {
  const p = await cardWithLinks();
  paneList.push({ pane: "w1", tab: "t1", mod: "browser", props: { slot: "web1", url: "https://x" } });
  p.followLink("https://doc.rust-lang.org/std/vec/struct.Vec.html", cx());
  expect(ran.at(-1)).toEqual([`browser.open:${JSON.stringify({ url: "https://doc.rust-lang.org/std/vec/struct.Vec.html", slot: "web1" })}`]);
  expect(p.card).toBe(null);
  // A browser in another tab doesn't count.
  paneList[1].tab = "t2";
  p.followLink("https://docs.rs/x", cx());
  expect(ran.at(-1)).toEqual(["app.open_url", { url: "https://docs.rs/x", in: "app" }]);
  // The pointer: TextView's link click goes the same way.
  const c2 = await cardWithLinks();
  const md = all(c2.cardView(theme, "mono") ?? new El()).find((x: any) => x.calls?.on_link_click);
  void md; // (the card isn't drawn without a word on screen; the handler is wired in cardView, checked below)
  const src = readFileSync(new URL("../defaults/mods/editor/main.ts", import.meta.url), "utf8");
  expect(src).toMatch(/\.on_link_click\(\(url, cx\) => this\.followLink\(url, cx\)\)/);
});

test("a pointer's card doesn't ring links on tab (the key goes on to vim / the text); a picture link opens as a drawn tab here", async () => {
  const p = await cardWithLinks();
  p.card.keyboard = false;
  p.vimKey(key("tab"), cx());
  expect(p.card?.link ?? null).toBe(null);
  p.followLink("../shot.png", cx());
  expect([p.path, p.look]).toEqual(["/p/shot.png", true]);
  expect(ran.some((r) => r[0] === "preview.open")).toBe(false);
});

// ---- edit from the Markdown viewer

test("the Markdown viewer's edit: the viewer closes and the editor takes its place with the preview on (a tab when the tab has an editor)", async () => {
  const { default: Markdown } = await import("../defaults/mods/markdown/main.ts");
  const viewer: any = Object.create(Markdown.prototype);
  Object.assign(viewer, { path: "/p/docs/n.md", on: null, slot: "m1" });
  // No editor in the tab: a new one beside the viewer (asked for the preview), then the viewer closes.
  paneList = [{ pane: "pm", tab: "t1", mod: "markdown", props: { slot: "m1", path: "/p/docs/n.md" } }];
  viewer.edit();
  expect(ran.slice(-2)).toEqual([["editor.open", { path: "/p/docs/n.md", pane: "pm" }], ["pane.close", { pane: "pm" }]]);
  expect(sharedNow["editor.open"]).toMatchObject({ slot: null, path: "/p/docs/n.md", view: "split" });
  // The new editor starts on the preview's split view.
  storage.preview = "text";
  const p = await pane("/p/docs/n.md");
  expect(p.view).toBe("split");
  // An editor in the tab: the file goes to it as a tab, preview on; the viewer closes.
  paneList = [{ pane: "pm", tab: "t1", mod: "markdown", props: { slot: "m1", path: "/p/docs/n.md" } }, ed("e1", "s1", "t1", "/p/src/a.rs")];
  ran.length = 0;
  viewer.edit();
  expect(ran).toEqual([["pane.focus", { pane: "e1" }], ["pane.close", { pane: "pm" }]]);
  expect(sharedNow["editor.open"]).toMatchObject({ slot: "s1", path: "/p/docs/n.md", view: "split" });
});

// ---- word wrap per tab (edfiles' toggle: cmd-k z, space u w, :set wrap, the bar's chip)

test("word wrap belongs to the shown tab: each starts from its language, the toggle flips only the shown one", async () => {
  const p = await pane();
  const rs = p.editor;
  rs.set_soft_wrap = function (on: boolean) { (this as any).wrap = on; };
  expect(p.softWrap).toBe(false);
  p.openFile("/p/docs/n.md", cx());
  await flush();
  const md = p.editor;
  md.set_soft_wrap = function (on: boolean) { (this as any).wrap = on; };
  expect(p.softWrap).toBe(true); // Markdown starts wrapped
  p.command("wrap", cx());
  expect([p.softWrap, md.wrap]).toEqual([false, false]);
  p.select(p.docs[0], cx());
  expect([p.softWrap, rs.wrap]).toEqual([false, undefined]);
  p.vimCommand("set:wrap", cx());
  expect([p.softWrap, rs.wrap, p.docs[1].softWrap]).toEqual([true, true, false]);
});

// ---- one file: no strip; moving tabs (a drag, ]B / [B, :tabm, the commands); H / L

test("a scratchpad (one tab) has no strip either: the bar says scratchpad, no unsaved mark (it saves itself)", async () => {
  const note = "/tmp/app/scratchpad/repo-0123abcd.md";
  disk[note] = "# note\n";
  const p = await pane(note);
  const view = p.render(cx());
  const ids = (root: any) => all(root).map((x) => x.calls?.id?.[0]?.[0]).filter(Boolean);
  expect(ids(view)).not.toContain("editor-tabs");
  expect(texts(byId(view, "bar-name"))).toEqual(["scratchpad"]);
  expect(byId(view, "bar-mark")).toBeUndefined();
});

test("one file: no strip, the bar names it with its unsaved mark; from two files the strip shows and the bar doesn't", async () => {
  const p = await pane();
  const ids = (root: any) => all(root).map((x) => x.calls?.id?.[0]?.[0]).filter(Boolean);
  expect(tabs.showStrip(1)).toBe(false);
  expect(tabs.showStrip(2)).toBe(true);
  let view = p.render(cx());
  expect(ids(view)).not.toContain("editor-tabs");
  expect(texts(byId(view, "bar-name"))).toEqual(["a.rs"]);
  expect(byId(view, "bar-mark").kids.length).toBe(0);
  p.editor.type("x");
  expect(byId(p.render(cx()), "bar-mark").kids.length).toBe(1); // dithered: unsaved
  // The card sits under the bar only: no strip's height above it.
  expect(p.stripH()).toBe(0);
  p.openFile("/p/src/b.rs", cx());
  await flush();
  view = p.render(cx());
  expect(ids(view)).toContain("editor-tabs");
  expect(ids(view)).not.toContain("bar-name");
  expect(p.stripH()).toBe(26);
  // Closing back to one: the strip goes again.
  p.closeTab(cx());
  expect(ids(p.render(cx()))).not.toContain("editor-tabs");
});

test("model: where a dragged tab lands and where its stake stands", () => {
  // Four tabs, the second (1) dragged.
  expect(tabs.gapAt(2, 10, 100)).toEqual({ index: 2, after: false });
  expect(tabs.gapAt(2, 60, 100)).toEqual({ index: 2, after: true });
  expect(tabs.dropIndex(4, 1, { index: 3, after: true })).toBe(3); // the end
  expect(tabs.dropIndex(4, 1, { index: null })).toBe(3); // past the last tab
  expect(tabs.dropIndex(4, 1, { index: 3, after: false })).toBe(2);
  expect(tabs.dropIndex(4, 1, { index: 0, after: false })).toBe(0);
  expect(tabs.dropIndex(4, 1, { index: 0, after: true })).toBe(null); // its own gap
  expect(tabs.dropIndex(4, 1, { index: 2, after: false })).toBe(null); // its own gap
  expect(tabs.dropIndex(4, 1, { index: 1, after: true })).toBe(null); // over itself
  expect(tabs.stakeAt(4, 1, 3)).toEqual({ before: null });
  expect(tabs.stakeAt(4, 1, 2)).toEqual({ before: 3 });
  expect(tabs.stakeAt(4, 1, 0)).toEqual({ before: 0 });
  expect(tabs.stakeAt(4, 1, null)).toBe(null);
  expect(tabs.moved(["a", "b", "c", "d"], 1, 3)).toEqual(["a", "c", "d", "b"]);
  expect(tabs.moved(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
});

/** Three tabs a, b, n (b shown), with the strip wide enough for all. */
async function three(): Promise<any> {
  const p = await pane();
  p.openFile("/p/src/b.rs", cx());
  p.openFile("/p/docs/n.md", cx());
  p.select(p.docs[1], cx());
  await flush();
  p.size = { width: 1200, height: 600 };
  return p;
}
const order = (p: any) => p.docs.map((d: any) => d.path.split("/").pop());
const fire = (el: any, name: string, ...args: any[]) => el.calls[name].find((c: any[]) => typeof c[c.length - 1] === "function").at(-1)(...args);

test("a drag along the strip: a press, a move past 4 px lifts the tab, a stake marks the gap, the drop moves it; kept for a restart", async () => {
  const p = await three();
  let strip = p.tabStrip(theme);
  // Press on b (index 1), then move over n's right half.
  fire(byId(strip, "editor-tab-1"), "on_mouse_down", { position: { x: 200, y: 5 } }, cx());
  fire(byId(strip, "editor-tab-2"), "on_mouse_move", { position: { x: 202, y: 5 }, local_position: { x: 70, y: 5 }, bounds: { width: 100 } }, cx());
  expect(p.tabDrag).toBe(null); // 2 px: still a click
  fire(byId(strip, "editor-tab-2"), "on_mouse_move", { position: { x: 300, y: 5 }, local_position: { x: 70, y: 5 }, bounds: { width: 100 } }, cx());
  expect(p.tabDrag).toEqual({ from: 1, gap: { index: 2, after: true }, out: false });
  // Drawn: b lifted (its plate), the stake at the end, the pointer grabbing.
  strip = p.tabStrip(theme);
  expect(byId(strip, "editor-tab-1").kids.length).toBeGreaterThan(byId(p.tabStrip(theme), "editor-tab-0").kids.length);
  expect(byId(strip, "editor-tabs-end").kids.length).toBe(1);
  expect(strip.calls.cursor_grabbing).toBeTruthy();
  // The drop: b goes last, still shown; the order is kept and told.
  fire(strip, "on_mouse_up", {}, cx());
  expect(order(p)).toEqual(["a.rs", "n.md", "b.rs"]);
  expect(p.path).toBe("/p/src/b.rs");
  expect(JSON.parse(storage.tabs)).toEqual({ paths: ["/p/src/a.rs", "/p/docs/n.md", "/p/src/b.rs"], active: 2 });
  expect(sharedNow["editor.paths"].s1).toEqual(["/p/src/a.rs", "/p/docs/n.md", "/p/src/b.rs"]);
  // A restart: the same order, the same tab shown.
  const q = await pane();
  expect([order(q), q.path]).toEqual([["a.rs", "n.md", "b.rs"], "/p/src/b.rs"]);
});

test("a drag that leaves the strip or drops on its own gap changes nothing; a press without a move is a click", async () => {
  const p = await three();
  let strip = p.tabStrip(theme);
  fire(byId(strip, "editor-tab-1"), "on_mouse_down", { position: { x: 200, y: 5 } }, cx());
  fire(byId(strip, "editor-tab-0"), "on_mouse_move", { position: { x: 100, y: 5 }, local_position: { x: 10, y: 5 }, bounds: { width: 100 } }, cx());
  expect(p.tabDrag?.gap).toEqual({ index: 0, after: false });
  // Off the strip and then off the pane: the drag ends.
  fire(strip, "on_hover", false, cx());
  fire(p.render(cx()), "on_hover", false, cx());
  expect(p.tabDrag).toBe(null);
  fire(strip, "on_mouse_up", {}, cx());
  expect(order(p)).toEqual(["a.rs", "b.rs", "n.md"]);
  // Over its own right gap (the left half of the next tab): no stake, no move.
  strip = p.tabStrip(theme);
  fire(byId(strip, "editor-tab-1"), "on_mouse_down", { position: { x: 200, y: 5 } }, cx());
  fire(byId(strip, "editor-tab-2"), "on_mouse_move", { position: { x: 260, y: 5 }, local_position: { x: 10, y: 5 }, bounds: { width: 100 } }, cx());
  expect(texts(p.tabStrip(theme)).length).toBeGreaterThan(0);
  fire(strip, "on_mouse_up", {}, cx());
  expect(order(p)).toEqual(["a.rs", "b.rs", "n.md"]);
  // A press and a click on a: shown.
  strip = p.tabStrip(theme);
  fire(byId(strip, "editor-tab-0"), "on_mouse_down", { position: { x: 20, y: 5 } }, cx());
  click(byId(strip, "editor-tab-0"));
  fire(strip, "on_mouse_up", {}, cx());
  expect([p.path, order(p)]).toEqual(["/p/src/a.rs", ["a.rs", "b.rs", "n.md"]]);
});

test("the wheel over the strip steps the tabs; a middle click closes one", async () => {
  const p = await three();
  const strip = p.tabStrip(theme);
  fire(strip, "on_scroll_wheel", { delta: { y: -3 } }, cx());
  expect(p.path).toBe("/p/docs/n.md");
  fire(strip, "on_scroll_wheel", { delta: { y: 3 } }, cx());
  expect(p.path).toBe("/p/src/b.rs");
  fire(byId(p.tabStrip(theme), "editor-tab-0"), "on_mouse_down", { position: { x: 0, y: 0 } }, cx()); // the left press (no-op), then
  byId(p.tabStrip(theme), "editor-tab-0").calls.on_mouse_down.find((c: any[]) => c[0] === "middle")[1]({}, cx());
  expect(order(p)).toEqual(["b.rs", "n.md"]);
});

test("moving by key: ]B / [B, :tabm N / +N / -N / (none), space b < / >, the commands; ends say so; kept for a restart", async () => {
  const doc = { text: "abc\n", cursor: { line: 0, col: 0 }, clipboard: null, page: 10 };
  const run = (keys: string[]) => { const v = createVim(); const out: string[] = []; for (const k of keys) out.push(...(feed(v, k, doc).commands ?? [])); return out; };
  expect(run(["]", "B"])).toEqual(["move-tab-right"]);
  expect(run(["2", "[", "B"])).toEqual(["move-tab-left", "move-tab-left"]);
  const ex = (line: string) => run([":", ...line.split(""), "<cr>"]);
  expect(ex("tabm 0")).toEqual(["move-tab:0"]);
  expect(ex("tabm +1")).toEqual(["move-tab:+1"]);
  expect(ex("tabmove -2")).toEqual(["move-tab:-2"]);
  expect(ex("tabm")).toEqual(["move-tab:$"]);
  expect(run([" ", "b", "<"])).toEqual(["move-tab-left"]);
  expect(run([" ", "b", ">"])).toEqual(["move-tab-right"]);
  const p = await three();
  p.command("move-tab-right", cx());
  expect(order(p)).toEqual(["a.rs", "n.md", "b.rs"]);
  p.vimCommand("move-tab-right", cx());
  expect([order(p), p.message.text]).toEqual([["a.rs", "n.md", "b.rs"], "the last tab"]);
  p.vimCommand("move-tab:0", cx());
  expect(order(p)).toEqual(["b.rs", "a.rs", "n.md"]);
  p.command("move-tab-left", cx());
  expect(p.message.text).toBe("the first tab");
  p.vimCommand("move-tab:+2", cx());
  expect(order(p)).toEqual(["a.rs", "n.md", "b.rs"]);
  p.vimCommand("move-tab:-1", cx());
  expect(order(p)).toEqual(["a.rs", "b.rs", "n.md"]);
  p.vimCommand("move-tab:$", cx());
  expect([order(p), p.path]).toEqual([["a.rs", "n.md", "b.rs"], "/p/src/b.rs"]);
  expect(JSON.parse(storage.tabs)).toEqual({ paths: ["/p/src/a.rs", "/p/docs/n.md", "/p/src/b.rs"], active: 2 });
});

test("H / L: the previous / next tab while there are several (a count: that many); with one, the screen's top / bottom line", async () => {
  const text = Array.from({ length: 100 }, (_, i) => `  line ${i}`).join("\n");
  const feedOne = (k: string[], d: any) => { const v = createVim(); let r: any; const cmds: string[] = []; for (const x of k) { r = feed(v, x, d); cmds.push(...(r.commands ?? [])); } return { cmds, cursor: r.cursor }; };
  // Several tabs: commands, no move.
  const many = { text, cursor: { line: 50, col: 2 }, clipboard: null, page: 10, top: 40, rows: 20, tabs: 3 };
  expect(feedOne(["L"], many).cmds).toEqual(["next-tab"]);
  expect(feedOne(["H"], many).cmds).toEqual(["prev-tab"]);
  expect(feedOne(["2", "L"], many).cmds).toEqual(["next-tab", "next-tab"]);
  // One tab: H the top line on screen, L the bottom, M the middle (first non-blank), 3H the third.
  const one = { ...many, tabs: 1 };
  expect(feedOne(["H"], one)).toEqual({ cmds: [], cursor: { line: 40, col: 2 } });
  expect(feedOne(["L"], one)).toEqual({ cmds: [], cursor: { line: 59, col: 2 } });
  expect(feedOne(["M"], one).cursor).toEqual({ line: 49, col: 2 });
  expect(feedOne(["3", "H"], one).cursor).toEqual({ line: 42, col: 2 });
  // With an operator H / L stay motions even with several tabs: dL deletes to the screen's bottom.
  const v = createVim();
  feed(v, "d", many);
  const r = feed(v, "L", many);
  expect(r.commands ?? []).toEqual([]);
  expect(r.edits?.length).toBe(1);
  // The pane hands vim its screen and tab count: H in a pane with three tabs steps back.
  const p = await three();
  p.vimKey(key("H", { shift: true }), cx());
  expect(p.path).toBe("/p/src/a.rs");
  p.vimKey(key("L", { shift: true }), cx());
  expect(p.path).toBe("/p/src/b.rs");
});

// ---- every kind of file as a tab: drawn tabs (the preview's viewer), Markdown to read

const { default: Viewer } = await import("../defaults/mods/editor/viewer.ts");
const ids = (root: any) => all(root).map((x) => x.calls?.id?.[0]?.[0]).filter(Boolean);
const keyc = (c: string, mods: any = {}) => ({ key: c.length === 1 ? c.toLowerCase() : c, key_char: c.length === 1 ? c : null, modifiers: { shift: c.length === 1 && c !== c.toLowerCase(), control: false, alt: false, platform: false, ...mods } });

test("model: which files are drawn, text, or either; how a new tab starts and a request moves an open one", () => {
  expect(["/a.png", "/a.PDF", "/a.sqlite", "/a.ttf", "/a.mp4", "/a.mp3"].map(tabs.tabKind)).toEqual(Array(6).fill("look"));
  expect(["/a.csv", "/a.tsv", "/a.patch", "/a.diff", "/a.svg"].map(tabs.tabKind)).toEqual(Array(5).fill("either"));
  expect(["/a.rs", "/a.md", "/Makefile", "/a.json"].map(tabs.tabKind)).toEqual(Array(4).fill("text"));
  // A picture is drawn however it's opened; a table when opened to look at, or asked for drawn.
  expect(tabs.startsDrawn("/a.png")).toBe(true);
  expect(tabs.startsDrawn("/a.csv")).toBe(false);
  expect(tabs.startsDrawn("/a.csv", { look: true })).toBe(true);
  expect(tabs.startsDrawn("/a.csv", { look: true, view: "text" })).toBe(false);
  expect(tabs.startsDrawn("/a.csv", { view: "preview" })).toBe(true);
  expect(tabs.startsDrawn("/a.md", { look: true })).toBe(false);
  // An open tab: "text" / "preview" move a table; a bare look leaves it; a picture stays drawn.
  expect(tabs.drawnAfter("/a.csv", { view: "text" })).toBe(false);
  expect(tabs.drawnAfter("/a.csv", { view: "preview" })).toBe(true);
  expect(tabs.drawnAfter("/a.csv", {})).toBe(null);
  expect(tabs.drawnAfter("/a.png", { view: "text" })).toBe(true);
  expect(tabs.drawnAfter("/a.rs", { view: "text" })).toBe(null);
});

test("model: a drawn tab's keys: H L gt gT ]b [b tabs, ]B [B move, j k J K scroll, e p o y d ?, cmd keys go on", () => {
  const seq = (keys: any[]) => { let pending = ""; const acts: any[] = []; for (const k of keys) { const r = tabs.lookAction(pending, k); pending = r.pending; if (r.act) acts.push(r.act); } return acts; };
  expect(seq([keyc("H"), keyc("L")])).toEqual(["prev-tab", "next-tab"]);
  expect(seq([keyc("g"), keyc("t"), keyc("g"), keyc("T"), keyc("]"), keyc("b"), keyc("["), keyc("b")])).toEqual(["next-tab", "prev-tab", "next-tab", "prev-tab"]);
  expect(seq([keyc("]"), keyc("B"), keyc("["), keyc("B")])).toEqual(["move-tab-right", "move-tab-left"]);
  expect(seq([keyc("j"), keyc("K"), keyc("down"), keyc("up"), keyc("space")])).toEqual(["down", "up", "down", "up", "down"]);
  expect(seq([keyc("e"), keyc("p"), keyc("o"), keyc("y"), keyc("d"), keyc("?")])).toEqual(["text", "pane", "system", "copy", "close", "keys"]);
  // A German ? (shift-ß) comes as its character.
  expect(tabs.lookAction("", { key: "ß", key_char: "?", modifiers: { shift: true } }).act).toBe("keys");
  expect(tabs.lookAction("", keyc("w", { platform: true }))).toEqual({ act: null, taken: false, pending: "" });
  expect(tabs.lookAction("g", keyc("escape"))).toEqual({ act: null, taken: true, pending: "" });
  expect(tabs.lookAction("", keyc("z")).taken).toBe(false);
});

test("a picture opens as a drawn tab: nothing read as text, the viewer shows it, the viewer's bar instead of the editor's, its keys as hints", async () => {
  disk["/p/img/logo.png"] = "\u0000PNG";
  const p = await pane();
  p.openFile("/p/img/logo.png", cx());
  await flush();
  expect([p.path, p.look, p.kind, p.state]).toEqual(["/p/img/logo.png", true, "look", "unloaded"]);
  const view = p.render(cx());
  expect(p.viewer.C).toBe(Viewer);
  expect(p.viewer.props).toMatchObject({ embedded: true, path: "/p/img/logo.png" });
  expect(ids(view)).toEqual(expect.arrayContaining(["editor-tabs", "editor-look", "editor-hints"]));
  expect(ids(view)).not.toContain("editor-bar");
  expect(texts(byId(view, "editor-hints"))).toEqual(expect.arrayContaining(["H L", "tabs", "p", "preview pane", "y", "path", "d", "close"]));
  // Back to the text tab: the viewer lets go of the file; the editor's bar is back.
  p.select(p.docs[0], cx());
  expect(p.viewer.props.path).toBe(null);
  expect(ids(p.render(cx()))).toContain("editor-bar");
  // A file already open as a drawn tab shows it again.
  p.openFile("/p/img/logo.png", cx(), { view: "text" });
  expect([p.docs.length, p.look, p.viewer.props.path]).toEqual([2, true, "/p/img/logo.png"]);
});

test("a drawn tab's keys and hints: H / L tabs, j scrolls the viewer, p the preview pane, o the system's app, y the path, d closes; a click on a hint does the same", async () => {
  const p = await pane();
  p.openFile("/p/src/b.rs", cx());
  p.openFile("/p/img/logo.png", cx());
  await flush();
  p.render(cx());
  p.lookKey(keyc("H"), cx());
  expect(p.path).toBe("/p/src/b.rs");
  p.command("next-tab", cx());
  p.lookKey(keyc("j"), cx());
  expect(p.viewer.props.scroll).toMatchObject({ dir: 1 });
  p.lookKey(keyc("k"), cx());
  expect(p.viewer.props.scroll).toMatchObject({ dir: -1 });
  ran.length = 0;
  p.lookKey(keyc("p"), cx());
  p.lookKey(keyc("o"), cx());
  expect(ran).toEqual([["preview.open", { path: "/p/img/logo.png", pane: "p1" }], ["preview.open", { path: "/p/img/logo.png", in: "system" }]]);
  clip.length = 0;
  p.lookKey(keyc("y"), cx());
  expect(clip).toEqual(["/p/img/logo.png"]);
  // e on a picture: it says it's drawn only.
  p.lookKey(keyc("e"), cx());
  expect(p.message.text).toMatch(/drawn only/);
  // ? shows the drawn tab's keys.
  p.lookKey(keyc("?"), cx());
  expect(texts(p.keysStrip(theme))).toEqual(expect.arrayContaining(["as text (a table, patch or SVG)"]));
  p.toggleKeys(false);
  // The close hint, clicked: the tab goes.
  const hints = p.lookHints(theme);
  const close = all(hints).find((x) => x.calls?.id?.[0]?.[0]?.startsWith("editor-look-hint") && texts(x).includes("close"));
  click(close);
  expect(p.docs.map((d: any) => d.path)).toEqual(["/p/src/a.rs", "/p/src/b.rs"]);
});

test("a table opened to look at is drawn; e shows its text (read then), the bar's chip and cmd-shift-v draw it again; an edit request opens the text", async () => {
  disk["/p/data/rows.csv"] = "a,b\n1,2\n";
  const p = await pane();
  p.openFile("/p/data/rows.csv", cx(), { look: true });
  await flush();
  expect([p.look, p.kind, p.state]).toEqual([true, "either", "unloaded"]);
  p.render(cx());
  expect(texts(byId(p.render(cx()), "editor-hints"))).toEqual(expect.arrayContaining(["e", "text"]));
  p.lookKey(keyc("e"), cx());
  await flush();
  expect([p.look, p.state, p.editor.value()]).toEqual([false, "ready", "a,b\n1,2\n"]);
  expect(p.viewer.props.path).toBe(null);
  // The bar's "drawn" chip.
  click(byId(p.render(cx()), "bar-drawn"));
  expect([p.look, p.viewer.props.path]).toEqual([true, "/p/data/rows.csv"]);
  p.command("preview", cx());
  expect(p.look).toBe(false);
  p.command("preview", cx());
  expect(p.look).toBe(true);
  // The files pane's edit (view text) on the open tab: its text.
  p.openFile("/p/data/rows.csv", cx(), { view: "text" });
  expect(p.look).toBe(false);
  // A bare look leaves the open tab as it is.
  p.openFile("/p/data/rows.csv", cx(), { look: true });
  expect(p.look).toBe(false);
  // Edited as text from the start (an edit, the picker's grep hit): text.
  p.openFile("/p/data/other.csv", cx());
  expect(p.look).toBe(false);
});

test("Markdown opened to look at comes up in the editor's view for it (the pane's last pick, rendered too); an open Markdown tab keeps its view; an edit asks for the split", async () => {
  disk["/p/docs/m.md"] = "# M\n";
  storage.preview = "rendered"; // the pane's last pick
  const p = await pane();
  p.openFile("/p/docs/n.md", cx(), { look: true });
  await flush();
  expect([p.path, p.view, p.look, Boolean(p.cur.rendered)]).toEqual(["/p/docs/n.md", "rendered", false, true]);
  p.setView("split", cx());
  p.openFile("/p/docs/n.md", cx(), { look: true });
  expect(p.view).toBe("split");
  p.openFile("/p/docs/m.md", cx());
  expect(p.view).not.toBe("preview");
  p.openFile("/p/docs/m.md", cx(), { view: "split" });
  expect(p.view).toBe("split");
});

test("files sent as tabs with look (the open record) and an editor opened on one (props look, a terminal's link) start drawn", async () => {
  const p = await pane();
  sharedNow["editor.open"] = { slot: "s1", path: "/p/img/logo.png", look: true, n: 9, at: Date.now() };
  p.render(cx());
  tick();
  expect([p.path, p.look]).toEqual(["/p/img/logo.png", true]);
  sharedNow["editor.open"] = { slot: "s1", path: "/p/docs/n.md", look: true, n: 10, at: Date.now() };
  p.render(cx());
  tick();
  await flush();
  expect([p.path, p.view, p.look]).toEqual(["/p/docs/n.md", "split", false]);
  // A new editor on a table opened by a terminal's link: props { look: true }.
  disk["/p/data/rows.csv"] = "a,b\n";
  storage = {}; // a new pane keeps no tabs of its own yet
  const q = await pane("/p/data/rows.csv", { look: true });
  expect([q.path, q.look, q.state]).toEqual(["/p/data/rows.csv", true, "unloaded"]);
  // A new editor for a files pane's open with no editor in the tab: the record with slot null.
  sharedNow["editor.open"] = { slot: null, path: "/p/docs/n.md", look: true, n: 11, at: Date.now() };
  storage = {};
  const r = await pane("/p/docs/n.md");
  expect([r.view, r.look]).toEqual(["split", false]);
});

test("route: look rides along to the editor (the open record) and to editor.open when there's none; the picker looks at a picked file, edits a grep hit", () => {
  paneList = [ed("e1", "s1", "t1", "/a.rs")];
  route.openInEditor(herdr, { path: "/p/img/logo.png", look: true });
  expect(sharedNow["editor.open"]).toMatchObject({ slot: "s1", path: "/p/img/logo.png", look: true });
  paneList = [];
  route.openInEditor(herdr, { path: "/p/img/logo.png", pane: "f", look: true });
  expect(ran.at(-1)).toEqual(["editor.open", { path: "/p/img/logo.png", pane: "f", look: true }]);
  expect(sharedNow["editor.open"]).toMatchObject({ slot: null, path: "/p/img/logo.png", look: true });
  const pick = readFileSync(new URL("../defaults/mods/finder/main.ts", import.meta.url), "utf8");
  expect(pick).toMatch(/"match" in r \? \{ path, line: r\.match\.line, col: r\.match\.col \+ 1 \} : \{ path, look: true \}/);
});

test("a link to a picture in the Markdown preview opens as a drawn tab here; on another machine, the preview beside", async () => {
  const p = await pane("/p/docs/n.md");
  p.previewLink("../img/logo.png", cx());
  expect([p.path, p.look]).toEqual(["/p/img/logo.png", true]);
  p.on = "box";
  ran.length = 0;
  p.openLooked("/p/img/b.png", cx());
  expect(ran).toEqual([["preview.open", { path: "/p/img/b.png", pane: "p1", on: "box" }]]);
});

// ---- item 5: a tab popped out into a pane of its own (and back in), the tab's menu

const handOf = () => sharedNow["editor.handover"];
const splitOf = () => ran.find((r) => r[0] === "pane.split")?.[1];

test("pop out: a new editor pane beside (popped), the tab leaves the strip; the new pane gets its unsaved text, caret, view, wrap", async () => {
  const p = await pane();
  p.openFile("/p/docs/n.md", cx());
  await flush();
  p.editor.type("more");
  p.editor.set_cursor(1, 2);
  p.setView("text", cx());
  p.setWrap(false, cx());
  ran.length = 0;
  p.popOut(cx());
  const split = splitOf();
  expect(split).toMatchObject({ direction: "auto", pane: "p1", mod: "editor", props: { path: "/p/docs/n.md", popped: true } });
  expect(handOf()).toMatchObject({ slot: split.props.slot, path: "/p/docs/n.md", text: "# N\nmore", saved: "# N\n", caret: { line: 1, col: 2 }, view: "text", wrap: false });
  // Gone from this strip without a question; the pane stays (it has a.rs).
  expect([p.docs.map((d: any) => d.path), p.asking, ran.some((r) => r[0] === "pane.close")]).toEqual([["/p/src/a.rs"], null, false]);
  // The new pane: the same text, unsaved, the caret and view as they were.
  storage = {};
  const q = await pane("/p/docs/n.md", { slot: split.props.slot, popped: true });
  expect([q.editor.value(), q.dirty, q.editor.cursor(), q.view, q.softWrap]).toEqual(["# N\nmore", true, { line: 1, col: 2 }, "text", false]);
  expect(unsaved.at(-1)).toBe("n.md: unsaved changes");
  // Undo stays behind (it lives in the editor it was typed in): the new text editor starts with none.
  expect(q.editor.undos).toBe(0);
});

test("pop out: the last tab leaves nothing behind (the pane closes, the new one takes its place); into a new tab of the window; a drawn tab too", async () => {
  const p = await pane();
  ran.length = 0;
  p.popOut(cx());
  expect(ran.map((r) => r[0])).toEqual(["pane.split", "pane.close"]);
  expect(ran[1][1]).toMatchObject({ pane: "p1", confirmed: true });
  storage = {};
  const q = await pane();
  q.openFile("/p/img/logo.png", cx());
  ran.length = 0;
  q.popOut(cx(), q.cur, "tab");
  expect(ran[0]).toEqual(["tab.new", { mod: "editor", props: expect.objectContaining({ path: "/p/img/logo.png", popped: true }), name: "logo.png" }]);
  expect(handOf()).toMatchObject({ path: "/p/img/logo.png", look: true, text: null });
});

test("routing after a pop: the popped pane keeps its file (editor.open, the files pane find it there) and takes no other files", () => {
  const panes = [ed("e1", "s1", "t1", "/a.rs"), ed("e2", "s2", "t1", "/x.md", { popped: true })];
  const pick = (o: any) => route.editorFor({ panes, tab: "t1", ...o })?.pane ?? null;
  expect(pick({ path: "/x.md", paths: new Map([["s2", ["/x.md"]]]) })).toBe("e2");
  expect(pick({ path: "/y.rs", last: "s2", focused: "e2", prefer: "s2" })).toBe("e1");
  // Only a popped pane in the tab: a new editor (null), not the popped one.
  expect(route.editorFor({ panes: [panes[1]], tab: "t1", path: "/y.rs" })).toBe(null);
});

test("pop in: the shown tab moves into the editor beside as a tab (the open record and a handover for it); that editor gets its text", async () => {
  const p = await pane();
  p.openFile("/p/src/b.rs", cx());
  await flush();
  p.editor.type("// b");
  paneList.push({ pane: "p2", tab: "t1", mod: "editor", props: { slot: "s2", path: "/p/lib/b.rs" } });
  ran.length = 0;
  p.popIn(cx());
  expect(sharedNow["editor.open"]).toMatchObject({ slot: "s2", path: "/p/src/b.rs" });
  expect(handOf()).toMatchObject({ slot: "s2", path: "/p/src/b.rs", text: "fn b() {}\n// b" });
  expect(ran[0]).toEqual(["pane.focus", { pane: "p2" }]);
  expect(p.docs.map((d: any) => d.path)).toEqual(["/p/src/a.rs"]);
  // The editor beside takes it with its text.
  storage = {};
  const q = await pane("/p/lib/b.rs", { slot: "s2" });
  sharedNow["editor.open"] = { ...sharedNow["editor.open"], n: 99 };
  q.render(cx());
  tick();
  await flush();
  expect([q.path, q.editor.value(), q.dirty]).toEqual(["/p/src/b.rs", "fn b() {}\n// b", true]);
  // No editor beside: it says so.
  paneList = [paneList[0]];
  q.popIn(cx());
  expect(q.message.text).toBe("no other editor in this tab");
});

test("the tab's menu: a right-click on a tab, its entries, j / k / enter and letters, a click; close the others keeps unsaved ones", async () => {
  const p = await three();
  expect(tabs.tabMenuItems({ count: 3, index: 0, others: false }).map((x: any) => x.act)).toEqual(["pop-out", "pop-out-tab", "move-right", "close", "close-others"]);
  expect(tabs.tabMenuItems({ count: 1, index: 0, others: true }).map((x: any) => x.act)).toEqual(["pop-out", "pop-out-tab", "pop-in", "close"]);
  expect(tabs.tabMenuItems({ count: 1, index: 0, scratch: true }).map((x: any) => x.act)).toEqual(["close"]);
  const strip = p.tabStrip(theme);
  byId(strip, "editor-tab-2").calls.on_mouse_down.find((c: any[]) => c[0] === "right")[1]({}, cx());
  expect(p.tabMenu).toMatchObject({ index: 2, at: 0 });
  const view = p.render(cx());
  expect(texts(byId(view, "editor-tab-menu"))).toEqual(expect.arrayContaining(["Pop out into its own pane", "Move left", "Close the others"]));
  // k wraps to the last entry, enter runs it: close the others (n.md shown; a.rs edited stays).
  p.docs[0].dirty = true;
  p.tabMenuKeyDown(keyc("k"), cx());
  expect(p.tabMenu.items[p.tabMenu.at].act).toBe("close-others");
  p.tabMenuKeyDown(keyc("enter"), cx());
  expect([order(p), p.path, p.tabMenu]).toEqual([["a.rs", "n.md"], "/p/docs/n.md", null]);
  expect(p.message.text).toMatch(/1 kept: unsaved changes \(a\.rs\)/);
  // A letter runs its entry: h moves the tab left.
  p.openTabMenu(cx(), 1);
  p.tabMenuKeyDown(keyc("h"), cx());
  expect(order(p)).toEqual(["n.md", "a.rs"]);
  // Another tab shown (a file opened, a step) closes it.
  p.openTabMenu(cx(), 0);
  p.stepTab(1, cx());
  expect(p.tabMenu).toBe(null);
  // esc closes it; a click on an entry runs it.
  p.openTabMenu(cx(), 0);
  p.tabMenuKeyDown(keyc("escape"), cx());
  expect(p.tabMenu).toBe(null);
  p.openTabMenu(cx(), 0);
  ran.length = 0;
  click(byId(p.tabMenuView(theme), "editor-tab-menu-pop-out"));
  expect(splitOf()).toMatchObject({ props: { path: "/p/docs/n.md", popped: true } });
  expect(order(p)).toEqual(["a.rs"]);
});

test("a tab dragged off the strip and let go over the pane pops out; back on the strip it moves; off the pane nothing happens", async () => {
  const p = await three();
  let strip = p.tabStrip(theme);
  fire(byId(strip, "editor-tab-1"), "on_mouse_down", { position: { x: 200, y: 5 } }, cx());
  fire(byId(strip, "editor-tab-2"), "on_mouse_move", { position: { x: 300, y: 5 }, local_position: { x: 70, y: 5 }, bounds: { width: 100 } }, cx());
  fire(strip, "on_hover", false, cx());
  expect(p.tabDrag).toMatchObject({ from: 1, out: true });
  let view = p.render(cx());
  expect(texts(byId(view, "editor-drop-out")).join(" ")).toMatch(/let go: b\.rs into its own pane/);
  // Back on the strip: a move again (no drop zone).
  fire(byId(strip, "editor-tab-0"), "on_mouse_move", { position: { x: 20, y: 5 }, local_position: { x: 10, y: 5 }, bounds: { width: 100 } }, cx());
  expect(p.tabDrag.out).toBe(false);
  // Off again, then out of the pane: nothing.
  fire(strip, "on_hover", false, cx());
  view = p.render(cx());
  fire(view, "on_hover", false, cx());
  expect([p.tabDrag, order(p)]).toEqual([null, ["a.rs", "b.rs", "n.md"]]);
  // Off the strip and let go over the pane: popped out beside.
  strip = p.tabStrip(theme);
  fire(byId(strip, "editor-tab-1"), "on_mouse_down", { position: { x: 200, y: 5 } }, cx());
  fire(byId(strip, "editor-tab-2"), "on_mouse_move", { position: { x: 300, y: 5 }, local_position: { x: 70, y: 5 }, bounds: { width: 100 } }, cx());
  fire(strip, "on_hover", false, cx());
  ran.length = 0;
  view = p.render(cx());
  view.calls.on_mouse_up.find((c: any[]) => c[0] === "left")[1]({}, cx());
  expect(splitOf()).toMatchObject({ props: { path: "/p/src/b.rs", popped: true } });
  expect(order(p)).toEqual(["a.rs", "n.md"]);
});

test("keys: space b o / b i / b m, :popout / :popin; the commands pop-out, pop-out-tab, pop-in, tab-menu", async () => {
  const run = (keys: string[]) => { const v = createVim(); const out: string[] = []; for (const k of keys) out.push(...(feed(v, k, { text: "a\n", cursor: { line: 0, col: 0 }, clipboard: null, page: 10 }).commands ?? [])); return out; };
  expect(run([" ", "b", "o"])).toEqual(["pop-out"]);
  expect(run([" ", "b", "i"])).toEqual(["pop-in"]);
  expect(run([" ", "b", "m"])).toEqual(["tab-menu"]);
  expect(run([":", ..."popout".split(""), "<cr>"])).toEqual(["pop-out"]);
  expect(run([":", ..."popin".split(""), "<cr>"])).toEqual(["pop-in"]);
  const p = await three();
  p.vimCommand("tab-menu", cx());
  expect(p.tabMenu).toMatchObject({ index: 1 });
  p.closeTabMenu(cx());
  ran.length = 0;
  p.command("pop-out-tab", cx());
  expect(ran[0][0]).toBe("tab.new");
  p.command("pop-out", cx());
  expect(splitOf()).toBeTruthy();
  expect(p.docs.length).toBe(1);
});

// ---- the file type marks on the tabs (file-icons.ts)

const markOf = (root: any, id: string) => { const box = byId(root, id); return { src: box?.kids[0]?.src, color: box?.kids[0]?.calls.text_color?.[0]?.[0], opacity: box?.calls.opacity?.[0]?.[0] }; };
const hues: any = new Proxy({}, { get: (_t, k) => String(k) }); // each theme colour by its name

test("file marks: one per kind of file, its svg a crisp one-colour mark beside the editor, tinted by the theme", () => {
  const want: Record<string, string> = {
    "/p/a.md": "markdown", "/p/README.markdown": "markdown", "/p/src/a.rs": "code", "/p/x.tsx": "code", "/p/Makefile": "code", "/p/fix.diff": "code",
    "/p/package.json": "config", "/p/c.yaml": "config", "/p/Cargo.toml": "config", "/p/.gitignore": "config", "/p/.env.local": "config",
    "/p/a.PNG": "image", "/p/i.svg": "image", "/p/d.pdf": "pdf", "/p/t.csv": "table", "/p/q.sqlite": "table", "/p/v.mov": "media", "/p/s.mp3": "media",
    "/p/notes.txt": "text", "/p/LICENSE": "text", "/p/f.woff2": "file", "/p/blob.bin": "file",
  };
  for (const [path, icon] of Object.entries(want)) expect([path, icons.fileIcon(path)]).toEqual([path, icon]);
  const colors = icons.FILE_ICONS.map((i: any) => icons.iconColor(i, hues));
  expect(colors).toEqual(["dim", "dim", "ansi4", "ansi6", "ansi3", "ansi5", "ansi1", "ansi2", "ansi5"]);
  for (const i of icons.FILE_ICONS) {
    expect(icons.iconSvg(i, "editor")).toBe(`mods/editor/icons/${i}.svg`);
    const svg = readFileSync(new URL(`../defaults/${icons.iconSvg(i, "editor")}`, import.meta.url), "utf8");
    expect(svg).toContain('viewBox="0 0 16 16"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).not.toMatch(/fill="#|stroke=/); // one colour: the tint
  }
});

test("file marks on the strip: before each name, after the unsaved mark, dimmed on a tab not shown; the widths fit them at zoom 0.9", async () => {
  zoomNow = 0.9;
  const p = await pane();
  p.openFile("/p/docs/n.md", cx());
  await flush();
  p.size = { width: 400, height: 600 };
  const strip = p.tabStrip(theme);
  const tab0 = byId(strip, "editor-tab-0");
  const ids = tab0.kids.map((k: any) => k.calls?.id?.[0]?.[0] ?? (typeof k === "string" ? k : null));
  // The unsaved mark, the type mark, the name, the close box: in that order.
  expect(ids.indexOf("editor-tab-mark-0")).toBeLessThan(ids.indexOf("editor-tab-icon-0"));
  expect(ids.indexOf("editor-tab-icon-0")).toBeLessThan(ids.indexOf("editor-tab-close-0"));
  expect(texts(tab0.kids[ids.indexOf("editor-tab-icon-0") + 1])).toEqual(["a.rs"]);
  expect(texts(byId(strip, "editor-tab-close-1"))).toEqual(["×"]);
  expect(markOf(strip, "editor-tab-icon-0")).toEqual({ src: "mods/editor/icons/code.svg", color: "#808080", opacity: 0.5 });
  expect(markOf(strip, "editor-tab-icon-1")).toEqual({ src: "mods/editor/icons/markdown.svg", color: "#808080", opacity: 1 });
  // A tab's width has the mark and its gap (12 + 6 px): "a.rs" is 98 px unzoomed.
  expect(tabs.tabWidth({ name: "a.rs", hint: null })).toBe(Math.round(20 + 8 + 6 + 12 + 6 + 4 * tabs.CHAR_W + 6 + 14));
  // At zoom 0.9 in 400 px: the room is 400 / 0.9 - 8; the tabs that fit, with their marks, stay within it.
  const room = 400 / 0.9 - 8;
  const names = ["/p/src/a.rs", "/p/docs/n.md", "/p/src/b.rs", "/p/lib/b.rs", "/p/src/a.rs.bak", "/p/q.csv"];
  for (const n of names.slice(2)) { disk[n] ??= "x\n"; p.openFile(n, cx()); await flush(); }
  const labels = tabs.tabLabels(p.docs.map((d: any) => d.path));
  const widths = labels.map((l: any) => tabs.tabWidth(l));
  const fit = tabs.visibleTabs(widths, p.docs.indexOf(p.cur), room);
  const drawn = widths.slice(fit.from, fit.to).reduce((a: number, b: number) => a + b, 0) + (fit.before ? tabs.MORE : 0) + (fit.after ? tabs.MORE : 0);
  expect(drawn).toBeLessThanOrEqual(room);
  expect(fit.to - fit.from).toBeLessThan(names.length); // the marks' room shows: not all six fit
  const wide = p.tabStrip(theme);
  for (let i = fit.from; i < fit.to; i++) expect(byId(wide, `editor-tab-icon-${i}`)).toBeTruthy();
  expect(byId(wide, `editor-tab-icon-${fit.to}`)).toBeFalsy();
});

test("file marks: one tab (no strip): the bar's name has its mark; a scratchpad's tab has the scratchpad's own", async () => {
  const p = await pane("/p/docs/n.md");
  const bar = p.bar(theme);
  expect(markOf(bar, "bar-icon")).toEqual({ src: "mods/editor/icons/markdown.svg", color: "#808080", opacity: 1 });
  const ids = bar.kids.map((k: any) => k.calls?.id?.[0]?.[0]);
  expect(ids.indexOf("bar-icon") + 1).toBe(ids.indexOf("bar-name"));
  disk["/tmp/app/scratchpad/p-12345678.md"] = "";
  p.openFile("/tmp/app/scratchpad/p-12345678.md", cx());
  await flush();
  expect(markOf(p.tabStrip(theme), "editor-tab-icon-1").src).toBe("mods/nocturne/art/scratchpad.svg");
});

test("file marks are shared: file-tree's and preview's file-icons.ts and icons/*.svg are editor's, byte for byte", () => {
  const read = (mod: string, file: string) => readFileSync(new URL(`../defaults/mods/${mod}/${file}`, import.meta.url), "utf8");
  for (const mod of ["file-tree", "preview"]) {
    for (const file of ["file-icons.ts", ...icons.FILE_ICONS.map((i: string) => `icons/${i}.svg`)]) expect([mod, file, read(mod, file) === read("editor", file)]).toEqual([mod, file, true]);
  }
  // It imports only kinds.ts, itself a shared copy in both.
  expect([...read("editor", "file-icons.ts").matchAll(/from "\.\/([^"]+)"/g)].map((m) => m[1])).toEqual(["kinds.ts", "kinds.ts"]);
});
