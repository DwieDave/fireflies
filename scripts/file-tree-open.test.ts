import { test, expect, beforeEach } from "bun:test";
import { importMod } from "./mod-source.ts";

// Where a file a files pane opens goes (file-tree/routing.ts, opening.ts):
// a preview file in the files pane's own preview pane unless its own editor
// is there; a text file in the editor, which takes the preview pane's place
// (the picture its first tab) when the files pane has a preview pane and no
// editor. The preview pane's side: shared `preview.show` for its slot
// (preview/main.ts). The panes the app would make are added to `world` by
// hand, as the app would answer the commands.
class Element {
  calls: [string, any[]][] = [];
  nodes: any[] = [];
  constructor(public kind = "div") {
    return new Proxy(this, {
      get: (target, key: string, proxy) => key in target ? (target as any)[key] : (...args: any[]) => {
        if (key === "child") target.nodes.push(args[0]);
        else if (key === "children") target.nodes.push(...args[0]);
        else if (key === "when") { if (args[0]) args[1](proxy); }
        else target.calls.push([key, args]);
        return proxy;
      },
    });
  }
}

const commands: [string, any][] = [];
const world: { panes: any[]; spaces: any[]; shared: Record<string, any>; props: any } = { panes: [], spaces: [], shared: {}, props: {} };
const herdr: any = {
  props: () => world.props, theme: () => new Proxy({}, { get: () => "#808080" }), settings: () => ({ zoom: 1, editor: {} }),
  exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  panes: () => world.panes, spaces: () => world.spaces, terminals: () => [] as any[], focused: () => null,
  shared: (k: string) => world.shared[k] ?? null, setShared: (k: string, v: any) => { world.shared[k] = v; return null; },
  readTextFile: async () => null, writeTextFile: async () => null, watchFolder: () => new Promise(() => {}), nextCommand: () => new Promise(() => {}),
  nextNativeViewEvent: () => Promise.reject(new Error("none")), nativeViewCapabilities: () => ({ available: false }),
  home: () => "/home/me", appHome: () => "/home/me/.config/herdr-app", window: () => ({ platform: "macos" }), appWindow: () => ({ platform: "macos" }),
};
const kit = { View: class {}, div: () => new Element(), svg: () => new Element("svg"), image: () => new Element("image"), PathBuilder: { fill: () => new Element() }, Background: { checkerboard: () => ({}) } };
const base = {
  h_flex: () => new Element(), v_flex: () => new Element(), v_virtual_list: () => new Element(), Scrollbar: { vertical: () => new Element() },
  VirtualListScrollHandle: { new: () => ({ scroll_to_item() {} }) }, InputState: { new: () => ({ on() {}, value: () => "", set_value() {}, focus() {}, set_selected_range() {} }) },
  Input: { new: () => new Element("input") }, TextView: { markdown: () => new Element("markdown") },
};
const standins = { herdr, "gpui-kit": kit, "gpui-base": base, "gpui-shell": {} };
(globalThis as any).window = { paint_path: () => new Element() };
const { default: Files } = await importMod("file-tree/main.ts", standins, { "./viewer.ts": { default: class {} } });
const { isPreviewFile } = await importMod("file-tree/state.ts", standins);

const cx: any = { notify() {}, stop_propagation() {}, timer: { after() {} } };
const PIC = "/repo/shots/a.png";

/** A files pane (slot `f1`, docked beside a terminal) on /repo. */
function filesPane(slot = "f1"): any {
  const view: any = new Files();
  Object.assign(view, { root: "/repo", on: null, slot, handle: { focus() {} }, folders: new Set(), lastClick: null, alt: false });
  view.rows = () => ["shots/a.png", "shots/b.png", "docs/r.pdf", "main.rs", "README.md", "data/t.csv"].map((path) => ({ path, dir: false, depth: 1 }));
  return view;
}
const dbl = (v: any, path: string) => { v.pick(path, cx); v.pick(path, cx); };
const lastOf = (name: string) => commands.filter(([c]) => c === name).at(-1)?.[1];
/** The app's answer to preview.open / editor.open / pane.split: the pane it makes. */
const preview = (pane: string, slot: string, path: string) => world.panes.push({ pane, tab: "tab1", mod: "preview", props: { path, slot, on: null } });
const editor = (pane: string, slot: string, path: string, extra: any = {}) => world.panes.push({ pane, tab: "tab1", mod: "editor", props: { path, slot, ...extra } });

beforeEach(() => {
  commands.length = 0;
  world.shared = {};
  world.spaces = [{ active: true, tabs: [{ id: "tab1", active: true }, { id: "tab2", active: false }] }];
  world.panes = [{ pane: "p1", tab: "tab1", terminal: "t1" }, { pane: "pf", tab: "tab1", mod: "file-tree", props: { folder: "/repo", slot: "f1" } }];
});

