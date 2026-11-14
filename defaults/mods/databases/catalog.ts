// What the window asks a database about itself, per kind, and how the answers
// read: its tables and views (by schema, with a row estimate where the server
// keeps one), a table's structure (columns with types, nullability, defaults
// and keys; indexes; foreign keys both ways; SQLite's row count: Postgres and
// MySQL keep an estimate, an exact count is asked for, it reads every row) and a page of its
// rows (sorted, filtered). Every statement here is a read; a filter typed by
// the person must be one read statement (browseSql refuses anything else).

import type { Kind } from "./kinds.ts";
import type { Outcome, ResultSet } from "./parse-out.ts";
import type { ScriptStatement } from "./script.ts";
import { classify } from "./safety.ts";
import { splitStatements } from "./split.ts";

/** A table or view, in its schema (null: the database has none to name, SQLite's main). */
export interface TableRef {
  readonly schema: string | null;
  readonly name: string;
  readonly type: "table" | "view";
  /** Rows: the server's estimate (Postgres, MySQL) or a count; null: not known yet. */
  readonly rows: number | null;
}

/** A column of a table. */
export interface ColumnInfo {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly default: string | null;
  readonly pk: boolean;
}

/** An index: its name, primary / unique / plain, its method (btree …) and its columns or definition. */
export interface IndexInfo {
  readonly name: string;
  readonly kind: "primary" | "unique" | "";
  readonly method: string;
  readonly columns: string;
}

/** A foreign key: from a table's columns to another's; `incoming` when another table points here. */
export interface ForeignKey {
  readonly name: string;
  readonly from: string;
  readonly fromColumns: string;
  readonly to: string;
  readonly toColumns: string;
  readonly onDelete: string | null;
  readonly incoming: boolean;
}

/** A table's structure. */
export interface Structure {
  readonly columns: readonly ColumnInfo[];
  readonly indexes: readonly IndexInfo[];
  readonly keys: readonly ForeignKey[];
  readonly count: number | null;
}

/** A name quoted for the kind ("x" or `x`). */
export const quoteName = (kind: Kind, name: string): string => (kind === "mysql" ? `\`${name.replace(/`/g, "``")}\`` : `"${name.replace(/"/g, '""')}"`);

/** A text quoted as a literal for the kind (MySQL also escapes backslashes). */
export const quoteText = (kind: Kind, text: string): string => `'${(kind === "mysql" ? text.replace(/\\/g, "\\\\") : text).replace(/'/g, "''")}'`;

/** A table's name for a statement: schema-qualified where there is a schema. */
export const qualified = (kind: Kind, t: Pick<TableRef, "schema" | "name">): string => (t.schema && kind !== "sqlite" && kind !== "libsql" ? `${quoteName(kind, t.schema)}.${quoteName(kind, t.name)}` : quoteName(kind, t.name));

const read = (text: string): ScriptStatement => ({ text, risk: "read" });

const PG_TABLES = "select n.nspname as schema, c.relname as name, case when c.relkind in ('v','m') then 'view' else 'table' end as type, greatest(c.reltuples, -1)::bigint as estimate "
  + "from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p','v','m','f') "
  + "and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%' order by 1, 3, 2";

const MY_TABLES = "select table_schema as `schema`, table_name as name, case when table_type = 'VIEW' then 'view' else 'table' end as type, table_rows as estimate "
  + "from information_schema.tables where table_schema not in ('mysql','information_schema','performance_schema','sys') "
  + "and (database() is null or table_schema = database()) order by 1, 3, 2";

const LITE_TABLES = "select 'main' as schema, name, type, null as estimate from sqlite_schema where type in ('table','view') and name not like 'sqlite_%' order by type, name";

/** The statement listing the tables and views. */
export function tablesSql(kind: Kind): ScriptStatement[] {
  return [read(kind === "postgres" ? PG_TABLES : kind === "mysql" ? MY_TABLES : LITE_TABLES)];
}

/** A result's rows as objects by column name. */
function records(set: ResultSet | null | undefined): ReadonlyMap<string, string | null>[] {
  if (!set) return [];

  return set.rows.map((r) => new Map(set.columns.map((c, i) => [c, r[i] ?? null])));
}

const num = (v: string | null | undefined): number | null => (v === null || v === undefined || v === "" || Number(v) < 0 ? null : Number(v));

