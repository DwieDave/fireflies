// The git window as a normal pane (git/place.ts, docs/mods-in-panes.md): drawn
// without the window's frame and ✕, esc leaves the pane, narrow widths,
// moving window -> pane -> window with what it shows, two copies (the
// keyboard's copy acts on commands) and a restart's props. herdr and gpui are
// stand-ins; the elements record what they're asked to draw.
import { test, expect, mock, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Effect } from "effect";
import { drained, gitHerdr, gitServices, hostContext, newHost } from "./git-host.ts";

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "a@x", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "a@x" };
const dir = realpathSync(mkdtempSync(join(tmpdir(), "git-pane-")));
const repo = join(dir, "repo");
const other = join(dir, "other");
function sh(cmd: string, cwd = repo) {
  const r = spawnSync("sh", ["-c", cmd], { cwd, env: ENV, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr}`);
  return r.stdout;
}

// ---- stand-ins: the kit's test layers and the one herdr stand-in (git-host.ts)

const host = newHost();
const files = new Map<string, string>();
mock.module("herdr", () => gitHerdr(host, theme));

// Every element is one recorder: drawn records [method, args] while a render runs.
let drawn: [string, any[]][] = [];
const el: any = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined : (...a: any[]) => {
    drawn.push([String(k), a]);
    for (const x of a) if (typeof x === "function" && String(k) === "when" && a[0]) x(el);
    if (String(k) === "map") for (const x of a) if (typeof x === "function") x(el);
    return el;
  }),
  apply: () => el,
});
mock.module("gpui-kit", () => ({ View: class {}, div: () => el, svg: () => el, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
class Input { v = ""; constructor(o: any) { this.v = o?.value ?? ""; } on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} release() { return true; } }
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el,
  InputState: { new: (o: any) => new Input(o) }, Input: { new: () => el },
  TextareaState: { new: (o: any) => new Input(o) }, Textarea: { new: () => el },
}));
(globalThis as any).window = { paint_path: () => el };
const theme: any = new Proxy({}, { get: (_t, k) => (String(k).startsWith("ansi") ? "#808080" : "#c0c0c0") });

// localStorage per mod and props: one store per props as JSON.
const stores = new Map<string, Map<string, string>>();
(globalThis as any).localStorage = {
  getItem: (k: string) => stores.get(JSON.stringify(host.props))?.get(k) ?? null,
  setItem: (k: string, v: string) => { const key = JSON.stringify(host.props); if (!stores.has(key)) stores.set(key, new Map()); stores.get(key)!.set(k, v); },
};

const { cx, advance } = hostContext();

const { default: GitView } = await import("../defaults/mods/git/main.ts");
const { runtime: gitRuntime, useServices } = await import("../defaults/mods/git/fx.ts");
const { FolderWatchStill } = await import("../defaults/mods/git/watch.ts");
useServices(gitServices(ENV, FolderWatchStill, files).layer);
const { STEP_ASIDE } = await import("../defaults/mods/git/place.ts");
/** An effect of the mod run on its own runtime (the live services over the herdr stand-in). */
/** The moved-from copy steps aside STEP_ASIDE after a move (place.ts): its clock moved that far, the view's work drained. */
const stepAside = (v: any): Promise<void> => runFx(Effect.andThen(advance(STEP_ASIDE), drained(v)));
const runFx = <A, E>(e: Effect.Effect<A, E, any>): Promise<A> => gitRuntime.managed().runPromise(e);

/** Until the view's lanes are drained (git-host.ts). */
const settle = (v: any): Promise<void> => runFx(drained(v));


const key = (k: string, mods: any = {}) => ({ key: k.length === 1 ? k.toLowerCase() : k, key_char: k.length === 1 ? k : undefined, modifiers: mods });

beforeAll(() => {
  for (const r of [repo, other]) {
    mkdirSync(r);
    sh("git init -q -b main && git commit -q --allow-empty -m root && echo a > a.txt && git add a.txt && git commit -qm 'add a'", r);
  }
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A copy opened with `p` as its props (an overlay id: the window). */
/** A copy opened with `p` as its props, read and drawn. */
const open = (p: any): Promise<any> => runFx(Effect.gen(function* () {
  host.props = p;
  const v = new GitView();
  v.init(p, cx);
  yield* drained(v);
  render(v);
  return v;
}));

function render(v: any) {
  drawn = [];
  const saved = host.props;
  v.render();
  host.props = saved;
  return drawn;
}

/** The root's own calls: from its id to its focus tracking (the panels inside draw frames of their own). */
const framed = (d: [string, any[]][]) => {
  const i = d.findIndex(([m, a]) => m === "id" && a[0] === "git");
  const j = d.findIndex(([m], n) => n > i && m === "track_focus");
  return d.slice(i, j).some(([m]) => m === "border");
};
const texts = (d: [string, any[]][]) => d.filter(([m]) => m === "child").flatMap(([, a]) => a.filter((x) => typeof x === "string"));
const tips = (d: [string, any[]][]) => d.filter(([m]) => m === "tooltip").map(([, a]) => a[0]);
const fresh = () => { host.shared = {}; host.commands.length = 0; host.opened.length = 0; host.closed.length = 0; host.panes = []; host.focused = null; stores.clear(); };

test("as a pane: no frame, no ✕, the ⧉ to a window; the window has its frame, ✕ and ◧", async () => {
  fresh();
  const pane = await open({ folder: repo, slot: "s1" });
  expect(pane.state).toBe("ready");
  let d = render(pane);
  expect(framed(d)).toBe(false);
  expect(texts(d)).not.toContain("✕");
  expect(texts(d)).toContain("⧉");
  expect(tips(d)).toContain("Out to a window · ctrl-t");

  const win = await open({ folder: repo, overlay: "w1" });
  d = render(win);
  expect(framed(d)).toBe(true);
  expect(texts(d)).toContain("✕");
  expect(texts(d)).toContain("◧");
  expect(tips(d)).toContain("Into a pane · ctrl-t");
});

test("esc at the top level leaves a pane open (q closes it: its own pane, by slot); esc closes the window", async () => {
  fresh();
  host.panes = [{ pane: "p9", mod: "git", props: { folder: other, slot: "x" }, focused: false }, { pane: "p2", mod: "git", props: { folder: repo, slot: "s1" }, focused: false }];
  const pane = await open({ folder: repo, slot: "s1" });
  pane.key(key("escape"), cx); await settle(pane);
  expect(host.commands.filter(([n]) => n === "pane.close")).toEqual([]);
  pane.key(key("q"), cx); await settle(pane);
  expect(host.commands.filter(([n]) => n === "pane.close")).toEqual([["pane.close", { pane: "p2" }]]);

  const win = await open({ folder: repo, overlay: "w1" });
  win.key(key("escape"), cx); await settle(win);
  expect(host.closed).toContain("w1");
});

test("narrow panes: one column, header and body draw at 300 and 500 px", async () => {
  fresh();
  const pane = await open({ folder: repo, slot: "s1" });
  for (const width of [300, 500, 900]) {
    pane.size = { width, height: 400 };
    expect(() => render(pane)).not.toThrow();
  }
  pane.size = { width: 500, height: 400 };
  pane.setPanel("commits"); await settle(pane);
  pane.key(key("0"), cx); await settle(pane);
  expect(pane.focus).toBe("main");
  pane.key(key("escape"), cx); await settle(pane);
  expect(pane.focus).toBe("side");
  expect(host.commands.filter(([n]) => n === "pane.close")).toEqual([]);
});

test("moved window -> pane -> window: what it shows goes along, the old copy steps aside", async () => {
  fresh();
  host.focused = { pane: "p1" };
  const win = await open({ folder: repo, overlay: "w1" });
  win.setPanel("commits"); await settle(win);
  win.sel.commits = 1;
  win.mode = "half";
  win.key(key("t", { control: true }), cx); await stepAside(win);

  const split = host.commands.find(([n]) => n === "pane.split");
  expect(split?.[1]).toMatchObject({ direction: "auto", pane: "p1", mod: "git", props: { folder: repo } });
  const slot = split?.[1].props.slot;
  expect(typeof slot).toBe("string");
  expect(host.closed).toContain("w1");

  // The new pane takes the handover.
  host.panes = [{ pane: "p3", mod: "git", props: split?.[1].props, focused: true }];
  const pane = await open(split?.[1].props);
  expect(pane.overlay).toBe(null);
  expect(pane.panel).toBe("commits");
  expect(pane.mode).toBe("half");
  expect(pane.sel.commits).toBe(1);
  expect(host.shared["git.handover"]).toBe(null);

  // And back out to a window: the pane closes (its own), the window opens on the same folder.
  pane.setPanel("branches"); await settle(pane);
  host.commands.length = 0;
  pane.key(key("t", { control: true }), cx); await stepAside(pane);
  const spec = host.opened.at(-1);
  expect(spec).toMatchObject({ mod: "git", kind: "window", key: "git", props: { folder: repo } });
  expect(spec.props.slot).toBeUndefined();
  expect(host.commands).toContainEqual(["pane.close", { pane: "p3" }]);
  const win2 = await open({ ...spec.props, overlay: "w2" });
  expect(win2.panel).toBe("branches");
});

test("an open window gives way when a pane moves out", async () => {
  fresh();
  host.shared["git.window"] = { id: "w7", beat: Date.now(), folder: other };
  host.panes = [{ pane: "p3", mod: "git", props: { folder: repo, slot: "s1" }, focused: true }];
  const pane = await open({ folder: repo, slot: "s1" });
  pane.key(key("t", { control: true }), cx); await stepAside(pane);
  expect(host.closed).toContain("w7");
  expect((host.shared["git.window"] as any).id).toBe(`o${host.opened.length}`);
});

test("two copies: commands go to the window while it's open, else the focused pane", async () => {
  fresh();
  const { actsOnCommands } = await import("../defaults/mods/git/place.ts");
  host.panes = [
    { pane: "p1", mod: "git", props: { folder: repo, slot: "a" }, focused: true },
    { pane: "p2", mod: "git", props: { folder: other, slot: "b" }, focused: false },
  ];
  const a = await open({ folder: repo, slot: "a" });
  const b = await open({ folder: other, slot: "b" });
  expect(a.folder).toBe(repo);
  expect(b.folder).toBe(other);
  expect(actsOnCommands(a)).toBe(true);
  expect(actsOnCommands(b)).toBe(false);

  const w = await open({ folder: repo, overlay: "w1" });
  expect(actsOnCommands(w)).toBe(true);
  expect(actsOnCommands(a)).toBe(false);
});

test("a restart: the pane's props (slot, folder) bring back what it showed", async () => {
  fresh();
  const p = { folder: other, slot: "keep1" };
  const first = await open(p);
  first.setPanel("stash"); await settle(first);
  first.mode = "full";
  await first.close();

  // A window on the same folder kept another panel meanwhile (a restart clears shared state);
  // the pane still shows its own, from its localStorage.
  host.shared = { "git.state": { [other]: { panel: "files", mode: "normal" } } };
  const again = await open({ ...p });
  expect(again.folder).toBe(other);
  expect(again.panel).toBe("stash");
  expect(again.mode).toBe("full");
});
