import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";

// The files pane's preview split: nocturne-files (main.js, logic.js) and the
// preview pane's viewer it mounts (its copy of nocturne-preview/viewer.js),
// with stand-ins for the app's modules (as nocturne-files.test.ts).
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
const byId = (el: any, id: string) => walk(el).find((e) => e.calls.some(([k, a]: [string, any[]]) => k === "id" && a[0] === id));
const handler = (el: any, name: string, button?: string) => el.calls.find(([k, a]: [string, any[]]) => k === name && (button == null || a[0] === button))?.[1].at(-1);
const words = (el: any) => walk(el).flatMap((e) => e.nodes.filter((n: any) => typeof n === "string"));
/** An element tree as plain data (what's drawn, not the handlers), to compare two renders. */
const shape = (el: any): any => (el && typeof el === "object" && "nodes" in el
  ? { kind: el.kind, arg: typeof el.arg === "string" ? el.arg : null, calls: el.calls.map(([k, a]: [string, any[]]) => [k, a.filter((x: any) => typeof x !== "function" && (typeof x !== "object" || x === null))]), nodes: el.nodes.map(shape) }
  : typeof el === "object" && el !== null ? "entity" : el);

const commands: [string, any][] = [];
const nativeCalls: [string, string, any][] = [];
const ran: { cmd: string; args: string[]; on: any }[] = [];
const world: any = {
  props: {}, panes: [], spaces: [], shared: {}, settings: { zoom: 1 }, focused: null, native: true,
  exec: async (_c: string, _a: string[], _o?: any) => ({ code: 1, stdout: "", stderr: "" }),
};
const theme = { background: "#080808", foreground: "#c6c6c6", hover: "#1c1c1c", ansi0: "#323437", ansi1: "#ff5454", ansi2: "#8cc85f", ansi3: "#e3c78a", ansi4: "#80a0ff", ansi5: "#cf87e8", ansi8: "#949494", ansi12: "#74b2ff", accent: "#80a0ff", muted: "#949494", dim: "#5F6D6D" };
const herdr: any = {
  props: () => world.props, theme: () => theme, settings: () => world.settings,
  exec: (cmd: string, args: string[], o?: any) => { ran.push({ cmd, args, on: o?.on ?? null }); return world.exec(cmd, args, o); },
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  panes: () => world.panes, spaces: () => world.spaces, terminals: () => [] as any[], focused: () => world.focused,
  shared: (k: string) => world.shared[k] ?? null, setShared: (k: string, v: any) => { world.shared[k] = v; return null; },
  findFiles: async () => ({ files: [], scanning: false }), readTextFile: async () => null, writeTextFile: async () => null,
  watchFolder: () => new Promise(() => {}), nextCommand: () => new Promise(() => {}), nextNativeViewEvent: () => Promise.reject(new Error("no events here")),
  home: () => "/home/me", appHome: () => "/home/me/.config/herdr-app", appWindow: () => ({ platform: "macos" }), window: () => ({ platform: "macos" }),
  // TOML (Cargo.lock): its keys and strings, as the app's highlighter marks them; elsewhere `fn`.
  highlight: (text: string, lang: string) => (lang === "toml"
    ? [...text.matchAll(/^\w+(?= =)|"[^"\n]*"/gm)].map((m) => [m.index!, m.index! + m[0].length, m[0][0] === '"' ? "string" : "property"])
    : [...text.matchAll(/\bfn\b/g)].map((m) => [m.index!, m.index! + 2, "keyword"])),
  languageOf: (p: string) => (p.endsWith(".rs") ? "rust" : p.endsWith(".ts") ? "typescript" : p.endsWith("Cargo.lock") ? "toml" : null),
  nativeView: { new: (id: string, props: any) => new Element("native", { id, props }) },
  nativeViewCapabilities: () => ({ available: world.native }),
  nativeViewCall: (id: string, action: string, args: any) => { nativeCalls.push([id, action, args]); return { content: {} }; },
};
const kit = {
  View: class {}, div: () => new Element(), svg: (p: string) => new Element("svg", p), image: (p: string) => new Element("image", p),
  PathBuilder: { fill: () => new Element() }, Background: { checkerboard: () => ({}) },
};
const input = () => {
  let v = ""; const on: Record<string, any> = {};
  const state: any = { on: (e: string, f: any) => { on[e] = f; }, value: () => v, set_value: (x: string) => { v = x; }, set_selected_range() {}, focus() {}, fire: (e: string) => on[e]?.({}, cx) };
  return state;
};
const base = {
  h_flex: () => new Element(), v_flex: () => new Element(), v_virtual_list: () => new Element(), Scrollbar: { vertical: () => new Element() },
  VirtualListScrollHandle: { new: () => ({ scroll_to_item() {} }) }, InputState: { new: input }, Input: { new: () => new Element("input") },
  TextView: { markdown: (id: string, text: string) => new Element("markdown", text) },
};

async function load(path: string, extra: Record<string, unknown> = {}): Promise<any> {
  const source = await readFile(new URL(`../defaults/mods/${path}`, import.meta.url), "utf8");
  const names: string[] = [];
  const body = source
    .replace(/^import [^;]*;\n/gm, "")
    .replace(/^export default class (\w+)/m, (_m, n) => { names.push(`default: ${n}`); return `class ${n}`; })
    .replace(/^export (async function|function|const|class) (\w+)/gm, (_m, kind, n) => { names.push(n); return `${kind} ${n}`; });
  const scope: Record<string, unknown> = { ...kit, ...base, ...herdr, herdr, ...extra, window: { paint_path: () => new Element() } };
  return new Function(...Object.keys(scope), `${body}\nreturn { ${names.join(", ")} };`)(...Object.values(scope));
}

const F = "nocturne-files";
const kinds = await load(`${F}/kinds.js`);
const imageLogic = await load(`${F}/image.js`, kinds);
const { parse: parseTable, ...tableRest } = await load(`${F}/table.js`);
const { parse: parsePatch, ...diffRest } = await load(`${F}/diff.js`);
const keyhelp = await load(`${F}/keyhelp.js`);
const shared = { ...kinds, ...imageLogic, ...tableRest, parseTable, ...diffRest, parsePatch, ...(await load(`${F}/keys.js`)), ...keyhelp };
const { default: Viewer } = await load(`${F}/viewer.js`, shared);
const logic = await load(`${F}/logic.js`);
const { default: Files } = await load(`${F}/main.js`, { ...logic, ...keyhelp, Viewer });
const { lookSide, lookSize, clampShare, dragShare, lookRoom, LOOK_MIN, DIVIDER, menuItems, KEYS } = logic;

// ---- a context: tasks run, timers wait until `tick()`, nested views record their props

const pending: Promise<void>[] = [];
let timers: { ms: number; f: (cx: any) => void }[] = [];
const entities: any[] = [];
const cx: any = {
  notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {}, is_focused: () => true }),
  spawn: (f: (cx: any) => Promise<void>) => { const p = f(cx); pending.push(p); return p; },
  timer: { every() {}, after: (ms: number, f: any) => { timers.push({ ms, f }); } },
  write_to_clipboard() {},
  new: (Class: any, props: any) => { const e = { Class, props, sets: [] as any[], set_props(p: any) { this.props = p; this.sets.push(p); } }; entities.push(e); return e; },
};
const settle = async () => { while (pending.length) await pending.shift(); };
/** Runs the timers due so far (and the ones they start, once). */
const tick = async () => { const due = timers; timers = []; for (const t of due) t.f(cx); await settle(); };

