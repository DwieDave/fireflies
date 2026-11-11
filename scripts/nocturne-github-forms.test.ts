// The GitHub window's write forms driven by their keys, as the window drives
// them: a new pull request (prs.js, prForm.js) and running a workflow by hand
// (actions.js, dispatchForm.js). herdr and gpui are stand-ins; git and gh
// answer from fakes here and every write (git push, gh pr create, gh
// workflow run) is recorded, never sent.
import { test, expect, mock, beforeEach } from "bun:test";

// ---- stand-ins

const b64 = (s: string) => Buffer.from(s).toString("base64");
const DEPLOY = `name: Deploy
on:
  workflow_dispatch:
    inputs:
      environment:
        type: environment
        required: true
      level:
        type: choice
        options: [info, debug]
        default: info
      dry:
        type: boolean
        default: true
      count:
        type: number
        required: true
        default: 2
`;
const CI = "name: ci\non: [push]\njobs: {}\n";

let world: any;
function fresh() {
  return {
    writes: [] as string[][], // every write, as argv: ["git", ...] / ["gh", ...]
    headOnGitHub: false,
    prCreateFails: false,
    runs: [] as any[], // the deploy workflow's dispatch runs GitHub lists
    prs: [{ number: 7, title: "old", headRefName: "x", author: { login: "a" } }],
  };
}
const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
const http = (status: number, body: unknown) => ok(`HTTP/2.0 ${status} X\r\nEtag: "e"\r\n\r\n${JSON.stringify(body)}`);

async function fakeGit(args: string[]) {
  const a = args.join(" ");
  if (a.startsWith("config --get-regexp")) return ok("remote.origin.url git@github.com:me/app.git\nremote.origin.fetch +refs/heads/*:refs/remotes/origin/*\nbranch.main.remote origin\n");
  if (a.startsWith("for-each-ref")) return ok("feat/pr-form\t\t\nmain\torigin/main\t\n");
  if (a.startsWith("rev-parse --verify --quiet refs/remotes/origin/main")) return ok("abc\n");
  if (a.startsWith("rev-parse")) return { code: 1, stdout: "", stderr: "" };
  if (a.startsWith("log ")) return ok("bbb\x1fsecond change\x1f\x1e\naaa\x1ffirst change\x1fwhy\x1e\n");
  if (a.startsWith("diff --numstat")) return ok("4\t1\tsrc/a.js\n2\t0\tREADME.md\n");
  if (a.startsWith("ls-files")) return ok(".github/pull_request_template.md\n");
  if (a.startsWith("show HEAD:.github/pull_request_template.md")) return ok("## What\n\n## Why\n");
  if (args[0] === "push") { world.writes.push(["git", ...args]); world.headOnGitHub = true; return ok(""); }
  return { code: 1, stdout: "", stderr: `no fake for git ${a}` };
}

