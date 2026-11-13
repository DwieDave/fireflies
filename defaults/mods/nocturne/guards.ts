// Nocturne's own guards and the records it reads from outside, beside the
// shared guard.ts (one file in every nocturne mod, kept as it is): what this
// mod parses and guard.ts doesn't carry. Pure: no herdr at run time, so any
// test can load it.

import type { Guarded } from "./guard.ts";
import { isBoolean, isNull, isNumber, isString, nullable, object, oneOf } from "./guard.ts";

/** A JSON value: what a mod pane's props are (they come from its mod, keys and all). */
export type Json = string | number | boolean | null | readonly Json[] | JsonObject;

/** A JSON object: its keys are data (a mod's props, as that mod wrote them). */
export interface JsonObject {
  readonly [key: string]: Json;
}

/** A list of anything (its items still to be proven). */
export const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/** A plain object (not an array, not null) whose every value is JSON. */
export const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !isList(value) && Object.keys(value).every((key) => isJson(Object.getOwnPropertyDescriptor(value, key)?.value));

/** A JSON value, at every depth. */
export const isJson = (value: unknown): value is Json =>
  value === null || isString(value) || isNumber(value) || isBoolean(value) || (isList(value) && value.every((item) => isJson(item))) || isJsonObject(value);

// ---- terminals(): herdr-core's listing, the fields Nocturne reads

/** The labels Nocturne reads on a terminal (all strings; others may be there). */
export const isLabels = object(
  {},
  {
    "herdr.pinned": isString,
    "herdr.right-click": isString,
    "nocturne.pinned-at": isString,
    "nocturne.name": isString,
    "nocturne.script": isString,
    "nocturne.script.name": isString,
    "nocturne.script.admin": isString,
    "nocturne.script.plan": isString,
  },
);

export type Labels = Guarded<typeof isLabels>;

/** A terminal as terminals() lists it: its address, and what else Nocturne reads. */
export const isTerminal = object(
  { address: isString },
  {
    labels: isLabels,
    state: isString,
    cwd: nullable(isString),
    floating: isBoolean,
    floating_view: oneOf(isNumber, isNull),
    exit_code: oneOf(isNumber, isNull),
    reason: oneOf(isString, isNull),
  },
);

export type Terminal = Guarded<typeof isTerminal>;
