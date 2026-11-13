// The floating tool windows driven by their keys, as the app drives them:
// the GitHub window (main.js and its tabs), the scripts deck, the
// notifications overview and the picture-in-picture player. herdr and gpui
// are stand-ins; what a key does is read back from the view's state and the
// commands it ran. Its own process: it stands in for "herdr".
import { test, expect, mock, beforeEach } from "bun:test";

let sharedState: Record<string, unknown> = {};
let ran: [string, unknown][] = [];
let closed: unknown[] = [];
let propsNow: any = {};
let terms: any[] = [];
const execs: unknown[][] = [];
mock.module("herdr", () => ({
  agents: () => [], appHome: () => "/tmp/herdr-test", home: () => "/home/me",
  closeOverlay: (id: unknown) => { closed.push(id); return null; }, openOverlay: () => "o9",
  exec: async (...a: unknown[]) => { execs.push(a); return { code: 1, stdout: "", stderr: "" }; },
  focused: () => null, hc: async () => ({ code: 1, stdout: "" }), keys: () => [], layout: () => null,
  nextCommand: () => new Promise(() => {}), notify: () => null, panes: () => [], props: () => propsNow,
  readTextFile: async () => null, writeTextFile: async () => null,
  run: (name: string, args: unknown) => { ran.push([name, args]); return null; },
  settings: () => ({ zoom: 1 }), shared: (k: string) => sharedState[k] ?? null, setShared: (k: string, v: unknown) => { sharedState[k] = v; return null; },
  spaces: () => [], terminals: () => terms, theme: () => theme, window: () => ({ platform: "linux" }),
  nativeView: undefined, nextNativeViewEvent: () => new Promise(() => {}), nativeViewCall: () => null,
}));
const el: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : () => el), apply: () => el });
class View {}
mock.module("gpui-kit", () => ({ View, div: () => el, svg: () => el, image: () => el, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} release() { return true; } set_auto_grow() {} }
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, v_virtual_list: () => el, TextView: { markdown: () => el },
  VirtualListScrollHandle: { new: () => ({ scroll_to_item() {}, release() {} }) }, ScrollHandle: { new: () => ({ scroll_to_item() {}, release() {} }) },
  InputState: { new: () => new Input() }, Input: { new: () => el }, TextareaState: { new: () => new Input() }, Textarea: { new: () => el },
}));
globalThis.window = { paint_path: () => el } as any;
const theme: any = new Proxy({}, { get: () => "#808080" });

let focusedCount = 0;
const handle = () => ({ focus() { focusedCount++; }, is_focused: () => false, release: () => true });
const cx: any = {
  focus_handle: handle, spawn() {}, notify() {}, stop_propagation() { this.stopped = true; },
  timer: { after() {}, every() {} }, bind_keys() {}, open_url() {},
};
const key = (k: string, mods: Record<string, boolean> = {}, char?: string) => ({ key: k, key_char: char ?? (k.length === 1 ? k : undefined), modifiers: { shift: false, control: false, platform: false, alt: false, ...mods } });

beforeEach(() => { sharedState = {}; ran = []; closed = []; propsNow = {}; terms = []; execs.length = 0; cx.stopped = false; focusedCount = 0; });

// ---- GitHub

const { default: GitHub } = await import("../defaults/mods/github/main.js");
const { linksIn } = await import("../defaults/mods/github/model.ts");

function github(tab = "prs") {
  propsNow = { folder: "/src", overlay: "o1", tab };
  const g: any = new GitHub();
  g.init({}, cx);
  g.state = "ready";
  g.repo = { full: "me/fork", host: "github.com", root: "/src", url: "https://github.com/me/fork", parent: "up/stream" };
  return g;
}

test("linksIn finds markdown links and bare URLs once, without images or code", () => {
  const got = linksIn(["See [the docs](https://a.dev/docs) and https://x.y/z.\n![pic](https://img/p.png)\n```\nhttps://in.code\n```", "again https://x.y/z and <https://b.dev>"]);
  expect(got).toEqual([{ url: "https://a.dev/docs", label: "the docs" }, { url: "https://x.y/z", label: "https://x.y/z" }, { url: "https://b.dev", label: "https://b.dev" }]);
});

test("GitHub: L lists the shown PR's links; j and enter open the second; esc closes the list", () => {
  const g = github();
  g.prs.list = [{ number: 7, title: "x" }];
  g.prs.details.set(7, { pr: { body: "[one](https://one.dev) https://two.dev", comments: [{ body: "and [three](https://three.dev)" }], reviews: [] }, review: [] });
  let opened = "";
  g.openUrl = (u: string) => { opened = u; };
  g.key(key("L", { shift: true }), cx);
  expect(g.picker.rows.map((r: any) => r.label)).toEqual(["one", "https://two.dev", "three"]);
  g.key(key("j"), cx);
  g.key(key("enter"), cx);
  expect(opened).toBe("https://two.dev");
  expect(g.picker).toBeNull();
  g.key(key("L", { shift: true }), cx);
  g.key(key("escape"), cx);
  expect(g.picker).toBeNull();
  expect(closed).toEqual([]); // esc closed the list, not the window
});

test("GitHub: L with nothing to link says so instead of an empty list", () => {
  const g = github();
  g.prs.list = [{ number: 7 }];
  g.key(key("L", { shift: true }), cx);
  expect(g.picker).toBeNull();
  expect(g.note.text).toMatch(/No links/);
});

