// Every mod that opens a menu places it with the same helper: its own copy of
// defaults/mods/databases/menu-place.ts (mods can't import each other's
// files), byte for byte. A mod that imports "./menu-place.ts" carries it.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const MODS = `${import.meta.dir}/../defaults/mods`;
const SOURCE = readFileSync(`${MODS}/databases/menu-place.ts`, "utf8");
const mods = readdirSync(MODS).filter((m) => existsSync(`${MODS}/${m}/mod.json`));

test("every menu-place.ts is the databases one, byte for byte", () => {
  const copies = mods.filter((m) => existsSync(`${MODS}/${m}/menu-place.ts`));

  for (const m of copies) expect([m, readFileSync(`${MODS}/${m}/menu-place.ts`, "utf8") === SOURCE]).toEqual([m, true]);
});

test("each mod that imports it carries it", () => {
  const users = mods.filter((m) => readdirSync(`${MODS}/${m}`).some((f) => /\.(js|ts)$/.test(f) && f !== "menu-place.ts"
    && readFileSync(`${MODS}/${m}/${f}`, "utf8").includes('from "./menu-place.ts"')));

  for (const m of users) expect([m, existsSync(`${MODS}/${m}/menu-place.ts`)]).toEqual([m, true]);
  expect(users).toContain("databases");
});
