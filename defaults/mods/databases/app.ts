// The Databases window's runtime (docs/effect-mods.md): the app's services it
// works with (programs, herdr-core, files, shared state, commands, the window) and its
// libSQL endpoint (fx.ts). Built once; each copy attaches in `init` and runs
// its reads, its loops and its saves through that handle, and `close()`
// interrupts them.

import { Clock, Effect, Layer, Option } from "effect";
import * as herdr from "herdr";
import type { AsyncContext } from "gpui-kit";
import { modRuntime } from "@fireflies/kit";
import type { Commands, Exec, Files, Hc, ModRuntime, Report, Shared, ViewFx, ViewServices, Workspace } from "@fireflies/kit";
import { CommandsLive, ExecLive, FilesLive, HcLive, HttpLive, SharedLive, WorkspaceLive } from "@fireflies/kit/live";
import { Libsql, Pickers } from "./fx.ts";

/** herdr's pickers (they don't reject: a cancel is null). */
const PickersLive = Layer.succeed(Pickers, Pickers.of({
  file: (prompt) => Effect.map(Effect.promise(() => herdr.pickFile({ prompt })), Option.fromNullOr),
  folder: (prompt) => Effect.map(Effect.promise(() => herdr.pickFolder({ prompt })), Option.fromNullOr),
}));

/** What the window's effects use of the app. */
export type DbApp = Exec | Hc | Files | Shared | Commands | Workspace | Libsql | Pickers;

/** What an effect run from a copy may use: the app's services and the copy's own (redraw). */
export type DbRun = DbApp | ViewServices;

/** A copy's handle on the runtime. */
export type DbFx = ViewFx<DbApp>;

/** The app's services. */
export const appLayer: Layer.Layer<DbApp> = Layer.mergeAll(ExecLive, HcLive, FilesLive, SharedLive, CommandsLive, WorkspaceLive, PickersLive, Layer.provide(Libsql.layer, HttpLive));

let current: ModRuntime<DbApp> = modRuntime(appLayer);

/** The mod's runtime: every copy attaches to it, a render reads through it. */
export const runtime = {
  attach: (cx: AsyncContext, report: Report): DbFx => current.attach(cx, report),
  now: <A>(effect: Effect.Effect<A, never, DbApp>): A => current.now(effect),
  /** The runtime itself, for running an effect outside any copy (a close's last save, a test's edge). */
  managed: () => current.runtime,
};

/** Copies attached from now on run on `layer`'s services (a test's: the kit's test layers). */
export function useServices(layer: Layer.Layer<DbApp>): void {
  current = modRuntime(layer);
}

/** The clock's now, for code outside an effect (a key's note, a render): the runtime's Clock. */
export const nowMs = (): number => runtime.now(Clock.currentTimeMillis);

// ---- the app's calls the kit has no service for yet (one function each: the swap is one import)

/** The system's file picker: the path, or none when cancelled. */
export const pickFile = (prompt: string): Effect.Effect<Option.Option<string>, never, Pickers> => Pickers.use((p) => p.file(prompt));

/** The system's folder picker: the path, or none when cancelled. */
export const pickFolder = (prompt: string): Effect.Effect<Option.Option<string>, never, Pickers> => Pickers.use((p) => p.folder(prompt));
