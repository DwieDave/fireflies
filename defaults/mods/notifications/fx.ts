// The notifications mod's runtime (docs/effect-mods.md): the app's services,
// built once; each copy (the bell, the overview, the question dialog)
// attaches in its init and runs its reads, answers and loops through it.

import { Clock } from "effect";
import { modRuntime } from "@fireflies/kit";
import type { Commands, Exec, Files, Hc, Notify, Shared, ViewFx, Workspace } from "@fireflies/kit";
import { Live, toast } from "@fireflies/kit/live";
import type { AsyncContext } from "gpui-kit";

export const runtime = modRuntime(Live);

/** What this mod's effects use of the app. */
export type NotifyApp = Exec | Hc | Files | Shared | Commands | Workspace | Notify;

/** A copy's handle on the runtime. */
export type NotifyFx = ViewFx<NotifyApp>;

/** Attaches a copy (a role's init): its failures as a toast titled Notifications. */
export const attach = (cx: AsyncContext): NotifyFx => runtime.attach(cx, toast("Notifications"));

/** The time now (ms), for a render or a handler: one read per render. */
export const nowMs = (): number => runtime.now(Clock.currentTimeMillis);