async function fakeGh(args: string[]) {
  const a = args.join(" ");
  if (args[0] === "pr" && args[1] === "create") {
    world.writes.push(["gh", ...args]);
    if (world.prCreateFails) return { code: 1, stdout: "", stderr: "pull request create failed: GraphQL: No commits between main and feat" };
    world.prs.unshift({ number: 42, title: "made", headRefName: "feat/pr-form", author: { login: "me" } });
    return ok("https://github.com/me/app/pull/42\n");
  }
  if (args[0] === "workflow" && args[1] === "run") {
    world.writes.push(["gh", ...args]);
    world.runs.unshift({ id: 900, run_number: 12, name: "Deploy", status: "queued", event: "workflow_dispatch", head_branch: "main", created_at: new Date().toISOString() });
    return ok("");
  }
  if (args[0] === "workflow" && args[1] === "list") return ok(JSON.stringify([{ id: 1, name: "Deploy", path: ".github/workflows/deploy.yml", state: "active" }, { id: 2, name: "CI", path: ".github/workflows/ci.yml", state: "active" }]));
  if (args[0] === "pr" && args[1] === "view") return ok(JSON.stringify({ number: Number(args[2]), title: "x", body: "", comments: [], reviews: [] }));
  if (args[0] === "api" && args[1] === "graphql") {
    const q = args.find((x) => x.startsWith("query="))!;
    if (q.includes("assignableUsers")) return ok(JSON.stringify({ data: { viewer: { login: "me" }, repository: { assignableUsers: { nodes: [{ login: "me" }, { login: "ana" }, { login: "bo" }] }, labels: { nodes: [{ name: "bug" }, { name: "docs" }] }, milestones: { nodes: [{ title: "v1", dueOn: null }] } } } }));
    return ok(JSON.stringify({ data: { repository: { pullRequests: { nodes: world.prs } } } }));
  }
  if (args[0] === "api") {
    const path = args[args.length - 1];
    if (path.startsWith("repos/me/app/branches?")) return http(200, [{ name: "main" }, { name: "dev" }]);
    if (path.startsWith("repos/me/app/branches/")) return world.headOnGitHub ? http(200, { name: "feat/pr-form" }) : http(404, { message: "Branch not found" });
    if (path.startsWith("repos/me/app/tags")) return http(200, [{ name: "v1.0" }]);
    if (path.startsWith("repos/me/app/environments")) return http(200, { environments: [{ name: "prod" }, { name: "staging" }] });
    if (path.includes("ref=nope")) return http(404, { message: "No commit found for the ref nope" });
    if (path.includes("contents/.github/workflows/deploy.yml")) return http(200, { content: b64(DEPLOY) });
    if (path.includes("contents/.github/workflows/ci.yml")) return http(200, { content: b64(CI) });
    if (path.startsWith("repos/me/app/actions/workflows/1/runs")) return http(200, { workflow_runs: world.runs });
    const one = /^repos\/me\/app\/actions\/runs\/(\d+)$/.exec(path);
    if (one) return http(200, world.runs.find((r: any) => r.id === Number(one[1])) ?? {});
    if (path.startsWith("repos/me/app/actions/runs")) return http(200, { workflow_runs: [] });
    return http(404, { message: "Not Found" });
  }
  return { code: 1, stdout: "", stderr: `no fake for gh ${a}` };
}

mock.module("herdr", () => ({
  settings: () => ({ zoom: 1 }), window: () => ({ platform: "linux" }), appHome: () => "/home/me/.config/herdr-app", shared: () => null, setShared() {},
  exec: async (cmd: string, args: string[]) => (cmd === "git" ? fakeGit(args) : fakeGh(args)),
}));
const el: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : () => el), apply: () => el });
mock.module("gpui-kit", () => ({ div: () => el, svg: () => el, image: () => el, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
class Input {
  handlers: Record<string, Function> = {}; v = ""; focused = false; released = false;
  constructor(o: any) { if (rendering) throw new Error("InputState.new(...) cannot run during render"); this.v = o?.value ?? ""; }
  on(e: string, f: Function) { this.handlers[e] = f; return true; }
  value() { return this.v; } set_value(v: string) { this.v = v; }
  focus() { focusedInput = this; this.focused = true; } release() { this.released = true; return true; }
  set_auto_grow() {}
}
let focusedInput: Input | null = null;
let rendering = false; // the runtime refuses new inputs while drawing
const draw = (tab: any) => { rendering = true; try { return tab.render(theme, { width: 1200, height: 700 }); } finally { rendering = false; } };
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el,
  v_virtual_list: (_id: string, n: number, _s: unknown, key: (i: number) => string, render: Function) => { for (let i = 0; i < n; i++) key(i); render({ start: 0, end: n }, cx); return el; },
  VirtualListScrollHandle: { new: () => ({ scroll_to_item() {}, release() {} }) },
  InputState: { new: (o: any) => new Input(o) }, Input: { new: () => el },
  TextareaState: { new: (o: any) => new Input(o) }, Textarea: { new: () => el }, TextView: { markdown: () => el },
}));
globalThis.window = { paint_path: () => el } as any;

const work: Promise<unknown>[] = [];
const cx: any = {
  spawn: (f: Function) => { work.push(Promise.resolve(f(cx))); }, notify() {}, stop_propagation() {},
  timer: { after: (_ms: number, f: Function) => { work.push(new Promise((r) => setTimeout(() => r(f(cx)), 1))); } },
};
const settle = async () => { for (let i = 0; i < 50 && work.length; i++) { while (work.length) await work.shift(); await new Promise((r) => setTimeout(r, 2)); } };

