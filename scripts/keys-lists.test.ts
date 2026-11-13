// Every ? list names every key its handler takes, and the keys dialog has
// plain words for every shipped binding. Each surface's real key handler is
// pressed with every key (letters, digits, punctuation, the named keys and the
// chords the mods use); a key it takes (stops propagation) must be named in
// its list. gpui and herdr stand-ins (mock.module is process-wide: this file
// runs alone).
import { keysNow } from "./nocturne-mods.ts";
import { test, expect, mock } from "bun:test";

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
const herdr: Record<string, any> = {
  settings: () => ({ zoom: 1 }), window: () => ({ platform: "macos" }), agents: () => [], appHome: () => "/tmp/app",
  closeOverlay: () => {}, commands: () => [], exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => null,
  hc: async () => ({ code: 1, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: async () => [], layout: () => ({}),
  layouts: () => ["nocturne"], nextCommand: () => new Promise(() => {}), notify: () => {}, openOverlay: (o: any) => { opened.push(o); return "o1"; },
  panes: () => [], pickFolder: async () => null, presentUpdateNotes: () => {}, props: () => ({}), run: () => null, setAgentOrder: () => {},
  setShared: () => {}, shared: () => null, spaces: () => [], terminals: () => [], theme: () => theme, updates: () => ({ notes: [] }),
  findFiles: async () => [], readTextFile: async () => null, writeTextFile: async () => {}, watchFolder: () => {},
  highlight: () => [], languageOf: () => null,
  nativeView: { new: () => new El() }, nativeViewCall: () => null, nextNativeViewEvent: () => new Promise(() => {}),
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: () => new El(), image: () => new El(), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} set_selected_range() {} }
mock.module("gpui-base", () => ({
  h_flex: () => new El(), v_flex: () => new El(), v_virtual_list: () => new El(), Scrollbar: { new: () => new El(), vertical: () => new El() },
  InputState: { new: () => new Input() }, Input: { new: () => new El() }, TextView: { html: () => new El(), markdown: () => new El() },
  TextareaState: { new: () => new Input() }, Textarea: { new: () => new El() },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) }, VirtualListScrollHandle: { new: () => ({ scroll_to_item() {} }) },
}));
(globalThis as any).window = { paint_path: () => new El() };

// ---- keys as GPUI sends them, and as the lists spell them

const SHIFTED: Record<string, string> = { "~": "`", "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
  "_": "-", "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";", "\"": "'", "<": ",", ">": ".", "?": "/" };
