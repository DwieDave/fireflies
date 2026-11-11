// An agent's row in the sidebar is pressed anywhere on it: the full width
// (the jar's inner width in the jar) and half the gap to each neighbour, not
// only the firefly and its name; on the rail the cell and the padding around
// it. The sky drawn through recording gpui stand-ins; a press is the hit
// layer's own handler, called as GPUI would (mock.module is process-wide:
// this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";

// ---- stand-ins

let agentsNow: any[] = [];
const ran: any[] = [];
const opened: any[] = [];
let termsNow: any[] = [];
let windowNow: any = { platform: "linux", active: true };
let zoom = 1;
const herdr: Record<string, any> = {
  agents: () => agentsNow,
  appHome: () => "/tmp/app", closeOverlay: () => {}, commands: () => [],
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => ({ space: "s1", tab: "t1", pane: "p1", terminal: "a/1", block: null }),
  hc: async () => ({ code: 0, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: () => [],
  layout: () => ({ id: "sidebar", type: "block", content: { mod: "nocturne", props: { role: "sky" } } }), layouts: () => ["nocturne"],
  nextCommand: () => new Promise<string>(() => {}), notify: () => {}, openOverlay: (o: any) => { opened.push(o); return "o1"; },
  panes: () => [], pickFolder: async () => null, presentUpdateNotes: () => {}, props: () => ({ role: "sky" }),
  run: (n: string, a: any) => { ran.push([n, a]); return null; }, setAgentOrder: () => {}, setShared: () => {}, settings: () => ({ zoom }), shared: () => null,
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

const { default: Sky, laneReach } = await import("../defaults/mods/nocturne/sky.js");

const agent = (address: string, status: string, focused = false) => ({ address, status, tab: "t1", space: "s1", focused, program: { name: address, agent: true } });
beforeEach(() => { byId = {}; ran.length = 0; opened.length = 0; termsNow = []; zoom = 0.9; });

function draw(folded = false) {
  const s: any = new Sky();
  s.init({ role: "sky" }, cx);
  s.size = { width: folded ? 90 : 252, height: 900 };
  s.field = { width: 252 * 0.9, height: 700 * 0.9 };
  s.render(cx);
  return s;
}
const arg = (el: El, name: string) => el.calls.filter(([n]) => n === name).at(-1)?.[1][0];
const handler = (el: El, name: string, button?: string) => el.calls.find(([n, a]) => n === name && (button == null || a[0] === button))![1].at(-1);
/** A lane's box and its hit layer's, in the meadow's layout px. */
function row(address: string) {
  const lane = byId[`lane-${address}`], hit = byId[`hit-${address}`];
  const y = arg(lane, "top"), left = arg(lane, "left") ?? 0, h = arg(lane, "h");
  return { y, h, left, width: arg(lane, "w"), hit: { left: left + arg(hit, "left"), width: arg(hit, "w"), top: y + arg(hit, "top"), bottom: y + arg(hit, "top") + arg(hit, "h") }, el: hit };
}

test("laneReach: half of each gap to each side, none across the jar's glass", () => {
  expect(laneReach([{ y: 0, h: 40, jar: false }, { y: 46, h: 40, jar: false }, { y: 93, h: 28, jar: false }])).toEqual([
    { up: 0, down: 3 }, { up: 3, down: 3 }, { up: 4, down: 0 }]);
  expect(laneReach([{ y: 38, h: 40, jar: true }, { y: 160, h: 40, jar: false }])).toEqual([{ up: 0, down: 0 }, { up: 0, down: 0 }]);
  // Placed out of order: still by y.
  expect(laneReach([{ y: 50, h: 10, jar: false }, { y: 0, h: 10, jar: false }])).toEqual([{ up: 20, down: 0 }, { up: 0, down: 20 }]);
});

test("the list: a press in the gap between two rows, right of a short name or left of the firefly opens that agent", () => {
  agentsNow = [agent("a/1", "working"), agent("a/2", "working"), agent("a/3", "blocked")];
  draw();
  const rows = ["a/3", "a/1", "a/2"].map(row).sort((p, q) => p.y - q.y);
  for (const r of rows) {
    // Full width, from the sidebar's edge (left of the firefly, right of any name).
    expect([r.hit.left, r.hit.width]).toEqual([r.left, r.width]);
  }
  // No dead strip: each row's area ends where the next one's starts, and the gaps were real.
  for (let k = 0; k + 1 < rows.length; k++) {
    expect(rows[k].hit.bottom).toBe(rows[k + 1].hit.top);
    expect(rows[k + 1].y).toBeGreaterThan(rows[k].y + rows[k].h);
  }
  // Its handlers: a click focuses that agent, a right-click opens its menu.
  const r = row("a/1");
  handler(r.el, "on_click")({ click_count: 1 }, cx);
  expect(ran.at(-1)).toEqual(["agent.focus", { terminal: "a/1" }]);
  handler(r.el, "on_mouse_down", "right")({}, cx);
  expect(opened.at(-1)?.props?.target?.address ?? opened.at(-1)?.props?.tab).toBeTruthy();
  // The firefly-and-name block has no handlers of its own any more (no double press).
  expect(byId["fly-a/1"].calls.some(([n]) => n === "on_click" || n === "on_mouse_down")).toBe(false);
});

test("the jar: the jar's inner width, each pinned row's area touching the next", () => {
  agentsNow = [agent("a/1", "working", true), agent("a/2", "idle"), agent("a/3", "working")];
  termsNow = ["a/1", "a/2"].map((address, i) => ({ address, labels: { "herdr.pinned": "1", "nocturne.pinned-at": String(i + 1) } }));
  draw();
  const [p, q] = ["a/1", "a/2"].map(row).sort((m, n) => m.y - n.y);
  expect(p.left).toBeGreaterThan(0); // inside the jar's walls
  for (const r of [p, q]) expect([r.hit.left, r.hit.width]).toEqual([r.left, r.width]);
  expect(p.hit.bottom).toBe(q.hit.top);
  // Not across the glass to the row under the jar.
  const out = row("a/3");
  expect(out.hit.top).toBe(out.y);
  handler(q.el, "on_click")({ click_count: 1 }, cx);
  expect(ran.at(-1)).toEqual(["agent.focus", { terminal: "a/2" }]);
});

test("the rail: the cell and the padding around it; the ground's pairs only half their gap", () => {
  agentsNow = [agent("a/1", "working"), ...Array.from({ length: 6 }, (_, i) => agent(`r/${i}`, "idle"))];
  draw(true);
  const hit = byId["rail-hit-a/1"];
  expect([arg(hit, "left"), arg(hit, "top"), arg(hit, "w"), arg(hit, "h")]).toEqual([-8, -1, 48, 34]);
  handler(hit, "on_click")({}, cx);
  expect(ran.at(-1)).toEqual(["agent.focus", { terminal: "a/1" }]);
  const pair = byId["rail-hit-r/0"];
  expect([arg(pair, "left"), arg(pair, "top")]).toEqual([-1, -1]);
});
