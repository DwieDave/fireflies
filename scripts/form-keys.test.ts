// Every form is keyboard first, the same way (form-keys.ts): tab / shift-tab
// through its fields and buttons, wrapping; ← → change a choice; enter
// submits from a one-line field and presses a focused button; cmd-enter
// submits from anywhere; esc cancels. Each form's own key handler is driven
// here with the dialog stand-ins (dialog-stubs.ts); writes land in fakes
// (herdr's run, hc, the clipboard), never on a real service. The GitHub
// window's forms have their own file (github-forms.test.ts).
import { test, expect, beforeEach } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "fs";
import { state, find, cx, press, key, texts, act } from "./dialog-stubs.ts";

const root = new URL("../defaults/", import.meta.url).pathname;
const { formKey, formHints, submitKey, wrap } = await import("../defaults/mods/nocturne/form-keys.ts");
const { Popups } = await import("../defaults/mods/git/popups.ts");
const { Prompt, Confirm } = await import("../defaults/mods/nocturne/dialog.ts");
const { default: Spaces } = await import("../defaults/mods/nocturne/spaces.ts");
const Feedback = (await import("../defaults/frame/feedback/main.js")).default;
const MachineAdd = (await import("../defaults/mods/machine-add/main.js")).default;
const { start, press: ask, keepOther, isReview, answers } = await import("../defaults/mods/notifications/ask.js");
const { default: EditorPane } = await import("../defaults/mods/editor/main.js");
const t = (await import("./dialog-stubs.ts")).theme;

beforeEach(() => {
  state.props = { overlay: "ov" };
  state.runs = []; state.closed = []; state.opened = []; state.shared = {};
});

// ---- the helper

test("one helper: every mod with a form ships the same form-keys.ts", () => {
  const copies = [
    "mods/nocturne", "mods/github", "mods/git", "mods/editor", "mods/notifications",
    "mods/machine-add", "frame/feedback", "frame/settings",
  ].map((d) => `${root}${d}/form-keys.ts`);
  const canon = readFileSync(copies[0], "utf8");
  for (const c of copies) expect([c, readFileSync(c, "utf8") === canon]).toEqual([c, true]);
  // No mod carries a stale copy this list forgets.
  for (const kind of ["mods", "frame"]) for (const d of readdirSync(`${root}${kind}`)) {
    const f = `${root}${kind}/${d}/form-keys.ts`;
    if (existsSync(f)) expect(copies).toContain(f);
  }
});

// GPUI runs key bindings before on_key_down and the root binds tab to move
// the focus, so a form's tab arrives only as an action bound in its own
// context. Each form's root carries that context and hands the action to its
// key handler; each binds the keys once from init.
const ROOTS: [string, string][] = [
  ["mods/github/main.js", "this.key(e, cx)"], ["mods/git/main.js", "this.key(e, cx)"],
  ["mods/nocturne/sky.ts", "this.key(e, cx)"], ["mods/nocturne/dialog.ts", "this.key(e, cx)"],
  ["mods/notifications/ask-dialog.js", "this.key(e, cx)"], ["mods/editor/main.js", "this.findKey(e, cx)"],
  ["mods/machine-add/main.js", "this.key(e, cx)"], ["frame/feedback/main.js", "this.key(e, cx)"], ["frame/settings/main.js", "this.key(e, cx)"],
];

test("tab is bound: shift-tab and tab become the forms' actions in the Form context", async () => {
  const keys = await import("../defaults/mods/machine-add/form-keys.ts");
  (globalThis as any).boundKeys = [];
  keys.bindTab(cx());
  keys.bindTab(cx()); // once is enough: the keymap is the app's
  expect((globalThis as any).boundKeys).toEqual([
    { keystroke: "tab", action: "form::tab", context: "Form" },
    { keystroke: "shift-tab", action: "form::tab_back", context: "Form" },
  ]);
});

test("every form's root takes the bound tab and hands it to its key handler; init binds it", () => {
  for (const [file, call] of ROOTS) {
    const src = readFileSync(`${root}${file}`, "utf8");
    expect([file, src.includes(`.on_key_down((e, cx) => ${call})\n      .map((el) => tabActions(el, (e, cx) => ${call}))`)]).toEqual([file, true]);
    expect([file, /this\.handle = cx\.focus_handle\(\);\n\s+bindTab\(cx\);/.test(src)]).toEqual([file, true]);
  }
});

