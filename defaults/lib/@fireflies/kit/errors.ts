// The kit's typed errors: what can go wrong at each boundary the app gives a
// mod, as tagged classes (`Schema.TaggedError`), so a caller handles each by
// its tag (`Effect.catchTag("ExecError", …)`) instead of a thrown string or a
// `catch(() => null)` that hides it.
//
// Every one carries a `message` a person can read: `describe` (runtime.ts)
// shows it in the mod's own way (its `say`, or a toast). Each is branded (its
// second type argument), so one can't stand in for another of the same
// fields. Make one with `X.make({ … })`; `yield* X.make({ … })` fails with it.

import { Array as Arr, Option, Schema, String as Str } from "effect";

/** A program could not be run at all (not found, refused, timed out), or `exec` itself rejected. */
export class ExecError extends Schema.TaggedError<ExecError, { readonly brand: unique symbol }>()("ExecError", {
  command: Schema.String,
  message: Schema.String,
}) {}

/** A program ran and exited with a code the caller doesn't accept. */
export class ExitError extends Schema.TaggedError<ExitError, { readonly brand: unique symbol }>()("ExitError", {
  command: Schema.String,
  code: Schema.Finite,
  stderr: Schema.String,
  message: Schema.String,
}) {}

/** Reading or writing a file failed (not a missing file: that is `Option.none()`). */
export class FileError extends Schema.TaggedError<FileError, { readonly brand: unique symbol }>()("FileError", {
  path: Schema.String,
  message: Schema.String,
}) {}

/** A file changed on disk since it was read: the write was refused, nothing was lost. */
export class StaleFile extends Schema.TaggedError<StaleFile, { readonly brand: unique symbol }>()("StaleFile", {
  path: Schema.String,
  message: Schema.String,
}) {}

/**
 * Data from outside (a program's output, a file, an answer, a command's
 * arguments) wasn't in the shape the mod reads. `what` names the source
 * ("gh pr list", "connections.json"), `message` says where it differed.
 */
export class DecodeError extends Schema.TaggedError<DecodeError, { readonly brand: unique symbol }>()("DecodeError", {
  what: Schema.String,
  message: Schema.String,
}) {}

/** A request's headers script (http.ts `curlClient` `headersFrom`) exited non-zero: nothing was sent. */
export class HeaderScriptExit extends Schema.TaggedError<HeaderScriptExit, { readonly brand: unique symbol }>()("HeaderScriptExit", {
  code: Schema.Finite,
  message: Schema.String,
}) {}

/** curl gave no answer (couldn't connect, timed out): its exit code and what it said. */
export class CurlFailed extends Schema.TaggedError<CurlFailed, { readonly brand: unique symbol }>()("CurlFailed", {
  code: Schema.Finite,
  message: Schema.String,
}) {}

/** The last line of a program's stderr (where it says what went wrong), "" when there is none. */
export const lastLine = (text: string): string => Option.getOrElse(Arr.last(Str.split(Str.trim(text), "\n")), () => "");

/** A caught failure as a line (`cause` is whatever a rejected promise held). */
export const causeMessage = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
