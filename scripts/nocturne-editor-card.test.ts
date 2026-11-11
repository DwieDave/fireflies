// The editor's hover card (nocturne-editor/main.js, logic.js cardPlace): where
// it opens (under its word, above it near the pane's foot, inside the pane),
// every way it closes in each vim mode and without vim, a card that opens
// waiting on the server and fills in by itself, the bar's progress words,
// edits sent as ranges, and answers kept per place. A whole pane is built
// through init with herdr and gpui stand-ins (mock.module is process-wide:
// this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";

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
        else (t.calls[k] ??= []).push(a);
        return proxy;
      },
    });
  }
}
const texts = (e: any): string[] => typeof e === "string" ? [e] : e instanceof Object && "kids" in e ? e.kids.flatMap(texts) : [];
const all = (e: any): any[] => (e?.kids ? [e, ...e.kids.flatMap(all)] : []);
const byId = (root: any, id: string) => all(root).find((x) => x.calls?.id?.[0]?.[0] === id);
const theme: any = new Proxy({}, { get: () => "#808080" });

// ---- herdr: a file, settings, and a language server whose answers the tests give
const requests: any[] = [];
const notes: any[] = [];
let answer: (method: string, params: any) => any = () => null;
let paneList: any[] = [];
let zoomNow = 0.9;
let onDisk = "fn main() {\n    let x = 1;\n}\n";
const herdr: Record<string, any> = {
  settings: () => ({ zoom: zoomNow, editor: {} }), window: () => ({ platform: "macos" }), appHome: () => "/tmp/app", home: () => "/home/a",
  props: () => ({ path: "/p/src/a.rs", slot: "s1" }), theme: () => theme, run: () => null, panes: () => paneList, shared: () => null, setShared: () => {},
  readTextFile: async (p: string) => (p === "/p/src/a.rs" ? onDisk : null), writeTextFile: async () => null, watchFolder: () => new Promise(() => {}),
  nextCommand: () => new Promise(() => {}),
  // The pane's own start never gets past its first process: the tests set the server.
  exec: () => new Promise(() => {}), languageOf: (p: string) => (/\.rs$/.test(p) ? "rust" : null),
  highlight: () => [], lspStart: () => new Promise(() => {}), lspNotify: (_id: number, method: string, params: any) => { notes.push([method, params]); },
  lspRequest: (_id: number, method: string, params: any, opts: any) => { requests.push([method, params, opts]); return Promise.resolve(answer(method, params)); },
  lspNextMessage: () => new Promise(() => {}), lspRelease: () => null, setUnsaved: () => null, notify: () => {},
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: () => new El(), image: () => new El(), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} set_selected_range() {} }
/** gpui-base's EditorState: the text, a caret, its handlers, and where it drew words. */
class Ed {
  v = ""; caret = { line: 0, col: 0 }; handlers: Record<string, any> = {}; hasKeys = true;
  focused() { return this.hasKeys; }
  drawn: any = { x: 300, y: 200, width: 18, height: 18, view: { x: 40, y: 60, width: 900, height: 700 } };
  on(name: string, fn: any) { this.handlers[name] = fn; return true; }
  value() { return this.v; } set_value(v: string) { this.v = v; }
  cursor() { return { ...this.caret }; } set_cursor(line: number, col: number) { this.caret = { line, col }; }
  bounds(_at: any) { return this.drawn; }
  focus() {} set_tab_size() {} set_cursor_shape() {} set_diagnostics() {} set_line_notes() {} find_close() {} top_line() { return 0; }
  selection() { return { start: this.caret, end: this.caret, text: "" }; } edit() {} set_selections() {}
}
let ed: Ed;
mock.module("gpui-base", () => ({
  h_flex: () => new El(), v_flex: () => new El(), InputState: { new: () => new Input() }, Input: { new: () => new El() },
  TextView: { html: () => new El(), markdown: (_id: string, md: string) => md }, EditorState: { new: () => (ed = new Ed()) }, Editor: { new: () => new El() },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
}));
(globalThis as any).window = { paint_path: () => new El() };
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} };

const { default: EditorPane } = await import("../defaults/mods/nocturne-editor/main.js");
const { cardPlace, progressWord, busy, changeBetween, cardMarkdown } = await import("../defaults/mods/nocturne-editor/logic.js");

