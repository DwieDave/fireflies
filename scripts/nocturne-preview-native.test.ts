import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";

// The preview's PDFs, fonts, audio and video: macOS views where they exist, else pdftoppm or a plain "can't".
// The mods import the app's modules; stand-ins record what they're asked (as nocturne-preview.test.ts).
class Element {
  calls: [string, any[]][] = [];
  nodes: any[] = [];
  constructor(public kind = "div", public arg?: any) {
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
const call = (el: any, name: string) => el.calls.find(([k]: [string]) => k === name)?.[1];
/** Every element under `el`, depth first. */
const walk = (el: any): any[] => (el && typeof el === "object" && "nodes" in el ? [el, ...el.nodes.flatMap(walk)] : []);
const commands: [string, any][] = [];
const world: { panes: any[]; spaces: any[]; shared: Record<string, any> } = { panes: [], spaces: [], shared: {} };
const herdr = {
  props: () => ({}), theme: () => ({ background: "#080808", foreground: "#c6c6c6", hover: "#1c1c1c", ansi0: "#323437", ansi8: "#949494", accent: "#80a0ff", muted: "#949494", dim: "#5F6D6D" }),
  settings: () => ({ zoom: 1 }), exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  panes: () => world.panes, spaces: () => world.spaces, terminals: () => [] as any[],
  shared: (k: string) => world.shared[k] ?? null, setShared: (k: string, v: any) => { world.shared[k] = v; return null; },
  readTextFile: async () => null, writeTextFile: async () => null, watchFolder: () => new Promise(() => {}), nextCommand: () => new Promise(() => {}),
  focused: () => null, home: () => "/home/me", appHome: () => "/home/me/.config/herdr-app", window: () => ({ platform: "linux" }),
};
const kit = {
  View: class {}, div: () => new Element(), svg: (p: string) => new Element("svg", p), image: (p: string) => new Element("image", p),
  PathBuilder: { fill: () => new Element() }, Background: { checkerboard: () => ({}) },
};
const base = {
  h_flex: () => new Element(), v_flex: () => new Element(), v_virtual_list: () => new Element(), Scrollbar: { vertical: () => new Element() },
  VirtualListScrollHandle: { new: () => ({}) }, Editor: { new: () => new Element() }, EditorState: { new: () => ({}) },
};

/** A shipped mod file run with stand-ins for the app's modules (imports dropped,
 *  exports returned); `extra` fills in what its own imports would have. */
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

async function load(path: string, extra: Record<string, unknown> = {}): Promise<any> {
  const source = await readFile(new URL(`../defaults/mods/${path}`, import.meta.url), "utf8");
  const names: string[] = [];
  const body = source
    .replace(/^import .*;\n/gm, "")
    .replace(/^export default class (\w+)/m, (_m, n) => { names.push(`default: ${n}`); return `class ${n}`; })
    .replace(/^export (async function|function|const|class) (\w+)/gm, (_m, kind, n) => { names.push(n); return `${kind} ${n}`; })
    .replace(/^export const (\w+) = /gm, (_m, n) => { names.push(n); return `const ${n} = `; });
  const win = { paint_path: () => new Element() };
  const scope: Record<string, unknown> = { ...kit, ...base, ...herdr, appWindow: herdr.window, ...extra, window: win };
  Object.assign(scope, await keyhelpOf(path, source, scope));
  return new Function(...Object.keys(scope), `${body}\nreturn { ${names.join(", ")} };`)(...Object.values(scope));
}


const kinds = await load("nocturne-preview/kinds.js");
const imageLogic = await load("nocturne-preview/image.js", kinds);
const T = await load("nocturne-preview/table.js");
const D = await load("nocturne-preview/diff.js");
const { parse: parseTable, ...tableRest } = T;
const { parse: parsePatch, ...diffRest } = D;
const text = (el: any) => walk(el).flatMap((e) => e.nodes.filter((n: any) => typeof n === "string"));

const calls: [string, string, any][] = [];
const nativeHerdr = {
  ...herdr,
  nativeView: { new: (id: string, props: any) => new Element("native", { id, props }) },
  nativeViewCapabilities: () => ({ available: true }),
  nativeViewCall: (id: string, action: string, args: any) => {
    calls.push([id, action, args]);
    if (action.startsWith("pdf.")) return { page: 2, pageCount: 9, scale: 1.5, autoScales: false };
    return { content: id === "preview-pdf" ? { page: 1, pageCount: 9, scale: 1.25, autoScales: true } : { rate: 0, duration: 187 } };
  },
  nextNativeViewEvent: () => new Promise(() => {}),
};
const keyLogic = await load("nocturne-preview/keys.js");
const logic = { ...kinds, ...keyLogic, ...imageLogic, ...tableRest, parseTable, ...diffRest, parsePatch, herdr: nativeHerdr };
const { kindOf, sniffKind, route, rasterArgv, pageCount, duration, siblings, tag, noun, previewable } = kinds;
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

test("kinds by extension; text people edit isn't previewed", () => {
  expect(["a.png", "r.PDF", "d.csv", "d.tsv", "app.sqlite", "x.db", "f.patch", "f.diff", "Inter.woff2", "a.ttf", "clip.MOV", "song.mp3"].map(kindOf))
    .toEqual(["image", "pdf", "table", "table", "sqlite", "sqlite", "diff", "diff", "font", "font", "video", "audio"]);
  expect(["a.json", "b.yaml", "c.toml", "main.rs", "notes.md", "Makefile", ".png", "a.webm"].some(previewable)).toBe(false);
  expect([tag("table", "a.tsv"), tag("table", "a.csv"), tag("pdf", "a.pdf"), tag("audio", "a.mp3")]).toEqual(["TSV", "CSV", "PDF", "AUDIO"]);
  expect([noun("pdf"), noun("audio")]).toEqual(["PDF", "recording"]);
});

test("first bytes: PDF, SQLite and every font format", () => {
  expect(sniffKind(ascii("%PDF-1.7\n"))).toEqual({ kind: "pdf" });
  expect(sniffKind([0, 1, 0, 0, 0, 12])).toEqual({ kind: "font", format: "ttf" });
  expect(["OTTO", "wOFF", "wOF2", "ttcf"].map((m) => sniffKind(ascii(m + "\0\0"))?.format)).toEqual(["otf", "woff", "woff2", "ttc"]);
  expect(sniffKind(ascii("hello"))).toBeNull();
});

test("how each kind shows: macOS views first, then a tool, else why not", () => {
  expect(route("pdf", { native: true })).toEqual({ how: "native", view: "pdf" });
  expect(route("pdf", { tools: ["pdftoppm", "sips"] })).toEqual({ how: "raster", tool: "pdftoppm" });
  expect(route("pdf", { tools: ["sips"] })).toEqual({ how: "raster", tool: "sips", firstOnly: true });
  expect(route("pdf", {}).how).toBe("none");
  expect(route("font", { native: true })).toEqual({ how: "native", view: "quicklook" });
  expect(route("video", { native: true })).toEqual({ how: "native", view: "media" });
  expect(route("audio", {})).toEqual({ how: "none", why: "Playing media here works on macOS only" });
  expect(route("image", {}).how).toBe("image");
  expect(rasterArgv("pdftoppm", 3)).toEqual(["pdftoppm", "-f", "3", "-l", "3", "-png", "-r", "144", "-singlefile", "$IN", "$OUTBASE"]);
  expect(pageCount("Title: x\nPages:          12\n")).toBe(12);
  expect(pageCount("kMDItemNumberOfPages = 4")).toBe(4);
  expect(pageCount("")).toBe(0);
  expect([duration(187), duration(3723), duration(NaN)]).toEqual(["3:07", "1:02:03", ""]);
});

test("next / previous stays with the same kind (audio and video together)", () => {
  const names = ["b.pdf", "a.png", "c.csv", "A.pdf", "song.mp3", "clip.mov", "notes.md"];
  expect(siblings(names, "b.pdf")).toEqual(["A.pdf", "b.pdf"]);
  expect(siblings(names, "c.csv")).toEqual(["c.csv"]);
  expect(siblings(names, "song.mp3")).toEqual(["clip.mov", "song.mp3"]);
});

async function nativeView(extra: Record<string, any>) {
  const { default: PreviewView } = await load("nocturne-preview/main.js", logic);
  const view: any = Object.create(PreviewView.prototype);
  Object.assign(view, {
    on: null, slot: "s1", handle: { focus() {}, is_focused: () => true }, port: { width: 900, height: 600 }, names: [], copied: 0, gen: 1,
    note: null, sy: 0, sx: 0, cursor: 0, ...extra,
  });
  return view;
}

test("a PDF on macOS: the system's PDF view on the cached copy; pages and zoom in the bar", async () => {
  const view = await nativeView({ path: "/r/report.pdf", kind: "pdf", how: { how: "native", view: "pdf" }, local: "/cache/1-2.pdf", rev: "1-2:2", info: { bytes: 2048 }, pdf: { page: 1, pageCount: 9, scale: 1, autoScales: true } });
  const tree = view.render();
  const el = walk(tree).find((e) => e.kind === "native");
  expect(el.arg).toEqual({ id: "preview-pdf", props: { kind: "pdf", path: "/cache/1-2.pdf", rev: "1-2:2" } });
  expect(text(tree)).toEqual(expect.arrayContaining(["PDF", "report.pdf", "9 pages · 2.0 KB", "p 1/9", "100%", "fit", "−", "+"]));
  const cx = { notify() {}, stop_propagation() {} };
  calls.length = 0;
  view.key({ key: "right", modifiers: {} }, cx);
  view.key({ key: "+", modifiers: {} }, cx);
  view.key({ key: "0", modifiers: {} }, cx);
  view.key({ key: "G", modifiers: { shift: true } }, cx);
  expect(calls.map(([, a, args]) => [a, args])).toEqual([["pdf.next", {}], ["pdf.zoomIn", {}], ["pdf.fitWidth", {}], ["pdf.goToPage", { page: 9 }]]);
  expect(view.pdf).toEqual({ page: 2, pageCount: 9, scale: 1.5, autoScales: false });
  // Page events from the view keep the bar current.
  view.nativeEvent({ id: "preview-pdf", event: "pdf.page", data: { page: 5, pageCount: 9 } }, cx);
  expect(view.pdf.page).toBe(5);
  // Loaded: it fits the page once it has its size, without an event; the bar asks again.
  calls.length = 0;
  const later = { notify() {}, timer: { after: (_ms: number, f: any) => f(later) } };
  view.nativeEvent({ id: "preview-pdf", event: "load.finish", data: { page: 1, pageCount: 9, scale: 0.1, autoScales: true } }, later);
  expect(calls.map(([, a]) => a)).toEqual(["state"]);
  view.nativeEvent({ id: "preview-pdf", event: "load.error", data: { message: "This PDF is damaged" } }, cx);
  expect(text(view.render())).toEqual(expect.arrayContaining(["Can't preview this PDF", "This PDF is damaged", "open in its app  o"]));
});

test("a PDF without macOS views: pdftoppm's page as a picture, ← → turn pages", async () => {
  const view = await nativeView({
    path: "/r/report.pdf", kind: "pdf", how: { how: "raster", tool: "pdftoppm" }, pages: 4, page: 2, info: { bytes: 2048, width: 1190, height: 1684 },
    copy: { name: "1-2.pdf", abs: "/c/1-2.pdf", format: "pdf", page: { name: "1-2-p2.png", abs: "/c/1-2-p2.png", format: "png" } }, src: "cache/nocturne-preview/1-2-p2.png", view: null,
  });
  const tree = view.render();
  expect(walk(tree).find((e) => e.kind === "image").arg).toBe("cache/nocturne-preview/1-2-p2.png");
  expect(text(tree)).toEqual(expect.arrayContaining(["4 pages · 2.0 KB", "p 2/4", "fit", "100%"]));
  const went: any[] = [];
  view.rasterPage = () => went.push(view.page);
  view.key({ key: "right", modifiers: {} }, { notify() {}, stop_propagation() {}, spawn: (f: any) => f({}) });
  view.key({ key: "G", modifiers: { shift: true } }, { notify() {}, stop_propagation() {}, spawn: (f: any) => f({}) });
  expect(went).toEqual([3, 4]);
});

test("a font: Quick Look's specimen; a clip: the system's player, Space plays", async () => {
  const font = await nativeView({ path: "/f/Inter.woff2", kind: "font", how: { how: "native", view: "quicklook" }, local: "/c/9-9.woff2", info: { bytes: 99000, format: "woff2" } });
  expect(walk(font.render()).find((e) => e.kind === "native").arg.props.kind).toBe("quicklook");
  expect(text(font.render())).toEqual(expect.arrayContaining(["FONT", "Inter.woff2", "WOFF2 · 97 KB"]));
  const clip = await nativeView({ path: "/v/demo.mov", kind: "video", how: { how: "native", view: "media" }, local: "/v/demo.mov", info: { bytes: 5 * 1024 * 1024 }, media: { duration: 187 } });
  expect(walk(clip.render()).find((e) => e.kind === "native").arg).toEqual({ id: "preview-media", props: { kind: "media", path: "/v/demo.mov", rev: undefined } });
  expect(text(clip.render())).toEqual(expect.arrayContaining(["VIDEO", "3:07 · MOV · 5.0 MB"]));
  calls.length = 0;
  clip.key({ key: "space", modifiers: {} }, { notify() {}, stop_propagation() {} });
  expect(calls.map(([, a]) => a)).toEqual(["state", "media.play"]);
});

test("Linux: fonts and media say why not and offer the system's app", async () => {
  const view = await nativeView({ path: "/v/demo.mp4", kind: "video", error: route("video", {}).why, info: { bytes: 1 } });
  expect(text(view.render())).toEqual(expect.arrayContaining(["Can't preview this video", "Playing media here works on macOS only", "open in its app  o"]));
  commands.length = 0;
  view.key({ key: "o", modifiers: {} }, { notify() {}, stop_propagation() {} });
  expect(commands).toEqual([["preview.open", { path: "/v/demo.mp4", in: "system" }]]);
});

test("a clip by keys: seek, back to the start, sound; Esc in the player gives the keys back", async () => {
  const clip = await nativeView({ path: "/v/demo.mov", kind: "video", how: { how: "native", view: "media" }, local: "/v/demo.mov", info: { bytes: 1 }, media: { duration: 187 } });
  const cx = { notify() {}, stop_propagation() {} };
  calls.length = 0;
  clip.key({ key: "right", modifiers: {} }, cx);
  clip.key({ key: "left", modifiers: { shift: true } }, cx);
  clip.key({ key: "0", key_char: "0", modifiers: {} }, cx);
  clip.key({ key: "m", key_char: "m", modifiers: {} }, cx);
  clip.key({ key: "k", key_char: "k", modifiers: {} }, cx);
  expect(calls.filter(([, a]) => a !== "state").map(([, a, args]) => [a, args])).toEqual([
    ["media.seek", { time: 5 }], ["media.seek", { time: 0 }], ["media.seek", { time: 0 }], ["media.setMuted", { muted: true }], ["media.play", {}],
  ]);
  let focused = 0;
  clip.handle = { focus() { focused++; }, is_focused: () => false };
  clip.nativeEvent({ id: "preview-media", event: "view.escapeKey", data: {} }, {});
  expect(focused).toBe(1);
  // Another view's escape isn't this preview's.
  clip.nativeEvent({ id: "web", event: "view.escapeKey", data: {} }, {});
  expect(focused).toBe(1);
});