const TREE: Record<string, [string, boolean][]> = {
  "": [["src", true], ["docs", true], ["README.md", false], ["logo.png", false]],
  src: [...Array.from({ length: 12 }, (_, i) => [`m${String(i).padStart(2, "0")}.rs`, false] as [string, boolean])],
};

function pane(p: any = { path: "/repo", slot: "s1" }, entries = TREE) {
  world.panes = [{ pane: "pf", tab: "t1", mod: F, props: p }];
  const view: any = Object.create(Files.prototype);
  view.loadFolder = async () => {};
  view.refresh = () => {};
  world.props = p;
  view.init.call(view, p, cx);
  pending.length = 0;
  timers = [];
  for (const [k, list] of Object.entries(entries)) view.entries.set(k, list.map(([name, dir]) => ({ name, dir })));
  view.folders.add("src");
  return view;
}
const key = (view: any, k: string, modifiers: any = {}) => view.key({ key: k, modifiers }, cx);

// ---- the toggle

test("space, the toolbar's switch and the menu's entry turn the preview on and off; each pane keeps its own", async () => {
  world.shared = {};
  const view = pane();
  expect(view.lookState.on).toBe(false);
  key(view, "space");
  expect(view.lookState.on).toBe(true);
  expect(world.shared["nocturne-files.look"]).toEqual({ s1: { on: true, right: 0.5, bottom: 0.5 } });
  // The nested viewer, mounted once, embedded.
  expect(view.look.Class).toBe(Viewer);
  expect(view.look.props).toMatchObject({ embedded: true, path: null });
  // The toolbar's switch.
  view.size = { width: 400, height: 800 };
  handler(byId(view.render(cx), "nf-look-chip"), "on_click")({}, cx);
  expect(view.lookState.on).toBe(false);
  // The menu's entry, by its key and its label.
  view.openMenu({ path: "README.md", name: "README.md", dir: false }, cx);
  expect(view.menu.items.find((x: any) => x.act === "look")).toEqual({ key: "space", label: "Show the preview", act: "look" });
  key(view, "space");
  expect([view.menu, view.lookState.on]).toEqual([null, true]);
  expect(menuItems({ path: "", dir: true }, { look: true }).find((x: any) => x.act === "look").label).toBe("Hide the preview");
  // A pane opened again with that slot comes back with its preview; another slot doesn't.
  world.panes.push({ pane: "pg", tab: "t1", mod: F, props: { path: "/repo", slot: "s2" } });
  expect(pane({ path: "/repo", slot: "s1" }).lookState.on).toBe(true);
  expect(pane({ path: "/repo", slot: "s2" }).lookState.on).toBe(false);
  // Off: the native views go (a PDF or a clip left on screen would stay where it was drawn).
  const on = pane({ path: "/repo", slot: "s1" });
  nativeCalls.length = 0;
  key(on, "space");
  expect(nativeCalls.map(([id, a]) => `${id} ${a}`)).toEqual(["preview-pdf dispose", "preview-media dispose", "preview-quicklook dispose"]);
});

