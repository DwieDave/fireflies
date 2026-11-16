import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { copiesOf } from "./mod-source.ts";

// The preview's viewer is a library, @fireflies/viewer: the preview pane, the
// files pane's preview split and the editor's drawn tabs (a picture, a PDF, a
// table as a tab) import the same view by name, and the app serves one copy.
// No mod carries a file of it; the mods that keep a kinds.ts or keys.ts of
// their own (other contents, other jobs) are named here.
const LIB = new URL("../defaults/lib/@fireflies/viewer/", import.meta.url).pathname;
const FILES = readdirSync(LIB).filter((f) => f.endsWith(".ts"));
const OWN: Record<string, string[]> = { "kinds.ts": ["mods/databases", "mods/git"], "keys.ts": ["mods/databases", "mods/git", "mods/procs"] };

for (const file of FILES) {
  test(`no mod carries a copy of the viewer's ${file}`, () => {
    expect(copiesOf(file).sort()).toEqual(OWN[file] ?? []);
  });
}

test("the viewer's own files import nothing of a mod's: their neighbours, and libraries by name", () => {
  for (const file of FILES) {
    const imports = [...readFileSync(`${LIB}${file}`, "utf8").matchAll(/from "(\.[^"]+)"/g)].map((m) => m[1] ?? "");
    expect([file, imports.filter((f) => !FILES.includes(f.replace(/^\.\//, "")))]).toEqual([file, []]);
  }
});

test("the preview pane, the files pane and the editor import @fireflies/viewer", () => {
  const read = (path: string) => readFileSync(new URL(`../defaults/mods/${path}`, import.meta.url), "utf8");
  expect(read("preview/main.ts")).toContain('import Viewer from "@fireflies/viewer";');
  expect(read("file-tree/look.ts")).toContain('import Viewer from "@fireflies/viewer";');
  expect(read("editor/drawn-tabs.ts")).toContain('import Viewer from "@fireflies/viewer";');
});
