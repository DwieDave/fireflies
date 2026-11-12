// Pinning panes that aren't agents (a web page, an editor, files, a plain
// shell) to the jar's shelf: the handlers in kit.js, the pane menu (menu.js
// pinItems), the palette's rows, nocturne.pin and the sidebar's tiles (sky.js),
// with herdr and gpui stand-ins (mock.module is process-wide: this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";

let sharedState: Record<string, unknown> = {};
let spacesNow: any[] = [];
let panesNow: any[] = [];
let agentsNow: any[] = [];
let terminalsNow: any[] = [];
let focusedNow: any = null;
let commands: [string, any][] = [];
let labels: string[][] = [];
let overlays: any[] = [];
let queue: string[] = [];
let waiting: ((v: string) => void)[] = [];

const LAYOUT = {
  id: "root", type: "row", children: [
    { id: "sidebar", type: "block", content: { mod: "nocturne", props: { role: "sky" } } },
    { id: "main", type: "block", content: { tab: "active" } },
  ],
};

const herdr: Record<string, any> = {
  agents: () => agentsNow, appHome: () => "/tmp/app", closeOverlay: () => {},
  commands: () => [], exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => focusedNow,
  hc: async (args: string[]) => { if (args[0] === "label") labels.push(args.slice(1)); return { code: 0, stdout: "" }; },
  home: () => "/home/a", keys: () => [{ section: "layout:nocturne", action: "nocturne.pin", keys: "cmd-alt-p" }], knownAgents: () => [],
  layout: () => LAYOUT, layouts: () => ["nocturne"],
  nextCommand: () => queue.length ? Promise.resolve(queue.shift()!) : new Promise<string>((r) => waiting.push(r)),
  notify: () => {}, openOverlay: (spec: any) => { overlays.push(spec); return `o${overlays.length}`; },
  panes: () => panesNow, pickFolder: async () => null, presentUpdateNotes: () => {}, props: () => null,
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  setAgentOrder: () => {}, setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  settings: () => ({ zoom: 1 }), shared: (k: string) => sharedState[k] ?? null,
  spaces: () => spacesNow, terminals: () => terminalsNow, theme: () => theme, updates: () => null,
  window: () => ({ platform: "linux" }),
};
mock.module("herdr", () => herdr);
const el: any = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined : (...a: any[]) => {
    if (k === "when" && a[0]) a[1](el);
    if (k === "map") return a[0](el);
    return el;
  }),
  apply: () => el,
});
mock.module("gpui-kit", () => ({ View: class {}, div: () => el, svg: () => el, image: () => el, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} }
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, v_virtual_list: () => el, Scrollbar: { new: () => el },
  InputState: { new: () => new Input() }, Input: { new: () => el },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) }, VirtualListScrollHandle: { new: () => ({}) },
}));
(globalThis as any).window = { paint_path: () => el };
const theme: any = new Proxy({}, { get: () => "#808080" });

let timers: Function[] = [];
const cx: any = {
  spawn: (f: Function) => { Promise.resolve().then(() => f(cx)).catch(() => {}); },
  notify() {}, stop_propagation() { cx.stopped = true; }, focus_handle: () => ({ focus() {}, is_focused: () => true }),
  new: () => ({ set_props() {} }),
  timer: { every() {}, after: (_ms: number, f: Function) => { timers.push(f); } },
};

const kit = await import("../defaults/mods/nocturne/kit.js");
const pins = await import("../defaults/mods/nocturne/pins.js");
const { menuItems } = await import("../defaults/mods/nocturne/menu.js");
const { default: Sky } = await import("../defaults/mods/nocturne/sky.js");
const palette = await import("../defaults/mods/nocturne/palette.js");

const WEB = { pane: "p2", tab: "c1", terminal: null, mod: "nocturne-browser", props: { slot: "w1" }, title: "nocturne-browser", focused: false, parked: false };
const EDIT = { pane: "p3", tab: "c9", terminal: null, mod: "nocturne-editor", props: { file: "/a/PLAN.md" }, title: "nocturne-editor", focused: false, parked: false };
const FILES = { pane: "p4", tab: "c1", terminal: null, mod: "nocturne-files", props: { path: "/a" }, title: "nocturne-files", focused: false, parked: true };
const SHELL = { pane: "p5", tab: "c1", terminal: "t5", program: { name: "zsh", shell: true }, focused: false, parked: false };