// ---- placement

test("taller than wide: at the bottom; wider than tall: at the right; near square it stays", () => {
  expect(lookSide({ width: 280, height: 900 })).toBe("bottom");
  expect(lookSide({ width: 1200, height: 700 })).toBe("right");
  expect(lookSide({ width: 610, height: 600 })).toBe("right");
  expect(lookSide({ width: 590, height: 600 })).toBe("bottom");
  // Near square, it keeps where it was: no flipping while a pane is dragged through.
  expect(lookSide({ width: 640, height: 600 }, "bottom")).toBe("bottom");
  expect(lookSide({ width: 600, height: 650 }, "right")).toBe("right");
  expect(lookSide({ width: 760, height: 600 }, "bottom")).toBe("right");
  expect(lookSide({ width: 500, height: 640 }, "right")).toBe("bottom");
});

test("drawn: the split follows the pane's shape, after a resize too", () => {
  world.shared = {};
  const view = pane();
  key(view, "space");
  const split = () => { const tree = view.render(cx); const s = byId(tree, "nf-split"); return { s, tree, kind: s && s.calls.some(([k]: [string]) => k === "h_full") }; };
  view.size = { width: 280, height: 900 };
  let tree = view.render(cx);
  const look = byId(tree, "nf-look");
  expect(view.side).toBe("bottom");
  // The panel: the preview under the tree, half the room under the header.
  expect(look.calls.find(([k]: [string]) => k === "h")[1]).toEqual([lookSize(view.size, "bottom", 0.5)]);
  expect(look.nodes).toContain(view.look);
  // Wider than tall now: it moves to the right.
  view.size = { width: 1200, height: 700 };
  tree = view.render(cx);
  expect(view.side).toBe("right");
  expect(byId(tree, "nf-look").calls.find(([k]: [string]) => k === "w")[1]).toEqual([lookSize(view.size, "right", 0.5)]);
  // Near square: stays right.
  view.size = { width: 650, height: 640 };
  view.render(cx);
  expect(view.side).toBe("right");
  expect(split().s).toBeTruthy();
  // The tree and its hint line are one column, the divider between.
  expect(byId(tree, "nf-treecol")).toBeTruthy();
  expect(byId(tree, "nf-divider")).toBeTruthy();
});

// ---- size

test("the divider drags, keys < > step; both parts keep their least", () => {
  world.shared = {};
  const view = pane();
  key(view, "space");
  view.size = { width: 1000, height: 600 };
  let tree = view.render(cx);
  handler(byId(tree, "nf-divider"), "on_mouse_down", "left")({}, cx);
  expect(view.dragging).toBe("right");
  const move = handler(tree, "on_mouse_move");
  move({ local_position: { x: 300, y: 200 } }, cx);
  expect(view.dragged).toBeCloseTo((1000 - 300 - DIVIDER / 2) / lookRoom(view.size, "right"), 5);
  // Past the tree's least: held there.
  move({ local_position: { x: 20, y: 200 } }, cx);
  expect(Math.round(lookRoom(view.size, "right") * (1 - view.dragged))).toBe(LOOK_MIN.right.tree);
  // Past the preview's least the other way.
  move({ local_position: { x: 990, y: 200 } }, cx);
  expect(Math.round(lookRoom(view.size, "right") * view.dragged)).toBe(LOOK_MIN.right.look);
  // Let go: kept for the pane.
  handler(tree, "on_mouse_up", "left")({}, cx);
  expect(view.dragging).toBeNull();
  expect(world.shared["nocturne-files.look"].s1.right).toBeCloseTo(LOOK_MIN.right.look / lookRoom(view.size, "right"), 5);
  // > grows it, < shrinks it, never past the least.
  const before = view.lookState.right;
  key(view, ">");
  expect(view.lookState.right).toBeCloseTo(before + 0.06, 5);
  for (let i = 0; i < 30; i++) key(view, ".", { shift: true });
  expect(Math.round(lookRoom(view.size, "right") * (1 - view.lookState.right))).toBe(LOOK_MIN.right.tree);
  for (let i = 0; i < 30; i++) key(view, "<");
  expect(Math.round(lookRoom(view.size, "right") * view.lookState.right)).toBe(LOOK_MIN.right.look);
  // The bottom keeps its own share.
  expect(view.lookState.bottom).toBe(0.5);
  // A pane too small for both: no split, the tree as it is.
  expect(clampShare({ width: 200, height: 220 }, "bottom", 0.5)).toBeNull();
  view.size = { width: 200, height: 220 };
  expect(byId(view.render(cx), "nf-split")).toBeFalsy();
  expect(dragShare({ width: 280, height: 900 }, "bottom", { x: 10, y: 450 })).toBeCloseTo((900 - 450 - DIVIDER / 2) / lookRoom({ width: 280, height: 900 }, "bottom"), 5);
});

