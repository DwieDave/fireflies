import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";

// The web pane (nocturne-browser) and the picture in picture player by keys,
// with stand-ins for the app's modules (imports dropped, exports returned, as
// nocturne-preview.test.ts does). Each web pane is its own copy of the mod, as
// in the app: its own props, command queue and native view; the shared store,
// the panes and the window's focus are the app's, one for all.
//
// Where a key goes in the app (src/keys.rs, src/window.rs, the native view):
//   - a key bound in keys.json's mod:nocturne-browser runs its command; GPUI
//     never hands it to on_key_down. `<mod>.<command>` reaches every shown
//     copy, so mine() picks the one that acts.
//   - tab / shift-tab are bound in the browser's key context (the root binds
//     them to moving focus) and come back as actions.
//   - the rest reach key() while the bar has GPUI's keyboard.
//   - while the page has AppKit's keyboard: ⌘R / ⌥⌘I / ⌘esc come as events
//     (web.reloadKey, web.inspectKey, view.escapeKey); the chords the page
//     leaves come back to GPUI, so to the section while the mod has GPUI's
//     keyboard (a press into the page sends `focus`: src/window.rs).
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
const callOf = (el: any, name: string) => el.calls.filter(([k]: any) => k === name).map(([, a]: any) => a);

// ---- the app, one for every copy

const app = {
  store: {} as Record<string, any>,
  panes: [] as any[],
  focusedPane: null as string | null,
  ran: [] as [string, any][],
};
const reset = () => { app.store = {}; app.panes = []; app.focusedPane = null; app.ran = []; };
const kit = { View: class {}, div: () => new Element(), svg: () => new Element(), PathBuilder: { fill: () => new Element() }, Background: { checkerboard: () => ({}) } };

/** A loaded copy of a mod: `props` its own, its commands from `send`, its native calls in `native`. */
/** A mod file's keyhelp.js exports (imports stripped), when the file imports it. */
async function keyhelpOf(path: string, source: string, scope: Record<string, any>): Promise<Record<string, unknown>> {
  if (!/from "\.\/keyhelp\.js"/.test(source)) return {};
  const src = await readFile(new URL(`../defaults/mods/${path.replace(/[^/]+$/, "keyhelp.js")}`, import.meta.url), "utf8");
  const names: string[] = [];
  const body = src.replace(/^import [^;]*;\n/gm, "").replace(/^export (async function|function|const|class) (\w+)/gm, (_m, kind, n) => { names.push(n); return `${kind} ${n}`; });
  const s: Record<string, unknown> = { div: scope.div, PathBuilder: scope.PathBuilder, Background: scope.Background, h_flex: scope.h_flex, v_flex: scope.v_flex,
    settings: scope.settings ?? (() => ({ zoom: 1 })), appWindow: scope.appWindow ?? (() => ({ platform: "macos" })), window: scope.window ?? { paint_path: scope.div } };
  return new Function(...Object.keys(s), `${body}\nreturn { ${names.join(", ")} };`)(...Object.values(s));
}