const { default: Prs } = await import("../defaults/mods/nocturne-github/prs.js");
const { default: Actions } = await import("../defaults/mods/nocturne-github/actions.js");
const theme: any = new Proxy({}, { get: (_t, k) => (String(k).startsWith("ansi") ? "#808080" : "#c0c0c0") });

function makeApp() {
  const app: any = {
    repo: { owner: "me", name: "app", full: "me/app", host: "github.com", root: "/src/app", on: null, base: "main", branch: "feat/pr-form", url: "https://github.com/me/app" },
    note: null, picker: null, closed: false, tab: "prs", refreshed: 0,
    focusSelf() { focusedInput = null; }, kick() {}, openUrl() {}, openDiff() {},
    spawn(c: any, fn: Function) { c.spawn(async () => { try { await fn(); } catch (e) { app.thrown = e; } }); },
    refresh(c: any) { app.refreshed++; c.spawn(() => app.tabObj?.poll({ all: true, fresh: true }, c)); },
  };
  return app;
}

/** A key as the window hands it over: the form's answer. */
const key = (form: any, k: string, mods: any = {}) => form.key(k, { modifiers: mods }, cx);
/** Typing into the focused text field (the Input stand-in fires change like the real one). */
const type = (text: string) => { const i = focusedInput!; i.v = text; i.handlers.change?.({}, cx); };
const at = (form: any) => form.stops()[form.at].id;

beforeEach(() => { world = fresh(); work.length = 0; focusedInput = null; });

test("n opens a new pull request filled from the branch, template and pickers", async () => {
  const app = makeApp();
  const prs = new Prs(app, {});
  app.tabObj = prs;
  expect(prs.key("n", { modifiers: {} }, cx)).toBe(true);
  const form = prs.form;
  await settle();
  expect(form.value("base")).toBe("main");
  expect(form.value("head")).toBe("feat/pr-form");
  expect(form.value("title")).toBe("feat/pr form"); // two commits: the branch, like gh --fill
  expect(form.value("body")).toBe("## What\n\n## Why"); // the template wins
  expect(prs.flow.range.commits.map((c: any) => c.subject)).toEqual(["first change", "second change"]);
  expect(prs.flow.range.stat).toMatchObject({ add: 6, del: 1 });
  // Not on GitHub yet: the push toggle is there, on.
  expect(form.value("push")).toBe(true);
  expect(form.field("push").note).toBe("git push --set-upstream origin feat/pr-form");
  draw(prs);
  expect(form.hints().map((h: any) => h[0])).toContain("tab ⇧tab");
});

