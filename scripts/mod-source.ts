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

/** layout-look.ts as the loaders below see it: the look is Nocturne's (its
 *  own tests import it for real, with a layout). */
const nocturneLook = { flat: () => null, dithered: () => true, square: () => true, radius: () => 0 };

/** @fireflies/tones' exports (it imports only effect at run time), for the same
 *  loaders, under the names a mod file may import them as (`edge as edgeTone`),
 *  with layout-look.ts's (Nocturne's look). */
const tonesTs = await import("@fireflies/tones");
export const tones = { ...tonesTs, edgeTone: tonesTs.edge, ...nocturneLook };

/** The part of @fireflies/tones and layout-look.ts a mod file's source imports
 *  (`edge`, `edge as edgeTone`, `tone`, `flat`), so a loader's scope doesn't
 *  clash with names the file declares. */
export function tonesFor(source: string): Record<string, unknown> {
  const all: Record<string, unknown> = tones;
  const clauses = [...source.matchAll(/import \{([^}]*)\} from "(?:@fireflies\/tones|@fireflies\/layout-look|\.\/layout-look\.ts)";/g)].map((m) => m[1] ?? "");
  return Object.fromEntries(clauses.join(",").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [name, as] = s.split(/\s+as\s+/);
    return [as ?? name!, all[name!]];
  }));
}

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
 *
 * The mods' libraries (`effect`, `effect/http`, `@fireflies/kit`: what the
 * app serves every mod by name, docs/effect-mods.md) load for real from the
 * repo's node_modules, unless `standins` names one. The other `@fireflies/…`
 * libraries (keyhelp, tones, …: the files the mods once carried as copies)
 * import the app's modules ("gpui-kit", "herdr") as a mod's files do, so each
 * call copies them too, its stand-ins put in for those imports.
 */
/** A library the app serves every mod by name (defaults/lib). */
const isLibrary = (spec: string) => spec === "effect" || spec.startsWith("effect/") || spec.startsWith("@fireflies/");

/** A library loaded as it is (it imports none of the app's modules at run time, or a test mocks them). */
const isShared = (spec: string) => spec === "effect" || spec.startsWith("effect/") || spec === "@fireflies/kit" || spec.startsWith("@fireflies/kit/");

const repo = new URL("..", import.meta.url).pathname;
const LIB = new URL("../defaults/lib/", import.meta.url).pathname;

