# Mods in TypeScript

Fireflies runs a mod's `.ts` files by blanking their types out and running
the rest (`swc_ts_fast_strip` in the loader, `vendor/gpui-kit/crates/shell/src/typescript.rs`).
Nothing is compiled and nothing is checked at run time: the checking is
`tsc` and `oxlint`, before the code ships. This page is the bar a converted
mod meets and the steps to convert one. The shipped mods to convert are
`nocturne` and the ones listed in `scripts/nocturne-mods.ts` (once
`nocturne-<name>`). `pip` and `usage` (with `nocturne/limits.ts`) are
converted: read them as the pattern.

## The standard

Developer's words:

> When converting mods to typescript we aim for maximum typesafety not for a
> happy compiler with bad annotation just to make it happy, meaning:
> absolutely no any, no Record<string,string> stuff that makes the types
> unsound. Use oxlint and configure https://github.com/dmmulroy/anti-slop for
> additional bad pattern detection

What that means in the code:

- **No `any`**, written or implied. Nothing typed `any` leaves a function.
- **No `as` to quiet an error.** An assertion that's really needed has a
  `// SAFETY: why it holds` comment on the line above (the lint asks for it).
  `as const` is fine. The two pattern mods need none.
- **No `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`.** No `!` on a value
  (`noUncheckedIndexedAccess` makes `list[0]` possibly undefined: say what
  happens then, `list[0] ?? fallback`).
- **No open dictionaries where the keys are known**: no `Record<string, X>`,
  `{ [key: string]: X }`, `object`, `Function`. Name the keys (an interface),
  use unions and discriminated unions, a `Map` when the keys are data,
  `readonly` where nothing writes.
- **Data from outside is `unknown` and parsed where it comes in**, with a
  guard that proves it or refuses it (below). Outside means anything this
  build of this mod didn't just create: `props()`, `shared()`, native view
  answers and events, `exec` output, JSON files, `terminals()`.

The bar is enforced, both inside `cargo test` (`tests/mods_typescript.rs`):

```sh
just typecheck   # tsc -p defaults/tsconfig.json: strict, noUncheckedIndexedAccess,
                 # exactOptionalPropertyTypes, noImplicitOverride, noImplicitReturns,
                 # noPropertyAccessFromIndexSignature, erasableSyntaxOnly, verbatimModuleSyntax
just lint        # oxlint + anti-slop (oxlint.config.ts); `just lint --fix` adds blank lines
```

Both cover every `.ts` file under `defaults/`. The `.js` mods are outside
both until their migration (`checkJs` is off; the lint ignores `**/*.js`).
`scripts/` (the bun tests) is outside the lint: they stand in for `herdr`
with `mock.module`, which anti-slop's `no-module-mocking` rejects, and
changing that is a refactoring of the tests, not of the mods. The tools are
the exact versions in `package.json` (`bun install` puts them in
`node_modules/`).

## Converting a mod, step by step

1. `git mv main.js main.ts` (and each module). `main.ts` is an entry like
   `main.js`; with both, `main.js` runs.
2. Imports name the file as it is: `from "./kit.ts"`, also from a `.js` file
   that stays. Types come in with `import type { X }` (a plain import of a
   type stays in the code and fails at load: `verbatimModuleSyntax` reports it).
3. Copy `guard.ts` from `pip/` if the mod reads anything from
   outside (it will). Copy `keyhelp.d.ts` beside `keyhelp.ts` if it imports
   keyhelp.
4. Type it. The view: fields with initializers instead of assignments in
   `init` (`playing = true;`, `handle: FocusHandle | null = null;`), methods
   that override `View`'s marked `override` (`init`, `render`, `close`), `init`'s
   first parameter `Props | undefined` from `"gpui-shell"`.
5. `just typecheck` and `just lint` until both are clean, then the mod's bun
   tests and the Rust render tests (`cargo test --locked render_tests`: they
   load every shipped mod in the real engine).
6. Rename the paths in its tests (`../defaults/mods/<mod>/main.ts`). A test
   that reads a mod's source as text and evaluates it (`load()` in
   `scripts/browser.test.ts`) passes `.ts` through
   `new Bun.Transpiler({ loader: "ts" })` first.

## Patterns

### Parsing: guard.ts

`guard.ts` is a small kit of type guards: functions `(value: unknown) =>
value is T` that look at a value and prove its type, or refuse it. Name a
type by its guard so the two can't drift:

```ts
import type { Guarded } from "./guard.ts";
import { isBoolean, isString, literal, nullable, object, arrayOf } from "./guard.ts";

// required fields first, optional ones second (present must be right; missing is fine)
const isPipProps = object({}, { of: isString, pane: isBoolean, after: literal("pane", "park"), menu: arrayOf(isString) });
type PipProps = Guarded<typeof isPipProps>;

const pipProps = (): PipProps => {
  const p = props();

  return isPipProps(p) ? p : {};
};
```

`isString`, `isNumber` (finite), `isBoolean`, `isNull`, `isUndefined`,
`literal(...)`, `nullable(g)`, `arrayOf(g)`, `oneOf(...)`, `object(required,
optional)`, `parseJson(text, g)` (JSON proven by `g`, else `undefined`).
`typeof` belongs inside a guard and nowhere else (anti-slop
`no-runtime-typeof`, allowed in type guards); `unknown` may only be a guard's
parameter (`no-unknown-parameters`).

### shared(): typed keys

```ts
const isPaneNote = object({ of: isString, pane: isString, park: isBoolean });
const PANE = sharedKey("pip.pane", nullable(isPaneNote));

const noted = readShared(shared, PANE, null);        // PaneNote | null: the fallback when absent or another shape
writeShared(setShared, PANE, { of, pane, park });     // checked against the key's type
```

