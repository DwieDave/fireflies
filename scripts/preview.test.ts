import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";

// The mods import the app's modules; stand-ins record what they're asked (as markdown.test.ts).
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

const kinds = await load("preview/kinds.js");
const imageLogic = await load("preview/image.js", kinds);
const tableLogic = await load("preview/table.js");
const diffLogic = await load("preview/diff.js");
const { parse: parseTable, ...tableRest } = tableLogic;
const { parse: parsePatch, ...diffRest } = diffLogic;
/** Everything main.js imports, as its imports name it. */
const keyLogic = await load("preview/keys.js");
const logic = { ...kinds, ...keyLogic, ...imageLogic, ...tableRest, parseTable, ...diffRest, parsePatch, herdr: { ...herdr } };
const { sizeFromFile, isImage, formatOf, hexBytes, sniff, svgSize, plan, cantShow, fitScale, fitted, clampPan, zoomTo, step, panBy, rotate, placed, percent, wrapper, sharpness, turned, PAD } = imageLogic;
const { extension, siblings, stepIn, fileSize } = kinds;

// ---- type dispatch

test("pictures are told apart by extension, any case", () => {
  expect(["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.bmp", "g.tif", "h.TIFF", "i.ico", "j.svg", "k.avif", "l.HEIC", "m.heif"].every(isImage)).toBe(true);
  expect(["a.md", "png", ".png", "a.png.txt", "a.pdf", "", null].some(isImage)).toBe(false);
  expect([formatOf("x.JPG"), formatOf("x.tif"), formatOf("x.heif"), formatOf("x.rs")]).toEqual(["jpeg", "tiff", "heic", null]);
  expect(extension("/a.b/c")).toBe("");
});

test("file-tree: Markdown and pictures as tabs of the editor (a double click), p their viewer panes, alt-double-click / e the other way", async () => {
  const route = await load("file-tree/editor-route.js");
  const { default: Files, viewerFor, isMarkdown } = await load("file-tree/main.js", { ...(await load("file-tree/logic.js")), openInEditor: route.openInEditor, herdr: { run: (n: string, a: any) => commands.push([n, a]), panes: () => world.panes, spaces: () => world.spaces, focused: () => null, shared: () => null, setShared() {} } });
  expect([viewerFor("a.md")?.open, viewerFor("Shot 1.PNG")?.open, viewerFor("logo.svg")?.open, viewerFor("main.rs")]).toEqual(["markdown.open", "preview.open", "preview.open", null]);
  expect([viewerFor("r.pdf")?.other, viewerFor("d.csv")?.other, viewerFor("x.patch")?.other, viewerFor("app.sqlite")?.other]).toEqual(["system", "edit", "edit", "system"]);
  expect([viewerFor("a.json"), viewerFor("a.yaml"), viewerFor("Cargo.toml")]).toEqual([null, null, null]);
  expect([isMarkdown("a.md"), isMarkdown("a.png")]).toEqual([true, false]);
  world.spaces = [{ active: true, tabs: [{ id: "tab1", active: true }] }];
  world.panes = [{ pane: "p1", tab: "tab1", terminal: "t1" }, { pane: "pf", tab: "tab1", mod: "file-tree" }];
  const view: any = Object.create(Files.prototype);
  Object.assign(view, { root: "/repo", on: null, handle: { focus() {} }, folders: new Set(), lastClick: null });
  view.rows = () => [{ path: "shots/Screen Shot.png", dir: false, depth: 1 }, { path: "main.rs", dir: false, depth: 0 }];
  const edits: string[] = [];
  view.edit = (path: string) => edits.push(path);
  const cx = { notify() {}, stop_propagation() {} };
  commands.length = 0;
  view.pick("shots/Screen Shot.png", cx);
  view.pick("shots/Screen Shot.png", cx);
  view.alt = true;
  view.pick("shots/Screen Shot.png", cx);
  view.pick("shots/Screen Shot.png", cx);
  view.alt = false;
  view.sel = "shots/Screen Shot.png";
  view.key({ key: "e" }, cx);
  view.key({ key: "enter" }, cx);
  view.key({ key: "p" }, cx);
  // A double click and enter: a tab of the editor to look at (none in the tab: a new one beside); p: the preview pane.
  expect(commands).toEqual([
    ["editor.open", { path: "/repo/shots/Screen Shot.png", pane: "p1", look: true }],
    ["preview.open", { path: "/repo/shots/Screen Shot.png", in: "system" }],
    ["preview.open", { path: "/repo/shots/Screen Shot.png", in: "system" }],
    ["editor.open", { path: "/repo/shots/Screen Shot.png", pane: "p1", look: true }],
    ["preview.open", { path: "/repo/shots/Screen Shot.png", pane: "p1" }],
  ]);
  expect(edits).toEqual([]);
  view.pick("main.rs", cx);
  view.pick("main.rs", cx);
  expect(edits).toEqual(["main.rs"]);
});

