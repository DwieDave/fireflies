// The tab strip's toolbar: the "+ new" menu's tiles (no panels that float
// over the tab; Git, its diff, worktrees and GitHub open other ways), the
// tools row's order with "+ new" last, right of the bell, in a block of its
// own, and its menu hanging inside the window at the right edge. herdr and
// gpui stand-ins that record each element by id (mock.module is
// process-wide: this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";

// ---- stand-ins

class El {
  kids: any[] = [];
  on: Record<string, Function> = {};
  calls: Record<string, any[][]> = {};
  elId: string | null = null;
  constructor(public tag?: string) {
    return new Proxy(this, {
      get: (t, k: string, proxy) => k in t ? (t as any)[k] : k === "then" ? undefined : (...a: any[]) => {
        (t.calls[k] ??= []).push(a);
        if (k === "id") { t.elId = a[0]; ids[a[0]] = proxy; }
        else if (k === "child") t.kids.push(a[0]);
        else if (k === "children") t.kids.push(...a[0]);
        else if (k === "when") { if (a[0]) a[1](proxy); }
        else if (k === "map") return a[0](proxy);
        else if (k === "on_mouse_down") t.on[`down:${a[0]}`] = a[1];
        else if (k === "on_click") t.on.click = a[0];
        else if (k === "on_size_change") t.on.size = a[0];
        return proxy;
      },
    });
  }
}
let ids: Record<string, any> = {};
/** The words under an element, depth first. */
const words = (e: any): string[] => typeof e === "string" ? [e] : e?.kids ? e.kids.flatMap(words) : [];

let sharedState: Record<string, unknown> = {};
let overlays: any[] = [];
let ran: [string, any][] = [];
let waiting: ((v: string) => void)[] = [];
let propsNow: any = null;
const bellBlock = { id: "notify", type: "block", size: { px: 28 }, content: { mod: "nocturne-notifications", props: { role: "bell", end: 0 } } };
const newBlock = { id: "new", type: "block", size: { px: 62 }, content: { mod: "nocturne", props: { role: "newbutton" } } };
/** The nocturne layout; `row`: the tab row's blocks after the strip. */
const layoutWith = (row: any[]) => ({
  id: "root", type: "row", children: [
    { id: "sidebar", type: "block", content: { mod: "nocturne", props: { role: "sky" } } },
    { id: "work", type: "column", children: [
      { id: "tab-row", type: "row", children: [{ id: "tabs", type: "block", content: { mod: "nocturne", props: { role: "tabs" } } }, ...row] },
      { id: "main", type: "block", content: { tab: "active" } },
    ] },
  ],
});
let LAYOUT: any = layoutWith([bellBlock, newBlock]);
let FOCUSED: any = { space: "s1", tab: "t1", pane: "p1", terminal: "a/1" };
const herdr: Record<string, any> = {
  agents: () => [], appHome: () => "/tmp/app", closeOverlay: () => {}, commands: () => [],
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => FOCUSED,
  hc: async () => ({ code: 1, stdout: "" }), home: () => "/home/a", keys: () => [{ section: "global", action: "space.new", keys: "cmd-shift-n" }],
  knownAgents: async () => [], layout: () => LAYOUT, layouts: () => ["nocturne"],
  nextCommand: () => new Promise<string>((r) => waiting.push(r)),
  notify: () => {}, openOverlay: (spec: any) => { const id = `o${overlays.length + 1}`; overlays.push({ ...spec, id }); return id; },
  panes: () => [{ pane: "p1", tab: "t1", terminal: "a/1", focused: true, cwd: "/home/a" }], pickFolder: async () => null,
  presentUpdateNotes: () => {}, props: () => propsNow, run: (name: string, args: any) => { ran.push([name, args]); return null; },
  setAgentOrder: () => {}, setShared: (k: string, v: unknown) => { sharedState[k] = v; }, settings: () => ({ zoom: 0.9 }),
  shared: (k: string) => sharedState[k] ?? null,
  spaces: () => [{ id: "s1", name: "one", active: true, folder: "/home/a", machine: "", tabs: [{ id: "t1", index: 1, active: true, name: "1" }] }],
  terminals: () => [], theme: () => theme, updates: () => null, window: () => ({ platform: "macos" }),
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: (path: string) => new El(`svg:${path}`), image: () => new El(), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} }
mock.module("gpui-base", () => ({
  h_flex: () => new El(), v_flex: () => new El(), v_virtual_list: () => new El(), Scrollbar: { new: () => new El() },
  InputState: { new: () => new Input() }, Input: { new: () => new El() },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) }, VirtualListScrollHandle: { new: () => ({}) },
}));
(globalThis as any).window = { paint_path: () => new El("dither"), viewport_size: () => ({ width: 1600, height: 1000 }) };
const theme: any = new Proxy({}, { get: (_t, k) => String(k) });
const cx: any = {
  spawn: (f: Function) => { Promise.resolve().then(() => f(cx)).catch(() => {}); }, notify() {}, stop_propagation() {},
  focus_handle: () => ({ focus() {}, is_focused: () => true }), timer: { every() {}, after() {} }, bind_keys() {}, new: () => ({ set_props() {} }),
};

