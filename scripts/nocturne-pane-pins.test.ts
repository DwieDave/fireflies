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
  spaces: () => spacesNow, terminals: () => terminalsNow, theme: () => theme, updates: () => ({ app: { version: "1.0", ready: null, updates: false }, core: { version: null, managed: null, ready: null, updating: false, error: null }, checked: null, checks: true, checking: false, notes: [] }),
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

const kit = await import("../defaults/mods/nocturne/kit.ts");
const pins = await import("../defaults/mods/nocturne/pins.ts");
const { menuItems } = await import("../defaults/mods/nocturne/menu.ts");
const { default: Sky } = await import("../defaults/mods/nocturne/sky.ts");
const palette = await import("../defaults/mods/nocturne/palette.ts");

const WEB = { pane: "p2", tab: "c1", terminal: null, mod: "browser", props: { slot: "w1" }, title: "browser", focused: false, parked: false };
const EDIT = { pane: "p3", tab: "c9", terminal: null, mod: "editor", props: { file: "/a/PLAN.md" }, title: "editor", focused: false, parked: false };
const FILES = { pane: "p4", tab: "c1", terminal: null, mod: "file-tree", props: { path: "/a" }, title: "file-tree", focused: false, parked: true };
const SHELL = { pane: "p5", tab: "c1", terminal: "t5", program: { name: "zsh", shell: true }, focused: false, parked: false };

beforeEach(() => {
  sharedState = {}; commands = []; labels = []; overlays = []; queue = []; waiting = []; timers = [];
  spacesNow = [
    { id: "s1", name: "one", active: true, tabs: [{ id: "c1", index: 1, active: true, name: "1" }] },
    { id: "s2", name: "infra", active: false, tabs: [{ id: "c9", index: 1, active: true, name: "1" }] },
  ];
  panesNow = [{ pane: "p1", tab: "c1", terminal: "t1", program: { agent: true, name: "Claude Code" }, focused: true }, WEB, EDIT, FILES, SHELL];
  agentsNow = [{ address: "t1", status: "working", tab: "c1", space: "s1", focused: true, program: { key: "", name: "", icon: null, tint: false, tile: null, color: null, shell: false, agent: false } }];
  terminalsNow = [{ address: "t1", state: "live", labels: {} }, { address: "t5", state: "live", labels: {} }];
  focusedNow = { space: "s1", tab: "c1", pane: "p2", terminal: null, block: null };
});

const records = () => pins.paneRecords((k: string) => sharedState[k]);
/** The pins as stored (props as plain objects). */
const stored = () => pins.storedRecords(records());
/** Records written here as stored, read as the jar reads them. */
const parsed = (list: unknown[]) => pins.paneRecords(() => list);
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
  expect(stored()).toEqual([{ pane: "p2", mod: "browser", props: { slot: "w1" }, at: expect.any(Number) }]);
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
  expect(ids().slice(0, 3)).toEqual([["unpin", "Unpin"], ["dock", "Move to the dock"], ["split-right", "Split right"]]);
  // A second tile: the first can move right, the second left; an agent moves in the jar, not past tiles.
  sharedState[pins.PANES_KEY] = [...stored(), { pane: "p4", mod: FILES.mod, props: FILES.props, at: Date.now() + 5 }];
  expect(ids().slice(0, 2)).toEqual([["unpin", "Unpin"], ["pin-down", "Move right"]]);
  const files = menuItems(theme, { tab: "pane", target: { pane: "p4", terminal: null } }).filter((r: any) => !r.rule);
  expect(files.slice(0, 2).map((r: any) => r.name)).toEqual(["Unpin", "Move left"]);
  pinTerminal("t1", 1);
  const agent = menuItems(theme, { tab: "pane", target: { pane: "p1", terminal: "t1" } }).filter((r: any) => !r.rule);
  expect(agent.slice(0, 3).map((r: any) => r.name)).toEqual(["Rename", "Unpin", "Move to the dock"]);
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
  sharedState[pins.PANES_KEY] = [...stored(), { pane: "p4", mod: FILES.mod, props: FILES.props, at: Date.now() + 5 }];
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
  // A web pane goes by its page's title (browser.titles by slot), else the host it opened on.
  expect(s.pinName(item("pane:p2"))).toBe("Web");
  expect(s.pinWhere(item("pane:p2"))).toBe("");
  sharedState["browser.titles"] = { w1: "Grafana · ops" };
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
  sharedState[pins.PANES_KEY] = [{ pane: "p2", at: 1 }, { pane: "gone", mod: "browser", props: { slot: "zz" }, at: 2 }];
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

