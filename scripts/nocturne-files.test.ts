import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";

// nocturne-files with stand-ins for the app's modules (as nocturne-preview.test.ts):
// they record the commands it runs and what it shares.
class Element {
  calls: [string, any[]][] = [];
  nodes: any[] = [];
  constructor(public kind = "div", public arg?: any) {
    return new Proxy(this, {
      get: (target, key: string, proxy) => key in target ? (target as any)[key] : (...args: any[]) => {
        if (key === "child") target.nodes.push(args[0]);
        else if (key === "children") target.nodes.push(...args[0]);
        else if (key === "when") { if (args[0]) args[1](proxy); }
        else target.calls.push([key, args]);
        return proxy;
      },
    });
  }
}
const walk = (el: any): any[] => (el && typeof el === "object" && "nodes" in el ? [el, ...el.nodes.flatMap(walk)] : []);
const commands: [string, any][] = [];
const noExec = async (..._a: any[]) => ({ code: 1, stdout: "", stderr: "" });
const world: { props: any; panes: any[]; spaces: any[]; shared: Record<string, any>; settings: any; focused: any; find: (root: string, q: string) => Promise<any>; exec: (cmd: string, args: string[], o?: any) => Promise<any> } = {
  props: {}, panes: [], spaces: [], shared: {}, settings: { zoom: 1 }, focused: null, find: async () => ({ files: [], scanning: false }), exec: noExec,
};
const herdr = {
  props: () => world.props, theme: () => ({ background: "#080808", foreground: "#c6c6c6", ansi0: "#323437", ansi3: "#e3c78a", ansi4: "#80a0ff", ansi8: "#949494", accent: "#80a0ff", muted: "#949494", dim: "#5F6D6D" }),
  settings: () => world.settings, exec: (cmd: string, args: string[], o?: any) => world.exec(cmd, args, o),
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  panes: () => world.panes, spaces: () => world.spaces, terminals: () => [] as any[], focused: () => world.focused,
  shared: (k: string) => world.shared[k] ?? null, setShared: (k: string, v: any) => { world.shared[k] = v; return null; },
  findFiles: (root: string, q: string) => world.find(root, q),
  watchFolder: () => new Promise(() => {}), nextCommand: () => new Promise(() => {}),
  home: () => "/home/me", appHome: () => "/home/me/.config/herdr-app", appWindow: () => ({ platform: "linux" }),
};
const kit = {
  View: class {}, div: () => new Element(), svg: (p: string) => new Element("svg", p),
  PathBuilder: { fill: () => new Element() }, Background: { checkerboard: () => ({}) },
};
const input = () => {
  let v = ""; const on: Record<string, any> = {};
  const state: any = { selected: null, on: (e: string, f: any) => { on[e] = f; }, value: () => v, set_value: (x: string) => { v = x; state.selected = null; }, set_selected_range: (r: any) => { state.selected = r; }, focus() {}, fire: (e: string) => on[e]?.({}, cx) };
  return state;
};
const base = {
  h_flex: () => new Element(), v_flex: () => new Element(), v_virtual_list: () => new Element(), Scrollbar: { vertical: () => new Element() },
  VirtualListScrollHandle: { new: () => ({ scroll_to_item() {} }) }, InputState: { new: input }, Input: { new: () => new Element("input") },
};

async function load(path: string, extra: Record<string, unknown> = {}): Promise<any> {
  const source = await readFile(new URL(`../defaults/mods/${path}`, import.meta.url), "utf8");
  const names: string[] = [];
  const body = source
    .replace(/^import .*;\n/gm, "")
    .replace(/^export default class (\w+)/m, (_m, n) => { names.push(`default: ${n}`); return `class ${n}`; })
    .replace(/^export (async function|function|const|class) (\w+)/gm, (_m, kind, n) => { names.push(n); return `${kind} ${n}`; });
  const scope: Record<string, unknown> = { ...kit, ...base, ...herdr, ...extra, window: { paint_path: () => new Element() } };
  return new Function(...Object.keys(scope), `${body}\nreturn { ${names.join(", ")} };`)(...Object.values(scope));
}

const logic = await load("nocturne-files/logic.js");
const keyhelp = await load("nocturne-files/keyhelp.js");
const { default: Files } = await load("nocturne-files/main.js", { ...logic, ...keyhelp });
const { keyColumn, filterDefaults, parseIgnored, isIgnored, isHidden, lists, fuzzy, grouped, nvimLaunch, menuItems, marks } = logic;

const later: ((cx: any) => void)[] = [];
const cx: any = {
  notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {}, is_focused: () => true }),
  spawn: (f: (cx: any) => Promise<void>) => { const p = f(cx); pending.push(p); return p; },
  timer: { every() {}, after: (_ms: number, f: any) => later.push(f) },
  write_to_clipboard: (s: string) => { clipboard.push(s); },
};
const pending: Promise<void>[] = [];
const clipboard: string[] = [];
const settle = async () => { while (pending.length) await pending.shift(); };

/** A pane on /repo with its folders listed (no exec): `entries` by folder. */
function pane(p: any = {}, entries: Record<string, [string, boolean][]> = {}) {
  const view: any = Object.create(Files.prototype);
  view.loadFolder = async () => {};
  view.refresh = () => {};
  world.props = p;
  view.init.call(view, p, cx);
  pending.length = 0; // its command loop never ends
  for (const [k, list] of Object.entries(entries)) view.entries.set(k, list.map(([name, dir]) => ({ name, dir })));
  return view;
}

const TREE: Record<string, [string, boolean][]> = {
  "": [["src", true], ["target", true], [".github", true], [".env", false], ["README.md", false]],
  src: [["main.rs", false], ["app.log", false]],
};

// ---- logic

test("new panes list everything unless settings.json files says otherwise", () => {
  expect(filterDefaults({})).toEqual({ hidden: true, ignored: true });
  expect(filterDefaults({ files: { hidden: false } })).toEqual({ hidden: false, ignored: true });
  expect(filterDefaults({ files: { ignored: false, hidden: true } })).toEqual({ hidden: true, ignored: false });
});

test("git's ignored list covers what is in an ignored folder; dotfiles by any part", () => {
  const ig = parseIgnored("target/\0src/app.log\0");
  expect([...ig]).toEqual(["target", "src/app.log"]);
  expect([isIgnored("target", ig), isIgnored("target/debug/x", ig), isIgnored("src/app.log", ig), isIgnored("src/main.rs", ig), isIgnored("targets", ig)]).toEqual([true, true, true, false, false]);
  expect([isHidden(".env"), isHidden("a/.git/x"), isHidden("a/b.c")]).toEqual([true, true, false]);
  expect(lists(".env", { hidden: false, ignored: true }, ig)).toBe(false);
  expect(lists("target/x", { hidden: true, ignored: false }, ig)).toBe(false);
  expect(lists("src/main.rs", { hidden: false, ignored: false }, ig)).toBe(true);
});

test("the fallback search matches in order, preferring the name", () => {
  expect(fuzzy("mr", "src/main.rs")).toEqual([[4, 5], [9, 10]]);
  expect(fuzzy("srcm", "src/main.rs")).toEqual([[0, 3], [4, 5]]);
  expect(fuzzy("xyz", "src/main.rs")).toBeNull();
  expect(fuzzy("", "a")).toEqual([]);
});