// ---- a pane, its context and its timers
let later: [number, (cx: any) => void][] = [];
function cx(): any {
  return {
    stopped: 0, notified: 0, stop_propagation() { this.stopped++; }, notify() { this.notified++; },
    timer: { after: (ms: number, fn: any) => later.push([ms, fn]), every() {} },
    spawn: (fn: any) => { fn(cx()); }, focus_handle: () => ({ focus() {}, is_focused: () => true }),
    read_from_clipboard: () => null, write_to_clipboard() {},
  };
}
/** Runs the timers that are due (all of them: the tests don't wait). */
function tick() { const due = later; later = []; for (const [, fn] of due) fn(cx()); }
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

async function pane(vim = true): Promise<any> {
  later = [];
  const p: any = new EditorPane();
  p.init({}, cx());
  await flush();
  p.paneVim = vim;
  p.vimSettled(vim);
  // As on_size_change reports it: window pixels, zoomed (a 1000 x 800 pane at 0.9).
  p.size = { width: 1000 * zoomNow, height: 800 * zoomNow };
  p.server = { status: "ready", id: 7, name: "rust-analyzer", caps: { textDocumentSync: 2 } };
  p.sent = ed.v;
  tick();
  return p;
}
beforeEach(() => { requests.length = 0; notes.length = 0; answer = () => null; paneList = []; zoomNow = 0.9; });

const key = (k: string, mods: any = {}, ch: string | null = null) => ({ key: k, key_char: ch ?? (k.length === 1 ? k : null), keystroke: k, modifiers: { shift: false, control: false, alt: false, platform: false, function: false, ...mods } });
const ESC = key("escape");
const HOVER = { contents: { kind: "markdown", value: "```rust\nlet x: i32\n```\n---\nA number." } };

// ---- where it opens

test("placement: under the word mid pane, left-aligned with it, never over it", () => {
  const p = cardPlace({ x: 300, y: 200, w: 18, h: 18 }, { width: 1000, height: 800 }, { width: 520, height: 160 }, { top: 30, bottom: 22 });
  expect(p).toMatchObject({ left: 300, top: 220, bottom: null, above: false, width: 520 });
  expect(p.top).toBeGreaterThanOrEqual(200 + 18);
});

test("placement: near the pane's foot it flips above the line, its bottom just over the word", () => {
  const p = cardPlace({ x: 300, y: 700, w: 18, h: 18 }, { width: 1000, height: 800 }, { width: 520, height: 160 }, { top: 30, bottom: 22 });
  expect(p).toMatchObject({ above: true, top: null, bottom: 800 - 698 });
  // At most half the pane, and never past the bar.
  expect(p.maxH).toBe(400);
  expect(cardPlace({ x: 300, y: 150, w: 18, h: 18 }, { width: 1000, height: 160 + 200 }, { width: 520, height: 300 }, { top: 30, bottom: 22 }))
    .toMatchObject({ above: false, maxH: 160 });
  expect(cardPlace({ x: 300, y: 300, w: 18, h: 18 }, { width: 1000, height: 340 }, { width: 520, height: 300 }, { top: 30, bottom: 22 }))
    .toMatchObject({ above: true, maxH: 170 });
  // A short card that fits below stays below, even low down.
  expect(cardPlace({ x: 300, y: 700, w: 18, h: 18 }, { width: 1000, height: 800 }, { width: 520, height: 40 }, { top: 30, bottom: 22 }).above).toBe(false);
  // Before it's measured, a guess decides; measured, its real height.
  expect(cardPlace({ x: 0, y: 600, w: 9, h: 18 }, { width: 1000, height: 800 }, { width: 520, height: null }, { top: 30, bottom: 22 }).above).toBe(true);
});

test("placement: near the right edge it slides in to stay inside the pane; a narrow pane shrinks it", () => {
  const p = cardPlace({ x: 950, y: 200, w: 30, h: 18 }, { width: 1000, height: 800 }, { width: 520, height: 160 }, {});
  expect(p.left).toBe(1000 - 520 - 8);
  expect(p.left + p.width).toBeLessThanOrEqual(1000 - 8);
  const narrow = cardPlace({ x: 100, y: 20, w: 30, h: 18 }, { width: 300, height: 800 }, { width: 520, height: 160 }, {});
  expect([narrow.left, narrow.width]).toEqual([8, 284]);
});

