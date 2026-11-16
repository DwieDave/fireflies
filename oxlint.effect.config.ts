// The Effect lint (`just lint`'s second pass): Effect's language-service
// diagnostics as Oxlint type-aware rules (@effect/tsgo's `effecttsgo`
// plugin, run by `effect-tsgo oxlint --type-aware`, which loads its patched
// Oxlint binding without touching node_modules), and anti-slop's Effect
// rules (tools/oxlint/anti-slop/effect). Developer's words: "enable all
// Effect lsp/tsgo diagnostics preferably through oxlint, enable the effect
// rules from dillonmulroy antislop".
//
// Scope: the files written on Effect: the kit (defaults/lib) and each mod
// converted to it (the list is in the justfile, `effect_sources`). The first
// pass (oxlint.config.ts) still covers them too. A mod joins the list in the
// commit that converts it. What these rules would say of the mods not yet
// converted: `bun scripts/effect-survey.ts` (docs/effect-mods.md has its
// table).
//
// Every rule @effect/tsgo has is on, as an error, but these, each for its reason:
import { readFileSync } from "node:fs";
import { defineConfig } from "oxlint";

/**
 * Every rule @effect/tsgo has (its oxlint-schema.json, read here so an
 * update brings its new rules in on), an error each.
 */
const ALL = [...new Set(readFileSync(new URL("./node_modules/@effect/tsgo/oxlint-schema.json", import.meta.url), "utf8").match(/effecttsgo\/[a-z0-9-]+/g) ?? [])];

const OFF = {
  // Asks every exported function for a data-last (pipeable) overload: Effect's
  // own convention for its library. A mod's functions (`due(rec, why, now,
  // every)`, `sharedKey(name, schema)`) aren't piped; an overload nobody calls
  // is code to keep for nothing.
  "missing-pipeable-signature": "off",
  // Contradicts prefer-barrel-import, which stays: the app serves `effect` and
  // `effect/http` (the barrels), not `effect/Effect` and the like.
  "prefer-namespace-import": "off",
} as const;

const rules = Object.fromEntries(ALL.map((rule) => [rule, rule.slice("effecttsgo/".length) in OFF ? "off" : "error"]));

export default defineConfig({
  options: { typeAware: true },
  plugins: ["effecttsgo"],
  jsPlugins: [{ name: "anti-slop-effect", specifier: "./tools/oxlint/anti-slop/effect/index.ts" }],
  // defaults/lib/effect is Effect itself, bundled (scripts/effect-bundle.ts): not ours to lint.
  ignorePatterns: ["tools/oxlint/anti-slop/**", "**/gpui-kit.d.ts", "**/*.d.ts", "defaults/lib/effect/**"],
  rules: {
    ...rules,
    "anti-slop-effect/no-manual-effect-error-tag": "error",
    "anti-slop-effect/no-manual-tag-comparison": "error",
    "anti-slop-effect/no-manual-tagged-construction": "error",
    "anti-slop-effect/no-service-constructor-imports": "error",
    "anti-slop-effect/prefer-effect-match": "error",
  },
  overrides: [
    {
      // Effect marks all of `effect/http` unstable (4.1). Developer asked for
      // its HTTP client; the version is pinned, and these files are where a
      // breaking change would land: the kit's transports and test server, and
      // a mod's own endpoint code. Anywhere else, an unstable API is an error.
      files: ["defaults/lib/@fireflies/kit/http.ts", "defaults/lib/@fireflies/kit/live.ts", "defaults/lib/@fireflies/kit/testing.ts", "defaults/lib/@fireflies/kit/index.ts", "defaults/mods/*/limits.ts", "defaults/mods/*/fx.ts"],
      rules: { "effecttsgo/unstable-api-usage": "off", "effecttsgo/api-stability-leak": "off" },
    },
    {
      // A service's key is derived from its file's path. A mod's file is often
      // a byte-for-byte copy in several mods (limits.ts is in usage and
      // nocturne), and one text can't hold two paths. The kit's keys follow it.
      files: ["defaults/mods/**"],
      rules: { "effecttsgo/deterministic-keys": "off" },
    },
  ],
});
