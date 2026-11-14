// The picture in picture player's bar (pip): its controls in sections,
// a dithered seam between them, wide and narrow, and the ⋯ menu's sections.
// herdr and gpui stand-ins (mock.module is process-wide: this file runs alone).
import { test, expect, mock } from "bun:test";

class Element {
  calls: [string, any[]][] = [];
  nodes: any[] = [];
  constructor() {
    return new Proxy(this, {
      get: (target, key: string, proxy) => key in target ? (target as any)[key] : (...args: any[]) => {
        if (key === "child") target.nodes.push(args[0]);
        else if (key === "children") target.nodes.push(...args[0]);
        else if (key === "when") { if (args[0]) args[1](proxy); }
        else target.calls.push([key, args]);
        return proxy;
      },
    });
  }
}
const walk = (el: any): any[] => (el && typeof el === "object" && Array.isArray(el.nodes) ? [el, ...el.nodes.flatMap(walk)] : []);
const callOf = (el: any, name: string) => el.calls.filter(([k]: any) => k === name).map(([, a]: any) => a);
const idOf = (el: any) => callOf(el, "id")[0]?.[0] ?? null;
const opened: any[] = [];
const runs: [string, any][] = [];
const calls: [string, string, any][] = [];
const store = new Map<string, any>();
let propsNow: any = { of: "1:web" };
const theme: any = new Proxy({}, { get: (_t, k) => `#${String(k)}` });
mock.module("herdr", () => ({
  props: () => propsNow, theme: () => theme, settings: () => ({ zoom: 1 }), closeOverlay() {}, openOverlay: (s: any) => { opened.push(s); },
  run: (name: string, args: any) => { runs.push([name, args]); }, panes: () => [], focused: () => null,
  shared: (k: string) => store.get(k) ?? null, setShared: (k: string, v: any) => { store.set(k, v); }, nextCommand: () => new Promise(() => {}),
  window: () => ({ platform: "macos" }), nativeView: undefined, nextNativeViewEvent: () => new Promise(() => {}),
  nativeViewCall: (id: string, action: string, args: any) => { calls.push([id, action, args]); },
}));
mock.module("gpui-kit", () => ({ View: class {}, div: () => new Element(), svg: () => new Element(), PathBuilder: { fill: () => new Element() }, Background: { checkerboard: (c: string) => { dithered.push(c); return {}; } } }));
mock.module("gpui-base", () => ({ h_flex: () => new Element(), v_flex: () => new Element() }));
const dithered: string[] = [];
(globalThis as any).window = { paint_path: () => new Element() };

const pip = await import("../defaults/mods/pip/main.ts");
const { default: Pip, fit, sections, lift, GLYPH_DROP } = pip;

/** A player as the window draws it, `width` px wide. */
function player(width: number, extra: any = {}) {
  const p: any = Object.create(Pip.prototype);
  Object.assign(p, { width, menu: null, inPane: false, parks: false, hover: null, playing: true, muted: false, handle: { is_focused: () => false }, ...extra });
  return p;
}
/** The bar's row, left to right: control ids ("more" for ⋯) and "|" for a seam. */
function row(p: any) {
  const bar = p.bar(theme);
  return bar.nodes.slice(1).map((el: any) => (idOf(el)?.startsWith("pip-") ? idOf(el).slice(4) : "|"));
}

test("wide, the bar is four sections with a seam between: where it came from, playback, where it goes, the window's own", () => {
  expect(row(player(480))).toEqual(["back", "|", "rewind", "toggle", "forward", "mute", "|", "pane", "park", "out", "|", "snap", "keys", "close"]);
  // A seam: a short dithered upright, not a control (no id, no click): 1 px
  // wide, 8 tall (the icons are 12, the bar 21), its dots half lit, in the
  // seam tone (a step darker than the icons' dim); its 8 px place, the seam in the middle.
  const seam = player(480).bar(theme).nodes[2];
  expect([callOf(seam, "w"), callOf(seam, "h"), callOf(seam, "mx"), callOf(seam, "on_click").length, seam.nodes.length]).toEqual([[[1]], [[8]], [[3.5]], 0, 1]);
  expect(dithered.at(-1)).toBe(pip.seamTone(theme));
  // As a pane (◧ is the window's): its section keeps ⤓ ⇱.
  expect(row(player(480, { inPane: true }))).toEqual(["back", "|", "rewind", "toggle", "forward", "mute", "|", "park", "out", "|", "snap", "keys", "close"]);
});

