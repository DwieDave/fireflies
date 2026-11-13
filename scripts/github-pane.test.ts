// The GitHub window as a normal pane (github/place.ts, docs/mods-in-panes.md):
// drawn without the window's frame and ✕, esc leaves the pane (q closes it),
// narrow widths, moving window -> pane -> window with what it shows, two
// copies (the keyboard's copy acts on commands) and a restart's props. herdr
// and gpui are stand-ins; the elements record what they're asked to draw.
// Its own process: it stands in for "herdr".
import { test, expect, mock } from "bun:test";

let sharedState: Record<string, unknown> = {};
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
  settings: () => ({ zoom: 1 }), shared: (k: string) => sharedState[k] ?? null, setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  spaces: () => [], terminals: () => [], theme: () => theme, window: () => ({ platform: "linux" }),
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

function open(p: any) {
  propsNow = p;
  const g: any = new GitHub();
  g.init(p, cx);
  return g;
}

function render(g: any) {
  drawn = [];
  g.render();
  return drawn;
}

/** The root's own calls: from its id to its focus tracking. */
const framed = (d: [string, any[]][]) => {
  const i = d.findIndex(([m, a]) => m === "id" && a[0] === "github");
  const j = d.findIndex(([m], n) => n > i && m === "track_focus");
  return d.slice(i, j).some(([m]) => m === "border");
};
const texts = (d: [string, any[]][]) => d.filter(([m]) => m === "child").flatMap(([, a]) => a.filter((x) => typeof x === "string"));
const tips = (d: [string, any[]][]) => d.filter(([m]) => m === "tooltip").map(([, a]) => a[0]);
const key = (k: string, mods: any = {}) => ({ key: k, key_char: k.length === 1 ? k : undefined, modifiers: mods });
const fresh = () => { sharedState = {}; commands.length = 0; opened.length = 0; closed.length = 0; panesNow = []; focusedNow = null; stores.clear(); };

test("as a pane: no frame, no ✕, the ⧉ to a window; the window has its frame, ✕ and ◧", () => {
  fresh();
  let d = render(open({ folder: "/src", slot: "s1" }));
  expect(framed(d)).toBe(false);
  expect(texts(d)).not.toContain("✕");
  expect(texts(d)).toContain("⧉");
  expect(tips(d)).toContain("Out to a window · ctrl-t");

  d = render(open({ folder: "/src", overlay: "w1" }));
  expect(framed(d)).toBe(true);
  expect(texts(d)).toContain("✕");
  expect(texts(d)).toContain("◧");
  expect(tips(d)).toContain("Into a pane · ctrl-t");
});

test("esc leaves a pane open, q closes its own pane; esc closes the window", () => {
  fresh();
  panesNow = [{ pane: "p9", mod: "github", props: { folder: "/x", slot: "x" } }, { pane: "p2", mod: "github", props: { folder: "/src", slot: "s1" } }];
  const g = open({ folder: "/src", slot: "s1" });
  g.key(key("escape"), cx);
  expect(commands.filter(([n]) => n === "pane.close")).toEqual([]);
  g.key(key("q"), cx);
  expect(commands.filter(([n]) => n === "pane.close")).toEqual([["pane.close", { pane: "p2" }]]);

  const w = open({ folder: "/src", overlay: "w1" });
  w.key(key("escape"), cx);
  expect(closed).toContain("w1");
});

test("narrow panes: only the shown tab says its name; every width draws", () => {
  fresh();
  const g = open({ folder: "/src", slot: "s1" });
  for (const width of [320, 500, 900]) {
    g.size = { width, height: 400 };
    expect(() => render(g)).not.toThrow();
  }
  g.size = { width: 500, height: 400 };
  let t = texts(render(g));
  expect(t).toContain("Pull requests");
  expect(t).not.toContain("Actions");
  g.size = { width: 900, height: 400 };
  t = texts(render(g));
  expect(t).toContain("Actions");
});

test("moved window -> pane -> window: tab and folder go along, the old copy steps aside", () => {
  fresh();
  focusedNow = { pane: "p1" };
  const w = open({ folder: "/src", on: "vps", overlay: "w1" });
  w.setTab("actions", cx);
  w.key(key("t", { control: true }), cx);
  const split = commands.find(([n]) => n === "pane.split");
  expect(split?.[1]).toMatchObject({ direction: "auto", pane: "p1", mod: "github", props: { folder: "/src", on: "vps" } });
  expect(typeof split?.[1].props.slot).toBe("string");
  expect(closed).toContain("w1");

  panesNow = [{ pane: "p3", mod: "github", props: split?.[1].props, focused: true }];
  const p = open(split?.[1].props);
  expect(p.overlay).toBe(null);
  expect(p.tab).toBe("actions");
  expect(p.on).toBe("vps");

  p.setTab("projects", cx);
  commands.length = 0;
  p.key(key("t", { control: true }), cx);
  const spec = opened.at(-1);
  expect(spec).toMatchObject({ mod: "github", kind: "window", key: "github", props: { folder: "/src", on: "vps" } });
  expect(spec.props.slot).toBeUndefined();
  expect(commands).toContainEqual(["pane.close", { pane: "p3" }]);
  expect((sharedState["github.window"] as any).id).toBe(`o${overlayN}`);
  expect(open({ ...spec.props, overlay: "w2" }).tab).toBe("projects");
});

test("github.to-pane / to-window are commands too, and an open window gives way", () => {
  fresh();
  sharedState["github.window"] = { id: "w7", beat: Date.now() };
  panesNow = [{ pane: "p3", mod: "github", props: { folder: "/src", slot: "s1" }, focused: true }];
  const { runCommand } = require("../defaults/mods/github/window-keys.ts");
  const p = open({ folder: "/src", slot: "s1" });
  runCommand(p, "to-window", cx);
  // The window is open: the pane leaves commands to it.
  expect(opened.length).toBe(0);
  sharedState["github.window"] = null;
  runCommand(p, "to-window", cx);
  expect(opened.length).toBe(1);
});

test("two copies: commands go to the window while it's open, else the focused pane", () => {
  fresh();
  panesNow = [
    { pane: "p1", mod: "github", props: { folder: "/a", slot: "a" }, focused: true },
    { pane: "p2", mod: "github", props: { folder: "/b", slot: "b" }, focused: false },
  ];
  const a = open({ folder: "/a", slot: "a" });
  const b = open({ folder: "/b", slot: "b" });
  expect([a.folder, b.folder]).toEqual(["/a", "/b"]);
  expect(actsOnCommands(a)).toBe(true);
  expect(actsOnCommands(b)).toBe(false);
  const w = open({ folder: "/a", overlay: "w1" });
  w.beat();
  expect(actsOnCommands(w)).toBe(true);
  expect(actsOnCommands(a)).toBe(false);
});

test("a restart: the pane's props bring back its own tab, whatever the window kept since", async () => {
  fresh();
  const props = { folder: "/b", slot: "keep1" };
  const first = open(props);
  first.setTab("projects", cx);
  await first.close();
  sharedState = { "github.state": { folder: "/b", tab: "prs" } };
  expect(open({ ...props }).tab).toBe("projects");
});