test("preview files are what the preview draws and the editor doesn't edit", () => {
  expect(["a.png", "logo.SVG", "r.pdf", "app.sqlite", "f.woff2", "c.mov", "s.mp3"].map(isPreviewFile)).toEqual([true, true, true, true, true, true, true]);
  expect(["main.rs", "README.md", "t.csv", "x.patch", "a.json"].map(isPreviewFile)).toEqual([false, false, false, false, false]);
});

test("rule 1: a picture with no editor of this files pane's opens in a preview pane; a second one in that same pane", () => {
  const v = filesPane();
  dbl(v, "shots/a.png");
  expect(commands).toEqual([["preview.open", { path: PIC, pane: "p1" }]]);
  expect(world.shared["file-tree.opened"]).toEqual({ f1: { editor: null, preview: { path: PIC } } });
  preview("pv", "link-1", PIC);
  world.shared["preview.paths"] = { "link-1": PIC };
  // The second picture: the same pane shows it (preview.show for its slot), no new pane.
  commands.length = 0;
  dbl(v, "shots/b.png");
  expect(commands).toEqual([["pane.focus", { pane: "pv" }]]);
  expect(world.shared["preview.show"]).toMatchObject({ slot: "link-1", path: "/repo/shots/b.png", n: 1 });
  expect(world.shared["file-tree.opened"].f1.preview).toEqual({ slot: "link-1" });
  // A PDF too; the picture it shows already: only the focus.
  world.shared["preview.paths"] = { "link-1": "/repo/shots/b.png" };
  dbl(v, "docs/r.pdf");
  expect(world.shared["preview.show"]).toMatchObject({ slot: "link-1", path: "/repo/docs/r.pdf", n: 2 });
  world.shared["preview.paths"] = { "link-1": "/repo/docs/r.pdf" };
  commands.length = 0;
  dbl(v, "docs/r.pdf");
  expect(commands).toEqual([["pane.focus", { pane: "pv" }]]);
  expect(world.shared["preview.show"].n).toBe(2);
  expect(commands.some(([c]) => c === "editor.open")).toBe(false);
});

test("rule 1 holds beside another editor in the tab: one the files pane never sent files to isn't its own", () => {
  editor("e9", "other", "/repo/elsewhere.rs");
  world.shared["editor.paths"] = { other: ["/repo/elsewhere.rs"] };
  const v = filesPane();
  dbl(v, "shots/a.png");
  expect(commands).toEqual([["preview.open", { path: PIC, pane: "p1" }]]);
});

test("rule 2: an editor opened from this files pane first, then a picture: a new tab of that editor, drawn", () => {
  const v = filesPane();
  dbl(v, "main.rs");
  // No editor in the tab: a new one beside, noted by its file until its slot is seen.
  expect(commands).toEqual([["editor.open", { path: "/repo/main.rs", pane: "p1" }]]);
  expect(world.shared["file-tree.opened"].f1.editor).toEqual({ path: "/repo/main.rs" });
  editor("e1", "ed-1", "/repo/main.rs");
  world.shared["editor.paths"] = { "ed-1": ["/repo/main.rs"] };
  commands.length = 0;
  dbl(v, "shots/a.png");
  expect(commands).toEqual([["pane.focus", { pane: "e1" }]]);
  expect(world.shared["editor.open"]).toMatchObject({ slot: "ed-1", path: PIC, look: true });
  expect(world.shared["file-tree.opened"].f1.editor).toEqual({ slot: "ed-1" });
  // Enter and the menu's Open do the same.
  world.shared["editor.paths"] = { "ed-1": ["/repo/main.rs", PIC] };
  commands.length = 0;
  v.sel = "shots/b.png";
  v.key({ key: "enter", modifiers: {} }, cx);
  expect(world.shared["editor.open"]).toMatchObject({ slot: "ed-1", path: "/repo/shots/b.png", look: true });
  v.act("open", { path: "docs/r.pdf", dir: false }, cx);
  expect(world.shared["editor.open"]).toMatchObject({ slot: "ed-1", path: "/repo/docs/r.pdf", look: true });
  expect(commands.every(([c]) => c === "pane.focus")).toBe(true);
});

