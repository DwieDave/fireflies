// The tab strip's drop-downs toggle: the script runner's ▶, "+ new" and the
// bell. A press on a lit button closes its view and it stays closed; the next
// press opens it again. The same through their keys' commands. The app's
// popup closes on any press beside it, and that press goes on to the button
// under it (src/window.rs, the popup's backdrop): the stand-in core below does
// the same, with the view's own close hook running before the button sees the
// press, or only after the click. herdr and gpui stand-ins that record each
// element's handlers by id (mock.module is process-wide: this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";

// ---- stand-ins

class El {
  kids: any[] = [];
  on: Record<string, Function> = {};
  elId: string | null = null;
  constructor(public tag?: string) {
    return new Proxy(this, {
      get: (t, k: string, proxy) => k in t ? (t as any)[k] : k === "then" ? undefined : (...a: any[]) => {
        if (k === "id") { t.elId = a[0]; ids[a[0]] = proxy; }
        else if (k === "child") t.kids.push(a[0]);
        else if (k === "children") t.kids.push(...a[0]);
        else if (k === "when") { if (a[0]) a[1](proxy); }
        else if (k === "map") return a[0](proxy);
        else if (k === "on_mouse_down") t.on[`down:${a[0]}`] = a[1];
        else if (k === "on_click") t.on.click = a[0];
        return proxy;
      },
    });
  }
}
let ids: Record<string, any> = {};
/** Lit: the strip's open look, a dithered band among the button's own children. */
const lit = (id: string) => ids[id].kids.some((k: any) => k?.tag === "dither");

let sharedState: Record<string, unknown> = {};
let overlays: any[] = []; // every spec opened, in order, with its id
let open = new Set<string>(); // the overlays the stand-in core shows
let waiting: ((v: string) => void)[] = [];
let propsNow: any = null;
const LAYOUT = {
  id: "root", type: "row", children: [
    { id: "sidebar", type: "block", content: { mod: "nocturne", props: { role: "sky" } } },
    { id: "work", type: "column", children: [
      { id: "tab-row", type: "row", children: [
        { id: "tabs", type: "block", content: { mod: "nocturne", props: { role: "tabs" } } },
        { id: "notify", type: "block", size: { px: 28 }, content: { mod: "nocturne-notifications", props: { role: "bell" } } },
      ] },
      { id: "main", type: "block", content: { tab: "active" } },
    ] },
  ],
};
const herdr: Record<string, any> = {
  agents: () => [], appHome: () => "/tmp/app", closeOverlay: (id: string) => { open.delete(id); }, commands: () => [],
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => ({ space: "s1", tab: "t1", pane: "p1", terminal: "a/1" }),
  hc: async () => ({ code: 1, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: async () => [], layout: () => LAYOUT,
  layouts: () => ["nocturne"],
  // Every copy waiting for a command gets it (as every copy of a mod does).
  nextCommand: () => new Promise<string>((r) => waiting.push(r)),
  notify: () => {}, openOverlay: (spec: any) => { const id = `o${overlays.length + 1}`; overlays.push({ ...spec, id }); open.add(id); return id; },
  panes: () => [{ pane: "p1", tab: "t1", terminal: "a/1", focused: true, cwd: "/home/a" }], pickFolder: async () => null,
  presentUpdateNotes: () => {}, props: () => propsNow, run: (name: string) => { if (name.startsWith("nocturne-notifications.")) send(name); return null; },
  setAgentOrder: () => {}, setShared: (k: string, v: unknown) => { sharedState[k] = v; }, settings: () => ({ zoom: 0.9 }),
  shared: (k: string) => sharedState[k] ?? null,
  spaces: () => [{ id: "s1", name: "one", active: true, folder: "/home/a", tabs: [{ id: "t1", index: 1, active: true, name: "1" }] }],
  terminals: () => [], theme: () => theme, updates: () => null, window: () => ({ platform: "macos" }),
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: () => new El(), image: () => new El(), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} }
mock.module("gpui-base", () => ({
  h_flex: () => new El(), v_flex: () => new El(), v_virtual_list: () => new El(), Scrollbar: { new: () => new El() },
  InputState: { new: () => new Input() }, Input: { new: () => new El() },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) }, VirtualListScrollHandle: { new: () => ({}) },
}));
const VIEWPORT = { width: 1600, height: 1000 };
(globalThis as any).window = { paint_path: () => new El("dither"), viewport_size: () => VIEWPORT };
const theme: any = new Proxy({}, { get: () => "#808080" });
const cx: any = {
  spawn: (f: Function) => { Promise.resolve().then(() => f(cx)).catch(() => {}); }, notify() {}, stop_propagation() {},
  focus_handle: () => ({ focus() {}, is_focused: () => true }), timer: { every() {}, after() {} },
};
const tick = () => new Promise((r) => setTimeout(r, 0));
/** A command, to every copy waiting for one. */
function send(c: string) { const w = waiting; waiting = []; for (const f of w) f(c); }

