// What psql and sqlite3 printed for one run (script.ts's markers between the
// statements): each statement's rows (CSV, NULL as NULL_MARK), how many rows a
// write changed, and the error that stopped the run, placed in its statement
// (line and column when the client says). mysql's XML is parse-mysql.ts's,
// libSQL's JSON hrana.ts's; all of them answer with an Outcome.

import { parse as parseCsv } from "@fireflies/viewer/table";
import { Array as Arr, Option, String as Str } from "effect";
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
    if (at !== null) parts.push([at, Str.slice(from, m.index)(stdout)]);

    at = Number(m[1]);
    from = m.index + m[0].length + 1;
  }

  if (at !== null) parts.push([at, Str.slice(Math.min(from, stdout.length))(stdout)]);

  return { parts, last: at };
}

/** CSV with a header row as a result set (NULL_MARK as null); null when there was nothing. */
export function csvSet(text: string): ResultSet | null {
  if (Str.isEmpty(Str.trim(text))) return null;

  const rows = parseCsv(text, ",").rows;
  const [head, ...body] = rows;

  if (head === undefined) return null;

  return { columns: head, rows: Arr.map(body, (r) => Arr.map(r, (v) => (v === NULL_MARK ? null : v))) };
}

const TAG = /^([A-Z]+(?: [A-Z]+)*)((?: \d+)+)$/;

/** A psql section: rows, a command's tag ("UPDATE 3", "INSERT 0 2"), or both (… RETURNING). */
function psqlSection(index: number, text: string, writes: boolean): StatementResult {
  const lines = Str.split(Str.replace(/\n$/, "")(text), "\n");
  const lastLine = lines.at(-1) ?? "";
  const tagged = writes ? TAG.exec(lastLine) : null;

  if (tagged === null) return { index, set: csvSet(text), affected: null, tag: null };

  const counts = Arr.map(Str.split(Str.trim((tagged[2] ?? "")), " "), Number);

  return { index, set: csvSet(Arr.join(lines.slice(0, -1), "\n")), affected: counts.at(-1) ?? null, tag: lastLine };
}

/** psql's error: `psql:<file>:<n>: ERROR:  …` (or `psql: error: …` connecting), its `LINE n:`
 *  and the caret under it, and a HINT. */
export function psqlError(stderr: string, index: number | null): RunError | null {
  const lines = Str.split(stderr, "\n");
  const at = Option.getOrElse(Arr.findFirstIndex(lines, (l) => /^(psql:.*?:\d+: )?(ERROR|FATAL|PANIC):/.test(l) || Str.startsWith("psql: error:")(l) || Str.startsWith("fireflies-db:")(l)), () => -1);

  if (at < 0) return Str.isNonEmpty(Str.trim(stderr)) ? { index, message: Option.getOrUndefined(Arr.findFirst(lines, (l) => Str.isNonEmpty(Str.trim(l)))) ?? "", line: null, col: null, hint: null } : null;

  const head = lines[at] ?? "";

  const message = Str.replace(/^connection to server .*? failed: (FATAL:\s+)?/, "")(Str.replace(/^fireflies-db: /, "")(Str.replace(/^(ERROR|FATAL|PANIC):\s+/, "")(Str.replace(/^psql: error: /, "")(Str.replace(/^psql:.*?:\d+: /, "")(head)))));

  const lineAt = Option.getOrElse(Arr.findFirstIndex(lines, (l, i) => i > at && /^LINE \d+: /.test(l)), () => -1);
  const where = lineAt >= 0 ? /^LINE (\d+): (\.\.\.)?/.exec(lines[lineAt] ?? "") : null;
  const caret = lineAt >= 0 ? Option.getOrElse(Str.indexOf("^")(lines[lineAt + 1] ?? ""), () => -1) : -1;
  const lead = where !== null ? where[0].length - (where[2] !== undefined && Str.isNonEmpty(where[2]) ? 3 : 0) : 0;
  const hint = Option.getOrNull(Option.map(Arr.findFirst(lines, (l, i) => i > at && Str.startsWith("HINT:")(l)), Str.replace(/^HINT:\s+/, "")));
  const startup = !Str.startsWith("psql:")(head) || Str.startsWith("psql: error:")(head);

  return { index: startup ? null : index, message, line: where !== null ? Number(where[1]) : null, col: where !== null && caret >= 0 ? caret - lead + 1 : null, hint };
}

/** What psql printed for statements `writes` (true where a statement writes, so a last line
 *  like "UPDATE 3" is its tag). */
export function parsePsql(stdout: string, stderr: string, code: number, writes: readonly boolean[], cut = false): Outcome {
  const { parts, last } = sections(stdout);
  const results = Arr.map(parts, ([i, text]) => psqlSection(i, text, writes[i] ?? false));
  const error = code === 0 ? null : psqlError(stderr, last) ?? { index: last, message: `psql exited with ${code}`, line: null, col: null, hint: null };

  // The statement that failed printed nothing of its own.
  return { results: error !== null && error.index !== null ? Arr.filter(results, (r) => r.index !== error.index || r.set !== null) : results, error, cut };
}

const CHANGES = /^changes: +(\d+) +total_changes: +\d+$/;

