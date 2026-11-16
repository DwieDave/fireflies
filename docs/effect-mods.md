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

**Decision for Developer**: run over the mods not yet converted
(`bun scripts/effect-survey.ts`), "every diagnostic on" finds about
19,000 things: 70 % `strict-boolean-expressions` (`if (x)` on a non-boolean),
25 % `prefer-effect-array` / `prefer-effect-string` (`xs.map(f)` → `Arr.map(xs, f)`,
`s.trim()` → `Str.trim(s)`). The first is real type safety; the second is
mostly style (it matters where it returns an Option: `find`, `indexOf`,
`split`). The pilot meets all of them. If the conversions should skip
`prefer-effect-array`/`-string` for calls that return the same thing either
way, say so before the waves start: it is a quarter of their mechanical work.

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

To be refreshed against integrate once this batch of fireflies has merged
(the table below is integrate as of 2026-11-16, `bun scripts/effect-survey.ts`).

### Each mod: what it decodes, runs, fetches and times

`bun scripts/effect-survey.ts`: a mod's own .ts files (shared copies are
listed under them, below), its lines, its guard.ts calls (what it decodes
today), `JSON.parse` outside guards, `exec`/`hc` calls, `fetch`, timers and
sleeps, `cx.spawn`, `catch(() => null)`-like swallows, and what the Effect
lint says of it now (all rules, the five most frequent).

| mod | files | lines | guards | JSON.parse | exec | fetch | timers | spawns | swallowed | Effect lint (top rules) |
|---|---|---|---|---|---|---|---|---|---|---|
| agent-graph | 11 | 2288 | 66 | 0 | 5 | 0 | 3 | 2 | 7 | 408: strict-boolean-expressions 256, prefer-effect-array 89, prefer-effect-string 34, global-date 13, async-function 8 |
| browser | 15 | 2900 | 85 | 0 | 7 | 0 | 10 | 6 | 7 | 471: strict-boolean-expressions 339, prefer-effect-array 84, prefer-effect-string 30, async-function 8, prefer-effect-record 4 |
| databases | 57 | 12213 | 78 | 1 | 43 | 1 | 5 | 2 | 30 | 2550: strict-boolean-expressions 1823, prefer-effect-array 314, prefer-effect-string 271, async-function 64, global-date 36 |
| diff | 1 | 116 | 4 | 0 | 0 | 0 | 1 | 1 | 0 | 15: strict-boolean-expressions 9, global-date 2, global-json 2, async-function 1, prefer-effect-array 1 |
| editor | 53 | 17912 | 73 | 0 | 72 | 0 | 29 | 18 | 28 | 2572: strict-boolean-expressions 1788, prefer-effect-string 425, prefer-effect-array 239, async-function 47, global-date 32 |
| equalize-panes | 2 | 224 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 21: strict-boolean-expressions 11, prefer-effect-array 9, anti-slop-effect(prefer-effect-match) 1 |
| file-tree | 29 | 7720 | 55 | 0 | 13 | 0 | 15 | 20 | 8 | 1565: strict-boolean-expressions 1238, prefer-effect-string 139, prefer-effect-array 128, async-function 40, global-date 11 |
| finder | 2 | 1042 | 9 | 0 | 2 | 0 | 3 | 4 | 1 | 129: strict-boolean-expressions 77, prefer-effect-string 27, prefer-effect-array 17, async-function 6, global-date 2 |
| git | 34 | 9014 | 64 | 0 | 23 | 0 | 5 | 7 | 4 | 2163: strict-boolean-expressions 1499, prefer-effect-array 275, prefer-effect-string 267, async-function 83, anti-slop-effect(prefer-effect-match) 15 |
| github | 37 | 12188 | 255 | 0 | 26 | 0 | 9 | 20 | 19 | 2785: strict-boolean-expressions 2026, prefer-effect-array 398, prefer-effect-string 230, async-function 52, global-date 45 |
| markdown | 2 | 908 | 5 | 0 | 3 | 0 | 2 | 4 | 1 | 143: strict-boolean-expressions 98, prefer-effect-array 20, prefer-effect-string 18, async-function 4, global-date 2 |
| nocturne | 59 | 14747 | 231 | 0 | 25 | 0 | 37 | 12 | 28 | 2772: strict-boolean-expressions 1902, prefer-effect-array 494, prefer-effect-string 253, global-date 64, async-function 25 |
| notifications | 13 | 3388 | 101 | 0 | 4 | 0 | 7 | 6 | 3 | 646: strict-boolean-expressions 427, prefer-effect-array 104, prefer-effect-string 87, async-function 11, global-json 7 |
| pip | 3 | 838 | 21 | 0 | 0 | 0 | 4 | 2 | 1 | 133: strict-boolean-expressions 103, prefer-effect-array 18, prefer-effect-string 9, async-function 3 |
| preview | 12 | 2976 | 19 | 0 | 4 | 0 | 6 | 7 | 2 | 549: strict-boolean-expressions 442, prefer-effect-string 54, prefer-effect-array 26, async-function 21, anti-slop-effect(prefer-effect-match) 4 |
| procs | 19 | 4305 | 39 | 0 | 13 | 0 | 6 | 5 | 3 | 736: strict-boolean-expressions 531, prefer-effect-array 92, prefer-effect-string 82, global-date 12, async-function 8 |
| scripts | 13 | 2604 | 56 | 1 | 13 | 0 | 5 | 4 | 5 | 358: strict-boolean-expressions 171, prefer-effect-string 83, prefer-effect-array 74, global-date 15, prefer-effect-record 8 |
| usage | 2 | 561 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0:  |

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

