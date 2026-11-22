// The git window's tests: a stand-in for gpui's AsyncContext (the kit's
// testing layers give services, not a view's context) whose timers run on a
// clock the test moves, never the wall clock, and how a test waits for the
// view's work: its two lanes drained (git/queue.ts). Both are Effects; a
// test runs them at its edge with the mod's own runtime.

import { Effect } from "effect";
import type { Lane } from "../defaults/mods/git/queue.ts";

interface Timer {
  readonly at: number;
  readonly fire: (cx: unknown) => void;
  live: boolean;
}

/** A view's context, and `advance(ms)`: moves its clock, firing every timer due by then. */
export function hostContext(extra: Record<string, unknown> = {}) {
  let now = 0;
  const timers: Timer[] = [];
  const cx: any = {
    notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }),
    write_to_clipboard(t: string) { cx.clip = t; },
    timer: {
      every() {},
      after(ms: number, fire: (cx: unknown) => void) {
        const t: Timer = { at: now + ms, fire, live: true };

        timers.push(t);

        return { cancel() { t.live = false; } };
      },
    },
    ...extra,
  };

  /** The earliest live timer due by now. */
  const due = (): Timer | undefined => timers.filter((t) => t.live && t.at <= now).sort((a, b) => a.at - b.at)[0];

  const advance = (ms: number): Effect.Effect<void> => Effect.gen(function* () {
    now += ms;

    for (let t = due(); t !== undefined; t = due()) {
      t.live = false;
      t.fire(cx);
      // The fiber that slept wakes on its own turn.
      yield* Effect.yieldNow;
    }
  });

  return { cx, advance };
}

/** Until neither lane has a job waiting or running (a job may queue another: a read's loadMain). */
export const drained = (v: { readonly acts: Lane; readonly reads: Lane }): Effect.Effect<void> => Effect.gen(function* () {
  yield* Effect.yieldNow;

  while (v.acts.pending > 0 || v.reads.pending > 0) {
    yield* v.acts.serial(Effect.void);
    yield* v.reads.serial(Effect.void);
    yield* Effect.yieldNow;
  }
});
