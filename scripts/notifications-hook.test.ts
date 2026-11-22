// The Claude Code hook's records (notifications/bin/claude-hook) and the
// engine's reader (readRecords): the real shell runs both, under a temp
// XDG_STATE_HOME. The hook writes ~/.local/state/fireflies/notify; a machine
// whose hook is still Herdr's copy wrote ~/.local/state/herdr-app/notify,
// which the reader still finds.
import { test, expect, mock } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const state = mkdtempSync(join(tmpdir(), "notify-hook-"));
const env = { ...process.env, XDG_STATE_HOME: state };

mock.module("herdr", () => ({
  terminals: () => [], agents: () => [], shared: () => null, setShared: () => {},
  hc: async () => ({ code: 1, stdout: "", stderr: "" }),
  exec: async (cmd: string, args: string[]) => {
    const r = Bun.spawnSync([cmd, ...args], { env });
    return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
  },
}));

const { readRecords } = await import("../defaults/mods/notifications/engine.ts");
const hook = join(import.meta.dir, "../defaults/mods/notifications/bin/claude-hook");
const payload = (tool: string) => JSON.stringify({ tool_name: tool, tool_input: { command: "ls" } });

test("the hook writes its record under fireflies/notify, and the reader finds it", async () => {
  const r = Bun.spawnSync(["sh", hook], { env: { ...env, HC_TERMINAL_ID: "t1" }, stdin: new TextEncoder().encode(payload("Bash")) });
  expect(r.exitCode).toBe(0);
  expect(r.stdout.toString()).toBe("");
  expect(existsSync(join(state, "fireflies/notify/t1.claude.json"))).toBe(true);
  expect(existsSync(join(state, "herdr-app"))).toBe(false);
  const records = await readRecords(["t1"]);
  expect(records.get("t1")?.payload.tool_name).toBe("Bash");
});

test("a record from Herdr's copy of the hook (herdr-app/notify) is still read; the new place wins", async () => {
  mkdirSync(join(state, "herdr-app/notify"), { recursive: true });
  writeFileSync(join(state, "herdr-app/notify/t2.claude.json"), payload("Edit"));
  writeFileSync(join(state, "herdr-app/notify/t1.claude.json"), payload("Old"));
  const records = await readRecords(["t1", "t2"]);
  expect(records.get("t2")?.payload.tool_name).toBe("Edit");
  expect(records.get("t1")?.payload.tool_name).toBe("Bash");
});
