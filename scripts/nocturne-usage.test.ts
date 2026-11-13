// The sky's usage section (nocturne/usage.ts): a window the provider gave no
// length (Codex without limit_window_seconds) is taken as the usual one (5 h,
// a week), as the usage pane does, so its path still shows where the clock is.
// Stand-ins for herdr and gpui (mock.module is process-wide: this file runs alone).
import { test, expect, mock } from "bun:test";

class El {
  kids: any[] = [];
  calls: Record<string, any[]> = {};
  constructor(public tag?: string) {
    return new Proxy(this, {
      get: (t, k: string, proxy) => k in t ? (t as any)[k] : k === "then" ? undefined : (...a: any[]) => {
        if (k === "child") t.kids.push(a[0]);
        else if (k === "children") t.kids.push(...a[0]);
        else if (k === "when") { if (a[0]) return a[1](proxy); }
        else if (k === "map") return a[0](proxy);
        else t.calls[k] = a;
        return proxy;
      },
    });
  }
}
const idOf = (e: any) => e?.calls?.id?.[0];
function find(root: any, id: string): any {
  if (idOf(root) === id) return root;
  for (const k of root?.kids ?? []) { const f = find(k, id); if (f) return f; }
}
const tags = (e: any): string[] => [e?.tag ?? "", ...(e?.kids ?? []).flatMap(tags)];

const now = Date.now();
const store: Record<string, unknown> = {
  "usage.provider": "codex",
  // Codex: the short window without its length, half way to its reset.
  "usage.last.codex": { state: "ok", session: { used: 40, resets: now + 2.5 * 3600_000, length: null }, week: null, scoped: [], plan: null, at: now },
};
mock.module("herdr", () => ({
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), hc: async () => ({ code: 1, stdout: "", stderr: "" }), home: () => "/h", agents: () => [], focused: () => null,
  panes: () => [], spaces: () => [], terminals: () => [], run: () => null,
  settings: () => ({ zoom: 1 }), window: () => ({ platform: "linux", active: true }),
  shared: (k: string) => store[k] ?? null, setShared: (k: string, v: unknown) => { store[k] = v; return null; },
}));
mock.module("gpui-kit", () => ({ div: () => new El(), svg: (p: string) => new El(`svg:${p}`), PathBuilder: { fill: () => new El() }, Background: { checkerboard: () => ({}) } }));
mock.module("gpui-base", () => ({ h_flex: () => new El(), v_flex: () => new El() }));
(globalThis as any).window = { paint_path: () => new El("dither") };
const theme: any = new Proxy({}, { get: (_t, k) => `#${String(k)}` });

const { UsageSection } = await import("../defaults/mods/nocturne/usage.ts");

test("a window without a length is taken as the usual one: its path still shows the clock's plus", () => {
  const u = new UsageSection();
  const row = find(u.render(theme), "usage-5h");
  expect(row).toBeDefined();
  expect(tags(row).filter((t) => t.endsWith("/pip.svg")).length).toBe(1);
});
