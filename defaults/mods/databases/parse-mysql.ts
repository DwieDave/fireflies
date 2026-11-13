// What `mysql --xml` printed for one run: every result a <resultset> of
// <row>s of <field name="…">value</field> (NULL is xsi:nil="true", so it
// stays apart from the text 'NULL'), script.ts's marker results between the
// statements, and ROW_COUNT() after each write. Its error names the script
// file's line, read back to the statement and its own line; MySQL's "near
// '…' at line N" places it in that line. MariaDB prints the same.

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
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, name: string) => {
    if (name.startsWith("#x")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));

    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));

    return ENTITIES.get(name) ?? whole;
  });
}

const RESULTSET = /<resultset\b[^>]*?(\/>|>([\s\S]*?)<\/resultset>)/g;
const ROW = /<row>([\s\S]*?)<\/row>/g;
const FIELD = /<field name="([^"]*)"(\s+xsi:nil="true")?\s*(\/>|>([\s\S]*?)<\/field>)/g;

/** One resultset's body. */
function resultset(body: string): Xml {
  const columns: string[] = [];
  const rows: Cell[][] = [];

  for (const r of body.matchAll(ROW)) {
    const row: Cell[] = [];

    for (const f of (r[1] ?? "").matchAll(FIELD)) {
      if (!rows.length) columns.push(unescapeXml(f[1] ?? ""));

      row.push(f[2] ? null : unescapeXml(f[4] ?? ""));
    }

    rows.push(row);
  }

  return { columns, rows };
}

/** The resultsets of the output, in order. */
export function resultsets(stdout: string): Xml[] {
  return [...stdout.matchAll(RESULTSET)].map((m) => resultset(m[2] ?? ""));
}

/** mysql's error: `ERROR 1146 (42S02) at line 3: …` (or ERROR 2002 connecting). */
export function mysqlError(stderr: string, lines: readonly number[], statements: readonly string[]): RunError | null {
  const head = stderr.split("\n").find((l) => /^ERROR \d+/.test(l) || l.startsWith("fireflies-db:"));

  if (!head) {
    const said = stderr.split("\n").find((l) => l.trim() && !l.includes("[Warning]"));

    return said ? { index: null, message: said.trim(), line: null, col: null, hint: null } : null;
  }

  const m = /^ERROR (\d+) \(([0-9A-Z]+)\)(?: at line (\d+))?: (.*)$/.exec(head);
  const message = m ? m[4] ?? head : head.replace(/^fireflies-db: /, "");
  const fileLine = m?.[3] ? Number(m[3]) : null;
  // The statement whose lines hold the file's line; connecting errors (2002, 1045) name none.
  let index: number | null = null;

  if (fileLine !== null) lines.forEach((start, i) => { if (start <= fileLine) index = i; });

  const placed = index === null ? null : place(message, statements[index] ?? "");

  return { index, message, line: placed?.line ?? null, col: placed?.col ?? null, hint: null };
}

/** "… near 'frm t' at line 2": the line in the statement, and the column where that text starts. */
function place(message: string, statement: string): { line: number; col: number | null } | null {
  const m = /near '([\s\S]*)' at line (\d+)$/.exec(message);

  if (!m) return null;

  const line = Number(m[2]);
  const text = statement.split("\n")[line - 1] ?? "";
  const near = (m[1] ?? "").split("\n")[0] ?? "";
  const at = near ? text.indexOf(near) : -1;

  return { line, col: at >= 0 ? at + 1 : null };
}

/** What mysql printed; `lines` where each statement starts in the script, `statements` their texts. */
export function parseMysql(stdout: string, stderr: string, code: number, lines: readonly number[], statements: readonly string[], cut = false): Outcome {
  const results: StatementResult[] = [];
  let index: number | null = null;

  for (const set of resultsets(stdout)) {
    const name = set.columns[0];

    if (name === "__ff") {
      const m = new RegExp(`^${MARK} (\\d+)$`).exec(set.rows[0]?.[0] ?? "");

      index = m ? Number(m[1]) : null;

      if (index !== null) results.push({ index, set: null, affected: null, tag: null });
    } else if (name === "__ff_affected") {
      const last = results.at(-1);

      if (last) results[results.length - 1] = { ...last, affected: Number(set.rows[0]?.[0] ?? 0) };
    } else if (index !== null) {
      const last = results.at(-1);
      const rs: ResultSet = { columns: set.columns, rows: set.rows };

      if (last) results[results.length - 1] = { ...last, set: rs };
    }
  }

  const error = code === 0 ? null : mysqlError(stderr, lines, statements) ?? { index, message: `mysql exited with ${code}`, line: null, col: null, hint: null };

  return { results: results.filter((r) => !error || r.index !== error.index), error, cut };
}
