// The dialogs' keyboard: Settings, nocturne's prompt / confirm / menus /
// screens and the other dialogs, through their own render and key handlers
// (dialog-stubs.ts stands in for herdr and gpui). Its own bun process.
import { test, expect, beforeEach } from "bun:test";
import { state, find, ringed, cx, press, texts, act } from "./dialog-stubs.ts";

const Settings = (await import("../defaults/frame/settings/main.js")).default;

beforeEach(() => {
  state.props = { overlay: "ov" };
  state.runs = []; state.closed = []; state.opened = []; state.shared = {}; state.keys = [];
});

function settings(section?: string) {
  state.props = { overlay: "settings", section };
  const s: any = new Settings();
  s.init({}, cx());
  return s;
}

test("settings: the rail is one stop; ↑↓ and digits pick sections", () => {
  const s = settings("look");
  let root = s.render(cx());
  press(root, "down");
  expect(s.section).toBe("keyboard"); // macOS: Look, Keyboard, Editor, ...
  root = s.render(cx());
  expect(ringed(find(root, "st-s-keyboard"))).toBe(true);
  press(root, "3");
  expect(s.section).toBe("editor");
  press(root, "k");
  expect(s.section).toBe("keyboard");
  press(root, "up"); press(root, "up");
  expect(s.section).toBe("look");
});

test("settings: tab walks the page's controls in order and wraps through the rail", () => {
  const s = settings("editor");
  let root = s.render(cx());
  expect(s.order.map((c: any) => c.id)).toEqual(["st-vim-on", "st-vim-off", "st-leader-space", "st-leader-comma", "st-feedback"]);
  press(root, "tab");
  expect([s.zone, s.focus]).toEqual(["body", "st-vim-on"]);
  root = s.render(cx());
  expect(ringed(find(root, "st-vim-on"))).toBe(true);
  expect(ringed(find(root, "st-s-editor"))).toBe(false);
  press(root, "j"); press(root, "down");
  expect(s.focus).toBe("st-leader-space");
  // Scrolled to the block holding it (heading, about, on, off, heading, about, space).
  expect(s.scroll.items.at(-1)).toBe(6);
  press(root, "shift-tab");
  expect(s.focus).toBe("st-vim-off");
  for (let i = 0; i < 3; i++) press(root, "tab");
  expect(s.focus).toBe("st-feedback");
  press(root, "tab");
  expect(s.zone).toBe("nav");
  press(root, "shift-tab");
  expect([s.zone, s.focus]).toEqual(["body", "st-feedback"]);
});

test("settings: tab arrives as the Form context's bound action (the root binds tab to move the focus)", () => {
  const s = settings("editor");
  const root = s.render(cx());
  expect(root.calls.key_context).toEqual(["Form"]);
  act(root, "form::tab");
  expect([s.zone, s.focus]).toEqual(["body", "st-vim-on"]);
  act(root, "form::tab_back");
  expect(s.zone).toBe("nav"); // back past the first control: the rail
  act(root, "form::tab_back");
  expect([s.zone, s.focus]).toEqual(["body", "st-feedback"]); // and around
});

test("settings: enter presses the focused control, ← goes back to the rail", () => {
  const s = settings("editor");
  const changes: any[] = [];
  s.change = (edit: any) => { const p = {}; edit(p); changes.push(p); };
  let root = s.render(cx());
  press(root, "enter"); // in the rail: into the page
  expect(s.focus).toBe("st-vim-on");
  press(root, "down");
  press(root, "space");
  expect(changes).toEqual([{ editor: { vim: false } }]);
  press(root, "h");
  expect(s.zone).toBe("nav");
  expect(s.section).toBe("editor");
});

test("settings: ← → step the zoom and the appearance", () => {
  const s = settings("look");
  const changes: any[] = [];
  s.change = (edit: any) => { const p = { appearance: "dark" }; edit(p); changes.push(p); };
  s.person = { appearance: "dark" };
  let root = s.render(cx());
  const ids = s.order.map((c: any) => c.id);
  expect(ids.slice(0, 3)).toEqual(["st-l-main", "st-l-nocturne", "st-appearance"]);
  expect(ids).toContain("st-zoom");
  expect(ids.indexOf("st-zoom")).toBeLessThan(ids.indexOf("st-zoom-reset"));
  expect(ids.indexOf("st-f-font")).toBeLessThan(ids.indexOf("st-font_size"));
  expect(ids.indexOf("st-font_size")).toBeLessThan(ids.indexOf("st-f-ui_font"));
  s.zone = "body"; s.focus = "st-zoom";
  press(root, "right"); press(root, "l"); press(root, "left");
  expect(state.runs.map(([n]) => n)).toEqual(["app.zoom_in", "app.zoom_in", "app.zoom_out"]);
  s.focus = "st-appearance";
  press(root, "right");
  expect(changes.at(-1)).toEqual({}); // dark → system (wraps)
  press(root, "left");
  expect(changes.at(-1)).toEqual({ appearance: "light" });
  s.focus = "st-l-nocturne";
  press(root, "enter");
  expect(state.runs.at(-1)).toEqual(["layout.switch", { name: "nocturne" }]);
});

