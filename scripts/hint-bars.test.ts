// The keys/options bars: the help entry (? keys) is the last thing in every
// bar, after a right-aligned group too. gpui and herdr stand-ins that record
// what each element draws, in order (mock.module is process-wide: this file
// runs alone).
import { test, expect, mock } from "bun:test";

class El {
  kids: any[] = [];
  constructor(public text?: string) {
    return new Proxy(this, {
      get: (t, k: string, proxy) => k in t ? (t as any)[k] : k === "then" ? undefined : (...a: any[]) => {
        if (k === "child") t.kids.push(a[0]);
        else if (k === "children") t.kids.push(...a[0]);
        else if (k === "when") { if (a[0]) a[1](proxy); }
        else if (k === "map") return a[0](proxy);
        return proxy;
      },
    });
  }
}
/** The strings an element draws, depth first, in order. */
const texts = (e: any): string[] => typeof e === "string" ? [e] : e instanceof Object && "kids" in e ? e.kids.flatMap(texts) : [];

let focusedNow: any = { space: "s1", tab: "t1", pane: "p1", terminal: "a/1", block: "tabs" };
const LAYOUT = { id: "root", type: "row", children: [
  { id: "sidebar", type: "block", content: { mod: "nocturne", props: { role: "sky" } } },
  { id: "tabs", type: "block", content: { mod: "nocturne", props: { role: "tabs" } } },
] };
const herdr: Record<string, any> = {
  settings: () => ({ zoom: 1 }), window: () => ({ platform: "linux" }), agents: () => [], appHome: () => "/tmp/app",
  closeOverlay: () => {}, commands: () => [], exec: async () => ({ code: 1, stdout: "", stderr: "" }), focused: () => focusedNow,
  hc: async () => ({ code: 0, stdout: "" }), home: () => "/home/a", keys: () => [], knownAgents: () => [], layout: () => LAYOUT,
  layouts: () => ["nocturne"], nextCommand: () => new Promise(() => {}), notify: () => {}, openOverlay: () => "o1",
  panes: () => [{ pane: "p1", tab: "t1", terminal: "a/1", focused: true, cwd: "/home/a" }], pickFolder: async () => null,
  presentUpdateNotes: () => {}, props: () => ({ role: "tabs" }), run: () => null, setAgentOrder: () => {}, setShared: () => {},
  shared: () => null, spaces: () => [{ id: "s1", name: "one", active: true, folder: "/home/a", tabs: [{ id: "t1", index: 1, active: true, name: "1" }] }],
  terminals: () => [], theme: () => theme, updates: () => null,
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: () => new El(), image: () => new El(), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} }
mock.module("gpui-base", () => ({
  h_flex: () => new El(), v_flex: () => new El(), v_virtual_list: () => new El(), Scrollbar: { new: () => new El() },
  InputState: { new: () => new Input() }, Input: { new: () => new El() },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) }, VirtualListScrollHandle: { new: () => ({}) },
}));
const cx: any = { spawn() {}, notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {}, is_focused: () => true }), new: () => ({ set_props() {} }), timer: { every() {}, after() {} } };
(globalThis as any).window = { paint_path: () => new El() };
const theme: any = new Proxy({}, { get: () => "#808080" });

const gh = await import("../defaults/mods/github/kit.ts");

test("GitHub window: ? keys sits after the right-aligned note, at the bar's end", () => {
  const right = new El().child("loaded 2 min ago");
  const bar = gh.hints(theme, [["j/k", "move"], ["?", "keys"], ["esc", "close"]], right);
  expect(texts(bar)).toEqual(["j/k", "move", "esc", "close", "loaded 2 min ago", "?", "keys"]);
  // Without a note, and without a help entry.
  expect(texts(gh.hints(theme, [["j/k", "move"], ["?", "keys"]], null)).slice(-2)).toEqual(["?", "keys"]);
  expect(texts(gh.hints(theme, [["esc", "close"]], right))).toEqual(["esc", "close", "loaded 2 min ago"]);
});

const gitDraw = await import("../defaults/mods/git/draw.ts");

test("Git window: ? keys ends its options bar, after the global keys and the note", () => {
  const bar = gitDraw.hints(theme, [["j/k", "move"]], new El().child("q closes this pane"), null, { ends: [["P", "push"]], help: ["?", "keys"] });
  expect(texts(bar).slice(-3)).toEqual(["q closes this pane", "?", "keys"]);
});

const { default: Tabs } = await import("../defaults/mods/nocturne/tabs.ts");
const { default: Sky } = await import("../defaults/mods/nocturne/sky.js");

test("tab strip: with the keyboard, ? keys is the strip's last word, after its tool buttons", () => {
  const s: any = new Tabs();
  s.init({ role: "tabs" }, cx);
  s.render(cx);
  s.takeKeys();
  const words = texts(s.render(cx));
  expect(words.slice(-2)).toEqual(["?", "keys"]);
  expect(words.filter((w) => w === "keys")).toHaveLength(1);
  expect(words.indexOf("+ new")).toBeGreaterThanOrEqual(0);
  expect(words.indexOf("+ new")).toBeLessThan(words.length - 1);
});

test("sidebar: its hint line ends with ? keys", () => {
  const words = texts((Object.create(Sky.prototype) as any).hints(theme));
  expect(words.slice(-2)).toEqual(["?", "keys"]);
});

const { default: Overview, KEYS: OVERVIEW_KEYS } = await import("../defaults/mods/notifications/overview.js");

test("notifications overview: ? keys ends its key bar, after the sent / not sent note; its key list ends with ? too", () => {
  const o: any = Object.create(Overview.prototype);
  const it = { id: "a", type: "other", status: "error" };
  o.note = { id: "a", text: "sent" };
  expect(texts(o.footer(theme, it)).slice(-3)).toEqual(["sent", "?", "keys"]);
  o.note = null;
  expect(texts(o.footer(theme, it)).slice(-2)).toEqual(["?", "keys"]);
  expect(OVERVIEW_KEYS.at(-1)[0]).toBe("?");
  o.keysShown = true;
  // keyhelp.ts's overview: its head, then every key.
  expect(texts(o.keysStrip(theme))).toEqual(["KEYS", "waiting on you", "? esc", "close", ...OVERVIEW_KEYS.flat()]);
});
