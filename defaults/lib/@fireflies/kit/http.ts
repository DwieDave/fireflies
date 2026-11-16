// HTTP through Effect's client (`effect/http` HttpClient), over what the
// engine has:
//
// - `fetchClient(fetch)`: the engine's `fetch` (no response headers today,
//   one fixed timeout, not cancellable: an interrupted request finishes in
//   the background and its answer is dropped);
// - `curlClient(exec, options)`: curl through `exec`, for a request whose
//   secret must stay inside a shell (`headersFrom`: a shell fragment that
//   prints header lines; they reach curl on its stdin, never in a process's
//   arguments). It gives the status, Retry-After and Content-Type, a
//   timeout per attempt, and its exit code.
//
// Either one is an `HttpClient`: decode a body with
// `HttpClientResponse.schemaBodyJson(schema)`, and wrap it in `policy(…)`:
// a timeout per attempt, and retries that are safe (see `policy`).
//
// Effect marks all of `effect/http` unstable; this file and the mods' own
// endpoint code are where the lint allows it (oxlint.effect.config.ts).

import { Array as Arr, Clock, DateTime, Duration, Effect, Inspectable, Match, Option, Pipeable, Predicate, Redacted, Result, Schedule, Schema, Stream, String as Str } from "effect";
import { Cookies, Headers, HttpClient, HttpClientError, HttpClientResponse, HttpIncomingMessage, UrlParams } from "effect/http";
import type { HttpClientRequest } from "effect/http";
import type { ExecResult } from "herdr";
import { CurlFailed, HeaderScriptExit, lastLine } from "./errors.ts";
import type { ExecError } from "./errors.ts";
import type { ExecOptions } from "./services.ts";

// ---- a response whose body has been read whole

const parseJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json));

/**
 * An `HttpClientResponse` from a status, headers and a body read as text
 * (both transports read the whole body: fetch's `text()`, curl's stdout).
 */
class TextResponse extends Inspectable.Class implements HttpClientResponse.HttpClientResponse {
  readonly [HttpIncomingMessage.TypeId] = HttpIncomingMessage.TypeId;
  readonly [HttpClientResponse.TypeId] = HttpClientResponse.TypeId;
  readonly request: HttpClientRequest.HttpClientRequest;
  readonly url: string;
  readonly status: number;
  readonly headers: Headers.Headers;
  readonly body: string;

  constructor(request: HttpClientRequest.HttpClientRequest, url: string, status: number, headers: Headers.Headers, body: string) {
    super();
    this.request = request;
    this.url = url;
    this.status = status;
    this.headers = headers;
    this.body = body;
  }

  toJSON() {
    return { _id: "HttpClientResponse", status: this.status, url: this.url };
  }

  get cookies(): Cookies.Cookies {
    return Cookies.empty;
  }

  get remoteAddress(): Option.Option<string> {
    return Option.none();
  }

  get text(): Effect.Effect<string, HttpClientError.HttpClientError> {
    return Effect.succeed(this.body);
  }

  get json(): Effect.Effect<Schema.Json, HttpClientError.HttpClientError> {
    return Str.isEmpty(this.body) ? Effect.succeed(null) : parseJson(this.body).pipe(Effect.mapError((cause) => this.decodeError(cause)));
  }

  get arrayBuffer(): Effect.Effect<ArrayBuffer, HttpClientError.HttpClientError> {
    return Effect.sync(() => bytes(this.body).slice().buffer);
  }

  get urlParamsBody(): Effect.Effect<UrlParams.UrlParams, HttpClientError.HttpClientError> {
    return Effect.sync(() => UrlParams.fromInput(new URLSearchParams(this.body)));
  }

  get stream(): Stream.Stream<Uint8Array, HttpClientError.HttpClientError> {
    return Stream.succeed(bytes(this.body));
  }

  get formData(): Effect.Effect<FormData, HttpClientError.HttpClientError> {
    return Effect.fail(this.decodeError("form data isn't read in this runtime"));
  }

