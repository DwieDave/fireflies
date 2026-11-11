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
const world: { props: any; panes: any[]; spaces: any[]; shared: Record<string, any>; settings: any; find: (root: string, q: string) => Promise<any> } = {
  props: {}, panes: [], spaces: [], shared: {}, settings: { zoom: 1 }, find: async () => ({ files: [], scanning: false }),
};
const herdr = {
  props: () => world.props, theme: () => ({ background: "#080808", foreground: "#c6c6c6", ansi0: "#323437", ansi3: "#e3c78a", ansi4: "#80a0ff", ansi8: "#949494", accent: "#80a0ff", muted: "#949494", dim: "#5F6D6D" }),
  settings: () => world.settings, exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  panes: () => world.panes, spaces: () => world.spaces, terminals: () => [] as any[],
  shared: (k: string) => world.shared[k] ?? null, setShared: (k: string, v: any) => { world.shared[k] = v; return null; },
  findFiles: (root: string, q: string) => world.find(root, q),
  watchFolder: () => new Promise(() => {}), nextCommand: () => new Promise(() => {}),
  home: () => "/home/me", appHome: () => "/home/me/.config/herdr-app", appWindow: () => ({ platform: "linux" }),
};
const kit = {
  View: class {}, div: () => new Element(), svg: (p: string) => new Element("svg", p),
  PathBuilder: { fill: () => new Element() }, Background: { checkerboard: () => ({}) },
};
const input = () => { let v = ""; const on: Record<string, any> = {}; return { on: (e: string, f: any) => { on[e] = f; }, value: () => v, set_value: (x: string) => { v = x; }, focus() {}, fire: (e: string) => on[e]?.({}, cx) }; };
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
const { default: Files } = await load("nocturne-files/main.js", logic);
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
  expect(acts({ path: "a.rs", dir: false })).toEqual(["open", "other", "terminal", "nvim", "copy"]);
  expect(acts({ path: "src", dir: true }, { pane: true })).toEqual(["toggle", "pane", "root", "edit", "nvim", "copy", "close"]);
  expect(menuItems({ dir: false }).find((x: any) => x.act === "nvim").label).toBe("Open in Neovim");
});

test("the menu's key column fits its widest key", () => {
  expect(keyColumn(menuItems({ dir: false }))).toBe("enter".length * 7 + 14);
  expect(keyColumn([{ key: "v" }])).toBe(30);
  // Drawn at that width, every row's key cell the same.
  world.panes = [{ pane: "pf", tab: "t1", mod: "nocturne-files", props: { path: "/repo", slot: "s1" } }];
  const view = pane({ path: "/repo", slot: "s1" }, TREE);
  view.openMenu({ path: "README.md", name: "README.md", dir: false }, cx);
  const cells = walk(view.render()).filter((e: any) => e.nodes.length === 1 && ["enter", "e", "E", "v", "y", "q"].includes(e.nodes[0]));
  expect(cells.length).toBe(6);
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
  // The panel (no path of its own): q and esc are left alone; Neovim opens to its left.
  world.panes = [{ pane: "p1", tab: "t1", terminal: "x" }, { pane: "pp", tab: "t1", mod: "nocturne-files", props: { folder: "/repo" } }];
  const panel = pane({ folder: "/repo" }, TREE);
  commands.length = 0;
  panel.key({ key: "q" }, cx);
  panel.key({ key: "escape" }, cx);
  panel.sel = "README.md";
  panel.key({ key: "v" }, cx);
  panel.sel = "src";
  panel.key({ key: "o" }, cx);
  expect(commands).toEqual([
    ["terminal.open", { argv: ["nvim", "/repo/README.md"], folder: "/repo", place: "left", pane: "pp" }],
    ["files.open", { path: "/repo/src", pane: "p1" }],
  ]);
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
  expect(view.menu.items.map((x: any) => x.act)).toEqual(["pane", "edit", "nvim", "copy", "close"]);
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

// ---- the folders visited, narrow widths

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