test("the caret's card (cmd-i) opens at the caret's word: window coordinates, unzoomed, below the bar", async () => {
  const p = await pane(false);
  answer = () => HOVER;
  ed.caret = { line: 1, col: 8 };
  ed.drawn = { x: 40 + 270, y: 60 + 180, width: 9, height: 18, view: { x: 40, y: 60, width: 900, height: 700 } };
  p.command("hover", cx());
  await flush();
  const card = p.cardView(theme, "mono");
  // The word's spot in the editor (270, 180 zoomed: 300, 200), plus the
  // gutter's inset and the bar above the text.
  expect(card.calls.left[0][0]).toBeCloseTo(300 + 12, 5);
  expect(card.calls.top[0][0]).toBeCloseTo(200 + 30 + 20 + 2, 5);
  expect(texts(card)).toContain("let x: i32");
});

test("near the pane's foot the card goes above its word, its bottom just over it (sizes come zoomed, 0.9)", async () => {
  const p = await pane();
  answer = () => HOVER;
  // The word on the text's last lines: 700 px down the editor (630 zoomed).
  ed.drawn = { x: 40 + 90, y: 60 + 630, width: 18, height: 16.2, view: { x: 40, y: 60, width: 900, height: 700 } };
  p.command("hover", cx());
  await flush();
  const card = p.cardView(theme, "mono");
  expect(card.calls.top).toBeUndefined();
  // 800 px pane: the word's top at 700 + 30 (the bar), the card's bottom 2 px over it.
  expect(card.calls.bottom[0][0]).toBeCloseTo(800 - (730 - 2), 5);
  expect(card.calls.max_h[0][0]).toBe(400);
});

test("the pointer's card opens under the word the pointer rests on", async () => {
  const p = await pane();
  answer = () => HOVER;
  ed.drawn = { x: 40 + 225, y: 60 + 90, width: 27, height: 18, view: { x: 40, y: 60, width: 900, height: 700 } };
  p.hovered({ hovering: true, line: 1, col: 8, x: 490, y: 150, width: 27, height: 18 }, cx());
  await flush();
  expect(requests.at(-1)[1].position).toEqual({ line: 1, character: 8 });
  const card = p.cardView(theme, "mono");
  expect(card.calls.left[0][0]).toBeCloseTo(250 + 12, 5);
  expect(card.calls.top[0][0]).toBeCloseTo(100 + 30 + 20 + 2, 5);
  // Over an editor without the keyboard (another pane's), it stays while the pointer rests.
  ed.hasKeys = false;
  later = [];
  p.hovered({ hovering: true, line: 0, col: 3 }, cx());
  await flush();
  tick(); tick();
  expect(p.card?.line).toBe(0);
  ed.hasKeys = true;
});

test("the card stays at its word as the text scrolls, and waits off screen while the word is", async () => {
  const p = await pane();
  answer = () => HOVER;
  p.command("hover", cx());
  await flush();
  const before = p.cardView(theme, "mono").calls.top[0][0];
  ed.drawn = { ...ed.drawn, y: ed.drawn.y - 90 };
  const c = cx();
  ed.handlers.scroll({}, c);
  expect(c.notified).toBe(1);
  expect(p.cardView(theme, "mono").calls.top[0][0]).toBeCloseTo(before - 100, 5);
  ed.drawn = null; // scrolled out of view
  expect(p.cardView(theme, "mono")).toBe(null);
  expect(p.card).not.toBe(null);
});

// ---- how it closes

