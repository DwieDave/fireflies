// The tab strip's drop-downs close on a second press of what opened them.
// Developer: "the dropdown menu on the git in the toolbar doesnt close if i click
// it again". A popup closes on any press beside it, and that same press goes on
// to the button, whose click opened the menu again. The git mark's ▾ (and a
// right-click on the git mark) now toggle its menu as "+ new", ▶ and the bell
// do: the press notes whether the menu was open, the click keeps it closed.
// Whether the popup's own close (Menu.closing) runs before or after the click,
// the menu ends closed. Stand-ins for herdr and gpui (mock.module is
// process-wide: this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";

class El {
  kids: any[] = [];
  calls: Record<string, any[][]> = {};
  constructor(public tag?: string) {
    return new Proxy(this, {
      get: (t, k: string, proxy) => k in t ? (t as any)[k] : k === "then" ? undefined : (...a: any[]) => {
        if (k === "child") t.kids.push(a[0]);
        else if (k === "children") t.kids.push(...a[0]);
        else if (k === "when") { if (a[0]) a[1](proxy); }
        else if (k === "map") return a[0](proxy);
        else (t.calls[k] ??= []).push(a);
        return proxy;
      },
    });
  }
}
const idOf = (e: any) => e?.calls?.id?.[0]?.[0];
function find(root: any, id: string): any {
  if (idOf(root) === id) return root;
  for (const k of root?.kids ?? []) { const f = find(k, id); if (f) return f; }
}
/** The handler an element registered for an event (and button). */
const handler = (el: any, name: string, button?: string) => (el.calls[name] ?? []).find((a: any[]) => button === undefined || a[0] === button)?.at(-1);

let store: Record<string, unknown> = {};
let overlays: { id: string; spec: any }[] = [];
let propsNow: any = { role: "tabs" };
let next = 0;
const PANES = [{ pane: "p1", tab: "t1", terminal: "a/1", focused: true, cwd: "/home/a" }];
mock.module("herdr", () => ({
  agents: () => [], appHome: () => "/tmp/app", commands: () => [],
  closeOverlay: (id: string) => { overlays = overlays.filter((o) => o.id !== id); return null; },
  openOverlay: (spec: any) => { const id = `o${++next}`; overlays.push({ id, spec }); return id; },
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => ({ space: "s1", tab: "t1", pane: "p1", terminal: "a/1" }),
  hc: async () => ({ code: 1, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: async () => [], layout: () => ({ id: "root", type: "block" }),
  layouts: () => ["nocturne"], nextCommand: () => new Promise<string>(() => {}), notify: () => {},
  panes: () => PANES, pickFolder: async () => null,
  presentUpdateNotes: () => {}, props: () => propsNow, run: () => null, setAgentOrder: () => {},
  setShared: (k: string, v: unknown) => { store[k] = v; return null; }, shared: (k: string) => store[k] ?? null,
  settings: () => ({ zoom: 0.9 }),
  spaces: () => [{ id: "s1", name: "one", active: true, folder: "/home/a", tabs: [{ id: "t1", index: 1, active: true, name: "one", status: null }] }],
  terminals: () => [], theme: () => theme, updates: () => null, window: () => ({ platform: "macos" }),
}));
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: (p: string) => new El(`svg:${p}`), image: (p: string) => new El(`image:${p}`), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} }
mock.module("gpui-base", () => ({
  h_flex: () => new El(), v_flex: () => new El(), v_virtual_list: () => new El(), Scrollbar: { new: () => new El() },
  InputState: { new: () => new Input() }, Input: { new: () => new El() },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) }, VirtualListScrollHandle: { new: () => ({}) },
}));
(globalThis as any).window = { paint_path: () => new El("dither"), viewport_size: () => ({ width: 1600, height: 1000 }) };
const theme: any = new Proxy({}, { get: (_t, k) => String(k) });
const cx: any = {
  spawn: () => {}, notify() {}, stop_propagation() {},
  focus_handle: () => ({ focus() {}, is_focused: () => false }), new: () => ({ set_props() {} }), timer: { every() {}, after() {} },
};

const { default: Tabs } = await import("../defaults/mods/nocturne/tabs.ts");
const { default: Menu } = await import("../defaults/mods/nocturne/menu.ts");

beforeEach(() => { store = {}; overlays = []; propsNow = { role: "tabs" }; });

const strip = new Tabs();
strip.init({ role: "tabs" }, cx);
const PRESS = { position: { x: 900, y: 10 }, click_count: 1 };

/** The ▾ as drawn now (the strip draws again before every press, as the app does). */
const more = () => { propsNow = { role: "tabs" }; return find(strip.render(cx), "tab-git-more"); };
/** A left press and its click on the ▾; `between`: what happens after the press (the popup closing itself). */
function click(between: () => void = () => {}) {
  const el = more();
  handler(el, "on_mouse_down", "left")(PRESS, cx);
  between();
  handler(el, "on_click")({}, cx);
}
const gitMenus = () => overlays.filter((o) => o.spec.props?.tab === "git");
/** The popup closes on the press beside it: Fireflies closes the overlay and the copy's close runs. */
function popupCloses() {
  const open = gitMenus()[0];
  if (!open) return;
  overlays = overlays.filter((o) => o !== open);
  propsNow = { ...open.spec.props, overlay: open.id };
  new Menu().closing();
}

test("the ▾: a click opens the git menu under it; a second click closes it (the popup's own close after the click)", () => {
  click();
  expect(gitMenus().length).toBe(1);
  expect(gitMenus()[0]!.spec.kind).toBe("popup");
  // The press reaches the ▾ before the popup has closed itself: the click closes it.
  click();
  expect(gitMenus().length).toBe(0);
  // A third click opens it again.
  click();
  expect(gitMenus().length).toBe(1);
});

test("the ▾: the popup closes itself on the press before the click: the click leaves it closed", () => {
  click();
  expect(gitMenus().length).toBe(1);
  click(popupCloses);
  expect(gitMenus().length).toBe(0);
  expect(store["nocturne.git-menu"]).toBe(null);
  click();
  expect(gitMenus().length).toBe(1);
});

test("closed some other way (a pick, esc): the next click on the ▾ opens it", () => {
  click();
  popupCloses();
  expect(gitMenus().length).toBe(0);
  click();
  expect(gitMenus().length).toBe(1);
});

test("a right-click on the git mark toggles the same menu; the ▾'s lit look stays the GitHub panel's", () => {
  const group = () => { propsNow = { role: "tabs" }; return find(strip.render(cx), "tab-git-group"); };
  handler(group(), "on_mouse_down", "right")(PRESS, cx);
  expect(gitMenus().length).toBe(1);
  // Open menu, GitHub panel shut: the ▾ isn't lit.
  expect(more().calls.text_color?.[0]?.[0]).toBe("muted");
  handler(group(), "on_mouse_down", "right")(PRESS, cx);
  expect(gitMenus().length).toBe(0);
});
