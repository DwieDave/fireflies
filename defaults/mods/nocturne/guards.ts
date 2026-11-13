// Nocturne's own guards and the records it reads from outside, beside the
// shared guard.ts (one file in every nocturne mod, kept as it is): what this
// mod parses and guard.ts doesn't carry. Pure: no herdr at run time, so any
// test can load it.

import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNull, isNumber, isString, nullable, object, oneOf } from "./guard.ts";

/** A list of anything (its items still to be proven). */
export const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

// ---- JSON values whose keys are data: a mod pane's props, a command's arguments

/** A JSON object as it arrives or is written (shared(), props, a command's arguments): its
 *  keys are data. Only at the boundary: jsonOf reads it into a Json, rawOf writes it back. */
export interface RawObject {
  readonly [key: string]: RawJson;
}

/** A JSON value as it arrives or is written (see RawObject). */
export type RawJson = string | number | boolean | null | readonly RawJson[] | RawObject;

/** A plain object (not an array, not null) whose every value is JSON. */
export const isRawObject = (value: unknown): value is RawObject =>
  typeof value === "object" && value !== null && !isList(value) && Object.keys(value).every((key) => isRawJson(Object.getOwnPropertyDescriptor(value, key)?.value));

/** A JSON value, at every depth. */
export const isRawJson = (value: unknown): value is RawJson =>
  value === null || isString(value) || isNumber(value) || isBoolean(value) || (isList(value) && value.every((item) => isRawJson(item))) || isRawObject(value);

/** A JSON value inside the mod: its objects are maps (their keys are data). */
export type Json = string | number | boolean | null | readonly Json[] | JsonMap;

/** A JSON object inside the mod. */
export type JsonMap = ReadonlyMap<string, Json>;

/** The value is an object (a map). */
export const isJsonMap = (value: Json): value is JsonMap => value instanceof Map;

/** The value is a list. */
const isJsonList = (value: Json): value is readonly Json[] => Array.isArray(value);

/** A JSON object as read: a map of its entries, at every depth. */
export function mapOf(value: RawObject): JsonMap {
  return new Map(Object.keys(value).flatMap((key) => {
    const v = value[key];

    return v === undefined ? [] : [[key, jsonOf(v)]];
  }));
}

/** A JSON value as read: its objects maps, at every depth. */
export function jsonOf(value: RawJson): Json {
  if (isRawList(value)) return value.map((v) => jsonOf(v));

  return isRawMap(value) ? mapOf(value) : value;
}

/** The value is a list (as it arrives). */
const isRawList = (value: RawJson): value is readonly RawJson[] => Array.isArray(value);

/** The value is an object (as it arrives). */
const isRawMap = (value: RawJson): value is RawObject => typeof value === "object" && value !== null && !Array.isArray(value);

/** A JSON object to write, or to hand a command as its arguments. */
export function objectOf(value: JsonMap): RawObject {
  return Object.fromEntries([...value].map(([key, v]) => [key, rawOf(v)]));
}

/** A JSON value to write: its maps objects again. */
export function rawOf(value: Json): RawJson {
  if (isJsonList(value)) return value.map((v) => rawOf(v));

  return isJsonMap(value) ? objectOf(value) : value;
}

/** A JSON value as one string with every object's keys sorted: two values that are
 *  the same, whatever order their keys were written in, give the same text. */
export function canonical(value: Json): string {
  if (isJsonList(value)) return `[${value.map((v) => canonical(v)).join(",")}]`;

  if (isJsonMap(value)) return `{${[...value.keys()].sort().map((k) => `${JSON.stringify(k)}:${canonical(value.get(k) ?? null)}`).join(",")}}`;

  return JSON.stringify(value);
}

/** A command as stored or handed on (a notification's action, a dialog's command): its name and arguments. */
export const isStoredCommand = object({ name: isString }, { args: isRawObject });

/** A command to run: its name, and its arguments (null: none). */
export interface Command {
  readonly name: string;
  readonly args: JsonMap | null;
}

/** A stored command as the mod reads it. */
export const commandOf = (c: Guarded<typeof isStoredCommand>): Command => ({ name: c.name, args: c.args ? mapOf(c.args) : null });

/** A command as stored. */
export const storedCommand = (c: Command): Guarded<typeof isStoredCommand> => (c.args ? { name: c.name, args: objectOf(c.args) } : { name: c.name });

/** A command's arguments for run(): an object (`more` added). */
export const argsOf = (c: Command, more: JsonMap = new Map()): RawObject => objectOf(new Map([...(c.args ?? []), ...more]));

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
    program: object({ key: isString }, { name: isString, agent: isBoolean, shell: isBoolean }),
    status: isString,
    title: isString,
    pid: oneOf(isNumber, isNull),
    created_ms: oneOf(isNumber, isNull),
    finished_ms: oneOf(isNumber, isNull),
    argv: nullable(arrayOf(isString)),
    parent: nullable(isString),
    name: nullable(isString),
  },
);

export type Terminal = Guarded<typeof isTerminal>;
