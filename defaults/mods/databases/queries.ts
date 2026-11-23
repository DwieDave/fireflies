// A saved connection's query tabs, kept between openings (and restarts) in
// data/databases/queries/<id>.json: each tab's name and text, nothing it
// answered. Found and sent connections keep theirs in memory only.

import { Array as Arr, Effect, Option, Schema, String as Str } from "effect";
import { Files, decodeJsonOption } from "@fireflies/kit";
import type { FileError, StaleFile } from "@fireflies/kit";
import type { Conn } from "./kinds.ts";
import { dataHome } from "./session.ts";
import { newQuery } from "./query.ts";
import type { default as DbView } from "./main.ts";
import type { DbRun } from "./app.ts";

const QueriesDocSchema = Schema.Struct({ tabs: Schema.Array(Schema.Struct({ name: Schema.String, text: Schema.String })) });
const queriesDoc = decodeJsonOption(QueriesDocSchema);
const docText = Schema.encodeSync(Schema.fromJsonString(QueriesDocSchema, { space: 2 }));

/** The file of a connection's tabs. */
export const queriesFile = (home: string, id: string): string => `${home}/data/databases/queries/${Str.replace(/[^A-Za-z0-9_-]/g, "_")(id)}.json`;

/** Whose tabs the view holds now (they're saved under this connection). */
const owner = new WeakMap<DbView, string>();

/** Opens the connection's kept tabs (one empty tab when it has none). The tabs before are kept
 *  first where they can be (a file that refuses: they're dropped, as before). */
export const loadQueries = (v: DbView, c: Conn): Effect.Effect<void, never, DbRun> => Effect.gen(function* () {
  yield* Effect.ignore(saveQueries(v));

  const text = c.origin === "saved" ? yield* Effect.orElseSucceed(Files.use((f) => f.read(queriesFile(dataHome(), c.id))), () => Option.none<string>()) : Option.none<string>();
  const doc = Option.flatMap(text, queriesDoc);
  const tabs = Option.getOrElse(Option.filter(Option.map(doc, (d) => d.tabs), Arr.isReadonlyArrayNonEmpty), () => [{ name: "Query 1", text: "" }]);

  if (v.active !== c) return;

  v.queries = Arr.map(tabs, (t) => {
    const q = newQuery(v, t.text);

    q.name = t.name;

    return q;
  });
  v.mainTab = 0;
  owner.set(v, c.id);
  v.queriesDirty = false;
});

/** Writes the tabs of the connection they belong to (a saved one). */
export const saveQueries = (v: DbView): Effect.Effect<void, FileError | StaleFile, Files> => Effect.gen(function* () {
  const id = owner.get(v);
  const c = Option.getOrUndefined(Arr.findFirst(v.saved, (s) => s.id === id));

  v.queriesDirty = false;

  if (c === undefined) return;

  const files = yield* Files;
  const path = queriesFile(dataHome(), c.id);
  const was = Option.getOrNull(yield* files.read(path));
  const text = `${docText({ tabs: Arr.map(v.queries, (q) => ({ name: q.name, text: q.editor.value() })) })}\n`;

  if (text !== was) yield* files.write(path, text, was);
});