const FORM = [
  { id: "name", kind: "text" }, { id: "body", kind: "area" }, { id: "base", kind: "choice" },
  { id: "labels", kind: "multi" }, { id: "draft", kind: "toggle" }, { id: "ok", kind: "button", submit: true }, { id: "no", kind: "button" },
];
const K = (at: number, k: string, m: any = {}, c: string | null = null) => formKey(FORM, at, k, m, c);

test("formKey: tab and shift-tab wrap at both ends, ↑↓ move outside a multi-line field", () => {
  expect(K(0, "tab")).toEqual({ act: "move", to: 1 });
  expect(K(6, "tab")).toEqual({ act: "move", to: 0 });
  expect(K(0, "tab", { shift: true })).toEqual({ act: "move", to: 6 });
  expect(K(0, "down")).toEqual({ act: "move", to: 1 });
  expect(K(1, "down")).toEqual({ act: "type" }); // the body's own line
  expect(K(2, "up")).toEqual({ act: "move", to: 1 });
  expect(wrap(3, 0, -1)).toBe(2);
});

test("formKey: one enter rule; cmd-enter and ctrl-enter submit anywhere; esc cancels; cmd chords pass", () => {
  expect(K(0, "enter")).toEqual({ act: "submit" }); // a one-line field
  expect(K(1, "enter")).toEqual({ act: "type" }); // a new line
  expect(K(1, "enter", { platform: true })).toEqual({ act: "submit" });
  expect(K(6, "enter", { control: true })).toEqual({ act: "submit" });
  expect(K(2, "enter")).toEqual({ act: "submit" });
  expect(K(4, "enter")).toEqual({ act: "submit" });
  expect(K(5, "enter")).toEqual({ act: "press" });
  expect(K(6, "space")).toEqual({ act: "press" });
  for (let i = 0; i < FORM.length; i++) expect(K(i, "escape")).toEqual({ act: "cancel" });
  expect(K(0, "c", { platform: true })).toBeNull();
  expect(K(0, "a")).toEqual({ act: "type" });
});

test("formKey: choices change by arrows or typing, toggles flip, buttons move along their row", () => {
  expect(K(2, "right")).toEqual({ act: "step", by: 1 });
  expect(K(2, "left")).toEqual({ act: "step", by: -1 });
  expect(K(2, "m", {}, "m")).toEqual({ act: "open", typed: "m" });
  expect(K(2, "space")).toEqual({ act: "open", typed: "" });
  expect(K(3, "right")).toEqual({ act: "open", typed: "" });
  expect(K(3, "b", {}, "b")).toEqual({ act: "open", typed: "b" });
  expect(K(3, "backspace")).toEqual({ act: "clear" });
  expect(K(4, "space")).toEqual({ act: "flip" });
  expect(K(4, "left")).toEqual({ act: "flip" });
  expect(K(5, "right")).toEqual({ act: "move", to: 6 });
  expect(K(6, "right")).toEqual({ act: "move", to: 5 });
});

test("formHints: the hint line names tab, the focused stop's keys, the submit key there, esc", () => {
  expect(formHints(FORM, 0, { submit: "save" })).toEqual([["tab ⇧tab", "move"], ["enter", "save"], ["esc", "cancel"]]);
  expect(formHints(FORM, 1, { mac: true, submit: "save" })).toEqual([["tab ⇧tab", "move"], ["enter", "new line"], ["⌘enter", "save"], ["esc", "cancel"]]);
  expect(formHints(FORM, 2)[1]).toEqual(["← →", "change"]);
  expect(formHints(FORM, 6, { mac: true })).toEqual([["tab ⇧tab", "move"], ["enter", "press"], ["⌘enter", "submit"], ["esc", "cancel"]]);
  expect(submitKey(FORM, 5, true)).toBe("enter");
});

// ---- the git window's popups

function gitView() {
  const v: any = { draft: null, focused: 0, focusSelf() { v.focused++; }, later() {}, commitWhat: () => "2 files" };
  return { v, pops: new Popups(v) };
}

