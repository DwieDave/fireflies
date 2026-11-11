// The picker (nocturne-picker/main.js) as the window drives it, with herdr and
// gpui stand-ins: what a render costs with a full page of grep lines, that
// typing waits for a pause before it searches, and that an answer to an older
// query never replaces a newer one. Its own process: mock.module is process-wide.
import { test, expect, mock, beforeEach } from "bun:test";

const calls = { highlight: 0, grep: [] as string[], files: [] as string[], drawn: 0 };
let answers: Record<string, Promise<any> | any> = {};
// Every element method chains; `when` runs its branch, so what it adds is built.
const el: any = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined : k === "when" ? (c: any, f: Function) => (c ? f(el) : el) : () => el),
  apply: () => el,
});
// A list draws the first screenful, as GPUI would.
const SCREEN = 20;
mock.module("herdr", () => ({
  props: () => ({ mode: "grep", folder: "/src", overlay: "o1" }), theme: () => new Proxy({}, { get: () => "#808080" }),
  settings: () => ({ zoom: 0.9 }), closeOverlay: () => {}, setShared: () => {}, run: () => {},
  exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  findFiles: (_root: string, q: string) => { calls.files.push(q); return answers[`f:${q}`] ?? { files: [], total: 0 }; },
  grep: (_root: string, q: string) => { calls.grep.push(q); return answers[`g:${q}`] ?? { matches: [], files: 0 }; },
  readTextFile: async () => "a\nb\n", highlight: () => { calls.highlight++; return []; }, languageOf: () => null,
  home: () => "/home/me", window: () => ({ platform: "macos" }),
  shared: () => null, keys: () => [], nextCommand: () => new Promise(() => {}),
}));
mock.module("gpui-kit", () => ({ div: () => el, View: class {}, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
const lists: { n: number; sizes: any; key: (i: number) => string }[] = [];
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, Input: { new: () => el }, Scrollbar: { vertical: () => el },
  v_virtual_list: (_id: string, n: number, sizes: any, key: (i: number) => string, render: Function) => {
    lists.push({ n, sizes, key });
    const drawn = render({ start: 0, end: Math.min(n, SCREEN) }, cx);
    calls.drawn += drawn.length;
    return el;
  },
  VirtualListScrollHandle: { new: () => ({ scroll_to_item() {}, release() {} }) },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
  InputState: { new: () => input },
}));
globalThis.window = { paint_path: () => el } as any;

const input = { v: "", handlers: {} as Record<string, Function>, on(e: string, f: Function) { this.handlers[e] = f; return true; }, value() { return this.v; }, focus() {}, release() { return true; } };
const timers: { at: number; f: Function }[] = [];
let now = 0;
const work: Promise<unknown>[] = [];
const cx: any = {
  spawn: (f: Function) => { work.push(Promise.resolve(f(cx))); },
  notify() {}, stop_propagation() {}, bind_keys: () => 2,
  timer: { after: (ms: number, f: Function) => { timers.push({ at: now + ms, f }); } },
};
// Lets every answer that is in arrive (a slow one stays pending).
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
async function tick(ms: number) {
  now += ms;
  for (const t of timers.filter((t) => t.at <= now)) { timers.splice(timers.indexOf(t), 1); t.f(cx); }
  await settle();
}
const type = async (text: string) => { input.v = text; input.handlers.change({}, cx); };

const { default: Picker } = await import("../defaults/mods/nocturne-picker/main.js");

beforeEach(() => {
  calls.highlight = 0; calls.grep = []; calls.files = []; calls.drawn = 0;
  answers = {}; lists.length = 0; timers.length = 0; work.length = 0; input.v = ""; input.handlers = {};
});

const page = (n: number) => ({
  matches: Array.from({ length: n }, (_, i) => ({ path: `src/f${Math.floor(i / 7)}.rs`, line: i + 1, col: 0, text: `let needle_${i} = ${"x".repeat(200)};`, ranges: [[4, 10]] })),
  files: Math.ceil(n / 7), truncated: true,
});

async function opened() {
  const p: any = new Picker();
  p.init({}, cx);
  await settle();
  return p;
}

test("a full page of grep lines draws only what's on screen, and highlights each line once", async () => {
  answers["g:needle"] = page(400);
  const p = await opened();
  await type("needle");
  await tick(1000);
  expect(p.rows.length).toBeGreaterThan(400);
  calls.drawn = 0; calls.highlight = 0;
  p.render(cx);
  expect(lists.at(-1)!.n).toBe(p.rows.length);
  expect(calls.drawn).toBeLessThanOrEqual(SCREEN);
  expect(calls.highlight).toBeLessThanOrEqual(SCREEN);
  // Moving the pick draws again without highlighting again.
  calls.highlight = 0;
  for (let i = 0; i < 5; i++) { p.pick(1, cx); p.render(cx); }
  expect(calls.highlight).toBe(0);
  // Row heights: a file's head and its lines.
  const sizes = lists.at(-1)!.sizes;
  expect(Array.isArray(sizes) && sizes.length === p.rows.length).toBe(true);
});

test("typing searches once, after a pause, for what's in the box then", async () => {
  await opened();
  calls.grep = [];
  for (const q of ["n", "ne", "nee", "need"]) { await type(q); await tick(20); }
  expect(calls.grep).toEqual([]);
  await tick(500);
  expect(calls.grep).toEqual(["need"]);
});

test("an older query's late answer doesn't replace the newer one's", async () => {
  let slow!: (v: any) => void;
  answers["g:old"] = new Promise((r) => { slow = r; });
  answers["g:new"] = page(3);
  const p = await opened();
  await type("old"); await tick(500);
  await type("new"); await tick(500);
  const shown = p.rows.map((r: any) => r.path + (r.match?.line ?? ""));
  slow(page(50));
  await settle();
  expect(p.rows.map((r: any) => r.path + (r.match?.line ?? ""))).toEqual(shown);
  expect(p.total).toBe(3);
});

test("the files mode draws only what's on screen too", async () => {
  answers["f:main"] = { files: Array.from({ length: 80 }, (_, i) => ({ path: `src/m${i}/main.rs`, git: null, ranges: [[7, 11]] })), total: 900 };
  const p = await opened();
  p.switchMode(cx);
  await type("main"); await tick(500);
  expect(p.rows.length).toBe(80);
  calls.drawn = 0;
  p.render(cx);
  expect(lists.at(-1)!.n).toBe(80);
  expect(calls.drawn).toBeLessThanOrEqual(SCREEN);
});
