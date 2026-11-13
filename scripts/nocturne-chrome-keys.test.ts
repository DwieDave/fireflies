// Nocturne's chrome by keyboard: nav.js on its own, then the sidebar (sky.js)
// and the tab strip (tabs.js) driven through their key handlers, with herdr
// and gpui stand-ins (mock.module is process-wide: this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";

// ---- stand-ins

let sharedState: Record<string, unknown> = {};
let spacesNow: any[] = [];
let panesNow: any[] = [];
let agentsNow: any[] = [];
let focusedNow: any = null;
let propsNow: any = null;
let commands: [string, any][] = [];
let overlays: any[] = [];
let closed: any[] = [];
let queue: string[] = [];
let waiting: ((v: string) => void)[] = [];

const LAYOUT = {
  id: "root", type: "row", children: [
    { id: "sidebar", type: "block", content: { mod: "nocturne", props: { role: "sky" } } },
    { id: "work", type: "column", children: [
      { id: "tab-row", type: "row", children: [
        { id: "tabs", type: "block", content: { mod: "nocturne", props: { role: "tabs" } } },
        { id: "notify", type: "block", content: { mod: "notifications", props: { role: "bell" } } },
      ] },
      { id: "main", type: "block", content: { tab: "active" } },
    ] },
  ],
};

const herdr: Record<string, any> = {
  agents: () => agentsNow, appHome: () => "/tmp/app", closeOverlay: (id: any) => { closed.push(id); },
  commands: () => [], exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => focusedNow,
  hc: async () => ({ code: 0, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: () => [],
  layout: () => LAYOUT, layouts: () => ["nocturne"],
  nextCommand: () => queue.length ? Promise.resolve(queue.shift()!) : new Promise<string>((r) => waiting.push(r)),
  notify: () => {}, openOverlay: (spec: any) => { overlays.push(spec); return `o${overlays.length}`; },
  panes: () => panesNow, pickFolder: async () => null, presentUpdateNotes: () => {}, props: () => propsNow,
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  setAgentOrder: () => {}, setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  settings: () => ({ zoom: 1 }), shared: (k: string) => sharedState[k] ?? null,
  spaces: () => spacesNow, terminals: () => [], theme: () => theme, updates: () => null,
  window: () => ({ platform: "linux" }),
};
mock.module("herdr", () => herdr);
const el: any = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined : (...a: any[]) => {
    if (k === "when" && a[0]) a[1](el);
    if (k === "map") return a[0](el);
    return el;
  }),
  apply: () => el,
});
mock.module("gpui-kit", () => ({ View: class {}, div: () => el, svg: () => el, image: () => el, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} }
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, v_virtual_list: () => el, Scrollbar: { new: () => el },
  InputState: { new: () => new Input() }, Input: { new: () => el },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) }, VirtualListScrollHandle: { new: () => ({}) },
}));
(globalThis as any).window = { paint_path: () => el };
const theme: any = new Proxy({}, { get: () => "#808080" });

const cx: any = {
  spawn: (f: Function) => { Promise.resolve().then(() => f(cx)).catch(() => {}); },
  notify() {}, stop_propagation() { cx.stopped = true; }, focus_handle: () => ({ focus() { cx.focusedHandle = true; }, is_focused: () => true }),
  new: () => ({ set_props() {} }), // the pointer's glow (glow.js), a nested view
  timer: { every() {}, after() {} },
};

/** A key event as GPUI sends it. */
function key(k: string, mods: Record<string, boolean> = {}, char?: string) {
  const typed = char ?? (k.length === 1 ? (mods.shift ? k.toUpperCase() : k) : null);
  return { key: k, key_char: typed, modifiers: { control: false, platform: false, alt: false, shift: false, ...mods } };
}

