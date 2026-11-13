// Opening the scratchpad (nocturne/scratchpad.js) the three ways: the
// palette, the "+ new" menu's tile, and its command (cmd-shift-;, what
// sky.js's command loop runs). The palette and the menu close their own
// overlay on a pick, and the app leaves a promise pending when its copy is
// gone: so they must only run the command, never await git themselves; the
// sidebar's copy finds the note and opens it, and says why in a toast when it
// can't. herdr and gpui are stand-ins (mock.module is process-wide: this file
// runs alone).
import { test, expect, mock, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";

const el: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : () => el), apply: () => el });
let ran: [string, any][] = [];
let notes: any[] = [];
let execCalls: any[] = [];
let execImpl: (cmd: string, args: string[], o: any) => Promise<any> = async () => ({ code: 0, stdout: "", stderr: "" });
let files: Record<string, string> = {};
// The module's functions are read once (mock.module copies them): these let a test swap one.
const RUN = (name: string, args?: any) => { ran.push([name, args]); return null; };
let runImpl: (name: string, args?: any) => any = RUN;
let appHomeImpl = () => "/Users/dev/.config/herdr-app";
let sharedState: Record<string, unknown> = {};
let closed: string[] = [];
let focusedPane: any = { pane: "p1", tab: "c1", focused: true, cwd: "/wt/app-feature", terminal: "t1" };
const herdr: Record<string, any> = {
  commands: () => [], layouts: () => ["nocturne"], keys: () => [{ section: "global", action: "nocturne.scratchpad", keys: "cmd-shift-;" }],
  run: (name: string, args?: any) => runImpl(name, args),
  notify: (n: any) => { notes.push(n); return "n1"; },
  exec: (cmd: string, args: string[], o: any) => { execCalls.push([cmd, args, o]); return execImpl(cmd, args, o); },
  readTextFile: async (p: string) => files[p] ?? null,
  writeTextFile: async (p: string, t: string) => { files[p] = t; return null; },
  appHome: () => appHomeImpl(), home: () => "/Users/dev",
  theme: () => new Proxy({}, { get: () => "#808080" }), props: () => ({ overlay: "o1", role: "new" }),
  closeOverlay: (id: string) => { closed.push(id); }, openOverlay: () => "o2",
  shared: (k: string) => sharedState[k] ?? null, setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  window: () => ({ platform: "macos" }), settings: () => ({ zoom: 0.9 }),
  agents: () => [], terminals: () => [{ address: "t1", state: "live", labels: {} }],
  focused: () => ({ pane: focusedPane?.pane, cwd: focusedPane?.cwd, terminal: focusedPane?.terminal }),
  spaces: () => [{ id: "s1", active: true, folder: "/code/app", machine: null, tabs: [{ id: "c1", active: true }] }],
  panes: () => (focusedPane ? [focusedPane] : []),
  hc: async () => ({ code: 0, stdout: "", stderr: "" }), pickFolder: async () => null, knownAgents: async () => [],
  setAgentOrder: () => {}, nextCommand: () => new Promise(() => {}), presentUpdateNotes: () => {}, updates: () => null,
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ div: () => el, svg: () => el, image: () => el, View: class {}, PathBuilder: { fill: () => el, stroke: () => el }, Background: { checkerboard: () => el } }));
class Input { on() { return true; } value() { return ""; } set_value() {} focus() {} release() { return true; } }
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, Scrollbar: { vertical: () => el, new: () => el },
  v_virtual_list: () => el, VirtualListScrollHandle: { new: () => ({ scroll_to_item() {}, release() {} }) },
  InputState: { new: () => new Input() }, Input: { new: () => el }, ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
}));
(globalThis as any).window = { paint_path: () => el, viewport_size: () => ({ width: 1600, height: 1000 }) };
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} };

const { default: Palette } = await import("../defaults/mods/nocturne/palette.js");
const { default: NewMenu } = await import("../defaults/mods/nocturne/newmenu.ts");
const { openScratchpad, askScratchpad } = await import("../defaults/mods/nocturne/scratchpad.ts");
const cx: any = { notify() {}, focus_handle: () => ({ focus() {} }), timer: { after() {}, every() {} }, spawn() {}, stop_propagation() {}, bind_keys() {} };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

/** git as it answers in a linked worktree: the main repository's common dir. */
const gitWorks = async () => ({ code: 0, stdout: "/code/app/.git\n", stderr: "" });

beforeEach(() => {
  ran = []; notes = []; execCalls = []; files = {}; sharedState = {}; closed = [];
  execImpl = gitWorks;
  focusedPane = { pane: "p1", tab: "c1", focused: true, cwd: "/wt/app-feature", terminal: "t1" };
});

const keyEv = (k: string, mods: any = {}) => ({ key: k, key_char: k.length === 1 ? k : null, modifiers: { shift: false, control: false, alt: false, platform: false, ...mods } });

