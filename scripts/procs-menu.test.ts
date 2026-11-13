// The process deck's row menu (defaults/mods/procs/menu.ts, menu-view.ts):
// Developer: "also i expect to be able to right click the processes and get
// meaningful options here to be mouse first". Its entries per row kind, each
// entry's act against a fake exec and fake herdr calls (no real process is
// ever signalled), the ends asking first, open and close (esc, a click
// outside, a second right-click), its place at the pointer, every entry's key
// with and without the menu, and a database's port opening the Databases mod
// (its contract: nocturne.databases / its window's props.connect). herdr and
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
const SEP = "@@procs@@";
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
    if (cmd === "test") return { code: dbInstalled && args[1]?.endsWith("/mods/databases/mod.json") ? 0 : 1, stdout: "", stderr: "" };
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
});

const key = (k: string, extra: any = {}) => ({ key: k, key_char: extra.char ?? (k.length === 1 ? k : undefined), modifiers: { shift: false, control: false, alt: false, platform: false, ...(extra.mods ?? {}) } });
async function deck(tab = "procs") {
  propsNow = { overlay: "o1", tab };
  const d: any = new Deck();
  d.init({}, cx);
  await flush();
  const it = {
    d,
    draw: () => { ids = {}; return d.render(); },
    press: async (k: string, extra: any = {}) => { d.onKey(key(k, extra), cx); await flush(); },
    cur: () => { const items = d.list(); return items[d.at(items)]?.key; },
    /** The cursor onto the row with this key. */
    sel: async (k: string) => { for (let n = 0; n < 60 && it.cur() !== k; n++) await it.press("j"); expect(it.cur()).toBe(k); },
    /** A right press on the row (its handler, then the deck's) at deck px (x, y), as GPUI sends it: zoomed. */
    right: (k: string, x = 100, y = 200, c: any = cx) => {
      it.draw();
      const row = Object.values(ids).find((el: any) => el?.on?.["down:right"] && Object.keys(ids).find((id) => ids[id] === el)?.match(/^(row|port)-/) && rowKey(el) === k);
      (row as any)?.on["down:right"]({ position: { x, y }, local_position: { x, y }, click_count: 1 }, c);
      ids["procs-deck"].on["down:right"]({ position: { x: x * 0.9, y: y * 0.9 }, local_position: { x: x * 0.9, y: y * 0.9 }, click_count: 1 }, c);
    },
    /** The open menu's entries as "key label". */
    entries: () => d.menu?.entries.map((e: any) => `${e.key} ${e.label}`) ?? null,
  };
  return it;
}
/** The key of the row an element draws (its id holds its index in the shown list). */
let rowKey = (_el: any): string | null => null;
const spy = () => { const c: any = { ...cx, stopped: 0 }; c.stop_propagation = () => { c.stopped++; }; return c; };
const killed = () => calls.filter((c) => c[0] === "kill");

// A database on the ports: postgres on 5432, run from bun's terminal (t7).
const DB_PS = PS + `70500 50112 70500 dev                     05:00   0.1  30000 postgres -D /w/db\n`;
const DB_LSOF = LSOF + `p70500\ncpostgres\nf5\nn127.0.0.1:5432\n`;

async function opened(k: string, tab = "procs") {
  const t = await deck(tab);
  rowKey = (el: any) => { const id = Object.keys(ids).find((i) => ids[i] === el) ?? ""; const n = Number(id.split("-")[1]); return t.d.list()[n]?.key ?? null; };
  t.right(k);
  return t;
}

// ---- the entries a row offers

test("a process's menu: go to its terminal, its folder, pid, command line, and the ends; fold and the tree only with children", async () => {
  const { entries, d } = await opened("p:52391"); // rustc, under cargo in t4
  expect(entries()).toEqual(["enter go to its terminal", "f open its folder", "p copy pid", "c copy command line", "x end (TERM)", "K force end (KILL)"]);
  d.menu = null;
  const node = await opened("p:50118"); // vite's node, esbuild under it
  expect(node.entries()).toEqual(["enter go to its terminal", "f open its folder", "p copy pid", "c copy command line", "space fold its children",
    "x end (TERM)", "K force end (KILL)", "X end the tree under it"]);
  expect(node.d.menu.entries.filter((e: any) => e.danger).map((e: any) => e.key)).toEqual(["x", "K", "X"]);
});

