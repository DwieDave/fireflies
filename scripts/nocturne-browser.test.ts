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
async function load(path: string, own: { props?: any; copy?: number } = {}) {
  const source = await readFile(new URL(`../defaults/mods/${path}`, import.meta.url), "utf8");
  const names: string[] = [];
  const body = source
    .replace(/^import .*;\n/gm, "")
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
    nativeView: { new: () => new Element() },
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
      return { handlers, focused: 0, value: () => "", on(e: string, f: Function) { handlers[e] = f; }, focus() { this.focused++; }, set_value() {} };
    } },
  };
  const scope: Record<string, unknown> = { ...kit, ...base, ...herdr, herdr, appWindow: herdr.window, window: { paint_path: () => new Element() } };
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
  expect(press(view, cx, "x", char("x"))).toBe(false);
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
  press(view, cx, "escape");
  expect([view.ring, view.keysShown]).toEqual([null, true]);
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
  view.input.handlers.submit({}, cx);
  // (the stand-in field's value is "", so nothing to go to)
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
  press(a.view, a.cx, "x", char("x"));
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
