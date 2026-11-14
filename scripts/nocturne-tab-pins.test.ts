// Whole tabs: pinned to the jar's shelf as one tile (pins.ts TABS_KEY, kit.ts
// pinTab, goToPin, the walk), and moved to another space (tab.move {space}:
// the tab menu's "Move to space…", the strip's s, the palette), with herdr and
// gpui stand-ins (mock.module is process-wide: this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";

// ---- stand-ins

let sharedState: Record<string, unknown> = {};
let spacesNow: any[] = [];
let panesNow: any[] = [];
let agentsNow: any[] = [];
let focusedNow: any = null;
let propsNow: any = null;
let commands: [string, any][] = [];
let labels: string[][] = [];
let timers: Function[] = [];
let overlays: any[] = [];
let closed: any[] = [];
let queue: string[] = [];
let waiting: ((v: string) => void)[] = [];

const LAYOUT = {
  id: "root", type: "row", children: [
    { id: "sidebar", type: "block", content: { mod: "nocturne", props: { role: "sky" } } },
    { id: "work", type: "column", children: [
      { id: "tab-row", type: "row", children: [
        { id: "tabs", type: "block", content: { mod: "nocturne", props: { role: "tabs" } } },
        { id: "notify", type: "block", content: { mod: "notifications", props: { role: "bell" } } },
      ] },
      { id: "main", type: "block", content: { tab: "active" } },
    ] },
  ],
};

