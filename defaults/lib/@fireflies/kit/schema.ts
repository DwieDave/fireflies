// Decoding what comes from outside with Schema: a program's output, a file,
// an HTTP body, `shared()`, a command's arguments. One schema per shape, its
// type taken from it (`typeof Usage.Type`), so the two can't drift; a value
// of another shape is a typed `DecodeError` naming its source, never a value
// of the wrong type and never a silent `null`.
//
// This replaces guard.ts's `object(…)` / `isString` guards for converted
// code: `Schema.Struct({ … })` for `object(required, optional)`,
// `Schema.optionalKey(x)` for an optional field, `Schema.NullOr(x)` for
// `nullable(x)`, `Schema.Literals([...])` for `literal(...)`.

import { Effect, flow, Option, Schema } from "effect";
import type { setShared, shared } from "herdr";
import { DecodeError } from "./errors.ts";

/** A schema the kit can decode with: no services needed to decode or encode. */
export type Codec<A, I = A> = Schema.Codec<A, I, never, never>;

/** The schema's error as one line (where in the value it differed, and how). */
const said = (error: Schema.SchemaError): string => error.message;

/** The schema's failure as a `DecodeError` naming the source. */
const named = (what: string) => Effect.mapError((error: Schema.SchemaError) => DecodeError.make({ what, message: said(error) }));

/**
 * Decodes a value from outside (`shared()`, a native view's answer, a
 * command's arguments) with `schema`; another shape fails with a
 * `DecodeError` naming `what`. The input is whatever the app handed over:
 * this is the one place it is looked at.
 */
export const decode = <A, I>(schema: Codec<A, I>, what: string) => flow(Schema.decodeUnknownEffect(schema), named(what));

/** Parses `text` as JSON and decodes it with `schema` (bad JSON is a `DecodeError` too). */
export const decodeJson = <A, I>(schema: Codec<A, I>, what: string): ((text: string) => Effect.Effect<A, DecodeError>) =>
  flow(Schema.decodeUnknownEffect(Schema.fromJsonString(schema)), named(what));

/** `decodeJson` for a render or a fallback: the value, or `Option.none()` for anything else. */
export const decodeJsonOption = <A, I>(schema: Codec<A, I>) => {
  const run = Schema.decodeUnknownOption(Schema.fromJsonString(schema));

  return (text: string): Option.Option<A> => run(text);
};

/** Encodes `value` with `schema` as JSON text (for a file, a program's input, an HTTP body). */
export const encodeJson = <A, I>(schema: Codec<A, I>, what: string): ((value: A) => Effect.Effect<string, DecodeError>) =>
  flow(Schema.encodeEffect(Schema.fromJsonString(schema)), named(what));

// ---- shared(): typed keys

/**
 * A `shared()` key and the schema of its value. Read with `readShared` (in a
 * render) or the `Shared` service (in an effect); a value another mod or an
 * older version wrote in another shape reads as absent, never as a wrong one.
 */
export interface SharedKey<A, I = A> {
  readonly name: string;
  readonly schema: Codec<A, I>;
}

export const sharedKey = <A, I>(name: string, schema: Codec<A, I>): SharedKey<A, I> => ({ name, schema });

/** The key's value; none when absent or of another shape. `read` is herdr's `shared`. */
export function readSharedOption<A, I>(read: typeof shared, key: SharedKey<A, I>): Option.Option<A> {
  return Schema.decodeUnknownOption(key.schema)(read(key.name));
}

/** The key's value, or `fallback` when absent or of another shape. `read` is herdr's `shared`. */
export function readShared<A, I>(read: typeof shared, key: SharedKey<A, I>, fallback: A): A {
  return Option.getOrElse(readSharedOption(read, key), () => fallback);
}

/**
 * Writes the key's value, encoded with its schema. `write` is herdr's
 * `setShared`. A value its own schema can't encode (a refined field out of
 * range) isn't written: false.
 */
export function writeShared<A, I>(write: typeof setShared, key: SharedKey<A, I>, value: A): boolean {
  return Option.match(Schema.encodeOption(key.schema)(value), {
    onNone: () => false,
    onSome: (encoded) => {
      write(key.name, encoded);

      return true;
    },
  });
}
