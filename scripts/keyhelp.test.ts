// Nocturne's one key help (defaults/mods/nocturne/keyhelp.ts): every copy
// in a nocturne mod is byte-identical to the source, and in every mod that
// lists its keys ? opens the same overview and ? or esc closes it. herdr and
// gpui stand-ins (mock.module is process-wide: this file runs alone).
import { NOCTURNE_MODS } from "./nocturne-mods.ts";
import { test, expect, mock } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "fs";

class El {
  kids: any[] = [];
  calls: Record<string, any[]> = {};
  constructor() {
    return new Proxy(this, {
      get: (t, k: string, proxy) => k in t ? (t as any)[k] : k === "then" ? undefined : (...a: any[]) => {
        if (k === "child") t.kids.push(a[0]);
        else if (k === "children") t.kids.push(...a[0]);
        else if (k === "when") { if (a[0]) a[1](proxy); }
        else if (k === "map") return a[0](proxy);
        else t.calls[k] = a;
        return proxy;
      },
    });
  }
}
const texts = (e: any): string[] => typeof e === "string" ? [e] : e instanceof Object && "kids" in e ? e.kids.flatMap(texts) : [];
const theme: any = new Proxy({}, { get: () => "#808080" });
const opened: any[] = [];
const closed: any[] = [];
let propsNow: any = {};
const herdr: Record<string, any> = {
  settings: () => ({ zoom: 1 }), window: () => ({ platform: "macos" }), agents: () => [], appHome: () => "/tmp/app",
  closeOverlay: (id: any) => { closed.push(id); }, commands: () => [], exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => null,
  hc: async () => ({ code: 1, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: async () => [], layout: () => ({}),
  layouts: () => ["nocturne"], nextCommand: () => new Promise(() => {}), notify: () => {}, openOverlay: (o: any) => { opened.push(o); return "o1"; },
  panes: () => [], pickFolder: async () => null, presentUpdateNotes: () => {}, props: () => propsNow, run: () => null, setAgentOrder: () => {},
  setShared: () => {}, shared: () => null, spaces: () => [], terminals: () => [], theme: () => theme, updates: () => ({ notes: [] }),
  findFiles: async () => [], readTextFile: async () => null, writeTextFile: async () => {}, watchFolder: () => {},
  languageOf: () => null, highlight: () => [], lspStart: () => null, lspRequest: async () => null, lspNotify: () => null, lspNextMessage: () => new Promise(() => {}), lspRelease: () => null, setUnsaved: () => null,
  nativeView: { new: () => new El() }, nativeViewCall: () => null, nextNativeViewEvent: () => new Promise(() => {}),
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: () => new El(), image: () => new El(), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} set_selected_range() {} }
mock.module("gpui-base", () => ({
  h_flex: () => new El(), v_flex: () => new El(), v_virtual_list: () => new El(), Scrollbar: { new: () => new El(), vertical: () => new El() },
  InputState: { new: () => new Input() }, Input: { new: () => new El() }, TextView: { html: () => new El(), markdown: () => new El() },
  TextareaState: { new: () => new Input() }, Textarea: { new: () => new El() }, EditorState: { new: () => new Input() }, Editor: { new: () => new El() },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) }, VirtualListScrollHandle: { new: () => ({ scroll_to_item() {} }) },
}));
(globalThis as any).window = { paint_path: () => new El() };

// ---- keys as GPUI sends them, and as the lists spell them


const MODS = `${import.meta.dir}/../defaults/mods`;
const SOURCE = readFileSync(`${MODS}/nocturne/keyhelp.ts`, "utf8");

test("every nocturne mod's keyhelp.ts is the source, byte for byte", () => {
  const copies = NOCTURNE_MODS.filter((m) => existsSync(`${MODS}/${m}/keyhelp.ts`));
  for (const m of copies) expect([m, readFileSync(`${MODS}/${m}/keyhelp.ts`, "utf8") === SOURCE]).toEqual([m, true]);
  // Each mod that imports it has its copy, and every mod with a ? overview imports it.
  const users = ["nocturne", ...NOCTURNE_MODS].filter((m) => readdirSync(`${MODS}/${m}`).some((f) => /\.(js|ts)$/.test(f) && !f.endsWith(".d.ts") && f !== "keyhelp.ts"
    && readFileSync(`${MODS}/${m}/${f}`, "utf8").includes('from "./keyhelp.ts"')));
  expect(users.filter((m) => m !== "nocturne").sort()).toEqual(copies.sort());
  expect(users.sort()).toEqual(["agent-graph", "browser", "editor", "file-tree", "git", "github",
    "markdown", "nocturne", "notifications", "pip", "preview", "procs", "scripts", "usage"]);
});

const kh = await import("../defaults/mods/nocturne/keyhelp.ts");