async function load(path: string, own: { props?: any; copy?: number } = {}) {
  const source = await readFile(new URL(`../defaults/mods/${path}`, import.meta.url), "utf8");
  const names: string[] = [];
  const body = source
    .replace(/^import [^;]*;\n/gm, "")
    .replace(/^export default class (\w+)/m, (_m, n) => { names.push(`default: ${n}`); return `class ${n}`; })
    .replace(/^export (async function|function|const|class) (\w+)/gm, (_m, kind, n) => { names.push(n); return `${kind} ${n}`; });
  const queue: string[] = [];
  let waiting: ((c: string) => void) | null = null;
  const native: [string, string, any][] = [];
  const herdr = {
    props: () => own.props ?? {}, theme: () => ({}), settings: () => ({ zoom: 1 }),
    nextCommand: () => (queue.length ? Promise.resolve(queue.shift()!) : new Promise<string>((r) => { waiting = r; })),
    shared: (k: string) => app.store[k] ?? null, setShared: (k: string, v: any) => { app.store[k] = v; return null; },
    run: (n: string, a: any) => { app.ran.push([n, a]); return null; },
    panes: () => app.panes, spaces: () => [], focused: () => ({ pane: app.focusedPane }),
    openOverlay() {}, closeOverlay() {}, window: () => ({ platform: "macos" }),
    nativeView: { new: (id: string, p: any) => { const el: any = new Element(); el.view = [id, p]; return el; } },
    nativeViewCall: (id: string, action: string, args: any) => {
      native.push([id, action, args]);
      return action === "web.inspect" ? { of: `${own.copy ?? 1}:${id}` } : null;
    },
    nextNativeViewEvent: () => new Promise(() => {}),
  };
  const base = {
    h_flex: () => new Element(), v_flex: () => new Element(), Input: { new: () => new Element() },
    InputState: { new: () => {
      const handlers: Record<string, Function> = {};
      let v = "";
      const state: any = { handlers, focused: 0, selected: null, value: () => v, on(e: string, f: Function) { handlers[e] = f; }, focus() { this.focused++; },
        set_value(x: string) { v = x; state.selected = null; }, set_selected_range(r: any) { state.selected = r; } };
      return state;
    } },
  };
  const scope: Record<string, unknown> = { ...kit, ...base, ...herdr, herdr, appWindow: herdr.window, window: { paint_path: () => new Element() } };
  Object.assign(scope, await keyhelpOf(path, source, scope));
  // `import * as Tabs from "./tabs.js"`: the real module (it imports nothing).
  if (/import \* as Tabs from "\.\/tabs\.js"/.test(source)) scope.Tabs = await import(`../defaults/mods/${path.replace(/[^/]+$/, "tabs.js")}`);
  const mod = new Function(...Object.keys(scope), `${body}\nreturn { ${names.join(", ")} };`)(...Object.values(scope));
  const send = async (c: string) => {
    if (waiting) { const w = waiting; waiting = null; w(c); } else queue.push(c);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { mod, native, send };
}

/** A GPUI context: timers kept to run by hand, bound keys collected. */
function context() {
  const timers: Function[] = [];
  const bound: any[] = [];
  const handle = { focused: 0, is_focused() { return this.focused > 0; }, focus() { this.focused++; } };
  const cx: any = {
    timers, bound, handle,
    notify() {}, stop_propagation() { cx.stopped = true; },
    spawn: (f: Function) => { f(cx); },
    timer: { after: (_ms: number, f: Function) => { timers.push(f); }, every() {} },
    focus_handle: () => handle,
    bind_keys: (b: any[]) => { bound.push(...b); return b.length; },
  };
  return cx;
}

/** A web pane copy, started as the app starts it (init with its props). */
async function webPane(opts: { slot?: string; url?: string; copy?: number; props?: any } = {}) {
  const props = opts.props ?? { ...(opts.slot ? { slot: opts.slot } : {}), ...(opts.url ? { url: opts.url } : {}) };
  const loaded = await load("nocturne-browser/main.js", { props, copy: opts.copy });
  const cx = context();
  const view: any = new loaded.mod.default();
  view.init(props, cx);
  return { view, cx, ...loaded };
}

const press = (view: any, cx: any, key: string, extra: any = {}) => { cx.stopped = false; view.key({ key, keystroke: key, modifiers: {}, ...extra }, cx); return cx.stopped; };
const char = (c: string) => ({ key_char: c, ...(c !== c.toLowerCase() || "?+".includes(c) ? { modifiers: { shift: true } } : {}) });

test("the bar has the keyboard: every bar key of the ? list does what it says", async () => {
  reset();
  const { view, cx, native } = await webPane({ slot: "b1", url: "https://a.example/x", copy: 1 });
  Object.assign(view.page, { canGoBack: true });
  view.render();
  native.length = 0;
  // enter / i: into the page; the ring goes.
  for (const k of ["enter", "i"]) {
    expect(press(view, cx, k, k === "i" ? char("i") : {})).toBe(true);
    expect(native.at(-1)).toEqual(["web", "focus", {}]);
  }
  // o and /: the address, after the page lets go of AppKit's keyboard.
  for (const k of ["o", "/"]) {
    view.editing = false;
    press(view, cx, k, char(k));
    expect(native.at(-1)).toEqual(["web", "blur", {}]);
    expect(view.editing).toBe(true);
  }
  view.editing = false;
  press(view, cx, "h", char("H"));
  expect(native.at(-1)).toEqual(["web", "browser.back", {}]);
  press(view, cx, "l", char("L"));
  expect(native.at(-1)).toEqual(["web", "browser.forward", {}]);
  press(view, cx, "r", char("r"));
  expect(native.at(-1)).toEqual(["web", "browser.reload", {}]);
  // r while it loads: stop.
  view.page.loading = true;
  press(view, cx, "r", char("r"));
  expect(native.at(-1)).toEqual(["web", "browser.stop", {}]);
  view.page.loading = false;
  press(view, cx, "=", char("+"));
  expect(view.zoom).toBe(1);
  press(view, cx, "-", char("-"));
  expect(view.zoom).toBe(0.9);
  press(view, cx, "=", char("+"));
  press(view, cx, "0", char("0"));
  expect(view.zoom).toBe(0.9);
  // p: only while the page has a video, or while it plays in the player.
  native.length = 0;
  expect(press(view, cx, "p", char("p"))).toBe(false);
  expect(native).toEqual([]);
  view.video = true;
  press(view, cx, "p", char("p"));
  expect(native.at(-1)).toEqual(["web", "web.pip", {}]);
  view.video = false; view.away = true;
  press(view, cx, "p", char("p"));
  expect(native.at(-1)).toEqual(["web", "web.pip", {}]);
  view.away = false;
  // d: the inspector, in a split beside this pane (its own, found by its slot).
  app.panes = [{ pane: "p1", mod: "nocturne-browser", props: { slot: "b1" }, tab: "t1", focused: true }];
  press(view, cx, "d", char("d"));
  expect(app.ran.at(-1)).toEqual(["pane.split", { direction: "down", pane: "p1", mod: "nocturne-browser", props: { inspect: "1:web" } }]);
  press(view, cx, "o", char("O"));
  expect(app.ran.at(-1)).toEqual(["app.open_url", { url: "https://a.example/x", in: "system" }]);
  // ?: the keys, under the bar; esc puts them away.
  press(view, cx, "/", char("?"));
  expect(view.keysShown).toBe(true);
  expect(strings(view.render())).toEqual(expect.arrayContaining(["enter i", "into the page", "⌘esc", "back to the bar"]));
  press(view, cx, "escape");
  expect(view.keysShown).toBe(false);
  // Keys the bar doesn't take go on (the app's own).
  expect(press(view, cx, "z", char("z"))).toBe(false);
  expect(press(view, cx, "k", { key_char: null, keystroke: "cmd-k", modifiers: { platform: true } })).toBe(false);
});

test("tab / shift-tab reach the bar as actions bound in its own key context, and ring its buttons", async () => {
  reset();
  const { view, cx } = await webPane({ slot: "b1", url: "https://a.example/x" });
  Object.assign(view.page, { canGoBack: true });
  // Bound once, in the browser's context: GPUI's root would move focus otherwise.
  expect(cx.bound).toEqual([
    { keystroke: "tab", action: "nocturne_browser::tab", context: "NocturneBrowser" },
    { keystroke: "shift-tab", action: "nocturne_browser::tab_back", context: "NocturneBrowser" },
  ]);
  view.handle.is_focused = () => true;
  const root = view.render();
  expect(callOf(root, "key_context")).toEqual([["NocturneBrowser"]]);
  const actions = Object.fromEntries(callOf(root, "on_action").map(([a, f]: any) => [a, f]));
  const tab = (back = false) => { actions[back ? "nocturne_browser::tab_back" : "nocturne_browser::tab"]({}, cx); view.render(); };
  expect(view.controls.filter((c: any) => c.enabled).map((c: any) => c.id)).toEqual(["back", "reload", "address", "zoom-out", "zoom", "zoom-in", "inspect", "external", "keys"]);
  tab();
  expect(view.ring).toBe("back");
  tab();
  expect(view.ring).toBe("reload");
  tab(true);
  tab(true);
  expect(view.ring).toBe("keys");
  // enter presses the ringed button; esc takes the ring away first.
  press(view, cx, "enter");
  expect(view.keysShown).toBe(true);
  // esc closes the keys first (keyhelp.js: ? esc q close them), then takes the ring away.
  press(view, cx, "escape");
  expect([view.ring, view.keysShown]).toEqual(["keys", false]);
  press(view, cx, "escape");
  expect(view.keysShown).toBe(false);
  // In the address field tab is the field's: no ring.
  view.editing = true;
  tab();
  expect(view.ring).toBe(null);
});

test("the shipped section's chords run commands that act on the page, in the bar, the address and the page", async () => {
  reset();
  const keys = JSON.parse(await readFile(new URL("../defaults/keys.macos.json", import.meta.url), "utf8"));
  expect(keys["mod:nocturne-browser"]).toEqual({
    "cmd-p": "nocturne-browser.url", "cmd-l": "nocturne-browser.url", "cmd-r": "nocturne-browser.reload",
    "cmd-[": "nocturne-browser.back", "cmd-]": "nocturne-browser.forward", "cmd-alt-i": "nocturne-browser.inspect",
  });
  const { view, send, native } = await webPane({ slot: "b1", url: "https://a.example/x", copy: 1 });
  app.panes = [{ pane: "p1", mod: "nocturne-browser", props: { slot: "b1" }, tab: "t1", focused: true }];
  app.focusedPane = "p1";
  const run = async (chord: string) => { native.length = 0; await send(keys["mod:nocturne-browser"][chord].replace("nocturne-browser.", "")); };
  // Bar, address and page alike: the command doesn't care where the keyboard is.
  for (const where of ["bar", "address", "page"]) {
    view.editing = where === "address";
    await run("cmd-r");
    expect(native).toEqual([["web", "browser.reload", {}]]);
    await run("cmd-[");
    expect(native).toEqual([["web", "browser.back", {}]]);
    await run("cmd-]");
    expect(native).toEqual([["web", "browser.forward", {}]]);
    for (const chord of ["cmd-p", "cmd-l"]) {
      view.editing = false;
      const before = view.input.focused;
      await run(chord);
      expect(native).toEqual([["web", "blur", {}]]);
      expect([view.editing, view.input.focused]).toEqual([true, before + 1]);
    }
  }
  await run("cmd-alt-i");
  expect(app.ran.at(-1)?.[0]).toBe("pane.split");
  // Unbound (a keys.json without the section): key() takes the same chords.
  const cx = context();
  for (const [k, call] of [["cmd-r", "browser.reload"], ["cmd-[", "browser.back"], ["cmd-]", "browser.forward"]]) {
    view.editing = false;
    native.length = 0;
    expect(press(view, cx, k.slice(4), { keystroke: k, modifiers: { platform: true } })).toBe(true);
    expect(native).toEqual([["web", call, {}]]);
  }
});

test("typing in the address: esc goes back into the page, enter goes there, and both leave the mod GPUI's keyboard", async () => {
  reset();
  const { view, cx, native } = await webPane({ slot: "b1", url: "https://a.example/x" });
  press(view, cx, "o", char("o"));
  expect(view.editing).toBe(true);
  // Typing is the field's, not the bar's.
  native.length = 0;
  expect(press(view, cx, "r", char("r"))).toBe(false);
  expect(press(view, cx, "h", char("H"))).toBe(false);
  expect(native).toEqual([]);
  const focusedBefore = view.handle.focused;
  expect(press(view, cx, "escape")).toBe(true);
  expect(view.editing).toBe(false);
  expect(native).toEqual([["web", "focus", {}]]);
  expect(view.handle.focused).toBe(focusedBefore + 1);
  // Enter: the page goes there and takes the keyboard.
  press(view, cx, "o", char("o"));
  native.length = 0;
  view.input.set_value("");
  view.input.handlers.submit({}, cx);
  // (the field emptied, so nothing to go to)
  expect(view.editing).toBe(true);
  view.go("b.example", cx);
  expect(view.editing).toBe(false);
  expect(native).toEqual([["web", "browser.navigate", { url: "b.example" }], ["web", "focus", {}]]);
  expect(view.handle.focused).toBe(focusedBefore + 2);
});

test("a blank pane: the address has the keyboard, esc gives it to the bar, and page keys don't fail without a page", async () => {
  reset();
  const { view, cx, native } = await webPane({ slot: "b1" });
  expect(view.editing).toBe(true);
  cx.timers.splice(0).forEach((f: Function) => f(cx));
  expect(view.input.focused).toBe(1);
  press(view, cx, "escape");
  expect(view.editing).toBe(false);
  expect(native).toEqual([]);
  for (const [k, c] of [["h", "H"], ["l", "L"], ["r", "r"], ["enter", null], ["i", "i"]]) press(view, cx, k!, c ? char(c) : {});
  expect([native, view.error]).toEqual([[], null]);
  press(view, cx, "o", char("o"));
  expect(view.editing).toBe(true);
  // The first page: its view comes with the next frame, then takes the keyboard.
  view.go("a.example", cx);
  expect(view.start).toBe("a.example");
  expect(native).toEqual([]);
  cx.timers.splice(0).forEach((f: Function) => f(cx));
  expect(native).toEqual([["web", "focus", {}]]);
});

test("the page has the keyboard: a press, cmd-esc, cmd-r and cmd-alt-i", async () => {
  reset();
  const { view, cx, send, native } = await webPane({ slot: "b1", url: "https://a.example/x", copy: 1 });
  app.panes = [{ pane: "p1", mod: "nocturne-browser", props: { slot: "b1" }, tab: "t1", focused: true }];
  // A press into the page (src/window.rs sends `focus`): this copy takes GPUI's keyboard.
  app.store["nocturne-browser.active"] = "other";
  await send("focus");
  expect(view.handle.focused).toBe(1);
  expect(app.store["nocturne-browser.active"]).toBe("b1");
  // A press while the address was being typed: the field lets go (its blur).
  view.editing = true;
  view.input.handlers.blur({}, cx);
  expect(view.editing).toBe(false);
  // cmd-esc: the keyboard back to the bar.
  view.onEvent({ event: "view.escapeKey", data: {} }, cx);
  expect(view.handle.focused).toBe(2);
  native.length = 0;
  view.onEvent({ event: "web.reloadKey", data: { of: "1:web" } }, cx);
  expect(native).toEqual([["web", "browser.reload", {}]]);
  view.onEvent({ event: "web.inspectKey", data: { of: "1:web" } }, cx);
  expect(app.ran.at(-1)?.[0]).toBe("pane.split");
});

test("two web panes: a command acts only in the focused one, however the focus got there", async () => {
  reset();
  const a = await webPane({ slot: "a", url: "https://a.example", copy: 1 });
  const b = await webPane({ slot: "b", url: "https://b.example", copy: 2 });
  app.panes = [
    { pane: "pa", mod: "nocturne-browser", props: { slot: "a" }, tab: "t1" },
    { pane: "pb", mod: "nocturne-browser", props: { slot: "b" }, tab: "t1" },
    { pane: "pt", terminal: "t9", tab: "t1" },
  ];
  const reloads = () => [a, b].map((x) => x.native.filter(([, c]) => c === "browser.reload").length);
  const both = async (c: string) => { await a.send(c); await b.send(c); };
  // A claimed last (a click on its bar), but the window focused b another way
  // (agent.next, a tab switch, a click into its page): b's command.
  a.view.claim();
  app.focusedPane = "pb";
  await both("reload");
  expect(reloads()).toEqual([0, 1]);
  // pane.go onto a: it gets `focus`, and the window's focus is a.
  await a.send("focus");
  app.focusedPane = "pa";
  await both("reload");
  expect(reloads()).toEqual([1, 1]);
  // A click on b's bar.
  b.view.stop({}, b.cx);
  app.focusedPane = "pb";
  await both("reload");
  expect(reloads()).toEqual([1, 2]);
  // A terminal focused (the palette, an agent's herdr-app do): the copy last focused.
  app.focusedPane = "pt";
  await both("reload");
  expect(reloads()).toEqual([1, 3]);
  // Keys pressed on a's bar claim it.
  press(a.view, a.cx, "z", char("z"));
  await both("reload");
  expect(reloads()).toEqual([2, 3]);
  // A web pane without a slot focused: not a pane that has its own.
  app.panes.push({ pane: "pn", mod: "nocturne-browser", props: {}, tab: "t1" });
  app.focusedPane = "pn";
  await both("reload");
  expect(reloads()).toEqual([2, 3]);
});

test("the inspector: its pane takes the keyboard, enter goes into it, and the section's chords act on its page", async () => {
  reset();
  const a = await webPane({ slot: "a", url: "https://a.example", copy: 1 });
  const b = await webPane({ slot: "b", url: "https://b.example", copy: 2 });
  const insp = await webPane({ props: { inspect: "2:web" }, copy: 3 });
  app.panes = [
    { pane: "pa", mod: "nocturne-browser", props: { slot: "a" }, tab: "t1" },
    { pane: "pb", mod: "nocturne-browser", props: { slot: "b" }, tab: "t1" },
    { pane: "pi", mod: "nocturne-browser", props: { inspect: "2:web" }, tab: "t1" },
  ];
  a.view.claim();
  // Its pane focused (pane.go, a press): its own handle.
  await insp.send("focus");
  expect(insp.view.handle.focused).toBe(1);
  app.focusedPane = "pi";
  const root = insp.view.render();
  expect(callOf(root, "track_focus").length).toBe(1);
  insp.native.length = 0;
  insp.view.inspectorKey({ key: "enter", modifiers: {} }, insp.cx);
  expect(insp.native).toEqual([["inspector", "focus", {}]]);
  // cmd-r / cmd-[ there: the inspected page's (b), though a was claimed last.
  for (const c of ["reload", "back"]) {
    await a.send(c); await b.send(c); await insp.send(c);
  }
  expect(a.native.filter(([, c]) => c.startsWith("browser."))).toEqual([]);
  expect(b.native.filter(([, c]) => c.startsWith("browser.")).map(([, c]) => c)).toEqual(["browser.reload", "browser.back"]);
  // cmd-alt-i there closes it.
  app.store["nocturne-browser.inspectors"] = { "2:web": "pi" };
  await a.send("inspect"); await b.send("inspect");
  expect(app.ran.at(-1)).toEqual(["pane.close", { pane: "pi" }]);
  // cmd-esc in the inspector: its pane's handle again.
  expect(insp.view.handle.focused).toBe(1);
});

test("a web pane opened as the focused pane takes the keyboard; one opened beside the focus doesn't", async () => {
  reset();
  app.panes = [{ pane: "p1", mod: "nocturne-browser", props: { slot: "s1", url: "https://a.example" }, tab: "t1" }, { pane: "p2", terminal: "t2", tab: "t1" }];
  app.focusedPane = "p1";
  const one = await webPane({ props: { slot: "s1", url: "https://a.example" } });
  one.cx.timers.splice(0).forEach((f: Function) => f(one.cx));
  expect(one.view.handle.focused).toBe(1);
  expect(app.store["nocturne-browser.active"]).toBe("s1");
  app.focusedPane = "p2";
  app.panes.push({ pane: "p3", mod: "nocturne-browser", props: { slot: "s3", url: "https://b.example" }, tab: "t1" });
  const other = await webPane({ props: { slot: "s3", url: "https://b.example" } });
  other.cx.timers.splice(0).forEach((f: Function) => f(other.cx));
  expect(other.view.handle.focused).toBe(0);
});

test("picture in picture: the pane is parked meanwhile, p brings the video back, and the keys go to the pane that has the focus", async () => {
  reset();
  const a = await webPane({ slot: "a", url: "https://a.example", copy: 1 });
  app.panes = [{ pane: "pa", mod: "nocturne-browser", props: { slot: "a" }, tab: "t1" }, { pane: "pt", terminal: "t1", tab: "t1", focused: true }];
  app.focusedPane = "pt";
  a.view.onEvent({ event: "pip.enter", data: { of: "1:web" } }, a.cx);
  expect(app.ran.at(-1)).toEqual(["pane.park", { pane: "pa" }]);
  expect(a.view.away).toBe(true);
  // The bar while away: p is offered (the pip button shows) and brings it back.
  a.native.length = 0;
  press(a.view, a.cx, "p", char("p"));
  expect(a.native).toEqual([["web", "web.pip", {}]]);
  a.view.onEvent({ event: "pip.leave", data: {} }, a.cx);
  app.panes[0].parked = true;
  a.view.hidden = { pane: "pa" };
  a.view.unhide(true);
  expect(app.ran.at(-1)).toEqual(["pane.unpark", { pane: "pa" }]);
});

test("the player by keys, and j / k in its ⋯ menu", async () => {
  const { mod } = await load("nocturne-pip/main.js");
  const { keyControl, menuMove } = mod;
  const k = (key: string, extra: any = {}) => keyControl({ key, modifiers: {}, ...extra });
  expect([k("space"), k("k", { key_char: "k" }), k("left"), k("l", { key_char: "l" }), k("m", { key_char: "m" }), k("b", { key_char: "b" }),
    k("p", { key_char: "p" }), k("p", { key_char: "P", modifiers: { shift: true } }), k("o", { key_char: "o" }), k("q", { key_char: "q" }), k("z", { key_char: "z" }),
    k("left", { modifiers: { platform: true } })])
    .toEqual(["toggle", "toggle", "rewind", "forward", "mute", "back", "pane", "park", "out", "close", null, null]);
  expect([menuMove("j", 0, 3), menuMove("k", 0, 3), menuMove("down", 2, 3), menuMove("enter", 1, 3)]).toEqual([1, 2, 0, null]);
});

test("focus that comes by key (a tab switch, agent.next, a pane closing): the web pane's bar and the editor take the keyboard", async () => {
  // src/window.rs sync sends `focus` to a focusable mod pane however the focus
  // came (window::tests::mod_pane_takes_keyboard); keys::tests::the_web_panes_section…
  // proves the section then wins (cmd-l, cmd-r here, cmd-s in the editor).
  reset();
  const { view, send } = await webPane({ slot: "b1", url: "https://a.example" });
  app.store["nocturne-browser.active"] = "other";
  await send("focus");
  expect([view.handle.focused, app.store["nocturne-browser.active"]]).toEqual([1, "b1"]);
  // A blank pane: the address it types into keeps the keyboard.
  const blank = await webPane({ slot: "b2" });
  await blank.send("focus");
  expect([blank.view.handle.focused, blank.view.input.focused]).toEqual([0, 1]);
  // The editor: its text takes it, so mod:nocturne-editor (cmd-s) applies.
  const { mod } = await load("nocturne-editor/main.js");
  let editorFocused = 0;
  mod.default.prototype.command.call({ editor: { focus: () => { editorFocused++; } } }, "focus", {});
  expect(editorFocused).toBe(1);
});

test("entering the address (cmd-l, cmd-p, a click) selects all of it, so typing replaces it", async () => {
  reset();
  const { view, cx } = await webPane({ slot: "s1", url: "https://example.com/a/b" });
  view.page = { ...view.page, href: "https://example.com/a/b" };
  view.edit();
  expect([view.editing, view.input.value(), view.input.selected]).toEqual([true, "https://example.com/a/b", { start: 0, end: 23 }]);
  // A blank page: nothing to select.
  const blank = await webPane({ slot: "s2" });
  blank.view.page = { ...blank.view.page, href: null };
  blank.view.edit();
  expect(blank.view.input.selected).toBe(null);
  void cx;
});

// ---- tabs (tabs.js): one web view per tab, a strip over the bar from two on

const Tabs = await import("../defaults/mods/nocturne-browser/tabs.js");
/** The web views a render draws: [id, props, hidden (in no room)]. */
const viewsOf = (root: any) => {
  const out: [string, any, boolean][] = [];
  const go = (el: any, hidden: boolean) => {
    if (!el || typeof el !== "object" || !Array.isArray(el.nodes)) return;
    if (Array.isArray(el.view)) out.push([el.view[0], el.view[1], hidden]);
    const h = hidden || callOf(el, "h").some(([v]: any) => v === 0);
    el.nodes.forEach((n: any) => go(n, h));
  };
  go(root, false);
  return out;
};
const ids = (view: any) => view.tabs.list.map((t: any) => t.id);
/** A fake localStorage for one test (the mod's store is per pane). */
function storage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  (globalThis as any).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); } };
  return { m, done: () => { delete (globalThis as any).localStorage; } };
}

