// Nocturne's toast shows its whole text when the window sizes it to fit
// (props.fitHeight, upstream Herdr's "show the whole toast text" ported to the
// fork's toast): no line is cut off, and a body's every line stays; without
// fitHeight it keeps one line each, cut off. Recording gpui stand-ins; its own
// process (mock.module is process-wide).
import { test, expect, mock } from "bun:test";

let propsNow: Record<string, unknown> = {};

mock.module("herdr", () => ({
  props: () => propsNow, closeOverlay: () => {}, run: () => null, theme: () => theme,
  shared: () => null, setShared: () => {}, settings: () => ({ zoom: 1 }), layout: () => ({}), window: () => ({ platform: "macos" }),
  agents: () => [], appHome: () => "/tmp/app", commands: () => [], exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  focused: () => null, hc: async () => ({ code: 0, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: () => [],
  layouts: () => ["nocturne"], nextCommand: () => new Promise(() => {}), notify: () => {}, openOverlay: () => "o9",
  panes: () => [], pickFolder: async () => null, presentUpdateNotes: () => {}, setAgentOrder: () => {},
  spaces: () => [], terminals: () => [], updates: () => null, readTextFile: async () => null, writeTextFile: async () => {},
  watchFolder: () => new Promise(() => {}), themes: () => [], fonts: () => [],
}));

/** An element stand-in that records its calls and children. */
interface Rec { calls: [string, unknown[]][]; kids: Rec[] }
const make = (): any => {
  const rec: Rec = { calls: [], kids: [] };
  const el: any = new Proxy(rec, {
    get: (o, k) => {
      if (k === "calls" || k === "kids") return (o as any)[k];
      if (k === "then") return undefined;
      return (...a: any[]) => {
        rec.calls.push([String(k), a]);
        if (k === "when" && a[0]) a[1](el);
        if (k === "child" && a[0] && typeof a[0] === "object") rec.kids.push(a[0]);
        if (k === "child" && typeof a[0] === "string") rec.calls.push(["text", [a[0]]]);
        return el;
      };
    },
  });
  return el;
};
mock.module("gpui-kit", () => ({ View: class {}, div: make, svg: make, image: make, PathBuilder: { fill: make }, Background: { checkerboard: make } }));
mock.module("gpui-base", () => ({ h_flex: make, v_flex: make }));
const theme: any = new Proxy({}, { get: () => "#808080" });

const { default: Toast } = await import("../defaults/mods/nocturne/toast.ts");

/** Every element under `root` that holds `text` as a child. */
const holding = (root: Rec, text: string): Rec[] =>
  [...(root.calls.some(([k, a]) => k === "text" && a[0] === text) ? [root] : []), ...root.kids.flatMap((k) => holding(k, text))];
const called = (r: Rec, name: string) => r.calls.some(([k]) => k === name);

const LONG = "a very long agent message that goes well past the width of one toast line";

test("fitted: the title and every body line show whole, the card grows (no fixed size)", () => {
  propsNow = { title: LONG, body: "first line\nsecond line", level: "info", fitHeight: true, overlay: "o1" };
  const root = new Toast().render() as unknown as Rec;
  expect(called(root, "size_full")).toBe(false);
  expect(root.calls.find(([k]) => k === "min_h")?.[1]).toEqual([70]);
  const [title] = holding(root, LONG);
  expect(title && called(title, "truncate")).toBe(false);
  const [body] = holding(root, "first line\nsecond line");
  expect(body && called(body, "truncate")).toBe(false);
});

test("not fitted: one line each, cut off, in the toast's fixed box", () => {
  propsNow = { title: LONG, body: "first line\nsecond line", level: "error", overlay: "o1" };
  const root = new Toast().render() as unknown as Rec;
  expect(called(root, "size_full")).toBe(true);
  const [title] = holding(root, LONG);
  expect(title && called(title, "truncate")).toBe(true);
  expect(holding(root, "first line\nsecond line")).toEqual([]);
  const [body] = holding(root, "first line");
  expect(body && called(body, "truncate")).toBe(true);
});