test("settings: the font list opens by key, ↑↓ pick, enter chooses, esc closes", () => {
  const s = settings("look");
  const changes: any[] = [];
  s.change = (edit: any) => { const p = {}; edit(p); changes.push(p); };
  let root = s.render(cx());
  s.zone = "body"; s.focus = "st-f-font";
  press(root, "enter");
  expect(s.picking).toBe("font");
  root = s.render(cx());
  expect(s.fontRows).toEqual([null, "Alpha", "Beta", "Gamma"]);
  press(root, "down"); press(root, "down");
  expect(s.fontAt).toBe(2);
  expect(s.fontScroll.items.at(-1)).toBe(2);
  // j types into the search field.
  const c = press(root, "j");
  expect(c.stopped).toBe(0);
  press(root, "enter");
  expect(changes).toEqual([{ font: "Beta" }]);
  expect(s.picking).toBe(null);
  expect(s.focus).toBe("st-f-font");
  press(root, "enter");
  expect(s.picking).toBe("font");
  s.render(cx());
  press(root, "escape");
  expect(s.picking).toBe(null);
  expect(state.closed).toEqual([]);
});

test("settings: esc closes; cmd keys pass through", () => {
  const s = settings("alerts");
  const root = s.render(cx());
  expect(press(root, "cmd-w").stopped).toBe(0);
  press(root, "escape");
  expect(state.closed).toEqual(["settings"]);
});

test("settings: a machine's rename takes the keyboard to its field, then cancel, then save", () => {
  const s = settings("machines");
  s.machineList = [{ name: "box", target: "me@box", state: "connected", version: "1.0" }];
  let root = s.render(cx());
  expect(s.order.map((c: any) => c.id)).toEqual(["st-m-rename-box", "st-m-rm-box", "st-m-add", "st-feedback"]);
  s.zone = "body"; s.focus = "st-m-rename-box";
  press(root, "enter");
  expect(s.focus).toBe("st-m-input-box");
  expect(s.renameInput.focused).toBe(1);
  root = s.render(cx());
  expect(s.order.map((c: any) => c.id)).toEqual(["st-m-rename-box", "st-m-rm-box", "st-m-input-box", "st-m-cancel-box", "st-m-save-box", "st-m-add", "st-feedback"]);
  // Typing: letters stay in the field, tab leaves it.
  expect(press(root, "j").stopped).toBe(0);
  press(root, "tab");
  expect(s.focus).toBe("st-m-cancel-box");
  s.renameFocused = false;
  press(root, "enter");
  expect(s.machineEdit).toBe(null);
  expect(s.focus).toBe("st-m-rename-box");
  // Remove: the keyboard lands on Cancel; esc backs out without closing.
  s.render(cx());
  s.focus = "st-m-rm-box";
  press(root, "enter");
  expect(s.focus).toBe("st-m-cancel-box");
  press(root, "escape");
  expect(s.machineEdit).toBe(null);
  expect(state.closed).toEqual([]);
});

test("settings: updates keeps what's new before the check button", () => {
  const s = settings("updates");
  s.render(cx());
  expect(s.order.map((c: any) => c.id)).toEqual(["st-whats-new", "st-check-app", "st-check-core", "st-feedback"]);
  expect(texts(s.render(cx())).join(" ")).toContain("section · esc close");
});

// ---- nocturne: prompt, confirm, menus, screens, toasts

const { Prompt, Confirm } = await import("../defaults/mods/nocturne/dialog.ts");
const { Popup } = await import("../defaults/mods/nocturne/popup.ts");
const { Keys, WhatsNew, Welcome, UpdateNote, dismissUpdate, UPDATE_DISMISSED } = await import("../defaults/mods/nocturne/screens.ts");
const { default: Toast, toastKey, TOASTS } = await import("../defaults/mods/nocturne/toast.ts");
const MachineAdd = (await import("../defaults/mods/machine-add/main.js")).default;

