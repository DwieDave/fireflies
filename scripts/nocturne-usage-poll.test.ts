// How many usage requests leave this machine (nocturne/limits.js, the same
// file as nocturne-usage/limits.js): one reading per machine, at the pace of
// what's happening, backing off after a 429. A simulated hour: each "app" is
// its own module instance with its own shared() store (as each Herdr app is),
// all on one fake file store (the machine's ~/.cache/herdr-app) and one fake
// endpoint that counts. Every copy (the sidebar, each usage pane) ticks every
// 30 s as the real timers do, all at once. No real request, no real file.
import { test, expect, mock, setSystemTime, afterAll } from "bun:test";

type Answer = { code: number; retry?: number };
let files = new Map<string, string>();
let locks = new Set<string>();
let requests: { p: string; t: number }[] = [];
let respond: (p: string) => Answer = () => ({ code: 200 });
const T0 = Date.parse("2026-11-12T10:00:00Z");

const BODY = JSON.stringify({ five_hour: { utilization: 10, resets_at: null }, seven_day: { utilization: 20, resets_at: null }, rate_limit: { primary_window: { used_percent: 5 }, secondary_window: { used_percent: 6 } } });
const tick = () => new Promise((r) => setImmediate(r));

/** The machine: the record file's ops, and the endpoint (a request takes a few turns, so copies interleave). */
async function machine(_cmd: string, args: string[]) {
  const script = args[1];
  await tick();
  if (script.includes("usage-$2.json")) {
    const [op, p, arg] = args.slice(3);
    if (op === "read") return { code: 0, stdout: files.get(p) ?? "", stderr: "" };
    if (op === "write") { files.set(p, arg); return { code: 0, stdout: "", stderr: "" }; }
    if (op === "lock") { if (locks.has(p)) return { code: 1, stdout: "", stderr: "" }; locks.add(p); return { code: 0, stdout: "", stderr: "" }; }
    if (op === "unlock") { locks.delete(p); return { code: 0, stdout: "", stderr: "" }; }
  }
  const p = script.includes("anthropic.com") ? "claude" : "codex";
  requests.push({ p, t: Date.now() - T0 });
  await tick(); await tick();
  const a = respond(p);
  return { code: 0, stdout: `${a.code === 200 ? BODY : '{"error":"rate_limited"}'}\n@code\t${a.code}\n@retry\t${a.retry ?? 0}`, stderr: "" };
}

mock.module("herdr", () => ({
  exec: machine, shared: () => null, setShared: () => null,
  window: () => ({ active: true }), terminals: () => [], panes: () => [], spaces: () => [],
}));

type Look = { active: boolean; working?: boolean; panes?: number };
/** An app: its own limits.js instance and shared() store, and what its window shows. */
async function app(name: string, look: Look) {
  const m: any = await import(`../defaults/mods/nocturne/limits.js?app=${name}-${Math.random()}`);
  const store: Record<string, unknown> = {};
  const tab = "tb1";
  m.setHost({
    shared: (k: string) => store[k] ?? null,
    setShared: (k: string, v: unknown) => { store[k] = v; return null; },
    appWindow: () => ({ active: look.active }),
    terminals: () => (look.working ? [{ status: "working" }] : [{ status: "idle" }]),
    spaces: () => [{ active: true, tabs: [{ id: tab, active: true }] }],
    panes: () => Array.from({ length: look.panes ?? 0 }, () => ({ mod: "nocturne-usage", tab, parked: false })),
  });
  // The sidebar and each pane: one copy each, all ticking.
  const copies = 1 + (look.panes ?? 0);
  return { m, store, copies, look };
}

/** Runs `apps` for `minutes`, every copy ticking every 30 s (panes opened at the start read with "open"). */
async function hour(apps: Awaited<ReturnType<typeof app>>[], minutes = 60) {
  for (const a of apps) for (let c = 1; c < a.copies; c++) await a.m.refreshUsage("open");
  for (let s = 0; s < minutes * 60; s += 30) {
    setSystemTime(new Date(T0 + s * 1000));
    await Promise.all(apps.flatMap((a) => Array.from({ length: a.copies }, () => a.m.refreshUsage())));
  }
}

function fresh() {
  files = new Map(); locks = new Set(); requests = []; respond = () => ({ code: 200 });
  setSystemTime(new Date(T0));
}
afterAll(() => setSystemTime());

