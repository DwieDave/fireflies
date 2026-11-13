// The file a client reads for one run: the statements in order, each after a
// marker the parsers split the output at (parse-out.ts, parse-mysql.ts), so
// every statement's rows and its error land with it. Also where each statement
// starts in the file (a MySQL error names the file's line).

import type { Kind } from "./kinds.ts";
import type { Risk } from "./safety.ts";

/** The marker before each statement's output: `__ff_stmt__ <n>` on a line of its own. */
export const MARK = "__ff_stmt__";

/** The value a client prints for NULL (psql, sqlite3), so an empty text stays an empty text. */
export const NULL_MARK = "␀";

/** A statement to run: its text (no closing semicolon) and how much it can change. */
export interface ScriptStatement {
  readonly text: string;
  readonly risk: Risk;
}

/** A client's script: its text and the 1-based line of the file each statement starts on. */
export interface Script {
  readonly text: string;
  readonly lines: readonly number[];
}

/** A statement closed for the client: with its semicolon (a trigger's END keeps it). */
const closed = (text: string): string => (text.trimEnd().endsWith(";") ? text.trimEnd() : `${text.trimEnd()};`);

/** The marker line in the client's own words. */
function marker(kind: Kind, i: number): string {
  switch (kind) {
    case "postgres": return `\\echo ${MARK} ${i}`;
    case "mysql": return `SELECT '${MARK} ${i}' AS __ff;`;
    case "sqlite":
    case "libsql": return `.print ${MARK} ${i}`;
  }
}

/** The script for `statements`: a MySQL connection marked read only says so first, and after
 *  each MySQL write asks how many rows it changed (the XML output doesn't say). */
export function scriptOf(kind: Kind, statements: readonly ScriptStatement[], readonly = false): Script {
  const out: string[] = [];
  const lines: number[] = [];

  if (kind === "mysql" && readonly) out.push("SET SESSION TRANSACTION READ ONLY;");

  statements.forEach((st, i) => {
    out.push(marker(kind, i));
    lines.push(out.join("\n").split("\n").length + 1);
    out.push(closed(st.text));

    if (kind === "mysql" && st.risk !== "read") out.push("SELECT ROW_COUNT() AS __ff_affected;");
  });

  return { text: `${out.join("\n")}\n`, lines };
}
