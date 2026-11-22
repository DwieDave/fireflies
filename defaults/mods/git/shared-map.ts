// A keyed map in shared() read entry by entry: one entry in another shape is
// left out, not the whole map. The kit's owner is adding these to
// @fireflies/kit (named as guard.ts named them); until then this is git's one
// local copy, swapped for the kit's import when it lands.

import { Option, Record as Rec, Schema } from "effect";
import type { setShared, shared } from "herdr";
import type { Codec } from "@fireflies/kit";

/** A shared() key holding an object of entries, and the schema of one entry. */
export interface SharedMapKey<A, I = A> {
  readonly name: string;
  readonly entry: Codec<A, I>;
}

export const sharedMapKey = <A, I>(name: string, entry: Codec<A, I>): SharedMapKey<A, I> => ({ name, entry });

const asRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));

/** The entries whose values are of the entry's shape (the others left out); empty when there is none or it isn't an object. */
export function readSharedMap<A, I>(read: typeof shared, key: SharedMapKey<A, I>): ReadonlyMap<string, A> {
  const decode = Schema.decodeUnknownOption(key.entry);
  const out = new Map<string, A>();

  for (const [name, value] of Rec.toEntries(Option.getOrElse(asRecord(read(key.name)), () => ({})))) Option.map(decode(value), (a) => out.set(name, a));

  return out;
}

/** Writes `map` whole, each entry encoded with its schema (one it can't encode is left out). */
export function writeSharedMap<A, I>(write: typeof setShared, key: SharedMapKey<A, I>, map: ReadonlyMap<string, A>): void {
  const encode = Schema.encodeOption(key.entry);
  const out: Record<string, I> = {};

  for (const [name, value] of map) Option.map(encode(value), (i) => { out[name] = i; });

  write(key.name, out);
}