test("the tab model: links go after their opener and its earlier links, a closed tab's neighbor shows, the last leaves a blank one", () => {
  let m = Tabs.single("https://a.example", 0.9);
  expect(m).toMatchObject({ active: "web", next: 2 });
  // Two middle clicks from a: after a, in the order clicked; a stays shown.
  let t;
  [m, t] = Tabs.open(m, "https://b.example", { background: true, opener: "web" });
  expect(t.id).toBe("web-2");
  [m] = Tabs.open(m, "https://c.example", { background: true, opener: "web" });
  // A new tab by key: at the end, in front.
  [m] = Tabs.open(m, null, {});
  expect(m.list.map((x: any) => x.id)).toEqual(["web", "web-2", "web-3", "web-4"]);
  expect(m.active).toBe("web-4");
  // From the shown tab again (a): its next link goes after b and c.
  m = Tabs.show(m, "web");
  [m] = Tabs.open(m, "https://d.example", { background: true, opener: "web" });
  expect(m.list.map((x: any) => x.page.href)).toEqual(["https://a.example", "https://b.example", "https://c.example", "https://d.example", null]);
  // Another tab shown in between: a's next link starts a new row, right after it.
  m = Tabs.show(Tabs.show(m, "web-2"), "web");
  [m] = Tabs.open(m, "https://e.example", { background: true, opener: "web" });
  expect(m.list[1].page.href).toBe("https://e.example");
  // step wraps, nth: 1–8, 9 the last.
  expect([Tabs.step(m, -1), Tabs.step(m, 1)]).toEqual(["web-4", "web-6"]);
  expect([Tabs.nth(m, 1), Tabs.nth(m, 3), Tabs.nth(m, 9), Tabs.nth(m, 8), Tabs.nth(m, 0)]).toEqual(["web", "web-2", "web-4", null, null]);
  // Closing the shown tab: its right neighbor, at the end its left one.
  m = Tabs.show(m, "web-2");
  [m] = Tabs.close(m, "web-2");
  expect(m.active).toBe("web-3");
  m = Tabs.show(m, "web-4");
  [m] = Tabs.close(m, "web-4");
  expect(m.active).toBe("web-5");
  // Closing another tab keeps the shown one.
  [m] = Tabs.close(m, "web");
  expect(m.active).toBe("web-5");
  // The last one: a blank tab takes its place.
  for (const id of m.list.map((x: any) => x.id)) [m] = Tabs.close(m, id);
  expect(m.list.length).toBe(1);
  expect(m.list[0]).toMatchObject({ start: null, id: `web-${m.next - 1}` });
  expect(Tabs.close(m, "nope")[1]).toBe(null);
});