const modes: [string, boolean, string | null][] = [["vim normal", true, "normal"], ["vim insert", true, "insert"], ["vim visual", true, "visual"], ["vim off", false, null]];
for (const [name, vim, mode] of modes) {
  test(`${name}: esc closes the card and does nothing else`, async () => {
    const p = await pane(vim);
    answer = () => HOVER;
    if (mode) { p.vim.mode = mode; p.vim.anchor = { line: 0, col: 0 }; }
    p.command("hover", cx());
    await flush();
    expect(p.card.parts.length).toBe(2);
    const c = cx();
    // The editor's key handler (vim's, or the editor's own) sees esc first.
    expect(ed.handlers.key(ESC, c)).toBe(true);
    expect(p.card).toBe(null);
    if (mode) expect(p.vim.mode).toBe(mode);
    // With the card gone, esc is vim's (or the editor's) again.
    if (mode === "insert") { ed.handlers.key(ESC, cx()); expect(p.vim.mode).toBe("normal"); }
  });

  test(`${name}: cmd-i on an open card closes it; a caret move, typing, a click outside and losing the keyboard close it`, async () => {
    const p = await pane(vim);
    answer = () => HOVER;
    if (mode) { p.vim.mode = mode; p.vim.anchor = { line: 0, col: 0 }; }
    const open = async () => { p.command("hover", cx()); await flush(); expect(p.card).not.toBe(null); };
    // cmd-i again (its command; vim's K runs the same one).
    await open();
    p.command("hover", cx());
    expect(p.card).toBe(null);
    // The caret moves (a key the editor or vim takes): gone once the key is done.
    await open();
    ed.handlers.key(key(vim && mode !== "insert" ? "j" : "down"), cx());
    ed.caret = { line: 2, col: 0 };
    tick();
    expect(p.card).toBe(null);
    // A key that moves nothing (vim's g before d) leaves it.
    await open();
    if (vim && mode === "normal") { ed.handlers.key(key("g"), cx()); tick(); expect(p.card).not.toBe(null); }
    // Typing.
    ed.v += "x";
    ed.handlers.change({}, cx());
    expect(p.card).toBe(null);
    // A click outside the card (the pane's own mouse-down; the card stops its own).
    await open();
    const root = p.render(cx());
    root.calls.on_mouse_down.find((a: any[]) => a[0] === "left")[1]({}, cx());
    expect(p.card).toBe(null);
    await open();
    const card = byId(p.render(cx()), "editor-card");
    expect(card.calls.on_mouse_down[0][0]).toBe("left");
    // The editor losing the keyboard: its blur, or (when that doesn't come)
    // the next look at its focus.
    ed.handlers.blur({}, cx());
    expect(p.card).toBe(null);
    later = [];
    await open();
    ed.hasKeys = false;
    tick();
    expect(p.card).toBe(null);
    ed.hasKeys = true;
  });
}

test("a long card scrolls by ctrl-d / ctrl-u (and page keys); its footer says so, and how to close it", async () => {
  const p = await pane();
  answer = () => HOVER;
  p.command("hover", cx());
  await flush();
  const foot = () => texts(byId(p.render(cx()), "card-foot"));
  expect(foot()).toEqual(["rust-analyzer", "gd", "definition", "esc", "close"]);
  // Measured: 900 px of answer in a 300 px window.
  Object.assign(p.card, { contentH: 900, viewH: 300 });
  expect(foot()).toContain("ctrl-d ctrl-u");
  expect(ed.handlers.key(key("d", { control: true }), cx())).toBe(true);
  expect(p.card.scroll).toBe(180);
  ed.handlers.key(key("pagedown"), cx());
  ed.handlers.key(key("pagedown"), cx());
  ed.handlers.key(key("pagedown"), cx());
  expect(p.card.scroll).toBe(600); // never past the end
  ed.handlers.key(key("u", { control: true }), cx());
  expect(p.card.scroll).toBe(420);
  const content = byId(p.render(cx()), "card-content");
  expect(content.calls.top[0][0]).toBe(-420);
  // Short: ctrl-d is vim's again (half a page down), and the card stays put.
  Object.assign(p.card, { contentH: 100, viewH: 300, scroll: 0 });
  ed.handlers.key(key("d", { control: true }), cx());
  expect(p.card.scroll).toBe(0);
});

test("the type depth's − / + ask again at another level, keeping the card where it is", async () => {
  const p = await pane(false);
  p.lang = "typescript";
  answer = (_m, params) => ({ contents: { kind: "markdown", value: "```ts\ntype T = " + (params.verbosityLevel ? "{ a: 1 }" : "T") + "\n```" }, canIncreaseVerbosityLevel: !params.verbosityLevel });
  p.command("hover", cx());
  await flush();
  // The depth's keys, and how to close it, fit: the server's name gives way.
  expect(texts(byId(p.render(cx()), "card-foot"))).toEqual(["−", "type depth 0", "+", "ctrl-−/=", "cmd-k d", "definition", "esc", "close"]);
  p.command("hover-more", cx());
  await flush();
  expect(requests.at(-1)[1].verbosityLevel).toBe(1);
  expect(p.card.keyboard).toBe(true);
  expect(texts(p.cardView(theme, "mono"))).toContain("type T = { a: 1 }");
});

