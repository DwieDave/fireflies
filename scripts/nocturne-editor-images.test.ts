// Pictures in a Markdown file (nocturne-editor's images.js, live.js's image
// unit, rendered.js's image block, main.js's paste and pick): an image line
// drawn as its own block (a broken path says so, a web one is drawn by the
// Markdown view, the copy for drawing made once), pasting a screenshot or a
// copied image file (cmd-v, the editors' paste-without-text, vim's p) saves it
// beside the document once and puts an image block at the caret, undo takes
// the block back (the file stays), the Markdown round-trips. A fake clipboard
// (exec of osascript faked), a real PNG fixture and real files in a temp
// folder. mock.module is process-wide: this file runs alone.
import { test, expect, mock, beforeEach } from "bun:test";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync, rmSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

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
const click = (el: any) => el.calls.on_click[0][0]({}, cx());
const theme: any = new Proxy({}, { get: () => "#808080" });

// ---- herdr
const files: Record<string, string> = {};
const writes: [string, string][] = [];
let propsNow: any = { path: "/p/notes.md", slot: "s1" };
let writeGate: Promise<void> | null = null; // a write held open (a slow disk)
// A real folder for the documents' pictures and the app's cache.
const ROOT = mkdtempSync(`${tmpdir()}/md-images-`);
const FIXTURE = `${import.meta.dir}/fixtures/nocturne-editor/moth.png`;
/** The clipboard: its text (what the app hands mods), a picture on it, a copied file. */
let clip: { text?: string; image?: boolean; file?: string } = {};
let picked: string | null = null;
const ran: [string, string[]][] = [];
/** herdr's exec, faked for what images.js and markdown.js run: the clipboard (osascript), the
 *  file into its place (sh paste-image), the cache copy (sh md-image), mkdir. Real files. */
async function fakeExec(cmd: string, args: string[]) {
  ran.push([cmd, args]);
  const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
  if (cmd === "mkdir") { mkdirSync(args[1], { recursive: true }); return ok(); }
  if (cmd === "osascript") {
    const path = args[args.length - 1];
    if (clip.file) return ok(`file:${clip.file}\n`);
    if (clip.image) { copyFileSync(FIXTURE, path); return ok("png\n"); }
    return ok("none\n");
  }
  if (cmd === "sh" && args[2] === "paste-image") {
    const [, , , dir, from, to, kind] = args;
    mkdirSync(dir, { recursive: true });
    if (kind === "file") copyFileSync(from, to); else renameSync(from, to);
    return ok();
  }
  if (cmd === "sh" && args[2] === "md-image") {
    const [, , , path, dir] = args;
    if (!existsSync(path)) return { code: 3, stdout: "", stderr: "" };
    mkdirSync(dir, { recursive: true });
    const name = `${readFileSync(path).length}-${path.split("/").pop()}`;
    copyFileSync(path, `${dir}/${name}`);
    return ok(name);
  }
  return { code: 1, stdout: "", stderr: `unexpected ${cmd}` };
}
const herdr: Record<string, any> = {
  settings: () => ({ zoom: 1, editor: { vim: false } }), window: () => ({ platform: "macos" }), appHome: () => `${ROOT}/app`, home: () => "/home/a",
  pickFile: async () => picked,
  props: () => propsNow, theme: () => theme, run: () => null,
  keys: () => [], panes: () => [], shared: () => null, setShared: () => {},
  readTextFile: async (p: string) => files[p] ?? null,
  writeTextFile: async (p: string, t: string, was: string | null) => {
    if ((files[p] ?? null) !== was) throw new Error("the file changed outside");
    if (writeGate) await writeGate;
    files[p] = t; writes.push([p, t]); return null;
  },
  watchFolder: () => new Promise(() => {}), nextCommand: () => new Promise(() => {}),
  exec: (cmd: string, args: string[]) => fakeExec(cmd, args), languageOf: (p: string) => (/\.md$/.test(p) ? "markdown" : null),
  highlight: () => [], lspStart: () => new Promise(() => {}), lspNotify: () => {}, lspRequest: () => Promise.resolve(null),
  lspNextMessage: () => new Promise(() => {}), lspRelease: () => null, setUnsaved: () => {}, notify: () => {},
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: () => new El(), image: (p: string) => { const e: any = new El(); e.kids.push(`image:${p}`); return e; }, PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} set_selected_range() {} }

