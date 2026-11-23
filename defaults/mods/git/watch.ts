// The repo folder's watch as a service: the app's (herdr's watchFolder) in the
// window, a folder that never changes in a test (the kit has no watch of its
// own; reads.ts `watch` asks this one).

import { Context, Effect, Layer } from "effect";
// herdr as a namespace, looked up when the watch runs (as the kit's live services do): a test's stand-in needs no watch.
import * as herdr from "herdr";
import { fileError } from "@fireflies/kit";
import type { FileError } from "@fireflies/kit";

/** The paths that changed under a folder, the next time some do. */
export class FolderWatch extends Context.Service<FolderWatch, {
  readonly next: (root: string) => Effect.Effect<readonly string[], FileError>;
}>()("git/FolderWatch") {}

/** The app's watch. */
export const FolderWatchLive = Layer.succeed(FolderWatch, FolderWatch.of({
  next: (root) => Effect.tryPromise({ try: () => herdr.watchFolder(root), catch: fileError(root) }),
}));

/** A folder that never changes: the next change never comes (a test's). */
export const FolderWatchStill = Layer.succeed(FolderWatch, FolderWatch.of({ next: () => Effect.never }));
