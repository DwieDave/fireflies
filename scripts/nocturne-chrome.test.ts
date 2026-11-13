// The sidebar's chrome (Developer's round of fixes): the jar's layout (one
// firefly centered, air above the shelf, the shelf's insets), the walk
// (nocturne.agent-next / agent-prev: agents, then the shelf's tiles), with
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
  spaces: () => spacesNow, terminals: () => terminalsNow, theme: () => theme, updates: () => null,
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

let timers: Function[] = [];
const cx: any = {
  spawn: (f: Function) => { Promise.resolve().then(() => f(cx)).catch(() => {}); },
  notify() {}, stop_propagation() { cx.stopped = true; }, focus_handle: () => ({ focus() {}, is_focused: () => true }),
  new: () => ({ set_props() {} }),
  timer: { every() {}, after: (_ms: number, f: Function) => { timers.push(f); } },
};

const { default: Sky } = await import("../defaults/mods/nocturne/sky.ts");
const pins = await import("../defaults/mods/nocturne/pins.ts");
const walk = await import("../defaults/mods/nocturne/walk.ts");
const { jarPlan, SHELF_PAD, shelfHeight } = await import("../defaults/mods/nocturne/sky.ts");
const { GLOW_SQUARE } = await import("../defaults/mods/nocturne/kit.ts");

beforeEach(() => {
  sharedState = {}; commands = []; labels = []; overlays = []; queue = []; waiting = []; timers = [];
  spacesNow = [{ id: "s1", name: "one", active: true, tabs: [{ id: "c1", index: 1, active: true, name: "1" }] }];
  panesNow = []; agentsNow = []; terminalsNow = []; focusedNow = null;
});

// ---- item 1: one firefly sits in the middle of the jar

// The jar's numbers as sky.js draws them (layout px): its box starts at JAR.at,
// the glass's body under the lid and shoulders at JAR.at + JAR_BODY, its base
// 5 px tall at the foot (2 px solid, 3 px dithered).
const JAR_AT = 4, JAR_BODY = 28, BASE = 5;
const bodyMid = (jarH: number) => (JAR_AT + JAR_BODY + jarH - BASE) / 2;

test("one resting firefly in a short jar sits in the middle of its glass", () => {
  const plan = jarPlan([28], 0);
  expect(plan.jarH).toBe(112); // held at its least height
  const mid = plan.ys[0] + 28 / 2;
  expect(Math.abs(mid - bodyMid(plan.jarH))).toBeLessThanOrEqual(1);
  // as much glass over it as under it (between the first lane's place and the glass's foot)
  expect(plan.ys[0] - 38).toBe(plan.jarH - 12 - (plan.ys[0] + 28));
});

test("one awake firefly (a 40 px lane) is centered too; a full jar starts under its lid", () => {
  const one = jarPlan([40], 0);
  expect(Math.abs(one.ys[0] + 20 - bodyMid(one.jarH))).toBeLessThanOrEqual(1);
  const three = jarPlan([40, 40, 28], 0);
  expect(three.ys).toEqual([38, 78, 118]); // taller than the least height: nothing to center
  expect(three.jarH).toBe(38 + 108 + 12);
});

test("a shelf alone in a short jar is centered; under fireflies it sits at the jar's foot", () => {
  const shelf = shelfHeight(2, 232);
  const alone = jarPlan([], shelf);
  if (alone.jarH === 112) expect(alone.shelfY - 38).toBe(alone.jarH - 12 - (alone.shelfY + shelf));
  const under = jarPlan([28], shelf);
  expect(under.shelfY + shelf + 12).toBe(under.jarH);
});

// ---- item 2: air above the shelf line, the tiles in from the wall

test("the shelf's board sits clear of the last firefly's halo", () => {
  const plan = jarPlan([28], shelfHeight(2, 232));
  const laneEnd = plan.ys[0] + 28;
  // the halo (40 px) hangs 6 px under a resting lane: the board starts a clear 4 px+ below that
  expect(plan.shelfY - laneEnd).toBeGreaterThanOrEqual(6 + 4);
});

test("the shelf's tiles and caption start where a firefly's square does, clear of the glass", () => {
  // A jar lane's firefly: its mark's box 6 px into the lane, the glow's square GLOW_SQUARE.at into that.
  expect(SHELF_PAD).toBe(6 + GLOW_SQUARE.at);
  // the focused tile's corner ticks (3 px out) stay off the jar's inner wall
  expect(SHELF_PAD - 3).toBeGreaterThanOrEqual(8);
  // a 232 px shelf still holds six 28 px tiles to a row
  expect(shelfHeight(6, 232)).toBe(shelfHeight(1, 232));
  expect(shelfHeight(7, 232)).toBeGreaterThan(shelfHeight(6, 232));
});

// ---- item 3: the walk, agents then the shelf's tiles