test("the files mod opens pictures and PDFs in the preview; alt-click: the system's app", async () => {
  const { default: Files } = await load("files/main.js");
  const view: any = Object.create(Files.prototype);
  Object.assign(view, { root: "/repo", on: "box" });
  const shown: string[] = [];
  view.show = (path: string) => shown.push(path);
  commands.length = 0;
  view.pick("a.gif", {}, false);
  view.pick("a.gif", {}, true);
  view.pick("README.md", {}, false);
  view.pick("a.txt", {}, false);
  view.pick("r.pdf", {}, false);
  view.pick("c.json", {}, false);
  expect(commands).toEqual([
    ["preview.open", { path: "/repo/a.gif", on: "box" }],
    ["preview.open", { path: "/repo/a.gif", in: "system", on: "box" }],
    ["markdown.open", { path: "/repo/README.md", on: "box" }],
    ["preview.open", { path: "/repo/r.pdf", on: "box" }],
  ]);
  expect(shown).toEqual(["a.txt", "c.json"]);
});

test("the pane header names a viewer by the file it shows", async () => {
  const src = await readFile(new URL("../defaults/mods/nocturne/header.js", import.meta.url), "utf8");
  expect(src).toContain('"preview": ["Preview", "eye"]');
  expect(src).toContain('new Set(["markdown", "preview", "editor", "file-tree"])');
  await readFile(new URL("../defaults/mods/workspace-chrome/eye.svg", import.meta.url), "utf8");
});

// ---- what the first bytes say

const bytes = (...parts: (number[] | string)[]) => parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le32 = (n: number) => [...le16(n & 0xffff), ...le16(n >>> 16)];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];

test("od output reads back as bytes", () => {
  expect(hexBytes(" 89 50 4e 47\n 0d 0a\n")).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  expect(hexBytes("")).toEqual([]);
});

