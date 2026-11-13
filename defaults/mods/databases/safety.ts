// What a statement does, read before it runs: a read (SELECT, SHOW, EXPLAIN,
// a PRAGMA that only reads), a session step (BEGIN, COMMIT, SET, USE: nothing
// written by itself), a write (anything else: it asks once), or a destructive
// one (DROP, TRUNCATE, DELETE or UPDATE without WHERE, ALTER … DROP: it asks
// twice, the second time by typing the object's name). Read with comments and
// literals blanked (split.ts), so a word inside a string never counts.

import type { Kind } from "./kinds.ts";
import { blankLiterals } from "./split.ts";

/** How much a statement can change, least first. */
export type Risk = "read" | "session" | "write" | "destructive";

const RANK = { read: 0, session: 1, write: 2, destructive: 3 } as const satisfies { readonly [R in Risk]: number };

/** What a statement does: its risk, its verb in words ("drop table"), and for a destructive
 *  one the name typed to confirm it (null: none to name). */
export interface Verdict {
  readonly risk: Risk;
  readonly verb: string;
  readonly target: string | null;
}

const READS = new Set(["select", "show", "describe", "desc", "values", "table", "explain"]);
const SESSION = new Set(["begin", "start", "commit", "rollback", "end", "savepoint", "release", "set", "use", "reset", "discard", "listen", "unlisten"]);
const WRITES_IN_WITH = new Set(["insert", "update", "delete", "merge"]);

/** PRAGMAs that only read, even with an argument (`pragma table_info(t)`). */
const READ_PRAGMAS = new Set([
  "table_info", "table_xinfo", "table_list", "index_list", "index_info", "index_xinfo", "foreign_key_list", "foreign_key_check",
  "integrity_check", "quick_check", "database_list", "collation_list", "function_list", "module_list", "pragma_list", "compile_options",
]);

/** The words of blanked text: names and keywords lowercased, other characters one by one. */
function words(blank: string): string[] {
  return blank.toLowerCase().match(/[a-z_][a-z0-9_$]*|[^\s]/g) ?? [];
}