test("git commit: summary → description → commit → cancel, wrapping; enter commits from the summary, cmd-enter anywhere", () => {
  const { v, pops } = gitView();
  const made: string[] = [];
  pops.commit({ title: "Commit", ok: (m: string) => made.push(m), draft: true });
  const p = pops.top;
  const ids = () => pops.stops()[p.at].id;
  expect(ids()).toBe("cm-sum"); // opens on its first field
  p.input.set_value("feat: x");
  pops.key("tab", null, cx());
  expect(ids()).toBe("cm-desc");
  expect(pops.key("enter", null, cx())).toBe(false); // a new line: the textarea's
  pops.key("tab", null, cx());
  expect(ids()).toBe("cm-ok");
  expect(v.focused).toBe(1); // a button: the window has the keys, not an input
  expect(pops.hints()).toEqual([["tab ⇧tab", "move"], ["enter", "commit"], ["esc", "keep draft"]]);
  pops.key("tab", null, cx());
  expect(ids()).toBe("cm-no");
  expect(pops.hints()[1]).toEqual(["enter", "press"]);
  pops.key("tab", null, cx());
  expect(ids()).toBe("cm-sum"); // wraps
  pops.key("shift-tab", null, cx());
  expect(ids()).toBe("cm-no"); // and back
  pops.key("shift-tab", null, cx());
  pops.key("shift-tab", null, cx());
  expect(ids()).toBe("cm-desc");
  p.desc.set_value("why");
  pops.key("cmd-enter", null, cx());
  expect(made).toEqual(["feat: x\n\nwhy"]);
  expect(pops.open).toBe(false);
});

test("git commit: enter on cancel (or esc) keeps the draft; enter on commit commits", () => {
  const { v, pops } = gitView();
  const made: string[] = [];
  pops.commit({ title: "Commit", ok: (m: string) => made.push(m), draft: true });
  pops.top.input.set_value("wip");
  pops.key("shift-tab", null, cx());
  pops.key("enter", null, cx());
  expect(pops.open).toBe(false);
  expect(v.draft).toBe("wip");
  pops.commit({ title: "Commit", ok: (m: string) => made.push(m), draft: true });
  expect(pops.top.input.value()).toBe("wip");
  pops.key("tab", null, cx()); pops.key("tab", null, cx());
  pops.key("space", null, cx());
  expect(made).toEqual(["wip"]);
  const root = pops.render(t, { width: 900, height: 600 });
  expect(root).toBeNull(); // closed
});

test("git confirm: its checks, then yes and cancel, wrapping; space flips a check; enter presses the focused one", () => {
  const { pops } = gitView();
  const went: any[] = [];
  const open = () => pops.confirm({ title: "Remove", text: "Remove the worktree?", danger: true, checks: [{ key: "b", label: "delete the branch", on: false }], go: (_cx: any, checks: any) => went.push(checks[0].on) });
  open();
  const id = () => pops.stops()[pops.top.at].id;
  expect(pops.stops().map((s: any) => s.id)).toEqual(["cf-c-0", "cf-yes", "cf-no"]);
  expect(id()).toBe("cf-c-0");
  pops.key("space", null, cx());
  expect(pops.top.checks[0].on).toBe(true);
  pops.key("b", null, cx()); // its own key flips it too
  expect(pops.top.checks[0].on).toBe(false);
  pops.key("tab", null, cx()); pops.key("tab", null, cx());
  expect(id()).toBe("cf-no");
  let r = pops.render(t, { width: 900, height: 600 });
  expect(find(r, "cf-no")!.calls.bg?.[0]).toBe(t.ansi0); // the focused one wears the ring's band
  pops.key("tab", null, cx());
  expect(id()).toBe("cf-c-0"); // wraps
  pops.key("shift-tab", null, cx());
  pops.key("enter", null, cx()); // on cancel
  expect(went).toEqual([]);
  expect(pops.open).toBe(false);
  open();
  pops.key("space", null, cx());
  pops.key("enter", null, cx()); // on a check: submits
  expect(went).toEqual([true]);
  open();
  pops.key("right", null, cx()); // a toggle: ← → flip it
  pops.key("tab", null, cx());
  r = pops.render(t, { width: 900, height: 600 });
  expect(texts(find(r, "cf-yes"))).toEqual(["enter", "yes, do it"]);
  pops.key("enter", null, cx());
  expect(went).toEqual([true, true]);
});

test("git error popup: one button, enter closes", () => {
  const { pops } = gitView();
  pops.confirm({ title: "Error", text: "git failed", error: true });
  expect(pops.stops().map((s: any) => s.id)).toEqual(["cf-yes"]);
  expect(pops.hints()).toEqual([["tab ⇧tab", "move"], ["enter", "close"]]);
  pops.key("tab", null, cx());
  pops.key("enter", null, cx());
  expect(pops.open).toBe(false);
});

// ---- nocturne's prompt and confirm

