// The processes and ports manager as Developer drives it: the strip's tree
// mark and nocturne.procs / nocturne.ports open and close the deck
// (defaults/mods/nocturne/procs.js); the deck's every key, its cursor across
// refreshes, the kill flow (ask, TERM, still there, KILL) and the port
// actions, against a fake exec that never signals a real process. herdr and
// gpui stand-ins (mock.module is process-wide: this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";
import { COMM, PS, LSOF, TERMS, PANES, SPACES } from "./fixtures/procs.ts";

class El {
  kids: any[] = [];
  on: Record<string, Function> = {};
  text: string[] = [];
  constructor(public tag?: string) {
    return new Proxy(this, {
      get: (t, k: string, proxy) => k in t ? (t as any)[k] : k === "then" ? undefined : (...a: any[]) => {
        if (k === "id") ids[a[0]] = proxy;
        else if (k === "child") { t.kids.push(a[0]); if (typeof a[0] === "string") t.text.push(a[0]); }
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
/** Every string drawn under an element, in order. */
const words = (el: any): string[] => !el || typeof el !== "object" ? (typeof el === "string" ? [el] : []) : el.kids.flatMap(words);

let shared: Record<string, any> = {};
let overlays: any[] = [];
let closed: string[] = [];
let ran: any[] = [];
let calls: string[][] = [];
let propsNow: any = {};
let probeText = "";
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
    if (cmd === "sh") return { code: 0, stdout: probeText, stderr: "" };
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
const { default: Deck, REFRESH, GRACE } = await import("../defaults/mods/nocturne-procs/main.js");

beforeEach(() => {
  shared = {}; overlays = []; closed = []; ran = []; calls = []; ids = {}; clip = []; timers = [];
  propsNow = { overlay: "o1", tab: "procs" };
  probeText = probe();
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
