// The git window's look by layout (docs/plain-look.md): in nocturne its
// dithered frames, in herdr-app's default layout (main) cards on the canvas,
// the shared title bar (none in a pane: main's pane header names the mod),
// upstream's popover for the menus and dialogs, no checker anywhere. The
// elements are recorders (every call kept), git is real (a scratch repo)
// through the kit's test layers; herdr is git-host.ts' one stand-in.
// Its own process: it stands in for herdr, gpui-kit and gpui-base.
import { test, expect, mock } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Effect } from "effect";
import { drained, gitHerdr, gitServices, hostContext, newHost } from "./git-host.ts";

const ROOT = `${import.meta.dir}/..`;
const DIR = realpathSync(mkdtempSync(join(tmpdir(), "git-look-")));
const repo = join(DIR, "repo");
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "a@x", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "a@x", GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z" };
const sh = (cmd: string) => { const r = spawnSync("sh", ["-c", cmd], { cwd: repo, env: ENV, encoding: "utf8" }); if (r.status !== 0) throw new Error(cmd + r.stderr); return r.stdout; };
mkdirSync(repo, { recursive: true });
sh("git init -q -b main && printf 'a\\nb\\nc\\n' > a.txt && git add a.txt && git commit -qm one && git checkout -qb side && echo s > s.txt && git add s.txt && git commit -qm two && git checkout -q main && printf 'a\\nB\\nc\\n' > a.txt && echo n > new.txt && git tag v1");

// ---- recorders: every element keeps its calls, children as their own records.

type Rec = { kind: string; calls: [string, unknown[]][] };
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && "calls" in v && "kind" in v;
const make = (kind: string) => (...a: unknown[]): any => {
  const rec: Rec = { kind: a.length ? kind + "(" + JSON.stringify(a.map((x) => (isRec(x) ? x.kind : typeof x === "function" ? "fn" : x))) + ")" : kind, calls: [] };
  const el: any = new Proxy(rec, { get: (o, k) => (k === "calls" || k === "kind" ? (o as any)[k] : k === "then" ? undefined : (...args: unknown[]) => {
    o.calls.push([String(k), args.map((x) => (typeof x === "function" ? "fn" : x))]);
    if (String(k) === "map") for (const x of args) if (typeof x === "function") return x(el);
    if (String(k) === "when" && args[0]) { const f = args[1]; if (typeof f === "function") return f(el); }
    return el;
  }) });
  return el;
};
const tree = (v: unknown): unknown => (isRec(v) ? { kind: v.kind, calls: v.calls.map(([k, a]) => [k, a.map(tree)]) } : Array.isArray(v) ? v.map(tree) : v);

/** Every call of a recorded tree, as "method(args)" strings. */
const calls = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) { for (const x of v) calls(x, out); return out; }
  if (typeof v !== "object" || v === null) return out;
  const r = v as { kind?: string; calls?: [string, unknown[]][] };
  if (r.kind !== undefined) out.push(r.kind);
  for (const [k, a] of r.calls ?? []) { out.push(`${k}(${JSON.stringify(a.filter((x) => typeof x !== "object"))})`); calls(a, out); }
  return out;
};

// ---- stand-ins: the kit's test layers and the one herdr stand-in (git-host.ts)

const layouts: Record<string, unknown> = { nocturne: JSON.parse(readFileSync(ROOT + "/defaults/layouts/nocturne.json", "utf8")), main: JSON.parse(readFileSync(ROOT + "/defaults/layouts/main.json", "utf8")) };
const theme: any = new Proxy({ background: "#080808", foreground: "#c6c6c6", accent: "#80a0ff", muted: "#949494", dim: "#5F6D6D", border: "#323437", input: "#323437", canvas: "#080808", popover: "#101010", raised: "#181818", selected: "#1c1c1c", hover: "#1c1c1c", done: "#00ff00", blocked: "#ff0000", working: "#ffff00" }, { get: (o: any, k) => o[k] ?? "#808080" });
const host = newHost();
host.zoom = 0.9;
host.platform = "macos";
let looks = 0;
/** Draws from here on in `name`'s look (a new layout name: the look library reads it again). */
const use = (name: string) => { host.layout = layouts[name]; looks += 1; host.layoutName = `${name}-${looks}`; };
mock.module("herdr", () => gitHerdr(host, theme));
mock.module("gpui-kit", () => ({ View: class {}, div: make("div"), svg: make("svg"), img: make("img"), PathBuilder: { fill: () => make("path")() }, Background: { checkerboard: (...a: unknown[]) => ({ checker: a }) } }));
class Input { v = ""; constructor(o: any) { this.v = o?.value ?? ""; } on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} release() { return true; } }
mock.module("gpui-base", () => ({ h_flex: make("h_flex"), v_flex: make("v_flex"), InputState: { new: (o: any) => new Input(o) }, Input: { new: make("Input") }, TextareaState: { new: (o: any) => new Input(o) }, Textarea: { new: make("Textarea") } }));
(globalThis as any).window = { paint_path: (...a: unknown[]) => make("paint_path")(...a.map((x) => (isRec(x) ? x.kind : x))) };

