// What a folder can run, whatever its tools: one shell probe reads the
// folder's manifests in a single round trip (so it works on another machine
// too), and plain parsers turn them into scripts. No runner is assumed; each
// manifest that is there adds its own group.
//
//   package.json     scripts, run with the package manager its lockfile names
//                    (bun.lock / bun.lockb: bun, pnpm-lock.yaml: pnpm,
//                    yarn.lock: yarn, else packageManager, else npm)
//   justfile         recipes (not _private or [private] ones)
//   Makefile         targets
//   Cargo.toml       build, run, test, clippy, each [[bin]] and example
//   deno.json(c)     tasks
//   pyproject.toml   [project.scripts], poetry / pdm scripts (uv run when
//                    uv.lock is there, poetry run / pdm run for theirs)
//   Taskfile.yml     tasks
//   mise.toml        [tasks.*]
//   composer.json    scripts (not its pre-/post- event hooks)
//   go.mod           run, test, build, and each cmd/<name>
//   scripts/, bin/   executable files
//   flake.nix        nix flake check / update here; its outputs and system
//                    configurations come from nix.ts (an evaluation, in the
//                    background)
//
// A script: { id, runner, group, name, cmd, hint? }. `cmd` is one shell line
// for `hc run`; `id` stays the same between looks (recents go by it).

import type { Guard } from "./guard.ts";
import { isString, literal, object } from "./guard.ts";
import type { JsonRecord } from "./guards.ts";
import { fields, isRecord } from "./guards.ts";
import type { Sys } from "./nix.ts";
import { NO_SYS, nixStatic, scriptId } from "./nix.ts";

/** Runs as root, asking for the password in its terminal ("osascript" from runs before: sudo too). */
export type Admin = "sudo" | "osascript";

/** One thing a folder can run (see the top); what the deck lists, keeps in
 *  shared("scripts.found") and starts. */
export interface Script {
  readonly id: string;
  readonly runner: string;
  readonly group: string;
  readonly name: string;
  readonly cmd: string;
  /** What it runs, shown beside its name (package.json's line, a recipe's parameters). */
  readonly hint?: string;
  readonly admin?: Admin;
  /** A nix switch: "darwin-rebuild:<name>" / "nixos-rebuild:<name>" (nix.ts switchPlan). */
  readonly plan?: string;
  /** This machine's own configuration. */
  readonly here?: boolean;
}

/** A script as another copy of the deck (or an older one) kept it. */
export const isScript: Guard<Script> = object(
  { id: isString, runner: isString, group: isString, name: isString, cmd: isString },
  { hint: isString, admin: literal("sudo", "osascript"), plan: isString, here: literal(true, false) },
);

/** A script before its id. */
type Unnamed = Omit<Script, "id">;

/** Manifests the probe reads, at most 256 KiB each. */
export const MANIFESTS = [
  "package.json", "justfile", "Justfile", ".justfile", "Makefile", "makefile", "GNUmakefile",
  "Cargo.toml", "deno.json", "deno.jsonc", "pyproject.toml", "Taskfile.yml", "Taskfile.yaml",
  "taskfile.yml", "taskfile.yaml", "mise.toml", ".mise.toml", "composer.json", "go.mod",
] as const;

export type Manifest = (typeof MANIFESTS)[number];

const isManifest = literal(...MANIFESTS);

/** The probe: a POSIX sh script run in the folder. Its output is sections,
 *  each opened by a line "\u001e<name>" (a record separator). */
export const PROBE = [
  `printf '\\036ls\\n'; ls -1A 2>/dev/null`,
  // Who and where: this host's name (a Mac's LocalHostName), the user, the OS and CPU.
  `printf '\\036sys\\n'; (scutil --get LocalHostName 2>/dev/null || hostname -s 2>/dev/null || hostname); id -un; uname -s; uname -m`,
  `printf '\\036exec\\n'; for d in scripts bin; do [ -d "$d" ] && find "$d" -maxdepth 1 \\( -type f -o -type l \\) -perm -u+x 2>/dev/null; done`,
  `printf '\\036examples\\n'; [ -d examples ] && ls -1 examples 2>/dev/null`,
  `printf '\\036cmd\\n'; [ -d cmd ] && for d in cmd/*/; do [ -d "$d" ] && echo "$d"; done`,
  `for f in ${MANIFESTS.join(" ")}; do [ -f "$f" ] && { printf '\\036file %s\\n' "$f"; head -c 262144 "$f"; echo; }; done`,
  "true",
].join("; ");

