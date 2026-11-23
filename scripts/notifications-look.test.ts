// The notifications views by layout (docs/plain-look.md): in nocturne the
// dithered, square chrome; in herdr-app's default layout (main) upstream's
// popover frame, rounded rows and buttons, no checker anywhere, no art. The
// overview (each kind of request, its keys, its menu), the bell and the
// question dialog. Elements are recorders (every call kept); herdr is
// notifications-host.ts' one stand-in. Its own process: it stands in for
// herdr, gpui-kit and gpui-base.
import { test, expect, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { newHost, notificationsHerdr } from "./notifications-host.ts";

type Rec = { kind: string; calls: [string, unknown[]][] };
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && "calls" in v && "kind" in v;
const make = (kind: string) => (...a: unknown[]): any => {
  const rec: Rec = { kind: a.length ? `${kind}(${JSON.stringify(a.map((x) => (isRec(x) ? x.kind : typeof x === "function" ? "fn" : x)))})` : kind, calls: [] };
  const el: any = new Proxy(rec, { get: (o, k) => (k === "calls" || k === "kind" ? (o as any)[k] : k === "then" ? undefined : (...args: unknown[]) => {
    o.calls.push([String(k), args]);
    if (k === "map") return (args[0] as (e: unknown) => unknown)(el);
    if (k === "when" && args[0]) return (args[1] as (e: unknown) => unknown)(el);
    return el;
  }) });
  return el;
};

/** Every element and call of a drawn tree, as "kind" and "method(args)" strings. */
const calls = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) { for (const x of v) calls(x, out); return out; }
  if (!isRec(v)) return out;
  out.push(v.kind);
  for (const [k, a] of v.calls) { out.push(`${k}(${JSON.stringify(a.filter((x) => typeof x !== "object" && typeof x !== "function"))})`); calls(a, out); }
  return out;
};

