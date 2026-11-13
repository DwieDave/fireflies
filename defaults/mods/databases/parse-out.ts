// What psql and sqlite3 printed for one run (script.ts's markers between the
// statements): each statement's rows (CSV, NULL as NULL_MARK), how many rows a
// write changed, and the error that stopped the run, placed in its statement
// (line and column when the client says). mysql's XML is parse-mysql.ts's,
// libSQL's JSON hrana.ts's; all of them answer with an Outcome.

import { parse as parseCsv } from "./table.ts";
import { MARK, NULL_MARK } from "./script.ts";
import { lineCol } from "./split.ts";

/** A cell: its text as the client printed it, or null. */
export type Cell = string | null;

/** A result's rows: the column names (and types where the client says), the rows. */
export interface ResultSet {
  readonly columns: readonly string[];
  readonly types?: readonly string[];
  readonly rows: readonly (readonly Cell[])[];
}

/** One statement's answer: its rows (null: it returned none), how many rows it changed, the
 *  client's tag for it ("UPDATE 3"). */
export interface StatementResult {
  readonly index: number;
  readonly set: ResultSet | null;
  readonly affected: number | null;
  readonly tag: string | null;
}

/** The error that stopped a run: which statement (null: before any, e.g. connecting), the
 *  client's words, and where in that statement (1-based, null: not said). */
export interface RunError {
  readonly index: number | null;
  readonly message: string;
  readonly line: number | null;
  readonly col: number | null;
  readonly hint: string | null;
}

/** A run's answer. */
export interface Outcome {
  readonly results: readonly StatementResult[];
  readonly error: RunError | null;
  /** The output went past the limit: the last result's rows are the first ones only. */
  readonly cut: boolean;
}

/** The output cut at the markers: each statement's index and text, and the last marker seen. */
interface Sections {
  readonly parts: readonly (readonly [number, string])[];
  readonly last: number | null;
}

/** Sections of output after each marker: [statement index, its text]; the last marker seen. */
function sections(stdout: string): Sections {
  const parts: [number, string][] = [];
  const re = new RegExp(`^${MARK} (\\d+)$`, "gm");
  let at: number | null = null;
  let from = 0;

  for (let m = re.exec(stdout); m; m = re.exec(stdout)) {
    if (at !== null) parts.push([at, stdout.slice(from, m.index)]);

    at = Number(m[1]);
    from = m.index + m[0].length + 1;
  }

  if (at !== null) parts.push([at, stdout.slice(Math.min(from, stdout.length))]);

  return { parts, last: at };
}

/** CSV with a header row as a result set (NULL_MARK as null); null when there was nothing. */
export function csvSet(text: string): ResultSet | null {
  if (!text.trim()) return null;

  const rows = parseCsv(text, ",").rows;
  const [head, ...body] = rows;

  if (!head) return null;

  return { columns: head, rows: body.map((r) => r.map((v) => (v === NULL_MARK ? null : v))) };
}

const TAG = /^([A-Z]+(?: [A-Z]+)*)((?: \d+)+)$/;

/** A psql section: rows, a command's tag ("UPDATE 3", "INSERT 0 2"), or both (… RETURNING). */
function psqlSection(index: number, text: string, writes: boolean): StatementResult {
  const lines = text.replace(/\n$/, "").split("\n");
  const lastLine = lines.at(-1) ?? "";
  const tagged = writes ? TAG.exec(lastLine) : null;

  if (!tagged) return { index, set: csvSet(text), affected: null, tag: null };

  const counts = (tagged[2] ?? "").trim().split(" ").map(Number);

  return { index, set: csvSet(lines.slice(0, -1).join("\n")), affected: counts.at(-1) ?? null, tag: lastLine };
}

/** psql's error: `psql:<file>:<n>: ERROR:  …` (or `psql: error: …` connecting), its `LINE n:`
 *  and the caret under it, and a HINT. */