const scripts = await import("../defaults/mods/nocturne/scripts.js");
const newmenu = await import("../defaults/mods/nocturne/newmenu.js");
const { default: NewMenu } = newmenu;
const { default: Tabs } = await import("../defaults/mods/nocturne/tabs.js");
const { default: Sky } = await import("../defaults/mods/nocturne/sky.js");
const { default: Deck } = await import("../defaults/mods/nocturne-scripts/main.js");
const { default: Bell } = await import("../defaults/mods/nocturne-notifications/bell.js");
const { default: Overview } = await import("../defaults/mods/nocturne-notifications/overview.js");
const notif = await import("../defaults/mods/nocturne-notifications/open.js");

// Each view's own close hook, as the app runs it once its overlay is gone.
const HOOKS: Record<string, (id: string) => void> = {
  "nocturne-scripts": (id) => { propsNow = { overlay: id }; (Object.create(Deck.prototype) as any).close(); },
  nocturne: (id) => { propsNow = { overlay: id }; (Object.create(NewMenu.prototype) as any).closing(); },
  "nocturne-notifications": (id) => { propsNow = { overlay: id }; (Object.create(Overview.prototype) as any).closing(); },
};
const hook = (id: string) => HOOKS[overlays.find((o) => o.id === id).mod](id);
const shown = () => overlays.filter((o) => open.has(o.id));

/** A press on a button, as the app delivers it: with a drop-down open, its
 *  backdrop closes it first (on the same mouse-down) and the press goes on to
 *  the button; the drop-down's close hook runs `early` (before the button's
 *  mouse-down) or late (after the click). */
function press(id: string, { early = true } = {}) {
  const before = shown().filter((o) => o.kind === "popup");
  for (const o of before) { open.delete(o.id); if (early) hook(o.id); }
  const node = ids[id];
  const e = { position: { x: 1500, y: 18 }, local_position: { x: 10, y: 6 }, bounds: { width: 40, height: 24 } };
  node.on["down:left"](e, cx);
  node.on.click({}, cx);
  if (!early) for (const o of before) hook(o.id);
}

beforeEach(() => { sharedState = {}; overlays = []; open = new Set(); waiting = []; ids = {}; propsNow = null; });

function strip() {
  const s: any = new Tabs();
  s.init({ role: "tabs" }, cx);
  return { draw: () => { ids = {}; s.render(cx); } };
}
function bell() {
  const b: any = new Bell();
  b.init({ role: "bell" }, cx);
  return { draw: () => { ids = {}; b.render(cx); } };
}

// ---- the script runner's ▶

for (const early of [true, false]) {
  test(`▶: press opens the deck under it, a second press closes it for good, a third opens it (close hook ${early ? "first" : "after the click"})`, () => {
    const s = strip();
    s.draw();
    expect(lit("tab-scripts-run")).toBe(false);
    press("tab-scripts-run", { early });
    expect(shown()).toHaveLength(1);
    expect(shown()[0]).toMatchObject({ mod: "nocturne-scripts", kind: "popup", width: scripts.DECK_W });
    expect(shown()[0].at).toBeTruthy();
    s.draw();
    expect(lit("tab-scripts-run")).toBe(true);
    press("tab-scripts-run", { early });
    expect(shown()).toHaveLength(0);
    expect(scripts.deckOpen()).toBeNull();
    s.draw();
    expect(lit("tab-scripts-run")).toBe(false);
    press("tab-scripts-run", { early });
    expect(shown()).toHaveLength(1);
    expect(overlays).toHaveLength(2);
  });
}

