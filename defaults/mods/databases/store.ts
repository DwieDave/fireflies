// What the window keeps on disk, under the app's data folder
// (data/databases/): the saved connections (connections.json: no secret in
// it, ever) and each connection's query history (history/<id>.json: the
// statements run, newest first, a password literal blanked by redact()).

import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, nullable, object, parseJson, sharedKey } from "./guard.ts";
import type { Conn } from "./kinds.ts";
import { connJson, connOf, isConnJson } from "./kinds.ts";
import { redact } from "./secrets.ts";

/** Reading and writing files (herdr's; a test's stand-ins). */
export interface FileIo {
  readonly readTextFile: (path: string) => Promise<string | null>;
  readonly writeTextFile: (path: string, text: string, expected: string | null) => Promise<null>;
}

/** The data folder's files. */
export const connectionsFile = (appHome: string): string => `${appHome}/data/databases/connections.json`;

export const historyFile = (appHome: string, id: string): string => `${appHome}/data/databases/history/${id.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;

const isConnectionsDoc = object({ connections: arrayOf(isConnJson) });

/** The saved connections (an absent or broken file: none). */
export async function readConnections(io: FileIo, appHome: string): Promise<Conn[]> {
  const text = await io.readTextFile(connectionsFile(appHome)).catch(() => null);
  const doc = text ? parseJson(text, isConnectionsDoc) : undefined;

  return doc ? doc.connections.map(connOf) : [];
}

/** The pinned (saved) connections changed, in some window: when, so every other window reads the
 *  file again (the file is the truth; this is the notice). */
export const PINNED_KEY = sharedKey("databases.pinned", nullable(object({ at: isNumber }, { by: isString })));

/** Changes the pinned connections as the file has them now (another window may have changed it
 *  since this one read it): `change` gets the file's list, its result is written (only if the file
 *  is still what was read: else read and changed again). A file that isn't a list is left alone. */
export async function changeConnections(io: FileIo, appHome: string, change: (list: Conn[]) => Conn[]): Promise<Conn[]> {
  const path = connectionsFile(appHome);

  for (let tries = 0; tries < 5; tries++) {
    const was = await io.readTextFile(path).catch(() => null);
    const doc = was ? parseJson(was, isConnectionsDoc) : undefined;

    if (was && !doc) throw new Error(`${path} isn't a list of connections: left as it is`);

    const next = change(doc ? doc.connections.map(connOf) : []);
    const text = `${JSON.stringify({ connections: next.flatMap((c) => (c.origin === "saved" ? [connJson(c)] : [])) }, null, 2)}\n`;

    try {
      await io.writeTextFile(path, text, was);

      return next;
    } catch {
      // Changed meanwhile (another window): read it again.
    }
  }

  throw new Error(`${path} kept changing: try again`);
}

/** Writes the saved connections (only saved ones; never a secret: connJson has no field for one). */
export async function writeConnections(io: FileIo, appHome: string, list: readonly Conn[]): Promise<void> {
  const path = connectionsFile(appHome);
  const was = await io.readTextFile(path).catch(() => null);
  const doc = { connections: list.flatMap((c) => (c.origin === "saved" ? [connJson(c)] : [])) };

  await io.writeTextFile(path, `${JSON.stringify(doc, null, 2)}\n`, was);
}

/** A statement run, as the history keeps it. */
export const isHistoryEntry = object({ sql: isString, at: isNumber }, { ms: isNumber, ok: isBoolean, rows: isNumber });

export type HistoryEntry = Guarded<typeof isHistoryEntry>;

const isHistoryDoc = object({ entries: arrayOf(isHistoryEntry) });

/** How many statements the history keeps per connection. */
export const HISTORY_MAX = 300;

/** A connection's history, newest first. */
export async function readHistory(io: FileIo, appHome: string, id: string): Promise<HistoryEntry[]> {
  const text = await io.readTextFile(historyFile(appHome, id)).catch(() => null);
  const doc = text ? parseJson(text, isHistoryDoc) : undefined;

  return doc ? [...doc.entries] : [];
}

/** The history with `entry` first (redacted; the same statement run again moves up, not twice). */
export function withEntry(list: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const kept: HistoryEntry = { ...entry, sql: redact(entry.sql.trim()) };

  return [kept, ...list.filter((e) => e.sql !== kept.sql)].slice(0, HISTORY_MAX);
}

/** Adds a statement to a connection's history on disk; resolves with the history now. */
export async function addHistory(io: FileIo, appHome: string, id: string, entry: HistoryEntry): Promise<HistoryEntry[]> {
  const path = historyFile(appHome, id);
  const was = await io.readTextFile(path).catch(() => null);
  const doc = was ? parseJson(was, isHistoryDoc) : undefined;
  const list = withEntry(doc ? doc.entries : [], entry);

  await io.writeTextFile(path, `${JSON.stringify({ entries: list })}\n`, was).catch(() => null);

  return list;
}

/** Forgets a connection's history (it was removed). */
export async function clearHistory(io: FileIo, appHome: string, id: string): Promise<void> {
  const path = historyFile(appHome, id);
  const was = await io.readTextFile(path).catch(() => null);

  if (was !== null) await io.writeTextFile(path, `${JSON.stringify({ entries: [] })}\n`, was).catch(() => null);
}