test("hits sit under their folders, each folder once where its best hit ranks", () => {
  const rows = grouped([
    { path: "src/main.rs", ranges: [[4, 8]], git: "M" },
    { path: "README.md", ranges: [[0, 1]] },
    { path: "docs/main.md", ranges: [[5, 9]] },
    { path: "src/mainly.rs", ranges: [[0, 3], [4, 8]] },
  ]);
  expect(rows.map((r: any) => [r.path, r.head ?? false, r.depth])).toEqual([
    ["src", true, 0], ["src/main.rs", false, 1], ["src/mainly.rs", false, 1], ["README.md", false, 0], ["docs", true, 0], ["docs/main.md", false, 1],
  ]);
  expect(rows[1]).toMatchObject({ name: "main.rs", ranges: [[0, 4]], git: "M", hit: true });
  expect(rows[2].ranges).toEqual([[0, 4]]);
  expect(marks("main.rs", [[0, 4]])).toEqual([["main", true], [".rs", false]]);
});

test("Neovim opens a file in its folder, a folder as nvim . there", () => {
  expect(nvimLaunch("/repo/src/main.rs", false)).toEqual({ argv: ["nvim", "/repo/src/main.rs"], folder: "/repo/src" });
  expect(nvimLaunch("/repo/src", true)).toEqual({ argv: ["nvim", "."], folder: "/repo/src" });
});

test("the menu offers Neovim for files and folders, a new pane for folders, close in a pane of its own", () => {
  const acts = (row: any, o?: any) => menuItems(row, o).map((x: any) => x.act);
  expect(acts({ path: "a.rs", dir: false })).toEqual(["open", "other", "terminal", "nvim", "new-file", "new-folder", "rename", "cut", "delete", "copy"]);
  expect(acts({ path: "src", dir: true }, { pane: true })).toEqual(["toggle", "pane", "root", "edit", "nvim", "new-file", "new-folder", "rename", "cut", "delete", "copy", "close"]);
  expect(menuItems({ dir: false }).find((x: any) => x.act === "nvim").label).toBe("Open in Neovim");
});

test("the menu's key column fits its widest key", () => {
  expect(keyColumn(menuItems({ dir: false }))).toBe("enter".length * 7 + 14);
  expect(keyColumn([{ key: "v" }])).toBe(30);
  // Drawn at that width, every row's key cell the same.
  world.panes = [{ pane: "pf", tab: "t1", mod: "nocturne-files", props: { path: "/repo", slot: "s1" } }];
  const view = pane({ path: "/repo", slot: "s1" }, TREE);
  view.openMenu({ path: "README.md", name: "README.md", dir: false }, cx);
  const cells = walk(view.render()).filter((e: any) => e.nodes.length === 1 && ["enter", "e", "E", "v", "a", "A", "R", "x", "d", "y", "q"].includes(e.nodes[0]));
  expect(cells.length).toBe(11);
  for (const c of cells) expect(c.calls.find(([k]: [string]) => k === "w")?.[1]).toEqual([49]);
});

// ---- the pane

test("filters hide dotfiles and ignored files, count them, and are kept per pane", () => {
  world.panes = [{ pane: "pf", tab: "t1", mod: "nocturne-files", props: { path: "/repo", slot: "s1" } }];
  world.shared = {};
  world.settings = { zoom: 1, files: { hidden: false } };
  const view = pane({ path: "/repo", slot: "s1" }, TREE);
  view.ignored = parseIgnored("target/\0src/app.log\0");
  view.folders.add("src");
  expect(view.alone).toBe(true);
  expect(view.rows().map((r: any) => r.path)).toEqual(["src", "src/main.rs", "src/app.log", "target", "README.md"]);
  expect(view.cut).toEqual({ hidden: 2, ignored: 0 });
  expect(view.rows().find((r: any) => r.path === "target").ignored).toBe(true);
  view.key({ key: "i", modifiers: { shift: true } }, cx);
  expect(view.rows().map((r: any) => r.path)).toEqual(["src", "src/main.rs", "README.md"]);
  expect(view.cut).toEqual({ hidden: 2, ignored: 2 });
  view.key({ key: "H" }, cx);
  expect(view.rows().map((r: any) => r.path)).toContain(".env");
  expect(world.shared["nocturne-files.filters"]).toEqual({ s1: { hidden: true, ignored: false } });
  // A pane opened again with that slot takes its own choice, not the settings'.
  expect(pane({ path: "/repo", slot: "s1" }).filters).toEqual({ hidden: true, ignored: false });
  world.settings = { zoom: 1 };
});

test("/ filters through the index: hits under folders, enter opens beside the pane, a folder shows in the tree", async () => {
  world.spaces = [{ active: true, tabs: [{ id: "t1", active: true }] }];
  world.panes = [{ pane: "p1", tab: "t1", terminal: "x" }, { pane: "pf", tab: "t1", mod: "nocturne-files", props: { path: "/repo", slot: "s1" } }];
  world.shared = {};
  const asked: string[] = [];
  world.find = async (root, q) => { asked.push(`${root}:${q}`); return { files: [{ path: "src/main.rs", ranges: [[4, 8]], git: null }, { path: ".github/main.yml", ranges: [[8, 12]] }], scanning: false }; };
  const view = pane({ path: "/repo", slot: "s1" }, TREE);
  view.filters = { hidden: false, ignored: true };
  view.key({ key: "/" }, cx);
  view.input.fire("focus");
  expect(view.typing).toBe(true);
  // Typing j goes to the filter, not the tree.
  view.key({ key: "j" }, cx);
  view.input.set_value("main");
  view.input.fire("change");
  await settle();
  expect(asked).toEqual(["/repo:main"]);
  expect(view.shown().map((r: any) => r.path)).toEqual(["src", "src/main.rs"]);
  expect(view.sel).toBe("src/main.rs");
  commands.length = 0;
  view.input.fire("submit");
  expect(commands).toEqual([["editor.open", { path: "/repo/src/main.rs", pane: "pf" }]]);
  // Esc clears the filter; the tree is back.
  view.key({ key: "escape" }, cx);
  expect(view.query).toBe("");
  expect(view.shown().map((r: any) => r.path)).toEqual(["src", "target", "README.md"]);
  // Enter on a hit's folder shows it in the tree.
  view.query = "main"; view.search(cx); await settle();
  view.typing = false;
  view.sel = "src";
  view.key({ key: "enter" }, cx);
  expect(view.query).toBe("");
  expect(view.folders.has("src")).toBe(true);
  expect(view.want).toBe("src");
});

test("where the index can't go (another machine), the search covers the folders listed so far", async () => {
  world.find = async () => { throw new Error("not here"); };
  const view = pane({ folder: "/repo", on: "box" }, TREE);
  view.query = "mrs";
  view.search(cx);
  await settle();
  expect(view.shown().map((r: any) => r.path)).toEqual(["src", "src/main.rs"]);
  expect(view.note).toContain("listed so far");
  // Home has no index either: the same fallback.
  const local = pane({ folder: "/home/me" }, TREE);
  local.query = "readme"; local.search(cx); await settle();
  expect(local.shown().map((r: any) => r.path)).toEqual(["README.md"]);
});

