// How many usage requests leave this machine (nocturne/limits.ts, the same
// file as usage/limits.ts): one reading per machine, at the pace of
// what's happening, backing off after a 429. A simulated hour: each "app" has
// its own shared() store (as each Fireflies app does), all on one fake file
// store (the machine's ~/.cache/herdr-app) and one fake endpoint that counts.
// Every copy (the sidebar, each usage pane) ticks every 30 s as the real
// timers do, all at once. No real request, no real file: the app's services
// are @fireflies/kit's test layers, the endpoint a fake server (httpTest).
import { test, expect, setSystemTime, afterAll } from "bun:test";
import { Effect, Layer } from "effect";
import { execTest, httpTest, sharedTest, workspaceTest } from "@fireflies/kit/testing";
import { HttpClient } from "effect/http";
import { UsageEndpoint, backoff, BACKOFF, CAP, refreshUsage } from "@fireflies/usage-limits";
import type { UsageServices } from "@fireflies/usage-limits";

type Answer = { code: number; retry?: number };
let files = new Map<string, string>();
let locks = new Set<string>();
let requests: { p: string; t: number }[] = [];
let respond: (p: string) => Answer = () => ({ code: 200 });
const T0 = Date.parse("2026-11-12T10:00:00Z");

const BODY = JSON.stringify({ five_hour: { utilization: 10, resets_at: null }, seven_day: { utilization: 20, resets_at: null }, rate_limit: { primary_window: { used_percent: 5 }, secondary_window: { used_percent: 6 } } });
const tick = () => new Promise((r) => setImmediate(r));
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });

/** The machine: the record file's ops, the scratch and login checks (a request takes a few turns, so copies interleave). */
const machine = execTest(async (_cmd, args) => {
  const script = String(args[1]);
  await tick();
  if (script.includes("usage-$2.json")) {
    const [op, p = "", arg = ""] = args.slice(3);
    if (op === "read") return ok(files.get(p) ?? "");
    if (op === "write") { files.set(p, arg); return ok(); }
    if (op === "lock") { if (locks.has(p)) return { code: 1, stdout: "", stderr: "" }; locks.add(p); return ok(); }
    if (op === "unlock") { locks.delete(p); return ok(); }
  }
  // The scratch check, the login check: this isn't a scratch app, and there is a login.
  return ok("@plan\tmax\tdefault_claude_max_5x\n");
});

/** The endpoint: counts each request, answers as `respond` says. */
const endpoint = httpTest(async (req) => {
  const p = req.url.includes("anthropic.com") ? "claude" : "codex";
  requests.push({ p, t: Date.now() - T0 });
  await tick(); await tick();
  const a = respond(p);
  return a.code === 200 ? { status: 200, body: BODY } : { status: a.code, body: '{"error":"rate_limited"}', headers: a.retry ? [["retry-after", String(a.retry)]] : [] };
});
const Endpoint = Layer.effect(UsageEndpoint, HttpClient.HttpClient.use((client) => Effect.succeed(UsageEndpoint.of({ client: () => client })))).pipe(Layer.provide(endpoint.layer));

type Look = { active: boolean; working?: boolean; panes?: number };
/** An app: its own shared() store and what its window shows, on the one machine and endpoint. */
function app(_name: string, look: Look) {
  const shared = sharedTest();
  const tab = "tb1";
  const workspace = workspaceTest({
    window: () => ({ platform: "macos", titlebar: "none", buttons: false, maximized: false, fullscreen: false, active: look.active }),
    terminals: () => (look.working ? [{ status: "working" }] : [{ status: "idle" }]),
    // SAFETY: the pace reads only these fields of a space, a tab and a pane.
    spaces: () => [{ active: true, tabs: [{ id: tab, active: true }] }] as never,
    panes: () => Array.from({ length: look.panes ?? 0 }, () => ({ mod: "usage", tab, parked: false })) as never,
  });
  const layer = Layer.mergeAll(machine.layer, shared.layer, workspace.layer, Endpoint);
  const run = (e: Effect.Effect<void, never, UsageServices>) => Effect.runPromise(Effect.provide(e, layer));
  const store = new Proxy({} as Record<string, unknown>, { get: (_t, k: string) => shared.store.get(k) ?? null });
  // The sidebar and each pane: one copy each, all ticking.
  const copies = 1 + (look.panes ?? 0);
  return { m: { refreshUsage: (why?: "tick" | "open" | "force") => run(refreshUsage(why ?? "tick")) }, store, copies, look };
}