test("the palette's Scratchpad closes the palette and runs the command: no git awaited in the palette's own copy", async () => {
  const p: any = new Palette();
  p.init({}, cx);
  p.query = "scratchpad";
  const rows = p.rows();
  const first = rows[0].e;
  expect(first.title).toBe("Scratchpad");
  expect(first.bind).toBe("nocturne.scratchpad");
  p.go(first);
  expect(closed).toEqual(["o1"]);
  expect(ran).toEqual([["nocturne.scratchpad", undefined]]);
  await flush();
  expect(execCalls).toEqual([]);
  // In a new tab: its own command.
  ran = [];
  p.query = "scratchpad tab";
  const tab = p.rows().find((r: any) => r.e.title === "Scratchpad in a new tab").e;
  expect(tab.bind).toBe("nocturne.scratchpad-tab");
  p.go(tab);
  expect(ran).toEqual([["nocturne.scratchpad-tab", undefined]]);
});

test("the + new menu's Scratchpad tile: a click, its letter s, enter on it; the landing spot picks the command", async () => {
  const m: any = new NewMenu();
  m.init({ role: "new" }, cx);
  m.render(cx);
  // Its letter (the menu's key handler finds the tile by it).
  const items = (await import("../defaults/mods/nocturne/newmenu.ts")).menuPanels();
  const tile = items.find((x: any) => x.id === "scratchpad");
  expect(tile).toMatchObject({ name: "Scratchpad", key: "s", icon: "mods/nocturne/art/scratchpad.svg" });
  const liveItems = items.map((p: any) => ({ kind: "tile", id: p.id, p, key: p.key }));
  m.key(keyEv("s"), cx, liveItems);
  expect(ran).toEqual([["nocturne.scratchpad", undefined]]);
  // shift: the other landing spot (a tab).
  ran = [];
  m.key(keyEv("s", { shift: true }), cx, liveItems);
  expect(ran).toEqual([["nocturne.scratchpad-tab", undefined]]);
  // A click picks it as well, at the switch's landing spot.
  ran = [];
  m.pick(liveItems.find((x: any) => x.id === "scratchpad"), "pane", cx);
  expect(ran).toEqual([["nocturne.scratchpad", undefined]]);
  await flush();
  expect(execCalls).toEqual([]);
  // The old row under the worktrees is gone: one place.
  expect(readFileSync("defaults/mods/nocturne/newmenu.ts", "utf8")).not.toContain('id: "scratchpad"');
});

test("the command (cmd-shift-;, and what the palette and menu run) reaches the sidebar's loop, which opens the note", () => {
  const sky = readFileSync("defaults/mods/nocturne/sky.js", "utf8");
  expect(sky).toMatch(/c === "scratchpad" \|\| c === "scratchpad-tab"\) openScratchpad\(c === "scratchpad-tab"\)/);
  expect(JSON.parse(readFileSync("defaults/keys.macos.json", "utf8"))).toBeTruthy();
  expect(readFileSync("defaults/keys.macos.json", "utf8")).toContain('"cmd-shift-;": "nocturne.scratchpad"');
});

test("git works: a linked worktree's terminal opens the repository's note beside it", async () => {
  const path = await openScratchpad();
  expect(execCalls[0][2]).toMatchObject({ cwd: "/wt/app-feature" });
  expect(path).toMatch(/^\/Users\/dev\/\.config\/herdr-app\/scratchpad\/app-[0-9a-f]{8}\.md$/);
  expect(ran).toEqual([["editor.open", { path, pane: "p1" }]]);
  expect(notes).toEqual([]);
  // In a tab of its own.
  ran = [];
  await openScratchpad(true);
  expect(ran).toEqual([["editor.open", { path, in: "tab" }]]);
});

test("git fails (missing, timed out): the folder's own note opens, and a toast says why", async () => {
  execImpl = async () => { throw new Error("exec timed out after 10s"); };
  const path = await openScratchpad();
  expect(path).toMatch(/\/scratchpad\/app-feature-[0-9a-f]{8}\.md$/);
  expect(ran[0][0]).toBe("editor.open");
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({ level: "warning", title: "scratchpad: git didn't answer" });
  expect(notes[0].body).toContain("timed out");
});

test("a folder outside git is no failure: its own note, no toast", async () => {
  execImpl = async () => ({ code: 128, stdout: "", stderr: "fatal: not a git repository" });
  await openScratchpad();
  expect(ran[0][0]).toBe("editor.open");
  expect(notes).toEqual([]);
});

test("anything else that fails says so in a toast, never nothing", async () => {
  appHomeImpl = () => { throw new Error("no app folder"); };
  try {
    expect(await openScratchpad()).toBeNull();
  } finally { appHomeImpl = () => "/Users/dev/.config/herdr-app"; }
  expect(ran).toEqual([]);
  expect(notes[0]).toMatchObject({ level: "error", title: "couldn't find the scratchpad", body: "no app folder" });
  // editor.open refused synchronously (a refusal after it comes back as the app's own "… failed" toast).
  notes = [];
  runImpl = () => { throw new Error("no pane to split"); };
  try {
    expect(await openScratchpad()).toBeNull();
  } finally { runImpl = RUN; }
  expect(notes[0]).toMatchObject({ level: "error", title: "couldn't open the scratchpad" });
});

test("askScratchpad runs the command, nothing more", () => {
  askScratchpad();
  askScratchpad(true);
  expect(ran).toEqual([["nocturne.scratchpad", undefined], ["nocturne.scratchpad-tab", undefined]]);
  expect(execCalls).toEqual([]);
});
