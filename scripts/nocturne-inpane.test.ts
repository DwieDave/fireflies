// Git, GitHub and the script runner opened as normal panes (nocturne/inpane.ts,
// docs/mods-in-panes.md): the command form nocturne.<mod>:pane | :tab |
// :window | {"as", folder?, on?}, the "+ new" tiles and the palette's
// "… in a pane". herdr and gpui are stand-ins (mock.module is process-wide:
// this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";

const el: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : () => el), apply: () => el });
let ran: [string, any][] = [];
let opened: any[] = [];
let sharedState: Record<string, unknown> = {};
let space: any = { id: "s1", active: true, attached: false, folder: "/code/app", machine: null, tabs: [{ id: "c1", active: true }] };
const herdr: Record<string, any> = {
  commands: () => [], layouts: () => ["nocturne"], keys: () => [],
  run: (name: string, args?: any) => { ran.push([name, args]); return null; },
  notify: () => "n1", exec: async () => ({ code: 1, stdout: "", stderr: "" }), readTextFile: async () => null, writeTextFile: async () => null,
  appHome: () => "/tmp/none", home: () => "/Users/dev",
  theme: () => new Proxy({}, { get: () => "#808080" }), props: () => ({ overlay: "o1", role: "new" }),
  closeOverlay: () => {}, openOverlay: (spec: any) => { opened.push(spec); return `o${opened.length + 1}`; },
  shared: (k: string) => sharedState[k] ?? null, setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  window: () => ({ platform: "macos" }), settings: () => ({ zoom: 0.9 }),
  agents: () => [], terminals: () => [],
  focused: () => ({ pane: "p1", cwd: "/code/app/src", terminal: "t1" }),
  spaces: () => [space],
  panes: () => [{ pane: "p1", tab: "c1", focused: true, cwd: "/code/app/src", terminal: "t1" }],
  hc: async () => ({ code: 1, stdout: "" }), pickFolder: async () => null, knownAgents: async () => [],
  nextCommand: () => new Promise(() => {}), setAgentOrder: () => {}, presentUpdateNotes: () => {},
  updates: () => ({ app: { version: "1.0", ready: null, updates: false }, core: { version: null, managed: null, ready: null, updating: false, error: null }, checked: null, checks: true, checking: false, notes: [] }),
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

const { parseAsk, openAs, openAsCommand } = await import("../defaults/mods/nocturne/inpane.ts");
const { menuPanels } = await import("../defaults/mods/nocturne/newmenu.ts");
const { panels } = await import("../defaults/mods/nocturne/panels.ts");

beforeEach(() => {
  ran = []; opened = []; sharedState = {};
  space = { id: "s1", active: true, attached: false, folder: "/code/app", machine: null, tabs: [{ id: "c1", active: true }] };
});

test("the value: pane, tab, window, or JSON {as, folder?, on?}; anything else is no ask", () => {
  expect(parseAsk("pane")).toEqual({ as: "pane" });
  expect(parseAsk(" tab ")).toEqual({ as: "tab" });
  expect(parseAsk("window")).toEqual({ as: "window" });
  expect(parseAsk('{"as":"pane","folder":"/r","on":"vps"}')).toEqual({ as: "pane", folder: "/r", on: "vps" });
  expect(parseAsk('{"as":"float"}')).toBe(null);
  expect(parseAsk("{oops")).toBe(null);
  expect(parseAsk("left")).toBe(null);
});

test("as a pane: beside the focused pane, a fresh slot, the folder a window would show", () => {
  openAs("git", { as: "pane" });
  const [name, args] = ran[0]!;
  expect(name).toBe("pane.split");
  expect(args).toMatchObject({ direction: "auto", pane: "p1", mod: "git", props: { folder: "/code/app/src" } });
  expect(args.props.slot).toMatch(/^[a-z0-9]{6,}$/);
  expect(args.props.on).toBeUndefined();
  // A space attached to a folder shows that repo; a machine goes along.
  space = { ...space, attached: true, folder: "/code/app", machine: "vps" };
  openAs("github", { as: "pane" });
  expect(ran[1]![1].props).toMatchObject({ folder: "/code/app", on: "vps" });
  // Two opens: two slots.
  expect(ran[1]![1].props.slot).not.toBe(args.props.slot);
});

test("as a tab: a tab of its own in the shown space, named after the mod; a folder asked for wins", () => {
  openAs("scripts", { as: "tab", folder: "/elsewhere", on: null });
  expect(ran[0]).toEqual(["tab.new", { space: "s1", name: "scripts", mod: "scripts", props: { slot: expect.any(String), folder: "/elsewhere" } }]);
});

test("as the window: opened, never toggled shut", () => {
  openAs("git", { as: "window" });
  expect(opened.at(-1)).toMatchObject({ mod: "git", kind: "window" });
  sharedState["git.window"] = { id: "o9", beat: Date.now() };
  const before = opened.length;
  openAs("git", { as: "window" });
  expect(opened.length).toBe(before);
});

test("the sky's commands: git / lazygit / github / scripts with a value open; others fall through", () => {
  expect(openAsCommand("git:pane")).toBe(true);
  expect(openAsCommand("lazygit:tab")).toBe(true);
  expect(openAsCommand('github:{"as":"pane"}')).toBe(true);
  expect(openAsCommand("scripts:pane")).toBe(true);
  expect(ran.map(([n, a]) => [n, a.mod])).toEqual([["pane.split", "git"], ["tab.new", "git"], ["pane.split", "github"], ["pane.split", "scripts"]]);
  expect(openAsCommand("git")).toBe(false);
  expect(openAsCommand("databases:pane")).toBe(false);
  expect(openAsCommand("git:sideways")).toBe(false);
});

test("+ new: Git, GitHub and Scripts are tiles that open a pane (or a tab), never the window", () => {
  const tiles = menuPanels().filter((p: any) => ["git", "github", "scripts"].includes(p.id));
  expect(tiles.map((p: any) => p.id)).toEqual(["git", "github", "scripts"]);
  for (const p of tiles) {
    expect(p.fixed).toBeUndefined();
    expect(p.open).toBeUndefined();
    ran = [];
    p.pane();
    expect(ran[0]).toMatchObject(["pane.split", { mod: p.id }]);
    ran = [];
    p.tab();
    expect(ran[0]).toMatchObject(["tab.new", { mod: p.id }]);
  }
  expect(opened).toEqual([]);
});

test("the palette's panels: a \"… in a pane\" entry beside the window and tab ones", async () => {
  expect(panels().filter((p: any) => p.beside).map((p: any) => p.id)).toEqual(["git", "github", "scripts"]);
  const { openEntries } = await import("../defaults/mods/nocturne/palette-open.ts");
  const list = openEntries();
  const titles = list.map((e: any) => e.title);
  for (const t of ["Git in a pane", "GitHub in a pane", "Scripts in a pane", "Git in a new tab", "Scripts in a new tab"]) expect(titles).toContain(t);
  // The script runner's window entry stays "Run a script…", not a second "Scripts".
  expect(titles).toContain("Run a script…");
  expect(titles).not.toContain("Scripts");
  ran = [];
  list.find((e: any) => e.title === "GitHub in a pane")!.go();
  expect(ran[0]).toMatchObject(["pane.split", { mod: "github" }]);
});
