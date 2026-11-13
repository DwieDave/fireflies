# Mods in TypeScript

Fireflies runs a mod's `.ts` files by blanking their types out and running
the rest (`swc_ts_fast_strip` in the loader, `vendor/gpui-kit/crates/shell/src/typescript.rs`).
Nothing is compiled and nothing is checked at run time: the checking is
`tsc` and `oxlint`, before the code ships. This page is the bar a mod's
TypeScript meets, the steps to convert a JavaScript mod, and the patterns
the conversion settled on.

`nocturne` and all sixteen of its mods (listed in `scripts/nocturne-mods.ts`,
once `nocturne-<name>`) are TypeScript, with the files they share (below). The stock mods (agents, files, picker, pane, tabs,
spaces, win98, …) and the frame's older pages are JavaScript and stay as
they are. Read `pip` and `usage` as small patterns, preview's `viewer.ts`
for a whole view, github's `gh.ts` and `cache.ts` for outside data read and
kept.

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

### Records keyed by data

A record whose keys are data (slots, ids, folders, PR numbers) is a
`ReadonlyMap` past the place it is parsed. An index signature
(`{ [key: string]: X }`, also with `| undefined` and also as an interface)
remains only:

- (a) as the type of a proven JSON object right at the boundary: the guard's
  result, turned into a Map there, and back into an object where it's
  written (guard.ts `readSharedMap` / `writeSharedMap` / `parseJsonMap`;
  github's `cache.ts` reading and writing its file);
- (b) where a herdr or gpui-kit function's own parameter is such an object
  (`run(name, args)`, `Props`);
- (c) inside `as const satisfies` for a literal table whose keys stay known,
  or as `Record<Union, X>` with a union key (`{ ... } as const satisfies
  { readonly [K in Tone]: string }`): that widens nothing.

Not in function signatures, fields or exported types inside the mod.

### The checks

The bar is enforced, both inside `cargo test` (`tests/mods_typescript.rs`):

```sh
just typecheck   # tsc -p defaults/tsconfig.json: strict, noUncheckedIndexedAccess,
                 # exactOptionalPropertyTypes, noImplicitOverride, noImplicitReturns,
                 # noPropertyAccessFromIndexSignature, erasableSyntaxOnly, verbatimModuleSyntax
just lint        # oxlint + anti-slop (oxlint.config.ts); `just lint --fix` adds blank lines
```

Both cover every `.ts` file under `defaults/` (mods and frame). The
JavaScript that remains (the stock mods, parts of the frame) is outside both
(`checkJs` is off; the lint ignores `**/*.js`).
`scripts/` (the bun tests) is outside the lint: they stand in for `herdr`
with `mock.module`, which anti-slop's `no-module-mocking` rejects, and
changing that is a refactoring of the tests, not of the mods. The tools are
the exact versions in `package.json` (`bun install` puts them in
`node_modules/`). Without `just`, the recipes' commands run as they are:
`cargo run --locked -q -- types target/mod-types`,
`node_modules/.bin/tsc -p defaults/tsconfig.json`,
`node_modules/.bin/oxlint --deny-warnings defaults/mods defaults/frame`.

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
6. Rename the paths in its tests (`../defaults/mods/<mod>/main.ts`); see
   Tests below.

`build.rs` embeds `defaults/mods`: a `git mv x.js x.ts` while a cargo build
runs breaks that build ("couldn't read …/x.js"), so rename between builds.
A commit of one file while renames are staged names it
(`git commit -m … -- <path>`), or the staged renames go along.

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
parameter (`no-unknown-parameters`): guard first, then pass the proven value
(`isX(p) ? toX(p) : fallback`). The same rule refuses a local annotated
`: unknown` (`let err: unknown = null`): keep what you need of it, the
message string. A value of known type tested outside a guard needs no
`typeof`: `const v = x ?? null; v === null ? … : …`.

A mod's own guards beyond guard.ts go in a file of its own (github's
`guards.ts`), never into guard.ts, which is a shared copy:

- A field that may be left out, null or undefined (JSON from a program, a
  copy slimmed field by field): `maybe(g)`, `T | null | undefined`, written as
  its own arrow. Built on `oneOf` it fails: `oneOf` constrains `T` to
  `Literal | object`, and the constraint leaks into the inference of an
  `object({}, …)` inside it (TS2345 naming `Fields<{ toString…`). Optional
  `maybe` fields also let a slim copy be written field by field
  (`{ name: r.name }`) under `exactOptionalPropertyTypes`.
