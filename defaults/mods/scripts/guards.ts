// The script runner's own guards, beside the shared guard.ts (which stays a
// byte-for-byte copy): what a manifest or `nix flake show` prints is JSON
// whose objects are keyed by data (script names, systems, packages), read
// here as Maps.

import type { Guard, Guarded } from "./guard.ts";
import { object } from "./guard.ts";

/** Any JSON object (not an array, not null): its fields are data, read with `fields`. */
export const isRecord = object({});

export type JsonRecord = Guarded<typeof isRecord>;

/** The fields of `record` that `entry` proves, by name, in order (the others are left out). */
export function fields<T>(record: JsonRecord, entry: Guard<T>): ReadonlyMap<string, T> {
  const out = new Map<string, T>();

  // As guard.ts's object(): each value read from its descriptor straight into its guard.
  for (const name of Object.keys(record)) {
    const value: unknown = Object.getOwnPropertyDescriptor(record, name)?.value;

    if (entry(value)) out.set(name, value);
  }

  return out;
}
