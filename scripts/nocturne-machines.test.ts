// Item 33: the fireflies' machine filter (machines.ts). Above the sky's
// fireflies a row of chips, "all" and one per machine; one chosen shows only
// that machine's fireflies; the choice is kept (shared nocturne.machine); with
// one machine the row isn't drawn; in "all" each firefly's name wears its
// machine's tag. The draw stays one listing (kit.ts oneListing): three spaces
// on two machines, fourteen labelled agents, one terminals() per draw.
// Recording herdr and gpui stand-ins (mock.module is process-wide: this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";

let agentsNow: any[] = [];
let sharedNow: Record<string, any> = {};
let machinesNow: any[] = [];
let spacesNow: any[] = [];
let termsNow: any[] = [];
let order: string[] = [];
const asked: Record<string, number> = {};
const count = (k: string) => { asked[k] = (asked[k] ?? 0) + 1; };
const herdr: Record<string, any> = {
  agents: () => { count("agents"); return agentsNow; },
  appHome: () => "/tmp/app", closeOverlay: () => {}, commands: () => [],
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => ({ space: "s1", tab: "t1", pane: "p1", terminal: "a/1", block: null }),
  hc: async () => ({ code: 0, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: () => [],
  layout: () => ({ id: "sidebar", type: "block", content: { mod: "nocturne", props: { role: "sky" } } }), layouts: () => ["nocturne"],
  machines: () => { count("machines"); return machinesNow; },
  nextCommand: () => new Promise<string>(() => {}), notify: () => {}, openOverlay: () => "o1",
  panes: () => [], pickFolder: async () => null, presentUpdateNotes: () => {}, props: () => ({ role: "sky" }),
  run: () => null, setAgentOrder: (o: string[]) => { order = o; }, setShared: (k: string, v: any) => { sharedNow[k] = v; }, settings: () => ({ zoom: 0.9 }), shared: (k: string) => sharedNow[k] ?? null,
  spaces: () => { count("spaces"); return spacesNow; },
  terminals: () => { count("terminals"); return termsNow; }, theme: () => theme, updates: () => null, window: () => ({ platform: "macos", active: true }),
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
const cx: any = {
  spawn: () => {}, notify() { cx.notified++; }, stop_propagation() {}, notified: 0,
  focus_handle: () => ({ focus() {}, is_focused: () => false }),
  new: () => ({ set_props() {} }), timer: { every() {}, after() {} },
};

const { default: Sky } = await import("../defaults/mods/nocturne/sky.ts");
const { machineTags, machineNames, MACHINE_KEY } = await import("../defaults/mods/nocturne/machines.ts");

/** Every element under one, itself first. */
const all = (el: any): any[] => (el && typeof el === "object" && el.calls ? [el, ...el.kids.flatMap(all)] : []);
/** The words drawn under an element. */
const words = (el: any): string[] => all(el).flatMap((e: any) => e.kids.filter((k: any) => typeof k === "string"));
const STATUSES = ["working", "blocked", "done", "idle"];

/** Three spaces: two here, one on "mini"; seven agents on each machine, every terminal labelled. */
function world(twoMachines = true) {
  machinesNow = twoMachines ? [{ name: null, layout: "ready" }, { name: "mini", layout: "ready" }] : [{ name: null, layout: "ready" }];
  spacesNow = [
    { id: "s1", name: "one", active: true, machine: null, tabs: [{ id: "t1", index: 1, active: true, name: "1" }] },
    { id: "s2", name: "two", active: false, machine: null, tabs: [{ id: "t2", index: 1, active: true, name: "1" }] },
    ...(twoMachines ? [{ id: "mini/s3", name: "three", active: false, machine: "mini", tabs: [{ id: "mini/t3", index: 1, active: true, name: "1" }] }] : []),
  ];
  const where = (i: number) => (!twoMachines || i < 7 ? (i % 2 ? ["s2", "t2", "two"] : ["s1", "t1", "one"]) : ["mini/s3", "mini/t3", "three"]);
  agentsNow = Array.from({ length: 14 }, (_, i) => {
    const [space, tab, space_name] = where(i);
    return { address: `${space.startsWith("mini") ? "mini/" : ""}a/${i}`, status: STATUSES[i % 4], space, tab, space_name, pane: `p${i}`, tab_index: 1, tab_name: "1",
      focused: i === 0, seq: i, pinned: i === 1 || i === 8, command: false, app: "claude-code", title: "claude", pane_name: null,
      program: { key: "claude", name: "Claude Code", agent: true } };
  });
  // Each terminal as listed: its labels and a long argv, as an agent started with a brief carries.
  termsNow = agentsNow.map((a, i) => ({ address: a.address, labels: { "nocturne.name": `agent ${i}`, "herdr.pinned": a.pinned ? "1" : "" }, argv: ["claude", "x".repeat(4000)], state: "live" }));
}

function sky(width = 252) {
  const s: any = new Sky();
  s.init({ role: "sky" }, cx);
  s.size = { width, height: 2400 };
  s.field = { width: 252 * 0.9, height: 2000 * 0.9 };
  return s;
}
const draw = (s: any) => { byId = {}; return s.render(cx); };
const lanes = () => Object.keys(byId).filter((k) => k.startsWith("lane-")).map((k) => k.slice(5)).sort();
const local = () => agentsNow.filter((a) => !a.space.startsWith("mini")).map((a) => a.address).sort();
const remote = () => agentsNow.filter((a) => a.space.startsWith("mini")).map((a) => a.address).sort();

beforeEach(() => { sharedNow = {}; order = []; for (const k of Object.keys(asked)) delete asked[k]; world(); });

test("one machine: no bar, no tags, every firefly", () => {
  world(false);
  draw(sky());
  expect(byId["machines"]).toBeUndefined();
  expect(lanes()).toEqual(agentsNow.map((a) => a.address).sort());
  for (const a of agentsNow) expect(words(byId[`lane-${a.address}`])).not.toContain("~");
});

test("two machines, all: the bar's chips; every firefly, each with its machine's tag", () => {
  draw(sky());
  expect(byId["machines"]).toBeDefined();
  expect(words(byId["machines"])).toEqual(["all", "this mac", "mini"]);
  // "all" is lit: its dithered foot.
  expect(byId["machine-all"].kids.length).toBe(2);
  expect(byId["machine-mini"].kids.length).toBe(1);
  expect(lanes()).toEqual(agentsNow.map((a) => a.address).sort());
  for (const a of local()) expect(words(byId[`lane-${a}`])).toContain("~");
  for (const a of remote()) expect(words(byId[`lane-${a}`])).toContain("M");
});

test("choosing a machine with the keyboard's cursor: only its fireflies, no tags; kept for the next sky", () => {
  const s = sky();
  draw(s);
  const chip = s.navList.find((x: any) => x.id === "machine:mini");
  expect(chip?.sec).toBe("flies");
  chip.go(cx);
  expect(sharedNow[MACHINE_KEY.name]).toEqual({ machine: "mini" });
  draw(s);
  expect(lanes()).toEqual(remote());
  for (const a of remote()) expect(words(byId[`lane-${a}`])).not.toContain("M");
  expect([...order].sort()).toEqual(remote());
  // A sky made after a restart reads the kept choice.
  draw(sky());
  expect(lanes()).toEqual(remote());
  // This machine, by a click on its chip.
  draw(s);
  byId["machine-~"].calls.find(([n]: any) => n === "on_click")[1][0]({}, cx);
  expect(sharedNow[MACHINE_KEY.name]).toEqual({ machine: null });
  draw(s);
  expect(lanes()).toEqual(local());
  // And all again.
  s.navList.find((x: any) => x.id === "machine:all").go(cx);
  expect(sharedNow[MACHINE_KEY.name]).toBe(null);
  draw(s);
  expect(lanes()).toEqual(agentsNow.map((a) => a.address).sort());
});

test("the folded rail shows the chosen machine's fireflies too", () => {
  sharedNow[MACHINE_KEY.name] = { machine: "mini" };
  draw(sky(90));
  expect([...order].sort()).toEqual(remote());
});

test("a chosen machine that's gone: all of them, the choice kept for its return", () => {
  sharedNow[MACHINE_KEY.name] = { machine: "studio" };
  draw(sky());
  expect(lanes()).toEqual(agentsNow.map((a) => a.address).sort());
  expect(sharedNow[MACHINE_KEY.name]).toEqual({ machine: "studio" });
});

test("tags: this machine ~, the others the shortest start of their name no other shares", () => {
  expect([...machineTags([null, "mini", "mac-studio", "pi"]).values()]).toEqual(["~", "MI", "MA", "P"]);
  expect(machineNames([{ name: null }, { name: "mini" }], ["box", null, "mini"])).toEqual([null, "mini", "box"]);
});

test("the draw's cost: one terminals() and one machines() a draw; fourteen agents within the budget", () => {
  const s = sky();
  draw(s);
  for (const k of Object.keys(asked)) delete asked[k];
  const n = 50;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) draw(s);
  const ms = (performance.now() - t0) / n;
  expect(asked.terminals / n).toBe(1);
  expect(asked.machines / n).toBe(1);
  // spaces() (small: no argv) is read by the sky, its spaces and the jar; the filter reads none of its own.
  expect(asked.spaces / n).toBeLessThanOrEqual(3);
  console.log(`sky draw, 14 agents on 2 machines, 3 spaces: ${ms.toFixed(2)} ms; per draw: ${JSON.stringify(Object.fromEntries(Object.entries(asked).map(([k, v]) => [k, v / n])))}`);
  expect(ms).toBeLessThan(16);
});
