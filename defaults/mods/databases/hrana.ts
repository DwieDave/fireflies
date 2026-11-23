// A remote libSQL database (Turso, sqld) over HTTP: Hrana's pipeline
// (POST <url>/v2/pipeline) with one batch whose every step runs only if the one
// before it went well, so a run stops at its first error as the clients do.
// The token is a header of fetch: in no process's arguments. Values come back
// typed (integer as text, float, text, blob as base64, null).

import { Array as Arr, Effect, Option, Schema, String as Str } from "effect";
import type { Redacted } from "effect";
import { Libsql } from "./fx.ts";
import type { Cell, Outcome, RunError, StatementResult } from "./parse-out.ts";
import type { BoundValue } from "./script.ts";

/** The HTTP base of a libsql:// or https:// URL. */
export function httpBase(url: string): string {
  return Str.replace(/\/+$/, "")(Str.replace(/^ws:\/\//, "http://")(Str.replace(/^wss:\/\//, "https://")(Str.replace(/^libsql:\/\//, "https://")(Str.trim(url)))));
}

/** A statement for the pipeline: its text and the values bound to its `?`s, if any. */
export interface HranaStatement {
  readonly sql: string;
  readonly args?: readonly BoundValue[];
}

/** A bound value as Hrana writes it (a float as a number, an integer as text). */
const hranaValue = (b: BoundValue): Schema.Json => (b.type === "null" ? { type: "null" } : { type: b.type, value: b.value });

/** A statement as Hrana writes it. */
const stmt = (s: HranaStatement): Schema.Json => (s.args !== undefined ? { sql: s.sql, args: Arr.map(s.args, hranaValue) } : { sql: s.sql });

const bodyText = Schema.encodeSync(Schema.fromJsonString(Schema.Json));

/** The pipeline's body: one batch of the statements, each after the one before went well, then close. */
export function pipelineBody(statements: readonly HranaStatement[]): string {
  const steps = Arr.map(statements, (s, i): Schema.Json => (i === 0 ? { stmt: stmt(s) } : { stmt: stmt(s), condition: { type: "ok", step: i - 1 } }));

  return bodyText({ requests: [{ type: "batch", batch: { steps } }, { type: "close" }] });
}

const ValueSchema = Schema.Struct({
  type: Schema.Literals(["null", "integer", "float", "text", "blob"]),
  value: Schema.optionalKey(Schema.Union([Schema.String, Schema.Finite])),
  base64: Schema.optionalKey(Schema.String),
});

type Value = typeof ValueSchema.Type;

const maybe = <S extends Schema.Top>(s: S) => Schema.optionalKey(Schema.NullOr(s));

const ColSchema = Schema.Struct({ name: maybe(Schema.String), decltype: maybe(Schema.String) });

const StmtResultSchema = Schema.Struct({ cols: Schema.Array(ColSchema), rows: Schema.Array(Schema.Array(ValueSchema)), affected_row_count: Schema.optionalKey(Schema.Finite) });

const ErrorSchema = Schema.Struct({ message: Schema.String, code: maybe(Schema.String) });

const BatchResultSchema = Schema.Struct({ step_results: Schema.Array(Schema.NullOr(StmtResultSchema)), step_errors: Schema.Array(Schema.NullOr(ErrorSchema)) });

const AnswerSchema = Schema.Struct({
  results: Schema.Array(Schema.Struct({
    type: Schema.Literals(["ok", "error"]),
    response: Schema.optionalKey(Schema.Struct({ type: Schema.String, result: Schema.optionalKey(BatchResultSchema) })),
    error: Schema.optionalKey(ErrorSchema),
  })),
});

/** What a server says when it refuses a request (sqld's `message`, Turso's `error`). */
const RefusalSchema = Schema.Struct({ message: Schema.optionalKey(Schema.String), error: Schema.optionalKey(Schema.String) });

const answerOf = Schema.decodeUnknownOption(Schema.fromJsonString(AnswerSchema));

const refusalOf = Schema.decodeUnknownOption(Schema.fromJsonString(RefusalSchema));

/** A blob's bytes as the grid shows them (x'…'). */
const blob = (b64: string): string => `x'${Arr.join(Arr.map(Arr.fromIterable(atob(b64)), (c) => Str.padStart(2, "0")(Option.getOrElse(Str.codePointAt(c, 0), () => 0).toString(16))), "")}'`;

/** A value as the grid shows it. */
function cell(v: Value): Cell {
  switch (v.type) {
    case "null": return null;
    case "blob": return blob(v.base64 ?? "");
    default: return String(v.value ?? "");
  }
}

/** The request's own failure (no statement's): the server not reached, the token refused. */
const requestError = (message: string): RunError => ({ index: null, message, line: null, col: null, hint: null });

/** The answer's text as an Outcome for `count` statements. */
export function parseHrana(status: number, text: string, count: number): Outcome {
  const answer = status === 200 ? answerOf(text) : Option.none();

  if (Option.isNone(answer)) {
    const said = Option.flatMap(refusalOf(text), (r) => Option.fromUndefinedOr(r.message ?? r.error));
    const message = Option.getOrElse(said, () => (status === 401 || status === 403 ? "the token was refused" : status === 200 ? "the server's answer isn't a pipeline's" : `the server answered ${status}`));

    return { results: [], error: requestError(message), cut: false };
  }

  const first = answer.value.results[0];

  if (first === undefined || first.type === "error" || first.response?.result === undefined) {
    return { results: [], error: requestError(first?.error?.message ?? "no answer to the batch"), cut: false };
  }

  const { step_results: done, step_errors: errors } = first.response.result;
  const results: StatementResult[] = [];

  for (let i = 0; i < count; i++) {
    const r = done[i];

    if (r === null || r === undefined) continue;

    const columns = Arr.map(r.cols, (c, n) => c.name ?? `column ${n + 1}`);
    const types = Arr.map(r.cols, (c) => c.decltype ?? "");

    results.push({ index: i, set: columns.length !== 0 ? { columns, types, rows: Arr.map(r.rows, (row) => Arr.map(row, cell)) } : null, affected: r.affected_row_count ?? null, tag: null });
  }

  const failed = Arr.findFirstIndex(errors, (e) => e !== null);
  const error = Option.flatMap(failed, (i) => Option.map(Option.fromNullishOr(errors[i]), (e): RunError => ({ index: i, message: Str.replace(/^SQLite error: /, "")(e.message), line: null, col: null, hint: null })));

  return { results, error: Option.getOrNull(error), cut: false };
}

/** Runs the statements on a remote libSQL database (the token, when there is one, as the request's
 *  bearer header). A request that got no answer is the outcome's error, in its words. */
export const runHrana = (url: string, token: Redacted.Redacted | null, statements: readonly HranaStatement[]): Effect.Effect<Outcome, never, Libsql> =>
  Libsql.use((l) => l.pipeline(`${httpBase(url)}/v2/pipeline`, token, pipelineBody(statements))).pipe(
    Effect.map((r) => parseHrana(r.status, r.text, statements.length)),
    Effect.catchTag("HttpClientError", (e) => Effect.succeed({ results: [], error: requestError(e.message), cut: false })),
  );
