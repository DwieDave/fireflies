import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";

// The browser and the picture in picture player by keys, with stand-ins for the
// app's modules (imports dropped, exports returned, as nocturne-preview.test.ts does).
class Element {
  calls: [string, any[]][] = [];
  nodes: any[] = [];
  constructor() {
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
const walk = (el: any): any[] => (el && typeof el === "object" && Array.isArray(el.nodes) ? [el, ...el.nodes.flatMap(walk)] : []);
const strings = (el: any) => walk(el).flatMap((e: any) => e.nodes.filter((n: any) => typeof n === "string"));
const ran: [string, any][] = [];
const native: [string, string, any][] = [];
const herdr = {
  props: () => ({}), theme: () => ({}), settings: () => ({ zoom: 1 }), nextCommand: () => new Promise(() => {}),
  shared: () => null, setShared() {}, run: (n: string, a: any) => { ran.push([n, a]); return null; }, panes: () => [], spaces: () => [], focused: () => null,
  openOverlay() {}, closeOverlay() {}, window: () => ({ platform: "macos" }),
  nativeView: { new: () => new Element() }, nativeViewCall: (id: string, action: string, args: any) => { native.push([id, action, args]); return null; },
  nextNativeViewEvent: () => new Promise(() => {}),
};
const kit = { View: class {}, div: () => new Element(), svg: () => new Element(), PathBuilder: { fill: () => new Element() }, Background: { checkerboard: () => ({}) } };
const base = { h_flex: () => new Element(), v_flex: () => new Element(), InputState: { new: () => ({ on() {}, focus() {}, set_value() {}, value: () => "" }) }, Input: { new: () => new Element() } };

async function load(path: string): Promise<any> {
  const source = await readFile(new URL(`../defaults/mods/${path}`, import.meta.url), "utf8");
  const names: string[] = [];
  const body = source
    .replace(/^import .*;\n/gm, "")
    .replace(/^export default class (\w+)/m, (_m, n) => { names.push(`default: ${n}`); return `class ${n}`; })
    .replace(/^export (async function|function|const|class) (\w+)/gm, (_m, kind, n) => { names.push(n); return `${kind} ${n}`; });
  const scope: Record<string, unknown> = { ...kit, ...base, ...herdr, herdr, appWindow: herdr.window, window: { paint_path: () => new Element() } };
  return new Function(...Object.keys(scope), `${body}\nreturn { ${names.join(", ")} };`)(...Object.values(scope));
}

const cx = { notify() {}, stop_propagation() {} };
const press = (view: any, key: string, extra: any = {}) => view.key({ key, keystroke: key, modifiers: {}, ...extra }, cx);

test("the browser's bar by keys: into the page, the address, history, reload, zoom, inspector; the ring and ? list", async () => {
  const { default: Browser } = await load("nocturne-browser/main.js");
  const view: any = Object.create(Browser.prototype);
  let focusedInput = 0;
  Object.assign(view, {
    slot: "b1", start: "https://a.example", zoom: 0.9, editing: false, video: false, away: false, error: null, barW: 900,
    page: { href: "https://a.example/x", loading: false, canGoBack: true, canGoForward: false },
    handle: { focus() {}, is_focused: () => true }, input: { focus() { focusedInput++; }, set_value() {}, value: () => "" }, seen: [],
  });
  view.render();
  native.length = 0;
  press(view, "enter");
  expect(native.at(-1)).toEqual(["web", "focus", {}]);
  press(view, "o", { key_char: "o" });
  // The page lets go of the keyboard before the address field takes it.
  expect(native.at(-1)).toEqual(["web", "blur", {}]);
  expect([view.editing, focusedInput]).toEqual([true, 1]);
  // Typing in the address field is the field's, not the bar's.
  press(view, "r", { key_char: "r" });
  expect(native.at(-1)).toEqual(["web", "blur", {}]);
  view.editing = false;
  press(view, "h", { key_char: "H", modifiers: { shift: true } });
  expect(native.at(-1)).toEqual(["web", "browser.back", {}]);
  press(view, "r", { key_char: "r" });
  expect(native.at(-1)).toEqual(["web", "browser.reload", {}]);
  press(view, "=", { key_char: "+", modifiers: { shift: true } });
  expect(view.zoom).toBe(1);
  press(view, "0", { key_char: "0" });
  expect(view.zoom).toBe(0.9);
  // No video on the page: p does nothing.
  native.length = 0;
  press(view, "p", { key_char: "p" });
  expect(native).toEqual([]);
  press(view, "o", { key_char: "O", modifiers: { shift: true } });
  expect(ran.at(-1)).toEqual(["app.open_url", { url: "https://a.example/x", in: "system" }]);
  // tab rings the enabled buttons in bar order; enter presses the ringed one.
  view.editing = false;
  view.render();
  expect(view.controls.filter((c: any) => c.enabled).map((c: any) => c.id)).toEqual(["back", "reload", "address", "zoom-out", "zoom", "zoom-in", "inspect", "external", "keys"]);
  press(view, "tab");
  expect(view.ring).toBe("back");
  press(view, "tab", { modifiers: { shift: true } });
  expect(view.ring).toBe("keys");
  press(view, "enter");
  expect(view.keysShown).toBe(true);
  expect(strings(view.render())).toEqual(expect.arrayContaining(["enter i", "into the page", "⌘esc", "back to the bar"]));
  press(view, "escape");
  expect(view.ring).toBe(null);
  press(view, "escape");
  expect(view.keysShown).toBe(false);
  // ⌘esc in the page (the native view's escapeKey): the bar has the keyboard again.
  let barFocus = 0;
  view.handle = { focus() { barFocus++; }, is_focused: () => false };
  view.onEvent({ event: "view.escapeKey", data: {} }, cx);
  expect(barFocus).toBe(1);
});

test("the inspector pane takes the keyboard, and enter puts it into the inspector", async () => {
  const { default: Browser } = await load("nocturne-browser/main.js");
  const view: any = Object.create(Browser.prototype);
  Object.assign(view, { inspect: "1:web", lost: null, handle: { focus() {}, is_focused: () => true } });
  const root = view.render();
  expect(root.calls.some(([k]: any) => k === "track_focus")).toBe(true);
  native.length = 0;
  view.inspectorKey({ key: "enter", modifiers: {} }, cx);
  expect(native).toEqual([["inspector", "focus", {}]]);
});

test("the player by keys, and j / k in its ⋯ menu", async () => {
  const { keyControl, menuMove } = await load("nocturne-pip/main.js");
  const k = (key: string, extra: any = {}) => keyControl({ key, modifiers: {}, ...extra });
  expect([k("space"), k("k", { key_char: "k" }), k("left"), k("l", { key_char: "l" }), k("m", { key_char: "m" }), k("b", { key_char: "b" }),
    k("p", { key_char: "p" }), k("p", { key_char: "P", modifiers: { shift: true } }), k("o", { key_char: "o" }), k("q", { key_char: "q" }), k("z", { key_char: "z" }),
    k("left", { modifiers: { platform: true } })])
    .toEqual(["toggle", "toggle", "rewind", "forward", "mute", "back", "pane", "park", "out", "close", null, null]);
  expect([menuMove("j", 0, 3), menuMove("k", 0, 3), menuMove("down", 2, 3), menuMove("enter", 1, 3)]).toEqual([1, 2, 0, null]);
});
