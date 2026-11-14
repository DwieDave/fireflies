// A middle click closes a pane from its header bar (Developer: "add closing
// panes by middle clicking on their pane bar/pane name? It should still give
// the dialogs on active panes/agents"): pressed and let go on the bar, it runs
// pane.close for that pane without `confirmed`, as the header's close control,
// so the app's asks stay. Not from a button, not on a press alone, not after a
// press elsewhere; left and right clicks unchanged. The parked chip does the same.
// herdr and gpui stand-ins that keep each element's handlers by id
// (mock.module is process-wide: this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";

const ids: Record<string, El> = {};
class El {
  kids: unknown[] = [];
  on: Record<string, Function[]> = {};
  constructor() {
    return new Proxy(this, {
      get: (t, k: string, proxy) => k in t ? (t as any)[k] : k === "then" ? undefined : (...a: any[]) => {
        if (k === "id") ids[a[0]] = proxy;
        else if (k === "child") t.kids.push(a[0]);
        else if (k === "children") t.kids.push(...a[0]);
        else if (k === "when") { if (a[0]) a[1](proxy); }
        else if (k === "map") return a[0](proxy);
        else if (k === "on_mouse_down" || k === "on_mouse_up") (t.on[`${k === "on_mouse_down" ? "down" : "up"}:${a[0]}`] ??= []).push(a[1]);
        else if (k === "on_mouse_down_out" || k === "on_click") (t.on[k] ??= []).push(a[0]);
        return proxy;
      },
    });
  }
}

let ran: [string, unknown][] = [];
let propsNow: unknown = { pane: "p1", terminal: "t1" };
let panesNow: any[] = [];
const herdr: Record<string, any> = {
  agents: () => [], appHome: () => "/tmp/app", closeOverlay: () => {}, commands: () => [],
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => null,
  hc: async () => ({ code: 1, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: async () => [],
  layout: () => null, layouts: () => ["nocturne"], nextCommand: () => new Promise(() => {}),
  notify: () => {}, openOverlay: () => "o1", panes: () => panesNow, props: () => propsNow,
  run: (name: string, args: unknown) => { ran.push([name, args]); return null; },
  setAgentOrder: () => {}, setShared: () => {}, settings: () => ({ zoom: 0.9 }), shared: () => null,
  spaces: () => [{ id: "s1", name: "one", active: true, tabs: [{ id: "c1", index: 1, active: true, name: "1" }] }],
  terminals: () => [], theme: () => theme, updates: () => null, window: () => ({ platform: "macos" }),
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: () => new El(), image: () => new El(), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} }
mock.module("gpui-base", () => ({
  h_flex: () => new El(), v_flex: () => new El(), v_virtual_list: () => new El(), Scrollbar: { new: () => new El() },
  InputState: { new: () => new Input() }, Input: { new: () => new El() },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) }, VirtualListScrollHandle: { new: () => ({}) },
}));
(globalThis as any).window = { paint_path: () => new El() };
const theme: any = new Proxy({}, { get: (_t, k) => String(k) });

const { default: Header } = await import("../defaults/mods/nocturne/header.ts");
const { default: Parked } = await import("../defaults/mods/nocturne/parked.ts");

const SHELL = { pane: "p1", tab: "c1", terminal: "t1", program: { key: "zsh", name: "zsh", shell: true }, focused: true, title: "zsh", cwd: "/home/a", parked: false };
const AGENT = { pane: "p2", tab: "c1", terminal: "t2", program: { key: "claude", name: "Claude Code", agent: true }, status: "working", focused: false, title: "claude", parked: false };

/** A press of `button` on `el`, as GPUI bubbles it: the element's own handlers, then its parents' (`path`, innermost first), until one stops it. */
function press(kind: "down" | "up", button: string, path: El[]): void {
  const cx: any = { stopped: false, stop_propagation() { this.stopped = true; }, notify() {} };
  for (const el of path) {
    for (const f of el.on[`${kind}:${button}`] ?? []) f({ button, position: { x: 0, y: 0 }, click_count: 1 }, cx);
    if (cx.stopped) return;
  }
}
const click = (button: string, path: El[]) => { press("down", button, path); press("up", button, path); };
const closes = () => ran.filter(([n]) => n === "pane.close");