/** A sqlite3 section: CSV rows, then `.changes on`'s line. */
function sqliteSection(index: number, text: string, writes: boolean): StatementResult {
  const lines = Str.split(Str.replace(/\n$/, "")(text), "\n");
  const changed = CHANGES.exec(lines.at(-1) ?? "");
  const body = changed !== null ? Arr.join(lines.slice(0, -1), "\n") : text;

  // .changes on speaks after every statement: a read changed nothing, it returned rows.
  return { index, set: csvSet(body), affected: changed !== null && writes ? Number(changed[1]) : null, tag: null };
}

/** sqlite3's error: `Parse error near line N: …` (or Runtime error, or Error: …), then the
 *  statement on one line and `^--- error here` under the place: the column in that line is
 *  the offset in the statement (its line breaks printed as spaces). */
export function sqliteError(stderr: string, index: number | null, statement: string | null): RunError | null {
  const lines = Str.split(stderr, "\n");
  const at = Option.getOrElse(Arr.findFirstIndex(lines, (l) => /^(Parse error|Runtime error|Error)\b/.test(l) || Str.startsWith("fireflies-db:")(l)), () => -1);

  if (at < 0) return Str.isNonEmpty(Str.trim(stderr)) ? { index, message: Str.trim(Option.getOrElse(Arr.findFirst(lines, (l) => Str.isNonEmpty(Str.trim(l))), () => "")), line: null, col: null, hint: null } : null;

  const head = lines[at] ?? "";
  const message = Str.replace(/\s*\(\d+\)$/, "")(Str.replace(/^in prepare,\s*/, "")(Str.replace(/^fireflies-db: /, "")(Str.replace(/^(Parse error|Runtime error|Error)[^:]*:\s*/, "")(head))));
  const caretLine = Option.getOrUndefined(Arr.findFirst(lines, (l, i) => i > at && Str.includes("^--- error here")(l))) ?? "";
  const offset = Option.getOrElse(Str.indexOf("^")(caretLine), () => -1) - 2;

  if (offset < 0 || statement === null) return { index, message, line: null, col: null, hint: null };

  const { line, col } = lineCol(statement, offset);

  return { index, message, line, col, hint: null };
}

/** What sqlite3 printed; `statements` the texts run (for an error's place). */
export function parseSqlite(stdout: string, stderr: string, code: number, statements: readonly string[], cut = false, writes: readonly boolean[] = []): Outcome {
  const { parts, last } = sections(stdout);
  const results = Arr.map(parts, ([i, text]) => sqliteSection(i, text, writes[i] ?? false));

  const error = code === 0 ? null : sqliteError(stderr, last, last === null ? null : statements[last] ?? null)
    ?? { index: last, message: `sqlite3 exited with ${code}`, line: null, col: null, hint: null };

  return { results: error !== null && error.index !== null ? Arr.filter(results, (r) => r.index !== error.index || r.set !== null) : results, error, cut };
}

/** A statement's answer in a few words: a read's rows ("10 rows"), a write's changed rows
 *  ("3 changed"; a write that returned rows, its rows), else "done". */
export function resultWords(r: StatementResult | undefined, writes: boolean): string {
  const rows = (r?.set !== null && r?.set !== undefined) && r.set.columns.length !== 0 ? r.set.rows.length : null;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

  if (rows !== null) return n(rows, "row", "rows");

  if (!writes) return n(0, "row", "rows");

  return r?.affected !== null && r?.affected !== undefined ? `${r.affected} changed` : "done";
}

// "no such table: x", 'relation "x" does not exist', "Table 'db.x' doesn't exist", "Unknown column 'x'".
const NAMED = /(?:no such (?:table|column|function)|relation|column|table|unknown column|function)\s*:?\s*["'`]?([A-Za-z_][\w$.]*)["'`]?/i;

/** The name an error is about ("lantern" in "no such table: lantern"), its last dotted part. */
export function namedIn(message: string): string | null {
  return Option.getOrNull(Option.map(Option.fromNullishOr(NAMED.exec(message)?.[1]), (n) => Arr.lastNonEmpty(Str.split(n, "."))));
}

/** Where in the statement an error without a place is: at the name it is about, if that's there. */
export function placeByName(message: string, statement: string): { readonly line: number; readonly col: number } | null {
  const name = namedIn(message);

  if (name === null || Str.isEmpty(name)) return null;

  const m = new RegExp(`(?<![\\w$])["'\`]?${Str.replace(/[$]/g, "\\$")(name)}["'\`]?(?![\\w$])`, "i").exec(statement);

  return m !== null ? lineCol(statement, m.index) : null;
}

/** An error placed where it can be: its own place, else at the name it is about. */
export function placed(e: RunError, statements: readonly string[]): RunError {
  if (e.line !== null || e.index === null) return e;

  const at = placeByName(e.message, statements[e.index] ?? "");

  return at !== null ? { ...e, line: at.line, col: at.col } : e;
}

/** Edits between two names (insertions, deletions, changes). */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_x, j) => j);

  for (let i = 1; i <= a.length; i++) {
    const next = [i];

    for (let j = 1; j <= b.length; j++) next.push(Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)));

    row = next;
  }

  return row[b.length] ?? 0;
}

/** The known name closest to a missing one (a typo, a plural), or null when none is near. */
export function closest(name: string, known: readonly string[]): string | null {
  const low = Str.toLowerCase(name);
  let best: string | null = null;
  let bestD = Math.max(1, Math.floor(name.length / 4)) + 1;

  for (const k of known) {
    const d = distance(low, Str.toLowerCase(k));

    if (d > 0 && d < bestD) {
      best = k;
      bestD = d;
    }
  }

  return best;
}
