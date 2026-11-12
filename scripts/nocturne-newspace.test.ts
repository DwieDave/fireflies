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
  theme: () => theme, props: () => st.props, run: (n: string, a?: any) => { st.runs.push([n, a]); return null; },
  exec: (c: string, a: string[], o: any) => fakeExec(c, a, o), home: () => HOME, spaces: () => st.spaces, panes: () => st.panes,
  focused: () => st.focused, shared: (k: string) => st.shared[k] ?? null, setShared: (k: string, v: unknown) => { st.shared[k] = v; },
  openOverlay: (spec: any) => { st.opened.push(spec); return `ov${st.opened.length}`; }, closeOverlay: (id: unknown) => { st.closed.push(id); },
  pickFolder: async () => st.picked, settings: () => ({ zoom: 0.9 }), window: () => ({ platform: "macos" }),
  terminals: () => [], agents: () => [], hc: async () => ({ code: 1, stdout: "" }), keys: () => [], focusedTerminal: () => null,
}));

const L = await import("../defaults/mods/nocturne/folderlist.js");
const { default: NewSpace, openSpacePicker, RECENT, OPEN, WIDTH } = await import("../defaults/mods/nocturne/newspace.js");

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
  expect(texts(find(r, "ns-say"))).toEqual(['a space "fireflies", in ~/code/fireflies']);
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

test("a click on a row picks it; hovering moves the cursor", async () => {
  const { v, c } = await picker();
  const r: any = v.render(c);
  const row: any = find(r, "ns-row-1");
  row.calls.on_hover[0](true, c);
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
  expect(texts(find(r, "ns-say"))).toEqual(['a space "newspace", in ~/code/fireflies-wt/newspace']);
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
  const { default: Spaces } = await import("../defaults/mods/nocturne/spaces.js");
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
  const { default: Spaces } = await import("../defaults/mods/nocturne/spaces.js");
  const { EDIT_SPACE } = await import("../defaults/mods/nocturne/menu.js");
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
