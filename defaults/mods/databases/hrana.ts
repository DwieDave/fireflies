// A remote libSQL database (Turso, sqld) over HTTP: Hrana's pipeline
// (POST <url>/v2/pipeline) with one batch whose every step runs only if the one
// before it went well, so a run stops at its first error as the clients do.
// The token is a header of fetch: in no process's arguments. Values come back
// typed (integer as text, float, text, blob as base64, null).

import type { Guarded } from "./guard.ts";
import { arrayOf, isNumber, isString, literal, nullable, object, oneOf, parseJson } from "./guard.ts";
import type { Cell, Outcome, StatementResult } from "./parse-out.ts";

/** fetch as the window uses it (a test's stand-in). */
export type Fetch = (url: string, init: { method: string; headers: { readonly [name: string]: string }; body: string }) => Promise<{ readonly status: number; text(): Promise<string> }>;

/** The HTTP base of a libsql:// or https:// URL. */
export function httpBase(url: string): string {
  return url.trim().replace(/^libsql:\/\//, "https://").replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://").replace(/\/+$/, "");
}

/** The pipeline's body: one batch of the statements, each after the one before went well, then close. */
export function pipelineBody(statements: readonly string[]): string {
  const steps = statements.map((sql, i) => (i === 0 ? { stmt: { sql } } : { stmt: { sql }, condition: { type: "ok", step: i - 1 } }));

  return JSON.stringify({ requests: [{ type: "batch", batch: { steps } }, { type: "close" }] });
}

const isValue = object({ type: literal("null", "integer", "float", "text", "blob") }, { value: oneOf(isString, isNumber), base64: isString });

const isCol = object({}, { name: nullable(isString), decltype: nullable(isString) });

const isStmtResult = object({ cols: arrayOf(isCol), rows: arrayOf(arrayOf(isValue)) }, { affected_row_count: isNumber });

const isError = object({ message: isString }, { code: nullable(isString) });

const isBatchResult = object({ step_results: arrayOf(nullable(isStmtResult)), step_errors: arrayOf(nullable(isError)) });

const isAnswer = object({
  results: arrayOf(object({ type: literal("ok", "error") }, {
    response: object({ type: isString }, { result: isBatchResult }),
    error: isError,
  })),
});

type Value = Guarded<typeof isValue>;

/** A value as the grid shows it. */
function cell(v: Value): Cell {
  switch (v.type) {
    case "null": return null;
    case "blob": return `x'${[...atob(v.base64 ?? "")].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")}'`;
    default: return String(v.value ?? "");
  }
}

/** The answer's text as an Outcome for `count` statements. */
export function parseHrana(status: number, text: string, count: number): Outcome {
  const answer = parseJson(text, isAnswer);

  if (status !== 200 || !answer) {
    const said = parseJson(text, object({}, { message: isString, error: isString }));
    const message = said?.message ?? said?.error ?? (status === 401 || status === 403 ? "the token was refused" : `the server answered ${status}`);

    return { results: [], error: { index: null, message, line: null, col: null, hint: null }, cut: false };
  }

  const first = answer.results[0];

  if (!first || first.type === "error" || !first.response?.result) {
    return { results: [], error: { index: null, message: first?.error?.message ?? "no answer to the batch", line: null, col: null, hint: null }, cut: false };
  }

  const { step_results: done, step_errors: errors } = first.response.result;
  const results: StatementResult[] = [];

  for (let i = 0; i < count; i++) {
    const r = done[i];

    if (!r) continue;

    const columns = r.cols.map((c, n) => c.name ?? `column ${n + 1}`);
    const types = r.cols.map((c) => c.decltype ?? "");

    results.push({ index: i, set: columns.length ? { columns, types, rows: r.rows.map((row) => row.map(cell)) } : null, affected: r.affected_row_count ?? null, tag: null });
  }

  const failed = errors.findIndex((e) => e !== null);
  const e = failed >= 0 ? errors[failed] : null;

  return { results, error: e ? { index: failed, message: e.message.replace(/^SQLite error: /, ""), line: null, col: null, hint: null } : null, cut: false };
}

/** Runs the statements on a remote libSQL database. */
export async function runHrana(fetcher: Fetch, url: string, token: string | null, statements: readonly string[]): Promise<Outcome> {
  const json = { "content-type": "application/json" };
  const headers = token ? { ...json, authorization: `Bearer ${token}` } : json;

  try {
    const r = await fetcher(`${httpBase(url)}/v2/pipeline`, { method: "POST", headers, body: pipelineBody(statements) });

    return parseHrana(r.status, await r.text(), statements.length);
  } catch (error) {
    return { results: [], error: { index: null, message: error instanceof Error ? error.message : String(error), line: null, col: null, hint: null }, cut: false };
  }
}