  get upgrade(): HttpClientResponse.HttpClientResponse["upgrade"] {
    const reason = new HttpClientError.StatusCodeError({ request: this.request, response: this, description: "no upgrade in this runtime" });

    return Effect.fail(new HttpClientError.HttpClientError({ reason }));
  }

  pipe() {
    // `pipe` takes any number of functions: Effect's own helper reads them from `arguments`.
    // oxlint-disable-next-line prefer-rest-params
    return Pipeable.pipeArguments(this, arguments);
  }

  private decodeError(cause: unknown) {
    return new HttpClientError.HttpClientError({ reason: new HttpClientError.DecodeError({ request: this.request, response: this, cause }) });
  }
}

// ---- the engine's fetch

/** What `fetch` answers, as this file reads it (the engine's, or Bun's in tests). */
export interface FetchAnswer {
  readonly status: number;
  readonly url: string;
  /** The engine's fetch gives none (yet); Bun's does. */
  readonly headers?: Iterable<readonly [string, string]> | undefined;
  text(): Promise<string>;
}

/** What `fetch` is asked with. */
export interface FetchInit {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
}

/** The engine's `fetch` as this file uses it (also Bun's, in tests). */
export type Fetch = (url: string, init: FetchInit) => Promise<FetchAnswer>;

/** An `HttpClient` over `fetch` (herdr's global; tests pass Bun's). */
export function fetchClient(fetch: Fetch): HttpClient.HttpClient {
  return HttpClient.makeWith<never, never, HttpClientError.HttpClientError, never>(
    (prepared) => Effect.flatMap(prepared, (request) => Effect.gen(function* () {
      const url = yield* urlOf(request);
      const body = yield* bodyOf(request);
      const headers = { ...request.headers };
      const init: FetchInit = Option.match(body, { onNone: () => ({ method: request.method, headers }), onSome: (b) => ({ method: request.method, headers, body: b }) });
      const answer = yield* Effect.tryPromise({ try: () => fetch(url, init), catch: (cause) => transport(request, cause) });
      const text = yield* Effect.tryPromise({ try: () => answer.text(), catch: (cause) => transport(request, cause) });
      const where = Str.isEmpty(answer.url) ? url : answer.url;

      return new TextResponse(request, where, answer.status, Headers.fromInput(Arr.fromIterable(answer.headers ?? [])), text);
    })),
    Effect.succeed,
  );
}

// ---- curl through exec

/** How `curlClient` runs curl. */
export interface CurlOptions {
  /**
   * A shell fragment printing header lines (`Authorization: Bearer …`) for
   * every request: they go to curl on stdin. A non-zero exit ends the
   * request before anything is sent: `HeaderScriptExit` with its code.
   */
  readonly headersFrom?: string;
  /** Seconds curl may take for one attempt (`-m`); 20 by default. */
  readonly seconds?: number;
}

/** What curl prints after the body (`-w`), one `@name<TAB>value` line each. */
const TRAILER = String.raw`\n@code\t%{http_code}\n@retry\t%header{retry-after}\n@type\t%header{content-type}`;

/** The script: headers into a variable (never an argument), then curl with them on stdin. $1 method, $2 url, $3 seconds, $4 body. */
const script = (headersFrom: string) => String.raw`
h=$(
${headersFrom}
) || { s=$?; printf '\n@headers\t%s' "$s"; exit "$s"; }
if [ -n "$4" ]; then
  printf '%s\n' "$h" | curl -sS -m "$3" -X "$1" -w '${TRAILER}' -H @- --data-binary "$4" -- "$2"
else
  printf '%s\n' "$h" | curl -sS -m "$3" -X "$1" -w '${TRAILER}' -H @- -- "$2"
fi
`;

/** `exec` as `curlClient` uses it (the `Exec` service's `run`). */
export type RunProgram = (command: string, args: readonly string[], options?: ExecOptions) => Effect.Effect<ExecResult, ExecError>;

