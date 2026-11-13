// The picture in picture player's bar (nocturne-pip): its controls in sections,
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
let propsNow: any = { of: "1:web" };
const theme: any = new Proxy({}, { get: (_t, k) => `#${String(k)}` });
mock.module("herdr", () => ({
  props: () => propsNow, theme: () => theme, settings: () => ({ zoom: 1 }), closeOverlay() {}, openOverlay: (s: any) => { opened.push(s); },
  run() {}, panes: () => [], focused: () => null, shared: () => null, setShared() {}, nextCommand: () => new Promise(() => {}),
  window: () => ({ platform: "macos" }), nativeView: undefined, nextNativeViewEvent: () => new Promise(() => {}), nativeViewCall() {},
}));
mock.module("gpui-kit", () => ({ View: class {}, div: () => new Element(), svg: () => new Element(), PathBuilder: { fill: () => new Element() }, Background: { checkerboard: () => ({}) } }));
mock.module("gpui-base", () => ({ h_flex: () => new Element(), v_flex: () => new Element() }));
(globalThis as any).window = { paint_path: () => new Element() };

const pip = await import("../defaults/mods/nocturne-pip/main.js");
const { default: Pip, fit, sections } = pip;

/** A player as the window draws it, `width` px wide. */
function player(width: number, extra: any = {}) {
  const p: any = Object.create(Pip.prototype);
  Object.assign(p, { width, inPane: false, parks: false, hover: null, playing: true, muted: false, handle: { is_focused: () => false }, ...extra });
  return p;
}
/** The bar's row, left to right: control ids ("more" for ⋯) and "|" for a seam. */
function row(p: any) {
  const bar = p.bar(theme);
  return bar.nodes.slice(1).map((el: any) => (idOf(el)?.startsWith("pip-") ? idOf(el).slice(4) : "|"));
}

test("wide, the bar is four sections with a seam between: where it came from, playback, where it goes, the window's own", () => {
  expect(row(player(480))).toEqual(["back", "|", "rewind", "toggle", "forward", "mute", "|", "pane", "park", "out", "|", "keys", "close"]);
  // A seam: a short dithered upright, not a control (no id, no click).
  const seam = player(480).bar(theme).nodes[2];
  expect([callOf(seam, "w"), callOf(seam, "h"), callOf(seam, "on_click").length, seam.nodes.length]).toEqual([[[2]], [[12]], 0, 1]);
  // As a pane (◧ is the window's): its section keeps ⤓ ⇱.
  expect(row(player(480, { inPane: true }))).toEqual(["back", "|", "rewind", "toggle", "forward", "mute", "|", "park", "out", "|", "keys", "close"]);
});

test("narrow doesn't fit goes into ⋯ (before ✕): a section left empty takes its seam along", () => {
  const widths = [480, 322, 321, 300, 260, 240];
  const rows = widths.map((w) => row(player(w)));
  // 322 px: everything (ten controls, three seams, the title's room).
  expect(rows[1]).toEqual(["back", "|", "rewind", "toggle", "forward", "mute", "|", "pane", "park", "out", "|", "keys", "close"]);
  expect(rows[2]).toEqual(["back", "|", "rewind", "toggle", "forward", "mute", "|", "pane", "park", "|", "more", "close"]);
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
  expect(more).toEqual(["rewind", "forward", "pane", "out", "keys"]);
  opened.length = 0;
  p.openMore(more);
  expect(opened.at(-1)).toMatchObject({ mod: "nocturne-pip", kind: "popup", height: 5 * 26 + 2 * 9 + 10, props: { menu: more } });
  propsNow = { menu: more, playing: true, muted: false };
  const m: any = Object.create(Pip.prototype);
  m.menu = more; m.cursor = 0; m.handle = {};
  const menu = m.renderMenu(theme);
  const kinds = menu.nodes.map((el: any) => (idOf(el)?.startsWith("pm-") ? idOf(el).slice(3) : "rule"));
  expect(kinds).toEqual(["rewind", "forward", "rule", "pane", "out", "rule", "keys"]);
  // The cursor walks the rows alone (the rules aren't stops): from ⇱ (3) j goes to ? (4).
  expect(pip.menuMove("j", 3, 5)).toBe(4);
  // The row under the cursor is lit by its index among the rows, past a rule too.
  m.cursor = 3;
  const lit = m.renderMenu(theme).nodes.find((el: any) => idOf(el) === "pm-out");
  expect(callOf(lit, "text_color")[0][0]).toBe(theme.foreground);
  propsNow = { of: "1:web" };
});
