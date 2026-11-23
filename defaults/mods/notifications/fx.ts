// The notifications mod's runtime (docs/effect-mods.md): the app's services,
// built once; each copy (the bell, the overview, the question dialog)
// attaches in its init and runs its reads, answers and loops through it.
//
// `hc` and `agents` stand in for the kit's service for herdr-core until it
// has one (the orchestrator's list): each is this one function, so the swap
// is one import.

import { Clock, Effect } from "effect";
import * as herdr from "herdr";
import type { ExecResult } from "herdr";
import { execError, modRuntime } from "@fireflies/kit";
import type { Commands, ExecError, Exec, Files, Notify, Shared, ViewFx, Workspace } from "@fireflies/kit";
import { Live, toast } from "@fireflies/kit/live";
import type { AsyncContext } from "gpui-kit";

export const runtime = modRuntime(Live);

/** What this mod's effects use of the app. */
export type NotifyApp = Exec | Files | Shared | Commands | Workspace | Notify;

/** A copy's handle on the runtime. */
export type NotifyFx = ViewFx<NotifyApp>;

/** Attaches a copy (a role's init): its failures as a toast titled Notifications. */
export const attach = (cx: AsyncContext): NotifyFx => runtime.attach(cx, toast("Notifications"));

/** Runs `hc` (herdr-core, the app's own session) with `args`. */
export const hc = (args: readonly string[]): Effect.Effect<ExecResult, ExecError> =>
  Effect.tryPromise({ try: () => herdr.hc([...args]), catch: execError("hc") });

/** The agents and their places (herdr's agents()). */
export const agents = Effect.sync(() => herdr.agents());

/** The time now (ms), for a render or a handler: one read per render. */
export const nowMs = (): number => runtime.now(Clock.currentTimeMillis);