test("v opens Neovim beside; o a folder in a new files pane; y copies; q and esc close only a pane of its own", () => {
  world.spaces = [{ active: true, tabs: [{ id: "t1", active: true }] }];
  world.panes = [{ pane: "p1", tab: "t1", terminal: "x" }, { pane: "pf", tab: "t1", mod: "nocturne-files", props: { path: "/repo", slot: "s1" } }];
  const view = pane({ path: "/repo", slot: "s1" }, TREE);
  commands.length = 0;
  view.sel = "src";
  view.key({ key: "v" }, cx);
  view.key({ key: "o" }, cx);
  view.key({ key: "y" }, cx);
  view.sel = "README.md";
  view.key({ key: "v" }, cx);
  view.key({ key: "q" }, cx);
  expect(commands).toEqual([
    ["terminal.open", { argv: ["nvim", "."], folder: "/repo/src", place: "auto", pane: "pf" }],
    ["files.open", { path: "/repo/src", pane: "pf" }],
    ["terminal.open", { argv: ["nvim", "/repo/README.md"], folder: "/repo", place: "auto", pane: "pf" }],
    ["pane.close", { pane: "pf" }],
  ]);
  expect(clipboard.at(-1)).toBe("/repo/src");
  // The panel (no path of its own): esc hands the keyboard back to the pane it
  // came from, q closes it (the keyboard back there too); Neovim opens to its left.
  world.panes = [{ pane: "p1", tab: "t1", terminal: "x" }, { pane: "pp", tab: "t1", mod: "nocturne-files", props: { folder: "/repo" } }];
  world.shared = { "nocturne-files.from": "p1" };
  world.focused = { pane: "pp" };
  const panel = pane({ folder: "/repo" }, TREE);
  commands.length = 0;
  panel.key({ key: "escape" }, cx);
  panel.sel = "README.md";
  panel.key({ key: "v" }, cx);
  panel.sel = "src";
  panel.key({ key: "o" }, cx);
  panel.key({ key: "q" }, cx);
  expect(commands).toEqual([
    ["pane.focus", { pane: "p1" }],
    ["terminal.open", { argv: ["nvim", "/repo/README.md"], folder: "/repo", place: "left", pane: "pp" }],
    ["files.open", { path: "/repo/src", pane: "p1" }],
    ["pane.close", { pane: "pp" }],
    ["pane.focus", { pane: "p1" }],
  ]);
  // Without a pane to go back to: the pane to its left.
  world.shared = {};
  commands.length = 0;
  panel.key({ key: "escape" }, cx);
  expect(commands).toEqual([["pane.go", { direction: "left" }]]);
  world.focused = null;
});

test("the right-click menu runs by key or enter; it opens under the pointer and draws Open in Neovim", () => {
  world.panes = [{ pane: "pf", tab: "t1", mod: "nocturne-files", props: { path: "/repo", slot: "s1" } }];
  const view = pane({ path: "/repo", slot: "s1" }, TREE);
  view.mouse = { x: 30, y: 90 };
  view.openMenu({ path: "README.md", name: "README.md", dir: false }, cx);
  expect(view.menu.at).toEqual({ x: 30, y: 90 });
  const labels = walk(view.render()).flatMap((e: any) => e.nodes).filter((n: any) => typeof n === "string");
  expect(labels).toContain("Open in Neovim");
  commands.length = 0;
  view.key({ key: "v" }, cx);
  expect(view.menu).toBeNull();
  expect(commands).toEqual([["terminal.open", { argv: ["nvim", "/repo/README.md"], folder: "/repo", place: "auto", pane: "pf" }]]);
  view.openMenu({ path: "src", name: "src", dir: true }, cx);
  view.key({ key: "j" }, cx);
  view.key({ key: "enter" }, cx);
  expect(commands.at(-1)).toEqual(["files.open", { path: "/repo/src", pane: "pf" }]);
  // On empty space: the root's menu, without fold and root.
  view.openMenu({ path: "", name: "/repo", dir: true }, cx);
  expect(view.menu.items.map((x: any) => x.act)).toEqual(["pane", "edit", "nvim", "new-file", "new-folder", "copy", "close"]);
});

test("the header shows both filters, the search hint and a close button in a pane of its own", () => {
  world.panes = [{ pane: "pf", tab: "t1", mod: "nocturne-files", props: { path: "/repo", slot: "s1" } }];
  world.shared = {};
  const view = pane({ path: "/repo", slot: "s1" }, TREE);
  view.filters = { hidden: false, ignored: true };
  const els = walk(view.render());
  const text = els.flatMap((e: any) => e.nodes).filter((n: any) => typeof n === "string");
  expect(text).toEqual(expect.arrayContaining(["dotfiles", "ignored", "filter files", "/", "2"]));
  const svgs = els.filter((e: any) => e.kind === "svg").map((e: any) => e.arg);
  expect(svgs).toEqual(expect.arrayContaining(["mods/nocturne-files/eye-off.svg", "mods/workspace-chrome/eye.svg", "mods/workspace-chrome/x.svg", "mods/workspace-chrome/search.svg"]));
  // It names its folder in the pane header, and tells files.open where it's rooted.
  expect(world.shared["nocturne-files.titles"]).toEqual({ s1: "repo" });
  expect(world.shared["nocturne-files.paths"]).toEqual({ s1: "/repo" });
  const panel = pane({ folder: "/repo" }, TREE);
  expect(walk(panel.render()).filter((e: any) => e.kind === "svg").map((e: any) => e.arg)).not.toContain("mods/workspace-chrome/x.svg");
});

test("the panel toggle leaves files panes of their own alone", async () => {
  const src = await readFile(new URL("../defaults/mods/nocturne/files.js", import.meta.url), "utf8");
  expect(src).toContain("p.mod === MOD && p.tab === tab && !p.props?.path");
});

// ---- the keyboard, the folders visited, narrow widths

test("a copy opened as the focused pane takes the keyboard, with a row picked; pane.go and cmd-e's take-panel give it too", () => {
  world.spaces = [{ active: true, tabs: [{ id: "t1", active: true }] }];
  world.panes = [{ pane: "p1", tab: "t1", terminal: "x" }, { pane: "pp", tab: "t1", mod: "nocturne-files", props: { folder: "/repo", slot: "s9" } }];
  world.focused = { pane: "pp" };
  let focusedHandle = 0;
  const own = { ...cx, focus_handle: () => ({ focus() { focusedHandle++; }, is_focused: () => false }) };
  later.length = 0;
  const view: any = Object.create(Files.prototype);
  view.loadFolder = async () => {}; view.refresh = () => {};
  world.props = { folder: "/repo", slot: "s9" };
  view.init.call(view, world.props, own);
  for (const [k, list] of Object.entries(TREE)) view.entries.set(k, list.map(([name, dir]) => ({ name, dir })));
  for (const f of later.splice(0)) f(own);
  expect(focusedHandle).toBe(3);
  expect(view.sel).toBe("src");
  // Not the focused pane (a restart with the keyboard elsewhere): it leaves the keyboard be.
  world.focused = { pane: "p1" };
  focusedHandle = 0;
  const other: any = Object.create(Files.prototype);
  other.loadFolder = async () => {}; other.refresh = () => {};
  other.init.call(other, world.props, own);
  for (const f of later.splice(0)) f(own);
  expect(focusedHandle).toBe(0);
  world.focused = null;
});