test("▶ by key (nocturne.scripts, cmd-shift-r): opens the deck, closes it, opens it", async () => {
  const sky: any = new Sky();
  sky.init({ role: "sky" }, cx);
  await tick();
  for (const n of [1, 0, 1]) {
    send("nocturne.scripts");
    await tick();
    expect(shown()).toHaveLength(n);
  }
  expect(overlays.map((o) => o.kind)).toEqual(["dialog", "dialog"]);
});

test("▶: a run to show, or the last run again, opens the deck even when it's open (the palette's calls)", () => {
  scripts.toggleDeck({ centered: true });
  scripts.toggleDeck({ centered: true, again: true });
  expect(shown()).toHaveLength(1);
  expect(shown()[0].props).toMatchObject({ again: true });
  scripts.toggleDeck({ centered: true, focus: "runs", show: "a/9" });
  expect(shown()).toHaveLength(1);
  expect(shown()[0].props).toMatchObject({ show: "a/9", focus: "runs" });
  scripts.toggleDeck({ centered: true });
  expect(shown()).toHaveLength(0);
});

test("the deck lets cmd-shift-r through (it closes the deck), cmd-r on a run still runs it again", () => {
  const d: any = Object.create(Deck.prototype);
  let again = 0;
  d.act = (what: string) => { if (what === "again") again++; };
  d.cursor = 0;
  let stopped = false;
  const kx: any = { stop_propagation() { stopped = true; }, notify() {} };
  const items = [{ kind: "run", r: { live: false } }];
  d.onKey({ key: "r", key_char: "R", modifiers: { platform: true, shift: true, control: false, alt: false } }, kx, items);
  expect(again).toBe(0);
  expect(stopped).toBe(false);
  d.onKey({ key: "r", key_char: "r", modifiers: { platform: true, shift: false, control: false, alt: false } }, kx, items);
  expect(again).toBe(1);
});

// ---- + new

for (const early of [true, false]) {
  test(`+ new: press opens the menu under it, a second press closes it for good, a third opens it (close hook ${early ? "first" : "after the click"})`, () => {
    const s = strip();
    s.draw();
    expect(lit("tab-new")).toBe(false);
    press("tab-new", { early });
    expect(shown()).toHaveLength(1);
    expect(shown()[0]).toMatchObject({ mod: "nocturne", kind: "popup", props: { role: "new" } });
    s.draw();
    expect(lit("tab-new")).toBe(true);
    press("tab-new", { early });
    expect(shown()).toHaveLength(0);
    expect(newmenu.newMenuOpen()).toBe(false);
    s.draw();
    expect(lit("tab-new")).toBe(false);
    press("tab-new", { early });
    expect(shown()).toHaveLength(1);
  });
}

test("+ new by key (nocturne.new, cmd-n): opens the menu, closes it, opens it", async () => {
  const sky: any = new Sky();
  sky.init({ role: "sky" }, cx);
  await tick();
  for (const n of [1, 0, 1]) {
    send("nocturne.new");
    await tick();
    expect(shown()).toHaveLength(n);
  }
});

// ---- the bell

test("bell, before any press on it: a key hangs the center END (8 px) in from the window's right, on the strip's horizon", () => {
  const b = bell();
  b.draw();
  notif.toggleOverview();
  const o = shown()[0];
  expect(o).toMatchObject({ kind: "popup", props: { role: "overview" } });
  expect(o.at.x).toBe(Math.round(1600 - 8 * 0.9 - o.width * 0.9));
  expect(o.at.y).toBe(Math.round(36 * 0.9));
});

for (const early of [true, false]) {
  test(`bell: press opens the notification center under it, a second press closes it for good, a third opens it (close hook ${early ? "first" : "after the click"})`, () => {
    const b = bell();
    b.draw();
    expect(lit("bell")).toBe(false);
    press("bell", { early });
    expect(shown()).toHaveLength(1);
    expect(shown()[0]).toMatchObject({ mod: "nocturne-notifications", kind: "popup", props: { role: "overview" } });
    b.draw();
    expect(lit("bell")).toBe(true);
    press("bell", { early });
    expect(shown()).toHaveLength(0);
    expect(notif.overviewOpen()).toBeNull();
    b.draw();
    expect(lit("bell")).toBe(false);
    press("bell", { early });
    expect(shown()).toHaveLength(1);
  });
}