/** A name as written at `at` in the raw text (quotes taken off, the last dotted part). */
function nameAt(raw: string, blank: string, word: number): string | null {
  const re = /[a-z_][a-z0-9_$]*|[^\s]/gi;
  let n = 0;

  for (let m = re.exec(blank); m; m = re.exec(blank)) {
    if (n++ !== word) continue;

    // The name runs over names, dots and quoted parts in the raw text.
    const rest = raw.slice(m.index).match(/^(?:"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|[A-Za-z0-9_$]+)(?:\.(?:"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|[A-Za-z0-9_$]+))*/);
    const last = rest?.[0].split(".").at(-1) ?? null;

    return last ? last.replace(/^["`[]|["`\]]$/g, "").replace(/""/g, '"') : null;
  }

  return null;
}

/** The word index after `from` skipping the given optional words (`if exists`, `only`, `table`). */
function skip(ws: readonly string[], from: number, optional: readonly string[]): number {
  let i = from;

  while (i < ws.length && optional.includes(ws[i] ?? "")) i++;

  return i;
}

/** What one statement does. */
export function classify(sql: string, kind: Kind): Verdict {
  const blank = blankLiterals(sql, kind);
  const ws = words(blank);
  const first = ws[0] ?? "";

  if (first === "explain") {
    // EXPLAIN ANALYZE runs the statement: it is what that statement is.
    const analyze = ws[1] === "analyze" || ws[1] === "analyse" || (ws[1] === "(" && ws.slice(2, ws.indexOf(")")).includes("analyze"));

    if (analyze) {
      const at = ws[1] === "(" ? ws.indexOf(")") + 1 : 2;
      const inner = classify(sql.slice(offsetOfWord(blank, at)), kind);

      return inner.risk === "read" ? { risk: "read", verb: "explain analyze", target: null } : inner;
    }

    return { risk: "read", verb: "explain", target: null };
  }

  if (first === "pragma") return pragma(ws);

  if (READS.has(first)) return { risk: "read", verb: first, target: null };

  if (first === "with") {
    const writes = ws.find((w) => WRITES_IN_WITH.has(w));

    return writes ? { risk: "write", verb: `with … ${writes}`, target: null } : { risk: "read", verb: "with … select", target: null };
  }

  if (SESSION.has(first)) {
    // SET GLOBAL / PERSIST changes the server for everyone.
    const server = first === "set" && (ws[1] === "global" || ws[1] === "persist" || ws[1] === "persist_only");

    return server ? { risk: "write", verb: `set ${ws[1] ?? ""}`, target: null } : { risk: "session", verb: first, target: null };
  }

  return writeVerdict(sql, blank, ws);
}

/** The offset in `blank` where word `n` starts. */
function offsetOfWord(blank: string, n: number): number {
  const re = /[a-z_][a-z0-9_$]*|[^\s]/gi;
  let i = 0;

  for (let m = re.exec(blank); m; m = re.exec(blank)) if (i++ === n) return m.index;

  return blank.length;
}

function pragma(ws: readonly string[]): Verdict {
  // pragma [schema.]name [= value | (arg)]
  const dotted = ws[2] === ".";
  const name = (dotted ? ws[3] : ws[1]) ?? "";
  const after = ws[dotted ? 4 : 2];

  if (after === undefined || after === ";" || READ_PRAGMAS.has(name)) return { risk: "read", verb: `pragma ${name}`, target: null };

  return { risk: "write", verb: `pragma ${name}`, target: null };
}

/** A statement that writes: destructive when it drops, truncates, or deletes / updates every row. */
function writeVerdict(raw: string, blank: string, ws: readonly string[]): Verdict {
  const first = ws[0] ?? "";
  const hasWhere = ws.includes("where");

  if (first === "drop") {
    const what = ws[1] ?? "";
    const at = skip(ws, 2, ["view", "if", "exists", "concurrently"]);

    return { risk: "destructive", verb: what === "materialized" ? "drop materialized view" : `drop ${what}`, target: nameAt(raw, blank, at) };
  }

  if (first === "truncate") return { risk: "destructive", verb: "truncate", target: nameAt(raw, blank, skip(ws, 1, ["table", "only"])) };

  if (first === "delete" && !hasWhere) return { risk: "destructive", verb: "delete every row", target: nameAt(raw, blank, skip(ws, 1, ["from", "only"])) };

  if (first === "update" && !hasWhere) return { risk: "destructive", verb: "update every row", target: nameAt(raw, blank, skip(ws, 1, ["only", "or", "ignore", "low_priority", "replace", "abort", "fail", "rollback"])) };

  if (first === "alter" && ws.includes("drop")) {
    return { risk: "destructive", verb: `alter ${ws[1] ?? ""} … drop`, target: nameAt(raw, blank, skip(ws, 2, ["if", "exists", "only"])) };
  }

  return { risk: "write", verb: [first, ws[1] === "into" || ws[1] === "table" || ws[1] === "index" || ws[1] === "view" ? ws[1] : ""].filter(Boolean).join(" "), target: null };
}

/** The worst of several statements' verdicts (a run of all of them asks once, for this one). */
export function worst(list: readonly Verdict[]): Verdict {
  return list.reduce<Verdict>((a, b) => (RANK[b.risk] > RANK[a.risk] ? b : a), { risk: "read", verb: "", target: null });
}

/** Whether a verdict may run on a read-only connection. */
export const allowedReadOnly = (v: Verdict): boolean => v.risk === "read" || v.risk === "session";

/** Whether a verdict asks before it runs (once for a write, twice for a destructive one). */
export const asks = (v: Verdict): boolean => v.risk === "write" || v.risk === "destructive";
