// What `mysql --xml` printed for one run: every result a <resultset> of
// <row>s of <field name="…">value</field> (NULL is xsi:nil="true", so it
// stays apart from the text 'NULL'), script.ts's marker results between the
// statements, and ROW_COUNT() after each write. Its error names the script
// file's line, read back to the statement and its own line; MySQL's "near
// '…' at line N" places it in that line. MariaDB prints the same.

import { Array as Arr, Option, String as Str } from "effect";
import { replaceWith } from "@fireflies/kit";
import type { Cell, Outcome, ResultSet, RunError, StatementResult } from "./parse-out.ts";
import { MARK } from "./script.ts";

/** A resultset as read: its fields' names (from the first row) and its rows. */
interface Xml {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly Cell[])[];
}

const ENTITIES = new Map([["lt", "<"], ["gt", ">"], ["amp", "&"], ["quot", '"'], ["apos", "'"]]);

/** XML text with its entities (&lt; &#10; &#x9;) read. */
export function unescapeXml(s: string): string {
  return replaceWith(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, ([whole, name = ""]) => {
    if (Str.startsWith("#x")(name)) return String.fromCodePoint(Number.parseInt(Str.slice(2)(name), 16));

    if (Str.startsWith("#")(name)) return String.fromCodePoint(Number(Str.slice(1)(name)));

    return ENTITIES.get(name) ?? whole;
  })(s);
}

const RESULTSET = /<resultset\b[^>]*?(\/>|>([\s\S]*?)<\/resultset>)/g;
const ROW = /<row>([\s\S]*?)<\/row>/g;
const FIELD = /<field name="([^"]*)"(\s+xsi:nil="true")?\s*(\/>|>([\s\S]*?)<\/field>)/g;

/** One resultset's body. */
function resultset(body: string): Xml {
  const columns: string[] = [];
  const rows: Cell[][] = [];

  for (const r of Str.matchAll(ROW)(body)) {
    const row: Cell[] = [];

    for (const f of Str.matchAll(FIELD)((r[1] ?? ""))) {
      if (rows.length === 0) columns.push(unescapeXml(f[1] ?? ""));

      row.push(f[2] !== undefined && Str.isNonEmpty(f[2]) ? null : unescapeXml(f[4] ?? ""));
    }

    rows.push(row);
  }

  return { columns, rows };
}

/** The resultsets of the output, in order. */
export function resultsets(stdout: string): Xml[] {
  return Arr.map([...Str.matchAll(RESULTSET)(stdout)], (m) => resultset(m[2] ?? ""));
}

/** mysql's error: `ERROR 1146 (42S02) at line 3: …` (or ERROR 2002 connecting). */
export function mysqlError(stderr: string, lines: readonly number[], statements: readonly string[]): RunError | null {
  const head = Option.getOrUndefined(Arr.findFirst(Str.split(stderr, "\n"), (l) => /^ERROR \d+/.test(l) || Str.startsWith("fireflies-db:")(l)));

  if (head === undefined || Str.isEmpty(head)) {
    const said = Option.getOrUndefined(Arr.findFirst(Str.split(stderr, "\n"), (l) => Str.isNonEmpty(Str.trim(l)) && !Str.includes("[Warning]")(l)));

    return said !== undefined && Str.isNonEmpty(said) ? { index: null, message: Str.trim(said), line: null, col: null, hint: null } : null;
  }

  const m = /^ERROR (\d+) \(([0-9A-Z]+)\)(?: at line (\d+))?: (.*)$/.exec(head);
  const message = m !== null ? m[4] ?? head : Str.replace(/^fireflies-db: /, "")(head);
  const fileLine = m?.[3] !== undefined && Str.isNonEmpty(m?.[3]) ? Number(m[3]) : null;
  // The statement whose lines hold the file's line; connecting errors (2002, 1045) name none.
  let index: number | null = null;

  if (fileLine !== null) Arr.forEach(lines, (start, i) => { if (start <= fileLine) index = i; });

  const placed = index === null ? null : place(message, statements[index] ?? "");

  return { index, message, line: placed?.line ?? null, col: placed?.col ?? null, hint: null };
}

/** "… near 'frm t' at line 2": the line in the statement, and the column where that text starts. */
function place(message: string, statement: string): { line: number; col: number | null } | null {
  const m = /near '([\s\S]*)' at line (\d+)$/.exec(message);

  if (m === null) return null;

  const line = Number(m[2]);
  const text = Str.split(statement, "\n")[line - 1] ?? "";
  const near = Str.split((m[1] ?? ""), "\n")[0] ?? "";
  const at = Str.isNonEmpty(near) ? Str.indexOf(near)(text) : Option.none();

  return { line, col: Option.getOrNull(Option.map(at, (i) => i + 1)) };
}

/** What mysql printed; `lines` where each statement starts in the script, `statements` their texts. */
export function parseMysql(stdout: string, stderr: string, code: number, lines: readonly number[], statements: readonly string[], cut = false): Outcome {
  const results: StatementResult[] = [];
  let index: number | null = null;

  for (const set of resultsets(stdout)) {
    const name = set.columns[0];

    if (name === "__ff") {
      const m = new RegExp(`^${MARK} (\\d+)$`).exec(set.rows[0]?.[0] ?? "");

      index = m !== null ? Number(m[1]) : null;

      if (index !== null) results.push({ index, set: null, affected: null, tag: null });
    } else if (name === "__ff_affected") {
      const last = results.at(-1);

      if (last !== undefined) results[results.length - 1] = { ...last, affected: Number(set.rows[0]?.[0] ?? 0) };
    } else if (index !== null) {
      const last = results.at(-1);
      const rs: ResultSet = { columns: set.columns, rows: set.rows };

      if (last !== undefined) results[results.length - 1] = { ...last, set: rs };
    }
  }

  const error = code === 0 ? null : mysqlError(stderr, lines, statements) ?? { index, message: `mysql exited with ${code}`, line: null, col: null, hint: null };

  return { results: Arr.filter(results, (r) => error === null || r.index !== error.index), error, cut };
}