test("a pin found under its pane's new id is stored with that id and its props as they were (plain JSON)", () => {
  sharedState[pins.PANES_KEY] = [{ pane: "old", mod: WEB.mod, props: WEB.props, at: 1 }];
  const s = new Sky();
  s.init({ role: "sky" }, cx);
  s.render(cx);
  for (const f of timers.splice(0)) f(cx);
  expect(sharedState[pins.PANES_KEY]).toEqual([{ pane: "p2", mod: WEB.mod, props: WEB.props, at: 1 }]);
});

// ---- the dock: a space tied to no folder for panes that belong to no project (dock.js)

const dockMod = await import("../defaults/mods/nocturne/dock.ts");

test("dock.js: the dock is found by its id (local only); a making adopts the new space named dock, or gives up", () => {
  const all = [{ id: "s1", name: "one", named: true }, { id: "s7", name: "dock", named: true }, { id: "m/s8", name: "dock", named: true, machine: "m" }];
  expect(dockMod.findDock({ id: "s7" }, all)).toBe(all[1]);
  expect(dockMod.findDock({ id: "gone" }, all)).toBe(null);
  expect(dockMod.findDock({ id: "m/s8" }, all)).toBe(null);
  expect(dockMod.findDock(null, all)).toBe(null);
  const next = { kind: "web", slot: "x" };
  // A space named dock that was there before isn't the new one.
  expect(dockMod.adopt({ making: { at: 0, before: ["s1", "s7"], next } }, all, 1)).toBe(null);
  expect(dockMod.adopt({ making: { at: 0, before: ["s1"], next } }, all, 1)).toEqual({ id: "s7", next });
  // An unnamed space (Fireflies' name after its folder) isn't it either.
  expect(dockMod.adopt({ making: { at: 0, before: [] } }, [{ id: "s9", name: "dock", named: false }], 1)).toBe(null);
  expect(dockMod.adopt({ making: { at: 0, before: [] } }, [], dockMod.MAKING + 1)).toEqual({ id: null, next: null });
  expect(dockMod.adopt({ id: "s7" }, all, 1)).toBe(null);
});

test("a new web pane in the dock: the dock is made first (in ~, named dock), then the page opens there, pinned to the shelf", () => {
  kit.dockWeb("https://docs.rs");
  expect(commands).toEqual([["space.new", { name: "dock", folder: "/home/a", machine: "" }]]);
  const slot = (stored()[0] as any).props.slot;
  expect(stored()[0]).toEqual({ pane: `new:${slot}`, mod: "browser", props: { slot, url: "https://docs.rs" }, at: expect.any(Number) });
  // Asked again while it's being made: no second space, no stray pin.
  kit.dockWeb();
  expect(commands.filter(([n]) => n === "space.new").length).toBe(1);
  expect(records().length).toBe(1);
  // The space appears: the sky adopts it and opens the page there.
  spacesNow = [...spacesNow, { id: "s9", name: "dock", named: true, folder: "/home/a", attached: true, active: true, tabs: [{ id: "c99", index: 1, active: true }] }];
  expect(dockMod.adoptDock()).toBe(true);
  expect(sharedState[dockMod.DOCK_KEY]).toEqual({ id: "s9" });
  expect(commands.at(-1)).toEqual(["tab.new", { space: "s9", mod: "browser", props: { slot, url: "https://docs.rs" } }]);
  // The pane shows up under its own id: the pin finds it by its props and takes the id.
  panesNow = [...panesNow, { pane: "p99", tab: "c100", terminal: null, mod: "browser", props: { slot, url: "https://docs.rs" } }];
  expect(kit.jar().map((x: any) => x.key)).toContain("pane:p99");
  expect(pins.tidy(records(), panesNow, new Map(), 0)!.map((r: any) => r.pane)).toEqual(["p99"]);
  // With the dock there, the next one opens at once.
  commands = [];
  kit.dockWeb();
  expect(commands[0][0]).toBe("tab.new");
  expect(commands[0][1].space).toBe("s9");
});

