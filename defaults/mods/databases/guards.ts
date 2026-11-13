// The Databases window's own guards beyond guard.ts (a shared copy, kept as it is).

/** A list, its items not yet looked at (envrc.ts reads direnv's JSON with it). */
export const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);