/** What the probe found: the folder's names, executable files under
 *  scripts/ and bin/, examples/, cmd/'s folders, each manifest's text, the machine. */
export interface Probe {
  readonly ls: ReadonlySet<string>;
  readonly exec: readonly string[];
  readonly examples: readonly string[];
  readonly cmd: readonly string[];
  readonly files: ReadonlyMap<Manifest, string>;
  readonly sys: Sys;
}

/** Splits the probe's output into its sections (Probe). */
export function parseProbe(out: string): Probe {
  let ls: ReadonlySet<string> = new Set<string>();
  let exec: string[] = [], examples: string[] = [], cmd: string[] = [];
  let sys = NO_SYS;
  const files = new Map<Manifest, string>();

  for (const part of out.split("\u001e").slice(1)) {
    const nl = part.indexOf("\n");
    const head = nl < 0 ? part : part.slice(0, nl);
    const body = nl < 0 ? "" : part.slice(nl + 1);
    const lines = () => body.split("\n").map((l) => l.trim()).filter(Boolean);
    const file = head.startsWith("file ") ? head.slice(5) : null;

    if (head === "ls") ls = new Set(lines());
    else if (head === "exec") exec = lines();
    else if (head === "examples") examples = lines();
    else if (head === "sys") {
      const [host, user, os, arch] = lines();

      sys = { host: host ?? null, user: user ?? null, os: os ?? null, arch: arch ?? null };
    } else if (head === "cmd") cmd = lines().map((l) => l.replace(/\/+$/, ""));
    else if (file !== null && isManifest(file)) files.set(file, body);
  }

  return { ls, exec, examples, cmd, files, sys };
}

const q = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

const first = <M extends Manifest>(files: ReadonlyMap<Manifest, string>, names: readonly M[]) => names.find((n) => files.has(n));

/** JSON with // and /* comments and trailing commas (deno.jsonc) that `guard`
 *  proves, or null. */
export function looseJson<T>(text: string, guard: Guard<T>): T | null {
  const proven = (json: string) => {
    const value: unknown = JSON.parse(json);

    return guard(value) ? value : null;
  };

  try { return proven(text); } catch { /* try without comments */ }

  try {
    const bare = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, s: string | undefined) => s ?? "").replace(/,(\s*[}\]])/g, "$1");

    return proven(bare);
  } catch { return null; }
}

/** A little TOML: each table's keys and their raw values. Enough for names and keys, not values. */
export interface Toml {
  /** By table name ("" the top, "tool.poetry.scripts"), key → its raw value. */
  readonly tables: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Arrays of tables ([[bin]]), by name ("bin"). */
  readonly arrays: ReadonlyMap<string, readonly ReadonlyMap<string, string>[]>;
}

/** Reads `text`'s tables (Toml). */
export function tomlTables(text: string): Toml {
  const top = new Map<string, string>();
  const tables = new Map<string, Map<string, string>>([["", top]]);
  const arrays = new Map<string, Map<string, string>[]>();
  let cur = top;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\s+/, "");

    if (!line || line.startsWith("#")) continue;

    let m = /^\[\[\s*([^\]]+?)\s*\]\]/.exec(line);

    if (m?.[1] !== undefined) {
      const list = arrays.get(m[1]) ?? [];

      cur = new Map();
      list.push(cur);
      arrays.set(m[1], list);
      continue;
    }

    m = /^\[\s*([^\]]+?)\s*\]/.exec(line);

    if (m?.[1] !== undefined) {
      const k = m[1].replace(/\s*\.\s*/g, ".").replace(/"/g, "");
      const table = tables.get(k) ?? new Map<string, string>();

      tables.set(k, table);
      cur = table;
      continue;
    }

    m = /^("(?:[^"\\]|\\.)*"|'[^']*'|[\w.-]+)\s*=\s*(.*)$/.exec(line);

    if (m?.[1] !== undefined && m[2] !== undefined) cur.set(m[1].replace(/^["']|["']$/g, ""), m[2].trim());
  }

  return { tables, arrays };
}

const unquote = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "");