const nav = await import("../defaults/mods/nocturne/nav.ts");
const { default: Sky } = await import("../defaults/mods/nocturne/sky.js");
const { default: Tabs } = await import("../defaults/mods/nocturne/tabs.ts");
const toast = await import("../defaults/mods/nocturne/toast.ts");
const { headerControls, default: Header } = await import("../defaults/mods/nocturne/header.ts");

beforeEach(() => {
  sharedState = {}; commands = []; overlays = []; closed = []; queue = []; waiting = [];
  spacesNow = [
    { id: "s1", name: "one", active: true, tabs: [{ id: "t1", index: 1, active: true, name: "1" }, { id: "t2", index: 2, active: false, name: "2" }, { id: "t3", index: 3, active: false, name: "3" }] },
    { id: "s2", name: "two", active: false, tabs: [{ id: "t9", index: 1, active: true, name: "1" }] },
  ];
  panesNow = [
    { pane: "p1", tab: "t1", terminal: "a/1", focused: true, cwd: "/home/a", program: { agent: true, name: "Claude Code" } },
    { pane: "p2", tab: "t1", terminal: "a/2", focused: false, cwd: "/home/a" },
    { pane: "p3", tab: "t1", terminal: "a/3", focused: false, parked: true, cwd: "/home/a" },
  ];
  agentsNow = [{ address: "a/1", status: "working", tab: "t1", space: "s1", focused: true }, { address: "a/4", status: "idle", tab: "t9", space: "s2" }];
  focusedNow = { space: "s1", tab: "t1", pane: "p1", terminal: "a/1", block: null };
});

/** Feeds a key to a view; whether it was taken (stopped). */
function press(v: any, k: string, mods: Record<string, boolean> = {}, char?: string) {
  cx.stopped = false;
  v.key(key(k, mods, char), cx);
  v.render(cx);
  return cx.stopped;
}

// ---- nav.js

test("keys become verbs; cmd, ctrl and alt keys are never the chrome's", () => {
  const v = (k: string, m = {}, c?: string) => nav.keyVerb(key(k, m, c), nav.STRIP_KEYS);
  expect(v("j")).toBe("down");
  expect(v("down")).toBe("down");
  expect(v("enter")).toBe("go");
  expect(v("space", {}, " ")).toBe("go");
  expect(v("escape")).toBe("back");
  expect(v("tab")).toBe("next");
  expect(v("tab", { shift: true })).toBe("prev");
  expect(v("/", { shift: true }, "?")).toBe("help");
  expect(v("h", { shift: true })).toBe("move-left");
  expect(v("g", { shift: true })).toBe("last");
  expect(v("f10", { shift: true })).toBe("menu");
  expect(v("3")).toBe("n3");
  expect(v("j", { platform: true })).toBe(null);
  expect(v("left", { alt: true, platform: true })).toBe(null);
  expect(v("c", { control: true })).toBe(null);
  expect(v("z")).toBe(null);
  expect(nav.keyVerb(key("k", { shift: true }), nav.SIDEBAR_KEYS)).toBe("pin-up");
  expect(nav.keyVerb(key("p"), nav.SIDEBAR_KEYS)).toBe("pin");
});

test("the cursor moves, holds at the ends, jumps sections, and finds a neighbor when its control goes", () => {
  const items = [{ id: "a", sec: "x" }, { id: "b", sec: "x" }, { id: "c", sec: "y" }, { id: "d", sec: "z" }];
  expect(nav.move(items, "a", 1)).toBe("b");
  expect(nav.move(items, "a", -1)).toBe("a");
  expect(nav.move(items, "d", 1)).toBe("d");
  expect(nav.move(items, "gone", 1)).toBe("a");
  expect(nav.moveSection(items, "a", 1)).toBe("c");
  expect(nav.moveSection(items, "d", 1)).toBe("a");
  expect(nav.moveSection(items, "a", -1)).toBe("d");
  expect(nav.keep(items, "c", 0)).toBe("c");
  expect(nav.keep(items, "gone", 2)).toBe("c");
  expect(nav.keep(items, "gone", 9)).toBe("d");
  expect(nav.keep([], "a")).toBe(null);
  expect(nav.blockOf(LAYOUT, "sky")).toBe("sidebar");
  expect(nav.blockOf(LAYOUT, "tabs")).toBe("tabs");
  expect(nav.hasMod(LAYOUT, "notifications")).toBe(true);
});

