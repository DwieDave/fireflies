// The GitHub window's own guards, beside guard.ts (a shared copy, frozen):
// what gh's JSON and the window's cache file need that guard.ts doesn't have.
// Types only at import: tests load it as it is.

import type { Guard } from "./guard.ts";
import { isNull, isUndefined, oneOf } from "./guard.ts";

/** Any array: its items still to be proven one by one (a list that keeps the good ones). */
export const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/** A field GitHub may leave out, send as null, or (in a copy this window slimmed) not have:
 *  a T, null or undefined. */
export function maybe<T extends string | number | boolean | object>(guard: Guard<T>): Guard<T | null | undefined> {
  return oneOf(guard, isNull, isUndefined);
}

/** A JSON object whose keys are data (ids, numbers, folders), as it comes off the disk: a key
 *  that isn't there reads as undefined. Read straight into a Map with `toMap`. */
export type JsonMap<T> = { readonly [key: string]: T | undefined };

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null && !Array.isArray(value);

/** A JSON object keyed by data whose every value is a T. */
export function mapOf<T>(entry: Guard<T>): Guard<JsonMap<T>> {
  return (value: unknown): value is JsonMap<T> => isObject(value) && Object.keys(value).every((key) => entry(Object.getOwnPropertyDescriptor(value, key)?.value));
}

/** A proven JSON object keyed by data as a Map. */
export function toMap<T>(json: JsonMap<T>): Map<string, T> {
  const out = new Map<string, T>();

  for (const [key, value] of Object.entries(json)) if (value !== undefined) out.set(key, value);

  return out;
}

/** A Map as the JSON object it is written as. */
export const toJson = <T>(map: ReadonlyMap<string, T>): JsonMap<T> => Object.fromEntries(map);