const newmenu = await import("../defaults/mods/nocturne/newmenu.js");
const { default: NewMenu, menuPanels, WIDTH: NEW_W } = newmenu;
const { panels } = await import("../defaults/mods/nocturne/panels.js");
const { default: Tabs } = await import("../defaults/mods/nocturne/tabs.js");
const { menuItems } = await import("../defaults/mods/nocturne/menu.js");
const { readFileSync } = await import("node:fs");

beforeEach(() => {
  sharedState = {}; overlays = []; ran = []; waiting = []; ids = {}; propsNow = null;
  LAYOUT = layoutWith([bellBlock, newBlock]);
  FOCUSED = { space: "s1", tab: "t1", pane: "p1", terminal: "a/1" };
});

// ---- 1. the menu's tiles

/** The menu, drawn: its grid's rows as [tile id or "pad"], and each tile's
 *  letter (the last word of its 12 px strip along the top). */
function menuGrid() {
  propsNow = { overlay: "o1", role: "new" };
  const m: any = new NewMenu();
  m.init({ role: "new" }, cx);
  ids = {};
  m.render(cx);
  const rows = Object.keys(ids).filter((id) => id.startsWith("nm-grid-")).sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)))
    .map((id) => ids[id].kids.map((k: any) => k.elId.startsWith("nm-pad-") ? "pad" : k.elId.slice(3)));
  const letters = Object.fromEntries(rows.flat().filter((id) => id !== "pad").map((id) => [id, words(ids[`nm-${id}`].kids.find((k: any) => k.calls?.h?.[0]?.[0] === 12)).at(-1)]));
  return { m, rows, letters };
}

test("+ new menu: no tile floats over the tab; the five others in one row, in order, none alone on a row", () => {
  const { rows, letters } = menuGrid();
  expect(rows).toEqual([["terminal", "web", "files", "agents", "usage"]]);
  // Each keeps its letter.
  expect(letters).toEqual({ terminal: "t", web: "w", files: "f", agents: "a", usage: "u" });
  // No tile carries a spot label: not "float", and Files not "edge" (it opens a pane of its own).
  const tileWords = rows.flat().filter((id) => id !== "pad").flatMap((id) => words(ids[`nm-${id}`]));
  expect(tileWords).not.toContain("float");
  expect(tileWords).not.toContain("edge");
  expect(words(ids["nm-files"]).filter(Boolean)).toEqual(["f", "Files"]);
  expect(menuPanels().every((p: any) => !p.fixed)).toBe(true);
});

test("+ new menu: its height has room for the one row of tiles it shows", () => {
  sharedState["new-menu.agents"] = { "": [] };
  const h = newmenu.newMenuHeight();
  // head, section, a row of 64, section, one agent row, section, 3 rows, padding, foot, border.
  expect(h).toBe(44 + 24 + 64 + 24 + 26 + 24 + 3 * 26 + 8 + 26 + 2);
});

test("+ new menu: each of the five tiles is wide enough for its name (Terminal, 8 letters, ~56 px at 11 px)", () => {
  // The grid's room: the menu less its padding, less four gaps; then each tile's own padding and border.
  const inside = (NEW_W - 2 * 12 - 4 * 4) / 5 - 2 * 5 - 2;
  expect(inside).toBeGreaterThanOrEqual(56);
});