/** The tables of tablesSql's answer. */
export function tablesOf(kind: Kind, o: Outcome): TableRef[] {
  return records(o.results[0]?.set).flatMap((r): TableRef[] => {
    const name = r.get("name");

    if (!name) return [];

    const schema = kind === "sqlite" || kind === "libsql" ? null : r.get("schema") ?? null;

    return [{ schema, name, type: r.get("type") === "view" ? "view" : "table", rows: num(r.get("estimate")) }];
  });
}

/** One count per table (SQLite keeps no estimate: counted, the first `max` of them). */
export function countsSql(kind: Kind, tables: readonly TableRef[], max = 200): ScriptStatement[] {
  return tables.filter((t) => t.type === "table").slice(0, max).map((t) => read(`select count(*) as n from ${qualified(kind, t)}`));
}

/** The structure's statements: columns, indexes, foreign keys (both ways); SQLite's count (the
 *  servers' estimate stands for Postgres and MySQL: a count reads every row, countRows asks it). */
export function structureSql(kind: Kind, t: Pick<TableRef, "schema" | "name">): ScriptStatement[] {
  const q = (s: string): string => quoteText(kind, s);

  if (kind === "postgres") {
    const rel = q(qualified(kind, t));

    return [
      read(`select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, case when a.attnotnull then 'no' else 'yes' end as nullable, pg_get_expr(d.adbin, d.adrelid) as "default", case when exists (select 1 from pg_index i where i.indrelid = a.attrelid and i.indisprimary and a.attnum = any(i.indkey)) then 'pk' else '' end as key from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = ${rel}::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`),
      read(`select c.relname as name, case when i.indisprimary then 'primary' when i.indisunique then 'unique' else '' end as kind, am.amname as method, pg_get_indexdef(i.indexrelid) as def from pg_index i join pg_class c on c.oid = i.indexrelid join pg_am am on am.oid = c.relam where i.indrelid = ${rel}::regclass order by i.indisprimary desc, c.relname`),
      read(`select conname as name, conrelid::regclass::text as from_table, confrelid::regclass::text as to_table, pg_get_constraintdef(oid) as def from pg_constraint where contype = 'f' and (conrelid = ${rel}::regclass or confrelid = ${rel}::regclass) order by 1`),
    ];
  }

  if (kind === "mysql") {
    const where = `table_schema = ${q(t.schema ?? "")} and table_name = ${q(t.name)}`;

    return [
      read(`select column_name as name, column_type as type, case is_nullable when 'YES' then 'yes' else 'no' end as nullable, column_default as \`default\`, case column_key when 'PRI' then 'pk' else '' end as \`key\` from information_schema.columns where ${where} order by ordinal_position`),
      read(`select index_name as name, case when index_name = 'PRIMARY' then 'primary' when non_unique = 0 then 'unique' else '' end as kind, lower(index_type) as method, group_concat(column_name order by seq_in_index separator ', ') as cols from information_schema.statistics where ${where} group by index_name, non_unique, index_type order by index_name = 'PRIMARY' desc, index_name`),
      read(`select constraint_name as name, table_name as from_table, group_concat(column_name order by ordinal_position separator ', ') as from_cols, referenced_table_name as to_table, group_concat(referenced_column_name order by ordinal_position separator ', ') as to_cols from information_schema.key_column_usage where referenced_table_name is not null and ((${where}) or (referenced_table_schema = ${q(t.schema ?? "")} and referenced_table_name = ${q(t.name)})) group by constraint_name, table_name, referenced_table_name order by 1`),
    ];
  }

  const n = q(t.name);

  return [
    read(`select name, type, case when "notnull" then 'no' else 'yes' end as nullable, dflt_value as "default", case when pk > 0 then 'pk' else '' end as key from pragma_table_info(${n}) order by cid`),
    read(`select il.name as name, case when il.origin = 'pk' then 'primary' when il."unique" then 'unique' else '' end as kind, '' as method, (select group_concat(ii.name, ', ') from pragma_index_info(il.name) ii) as cols from pragma_index_list(${n}) il order by il.origin = 'pk' desc, il.name`),
    read(`select 'fk' || id as name, ${n} as from_table, group_concat("from", ', ') as from_cols, "table" as to_table, group_concat("to", ', ') as to_cols, max(on_delete) as on_delete from pragma_foreign_key_list(${n}) group by id union all select 'fk' as name, m.name as from_table, f."from" as from_cols, f."table" as to_table, f."to" as to_cols, f.on_delete as on_delete from sqlite_schema m join pragma_foreign_key_list(m.name) f where m.type = 'table' and f."table" = ${n}`),
    read(`select count(*) as n from ${qualified(kind, t)}`),
  ];
}

