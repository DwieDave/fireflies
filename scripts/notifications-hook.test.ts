// The Claude Code hook's records (notifications/bin/claude-hook) and the
// engine's reader (readRecords): the real shell runs both, under a temp
// XDG_STATE_HOME. The hook writes ~/.local/state/fireflies/notify; a machine
// whose hook is still Herdr's copy wrote ~/.local/state/herdr-app/notify,
// which the reader still finds.
import { test, expect, mock } from "bun:test";
import { Effect } from "effect";
import { newHost, notificationsHerdr, notificationsServices, runOn, shellExec } from "./notifications-host.ts";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const state = mkdtempSync(join(tmpdir(), "notify-hook-"));
let env: Record<string, string | undefined> = { ...process.env, XDG_STATE_HOME: state };

// A stat that answers as GNU coreutils' does (Linux, or a Nix shell on macOS): -f is
// file-system status over several lines and exit 1, -c %Y the time.
const gnu = mkdtempSync(join(tmpdir(), "notify-gnu-"));
writeFileSync(join(gnu, "stat"), `#!/bin/sh
case "$1" in
  -f) printf '  File: "%s"\n    ID: 1 Namelen: ?  Type: apfs\n' "$3"; exit 1 ;;
  -c) echo 1700000000 ;;
esac
`);
chmodSync(join(gnu, "stat"), 0o755);

const host = newHost({});
mock.module("herdr", () => notificationsHerdr(host));
const { readRecords } = await import("../defaults/mods/notifications/engine.ts");
/** Runs `check` on the records for `ids`, read by a real shell with the `env` of now. */
const withRecords = (ids: string[], check: (got: ReadonlyMap<string, any>) => void) =>
  runOn(notificationsServices({ exec: shellExec(() => env) }).layer, Effect.map(readRecords(ids), check));
const hook = join(import.meta.dir, "../defaults/mods/notifications/bin/claude-hook");
const payload = (tool: string) => JSON.stringify({ tool_name: tool, tool_input: { command: "ls" } });

test("the hook writes its record under fireflies/notify, and the reader finds it", () => {
  const r = Bun.spawnSync(["sh", hook], { env: { ...env, HC_TERMINAL_ID: "t1" }, stdin: new TextEncoder().encode(payload("Bash")) });
  expect(r.exitCode).toBe(0);
  expect(r.stdout.toString()).toBe("");
  expect(existsSync(join(state, "fireflies/notify/t1.claude.json"))).toBe(true);
  expect(existsSync(join(state, "herdr-app"))).toBe(false);
  return withRecords(["t1"], (got) => expect(got.get("t1")?.payload.tool_name).toBe("Bash"));
});

test("a record from Herdr's copy of the hook (herdr-app/notify) is still read; the new place wins", () => {
  mkdirSync(join(state, "herdr-app/notify"), { recursive: true });
  writeFileSync(join(state, "herdr-app/notify/t2.claude.json"), payload("Edit"));
  writeFileSync(join(state, "herdr-app/notify/t1.claude.json"), payload("Old"));
  return withRecords(["t1", "t2"], (got) => {
    expect(got.get("t2")?.payload.tool_name).toBe("Edit");
    expect(got.get("t1")?.payload.tool_name).toBe("Bash");
  });
});

test("records are read where stat is GNU's (Linux, a Nix shell), with their time", () => {
  const before = env;
  env = { ...before, PATH: `${gnu}:${before.PATH ?? ""}` };
  return runOn(notificationsServices({ exec: shellExec(() => env) }).layer, readRecords(["t1", "t2"]).pipe(
    Effect.map((got) => {
      expect(got.get("t1")?.payload.tool_name).toBe("Bash");
      expect(got.get("t2")?.payload.tool_name).toBe("Edit");
      expect(got.get("t1")?.at).toBe(1700000000 * 1000);
    }),
    Effect.ensuring(Effect.sync(() => { env = before; })),
  ));
});

test("records carry the file's own time with the stat on PATH (BSD's on macOS, GNU's in a Nix shell)", () =>
  withRecords(["t1"], (got) => {
    expect(Number.isFinite(got.get("t1")?.at)).toBe(true);
    expect(Math.abs((got.get("t1")?.at ?? 0) - Date.now())).toBeLessThan(600_000);
  }));