test("a shielded process (the app itself) has no end in its menu", async () => {
  const t = await deck();
  await t.press("a");
  rowKey = (el: any) => { const id = Object.keys(ids).find((i) => ids[i] === el) ?? ""; return t.d.list()[Number(id.split("-")[1])]?.key ?? null; };
  t.right("p:21416");
  expect(t.entries()).toEqual(["f open its folder", "p copy pid", "c copy command line"]);
});

test("a terminal's, a tab's and a space's menu: go to it, its folder, fold, end what runs in it", async () => {
  expect((await opened("x:t4")).entries()).toEqual(["enter go to it", "f open its folder", "space fold", "x end what runs in it"]);
  expect((await opened("t:tB")).entries()).toEqual(["t go to it", "space fold", "x end what runs in it"]);
  expect((await opened("s:s1")).entries()).toEqual(["t go to it", "space fold", "x end what runs in it"]);
});

test("a port's menu: open in a web pane, copy the port and the address, go to its terminal, end its process", async () => {
  const { entries } = await opened("5173:50118", "ports");
  expect(entries()).toEqual(["enter open in a web pane", "p copy the port", "c copy the address", "t go to its terminal", "x end the process that holds it"]);
});

test("a database's port offers open in Databases, only while the Databases mod is installed", async () => {
  probeText = probe(DB_PS, DB_LSOF);
  expect((await opened("5432:70500", "ports")).entries()).not.toContain("d open in Databases");
  dbInstalled = true;
  const t = await opened("5432:70500", "ports");
  expect(calls).toContainEqual(["test", "-f", "/home/dev/.config/herdr-app/mods/databases/mod.json"]);
  expect(t.entries()?.[1]).toBe("d open in Databases");
  // Not on a port that isn't a database's.
  t.d.menu = null;
  t.right("5173:50118");
  expect(t.entries()).not.toContain("d open in Databases");
});

// ---- open and close

test("a right-click opens the menu at the pointer (unzoomed), selects its row, and keeps it inside the deck", async () => {
  const t = await deck();
  rowKey = (el: any) => { const id = Object.keys(ids).find((i) => ids[i] === el) ?? ""; return t.d.list()[Number(id.split("-")[1])]?.key ?? null; };
  t.right("p:50118", 120, 150);
  expect(t.cur()).toBe("p:50118");
  expect(t.d.menu.at).toEqual({ x: 120, y: 150 });
  t.draw();
  expect(ids["pm-menu"].css.left[0]).toBe(120);
  expect(ids["pm-menu"].css.top[0]).toBe(150);
  // Its row's name in its top edge.
  expect(words(ids["pm-menu"])).toContain("node 50118");
  // Near the right edge it moves in; near the bottom it opens upward, above the pointer.
  const { menuPlace, menuH, MENU_W } = await import("../defaults/mods/procs/menu-view.ts");
  const { W, H } = await import("../defaults/mods/procs/state.ts");
  expect(menuPlace({ at: { x: 460, y: 100 }, above: 100 }, 5).x).toBe(W - 2 - MENU_W - 8);
  expect(menuPlace({ at: { x: 40, y: 520 }, above: 520 }, 5).y).toBe(520 - menuH(5));
  expect(menuPlace({ at: { x: 40, y: 520 }, above: 496 }, 5).y).toBe(496 - menuH(5));
  expect(menuPlace({ at: { x: 40, y: 100 }, above: 76 }, 5).y).toBe(100);
  // Never over the top either.
  expect(menuPlace({ at: { x: 40, y: 540 }, above: 20 }, 8).y).toBe(8);
  expect(menuPlace({ at: { x: 40, y: 540 }, above: 540 }, 8).y + menuH(8)).toBeLessThanOrEqual(H - 2 - 8);
});