// ---- following the selection

test("stepping over ten files quickly loads only the last; a folder shows what it holds", async () => {
  world.shared = {};
  const view = pane();
  key(view, "space");
  view.size = { width: 280, height: 900 };
  view.render(cx);
  await tick();
  const look = view.look;
  look.sets.length = 0;
  // src, then ten of its files, each step drawn (as the app draws after a key).
  view.sel = "src";
  view.render(cx);
  for (let i = 0; i < 10; i++) { key(view, "j"); view.render(cx); }
  expect(view.sel).toBe("src/m09.rs");
  // Nothing loaded while stepping: the waits are all pending.
  expect(look.sets).toEqual([]);
  expect(timers.every((t) => t.ms >= 60)).toBe(true);
  await tick();
  expect(look.sets.map((p: any) => p.path)).toEqual(["/repo/src/m09.rs"]);
  // The tree never waited: the keys above ran with nothing loaded.
  // A folder: its summary here, the viewer lets go.
  view.sel = "src";
  view.render(cx);
  await tick();
  expect(look.sets.at(-1).path).toBeNull();
  const tree = view.render(cx);
  expect(byId(tree, "nf-look-dir")).toBeTruthy();
  expect(words(tree)).toEqual(expect.arrayContaining(["DIR", "src", "0 folders · 12 files", "m00.rs"]));
});

test("J / K scroll the preview from the tree; the selection stays", async () => {
  world.shared = {};
  const view = pane();
  key(view, "space");
  view.sel = "README.md";
  view.render(cx);
  await tick();
  key(view, "J", { shift: true });
  key(view, "k", { shift: true });
  expect(view.sel).toBe("README.md");
  expect(view.look.sets.slice(-2).map((p: any) => p.scroll.dir)).toEqual([1, -1]);
  expect(view.look.sets.at(-1).scroll.n).toBeGreaterThan(view.look.sets.at(-2).scroll.n);
});

// ---- what the menu, the name row and the keys do with a preview open

test("the menu sets a native view aside while it's open; the key help sits in the tree's place; open keys still open", async () => {
  world.shared = {};
  world.spaces = [{ active: true, tabs: [{ id: "t1", active: true }] }];
  const view = pane();
  key(view, "space");
  view.size = { width: 1100, height: 700 };
  view.sel = "README.md";
  view.render(cx);
  await tick();
  nativeCalls.length = 0;
  key(view, "m");
  let tree = view.render(cx);
  expect(byId(tree, "nf-menu")).toBeTruthy();
  await tick();
  expect(nativeCalls.map(([id, a, args]) => [id, a, args.visible])).toEqual([["preview-pdf", "setVisible", false], ["preview-media", "setVisible", false], ["preview-quicklook", "setVisible", false]]);
  nativeCalls.length = 0;
  key(view, "escape");
  view.render(cx);
  await tick();
  expect(nativeCalls.map(([, , args]) => args.visible)).toEqual([true, true, true]);
  // ? : the keys where the tree was, the preview still beside; narrow as the tree is.
  key(view, "?");
  tree = view.render(cx);
  const col = byId(tree, "nf-treecol");
  expect(walk(col).some((e) => e.calls.some(([k, a]: [string, any[]]) => k === "id" && a[0] === "nf-keys-strip"))).toBe(true);
  expect(byId(tree, "nf-look").nodes).toContain(view.look);
  key(view, "?");
  // enter, p, e, v: as before, the preview is only a look.
  commands.length = 0;
  key(view, "enter");
  key(view, "p");
  view.sel = "logo.png";
  key(view, "p");
  expect(commands.map(([c, a]) => [c, a.path])).toEqual([["markdown.open", "/repo/README.md"], ["markdown.open", "/repo/README.md"], ["preview.open", "/repo/logo.png"]]);
  // The name row (a) and the delete question (d) are in the tree's column.
  view.sel = "README.md";
  key(view, "a");
  tree = view.render(cx);
  expect(words(byId(tree, "nf-treecol"))).toContain("create");
  expect(words(byId(tree, "nf-look"))).not.toContain("create");
  view.endDraft(cx);
});

test("with the preview off the pane draws as it did", async () => {
  world.shared = {};
  const plain = pane();
  plain.size = { width: 900, height: 700 };
  plain.sel = "README.md";
  const before = shape(plain.render(cx));
  const view = pane();
  view.size = { width: 900, height: 700 };
  view.sel = "README.md";
  key(view, "space");
  view.render(cx);
  await tick();
  key(view, "space");
  expect(shape(view.render(cx))).toEqual(before);
  expect(byId(view.render(cx), "nf-split")).toBeFalsy();
});

