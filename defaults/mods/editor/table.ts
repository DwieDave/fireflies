// The preview's tables (CSV, TSV, a SQLite table's first rows), as plain
// functions (no app calls), so scripts/preview-table.test.ts can check
// them: the separator a file uses, its rows (quotes, doubled quotes and line
// breaks inside quotes), which columns are numbers, how wide each is drawn, and
// what to say when only part of it is shown.

/** Read at most this much of a file, and show at most these many rows / columns. */
export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_ROWS = 50000;
export const MAX_COLS = 200;

/** A SQLite table: its first rows. */
export const DB_ROWS = 1000;

/** A column's width in characters, at least / at most. */
export const MIN_CH = 3;
export const MAX_CH = 48;

/** A separator the table's text uses. */
export type Separator = "," | ";" | "\t" | "|";

/** Rows of fields, and whether the text went on past the rows read. */
export interface Parsed {
  readonly rows: string[][];
  readonly cut: boolean;
}

/** A column: its name, whether it's numbers (drawn right-aligned), its width in characters. */
export interface Column {
  readonly name: string;
  readonly num: boolean;
  readonly ch: number;
}

/** A table to draw: its header, its rows, its columns, and how many columns
 *  the rows really have when that's more than MAX_COLS (0 when not). */
export interface Table {
  readonly head: readonly string[];
  readonly body: readonly (readonly string[])[];
  readonly cols: readonly Column[];
  readonly wide: number;
}

/** What shownNote says is left out. */
export interface Shown {
  readonly shown: number;
  readonly total: number;
  readonly partial: boolean;
  readonly wide: number;
  readonly cols: number;
}

/** A table or a view in a SQLite database. */
export interface DbTable {
  readonly name: string;
  readonly type: "table" | "view";
}

const SEPARATORS: readonly Separator[] = [",", ";", "\t", "|"];

/** How many fields a line has with `sep`, quotes respected. */
function fields(line: string, sep: string): number {
  let n = 1;
  let q = false;

  for (const c of line) {
    if (c === '"') q = !q;
    else if (c === sep && !q) n++;
  }

  return n;
}

/** The separator: a tab for .tsv; else whichever of , ; tab | splits the first
 *  lines into the same number of fields most often (outside quotes). */
export function separator(text: string | null | undefined, ext: string): Separator {
  if (ext === "tsv") return "\t";

  const lines = (text ?? "").split(/\r?\n/, 12).filter((l) => l.length);
  let best: Separator = ",";
  let score = -1;

  for (const sep of SEPARATORS) {
    const counts = lines.map((l) => fields(l, sep));
    const first = counts[0];

    if (first === undefined || first < 2) continue;

    const same = counts.filter((c) => c === first).length;
    const s = same * 100 + first;

    if (s > score) {
      score = s;
      best = sep;
    }
  }

  return best;
}

/** Rows of fields (RFC 4180: "a ""b""", line breaks inside quotes, CRLF), at most
 *  `max` rows; `cut` says the text went on past `max`. */
export function parse(text: string | null | undefined, sep: string = ",", max = MAX_ROWS + 1): Parsed {
  const s = (text ?? "").replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let q = false;
  const n = s.length;

  while (i < n) {
    const c = s[i];

    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;

          continue;
        }

        q = false;
        i++;

        continue;
      }

      field += c;
      i++;

      continue;
    }

    if (c === '"' && field === "") {
      q = true;
      i++;

      continue;
    }

    if (c === sep) {
      row.push(field);
      field = "";
      i++;

      continue;
    }

    if (c === "\n" || c === "\r") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];

      if (c === "\r" && s[i + 1] === "\n") i++;

      i++;

      if (rows.length >= max) return { rows, cut: i < n };

      continue;
    }

    field += c;
    i++;
  }

  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  return { rows, cut: false };
}

const NUMBER = /^[-+]?(\d{1,3}([ ,_]\d{3})+|\d+)?([.,]\d+)?([eE][-+]?\d+)?%?$/;

/** Whether a cell reads as a number ("1 204", "-3.5", "1e-9", "12%"; not "", "1.2.3"). */
export const numeric = (v: string): boolean => /\d/.test(v) && NUMBER.test(v.trim());

