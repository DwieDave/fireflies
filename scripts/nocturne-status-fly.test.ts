// An agent's status in a pane header (header.ts) and on its tab (tabs.ts):
// Fireflies' winged firefly (kit.ts statusFly, art/firefly.svg: the app icon's
// insect as a 1-bit mask) in the colour the sidebar gives that status (idle
// muted), breathing while working and blinking while it needs Developer, as the
// old pip did; no agent, no firefly. 13 x 11 layout px: no taller than the
// program's 11 px mark beside it, so neither the 24 px header nor the strip
// grows (at zoom 0.9 too: both scale with the same zoom). Stand-ins for herdr
// and gpui (mock.module is process-wide: this file runs alone).
import { test, expect, mock } from "bun:test";
import { readFileSync } from "node:fs";

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
mock.module("herdr", () => ({
  agents: () => [], appHome: () => "/tmp/app", closeOverlay: () => {}, commands: () => [],
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => ({ space: "s1", tab: "t1", pane: "p1", terminal: "a/1" }),
  hc: async () => ({ code: 1, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: async () => [], layout: () => ({ id: "root", type: "block" }),
  layouts: () => ["nocturne"], nextCommand: () => new Promise<string>(() => {}), notify: () => {}, openOverlay: () => "o1",
  panes: () => panesNow, pickFolder: async () => null,
  presentUpdateNotes: () => {}, props: () => propsNow, run: () => null, setAgentOrder: () => {}, setShared: () => {},
  settings: () => ({ zoom: 0.9 }), shared: () => null,
  spaces: () => [{ id: "s1", name: "one", active: true, folder: "/home/a", tabs: tabsNow }],
  terminals: () => [], theme: () => theme, updates: () => null, window: () => ({ platform: "macos" }),
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
const kit = await import("../defaults/mods/nocturne/kit.ts");

const FLY = "svg:mods/nocturne/art/firefly.svg";
const STATUSES = ["working", "blocked", "done", "idle"] as const;
// The sidebar's colours (sky.ts firefly): the status's own, idle muted.
const colour = (s: string) => (s === "idle" ? "muted" : s);

const agentPane = (status: string | null) => ({ pane: "p1", tab: "t1", terminal: "a/1", focused: true, title: "claude", cwd: "/home/a", status,
  program: { key: "claude", name: "claude", agent: true } });

function strip(status: string | null) {
  tabsNow = [{ id: "t1", index: 1, active: true, name: "one", status }];
  panesNow = [agentPane(status)];
  const v = new Tabs();
  v.init({ role: "tabs" }, cx);
  return find(v.render(cx), "tab-t1");
}

function header(status: string | null) {
  panesNow = [agentPane(status)];
  propsNow = { pane: "p1" };
  const v = new Header();
  v.init({ pane: "p1" }, cx);
  return v.render(cx);
}

/** The firefly(s) under an element. */
const flies = (root: any) => all(root).filter((e: any) => e.tag === FLY);

test("the firefly is the app icon's insect as a 1-bit mask: 13 x 11 px, one colour", () => {
  const svg = readFileSync(new URL("../defaults/mods/nocturne/art/firefly.svg", import.meta.url), "utf8");
  expect(svg).toContain('viewBox="0 0 26 22"');
  expect(svg).not.toContain("fill=");
  expect([kit.FLY_W, kit.FLY_H]).toEqual([13, 11]);
});

for (const status of STATUSES) {
  test(`${status}: the tab and the pane header wear the winged firefly in the sidebar's ${colour(status)}`, () => {
    for (const [where, root] of [["tab", strip(status)], ["header", header(status)]] as const) {
      const f = flies(root);
      expect(f.length, where).toBe(1);
      expect(f[0].calls.text_color?.[0], where).toBe(colour(status));
      expect([f[0].calls.w?.[0], f[0].calls.h?.[0]], where).toEqual([13, 11]);
      expect(f[0].calls.flex_none, where).toBeDefined();
      // The old pip is gone from both.
      expect(all(root).some((e: any) => e.tag === "svg:mods/nocturne/art/pip.svg"), where).toBe(false);
      // Working breathes and blocked blinks, as the pip did; done and idle hold still.
      const loop = f[0].calls.loop;
      if (status === "working") expect(loop, where).toEqual(["opacity", { from: 0.3, to: 1, period: 1600 }]);
      else if (status === "blocked") expect(loop, where).toEqual(["opacity", { from: 0.15, to: 1, period: 700, easing: "linear" }]);
      else expect(loop, where).toBeUndefined();
    }
  });
}

test("no agent (a shell, a mod pane): no firefly on its tab or header", () => {
  expect(flies(strip(null)).length).toBe(0);
  expect(flies(header(null)).length).toBe(0);
});

test("no taller than the program's mark beside it: the header and the strip keep their heights", () => {
  const head = header("working");
  const mark = all(head).find((e: any) => e.tag === "svg:mods/nocturne/art/logo-claude.svg");
  expect(mark?.calls.size?.[0]).toBe(11);
  expect(flies(head)[0].calls.h?.[0]).toBeLessThanOrEqual(mark.calls.size[0]);
  // The tab is as tall as its strip (h_full), whatever it holds.
  expect(strip("blocked").calls.h_full).toBeDefined();
});