test("keysKey: ? toggles; esc and q close only while it's open; modifiers leave it alone", () => {
  const e = (key: string, key_char?: string, mods: any = {}) => ({ key, key_char, modifiers: { shift: false, control: false, alt: false, platform: false, ...mods } });
  expect(kh.keysKey(e("/", "?", { shift: true }), false)).toBe("toggle");
  expect(kh.keysKey(e("/", "?", { shift: true }), true)).toBe("toggle");
  expect(kh.keysKey(e("escape"), true)).toBe("close");
  expect(kh.keysKey(e("q", "q"), true)).toBe("close");
  expect(kh.keysKey(e("escape"), false)).toBe(null);
  expect(kh.keysKey(e("q", "q"), false)).toBe(null);
  expect(kh.keysKey(e("/", "?", { platform: true }), false)).toBe(null);
});

test("the overview: KEYS, the title, ? esc close, then each section's keys; a bar's ? keys", () => {
  const v = kh.keysView(theme, { id: "x", title: "files", list: [{ title: "list", keys: [["j k", "move"]] }, { title: "window", keys: [["?", "keys"]] }] });
  expect(texts(v)).toEqual(["KEYS", "files", "? esc", "close", "LIST", "j k", "move", "WINDOW", "?", "keys"]);
  expect(texts(kh.keysHint(theme, "h", false, () => {}))).toEqual(["?", "keys"]);
  expect(texts(kh.keysHint(theme, "h", false, () => {}, "cmd-k ?"))).toEqual(["cmd-k ?", "keys"]);
  expect(texts(kh.hintBar(theme, "b", [["j", "down"]], { keys: { on: false, toggle() {} } }))).toEqual(["j", "down", "?", "keys"]);
  // A dialog's height grows with the rows and with words that wrap.
  expect(kh.keysHeight([["a", "x".repeat(200)]], 400)).toBeGreaterThan(kh.keysHeight([["a", "x"]], 400));
});

// ---- each mod: ? opens it, ? closes it, ? then esc closes it

const nop = () => {};
function surface(Cls: any, keep: string[], fields: Record<string, any>) {
  const o: any = Object.create(Cls.prototype);
  for (let p = Cls.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const name of Object.getOwnPropertyNames(p)) {
      if (name === "constructor" || keep.includes(name)) continue;
      const d = Object.getOwnPropertyDescriptor(p, name);
      if (typeof d?.value === "function" && !(name in fields)) o[name] = nop;
    }
  }
  return Object.assign(o, fields);
}
const cx = (): any => ({ stopped: 0, stop_propagation() { this.stopped++; }, notify() {}, spawn() {}, write_to_clipboard() {}, timer: { after() {}, every() {} }, focus_handle: () => ({ focus() {}, is_focused: () => true }) });
const QUESTION = { key: "/", key_char: "?", keystroke: "shift-/", modifiers: { shift: true, control: false, alt: false, platform: false } };
const ESC = { key: "escape", key_char: null, keystroke: "escape", modifiers: { shift: false, control: false, alt: false, platform: false } };
/** ? opens (the overview drawn: KEYS first), ? closes, ? then esc closes. */
function opensAndCloses(name: string, press: (e: any) => void, open: () => boolean, draw: () => any) {
  expect([name, open()]).toEqual([name, false]);
  press(QUESTION);
  expect([name, open()]).toEqual([name, true]);
  expect([name, texts(draw())[0]]).toEqual([name, "KEYS"]);
  press(QUESTION);
  expect([name, open()]).toEqual([name, false]);
  press(QUESTION);
  press(ESC);
  expect([name, open()]).toEqual([name, false]);
}

test("agents: ? opens the overview, ? or esc closes it", async () => {
  const m = await import("../defaults/mods/agent-graph/main.ts");
  const v: any = surface(m.default, ["key", "helpPanel"], { help: false });
  opensAndCloses("agents", (e) => v.key(e, cx()), () => v.help, () => v.helpPanel(theme));
});

test("GitHub: ? opens the overview, ? or esc closes it", async () => {
  const m = await import("../defaults/mods/github/main.js");
  const v: any = surface(m.default, ["key", "helpPanel"], { help: false, confirm: null, picker: null, shown: () => ({}), tab: "prs", repo: {} });
  opensAndCloses("github", (e) => v.key(e, cx()), () => v.help, () => v.helpPanel(theme));
});

test("script runner: ? opens the overview, ? or esc closes it", async () => {
  const m = await import("../defaults/mods/scripts/main.ts");
  const v: any = surface(m.default, ["onKey", "helpView"], { help: false, output: null, typing: false, query: "", cursor: 0, page: 5, groups: () => [0] });
  opensAndCloses("scripts", (e) => v.onKey(e, cx(), []), () => v.help, () => v.helpView(theme, 300).kids[0]);
});

