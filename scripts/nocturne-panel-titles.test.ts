// A panel's long title stays inside its panel, ending in an ellipsis: the
// GitHub window's panels (kit.js panel: a job's steps beside the log) and
// git's (draw.js panel: the title cut into the frame). gpui and
// herdr stand-ins that record every style call (mock.module is process-wide:
// this file runs alone).
import { test, expect, mock } from "bun:test";

class El {
  kids: any[] = [];
  calls: string[] = [];
  constructor() {
    return new Proxy(this, {
      get: (t, k: string, proxy) => k in t ? (t as any)[k] : k === "then" ? undefined : (...a: any[]) => {
        t.calls.push(a.length ? `${k}(${a.map((x) => typeof x === "object" ? "…" : String(x)).join(",")})` : k);
        if (k === "child") t.kids.push(a[0]);
        else if (k === "children") t.kids.push(...a[0]);
        else if (k === "when") { if (a[0]) a[1](proxy); }
        else if (k === "map") return a[0](proxy);
        return proxy;
      },
    });
  }
}
/** The path of elements from `e` down to the one drawing `text`. */
function pathTo(e: any, text: string): any[] | null {
  if (!(e instanceof Object) || !("kids" in e)) return null;
  if (e.kids.includes(text)) return [e];
  for (const k of e.kids) { const p = pathTo(k, text); if (p) return [e, ...p]; }
  return null;
}

mock.module("herdr", () => ({ settings: () => ({ zoom: 0.9 }), window: () => ({ platform: "linux" }) }));
mock.module("gpui-kit", () => ({ View: class {}, div: () => new El(), svg: () => new El(), image: () => new El(), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
mock.module("gpui-base", () => ({ h_flex: () => new El(), v_flex: () => new El() }));
(globalThis as any).window = { paint_path: () => new El() };
const theme: any = new Proxy({}, { get: () => "#808080" });

const gh = await import("../defaults/mods/github/kit.js");
const git = await import("../defaults/mods/git/draw.js");

const LONG = "Deploy PR preview environment / Deploy preview namespace";

test("GitHub window: a long title shrinks and ends in an ellipsis; its header clips; the right label keeps its room", () => {
  const p = gh.panel(theme, "steps", LONG, true, new El(), { right: "2/6" });
  const path = pathTo(p, LONG)!;
  const [title, header] = [path[path.length - 1], path[path.length - 2]];
  expect(title.calls).toContain("truncate");
  expect(title.calls).toContain("min_w(0)");
  expect(title.calls).toContain("flex_shrink(1)");
  expect(header.calls).toContain("overflow_hidden");
  expect(header.calls).toContain("min_w(0)");
  expect(p.calls).toContain("min_w(0)");
  const right = pathTo(p, "2/6")!;
  expect(right[right.length - 1].calls).toContain("flex_none");
});

test("git: a long title cut into the frame ends in an ellipsis before the right label", () => {
  const t = new El().child(LONG);
  const p = git.panel(theme, "main-a", [t], true, new El(), { right: new El().child("⧉") });
  const path = pathTo(p, LONG)!;
  expect(t.calls).toContain("truncate");
  expect(t.calls).toContain("min_w(0)");
  const head = path[path.length - 2], label = path[path.length - 3];
  expect(head.calls).toContain("min_w(0)");
  expect(head.calls).toContain("overflow_hidden");
  expect(label.calls).toContain("overflow_hidden");
  expect(label.calls).toContain("flex_shrink(1)");
});