test("the tab model: saved and restored (only the shown tab loads at once), names, and open's value", () => {
  let [m] = Tabs.open(Tabs.single("https://a.example/x", 0.9), "https://b.example", { background: true, opener: "web" });
  m.list[1].page.title = "  B page ";
  m.list[1].zoom = 1.2;
  m = Tabs.show(m, "web-2");
  const r = Tabs.restore(Tabs.save(m), 0.9)!;
  expect(r.active).toBe("web-2");
  expect(r.next).toBe(3);
  expect(r.list.map((t: any) => [t.id, t.start, t.page.title, t.zoom, t.live])).toEqual([
    ["web", "https://a.example/x", null, 0.9, false], ["web-2", "https://b.example", "  B page ", 1.2, true]]);
  expect([Tabs.restore("{", 1), Tabs.restore("{}", 1), Tabs.restore('{"tabs":[]}', 1)]).toEqual([null, null, null]);
  // A saved number lower than its tabs' (edited by hand): new ids never clash.
  expect(Tabs.restore('{"tabs":[{"id":"web-7","href":"https://z.example"}],"next":2}', 1)!.next).toBe(8);
  expect([Tabs.label(r.list[1]), Tabs.label(r.list[0]), Tabs.label(Tabs.makeTab("web", null, 1)), Tabs.label(Tabs.makeTab("x", "https://www.c.example/p", 1))])
    .toEqual(["B page", "a.example", "new tab", "c.example"]);
  expect(Tabs.openArgs('{"url":"https://a.example","slot":"s1"}')).toEqual({ url: "https://a.example", slot: "s1" });
  expect(Tabs.openArgs('{"url":"https://a.example"}')).toEqual({ url: "https://a.example", slot: null });
  expect(Tabs.openArgs("https://a.example/?q=1:2")).toEqual({ url: "https://a.example/?q=1:2", slot: null });
  expect([Tabs.openArgs(""), Tabs.openArgs("{nope"), Tabs.openArgs('{"slot":"s"}')]).toEqual([null, null, null]);
});