beforeEach(() => {
  sharedState = {}; commands = []; labels = []; overlays = []; queue = []; waiting = []; timers = [];
  spacesNow = [
    { id: "s1", name: "one", active: true, tabs: [{ id: "c1", index: 1, active: true, name: "1" }] },
    { id: "s2", name: "infra", active: false, tabs: [{ id: "c9", index: 1, active: true, name: "1" }] },
  ];
  panesNow = [{ pane: "p1", tab: "c1", terminal: "t1", program: { agent: true, name: "Claude Code" }, focused: true }, WEB, EDIT, FILES, SHELL];
  agentsNow = [{ address: "t1", status: "working", tab: "c1", space: "s1", focused: true }];
  terminalsNow = [{ address: "t1", state: "live", labels: {} }, { address: "t5", state: "live", labels: {} }];
  focusedNow = { space: "s1", tab: "c1", pane: "p2", terminal: null, block: null };
});

const records = () => pins.paneRecords(sharedState[pins.PANES_KEY]);
/** Applies the label writes the handlers sent through hc to terminalsNow. */
function applyLabels() {
  for (const [addr, kv] of labels) {
    const t = terminalsNow.find((x) => x.address === addr);
    const [k, v] = kv.split("=");
    if (t) t.labels = { ...t.labels, [k]: v };
  }
  labels = [];
}
function pinTerminal(addr: string, at: number) {
  const t = terminalsNow.find((x) => x.address === addr);
  t.labels = { ...t.labels, [pins.PIN_LABEL]: "1", [pins.AT_LABEL]: String(at) };
}

test("nocturne.pin pins the focused web pane to the shelf, and again unpins it", () => {
  kit.pinFocused();
  expect(records()).toEqual([{ pane: "p2", mod: "nocturne-browser", props: { slot: "w1" }, at: expect.any(Number) }]);
  expect(commands).toEqual([]); // no terminal: no terminal.pin
  expect(kit.panePinnedNow({ pane: "p2", terminal: null })).toBe(true);
  expect(kit.jar().map((x: any) => x.key)).toEqual(["pane:p2"]);
  kit.pinFocused();
  expect(records()).toEqual([]);
});

test("nocturne.pin on a plain shell pins its terminal (terminal.pin and the pin time)", () => {
  focusedNow = { ...focusedNow, pane: "p5", terminal: "t5" };
  kit.pinFocused();
  expect(commands).toEqual([["terminal.pin", { terminal: "t5", pinned: true }]]);
  expect(labels[0][0]).toBe("t5");
  expect(labels[0][1]).toMatch(/^nocturne\.pinned-at=\d+$/);
  expect(records()).toEqual([]);
});

test("a terminal shown in a layout block (no pane) pins by its terminal", () => {
  focusedNow = { space: "s1", tab: "c1", pane: null, terminal: "t1", block: null };
  expect(kit.focusedPane()).toEqual({ pane: null, terminal: "t1" });
  focusedNow = null;
  expect(kit.focusedPane()).toBe(null);
  kit.pinFocused(); // nothing focused: nothing happens
  expect(commands).toEqual([]);
});

test("reordering: a tile moves past tiles (a shell's too), a firefly past fireflies", () => {
  pinTerminal("t1", 100); // the agent, in the jar's body
  sharedState[pins.PANES_KEY] = [{ pane: "p2", mod: WEB.mod, props: WEB.props, at: 200 }, { pane: "p3", mod: EDIT.mod, props: EDIT.props, at: 400 }];
  pinTerminal("t5", 300); // a shell: on the shelf
  expect(kit.jar().filter(pins.onShelf).map((x: any) => x.key)).toEqual(["pane:p2", "t5", "pane:p3"]);
  kit.movePin("pane:p3", -1);
  applyLabels();
  expect(kit.jar().filter(pins.onShelf).map((x: any) => x.key)).toEqual(["pane:p2", "pane:p3", "t5"]);
  kit.movePin("pane:p2", 1);
  applyLabels();
  expect(kit.jar().filter(pins.onShelf).map((x: any) => x.key)).toEqual(["pane:p3", "pane:p2", "t5"]);
  // The agent has no other firefly to pass: nothing moves, nothing is written.
  kit.movePin("t1", 1);
  expect(labels).toEqual([]);
  // The focused pane's pin, by key (nocturne.pin-up / pin-down).
  focusedNow = { ...focusedNow, pane: "p5", terminal: "t5" };
  kit.moveFocused(-1);
  applyLabels();
  expect(kit.jar().filter(pins.onShelf).map((x: any) => x.key)).toEqual(["pane:p3", "t5", "pane:p2"]);
});

