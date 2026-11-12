// Dragging a tab along nocturne's strip (tabs.js, tabdrag.js): the strip's
// real mouse handlers, driven through recording gpui stand-ins, put the stake
// where the tab then lands, at both ends too (mock.module is process-wide:
// this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";

// ---- stand-ins

let spacesNow: any[] = [];
let commands: [string, any][] = [];
const sharedState: Record<string, unknown> = {};

const herdr: Record<string, any> = {
  agents: () => [], appHome: () => "/tmp/app", closeOverlay: () => {},
  commands: () => [], exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => null,
  hc: async () => ({ code: 0, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: () => [],
  layout: () => ({ id: "root", type: "block", content: { mod: "nocturne", props: { role: "tabs" } } }), layouts: () => ["nocturne"],
  nextCommand: () => new Promise<string>(() => {}),
  notify: () => {}, openOverlay: () => "o1", panes: () => [], pickFolder: async () => null, presentUpdateNotes: () => {},
  props: () => ({ role: "tabs" }),
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  setAgentOrder: () => {}, setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  settings: () => ({ zoom: 1 }), shared: (k: string) => sharedState[k] ?? null,
  spaces: () => spacesNow, terminals: () => [], theme: () => theme, updates: () => null,
  window: () => ({ platform: "linux" }),
};
mock.module("herdr", () => herdr);

/** An element that records what was built: its calls (id, handlers, sizes) and children. */
type El = { calls: [string, any[]][]; kids: El[] } & Record<string, any>;
function mk(): El {
  const t: any = { calls: [], kids: [] };
  const p: any = new Proxy(t, {
    get: (_t, k) => {
      if (k === "calls" || k === "kids") return t[k];
      if (k === "then") return undefined;
      return (...a: any[]) => {
        t.calls.push([String(k), a]);
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
  spawn: () => {}, notify() { cx.notified = true; }, stop_propagation() {},
  focus_handle: () => ({ focus() {}, is_focused: () => false }), timer: { every() {}, after() {} },
};

const drag = await import("../defaults/mods/nocturne/tabdrag.js");
const { default: Tabs } = await import("../defaults/mods/nocturne/tabs.js");

// ---- helpers

/** The element built with this id, anywhere under `el`. */
function find(el: El, id: string): El | null {
  if (el.calls.some(([k, a]) => k === "id" && a[0] === id)) return el;
  for (const k of el.kids) { const f = k && typeof k === "object" || typeof k === "function" ? find(k, id) : null; if (f) return f; }
  return null;
}
/** The handler an element registered (`on_mouse_down`, "left"), or `on_mouse_move`. */
function handler(el: El, name: string, button?: string) {
  const c = el.calls.find(([k, a]) => k === name && (button === undefined || a[0] === button));
  return c ? c[1][c[1].length - 1] : null;
}
const isStake = (k: El) => k.calls.some(([n, a]) => n === "left" && a[0] === -3) && k.calls.some(([n, a]) => n === "w" && a[0] === 8);
const isLift = (k: El) => k.calls.some(([n, a]) => n === "border" && a[0] === 1) && k.calls.some(([n, a]) => n === "border_color" && a[0] === "#accent");

const WIDTH = 100;
let strip: any;
let root: El;
function draw() { root = strip.render(cx); return root; }
/** A press on tab `id` at window x. */
function down(id: string, x: number) { handler(find(root, `tab-${id}`)!, "on_mouse_down", "left")({ position: { x, y: 10 }, click_count: 1 }, cx); }
/** The pointer over tab `id`, `frac` of the way across it (window x follows). */
function over(id: string | null, frac: number, x: number) {
  const el = find(root, id == null ? "tab-end" : `tab-${id}`)!;
  handler(el, "on_mouse_move")({ position: { x, y: 10 }, local_position: { x: frac * WIDTH, y: 10 }, bounds: { x: 0, y: 0, width: WIDTH, height: 36 } }, cx);
  draw();
}
/** Letting go: over a tab (its mouse up first), then the strip's. */
function up(id: string | null) {
  if (id) handler(find(root, `tab-${id}`)!, "on_mouse_up", "left")({ position: { x: 0, y: 0 } }, cx);
  handler(root, "on_mouse_up", "left")({ position: { x: 0, y: 0 } }, cx);
}
/** Where the stake stands: before which shown tab ("end": past the last), or null. */
function stakeAt(shown: string[]): string | null {
  for (const id of shown) if (find(root, `tab-${id}`)!.kids.some(isStake)) return id;
  return find(root, "tab-end")!.kids.some(isStake) ? "end" : null;
}

const tab = (id: string, index: number, extra = {}) => ({ id, index, active: index === 1, name: id, named: true, ...extra });

beforeEach(() => {
  commands = [];
  // e is settled (hidden from the strip); the strip shows a b c d.
  spacesNow = [{ id: "s1", name: "one", active: true, tabs: [tab("a", 1), tab("b", 2), tab("c", 3), tab("d", 4), tab("e", 5, { settled: true })] }];
  strip = new Tabs();
  strip.init({ role: "tabs" }, cx);
  draw();
});

// ---- the pure parts

test("dropIndex: before or after a tab, the end, and no move into the tab's own gaps", () => {
  const order = ["a", "b", "c", "d"];
  expect(drag.dropIndex(order, "b", { id: "d", after: true })).toBe(4);
  expect(drag.dropIndex(order, "b", { id: "d", after: false })).toBe(3);
  expect(drag.dropIndex(order, "d", { id: "a", after: false })).toBe(1);
  expect(drag.dropIndex(order, "a", { id: null, after: false })).toBe(4);
  expect(drag.dropIndex(order, "b", { id: "b", after: true })).toBe(null);
  expect(drag.dropIndex(order, "b", { id: "a", after: true })).toBe(null);
  expect(drag.dropIndex(order, "b", { id: "c", after: false })).toBe(null);
  expect(drag.dropIndex(order, "d", { id: null, after: false })).toBe(null);
  expect(drag.gapAt("x", 49, 100)).toEqual({ id: "x", after: false });
  expect(drag.gapAt("x", 50, 100)).toEqual({ id: "x", after: true });
});

// ---- the strip

test("a press that doesn't move is a click: the tab shows, nothing moves", () => {
  down("c", 300);
  over("c", 0.6, 302);
  up("c");
  expect(commands).toEqual([["tab.select", { id: "c" }]]);
  expect(stakeAt(["a", "b", "c", "d"])).toBe(null);
});

test("dragged, the tab lifts and the stake stands where it will land", () => {
  down("b", 150);
  over("c", 0.7, 270);
  expect(find(root, "tab-b")!.kids.some(isLift)).toBe(true);
  expect(find(root, "tab-c")!.kids.some(isLift)).toBe(false);
  expect(stakeAt(["a", "b", "c", "d"])).toBe("d");
  expect(root.calls.some(([k]) => k === "cursor_grabbing")).toBe(true);
  up("c");
  expect(commands).toEqual([["tab.move", { id: "b", index: 3 }]]);
  draw();
  expect(stakeAt(["a", "b", "c", "d"])).toBe(null);
  expect(find(root, "tab-b")!.kids.some(isLift)).toBe(false);
});

test("the drop lands exactly where the stake stood, for every tab and every gap, both ends too", () => {
  const shown = ["a", "b", "c", "d"];
  const gaps: [string | null, number][] = [...shown.flatMap((id) => [[id, 0.2], [id, 0.8]] as [string, number][]), [null, 0.5]];
  for (const from of shown) {
    for (const [id, frac] of gaps) {
      commands = [];
      strip.cancelDrag(cx);
      draw();
      down(from, 0);
      over(id, frac, 50);
      const mark = stakeAt(shown);
      up(id);
      const moved = commands.find(([n]) => n === "tab.move");
      if (!mark) { expect(moved).toBeUndefined(); continue; }
      expect(moved).toBeDefined();
      // Apply the move as Fireflies does (remove, insert at index - 1) and look at the strip.
      const order = ["a", "b", "c", "d", "e"].filter((x) => x !== from);
      order.splice(moved![1].index - 1, 0, from);
      const strip2 = order.filter((x) => x !== "e");
      const after = strip2[strip2.indexOf(from) + 1] ?? "end";
      expect(`${from} over ${id}:${frac} → before ${after}`).toBe(`${from} over ${id}:${frac} → before ${mark}`);
    }
  }
});

test("the ends: the first tab's left half is the front, the space past the last tab the end", () => {
  down("c", 300);
  over("a", 0.1, 20);
  expect(stakeAt(["a", "b", "c", "d"])).toBe("a");
  up("a");
  expect(commands).toEqual([["tab.move", { id: "c", index: 1 }]]);
  commands = [];
  down("a", 20);
  over(null, 0.5, 600);
  expect(stakeAt(["a", "b", "c", "d"])).toBe("end");
  up(null);
  expect(commands).toEqual([["tab.move", { id: "a", index: 5 }]]);
});

test("leaving the strip mid-drag drops nothing", () => {
  down("a", 20);
  over("c", 0.8, 300);
  expect(stakeAt(["a", "b", "c", "d"])).toBe("d");
  handler(root, "on_hover")(false, cx);
  draw();
  expect(stakeAt(["a", "b", "c", "d"])).toBe(null);
  up(null);
  expect(commands).toEqual([]);
});
