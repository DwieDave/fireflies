// What the GitHub window's tests share: its effects run as the window runs
// them (on the mod's runtime, redrawn through a test's cx and timed by that
// cx's timers), so a test awaits a run's end. Import it after the test's herdr
// stand-in (mock.module): the runtime's services look herdr up when called.

import { Clock, Effect } from "effect";
import { Redraw, hostClock } from "@fireflies/kit";
import { runtime } from "../defaults/mods/github/fx.ts";

/** A cx as the tests' stand-ins have it: a redraw, and (to time sleeps) timer.after. */
interface TestCx {
  notify(): void;
  readonly timer?: unknown;
}

/** Runs one of the window's effects to its end: redrawn through `cx` (none: not redrawn), its sleeps on cx's timers. */
export function runOn<A, E, R>(effect: Effect.Effect<A, E, R>, cx: TestCx | null): Promise<A> {
  const redrawn = Effect.provideService(effect, Redraw, Redraw.of({ now: Effect.sync(() => cx?.notify()) }));
  const timed = cx?.timer === undefined ? redrawn : Effect.provideService(redrawn, Clock.Clock, hostClock(cx as never));

  return runtime.runtime.runPromise(timed as Effect.Effect<A, E, never>);
}