// ---- a card that opens waiting, and fills in by itself

test("asked before the server is ready: the card opens at once with what it waits for, and fills in when the answer comes", async () => {
  const p = await pane();
  p.server = { status: "starting", name: "rust-analyzer" };
  p.command("hover", cx());
  // On screen now, saying what it waits for; no second key press needed.
  expect(p.card.pending).toBe(true);
  expect(texts(p.cardView(theme, "mono"))).toContain("Starting rust-analyzer…");
  expect(requests.length).toBe(0);
  // Started, still indexing: rust-analyzer has nothing yet (null), the card says why.
  p.server = { status: "ready", id: 7, name: "rust-analyzer", caps: {} };
  p.progressed({ token: "i", value: { kind: "begin", title: "Indexing" } }, cx());
  p.progressed({ token: "i", value: { kind: "report", message: "120/340 (std)" } }, cx());
  p.cardState(cx());
  await flush();
  expect(p.card.pending).toBe(true);
  expect(texts(p.cardView(theme, "mono"))).toContain("rust-analyzer: indexing 120/340. The answer comes when it's done.");
  // Done indexing: asked again, filled in.
  answer = () => HOVER;
  p.progressed({ token: "i", value: { kind: "end" } }, cx());
  await flush();
  expect(p.card.pending).toBe(false);
  expect(texts(p.cardView(theme, "mono"))).toEqual(expect.arrayContaining(["let x: i32", "A number."]));
});

test("an empty answer between rust-analyzer's phases (no work open, some a moment ago) waits, and asks again each second", async () => {
  const p = await pane();
  p.progressed({ token: "f", value: { kind: "begin", title: "Fetching" } }, cx());
  p.progressed({ token: "f", value: { kind: "end" } }, cx()); // the gap before its next phase
  p.command("hover", cx());
  await flush();
  expect(p.card.pending).toBe(true);
  expect(p.card.note).toBe(null);
  expect(texts(p.cardView(theme, "mono"))).toContain("rust-analyzer is loading the workspace. The answer comes when it's done.");
  // A second on, it has the workspace: the card fills in without a key.
  answer = () => HOVER;
  later = later.filter(([ms]) => ms === 1000);
  expect(later.length).toBe(1);
  tick();
  await flush();
  expect(p.card.pending).toBe(false);
  expect(texts(p.cardView(theme, "mono"))).toContain("A number.");
  // Long settled, an empty answer is the answer: nothing here.
  p.lastWork = Date.now() - 5000;
  answer = () => null;
  p.closeCard(cx());
  ed.caret = { line: 0, col: 1 };
  p.command("hover", cx());
  await flush();
  expect(p.card.note.text).toBe("rust-analyzer has nothing for this place.");
});

test("loading the project's environment: the waiting card names its .envrc", async () => {
  const p = await pane();
  p.server = { status: "env", envrc: "/home/a/p", names: ["rust-analyzer"] };
  p.command("hover", cx());
  expect(texts(p.cardView(theme, "mono"))).toContain("Loading this project's environment (~/p/.envrc)…");
});

test("the pointer's card stays quiet while the server can't answer; the bar shows the server's own words", async () => {
  const p = await pane();
  p.server = { status: "ready", id: 7, name: "rust-analyzer", caps: {} };
  p.progressed({ token: "b", value: { kind: "begin", title: "Building compile-time-deps", percentage: 40 } }, cx());
  p.hovered({ hovering: true, line: 1, col: 8 }, cx());
  await flush();
  expect(p.cardView(theme, "mono")).toBe(null);
  expect(texts(byId(p.bar(theme), "bar-server"))).toEqual(["building compile-time-deps 40%"]);
  p.progressed({ token: "b", value: { kind: "end" } }, cx());
  p.progressed({ token: "c", value: { kind: "begin", title: "cargo check" } }, cx());
  expect(texts(byId(p.bar(theme), "bar-server"))).toEqual(["rust-analyzer · cargo check…"]);
});

