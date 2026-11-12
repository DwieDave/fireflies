// The GitHub window's lists keep their cursor in view, at zoom 0.9 and 1:
// the Actions view's runs, steps and log, a PR's list and checks, and the
// window's picker; and the job graph's default height. herdr and gpui are
// stand-ins: every scroll handle records what it was asked to reveal (the
// real one scrolls only as far as it takes to show that row). Its own
// process: it stands in for "herdr".
import { test, expect, mock, beforeEach } from "bun:test";

let zoomNow = 1;
mock.module("herdr", () => ({
  agents: () => [], appHome: () => "/tmp/herdr-test", home: () => "/home/me",
  closeOverlay: () => null, openOverlay: () => "o9",
  exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  focused: () => null, hc: async () => ({ code: 1, stdout: "" }), keys: () => [], layout: () => null,
  nextCommand: () => new Promise(() => {}), notify: () => null, panes: () => [], props: () => ({ folder: "/src", overlay: "o1" }),
  readTextFile: async () => null, writeTextFile: async () => null, run: () => null,
  settings: () => ({ zoom: zoomNow }), shared: () => null, setShared: () => null,
  spaces: () => [], terminals: () => [], theme: () => theme, window: () => ({ platform: "linux" }),
}));
const el: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : () => el), apply: () => el });
class View {}
mock.module("gpui-kit", () => ({ View, div: () => el, svg: () => el, image: () => el, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));

/** A scroll handle that records each reveal: [index, strategy]. `y` is the
 *  list's offset in window px (negative: scrolled down), as offset() reads it. */
type Handle = { calls: [number, string | null][]; y: number; scroll_to_item(i: number, s?: string): void; offset(): { x: number; y: number }; release(): boolean };
const handle = (): Handle => {
  const h: Handle = { calls: [], y: 0, scroll_to_item(i, s) { h.calls.push([i, s ?? null]); }, offset: () => ({ x: 0, y: h.y }), release: () => true };
  return h;
};
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} release() { return true; } set_auto_grow() {} }
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, TextView: { markdown: () => el },
  v_virtual_list: (_id: string, n: number, _s: unknown, key: (i: number) => string, render: Function) => { for (let i = 0; i < n; i++) key(i); render({ start: 0, end: n }, cx); return el; },
  ScrollHandle: { new: handle }, VirtualListScrollHandle: { new: handle },
  InputState: { new: () => new Input() }, Input: { new: () => el }, TextareaState: { new: () => new Input() }, Textarea: { new: () => el },
}));
(globalThis as any).window = { paint_path: () => el };
const theme: any = new Proxy({}, { get: (_t, k) => (String(k).startsWith("ansi") ? "#808080" : "#c0c0c0") });
const cx: any = { spawn() {}, notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {}, is_focused: () => false, release: () => true }), timer: { after() {}, every() {} }, bind_keys() {} };

const { default: Actions, graphHeight } = await import("../defaults/mods/nocturne-github/actions.js");
const { default: Prs } = await import("../defaults/mods/nocturne-github/prs.js");
const { default: GitHub } = await import("../defaults/mods/nocturne-github/main.js");

const app = () => ({ repo: { full: "me/app", url: "https://github.com/me/app" }, kick() {}, focusSelf() {}, refresh() {}, spawn() {}, openUrl() {}, dragged: () => false, resize() {} });
const last = (h: Handle) => h.calls[h.calls.length - 1]?.[0];

beforeEach(() => { zoomNow = 1; });

/** A run whose job has `n` steps, `failed` (an index) the one that failed. */
function actionsWith(n: number, failed: number | null = null) {
  const a: any = new Actions(app(), {});
  const steps = Array.from({ length: n }, (_, i) => ({ number: i + 1, name: `step ${i + 1}`, status: "completed", conclusion: i === failed ? "failure" : "success", started_at: null, completed_at: null }));
  a.runs = [{ id: 1, name: "CI", run_number: 7, status: "completed", conclusion: failed == null ? "success" : "failure", path: "ci.yml", head_sha: "abc" }];
  a.sel = 1;
  a.jobs.set(1, [{ id: 10, name: "Build", status: "completed", conclusion: "success", steps }, { id: 11, name: "Test", status: "completed", conclusion: "failure", steps: steps.map((s) => ({ ...s, conclusion: s.number === 10 ? "failure" : "success" })) }]);
  a.jobSel = 10;
  return a;
}