/** Runs `apps` for `minutes`, every copy ticking every 30 s (panes opened at the start read with "open"). */
async function hour(apps: ReturnType<typeof app>[], minutes = 60) {
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
  fresh(); await hour([app("a", { active: true, panes: 1 })]);
  expect(requests.length).toBe(20);
  fresh(); await hour([app("a", { active: true })]);
  expect(requests.length).toBe(6);
  fresh(); await hour([app("a", { active: false, working: true })]);
  expect(requests.length).toBe(6);
  fresh(); await hour([app("a", { active: false })]);
  expect(requests.length).toBe(2);
});

test("one reading for the sidebar and any number of panes", async () => {
  fresh(); await hour([app("a", { active: true, panes: 4 })]);
  expect(requests.length).toBe(20);
  // Never two at once: each request at least the pace apart.
  const gaps = requests.slice(1).map((r, i) => r.t - requests[i].t);
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(3 * 60_000);
});

test("one reading per machine: two apps (or two windows' apps) never double it", async () => {
  fresh(); await hour([app("a", { active: true }), app("b", { active: false, working: true })]);
  expect(requests.length).toBe(6);
  // One looking at a pane, the other idle: the eager one's pace, still one reading.
  fresh(); await hour([app("a", { active: true, panes: 2 }), app("b", { active: false }), app("c", { active: false })]);
  expect(requests.length).toBe(20);
  // Every app shows the same answer, read once.
  fresh();
  const apps = [app("a", { active: true }), app("b", { active: false })];
  await hour(apps, 1);
  expect(requests.length).toBe(1);
  expect((apps[1].store["usage.last"] as any)?.state).toBe("ok");
});

test("only the picked provider is asked", async () => {
  fresh(); await hour([app("a", { active: true, panes: 1 })]);
  expect(new Set(requests.map((r) => r.p))).toEqual(new Set(["claude"]));
});

test("a 429 backs off (5, 10, 20, 40 min without Retry-After), keeps the last answer, and refresh waits too", async () => {
  fresh();
  const a = app("a", { active: true, panes: 1 });
  await hour([a], 1); // a good answer first
  const good = a.store["usage.last"];
  respond = () => ({ code: 429 });
  requests = [];
  setSystemTime(new Date(T0 + 4 * 60_000));
  for (let s = 4 * 60; s < 64 * 60; s += 30) {
    setSystemTime(new Date(T0 + s * 1000));
    await Promise.all([a.m.refreshUsage(), a.m.refreshUsage(), a.m.refreshUsage("force")]);
  }
  expect(requests.map((r) => Math.round(r.t / 60_000))).toEqual([4, 9, 19, 39]);
  expect(a.store["usage.last"]).toEqual(good);
  expect((a.store["usage.note"] as any).state).toBe("busy");
  expect((a.store["usage.note"] as any).until).toBeGreaterThan(Date.now());
});

test("a 429 with Retry-After waits that long; the next good answer clears the back-off", async () => {
  fresh();
  const a = app("a", { active: true, panes: 1 });
  respond = () => ({ code: 429, retry: 900 });
  await hour([a], 30);
  expect(requests.map((r) => Math.round(r.t / 60_000))).toEqual([0, 15]);
  respond = () => ({ code: 200 });
  requests = [];
  for (let s = 30 * 60; s < 40 * 60; s += 30) { setSystemTime(new Date(T0 + s * 1000)); await a.m.refreshUsage(); }
  expect(requests.map((r) => Math.round(r.t / 60_000))).toEqual([30, 33, 36, 39]);
  expect(a.store["usage.note"]).toBe(null);
});

test("refresh: at once, then at most every 10 s, however often it's pressed", async () => {
  fresh();
  const a = app("a", { active: true });
  await a.m.refreshUsage();
  requests = [];
  for (let s = 1; s <= 30; s++) { setSystemTime(new Date(T0 + s * 1000)); await Promise.all([a.m.refreshUsage("force"), a.m.refreshUsage("force")]); }
  expect(requests.map((r) => r.t / 1000)).toEqual([10, 20, 30]);
});

test("the back-off grows to its cap and Retry-After 0 means none given", async () => {
  expect([1, 2, 3, 4, 5, 6, 7].map((n) => backoff(n) / 60_000)).toEqual([5, 10, 20, 40, 80, 120, 120]);
  expect(backoff(1, 0)).toBe(BACKOFF);
  expect(backoff(9, 30)).toBe(30_000);
  expect(CAP).toBe(2 * 3600_000);
});
