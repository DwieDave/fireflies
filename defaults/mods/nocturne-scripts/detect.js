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
//
// A script: { id, runner, group, name, cmd, hint? }. `cmd` is one shell line
// for `hc run`; `id` stays the same between looks (recents go by it).

/** Manifests the probe reads, at most 256 KiB each. */
export const MANIFESTS = [
  "package.json", "justfile", "Justfile", ".justfile", "Makefile", "makefile", "GNUmakefile",
  "Cargo.toml", "deno.json", "deno.jsonc", "pyproject.toml", "Taskfile.yml", "Taskfile.yaml",
  "taskfile.yml", "taskfile.yaml", "mise.toml", ".mise.toml", "composer.json", "go.mod",
];

/** The probe: a POSIX sh script run in the folder. Its output is sections,
 *  each opened by a line "\u001e<name>" (a record separator). */
export const PROBE = [
  `printf '\\036ls\\n'; ls -1A 2>/dev/null`,
  `printf '\\036exec\\n'; for d in scripts bin; do [ -d "$d" ] && find "$d" -maxdepth 1 \\( -type f -o -type l \\) -perm -u+x 2>/dev/null; done`,
  `printf '\\036examples\\n'; [ -d examples ] && ls -1 examples 2>/dev/null`,
  `printf '\\036cmd\\n'; [ -d cmd ] && for d in cmd/*/; do [ -d "$d" ] && echo "$d"; done`,
  `for f in ${MANIFESTS.join(" ")}; do [ -f "$f" ] && { printf '\\036file %s\\n' "$f"; head -c 262144 "$f"; echo; }; done`,
  "true",
].join("; ");

/** Splits the probe's output into { ls: Set, exec: [], examples: [], cmd: [], files: { name: text } }. */
export function parseProbe(out) {
  const res = { ls: new Set(), exec: [], examples: [], cmd: [], files: {} };
  for (const part of String(out ?? "").split("\u001e").slice(1)) {
    const nl = part.indexOf("\n");
    const head = nl < 0 ? part : part.slice(0, nl);
    const body = nl < 0 ? "" : part.slice(nl + 1);
    const lines = () => body.split("\n").map((l) => l.trim()).filter(Boolean);
    if (head === "ls") res.ls = new Set(lines());
    else if (head === "exec") res.exec = lines();
    else if (head === "examples") res.examples = lines();
    else if (head === "cmd") res.cmd = lines().map((l) => l.replace(/\/+$/, ""));
    else if (head.startsWith("file ")) res.files[head.slice(5)] = body;
  }
  return res;
}

const q = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);
const first = (files, names) => names.find((n) => files[n] != null);

/** JSON with // and /* comments and trailing commas (deno.jsonc), or null. */
export function looseJson(text) {
  try { return JSON.parse(text); } catch { /* try without comments */ }
  try {
    const bare = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s ?? "").replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(bare);
  } catch { return null; }
}

/** A little TOML: { "table.name": { key: rawValue } } and arrays of tables as
 *  { "[[bin]]": [{ name }] }. Enough for names and keys, not values. */
