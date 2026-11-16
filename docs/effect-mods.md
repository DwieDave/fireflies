# The mods on Effect

Developer's words:

> Effectify the mods with some cleanly abstracted helpers using the latest
> Effect stack, enable all Effect lsp/tsgo diagnostics preferably through
> oxlint, enable the effect rules from dillonmulroy antislop

> The last item is an Effect v4 Refactor of all Typescript mods. But this
> needs developing common tools to e.g. run effects, common abstracted
> context services to make a clean codebase. Everything that needs
> decoding/parsing should run through Schema. Everything HTTP should use
> Effects client with sane retry rules etc. The goal is not only a
> mechanical refactor but improving the code, finding weaknesses and
> improving on them using a more typesafe solution that allows us to have
> common patterns too.

This page is the foundation (how Effect reaches a mod, the kit, the lint),
the pilot (the usage mod, converted), and the plan for the rest. A firefly
converting a mod reads all of it; docs/mods-typescript.md stays the bar
every line meets.

## How Effect reaches a mod

A mod is `.ts` run with its types blanked out, in the window's one QuickJS
runtime (gpui-shell; 256 MB heap for every mod together, 50 ms per render,
5 s to evaluate a module). A mod may import only its own folder. So a
library reaches it one of three ways, measured with effect@4.1.4 (`effect`
and `effect/http`, 1.1 MB minified, 338 KB gzipped), in the real engine
(a cargo test, debug build, the machine under load: absolute times are
high, the ratios hold):