for (const zoom of [0.9, 1]) {
  test(`actions, zoom ${zoom}: the steps list follows j / k to its last row and back, and a new job's failed step`, () => {
    zoomNow = zoom;
    const a = actionsWith(12);
    a.focus = "steps";
    a.stepsPanel(theme);
    expect(last(a.stepsScroll)).toBe(0);
    for (let i = 1; i < 12; i++) { a.key("j", { modifiers: {} }, cx); a.stepsPanel(theme); expect(last(a.stepsScroll)).toBe(i); }
    a.key("j", { modifiers: {} }, cx); a.stepsPanel(theme);
    expect(a.step().number).toBe(12); // stays on the last row
    expect(last(a.stepsScroll)).toBe(11);
    for (let i = 10; i >= 0; i--) { a.key("k", { modifiers: {} }, cx); a.stepsPanel(theme); expect(last(a.stepsScroll)).toBe(i); }
    // Another job: its failed step (the 10th) is the chosen one, and shown.
    a.focus = "graph";
    a.key(a.columns().length > 1 ? "l" : "j", { modifiers: {} }, cx);
    expect(a.jobSel).toBe(11);
    a.stepsPanel(theme);
    expect(last(a.stepsScroll)).toBe(9);
    // Drawing again without a move asks for nothing: the wheel's scroll stays.
    const n = a.stepsScroll.calls.length;
    a.stepsPanel(theme);
    expect(a.stepsScroll.calls.length).toBe(n);
  });

  test(`actions, zoom ${zoom}: the runs list follows j / k / G / g`, () => {
    zoomNow = zoom;
    const a: any = new Actions(app(), {});
    a.runs = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, name: "CI", run_number: 40 - i, status: "completed", conclusion: "success" }));
    a.sel = 1; a.focus = "runs";
    a.key("j", { modifiers: {} }, cx); expect(last(a.runsScroll)).toBe(1);
    a.key("G", { modifiers: {} }, cx); expect(last(a.runsScroll)).toBe(39);
    a.key("j", { modifiers: {} }, cx); expect(last(a.runsScroll)).toBe(39);
    a.key("k", { modifiers: {} }, cx); expect(last(a.runsScroll)).toBe(38);
    a.key("g", { modifiers: {} }, cx); expect(last(a.runsScroll)).toBe(0);
  });

  test(`actions, zoom ${zoom}: the log scrolls by lines from where it is, to its end and back`, () => {
    zoomNow = zoom;
    const a = actionsWith(3);
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    a.logs.set(10, new Map([[1, lines]]));
    a.stepSel = 1;
    a.logVis = 20; a.focus = "log";
    a.key("j", { modifiers: {} }, cx);
    expect(a.logAt).toBe(3);
    expect(a.logScroll.calls.at(-1)).toEqual([22, "top"]); // line 22 at the bottom edge: 3 is on top
    // The wheel moved it to line 40 (offset in window px, zoomed).
    a.logScroll.y = -40 * 18 * zoom;
    a.key("j", { modifiers: {} }, cx);
    expect(a.logAt).toBe(43);
    expect(a.logScroll.calls.at(-1)).toEqual([62, "top"]);
    a.key("G", { modifiers: {} }, cx);
    expect(a.logAt).toBe(80);
    expect(a.logScroll.calls.at(-1)).toEqual([99, "top"]); // the last line at the bottom edge
    a.logScroll.y = -80 * 18 * zoom;
    a.key("j", { modifiers: {} }, cx);
    expect(a.logAt).toBe(80); // no further
    a.key("k", { modifiers: {} }, cx);
    expect(a.logAt).toBe(77);
    expect(a.logScroll.calls.at(-1)).toEqual([77, "top"]); // up: that line on top
    a.logScroll.y = -77 * 18 * zoom;
    a.key("K", { modifiers: {} }, cx);
    expect(a.logScroll.calls.at(-1)).toEqual([57, "top"]);
    a.key("g", { modifiers: {} }, cx);
    expect(a.logScroll.calls.at(-1)).toEqual([0, "top"]);
  });

  test(`pull requests, zoom ${zoom}: the list and the checks follow j / k`, () => {
    zoomNow = zoom;
    const p: any = new Prs(app(), {});
    const rollup = Array.from({ length: 14 }, (_, i) => ({ __typename: "CheckRun", name: `check ${i}`, status: "COMPLETED", conclusion: "SUCCESS" }));
    p.list = Array.from({ length: 30 }, (_, i) => ({ number: 100 - i, title: `pr ${i}`, statusCheckRollup: rollup, author: { login: "me" } }));
    p.sel = 100; p.focus = "list";
    p.key("j", { modifiers: {} }, cx); expect(last(p.listScroll)).toBe(1);
    p.key("G", { modifiers: {} }, cx); expect(last(p.listScroll)).toBe(29);
    p.key("k", { modifiers: {} }, cx); expect(last(p.listScroll)).toBe(28);
    p.focus = "checks";
    p.checksPanel(theme);
    for (let i = 1; i < 14; i++) { p.key("j", { modifiers: {} }, cx); p.checksPanel(theme); expect(last(p.checksScroll)).toBe(i); }
    p.key("j", { modifiers: {} }, cx); p.checksPanel(theme);
    expect(p.checkSel).toBe(13);
    expect(last(p.checksScroll)).toBe(13);
    for (let i = 12; i >= 0; i--) { p.key("k", { modifiers: {} }, cx); p.checksPanel(theme); expect(last(p.checksScroll)).toBe(i); }
  });

  test(`the picker, zoom ${zoom}: its cursor stays in view to the last row and back`, () => {
    zoomNow = zoom;
    const g: any = new GitHub();
    g.init({}, cx);
    g.picker = { title: "LINKS", at: 0, rows: Array.from({ length: 30 }, (_, i) => ({ label: `link ${i}`, sub: "", go() {} })) };
    g.pickerPanel(theme);
    expect(last(g.pickerScroll)).toBe(1); // the box's first child is its title
    for (let i = 1; i < 30; i++) { g.pickerKey("j", cx); g.pickerPanel(theme); expect(last(g.pickerScroll)).toBe(i + 1); }
    g.pickerKey("g", cx); g.pickerPanel(theme); expect(last(g.pickerScroll)).toBe(1);
    g.pickerKey("G", cx); g.pickerPanel(theme); expect(last(g.pickerScroll)).toBe(30);
  });
}

test("the job graph: 55 % of the column by default (220..520), a dragged height stays", () => {
  expect(graphHeight(undefined, 680)).toBe(374); // the window at zoom 0.9: a column of six jobs fits
  expect(graphHeight(undefined, 300)).toBe(180); // short: the steps and log keep 120
  expect(graphHeight(undefined, 400)).toBe(220);
  expect(graphHeight(undefined, 1200)).toBe(520);
  expect(graphHeight(200, 680)).toBe(200); // dragged: Developer's
  expect(graphHeight(170, 680)).toBe(170); // the old default only exists once dragged there
  expect(graphHeight(900, 680)).toBe(560); // never past the column
  expect(graphHeight(40, 680)).toBe(100);
  // Six jobs in one column (wires.js: NH 44, GAP_Y 10, PAD 18 above and below) plus the panel's frame fit 374.
  expect(6 * 44 + 5 * 10 + 2 * 18 + 20).toBeLessThanOrEqual(374);
  // Kept per window in sizes.graph only when dragged.
  const a: any = new Actions(app(), {});
  expect(a.save().sizes).toEqual({});
  expect(new (Actions as any)(app(), { sizes: { graph: 210 } }).sizes.graph).toBe(210);
});