test("PNG, APNG, GIF (still and animated), BMP, TIFF, ICO", () => {
  const png = bytes([0x89], "PNG\r\n\x1a\n", be32(13), "IHDR", be32(1920), be32(1080), [8, 6, 0, 0, 0], [0, 0, 0, 0], be32(0), "IDAT");
  expect(sniff(png)).toEqual({ format: "png", width: 1920, height: 1080 });
  const apng = bytes([0x89], "PNG\r\n\x1a\n", be32(13), "IHDR", be32(4), be32(3), [8, 6, 0, 0, 0], [0, 0, 0, 0], be32(8), "acTL", be32(2), be32(0), [0, 0, 0, 0], be32(0), "IDAT");
  expect(sniff(apng)).toEqual({ format: "png", width: 4, height: 3, animated: true });
  // A GIF: header, no global table, one or two frames of one-byte image data.
  const frame = [0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0, 2, 2, 0x4c, 0x01, 0];
  const gif = (n: number) => bytes("GIF89a", le16(2), le16(2), [0, 0, 0], ...Array(n).fill(frame), [0x3b]);
  expect(sniff(gif(1))).toEqual({ format: "gif", width: 2, height: 2 });
  expect(sniff(gif(3))).toEqual({ format: "gif", width: 2, height: 2, animated: true, frames: 3 });
  expect(sniff(bytes("BM", le32(0), le32(0), le32(54), le32(40), le32(640), le32(-480 >>> 0)))).toEqual({ format: "bmp", width: 640, height: 480 });
  const tiff = bytes("II", [42, 0], le32(8), le16(2), le16(256), le16(3), le32(1), le16(300), [0, 0], le16(257), le16(4), le32(1), le32(200));
  expect(sniff(tiff)).toEqual({ format: "tiff", width: 300, height: 200 });
  const ico = bytes([0, 0, 1, 0], le16(2), [16, 16, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  expect(sniff(ico)).toEqual({ format: "ico", width: 256, height: 256 });
});

test("JPEG: the frame's size, turned by its EXIF orientation", () => {
  const exif = (o: number) => bytes([0xff, 0xe1], be16(2 + 6 + 8 + 2 + 12 + 4), "Exif", [0, 0], "MM", [0, 42], be32(8), be16(1), be16(0x0112), be16(3), be32(1), be16(o), [0, 0], be32(0));
  const sof = bytes([0xff, 0xc0], be16(17), [8], be16(3000), be16(4000), [3]);
  expect(sniff(bytes([0xff, 0xd8], sof))).toEqual({ format: "jpeg", width: 4000, height: 3000 });
  expect(sniff(bytes([0xff, 0xd8], exif(6), sof))).toEqual({ format: "jpeg", width: 3000, height: 4000, orientation: 6 });
  expect(sniff(bytes([0xff, 0xd8], exif(3), sof))).toEqual({ format: "jpeg", width: 4000, height: 3000, orientation: 3 });
  expect(sniff(bytes([0xff, 0xd8], [0xff, 0xe0], be16(4), [0, 0]))).toEqual({ format: "jpeg", width: 0, height: 0 });
});

test("WebP (lossy, lossless, extended and animated), HEIC, AVIF, SVG", () => {
  const riff = (chunk: string, data: number[]) => bytes("RIFF", le32(0), "WEBP", chunk, le32(data.length), data);
  expect(sniff(riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(800), ...le16(600)]))).toEqual({ format: "webp", width: 800, height: 600 });
  const bits = (799) | (599 << 14);
  expect(sniff(riff("VP8L", [0x2f, ...le32(bits)]))).toEqual({ format: "webp", width: 800, height: 600 });
  expect(sniff(riff("VP8X", [0x12, 0, 0, 0, 799 & 255, 799 >> 8, 0, 599 & 255, 599 >> 8, 0]))).toEqual({ format: "webp", width: 800, height: 600, animated: true });
  const ftyp = (brand: string) => bytes(be32(24), "ftyp", brand, be32(0), "mif1", brand, be32(20), "ispe", be32(0), be32(4032), be32(3024));
  expect(sniff(ftyp("heic"))).toEqual({ format: "heic", width: 4032, height: 3024 });
  expect(sniff(ftyp("avif"))).toEqual({ format: "avif", width: 4032, height: 3024 });
  expect(sniff(bytes(be32(24), "ftyp", "isom", be32(0), "isom", "mp41"))).toBeNull();
  expect(sniff(bytes('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12">'))).toEqual({ format: "svg", width: 24, height: 12 });
  expect(sniff(bytes("hello, world"))).toBeNull();
  expect(svgSize('<svg width="2in" height="50%" viewBox="0 0 10 5">')).toEqual({ width: 192, height: 96 });
  expect(svgSize('<svg width="100" height="40px">')).toEqual({ width: 100, height: 40 });
  expect(svgSize("<svg>")).toEqual({ width: 300, height: 150 });
});

test("a size `file` reports, for files whose first bytes don't say", () => {
  expect(sizeFromFile("TIFF image data, little-endian, direntries=15, height=200, bps=8, compression=none, width=300")).toEqual({ width: 300, height: 200 });
  expect(sizeFromFile("PNG image data, 480 x 320, 16-bit/color RGBA, non-interlaced")).toEqual({ width: 480, height: 320 });
  expect(sizeFromFile("data")).toBeNull();
});

// ---- drawn as is, converted, or not at all