test("a middle click, a Cmd click and the link menu open a tab behind; a new window opens one in front", async () => {
  reset();
  const { view, cx, native } = await webPane({ slot: "b1", url: "https://a.example", copy: 1 });
  // One tab: no strip, one view.
  let root = view.render();
  expect(walk(root).some((e: any) => callOf(e, "id").some(([i]: any) => i === "webtabs"))).toBe(false);
  expect(viewsOf(root)).toEqual([["web", { kind: "web", url: "https://a.example", persist: true, zoom: 0.9, pip: true, tabs: true }, false]]);
  for (const from of ["click", "menu"]) view.onEvent({ id: "web", event: "web.newTab", data: { url: `https://${from}.example/`, background: true, from } }, cx);
  expect(ids(view)).toEqual(["web", "web-2", "web-3"]);
  expect(view.tabs.active).toBe("web");
  // The background tabs load already, out of sight.
  root = view.render();
  expect(viewsOf(root).map(([id, p, hidden]) => [id, p.url, hidden])).toEqual([["web", "https://a.example", false], ["web-2", "https://click.example/", true], ["web-3", "https://menu.example/", true]]);
  expect(strings(root)).toEqual(expect.arrayContaining(["1", "a.example", "2", "click.example", "3", "menu.example"]));
  // target=_blank / window.open: in front, after a's links; the page takes the keyboard once its view is there.
  native.length = 0;
  view.onEvent({ id: "web", event: "web.newTab", data: { url: "https://win.example/", background: false, from: "window" } }, cx);
  expect(ids(view)).toEqual(["web", "web-2", "web-3", "web-4"]);
  expect([view.tabs.active, view.page.href, view.editing]).toEqual(["web-4", "https://win.example/", false]);
  expect(native).toEqual([["web", "setVisible", { visible: false }], ["web-4", "setVisible", { visible: true }]]);
  cx.timers.splice(0).forEach((f: Function) => f(cx));
  expect(native.at(-1)).toEqual(["web-4", "focus", {}]);
  // A bar command now acts on the shown tab's page.
  native.length = 0;
  view.command("reload");
  expect(native).toEqual([["web-4", "browser.reload", {}]]);
  // No address (window.open("")): nothing.
  view.onEvent({ id: "web", event: "web.newTab", data: { background: false } }, cx);
  expect(ids(view).length).toBe(4);
});

test("each tab's events go to that tab: a page loading behind changes its own title, not the shown one's", async () => {
  reset();
  const store = storage();
  try {
    const { view, cx } = await webPane({ slot: "b1", url: "https://a.example" });
    view.onEvent({ id: "web", event: "web.newTab", data: { url: "https://b.example/", background: true } }, cx);
    view.onEvent({ id: "web-2", event: "load.start", data: { href: "https://b.example/", loading: true } }, cx);
    view.onEvent({ id: "web-2", event: "web.location", data: { href: "https://b.example/", title: "Bee", loading: true } }, cx);
    expect([view.page.href, view.page.title]).toEqual(["https://a.example", null]);
    expect(view.tabs.list[1].page).toMatchObject({ title: "Bee", loading: true });
    // Loading behind: its number in the accent, a dim line under it.
    expect(strings(view.render())).toEqual(expect.arrayContaining(["Bee"]));
    view.onEvent({ id: "web-2", event: "load.error", data: { message: "offline" } }, cx);
    expect([view.error, view.tabs.list[1].error]).toEqual([null, "offline"]);
    view.onEvent({ id: "web-2", event: "web.video", data: { present: true } }, cx);
    expect([view.video, view.tabs.list[1].video]).toEqual([false, true]);
    // A closed tab's last events, and the inspector's: nowhere.
    view.onEvent({ id: "web-9", event: "web.location", data: { href: "https://z.example/" } }, cx);
    expect(view.tabs.list.map((t: any) => t.page.href)).toEqual(["https://a.example", "https://b.example/"]);
    // Kept: every tab's address and title.
    expect(JSON.parse(store.m.get("tabs")!).tabs).toEqual([
      { id: "web", href: "https://a.example", title: null, zoom: 0.9 }, { id: "web-2", href: "https://b.example/", title: "Bee", zoom: 0.9 }]);
  } finally { store.done(); }
});

test("the tab keys in the bar: t new, x close, J K left and right, 1–9; the palette's commands do the same", async () => {
  reset();
  const { view, cx, native, send } = await webPane({ slot: "b1", url: "https://a.example", copy: 1 });
  app.panes = [{ pane: "p1", mod: "nocturne-browser", props: { slot: "b1" }, tab: "t1", focused: true }];
  app.focusedPane = "p1";
  // t: a blank tab in front, its address taking the keyboard.
  const typed = view.input.focused;
  expect(press(view, cx, "t", char("t"))).toBe(true);
  expect([ids(view), view.tabs.active, view.editing, view.start]).toEqual([["web", "web-2"], "web-2", true, null]);
  cx.timers.splice(0).forEach((f: Function) => f(cx));
  expect(view.input.focused).toBe(typed + 1);
  // Typing an address there: its view is made on it.
  view.go("b.example", cx);
  expect(viewsOf(view.render()).map(([id, p, h]) => [id, p.url, h])).toEqual([["web-2", "b.example", false], ["web", "https://a.example", true]]);
  press(view, cx, "t", char("t"));
  view.go("c.example", cx);
  // J K step and wrap, 1–9 jump (9: the last).
  const shown = () => view.tabs.active;
  press(view, cx, "k", char("K"));
  expect(shown()).toBe("web");
  press(view, cx, "j", char("J"));
  expect(shown()).toBe("web-3");
  press(view, cx, "j", char("J"));
  expect(shown()).toBe("web-2");
  press(view, cx, "1", char("1"));
  expect(shown()).toBe("web");
  press(view, cx, "9", char("9"));
  expect(shown()).toBe("web-3");
  press(view, cx, "5", char("5"));
  expect(shown()).toBe("web-3");
  // x: the shown one goes (its view too), its left neighbor shows (it was last).
  native.length = 0;
  press(view, cx, "x", char("x"));
  expect([ids(view), shown()]).toEqual([["web", "web-2"], "web-2"]);
  expect(native[0]).toEqual(["web-3", "dispose", {}]);
  // The palette's commands (any shown copy may get them; this one is focused).
  await send("tab_new");
  expect(ids(view).length).toBe(3);
  await send("tab_prev");
  expect(shown()).toBe("web-2");
  await send("tab_next");
  expect(shown()).toBe("web-4");
  await send("tab_close");
  await send("tab_close");
  await send("tab_close");
  // The last tab closed: a blank one, the pane stays.
  expect([view.tabs.list.length, view.start, view.editing]).toEqual([1, null, true]);
  expect(app.ran.some(([n]) => n === "pane.close")).toBe(false);
});

test("tab and enter reach the strip's tabs and its +; a click shows a tab, × and a middle click close one", async () => {
  reset();
  const { view, cx, native } = await webPane({ slot: "b1", url: "https://a.example" });
  view.onEvent({ id: "web", event: "web.newTab", data: { url: "https://b.example/", background: true } }, cx);
  view.handle.is_focused = () => true;
  let root = view.render();
  // In drawing order: the tabs, +, then the bar's buttons (back is off: no history).
  expect(view.controls.filter((c: any) => c.enabled).map((c: any) => c.id).slice(0, 4)).toEqual(["tab:web", "tab:web-2", "tab-new", "reload"]);
  press(view, cx, "tab");
  view.render();
  press(view, cx, "tab");
  expect(view.ring).toBe("tab:web-2");
  root = view.render();
  // The ring on the second tab: an accent frame inside it.
  const tab2 = walk(root).find((e: any) => callOf(e, "id").some(([i]: any) => i === "webtab-web-2"));
  expect(walk(tab2).some((e: any) => callOf(e, "border_color").length)).toBe(true);
  press(view, cx, "enter");
  expect(view.tabs.active).toBe("web-2");
  // A click on the first tab shows it.
  root = view.render();
  const byId = (id: string) => walk(root).find((e: any) => callOf(e, "id").some(([i]: any) => i === id));
  const handler = (el: any, name: string, button?: string) => callOf(el, name).find((a: any) => button == null || a[0] === button)?.at(-1);
  handler(byId("webtab-web"), "on_mouse_down", "left")({ position: { x: 10 } }, cx);
  handler(byId("webtab-web"), "on_mouse_up", "left")({}, cx);
  handler(byId("webtabs"), "on_mouse_up", "left")({}, cx);
  expect(view.tabs.active).toBe("web");
  // Its middle click closes the second.
  handler(byId("webtab-web-2"), "on_mouse_down", "middle")({}, cx);
  expect(ids(view)).toEqual(["web"]);
  // + opens a blank one; × closes it, and the press doesn't also show the tab under it.
  view.onEvent({ id: "web", event: "web.newTab", data: { url: "https://b.example/", background: true } }, cx);
  root = view.render();
  handler(byId("webtab-new"), "on_click")({}, cx);
  expect([ids(view).length, view.start]).toEqual([3, null]);
  root = view.render();
  expect(ids(view)).toEqual(["web", "web-3", "web-4"]);
  const x = byId("webtab-x-web-3");
  native.length = 0;
  handler(x, "on_mouse_down", "left")({}, cx);
  handler(x, "on_click")({}, cx);
  // Should the release reach the tab under the × too: the press was the ×'s, nothing more happens.
  handler(byId("webtab-web-3"), "on_mouse_up", "left")({}, cx);
  expect([ids(view), view.tabs.active]).toEqual([["web", "web-4"], "web-4"]);
  expect(native).toEqual([["web-3", "dispose", {}]]);
});

