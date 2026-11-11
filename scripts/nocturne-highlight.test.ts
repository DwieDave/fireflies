// What's shown wears the blue corner ticks (sky.js cornerTicks): the focused
// agent's firefly square (in the jar and out of it, not its name), the shown
// space in the open sidebar and on the rail. The sky drawn through recording
// gpui stand-ins (mock.module is process-wide: this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";

// ---- stand-ins

let agentsNow: any[] = [];
let termsNow: any[] = [];
let windowNow: any = { platform: "linux", active: true };
let zoom = 1;
const herdr: Record<string, any> = {
  agents: () => agentsNow,
  appHome: () => "/tmp/app", closeOverlay: () => {}, commands: () => [],
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => ({ space: "s1", tab: "t1", pane: "p1", terminal: "a/1", block: null }),
  hc: async () => ({ code: 0, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: () => [],
  layout: () => ({ id: "sidebar", type: "block", content: { mod: "nocturne", props: { role: "sky" } } }), layouts: () => ["nocturne"],
  nextCommand: () => new Promise<string>(() => {}), notify: () => {}, openOverlay: () => "o1",
  panes: () => [], pickFolder: async () => null, presentUpdateNotes: () => {}, props: () => ({ role: "sky" }),
  run: () => null, setAgentOrder: () => {}, setShared: () => {}, settings: () => ({ zoom }), shared: () => null,
  spaces: () => [{ id: "s1", name: "one", active: true, tabs: [{ id: "t1", index: 1, active: true, name: "1" }] },
    { id: "s2", name: "two", active: false, tabs: [{ id: "t2", index: 1, active: true, name: "1" }] }],
  terminals: () => termsNow, theme: () => theme, updates: () => null, window: () => windowNow,
};
mock.module("herdr", () => herdr);

/** A recording element: its calls (name, args) and children; `.id(x)` files it under x. */
type El = { calls: [string, any[]][]; kids: any[] } & Record<string, any>;
let byId: Record<string, El> = {};
function mk(): El {
  const t: any = { calls: [], kids: [] };
  const p: any = new Proxy(t, {
    get: (_t, k) => {
      if (k === "calls" || k === "kids") return t[k];
      if (k === "then") return undefined;
      return (...a: any[]) => {
        t.calls.push([String(k), a]);
        if (k === "id") byId[a[0]] = p;
        if (k === "when") return a[0] ? (a[1](p) ?? p) : p;
        if (k === "map") return a[0](p);
        if (k === "child") t.kids.push(a[0]);
        if (k === "children") t.kids.push(...[a[0] ?? []].flat());
        return p;
      };
    },
  });
  return p;
}
mock.module("gpui-kit", () => ({ View: class {}, div: mk, svg: mk, image: mk, PathBuilder: { fill: mk }, Background: { checkerboard: mk } }));
mock.module("gpui-base", () => ({
  h_flex: mk, v_flex: mk, v_virtual_list: mk, Scrollbar: { new: mk },
  InputState: { new: () => ({ on() {}, value: () => "", set_value() {}, focus() {} }) }, Input: { new: mk },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) }, VirtualListScrollHandle: { new: () => ({}) },
}));
(globalThis as any).window = { paint_path: mk };
const theme: any = new Proxy({}, { get: (_t, k) => `#${String(k)}` });

/** A nested view as cx.new hands it back: it records the props it's given. */
type Glow = { props: any[]; set_props(p: any): void };
let glows: Glow[] = [];
let timers: Function[] = [];
const cx: any = {
  spawn: () => {}, notify() { cx.notified++; }, stop_propagation() {}, notified: 0,
  focus_handle: () => ({ focus() {}, is_focused: () => false }),
  new: () => { const g: Glow = { props: [], set_props(p) { g.props.push(p); } }; glows.push(g); return g; },
  timer: { every() {}, after(_ms: number, f: Function) { timers.push(f); } },
};

const { default: Sky, GLOW_SQUARE } = await import("../defaults/mods/nocturne/sky.js");

