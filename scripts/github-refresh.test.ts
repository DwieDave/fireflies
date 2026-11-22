// The GitHub window keeps itself current (github/main.ts, window-reads.ts,
// actions.ts, dispatchForm.ts): an opening shows the cache at once and reads
// GitHub behind it; a workflow started by hand, a re-run or a cancel is followed
// by reads with a short backoff until GitHub shows it, within a bound; a moving
// run is read every few seconds; a closed window reads nothing.
//
// The whole window runs here against a fake gh and git on a virtual clock:
// every command takes a little (virtual) time, as gh does. The cx stand-in is
// the engine's: a handler's cx is refused once its call has returned ("cx is no
// longer valid"), while the cx a spawn or timer hands over stays good. Nothing
// is sent to GitHub. Its own process: it stands in for "herdr".
import { test, expect, mock, beforeEach } from "bun:test";

// ---- the virtual clock

let now = 1_800_000_000_000;
Date.now = () => now;

interface Timer { at: number; f: () => void; every: number; dead: boolean }
let timers: Timer[] = [];
const later = (ms: number, f: () => void, every = 0): Timer => {
  const t = { at: now + ms, f, every, dead: false };
  timers.push(t);
  return t;
};
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

/** Moves the clock on by `ms`, running what falls due on the way. */
async function advance(ms: number) {
  const end = now + ms;
  for (;;) {
    await flush();
    timers = timers.filter((t) => !t.dead);
    const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    now = Math.max(now, due.at);
    if (due.every) due.at = now + due.every;
    else due.dead = true;
    due.f();
  }
  now = end;
  await flush();
}

// ---- cx as the engine hands it out

const errors: unknown[] = [];
let live = 0; // the handler call running now (0: none)
let calls = 0;

function makeCx(gen: number | null): any {
  const check = (what: string) => {
    if (gen !== null && gen !== live) throw new Error(`cx is no longer valid (${what}): it was captured during an earlier call and used later`);
  };
  const c: any = {
    spawn(body: (cx: any) => unknown) {
      check("spawn");
      Promise.resolve().then(() => body(asyncCx)).catch((e) => errors.push(e)); // the engine reports a rejection
      return { cancel() {}, is_done: () => false };
    },
    notify() { check("notify"); },
    stop_propagation() { check("stop_propagation"); },
    open_url() { check("open_url"); },
    focus_handle: () => ({ focus() {}, is_focused: () => false, release: () => true }),
    bind_keys() {},
    timer: {
      after(ms: number, f: (cx: any) => void) { check("timer.after"); const t = later(ms, () => f(asyncCx)); return { cancel() { t.dead = true; }, is_done: () => t.dead }; },
      every(ms: number, f: (cx: any) => void) { check("timer.every"); const t = later(ms, () => f(asyncCx), ms); return { cancel() { t.dead = true; }, is_done: () => t.dead }; },
    },
  };
  return c;
}
const asyncCx = makeCx(null);

/** A handler call: its cx is good until it returns. */
function call<T>(fn: (cx: any) => T): T {
  live = ++calls;
  try {
    return fn(makeCx(live));
  } finally {
    live = 0;
  }
}

// ---- GitHub and git, faked

const b64 = (s: string) => Buffer.from(s).toString("base64");
const DEPLOY = "name: Deploy\non:\n  workflow_dispatch:\njobs: {}\n";

interface World {
  runs: any[]; // what GitHub lists, newest first
  log: { at: number; args: string[] }[]; // every gh call
  writes: string[][];
  listDispatch: number | null; // ms after a dispatch before GitHub lists its run (null: never)
  rerunShows: number; // ms after a re-run before GitHub shows it queued
  cancelShows: number;
}
let world: World;
const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
const etagOf = (s: string) => `"${Bun.hash(s).toString(16)}"`;

function answer(args: string[], body: unknown) {
  const text = JSON.stringify(body);
  const tag = etagOf(text);
  const asked = args.find((a) => a.startsWith("If-None-Match: "))?.slice(15);
  return asked === tag ? ok(`HTTP/2.0 304 Not Modified\r\nEtag: ${tag}\r\n\r\n`) : ok(`HTTP/2.0 200 OK\r\nEtag: ${tag}\r\n\r\n${text}`);
}

const iso = (t: number) => new Date(t).toISOString();
const run = (id: number, status: string, conclusion: string | null, extra: any = {}) => ({
  id, run_number: id, name: "CI", status, conclusion, event: "push", head_branch: "main", path: ".github/workflows/ci.yml", head_sha: "abc", created_at: iso(now - 3600_000), ...extra,
});
const setRun = (id: number, patch: any) => { world.runs = world.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)); };