test("cmd-e: opens the panel, moves the keyboard into an open one, closes it from inside, back where it came from", async () => {
  const files = await load("nocturne/files.js");
  world.spaces = [{ active: true, tabs: [{ id: "t1", active: true }], folder: "/repo" }];
  world.panes = [{ pane: "p1", tab: "t1", terminal: "x", cwd: "/repo" }];
  world.focused = { pane: "p1", cwd: "/repo" };
  world.shared = {};
  commands.length = 0;
  files.focusFiles();
  expect(commands[0][0]).toBe("pane.split");
  expect(world.shared["nocturne-files.from"]).toBe("p1");
  world.panes.push({ pane: "pp", tab: "t1", mod: "nocturne-files", props: { folder: "/repo", slot: "s1" } });
  commands.length = 0;
  files.focusFiles();
  expect(commands).toEqual([["pane.focus", { pane: "pp" }], ["nocturne-files.take-panel", undefined]]);
  world.focused = { pane: "pp" };
  commands.length = 0;
  files.focusFiles();
  expect(commands).toEqual([["pane.close", { pane: "pp" }], ["pane.focus", { pane: "p1" }]]);
  // The tab strip's button and the palette still just toggle.
  commands.length = 0;
  world.focused = { pane: "p1" };
  files.toggleFiles();
  expect(commands).toEqual([["pane.close", { pane: "pp" }]]);
  world.focused = null;
});

test("back and forward walk the folders the tree was rooted at; back with none goes up", () => {
  const { navGo, navBack, navForward, newNav } = logic;
  let nav = newNav(), root = "/repo";
  const step = (s: any) => { nav = s.nav; root = s.to; };
  step(navGo(nav, root, "/repo/src"));
  step(navGo(nav, root, "/repo/src/app"));
  expect(navGo(nav, root, root)).toBeNull();
  step(navBack(nav, root));
  expect(root).toBe("/repo/src");
  step(navBack(nav, root));
  expect(root).toBe("/repo");
  step(navForward(nav, root));
  expect(root).toBe("/repo/src");
  // Going somewhere new drops what was ahead.
  step(navGo(nav, root, "/repo/docs"));
  expect(navForward(nav, root)).toBeNull();
  // With nothing behind, back is up a folder, and forward returns.
  nav = newNav(); root = "/repo/src";
  step(navBack(nav, root));
  expect(root).toBe("/repo");
  step(navForward(nav, root));
  expect(root).toBe("/repo/src");
  expect(navBack(newNav(), "/")).toBeNull();
});

test("the pane's keys: [ ] and alt-arrows go back and forward, - and . are remembered", () => {
  world.panes = [{ pane: "pf", tab: "t1", mod: "nocturne-files", props: { path: "/repo", slot: "s1" } }];
  const view = pane({ path: "/repo", slot: "s1" }, TREE);
  view.sel = "src";
  view.key({ key: "." }, cx);
  expect(view.root).toBe("/repo/src");
  view.key({ key: "[" }, cx);
  expect(view.root).toBe("/repo");
  expect(view.pendingSel).toBe("/repo/src");
  view.key({ key: "]" }, cx);
  expect(view.root).toBe("/repo/src");
  view.key({ key: "left", modifiers: { alt: true } }, cx);
  expect(view.root).toBe("/repo");
  view.key({ key: "right", modifiers: { alt: true } }, cx);
  expect(view.root).toBe("/repo/src");
  view.key({ key: "-" }, cx);
  expect(view.root).toBe("/repo");
  view.key({ key: "o", modifiers: { control: true } }, cx);
  expect(view.root).toBe("/repo/src");
  view.key({ key: "i", modifiers: { control: true } }, cx);
  expect(view.root).toBe("/repo");
});

test("p opens a file in its viewer; the whole tree can be walked by keys", () => {
  world.spaces = [{ active: true, tabs: [{ id: "t1", active: true }] }];
  world.panes = [{ pane: "p1", tab: "t1", terminal: "x" }, { pane: "pf", tab: "t1", mod: "nocturne-files", props: { path: "/repo", slot: "s1" } }];
  const view = pane({ path: "/repo", slot: "s1" }, { ...TREE, "": [...TREE[""], ["shot.png", false]] });
  commands.length = 0;
  for (const k of ["j", "l", "j", "j", "h", "h", "G", "p", "g", "g"]) view.key({ key: k }, cx);
  expect(view.folders.has("src")).toBe(false);
  expect(commands).toEqual([["preview.open", { path: "/repo/shot.png", pane: "pf" }]]);
  expect(view.sel).toBe("src");
});

test("the header fits every width from the narrowest panel up: nothing overlaps, labels shorten first", () => {
  const { lensFit, toolbarFit, CH } = logic;
  const cut = { hidden: 12, ignored: 3 };
  let last = "";
  for (let w = 140; w <= 900; w += 2) {
    const fit = lensFit(w, { cut, count: 120 });
    // Its estimate fits the width (CH px a character at size 11).
    const chip = (label: string, n: number) => 8 + 11 + (label ? 4 + label.length * CH : 0) + (fit.cuts && n ? 4 + String(n).length * CH : 0);
    const find = CH + (fit.find ? 5 + fit.find.length * CH : 0);
    const parts = [11, find, chip(fit.labels[0], cut.hidden), chip(fit.labels[1], cut.ignored), ...(fit.count ? [3 * CH] : [])];
    expect(16 + parts.reduce((a: number, b: number) => a + b, 0) + 6 * (parts.length - 1)).toBeLessThanOrEqual(w);
    last = fit.chips;
  }
  expect(last).toBe("full");
  // The panel's 280 px (the screenshot's overlap): short labels, the whole placeholder or most of it.
  expect(lensFit(280, { cut }).chips).toBe("short");
  expect(lensFit(400, {}).labels).toEqual(["dotfiles", "ignored"]);
  expect(lensFit(150, { cut }).chips).toBe("icon");
  // The toolbar drops its extras before the name gets too small.
  const narrow = toolbarFit(160, { branch: "main", changed: 3, name: "fireflies" });
  expect(narrow).toEqual({ close: false, changed: true, edit: false, branch: false, eyebrow: false, path: false, name: 56 });
  expect(toolbarFit(280, { branch: "main", changed: 0, name: "fireflies" })).toMatchObject({ edit: true, branch: true });
  expect(toolbarFit(600, { branch: "main", changed: 3, name: "fireflies", alone: true })).toEqual({ close: true, changed: true, edit: true, branch: true, eyebrow: true, path: true, name: 56 });
  // A pane squeezed to ~110 px keeps some of its name; its close button (the pane header has one) goes first.
  const tight = toolbarFit(110, { alone: true, name: "defaults" });
  expect(tight.close).toBe(false);
  expect(tight.name).toBeGreaterThanOrEqual(3 * CH);
});

test("drawn at 280 px with filters on, the header has no long labels; at 120 only the eyes", () => {
  world.panes = [{ pane: "pf", tab: "t1", mod: "nocturne-files", props: { folder: "/repo", slot: "s1" } }];
  const view = pane({ folder: "/repo", slot: "s1" }, TREE);
  view.filters = { hidden: false, ignored: true };
  const words = () => walk(view.render()).flatMap((e: any) => e.nodes).filter((n: any) => typeof n === "string");
  view.size = { width: 280, height: 600 };
  expect(words()).not.toContain("dotfiles");
  expect(words()).toEqual(expect.arrayContaining([".*", "ign", "‹", "›"]));
  view.size = { width: 120, height: 600 };
  const narrow = words();
  expect(narrow).not.toContain(".*");
  expect(narrow).not.toContain("edit");
});