const AGENTS = [
  { address: "a/1", status: "working", tab: "t1", space: "s1", focused: true, program: { name: "claude", agent: true } },
  { address: "a/2", status: "blocked", tab: "t1", space: "s1", focused: false, program: { name: "codex", agent: true } },
];
beforeEach(() => { byId = {}; agentsNow = AGENTS; termsNow = []; zoom = 0.9; });

/** The sky drawn, open or folded to the rail. */
function draw(folded = false) {
  const s: any = new Sky();
  s.init({ role: "sky" }, cx);
  s.size = { width: folded ? 90 : 252, height: 900 };
  return s.render(cx);
}

const has = (el: El, name: string, ...args: any[]) => el.calls.some(([n, a]) => n === name && args.every((x, i) => a[i] === x));
/** A corner tick: a 4 px accent corner (cornerTicks). */
const isTick = (el: El) => el?.calls && has(el, "size", 4) && has(el, "border_color", "#accent") && (has(el, "border_t", 1) || has(el, "border_b", 1));
/** The elements that wear a pair of corner ticks, under `el`, with the path of ids down to each. */
function wearers(el: El, path: string[] = [], out: { el: El; path: string[] }[] = []) {
  if (!el?.calls) return out;
  const id = el.calls.find(([n]) => n === "id")?.[1][0];
  const here = id ? [...path, id] : path;
  if (el.kids.filter(isTick).length === 2) out.push({ el, path: here });
  for (const k of el.kids) wearers(k, here, out);
  return out;
}

test("open sky: the focused agent's corner ticks frame its firefly's square, not its name", () => {
  const w = wearers(draw()).filter((x) => x.path.includes("fly-a/1"));
  expect(w).toHaveLength(1);
  const sq = w[0].el;
  // The glow's dotted square (8..34 of its 40 px), not the name and status block.
  expect([has(sq, "left", GLOW_SQUARE.at), has(sq, "top", GLOW_SQUARE.at), has(sq, "size", GLOW_SQUARE.size)]).toEqual([true, true, true]);
  expect(GLOW_SQUARE).toEqual({ at: 8, size: 26 });
  // 2 px off the square: inside the 40 px slot, so the jar's wall never cuts them.
  const out = sq.kids.filter(isTick).map((k: El) => k.calls.find(([n]) => n === "left" || n === "right")![1][0]);
  expect(out).toEqual([-2, -2]);
  expect(GLOW_SQUARE.at - 2).toBeGreaterThanOrEqual(0);
  // Nobody else in that lane wears them; an agent not focused wears none.
  expect(wearers(draw()).filter((x) => x.path.includes("fly-a/2"))).toHaveLength(0);
});

test("in the jar: the pinned, focused agent's ticks frame its square too", () => {
  termsNow = [{ address: "a/1", labels: { "herdr.pinned": "1", "nocturne.pinned-at": "1" } }];
  const w = wearers(draw()).filter((x) => x.path.includes("fly-a/1"));
  expect(w).toHaveLength(1);
  expect(has(w[0].el, "size", GLOW_SQUARE.size)).toBe(true);
});

const { SHOWN_INSET } = await import("../defaults/mods/nocturne/spaces.js");

test("open sidebar: the shown space's row wears the corner ticks on its plate, the others none", () => {
  const w = wearers(draw());
  const shown = w.filter((x) => x.path.includes("space-s1"));
  expect(shown).toHaveLength(1);
  // The plate, in from the sidebar's edges, the ticks on its corners.
  expect([has(shown[0].el, "left", SHOWN_INSET), has(shown[0].el, "right", SHOWN_INSET)]).toEqual([true, true]);
  expect(SHOWN_INSET).toBeGreaterThan(0);
  expect(shown[0].el.kids.filter(isTick).map((k: El) => k.calls.find(([n]) => n === "left" || n === "right")![1][0])).toEqual([-0, -0]);
  expect(w.filter((x) => x.path.includes("space-s2"))).toHaveLength(0);
});

test("folded rail: the shown space's initials wear them, the others none", () => {
  const w = wearers(draw(true));
  expect(w.filter((x) => x.path.includes("rail-space-s1"))).toHaveLength(1);
  expect(w.filter((x) => x.path.includes("rail-space-s2"))).toHaveLength(0);
});