test("GitHub: F switches to the fork's parent on every tab, p only off Projects", () => {
  const g = github("projects");
  g.key(key("p"), cx);
  expect(g.switching).toBeFalsy();
  g.key(key("F", { shift: true }), cx);
  expect(g.switching).toBe(true);
  expect(g.note.text).toBe("Opening up/stream…");
});

test("GitHub: shift-tab walks the panels backwards on PRs and Actions", () => {
  const g = github();
  g.prs.list = [{ number: 1 }];
  expect(g.prs.focus).toBe("list");
  g.key(key("tab", { shift: true }), cx);
  expect(g.prs.focus).toBe("main");
  g.key(key("tab"), cx);
  expect(g.prs.focus).toBe("list");
  g.key(key("2"), cx);
  expect(g.tab).toBe("actions");
  g.key(key("tab", { shift: true }), cx);
  expect(g.actions.focus).toBe("log");
});

test("GitHub: esc and q close the window from its top level", () => {
  const g = github();
  g.key(key("q"), cx);
  expect(closed).toEqual(["o1"]);
});

// ---- the scripts deck

const { default: Deck } = await import("../defaults/mods/scripts/main.js");

function deck(scripts: [string, string][]) {
  propsNow = { overlay: "d1" };
  const d: any = new Deck();
  d.init({}, cx);
  d.scripts = scripts.map(([group, name], i) => ({ id: `${group}:${name}`, name, group, runner: group, cmd: `${group} ${name}` }));
  d.looking = false;
  d.render();
  return d;
}
const press = (d: any, k: string, mods: Record<string, boolean> = {}, char?: string) => { d.render(); d.onKey(key(k, mods, char), cx, d.items); };

test("deck: g G jump to the ends, tab and shift-tab to the next and previous group", () => {
  const d = deck([["just", "a"], ["just", "b"], ["npm", "c"], ["npm", "d"], ["make", "e"]]);
  expect(d.cursor).toBe(0);
  press(d, "g", { shift: true }, "G");
  expect(d.cursor).toBe(4);
  press(d, "g");
  expect(d.cursor).toBe(0);
  press(d, "tab");
  expect(d.items[d.cursor].row.s.name).toBe("c");
  press(d, "tab");
  expect(d.items[d.cursor].row.s.name).toBe("e");
  press(d, "tab", { shift: true });
  expect(d.items[d.cursor].row.s.name).toBe("c");
});

test("deck: ? shows the keys and esc puts them away; q closes the deck", () => {
  const d = deck([["just", "a"]]);
  press(d, "?", { shift: true }, "?");
  expect(d.help).toBe(true);
  press(d, "escape");
  expect(d.help).toBe(false);
  press(d, "q");
  expect(closed).toEqual(["d1"]);
});

test("deck: letters are the filter's while typing, so q and ? go into it", () => {
  const d = deck([["just", "quit"]]);
  press(d, "/");
  press(d, "q");
  press(d, "?", { shift: true }, "?");
  expect(d.query).toBe("q?");
  expect(closed).toEqual([]);
});

test("deck: an ended run's output scrolls by keys, esc goes back to the list", () => {
  const d = deck([["just", "a"]]);
  d.output = { r: { name: "x", address: "t1" }, lines: Array.from({ length: 100 }, (_, i) => `line ${i}`), back: 0, shown: 10, placed: true };
  press(d, "k");
  expect(d.output.back).toBe(1);
  press(d, "pageup");
  expect(d.output.back).toBe(10);
  press(d, "g");
  expect(d.output.back).toBe(90);
  press(d, "g", { shift: true }, "G");
  expect(d.output.back).toBe(0);
  press(d, "escape");
  expect(d.output).toBeNull();
});

// ---- the notifications overview

const { default: Overview } = await import("../defaults/mods/notifications/overview.js");

test("overview: q closes, up / down move between requests that have no options", () => {
  propsNow = { overlay: "n1" };
  const o: any = new Overview();
  o.init({}, cx);
  const list = [{ id: "a", type: "other", status: "blocked" }, { id: "b", type: "question" }];
  o.list = () => list;
  o.sel = "a";
  o.key(key("down"), cx);
  expect(o.sel).toBe("b");
  o.key(key("up"), cx);
  expect(o.sel).toBe("a");
  o.key(key("q"), cx);
  expect(closed).toEqual(["n1"]);
});

test("overview: ? shows its keys, ? or esc hides them (esc then closes)", () => {
  propsNow = { overlay: "n1" };
  const o: any = new Overview();
  o.init({}, cx);
  o.list = () => [{ id: "a", type: "other", status: "blocked" }];
  o.sel = "a";
  o.key(key("/", { shift: true }, "?"), cx);
  expect(o.keysShown).toBe(true);
  o.key(key("/", { shift: true }, "?"), cx);
  expect(o.keysShown).toBe(false);
  o.key(key("/", { shift: true }, "?"), cx);
  o.key(key("escape"), cx);
  expect(o.keysShown).toBe(false);
  expect(closed).toEqual([]);
  o.key(key("escape"), cx);
  expect(closed).toEqual(["n1"]);
});

// ---- picture in picture (the rest of its keys: browser.test.ts)

const { keyControl } = await import("../defaults/mods/pip/main.ts");

test("pip: esc gives the keyboard back; command keys stay the app's", () => {
  expect(keyControl(key("escape"))).toBe("unfocus");
  expect(keyControl(key("k", { platform: true }))).toBeNull();
});
