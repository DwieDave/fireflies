// The agent graph's runtime (docs/effect-mods.md): the app's services, built
// once; each copy attaches in its init and runs its poll, its commands and
// its asks through it.

import { Clock } from "effect";
import { modRuntime } from "@fireflies/kit";
import type { Commands, Exec, Files, Hc, Shared, ViewFx, Workspace } from "@fireflies/kit";
import { Live, toast } from "@fireflies/kit/live";
import type { AsyncContext } from "gpui-kit";

export const runtime = modRuntime(Live);

/** What this mod's effects use of the app. */
export type AgentsApp = Exec | Files | Hc | Shared | Commands | Workspace;

/** A copy's handle on the runtime. */
export type AgentsFx = ViewFx<AgentsApp>;

/** Attaches a copy (its init): its failures as a toast titled Agents. */
export const attach = (cx: AsyncContext): AgentsFx => runtime.attach(cx, toast("Agents"));

/** The time now (ms), for a render or a handler: one read per render. */
export const nowMs = (): number => runtime.now(Clock.currentTimeMillis);