test("the app draws most formats; HEIC and AVIF are converted where a tool can", () => {
  for (const f of ["png", "jpeg", "gif", "webp", "bmp", "tiff", "ico", "svg"]) expect(plan(f, "linux")).toEqual({ kind: "native" });
  const mac = plan("heic", "macos");
  expect(mac.kind).toBe("convert");
  expect(mac.tools.map((t: any) => t.tool)).toEqual(["sips", "qlmanage"]);
  expect(mac.tools[0].argv).toEqual(["sips", "-s", "format", "png", "$IN", "--out", "$OUT"]);
  expect(plan("heic", "linux").tools.map((t: any) => t.tool)).toEqual(["heif-convert", "magick", "convert", "ffmpeg"]);
  expect(plan("avif", "linux").tools.map((t: any) => t.tool)).toEqual(["heif-convert", "avifdec", "magick", "convert", "ffmpeg"]);
  expect(plan("heic", "windows")).toEqual({ kind: "none" });
  expect(plan("psd", "macos")).toEqual({ kind: "none" });
  expect(cantShow("heic", "linux")).toContain("heif-convert");
  expect(cantShow("avif", "windows")).toBe("Nothing on this computer converts AVIF");
});

// ---- next / previous in the folder

test("the folder's pictures in reading order, hidden ones only from a hidden one", () => {
  const names = ["shot-10.png", "Shot-2.png", "notes.md", "shot-1.PNG", ".hidden.png", "b.svg", "A.gif", "", "shot-2.png"];
  expect(siblings(names, "b.svg")).toEqual(["A.gif", "b.svg", "shot-1.PNG", "Shot-2.png", "shot-2.png", "shot-10.png"]);
  expect(siblings(names, ".hidden.png")[0]).toBe(".hidden.png");
  const list = ["a.png", "b.png", "c.png"];
  expect([stepIn(list, "a.png", 1), stepIn(list, "c.png", 1), stepIn(list, "a.png", -1)]).toEqual(["b.png", "a.png", "c.png"]);
  // Gone (deleted, renamed): next is the one after where it was, previous the one before.
  expect([stepIn(list, "bb.png", 1), stepIn(list, "bb.png", -1), stepIn(list, "z.png", 1)]).toEqual(["c.png", "b.png", "a.png"]);
  expect(stepIn([], "a.png", 1)).toBeNull();
});

// ---- zoom and pan

const port = { width: 800, height: 600 };
test("fit shows the whole picture; pixels never above 100%, vectors any size", () => {
  const big = { width: 3200, height: 1200 };
  expect(fitScale(big, port)).toBeCloseTo((800 - 2 * PAD) / 3200);
  expect(fitScale({ width: 16, height: 16 }, port)).toBe(1);
  expect(fitScale({ width: 100, height: 50 }, port, 0, true)).toBeCloseTo((800 - 2 * PAD) / 100);
  expect(fitScale({ width: 1, height: 1 }, port, 0, true)).toBe(32);
  // On its side, the long edge fits the height.
  expect(fitScale(big, port, 1)).toBeCloseTo((600 - 2 * PAD) / 3200);
  expect(turned(big, 1)).toEqual({ width: 1200, height: 3200 });
  expect(fitted(big, port)).toEqual({ fit: true, scale: fitScale(big, port), x: 0, y: 0, rot: 0 });
});

test("zoom steps, zoom keeps the point under the pointer, pan stays in bounds", () => {
  expect([step(1, 1), step(1, -1), step(0.3, 1), step(32, 1), step(0.02, -1)]).toEqual([1.25, 0.75, 1 / 3, 32, 0.02]);
  const img = { width: 1600, height: 1200 };
  const v0 = fitted(img, port);
  const at = { x: 600, y: 150 };
  const before = placed(v0, img, port);
  const imgPoint = { x: (at.x - before.left) / v0.scale, y: (at.y - before.top) / v0.scale };
  const v1 = zoomTo(v0, 1, img, port, at);
  expect(v1.fit).toBe(false);
  const after = placed(v1, img, port);
  expect(after.left + imgPoint.x * v1.scale).toBeCloseTo(at.x);
  expect(after.top + imgPoint.y * v1.scale).toBeCloseTo(at.y);
  // Panned past the edge: held so the picture still covers the viewport.
  const far = panBy(v1, 10000, -10000, img, port);
  expect([far.x, far.y]).toEqual([(1600 - 800) / 2, -(1200 - 600) / 2]);
  expect(placed(far, img, port).left).toBe(0);
  // Smaller than the viewport: centred whatever the pan.
  expect(clampPan({ fit: false, scale: 0.25, x: 300, y: -40, rot: 0 }, img, port)).toEqual({ fit: false, scale: 0.25, x: 0, y: 0, rot: 0 });
});

