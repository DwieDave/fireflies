// The pointer's own firefly (glow.js, sky.js): the sky's real mouse handlers,
// driven through recording gpui stand-ins, place the glow on the art's grid,
// rebuild only the glow's nested view (never the sky), hold it still under
// calm(), and fade it out, then take it out of the tree, when the pointer
// leaves (mock.module is process-wide: this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";

// ---- stand-ins

let windowNow: any = { platform: "linux", active: true };
let zoom = 1;
const herdr: Record<string, any> = {
  agents: () => [{ address: "a/1", status: "working", tab: "t1", space: "s1", focused: true, program: { key: "", name: "", icon: null, tint: false, tile: null, color: null, shell: false, agent: false } }],
  appHome: () => "/tmp/app", closeOverlay: () => {}, commands: () => [],
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => ({ space: "s1", tab: "t1", pane: "p1", terminal: "a/1", block: null }),
  hc: async () => ({ code: 0, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: () => [],
  layout: () => ({ id: "sidebar", type: "block", content: { mod: "nocturne", props: { role: "sky" } } }), layouts: () => ["nocturne"],
  nextCommand: () => new Promise<string>(() => {}), notify: () => {}, openOverlay: () => "o1",
  panes: () => [], pickFolder: async () => null, presentUpdateNotes: () => {}, props: () => ({ role: "sky" }),
  run: () => null, setAgentOrder: () => {}, setShared: () => {}, settings: () => ({ zoom }), shared: () => null,
  spaces: () => [{ id: "s1", name: "one", active: true, tabs: [{ id: "t1", index: 1, active: true, name: "1" }] }],
  terminals: () => [], theme: () => theme, updates: () => null, window: () => windowNow,
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

const { placeGlow, nextGlow, drawGlow, GONE_AFTER, PULSE, PULSE_FRAMES, pulseFrame, Fireglow } = await import("../defaults/mods/nocturne/glow.ts");
const { default: Sky } = await import("../defaults/mods/nocturne/sky.ts");

beforeEach(() => { windowNow = { platform: "linux", active: true }; zoom = 1; byId = {}; glows = []; timers = []; cx.notified = 0; });

/** Every call in a drawn tree, by name. */
function calls(el: El, out: [string, any[]][] = []) {
  if (!el?.calls) return out;
  out.push(...el.calls);
  for (const k of el.kids) calls(k, out);
  return out;
}
const named = (el: El, name: string) => calls(el).filter(([n]) => n === name);

/** A drawn sky (open, or folded to the rail), its glow entities, and its root's handlers. */
function sky(folded = false) {
  const s = new Sky();
  s.init({ role: "sky" }, cx);
  s.size = { width: folded ? 90 : 252, height: 900 };
  s.render(cx);
  const root = byId["sky"];
  const handler = (name: string) => root.calls.find(([n]) => n === name)![1][0];
  cx.notified = 0;
  return { s, glow: glows[0], list: glows[1], move: handler("on_mouse_move"), hover: handler("on_hover") };
}

// ---- placing it

test("the glow sits on the pointer, in layout px, snapped to the art's 2 px cells", () => {
  expect(placeGlow({ x: 99, y: 47.2 })).toEqual({ x: 100, y: 48 });
  expect(placeGlow({ x: 98.9, y: 46.9 })).toEqual({ x: 98, y: 46 });
  // As drawn at zoom 0.9: 90 drawn px are 100 layout px.
  expect(placeGlow({ x: 90, y: 180 }, 0.9)).toEqual({ x: 100, y: 200 });
  expect(placeGlow({ x: 0, y: 0 }, 0)).toEqual({ x: 0, y: 0 });
});

test("a move inside the same cell changes nothing; leaving keeps its place to fade there", () => {
  const on = nextGlow(null, { x: 40, y: 60 }, 1, false);
  expect(on).toEqual({ on: true, x: 40, y: 60, calm: false });
  expect(nextGlow(on, { x: 40.6, y: 60.4 }, 1, false)).toBeNull();
  expect(nextGlow(on, { x: 44, y: 60 }, 1, false)).toEqual({ on: true, x: 44, y: 60, calm: false });
  // calm() turning is news even in the same cell.
  expect(nextGlow(on, { x: 40, y: 60 }, 1, true)).toEqual({ on: true, x: 40, y: 60, calm: true });
  const off = nextGlow(on, null, 1, false);
  expect(off).toEqual({ on: false, x: 40, y: 60, calm: false });
  expect(nextGlow(off, null, 1, false)).toBeNull();
  expect(nextGlow(null, null, 1, false)).toBeNull();
});

// ---- the sky's handlers

test("moving over the sky rebuilds only the glow's own view, never the sky", () => {
  const { glow, move } = sky();
  move({ position: { x: 120, y: 300 }, local_position: { x: 120, y: 300 } }, cx);
  move({ position: { x: 120.5, y: 300.5 }, local_position: { x: 120.5, y: 300.5 } }, cx); // the same cell
  move({ position: { x: 130, y: 310 }, local_position: { x: 130, y: 310 } }, cx);
  expect(glow.props.map((p) => [p.on, p.x, p.y, p.calm])).toEqual([[true, 120, 300, false], [true, 130, 310, false]]);
  expect(glow.props[0]).toMatchObject({ folded: false, h: 900 });
  expect(cx.notified).toBe(0);
});

test("at zoom 0.9 the glow lands under the pointer in layout px", () => {
  zoom = 0.9;
  const { glow, move } = sky();
  move({ local_position: { x: 90, y: 270 } }, cx);
  expect(glow.props.at(-1)).toMatchObject({ on: true, x: 100, y: 300 });
});

test("leaving fades it out where it was, then takes it out of the tree", () => {
  const { glow, move, hover } = sky();
  hover(true, cx);
  expect(glow.props).toEqual([]);
  move({ local_position: { x: 60, y: 80 } }, cx);
  hover(false, cx);
  expect(glow.props.at(-1)).toMatchObject({ on: false, x: 60, y: 80 });
  expect(timers.length).toBe(1);
  timers[0](cx);
  expect(glow.props.at(-1)).toMatchObject({ on: false, gone: true });
  // Leaving again changes nothing.
  hover(false, cx);
  expect(glow.props.at(-1)).toMatchObject({ gone: true });
  expect(GONE_AFTER).toBeGreaterThan(300);
});

test("back before the fade ends: the pending removal is dropped", () => {
  const { glow, move, hover } = sky();
  move({ local_position: { x: 60, y: 80 } }, cx);
  hover(false, cx);
  move({ local_position: { x: 70, y: 80 } }, cx);
  timers[0](cx);
  expect(glow.props.at(-1)).toMatchObject({ on: true, x: 70 });
  expect(glow.props.some((p) => p.gone)).toBe(false);
});

test("calm (the window not in front): the glow says so", () => {
  windowNow = { platform: "linux", active: false };
  const { glow, move } = sky();
  move({ local_position: { x: 60, y: 80 } }, cx);
  expect(glow.props.at(-1)).toMatchObject({ on: true, calm: true });
});

test("on the rail a second glow lights the space list, placed by where the list starts", () => {
  const { s, glow, list, move } = sky(true);
  expect(s.folded).toBe(true);
  // The rail measures the clock and the » key above its list.
  const measure = (id: string, h: number) => byId[id].calls.find(([n]) => n === "on_size_change")![1][0]({ width: 90, height: h }, cx);
  measure("rail-clock", 50);
  measure("rail-key", 44);
  move({ local_position: { x: 44, y: 200 } }, cx);
  expect(glow.props.at(-1)).toMatchObject({ on: true, x: 44, y: 200, folded: true });
  expect(list.props.at(-1)).toMatchObject({ on: true, x: 44, y: 200, ox: 0, oy: 48 + 50 + 44 });
});

// ---- drawing it

test("drawn: a dim + at rest, a bright x on each blink with a ring opening out; it trails the pointer; calm, it holds still", () => {
  const heart = (el: El) => {
    const all = (e: El): El[] => (e?.calls ? [e, ...e.kids.flatMap(all)] : []);
    const h = all(el).find((e) => e.calls.some(([n, a]) => n === "id" && a[0] === "fireglow-heart"))!;
    return { opacity: h.calls.find(([n]) => n === "opacity")![1][0] };
  };
  const at = (frame: any) => drawGlow(theme, { on: true, x: 100, y: 200, h: 900, lift: 120, frame });
  // The pulse: rest, then two blinks, each an x with the ring, then rest again.
  expect(PULSE_FRAMES.map((f: any) => f[1]).join("")).toBe("+xx++xx+++");
  expect(PULSE_FRAMES.filter((f: any) => f[4] > 0).map((f: any) => f[4])).toEqual([16, 20, 26, 32, 16, 20, 26, 32]);
  const rest = at(PULSE_FRAMES[0]), blink = at(PULSE_FRAMES[1]);
  expect(byId["fireglow-ring"]).toBeDefined();
  expect(heart(blink).opacity).toBeGreaterThan(heart(rest).opacity);
  expect(named(blink, "transition").map(([, a]) => a[0])).toContain("left");
  // No native loop: the frames step on the view's own timers.
  expect(named(blink, "loop")).toEqual([]);
  // pulseFrame finds the frame and the wait until the next.
  expect(pulseFrame(0)).toMatchObject({ i: 0, wait: 1860 });
  expect(pulseFrame(PULSE + 1870)).toMatchObject({ i: 1, wait: 70 });
  expect(pulseFrame(2600).frame[1]).toBe("+");
  const still = drawGlow(theme, { on: true, x: 100, y: 200, calm: true, h: 900, lift: 120, frame: PULSE_FRAMES[1] });
  expect(named(still, "transition")).toEqual([]);
  expect(heart(still).opacity).toBe(heart(rest).opacity);
  // Centered on the pointer: the 48 px carrier's corner 24 px up and left.
  expect(still.calls.find(([n]) => n === "left")![1][0]).toBe(76);
  expect(still.calls.find(([n]) => n === "top")![1][0]).toBe(176);
});

test("the nested view steps the pulse on one timer at a time, none while calm or fading", () => {
  const g: any = new Fireglow();
  g.init({ on: true, x: 10, y: 10 });
  const after: number[] = [];
  const c: any = { timer: { after: (ms: number) => after.push(ms) } };
  g.render(c); g.render(c);
  expect(after.length).toBe(2);
  expect(g.tick).toBe(2); // the first timer's notify is dropped: only the latest counts
  after.length = 0;
  g.update({ on: true, x: 10, y: 10, calm: true }); g.render(c);
  g.update({ on: false, x: 10, y: 10 }); g.render(c);
  expect(after).toEqual([]);
});

test("drawn: leaving fades it, no timer; gone or never shown, nothing is drawn", () => {
  const fading = drawGlow(theme, { on: false, x: 100, y: 200 });
  expect(named(fading, "loop")).toEqual([]);
  expect(fading.calls.find(([n]) => n === "opacity")![1][0]).toBe(0);
  expect(named(fading, "transition").map(([, a]) => a[0])).toContain("opacity");
  expect(calls(drawGlow(theme, { on: false, x: 100, y: 200, gone: true }))).toEqual([]);
  expect(calls(drawGlow(theme, {}))).toEqual([]);
});

test("drawn: in its own light (ansi11), the night's stars and grass lit around it, haze only when open", () => {
  const open = drawGlow(theme, { on: true, x: 100, y: 200, h: 900, lift: 120 });
  expect(named(open, "text_color").map(([, a]) => a[0])).toContain("#ansi11");
  const svgs = (el: El) => calls(el).filter(([n]) => n === "id").map(([, a]) => a[0]).filter((id) => id.startsWith("fireglow-lit"));
  expect(svgs(open).length).toBe(8); // two steps of stars, haze, ground, grass rim
  const rail = drawGlow(theme, { on: true, x: 40, y: 200, h: 900, lift: 60, folded: true });
  expect(svgs(rail).length).toBe(6); // no haze on the rail
  // Drawn inside the rail's list: moved by where the list sits.
  const inList = drawGlow(theme, { on: true, x: 40, y: 200, calm: true, ox: 0, oy: 142 });
  expect(inList.calls.find(([n]) => n === "top")![1][0]).toBe(200 - 24 - 142);
});
