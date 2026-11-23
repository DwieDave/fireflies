// A result or a table's rows out: CSV (RFC 4180, NULL as an empty field),
// JSON (an array of objects, numbers kept as numbers where the text is one
// exactly, NULL as null) or SQL inserts for the same kind of database (one
// INSERT per row, names and texts quoted for it).

import { Array as Arr, DateTime, Effect, Record as Rec, Schema, String as Str } from "effect";
import { Exec, Files, execOk } from "@fireflies/kit";
import type { ExecError, ExitError, FileError, StaleFile } from "@fireflies/kit";
import type { Kind } from "./kinds.ts";
import type { Cell, ResultSet } from "./parse-out.ts";
import { quoteName, quoteText } from "./catalog.ts";
import { nonce } from "./runner.ts";

/** The export formats. */
export type Format = "csv" | "json" | "sql";

export const FORMATS: readonly Format[] = ["csv", "json", "sql"];

export const FORMAT_NAME = { csv: "CSV", json: "JSON", sql: "SQL inserts" } as const satisfies { readonly [F in Format]: string };

export const EXTENSION = { csv: "csv", json: "json", sql: "sql" } as const satisfies { readonly [F in Format]: string };

/** A CSV field: quoted when it holds a comma, quote or line break. */
const csvField = (v: Cell): string => (v === null ? "" : /[",\r\n]/.test(v) ? `"${Str.replace(/"/g, '""')(v)}"` : v);

/** A result as CSV with a header row. */
export function toCsv(set: ResultSet): string {
  return Arr.join(Arr.map([set.columns, ...set.rows], (r) => Arr.join(Arr.map(r, csvField), ",")), "\n") + "\n";
}

/** Whether a text is exactly a number's own spelling ("12", "-3.5"; not "012", "1e3", "1 000"). */
export const exactNumber = (v: string): boolean => /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v) && String(Number(v)) === Str.replace(/\.$/, "")(Str.replace(/(\.\d*?)0+$/, "$1")(v));

/** Which columns are numbers: every non-null cell an exact number, at least one of them. */
function numberColumns(set: ResultSet): boolean[] {
  return Arr.map(set.columns, (_c, i) => {
    const cells = Arr.filter(Arr.map(set.rows, (r) => r[i] ?? null), (v): v is string => v !== null);

    return cells.length > 0 && Arr.every(cells, exactNumber);
  });
}

const jsonText = Schema.encodeSync(Schema.fromJsonString(Schema.Json, { space: 2 }));

/** A result as a JSON array of objects. */
export function toJson(set: ResultSet): string {
  const nums = numberColumns(set);

  const rows = Arr.map(set.rows, (r) => Rec.fromEntries(Arr.map(set.columns, (c, i): [string, Schema.Json] => {
    const v = r[i] ?? null;

    return [c, v === null ? null : nums[i] === true ? Number(v) : v];
  })));

  return `${jsonText(rows)}\n`;
}

/** A result as INSERT statements into `table` (a name as the kind writes it, already quoted). */
export function toInserts(set: ResultSet, kind: Kind, table: string): string {
  const nums = numberColumns(set);
  const cols = Arr.join(Arr.map(set.columns, (c) => quoteName(kind, c)), ", ");

  return Arr.join(Arr.map(set.rows, (r) => {
    const values = Arr.map(set.columns, (_c, i) => {
      const v = r[i] ?? null;

      return v === null ? "NULL" : nums[i] === true ? v : quoteText(kind, v);
    });

    return `INSERT INTO ${table} (${cols}) VALUES (${Arr.join(values, ", ")});`;
  }), "\n") + "\n";
}

/** A result in a format. */
export function exportText(set: ResultSet, format: Format, kind: Kind, table: string): string {
  return format === "csv" ? toCsv(set) : format === "json" ? toJson(set) : toInserts(set, kind, table);
}

/** A file name for an export: the table's (or "result") and the date, safe in a path. */
export function exportName(base: string, format: Format, now: number): string {
  const day = DateTime.formatIsoDateUtc(DateTime.makeUnsafe(now));
  const safe = Str.replace(/[^A-Za-z0-9._-]+/g, "_")(base);

  return `${Str.isEmpty(safe) ? "result" : safe}-${day}.${EXTENSION[format]}`;
}

/** writeTextFile takes at most 1 MiB: a bigger export is written in parts this many characters (3 bytes each at most). */
export const PART = 320 * 1024;

/** Writes `text` to `dest` (any size): parts in the private folder, joined there by cat, then
 *  gone. A part that couldn't be written takes the parts before it with it. */
export const writeOut = (dir: string, dest: string, text: string): Effect.Effect<void, FileError | StaleFile | ExecError | ExitError, Exec | Files> => Effect.gen(function* () {
  const n = yield* nonce;
  const files = yield* Files;
  const parts: string[] = [];
  const count = Math.max(1, Math.ceil(Str.length(text) / PART));

  yield* Effect.forEach(Arr.range(0, count - 1), (i) => {
    const part = `${dir}/x-${n}-${Str.padStart(5, "0")(String(i))}`;

    return Effect.map(files.write(part, Str.slice(i * PART, (i + 1) * PART)(text), null), () => parts.push(part));
  }).pipe(Effect.onError(() => Effect.ignore(Exec.use((x) => x.run("rm", ["-f", ...parts])))));

  yield* execOk("sh", ["-c", 'dest=$1; shift; cat "$@" > "$dest"; r=$?; rm -f "$@"; exit $r', "ff-export", dest, ...parts]);
});
