// The agent graph's views by layout (docs/plain-look.md): in nocturne the
// dithered, square chrome, drawn as before the Effect conversion (the trees
// recorded at integrate, then with the node menu's handlers added: a node's
// right-click, the view's bounds, the closed menu's `when(false)`, and `m` in
// the ? list, nothing else; each state's hash in
// scripts/agent-graph-look.nocturne.json); in
// herdr-app's default layout (main) no checker anywhere, rounded cards and
// rows, dots for pips. Elements are recorders (every call kept); herdr is
// agent-graph-host.ts' one stand-in. Its own process: it stands in for herdr,
// gpui-kit and gpui-base.
//
// AG_MOD=<folder> AG_RECORD=<file> draws another copy of the mod (the one at
// integrate) and writes its nocturne trees to <file> instead of comparing (to
// see what changed: record both copies and diff them).
import { test, expect, mock, setSystemTime } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { agentsHerdr, newHost } from "./agent-graph-host.ts";

type Rec = { kind: string; calls: [string, unknown[]][] };
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && "calls" in v && "kind" in v;
const make = (kind: string) => (...a: unknown[]): any => {
  const rec: Rec = { kind: a.length ? `${kind}(${JSON.stringify(a.map((x) => (isRec(x) ? x.kind : typeof x === "function" ? "fn" : x)))})` : kind, calls: [] };
  const el: any = new Proxy(rec, { get: (o, k) => (k === "calls" || k === "kind" ? (o as any)[k] : k === "then" ? undefined : (...args: unknown[]) => {
    o.calls.push([String(k), args]);
    if (k === "when" && args[0]) return (args[1] as (e: unknown) => unknown)(el);
    return el;
  }) });
  return el;
};

/** Every element and call of a drawn tree, as "kind" and "method(args)" strings. */
const calls = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) { for (const x of v) calls(x, out); return out; }
  if (!isRec(v)) return out;
  out.push(v.kind);
  for (const [k, a] of v.calls) { out.push(`${k}(${JSON.stringify(a.filter((x) => typeof x !== "object" && typeof x !== "function"))})`); calls(a, out); }
  return out;
};

const ROOT = `${import.meta.dir}/..`;
const MOD = process.env.AG_MOD ?? `${ROOT}/defaults/mods/agent-graph`;
const layouts: Record<string, unknown> = { nocturne: JSON.parse(readFileSync(`${ROOT}/defaults/layouts/nocturne.json`, "utf8")), main: JSON.parse(readFileSync(`${ROOT}/defaults/layouts/main.json`, "utf8")) };
const theme: any = new Proxy({ background: "#080808", foreground: "#c6c6c6", accent: "#80a0ff", muted: "#949494", dim: "#5F6D6D", border: "#323437", input: "#323437", popover: "#101010", raised: "#181818", selected: "#1c1c1c", hover: "#1c1c1c", canvas: "#050505", done: "#00ff00", blocked: "#ff0000", working: "#ffff00" }, { get: (o: any, k) => o[k] ?? "#808080" });
const host = newHost(theme);
let looks = 0;
/** Draws from here on in `name`'s look (a new layout name: the look library reads it again). */
const use = (name: string) => { host.layout = layouts[name]; looks += 1; host.layoutName = `${name}-${looks}`; };

const win: any = { paint_path: make("paint_path"), viewport_size: () => ({ width: 1200, height: 800 }) };
(globalThis as any).window = win;
// The copy at integrate imports what it called the app with (never called while drawing).
mock.module("herdr", () => ({ ...agentsHerdr(host), exec: () => null, hc: () => null, readTextFile: () => null, home: () => "/h", nextCommand: () => null }));
mock.module("gpui-kit", () => ({ View: class {}, div: make("div"), svg: make("svg"), image: make("image"), PathBuilder: { fill: () => ({ move_to: () => ({ line_to: () => ({ line_to: () => ({ line_to: () => ({ close: () => ({ build: () => "rect" }) }) }) }) }) }) }, Background: { checkerboard: (c: string, n: number) => `checker(${c},${n})` } }));
mock.module("gpui-base", () => ({
  h_flex: make("h_flex"), v_flex: make("v_flex"),
  // The feed's rows drawn as the list would draw them all.
  v_virtual_list: (id: string, n: number, _h: unknown, _k: unknown, rows: (r: { start: number; end: number }) => unknown[]) => make("v_virtual_list")(id, n).children(rows({ start: 0, end: n })),
  VirtualListScrollHandle: { new: () => ({ scroll_to_bottom() {}, scroll_to_item() {} }) },
}));

const NOW = Date.parse("2026-11-23T12:00:00.000Z");
setSystemTime(new Date(NOW));
const { default: Agents } = await import(`${MOD}/main.ts`);

