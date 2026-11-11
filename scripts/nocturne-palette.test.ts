// Nocturne's command palette (mods/nocturne/palette.js) through its real
// module graph: herdr and gpui are stand-ins, and its entries and rows are
// built in every state the "Open" group depends on (a folder or none, an agent
// focused and pinned or not, the git window and the pip player open or not).
// Its own process: mock.module is process-wide.
import { test, expect, mock } from "bun:test";

const GIT_WINDOW = "nocturne-git.window";
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
  });
}
reset();

const el: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : () => el), apply: () => el });
const herdr = {
  commands: () => [
    { name: "tab.new", args: [], about: "" },
    { name: "pane.split", args: [{ name: "direction" }], about: "" },
    { name: "files.open", args: [{ name: "path" }], about: "" },
    { name: "something.new", args: [], about: "a new command" },
  ],
  layouts: () => ["main", "nocturne"],
  keys: () => [{ section: "layout:nocturne", action: "nocturne.files", keys: "secondary-e" }],
  run: () => {}, theme: () => new Proxy({}, { get: () => "#808080" }), props: () => ({ overlay: "o1" }),
  closeOverlay: () => {}, openOverlay: () => {},
  shared: (k: string) => state.shared[k] ?? null, setShared: (k: string, v: unknown) => { state.shared[k] = v; },
  window: () => ({ platform: state.platform }), settings: () => ({ zoom: 0.9 }),
  agents: () => state.agents, focused: () => state.focused, spaces: () => state.spaces, panes: () => state.panes,
  terminals: () => state.terminals, hc: async () => ({ code: 0, stdout: "", stderr: "" }), exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  home: () => "/home/me", appHome: () => "/home/me/.config/herdr-app", notify: () => {}, pickFolder: async () => null,
  knownAgents: () => [], setAgentOrder: () => {}, nextCommand: () => null, presentUpdateNotes: () => {}, updates: () => null,
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ div: () => el, svg: () => el, image: () => el, View: class {}, PathBuilder: { fill: () => el, stroke: () => el }, Background: { checkerboard: () => el } }));
class Input { on() { return true; } value() { return ""; } set_value() {} focus() {} release() { return true; } }
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, Scrollbar: { vertical: () => el },
  v_virtual_list: () => el, VirtualListScrollHandle: { new: () => ({ scroll_to_item() {}, release() {} }) },
  InputState: { new: () => new Input() }, Input: { new: () => el },
}));
globalThis.window = { paint_path: () => el } as any;
globalThis.localStorage = { getItem: () => null, setItem: () => {} } as any;

const { default: Palette } = await import("../defaults/mods/nocturne/palette.js");
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
  ["the pip player open", () => { state.shared["nocturne-pip.player"] = { t: 1 }; }],
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