/** An `HttpClient` over curl (see the top). A body goes as an argument: never put a secret in one. */
export function curlClient(run: RunProgram, options: CurlOptions = {}): HttpClient.HttpClient {
  const seconds = options.seconds ?? 20;
  const text = script(options.headersFrom ?? ":");

  return HttpClient.makeWith<never, never, HttpClientError.HttpClientError, never>(
    (prepared) => Effect.flatMap(prepared, (request) => Effect.gen(function* () {
      const url = yield* urlOf(request);
      const body = yield* bodyOf(request);
      const said = Option.match(body, { onNone: () => "", onSome: (b) => (Predicate.isString(b) ? b : Buffer.from(b).toString("utf8")) });
      const args = ["-c", text, "sh", request.method, url, String(seconds), said];
      const r = yield* run("sh", args, { timeout: (seconds + 5) * 1000 }).pipe(Effect.mapError((cause) => transport(request, cause)));

      return yield* curlResponse(request, url, r);
    })),
    Effect.succeed,
  );
}

/** curl's output as a response: the body, then the trailer (from the last `\n@code\t` on). */
function curlResponse(request: HttpClientRequest.HttpClientRequest, url: string, r: ExecResult) {
  const refused = Option.fromNullOr(/\n@headers\t(\d+)$/.exec(r.stdout));

  if (Option.isSome(refused)) {
    const code = Number(refused.value[1]);

    return Effect.fail(transport(request, HeaderScriptExit.make({ code, message: `the request's headers script exited ${code}: nothing was sent` })));
  }

  const at = Str.lastIndexOf("\n@code\t")(r.stdout);
  const trailer = Option.match(at, { onNone: () => [], onSome: (i) => Str.split(Str.slice(i + 1)(r.stdout), "\n") });
  const field = (name: string) => Option.getOrElse(Option.map(Arr.findFirst(trailer, Str.startsWith(`@${name}\t`)), Str.slice(name.length + 2)), () => "");
  const code = Number(field("code"));

  if (r.code !== 0 || code === 0 || Number.isNaN(code)) {
    const said = lastLine(r.stderr);

    return Effect.fail(transport(request, CurlFailed.make({ code: r.code, message: Str.isEmpty(said) ? `curl exited ${r.code}` : said })));
  }

  const headers = Arr.filter([["retry-after", field("retry")], ["content-type", field("type")]] as const, ([, value]) => Str.isNonEmpty(value));
  const body = Str.trim(Str.slice(0, Option.getOrElse(at, () => 0))(r.stdout));

  return Effect.succeed(new TextResponse(request, url, code, Headers.fromInput(headers), body));
}

// ---- the policy

/** Methods a retry can't apply twice (RFC 9110 §9.2.2). */
const IDEMPOTENT = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

/** Statuses that say "try again later". */
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);

/** How `policy` retries. */
export interface PolicyOptions {
  /** One attempt's budget. */
  readonly timeout: Duration.Input;
  /** Attempts after the first (0: none). */
  readonly retries: number;
  /** The first back-off; doubled each time, with jitter. */
  readonly base?: Duration.Input;
  /** A Retry-After longer than this isn't waited for here: the error goes to the caller, who backs off. */
  readonly longest?: Duration.Input;
  /** The statuses worth another attempt (408, 429, 500, 502, 503, 504 by default). Leave 429 out where the caller keeps its own back-off. */
  readonly statuses?: ReadonlySet<number>;
}

/** The server's Retry-After (seconds, or a date: from `now`, ms). */
export function retryAfter(headers: Headers.Headers, now: number): Option.Option<Duration.Duration> {
  return Option.flatMap(Option.fromUndefinedOr(headers["retry-after"]), (value) => {
    const parsed = Headers.parseRetryAfter(value);

    if (Result.isFailure(parsed)) return Option.none();

    const r = parsed.success;

    return Option.some(Predicate.isTagged(r, "Duration") ? r.duration : Duration.millis(Math.max(0, DateTime.toEpochMillis(r.dateTime) - now)));
  });
}