const NAMED = ["enter", "escape", "space", "tab", "backspace", "delete", "up", "down", "left", "right", "home", "end", "pageup", "pagedown"];
/** A probe: its name in the lists' terms ("G", "?", "shift-tab", "ctrl-d", "cmd-l") and the event GPUI sends. */
function probe(name: string) {
  const parts = name.length > 1 && name.includes("-") && !name.endsWith("--") ? name.split("-") : [name];
  let base = name.endsWith("--") ? "-" : parts.pop()!;
  const mods = new Set(name.endsWith("--") ? name.slice(0, -2).split("-") : parts);
  let char: string | null = null;
  if (base.length === 1) {
    if (/[A-Z]/.test(base)) { char = base; base = base.toLowerCase(); mods.add("shift"); }
    else if (SHIFTED[base]) { char = base; base = SHIFTED[base]; mods.add("shift"); }
    else char = base;
    if (mods.has("cmd") || mods.has("ctrl")) char = null;
  } else if (base === "space") char = " ";
  const keystroke = [...["cmd", "ctrl", "alt", "shift"].filter((m) => mods.has(m)), base].join("-");
  return { key: base, key_char: char, keystroke, modifiers: { shift: mods.has("shift"), control: mods.has("ctrl"), alt: mods.has("alt"), platform: mods.has("cmd") } };
}
const PROBES = [
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`-=[]\\;',./".split(""), ...Object.keys(SHIFTED),
  ...NAMED, "shift-tab", "shift-enter", "shift-left", "shift-right", "shift-space",
  ..."abcdefghijklmnopqrstuvwxyz".split("").map((c) => `ctrl-${c}`), "ctrl-=", "ctrl--",
  "alt-left", "alt-right", "cmd-p", "cmd-l", "cmd-r", "cmd-[", "cmd-]", "cmd-alt-i", "cmd-backspace", "cmd-k", "cmd-enter",
];

const GLYPH: Record<string, string> = { "↑": "up", "↓": "down", "←": "left", "→": "right", "⏎": "enter", "↵": "enter", "⇥": "tab", "⌫": "backspace",
  esc: "escape", pgup: "pageup", pgdn: "pagedown" };
const WORDS = new Set([...NAMED, ...Object.keys(GLYPH)]);
const MOD = [["⌘", "cmd"], ["⌃", "ctrl"], ["⌥", "alt"], ["⇧", "shift"]];
/** The keys a ? list names, in probe terms: "j k  ↑ ↓", "gg G", "hjkl", "⇧tab", "⌘⌥i", "1-9", "1 … 9", "ctrl-d". */
function named(list: [string, string][]) {
  const out = new Set<string>();
  const add = (raw: string) => {
    let p = raw;
    const mods: string[] = [];
    for (let again = true; again;) {
      again = false;
      for (const [g, m] of MOD) if (p.startsWith(g) && p.length > 1) { mods.push(m); p = p.slice(g.length); again = true; }
      const t = /^(cmd|ctrl|alt|shift)-(.+)$/.exec(p);
      if (t) { mods.push(t[1]); p = t[2]; again = true; }
    }
    const one = (b0: string) => { const b = mods.some((m) => m === "cmd" || m === "ctrl") && b0.length === 1 ? b0.toLowerCase() : b0; out.add([...["cmd", "ctrl", "alt", "shift"].filter((m) => mods.includes(m)), b].join("-")); };
    if (GLYPH[p]) return one(GLYPH[p]);
    if (WORDS.has(p)) return one(p);
    if (/^[1-9]-[1-9]$/.test(p)) { for (let i = Number(p[0]); i <= Number(p[2]); i++) one(String(i)); return; }
    if ([...p].every((c) => GLYPH[c])) return [...p].forEach((c) => one(GLYPH[c]));
    if (p.length > 1 && /^[a-zA-Z]+$/.test(p)) return [...p].forEach(one);
    if (p.length === 3 && p[1] === "/") return [p[0], p[2]].forEach(one);
    one(p);
  };
  for (const [k] of list) {
    const s = String(k).replace(/(\d)\s*…\s*(\d)/g, "$1-$2");
    for (const tok of s.split(/\s+/).filter(Boolean)) add(tok);
  }
  return out;
}
/** Is a probe named: itself, or its unshifted twin on the same key (= for +, _ for -), or a named key's shift.
 *  A shifted character whose plain key is named counts too: most handlers read the key, not its case
 *  (S does what s does), and a shifted key with a meaning of its own is in the list anyway. */
function isNamed(names: Set<string>, p: string) {
  if (names.has(p)) return true;
  if (p.length === 1 && /[A-Z]/.test(p) && names.has(p.toLowerCase())) return true;
  if (p.length === 1 && SHIFTED[p] && names.has(SHIFTED[p])) return true;
  const twin: Record<string, string> = { "=": "+", "_": "-", "+": "=" };
  if (twin[p] && names.has(twin[p])) return true;
  const shift = /^shift-(.+)$/.exec(p);
  return Boolean(shift && WORDS.has(shift[1]) && names.has(shift[1]));
}
/** The probes a handler takes: `press(event, cx)` on a fresh surface each time. */
function taken(make: () => (e: any, cx: any) => void, skip: (p: string) => boolean = () => false) {
  return PROBES.filter((p) => !skip(p)).filter((p) => {
    const cx: any = { stopped: 0, stop_propagation() { this.stopped++; }, notify() {}, spawn() {}, write_to_clipboard() {}, timer: { after() {}, every() {} }, focus_handle: () => ({ focus() {}, is_focused: () => true }) };
    try { make()(probe(p), cx); } catch (err) { throw new Error(`${p}: ${err}`); }
    return cx.stopped > 0;
  });
}
const unnamed = (list: [string, string][], keys: string[]) => { const n = named(list); return keys.filter((k) => !isNamed(n, k)); };

test("the list reader reads the lists' spellings", () => {
  const n = named([["j k  ↑ ↓", ""], ["gg G", ""], ["hjkl", ""], ["⇧tab", ""], ["⌘⌥i", ""], ["1-9", ""], ["1 … 3", ""], ["ctrl-d ⌘[", ""], ["j/k", ""], ["esc q", ""], ["⇧← ⇧→", ""], ["+ - 0", ""]]);
  for (const k of ["j", "k", "up", "down", "g", "G", "h", "l", "shift-tab", "cmd-alt-i", "5", "2", "ctrl-d", "cmd-[", "escape", "q", "shift-left", "+", "-", "0"]) expect(n.has(k)).toBe(true);
  expect(probe("G")).toMatchObject({ key: "g", key_char: "G", modifiers: { shift: true } });
  expect(probe("?")).toMatchObject({ key: "/", key_char: "?", keystroke: "shift-/" });
  expect(probe("ctrl--")).toMatchObject({ key: "-", modifiers: { control: true } });
});

// ---- the panes and windows

const nop = () => {};
/** A surface from its prototype: `fields` set, every other method (but `keep`) a no-op unless given in `fields`. */
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

const agents = await import("../defaults/mods/agent-graph/main.ts");
test("agents: ? lists every key; the bar ends with ? keys, the list open too", () => {
  const keys = taken(() => { const a = surface(agents.default, ["key"], { help: false, open: new Set(), layout: [], zoom: 1, step: (_k: string, cx: any) => cx.stop_propagation(), target: () => ({ pane: "p" }), feedScroll: { scroll_to_item() {} } }); return (e, cx) => a.key(e, cx); });
  expect(keys).toContain("H");
  expect(unnamed(agents.KEYS, keys)).toEqual([]);
  const a: any = Object.create(agents.default.prototype);
  expect(texts(a.hints(theme)).slice(-2)).toEqual(["?", "keys"]);
  a.help = true;
  expect(texts(a.hints(theme)).slice(-2)).toEqual(["?", "keys"]);
});

const md = await import("../defaults/mods/markdown/main.ts");
test("markdown: ? lists every key; the toolbar's last control is ? keys", () => {
  const make = (sel: number | null) => () => { const v = surface(md.default, ["key"], { sel, keysShown: false, shown: () => ({ viewH: 400, scrollY: 0 }) }); return (e: any, cx: any) => v.key(e, cx); };
  const keys = [...new Set([...taken(make(null)), ...taken(make(0))])];
  expect(keys).toEqual(expect.arrayContaining(["j", "space", "ctrl-d", "tab", "?"]));
  expect(unnamed(md.KEYS, keys)).toEqual([]);
  expect(md.KEYS.at(-1)).toEqual(["?", "keys"]);
  const v: any = surface(md.default, ["toolbar", "chip"], { width: 600, history: [], path: "/a/b.md", raw: false, keysShown: false });
  expect(texts(v.toolbar(theme)).slice(-2)).toEqual(["?", "keys"]);
});

const browser = await import("../defaults/mods/browser/main.ts");
const browserTabs = await import("../defaults/mods/browser/tabs.ts");
test("web pane: ? lists every key, the cmd ones too; its bar's last control is ?", () => {
  const keys = taken(() => { const b = surface(browser.default, ["key", "barKey"], { tabs: browserTabs.single("https://a.example/", 0.9), editing: false, controls: [], ring: null, keysShown: false, video: true }); return (e, cx) => b.key(e, cx); });
  expect(keys).toEqual(expect.arrayContaining(["O", "cmd-l", "cmd-alt-i", "?"]));
  expect(unnamed(browser.KEYS, keys)).toEqual([]);
  expect(browser.KEYS.at(-1)).toEqual(["?", "keys"]);
});

const files = await import("../defaults/mods/file-tree/main.js");
const filesLogic = await import("../defaults/mods/file-tree/logic.js");
test("files: ? lists every key, in the list and while the filter types", () => {
  const rows = [{ path: "a.txt", name: "a.txt", dir: false, depth: 0 }, { path: "b", name: "b", dir: true, depth: 0 }];
  const make = (typing: boolean, sel: string) => () => { const v = surface(files.default, ["key"], { menu: null, typing, query: "", alone: false, keysShown: false, shown: () => rows, sel, folders: new Set(), root: "/r", input: { focus() {} }, handle: { focus() {} } }); return (e: any, cx: any) => v.key(e, cx); };
  const keys = [...new Set([...taken(make(false, "a.txt")), ...taken(make(false, "b"))])];
  expect(unnamed(filesLogic.KEYS, keys)).toEqual([]);
  // Typing: what steers the hits (the list's "/" line names them).
  expect(unnamed(filesLogic.KEYS, taken(make(true, "a.txt")))).toEqual([]);
});

const preview = await import("../defaults/mods/preview/main.js");
const previewKeys = await import("../defaults/mods/preview/keys.ts");
test("preview: ? lists every key for each way it shows a file", () => {
  const cases: [string, string | null, Record<string, any>][] = [
    ["image", "image", {}], ["raster", "pdf", { paged: true }], ["native", "pdf", {}], ["native", "video", {}], ["table", "csv", {}], ["diff", "patch", {}], ["table", "sqlite", { db: true }],
  ];
  for (const [how, kind, opts] of cases) {
    const make = () => {
      const v = surface(preview.default, ["key", "barKey", "rowKey", "mediaKey"], {
        how: { how, firstOnly: !opts.paged }, kind, keysShown: false, ring: null, chips: [], cursor: 0, sy: 0, sx: 0, pages: 3,
        grid: how === "table" ? { body: [1, 2, 3], cols: [{ ch: 3 }] } : null, patch: how === "diff" ? { rows: [1, 2], starts: [0, 1] } : null,
        db: opts.db ? { at: 0, tables: ["a", "b"] } : null, pannable: () => true, call: () => ({ content: {} }), rowCount: () => 3, visibleRows: () => 2,
      });
      return (e: any, cx: any) => v.key(e, cx);
    };
    const list = previewKeys.keyList(how, kind, { editable: true, paged: Boolean(opts.paged), db: Boolean(opts.db) });
    expect([how, kind, unnamed(list, taken(make))]).toEqual([how, kind, []]);
    expect(list.at(-1)).toEqual(["?", "keys"]);
  }
});

const usage = await import("../defaults/mods/usage/main.ts");
test("usage: ? lists every key; the toolbar's last control is ? keys", () => {
  const keys = taken(() => { const u = surface(usage.default, ["key"], { keysShown: false }); return (e, cx) => u.key(e, cx); });
  expect(keys).toEqual(expect.arrayContaining(["r", "p", "?"]));
  expect(unnamed(usage.KEYS, keys)).toEqual([]);
  const u: any = surface(usage.default, ["toolbar", "providers"], { keysShown: false });
  expect(texts(u.toolbar(theme, null, null)).slice(-2)).toEqual(["?", "keys"]);
});

const pip = await import("../defaults/mods/pip/main.ts");
test("picture in picture: ? lists every key; ? sits on the bar right before ✕", () => {
  const keys = PROBES.filter((p) => pip.keyControl(probe(p)) != null);
  expect(keys).toContain("?");
  expect(unnamed(pip.KEYS, keys)).toEqual([]);
  const p: any = surface(pip.default, ["bar", "button", "more", "hovers", "mark", "controls"], { width: 384, inPane: false, hover: null, playing: true, muted: false, handle: { is_focused: () => true } });
  expect(texts(p.bar(theme)).slice(-2)).toEqual(["?", "✕"]);
  opened.length = 0;
  p.command = pip.default.prototype.command; p.menu = null; p.openKeys = pip.default.prototype.openKeys;
  p.command("keys");
  expect(opened.at(-1)).toMatchObject({ mod: "pip", kind: "popup", props: { keys: true } });
});

const deck = await import("../defaults/mods/scripts/main.js");
test("script runner: ? lists every key; every bar ends with the keys entry, cmd-k ? while the filter types", () => {
  const run = { kind: "run", r: { live: true, name: "x", word: "running", runner: "just" } };
  const row = { kind: "script", row: { s: { admin: false } } };
  const make = (state: Record<string, any>) => () => {
    const d = surface(deck.default, ["onKey"], { help: false, output: null, typing: false, query: "", cursor: 0, page: 5, groups: () => [0, 1], ...state });
    return (e: any, cx: any) => d.onKey(e, cx, [run, row]);
  };
  // ctrl-x is cmd-x off macOS (the list names the platform's own).
  const skip = (p: string) => p.startsWith("ctrl-") || p === "cmd-enter";
  const keys = [...new Set([...taken(make({}), skip), ...taken(make({ output: { r: run.r, shown: 10 } }), skip)])];
  const list = deck.deckKeys("⌘");
  // The output row spells its keys in its words: name them as the list does.
  const flat: [string, string][] = list.flatMap(([k, w]: [string, string]) => k === "output" ? [[w.split("·").map((x) => x.trim().split(" ").filter((y) => !/^[a-z]{4,}$/.test(y)).join(" ")).join(" "), ""]] : [[k, w]]);
  expect(unnamed(flat, keys)).toEqual([]);
  const d: any = surface(deck.default, ["foot", "hint", "badge"], { help: false, output: null, typing: false, query: "", folder: "/f" });
  expect(texts(d.foot(theme, run)).slice(-2)).toEqual(["?", "keys"]);
  expect(texts(d.foot(theme, row)).slice(-2)).toEqual(["?", "keys"]);
  expect(texts(d.foot(theme, null)).slice(-2)).toEqual(["?", "keys"]);
  d.output = { r: run.r };
  expect(texts(d.foot(theme, run)).slice(-2)).toEqual(["?", "keys"]);
  d.output = null; d.typing = true;
  expect(texts(d.foot(theme, run)).slice(-2)).toEqual(["cmd-k ?", "keys"]);
  // The chord works while typing: ? alone goes into the filter.
  const typing: any = surface(deck.default, ["onKey"], { help: false, output: null, typing: true, query: "", cursor: 0, page: 5, groups: () => [0], filter(q: string) { this.query = q; } });
  const cx: any = { stop_propagation() {}, notify() {} };
  typing.onKey(probe("?"), cx, [run]);
  expect([typing.help, typing.query]).toEqual([false, "?"]);
  typing.onKey(probe("cmd-k"), cx, [run]);
  typing.onKey(probe("?"), cx, [run]);
  expect(typing.help).toBe(true);
});

const overview = await import("../defaults/mods/notifications/overview.js");
test("notifications overview: ? lists every key", () => {
  const it = { id: "a", type: "permission", answerable: true, request: { options: [{ n: 1 }, { n: 2 }] } };
  const keys = taken(() => { const o = surface(overview.default, ["key"], { but: null, keysShown: false, cursor: 0, list: () => [it], current: () => it }); return (e, cx) => o.key(e, cx); });
  expect(unnamed(overview.KEYS, keys)).toEqual([]);
});

const ghPrs = (await import("../defaults/mods/github/prs.js")).default;
const ghActions = (await import("../defaults/mods/github/actions.js")).default;
const ghProjects = (await import("../defaults/mods/github/projects.js")).default;
test("GitHub: each tab's ? list names every key its handler takes, in every panel", () => {
  // The window hands a tab the key as it reads it: what was typed, else GPUI's name.
  const asTab = (tab: any) => (e: any, cx: any) => {
    const c = e.key_char, m = e.modifiers;
    const k = c && c.length === 1 && c.trim() && !m.platform && !m.control ? c : e.key;
    if ((m.platform || m.alt) && k !== "enter") return; // the window's own filter (main.js key)
    if (tab.key(k, e, cx) === true) cx.stop_propagation();
  };
  // ctrl-a reaches a tab as a (the window lets ctrl through): an accident, not a key; ctrl-d / ctrl-u are real.
  const skip = (p: string) => (p.startsWith("ctrl-") && p !== "ctrl-d" && p !== "ctrl-u") || p === "cmd-enter";
  const app = { openDiff: nop, ask: nop, openUrl: nop, showRuns: nop, repo: { root: "/r", url: "u", branch: "b" }, act: nop, focusSelf: nop };
  const pr = { number: 1, headRefName: "b" };
  const prKeys = ["list", "checks", "main"].flatMap((focus) => taken(() => asTab(surface(ghPrs, ["key"], { app, focus, list: [pr, pr], current: () => pr, checks: () => [{}], checkSel: 0, viewH: 400, composer: null })), skip));
  expect(unnamed(ghPrs.help(), prKeys)).toEqual([]);
  const run = { html_url: "u", status: "completed" };
  const acKeys = ["runs", "graph", "steps", "log"].flatMap((focus) => taken(() => asTab(surface(ghActions, ["key"], { app, focus, list: () => [run, run], run: () => run, job: () => ({}), filter: null })), skip));
  expect(unnamed(ghActions.help(), acKeys)).toEqual([]);
  const lay = { columns: [{}, {}], lane: null, lanes: [], sorted: false };
  const item = { id: "i", content: { kind: "draft" } };
  const pjKeys = [["board", false], ["board", true], ["detail", true]].flatMap(([focus, detailOpen]) => taken(() => asTab(surface(ghProjects, ["key"], {
    app, focus, detailOpen, typing: null, menu: null, carrying: null, filterText: "x", board: () => ({ project: { url: "u" } }), lay: () => lay, at: () => ({ col: 0, row: 0 }),
    current: () => item, grid: () => [[]], foldedCols: () => [], viewH: 400, draft: { set_value() {}, focus() {} }, filter: { set_value() {}, focus() {}, value: () => "" }, view: () => ({}),
  })), skip));
  expect(unnamed([...ghProjects.help(), ["space m", ""]], pjKeys)).toEqual([]);
});

// ---- the chrome

const nav = await import("../defaults/mods/nocturne/nav.js");
test("sidebar, tab strip, header and parked chips: each ? list names every key of its keymap (no function keys shown)", () => {
  const keysOf = (map: Record<string, string>, drop: string[] = []) => Object.keys(map).filter((k) => !/^(shift-)?f\d+$/.test(k) && !drop.includes(k)).map((k) => k === "shift-tab" ? "shift-tab" : k);
  expect(unnamed(nav.SIDEBAR_HELP, keysOf(nav.SIDEBAR_KEYS))).toEqual([]);
  const digits = (l: any) => [...l, ["1-9", ""]];
  expect(unnamed(digits(nav.STRIP_HELP), keysOf(nav.STRIP_KEYS))).toEqual([]);
  // H / L move a tab: nothing on the header's or the chips' rows.
  expect(unnamed(nav.HEADER_HELP, keysOf(nav.STRIP_KEYS, ["H", "L"]))).toEqual([]);
  expect(unnamed(nav.PARKED_HELP, keysOf(nav.STRIP_KEYS, ["H", "L", "r"]))).toEqual([]);
  for (const l of [nav.SIDEBAR_HELP, nav.STRIP_HELP, nav.HEADER_HELP, nav.PARKED_HELP]) {
    expect(l.at(-1)).toEqual(["?", "keys"]);
    expect(l.flat().join(" ")).not.toMatch(/\bf\d+\b/);
  }
});

const screens = await import("../defaults/mods/nocturne/screens.js");
test("welcome and what's new: ? lists every key; their foot hints end with ? keys", () => {
  const press = (o: any, init: () => void) => () => { init(); return (e: any, cx: any) => o.render().calls.on_key_down[0](e, cx); };
  const w: any = new screens.Welcome();
  const wk = [1, 2, 3].flatMap((page) => taken(press(w, () => { w.init({}, { focus_handle: () => ({ focus() {} }), timer: { after() {}, every() {} }, spawn() {}, notify() {} }); w.page = page; w.done = nop; w.start = nop; })));
  expect(unnamed(screens.WELCOME_KEYS, [...new Set(wk)])).toEqual([]);
  const n: any = new screens.WhatsNew();
  const nk = taken(press(n, () => { n.init({}, { focus_handle: () => ({ focus() {} }), timer: { after() {}, every() {} } }); n.done = nop; }));
  expect(unnamed(screens.WHATS_NEW_KEYS, nk)).toEqual([]);
  for (const l of [screens.WELCOME_KEYS, screens.WHATS_NEW_KEYS]) expect(l.at(-1)).toEqual(["?", "keys"]);
  const foot = (o: any) => texts(o.render());
  expect(foot(w).join(" ")).toMatch(/esc skip · \? keys/);
  expect(foot(n).join(" ")).toMatch(/send feedback · \? keys/);
});

// ---- the keys dialog

const keymap = await import("../defaults/mods/nocturne/keymap.js");
const shipped = (file: string) => Object.entries(keysNow(require("fs").readFileSync(`${import.meta.dir}/../defaults/${file}`, "utf8")))
  .flatMap(([section, v]: any) => Object.entries(v).map(([keys, action]) => ({ section, keys, action: String(action) })));

test("keys dialog: every binding in the shipped keys files has a plain-words label", () => {
  for (const b of [...shipped("keys.macos.json"), ...shipped("keys.json"), { section: "global", keys: "ctrl-alt-shift-escape", action: "app.reset" }]) {
    if (b.action.startsWith("send:")) expect([b.keys, keymap.keyLabel(b.action)]).not.toEqual([b.keys, expect.stringMatching(/^Types /)]);
    else expect([b.keys, b.action, keymap.hasWords(b.action)]).toEqual([b.keys, b.action, true]);
    expect(keymap.keyLabel(b.action)).toMatch(/^[A-Z]/);
  }
});

test("keys dialog: pane.resize has plain words in every direction before its keys ship", () => {
  for (const d of ["left", "right", "up", "down"]) {
    expect(keymap.hasWords(`pane.resize:${d}`)).toBe(true);
    expect(keymap.keyLabel(`pane.resize:${d}`)).toBe(`Resize the pane: its divider a step ${d}`);
  }
});

test("keys dialog: a map in groups; keyboard focus is its own and opens into each block's keys", () => {
  const all = [...shipped("keys.macos.json"), { section: "global", keys: "ctrl-alt-shift-escape", action: "app.reset" }];
  const list = keymap.rows(all);
  const heads = list.filter((x: any) => x.head).map((x: any) => x.head);
  expect(heads[0]).toBe("keyboard focus");
  expect(heads).toEqual(expect.arrayContaining(["spaces", "tabs", "panes", "agents", "windows and panels", "in a terminal", "in the editor", "in the web pane", "app"]));
  const focus = list.slice(1, list.findIndex((x: any, i: number) => i > 0 && x.head));
  const label = (a: string) => focus.find((x: any) => x.k?.action === a);
  expect(label("nocturne.sidebar")).toMatchObject({ label: "Focus the sidebar (again: back to the pane)", surface: "sidebar", k: { keys: "cmd-alt-s" } });
  expect(label("nocturne.tabstrip")).toMatchObject({ surface: "tabstrip" });
  expect(label("nocturne.header")).toMatchObject({ surface: "header" });
  expect(label("nocturne.toast")).toMatchObject({ surface: "toasts" });
  expect(focus.map((x: any) => x.surface).filter(Boolean)).toEqual(["sidebar", "tabstrip", "header", "toasts", "parked", "menus", "panes"]);
  // Folded until opened: then the block's keys follow its row.
  expect(focus.some((x: any) => x.line)).toBe(false);
  const open = keymap.rows(all, { open: new Set(["sidebar"]) });
  const at = open.findIndex((x: any) => x.surface === "sidebar");
  expect(open.slice(at + 1, at + 1 + nav.SIDEBAR_HELP.length).map((x: any) => x.label)).toEqual(nav.SIDEBAR_HELP.map(([, w]: any) => w));
  // Toasts' lines show the keys bound to them.
  const toasts = keymap.rows(all, { open: new Set(["toasts"]) }).filter((x: any) => x.line && x.of === "toasts").map((x: any) => x.k.keys);
  expect(toasts).toEqual(["cmd-alt-n", "cmd-alt-shift-n", "click"]);
  // The core's own: esc closes the window in front.
  expect(list.some((x: any) => x.k?.section === "core" && x.k.keys === "escape" && x.group === "windows and panels")).toBe(true);
});

test("keys dialog: Nocturne's own keys replace the global ones they rebind; another layout's section is left out", () => {
  const all = [...shipped("keys.macos.json"), { section: "layout:terminals", keys: "ctrl-]", action: "space.next" }];
  const shown = keymap.shown(all);
  expect(shown.some((b: any) => b.keys === "cmd-b" && b.action === "layout.toggle:sidebar")).toBe(false);
  expect(shown.some((b: any) => b.keys === "cmd-b" && b.action === "nocturne.fold")).toBe(true);
  expect(shown.some((b: any) => b.section === "layout:terminals")).toBe(false);
  expect(shown.some((b: any) => b.keys === "cmd-t" && b.action === "tab.new")).toBe(true);
});

test("keys dialog: the filter finds plain words and keys, every word must match", () => {
  const all = shipped("keys.macos.json");
  const actions = (f: string) => keymap.rows(all, { filter: f }).filter((x: any) => !x.head && !x.line).map((x: any) => x.k.action);
  expect(actions("focus sidebar")).toContain("nocturne.sidebar");
  expect(actions("sidebar")).toEqual(expect.arrayContaining(["nocturne.sidebar", "nocturne.fold"]));
  expect(actions("cmd-alt-t")).toContain("nocturne.tabstrip");
  expect(actions("toast")).toEqual(expect.arrayContaining(["nocturne.toast", "nocturne.toast-close"]));
  // A block's own key found by its words: the block unfolds to show it.
  const r = keymap.rows(all, { filter: "rename the pane" });
  expect(r.some((x: any) => x.line && x.of === "header" && x.label === "rename the pane")).toBe(true);
  expect(keymap.rows(all, { filter: "zzzz no such thing" })).toEqual([]);
});

test("keys dialog: a user's own binding is labelled by its command's about", () => {
  const commands = [{ name: "tab.settle", about: "Put a tab away on this screen (default: the shown one): out of the lists." }, { name: "terminal.kill", about: "End a terminal and its sub-agents." }];
  expect(keymap.keyLabel("terminal.kill", commands)).toBe("End a terminal and its sub-agents");
  expect(keymap.keyLabel("tab.settle", commands)).toBe("Put the tab away (it keeps running)");
  expect(keymap.keyLabel("my-mod.do-it")).toBe("my mod do it");
  expect(keymap.keyLabel(JSON.stringify({ command: "layout.resize", args: { id: "sidebar", px: 240 } }), [{ name: "layout.resize", about: "Size a layout node." }])).toBe('Size a layout node {"id":"sidebar","px":240}');
});