test("moving a pane to the dock pins it and moves it into a tab of its own there; a remote or docked pane isn't offered", () => {
  sharedState[dockMod.DOCK_KEY] = { id: "s2" }; // infra plays the dock
  kit.dockPane(WEB);
  expect(records().map((r: any) => r.pane)).toEqual(["p2"]);
  expect(commands.at(-1)).toEqual(["pane.move", { pane: "p2", space: "s2" }]);
  // The pane menu: "Move to the dock" on a pane outside it, not on one inside it.
  const rows = (pane: string, terminal: string | null = null) => menuItems(theme, { tab: "pane", target: { pane, terminal } }).filter((r: any) => !r.rule).map((r: any) => r.id);
  expect(rows("p4")).toContain("dock");
  expect(rows("p3")).not.toContain("dock"); // the editor sits in infra, the dock here
  panesNow = [...panesNow, { pane: "m/p1", tab: "m/c1", terminal: null, mod: "browser", props: {} }];
  expect(rows("m/p1")).not.toContain("dock");
  // nocturne.dock: the focused pane, if it's outside the dock.
  commands = [];
  focusedNow = { ...focusedNow, pane: "p4", terminal: null };
  kit.dockFocused();
  expect(commands.at(-1)).toEqual(["pane.move", { pane: "p4", space: "s2" }]);
  commands = [];
  focusedNow = { ...focusedNow, pane: "p3", terminal: null };
  kit.dockFocused();
  expect(commands).toEqual([]);
});

test("the dock keeps no folder: no repo for git, no folder / worktree / delete in its menu or by key", () => {
  sharedState[dockMod.DOCK_KEY] = { id: "s2" };
  spacesNow[1] = { ...spacesNow[1], folder: "/home/a", attached: true };
  panesNow = [...panesNow, { pane: "p8", tab: "c9", terminal: "t8", cwd: "/src/repo" }];
  expect(kit.spaceFolder(spacesNow[1], panesNow)).toBe(null);
  expect(kit.spaceFolder({ ...spacesNow[1], id: "s3", attached: false }, panesNow)).toBe("/src/repo");
  const ids = (id: string) => menuItems(theme, { tab: "space", target: { id } }).filter((r: any) => !r.rule).map((r: any) => r.id);
  expect(ids("s2")).toEqual(["select", "new", "rename"]);
  expect(ids("s1")).toEqual(["select", "new", "rename", "folder", "worktree", "delete"]);
  const s = new Sky();
  s.init({ role: "sky" }, cx);
  const acts = s.spaces.acts(spacesNow[1]);
  expect(acts.folder).toBe(undefined);
  expect(acts.delete).toBe(undefined);
  expect(acts.worktree).toBe(undefined);
  expect(typeof s.spaces.acts(spacesNow[0]).delete).toBe("function");
  expect(s.railActs(spacesNow[1]).delete).toBe(undefined);
});

test("the palette opens a web pane in the dock, and moves the focused pane there", () => {
  const rows = () => { const p: any = new (palette as any).default(); p.init({}, cx); p.query = ""; return p.rows().map((r: any) => r.e); };
  const web = rows().find((e: any) => e.title === "New web pane in the dock");
  expect(web).toBeTruthy();
  expect(rows().some((e: any) => e.title === "Move this pane to the dock")).toBe(true);
  expect(rows().filter((e: any) => /^New (shell|files pane) in the dock$/.test(e.title)).map((e: any) => e.name)).toEqual(["nocturne.dock-shell", "nocturne.dock-files"]);
  web.go();
  expect(commands.at(-1)![0]).toBe("space.new");
});

test("the shelf ends in a + tile: the dock's menu, in the keyboard's walk", () => {
  sharedState[pins.PANES_KEY] = [{ pane: "p2", mod: WEB.mod, props: WEB.props, at: 2 }];
  sharedState[dockMod.DOCK_KEY] = { id: "s2" };
  const s = new Sky();
  s.init({ role: "sky" }, cx);
  focusedNow = { ...focusedNow, block: "sidebar" };
  s.render(cx);
  s.takeKeys();
  s.render(cx);
  const ids = s.navList.map((x: any) => x.id);
  expect(ids.indexOf("shelf-new")).toBe(ids.indexOf("pin:pane:p2") + 1);
  s.cursor = "shelf-new";
  s.key({ key: "enter", key_char: null, modifiers: { control: false, platform: false, alt: false, shift: false } }, cx);
  // Enter opens the dock's menu (centered: from the keyboard); its web row opens the page in the dock.
  expect(overlays.at(-1)).toMatchObject({ mod: "nocturne", kind: "dialog", props: { role: "menu", tab: "dock" } });
  menuItems(theme, { tab: "dock" }).find((r: any) => r.id === "dock-web").go();
  expect(commands.at(-1)![0]).toBe("tab.new");
  expect(commands.at(-1)![1].space).toBe("s2");
});

