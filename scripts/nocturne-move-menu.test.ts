// The pane menu's "Move to" rows (menu.js moveTargets / moveItems) and the
// popup's levels (popup.js): Developer: "Make its a multi tiered menu for
// moving but keep it as low hierarchy as needed". Up to MOVE_FLAT places stay
// flat; past it one "Move to…" row opens a level of this space's tabs, a new
// tab and the other spaces (one with a single tab moves at once, one with more
// opens a level of its tabs). Every key and the click path. Stand-ins for gpui
// and herdr (mock.module is process-wide: this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";
import { find, texts, theme, cx, key } from "./dialog-stubs.ts";

const st: any = {};
mock.module("herdr", () => ({
  props: () => st.props, theme: () => theme, settings: () => ({ zoom: 0.9 }), window: () => ({ platform: "macos" }),
  shared: (k: string) => st.shared[k] ?? null, setShared: (k: string, v: unknown) => { st.shared[k] = v; },
  run: (name: string, args?: any) => { st.runs.push([name, args]); return null; },
  closeOverlay: (id: unknown) => { st.closed.push(id); }, openOverlay: (spec: any) => { st.opened.push(spec); return `ov${st.opened.length}`; },
  keys: () => [], spaces: () => st.spaces, panes: () => st.panes, terminals: () => [], agents: () => [], focused: () => null,
  commands: () => [], hc: async () => ({ code: 1, stdout: "" }), home: () => "/h", appHome: () => "/tmp/none",
  nextCommand: () => new Promise(() => {}), exec: async () => ({ code: 1 }),
}));

const tabs = (sp: string, n: number, named: string[] = []) => Array.from({ length: n }, (_, i) => ({ id: `${sp}c${i + 1}`, index: i + 1, name: named[i] ?? `${i + 1}`, named: Boolean(named[i]) }));
/** Developer's shot: fireflies with eight tabs (the pane in the first), empacthub with five, nix-darwin with one. */
function bigSetup() {
  st.spaces = [
    { id: "ff", name: "fireflies", machine: null, tabs: tabs("ff", 8, ["main", "typecheck", "mdlive", "edtabs2", "procs2", "chrome", "webpip", "web"]) },
    { id: "eh", name: "empacthub", machine: null, tabs: tabs("eh", 5) },
    { id: "nd", name: "nix-darwin", machine: null, tabs: tabs("nd", 1) },
  ];
  st.panes = [{ pane: "p1", tab: "ffc1", terminal: "t1" }, { pane: "p2", tab: "ffc1", terminal: "t2" }];
}
beforeEach(() => {
  Object.assign(st, { shared: {}, runs: [], closed: [], opened: [], props: { overlay: "ov9", role: "menu", tab: "pane", target: { pane: "p1", terminal: "t1" } } });
  bigSetup();
});

const menu = await import("../defaults/mods/nocturne/menu.js");
const popup = await import("../defaults/mods/nocturne/popup.ts");
const { default: Menu, moveTargets, moveItems, MOVE_FLAT, menuHeight } = menu;

/** An open pane menu: its view, a render, and a key. */
function open() {
  const v: any = new Menu();
  const c = cx();
  v.init({}, c);
  const draw = () => v.render();
  const k = (name: string) => { const r: any = draw(); r.calls.on_key_down[0](key(name), c); return draw(); };
  return { v, c, draw, k };
}
const rowIds = (r: any) => (find(r, "pm-list")?.nodes ?? []).map((n: any) => n?.calls?.id?.[0]).filter((id: string) => id?.startsWith("pm-") && !id.startsWith("pm-rule") && !id.startsWith("pm-sec"));
const cursorId = (r: any) => (find(r, "pm-list")?.nodes ?? []).find((n: any) => n?.nodes?.some((k: any) => k?.calls?.w?.[0] === 2 && k?.calls?.bg))?.calls?.id?.[0];
const headTitle = (r: any) => { const h = find(r, "pm-back"); return h ? texts(h).join(" ") : null; };
const goTo = (r: any, id: string) => find(r, id)!.calls.on_click[0]({}, cx());

// ---- the grouping rule

test("moveTargets: this space's other tabs, the other spaces with their tabs, a new tab, the count", () => {
  const m: any = moveTargets("p1");
  expect(m.here.map((c: any) => c.name)).toEqual(["typecheck", "mdlive", "edtabs2", "procs2", "chrome", "webpip", "web"]);
  expect(m.spaces.map((x: any) => [x.space.name, x.tabs.length])).toEqual([["empacthub", 5], ["nix-darwin", 1]]);
  expect(m.fresh).toBe(true);
  expect(m.count).toBe(7 + 6 + 1);
  // alone in its tab: no new tab; settled tabs and spaces on other machines aren't places
  st.panes = [{ pane: "p1", tab: "ffc1" }];
  st.spaces[0].tabs[1].settled = true;
  st.spaces.push({ id: "far", name: "far", machine: "box", tabs: tabs("far", 2) });
  const n: any = moveTargets("p1");
  expect(n.fresh).toBe(false);
  expect(n.here).toHaveLength(6);
  expect(n.spaces.map((x: any) => x.space.id)).toEqual(["eh", "nd"]);
  expect(moveTargets("nope")).toBe(null);
});

