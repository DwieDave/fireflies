// The editor's word wrap toggle (editor/main.js setWrap): a new
// editor wraps as its language's soft_wrap says; cmd-k z (the command
// editor.wrap), vim's space u w, :set wrap / nowrap / wrap! and the
// bar's "wrap" chip switch this editor only, nothing written to settings. A
// whole pane is built through init with herdr and gpui stand-ins (mock.module
// is process-wide: this file runs alone).
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
const all = (e: any): any[] => (e?.kids ? [e, ...e.kids.flatMap(all)] : []);
const byId = (root: any, id: string) => all(root).find((x) => x.calls?.id?.[0]?.[0] === id);
const theme: any = new Proxy({}, { get: () => "#808080" });

let settingsNow: any = { zoom: 0.9, editor: {} };
let pathNow = "/p/src/a.rs";
const written: any[] = [];
const herdr: Record<string, any> = {
  settings: () => settingsNow, window: () => ({ platform: "macos" }), appHome: () => "/tmp/app", home: () => "/home/a",
  props: () => ({ path: pathNow, slot: "s1" }), theme: () => theme, run: () => null,
  keys: () => [], panes: () => [], shared: () => null, setShared: (k: string, v: any) => { written.push([k, v]); },
  readTextFile: async () => "fn main() {}\n", writeTextFile: async () => null, watchFolder: () => new Promise(() => {}),
  nextCommand: () => new Promise(() => {}),
  exec: () => new Promise(() => {}), languageOf: (p: string) => (/\.rs$/.test(p) ? "rust" : /\.md$/.test(p) ? "markdown" : null),
  highlight: () => [], lspStart: () => new Promise(() => {}), lspNotify: () => null,
  lspRequest: () => Promise.resolve(null), lspNextMessage: () => new Promise(() => {}), lspRelease: () => null, setUnsaved: () => null, notify: () => {},
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: () => new El(), image: () => new El(), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} set_selected_range() {} }
/** gpui-base's EditorState: what it was made with and each set_soft_wrap. */
class Ed {
  v = ""; caret = { line: 0, col: 0 }; handlers: Record<string, any> = {}; wraps: boolean[] = [];
  constructor(public opts: any) {}
  focused() { return true; }
  on(name: string, fn: any) { this.handlers[name] = fn; return true; }
  value() { return this.v; } set_value(v: string) { this.v = v; }
  cursor() { return { ...this.caret }; } set_cursor(line: number, col: number) { this.caret = { line, col }; }
  set_soft_wrap(w: boolean) { this.wraps.push(w); }
  focus() {} set_tab_size() {} set_cursor_shape() {} set_diagnostics() {} set_line_notes() {} find_close() {} top_line() { return 0; }
  selection() { return { start: this.caret, end: this.caret, text: "" }; } edit() {} set_selections() {} set_language() {}
}
let ed: Ed;
mock.module("gpui-base", () => ({
  h_flex: () => new El(), v_flex: () => new El(), InputState: { new: () => new Input() }, Input: { new: () => new El() },
  TextView: { html: () => new El(), markdown: (_id: string, md: string) => md }, EditorState: { new: (o: any) => (ed = new Ed(o)) }, Editor: { new: () => new El() },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
}));
(globalThis as any).window = { paint_path: () => new El() };
const storage: Record<string, string> = {};
(globalThis as any).localStorage = { getItem: (k: string) => storage[k] ?? null, setItem: (k: string, v: string) => { storage[k] = String(v); } };

const { default: EditorPane } = await import("../defaults/mods/editor/main.js");
const { editorKeys } = await import("../defaults/mods/editor/logic.ts");
const { LEADER, createVim, feed } = await import("../defaults/mods/editor/vim.ts");