test("notifications: ? opens the overview, ? or esc closes it", async () => {
  const m = await import("../defaults/mods/notifications/overview.js");
  const v: any = surface(m.default, ["key", "keysStrip"], { but: null, keysShown: false, cursor: 0, list: () => [], current: () => null });
  opensAndCloses("notifications", (e) => v.key(e, cx()), () => v.keysShown, () => v.keysStrip(theme));
});

test("usage: ? opens the overview, ? or esc closes it", async () => {
  const m = await import("../defaults/mods/usage/main.ts");
  const v: any = surface(m.default, ["key", "keysStrip"], { keysShown: false });
  opensAndCloses("usage", (e) => v.key(e, cx()), () => v.keysShown, () => v.keysStrip(theme));
});

test("markdown: ? opens the overview, ? or esc closes it", async () => {
  const m = await import("../defaults/mods/markdown/main.ts");
  const v: any = surface(m.default, ["key", "keysStrip"], { sel: null, keysShown: false, shown: () => ({ viewH: 400, scrollY: 0 }) });
  opensAndCloses("markdown", (e) => v.key(e, cx()), () => v.keysShown, () => v.keysStrip(theme));
});

test("preview: ? opens the overview in the file's place, ? or esc closes it", async () => {
  const m = await import("../defaults/mods/preview/main.ts");
  const v: any = surface(m.default, ["key", "barKey", "keysStrip"], { how: { how: "image" }, kind: "image", keysShown: false, ring: null, chips: [], editable: () => true, db: null, pages: 1 });
  opensAndCloses("preview", (e) => v.key(e, cx()), () => v.keysShown, () => v.keysStrip(theme).kids[0]);
});

test("web pane: ? opens the overview in the page's place, ? or esc closes it", async () => {
  const m = await import("../defaults/mods/browser/main.ts");
  const tabs = await import("../defaults/mods/browser/tabs.ts");
  const v: any = surface(m.default, ["key", "barKey", "keysStrip"], { tabs: tabs.single("https://a.example/", 0.9), editing: false, controls: [], ring: null, keysShown: false, video: true });
  opensAndCloses("browser", (e) => v.key(e, cx()), () => v.keysShown, () => v.keysStrip(theme).kids[0]);
});

test("files: ? opens the overview, ? or esc closes it", async () => {
  const m = await import("../defaults/mods/file-tree/main.js");
  const v: any = surface(m.default, ["key", "keysStrip"], { menu: null, typing: false, query: "", alone: false, keysShown: false, shown: () => [], sel: null, folders: new Set(), root: "/r",
    input: { focus() {} }, handle: { focus() {} }, size: { width: 280, height: 600 } });
  opensAndCloses("files", (e) => v.key(e, cx()), () => v.keysShown, () => v.keysStrip(theme));
});

test("editor: its chord (the keys command) opens the overview, which holds the keyboard; ? or esc closes it", async () => {
  const m = await import("../defaults/mods/editor/main.js");
  const focus = { keys: 0, editor: 0 };
  const v: any = surface(m.default, ["command", "toggleKeys", "keysStrip"], { keysShown: false, view: "text", vimOn: () => true,
    keysHandle: { focus() { focus.keys++; } }, editor: { focus() { focus.editor++; } }, previewHandle: { focus() {} } });
  const press = (e: any) => {
    if (!v.keysShown) { if (e === QUESTION) v.command("keys", cx()); return; }
    v.keysStrip(theme).calls.on_key_down[0](e, cx());
  };
  opensAndCloses("editor", press, () => v.keysShown, () => v.keysStrip(theme).kids[0]);
  expect(focus.keys).toBe(2);
  expect(focus.editor).toBe(2);
});

test("git: ? opens the keys overview, ? or esc closes it (its rows run as a menu's)", async () => {
  const { Popups } = await import("../defaults/mods/git/popups.js");
  let ran = 0;
  const p: any = new Popups({ focusSelf() {} });
  const open = () => p.keys({ title: "git · files", sections: [{ title: "files", keys: [Object.assign(["space", "Stage", () => { ran++; }], { key: "space" })] }] });
  const press = (e: any) => { if (!p.open) { if (e === QUESTION) open(); return; } p.key(e.key === "escape" ? "escape" : "?", e, cx()); };
  opensAndCloses("git", press, () => Boolean(p.open), () => p.render(theme, { width: 900, height: 600 }).kids[0]);
  open();
  p.key("enter", { key: "enter", modifiers: {} }, cx());
  expect([ran, Boolean(p.open)]).toEqual([1, false]);
});

