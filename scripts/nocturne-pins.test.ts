import { test, expect } from "bun:test";
import { PIN_LABEL, AT_LABEL, GRACE, isPinned, pinnedAt, sortAgents, stamps, moveInJar, PANES_KEY, GONE_AFTER, paneRecords, storedRecords, findPane, modNow, panePinned, pinPaneRecord, paneKey, isPaneKey, jarItems, reorder, retime, tidy, onShelf } from "../defaults/mods/nocturne/pins.ts";

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

// ---- panes that aren't agents: a plain terminal, a web page, an editor, files

const web = { pane: "p1", terminal: null, mod: "browser", props: { slot: "w1", url: "https://x" }, tab: "c1" };
const editor = { pane: "p2", terminal: null, mod: "editor", props: { file: "/a/PLAN.md" }, tab: "c2" };
const shellPane = { pane: "p3", terminal: "t9", tab: "c1" };
/** Records written as stored, read as the jar reads them (props become maps). */
const parsed = (list: any[]) => paneRecords(() => list);
const one = (r: any) => parsed([r])[0];

test("the panes' pin store: well formed records only, pin and unpin by pane id", () => {
  expect(PANES_KEY).toBe("nocturne.pinned-panes");
  expect(paneRecords(() => null)).toEqual([]);
  expect(paneRecords(() => ({ pane: "p1" }))).toEqual([]);
  expect(paneRecords(() => [{ pane: "p1", at: 1 }, null, { pane: "" }, { at: 2 }, "x"])).toEqual([{ pane: "p1", at: 1 }]);
  let recs = pinPaneRecord([], web, true, 500);
  expect(storedRecords(recs)).toEqual([{ pane: "p1", mod: "browser", props: { slot: "w1", url: "https://x" }, at: 500 }]);
  expect(panePinned(recs, "p1")).toBe(true);
  expect(panePinned(recs, "p2")).toBe(false);
  // Pinning again renews it (once per pane); unpinning removes only it.
  recs = pinPaneRecord(pinPaneRecord(recs, editor, true, 600), web, true, 700);
  expect(recs.map((r: any) => [r.pane, r.at])).toEqual([["p2", 600], ["p1", 700]]);
  expect(pinPaneRecord(recs, web, false, 800).map((r: any) => r.pane)).toEqual(["p2"]);
  expect(paneKey("p1")).toBe("pane:p1");
  expect(isPaneKey("pane:p1")).toBe(true);
  expect(isPaneKey("t1")).toBe(false);
});

test("a record finds its pane by id, else by the same mod and props when that's unique", () => {
  const raw = { pane: "old", mod: "browser", props: { url: "https://x", slot: "w1" } };
  const rec = one(raw);
  expect(findPane(one({ pane: "p1" }), [web])).toBe(web);
  // A restart gave it a new id: the same mod and props (any key order) find it.
  expect(findPane(rec, [editor, web])).toBe(web);
  // Two alike: no guess.
  expect(findPane(rec, [web, { ...web, pane: "p9" }])).toBe(null);
  // No props to go by, or another mod: not found.
  expect(findPane(one({ pane: "old", mod: "file-tree", props: {} }), [{ pane: "p5", terminal: null, mod: "file-tree", props: {} }])).toBe(null);
  expect(findPane(one({ ...raw, mod: "editor" }), [web])).toBe(null);
  // A terminal pane never answers for a mod pane's record.
  expect(findPane(one({ pane: "p3" }), [shellPane])).toBe(null);
  // A pin made while the mod was nocturne-browser finds it under its name now.
  expect(findPane(one({ ...raw, mod: "nocturne-browser" }), [editor, web])).toBe(web);
  expect(modNow("nocturne-files")).toBe("file-tree");
  expect(modNow("nocturne-editor")).toBe("editor");
  expect(modNow("files")).toBe("files");
});