// ---- one web tab pinned on its own (browser writes these records: { …, tab })

test("a web tab's pin: its own tile next to the pane's, keys and order of its own; pinning the pane leaves it", () => {
  sharedState[pins.PANES_KEY] = [
    { pane: "p2", mod: WEB.mod, props: WEB.props, at: 10, tab: "web-2" },
    { pane: "p3", mod: EDIT.mod, props: EDIT.props, at: 20 },
    { pane: "p2", mod: WEB.mod, props: WEB.props, at: 30, tab: "web" },
  ];
  const shelf = () => kit.jar().filter(pins.onShelf).map((x: any) => x.key);
  expect(shelf()).toEqual(["pane:p2#web-2", "pane:p3", "pane:p2#web"]);
  expect(kit.jar()[0]).toMatchObject({ kind: "pane", tab: "web-2", pane: { pane: "p2" } });
  // The pane as a whole isn't pinned by its tabs' pins; pinning it adds its own tile, unpinning it leaves the tabs'.
  expect(kit.panePinnedNow({ pane: "p2", terminal: null })).toBe(false);
  expect(pins.tabPinned(records(), "p2", "web")).toBe(true);
  kit.pinFocused();
  expect(shelf()).toEqual(["pane:p2#web-2", "pane:p3", "pane:p2#web", "pane:p2"]);
  kit.pinFocused();
  expect(shelf()).toEqual(["pane:p2#web-2", "pane:p3", "pane:p2#web"]);
  // Reordered by its own key: the tab pins move as tiles of their own.
  kit.movePin("pane:p2#web", -1);
  expect(shelf()).toEqual(["pane:p2#web-2", "pane:p2#web", "pane:p3"]);
  expect(records().find((r: any) => r.tab === "web-2").at).not.toBe(records().find((r: any) => r.tab === "web").at);
  // The record helpers: pin and unpin one tab, the others stay.
  const one = pins.pinTabRecord([], WEB, "web-3", true, 5);
  expect(pins.storedRecords(one)).toEqual([{ pane: "p2", mod: "browser", props: { slot: "w1" }, at: 5, tab: "web-3" }]);
  expect(pins.pinTabRecord(records(), WEB, "web", false, 6).map((r: any) => pins.recordKey(r))).toEqual(["pane:p2#web-2", "pane:p3"]);
});

test("going to a web tab's pin: its pane, then that tab (show:{slot, tab}, and a wish for when it comes on screen); unpin takes that tab's alone", () => {
  sharedState[pins.PANES_KEY] = [{ pane: "p2", mod: WEB.mod, props: WEB.props, at: 1, tab: "web-2" }, { pane: "p2", mod: WEB.mod, props: WEB.props, at: 2 }];
  const items = Object.fromEntries(kit.jar().map((x: any) => [x.key, x]));
  kit.goToPin(items["pane:p2#web-2"]);
  expect(commands).toEqual([["pane.focus", { pane: "p2" }], ['browser.show:{"slot":"w1","tab":"web-2"}', undefined]]);
  expect(sharedState[kit.WEB_SHOW]).toEqual({ slot: "w1", tab: "web-2", at: expect.any(Number) });
  // The whole pane's tile: the pane only.
  commands = [];
  kit.goToPin(items["pane:p2"]);
  expect(commands).toEqual([["pane.focus", { pane: "p2" }]]);
  kit.unpin(items["pane:p2#web-2"]);
  expect(records().map((r: any) => pins.recordKey(r))).toEqual(["pane:p2"]);
});

