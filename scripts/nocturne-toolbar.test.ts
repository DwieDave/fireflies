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
  focus_handle: () => ({ focus() {}, is_focused: () => true }), timer: { every() {}, after() {} }, bind_keys() {},
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

test("+ new menu: no tile floats over the tab; the rest in 4 columns, in order, the short row padded", () => {
  const { rows, letters } = menuGrid();
  expect(rows).toEqual([["terminal", "web", "files", "agents"], ["usage", "pad", "pad", "pad"]]);
  // Each keeps its letter.
  expect(letters).toEqual({ terminal: "t", web: "w", files: "f", agents: "a", usage: "u" });
  // Nothing on a tile says "float"; files still says it runs down the edge.
  const tileWords = rows.flat().filter((id) => id !== "pad").flatMap((id) => words(ids[`nm-${id}`]));
  expect(tileWords).not.toContain("float");
  expect(tileWords).toContain("edge");
  expect(menuPanels().every((p: any) => p.fixed !== "float")).toBe(true);
});

test("+ new menu: its height has room for the two rows of tiles it shows", () => {
  sharedState["new-menu.agents"] = { "": [] };
  const h = newmenu.newMenuHeight();
  // head, section, 2 rows of 64 and a gap, section, one agent row, section, 3 rows, padding, foot, border.
  expect(h).toBe(44 + 24 + 2 * 64 + 4 + 24 + 26 + 24 + 3 * 26 + 8 + 26 + 2);
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