test(`up to ${MOVE_FLAT} places the rows stay flat in the menu, as before`, () => {
  st.spaces = [{ id: "ff", name: "fireflies", tabs: tabs("ff", 2) }, { id: "nd", name: "nix-darwin", tabs: tabs("nd", 1) }];
  const rows = moveItems(theme, "p1").filter((x: any) => !x.rule);
  expect(rows.map((x: any) => x.name)).toEqual(["Move to tab 2", "Move to nix-darwin / tab 1", "Move to a new tab"]);
  expect(rows.some((x: any) => x.sub)).toBe(false);
});

test("past it, one \"Move to…\" row; its level: this space's tabs (numbered), a new tab, then a row per other space", () => {
  const rows = moveItems(theme, "p1").filter((x: any) => !x.rule);
  expect(rows.map((x: any) => x.name)).toEqual(["Move to…"]);
  const level = rows[0].sub();
  expect(level.filter((x: any) => !x.rule).map((x: any) => [x.name, x.hint, x.key ?? null, Boolean(x.sub)])).toEqual([
    ["typecheck", "2", "2", false], ["mdlive", "3", "3", false], ["edtabs2", "4", "4", false], ["procs2", "5", "5", false],
    ["chrome", "6", "6", false], ["webpip", "7", "7", false], ["web", "8", "8", false],
    ["a new tab", "", null, false],
    ["empacthub", "5 tabs", null, true], // more than one tab: a level of its own
    ["nix-darwin", "tab 1", null, false], // one tab: moves at once
  ]);
  const eh = level.find((x: any) => x.name === "empacthub");
  expect(eh.title).toBe("Move to empacthub");
  expect(eh.sub().map((x: any) => [x.name, x.key])).toEqual([["tab 1", "1"], ["tab 2", "2"], ["tab 3", "3"], ["tab 4", "4"], ["tab 5", "5"]]);
});

test("the menu is no taller than its tallest level needs (a popup fits itself to the one shown)", () => {
  const p = st.props;
  const flat = popup.popupHeight(menu.menuItems(theme, p));
  const lvl = popup.popupHeight(moveItems(theme, "p1")[1].sub(), "Move to");
  expect(menuHeight(p)).toBe(Math.max(flat, lvl));
  expect(menuHeight(p)).toBeLessThan(popup.ROW * 22); // was a row per tab of every space
});

// ---- the keys

test("enter, → and l open the level; ← h and esc go back one level, the cursor on the row it came from", () => {
  for (const opener of ["enter", "right", "l", "space"]) {
    const { v, k, draw } = open();
    let r = draw();
    v.popup.cursor = rowIds(r).indexOf("pm-move");
    r = k(opener);
    expect(headTitle(r)).toContain("Move to");
    expect(rowIds(r)[0]).toBe("pm-move-ffc2");
    expect(cursorId(r)).toBe("pm-move-ffc2");
    for (const back of ["left", "h", "escape"]) {
      r = k(back);
      expect(headTitle(r)).toBe(null);
      expect(cursorId(r)).toBe("pm-move");
      r = k(opener);
    }
  }
});

test("j / k / ↓ / ↑ move in a level; a space with tabs opens its own level; esc at the top closes", () => {
  const { v, k, draw } = open();
  let r = draw();
  v.popup.cursor = rowIds(r).indexOf("pm-move");
  r = k("l");
  for (let i = 0; i < 8; i++) r = k("j"); // 7 tabs, a new tab: on empacthub
  expect(cursorId(r)).toBe("pm-move-space-eh");
  r = k("k");
  expect(cursorId(r)).toBe("pm-move-new");
  r = k("down"); r = k("up"); r = k("down");
  r = k("right");
  expect(headTitle(r)).toContain("Move to empacthub");
  expect(rowIds(r)).toEqual(["pm-move-ehc1", "pm-move-ehc2", "pm-move-ehc3", "pm-move-ehc4", "pm-move-ehc5"]);
  r = k("escape");
  expect(headTitle(r)).toContain("Move to");
  expect(cursorId(r)).toBe("pm-move-space-eh");
  r = k("escape");
  expect(headTitle(r)).toBe(null);
  expect(st.closed).toEqual([]);
  k("escape");
  expect(st.closed).toEqual(["ov9"]);
  expect(st.runs).toEqual([]);
});