test("a web tab's tile is named by that tab's title (browser.tab-titles), the pane's by its shown tab", async () => {
  const { webName } = await import("../defaults/mods/nocturne/shelf.ts");
  sharedState["browser.titles"] = { w1: "Shown page" };
  sharedState["browser.tab-titles"] = { w1: { web: "Shown page", "web-2": "YouTube" } };
  expect(webName(WEB, "web-2")).toBe("YouTube");
  expect(webName(WEB)).toBe("Shown page");
  // A tab not named yet: the pane's host, else "Web".
  expect(webName({ ...WEB, props: { slot: "w1", url: "https://www.youtube.com/x" } }, "web-9")).toBe("www.youtube.com");
  expect(webName(WEB, "web-9")).toBe("Web");
});

test("a web tile wears its page's favicon (browser.icons, browser.tab-icons by tab), else the web mark", async () => {
  const { webIcon } = await import("../defaults/mods/nocturne/shelf.ts");
  delete sharedState["browser.icons"];
  delete sharedState["browser.tab-icons"];
  expect(webIcon(WEB)).toBe(null);
  expect(webIcon(WEB, "web-2")).toBe(null);
  sharedState["browser.icons"] = { w1: "cache/browser-icons/a.example" };
  sharedState["browser.tab-icons"] = { w1: { web: "cache/browser-icons/a.example", "web-2": "cache/browser-icons/www.youtube.com" } };
  expect(webIcon(WEB)).toBe("cache/browser-icons/a.example");
  expect(webIcon(WEB, "web-2")).toBe("cache/browser-icons/www.youtube.com");
  expect(webIcon(WEB, "web-9")).toBe(null);
  // A pane without a slot, or a path outside the browser's cache: none.
  expect(webIcon({ props: {} })).toBe(null);
  sharedState["browser.icons"] = { w1: "/etc/passwd" };
  expect(webIcon(WEB)).toBe(null);
});

test("a closed pane's pins go together, its tab pins too; a pane back under a new id keeps them all", () => {
  const recs = parsed([
    { pane: "gone", mod: "browser", props: { slot: "zz" }, at: 1, tab: "web" },
    { pane: "gone", mod: "browser", props: { slot: "zz" }, at: 2, tab: "web-2" },
    { pane: "gone", mod: "browser", props: { slot: "zz" }, at: 3 },
    { pane: "p2", mod: WEB.mod, props: WEB.props, at: 4, tab: "web" },
  ]);
  const missing = new Map();
  expect(pins.tidy(recs, panesNow, missing, 0)).toBe(null);
  expect(pins.tidy(recs, panesNow, missing, pins.GONE_AFTER)!.map((r: any) => pins.recordKey(r))).toEqual(["pane:p2#web"]);
  expect(missing.size).toBe(0);
  // After a restart the pane is p7 (same slot): every record of it follows.
  const back = pins.tidy(recs, [...panesNow, { pane: "p7", tab: "c1", terminal: null, mod: "browser", props: { slot: "zz" } }], new Map(), 0)!;
  expect(back.map((r: any) => pins.recordKey(r))).toEqual(["pane:p7#web", "pane:p7#web-2", "pane:p7", "pane:p2#web"]);
});

// ---- jarfly item 2: any pane docks, not only web panes

const walkMod = await import("../defaults/mods/nocturne/walk.ts");

/** The dock is s3, a space of its own (made earlier); s1 and s2 are projects. */
function withDock() {
  spacesNow = [...spacesNow, { id: "s3", name: "dock", named: true, folder: "/home/a", attached: true, active: false, tabs: [{ id: "c30", index: 1, active: true, name: "1" }] }];
  sharedState[dockMod.DOCK_KEY] = { id: "s3" };
}

