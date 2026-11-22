// The usage limits' readers (nocturne/limits.ts, the same file as
// usage/limits.ts): what they ask, and when they don't. The real shell
// scripts run (the login checks, the request's headers, the machine's
// record), with stand-in `security`, `curl` and `cat`-able login files on
// PATH and HOME, so no request leaves the machine. The app's services are
// @fireflies/kit's test layers: no module is mocked.
import { test, expect, beforeEach } from "bun:test";
import { copiesOf } from "./mod-source.ts";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, utimesSync, renameSync, symlinkSync, lstatSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Effect, Layer } from "effect";
import type { Schema } from "effect";
import { execTest, sharedTest, workspaceTest } from "@fireflies/kit/testing";
import { UsageEndpoint, lastUsage, readUsage, refreshUsage, usageNote } from "@fireflies/usage-limits";
import type { ProviderId, UsageServices } from "@fireflies/usage-limits";

const root = mkdtempSync(join(tmpdir(), "usage-limits-"));
const bin = join(root, "bin"), home = join(root, "home"), calls = join(root, "calls");
mkdirSync(bin); mkdirSync(join(home, ".codex"), { recursive: true });
// A login for each provider, and stand-ins that note being called.
writeFileSync(join(home, ".codex/auth.json"), JSON.stringify({ tokens: { access_token: "tok", account_id: "acct" } }));
const stand = (name: string, out: string) => {
  writeFileSync(join(bin, name), `#!/bin/sh\necho ${name} >> "${calls}"\ncat >/dev/null 2>&1\n${out}\n`);
  chmodSync(join(bin, name), 0o755);
};
stand("security", `printf '%s' '{"claudeAiOauth":{"accessToken":"tok","subscriptionType":"max","rateLimitTier":"default_claude_max_5x"}}'`);
stand("curl", `printf '%s\\n@code\\t200' '{"five_hour":{"utilization":10,"resets_at":null},"seven_day":{"utilization":20,"resets_at":null},"rate_limit":{"primary_window":{"used_percent":5},"secondary_window":{"used_percent":6}}}'`);

let env: Record<string, string> = {};

/** The machine: programs run for real, with the stand-ins first on PATH and this test's HOME. */
const exec = execTest(async (command, args) => {
  const p = Bun.spawn([command, ...args], { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, stdout, stderr };
});

/** An app: its own shared() store over the same machine (each Fireflies app has its own shared.json). */
function app() {
  const shared = sharedTest();
  const layer = Layer.provideMerge(UsageEndpoint.layer, Layer.mergeAll(exec.layer, shared.layer, workspaceTest().layer));
  const run = <A>(e: Effect.Effect<A, never, UsageServices>) => Effect.runPromise(Effect.provide(e, layer));
  return { store: shared.store, run };
}

let a = app();
const cache = join(root, "cache");

const curls = () => asked().filter((c) => c === "curl").length;
const asked = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) : []);
beforeEach(() => { rmSync(calls, { force: true }); rmSync(cache, { recursive: true, force: true }); env = { HERDR_USAGE_DIR: cache }; a = app(); });

test("no mod carries a copy of limits.ts: nocturne and usage import @fireflies/usage-limits", () => {
  expect(copiesOf("limits.ts")).toEqual([]);
});

for (const p of ["claude", "codex"] as const satisfies readonly ProviderId[]) {
  test(`${p}: a scratch app (HERDR_APP_HOME elsewhere) asks nothing and reads no login`, async () => {
    env = { HERDR_APP_HOME: "/var/tmp/scratch-home" };
    expect(await a.run(readUsage(p))).toEqual({ state: "off", local: true });
    expect(asked()).toEqual([]);
  });

  test(`${p}: the real app (no HERDR_APP_HOME, or the default home) asks`, async () => {
    for (const e of [{}, { HERDR_APP_HOME: join(home, ".config/herdr-app") }, { HERDR_APP_HOME: join(home, ".config/herdr-app/") }, { XDG_CONFIG_HOME: join(root, "xdg"), HERDR_APP_HOME: join(root, "xdg/herdr-app") }, { HERDR_APP_HOME: join(home, ".config/fireflies/app") }, { XDG_CONFIG_HOME: join(root, "xdg"), HERDR_APP_HOME: join(root, "xdg/fireflies/app/") }]) {
      rmSync(calls, { force: true });
      env = { HERDR_USAGE_DIR: cache, ...e };
      expect((await a.run(readUsage(p))).state).toBe("ok");
      expect(asked()).toContain("curl");
    }
  });

  test(`${p}: HERDR_APP_USAGE=1 turns it on in a scratch app`, async () => {
    env = { HERDR_USAGE_DIR: cache, HERDR_APP_HOME: "/var/tmp/scratch-home", HERDR_APP_USAGE: "1" };
    expect((await a.run(readUsage(p))).state).toBe("ok");
    expect(asked()).toContain("curl");
  });

  test(`${p}: the token reaches curl on its stdin, never in a program's arguments`, async () => {
    await a.run(readUsage(p));
    expect(exec.calls.length).toBeGreaterThan(0);
    for (const c of exec.calls) expect(c.args.join(" ")).not.toContain("tok\n");
    expect(exec.calls.some((c) => c.args.some((x) => / tok\b|Bearer tok/.test(x)))).toBe(false);
  });
}