A firefly converts its mods whole, adds them to `effect_sources`, and never
edits a shared copy it doesn't own: the owner converts it and copies it over
the others (as docs/mods-typescript.md says), the others merge integrate.
Sizes are lines of the mod's own files.

| wave | firefly | mods | lines | owns (shared copies) | waits for |
|---|---|---|---|---|---|
| 1 | databases | databases | 12.2k | envrc.ts | |
| 1 | github | github | 12.2k | | |
| 1 | git | git | 9.0k | | |
| 1 | nocturne | nocturne | 14.7k | scratch.ts, toolground.ts | |
| 1 | small-a | procs, scripts, pip, diff, equalize-panes | 8.0k | | |
| 1 | small-b | agent-graph, notifications, browser | 8.6k | | |
| 2 | viewers | preview, file-tree | 10.7k | viewer*.ts, kinds.ts, image.ts, table.ts, diff.ts, keys.ts, file-icons.ts | wave 1 merged |
| 2 | editor | editor, markdown, finder | 19.9k | markdown*.ts, paths.ts, follow.ts, editor-route.ts | wave 1 merged; takes envrc.ts from databases and scratch.ts from nocturne as copies |

Six in wave 1 share no file. Wave 2's two share the viewer copies: the
editor firefly takes them from viewers' branch, never edits them.

**Ending the shared copies.** Library modules end them: a shared copy moves
to `defaults/lib/@fireflies/<name>` and its importers import it by name
(`@fireflies/keyhelp`, `@fireflies/form-keys`): one file, no drift test,
one evaluation. guard.ts needs no move: each conversion drops its copy
(Schema replaces it), and it goes when the last mod does. The rest
(keyhelp.ts in 15 mods, form-keys.ts in 9, editor-route.ts, file-icons.ts,
…) move in one mechanical commit by one firefly *before* wave 1 (wave 0:
import lines in every mod, and the tests that read their text: form-keys.test.ts,
keyhelp.test.ts): after it, no wave touches a copy. A shared file that is
a mod's own logic stays with that mod.


## What "done" means for a converted mod

- Its files are in the justfile's `effect_sources`; both lint passes clean.
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
