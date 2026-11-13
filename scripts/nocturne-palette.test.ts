// Nocturne's command palette (mods/nocturne/palette.ts) through its real
// module graph: herdr and gpui are stand-ins, and its entries and rows are
// built in every state the "Open" group depends on (a folder or none, an agent
// focused and pinned or not, the git window and the pip player open or not).
// Its own process: mock.module is process-wide.
// The last test holds the line that no command goes missing: every core
// command, keys.json action and mod command is an entry in some state or in
// the palette's OUT list with a reason.
import { NOCTURNE_MODS, keysNow } from "./nocturne-mods.ts";
import { test, expect, mock } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const GIT_WINDOW = "git.window";
const state: any = {};
function reset() {
  Object.assign(state, {
    spaces: [{ id: "s1", active: true, folder: "/src", machine: null, tabs: [{ id: "c1", active: true }] }],
    panes: [{ pane: "p1", tab: "c1", focused: true, cwd: "/src/app", terminal: "t1" }],
    focused: { pane: "p1", cwd: "/src/app", terminal: "t1" },
    agents: [] as any[],
    terminals: [{ address: "t1", state: "live", labels: {} }],
    shared: {} as Record<string, unknown>,
    platform: "macos",
    commands: null as any, keys: null as any, updates: null as any,
  });
}
reset();

const el: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : () => el), apply: () => el });
const herdr = {
  commands: () => state.commands ?? [
    { name: "tab.new", args: [], about: "" },
    { name: "pane.split", args: [{ name: "direction" }], about: "" },
    { name: "files.open", args: [{ name: "path" }], about: "" },
    { name: "something.new", args: [], about: "a new command" },
  ],
  layouts: () => ["main", "nocturne"],
  keys: () => state.keys ?? [{ section: "layout:nocturne", action: "nocturne.files", keys: "secondary-e" }],
  run: () => {}, theme: () => new Proxy({}, { get: () => "#808080" }), props: () => ({ overlay: "o1" }),
  closeOverlay: () => {}, openOverlay: () => {},
  shared: (k: string) => state.shared[k] ?? null, setShared: (k: string, v: unknown) => { state.shared[k] = v; },
  window: () => ({ platform: state.platform }), settings: () => ({ zoom: 0.9 }),
  agents: () => state.agents, focused: () => state.focused, spaces: () => state.spaces, panes: () => state.panes,
  terminals: () => state.terminals, hc: async () => ({ code: 0, stdout: "", stderr: "" }), exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  home: () => "/home/me", appHome: () => "/home/me/.config/herdr-app", notify: () => {}, pickFolder: async () => null,
  knownAgents: () => [], setAgentOrder: () => {}, nextCommand: () => null, presentUpdateNotes: () => {}, updates: () => state.updates ?? ({ app: { version: "1.0", ready: null, updates: false }, core: { version: null, managed: null, ready: null, updating: false, error: null }, checked: null, checks: true, checking: false, notes: [] }),
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ div: () => el, svg: () => el, image: () => el, View: class {}, PathBuilder: { fill: () => el, stroke: () => el }, Background: { checkerboard: () => el } }));
class Input { on() { return true; } value() { return ""; } set_value() {} focus() {} release() { return true; } }
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, Scrollbar: { vertical: () => el },
  v_virtual_list: () => el, VirtualListScrollHandle: { new: () => ({ scroll_to_item() {}, release() {} }) },
  InputState: { new: () => new Input() }, Input: { new: () => el },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
}));
globalThis.window = { paint_path: () => el } as any;
globalThis.localStorage = { getItem: () => null, setItem: () => {} } as any;

const { default: Palette, OUT, OUT_FAMILIES, keyOf } = await import("../defaults/mods/nocturne/palette.ts");
const cx: any = { notify() {}, focus_handle: () => ({}), timer: { after() {} }, spawn() {}, stop_propagation() {} };

