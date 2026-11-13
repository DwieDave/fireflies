// The picker's mode switch as the keys drive it, with herdr and gpui stand-ins
// (finder/main.ts and its opener nocturne/picker.js): tab reaches the
// picker as an action bound in its own key context (the base's Root binds tab
// to focus cycling, and actions run before any on_key_down), and cmd-shift-f /
// cmd-p while it's open switch it in place. Every switch keeps the query.
// Its own process: mock.module is process-wide.
import { test, expect, mock, beforeEach } from "bun:test";

// Every element method chains; `when` runs its branch. The root's handlers and
// key context are kept, as GPUI would hold them.
const drawn: string[] = [];
let root: { context?: string; actions: Record<string, Function>; keyDown?: Function } = { actions: {} };
const el: any = new Proxy(function () {}, {
  get: (_t, k) => {
    if (k === "then") return undefined;
    if (k === "when") return (c: any, f: Function) => (c ? f(el) : el);
    if (k === "key_context") return (c: string) => { root.context = c; return el; };
    if (k === "on_action") return (a: string, f: Function) => { root.actions[a] = f; return el; };
    if (k === "on_key_down") return (f: Function) => { root.keyDown = f; return el; };
    if (k === "child") return (c: any) => { if (typeof c === "string") drawn.push(c); return el; };
    return () => el;
  },
  apply: () => el,
});

// herdr: the shared store, overlays, the command queue finder reads.
const store: Record<string, any> = {};
const overlays: { opened: any[]; closed: string[] } = { opened: [], closed: [] };
const queue: string[] = [];
let waiting: ((c: string) => void) | null = null;
const deliver = (c: string) => { if (waiting) { const w = waiting; waiting = null; w(c); } else queue.push(c); };
const searched: string[] = [];
let props: any = {};
mock.module("herdr", () => ({
  props: () => props, theme: () => new Proxy({}, { get: () => "#808080" }),
  settings: () => ({ zoom: 0.9 }), closeOverlay: (id: string) => { overlays.closed.push(id); },
  shared: (k: string) => store[k] ?? null, setShared: (k: string, v: any) => { store[k] = v; },
  run: (name: string) => { const m = /^finder\.(.+)$/.exec(name); if (m) deliver(m[1]); },
  nextCommand: () => (queue.length ? Promise.resolve(queue.shift()!) : new Promise<string>((r) => { waiting = r; })),
  keys: () => [
    { section: "layout:nocturne", keys: "cmd-p", action: "nocturne.picker" },
    { section: "layout:nocturne", keys: "cmd-shift-f", action: "nocturne.grep" },
  ],
  // `test -d`: the folder is there; git: not a repository.
  exec: async (cmd: string) => ({ code: cmd === "test" ? 0 : 1, stdout: "", stderr: "" }),
  findFiles: async (_r: string, q: string) => { searched.push(`files:${q}`); return { files: [], total: 0 }; },
  grep: async (_r: string, q: string) => { searched.push(`grep:${q}`); return { matches: [], files: 0 }; },
  readTextFile: async () => "", highlight: () => [], languageOf: () => null,
  home: () => "/home/me", window: () => ({ platform: "macos" }),
  spaces: () => [{ active: true, attached: true, folder: "/src", machine: null }], panes: () => [], focused: () => null,
  openOverlay: (spec: any) => { overlays.opened.push(spec); return `o${overlays.opened.length}`; },
}));
mock.module("gpui-kit", () => ({ div: () => el, View: class {}, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
// One text box: its value survives the box being made again (as set_value would).
const box = { v: "", placeholder: "", handlers: {} as Record<string, Function>, on(e: string, f: Function) { this.handlers[e] = f; return true; }, value() { return this.v; }, focus() {}, release() { return true; } };
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, Input: { new: () => el }, Scrollbar: { vertical: () => el },
  v_virtual_list: () => el,
  VirtualListScrollHandle: { new: () => ({ scroll_to_item() {} }) },
  InputState: { new: (o: any) => { box.placeholder = o?.placeholder ?? ""; box.v = o?.value ?? ""; return box; } },
}));
globalThis.window = { paint_path: () => el } as any;

const bindings: any[] = [];
const cx: any = {
  spawn: (f: Function) => { Promise.resolve(f(cx)); },
  notify() {}, stop_propagation() {},
  bind_keys: (b: any[]) => { bindings.push(...b); return b.length; },
  timer: { after() {}, every() {} },
};
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

const { default: Picker } = await import("../defaults/mods/finder/main.ts");
const { togglePicker } = await import("../defaults/mods/nocturne/picker.js");

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  overlays.opened.length = 0; overlays.closed.length = 0; queue.length = 0; waiting = null;
  searched.length = 0; root = { actions: {} }; box.v = "";
});

/** The opener's overlay, mounted: the picker it asked for, with a query typed. */
async function openWith(mode: "files" | "grep", query: string) {
  togglePicker(mode);
  props = { ...overlays.opened.at(-1).props, overlay: `o${overlays.opened.length}` };
  const p: any = new Picker();
  p.init({}, cx);
  await settle();
  box.v = query;
  p.render(cx);
  return p;
}