export function tomlTables(text) {
  const tables = { "": {} };
  let cur = tables[""];
  for (const raw of String(text).split("\n")) {
    const line = raw.replace(/^\s+/, "");
    if (!line || line.startsWith("#")) continue;
    let m = /^\[\[\s*([^\]]+?)\s*\]\]/.exec(line);
    if (m) { const k = `[[${m[1]}]]`; (tables[k] ??= []).push(cur = {}); continue; }
    m = /^\[\s*([^\]]+?)\s*\]/.exec(line);
    if (m) { const k = m[1].replace(/\s*\.\s*/g, ".").replace(/"/g, ""); cur = tables[k] ??= {}; continue; }
    m = /^("(?:[^"\\]|\\.)*"|'[^']*'|[\w.-]+)\s*=\s*(.*)$/.exec(line);
    if (m) cur[m[1].replace(/^["']|["']$/g, "")] = m[2].trim();
  }
  return tables;
}

const unquote = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");

function packageScripts(p, files, ls) {
  const pkg = looseJson(files["package.json"] ?? "");
  const scripts = pkg?.scripts && typeof pkg.scripts === "object" ? Object.keys(pkg.scripts) : [];
  if (!scripts.length) return [];
  const pm = ls.has("bun.lock") || ls.has("bun.lockb") ? "bun"
    : ls.has("pnpm-lock.yaml") ? "pnpm"
    : ls.has("yarn.lock") ? "yarn"
    : ls.has("package-lock.json") ? "npm"
    : (/^(bun|pnpm|yarn|npm)@/.exec(pkg.packageManager ?? "")?.[1] ?? "npm");
  // npm's own lifecycle hooks of another script (prebuild for build) run by themselves.
  const hook = (n) => /^(pre|post)/.test(n) && scripts.includes(n.replace(/^(pre|post)/, ""));
  return scripts.filter((n) => !hook(n)).map((n) => ({
    runner: pm, group: "package.json", name: n, cmd: `${pm} run ${q(n)}`, hint: String(pkg.scripts[n]).slice(0, 120),
  }));
}

/** just recipes: `name params:` at the start of a line; `_name` and [private] stay out. */
export function justRecipes(text) {
  const out = [];
  let privateNext = false;
  for (const line of String(text).split("\n")) {
    if (/^\[[^\]]*\bprivate\b[^\]]*\]/.test(line)) { privateNext = true; continue; }
    if (/^\[/.test(line)) continue;
    const m = /^@?([A-Za-z_][\w-]*)((?:\s+[^:]*?)?)\s*:(?!=)/.exec(line);
    if (m && !/^(alias|set|export|import|mod)$/.test(m[1])) {
      if (!privateNext && !m[1].startsWith("_")) out.push({ name: m[1], params: m[2].trim() });
    }
    if (line.trim() && !line.startsWith("#") && !/^\s/.test(line)) privateNext = false;
  }
  return out;
}

/** make targets: `name:` (not `name :=`), without special, pattern or variable targets. */
export function makeTargets(text) {
  const out = new Set();
  for (const line of String(text).split("\n")) {
    const m = /^([A-Za-z0-9][\w./-]*(?:\s+[A-Za-z0-9][\w./-]*)*)\s*:(?![:=])/.exec(line);
    if (!m) continue;
    for (const t of m[1].split(/\s+/)) if (!t.includes("%") && !t.startsWith(".")) out.add(t);
  }
  return [...out];
}

/** Taskfile tasks: the keys one level under the top-level `tasks:`. */
export function taskfileTasks(text) {
  const out = [];
  let inTasks = false, indent = null;
  for (const line of String(text).split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^\S/.test(line)) { inTasks = /^tasks\s*:/.test(line); indent = null; continue; }
    if (!inTasks) continue;
    const lead = line.length - line.trimStart().length;
    indent ??= lead;
    const m = lead === indent && /^\s*("[^"]+"|'[^']+'|[\w:.-]+)\s*:/.exec(line);
    if (m) out.push(unquote(m[1]));
  }
  return out;
}

/** mise tasks: [tasks.name] tables and keys of a [tasks] table. */
export function miseTasks(text) {
  const t = tomlTables(text);
  const names = new Set(Object.keys(t.tasks ?? {}));
  for (const k of Object.keys(t)) if (k.startsWith("tasks.")) names.add(k.slice(6));
  return [...names];
}

function cargo(files, probe) {
  const text = files["Cargo.toml"];
  if (text == null) return [];
  const t = tomlTables(text);
  const g = "Cargo.toml", r = "cargo";
  const out = [];
  if (t.package || t.workspace) {
    for (const c of ["build", "run", "test", "clippy"]) out.push({ runner: r, group: g, name: c, cmd: `cargo ${c}` });
  }
  for (const b of t["[[bin]]"] ?? []) {
    const n = unquote(b.name);
    if (n) out.push({ runner: r, group: g, name: `run ${n}`, cmd: `cargo run --bin ${q(n)}` });
  }
  const examples = new Set((t["[[example]]"] ?? []).map((e) => unquote(e.name)).filter(Boolean));
  for (const f of probe.examples) {
    const m = /^([\w-]+)(\.rs)?$/.exec(f);
    if (m && (m[2] || !f.includes("."))) examples.add(m[1]);
  }
  for (const n of examples) out.push({ runner: r, group: g, name: `example ${n}`, cmd: `cargo run --example ${q(n)}` });
  return out;
}

function python(files, ls) {
  const text = files["pyproject.toml"];
  if (text == null) return [];
  const t = tomlTables(text);
  const out = [];
  const add = (table, runner) => {
    for (const n of Object.keys(t[table] ?? {})) out.push({ runner, group: "pyproject.toml", name: n, cmd: `${runner} run ${q(n)}`, hint: unquote(t[table][n]).slice(0, 120) });
  };
  const poetry = ls.has("poetry.lock") || Boolean(t["tool.poetry"]);
  const pdm = ls.has("pdm.lock") || Boolean(t["tool.pdm"]);
  add("project.scripts", ls.has("uv.lock") || !(poetry || pdm) ? "uv" : poetry ? "poetry" : "pdm");
  add("tool.poetry.scripts", "poetry");
  add("tool.pdm.scripts", "pdm");
  const seen = new Set();
  return out.filter((s) => !seen.has(s.cmd) && seen.add(s.cmd));
}