- A list where one bad item mustn't refuse the whole answer (GraphQL nodes
  GitHub nulls out): guard it as a list of anything (`isList`), then
  `list.filter((x) => guard(x))` where it's read.
- A user-state record whose fields are each optional (`{ hidden: true }`
  alone): guard every field as optional, then normalise after the read.
- Props with optional groups an older caller may send in another shape:
  guard the plain fields and each group on its own, so one odd group doesn't
  drop them all (git's `isGitProps`, `isGroups`).
- A JSON object keyed by data inside a value (a manifest's scripts, `nix
  flake show`): prove the object, then read each field into a guard,
  `Object.getOwnPropertyDescriptor(o, k)?.value`, and set it in a Map
  (scripts' `guards.ts` `fields`).

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
as a string beside its typed key (`OPEN = "editor.open"`, `OPEN_KEY`): the app
and any JavaScript reader use the name.

A record written back whole by a mod that doesn't own it (the shelf's pins):
read it with the owner's guard, word for word, so the writer drops exactly
what the owner drops.

### props(), native views, exec, files

- `props()`: a guard for the props the mod is opened with (above). A
  `Guarded<…>` type is a mapped type, so it is assignable to `Props`: a proven
  props value goes straight to `set_props` or a nested view's `init`.
- `nativeViewCall()` answers and `nextNativeViewEvent()` text: a guard,
  `parseJson(text, isEvent)`; `undefined` means skip it. viewer.ts's
  `ask(action, guard)` is the pattern: the answer proven or null, and
  `act(action)` when it isn't read.
- A nested view's props (the host passes them, `init`/`update` get
  `Props | undefined`): a guard over them, written to what the hosts pass
  (viewer.ts `isViewerProps`).
- `exec`: `r.stdout` is a string; JSON in it goes through `parseJson`
  (`limits.ts`: the usage endpoints' answers, the machine's record file).
- A program's answers read in many places (gh): each read names the guard
  its answer must pass, and an answer of another shape is an error, never a
  value of the wrong type. github's `gh.ts` is the pattern: `api(repo, path,
  read)`, `graphql(repo, query, guard, vars)`, `ghJson(repo, args, guard)`.
  An answer kept in a slimmer form: `Read<R, T> = { answer: Guard<R>, slim:
  (r: R) => T, kept: Guard<T> }`; a cache holding `unknown` re-proves a kept
  value with `kept` before it hands it back.
- A call that answers `unknown` (`lspRequest`): the method that asks takes
  the guard (`request<T>(method, guard, …)`), so no `unknown` local and no
  `unknown` return.
- `terminals()` is herdr-core's listing, `readonly unknown[]`: a guard for the
  fields you read (`limits.ts` `isTerminalStatus`). An entry's `pid` is
  `number | null` (herdr-core sends null).
- A `then` field in outside data: `unicorn(no-thenable)` refuses it as a key
  of a guard object; read it with `Object.getOwnPropertyDescriptor(v,
  "then")?.value` into a guard.
- A caught error is `unknown`: `err instanceof Error ? err.message : String(err)`.

### Views, commands and their arguments

- Fields made in `init` (focus handles, inputs, nested views) are
  `X | null = null`, read with `?.`. A field set from `cx.focus_handle()` in a
  form's root keeps `this.handle = cx.focus_handle(); bindTab(cx);` as it is
  (`form-keys.test.ts` matches that text), and takes a narrowed
  `const handle = this.handle` after it.
- A view that exposes a record's fields as `this.x` (the editor's shown
  tab): typed get / set pairs over the record.
- A view method tests call keeps its signature (it reads `this.x` and checks
  it inside); only the render's own helpers take a narrowed value.
- `run(name, args)` and `openOverlay`'s props take `Record<string,
  unknown>`: an interface isn't assignable to it, a type-literal alias is
  (`type WhereArgs = { pane?: string; on?: string }`). Build arguments without
  `...(cond ? {…} : {})`: a local of that type set key by key, or a helper
  that sets only the keys that are there.
- A key handler reads `e.key_char` as the engine sends it: a string or
  `undefined` (`isString(e.key_char)`, or a truthy test). Tests that send
  `null` are then fine too.
- A result that is a value or an error: a union,
  `{ abs, folder, error?: undefined } | { error: string }`, narrowed with
  `r.error !== undefined` (or `"error" in r`).
- Rows of several kinds read through one variable: a union whose members
  mark the others' fields `?: undefined` (`head?: undefined` on a tree row),
  so `r.head` reads on the union and narrows; or type predicates over the
  union by a field only one member has (`"gone" in x` for a branch,
  `"parents" in x` for a commit, git's `isBranch`). No cast, no new tags on
  the rows.
- An action table read by the actions of a key table: `ACTIONS = { … }
  satisfies { readonly [A in Action]?: Handler }`, with `Action` taken from
  the key table (`(typeof BINDINGS)[number][2]`, the table `as const
  satisfies readonly Row[]`), and a widened `readonly Row[]` alias of it for
  `.includes(key)`.
- A class another file drives (a popup stack, a review): an interface of
  what it needs of its host (github's `host.ts`, git's `PopupHost`,
  `ReviewHost`); the view meets it structurally. A module that calls back
  into the view imports its type only
  (`import type { default as GitView } from "./main.ts"`: a type-only cycle
  is erased).
- Callbacks passed to element methods (`on_click`, `on_mouse_down`, `.when`)
  are typed by their context: don't annotate `(e, cx)`.
- A member of a union that declares a field `?: undefined` (`ModPaneInfo`'s
  `program?: undefined`) reaches a parameter under
  `exactOptionalPropertyTypes` only if the parameter says so:
  `{ program?: X | undefined }`.
- Two members where one extends the other (`Glow | Flying`, `Flying extends
  Glow`) collapse to the wider one (subtype reduction): give the plain member
  `x?: undefined` and test `f.x === undefined`.
- A colour with an alpha suffix: `` `${t.ansi0}88` `` types as `Color`;
  `t.ansi0 + "88"` is a `string`.
- `noImplicitReturns` with a key handler that sometimes returns `false`:
  the other paths `return true`.

### Instead of the usual escape hatches

| instead of | write |
|---|---|
| `x as Foo` | a guard at the boundary; inside the mod, types that are already right |
| `obj[key]` on a `Record<string, X>` | an interface with the keys, or `Map#get` (returns `X \| undefined`) |
| `list[0]!`, `arr.at(-1)!` | `list[0] ?? fallback`, or test for `undefined` |
| `typeof v === "function" ? v(s) : v` | a guard (`isString(v) ? v : v(s)`) or a discriminated union (`"icon" in c.mark`) |
| `...(cond ? { k } : {})` | two object literals: `cond ? { a, k } : { a }`, or a typed local set key by key |
| `xs.filter(f).map(g)` | `xs.flatMap((x) => (f(x) ? [g(x)] : []))` |
| `declare field: T` set in `init` | a field with an initializer, `T \| null` when there is no value yet |
| `{ then: … }` in props | another name (`then` makes an object a thenable) |
| `x.list.filter(Boolean)` mixing data and absence | `flatMap` with a guard, or an explicit `string \| null` and a test |
| a lookup table `{ a: [...], b: [...] }` read by a key from data | a `Map` (`CALLOUTS.get(type)`, `LOGO.get(key)`), or a `switch` when the keys are a union (kinds.ts `tag`); a literal table tests read as an object stays `as const`, with a `Set` of its keys for lookups |
| a parameter `e: unknown` in a `.catch` | name it `cause` (anti-slop allows it): `(cause: unknown) => …` |
| `a?.b?.c` on a value of known type | the type says what's there; keep `?.` for what really may be missing |
| `Object.entries(x)` on an interface (gives `any`) | a `Map`, or the keys named one by one |
| `typeof x === "number"` outside a guard | `const v = x ?? null; v === null ? … : …`, or `isNumber(x)` from guard.ts |
| a literal table read by a union key | `{ … } as const satisfies { readonly [K in Union]: X }` |

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
| `toolground.ts` | nocturne, notifications | `nocturne-tab-seam.test.ts` | `ToolLook`, `toolGround`, `toolHover`, `mix`, its `dither` |

Not copies (same name, different file per mod): `kit.ts`, `logic.ts`,
`tabs.ts`, `graph.ts`, git's `keys.ts` and `kinds.ts`. The toolbar's ground
and hover, once held equal as text inside nocturne's and notifications'
kits, is `toolground.ts` now, a copy; both kits import it and pass it on.

To change a shared file, edit one, copy it over the others
(`for m in ...; do cp ...; done`), run its test.

## Tests

The bun tests in `scripts/` stand in for herdr and gpui; they aren't
type-checked or linted.

- A test that reads a mod's source and evaluates it (`load()` in
  preview.test.ts and the like) passes a `.ts` file through
  `scripts/mod-source.ts` (`asJs`) and puts guard.ts's exports in its scope
  (`guard`).
- A view made in a test is `new X()`, not `Object.create(X.prototype)`: only
  `new` runs the field initializers. A fixture that keeps `Object.create`
  gives the view every field the code under test reads, and a generic
  `surface()` helper (keyhelp, keys-lists) lists the fields `key()` reads.
- A fixture of a record that is guarded now is a complete record (the
  notifications tests' `ITEM`, `PERM_REQUEST` defaults): a partial one is
  refused like any record of another shape.
- A key event in a test is a whole `KeyEvent`: `modifiers` always there.
  Complete the event in the test (one wrapper per file), not with
  `e.modifiers ?? {}` in the mod. The engine never sends `key_char: null`;
  shared fixtures that do are met by a mod that reads `key_char` with
  `isString` or a truthy test.
- Stand-ins give herdr's real shapes (`updates()`, agents with their
  `program`): a typed reader no longer writes `?.` on fields that are always
  there, so fix a `null` stand-in rather than the reader.
- A file a herdr-only test loads (no gpui stand-ins) mustn't import a
  `kit.ts` that imports gpui-kit: parse with the guards directly (nocturne's
  `prompt.ts`, `procs.ts`, `scripts.ts`).
- Code that skipped work when `cx.new` was missing now mounts its nested
  view: the test's `cx` has `new: () => ({ set_props() {}, release: () => true })`
  and the loader's scope the class.
- Tests that read a source's text (`form-keys.test.ts`,
  `nocturne-floatfocus.test.ts`) match lines as written: keep those lines
  when typing the file, and give the test the new file name.