// ---- the sidebar

function sky(focus = true) {
  const s = new Sky();
  s.init({ role: "sky" }, cx);
  focusedNow = { ...focusedNow, block: focus ? "sidebar" : null };
  s.render(cx);
  if (focus) { s.takeKeys(); s.render(cx); }
  return s;
}

test("nocturne.sidebar gives the sidebar the keyboard, and again takes it back to the pane", () => {
  const s = sky(false);
  s.toggleKeys();
  expect(commands.at(-1)).toEqual(["layout.focus", { id: "sidebar" }]);
  focusedNow = { ...focusedNow, block: "sidebar" };
  s.toggleKeys();
  expect(commands.at(-1)).toEqual(["pane.focus", { pane: "p1" }]);
});

test("without the keyboard the sidebar takes no keys and draws no cursor", () => {
  const s = sky(false);
  expect(s.navOn).toBe(false);
  expect(s.navList.length).toBeGreaterThan(0);
});

test("the sidebar's cursor starts on the shown space and walks every control", () => {
  const s = sky();
  expect(s.cursor).toBe("space:s1");
  const ids = s.navList.map((x: any) => x.id);
  expect(ids[0]).toBe("fold");
  expect(ids).toContain("space-new");
  expect(ids).toContain("fly:a/1");
  expect(ids).toContain("fly:a/4");
  expect(ids).toContain("usage-fold");
  expect(press(s, "j")).toBe(true);
  expect(s.cursor).toBe("space:s2");
  press(s, "enter");
  expect(commands.at(-1)).toEqual(["space.select", { id: "s2" }]);
  press(s, "k"); press(s, "k");
  expect(s.cursor).toBe("space-new");
  press(s, "g");
  expect(s.cursor).toBe("fold");
});

test("tab jumps to the fireflies; enter focuses the agent, p pins it, m opens its menu in the middle", () => {
  const s = sky();
  press(s, "tab");
  expect(s.cursor.startsWith("fly:")).toBe(true);
  const addr = s.cursor.slice(4);
  press(s, "enter");
  expect(commands.at(-1)).toEqual(["agent.focus", { terminal: addr }]);
  press(s, "p");
  expect(commands.at(-1)).toEqual(["terminal.pin", { terminal: addr, pinned: true }]);
  press(s, "m");
  expect(overlays.at(-1)).toMatchObject({ kind: "dialog", props: { role: "menu", tab: "fly" } });
  press(s, "r");
  expect(s.naming).toBe(addr);
  // While naming, the field has the keys.
  expect(press(s, "j")).toBe(false);
});

test("on a space: rename, folder (the picker), new tab, worktree, menu; delete asks and y deletes; n opens the picker", () => {
  const s = sky();
  press(s, "m");
  expect(overlays.at(-1)).toMatchObject({ kind: "dialog", props: { tab: "space", target: { id: "s1" } } });
  press(s, "t");
  expect(commands.at(-1)).toEqual(["tab.new", { space: "s1" }]);
  press(s, "w");
  expect(overlays.at(-1)).toMatchObject({ mod: "git", kind: "window", props: { worktrees: { space: "s1", action: "new" } } });
  press(s, "r");
  expect(s.spaces.mode).toMatchObject({ kind: "rename" });
  s.spaces.start(null, cx);
  press(s, "d");
  expect(s.spaces.mode).toMatchObject({ kind: "delete" });
  press(s, "n", {}, "n");
  expect(s.spaces.mode).toBe(null);
  press(s, "d");
  press(s, "y", {}, "y");
  expect(commands.at(-1)).toEqual(["space.close", { id: "s1", confirmed: true }]);
  press(s, "f"); // its folder: the picker, attaching it
  expect(overlays.at(-1)).toMatchObject({ mod: "nocturne", kind: "dialog", props: { role: "newspace", space: "s1" } });
  press(s, "n"); // a new space: the picker
  expect(s.spaces.mode).toBe(null);
  expect(overlays.at(-1)).toMatchObject({ mod: "nocturne", kind: "dialog", props: { role: "newspace" } });
  expect(overlays.at(-1).props.space).toBeUndefined();
});

