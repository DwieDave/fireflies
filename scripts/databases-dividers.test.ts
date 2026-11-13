// The dividers between panels (defaults/mods/databases/dividers.ts, the pattern
// the Kubernetes mod copies): a drag by calling the handlers (the grab's press,
// the root's moves and release), the clamp so no panel vanishes, the keyboard
// steps (+ grows the focused panel at each edge, - shrinks it), the double
// click's reset, and the sizes kept and read back. gpui and herdr are stand-ins.
// Its own process: it stands in for "herdr".
import { test, expect, mock } from "bun:test";

let zoomNow = 1;
mock.module("herdr", () => ({ settings: () => ({ zoom: zoomNow }) }));

/** Each element records its calls; handlers are found by name. */
type Call = [string, any[]];
function element(calls: Call[]): any {
  const el: any = new Proxy(function () {}, {
    get: (_t, k) => (k === "then" ? undefined
      : k === "when" ? (on: unknown, add: (e: unknown) => unknown) => (on ? add(el) : el)
      : (...args: any[]) => { calls.push([String(k), args]); return el; }),
  });
  return el;
}
let calls: Call[] = [];
mock.module("gpui-kit", () => ({ div: () => element(calls) }));

const { Dividers, clampSize, divider, tracking, STEP } = await import("../defaults/mods/databases/dividers.ts");

const theme: any = { accent: "#ff0000", ansi8: "#808080" };
const cx: any = { stop_propagation() {}, notify() {} };
const LEFT = { key: "left", axis: "x", side: 1, min: 200, max: 700, start: 300 } as const;
const LOG = { key: "log", axis: "y", side: -1, min: 40, max: 400, start: 92 } as const;

const handler = (list: Call[], name: string, arg?: string) => list.find(([m, a]) => m === name && (arg === undefined || a[0] === arg))?.[1].at(-1);

test("a size is its start until dragged, always inside its bounds", () => {
  const ds = new Dividers({}, () => {});
  expect(ds.size(LEFT)).toBe(300);
  expect(clampSize(LEFT, 50)).toBe(200);
  expect(clampSize(LEFT, 9000)).toBe(700);
  // A max under the min (a small window): the min wins, the panel never vanishes.
  expect(clampSize({ ...LEFT, max: 120 }, 150)).toBe(200);
  expect(new Dividers({ left: 9999 }, () => {}).size(LEFT)).toBe(700);
});

test("a drag by the handlers: the press on the grab, the root's moves, the release keeps it", () => {
  const saved: any[] = [];
  const ds = new Dividers({}, (s) => saved.push(s));
  calls = [];
  divider(theme, "split-left", LEFT, ds, 6);
  handler(calls, "on_mouse_down", "left")({ click_count: 1, position: { x: 306, y: 10 } }, cx);
  expect(ds.dragging("left")).toBe(true);
  const root: Call[] = [];
  tracking(element(root), ds);
  handler(root, "on_mouse_move")({ position: { x: 386, y: 400 } }, cx);
  expect(ds.size(LEFT)).toBe(380);
  // Live: no save while it moves.
  expect(saved).toEqual([]);
  handler(root, "on_mouse_move")({ position: { x: 5000, y: 0 } }, cx);
  expect(ds.size(LEFT)).toBe(700);
  handler(root, "on_mouse_move")({ position: { x: 0, y: 0 } }, cx);
  expect(ds.size(LEFT)).toBe(200);
  handler(root, "on_mouse_move")({ position: { x: 346, y: 0 } }, cx);
  handler(root, "on_mouse_up", "left")({}, cx);
  expect(ds.dragging("left")).toBe(false);
  expect(saved).toEqual([{ left: 340 }]);
});

test("a divider sizing the panel after it (side -1): moving the pointer up grows it", () => {
  const ds = new Dividers({}, () => {});
  ds.down(LOG, 500);
  ds.move(440);
  expect(ds.size(LOG)).toBe(152);
  ds.up();
});