- A fixture with an optional field set to `undefined` (`exit_code:
  undefined`) fails an `object()` guard; JSON never has it: write `null`, or
  leave the key out.
- Fixtures of a program's answers (github's GraphQL) are worth a test that
  runs them through the guards the mod reads them with, so a guard can't be
  stricter than the real answers.

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
| `unicorn(no-thenable)` | a `then` key | rename it; in outside data read it through `getOwnPropertyDescriptor` (Patterns) |
| TS2339 `findLastIndex does not exist` | ES2022's lib (the tsconfig's) doesn't have it | a loop from the end |
| TS2345 with `Fields<{ toString: …` | a guard built with `oneOf` around `object({}, …)`: its constraint leaks into the inference | a helper of its own (`maybe`, Patterns), not `oneOf` |
| `anti-slop(no-known-value-widening)` | a field, binding or return typed with an inline object or mapped type, `let x: unknown`, a known value passed to a same-file function taking `unknown` | name the type (an interface), `satisfies` for a literal table, parse into the type |
| `anti-slop(no-shape-in-symbol-names)` | a name like `SHAPE` | rename it and its importers |
| `eslint(no-control-regex)` | a control character in a regex (`\x1b`, `\u0000-\u001f`) | check code points (`c.codePointAt(0)`), or build the RegExp from `String.fromCharCode` |
| tsc errors after `just lint --fix` | `--fix` rewrote code (it turned `[...s.slice(0, 14)].map` into `s.slice(0, 14).map`) | read the `--fix` diff; write the line out (`Array.from(s.slice(0, 14), f)`) |

## The typings

`herdr-app types <dir>` writes `gpui-kit.d.ts` (gpui-kit, gpui-base, the
engine's globals and the `herdr` module, from `defaults/herdr.d.ts`) and the
editor config: a strict `tsconfig.json` for a `main.ts` mod, `jsconfig.json`
for a `.js` one; an author's own config is never replaced. The app does the
same on every load. `just typecheck` writes them to `target/mod-types/` from
the built app; change the typings in `defaults/herdr.d.ts` or in the
generator (`vendor/gpui-kit/crates/shell/src/typings.rs`), never in a
generated file. In an interface, `new(...)` is a construct signature; a
method called `new` (`cx.new(Class, props)`) is written `"new"(...)`.

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