test("l goes back to the panes, esc and q to the pane it came from, ? lists the keys", () => {
  const s = sky();
  press(s, "l");
  expect(commands.at(-1)).toEqual(["pane.go", { direction: "right" }]);
  press(s, "escape");
  expect(commands.at(-1)).toEqual(["pane.focus", { pane: "p1" }]);
  press(s, "q");
  expect(commands.at(-1)).toEqual(["pane.focus", { pane: "p1" }]);
  press(s, "/", { shift: true }, "?");
  expect(overlays.at(-1)).toMatchObject({ kind: "dialog", props: { role: "keyshelp" } });
  expect(press(s, "j", { platform: true })).toBe(false);
});

test("a closed space's cursor moves to its neighbor", () => {
  const s = sky();
  press(s, "j");
  expect(s.cursor).toBe("space:s2");
  spacesNow = spacesNow.slice(0, 1);
  s.render(cx);
  expect(s.cursor).not.toBe("space:s2");
  expect(s.navList.some((x: any) => x.id === s.cursor)).toBe(true);
});

test("the folded rail walks its rows too", () => {
  const s = sky();
  s.want = true; // folded
  s.render(cx);
  const ids = s.navList.map((x: any) => x.id);
  expect(ids[0]).toBe("fold");
  expect(ids).toContain("space:s1");
  expect(ids).toContain("fly:a/1");
  s.cursor = "space:s2";
  press(s, "r");
  expect(commands.at(-1)).toEqual(["space.rename", { id: "s2" }]);
});

// ---- the tab strip

function strip(focus = true) {
  const s = new Tabs();
  s.init({ role: "tabs" }, cx);
  focusedNow = { ...focusedNow, block: focus ? "tabs" : null };
  s.render(cx);
  if (focus) { s.takeKeys(); s.render(cx); }
  return s;
}

test("nocturne.tabstrip and nocturne.header give the strip the keyboard on that row", async () => {
  const s = strip(false);
  s.toggleKeys("head");
  expect(commands.at(-1)).toEqual(["layout.focus", { id: "tabs" }]);
  focusedNow = { ...focusedNow, block: "tabs" };
  s.render(cx);
  s.takeKeys();
  expect(s.row).toBe("head");
  s.toggleKeys("head");
  expect(commands.at(-1)).toEqual(["pane.focus", { pane: "p1" }]);
});

