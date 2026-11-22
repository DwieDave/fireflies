// The GitHub window's runtime: the app's services its effects use (programs
// for gh and git, the cache file, shared keys, its commands, notifications),
// built once for every copy of the window. Each copy attaches in `init`
// (main.ts) and runs its reads, its timers and its actions through that
// handle, so closing the copy interrupts them (docs/effect-mods.md, "Running
// effects from a view"). A test gives the window a runtime over the kit's test
// layers instead (main.ts `runtime()`).

import { Clock, Layer, Random, String as Str } from "effect";
import { modRuntime } from "@fireflies/kit";
import type { Commands, Exec, Files, ModRuntime, Notify, Shared, ViewFx, ViewServices } from "@fireflies/kit";
import { CommandsLive, ExecLive, FilesLive, NotifyLive, SharedLive } from "@fireflies/kit/live";

/** What the window's effects use of the app. */
export type GithubApp = Exec | Files | Shared | Commands | Notify;

/** What an effect run from a copy may use: the app's services and the copy's own (redraw). */
export type GithubServices = GithubApp | ViewServices;

/** A copy's handle on the runtime. */
export type GithubFx = ViewFx<GithubApp>;

/** The window's runtime over the app's services. */
export const runtime: ModRuntime<GithubApp> = modRuntime(Layer.mergeAll(ExecLive, FilesLive, SharedLive, CommandsLive, NotifyLive));

/** The time now (ms): one read per render or key, so everything drawn agrees. */
export const nowMs = (): number => runtime.now(Clock.currentTimeMillis);

/** A short random id: the clock's ms and a random part, base 36 (a pane's slot). */
export const randomId = (n: number): string => nowMs().toString(36) + Str.padStart(n, "0")(runtime.now(Random.nextIntBetween(0, 36 ** n)).toString(36));