test("rule 3: a picture in the preview pane, then a text file: the editor takes the preview pane's place, the picture first, the text file second and shown", () => {
  const v = filesPane();
  dbl(v, "shots/a.png");
  preview("pv", "link-1", PIC);
  world.shared["preview.paths"] = { "link-1": PIC };
  commands.length = 0;
  dbl(v, "main.rs");
  const split = lastOf("pane.split");
  const slot = split.props.slot;
  expect(slot).toMatch(/^ed-/);
  // Split beside the preview pane, then the preview pane closes: the editor has its place.
  expect(commands).toEqual([
    ["pane.split", { direction: "auto", pane: "pv", mod: "editor", props: { path: PIC, slot, look: true } }],
    ["pane.close", { pane: "pv" }],
  ]);
  // The text file waits for the new editor, addressed to its slot (it opens it on its first frame, after the picture).
  expect(world.shared["editor.open"]).toMatchObject({ slot, path: "/repo/main.rs", n: 1 });
  expect(world.shared["editor.open"].look).toBeUndefined();
  expect(world.shared["file-tree.opened"].f1).toEqual({ editor: { slot }, preview: null });
  // From then on rule 2: the next picture is a tab of that editor.
  world.panes = world.panes.filter((p) => p.pane !== "pv");
  editor("e1", slot, PIC, { look: true });
  world.shared["editor.paths"] = { [slot]: [PIC, "/repo/main.rs"] };
  commands.length = 0;
  dbl(v, "shots/b.png");
  expect(commands).toEqual([["pane.focus", { pane: "e1" }]]);
  expect(world.shared["editor.open"]).toMatchObject({ slot, path: "/repo/shots/b.png", look: true });
});

test("rule 3 with Markdown (opened to look at) and with e (edited as text: Markdown's split)", () => {
  for (const [how, want] of [["dbl", { look: true }], ["e", { view: "split" }]] as const) {
    world.shared = {};
    world.panes = world.panes.filter((p) => p.mod !== "preview" && p.mod !== "editor");
    const v = filesPane();
    dbl(v, "shots/a.png");
    preview("pv", "link-1", PIC);
    commands.length = 0;
    if (how === "dbl") dbl(v, "README.md");
    else { v.sel = "README.md"; v.key({ key: "e", modifiers: {} }, cx); }
    expect(commands.map(([c]) => c)).toEqual(["pane.split", "pane.close"]);
    expect(world.shared["editor.open"]).toMatchObject({ path: "/repo/README.md", ...want });
  }
});

test("rule 3 when the preview pane shows the very file opened (a table it showed with p): one tab", () => {
  const v = filesPane();
  v.sel = "data/t.csv";
  v.key({ key: "p", modifiers: {} }, cx);
  expect(commands).toEqual([["preview.open", { path: "/repo/data/t.csv", pane: "p1" }]]);
  preview("pv", "link-2", "/repo/data/t.csv");
  commands.length = 0;
  dbl(v, "data/t.csv");
  expect(commands[0]).toEqual(["pane.split", { direction: "auto", pane: "pv", mod: "editor", props: { path: "/repo/data/t.csv", slot: commands[0][1].props.slot, look: true } }]);
  expect(world.shared["editor.open"]).toBeUndefined();
});

test("the editor closed again: rule 1 holds again; the preview pane closed by hand: the text file gets an editor of its own with one tab", () => {
  const v = filesPane();
  world.shared["file-tree.opened"] = { f1: { editor: { slot: "ed-1" }, preview: null } };
  // Its editor is gone: a picture opens in a preview pane.
  dbl(v, "shots/a.png");
  expect(commands).toEqual([["preview.open", { path: PIC, pane: "p1" }]]);
  // That preview pane never came (closed by hand): a text file opens a new editor, no split, no close.
  commands.length = 0;
  dbl(v, "main.rs");
  expect(commands).toEqual([["editor.open", { path: "/repo/main.rs", pane: "p1" }]]);
});

test("the same file twice: its tab (any editor of the tab holding it, a popped-out one too), or its preview pane, no second copy", () => {
  // A popped-out editor holds the picture: it shows it, and stays out of the files pane's own.
  editor("ep", "ed-pop", PIC, { popped: true, look: true });
  world.shared["editor.paths"] = { "ed-pop": [PIC] };
  const v = filesPane();
  dbl(v, "shots/a.png");
  expect(commands).toEqual([["pane.focus", { pane: "ep" }]]);
  expect(world.shared["editor.open"]).toMatchObject({ slot: "ed-pop", path: PIC });
  // Another picture: the popped tab takes no other files, so a preview pane.
  commands.length = 0;
  dbl(v, "shots/b.png");
  expect(commands).toEqual([["preview.open", { path: "/repo/shots/b.png", pane: "p1" }]]);
  // A text file with this pane's preview pane there, but held by an editor already: that editor, no swap.
  preview("pv", "link-1", "/repo/shots/b.png");
  world.panes.push({ pane: "e2", tab: "tab1", mod: "editor", props: { path: "/repo/main.rs", slot: "ed-2" } });
  world.shared["editor.paths"] = { "ed-pop": [PIC], "ed-2": ["/repo/main.rs"] };
  commands.length = 0;
  dbl(v, "main.rs");
  expect(commands).toEqual([["pane.focus", { pane: "e2" }]]);
});

