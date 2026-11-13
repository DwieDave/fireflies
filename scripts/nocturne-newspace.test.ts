// The new-space picker (nocturne/newspace.js) and its list (folderlist.js):
// where the folders come from and in what order, the fuzzy filter, typed
// paths and tab completion, a space's name from its folder, every key of
// the flow, and that the space made (or attached) carries the folder.
// herdr is a stand-in: exec answers like git and find would, run() and
// openOverlay() are logged, nothing real is touched. mock.module is
// process-wide: this file runs in its own bun process.
import { test, expect, mock, beforeEach } from "bun:test";
import { Element, find, texts } from "./dialog-stubs.ts";

const HOME = "/home/dev";
const st: any = {};
function reset() {
  st.spaces = [
    { id: "s1", name: "fireflies", folder: `${HOME}/code/fireflies`, attached: true, machine: null, branch: "main", active: true, tabs: [{ id: "t1", active: true }] },
    { id: "s2", name: "notes", folder: `${HOME}/notes`, attached: true, machine: null, branch: null, active: false, tabs: [{ id: "t2" }] },
    { id: "s3", name: "loose", folder: HOME, attached: true, machine: null, branch: null, active: false, tabs: [{ id: "t3" }] },
  ];
  st.panes = [{ pane: "p1", tab: "t1", terminal: "a/1", cwd: `${HOME}/code/fireflies-wt/newspace/src` }];
  st.focused = { space: "s1", tab: "t1", pane: "p1", terminal: "a/1", cwd: `${HOME}/code/fireflies-wt/newspace/src` };
  st.shared = {};
  st.runs = [];
  st.opened = [];
  st.closed = [];
  st.props = { overlay: "ov1", role: "newspace" };
  st.execs = [];
  st.picked = null;
  // Folders on the fake disk, and which are git checkouts (.git dir) or worktrees (.git file).
  st.dirs = {
    [HOME]: ["code", "notes", ".config"],
    [`${HOME}/code`]: ["fireflies", "fireflies-wt", "herdr-core", "hc-scripts", "scratch"],
    [`${HOME}/code/fireflies-wt`]: ["newspace", "newspace-shots", "dock"],
  };
  st.git = new Set([`${HOME}/code/fireflies`, `${HOME}/code/herdr-core`, `${HOME}/code/hc-scripts`]);
  st.worktrees = new Set([`${HOME}/code/fireflies-wt/newspace`, `${HOME}/code/fireflies-wt/dock`]);
}
reset();

const dotGit = (dir: string) => [...st.git, ...st.worktrees].filter((g: string) => g.startsWith(dir + "/") && !g.slice(dir.length + 1).includes("/"));
async function fakeExec(cmd: string, args: string[], opts: any = {}) {
  st.execs.push([cmd, args, opts]);
  if (cmd === "git" && args[0] === "rev-parse") {
    const top = [...st.git, ...st.worktrees].find((g: string) => opts.cwd === g || opts.cwd.startsWith(g + "/"));
    return top ? { code: 0, stdout: `${top}\n${top.endsWith("newspace") ? "feat/newspace" : "main"}\n`, stderr: "" } : { code: 128, stdout: "", stderr: "" };
  }
  if (cmd === "git" && args[0] === "worktree") {
    if (opts.cwd === `${HOME}/code/fireflies`) return { code: 0, stdout: `worktree ${HOME}/code/fireflies\nHEAD 1\n\nworktree ${HOME}/code/fireflies-wt/newspace\nHEAD 2\n\nworktree ${HOME}/code/fireflies-wt/dock\nHEAD 3\n`, stderr: "" };
    if (opts.cwd === `${HOME}/code/fireflies-wt/newspace`) return { code: 0, stdout: `worktree ${HOME}/code/fireflies\nHEAD 1\n\nworktree ${HOME}/code/fireflies-wt/newspace\nHEAD 2\n`, stderr: "" };
    return { code: 128, stdout: "", stderr: "" };
  }
  if (cmd === "find") {
    const parents = args.slice(0, args.indexOf("-mindepth"));
    const files = args.includes("-type");
    const out = parents.flatMap((p) => dotGit(p).filter((g: string) => !files || st.worktrees.has(g)).map((g: string) => `${g}/.git`));
    return { code: 0, stdout: out.join("\n"), stderr: "" };
  }
  if (cmd === "sh") {
    const dir = args[3];
    if (!st.dirs[dir]) return { code: 1, stdout: "", stderr: "" };
    const names = st.dirs[dir].map((n: string) => `./${n}`);
    const gits = st.dirs[dir].filter((n: string) => st.git.has(`${dir}/${n}`) || st.worktrees.has(`${dir}/${n}`)).map((n: string) => `./${n}/.git`);
    return { code: 0, stdout: `${names.join("\n")}\n::\n${gits.join("\n")}\n`, stderr: "" };
  }
  if (cmd === "test") return { code: st.dirs[args[1]] || Object.values(st.dirs).some(() => false) ? 0 : 1, stdout: "", stderr: "" };
  return { code: 1, stdout: "", stderr: "" };
}

