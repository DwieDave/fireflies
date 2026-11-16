// The viewer's runtime: the app's services it reads and runs with (programs,
// files, its pane's commands), built once per window. Each viewer attaches
// to it in `init` (`runtime.attach(cx, report)`) and runs its reads, its
// folder watch, its polls and its loops through that handle
// (docs/effect-mods.md, "Running effects from a view").

import { Layer } from "effect";
import { modRuntime } from "@fireflies/kit";
import type { Commands, Exec, Files, ViewFx, ViewServices } from "@fireflies/kit";
import { CommandsLive, ExecLive, FilesLive } from "@fireflies/kit/live";

/** What a viewer's effects use of the app. */
export type ViewerApp = Exec | Files | Commands;

/** What a viewer's effects may use: the app's services and the copy's own (redraw). */
export type ViewerServices = ViewerApp | ViewServices;

/** A viewer's handle on the runtime. */
export type ViewerFx = ViewFx<ViewerApp>;

export const runtime = modRuntime(Layer.mergeAll(ExecLive, FilesLive, CommandsLive));
