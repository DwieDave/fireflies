// The TypeScript mods' shared files and their boundary parsing (docs/mods-typescript.md):
// guard.ts and keyhelp.d.ts are one file each, copied byte for byte into every mod that
// uses them (a mod can't import another mod's files); guard.ts proves what unknown
// data is, or refuses it.
import { test, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { arrayOf, isBoolean, isNumber, isString, literal, nullable, object, oneOf, parseJson, readShared, sharedKey, writeShared } from "../defaults/mods/nocturne-pip/guard.ts";

const MODS = `${import.meta.dir}/../defaults/mods`;
const mods = readdirSync(MODS).filter((m) => !m.startsWith("."));
const sources = (m: string) => readdirSync(`${MODS}/${m}`).filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith(".d.ts"));
const imports = (m: string, file: string) => sources(m).some((f) => readFileSync(`${MODS}/${m}/${f}`, "utf8").includes(`from "./${file}"`));

test("every copy of guard.ts is the same file, and every mod that imports it has one", () => {
  const source = readFileSync(`${MODS}/nocturne-pip/guard.ts`, "utf8");
  const copies = mods.filter((m) => existsSync(`${MODS}/${m}/guard.ts`));
  for (const m of copies) expect([m, readFileSync(`${MODS}/${m}/guard.ts`, "utf8") === source]).toEqual([m, true]);
  expect(mods.filter((m) => imports(m, "guard.ts")).sort()).toEqual(copies.sort());
  expect(copies.sort()).toEqual(["nocturne", "nocturne-pip", "nocturne-usage"]);
});

test("every TypeScript mod that imports keyhelp.js has the same keyhelp.d.ts beside it", () => {
  const source = readFileSync(`${MODS}/nocturne-pip/keyhelp.d.ts`, "utf8");
  const typed = mods.filter((m) => sources(m).some((f) => f.endsWith(".ts") && readFileSync(`${MODS}/${m}/${f}`, "utf8").includes('from "./keyhelp.js"')));
  expect(typed.sort()).toEqual(["nocturne-pip", "nocturne-usage"]);
  for (const m of typed) expect([m, readFileSync(`${MODS}/${m}/keyhelp.d.ts`, "utf8") === source]).toEqual([m, true]);
});

test("guards prove a value or refuse it", () => {
  expect([isString("a"), isString(1), isNumber(2), isNumber(Number.NaN), isNumber("2"), isBoolean(false), isBoolean(0)])
    .toEqual([true, false, true, false, false, true, false]);
  const mood = literal("calm", "busy");
  expect([mood("calm"), mood("other"), mood(null)]).toEqual([true, false, false]);
  expect([nullable(isString)(null), nullable(isString)(undefined)]).toEqual([true, false]);
  expect([arrayOf(isNumber)([1, 2]), arrayOf(isNumber)([1, "2"]), arrayOf(isNumber)({ length: 0 })]).toEqual([true, false, false]);
  expect([oneOf(isString, isNumber)(1), oneOf(isString, isNumber)(true)]).toEqual([true, false]);
});

test("object: required fields must be there, optional ones may be missing but not wrong, others are ignored", () => {
  const note = object({ of: isString, pane: isString }, { park: isBoolean });
  expect(note({ of: "1:web", pane: "p1" })).toBe(true);
  expect(note({ of: "1:web", pane: "p1", park: true, extra: [1] })).toBe(true);
  expect(note({ of: "1:web" })).toBe(false);
  expect(note({ of: "1:web", pane: "p1", park: "yes" })).toBe(false);
  // Present but undefined is not missing: an optional field that is there must be right.
  expect(note({ of: "1:web", pane: "p1", park: undefined })).toBe(false);
  expect([note(null), note([]), note("x")]).toEqual([false, false, false]);
  // A getter proves nothing: only data fields count.
  expect(note({ of: "1:web", get pane() { return "p1"; } })).toBe(false);
});

test("parseJson: JSON that the guard proves, else undefined", () => {
  const record = object({ tried: isNumber });
  expect(parseJson('{"tried":5}', record)).toEqual({ tried: 5 });
  expect(parseJson('{"tried":"5"}', record)).toBeUndefined();
  expect(parseJson("not json", record)).toBeUndefined();
});

test("shared keys: a value another mod wrote in another shape reads as the fallback", () => {
  const store = new Map<string, unknown>();
  const read = (k: string) => store.get(k) ?? null;
  const write = (k: string, v: unknown) => { store.set(k, v); return null; };
  const PANE = sharedKey("t.pane", nullable(object({ pane: isString })));
  expect(readShared(read, PANE, null)).toBe(null);
  writeShared(write, PANE, { pane: "p1" });
  expect(readShared(read, PANE, null)).toEqual({ pane: "p1" });
  store.set("t.pane", { pane: 7 });
  expect(readShared(read, PANE, null)).toBe(null);
});