test("every field is reached by tab, typing goes in, pickers choose, enter reviews and sends", async () => {
  const app = makeApp();
  const prs = new Prs(app, {});
  app.tabObj = prs;
  prs.newPr(cx);
  const form = prs.form;
  await settle();
  const order: string[] = [];
  for (let i = 0; i < form.stops().length; i++) { order.push(at(form)); key(form, "tab"); }
  expect(order).toEqual(["base", "head", "title", "body", "draft", "reviewers", "assignees", "labels", "milestone", "push", "form-review", "form-cancel"]);
  expect(at(form)).toBe("base"); // wraps
  key(form, "tab", { shift: true });
  expect(at(form)).toBe("form-cancel"); // and back
  key(form, "tab", { shift: true });
  expect(at(form)).toBe("form-review");
  key(form, "tab", { shift: true });
  expect(at(form)).toBe("push");

  form.go(2);
  expect(key(form, "a")).toBe("typing"); // the Input's
  type("Add the PR form");
  expect(form.field("title").touched).toBe(true);
  form.go(3);
  expect(key(form, "enter")).toBe("typing"); // a new line in the body
  type("Body text");
  key(form, "tab"); // draft
  key(form, "space");
  expect(form.value("draft")).toBe(true);
  key(form, "tab"); // reviewers: typing opens the list filtered
  key(form, "a");
  expect(form.picker.field.id).toBe("reviewers");
  draw(prs);
  expect(form.rows(form.picker.field, "a").map((r: any) => r.value)).toEqual(["ana"]); // not me
  focusedInput!.v = "a";
  key(form, "enter");
  expect(form.value("reviewers")).toEqual(["ana"]);
  key(form, "escape"); // the list closes, the form stays
  expect(form.picker).toBeNull();
  expect(prs.form).toBe(form);
  key(form, "tab"); key(form, "space"); // assignees: @me first
  key(form, "enter");
  key(form, "escape");
  expect(form.value("assignees")).toEqual(["@me"]);
  key(form, "tab"); key(form, "tab"); key(form, "space"); // milestone
  key(form, "enter");
  expect(form.value("milestone")).toBe("v1");
  expect(form.picker).toBeNull();

  // enter: the commands to check, nothing sent yet.
  form.go(2);
  key(form, "enter");
  expect(form.stage).toBe("confirm");
  draw(prs);
  expect(world.writes).toEqual([]);
  const lines = form.spec.commands().map((c: any) => c.line);
  expect(lines).toEqual([
    "git push --set-upstream origin feat/pr-form",
    "gh pr create --base main --head feat/pr-form --title 'Add the PR form' --body 'Body text' --draft --reviewer ana --assignee @me --milestone v1 -R me/app",
  ]);
  // esc goes back to the form; enter there, then y, sends.
  key(form, "escape");
  expect(form.stage).toBe("edit");
  key(form, "enter");
  key(form, "y");
  await settle();
  expect(world.writes).toEqual([
    ["git", "push", "--set-upstream", "origin", "feat/pr-form"],
    ["gh", "pr", "create", "--base", "main", "--head", "feat/pr-form", "--title", "Add the PR form", "--body", "Body text", "--draft", "--reviewer", "ana", "--assignee", "@me", "--milestone", "v1", "-R", "me/app"],
  ]);
  expect(prs.form).toBeNull();
  expect(app.note.text).toBe("Opened #42.");
  expect(prs.sel).toBe(42); // selected once the list has it
  expect(prs.want).toBeNull();
});

test("required fields stop the review; a failed create stays in the review with gh's words", async () => {
  const app = makeApp();
  const prs = new Prs(app, {});
  app.tabObj = prs;
  prs.newPr(cx);
  const form = prs.form;
  await settle();
  form.go(2); type("");
  form.go(9); key(form, "space"); // no push
  key(form, "enter");
  expect(form.stage).toBe("edit");
  expect(form.errors.title).toBe("A pull request needs a title.");
  expect(at(form)).toBe("title");
  type("T");
  expect(form.errors.title).toBeUndefined();
  key(form, "enter");
  expect(form.spec.commands().length).toBe(1); // push off: gh only
  world.prCreateFails = true;
  key(form, "enter");
  await settle();
  expect(form.stage).toBe("confirm");
  expect(form.sendError).toContain("No commits between");
  expect(world.writes.length).toBe(1);
  expect(prs.form).toBe(form);
  key(form, "escape"); key(form, "escape"); // back, then cancel
  expect(prs.form).toBeNull();
});

test("a branch from the git window starts on the title; one on GitHub needs no push", async () => {
  world.headOnGitHub = true;
  const app = makeApp();
  const prs = new Prs(app, {});
  prs.newPr(cx, { head: "feat/pr-form" });
  await settle();
  expect(at(prs.form)).toBe("title");
  expect(prs.form.field("push")).toBeNull();
  prs.form.set("head", "main", { force: true });
  await prs.flow.reread(cx);
  prs.form.go(2); type("x");
  key(prs.form, "enter");
  expect(prs.form.errors.head).toBe("Head and base are the same branch.");
});