test("turning: fitted again when it was, pan reset when zoomed; percentages and sizes", () => {
  const img = { width: 1600, height: 900 };
  const v = rotate(fitted(img, port), 1, img, port);
  expect([v.rot, v.fit, v.scale]).toEqual([1, true, fitScale(img, port, 1)]);
  expect(rotate(v, -2, img, port).rot).toBe(3);
  const zoomed = rotate({ fit: false, scale: 2, x: 100, y: 100, rot: 0 }, 1, img, port);
  expect([zoomed.rot, zoomed.scale, zoomed.x, zoomed.y]).toEqual([1, 2, 0, 0]);
  expect([percent(0.3333), percent(1), percent(16)]).toEqual(["33%", "100%", "1600%"]);
  expect([fileSize(812), fileSize(4300), fileSize(13 * 1024 * 1024), fileSize(undefined)]).toEqual(["812 B", "4.2 KB", "13 MB", ""]);
});

test("the wrapper SVG turns a picture (and its EXIF orientation) and draws vectors sharp", () => {
  const svg = wrapper("/cache/a b&c.png", { width: 400, height: 300 }, 1, 1);
  expect(svg).toContain('width="300" height="400" viewBox="0 0 300 400"');
  expect(svg).toContain("translate(150 200) rotate(90) translate(-200 -150)");
  expect(svg).toContain('href="/cache/a b&amp;c.png"');
  // Orientation 6 is a quarter turn already: one more makes a half.
  expect(wrapper("/x.jpg", { width: 400, height: 300 }, 1, 1, 6)).toContain("rotate(180)");
  expect(wrapper("/x.jpg", { width: 400, height: 300 }, 0, 1, 2)).toContain("scale(-1 1)");
  expect(wrapper("/x.svg", { width: 24, height: 24 }, 0, 4)).toContain('width="96" height="96" viewBox="0 0 24 24"');
  expect([sharpness({ width: 24, height: 24 }, 1, 2), sharpness({ width: 24, height: 24 }, 10, 2), sharpness({ width: 4000, height: 3000 }, 4, 2)]).toEqual([2, 32, 2]);
});

// ---- the view