function gh(args: string[]) {
  world.log.push({ at: now, args });
  const a = args.join(" ");
  if (args[0] === "repo" && args[1] === "view") return ok(JSON.stringify({ nameWithOwner: "me/app", url: "https://github.com/me/app", isFork: false, defaultBranchRef: { name: "main" } }));
  if (args[0] === "workflow" && args[1] === "list") return ok(JSON.stringify([{ id: 1, name: "Deploy", path: ".github/workflows/deploy.yml", state: "active" }]));
  if (args[0] === "workflow" && args[1] === "run") {
    world.writes.push(["gh", ...args]);
    if (world.listDispatch !== null) later(world.listDispatch, () => { world.runs = [run(900, "queued", null, { name: "Deploy", event: "workflow_dispatch", created_at: iso(now), path: ".github/workflows/deploy.yml" }), ...world.runs]; });
    return ok("");
  }
  if (args[0] === "run" && args[1] === "rerun") {
    world.writes.push(["gh", ...args]);
    const id = Number(args[2]);
    later(world.rerunShows, () => setRun(id, { status: "queued", conclusion: null }));
    later(world.rerunShows + 15000, () => setRun(id, { status: "in_progress" }));
    later(world.rerunShows + 30000, () => setRun(id, { status: "completed", conclusion: "success" }));
    return ok("");
  }
  if (args[0] === "run" && args[1] === "cancel") {
    world.writes.push(["gh", ...args]);
    later(world.cancelShows, () => setRun(Number(args[2]), { status: "completed", conclusion: "cancelled" }));
    return ok("");
  }
  if (args[0] === "api" && args[1] === "graphql") return ok(JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } }));
  if (args[0] === "api") {
    const path = args[args.length - 1] ?? "";
    if (path.startsWith("repos/me/app/actions/workflows/1/runs")) return answer(args, { workflow_runs: world.runs.filter((r) => r.event === "workflow_dispatch") });
    if (/^repos\/me\/app\/actions\/runs\/\d+\/jobs/.test(path)) return answer(args, { jobs: [] });
    if (path.startsWith("repos/me/app/actions/runs?")) return answer(args, { workflow_runs: world.runs });
    if (path.startsWith("repos/me/app/branches")) return answer(args, [{ name: "main" }]);
    if (path.startsWith("repos/me/app/tags")) return answer(args, []);
    if (path.includes("contents/.github/workflows/deploy.yml")) return answer(args, { content: b64(DEPLOY) });
    return ok(`HTTP/2.0 404 Not Found\r\n\r\n${JSON.stringify({ message: "Not Found" })}`);
  }
  return { code: 1, stdout: "", stderr: `no fake for gh ${a}` };
}

function git(args: string[]) {
  const a = args.join(" ");
  if (a === "rev-parse --show-toplevel") return ok("/src/app\n");
  if (a.startsWith("config --get-regexp")) return ok("remote.origin.url git@github.com:me/app.git\nbranch.main.remote origin\n");
  if (a === "branch --show-current") return ok("main\n");
  return { code: 1, stdout: "", stderr: "" };
}

// How long each command takes (virtual ms): gh's reads are slower than its repo view.
const took = (cmd: string, args: string[]) => (cmd === "git" ? 20 : args[0] === "repo" ? 200 : args[0] === "api" ? 600 : 400);

