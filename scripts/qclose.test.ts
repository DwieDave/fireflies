// q closes every dialog and menu where it isn't text, as esc does: nocturne's
// confirm and rename dialogs, What's New, the welcome, the "+ new" launcher
// and the even-out popup, through their own key handlers (dialog-stubs.ts
// stands in for herdr and gpui). Where a field has the keyboard, q is a letter.
// Its own bun process.
import { test, expect, beforeEach } from "bun:test";
import { state, cx, press, key, texts } from "./dialog-stubs.ts";

const { Prompt, Confirm } = await import("../defaults/mods/nocturne/dialog.ts");
const { WhatsNew, Welcome } = await import("../defaults/mods/nocturne/screens.ts");
const { default: NewMenu } = await import("../defaults/mods/nocturne/newmenu.ts");
const { default: EqualizePanes } = await import("../defaults/mods/equalize-panes/main.ts");

beforeEach(() => {
  state.runs = []; state.closed = []; state.opened = []; state.shared = {}; state.keys = [];
});

test("confirm: q keeps (closes without running), like n and esc; the hints say esc q", () => {
  state.props = { overlay: "c", title: "close?", command: { name: "tab.close", args: { id: 2 } } };
  const c: any = new Confirm();
  c.init({}, cx());
  const root = c.render();
  expect(texts(root)).toContain("esc q");
  const k = press(root, "q");
  expect(k.stopped).toBe(1);
  expect(state.runs).toEqual([]);
  expect(state.closed).toEqual(["c"]);
  // shift-q (Q) isn't q.
  state.closed = [];
  press(root, "shift-q");
  expect(state.closed).toEqual([]);
});

test("rename: q types in the name field; on a button it cancels", () => {
  state.props = { overlay: "p", title: "rename", value: "old", command: { name: "tab.rename", args: { id: 1 } } };
  const p: any = new Prompt();
  p.init({}, cx());
  let root = p.render();
  expect(texts(root)).not.toContain("esc q");
  expect(press(root, "q").stopped).toBe(0); // the field's letter
  expect(state.closed).toEqual([]);
  press(root, "tab");
  expect(p.at).toBe("cancel");
  root = p.render();
  expect(texts(root)).toContain("esc q");
  expect(press(root, "q").stopped).toBe(1);
  expect(state.runs).toEqual([]);
  expect(state.closed).toEqual(["p"]);
});

test("what's new: q closes, as enter and esc do", () => {
  state.props = { overlay: "w", notes: [{ version: "1.1", date: "2026-01-02", items: [{ headline: "a" }] }] };
  const w: any = new WhatsNew();
  w.init({}, cx());
  const root = w.render();
  press(root, "q");
  expect(state.closed).toEqual(["w"]);
});

test("what's new: with its keys shown, q puts them away first", () => {
  state.props = { overlay: "w", notes: [{ version: "1.1", date: "2026-01-02", items: [{ headline: "a" }] }] };
  const w: any = new WhatsNew();
  w.init({}, cx());
  const root = w.render();
  press(root, "?");
  expect(w.keysShown).toBe(true);
  press(root, "q");
  expect(w.keysShown).toBe(false);
  expect(state.closed).toEqual([]);
  press(root, "q");
  expect(state.closed).toEqual(["w"]);
});

test("welcome: q skips it, as esc does", () => {
  state.props = { overlay: "wl" };
  const w: any = new Welcome();
  w.init({}, cx());
  const root = w.render();
  press(root, "l");
  expect(w.page).toBe(2);
  press(root, "q");
  expect(state.shared["frame.welcomed"]).toBe("skipped");
  expect(state.closed).toEqual(["wl"]);
});

test("+ new: q closes the launcher; the tiles' letters still pick", () => {
  state.props = { overlay: "nm" };
  const m: any = new NewMenu();
  m.init({}, cx());
  const picked: unknown[] = [];
  m.pick = (x: any) => picked.push(x.id);
  const live = [{ kind: "tile", id: "t", key: "t", off: false, p: {} }, { kind: "tile", id: "w", key: "w", off: false, p: {} }];
  m.key(key("w"), cx(), live);
  expect(picked).toEqual(["w"]);
  const k = cx();
  m.key(key("q"), k, live);
  expect(k.stopped).toBe(1);
  expect(state.closed).toEqual(["nm"]);
  // A tile of its own on q would win.
  state.closed = [];
  m.key(key("q"), cx(), [...live, { kind: "tile", id: "q", key: "q", off: false, p: {} }]);
  expect(picked).toEqual(["w", "q"]);
  expect(state.closed).toEqual([]);
});

test("even out: q closes the popup without picking", () => {
  state.props = { overlay: "eq" };
  const v: any = new EqualizePanes();
  v.init({}, cx());
  const picks: unknown[] = [];
  const close = v.close.bind(v);
  let closed = 0;
  v.close = () => { closed++; close(); };
  v.pick = (r: unknown) => { if (r) picks.push(r); };
  const root = v.render();
  press(root, "q");
  expect(closed).toBe(1);
  expect(picks).toEqual([]);
});
