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

/** The separator: a tab for .tsv; else whichever of , ; tab | splits the first
 *  lines into the same number of fields most often (outside quotes). */
export function separator(text, ext) {
  if (ext === "tsv") return "\t";
  const lines = String(text ?? "").split(/\r?\n/, 12).filter((l) => l.length);
  let best = ",", score = -1;
  for (const sep of [",", ";", "\t", "|"]) {
    const counts = lines.map((l) => fields(l, sep));
    if (!counts.length || counts[0] < 2) continue;
    const same = counts.filter((c) => c === counts[0]).length;
    const s = same * 100 + counts[0];
    if (s > score) { score = s; best = sep; }
  }
  return best;
}

/** How many fields a line has with `sep`, quotes respected. */
function fields(line, sep) {
  let n = 1, q = false;
  for (const c of line) {
    if (c === '"') q = !q;
    else if (c === sep && !q) n++;
  }
  return n;
}

/** Rows of fields (RFC 4180: "a ""b""", line breaks inside quotes, CRLF), at most
 *  `max` rows. -> { rows, cut } where `cut` says the text went on past `max`. */
export function parse(text, sep = ",", max = MAX_ROWS + 1) {
  const s = String(text ?? "").replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", i = 0, q = false;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === "") { q = true; i++; continue; }
    if (c === sep) { row.push(field); field = ""; i++; continue; }
    if (c === "\n" || c === "\r") {
      row.push(field); field = "";
      rows.push(row); row = [];
      if (c === "\r" && s[i + 1] === "\n") i++;
      i++;
      if (rows.length >= max) return { rows, cut: i < n };
      continue;
    }
    field += c; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return { rows, cut: false };
}

const NUMBER = /^[-+]?(\d{1,3}([ ,_]\d{3})+|\d+)?([.,]\d+)?([eE][-+]?\d+)?%?$/;
/** Whether a cell reads as a number ("1 204", "-3.5", "1e-9", "12%"; not "", "1.2.3"). */
export const numeric = (v) => /\d/.test(v) && NUMBER.test(String(v).trim());

/** A table to draw from rows (the first is the header): { head, body, cols, cut }.
 *  cols: [{ name, num, ch }]: right-aligned when most of its cells are numbers,
 *  `ch` characters wide (the longest of a sample, within MIN_CH..MAX_CH). Rows
 *  are padded to the widest; columns past MAX_COLS are left out (cols.cut). */
export function table(rows, { header = true } = {}) {
  const width = Math.max(0, ...rows.slice(0, 2000).map((r) => r.length));
  const shown = Math.min(width, MAX_COLS);
  const head = header && rows.length ? rows[0] : Array.from({ length: shown }, (_, i) => columnName(i));
  const body = header ? rows.slice(1) : rows;
  const sample = body.length > 400 ? [...body.slice(0, 300), ...body.slice(-100)] : body;
  const cols = [];
  for (let c = 0; c < shown; c++) {
    let nums = 0, filled = 0, longest = String(head[c] ?? "").length;
    for (const r of sample) {
      const v = r[c] ?? "";
      if (v !== "") { filled++; if (numeric(v)) nums++; }
      const len = oneLine(v).length;
      if (len > longest) longest = len;
    }
    cols.push({ name: String(head[c] ?? "") || columnName(c), num: filled > 0 && nums / filled >= 0.9, ch: Math.max(MIN_CH, Math.min(MAX_CH, longest)) });
  }
  return { head, body, cols, wide: width > MAX_COLS ? width : 0 };
}

/** A, B, …, Z, AA: a column without a header. */
export function columnName(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** A cell on one line: breaks and tabs as visible marks. */
export const oneLine = (v) => String(v ?? "").replace(/\r?\n/g, "⏎").replace(/\t/g, "→");

/** The text read stops at a line break: the bytes after the last one are a cut row. */
export function wholeLines(text, truncated) {
  if (!truncated) return text;
  const at = text.lastIndexOf("\n");
  return at < 0 ? text : text.slice(0, at + 1);
}

/** What's left out, said plainly: "first 50 000 of about 1 204 330 rows", "200 of 1 024 columns". */
export function shownNote({ shown, total, partial, wide, cols }) {
  const n = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const parts = [];
  if (partial) parts.push(total > shown ? `first ${n(shown)} of about ${n(total)} rows` : `first ${n(shown)} rows`);
  if (wide) parts.push(`${n(cols)} of ${n(wide)} columns`);
  return parts.join(" · ");
}

// ---- SQLite

/** sqlite3 opens the file read only and prints CSV with a header row. */
export const SQLITE_ARGS = ["-readonly", "-batch", "-bail", "-csv", "-header"];

/** The tables and views, as one query's CSV. */
export const TABLES_SQL = "SELECT name, type FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type = 'view', name;";

/** A name inside "double quotes" for SQL. */
export const quoteId = (name) => `"${String(name).replace(/"/g, '""')}"`;

/** The rows to show of `name`, and how many it has. */
export const rowsSql = (name, limit = DB_ROWS) => `SELECT * FROM ${quoteId(name)} LIMIT ${limit};`;
export const countSql = (name) => `SELECT count(*) AS n FROM ${quoteId(name)};`;

/** sqlite3's CSV of TABLES_SQL -> [{ name, type }]. */
export function tablesOf(csv) {
  const { rows } = parse(csv, ",");
  return rows.slice(1).filter((r) => r[0]).map((r) => ({ name: r[0], type: r[1] === "view" ? "view" : "table" }));
}

/** sqlite3's errors read for a person: "Error: in prepare, file is not a database (26)" -> "file is not a database". */
export const sqliteError = (stderr) => String(stderr ?? "").trim().split("\n")[0].replace(/^(Parse error|Error|Runtime error)[^:]*:\s*/i, "").replace(/^in prepare,\s*/, "").replace(/\s*\(\d+\)$/, "") || "sqlite3 couldn't read it";