const { default: GitView } = await import("../defaults/mods/git/main.ts");
const { runtime, useServices } = await import("../defaults/mods/git/fx.ts");
const { FolderWatchStill } = await import("../defaults/mods/git/watch.ts");
useServices(gitServices(ENV, FolderWatchStill).layer);
/** An effect run on the mod's runtime, at the test's edge. */
const runFx = <A, E>(e: Effect.Effect<A, E, any>): Promise<A> => runtime.managed().runPromise(e);
const { cx } = hostContext();

/** A copy opened with `p` as its props, read. */
const opened = (p: any) => Effect.gen(function* () {
  host.props = p;
  const v: any = new GitView();
  v.init(p, cx);
  yield* drained(v);
  v.size = { width: 1100, height: 700 };
  return v;
});
const drawn = (v: any) => calls(tree(v.render()));
const has = (list: string[], s: string) => list.some((c) => c.includes(s));

test("in nocturne: the dithered frames, the 34 px header with its moon, no cards", () => runFx(Effect.gen(function* () {
  use("nocturne");
  const w = yield* opened({ folder: repo, overlay: "w1" });
  const d = drawn(w);
  expect(has(d, "checker")).toBe(true);
  expect(has(d, "moon-6.svg")).toBe(true);
  expect(has(d, 'id(["git-head"])')).toBe(true);
  expect(has(d, "rounded(")).toBe(false);
  w.menu({ title: "A menu", items: [{ key: "a", label: "First" }] });
  expect(has(drawn(w), "rounded(")).toBe(false);
  w.popups.close();
})));

test("in main (herdr-app's default): cards on the canvas, the shared title bar, popovers, no checker", () => runFx(Effect.gen(function* () {
  use("main");
  const w = yield* opened({ folder: repo, overlay: "w1" });
  w.setPanel("branches");
  yield* drained(w);
  const d = drawn(w);
  expect(has(d, "checker")).toBe(false);
  expect(has(d, "rounded([8])")).toBe(true); // a card
  expect(has(d, "rounded([10])")).toBe(true); // the window's popover frame
  expect(has(d, 'id(["git-head"])')).toBe(true);
  expect(has(d, "h([40])")).toBe(true); // the shared title bar
  expect(has(d, "plain/git-branch.svg")).toBe(true);
  expect(has(d, "moon-6.svg")).toBe(false);
  expect(has(d, 'id(["tab-branches-tags"])')).toBe(true); // the tabs as a segmented control
  w.menu({ title: "A menu", items: [{ key: "a", label: "First" }, { key: "b", label: "Second" }] });
  const m = drawn(w);
  expect(has(m, "checker")).toBe(false);
  expect(has(m, 'bg(["#00000059"])')).toBe(true); // the flat veil
  w.popups.close();
  w.ask({ title: "Confirm", text: "Sure?", go: () => {} });
  expect(has(drawn(w), "checker")).toBe(false);
  w.popups.close();
})));

test("in main a pane has no title bar of its own (main's pane header names the mod)", () => runFx(Effect.gen(function* () {
  use("main");
  const p = yield* opened({ folder: repo, slot: "s1" });
  const d = drawn(p);
  expect(has(d, 'id(["git-head"])')).toBe(false);
  expect(has(d, "rounded([8])")).toBe(true);
  rmSync(DIR, { recursive: true, force: true });
})));