test("m opens it under the selected row, and over the row near the deck's foot", async () => {
  probeText = probe(PS + Array.from({ length: 40 }, (_, i) => `${70000 + i} 50118 50112 dev                     00:10   0.0   1000 /bin/sleep ${i}\n`).join(""), LSOF);
  const t = await deck();
  t.draw();
  await t.press("m");
  expect(t.d.menu.key).toBe("s:s1");
  const { menuPlace, menuH } = await import("../defaults/mods/procs/menu-view.ts");
  const { HEAD, COLS, ROW, STRIP_H, H } = await import("../defaults/mods/procs/state.ts");
  expect(t.d.menu.at).toEqual({ x: 40, y: HEAD + STRIP_H + COLS + ROW });
  await t.press("escape");
  expect(t.d.menu).toBe(null);
  // The last process, at the list's foot: the menu sits above it, inside the deck.
  const last = t.d.rows().filter((r: any) => r.kind === "proc").at(-1).key;
  await t.sel(last);
  t.draw();
  expect(t.d.scroll.procs).toBeGreaterThan(0);
  await t.press("m");
  // (Another machine's space offers nothing: no menu opens on it.)
  const m = t.d.menu;
  const at = menuPlace(m, m.entries.length);
  expect(at.y + menuH(m.entries.length)).toBeLessThanOrEqual(m.above);
  expect(at.y + menuH(m.entries.length)).toBeLessThanOrEqual(H - 2);
});

test("it closes on esc, on m, on a press outside it, and on a second right-click; the deck stays open", async () => {
  const t = await opened("p:50118");
  await t.press("escape");
  expect(t.d.menu).toBe(null);
  expect(closed).toEqual([]);
  t.right("p:50118");
  await t.press("m");
  expect(t.d.menu).toBe(null);
  t.right("p:50118");
  t.draw();
  const c = spy();
  ids["pm-layer"].on["down:left"]({ position: { x: 5, y: 5 } }, c);
  expect(t.d.menu).toBe(null);
  expect(c.stopped).toBe(1);
  t.right("p:50118");
  t.draw();
  ids["pm-layer"].on["down:right"]({ position: { x: 5, y: 5 } }, spy());
  expect(t.d.menu).toBe(null);
  // A right press that isn't on a row opens nothing.
  ids["procs-deck"].on["down:right"]({ position: { x: 5, y: 5 }, local_position: { x: 5, y: 5 } }, cx);
  expect(t.d.menu).toBe(null);
  expect(closed).toEqual([]);
});

test("in the menu: j k move, enter runs the entry, an entry's key runs it; a press on an entry never reaches the row's buttons under it", async () => {
  const t = await opened("p:52391");
  await t.press("j"); await t.press("j");
  expect(t.d.menu.n).toBe(2);
  await t.press("k");
  expect(t.d.menu.n).toBe(1);
  await t.press("j");
  await t.press("enter"); // p copy pid
  expect(t.d.menu).toBe(null);
  expect(clip).toEqual(["52391"]);
  t.right("p:52391");
  await t.press("c");
  expect(clip.at(-1)).toContain("rustc --crate-name herdr_app");
  // The selected row's detail block (show / copy / end) lies under the menu: an entry's press
  // stops there, so the block's buttons never see it; the click runs the entry.
  t.right("p:52391");
  t.draw();
  const c = spy();
  ids["pm-2"].on["down:left"]({ position: { x: 150, y: 260 } }, c);
  expect(c.stopped).toBe(1);
  expect(t.d.menu).not.toBe(null);
  ids["pm-2"].on.click({ click_count: 1 }, cx);
  expect(t.d.menu).toBe(null);
  expect(clip.at(-1)).toBe("52391");
  expect(t.d.ask).toBe(null);
  expect(ran).toEqual([]);
});

// ---- what each entry does

