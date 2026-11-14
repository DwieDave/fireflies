// Files dropped on the window from outside (gpui-kit's on_drop, absolute
// paths): a SQLite file (.db, .sqlite, .sqlite3, .db3) opens as a connection,
// listed under "sent here" and not saved (s saves it), as another mod's
// databases.connect would; a .sql file's text goes into a new query tab,
// not run. Nothing that writes to a database starts from a drop.

import type { Context } from "gpui-kit";
import { readTextFile } from "herdr";
import { baseName } from "./kinds.ts";
import { receive } from "./conns.ts";
import type { default as DbView } from "./main.ts";

/** The SQLite files' extensions (discover.ts finds the same in a folder). */
export const SQLITE_EXT = /\.(db|sqlite|sqlite3|db3)$/i;

/** A .sql file read into a query tab, at most this many bytes. */
export const SQL_MAX = 1024 * 1024;

/** What a dropped file is to the window. */
export type Dropped = "sqlite" | "sql" | null;

export const droppedAs = (path: string): Dropped => (SQLITE_EXT.test(path) ? "sqlite" : /\.sql$/i.test(path) ? "sql" : null);

/** Files dropped on the window: the first SQLite file connects, each .sql file opens in a tab. */
export function dropFiles(v: DbView, paths: readonly string[], cx: Context): void {
  const db = paths.find((p) => droppedAs(p) === "sqlite");
  const sql = paths.filter((p) => droppedAs(p) === "sql");

  if (!db && !sql.length) {
    v.say("only a SQLite file (.db, .sqlite, .sqlite3, .db3) or a .sql file opens here", "failed");

    return;
  }

  if (db) receive(v, { kind: "sqlite", path: db, name: baseName(db), from: "dropped here" }, cx);

  for (const p of sql) void openSql(v, p, cx);
}

/** A .sql file's text in a new query tab named after it (not run). */
async function openSql(v: DbView, path: string, cx: Context): Promise<void> {
  const text = await readTextFile(path).catch(() => null);

  if (text === null) {
    v.say(`couldn't read ${baseName(path)}`, "failed");
  } else if (text.length > SQL_MAX) {
    v.say(`${baseName(path)} is too big for a query tab (over 1 MB)`, "failed");
  } else {
    const q = v.addQuery(text, cx);

    q.name = baseName(path).replace(/\.sql$/i, "");
    v.say(`${baseName(path)} in a query tab · not run`, "done");
  }

  cx.notify();
}