test("the new keys are in ? and fit the panel", () => {
  const listed = KEYS.map(([k]: [string]) => k);
  expect(listed).toEqual(expect.arrayContaining(["space", "J K", "< >"]));
  for (const [k, what] of KEYS) expect((k.length + what.length) * 7).toBeLessThan(280 - 40);
});

// ---- the viewer, embedded

const TEXT_HEAD = (args: string[]) => args[0] === "-c" && args[1].includes("tr -dc");
type Reply = { code: number; stdout: string; stderr?: string };
/** exec answers by what the viewer asks: the text head, the copy into the cache, the tool probe. */
function files(map: Record<string, { head?: Reply; copy?: Reply }>, tools = "") {
  world.exec = async (_cmd: string, args: string[]) => {
    const path = args[3];
    if (TEXT_HEAD(args)) return map[path]?.head ?? { code: 3, stdout: "", stderr: "" };
    if (args[1]?.includes("cksum <")) return map[path]?.copy ?? { code: 3, stdout: "" };
    if (args[1]?.includes("command -v")) return { code: 0, stdout: tools };
    if (args[1]?.includes("date -r")) return { code: 0, stdout: "5000\n1700000000\n00 00 00 18 66 74 79 70\n" };
    return { code: 1, stdout: "", stderr: "" };
  };
}
const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
const PNG = hex([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0, 0, 0, 1, 0, 8, 6, 0, 0, 0]);
const ascii = (s: string) => hex([...s].map((c) => c.charCodeAt(0)));

async function viewer(path: string, on: string | null = null) {
  const v: any = Object.create(Viewer.prototype);
  v.init({ embedded: true, path, on }, cx);
  await settle();
  v.port = { width: 600, height: 400 };
  return v;
}

test("each kind shows the way the preview shows it; text as the editor colors it, Markdown rendered", async () => {
  world.native = true;
  const rust = "fn main() {\n    println!(\"hi\");\n}\n";
  files({
    "/r/main.rs": { head: { code: 0, stdout: `${rust.length}\n0\n${rust}` } },
    "/r/notes.md": { head: { code: 0, stdout: `9\n0\n# Notes\n` } },
    "/r/logo.png": { copy: { code: 0, stdout: `11-99.png\n99\n${PNG}\n` } },
    "/r/paper.pdf": { copy: { code: 0, stdout: `12-50.pdf\n50\n${ascii("%PDF-1.7")}\n` } },
    "/r/Inter.ttf": { copy: { code: 0, stdout: `13-70.ttf\n70\n${hex([0, 1, 0, 0, 0, 12])}\n` } },
    "/r/data.csv": { head: { code: 0, stdout: "" } },
    "/r/clip.mp4": {},
  });
  // TEXT_HEAD for tables is the preview's own (wc -l): answered by the fallback below.
  const old = world.exec;
  world.exec = async (cmd: string, args: string[], o?: any) => (args[1]?.includes("wc -l") ? { code: 0, stdout: "12\n2\na,b\n1,2\n" } : old(cmd, args, o));
  const code = await viewer("/r/main.rs");
  expect([code.kind, code.how]).toEqual(["text", { how: "text" }]);
  const drawn = code.render(cx);
  expect(words(drawn)).toEqual(expect.arrayContaining(["RUST", "main.rs", "1", "fn", " main() {", "    println!(\"hi\");"]));
  // fn in the keyword's color.
  const fn = walk(drawn).find((e) => e.nodes[0] === "fn");
  expect(fn.calls.find(([k]: [string]) => k === "text_color")[1]).toEqual([theme.ansi5]);
  const md = await viewer("/r/notes.md");
  expect(md.how).toEqual({ how: "markdown" });
  expect(walk(md.render(cx)).find((e) => e.kind === "markdown").arg).toBe("# Notes\n");
  const png = await viewer("/r/logo.png");
  expect(png.how).toEqual({ how: "image" });
  expect(png.src).toBe("cache/nocturne-preview/11-99.png");
  expect(walk(png.render(cx)).some((e) => e.kind === "image")).toBe(true);
  const pdf = await viewer("/r/paper.pdf");
  expect(pdf.how).toEqual({ how: "native", view: "pdf" });
  expect(walk(pdf.render(cx)).find((e) => e.kind === "native").arg.id).toBe("preview-pdf");
  const font = await viewer("/r/Inter.ttf");
  expect(font.how).toEqual({ how: "native", view: "quicklook" });
  const csv = await viewer("/r/data.csv");
  expect(csv.how).toEqual({ how: "table" });
  const clip = await viewer("/r/clip.mp4");
  expect(clip.how).toEqual({ how: "native", view: "media" });
  // A clip passed over never plays: nothing asks the player to.
  expect(nativeCalls.filter(([, a]) => a === "media.play")).toEqual([]);
  // The embedded viewer has no keys of its own and doesn't take the keyboard.
  expect(handler(code.render(cx), "on_key_down")).toBeUndefined();
  // Without macOS views a PDF is pdftoppm's page, or says why in a line.
  world.native = false;
  const flat = await viewer("/r/paper.pdf");
  expect(flat.error).toBe("Showing a PDF here needs pdftoppm (poppler)");
  expect(words(flat.render(cx))).toContain("Showing a PDF here needs pdftoppm (poppler)");
  world.native = true;
  world.exec = old;
});

