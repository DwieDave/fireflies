// Nocturne's Effect runtime (@fireflies/kit, docs/effect-mods.md): the app's
// services, built once for the mod, and the usage endpoints its sidebar's
// usage section reads (limits.ts). Each part that runs effects attaches in
// its init (`runtime.attach(cx, report)`); a render reads with `runtime.now`.

import { Layer } from "effect";
import { modRuntime } from "@fireflies/kit";
import { Live } from "@fireflies/kit/live";
import { UsageEndpoint } from "./limits.ts";

export const runtime = modRuntime(Layer.provideMerge(UsageEndpoint.layer, Live));
