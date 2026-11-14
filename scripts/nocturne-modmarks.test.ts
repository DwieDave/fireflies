// The marks and names of mod panes and their tabs and tiles (walkicons item 2):
// a Databases pane, and a pane of any optional mod that declares a launcher in
// its mod.json (Kubernetes), wear their own mark and name in the pane's header,
// its parked chip, its tab and its tile on the shelf; a mod Nocturne knows
// nothing of keeps the terminal mark and its bare name.
// herdr and gpui stand-ins (mock.module is process-wide: this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";


let sharedState: Record<string, unknown> = {};
let spacesNow: any[] = [];
let panesNow: any[] = [];
let agentsNow: any[] = [];
let terminalsNow: any[] = [];
let focusedNow: any = null;
let commands: [string, any][] = [];
let labels: string[][] = [];
let overlays: any[] = [];
let queue: string[] = [];
let waiting: ((v: string) => void)[] = [];

const LAYOUT = {
  id: "root", type: "row", children: [
    { id: "sidebar", type: "block", content: { mod: "nocturne", props: { role: "sky" } } },
    { id: "main", type: "block", content: { tab: "active" } },
  ],
};

const herdr: Record<string, any> = {
  agents: () => agentsNow, appHome: () => "/tmp/app", closeOverlay: () => {},
  commands: () => [], exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => focusedNow,
  hc: async (args: string[]) => { if (args[0] === "label") labels.push(args.slice(1)); return { code: 0, stdout: "" }; },
  home: () => "/home/a", keys: () => [{ section: "layout:nocturne", action: "nocturne.pin", keys: "cmd-alt-p" }], knownAgents: () => [],
  layout: () => LAYOUT, layouts: () => ["nocturne"],
  nextCommand: () => queue.length ? Promise.resolve(queue.shift()!) : new Promise<string>((r) => waiting.push(r)),
  notify: () => {}, openOverlay: (spec: any) => { overlays.push(spec); return `o${overlays.length}`; },
  panes: () => panesNow, pickFolder: async () => null, presentUpdateNotes: () => {}, props: () => null,
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  setAgentOrder: () => {}, setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  settings: () => ({ zoom: 1 }), shared: (k: string) => sharedState[k] ?? null,
  spaces: () => spacesNow, terminals: () => terminalsNow, theme: () => theme, updates: () => ({ app: { version: "1.0", ready: null, updates: false }, core: { version: null, managed: null, ready: null, updating: false, error: null }, checked: null, checks: true, checking: false, notes: [] }),
  window: () => ({ platform: "linux" }),
};
mock.module("herdr", () => herdr);
/** The svg paths drawn since the last reset, and the words drawn (strings handed to child()). */
let drawn: string[] = [];
let words: string[] = [];
const el: any = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined : (...a: any[]) => {
    if (k === "child" && typeof a[0] === "string") words.push(a[0]);
    if (k === "when" && a[0]) a[1](el);
    if (k === "map") return a[0](el);
    return el;
  }),
  apply: () => el,
});
mock.module("gpui-kit", () => ({ View: class {}, div: () => el, svg: (path: string) => { drawn.push(path); return el; }, image: () => el, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} }
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, v_virtual_list: () => el, Scrollbar: { new: () => el },
  InputState: { new: () => new Input() }, Input: { new: () => el },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) }, VirtualListScrollHandle: { new: () => ({}) },
}));
(globalThis as any).window = { paint_path: () => el };
const theme: any = new Proxy({}, { get: () => "#808080" });

let timers: Function[] = [];
const cx: any = {
  spawn: (f: Function) => { Promise.resolve().then(() => f(cx)).catch(() => {}); },
  notify() {}, stop_propagation() { cx.stopped = true; }, focus_handle: () => ({ focus() {}, is_focused: () => true }),
  new: () => ({ set_props() {} }),
  timer: { every() {}, after: (_ms: number, f: Function) => { timers.push(f); } },
};

const header = await import("../defaults/mods/nocturne/header.ts");
const shelf = await import("../defaults/mods/nocturne/shelf.ts");
const { default: Tabs } = await import("../defaults/mods/nocturne/tabs.ts");
const { LAUNCHERS } = await import("../defaults/mods/nocturne/launchers.ts");