function open(query = "") {
  const p: any = new Palette();
  p.init({}, cx);
  p.query = query;
  return p;
}

const STATES: [string, () => void][] = [
  ["a folder, no agent", () => {}],
  ["no folder at all", () => { state.panes = []; state.focused = null; state.spaces[0].folder = null; }],
  ["an agent focused", () => { state.agents = [{ address: "t1", status: "idle" }]; }],
  ["a pinned agent focused", () => { state.agents = [{ address: "t1", status: "idle" }]; state.terminals[0].labels = { "herdr.pinned": "1" }; }],
  ["the git window open", () => { state.shared[GIT_WINDOW] = { id: "o9", beat: Date.now() }; }],
  ["the pip player open", () => { state.shared["pip.player"] = { t: 1 }; }],
  ["on linux", () => { state.platform = "linux"; }],
];

for (const [name, set] of STATES) {
  test(`palette entries, rows and render: ${name}`, () => {
    reset();
    set();
    for (const q of ["", "files", "zzzzqx"]) {
      const p = open(q);
      const rows = p.rows();
      expect(Array.isArray(rows)).toBe(true);
      if (!q) {
        expect(rows.some((r: any) => r.e.group === "Open")).toBe(true);
        expect(rows.some((r: any) => r.e.name === "tab.new")).toBe(true);
      }
      expect(() => p.render()).not.toThrow();
    }
  });
}

test("the focused folder's files pane and the agent pin are both offered", () => {
  reset();
  state.agents = [{ address: "t1", status: "idle" }];
  const titles = open().rows().map((r: any) => r.e.title);
  expect(titles).toContain("Files pane of this folder");
  expect(titles).toContain("Pin this agent to the top");
  state.terminals[0].labels = { "herdr.pinned": "1" };
  state.shared[GIT_WINDOW] = { id: "o9", beat: Date.now() };
  const more = open().rows().map((r: any) => r.e.title);
  expect(more).toContain("Unpin this agent");
  expect(more).toContain("Git: open the diff as a pane");
});

test("the file picker and grep are entries with their keys", () => {
  reset();
  state.commands = CORE;
  const keys = [
    { section: "global", action: "mod.open:picker", keys: "cmd-p" },
    { section: "layout:nocturne", action: "nocturne.picker", keys: "cmd-p" },
    { section: "layout:nocturne", action: "nocturne.grep", keys: "cmd-shift-f" },
    { section: "mod:editor", action: "editor.keys", keys: "cmd-k shift-/" },
  ];
  const find = open("file").rows().find((r: any) => r.e.name === "nocturne.picker");
  expect(find?.e.title).toBe("Find a file…");
  expect(keyOf(find.e, keys, true)).toBe("⌘P");
  const grep = open("grep").rows().find((r: any) => r.e.name === "nocturne.grep");
  expect(grep?.e.title).toBe("Grep the project…");
  expect(keyOf(grep.e, keys, true)).toBe("shift-⌘F");
  // Fireflies' cmd-p (the places picker) is the layout's file picker in Nocturne: that row shows no key.
  const places = open().rows().find((r: any) => r.e.name === "mod.open");
  expect(keyOf(places.e, keys, true)).toBe(null);
  // A mod's key shows while its pane is focused; shift-/ reads ?, as the keys lists spell it.
  const editorKeys = { name: "editor.keys", args: {} };
  expect(keyOf(editorKeys, keys, true)).toBe(null);
  state.panes = [{ pane: "p1", tab: "c1", focused: true, cwd: "/src", terminal: null, mod: "editor", props: { path: "/src/a.ts" } }];
  expect(keyOf(editorKeys, keys, true)).toBe("⌘K ?");
});

test("typing what Developer typed finds the picker and grep near the top", () => {
  reset();
  state.commands = CORE;
  const top = (q: string) => open(q).rows().slice(0, 3).map((r: any) => r.e.name);
  // "file" matches the word in "Find a file…", not just the f of Find.
  expect(top("file")).toContain("nocturne.picker");
  expect(top("grep")[0]).toBe("nocturne.grep");
  expect(top("find")[0]).toBe("nocturne.picker");
});