// ---- gpui-base's EditorState, as it behaves for this

type P = { line: number; col: number };
// Line starts, cut once per text (the stand-in's own cost kept out of the mod's).
let startsFor = "", starts: number[] = [0];
const lineStarts = (text: string) => {
  if (text !== startsFor) { starts = [0]; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1); startsFor = text; }
  return starts;
};
const off = (text: string, p: P) => (lineStarts(text)[p.line] ?? text.length) + p.col;
const at = (text: string, o: number): P => { const b = text.slice(0, o).split("\n"); return { line: b.length - 1, col: b[b.length - 1].length }; };
const cmp = (a: P, b: P) => a.line - b.line || a.col - b.col;
/** Change events wait here until the keystroke's effects flush (settle). */
let effects: (() => void)[] = [];
/** Time spent in the stand-in's own text work (not the mod's). */
let standIn = 0;
/** Time in the mod's handlers for a key (its key handler and the change events after). */
let modTime = 0;
function settle() { for (let i = 0; i < 50 && effects.length; i++) { const q = effects; effects = []; for (const f of q) f(); } }
class Ed {
  v = ""; anchor: P = { line: 0, col: 0 }; head: P = { line: 0, col: 0 }; handlers: Record<string, any> = {}; opts: any; focusedNow = false;
  undos: [string, P][] = []; redos: [string, P][] = []; setValues = 0;
  constructor(o: any) { this.opts = o; }
  on(name: string, fn: any) { this.handlers[name] = fn; return true; }
  value() { return this.v; }
  emit() { effects.push(() => this.handlers.change?.({}, cx())); }
  /** No change event; caret, scroll and undo reset (gpui-base). */
  set_value(v: string) { this.v = v; this.anchor = this.head = { line: 0, col: 0 }; this.undos = []; this.setValues++; }
  cursor() { return { ...this.head }; }
  set_cursor(line: number, col: number, end?: P) {
    const t0 = performance.now();
    try { this.setCursorNow(line, col, end); } finally { standIn += performance.now() - t0; }
  }
  setCursorNow(line: number, col: number, end?: P) {
    const st = lineStarts(this.v);
    const len = (l: number) => (l + 1 < st.length ? st[l + 1] - 1 : this.v.length) - st[l];
    const clamp = (p: P) => { const l = Math.max(0, Math.min(st.length - 1, p.line)); return { line: l, col: Math.max(0, Math.min(len(l), p.col)) }; };
    this.anchor = clamp({ line, col }); this.head = end ? clamp(end) : { ...this.anchor };
  }
  selection() { const [s, e] = cmp(this.anchor, this.head) <= 0 ? [this.anchor, this.head] : [this.head, this.anchor]; const v = this.v; return { start: { ...s }, end: { ...e }, get text() { return v.slice(off(v, s), off(v, e)); } }; }
  set_selections(list: { start: P; end: P }[]) { const s = list[0]; if (s) { this.anchor = { ...s.start }; this.head = { ...s.end }; } }
  edit(list: any[]) {
    const t0 = performance.now();
    try { this.editNow(list); } finally { standIn += performance.now() - t0; }
  }
  editNow(list: any[]) {
    this.undos.push([this.v, this.head]); this.redos = [];
    const caret = off(this.v, this.head);
    let moved = caret;
    for (const e of [...list].sort((x, y) => off(this.v, y.start) - off(this.v, x.start))) {
      const s = off(this.v, e.start), en = off(this.v, e.end);
      if (s < caret) moved += e.text.length - (Math.min(en, caret) - s);
      this.v = this.v.slice(0, s) + e.text + this.v.slice(en);
    }
    this.anchor = this.head = at(this.v, Math.max(0, Math.min(this.v.length, moved)));
    this.emit();
  }
  undo() { const u = this.undos.pop(); if (!u) return; this.redos.push([this.v, this.head]); this.v = u[0]; this.anchor = this.head = u[1]; this.emit(); }
  redo() { const r = this.redos.pop(); if (!r) return; this.undos.push([this.v, this.head]); this.v = r[0]; this.anchor = this.head = r[1]; this.emit(); }
  /** A key as gpui delivers it: the key handler first; untaken text lands at the caret. */
  press(k: string, mods: any = {}, ch: string | null = null) {
    const e = key(k, mods, ch);
    const t0 = performance.now();
    const taken = this.handlers.key?.(e, cx());
    modTime += performance.now() - t0;
    if (!taken) {
      const text = ch ?? (k === "enter" ? "\n" : k === "space" ? " " : k.length === 1 ? k : null);
      if (text != null && !mods.platform && !mods.control) {
        const s = this.selection();
        this.undos.push([this.v, this.head]);
        this.v = this.v.slice(0, off(this.v, s.start)) + text + this.v.slice(off(this.v, s.end));
        this.anchor = this.head = at(this.v, off(this.v, s.start) + text.length);
        this.emit();
      } else if (k === "backspace") {
        const o = off(this.v, this.head);
        if (o > 0) { this.v = this.v.slice(0, o - 1) + this.v.slice(o); this.anchor = this.head = at(this.v, o - 1); this.emit(); }
      }
    }
    const t1 = performance.now();
    settle();
    modTime += performance.now() - t1;
    return taken;
  }
  bounds(p: P) {
    // Soft wrap at 60 characters, 18 px rows: where a place was drawn.
    const ls = this.v.split("\n");
    let row = 0;
    for (let l = 0; l < p.line; l++) row += Math.max(1, Math.ceil((ls[l]?.length ?? 0) / 60));
    row += Math.floor(Math.max(0, p.col - 1) / 60);
    return { x: (p.col % 60) * 8, y: 10 + row * 18, width: 8, height: 18, view: { x: 0, y: 10, width: 480, height: 400 } };
  }
  focus() { this.focusedNow = true; } focused() { return this.focusedNow; }
  set_tab_size() {} set_cursor_shape() {} set_diagnostics() {} set_line_notes() {} find_close() {} top_line() { return 0; } scroll_to_line() {} set_soft_wrap() {}
  find() { return { query: "", count: 0, current: null, active: false }; }
}
let eds: Ed[] = [];
mock.module("gpui-base", () => ({
  h_flex: () => new El(), v_flex: () => new El(), InputState: { new: () => new Input() }, Input: { new: () => new El() },
  TextView: { html: () => new El(), markdown: (_id: string, md: string) => { const e: any = new El(); e.kids.push(md); return e; } },
  EditorState: { new: (o: any) => { const e = new Ed(o); eds.push(e); return e; } }, Editor: { new: () => new El() },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
}));
(globalThis as any).window = { paint_path: () => new El() };
let store: Record<string, string> = {};
(globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };

const { default: EditorPane } = await import("../defaults/mods/nocturne-editor/main.js");
const { KINDS } = await import("../defaults/mods/nocturne-editor/rendered.js");
const images = await import("../defaults/mods/nocturne-editor/images.js");
const live = await import("../defaults/mods/nocturne-editor/live.js");

let later: [number, (cx: any) => void][] = [];
function cx(): any {
  return {
    stop_propagation() {}, notify() {},
    timer: { after: (ms: number, fn: any) => later.push([ms, fn]), every() {} },
    spawn: (fn: any) => { fn(cx()); }, focus_handle: () => ({ focus() {}, is_focused: () => false }),
    read_from_clipboard: () => clip.text ?? undefined, write_to_clipboard() {},
  };
}
function tick() { const due = later; later = []; for (const [, fn] of due) fn(cx()); settle(); }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); settle(); };
const key = (k: string, mods: any = {}, ch: string | null = null) => ({ key: k, key_char: ch ?? (k.length === 1 ? k : null), keystroke: k, modifiers: { shift: false, control: false, alt: false, platform: false, function: false, ...mods } });


const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const settleAll = async () => { for (let i = 0; i < 6; i++) { await flush(); await wait(2); } settle(); };

beforeEach(() => { eds = []; later = []; effects = []; writes.length = 0; store = {}; writeGate = null; clip = {}; picked = null; ran.length = 0; for (const k of Object.keys(files)) delete files[k]; });