test("prompt: tab goes name → cancel → save, enter presses the focused button", () => {
  state.props = { overlay: "p", title: "rename", value: "old", command: { name: "tab.rename", args: { id: 1 } } };
  const p: any = new Prompt();
  p.init({}, cx());
  let root = p.render();
  // In the field, letters and enter belong to it.
  expect(press(root, "j").stopped).toBe(0);
  expect(press(root, "enter").stopped).toBe(0);
  press(root, "tab");
  expect(p.at).toBe("cancel");
  root = p.render();
  expect(find(root, "pm-cancel")!.calls.border_color[0]).toBe("#80a0ff");
  press(root, "right");
  expect(p.at).toBe("save");
  press(root, "shift-tab");
  expect(p.at).toBe("cancel");
  press(root, "shift-tab");
  expect(p.at).toBe("input");
  press(root, "shift-tab");
  expect(p.at).toBe("save");
  p.input.set_value("new");
  press(root, "enter");
  expect(state.runs).toEqual([["tab.rename", { id: 1, name: "new" }]]);
  expect(state.closed).toEqual(["p"]);
});

test("confirm: confirm has the keyboard first; tab / arrows / h l switch; y and n answer", () => {
  state.props = { overlay: "c", title: "close?", command: { name: "tab.close", args: { id: 2 } } };
  const c: any = new Confirm();
  c.init({}, cx());
  let root = c.render();
  expect(find(root, "cf-go")!.calls.bg[0]).toBe("#f00");
  press(root, "tab");
  expect(c.at).toBe("keep");
  press(root, "l");
  expect(c.at).toBe("go");
  press(root, "left");
  press(root, "space");
  expect(state.runs).toEqual([]);
  expect(state.closed).toEqual(["c"]);
  press(root, "y");
  expect(state.runs).toEqual([["tab.close", { id: 2 }]]);
  press(root, "n");
  expect(state.closed.length).toBe(3);
});

test("menus: j k ctrl-n ctrl-p tab home end move, the list scrolls, enter picks", () => {
  state.props = { overlay: "m" };
  const picked: string[] = [];
  const items = [{ section: "go" }, ...["a", "b", "c"].map((id) => ({ id, name: id, go: () => picked.push(id) })), { rule: true }, { id: "x", name: "x", go: () => picked.push("x") }];
  const p: any = new Popup();
  p.init(cx());
  const root = p.render({}, items);
  press(root, "j"); press(root, "ctrl-n"); press(root, "tab");
  expect(p.cursor).toBe(3);
  expect(p.scroll.items.at(-1)).toBe(5); // the rule sits between: row index 5
  press(root, "k"); press(root, "ctrl-p"); press(root, "shift-tab");
  expect(p.cursor).toBe(0);
  press(root, "up");
  expect(p.cursor).toBe(3); // wraps
  press(root, "home");
  expect(p.cursor).toBe(0);
  press(root, "end");
  press(root, "enter");
  expect(picked).toEqual(["x"]);
  // cmd keys go on to the app.
  expect(press(root, "cmd-w").stopped).toBe(0);
});

test("keys screen: ↑↓ walk the rows, the list scrolls past the eyebrows, esc closes", () => {
  state.keys = [
    { keys: "cmd-t", action: "tab.new", section: "global" },
    { keys: "cmd-w", action: "tab.close", section: "global" },
    { keys: "cmd-d", action: "pane.split:right", section: "global" },
  ];
  state.props = { overlay: "k" };
  const k: any = new Keys();
  k.init({}, cx());
  let root = k.render();
  // keyboard focus comes first (its blocks), then tabs: walk to cmd-d, under the panes eyebrow.
  const want = k.rows.findIndex((r: any) => r.x.k?.keys === "cmd-d");
  for (let i = 0; i < want - 1; i++) press(root, "down");
  press(root, "ctrl-n");
  expect(k.at).toBe(want);
  expect(k.scroll.items.at(-1)).toBe(k.rows[want].child);
  expect(texts(root)).toContain("Split the pane: a terminal to the right");
  // enter on a block unfolds its keys under it, again folds them.
  k.at = k.rows.findIndex((r: any) => r.x.surface === "sidebar");
  press(root, "enter");
  root = k.render();
  expect(texts(root)).toContain("new worktree");
  press(root, "enter");
  expect(texts(k.render())).not.toContain("new worktree");
  press(root, "pageup"); press(root, "pageup"); press(root, "pageup");
  expect(k.at).toBe(0);
  expect(press(root, "j").stopped).toBe(0); // typing filters
  const c = press(root, "escape");
  expect(c.stopped).toBe(1);
  expect(state.closed).toEqual(["k"]);
});

test("what's new: j k space step through the notes' blocks", () => {
  state.props = { overlay: "w", notes: [{ version: "1.1", date: "2026-01-02", items: [{ headline: "a" }, { headline: "b" }, { headline: "fix", fixed: true }] }] };
  const w: any = new WhatsNew();
  w.init({}, cx());
  const root = w.render();
  expect(w.blocks).toBe(4); // head, two cards, fixes
  press(root, "j"); press(root, "space"); press(root, "down"); press(root, "down");
  expect(w.at).toBe(3);
  press(root, "k");
  expect(w.scroll.items.at(-1)).toBe(2);
  press(root, "enter");
  expect(state.closed).toEqual(["w"]);
});