/** package.json's fields read here. */
const isPackage = object({}, { scripts: isRecord, packageManager: isString });

function packageScripts(files: ReadonlyMap<Manifest, string>, ls: ReadonlySet<string>): Unnamed[] {
  const pkg = looseJson(files.get("package.json") ?? "", isPackage);
  const lines = pkg?.scripts === undefined ? new Map<string, string>() : fields(pkg.scripts, isString);
  const scripts = pkg?.scripts === undefined ? [] : Object.keys(pkg.scripts);

  if (!scripts.length) return [];

  const pm = ls.has("bun.lock") || ls.has("bun.lockb") ? "bun"
    : ls.has("pnpm-lock.yaml") ? "pnpm"
    : ls.has("yarn.lock") ? "yarn"
    : ls.has("package-lock.json") ? "npm"
    : (/^(bun|pnpm|yarn|npm)@/.exec(pkg?.packageManager ?? "")?.[1] ?? "npm");

  // npm's own lifecycle hooks of another script (prebuild for build) run by themselves.
  const hook = (n: string) => /^(pre|post)/.test(n) && scripts.includes(n.replace(/^(pre|post)/, ""));

  return scripts.flatMap((n) => (hook(n) ? [] : [{
    runner: pm, group: "package.json", name: n, cmd: `${pm} run ${q(n)}`, hint: (lines.get(n) ?? "").slice(0, 120),
  }]));
}

/** A just recipe: its name and its parameters as written. */
export interface Recipe {
  readonly name: string;
  readonly params: string;
}

/** just recipes: `name params:` at the start of a line; `_name` and [private] stay out. */
export function justRecipes(text: string): Recipe[] {
  const out: Recipe[] = [];
  let privateNext = false;

  for (const line of text.split("\n")) {
    if (/^\[[^\]]*\bprivate\b[^\]]*\]/.test(line)) { privateNext = true; continue; }

    if (line.startsWith("[")) continue;

    const m = /^@?([A-Za-z_][\w-]*)((?:\s+[^:]*?)?)\s*:(?!=)/.exec(line);
    const name = m?.[1];

    if (name !== undefined && !/^(alias|set|export|import|mod)$/.test(name)) {
      if (!privateNext && !name.startsWith("_")) out.push({ name, params: (m?.[2] ?? "").trim() });
    }

    if (line.trim() && !line.startsWith("#") && !/^\s/.test(line)) privateNext = false;
  }

  return out;
}

/** make targets: `name:` (not `name :=`), without special, pattern or variable targets. */
export function makeTargets(text: string): string[] {
  const out = new Set<string>();

  for (const line of text.split("\n")) {
    const m = /^([A-Za-z0-9][\w./-]*(?:\s+[A-Za-z0-9][\w./-]*)*)\s*:(?![:=])/.exec(line);

    if (m?.[1] === undefined) continue;

    for (const t of m[1].split(/\s+/)) if (!t.includes("%") && !t.startsWith(".")) out.add(t);
  }

  return [...out];
}

/** Taskfile tasks: the keys one level under the top-level `tasks:`. */
export function taskfileTasks(text: string): string[] {
  const out: string[] = [];
  let inTasks = false, indent: number | null = null;

  for (const line of text.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    if (/^\S/.test(line)) { inTasks = /^tasks\s*:/.test(line); indent = null; continue; }

    if (!inTasks) continue;

    const lead = line.length - line.trimStart().length;

    indent ??= lead;

    const m = lead === indent ? /^\s*("[^"]+"|'[^']+'|[\w:.-]+)\s*:/.exec(line) : null;

    if (m?.[1] !== undefined) out.push(unquote(m[1]));
  }

  return out;
}

/** mise tasks: [tasks.name] tables and keys of a [tasks] table. */
export function miseTasks(text: string): string[] {
  const t = tomlTables(text);
  const names = new Set(t.tables.get("tasks")?.keys() ?? []);

  for (const k of t.tables.keys()) if (k.startsWith("tasks.")) names.add(k.slice(6));

  return [...names];
}

