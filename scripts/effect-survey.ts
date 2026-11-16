// What converting each mod to Effect would meet (docs/effect-mods.md): per
// mod, its size, what it decodes, execs, fetches and times, the swallowed
// errors, and what the Effect lint (oxlint.effect.config.ts) says of it
// today, rule by rule. Report only: it changes nothing and fails nothing.
//
//   bun scripts/effect-survey.ts            a Markdown table per mod
//   bun scripts/effect-survey.ts --json     the same as JSON
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const mods = join(root, "defaults/mods");

/** A mod's own .ts files (shared copies counted once, where they live, by name). */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "art" || name === "icons" || name === "fonts" ? [] : files(path);
    return name.endsWith(".ts") && !name.endsWith(".d.ts") ? [path] : [];
  });
}

/**
 * The shared copies: a file whose name and text are the same in two mods or
 * more (docs/mods-typescript.md, Shared copies), found by content. Counted
 * once, in a table of their own, not in each mod.
 */
const copies = new Map<string, string[]>();
for (const mod of readdirSync(mods)) {
  const dir = join(mods, mod);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of files(dir)) {
    const key = `${f.split("/").pop()}\n${readFileSync(f, "utf8")}`;
    copies.set(key, [...(copies.get(key) ?? []), f]);
  }
}
const shared = new Set([...copies.values()].filter((fs) => fs.length > 1).flat());
const isShared = (f: string) => shared.has(f);

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

interface Row {
  mod: string;
  files: number;
  lines: number;
  guards: number;
  json: number;
  exec: number;
  fetch: number;
  timers: number;
  spawns: number;
  swallowed: number;
  lint: Map<string, number>;
}

const rows: Row[] = [];
for (const mod of readdirSync(mods).sort()) {
  const dir = join(mods, mod);
  if (!statSync(dir).isDirectory()) continue;
  const own = files(dir).filter((f) => !isShared(f));
  if (own.length === 0) continue;
  const text = own.map((f) => readFileSync(f, "utf8")).join("\n");
  rows.push({
    mod,
    files: own.length,
    lines: count(text, /\n/g),
    guards: count(text, /\b(object|arrayOf|literal|nullable|oneOf|parseJson|parseJsonMap|sharedKey|sharedMapKey|sharedListKey)\(/g),
    json: count(text, /JSON\.parse\(/g),
    exec: count(text, /\b(exec|hc)\(/g),
    fetch: count(text, /\bfetch\(/g),
    timers: count(text, /\.timer\.(after|every)\(|\.sleep\(/g),
    spawns: count(text, /\.spawn\(/g),
    swallowed: count(text, /catch\(\s*\(\s*\)\s*=>\s*(null|undefined|\{\s*\}|\[\]|""|false)/g) + count(text, /catch\s*\{\s*(\/\*[^*]*\*\/)?\s*\}/g),
    lint: new Map(),
  });
}

// The Effect lint over every mod's own files, one run per mod (type-aware).
for (const row of rows) {
  const own = files(join(mods, row.mod)).filter((f) => !isShared(f)).map((f) => relative(root, f));
  row.lint = lint(own);
}

/** The Effect lint's findings over `paths`, by rule. */
function lint(paths: string[]): Map<string, number> {
  const found = new Map<string, number>();
  const run = Bun.spawnSync([join(root, "node_modules/.bin/effect-tsgo"), "oxlint", "--type-aware", "-c", "oxlint.effect.config.ts", "--format", "unix", ...paths], { cwd: root });
  for (const m of run.stdout.toString().matchAll(/\[(?:Error|Warning)\/((?:effecttsgo|anti-slop-effect)\([a-z0-9-]+\))\]/g)) {
    const rule = m[1] ?? "";
    found.set(rule, (found.get(rule) ?? 0) + 1);
  }
  return found;
}

/** One row per shared file: the mods that carry it, its lines, the findings of one copy. */
const sharedRows = [...copies.values()].filter((fs) => fs.length > 1).map((fs) => {
  const first = fs[0] ?? "";
  const findings = [...lint([relative(root, first)]).values()].reduce((a, b) => a + b, 0);
  return { file: first.split("/").pop() ?? "", mods: fs.map((f) => relative(mods, f).split("/")[0]), lines: count(readFileSync(first, "utf8"), /\n/g), findings };
}).sort((a, b) => a.file.localeCompare(b.file));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ mods: rows.map((r) => ({ ...r, lint: Object.fromEntries(r.lint) })), shared: sharedRows }, null, 2));
} else {
  console.log("| mod | files | lines | guards | JSON.parse | exec | fetch | timers | spawns | swallowed | Effect lint (top rules) |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const top = [...r.lint].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k.replace(/^effecttsgo\((.*)\)$/, "$1")} ${v}`).join(", ");
    const total = [...r.lint.values()].reduce((a, b) => a + b, 0);
    console.log(`| ${r.mod} | ${r.files} | ${r.lines} | ${r.guards} | ${r.json} | ${r.exec} | ${r.fetch} | ${r.timers} | ${r.spawns} | ${r.swallowed} | ${total}: ${top} |`);
  }
  console.log("\n| shared file | copies | lines | findings (one copy) |\n|---|---|---|---|");
  for (const r of sharedRows) console.log(`| ${r.file} | ${r.mods.join(", ")} | ${r.lines} | ${r.findings} |`);
}