test("a number moves at once from the level that shows it; enter on a row moves there", () => {
  let { v, k, draw } = open();
  let r = draw();
  v.popup.cursor = rowIds(r).indexOf("pm-move");
  k("l");
  k("5");
  expect(st.runs.at(-1)).toEqual(["pane.move", { pane: "p1", tab: "ffc5" }]);
  expect(st.closed).toEqual(["ov9"]);
  // in empacthub's level, 3 is its third tab
  ({ v, k, draw } = open());
  r = draw();
  v.popup.cursor = rowIds(r).indexOf("pm-move");
  r = k("l");
  v.popup.cursor = rowIds(r).indexOf("pm-move-space-eh");
  k("l");
  k("3");
  expect(st.runs.at(-1)).toEqual(["pane.move", { pane: "p1", tab: "ehc3" }]);
  // a space with one tab moves at once on enter
  ({ v, k, draw } = open());
  r = draw();
  v.popup.cursor = rowIds(r).indexOf("pm-move");
  r = k("enter");
  v.popup.cursor = rowIds(r).indexOf("pm-move-space-nd");
  k("enter");
  expect(st.runs.at(-1)).toEqual(["pane.move", { pane: "p1", tab: "ndc1" }]);
  // a new tab
  ({ v, k, draw } = open());
  r = draw();
  v.popup.cursor = rowIds(r).indexOf("pm-move");
  r = k("enter");
  v.popup.cursor = rowIds(r).indexOf("pm-move-new");
  k("enter");
  expect(st.runs.at(-1)).toEqual(["pane.move", { pane: "p1" }]);
});

test("h and l stay row keys where no level is open or under the cursor (the + new menu's Git and GitHub)", () => {
  const P = new popup.Popup();
  P.init(cx());
  const picked: string[] = [];
  const items = [{ id: "a", name: "A", go: () => picked.push("a") }, { id: "git", name: "Git", key: "l", go: () => picked.push("l") }, { id: "gh", name: "GitHub", key: "h", go: () => picked.push("h") }];
  P.render(theme, items);
  P.key(key("l"), items, items);
  P.key(key("h"), items, items);
  expect(picked).toEqual(["l", "h"]);
});

// ---- the pointer

test("a click on \"Move to…\" opens its level in place, on a space its tabs, on the head back; a click on a tab moves", () => {
  const { draw } = open();
  let r = draw();
  goTo(r, "pm-move");
  r = draw();
  expect(headTitle(r)).toContain("Move to");
  goTo(r, "pm-move-space-eh");
  r = draw();
  expect(headTitle(r)).toContain("Move to empacthub");
  find(r, "pm-back")!.calls.on_click[0]({}, cx());
  r = draw();
  expect(headTitle(r)).not.toContain("empacthub");
  goTo(r, "pm-move-ffc3");
  expect(st.runs).toEqual([["pane.move", { pane: "p1", tab: "ffc3" }]]);
  expect(st.closed).toEqual(["ov9"]);
});

test("hovering a row in a level puts the cursor there; a level whose places went away goes back up", () => {
  const { v, draw } = open();
  let r = draw();
  goTo(r, "pm-move");
  r = draw();
  find(r, "pm-move-ffc4")!.calls.on_hover[0](true, cx());
  r = draw();
  expect(cursorId(r)).toBe("pm-move-ffc4");
  goTo(r, "pm-move-space-eh");
  r = draw();
  st.spaces = st.spaces.filter((s: any) => s.id !== "eh"); // the space closed while its level was open
  r = draw();
  expect(headTitle(r)).toContain("Move to");
  expect(headTitle(r)).not.toContain("empacthub");
  expect(v.popup.levels).toHaveLength(1);
});

test("a firefly's menu moves its agent's pane through the same levels", () => {
  st.props = { overlay: "ov9", role: "menu", tab: "fly", target: { id: "ffc1", address: "t1" } };
  const rows = menu.menuItems(theme, st.props);
  const mv = rows.find((x: any) => x.id === "move");
  expect(mv?.sub).toBeDefined();
  expect(rows.filter((x: any) => String(x.id).startsWith("move-"))).toHaveLength(0);
});

test("an open level is as tall as its own rows (said outright), the top level fills the popup as before", () => {
  const { v, draw } = open();
  let r: any = draw();
  expect(r.calls.size_full).toBeDefined();
  expect(r.calls.h).toBeUndefined();
  goTo(r, "pm-move");
  r = draw();
  const rows = moveItems(theme, "p1")[1].sub();
  expect(r.calls.h?.[0]).toBe(popup.levelHeight(rows, "Move to"));
  expect(r.calls.h[0]).toBeLessThanOrEqual(menuHeight(st.props)); // within the popup's most
  goTo(r, "pm-move-space-eh");
  r = draw();
  expect(r.calls.h?.[0]).toBe(popup.levelHeight(rows.find((x: any) => x.id === "move-space-eh").sub(), "Move to empacthub"));
  expect(v.popup.levels).toHaveLength(2);
});