test("the tab model: a tab moved by hand, where a drag drops it, and the marker's place", () => {
  let m = Tabs.single("https://a.example", 0.9);
  [m] = Tabs.open(m, "https://b.example", { background: true, opener: "web" });
  [m] = Tabs.open(m, "https://c.example", { background: true });
  [m] = Tabs.open(m, "https://d.example", { background: true });
  const order = (x: any) => x.list.map((t: any) => t.id);
  expect(order(m)).toEqual(["web", "web-2", "web-3", "web-4"]);
  // move: where it ends up, clamped; moved by hand it leaves its row of links.
  const moved = Tabs.move(m, "web-2", 3);
  expect([order(moved), moved.list[3].opener, moved.active]).toEqual([["web", "web-3", "web-4", "web-2"], null, "web"]);
  expect(order(Tabs.move(m, "web-4", -5))).toEqual(["web-4", "web", "web-2", "web-3"]);
  expect(Tabs.move(m, "web", 0)).toBe(m);
  expect(Tabs.move(m, "nope", 1)).toBe(m);
  // A drag: the pointer's half of the tab under it picks the gap before or after it.
  expect(Tabs.gapAt("web-3", 10, 100)).toEqual({ id: "web-3", after: false });
  expect(Tabs.gapAt("web-3", 60, 100)).toEqual({ id: "web-3", after: true });
  expect(Tabs.gapAt(null, 60, 100)).toEqual({ id: null, after: false });
  // web dragged: before web-3 = after web-2 = place 1; the end = place 3.
  expect(Tabs.dropIndex(m, "web", { id: "web-3", after: false })).toBe(1);
  expect(Tabs.dropIndex(m, "web", { id: "web-2", after: true })).toBe(1);
  expect(Tabs.dropIndex(m, "web", { id: null, after: false })).toBe(3);
  // Over itself, or its own gaps: no drop.
  expect(Tabs.dropIndex(m, "web-3", { id: "web-3", after: true })).toBe(null);
  expect(Tabs.dropIndex(m, "web-3", { id: "web-2", after: true })).toBe(null);
  expect(Tabs.dropIndex(m, "web-3", { id: "web-4", after: false })).toBe(null);
  expect(Tabs.dropIndex(m, "web-3", null)).toBe(null);
  // Leftwards: before the first tab.
  expect(Tabs.dropIndex(m, "web-4", { id: "web", after: false })).toBe(0);
  // The marker: before the tab at the landing place, null at the end, none without a drop.
  expect(Tabs.stakeBefore(m, "web", 1)).toBe("web-3");
  expect(Tabs.stakeBefore(m, "web", 3)).toBe(null);
  expect(Tabs.stakeBefore(m, "web-4", 0)).toBe("web");
  expect(Tabs.stakeBefore(m, "web", null)).toBe(undefined);
});

test("dragging a web tab along the strip: it lifts, a marker shows the gap, the drop moves it and it stays moved after a restart", async () => {
  reset();
  const store = storage();
  try {
    const { view, cx } = await webPane({ slot: "b1", url: "https://a.example" });
    for (const u of ["https://b.example/", "https://c.example/"]) view.onEvent({ id: "web", event: "web.newTab", data: { url: u, background: true } }, cx);
    expect(ids(view)).toEqual(["web", "web-2", "web-3"]);
    let root = view.render();
    const byId = (id: string) => walk(root).find((e: any) => callOf(e, "id").some(([i]: any) => i === id));
    const handler = (el: any, name: string, button?: string) => callOf(el, name).find((a: any) => button == null || a[0] === button)?.at(-1);
    const move = (id: string, x: number, width = 100, at = x) => handler(byId(id), "on_mouse_move")({ position: { x: at }, local_position: { x }, bounds: { width } }, cx);
    // A press on tab 1, then a move under DRAG_START: still a click.
    handler(byId("webtab-web"), "on_mouse_down", "left")({ position: { x: 20 } }, cx);
    move("webtab-web", 22, 100, 22);
    expect(view.drag).toBe(null);
    // Past it, over the right half of tab 3: a drag to the end. Tab 1 lifts, the marker stands at the end (by +).
    move("webtab-web-3", 70, 100, 260);
    expect(view.drag).toEqual({ id: "web", gap: { id: "web-3", after: true } });
    root = view.render();
    const plates = (id: string) => walk(byId(id)).filter((e: any) => callOf(e, "border_color").length && callOf(e, "bg").length).length;
    expect([plates("webtab-web"), plates("webtab-web-2")]).toEqual([1, 0]);
    const staked = (id: string) => walk(byId(id)).some((e: any) => callOf(e, "w").some(([w]: any) => w === 8));
    expect([staked("webtab-web-2"), staked("webtab-web-3"), staked("webtab-new")]).toEqual([false, false, true]);
    expect(callOf(byId("webtabs"), "cursor_grabbing").length).toBe(1);
    // Over the left half of tab 3: the marker before it.
    move("webtab-web-3", 20, 100, 210);
    root = view.render();
    expect([staked("webtab-web-3"), staked("webtab-new")]).toEqual([true, false]);
    // Let go (on tab 3, then the strip): the tab moves there and doesn't show; nothing else happens on the way.
    handler(byId("webtab-web-3"), "on_mouse_up", "left")({}, cx);
    handler(byId("webtabs"), "on_mouse_up", "left")({}, cx);
    expect([ids(view), view.tabs.active, view.drag, view.pressed]).toEqual([["web-2", "web", "web-3"], "web", null, null]);
    // The numbers follow the order: 2 is now web (shown).
    root = view.render();
    expect(strings(byId("webtab-web"))).toContain("2");
    expect(JSON.parse(store.m.get("tabs")!).tabs.map((t: any) => t.id)).toEqual(["web-2", "web", "web-3"]);
    press(view, cx, "1", char("1"));
    expect(view.tabs.active).toBe("web-2");
    // A drag past the end of the strip (the room after +): the end.
    root = view.render();
    handler(byId("webtab-web-2"), "on_mouse_down", "left")({ position: { x: 10 } }, cx);
    handler(byId("webtab-end"), "on_mouse_move")({ position: { x: 400 }, local_position: { x: 5 }, bounds: { width: 80 } }, cx);
    handler(byId("webtabs"), "on_mouse_up", "left")({}, cx);
    expect(ids(view)).toEqual(["web", "web-3", "web-2"]);
    // The pointer leaves the strip mid-drag: nothing moves.
    root = view.render();
    handler(byId("webtab-web"), "on_mouse_down", "left")({ position: { x: 10 } }, cx);
    move("webtab-web-2", 70, 100, 300);
    handler(byId("webtabs"), "on_hover")(false, cx);
    handler(byId("webtabs"), "on_mouse_up", "left")({}, cx);
    expect([ids(view), view.drag]).toEqual([["web", "web-3", "web-2"], null]);
    // Restarted: the order comes back.
    reset();
    const again = await webPane({ slot: "b1", url: "https://a.example" });
    expect(ids(again.view)).toEqual(["web", "web-3", "web-2"]);
  } finally { store.done(); }
});