test("going to a pin: a mod pane or a shell by pane.focus (another space, parked: it comes back), an agent by agent.focus", () => {
  pinTerminal("t1", 1);
  pinTerminal("t5", 2);
  sharedState[pins.PANES_KEY] = [{ pane: "p3", at: 3 }, { pane: "p4", at: 4 }];
  const items = Object.fromEntries(kit.jar().map((x: any) => [x.key, x]));
  kit.goToPin(items["pane:p3"]);
  kit.goToPin(items["pane:p4"]);
  kit.goToPin(items.t5);
  kit.goToPin(items.t1);
  kit.goToPin({ kind: "terminal", key: "t7", pane: null });
  expect(commands).toEqual([
    ["pane.focus", { pane: "p3" }], ["pane.focus", { pane: "p4" }], ["pane.focus", { pane: "p5" }],
    ["agent.focus", { terminal: "t1" }], ["agent.focus", { terminal: "t7" }],
  ]);
  kit.unpin(items["pane:p3"]);
  expect(records().map((r: any) => r.pane)).toEqual(["p4"]);
  kit.unpin(items.t5);
  expect(commands.at(-1)).toEqual(["terminal.pin", { terminal: "t5", pinned: false }]);
});

test("the pane menu: a web pane gets Pin to the top, then Unpin and left / right on the shelf", () => {
  const ids = () => menuItems(theme, { tab: "pane", target: { pane: "p2", terminal: null } }).filter((r: any) => !r.rule).map((r: any) => [r.id, r.name]);
  expect(ids().slice(0, 1)).toEqual([["pin", "Pin to the top"]]);
  menuItems(theme, { tab: "pane", target: { pane: "p2", terminal: null } })[0].go();
  expect(records().map((r: any) => r.pane)).toEqual(["p2"]);
  expect(ids().slice(0, 2)).toEqual([["unpin", "Unpin"], ["split-right", "Split right"]]);
  // A second tile: the first can move right, the second left; an agent moves in the jar, not past tiles.
  sharedState[pins.PANES_KEY] = [...records(), { pane: "p4", mod: FILES.mod, props: FILES.props, at: Date.now() + 5 }];
  expect(ids().slice(0, 2)).toEqual([["unpin", "Unpin"], ["pin-down", "Move right on the shelf"]]);
  const files = menuItems(theme, { tab: "pane", target: { pane: "p4", terminal: null } }).filter((r: any) => !r.rule);
  expect(files.slice(0, 2).map((r: any) => r.name)).toEqual(["Unpin", "Move left on the shelf"]);
  pinTerminal("t1", 1);
  const agent = menuItems(theme, { tab: "pane", target: { pane: "p1", terminal: "t1" } }).filter((r: any) => !r.rule);
  expect(agent.slice(0, 3).map((r: any) => r.name)).toEqual(["Rename", "Unpin", "Split right"]);
  // A plain shell's pane pins through its terminal.
  const shell = menuItems(theme, { tab: "pane", target: { pane: "p5", terminal: "t5" } }).filter((r: any) => !r.rule);
  expect(shell.slice(0, 2).map((r: any) => r.name)).toEqual(["Rename", "Pin to the top"]);
  shell[1].go();
  expect(commands.at(-1)).toEqual(["terminal.pin", { terminal: "t5", pinned: true }]);
});

test("the palette pins the focused pane, whatever it shows, and moves its tile", () => {
  const rows = () => { const p: any = new (palette as any).default(); p.init({}, cx); p.query = ""; return p.rows().map((r: any) => r.e); };
  const pin = () => rows().find((e: any) => e.bind === "nocturne.pin");
  expect(pin().title).toBe("Pin this pane to the top");
  expect(pin().group).toBe("Pane");
  pin().go();
  expect(records().map((r: any) => r.pane)).toEqual(["p2"]);
  expect(pin().title).toBe("Unpin this pane");
  expect(rows().some((e: any) => e.name === "nocturne.pin-down")).toBe(false); // alone on the shelf
  sharedState[pins.PANES_KEY] = [...records(), { pane: "p4", mod: FILES.mod, props: FILES.props, at: Date.now() + 5 }];
  const down = rows().find((e: any) => e.name === "nocturne.pin-down");
  expect(down.title).toBe("Move this pane right on the shelf");
  down.go();
  expect(kit.jar().map((x: any) => x.key)).toEqual(["pane:p4", "pane:p2"]);
  // An agent's pane: the agent's words.
  focusedNow = { ...focusedNow, pane: "p1", terminal: "t1" };
  expect(pin().title).toBe("Pin this agent to the top");
});

