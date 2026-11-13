// The process deck in a normal pane (docs/mods-in-panes.md, defaults/mods/procs/place.ts):
// Developer: "so should git, github and so on too" (window mods openable in
// panes). Drawn as a pane (no frame, the ⧉), esc leaves a pane open and q
// closes its own, nothing else closes it, its height and narrow widths from
// the pane, moved window → pane → window with the handover, commands to the
// copy that acts, a restart's slot bringing back what it showed. herdr and
// gpui stand-ins as in procs-deck.test.ts (mock.module is process-wide: this
// file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";
import { COMM, PS, LSOF, TERMS, PANES, SPACES, SYS } from "./fixtures/procs.ts";

class El {
  kids: any[] = [];
  on: Record<string, Function> = {};
  text: string[] = [];
  css: Record<string, any[]> = {};
  constructor(public tag?: string) {
    return new Proxy(this, {
      get: (t, k: string, proxy) => k in t ? (t as any)[k] : k === "then" ? undefined : (...a: any[]) => {
        if (k === "id") ids[a[0]] = proxy;
        else if (k === "child") { t.kids.push(a[0]); if (typeof a[0] === "string") t.text.push(a[0]); }
        else if (k === "children") t.kids.push(...a[0]);
        else if (k === "when") { if (a[0]) a[1](proxy); }
        else if (k === "map") return a[0](proxy);
        else if (k === "on_mouse_down") t.on[`down:${a[0]}`] = a[1];
        else if (k === "on_mouse_up") t.on[`up:${a[0]}`] = a[1];
        else if (k === "on_click") t.on.click = a[0];
        else if (k.startsWith("on_")) t.on[k.slice(3)] = a.at(-1);
        else t.css[k] = a;
        return proxy;
      },
    });
  }
}
let ids: Record<string, any> = {};
/** Every string drawn under an element, in order. */
const words = (el: any): string[] => !el || typeof el !== "object" ? (typeof el === "string" ? [el] : []) : el.kids.flatMap(words);

let shared: Record<string, any> = {};
let overlays: any[] = [];
let closed: string[] = [];
let ran: any[] = [];
let calls: string[][] = [];
let propsNow: any = {};
let probeText = "";
let sysText = SYS;
// A system reading waits on this (a slow source) when set.
let sysGate: Promise<void> | null = null;
let focusedNow: any = { tab: "tB", pane: "p2", terminal: "t7" };
let alive = new Set<number>();
let stubborn = new Set<number>();
let clip: string[] = [];
let timers: { ms: number; f: Function }[] = [];
let dbInstalled = false;
// The procs pane p9 (slot s9) beside the fixtures' panes; its focus is the test's.
let panesNow: any[] = [];
const PANE = { pane: "p9", tab: "tB", terminal: null, mod: "procs", props: { slot: "s9" }, focused: false };
// localStorage, as the app gives a mod (per mod and props: per slot); one store here, cleared per test.
const kept = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v); } };
const SEP = "@@procs@@";
const probe = (ps = PS, lsof = LSOF) => `dev\n${SEP}\n${COMM}${SEP}\n${ps}${SEP}\n${lsof}`;

