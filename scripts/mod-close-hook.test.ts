import { test, expect } from "bun:test";
import { readFile, readdir } from "node:fs/promises";

// A mod's exported View may have `async close(cx)`: Fireflies calls it as cleanup
// when the copy's pane, tab or overlay has already gone. A View that names its
// own "close this pane" action close() closes the pane a second time and the
// person gets a "pane.close failed: no pane" toast (nocturne-files did).
const MODS = new URL("../defaults/mods/", import.meta.url);

/** The body of `close(...) { ... }` in the default-exported class of `source`, or null. */
function closeHook(source: string): string | null {
  const cls = source.search(/^export default class \w+/m);
  if (cls < 0) return null;
  const m = /^  (?:async )?close\([^)]*\)\s*\{/m.exec(source.slice(cls));
  if (!m) return null;
  let i = cls + m.index + m[0].length, depth = 1;
  const start = i;
  for (; i < source.length && depth; i++) depth += source[i] === "{" ? 1 : source[i] === "}" ? -1 : 0;
  return source.slice(start, i - 1);
}

test("no mod's cleanup hook closes a pane, tab or space again", async () => {
  const offenders: string[] = [];
  for (const mod of await readdir(MODS)) {
    const source = await readFile(new URL(`${mod}/main.js`, MODS), "utf8").catch(() => null);
    const body = source && closeHook(source);
    if (body && /run\(\s*["'](pane|tab|space)\.close["']|\.closePane\(|\.quit\(/.test(body)) offenders.push(mod);
  }
  expect(offenders).toEqual([]);
});

test("the check finds a hook that closes its pane", () => {
  expect(closeHook(`export default class X extends View {\n  close() {\n    run("pane.close", { pane: p });\n  }\n}`)).toContain("pane.close");
  expect(closeHook(`export default class X extends View {\n  closePane() {}\n}`)).toBeNull();
});
