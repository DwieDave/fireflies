// The agent graph's reads (claude.ts, reading.ts) and moves: a session read
// from a scratch ~/.claude by the real snapshot script (GNU or BSD stat), a
// transcript's steps and tokens, the poll on the kit's test layers (the
// cache, a read that can't run, another machine), an ask through hc.
// herdr is agent-graph-host.ts' one stand-in. Its own process: it stands in
// for herdr, gpui-kit and gpui-base.
import { test, expect, mock } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Option } from "effect";
import { agentsHerdr, agentsServices, newHost, runOn, shellExec, testFx } from "./agent-graph-host.ts";

const host = newHost({});
mock.module("herdr", () => agentsHerdr(host));
const el = (): any => new Proxy({}, { get: (_o, k) => (k === "then" ? undefined : () => el()) });
mock.module("gpui-kit", () => ({ View: class {}, div: el, svg: el, image: el, PathBuilder: { fill: el }, Background: { checkerboard: el } }));
mock.module("gpui-base", () => ({ h_flex: el, v_flex: el, v_virtual_list: el, VirtualListScrollHandle: { new: () => ({ scroll_to_bottom() {}, scroll_to_item() {} }) } }));
const claude = await import("../defaults/mods/agent-graph/claude.ts");
const reading = await import("../defaults/mods/agent-graph/reading.ts");
const navigate = await import("../defaults/mods/agent-graph/navigate.ts");
const { default: Agents } = await import("../defaults/mods/agent-graph/main.ts");

const line = (x: unknown) => `${JSON.stringify(x)}\n`;
const AGO = Date.now() / 1000 - 600; // ten minutes ago (s): quiet long enough to be done

/** A scratch ~/.claude with session s1: a subagent a1 that spawned a2, and a workflow run wf_1
 *  (its script's phases, its journal's agent b1 with a result, its end record). */
