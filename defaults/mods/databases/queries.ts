// A saved connection's query tabs, kept between openings (and restarts) in
// data/databases/queries/<id>.json: each tab's name and text, nothing it
// answered. Found and sent connections keep theirs in memory only.

import type { Context } from "gpui-kit";
import { arrayOf, isString, object, parseJson } from "./guard.ts";
import type { Conn } from "./kinds.ts";
import { IO, dataHome } from "./session.ts";
import { newQuery } from "./query.ts";
import type { default as DbView } from "./main.ts";

const isQueriesDoc = object({ tabs: arrayOf(object({ name: isString, text: isString })) });

/** The file of a connection's tabs. */
export const queriesFile = (home: string, id: string): string => `${home}/data/databases/queries/${id.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;

/** Whose tabs the view holds now (they're saved under this connection). */
const owner = new WeakMap<DbView, string>();

/** Opens the connection's kept tabs (one empty tab when it has none). */
export async function loadQueries(v: DbView, c: Conn, cx: Context): Promise<void> {
  await saveQueries(v);

  const text = c.origin === "saved" ? await IO.readTextFile(queriesFile(dataHome(), c.id)).catch(() => null) : null;
  const doc = text ? parseJson(text, isQueriesDoc) : undefined;
  const tabs = doc?.tabs.length ? doc.tabs : [{ name: "Query 1", text: "" }];

  if (v.active !== c) return;

  v.queries = tabs.map((t) => {
    const q = newQuery(v, t.text);

    q.name = t.name;

    return q;
  });
  v.mainTab = 0;
  owner.set(v, c.id);
  v.queriesDirty = false;
  cx.notify();
}

/** Writes the tabs of the connection they belong to (a saved one). */
export async function saveQueries(v: DbView): Promise<void> {
  const id = owner.get(v);
  const c = v.saved.find((s) => s.id === id);

  v.queriesDirty = false;

  if (!c) return;

  const path = queriesFile(dataHome(), c.id);
  const was = await IO.readTextFile(path).catch(() => null);
  const doc = { tabs: v.queries.map((q) => ({ name: q.name, text: q.editor.value() })) };
  const text = `${JSON.stringify(doc, null, 2)}\n`;

  if (text !== was) await IO.writeTextFile(path, text, was).catch(() => null);
}