test("run workflow: only dispatchable workflows, inputs typed from the file, defaults, required, gh workflow run, then the run is selected", async () => {
  const app = makeApp();
  app.tab = "actions";
  const actions = new Actions(app, {});
  app.tabObj = actions;
  expect(actions.key("n", { modifiers: {} }, cx)).toBe(true);
  const form = actions.form;
  await settle();
  const flow = actions.flow;
  expect(flow.workflows.map((w: any) => w.name)).toEqual(["Deploy"]); // ci has no workflow_dispatch
  expect(form.value("workflow")).toBe(".github/workflows/deploy.yml"); // the only one: chosen
  expect(form.value("ref")).toBe("main"); // the folder's branch isn't on GitHub
  expect(flow.refs.map((r: any) => `${r.kind}:${r.name}`)).toEqual(["branch:main", "branch:dev", "tag:v1.0"]);
  expect(form.fields.map((f: any) => [f.label, f.kind, f.value])).toEqual([
    ["workflow", "choice", ".github/workflows/deploy.yml"], ["ref", "choice", "main"],
    ["environment", "choice", ""], ["level", "choice", "info"], ["dry", "toggle", true], ["count", "number", "2"],
  ]);
  expect(flow.envs).toEqual(["prod", "staging"]);
  draw(actions);

  // Required: the environment is empty.
  key(form, "enter");
  expect(form.stage).toBe("edit");
  expect(form.errors["in:1:environment"]).toBe("Required.");
  expect(at(form)).toBe("in:1:environment");
  key(form, "space");
  focusedInput!.v = "prod";
  key(form, "enter");
  expect(form.value("in:1:environment")).toBe("prod");
  draw(actions);
  key(form, "tab"); key(form, "space"); key(form, "down"); key(form, "enter"); // level: debug
  expect(form.value("in:1:level")).toBe("debug");
  key(form, "tab"); key(form, "space"); // dry: off
  key(form, "tab"); type("x");
  key(form, "enter");
  expect(form.errors["in:1:count"]).toBe("A number.");
  type("5");
  key(form, "enter");
  expect(form.stage).toBe("confirm");
  expect(form.spec.commands()[0].line).toBe("gh workflow run deploy.yml --ref main -f environment=prod -f level=debug -f dry=false -f count=5 -R me/app");
  expect(world.writes).toEqual([]);
  key(form, "enter");
  await settle();
  expect(world.writes).toEqual([["gh", "workflow", "run", "deploy.yml", "--ref", "main", "-f", "environment=prod", "-f", "level=debug", "-f", "dry=false", "-f", "count=5", "-R", "me/app"]]);
  expect(actions.form).toBeNull();
  expect(actions.sel).toBe(900); // the new run, selected
  expect(actions.waiting).toBeNull();
  expect(app.note.text).toBe("Deploy #12 is queued.");
});

test("a ref whose file can't be dispatched says so and blocks the review", async () => {
  const app = makeApp();
  const actions = new Actions(app, {});
  actions.runWorkflow(cx);
  await settle();
  const form = actions.form;
  form.set("ref", "nope", { force: true });
  await actions.flow.reread(cx);
  expect(actions.flow.inputsError).toContain("nope");
  key(form, "enter");
  expect(form.stage).toBe("edit");
  expect(at(form)).toBe("ref");
  key(form, "escape");
  expect(actions.form).toBeNull();
});