test("go to: a process's terminal pane, a terminal, a tab, a space (the deck closes)", async () => {
  let t = await opened("p:52391");
  await t.press("enter");
  expect(ran).toEqual([["pane.focus", { terminal: "t4" }]]);
  expect(closed).toEqual(["o1"]);
  for (const [k, cmd] of [["t:tB", ["tab.select", { id: "tB" }]], ["s:s1", ["space.select", { id: "s1" }]], ["x:t7", ["pane.focus", { terminal: "t7" }]]] as const) {
    ran = [];
    t = await opened(k);
    await t.press(k === "x:t7" ? "enter" : "t");
    expect(ran).toEqual([cmd]);
  }
});

test("open its folder: a process's working folder (lsof) or a terminal's, in a files pane beside the focused one", async () => {
  let t = await opened("p:50118");
  await t.press("f");
  await flush();
  expect(calls).toContainEqual(["lsof", "-a", "-p", "50118", "-d", "cwd", "-Fn"]);
  expect(ran).toEqual([["files.open", { path: "/w/from-lsof/50118", pane: "p2" }]]);
  expect(closed).toEqual(["o1"]);
  ran = [];
  t = await opened("x:t4");
  await t.press("f");
  expect(ran).toEqual([["files.open", { path: "/w", pane: "p2" }]]);
});

test("fold from the menu folds the row's children", async () => {
  const t = await opened("p:50118");
  await t.press("space");
  expect(t.d.folds.get("p:50118")).toBe(true);
  expect(t.d.rows().some((r: any) => r.key === "p:50121")).toBe(false);
});

test("end (TERM) asks under the row first; enter then sends TERM: nothing is signalled before", async () => {
  const t = await opened("p:52391");
  await t.press("x");
  expect(t.d.ask).toMatchObject({ pids: [52391], phase: "ask" });
  expect(killed()).toEqual([]);
  t.draw();
  expect(words(ids["confirm"])).toContain("End rustc (52391)?");
  await t.press("enter");
  expect(killed()).toEqual([["kill", "-TERM", "52391"]]);
});

test("force end (KILL) asks too, saying so; enter sends KILL at once", async () => {
  const t = await opened("p:52391");
  await t.press("k", { char: "K", mods: { shift: true } });
  expect(t.d.ask).toMatchObject({ pids: [52391], force: true, phase: "ask" });
  expect(killed()).toEqual([]);
  t.draw();
  expect(words(ids["confirm"])).toEqual(expect.arrayContaining(["Force end rustc (52391)?", "Kill -9 ends it at once, without cleanup.", "enter · kill -9"]));
  await t.press("escape");
  expect(t.d.ask).toBe(null);
  expect(killed()).toEqual([]);
  // Asked again, and this time confirmed.
  t.right("p:52391");
  await t.press("k", { char: "K", mods: { shift: true } });
  await t.press("enter");
  expect(killed()).toEqual([["kill", "-KILL", "52391"]]);
  expect(t.d.ask).toBe(null);
});

test("end the tree under it: the process and everything under it, asked first", async () => {
  const t = await opened("p:50118");
  await t.press("x", { char: "X", mods: { shift: true } });
  expect(t.d.ask).toMatchObject({ pids: [50118, 50121], tree: true });
  await t.press("enter");
  expect(killed()).toEqual([["kill", "-TERM", "50118", "50121"]]);
});

test("end what runs in a terminal: what its shell started (not the shell); one running a program directly: the program and its tree", async () => {
  let t = await opened("x:t4");
  await t.press("x");
  expect(t.d.ask).toMatchObject({ pids: [41872, 52210, 52214, 52391], what: "what runs in t4 (claude, zsh and 2 more)" });
  t.draw();
  expect(words(ids["confirm"])).toContain("End what runs in t4 (claude, zsh and 2 more)?");
  expect(killed()).toEqual([]);
  await t.press("enter");
  expect(killed()).toEqual([["kill", "-TERM", "41872", "52210", "52214", "52391"]]);
  t = await opened("x:t7");
  await t.press("x");
  expect(t.d.ask.pids).toEqual([50112, 50118, 50121]);
  // A tab: every terminal in it; x without the menu does the same.
  t = await deck();
  await t.sel("s:s1");
  await t.press("x");
  expect(t.d.ask.pids).toEqual([41872, 52210, 52214, 52391, 50112, 50118, 50121]);
});