test("no login on this machine: nologin, nothing asked", async () => {
  const before = readFileSync(join(bin, "security"), "utf8");
  stand("security", "exit 44");
  try {
    env = { HERDR_USAGE_DIR: cache, HOME: join(root, "nobody") };
    expect(await a.run(readUsage("claude"))).toEqual({ state: "nologin", local: true });
    expect(curls()).toBe(0);
  } finally {
    writeFileSync(join(bin, "security"), before);
  }
});

test("off: the views get no numbers (not a scratch home's stale ones), and it isn't asked again every tick", async () => {
  env = { HERDR_USAGE_DIR: cache, HERDR_APP_HOME: "/var/tmp/scratch-home" };
  a.store.set("usage.last", { state: "ok", session: { used: 1, resets: null, length: null }, week: null, scoped: [], plan: null, at: 1 });
  await a.run(refreshUsage());
  expect((await a.run(usageNote()))?.state).toBe("off");
  expect(await a.run(lastUsage())).toBe(null);
  rmSync(calls, { force: true });
  await a.run(refreshUsage());
  expect(asked()).toEqual([]);
});

test("off: a scratch app stays out of the machine's record (the real app never adopts its off, the scratch app shows none of the real numbers)", async () => {
  // The real app reads and writes the record.
  await a.run(refreshUsage());
  const file = join(cache, "usage-claude.json");
  const before = readFileSync(file, "utf8");
  expect(JSON.parse(before).note).toBe(null);
  // A scratch app on the same machine: its own shared() store, the same cache folder.
  const scratch = app();
  env = { HERDR_USAGE_DIR: cache, HERDR_APP_HOME: "/var/tmp/scratch-home" };
  await scratch.run(refreshUsage("force"));
  expect((await scratch.run(usageNote()))?.state).toBe("off");
  expect(await scratch.run(lastUsage())).toBe(null);
  expect([...scratch.store.values()].some((v) => JSON.stringify(v).includes('"session"'))).toBe(false);
  expect(readFileSync(file, "utf8")).toBe(before);
  expect(existsSync(`${file}.lock`)).toBe(false);
});

test("off: an off note an older scratch app left in the machine's record isn't the real app's, which asks again at its pace", async () => {
  mkdirSync(cache, { recursive: true });
  const old = Date.now() - 3600_000;
  writeFileSync(join(cache, "usage-claude.json"), JSON.stringify({ answer: { state: "ok", session: { used: 15, resets: null, length: 1 }, week: { used: 74, resets: null, length: 1 }, scoped: [], plan: "max 5x", at: old }, note: { state: "off", local: true, at: Date.now() }, tried: Date.now(), until: 0, fails: 0 }));
  await a.run(refreshUsage());
  expect(await a.run(usageNote())).toBe(null);
  expect(curls()).toBe(1);
  expect(JSON.parse(readFileSync(join(cache, "usage-claude.json"), "utf8")).note).toBe(null);
});

test("a scratch check that can't run counts as a scratch app: nothing is asked", async () => {
  const broken = execTest((_c, args) => {
    if (String(args[1]).includes("HERDR_APP_HOME")) throw new Error("sh: not found");
    return { code: 0, stdout: "", stderr: "" };
  });
  const shared = sharedTest();
  const layer = Layer.provideMerge(UsageEndpoint.layer, Layer.mergeAll(broken.layer, shared.layer, workspaceTest().layer));
  await Effect.runPromise(Effect.provide(refreshUsage("force"), layer));
  expect(broken.calls.some((c) => String(c.args[1]).includes("curl"))).toBe(false);
  expect(shared.store.get("usage.note")).toMatchObject({ state: "off" });
});

// ---- the machine's record: the real file and lock script

test("the machine's file: one app asks and writes it, another app adopts it without asking", async () => {
  await a.run(refreshUsage());
  expect(curls()).toBe(1);
  const rec = JSON.parse(readFileSync(join(cache, "usage-claude.json"), "utf8"));
  expect([rec.answer.state, rec.fails, rec.until]).toEqual(["ok", 0, 0]);
  expect(existsSync(join(cache, "usage-claude.json.lock"))).toBe(false);
  // Another app: its own shared() store, the same file.
  const other = app();
  await other.run(refreshUsage());
  expect(curls()).toBe(1);
  expect((await other.run(lastUsage()))?.state).toBe("ok");
});

test("the lock: held by another app, nobody else asks; left behind for minutes, it's taken over", async () => {
  mkdirSync(join(cache, "usage-claude.json.lock"), { recursive: true });
  await a.run(refreshUsage());
  expect(curls()).toBe(0);
  a = app();
  const old = new Date(Date.now() - 5 * 60_000);
  utimesSync(join(cache, "usage-claude.json.lock"), old, old);
  await a.run(refreshUsage());
  expect(curls()).toBe(1);
  expect(existsSync(join(cache, "usage-claude.json.lock"))).toBe(false);
});