/** A, B, …, Z, AA: a column without a header. */
export function columnName(i: number): string {
  let s = "";

  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;

  return s;
}

/** A cell on one line: breaks and tabs as visible marks. */
export const oneLine = (v: string | null | undefined): string => (v ?? "").replace(/\r?\n/g, "⏎").replace(/\t/g, "→");

/** A table to draw from rows (the first is the header): columns right-aligned
 *  when most of their cells are numbers, `ch` characters wide (the longest of a
 *  sample, within MIN_CH..MAX_CH). Columns past MAX_COLS are left out (`wide`). */
export function table(rows: readonly (readonly string[])[], options: { readonly header?: boolean } = {}): Table {
  const { header = true } = options;
  const width = Math.max(0, ...rows.slice(0, 2000).map((r) => r.length));
  const shown = Math.min(width, MAX_COLS);
  const head = header && rows[0] ? rows[0] : Array.from({ length: shown }, (_, i) => columnName(i));
  const body = header ? rows.slice(1) : rows;
  const sample = body.length > 400 ? [...body.slice(0, 300), ...body.slice(-100)] : body;
  const cols: Column[] = [];

  for (let c = 0; c < shown; c++) {
    let nums = 0;
    let filled = 0;
    let longest = (head[c] ?? "").length;

    for (const r of sample) {
      const v = r[c] ?? "";

      if (v !== "") {
        filled++;

        if (numeric(v)) nums++;
      }

      longest = Math.max(longest, oneLine(v).length);
    }

    cols.push({ name: head[c] || columnName(c), num: filled > 0 && nums / filled >= 0.9, ch: Math.max(MIN_CH, Math.min(MAX_CH, longest)) });
  }

  return { head, body, cols, wide: width > MAX_COLS ? width : 0 };
}

/** The text read stops at a line break: the bytes after the last one are a cut row. */
export function wholeLines(text: string, truncated: boolean): string {
  if (!truncated) return text;

  const at = text.lastIndexOf("\n");

  return at < 0 ? text : text.slice(0, at + 1);
}

/** What's left out, said plainly: "first 50 000 of about 1 204 330 rows", "200 of 1 024 columns". */
export function shownNote(what: Shown): string {
  const { shown, total, partial, wide, cols } = what;
  const n = (v: number): string => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const parts: string[] = [];

  if (partial) parts.push(total > shown ? `first ${n(shown)} of about ${n(total)} rows` : `first ${n(shown)} rows`);

  if (wide) parts.push(`${n(cols)} of ${n(wide)} columns`);

  return parts.join(" · ");
}

// ---- SQLite

/** sqlite3 opens the file read only and prints CSV with a header row. */
export const SQLITE_ARGS: readonly string[] = ["-readonly", "-batch", "-bail", "-csv", "-header"];

/** The tables and views, as one query's CSV. */
export const TABLES_SQL = "SELECT name, type FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type = 'view', name;";

/** A name inside "double quotes" for SQL. */
export const quoteId = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** The rows to show of `name`, and how many it has. */
export const rowsSql = (name: string, limit = DB_ROWS): string => `SELECT * FROM ${quoteId(name)} LIMIT ${limit};`;
export const countSql = (name: string): string => `SELECT count(*) AS n FROM ${quoteId(name)};`;

/** sqlite3's CSV of TABLES_SQL as the tables and views. */
export function tablesOf(csv: string): DbTable[] {
  return parse(csv, ",").rows.slice(1).flatMap((r): DbTable[] => (r[0] ? [{ name: r[0], type: r[1] === "view" ? "view" : "table" }] : []));
}

/** sqlite3's errors read for a person: "Error: in prepare, file is not a database (26)" -> "file is not a database". */
export const sqliteError = (stderr: string | null | undefined): string =>
  (stderr ?? "").trim().split("\n")[0]?.replace(/^(Parse error|Error|Runtime error)[^:]*:\s*/i, "").replace(/^in prepare,\s*/, "").replace(/\s*\(\d+\)$/, "") || "sqlite3 couldn't read it";
