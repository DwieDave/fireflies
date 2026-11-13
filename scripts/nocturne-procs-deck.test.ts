// The processes and ports manager as Developer drives it: the strip's tree
// mark and nocturne.procs / nocturne.ports open and close the deck
// (defaults/mods/nocturne/procs.js); the deck's every key, its cursor across
// refreshes, the kill flow (ask, TERM, still there, KILL) and the port
// actions, against a fake exec that never signals a real process. herdr and
// gpui stand-ins (mock.module is process-wide: this file runs alone).
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
const SEP = "@@nocturne-procs@@";
const probe = (ps = PS, lsof = LSOF) => `dev\n${SEP}\n${COMM}${SEP}\n${ps}${SEP}\n${lsof}`;

const herdr: Record<string, any> = {
  closeOverlay: (id: string) => { closed.push(id); },
  exec: async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (cmd === "sh" && args[1].includes("nocturne-sys")) await sysGate;
    if (cmd === "sh") return { code: 0, stdout: args[1].includes("nocturne-sys") ? sysText : probeText, stderr: "" };
    if (cmd === "kill") {
      const sig = args[0];
      for (const p of args.slice(1).map(Number)) if (sig === "-KILL" || !stubborn.has(p)) alive.delete(p);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd === "ps") {
      const out = args.at(-1)!.split(",").map(Number).filter((p) => alive.has(p)).map((p) => `${p} S`).join("\n");
      return { code: out ? 0 : 1, stdout: out, stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "" };
  },
  focused: () => focusedNow,
  home: () => "/home/dev",
  hc: async () => ({ code: 1, stdout: "" }),
  agents: () => [],
  nextCommand: () => new Promise(() => {}),
  notify: () => {},
  openOverlay: (spec: any) => { const id = `o${overlays.length + 1}`; overlays.push({ ...spec, id }); return id; },
  panes: () => PANES,
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
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: (p: string) => new El(`svg:${p}`), image: () => new El(), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
mock.module("gpui-base", () => ({ h_flex: () => new El(), v_flex: () => new El() }));
(globalThis as any).window = { paint_path: () => new El("dither") };
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

const procs = await import("../defaults/mods/nocturne/procs.js");
const { default: Deck, REFRESH, GRACE, ROW, PROW, LIST_H, PORTS_H } = await import("../defaults/mods/nocturne-procs/main.js");

beforeEach(() => {
  shared = {}; overlays = []; closed = []; ran = []; calls = []; ids = {}; clip = []; timers = [];
  propsNow = { overlay: "o1", tab: "procs" };
  probeText = probe();
  sysText = SYS;
  alive = new Set([50112, 50118, 50121, 52214, 52391, 41872]);
  stubborn = new Set();
});

const key = (k: string, extra: any = {}) => ({ key: k, key_char: extra.char ?? (k.length === 1 ? k : undefined), modifiers: { shift: false, control: false, alt: false, platform: false, ...(extra.mods ?? {}) } });
async function deck(tab = "procs") {
  propsNow = { overlay: "o1", tab };
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

// ---- the strip and the commands

test("the tree mark: a press opens the deck under it, a press on the lit mark closes it and it stays closed", () => {
  const e = { position: { x: 1500, y: 18 }, local_position: { x: 10, y: 6 }, bounds: { width: 40, height: 24 } };
  procs.toggleProcs({ at: { x: 1, y: 2 } });
  expect(overlays[0]).toMatchObject({ mod: "nocturne-procs", kind: "popup", frame: "none", width: procs.DECK_W, height: procs.DECK_H, at: { x: 1, y: 2 }, props: { tab: "procs" } });
  expect(procs.procsOpen()).toBe("o1");
  procs.toggleProcs({ wasOpen: true });
  expect(closed).toEqual(["o1"]);
  expect(procs.procsOpen()).toBe(null);
  // The app closed the popup on the press already: the click finds nothing open and leaves it so.
  procs.toggleProcs({ wasOpen: true });
  expect(overlays.length).toBe(1);
  void e;
});

test("nocturne.procs opens it centered, again closes it; nocturne.ports on an open deck switches it to its ports", () => {
  procs.toggleProcs({ centered: true });
  expect(overlays[0]).toMatchObject({ kind: "dialog", props: { tab: "procs" } });
  expect(overlays[0].at).toBeUndefined();
  procs.toggleProcs({ centered: true, tab: "ports" });
  expect(closed).toEqual([]);
  expect(shared["nocturne-procs.deck"].want).toBe("ports");
  procs.toggleProcs({ centered: true });
  expect(closed).toEqual(["o1"]);
  procs.toggleProcs({ centered: true, tab: "ports" });
  expect(overlays[1]).toMatchObject({ kind: "dialog", props: { tab: "ports" } });
});

test("the mark's count: ports whose process runs in one of this app's terminals", () => {
  const text = `${PS.split("\n").map((l) => l.trim().split(/\s+/).slice(0, 2).join(" ")).join("\n")}\n${SEP}\n${LSOF}`;
  expect(procs.countPorts(text, TERMS)).toBe(2); // :5173 (vite in t7), :8080 (claude in t4)
  expect(procs.countPorts(text, [TERMS[1]])).toBe(1);
  expect(procs.countPorts(`${SEP}\n`, TERMS)).toBe(0);
});

test("the strip control: the tree mark, lit while open, and the count in teal", () => {
  const tool = (_t: any, id: string, on: boolean, tip: string, act: Function, ...kids: any[]) => ({ id, on, tip, act, kids });
  shared["nocturne-procs.count"] = { at: Date.now(), n: 2 };
  let c: any = procs.procsControl(theme, tool);
  expect(c).toMatchObject({ id: "tab-procs", on: false, tip: "Processes and ports · 2 listening" });
  expect(c.kids[0].tag).toBe("svg:mods/nocturne/art/tree.svg");
  expect(words(c.kids[1])).toEqual([":2"]);
  procs.toggleProcs({});
  c = procs.procsControl(theme, tool);
  expect(c.on).toBe(true);
  expect(c.tip).toBe(null);
});

// ---- the deck

test("it reads once on open and every 2 s; the tree shows space › tab › terminal › processes", async () => {
  const { d, draw } = await deck();
  expect(calls[0][0]).toBe("sh");
  expect(REFRESH).toBe(2000);
  const keys = d.rows().map((r: any) => r.key);
  expect(keys.slice(0, 4)).toEqual(["s:s1", "t:tA", "x:t4", "p:1467"]);
  expect(keys).toContain("p:52391");
  draw();
  expect(words(ids["tab-procs"])).toEqual(["processes", "8"]);
  expect(words(ids["tab-ports"])).toEqual(["ports", "2"]);
  // The count for the strip, from what the deck read.
  expect(shared["nocturne-procs.count"].n).toBe(2);
});

test("the cursor stays on its pid across refreshes, though rows come and go above it", async () => {
  const { d, press, cur } = await deck();
  while (cur() !== "p:50118") await press("j");
  // A new process appears above it (under claude), and one under it goes.
  probeText = probe(PS.replace(" 52210 41872", " 52210 41872").replace("50121 50118 50112 dev                     38:09   0.0  21504 esbuild --service=0.21.5 --ping\n", "")
    + "52500 41872 52500 dev                     00:01   0.0   1000 /bin/sleep 9\n");
  d.refresh(cx);
  await flush();
  expect(d.rows().some((r: any) => r.key === "p:52500")).toBe(true);
  expect(cur()).toBe("p:50118");
});

test("keys: j k move, g G first / last, h l fold and step, space toggles, tab 1 2 switch, a all", async () => {
  const { d, press, cur } = await deck();
  expect(cur()).toBe("s:s1");
  await press("j"); expect(cur()).toBe("t:tA");
  await press("k"); expect(cur()).toBe("s:s1");
  await press("down"); await press("up"); expect(cur()).toBe("s:s1");
  await press("g", { char: "G", mods: { shift: true } }); expect(cur()).toBe(d.rows().at(-1).key);
  await press("g"); expect(cur()).toBe("s:s1");
  await press("pagedown"); expect(d.list().findIndex((r: any) => r.key === cur())).toBeGreaterThan(5);
  await press("home");
  // l on an open group steps in; h on a leaf steps to its parent; h on an open group folds it.
  await press("l"); expect(cur()).toBe("t:tA");
  await press("h"); expect(d.folds["t:tA"]).toBe(true);
  expect(d.rows().some((r: any) => r.key === "x:t4")).toBe(false);
  await press("l"); expect(d.folds["t:tA"]).toBe(false);
  await press("space"); expect(d.folds["t:tA"]).toBe(true);
  await press("space"); expect(d.folds["t:tA"]).toBe(false);
  await press("l"); expect(cur()).toBe("x:t4");
  await press("h"); expect(d.folds["x:t4"]).toBe(true);
  expect(cur()).toBe("x:t4");
  await press("h"); expect(cur()).toBe("t:tA");
  // enter on a group folds it too.
  await press("enter"); expect(d.folds["t:tA"]).toBe(true);
  await press("tab"); expect(d.tab).toBe("ports");
  await press("1"); expect(d.tab).toBe("procs");
  await press("2"); expect(d.tab).toBe("ports");
  await press("3"); expect(d.tab).toBe("system");
  await press("tab"); expect(d.tab).toBe("procs");
  await press("tab", { mods: { shift: true } }); expect(d.tab).toBe("system");
  await press("2");
  expect(shared["nocturne-procs.deck"].tab).toBe("ports");
  await press("1");
  await press("a"); expect(d.all).toBe(true);
  expect(d.rows()[0]).toMatchObject({ key: "p:21416", kind: "proc" });
  await press("a"); expect(d.all).toBe(false);
});

test("keys: / finds (letters type, enter keeps it, esc clears then leaves), ? keys, q and esc close", async () => {
  const { d, press, draw } = await deck();
  await press("/", { char: "/" });
  expect(d.typing).toBe(true);
  for (const c of "vite") await press(c);
  expect(d.query).toBe("vite");
  expect(d.rows().map((r: any) => r.key)).toEqual(["s:s1", "t:tB", "x:t7", "p:50112", "p:50118"]);
  await press("backspace"); expect(d.query).toBe("vit");
  await press("enter"); expect(d.typing).toBe(false);
  expect(d.query).toBe("vit");
  await press("escape"); expect(d.query).toBe("");
  await press("/", { char: "/" }); await press("x");
  await press("escape"); expect(d.query).toBe("");
  await press("escape"); expect(d.typing).toBe(false);
  await press("/", { char: "?", mods: { shift: true } });
  expect(d.help).toBe(true);
  draw();
  expect(ids["procs-help"]).toBeTruthy();
  await press("escape"); expect(d.help).toBe(false);
  expect(closed).toEqual([]);
  await press("q"); expect(closed).toEqual(["o1"]);
  await press("escape"); expect(closed).toEqual(["o1", "o1"]);
});

test("enter on a process shows its terminal's pane and closes; c copies its command line", async () => {
  const { press, cur } = await deck();
  while (cur() !== "p:52391") await press("j");
  await press("c");
  expect(clip).toEqual(["/nix/store/abc-rustc/bin/rustc --crate-name herdr_app --edition=2021 src/main.rs"]);
  await press("enter");
  expect(ran).toEqual([["pane.focus", { terminal: "t4" }]]);
  expect(closed).toEqual(["o1"]);
});

test("the kill flow: x asks, enter sends TERM, two seconds on the one still there is named, K kills it", async () => {
  stubborn = new Set([50118]);
  const { d, press, cur, draw } = await deck();
  while (cur() !== "p:50118") await press("j");
  await press("x");
  expect(d.ask).toMatchObject({ phase: "ask", pids: [50118], name: "node", ports: [5173] });
  draw();
  expect(words(ids["confirm"])).toContain("End node (50118)?");
  expect(calls.some((c) => c[0] === "kill")).toBe(false);
  await press("enter");
  expect(calls.find((c) => c[0] === "kill")).toEqual(["kill", "-TERM", "50118"]);
  expect(d.ask.phase).toBe("ending");
  await elapse(GRACE);
  expect(d.ask).toMatchObject({ phase: "held", left: [50118] });
  draw();
  expect(words(ids["confirm"])).toContain("node (50118) is still running.");
  await press("k", { char: "K", mods: { shift: true } });
  await flush();
  expect(calls.filter((c) => c[0] === "kill").at(-1)).toEqual(["kill", "-KILL", "50118"]);
  expect(d.ask).toBe(null);
  expect(alive.has(50118)).toBe(false);
});

test("X ends the process and everything under it; one that ends on TERM needs no more; esc keeps it", async () => {
  const { d, press, cur } = await deck();
  while (cur() !== "p:50112") await press("j");
  await press("x", { char: "X", mods: { shift: true } });
  expect(d.ask.pids).toEqual([50112, 50118, 50121]);
  await press("escape");
  expect(d.ask).toBe(null);
  expect(calls.some((c) => c[0] === "kill")).toBe(false);
  await press("x", { char: "X", mods: { shift: true } });
  await press("y");
  await elapse(GRACE);
  expect(calls.find((c) => c[0] === "kill")).toEqual(["kill", "-TERM", "50112", "50118", "50121"]);
  expect(d.ask).toBe(null);
  expect(d.note.text).toBe("ended bun and 2 under it");
});

test("the app, the core and its holders carry a shield: x says why and sends nothing", async () => {
  const { d, press, cur } = await deck();
  await press("a");
  expect(cur()).toBe("p:21416"); // Fireflies
  await press("x");
  expect(d.ask).toBe(null);
  expect(d.note.text).toBe("Fireflies: the app itself, not ended from here");
  await press("j"); // herdr-core
  await press("x", { char: "X", mods: { shift: true } });
  expect(d.ask).toBe(null);
  expect(calls.some((c) => c[0] === "kill")).toBe(false);
});

test("ports: enter opens a new tab in the focused tab's web pane, c copies the address, x asks to end its process", async () => {
  const { d, press, cur, draw } = await deck("ports");
  expect(d.tab).toBe("ports");
  expect(d.list().map((x: any) => x.port)).toEqual([5173, 8080]);
  expect(cur()).toBe("5173:50118");
  draw();
  expect(words(ids["port-0"])).toContain("fireflies › 2 api › t7 · 127.0.0.1 [::1]");
  await press("c");
  expect(clip).toEqual(["http://localhost:5173"]);
  await press("x");
  expect(d.ask).toMatchObject({ pids: [50118], tab: "ports" });
  await press("n");
  await press("enter");
  expect(ran).toEqual([[`nocturne-browser.open:${JSON.stringify({ url: "http://localhost:5173", slot: "s9" })}`]]);
  expect(closed).toEqual(["o1"]);
});

test("ports: o on a port with no web pane in the focused tab opens one beside the focused pane", async () => {
  focusedNow = { tab: "tA", pane: "p1", terminal: "t4" };
  try {
    const { press } = await deck("ports");
    await press("j");
    await press("o");
    expect(ran).toEqual([["app.open_url", { url: "http://localhost:8080", in: "app" }]]);
  } finally { focusedNow = { tab: "tB", pane: "p2", terminal: "t7" }; }
});

test("ports: none listening shows the empty note; the deck says so and the count is 0", async () => {
  probeText = probe(PS, "");
  const { d, draw } = await deck("ports");
  const el = draw();
  expect(d.list()).toEqual([]);
  expect(words(el)).toContain("Nothing of yours listens on a port.");
  expect(shared["nocturne-procs.count"].n).toBe(0);
});

test("the foot names the cursor's row and its keys", async () => {
  const { press, draw, cur } = await deck();
  while (cur() !== "p:50118") await press("j");
  expect(words(draw())).toEqual(expect.arrayContaining(["↳", "node", "x", "end", "/", "find", "?", "keys"]));
  await press("x");
  expect(words(draw())).toEqual(expect.arrayContaining(["end node", "enter", "esc", "keep"]));
});

// ---- the system graphs

test("system (3): CPU, GPU, memory, disk and network graphs with their values; a reading every 2 s while open", async () => {
  const { d, press, draw } = await deck();
  await press("3");
  expect(d.tab).toBe("system");
  // A second reading, so the network has a rate.
  const a = SYS.replace("12944968792", "12946968792");
  sysText = a;
  d.sample(cx);
  await flush();
  const el = draw();
  const w = words(el);
  expect(w).toEqual(expect.arrayContaining(["CPU", "80%", "GPU", "53%", "MEMORY", "26.4G of 32.0G", "DISK", "28.7 MB/s", "NETWORK"]));
  expect(w).toContain("82% used · pressure normal");
  expect(w).toContain("the startup disk is 21% full");
  expect(w.some((x) => /^↓ .*B\/s  ↑ /.test(x))).toBe(true);
  expect(d.sys.cpu).toEqual([80, 80]);
  expect(d.sys.rx.length).toBe(2); // the first reading has no rate yet
  expect(d.sys.rx[0]).toBe(null);
  // Bars: one per reading in the CPU graph.
  expect(ids["g-cpu"].kids.length).toBe(1 + 2);
  expect(words(ids["tab-system"])).toEqual(["system", "80%"]);
});

test("system: a source this machine lacks says so instead of drawing zero", async () => {
  sysText = SYS.replace('"Device Utilization %"=53', "");
  const { press, draw } = await deck();
  await press("3");
  expect(words(draw())).toContain("no GPU reading on this machine");
  expect(words(ids["g-cpu"])).toEqual([]);
});

test("the selected process's detail carries its own CPU and memory over the refreshes", async () => {
  const { d, press, cur, draw } = await deck();
  while (cur() !== "p:52391") await press("j");
  d.refresh(cx); await flush();
  d.refresh(cx); await flush();
  expect(d.hist.get(52391)).toEqual({ cpu: [98.2, 98.2, 98.2], rss: [1992294, 1992294, 1992294] });
  draw();
  expect(ids["sp-cpu"].kids.length).toBe(1 + 3);
  expect(ids["sp-mem"].kids.length).toBe(1 + 3);
});

// ---- by pointer: Developer: "all stuff needs to be mouse and keyboard first"

// Forty sleeps under vite (t7) and as many ports, so both lists overflow.
const MANY = Array.from({ length: 40 }, (_, i) => 70000 + i);
const longPs = () => PS + MANY.map((p, i) => `${p} 50118 50112 dev                     00:10   0.0   1000 /bin/sleep ${i}\n`).join("");
const longLsof = () => LSOF + MANY.map((p, i) => `p${p}\ncsleep\nf9\nn127.0.0.1:${6000 + i}\n`).join("");
/** A cx that counts stop_propagation. */
const spy = () => { const c: any = { ...cx, stopped: 0 }; c.stop_propagation = () => { c.stopped++; }; return c; };
const mouseWheel = (lines: number) => ({ delta: { x: 0, y: lines * 18 }, delta_lines: { x: 0, y: lines }, touch_phase: "moved", position: { x: 0, y: 0 }, modifiers: {} });
const trackpad = (px: number) => ({ delta: { x: 0, y: px }, touch_phase: "moved", position: { x: 0, y: 0 }, modifiers: {} });
const slotOf = (key: string) => ids[`slot-${key}`];

test("the wheel scrolls the processes, a mouse's lines by rows, a trackpad's pixels unzoomed (0.9), and it stays scrolled", async () => {
  probeText = probe(longPs(), longLsof());
  const { d, draw, cur, press } = await deck();
  draw();
  expect(cur()).toBe("s:s1");
  const c = spy();
  // Down three notches: three rows. This used to snap back: each frame pulled the scroll to the cursor.
  ids["procs-list"].on.scroll_wheel(mouseWheel(-3), c);
  expect(c.stopped).toBe(1);
  draw();
  expect(d.scroll.procs).toBe(3 * ROW);
  expect(cur()).toBe("s:s1"); // the cursor stays on its row
  // A trackpad: 45 window px at zoom 0.9 are 50 layout px.
  ids["procs-list"].on.scroll_wheel(trackpad(-45), c);
  draw();
  expect(d.scroll.procs).toBe(3 * ROW + 50);
  // A refresh keeps the scroll.
  d.refresh(cx); await flush(); draw();
  expect(d.scroll.procs).toBe(3 * ROW + 50);
  // Up past the top stops at 0.
  ids["procs-list"].on.scroll_wheel(mouseWheel(40), c);
  draw();
  expect(d.scroll.procs).toBe(0);
  // Far down stops where the last row ends at the list's foot.
  ids["procs-list"].on.scroll_wheel(trackpad(-100000), c);
  draw();
  const last = d.rows().at(-1).key;
  expect(slotOf(last).css.top[0] + slotOf(last).css.h[0]).toBe(LIST_H);
  // A key brings the cursor back into sight: j moves it to the second row, now the top one.
  await press("j");
  draw();
  expect(d.scroll.procs).toBe(ROW);
});

test("the last process stays reachable with its detail block open: G scrolls to its block's foot, the wheel can't pass it", async () => {
  probeText = probe(longPs(), longLsof());
  const { d, draw, press, cur } = await deck();
  await press("a"); // every process of dev's: the last row is one
  await press("g", { char: "G", mods: { shift: true } });
  draw();
  const last = d.rows().at(-1).key;
  expect(last).toMatch(/^p:/);
  expect(cur()).toBe(last);
  const slot = slotOf(last);
  expect(slot.css.h[0]).toBeGreaterThan(ROW); // the row and its block
  expect(slot.css.top[0] + slot.css.h[0]).toBe(LIST_H);
  const at = d.scroll.procs;
  ids["procs-list"].on.scroll_wheel(mouseWheel(-5), spy());
  draw();
  expect(d.scroll.procs).toBe(at);
});

test("the wheel scrolls the ports too", async () => {
  probeText = probe(longPs(), longLsof());
  const { d, draw } = await deck("ports");
  draw();
  ids["ports-list"].on.scroll_wheel(mouseWheel(-2), spy());
  draw();
  expect(d.scroll.ports).toBe(2 * PROW);
  ids["ports-list"].on.scroll_wheel(trackpad(-9), spy());
  draw();
  expect(d.scroll.ports).toBe(2 * PROW + 10);
  ids["ports-list"].on.scroll_wheel(trackpad(1e6), spy());
  draw();
  expect(d.scroll.ports).toBe(0);
});

test("the wheel over a long command scrolls the command; at its end the list takes the wheel", async () => {
  const { d, draw, press, cur } = await deck();
  while (cur() !== "p:52391") await press("j");
  draw();
  // As drawn: 108 window px at 0.9, eight lines of 15.
  ids["cmd-text"].on.size_change({ width: 396, height: 108 }, cx);
  expect(d.cmd).toMatchObject({ pid: 52391, h: 120 });
  draw();
  const c = spy();
  ids["cmd"].on.scroll_wheel(mouseWheel(-1), c);
  expect(d.cmd.y).toBe(15);
  expect(c.stopped).toBe(1);
  ids["cmd"].on.scroll_wheel(trackpad(-1000), c);
  draw();
  const room = d.cmd.h - ids["cmd"].css.h[0];
  expect(d.cmd.y).toBe(room);
  expect(ids["cmd-text"].css.top[0]).toBe(-room);
  // At the end: not stopped, so the list under it scrolls.
  ids["cmd"].on.scroll_wheel(mouseWheel(-1), c);
  expect(c.stopped).toBe(2);
  // Another process starts at its top.
  await press("k");
  draw();
  expect(d.cmd.y).toBe(0);
});

test("clicks: a row selects, a double click shows its terminal, the fold arrow folds, the tabs and the scope switch", async () => {
  const { d, draw, cur } = await deck();
  draw();
  const keys = d.rows().map((r: any) => r.key);
  const i = keys.indexOf("p:41872");
  ids[`row-${i}`].on.click({ click_count: 1 }, cx);
  expect(cur()).toBe("p:41872");
  expect(ran).toEqual([]);
  draw();
  ids[`row-${i}`].on.click({ click_count: 2 }, cx);
  expect(ran).toEqual([["pane.focus", { terminal: "t4" }]]);
  expect(closed).toEqual(["o1"]);
  // The fold arrow of tab A folds it (and selects it); a second click unfolds.
  draw();
  const c = spy();
  ids["fold-1"].on.click({ click_count: 1 }, c);
  expect(c.stopped).toBe(1);
  expect(cur()).toBe("t:tA");
  expect(d.folds["t:tA"]).toBe(true);
  expect(d.rows().some((r: any) => r.key === "x:t4")).toBe(false);
  draw();
  ids["fold-1"].on.click({ click_count: 1 }, c);
  expect(d.folds["t:tA"]).toBe(false);
  // A double click on a group folds it, as enter does.
  draw();
  ids["row-1"].on.click({ click_count: 2 }, cx);
  expect(d.folds["t:tA"]).toBe(true);
  // The tabs and "fireflies" / "all of dev".
  draw();
  ids["tab-ports"].on.click({}, cx); expect(d.tab).toBe("ports");
  draw();
  ids["tab-system"].on.click({}, cx); expect(d.tab).toBe("system");
  draw();
  ids["tab-procs"].on.click({}, cx); expect(d.tab).toBe("procs");
  draw();
  ids["scope"].on.click({}, cx); expect(d.all).toBe(true);
  draw();
  expect(words(ids["scope"])).toEqual(["all of dev"]);
});

test("clicks: the foot's keys are buttons: end asks, enter ends, find opens the field and a click on the field keeps it", async () => {
  const { d, draw, press, cur } = await deck();
  while (cur() !== "p:50112") await press("j");
  draw();
  ids["k-tree"].on.click({}, cx);
  expect(d.ask.pids).toEqual([50112, 50118, 50121]);
  draw();
  ids["k-no"].on.click({}, cx);
  expect(d.ask).toBe(null);
  draw();
  ids["k-end"].on.click({}, cx);
  expect(d.ask).toMatchObject({ phase: "ask", pids: [50112] });
  draw();
  ids["k-yes"].on.click({}, cx);
  await flush();
  expect(calls.find((x) => x[0] === "kill")).toEqual(["kill", "-TERM", "50112"]);
  d.ask = null;
  draw();
  ids["k-find"].on.click({}, cx);
  expect(d.typing).toBe(true);
  await press("b");
  draw();
  ids["k-enter"].on.click({}, cx);
  expect(d.typing).toBe(false);
  expect(d.query).toBe("b");
  draw();
  ids["find-query"].on.click({}, cx);
  expect(d.typing).toBe(true);
  draw();
  ids["find-field"].on.click({}, cx);
  expect(d.typing).toBe(true);
  ids["k-esc"].on.click({}, cx);
  expect(d.query).toBe("");
  draw();
  ids["k-help"].on.click({}, cx);
  expect(d.help).toBe(true);
});

test("clicks on ports: a row selects, a double click opens it; open / copy / end show on the selected and the hovered row", async () => {
  const { d, draw, cur } = await deck("ports");
  draw();
  expect(ids["o-0"]).toBeTruthy(); // the cursor's row
  expect(ids["o-1"]).toBeUndefined();
  ids["port-1"].on.hover(true, cx);
  draw();
  expect(ids["o-1"]).toBeTruthy(); // hovered
  ids["c-1"].on.click({}, cx);
  expect(clip).toEqual(["http://localhost:8080"]);
  ids["x-1"].on.click({}, cx);
  expect(cur()).toBe("8080:41872");
  expect(d.ask).toMatchObject({ pids: [41872], tab: "ports" });
  d.ask = null;
  draw();
  ids["port-0"].on.click({ click_count: 1 }, cx);
  expect(cur()).toBe("5173:50118");
  ids["port-0"].on.click({ click_count: 2 }, cx);
  expect(ran).toEqual([[`nocturne-browser.open:${JSON.stringify({ url: "http://localhost:5173", slot: "s9" })}`]]);
});

test("the scrollbar: a thumb while the rows overflow; dragging it scrolls, a press beside it jumps there", async () => {
  probeText = probe(longPs(), longLsof());
  const { d, draw } = await deck();
  draw();
  const bar = ids["bar-procs"];
  expect(bar).toBeTruthy();
  const root = ids["nocturne-procs"];
  // Pressed on the thumb (at the top) and dragged 90 window px (100 layout px) down.
  const c = spy();
  bar.on["down:left"]({ position: { x: 470, y: 200 }, local_position: { x: 4, y: 4 }, click_count: 1 }, c);
  expect(c.stopped).toBe(1);
  expect(d.scroll.procs).toBe(0);
  root.on.mouse_move({ position: { x: 470, y: 290 } }, cx);
  const moved = d.scroll.procs;
  expect(moved).toBeGreaterThan(100); // the thumb moves less than the rows: they're longer than the list
  draw();
  expect(d.scroll.procs).toBe(moved); // not pulled back to the cursor
  root.on["up:left"]({}, cx);
  expect(d.drag).toBe(null);
  root.on.mouse_move({ position: { x: 470, y: 400 } }, cx);
  expect(d.scroll.procs).toBe(moved);
  // A press at the strip's foot: the end.
  draw();
  ids["bar-procs"].on["down:left"]({ position: { x: 470, y: 600 }, local_position: { x: 4, y: LIST_H * 0.9 }, click_count: 1 }, cx);
  root.on["up:left"]({}, cx);
  draw();
  const last = d.rows().at(-1).key;
  expect(slotOf(last).css.top[0] + slotOf(last).css.h[0]).toBe(LIST_H);
  // A short list has none.
  probeText = probe();
  d.refresh(cx); await flush();
  draw();
  expect(ids["bar-procs"]).toBeUndefined();
});

// ---- the system tab's pace: Developer: "when system tab is active refresh every second"

test("system readings: a second apart while the system tab shows, 2 s behind the others, never two at once", async () => {
  const sys = await import("../defaults/mods/nocturne-procs/sys.js");
  expect(sys.STEP_SHOWN).toBe(1000);
  expect(sys.STEP).toBe(2000);
  expect(sys.KEEP).toBe(90); // still about 90 s at a second
  const { d, press } = await deck();
  const reads = () => calls.filter((c) => c[0] === "sh" && c[2].includes("nocturne-sys")).length;
  const n0 = reads();
  // On the processes tab: not after a second, after two.
  d.tick(cx, d.sampled + 1000); await flush();
  expect(reads()).toBe(n0);
  d.tick(cx, d.sampled + 2000); await flush();
  expect(reads()).toBe(n0 + 1);
  // On the system tab: a second.
  await press("3");
  d.tick(cx, d.sampled + 999); await flush();
  expect(reads()).toBe(n0 + 1);
  d.tick(cx, d.sampled + 1000); await flush();
  expect(reads()).toBe(n0 + 2);
  // A slow source: while a reading runs, no other starts, however late it is.
  let release: Function = () => {};
  sysGate = new Promise((r) => { release = r; });
  try {
    d.tick(cx, d.sampled + 1000); await flush();
    expect(reads()).toBe(n0 + 3);
    for (const late of [1000, 5000, 60000]) { d.tick(cx, d.sampled + late); await flush(); }
    expect(reads()).toBe(n0 + 3);
    release(); await flush();
    expect(d.sampling).toBe(false);
  } finally { sysGate = null; }
  // Back on another tab, 2 s again; switching to system reads at once when a second has passed.
  await press("1");
  d.tick(cx, d.sampled + 1500); await flush();
  expect(reads()).toBe(n0 + 3);
  d.sampled -= 1500;
  await press("3");
  expect(reads()).toBe(n0 + 4);
});

test("system: the graphs hold 90 readings, the newest at the right, in bars half as wide", async () => {
  const { d, press, draw } = await deck();
  await press("3");
  for (let i = 0; i < 95; i++) { d.sampling = false; d.sample(cx); await flush(); }
  expect(d.sys.cpu.length).toBe(90);
  draw();
  expect(ids["g-cpu"].kids.length).toBe(1 + 90);
  expect(words(draw())).toContain("a reading every second while this tab shows");
});