test("the default place is ~/.cache/fireflies (XDG_CACHE_HOME respected)", async () => {
  env = {};
  await a.run(refreshUsage());
  expect(existsSync(join(home, ".cache/fireflies/usage-claude.json"))).toBe(true);
  a = app();
  env = { XDG_CACHE_HOME: join(root, "xdgc") };
  await a.run(refreshUsage());
  expect(existsSync(join(root, "xdgc/fireflies/usage-claude.json"))).toBe(true);
});

test("Herdr's ~/.cache/herdr-app stays in use until the app moves it, then its link is followed", async () => {
  const base = join(root, "xdgh");
  mkdirSync(join(base, "herdr-app"), { recursive: true });
  env = { XDG_CACHE_HOME: base };
  await a.run(refreshUsage());
  expect(existsSync(join(base, "herdr-app/usage-claude.json"))).toBe(true);
  expect(existsSync(join(base, "fireflies"))).toBe(false);
  // The app's move: the folder goes to fireflies, a link stays at herdr-app.
  renameSync(join(base, "herdr-app"), join(base, "fireflies"));
  symlinkSync("fireflies", join(base, "herdr-app"));
  rmSync(join(base, "fireflies/usage-claude.json"));
  a = app();
  await a.run(refreshUsage());
  expect(existsSync(join(base, "fireflies/usage-claude.json"))).toBe(true);
  expect(lstatSync(join(base, "herdr-app")).isSymbolicLink()).toBe(true);
});

test("a record file in another shape is written over, not a crash or a stuck reading", async () => {
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, "usage-claude.json"), '{"answer": "not an answer", "tried": "yesterday"}');
  await a.run(refreshUsage());
  expect(curls()).toBe(1);
  expect(JSON.parse(readFileSync(join(cache, "usage-claude.json"), "utf8")).answer.state).toBe("ok");
});

// The endpoint's answer as it came on 2026-11-13: null for what doesn't apply (a limit's `scope` on
// the session and whole-week limits, the model windows, fields this build doesn't read). A guard
// that asked for an object there refused the whole answer ("couldn't read").
test("claude: the real answer's nulls (a limit without a scope, absent windows) still read", async () => {
  const real: Schema.Json = {
    five_hour: { utilization: 81.0, resets_at: "2026-11-13T13:30:00.063213+00:00", limit_dollars: null, locked_reason: null },
    seven_day: { utilization: 48.0, resets_at: "2026-11-16T17:00:00.063233+00:00", limit_dollars: null, locked_reason: null },
    seven_day_oauth_apps: null, seven_day_opus: null, seven_day_sonnet: null, pace: null, indicator: null,
    extra_usage: { is_enabled: false, monthly_limit: null, utilization: null },
    limits: [
      { kind: "session", group: "session", percent: 81, severity: "warning", resets_at: "2026-11-13T13:30:00.063213+00:00", scope: null, is_active: true },
      { kind: "weekly_all", group: "weekly", percent: 48, severity: "normal", resets_at: "2026-11-16T17:00:00.063233+00:00", scope: null, is_active: false },
      { kind: "weekly_scoped", group: "weekly", percent: 30, severity: "normal", resets_at: "2026-11-16T17:00:00.063416+00:00", scope: { model: { id: null, display_name: "Fable" }, surface: null }, is_active: false },
      { kind: "weekly_scoped", percent: null, resets_at: null, scope: { model: null, surface: null } },
    ],
  };
  const before = readFileSync(join(bin, "curl"), "utf8");
  stand("curl", `printf '%s\\n@code\\t200' '${JSON.stringify(real)}'`);

  try {
    const r = await a.run(readUsage("claude"));
    expect(r.state).toBe("ok");
    expect(r).toMatchObject({ session: { used: 81 }, week: { used: 48 }, scoped: [{ name: "Fable", used: 30 }], plan: "max 5x" });
  } finally {
    writeFileSync(join(bin, "curl"), before);
  }
});

test("an answer of another shape says so; curl that can't connect says why", async () => {
  const before = readFileSync(join(bin, "curl"), "utf8");
  try {
    stand("curl", `printf '%s\\n@code\\t200' '{"five_hour": "lots"}'`);
    expect(await a.run(readUsage("claude"))).toEqual({ state: "error", message: "the usage endpoint's answer wasn't in a shape this build reads" });
    stand("curl", `echo 'curl: (6) Could not resolve host: api.anthropic.com' >&2; printf '\\n@code\\t000'; exit 6`);
    expect(await a.run(readUsage("claude"))).toEqual({ state: "error", message: "curl: (6) Could not resolve host: api.anthropic.com" });
    // A transport failure is tried again twice inside the reading (1 s, 2 s): three requests, one reading.
    expect(curls()).toBe(1 + 3);
  } finally {
    writeFileSync(join(bin, "curl"), before);
  }
}, 15_000);
