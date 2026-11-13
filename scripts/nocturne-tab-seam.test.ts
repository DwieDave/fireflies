// The tab strip's seam (tabs.js seamFade, SEAM): where the tabs end and the
// toolbar's tools begin. The tabs fade into the night under it in dithered
// steps, a post stands down to the horizon, the tools stand on a lit stretch
// of it. With few tabs and with tabs overflowing the strip. Stand-ins for herdr
// and gpui (mock.module is process-wide: this file runs alone).
import { test, expect, mock } from "bun:test";

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
const isDither = (e: any) => e?.tag === "dither";

let tabsNow: any[] = [];
const LAYOUT = {
  id: "root", type: "row", children: [
    { id: "sidebar", type: "block", content: { mod: "nocturne", props: { role: "sky" } } },
    { id: "work", type: "column", children: [
      { id: "tab-row", type: "row", children: [
        { id: "tabs", type: "block", content: { mod: "nocturne", props: { role: "tabs" } } },
        { id: "notify", type: "block", size: { px: 28 }, content: { mod: "nocturne-notifications", props: { role: "bell" } } },
      ] },
      { id: "main", type: "block", content: { tab: "active" } },
    ] },
  ],
};
mock.module("herdr", () => ({
  agents: () => [], appHome: () => "/tmp/app", closeOverlay: () => {}, commands: () => [],
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => ({ space: "s1", tab: "t1", pane: "p1", terminal: "a/1" }),
  hc: async () => ({ code: 1, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: async () => [], layout: () => LAYOUT,
  layouts: () => ["nocturne"], nextCommand: () => new Promise<string>(() => {}), notify: () => {}, openOverlay: () => "o1",
  panes: () => [{ pane: "p1", tab: "t1", terminal: "a/1", focused: true, cwd: "/home/a" }], pickFolder: async () => null,
  presentUpdateNotes: () => {}, props: () => null, run: () => null, setAgentOrder: () => {}, setShared: () => {},
  settings: () => ({ zoom: 0.9 }), shared: () => null,
  spaces: () => [{ id: "s1", name: "one", active: true, folder: "/home/a", tabs: tabsNow }],
  terminals: () => [], theme: () => theme, updates: () => null, window: () => ({ platform: "macos" }),
}));
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: (p: string) => new El(`svg:${p}`), image: () => new El(), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
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

const { default: Tabs, SEAM, seamFade } = await import("../defaults/mods/nocturne/tabs.js");
const tab = (i: number) => ({ id: `t${i}`, index: i, active: i === 1, name: `tab number ${i}`, status: i % 3 ? "working" : "done" });
function strip(n: number) {
  tabsNow = Array.from({ length: n }, (_, i) => tab(i + 1));
  const v = new Tabs();
  v.init({ role: "tabs" }, cx);
  return v.render(cx);
}

for (const [what, n] of [["few tabs", 2], ["tabs overflowing the strip", 40]] as const) {
  test(`with ${what}: tabs, then the seam's post, then the tools on their ground`, () => {
    const root = strip(n);
    const order = root.kids.map(idOf).filter(Boolean);
    expect(order.slice(0, 3)).toEqual(["tab-area", "tab-seam", "tab-tools"]);
    const area = find(root, "tab-area");
    // the tabs give way (they scroll), the tools never do
    expect(area.calls.flex_1).toBeDefined();
    expect(area.calls.min_w?.[0]).toBe(0);
    expect(find(root, "tab-tools").calls.flex_none).toBeDefined();
    expect(find(root, "tab-scroll").calls.overflow_x_scrollbar).toBeDefined();
    expect(find(root, "tab-scroll").kids.filter((k: any) => String(idOf(k)).startsWith("tab-t")).length).toBe(n);
    // the fade lies over the tabs (after them, at the area's right edge), above the horizon
    expect(area.kids.map(idOf)).toEqual(["tab-scroll", "tab-fade"]);
    const fade = find(root, "tab-fade");
    expect(fade.calls.absolute).toBeDefined();
    expect(fade.calls.right?.[0]).toBe(0);
    expect(fade.calls.bottom?.[0]).toBe(2);
    // the post: 1 px, the strip's height, a gap from the fade
    const post = find(root, "tab-seam");
    expect(post.calls.w?.[0]).toBe(1);
    expect(post.calls.h_full).toBeDefined();
    expect(post.calls.ml?.[0]).toBe(SEAM.gap);
    // the tools' ground: a lit stretch of the horizon under them
    const ground = find(root, "tab-tools").kids[0];
    expect(ground.calls.absolute).toBeDefined();
    expect(ground.calls.bottom?.[0]).toBe(0);
    expect(ground.calls.h?.[0]).toBe(2);
    expect(ground.kids.some(isDither)).toBe(true);
    // the tools are all still there
    for (const id of ["tab-scripts-run", "tab-procs", "tab-files", "tab-git"]) expect(find(root, id)).toBeDefined();
  });
}

test("the fade thins out leftwards in dithered steps: a quarter, half, three quarters, the night", () => {
  const fade = seamFade(theme);
  expect(fade.calls.w?.[0]).toBe(SEAM.band * SEAM.steps);
  const bands = fade.kids;
  expect(bands.map((b: any) => b.calls.left?.[0])).toEqual([0, 5, 10, 15]);
  // a quarter: half the checker at half strength
  expect(bands[0].calls.opacity?.[0]).toBe(0.5);
  expect(bands[0].kids.some(isDither)).toBe(true);
  // half: the checker
  expect(bands[1].calls.opacity).toBeUndefined();
  expect(bands[1].kids.some(isDither)).toBe(true);
  // three quarters: the checker and the night at half over it
  expect(bands[2].kids.some(isDither)).toBe(true);
  expect(bands[2].kids.some((k: any) => k.calls.bg?.[0] === "background" && k.calls.opacity?.[0] === 0.5)).toBe(true);
  // then the night itself, in the background's color
  expect(bands[3].calls.bg?.[0]).toBe("background");
});

test("the fade takes no pointer: a press, click or drag on a tab under it reaches the tab", () => {
  const root = strip(40);
  const fade = find(root, "tab-fade");
  const handlers = (e: any): string[] => [...Object.keys(e.calls).filter((k) => k.startsWith("on_") || k === "occlude" || k === "block_mouse_except_scroll"), ...e.kids.flatMap(handlers)];
  expect(handlers(fade)).toEqual([]);
});
