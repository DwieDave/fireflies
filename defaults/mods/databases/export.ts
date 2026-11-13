// A result or a table's rows out: CSV (RFC 4180, NULL as an empty field),
// JSON (an array of objects, numbers kept as numbers where the text is one
// exactly, NULL as null) or SQL inserts for the same kind of database (one
// INSERT per row, names and texts quoted for it).

import type { Kind } from "./kinds.ts";
import type { Cell, ResultSet } from "./parse-out.ts";
import { quoteName, quoteText } from "./catalog.ts";
import type { RunIo } from "./runner.ts";
import { nonce } from "./runner.ts";

/** The export formats. */
export type Format = "csv" | "json" | "sql";

export const FORMATS: readonly Format[] = ["csv", "json", "sql"];

export const FORMAT_NAME = { csv: "CSV", json: "JSON", sql: "SQL inserts" } as const satisfies { readonly [F in Format]: string };

export const EXTENSION = { csv: "csv", json: "json", sql: "sql" } as const satisfies { readonly [F in Format]: string };

/** A CSV field: quoted when it holds a comma, quote or line break. */
const csvField = (v: Cell): string => (v === null ? "" : /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** A result as CSV with a header row. */
export function toCsv(set: ResultSet): string {
  return [set.columns, ...set.rows].map((r) => r.map(csvField).join(",")).join("\n") + "\n";
}

/** Whether a text is exactly a number's own spelling ("12", "-3.5"; not "012", "1e3", "1 000"). */
export const exactNumber = (v: string): boolean => /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v) && String(Number(v)) === v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

/** Which columns are numbers: every non-null cell an exact number, at least one of them. */
function numberColumns(set: ResultSet): boolean[] {
  return set.columns.map((_c, i) => {
    const cells = set.rows.map((r) => r[i] ?? null).filter((v): v is string => v !== null);

    return cells.length > 0 && cells.every(exactNumber);
  });
}

/** A result as a JSON array of objects. */
export function toJson(set: ResultSet): string {
  const nums = numberColumns(set);

  const rows = set.rows.map((r) => Object.fromEntries(set.columns.map((c, i) => {
    const v = r[i] ?? null;

    return [c, v === null ? null : nums[i] ? Number(v) : v];
  })));

  return `${JSON.stringify(rows, null, 2)}\n`;
}

/** A result as INSERT statements into `table` (a name as the kind writes it, already quoted). */
export function toInserts(set: ResultSet, kind: Kind, table: string): string {
  const nums = numberColumns(set);
  const cols = set.columns.map((c) => quoteName(kind, c)).join(", ");

  return set.rows.map((r) => {
    const values = set.columns.map((_c, i) => {
      const v = r[i] ?? null;

      return v === null ? "NULL" : nums[i] ? v : quoteText(kind, v);
    });

    return `INSERT INTO ${table} (${cols}) VALUES (${values.join(", ")});`;
  }).join("\n") + "\n";
}

/** A result in a format. */
export function exportText(set: ResultSet, format: Format, kind: Kind, table: string): string {
  return format === "csv" ? toCsv(set) : format === "json" ? toJson(set) : toInserts(set, kind, table);
}

/** A file name for an export: the table's (or "result") and the date, safe in a path. */
export function exportName(base: string, format: Format, now = new Date()): string {
  const day = now.toISOString().slice(0, 10);

  return `${base.replace(/[^A-Za-z0-9._-]+/g, "_") || "result"}-${day}.${EXTENSION[format]}`;
}

/** writeTextFile takes at most 1 MiB: a bigger export is written in parts this many characters (3 bytes each at most). */
export const PART = 320 * 1024;

/** Writes `text` to `dest` (any size): parts in the private folder, joined there by cat, then gone.
 *  Resolves with what went wrong, or null. */
export async function writeOut(io: RunIo, dir: string, dest: string, text: string): Promise<string | null> {
  const n = nonce();
  const parts: string[] = [];

  try {
    for (let i = 0; i * PART < text.length || i === 0; i++) {
      const part = `${dir}/x-${n}-${String(i).padStart(5, "0")}`;

      await io.writeTextFile(part, text.slice(i * PART, (i + 1) * PART), null);
      parts.push(part);
    }
  } catch (error) {
    await io.exec("rm", ["-f", ...parts]).catch(() => null);

    return error instanceof Error ? error.message : String(error);
  }

  const r = await io.exec("sh", ["-c", 'dest=$1; shift; cat "$@" > "$dest"; r=$?; rm -f "$@"; exit $r', "ff-export", dest, ...parts]).catch(() => null);

  return r?.code === 0 ? null : (r?.stderr.trim() || "couldn't write the file");
}