test("the viewer: a fitted picture, keys zoom, pan, step through the folder and toggle the background", async () => {
  const { default: PreviewView } = await load("preview/viewer.js", logic);
  const view: any = Object.create(PreviewView.prototype);
  const focus = { focus() {}, is_focused: () => true };
  Object.assign(view, {
    path: "/shots/b.png", kind: "image", how: { how: "image" }, on: null, slot: "s1", handle: focus, port: { width: 800, height: 600 }, checker: true, copied: 0,
    names: ["a.png", "b.png", "c.png"], info: { format: "png", width: 1600, height: 1200, bytes: 2048 },
    copy: { name: "1-2048.png", abs: "/c/1-2048.png", format: "png" }, src: "cache/preview/1-2048.png", view: null, gen: 1,
  });
  const opened: string[] = [];
  view.open = (p: string) => opened.push(p);
  view.draw = () => {};
  const cx = { notify() {}, stop_propagation() {} };
  const tree: any = view.render();
  const pic = walk(tree).find((e) => e.kind === "image");
  expect(pic.arg).toBe("cache/preview/1-2048.png");
  const scale = Math.min((800 - 2 * PAD) / 1600, (600 - 2 * PAD) / 1200);
  expect(call(pic, "w")).toEqual([1600 * scale]);
  expect(call(pic, "left")).toEqual([(800 - 1600 * scale) / 2]);
  // The bar: name, facts, place in the folder, zoom.
  const text = walk(tree).flatMap((e) => e.nodes.filter((n: any) => typeof n === "string"));
  expect(text).toEqual(expect.arrayContaining(["IMG", "b.png", "1600 × 1200 · PNG · 2.0 KB", "2/3", `${Math.round(scale * 100)}%`, "fit", "100%", "turn", "checker", "files", "open", "copy"]));

  view.key({ key: "1", modifiers: {} }, cx);
  expect([view.view.scale, view.view.fit]).toEqual([1, false]);
  view.key({ key: "l", modifiers: {} }, cx);
  expect(view.view.x).toBe(-60);
  view.key({ key: "k", modifiers: { shift: true } }, cx);
  expect(view.view.y).toBe(240);
  view.key({ key: "+", modifiers: {} }, cx);
  expect(view.view.scale).toBe(1.25);
  view.key({ key: "0", modifiers: {} }, cx);
  expect([view.view.fit, view.view.scale]).toEqual([true, scale]);
  // Fitted, nothing to pan: ← → step through the folder, as n / p do.
  view.key({ key: "right", modifiers: {} }, cx);
  view.key({ key: "p", modifiers: {} }, cx);
  view.key({ key: "]", modifiers: {} }, cx);
  expect(opened).toEqual(["/shots/c.png", "/shots/a.png", "/shots/c.png"]);
  view.key({ key: "b", modifiers: {} }, cx);
  expect(view.checker).toBe(false);
  view.key({ key: "r", modifiers: {} }, cx);
  expect(view.view.rot).toBe(1);
  view.key({ key: "o", modifiers: {} }, cx);
  expect(commands.at(-1)).toEqual(["preview.open", { path: "/shots/b.png", in: "system" }]);
  // ⌘ + scroll zooms at the pointer; plain scroll pans only when there's somewhere to go.
  view.view = { fit: true, scale, x: 0, y: 0, rot: 0 };
  view.wheel({ modifiers: {}, delta: { x: 0, y: -50 } }, cx);
  expect(view.view.y).toBe(0);
  view.wheel({ modifiers: { platform: true }, delta: { x: 0, y: 240 }, local_position: { x: 400, y: 300 } }, cx);
  expect(view.view.scale).toBeCloseTo(scale * Math.E);
  // The header learns the file's name and the app its path.
  view.title();
  world.panes = [{ pane: "p9", mod: "preview", props: { slot: "s1" } }];
  view.title();
  expect(world.shared["preview.titles"]).toEqual({ s1: "b.png" });
  expect(world.shared["preview.paths"]).toEqual({ s1: "/shots/b.png" });
});

test("the bar's fit and 100% do what they say, in either state, and stay put", async () => {
  const { default: PreviewView } = await load("preview/viewer.js", logic);
  const view: any = Object.create(PreviewView.prototype);
  Object.assign(view, {
    path: "/shots/s.png", kind: "image", how: { how: "image" }, on: null, slot: "s1", handle: { focus() {}, is_focused: () => false }, port: { width: 800, height: 600 }, checker: true, copied: 0,
    names: [], info: { format: "png", width: 3752, height: 2078, bytes: 2048 },
    copy: { name: "1-2048.png", abs: "/c/1-2048.png", format: "png" }, src: "cache/preview/1-2048.png", view: null, gen: 1,
  });
  view.draw = () => {};
  const cx = { notify() {}, stop_propagation() {} };
  const label = (el: any) => walk(el).flatMap((e) => e.nodes.filter((n: any) => typeof n === "string")).join("");
  const chips = () => {
    const els = walk(view.render()).filter((e) => call(e, "on_click"));
    return Object.fromEntries(els.map((e) => [label(e), e]));
  };
  const click = (name: string) => {
    const chip = chips()[name];
    expect(chip).toBeDefined();
    call(chip, "on_click")[0]({}, cx);
  };
  const fit = fitScale(view.img(), view.port);
  // Fitted: "100%" goes to 100%, "fit" keeps it fitted (not the other way round).
  view.render();
  click("fit");
  expect([view.view.fit, view.view.scale]).toEqual([true, fit]);
  click("100%");
  expect([view.view.fit, view.view.scale]).toEqual([false, 1]);
  // At 100% the same two chips, same labels (nothing moves under the pointer).
  expect(Object.keys(chips())).toEqual(expect.arrayContaining(["fit", "100%"]));
  click("100%");
  expect([view.view.fit, view.view.scale]).toEqual([false, 1]);
  click("fit");
  expect([view.view.fit, view.view.scale]).toEqual([true, fit]);
  // The scale itself is shown next to them.
  const text = walk(view.render()).flatMap((e) => e.nodes.filter((n: any) => typeof n === "string"));
  expect(text).toContain(percent(fit));
});

