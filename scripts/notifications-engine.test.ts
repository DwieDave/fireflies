// The notifications engine on the kit's test layers (no module mocks): what
// it reads (terminals, hook records, screens) and what it keeps in shared
// notifications.items. hc and agents() come from a herdr stand-in (importMod)
// until the kit has a service for them.
import { test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { execTest, sharedTest, workspaceTest } from "@fireflies/kit/testing";
import { importMod } from "./mod-source.ts";

const screens: Record<string, string> = {};
const herdr = {
  hc: async (args: string[]) => (args[0] === "read" && args[1] !== undefined && args[1] in screens ? { code: 0, stdout: screens[args[1]], stderr: "" } : { code: 1, stdout: "", stderr: "no such terminal" }),
  agents: () => [{ address: "t1", space: "s1", space_name: "fireflies", tab: "tab1", tab_name: "1", tab_index: 1, app: "claude", program: { name: "Claude Code" } }],
};
const engine = await importMod("notifications/engine.ts", { herdr });

const rule = "─".repeat(80);
const bash = [rule, " Bash command", " ls -la", " Do you want to proceed?", " ❯ 1. Yes", "   2. No", "", " Esc to cancel · Tab to amend"].join("\n");
const blocked = { address: "t1", state: "running", status: "blocked", status_ms: 1000, report: { app: "claude" }, labels: { "herdr.space": "s1" } };

const record = (id: string, at: number, payload: unknown) => `\n@@record ${id} ${at}\n${JSON.stringify(payload)}`;

test("hook records: each id's payload decoded, a half-written one left for next time", () => {
  const out = engine.parseRecords(
    record("t1", 5, { tool_name: "Bash", tool_input: { command: "ls -la" } }) + `\n@@record t2 6\n{"tool_name": "Ba`,
    "box",
  );
  expect([...out.keys()]).toEqual(["box/t1"]);
  expect(out.get("box/t1")).toEqual({ at: 5000, payload: { tool_name: "Bash", tool_input: { command: "ls -la" } } });
});

test("a machine whose records can't be read gives none, and the read goes on (no failure)", async () => {
  const exec = execTest(() => {
    throw new Error("the machine is unreachable");
  });
  const got = await Effect.runPromise(Effect.provide(engine.readRecords(["box/t1", "t2"]), exec.layer));
  expect(got.size).toBe(0);
  expect(exec.calls.map((c) => c.options?.on ?? null)).toEqual(["box", null]);
});

test("refresh: a blocked agent's request, from its screen and its hook record, into shared notifications.items", async () => {
  screens.t1 = bash;
  const shared = sharedTest();
  const exec = execTest(() => ({ code: 0, stdout: record("t1", 5, { tool_name: "Bash", tool_input: { command: "ls -la", description: "list" } }), stderr: "" }));
  const layer = Layer.mergeAll(shared.layer, exec.layer, workspaceTest({ terminals: () => [blocked, { address: "t9", status: "working" }, "not a terminal"] }).layer);
  const e = new engine.Engine();
  expect(await Effect.runPromise(Effect.provide(e.refresh, layer))).toBe(true);
  const items: any[] = shared.store.get("notifications.items") as any;
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ address: "t1", type: "permission", answerable: true, spaceName: "fireflies", request: { tool: "Bash", line: "ls -la", description: "list", from: "hook" } });
  // Nothing changed: nothing written again.
  expect(await Effect.runPromise(Effect.provide(e.refresh, layer))).toBe(false);
});

test("refresh: a screen that can't be read is no request (the generic item), not a failure", async () => {
  delete screens.t1;
  const shared = sharedTest();
  const layer = Layer.mergeAll(shared.layer, execTest(() => ({ code: 0, stdout: "", stderr: "" })).layer, workspaceTest({ terminals: () => [blocked] }).layer);
  await Effect.runPromise(Effect.provide(new engine.Engine().refresh, layer));
  expect(shared.store.get("notifications.items")).toMatchObject([{ address: "t1", type: "other", request: null, tail: null, answerable: false }]);
});

test("refresh while a read is still going returns at once (one read at a time)", async () => {
  screens.t1 = bash;
  let release: () => void = () => {};
  const exec = execTest(() => new Promise((resolve) => { release = () => resolve({ code: 0, stdout: "", stderr: "" }); }));
  const layer = Layer.mergeAll(sharedTest().layer, exec.layer, workspaceTest({ terminals: () => [blocked] }).layer);
  const e = new engine.Engine();
  const first = Effect.runPromise(Effect.provide(e.refresh, layer));
  await Bun.sleep(5);
  expect(await Effect.runPromise(Effect.provide(e.refresh, layer))).toBe(false);
  release();
  expect(await first).toBe(true);
  expect(e.busy).toBe(false);
});