const theme: Record<string, string> = { accent: "#80a0ff", foreground: "#fff", background: "#000", muted: "#aaa", dim: "#777", ansi0: "#1", ansi8: "#8", blocked: "#f00", done: "#0f0", working: "#ff0" };
mock.module("herdr", () => ({
  notify: () => null, theme: () => theme, props: () => st.props, run: (n: string, a?: any) => { st.runs.push([n, a]); return null; },
  exec: (c: string, a: string[], o: any) => fakeExec(c, a, o), home: () => HOME, spaces: () => st.spaces, panes: () => st.panes,
  focused: () => st.focused, shared: (k: string) => st.shared[k] ?? null, setShared: (k: string, v: unknown) => { st.shared[k] = v; },
  openOverlay: (spec: any) => { st.opened.push(spec); return `ov${st.opened.length}`; }, closeOverlay: (id: unknown) => { st.closed.push(id); },
  pickFolder: async () => st.picked, settings: () => ({ zoom: st.zoom ?? 0.9 }), window: () => ({ platform: "macos" }),
  terminals: () => [], agents: () => [], hc: async () => ({ code: 1, stdout: "" }), keys: () => [], focusedTerminal: () => null,
}));

const L = await import("../defaults/mods/nocturne/folderlist.ts");
const { default: NewSpace, openSpacePicker, pickerOpen, RECENT, OPEN, WIDTH, LIST_SCRIPT } = await import("../defaults/mods/nocturne/newspace.ts");

/** A context whose spawns run, awaited with settle(). */
function cx() {
  const c: any = { notified: 0, stopped: 0, tasks: [] as Promise<unknown>[] };
  c.notify = () => { c.notified++; };
  c.stop_propagation = () => { c.stopped++; };
  c.timer = { after() {}, every() {} };
  c.spawn = (f: any) => { const p = f(c); c.tasks.push(p); return p; };
  c.bind_keys = () => 3;
  return c;
}
const settle = async (c: any) => { for (let i = 0; i < 5; i++) await Promise.all(c.tasks.splice(0)); };
const key = (name: string) => {
  const parts = name.split("-");
  const k = parts.pop()!;
  const has = (m: string) => parts.includes(m);
  return { key: k, key_char: k.length === 1 ? k : null, modifiers: { shift: has("shift"), control: has("ctrl"), alt: has("alt"), platform: has("cmd") } };
};

/** An open picker with its folders looked up. */
async function picker(props: any = {}) {
  st.props = { overlay: "ov1", role: "newspace", here: st.focused.cwd, ...props };
  const v: any = new NewSpace();
  const c = cx();
  v.init(st.props, c);
  await settle(c);
  return { v, c, k: async (name: string) => { const r = v.key(key(name), c); await settle(c); return r; } };
}
const type = async (v: any, c: any, text: string) => { v.input.set_value(text); v.input.handlers.change({}, c); await settle(c); };
const names = (v: any) => v.rows(null).all.map((r: any) => r.name);

beforeEach(reset);

// ---- the list (folderlist.js)

test("sources: here, then the spaces', then near, then recent; each folder once, home never", () => {
  const rows = L.sources({
    here: { path: "/h/a/newspace", branch: "feat/x" },
    spaces: [{ path: "/h/a/fireflies", branch: "main" }, { path: "/h/a/newspace", branch: "feat/x" }, { path: "/h" }],
    near: [{ path: "/h/a/dock", worktree: true }, { path: "/h/a/fireflies" }, { path: "/h/a/herdr-core" }],
    recent: ["/h/old", "/h/a/herdr-core"], home: "/h", git: new Set(["/h/old"]),
  });
  expect(rows.map((r: any) => [r.from, r.name, r.tag])).toEqual([
    ["here", "newspace", "feat/x"], ["spaces", "fireflies", "main"], ["near", "dock", "worktree"], ["near", "herdr-core", "git"], ["recent", "old", "git"],
  ]);
});

test("near: at most NEAR_MAX rows, counted after the folders listed already drop out", () => {
  const dup = Array.from({ length: 20 }, () => ({ path: "/h/a/fireflies" }));
  const near = [...dup, ...Array.from({ length: 15 }, (_, i) => ({ path: `/h/b/r${String(i).padStart(2, "0")}` }))];
  const rows = L.sources({ spaces: [{ path: "/h/a/fireflies" }], near, home: "/h" });
  expect(rows.filter((r: any) => r.from === "near").length).toBe(L.NEAR_MAX);
  expect(rows.find((r: any) => r.from === "near").name).toBe("r00");
});