test("the jar mixes agents, plain terminals and mod panes in the order pinned", () => {
  const agents = [
    { address: "t1", status: "working" },
    { address: "t2", status: "idle" },
    { address: "t3", status: "blocked" }, // not pinned
  ];
  const terminals = [
    { address: "t1", state: "live", labels: { [PIN_LABEL]: "1", [AT_LABEL]: "100" } },
    { address: "t2", state: "live", labels: { [PIN_LABEL]: "1", [AT_LABEL]: "400" } },
    { address: "t3", state: "live", labels: {} },
    { address: "t9", state: "live", labels: { [PIN_LABEL]: "1", [AT_LABEL]: "300" } }, // a plain shell
    { address: "t8", state: "exited", labels: { [PIN_LABEL]: "1", [AT_LABEL]: "50" } }, // gone
    { address: "t7", state: "live", labels: { [PIN_LABEL]: "1" } }, // pinned from the CLI, no time yet
  ];
  const records = parsed([
    { pane: "p1", mod: "browser", props: web.props, at: 200 },
    { pane: "p2", mod: "editor", props: editor.props, at: 500 },
    { pane: "gone", mod: "file-tree", props: { path: "/x" }, at: 150 }, // closed
  ]);
  const jar = jarItems({ agents, terminals, panes: [web, editor, shellPane], records });
  expect(jar.map((x: any) => [x.kind, x.key])).toEqual([
    ["agent", "t1"], ["pane", "pane:p1"], ["terminal", "t9"], ["agent", "t2"], ["pane", "pane:p2"], ["terminal", "t7"],
  ]);
  expect(jar[1].pane).toBe(web);
  expect(jar[2].pane).toBe(shellPane);
  expect(jar[5].pane).toBe(null); // a terminal without a pane still goes in
  expect(jar[0].agent).toBe(agents[0]);
});

test("reordering keeps to its own kind: fireflies up and down, tiles left and right", () => {
  const jar = [{ key: "t1", kind: "agent" }, { key: "pane:p1", kind: "pane" }, { key: "t2", kind: "agent" }, { key: "t9", kind: "terminal" }, { key: "pane:p2", kind: "pane" }];
  expect(onShelf(jar[0])).toBe(false);
  expect(onShelf(jar[1])).toBe(true);
  expect(onShelf(jar[3])).toBe(true);
  // A tile moves past tiles only (a shell's too), not the fireflies between them.
  expect(reorder(jar, "t9", -1, 10)).toEqual([["t9", 10], ["pane:p1", 11], ["pane:p2", 12]]);
  expect(reorder(jar, "pane:p1", 1, 10)).toEqual([["t9", 10], ["pane:p1", 11], ["pane:p2", 12]]);
  expect(reorder(jar, "pane:p1", -1, 10)).toEqual([]);
  expect(reorder(jar, "pane:p2", 1, 10)).toEqual([]);
  // A firefly past fireflies.
  expect(reorder(jar, "t2", -1, 10)).toEqual([["t2", 10], ["t1", 11]]);
  expect(reorder(jar, "t2", 1, 10)).toEqual([]);
  expect(reorder(jar, "nope", 1, 10)).toEqual([]);
  const records = [{ pane: "p1", at: 5 }, { pane: "p2", at: 6 }];
  expect(retime(records, [["pane:p1", 10], ["t1", 11]])).toEqual([{ pane: "p1", at: 10 }, { pane: "p2", at: 6 }]);
});

test("tidy: a pane found under a new id takes it, a closed one goes after GONE_AFTER, an away machine's stay", () => {
  const missing = new Map<string, number>();
  const now = 1_000_000;
  const recs = parsed([
    { pane: "old", mod: "browser", props: web.props, at: 1 }, // came back as p1
    { pane: "p2", mod: "editor", props: editor.props, at: 2 }, // there
    { pane: "p4", mod: "file-tree", props: { path: "/x" }, at: 3 }, // closed
    { pane: "m/p7", mod: "browser", props: { slot: "r" }, at: 4 }, // on a machine that's away
  ]);
  // No panes at all (the app is still loading): nothing changes.
  expect(tidy(recs, [], missing, now)).toBe(null);
  const out = tidy(recs, [web, editor], missing, now);
  expect(out!.map((r: any) => r.pane)).toEqual(["p1", "p2", "p4", "m/p7"]);
  expect(missing.get("p4")).toBe(now);
  expect(tidy(out!, [web, editor], missing, now + GONE_AFTER - 1)).toBe(null);
  const later = tidy(out!, [web, editor], missing, now + GONE_AFTER);
  expect(later!.map((r: any) => r.pane)).toEqual(["p1", "p2", "m/p7"]);
  expect(missing.has("p4")).toBe(false);
  // Back before its time is up: the clock starts over.
  const m2 = new Map<string, number>();
  tidy([{ pane: "p2", at: 1 }], [web], m2, now);
  expect(tidy([{ pane: "p2", at: 1 }], [editor], m2, now + 5)).toBe(null);
  expect(m2.has("p2")).toBe(false);
  // The away machine's panes back but this one closed: it goes in time too.
  const m3 = new Map<string, number>();
  const remote = { pane: "m/p8", terminal: null, mod: "x", props: {}, tab: "m/c1" };
  tidy([recs[3]], [remote], m3, now);
  expect(tidy([recs[3]], [remote], m3, now + GONE_AFTER)).toEqual([]);
});