const DOC = ["# Moths", "", "They come after ten.", "", "- one", "- two"].join("\n");

async function pane(path = `${ROOT}/docs/notes.md`, text = DOC, { vim = false, view = "rendered" } = {}): Promise<any> {
  files[path] = text;
  propsNow = { path, slot: "s1" };
  store = { preview: view };
  const p: any = new EditorPane();
  p.init({}, cx());
  await flush();
  p.paneVim = vim;
  p.vimSettled(vim);
  p.size = { width: 900, height: 700 };
  tick();
  return p;
}
const main = (p: any): Ed => p.cur.editor;
const R = (p: any) => p.cur.rendered;
const block = (p: any): Ed => R(p).block;
const clickLine = (p: any, line: number, end = true) => { const u = [...R(p).units, R(p).unit].find((x: any) => x.from <= line && line <= x.to); R(p).clickUnit(u, cx(), end); settle(); };
const assets = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);
const pngBytes = readFileSync(FIXTURE);

// ---- the pieces

test("where a pasted picture goes: assets/ beside a document, <note>-assets/ beside a scratchpad note", () => {
  const now = new Date(2026, 10, 13, 2, 30, 5);
  expect(images.assetPlace("/code/app/docs/plan.md", { now })).toEqual({ dir: "/code/app/docs/assets", path: "/code/app/docs/assets/plan-20261113-023005.png", rel: "assets/plan-20261113-023005.png" });
  const note = "/Users/dev/.config/herdr-app/scratchpad/app-0a1b2c3d.md";
  expect(images.assetPlace(note, { scratch: true, now, ext: "jpg" })).toEqual({
    dir: "/Users/dev/.config/herdr-app/scratchpad/app-0a1b2c3d-assets",
    path: "/Users/dev/.config/herdr-app/scratchpad/app-0a1b2c3d-assets/app-0a1b2c3d-20261113-023005.jpg",
    rel: "app-0a1b2c3d-assets/app-0a1b2c3d-20261113-023005.jpg",
  });
  // Two in one second don't overwrite each other.
  const taken = new Set(["/d/assets/x-20261113-023005.png"]);
  expect(images.assetPlace("/d/x.md", { now, taken: (p: string) => taken.has(p) }).rel).toBe("assets/x-20261113-023005-2.png");
  expect(images.relative("/code/app/docs", "/code/app/img/a.png")).toBe("../img/a.png");
  expect(images.relative("/code/app/docs", "/code/app/docs/a b.png")).toBe("a b.png");
  expect(images.imageMarkdown("shots/a b (1).png", "a [b]")).toBe("![a b](shots/a%20b%20%281%29.png)");
});

test("an image line goes on the caret's blank line, else after the caret's block, blank lines around it", () => {
  const md = "![](assets/x.png)";
  expect(images.insertImage("a\n\nb", 1, md)).toEqual({ text: "a\n\n![](assets/x.png)\n\nb", line: 2 });
  expect(images.insertImage("para one\nstill para\n\nnext", 0, md, 1)).toEqual({ text: "para one\nstill para\n\n![](assets/x.png)\n\nnext", line: 3 });
  expect(images.insertImage("last", 0, md)).toEqual({ text: "last\n\n![](assets/x.png)", line: 2 });
  expect(images.insertImage("", 0, md)).toEqual({ text: md, line: 0 });
  // A CRLF file keeps its line ends.
  expect(images.insertImage("a\r\nb", 0, md).text).toBe("a\r\n\r\n![](assets/x.png)\r\n\r\nb");
});

