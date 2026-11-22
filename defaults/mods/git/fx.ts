// The git window's runtime: the app's services it runs with (git and gh
// through Exec, its commands), built once for every copy. Each copy attaches
// in `init` (`runtime.attach(cx, report)`) and runs its reads, actions,
// folder watch, timers and command loop through that handle; `close()`
// interrupts them all (docs/effect-mods.md, "Running effects from a view").

import { Layer } from "effect";
import { modRuntime } from "@fireflies/kit";
import type { Commands, Exec, ViewFx, ViewServices } from "@fireflies/kit";
import { CommandsLive, ExecLive } from "@fireflies/kit/live";

/** What the window's effects use of the app. */
export type GitApp = Exec | Commands;

/** What its effects may use: the app's services and the copy's own (redraw). */
export type GitServices = GitApp | ViewServices;

/** A copy's handle on the runtime. */
export type GitFx = ViewFx<GitApp>;

export const runtime = modRuntime(Layer.mergeAll(ExecLive, CommandsLive));
