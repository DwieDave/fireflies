// The statements a save runs: one transaction, one UPDATE per changed row
// (keyed by the primary key, the old value of each changed column in its WHERE
// so a row changed elsewhere isn't overwritten), and after each UPDATE a guard
// that stops the run when it changed no row: the client stops at the error and
// the transaction is rolled back when it disconnects (nothing is committed).
//   Postgres  SELECT 1 / :ROW_COUNT          psql's count of the last command
//   MySQL     SET @@session.sql_mode = IF(ROW_COUNT() > 0, …, 'fireflies: …')
//   SQLite    SELECT CASE WHEN changes() = 0 THEN abs(-9223372036854775807 - 1) END
// (an error only when no row changed). A remote libSQL database (Hrana) gets
// the same statements with every value bound to a `?`. Also what a failed
// save's error says, in the row's words.

import type { Kind } from "./kinds.ts";
import type { Cell, Outcome } from "./parse-out.ts";
import type { ScriptStatement } from "./script.ts";
import type { Edits } from "./edits.ts";
import type { Bound, ColType } from "./quote.ts";
import { bound, literal, stillHolds, typeOf } from "./quote.ts";
import { qualified, quoteName } from "./catalog.ts";

/** A statement of a save: what it is for, and which changed row (its index in the review). */
export interface SaveStatement extends ScriptStatement {
  readonly role: "begin" | "update" | "guard" | "commit";
  readonly row: number;
  /** The row's key in words: "id = 3". */
  readonly where: string;
}

/** What a save is built from: the engine, whether values are bound (Hrana), each column's type. */
export interface SaveTarget {
  readonly kind: Kind;
  readonly bind: boolean;
  readonly types: ReadonlyMap<string, string>;
}

/** The guard after an UPDATE: an error only when it changed no row. */
export function guardSql(kind: Kind): string {
  if (kind === "postgres") return "SELECT 1 / :ROW_COUNT AS changed";

  if (kind === "mysql") return "SET @@session.sql_mode = IF(ROW_COUNT() > 0, @@session.sql_mode, 'fireflies: 0 rows changed')";

  return "SELECT CASE WHEN changes() = 0 THEN abs(-9223372036854775807 - 1) END AS changed";
}

/** A value for the statement: a literal pasted in, or a `?` and its bound value. */
type Part = { readonly sql: string; readonly args: readonly Bound[] } | { readonly refused: string };

function valuePart(t: SaveTarget, value: Cell, type: ColType): Part {
  if (t.bind) {
    const b = bound(value, type);

    return "refused" in b ? b : { sql: "?", args: [b] };
  }

  const l = literal(t.kind, value, type);

  return "refused" in l ? l : { sql: l.sql, args: [] };
}

/** A row's UPDATE (or why it can't be written). */
function updateOf(t: SaveTarget, edits: Edits, key: readonly Cell[], cells: ReadonlyMap<string, { readonly was: Cell; readonly now: Cell }>): { readonly sql: string; readonly args: readonly Bound[]; readonly where: string } | { readonly refused: string } {
  const sets: string[] = [];
  const conds: string[] = [];
  const args: Bound[] = [];
  const whereArgs: Bound[] = [];
  const words: string[] = [];

  for (const [column, change] of cells) {
    const p = valuePart(t, change.now, typeOf(t.types.get(column) ?? ""));

    if ("refused" in p) return { refused: `${column}: ${p.refused}` };

    sets.push(`${quoteName(t.kind, column)} = ${p.sql}`);
    args.push(...p.args);
  }

  edits.keyCols.forEach((k, i) => {
    const v = key[i] ?? null;
    const p = valuePart(t, v, typeOf(t.types.get(k) ?? (k === "rowid" ? "integer" : "")));

    words.push(`${k} = ${v ?? "NULL"}`);

    if ("refused" in p) conds.push("1 = 0");
    else {
      conds.push(`${quoteName(t.kind, k)} = ${p.sql}`);
      whereArgs.push(...p.args);
    }
  });

  for (const [column, change] of cells) {
    const declared = t.types.get(column) ?? "";

    // A float bound over HTTP comes back as JavaScript prints it, not as SQLite's text: not compared.
    if (t.bind && typeOf(declared) === "float") continue;

    conds.push(stillHolds(t.kind, column, declared, change.was, t.bind));

    if (t.bind && change.was !== null) whereArgs.push({ type: "text", value: change.was });
  }

  return { sql: `UPDATE ${qualified(t.kind, edits.table)} SET ${sets.join(", ")} WHERE ${conds.join(" AND ")}`, args: [...args, ...whereArgs], where: words.join(", ") };
}

/** The save's statements, in order, or why one change can't be written. */
export function saveStatements(t: SaveTarget, edits: Edits): { readonly statements: readonly SaveStatement[] } | { readonly refused: string } {
  const out: SaveStatement[] = [{ text: t.kind === "mysql" ? "START TRANSACTION" : "BEGIN", risk: "session", role: "begin", row: -1, where: "" }];
  let row = 0;

  for (const r of edits.rows.values()) {
    const u = updateOf(t, edits, r.key, r.cells);

    if ("refused" in u) return u;

    // The guard reads ROW_COUNT() itself: MySQL's run doesn't ask it in between (script.ts).
    const update: SaveStatement = { text: u.sql, risk: "write", count: false, role: "update", row, where: u.where };

    out.push(t.bind ? { ...update, args: u.args } : update);
    out.push({ text: guardSql(t.kind), risk: "read", role: "guard", row, where: u.where });
    row++;
  }

  out.push({ text: "COMMIT", risk: "session", role: "commit", row: -1, where: "" });

  return { statements: out };
}

/** What a save's run said went wrong, in the row's words (null: it went through). Nothing was
 *  committed when it stopped before COMMIT. */
export function saveError(statements: readonly SaveStatement[], o: Outcome): string | null {
  const e = o.error;

  if (!e) return null;

  const st = e.index !== null ? statements[e.index] : undefined;

  if (!st) return `${e.message} · nothing was saved`;

  if (st.role === "guard") return `${st.where}: 0 rows changed: the row was changed elsewhere (or is gone) · nothing was saved`;

  if (st.role === "update") return `${st.where}: ${e.message} · nothing was saved`;

  return `${st.role === "commit" ? "the commit" : "the transaction"} failed: ${e.message}`;
}

/** The statement a failed save stopped at (its index in the list), or null. */
export const failedAt = (o: Outcome): number | null => o.error?.index ?? null;
