import { test, expect } from "bun:test";

// The editor's decisions (defaults/mods/nocturne-editor/logic.js): settings,
// servers and roots, diagnostics, hovers, go to line, colors.
import {
  languageSettings, serverCandidates, languageId, rootScript, pickRoot, uri, pathOf, diagnostics, lineNotes, counts,
  diagnosticsAt, nextProblem, hoverParts, splitMarkdown, parseGoto, firstLocation, firstLine, tilde, syntaxColors, colorOf, colorRuns,
} from "../defaults/mods/nocturne-editor/logic.js";

test("a language's settings: its own over the top level over its convention over the defaults", () => {
  expect(languageSettings(undefined, "rust")).toEqual({ tab_size: 4, insert_spaces: true, soft_wrap: false, format_on_save: false });
  expect(languageSettings({}, "typescript").tab_size).toBe(2);
  expect(languageSettings({}, "go").insert_spaces).toBe(false);
  expect(languageSettings({}, "markdown").soft_wrap).toBe(true);
  const editor = { tab_size: 8, format_on_save: true, languages: { rust: { tab_size: 3, format: ["rustfmt"] } } };
  expect(languageSettings(editor, "typescript").tab_size).toBe(8);
  expect(languageSettings(editor, "rust")).toMatchObject({ tab_size: 3, format_on_save: true, format: ["rustfmt"] });
  expect(languageSettings({ tab_size: 99 }, "rust").tab_size).toBe(16);
  expect(languageSettings({ tab_size: "x" }, "rust").tab_size).toBe(4);
  expect("languages" in languageSettings(editor, "rust")).toBe(false);
});

test("servers: settings.json's argv, off, or the built-in list in order, sharing aliases", () => {
  expect(serverCandidates("rust", {})).toEqual([{ argv: ["rust-analyzer"], settings: null }]);
  expect(serverCandidates("rust", { server: false })).toEqual([]);
  expect(serverCandidates("rust", { server: ["ra-multiplex"], server_settings: { x: 1 } })).toEqual([{ argv: ["ra-multiplex"], settings: { x: 1 } }]);
  const ts = serverCandidates("tsx", {});
  expect(ts[0].argv).toEqual(["typescript-language-server", "--stdio"]);
  expect(ts[0].settings).toEqual({ supportsHoverVerbosity: true });
  expect(serverCandidates("javascript", { server_settings: { preferences: { a: 1 } } })[0].settings).toEqual({ supportsHoverVerbosity: true, preferences: { a: 1 } });
  expect(serverCandidates("python", {}).map((s) => s.argv[0])).toEqual(["basedpyright-langserver", "pyright-langserver", "pylsp"]);
  expect(serverCandidates("csv", {})).toEqual([]);
  expect(serverCandidates("text", {})).toEqual([]);
});

test("languageIds follow LSP's names", () => {
  expect(languageId("tsx", "a.tsx")).toBe("typescriptreact");
  expect(languageId("javascript", "a.jsx")).toBe("javascriptreact");
  expect(languageId("bash", "x.sh")).toBe("shellscript");
  expect(languageId("json", "/p/tsconfig.json")).toBe("jsonc");
  expect(languageId("json", "/p/package.json")).toBe("json");
  expect(languageId("c", "x.cpp")).toBe("cpp");
  expect(languageId("rust", "a.rs")).toBe("rust");
});

test("the workspace root: the nearest marked folder, the outermost for Cargo, else the repository, else the folder", () => {
  const out = "/r/crates/a\n/r\n/home/u\ngit /r\n";
  expect(pickRoot("rust", out, "/r/crates/a/src")).toBe("/r");
  expect(pickRoot("typescript", out, "/r/crates/a/src")).toBe("/r/crates/a");
  expect(pickRoot("go", "git /r\n", "/r/x")).toBe("/r");
  expect(pickRoot("go", "git \n", "/tmp/x")).toBe("/tmp/x");
  expect(rootScript(["Cargo.toml"])).toContain('[ -e "$d/Cargo.toml" ]');
  expect(rootScript([])).toContain("if false;");
});

test("uris round trip with spaces and unicode", () => {
  const p = "/a b/ü#1.rs";
  expect(uri(p)).toBe("file:///a%20b/%C3%BC%231.rs");
  expect(pathOf(uri(p))).toBe(p);
  expect(pathOf("https://x")).toBeNull();
});

const lsp = [
  { range: { start: { line: 4, character: 2 }, end: { line: 4, character: 6 } }, severity: 2, message: "unused", source: "ra", code: "dead_code" },
  { range: { start: { line: 4, character: 9 }, end: { line: 4, character: 12 } }, severity: 1, message: "mismatched types\nexpected `usize`\n  found `&str`", code: { value: "E0308" } },
  { range: { start: { line: 1, character: 0 }, end: { line: 2, character: 3 } }, message: "no severity" },
];