test("< and > move the tab (the ring's, else the shown one) in the bar's keys; the palette's commands do the same", async () => {
  reset();
  const store = storage();
  try {
    const { view, cx, send } = await webPane({ slot: "b1", url: "https://a.example" });
    app.panes = [{ pane: "p1", mod: "nocturne-browser", props: { slot: "b1" }, tab: "t1" }];
    app.focusedPane = "p1";
    for (const u of ["https://b.example/", "https://c.example/"]) view.onEvent({ id: "web", event: "web.newTab", data: { url: u, background: true } }, cx);
    expect(press(view, cx, ">", char(">"))).toBe(true);
    expect([ids(view), view.tabs.active]).toEqual([["web-2", "web", "web-3"], "web"]);
    press(view, cx, ">", char(">"));
    // At the end it stays.
    press(view, cx, ">", char(">"));
    expect(ids(view)).toEqual(["web-2", "web-3", "web"]);
    press(view, cx, "<", char("<"));
    expect(ids(view)).toEqual(["web-2", "web", "web-3"]);
    // The ring on another tab: that one moves.
    view.handle.is_focused = () => true;
    view.render();
    view.ring = "tab:web-3";
    press(view, cx, "<", char("<"));
    expect(ids(view)).toEqual(["web-2", "web-3", "web"]);
    view.ring = null;
    await send("nocturne-browser.tab_move_left");
    expect(ids(view)).toEqual(["web-2", "web", "web-3"]);
    await send("nocturne-browser.tab_move_right");
    expect(ids(view)).toEqual(["web-2", "web-3", "web"]);
    expect(JSON.parse(store.m.get("tabs")!).tabs.map((t: any) => t.id)).toEqual(["web-2", "web-3", "web"]);
    // Listed under ?.
    expect(view.constructor && (await load("nocturne-browser/main.js")).mod.KEYS.some(([k]: any) => k === "< >")).toBe(true);
  } finally { store.done(); }
});

test("a long title is cut in the strip, not the strip; many tabs share its width", async () => {
  reset();
  const { view, cx } = await webPane({ slot: "b1", url: "https://a.example" });
  view.onEvent({ id: "web", event: "web.newTab", data: { url: "https://b.example/", background: true } }, cx);
  view.onEvent({ id: "web-2", event: "web.location", data: { href: "https://b.example/", title: "A very long title ".repeat(12) } }, cx);
  const root = view.render();
  const strip = walk(root).find((e: any) => callOf(e, "id").some(([i]: any) => i === "webtabs"));
  expect(callOf(strip, "overflow_hidden").length).toBe(1);
  const tab = walk(strip).find((e: any) => callOf(e, "id").some(([i]: any) => i === "webtab-web-2"));
  expect([callOf(tab, "min_w"), callOf(tab, "max_w"), callOf(tab, "flex_1").length]).toEqual([[[0]], [[200]], 1]);
  const title = walk(tab).find((e: any) => e.nodes.includes(Tabs.label(view.tabs.list[1])));
  expect(callOf(title, "truncate").length).toBe(1);
});

test("closing a tab closes its inspector pane; the inspector's chords reach a tab behind too", async () => {
  reset();
  const { view, cx, native } = await webPane({ slot: "b1", url: "https://a.example", copy: 4 });
  view.onEvent({ id: "web", event: "web.newTab", data: { url: "https://b.example/", background: false } }, cx);
  app.panes = [{ pane: "p1", mod: "nocturne-browser", props: { slot: "b1" }, tab: "t1" }, { pane: "pi", mod: "nocturne-browser", props: { inspect: "4:web" }, tab: "t1" }];
  // The inspector of tab 1 is focused, tab 2 shows: its chords are this copy's.
  app.focusedPane = "pi";
  expect(view.mine()).toBe(true);
  app.store["nocturne-browser.inspectors"] = { "4:web": "pi" };
  native.length = 0;
  view.closeTab("web", cx);
  expect(app.ran.at(-1)).toEqual(["pane.close", { pane: "pi" }]);
  expect(native.filter(([, a]) => a === "dispose")).toEqual([["web", "dispose", {}]]);
  expect(ids(view)).toEqual(["web-2"]);
});

test("nocturne-browser.open (the editor's links): the pane named by its slot opens the page in front and takes the keyboard", async () => {
  reset();
  const a = await webPane({ slot: "a", url: "https://a.example", copy: 1 });
  const b = await webPane({ slot: "b", url: "https://b.example", copy: 2 });
  app.panes = [
    { pane: "pa", mod: "nocturne-browser", props: { slot: "a" }, tab: "t1" },
    { pane: "pb", mod: "nocturne-browser", props: { slot: "b" }, tab: "t1" },
    { pane: "pe", mod: "nocturne-editor", props: {}, tab: "t1", focused: true },
  ];
  app.focusedPane = "pe";
  a.view.claim();
  const both = async (c: string) => { await a.send(c); await b.send(c); };
  await both(`open:${JSON.stringify({ url: "https://docs.example/x", slot: "b" })}`);
  expect([ids(a.view), ids(b.view)]).toEqual([["web"], ["web", "web-2"]]);
  expect(b.view.page.href).toBe("https://docs.example/x");
  expect(app.ran.at(-1)).toEqual(["pane.focus", { pane: "pb" }]);
  expect(app.store["nocturne-browser.active"]).toBe("b");
  b.cx.timers.splice(0).forEach((f: Function) => f(b.cx));
  expect(b.native.at(-1)).toEqual(["web-2", "focus", {}]);
  // No slot: the copy that takes the other commands (b, claimed last); a bare address.
  await both("open:docs.example/y");
  expect([ids(a.view).length, ids(b.view).length]).toEqual([1, 3]);
  expect(b.view.page.href).toBe("docs.example/y");
  // Already the focused pane: no pane.focus.
  app.focusedPane = "pb";
  const ran = app.ran.length;
  await both(`open:${JSON.stringify({ url: "https://z.example", slot: "b" })}`);
  expect(app.ran.length).toBe(ran);
  // Nothing to open: nothing.
  await both("open:");
  expect(ids(b.view).length).toBe(4);
});

test("the tabs come back after a restart: the shown one loads, the others when first shown", async () => {
  reset();
  const saved = { active: "web-2", next: 3, tabs: [{ id: "web", href: "https://a.example/", title: "A", zoom: 1 }, { id: "web-2", href: "https://b.example/", title: "B", zoom: 1.1 }] };
  const store = storage({ tabs: JSON.stringify(saved), url: "https://b.example/", zoom: "1.1" });
  try {
    // The props' url is where the pane began: the saved tabs win over it.
    const { view, cx } = await webPane({ slot: "b1", url: "https://a.example/" });
    expect([ids(view), view.tabs.active, view.zoom, view.editing]).toEqual([["web", "web-2"], "web-2", 1.1, false]);
    expect(viewsOf(view.render()).map(([id, , h]) => [id, h])).toEqual([["web-2", false]]);
    expect(strings(view.render())).toEqual(expect.arrayContaining(["A", "B"]));
    press(view, cx, "1", char("1"));
    expect(viewsOf(view.render()).map(([id, p, h]) => [id, p.url, h])).toEqual([["web", "https://a.example/", false], ["web-2", "https://b.example/", true]]);
    // Before tabs: one page saved; it comes back as the one tab.
    reset();
    store.m.delete("tabs");
    store.m.set("url", "https://b.example/");
    const old = await webPane({ slot: "b2" });
    expect([ids(old.view), old.view.start]).toEqual([["web"], "https://b.example/"]);
  } finally { store.done(); }
});

// ---- load errors: only real failures reach the line under the bar

test("a load cut short (another navigation, a download, a tab instead) shows nothing; a real failure says what in words, with retry", async () => {
  const { mod } = await load("nocturne-browser/main.js");
  const f = mod.loadFailure;
  const generic = (domain: string, code: number) => ({ domain, code, message: `The operation couldn’t be completed. (${domain} error ${code}.)`, failingUrl: "https://www.a.example/x" });
  // Not failures: NSURLErrorCancelled, WebKit's "Frame load interrupted", a plug-in's load (also from a build that sends no domain).
  expect([f(generic("NSURLErrorDomain", -999)), f(generic("WebKitErrorDomain", 102)), f(generic("WebKitErrorDomain", 204)),
    f({ code: -999, message: "cancelled" }), f({ code: 102, message: "Frame load interrupted" })]).toEqual([null, null, null, null, null]);
  // Failures, in words, with the address that failed.
  expect(f(generic("NSURLErrorDomain", -1009))).toEqual({ message: "You're offline.", url: "https://www.a.example/x" });
  expect(f(generic("NSURLErrorDomain", -1003))!.message).toBe("Can't find a.example: no such site, or no name server.");
  expect(f(generic("NSURLErrorDomain", -1004))!.message).toBe("a.example doesn't answer.");
  expect(f(generic("NSURLErrorDomain", -1202))!.message).toBe("a.example's certificate isn't trusted.");
  expect(f(generic("WebKitErrorDomain", 101))!.message).toBe("This page can't be shown here: ↗ opens it in the system's browser.");
  // Unknown: WebKit's own words, unless they're the generic "couldn't be completed" (then the code).
  expect(f({ domain: "NSURLErrorDomain", code: -1234, message: "Something specific happened." })!.message).toBe("Something specific happened.");
  expect(f(generic("NSURLErrorDomain", -1234))).toEqual({ message: "The page didn't load (error -1234).", url: "https://www.a.example/x" });
  // A view that couldn't be made (no code): its message as is.
  expect(f({ message: "this window has no native view" })).toEqual({ message: "this window has no native view", url: null });
});