test("a terminal with only its shell: nothing to end, it says so and asks nothing", async () => {
  probeText = probe(PS.split("\n").filter((l) => !/^\s*(41872|52210|52214|52391) /.test(l)).join("\n"), LSOF);
  const t = await deck();
  await t.sel("x:t4");
  await t.press("x");
  expect(t.d.ask).toBe(null);
  expect(t.d.note.text).toBe("nothing runs in t4 but its shell");
});

test("a port: open in a web pane, copy the port and the address, go to its terminal, end its process", async () => {
  let t = await opened("5173:50118", "ports");
  await t.press("p");
  expect(clip).toEqual(["5173"]);
  t.right("5173:50118");
  await t.press("c");
  expect(clip.at(-1)).toBe("http://localhost:5173");
  t.right("5173:50118");
  await t.press("t");
  expect(ran).toEqual([["pane.focus", { terminal: "t7" }]]);
  ran = []; closed = [];
  t = await opened("5173:50118", "ports");
  await t.press("enter");
  expect(ran.length).toBe(1); // the web pane (logic.ts openPort)
  expect(closed).toEqual(["o1"]);
  t = await opened("5173:50118", "ports");
  await t.press("x");
  expect(t.d.ask).toMatchObject({ pids: [50118], phase: "ask" });
  expect(killed()).toEqual([]);
});

test("open in Databases: nocturne.databases with the connection in the nocturne layout, else the Databases window; no secret in it", async () => {
  probeText = probe(DB_PS, DB_LSOF);
  dbInstalled = true;
  shared.layout = "nocturne";
  let t = await opened("5432:70500", "ports");
  await t.press("d");
  const want = { kind: "postgres", name: "postgres :5432", host: "127.0.0.1", port: 5432, from: "port :5432 (postgres in fireflies › api)" };
  expect(ran.length).toBe(1);
  const [cmd] = ran[0];
  expect(cmd.startsWith("nocturne.databases:")).toBe(true);
  expect(JSON.parse(cmd.slice("nocturne.databases:".length))).toEqual({ ...want, from: expect.stringMatching(/^port :5432 \(postgres/) });
  expect(cmd).not.toMatch(/password|secret/);
  expect(closed).toEqual(["o1"]);
  ran = [];
  shared.layout = "main";
  t = await opened("5432:70500", "ports");
  await t.press("d");
  expect(ran).toEqual([]);
  expect(overlays.at(-1)).toMatchObject({ mod: "databases", kind: "window", key: "databases", frame: "none", scrim: true, width: 0.88, height: 0.88,
    props: { connect: { kind: "postgres", host: "127.0.0.1", port: 5432 } } });
  // Without the mod, d does nothing.
  dbInstalled = false;
  ran = []; const n = overlays.length;
  t = await deck("ports");
  await t.sel("5432:70500");
  await t.press("d");
  expect(ran).toEqual([]);
  expect(overlays.length).toBe(n);
});

test("which ports read as a database's", async () => {
  const { dbKind } = await import("../defaults/mods/procs/menu.ts");
  expect([dbKind({ port: 5432, name: "x" }), dbKind({ port: 6000, name: "postgres" }), dbKind({ port: 3306, name: "x" }), dbKind({ port: 3307, name: "mariadbd" }),
    dbKind({ port: 8080, name: "sqld" }), dbKind({ port: 5173, name: "node" })]).toEqual(["postgres", "postgres", "mysql", "mysql", "libsql", null]);
});

test("? lists the menu's keys", async () => {
  const { deckKeys } = await import("../defaults/mods/procs/state.ts");
  const keys = deckKeys().map(([k]: any) => k);
  for (const k of ["m", "t", "p", "f", "K"]) expect(keys).toContain(k);
});
