# anti-slop, vendored

Source: https://github.com/dmmulroy/anti-slop, commit
13909c9e07590f5a85d93c62712259fe14a883f7 (2026-10-13), `src/` copied by hand
as its README's "Manual local installation" says. MIT, Dillon Mulroy
(LICENSE here); `vendor/eslint-stylistic` keeps its own MIT LICENSE and
provenance.

Left out: the rule tests (`*.test.ts`, they need the upstream test runner)
and `effect/` (the Effect rules: the mods don't use Effect).

Local changes: none. These files are ours now: change a rule here when the
mods' standard changes, and note it below.

Registered in `oxlint.config.ts` as `anti-slop`, run by `just lint` on the
mods' TypeScript (docs/mods-typescript.md).