test("tab is bound in the picker's own key context, and the action switches mode keeping the query", async () => {
  const p = await openWith("files", "main.rs");
  const tab = bindings.find((b) => b.keystroke === "tab");
  const back = bindings.find((b) => b.keystroke === "shift-tab");
  expect(tab?.context).toBe("NocturnePicker");
  expect(back?.action).toBe(tab.action);
  expect(root.context).toBe("NocturnePicker");
  // GPUI dispatches the bound action to the root's on_action.
  root.actions[tab.action]({ action: tab.action }, cx);
  await settle();
  expect(p.mode).toBe("grep");
  expect(p.input.value()).toBe("main.rs");
  expect(box.placeholder).toBe("grep");
  expect(searched.at(-1)).toBe("grep:main.rs");
  // The opener's note follows: cmd-shift-f now closes it.
  expect(store["nocturne.picker-open"].mode).toBe("grep");
  root.actions[back.action]({ action: back.action }, cx);
  await settle();
  expect(p.mode).toBe("files");
  expect(p.input.value()).toBe("main.rs");
});

test("tab still switches through the key handler when no binding took it", async () => {
  const p = await openWith("files", "x");
  root.keyDown!({ keystroke: "tab", key: "tab", modifiers: {} }, cx);
  await settle();
  expect(p.mode).toBe("grep");
  expect(p.input.value()).toBe("x");
});

test("cmd-shift-f in an open file picker switches it to grep in place, and cmd-p back, the query kept", async () => {
  const p = await openWith("files", "needle");
  togglePicker("grep"); // cmd-shift-f: nocturne.grep
  await settle();
  expect(overlays.closed).toEqual([]);
  expect(overlays.opened.length).toBe(1);
  expect(p.mode).toBe("grep");
  expect(p.input.value()).toBe("needle");
  expect(searched.at(-1)).toBe("grep:needle");
  togglePicker("files"); // cmd-p: nocturne.picker
  await settle();
  expect(overlays.opened.length).toBe(1);
  expect(p.mode).toBe("files");
  expect(p.input.value()).toBe("needle");
  expect(searched.at(-1)).toBe("files:needle");
});

test("the same key again closes the picker, also after a switch", async () => {
  await openWith("files", "a");
  togglePicker("files");
  expect(overlays.closed).toEqual(["o1"]);
  expect(store["nocturne.picker-open"]).toBeNull();
  const p = await openWith("files", "b");
  root.actions[bindings.find((b) => b.keystroke === "tab").action]({}, cx); // tab: grep
  await settle();
  expect(p.mode).toBe("grep");
  togglePicker("grep"); // cmd-shift-f in grep: closes
  expect(overlays.closed.at(-1)).toBe("o2");
});

test("the picker opens over most of the window", async () => {
  togglePicker("files");
  const spec = overlays.opened[0];
  expect(spec.width).toBeGreaterThanOrEqual(0.85);
  expect(spec.width).toBeLessThanOrEqual(1);
  expect(spec.height).toBeGreaterThanOrEqual(0.8);
  expect(spec.height).toBeLessThanOrEqual(1);
});

test("the hint bar names every key, the switch's two side by side; each chip carries its key", async () => {
  const p = await openWith("files", "");
  drawn.length = 0;
  p.render(cx);
  // Hint bar: ↑↓ / ctrl-p ctrl-n pick, pgup pgdn page, enter edit, tab / cmd-shift-f grep, esc close.
  const at = drawn.indexOf("tab");
  expect(drawn.slice(at, at + 4)).toEqual(["tab", "/", "cmd-shift-f", "grep"]);
  for (const k of ["↑↓", "ctrl-p ctrl-n", "pgup pgdn", "enter", "esc"]) expect(drawn).toContain(k);
  // Chips: "files cmd-p", "grep cmd-shift-f".
  expect(drawn.slice(drawn.indexOf("files"), drawn.indexOf("files") + 2)).toEqual(["files", "cmd-p"]);
  expect(drawn.filter((d) => d === "cmd-shift-f").length).toBe(2);
  p.setMode("grep", cx);
  drawn.length = 0;
  p.render(cx);
  const back = drawn.indexOf("tab");
  expect(drawn.slice(back, back + 4)).toEqual(["tab", "/", "cmd-p", "files"]);
  for (const k of ["ctrl-r", "ctrl-t"]) expect(drawn).toContain(k);
});

test("the opener's note names the open picker, and only that picker's close clears it", async () => {
  const p = await openWith("files", "");
  expect(store["nocturne.picker-open"]).toEqual({ id: "o1", mode: "files" });
  // A note about another picker stays (a reload's old copy closing late).
  store["nocturne.picker-open"] = { id: "o7", mode: "grep" };
  await p.close();
  expect(store["nocturne.picker-open"]).toEqual({ id: "o7", mode: "grep" });
  store["nocturne.picker-open"] = { id: "o1", mode: "files" };
  await p.close(); // esc
  expect(store["nocturne.picker-open"]).toBeNull();
});