let sharedState: Record<string, unknown> = {};
const files = new Map<string, string>();
mock.module("herdr", () => ({
  agents: () => [], appHome: () => "/home/me/.config/herdr-app", home: () => "/home/me",
  closeOverlay: () => null, openOverlay: () => "o9",
  exec: (cmd: string, args: string[]) => new Promise((done) => { later(took(cmd, args), () => done(cmd === "git" ? git(args) : gh(args))); }),
  focused: () => null, hc: async () => ({ code: 1, stdout: "" }), keys: () => [], layout: () => null,
  nextCommand: () => new Promise(() => {}), notify: () => null, panes: () => [], props: () => null,
  readTextFile: async (p: string) => files.get(p) ?? null,
  writeTextFile: async (p: string, text: string) => { files.set(p, text); },
  run: () => null, settings: () => ({ zoom: 1 }), shared: (k: string) => sharedState[k] ?? null, setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  spaces: () => [], terminals: () => [], theme: () => theme, window: () => ({ platform: "linux" }),
}));
const el: any = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined : k === "when" ? (on: unknown, add: (e: unknown) => unknown) => (on ? add(el) : el) : k === "map" ? (f: (e: unknown) => unknown) => f(el) : () => el),
  apply: () => el,
});
class View {}
mock.module("gpui-kit", () => ({ View, div: () => el, svg: () => el, image: () => el, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
const handle = () => ({ scroll_to_item() {}, offset: () => ({ x: 0, y: 0 }), release: () => true });
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} release() { return true; } set_auto_grow() {} }
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, TextView: { markdown: () => el }, v_virtual_list: () => el,
  ScrollHandle: { new: handle }, VirtualListScrollHandle: { new: handle },
  InputState: { new: () => new Input() }, Input: { new: () => el }, TextareaState: { new: () => new Input() }, Textarea: { new: () => el },
}));
(globalThis as any).window = { paint_path: () => el };
(globalThis as any).localStorage = { getItem: () => null, setItem() {} };
const theme: any = new Proxy({}, { get: (_t, k) => (String(k).startsWith("ansi") ? "#808080" : "#c0c0c0") });

const { default: GitHub } = await import("../defaults/mods/github/main.ts");

// ---- helpers

const PROPS = { folder: "/src/app", overlay: "w1", tab: "actions" };

const windows: any[] = [];

function open(props: any = PROPS): any {
  const g: any = new GitHub();
  windows.push(g);
  g.init(props, asyncCx); // init's cx is an AsyncContext
  g.render();
  return g;
}

const key = (k: string) => ({ key: k, key_char: k.length === 1 ? k : undefined, modifiers: {} });
const press = (g: any, k: string) => call((cx) => g.key(key(k), cx));
const ids = (g: any) => g.actions.list().map((r: any) => r.id);
const statusOf = (g: any, id: number) => g.actions.list().find((r: any) => r.id === id)?.status;
const listReads = (from = 0, to = Infinity) => world.log.filter((l) => l.at >= from && l.at < to && (l.args.at(-1) ?? "").startsWith("repos/me/app/actions/runs?")).length;
const waitReads = (from = 0, to = Infinity) => world.log.filter((l) => l.at >= from && l.at < to && (l.args.at(-1) ?? "").startsWith("repos/me/app/actions/workflows/1/runs")).length;

async function close(g: any) {
  await g.close();
  await advance(50);
}

beforeEach(() => {
  for (const w of windows.splice(0)) w.closed = true; // a failed test's window reads no more
  timers = [];
  world = { runs: [run(1, "completed", "failure")], log: [], writes: [], listDispatch: 5000, rerunShows: 3000, cancelShows: 2000 };
  sharedState = {};
  errors.length = 0;
});

// ---- opening

test("an opening shows the cache at once, then GitHub's rows read behind it", async () => {
  const first = open();
  await advance(3000);
  expect(ids(first)).toEqual([1]);
  await close(first); // what it read goes to the cache

  // Meanwhile, on GitHub: a new run, finished (nothing moving, so no fast reads).
  world.runs = [run(2, "completed", "success", { created_at: iso(now) }), ...world.runs];
  const t0 = now;
  const g = open();
  expect(ids(g)).toEqual([1]); // the cache, in the first frame
  expect(g.state).toBe("ready");

  // The folder's repo is asked for while the rows are read; its answer comes
  // first and must not drop the rows.
  await advance(2000);
  expect(ids(g)).toEqual([2, 1]);
  expect(listReads(t0)).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
  await close(g);
});

test("an opening without a cache finds the repo, then reads it", async () => {
  files.clear();
  const g = open({ ...PROPS, folder: "/src/app" });
  await advance(2500);
  expect(g.state).toBe("ready");
  expect(ids(g)).toEqual([1]);
  await close(g);
});

// ---- running a workflow by hand

/** The window on the Actions tab with the dispatch form open and its workflow chosen. */
async function dispatchForm() {
  const g = open();
  await advance(3000);
  call((cx) => g.actions.runWorkflow(cx));
  await advance(3000);
  const form = g.actions.form;
  expect(form.value("workflow")).toBe(".github/workflows/deploy.yml");
  expect(form.value("ref")).toBe("main");
  return { g, form };
}