test("diagnostics: sorted, severities named, codes as text, the whole message kept", () => {
  const d = diagnostics(lsp);
  expect(d.map((x) => [x.line, x.col, x.severity])).toEqual([[1, 0, "error"], [4, 2, "warning"], [4, 9, "error"]]);
  expect(d[2].code).toBe("E0308");
  expect(d[2].message).toContain("found `&str`");
  expect(counts(d)).toEqual({ error: 2, warning: 1, info: 0, hint: 0 });
});

test("line notes: the worst problem per line, its first line", () => {
  const notes = lineNotes(diagnostics(lsp), { error: "#f00", warning: "#ff0" });
  expect(notes).toEqual([
    { line: 1, text: "no severity", color: "#f00", mark: "#f00" },
    { line: 4, text: "mismatched types", color: "#f00", mark: "#f00" },
  ]);
  expect(firstLine("\n\n  two\nthree")).toBe("  two");
  expect(firstLine("x".repeat(200), 10)).toBe("x".repeat(9) + "…");
});

test("problems at a place, and the next and previous ones wrapping around", () => {
  const d = diagnostics(lsp);
  expect(diagnosticsAt(d, 4, 10).map((x) => x.code)).toEqual(["E0308"]);
  expect(diagnosticsAt(d, 2, 1).length).toBe(1);
  expect(diagnosticsAt(d, 3, 0).length).toBe(0);
  expect(nextProblem(d, 0, 0, 1)?.line).toBe(1);
  expect(nextProblem(d, 4, 2, 1)?.col).toBe(9);
  expect(nextProblem(d, 9, 0, 1)?.line).toBe(1);
  expect(nextProblem(d, 1, 0, -1)?.col).toBe(9);
  expect(nextProblem([], 0, 0, 1)).toBeNull();
});

test("hover contents: markdown with code fences, marked strings, plain text", () => {
  expect(hoverParts({ kind: "markdown", value: "```rust\nfn x() -> u32\n```\n---\nDocs *here*." })).toEqual([
    { code: "fn x() -> u32", lang: "rust" }, { text: "Docs *here*." },
  ]);
  expect(hoverParts([{ language: "typescript", value: "const a: number" }, "more"])).toEqual([{ code: "const a: number", lang: "typescript" }, { text: "more" }]);
  expect(hoverParts({ kind: "plaintext", value: "plain" })).toEqual([{ text: "plain" }]);
  expect(hoverParts(null)).toEqual([]);
  expect(splitMarkdown("```\nx\n```")).toEqual([{ code: "x", lang: null }]);
});

test("go to line reads line, line:col and :line", () => {
  expect(parseGoto("42")).toEqual({ line: 42, col: 1 });
  expect(parseGoto(":42")).toEqual({ line: 42, col: 1 });
  expect(parseGoto("42:7")).toEqual({ line: 42, col: 7 });
  expect(parseGoto(" 3,2 ")).toEqual({ line: 3, col: 2 });
  expect(parseGoto("0")).toEqual({ line: 1, col: 1 });
  expect(parseGoto("x")).toBeNull();
});

test("a definition's first location from any answer shape", () => {
  const loc = { uri: "file:///a/b.rs", range: { start: { line: 3, character: 4 } } };
  expect(firstLocation(loc)).toEqual({ path: "/a/b.rs", line: 3, col: 4 });
  expect(firstLocation([{ targetUri: "file:///c.ts", targetSelectionRange: { start: { line: 1, character: 2 } } }])).toEqual({ path: "/c.ts", line: 1, col: 2 });
  expect(firstLocation([])).toBeNull();
  expect(tilde("/home/u/x", "/home/u")).toBe("~/x");
});

test("moonfly colors come from the theme, dotted names fall back to their root", () => {
  const t: any = { foreground: "#c6c6c6" };
  for (let i = 0; i < 16; i++) t[`ansi${i}`] = `#${i.toString(16).padStart(6, "0")}`;
  const c = syntaxColors(t);
  expect(c.keyword).toBe(t.ansi5);
  expect(c.function).toBe(t.ansi12);
  expect(colorOf(c, "keyword.return")).toBe(t.ansi5);
  expect(colorOf(c, "function.method.call")).toBe(t.ansi12);
  expect(colorOf(c, "punctuation.bracket")).toBeNull();
  expect(colorRuns("fn main()", [[0, 2, "keyword"], [3, 7, "function"]], c)).toEqual([["fn", t.ansi5], [" ", null], ["main", t.ansi12], ["()", null]]);
});