test("+ new menu: ← → walk the row, ↓ from a tile leaves the grid for the agents", () => {
  const { m } = menuGrid();
  const kx: any = { stop_propagation() {}, notify() {} };
  const live = [0, 1, 2, 3, 4].map((i) => ({ kind: "tile", id: `t${i}` })).concat([{ kind: "agent", id: "a1" } as any]);
  m.cursor = 0;
  for (let i = 1; i <= 4; i++) { m.key({ key: "right", modifiers: {} }, kx, live); expect(m.cursor).toBe(i); }
  m.cursor = 2;
  m.key({ key: "down", modifiers: {} }, kx, live);
  expect(m.cursor).toBe(5);
  m.key({ key: "up", modifiers: {} }, kx, live);
  expect(m.cursor).toBe(4);
});

test("+ new menu: the floating panels' letters pick nothing there (g l d h)", () => {
  const { m } = menuGrid();
  const live = [];
  for (const k of ["g", "l", "d", "h"]) {
    let stopped = false;
    const kx: any = { stop_propagation() { stopped = true; }, notify() {} };
    m.key({ key: k, key_char: k, modifiers: {} }, kx, live);
    expect(stopped).toBe(false);
  }
  expect(ran).toEqual([]);
});

test("Git, its diff, worktrees and GitHub still open: the strip's git ▾, keys and the palette", () => {
  // The palette lists every panel, floating ones too (palette.js openEntries goes over panels()).
  const all = panels().map((p: any) => p.id);
  for (const id of ["git", "diff", "worktrees", "github"]) expect(all).toContain(id);
  // The strip's git ▾ (menu.js, tab "git"): each runs its command.
  const git = menuItems(theme, { tab: "git" });
  expect(git.map((x: any) => x.id)).toEqual(["git", "diff", "worktrees", "github"]);
  for (const x of git) x.go();
  expect(ran.map(([n]) => n)).toEqual(["nocturne.git", "nocturne.diff", "nocturne.worktrees", "nocturne.github"]);
  // Keys: cmd-g Git, cmd-shift-g GitHub (keys.macos.json); the git button itself toggles Git.
  const keysFile = readFileSync(new URL("../defaults/keys.macos.json", import.meta.url), "utf8");
  expect(keysFile).toContain('"cmd-g": "nocturne.git"');
  expect(keysFile).toContain('"cmd-shift-g": "nocturne.github"');
  // The menu's own space rows still make and open worktrees.
  const { m } = menuGrid();
  void m;
  expect(ids["nm-wt-new"]).toBeTruthy();
  expect(ids["nm-wt-open"]).toBeTruthy();
});

// ---- 2. "+ new" last, right of the bell

const { default: NewButton } = await import("../defaults/mods/nocturne/newbutton.js");
const { default: Bell } = await import("../defaults/mods/nocturne-notifications/bell.js");
const { default: Nocturne } = await import("../defaults/mods/nocturne/main.js");
const shipped = JSON.parse(readFileSync(new URL("../defaults/layouts/nocturne.json", import.meta.url), "utf8"));

function strip() {
  const s: any = new Tabs();
  s.init({ role: "tabs" }, cx);
  ids = {};
  s.render(cx);
  return s;
}
function newButton() {
  propsNow = { role: "newbutton" };
  const b: any = new NewButton();
  b.init({ role: "newbutton" }, cx);
  ids = {};
  b.render(cx);
  return b;
}

test("the shipped nocturne layout: the tab row is the strip, the bell, then \"+ new\" (the bell leaves the end room to it)", () => {
  const row = shipped.children[1].children[0];
  expect(row.id).toBe("tab-row");
  expect(row.children.map((c: any) => c.content.props.role)).toEqual(["tabs", "bell", "newbutton"]);
  expect(row.children[1].content.props.end).toBe(0);
  expect(row.children[2]).toMatchObject({ id: "new", content: { mod: "nocturne" }, window_drag: true });
  // The nocturne mod has the role.
  propsNow = { role: "newbutton" };
  const n: any = new Nocturne();
  n.init({ role: "newbutton" }, cx);
  expect(n.role).toBeInstanceOf(NewButton);
});