test("narrow doesn't fit goes into ⋯ (before ✕): a section left empty takes its seam along", () => {
  const widths = [480, 344, 343, 300, 260, 240];
  const rows = widths.map((w) => row(player(w)));
  // 344 px: everything (eleven controls, three seams, the title's room).
  expect(rows[1]).toEqual(["back", "|", "rewind", "toggle", "forward", "mute", "|", "pane", "park", "out", "|", "snap", "keys", "close"]);
  // A px less: the snapping toggle and ? go into ⋯ (it takes a place itself).
  expect(rows[2]).toEqual(["back", "|", "rewind", "toggle", "forward", "mute", "|", "pane", "park", "out", "|", "more", "close"]);
  expect(rows[3]).toEqual(["back", "|", "rewind", "toggle", "forward", "mute", "|", "pane", "park", "|", "more", "close"]);
  expect(rows[4]).toEqual(["back", "|", "rewind", "toggle", "mute", "|", "park", "|", "more", "close"]);
  // The window's narrowest.
  expect(rows[5]).toEqual(["back", "|", "toggle", "mute", "|", "park", "|", "more", "close"]);
  for (const r of rows) {
    // Never a seam at an end, never two together; play / pause and close always stay.
    expect(r[0]).not.toBe("|");
    expect(r.join(" ")).not.toContain("| |");
    expect(r).toEqual(expect.arrayContaining(["toggle", "close"]));
    expect(r.at(-1)).toBe("close");
  }
  // What fits is counted with its seams: the bar's row is never wider than the window.
  const widthOf = (r: string[]) => 8 + 70 + r.filter((x) => x !== "|").length * 22 + r.filter((x) => x === "|").length * 8;
  for (const [i, w] of widths.entries()) expect(widthOf(rows[i])).toBeLessThanOrEqual(w);
  // The tightest: two controls and ⋯.
  expect(fit(Pip.prototype.controls.call(player(100)), 100).shown.map((c: any) => c.id)).toEqual(["toggle", "close"]);
});

test("sections() cuts a run of controls where the section changes; an empty run gives none", () => {
  const c = (id: string, section: string) => ({ id, section });
  expect(sections([c("a", "x"), c("b", "x"), c("d", "y"), c("e", "x")]).map((s: any[]) => s.map((x) => x.id))).toEqual([["a", "b"], ["d"], ["e"]]);
  expect(sections([])).toEqual([]);
});

test("the ⋯ menu lists the controls that went into it in the same sections, a dithered rule between; its height counts them", () => {
  const p = player(240);
  const more = fit(p.controls(), 240).more.map((c: any) => c.id);
  expect(more).toEqual(["rewind", "forward", "pane", "out", "snap", "keys"]);
  opened.length = 0;
  p.openMore(more);
  expect(opened.at(-1)).toMatchObject({ mod: "pip", kind: "popup", height: 6 * 26 + 2 * 9 + 10, props: { menu: more } });
  propsNow = { menu: more, playing: true, muted: false };
  const m: any = Object.create(Pip.prototype);
  m.menu = more; m.cursor = 0; m.handle = {};
  const menu = m.renderMenu(theme);
  expect(dithered).toContain(pip.seamTone(theme)); // its rules in the bar's seams' tone
  const kinds = menu.nodes.map((el: any) => (idOf(el)?.startsWith("pm-") ? idOf(el).slice(3) : "rule"));
  expect(kinds).toEqual(["rewind", "forward", "rule", "pane", "out", "rule", "snap", "keys"]);
  // The cursor walks the rows alone (the rules aren't stops): from ⇱ (3) j goes to the toggle (4).
  expect(pip.menuMove("j", 3, 6)).toBe(4);
  // The row under the cursor is lit by its index among the rows, past a rule too.
  m.cursor = 3;
  const lit = m.renderMenu(theme).nodes.find((el: any) => idOf(el) === "pm-out");
  expect(callOf(lit, "text_color")[0][0]).toBe(theme.foreground);
  propsNow = { of: "1:web" };
});

