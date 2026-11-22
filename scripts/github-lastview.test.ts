// Item 32: the GitHub window comes back where it was last left in its space (github/lastview.ts):
// its tab and each tab's selection and filter, kept in shared "github.spaces" (persisted) under the
// space's id, written by the window's tick when it changed; another space keeps its own, a space
// with nothing kept opens as before. The harness is github-pane.test.ts's.
// Its own process: it stands in for "herdr".
import { test, expect, mock } from "bun:test";

let sharedState: Record<string, unknown> = {};
const writes: string[] = [];
let propsNow: any = null;
let panesNow: any[] = [];
let focusedNow: any = null;
const commands: [string, any][] = [];
const opened: any[] = [];
const closed: string[] = [];
let overlayN = 0;
mock.module("herdr", () => ({
  agents: () => [], appHome: () => "/tmp/herdr-test", home: () => "/home/me",
  closeOverlay: (id: string) => { closed.push(id); return null; },
  openOverlay: (spec: any) => { opened.push(spec); return `o${++overlayN}`; },
  exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  focused: () => focusedNow, hc: async () => ({ code: 1, stdout: "" }), keys: () => [], layout: () => null,
  nextCommand: () => new Promise(() => {}), notify: () => null, panes: () => panesNow, props: () => propsNow,
  readTextFile: async () => null, writeTextFile: async () => null,
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  settings: () => ({ zoom: 1 }), shared: (k: string) => sharedState[k] ?? null, setShared: (k: string, v: unknown) => { writes.push(k); sharedState[k] = v; },
  spaces: () => spacesNow, terminals: () => [], theme: () => theme, window: () => ({ platform: "linux" }),
}));

let drawn: [string, any[]][] = [];
const el: any = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined
    : k === "when" ? (on: unknown, add: (e: unknown) => unknown) => { drawn.push(["when", []]); return on ? add(el) : el; }
    : k === "map" ? (f: (e: unknown) => unknown) => f(el)
    : (...args: any[]) => { drawn.push([String(k), args]); return el; }),
  apply: () => el,
});
class View {}
mock.module("gpui-kit", () => ({ View, div: () => el, svg: () => el, image: () => el, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
const handle = () => ({ scroll_to_item() {}, offset: () => ({ x: 0, y: 0 }), release: () => true });
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} release() { return true; } set_auto_grow() {} }
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, TextView: { markdown: () => el },
  v_virtual_list: () => el,
  ScrollHandle: { new: handle }, VirtualListScrollHandle: { new: handle },
  InputState: { new: () => new Input() }, Input: { new: () => el }, TextareaState: { new: () => new Input() }, Textarea: { new: () => el },
}));
(globalThis as any).window = { paint_path: () => el };
const theme: any = new Proxy({}, { get: (_t, k) => (String(k).startsWith("ansi") ? "#808080" : "#c0c0c0") });

// localStorage per mod and props: one store per props as JSON.
const stores = new Map<string, Map<string, string>>();
(globalThis as any).localStorage = {
  getItem: (k: string) => stores.get(JSON.stringify(propsNow))?.get(k) ?? null,
  setItem: (k: string, v: string) => { const key = JSON.stringify(propsNow); if (!stores.has(key)) stores.set(key, new Map()); stores.get(key)!.set(k, v); },
};

const cx: any = {
  spawn() {}, notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {}, is_focused: () => false, release: () => true }),
  timer: { after(_ms: number, f: Function) { f(cx); }, every() {} }, bind_keys() {},
};

const { default: GitHub } = await import("../defaults/mods/github/main.ts");
const { actsOnCommands } = await import("../defaults/mods/github/place.ts");
const { SPACES_KEY } = await import("../defaults/mods/github/lastview.ts");

let spacesNow: any[] = [];
const inSpace = (id: string) => { spacesNow = [{ id, active: true, tabs: [] }, { id: id === "sA" ? "sB" : "sA", active: false, tabs: [] }]; };
function open(p: any) {
  propsNow = p;
  const g: any = new GitHub();
  g.init(p, cx);
  return g;
}
const windowIn = (space: string, folder = "/a") => { inSpace(space); return open({ folder, overlay: `w-${space}` }); };
const spacesWritten = () => writes.filter((k) => k === SPACES_KEY.name).length;
const fresh = () => { sharedState = {}; writes.length = 0; stores.clear(); panesNow = []; focusedNow = null; };

test("written on change under the space's id; it comes back in the same space, not in another", async () => {
  fresh();
  const a = windowIn("sA");
  expect(a.tab).toBe("prs");
  a.setTab("actions", cx);
  a.tick(cx);
  expect((sharedState[SPACES_KEY.name] as any).sA).toMatchObject({ folder: "/a", tab: "actions" });
  // Nothing changed: not written again.
  const n = spacesWritten();
  a.tick(cx);
  a.tick(cx);
  expect(spacesWritten()).toBe(n);
  await a.close();

  const b = windowIn("sB");
  expect(b.tab).toBe("actions"); // nothing kept in sB: as before, what the window kept last
  b.setTab("projects", cx);
  b.tick(cx);
  await b.close();

  // A new window (also after a restart: shared() is what's persisted) in each space.
  expect(windowIn("sA").tab).toBe("actions");
  expect(windowIn("sB").tab).toBe("projects");
  // Another folder in the same space: its record isn't used.
  expect(windowIn("sA", "/elsewhere").tab).toBe("prs");
});

test("a pane's own place still wins in its space; the pane's tick doesn't write the space's record", async () => {
  fresh();
  inSpace("sA");
  const p = open({ folder: "/a", slot: "s1" });
  p.setTab("projects", cx);
  p.tick(cx);
  expect(sharedState[SPACES_KEY.name]).toBeUndefined();
  const w = windowIn("sA");
  w.setTab("actions", cx);
  w.tick(cx);
  inSpace("sA");
  expect(open({ folder: "/a", slot: "s1" }).tab).toBe("projects");
});