test("any pane docks: a shell, an agent, an editor, a files pane and a web pane each move into the dock, pinned, and their tile goes back to them", () => {
  withDock();
  for (const p of [SHELL, EDIT, FILES, WEB]) kit.dockPane(p);
  kit.dockPane(panesNow[0]); // the agent's pane
  expect(commands.filter(([n]) => n === "pane.move")).toEqual(["p5", "p3", "p4", "p2", "p1"].map((pane) => ["pane.move", { pane, space: "s3" }]));
  // A terminal's pin is its terminal's (it runs on in the core); a mod pane's a record by its props (its slot and store stay).
  expect(commands.filter(([n]) => n === "terminal.pin")).toEqual([["terminal.pin", { terminal: "t5", pinned: true }], ["terminal.pin", { terminal: "t1", pinned: true }]]);
  expect(stored().map((r: any) => [r.pane, r.mod, r.props])).toEqual([["p3", "editor", EDIT.props], ["p4", "file-tree", FILES.props], ["p2", "browser", WEB.props]]);
  applyLabels();
  for (const a of ["t1", "t5"]) terminalsNow.find((x) => x.address === a).labels[pins.PIN_LABEL] = "1";
  // The agent flies in the jar; the others sit on the shelf.
  const jar = kit.jar();
  expect(jar.filter((x: any) => !pins.onShelf(x)).map((x: any) => x.key)).toEqual(["t1"]);
  expect(jar.filter(pins.onShelf).map((x: any) => x.key).sort()).toEqual(["pane:p2", "pane:p3", "pane:p4", "t5"]);
  // A tile's click goes to its pane in the dock (a parked one comes back); the agent's firefly to the agent.
  commands = [];
  for (const it of jar) kit.goToPin(it);
  const by = (x: any) => JSON.stringify(x);
  expect(commands.map(by).sort()).toEqual([["agent.focus", { terminal: "t1" }], ...["p5", "p3", "p4", "p2"].map((pane) => ["pane.focus", { pane }])].map(by).sort());
  // The walk: the agents, then every docked tile.
  const shelf = jar.filter(pins.onShelf);
  expect(walkMod.walkStops(["t1"], shelf).map((x: any) => x.key)).toEqual(["t1", ...shelf.map((x: any) => x.key)]);
});


test("a docked pane closes as any pane does: its menu's Close runs pane.close (the app asks first for a running terminal or unsaved work)", () => {
  withDock();
  kit.dockPane(SHELL);
  const close = menuItems(theme, { tab: "pane", target: { pane: "p5", terminal: "t5" } }).find((r: any) => r.id === "close");
  close.go();
  expect(commands.at(-1)).toEqual(["pane.close", { pane: "p5" }]);
  // Already in the dock: not offered again.
  panesNow = panesNow.map((p) => (p.pane === "p5" ? { ...p, tab: "c30" } : p));
  expect(menuItems(theme, { tab: "pane", target: { pane: "p5", terminal: "t5" } }).some((r: any) => r.id === "dock")).toBe(false);
});

test("the + tile's menu: the focused pane (when it can go), the shown tab whole, a new web pane, shell or files pane", () => {
  withDock();
  const ids = () => menuItems(theme, { tab: "dock" }).filter((r: any) => !r.rule).map((r: any) => r.id);
  const tab = kit.shownTab();
  // The shown tab is offered while it isn't pinned whole.
  expect(ids()).toEqual(tab ? ["dock-this", "dock-tab", "dock-web", "dock-shell", "dock-files"] : ["dock-this", "dock-web", "dock-shell", "dock-files"]);
  if (tab) kit.pinTab(tab, true);
  expect(ids()).toEqual(["dock-this", "dock-web", "dock-shell", "dock-files"]);
  if (tab) kit.pinTab(tab, false);
  sharedState[pins.TABS_KEY] = spacesNow.flatMap((s: any) => s.tabs.map((c: any) => ({ tab: c.id, space: s.id, at: 1 })));
  menuItems(theme, { tab: "dock" }).find((r: any) => r.id === "dock-this").go();
  expect(commands.at(-1)).toEqual(["pane.move", { pane: "p2", space: "s3" }]);
  // A pane in the dock already, or on another machine, isn't offered.
  panesNow = [...panesNow, { pane: "p31", tab: "c30", terminal: null, mod: "browser", props: { slot: "d" } }, { pane: "m/p1", tab: "m/c1", terminal: null, mod: "browser", props: {} }];
  for (const pane of ["p31", "m/p1"]) {
    focusedNow = { ...focusedNow, pane };
    expect(ids()).toEqual(["dock-web", "dock-shell", "dock-files"]);
  }
});

