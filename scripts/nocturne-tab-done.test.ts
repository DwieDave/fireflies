// Item 29: a tab whose terminal runs an agent wears that agent's winged mark
// (winged.ts statusMark, as its firefly in the sidebar), and when the agent is
// done the sidebar's check on it; with several agents in one tab, the mark is
// the one the tab's status comes from (the most urgent, as the sidebar ranks
// them first). A tab without an agent keeps its program's icon.
// herdr and gpui stand-ins (mock.module is process-wide: this file runs alone).
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
/** The svg paths drawn since the last reset, and the words drawn (strings handed to child()). */
let drawn: string[] = [];
let words: string[] = [];
const el: any = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined : (...a: any[]) => {
    if (k === "child" && typeof a[0] === "string") words.push(a[0]);
    if (k === "when" && a[0]) a[1](el);
    if (k === "map") return a[0](el);
    return el;
  }),
  apply: () => el,
});
mock.module("gpui-kit", () => ({ View: class {}, div: () => el, svg: (path: string) => { drawn.push(path); return el; }, image: () => el, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
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


const { default: Tabs } = await import("../defaults/mods/nocturne/tabs.ts");
const { statusMark } = await import("../defaults/mods/nocturne/winged.ts");
const CHECK_PATH = "mods/workspace-chrome/check.svg";

const CLAUDE = "mods/nocturne/art/logo-claude.svg";
const CODEX = "mods/nocturne/art/logo-codex.svg";
const WINGS = "mods/nocturne/art/wings.svg";

const agentPane = (pane: string, tab: string, key: string, status: string) =>
  ({ pane, tab, terminal: `t-${pane}`, mod: null, title: key, focused: false, parked: false, status, program: { key, name: key, agent: true, icon: null, tint: true } });
const tab = (id: string, status: string | null) => ({ id, index: 1, active: true, name: id, named: false, status });
const strip: any = { drag: null, pressed: null, at: () => false };
const draw = (c: any) => Tabs.prototype.tabItem.call(strip, theme, c, spacesNow[0], null);

beforeEach(() => {
  sharedState = {}; commands = []; drawn = []; words = [];
  spacesNow = [{ id: "s1", name: "one", active: true, tabs: [] }];
  panesNow = []; agentsNow = []; terminalsNow = []; focusedNow = null;
});

test("a done agent's tab: its own mark with the wings and the sidebar's check", () => {
  panesNow = [agentPane("p1", "c1", "claude", "done")];
  draw(tab("c1", "done"));
  expect(drawn).toEqual([WINGS, CLAUDE, CHECK_PATH]);
});

test("working, blocked and resting agents' tabs: the mark without the check", () => {
  for (const st of ["working", "blocked", "idle"]) {
    drawn = [];
    panesNow = [agentPane("p1", "c1", "codex", st)];
    draw(tab("c1", st));
    expect(drawn).toEqual([WINGS, CODEX]);
  }
});

test("two agents in a tab: the mark of the one the tab's status comes from", () => {
  panesNow = [agentPane("p1", "c1", "claude", "working"), agentPane("p2", "c1", "codex", "done")];
  draw(tab("c1", "done"));
  expect(drawn).toEqual([WINGS, CODEX, CHECK_PATH]);
  drawn = [];
  panesNow = [agentPane("p1", "c1", "claude", "idle"), agentPane("p2", "c1", "codex", "blocked")];
  draw(tab("c1", "blocked"));
  expect(drawn).toEqual([WINGS, CODEX]);
});

test("a tab without an agent keeps its program's icon and gets no check", () => {
  panesNow = [{ pane: "p1", tab: "c1", terminal: "t1", mod: null, title: "zsh", focused: false, parked: false, status: null, program: { key: "zsh", name: "zsh", agent: false, icon: "icons/zsh.svg", tint: true } }];
  draw(tab("c1", null));
  expect(drawn).toEqual(["icons/zsh.svg"]);
});

test("the pane header's mark is the same: done carries the check", () => {
  statusMark(theme, { program: { key: "pi" } }, "done", "h");
  expect(drawn).toEqual([WINGS, "mods/nocturne/art/logo-pi.svg", CHECK_PATH]);
});