const DB = { pane: "p2", tab: "c2", terminal: null, mod: "databases", props: { as: "pane" }, title: "databases", focused: false, parked: false };
const K8S = { pane: "p3", tab: "c3", terminal: null, mod: "k8s", props: { slot: "k1" }, title: "k8s", focused: false, parked: false };
const ODD = { pane: "p4", tab: "c4", terminal: null, mod: "odd", props: {}, title: "odd", focused: false, parked: false };

beforeEach(() => {
  sharedState = {}; commands = []; drawn = []; words = [];
  sharedState[LAUNCHERS.name] = [
    { mod: "k8s", title: "Kubernetes", icon: "icon.svg", window: true, pane: true },
    { mod: "notes", title: "Notes", icon: "../x.svg", pane: true },
  ];
  spacesNow = [{ id: "s1", name: "one", active: true, tabs: ["c2", "c3", "c4"].map((id, i) => ({ id, index: i + 1, active: i === 0, name: id, named: false })) }];
  panesNow = [DB, K8S, ODD];
  agentsNow = []; terminalsNow = []; focusedNow = { space: "s1", tab: "c2", pane: "p2", terminal: null, block: null };
});

test("a Databases pane: the database mark, Databases, databases", () => {
  expect(header.markPath(DB)).toBe("mods/nocturne/art/database.svg");
  expect(header.paneName(DB)).toBe("Databases");
  expect(header.modKind(DB)).toBe("databases");
});

test("a launcher's pane: its mod.json's icon and title; one without a plain icon the stock mark", () => {
  expect(header.markPath(K8S)).toBe("mods/k8s/icon.svg");
  expect(header.paneName(K8S)).toBe("Kubernetes");
  expect(header.modKind(K8S)).toBe("kubernetes");
  const notes = { ...K8S, mod: "notes" };
  expect(header.markPath(notes)).toBe("mods/workspace-chrome/layers.svg");
  expect(header.paneName(notes)).toBe("Notes");
  // A mod nobody declares: as before, the terminal mark and its bare name.
  expect(header.markPath(ODD)).toBe("mods/workspace-chrome/terminal.svg");
  expect(header.paneName(ODD)).toBe("odd");
  // Nocturne's own keep theirs.
  expect(header.markPath({ mod: "browser" })).toBe("mods/workspace-chrome/monitor.svg");
});

test("the header's and the parked chip's mark draw it", () => {
  header.mark(theme, { ...DB, focused: true });
  header.mark(theme, K8S);
  expect(drawn).toEqual(["mods/nocturne/art/database.svg", "mods/k8s/icon.svg"]);
});

test("their tiles on the shelf: the mark, the name, the kind not said twice", () => {
  const db = { kind: "pane", key: "pane:p2", pane: DB, record: { pane: "p2" }, at: 1 };
  const k8s = { kind: "pane", key: "pane:p3", pane: K8S, record: { pane: "p3" }, at: 2 };
  shelf.tileMark(theme, db as any, 14, true);
  shelf.tileMark(theme, k8s as any, 14, false);
  expect(drawn).toEqual(["mods/nocturne/art/database.svg", "mods/k8s/icon.svg"]);
  expect([shelf.pinName(db as any), shelf.pinName(k8s as any)]).toEqual(["Databases", "Kubernetes"]);
  const sky: any = { tabSpace: new Map([["c2", spacesNow[0]], ["c3", spacesNow[0]]]), shownSpace: "s1" };
  expect([shelf.pinWhere(sky, db as any), shelf.pinWhere(sky, k8s as any)]).toEqual(["", ""]);
});

test("their tabs: the mod's mark; an unnamed one goes by the mod's name", () => {
  const strip: any = { drag: null, pressed: null, at: () => false };
  const [c2, c3, c4] = spacesNow[0].tabs;
  for (const c of [c2, c3, c4]) Tabs.prototype.tabItem.call(strip, theme, c, spacesNow[0], null);
  expect(drawn).toEqual(["mods/nocturne/art/database.svg", "mods/k8s/icon.svg"]); // odd: no mark, as before
  expect(words.filter((w) => !/^\d+$/.test(w))).toEqual(["Databases", "Kubernetes", "odd"]);
  // A named tab keeps its name.
  words = [];
  Tabs.prototype.tabItem.call(strip, theme, { ...c3, name: "cluster", named: true }, spacesNow[0], null);
  expect(words).toContain("cluster");
});