test("every mark sits on the bar's middle line: an svg centres on its box, each glyph is lifted by its own drop", () => {
  // Where each glyph's ink sat on Developer's shot (zoom 0.9, 2× pixels: the
  // bar's middle at 42.5, its svg there too), in device pixels below it.
  const measured: Record<string, number> = { "↩": 0.7, "«": 0.5, "❚❚": 1.6, "»": 0.5, "◧": 1.7, "⤓": 0.5, "⇱": 1.5, "?": -0.5, "✕": 1 };
  expect([...GLYPH_DROP.keys()].sort()).toEqual(Object.keys(measured).sort());
  for (const [g, drop] of Object.entries(measured)) {
    // The lift is in px of the bar's 11 px text; the window scales it by the zoom, the screen by 2.
    expect([g, Math.abs(lift(g, 11) * 0.9 * 2 - drop) <= 0.25]).toEqual([g, true]);
    // At zoom 1 the text and the lift grow alike: the ink lands in the middle all the same.
    expect([g, Math.abs(lift(g, 11) * 1 * 2 - drop / 0.9) <= 0.3]).toEqual([g, true]);
  }
  // In the ⋯ menu (12 px text) the lift grows with the text.
  expect(lift("❚❚", 12)).toBeGreaterThan(lift("❚❚", 11));
  expect(lift("▶", 11)).toBe(0); // not measured: left where its font puts it
  // Drawn: each glyph moved up by its lift; the svg (sound) not moved.
  const bar = player(480).bar(theme);
  const button = (id: string) => bar.nodes.find((el: any) => idOf(el) === `pip-${id}`);
  const markOf = (id: string) => button(id).nodes[0];
  expect(callOf(markOf("toggle"), "top")).toEqual([[-lift("❚❚", 11)]]);
  expect(callOf(markOf("close"), "top")).toEqual([[-lift("✕", 11)]]);
  expect(callOf(markOf("keys"), "top")).toEqual([[-lift("?", 11)]]); // ? sat high: moved down
  expect(callOf(markOf("mute"), "top")).toEqual([]);
  // Every place on the bar is its full height, its mark centred in it.
  for (const id of ["back", "toggle", "mute", "keys", "close"]) expect([id, callOf(button(id), "items_center").length, callOf(button(id), "h_full").length]).toEqual([id, 1, 1]);
});

test("the keys popup is as tall as its list: a popup sizes to its content, and the overview inside fills it absolutely", () => {
  opened.length = 0;
  player(480).openKeys();
  const spec = opened.at(-1);
  expect(spec).toMatchObject({ mod: "pip", kind: "popup", width: 340, props: { keys: true } });
  const k: any = Object.create(Pip.prototype);
  k.keysList = true; k.handle = {};
  const host = k.renderKeys(theme);
  // Its own height, the popup's: never size_full (0 in a popup that fits its content).
  expect(callOf(host, "h")).toEqual([[spec.height]]);
  expect(callOf(host, "size_full")).toEqual([]);
  expect(spec.height).toBeGreaterThan(200);
  // Centred on the player: its window (props().overlay), where the core draws it now.
  propsNow = { of: "1:web", overlay: "o7" };
  player(480).openKeys();
  expect(opened.at(-1).at).toEqual({ over: "o7" });
  propsNow = { of: "1:web" };
});

test("the seam tone: a third of the way from the icons' dim to ansi0, one small step darker", () => {
  const moonfly: any = { dim: "#5F6D6D", ansi0: "#323437" };
  expect(pip.seamTone(moonfly)).toBe("#505a5b");
  const lum = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).reduce((a, b) => a + b, 0);
  // Darker than the dim, still well above ansi0 (the hover colour): a step, not gone.
  expect(lum(pip.seamTone(moonfly))).toBeLessThan(lum(moonfly.dim));
  expect(lum(pip.seamTone(moonfly)) - lum(moonfly.ansi0)).toBeGreaterThan((lum(moonfly.dim) - lum(moonfly.ansi0)) / 2);
  // Not a hex colour: the dim as it was.
  expect(pip.mix("red", "#000000", 0.5)).toBe("red");
});