const herdr: Record<string, any> = {
  agents: () => agentsNow, appHome: () => "/tmp/app", closeOverlay: (id: any) => { closed.push(id); },
  commands: () => [], exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => focusedNow,
  hc: async (args: string[]) => { labels.push(args); return { code: 0, stdout: "" }; }, home: () => "/home/a", keys: () => [], knownAgents: () => [],
  layout: () => LAYOUT, layouts: () => ["nocturne"],
  nextCommand: () => queue.length ? Promise.resolve(queue.shift()!) : new Promise<string>((r) => waiting.push(r)),
  notify: () => {}, openOverlay: (spec: any) => { overlays.push(spec); return `o${overlays.length}`; },
  panes: () => panesNow, pickFolder: async () => null, presentUpdateNotes: () => {}, props: () => propsNow,
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  setAgentOrder: () => {}, setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  settings: () => ({ zoom: 1 }), shared: (k: string) => sharedState[k] ?? null,
  spaces: () => spacesNow, terminals: () => [], theme: () => theme, updates: () => null,
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

const cx: any = {
  spawn: (f: Function) => { Promise.resolve().then(() => f(cx)).catch(() => {}); },
  notify() {}, stop_propagation() { cx.stopped = true; }, focus_handle: () => ({ focus() { cx.focusedHandle = true; }, is_focused: () => true }),
  new: () => ({ set_props() {} }), // the pointer's glow (glow.js), a nested view
  timer: { every() {}, after: (_ms: number, f: Function) => { timers.push(f); } },
};


/** A key event as GPUI sends it. */
function key(k: string, mods: Record<string, boolean> = {}, char?: string) {
  const typed = char ?? (k.length === 1 ? (mods.shift ? k.toUpperCase() : k) : null);
  return { key: k, key_char: typed, modifiers: { control: false, platform: false, alt: false, shift: false, ...mods } };
}

const nav = await import("../defaults/mods/nocturne/nav.ts");
const pins = await import("../defaults/mods/nocturne/pins.ts");
const kit = await import("../defaults/mods/nocturne/kit.ts");
const walk = await import("../defaults/mods/nocturne/walk.ts");
const tabmove = await import("../defaults/mods/nocturne/tabmove.ts");
const shelf = await import("../defaults/mods/nocturne/shelf.ts");
const { menuItems } = await import("../defaults/mods/nocturne/menu.ts");
const { pinActs } = await import("../defaults/mods/nocturne/sky-keys.ts");
const { openEntries } = await import("../defaults/mods/nocturne/palette-open.ts");
const { default: Sky } = await import("../defaults/mods/nocturne/sky.ts");
const { default: Tabs } = await import("../defaults/mods/nocturne/tabs.ts");

const tab = (id: string, index: number, more: any = {}) => ({ id, index, active: false, name: String(index), named: false, panes: 1, parked: 0, settled: false, status: null, ...more });

beforeEach(() => {
  sharedState = {}; commands = []; overlays = []; closed = []; queue = []; waiting = []; labels = []; timers = [];
  spacesNow = [
    { id: "s1", name: "api", active: true, machine: null, tabs: [tab("t1", 1, { active: true, named: true, name: "login fix", panes: 2, parked: 1 }), tab("t2", 2)] },
    { id: "s2", name: "pip", active: false, machine: null, tabs: [tab("t9", 1, { active: true })] },
    { id: "s3", name: "api-wt", active: false, machine: null, tabs: [tab("t8", 1, { active: true })] },
    { id: "s4", name: "box", active: false, machine: "box", tabs: [tab("box/t7", 1, { active: true })] },
  ];
  panesNow = [
    { pane: "p1", tab: "t1", terminal: "a/1", focused: true, cwd: "/home/a", status: "working", program: { key: "claude", agent: true, name: "Claude Code" } },
    { pane: "p2", tab: "t1", terminal: "a/2", focused: false, cwd: "/home/a", program: { key: "zsh", shell: true, name: "zsh" } },
    { pane: "p3", tab: "t1", terminal: "a/3", focused: false, parked: true, cwd: "/home/a" },
    { pane: "p4", tab: "t2", terminal: null, mod: "browser", props: { slot: "w1" }, focused: false, parked: false },
    { pane: "p9", tab: "t9", terminal: "a/9", focused: false, cwd: "/home/a", program: { key: "zsh", shell: true, name: "zsh" } },
  ];
  agentsNow = [];
  focusedNow = { space: "s1", tab: "t1", pane: "p1", terminal: "a/1", block: null };
});

const tabPins = () => (sharedState[pins.TABS_KEY] ?? []) as any[];
const shelfKeys = () => kit.jar().filter(pins.onShelf).map((x: any) => x.key);

// ---- the record and the jar (pins.ts)

test("a whole tab's pin: its own tile on the shelf in the order pinned, beside pane tiles; a tab that isn't there is no tile", () => {
  sharedState[pins.PANES_KEY] = [{ pane: "p4", mod: "browser", props: { slot: "w1" }, at: 2 }];
  kit.pinTab("t9", true);
  (tabPins()[0] as any).at = 3;
  sharedState[pins.TABS_KEY] = [{ tab: "t1", space: "s1", at: 1 }, ...tabPins(), { tab: "gone", space: "s1", at: 4 }];
  expect(shelfKeys()).toEqual(["tab:t1", "pane:p4", "tab:t9"]);
  const it: any = kit.jar().find((x: any) => x.key === "tab:t9");
  expect(it).toMatchObject({ kind: "tab", tabInfo: { id: "t9" }, space: { id: "s2" } });
  expect(pins.onShelf(it)).toBe(true);
  // Pinning records its space; unpinning takes only its own record.
  expect(tabPins().find((r: any) => r.tab === "t9")).toEqual({ tab: "t9", space: "s2", at: 3 });
  kit.pinTab("t9", false);
  expect(tabPins().map((r: any) => r.tab)).toEqual(["t1", "gone"]);
  // A tab that isn't there can't be pinned.
  kit.pinTab("nope", true);
  expect(tabPins().map((r: any) => r.tab)).toEqual(["t1", "gone"]);
  // A pane of a pinned tab pinned on its own as well: two tiles.
  sharedState[pins.PANES_KEY] = [{ pane: "p4", mod: "browser", props: { slot: "w1" }, at: 2 }];
  sharedState[pins.TABS_KEY] = [{ tab: "t2", space: "s1", at: 1 }];
  expect(shelfKeys()).toEqual(["tab:t2", "pane:p4"]);
});

test("tidyTabs: a tab moved to another space keeps its pin and notes the space; a closed one goes after GONE_AFTER; nothing goes while spaces are away", () => {
  const missing = new Map<string, number>();
  const recs = [{ tab: "t1", space: "s2", at: 1 }, { tab: "gone", space: "s1", at: 2 }, { tab: "box/t6", space: "s4", at: 3 }];
  // t1 is in s1 now: its space is noted. "gone" starts its clock; box/t6's machine shows tabs, so it counts too.
  expect(pins.tidyTabs(recs, spacesNow, missing, 1000)).toEqual([{ tab: "t1", space: "s1", at: 1 }, recs[1], recs[2]]);
  expect(pins.tidyTabs(recs.slice(0, 2).map((r, i) => (i ? r : { ...r, space: "s1" })), spacesNow, missing, 1000 + pins.GONE_AFTER)).toEqual([{ tab: "t1", space: "s1", at: 1 }]);
  // spaces() empty (a window loading) or a machine away: left alone.
  expect(pins.tidyTabs(recs, [], new Map(), 0)).toBeNull();
  const away = spacesNow.filter((s: any) => s.machine !== "box");
  expect(pins.tidyTabs([{ tab: "box/t6", space: "s4", at: 3 }], away, new Map(), 0)).toBeNull();
  // Nothing changed: null.
  expect(pins.tidyTabs([{ tab: "t1", space: "s1", at: 1 }], spacesNow, new Map(), 0)).toBeNull();
});

test("the sidebar tidies the tabs' pins as it draws: a tab now in another space keeps its tile", () => {
  sharedState[pins.TABS_KEY] = [{ tab: "t9", space: "s1", at: 1 }];
  const s = new Sky();
  s.init({ role: "sky" }, cx);
  s.render(cx);
  for (const f of timers.splice(0)) f(cx);
  expect(tabPins()).toEqual([{ tab: "t9", space: "s2", at: 1 }]);
});

test("moving a tab's tile: past tiles of any kind (left / right), its time stored, no terminal label for it", () => {
  sharedState[pins.PANES_KEY] = [{ pane: "p4", mod: "browser", props: { slot: "w1" }, at: 2 }];
  sharedState[pins.TABS_KEY] = [{ tab: "t1", space: "s1", at: 1 }];
  kit.movePin("tab:t1", 1);
  expect(shelfKeys()).toEqual(["pane:p4", "tab:t1"]);
  expect(labels).toEqual([]);
  kit.movePin("tab:t1", -1);
  expect(shelfKeys()).toEqual(["tab:t1", "pane:p4"]);
});

// ---- going there, the tile's words and look (kit.ts goToPin, shelf.ts)

test("a tab's tile goes to the tab (tab.select: its space too, a settled one back), and says what it is", () => {
  sharedState[pins.TABS_KEY] = [{ tab: "t1", space: "s1", at: 1 }, { tab: "t9", space: "s2", at: 2 }];
  const [t1, t9]: any[] = kit.jar();
  kit.goToPin(t9);
  expect(commands.at(-1)).toEqual(["tab.select", { id: "t9" }]);
  // Its name: the one given, else its lead pane's; where: tab, its space, its panes (parked ones too).
  expect(shelf.pinName(t1)).toBe("login fix");
  expect(shelf.tabWhere(t1)).toBe("tab · api · 3 panes");
  expect(shelf.pinName(t9)).toBe("zsh");
  expect(shelf.tabWhere(t9)).toBe("tab · pip · 1 pane");
  spacesNow[1].tabs[0].settled = true;
  expect(shelf.tabWhere(kit.jar()[1] as any)).toBe("tab · pip · 1 pane · settled");
  // Lit when it's the shown tab; the corner ticks while the focus is in it.
  const s = new Sky();
  s.init({ role: "sky" }, cx);
  s.render(cx);
  expect(s.pinLit(t1)).toBe(true);
  expect(s.pinLit(t9)).toBe(false);
  expect(shelf.pinFocus(t1)).toBe(true);
  expect(shelf.pinFocus(t9)).toBe(false);
  // The tile's mark is its lead pane's (the agent's, as the strip marks the tab).
  expect(pins.tabLead("t1", panesNow)?.pane).toBe("p1");
  expect(pins.tabLead("t9", panesNow)?.pane).toBe("p9");
  expect(pins.tabLead("nope", panesNow)).toBeNull();
});

test("the sidebar's cursor on a tab's tile: enter shows the tab, m its tile's menu, p unpins, J K move it", () => {
  sharedState[pins.PANES_KEY] = [{ pane: "p4", mod: "browser", props: { slot: "w1" }, at: 2 }];
  sharedState[pins.TABS_KEY] = [{ tab: "t9", space: "s2", at: 1 }];
  const s = new Sky();
  s.init({ role: "sky" }, cx);
  focusedNow = { ...focusedNow, block: "sidebar" };
  s.render(cx);
  s.takeKeys();
  s.render(cx);
  expect(s.navList.map((x: any) => x.id)).toContain("pin:tab:t9");
  s.cursor = "pin:tab:t9";
  const press = (k: string, shift = false) => { s.key(key(k, { shift }), cx); s.render(cx); };
  press("enter");
  expect(commands.at(-1)).toEqual(["tab.select", { id: "t9" }]);
  press("m");
  expect(overlays.at(-1)).toMatchObject({ kind: "dialog", props: { tab: "jartab", target: { id: "t9" } } });
  press("j", true);
  expect(shelfKeys()).toEqual(["pane:p4", "tab:t9"]);
  press("p");
  expect(tabPins()).toEqual([]);
});

// ---- the walk (walk.ts): a tab's tile is a stop like any other

test("the walk stops at a tab's tile and goes on from it, though the focus is on an agent in that tab", () => {
  sharedState[pins.TABS_KEY] = [{ tab: "t9", space: "s2", at: 1 }, { tab: "t1", space: "s1", at: 2 }];
  sharedState[pins.PANES_KEY] = [{ pane: "p4", mod: "browser", props: { slot: "w1" }, at: 3 }];
  const stops = walk.walkStops([], kit.jar().filter(pins.onShelf), ["a/1"]);
  expect(stops.map((x: any) => x.key)).toEqual(["tab:t9", "tab:t1", "pane:p4", "a/1"]);
  // In t1 on its agent, having walked to t1's tile: the walk stands on the tile, so next is the web tile.
  const f = { pane: "p1", terminal: "a/1", shown: null, tab: "t1" };
  expect(walk.walkAt(stops, f, "tab:t1")).toBe(1);
  // Walked to the agent itself: it stands on the agent.
  expect(walk.walkAt(stops, f, "a/1")).toBe(3);
  // Nothing else holds the focus: the tab's tile does.
  expect(walk.walkAt(stops, { pane: "p9", terminal: "a/9", shown: null, tab: "t9" }, null)).toBe(0);
});

// ---- moving a tab to another space (tabmove.ts, the menus)

test("where a tab can move: its machine's other spaces in the sidebar's order, worktrees indented; its last tab closes its space", () => {
  const rows = [{ id: "s1", depth: 0 }, { id: "s3", depth: 1 }, { id: "s2", depth: 0 }];
  const m = tabmove.tabMove("t1", spacesNow, rows)!;
  expect(m.from.id).toBe("s1");
  expect(m.to.map((x: any) => [x.space.id, x.depth])).toEqual([["s3", 1], ["s2", 0]]);
  expect(m.last).toBe(false);
  // No sidebar rows yet: Fireflies' order. A space's last tab says so.
  const m9 = tabmove.tabMove("t9", spacesNow)!;
  expect(m9.to.map((x: any) => x.space.id)).toEqual(["s1", "s3"]);
  expect(m9.last).toBe(true);
  // A remote space's tab: only its machine's spaces (none here).
  expect(tabmove.tabMove("box/t7", spacesNow)!.to).toEqual([]);
  expect(tabmove.tabMove("nope", spacesNow)).toBeNull();
  // The sidebar publishes its rows: spaces only, headers left out.
  expect(tabmove.spaceRowsOf([{ s: spacesNow[0], depth: 0 }, { header: "repo", key: "k" }, { s: spacesNow[2], depth: 1 }] as any)).toEqual([{ id: "s1", depth: 0 }, { id: "s3", depth: 1 }]);
});

const ids = (rows: any[]) => rows.filter((r) => "id" in r).map((r) => r.id);

test("the tab menu: pin the tab whole, Move to space… (a level of spaces, 1-9 keyed), close; pinned: unpin and move its tile", () => {
  sharedState[tabmove.SPACE_ROWS] = [{ id: "s1", depth: 0 }, { id: "s3", depth: 1 }, { id: "s2", depth: 0 }];
  const menu = () => menuItems(theme, { tab: "tab", target: { id: "t1", space: "s1" } });
  expect(ids(menu())).toEqual(["rename", "new", "pin-tab", "to-space", "close"]);
  menu().find((r: any) => r.id === "pin-tab").go();
  expect(tabPins().map((r: any) => r.tab)).toEqual(["t1"]);
  expect(ids(menu())).toEqual(["rename", "new", "unpin-tab", "to-space", "close"]);
  sharedState[pins.TABS_KEY] = [{ tab: "t1", space: "s1", at: 1 }, { tab: "t9", space: "s2", at: 2 }];
  expect(ids(menu())).toEqual(["rename", "new", "unpin-tab", "pin-down", "to-space", "close"]);
  const level = menu().find((r: any) => r.id === "to-space").sub();
  expect(level.map((r: any) => [r.id, r.name, r.key])).toEqual([["to-space-s3", "  api-wt", "1"], ["to-space-s2", "pip", "2"]]);
  level[1].go();
  expect(commands.at(-1)).toEqual(["tab.move", { id: "t1", space: "s2" }]);
  // A space's last tab: the level says its space closes.
  const last = menuItems(theme, { tab: "tab", target: { id: "t9", space: "s2" } }).find((r: any) => r.id === "to-space").sub();
  expect(last[0]).toEqual({ note: "pip closes: this is its last tab" });
  // No other space on its machine: no row.
  expect(ids(menuItems(theme, { tab: "tab", target: { id: "box/t7", space: "s4" } }))).toEqual(["rename", "new", "pin-tab", "close"]);
});

test("a tab's tile's own menu: show, unpin, move left / right, move to a space, close (the app asks)", () => {
  sharedState[pins.PANES_KEY] = [{ pane: "p4", mod: "browser", props: { slot: "w1" }, at: 1 }];
  sharedState[pins.TABS_KEY] = [{ tab: "t9", space: "s2", at: 2 }];
  const menu = () => menuItems(theme, { tab: "jartab", target: { id: "t9" } });
  expect(ids(menu())).toEqual(["show", "unpin-tab", "pin-up", "to-space", "close"]);
  menu().find((r: any) => r.id === "show").go();
  expect(commands.at(-1)).toEqual(["tab.select", { id: "t9" }]);
  menu().find((r: any) => r.id === "close").go();
  expect(commands.at(-1)).toEqual(["tab.close", { id: "t9" }]);
  menu().find((r: any) => r.id === "pin-up").go();
  expect(shelfKeys()).toEqual(["tab:t9", "pane:p4"]);
  menu().find((r: any) => r.id === "unpin-tab").go();
  expect(tabPins()).toEqual([]);
  // The spaces alone (the strip's s, the palette, nocturne.tab-to-space), named for the tab.
  const alone = menuItems(theme, { tab: "tospace", target: { id: "t1" } });
  expect(alone[0]).toEqual({ section: "Move login fix to" });
  expect(ids(alone)).toEqual(["to-space-s2", "to-space-s3"]);
});

test("the tab strip's keys: p pins the ringed tab whole (again: unpins), s opens the spaces to move it to", () => {
  expect(nav.keyVerb(key("p"), nav.STRIP_KEYS)).toBe("pin");
  expect(nav.keyVerb(key("s"), nav.STRIP_KEYS)).toBe("to-space");
  const s = new Tabs();
  s.init({ role: "tabs" }, cx);
  focusedNow = { ...focusedNow, block: "tabs" };
  s.render(cx);
  s.takeKeys();
  s.render(cx);
  expect(s.cursor).toBe("tab:t1");
  const press = (k: string) => { s.key(key(k), cx); s.render(cx); };
  press("p");
  expect(tabPins().map((r: any) => r.tab)).toEqual(["t1"]);
  press("p");
  expect(tabPins()).toEqual([]);
  press("s");
  expect(overlays.at(-1)).toMatchObject({ kind: "dialog", props: { tab: "tospace", target: { id: "t1" } } });
});

test("nocturne.pin-tab and nocturne.tab-to-space act on the shown tab; the palette offers both", async () => {
  const s = new Sky();
  s.init({ role: "sky" }, cx);
  s.render(cx);
  const send = async (c: string) => {
    await new Promise((r) => setTimeout(r, 0));
    waiting.shift()!(c);
    await new Promise((r) => setTimeout(r, 0));
  };
  await send("nocturne.pin-tab");
  expect(tabPins().map((r: any) => r.tab)).toEqual(["t1"]);
  await send("nocturne.tab-to-space");
  expect(overlays.at(-1)).toMatchObject({ kind: "dialog", props: { tab: "tospace", target: { id: "t1" } } });
  const rows = openEntries().filter((e: any) => e.group === "Tab");
  expect(rows.map((e: any) => [e.name, e.title])).toEqual([["nocturne.pin-tab", "Unpin this tab from the jar"], ["nocturne.tab-to-space", "Move tab to space…"]]);
  rows[0].go();
  expect(tabPins()).toEqual([]);
  // A tab with nowhere to go: no move row.
  focusedNow = { ...focusedNow, space: "s4", tab: "box/t7" };
  expect(openEntries().filter((e: any) => e.group === "Tab").map((e: any) => e.name)).toEqual(["nocturne.pin-tab"]);
});