/** Every script the probe found, in group order. */
export function detect(probe) {
  const { files, ls } = probe;
  const out = [];
  const push = (list) => out.push(...list);
  push(packageScripts(probe, files, ls));
  const jf = first(files, ["justfile", "Justfile", ".justfile"]);
  if (jf) push(justRecipes(files[jf]).map((r) => ({ runner: "just", group: "justfile", name: r.name, cmd: `just ${q(r.name)}`, hint: r.params || undefined })));
  const mf = first(files, ["GNUmakefile", "makefile", "Makefile"]);
  if (mf) push(makeTargets(files[mf]).map((n) => ({ runner: "make", group: "Makefile", name: n, cmd: `make ${q(n)}` })));
  push(cargo(files, probe));
  const df = first(files, ["deno.json", "deno.jsonc"]);
  const deno = df ? looseJson(files[df]) : null;
  if (deno?.tasks && typeof deno.tasks === "object") {
    push(Object.keys(deno.tasks).map((n) => ({ runner: "deno", group: df, name: n, cmd: `deno task ${q(n)}`,
      hint: typeof deno.tasks[n] === "string" ? deno.tasks[n].slice(0, 120) : undefined })));
  }
  push(python(files, ls));
  const tf = first(files, ["Taskfile.yml", "Taskfile.yaml", "taskfile.yml", "taskfile.yaml"]);
  if (tf) push(taskfileTasks(files[tf]).map((n) => ({ runner: "task", group: tf, name: n, cmd: `task ${q(n)}` })));
  const mi = first(files, ["mise.toml", ".mise.toml"]);
  if (mi) push(miseTasks(files[mi]).map((n) => ({ runner: "mise", group: mi, name: n, cmd: `mise run ${q(n)}` })));
  const composer = looseJson(files["composer.json"] ?? "");
  if (composer?.scripts && typeof composer.scripts === "object") {
    push(Object.keys(composer.scripts).filter((n) => !/^(pre|post)-/.test(n))
      .map((n) => ({ runner: "composer", group: "composer.json", name: n, cmd: `composer run-script ${q(n)}` })));
  }
  if (files["go.mod"] != null) {
    push([["run", "go run ."], ["test", "go test ./..."], ["build", "go build ./..."]].map(([n, c]) => ({ runner: "go", group: "go.mod", name: n, cmd: c })));
    push(probe.cmd.map((d) => d.replace(/^cmd\//, "")).filter(Boolean)
      .map((n) => ({ runner: "go", group: "go.mod", name: `run ${n}`, cmd: `go run ./cmd/${q(n)}` })));
  }
  for (const f of probe.exec) {
    const path = f.replace(/^\.\//, "");
    const dir = path.split("/")[0];
    push([{ runner: "file", group: `${dir}/`, name: path.slice(dir.length + 1), cmd: `./${q(path)}` }]);
  }
  // A recipe written once per platform ([unix] / [windows]) is one script.
  const seen = new Set();
  return out.map((s) => ({ ...s, id: `${s.group}\u0000${s.name}` })).filter((s) => !seen.has(s.id) && seen.add(s.id));
}

/** Fuzzy score of `q` in `text` (the palette's), with the matched positions; null: no match. */
export function fuzzy(qs, text) {
  const t = text.toLowerCase(), s = qs.toLowerCase();
  let score = 0, at = 0, streak = 0;
  const hits = [];
  for (const ch of s) {
    const i = t.indexOf(ch, at);
    if (i < 0) return null;
    const start = i === 0 || /[\s:/._-]/.test(t[i - 1]);
    streak = i === at && hits.length ? streak + 1 : 0;
    score += 1 + (start ? 6 : 0) + streak * 3 - Math.min(i - at, 6) * 0.3;
    hits.push(i);
    at = i + 1;
  }
  return { score: score - text.length * 0.02, hits };
}

/** What the picker lists: with no query, recents (up to 5) then every group in
 *  order; with one, the best matches first (name over runner and command), recents
 *  breaking ties. Rows: { s, head, hits }. `runner` narrows to one runner. */
export function rank(scripts, query, recent = [], runner = null) {
  const pool = runner ? scripts.filter((s) => s.runner === runner) : scripts;
  const qs = String(query ?? "").trim();
  if (!qs) {
    const rec = recent.map((id) => pool.find((s) => s.id === id)).filter(Boolean).slice(0, 5);
    const ids = new Set(rec.map((s) => s.id));
    return [...rec.map((s) => ({ s, head: "recent", hits: [] })), ...pool.filter((s) => !ids.has(s.id)).map((s) => ({ s, head: s.group, hits: [] }))];
  }
  const order = (s) => { const i = recent.indexOf(s.id); return i < 0 ? 99 : i; };
  return pool.map((s) => {
    const name = fuzzy(qs, s.name);
    const more = fuzzy(qs, `${s.runner} ${s.group} ${s.name} ${s.cmd}`);
    const best = name ?? (more && { score: more.score - 4, hits: [] });
    return best && { s, head: null, score: best.score, hits: best.hits };
  }).filter(Boolean).sort((a, b) => b.score - a.score || order(a.s) - order(b.s));
}