test("the strip's row: tabs, the buttons and the bell; enter selects, H/L move, x closes, r renames", () => {
  const s = strip();
  expect(s.row).toBe("tabs");
  expect(s.cursor).toBe("tab:t1");
  expect(s.rows.tabs.map((x: any) => x.id)).toEqual(["tab:t1", "tab:t2", "tab:t3", "tab-scripts-run", "tab-procs", "tab-files", "tab-git", "tab-git-more", "tab-new", "bell"]);
  press(s, "enter");
  expect(commands.at(-1)).toEqual(["pane.focus", { pane: "p1" }]); // the shown tab: back to its pane
  press(s, "l");
  expect(s.cursor).toBe("tab:t2");
  press(s, "enter");
  expect(commands.at(-1)).toEqual(["tab.select", { id: "t2" }]);
  press(s, "l", { shift: true });
  expect(commands.at(-1)).toEqual(["tab.move", { id: "t2", index: 3 }]);
  press(s, "h", { shift: true });
  expect(commands.at(-1)).toEqual(["tab.move", { id: "t2", index: 1 }]);
  press(s, "x");
  expect(commands.at(-1)).toEqual(["tab.close", { id: "t2" }]);
  press(s, "r");
  expect(commands.at(-1)).toEqual(["tab.rename", { id: "t2" }]);
  press(s, "m");
  expect(overlays.at(-1)).toMatchObject({ kind: "dialog", props: { tab: "tab", target: { id: "t2" } } });
  press(s, "G", { shift: true }, "G");
  expect(s.cursor).toBe("bell");
  expect(sharedState["nocturne.chrome"]).toEqual({ region: "bell", item: "bell" });
  press(s, "enter");
  expect(commands.at(-1)).toEqual(["notifications.open", undefined]);
  press(s, "h");
  press(s, "enter");
  expect(overlays.at(-1)).toMatchObject({ kind: "dialog", props: { role: "new" } });
  press(s, "2");
  expect(commands.at(-1)).toEqual(["tab.select", { index: 2 }]);
  press(s, "n");
  expect(commands.at(-1)).toEqual(["tab.new", { space: "s1" }]);
});

test("h past the first tab goes to the sidebar", () => {
  const s = strip();
  press(s, "h");
  expect(commands.at(-1)).toEqual(["pane.go", { direction: "left" }]);
});

test("j walks down: the focused pane's header, the parked chips, then the pane", () => {
  const s = strip();
  press(s, "j");
  expect(s.row).toBe("head");
  expect(s.cursor).toBe("fs");
  expect(sharedState["nocturne.chrome"]).toEqual({ region: "head", pane: "p1", item: "fs" });
  press(s, "l"); press(s, "l");
  expect(s.cursor).toBe("float");
  press(s, "enter");
  expect(commands.at(-1)).toEqual(["pane.float", { pane: "p1" }]);
  press(s, "G", { shift: true }, "G");
  expect(s.cursor).toBe("close");
  press(s, "h");
  expect(s.cursor).toBe("more");
  press(s, "enter");
  expect(overlays.at(-1)).toMatchObject({ kind: "dialog", props: { tab: "pane", target: { pane: "p1" } } });
  press(s, "g");
  expect(s.cursor).toBe("name");
  press(s, "enter");
  expect((sharedState["nocturne.name-pane"] as any)?.terminal).toBe("a/1");
  press(s, "x");
  expect(commands.at(-1)).toEqual(["pane.close", { pane: "p1" }]);
  press(s, "j");
  expect(s.row).toBe("parked");
  expect(s.cursor).toBe("park:p3");
  expect(sharedState["nocturne.chrome"]).toEqual({ region: "parked", pane: "p3", item: "park:p3" });
  press(s, "enter");
  expect(commands.at(-1)).toEqual(["pane.unpark", { pane: "p3" }]);
  press(s, "j");
  expect(commands.at(-1)).toEqual(["pane.focus", { pane: "p1" }]);
  press(s, "k"); press(s, "k");
  expect(s.row).toBe("tabs");
});

test("? lists the keys of the row the cursor is on: the strip's, the header's, the parked chips'", () => {
  const s = strip();
  const title = () => (overlays.at(-1) as any)?.props?.title;
  press(s, "/", { shift: true }, "?");
  expect(title()).toBe("tab strip keys");
  press(s, "j");
  press(s, "/", { shift: true }, "?");
  expect(title()).toBe("pane header keys");
  press(s, "j");
  press(s, "/", { shift: true }, "?");
  expect(title()).toBe("parked pane keys");
  expect((overlays.at(-1) as any).props.lines.at(-1)).toEqual(["?", "keys"]);
});