test("Herdr's cleanup call when the pane goes closes nothing more (it used to close the pane a second time: 'no pane' toast)", () => {
  // Herdr calls close() on the copy while its last panes() still lists the pane.
  world.spaces = [{ active: true, tabs: [{ id: "t1", active: true }] }];
  world.shared = { "nocturne-files.from": "p1" };
  world.focused = { pane: "pp" };
  world.panes = [{ pane: "p1", tab: "t1", terminal: "x" }, { pane: "pp", tab: "t1", mod: "nocturne-files", props: { folder: "/repo" } }];
  const panel = pane({ folder: "/repo" }, TREE);
  world.panes.push({ pane: "pf", tab: "t1", mod: "nocturne-files", props: { path: "/repo", slot: "s1" } });
  const own = pane({ path: "/repo", slot: "s1" }, TREE);
  commands.length = 0;
  panel.close?.(cx);
  own.close?.(cx);
  expect(commands).toEqual([]);
  // q still closes it, once.
  own.key({ key: "q" }, cx);
  expect(commands).toEqual([["pane.close", { pane: "pf" }]]);
  world.focused = null;
});

test("? shows the keys over the files (? keys the filter line's last item), ? or esc hides them; / still filters", () => {
  world.panes = [{ pane: "pf", tab: "t1", mod: "nocturne-files", props: { path: "/repo", slot: "s1" } }];
  world.shared = {};
  const view = pane({ path: "/repo", slot: "s1" }, TREE);
  const texts = (el: any): string[] => typeof el === "string" ? [el] : el && typeof el === "object" && "nodes" in el ? el.nodes.flatMap(texts) : [];
  // The filter line ends with "? keys" (keyhelp.js).
  expect(texts(view.lens(world.props, 400, 0)).slice(-2)).toEqual(["?", "keys"]);
  const q = { key: "/", key_char: "?", modifiers: { shift: true } };
  view.key(q, cx);
  expect(view.keysShown).toBe(true);
  expect(view.typing).toBeFalsy();
  const strip = texts(view.keysStrip(world.props));
  expect(strip.slice(-2)).toEqual(["?", "keys"]);
  expect(strip).toEqual(expect.arrayContaining(["j k  ↑ ↓", "/", "q"]));
  expect(texts(view.render())).toEqual(expect.arrayContaining(["?", "keys"]));
  view.key(q, cx);
  expect(view.keysShown).toBe(false);
  view.key(q, cx);
  commands.length = 0;
  view.key({ key: "escape" }, cx);
  expect(view.keysShown).toBe(false);
  expect(commands).toEqual([]); // esc hid the keys; it didn't close the pane
});

// ---- file operations: real ones, in a folder made for each test

import { mkdtemp, mkdir, writeFile, rm, chmod, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as pjoin } from "node:path";

const exists = (p: string) => stat(p).then(() => true, () => false);
const execs: { cmd: string; args: string[]; on: any }[] = [];

/** A temp folder: `root` (the tree), `Trash` and `bin/trash`, a stand-in for
 *  macOS's (the probe names it): it moves what it's given into `Trash`. */