test("the error line: none for a cut-short load, retry goes to the address that failed, the next page clears it", async () => {
  reset();
  const { view, cx, native } = await webPane({ slot: "b1", url: "https://a.example/", copy: 1 });
  view.page = { ...view.page, href: "https://a.example/", loading: true };
  view.onEvent({ id: "web", event: "load.error", data: { domain: "NSURLErrorDomain", code: -999, message: "The operation couldn’t be completed. (NSURLErrorDomain error -999.)" } }, cx);
  expect([view.error, view.page.loading]).toEqual([null, false]);
  expect(strings(view.render()).some((x: string) => /NSURL/.test(x))).toBe(false);
  // Offline while going to b: the line says so, retry (and r) go to b, not a again.
  view.onEvent({ id: "web", event: "load.error", data: { domain: "NSURLErrorDomain", code: -1009, message: "The Internet connection appears to be offline.", failingUrl: "https://b.example/" } }, cx);
  expect(view.error).toBe("You're offline.");
  const root = view.render();
  expect(strings(root)).toEqual(expect.arrayContaining(["You're offline.", "retry  r"]));
  native.length = 0;
  press(view, cx, "r", char("r"));
  expect(native).toEqual([["web", "browser.navigate", { url: "https://b.example/" }]]);
  expect(view.error).toBe(null);
  // Failing again, then the next page starts: the line goes by itself.
  view.onEvent({ id: "web", event: "load.error", data: { domain: "NSURLErrorDomain", code: -1001, failingUrl: "https://b.example/" } }, cx);
  expect(view.error).toBe("b.example took too long to answer.");
  view.onEvent({ id: "web", event: "load.start", data: { href: "https://c.example/", loading: true } }, cx);
  expect([view.error, view.tab.failed]).toEqual([null, null]);
  // Not a load (picture in picture): no retry, and r reloads as ever.
  view.page.loading = false;
  view.onEvent({ id: "web", event: "pip.start", data: { result: "none" } }, cx);
  expect(strings(view.render())).not.toContain("retry  r");
  native.length = 0;
  press(view, cx, "r", char("r"));
  expect(native).toEqual([["web", "browser.reload", {}]]);
});

// ---- item 3: HTML files (the files pane opens them here through nocturne-browser.open)

test("a file:// page loads as the file, its folder readable and its scripts on: as a pane's page, by open, typed in the address, after a restart", async () => {
  expect(Tabs.source("https://a.example/x")).toEqual({ url: "https://a.example/x" });
  expect(Tabs.source("file:///Users/d/site/index%20page.html")).toEqual({ path: "/Users/d/site/index page.html", trust: "interactive" });
  expect(Tabs.source("file://localhost/tmp/a.html#top")).toEqual({ path: "/tmp/a.html", trust: "interactive" });
  expect(Tabs.filePath("file:///tmp/%E0%A4%A.html")).toBe("/tmp/%E0%A4%A.html");
  expect(Tabs.label(Tabs.makeTab("web", "file:///Users/d/site/index.html", 1))).toBe("index.html");
  // Kept across a restart as its address.
  expect(Tabs.source(Tabs.restore('{"tabs":[{"id":"web","href":"file:///a/b.html"}]}', 1)!.list[0].start)).toEqual({ path: "/a/b.html", trust: "interactive" });
  reset();
  // The pane's own page.
  const { view, cx, native, send } = await webPane({ slot: "f1", url: "file:///Users/d/site/index.html", copy: 1 });
  const props = (root: any) => viewsOf(root).map(([id, p]) => [id, p]);
  expect(props(view.render())).toEqual([["web", { kind: "web", path: "/Users/d/site/index.html", trust: "interactive", persist: true, zoom: 0.9, pip: true, tabs: true }]]);
  // The files pane's open: a tab of its own.
  app.panes = [{ pane: "p1", mod: "nocturne-browser", props: { slot: "f1" }, tab: "t1", focused: true }];
  app.focusedPane = "p1";
  await send(`open:${JSON.stringify({ url: "file:///Users/d/site/b.html", slot: "f1" })}`);
  expect(props(view.render()).map(([id, p]: any) => [id, p.path ?? p.url])).toEqual([["web-2", "/Users/d/site/b.html"], ["web", "/Users/d/site/index.html"]]);
  // Typed in the address of a page: the tab's view loads the file in place (navigate takes http only).
  native.length = 0;
  view.go("https://a.example/", cx);
  expect(native[0]).toEqual(["web-2", "browser.navigate", { url: "https://a.example/" }]);
  native.length = 0;
  view.go("file:///Users/d/other.html", cx);
  expect(native.filter(([, a]) => a === "browser.navigate")).toEqual([]);
  expect(props(view.render())[0]).toEqual(["web-2", expect.objectContaining({ path: "/Users/d/other.html", trust: "interactive" })]);
  expect(view.tabs.list.find((t: any) => t.id === "web-2").start).toBe("file:///Users/d/other.html");
});

// ---- the dock's shelf: each web pane's shown title, by slot

test("nocturne-browser.titles: the shown tab's title by the pane's slot, on a title change and a tab switch; gone panes drop out", async () => {
  reset();
  const titles = () => app.store["nocturne-browser.titles"];
  app.panes = [{ pane: "p1", mod: "nocturne-browser", props: { slot: "s1" }, tab: "t1" }, { pane: "p2", mod: "nocturne-browser", props: { slot: "s2" }, tab: "t1" }];
  app.store["nocturne-browser.titles"] = { gone: "Old page", s2: "Other pane" };
  const { view, cx } = await webPane({ slot: "s1", url: "https://a.example/x" });
  // At start: its host until the page says its title; a gone pane's entry goes, another pane's stays.
  expect(titles()).toEqual({ s2: "Other pane", s1: "a.example" });
  view.onEvent({ id: "web", event: "web.location", data: { href: "https://a.example/x", title: "A page" } }, cx);
  expect(titles()).toEqual({ s2: "Other pane", s1: "A page" });
  // The page renames itself.
  view.onEvent({ id: "web", event: "web.location", data: { href: "https://a.example/x", title: "A page (2)" } }, cx);
  expect(titles().s1).toBe("A page (2)");
  // A tab behind loading doesn't change it; switching to it does, and back.
  view.onEvent({ id: "web", event: "web.newTab", data: { url: "https://b.example/", background: true } }, cx);
  view.onEvent({ id: "web-2", event: "web.location", data: { href: "https://b.example/", title: "Bee" } }, cx);
  expect(titles().s1).toBe("A page (2)");
  view.showTab("web-2", cx);
  expect(titles().s1).toBe("Bee");
  // Closing the shown tab: the one shown next.
  view.closeTab("web-2", cx);
  expect(titles().s1).toBe("A page (2)");
  // A blank tab shown: no entry (the shelf falls back to the host or "Web").
  view.openTab(null, {}, cx);
  expect("s1" in titles()).toBe(false);
  // Unchanged: not written again.
  let writes = 0;
  const set = app.store;
  view.showTab("web", cx);
  app.store = new Proxy(set, { set: (o, k, v) => { writes++; o[k as any] = v; return true; } });
  view.publishTitle();
  expect(writes).toBe(0);
  app.store = set;
  // The pane closes: its entry goes.
  await view.close();
  expect(titles()).toEqual({ s2: "Other pane" });
  // A pane without its own slot publishes nothing.
  reset();
  const bare = await webPane({ url: "https://c.example/" });
  bare.view.onEvent({ id: "web", event: "web.location", data: { href: "https://c.example/", title: "C" } }, bare.cx);
  expect(app.store["nocturne-browser.titles"]).toBe(undefined);
});