const ROOT = `${import.meta.dir}/..`;
const layouts: Record<string, unknown> = { nocturne: JSON.parse(readFileSync(`${ROOT}/defaults/layouts/nocturne.json`, "utf8")), main: JSON.parse(readFileSync(`${ROOT}/defaults/layouts/main.json`, "utf8")) };
const theme: any = new Proxy({ background: "#080808", foreground: "#c6c6c6", accent: "#80a0ff", muted: "#949494", dim: "#5F6D6D", border: "#323437", input: "#323437", popover: "#101010", raised: "#181818", selected: "#1c1c1c", hover: "#1c1c1c", done: "#00ff00", blocked: "#ff0000", working: "#ffff00" }, { get: (o: any, k) => o[k] ?? "#808080" });
const host = newHost(theme);
let looks = 0;
/** Draws from here on in `name`'s look (a new layout name: the look library reads it again). */
const use = (name: string) => { host.layout = layouts[name]; looks += 1; host.layoutName = `${name}-${looks}`; };
mock.module("herdr", () => notificationsHerdr(host));
mock.module("gpui-kit", () => ({ View: class {}, div: make("div"), svg: make("svg"), image: make("image"), PathBuilder: { fill: () => make("path")() }, Background: { checkerboard: () => "checker" } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} }
mock.module("gpui-base", () => ({ h_flex: make("h_flex"), v_flex: make("v_flex"), InputState: { new: () => new Input() }, Input: { new: make("Input") } }));
(globalThis as any).window = { paint_path: (_p: unknown, bg: unknown) => make("paint_path")(bg), viewport_size: () => ({ width: 1600, height: 1000 }) };

const { default: Overview } = await import("../defaults/mods/notifications/overview.ts");
const { default: Bell } = await import("../defaults/mods/notifications/bell.ts");
const { default: Ask } = await import("../defaults/mods/notifications/ask-dialog.ts");
const { ITEMS } = await import("../defaults/mods/notifications/engine.ts");
const cx: any = { focus_handle: () => ({ focus() {}, is_focused: () => true }), notify() {}, stop_propagation() {}, timer: { after() { return { cancel() {} }; }, every() {} } };

const ITEM = { machine: null, adapter: "claude", kind: null, msg: "", program: "Claude Code", app: "claude-code", space: "s1", spaceName: "fireflies", tab: "c1", tabName: "1", tabIndex: 1, tail: null, title: "", line: "", answerable: false, request: null, status: "blocked", since: 1000 };
const PERM = { ...ITEM, id: "t2:perm", type: "permission", answerable: true, address: "t2", name: "claude", logo: "claude",
  request: { type: "permission", tool: "Bash", line: "ls -la", input: { command: "ls -la" }, description: "list", title: "", question: "", from: "hook", canAmend: true, options: [{ n: 1, label: "Yes", kind: "yes" }, { n: 2, label: "No", kind: "no" }] } };
const QUEST = { ...ITEM, id: "t3:q", type: "question", answerable: true, address: "t3", name: "claude", logo: "claude",
  request: { type: "question", from: "hook", questions: [{ header: "Color", question: "Which color?", multiSelect: false, options: [{ label: "Red", description: "warm" }, { label: "Blue", description: "cool" }] }] } };
const ERR = { ...ITEM, id: "t4:e", type: "other", status: "error", address: "t4", name: "codex", logo: "codex", msg: "it failed", tail: "line 1\nline 2" };

/** Every view drawn in the look now: the overview on each request (its keys, its menu, empty), the bell, a question dialog. */
function drawAll(): string[] {
  const out: string[] = [];
  for (const [items, sel] of [[[], null], [[PERM, QUEST, ERR], "t2:perm"], [[PERM, QUEST, ERR], "t3:q"], [[PERM, QUEST, ERR], "t4:e"]] as const) {
    host.shared = { [ITEMS]: items };
    host.props = { overlay: "o1", most: 580 };
    const v: any = new Overview();
    v.init({}, cx);
    if (sel !== null) v.sel = sel;
    v.sizes = new Map([["list", 200], ["bar", 800], ["empty", 150], ["top", 70], ["detail", 190]]);
    calls(v.render(cx), out);
    if (sel === "t2:perm") {
      v.keysShown = true;
      calls(v.render(cx), out);
      v.keysShown = false;
      v.key({ key: "m", modifiers: {} }, cx);
      calls(v.render(cx), out);
    }
  }
  host.props = null;
  calls(new Bell().render(cx), out);
  host.props = { terminal: "t3", overlay: "o2" };
  const a: any = new Ask();
  a.init({ terminal: "t3", overlay: "o2" }, cx);
  calls(a.render(cx), out);
  return out;
}
const has = (list: string[], s: string) => list.some((c) => c.includes(s));

test("in nocturne: the checker, square corners, the fireflies art when nothing waits, the menu in its accent frame", () => {
  use("nocturne");
  const d = drawAll();
  expect(has(d, "checker")).toBe(true);
  expect(d.filter((c) => c.startsWith("rounded(") && c !== "rounded([0])")).toEqual([]);
  expect(has(d, "art/fireflies.svg")).toBe(true);
  expect(has(d, 'id(["ov-menu"])')).toBe(true);
  expect(has(d, 'border_color(["#80a0ff"])')).toBe(true);
});

test("in main (herdr-app's default): the popover frame, rounded rows and buttons, no checker, no art", () => {
  use("main");
  const d = drawAll();
  expect(has(d, "checker")).toBe(false);
  expect(has(d, "rounded([10])")).toBe(true); // the overview's and the dialog's popover frame
  expect(has(d, "rounded([8])")).toBe(true); // the menu's popover
  expect(has(d, "rounded([6])")).toBe(true); // the chosen row
  expect(has(d, "art/fireflies.svg")).toBe(false);
  expect(has(d, 'id(["ov-menu"])')).toBe(true);
});