test("a focused editor's commands show only while it's focused", () => {
  reset();
  const names = () => open().rows().map((r: any) => r.e.name);
  expect(names()).not.toContain("editor.save");
  state.panes = [{ pane: "p1", tab: "c1", focused: true, cwd: "/src/app", terminal: null, mod: "editor", props: { path: "/src/app/a.ts" } }];
  state.focused = { pane: "p1", cwd: "/src/app" };
  expect(names()).toContain("editor.save");
  expect(names()).not.toContain("editor.preview-split");
  expect(names()).not.toContain("terminal.search");
  state.panes[0].props.path = "/src/app/README.md";
  expect(names()).toContain("editor.preview-split");
});

// ---- the line: nothing a person can trigger goes missing

const root = new URL("../", import.meta.url).pathname;
const read = (f: string) => readFileSync(root + f, "utf8");

/** Core commands, from src/commands.rs (as `herdr-app commands` lists them). */
const CORE = [...read("src/commands.rs").matchAll(/cmd\("([a-z_]+\.[a-z_]+)",\s*&\[([^\]]*)\]/g)].map(([, name, args]) => ({
  name, about: "", args: [...args.matchAll(/(req|opt)\("([a-z_]+)"\)/g)].map(([, k, n]) => ({ name: n, required: k === "req" })),
}));

/** Every action bound in the shipped keys files, all sections, as [action, where]. */
function boundActions(): [string, string][] {
  const out: [string, string][] = [];
  for (const f of ["defaults/keys.json", "defaults/keys.macos.json"]) {
    for (const [section, map] of Object.entries(keysNow(read(f)))) {
      for (const action of Object.values(map)) {
        const a = typeof action === "string" ? action : (action as any)?.command;
        if (a && a !== "terminal" && !a.startsWith("send:")) out.push([a, `${f} ${section}`]);
      }
    }
  }
  return out;
}