test("a big file shows its first part; a binary and an unreadable file say why in one line", async () => {
  const line = "let x = 1;\n";
  const big = line.repeat(256 * 1024 / line.length + 10);
  files({
    "/r/big.ts": { head: { code: 0, stdout: `${3 * 1024 * 1024}\n0\n${big.slice(0, 256 * 1024)}` } },
    "/r/a.out": { head: { code: 0, stdout: "18000\n240\n" } },
    "/r/secret.txt": { head: { code: 5, stdout: "" } },
    "/r/gone.txt": { head: { code: 3, stdout: "" } },
  });
  const b = await viewer("/r/big.ts");
  expect(b.note).toBe("first 256 KB of 3.0 MB");
  // Whole lines only.
  expect(b.text.body.endsWith("\n") || b.text.body.endsWith(";")).toBe(true);
  expect(words(b.render(cx))).toContain("first 256 KB of 3.0 MB");
  // J scrolls half a view, clamped at the end.
  b.scrollLook(1, cx);
  expect(b.sy).toBe(200);
  for (let i = 0; i < 5000; i++) b.scrollLook(1, cx);
  expect(b.sy).toBe(b.maxScroll());
  b.scrollLook(-1, cx);
  expect(b.sy).toBe(b.maxScroll() - 200);
  const bin = await viewer("/r/a.out");
  expect(bin.error).toBe("A binary file (18 KB): nothing to preview");
  expect(words(bin.render(cx))).toContain("A binary file (18 KB): nothing to preview");
  expect((await viewer("/r/secret.txt")).error).toBe("Can't read it: no permission");
  expect((await viewer("/r/gone.txt")).error).toBe("It isn't there (moved or deleted?)");
});

test("another machine: text is read there with a cap; a picture says so instead of fetching it", async () => {
  files({ "/srv/app.py": { head: { code: 0, stdout: "6\n0\nx = 1\n" } } });
  ran.length = 0;
  const py = await viewer("/srv/app.py", "box");
  expect(py.how).toEqual({ how: "text" });
  const head = ran.find((r) => TEXT_HEAD(r.args))!;
  expect([head.on, head.args.at(-1)]).toEqual(["box", String(256 * 1024)]);
  ran.length = 0;
  const pic = await viewer("/srv/shot.png", "box");
  expect(pic.error).toBe("On box: p opens this picture in the preview");
  expect(ran).toEqual([]);
});

test("stepped by props: another file loads, the native view of the last one goes, a folder clears it", async () => {
  world.native = true;
  files({
    "/r/paper.pdf": { copy: { code: 0, stdout: `12-50.pdf\n50\n${ascii("%PDF-1.7")}\n` } },
    "/r/other.pdf": { copy: { code: 0, stdout: `14-50.pdf\n50\n${ascii("%PDF-1.7")}\n` } },
    "/r/a.rs": { head: { code: 0, stdout: "3\n0\nfn\n" } },
  });
  const v = await viewer("/r/paper.pdf");
  nativeCalls.length = 0;
  // A PDF to a PDF: the same view loads the other one.
  v.update({ embedded: true, path: "/r/other.pdf", on: null });
  v.render(cx);
  await tick();
  expect(v.local).toBe("/home/me/.config/herdr-app/cache/nocturne-preview/14-50.pdf");
  expect(nativeCalls.filter(([, a]) => a === "dispose")).toEqual([]);
  // A PDF to code: the PDF view goes.
  v.update({ embedded: true, path: "/r/a.rs", on: null });
  v.render(cx);
  await tick();
  expect(nativeCalls.filter(([, a]) => a === "dispose").map(([id]) => id)).toEqual(["preview-pdf"]);
  expect(v.how).toEqual({ how: "text" });
  // Scroll and reload ride on the props.
  v.update({ embedded: true, path: "/r/a.rs", on: null, scroll: { n: 1, dir: 1 } });
  v.render(cx);
  await tick();
  expect(v.done.scroll).toBe(1);
  v.update({ embedded: true, path: null, on: null });
  v.render(cx);
  await tick();
  expect([v.path, v.how, v.text]).toEqual([null, null, null]);
});

/** What the app does with set_props on a nested view: it journals every
 *  object reachable from the view (to undo a failed update) and refuses past
 *  10,000 objects or 100,000 properties, then calls update. As
 *  vendor/gpui-kit/crates/shell (__checkpoint_view). */
