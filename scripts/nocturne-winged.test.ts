// An agent's one mark on its tab (tabs.ts) and in its pane header (header.ts):
// the sidebar's winged mark (winged.ts: its program's logo with the little
// wings, art/wings.svg) in the colour the sidebar gives its status (idle
// muted), and nothing beside it: no second icon, no separate firefly. Working,
// its wings beat a little and slowly; blocked, it blinks; done and idle hold
// still. A plain terminal keeps its plain mark. The sidebar's firefly draws
// the same helper, so the three can't drift. Stand-ins for herdr and gpui
// (mock.module is process-wide: this file runs alone).
import { test, expect, mock } from "bun:test";
import { existsSync } from "node:fs";

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

let tabsNow: any[] = [];
let panesNow: any[] = [];
let propsNow: any = {};
let zoomNow = 0.9;
let activeNow = true;
mock.module("herdr", () => ({
  agents: () => [], appHome: () => "/tmp/app", closeOverlay: () => {}, commands: () => [],
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => ({ space: "s1", tab: "t1", pane: "p1", terminal: "a/1" }),
  hc: async () => ({ code: 1, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: async () => [], layout: () => ({ id: "root", type: "block" }),
  layouts: () => ["nocturne"], nextCommand: () => new Promise<string>(() => {}), notify: () => {}, openOverlay: () => "o1",
  panes: () => panesNow, pickFolder: async () => null,
  presentUpdateNotes: () => {}, props: () => propsNow, run: () => null, setAgentOrder: () => {}, setShared: () => {},
  settings: () => ({ zoom: zoomNow }), shared: () => null,
  spaces: () => [{ id: "s1", name: "one", active: true, folder: "/home/a", tabs: tabsNow }],
  terminals: () => [], theme: () => theme, updates: () => null, window: () => ({ platform: "macos", active: activeNow }),
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
const cx: any = {
  spawn: () => {}, notify() {}, stop_propagation() {},
  focus_handle: () => ({ focus() {}, is_focused: () => false }), new: () => ({ set_props() {} }), timer: { every() {}, after() {} },
};

const { default: Tabs } = await import("../defaults/mods/nocturne/tabs.ts");
const { default: Header } = await import("../defaults/mods/nocturne/header.ts");
const winged = await import("../defaults/mods/nocturne/winged.ts");
const { firefly } = await import("../defaults/mods/nocturne/meadow.ts");

const STATUSES = ["working", "blocked", "done", "idle"] as const;
// The sidebar's colours (meadow.ts firefly): the status's own, idle muted.
const colour = (s: string) => (s === "idle" ? "muted" : s);
const WINGS = "svg:mods/nocturne/art/wings.svg";
const LOGO = "svg:mods/nocturne/art/logo-claude.svg";

const agentPane = (status: string | null) => ({ pane: "p1", tab: "t1", terminal: "a/1", focused: true, title: "claude", cwd: "/home/a", status, app: "claude-code",
  program: { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: true, agent: true } });
const shellPane = { pane: "p1", tab: "t1", terminal: "a/1", focused: true, title: "zsh", cwd: "/home/a", status: null, app: null,
  program: { key: "shell", name: "zsh", icon: "icons/terminal.svg", tint: true, shell: true, agent: false } };

function strip(pane: any, status: string | null = pane.status) {
  tabsNow = [{ id: "t1", index: 1, active: true, name: "one", status }];
  panesNow = [pane];
  const v = new Tabs();
  v.init({ role: "tabs" }, cx);
  return find(v.render(cx), "tab-t1");
}

function header(pane: any) {
  panesNow = [pane];
  propsNow = { pane: "p1" };
  const v = new Header();
  v.init({ pane: "p1" }, cx);
  return v.render(cx);
}

/** The icons drawn under an element: every svg or image but the wings and the header's dither. */
const icons = (root: any) => all(root).filter((e: any) => /^(svg|image):/.test(e.tag ?? "") && e.tag !== WINGS && !/more\.svg|pane\//.test(e.tag));
/** Every loop under an element: [property, options]. */
const loops = (root: any) => all(root).flatMap((e: any) => (e.calls.loop ? [e.calls.loop] : []));

for (const status of STATUSES) {
  test(`${status}: the tab and the pane header wear one mark, the sidebar's winged one, in the sidebar's ${colour(status)}`, () => {
    activeNow = true;
    for (const [where, root, id] of [["tab", strip(agentPane(status)), "tab-mark-t1"], ["header", header(agentPane(status)), "h-mark-p1"]] as const) {
      const mark = find(root, id);
      expect(mark, where).toBeDefined();
      // One icon: the program's art logo; its wings beside it are part of it.
      expect(icons(root).map((e: any) => e.tag), where).toEqual([LOGO]);
      const wings = all(mark).filter((e: any) => e.tag === WINGS);
      expect(wings.length, where).toBe(1);
      for (const e of [wings[0], icons(root)[0]]) expect(e.calls.text_color?.[0], where).toBe(colour(status));
      // No separate firefly, no pip.
      expect(all(root).some((e: any) => /firefly\.svg|pip\.svg/.test(e.tag ?? "")), where).toBe(false);
      // Working: the wings beat one cell of eight, slowly; blocked blinks; done and idle hold still.
      const ls = loops(mark);
      if (status === "working") expect(ls, where).toEqual([["height", { from: 6, to: 5.25, period: 2400, easing: "linear" }]]);
      else if (status === "blocked") expect(ls, where).toEqual([["opacity", { from: 0.15, to: 1, period: 700, easing: "linear" }]]);
      else expect(ls, where).toEqual([]);
    }
  });
}

test("working, its wings beat only while the window is in front (calm: held still)", () => {
  activeNow = false;
  expect(loops(find(strip(agentPane("working")), "tab-mark-t1"))).toEqual([]);
  activeNow = true;
});

test("a plain terminal (no agent) keeps its plain mark, without wings", () => {
  const tab = strip(shellPane);
  expect(icons(tab).map((e: any) => e.tag)).toEqual(["svg:icons/terminal.svg"]);
  expect(all(tab).some((e: any) => e.tag === WINGS)).toBe(false);
  const head = header(shellPane);
  expect(icons(head).map((e: any) => e.tag)).toEqual(["svg:mods/workspace-chrome/terminal.svg"]);
  expect(all(head).some((e: any) => e.tag === WINGS)).toBe(false);
});

test("its size: a 12 px mark in an 18.75 x 13.5 box, inside the 24 px header and the strip's row at zoom 0.9 and 1.0", () => {
  for (const zoom of [0.9, 1]) {
    zoomNow = zoom;
    for (const root of [strip(agentPane("working")), header(agentPane("working"))]) {
      const box = all(root).find((e: any) => e.calls.w?.[0] === 18.75);
      expect([box?.calls.w?.[0], box?.calls.h?.[0]]).toEqual([18.75, 13.5]);
      expect(icons(root)[0].calls.size[0]).toBe(winged.CHROME_MARK);
      // Under the header's 24 px (the app's header row), the same at any zoom: both scale with it.
      expect(box.calls.h[0]).toBeLessThan(24);
    }
    // The tab is as tall as its strip (h_full), whatever it holds.
    expect(strip(agentPane("blocked")).calls.h_full).toBeDefined();
  }
  zoomNow = 0.9;
});

test("one helper for the sidebar, the tabs and the headers: the sidebar's firefly is the same winged mark at 16 px", () => {
  const sky: any = { nav: () => false, landing: new Map(), naming: null, shownSpace: "s1", seen: new Map() };
  const a: any = { ...agentPane("done"), address: "a/1", status: "done", space: "s1", space_name: "one", focused: false };
  const fly = firefly(sky, theme, a, 0, 28, 232);
  const box = all(fly).find((e: any) => e.calls.w?.[0] === 25 && e.calls.h?.[0] === 18);
  expect(box).toBeDefined();
  // Its parts as winged.ts lays them out: the wings across the top, the mark 4 in and 2 down.
  const shape = (root: any) => all(root).filter((e: any) => e.tag === WINGS || e.tag === LOGO).map((e: any) => e.tag);
  expect(shape(box)).toEqual(shape(winged.wingedMark(a, "done", 16)));
  expect(shape(box)).toEqual([WINGS, LOGO]);
  // The tab's is the same drawing at 12 px: wings 25 / 16 of the mark wide.
  const tab = find(strip(agentPane("done")), "tab-mark-t1");
  const tw = all(tab).find((e: any) => e.tag === WINGS);
  expect(tw.calls.w[0] / winged.CHROME_MARK).toBe(25 / 16);
});

test("the separate firefly glyph and its art are gone", () => {
  expect(existsSync(new URL("../defaults/mods/nocturne/art/firefly.svg", import.meta.url))).toBe(false);
});