/** Every command a Nocturne mod's nextCommand() acts on (`c === "x"`), as [mod.command, file]. */
function modCommands(): [string, string, string?][] {
  const out: [string, string, string?][] = [];
  const dirs = ["nocturne", ...NOCTURNE_MODS];
  for (const d of dirs) {
    for (const f of readdirSync(root + `defaults/mods/${d}`).filter((x) => /\.(js|ts)$/.test(x) && !x.endsWith(".d.ts"))) {
      const text = read(`defaults/mods/${d}/${f}`);
      if (!text.includes("nextCommand()")) continue;
      // file-tree' copy of the preview's viewer: its commands are the preview's (embedded, it takes none).
      if (d !== "preview" && f === "viewer.ts" && text === read(`defaults/mods/preview/${f}`)) continue;
      for (const [, c] of text.matchAll(/(?<!typeof )\bc === "([a-z0-9_-]+)"/g)) out.push([`${d}.${c}`, `defaults/mods/${d}/${f}`]);
    }
  }
  // The git window's key table and the overview's keys: families of their own.
  const git = read("defaults/mods/git/keys.ts");
  for (const [, a] of git.matchAll(/\[\s*"[A-Za-z]+",\s*\[[^\]]*\],\s*"([a-z0-9:-]+)"/g)) out.push([`git.${a.replace(":", "-")}`, "git/keys.ts", "git"]);
  const open = read("defaults/mods/notifications/open.js");
  const keysBlock = open.slice(open.indexOf("export const COMMAND_KEYS"), open.indexOf("};", open.indexOf("export const COMMAND_KEYS")));
  for (const [, k] of keysBlock.matchAll(/"?([a-z-]+)"?: \{ key/g)) out.push([`notifications.${k}`, "notifications/open.js", "notifications"]);
  for (let n = 1; n <= 9; n++) out.push([`notifications.${n}`, "notifications/open.js", "notifications"]);
  return out;
}

/** Every state the palette's entries depend on. */
const COVER_STATES: (() => void)[] = [
  () => {},
  () => { state.platform = "linux"; },
  () => { state.agents = [{ address: "t1", status: "idle" }, { address: "t2", status: "idle" }];
    state.terminals = [{ address: "t1", state: "live", labels: { "herdr.pinned": "1" } }, { address: "t2", state: "live", labels: { "herdr.pinned": "1" } }]; },
  () => { state.agents = [{ address: "t2", status: "idle" }, { address: "t1", status: "idle" }];
    state.terminals = [{ address: "t1", state: "live", labels: { "herdr.pinned": "1", "nocturne.pinned-at": "2" } },
      { address: "t2", state: "live", labels: { "herdr.pinned": "1", "nocturne.pinned-at": "1" } }]; },
  () => { state.terminals = [{ address: "t1", state: "live", parent: "t0", labels: { "herdr.right-click": "program" } }, { address: "t0", state: "live", labels: {}, name: "boss" }];
    state.panes.push({ pane: "p2", tab: "c1", focused: false, cwd: "/src", terminal: "t9" }); },
  () => { state.shared[GIT_WINDOW] = { id: "o9", beat: Date.now() }; state.shared["github.window"] = { id: "o8", beat: Date.now() }; },
  () => { state.shared["pip.player"] = { t: 1 }; },
  () => { state.panes.push({ pane: "p3", tab: "c1", focused: false, mod: "pip" }); },
  // The update note ("Updated to …") on show: its close is offered.
  () => { state.shared["nocturne.update-shown"] = "Updated to 0.1.15"; },
  () => { state.shared["nocturne.toasts"] = [{ overlay: "o3", action: null, at: Date.now() }];
    state.shared["scripts.ended"] = { r1: { address: "r1", labels: { "nocturne.script": "test" }, state: "finished", exit_code: 1, finished_ms: 5 } };
    state.updates = { app: { ready: "9.9.9", updates: true }, core: { ready: "1.2.3", managed: null }, checks: true }; },
  ...[["editor", "/src/a.md"], ["browser"], ["markdown"], ["preview"], ["agent-graph"], ["usage"], ["file-tree"]].map(([mod, path]) => () => {
    state.panes = [{ pane: "p1", tab: "c1", focused: true, cwd: "/src", terminal: null, mod, props: path ? { path } : {} }];
    state.focused = { pane: "p1", cwd: "/src" };
  }),
];

test("every command a person can trigger is in the palette or stays out with a reason", () => {
  const covered = new Set<string>();
  const bare = new Set<string>(); // shown as the command itself, with no arguments
  for (const set of COVER_STATES) {
    reset();
    state.commands = CORE;
    set();
    for (const { e } of open().rows()) {
      const v = Object.values(e.args)[0];
      covered.add(e.name);
      if (v === undefined) bare.add(e.name);
      if (e.bind) { covered.add(e.bind); bare.add(e.bind); }
      if (v !== undefined) covered.add(`${e.name}:${v}`);
    }
  }
  const items: [string, string, string?][] = [
    ...CORE.map((c): [string, string] => [c.name, "src/commands.rs"]),
    ...boundActions(),
    ...modCommands(),
  ];
  const missing = items.filter(([name, , family]) => !covered.has(name) && !(name in OUT) && !(name.split(":")[0] in OUT)
    && !(family && family in OUT_FAMILIES)).map(([name, from]) => `${name} (${from})`);
  expect([...new Set(missing)]).toEqual([]);
  // A reason for every name kept out, and nothing kept out that the list shows as itself.
  for (const [name, why] of Object.entries(OUT)) {
    expect(typeof why === "string" && why.length > 10).toBe(true);
    expect(bare.has(name) ? name : "").toBe("");
  }
  expect(existsSync(root + "defaults/mods/git/keys.ts")).toBe(true);
});
