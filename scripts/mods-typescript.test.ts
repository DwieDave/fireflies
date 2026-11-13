// The TypeScript mods' shared files and their boundary parsing (docs/mods-typescript.md):
// guard.ts is one file, copied byte for byte into every mod that
// uses them (a mod can't import another mod's files); guard.ts proves what unknown
// data is, or refuses it.
import { test, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { NOCTURNE_MODS } from "./nocturne-mods.ts";
import { arrayOf, isBoolean, isNumber, isString, literal, nullable, object, oneOf, parseJson, parseJsonMap, readShared, readSharedMap, sharedKey, sharedMapKey, writeShared, writeSharedMap } from "../defaults/mods/pip/guard.ts";

const MODS = `${import.meta.dir}/../defaults/mods`;
const mods = readdirSync(MODS).filter((m) => !m.startsWith("."));
const sources = (m: string) => readdirSync(`${MODS}/${m}`).filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith(".d.ts"));
const imports = (m: string, file: string) => sources(m).some((f) => readFileSync(`${MODS}/${m}/${f}`, "utf8").includes(`from "./${file}"`));

test("every copy of guard.ts is the same file: nocturne and each of its mods has one, ready for its migration", () => {
  const source = readFileSync(`${MODS}/pip/guard.ts`, "utf8");
  const copies = mods.filter((m) => existsSync(`${MODS}/${m}/guard.ts`));
  for (const m of copies) expect([m, readFileSync(`${MODS}/${m}/guard.ts`, "utf8") === source]).toEqual([m, true]);
  expect(copies.sort()).toEqual(["nocturne", ...NOCTURNE_MODS].sort());
  // A mod that imports it has its copy (no stock mod does).
  for (const m of mods.filter((x) => imports(x, "guard.ts"))) expect(copies).toContain(m);
});

test("no mod keeps a hand-written .d.ts for a shared file: the shared files are TypeScript", () => {
  expect(mods.flatMap((m) => readdirSync(`${MODS}/${m}`).filter((f) => f.endsWith(".d.ts") && f !== "gpui-kit.d.ts").map((f) => `${m}/${f}`))).toEqual([]);
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

test("dictionaries (keys are data): read as a Map of the entries the guard proves, the others left out", () => {
  const store = new Map<string, unknown>();
  const read = (k: string) => store.get(k) ?? null;
  const write = (k: string, v: unknown) => { store.set(k, v); return null; };
  const PATHS = sharedMapKey("t.paths", arrayOf(isString));
  expect(readSharedMap(read, PATHS).size).toBe(0);
  store.set("t.paths", { s1: ["/a"], s2: "not a list", s3: ["/b", 7] });
  expect([...readSharedMap(read, PATHS)]).toEqual([["s1", ["/a"]]]);
  store.set("t.paths", ["/a"]);
  expect(readSharedMap(read, PATHS).size).toBe(0);
  writeSharedMap(write, PATHS, new Map([["s9", ["/c"]]]));
  expect(store.get("t.paths")).toEqual({ s9: ["/c"] });
  expect(parseJsonMap('{"a.md":{"name":"a"},"b":1}', object({ name: isString }))).toEqual(new Map([["a.md", { name: "a" }]]));
  expect([parseJsonMap("[1]", isNumber), parseJsonMap("nope", isNumber)]).toEqual([undefined, undefined]);
});