test("rank: a match on the name beats one on the path; ties keep the sources' order; hits mark the name", () => {
  const rows = L.sources({ spaces: [{ path: "/h/hc/zeta" }, { path: "/h/x/herdr-core" }, { path: "/h/x/hc-scripts" }], home: "/h" });
  const r = L.rank(rows, "hc", "/h");
  expect(r.map((x: any) => x.name)).toEqual(["hc-scripts", "herdr-core", "zeta"]);
  expect(r[0].hits).toEqual([0, 1]);
  expect(r[2].hits).toEqual([]); // matched in its path only
  expect(L.rank(rows, "", "/h").map((x: any) => x.name)).toEqual(["zeta", "herdr-core", "hc-scripts"]);
  expect(L.rank(rows, "qq", "/h")).toEqual([]);
});

test("paths: ~ and / switch to a folder's subfolders; the folder itself leads when the field ends in /", () => {
  expect(L.isPath("~/co")).toBe(true);
  expect(L.isPath("/tmp")).toBe(true);
  expect(L.isPath("code")).toBe(false);
  expect(L.splitPath("~/co", "/h")).toEqual({ dir: "/h", prefix: "co", shown: "~/" });
  expect(L.splitPath("~", "/h")).toEqual({ dir: "/h", prefix: "", shown: "~/" });
  expect(L.splitPath("/usr/lo", "/h")).toEqual({ dir: "/usr", prefix: "lo", shown: "/usr/" });
  expect(L.splitPath("/us", "/h")).toEqual({ dir: "/", prefix: "us", shown: "/" });
  const names = ["fireflies", "Fireflies-old", ".hidden", "my-fire", "zed"];
  const r = L.pathRows("~/code/fi", "/h", names, new Set(["fireflies"]));
  expect(r.rows.map((x: any) => [x.name, x.tag])).toEqual([["fireflies", "git"], ["Fireflies-old", ""], ["my-fire", ""]]);
  expect(r.rows[0].path).toBe("/h/code/fireflies");
  expect(r.rows[2].hits).toEqual([3, 4]);
  const all = L.pathRows("~/code/", "/h", names, new Set(["."]));
  expect(all.rows[0]).toMatchObject({ path: "/h/code", from: "self", tag: "git" });
  expect(all.rows.map((x: any) => x.name)).not.toContain(".hidden");
  expect(L.pathRows("~/code/.h", "/h", names).rows.map((x: any) => x.name)).toEqual([".hidden"]);
  expect(L.pathRows("~/", "/h", ["code"]).rows.map((x: any) => x.from)).toEqual(["path"]); // home itself is "no folder"
});

test("completion: tab puts the row's path with a /; the ghost is the rest of its name; shift-tab is one folder up", () => {
  expect(L.complete({ path: "/h/code/fireflies" }, "/h")).toBe("~/code/fireflies/");
  expect(L.complete(null, "/h")).toBeNull();
  expect(L.ghost("~/code/fire", { path: "/h/code/fireflies", name: "fireflies", from: "path" }, "/h")).toBe("flies/");
  expect(L.ghost("~/code/", { path: "/h/code", name: "code", from: "self" }, "/h")).toBe("");
  expect(L.ghost("fire", { path: "/h/code/fireflies", name: "fireflies" }, "/h")).toBe("");
  expect(L.ghost("~/no/deep", { path: "/h/no/deep", name: "deep", from: "typed" }, "/h")).toBe("");
  expect(L.up("~/code/fireflies/")).toBe("~/code/");
  expect(L.up("~/code/fire")).toBe("~/code/");
  expect(L.up("~/code")).toBe("~/");
  expect(L.up("/usr")).toBe("/");
});

test("a space's name comes from its folder: unnamed unless named otherwise; no folder is home", () => {
  expect(L.folderName("/h/code/fireflies", "/h")).toBe("fireflies");
  expect(L.folderName("/h", "/h")).toBe("~");
  expect(L.newArgs("/h/code/fireflies", "", "/h")).toEqual({ folder: "/h/code/fireflies", machine: "" });
  expect(L.newArgs("/h/code/fireflies", " fireflies ", "/h")).toEqual({ folder: "/h/code/fireflies", machine: "" });
  expect(L.newArgs("/h/code/fireflies", "review", "/h")).toEqual({ name: "review", folder: "/h/code/fireflies", machine: "" });
  expect(L.newArgs(null, "", "/h")).toEqual({ folder: "/h", machine: "" });
  expect(L.newArgs(null, "web", "/h")).toEqual({ name: "web", folder: "/h", machine: "" });
});

