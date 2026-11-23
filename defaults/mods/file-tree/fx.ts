// The files pane's runtime (docs/effect-mods.md): the app's services, built
// once; each copy attaches in its init and runs its reads, file operations,
// watch and command loop through it. The app calls the kit has no service
// for (the folder watch, the file search) are wrapped here, at the edge.

import { Clock, Effect } from "effect";
import * as herdr from "herdr";
import { fileError, modRuntime } from "@fireflies/kit";
import type { Commands, Exec, FileError, Files, Shared, ViewFx, Workspace } from "@fireflies/kit";
import { Live, toast } from "@fireflies/kit/live";
import type { AsyncContext } from "gpui-kit";

export const runtime = modRuntime(Live);

/** What this mod's effects use of the app. */
export type FilesApp = Exec | Files | Shared | Commands | Workspace;

/** A copy's handle on the runtime. */
export type FilesFx = ViewFx<FilesApp>;

/** Attaches a copy (its init): its failures as a toast titled Files. */
export const attach = (cx: AsyncContext): FilesFx => runtime.attach(cx, toast("Files"));

/** The time now (ms), for a render or a handler. */
export const nowMs = (): number => runtime.now(Clock.currentTimeMillis);

/** The paths that changed under `root`, the next time some do (the app's watch; interrupted: cancelled). */
export const nextChange = (root: string): Effect.Effect<readonly string[], FileError> =>
  Effect.tryPromise({ try: () => herdr.watchFolder(root), catch: fileError(root) });

/** The app's file search under `root`. */
export type Found = Awaited<ReturnType<typeof herdr.findFiles>>;

export const findFiles = (root: string, query: string, limit: number): Effect.Effect<Found, FileError> =>
  Effect.tryPromise({ try: () => herdr.findFiles(root, query, { limit }), catch: fileError(root) });
