// Shared keys whose value is a list or a map read entry by entry (an entry
// in another shape left out, not the whole value), as guard.ts named them:
// this mod's stand-in until @fireflies/kit has them (the orchestrator's
// list), so the swap is one import.

import { Option, Record as Rec, Schema } from "effect";
import type { setShared, shared } from "herdr";
import type { Codec } from "@fireflies/kit";

/** A shared() key whose value is a list, each entry an `A`. */
export interface SharedListKey<A, I = A> {
  readonly name: string;
  readonly item: Codec<A, I>;
}

export const sharedListKey = <A, I>(name: string, item: Codec<A, I>): SharedListKey<A, I> => ({ name, item });

const readList = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));

/** The entries of `list` (a list from the app: terminals(), a shared value read as a list) that decode with `item`, in order. */
export function listEntries<A, I>(list: readonly unknown[], item: Codec<A, I>): readonly A[] {
  const one = Schema.decodeUnknownOption(item);
  const out: A[] = [];

  for (const entry of list) Option.map(one(entry), (a) => out.push(a));

  return out;
}

/** The key's entries (read with herdr's `shared`); none when its value isn't a list. */
export const readSharedList = <A, I>(read: typeof shared, key: SharedListKey<A, I>): readonly A[] =>
  Option.match(readList(read(key.name)), { onNone: () => [], onSome: (list) => listEntries(list, key.item) });

/** A shared() key whose value is an object keyed by data, each value an `A`. */
export interface SharedMapKey<A, I = A> {
  readonly name: string;
  readonly entry: Codec<A, I>;
}

export const sharedMapKey = <A, I>(name: string, entry: Codec<A, I>): SharedMapKey<A, I> => ({ name, entry });

const readRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));

/** The key's entries whose values decode (the others left out); empty when it isn't an object. */
export function readSharedMap<A, I>(read: typeof shared, key: SharedMapKey<A, I>): ReadonlyMap<string, A> {
  const one = Schema.decodeUnknownOption(key.entry);
  const out = new Map<string, A>();

  for (const [name, value] of Rec.toEntries(Option.getOrElse(readRecord(read(key.name)), () => ({})))) Option.map(one(value), (a) => out.set(name, a));

  return out;
}

/** Sets `map` under `key`, as an object, each value encoded (one its schema can't encode is left out). */
export function writeSharedMap<A, I>(write: typeof setShared, key: SharedMapKey<A, I>, map: ReadonlyMap<string, A>): void {
  const encode = Schema.encodeOption(key.entry);
  const out: Record<string, I> = {};

  for (const [name, value] of map) Option.map(encode(value), (e) => { out[name] = e; });

  write(key.name, out);
}
