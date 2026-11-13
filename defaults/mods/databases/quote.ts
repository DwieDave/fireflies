// A value as each engine reads it in a statement the window writes (an edited
// cell's UPDATE): what a column's declared type makes of it (a whole number, a
// number, a yes / no, a text, a blob, which is refused), its literal per engine
// (SQLite and libSQL: 'it''s'; Postgres: 'it''s', E'a\\b' once there is a
// backslash, so standard_conforming_strings either way reads it the same; MySQL:
// 'it''s', and a text holding a backslash as _utf8mb4 X'…', so neither the
// client's parser nor NO_BACKSLASH_ESCAPES can change it), the bound value
// Turso's Hrana takes instead, and the check that a cell still holds what was
// read (the old value in the UPDATE's WHERE). Names are catalog.ts' quoteName.

import type { Kind } from "./kinds.ts";
import type { Cell } from "./parse-out.ts";
import type { BoundValue } from "./script.ts";
import { quoteName } from "./catalog.ts";

/** What a column's declared type makes of a typed value. */
export type ColType = "int" | "float" | "decimal" | "bool" | "json" | "blob" | "text";

/** A column's kind of value, from its declared type ("integer", "int(11) unsigned", "double
 *  precision", "tinyint(1)", "bytea", "varchar(40)"; SQLite's free words too). */
export function typeOf(declared: string): ColType {
  const t = declared.trim().toLowerCase();

  if (/blob|bytea|^(var)?binary\b|^image\b/.test(t)) return "blob";

  if (/^bool(ean)?\b|^tinyint\(1\)/.test(t)) return "bool";

  if (/^(tiny|small|medium|big)?int(eger)?\d*\b|^int[248]\b|^(big|small)?serial\d*\b/.test(t)) return "int";

  if (/^(real|float\d*|double)\b/.test(t)) return "float";

  if (/^(decimal|numeric|dec|money)\b/.test(t)) return "decimal";

  if (/^jsonb?\b/.test(t)) return "json";

  return "text";
}

const WHOLE = /^[-+]?\d+$/;
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const YES = /^(true|t|yes|y|on|1)$/i;
const NO = /^(false|f|no|n|off|0)$/i;

/** Why a typed value can't go into a column of `type` (null: it can). */
export function refusal(value: Cell, type: ColType): string | null {
  if (value === null) return null;

  if (type === "blob") return "a blob can't be edited here";

  if (value.includes("\0")) return "a value can't hold a NUL character";

  if (type === "int" && !WHOLE.test(value.trim())) return "it takes a whole number";

  if ((type === "float" || type === "decimal") && !NUMBER.test(value.trim()) && !/^[-+]?(nan|inf(inity)?)$/i.test(value.trim())) return "it takes a number";

  if (type === "bool" && !YES.test(value.trim()) && !NO.test(value.trim())) return "it takes true or false";

  return null;
}

/** A text's UTF-8 bytes in hex ("é" is C3A9). */
export function utf8Hex(s: string): string {
  let out = "";

  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;

    const bytes = c < 0x80 ? [c]
      : c < 0x800 ? [0xc0 | (c >> 6), 0x80 | (c & 63)]
      : c < 0x10000 ? [0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)]
      : [0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];

    out += bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  return out.toUpperCase();
}

/** A text as a string literal for the engine. */
export function textLiteral(kind: Kind, s: string): string {
  if (kind === "postgres" && s.includes("\\")) return `E'${s.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

  if (kind === "mysql" && s.includes("\\")) return `_utf8mb4 X'${utf8Hex(s)}'`;

  return `'${s.replace(/'/g, "''")}'`;
}

/** A literal for a value refused by `refusal` (the caller asks first). */
export type Literal = { readonly sql: string } | { readonly refused: string };

/** A value as a literal of its column's type: NULL, a number as typed, a yes / no as the engine
 *  writes it, anything else a quoted text (the engine reads it as the column's type). */
export function literal(kind: Kind, value: Cell, type: ColType): Literal {
  const why = refusal(value, type);

  if (why) return { refused: why };

  if (value === null) return { sql: "NULL" };

  const v = value.trim();

  if (type === "int") return { sql: v.replace(/^\+/, "") };

  if ((type === "float" || type === "decimal") && NUMBER.test(v)) return { sql: v.replace(/^\+/, "") };

  if (type === "bool") {
    const yes = YES.test(v);

    return { sql: kind === "postgres" ? (yes ? "TRUE" : "FALSE") : yes ? "1" : "0" };
  }

  return { sql: textLiteral(kind, value) };
}

/** A value bound to a `?` for Hrana (libSQL over HTTP): typed, never pasted into the text. */
export type Bound = BoundValue;

/** A value bound for Hrana, typed by its column. */
export function bound(value: Cell, type: ColType): Bound | { readonly refused: string } {
  const why = refusal(value, type);

  if (why) return { refused: why };

  if (value === null) return { type: "null" };

  const v = value.trim();

  if (type === "int") return { type: "integer", value: v.replace(/^\+/, "") };

  if ((type === "float" || type === "decimal") && NUMBER.test(v)) return { type: "float", value: Number(v) };

  if (type === "bool") return { type: "integer", value: YES.test(v) ? "1" : "0" };

  return { type: "text", value };
}

/** Postgres types without an equality operator: compared by their text (json's is its input as
 *  typed, which is what psql prints). */
const textCompared = (declared: string): boolean => /^(json|xml|point|line|lseg|box|path|polygon|circle)\b/i.test(declared.trim());

/** The check that a column still holds `old` (as the client printed it). Postgres reads the
 *  printed text back as the column's type (its ::text isn't what psql prints: a boolean's is
 *  'true', psql's t), only a type without equality is compared as text; MySQL compares CAST AS
 *  CHAR and SQLite CAST AS TEXT, which is what their clients print. `param`: the old value is
 *  bound (Hrana), not pasted. */
export function stillHolds(kind: Kind, column: string, declared: string, old: Cell, param = false): string {
  const id = quoteName(kind, column);

  if (old === null) return `${id} IS NULL`;

  const value = param ? "?" : textLiteral(kind, old);

  if (kind === "postgres") return textCompared(declared) ? `${id}::text = ${value}` : `${id} = ${value}`;

  if (kind === "mysql") return `CAST(${id} AS CHAR) = ${value}`;

  return `CAST(${id} AS TEXT) = ${value}`;
}