| how | heap | load | |
|---|---|---|---|
| a copy in every mod (a shared copy, like guard.ts) | +12 MB per mod | 0.4–0.6 s per mod | 20 mods: 240 MB of the 256 MB |
| a git dependency per mod (gpui-shell's manifest `dependencies`) | the same per mod | the same, plus a network fetch | |
| **library modules: served by name, evaluated once per window** | +13.3 MB once, +29 KB per further mod | 0.4 s for the first, 5–10 ms for each after | |

A render reading through the runtime (`runtime.now(effect)`) costs under
5 µs a call.

Effect did not load in the engine at all before: it builds a `TextEncoder`
at module load (Random.ts, HttpBody.ts) and the engine had none. Missing
still, and met by the kit: `setTimeout` (the kit's clock runs on
`cx.timer`), `Intl` (Effect's `DateTime` can't name the local zone: the
kit's `localTime`), `AbortController` (Effect makes one only for a
`tryPromise` whose `try` takes the signal: don't take it).

### The core changes (Developer's review)

Two, in vendor/gpui-kit, and their wiring in src/:

1. **UTF-8 `TextEncoder` and `TextDecoder`** as engine globals
   (vendor/gpui-kit/crates/shell/src/engine/quickjs/standard/encoding.rs,
   JavaScript over the engine's Buffer; another encoding throws a
   RangeError). Typed in typings.rs; `crypto` is declared a `var` there now,
   as lib.dom has it, so `globalThis.crypto` types.
2. **Library modules** (vendor/gpui-kit/crates/shell/src/library_modules.rs,
   and `LibraryModules` in the engine's loader chain, after the host
   modules, before the mod's own files): files the host registers under
   virtual paths, imported by a bare name (`effect` is `effect/index.js`,
   `@fireflies/kit/live` is `@fireflies/kit/live.ts`), their relative
   imports kept inside their own library, `.ts` stripped as a mod's are.
   build.rs embeds `defaults/lib`; `mods::install_policy` registers it
   (`mods::export_libraries`). A folder under defaults/lib is its import
   name.

The three questions (AGENTS.md):

1. *Does the app itself act on it?* No: the app only serves the files.
2. *Can only the app see it?* No.
3. *Can mods not do it correctly, even with care?* Yes, measured: a mod can
   only carry its own copy, and a copy per mod costs 12 MB of the shared
   256 MB heap and half a second of load each (the table above). And
   without TextEncoder the library doesn't load whatever a mod does.

The alternatives: a copy per mod (above); git `dependencies` (the same cost,
and a fetch); an import map in the resolver pointing at a shared folder on
disk (the same as library modules but the files could drift from the
binary); a build step bundling each mod (no shared instance, and mods stop
being "the .ts you read is what runs"). Library modules also end shared
copies (below).

Optional mods in their own repositories (fireflies-k8s) import the same
names; their type check finds `effect` in their own `node_modules` (the
version Fireflies ships: `effect@4.1.4` in its devDependencies) and the kit
through the types the editor setup provides.

## The kit: @fireflies/kit

`defaults/lib/@fireflies/kit` (a bun workspace in the repo, so tsc, oxlint
and bun find it in `node_modules/@fireflies/kit`; the app serves it by
name). Three entries:

- `@fireflies/kit`: services, schema helpers, the runtime, HTTP, errors.
  Imports nothing from the app at run time: a test loads it as it is.
- `@fireflies/kit/live`: the services over `herdr` (`Live`), `toast(title)`.
- `@fireflies/kit/testing`: in-memory test layers.

| file | what |
|---|---|
| `errors.ts` | `ExecError`, `ExitError`, `FileError`, `StaleFile`, `DecodeError`, `HeaderScriptExit`, `CurlFailed`: branded `Schema.TaggedError`s with a `message`; `lastLine`, `causeMessage` |
| `schema.ts` | `decode(schema, what)`, `decodeJson`, `decodeJsonOption`, `encodeJson`; `sharedKey(name, schema)`, `readShared`, `readSharedOption`, `writeShared` (render-side, over herdr's `shared`) |
| `services.ts` | `Exec` (+ `execOk`, `execJson`), `Files`, `Shared` (+ `sharedOr`), `Commands`, `Workspace`, `Notify` |
| `runtime.ts` | `modRuntime(layer)`, `ViewFx` (`run`, `now`, `close`, `running`), `Redraw` / `redraw`, `hostClock`, `describe`, `localTime` |
| `http.ts` | `fetchClient(fetch)`, `curlClient(run, { headersFrom, seconds })`, `policy({ timeout, retries, base, longest, statuses })`, `retryAfter` |
| `live.ts` | `ExecLive`, `FilesLive`, `SharedLive`, `CommandsLive`, `WorkspaceLive`, `NotifyLive`, `HttpLive`, `Live`, `toast` |
| `testing.ts` | `execTest(handler)`, `sharedTest()`, `filesTest()`, `workspaceTest(look)`, `commandsTest(queue)`, `notifyTest()`, `httpTest(answer)` |
| `engine-globals.d.ts` | the web types Effect's declarations name (types only; the engine has none of them) |

### Running effects from a view

One runtime per mod, built once; each copy attaches in `init`. Before (the
usage pane):

```ts
override init(_props: Props | undefined, cx: AsyncContext) {
  cx.spawn(async (cx) => {
    for (;;) {
      const c = String(await nextCommand()).replace(/^usage\./, "");
      if (c === "refresh") this.read(cx, "force");
      // …
      cx.notify();
    }
  });
  cx.spawn(async (cx) => { await cx.sleep(FIRST); await refreshUsage("open"); cx.notify(); });
  cx.timer.every(TICK, (cx) => { this.read(cx); cx.notify(); });
}
```

After:

```ts
const runtime = modRuntime(Layer.provideMerge(UsageEndpoint.layer, Live));

override init(_props: Props | undefined, cx: AsyncContext) {
  const fx = runtime.attach(cx, toast("Usage"));
  this.fx = fx;
  fx.run(Effect.forever(Commands.use((x) => x.next).pipe(
    Effect.tap((c) => Effect.sync(() => this.command(Str.replace(/^usage\./, "")(c), handle))),
    Effect.andThen(redraw),
  )));
  fx.run(Effect.andThen(Effect.sleep(FIRST), refreshUsage("open")).pipe(
    Effect.andThen(Effect.forever(Effect.sleep(TICK).pipe(Effect.andThen(refreshUsage("tick")), Effect.andThen(redraw)))),
  ));
}

override close() { return this.fx?.close(); }   // every fiber, its timers with it

read(why: Why | boolean = "tick") { this.fx?.run(refreshUsage(why), { key: "read" }); }  // latest wins
```

- `runtime.attach(cx, report)` keeps `init`'s `AsyncContext` (gpui-kit's
  context made to be held: valid across awaits, refusing once the copy is
  closed or reloaded), never a callback's `cx`.
- Every effect it runs gets the copy's clock (`hostClock`: `Effect.sleep`,
  `Schedule.spaced`, timeouts on `cx.timer.after(ms, …, { owner: null })`,
  cancelled when the fiber is interrupted) and its `Redraw`.
- `fx.run(effect, { key })`: a run under a key interrupts the one before
  (search as you type, a refresh pressed twice). Failures (not
  interruptions) go to `report` as one line; the copy redraws when a run
  ends (`{ redraw: false }` to skip).
- `fx.close()` from `View.close` interrupts everything, within its 250 ms.
- A render reads with `runtime.now(effect)` (sync; no copy needed, so a
  helper class that isn't a View reads too). One clock read per render
  (`this.now = runtime.now(Clock.currentTimeMillis)`) so every countdown
  agrees.
- A part of a mod that isn't a View (nocturne's `UsageSection`) attaches
  with the `AsyncContext` its owner's `init` gives it.

### Services instead of `herdr`, test layers instead of mocks

Code asks for what it touches (`yield* Exec`, `Shared.use((s) => s.get(KEY))`),
and its type lists it (`Effect<Reading, never, Exec | Shared | UsageEndpoint>`).
Before, limits.ts carried a hand-made seam (`setHost({ exec, shared, … })`)
and its tests replaced the `herdr` module (`mock.module`, which anti-slop's
no-module-mocking rejects, the reason scripts/ is outside the lint); a
second "app" was a second module instance (`import("…/limits.ts?app=b")`).
After:

```ts
const shared = sharedTest();
const exec = execTest(async (command, args) => /* a real spawn, or a fake machine */);
const layer = Layer.provideMerge(UsageEndpoint.layer, Layer.mergeAll(exec.layer, shared.layer, workspaceTest().layer));
await Effect.runPromise(Effect.provide(refreshUsage("force"), layer));
expect(shared.store.get("usage.note")).toMatchObject({ state: "off" });
```

A second app is a second `sharedTest()` over the same machine. A mod's own
service (the usage endpoints) is a `Context.Service` with a static `layer`,
and its test gives a fake (usage-poll's `UsageEndpoint` over `httpTest`).
View tests that draw still stand in for `gpui-kit`; `@fireflies/kit/live`
imports `herdr` as a namespace and looks each function up when called, so a
test's partial `herdr` stand-in still loads a converted mod.

### Schema for everything decoded

Before (guard.ts):

```ts
const isWindow = object({ used: isNumber, resets: nullable(isNumber), length: nullable(isNumber) });
export type UsageWindow = Guarded<typeof isWindow>;
const d = parseJson(body, isClaudeAnswer);          // undefined: "wasn't in a shape" and nothing more
```

After:

```ts
const UsageWindowSchema = Schema.Struct({ used: Schema.Finite, resets: Schema.NullOr(Schema.Finite), length: Schema.NullOr(Schema.Finite) });
export type UsageWindow = typeof UsageWindowSchema.Type;
const maybe = <A, I>(s: Schema.Codec<A, I>) => Schema.optionalKey(Schema.NullOr(s));   // left out or null
HttpClientResponse.schemaBodyJson(ClaudeAnswer)(response)  // a SchemaError saying where it differed
```

| guard.ts | Schema |
|---|---|
| `object(required, optional)` | `Schema.Struct({ …, k: Schema.optionalKey(x) })` |
| `nullable(g)` | `Schema.NullOr(x)` |
| `maybe(g)` (left out, null or undefined) | `Schema.optionalKey(Schema.NullOr(x))` |
| `literal("a", "b")` | `Schema.Literals(["a", "b"])` |
| `arrayOf(g)` | `Schema.Array(x)` |
| `isNumber` (finite) | `Schema.Finite` (not `Schema.Number`: the lint refuses NaN-accepting numbers) |
| `oneOf(a, b)` | `Schema.Union([a, b])` (first match wins: a member with more fields first) |
| `parseJson(text, g)` | `decodeJson(schema, what)` (an Effect), `decodeJsonOption(schema)` (a render) |
| `sharedKey(name, g)` / `readShared` | `sharedKey(name, schema)` / `readShared`, or `Shared.get(key)` in an effect |

A `Schema.Struct` keeps only its fields (others are dropped, where a guard
kept the object as it was): a value written back whole must carry every
field its schema names. A key's value encodes through its schema on write.

### HTTP

`HttpClient` from `effect/http`, over either transport, wrapped in `policy`:

- `fetchClient(fetch)` (`Live`'s `HttpLive`): the engine's fetch. It gives no
  response headers (so no Retry-After), one fixed timeout and no
  cancellation; a candidate for a core change when a mod needs them.
- `curlClient(exec.run, { headersFrom, seconds })`: curl through `Exec`, for
  a request whose secret a shell reads (a login in the keychain): the
  fragment's header lines go to curl's stdin, never an argument and never
  the mod's memory. Status, Retry-After and Content-Type come back; a
  header script that exits non-zero sends nothing (`HeaderScriptExit`).
- `policy({ timeout, retries, base, longest, statuses })`: non-2xx fails
  (`StatusCodeError`, the response attached); each attempt gets `timeout`;
  only idempotent requests (GET, HEAD, OPTIONS, PUT, DELETE) retry, on a
  transport error or 408/429/500/502/503/504, `base` doubled with jitter,
  never sooner than Retry-After; a Retry-After over `longest` (30 s) isn't
  waited for (the caller's own back-off is the place); a POST or PATCH never
  retries (it may have landed). Leave 429 out of `statuses` where the caller
  keeps a back-off between reads (usage does).

### Errors

Tagged, branded, with a message: `yield* ExitError.make({ … })`, handled by
tag (`Effect.catchTags({ HttpClientError: …, SchemaError: …, ExecError: … })`),
reported by `fx.run` as their message. No `catch(() => null)`: a failure
that should become a value says which (`Effect.orElseSucceed(() => null)`
next to its reason), one that should be shown becomes the mod's note.

## The lint

`just lint` runs two passes (and `cargo test` the same, tests/mods_typescript.rs):

1. `oxlint` with anti-slop (oxlint.config.ts) on defaults/mods, frame and lib,
   as before.
2. **The Effect pass**: `effect-tsgo oxlint --type-aware -c
   oxlint.effect.config.ts` on the justfile's `effect_sources` (the kit, and
   each mod converted to it; a converted mod joins the list in its
   conversion's commit):
   - every one of @effect/tsgo's 149 language-service diagnostics as an
     Oxlint type-aware rule, an error each. The config reads the list from
     the installed package's schema, so an update brings new rules in on.
     `effect-tsgo` runs Oxlint with its patched binding (and
     oxlint-tsgolint) without touching node_modules. Through Oxlint, as
     Developer preferred: it runs in the lint everyone already runs, and the
     type check stays plain tsc.
   - anti-slop's five Effect rules (tools/oxlint/anti-slop/effect, vendored
     from upstream's head 13909c9).
   - Off, with the reason in the config: `missing-pipeable-signature`
     (asks every exported function for a data-last overload: Effect's
     convention for its own library, meaningless for `due(rec, why, now,
     every)`), `prefer-namespace-import` (contradicts `prefer-barrel-import`;
     the app serves the barrels). Scoped: `unstable-api-usage` and
     `api-stability-leak` (all of `effect/http` is marked unstable) are
     allowed in the kit's HTTP files and a mod's `limits.ts`/`fx.ts`;
     `deterministic-keys` (a key derived from the file's path) holds in the
     kit but not in mods, whose files are byte-for-byte copies in several
     folders.
   - Allowed by a comment on the line, with its reason: the kit's clock
     reading `Date.now()`, `localTime` reading `new Date`, `HttpLive` calling
     `fetch` (they are the Clock, the local time, the HttpClient).

**Every finding is fixed.** Run over the mods not yet converted (`bun
scripts/effect-survey.ts`), every diagnostic on finds about 16,800 things
in the mods' own files:
70 % `strict-boolean-expressions` (`if (x)` on a non-boolean), 25 %
`prefer-effect-array` / `prefer-effect-string` (`xs.map(f)` → `Arr.map(xs, f)`,
`s.trim()` → `Str.trim(s)`), and the shared copies about 1,240 more. Asked
whether the conversions should skip the style part, Developer (2026-11-16):

> yes youre expected to fix all findings too

So every rule stays on as an error for every converted file, the style
ones included, and a mod isn't done while one finding is left (below).

### In the editor

mod-types (t12w) found: a mod's `import "effect"` resolves through the
nearest node_modules above the file; and the Effect diagnostics in the
Fireflies editor can't come from a typescript-language-server plugin
(TypeScript 7 is tsgo; plugins load from the editor's settings). The
contract for the editor mod: for a mod's files, run **@effect/tsgo's patched
tsgo language server**, `effect-tsgo tsc@7.0.2 --lsp --stdio` (it runs the
diagnostics, quick fixes included, without patching anything), with the
mod's tsconfig naming the plugin for its options:

```jsonc
{ "compilerOptions": { "plugins": [{ "name": "@effect/language-service", "diagnostics": true }] } }
```

Its severities in the editor follow the plugin options; the lint is the
gate. For an installed mod (no node_modules), `herdr-app types` would have
to write `effect`'s .d.ts and the kit beside gpui-kit.d.ts: mod-types' to
settle with this contract.

## Mods outside this repository

An optional mod in a repository of its own (fireflies-k8s is the first)
runs in the same engine: the app serves it `effect`, `effect/http` and the
`@fireflies/*` libraries by name, as it serves the shipped mods. What the
repository needs around that:

- **Typings and test code for the libraries.** `herdr-app types <dir>` (what
  such a repository already runs after each Fireflies update) also writes
  every `@fireflies/*` library, as that build serves it, into
  `<dir>/node_modules/@fireflies/<name>/` (sources, package.json, .d.ts; src/mods.rs
  `write_library_types`). They are TypeScript, so the same files are the
  types tsc and oxlint read and the code bun tests run. fireflies-k8s runs
  `herdr-app types types`, so its tsconfig maps them:

  ```jsonc
  "paths": { "@fireflies/*": ["./types/node_modules/@fireflies/*"] },
  "include": ["mod/**/*.ts", "types/gpui-kit.d.ts", "types/runtime.d.ts", "types/node_modules/@fireflies/kit/engine-globals.d.ts"]
  ```

  (bun reads the same `paths`; a mod whose `types` dir is its own folder
  needs no mapping: node_modules beside it is found as it is.)
- **Effect from npm**, the version the app serves: the kit's package.json
  names it as its peer (`"peerDependencies": { "effect": "4.1.4" }`), and the
  repository pins it exactly (`bun add -d --exact effect@4.1.4`). A Fireflies
  update that moves Effect moves that peer; `just types` then shows the
  mismatch, and the repository bumps its pin with it.
- **The lint.** Its own copy of oxlint.effect.config.ts (this repository's,
  with its `files` patterns: `mod/**`), `@effect/tsgo` and `oxlint-tsgolint`
  at the versions here, anti-slop's `effect/` beside its vendored anti-slop,
  and a second pass in its justfile: `effect-tsgo oxlint --type-aware
  --deny-warnings -c oxlint.effect.config.ts mod` (the whole mod, once
  converted). Its `deterministic-keys` may stay on (its files aren't copies
  in other mods once the copies are libraries).
- **An app older than the libraries.** An app without library modules
  can't resolve `effect` and refuses the whole module graph at load, and the
  person sees at best an error in `status`. So the mod's entry imports
  nothing the app may lack, and brings its code in with `import()` in
  `init`; a refusal becomes a sentence in the pane:

  ```ts
  // main.ts: gpui-kit only; the mod is app.ts, imported when the copy starts.
  export default class K8s extends View {
    app: Entity | null = null;
    missing = "";
    override init(props: Props | undefined, cx: AsyncContext) {
      import("./app.ts").then((m: AppModule) => { this.app = cx.new(m.default, props); cx.notify(); }, (cause: unknown) => {
        this.missing = `Kubernetes needs a newer Fireflies (one that serves effect and @fireflies/kit): ${causeLine(cause)}`;
        cx.notify();
      });
    }
    override render() { return this.app ?? div().p(16).child(this.missing); }
  }
  ```

  Not a top-level `await import(…)`: `herdr-app check` hangs on one. Seen:
  with this entry `herdr-app check` passes on an app from before the
  libraries (integrate's build of 2026-11-16 18:15) and on this branch's;
  the sentence itself wasn't seen in a window. The engine allows `import()`
  on purpose (gpui-shell's sandbox, §18.2).

## The pilot: the usage mod

`defaults/mods/usage` (the pane), `nocturne/usage.ts` (the sidebar's
section), `limits.ts` (in both, byte for byte), `nocturne/fx.ts` (nocturne's
runtime). Behavior and look unchanged; usage/guard.ts is gone (Schema
decodes everything). What a read of it showed, and what closed each:

| weakness | where | now |
|---|---|---|
| A scratch check that failed to run counted as "not a scratch app": a scratch app would then ask with the real login | `scratchApp`: `.catch(() => ({ code: 0 }))` | a check that can't run counts as a scratch app: nothing is asked (test: "a scratch check that can't run…") |
| The record's file ops swallowed every failure: an exec that couldn't run read as "the lock is taken" or "no record", silently, for ever | `fileStep`/`readRecord`: `.catch(() => ({ code: 1 }))` | an `ExecError` becomes the reading's note ("couldn't read · …"), shown, and the next tick tries again |
| Retry-After as an HTTP date was ignored (`Number("Wed, …")` is NaN → 0 → a 5 min back-off instead of the date) | `readUsage` | `Headers.parseRetryAfter`: seconds or a date |
| A body line starting with `@` was taken for curl's trailer and dropped | `lines.filter((l) => !l.startsWith("@"))` | the trailer is cut at the last `\n@code\t` |
| No retry of a transport failure inside a reading: one dropped connection meant a 5-minute back-off | `readUsage` | `policy`: two more attempts after a transport error or a 5xx (1 s, 2 s, jittered); a 429 still goes to the machine's back-off, never retried in place |
| The token sat in a shell script that also printed the plan and the trailer; a parse slip would surface curl's output | `CLAUDE`/`CODEX` scripts | the login check (no token printed) and the headers (to curl's stdin) are separate fragments; the token is never in a process's arguments (test) |
| Reads continued after the pane closed (a `cx.spawn` isn't cancelled by anything) | the views | `fx.close()` interrupts them: the lock's unlock runs as their finalizer |
| `Date.now()` read many times in one render: two countdowns could disagree by a second | the views | one clock read per render |
| An unexpected throw in a read became a rejected promise nobody saw (`cx.spawn` logs it) | the views | `fx.run` reports it as a toast |
| "wasn't in a shape this build reads", with no detail | `READERS` | the same words for the person; a `SchemaError` says where (in a test, or a log) |

Tests: usage-limits (20, three new), usage-poll (8, unchanged
expectations: the requests per simulated hour, the back-off steps, Retry-After)
on the kit's test layers, no `mock.module`. The views' draw tests
(nocturne-usage, and every nocturne test that draws the sidebar) pass as
they were; nocturne-fireglow counted every `cx.timer.after` and now counts
the glow's own.

## The plan for the rest

Refreshed against integrate on 2026-11-16 after the first batch merged
(`bun scripts/effect-survey.ts`, merge a3c57ff). Still out then: chrome-panes
(the browser mod and its native side) and themes' item 3 (a look.ts per mod,
the dither turning flat in plain layouts): the browser conversion waits for
chrome-panes, and every conversion merges integrate once themes' item 3 is in
(a look.ts that lands as a shared copy joins wave 0a).

### Each mod: what it decodes, runs, fetches and times

`bun scripts/effect-survey.ts`: a mod's own .ts files (a file with the same
name and text in two mods or more is a shared copy: counted once, in the
second table), its lines, its guard.ts calls (what it decodes
today), `JSON.parse` outside guards, `exec`/`hc` calls, `fetch`, timers and
sleeps, `cx.spawn`, `catch(() => null)`-like swallows, and what the Effect
lint says of it now (all rules, the five most frequent).

| mod | files | lines | guards | JSON.parse | exec | fetch | timers | spawns | swallowed | Effect lint (top rules) |
|---|---|---|---|---|---|---|---|---|---|---|
| agent-graph | 11 | 2296 | 66 | 0 | 5 | 0 | 3 | 2 | 7 | 408: strict-boolean-expressions 256, prefer-effect-array 89, prefer-effect-string 34, global-date 13, async-function 8 |
| browser | 15 | 2960 | 86 | 0 | 7 | 0 | 10 | 6 | 7 | 475: strict-boolean-expressions 341, prefer-effect-array 86, prefer-effect-string 30, async-function 8, prefer-effect-record 4 |
| databases | 57 | 12481 | 82 | 1 | 44 | 1 | 5 | 2 | 31 | 2639: strict-boolean-expressions 1895, prefer-effect-array 317, prefer-effect-string 283, async-function 65, global-date 36 |
| diff | 1 | 117 | 4 | 0 | 0 | 0 | 1 | 1 | 0 | 15: strict-boolean-expressions 9, global-date 2, global-json 2, async-function 1, prefer-effect-array 1 |
| editor | 44 | 16103 | 57 | 0 | 72 | 0 | 25 | 11 | 26 | 2250: strict-boolean-expressions 1543, prefer-effect-string 392, prefer-effect-array 220, global-date 32, async-function 26 |
| equalize-panes | 2 | 225 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 21: strict-boolean-expressions 11, prefer-effect-array 9, anti-slop-effect(prefer-effect-match) 1 |
| file-tree | 18 | 4789 | 39 | 0 | 9 | 0 | 10 | 13 | 6 | 1000: strict-boolean-expressions 784, prefer-effect-array 102, prefer-effect-string 84, async-function 19, global-date 8 |
| finder | 2 | 1059 | 9 | 0 | 2 | 0 | 3 | 4 | 1 | 129: strict-boolean-expressions 77, prefer-effect-string 27, prefer-effect-array 17, async-function 6, global-date 2 |
| git | 36 | 9190 | 64 | 0 | 23 | 0 | 5 | 7 | 4 | 2187: strict-boolean-expressions 1519, prefer-effect-array 279, prefer-effect-string 267, async-function 83, anti-slop-effect(prefer-effect-match) 15 |
| github | 38 | 12269 | 255 | 0 | 26 | 0 | 9 | 20 | 19 | 2806: strict-boolean-expressions 2044, prefer-effect-array 401, prefer-effect-string 230, async-function 52, global-date 45 |
| markdown | 3 | 954 | 5 | 0 | 3 | 0 | 2 | 4 | 1 | 143: strict-boolean-expressions 98, prefer-effect-array 20, prefer-effect-string 18, async-function 4, global-date 2 |
| nocturne | 59 | 14947 | 235 | 0 | 25 | 0 | 37 | 12 | 29 | 2809: strict-boolean-expressions 1933, prefer-effect-array 495, prefer-effect-string 254, global-date 66, async-function 27 |
| notifications | 13 | 3393 | 101 | 0 | 4 | 0 | 7 | 6 | 3 | 646: strict-boolean-expressions 427, prefer-effect-array 104, prefer-effect-string 87, async-function 11, global-json 7 |
| pip | 3 | 840 | 21 | 0 | 0 | 0 | 4 | 2 | 1 | 133: strict-boolean-expressions 103, prefer-effect-array 18, prefer-effect-string 9, async-function 3 |
| preview | 1 | 108 | 5 | 0 | 0 | 0 | 2 | 0 | 0 | 19: strict-boolean-expressions 19 |
| procs | 19 | 4318 | 39 | 0 | 13 | 0 | 6 | 5 | 3 | 736: strict-boolean-expressions 531, prefer-effect-array 92, prefer-effect-string 82, global-date 12, async-function 8 |
| scripts | 14 | 2776 | 56 | 1 | 13 | 0 | 5 | 4 | 5 | 388: strict-boolean-expressions 196, prefer-effect-string 85, prefer-effect-array 77, global-date 15, prefer-effect-record 8 |
| usage | 2 | 562 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0:  |

| shared file | copies | lines | findings (one copy) |
|---|---|---|---|
| diff.ts | preview, file-tree, editor | 223 | 44 |
| editor-route.ts | markdown, finder, file-tree, editor | 195 | 46 |
| envrc.ts | databases, editor | 298 | 49 |
| file-icons.ts | nocturne, preview, file-tree, editor | 86 | 5 |
| follow.ts | markdown, editor | 100 | 9 |
| form-keys.ts | machine-add, databases, nocturne, github, notifications, editor, git | 255 | 22 |
| guard.ts | databases, markdown, nocturne, agent-graph, diff, procs, pip, browser, equalize-panes, github, finder, scripts, preview, file-tree, notifications, editor, git | 189 | 12 |
| image.ts | preview, file-tree, editor | 515 | 70 |
| keyhelp.ts | databases, markdown, nocturne, agent-graph, usage, procs, pip, browser, github, scripts, preview, file-tree, notifications, editor, git | 265 | 33 |
| keys.ts | preview, file-tree, editor | 87 | 13 |
| kinds.ts | nocturne, preview, file-tree, editor | 436 | 50 |
| limits.ts | nocturne, usage | 692 | 0 |
| markdown-parse.ts | markdown, github, editor | 463 | 150 |
| markdown.ts | markdown, github, editor | 488 | 81 |
| menu-place.ts | databases, nocturne, procs, browser, github, scripts, file-tree, editor, git | 127 | 8 |
| paths.ts | markdown, editor | 85 | 30 |
| scratch.ts | nocturne, editor | 287 | 54 |
| table.ts | databases, preview, file-tree, editor | 274 | 29 |
| tones.ts | databases, markdown, nocturne, agent-graph, diff, usage, procs, pip, browser, equalize-panes, github, finder, scripts, preview, file-tree, notifications, editor, git | 65 | 12 |
| toolground.ts | nocturne, notifications | 77 | 8 |
| viewer-bars.ts | preview, file-tree, editor | 273 | 58 |
| viewer-keys.ts | preview, file-tree, editor | 228 | 28 |
| viewer-load.ts | preview, file-tree, editor | 556 | 120 |
| viewer-native.ts | preview, file-tree, editor | 110 | 10 |
| viewer-pan.ts | preview, file-tree, editor | 190 | 46 |
| viewer-state.ts | preview, file-tree, editor | 251 | 15 |
| viewer-table.ts | preview, file-tree, editor | 342 | 62 |
| viewer-text.ts | preview, file-tree, editor | 244 | 35 |
| viewer-views.ts | preview, file-tree, editor | 203 | 81 |
| viewer.ts | preview, file-tree, editor | 429 | 73 |

In all: about 16,800 findings in the mods' own files, about 1,240 in the
shared copies (one copy each), guard.ts (12) aside, which goes away rather
than being fixed.

What each runs, fetches and keeps, and what a read of it shows to fix in the
conversion (the swallowed errors are each a place to name the failure: a
note, a toast, or a typed fallback with its reason):

| mod | runs | outside data | to fix in the conversion |
|---|---|---|---|
| agent-graph | `sh` (transcript heads/tails, a usage script) | Claude's session JSON and transcripts (JSONL) | 7 swallows in claude.ts: a transcript that can't be read looks like an agent with no history; JSONL decoded line by line with Schema, a bad line skipped and counted |
| browser | `sh`, `ls` | the native web view's answers and events, favicons (`fetch`) | favicons over `fetchClient` + `policy` (GET, idempotent); the native view's events through `decode` |
| databases | `sh` (psql/mysql/sqlite CSV), `security` (secrets), `direnv`, `rm` | connections.json, history files, a `.envrc`, the drivers' CSV, a session over `fetch` | store.ts writes with `.catch(() => null)`: a stale-snapshot refusal (`StaleFile`) silently loses the edit, keep it and say so; `security` failures look like "no password"; CSV decoding into Schema rows; session.ts's `fetch` through `fetchClient` + `policy` (a write is never retried) |
| diff | none | its props | small: props through `decode`; a pilot for a view without IO |
| editor | `sh`, `git`, `sqlite3`, `direnv`, `mkdir`, `rm`; the language servers (JSON-RPC) | editor.open requests, LSP messages, `.envrc`, kept state | lsp-client.ts swallows its root script and its kept env; LSP messages decoded per method (`request(method, schema)`); 2 data timers and 18 spawns become `fx.run` with keys |
| equalize-panes | none | panes | small |
| file-tree | `sh`, `git` (status), `sqlite3` | git status lines, the viewer's loads | tree.ts swallows 4 reads: a folder that can't be listed shows as empty; 20 spawns, 2 data timers |
| finder | `git`, `test` | the folder, the query | small; its picker's search as a keyed `fx.run` (latest wins) |
| git | `git`, `gh`, `sh`, `env`, `powershell.exe` | porcelain output, logs, the graph | 3 data timers and 22 `close` paths: one runtime per copy with `fx.close`; porcelain parsers into Schema-typed rows |
| github | `gh` (REST, GraphQL), `git` | gh's JSON (`gh.ts` `api`/`graphql`/`ghJson` with guards), its cache file | prForm.ts swallows 7 (a failed `gh api` reads as "no branches", "no template"); `gh.ts`'s guards become Schemas one for one (`Read<R, T>` → a decode and a slim function); the cache's re-proof becomes `decode`; its tests already feed fixtures through the guards, keep that against the schemas |
| markdown | `sh` | the file, links | small; shares markdown*.ts and paths/follow with editor |
| nocturne | `sh`, `git`, `test`, `gsettings`, `defaults` | shared keys of every mod, props, the sidebar's records, launchers' mod.json | 8 data timers, 37 timer calls, 28 swallows (kit.ts 3, scripts.ts 3, launchers 2); a mod.json in another shape drops the launcher silently; the sky's `cx.timer.every` loops into `fx.run`; already has `fx.ts` (its runtime) from the pilot |
| notifications | `sh` | agent reports, permission requests (shared) | engine.ts swallows 2; the requests decoded with Schema |
| pip | none | its props, the native player's events | small; events through `decode` |
| preview | `sqlite3`, `sh` | files, sqlite tables, the native views' answers | viewer-load.ts swallows 2 (shared with editor, file-tree) |
| procs | `ps`, `lsof`, `kill`, `sh` | ps/lsof/iostat/vm_stat/netstat text | the text parsers into Schema-typed rows; `kill` through `execOk` with its exit as an error |
| scripts | `sh`, `nix` | package.json scripts, justfiles, `nix flake show` JSON | its `fields` (getOwnPropertyDescriptor walks) become `Schema.Record`; 1 `JSON.parse` outside a guard |

### In waves

A firefly converts its files whole and adds them to `effect_sources`; the
Effect pass on them is the measure of done. Sizes are the mods' own lines
and today's Effect findings (the survey); the shared copies are wave 0's.

**Wave 0: the shared copies become libraries (two fireflies, first).** A
mod can't import another's files, so files two mods need are copied into
each, byte for byte, with a test per file that the copies agree. Library
modules end that: the file moves to `defaults/lib/@fireflies/<name>/`, every
mod imports it by name, the app serves one copy. Each moved library is in
the Effect pass at once (`effect_sources` names `defaults/lib`), so wave 0
converts what it moves: its findings fixed (about 1,240), its IO on the kit's services,
its parsing through Schema. After wave 0 no mod carries a copy, and no later
wave touches another's file.

| firefly | libraries (from → to) | importers | lines | findings |
|---|---|---|---|---|
| 0a | `keyhelp.ts` → `@fireflies/keyhelp`; `form-keys.ts` → `@fireflies/form-keys`; `menu-place.ts` → `@fireflies/menu-place`; `tones.ts` → `@fireflies/tones`; `toolground.ts` → `@fireflies/toolground`; `editor-route.ts` → `@fireflies/editor-route`; `scratch.ts` → `@fireflies/scratch`; `envrc.ts` → `@fireflies/envrc`; `limits.ts` → `@fireflies/usage-limits`; `dividers.ts` (databases', which fireflies-k8s copies) → `@fireflies/dividers`; `layout-look.ts` → `@fireflies/layout-look` (merged after this plan was written) | keyhelp: 15 mods; form-keys: 7 mods and frame/settings, frame/feedback; menu-place: 9 mods; tones: 18 mods; toolground: nocturne, notifications; editor-route: editor, file-tree, finder, markdown; scratch: nocturne, editor; envrc: editor, databases; limits: usage, nocturne; dividers: databases (and fireflies-k8s); layout-look: nocturne and 17 mods, keyhelp, toolground | 2.7k | 241 |
| 0b | `viewer.ts` and `viewer-*.ts`, `kinds.ts`, `image.ts`, `table.ts`, `diff.ts`, `keys.ts`, `file-icons.ts` → `@fireflies/viewer`; `markdown.ts`, `markdown-parse.ts`, `paths.ts`, `follow.ts` → `@fireflies/markdown` | viewer: preview, editor, file-tree (`kinds.ts` and `file-icons.ts` also nocturne, `table.ts` also databases); markdown: editor, github, markdown | 5.6k | 1,009 |

How, for each library:

1. `git mv` the source copy (the one its drift test names as the source) to
   `defaults/lib/@fireflies/<name>/`, `git rm` the other copies. Its own
   imports of sibling files stay relative (`./kinds.ts`) inside one library;
   an import of another library is by name.
2. Beside it a `package.json`: `{"name": "@fireflies/<name>", "private":
   true, "type": "module", "exports": {".": "./index.ts"}}` (more entries for
   more files a mod imports, as the kit's `./live`, `./testing`); `bun
   install` links it (the root package.json's workspaces take
   `defaults/lib/@fireflies/*`). tsc, oxlint, bun and the app then resolve
   the same name.
3. Every importer: `from "./keyhelp.ts"` → `from "@fireflies/keyhelp"`
   (type imports too). Nothing else in the importer changes in wave 0.
4. The tests: a drift test ("every copy is the source byte for byte":
   keyhelp.test.ts, form-keys.test.ts' copies, menu-place.test.ts,
   themes.test.ts (tones.ts), preview-shared.test.ts,
   editor-tabs.test.ts, markdown.test.ts, databases-data.test.ts,
   nocturne-scratchpad.test.ts, nocturne-tab-seam.test.ts,
   usage-limits.test.ts, mods-typescript.test.ts) becomes "no mod carries
   a copy of it"; a test that reads a file's text (form-keys.test.ts,
   nocturne-floatfocus.test.ts) takes the new path; `load()`-style loaders
   that evaluate a file's text with its imports dropped get the library from
   node_modules (`importMod` already loads `@fireflies/*` for real).
5. Assets stay where they are: `file-icons.ts`'s `iconSvg(icon, mod)` keeps
   naming a mod's `icons/` folder (an app path, `mods/<mod>/icons/x.svg`,
   which any mod may name).
6. Convert it: its findings fixed, a `*Schema` for what it decodes
   (viewer-load's native answers, envrc's `direnv export json`, scratch's
   index.json), its `exec`/file reads through the kit's `Exec`/`Files`
   (scratch, envrc, viewer-load), no `catch(() => null)` (viewer-load has 2,
   envrc 3). A library that is UI only (keyhelp, form-keys, toolground) has
   findings to fix and nothing to convert.
7. docs/mods-typescript.md's "Shared copies" table becomes a table of
   libraries.

0a and 0b move different files; some importers import from both (nocturne,
editor), so the two touch different import lines of the same files: the
second to merge merges integrate first. guard.ts doesn't move: each
conversion drops its mod's copy (Schema replaces it), and it is gone with
the last one. Both must merge before wave 1 starts.

**Wave 1 (six fireflies, in parallel, once wave 0 has merged).**

| firefly | mods | lines | findings |
|---|---|---|---|
| nocturne | nocturne | 14.9k | 2,809 |
| github | github | 12.3k | 2,806 |
| databases | databases | 12.5k | 2,639 |
| editor | editor, markdown, finder | 18.1k | 2,522 |
| panes | preview, file-tree, agent-graph, notifications, browser | 13.5k | 2,548 |
| git | git | 9.2k | 2,187 |

(preview is almost all shared code, wave 0b's: 108 lines of its own.
browser waits for chrome-panes; until then the panes firefly does the
other four.)

**fireflies-k8s (its own firefly, wave 2 timing: after wave 0's libraries
exist, in its own repository).** Developer: "k8s too!". 33.9k lines in 79
files under mod/; the Effect pass over it today: 2,049 findings
(strict-boolean-expressions 1,337, prefer-effect-array 432,
prefer-effect-string 186, async-function 28, prefer-effect-record 23,
global-date 19, prefer-effect-match 12, global-json 9, node-builtin-import 2,
global-random 1), 79 of them in its copies.

| what | where | to fix in the conversion |
|---|---|---|
| runs | `kubectl` (kubectl.ts: every call with `--context`, `-n`; `Exec` its seam, 15 s reads), `argocd` (`app diff`, 60 s), `sh` (finding database clients, `command -v argocd`), `hc` (port-forwards as terminals in panes) | `Exec` from the kit replaces its own seam one for one; a kubectl failure is a tagged error with kubectl's last stderr line |
| decodes | kubectl JSON lists and objects (objects.ts `isKList`, guards.ts), the secrets template's tab lines and one secret's base64 values (secrets.ts, its own base64: the engine had no atob then), Argo's Application objects (argo.ts), metrics-server answers, its settings (settings-keep.ts), kept state and handovers in `shared()` (host.ts), edits being tracked (edit.ts) | 143 guard calls become Schemas; base64 through `Buffer` or Effect's `Encoding`; the edits and handovers as `sharedKey`s |
| timers and watches | `cx.timer.every` 500 ms (feeds' tick), 4 s (window beat), 2 s (edited files); feed.ts's own back-off (doubling to 30 s, a slow read waits twice its time) | one `fx.run` per loop with `Schedule.spaced`; feed.ts's back-off as a `Schedule` (`exponential` capped, `modifyDelay` for the slow read); `fx.close()` ends them with the window |
| HTTP | none (kubectl and argocd speak to the clusters) | |
| swallowed | 7 `catch(() => null)` (readTextFile of its settings and of the databases mod, `hc` starting a forward, the clients script, `argocd app diff`): a forward that didn't start, or a settings file it couldn't read, says nothing | each a tagged error shown on its row or the window's note |
| finds other mods | reads `<app home>/mods/databases/…` to know whether Databases is installed | by its command (`commands()` lists `databases.connect`), as docs on optional mods ask, not by a file |

Its copies of shared files, and what replaces each (all from wave 0):

| its copy | state | replaced by |
|---|---|---|
| `guard.ts` | same as Fireflies' | Schema (gone) |
| `form-keys.ts` | same as Fireflies' | `@fireflies/form-keys` |
| `keyhelp.ts` | older (before themes: `t.ansi0` where Fireflies' has `edge(t)`) | `@fireflies/keyhelp` |
| `menu-place.ts` | older (before the menus firefly's `overlayOf`) | `@fireflies/menu-place` |
| `dividers.ts` | older copy of databases' (before themes) | `@fireflies/dividers`: wave 0a moves databases' `dividers.ts` too, since k8s carries it |
| `tones.ts` | none yet (it predates themes) | `@fireflies/tones` |

The copies have already drifted across the two repositories (three of
five): libraries end that, the mod gets what the app serves.

The firefly, in fireflies-k8s: set the repository up as "Mods outside this
repository" says, entry by `import()` as there, then convert as any mod,
done meaning the same (its whole `mod/` in its Effect pass, green).

**Wave 2 (one firefly, as soon as one of wave 1 reports).**

| firefly | mods | lines | findings |
|---|---|---|---|
| small | procs, scripts, pip, diff, equalize-panes | 8.3k | 1,293 |

About 2,500 findings is a firefly's share: wave 1's six are near it.

## What "done" means for a converted mod

- **The full Effect pass is green on it**: its files are in the justfile's
  `effect_sources`, `just lint` (both passes) passes, with every rule on as
  documented here (the two off: `missing-pipeable-signature`,
  `prefer-namespace-import`; the two scoped: `unstable-api-usage` and
  `api-stability-leak` in HTTP boundary files, `deterministic-keys` in
  mods). No per-file or per-line disable in a mod; the only disables in the
  repo are the kit's: the Clock reading `Date.now()`, `localTime` reading
  `new Date`, `HttpLive` calling `fetch`, and http.ts's `pipe` handing
  `arguments` to Effect's own helper, each with its reason. A
  rule that seems wrong for a case goes to the orchestrator, not into a
  comment.
- Its own copy of guard.ts is gone; everything it decodes goes through Schema
  (a `*Schema` per shape, types from `typeof X.Type`).
- It talks to the app through the kit's services; its tests use
  `@fireflies/kit/testing`, no `mock.module` for anything but `gpui-kit`
  and `gpui-base` in draw tests.
- Its views attach in `init`, run through `fx.run`, close with `fx.close()`;
  no `cx.spawn`, no `cx.timer.every` left for data (`.loop`/`.frames` stay
  for animation).
- Its HTTP goes through `policy`.
- No `catch(() => null)`; each failure is a tagged error, handled by tag or
  shown.
- Its weaknesses table, like the pilot's, in its commit message's body or
  this page.
- Its bun tests pass unchanged or stronger; a screenshot matches before.

## Sources

Read in Effect-TS/effect at 3d13d1e (effect 4.1.4), packages/effect/src:
`Effect.ts` (`callback`, `tryPromise`, `retry`, `Retry.Options`), `Scheduler.ts`
(`MixedScheduler`'s setTimeout fallback), `internal/effect.ts`
(`ClockImpl.sleep`, `callbackOptions`' AbortController), `Clock.ts`,
`ManagedRuntime.ts`, `Context.ts`, `Layer.ts`, `Schema.ts` (`TaggedError`,
`fromJsonString`, `decodeUnknownEffect`, `encodeOption`), `Schedule.ts`
(`exponential`, `jittered`, `modifyDelay`), `Random.ts` (the module-level
`TextEncoder`), `http/HttpClient.ts` (`make`, `makeWith`, `retryTransient`,
`timeout`, `isTransientResponse`), `http/HttpClientResponse.ts`,
`http/HttpClientError.ts`, `http/Headers.ts` (`parseRetryAfter`),
`http/HttpBody.ts`, `testing/TestClock.ts`; LLMS.md. Effect-TS/tsgo at
9ada5da: README.md (supported versions, `effect-tsgo oxlint`), docs/README.md
(Oxlint setup), docs/rules/*.md, oxlint-presets/. Effect-TS/language-service
at cb91d70: README.md (TypeScript 7 → @effect/tsgo). dmmulroy/anti-slop at
13909c9: README.md, src/effect/.