test("the small parts: recent, ~, the tail of a long path, git's lists", () => {
  const many = Array.from({ length: 25 }, (_, i) => `/p${i}`);
  const r = L.remember(many, "/p3");
  expect(r[0]).toBe("/p3");
  expect(r.length).toBe(L.RECENT_MAX);
  expect(r.filter((x: string) => x === "/p3").length).toBe(1);
  expect(L.remember(null, "/a")).toEqual(["/a"]);
  expect(L.tilde("/h/a", "/h")).toBe("~/a");
  expect(L.untilde("~/a/", "/h")).toBe("/h/a");
  expect(L.untilde("a", "/h")).toBe("/h/a");
  expect(L.tail("~/Documents/personal/coding/fireflies-wt/newspace", 24)).toBe("…/fireflies-wt/newspace");
  expect(L.tail("~/short", 24)).toBe("~/short");
  expect(L.worktreePaths("worktree /a\nHEAD 1\n\nworktree /b\nbranch x\n")).toEqual(["/a", "/b"]);
  expect(L.checkoutsFrom("/p/b/.git\n/p/a/.git\n", new Set(["/p/b/.git"]))).toEqual([{ path: "/p/a", worktree: false }, { path: "/p/b", worktree: true }]);
  expect(L.nearParents(["/h/a/x", "/h/a/y", "/h", "/h/b/z"], "/h")).toEqual(["/h/a", "/h/b"]);
});

// ---- opening

test("opens hanging from the press that asked, centered without one; a second press closes it", () => {
  const at = { x: 8, y: 60 };
  const id = openSpacePicker({ at });
  expect(st.opened[0]).toMatchObject({ mod: "nocturne", kind: "popup", frame: "none", width: WIDTH, at, props: { role: "newspace", here: st.focused.cwd } });
  expect(st.shared[OPEN]).toEqual({ id, space: null });
  expect(pickerOpen()).toBe(true); // "+ new" lit
  expect(openSpacePicker({ at })).toBeNull(); // open: the key closes it
  expect(st.closed).toEqual([id]);
  expect(st.shared[OPEN]).toBeNull();
  expect(openSpacePicker({ at, wasOpen: true })).toBeNull(); // the press that closed it doesn't reopen it
  openSpacePicker();
  expect(st.opened.at(-1)).toMatchObject({ kind: "dialog" });
  expect(st.opened.at(-1).at).toBeUndefined();
  const n = st.opened.length;
  openSpacePicker({ space: "s2" }); // another kind: replaces the open one
  expect(st.opened.length).toBe(n + 1);
  expect(st.opened.at(-1).props).toMatchObject({ role: "newspace", space: "s2" });
  expect(st.closed.at(-1)).toBe(`ov${n}`);
  expect(pickerOpen()).toBe(false); // attaching: "+ new" stays dark
  openSpacePicker({ space: "s2" }); // the same again: closes it
  expect(st.opened.length).toBe(n + 1);
  expect(st.shared[OPEN]).toBeNull();
});

// ---- the list in the picker

test("the folders: here (its checkout's top), the spaces', worktrees and checkouts beside them; browse, then no folder last", async () => {
  const { v } = await picker();
  const rows = v.rows(null).all;
  expect(rows.map((r: any) => [r.from ?? r.kind, r.name, r.tag ?? ""])).toEqual([
    ["here", "newspace", "feat/newspace"],
    ["spaces", "fireflies", "main"],
    ["spaces", "notes", ""],
    ["near", "dock", "worktree"],
    ["near", "hc-scripts", "git"],
    ["near", "herdr-core", "git"],
    ["browse", "browse…", ""],
    ["loose", "no folder", ""],
  ]);
  expect(rows.some((r: any) => r.path === HOME)).toBe(false); // the space in home is "no folder"
  expect(v.cursor).toBe(0);
});

test("enter makes the space in the row's folder, unnamed (called after it), and remembers the folder", async () => {
  const { v, k } = await picker();
  expect(await k("enter")).toBe(true);
  expect(st.runs).toEqual([["space.new", { folder: `${HOME}/code/fireflies-wt/newspace`, machine: "" }]]);
  expect(st.shared[RECENT]).toEqual([`${HOME}/code/fireflies-wt/newspace`]);
  expect(st.closed).toEqual(["ov1"]);
  expect(await k("enter")).toBe(true); // closed: nothing more
  expect(st.runs.length).toBe(1);
  expect(v.done).toBe(true);
});

test("recent folders come after the others", async () => {
  st.shared[RECENT] = [`${HOME}/old/thing`, `${HOME}/code/fireflies`];
  const { v } = await picker();
  const rows = v.rows(null).all.filter((r: any) => r.kind === "folder");
  expect(rows.at(-1)).toMatchObject({ from: "recent", name: "thing" });
  expect(rows.filter((r: any) => r.name === "fireflies").length).toBe(1);
});

test("↑ ↓ (ctrl-p ctrl-n) move and wrap: ↑ from the top is no folder, which makes a space in ~", async () => {
  const { v, k } = await picker();
  await k("down");
  expect(v.cursor).toBe(1);
  await k("ctrl-n");
  expect(v.cursor).toBe(2);
  await k("ctrl-p"); await k("up"); await k("up");
  expect(v.rows(null).all[v.cursor].kind).toBe("loose");
  await k("enter");
  expect(st.runs).toEqual([["space.new", { folder: HOME, machine: "" }]]);
  expect(st.shared[RECENT] ?? null).toBeNull(); // home isn't a recent folder
});