test("the paces: 3 min looking at a usage pane, 10 min with the window active or an agent working, 30 min otherwise", async () => {
  fresh(); await hour([await app("a", { active: true, panes: 1 })]);
  expect(requests.length).toBe(20);
  fresh(); await hour([await app("a", { active: true })]);
  expect(requests.length).toBe(6);
  fresh(); await hour([await app("a", { active: false, working: true })]);
  expect(requests.length).toBe(6);
  fresh(); await hour([await app("a", { active: false })]);
  expect(requests.length).toBe(2);
});

test("one reading for the sidebar and any number of panes", async () => {
  fresh(); await hour([await app("a", { active: true, panes: 4 })]);
  expect(requests.length).toBe(20);
  // Never two at once: each request at least the pace apart.
  const gaps = requests.slice(1).map((r, i) => r.t - requests[i].t);
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(3 * 60_000);
});

test("one reading per machine: two apps (or two windows' apps) never double it", async () => {
  fresh(); await hour([await app("a", { active: true }), await app("b", { active: false, working: true })]);
  expect(requests.length).toBe(6);
  // One looking at a pane, the other idle: the eager one's pace, still one reading.
  fresh(); await hour([await app("a", { active: true, panes: 2 }), await app("b", { active: false }), await app("c", { active: false })]);
  expect(requests.length).toBe(20);
  // Every app shows the same answer, read once.
  fresh();
  const apps = [await app("a", { active: true }), await app("b", { active: false })];
  await hour(apps, 1);
  expect(requests.length).toBe(1);
  expect((apps[1].store["nocturne-usage.last"] as any)?.state).toBe("ok");
});

test("only the picked provider is asked", async () => {
  fresh(); await hour([await app("a", { active: true, panes: 1 })]);
  expect(new Set(requests.map((r) => r.p))).toEqual(new Set(["claude"]));
});

test("a 429 backs off (5, 10, 20, 40 min without Retry-After), keeps the last answer, and refresh waits too", async () => {
  fresh();
  const a = await app("a", { active: true, panes: 1 });
  await hour([a], 1); // a good answer first
  const good = a.store["nocturne-usage.last"];
  respond = () => ({ code: 429 });
  requests = [];
  setSystemTime(new Date(T0 + 4 * 60_000));
  for (let s = 4 * 60; s < 64 * 60; s += 30) {
    setSystemTime(new Date(T0 + s * 1000));
    await Promise.all([a.m.refreshUsage(), a.m.refreshUsage(), a.m.refreshUsage("force")]);
  }
  expect(requests.map((r) => Math.round(r.t / 60_000))).toEqual([4, 9, 19, 39]);
  expect(a.store["nocturne-usage.last"]).toEqual(good);
  expect((a.store["nocturne-usage.note"] as any).state).toBe("busy");
  expect((a.store["nocturne-usage.note"] as any).until).toBeGreaterThan(Date.now());
});

test("a 429 with Retry-After waits that long; the next good answer clears the back-off", async () => {
  fresh();
  const a = await app("a", { active: true, panes: 1 });
  respond = () => ({ code: 429, retry: 900 });
  await hour([a], 30);
  expect(requests.map((r) => Math.round(r.t / 60_000))).toEqual([0, 15]);
  respond = () => ({ code: 200 });
  requests = [];
  for (let s = 30 * 60; s < 40 * 60; s += 30) { setSystemTime(new Date(T0 + s * 1000)); await a.m.refreshUsage(); }
  expect(requests.map((r) => Math.round(r.t / 60_000))).toEqual([30, 33, 36, 39]);
  expect(a.store["nocturne-usage.note"]).toBe(null);
});

test("refresh: at once, then at most every 10 s, however often it's pressed", async () => {
  fresh();
  const a = await app("a", { active: true });
  await a.m.refreshUsage();
  requests = [];
  for (let s = 1; s <= 30; s++) { setSystemTime(new Date(T0 + s * 1000)); await Promise.all([a.m.refreshUsage("force"), a.m.refreshUsage("force")]); }
  expect(requests.map((r) => r.t / 1000)).toEqual([10, 20, 30]);
});

test("the back-off grows to its cap and Retry-After 0 means none given", async () => {
  const { backoff, BACKOFF, CAP } = await import("../defaults/mods/nocturne/limits.js");
  expect([1, 2, 3, 4, 5, 6, 7].map((n) => backoff(n) / 60_000)).toEqual([5, 10, 20, 40, 80, 120, 120]);
  expect(backoff(1, 0)).toBe(BACKOFF);
  expect(backoff(9, 30)).toBe(30_000);
  expect(CAP).toBe(2 * 3600_000);
});