test("prompt: cmd-enter saves from the field; the button row names the keys", () => {
  state.props = { overlay: "p", title: "rename", value: "old", command: { name: "tab.rename", args: { id: 1 } } };
  const p: any = new Prompt();
  p.init({}, cx());
  let r = p.render();
  expect(texts(find(r, "dh-1"))).toEqual(["enter", "save"]);
  press(r, "tab"); // cancel
  r = p.render();
  expect(texts(find(r, "dh-2"))).toEqual(["⌘enter", "save"]);
  press(r, "tab"); press(r, "tab"); // wraps to the name
  expect(p.at).toBe("input");
  p.input.set_value("new");
  press(r, "cmd-enter");
  expect(state.runs).toEqual([["tab.rename", { id: 1, name: "new" }]]);
});

test("confirm: tab wraps between confirm and keep, enter on keep keeps, cmd-enter confirms", () => {
  state.props = { overlay: "c", title: "close?", command: { name: "tab.close", args: { id: 2 } } };
  const c: any = new Confirm();
  c.init({}, cx());
  let r = c.render();
  expect(texts(find(r, "dh-1"))).toEqual(["enter", "confirm"]);
  press(r, "shift-tab");
  expect(c.at).toBe("keep");
  press(r, "shift-tab");
  expect(c.at).toBe("go");
  press(r, "tab");
  press(r, "enter");
  expect(state.runs).toEqual([]);
  press(r, "cmd-enter");
  expect(state.runs).toEqual([["tab.close", { id: 2 }]]);
});

// ---- the sidebar's inline space forms

test("rename a space: name → esc, wrapping; enter in the field saves; new and folder open the picker instead", () => {
  const s: any = new Spaces();
  s.init(cx());
  let host = 0;
  s.focusHost = () => host++;
  const sp = { id: "s1", name: "web", named: true, tabs: [] };
  s.start({ kind: "rename", s: sp }, cx());
  expect(s.at).toBe("name");
  expect(s.input.value()).toBe("web");
  const k = (name: string) => s.confirmKey(key(name), cx());
  s.tab(false, cx());
  expect([s.at, host]).toEqual(["cancel", 1]);
  expect(k("tab")).toBe(true);
  expect(s.at).toBe("name"); // wraps
  expect(k("enter")).toBe(false); // the input's own submit
  s.input.set_value("site");
  s.submit(cx());
  expect(state.runs).toEqual([["space.rename", { id: "s1", name: "site" }]]);
  expect(s.mode).toBeNull();
  // A new space and a space's folder: the folder picker (newspace.js), no inline form.
  s.start({ kind: "new" }, cx());
  expect(s.mode).toBeNull();
  expect(state.opened.at(-1)).toMatchObject({ kind: "dialog", props: { role: "newspace" } });
  s.start({ kind: "folder", s: sp }, cx());
  expect(state.opened.at(-1)).toMatchObject({ props: { role: "newspace", space: "s1" } });
});

test("delete a space: delete has the keyboard, tab wraps to keep, enter on keep keeps, y deletes", () => {
  const s: any = new Spaces();
  s.init(cx());
  s.focusHost = () => {};
  const sp = { id: "s1", name: "web", tabs: [] };
  s.start({ kind: "delete", s: sp }, cx());
  expect(s.at).toBe("go");
  const k = (name: string, c?: string) => s.confirmKey({ ...key(name), key_char: c ?? null }, cx());
  k("tab");
  expect(s.at).toBe("keep");
  k("tab");
  expect(s.at).toBe("go");
  k("right");
  k("enter");
  expect(s.mode).toBeNull();
  expect(state.runs).toEqual([]);
  s.start({ kind: "delete", s: sp }, cx());
  k("y", "y");
  expect(state.runs).toEqual([["space.close", { id: "s1", confirmed: true }]]);
});

// ---- feedback

test("feedback: opens on the title; tab walks title → message → cancel → open, wrapping; cmd-enter opens the issue", () => {
  state.props = { overlay: "fb" };
  const f: any = new Feedback();
  f.init({}, cx());
  expect(f.at).toBe(0);
  let r = f.render(cx());
  expect(texts(find(r, "feedback-keys"))).toEqual(["tab ⇧tab", "move", "enter", "open on GitHub", "esc", "close"]);
  press(r, "enter"); // no message yet: to the message
  expect(f.at).toBe(1);
  expect(state.runs).toEqual([]);
  expect(press(r, "enter").stopped).toBe(0); // a new line: the textarea's
  f.message.set_value("It broke");
  press(r, "tab"); press(r, "tab");
  expect(f.at).toBe(3);
  r = f.render(cx());
  expect(texts(find(r, "feedback-open"))).toEqual(["Open on GitHub  enter"]);
  press(r, "tab");
  expect(f.at).toBe(0); // wraps
  press(r, "shift-tab");
  expect(f.at).toBe(3);
  press(r, "shift-tab");
  press(r, "enter"); // on Cancel
  expect(state.closed).toEqual(["fb"]);
  expect(state.runs).toEqual([]);
  f.go(1);
  press(r, "cmd-enter");
  expect(state.runs).toEqual([["app.open_url", { url: "https://github.com/DwieDave/fireflies/issues/new?title=It%20broke" }]]);
});