test("each files pane has its own: another files pane's preview pane and editor aren't this one's; a pane in another tab isn't either", () => {
  world.shared["file-tree.opened"] = { f2: { editor: { slot: "ed-2" }, preview: { slot: "link-2" } } };
  world.panes.push({ pane: "pf2", tab: "tab1", mod: "file-tree", props: { path: "/repo", slot: "f2" } });
  editor("e2", "ed-2", "/repo/x.rs");
  preview("pv2", "link-2", "/repo/y.png");
  world.shared["editor.paths"] = { "ed-2": ["/repo/x.rs"] };
  const v = filesPane("f1");
  dbl(v, "shots/a.png");
  expect(commands).toEqual([["preview.open", { path: PIC, pane: "p1" }]]);
  expect(world.shared["file-tree.opened"].f2).toEqual({ editor: { slot: "ed-2" }, preview: { slot: "link-2" } });
  // f2's own: its preview pane, then (in another tab) none.
  const w = filesPane("f2");
  commands.length = 0;
  dbl(w, "shots/a.png");
  expect(commands).toEqual([["pane.focus", { pane: "e2" }]]);
  world.panes = world.panes.map((p) => (p.pane === "e2" || p.pane === "pv2" ? { ...p, tab: "tab2" } : p));
  commands.length = 0;
  dbl(w, "shots/b.png");
  expect(commands).toEqual([["preview.open", { path: "/repo/shots/b.png", pane: "p1" }]]);
});

test("p and the menu's 'Open in its viewer pane' stay an explicit preview pane, even with the files pane's editor there; alt-double-click the system's app", () => {
  editor("e1", "ed-1", "/repo/main.rs");
  world.shared["file-tree.opened"] = { f1: { editor: { slot: "ed-1" }, preview: null } };
  world.shared["editor.paths"] = { "ed-1": ["/repo/main.rs"] };
  const v = filesPane();
  v.sel = "shots/a.png";
  v.key({ key: "p", modifiers: {} }, cx);
  expect(commands).toEqual([["preview.open", { path: PIC, pane: "p1" }]]);
  commands.length = 0;
  v.alt = true;
  v.pick("shots/a.png", cx);
  v.pick("shots/a.png", cx);
  expect(commands).toEqual([["preview.open", { path: PIC, in: "system" }]]);
});

test("a files pane restarted keeps its own panes (shared file-tree.opened by its slot); a file on another machine goes to the viewer panes as before", () => {
  editor("e1", "ed-1", "/repo/main.rs");
  world.shared["file-tree.opened"] = { f1: { editor: { slot: "ed-1" }, preview: null } };
  world.shared["editor.paths"] = { "ed-1": ["/repo/main.rs"] };
  const v = filesPane();
  dbl(v, "shots/a.png");
  expect(world.shared["editor.open"]).toMatchObject({ slot: "ed-1", path: PIC, look: true });
  const box = filesPane();
  box.on = "box";
  commands.length = 0;
  dbl(box, "shots/a.png");
  expect(commands).toEqual([["preview.open", { path: PIC, pane: "p1", on: "box" }]]);
});

// ---- the preview pane: another file for its slot

test("the preview pane shows the file preview.show sends to its slot; another slot's, or one from before it started, is left alone", async () => {
  world.props = { path: PIC, slot: "link-1" };
  world.shared["preview.show"] = { slot: "link-1", path: "/repo/old.png", n: 4, at: 1 };
  const { default: PreviewView } = await importMod("preview/main.ts", standins);
  const pv: any = new PreviewView();
  const opened: string[] = [];
  pv.open = (path: string) => opened.push(path);
  const later: ((cx: any) => void)[] = [];
  const pcx: any = { notify() {}, timer: { after: (_ms: number, f: any) => later.push(f), every() {} }, spawn() {}, focus_handle: () => ({ focus() {}, is_focused: () => false }) };
  pv.init({}, pcx);
  const step = () => { try { pv.render(pcx); } catch { /* the viewer's drawing needs more stand-ins than this test gives */ } for (const f of later.splice(0)) f(pcx); };
  opened.length = 0;
  step();
  expect(opened).toEqual([]);
  world.shared["preview.show"] = { slot: "link-9", path: "/repo/x.png", n: 5, at: Date.now() };
  step();
  expect(opened).toEqual([]);
  world.shared["preview.show"] = { slot: "link-1", path: "/repo/shots/b.png", n: 6, at: Date.now() };
  step();
  step();
  expect(opened).toEqual(["/repo/shots/b.png"]);
});
