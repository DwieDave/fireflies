// Which database a server connection is in, and the server's others: where
// it landed as the server says it (a Postgres connection that names none is
// in the server's default, `postgres`; a MySQL one is in none and lists every
// database's tables), the server's databases (the Databases tab of [2], b, a
// click on the head's database), a pick that connects to another (the secret
// kept in memory, the tables read again; remembered in a pinned connection's
// record, for a sent one while the window lives), and the words an empty
// database says instead of a bare 0.

import type { Context } from "gpui-kit";
import type { Conn, ConnDraft } from "./kinds.ts";
import type { KubeSource } from "./kube.ts";
import type { Here } from "./catalog.ts";
import { databasesOf, databasesSql } from "./catalog.ts";
import type { ServerDbs } from "./state.ts";
import { endWords, reading } from "./reads.ts";
import { runOn } from "./session.ts";
import { changePinned } from "./pinned.ts";
import { openConn } from "./conns.ts";
import { counted } from "./edits.ts";
import { beforeLeaving } from "./cell-edit.ts";
import type { default as DbView } from "./main.ts";

/** Whether a kind has other databases on its server to list and pick. */
export const hasDatabases = (c: Pick<Conn, "kind" | "url">): boolean => c.kind === "postgres" || c.kind === "mysql";

/** Where a connection is: its database (the server's answer, else what it names, else what the
 *  client falls back to), whether that is the fallback, and its user. */
export interface Where {
  readonly database: string | null;
  /** No database was named: Postgres' client went to `postgres`, the server's default. */
  readonly fallback: boolean;
  readonly user: string | null;
}

/** Where `c` is, as far as the window knows (`here`: the server's answer with the tables). */
export function whereNow(c: Conn, here: Here | null | undefined): Where {
  const named = c.database || null;
  const fallback = !named && c.kind === "postgres";
  const database = here?.database ?? named ?? (fallback ? "postgres" : null);

  return { database, fallback, user: here?.user ?? c.user ?? null };
}

/** The database in words: "lantern", "postgres (the server's default: none was named)", MySQL's
 *  "every database (none was named)". */
export function databaseWords(w: Where, short = false): string {
  if (!w.database) return short ? "every database" : "every database (none was named)";

  return w.fallback && !short ? `${w.database} (the server's default: none was named)` : w.database;
}

/** The connection with another database (null: none named); a cluster secret's database key is
 *  dropped from its source, so the pick stands at the next connect. */
export function withDatabase(c: Conn, name: string | null): Conn {
  const next: ConnDraft = { ...c };

  if (name) next.database = name;
  else delete next.database;

  if (c.source?.databaseKey) {
    const { databaseKey: _dropped, ...source } = c.source;
    const kept: KubeSource = source;

    next.source = kept;
  }

  return next;
}