beforeEach(() => {
  for (const k of Object.keys(ids)) delete ids[k];
  ran = [];
  panesNow = [SHELL, AGENT];
  propsNow = { pane: "p1", terminal: "t1" };
});

/** A view's context: timers that never fire, a focus handle. */
const vcx: any = { timer: { after() {}, every() {} }, notify() {}, spawn() {}, focus_handle: () => ({ focus() {}, is_focused: () => false }), stop_propagation() {} };

function header(pane = "p1") {
  propsNow = { pane, terminal: pane === "p1" ? "t1" : "t2" };
  const h: any = new Header();
  h.init(undefined, vcx);
  h.hovered = true;
  h.render(vcx);
  return { h, bar: ids[`head-${pane}`]!, name: ids[`h-n-${pane}`]!, close: ids[`h-close-${pane}`]!, zoom: ids[`h-zoom-${pane}`]! };
}

test("a middle click on the bar or the name closes that pane through pane.close, without confirmed", () => {
  const { bar, name } = header();
  click("middle", [bar]);
  expect(closes()).toEqual([["pane.close", { pane: "p1" }]]);
  click("middle", [name, bar]);
  expect(closes()).toEqual([["pane.close", { pane: "p1" }], ["pane.close", { pane: "p1" }]]);
  // An agent's pane, working: the same command (the app asks before closing it), never confirmed.
  const agent = header("p2");
  click("middle", [agent.bar]);
  expect(closes().at(-1)).toEqual(["pane.close", { pane: "p2" }]);
  expect(JSON.stringify(ran)).not.toContain("confirmed");
});

test("it closes as the header's own close control does", () => {
  const { bar, close } = header();
  click("middle", [bar]);
  for (const f of close.on.on_click ?? []) f({}, { stop_propagation() {} });
  expect(closes()).toEqual([["pane.close", { pane: "p1" }], ["pane.close", { pane: "p1" }]]);
});

test("not from a button, not on the press alone, not when the press was elsewhere", () => {
  const { bar, close, zoom } = header();
  click("middle", [close, bar]);
  click("middle", [zoom, bar]);
  expect(closes()).toEqual([]);
  // Pressed: nothing yet; let go elsewhere, then a press outside: still nothing.
  press("down", "middle", [bar]);
  expect(closes()).toEqual([]);
  for (const f of bar.on.on_mouse_down_out ?? []) f({}, {});
  press("up", "middle", [bar]);
  expect(closes()).toEqual([]);
  // A press on a button, let go on the bar: nothing.
  press("down", "middle", [zoom, bar]);
  press("up", "middle", [bar]);
  expect(closes()).toEqual([]);
});

test("left and right clicks are as they were: focus, and the pane's menu", () => {
  const { bar } = header();
  click("left", [bar]);
  click("right", [bar]);
  for (const f of bar.on.on_click ?? []) f({}, { stop_propagation() {} });
  expect(ran).toEqual([["pane.focus", { pane: "p1" }]]);
  expect(closes()).toEqual([]);
  expect(bar.on["down:right"]?.length).toBe(1);
});

test("while the pane is being named the bar doesn't close it", () => {
  const { h } = header();
  h.naming = true;
  h.render(vcx);
  click("middle", [ids["head-p1"]!]);
  expect(closes()).toEqual([]);
});

test("a parked pane's chip closes on a middle click too", () => {
  propsNow = { pane: "p2" };
  const chip: any = new Parked();
  chip.init();
  chip.render();
  click("middle", [ids["park-p2"]!]);
  expect(closes()).toEqual([["pane.close", { pane: "p2" }]]);
});
