# Mods in TypeScript

Fireflies runs a mod's `.ts` files by blanking their types out and running
the rest (`swc_ts_fast_strip` in the loader, `vendor/gpui-kit/crates/shell/src/typescript.rs`).
Nothing is compiled and nothing is checked at run time: the checking is
`tsc` and `oxlint`, before the code ships. This page is the bar a converted
mod meets and the steps to convert one. The shipped mods to convert are
`nocturne` and the ones listed in `scripts/nocturne-mods.ts` (once
`nocturne-<name>`). `pip` and `usage` (with `nocturne/limits.ts`) are
converted, and so are the files the mods share (below): read them as the
pattern, preview's `viewer.ts` for a whole view.

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
3. `guard.ts` is already in the mod (nocturne and each of its mods carry
   it), and so are the shared files below, already TypeScript: import them
   as they are.
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

Two more shapes, both in guard.ts:

- A record keyed by data (a slot, a file name): `sharedMapKey(name, entryGuard)`,
  `readSharedMap(shared, KEY)` (a `ReadonlyMap`, entries in another shape left
  out), `writeSharedMap(setShared, KEY, map)`; a JSON file of that shape,
  `parseJsonMap(text, entryGuard)`. Examples: `editor.paths`
  (editor-route.ts `PATHS_KEY`), the preview's titles, the scratchpad's
  index.json.
- A list other mods append to: `sharedListKey(name, itemGuard)`,
  `readSharedList(shared, KEY)`: one entry in another shape is left out, not
  the whole list (follow.ts `CHANGES_KEY`, the files pane's moves).

A record another mod reads by its old string name keeps the name exported
as a string beside its typed key (`OPEN = "editor.open"`, `OPEN_KEY`), so the
`.js` files that still call `shared(OPEN)` keep working until they convert.

### props(), native views, exec, files

- `props()`: a guard for the props the mod is opened with (above).
- `nativeViewCall()` answers and `nextNativeViewEvent()` text: a guard,
  `parseJson(text, isEvent)`; `undefined` means skip it. viewer.ts's
  `ask(action, guard)` is the pattern: the answer proven or null, and
  `act(action)` when it isn't read.
- A nested view's props (the host passes them, `init`/`update` get
  `Props | undefined`): a guard over them; a field a `.js` host may leave
  `undefined` is `oneOf(isString, isNull, isUndefined)` until the host
  converts (viewer.ts `isViewerProps`).
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
| `x.list.filter(Boolean)` mixing data and absence | `flatMap` with a guard, or an explicit `string \| null` and a test |
| a lookup table `{ a: [...], b: [...] }` read by a key from data | a `Map` (`CALLOUTS.get(type)`), or a `switch` when the keys are a union (kinds.ts `tag`) |
| a parameter `e: unknown` in a `.catch` | name it `cause` (anti-slop allows it): `(cause: unknown) => …` |
| `a?.b?.c` on a value of known type | the type says what's there; keep `?.` for what really may be missing |

### Shared copies

A mod can't import another mod's files, so a shared file is copied into
every mod that uses it, byte for byte, and a test fails when copies drift.
All of them are TypeScript now; each one's exported types are the contract
the mods build on (read the file's top and its `export type`s):

| file | copies | test | what it types |
|---|---|---|---|
| `guard.ts` | nocturne and all 16 mods | `mods-typescript.test.ts` | `Guard<T>`, `Guarded`, `object`, `SharedKey`, `SharedMapKey`, `SharedListKey`, `parseJson(Map)` |
| `keyhelp.ts` | 14 mods | `keyhelp.test.ts` | `KeyRow` (key, what, go?, `.key`, `.danger`), `KeySection`, `KeyList`, `KeyPress`, `HintBarOptions`, `KeysViewOptions` |
| `form-keys.ts` | nocturne, editor, git, github, notifications, machine-add, frame/settings, frame/feedback | `form-keys.test.ts` | `Stop`, `StopKind`, `FormAction` (a union on `act`), `FormHint`, `FormModifiers` |
| `editor-route.ts` | editor, file-tree, finder, markdown | `editor-tabs.test.ts` | `OpenRequest` (`editor.open`), `EditorView`, `EditorProps`, `EditorQuery`, `OpenFile`, `EditorHost` |
| `viewer.ts`, `kinds.ts`, `image.ts`, `table.ts`, `diff.ts`, `keys.ts` | preview, editor, file-tree | `preview-shared.test.ts` | `ViewerProps`; `Kind`, `LookKind`, `Route`, `Run`, `Span`; `Picture`, `Plan`, `View`, `Size`; `Table`, `Column`, `DbTable`; `Patch`, `PatchRow`, `PatchFile`; `ShownAs` |
| `markdown.ts` | editor, github, markdown | `markdown.test.ts` | `Block` (a union on `kind`), `DocOptions`, `TaskItem`, `Footnote`, `CALLOUTS` (a Map) |
| `paths.ts`, `follow.ts` | editor, markdown | `markdown.test.ts`, `editor-follow.test.ts` | `Link` (a union on `kind`); `FileChange`, `Followed` |
| `scratch.ts` | nocturne, editor | `nocturne-scratchpad.test.ts` | `Owner`, `Note`, `IndexEntry`, `ScratchIo`, `Autosave`, `AutosaveState` |
| `limits.ts` | nocturne, usage | `usage-limits.test.ts` | the usage windows |

Not copies (same name, different file per mod): `kit.js`, `logic.js`,
`tabs.js`, `graph.js`, git's `keys.js` and `kinds.js`. One part of a kit is
held equal: the toolbar's ground and hover in nocturne's and notifications'
`kit.js` (`nocturne-tab-seam.test.ts` compares the text from
`// ---- the toolbar's ground` to the end of `toolHover`): type it the same
way, word for word, in both.

To change a shared file, edit one, copy it over the others
(`for m in ...; do cp ...; done`), run its test. Tests that read a mod's
source and evaluate it (`load()` in preview.test.ts and the like) pass a
`.ts` file through `scripts/mod-source.ts` (`asJs`) and put guard.ts's
exports in their scope (`guard`); a view made in a test is `new View()`, not
`Object.create(View.prototype)`, so its fields get their initial values.

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