test("bell: the drop-down's top is on the strip's horizon and its right edge on the bell's, sized to the window", () => {
  const b = bell();
  b.draw();
  press("bell");
  const z = 0.9;
  const o = shown()[0];
  // The bell's press: its left at 1490, 40 wide; its top at 12, 24 tall.
  expect(o.at.y).toBe(Math.round(12 + 24 + 6 * z));
  expect(o.at.x).toBe(Math.round(1530 - o.width * z));
  expect(o.width).toBe(notif.OVERVIEW_W);
  expect(o.height).toBeLessThanOrEqual(notif.OVERVIEW_H);
  // A small window: narrower, and no taller than what's left below the strip.
  VIEWPORT.width = 700; VIEWPORT.height = 400;
  try {
    b.draw();
    const s = notif.overviewPlace();
    expect(s.width * z).toBeLessThanOrEqual(700 - 16);
    expect(s.at.y + s.height * z).toBeLessThanOrEqual(400 - 8 + 1);
    expect(s.at.x).toBeGreaterThanOrEqual(8);
  } finally { VIEWPORT.width = 1600; VIEWPORT.height = 1000; }
});

test("bell by key (nocturne-notifications.open, cmd-shift-a; the strip's enter): opens under the bell, closes, opens", async () => {
  const b = bell();
  b.draw();
  await tick();
  for (const n of [1, 0, 1]) {
    send("nocturne-notifications.open");
    await tick();
    expect(shown()).toHaveLength(n);
  }
  expect(overlays.every((o) => o.kind === "popup" && o.props.role === "overview")).toBe(true);
  // Where the last press on the bell found it (its right edge at 1530, its top at 12).
  expect(overlays[0].at.x).toBe(Math.round(1530 - overlays[0].width * 0.9));
  expect(overlays[0].at.y).toBe(Math.round(12 + 24 + 6 * 0.9));
});

test("the strip's keyboard walk: enter on the bell toggles the notification center", async () => {
  const s: any = new Tabs();
  s.init({ role: "tabs" }, cx);
  const b = bell();
  b.draw();
  await tick();
  s.render(cx);
  for (const n of [1, 0, 1]) {
    s.rows.tabs.find((x: any) => x.id === "bell").go();
    await tick();
    expect(shown()).toHaveLength(n);
  }
});

test("bell: a toast's request opens the center on its terminal, and retargets an open one; the key toggles after", async () => {
  const b = bell();
  b.draw();
  await tick();
  sharedState["nocturne-notifications.open"] = { terminal: "m/3", at: Date.now() };
  send("nocturne-notifications.open");
  await tick();
  expect(shown()).toHaveLength(1);
  expect(shown()[0]).toMatchObject({ kind: "popup", props: { role: "overview", terminal: "m/3" } });
  sharedState["nocturne-notifications.open"] = { terminal: "m/4", at: Date.now() + 1 };
  send("nocturne-notifications.open");
  await tick();
  expect(shown()).toHaveLength(1);
  expect(shown()[0].props.terminal).toBe("m/4");
  // The same request isn't taken twice: the key now closes it.
  send("nocturne-notifications.open");
  await tick();
  expect(shown()).toHaveLength(0);
});

test("the question dialog still opens centered, from the drop-down too", () => {
  notif.toggleOverview();
  expect(shown()[0].kind).toBe("popup");
  notif.openAsk({ address: "m/1", request: { questions: [{ question: "Which?", options: [{ label: "a" }, { label: "b" }] }] } });
  expect(shown()).toHaveLength(1);
  expect(shown()[0]).toMatchObject({ kind: "dialog", width: 520, props: { role: "ask", terminal: "m/1" } });
  expect(notif.overviewOpen()).toBeNull();
});

test("a note of an open center left by a restart doesn't swallow a press", () => {
  sharedState["nocturne-notifications.shown"] = { overview: "gone", beat: Date.now() - 60000 };
  notif.toggleOverview();
  expect(shown()).toHaveLength(1);
});
