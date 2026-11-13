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