test("the pointer leaving the view ends the drag; the zoom is taken out of the pointer's px", () => {
  const saved: any[] = [];
  const ds = new Dividers({}, (s) => saved.push(s));
  zoomNow = 2;
  ds.down(LEFT, 300);
  const root: Call[] = [];
  tracking(element(root), ds);
  // 100 drawn px at zoom 2 are 50 layout px.
  handler(root, "on_mouse_move")({ position: { x: 700, y: 0 } }, cx);
  expect(ds.size(LEFT)).toBe(300 + (350 - 300));
  handler(root, "on_hover")(false, cx);
  expect(ds.drag).toBe(null);
  expect(saved.length).toBe(1);
  zoomNow = 1;
});

test("while held the root keeps the resize pointer and the line is the accent", () => {
  const ds = new Dividers({}, () => {});
  ds.down(LEFT, 300);
  const root: Call[] = [];
  tracking(element(root), ds);
  expect(root.some(([m]) => m === "cursor_col_resize")).toBe(true);
  calls = [];
  divider(theme, "split-left", LEFT, ds, 6);
  expect(calls.some(([m, a]) => m === "bg" && a[0] === "#ff0000")).toBe(true);
  // Not held, not hovered: nothing drawn but the grab area.
  ds.up();
  calls = [];
  divider(theme, "split-left", LEFT, ds, 6);
  expect(calls.some(([m]) => m === "bg")).toBe(false);
  expect(calls.some(([m, a]) => m === "w" && a[0] === 6)).toBe(true);
  // Hovered: the quiet mark.
  handler(calls, "on_hover")(true, cx);
  calls = [];
  divider(theme, "split-left", LEFT, ds, 6);
  expect(calls.some(([m, a]) => m === "bg" && a[0] === "#808080")).toBe(true);
});

test("the keys: + grows the focused panel at each of its edges, - shrinks it, clamped", () => {
  const saved: any[] = [];
  const ds = new Dividers({}, (s) => saved.push(s));
  // A panel right of `left` and above `log`: growing it moves `left` left and `log` down.
  const edges = [{ divider: LEFT, sign: -1 }, { divider: LOG, sign: -1 }] as const;
  expect(ds.stepAll(edges, 1)).toBe(true);
  expect(ds.size(LEFT)).toBe(300 - STEP);
  expect(ds.size(LOG)).toBe(92 - STEP);
  expect(saved.length).toBe(1);
  ds.stepAll(edges, -1);
  expect([ds.size(LEFT), ds.size(LOG)]).toEqual([300, 92]);
  // At its bounds nothing moves, and nothing is saved.
  const small = new Dividers({ log: 40, left: 200 }, (s) => saved.push(s));
  const n = saved.length;
  expect(small.stepAll(edges, 1)).toBe(false);
  expect(saved.length).toBe(n);
  expect(ds.step(LEFT, 30)).toBe(true);
  expect(ds.size(LEFT)).toBe(330);
});

test("a double click on the divider resets it to its start, and the reset is kept", () => {
  const saved: any[] = [];
  const ds = new Dividers({ left: 500, log: 60 }, (s) => saved.push(s));
  calls = [];
  divider(theme, "split-left", LEFT, ds, 6);
  handler(calls, "on_mouse_down", "left")({ click_count: 2, position: { x: 500, y: 0 } }, cx);
  expect(ds.size(LEFT)).toBe(300);
  expect(ds.drag).toBe(null);
  expect(saved).toEqual([{ log: 60 }]);
  expect(ds.reset("left")).toBe(false);
});

test("kept sizes come back as they were stored", () => {
  const ds = new Dividers(JSON.parse(JSON.stringify({ left: 410 })), () => {});
  expect(ds.size(LEFT)).toBe(410);
  expect(ds.size(LOG)).toBe(92);
});