const agent = (id: string, x: Record<string, unknown>) => ({
  id, run: null, file: `/d/s1/subagents/agent-${id}.jsonl`, changed: NOW - 60_000, started: NOW - 300_000, rel: `agent-${id}.jsonl`, label: id, type: "Explore",
  depth: 1, toolUseId: null, phase: null, model: "claude-opus-5-5", background: false, status: "done", parent: "main", ...x,
});
const agents = new Map(Object.entries({
  a1: agent("a1", { label: "explore the code", status: "working" }),
  a2: agent("a2", { label: "dig", parent: "a1", depth: 2 }),
  b1: agent("b1", { run: "wf_1", parent: "wf_1", label: "plan it", phase: "Plan", type: "workflow" }),
  b2: agent("b2", { run: "wf_1", parent: "wf_1", label: "build it", phase: "Build", status: "working", started: NOW - 100_000 }),
}));
const runs = [{ id: "wf_1", name: "review", summary: "a careful review", phases: ["Plan", "Build", "Ship"], agents: ["b1", "b2"], status: "running", started: NOW - 300_000, ended: null }];
const data = { dir: "/d/s1", main: "/d/s1.jsonl", mainChanged: NOW - 5000, mainStarted: NOW - 3_600_000, agents, runs };
const usage = new Map<string, any>([["/d/s1.jsonl", { input: 1000, output: 200, cache5m: 0, cache1h: 0, cacheRead: 5000, tokens: 6200, cost: 0.12, unpriced: false }], ["/d/s1/subagents/agent-a1.jsonl", { input: 50_000, output: 1000, cache5m: 0, cache1h: 0, cacheRead: 0, tokens: 51_000, cost: 0.4, unpriced: true }]]);
const feed = { task: "explore the code and report", model: "claude-opus-5-5", items: [{ kind: "text", text: "Looking." }, { kind: "tool", name: "Bash", text: "ls" }, { kind: "result", text: "", error: false }, { kind: "result", text: "boom", error: true }, { kind: "prompt", text: "go on" }] };

host.spaces = [{ id: "sp1", active: true, machine: null, tabs: [{ id: "tab1", active: true, index: 0 }] }];
host.panes = [{ pane: "p1", tab: "tab1", terminal: "t1", app: "claude-code", program: { name: "Claude Code" }, status: "working", cwd: "/src/app" }, { pane: "p2", tab: "tab1", terminal: "t2", app: "claude-code", program: { name: "Claude Code" }, status: null, cwd: "/src/b" }];
host.terminals = [{ address: "t1", foreground: { pid: 1 }, labels: { "nocturne.name": "login" } }, { address: "t2" }];

/** A copy showing t1 in `state`. */
function view(state: Record<string, unknown>): any {
  const v: any = new Agents();
  Object.assign(v, { terminal: "t1", pinned: true, session: { pid: 1, id: "s1", name: "fix login", cwd: "/src/app" }, data, usage, open: new Set(), now: NOW }, state);
  return v;
}

/** The states drawn, by name. */
const STATES: Record<string, () => any> = {
  none: () => { const v = view({}); v.terminal = "t9"; host.panes = []; return v; },
  reading: () => view({ data: null }),
  error: () => view({ data: null, error: "No transcript for this session yet." }),
  graph: () => view({}),
  agent: () => view({ selected: "a1", detail: feed, follow: true }),
  feedless: () => view({ selected: "main", detail: null, follow: false, detailH: 200 }),
  run: () => view({ selected: "wf_1" }),
  phase: () => view({ selected: "wf_1/Build" }),
  stats: () => view({ selected: "@stats" }),
  help: () => view({ help: true }),
  moved: () => view({ zoom: 0.7, pan: { x: 40, y: -20 }, drag: { x: 1, y: 1, from: { x: 0, y: 0 } }, resizing: { y: 1, from: 200 } }),
  folded: () => view({ open: new Set(["-wf_1"]), zoom: 1.4 }),
};

/** Draws every state in the shown look: name -> its tree. */
function drawAll(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, state] of Object.entries(STATES)) {
    const panes = host.panes;
    const v = state();
    out[name] = calls(v.render());
    host.panes = panes;
  }
  return out;
}

const RECORDED = `${import.meta.dir}/agent-graph-look.nocturne.json`;

test("nocturne: every state draws as at integrate (the element trees recorded there)", () => {
  use("nocturne");
  const now = drawAll();
  if (process.env.AG_RECORD !== undefined) { writeFileSync(process.env.AG_RECORD, JSON.stringify(now, null, 1)); return; }
  const before: Record<string, string> = JSON.parse(readFileSync(RECORDED, "utf8"));
  const hash = (tree: string[]) => createHash("sha256").update(tree.join("\n")).digest("hex").slice(0, 16);
  for (const name of Object.keys(STATES)) expect([name, hash(now[name] ?? [])]).toEqual([name, before[name]]);
});