const herdr: Record<string, any> = {
  closeOverlay: (id: string) => { closed.push(id); },
  exec: async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (cmd === "sh" && args[1].includes("nocturne-sys")) await sysGate;
    // The refresh's probe asks, last, whether the Databases mod is installed.
    if (cmd === "sh") return { code: 0, stdout: args[1].includes("nocturne-sys") ? sysText : probeText + (dbInstalled && args[1].includes("'/home/dev/.config/herdr-app/mods/databases/mod.json'") ? `${SEP}\ndatabases\n` : ""), stderr: "" };
    if (cmd === "kill") {
      const sig = args[0];
      for (const p of args.slice(1).map(Number)) if (sig === "-KILL" || !stubborn.has(p)) alive.delete(p);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd === "lsof") return { code: 0, stdout: `p${args[2]}\nfcwd\nn/w/from-lsof/${args[2]}\n`, stderr: "" };
    if (cmd === "ps") {
      const out = args.at(-1)!.split(",").map(Number).filter((p) => alive.has(p)).map((p) => `${p} S`).join("\n");
      return { code: out ? 0 : 1, stdout: out, stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "" };
  },
  focused: () => focusedNow,
  home: () => "/home/dev",
  appHome: () => "/home/dev/.config/herdr-app",
  appHome: () => "/home/dev/.config/herdr-app",
  hc: async () => ({ code: 1, stdout: "" }),
  agents: () => [],
  nextCommand: () => new Promise(() => {}),
  notify: () => {},
  openOverlay: (spec: any) => { const id = `o${overlays.length + 1}`; overlays.push({ ...spec, id }); return id; },
  panes: () => panesNow,
  props: () => propsNow,
  run: (...a: any[]) => { ran.push(a); return null; },
  settings: () => ({ zoom: 0.9 }),
  setShared: (k: string, v: any) => { shared[k] = v; },
  shared: (k: string) => shared[k] ?? null,
  spaces: () => SPACES,
  terminals: () => TERMS,
  theme: () => theme,
  window: () => ({ platform: "macos" }),
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: (p: string) => new El(`svg:${p}`), image: () => new El(), PathBuilder: { fill: () => path(), stroke: () => path() }, Background: { checkerboard: (c: string) => bg({ dither: c }), solid: (c: string) => bg({ solid: c }) } }));
function bg(b: any) { b.opacity = (o: number) => ({ ...b, opacity: o }); return b; }
mock.module("gpui-base", () => ({ h_flex: () => new El(), v_flex: () => new El() }));
/** A path that counts its polygons (a graph's bars are one path a layer). */
const path = () => { const p: any = { polys: [] as any[], ops: [] as any[] }; p.add_polygon = (pts: any) => { p.polys.push(pts); return p; }; for (const k of ["move_to", "line_to", "close", "dash_array"]) p[k] = (...a: any[]) => { p.ops.push([k, ...a]); return p; }; p.build = () => p; return p; };
(globalThis as any).window = { paint_path: (p: any, fill: any) => { const e: any = new El("dither"); e.path = p; e.fill = fill; return e; } };
/** A graph's bars: the polygons of its dithered layer (the first under its baseline). */
const barsOf = (id: string) => ids[id].kids.filter((k: any) => k?.tag === "dither" && k.fill?.dither).flatMap((k: any) => k.path.polys);
const theme: any = new Proxy({}, { get: (_t, k) => String(k) });
const cx: any = {
  spawn: (f: Function) => { Promise.resolve().then(() => f(cx)).catch((e) => { throw e; }); },
  notify() {}, stop_propagation() {}, bind_keys() {},
  focus_handle: () => ({ focus() {}, is_focused: () => true }),
  timer: { every() {}, after: (ms: number, f: Function) => { timers.push({ ms, f }); } },
  write_to_clipboard: (s: string) => { clip.push(s); },
};
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
/** Runs the timers waiting this long (the kill flow's grace). */
const elapse = async (ms: number) => { const due = timers.filter((x) => x.ms === ms); timers = timers.filter((x) => x.ms !== ms); for (const x of due) x.f(cx); await flush(); };

const procs = await import("../defaults/mods/nocturne/procs.ts");
const { default: Deck } = await import("../defaults/mods/procs/main.ts");
const { REFRESH, GRACE, ROW, PROW, LIST_H, PORTS_H } = await import("../defaults/mods/procs/state.ts");

beforeEach(() => {
  shared = {}; overlays = []; closed = []; ran = []; calls = []; ids = {}; clip = []; timers = [];
  propsNow = { overlay: "o1", tab: "procs" };
  probeText = probe();
  sysText = SYS;
  alive = new Set([50112, 50118, 50121, 52214, 52391, 41872]);
  stubborn = new Set();
  dbInstalled = false;
  panesNow = [...PANES, { ...PANE }];
  kept.clear();
});