test("a workflow started by hand: reads with a backoff until GitHub lists its run, which is selected", async () => {
  const { g, form } = await dispatchForm();
  call((cx) => form.send(cx)); // y on the form's last step: the handler returns at once
  const t0 = now;
  await advance(1000);
  expect(world.writes).toEqual([["gh", "workflow", "run", "deploy.yml", "--ref", "main", "-R", "me/app"]]);
  expect(g.actions.waiting).not.toBeNull();

  // GitHub lists the run 5 s after the dispatch.
  await advance(9000);
  expect(g.actions.waiting).toBeNull();
  expect(g.actions.sel).toBe(900);
  expect(ids(g)).toContain(900);
  expect(statusOf(g, 900)).toBe("queued");
  expect(errors).toEqual([]);

  // A short backoff, not a read every tick: a handful of reads to find it.
  const n = waitReads(t0);
  expect(n).toBeGreaterThanOrEqual(2);
  expect(n).toBeLessThanOrEqual(6);
  // Found: the waiting reads stop; the queued run keeps the list read every few seconds.
  const t1 = now;
  await advance(30000);
  expect(waitReads(t1)).toBe(0);
  expect(listReads(t1)).toBeGreaterThanOrEqual(5);
  await close(g);
});

test("a run GitHub never lists: the reads back off and stop at the bound, and the bar says so", async () => {
  world.listDispatch = null;
  const { g, form } = await dispatchForm();
  call((cx) => form.send(cx));
  const t0 = now;
  await advance(125000);
  expect(g.actions.waiting).toBeNull();
  const n = waitReads(t0);
  expect(n).toBeGreaterThanOrEqual(5);
  expect(n).toBeLessThanOrEqual(20); // a fixed 2 s pace would be 60
  const t1 = now;
  await advance(60000);
  expect(waitReads(t1)).toBe(0);
  expect(errors).toEqual([]);
  await close(g);
});

test("closing the window while it waits for a dispatched run stops the reads", async () => {
  world.listDispatch = null;
  const { g, form } = await dispatchForm();
  call((cx) => form.send(cx));
  await advance(4000);
  await close(g);
  const t0 = now;
  await advance(120000);
  expect(world.log.filter((l) => l.at >= t0).length).toBe(0);
});

// ---- re-run and cancel

test("a re-run is read again with a backoff until GitHub shows it queued, then at the running pace, then slowly", async () => {
  const g = open();
  await advance(3000);
  expect(statusOf(g, 1)).toBe("completed");
  press(g, "R");
  expect(g.confirm?.text).toContain("Re-run the failed jobs");
  press(g, "y"); // a later key: the R's cx is gone by now
  const t0 = now;
  await advance(1000);
  expect(world.writes).toEqual([["gh", "run", "rerun", "1", "--failed", "-R", "me/app"]]);

  // GitHub shows the re-run 3 s after it took it; the window within a few seconds of that.
  await advance(6000);
  expect(statusOf(g, 1)).toBe("queued");
  expect(errors).toEqual([]);
  expect(listReads(t0, now)).toBeLessThanOrEqual(6);

  // Moving (in progress 15 s on), finished (30 s on): then a read a minute.
  await advance(40000);
  expect(statusOf(g, 1)).toBe("completed");
  const t1 = now;
  await advance(50000);
  expect(listReads(t1)).toBeLessThanOrEqual(1);
  await close(g);
});

test("a cancel is read again until GitHub shows the run stopped", async () => {
  world.runs = [run(1, "in_progress", null)];
  world.cancelShows = 8000;
  const g = open();
  await advance(3000);
  press(g, "X");
  call((cx) => g.confirm.go(cx));
  await advance(12000);
  expect(world.writes).toEqual([["gh", "run", "cancel", "1", "-R", "me/app"]]);
  expect(statusOf(g, 1)).toBe("completed");
  expect(errors).toEqual([]);
  await close(g);
});

test("a re-run GitHub never shows: the extra reads stop at the bound", async () => {
  world.rerunShows = 10_000_000;
  const g = open();
  await advance(3000);
  press(g, "R");
  press(g, "y");
  await advance(70000);
  const t1 = now;
  await advance(55000);
  expect(listReads(t1)).toBeLessThanOrEqual(1); // back to a read a minute
  await close(g);
});

// ---- the running pace and closing

test("a moving run is read every few seconds; a closed window reads nothing", async () => {
  world.runs = [run(1, "in_progress", null)];
  const g = open();
  await advance(3000);
  const t0 = now;
  await advance(15000);
  expect(listReads(t0)).toBeGreaterThanOrEqual(3);
  await close(g);
  const t1 = now;
  await advance(60000);
  expect(world.log.filter((l) => l.at >= t1).length).toBe(0);
});
