// The git window (git/main.ts) on a real scratch repo: herdr and
// gpui are stand-ins, but exec runs the real git, so reading, the panels,
// keys and actions run through the window's code down to git.
import { test, expect, mock, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Ada Lovelace", GIT_AUTHOR_EMAIL: "a@x", GIT_COMMITTER_NAME: "Ada Lovelace", GIT_COMMITTER_EMAIL: "a@x" };
const dir = realpathSync(mkdtempSync(join(tmpdir(), "git-view-")));
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
const commands: [string, any][] = [];
mock.module("herdr", () => ({
  settings: () => ({ zoom: zoomNow, font_family: "Mono" }), window: () => ({ platform: "linux" }), theme: () => theme,
  shared: (k: string) => sharedState[k] ?? null,
  setShared: (k: string, v: unknown) => { sharedState[k] = v; },
  props: () => propsNow,
  spaces: () => spacesNow, panes: () => panesNow, focused: () => null, agents: () => agentsNow, home: () => homeNow,
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

test("review: the Files panel's Review tab marks and hides like diff", async () => {
  sh("echo r > review.txt && echo r > review2.txt");
  const v = await open();
  v.setPanel("files"); v.setTab("review"); await settle(v);
  expect(v.ctx()).toBe("review");
  const n = v.items("review").length;
  expect(n).toBeGreaterThan(0);
  await press(v, "space");
  expect(v.review.marks().size).toBe(1);
  expect((sharedState["diff.reviewed"] as any)[v.git.root].length).toBe(1);
  await press(v, "a");
  expect(v.review.marks().size).toBe(n);
  await press(v, "a");
  expect(v.review.marks().size).toBe(0);
  await press(v, "s");
  expect(v.review.scope).toBe("branch");
  await press(v, "q");
  sh("rm review.txt review2.txt");
});

test("keys: ? opens the keys overview (keyhelp.ts), its rows run; the bar follows the context; right-click has the row's actions", async () => {
  const v = await open();
  v.setPanel("commits"); await settle(v);
  await press(v, "?");
  expect(v.popups.kind).toBe("keys");
  expect(v.popups.top.rows.some((x: any) => x[1] === "Squash into the commit below")).toBe(true);
  expect(v.popups.top.sections.map((x: any) => x.title)).toEqual(expect.arrayContaining(["global"]));
  v.render();
  // ? closes it as esc does; j moves the cursor over the rows.
  await press(v, "?");
  expect(v.popups.open).toBe(false);
  await press(v, "?");
  await press(v, "j");
  expect(v.popups.top.sel).toBe(1);
  await press(v, "escape");
  expect(v.popups.open).toBe(false);
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
  expect(args.mod).toBe("git");
  expect(args.props.show).toEqual({ kind: "commit", hash: v.data.commits[0].hash });
  await press(v, ["p", { control: true, shift: true }]);
  expect(commands.some(([n, a]) => n === "tab.new" && a.mod === "git")).toBe(true);
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

test("branches: the main view shows the branch's log on the lane graph; ctrl-p opens it as a log pane", async () => {
  const v = await open();
  v.setPanel("branches"); await settle(v);
  v.moveTo(v.items("branches").findIndex((b: any) => b.name === "main")); await settle(v);
  const rows = v.main.rows;
  expect(v.main.title).toBe("Log · main");
  const heads = rows.filter((r: any) => r.kind === "log" && r.node);
  expect(heads.length).toBeGreaterThan(2);
  expect(heads[0].parts[0][0]).toMatch(/^commit [0-9a-f]{7}$/);
  expect(rows.some((r: any) => r.kind === "log" && r.parts[0]?.[0] === "Merge: ")).toBe(true);
  expect(rows.some((r: any) => r.kind === "log" && r.parts[0]?.[0] === "Author: ")).toBe(true);
  expect(heads.some((r: any) => r.g.merge)).toBe(true);
  expect(Math.max(...heads.map((r: any) => r.w))).toBe(2);
  v.render();
  expect(v.showNow()).toEqual({ kind: "log", ref: "main" });
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
  v.backTo = { mod: "github", props: { tab: "prs" } };
  let reopened: any = null;
  v.goBack = () => { reopened = v.backTo; };
  await press(v, "q");
  expect(reopened?.mod).toBe("github");
});

/** 310 commits with a side branch open across the cut (made once). */
function longRepo() {
  const long = join(dir, "long");
  if (existsSync(long)) return long;
  mkdirSync(long);
  let stream = "";
  for (let i = 1; i <= 310; i++) {
    const from = i === 1 ? "" : `from :${i - 1}\n`;
    stream += `commit refs/heads/main\nmark :${i}\ncommitter Ada <a@x> ${1700000000 + i} +0000\ndata ${`c${i}`.length}\nc${i}\n${from}${i === 310 ? "merge :5\n" : ""}\n`;
  }
  writeFileSync(join(dir, "long.fi"), stream);
  sh("git init -q -b main && git fast-import --quiet < ../long.fi && git checkout -q main", long);
  return long;
}

test("a log cut at its limit: the rows that fit follow the row height, the open lanes run to the bottom", async () => {
  // 310 commits with a side branch open across the cut: more than the branch
  // log (200) and the Commits panel (300) read.
  const long = longRepo();
  sharedState = {};
  const v = new GitView();
  v.init({ folder: long }, cx);
  await settle(v);
  v.render();

  // The main view first shows a diff (18 px rows), then the branch log (16 px)
  // in the same space: the log fills it rather than keeping the diff's count.
  v.mainPx = { main: 320 };
  v.setPanel("commits"); await settle(v); v.render();
  expect(v.mainVis).toBe(Math.floor(320 / 18));
  v.setPanel("branches"); await settle(v); v.render();
  expect(v.main.title).toBe("Log · main");
  expect(v.mainVis).toBe(Math.floor(320 / 16));

  // The last commit read (the 200th) still has its parent's lane open: the
  // view draws it on below the last row.
  const last = v.main.rows[v.main.rows.length - 1];
  expect(last.g.after.some((c: any) => c != null)).toBe(true);
  const { logTail } = await import("../defaults/mods/git/draw.ts");
  expect(logTail(theme, last, 100)).not.toBe(null);
  expect(logTail(theme, { kind: "log", g: { after: [] }, w: 1 }, 100)).toBe(null);

  // The Commits panel at its limit (300): the same below its last row, also
  // after going wide (taller rows, more rows' worth of height kept).
  expect(v.data.commits.length).toBe(300);
  const end = v.data.commits.length - 1;
  expect(v.graph.rows[end].after.some((c: any) => c != null)).toBe(true);
  expect(v.listTail(theme, "commits", end, 18)).not.toBe(null);
  v.listPx = { commits: 360 };
  v.setPanel("commits"); v.mode = "half"; v.render();
  expect(v.vis.commits).toBe(Math.floor(360 / 32));
  v.mode = "normal"; v.render();
  expect(v.vis.commits).toBe(Math.floor(360 / 18));
});

// The end of every view is reachable with its last row whole, at Developer's
// zoom (0.9) and at 1: a list's height arrives in window px (on_size_change),
// is unzoomed to layout units, and fits whole rows of the list's row height.
for (const zoom of [0.9, 1]) {
  test(`zoom ${zoom}: at the end of every list the last row ends inside the list`, async () => {
    zoomNow = zoom;
    try {
      const { rowWindow } = await import("../defaults/mods/git/draw.ts");
      const { unzoom } = await import("../defaults/mods/git/draw.ts");
      // Each row height the window draws: side lists, wide commits, diffs, the branch log.
      for (const rowH of [18, 32, 16]) {
        for (const raw of [137, 300, 745, 735.5, 1203.3]) { // measured window px
          for (const n of [1, 5, 57, 61, 400]) {
            const { top, vis } = rowWindow(n, 1e9, unzoom(raw), rowH);
            expect(top).toBe(Math.max(0, n - vis)); // G / bottom / the wheel stop here
            const lastBottom = (n - top) * rowH * zoom; // where the last row ends, in window px
            expect(lastBottom).toBeLessThanOrEqual(raw + 0.01);
            if (n > vis) expect(lastBottom + rowH * zoom).toBeGreaterThan(raw); // and no whole row's gap is left
          }
        }
      }
    } finally { zoomNow = 1; }
  });
}

test("a history cut at its limit reads further when its end comes into view: the Commits panel, a branch's commits, the branch log", async () => {
  const long = longRepo();
  sharedState = {};
  const v = new GitView();
  v.init({ folder: long }, cx);
  await settle(v);
  v.listPx = { commits: 360 }; v.mainPx = { main: 320 };
  v.setPanel("commits"); await settle(v); v.render(); await settle(v);
  expect(v.data.commits.length).toBe(300); // the top in view: nothing more read
  // To the end (end, >): the panel reads on, down to the root; the selection stays.
  await press(v, "end");
  expect(v.sel.commits).toBe(299);
  v.render(); await settle(v); v.render();
  expect(v.data.commits.length).toBe(310);
  expect(v.cut("commits")).toBe(false);
  expect(v.items("commits").at(-1).subject).toBe("c1");
  expect(v.graph.rows[309].after.every((c: any) => c == null)).toBe(true); // the lanes end at the root
  v.render(); await settle(v);
  expect(v.data.commits.length).toBe(310); // read once: the whole history is in

  // The branch log in the main view (200 at a time): scrolled to its end, it reads on.
  v.setPanel("branches"); await settle(v); v.render();
  expect(v.main.title).toBe("Log · main");
  expect(v.main.more).toBe("main");
  const before = v.main.rows.length;
  v.focusMain();
  for (let i = 0; i < 400 && v.mainTop + v.mainVis < v.main.rows.length - 1; i++) { v.scrollMain(1); v.render(); }
  const top = v.mainTop;
  await settle(v); v.render(); await settle(v);
  expect(v.main.rows.length).toBeGreaterThan(before);
  expect(v.main.more).toBe(null); // all 310 read
  expect(v.main.rows.some((r: any) => r.parts?.[0]?.[0] === "    c1")).toBe(true);
  expect(v.mainTop).toBe(top); // what was in view stays in view
  // To the very end: the root's last row is in view.
  for (let i = 0; i < 400; i++) { v.scrollMain(1); v.render(); }
  expect(v.mainTop + v.mainVis).toBeGreaterThanOrEqual(v.main.rows.length);

  // enter on the branch: its commits (300), to the end, read on.
  v.focus = "side"; v.setPanel("branches"); await settle(v);
  v.listPx.subCommits = 360;
  await press(v, "enter");
  expect(v.items("subCommits").length).toBe(300);
  await press(v, "end");
  v.render(); await settle(v); v.render();
  expect(v.items("subCommits").length).toBe(310);
  expect(v.cut("subCommits")).toBe(false);

  // A filtered list's end isn't the history's: no read.
  const v2 = new GitView();
  sharedState = {};
  v2.init({ folder: long }, cx);
  await settle(v2);
  v2.listPx = { commits: 360 };
  v2.setPanel("commits"); v2.filters.commits = "c30"; v2.render(); await settle(v2);
  expect(v2.data.commits.length).toBe(300);
});

test("an operation's row spins from the key to its end: push marks the pushed branch, a failure and a throw release it too", async () => {
  const { rowKey } = await import("../defaults/mods/git/items.ts");
  // A clone: main tracks origin/main on a bare remote.
  const remote = join(dir, "busy-remote.git"), work = join(dir, "busy-work");
  sh(`git clone -q --bare ${repo} ${remote} && git clone -q ${remote} ${work}`, dir);
  sh("git commit -q --allow-empty -m 'to push'", work);
  sharedState = {};
  const v = new GitView();
  v.init({ folder: work }, cx);
  await settle(v);
  v.setPanel("commits"); await settle(v); v.render(); // another row is selected: the mark follows the branch, not the selection
  expect(v.selectedRow()).toMatch(/^commit:/);

  v.run("push", cx);
  expect([...v.busyRows.keys()]).toEqual(["branch:main"]); // at once, before git runs
  v.setPanel("branches"); v.render(); // the row draws its mark (busyMark) without throwing
  expect(v.busyRows.has(rowKey("branches", v.items("branches").find((b: any) => b.name === "main")))).toBe(true);
  await settle(v);
  expect(v.busyRows.size).toBe(0); // done
  expect(sh("git log -1 --format=%s main", remote).trim()).toBe("to push");

  // A push that fails (the remote is gone): marked while it runs, released after, the error shown.
  sh(`git commit -q --allow-empty -m 'second' && git remote set-url origin ${join(dir, "nowhere.git")}`, work);
  await v.reloadNow(); await settle(v);
  v.run("push", cx);
  expect(v.busyRows.get("branch:main")).toBe(1);
  await settle(v);
  expect(v.busyRows.size).toBe(0);
  expect(v.popups.kind).toBe("confirm"); // the error popup
  v.popups.close();

  // A row action (the selected commit's revert, refused here) and an operation that throws.
  v.setPanel("commits"); await settle(v);
  const row = v.selectedRow();
  v.exec("Revert", ["revert", "--no-edit", "no-such-commit"]);
  expect(v.busyRows.get(row)).toBe(1);
  await settle(v);
  expect(v.busyRows.size).toBe(0);
  v.popups.close();
  v.spawn(async () => { throw new Error("boom"); });
  expect(v.busyRows.get(row)).toBe(1);
  await settle(v);
  expect(v.busyRows.size).toBe(0);
  v.popups.close();

  // Two operations on one row: busy until both end. Fetch all marks no row.
  v.spawn(async () => {}); v.spawn(async () => {});
  expect(v.busyRows.get(row)).toBe(2);
  await settle(v);
  expect(v.busyRows.size).toBe(0);
  v.run("fetch", cx);
  expect(v.busyRows.size).toBe(0);
  await settle(v); v.popups.close();
});

test("worktrees: n checks a branch out under ~/.herdr/worktrees and opens it as a space; space goes to its space; d removes it", async () => {
  homeNow = join(dir, "home");
  commands.length = 0;
  const v = await open();
  v.setPanel("files"); v.setTab("worktrees"); await settle(v);
  expect(v.items("worktrees").map((w: any) => w.main)).toEqual([true]);
  // n: the prompt offers the branches not checked out anywhere.
  await press(v, "n");
  expect(v.popups.kind).toBe("prompt");
  expect(v.popups.suggestions(v.popups.top).map((s: any) => s.value)).toEqual(["side"]);
  v.popups.top.input.set_value("feat/wt");
  await press(v, "enter");
  const path = join(homeNow, ".herdr/worktrees/repo/feat-wt");
  expect(sh("git worktree list --porcelain")).toContain(`worktree ${path}`);
  expect(sh("git -C " + path + " branch --show-current").trim()).toBe("feat/wt");
  expect(commands.find(([n]) => n === "space.new")?.[1]).toMatchObject({ folder: path });
  // A space on it now: space goes there instead of making another.
  spacesNow = [{ id: "s9", name: "feat-wt", machine: null, attached: true, folder: path, tabs: [] }];
  agentsNow = [];
  v.setTab("worktrees"); await settle(v);
  const i = v.items("worktrees").findIndex((x: any) => x.path === path);
  v.moveTo(i); await settle(v);
  expect(v.main.title).toBe("Worktree · feat/wt");
  expect(v.main.rows.some((r: any) => r.parts?.[1]?.[0] === "feat-wt")).toBe(true);
  commands.length = 0;
  await press(v, "space");
  expect(commands[0]).toEqual(["space.select", { id: "s9" }]);
  // d: a confirm that names what goes; b also deletes the branch.
  sh(`echo x > ${path}/dirty.txt`);
  await press(v, "d");
  expect(v.popups.kind).toBe("confirm");
  expect(v.popups.top.lines.some(([s]: any) => s.includes("1 uncommitted file"))).toBe(true);
  expect(v.popups.top.lines.some(([s]: any) => s.includes("closes 1 space"))).toBe(true);
  await press(v, "b", "enter");
  expect(sh("git worktree list --porcelain")).not.toContain(path);
  expect(sh("git branch --list feat/wt").trim()).toBe("");
  expect(commands.some(([n, a]) => n === "space.close" && a.id === "s9")).toBe(true);
  spacesNow = [];
});

// The Agents line named every agent "agent": it read a.name, which herdr's agent listing doesn't have.
test("worktrees: the main view names the agents in a checkout by their program", async () => {
  homeNow = join(dir, "home");
  sh(`git worktree add -q -b named ${join(homeNow, "wt-n")} HEAD`);
  agentsNow = [{ pane: "p1", status: "working", title: "fix the parser", program: { key: "claude", name: "Claude Code" } }];
  panesNow = [{ pane: "p1", tab: "t1", cwd: join(homeNow, "wt-n") }];
  const v = await open();
  v.setPanel("files"); v.setTab("worktrees"); await settle(v);
  const i = v.items("worktrees").findIndex((w: any) => w.path === join(homeNow, "wt-n"));
  v.moveTo(i); await settle(v);
  const agents = v.main.rows.find((r: any) => r.kind === "text" && r.parts[0][0].startsWith("Agents"));
  expect(agents.parts[1][0]).toBe("Claude Code (working)");
  sh(`git worktree remove --force ${join(homeNow, "wt-n")} && git branch -D named`);
  agentsNow = []; panesNow = [];
});

test("worktrees: the main checkout can't go; M picks merged ones, U unused ones, d removes the picked", async () => {
  homeNow = join(dir, "home");
  sh("git branch done-a && git branch done-b");
  sh(`git worktree add -q ${join(homeNow, "wt-a")} done-a && git worktree add -q ${join(homeNow, "wt-b")} done-b && git worktree add -q -b fresh ${join(homeNow, "wt-c")} HEAD`);
  sh(`cd ${join(homeNow, "wt-c")} && git commit -q --allow-empty -m 'not merged'`);
  agentsNow = [{ pane: "p1", name: "claude", status: "working" }];
  panesNow = [{ pane: "p1", tab: "t1", cwd: join(homeNow, "wt-a") }];
  const v = await open();
  v.setPanel("files"); v.setTab("worktrees"); await settle(v);
  v.moveTo(0); await settle(v);
  await press(v, "d");
  expect(v.popups.top.error).toBe(true);
  await press(v, "enter");
  await press(v, "M");
  expect([...v.wtPicked].sort()).toEqual([join(homeNow, "wt-a"), join(homeNow, "wt-b")]);
  await press(v, "U");
  expect([...v.wtPicked].sort()).toEqual([join(homeNow, "wt-b"), join(homeNow, "wt-c")]);
  await press(v, "escape");
  expect(v.wtPicked.size).toBe(0);
  await press(v, "M", "d");
  expect(v.popups.top.title).toBe("Remove 2 worktrees");
  expect(v.popups.top.lines.some(([s]: any) => s.includes("ends 1 agent"))).toBe(true);
  await press(v, "enter");
  const left = sh("git worktree list --porcelain");
  expect(left).not.toContain("wt-a");
  expect(left).not.toContain("wt-b");
  expect(left).toContain("wt-c");
  expect(sh("git branch --list done-a").trim()).toBe("done-a"); // b was off: the branches stay
  sh(`git worktree remove --force ${join(homeNow, "wt-c")} && git branch -D fresh done-a done-b`);
  agentsNow = []; panesNow = [];
});

test("worktrees: opened from a space's menu with a branch, tab and argv, it makes the worktree at once", async () => {
  homeNow = join(dir, "home");
  commands.length = 0;
  sharedState = {};
  const v = new GitView();
  v.init({ folder: repo, worktrees: { action: "new", branch: "agent/one", tab: "claude", argv: ["claude"] } }, cx);
  await settle(v); await settle(v);
  expect(v.tabOf.files).toBe("worktrees");
  const path = join(homeNow, ".herdr/worktrees/repo/agent-one");
  expect(sh("git worktree list --porcelain")).toContain(path);
  expect(commands.find(([n]) => n === "space.new")?.[1]).toEqual({ folder: path, machine: "", tab: "claude", argv: ["claude"] });
  sh(`git worktree remove --force ${path} && git branch -D agent/one`);
});
