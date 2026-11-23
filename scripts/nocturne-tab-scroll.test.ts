// More tabs than fit nocturne's strip (tabs.ts, tabscroll.ts). Developer:
// "Fix: Tab bar scrollable, hidden tabs arent reachable". The strip's real
// render and handlers, driven through recording gpui stand-ins, with a layout
// pass played here: every element's on_bounds_change fires as the engine's
// does (first, then when its place changes), and the scroll handle moves as
// GPUI's does (scroll_to_item: the least scroll that shows that child,
// clamped to the content). Zoom 0.9, as Developer runs it. mock.module is
// process-wide: this file runs alone.
import { test, expect, mock, beforeEach } from "bun:test";

// ---- the space: its tabs, changed by the commands the strip runs

type Tab = { id: string; index: number; active: boolean; name: string; named: boolean };
let tabs: Tab[] = [];
let commands: [string, any][] = [];
const sharedState: Record<string, unknown> = {};

const renumber = () => tabs.forEach((c, i) => { c.index = i + 1; });
const select = (id: string | undefined) => tabs.forEach((c) => { c.active = c.id === id; });
const activeAt = () => tabs.findIndex((c) => c.active);

function run(name: string, args?: any) {
  commands.push([name, args]);
  args ??= {};
  if (name === "tab.select") select(args.id ?? tabs[args.index - 1]?.id);
  else if (name === "tab.next") select(tabs[Math.min(activeAt() + 1, tabs.length - 1)]?.id);
  else if (name === "tab.prev") select(tabs[Math.max(activeAt() - 1, 0)]?.id);
  else if (name === "tab.move") {
    const c = tabs.find((x) => x.id === args.id)!;
    tabs = tabs.filter((x) => x !== c);
    tabs.splice(args.index - 1, 0, c);
    renumber();
  } else if (name === "tab.close") {
    const i = tabs.findIndex((x) => x.id === args.id);
    const was = tabs[i]!.active;
    tabs.splice(i, 1);
    renumber();
    if (was) select(tabs[Math.min(i, tabs.length - 1)]?.id);
  }
  return null;
}

