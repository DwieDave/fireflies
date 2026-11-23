// The notifications engine on the kit's test layers (notifications-host.ts):
// what it reads (terminals, agents, hook records, screens) and what it keeps
// in shared notifications.items.
import { test, expect, mock } from "bun:test";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { Exec } from "@fireflies/kit";
import { newHost, notificationsHerdr, notificationsServices, runOn } from "./notifications-host.ts";

const host = newHost({});
mock.module("herdr", () => notificationsHerdr(host));
const engine = await import("../defaults/mods/notifications/engine.ts");

const screens: Record<string, string> = {};
const readScreens = (args: readonly string[]) =>
  args[0] === "read" && args[1] !== undefined && args[1] in screens ? { code: 0, stdout: screens[args[1]] ?? "", stderr: "" } : { code: 1, stdout: "", stderr: "no such terminal" };
const places = () => [{ address: "t1", space: "s1", space_name: "fireflies", tab: "tab1", tab_name: "1", tab_index: 1, app: "claude", program: { name: "Claude Code" } }];

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

test("a machine whose records can't be read gives none, and the read goes on (no failure)", () => {
  const s = notificationsServices({
    exec: () => {
      throw new Error("the machine is unreachable");
    },
  });
  return runOn(s.layer, Effect.gen(function* () {
    const got = yield* engine.readRecords(["box/t1", "t2"]);
    expect(got.size).toBe(0);
    expect(s.exec.calls.map((c) => c.options?.on ?? null)).toEqual(["box", null]);
  }));
});

test("refresh: a blocked agent's request, from its screen and its hook record, into shared notifications.items", () => {
  screens.t1 = bash;
  const s = notificationsServices({
    hc: readScreens, agents: places,
    exec: () => ({ code: 0, stdout: record("t1", 5, { tool_name: "Bash", tool_input: { command: "ls -la", description: "list" } }), stderr: "" }),
    terminals: () => [blocked, { address: "t9", status: "working" }, "not a terminal"],
  });
  const e = new engine.Engine();
  return runOn(s.layer, Effect.gen(function* () {
    expect(yield* e.refresh).toBe(true);
    const items: any[] = s.shared.store.get("notifications.items") as any;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ address: "t1", type: "permission", answerable: true, spaceName: "fireflies", request: { tool: "Bash", line: "ls -la", description: "list", from: "hook" } });
    // Nothing changed: nothing written again.
    expect(yield* e.refresh).toBe(false);
  }));
});

test("refresh: a screen that can't be read is no request (the generic item), not a failure", () => {
  delete screens.t1;
  const s = notificationsServices({ hc: readScreens, agents: places, exec: () => ({ code: 0, stdout: "", stderr: "" }), terminals: () => [blocked] });
  return runOn(s.layer, Effect.gen(function* () {
    yield* new engine.Engine().refresh;
    expect(s.shared.store.get("notifications.items")).toMatchObject([{ address: "t1", type: "other", request: null, tail: null, answerable: false }]);
  }));
});

test("items another version wrote in another shape are left out one by one; put-away errors are kept by id", () => {
  host.shared["notifications.items"] = [{ id: "x" }, "nonsense"];
  expect(engine.items()).toEqual([]);
  engine.dismiss("e1");
  expect(host.shared["notifications.dismissed"]).toEqual({ e1: true });
  host.shared["notifications.dismissed"] = { e0: "not true", e2: true };
  engine.dismiss("e3");
  expect(host.shared["notifications.dismissed"]).toEqual({ e2: true, e3: true });
});

test("refresh while a read is still going returns at once (one read at a time)", () => {
  screens.t1 = bash;
  const s = notificationsServices({ hc: readScreens, agents: places, terminals: () => [blocked] });
  const e = new engine.Engine();
  return Effect.runPromise(Effect.gen(function* () {
    const held = yield* Deferred.make<void>();
    // The hook records' read waits until the test lets it go.
    const exec = Layer.succeed(Exec, Exec.of({ run: () => Effect.as(Deferred.await(held), { code: 0, stdout: "", stderr: "" }) }));
    const layer = Layer.merge(s.layer, exec);
    const first = yield* Effect.forkChild(Effect.provide(e.refresh, layer));
    while (!e.busy) yield* Effect.yieldNow;
    expect(yield* Effect.provide(e.refresh, layer)).toBe(false);
    yield* Deferred.succeed(held, undefined);
    expect(yield* Fiber.join(first)).toBe(true);
    expect(e.busy).toBe(false);
  }));
});
