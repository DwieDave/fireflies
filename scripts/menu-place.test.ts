// Every mod that opens a menu places it with the same helper, the
// @fireflies/menu-place library (defaults/lib): no mod carries a copy.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { copiesOf } from "./mod-source.ts";

const MODS = `${import.meta.dir}/../defaults/mods`;
const mods = readdirSync(MODS).filter((m) => existsSync(`${MODS}/${m}/mod.json`));

test("no mod carries a copy of menu-place.ts", () => {
  expect(copiesOf("menu-place.ts")).toEqual([]);
});

test("the mods that open menus import @fireflies/menu-place", () => {
  const users = mods.filter((m) => readdirSync(`${MODS}/${m}`).some((f) => /\.(js|ts)$/.test(f)
    && readFileSync(`${MODS}/${m}/${f}`, "utf8").includes('from "@fireflies/menu-place"')));

  expect(users).toEqual(expect.arrayContaining(["databases", "nocturne", "procs", "browser", "github", "scripts", "file-tree", "editor", "git"]));
  expect(mods.filter((m) => readdirSync(`${MODS}/${m}`).some((f) => /\.(js|ts)$/.test(f) && readFileSync(`${MODS}/${m}/${f}`, "utf8").includes('from "./menu-place.ts"')))).toEqual([]);
});
