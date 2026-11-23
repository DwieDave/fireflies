// The Databases window's runtime (docs/effect-mods.md): the app's services it
// works with (programs, files, shared state, commands, the window) and its
// libSQL endpoint (fx.ts). Built once; each copy attaches in `init` and runs
// its reads, its loops and its saves through that handle, and `close()`
// interrupts them.

import { Clock, Effect, Layer, Option } from "effect";
import * as herdr from "herdr";
import type { ExecResult } from "herdr";
import { ExecError, causeMessage, modRuntime } from "@fireflies/kit";
import type { Commands, Exec, Files, Shared, ViewFx, ViewServices, Workspace } from "@fireflies/kit";
import { CommandsLive, ExecLive, FilesLive, HttpLive, SharedLive, WorkspaceLive } from "@fireflies/kit/live";
import { Libsql } from "./fx.ts";

/** What the window's effects use of the app. */
export type DbApp = Exec | Files | Shared | Commands | Workspace | Libsql;

/** What an effect run from a copy may use: the app's services and the copy's own (redraw). */
export type DbRun = DbApp | ViewServices;

/** A copy's handle on the runtime. */
export type DbFx = ViewFx<DbApp>;

/** The services a test gives instead (kit/testing's layers, and a fake Libsql). */
export const appLayer = Layer.mergeAll(ExecLive, FilesLive, SharedLive, CommandsLive, WorkspaceLive, Layer.provide(Libsql.layer, HttpLive));

export const runtime = modRuntime(appLayer);

/** The clock's now, for code outside an effect (a key's note, a render): the runtime's Clock. */
export const nowMs = (): number => runtime.now(Clock.currentTimeMillis);

// ---- the app's calls the kit has no service for yet (one function each: the swap is one import)

/** herdr-core's command line (`hc`): its answer, or an `ExecError` when it couldn't run. */
export const hcRun = (args: readonly string[]): Effect.Effect<ExecResult, ExecError> =>
  Effect.tryPromise({ try: () => herdr.hc([...args]), catch: (cause) => ExecError.make({ command: "hc", message: causeMessage(cause) }) });

/** The system's file picker: the path, or none when cancelled. */
export const pickFile = (prompt: string): Effect.Effect<Option.Option<string>> =>
  Effect.map(Effect.promise(() => herdr.pickFile({ prompt })), Option.fromNullOr);

/** The system's folder picker: the path, or none when cancelled. */
export const pickFolder = (prompt: string): Effect.Effect<Option.Option<string>> =>
  Effect.map(Effect.promise(() => herdr.pickFolder({ prompt })), Option.fromNullOr);