function cx(): any {
  return {
    stop_propagation() {}, notify() {}, timer: { after() {}, every() {} },
    spawn: (fn: any) => { fn(cx()); }, focus_handle: () => ({ focus() {}, is_focused: () => true }),
    read_from_clipboard: () => null, write_to_clipboard() {},
  };
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

async function pane(vim = true): Promise<any> {
  // A new pane keeps no tabs yet (each pane's localStorage is its own; the editor keeps its tabs there).
  delete storage.tabs;
  const p: any = new EditorPane();
  p.init({}, cx());
  await flush();
  p.paneVim = vim;
  p.vimSettled(vim);
  p.size = { width: 900, height: 700 };
  return p;
}
const wrapChip = (p: any) => byId(p.bar(theme), "bar-wrap");

beforeEach(() => { settingsNow = { zoom: 0.9, editor: {} }; pathNow = "/p/src/a.rs"; written.length = 0; for (const k of Object.keys(storage)) delete storage[k]; });

test("a new editor wraps as its language says: rust not, Markdown yes, settings.json over both", async () => {
  expect([(await pane()).softWrap, ed.opts.soft_wrap]).toEqual([false, false]);
  pathNow = "/p/README.md";
  expect([(await pane()).softWrap, ed.opts.soft_wrap]).toEqual([true, true]);
  pathNow = "/p/src/a.rs";
  settingsNow = { zoom: 0.9, editor: { languages: { rust: { soft_wrap: true } } } };
  expect([(await pane()).softWrap, ed.opts.soft_wrap]).toEqual([true, true]);
});

test("cmd-k z (the wrap command) switches the shown tab's wrap and says so; nothing is written to settings", async () => {
  const p = await pane(false);
  written.length = 0;
  const kept = JSON.stringify(storage);
  p.command("wrap", cx());
  expect([p.softWrap, ed.wraps, p.message?.text]).toEqual([true, [true], "word wrap on"]);
  p.command("wrap", cx());
  expect([p.softWrap, ed.wraps, p.message?.text]).toEqual([false, [true, false], "word wrap off"]);
  expect([written, JSON.stringify(storage)]).toEqual([[], kept]);
  // Its own field, beside the options it started from: those stay as settings gave them.
  expect(p.opts.soft_wrap).toBe(false);
});

test("vim: space u w and :set wrap / nowrap / wrap! / invwrap", async () => {
  const p = await pane(true);
  p.vimCommand("wrap", cx());
  expect(p.softWrap).toBe(true);
  p.vimCommand("set:nowrap", cx());
  p.vimCommand("set:nowrap", cx());
  expect(p.softWrap).toBe(false);
  p.vimCommand("set:wrap", cx());
  expect(p.softWrap).toBe(true);
  p.vimCommand("set:wrap!", cx());
  p.vimCommand("set:invwrap", cx());
  expect([p.softWrap, ed.wraps]).toEqual([true, [true, false, false, true, false, true]]);
  p.vimCommand("set:number", cx());
  expect(p.message?.text).toContain("only :set wrap");
});

test("space u w in vim's leader map asks for wrap; the which-key popup names it", () => {
  expect(LEADER.keys.get("u")).toEqual({ name: "toggle", keys: new Map([["w", ["wrap", "word wrap"]]]) });
  const vim = createVim();
  const doc = { text: "a", cursor: { line: 0, col: 0 } };
  expect((feed(vim, " ", doc) as any).which.map((w: any) => w.label)).toContain("+toggle");
  expect((feed(vim, "u", doc) as any).which).toEqual([{ key: "w", label: "word wrap" }]);
  expect((feed(vim, "w", doc) as any).commands).toEqual(["wrap"]);
  // space w still saves.
  feed(vim, " ", doc);
  expect((feed(vim, "w", doc) as any).commands).toEqual(["save"]);
});

test("the bar's wrap chip shows the state and switches it; a narrow bar shows it only while on", async () => {
  const p = await pane(false);
  let chip = wrapChip(p);
  expect(chip.kids).toEqual(["wrap"]);
  expect(chip.calls.text_color[0][0]).toBe(theme.dim);
  chip.calls.on_click[0][0]({}, cx());
  expect(p.softWrap).toBe(true);
  p.size = { width: 400, height: 700 };
  expect(wrapChip(p)).toBeDefined();
  p.setWrap(false, cx());
  expect(wrapChip(p)).toBeUndefined();
});

test("the keys lists name the toggle with and without vim", () => {
  expect(editorKeys(false)).toContainEqual(["cmd-k z", "word wrap on / off"]);
  expect(editorKeys(true)).toContainEqual(["space u w", "word wrap"]);
  expect(editorKeys(false).at(-1)).toEqual(["cmd-k ?", "keys"]);
  expect(editorKeys(true).at(-1)).toEqual(["space ?", "keys"]);
});
