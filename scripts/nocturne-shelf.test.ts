// The jar's shelf as drawn (shelf.ts): no "n panes kept" line under the tiles,
// each tile wearing its pane's icon (a web page's favicon, a file's type mark,
// a program's logo, the folder mark, a mod's icon), the "+" tile's menu of what
// can go into the dock. A recording stand-in for gpui keeps every element and
// its calls; herdr's is a stand-in too (mock.module is process-wide: this file
// runs alone).
import { test, expect, mock, beforeEach } from "bun:test";

class El {
  kids: any[] = [];
  calls: Record<string, any[]> = {};
  constructor(public tag?: string) {
    return new Proxy(this, {
      get: (t, k: string, proxy) => k in t ? (t as any)[k] : k === "then" ? undefined : (...a: any[]) => {
        if (k === "child") t.kids.push(a[0]);
        else if (k === "children") t.kids.push(...a[0]);
        else if (k === "when") { if (a[0]) a[1](proxy); }
        else if (k === "map") return a[0](proxy);
        else t.calls[k] = a;
        return proxy;
      },
    });
  }
}
const idOf = (e: any) => e?.calls?.id?.[0];
function find(root: any, id: string): any {
  if (idOf(root) === id) return root;
  for (const k of root?.kids ?? []) { const f = find(k, id); if (f) return f; }
}
const all = (root: any): any[] => (root instanceof Object && root.kids ? [root, ...root.kids.flatMap(all)] : []);
/** Every text child under an element. */
const texts = (root: any): string[] => all(root).flatMap((e: any) => e.kids.filter((k: any) => typeof k === "string"));

let sharedState: Record<string, unknown> = {};
let spacesNow: any[] = [];
let panesNow: any[] = [];
let agentsNow: any[] = [];
let terminalsNow: any[] = [];
let focusedNow: any = null;
let commands: [string, any][] = [];
let overlays: any[] = [];

mock.module("herdr", () => ({
  agents: () => agentsNow, appHome: () => "/tmp/app", closeOverlay: () => {}, commands: () => [],
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => focusedNow,
  hc: async () => ({ code: 0, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: async () => [],
  layout: () => ({ id: "root", type: "block" }), layouts: () => ["nocturne"], nextCommand: () => new Promise<string>(() => {}),
  notify: () => {}, openOverlay: (spec: any) => { overlays.push(spec); return `o${overlays.length}`; },
  panes: () => panesNow, pickFolder: async () => null, presentUpdateNotes: () => {}, props: () => null,
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  setAgentOrder: () => {}, setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  settings: () => ({ zoom: 0.9 }), shared: (k: string) => sharedState[k] ?? null,
  spaces: () => spacesNow, terminals: () => terminalsNow, theme: () => theme, updates: () => null,
  window: () => ({ platform: "macos" }),
}));
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: (p: string) => new El(`svg:${p}`), image: (p: string) => new El(`image:${p}`), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} }
mock.module("gpui-base", () => ({
  h_flex: () => new El(), v_flex: () => new El(), v_virtual_list: () => new El(), Scrollbar: { new: () => new El() },
  InputState: { new: () => new Input() }, Input: { new: () => new El() },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) }, VirtualListScrollHandle: { new: () => ({}) },
}));
(globalThis as any).window = { paint_path: () => new El("dither"), viewport_size: () => ({ width: 1600, height: 1000 }) };
const theme: any = new Proxy({}, { get: (_t, k) => String(k) });

const shelf = await import("../defaults/mods/nocturne/shelf.ts");
const pins = await import("../defaults/mods/nocturne/pins.ts");
const kit = await import("../defaults/mods/nocturne/kit.ts");

/** The sky as the shelf reads it: no cursor, nothing under the pointer, tab c1 shown. */
const sky: any = { nav: () => false, tileHover: null, tileOn: null, shownTabs: new Set(["c1"]), tabSpace: new Map(), shownSpace: "s1" };

const WEB = { pane: "p2", tab: "c1", terminal: null, mod: "browser", props: { slot: "w1" }, title: "browser", focused: false, parked: false };
const EDIT = { pane: "p3", tab: "c1", terminal: null, mod: "editor", props: { path: "/a/main.rs", slot: "e1" }, title: "editor", focused: false, parked: false };

beforeEach(() => {
  sharedState = {}; commands = []; overlays = [];
  spacesNow = [{ id: "s1", name: "one", active: true, tabs: [{ id: "c1", index: 1, active: true, name: "1" }] }];
  panesNow = [WEB, EDIT]; agentsNow = []; terminalsNow = []; focusedNow = { space: "s1", tab: "c1", pane: "p2", terminal: null };
});

/** The shelf drawn with these panes pinned (in this order). */
function drawn(list: any[]) {
  sharedState[pins.PANES_KEY] = list.map((p, i) => ({ pane: p.pane, mod: p.mod, props: p.props, at: i + 1 }));
  return shelf.shelfView(sky, theme, kit.jar().filter(pins.onShelf), 232);
}

// ---- item 1: the "n panes kept" line is gone

test("the shelf has no caption line: no \"n panes kept\", no name under the tiles; a tile names itself in its tooltip", () => {
  for (const focus of [null, "p2"]) {
    focusedNow = focus ? { ...focusedNow, pane: focus } : null;
    const root = drawn([WEB, EDIT]);
    expect(texts(root)).toEqual([]);
    expect(root.kids.length).toBe(2); // the board and the row of tiles
  }
  const tile = find(drawn([WEB, EDIT]), "pin-pane:p3");
  expect(tile.calls.tooltip[0]).toContain("main.rs");
});