const agentsOrder = ["t1", "t2", "t3"];
const tile = (key: string, pane: string, kind = "pane") => ({ kind, key, pane: { pane } });
const shelf = [
  tile("pane:p7", "p7"),                    // a web pane
  tile("pane:p8#tabA", "p8"),               // two pins of tabs in one web pane (webpip's records)
  tile("pane:p8#tabB", "p8"),
  { kind: "terminal", key: "t9", terminal: {}, pane: { pane: "p9" } }, // a plain shell
];
const stops = () => walk.walkStops(agentsOrder, shelf);
const keyOf = (s: any) => s?.key;

test("the walk's order: the agents, then every shelf tile in shelf order", () => {
  expect(stops().map(keyOf)).toEqual(["t1", "t2", "t3", "pane:p7", "pane:p8#tabA", "pane:p8#tabB", "t9"]);
});

test("next wraps from the last tile to the first agent, previous from the first agent to the last tile", () => {
  const s = stops();
  expect(keyOf(walk.walkNext(s, walk.walkAt(s, { terminal: "t3" }), 1))).toBe("pane:p7");
  expect(keyOf(walk.walkNext(s, walk.walkAt(s, { pane: "p9", terminal: "t9" }), 1))).toBe("t1");
  expect(keyOf(walk.walkNext(s, walk.walkAt(s, { terminal: "t1" }), -1))).toBe("t9");
  expect(keyOf(walk.walkNext(s, walk.walkAt(s, { pane: "p7" }), -1))).toBe("t3");
});

test("tab pins sharing a pane are told apart by where the walk went last", () => {
  const s = stops();
  expect(keyOf(walk.walkNext(s, walk.walkAt(s, { pane: "p8" }, "pane:p8#tabA"), 1))).toBe("pane:p8#tabB");
  expect(keyOf(walk.walkNext(s, walk.walkAt(s, { pane: "p8" }, "pane:p8#tabB"), 1))).toBe("t9");
  expect(keyOf(walk.walkNext(s, walk.walkAt(s, { pane: "p8" }, null), -1))).toBe("pane:p7"); // unknown: the first of them
});

test("from no stop next starts at the first agent, previous at the last tile; nothing to walk: nothing", () => {
  const s = stops();
  expect(keyOf(walk.walkNext(s, walk.walkAt(s, { pane: "elsewhere" }), 1))).toBe("t1");
  expect(keyOf(walk.walkNext(s, walk.walkAt(s, null), -1))).toBe("t9");
  expect(walk.walkNext([], -1, 1)).toBe(null);
  // no agents: the tiles alone
  expect(walk.walkStops([], shelf).map(keyOf)[0]).toBe("pane:p7");
  // a terminal both an agent and on the shelf is walked once, as an agent
  expect(walk.walkStops(["t9"], shelf).filter((x: any) => x.key === "t9")).toHaveLength(1);
});

test("the agent shown in a pane counts as that agent (terminal.show)", () => {
  const s = stops();
  expect(walk.walkAt(s, { pane: "p1", terminal: "t1", shown: "t2" })).toBe(1);
});

// The sky's command loop, end to end: real jar items from shared pins, the
// keys going through the sky (nocturne.agent-next / agent-prev).
async function send(c: string) {
  await new Promise((r) => setTimeout(r, 0));
  waiting.shift()!(c);
  await new Promise((r) => setTimeout(r, 0));
}

test("nocturne.agent-next walks agents, a pinned web pane, and back; agent-prev the other way", async () => {
  panesNow = [
    { pane: "p1", tab: "c1", terminal: "t1", program: { agent: true }, focused: true },
    { pane: "p2", tab: "c1", terminal: "t2", program: { agent: true }, focused: false },
    { pane: "p3", tab: "c1", terminal: null, mod: "browser", props: { slot: "w1" }, focused: false, parked: false },
  ];
  agentsNow = [
    { address: "t1", status: "working", tab: "c1", space: "s1", focused: true },
    { address: "t2", status: "working", tab: "c1", space: "s1", focused: false },
  ];
  terminalsNow = [{ address: "t1", state: "live", labels: {} }, { address: "t2", state: "live", labels: {} }];
  sharedState[pins.PANES_KEY] = [{ pane: "p3", mod: "browser", props: { slot: "w1" }, at: 1 }];

  const s = new Sky();
  s.init({ role: "sky" }, cx);
  focusedNow = { pane: "p2", terminal: "t2" };
  await send("nocturne.agent-next");
  expect(commands.at(-1)).toEqual(["pane.focus", { pane: "p3" }]);
  focusedNow = { pane: "p3", terminal: null };
  await send("nocturne.agent-next");
  expect(commands.at(-1)).toEqual(["agent.focus", { terminal: "t1" }]);
  focusedNow = { pane: "p1", terminal: "t1" };
  await send("nocturne.agent-prev");
  expect(commands.at(-1)).toEqual(["pane.focus", { pane: "p3" }]);
  focusedNow = { pane: "p3", terminal: null };
  await send("nocturne.agent-prev");
  expect(commands.at(-1)).toEqual(["agent.focus", { terminal: "t2" }]);
});
