// The shipped palette (frame/palette/main.js) through its module graph:
// every app command and every global or terminal key in the shipped keys
// files is an entry in some state, or in its OUT list with a reason. (Layout
// and mod sections belong to a layout's own palette: nocturne-palette.test.ts.)
// Its own process: mock.module is process-wide.
import { keysNow } from "./nocturne-mods.ts";
import { test, expect, mock } from "bun:test";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const read = (f: string) => readFileSync(root + f, "utf8");
const CORE = [...read("src/commands.rs").matchAll(/cmd\("([a-z_]+\.[a-z_]+)",\s*&\[([^\]]*)\]/g)].map(([, name, args]) => ({
  name, about: "", args: [...args.matchAll(/(req|opt)\("([a-z_]+)"\)/g)].map(([, k, n]) => ({ name: n, required: k === "req" })),
}));

const state: any = {};
function reset() {
  Object.assign(state, {
    platform: "macos",
    focused: { space: "s1", tab: "c1", pane: "p1", terminal: "t1", cwd: "/src" },
    panes: [{ pane: "p1", tab: "c1", focused: true, terminal: "t1" }],
    terminals: [{ address: "t1", state: "live", labels: {} }],
    agents: [] as any[],
    spaces: [{ id: "s1", active: true, machine: null, tabs: [] }],
    layout: { id: "root", children: [{ id: "sidebar" }] },
    updates: null as any,
    ran: [] as any[],
  });
}
reset();

const el: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : () => el), apply: () => el });
mock.module("herdr", () => ({
  commands: () => CORE, layouts: () => ["main"], keys: () => [], run: (n: string, a: unknown) => state.ran.push([n, a]),
  theme: () => new Proxy({}, { get: () => "#808080" }), props: () => ({ overlay: "o1" }), closeOverlay: () => {}, openOverlay: () => {},
  shared: () => null, window: () => ({ platform: state.platform }), focused: () => state.focused, panes: () => state.panes,
  terminals: () => state.terminals, agents: () => state.agents, updates: () => state.updates, layout: () => state.layout,
  spaces: () => state.spaces, pickFolder: async () => "/picked",
}));
mock.module("gpui-kit", () => ({ div: () => el, svg: () => el, View: class {} }));
mock.module("gpui-base", () => ({ h_flex: () => el, v_flex: () => el, InputState: { new: () => ({ on() {}, value: () => "", focus() {} }) }, Input: { new: () => el } }));
globalThis.localStorage = { getItem: () => null, setItem: () => {} } as any;

const { default: Palette, OUT, keyOf } = await import("../defaults/frame/palette/main.js");
const cx: any = { notify() {}, focus_handle: () => ({}), timer: { after() {} } };
function rows(query = "") {
  const p: any = new Palette();
  p.init({}, cx);
  p.query = query;
  return p.rows();
}

const STATES: (() => void)[] = [
  () => {},
  () => { state.platform = "linux"; },
  () => { state.agents = [{ address: "t1", pinned: false }]; state.panes.push({ pane: "p2", tab: "c1", terminal: "t2" }); },
  () => { state.terminals = [{ address: "t1", state: "live", parent: "t0", labels: { "herdr.right-click": "program" } }, { address: "t0", state: "live", labels: {} }]; },
  () => { state.updates = { app: { ready: "9.9.9" }, core: { ready: "1.2.3", managed: null }, checks: true }; },
];

test("every app command and global or terminal key is in the shipped palette or stays out with a reason", () => {
  const covered = new Set<string>(), bare = new Set<string>();
  for (const set of STATES) {
    reset();
    set();
    for (const { e } of rows()) {
      const v = Object.values(e.args)[0];
      covered.add(e.name);
      if (v === undefined) bare.add(e.name); else covered.add(`${e.name}:${v}`);
    }
  }
  const items: [string, string][] = CORE.map((c) => [c.name, "src/commands.rs"]);
  for (const f of ["defaults/keys.json", "defaults/keys.macos.json"]) {
    for (const [section, map] of Object.entries(keysNow(read(f)))) {
      if (section !== "global" && section !== "terminal") continue;
      for (const a of Object.values(map)) if (typeof a === "string" && a !== "terminal" && !a.startsWith("send:")) items.push([a, `${f} ${section}`]);
    }
  }
  const missing = items.filter(([n]) => !covered.has(n) && !(n in OUT) && !(n.split(":")[0] in OUT)).map(([n, from]) => `${n} (${from})`);
  expect([...new Set(missing)]).toEqual([]);
  for (const [name, why] of Object.entries(OUT)) {
    expect(typeof why === "string" && why.length > 10).toBe(true);
    expect(bare.has(name) ? name : "").toBe("");
  }
});

test("terminal commands show only on a terminal; a terminal key shows on its row", () => {
  reset();
  expect(rows().some((r: any) => r.e.name === "terminal.search")).toBe(true);
  state.focused = { space: "s1", tab: "c1", pane: "p1", terminal: null, cwd: "/src" };
  expect(rows().some((r: any) => r.e.name === "terminal.search")).toBe(false);
  expect(keyOf({ name: "terminal.search", args: {} }, [{ section: "terminal", action: "terminal.search", keys: "cmd-f" }])).toBe("cmd-f");
  expect(keyOf({ name: "overlay.focus", args: { dir: "prev" } }, [{ section: "terminal", action: "overlay.focus:prev", keys: "ctrl-shift-`" }])).toBe("ctrl-shift-`");
});

test("the space's folder is asked for with the folder picker", async () => {
  reset();
  const p: any = new Palette();
  p.init({}, cx);
  const row = p.rows().find((r: any) => r.e.name === "space.folder");
  expect(row?.e.title).toBe("Change this space's folder…");
  await p.go(row.e);
  expect(state.ran).toContainEqual(["space.folder", { id: "s1", folder: "/picked" }]);
});
