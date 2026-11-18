// The Actions log folds each `##[group]` as GitHub does: shut at first, opened
// and folded again by enter / space (the first group in view), z (every group)
// or a click on its title; line numbers stay GitHub's. Built on the real job
// of scripts/fixtures/github (a failed run: step that GitHub shows with its
// script folded and its output under it). herdr and gpui are stand-ins: every
// element records the text it was given and the mouse handlers it got, in
// order. Its own process: it stands in for "herdr".
import { test, expect, mock } from "bun:test";

mock.module("herdr", () => ({
  agents: () => [], appHome: () => "/tmp/herdr-test", home: () => "/home/me",
  closeOverlay: () => null, openOverlay: () => "o9",
  exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  focused: () => null, hc: async () => ({ code: 1, stdout: "" }), keys: () => [], layout: () => null,
  nextCommand: () => new Promise(() => {}), notify: () => null, panes: () => [], props: () => ({ folder: "/src", overlay: "o1" }),
  readTextFile: async () => null, writeTextFile: async () => null, run: () => null,
  settings: () => ({ zoom: 1 }), shared: () => null, setShared: () => null,
  spaces: () => [], terminals: () => [], theme: () => theme, window: () => ({ platform: "linux" }),
}));
/** What was drawn, in order: a child's text, or a left-button handler. */
type Mark = { text: string } | { click: (e: unknown, cx: unknown) => void };
const drawn: Mark[] = [];
const el: any = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined
    : k === "when" ? (on: unknown, add: (e: unknown) => unknown) => (on ? add(el) : el)
    : (...args: any[]) => {
      if (k === "on_mouse_down" && args[0] === "left" && typeof args[1] === "function") drawn.push({ click: args[1] });

      for (const a of args) if (typeof a === "string") drawn.push({ text: a });

      return el;
    }),
  apply: () => el,
});
class View {}
mock.module("gpui-kit", () => ({ View, div: () => el, svg: () => el, image: () => el, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
type Handle = { y: number; scroll_to_item(): void; offset(): { x: number; y: number }; release(): boolean };
const handle = (): Handle => {
  const h: Handle = { y: 0, scroll_to_item() {}, offset: () => ({ x: 0, y: h.y }), release: () => true };

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

const { default: Actions } = await import("../defaults/mods/github/actions.ts");
const { logPanel } = await import("../defaults/mods/github/actions-panels.ts");
const { splitLog } = await import("../defaults/mods/github/model.ts");
const { foldLog } = await import("../defaults/mods/github/log-fold.ts");

const dir = `${import.meta.dir}/fixtures/github`;
const steps = await Bun.file(`${dir}/composite-steps.json`).json();
const log = splitLog(await Bun.file(`${dir}/composite-steps.log`).text(), steps);
const key = (a: any, k: string) => a.key(k, { modifiers: {} }, cx);
const texts = (a: any) => a.logView().lines.map((l: any) => `${l.n} ${l.text}`);

/** The Actions tab on that job, its failed step ("Render preview manifests") chosen, the log focused. */
function actions() {
  const app = { repo: { full: "acme/shop" }, kick() {}, focusSelf() {}, refresh() {}, spawn() {}, openUrl() {}, dragged: () => false, resize() {} };
  const a: any = new Actions(app, {});
  a.runs = [{ id: 1, name: "Build", run_number: 560, status: "completed", conclusion: "failure" }];
  a.sel = 1;
  a.jobs.set(1, [{ id: 10, name: "Preview / Deploy preview", status: "completed", conclusion: "failure", steps }]);
  a.jobSel = 10;
  a.logs.set(10, log);
  a.focus = "log";
  a.logVis = 20;

  return a;
}

test("a step's groups start folded: the command's title, then the output, numbered as GitHub numbers them", () => {
  const a = actions();
  expect(a.step().name).toBe("Render preview manifests");
  expect(texts(a)).toEqual([
    "1 Run set -euo pipefail",
    "4 Preview images:",
    "5   web: ghcr.io/acme/web:pr-69-67d510d",
    "6   scanner: ghcr.io/acme/scanner:3594e26c43bdec4e558397afae4e23a99b555648",
    "7   api: ghcr.io/acme/api:3594e26c43bdec4e558397afae4e23a99b555648",
    "8   orders-sync: ghcr.io/acme/orders-sync:3594e26c43bdec4e558397afae4e23a99b555648",
    "9   stock-sync: ghcr.io/acme/stock-sync:3594e26c43bdec4e558397afae4e23a99b555648",
    "10 jq: error (at infra/konfig/images.json:35): no promoted image for report-sync",
    "11 Process completed with exit code 5.",
  ]);
  expect(a.logView().lines[0].group).toEqual({ at: 1, size: 2, open: false });
  expect(a.logView().total).toBe(11);
});

test("enter and space open and fold the first group in view; z every group of the step", () => {
  const a = actions();
  key(a, "enter");
  expect(texts(a).slice(0, 4)).toEqual(["1 Run set -euo pipefail", "2 set -euo pipefail", `3 short_sha="\${HEAD_SHA:0:7}"`, "4 Preview images:"]);
  key(a, "space");
  expect(texts(a)).toHaveLength(9);
  // Another step with groups after the first: scrolled past the first title, enter takes the next.
  a.stepSel = 2; // Checkout repository: its Run group, then the action's own groups
  const shut = a.logView().lines.filter((l: any) => l.group?.size).length;
  expect(shut).toBeGreaterThan(3);
  a.logScroll.y = -1 * 18; // line 1 (the second shown) on top
  key(a, "enter");
  const groups = a.logView().lines.filter((l: any) => l.group?.size);
  expect(groups.map((l: any) => l.group.open).slice(0, 3)).toEqual([false, true, false]);
  key(a, "z"); // some shut: all open
  expect(a.logView().lines.filter((l: any) => l.group?.size && !l.group.open)).toHaveLength(0);
  expect(a.logView().lines).toHaveLength(a.logView().total);
  key(a, "z"); // all open: all shut
  expect(a.logView().lines.filter((l: any) => l.group?.open && l.group.size)).toHaveLength(0);
  // Each step keeps its own: step 8's group is still shut.
  a.stepSel = 8;
  expect(texts(a)).toHaveLength(9);
});

test("enter with no group from the view's top down changes nothing", () => {
  const a = actions();
  a.logScroll.y = -3 * 18;
  key(a, "enter");
  expect(a.opened.size).toBe(0);
});

test("the drawn log: a shut group says how many lines it holds, a click on its title opens it and folds it again", () => {
  const a = actions();
  const draw = () => {
    drawn.length = 0;
    logPanel(a, theme);

    return drawn;
  };
  const marks = draw();
  const shown = marks.flatMap((m) => ("text" in m ? [m.text] : []));
  expect(shown).toContain("▸ Run set -euo pipefail");
  expect(shown).toContain("2 lines");
  expect(shown).toContain("11 lines"); // the header: every line of the step
  expect(shown).toContain("Preview images:");
  // The title's own handler: the last one drawn before its text (the body's comes first).
  const at = marks.findIndex((m) => "text" in m && m.text === "▸ Run set -euo pipefail");
  const click = marks.slice(0, at).findLast((m) => "click" in m) as { click: Function };
  a.focus = "steps";
  click.click({}, cx);
  expect(a.focus).toBe("log");
  expect(draw().flatMap((m) => ("text" in m ? [m.text] : []))).toContain("▾ Run set -euo pipefail");
  expect(texts(a)[1]).toBe("2 set -euo pipefail");
  click.click({}, cx);
  expect(texts(a)).toHaveLength(9);
});

test("foldLog: a group runs to its endgroup or the next group; one with nothing in it isn't folded", () => {
  const raw = ["##[group]A", "a1", "a2", "##[endgroup]", "out", "##[group]B", "b1", "##[group]C", "##[endgroup]", "##[error]bad"];
  const f = foldLog(raw, (at) => at === 6);
  expect(f.lines.map((l) => [l.n, l.text, l.group ?? null])).toEqual([
    [1, "A", { at: 1, size: 2, open: false }],
    [4, "out", null],
    [5, "B", { at: 5, size: 1, open: false }],
    [7, "C", { at: 7, size: 0, open: true }],
    [8, "bad", null],
  ]);
  expect(f.total).toBe(8);
  expect(foldLog(raw, () => true).lines).toHaveLength(8);
});
