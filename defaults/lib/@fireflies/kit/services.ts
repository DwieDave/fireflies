// What the app gives a mod, as Effect services: each one a small interface
// with a live layer (live.ts, over the `herdr` module) and a test layer
// (testing.ts, in memory). Code that runs a program, reads a file or a
// shared key asks for the service (`yield* Exec`) instead of importing
// `herdr`, so a bun test provides the test layer instead of mocking the
// module, and the type of an effect lists what it touches.
//
// This file imports `herdr` for types only: it loads in any test.

import { Context, Effect, Option } from "effect";
import type { Settings, panes, spaces, terminals, window as appWindow, ExecResult } from "herdr";
import { ExecError, ExitError, FileError, StaleFile, causeMessage, lastLine } from "./errors.ts";
import type { DecodeError } from "./errors.ts";
import { decodeJson } from "./schema.ts";
import type { Codec, SharedKey } from "./schema.ts";

// ---- programs

/** `exec`'s options: the folder, the machine (a space's `machine`), the timeout in ms (30 s by default, 10 min at most). */
export interface ExecOptions {
  readonly cwd?: string;
  readonly on?: string | null;
  readonly timeout?: number;
}

/** Runs programs with the person's environment (`herdr` `exec`). */
export class Exec extends Context.Service<Exec, {
  /** Runs `command`: its exit code and output, whatever the code; `ExecError` when it couldn't run. */
  readonly run: (command: string, args: readonly string[], options?: ExecOptions) => Effect.Effect<ExecResult, ExecError>;
}>()("@fireflies/kit/services/Exec") {}

/** Runs `command` and asks for exit 0: its stdout, or an `ExitError` with its stderr. */
export const execOk = Effect.fnUntraced(function* (command: string, args: readonly string[], options?: ExecOptions) {
  const exec = yield* Exec;
  const r = yield* exec.run(command, args, options);

  if (r.code !== 0) {
    const said = lastLine(r.stderr);

    return yield* ExitError.make({ command, code: r.code, stderr: r.stderr, message: said === "" ? `${command} exited ${r.code}` : said });
  }

  return r.stdout;
});

/** Runs `command`, asks for exit 0 and decodes its stdout as JSON with `schema`. */
export const execJson = <A, I>(schema: Codec<A, I>, what: string) => {
  const read = decodeJson(schema, what);

  return (command: string, args: readonly string[], options?: ExecOptions): Effect.Effect<A, ExecError | ExitError | DecodeError, Exec> =>
    Effect.flatMap(execOk(command, args, options), read);
};

// ---- files

/** UTF-8 text files (`herdr` `readTextFile` / `writeTextFile`). */
export class Files extends Context.Service<Files, {
  /** The file's text, `Option.none()` when there is none. */
  readonly read: (path: string) => Effect.Effect<Option.Option<string>, FileError>;
  /**
   * Writes `text` only if the file still holds `expected` (`null`: only if
   * there is none yet); `StaleFile` when someone changed it since.
   */
  readonly write: (path: string, text: string, expected: string | null) => Effect.Effect<void, FileError | StaleFile>;
}>()("@fireflies/kit/services/Files") {}

// ---- shared state

/** `shared()` keys, read and written through their schemas (schema.ts `sharedKey`). */
export class Shared extends Context.Service<Shared, {
  /** The key's value; `Option.none()` when absent or written in another shape. */
  readonly get: <A, I>(key: SharedKey<A, I>) => Effect.Effect<Option.Option<A>>;
  /** Sets the key's value (every mod redraws). */
  readonly set: <A, I>(key: SharedKey<A, I>, value: A) => Effect.Effect<void>;
}>()("@fireflies/kit/services/Shared") {}

/** The key's value, or `fallback`. */
export const sharedOr = <A, I>(key: SharedKey<A, I>, fallback: A) =>
  Effect.map(Shared.use((s) => s.get(key)), Option.getOrElse(() => fallback));

// ---- the app

/** A command's arguments (`run(name, args)`): a type-literal alias, as `run` takes. */
export type CommandArgs = { readonly [name: string]: string | number | boolean | null | undefined };

/** The app's commands, and this mod's own (`nextCommand`). */
export class Commands extends Context.Service<Commands, {
  /** Runs an app or mod command (`herdr` `run`). */
  readonly run: (name: string, args?: CommandArgs) => Effect.Effect<void>;
  /** The next key command for this mod ("usage.refresh"), waiting for it. */
  readonly next: Effect.Effect<string>;
}>()("@fireflies/kit/services/Commands") {}

/** What the window shows: read when asked, never kept (each read is the current state). */
export class Workspace extends Context.Service<Workspace, {
  readonly window: Effect.Effect<ReturnType<typeof appWindow>>;
  readonly spaces: Effect.Effect<ReturnType<typeof spaces>>;
  readonly panes: Effect.Effect<ReturnType<typeof panes>>;
  /** herdr-core's listing: decode the fields you read (it isn't typed). */
  readonly terminals: Effect.Effect<ReturnType<typeof terminals>>;
  readonly settings: Effect.Effect<Settings>;
}>()("@fireflies/kit/services/Workspace") {}

/** A notification (the toast mod; the system's notification centre while the window is behind). */
export interface Note {
  readonly title: string;
  readonly body?: string;
  readonly level?: "info" | "success" | "warning" | "error";
}

export class Notify extends Context.Service<Notify, {
  readonly post: (note: Note) => Effect.Effect<void>;
}>()("@fireflies/kit/services/Notify") {}

/** Failures a live layer builds from a rejected promise. */
export const execError = (command: string) => (cause: unknown) => ExecError.make({ command, message: causeMessage(cause) });

export const fileError = (path: string) => (cause: unknown) => FileError.make({ path, message: causeMessage(cause) });

/** A write's rejection: the app refuses a stale snapshot with a message that says so. */
export const writeError = (path: string) => (cause: unknown) => {
  const message = causeMessage(cause);

  return /stale|changed|expected/i.test(message) ? StaleFile.make({ path, message }) : FileError.make({ path, message });
};
