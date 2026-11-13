// The tab strip's seam (tabs.js seamFade, seam, SEAM; kit.js toolGround):
// where the tabs end and the toolbar's tools begin. The tabs dissolve into the
// night under it in dithered steps, then the seam, and the tools stand on
// their own ground, which the bell's and "+ new"'s blocks (layout blocks of
// their own) carry on to the strip's right edge: Developer saw it stop under
// the git button's ▾. With few tabs and overflowing ones, the bell with a
// count and without. Stand-ins for herdr and gpui (mock.module is
// process-wide: this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";
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
const isDither = (e: any) => e?.tag === "dither";

let tabsNow: any[] = [];
let sharedState: Record<string, unknown> = {};
const LAYOUT = {
  id: "root", type: "row", children: [
    { id: "sidebar", type: "block", content: { mod: "nocturne", props: { role: "sky" } } },
    { id: "work", type: "column", children: [
      { id: "tab-row", type: "row", children: [
        { id: "tabs", type: "block", content: { mod: "nocturne", props: { role: "tabs" } } },
        { id: "notify", type: "block", size: { px: 28 }, content: { mod: "notifications", props: { role: "bell" } } },
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
  presentUpdateNotes: () => {}, props: () => ({ role: "bell", end: 0 }), run: () => null, setAgentOrder: () => {}, setShared: () => {},
  settings: () => ({ zoom: 0.9 }), shared: (k: string) => sharedState[k] ?? null,
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

const { default: Tabs, SEAM, seamFade, seam, fadeCover } = await import("../defaults/mods/nocturne/tabs.js");
const kit = await import("../defaults/mods/nocturne/kit.js");
const nkit = await import("../defaults/mods/notifications/kit.js");
const { default: Bell } = await import("../defaults/mods/notifications/bell.js");
const { default: NewButton } = await import("../defaults/mods/nocturne/newbutton.js");
const { ITEMS } = await import("../defaults/mods/notifications/engine.js");

beforeEach(() => { sharedState = {}; });

const tab = (i: number) => ({ id: `t${i}`, index: i, active: i === 1, name: `tab number ${i}`, status: i % 3 ? "working" : "done" });
function strip(n: number) {
  tabsNow = Array.from({ length: n }, (_, i) => tab(i + 1));
  const v = new Tabs();
  v.init({ role: "tabs" }, cx);
  return v.render(cx);
}
/** A layer's shape: what it calls (its id aside) and its children's shapes. */
const shape = (e: any): any => e instanceof Object && e.calls
  ? { tag: e.tag ?? null, calls: Object.fromEntries(Object.entries(e.calls).filter(([k]) => k !== "id")), kids: e.kids.map(shape) }
  : e;
const ground = () => kit.toolGround(theme).map(shape);
/** The ground's layers among a block's root children, in order. */
const groundIn = (root: any) => root.kids.map(shape).filter((k: any) => ground().some((g: any) => JSON.stringify(g) === JSON.stringify(k)));

for (const [what, n] of [["few tabs", 2], ["tabs overflowing the strip", 40]] as const) {
  test(`with ${what}: the tabs and their fade, the seam, then the tools on their ground`, () => {
    const root = strip(n);
    const order = root.kids.map(idOf).filter(Boolean);
    expect(order.slice(0, 3)).toEqual(["tab-area", "tab-seam", "tab-tools"]);
    const area = find(root, "tab-area");
    // the tabs give way (they scroll), the seam and the tools never do
    expect(area.calls.flex_1).toBeDefined();
    expect(area.calls.min_w?.[0]).toBe(0);
    expect(find(root, "tab-seam").calls.flex_none).toBeDefined();
    expect(find(root, "tab-tools").calls.flex_none).toBeDefined();
    expect(find(root, "tab-scroll").calls.overflow_x_scrollbar).toBeDefined();
    expect(find(root, "tab-scroll").kids.filter((k: any) => String(idOf(k)).startsWith("tab-t")).length).toBe(n);
    // the fade lies over the tabs (after them, at the area's right edge), above the horizon
    expect(area.kids.map(idOf)).toEqual(["tab-scroll", "tab-fade"]);
    const fade = find(root, "tab-fade");
    expect(fade.calls.right?.[0]).toBe(0);
    expect(fade.calls.bottom?.[0]).toBe(2);
    // the tools stand on the ground, edge to edge of their block
    const tools = find(root, "tab-tools");
    expect(tools.kids.slice(0, ground().length).map(shape)).toEqual(ground());
    for (const id of ["tab-scripts-run", "tab-procs", "tab-files", "tab-git", "tab-git-more"]) expect(find(root, id)).toBeDefined();
  });
}

for (const look of ["ledge", "plate"]) {
  test(`${look}: the ground spans its whole block, and is a real break from the tabs' 2 px horizon`, () => {
    const layers = kit.toolGround(theme, look);
    for (const l of layers) {
      expect(l.calls.absolute).toBeDefined();
      expect(l.calls.left?.[0]).toBe(0);
      expect(l.calls.right?.[0]).toBe(0);
    }
    // dithered, and taller than the horizon (a ledge) or the strip's height (a plate)
    expect(layers.some((l: any) => l.kids.some(isDither))).toBe(true);
    const tall = Math.max(...layers.map((l: any) => (l.calls.top?.[0] === 0 && l.calls.bottom?.[0] === 0 ? 36 : l.calls.h?.[0] ?? 0)));
    expect(tall).toBeGreaterThan(2);
  });

  test(`${look}: the fade is wide (40 px and more) and thickens rightwards to the night`, () => {
    const fade = seamFade(theme, look);
    const n = (SEAM as any)[look].steps;
    expect(fade.calls.w?.[0]).toBe(SEAM.band * n);
    expect(SEAM.band * n).toBeGreaterThanOrEqual(40);
    const covers = Array.from({ length: n }, (_, i) => fadeCover(i, n));
    expect(covers.every((c, i) => i === 0 || c > covers[i - 1])).toBe(true);
    expect(covers.at(-1)).toBe(1);
    expect(fade.kids.at(-1).calls.bg?.[0]).toBe("background"); // the night itself, last
    expect(fade.kids.slice(0, -1).every((b: any) => b.kids.some(isDither))).toBe(true); // dithered steps before it
  });

  test(`${look}: the seam has weight: a gap of night 8 px+ wide, or a dithered band the strip's height`, () => {
    const s = seam(theme, look);
    expect(s.calls.w?.[0]).toBeGreaterThanOrEqual(look === "ledge" ? 8 : 4);
    expect(s.calls.h_full).toBeDefined();
    if (look === "ledge") expect(s.calls.bg?.[0]).toBe("background"); // covers the tabs' horizon: it ends there
    else expect(s.kids.some((k: any) => k.kids.some(isDither))).toBe(true);
  });
}

// ---- Developer: "why is the brighter line stopping midway?" The bell and
// "+ new" are blocks of their own; each now draws the same ground.

for (const [what, list] of [
  ["no count", []],
  ["a count (two waiting on you, one to look at)", [{ id: "a", type: "permission" }, { id: "b", type: "question" }, { id: "c", type: "other" }]],
] as const) {
  test(`the ground runs on under the bell (${what}) and "+ new" to the strip's right edge`, () => {
    sharedState[ITEMS] = list;
    const b = new Bell();
    b.init({ role: "bell" }, cx);
    const bellRoot = b.render(cx);
    expect(groundIn(bellRoot)).toEqual(ground());
    const nb = new NewButton();
    nb.init();
    const newRoot = nb.render();
    expect(groundIn(newRoot)).toEqual(ground());
    // and both roots fill their blocks, so the ground reaches each block's edges
    for (const r of [bellRoot, newRoot]) expect(r.calls.size_full).toBeDefined();
    // none of them still draws the old plain horizon (ansi0, 2 px) on top
    for (const r of [bellRoot, newRoot]) expect(r.kids.some((k: any) => k.calls.h?.[0] === 2 && JSON.stringify(shape(k)).includes("ansi0") && !JSON.stringify(shape(k)).includes("ansi8"))).toBe(false);
  });
}

test("the toolbar's ground is one file in both mods (nocturne, notifications), and both kits pass it on", () => {
  expect(readFileSync("defaults/mods/notifications/toolground.ts", "utf8")).toBe(readFileSync("defaults/mods/nocturne/toolground.ts", "utf8"));
  for (const k of [kit, nkit]) for (const name of ["dither", "TOOL_LOOK", "toolGround", "mix", "toolHover"]) expect(k[name]).toBeDefined();
  expect(nkit.TOOL_LOOK).toBe(kit.TOOL_LOOK);
  expect(nkit.toolGround(theme).map(shape)).toEqual(ground());
  expect(nkit.toolHover(MOONFLY)).toBe(kit.toolHover(MOONFLY));
});

// ---- Developer chose the plate, "with the brighter hover on the plate".

const MOONFLY = { ansi0: "#323437", ansi8: "#949494", foreground: "#c6c6c6", background: "#080808" };
const lum = (c: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test("on the plate a hovered tool is a step brighter than the plain ansi0 hover, its text still readable", () => {
  const hover = kit.toolHover(MOONFLY, "plate");
  expect(hover).toMatch(/^#[0-9a-f]{6}$/);
  expect(lum(hover)).toBeGreaterThan(lum(MOONFLY.ansi0)); // brighter than the old hover, so brighter than the plate (ansi0 dithered)
  expect(contrast(MOONFLY.foreground, hover)).toBeGreaterThanOrEqual(4.5);
  expect(kit.toolHover(MOONFLY, "ledge")).toBe(MOONFLY.ansi0);
  expect(kit.mix("ansi0", "#ffffff", 0.5)).toBe("ansi0"); // a named color stays as it is
});

test("the tools, the bell and \"+ new\" all hover with it", () => {
  const hoverBg = (e: any) => { let bg: any = null; const st: any = new Proxy({}, { get: (_t, k) => (...a: any[]) => { if (k === "bg") bg = a[0]; return st; } }); e.calls.hover[0](st); return bg; };
  const want = kit.toolHover(theme);
  const root = strip(3);
  for (const id of ["tab-scripts-run", "tab-procs", "tab-files", "tab-git"]) expect(hoverBg(find(root, id))).toBe(want);
  const b = new Bell(); b.init({ role: "bell" }, cx);
  expect(hoverBg(find(b.render(cx), "bell"))).toBe(nkit.toolHover(theme));
  const nb = new NewButton(); nb.init();
  expect(hoverBg(find(nb.render(), "tab-new"))).toBe(want);
});

test("the fade takes no pointer: a press, click or drag on a tab under it reaches the tab", () => {
  const root = strip(40);
  const fade = find(root, "tab-fade");
  const handlers = (e: any): string[] => [...Object.keys(e.calls).filter((k) => k.startsWith("on_") || k === "occlude" || k === "block_mouse_except_scroll"), ...e.kids.flatMap(handlers)];
  expect(handlers(fade)).toEqual([]);
});
