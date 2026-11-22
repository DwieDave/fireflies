// The git window on a large change set (600 changed files in folders, a
// 4000-line diff). Scrolling (Developer: "Scrolling changes is choppy"): a
// step redraws only the rows in view and recomputes nothing per draw that its
// data didn't change; counts work (syntax highlight calls, app calls, file
// tree builds, git runs) rather than wall time. A range selection over all of
// a folder's files highlights the folder too.
import { test, expect, mock, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Ada Lovelace", GIT_AUTHOR_EMAIL: "a@x", GIT_COMMITTER_NAME: "Ada Lovelace", GIT_COMMITTER_EMAIL: "a@x" };
const dir = realpathSync(mkdtempSync(join(tmpdir(), "git-scroll-")));
const repo = join(dir, "repo");
function sh(cmd: string, cwd = repo) {
  const r = spawnSync("sh", ["-c", cmd], { cwd, env: ENV, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr}`);
  return r.stdout;
}

// ---- stand-ins

let sharedState: Record<string, unknown> = {};
let zoomNow = 1;
let propsNow: any = null;
let spacesNow: any[] = [], panesNow: any[] = [], agentsNow: any[] = [], homeNow = "/home/u";
// herdr.highlight calls (tree-sitter in the app).
let highlights = 0;
// settings.json as the app home holds it (null: none).
let settingsText: string | null = null;
const commands: [string, any][] = [];
const hostCalls: Record<string, number> = {};
const counted = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).map(([k, f]) => [k, (...a: any[]) => { hostCalls[k] = (hostCalls[k] ?? 0) + 1; return f(...a); }]));
mock.module("herdr", () => counted({
  settings: () => ({ zoom: zoomNow, font_family: "Mono" }), window: () => ({ platform: "linux" }), theme: () => theme,
  shared: (k: string) => sharedState[k] ?? null,
  setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  props: () => propsNow,
  spaces: () => spacesNow, panes: () => panesNow, focused: () => null, agents: () => agentsNow, home: () => homeNow,
  appHome: () => "/app-home",
  highlight: (text: string, _path: string) => { highlights++; return text ? [[0, Math.min(3, text.length), "keyword"]] : []; },
  readTextFile: async (path: string) => (path === "/app-home/settings.json" ? settingsText : null),
  run: (name: string, args: any) => { commands.push([name, args]); return null; },
  nextCommand: () => new Promise(() => {}),
  watchFolder: () => new Promise(() => {}),
  closeOverlay: () => {}, openOverlay: () => "o1", notify: () => {},
  exec: async (cmd: string, args: string[], opts: any) => {
    const r = spawnSync(cmd, args, { cwd: opts?.cwd, env: ENV, encoding: "utf8" });
    return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  },
}));
const el: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : (...a: any[]) => { for (const x of a) if (typeof x === "function" && String(k) === "when" && a[0]) x(el); return el; }), apply: () => el });
mock.module("gpui-kit", () => ({ View: class {}, div: () => el, svg: () => el, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
class Input { handlers: Record<string, Function> = {}; v = ""; constructor(o: any) { this.v = o?.value ?? ""; } on(e: string, f: Function) { this.handlers[e] = f; return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} release() { return true; } fire(e: string) { this.handlers[e]?.({}, cx); } }
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el,
  InputState: { new: (o: any) => new Input(o) }, Input: { new: () => el },
  TextareaState: { new: (o: any) => new Input(o) }, Textarea: { new: () => el },
}));
(globalThis as any).window = { paint_path: () => el };
const theme: any = new Proxy({}, { get: (_t, k) => (String(k).startsWith("ansi") ? "#808080" : "#c0c0c0") });

const pending = new Set<Promise<unknown>>();
const cx: any = {
  spawn: (f: Function) => { const p = Promise.resolve().then(() => f(cx)); pending.add(p); p.finally(() => pending.delete(p)); },
  notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }),
  timer: { every() {}, after() {} }, write_to_clipboard(t: string) { cx.clip = t; },
};

const { default: GitView } = await import("../defaults/mods/git/main.ts");
const { rangeHolds } = await import("../defaults/mods/git/items.ts");

/** Waits until both of the window's queues are drained. */
async function settle(v: any) {
  for (let i = 0; i < 400; i++) {
    await new Promise((r) => setTimeout(r, 5));
    if (!v.acts.items.length && !v.reads.items.length && !v.working) {
      await new Promise((r) => setTimeout(r, 30));
      if (!v.acts.items.length && !v.reads.items.length) return;
    }
  }
  throw new Error("queues never drained");
}



beforeAll(() => {
  mkdirSync(repo);
  sh("git init -q -b main");
  const big = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join("\n");
  writeFileSync(join(repo, "big.ts"), `${big}\n`);
  for (let d = 0; d < 20; d++) {
    mkdirSync(join(repo, `src/d${d}/sub`), { recursive: true });
    for (let f = 0; f < 30; f++) writeFileSync(join(repo, `src/d${d}/${f < 15 ? "" : "sub/"}f${f}.ts`), "a\n");
  }
  sh("git add -A && git commit -qm base");
  writeFileSync(join(repo, "big.ts"), `${Array.from({ length: 4000 }, (_, i) => `changed ${i}`).join("\n")}\n`);
  for (let d = 0; d < 20; d++) for (let f = 0; f < 30; f++) writeFileSync(join(repo, `src/d${d}/${f < 15 ? "" : "sub/"}f${f}.ts`), "b\n");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function open() {
  sharedState = {};
  const v = new GitView();
  v.init({ folder: repo }, cx);
  await settle(v);
  v.mainPx.main = 18 * 40;
  v.listPx.files = 18 * 30;
  v.render();
  return v;
}

/** The app calls one draw makes while the view scrolls by `rows`. */
function step(v: any, scroll: () => void) {
  for (const k in hostCalls) delete hostCalls[k];
  scroll();
  v.render();
  return { ...hostCalls };
}

test("scrolling a 4000-line diff: a step highlights only the lines it brings into view, asks the app for its settings once", async () => {
  const v = await open();
  v.setPanel("files"); v.tree = false; await settle(v);
  v.moveTo(v.items("files").findIndex((x: any) => x.path === "big.ts")); await settle(v);
  v.render();
  expect(v.main.rows.length).toBeGreaterThan(4000);
  // Measured before the fix: 41 highlight calls and 48 calls each of
  // settings, window and shared (one per dithered row) per step.
  for (let s = 0; s < 20; s++) {
    const calls = step(v, () => { v.mainTop += 3; });
    expect(calls.highlight ?? 0).toBeLessThanOrEqual(3);
    expect(calls.exec ?? 0).toBe(0);
    expect((calls.settings ?? 0) + (calls.window ?? 0) + (calls.shared ?? 0)).toBeLessThanOrEqual(6);
  }
  // Scrolling back draws lines already highlighted.
  expect(step(v, () => { v.mainTop -= 30; }).highlight ?? 0).toBe(0);
});

test("scrolling 600 changed files in the tree: the tree is built once, not per draw", async () => {
  const v = await open();
  v.setPanel("files"); v.tree = true; await settle(v);
  const rows = v.items("files");
  expect(rows.length).toBeGreaterThan(600);
  for (let s = 0; s < 20; s++) {
    const calls = step(v, () => { v.top.files = s * 3; });
    expect(calls.exec ?? 0).toBe(0);
    expect((calls.settings ?? 0) + (calls.window ?? 0) + (calls.shared ?? 0)).toBeLessThanOrEqual(6);
  }
  expect(v.items("files")).toBe(rows);
  // Folding a folder, the staged filter, the flat list build it anew.
  v.collapsed.add("src/d0");
  const folded = v.items("files");
  expect(folded).not.toBe(rows);
  expect(folded.some((r: any) => r.path === "src/d0/f0.ts")).toBe(false);
  v.collapsed.delete("src/d0");
  expect(v.items("files").some((r: any) => r.path === "src/d0/f0.ts")).toBe(true);
  v.tree = false;
  expect(v.items("files").every((r: any) => r.kind === "file")).toBe(true);
});

test("a range over every file of a folder highlights the folder, at every depth; part of them does not", async () => {
  const v = await open();
  v.setPanel("files"); v.tree = true; await settle(v);
  const rows = v.items("files");
  const at = (path: string) => rows.findIndex((r: any) => r.path === path);
  const d0 = at("src/d0"), sub = at("src/d0/sub"), src = at("src");
  const first = at("src/d0/sub/f15.ts"), lastSub = at("src/d0/sub/f29.ts");
  expect([src, d0, sub]).toEqual([0, 1, 2]);
  expect(first).toBe(3);
  const lit = (a: number, b: number) => ({ src: rangeHolds(rows, src, [a, b]), d0: rangeHolds(rows, d0, [a, b]), sub: rangeHolds(rows, sub, [a, b]) });
  // Every file of d0 (sub's and its own), the range starting under the folders' rows.
  const lastD0 = rows.findIndex((r: any, i: number) => i > d0 && r.depth <= 1) - 1;
  expect(lit(first, lastD0)).toEqual({ src: false, d0: true, sub: true });
  // Only sub's files: sub, not d0.
  expect(lit(first, lastSub)).toEqual({ src: false, d0: false, sub: true });
  // All but one of sub's files: neither.
  expect(lit(first + 1, lastD0)).toEqual({ src: false, d0: false, sub: false });
  // Drawn with the range on: the folders' rows are drawn in it.
  v.range = { ctx: "files", anchor: first }; v.sel.files = lastD0; v.follow.files = true;
  v.render();
  // A folded folder stands for its files: d0 with sub folded is lit by sub's row and d0's own files.
  v.collapsed.add("src/d0/sub");
  const folded = v.items("files");
  const fsub = folded.findIndex((r: any) => r.path === "src/d0/sub"), fend = folded.findIndex((r: any, i: number) => i > fsub && r.depth <= 1) - 1;
  expect(rangeHolds(folded, 1, [fsub, fend])).toBe(true);
  expect(rangeHolds(folded, 1, [fsub + 1, fend])).toBe(false);
  // A folded folder isn't lit by the range around it unless it is in it.
  expect(rangeHolds(folded, fsub, [fsub + 1, fend])).toBe(false);
});
