// A shipped mod file's source as JavaScript, for the tests that read a mod's
// text and evaluate it with stand-ins for its imports (`load()` in
// scripts/preview.test.ts and the like): a `.ts` file's types go first, as
// the app's loader strips them (Bun keeps the imports and exports those
// loaders rewrite).
const ts = new Bun.Transpiler({ loader: "ts", trimUnusedImports: false });

/** `source` (the text of the mod file at `path`) as JavaScript. */
export const asJs = (path: string, source: string): string => (path.endsWith(".ts") ? ts.transformSync(source) : source);

/** guard.ts's exports (it imports nothing at run time), for the scope of a
 *  loader that drops a mod file's imports: what `from "./guard.ts"` brings. */
export const guard = await import("../defaults/mods/pip/guard.ts");

import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

/** A module's stand-in: what `import … from "<specifier>"` gives. */
type Standin = Record<string, unknown>;

let copies = 0;

/** The mod's .ts / .js files, by path under its folder. */
function modFiles(dir: string, under = ""): string[] {
  return readdirSync(join(dir, under)).flatMap((name) => {
    const rel = under ? `${under}/${name}` : name;
    if (statSync(join(dir, rel)).isDirectory()) return modFiles(dir, rel);
    return /\.(ts|js)$/.test(name) && !name.endsWith(".d.ts") ? [rel] : [];
  });
}

/** The local names an import clause brings (`{ a, b as c }`, `* as ns`, `D`). */
function importedNames(clause: string): string[] {
  const braces = clause.match(/\{([^}]*)\}/)?.[1] ?? "";
  const named = braces.split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("type ")).map((s) => s.split(/\s+as\s+/)[0]!.trim());
  return named;
}

/**
 * Imports `defaults/mods/<entry>` for real: the mod's own modules as the app
 * loads them (cycles, live bindings, a file split into several), with
 * `standins[specifier]` for each bare import ("herdr", "gpui-kit", …) and
 * `replace["./file.ts"]` for a module of the mod's to leave out (a nested
 * view, say). Each call loads a fresh copy (in a temp folder), so tests that
 * set up different stand-ins don't share a module. Unlike `load()`-style
 * loaders it needs no list of what each file imports.
 */
export async function importMod(entry: string, standins: Record<string, Standin>, replace: Record<string, Standin> = {}): Promise<any> {
  const [mod, ...rest] = entry.split("/");
  const src = new URL(`../defaults/mods/${mod}/`, import.meta.url).pathname;
  const id = `copy${copies++}`;
  const dir = mkdtempSync(join(tmpdir(), `mod-${mod}-`));
  const registry = ((globalThis as any).__modStandins ??= {});
  registry[id] = { ...standins, ...replace };
  const wanted = new Map<string, Set<string>>();
  const fileName = (spec: string) => `__standins/${spec.replace(/[^A-Za-z0-9]/g, "_")}.ts`;

  for (const file of modFiles(src)) {
    const text = readFileSync(join(src, file), "utf8").replace(
      /(import\s+(type\s+)?([\s\S]*?)\s+from\s+)"([^"]+)"/g,
      (whole, head: string, isType: string | undefined, clause: string, spec: string) => {
        const stood = spec.startsWith(".") ? (spec in replace ? spec : null) : spec;
        if (!stood || isType) return whole;
        const names = wanted.get(stood) ?? new Set<string>();
        for (const n of importedNames(clause)) names.add(n);
        wanted.set(stood, names);
        const to = relative(dirname(join(dir, file)), join(dir, fileName(stood)));
        return `${head}"${to.startsWith(".") ? to : `./${to}`}"`;
      },
    );
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }

  mkdirSync(join(dir, "__standins"), { recursive: true });
  for (const [spec, names] of wanted) {
    const given = registry[id][spec] ?? {};
    const all = new Set([...names, ...Object.keys(given)].filter((n) => n !== "default" && /^[A-Za-z_$][\w$]*$/.test(n)));
    const lines = [`const s = (globalThis as any).__modStandins[${JSON.stringify(id)}][${JSON.stringify(spec)}] ?? {};`];
    for (const n of all) lines.push(`export const ${n} = s[${JSON.stringify(n)}];`);
    lines.push("export default s.default;");
    writeFileSync(join(dir, fileName(spec)), lines.join("\n") + "\n");
  }

  return import(join(dir, ...rest));
}