test("the tools row, left to right: run, files, git, git's menu, bell, + new; the strip itself no longer draws + new", () => {
  const s = strip();
  expect(s.rows.tabs.map((x: any) => x.id)).toEqual(["tab:t1", "tab-scripts-run", "tab-files", "tab-git", "tab-git-more", "bell", "tab-new"]);
  expect(ids["tab-new"]).toBeUndefined();
  expect(ids["tab-git-more"]).toBeTruthy();
  // The keyboard's next from the bell is + new, and its enter opens the menu centered.
  s.row = "tabs"; s.cursor = "bell";
  s.key({ key: "right", modifiers: {} }, cx);
  expect(s.cursor).toBe("tab-new");
  s.item().go();
  expect(overlays.at(-1)).toMatchObject({ mod: "nocturne", kind: "dialog", props: { role: "new" } });
});

test("a layout without the + new block (an edited older copy): the strip draws + new before the bell, as before", () => {
  LAYOUT = layoutWith([{ ...bellBlock, content: { mod: "nocturne-notifications", props: { role: "bell" } } }]);
  const s = strip();
  expect(s.rows.tabs.map((x: any) => x.id).slice(-2)).toEqual(["tab-new", "bell"]);
  expect(ids["tab-new"]).toBeTruthy();
  // A hidden block counts as none.
  LAYOUT = layoutWith([bellBlock, { ...newBlock, hidden: true }]);
  expect(strip().rows.tabs.map((x: any) => x.id).slice(-2)).toEqual(["tab-new", "bell"]);
});

test("+ new's block: the strip's cursor on it draws its ring there (shared CURSOR, region new)", () => {
  const s = strip();
  s.row = "tabs"; s.cursor = "tab-new";
  s.tell(true);
  expect(sharedState["nocturne.chrome"]).toEqual({ region: "new", item: "tab-new" });
  newButton();
  const ring = (id: string) => ids[id].kids.some((k: any) => (k.calls?.border_color ?? []).some(([c]: any) => c === "accent"));
  expect(ring("tab-new")).toBe(true);
  sharedState["nocturne.chrome"] = { region: "bell", item: "bell" };
  newButton();
  expect(ring("tab-new")).toBe(false);
});

test("+ new's block sizes itself to its rule and button plus the 8 px end; the bell before it keeps none", () => {
  newButton();
  ids["new-tools"].on.size({ width: 53 * 0.9, height: 24 });
  expect(ran.at(-1)).toEqual(["layout.resize", { id: "new", px: 53 + 8 }]);
  // The block ends with the end room.
  expect(ids["new-block"].calls.pr[0][0]).toBe(8);
  // The bell, followed by it: no room after the bell.
  propsNow = { role: "bell", end: 0 };
  const b: any = new Bell();
  b.init({ role: "bell" }, cx);
  ids = {};
  b.render(cx);
  expect(ids["notify-bell"].calls.pr[0][0]).toBe(0);
});

/** A press on "+ new" at the window's right edge (its right 8 px in, at zoom 0.9), in a window `width` wide. */
function pressNew(width: number) {
  const z = 0.9, w = 46 * z;
  const right = width - 8 * z;
  const e = { position: { x: right - w + 10, y: 18 }, local_position: { x: 10, y: 6 }, bounds: { width: w, height: 24 * z } };
  newButton();
  ids["tab-new"].on["down:left"](e, cx);
  ids["tab-new"].on.click({}, cx);
  return { right, z };
}

for (const width of [700, 1600, 2560]) {
  test(`+ new's menu hangs under it, its right edge on the button's, inside a ${width} px window`, () => {
    const { right, z } = pressNew(width);
    const o = overlays.at(-1);
    expect(o).toMatchObject({ mod: "nocturne", kind: "popup", width: NEW_W, props: { role: "new" } });
    expect(o.at.x).toBe(Math.round(right - NEW_W * z));
    expect(o.at.x).toBeGreaterThanOrEqual(8);
    expect(o.at.x + NEW_W * z).toBeLessThanOrEqual(width - 8 * z + 0.5);
    // Its top just under the button (the strip's horizon).
    expect(o.at.y).toBe(Math.round(18 - 6 + 24 * z + 6 * z));
  });
}

test("+ new's menu in a window narrower than the menu stays 8 px in from the left", () => {
  pressNew(300);
  expect(overlays.at(-1).at.x).toBe(8);
});

