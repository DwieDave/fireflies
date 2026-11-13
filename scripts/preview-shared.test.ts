import { test, expect } from "bun:test";
import { readFileSync } from "fs";

// The preview's viewer is shared: file-tree' preview split and the
// editor's drawn tabs (a picture, a PDF, a table as a tab) mount the same view
// the preview pane is (viewer.js). A mod can import only its own files, so
// file-tree and editor ship copies of it and of what it imports.
// Edit preview's and copy them over: these fail when a copy drifts.
const SHARED = ["viewer.js", "kinds.js", "image.js", "table.js", "diff.js", "keys.js", "keyhelp.ts"];
const read = (mod: string, file: string) => readFileSync(new URL(`../defaults/mods/${mod}/${file}`, import.meta.url), "utf8");

for (const host of ["file-tree", "editor"]) {
  for (const file of SHARED) {
    test(`${host}/${file} is preview's, unchanged`, () => {
      expect(read(host, file) === read("preview", file)).toBe(true);
    });
  }
}

test("the viewer imports only files that are shared", () => {
  const imports = [...read("preview", "viewer.js").matchAll(/from "\.\/([^"]+)"/g)].map((m) => m[1]);
  expect(imports.filter((f) => !SHARED.includes(f))).toEqual([]);
});
