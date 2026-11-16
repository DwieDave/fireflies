# anti-slop, vendored

Source: https://github.com/dmmulroy/anti-slop, commit
13909c9e07590f5a85d93c62712259fe14a883f7 (2026-10-13), `src/` copied by hand
as its README's "Manual local installation" says. MIT, Dillon Mulroy
(LICENSE here); `vendor/eslint-stylistic` keeps its own MIT LICENSE and
provenance.

Left out: the rule tests (`*.test.ts`, they need the upstream test runner).

`effect/` (the Effect rules: no-manual-effect-error-tag,
no-manual-tag-comparison, no-manual-tagged-construction,
no-service-constructor-imports, prefer-effect-match) came in on 2026-11-16
from the same commit (still upstream's head that day), for the mods' move to
Effect (docs/effect-mods.md). Registered in `oxlint.effect.config.ts` as
`anti-slop-effect`, on the files written on Effect (the justfile's
`effect_sources`).

Local changes: none. These files are ours now: change a rule here when the
mods' standard changes, and note it below.

Registered in `oxlint.config.ts` as `anti-slop`, run by `just lint` on the
mods' TypeScript (docs/mods-typescript.md) and the mods' kit (defaults/lib).