test("+ new is lit while its menu is open and a second press closes it", () => {
  pressNew(1600);
  newButton();
  expect(ids["tab-new"].kids.some((k: any) => k?.tag === "dither")).toBe(true);
  expect(newmenu.newMenuOpen()).toBe(true);
  // The press on a lit button: the menu closes (the popup's backdrop), and the click keeps it closed.
  ids["tab-new"].on["down:left"]({}, cx);
  ids["tab-new"].on.click({}, cx);
  expect(newmenu.newMenuOpen()).toBe(false);
});

// ---- 5. Files: a files pane of its own, not the docked panel

/** The menu's live tiles, as its key handler gets them. */
const liveTiles = () => menuPanels().map((p: any) => ({ kind: "tile", id: p.id, p, key: p.key }));
const DOCK = (r: [string, any]) => r[0] === "pane.split" && r[1]?.edge === "right" && r[1]?.mod === "nocturne-files";

test("+ new > Files with \"pane\": a files pane beside the focused pane, at the folder a terminal would get; never the docked panel", () => {
  const { m } = menuGrid();
  const tiles = liveTiles();
  const files = tiles.find((x: any) => x.id === "files")!;
  m.pick(tiles.find((x: any) => x.id === "terminal"), "pane");
  const folder = ran.find(([n]) => n === "terminal.open")![1].folder;
  expect(folder).toBeTruthy();
  ran = [];
  m.pick(files, "pane");
  expect(ran).toEqual([["files.open", { path: folder, pane: "p1" }]]);
  // Picked again: another files.open (the app focuses the one already rooted there), no toggle.
  m.pick(files, "pane");
  expect(ran.map(([n]) => n)).toEqual(["files.open", "files.open"]);
  expect(ran.some(DOCK)).toBe(false);
  expect(ran.some(([n]) => n === "pane.close")).toBe(false);
});

test("+ new > Files with \"new tab\": a files pane in a tab of its own; shift (f / enter) does the other", () => {
  const { m } = menuGrid();
  const live = liveTiles();
  m.pick(live.find((x: any) => x.id === "files"), "tab");
  expect(ran.at(-1)).toEqual(["files.open", { path: expect.any(String), in: "tab" }]);
  const kx: any = { stop_propagation() {}, notify() {} };
  // The switch on "pane": shift-f opens it in a tab.
  ran = [];
  m.key({ key: "f", key_char: "F", modifiers: { shift: true } }, kx, live);
  expect(ran).toEqual([["files.open", { path: expect.any(String), in: "tab" }]]);
  // The switch on "new tab": shift-f opens it beside the focused pane.
  sharedState["nocturne.newDest"] = "tab";
  ran = [];
  m.key({ key: "f", key_char: "F", modifiers: { shift: true } }, kx, live);
  expect(ran).toEqual([["files.open", { path: expect.any(String), pane: "p1" }]]);
  ran = [];
  m.key({ key: "f", key_char: "f", modifiers: {} }, kx, live);
  expect(ran[0][1].in).toBe("tab");
  expect(ran.some(DOCK)).toBe(false);
});

test("+ new > Files: no corner mark or \"close\" while the docked panel is open, and the footer says where it opens", () => {
  // The docked panel open in the shown tab.
  const docked = { pane: "p9", tab: "t1", mod: "nocturne-files", props: { folder: "/home/a" } };
  const was = herdr.panes;
  herdr.panes = () => [...was(), docked];
  try {
    const { m } = menuGrid();
    const files = liveTiles().find((x: any) => x.id === "files");
    expect(words(ids["nm-files"])).not.toContain("open");
    expect(words(ids["nm-files"])).not.toContain("close");
    expect(m.say(files, "pane")).toBe("files in a new pane");
    expect(m.say(files, "tab")).toBe("files in a new tab");
  } finally { herdr.panes = was; }
});

test("the toolbar's files button and cmd-e (nocturne.files) still toggle the docked panel", async () => {
  const s = strip();
  ids["tab-files"].on["down:left"]({}, cx);
  ids["tab-files"].on.click({}, cx);
  expect(ran.filter(DOCK)).toHaveLength(1);
  ran = [];
  const { default: Sky } = await import("../defaults/mods/nocturne/sky.js");
  const sky: any = new Sky();
  sky.init({ role: "sky" }, cx);
  await new Promise((r) => setTimeout(r, 0));
  const w = waiting; waiting = [];
  for (const f of w) f("nocturne.files");
  await new Promise((r) => setTimeout(r, 0));
  expect(ran.filter(DOCK)).toHaveLength(1);
  void s;
});
