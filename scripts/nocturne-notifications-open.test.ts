// The notifications overview opens without a jump: it draws unseen until its
// parts have measured, so the first frame anyone sees already has the height
// and key bar it settles at. gpui stand-ins record each element's calls (its
// height, opacity, size callbacks); a "frame" is a render, then the size
// callbacks fired with the sizes the real layout reports. Its own process: it
// stands in for "herdr".
import { test, expect, mock, beforeEach } from "bun:test";

let sharedState: Record<string, unknown> = {};
mock.module("herdr", () => ({
  closeOverlay: () => null, openOverlay: () => "o9", run: () => null, nextCommand: () => new Promise(() => {}),
  props: () => ({ overlay: "o1", most: 580 }), settings: () => ({ zoom: 0.9 }), theme: () => theme,
  shared: (k: string) => sharedState[k] ?? null, setShared: (k: string, v: unknown) => { sharedState[k] = v; return null; },
  window: () => ({ platform: "macos" }), terminals: () => [], agents: () => [], hc: async () => ({ code: 1, stdout: "" }), exec: async () => ({ code: 1, stdout: "" }),
}));

type Rec = { calls: Record<string, any[][]>; kids: any[] };
function el(): any {
  const rec: Rec = { calls: {}, kids: [] };
  const proxy: any = new Proxy(rec, {
    get: (t, k: string) => {
      if (k === "rec") return t;
      if (k === "then") return undefined;
      return (...a: any[]) => {
        (t.calls[k] ??= []).push(a);
        if (k === "child") t.kids.push(a[0]);
        else if (k === "children") t.kids.push(...a[0]);
        else if (k === "when") { if (a[0]) a[1](proxy); }
        else if (k === "map") return a[0](proxy);
        return proxy;
      };
    },
  });
  return proxy;
}
mock.module("gpui-kit", () => ({ View: class {}, div: el, svg: el, image: el, PathBuilder: { fill: el }, Background: { checkerboard: el } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} }
mock.module("gpui-base", () => ({ h_flex: el, v_flex: el, InputState: { new: () => new Input() }, Input: { new: el } }));
(globalThis as any).window = { paint_path: el };
const theme: any = new Proxy({}, { get: () => "#808080" });

const { default: Overview } = await import("../defaults/mods/nocturne-notifications/overview.js");
const { ITEMS } = await import("../defaults/mods/nocturne-notifications/engine.js");

const cx: any = { focus_handle: () => ({ focus() {}, is_focused: () => true }), spawn() {}, notify() {}, stop_propagation() {}, timer: { after() {}, every() {} } };

/** Every recorded element under `e`, depth first. */
const all = (e: any): Rec[] => (e?.rec ? [e.rec, ...e.rec.kids.flatMap(all)] : []);
const idOf = (r: Rec) => r.calls.id?.[0]?.[0];

// The sizes the real layout reports for the overview's parts (drawn px at zoom 0.9).
const SIZES: Record<string, { width: number; height: number }> = {
  "notify-list-body": { width: 280 * 0.9, height: 2 * 34 * 0.9 + 42 * 0.9 },
  "notify-top": { width: 600, height: 76 * 0.9 },
  "notify-detail-body": { width: 600, height: 190 * 0.9 },
  "notify-empty": { width: 380, height: 150 * 0.9 },
  "ov-bar": { width: 880 * 0.9, height: 30 * 0.9 },
};

/** One frame: render, then the layout's size reports. What was drawn: its height, whether seen, the bar's hints. */
function frame(v: any) {
  const root = v.render(cx);
  const els = all(root);
  const r = root.rec as Rec;
  const drawn = {
    height: r.calls.h?.at(-1)?.[0],
    seen: !(r.calls.opacity ?? []).some(([o]) => o === 0),
    hints: els.map(idOf).filter((id) => typeof id === "string" && id.startsWith("ov-hint-")),
  };
  for (const e of els) {
    const id = idOf(e);
    for (const [cb] of e.calls.on_size_change ?? []) {
      const s = SIZES[id] ?? (String(id).startsWith("ov-hint-") ? { width: 90, height: 15 } : id === "ov-keys" ? { width: 45, height: 15 } : null);
      if (s) cb(s, cx);
    }
  }
  return drawn;
}

const permission = {
  id: "t2:perm", type: "permission", answerable: true, address: "t2", name: "claude", logo: "claude", since: Date.now(), program: "Claude Code",
  request: { type: "permission", tool: "Bash", line: "ls -la", options: [{ n: 1, label: "Yes", kind: "yes" }, { n: 2, label: "No", kind: "no" }], canAmend: true },
};

beforeEach(() => { sharedState = {}; });

for (const [name, items] of [["with a request", [permission]], ["empty", []]] as const) {
  test(`overview ${name}: the first frame seen has the height and key bar it settles at`, () => {
    sharedState[ITEMS] = items;
    const v: any = new Overview();
    v.init({}, cx);
    const frames = [frame(v), frame(v), frame(v)];
    const settled = frames.at(-1)!;
    expect(settled.seen).toBe(true);
    // Settled below the popup's most: it is as tall as what it shows.
    expect(settled.height).toBeLessThan(580);
    expect(frames[1]).toEqual(settled);
    const seen = frames.filter((f) => f.seen);
    expect(seen[0]).toEqual(settled);
    // The one unseen frame is the one before the parts measured.
    expect(frames[0].seen).toBe(false);
  });
}

test("overview: a request coming in while it's open changes its height, seen (no blank frame)", () => {
  sharedState[ITEMS] = [];
  const v: any = new Overview();
  v.init({}, cx);
  frame(v); const empty = frame(v);
  sharedState[ITEMS] = [permission];
  const next = [frame(v), frame(v)];
  expect(next.every((f) => f.seen)).toBe(true);
  expect(next[1].height).not.toBe(empty.height);
});
