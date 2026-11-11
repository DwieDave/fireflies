// A menu's ask (rename an agent, edit or delete a space, rename a pane) is
// answered after a render, from a task, never inside one: GPUI refuses
// cx.notify() during render ("cx.notify() is not allowed during the `render`
// phase"), and the sidebar showed "This view could not be re-rendered" for a
// frame when a space's menu asked to delete it. Recording gpui stand-ins whose
// cx throws as GPUI does while a render runs (mock.module is process-wide:
// this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";

// ---- stand-ins

let agentsNow: any[] = [];
let sharedNow: Record<string, any> = {};
let panesNow: any[] = [];
const ran: any[] = [];
let propsNow: any = { role: "sky" };
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
  panes: () => panesNow, pickFolder: async () => null, presentUpdateNotes: () => {}, props: () => propsNow,
  run: (n: string, a: any) => { ran.push([n, a]); return null; }, setAgentOrder: () => {}, setShared: () => {}, settings: () => ({ zoom }), shared: (k: string) => sharedNow[k] ?? null,
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
  InputState: { new: () => ({ on() {}, value: () => "", set_value() {}, focus() { refuse("input.focus()"); } }) }, Input: { new: mk },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) }, VirtualListScrollHandle: { new: () => ({}) },
}));
(globalThis as any).window = { paint_path: mk };
const theme: any = new Proxy({}, { get: (_t, k) => `#${String(k)}` });

/** A nested view as cx.new hands it back: it records the props it's given. */
type Glow = { props: any[]; set_props(p: any): void };
let glows: Glow[] = [];
let timers: Function[] = [];
let rendering = false;
const refuse = (what: string) => { if (rendering) throw new TypeError(`${what} is not allowed during the \`render\` phase; request a re-render from an event handler instead`); };
const cx: any = {
  spawn: () => {}, notify() { refuse("cx.notify()"); cx.notified++; }, stop_propagation() {}, notified: 0,
  focus_handle: () => ({ focus() { refuse("focus()"); }, is_focused: () => false }),
  new: () => { const g: Glow = { props: [], set_props(p) { g.props.push(p); } }; glows.push(g); return g; },
  timer: { every() {}, after(_ms: number, f: Function) { timers.push(f); } },
};

const { default: Sky } = await import("../defaults/mods/nocturne/sky.js");
const { default: Header } = await import("../defaults/mods/nocturne/header.js");
const { EDIT_SPACE, NAME_AGENT, NAME_PANE } = await import("../defaults/mods/nocturne/menu.js");

/** A render as GPUI runs it: the cx refuses notify and focus meanwhile. */
function render(view: any) {
  rendering = true;
  try { return view.render(cx); } finally { rendering = false; }
}
/** The tasks the render left, run as GPUI runs them (after it). */
function runTasks() { const t = timers.splice(0); for (const f of t) f(cx); }

beforeEach(() => { byId = {}; timers = []; sharedNow = {}; propsNow = { role: "sky" }; agentsNow = [{ address: "a/1", status: "working", tab: "t1", space: "s1", focused: true, program: { name: "claude", agent: true } }]; });

test("open sidebar: a space's menu asks to delete it; the render that sees it draws, then a task starts the confirm", () => {
  const s: any = new Sky();
  s.init({ role: "sky" }, cx);
  s.size = { width: 252, height: 900 };
  render(s);
  sharedNow[EDIT_SPACE] = { id: "s2", kind: "delete", at: 1 };
  expect(() => render(s)).not.toThrow();
  expect(s.spaces.mode).toBe(null);
  runTasks();
  expect(s.spaces.mode).toMatchObject({ kind: "delete", s: { id: "s2" } });
  // The next render draws the confirm; the ask isn't answered twice.
  expect(() => render(s)).not.toThrow();
  expect(byId["space-s2"]).toBeDefined();
  runTasks();
  expect(timers).toEqual([]);
});

test("folded rail: the same ask goes to Herdr's confirm (space.close) from the task, not the render", () => {
  ran.length = 0;
  const s: any = new Sky();
  s.init({ role: "sky" }, cx);
  s.size = { width: 90, height: 900 };
  render(s);
  sharedNow[EDIT_SPACE] = { id: "s2", kind: "delete", at: 2 };
  expect(() => render(s)).not.toThrow();
  expect(ran.filter(([n]) => n === "space.close")).toEqual([]);
  runTasks();
  expect(ran.filter(([n]) => n === "space.close")).toEqual([["space.close", { id: "s2" }]]);
});

test("a firefly's menu asks to rename its agent: the field starts and takes the keyboard from the task", () => {
  const s: any = new Sky();
  s.init({ role: "sky" }, cx);
  s.size = { width: 252, height: 900 };
  render(s);
  sharedNow[NAME_AGENT] = { address: "a/1", at: 3 };
  expect(() => render(s)).not.toThrow();
  runTasks();
  expect(s.naming).toBe("a/1");
});

test("the pane menu asks to rename a pane: its header starts naming from the task, not the render", () => {
  panesNow = [{ pane: "p1", tab: "t1", terminal: "a/1", focused: true, cwd: "/home/a" }];
  propsNow = { role: "pane", pane: "p1" };
  const h: any = new Header();
  h.init({ role: "pane", pane: "p1" }, cx);
  sharedNow[NAME_PANE] = { terminal: "a/1", at: 4 };
  timers = [];
  expect(() => render(h)).not.toThrow();
  expect(h.naming).toBe(false);
  runTasks();
  expect(h.naming).toBe(true);
  panesNow = [];
});