mock.module("herdr", () => ({
  agents: () => [], appHome: () => "/tmp/app", closeOverlay: () => {},
  commands: () => [], exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => null,
  hc: async () => ({ code: 0, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: () => [],
  layout: () => ({ id: "root", type: "block", content: { mod: "nocturne", props: { role: "tabs" } } }), layouts: () => ["nocturne"],
  nextCommand: () => new Promise<string>(() => {}),
  notify: () => {}, openOverlay: () => "o1", panes: () => [], pickFolder: async () => null, presentUpdateNotes: () => {},
  props: () => ({ role: "tabs" }), run,
  setAgentOrder: () => {}, setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  settings: () => ({ zoom: Z }), shared: (k: string) => sharedState[k] ?? null,
  spaces: () => [{ id: "s1", name: "one", active: true, tabs }], terminals: () => [], theme: () => theme, updates: () => null,
  window: () => ({ platform: "macos" }),
}));

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

// The scroll handle, as GPUI's: an offset (≤ 0), a request taken at the next layout.
let off = 0;
let asked: number | null = null;
const handle = { scroll_to_item(i: number) { asked = i; }, offset: () => ({ x: off, y: 0 }), release: () => true };

mock.module("gpui-kit", () => ({ View: class {}, div: mk, svg: mk, image: mk, PathBuilder: { fill: mk }, Background: { checkerboard: mk } }));
mock.module("gpui-base", () => ({
  h_flex: mk, v_flex: mk, v_virtual_list: mk, Scrollbar: { new: mk, horizontal: mk },
  InputState: { new: () => ({ on() {}, value: () => "", set_value() {}, focus() {} }) }, Input: { new: mk },
  ScrollHandle: { new: () => handle }, VirtualListScrollHandle: { new: () => ({}) },
}));
(globalThis as any).window = { paint_path: mk };
const theme: any = new Proxy({}, { get: (_t, k) => `#${String(k)}` });

// Timers the strip starts (the drag's edge scroll); init's own are kept apart.
let notified = false;
let timers: { ms: number; fn: (later: any) => void; cancelled: boolean }[] = [];
const cx: any = {
  spawn: () => {}, notify() { notified = true; }, stop_propagation() {},
  focus_handle: () => ({ focus() {}, is_focused: () => false }),
  timer: {
    every(ms: number, fn: (later: any) => void) { const t = { ms, fn, cancelled: false }; timers.push(t); return { cancel() { t.cancelled = true; }, is_done: () => t.cancelled }; },
    after() { return { cancel() {}, is_done: () => true }; },
  },
};

const scroll = await import("../defaults/mods/nocturne/tabscroll.ts");
const { default: Tabs } = await import("../defaults/mods/nocturne/tabs.ts");

// ---- the layout pass

const Z = 0.9;
const VIEW = { x: 200, width: 600 }; // the strip's place, window px
const TAB_W = 100 * Z; // every tab 100 layout px
const FADE = scroll.fadeWidth() * Z;
const LEAD = scroll.LEAD * Z;

const idOf = (e: any): string | undefined => e?.calls?.find(([k]: [string]) => k === "id")?.[1][0];
function find(el: El, id: string): El | null {
  if (idOf(el) === id) return el;
  for (const k of el?.kids ?? []) { const f = k && (typeof k === "object" || typeof k === "function") ? find(k, id) : null; if (f) return f; }
  return null;
}
function all(el: El, pred: (e: El) => boolean, out: El[] = []): El[] {
  if (pred(el)) out.push(el);
  for (const k of el?.kids ?? []) if (k && (typeof k === "object" || typeof k === "function")) all(k, pred, out);
  return out;
}
function handler(el: El, name: string, button?: string) {
  const c = el.calls.find(([k, a]) => k === name && (button === undefined || a[0] === button));
  return c ? c[1][c[1].length - 1] : null;
}

let strip: any;
let root: El;
let reported = new Map<string, string>();

/** The strip's children as laid out at offset 0: lead-in, tabs, end (window px). */
function children(): { x: number; width: number }[] {
  const n = tabs.length;
  const used = LEAD + n * TAB_W;
  const end = Math.max(FADE, VIEW.width - used);
  return [{ x: VIEW.x, width: LEAD }, ...tabs.map((_c, i) => ({ x: VIEW.x + LEAD + i * TAB_W, width: TAB_W })), { x: VIEW.x + used, width: end }];
}
const maxScroll = () => { const k = children(); const last = k[k.length - 1]!; return Math.max(0, last.x + last.width - (VIEW.x + VIEW.width)); };

/** GPUI's scroll_to_item: the least scroll that shows child `i`, then the clamp. */
function scrollTo(i: number) {
  const c = children()[i];
  if (!c) return;
  const [l, r] = [VIEW.x, VIEW.x + VIEW.width];
  if (c.width > VIEW.width) off = l - c.x;
  else if (c.x + off < l) off = l - c.x;
  else if (c.x + c.width + off > r) off = r - (c.x + c.width);
  off = Math.min(0, Math.max(-maxScroll(), off));
}

function report(el: El | null, b: { x: number; width: number }) {
  const id = el && idOf(el);
  if (!el || !id) return;
  const box = { x: b.x, y: 0, width: b.width, height: 36 };
  const j = JSON.stringify(box);
  if (reported.get(id) === j) return; // the engine reports a place first, then only when it changes
  reported.set(id, j);
  handler(el, "on_bounds_change")?.(box, cx);
}

/** One frame: render, the layout's reports, a scroll asked for taken. Again
 *  while a handler asked for a render (cx.notify) or a scroll, as the engine. */
function frame() {
  for (let n = 0; n < 8; n++) {
    notified = false;
    root = strip.render(cx);
    report(find(root, "tab-scroll"), VIEW);
    tabs.forEach((c, i) => {
      const el = find(root, `tab-${c.id}`);
      const b = { x: VIEW.x + LEAD + i * TAB_W + off, width: TAB_W };
      report(el, b);
      for (const m of all(el!, (e) => (idOf(e) ?? "").startsWith("tab-reveal-"))) report(m, b);
    });
    if (asked !== null) scrollTo(asked);
    else if (!notified) return;
    asked = null;
  }
  throw new Error("the strip never settles");
}

/** Tab `id` stands clear of the fades (the left one only while scrolled). */
function clear(id: string): boolean {
  const i = tabs.findIndex((c) => c.id === id);
  const x = VIEW.x + LEAD + i * TAB_W + off;
  const left = VIEW.x + (off < 0 ? FADE : 0);
  const right = VIEW.x + VIEW.width - FADE;
  return x >= left - 0.5 && x + TAB_W <= right + 0.5;
}
const activeId = () => tabs.find((c) => c.active)!.id;
const markText = (id: string) => { const m = find(root, id); return m ? m.calls.filter(([k]) => k === "child").map(([, a]) => a[0]).find((x) => typeof x === "string") : null; };

function space(n: number, active = 1) {
  tabs = Array.from({ length: n }, (_, i) => ({ id: `a${i + 1}`, index: i + 1, active: i + 1 === active, name: `tab ${i + 1}`, named: true }));
}

beforeEach(() => {
  commands = []; off = 0; asked = null; timers = []; reported = new Map();
  space(12); // 12 × 90 px in a 600 px strip: about five fit
  strip = new Tabs();
  strip.init({ role: "tabs" }, cx);
  timers = [];
  frame();
});

// ---- the pure parts

test("cutOff counts the tabs past each fade; revealChild picks the neighbour that clears one", () => {
  const view = { x: 0, width: 300 };
  const at = (i: number, o = 0) => ({ x: i * 100 + o, width: 100 });
  // unscrolled: 0 1 clear, 2 under the right fade, 3 4 past it
  expect(scroll.cutOff(view, [0, 1, 2, 3, 4].map((i) => at(i)), 40, false)).toEqual({ left: 0, right: 3, scrolled: false });
  expect(scroll.cutOff(view, [at(0), at(1)], 40, false)).toEqual({ left: 0, right: 0, scrolled: false });
  // scrolled by 150: 0 gone, 1 under the left fade, 2 and 3 clear (3 ends at 250, the fade starts at 260), 4 under it
  expect(scroll.cutOff(view, [0, 1, 2, 3, 4].map((i) => at(i, -150)), 40, true)).toEqual({ left: 2, right: 1, scrolled: true });
  expect(scroll.revealChild(view, at(0), 0, 40, false)).toBe(null);
  expect(scroll.revealChild(view, at(2), 2, 40, false)).toBe(4); // the tab after it to the end
  expect(scroll.revealChild(view, at(1, -150), 1, 40, true)).toBe(1); // the one before it (child 1: tab 0) to the start
  expect(scroll.revealChild(view, at(0, -50), 0, 40, true)).toBe(0); // the first: the lead-in, back to the start
  expect(scroll.nextCut(view, [0, 1, 2, 3].map((i) => at(i)), 40, false, 1)).toBe(2);
  expect(scroll.nextCut(view, [0, 1, 2, 3].map((i) => at(i)), 40, false, -1)).toBe(null);
  expect(scroll.nextCut(view, [0, 1, 2, 3].map((i) => at(i, -150)), 40, true, -1)).toBe(1);
});

// ---- the shown tab, always in view

test("a switch by key (tab.select by number) brings a hidden tab into view", () => {
  expect(clear("a10")).toBe(false);
  run("tab.select", { index: 10 });
  frame();
  expect(activeId()).toBe("a10");
  expect(clear("a10")).toBe(true);
  // and back to the first: the strip returns to its start
  run("tab.select", { index: 1 });
  frame();
  expect(clear("a1")).toBe(true);
  expect(off).toBe(0);
});

test("a switch by command (tab.next, tab.prev), one tab at a time, keeps each in view", () => {
  for (let i = 2; i <= 12; i++) {
    run("tab.next");
    frame();
    expect(activeId()).toBe(`a${i}`);
    expect(clear(`a${i}`)).toBe(true);
  }
  for (let i = 11; i >= 1; i--) {
    run("tab.prev");
    frame();
    expect(clear(`a${i}`)).toBe(true);
  }
});

test("a click on a tab half under the fade brings it clear", () => {
  const i = tabs.findIndex((c) => !clear(c.id)); // the first one the fade covers
  const id = tabs[i]!.id;
  const el = find(root, `tab-${id}`)!;
  handler(el, "on_mouse_down", "left")({ position: { x: 700, y: 10 }, click_count: 1 }, cx);
  handler(el, "on_mouse_up", "left")({ position: { x: 700, y: 10 } }, cx);
  handler(root, "on_mouse_up", "left")({ position: { x: 700, y: 10 } }, cx);
  frame();
  expect(commands).toEqual([["tab.select", { id }]]);
  expect(clear(id)).toBe(true);
});

test("a new tab at the end, shown, comes into view", () => {
  tabs.push({ id: "a13", index: 13, active: false, name: "new", named: true });
  select("a13");
  frame();
  expect(clear("a13")).toBe(true);
});

test("a closed tab: the one shown after it is in view (closing the last, and one before the shown)", () => {
  run("tab.select", { index: 12 });
  frame();
  run("tab.close", { id: "a12" });
  frame();
  expect(activeId()).toBe("a11");
  expect(clear("a11")).toBe(true);
  // closing a tab at the start moves the rest left; the shown one stays clear
  run("tab.select", { index: 6 });
  frame();
  run("tab.close", { id: "a1" });
  frame();
  expect(clear("a7")).toBe(true);
});

test("a drag that moves the shown tab to the far end keeps it in view", () => {
  // a3 shown; dragged onto the end past the last tab (the drag test drives the same handlers)
  run("tab.select", { index: 3 });
  frame();
  commands = [];
  strip.pressed = { id: "a3", x: 0 };
  strip.drag = { id: "a3", gap: { id: null, after: false } };
  handler(root, "on_mouse_up", "left")({ position: { x: 0, y: 0 } }, cx);
  frame();
  expect(commands).toEqual([["tab.move", { id: "a3", index: 12 }]]);
  expect(tabs.at(-1)!.id).toBe("a3");
  expect(clear("a3")).toBe(true);
});

test("the strip getting narrower brings the shown tab back into view", () => {
  run("tab.select", { index: 5 });
  frame();
  expect(clear("a5")).toBe(true);
  VIEW.width = 400;
  try {
    frame();
    expect(clear("a5")).toBe(true);
  } finally {
    VIEW.width = 600;
  }
});

test("the keyboard's cursor on a hidden tab brings it clear", () => {
  strip.row = "tabs";
  strip.cursor = "tab:a9";
  strip.reveal();
  frame();
  expect(clear("a9")).toBe(true);
});

// ---- scrolling it

test("the strip is GPUI's own sideways scroll (a vertical wheel turns sideways), not the axis-locked scrollbar", () => {
  const s = find(root, "tab-scroll")!;
  expect(s.calls.some(([k]) => k === "overflow_x_scroll")).toBe(true);
  expect(s.calls.some(([k]) => k === "overflow_x_scrollbar")).toBe(false);
  expect(s.calls.some(([k]) => k === "track_scroll")).toBe(true);
});

test("the wheel over overflowing tabs scrolls them and switches nothing; while all fit it steps tabs", () => {
  const wheel = handler(root, "on_scroll_wheel");
  wheel({ delta: { x: 0, y: -40 }, position: { x: 400, y: 10 }, touch_phase: "moved", modifiers: {} }, cx);
  expect(commands).toEqual([]);
  // over the tools, right of the strip: it steps tabs as before
  wheel({ delta: { x: 0, y: -40 }, position: { x: 900, y: 10 }, touch_phase: "moved", modifiers: {} }, cx);
  expect(commands).toEqual([["tab.next", undefined]]);
  // few tabs: nothing to scroll, the wheel steps tabs
  commands = [];
  space(3);
  reported = new Map();
  frame();
  handler(root, "on_scroll_wheel")({ delta: { x: 0, y: 40 }, position: { x: 400, y: 10 }, touch_phase: "moved", modifiers: {} }, cx);
  expect(commands).toEqual([["tab.prev", undefined]]);
});

test("scrolled by hand, the strip stays where it was put (no snap back to the shown tab)", () => {
  off = -500; // the engine scrolled it (the wheel)
  frame();
  expect(off).toBe(-500);
  expect(clear("a1")).toBe(false);
  expect(clear("a8")).toBe(true);
});

// ---- the more-tabs marks

test("a cut-off end counts its tabs (‹ n, n ›); with everything in view there's no mark and no left fade", () => {
  expect(find(root, "tab-more-left")).toBe(null);
  expect(find(root, "tab-fade-left")).toBe(null);
  const hidden = tabs.filter((c) => !clear(c.id)).length;
  expect(markText("tab-more-right")).toBe(`${hidden} ›`);
  // scrolled to the end: the left fade, ‹ n, and no right mark
  off = -maxScroll();
  frame();
  expect(find(root, "tab-fade-left")).not.toBe(null);
  expect(markText("tab-more-left")).toBe(`‹ ${tabs.filter((c) => !clear(c.id)).length}`);
  expect(find(root, "tab-more-right")).toBe(null);
  // few tabs: nothing cut off, nothing drawn
  space(3);
  off = 0;
  reported = new Map();
  frame();
  for (const id of ["tab-more-left", "tab-more-right", "tab-fade-left"]) expect(find(root, id)).toBe(null);
  expect(find(root, "tab-fade")).not.toBe(null); // the seam's fade stays, as it always stood
});

test("a click on n › brings in the next tab; on ‹ n the one before; neither shows a tab", () => {
  const before = tabs.filter((c) => clear(c.id)).map((c) => c.id);
  const next = tabs[before.length]!.id;
  const m = find(root, "tab-more-right")!;
  handler(m, "on_mouse_down", "left")({ position: { x: 790, y: 10 } }, { ...cx, stop_propagation() { (this as any).stopped = true; } });
  handler(m, "on_click")({}, cx);
  frame();
  expect(clear(next)).toBe(true);
  expect(commands).toEqual([]);
  const left = tabs.filter((c) => !clear(c.id) && tabs.indexOf(c) < tabs.findIndex((x) => clear(x.id))).at(-1)!.id;
  handler(find(root, "tab-more-left")!, "on_click")({}, cx);
  frame();
  expect(clear(left)).toBe(true);
});

test("the end is never narrower than a fade, so the last tab clears it scrolled to the end", () => {
  const end = find(root, "tab-end")!;
  expect(end.calls.some(([k, a]) => k === "min_w" && a[0] >= scroll.fadeWidth())).toBe(true);
  off = -maxScroll();
  frame();
  expect(clear("a12")).toBe(true);
});

// ---- dragging towards a hidden end

test("a drag held on the cut-off right end scrolls on, the stake by each tab brought in; the drop lands there", () => {
  const down = (id: string, x: number) => handler(find(root, `tab-${id}`)!, "on_mouse_down", "left")({ position: { x, y: 10 }, click_count: 1 }, cx);
  const move = (id: string, x: number, frac: number) => {
    handler(find(root, `tab-${id}`)!, "on_mouse_move")({ position: { x, y: 10 }, local_position: { x: frac * TAB_W, y: 10 }, bounds: { x: 0, y: 0, width: TAB_W, height: 36 } }, cx);
  };
  down("a2", 300);
  move("a3", 400, 0.7); // a drag now
  expect(strip.drag?.id).toBe("a2");
  expect(timers.length).toBe(0); // not at an end
  // onto the right end, over the tab under the fade
  const under = tabs.find((c) => !clear(c.id))!.id;
  move(under, VIEW.x + VIEW.width - 10, 0.3);
  expect(timers.length).toBe(1);
  for (let i = 0; i < 20; i++) { timers[0]!.fn(cx); frame(); }
  // it scrolled to the end, the last tab in view, the stake past it
  expect(clear("a12")).toBe(true);
  expect(strip.drag.gap).toEqual({ id: "a12", after: true });
  expect(timers[0]!.cancelled).toBe(true); // nothing more to bring in: it stops
  handler(root, "on_mouse_up", "left")({ position: { x: 0, y: 0 } }, cx);
  expect(commands).toEqual([["tab.move", { id: "a2", index: 12 }]]);
});

test("a drag that leaves the end, or the strip, stops scrolling", () => {
  handler(find(root, "tab-a1")!, "on_mouse_down", "left")({ position: { x: 210, y: 10 }, click_count: 1 }, cx);
  const move = (id: string, x: number) => handler(find(root, `tab-${id}`)!, "on_mouse_move")({ position: { x, y: 10 }, local_position: { x: 60, y: 10 }, bounds: { x: 0, y: 0, width: TAB_W, height: 36 } }, cx);
  move("a2", 300);
  move("a6", VIEW.x + VIEW.width - 5);
  expect(timers.length).toBe(1);
  move("a4", 500);
  expect(timers[0]!.cancelled).toBe(true);
  move("a6", VIEW.x + VIEW.width - 5);
  expect(timers.length).toBe(2);
  handler(root, "on_hover")(false, cx);
  expect(timers[1]!.cancelled).toBe(true);
  expect(strip.drag).toBe(null);
});
