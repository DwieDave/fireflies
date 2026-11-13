import { test, expect } from "bun:test";
import { SCOPES, rows, shortcut } from "../defaults/mods/equalize-panes/scopes.js";

test("each row runs pane.equalize with its scope and the popup's pane; the grid row gridifies", () => {
  expect(rows("p3", 4).map((r) => [r.command, r.args])).toEqual([
    ["pane.equalize", { scope: "all", pane: "p3" }], ["pane.equalize", { scope: "row", pane: "p3" }],
    ["pane.equalize", { scope: "column", pane: "p3" }], ["nocturne.gridify", {}],
  ]);
  expect(rows(null, 2)[1].args).toEqual({ scope: "row" });
});

test("a lone pane has nothing to even out", () => {
  expect(rows("p1", 1).every((r) => r.off)).toBe(true);
  expect(rows("p1", 2).some((r) => r.off)).toBe(false);
});

test("keys are distinct", () => {
  expect(new Set(SCOPES.map((s) => s.key)).size).toBe(SCOPES.length);
});

test("shortcuts: bare pane.equalize counts as all; terminal-only bindings don't show", () => {
  const bound = [
    { section: "layout:nocturne", keys: "cmd-alt-e", action: "pane.equalize:all" },
    { section: "terminal", keys: "ctrl-r", action: "pane.equalize:row" },
    { section: "global", keys: "ctrl-shift-c", action: "pane.equalize:column" },
  ];
  expect(shortcut(bound, "all")).toBe("cmd-alt-e");
  expect(shortcut([{ section: "global", keys: "f9", action: "pane.equalize" }], "all")).toBe("f9");
  expect(shortcut(bound, "row")).toBe("");
  expect(shortcut(bound, "column")).toBe("ctrl-shift-c");
});

test("the grid row shows gridify's key", () => {
  expect(shortcut([{ section: "layout:nocturne", keys: "cmd-alt-g", action: "nocturne.gridify" }], "grid")).toBe("cmd-alt-g");
});
