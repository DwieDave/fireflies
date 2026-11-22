// The git window's lanes: its actions run one at a time, in the order they
// were asked for, and so do its reads (main.ts: `acts` for git actions,
// `reads` for reads). Each job is its own run on the copy's runtime, so
// closing the window interrupts a job waiting in a lane as well as one
// running; a lane only orders them.

import { Effect, Semaphore } from "effect";

export class Lane {
  readonly gate = Semaphore.makeUnsafe(1);
  /** Jobs asked for and not done yet (waiting or running): tests wait for none. */
  pending = 0;

  /** `job`, after every job asked for before it on this lane. */
  serial<A, E, R>(job: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return Effect.suspend(() => {
      this.pending += 1;

      return this.gate.withPermits(1)(job).pipe(Effect.ensuring(Effect.sync(() => { this.pending -= 1; })));
    });
  }
}
