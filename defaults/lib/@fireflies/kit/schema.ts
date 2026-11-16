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

import { Array as Arr, Effect, flow, Option, Record as Rec, Schema, SchemaParser, SchemaTransformation } from "effect";
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

// ---- lists and maps read entry by entry

/** What `listOf` and `mapOf` decode from: any list, any object, its entries looked at one by one. */
const Entries = Schema.Array(Schema.Unknown);
const Fields = Schema.Record(Schema.String, Schema.Unknown);

/**
 * A list of `item`s where an entry of another shape is left out, not the
 * whole list: what another mod appends to (shared keys, a JSON file). A value
 * that isn't a list fails as usual. Encoding encodes each entry with `item`.
 *
 *   const SPACE_ROWS = sharedKey("nocturne.space-rows", listOf(SpaceRow));
 *   readShared(shared, SPACE_ROWS, [])   // guard.ts readSharedList
 */
export const listOf = <A, I>(item: Codec<A, I>): Codec<readonly A[], typeof Entries.Encoded> => {
  const keep = Schema.decodeUnknownOption(item);
  const encode = SchemaParser.encodeEffect(item);

  return Entries.pipe(Schema.decodeTo(Schema.Array(Schema.toType(item)), SchemaTransformation.transformEffect({
    decode: (entries) => Effect.succeed<readonly A[]>(Arr.getSomes(Arr.map(entries, (e) => keep(e)))),
    encode: (values) => Effect.forEach(values, (value) => encode(value), { concurrency: 1 }),
  })));
};

/**
 * An object keyed by data (slots, paths, machines), read as a Map of
 * `entry`s; an entry of another shape is left out, not the whole map. A
 * value that isn't an object fails as usual. Encoded as an object again.
 *
 *   const TOLD = sharedKey("scripts.told", mapOf(Schema.Finite));
 *   readShared(shared, TOLD, new Map())          // guard.ts readSharedMap
 *   writeShared(setShared, TOLD, new Map(told))  // guard.ts writeSharedMap
 *   decodeJsonOption(mapOf(Entry))(text)         // guard.ts parseJsonMap
 */
export const mapOf = <A, I>(entry: Codec<A, I>): Codec<ReadonlyMap<string, A>, typeof Fields.Encoded> => {
  const keep = Schema.decodeUnknownOption(entry);
  const encode = SchemaParser.encodeEffect(entry);

  return Fields.pipe(Schema.decodeTo(Schema.ReadonlyMap(Schema.String, Schema.toType(entry)), SchemaTransformation.transformEffect({
    decode: (record) => Effect.sync((): ReadonlyMap<string, A> => {
      const out = new Map<string, A>();

      for (const [key, value] of Rec.toEntries(record)) Option.map(keep(value), (a) => out.set(key, a));

      return out;
    }),
    encode: (map) => Effect.map(Effect.forEach(map, ([key, value]) => Effect.map(encode(value), (encoded) => [key, encoded] as const), { concurrency: 1 }), Rec.fromEntries),
  })));
};

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
