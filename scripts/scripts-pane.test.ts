// The script runner's deck as a normal pane (scripts/place.ts,
// docs/mods-in-panes.md): no frame in a pane, esc and running a script
// leave it open (q closes it), its height is the pane's, moving it between
// the tab and a pane keeps the filter and cursor, and q / ctrl-t find its own
// pane by slot. Stand-ins for gpui and herdr (mock.module is process-wide:
// this file runs alone).
import { test, expect, mock, beforeEach } from "bun:test";
import { find, texts, cx as mkcx } from "./dialog-stubs.ts";

const st: any = {};
mock.module("herdr", () => ({
  props: () => st.props, theme: () => new Proxy({}, { get: () => "#808080" }), settings: () => ({ zoom: 0.9 }), window: () => ({ platform: "macos" }),
  shared: (k: string) => st.shared[k] ?? null, setShared: (k: string, v: unknown) => { st.shared[k] = v; },
  run: (name: string, args?: any) => { st.runs.push([name, args]); return null; },
  closeOverlay: (id: unknown) => { st.closed.push(id); }, openOverlay: (spec: any) => { st.opened.push(spec); return "o9"; }, notify: () => null,
  keys: () => [], spaces: () => [], panes: () => st.panes, terminals: () => [], agents: () => [], focused: () => st.focused,
  hc: async () => ({ code: 1, stdout: "" }), home: () => "/h", appHome: () => "/tmp/none", exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  nextCommand: () => new Promise(() => {}), readTextFile: async () => null, writeTextFile: async () => null, layout: () => null,
}));

beforeEach(() => {
  Object.assign(st, { shared: {}, runs: [], closed: [], opened: [], panes: [], focused: null, props: { overlay: "d1", folder: "/src" } });
});

const { default: Deck } = await import("../defaults/mods/scripts/main.ts");

function open(props: any) {
  st.props = props;
  const d: any = new Deck();
  const c = mkcx();
  c.timer = { after(_ms: number, f: Function) { f(c); }, every() {} };
  d.init({}, c);
  d.scripts = [{ id: "bun:test", name: "test", runner: "bun", cmd: "bun test", manifest: "package.json", admin: false }];
  d.looking = false;
  return { d, c, draw: () => d.render() };
}
const k = (name: string, mods: any = {}) => ({ key: name, key_char: name.length === 1 ? name : null, modifiers: { shift: false, control: false, platform: false, alt: false, ...mods } });
const press = (o: any, name: string, mods: any = {}) => { o.draw(); o.d.onKey(k(name, mods), o.c, o.d.items); };
const closes = () => st.runs.filter(([n]: any) => n === "pane.close");

test("in a pane: no frame, the ⧉ out over the tab; over the tab: its frame and ◧", () => {
  let o = open({ folder: "/src", slot: "s1" });
  let r: any = o.draw();
  expect(r.calls.border).toBeUndefined();
  expect(texts(find(r, "scripts-move"))).toContain("⧉");
  expect(find(r, "scripts-move")!.calls.tooltip?.[0]).toBe("Out over the tab · ctrl-t");

  o = open({ folder: "/src", overlay: "d1" });
  r = o.draw();
  expect(r.calls.border?.[0]).toBe(1);
  expect(texts(find(r, "scripts-move"))).toContain("◧");
});

test("a pane's height is its own: a taller pane lists more rows", () => {
  const o = open({ folder: "/src", slot: "s1" });
  o.draw();
  const small = o.d.page;
  o.d.height = 900;
  o.draw();
  expect(o.d.page).toBeGreaterThan(small);
  o.d.height = 120; // shorter than the deck's own parts: still draws
  expect(() => o.draw()).not.toThrow();
});

test("esc leaves a pane open; q closes its own pane (by slot); over the tab q closes the overlay", () => {
  st.panes = [{ pane: "p7", mod: "scripts", props: { folder: "/x", slot: "x" } }, { pane: "p2", mod: "scripts", props: { folder: "/src", slot: "s1" } }];
  const o = open({ folder: "/src", slot: "s1" });
  press(o, "escape");
  expect(closes()).toEqual([]);
  expect(st.closed).toEqual([]);
  press(o, "q");
  expect(closes()).toEqual([["pane.close", { pane: "p2" }]]);

  const w = open({ folder: "/src", overlay: "d1" });
  press(w, "q");
  expect(st.closed).toContain("d1");
});

test("the foot names q close on a script, not while the filter types (q is a letter there)", () => {
  const o = open({ folder: "/src", overlay: "d1" });
  let r: any = o.draw();
  expect(texts(find(r, "k-close"))).toEqual(["q", "close"]);
  o.d.typing = true;
  r = o.draw();
  expect(find(r, "k-close")).toBeUndefined();
});

test("ctrl-t moves the deck into a pane and back out, with its filter and cursor", () => {
  st.focused = { pane: "p1" };
  const w = open({ folder: "/src", on: "vps", overlay: "d1" });
  w.d.query = "te";
  w.d.cursor = 0;
  press(w, "t", { control: true });
  const split = st.runs.find(([n]: any) => n === "pane.split");
  expect(split?.[1]).toMatchObject({ direction: "auto", pane: "p1", mod: "scripts", props: { folder: "/src", on: "vps" } });
  expect(typeof split?.[1].props.slot).toBe("string");
  expect(st.closed).toContain("d1");

  st.panes = [{ pane: "p3", mod: "scripts", props: split?.[1].props }];
  const p = open(split?.[1].props);
  expect(p.d.overlay).toBe(null);
  expect(p.d.query).toBe("te");
  expect(p.d.cursor).toBe(0);
  expect(st.shared["scripts.handover"]).toBe(null);

  st.runs.length = 0;
  press(p, "t", { control: true });
  expect(st.opened.at(-1)).toMatchObject({ mod: "scripts", kind: "dialog", props: { folder: "/src", on: "vps", focus: "pick" } });
  expect(closes()).toEqual([["pane.close", { pane: "p3" }]]);
  expect(st.shared["scripts.deck"]?.id).toBe("o9");
  expect(open({ ...st.opened.at(-1).props, overlay: "o9" }).d.query).toBe("te");
});