test("typing filters on the name first, then the path", async () => {
  const { v, c } = await picker();
  await type(v, c, "hc");
  expect(names(v)).toEqual(["hc-scripts", "herdr-core", "browse…", "no folder"]);
  await type(v, c, "wt");
  expect(names(v).slice(0, 2)).toEqual(["newspace", "dock"]); // in fireflies-wt: their paths match
  await type(v, c, "zzz");
  expect(names(v)).toEqual(["browse…", "no folder"]);
});

test("a path lists its subfolders; tab completes the row and steps inside; shift-tab goes up", async () => {
  const { v, c, k } = await picker();
  await type(v, c, "~/code/fire");
  expect(names(v)).toEqual(["fireflies", "fireflies-wt", "browse…", "no folder"]);
  expect(v.rows(null).all[0].tag).toBe("git");
  let r = v.render(c);
  expect(texts(find(r, "ns-foot"))).toContain("flies/"); // the ghost: tab gives the rest
  expect(await k("down")).toBe(true);
  expect(await k("tab")).toBe(true);
  expect(v.query).toBe("~/code/fireflies-wt/");
  expect(v.input.value()).toBe("~/code/fireflies-wt/");
  expect(names(v)).toEqual(["fireflies-wt", "dock", "newspace", "newspace-shots", "browse…", "no folder"]);
  expect(v.rows(null).all[0].from).toBe("self"); // enter now takes the folder itself
  await k("shift-tab");
  expect(v.query).toBe("~/code/");
  await k("tab"); // on "code" itself: stays
  expect(v.query).toBe("~/code/");
  await type(v, c, "~/code/fireflies-wt/newsp");
  await k("down");
  await k("enter");
  expect(st.runs).toEqual([["space.new", { folder: `${HOME}/code/fireflies-wt/newspace-shots`, machine: "" }]]);
});

