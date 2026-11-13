// Which folder the picker searches (nocturne/picker.js and nocturne/folders.js
// pick the candidates, finder/main.ts the first one that's there),
// with herdr and gpui stand-ins: a space's folder that was moved or deleted,
// or a finished shell's, never reaches findFiles / grep; when no folder is
// there the picker names the missing one and how to point the space elsewhere.
// Its own process: mock.module is process-wide.
import { test, expect, mock, beforeEach } from "bun:test";

const el: any = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined : k === "when" ? (c: any, f: Function) => (c ? f(el) : el) : () => el),
  apply: () => el,
});

let space: any, all: any[], focus: any;
const there = new Set<string>(); // the folders on disk
const searched: string[] = [];
let props: any = {};
const opened: any[] = [];
mock.module("herdr", () => ({
  props: () => props, theme: () => new Proxy({}, { get: () => "#808080" }),
  settings: () => ({}), closeOverlay: () => null, shared: () => null, setShared: () => null, run: () => null,
  nextCommand: () => new Promise(() => {}), keys: () => [],
  exec: async (cmd: string, args: string[]) =>
    cmd === "test" ? { code: there.has(args[1]) ? 0 : 1, stdout: "", stderr: "" } : { code: 128, stdout: "", stderr: "not a git repository" },
  findFiles: async (root: string) => { if (!there.has(root)) throw new Error(`${root} is not a folder`); searched.push(root); return { files: [], total: 0 }; },
  grep: async (root: string) => { if (!there.has(root)) throw new Error(`${root} is not a folder`); searched.push(root); return { matches: [], files: 0 }; },
  readTextFile: async () => "", highlight: () => [], languageOf: () => null,
  home: () => "/Users/me", window: () => ({ platform: "macos" }),
  spaces: () => [space], panes: () => all, focused: () => focus,
  openOverlay: (spec: any) => { opened.push(spec); return `o${opened.length}`; },
}));
mock.module("gpui-kit", () => ({ div: () => el, View: class {}, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
const box = { v: "", on() { return true; }, value() { return this.v; }, focus() {}, release() { return true; } };
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, Input: { new: () => el }, Scrollbar: { vertical: () => el }, v_virtual_list: () => el,
  VirtualListScrollHandle: { new: () => ({ scroll_to_item() {} }) },
  InputState: { new: (o: any) => { box.v = o?.value ?? ""; return box; } },
}));
globalThis.window = { paint_path: () => el } as any;

const cx: any = { spawn: (f: Function) => { Promise.resolve(f(cx)); }, notify() {}, stop_propagation() {}, bind_keys: () => 0, timer: { after() {}, every() {} } };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

const { default: Picker } = await import("../defaults/mods/finder/main.ts");
const { togglePicker, pickerFolder } = await import("../defaults/mods/nocturne/picker.ts");
const { folderCandidates, modFolder } = await import("../defaults/mods/nocturne/folders.ts");

const TAB = { id: "tb1", active: true }, WEB = { id: "tb2", active: false };
beforeEach(() => {
  there.clear(); searched.length = 0; opened.length = 0;
  space = { id: "sp1", active: true, attached: false, folder: "/Users/me/old/proj", machine: null, tabs: [TAB, WEB] };
  all = [{ pane: "p1", tab: "tb1", terminal: "t1", cwd: "/Users/me/src/proj" }];
  focus = { space: "sp1", tab: "tb1", pane: "p1", terminal: "t1", cwd: "/Users/me/src/proj" };
});

async function open(mode: "files" | "grep" = "files") {
  togglePicker(mode);
  props = { ...opened.at(-1).props, overlay: `o${opened.length}` };
  const p: any = new Picker();
  p.init({}, cx);
  await settle();
  return p;
}

test("a space folder that's gone isn't searched: the pane's live folder is", async () => {
  there.add("/Users/me/src/proj");
  const p = await open();
  expect(p.root).toBe("/Users/me/src/proj");
  expect(searched).toEqual(["/Users/me/src/proj"]);
  expect(p.note).toBe(null);
});

test("from a mod pane (the editor) a gone space folder is passed over for the file's folder", async () => {
  there.add("/Users/me/src/proj/src");
  all = [{ pane: "p1", tab: "tb1", terminal: null, mod: "editor", props: { path: "/Users/me/src/proj/src/main.rs" } }];
  focus = { space: "sp1", tab: "tb1", pane: "p1", terminal: null, cwd: null };
  const p = await open("grep");
  box.v = "needle"; p.query(cx); await settle();
  expect(p.root).toBe("/Users/me/src/proj/src");
  expect(searched.at(-1)).toBe("/Users/me/src/proj/src");
});

test("from the web pane the space's terminal's live folder is searched, not the space's gone one", async () => {
  there.add("/Users/me/src/proj");
  all = [{ pane: "p1", tab: "tb1", terminal: "t1", cwd: "/Users/me/src/proj" }, { pane: "p2", tab: "tb2", terminal: null, mod: "browser", props: { slot: "x" } }];
  space.tabs = [{ id: "tb1", active: false }, { id: "tb2", active: true }];
  focus = { space: "sp1", tab: "tb2", pane: "p2", terminal: null, cwd: null };
  expect(pickerFolder().folders).toEqual(["/Users/me/src/proj", "/Users/me/old/proj"]);
  const p = await open();
  expect(searched).toEqual(["/Users/me/src/proj"]);
});

test("a pane folder that's gone (a finished shell's launch folder) gives way to the space's", async () => {
  there.add("/Users/me/old/proj");
  focus.cwd = all[0].cwd = "/Users/me/moved/away";
  const p = await open();
  expect(p.root).toBe("/Users/me/old/proj");
  expect(searched).toEqual(["/Users/me/old/proj"]);
});

test("no folder there: nothing is searched, the note names the space's folder and how to change it", async () => {
  all[0].cwd = focus.cwd = "/Users/me/moved/away";
  const p = await open();
  expect(searched).toEqual([]);
  expect(p.root).toBe(null);
  expect(p.note).toContain("~/old/proj isn't there any more");
  expect(p.note).toContain("f on the space in the sidebar");
  expect(p.note).not.toContain("is not a folder");
});

test("an attached space folder still comes first when it's there", () => {
  space.attached = true;
  expect(pickerFolder().folder).toBe("/Users/me/old/proj");
  expect(folderCandidates(space, all[0], focus, all, { attached: false })[0]).toBe("/Users/me/src/proj");
});

test("a mod pane's folder: the files pane's folder, the editor's file's folder", () => {
  expect(modFolder({ mod: "file-tree", props: { folder: "/a/b" } })).toBe("/a/b");
  expect(modFolder({ mod: "editor", props: { path: "/a/b/c.rs" } })).toBe("/a/b");
  expect(modFolder({ mod: "editor", props: { path: "c.rs" } })).toBe(null);
  expect(modFolder({ terminal: "t1", cwd: "/x" })).toBe(null);
});

test("an old picker's props (folder only) still search that folder", async () => {
  there.add("/tmp/proj");
  props = { mode: "files", folder: "/tmp/proj", on: null, overlay: "o9" };
  const p: any = new Picker();
  p.init({}, cx);
  await settle();
  expect(searched).toEqual(["/tmp/proj"]);
});
