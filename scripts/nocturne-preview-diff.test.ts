import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";

// The preview's patches (.diff, .patch): nocturne-preview/diff.js and its view.
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

const colors = { ...herdr.theme(), ansi1: "#ff5189", ansi2: "#36c692", ansi3: "#e3c78a" };
const keyLogic = await load("nocturne-preview/keys.js");
const logic = { ...kinds, ...keyLogic, ...imageLogic, ...tableRest, parseTable, ...diffRest, parsePatch, herdr: { ...herdr }, theme: () => colors };
const { parse, fileStarts, nextFile } = D;

const GIT = `diff --git a/src/a.rs b/src/a.rs
index 1111111..2222222 100644
--- a/src/a.rs
+++ b/src/a.rs
@@ -1,3 +1,4 @@ fn main() {
 one
-two
+deux
+three
 four
diff --git a/old.txt b/new.txt
similarity index 90%
rename from old.txt
rename to new.txt
@@ -5 +5 @@
-x
+y
\\ No newline at end of file
diff --git a/logo.png b/logo.png
Binary files a/logo.png and b/logo.png differ
`;

test("git's diff: files, hunks, numbered lines, renames, binaries", () => {
  const p = parse(GIT);
  expect(p.files.map((f: any) => [f.path, f.old, f.add, f.del, f.binary])).toEqual([
    ["src/a.rs", null, 2, 1, false], ["new.txt", "old.txt", 1, 1, false], ["logo.png", null, 0, 0, true],
  ]);
  expect([p.add, p.del]).toEqual([3, 2]);
  const lines = p.rows.filter((r: any) => ["+", "-", " "].includes(r.kind)).slice(0, 5);
  expect(lines).toEqual([
    { kind: " ", o: 1, n: 1, text: "one" }, { kind: "-", o: 2, text: "two" }, { kind: "+", n: 2, text: "deux" },
    { kind: "+", n: 3, text: "three" }, { kind: " ", o: 3, n: 4, text: "four" },
  ]);
  expect(p.rows.find((r: any) => r.kind === "@")).toEqual({ kind: "@", range: "@@ -1,3 +1,4 @@", text: "fn main() {" });
  expect(p.rows.some((r: any) => r.kind === "\\" && r.text === "No newline at end of file")).toBe(true);
  expect(fileStarts(p.rows).length).toBe(3);
});

test("diff -u without git: files from their --- / +++ headers; a deletion of '-- ' stays a line", () => {
  const p = parse(`--- a/x.txt\t2024-01-01\n+++ b/x.txt\t2024-01-02\n@@ -1,2 +1,2 @@\n--- \n+b\n same\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hi\n`);
  expect(p.files.map((f: any) => [f.path, f.add, f.del, f.status ?? null])).toEqual([["x.txt", 1, 1, null], ["new.txt", 1, 0, "added"]]);
  expect(p.rows.find((r: any) => r.kind === "-")).toEqual({ kind: "-", o: 1, text: "-- " });
});

test("a format-patch mail: its headers and message as notes before the diff", () => {
  const p = parse(`From 123 Mon Sep 17 00:00:00 2001\nFrom: Ada <a@b.c>\nSubject: [PATCH] fix it\n\n---\n a.txt | 2 +-\n\ndiff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n-- \n2.44.0\n`);
  expect(p.rows.slice(0, 3).map((r: any) => [r.kind, r.text])).toEqual([["note", "From 123 Mon Sep 17 00:00:00 2001"], ["note", "From: Ada <a@b.c>"], ["note", "Subject: [PATCH] fix it"]]);
  expect(p.files.map((f: any) => [f.path, f.add, f.del])).toEqual([["a.txt", 1, 1]]);
  // The signature after the hunk is a note, not a deletion.
  expect(p.rows.at(-2)).toEqual({ kind: "note", text: "-- " });
});

test("git's mnemonic prefixes (c/ w/ i/) name the file without them", () => {
  const p = parse("diff --git c/src/a.rs w/src/a.rs\nindex 1..2 100644\n--- c/src/a.rs\n+++ w/src/a.rs\n@@ -1 +1 @@\n-a\n+b\n");
  expect(p.files.map((f: any) => [f.path, f.old])).toEqual([["src/a.rs", null]]);
  expect(parse("--- x/a.txt\n+++ y.txt\n@@ -1 +1 @@\n-a\n+b\n").files[0].path).toBe("y.txt");
});

test("next / previous file from a row", () => {
  expect([nextFile([0, 10, 20], 3, 1), nextFile([0, 10, 20], 10, 1), nextFile([0, 10, 20], 25, 1), nextFile([0, 10, 20], 12, -1), nextFile([0, 10, 20], 0, -1), nextFile([], 0, 1)]).toEqual([10, 20, 20, 10, 0, null]);
});

test("the view: colored rows as the diff pane draws them, file heads with counts; } jumps files", async () => {
  const { default: PreviewView } = await load("nocturne-preview/main.js", logic);
  const view: any = Object.create(PreviewView.prototype);
  const patch = parse(GIT);
  patch.starts = fileStarts(patch.rows);
  Object.assign(view, {
    path: "/w/fix.patch", kind: "diff", how: { how: "diff" }, on: null, slot: "s1", handle: { focus() {}, is_focused: () => true },
    port: { width: 800, height: 600 }, names: [], info: { bytes: 900 }, patch, sy: 0, sx: 0, cursor: 0, copied: 0, gen: 1, note: null,
  });
  const words = text(view.render());
  expect(words).toEqual(expect.arrayContaining(["PATCH", "fix.patch", "3 files · 900 B", "src/a.rs", "+2", "-1", "old.txt → new.txt", "binary", "@@ -1,3 +1,4 @@", "deux", "two"]));
  // Additions tinted green, deletions red (the theme's ansi2 / ansi1).
  const all = walk(view.render());
  const tint = (word: string) => {
    const cell = all.find((e) => e.nodes.includes(word));
    return call(all.filter((e) => walk(e).includes(cell) && call(e, "bg")).at(-1), "bg")[0];
  };
  expect([tint("deux"), tint("two")]).toEqual(["#36c69216", "#ff518916"]);
  const cx = { notify() {}, stop_propagation() {} };
  view.key({ key: "}", modifiers: { shift: true } }, cx);
  expect(view.cursor).toBe(patch.starts[1]);
  view.key({ key: "{", modifiers: { shift: true } }, cx);
  expect(view.cursor).toBe(0);
  expect(kinds.tag("diff", "/a.diff")).toBe("DIFF");
});