/** A library's name and the file its entry names: "@fireflies/tones" -> ["@fireflies/tones", "index.ts"]. */
function libraryEntry(spec: string): [string, string] {
  const [scope = "", name = "", ...sub] = spec.split("/");
  const lib = `${scope}/${name}`;
  const exports: Record<string, string> = JSON.parse(readFileSync(join(LIB, lib, "package.json"), "utf8")).exports;
  const file = exports[sub.length ? `./${sub.join("/")}` : "."];
  if (!file) throw new Error(`importMod: ${lib} exports no ${spec}`);
  return [lib, file.replace(/^\.\//, "")];
}

export async function importMod(entry: string, standins: Record<string, Standin>, replace: Record<string, Standin> = {}): Promise<any> {
  const [mod, ...rest] = entry.split("/");
  const src = new URL(`../defaults/mods/${mod}/`, import.meta.url).pathname;
  const copy = copier(`mod-${mod}-`, standins, replace);
  for (const file of modFiles(src)) copy.write(join(src, file), join(copy.dir, file));
  copy.standins();
  return import(join(copy.dir, ...rest));
}

/**
 * Imports a library of defaults/lib (`@fireflies/layout-look`) as importMod
 * does a mod's file: its imports of the app's modules get `standins`, a
 * fresh copy each call.
 */
export async function importLibrary(spec: string, standins: Record<string, Standin>): Promise<any> {
  const copy = copier("lib-", standins, {});
  const at = copy.library(spec);
  copy.standins();
  return import(at);
}

/** A temp folder that mod and library files are copied into, their imports rewritten (importMod). */
function copier(prefix: string, standins: Record<string, Standin>, replace: Record<string, Standin>) {
  const id = `copy${copies++}`;
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const registry = ((globalThis as any).__modStandins ??= {});
  registry[id] = { ...standins, ...replace };
  const wanted = new Map<string, Set<string>>();
  const fileName = (spec: string) => `__standins/${spec.replace(/[^A-Za-z0-9]/g, "_")}.ts`;
  const libs = new Set<string>();
  const relTo = (from: string, to: string) => {
    const r = relative(dirname(from), to);
    return r.startsWith(".") ? r : `./${r}`;
  };

  /** A file's text with its imports pointed at the stand-ins, the copied libraries and node_modules. */
  const rewrite = (text: string, at: string): string => text.replace(
    /(import\s+(type\s+)?([\s\S]*?)\s+from\s+)"([^"]+)"/g,
    (whole, head: string, isType: string | undefined, clause: string, spec: string) => {
      if (isLibrary(spec) && !(spec in standins)) {
        if (isShared(spec)) return `${head}"${Bun.resolveSync(spec, repo)}"`;
        if (isType) return whole;
        return `${head}"${relTo(at, library(spec))}"`;
      }
      const stood = spec.startsWith(".") ? (spec in replace ? spec : null) : spec;
      if (!stood || isType) return whole;
      const names = wanted.get(stood) ?? new Set<string>();
      for (const n of importedNames(clause)) names.add(n);
      wanted.set(stood, names);
      return `${head}"${relTo(at, join(dir, fileName(stood)))}"`;
    },
  );

  const write = (from: string, to: string) => {
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, rewrite(readFileSync(from, "utf8"), to));
  };

  /** Copies a library under __lib/ (once), its imports rewritten as a mod file's: the path of `spec`'s entry. */
  function library(spec: string): string {
    const [lib, file] = libraryEntry(spec);
    if (!libs.has(lib)) {
      libs.add(lib);
      for (const f of modFiles(join(LIB, lib))) write(join(LIB, lib, f), join(dir, "__lib", lib, f));
    }
    return join(dir, "__lib", lib, file);
  }

  /** Writes a module per stand-in the copied files import. */
  function writeStandins(): void {
    mkdirSync(join(dir, "__standins"), { recursive: true });
    for (const [spec, names] of wanted) {
      const given = registry[id][spec] ?? {};
      const all = new Set([...names, ...Object.keys(given)].filter((n) => n !== "default" && /^[A-Za-z_$][\w$]*$/.test(n)));
      const lines = [`const s = (globalThis as any).__modStandins[${JSON.stringify(id)}][${JSON.stringify(spec)}] ?? {};`];
      for (const n of all) lines.push(`export const ${n} = s[${JSON.stringify(n)}];`);
      lines.push("export default s.default;");
      writeFileSync(join(dir, fileName(spec)), lines.join("\n") + "\n");
    }
  }

  return { dir, write, library, standins: writeStandins };
}

/**
 * @fireflies/keyhelp loaded with the stand-ins of a `load()`-style loader's
 * scope (its div, h_flex, settings, window), when `source` (a mod file's
 * text) imports it; else nothing. The look is Nocturne's (dithered, square).
 */
export async function keyhelpFor(source: string, scope: Record<string, any>): Promise<Record<string, unknown>> {
  return source.includes('from "@fireflies/keyhelp"') ? keyhelpWith(scope) : {};
}

/** @fireflies/keyhelp loaded with a loader scope's stand-ins (keyhelpFor). */
export async function keyhelpWith(scope: Record<string, any>): Promise<Record<string, unknown>> {
  // keyhelp paints its dither with the engine's global `window`.
  (globalThis as any).window ??= typeof scope.window?.paint_path === "function" ? scope.window : { paint_path: scope.div };
  return importLibrary("@fireflies/keyhelp", {
    "gpui-kit": { div: scope.div, PathBuilder: scope.PathBuilder, Background: scope.Background },
    "gpui-base": { h_flex: scope.h_flex, v_flex: scope.v_flex },
    herdr: { settings: scope.settings ?? (() => ({ zoom: 1 })), window: scope.appWindow ?? (() => ({ platform: "macos" })) },
    "@fireflies/layout-look": nocturneLook,
  });
}