function setProps(v: any, p: any) {
  const seen = new Set<any>(), pending: any[] = [v];
  let objects = 0, props = 0;
  while (pending.length) {
    const x = pending.pop();
    if (x === null || (typeof x !== "object" && typeof x !== "function") || seen.has(x)) continue;
    if (objects >= 10_000) throw new RangeError("a nested view update reached the 10,000-object rollback limit");
    seen.add(x); objects++;
    const d = Object.getOwnPropertyDescriptors(x), keys = Reflect.ownKeys(d);
    props += keys.length;
    if (props > 100_000) throw new RangeError("a nested view update reached the 100,000-property rollback limit");
    for (const k of keys) if ("value" in (d as any)[k]) pending.push((d as any)[k].value);
  }
  v.update(p);
}

/** A Cargo.lock as big as this repository's: 11k lines, 270 KB, TOML. */
function cargoLock() {
  let s = "# This file is automatically @generated by Cargo.\nversion = 4\n\n";
  for (let i = 0; s.length < 278_000; i++) {
    s += `[[package]]\nname = "crate-${i}"\nversion = "0.${i % 40}.${i % 7}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n`
      + `checksum = "${(i * 2654435761 >>> 0).toString(16).padStart(8, "0").repeat(8)}"\ndependencies = [\n "crate-${i + 1}",\n "crate-${i + 2}",\n]\n\n`;
  }
  return s;
}

test("after a big highlighted file (Cargo.lock), picking another file shows that file: the view stays light enough to take new props", async () => {
  const lock = cargoLock();
  expect(lock.split("\n").length).toBeGreaterThan(11_000);
  files({
    "/r/Cargo.lock": { head: { code: 0, stdout: `${lock.length}\n0\n${lock.slice(0, 256 * 1024)}` } },
    "/r/main.rs": { head: { code: 0, stdout: "3\n0\nfn\n" } },
  });
  const v = await viewer("/r/Cargo.lock");
  expect([v.how, v.text.lang, v.note]).toEqual([{ how: "text" }, "toml", "first 256 KB of 272 KB"]);
  // Drawn and scrolled, as Developer saw it.
  v.render(cx);
  v.wheel({ delta: { y: -400 }, modifiers: {} }, cx);
  v.render(cx);
  await tick();
  // The tree's selection moves on: the next file replaces it.
  setProps(v, { embedded: true, path: "/r/main.rs", on: null });
  v.render(cx);
  await tick();
  expect([v.path, v.how, v.text.lang, v.sy]).toEqual(["/r/main.rs", { how: "text" }, "rust", 0]);
  expect(words(v.render(cx))).toContain("main.rs");
  // A long table the same: its rows don't hold the next file up.
  const csv = "id,name\n" + Array.from({ length: 6000 }, (_, i) => `${i},row ${i}`).join("\n") + "\n";
  const old = world.exec;
  world.exec = async (cmd: string, args: string[], o?: any) => (args[1]?.includes("wc -l") ? { code: 0, stdout: `${csv.length}\n6001\n${csv}` } : old(cmd, args, o));
  setProps(v, { embedded: true, path: "/r/big.csv", on: null });
  v.render(cx);
  await tick();
  expect([v.how, v.grid.body.length]).toEqual([{ how: "table" }, 6000]);
  setProps(v, { embedded: true, path: "/r/main.rs", on: null });
  v.render(cx);
  await tick();
  expect(v.path).toBe("/r/main.rs");
  // A file whose reading breaks says so in one line; the next one still loads.
  world.exec = async (cmd: string, args: string[], o?: any) => (args[3] === "/r/odd.txt" ? { code: 0, stdout: null } : old(cmd, args, o));
  setProps(v, { embedded: true, path: "/r/odd.txt", on: null });
  v.render(cx);
  await tick();
  expect(v.error).toStartWith("Can't show it: ");
  expect(words(v.render(cx))).toContain(v.error);
  setProps(v, { embedded: true, path: "/r/main.rs", on: null });
  v.render(cx);
  await tick();
  expect([v.path, v.error, v.how]).toEqual(["/r/main.rs", null, { how: "text" }]);
  world.exec = old;
});

test("the shared kinds: text and Markdown for the split, the preview's own kinds unchanged", () => {
  const { lookKind, kindOf, lineRuns, lineStarts, syntaxColors } = kinds;
  expect(["a.rs", "README.md", "x.png", "Makefile", "doc.markdown"].map(lookKind)).toEqual(["text", "markdown", "image", "text", "markdown"]);
  expect([kindOf("a.rs"), kindOf("README.md")]).toEqual([null, null]);
  const text = "fn a() {}\n\tfn b\n";
  const starts = lineStarts(text);
  const spans = [[0, 2, "keyword"], [11, 13, "keyword"]];
  expect(lineRuns(text, starts, spans, 1, syntaxColors(theme))).toEqual([["  ", null], ["fn", theme.ansi5], [" b", null]]);
  expect(lineRuns(text, starts, spans, 2, syntaxColors(theme))).toEqual([]);
});