async function sandbox(trash = true) {
  const dir = await mkdtemp(pjoin(tmpdir(), "nf-ops-"));
  const root = pjoin(dir, "root");
  await mkdir(pjoin(root, "src", "sub"), { recursive: true });
  await mkdir(pjoin(root, "docs"));
  await mkdir(pjoin(dir, "Trash"));
  await mkdir(pjoin(dir, "bin"));
  await writeFile(pjoin(root, "src", "main.rs"), "fn main() {}\n");
  await writeFile(pjoin(root, "src", "sub", "deep.rs"), "deep\n");
  await writeFile(pjoin(root, "docs", "guide.txt"), "guide\n");
  await writeFile(pjoin(root, "README.md"), "# readme\n");
  const tool = pjoin(dir, "bin", "trash");
  await writeFile(tool, `#!/bin/sh\nfor p in "$@"; do mv "$p" "${pjoin(dir, "Trash")}/" || exit 1; done\n`);
  await chmod(tool, 0o755);
  world.exec = async (cmd, args = [], o = {}) => {
    execs.push({ cmd, args, on: o.on ?? null });
    if (args[2] === "files-trash-probe") return { code: 0, stdout: trash ? `${tool}\n` : "\n", stderr: "" };
    const p = Bun.spawn([cmd, ...args], { cwd: o.cwd ?? dir, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { code, stdout, stderr };
  };
  execs.length = 0;
  return { dir, root, trashDir: pjoin(dir, "Trash"), done: async () => { await chmod(dir, 0o755).catch(() => {}); await rm(dir, { recursive: true, force: true }); world.exec = noExec; } };
}

/** A pane on `root` that lists the real folder (the folder watch left out). */
async function realPane(root: string, extra: any = {}) {
  world.spaces = [{ active: true, tabs: [{ id: "t1", active: true }] }];
  world.panes = [{ pane: "p1", tab: "t1", terminal: "x" }, { pane: "pf", tab: "t1", mod: "nocturne-files", props: { path: root, slot: "s1", ...extra } }];
  world.shared = {};
  world.props = { path: root, slot: "s1", ...extra };
  const view: any = Object.create(Files.prototype);
  view.refresh = () => {};
  view.init.call(view, world.props, cx);
  pending.length = 0;
  delete view.refresh;
  view.watch = () => {};
  view.refresh(cx);
  await settle();
  view.render();
  return view;
}
const paths = (view: any) => view.shown().map((r: any) => r.path);
const row = (view: any, p: string) => view.shown().find((r: any) => r.path === p);
/** Types a name into the open input and presses enter; the tree listed again and drawn. */
async function name(view: any, text: string) {
  view.nameInput.set_value(text);
  view.nameInput.fire("change");
  view.nameInput.fire("submit");
  await settle();
  view.render();
}
const words = (el: any): string[] => typeof el === "string" ? [el] : el && typeof el === "object" && "nodes" in el ? el.nodes.flatMap(words) : [];

test("names: paths resolve from the folder, a trailing / makes a folder, . and .. aren't names", () => {
  const { resolveName, renameTarget, stemRange, moveRefusal, relTo, join } = logic;
  expect(resolveName("/r/src", "a/b.rs")).toEqual({ abs: "/r/src/a/b.rs", folder: false });
  expect(resolveName("/r/src", "lib/")).toEqual({ abs: "/r/src/lib", folder: true });
  expect(resolveName("/r/src", "../x")).toEqual({ abs: "/r/x", folder: false });
  expect(resolveName("/r/src", "/etc/y")).toEqual({ abs: "/etc/y", folder: false });
  expect(resolveName("/r", "~/n", "/home/me")).toEqual({ abs: "/home/me/n", folder: false });
  expect(resolveName("/r", "~/n", null).error).toContain("~");
  for (const bad of ["", "  ", ".", "..", "a/..", "/"]) expect(resolveName("/r", bad).error).toBeTruthy();
  expect(resolveName("/r", "-dash 'q' \"ü\".txt").abs).toBe("/r/-dash 'q' \"ü\".txt");
  expect(renameTarget("/r/src/main.rs", "lib.rs")).toEqual({ abs: "/r/src/lib.rs" });
  expect(renameTarget("/r/src/main.rs", "../docs/")).toEqual({ abs: "/r/docs/main.rs" });
  expect(stemRange("main.rs")).toEqual({ start: 0, end: 4 });
  expect(stemRange("a.tar.gz")).toEqual({ start: 0, end: 5 });
  expect(stemRange(".env")).toEqual({ start: 0, end: 4 });
  expect(stemRange("Makefile")).toEqual({ start: 0, end: 8 });
  expect(stemRange("my.folder", true)).toEqual({ start: 0, end: 9 });
  expect(moveRefusal("/r", "/x/r", "/r")).toContain("root");
  expect(moveRefusal("/r/src", "/r/src/sub/src", "/r")).toContain("into itself");
  expect(moveRefusal("/r/src", "/r/src", "/r")).toContain("already");
  expect(moveRefusal("/r/src", "/r/srcs", "/r")).toBeNull();
  expect([relTo("/r", "/r/a/b"), relTo("/r", "/r"), relTo("/r", "/rx"), relTo("/", "/etc")]).toEqual(["a/b", "", null, "etc"]);
  expect(join("/", "etc")).toBe("/etc");
});

test("the rest of the operations' logic: the neighbour after a delete, unfolded folders after a move, errors in a line", () => {
  const { neighbour, movedFolders, cleanError, deleteQuestion } = logic;
  const rows = ["src", "src/a", "src/b", "docs", "z"].map((path) => ({ path }));
  expect(neighbour(rows, "src")).toBe("docs");
  expect(neighbour(rows, "src/b")).toBe("docs");
  expect(neighbour(rows, "z")).toBe("docs");
  expect([...movedFolders(new Set(["src", "src/sub", "docs"]), "src", "lib/src")]).toEqual(["lib/src", "lib/src/sub", "docs"]);
  expect([...movedFolders(new Set(["src", "src/sub", "docs"]), "src", null)]).toEqual(["docs"]);
  expect(cleanError(`2026-11-11 trash[1:2] # Error attempting to move /x/f to the trash folder, Error Domain=NSCocoaErrorDomain Code=513 "“f” couldn’t be moved to the trash because you don’t have permission to access it." UserInfo={NSURL=file:///x/f}`))
    .toBe("“f” couldn’t be moved to the trash because you don’t have permission to access it.");
  expect(cleanError("mv: rename /a to /b: Permission denied\n")).toBe("mv: rename /a to /b: Permission denied");
  expect(deleteQuestion("src", true, true)).toBe("Move “src/” and everything in it to the Trash?");
  expect(deleteQuestion("a.rs", false, false)).toBe("Delete “a.rs” permanently?");
});

test("a: a new file in the selected folder, parents made for slashes, opened as enter would; from the menu beside a file", async () => {
  const box = await sandbox();
  try {
    const view = await realPane(box.root);
    expect(paths(view)).toEqual(["docs", "src", "README.md"]);
    view.sel = "src";
    view.key({ key: "a" }, cx);
    await settle();
    expect(view.draft).toMatchObject({ kind: "file", dir: "src", after: "src" });
    // The input row sits first in the unfolded folder.
    const drawn = view.withDraft(view.shown()).map((r: any) => r.draft ? "<input>" : r.path);
    expect(drawn.slice(0, 4)).toEqual(["docs", "src", "<input>", "src/sub"]);
    expect(words(view.render())).toEqual(expect.arrayContaining(["New file in src/: end with / for a folder", "enter", "create", "esc", "cancel"]));
    // While it's open, the pane's keys go to the name: j doesn't move, q doesn't close.
    commands.length = 0;
    view.key({ key: "j" }, cx);
    view.key({ key: "q" }, cx);
    expect(commands).toEqual([]);
    await name(view, "new file.rs");
    expect(await exists(pjoin(box.root, "src", "new file.rs"))).toBe(true);
    expect(view.draft).toBeNull();
    expect(view.sel).toBe("src/new file.rs");
    expect(commands).toEqual([["editor.open", { path: `${box.root}/src/new file.rs`, pane: "pf" }]]);
    // Slashes make the folders on the way; a Markdown file opens in its viewer.
    view.key({ key: "a" }, cx);
    await name(view, "notes/2026/plan.md");
    expect(await exists(pjoin(box.root, "src", "notes", "2026", "plan.md"))).toBe(true);
    expect(view.folders.has("src/notes/2026")).toBe(true);
    expect(view.sel).toBe("src/notes/2026/plan.md");
    expect(commands.at(-1)[0]).toBe("markdown.open");
    // The menu on a file: beside it. A leading dash, quotes and unicode are a name like any other.
    view.mouse = { x: 10, y: 10 };
    view.openMenu(row(view, "README.md"), cx);
    expect(view.menu.items.find((x: any) => x.act === "new-file")).toMatchObject({ key: "a", label: "New file beside it" });
    view.key({ key: "a" }, cx);
    expect(view.draft).toMatchObject({ kind: "file", dir: "", after: "README.md" });
    await name(view, "-dash 'q' \"ü\".txt");
    expect(await exists(pjoin(box.root, "-dash 'q' \"ü\".txt"))).toBe(true);
    expect(view.sel).toBe("-dash 'q' \"ü\".txt");
    // esc gives up: nothing made, the keyboard back on the tree.
    view.key({ key: "a" }, cx);
    view.nameInput.set_value("never.txt");
    view.key({ key: "escape" }, cx);
    expect(view.draft).toBeNull();
    expect(await exists(pjoin(box.root, "never.txt"))).toBe(false);
  } finally { await box.done(); }
});

test("A: a new folder beside the selected file; from the menu in a folder and on the empty space (the root); a / ending a makes one too", async () => {
  const box = await sandbox();
  try {
    const view = await realPane(box.root);
    view.toggle("src", cx); await settle(); view.render();
    view.sel = "src/main.rs";
    view.key({ key: "a", modifiers: { shift: true } }, cx);
    expect(view.draft).toMatchObject({ kind: "folder", dir: "src" });
    await name(view, "lib");
    expect((await stat(pjoin(box.root, "src", "lib"))).isDirectory()).toBe(true);
    expect(view.sel).toBe("src/lib");
    // The menu on a folder that's folded: it unfolds, the folder goes in it.
    view.openMenu(row(view, "docs"), cx);
    expect(view.menu.items.find((x: any) => x.act === "new-folder")).toMatchObject({ key: "A", label: "New folder in it" });
    view.key({ key: "A" }, cx);
    await settle();
    expect(view.folders.has("docs")).toBe(true);
    await name(view, "img");
    expect((await stat(pjoin(box.root, "docs", "img"))).isDirectory()).toBe(true);
    expect(view.sel).toBe("docs/img");
    // The empty space's menu: new file and new folder in the root.
    view.openMenu({ path: "", name: box.root, dir: true }, cx);
    const acts = view.menu.items.map((x: any) => x.act);
    expect(acts).toEqual(expect.arrayContaining(["new-file", "new-folder"]));
    expect(acts).not.toEqual(expect.arrayContaining(["rename"]));
    view.act("new-folder", view.menu.row, cx);
    view.menu = null;
    expect(view.draft).toMatchObject({ kind: "folder", dir: "" });
    await name(view, "-out");
    expect((await stat(pjoin(box.root, "-out"))).isDirectory()).toBe(true);
    // a with a trailing /: a folder.
    view.sel = null;
    view.key({ key: "a" }, cx);
    await name(view, "made/");
    expect((await stat(pjoin(box.root, "made"))).isDirectory()).toBe(true);
    expect(view.sel).toBe("made");
  } finally { await box.done(); }
});

test("R: the name in the input, the stem selected; enter renames, the folder stays unfolded; a path moves it", async () => {
  const box = await sandbox();
  try {
    const view = await realPane(box.root);
    view.toggle("src", cx); view.toggle("src/sub", cx); await settle(); view.render();
    view.sel = "src/main.rs";
    view.key({ key: "R" }, cx);
    expect(view.draft).toMatchObject({ kind: "rename", path: "src/main.rs" });
    expect(view.nameInput.value()).toBe("main.rs");
    expect(view.nameInput.selected).toEqual({ start: 0, end: 4 });
    expect(words(view.render())).toEqual(expect.arrayContaining(["Rename “main.rs”: a path moves it", "rename"]));
    await name(view, "lib.rs");
    expect(await readdir(pjoin(box.root, "src"))).toEqual(expect.arrayContaining(["lib.rs"]));
    expect(await exists(pjoin(box.root, "src", "main.rs"))).toBe(false);
    expect(view.sel).toBe("src/lib.rs");
    // A folder from the menu (r with shift there too): unfolded folders under it stay unfolded.
    view.openMenu(row(view, "src"), cx);
    view.key({ key: "r", modifiers: { shift: true } }, cx);
    expect(view.nameInput.selected).toEqual({ start: 0, end: 3 });
    await name(view, "source");
    expect(await exists(pjoin(box.root, "source", "sub", "deep.rs"))).toBe(true);
    expect([view.folders.has("source"), view.folders.has("source/sub"), view.folders.has("src")]).toEqual([true, true, false]);
    expect(view.sel).toBe("source");
    expect(paths(view)).toContain("source/sub/deep.rs");
    // A path in the name moves it: up a folder, and into a folder (a trailing /) keeping its name.
    view.sel = "source/lib.rs";
    view.key({ key: "R" }, cx);
    await name(view, "../top.rs");
    expect(await exists(pjoin(box.root, "top.rs"))).toBe(true);
    expect(view.sel).toBe("top.rs");
    view.key({ key: "R" }, cx);
    await name(view, "docs/");
    expect(await exists(pjoin(box.root, "docs", "top.rs"))).toBe(true);
    expect(view.sel).toBe("docs/top.rs");
    expect(view.folders.has("docs")).toBe(true);
    // The same name: nothing runs.
    execs.length = 0;
    view.key({ key: "R" }, cx);
    await name(view, "top.rs");
    expect(view.draft).toBeNull();
    expect(execs.filter((e) => e.args[2] === "files-op")).toEqual([]);
  } finally { await box.done(); }
});

test("x and P: cut a file, paste it in a folder; a folder by the menu; the cut row is marked, the cut used up", async () => {
  const box = await sandbox();
  try {
    const view = await realPane(box.root);
    view.sel = "README.md";
    view.key({ key: "x" }, cx);
    expect(world.shared["nocturne-files.cut"]).toEqual({ abs: `${box.root}/README.md`, on: null, dir: false, name: "README.md" });
    expect(words(view.render())).toContain("Cut “README.md”: P pastes it in the selected folder");
    expect(words(view.row(herdr.theme(), row(view, "README.md"), true))).toEqual(["README.md", "cut"]);
    view.sel = "docs";
    view.key({ key: "p", modifiers: { shift: true } }, cx);
    await settle(); view.render();
    expect(await exists(pjoin(box.root, "docs", "README.md"))).toBe(true);
    expect(await exists(pjoin(box.root, "README.md"))).toBe(false);
    expect(view.sel).toBe("docs/README.md");
    expect(view.folders.has("docs")).toBe(true);
    expect(world.shared["nocturne-files.cut"]).toBeNull();
    // A folder, by the menu: cut, then paste beside a file in another folder (into that folder).
    view.openMenu(row(view, "docs"), cx);
    view.key({ key: "x" }, cx);
    view.toggle("src", cx); await settle(); view.render();
    view.openMenu(row(view, "src/main.rs"), cx);
    expect(view.menu.items.find((x: any) => x.act === "paste")).toMatchObject({ key: "P", label: "Paste beside it" });
    view.key({ key: "P" }, cx);
    await settle(); view.render();
    expect(await exists(pjoin(box.root, "src", "docs", "guide.txt"))).toBe(true);
    expect(view.sel).toBe("src/docs");
    // Nothing cut: P says so.
    view.key({ key: "P" }, cx);
    expect(view.msg.text).toContain("Nothing is cut");
    // x again on the cut row uncuts it.
    view.sel = "src/main.rs";
    view.key({ key: "x" }, cx);
    view.key({ key: "x" }, cx);
    expect(world.shared["nocturne-files.cut"]).toBeNull();
  } finally { await box.done(); }
});

test("d: asks first, naming the item; y moves it to the Trash and the selection takes the next row; anything else keeps it", async () => {
  const box = await sandbox();
  try {
    const view = await realPane(box.root);
    view.sel = "docs";
    view.key({ key: "d" }, cx);
    await settle();
    expect(view.ask).toMatchObject({ path: "docs", dir: true });
    expect(words(view.render())).toEqual(expect.arrayContaining(["Move “docs/” and everything in it to the Trash?", "y", "move to the Trash", "esc", "keep it"]));
    // Anything else cancels, and goes no further (j doesn't move).
    view.key({ key: "j" }, cx);
    expect(view.ask).toBeNull();
    expect(view.sel).toBe("docs");
    expect(await exists(pjoin(box.root, "docs"))).toBe(true);
    view.key({ key: "d" }, cx); await settle();
    view.key({ key: "y" }, cx);
    await settle(); view.render();
    expect(await exists(pjoin(box.root, "docs"))).toBe(false);
    expect(await exists(pjoin(box.trashDir, "docs", "guide.txt"))).toBe(true);
    expect(view.sel).toBe("src");
    expect(view.msg.text).toBe("Moved “docs” to the Trash");
    // A file by the menu, enter confirms; the last row: the one before takes the selection.
    view.openMenu(row(view, "README.md"), cx);
    view.key({ key: "d" }, cx);
    await settle();
    expect(words(view.render())).toContain("Move “README.md” to the Trash?");
    view.key({ key: "enter" }, cx);
    await settle(); view.render();
    expect(await exists(pjoin(box.trashDir, "README.md"))).toBe(true);
    expect(view.sel).toBe("src");
  } finally { await box.done(); }
});

test("d where the machine has no trash: the question says permanently, and it's gone", async () => {
  const box = await sandbox(false);
  try {
    const view = await realPane(box.root);
    view.sel = "src";
    view.key({ key: "d" }, cx); await settle();
    expect(words(view.render())).toEqual(expect.arrayContaining(["Delete “src/” and everything in it permanently?", "delete"]));
    view.key({ key: "y" }, cx); await settle(); view.render();
    expect(await exists(pjoin(box.root, "src"))).toBe(false);
    expect(await readdir(box.trashDir)).toEqual([]);
    expect(view.msg.text).toBe("Deleted “src”");
  } finally { await box.done(); }
});

test("refused: an existing target (nothing overwritten), the root, a folder into itself", async () => {
  const box = await sandbox();
  try {
    const view = await realPane(box.root);
    // A new file over an existing one: said, the input stays open, the file untouched.
    view.sel = "README.md";
    view.key({ key: "a" }, cx);
    await name(view, "README.md");
    expect(view.msg.text).toBe("“README.md” already exists");
    expect(view.draft).not.toBeNull();
    expect(words(view.render())).toContain("“README.md” already exists");
    view.key({ key: "escape" }, cx);
    view.key({ key: "A" }, cx);
    await name(view, "src");
    expect(view.msg.text).toBe("“src” already exists");
    view.key({ key: "escape" }, cx);
    // A rename onto an existing file.
    view.sel = "README.md";
    view.key({ key: "R" }, cx);
    await name(view, "docs/guide.txt");
    expect(view.msg.text).toBe("“guide.txt” already exists");
    expect(await Bun.file(pjoin(box.root, "docs", "guide.txt")).text()).toBe("guide\n");
    expect(await exists(pjoin(box.root, "README.md"))).toBe(true);
    view.key({ key: "escape" }, cx);
    // A paste where the name is taken.
    await writeFile(pjoin(box.root, "docs", "README.md"), "other\n");
    view.sel = "README.md";
    view.key({ key: "x" }, cx);
    view.sel = "docs";
    view.key({ key: "P" }, cx);
    await settle();
    expect(view.msg.text).toBe("“README.md” already exists");
    expect(await Bun.file(pjoin(box.root, "docs", "README.md")).text()).toBe("other\n");
    expect(await Bun.file(pjoin(box.root, "README.md")).text()).toBe("# readme\n");
    // The root: no row, or the empty space's menu.
    view.sel = null;
    for (const k of ["R", "x", "d"]) {
      view.key({ key: k }, cx);
      await settle();
      expect(view.msg.text).toMatch(/root can't be (renamed|moved|deleted)/);
      expect(view.draft ?? view.ask).toBeNull();
    }
    // A folder into itself: pasted into its own subfolder, or renamed into it.
    view.toggle("src", cx); await settle(); view.render();
    view.sel = "src";
    view.key({ key: "x" }, cx);
    view.sel = "src/sub";
    view.key({ key: "P" }, cx);
    expect(view.msg.text).toBe("A folder can't go into itself");
    view.sel = "src";
    view.key({ key: "R" }, cx);
    await name(view, "src/sub/");
    expect(view.msg.text).toBe("A folder can't go into itself");
    expect(await exists(pjoin(box.root, "src", "sub", "deep.rs"))).toBe(true);
  } finally { await box.done(); }
});

test("a failed command shows its error and the tree as the disk has it: no permission, a vanished file", async () => {
  const box = await sandbox();
  try {
    const view = await realPane(box.root);
    view.toggle("docs", cx); await settle(); view.render();
    await chmod(pjoin(box.root, "docs"), 0o555);
    view.sel = "docs/guide.txt";
    view.key({ key: "R" }, cx);
    await name(view, "renamed.txt");
    expect(view.msg.text).toContain("Permission denied");
    expect(view.msg.error).toBe(true);
    expect(view.draft).not.toBeNull();
    expect(await exists(pjoin(box.root, "docs", "guide.txt"))).toBe(true);
    view.key({ key: "escape" }, cx);
    view.key({ key: "a" }, cx);
    await name(view, "new.txt");
    expect(view.msg.text).toContain("Permission denied");
    view.key({ key: "escape" }, cx);
    // The stand-in trash fails too.
    view.key({ key: "d" }, cx); await settle();
    view.key({ key: "y" }, cx); await settle(); view.render();
    expect(view.msg.error).toBe(true);
    expect(await exists(pjoin(box.root, "docs", "guide.txt"))).toBe(true);
    expect(paths(view)).toContain("docs/guide.txt");
    await chmod(pjoin(box.root, "docs"), 0o755);
    // Gone behind the tree's back: said, and the tree drops it.
    await rm(pjoin(box.root, "README.md"));
    view.sel = "README.md";
    view.key({ key: "R" }, cx);
    await name(view, "x.md");
    expect(view.msg.text).toBe("“x.md” isn't there anymore");
    expect(paths(view)).not.toContain("README.md");
  } finally { await box.done(); }
});

test("on another machine: every operation runs there, ~ isn't this Mac's home", async () => {
  const box = await sandbox();
  try {
    const view = await realPane(box.root, { on: "box" });
    view.sel = "src";
    view.key({ key: "a" }, cx);
    await name(view, "remote.txt");
    view.sel = "src/remote.txt";
    view.key({ key: "R" }, cx);
    await name(view, "moved.txt");
    view.key({ key: "x" }, cx);
    view.sel = "docs";
    view.key({ key: "P" }, cx); await settle(); view.render();
    expect(view.sel).toBe("docs/moved.txt");
    view.key({ key: "d" }, cx); await settle();
    view.key({ key: "y" }, cx); await settle();
    const ops = execs.filter((e) => e.args[2] === "files-op" || e.args[2] === "files-trash-probe");
    expect(ops.map((e) => e.args[3] ?? "probe")).toEqual(["file", "move", "move", "probe", "delete"]);
    expect(ops.every((e) => e.on === "box")).toBe(true);
    expect(await exists(pjoin(box.trashDir, "moved.txt"))).toBe(true);
    // A cut made here doesn't paste on this Mac's panes.
    expect(world.shared["nocturne-files.cut"]).toBeNull();
    view.sel = "README.md";
    view.key({ key: "x" }, cx);
    expect(world.shared["nocturne-files.cut"].on).toBe("box");
    view.on = null;
    view.key({ key: "P" }, cx);
    expect(view.msg.text).toBe("It was cut on another machine");
    view.on = "box";
    view.key({ key: "a" }, cx);
    await name(view, "~/x");
    expect(view.msg.text).toContain("~");
  } finally { await box.done(); }
});

test("? lists the new keys, each fitting the 280 px panel", () => {
  const { KEYS, CH } = logic;
  const flat = KEYS.map(([k, w]: string[]) => `${k} ${w}`);
  expect(flat).toEqual(expect.arrayContaining(["a A new file / folder", "R rename · move", "x P cut / paste", "d delete"]));
  for (const [k, w] of KEYS) expect(20 + (k.length + w.length) * CH + 4).toBeLessThanOrEqual(280);
});

test("from the search's hits: a rename ends the search and shows the result in the tree; a delete looks the hits up again", async () => {
  const box = await sandbox();
  try {
    const view = await realPane(box.root);
    world.find = async () => ({ files: [{ path: "src/main.rs", ranges: [[4, 8]] }, { path: "docs/guide.txt", ranges: [[5, 9]] }], scanning: false });
    view.query = "i"; view.search(cx); await settle();
    expect(paths(view)).toEqual(["src", "src/main.rs", "docs", "docs/guide.txt"]);
    view.typing = false;
    view.sel = "src/main.rs";
    view.key({ key: "R" }, cx);
    await name(view, "lib.rs");
    expect(view.query).toBe("");
    expect(view.sel).toBe("src/lib.rs");
    expect(view.folders.has("src")).toBe(true);
    let asked = 0;
    world.find = async () => { asked++; return { files: [{ path: "docs/guide.txt", ranges: [[5, 9]] }], scanning: false }; };
    view.query = "i"; view.search(cx); await settle();
    view.typing = false;
    view.sel = "docs/guide.txt";
    view.key({ key: "d" }, cx); await settle();
    view.key({ key: "y" }, cx); await settle();
    expect(asked).toBe(2);
    expect(await exists(pjoin(box.root, "docs", "guide.txt"))).toBe(false);
  } finally { await box.done(); world.find = async () => ({ files: [], scanning: false }); }
});