test("tab cycles every control across the rows; leaving clears the shared cursor", () => {
  const s = strip();
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) { press(s, "tab"); seen.add(s.row); }
  expect([...seen].sort()).toEqual(["head", "parked", "tabs"]);
  press(s, "j");
  focusedNow = { ...focusedNow, block: null };
  s.render(cx);
  expect(sharedState["nocturne.chrome"]).toBe(null);
  press(s, "/", { shift: true }, "?");
});

test("the header's controls: name, text size, float, splits, even out, gridify, park, zoom, ⋯, close (the rightmost)", () => {
  const all = [...panesNow, { pane: "p4", tab: "t1", terminal: "a/4" }];
  expect(headerControls(all[0], all).map((c: any) => c.id))
    .toEqual(["name", "fs", "fb", "float", "split-right", "split-down", "equalize", "gridify", "park", "zoom", "more", "close"]);
  const mod = { pane: "m1", tab: "t5", mod: "git", terminal: null };
  expect(headerControls(mod, [mod]).map((c: any) => c.id)).toEqual(["split-right", "split-down", "zoom", "more", "close"]);
  const zoomed = { ...all[0], zoomed: true };
  expect(headerControls(zoomed, all).slice(-3).map((c: any) => c.id)).toEqual(["zoom", "more", "close"]);
});

test("every header width draws close last, ⋯ right before it", () => {
  const all = [...panesNow, { pane: "p4", tab: "t1", terminal: "a/4" }];
  const drawn = (width: number, hovered: boolean, cursor: string | null = null) => {
    const h: any = Object.create(Header.prototype);
    Object.assign(h, { width, hovered });
    sharedState["nocturne.chrome"] = cursor ? { region: "head", pane: all[0].pane, item: cursor } : null;
    const ids: string[] = [];
    const row = { children: (list: any[]) => row };
    h.control = (_t: any, _p: any, c: any) => { ids.push(c.id); return el; };
    h.buttons(theme, row, all[0]);
    sharedState["nocturne.chrome"] = null;
    return ids;
  };
  expect(drawn(1000, true).at(-1)).toBe("close");
  expect(drawn(300, true)).toEqual(["zoom", "more", "close"]);
  expect(drawn(150, true)).toEqual(["more"]);
  expect(drawn(1000, false, "fs").slice(-2)).toEqual(["more", "close"]);
});

// ---- toasts (toast.js is the dialogs' work; here: the alias, through the sidebar's command loop)

test("nocturne.toast-dismiss closes the newest toast, as nocturne.toast-close does", async () => {
  const T = toast.default;
  new T().init({ title: "one", overlay: "ov1", action: { name: "agent.focus", args: { terminal: "a/1" } } });
  new T().init({ title: "two", overlay: "ov2", action: { name: "tab.select", args: { id: "t2" } } });
  sky(false);
  const next = () => new Promise((r) => setTimeout(r, 0));
  const send = async (c: string) => { const w = waiting.shift(); if (w) w(c); else queue.push(c); await next(); await next(); };
  await send("nocturne.toast-dismiss");
  expect(closed.at(-1)).toBe("ov2");
  await send("nocturne.toast");
  expect(commands.at(-1)).toEqual(["agent.focus", { terminal: "a/1" }]);
  expect(closed.at(-1)).toBe("ov1");
});

// ---- popup menus: q closes like esc, unless an item is bound to q

test("q closes a popup menu, unless one of its items takes q", async () => {
  const { Popup } = await import("../defaults/mods/nocturne/popup.ts");
  propsNow = { overlay: "menu1" };
  const p: any = new Popup();
  p.init(cx);
  const items = [{ id: "a", name: "a", go: () => {} }];
  expect(p.key(key("q"), items, items)).toBe(true);
  expect(closed.at(-1)).toBe("menu1");
  closed = [];
  let picked = "";
  const withQ = [{ id: "quit", name: "quit", key: "q", go: () => { picked = "quit"; } }];
  expect(p.key(key("q"), withQ, withQ)).toBe(true);
  expect(picked).toBe("quit");
  propsNow = null;
});
