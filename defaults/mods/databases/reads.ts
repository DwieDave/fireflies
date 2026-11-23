// The reads the window runs for its panels (the cluster's secret, the
// folder's environment, the tables, a table's structure, a page of rows, a
// test): each is listed while it runs, so its panel says what runs and for
// how long ("reading the tables… 4 s · esc stops it"), and each ends, by
// itself, at its deadline, or stopped (esc, the stop chip): a client's run is
// interrupted by its nonce (runner.ts cancel); anything else (a kubectl call)
// is left to finish unheard. The engine has no setTimeout: the window's tick
// (every second) ends the reads past their deadline (overdue).

import { Array as Arr, Clock, Deferred, Effect, Option } from "effect";
import { redraw } from "@fireflies/kit";
import { cancel } from "./runner.ts";
import { nowMs } from "./app.ts";
import type { DbRun } from "./app.ts";
import type { default as DbView } from "./main.ts";

/** The panel a read is for (where its words and stop chip are drawn). */
export type ReadPanel = "tables" | "structure" | "rows" | "conns";

/** A read going on. */
export interface Read {
  readonly id: number;
  /** What it does, in words ("reading the tables"). */
  readonly what: string;
  readonly panel: ReadPanel;
  readonly at: number;
  /** When it gives up (ms since the epoch), or null: only a stop ends it. */
  readonly until: number | null;
  /** The client run's nonce once it started (for the stop). */
  nonce: string | null;
  /** Ends it: stopped (esc, the chip) or late (its deadline). */
  readonly end: (how: "stopped" | "late") => void;
}

/** How a read ended: its value, stopped, or late (past its deadline, after `ms`). */
export type Ended<T> = { readonly value: T } | { readonly stopped: true } | { readonly late: number };

let ids = 0;

/** Runs `work` as a read of `panel`: listed while it runs; `started(nonce)` makes it stoppable by
 *  interrupting the client. Stopped or late, the work is interrupted (a client run is also
 *  cancelled by its nonce; a program's answer that comes after is dropped). A failure of `work`
 *  is the read's, the read unlisted however it ends. */
export const reading = <A, E, R>(v: DbView, what: string, panel: ReadPanel, work: (started: (nonce: string) => void) => Effect.Effect<A, E, R>, deadline: number | null = null): Effect.Effect<Ended<A>, E, R | DbRun> => Effect.gen(function* () {
  const ended = Deferred.makeUnsafe<Ended<A>>();
  const at = yield* Clock.currentTimeMillis;

  const unlist = (read: Read) => {
    v.reads = Arr.filter(v.reads, (r) => r !== read);
  };

  const read: Read = {
    id: ++ids, what, panel, at, until: deadline === null ? null : at + deadline, nonce: null,
    end: (how) => {
      if (!Arr.contains(v.reads, read)) return;

      unlist(read);
      Deferred.doneUnsafe(ended, Effect.succeed(how === "stopped" ? { stopped: true } : { late: deadline ?? nowMs() - at }));

      if (read.nonce !== null && v.dir !== null) v.run(cancel(v.dir, read.nonce));
    },
  };

  v.reads = [...v.reads, read];
  yield* redraw;

  const done = Effect.map(work((n) => {
    read.nonce = n;
  }), (value): Ended<A> => ({ value }));

  return yield* Effect.raceFirst(done, Deferred.await(ended)).pipe(Effect.ensuring(Effect.andThen(Effect.sync(() => unlist(read)), redraw)));
});

/** The read shown in a panel (the newest), or null. */
export const readIn = (v: DbView, panel: ReadPanel): Read | null => Option.getOrNull(Arr.findLast(v.reads, (r) => r.panel === panel));

/** A read's words with its seconds: "reading the tables… 4 s". */
export function readWords(r: Read, now: number): string {
  const s = Math.floor((now - r.at) / 1000);

  return `${r.what}… ${s} s`;
}

/** Stops every read (esc while one runs; the stop chip): true when there was one. */
export function stopReads(v: DbView, panel: ReadPanel | null = null): boolean {
  const list = Arr.filter(v.reads, (r) => panel === null || r.panel === panel);

  for (const r of list) r.end("stopped");

  return list.length > 0;
}

/** Ends the reads past their deadline (the window's tick). */
export function overdue(v: DbView, now: number): void {
  for (const r of v.reads) if (r.until !== null && now >= r.until) r.end("late");
}

/** Why a read gave no value, in words, or null when it has one. */
export function endWords<T>(e: Ended<T>, what: string): string | null {
  if ("stopped" in e) return `${what}: stopped · r reads again`;

  if ("late" in e) return `${what}: no answer after ${Math.round(e.late / 1000)} s · r tries again`;

  return null;
}
