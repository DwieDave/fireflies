// Stand-ins for gpui-kit, gpui-base and herdr, so a dialog's render and key
// handler run under bun: elements record their calls and children, `when`
// runs its branch, and the herdr calls a dialog makes are logged. Imported
// before the dialog's module; mock.module is process-wide, so a test file
// using this runs in its own `bun test` process.
import { mock } from "bun:test";

export class Element {
  nodes: any[] = [];
  calls: Record<string, any[]> = {};
  actions: Record<string, any> = {}; // every on_action handler, by action name
  constructor() {
    const proxy: Element = new Proxy(this, {
      get: (target, key: string) => key in target ? (target as any)[key] : (...args: any[]) => {
        if (key === "child") target.nodes.push(args[0]);
        else if (key === "children") target.nodes.push(...args[0]);
        else if (key === "when") { if (args[0]) return args[1](proxy) ?? proxy; }
        else if (key === "map") return args[0](proxy) ?? proxy;
        else if (key === "on_action") { target.actions[args[0]] = args[1]; target.calls[key] = args; }
        else target.calls[key] = args;
        return proxy;
      },
    });
    return proxy;
  }
}
const el = () => new Element();

export function find(root: any, id: string): Element | undefined {
  if (root?.calls?.id?.[0] === id) return root;
  for (const child of root?.nodes ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
}

/** Every text a tree shows, in order. */
export function texts(root: any): string[] {
  if (typeof root === "string") return [root];
  return (root?.nodes ?? []).flatMap(texts);
}

/** Whether `root` has a focus ring child (an absolute inset border in the accent). */
export function ringed(root: Element | undefined) {
  return (root?.nodes ?? []).some((n: any) => n?.calls?.inset_0 && n?.calls?.border_color?.[0] === theme.accent);
}

export const theme: Record<string, string> = {
  accent: "#80a0ff", foreground: "#fff", background: "#000", muted: "#aaa", dim: "#777", border: "#333", raised: "#222", hover: "#111",
  ansi0: "#1", ansi2: "#2", ansi8: "#8", blocked: "#f00", done: "#0f0", working: "#ff0", input: "#444", popover: "#000",
  accent_foreground: "#000", surface: "#000", selected: "#123", solid: "#fff", solid_foreground: "#000",
};

export const state = {
  props: {} as any,
  shared: {} as Record<string, unknown>,
  runs: [] as [string, any][],
  closed: [] as unknown[],
  opened: [] as any[],
  keys: [] as any[],
  settings: { zoom: 1, font_family: "Mono", ui_font_family: "Geist", font_size: 13, theme_light: "a", theme_dark: "b" } as any,
};

class Input { value_ = ""; focused = 0; handlers: Record<string, any> = {}; constructor(o: any = {}) { this.value_ = o.value ?? ""; }
  static new(o?: any) { return new Input(o); }
  on(ev: string, f: any) { this.handlers[ev] = f; } focus() { this.focused++; } value() { return this.value_; }
  set_value(v: string) { this.value_ = v; } set_selected_range() {} release() {} set_auto_grow() {} }
class Scroll { items: number[] = []; static new() { return new Scroll(); } scroll_to_item(i: number) { this.items.push(i); } }

mock.module("gpui-kit", () => ({
  View: class {}, div: el, svg: el, image: el,
  PathBuilder: { fill: () => new Proxy({}, { get: (_t, _k) => function (this: any) { return this; } }) },
  Background: { checkerboard: () => ({}) },
}));
mock.module("gpui-base", () => ({
  v_flex: el, h_flex: el, InputState: Input, Input: { new: el }, ScrollHandle: Scroll, VirtualListScrollHandle: Scroll,
  Scrollbar: { vertical: el }, Popup: { new: (_id: string, trigger: any) => { const p = el(); p.nodes.push(trigger); return p; } },
  Checkbox: el, Switch: el, Button: el, TextView: { html: el, markdown: el },
  TextareaState: Input, Textarea: { new: el }, EditorState: Input, Editor: { new: el },
}));
mock.module("herdr", () => ({
  props: () => state.props, theme: () => theme, themes: () => [{ name: "b", colors: theme }, { name: "a", light: true, colors: theme }],
  settings: () => state.settings, layouts: () => ["main", "nocturne"], fonts: () => ["Alpha", "Beta", "Gamma"],
  shared: (k: string) => state.shared[k] ?? null, setShared: (k: string, v: unknown) => { state.shared[k] = v; },
  run: (name: string, args?: any) => { state.runs.push([name, args]); return null; },
  closeOverlay: (id: unknown) => { state.closed.push(id); }, openOverlay: (spec: any) => { state.opened.push(spec); return `ov${state.opened.length}`; },
  keys: () => state.keys, window: () => ({ platform: "macos" }), spaces: () => [], panes: () => [], terminals: () => [], agents: () => [],
  focused: () => null, commands: () => [], hc: async () => ({ code: 1, stdout: "", stderr: "" }),
  updates: () => ({ app: { version: "1.0", updates: true }, core: { version: "1.0" }, checks: true, checked: 1, notes: [] }),
  appHome: () => "/tmp/none", home: () => "/tmp", readTextFile: async () => null, writeTextFile: async () => {}, playSound: () => {},
  presentUpdateNotes: () => {}, knownAgents: async () => [], nextCommand: () => new Promise(() => {}), exec: async () => ({ code: 1 }),
  feedbackIssue: (title: string, message: string) => ({ title: title || message.split("\n")[0], body: message, url: `https://github.com/DwieDave/fireflies/issues/new?title=${encodeURIComponent(title || message.split("\n")[0])}` }),
  pickFolder: async () => null, watchFolder: () => {}, languageOf: () => null, highlight: () => [], lspStart: async () => null, lspRequest: async () => null,
  lspNotify: () => {}, lspNextMessage: () => new Promise(() => {}), lspRelease: () => {}, setUnsaved: () => {}, notify: () => {},
}));

/** A context: notify / stop counted, timers and spawns ignored. */
export function cx() {
  const c: any = { notified: 0, stopped: 0 };
  c.notify = () => { c.notified++; };
  c.stop_propagation = () => { c.stopped++; };
  c.focus_handle = () => ({ focused: 0, focus() { this.focused++; } });
  c.timer = { after() {}, every() {} };
  c.spawn = () => {};
  c.write_to_clipboard = (s: string) => { c.clipboard = s; };
  c.bind_keys = (b: any[]) => { (globalThis as any).boundKeys = [...((globalThis as any).boundKeys ?? []), ...b]; return b.length; };
  return c;
}

/** A key event: `key` with modifiers from a "shift-tab" style name. */
export function key(name: string) {
  const parts = name.split("-");
  const k = parts.pop()!;
  const has = (m: string) => parts.includes(m);
  return { key: k, keystroke: name, key_char: k.length === 1 ? k : null,
    modifiers: { shift: has("shift"), control: has("ctrl"), alt: has("alt"), platform: has("cmd") } };
}

/** A bound action on the root of a render (form-keys.ts binds tab / shift-tab to some). */
export function act(root: any, name: string, c = cx()) {
  const f = root.actions?.[name];
  if (!f) throw new Error(`no ${name} action on the root (has ${Object.keys(root.actions ?? {}).join(", ")})`);
  f({}, c);
  return c;
}

/** The root's key handler of a render. */
export function press(root: any, name: string, c = cx()) {
  root.calls.on_key_down[0](key(name), c);
  return c;
}

// kit.js paints its dither through the global `window`.
(globalThis as any).window = { paint_path: () => el() };
