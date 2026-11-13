// The usage limits' readers (nocturne/limits.ts, the same file as
// nocturne-usage/limits.ts): what they ask, and when they don't. The real
// shell scripts run, with stand-in `security`, `curl` and `cat`-able login
// files on PATH and HOME, so no request leaves the machine. Its own process:
// it stands in for "herdr".
import { test, expect, mock, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const root = mkdtempSync(join(tmpdir(), "usage-limits-"));
const bin = join(root, "bin"), home = join(root, "home"), calls = join(root, "calls");
mkdirSync(bin); mkdirSync(join(home, ".codex"), { recursive: true });
// A login for each provider, and stand-ins that note being called.
writeFileSync(join(home, ".codex/auth.json"), JSON.stringify({ tokens: { access_token: "tok", account_id: "acct" } }));
const stand = (name: string, out: string) => {
  writeFileSync(join(bin, name), `#!/bin/sh\necho ${name} >> "${calls}"\ncat >/dev/null 2>&1 </dev/null\n${out}\n`);
  chmodSync(join(bin, name), 0o755);
};
stand("security", `printf '%s' '{"claudeAiOauth":{"accessToken":"tok","subscriptionType":"max","rateLimitTier":"default_claude_max_5x"}}'`);
stand("curl", `printf '%s\\n@code\\t200' '{"five_hour":{"utilization":10,"resets_at":null},"seven_day":{"utilization":20,"resets_at":null},"rate_limit":{"primary_window":{"used_percent":5},"secondary_window":{"used_percent":6}}}'`);

let env: Record<string, string> = {};
const store: Record<string, unknown> = {};
mock.module("herdr", () => ({
  window: () => ({ active: true }), terminals: () => [], panes: () => [], spaces: () => [],
  shared: (k: string) => store[k] ?? null,
  setShared: (k: string, v: unknown) => { store[k] = v; return null; },
  exec: async (cmd: string, args: string[]) => {
    const r = Bun.spawnSync([cmd, ...args], { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, ...env } });
    return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
  },
}));
const { readUsage, refreshUsage, lastUsage, usageNote } = await import("../defaults/mods/nocturne/limits.ts");
const cache = join(root, "cache");

const asked = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) : []);
beforeEach(() => { rmSync(calls, { force: true }); rmSync(cache, { recursive: true, force: true }); env = { HERDR_USAGE_DIR: cache }; for (const k of Object.keys(store)) delete store[k]; });

test("the two limits.ts copies are the same file", () => {
  const a = readFileSync(`${import.meta.dir}/../defaults/mods/nocturne/limits.ts`, "utf8");
  const b = readFileSync(`${import.meta.dir}/../defaults/mods/nocturne-usage/limits.ts`, "utf8");
  expect(a).toBe(b);
});

for (const p of ["claude", "codex"]) {
  test(`${p}: a scratch app (HERDR_APP_HOME elsewhere) asks nothing and reads no login`, async () => {
    env = { HERDR_APP_HOME: "/var/tmp/scratch-home" };
    expect(await readUsage(p)).toEqual({ state: "off", local: true });
    expect(asked()).toEqual([]);
  });

  test(`${p}: the real app (no HERDR_APP_HOME, or the default home) asks`, async () => {
    for (const e of [{}, { HERDR_APP_HOME: join(home, ".config/herdr-app") }, { HERDR_APP_HOME: join(home, ".config/herdr-app/") }, { XDG_CONFIG_HOME: join(root, "xdg"), HERDR_APP_HOME: join(root, "xdg/herdr-app") }]) {
      rmSync(calls, { force: true });
      env = { HERDR_USAGE_DIR: cache, ...e } as Record<string, string>;
      expect((await readUsage(p)).state).toBe("ok");
      expect(asked()).toContain("curl");
    }
  });

  test(`${p}: HERDR_APP_USAGE=1 turns it on in a scratch app`, async () => {
    env = { HERDR_USAGE_DIR: cache, HERDR_APP_HOME: "/var/tmp/scratch-home", HERDR_APP_USAGE: "1" };
    expect((await readUsage(p)).state).toBe("ok");
    expect(asked()).toContain("curl");
  });
}

test("off: the views get no numbers (not a scratch home's stale ones), and it isn't asked again every tick", async () => {
  env = { HERDR_USAGE_DIR: cache, HERDR_APP_HOME: "/var/tmp/scratch-home" };
  store["nocturne-usage.last"] = { state: "ok", session: { used: 1 }, at: 1 };
  await refreshUsage();
  expect(usageNote()?.state).toBe("off");
  expect(lastUsage()).toBe(null);
  rmSync(calls, { force: true });
  await refreshUsage();
  expect(asked()).toEqual([]);
});

// ---- the machine's record: the real file and lock script

const curls = () => asked().filter((c) => c === "curl").length;

test("the machine's file: one app asks and writes it, another app adopts it without asking", async () => {
  await refreshUsage();
  expect(curls()).toBe(1);
  const rec = JSON.parse(readFileSync(join(cache, "usage-claude.json"), "utf8"));
  expect([rec.answer.state, rec.fails, rec.until]).toEqual(["ok", 0, 0]);
  expect(existsSync(join(cache, "usage-claude.json.lock"))).toBe(false);
  // Another app: its own shared() store, the same file.
  const other: any = await import(`../defaults/mods/nocturne/limits.ts?other=${Math.random()}`);
  const mine: Record<string, unknown> = {};
  other.setHost({ shared: (k: string) => mine[k] ?? null, setShared: (k: string, v: unknown) => { mine[k] = v; return null; } });
  await other.refreshUsage();
  expect(curls()).toBe(1);
  expect(other.lastUsage()?.state).toBe("ok");
});

test("the lock: held by another app, nobody else asks; left behind for minutes, it's taken over", async () => {
  mkdirSync(join(cache, "usage-claude.json.lock"), { recursive: true });
  await refreshUsage();
  expect(curls()).toBe(0);
  for (const k of Object.keys(store)) delete store[k];
  const old = new Date(Date.now() - 5 * 60_000);
  require("fs").utimesSync(join(cache, "usage-claude.json.lock"), old, old);
  await refreshUsage();
  expect(curls()).toBe(1);
  expect(existsSync(join(cache, "usage-claude.json.lock"))).toBe(false);
});

test("the default place is ~/.cache/herdr-app (XDG_CACHE_HOME respected)", async () => {
  env = {};
  await refreshUsage();
  expect(existsSync(join(home, ".cache/herdr-app/usage-claude.json"))).toBe(true);
  for (const k of Object.keys(store)) delete store[k];
  env = { XDG_CACHE_HOME: join(root, "xdgc") };
  await refreshUsage();
  expect(existsSync(join(root, "xdgc/herdr-app/usage-claude.json"))).toBe(true);
});
