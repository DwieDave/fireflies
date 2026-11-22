// The git window's look by layout (docs/plain-look.md): in nocturne its
// dithered frames, in herdr-app's default layout (main) cards on the canvas,
// the shared title bar (none in a pane: main's pane header names the mod),
// upstream's popover for the menus and dialogs, no checker anywhere. The
// elements are recorders (every call kept), git is real (a scratch repo).
// Its own process: it stands in for herdr, gpui-kit and gpui-base.
import { test, expect, mock } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = `${import.meta.dir}/..`;
const DIR = realpathSync(mkdtempSync(join(tmpdir(), "git-look-")));
const repo = join(DIR, "repo");
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "a@x", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "a@x", GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z" };
const sh = (cmd: string) => { const r = spawnSync("sh", ["-c", cmd], { cwd: repo, env: ENV, encoding: "utf8" }); if (r.status !== 0) throw new Error(cmd + r.stderr); return r.stdout; };
mkdirSync(repo, { recursive: true });
sh("git init -q -b main && printf 'a\\nb\\nc\\n' > a.txt && git add a.txt && git commit -qm one && git checkout -qb side && echo s > s.txt && git add s.txt && git commit -qm two && git checkout -q main && printf 'a\\nB\\nc\\n' > a.txt && echo n > new.txt && git tag v1");

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

const layouts: Record<string, unknown> = { nocturne: JSON.parse(readFileSync(ROOT + "/defaults/layouts/nocturne.json", "utf8")), main: JSON.parse(readFileSync(ROOT + "/defaults/layouts/main.json", "utf8")) };
let LOOK = "nocturne";
const theme: any = new Proxy({ background: "#080808", foreground: "#c6c6c6", accent: "#80a0ff", muted: "#949494", dim: "#5F6D6D", border: "#323437", input: "#323437", canvas: "#080808", popover: "#101010", raised: "#181818", selected: "#1c1c1c", hover: "#1c1c1c", done: "#00ff00", blocked: "#ff0000", working: "#ffff00" }, { get: (o: any, k) => o[k] ?? "#808080" });
const shared: Record<string, unknown> = {};
let looks = 0;
/** Draws from here on in `name`'s look (a new layout name: the look library reads it again). */
const use = (name: string) => { LOOK = name; looks += 1; };
let propsNow: any = null;
mock.module("herdr", () => ({
  settings: () => ({ zoom: 0.9, font_family: "Mono", ui_font_family: "Departure Mono" }), window: () => ({ platform: "macos" }), theme: () => theme,
  layout: () => layouts[LOOK], shared: (k: string) => (k === "layout" ? `${LOOK}-${looks}` : shared[k] ?? null), setShared: (k: string, v: unknown) => { shared[k] = v; },
  props: () => propsNow, spaces: () => [], panes: () => [], focused: () => null, agents: () => [], home: () => "/home/u", appHome: () => "/app-home",
  readTextFile: async () => null, run: () => null, nextCommand: () => new Promise(() => {}), watchFolder: () => new Promise(() => {}),
  closeOverlay: () => {}, openOverlay: () => "o1", notify: () => {}, highlight: () => [],
  exec: async (cmd: string, args: string[], opts: any) => { const r = spawnSync(cmd, args, { cwd: opts?.cwd, env: ENV, encoding: "utf8" }); return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }; },
}));
mock.module("gpui-kit", () => ({ View: class {}, div: make("div"), svg: make("svg"), img: make("img"), PathBuilder: { fill: () => make("path")() }, Background: { checkerboard: (...a: unknown[]) => ({ checker: a }) } }));
class Input { v = ""; constructor(o: any) { this.v = o?.value ?? ""; } on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} release() { return true; } }
mock.module("gpui-base", () => ({ h_flex: make("h_flex"), v_flex: make("v_flex"), InputState: { new: (o: any) => new Input(o) }, Input: { new: make("Input") }, TextareaState: { new: (o: any) => new Input(o) }, Textarea: { new: make("Textarea") } }));
(globalThis as any).window = { paint_path: (...a: unknown[]) => make("paint_path")(...a.map((x) => (isRec(x) ? x.kind : x))) };

const { hostContext, drained } = await import(ROOT + "/scripts/git-host.ts");
const { default: GitView } = await import(ROOT + "/defaults/mods/git/main.ts");
const { runtime } = await import(ROOT + "/defaults/mods/git/fx.ts");
const settle = (v: any) => runtime.runtime.runPromise(drained(v));
const { cx } = hostContext();

/** Every call of a recorded tree, as "method(args)" strings. */
const calls = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) { for (const x of v) calls(x, out); return out; }
  if (typeof v !== "object" || v === null) return out;
  const r = v as { kind?: string; calls?: [string, unknown[]][] };
  if (r.kind !== undefined) out.push(r.kind);
  for (const [k, a] of r.calls ?? []) { out.push(`${k}(${JSON.stringify(a.filter((x) => typeof x !== "object"))})`); calls(a, out); }
  return out;
};

const open = async (p: any) => { propsNow = p; const v: any = new GitView(); v.init(p, cx); await settle(v); v.size = { width: 1100, height: 700 }; return v; };
const drawn = (v: any) => calls(tree(v.render()));
const has = (list: string[], s: string) => list.some((c) => c.includes(s));

test("in nocturne: the dithered frames, the 34 px header with its moon, no cards", async () => {
  use("nocturne");
  const w = await open({ folder: repo, overlay: "w1" });
  const d = drawn(w);
  expect(has(d, "checker")).toBe(true);
  expect(has(d, "moon-6.svg")).toBe(true);
  expect(has(d, 'id(["git-head"])')).toBe(true);
  expect(has(d, "rounded(")).toBe(false);
  w.menu({ title: "A menu", items: [{ key: "a", label: "First" }] });
  expect(has(drawn(w), "rounded(")).toBe(false);
  w.popups.close();
});

test("in main (herdr-app's default): cards on the canvas, the shared title bar, popovers, no checker", async () => {
  use("main");
  const w = await open({ folder: repo, overlay: "w1" });
  w.setPanel("branches"); await settle(w);
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
});

test("in main a pane has no title bar of its own (main's pane header names the mod)", async () => {
  use("main");
  const p = await open({ folder: repo, slot: "s1" });
  const d = drawn(p);
  expect(has(d, 'id(["git-head"])')).toBe(false);
  expect(has(d, "rounded([8])")).toBe(true);
  rmSync(DIR, { recursive: true, force: true });
});
