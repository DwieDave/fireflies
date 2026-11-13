// Parsing at the boundary: what another mod, an older version of this one, a
// program's output, a file or a native view hands a mod arrives as `unknown`,
// and a guard proves what it is before anything uses it. No casts: a value is
// either proven or refused (and the caller says what then).
//
// A mod can't import another mod's files, so this file is in nocturne and in
// each of its mods (scripts/nocturne-mods.ts), byte for byte
// (scripts/mods-typescript.test.ts checks). Edit one, copy it over the others:
// for m in defaults/mods/*/guard.ts; do cp defaults/mods/pip/guard.ts "$m"; done

// Types only: this file runs nothing at import, so any test can load it as it is.
import type { setShared, shared } from "herdr";

/** Proves that a value is a T. */
export type Guard<T> = (value: unknown) => value is T;

/** The type a guard proves. */
export type Guarded<G> = G extends Guard<infer T> ? T : never;

/** A value JSON can hold, as literal options of `literal`. */
type Literal = string | number | boolean | null;

export const isString = (value: unknown): value is string => typeof value === "string";

/** A finite number (NaN and the infinities are refused). */
export const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

export const isNull = (value: unknown): value is null => value === null;

export const isUndefined = (value: unknown): value is undefined => value === undefined;

/** One of these literal values. */
export function literal<const T extends readonly Literal[]>(...options: T): Guard<T[number]> {
  return (value: unknown): value is T[number] => options.some((option) => option === value);
}

/** Any of these guards' types. */
export function oneOf<const G extends readonly Guard<Literal | object | undefined>[]>(...guards: G): Guard<Guarded<G[number]>> {
  return (value: unknown): value is Guarded<G[number]> => guards.some((guard) => guard(value));
}

/** T or null. */
export function nullable<T>(guard: Guard<T>): Guard<T | null> {
  return (value: unknown): value is T | null => value === null || guard(value);
}

const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/** An array whose every item is a T. */
export function arrayOf<T>(guard: Guard<T>): Guard<readonly T[]> {
  return (value: unknown): value is readonly T[] => isList(value) && value.every((item) => guard(item));
}

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null && !Array.isArray(value);

/** Each field of F and the guard that proves it. */
type Fields<F> = { readonly [K in keyof F]-?: Guard<F[K]> };

/** No fields. */
type None = Record<never, never>;

/** The object `object(required, optional)` proves. */
export type Proven<R, O> = { readonly [K in keyof R]: R[K] } & { readonly [K in keyof O]?: O[K] };

/**
 * An object with the `required` fields and, where present, the `optional`
 * ones (other fields may be there and are ignored). Name its type with
 * `Guarded<typeof isThing>`: the type and its check are one definition.
 */
export function object<R, O = None>(required: Fields<R>, optional?: Fields<O>): Guard<Proven<R, O>> {
  return (value: unknown): value is Proven<R, O> => {
    if (!isObject(value)) return false;

    // A field's value is read from its descriptor (lib types it `any`) straight into its
    // guard, which takes it as `unknown`; a getter has no value there, so it proves nothing.
    for (const key in required) {
      if (!Object.hasOwn(value, key) || !required[key](Object.getOwnPropertyDescriptor(value, key)?.value)) return false;
    }

    for (const key in optional) {
      if (Object.hasOwn(value, key) && !optional[key](Object.getOwnPropertyDescriptor(value, key)?.value)) return false;
    }

    return true;
  };
}

/** `text` as JSON proven by `guard`, else undefined (not JSON, or not a T). */
export function parseJson<T>(text: string, guard: Guard<T>): T | undefined {
  try {
    const parsed: unknown = JSON.parse(text);

    return guard(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** A shared() key and the type of its value. */
export interface SharedKey<T> {
  readonly name: string;
  readonly guard: Guard<T>;
}

export const sharedKey = <T>(name: string, guard: Guard<T>): SharedKey<T> => ({ name, guard });

/** The value under `key` (read with herdr's `shared`), or `fallback` when there is none or it
 *  isn't a T. */
export function readShared<T>(read: typeof shared, key: SharedKey<T>, fallback: T): T {
  const value = read(key.name);

  return key.guard(value) ? value : fallback;
}

/** Sets the value under `key` (with herdr's `setShared`); every mod redraws. */
export function writeShared<T>(write: typeof setShared, key: SharedKey<T>, value: T): void {
  write(key.name, value);
}

// ---- dictionaries: an object whose keys are data (slots, paths), read as a Map

/** A shared() key whose value is an object keyed by data, each value a T. */
export interface SharedMapKey<T> {
  readonly name: string;
  readonly entry: Guard<T>;
}

export const sharedMapKey = <T>(name: string, entry: Guard<T>): SharedMapKey<T> => ({ name, entry });

/** The entries under `key` whose values are T (the others are left out); empty when
 *  there is none or it isn't an object. */
export function readSharedMap<T>(read: typeof shared, key: SharedMapKey<T>): ReadonlyMap<string, T> {
  const value = read(key.name);
  const out = new Map<string, T>();

  if (!isObject(value)) return out;

  // As in object(): each value read from its descriptor straight into the guard.
  for (const name of Object.keys(value)) {
    const entry = Object.getOwnPropertyDescriptor(value, name)?.value;

    if (key.entry(entry)) out.set(name, entry);
  }

  return out;
}

/** Sets `map` under `key`, as an object (with herdr's `setShared`). */
export function writeSharedMap<T>(write: typeof setShared, key: SharedMapKey<T>, map: ReadonlyMap<string, T>): void {
  write(key.name, Object.fromEntries(map));
}

/** `text` as a JSON object keyed by data, each value a T (the others are left out):
 *  undefined when it isn't JSON or not an object. */
export function parseJsonMap<T>(text: string, entry: Guard<T>): ReadonlyMap<string, T> | undefined {
  const value = parseJson(text, isObject);

  if (value === undefined) return undefined;

  const out = new Map<string, T>();

  for (const name of Object.keys(value)) {
    const item = Object.getOwnPropertyDescriptor(value, name)?.value;

    if (entry(item)) out.set(name, item);
  }

  return out;
}