test("code wraps to the preview's width: a narrow panel shows whole lines, the number on a line's first row only", async () => {
  const { wrapRows, rowLine, sliceRuns, lineStarts } = kinds;
  const text = "short\n" + "x".repeat(25) + "\n\tab\n";
  const starts = lineStarts(text);
  expect(wrapRows(text, starts, 10)).toEqual([0, 1, 4, 5, 6]);
  expect([rowLine([0, 1, 4, 5, 6], 0), rowLine([0, 1, 4, 5, 6], 3), rowLine([0, 1, 4, 5, 6], 4)]).toEqual([[0, 0], [1, 2], [2, 0]]);
  expect(sliceRuns([["abc", "red"], ["defg", null]], 2, 5)).toEqual([["c", "red"], ["de", null]]);
  const long = "fn main() { let answer = compute_the_answer_to_everything(); }\n";
  files({ "/r/w.rs": { head: { code: 0, stdout: `${long.length}\n0\n${long}` } } });
  const v = await viewer("/r/w.rs");
  v.port = { width: 280, height: 400 };
  const drawn = v.render(cx);
  const shown = words(drawn).join("");
  // Every character is drawn, over several rows; one line number.
  expect(shown.replace(/\s+/g, "")).toContain(long.trim().replace(/\s+/g, ""));
  expect(v.wrapped().rows).toBeGreaterThan(1);
  expect(words(drawn).filter((w: string) => w === "1").length).toBe(1);
  // Wide: a row a line (the text's last, empty line too).
  v.port = { width: 1200, height: 400 };
  expect(v.wrapped().rows).toBe(2);
});

test("the divider lights under the pointer and while held", () => {
  world.shared = {};
  const view = pane();
  key(view, "space");
  view.size = { width: 1000, height: 600 };
  const band = () => byId(view.render(cx), "nf-divider").nodes[0].calls.find(([k]: [string]) => k === "w")[1][0];
  expect(band()).toBe(1);
  handler(byId(view.render(cx), "nf-divider"), "on_hover")(true, cx);
  expect(band()).toBe(DIVIDER - 2);
  handler(byId(view.render(cx), "nf-divider"), "on_hover")(false, cx);
  expect(band()).toBe(1);
  handler(byId(view.render(cx), "nf-divider"), "on_mouse_down", "left")({}, cx);
  expect(band()).toBe(DIVIDER - 2);
});

// ---- clicks: a click selects, a double click opens

test("a click on a file selects it and opens nothing; a double click opens it as a click did; alt-double-click the other way", async () => {
  world.shared = {};
  world.spaces = [{ active: true, tabs: [{ id: "t1", active: true }] }];
  const view = pane();
  world.panes.push({ pane: "p1", tab: "t1", terminal: "x" });
  const edits: string[] = [];
  view.edit = (path: string) => edits.push(path);
  const click = (path: string, alt = false) => { view.alt = alt; view.pick(path, cx); view.alt = false; };
  commands.length = 0;
  // One click: selected, the keyboard here, nothing opened.
  click("src/m00.rs");
  click("README.md");
  click("logo.png");
  expect([commands, edits, view.sel]).toEqual([[], [], "logo.png"]);
  // Double clicks: what one click did until now.
  click("src/m00.rs"); click("src/m00.rs");
  click("README.md"); click("README.md");
  click("logo.png"); click("logo.png");
  expect(edits).toEqual(["src/m00.rs"]);
  expect(commands.map(([c, a]) => [c, a.path, a.in ?? null])).toEqual([["markdown.open", "/repo/README.md", null], ["preview.open", "/repo/logo.png", null]]);
  // alt-double-click: Markdown as text, a picture in the system's app; a text file is edited either way.
  commands.length = 0; edits.length = 0;
  click("README.md", true); click("README.md", true);
  click("logo.png", true); click("logo.png", true);
  click("src/m00.rs", true); click("src/m00.rs", true);
  expect(edits).toEqual(["README.md", "src/m00.rs"]);
  expect(commands).toEqual([["preview.open", { path: "/repo/logo.png", in: "system" }]]);
  // A slow second click (past the double-click time) is two selects; a third quick click after a double selects again.
  commands.length = 0; edits.length = 0;
  click("logo.png");
  view.lastClick.at -= 1000;
  click("logo.png");
  expect(commands).toEqual([]);
  click("logo.png");
  expect(commands.length).toBe(1);
  click("logo.png");
  expect(commands.length).toBe(1);
  // With the preview on, a click is what the preview follows.
  key(view, "space");
  view.render(cx);
  click("README.md");
  view.render(cx);
  await tick();
  expect(view.look.props.path).toBe("/repo/README.md");
  expect(commands.length).toBe(1);
});

test("a folder: a click folds it, a double click opens it in $EDITOR with its fold as it was", () => {
  world.shared = {};
  const view = pane();
  const terminal: string[] = [];
  view.edit = (path: string) => terminal.push(path);
  view.folders.delete("src");
  view.pick("docs", cx);
  expect(view.folders.has("docs")).toBe(true);
  view.lastClick.at -= 1000;
  view.pick("docs", cx);
  expect(view.folders.has("docs")).toBe(false);
  expect(terminal).toEqual([]);
  view.pick("src", cx);
  view.pick("src", cx);
  expect([view.folders.has("src"), terminal]).toEqual([false, ["src"]]);
});
