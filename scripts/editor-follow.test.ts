// The editor follows a file renamed, moved or deleted from the files pane
// (editor/follow.ts): through shared("nocturne.files.changes"),
// only entries newer than its start, only its own machine's. herdr and gpui
// stand-ins (mock.module is process-wide: this file runs alone).
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
        else t.calls[k] = a;
        return proxy;
      },
    });
  }
}
const texts = (e: any): string[] => typeof e === "string" ? [e] : e instanceof Object && "kids" in e ? e.kids.flatMap(texts) : [];
const theme: any = new Proxy({}, { get: () => "#808080" });
const opened: any[] = [];
let sharedNow: Record<string, any> = {};
const lsp: any[] = [];
const unsaved: any[] = [];
const storage: Record<string, string> = {};
(globalThis as any).localStorage = { getItem: (k: string) => storage[k] ?? null, setItem: (k: string, v: string) => { storage[k] = String(v); } };
const closed: any[] = [];
let propsNow: any = {};
const herdr: Record<string, any> = {
  settings: () => ({ zoom: 1 }), window: () => ({ platform: "macos" }), agents: () => [], appHome: () => "/tmp/app",
  closeOverlay: (id: any) => { closed.push(id); }, commands: () => [], exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => null,
  hc: async () => ({ code: 1, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: async () => [], layout: () => ({}),
  layouts: () => ["nocturne"], nextCommand: () => new Promise(() => {}), notify: () => {}, openOverlay: (o: any) => { opened.push(o); return "o1"; },
  panes: () => [], pickFolder: async () => null, presentUpdateNotes: () => {}, props: () => propsNow, run: () => null, setAgentOrder: () => {},
  setShared: (k: string, v: any) => { sharedNow[k] = v; }, shared: (k: string) => sharedNow[k] ?? null, spaces: () => [], terminals: () => [], theme: () => theme, updates: () => ({ notes: [] }),
  findFiles: async () => [], readTextFile: async () => null, writeTextFile: async () => {}, watchFolder: () => {},
  languageOf: (p: string) => (/\.rs$/.test(p) ? "rust" : /\.md$/.test(p) ? "markdown" : null), highlight: () => [], lspStart: () => null, lspRequest: async () => null, lspNotify: (id: number, method: string, params: any) => { lsp.push([method, params?.textDocument?.uri]); return null; }, lspNextMessage: () => new Promise(() => {}), lspRelease: (id: number) => { lsp.push(["release", id]); return null; }, setUnsaved: (note: any) => { unsaved.push(note); return null; },
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



const { CHANGES, follow, changeFor, newestId } = await import("../defaults/mods/editor/follow.ts");
const { default: Editor } = await import("../defaults/mods/editor/main.ts");

beforeEach(() => { sharedNow = {}; lsp.length = 0; unsaved.length = 0; for (const k of Object.keys(storage)) delete storage[k]; });

const cx = (): any => ({ notify() {}, stop_propagation() {}, spawn() {}, timer: { after() {}, every() {} }, focus_handle: () => ({ focus() {}, is_focused: () => false }) });
let nextId = 0;
const record = (from: string, to: string | null, on: string | null = null) => {
  const list = [...(sharedNow[CHANGES] ?? []), { id: ++nextId, from, to, on, at: Date.now() }];
  sharedNow[CHANGES] = list.slice(-50);
};

/** An editor as started on `path`, its buffer `text` (edited: unsaved), its server running. */
function editor(path: string, { text = "fn main() {}\n", edited = false, on = null }: { text?: string; edited?: boolean; on?: string | null } = {}) {
  const e: any = Object.create(Editor.prototype);
  const buffer = { value: edited ? text + "// more\n" : text, language: null as string | null, cursor: { line: 3, col: 4 } };
  Object.assign(e, {
    cur: {}, docs: [], listening: new Set(), path, firstPath: path, on, slot: `s-${path}`, lang: path.endsWith(".rs") ? "rust" : "markdown", opts: {}, state: "ready", saved: text, dirty: edited, deleted: false,
    seenChange: newestId(sharedNow[CHANGES] ?? []), version: 1, problems: [], conflict: false,
    server: { id: 7, status: "ready", name: "rust-analyzer" },
    editor: { value: () => buffer.value, set_language: (l: string) => { buffer.language = l; }, set_diagnostics() {}, set_line_notes() {}, cursor: () => buffer.cursor, set_value() { throw new Error("the buffer must stay"); } },
    say(text: string) { this.said = text; }, watch() { this.watched = this.path; }, startServer() { this.started = true; }, setProblems() {},
  });
  return { e, buffer };
}

test("follow: a file, a folder by prefix, a delete, only newer entries, only its machine's", () => {
  expect(changeFor({ from: "/w/a.rs", to: "/w/b.rs", on: null }, "/w/a.rs")).toEqual({ to: "/w/b.rs" });
  expect(changeFor({ from: "/w/src", to: "/w/lib", on: null }, "/w/src/x/a.rs")).toEqual({ to: "/w/lib/x/a.rs" });
  expect(changeFor({ from: "/w/src", to: "/w/lib", on: null }, "/w/srcs/a.rs")).toBe(null); // a prefix of the name isn't the folder
  expect(changeFor({ from: "/w/a.rs", to: null, on: null }, "/w/a.rs")).toEqual({ deleted: true });
  expect(changeFor({ from: "/w/a.rs", to: "/w/b.rs", on: "box" }, "/w/a.rs", null)).toBe(null);
  expect(changeFor({ from: "/w/a.rs", to: "/w/b.rs", on: "box" }, "/w/a.rs", "box")).toEqual({ to: "/w/b.rs" });
  // Moved twice, in order; an old entry skipped.
  const list = [{ id: 3, from: "/w/a.rs", to: "/w/old.rs" }, { id: 4, from: "/w/a.rs", to: "/w/b.rs" }, { id: 5, from: "/w/b.rs", to: "/w/c.rs" }];
  expect(follow(list, 3, "/w/a.rs")).toEqual({ path: "/w/c.rs", deleted: false, seen: 5 });
});

test("a file moved: the editor follows; buffer, edits and caret stay; name, unsaved mark, tab and the server's document follow", () => {
  const { e, buffer } = editor("/w/src/a.rs", { edited: true });
  record("/w/src/a.rs", "/w/src/b.rs");
  e.followChanges(cx());
  expect(e.path).toBe("/w/src/b.rs");
  expect([buffer.value.endsWith("// more\n"), e.dirty, e.editor.cursor()]).toEqual([true, true, { line: 3, col: 4 }]);
  expect(lsp).toEqual([["textDocument/didClose", "file:///w/src/a.rs"], ["textDocument/didOpen", "file:///w/src/b.rs"]]);
  expect(unsaved.at(-1)).toBe("b.rs: unsaved changes");
  expect(sharedNow["editor.titles"]?.[e.slot] ?? Object.values(sharedNow).find((v: any) => v && typeof v === "object" && e.slot in v)?.[e.slot]).toBe("b.rs ●");
  expect(e.watched).toBe("/w/src/b.rs");
  // A restart of the pane opens it where it went.
  expect(JSON.parse(storage.moved)).toEqual({ from: "/w/src/a.rs", to: "/w/src/b.rs" });
  // Renamed to another language: its grammar and a new server.
  record("/w/src/b.rs", "/w/src/b.md");
  e.followChanges(cx());
  expect([e.lang, buffer.language, e.started]).toEqual(["markdown", "markdown", true]);
  expect(lsp.at(-1)).toEqual(["release", 7]);
});

test("a folder moved with two editors under it: both follow", () => {
  const a = editor("/w/src/a.rs").e, b = editor("/w/src/deep/b.rs").e, other = editor("/w/other.rs").e;
  record("/w/src", "/w/lib");
  for (const e of [a, b, other]) e.followChanges(cx());
  expect([a.path, b.path, other.path]).toEqual(["/w/lib/a.rs", "/w/lib/deep/b.rs", "/w/other.rs"]);
});

test("deleted, with and without unsaved edits: the editor stays with its text, says so, and a save writes it again", () => {
  for (const edited of [false, true]) {
    const { e, buffer } = editor("/w/a.rs", { edited });
    record("/w/a.rs", null);
    e.followChanges(cx());
    expect([e.path, e.deleted, e.saved]).toEqual(["/w/a.rs", true, null]);
    expect(buffer.value.length).toBeGreaterThan(0);
    // The buffer isn't on disk any more: it is unsaved work either way.
    expect(e.dirty).toBe(true);
    expect(unsaved.at(-1)).toBe("a.rs: deleted, unsaved");
  }
  // Its bar says so.
  const { e } = editor("/w/a.rs");
  record("/w/a.rs", null);
  e.followChanges(cx());
  const texts = (x: any): string[] => typeof x === "string" ? [x] : x?.kids ? x.kids.flatMap(texts) : [];
  Object.assign(e, { vim: { mode: "normal" }, vimOn: () => false, size: { width: 900 }, message: null, server: null });
  expect(texts(e.bar(theme)).join(" ")).toMatch(/deleted · cmd-s writes it again/);
});

test("a persisted old entry is ignored at start; another machine's entry is ignored by a local editor", () => {
  record("/w/a.rs", "/w/old.rs"); // before the editor started (kept across a restart)
  const { e } = editor("/w/a.rs");
  e.followChanges(cx());
  expect(e.path).toBe("/w/a.rs");
  record("/w/a.rs", "/w/b.rs", "box"); // on another machine
  e.followChanges(cx());
  expect([e.path, e.deleted]).toEqual(["/w/a.rs", false]);
  expect(e.seenChange).toBe(newestId(sharedNow[CHANGES] ?? []));
});

test("the Markdown viewer follows a move too, its scroll and its back history with it", async () => {
  const { default: Markdown } = await import("../defaults/mods/markdown/main.ts");
  const m: any = Object.create(Markdown.prototype);
  const opened: any[] = [];
  Object.assign(m, { path: "/w/docs/a.md", on: null, history: [{ path: "/w/docs/index.md", scrollY: 40 }], seenChange: newestId(sharedNow[CHANGES] ?? []),
    open(path: string, _cx: any, anchor: any, keep: boolean) { opened.push([path, keep]); this.path = path; } });
  record("/w/docs", "/w/guide");
  m.followChanges(cx());
  expect(opened).toEqual([["/w/guide/a.md", true]]);
  expect(m.history).toEqual([{ path: "/w/guide/index.md", scrollY: 40 }]);
  // Another machine's move: nothing.
  record("/w/guide/a.md", "/w/x.md", "box");
  m.followChanges(cx());
  expect(m.path).toBe("/w/guide/a.md");
});

test("the editor's and the Markdown viewer's follow.ts are the same file", async () => {
  const { readFileSync } = await import("fs");
  const read = (m: string) => readFileSync(`${import.meta.dir}/../defaults/mods/${m}/follow.ts`, "utf8");
  expect(read("markdown")).toBe(read("editor"));
});

test("macOS's /private links: /var/... and /private/var/... are the same file, either way round", () => {
  // The files tree records /private/var/..., the editor holds /var/...: it follows, keeping its own form.
  expect(changeFor({ from: "/private/var/tmp/w/a.rs", to: "/private/var/tmp/w/b.rs", on: null }, "/var/tmp/w/a.rs")).toEqual({ to: "/var/tmp/w/b.rs" });
  // The other way round, and a folder.
  expect(changeFor({ from: "/tmp/w", to: "/tmp/v", on: null }, "/private/tmp/w/x/a.rs")).toEqual({ to: "/private/tmp/v/x/a.rs" });
  expect(changeFor({ from: "/private/etc/a", to: null, on: null }, "/etc/a")).toEqual({ deleted: true });
  // Only those three: /private/other stays itself; /variant isn't /var.
  expect(changeFor({ from: "/private/other/a", to: "/x", on: null }, "/other/a")).toBe(null);
  expect(changeFor({ from: "/private/variant/a", to: "/x", on: null }, "/variant/a")).toBe(null);
});