test("snapping: on unless set false; the toggle (s, pip.snap, the bar's magnet) flips the shared mode and the window now", () => {
  store.clear(); runs.length = 0;
  expect(pip.snapOn()).toBe(true);
  propsNow = { of: "1:web", overlay: "o7" };
  const p = player(480);
  // The magnet: in the accent while on, dim off; its name says which.
  const mark = (pl: any) => pl.bar(theme).nodes.find((el: any) => idOf(el) === "pip-snap").nodes[0];
  expect(callOf(mark(p), "text_color")).toEqual([[theme.accent]]);
  p.command(pip.keyControl({ key: "s", key_char: "s" }));
  expect(store.get("pip.snap")).toBe(false);
  expect(runs.at(-1)).toEqual(["overlay.snap", { id: "o7", on: false }]);
  expect(callOf(mark(p), "text_color")).toEqual([[theme.dim]]);
  // Set, not flipped: pip.snap:on.
  p.command(pip.parseCommand("snap:on"));
  expect([store.get("pip.snap"), runs.at(-1)]).toEqual([true, ["overlay.snap", { id: "o7", on: true }]]);
  // As a pane there's no window to tell: the mode alone.
  runs.length = 0;
  player(480, { inPane: true }).command("snap");
  expect([store.get("pip.snap"), runs]).toEqual([false, []]);
  store.clear();
  propsNow = { of: "1:web" };
});

test("from place to place: shift with the arrows and H J K L move the window over the pane grid (overlay.snap to)", () => {
  const key = (k: string, c: string | null = null, shift = false) => pip.keyControl({ key: k, key_char: c, modifiers: { shift } });
  expect([key("left", null, true), key("right", null, true), key("up", null, true), key("down", null, true)]).toEqual(["to:left", "to:right", "to:up", "to:down"]);
  expect([key("h", "H", true), key("l", "L", true), key("k", "K", true), key("j", "J", true)]).toEqual(["to:left", "to:right", "to:up", "to:down"]);
  // Unshifted they stay what they were: 10 s back / on, pause.
  expect([key("left"), key("right"), key("h", "h"), key("k", "k")]).toEqual(["rewind", "forward", "rewind", "toggle"]);
  // Commands too, for keys.json: pip.to:<place | direction>.
  expect(pip.parseCommand("to:bottom-right")).toBe("to:bottom-right");
  expect(pip.parseCommand("to:middle")).toBeNull();
  runs.length = 0;
  propsNow = { of: "1:web", overlay: "o7" };
  player(480).command("to:up");
  player(480).command("to:top-left");
  expect(runs).toEqual([["overlay.snap", { id: "o7", to: "up" }], ["overlay.snap", { id: "o7", to: "top-left" }]]);
  // A pane doesn't move.
  runs.length = 0;
  const pane = player(480, { inPane: true });
  let stopped = false;
  pane.key({ key: "left", modifiers: { shift: true } }, { stop_propagation: () => { stopped = true; }, notify() {} });
  expect([runs, stopped]).toEqual([[], false]);
  propsNow = { of: "1:web" };
  // Every key it takes is listed in ?.
  const listed = pip.KEYS.map(([k]: any) => k).join(" ");
  for (const k of ["s", "H", "L", "K", "J", "⇧←", "⇧→", "⇧↑", "⇧↓"]) expect([k, listed.includes(k)]).toEqual([k, true]);
});

test("out of Fireflies, the window gets the mode and the colours of its seams and its lit toggle", () => {
  calls.length = 0;
  store.set("pip.snap", false);
  const p = player(480);
  p.leave = () => {};
  p.popOut();
  const [, action, args] = calls.at(-1)!;
  expect(action).toBe("pip.popOut");
  expect(args.snap).toBe(false);
  expect(args.colors).toMatchObject({ accent: theme.accent, seam: pip.seamTone(theme), dim: theme.dim });
  store.clear();
});

test("park (⤓, P): the chip is made parked, never a pane in the tab for a moment; unparked, the window comes back", () => {
  runs.length = 0; opened.length = 0;
  propsNow = { of: "1:web", overlay: "o7" };
  const p = player(480);
  p.intoPane(true);
  const [name, args] = runs.at(-1)!;
  expect(name).toBe("pane.split");
  expect(args).toMatchObject({ mod: "pip", park: true, props: { of: "1:web", pane: true, park: true } });
  // Into a pane (◧) lays it out, as before.
  p.intoPane(false);
  expect(runs.at(-1)![1].park).toBeUndefined();
  // The chip's copy hears `unpark` (a click on the chip): the window, snapping as the mode is.
  propsNow = { of: "1:web", pane: true, park: true };
  const chip = player(480, { inPane: true, parks: true, closing: false });
  chip.unpark();
  expect(opened.at(-1)).toMatchObject({ mod: "pip", kind: "window", key: "pip", snap: true, props: { of: "1:web" } });
  // A pane that isn't a chip doesn't.
  opened.length = 0;
  player(480, { inPane: true, parks: false }).unpark();
  expect(opened).toEqual([]);
  propsNow = { of: "1:web" };
});