function cargo(files: ReadonlyMap<Manifest, string>, probe: Probe): Unnamed[] {
  const text = files.get("Cargo.toml");

  if (text === undefined) return [];

  const t = tomlTables(text);
  const g = "Cargo.toml", r = "cargo";
  const out: Unnamed[] = [];

  if (t.tables.has("package") || t.tables.has("workspace")) {
    for (const c of ["build", "run", "test", "clippy"]) out.push({ runner: r, group: g, name: c, cmd: `cargo ${c}` });
  }

  for (const b of t.arrays.get("bin") ?? []) {
    const n = unquote(b.get("name"));

    if (n) out.push({ runner: r, group: g, name: `run ${n}`, cmd: `cargo run --bin ${q(n)}` });
  }

  const examples = new Set((t.arrays.get("example") ?? []).flatMap((e) => {
    const n = unquote(e.get("name"));

    return n ? [n] : [];
  }));

  for (const f of probe.examples) {
    const m = /^([\w-]+)(\.rs)?$/.exec(f);

    if (m?.[1] !== undefined && (m[2] !== undefined || !f.includes("."))) examples.add(m[1]);
  }

  for (const n of examples) out.push({ runner: r, group: g, name: `example ${n}`, cmd: `cargo run --example ${q(n)}` });

  return out;
}

function python(files: ReadonlyMap<Manifest, string>, ls: ReadonlySet<string>): Unnamed[] {
  const text = files.get("pyproject.toml");

  if (text === undefined) return [];

  const t = tomlTables(text);
  const out: Unnamed[] = [];

  const add = (table: string, runner: string) => {
    for (const [n, v] of t.tables.get(table) ?? []) out.push({ runner, group: "pyproject.toml", name: n, cmd: `${runner} run ${q(n)}`, hint: unquote(v).slice(0, 120) });
  };

  const poetry = ls.has("poetry.lock") || t.tables.has("tool.poetry");
  const pdm = ls.has("pdm.lock") || t.tables.has("tool.pdm");

  add("project.scripts", ls.has("uv.lock") || !(poetry || pdm) ? "uv" : poetry ? "poetry" : "pdm");
  add("tool.poetry.scripts", "poetry");
  add("tool.pdm.scripts", "pdm");

  const seen = new Set<string>();

  return out.filter((s) => !seen.has(s.cmd) && seen.add(s.cmd));
}

/** deno.json's and composer.json's field read here. */
const isTasks = object({}, { tasks: isRecord });

const isComposer = object({}, { scripts: isRecord });

/** deno tasks: each by name, its line as the hint when it's a plain string. */
function deno(group: Manifest, tasks: JsonRecord): Unnamed[] {
  const lines = fields(tasks, isString);

  return Object.keys(tasks).map((n) => {
    const task = { runner: "deno", group, name: n, cmd: `deno task ${q(n)}` };
    const line = lines.get(n);

    return line === undefined ? task : { ...task, hint: line.slice(0, 120) };
  });
}

