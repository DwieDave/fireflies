// The services over the app (`herdr`): what a mod's runtime is made of in
// the app. A test provides testing.ts's layers instead.
//
// `herdr` is imported as a namespace and each function looked up when it is
// called: a test that stands in for `herdr` with only the functions it needs
// (most of the bun tests) still loads a mod built on this file.

import { Effect, Layer } from "effect";
import { HttpClient } from "effect/http";
import * as herdr from "herdr";
import { fetchClient } from "./http.ts";
import { readSharedOption, writeShared } from "./schema.ts";
import { Commands, Exec, Files, Notify, Shared, Workspace, execService, filesService } from "./services.ts";

export const ExecLive = Layer.succeed(Exec, execService((command, args, options) => herdr.exec(command, args, options)));

export const FilesLive = Layer.succeed(Files, filesService((path) => herdr.readTextFile(path), (path, text, expected) => herdr.writeTextFile(path, text, expected)));

export const SharedLive = Layer.succeed(Shared, Shared.of({
  get: (key) => Effect.sync(() => readSharedOption(herdr.shared, key)),
  set: (key, value) => Effect.sync(() => writeShared(herdr.setShared, key, value)),
}));

export const CommandsLive = Layer.succeed(Commands, Commands.of({
  run: (name, args) => Effect.sync(() => { herdr.run(name, args ?? {}); }),
  next: Effect.promise(() => herdr.nextCommand()),
}));

export const WorkspaceLive = Layer.succeed(Workspace, Workspace.of({
  window: Effect.sync(() => herdr.window()),
  spaces: Effect.sync(() => herdr.spaces()),
  panes: Effect.sync(() => herdr.panes()),
  terminals: Effect.sync(() => herdr.terminals()),
  settings: Effect.sync(() => herdr.settings()),
}));

export const NotifyLive = Layer.succeed(Notify, Notify.of({
  post: (note) => Effect.sync(() => { herdr.notify(note); }),
}));

/** Effect's HttpClient over the engine's fetch (http.ts `policy` for timeouts and retries). */
// This is the HttpClient: the engine's fetch is what it sends with.
// oxlint-disable-next-line effecttsgo/global-fetch
export const HttpLive = Layer.succeed(HttpClient.HttpClient, fetchClient((url, init) => fetch(url, init)));

/** Everything the app gives a mod. */
export const Live = Layer.mergeAll(ExecLive, FilesLive, SharedLive, CommandsLive, WorkspaceLive, NotifyLive, HttpLive);

/** A copy's failures as toasts titled by the mod (when it has no line of its own to say them on). */
export const toast = (title: string) => (message: string) => { herdr.notify({ title, body: message, level: "error" }); };
