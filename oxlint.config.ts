// The lint of the mods' TypeScript (`just lint`): Developer's standard is
// maximum type safety, not a quiet compiler (docs/mods-typescript.md).
// Oxlint's own TypeScript rules that back it, and anti-slop
// (tools/oxlint/anti-slop, vendored) for the patterns it rejects.
//
// Scope: the converted mods' .ts files (`just lint` names them:
// defaults/mods/**/*.ts and defaults/frame/**/*.ts). The .js mods come in with their migration;
// scripts/ (bun tests, which stand in for "herdr" with mock.module, which
// anti-slop's no-module-mocking rejects) stays out.
import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: [
    ".agent/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".cursor/**",
    "tools/oxlint/anti-slop/**",
    "**/gpui-kit.d.ts",
    // Bun scripts that draw win98's pictures, not mod code.
    "defaults/mods/win98/art/**",
    // The JavaScript mods and shared .js copies: each comes in with its migration.
    "defaults/**/*.js",
  ],
  jsPlugins: [{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" }],
  categories: { correctness: "error" },
  rules: {
    // No escape hatches: no any, no comments that silence the checker, no
    // assertion that something is there, types imported as types.
    "typescript/no-explicit-any": "error",
    "typescript/ban-ts-comment": ["error", { "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true, "ts-check": false }],
    "typescript/consistent-type-imports": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/no-non-null-asserted-optional-chain": "error",
    "typescript/no-unsafe-function-type": "error",
    "typescript/no-empty-object-type": "error",
    "typescript/no-wrapper-object-types": "error",
    "typescript/no-unsafe-declaration-merging": "error",
    "typescript/no-namespace": "error",
    "typescript/no-require-imports": "error",
    "typescript/prefer-as-const": "error",
    "oxc/no-accumulating-spread": "error",

    // anti-slop's generic rules, all of them.
    "anti-slop/no-array-filter-map": "error",
    "anti-slop/no-reduce-accumulator-copy": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    // Mods parse with hand-written type guards (guard.ts), so typeof belongs
    // inside guards and nowhere else.
    "anti-slop/no-runtime-typeof": ["error", { allowInTypeGuards: true }],
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
  },
});