test("picture in picture: ? opens the overview in a popup (the video is native), ? or esc closes it", async () => {
  const m = await import("../defaults/mods/pip/main.ts");
  opened.length = 0;
  const v: any = surface(m.default, ["command", "openKeys"], { menu: null });
  v.command("keys");
  expect(opened.at(-1)).toMatchObject({ mod: "pip", kind: "popup", props: { keys: true } });
  // As the app opens it: its props carry the overlay's id, which closing it names.
  propsNow = { keys: true, overlay: "o-keys" };
  const k: any = surface(m.default, ["renderKeys"], { handle: { focus() {} } });
  const root = k.renderKeys(theme);
  expect(texts(root)[0]).toBe("KEYS");
  for (const e of [QUESTION, ESC]) {
    closed.length = 0;
    root.calls.on_key_down[0](e, cx());
    expect(closed).toEqual(["o-keys"]);
  }
  propsNow = {};
});

test("Nocturne's chrome (sidebar, tab strip, header, parked chips): ? opens the overview in a dialog, ? or esc closes it", async () => {
  const menu = await import("../defaults/mods/nocturne/menu.js");
  opened.length = 0;
  menu.openKeys("sidebar keys", [["j k", "move"], ["?", "keys"]]);
  expect(opened.at(-1)).toMatchObject({ mod: "nocturne", kind: "dialog", props: { role: "keyshelp", title: "sidebar keys" } });
  propsNow = opened.at(-1).props;
  const d: any = new menu.KeysDialog();
  d.init({}, cx());
  const root = d.render();
  expect(texts(root).slice(0, 2)).toEqual(["KEYS", "sidebar keys"]);
  for (const e of [QUESTION, ESC]) {
    closed.length = 0;
    root.calls.on_key_down[0](e, cx());
    expect(closed.length).toBe(1);
  }
});

test("welcome and what's new: ? opens the overview over the page, ? or esc closes it", async () => {
  const s = await import("../defaults/mods/nocturne/screens.js");
  const c = { focus_handle: () => ({ focus() {} }), timer: { after() {}, every() {} }, spawn() {}, notify() {} };
  const w: any = new s.Welcome();
  w.init({}, c);
  w.done = nop;
  opensAndCloses("welcome", (e) => w.render().calls.on_key_down[0](e, cx()), () => Boolean(w.keysShown), () => {
    const all = (e: any): any[] => (e?.kids ? [e, ...e.kids.flatMap(all)] : []);
    return all(w.render()).find((x) => x.calls?.id?.[0] === "w-keys-strip");
  });
  const n: any = new s.WhatsNew();
  n.init({}, c);
  n.done = nop;
  opensAndCloses("what's new", (e) => n.key(e, cx()), () => Boolean(n.keysShown), () => {
    const all = (e: any): any[] => (e?.kids ? [e, ...e.kids.flatMap(all)] : []);
    return all(n.render()).find((x) => x.calls?.id?.[0] === "wn-keys-strip");
  });
});

// ---- not key help, the same stand-ins: the editor's line numbers keep their room

test("editor: the gutter's numbers sit in from the pane's edge as the top bar's text (a 4-digit file touched the border)", async () => {
  const m = await import("../defaults/mods/editor/main.js");
  const v: any = surface(m.default, ["body"], { state: "ready", markdown: false, view: "text", editor: {} });
  const body = v.body(theme, "mono");
  expect(body.calls.pl).toEqual([m.GUTTER_INSET]);
  expect(m.GUTTER_INSET).toBe(12);
});

test("editor: the asked-for hover (cmd-i) says why there's no answer; the pointer's hover stays quiet", async () => {
  const m = await import("../defaults/mods/editor/main.js");
  const v: any = surface(m.default, ["showCard", "serverNote", "cardState", "answered", "ask", "settling"], { problems: [], lang: "rust", path: "/p/a.rs", hovers: new Map(), progress: new Map(),
    server: { status: "none", why: "missing", names: ["rust-analyzer"], envrc: "/p", envKind: "blocked" } });
  v.showCard(1, 2, true, cx());
  expect(v.card.note.text).toMatch(/\/p\/\.envrc isn't allowed/);
  expect(v.card.note.fix).toBe("Run `direnv allow` in /p.");
  v.card = null;
  v.showCard(1, 2, false, cx());
  expect(v.card).toBe(null);
  // A running server with nothing there: asked, the card says so.
  let answer: (h: any) => void = () => {};
  Object.assign(v, { server: { status: "ready", id: 1, name: "rust-analyzer" }, request: () => new Promise((r) => { answer = r; }) });
  // The answer comes in a task (its cx outlives the key's call).
  v.showCard(1, 2, true, { ...cx(), spawn(fn: any) { fn(cx()); } });
  answer(null);
  await Promise.resolve(); await Promise.resolve();
  expect(v.card.note.text).toBe("rust-analyzer has nothing for this place.");
});
