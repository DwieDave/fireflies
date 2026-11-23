// What the window keeps on disk, under the app's data folder
// (data/databases/): the saved connections (connections.json: no secret in
// it, ever) and each connection's query history (history/<id>.json: the
// statements run, newest first, a password literal blanked by redact()).
//
// Both are read and written through the kit's `Files` with the text a write
// expects to replace: another window that changed the file meanwhile makes the
// write `StaleFile`, and the change is made again on the file as it is now (a
// pin, a history entry: none is lost to the other window's).

import { Array as Arr, Effect, Option, Predicate, Schema, String as Str } from "effect";
import { DecodeError, Files, sharedKey } from "@fireflies/kit";
import type { FileError, StaleFile } from "@fireflies/kit";
import type { Conn } from "./kinds.ts";
import { ConnJsonSchema, connJson, connOf } from "./kinds.ts";
import { redact } from "./secrets.ts";

/** The data folder's files. */
export const connectionsFile = (appHome: string): string => `${appHome}/data/databases/connections.json`;

export const historyFile = (appHome: string, id: string): string => `${appHome}/data/databases/history/${Str.replace(/[^A-Za-z0-9_-]/g, "_")(id)}.json`;

const ConnectionsDoc = Schema.Struct({ connections: Schema.Array(ConnJsonSchema) });

/** A schema's failure, its first line (the rest is the value's every difference). */
const firstLine = (error: Schema.SchemaError): string => Option.getOrElse(Arr.head(Str.split(error.message, "\n")), () => error.message);

/** connections.json's text decoded; another shape is a `DecodeError` that says the file is left as it is. */
const decodeConnections = (path: string) => (text: string): Effect.Effect<Conn[], DecodeError> => Schema.decodeUnknownEffect(Schema.fromJsonString(ConnectionsDoc))(text).pipe(
  Effect.map((doc) => Arr.map(doc.connections, connOf)),
  Effect.mapError((error) => DecodeError.make({ what: path, message: `${path} isn't a list of connections (left as it is): ${firstLine(error)}` })),
);

/** The saved connections as the file keeps them (only saved ones; never a secret: connJson has no field for one). */
const encodeConnections = (list: readonly Conn[]): Effect.Effect<string, DecodeError> => Schema.encodeEffect(Schema.fromJsonString(ConnectionsDoc, { space: 2 }))({
  connections: Arr.flatMap(list, (c) => (c.origin === "saved" ? [connJson(c)] : [])),
}).pipe(
  Effect.map((text) => `${text}\n`),
  Effect.mapError((error) => DecodeError.make({ what: "connections.json", message: `a connection couldn't be written: ${firstLine(error)}` })),
);

/** The saved connections (none when there's no file); a file in another shape is a `DecodeError`. */
export const readConnections = (appHome: string): Effect.Effect<Conn[], FileError | DecodeError, Files> => {
  const path = connectionsFile(appHome);

  return Effect.flatMap(Files.use((f) => f.read(path)), Option.match({ onNone: () => Effect.succeed([]), onSome: decodeConnections(path) }));
};

/** The pinned (saved) connections changed, in some window: when, so every other window reads the
 *  file again (the file is the truth; this is the notice). */
export const PINNED_KEY = sharedKey("databases.pinned", Schema.NullOr(Schema.Struct({ at: Schema.Finite, by: Schema.optionalKey(Schema.String) })));

/** How often a write refused as stale is made again on the file as it is now. */
const AGAIN = 4;

const stale = Predicate.isTagged("StaleFile");

/** Changes the pinned connections as the file has them now (another window may have changed it
 *  since this one read it): `change` gets the file's list, its result is written only if the file
 *  is still what was read, else read and changed again. A file that isn't a list is left alone. */
export const changeConnections = (appHome: string, change: (list: Conn[]) => Conn[]): Effect.Effect<Conn[], FileError | StaleFile | DecodeError, Files> => Effect.gen(function* () {
  const files = yield* Files;
  const path = connectionsFile(appHome);
  const was = yield* files.read(path);
  const list = yield* Option.match(was, { onNone: () => Effect.succeed([]), onSome: decodeConnections(path) });
  const next = change(list);

  yield* files.write(path, yield* encodeConnections(next), Option.getOrNull(was));

  return next;
}).pipe(Effect.retry({ while: stale, times: AGAIN }));

/** A statement run, as the history keeps it. */
export const HistoryEntrySchema = Schema.Struct({
  sql: Schema.String,
  at: Schema.Finite,
  ms: Schema.optionalKey(Schema.Finite),
  ok: Schema.optionalKey(Schema.Boolean),
  rows: Schema.optionalKey(Schema.Finite),
});

export type HistoryEntry = typeof HistoryEntrySchema.Type;

const HistoryDoc = Schema.fromJsonString(Schema.Struct({ entries: Schema.Array(HistoryEntrySchema) }));

/** How many statements the history keeps per connection. */
export const HISTORY_MAX = 300;

/** A history file's entries: a file in another shape reads as none (it is written anew with the
 *  next statement: a history is a convenience, not a record to keep whole). */
const entriesOf = (text: Option.Option<string>): HistoryEntry[] => Option.match(Option.flatMap(text, Schema.decodeUnknownOption(HistoryDoc)), {
  onNone: () => [],
  onSome: (doc) => [...doc.entries],
});

const historyText = (entries: readonly HistoryEntry[]): Effect.Effect<string, DecodeError> => Schema.encodeEffect(HistoryDoc)({ entries }).pipe(
  Effect.map((text) => `${text}\n`),
  Effect.mapError((error) => DecodeError.make({ what: "history", message: `the history couldn't be written: ${firstLine(error)}` })),
);

/** A connection's history, newest first. */
export const readHistory = (appHome: string, id: string): Effect.Effect<HistoryEntry[], FileError, Files> =>
  Effect.map(Files.use((f) => f.read(historyFile(appHome, id))), entriesOf);

/** The history with `entry` first (redacted; the same statement run again moves up, not twice). */
export function withEntry(list: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const kept: HistoryEntry = { ...entry, sql: redact(Str.trim(entry.sql)) };

  return Arr.take([kept, ...Arr.filter(list, (e) => e.sql !== kept.sql)], HISTORY_MAX);
}

/** Changes a history file as it is now (made again when another window wrote it meanwhile). */
const changeHistory = (path: string, change: (list: readonly HistoryEntry[]) => HistoryEntry[]): Effect.Effect<HistoryEntry[], FileError | StaleFile | DecodeError, Files> => Effect.gen(function* () {
  const files = yield* Files;
  const was = yield* files.read(path);
  const list = change(entriesOf(was));

  yield* files.write(path, yield* historyText(list), Option.getOrNull(was));

  return list;
}).pipe(Effect.retry({ while: stale, times: AGAIN }));

/** Adds a statement to a connection's history on disk: the history now. */
export const addHistory = (appHome: string, id: string, entry: HistoryEntry): Effect.Effect<HistoryEntry[], FileError | StaleFile | DecodeError, Files> =>
  changeHistory(historyFile(appHome, id), (list) => withEntry(list, entry));

/** Forgets a connection's history (it was removed). No file: nothing to forget. */
export const clearHistory = (appHome: string, id: string): Effect.Effect<void, FileError | StaleFile | DecodeError, Files> => {
  const path = historyFile(appHome, id);

  return Effect.flatMap(Files.use((f) => f.read(path)), Option.match({
    onNone: () => Effect.void,
    onSome: () => Effect.asVoid(changeHistory(path, () => [])),
  }));
};
