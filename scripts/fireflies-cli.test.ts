// The `fireflies` command as the manual and the installers name it: the
// window manual (src/SKILL.md, `fireflies --skill`) calls every command as
// `fireflies …`, never `herdr-app …` or `hc …`; each `fireflies <word>` it
// writes is a window command at the top level (src/cli.rs), `app`, `core`, or
// one of herdr-core's commands (they pass through); `ls` is the core's, so the
// window's list is written `fireflies app ls`. The installers link `ff`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(root + p, "utf8");
const skill = read("src/SKILL.md");
const cli = read("src/cli.rs");

const list = (name: string) => {
  const m = cli.match(new RegExp(`const ${name}: &\\[&str\\] = &\\[([^\\]]*)\\]`));
  if (!m) throw new Error(`${name} not found in src/cli.rs`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};
const WINDOW = list("WINDOW");
const FLAGS = list("WINDOW_FLAGS");
const SHARED = list("SHARED");
// herdr-core 0.1.18's top-level commands (`hc --help`); a newer core's pass through too.
const CORE = ["run", "ls", "get", "attach", "read", "kill", "rm", "label", "keep", "send", "keys", "interrupt", "wait", "put", "exec", "file", "templates", "events", "server", "update", "machine", "connect", "schema"];

// Code in the manual: fenced blocks and inline spans (a span may wrap a line).
const code = [...skill.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1])
  .concat([...skill.replace(/```[\s\S]*?```/g, "").matchAll(/`([^`]+)`/g)].map((m) => m[1]));

test("the window and the core don't share a name the window keeps", () => {
  for (const name of SHARED) {
    expect(WINDOW).not.toContain(name);
    expect(CORE).toContain(name);
  }
  for (const name of WINDOW) expect(CORE).not.toContain(name);
});

test("the manual calls every command fireflies", () => {
  const calls = code.flatMap((c) => [...c.matchAll(/(?:^|\s|\()(herdr-app|hc)\s+([a-z-]+)/gm)].map((m) => m[0].trim()));
  expect(calls).toEqual([]);
  expect(skill.startsWith("# fireflies:")).toBe(true);
  expect(skill).toContain("fireflies core --skill");
});

test("each fireflies <word> in the manual goes where the manual means", () => {
  const words = code.flatMap((c) => [...c.matchAll(/(?:^|\s)fireflies\s+([a-z-]+)/gm)].map((m) => m[1]));
  expect(words.length).toBeGreaterThan(40);
  const known = new Set([...WINDOW, ...FLAGS, "app", "core", ...CORE]);
  expect(words.filter((w) => !known.has(w))).toEqual([]);
  // The window's spaces > tabs > terminals list is `app ls`.
  expect(skill).toMatch(/fireflies app ls\s+# spaces > tabs > terminals/);
});

test("the installers link fireflies and ff beside herdr-app", () => {
  expect(read("src/core_bin/cli_link.rs")).toContain('const LINKS: [&str; 3] = ["fireflies", "ff", "herdr-app"];');
  const sh = read("distribution/install.sh");
  expect(sh).toContain("for name in fireflies ff; do");
  expect(sh.match(/link_names "\$/g)?.length).toBe(2);
});