test("an image line is a unit of its own; the text round-trips byte for byte", () => {
  const text = "Intro text\n![moth](assets/m.png)\nmore\n\n<p><img src=\"b.png\" alt=\"b\"></p>\n\n![](https://x.dev/a.png) ![](c.png)";
  const u = live.units(text);
  expect(u.map((x: any) => x.kind)).toEqual(["para", "image", "para", "image", "image"]);
  expect(u[1].images).toEqual([{ alt: "moth", src: "assets/m.png" }]);
  expect(u[3].images).toEqual([{ alt: "b", src: "b.png" }]);
  expect(u[4].images.map((i: any) => i.src)).toEqual(["https://x.dev/a.png", "c.png"]);
  // Inline images inside text stay in their paragraph.
  expect(live.units("see ![a](a.png) here").map((x: any) => x.kind)).toEqual(["para"]);
  for (const x of u) expect(live.splice(text, x, live.slice(text, x)).text).toBe(text);
});

test("the clipboard per system: macOS osascript, Linux wl-paste / xclip, Windows PowerShell", async () => {
  expect(images.clipboardCommand("macos", "/t/a.png")[0]).toBe("osascript");
  expect(images.clipboardCommand("linux", "/t/a.png")).toEqual(["sh", ["-c", expect.stringContaining("wl-paste"), "clipboard-image", "/t/a.png"]]);
  expect(images.clipboardCommand("windows", "/t/a.png")[0]).toBe("powershell");
  const ex = (out: string, code = 0) => async () => ({ code, stdout: out, stderr: "" });
  expect(await images.readClipboardImage(ex("png\n"), "macos", "/t/a.png")).toEqual({ kind: "png", path: "/t/a.png" });
  expect(await images.readClipboardImage(ex("file:/u/Desktop/moth.png\n"), "macos", "/t/a.png")).toEqual({ kind: "file", path: "/u/Desktop/moth.png" });
  // A copied file that isn't a picture, no picture, a failing tool: not an image paste.
  expect(await images.readClipboardImage(ex("file:/u/notes.txt"), "macos", "/t/a.png")).toBeNull();
  expect(await images.readClipboardImage(ex("none"), "macos", "/t/a.png")).toBeNull();
  expect(await images.readClipboardImage(ex("", 1), "linux", "/t/a.png")).toBeNull();
  expect(images.maybeCopiedImage("moth.png")).toBe(true);
  expect(images.maybeCopiedImage("see moth.png\nnext")).toBe(false);
});

// ---- drawing

test("an image block draws its picture from one cached copy: fits the column, keeps its shape; asked once, not per key", async () => {
  mkdirSync(`${ROOT}/docs/assets`, { recursive: true });
  copyFileSync(FIXTURE, `${ROOT}/docs/assets/moth.png`);
  const p = await pane(`${ROOT}/docs/notes.md`, "# Moths\n\n![moth](assets/moth.png)\n\nText.");
  await settleAll();
  const v = p.renderedView(theme);
  const pic = all(v).find((e: any) => e.kids?.some((k: any) => typeof k === "string" && k.startsWith("image:cache/nocturne-editor/")));
  expect(pic).toBeTruthy();
  expect(pic.calls.max_w_full).toBeTruthy();
  expect(pic.calls.max_h[0][0]).toBe(560);
  // Typing elsewhere, many frames: the picture is copied for drawing once.
  clickLine(p, 4);
  for (const ch of "more words") { block(p).press(ch === " " ? "space" : ch, {}, ch); p.renderedView(theme); }
  await settleAll();
  expect(ran.filter(([c, a]) => c === "sh" && a[2] === "md-image").length).toBe(1);
});