test("a new files pane in the dock: at ~, pinned by its props until the pane is there", () => {
  withDock();
  kit.dockFiles();
  const slot = (stored()[0] as any).props.slot;
  expect(commands).toEqual([["tab.new", { space: "s3", mod: "file-tree", props: { path: "/home/a", slot } }]]);
  expect(stored()[0]).toEqual({ pane: `new:${slot}`, mod: "file-tree", props: { path: "/home/a", slot }, at: expect.any(Number) });
  panesNow = [...panesNow, { pane: "p40", tab: "c31", terminal: null, mod: "file-tree", props: { path: "/home/a", slot } }];
  expect(kit.jar().map((x: any) => x.key)).toContain("pane:p40");
});

test("a new shell in the dock: tab.new there, and its terminal is pinned once it appears (not one that was there before)", () => {
  withDock();
  panesNow = [...panesNow, { pane: "p30", tab: "c30", terminal: "t30", program: { name: "zsh", shell: true } }];
  kit.dockShell();
  expect(commands).toEqual([["tab.new", { space: "s3" }]]);
  expect(sharedState[dockMod.SHELL_KEY]).toEqual({ at: expect.any(Number), before: ["p30"] });
  expect(dockMod.shellWaiting()).toBe(true);
  // Not there yet: nothing pinned, still waiting.
  kit.pinDockShell();
  expect(commands.length).toBe(1);
  spacesNow[2].tabs.push({ id: "c32", index: 2, active: true, name: "2" });
  panesNow = [...panesNow, { pane: "p32", tab: "c32", terminal: "t32", program: { name: "zsh", shell: true } }];
  // Its pane shows before its terminal runs: terminal.pin would fail, so it waits.
  kit.pinDockShell();
  expect(commands.length).toBe(1);
  // As the app lists a plain shell: no agent status (null), a program, a title.
  terminalsNow = [...terminalsNow, { address: "t32", state: "live", labels: {}, status: null, title: "zsh", program: { key: "shell", name: "zsh", shell: true }, floating: false, floating_view: null }];
  kit.pinDockShell();
  expect(commands.at(-1)).toEqual(["terminal.pin", { terminal: "t32", pinned: true }]);
  expect(dockMod.shellWaiting()).toBe(false);
  // One that never comes is given up.
  expect(dockMod.newShell({ at: 0, before: [] }, [], new Set(), dockMod.MAKING + 1)).toBe("gone");
  // Made with the dock: the shell opens once the sky adopts it.
  sharedState = {}; commands = [];
  spacesNow = spacesNow.slice(0, 2);
  kit.dockShell();
  expect(commands).toEqual([["space.new", { name: "dock", folder: "/home/a", machine: "" }]]);
  spacesNow = [...spacesNow, { id: "s9", name: "dock", named: true, folder: "/home/a", attached: true, active: true, tabs: [{ id: "c99", index: 1, active: true }] }];
  expect(dockMod.adoptDock()).toBe(true);
  expect(commands.at(-1)).toEqual(["tab.new", { space: "s9" }]);
});

test("after a restart: the dock is still the dock (its id kept), a docked editor found again under its new id, a docked shell by its terminal's own pin", () => {
  withDock();
  kit.dockPane(EDIT);
  kit.dockPane(SHELL);
  applyLabels();
  terminalsNow.find((x) => x.address === "t5").labels[pins.PIN_LABEL] = "1";
  // The app restarts: the core keeps the space and the terminal; the editor's pane comes back as p77.
  panesNow = panesNow.map((p) => (p.pane === "p3" ? { ...p, pane: "p77", tab: "c30" } : p.pane === "p5" ? { ...p, tab: "c30" } : p));
  expect(dockMod.dock()?.id).toBe("s3");
  expect(kit.jar().filter(pins.onShelf).map((x: any) => x.key).sort()).toEqual(["pane:p77", "t5"]);
  expect(pins.tidy(records(), panesNow, new Map(), 0)!.map((r: any) => r.pane)).toEqual(["p77"]);
});

test("a plain shell as the app lists it (status null) is a terminal to nocturne: its pin puts a tile on the shelf", () => {
  terminalsNow = [{ address: "t5", state: "live", labels: { [pins.PIN_LABEL]: "1", [pins.AT_LABEL]: "1" }, status: null, title: "zsh", report: null,
    program: { key: "shell", name: "zsh", icon: null, tint: true, tile: null, color: null, shell: true, agent: false }, floating: false, floating_view: null, float_views: null }];
  expect(kit.terminalsNow().map((x: any) => x.address)).toEqual(["t5"]);
  expect(kit.jar().filter(pins.onShelf).map((x: any) => x.key)).toEqual(["t5"]);
});

