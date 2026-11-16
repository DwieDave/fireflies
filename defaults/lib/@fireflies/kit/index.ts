// @fireflies/kit: what a mod written with Effect stands on (docs/effect-mods.md).
//
//   import { modRuntime, Exec, Shared, sharedKey, decodeJson, policy } from "@fireflies/kit";
//   import { Live, toast } from "@fireflies/kit/live";        // the app's services (imports herdr)
//   import { execTest, sharedTest, … } from "@fireflies/kit/testing";   // bun tests
//
// This entry imports nothing from the app at run time, so a test loads it as it is.
// engine-globals.d.ts (the web types Effect's declarations name) comes in with
// the tsconfig that checks a mod (defaults/tsconfig.json includes lib/).

export * from "./errors.ts";

export * from "./schema.ts";

export * from "./services.ts";

export * from "./runtime.ts";

export * from "./http.ts";
