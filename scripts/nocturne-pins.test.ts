import { test, expect } from "bun:test";
import { PIN_LABEL, AT_LABEL, GRACE, isPinned, pinnedAt, sortAgents, stamps, moveInJar } from "../defaults/mods/nocturne/pins.js";

const RANK: Record<string, number> = { blocked: 0, working: 1, done: 2, idle: 3 };
const rank = (a: any) => (a.status === "working" ? (a.command ? 1.5 : 1) : RANK[a.status] ?? 3);
const of = (labels: Record<string, Record<string, string>>) => (address: string) => labels[address] ?? {};

test("pin state comes from the terminal's labels", () => {
  expect(isPinned({ [PIN_LABEL]: "1" })).toBe(true);
  expect(isPinned({ [PIN_LABEL]: "" })).toBe(false);
  expect(isPinned({})).toBe(false);
  expect(isPinned(undefined)).toBe(false);
  expect(pinnedAt({ [AT_LABEL]: "1700" })).toBe(1700);
  expect(pinnedAt({ [AT_LABEL]: "" })).toBe(null);
  expect(pinnedAt({ [AT_LABEL]: "soon" })).toBe(null);
});

test("pinned agents come first in the order pinned, the status sort below", () => {
  const list = [
    { address: "t1", status: "idle" },
    { address: "t2", status: "blocked" },
    { address: "t3", status: "idle" },
    { address: "t4", status: "working", command: true },
    { address: "t5", status: "working" },
    { address: "t6", status: "done" },
    { address: "t7", status: "blocked" },
  ];
  const labels = of({
    t3: { [PIN_LABEL]: "1", [AT_LABEL]: "200" },
    t1: { [PIN_LABEL]: "1", [AT_LABEL]: "100" },
    t7: { [PIN_LABEL]: "1" }, // pinned elsewhere, not stamped yet: last in the jar
    t6: { [AT_LABEL]: "50" }, // an unpin's leftover time: not pinned
  });
  const { pinned, rest, all } = sortAgents(list, rank, labels);
  expect(pinned.map((a: any) => a.address)).toEqual(["t1", "t3", "t7"]);
  expect(rest.map((a: any) => a.address)).toEqual(["t2", "t5", "t4", "t6"]);
  expect(all.map((a: any) => a.address)).toEqual(["t1", "t3", "t7", "t2", "t5", "t4", "t6"]);
});

test("no pins: the status sort alone, stable within a status", () => {
  const list = [{ address: "a", status: "done" }, { address: "b", status: "blocked" }, { address: "c", status: "done" }];
  expect(sortAgents(list, rank, of({})).all.map((a: any) => a.address)).toEqual(["b", "a", "c"]);
});

test("stamps: pins without a time get one in turn, an unpin's time goes, exited terminals are left alone", () => {
  const now = 10_000_000;
  const ts = [
    { address: "t1", state: "live", labels: { [PIN_LABEL]: "1" } },
    { address: "t2", state: "live", labels: { [PIN_LABEL]: "1", [AT_LABEL]: "5" } },
    { address: "m/t3", state: "live", labels: { [PIN_LABEL]: "1" } },
    { address: "t4", state: "live", labels: { [AT_LABEL]: "5" } },
    { address: "t5", state: "live", labels: { [AT_LABEL]: String(now - 100) } }, // fresh: its pin is on the way
    { address: "t6", state: "exited", labels: { [PIN_LABEL]: "1" } },
    { address: "t7", labels: {} },
  ];
  expect(stamps(ts, now)).toEqual([
    ["t1", `${AT_LABEL}=${now}`],
    ["m/t3", `${AT_LABEL}=${now + 1}`],
    ["t4", `${AT_LABEL}=`],
  ]);
  expect(stamps([{ address: "t5", labels: { [AT_LABEL]: String(now - GRACE - 1) } }], now)).toEqual([["t5", `${AT_LABEL}=`]]);
});

test("an exited pinned terminal leaves the jar: it isn't an agent any more", () => {
  const labels = of({ t1: { [PIN_LABEL]: "1", [AT_LABEL]: "1" }, t2: { [PIN_LABEL]: "1", [AT_LABEL]: "2" } });
  // t1 exited: agents() no longer lists it.
  const { pinned } = sortAgents([{ address: "t2", status: "idle" }, { address: "t3", status: "idle" }], rank, labels);
  expect(pinned.map((a: any) => a.address)).toEqual(["t2"]);
});

test("moving in the jar swaps neighbors and renumbers every pin, ties and all", () => {
  const jar = [{ address: "a" }, { address: "b" }, { address: "c" }];
  expect(moveInJar(jar, "c", -1, 100)).toEqual([["a", `${AT_LABEL}=100`], ["c", `${AT_LABEL}=101`], ["b", `${AT_LABEL}=102`]]);
  expect(moveInJar(jar, "a", 1, 100)).toEqual([["b", `${AT_LABEL}=100`], ["a", `${AT_LABEL}=101`], ["c", `${AT_LABEL}=102`]]);
  expect(moveInJar(jar, "a", -1, 100)).toEqual([]);
  expect(moveInJar(jar, "c", 1, 100)).toEqual([]);
  expect(moveInJar(jar, "zz", 1, 100)).toEqual([]);
  // The writes, applied, give the new order.
  const labels: Record<string, Record<string, string>> = { a: { [PIN_LABEL]: "1" }, b: { [PIN_LABEL]: "1" }, c: { [PIN_LABEL]: "1" } };
  for (const [t, kv] of moveInJar(jar, "b", -1, 7)) labels[t][AT_LABEL] = kv.split("=")[1];
  expect(sortAgents(jar.map((a) => ({ ...a, status: "idle" })), rank, of(labels)).pinned.map((a: any) => a.address)).toEqual(["b", "a", "c"]);
});