/** Every script the probe found, in group order. */
export function detect(probe: Probe): Script[] {
  const { files, ls } = probe;
  const out: Unnamed[] = [];
  const push = (list: readonly Unnamed[]) => out.push(...list);

  push(packageScripts(files, ls));

  const jf = first(files, ["justfile", "Justfile", ".justfile"]);

  if (jf !== undefined) {
    push(justRecipes(files.get(jf) ?? "").map((r) => {
      const recipe = { runner: "just", group: "justfile", name: r.name, cmd: `just ${q(r.name)}` };

      return r.params ? { ...recipe, hint: r.params } : recipe;
    }));
  }

  const mf = first(files, ["GNUmakefile", "makefile", "Makefile"]);

  if (mf !== undefined) push(makeTargets(files.get(mf) ?? "").map((n) => ({ runner: "make", group: "Makefile", name: n, cmd: `make ${q(n)}` })));

  push(cargo(files, probe));

  const df = first(files, ["deno.json", "deno.jsonc"]);
  const tasks = df === undefined ? null : looseJson(files.get(df) ?? "", isTasks)?.tasks;

  if (df !== undefined && tasks !== undefined && tasks !== null) push(deno(df, tasks));

  push(python(files, ls));

  const tf = first(files, ["Taskfile.yml", "Taskfile.yaml", "taskfile.yml", "taskfile.yaml"]);

  if (tf !== undefined) push(taskfileTasks(files.get(tf) ?? "").map((n) => ({ runner: "task", group: tf, name: n, cmd: `task ${q(n)}` })));

  const mi = first(files, ["mise.toml", ".mise.toml"]);

  if (mi !== undefined) push(miseTasks(files.get(mi) ?? "").map((n) => ({ runner: "mise", group: mi, name: n, cmd: `mise run ${q(n)}` })));

  const composer = looseJson(files.get("composer.json") ?? "", isComposer)?.scripts;

  if (composer !== undefined) {
    push(Object.keys(composer).flatMap((n) => (/^(pre|post)-/.test(n) ? [] : [{ runner: "composer", group: "composer.json", name: n, cmd: `composer run-script ${q(n)}` }])));
  }

  if (files.has("go.mod")) {
    push([["run", "go run ."], ["test", "go test ./..."], ["build", "go build ./..."]].map(([n = "", c = ""]) => ({ runner: "go", group: "go.mod", name: n, cmd: c })));
    push(probe.cmd.flatMap((d) => {
      const n = d.replace(/^cmd\//, "");

      return n ? [{ runner: "go", group: "go.mod", name: `run ${n}`, cmd: `go run ./cmd/${q(n)}` }] : [];
    }));
  }

  if (ls.has("flake.nix")) push(nixStatic());

  for (const f of probe.exec) {
    const path = f.replace(/^\.\//, "");
    const dir = path.split("/")[0] ?? "";

    push([{ runner: "file", group: `${dir}/`, name: path.slice(dir.length + 1), cmd: `./${q(path)}` }]);
  }

  // A recipe written once per platform ([unix] / [windows]) is one script.
  const seen = new Set<string>();

  return out.flatMap((s) => {
    const id = scriptId(s.group, s.name);

    if (seen.has(id)) return [];

    seen.add(id);

    return [{ ...s, id }];
  });
}

/** How well a query matches: its score, and the matched positions. */
export interface Match {
  readonly score: number;
  readonly hits: readonly number[];
}

/** Fuzzy score of `qs` in `text` (the palette's), with the matched positions; null: no match. */
export function fuzzy(qs: string, text: string): Match | null {
  const t = text.toLowerCase(), s = qs.toLowerCase();
  let score = 0, at = 0, streak = 0;
  const hits: number[] = [];

  for (const ch of s) {
    const i = t.indexOf(ch, at);

    if (i < 0) return null;

    const start = i === 0 || /[\s:/._-]/.test(t[i - 1] ?? "");

    streak = i === at && hits.length ? streak + 1 : 0;
    score += 1 + (start ? 6 : 0) + streak * 3 - Math.min(i - at, 6) * 0.3;
    hits.push(i);
    at = i + 1;
  }

  return { score: score - text.length * 0.02, hits };
}

/** A row of the picker: the script, its group's head (or "recent"; none while
 *  filtering), the matched letters of its name. */
export interface Row {
  readonly s: Script;
  readonly head: string | null;
  readonly hits: readonly number[];
}

/** What the picker lists: with no query, recents (up to 5) then every group in
 *  order; with one, the best matches first (name over runner and command), recents
 *  breaking ties. `runner` narrows to one runner. */
export function rank(scripts: readonly Script[], query: string, recent: readonly string[] = [], runner: string | null = null): Row[] {
  const pool = runner !== null ? scripts.filter((s) => s.runner === runner) : scripts;
  const qs = query.trim();

  if (!qs) {
    const rec = recent.flatMap((id) => {
      const s = pool.find((x) => x.id === id);

      return s === undefined ? [] : [s];
    }).slice(0, 5);

    const ids = new Set(rec.map((s) => s.id));

    return [...rec.map((s) => ({ s, head: "recent", hits: [] })), ...pool.flatMap((s) => (ids.has(s.id) ? [] : [{ s, head: s.group, hits: [] }]))];
  }

  const order = (s: Script) => {
    const i = recent.indexOf(s.id);

    return i < 0 ? 99 : i;
  };

  return pool.flatMap((s) => {
    const name = fuzzy(qs, s.name);
    const more = fuzzy(qs, `${s.runner} ${s.group} ${s.name} ${s.cmd}`);
    const best = name ?? (more && { score: more.score - 4, hits: [] });

    return best ? [{ s, head: null, score: best.score, hits: best.hits }] : [];
  }).sort((a, b) => b.score - a.score || order(a.s) - order(b.s)).map(({ s, head, hits }) => ({ s, head, hits }));
}