export function psqlError(stderr: string, index: number | null): RunError | null {
  const lines = stderr.split("\n");
  const at = lines.findIndex((l) => /^(psql:.*?:\d+: )?(ERROR|FATAL|PANIC):/.test(l) || l.startsWith("psql: error:") || l.startsWith("fireflies-db:"));

  if (at < 0) return stderr.trim() ? { index, message: lines.find((l) => l.trim()) ?? "", line: null, col: null, hint: null } : null;

  const head = lines[at] ?? "";

  const message = head.replace(/^psql:.*?:\d+: /, "").replace(/^psql: error: /, "").replace(/^(ERROR|FATAL|PANIC):\s+/, "").replace(/^fireflies-db: /, "")
    .replace(/^connection to server .*? failed: (FATAL:\s+)?/, "");

  const lineAt = lines.findIndex((l, i) => i > at && /^LINE \d+: /.test(l));
  const where = lineAt >= 0 ? /^LINE (\d+): (\.\.\.)?/.exec(lines[lineAt] ?? "") : null;
  const caret = lineAt >= 0 ? (lines[lineAt + 1] ?? "").indexOf("^") : -1;
  const lead = where ? where[0].length - (where[2] ? 3 : 0) : 0;
  const hint = lines.find((l, i) => i > at && l.startsWith("HINT:"))?.replace(/^HINT:\s+/, "") ?? null;
  const startup = !head.startsWith("psql:") || head.startsWith("psql: error:");

  return { index: startup ? null : index, message, line: where ? Number(where[1]) : null, col: where && caret >= 0 ? caret - lead + 1 : null, hint };
}

/** What psql printed for statements `writes` (true where a statement writes, so a last line
 *  like "UPDATE 3" is its tag). */
export function parsePsql(stdout: string, stderr: string, code: number, writes: readonly boolean[], cut = false): Outcome {
  const { parts, last } = sections(stdout);
  const results = parts.map(([i, text]) => psqlSection(i, text, writes[i] ?? false));
  const error = code === 0 ? null : psqlError(stderr, last) ?? { index: last, message: `psql exited with ${code}`, line: null, col: null, hint: null };

  // The statement that failed printed nothing of its own.
  return { results: error && error.index !== null ? results.filter((r) => r.index !== error.index || r.set) : results, error, cut };
}

const CHANGES = /^changes: +(\d+) +total_changes: +\d+$/;

/** A sqlite3 section: CSV rows, then `.changes on`'s line. */
function sqliteSection(index: number, text: string): StatementResult {
  const lines = text.replace(/\n$/, "").split("\n");
  const changed = CHANGES.exec(lines.at(-1) ?? "");
  const body = changed ? lines.slice(0, -1).join("\n") : text;

  return { index, set: csvSet(body), affected: changed ? Number(changed[1]) : null, tag: null };
}

/** sqlite3's error: `Parse error near line N: …` (or Runtime error, or Error: …), then the
 *  statement on one line and `^--- error here` under the place: the column in that line is
 *  the offset in the statement (its line breaks printed as spaces). */
export function sqliteError(stderr: string, index: number | null, statement: string | null): RunError | null {
  const lines = stderr.split("\n");
  const at = lines.findIndex((l) => /^(Parse error|Runtime error|Error)\b/.test(l) || l.startsWith("fireflies-db:"));

  if (at < 0) return stderr.trim() ? { index, message: lines.find((l) => l.trim())?.trim() ?? "", line: null, col: null, hint: null } : null;

  const head = lines[at] ?? "";
  const message = head.replace(/^(Parse error|Runtime error|Error)[^:]*:\s*/, "").replace(/^fireflies-db: /, "").replace(/^in prepare,\s*/, "").replace(/\s*\(\d+\)$/, "");
  const caretLine = lines.find((l, i) => i > at && l.includes("^--- error here")) ?? "";
  const offset = caretLine.indexOf("^") - 2;

  if (offset < 0 || statement === null) return { index, message, line: null, col: null, hint: null };

  const { line, col } = lineCol(statement, offset);

  return { index, message, line, col, hint: null };
}

/** What sqlite3 printed; `statements` the texts run (for an error's place). */
export function parseSqlite(stdout: string, stderr: string, code: number, statements: readonly string[], cut = false): Outcome {
  const { parts, last } = sections(stdout);
  const results = parts.map(([i, text]) => sqliteSection(i, text));

  const error = code === 0 ? null : sqliteError(stderr, last, last === null ? null : statements[last] ?? null)
    ?? { index: last, message: `sqlite3 exited with ${code}`, line: null, col: null, hint: null };

  return { results: error && error.index !== null ? results.filter((r) => r.index !== error.index || r.set) : results, error, cut };
}