// ---- add a machine

test("machine-add: tab reaches Add, each Copy shown and Esc, wrapping; enter presses the focused one", () => {
  state.props = { overlay: "ma" };
  const m: any = new MachineAdd();
  const c = cx();
  m.init({}, c);
  m.hosts = [{ alias: "one", aliases: [] }];
  const added: string[] = [];
  m.add = (target: string) => added.push(target);
  m.pending.add("box"); m.state.box = "needs a password";
  let r = m.render();
  expect(m.stops().map((s: any) => s.id)).toEqual(["input", "add", "copy:box", "close"]);
  m.typed = "me@box";
  press(r, "tab", c);
  expect(m.stop).toBe("add");
  press(r, "enter", c);
  expect(added).toEqual(["me@box"]);
  press(r, "tab", c);
  expect(m.stop).toBe("copy:box");
  r = m.render();
  press(r, "space", c);
  expect(c.clipboard).toBe("hc machine add box");
  press(r, "tab", c); press(r, "tab", c);
  expect(m.stop).toBe("input"); // wraps
  press(r, "shift-tab", c);
  expect(m.stop).toBe("close");
  press(r, "enter", c);
  expect(state.closed).toEqual(["ma"]);
});

// ---- the ask dialog

const QS = [
  { question: "Color?", header: "C", multiSelect: false, options: [{ label: "Red" }, { label: "Blue" }] },
  { question: "Pets?", header: "P", multiSelect: true, options: [{ label: "Cats" }, { label: "Dogs" }] },
];

test("ask: tab walks the questions, then submit and back, wrapping both ways; cmd-enter submits", () => {
  let s = start(QS);
  const go = (k: string, shift = false) => { const r = ask(QS, s, k, { shift }); s = r.state; return r.action; };
  go("tab"); expect(s.q).toBe(1);
  go("tab"); expect([isReview(QS, s), s.reviewCursor]).toEqual([true, 0]);
  go("tab"); expect([isReview(QS, s), s.reviewCursor]).toEqual([true, 1]);
  go("tab"); expect(s.q).toBe(0); // wraps
  go("tab", true); expect([isReview(QS, s), s.reviewCursor]).toEqual([true, 1]); // and back
  go("tab", true); go("tab", true); expect(s.q).toBe(1);
  expect(go("submit")).toBe(null); // nothing answered: the first question
  expect(s.q).toBe(0);
  go("enter"); // Red, on to Pets
  go("space");
  expect(go("submit")).toBe("submit");
  expect(answers(QS, s)).toEqual([{ picked: [0], other: null }, { picked: [0], other: null }]);
});

test("ask: tab in the typed answer keeps it where it is", () => {
  let s = start(QS);
  s = ask(QS, s, "up").state; // "other"
  s = ask(QS, s, "enter").state;
  expect(s.editing).toBe(true);
  s = keepOther(QS, s, "Teal");
  s = ask(QS, s, "tab").state;
  expect(s.q).toBe(1); // one step, not two
  expect(answers(QS, s)[0]).toEqual({ picked: [], other: "Teal" });
});

// ---- the editor's find line

function findLine(mode: "find" | "replace") {
  const calls: string[] = [];
  const ed: any = Object.create(EditorPane.prototype);
  Object.assign(ed, {
    mode, findAt: "find", caseSensitive: false,
    handle: { focus() { calls.push("handle"); } },
    findInput: { focus() { calls.push("find-input"); }, value: () => "x" },
    replaceInput: { focus() { calls.push("with-input"); }, value: () => "y" },
    editor: { find: () => ({ count: 1 }), find_next: () => (calls.push("next"), {}), find_prev: () => (calls.push("prev"), {}), replace: (_v: string, all: boolean) => (calls.push(all ? "all" : "one"), {}), find_close() {}, focus() { calls.push("editor"); } },
  });
  return { ed, calls };
}

