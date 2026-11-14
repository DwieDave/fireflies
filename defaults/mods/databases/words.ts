// A client's connect errors in a person's words, with what they mean for a
// port-forward: a port that takes the connection and never answers (the
// forward runs, its pod side doesn't), a connection closed before the server
// spoke, nothing listening. psql gives up connecting after PGCONNECT_TIMEOUT
// (runner.ts sets 10 s unless the environment has one), mysql after its
// --connect-timeout=10 (clients.ts).

import type { RunError } from "./parse-out.ts";
import type { Conn } from "./kinds.ts";
import { DEFAULT_PORT } from "./kinds.ts";

/** The connect deadline, in seconds (runner.ts PGCONNECT_TIMEOUT, clients.ts --connect-timeout). */
export const CONNECT_SECONDS = 10;

/** What a connect error means, said plainly; other errors as they are. */
export function connectWords(c: Conn, e: RunError): RunError {
  if (e.index !== null) return e;

  const at = `${c.host || "localhost"}:${c.port ?? DEFAULT_PORT[c.kind]}`;
  const m = e.message;

  if (/timeout expired|Can't connect to .* \(110\)|Lost connection to .* reading initial communication packet|timed out/i.test(m)) {
    return { ...e, message: `nothing answered on ${at} within ${CONNECT_SECONDS} s: something takes the connection, but no database speaks (a port-forward whose pod is gone does this) · ${m}` };
  }

  if (/server closed the connection unexpectedly|Lost connection to .* during query|connection reset/i.test(m)) {
    return { ...e, message: `the connection on ${at} was closed before the database answered (a port-forward that can't reach its pod does this) · ${m}` };
  }

  if (/Connection refused|Can't connect to .* \(61\)|Can't connect to .* \(111\)/i.test(m)) {
    return { ...e, message: `nothing listens on ${at} (a port-forward that isn't running) · ${m}` };
  }

  return e;
}