const key = (k: string, extra: any = {}) => ({ key: k, key_char: extra.char ?? (k.length === 1 ? k : undefined), modifiers: { shift: false, control: false, alt: false, platform: false, ...(extra.mods ?? {}) } });
/** A deck as a pane (props { slot }) or a window (props { overlay }). */
async function deck(props: any = { slot: "s9" }) {
  propsNow = props;
  const d: any = new Deck();
  d.init({}, cx);
  await flush();
  return {
    d,
    draw: () => { ids = {}; return d.render(); },
    press: async (k: string, extra: any = {}) => { d.onKey(key(k, extra), cx); await flush(); },
    cur: () => { const items = d.list(); return items[d.at(items)]?.key; },
  };
}
const place = await import("../defaults/mods/procs/place.ts");

test("as a pane: no frame, the ⧉ to go out over the tab; as a window: its frame and the ◧", async () => {
  const pane = await deck();
  pane.draw();
  expect(ids["procs-deck"].css.border).toBeUndefined();
  expect(words(ids["procs-move"])).toEqual(["⧉"]);
  expect(ids["procs-move"].css.tooltip[0]).toBe("Out over the tab · ctrl-t");
  const win = await deck({ overlay: "o1", tab: "procs" });
  win.draw();
  expect(ids["procs-deck"].css.border).toEqual([1]);
  expect(words(ids["procs-move"])).toEqual(["◧"]);
});

test("in a pane esc never closes it, q closes its own pane; going to a terminal or opening a port leaves it open", async () => {
  const { press, d } = await deck();
  await press("escape");
  expect(closed).toEqual([]);
  expect(ran).toEqual([]);
  // Going to a terminal: the pane stays.
  while (d.list()[d.at(d.list())]?.key !== "p:52391") await press("j");
  await press("enter");
  expect(ran).toEqual([["pane.focus", { terminal: "t4" }]]);
  expect(closed).toEqual([]);
  ran = [];
  await press("q");
  expect(ran).toEqual([["pane.close", { pane: "p9" }]]);
  expect(closed).toEqual([]);
});

test("the pane's size: its lists take the pane's height; a narrow pane drops UP, then PID, before the names are cut", async () => {
  const { d, draw } = await deck();
  draw();
  const full = d.listH();
  // 300 layout px tall at zoom 0.9 (270 device px).
  ids["procs-deck"].on.size_change({ width: 432, height: 270 }, cx);
  expect(d.height).toBe(300);
  expect(d.listH()).toBe(full - (560 - 300));
  draw();
  expect(["h-cpu", "h-mem", "h-up", "h-pid"].filter((id) => ids[id])).toEqual(["h-cpu", "h-mem", "h-up", "h-pid"]);
  ids["vitals"].on.size_change({ width: 360 * 0.9, height: 60 }, cx);
  draw();
  expect(["h-cpu", "h-mem", "h-up", "h-pid"].filter((id) => ids[id])).toEqual(["h-cpu", "h-mem", "h-pid"]);
  ids["vitals"].on.size_change({ width: 300 * 0.9, height: 60 }, cx);
  draw();
  expect(["h-cpu", "h-mem", "h-up", "h-pid"].filter((id) => ids[id])).toEqual(["h-cpu", "h-mem"]);
  // The rows drop theirs alike: t4's shell (in sight in 300 px) shows cpu and memory, no uptime, no pid.
  const w = words(ids[`row-${d.rows().findIndex((r: any) => r.key === "p:1467")}`]);
  expect(w).toEqual(["zsh", "", "0.0", "3M"]);
  expect(w).not.toContain("1467");
  expect(w).not.toContain("1:12:04");
  // A window's height is the overlay's, whatever is measured.
  const win = await deck({ overlay: "o1" });
  win.draw();
  ids["procs-deck"].on.size_change({ width: 432, height: 270 }, cx);
  expect(win.d.deckH()).toBe(560);
});

