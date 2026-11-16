// Settings → Web: enabling Chromium (its download, progress, failure in
// words, removal) and the rows that wait for it, through the Settings mod's
// own render (dialog-stubs.ts stands in for herdr and gpui). Its own bun process.
import { test, expect, beforeEach } from "bun:test";
import { state, find, texts, cx, press } from "./dialog-stubs.ts";

const Settings = (await import("../defaults/frame/settings/main.js")).default;

beforeEach(() => {
  state.runs = [];
  state.chromium = { available: true, built: true, installed: false, phase: "idle", done: 0, total: 134874408 };
});

function web() {
  state.props = { overlay: "settings", section: "web" };
  const s: any = new Settings();
  s.init({}, cx());
  return s;
}

/** The app draws an element once: one in two places of a tree fails there ("already added to a parent"). */
function singleUse(root: any, seen = new Set<any>()): void {
  for (const n of root?.nodes ?? []) {
    if (typeof n !== "object" || n === null) continue;
    if (seen.has(n)) throw new Error("an element is in the tree twice");
    seen.add(n);
    singleUse(n, seen);
  }
}

const shown = (s: any) => {
  const root = s.render(cx());
  singleUse(root);
  return texts(root).join(" ");
};
const click = (s: any, id: string) => find(s.render(cx()), id)!.calls.on_click[0](null, cx());

test("web: off until enabled; Enable runs chromium.install", () => {
  const s = web();
  expect(s.section).toBe("web");
  const text = shown(s);
  expect(text).toContain("A 135 MB download");
  expect(text).toContain("Enable Chromium first");
  // The engine and video rows aren't controls yet: only Enable is.
  expect(s.order.map((c: any) => c.id).filter((id: string) => id.startsWith("st-") && id !== "st-feedback")).toEqual(["st-cr-enable"]);
  click(s, "st-cr-enable");
  expect(state.runs).toEqual([["chromium.install", undefined]]);
});

test("web: a running download shows its progress and can be cancelled", () => {
  state.chromium = { ...state.chromium, phase: "downloading", done: 45e6 };
  const s = web();
  expect(shown(s)).toContain("Downloading 45 MB of 135 MB");
  click(s, "st-cr-cancel");
  expect(state.runs).toEqual([["chromium.cancel", undefined]]);
  state.chromium = { ...state.chromium, phase: "verifying" };
  expect(shown(s)).toContain("Checking the download");
});

test("web: a cut download resumes, a failure says why", () => {
  state.chromium = { ...state.chromium, done: 60e6 };
  let s = web();
  expect(shown(s)).toContain("60 MB of 135 MB downloaded: Enable resumes.");
  expect(texts(find(s.render(cx()), "st-cr-enable"))).toContain("Enable again");
  state.chromium = { ...state.chromium, done: 0, phase: "failed", error: "The download server doesn't answer." };
  s = web();
  expect(shown(s)).toContain("The download server doesn't answer.");
});

test("web: installed, it shows its size and removes; the engine rows are live", () => {
  state.chromium = { ...state.chromium, installed: true, version: "156.0.8078.96", engineBytes: 327e6, dataBytes: 12e6, started: true };
  const s = web();
  const text = shown(s);
  expect(text).toContain("Chromium 156.0.8078.96 · 327 MB on disk, its logins and cache 12 MB.");
  expect(text).not.toContain("Enable Chromium first");
  const ids = s.order.map((c: any) => c.id);
  expect(ids).toContain("st-engine-chromium");
  expect(ids).toContain("st-video-ask");
  click(s, "st-cr-remove");
  expect(state.runs).toEqual([["chromium.remove", undefined]]);
  expect(shown(s)).toContain("Restart Fireflies to finish removing it.");
});

test("web: not offered (another platform's build) says so and offers nothing", () => {
  state.chromium = { available: false };
  const s = web();
  expect(shown(s)).toContain("Not offered on this computer.");
  expect(s.order.map((c: any) => c.id)).not.toContain("st-cr-enable");
});

test("web: the rail lists Web after Editor on a Mac", () => {
  const s = web();
  press(s.render(cx()), "up");
  expect(s.section).toBe("editor");
  press(s.render(cx()), "down");
  expect(s.section).toBe("web");
});