test("a broken path is a block that says so; a picture on the web is drawn by the Markdown view", async () => {
  const p = await pane(`${ROOT}/docs/broken.md`, "![gone](assets/nowhere.png)\n\n![web](https://example.com/m.png)\n\nText.");
  clickLine(p, 4);
  await settleAll();
  const words = texts(p.renderedView(theme)).join(" | ");
  expect(words).toContain("picture not found");
  expect(words).toContain("assets/nowhere.png");
  expect(words).toContain("![web](https://example.com/m.png)");
});

// ---- pasting

test("a screenshot pasted into the rendered view: saved once beside the file, an image block after the caret's block, drawn; undo takes the block back, the file stays", async () => {
  const path = `${ROOT}/docs/paste.md`;
  const p = await pane(path, DOC);
  clickLine(p, 2);
  clip = { image: true };
  // cmd-v: the clipboard has no text, so the block's own paste finds none and says so (paste_other).
  expect(block(p).press("v", { platform: true })).toBeFalsy();
  block(p).handlers.paste_other({}, cx());
  await settleAll();
  const saved = assets(`${ROOT}/docs/assets`).filter((f) => f.startsWith("paste-"));
  expect(saved.length).toBe(1);
  expect(saved[0]).toMatch(/^paste-\d{8}-\d{6}\.png$/);
  expect(readFileSync(`${ROOT}/docs/assets/${saved[0]}`).equals(pngBytes)).toBe(true);
  const want = DOC.replace("They come after ten.\n", `They come after ten.\n\n![](assets/${saved[0]})\n`);
  expect(main(p).value()).toBe(want);
  // The caret's on it: lit as an image block.
  expect(R(p).unit.kind).toBe("image");
  // Away from it, it's drawn.
  clickLine(p, 0);
  await settleAll();
  expect(texts(p.renderedView(theme)).some((w) => w.startsWith("image:cache/nocturne-editor/"))).toBe(true);
  // Undo: the block goes, the file stays (a picture saved isn't taken back with the text).
  main(p).undo(); settle();
  expect(main(p).value()).toBe(DOC);
  expect(existsSync(`${ROOT}/docs/assets/${saved[0]}`)).toBe(true);
  // The Markdown written is what's read back.
  main(p).redo(); settle();
  expect(live.units(main(p).value()).find((u: any) => u.kind === "image").images[0].src).toBe(`assets/${saved[0]}`);
});

test("a copied image file (Finder: its name is the clipboard's text): cmd-v copies it beside the file, the original stays", async () => {
  const path = `${ROOT}/docs/finder.md`;
  const p = await pane(path, DOC);
  clickLine(p, 0);
  clip = { text: "moth.png", file: FIXTURE };
  expect(block(p).press("v", { platform: true })).toBe(true);
  await settleAll();
  const saved = assets(`${ROOT}/docs/assets`).filter((f) => f.startsWith("finder-"));
  expect(saved).toEqual([expect.stringMatching(/^finder-\d{8}-\d{6}\.png$/)]);
  expect(main(p).value()).toContain(`# Moths\n\n![moth](assets/${saved[0]})\n\nThey come`);
  expect(existsSync(FIXTURE)).toBe(true);
});

test("text pastes as before: cmd-v with text is the editor's; a name that isn't a copied file is pasted as typed", async () => {
  const p = await pane(`${ROOT}/docs/text.md`, DOC);
  clickLine(p, 2);
  clip = { text: "plain words" };
  expect(block(p).press("v", { platform: true })).toBeFalsy();
  expect(ran.some(([c]) => c === "osascript")).toBe(false);
  // A file name, but no file on the clipboard: the name goes in as text.
  clip = { text: "diagram.png" };
  expect(block(p).press("v", { platform: true })).toBe(true);
  await settleAll();
  expect(main(p).value()).toContain("They come after ten.diagram.png");
});

