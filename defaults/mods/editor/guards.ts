// The editor's own guards, beside the shared guard.ts (which stays the same
// in every mod): a JSON value of any shape (a language server's settings, a
// key's arguments) and lists read entry by entry.

import type { Guard } from "./guard.ts";

/** Any value JSON can hold. An object's keys are data (a server's settings,
 *  a command's arguments): reading one gives `Json | undefined`. */
export type Json = string | number | boolean | null | readonly Json[] | JsonObject;

export interface JsonObject {
  readonly [key: string]: Json;
}

/** An array, its items not yet looked at. */
export const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/** A plain object (not null, not an array), its fields not yet looked at. */
const isRecord = (value: unknown): value is object => typeof value === "object" && value !== null && !Array.isArray(value);

/** A JSON object: every field's value JSON. */
export function isJsonObject(value: unknown): value is JsonObject {
  if (!isRecord(value)) return false;

  // Each value read from its descriptor straight into the guard (as guard.ts's object()).
  return Object.keys(value).every((key) => isJson(Object.getOwnPropertyDescriptor(value, key)?.value));
}

/** A JSON value, all the way down. */
export function isJson(value: unknown): value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;

  if (typeof value === "number") return Number.isFinite(value);

  if (isList(value)) return value.every((item) => isJson(item));

  return isJsonObject(value);
}

/** The items of a list that `guard` proves (the others left out), as a guard over the list:
 *  `isList(v) ? itemsOf(v, g) : []` reads a list from outside entry by entry. */
export function itemsOf<T>(list: readonly unknown[], guard: Guard<T>): T[] {
  return list.filter((item) => guard(item));
}