test("the viewer says what's wrong instead of a picture", async () => {
  const { default: PreviewView } = await load("preview/viewer.js", logic);
  const view: any = Object.create(PreviewView.prototype);
  Object.assign(view, { path: "/x/a.heic", kind: "image", how: { how: "image" }, handle: { is_focused: () => false }, port: { width: 800, height: 600 }, names: [], info: { format: "heic", width: 0, height: 0 }, error: cantShow("heic", "linux") });
  const text = walk(view.render()).flatMap((e) => e.nodes.filter((n: any) => typeof n === "string"));
  expect(text).toEqual(expect.arrayContaining(["Can't preview this picture", cantShow("heic", "linux"), "open in its app  o"]));
  expect(walk(view.render()).some((e) => e.kind === "image")).toBe(false);
});

test("the bar by keys: tab rings its controls in order, enter presses one, ? lists the keys, esc backs out", async () => {
  const { default: PreviewView } = await load("preview/viewer.js", logic);
  const view: any = Object.create(PreviewView.prototype);
  Object.assign(view, {
    path: "/shots/b.png", kind: "image", how: { how: "image" }, on: null, slot: "s1", handle: { focus() {}, is_focused: () => true }, port: { width: 800, height: 600 }, checker: true, copied: 0,
    names: ["a.png", "b.png"], info: { format: "png", width: 1600, height: 1200, bytes: 2048 },
    copy: { name: "1-2048.png", abs: "/c/1-2048.png", format: "png" }, src: "cache/preview/1-2048.png", view: null, gen: 1,
  });
  view.draw = () => {};
  const opened: string[] = [];
  view.open = (p: string) => opened.push(p);
  const cx = { notify() {}, stop_propagation() {}, write_to_clipboard() {}, timer: { after() {} } };
  view.render();
  expect(view.chips.map((c: any) => c.id)).toEqual(["img-prev", "img-next", "img-fit", "img-actual", "img-turn", "img-bg", "img-files", "img-open", "img-copy", "img-keys"]);
  view.key({ key: "tab", modifiers: {} }, cx);
  expect(view.ring).toBe("img-prev");
  view.key({ key: "tab", modifiers: { shift: true } }, cx);
  view.key({ key: "tab", modifiers: { shift: true } }, cx);
  expect(view.ring).toBe("img-copy");
  view.key({ key: "tab", modifiers: {} }, cx);
  view.key({ key: "tab", modifiers: {} }, cx);
  expect(view.ring).toBe("img-prev");
  view.key({ key: "enter", modifiers: {} }, cx);
  expect(opened).toEqual(["/shots/a.png"]);
  // The ring is drawn on the chip while the preview has the keyboard.
  const ringed = walk(view.render()).find((e) => e.calls.some(([k, a]: any) => k === "id" && a[0] === "img-prev"));
  expect(walk(ringed).some((e) => e.calls.some(([k, a]: any) => k === "border_color"))).toBe(true);
  view.key({ key: "/", key_char: "?", modifiers: { shift: true } }, cx);
  expect(view.keysShown).toBe(true);
  const strip = walk(view.render()).flatMap((e) => e.nodes.filter((n: any) => typeof n === "string"));
  expect(strip).toEqual(expect.arrayContaining(["+ -", "zoom", "h j k l  ← ↑ ↓ →", "pan (fitted: h l step)", "r R", "turn", "n p  ] [", "tab ⇧tab", "keys"]));
  // esc closes the keys first (keyhelp.js), then takes the ring away.
  view.key({ key: "escape", modifiers: {} }, cx);
  expect([view.ring, view.keysShown]).toEqual(["img-prev", false]);
  view.key({ key: "escape", modifiers: {} }, cx);
  expect(view.ring).toBe(null);
  // Shifted punctuation by the typed character: "}" is a patch's next file, "+" zooms.
  view.key({ key: "=", key_char: "+", modifiers: { shift: true } }, cx);
  expect(view.view.fit).toBe(false);
});
