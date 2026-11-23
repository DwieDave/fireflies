// The Databases window's own HTTP endpoint: a remote libSQL server's pipeline
// (hrana.ts builds the body and reads the answer), over the kit's HttpClient
// with `policy`. This file is where `effect/http` is allowed
// (oxlint.effect.config.ts): the rest of the mod sees the `Libsql` service
// only. It imports nothing of the app, so a test gives it kit/testing's
// `httpTest` as its client.

import { Context, Effect, Layer, Option, Predicate } from "effect";
import type { Redacted } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import type { HttpClientError } from "effect/http";
import { policy } from "@fireflies/kit";

/** A remote libSQL server's answer: its status and its body, whatever the status (a 401 says why in it). */
export interface LibsqlAnswer {
  readonly status: number;
  readonly text: string;
}

/** A remote libSQL database's pipeline endpoint (POST <base>/v2/pipeline). */
export class Libsql extends Context.Service<Libsql, {
  /** Posts `body` with the token as a bearer header (never an argument, never logged): the answer, or the transport's failure. */
  readonly pipeline: (url: string, token: Redacted.Redacted | null, body: string) => Effect.Effect<LibsqlAnswer, HttpClientError.HttpClientError>;
}>()("@fireflies/databases/Libsql") {
  /** Over the HttpClient: 60 s an attempt (a long statement), never retried (a POST may have landed). */
  static readonly layer = Layer.effect(Libsql, Effect.gen(function* () {
    const client = policy({ timeout: "60 seconds", retries: 0 })(yield* HttpClient.HttpClient);

    return Libsql.of({
      pipeline: (url, token, body) => {
        const request = HttpClientRequest.post(url).pipe(HttpClientRequest.bodyText(body, "application/json"));
        const sent = token === null ? request : HttpClientRequest.bearerToken(request, token);

        return client.execute(sent).pipe(
          Effect.flatMap((r) => Effect.map(r.text, (text): LibsqlAnswer => ({ status: r.status, text }))),
          // policy fails on a status other than 2xx; the server's words for it are in the body.
          Effect.catchTag("HttpClientError", (error) => Option.match(refused(error), {
            onNone: () => Effect.fail(error),
            onSome: (r) => Effect.map(Effect.orElseSucceed(r.text, () => ""), (text): LibsqlAnswer => ({ status: r.status, text })),
          })),
        );
      },
    });
  }));
}

/** The response of a status error, when the error is one. */
const refused = (error: HttpClientError.HttpClientError) =>
  (Predicate.isTagged(error.reason, "StatusCodeError") ? Option.some(error.reason.response) : Option.none());