test("progress words: the work answers wait on first, its count or percentage", () => {
  const m = (...l: any[]) => new Map(l.map((p, i) => [String(i), p]));
  expect(progressWord(m({ title: "Roots Scanned", message: "3/811" }, { title: "Indexing", message: "120/340 (core)" }))).toBe("indexing 120/340");
  expect(progressWord(m({ title: "Fetching", message: "cargo metadata: started" }))).toBe("fetching…");
  expect(progressWord(m({ title: "cargo check" }, { title: "Loading proc-macros", percentage: 12.4 }))).toBe("loading proc-macros 12%");
  expect(progressWord(m())).toBe(null);
  expect(busy(m({ title: "cargo check" }))).toBe(false);
  expect(busy(m({ title: "Indexing" }))).toBe(true);
});

// ---- the leads editors win their speed with

test("edits go to the server as ranges, a moment after typing and before any question", async () => {
  const p = await pane();
  ed.v = "fn main() {\n    let xy = 1;\n}\n";
  ed.handlers.change({}, cx());
  expect(notes.filter(([m]) => m === "textDocument/didChange").length).toBe(0);
  answer = () => HOVER;
  p.command("hover", cx()); // a question flushes first
  const change = notes.find(([m]) => m === "textDocument/didChange")[1];
  expect(change.contentChanges).toEqual([{ range: { start: { line: 1, character: 9 }, end: { line: 1, character: 9 } }, text: "y" }]);
  expect(requests.at(-1)[2]).toEqual({ key: "hover" });
  // Another editor with the file open: the whole text (their buffers differ).
  paneList = [{ mod: "nocturne-editor", props: { path: "/p/src/a.rs" } }, { mod: "nocturne-editor", props: { path: "/p/src/a.rs" } }];
  ed.v += "//";
  ed.handlers.change({}, cx());
  tick();
  expect(notes.filter(([m]) => m === "textDocument/didChange").at(-1)[1].contentChanges).toEqual([{ text: ed.v }]);
});

test("changeBetween: one ranged change in UTF-16 positions", () => {
  expect(changeBetween("ab\ncd", "ab\ncxd")).toEqual({ range: { start: { line: 1, character: 1 }, end: { line: 1, character: 1 } }, text: "x" });
  expect(changeBetween("ab\ncd", "ab")).toEqual({ range: { start: { line: 0, character: 2 }, end: { line: 1, character: 2 } }, text: "" });
  expect(changeBetween("é😀a", "é😀b")).toEqual({ range: { start: { line: 0, character: 3 }, end: { line: 0, character: 4 } }, text: "b" });
  expect(changeBetween("x", "x")).toBe(null);
});

test("an answer is kept for its place until the text changes: asking again is instant", async () => {
  const p = await pane();
  answer = () => HOVER;
  p.command("hover", cx());
  await flush();
  p.command("hover", cx());
  p.command("hover", cx());
  expect(p.card.parts.length).toBe(2);
  expect(requests.filter(([m]) => m === "textDocument/hover").length).toBe(1);
  ed.v += " ";
  ed.handlers.change({}, cx());
  p.command("hover", cx());
  expect(requests.filter(([m]) => m === "textDocument/hover").length).toBe(2);
});

test("a hover the pointer left is cancelled by the next (herdr's keyed request); a cancelled one changes nothing", async () => {
  const p = await pane();
  answer = () => Promise.reject(new Error("cancelled"));
  p.hovered({ hovering: true, line: 1, col: 8 }, cx());
  await flush();
  expect(requests.at(-1)[2]).toEqual({ key: "hover" });
  expect(p.card?.pending).toBe(true);
});

test("the card's Markdown: rust-analyzer's headings become bold lines (code blocks are parts of their own)", () => {
  expect(cardMarkdown("Spawns.\n\n# Examples\nsee below\n## Errors ##\n#notaheading")).toBe("Spawns.\n\n**Examples**\nsee below\n**Errors**\n#notaheading");
});

test("a file changed on disk and reloaded is saved as far as the server goes (rust-analyzer checks on save)", async () => {
  const p = await pane();
  const disk = "fn main() {\n    let x: u32 = \"many\";\n}\n";
  onDisk = disk;
  p.load(cx(), null, true);
  await flush();
  expect(notes.map(([m]) => m)).toEqual(["textDocument/didChange", "textDocument/didSave"]);
  expect(notes[1][1]).toEqual({ textDocument: { uri: "file:///p/src/a.rs" }, text: disk });
  onDisk = "fn main() {\n    let x = 1;\n}\n";
});