// ---- walkicons item 1: the walk and the sidebar's j / k go through the
// shelf where it's drawn: in the jar, under the pinned agents and above the
// rest ("The j and k are wrongly applied to the pinned tabs when walking through them").

/** All four groups the sidebar draws, top to bottom: t1 pinned (in the jar), a
 *  web pane and a shell on the jar's shelf, t6 working and t7 done under the
 *  jar (t7 listed first by agents(): the sidebar's order puts it last). */
function jarAndMeadow() {
  pinTerminal("t1", 1);
  sharedState[pins.PANES_KEY] = [{ pane: "p2", mod: WEB.mod, props: WEB.props, at: 2 }];
  pinTerminal("t5", 3);
  const agentPane = (n: string) => ({ pane: `p${n}`, tab: "c1", terminal: `t${n}`, program: { agent: true, name: "Claude Code" }, focused: false });
  panesNow = [...panesNow, agentPane("6"), agentPane("7")];
  agentsNow = [agentsNow[0], { ...agentsNow[0], address: "t7", status: "done", focused: false }, { ...agentsNow[0], address: "t6", focused: false }];
  terminalsNow = [...terminalsNow, { address: "t6", state: "live", labels: {} }, { address: "t7", state: "live", labels: {} }];
}

test("the walk goes as the sidebar draws: the pinned agents, the shelf's tiles, the working agents, the resting ones; previous the other way", async () => {
  jarAndMeadow();
  const s = new Sky();
  s.init({ role: "sky" }, cx);
  s.render(cx);
  const walkTo = async (c: string, from: any) => {
    focusedNow = { space: "s1", tab: "c1", block: null, ...from };
    await new Promise((r) => setTimeout(r, 0));
    waiting.shift()!(c);
    await new Promise((r) => setTimeout(r, 0));
    return commands.at(-1);
  };
  const next = (from: any) => walkTo("nocturne.agent-next", from);
  const prev = (from: any) => walkTo("nocturne.agent-prev", from);
  expect(await next({ pane: "p1", terminal: "t1" })).toEqual(["pane.focus", { pane: "p2" }]);
  expect(await next({ pane: "p2", terminal: null })).toEqual(["pane.focus", { pane: "p5" }]);
  expect(await next({ pane: "p5", terminal: "t5" })).toEqual(["agent.focus", { terminal: "t6" }]);
  expect(await next({ pane: "p6", terminal: "t6" })).toEqual(["agent.focus", { terminal: "t7" }]);
  expect(await next({ pane: "p7", terminal: "t7" })).toEqual(["agent.focus", { terminal: "t1" }]);
  expect(await prev({ pane: "p1", terminal: "t1" })).toEqual(["agent.focus", { terminal: "t7" }]);
  expect(await prev({ pane: "p7", terminal: "t7" })).toEqual(["agent.focus", { terminal: "t6" }]);
  expect(await prev({ pane: "p6", terminal: "t6" })).toEqual(["pane.focus", { pane: "p5" }]);
  expect(await prev({ pane: "p5", terminal: "t5" })).toEqual(["pane.focus", { pane: "p2" }]);
  expect(await prev({ pane: "p2", terminal: null })).toEqual(["agent.focus", { terminal: "t1" }]);
});

test("the sidebar's keyboard walks the jar's agents, its shelf, then the meadow: open and folded", () => {
  jarAndMeadow();
  const s = new Sky();
  s.init({ role: "sky" }, cx);
  focusedNow = { ...focusedNow, block: "sidebar" };
  for (const folded of [false, true]) {
    s.want = folded;
    s.render(cx);
    s.takeKeys();
    s.render(cx);
    const ids = s.navList.map((x: any) => x.id).filter((id: string) => /^(fly|pin):/.test(id));
    expect([folded, ids]).toEqual([folded, ["fly:t1", "pin:pane:p2", "pin:t5", "fly:t6", "fly:t7"]]);
    // j from the jar's last agent goes down onto the shelf, not past it.
    s.cursor = "fly:t1";
    cx.stopped = false;
    s.key({ key: "j", key_char: "j", modifiers: { control: false, platform: false, alt: false, shift: false } }, cx);
    expect(s.cursor).toBe("pin:pane:p2");
  }
});
