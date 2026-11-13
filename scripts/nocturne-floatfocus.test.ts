// The mods' half of "keys never land behind a floating window that shows"
// (floatfocus): the app keeps the keyboard in a window opened with
// `scrim: true` (src/window.rs `Overlay::holds_keys`), so every Git and
// GitHub window must open with one, including the swaps between them (a PR's
// diff in the GitHub window's place, "back" from it). And the window's mod
// takes the keyboard back when the app hands it over (`focus`), which is how
// the app returns it after a popup closes or a focused row stops being drawn.
// Its own process: it stands in for "herdr".
import { test, expect, mock } from "bun:test";
import { readFileSync } from "node:fs";

const src = (f: string) => readFileSync(new URL(`../defaults/mods/${f}`, import.meta.url), "utf8");

/** Every `openOverlay({ ... })` object literal in a file. */
function overlaySpecs(text: string): string[] {
  const out: string[] = [];
  for (let at = text.indexOf("openOverlay({"); at >= 0; at = text.indexOf("openOverlay({", at + 1)) {
    let depth = 0, i = at + "openOverlay(".length;
    for (; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) break;
    }
    out.push(text.slice(at, i + 1));
  }
  return out;
}

test("every Git and GitHub window opens with a scrim, so the app keeps the keyboard in it", () => {
  const files = ["nocturne/git.ts", "nocturne/github.ts", "github/main.js", "git/main.js"];
  const windows = files.flatMap((f) => overlaySpecs(src(f)).filter((s) => /kind:\s*"window"/.test(s)).map((s) => [f, s] as const));
  expect(windows.length).toBeGreaterThanOrEqual(4); // the two toggles, the diff in GitHub's place, back from it
  for (const [f, s] of windows) expect(`${f}: ${s}`).toContain("scrim: true");
});

// ---- the GitHub window takes the keyboard on `focus`

const commands: string[] = [];
let wake: (() => void) | null = null;
const nextCommand = () => new Promise<string>((resolve) => {
  const take = () => { const c = commands.shift(); if (c) resolve(c); else wake = take; };
  take();
});
const send = (c: string) => { commands.push(c); const w = wake; wake = null; w?.(); };

mock.module("herdr", () => ({
  agents: () => [], appHome: () => "/tmp/herdr-test", home: () => "/home/me",
  closeOverlay: () => null, openOverlay: () => "o9",
  exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  focused: () => null, hc: async () => ({ code: 1, stdout: "" }), keys: () => [], layout: () => null,
  nextCommand, notify: () => null, panes: () => [], props: () => ({ folder: "/src", overlay: "o1", tab: "prs" }),
  readTextFile: async () => null, writeTextFile: async () => null, run: () => null,
  settings: () => ({ zoom: 1 }), shared: () => null, setShared: () => null,
  spaces: () => [], terminals: () => [], theme: () => new Proxy({}, { get: () => "#808080" }), window: () => ({ platform: "linux" }),
  nativeView: undefined, nextNativeViewEvent: () => new Promise(() => {}), nativeViewCall: () => null,
}));
const el: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : () => el), apply: () => el });
class View {}
mock.module("gpui-kit", () => ({ View, div: () => el, svg: () => el, image: () => el, PathBuilder: { fill: () => el }, Background: { checkerboard: () => el } }));
class Input { v = ""; on() { return true; } value() { return this.v; } set_value(v: string) { this.v = v; } focus() {} release() { return true; } set_auto_grow() {} }
mock.module("gpui-base", () => ({
  h_flex: () => el, v_flex: () => el, v_virtual_list: () => el, TextView: { markdown: () => el },
  VirtualListScrollHandle: { new: () => ({ scroll_to_item() {}, release() {} }) }, ScrollHandle: { new: () => ({ scroll_to_item() {}, release() {} }) },
  InputState: { new: () => new Input() }, Input: { new: () => el }, TextareaState: { new: () => new Input() }, Textarea: { new: () => el },
}));
globalThis.window = { paint_path: () => el } as any;

test("the GitHub window takes the keyboard back when the app hands it over", async () => {
  let focused = 0;
  const cx: any = {
    focus_handle: () => ({ focus() { focused++; }, is_focused: () => false, release: () => true }),
    spawn(fn: (cx: any) => Promise<void>) { fn(cx).catch(() => {}); }, notify() {}, stop_propagation() {},
    timer: { after() {}, every() {} }, bind_keys() {}, open_url() {},
  };
  const { default: GitHub } = await import("../defaults/mods/github/main.js");
  const g: any = new GitHub();
  g.init({}, cx);
  const atOpen = focused;
  expect(atOpen).toBeGreaterThanOrEqual(1); // it takes the keyboard as it opens
  send("focus");
  await new Promise((r) => setTimeout(r, 0));
  expect(focused).toBe(atOpen + 1);
});
