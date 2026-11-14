// Optional mods in "+ new" and the palette (defaults/mods/nocturne/launchers.ts):
// a mod.json `launcher` read from every installed mod, kept in shared
// `nocturne.launchers`, turned into panels (window, pane, tab) without
// Nocturne knowing the mod by name.
import { beforeEach, describe, expect, mock, test } from "bun:test";

const files = new Map<string, string>();
const shared = new Map<string, unknown>();
const runs: { name: string; args: unknown }[] = [];

mock.module("herdr", () => ({
  appHome: () => "/h",
  readTextFile: (p: string) => Promise.resolve(files.get(p) ?? null),
  run: (name: string, args: unknown) => { runs.push({ name, args }); return null; },
  shared: (k: string) => shared.get(k) ?? null,
  setShared: (k: string, v: unknown) => { shared.set(k, v); return null; },
}));
mock.module("fs/promises", () => ({
  readdir: () => Promise.resolve([...new Set([...files.keys()].map((p) => p.split("/")[3] ?? ""))]),
}));

const { readLaunchers, launchers, launcherPanels, launcherKey } = await import("../defaults/mods/nocturne/launchers.ts");

beforeEach(() => {
  files.clear();
  shared.clear();
  runs.length = 0;
});

describe("launchers", () => {
  test("only mods that declare one, in folder order; a broken mod.json is skipped", async () => {
    files.set("/h/mods/k8s/mod.json", JSON.stringify({ place: "none", launcher: { title: "Kubernetes", icon: "icon.svg", words: "pods", window: true, pane: true } }));
    files.set("/h/mods/git/mod.json", JSON.stringify({ place: "none", focusable: true }));
    files.set("/h/mods/broken/mod.json", "{ not json");
    files.set("/h/mods/odd/mod.json", JSON.stringify({ launcher: { title: 7 } }));
    files.set("/h/mods/notes/mod.json", JSON.stringify({ launcher: { title: "Notes", pane: true } }));
    await readLaunchers();
    expect(launchers().map((l) => l.mod)).toEqual(["k8s", "notes"]);
  });

  test("window and pane: the plain pick opens the window, beside a pane, a tab its own", async () => {
    files.set("/h/mods/k8s/mod.json", JSON.stringify({ launcher: { title: "Kubernetes", icon: "icon.svg", words: "pods", window: true, pane: true } }));
    await readLaunchers();
    const [p] = launcherPanels();
    expect(p).toMatchObject({ id: "mod:k8s", name: "Kubernetes", icon: "mods/k8s/icon.svg", fixed: "float", words: "pods k8s" });
    p?.pane();
    p?.beside?.();
    p?.tab();
    expect(runs[0]).toEqual({ name: "mod.open", args: { name: "k8s" } });
    expect(runs[1]).toMatchObject({ name: "pane.split", args: { direction: "auto", mod: "k8s", props: { slot: expect.any(String) } } });
    expect(runs[2]).toMatchObject({ name: "tab.new", args: { name: "kubernetes", mod: "k8s" } });
  });

  test("pane only: no window; window only: every pick opens the window; an icon path is never followed", async () => {
    files.set("/h/mods/a/mod.json", JSON.stringify({ launcher: { title: "A", pane: true, icon: "../../x.svg" } }));
    files.set("/h/mods/b/mod.json", JSON.stringify({ launcher: { title: "B", window: true } }));
    await readLaunchers();
    const [a, b] = launcherPanels();
    expect(a?.fixed).toBeUndefined();
    expect(a?.icon).toBe("layers");
    a?.pane();
    b?.tab();
    expect(runs.map((r) => r.name)).toEqual(["pane.split", "mod.open"]);
  });

  test("the shared list is written only when it changed", async () => {
    files.set("/h/mods/k8s/mod.json", JSON.stringify({ launcher: { title: "Kubernetes", window: true } }));
    await readLaunchers();
    const first = shared.get("nocturne.launchers");
    await readLaunchers();
    expect(shared.get("nocturne.launchers")).toBe(first);
  });

  test("a launcher's key: one letter or digit, kept as its mod.json says it and taken lower case", async () => {
    files.set("/h/mods/k8s/mod.json", JSON.stringify({ launcher: { title: "Kubernetes", window: true, pane: true, key: "k" } }));
    await readLaunchers();
    expect(launchers()[0]?.key).toBe("k");
    expect(launcherPanels(["t", "w"]).map((p) => p.key)).toEqual(["k"]);
    expect(["k", "K", "7", "kk", "", "ü", "-", " ", undefined].map(launcherKey)).toEqual(["k", "k", "7", null, null, null, null, null, null]);
  });

  test("a key already taken goes nowhere: Nocturne's own tiles', the menu's own (q, 1-9), the first launcher's by folder name", async () => {
    const asks = { a: "k", b: "k", c: "t", d: "q", e: "3", f: "kk", g: "0" };
    for (const [mod, key] of Object.entries(asks)) files.set(`/h/mods/${mod}/mod.json`, JSON.stringify({ launcher: { title: mod.toUpperCase(), pane: true, key } }));
    await readLaunchers();
    const keys = Object.fromEntries(launcherPanels(["t", "w", "f"]).map((p) => [p.id, p.key]));
    expect(keys).toEqual({ "mod:a": "k", "mod:b": "", "mod:c": "", "mod:d": "", "mod:e": "", "mod:f": "", "mod:g": "0" });
  });
});