test("editor find: tab walks find → Aa → ‹ → › → with → replace → all, wrapping; space / enter press a chip", () => {
  const { ed, calls } = findLine("replace");
  const k = (name: string) => { const c = cx(); ed.findKey(key(name), c); return c; };
  k("tab");
  expect(ed.findAt).toBe("case");
  k("space");
  expect(ed.caseSensitive).toBe(true);
  k("tab"); k("enter"); // ‹
  k("tab"); k("space"); // ›
  k("tab");
  expect(ed.findAt).toBe("with");
  expect(k("enter").stopped).toBe(0); // the field's own enter: replace
  k("tab"); k("enter");
  k("tab"); k("enter");
  k("tab");
  expect(ed.findAt).toBe("find"); // wraps
  k("shift-tab");
  expect(ed.findAt).toBe("replace-all");
  expect(calls.filter((c) => !c.endsWith("input") && c !== "handle")).toEqual(["prev", "next", "one", "all"]);
  k("escape");
  expect(ed.mode).toBeNull();
});

test("editor find: without replace the chips end at ›, then back to the field", () => {
  const { ed } = findLine("find");
  for (const _ of [1, 2, 3]) ed.findKey(key("tab"), cx());
  expect(ed.findAt).toBe("next");
  ed.findKey(key("tab"), cx());
  expect(ed.findAt).toBe("find");
  const c = cx();
  ed.findKey(key("a"), c);
  expect(c.stopped).toBe(0); // typing in the field
});

// ---- the bound tab, end to end through the roots' actions

test("bound tab: the prompt and confirm dialogs move by the action, both ways", () => {
  state.props = { overlay: "p", title: "rename", value: "old", command: { name: "tab.rename", args: { id: 1 } } };
  const p: any = new Prompt();
  p.init({}, cx());
  let r = p.render();
  expect(r.calls.key_context).toEqual(["Form"]);
  act(r, "form::tab");
  expect(p.at).toBe("cancel");
  act(r, "form::tab"); act(r, "form::tab");
  expect(p.at).toBe("input"); // wraps
  act(r, "form::tab_back");
  expect(p.at).toBe("save");
  state.props = { overlay: "c", title: "close?", command: { name: "tab.close", args: { id: 2 } } };
  const c: any = new Confirm();
  c.init({}, cx());
  r = c.render();
  act(r, "form::tab_back");
  expect(c.at).toBe("keep");
  act(r, "form::tab");
  expect(c.at).toBe("go");
});

test("bound tab: feedback and machine-add walk their stops by the action", () => {
  state.props = { overlay: "fb" };
  const f: any = new Feedback();
  f.init({}, cx());
  let r = f.render(cx());
  act(r, "form::tab"); act(r, "form::tab");
  expect(f.at).toBe(2);
  act(r, "form::tab_back"); act(r, "form::tab_back"); act(r, "form::tab_back");
  expect(f.at).toBe(3); // wrapped back past the title
  state.props = { overlay: "ma" };
  const m: any = new MachineAdd();
  m.init({}, cx());
  r = m.render();
  act(r, "form::tab");
  expect(m.stop).toBe("add");
  act(r, "form::tab_back"); act(r, "form::tab_back");
  expect(m.stop).toBe("close");
});

test("cmd-enter in a multi-line field: the new line it typed is taken back, and the form submits", () => {
  const { pops } = gitView();
  const made: string[] = [];
  pops.commit({ title: "Commit", ok: (m: string) => made.push(m) });
  const p = pops.top;
  p.input.set_value("feat: y");
  p.desc.set_value("body"); p.desc.handlers.change?.({}, cx());
  p.desc.set_value("bo\ndy"); p.desc.handlers.change?.({}, cx()); // the textarea's cmd-enter new line
  p.desc.handlers.submit({ secondary: true }, cx());
  expect(made).toEqual(["feat: y\n\nbody"]);
  state.props = { overlay: "fb" };
  const f: any = new Feedback();
  f.init({}, cx());
  f.message.set_value("It broke"); f.message.handlers.change?.({}, cx());
  f.message.set_value("It broke\n"); f.message.handlers.change?.({}, cx());
  f.message.handlers.submit({ secondary: false }, cx()); // a plain enter: a new line, nothing else
  expect(state.runs).toEqual([]);
  f.message.handlers.submit({ secondary: true }, cx());
  expect(f.message.value()).toBe("It broke");
  expect(state.runs.length).toBe(1);
});