/** The status error's response, when the error is one. */
const failedResponse = (error: HttpClientError.HttpClientError) =>
  Predicate.isTagged(error.reason, "StatusCodeError") ? Option.some(error.reason.response) : Option.none();

/**
 * A client that fails on any status but 2xx (`StatusCodeError`, the
 * response attached), gives each attempt `timeout`, and retries only what
 * is safe: an idempotent request (GET, HEAD, OPTIONS, PUT, DELETE) that
 * failed in transport or answered 408, 429, 500, 502, 503 or 504, at most
 * `retries` times, backing off from `base` (doubled, jittered) and never
 * sooner than the server's Retry-After. A Retry-After longer than `longest`
 * (30 s) isn't waited for: the error goes to the caller, whose own back-off
 * (a pace kept between reads) is the place for it. A POST or PATCH is never
 * retried: it may have landed.
 */
export function policy(options: PolicyOptions) {
  const longest = Duration.toMillis(Duration.fromInputUnsafe(options.longest ?? "30 seconds"));
  const statuses = options.statuses ?? TRANSIENT;

  const worth = (error: HttpClientError.HttpClientError, now: number): boolean => IDEMPOTENT.has(error.request.method)
    && Option.match(failedResponse(error), {
      onNone: () => Predicate.isTagged(error.reason, "TransportError"),
      onSome: (response) => statuses.has(response.status) && Option.match(retryAfter(response.headers, now), {
        onNone: () => true,
        onSome: (wait) => Duration.toMillis(wait) <= longest,
      }),
    });

  const backoff = Schedule.exponential(options.base ?? "500 millis").pipe(
    Schedule.jittered,
    Schedule.modifyDelay(({ duration, input }: Schedule.Metadata<Duration.Duration, HttpClientError.HttpClientError>) => Effect.map(Clock.currentTimeMillis, (now) => Option.match(
      Option.flatMap(failedResponse(input), (response) => retryAfter(response.headers, now)),
      { onNone: () => duration, onSome: (wait) => Duration.max(duration, wait) },
    ))),
  );

  const retryable = (error: HttpClientError.HttpClientError) => Effect.map(Clock.currentTimeMillis, (now) => worth(error, now));

  return (client: HttpClient.HttpClient): HttpClient.HttpClient => client.pipe(
    HttpClient.filterStatusOk,
    HttpClient.timeout(options.timeout),
    HttpClient.retry({ while: retryable, schedule: backoff, times: options.retries }),
  );
}

// ---- helpers

const bytes = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));

const transport = (request: HttpClientRequest.HttpClientRequest, cause: unknown) =>
  new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request, cause }) });

/** The request's full URL (its query appended). */
const urlOf = (request: HttpClientRequest.HttpClientRequest) => Effect.try({
  try: () => {
    const url = new URL(request.url);

    for (const [k, v] of request.urlParams) url.searchParams.append(k, Redacted.isRedacted(v) ? String(Redacted.value(v)) : v);

    return url.toString();
  },
  catch: (cause) => new HttpClientError.HttpClientError({ reason: new HttpClientError.InvalidUrlError({ request, cause }) }),
});

/** A body this runtime doesn't send (a stream, a form, a raw value other than text or bytes). */
const unsent = (request: HttpClientRequest.HttpClientRequest, what: string) =>
  Effect.fail(new HttpClientError.HttpClientError({ reason: new HttpClientError.EncodeError({ request, description: `a ${what} body isn't sent from this runtime` }) }));

/** The request's body as `fetch` and curl take it. */
const bodyOf = (request: HttpClientRequest.HttpClientRequest): Effect.Effect<Option.Option<string | Uint8Array>, HttpClientError.HttpClientError> => Match.value(request.body).pipe(
  Match.tag("Empty", () => Effect.succeedNone),
  Match.tag("Uint8Array", (b) => Effect.succeedSome(b.body)),
  Match.tag("Raw", (b) => (Predicate.isString(b.body) || Predicate.isUint8Array(b.body) ? Effect.succeedSome(b.body) : unsent(request, "raw"))),
  Match.orElse((b) => unsent(request, b._tag)),
);