test("the sidebar draws the shelf's tiles in the keyboard's walk; p, J, K and enter act on a tile", async () => {
  pinTerminal("t1", 1);
  sharedState[pins.PANES_KEY] = [{ pane: "p2", mod: WEB.mod, props: WEB.props, at: 2 }, { pane: "p3", mod: EDIT.mod, props: EDIT.props, at: 3 }];
  pinTerminal("t5", 4);
  const s = new Sky();
  s.init({ role: "sky" }, cx);
  focusedNow = { ...focusedNow, block: "sidebar" };
  s.render(cx);
  s.takeKeys();
  s.render(cx);
  const ids = s.navList.map((x: any) => x.id);
  const at = (id: string) => ids.indexOf(id);
  // The jar's firefly, then the shelf's tiles in their order.
  expect(at("fly:t1")).toBeLessThan(at("pin:pane:p2"));
  expect(at("pin:pane:p2")).toBeLessThan(at("pin:pane:p3"));
  expect(at("pin:pane:p3")).toBeLessThan(at("pin:t5"));
  // Lit: on screen now; another space or parked: not.
  const item = (key: string) => kit.jar().find((x: any) => x.key === key);
  expect(s.pinLit(item("pane:p2"))).toBe(true);
  expect(s.pinLit(item("pane:p3"))).toBe(false);
  // Named "Editor" (no file title yet): the kind isn't said twice.
  expect(s.pinName(item("pane:p3"))).toBe("Editor");
  expect(s.pinWhere(item("pane:p3"))).toBe("infra");
  expect(s.pinWhere({ kind: "pane", key: "pane:p4", pane: FILES })).toBe("files · parked");
  expect(s.pinLit({ kind: "pane", key: "pane:p4", pane: FILES })).toBe(false);
  // A web pane goes by its page's title (nocturne-browser.titles by slot), else the host it opened on.
  expect(s.pinName(item("pane:p2"))).toBe("Web");
  expect(s.pinWhere(item("pane:p2"))).toBe("");
  sharedState["nocturne-browser.titles"] = { w1: "Grafana · ops" };
  expect(s.pinName(item("pane:p2"))).toBe("Grafana · ops");
  expect(s.pinWhere(item("pane:p2"))).toBe("web");
  expect(s.pinName({ kind: "pane", key: "pane:x", pane: { ...WEB, props: { url: "https://github.com/a/b" } } })).toBe("github.com");
  expect(s.pinWhere(item("t5"))).toBe("shell");
  s.cursor = "pin:pane:p3";
  const key = (k: string, shift = false) => { cx.stopped = false; s.key({ key: k, key_char: shift ? k.toUpperCase() : k, modifiers: { control: false, platform: false, alt: false, shift } }, cx); s.render(cx); };
  key("enter");
  expect(commands.at(-1)).toEqual(["pane.focus", { pane: "p3" }]);
  key("j", true); // J: right on the shelf
  applyLabels();
  expect(kit.jar().filter(pins.onShelf).map((x: any) => x.key)).toEqual(["pane:p2", "t5", "pane:p3"]);
  key("k", true); // K: back left
  applyLabels();
  expect(kit.jar().filter(pins.onShelf).map((x: any) => x.key)).toEqual(["pane:p2", "pane:p3", "t5"]);
  key("p"); // unpin
  expect(records().map((r: any) => r.pane)).toEqual(["p2"]);
});

test("nocturne.pin reaches the sky's command loop", async () => {
  const s = new Sky();
  s.init({ role: "sky" }, cx);
  s.render(cx);
  await new Promise((r) => setTimeout(r, 0));
  waiting.shift()!("nocturne.pin");
  await new Promise((r) => setTimeout(r, 0));
  expect(records().map((r: any) => r.pane)).toEqual(["p2"]);
});

test("a closed pane's pin goes after a while; a pane missing at first (loading) keeps it", () => {
  sharedState[pins.PANES_KEY] = [{ pane: "p2", at: 1 }, { pane: "gone", mod: "nocturne-browser", props: { slot: "zz" }, at: 2 }];
  const s = new Sky();
  s.init({ role: "sky" }, cx);
  const real = Date.now;
  try {
    let now = 1_000_000;
    Date.now = () => now;
    s.render(cx);
    for (const f of timers.splice(0)) f(cx);
    expect(records().map((r: any) => r.pane)).toEqual(["p2", "gone"]);
    now += pins.GONE_AFTER;
    s.render(cx);
    for (const f of timers.splice(0)) f(cx);
    expect(records().map((r: any) => r.pane)).toEqual(["p2"]);
  } finally { Date.now = real; }
});