function scratchClaude(): { readonly home: string; readonly dir: string } {
  const home = mkdtempSync(join(tmpdir(), "ag-home-"));
  const project = join(home, ".claude/projects/-src-app");
  const dir = join(project, "s1");
  const subs = join(dir, "subagents");
  const wf = join(subs, "workflows/wf_1");

  mkdirSync(wf, { recursive: true });
  mkdirSync(join(dir, "workflows/scripts"), { recursive: true });
  mkdirSync(join(home, ".claude/sessions"), { recursive: true });
  writeFileSync(join(home, ".claude/sessions/4242.json"), JSON.stringify({ sessionId: "s1", name: "fix login", cwd: "/src/app" }));
  writeFileSync(join(project, "s1.jsonl"), line({ type: "user", timestamp: "2026-11-23T10:00:00.000Z", message: { content: "go" } })
    + line({ type: "progress", data: { taskType: "local_workflow", workflowName: "review", runId: "wf_1", summary: "a careful review" } }));
  writeFileSync(join(subs, "agent-a1.meta.json"), JSON.stringify({ description: "explore", agentType: "Explore", spawnDepth: 1, pickedEffortModel: "claude-opus-5-5" }));
  writeFileSync(join(subs, "agent-a1.jsonl"), line({ timestamp: "2026-11-23T10:01:00.000Z", type: "user", message: { content: "look around" } })
    + line({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu_2", name: "Task", input: { description: "dig" } }], stop_reason: "end_turn" } }));
  writeFileSync(join(subs, "agent-a2.meta.json"), JSON.stringify({ description: "dig", spawnDepth: 2, toolUseId: "tu_2" }));
  writeFileSync(join(subs, "agent-a2.jsonl"), line({ timestamp: "2026-11-23T10:02:00.000Z", type: "user", message: { content: "dig" } }));
  writeFileSync(join(wf, "agent-b1.meta.json"), JSON.stringify({ agentType: "workflow" }));
  writeFileSync(join(wf, "agent-b1.jsonl"), line({ timestamp: "2026-11-23T10:03:00.000Z", type: "user", message: { content: "check it" } }));
  writeFileSync(join(wf, "journal.jsonl"), line({ type: "started", agentId: "b1", label: "check", phase: "Build" }) + line({ type: "result", agentId: "b1" }) + '{"type":"star');
  writeFileSync(join(dir, "workflows/wf_1.json"), JSON.stringify({ status: "completed", startTime: 1 }));
  writeFileSync(join(dir, "workflows/scripts/review.js"), "export const meta = { phases: [{ title: 'Plan' }, { title: \"Build\" }], };");

  for (const f of ["agent-a1.jsonl", "agent-a2.jsonl", "workflows/wf_1/agent-b1.jsonl"]) utimesSync(join(subs, f), AGO, AGO);

  return { home, dir };
}

const realShell = (home: string) => shellExec(() => ({ ...process.env, HOME: home }));

/** The workflow scripts the snapshot reads, as the Files stand-in gives them. */
const scripts = (dir: string) => new Map([[join(dir, "workflows/scripts/review.js"), "phases: [{ title: 'Plan' }, { title: \"Build\" }], }"]]);

test("a session read by the snapshot script: agents under their parents, a workflow run's phases, agents and end", () => {
  const { home, dir } = scratchClaude();
  const s = agentsServices({ exec: realShell(home), files: scripts(dir) }, host);

  return runOn(s.layer, claude.snapshot("s1")).then((got) => {
    const d = Option.getOrThrow(got);
    const a = (id: string) => d.agents.get(id)!;

    expect(d.main).toBe(`${dir}.jsonl`);
    expect(d.mainStarted).toBe(Date.parse("2026-11-23T10:00:00.000Z"));
    // GNU or BSD stat, a real time either way.
    expect(Math.abs(a("a1").changed / 1000 - AGO)).toBeLessThan(2);
    expect([a("a1").parent, a("a1").label, a("a1").status, a("a1").model, a("a1").started]).toEqual(["main", "explore", "done", "claude-opus-5-5", Date.parse("2026-11-23T10:01:00.000Z")]);
    expect([a("a2").parent, a("a2").depth, a("a2").file]).toEqual(["a1", 2, `${dir}/subagents/agent-a2.jsonl`]);
    expect([a("b1").parent, a("b1").label, a("b1").phase, a("b1").status, a("b1").run]).toEqual(["wf_1", "check", "Build", "done", "wf_1"]);
    expect(d.runs).toEqual([{ id: "wf_1", name: "review", summary: "a careful review", phases: ["Plan", "Build"], agents: ["b1"], status: "completed",
      started: a("b1").started, ended: Math.max(a("b1").started, a("b1").changed) }]);
  });
});

test("no transcript for the session: none; a shell that can't run: an ExecError for the poll to say", () => {
  const { home } = scratchClaude();
  const none = agentsServices({ exec: realShell(home) }, host);
  const broken = agentsServices({ exec: () => { throw new Error("no shell"); } }, host);

  return runOn(none.layer, claude.snapshot("s9")).then((got) => {
    expect(Option.isNone(got)).toBe(true);

    return runOn(broken.layer, Effect.flip(claude.snapshot("s1")));
  }).then((e) => expect(e._tag).toBe("ExecError"));
});

test("a transcript's feed: the task, text, tool calls by what they do, results (errors marked), the model; a partial line left out", () => {
  const head = line({ type: "user", message: { content: [{ type: "text", text: "  fix the login  " }] } }).trimEnd();
  const tail = [
    line({ type: "assistant", message: { model: "claude-opus-5-5", content: [{ type: "thinking", thinking: "…" }, { type: "text", text: "On it." }] } }),
    line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la\nmore" } }, { type: "tool_use", name: "Read", input: {} }] } }),
    line({ type: "user", message: { content: [{ type: "tool_result", content: [{ text: "boom" }, { text: "again" }], is_error: true }, { type: "tool_result", content: null }] } }),
    '{"type":"assistant","mess',
  ].join("");
  const f = claude.readFeed(`${head}\n@@tail\n${tail}`);

  expect(f).toEqual({
    task: "fix the login",
    model: "claude-opus-5-5",
    items: [
      { kind: "text", text: "On it." },
      { kind: "tool", name: "Bash", text: "ls -la" },
      { kind: "tool", name: "Read", text: "" },
      { kind: "result", text: "boom again", error: true },
      { kind: "result", text: "", error: false },
    ],
  });
});

test("tokens per transcript: priced per model, a model without a price marked, a synthetic one free", () => {
  const u = claude.readUsage(["/a.jsonl\tclaude-opus-5-5\t1000000\t100000\t0\t0\t0", "/a.jsonl\tclaude-who\t10\t10\t0\t0\t0", "/a.jsonl\t<synthetic>\t5\t5\t0\t0\t0", "/b.jsonl\tx"].join("\n"), ["/a.jsonl", "/b.jsonl"]);

  expect(u.get("/a.jsonl")).toEqual({ input: 1000015, output: 100015, cache5m: 0, cache1h: 0, cacheRead: 0, tokens: 1100030, cost: 6, unpriced: true });
  expect(u.get("/b.jsonl")?.tokens).toBe(0);
  expect([claude.span(42_000), claude.span(252_000), claude.span(3_900_000), claude.count(4_123), claude.count(41_234), claude.count(2_310_000)]).toEqual(["42s", "4m 12s", "1h 05m", "4.1k", "41k", "2.31M"]);
});

/** The shown space: one Claude Code pane (terminal t1, its process 4242) in the shown tab. */
function showClaude(machine: string | null = null): void {
  host.spaces = [{ id: "sp1", active: true, machine, tabs: [{ id: "tab1", active: true, index: 0 }] }];
  host.panes = [{ pane: "p1", tab: "tab1", terminal: "t1", app: "claude-code", program: { name: "Claude Code" }, status: "working", cwd: "/src/app" }];
  host.terminals = [{ address: "t1", foreground: { pid: 4242 }, labels: { "nocturne.name": "login" } }];
  host.focused = null;
}

test("the poll: the shown Claude Code's session read and kept in the cache; the next copy starts from it, a read that can't run says so", () => {
  const { home, dir } = scratchClaude();
  const s = agentsServices({ exec: realShell(home), files: scripts(dir) }, host);
  const v: any = new Agents();

  showClaude();

  return runOn(s.layer, reading.pollOnce(v)).then(() => {
    expect(v.terminal).toBe("t1");
    expect(v.session).toEqual({ pid: 4242, id: "s1", name: "fix login", cwd: "/src/app" });
    expect([...v.data.agents.keys()].sort()).toEqual(["a1", "a2", "b1"]);
    expect(v.usage.has(v.data.main)).toBe(true);
    expect(v.error).toBe("");

    const kept: any = s.shared.store.get("agent-graph.cache");

    expect(kept.t1.session.id).toBe("s1");
    expect(kept.t1.data.agents.length).toBe(3);

    // The next copy, with no shell: the cache draws, the failure is said.
    const broken = agentsServices({ exec: () => { throw new Error("no shell"); } }, host, s.shared.store);
    const next: any = new Agents();

    return runOn(broken.layer, reading.pollOnce(next)).then(() => {
      expect(next.session.id).toBe("s1");
      expect(next.data.agents.size).toBe(3);
      expect(next.error).toBe("The session can't be read: no shell");
      expect(broken.redraws.n).toBeGreaterThan(0);
    });
  });
});

test("the poll: no Claude Code shown clears the graph; one on another machine says only this computer's can be read", () => {
  const s = agentsServices({}, host);
  const v: any = new Agents();

  v.data = { agents: new Map() };
  host.spaces = [];
  host.panes = [];

  return runOn(s.layer, reading.pollOnce(v)).then(() => {
    expect([v.data, v.session]).toEqual([null, null]);
    showClaude("box");

    return runOn(s.layer, reading.pollOnce(v));
  }).then(() => {
    expect(v.error).toContain("another machine");
    expect(s.exec.calls.length).toBe(0);
  });
});

test("ask: that Claude Code is asked in its own terminal through hc", () => {
  const s = agentsServices({}, host);
  const v: any = new Agents();

  v.fx = testFx(s.layer);
  showClaude();

  const run = { id: "wf_1", name: "review" };

  navigate.askAgent(v, { kind: "run", key: "wf_1", run, label: "review" } as any, { terminal: "t1" } as any);
  navigate.askAgent(v, { kind: "agent", key: "a1", label: "explore" } as any, { terminal: "t1" } as any);

  expect(s.hc.calls).toEqual([
    ["send", "t1", "How is the workflow run review (wf_1) doing? Brief status, anything blocked or worth my attention."],
    ["send", "t1", 'How is the subagent "explore" (a1) doing? Brief status, anything blocked or worth my attention.'],
  ]);
});