test("window → pane: ctrl-t opens the pane beside the focused one with what it showed; the window steps aside 300 ms later", async () => {
  const win = await deck({ overlay: "o1", tab: "procs" });
  await win.press("2");
  await win.press("j");
  win.d.query = "node";
  const port = win.cur();
  await win.press("t", { mods: { control: true } });
  expect(ran).toEqual([["pane.split", { direction: "auto", pane: "p2", mod: "procs", props: { slot: expect.any(String), tab: "ports" } }]]);
  expect(closed).toEqual([]);
  await elapse(300);
  expect(closed).toEqual(["o1"]);
  // The new pane takes the note: the ports tab, its cursor, the find.
  const pane = await deck({ slot: ran[0][1].props.slot, tab: "ports" });
  expect(pane.d.tab).toBe("ports");
  expect(pane.d.query).toBe("node");
  expect(pane.d.cur.ports.key).toBe(port);
  expect(shared["procs.handover"]).toBe(null);
});

test("pane → window: ⧉ opens the deck centered over the tab with what it showed (an open one gives way); the pane closes 300 ms later", async () => {
  const pane = await deck();
  await pane.press("a");
  // An open window of the deck (its fresh note) gives way.
  shared["procs.deck"] = { id: "o7", tab: "procs", beat: Date.now() };
  pane.draw();
  ids["procs-move"].on.click({}, cx);
  expect(closed).toEqual(["o7"]);
  expect(overlays.at(-1)).toMatchObject({ mod: "procs", kind: "dialog", frame: "none", width: 480, height: 560, props: { tab: "procs" } });
  expect(shared["procs.deck"]).toMatchObject({ id: overlays.at(-1).id, tab: "procs" });
  await elapse(300);
  expect(ran).toEqual([["pane.close", { pane: "p9" }]]);
  const win = await deck({ overlay: overlays.at(-1).id, tab: "procs" });
  expect(win.d.all).toBe(true);
});

test("a stale note is no handover: older than 5 s it's left alone", async () => {
  shared["procs.handover"] = { at: Date.now() - 6000, shown: { tab: "ports", procs: null, ports: null, query: "x", all: true } };
  const { d } = await deck();
  expect(d.tab).toBe("procs");
  expect(d.query).toBe("");
});

test("two copies: the window acts on procs.<command> while open; else the pane with the keyboard; a pane without it leaves it", async () => {
  await deck();
  // No window, the pane not focused: it leaves it.
  expect(place.actsOnCommands()).toBe(false);
  panesNow = panesNow.map((p) => (p.pane === "p9" ? { ...p, focused: true } : p));
  expect(place.actsOnCommands()).toBe(true);
  // A window open: only it acts.
  shared["procs.deck"] = { id: "o3", tab: "procs", beat: Date.now() };
  expect(place.actsOnCommands()).toBe(false);
  propsNow = { overlay: "o3" };
  expect(place.actsOnCommands()).toBe(true);
  propsNow = { overlay: "o4" };
  expect(place.actsOnCommands()).toBe(false);
  // A pane doesn't write the window's note (the tree mark stays dark for it).
  shared["procs.deck"] = null;
  const pane = await deck();
  pane.d.beat();
  expect(shared["procs.deck"]).toBe(null);
});

test("a restart: the pane's slot brings back its tab, cursors, find and scope from its localStorage", async () => {
  const first = await deck();
  await first.press("a");
  await first.press("2");
  await first.press("j");
  const port = first.cur();
  first.d.close();
  expect(JSON.parse(kept.get("shown")!)).toMatchObject({ tab: "ports", all: true, ports: port });
  const again = await deck();
  expect(again.d.tab).toBe("ports");
  expect(again.d.all).toBe(true);
  expect(again.cur()).toBe(port);
});

test("mod.json: the deck is focusable, so pane.go reaches it", async () => {
  const json = JSON.parse(await Bun.file(new URL("../defaults/mods/procs/mod.json", import.meta.url)).text());
  expect(json.focusable).toBe(true);
});