test("welcome: a adds a machine on page 2, c copies on page 3", () => {
  state.props = { overlay: "wl" };
  const w: any = new Welcome();
  w.init({}, cx());
  const root = w.render();
  press(root, "a");
  expect(state.runs).toEqual([]);
  press(root, "l");
  press(root, "a");
  expect(state.runs).toEqual([["mod.open", { name: "machine-add" }]]);
  press(root, "right");
  const c = press(w.render(), "c"); // the page it shows now
  expect(c.clipboard).toContain("AGENTS.md");
  press(root, "h");
  expect(w.page).toBe(2);
});

test("toasts: the newest one's action runs by key, or it's dismissed", () => {
  const a: any = new Toast(); a.init({ overlay: "t1", action: { name: "agent.focus", args: { terminal: "t9" } } });
  const b: any = new Toast(); b.init({ overlay: "t2", action: { name: "nocturne.scripts-failed" } });
  expect((state.shared[TOASTS] as any[]).map((x) => x.overlay)).toEqual(["t1", "t2"]);
  toastKey("toast");
  expect(state.runs).toEqual([["nocturne.scripts-failed", {}]]);
  expect(state.closed).toEqual(["t2"]);
  toastKey("toast-close");
  expect(state.runs.length).toBe(1);
  expect(state.closed).toEqual(["t2", "t1"]);
  expect(toastKey("toast")).toBe(false);
  // A toast that closes by itself leaves the list.
  const c: any = new Toast(); c.init({ overlay: "t3" });
  state.props = { overlay: "t3" };
  c.closing();
  expect(state.shared[TOASTS]).toEqual([]);
});

test("machine-add: ↓ walks the ssh hosts, enter adds the highlighted one", () => {
  state.props = { overlay: "ma" };
  const m: any = new MachineAdd();
  m.init({}, cx());
  m.hosts = [{ alias: "one", aliases: [] }, { alias: "two", aliases: [] }];
  const added: string[] = [];
  m.add = (target: string) => added.push(target);
  const root = m.render();
  // In the field, enter is the field's (adds what's typed).
  expect(press(root, "enter").stopped).toBe(0);
  press(root, "down"); press(root, "ctrl-n"); press(root, "down");
  expect(m.at).toBe(1);
  press(root, "enter");
  expect(added).toEqual(["two"]);
  press(root, "up"); press(root, "up");
  expect(m.at).toBe(-1);
});

// ---- the update note ("Updated to 0.1.15 · what changed ×", bottom right)

const NOTE = { label: "Updated to 0.1.15", dismissal: "Updated to 0.1.15", success: true, restart: false };

test("update note: the × closes it on the press itself, a 30 px target the note's full height", () => {
  state.props = { ...NOTE };
  const n: any = new UpdateNote();
  const root = n.render();
  const x: any = find(root, "upd-x");
  expect(x.calls.w[0]).toBe(30);
  expect("h_full" in x.calls).toBe(true);
  const c = cx();
  expect(x.calls.on_mouse_down[0]).toBe("left");
  x.calls.on_mouse_down[1]({}, c);
  expect(state.shared[UPDATE_DISMISSED]).toBe("Updated to 0.1.15");
  expect(c.stopped).toBe(1);
  // Drawn again: gone.
  expect(find(n.render(), "upd-x")).toBeUndefined();
});

test("update note: a press anywhere on it stays with it (a terminal under it never starts a selection)", () => {
  state.props = { ...NOTE };
  const note: any = find(new UpdateNote().render(), "nocturne-update");
  const c = cx();
  expect(note.calls.on_mouse_down[0]).toBe("left");
  note.calls.on_mouse_down[1]({}, c);
  expect(c.stopped).toBe(1);
});

test("update note: a key closes it (nocturne.update-close; nocturne.toast-close when no toast is up)", () => {
  state.props = { ...NOTE };
  new UpdateNote().render();
  // No toast on show: toast-close has nothing to close, so the sky closes the note.
  expect(toastKey("toast-close")).toBe(false);
  expect(dismissUpdate()).toBe(true);
  expect(state.shared[UPDATE_DISMISSED]).toBe("Updated to 0.1.15");
  expect(dismissUpdate()).toBe(false);
  // A newer note shows again until it's closed too.
  state.props = { ...NOTE, label: "Updated to 0.1.16", dismissal: "Updated to 0.1.16" };
  expect(find(new UpdateNote().render(), "upd-x")).toBeTruthy();
  expect(dismissUpdate()).toBe(true);
  expect(state.shared[UPDATE_DISMISSED]).toBe("Updated to 0.1.16");
});