test("new pull request, keyboard first: ← → change a choice, buttons are stops, the hint line names the keys", async () => {
  const app = makeApp();
  const prs = new Prs(app, {});
  app.tabObj = prs;
  prs.newPr(cx);
  const form = prs.form;
  await settle();
  expect(at(form)).toBe("base"); // opens on its first field
  // base is a choice: ← → step through the branches, wrapping.
  expect(form.field("base").options().map((o: any) => o.value)).toEqual(["main", "dev"]);
  key(form, "right");
  expect(form.value("base")).toBe("dev");
  key(form, "right");
  expect(form.value("base")).toBe("main");
  key(form, "left");
  expect(form.value("base")).toBe("dev");
  key(form, "left");
  expect(at(form)).toBe("base"); // ← → never leave the field
  expect(form.hints()).toEqual([["tab ⇧tab", "move"], ["← →", "change"], ["type", "filter"], ["enter", "review"], ["esc", "cancel"]]);
  // ↓ ↑ walk the stops outside the body, as tab does.
  key(form, "down"); key(form, "down");
  expect(at(form)).toBe("title");
  key(form, "down");
  expect(at(form)).toBe("body");
  expect(key(form, "down")).toBe("typing"); // the body keeps its lines
  expect(form.hints().map((h: any) => h[0])).toEqual(["tab ⇧tab", "enter", "ctrl-enter", "esc"]); // enter: a new line
  // The draft toggle: ← → and space flip it.
  key(form, "tab");
  key(form, "right");
  expect(form.value("draft")).toBe(true);
  key(form, "left");
  expect(form.value("draft")).toBe(false);
  // Review, then Cancel: the buttons are stops; enter presses the focused one.
  form.go(form.stops().findIndex((s: any) => s.id === "form-review"));
  expect(form.isAt("form-review")).toBe(true);
  expect(form.hints()).toEqual([["tab ⇧tab", "move"], ["enter", "review"], ["esc", "cancel"]]);
  key(form, "right");
  expect(at(form)).toBe("form-cancel");
  expect(form.hints()).toEqual([["tab ⇧tab", "move"], ["enter", "press"], ["ctrl-enter", "review"], ["esc", "cancel"]]);
  key(form, "right");
  expect(at(form)).toBe("form-review"); // along the row, wrapping
  key(form, "space");
  expect(form.stage).toBe("confirm");
  // The review: Send has the keyboard; tab reaches Back, enter there goes back.
  expect(form.confirmAt).toBe(0);
  expect(form.hints()[0]).toEqual(["tab ⇧tab", "move"]);
  key(form, "tab");
  expect(form.confirmAt).toBe(1);
  key(form, "tab");
  expect(form.confirmAt).toBe(0); // wraps
  key(form, "tab", { shift: true });
  expect(form.confirmAt).toBe(1);
  key(form, "enter");
  expect(form.stage).toBe("edit");
  expect(world.writes).toEqual([]);
  // Enter on Cancel cancels the form; nothing was sent.
  form.go(form.stops().findIndex((s: any) => s.id === "form-cancel"));
  key(form, "enter");
  expect(prs.form).toBeNull();
  expect(world.writes).toEqual([]);
});

test("cmd-enter reviews from anywhere, sends from the review; cmd chords stay the app's", async () => {
  const app = makeApp();
  const prs = new Prs(app, {});
  app.tabObj = prs;
  prs.newPr(cx);
  const form = prs.form;
  await settle();
  form.go(2); type("Title");
  form.go(3);
  expect(key(form, "c", { platform: true })).toBe(false); // copy: the app's
  key(form, "enter", { platform: true });
  expect(form.stage).toBe("confirm");
  key(form, "tab"); // Back has the keyboard, the chord still sends
  key(form, "enter", { control: true });
  await settle();
  expect(world.writes.map((w) => w.slice(0, 3))).toEqual([["git", "push", "--set-upstream"], ["gh", "pr", "create"]]);
  expect(prs.form).toBeNull();
});

test("run workflow: ← → step the workflow's choices, tab wraps through Run and Cancel, esc cancels", async () => {
  const app = makeApp();
  app.tab = "actions";
  const actions = new Actions(app, {});
  app.tabObj = actions;
  actions.runWorkflow(cx);
  await settle();
  const form = actions.form;
  const ids = form.stops().map((s: any) => s.id);
  expect(ids).toEqual(["workflow", "ref", "in:1:environment", "in:1:level", "in:1:dry", "in:1:count", "form-review", "form-cancel"]);
  form.go(ids.indexOf("in:1:level"));
  key(form, "right");
  expect(form.value("in:1:level")).toBe("debug");
  form.go(ids.indexOf("in:1:environment"));
  key(form, "right");
  expect(form.value("in:1:environment")).toBe("prod");
  key(form, "tab", { shift: true }); key(form, "tab", { shift: true }); key(form, "tab", { shift: true });
  expect(at(form)).toBe("form-cancel"); // back past the first field
  key(form, "escape");
  expect(actions.form).toBeNull();
  expect(world.writes).toEqual([]);
});

test("cmd-enter in the body (the textarea types a new line and says submit): the line is taken back, the form reviews", async () => {
  const app = makeApp();
  const prs = new Prs(app, {});
  app.tabObj = prs;
  prs.newPr(cx);
  const form = prs.form;
  await settle();
  form.go(2); type("T");
  form.go(3); type("Body");
  type("Bo\ndy"); // what the textarea's cmd-enter did
  focusedInput!.handlers.submit({ secondary: true }, cx);
  expect(form.value("body")).toBe("Body");
  expect(form.stage).toBe("confirm");
  expect(world.writes).toEqual([]);
});
