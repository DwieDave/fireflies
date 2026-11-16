// defaults/lib/effect (the Effect the app serves to every mod) is a fresh
// build of node_modules/effect, the version package.json pins and the mods'
// type check and tests use: what the mods are checked against is what runs.
import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "./effect-bundle.ts";

const out = join(import.meta.dir, "../defaults/lib/effect");

test("defaults/lib/effect is node_modules/effect, freshly built (else: bun scripts/effect-bundle.ts)", async () => {
  const files = await build();
  expect([...files.keys()].sort()).toEqual(expect.arrayContaining(["index.js", "http/index.js"]));
  for (const [file, text] of files) {
    expect([file, existsSync(join(out, file)) && readFileSync(join(out, file), "utf8") === text]).toEqual([file, true]);
  }
  const pinned = JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8")).devDependencies.effect;
  expect(readFileSync(join(out, "index.js"), "utf8").startsWith(`// effect@${pinned} `)).toBe(true);
}, 60_000);