test("vim: p in normal mode pastes the clipboard's picture; with none, p is vim's own", async () => {
  const p = await pane(`${ROOT}/docs/vim.md`, DOC, { vim: true });
  block(p).press("j"); block(p).press("j");
  clip = { image: true };
  expect(block(p).press("p")).toBe(true);
  await settleAll();
  expect(main(p).value()).toMatch(/They come after ten\.\n\n!\[\]\(assets\/vim-\d{8}-\d{6}\.png\)\n\n- one/);
  // No picture, no text: vim's register (a yanked line) is put.
  const q = await pane(`${ROOT}/docs/vim2.md`, DOC, { vim: true });
  clip = {};
  for (const k of "yyj") block(q).press(k);
  block(q).press("p");
  await settleAll();
  expect(main(q).value()).toBe("# Moths\n\n# Moths\nThey come after ten.\n\n- one\n- two");
});

test("the text view of a Markdown file takes a pasted picture too; a scratchpad's go to <note>-assets/", async () => {
  const p = await pane(`${ROOT}/docs/textview.md`, DOC, { view: "text" });
  main(p).set_cursor(4, 3); // in the list's first item: the picture goes after that item
  clip = { image: true };
  main(p).handlers.paste_other({}, cx());
  await settleAll();
  expect(main(p).value()).toMatch(/- one\n\n!\[\]\(assets\/textview-\d{8}-\d{6}\.png\)\n\n- two$/);
  // In a paragraph's first line: after the whole paragraph, not between its lines.
  const q = await pane(`${ROOT}/docs/textview2.md`, "one line\nand its next\n\nend", { view: "text" });
  main(q).set_cursor(0, 2);
  main(q).handlers.paste_other({}, cx());
  await settleAll();
  expect(main(q).value()).toMatch(/^one line\nand its next\n\n!\[\]\(assets\/textview2-\d{8}-\d{6}\.png\)\n\nend$/);
  const note = `${ROOT}/app/scratchpad/app-0a1b2c3d.md`;
  mkdirSync(`${ROOT}/app/scratchpad`, { recursive: true });
  const s = await pane(note, "notes");
  clickLine(s, 0);
  block(s).handlers.paste_other({}, cx());
  await settleAll();
  const saved = assets(`${ROOT}/app/scratchpad/app-0a1b2c3d-assets`);
  expect(saved).toEqual([expect.stringMatching(/^app-0a1b2c3d-\d{8}-\d{6}\.png$/)]);
  expect(main(s).value()).toBe(`notes\n\n![](app-0a1b2c3d-assets/${saved[0]})`);
});

test("the image kind and the commands' list: a picked file becomes an image block with a relative path", async () => {
  const p = await pane(`${ROOT}/docs/pick.md`, DOC);
  clickLine(p, 2);
  block(p).press("enter");
  expect(KINDS.map(([n]: string[]) => n)).toContain("image");
  picked = FIXTURE;
  click(byId(p.renderedView(theme), "rendered-kind-image"));
  await settleAll();
  const rel = images.relative(`${ROOT}/docs`, FIXTURE);
  expect(main(p).value()).toContain(`They come after ten.\n\n![moth](${rel})\n`);
  // cmd-. then p asks for a file the same way; v pastes the clipboard's picture.
  clickLine(p, 0);
  picked = null;
  block(p).press(".", { platform: true });
  expect(texts(p.mdMenuView(theme))).toContain("Paste an image");
  block(p).press("v");
  clip = {};
  await settleAll();
  expect(texts(p.bar(theme)).join(" ")).toContain("the clipboard holds no picture");
});

test("nothing pasted when the clipboard holds no picture: no file, no folder", async () => {
  const p = await pane(`${ROOT}/docs/none.md`, DOC);
  clickLine(p, 2);
  block(p).handlers.paste_other({}, cx());
  await settleAll();
  expect(main(p).value()).toBe(DOC);
  expect(assets(`${ROOT}/docs/assets`).filter((f) => f.startsWith("none-"))).toEqual([]);
});
