// The git window's runtime: the app's services it runs with (git and gh
// through Exec, its commands, settings.json through Files, the spaces and
// agents through Workspace, the folder watch), built once for every copy.
// Each copy attaches in `init` (`runtime.attach(cx, report)`) and runs its
// reads, actions, folder watch, timers and command loop through that handle;
// `close()` interrupts them all (docs/effect-mods.md, "Running effects from a
// view"). A test gives the window the kit's test layers instead (useServices).

import { Layer } from "effect";
import type { Effect } from "effect";
import { modRuntime } from "@fireflies/kit";
import type { Commands, Exec, Files, ModRuntime, Report, ViewFx, ViewServices, Workspace } from "@fireflies/kit";
import { CommandsLive, ExecLive, FilesLive, WorkspaceLive } from "@fireflies/kit/live";
import type { AsyncContext } from "gpui-kit";
import type { FolderWatch } from "./watch.ts";
import { FolderWatchLive } from "./watch.ts";

/** What the window's effects use of the app. */
export type GitApp = Exec | Commands | Files | Workspace | FolderWatch;

/** What its effects may use: the app's services and the copy's own (redraw). */
export type GitServices = GitApp | ViewServices;

/** A copy's handle on the runtime. */
export type GitFx = ViewFx<GitApp>;

/** The app's services. */
export const GitLive: Layer.Layer<GitApp> = Layer.mergeAll(ExecLive, CommandsLive, FilesLive, WorkspaceLive, FolderWatchLive);

let current: ModRuntime<GitApp> = modRuntime(GitLive);

/** The mod's runtime: every copy attaches to it, a render reads through it. */
export const runtime = {
  attach: (cx: AsyncContext, report: Report): GitFx => current.attach(cx, report),
  now: <A>(effect: Effect.Effect<A, never, GitApp>): A => current.now(effect),
  /** The runtime itself, for running an effect outside any copy (a test's edge). */
  managed: () => current.runtime,
};

/** Copies attached from now on run on `layer`'s services (a test's: the kit's test layers). */
export function useServices(layer: Layer.Layer<GitApp>): void {
  current = modRuntime(layer);
}