/** Reads the server's databases into the Databases tab (`sized`: with each one's size, asked). */
export async function loadDatabases(v: DbView, cx: Context, sized = false): Promise<void> {
  cx = v.held(cx);

  const c = v.active;

  if (!c || !hasDatabases(c)) return;

  const d: ServerDbs = { conn: c.id, list: v.dbs?.conn === c.id ? v.dbs.list : [], busy: true, error: null, sized };

  v.dbs = d;
  cx.notify();

  try {
    const what = sized ? "measuring the server's databases" : "reading the server's databases";
    const e = await reading(v, what, "tables", cx, (started) => runOn(v, c, databasesSql(c.kind, sized), started, undefined, "the server's databases"));

    if (v.dbs !== d) return;

    if (!("value" in e)) d.error = endWords(e, what);
    else if (e.value.error) d.error = e.value.error.message;
    else {
      const first = !d.list.length;

      d.list = databasesOf(e.value);

      // Read the first time with the tab shown: the cursor on the database it's in.
      if (first && v.tablesTab === "databases" && v.active === c) v.tableAt = Math.max(0, dbRows(v).indexOf(whereNow(c, v.catalog.here).database));
    }
  } catch (error) {
    d.error = `reading the server's databases failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    d.busy = false;
    cx.notify();
  }
}

/** The server's databases as read for the active connection, or null (not read, another's). */
export const dbsNow = (v: DbView): ServerDbs | null => (v.dbs && v.active && v.dbs.conn === v.active.id ? v.dbs : null);

/** The Databases tab's rows: MySQL's first is "every database" (none named: every database's
 *  tables listed), then the server's databases. */
export function dbRows(v: DbView): (string | null)[] {
  const names = (dbsNow(v)?.list ?? []).map((d) => d.name);

  return v.active?.kind === "mysql" ? [null, ...names] : names;
}

/** b, the head's database: the Databases tab of [2], read for this connection. */
export function showDatabases(v: DbView, cx: Context): void {
  const c = v.active;

  if (!c) {
    v.say("nothing is connected: pick a connection in [1]", "failed");

    return;
  }

  if (!hasDatabases(c)) {
    v.say(`${c.name} is a file: it has no other databases`, "failed");

    return;
  }

  // The tab reads the list (main.ts setTablesTab); the cursor on the database it's in.
  v.setTablesTab("databases", cx);
  v.tableAt = Math.max(0, dbRows(v).indexOf(whereNow(c, v.catalog.here).database));
}

/** Connects the active connection to another database of its server: changes staged on a table's
 *  rows ask first; the secret stays in memory (nothing read again); the tables, structure and rows
 *  are read anew; a pinned one keeps the pick in its record, a sent one while the window lives. */
export function useDatabase(v: DbView, name: string | null, cx: Context): void {
  cx = v.held(cx);

  const c = v.active;

  if (!c) return;

  if (counted(v.edits).cells) {
    beforeLeaving(v, `connect to ${name ?? "every database"}`, () => useDatabase(v, name, cx));

    return;
  }

  const next = withDatabase(c, name);
  const swap = (list: Conn[]): Conn[] => list.map((x) => (x.id === c.id ? next : x));

  v.saved = swap(v.saved);
  v.sent = swap(v.sent);
  v.found = v.found.map((f) => (f.conn.id === c.id ? { ...f, conn: next } : f));

  if (c.origin === "saved") void changePinned(v, (now) => now.map((x) => (x.id === c.id ? withDatabase(x, name) : x)), cx);
  else v.picked.set(c.id, name);

  v.schema = null;
  v.tablesTab = "tables";
  v.tableAt = 0;
  const to = name ?? "every database";

  v.say(`${c.name}: connecting to ${to}${c.origin === "saved" ? " · kept in its pin" : ""}`, "working");
  void openConn(v, next, cx).then(() => {
    if (v.active === next) v.say(v.catalog.error ? `${c.name}: ${to} didn't answer` : `${c.name}: in ${to}${c.origin === "saved" ? " · kept in its pin" : ""}`, v.catalog.error ? "failed" : "done");

    cx.notify();
  });
}

/** What an empty database says in [2] instead of a bare 0: its name, the server's others (one by
 *  name, several counted and named as far as they fit), and what enter does; null when it isn't
 *  empty (or not a server's). */
export interface EmptyWords {
  readonly title: string;
  readonly note: string;
  /** The others to offer as chips (a click connects to one). */
  readonly others: readonly string[];
  /** What enter does: connect to the one other, open the list, or nothing. */
  readonly enter: { readonly use: string } | "list" | null;
}

export function emptyWords(v: DbView): EmptyWords | null {
  const c = v.active;

  if (!c || !hasDatabases(c) || v.catalog.busy || v.catalog.error || v.catalog.tables.length || !v.alive?.ok) return null;

  const w = whereNow(c, v.catalog.here);
  const who = w.user ?? "this user";
  // MySQL lists only what the user may use: an empty list there may be the grants.
  const grants = c.kind === "mysql" ? ` · MySQL lists only the tables ${who} may use: the grants decide what shows` : "";
  const title = w.database ? `${databaseWords(w)} has no tables` : `no tables in any database ${who} may use`;
  const d = dbsNow(v);

  if (!d || (d.busy && !d.list.length)) return { title, note: `looking for the server's other databases…${grants}`, others: [], enter: null };

  if (d.error && !d.list.length) return { title, note: `the server's databases couldn't be read: ${d.error}${grants}`, others: [], enter: null };

  const others = d.list.map((x) => x.name).filter((n) => n !== w.database);

  if (!others.length) return { title, note: `and the server has no other database ${who} may connect to${grants}`, others: [], enter: null };

  if (others.length === 1) return { title, note: `1 other database on this server: ${others[0]} · enter connects to it${grants}`, others, enter: { use: others[0] ?? "" } };

  const shown = others.slice(0, 4).join(", ");

  return { title, note: `${others.length} other databases on this server: ${shown}${others.length > 4 ? ", …" : ""} · enter opens the list${grants}`, others: others.slice(0, 6), enter: "list" };
}

/** enter on an empty database's words: the one other connected to, or the list opened. */
export function enterEmpty(v: DbView, cx: Context): boolean {
  const e = emptyWords(v);

  if (!e?.enter) return false;

  if (e.enter === "list") showDatabases(v, cx);
  else useDatabase(v, e.enter.use, cx);

  return true;
}