test("the subfolder listing runs as is: a folder that isn't a checkout still lists (exit 0), checkouts marked, a missing one fails", () => {
  const { mkdtempSync, mkdirSync, realpathSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const root = realpathSync(mkdtempSync(`${tmpdir()}/ns-list-`));
  mkdirSync(`${root}/repo/.git`, { recursive: true });
  mkdirSync(`${root}/plain`);
  const sh = (dir: string) => Bun.spawnSync(["sh", "-c", LIST_SCRIPT, "sh", dir]);
  const r = sh(root);
  expect(r.exitCode).toBe(0);
  const [dirs, gits] = r.stdout.toString().split("::");
  expect(dirs.split("\n").filter(Boolean).sort()).toEqual(["./plain", "./repo"]);
  expect(gits.split("\n").filter(Boolean)).toEqual(["./repo/.git"]);
  expect(sh(`${root}/repo`).stdout.toString()).toContain("./.git");
  expect(sh(`${root}/nope`).exitCode).toBe(1);
});

test("tab outside a path starts one at ~; on a folder row it lists inside that folder", async () => {
  const { v, c, k } = await picker();
  await k("tab");
  expect(v.query).toBe("~/code/fireflies-wt/newspace/");
  await type(v, c, "zzz");
  await k("tab"); // on browse: a path from ~
  expect(v.query).toBe("~/");
  expect(names(v)).toEqual(["code", "notes", "browse…", "no folder"]);
});

test("a typed path that isn't there says so in place and makes nothing; one that is, is made", async () => {
  const { v, c, k } = await picker();
  await type(v, c, "~/nowhere/deep");
  expect(v.rows(null).all[0]).toMatchObject({ from: "typed", path: `${HOME}/nowhere/deep` });
  let r = v.render(c);
  expect(texts(find(r, "ns-none")).join("")).toContain('starts with "deep"');
  await k("enter");
  expect(st.runs).toEqual([]);
  expect(v.error).toBe("no folder ~/nowhere/deep");
  r = v.render(c);
  expect(texts(find(r, "ns-say"))).toEqual(["no folder ~/nowhere/deep"]);
  await type(v, c, "~/code/scratch/");
  st.dirs[`${HOME}/code/scratch`] = [];
  v.lists.clear();
  await type(v, c, "~/code/scratch/x");
  await type(v, c, "~/code/scratch");
  await k("enter");
  expect(st.runs).toEqual([["space.new", { folder: `${HOME}/code/scratch`, machine: "" }]]);
});

test("cmd-enter names it first: the folder's name in the field; esc goes back; enter makes it named", async () => {
  const { v, c, k } = await picker();
  await k("down"); // fireflies
  expect(await k("cmd-enter")).toBe(true);
  expect(v.naming).toEqual({ folder: `${HOME}/code/fireflies` });
  expect(v.nameInput.value()).toBe("fireflies");
  let r = v.render(c);
  expect(find(r, "ns-name-field")).toBeTruthy();
  expect(texts(find(r, "ns-say"))).toEqual(['"fireflies" in ~/code/fireflies']);
  expect(await k("down")).toBe(false); // the name field's own
  await k("escape");
  expect(v.naming).toBeNull();
  expect(st.closed).toEqual([]); // back to the list, still open
  await k("cmd-enter");
  v.nameInput.set_value("review");
  await k("enter");
  expect(st.runs).toEqual([["space.new", { name: "review", folder: `${HOME}/code/fireflies`, machine: "" }]]);
});

test("cmd-enter on no folder: a named space in ~", async () => {
  const { v, k } = await picker();
  await k("up");
  await k("cmd-enter");
  expect(v.naming).toEqual({ folder: null });
  expect(v.nameInput.value()).toBe("");
  v.nameInput.set_value("web");
  v.nameInput.handlers.submit({}, v);
  expect(st.runs).toEqual([["space.new", { name: "web", folder: HOME, machine: "" }]]);
});

test("the input's own submit (enter, and cmd-enter as secondary) does the same as the keys", async () => {
  const { v, c } = await picker();
  v.input.handlers.submit({ secondary: true }, c);
  expect(v.naming).toMatchObject({ folder: `${HOME}/code/fireflies-wt/newspace` });
  v.escape(c);
  v.input.handlers.submit({}, c);
  expect(st.runs).toEqual([["space.new", { folder: `${HOME}/code/fireflies-wt/newspace`, machine: "" }]]);
});

test("esc closes, from the key, the bound action and the esc chip", async () => {
  let p = await picker();
  await p.k("escape");
  expect(st.closed).toEqual(["ov1"]);
  p = await picker();
  const r: any = p.v.render(p.c);
  r.actions["newspace::escape"]({}, p.c);
  expect(st.closed).toEqual(["ov1", "ov1"]);
  p = await picker();
  const chip: any = find(p.v.render(p.c), "ns-esc");
  chip.calls.on_click[0]({}, p.c);
  expect(st.closed.length).toBe(3);
  expect(st.runs).toEqual([]);
});

test("tab and shift-tab arrive as the picker's bound actions (the root binds them to focus)", async () => {
  const { v, c } = await picker();
  const r: any = v.render(c);
  expect(r.calls.key_context[0]).toBe("NewSpace");
  r.actions["newspace::tab"]({}, c);
  expect(v.query).toBe("~/code/fireflies-wt/newspace/");
  r.actions["newspace::tab_back"]({}, c);
  expect(v.query).toBe("~/code/fireflies-wt/");
});

test("a click on a row picks it; the pointer moving over a row moves the cursor, resting doesn't", async () => {
  const { v, c } = await picker();
  const r: any = v.render(c);
  const row: any = find(r, "ns-row-1");
  expect(row.calls.on_hover).toBeUndefined(); // no hover: a pointer resting where the list opens takes nothing
  row.calls.on_mouse_move[0]({}, c);
  expect(v.cursor).toBe(1);
  row.calls.on_click[0]({}, c);
  expect(st.runs).toEqual([["space.new", { folder: `${HOME}/code/fireflies`, machine: "" }]]);
});

test("browse… opens the system's folder browser and makes the space in what it picks", async () => {
  const { v, c, k } = await picker();
  st.picked = `${HOME}/elsewhere`;
  v.cursor = names(v).indexOf("browse…");
  await k("enter");
  expect(st.runs).toEqual([["space.new", { folder: `${HOME}/elsewhere`, machine: "" }]]);
  // Cancelled: nothing, and the picker stays.
  const p = await picker();
  st.picked = null;
  p.v.cursor = names(p.v).indexOf("browse…");
  await p.k("enter");
  expect(st.runs.length).toBe(1);
  expect(p.v.done).toBe(false);
});

test("drawn: sections over the rows, the cursor's band, what enter does in the footer", async () => {
  const { v, c } = await picker();
  const r: any = v.render(c);
  expect(texts(find(r, "ns-sec-here"))).toEqual(["HERE"]);
  expect(texts(find(r, "ns-sec-spaces"))).toEqual(["SPACES"]);
  expect(texts(find(r, "ns-sec-near"))).toEqual(["NEAR"]);
  expect(texts(find(r, "ns-say"))).toEqual(['"newspace" in …/fireflies-wt/newspace']);
  expect(texts(find(r, "ns-foot"))).toEqual(expect.arrayContaining(["enter", "make", "⌘enter", "name it"]));
  expect(texts(r)).toContain("new space");
  const on: any = find(r, "ns-row-0");
  expect(on.nodes.some((n: any) => n?.calls?.bg?.[0] === theme.accent)).toBe(true); // the blue edge
  v.cursor = names(v).indexOf("no folder");
  expect(texts(find(v.render(c), "ns-say"))).toEqual(["a space with no folder, in ~"]);
});

// ---- attaching a space to another folder

test("attach: the space's folder now leads; enter on another attaches it there; no folder detaches", async () => {
  const { v, c, k } = await picker({ space: "s1" });
  const rows = v.rows(null).all;
  expect(rows[0]).toMatchObject({ from: "now", name: "fireflies", tag: "now" });
  expect(rows.filter((r: any) => r.name === "fireflies").length).toBe(1);
  let r: any = v.render(c);
  expect(texts(r)).toContain("attach fireflies to");
  expect(texts(find(r, "ns-say"))).toEqual(["fireflies stays where it is"]);
  await k("down");
  expect(texts(find(v.render(c), "ns-say"))[0]).toStartWith("fireflies moves to");
  await k("cmd-enter"); // no naming when attaching: it attaches
  expect(st.runs).toEqual([["space.folder", { id: "s1", folder: rows[1].path }]]);
  const p = await picker({ space: "s1" });
  await p.k("up");
  expect(texts(find(p.v.render(p.c), "ns-say"))).toEqual(["fireflies detaches, back to ~"]);
  await p.k("enter");
  expect(st.runs.at(-1)).toEqual(["space.folder", { id: "s1", folder: HOME }]);
});

test("attach by a typed path", async () => {
  const { v, c, k } = await picker({ space: "s2" });
  await type(v, c, "~/code/herdr");
  await k("enter");
  expect(st.runs).toEqual([["space.folder", { id: "s2", folder: `${HOME}/code/herdr-core` }]]);
  expect(st.shared[RECENT]).toEqual([`${HOME}/code/herdr-core`]);
});

// ---- where it's opened from

test("the sidebar's + new hangs the picker under itself; the press on a lit + new only closes it", async () => {
  const { default: Spaces } = await import("../defaults/mods/nocturne/spaces.ts");
  const s: any = new Spaces();
  s.init(cx());
  const press = { position: { x: 220, y: 40 }, local_position: { x: 12, y: 9 }, bounds: { width: 40, height: 18 } };
  let r: any = s.render(theme, null);
  const chip: any = find(r, "space-new-start");
  chip.calls.on_mouse_down[1](press, cx()); // the last on_mouse_down: the press recorder
  chip.calls.on_click[0]({}, cx());
  expect(st.opened.at(-1)).toMatchObject({ kind: "popup", at: { x: 8, y: Math.round(40 - 9 + 18 + 6 * 0.9) }, props: { role: "newspace" } });
  // Lit: the press closes it (the popup's click-outside); the click doesn't reopen it.
  const n = st.opened.length;
  chip.calls.on_mouse_down[1](press, cx());
  st.shared[OPEN] = null;
  chip.calls.on_click[0]({}, cx());
  expect(st.opened.length).toBe(n);
});

test("Change folder… hangs it under the row right-clicked; from a key or the folded rail it's centered", async () => {
  const { default: Spaces } = await import("../defaults/mods/nocturne/spaces.ts");
  const { EDIT_SPACE } = await import("../defaults/mods/nocturne/menu.ts");
  const s: any = new Spaces();
  s.init(cx());
  const r: any = s.render(theme, null);
  const row: any = find(r, "space-s2");
  const press = { position: { x: 60, y: 120 }, local_position: { x: 50, y: 10 }, bounds: { width: 248, height: 24 } };
  row.calls.on_mouse_down[1](press, cx()); // right
  st.shared[EDIT_SPACE] = { id: "s2", kind: "folder", at: 1 };
  s.answer(false, cx());
  expect(st.opened.at(-1)).toMatchObject({ kind: "popup", props: { role: "newspace", space: "s2" } });
  expect(st.opened.at(-1).at.y).toBe(Math.round(110 + 24 + 6 * 0.9));
  st.shared[EDIT_SPACE] = { id: "s2", kind: "folder", at: 2 };
  s.answer(true, cx()); // the folded rail
  expect(st.opened.at(-1)).toMatchObject({ kind: "dialog", props: { space: "s2" } });
  s.acts(st.spaces[0]).folder(cx()); // f on a row
  expect(st.opened.at(-1)).toMatchObject({ kind: "dialog", props: { space: "s1" } });
});

// ---- the dock (dock.js) keeps its rules

test("the dock is never attached: no picker opens for it, and an open one attaches nothing", async () => {
  const { DOCK_KEY } = await import("../defaults/mods/nocturne/dock.ts");
  st.spaces.push({ id: "dk", name: "dock", named: true, folder: HOME, attached: true, machine: null, branch: null, active: false, tabs: [{ id: "t9" }] });
  st.shared[DOCK_KEY] = { id: "dk" };
  expect(openSpacePicker({ space: "dk" })).toBeNull();
  expect(openSpacePicker({ space: "dk", at: { x: 8, y: 8 }, replace: true })).toBeNull();
  expect(st.opened).toEqual([]);
  const { v, k } = await picker({ space: "dk" }); // forced open anyway
  await k("enter");
  expect(st.runs).toEqual([]);
  expect(st.closed).toEqual(["ov1"]);
  void v;
});

test("the dock isn't a folder in the list, and no folder makes an ordinary unnamed space, not the dock", async () => {
  const { DOCK_KEY } = await import("../defaults/mods/nocturne/dock.ts");
  st.spaces.push({ id: "dk", name: "dock", named: true, folder: `${HOME}/code/scratch`, attached: true, machine: null, branch: null, active: false, tabs: [{ id: "t9" }] });
  st.shared[DOCK_KEY] = { id: "dk" };
  const { v, k } = await picker();
  expect(v.rows(null).all.some((r: any) => r.path === `${HOME}/code/scratch`)).toBe(false);
  await k("up");
  await k("enter");
  expect(st.runs).toEqual([["space.new", { folder: HOME, machine: "" }]]);
  expect(st.shared[DOCK_KEY]).toEqual({ id: "dk" }); // the dock's record untouched
});

// ---- the list's end (Developer: "scrolling to the bottom leads to this"): its
// children are rows, section heads and a rule, and scroll_to_item counts
// children, so the cursor's row is asked for by its child index.

/** A dozen worktrees beside the focused one, as in Developer's list. */
function manyWorktrees() {
  const wt = `${HOME}/code/fireflies-wt`;
  const more = ["api", "bench", "chrome", "docs", "edtabs2", "mdlive", "overlay", "procs", "procs2", "rename", "webpip", "zeta"];
  st.dirs[wt] = [...st.dirs[wt], ...more];
  for (const n of more) st.worktrees.add(`${wt}/${n}`);
}
const listNodes = (r: any) => find(r, "ns-list")!.nodes;
const rowAt = (r: any, i: number) => listNodes(r).findIndex((n: any) => n?.calls?.id?.[0] === `ns-row-${i}`);

for (const zoom of [0.9, 1.0]) {
  test(`at zoom ${zoom} the cursor's row is the child the list scrolls to, by keys down and up through the end`, async () => {
    st.zoom = zoom;
    manyWorktrees();
    const { v, c, k } = await picker();
    const n = v.rows(null).all.length;
    expect(n).toBeGreaterThan(14);
    // up from the first row wraps to the last ("no folder"), past every section head
    await k("up");
    let r: any = v.render(c);
    expect(v.cursor).toBe(n - 1);
    expect(v.scroll.items.at(-1)).toBe(rowAt(r, n - 1));
    expect(rowAt(r, n - 1)).toBeGreaterThan(n - 1); // heads and the rule before it: the old index fell short
    // the last folder row (Developer's "rename"), then browse…
    await k("up"); await k("up");
    r = v.render(c);
    expect(v.scroll.items.at(-1)).toBe(rowAt(r, n - 3));
    await k("down");
    r = v.render(c);
    expect(names(v)[v.cursor]).toBe("browse…");
    expect(v.scroll.items.at(-1)).toBe(rowAt(r, n - 2));
    // walking down to the end one row at a time asks for every row by its child
    v.cursor = 0;
    for (let i = 1; i < n; i++) {
      await k("down");
      r = v.render(c);
      expect(v.scroll.items.at(-1)).toBe(rowAt(r, i));
    }
    // and wrapping to the top shows the list's top, its first head
    await k("down");
    v.render(c);
    expect(v.cursor).toBe(0);
    expect(v.scroll.items.at(-1)).toBe(0);
    st.zoom = undefined;
  });
}

test("a render asks for the cursor's row once per move; the pointer moving the cursor doesn't scroll", async () => {
  manyWorktrees();
  const { v, c, k } = await picker();
  v.render(c);
  const before = v.scroll.items.length;
  v.render(c);
  expect(v.scroll.items.length).toBe(before);
  const r: any = v.render(c);
  find(r, "ns-row-5")!.calls.on_mouse_move[0]({}, c);
  v.render(c);
  expect(v.scroll.items.length).toBe(before);
  await k("down");
  v.render(c);
  expect(v.scroll.items.length).toBe(before + 1);
});

test("the list fits its popup: the popup's height holds the head, the longest list and the footer", () => {
  openSpacePicker({ at: { x: 10, y: 10 } });
  const spec = st.opened.at(-1);
  const HEAD = 34, ROW = 26, SEC = 24, FOOT = 28;
  // the list's max height, its 2 px padding above and below, the 1 px border twice
  expect(spec.height).toBeGreaterThanOrEqual(HEAD + 12 * ROW + 4 * SEC + 4 + FOOT + 2);
});