/** A Postgres foreign key's definition in parts. */
export interface KeyDef {
  readonly fromColumns: string;
  readonly to: string;
  readonly toColumns: string;
  readonly onDelete: string | null;
}

/** Postgres' "FOREIGN KEY (a, b) REFERENCES t(x, y) ON DELETE CASCADE" in parts. */
export function pgForeignKey(def: string): KeyDef {
  const m = /^FOREIGN KEY \(([^)]*)\) REFERENCES ([^(]+)\(([^)]*)\)(.*)$/.exec(def.trim());
  const del = /ON DELETE (CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION)/.exec(m?.[4] ?? "");

  return { fromColumns: m?.[1] ?? "", to: (m?.[2] ?? "").trim(), toColumns: m?.[3] ?? "", onDelete: del?.[1]?.toLowerCase() ?? null };
}

/** The last dotted part of a name (Postgres' regclass text may carry its schema). */
const bare = (name: string): string => name.split(".").at(-1)?.replace(/^"|"$/g, "") ?? name;

function keysOf(kind: Kind, set: ResultSet | null | undefined, table: string): ForeignKey[] {
  return records(set).map((r) => {
    const from = bare(r.get("from_table") ?? "");
    const pg = kind === "postgres" ? pgForeignKey(r.get("def") ?? "") : null;
    const to = bare(pg ? pg.to : r.get("to_table") ?? "");

    return {
      name: r.get("name") ?? "",
      from,
      fromColumns: pg ? pg.fromColumns : r.get("from_cols") ?? "",
      to,
      toColumns: pg ? pg.toColumns : r.get("to_cols") ?? "",
      onDelete: pg ? pg.onDelete : (r.get("on_delete") ?? "").toLowerCase().replace("no action", "") || null,
      incoming: from !== table,
    };
  });
}

/** The structure of structureSql's answer. */
export function structureOf(kind: Kind, o: Outcome, table: string): Structure {
  const at = (i: number): ResultSet | null => o.results.find((r) => r.index === i)?.set ?? null;

  const columns = records(at(0)).map((r) => ({
    name: r.get("name") ?? "", type: r.get("type") ?? "", nullable: r.get("nullable") !== "no", default: r.get("default") ?? null, pk: r.get("key") === "pk",
  }));

  const indexes = records(at(1)).map((r): IndexInfo => {
    const k = r.get("kind");
    const def = r.get("def");
    // Postgres' definition: the part in parentheses after USING.
    const cols = def ? (/USING \w+ \((.*)\)/.exec(def)?.[1] ?? def) : r.get("cols") ?? "";

    return { name: r.get("name") ?? "", kind: k === "primary" || k === "unique" ? k : "", method: r.get("method") ?? "", columns: cols };
  });

  return { columns, indexes, keys: keysOf(kind, at(2), table), count: num(at(3)?.rows[0]?.[0]) };
}

/** A page of a table's rows: sorted, filtered, `limit` from `offset`. */
export interface Browse {
  readonly table: Pick<TableRef, "schema" | "name">;
  readonly sort: { readonly column: string; readonly desc: boolean } | null;
  /** A WHERE clause as typed (without the word). */
  readonly filter: string;
  readonly offset: number;
  readonly limit: number;
  /** A SQLite table without a primary key: its rowid read first, so its rows can be edited. */
  readonly rowid?: boolean;
}

/** A sort as the page's statement says it (the Rows tab shows this same text). */
export const orderSql = (kind: Kind, sort: { readonly column: string; readonly desc: boolean }): string => `order by ${quoteName(kind, sort.column)} ${sort.desc ? "desc" : "asc"}`;

/** The page's statements (the rows, and the count when filtered), or why the filter can't run. */
export function browseSql(kind: Kind, b: Browse): { readonly statements: ScriptStatement[] } | { readonly refused: string } {
  const filter = b.filter.trim().replace(/^where\s+/i, "").replace(/;\s*$/, "");
  const from = qualified(kind, b.table);
  const where = filter ? ` where ${filter}` : "";
  const order = b.sort ? ` ${orderSql(kind, b.sort)}` : "";
  const rows = `select ${b.rowid ? "rowid, " : ""}* from ${from}${where}${order} limit ${b.limit} offset ${b.offset}`;

  if (filter) {
    // The filter is the person's SQL inside ours: one statement, and only a read.
    const parts = splitStatements(rows, kind);

    if (parts.length !== 1 || classify(rows, kind).risk !== "read") return { refused: "the filter must be a condition, not a statement of its own" };

    return { statements: [read(rows), read(`select count(*) as n from ${from}${where}`)] };
  }

  return { statements: [read(rows)] };
}
