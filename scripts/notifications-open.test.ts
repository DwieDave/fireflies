// The notifications overview opens without a jump: it draws unseen until its
// parts have measured, so the first frame anyone sees already has the height
// and key bar it settles at. gpui stand-ins record each element's calls (its
// height, opacity, size callbacks); a "frame" is a render, then the size
// callbacks fired with the sizes the real layout reports. Its own process: it
// stands in for "herdr".
import { test, expect, mock, beforeEach } from "bun:test";

let sharedState: Record<string, unknown> = {};
let specs: any[] = [];
let propsNow: any = { overlay: "o1", most: 580 };
mock.module("herdr", () => ({
  closeOverlay: () => null, openOverlay: (spec: any) => { specs.push(spec); return "o9"; }, run: () => null, nextCommand: () => new Promise(() => {}),
  props: () => propsNow, settings: () => ({ zoom: 0.9 }), theme: () => theme,
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

const { default: Overview, EMPTY_H } = await import("../defaults/mods/notifications/overview.ts");
const notif = await import("../defaults/mods/notifications/open.ts");
const { ITEMS } = await import("../defaults/mods/notifications/engine.ts");

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

/** An item as the engine writes it (model.ts isItem): the fields a fixture leaves out. */
const ITEM = { machine: null, adapter: "claude", kind: null, msg: "", program: "Claude Code", app: "claude-code", space: null, spaceName: "", tab: null, tabName: "",
  tabIndex: null, tail: null, title: "", line: "", answerable: false, request: null, status: "blocked" };
/** A permission request as the claude adapter makes it: the fields a fixture leaves out. */
const PERM_REQUEST = { title: "", question: "", description: "", input: null, from: "hook" };
const permission = {
  ...ITEM, id: "t2:perm", type: "permission", answerable: true, address: "t2", name: "claude", logo: "claude", since: Date.now(), program: "Claude Code",
  request: { ...PERM_REQUEST, type: "permission", tool: "Bash", line: "ls -la", options: [{ n: 1, label: "Yes", kind: "yes" }, { n: 2, label: "No", kind: "no" }], canAmend: true },
};

beforeEach(() => { sharedState = {}; specs = []; propsNow = { overlay: "o1", most: 580 }; });

for (const [name, items] of [["with a request", [permission]], ["empty", []]] as const) {
  test(`overview ${name}: the first frame seen has the height and key bar it settles at`, () => {
    sharedState[ITEMS] = items;
    const v: any = new Overview();
    v.init({}, cx);
    const frames = [frame(v), frame(v), frame(v)];
    const settled = frames.at(-1)!;
    expect(settled.seen).toBe(true);
    // With a request: the popup's most, all the room it has. Empty: EMPTY_H, more than its note.
    if (items.length) expect(settled.height).toBe(580);
    else expect(settled.height).toBe(EMPTY_H);
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

// ---- how tall: the room below the strip, up to OVERVIEW_H

/** Under the bell in a window `height` drawn px tall (zoom 0.9): its spec. */
function underBell(height: number) {
  notif.noteWindow({ width: 1600, height });
  // The bell: its top at 6, 24 layout px tall.
  const z = 0.9;
  return notif.overviewPlace({ position: { x: 1500, y: 12 }, local_position: { x: 10, y: 6 }, bounds: { width: 40, height: 24 * z } });
}

test("the overview's height: a small window's room below the strip, a laptop's most, a tall window's cap", () => {
  const z = 0.9;
  const top = 6 + 24 * z + 6 * z;
  // Small (500 px): the room below the strip, 8 px from the window's bottom.
  const small = underBell(500);
  expect(small.at.y).toBe(Math.round(top));
  expect(small.height).toBe(Math.floor((500 - Math.round(top) - 8) / z));
  // A laptop's (1000 px): all the room below the strip, most of the window.
  const normal = underBell(1000);
  expect(normal.height).toBe(notif.OVERVIEW_H);
  expect(normal.height * z).toBeGreaterThan(0.8 * 1000);
  expect(Math.round(top) + normal.height * z).toBeLessThanOrEqual(1000 - 8);
  // Tall (1600 px): no taller than the cap.
  expect(underBell(1600).height).toBe(notif.OVERVIEW_H);
  // A tiny window: still 160 at the least.
  expect(underBell(150).height).toBe(160);
});

test("the overview is taller than it was: with a request it fills the popup's most, whatever it shows", () => {
  sharedState[ITEMS] = [permission];
  const v: any = new Overview();
  v.init({}, cx);
  frame(v); frame(v);
  expect(frame(v).height).toBe(580);
  expect(notif.OVERVIEW_H).toBeGreaterThan(580);
});

// ---- opened by a key (centered) or by a press on the bell (under it)

const BELL_PRESS = { position: { x: 1500, y: 12 }, local_position: { x: 10, y: 6 }, bounds: { width: 40, height: 24 * 0.9 } };

for (const [how, press] of [["by a key: centered", null], ["by a click on the bell: under it", BELL_PRESS]] as const) {
  for (const [name, items] of [["with a request", [permission]], ["empty", []]] as const) {
    test(`overview opened ${how}, ${name}: its first frame seen is the settled one`, () => {
      notif.noteWindow({ width: 1600, height: 1000 });
      sharedState[ITEMS] = items;
      notif.openOverview(null, press);
      const spec = specs.at(-1);
      if (press) expect(spec).toMatchObject({ kind: "popup", at: { x: expect.any(Number), y: expect.any(Number) } });
      else { expect(spec.kind).toBe("dialog"); expect(spec.at).toBeUndefined(); expect(spec.height).toBeUndefined(); }
      propsNow = { overlay: "o9", ...spec.props };
      const v: any = new Overview();
      v.init(spec.props, cx);
      const frames = [frame(v), frame(v), frame(v)];
      const settled = frames.at(-1)!;
      expect(frames.filter((f) => f.seen)[0]).toEqual(settled);
      if (items.length) expect(settled.height).toBe(spec.props.most);
      else expect(settled.height).toBe(EMPTY_H);
      // The taller size, both ways: under the bell, the room below the strip; centered, 85% of the window.
      expect(spec.props.most).toBe(Math.min(notif.OVERVIEW_H, press ? notif.OVERVIEW_H : Math.floor(1000 * 0.85 / 0.9)));
      expect(spec.props.most).toBeGreaterThan(580);
    });
  }
}

// ---- empty: a center, not a sliver around its note

test("the empty overview is EMPTY_H tall (a center's height, not its note's), never more than its room", () => {
  sharedState[ITEMS] = [];
  const settle = (most: number, keys = false) => {
    propsNow = { overlay: "o1", most };
    const v: any = new Overview();
    v.init({}, cx);
    v.keysShown = keys;
    frame(v); frame(v);
    return frame(v);
  };
  // The note and the list would make it about 250 (what it was): EMPTY_H now, seen from its first frame.
  expect(EMPTY_H).toBeGreaterThanOrEqual(500);
  expect(settle(900).height).toBe(EMPTY_H);
  expect(settle(900).seen).toBe(true);
  // A small window's room is the most.
  expect(settle(300).height).toBe(300);
  // Its ? keys still make it taller when they need more.
  expect(settle(900, true).height).toBeGreaterThanOrEqual(EMPTY_H);
});

// ---- answering: the driver waits for the dialog, not for any change on a busy screen

test("drive settled(): a ticking status line isn't the key's effect; the dialog changing is", async () => {
  const { settled } = await import("../defaults/mods/notifications/drive.ts");
  const { dialog } = await import("../defaults/mods/notifications/claude.ts");
  const rule = "─".repeat(80);
  const dlg = (label: string, foot: string) => [rule, " Bash command", " ls", " Do you want to proceed?", ` ❯ 1. ${label}`, "   2. No", "", ` ${foot}`].join("\n");
  const before = dlg("Yes", "Esc to cancel · Tab to amend");
  const after = dlg("Yes, and tell Claude what to do next", "Esc to cancel");
  // Three reads where only the status line ticks, then the note line drawn.
  const reads = [`${before}\n◐ 1`, `${before}\n◐ 2`, `${before}\n◐ 3`, `${after}\n◐ 4`, `${after}\n◐ 5`];
  let i = 0;
  const read = async () => reads[Math.min(i++, reads.length - 1)];
  const sleepy = { sleep: async () => {} };
  const got = await settled(sleepy, "t1", `${before}\n◐ 0`, dialog, read);
  expect(got).toContain("tell Claude what to do next");
  // Compared whole (no dialog view), the first tick would have counted.
  i = 0;
  expect(await settled(sleepy, "t1", `${before}\n◐ 0`, undefined, read)).toBe(`${before}\n◐ 2`);
});
