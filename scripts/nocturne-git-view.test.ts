// The git window (nocturne-git/main.js) on a real scratch repo: herdr and
// gpui are stand-ins, but exec runs the real git, so reading, the panels,
// keys and actions run through the window's code down to git.
import { test, expect, mock, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Ada Lovelace", GIT_AUTHOR_EMAIL: "a@x", GIT_COMMITTER_NAME: "Ada Lovelace", GIT_COMMITTER_EMAIL: "a@x" };
const dir = mkdtempSync(join(tmpdir(), "nocturne-git-view-"));
const repo = join(dir, "repo");
function sh(cmd: string, cwd = repo) {
  const r = spawnSync("sh", ["-c", cmd], { cwd, env: ENV, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr}`);
  return r.stdout;
}

// ---- stand-ins

let sharedState: Record<string, unknown> = {};
let propsNow: any = null;
const commands: [string, any][] = [];
mock.module("herdr", () => ({
  settings: () => ({ zoom: 1, font_family: "Mono" }), window: () => ({ platform: "linux" }), theme: () => theme,
  shared: (k: string) => sharedState[k] ?? null,
  setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  props: () => propsNow,
  spaces: () => [], panes: () => [], focused: () => null,
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

const { default: GitView } = await import("../defaults/mods/nocturne-git/main.js");

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

const key = (k: string, mods: any = {}) => ({ key: k.length === 1 ? k.toLowerCase() : k, key_char: k.length === 1 ? k : undefined, modifiers: mods });
async function press(v: any, ...keys: (string | [string, any])[]) {
  for (const k of keys) { v.key(Array.isArray(k) ? key(k[0], k[1]) : key(k), cx); v.render(); await settle(v); }
}

beforeAll(() => {
  mkdirSync(repo);
  sh("git init -q -b main && git commit -q --allow-empty -m root");
  sh("printf 'a\\nb\\nc\\n' > f.txt && git add f.txt && git commit -qm 'add f'");
  sh("git checkout -qb side && echo s > s.txt && git add s.txt && git commit -qm 'side work' && git checkout -q main");
  sh("echo m > m.txt && git add m.txt && git commit -qm 'main work' && git merge -q --no-ff side -m 'Merge side'");
  sh("git tag v1 && echo w > w.txt && git stash push -q -u -m 'wip' && printf 'a\\nB\\nc\\nd\\n' > f.txt && echo n > new.txt");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function open() {
  sharedState = {};
  const v = new GitView();
  v.init({ folder: repo }, cx);
  await settle(v);
  v.render();
  return v;
}

test("opens on the repo: every panel reads, renders without throwing", async () => {
  const v = await open();
  expect(v.state).toBe("ready");
  expect(v.data.status.head).toBe("main");
  expect(v.data.status.files.map((f: any) => f.path).sort()).toEqual(["f.txt", "new.txt"]);
  expect(v.data.branches.map((b: any) => b.name).sort()).toEqual(["main", "side"]);
  expect(v.data.tags.map((t: any) => t.name)).toEqual(["v1"]);
  expect(v.data.stash.length).toBe(1);
  expect(v.data.commits[0].subject).toBe("Merge side");
  expect(v.graph.width).toBe(2);
  for (const mode of ["normal", "half", "full"]) { v.mode = mode; for (const p of ["status", "files", "branches", "commits", "stash"]) { v.setPanel(p); await settle(v); v.render(); } }
});

test("narrow: one thing at a time, enter into the main view and esc back", async () => {
  const v = await open();
  v.size = { width: 500, height: 600 };
  v.render();
  v.setPanel("commits"); await settle(v);
  await press(v, "0");
  expect(v.focus).toBe("main");
  v.render();
  await press(v, "escape");
  expect(v.focus).toBe("side");
});

test("files: space stages, the main view shows the diff, c commits through the popup", async () => {
  const v = await open();
  v.setPanel("files"); v.tree = false; v.moveTo(0); await settle(v);
  expect(v.item().path).toBe("f.txt");
  expect(v.main.rows.some((r: any) => r.kind === "+" && r.text === "B")).toBe(true);
  await press(v, "space");
  expect(sh("git diff --cached --name-only").trim()).toBe("f.txt");
  await press(v, "c");
  expect(v.popups.kind).toBe("commit");
  v.popups.top.input.set_value("feat: B and d");
  v.popups.top.desc.set_value("the body");
  await press(v, "enter");
  expect(sh("git log -1 --format=%B").trim()).toBe("feat: B and d\n\nthe body");
  expect(v.logs.some((e: any) => e.title === "Commit" && e.ok)).toBe(true);
});

test("staging lines: enter, space stages one line, tab and the staged side", async () => {
  const v = await open();
  sh("printf 'a\\nX\\nc\\nY\\n' > f.txt");
  await v.reloadNow(); await settle(v);
  v.setPanel("files"); v.tree = false; v.moveTo(0); await settle(v);
  await press(v, "enter");
  expect(v.focus).toBe("main");
  expect(v.staging.rows[v.staging.cur].kind).toBe("-");
  await press(v, "j", "space"); // the "+X" line
  expect(sh("git diff --cached").includes("+X")).toBe(true);
  expect(sh("git diff --cached").includes("+Y")).toBe(false);
  expect(v.staging.other).not.toBe(null);
  await press(v, "tab");
  expect(v.staging.side).toBe("staged");
  await press(v, "a", "space"); // hunk mode: unstage the whole hunk
  expect(sh("git diff --cached")).toBe("");
  await press(v, "escape");
  expect(v.focus).toBe("side");
  sh("git checkout -q -- f.txt");
});

test("branches: n makes a branch, space checks out, d deletes with a confirm", async () => {
  const v = await open();
  v.setPanel("branches"); await settle(v);
  await press(v, "n");
  expect(v.popups.kind).toBe("prompt");
  v.popups.top.input.set_value("feat/new");
  await press(v, "enter");
  expect(sh("git branch --show-current").trim()).toBe("feat/new");
  const i = v.items("branches").findIndex((b: any) => b.name === "main");
  v.moveTo(i);
  await press(v, "space");
  expect(sh("git branch --show-current").trim()).toBe("main");
  v.moveTo(v.items("branches").findIndex((b: any) => b.name === "feat/new"));
  await press(v, "d");
  expect(v.popups.kind).toBe("menu");
  await press(v, "c");
  expect(v.popups.kind).toBe("confirm");
  await press(v, "enter");
  expect(sh("git branch --list feat/new").trim()).toBe("");
});

test("commits: wide mode, enter shows files, r rewords HEAD, z undoes it", async () => {
  const v = await open();
  await press(v, "4", "+");
  expect(v.mode).toBe("half");
  v.render();
  await press(v, "enter");
  expect(v.sub().kind).toBe("commitFiles");
  await press(v, "escape");
  expect(v.sub()).toBe(null);
  const before = sh("git rev-parse HEAD").trim();
  await press(v, "r");
  expect(v.popups.kind).toBe("commit");
  v.popups.top.input.set_value("Merge side, reworded");
  await press(v, "enter");
  expect(sh("git log -1 --format=%s").trim()).toBe("Merge side, reworded");
  await press(v, "z");
  expect(v.popups.kind).toBe("confirm");
  await press(v, "enter");
  expect(sh("git rev-parse HEAD").trim()).toBe(before);
  await press(v, "Z");
  await press(v, "enter");
  expect(sh("git log -1 --format=%s").trim()).toBe("Merge side, reworded");
});

test("commits: squash below a straight line, drop asks, merges are refused", async () => {
  const v = await open();
  sh("git stash push -q -u -m tmp && echo 1 > one.txt && git add . && git commit -qm one && echo 2 > two.txt && git add . && git commit -qm two");
  await v.reloadNow(); await settle(v);
  v.setPanel("commits"); v.moveTo(0); await settle(v);
  await press(v, "s");
  expect(v.popups.kind).toBe("confirm");
  await press(v, "enter");
  expect(sh("git log -2 --format=%s").trim().split("\n")[0]).toBe("one");
  expect(sh("git show --stat --format= HEAD")).toContain("two.txt");
  v.moveTo(v.commitList().findIndex((c: any) => c.parents.length > 1)); await settle(v); // a merge
  await press(v, "d");
  expect(v.popups.top.error).toBe(true);
  await press(v, "escape");
  sh("git stash pop -q");
});

test("stash: space applies, d drops with a confirm", async () => {
  const v = await open();
  sh("git stash push -q -u -m keep");
  await v.reloadNow(); await settle(v);
  await press(v, "5");
  expect(v.items("stash")[0].subject).toContain("keep");
  await press(v, "space");
  expect(sh("git status --porcelain")).not.toBe("");
  await press(v, "d", "enter");
  expect(sh("git stash list")).not.toContain("keep");
});

test("review: the Files panel's Review tab marks and hides like nocturne-diff", async () => {
  sh("echo r > review.txt && echo r > review2.txt");
  const v = await open();
  v.setPanel("files"); v.setTab("review"); await settle(v);
  expect(v.ctx()).toBe("review");
  const n = v.items("review").length;
  expect(n).toBeGreaterThan(0);
  await press(v, "space");
  expect(v.review.marks().size).toBe(1);
  expect((sharedState["nocturne-diff.reviewed"] as any)[v.git.root].length).toBe(1);
  await press(v, "a");
  expect(v.review.marks().size).toBe(n);
  await press(v, "a");
  expect(v.review.marks().size).toBe(0);
  await press(v, "s");
  expect(v.review.scope).toBe("branch");
  await press(v, "q");
  sh("rm review.txt review2.txt");
});

test("keys: ? opens the keybindings menu; the bar follows the context; right-click has the row's actions", async () => {
  const v = await open();
  v.setPanel("commits"); await settle(v);
  await press(v, "?");
  expect(v.popups.kind).toBe("menu");
  expect(v.popups.top.items.some((x: any) => x.label === "Squash into the commit below")).toBe(true);
  await press(v, "escape");
  v.rowMenu("commits", 0, cx);
  expect(v.popups.top.items.find((x: any) => x.label === "Drop").danger).toBe(true);
  await press(v, "escape");
  v.render();
});

test("ctrl-p opens the main view as a pane (ctrl-shift-p a tab); the pane shows it and q closes it", async () => {
  const v = await open();
  v.overlay = "w1";
  v.setPanel("commits"); v.moveTo(0); await settle(v);
  commands.length = 0;
  await press(v, ["p", { control: true }]);
  const [name, args] = commands.find(([n]) => n === "pane.split")!;
  expect(name).toBe("pane.split");
  expect(args.mod).toBe("nocturne-git");
  expect(args.props.show).toEqual({ kind: "commit", hash: v.data.commits[0].hash });
  await press(v, ["p", { control: true, shift: true }]);
  expect(commands.some(([n, a]) => n === "tab.new" && a.mod === "nocturne-git")).toBe(true);
  // right-click menus offer it too
  v.rowMenu("commits", 0, cx);
  expect(v.popups.top.items.some((x: any) => x.key === "ctrl-p")).toBe(true);
  await press(v, "escape");

  // the pane: its props as the window sent them
  const pane = new GitView();
  propsNow = args.props;
  pane.init(args.props, cx);
  propsNow = null;
  await settle(pane);
  expect(pane.state).toBe("ready");
  pane.render();
  expect(pane.ctx()).toBe("main");
  expect(pane.main.title.startsWith("Patch")).toBe(true);
  commands.length = 0;
  await press(pane, "q");
  expect(commands.some(([n]) => n === "pane.close")).toBe(true);
});

test("ctrl-p on a working file and on review open those as panes", async () => {
  sh("echo more >> f.txt");
  const v = await open();
  v.setPanel("files"); v.tree = false; v.moveTo(0); await settle(v);
  expect(v.showNow()).toEqual({ kind: "file", path: "f.txt" });
  v.setTab("review"); await settle(v);
  expect(v.showNow()).toMatchObject({ kind: "review", scope: "work", path: "f.txt" });
  sh("git checkout -q -- f.txt");
});

test("opened from GitHub ({pr, back}): q and esc put the GitHub window back", async () => {
  const v = await open();
  v.backTo = { mod: "nocturne-github", props: { tab: "prs" } };
  let reopened: any = null;
  v.goBack = () => { reopened = v.backTo; };
  await press(v, "q");
  expect(reopened?.mod).toBe("nocturne-github");
});