The key carries its type; a value written by another mod or an older
version in another shape reads as the fallback. `readShared` takes `shared`
as an argument (guard.ts imports nothing at run time), which is also how
`limits.ts` reads through its test seam (`host.shared`).

### props(), native views, exec, files

- `props()`: a guard for the props the mod is opened with (above).
- `nativeViewCall()` answers and `nextNativeViewEvent()` text: a guard,
  `parseJson(text, isEvent)`; `undefined` means skip it.
- `exec`: `r.stdout` is a string; JSON in it goes through `parseJson`
  (`limits.ts`: the usage endpoints' answers, the machine's record file).
- `terminals()` is herdr-core's listing, `readonly unknown[]`: a guard for the
  fields you read (`limits.ts` `isTerminalStatus`).
- A caught error is `unknown`: `err instanceof Error ? err.message : String(err)`.

### Instead of the usual escape hatches

| instead of | write |
|---|---|
| `x as Foo` | a guard at the boundary; inside the mod, types that are already right |
| `obj[key]` on a `Record<string, X>` | an interface with the keys, or `Map#get` (returns `X \| undefined`) |
| `list[0]!`, `arr.at(-1)!` | `list[0] ?? fallback`, or test for `undefined` |
| `typeof v === "function" ? v(s) : v` | a guard (`isString(v) ? v : v(s)`) or a discriminated union (`"icon" in c.mark`) |
| `...(cond ? { k } : {})` | two object literals: `cond ? { a, k } : { a }` |
| `xs.filter(f).map(g)` | `xs.flatMap((x) => (f(x) ? [g(x)] : []))` |
| `declare field: T` set in `init` | a field with an initializer, `T \| null` when there is no value yet |
| `{ then: … }` in props | another name (`then` makes an object a thenable) |
| a `.js` helper's inferred types (`list = []` reads as `never[]`) | a `.d.ts` beside it (`keyhelp.d.ts`) until it converts |

### Shared copies

A mod can't import another mod's files, so a shared file is copied into
every mod that uses it, byte for byte, and a test fails when copies drift:

- `guard.ts`, `keyhelp.d.ts`: `scripts/mods-typescript.test.ts` (it also
  checks that every mod importing guard.ts has the copy).
- `limits.ts` (nocturne, usage): `scripts/usage-limits.test.ts`.
- `keyhelp.ts` (14 mods): `scripts/keyhelp.test.ts`. It stays `.js` until
  the migration converts all its copies in one commit; then `keyhelp.d.ts`
  goes, the test's paths turn `.ts`, and each importer's
  `from "./keyhelp.ts"` becomes `"./keyhelp.ts"`.

Convert a shared file in all its copies at once, edit one, copy it over the
others (`for m in ...; do cp ...; done`), and rename the paths in its test.

## Common errors

| error | cause | fix |
|---|---|---|
| `<file>:5:8: TypeScript enum is not supported in strip-only mode` (at load) | syntax that would need code generated | a `const` object, a module, a declared field, `x as T`; `erasableSyntaxOnly` reports it in `tsc` first |
| `SyntaxError: export 'Foo' not found` (at load) | a type imported without `type` | `import type { Foo }` |
| TS2307 `Cannot find module './kit.js'` | the file is `kit.ts` now | import `./kit.ts` |
| TS4111 `comes from an index signature` | an open dictionary | name the keys |
| TS2532 `possibly 'undefined'` on `a[i]` | `noUncheckedIndexedAccess` | handle the missing case |
| TS2375 `exactOptionalPropertyTypes` | `{ k: undefined }` for an optional `k` | leave the key out |
| TS4114 `must have an 'override' modifier` | `init`, `render`, `close` | `override init(...)` |
| `anti-slop(no-unknown-parameters)` | a helper takes `unknown` | parse first; only a guard takes `unknown` |
| `anti-slop(require-readable-spacing)` | blank lines | `just lint --fix`, then read the diff: it splits a one-line block oddly, write those out |
| `unicorn(no-thenable)` | a `then` key | rename it |

## The typings

`herdr-app types <dir>` writes `gpui-kit.d.ts` (gpui-kit, gpui-base, the
engine's globals and the `herdr` module, from `defaults/herdr.d.ts`) and the
editor config: a strict `tsconfig.json` for a `main.ts` mod, `jsconfig.json`
for a `.js` one; an author's own config is never replaced. The app does the
same on every load. `just typecheck` writes them to `target/mod-types/` from
the built app; change the typings in `defaults/herdr.d.ts` or in the
generator (`vendor/gpui-kit/crates/shell/src/typings.rs`), never in a
generated file.

Not yet sound, and what the app would need to expose to make it so:

- `shared()`: a declared schema per key (in `mod.json`, say) that the app
  validates on `setShared`, so a read is typed by the declaration instead of a
  guard in every reader.
- `props()`: a props schema per mod, checked when a copy is opened
  (`openOverlay`, `pane.split`), so `props()` is typed.
- `run(name, args)` and `openOverlay`'s `props`: argument types per command,
  generated from the app's command table (today `Record<string, unknown>`).
- `nativeViewCall()` and `nextNativeViewEvent()`: result and event types per
  action, generated from the native library's action table.
- `terminals()`: a typed listing, if herdr-core published its JSON's schema.
- `theme()` and `settings()` are typed from the app's own structs, written by
  hand in `herdr.d.ts`; generating them from those structs would keep them in
  step, and a theme file's colour overrides aren't validated as `#hex` today.
