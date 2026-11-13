// A database file leads to the Databases window (the contract: nocturne.databases:{kind, path}
// in the nocturne layout, else its window opened on it), only while the Databases mod is
// installed: the files pane's row menu ("Open in Databases", b) and the preview's table strip
// ("open in Databases"). herdr and gpui are stand-ins; its own process.
import { test, expect, mock } from "bun:test";

const ran: [string, any][] = [];
const opened: any[] = [];
let sharedState: Record<string, unknown> = {};
let installed = true;
mock.module("herdr", () => ({
  appHome: () => "/tmp/app", home: () => "/home/me",
  readTextFile: async (p: string) => (installed && p === "/tmp/app/mods/databases/mod.json" ? "{}" : null),
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), writeTextFile: async () => null,
  shared: (k: string) => sharedState[k] ?? null, setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  run: (name: string, args?: any) => { ran.push([name, args]); return null; },
  openOverlay: (spec: any) => { opened.push(spec); return "o1"; }, closeOverlay: () => null,
  settings: () => ({ zoom: 1 }), theme: () => theme, window: () => ({ platform: "linux" }), props: () => ({}),
  panes: () => [], spaces: () => [], focused: () => null, terminals: () => [], nextCommand: () => new Promise(() => {}),
  nativeViewCapabilities: () => ({ available: false, kinds: [] }), nativeViewCall: () => null, nativeView: () => null,
  watchFolder: () => null, highlight: () => [], languageOf: () => null, notify: () => null, keys: () => [],
}));
const drawn: string[] = [];
const el: any = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined
    : k === "when" ? (on: unknown, add: (e: unknown) => unknown) => (on ? add(el) : el)
    : k === "map" ? (f: (e: unknown) => unknown) => f(el)
    : (...args: any[]) => { for (const a of args) if (typeof a === "string") drawn.push(a); return el; }),
  apply: () => el,
});
mock.module("gpui-kit", () => ({ View: class {}, div: () => el, svg: () => el, img: () => el, image: () => el, canvas: () => el, PathBuilder: { fill: () => el, stroke: () => el }, Background: { checkerboard: () => el } }));
const any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : () => el), apply: () => el });
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, ScrollHandle: { new: () => ({ scroll_to_item() {} }) }, VirtualListScrollHandle: { new: () => ({ scroll_to_item() {} }) },
  InputState: { new: () => ({ on() {}, value: () => "" }) }, Input: { new: () => el }, EditorState: { new: () => ({ on() {} }) }, Editor: { new: () => el },
  TextView: any, Scrollbar: any, v_virtual_list: () => el,
}));
(globalThis as any).window = { paint_path: () => el };
const theme: any = new Proxy({}, { get: () => "#808080" });

const { hasDatabases, openInDatabases } = await import("../defaults/mods/preview/viewer-table.ts");
const { drawStrip } = await import("../defaults/mods/preview/viewer-bars.ts");
const { menuItems, isDatabaseFile } = await import("../defaults/mods/file-tree/logic.ts");

test("the files pane's menu: Open in Databases (b) on a database file, only with the mod installed", () => {
  const labels = (path: string, databases: boolean) => menuItems({ path, dir: false }, { databases }).map((x: any) => `${x.key} ${x.label}`);
  expect(labels("data/app.db", true)).toContain("b Open in Databases");
  expect(labels("data/app.sqlite3", true)).toContain("b Open in Databases");
  expect(labels("notes.txt", true)).not.toContain("b Open in Databases");
  expect(labels("data/app.db", false)).not.toContain("b Open in Databases");
  expect(menuItems({ path: "data", dir: true }, { databases: true }).map((x: any) => x.act)).not.toContain("databases");
  expect([isDatabaseFile("a.DB"), isDatabaseFile("a.db3"), isDatabaseFile("a.dbx")]).toEqual([true, true, false]);
});

test("installed is its mod.json there; the window opens on the file, read only, in nocturne by its command, else as its window", async () => {
  installed = true;
  expect(await hasDatabases()).toBe(true);
  installed = false;
  expect(await hasDatabases()).toBe(false);
  sharedState = { layout: "nocturne" };
  openInDatabases("/w/app.db", "the files pane");
  expect(ran.at(-1)).toEqual(['nocturne.databases:{"kind":"sqlite","path":"/w/app.db","readonly":true,"from":"the files pane"}', undefined]);
  sharedState = { layout: "main" };
  openInDatabases("/w/app.db", "the preview");
  expect(opened.at(-1)).toMatchObject({ mod: "databases", kind: "window", key: "databases", props: { connect: { kind: "sqlite", path: "/w/app.db", readonly: true, from: "the preview" } } });
});

test("the preview's table strip offers it for a database here, not without the mod", () => {
  const view: any = { chips: [], ring: null, focusedNow: false, db: { tables: [{ name: "lanterns", type: "table" }], at: 0 }, how: { how: "table" }, note: null, kind: "sqlite", dbMod: true, path: "/w/app.db", port: { width: 800, height: 600 } };
  drawn.length = 0;
  drawStrip(view, theme);
  expect(drawn).toContain("open in Databases");
  drawn.length = 0;
  drawStrip({ ...view, dbMod: false }, theme);
  expect(drawn).not.toContain("open in Databases");
});
