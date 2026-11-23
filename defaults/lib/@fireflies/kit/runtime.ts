// Running effects from a mod's callbacks.
//
// One runtime per mod (`modRuntime(layer)` at the top of its main file): the
// services built once, shared by every copy the mod has open. Each copy
// attaches to it in `init` (`fx = runtime.attach(cx, report)`) and runs its
// effects through that handle from anywhere: a render's click, a key
// handler, a command, a timer. The handle:
//
// - holds `init`'s AsyncContext (made to be held: valid across awaits,
//   refusing once the copy is closed or reloaded), never a callback's
//   `cx`, which ends with its call;
// - gives each effect this copy's clock (`Effect.sleep`, `Schedule.spaced`
//   run on `cx.timer`: the engine has no setTimeout) and its `Redraw`;
// - keeps the fibers it started, and interrupts them all in `close()`
//   (`View.close`, 250 ms budget for every copy), so no timer or loop
//   outlives its view;
// - reports what failed the mod's own way (`report`: its `say`, a toast),
//   and redraws the copy when an effect it started ends.

import { Array as Arr, Cause, Clock, Context, Duration, Effect, Exit, Fiber, ManagedRuntime, String as Str } from "effect";
import type { Layer } from "effect";
import type { AsyncContext } from "gpui-kit";

/** Redraws the copy that started the running effect (its `cx.notify()`). */
export class Redraw extends Context.Service<Redraw, {
  readonly now: Effect.Effect<void>;
}>()("@fireflies/kit/runtime/Redraw") {}

/** Redraws the copy that started the running effect. */
export const redraw = Redraw.use((r) => r.now);

/** How a copy shows a failure: one line, in its own words (its `say`, a toast). */
export type Report = (message: string) => void;

/** What an effect run from a copy may use besides the mod's services. */
export type ViewServices = Redraw;

/** Options of one run. */
export interface RunOptions {
  /** Runs replace each other: a run under the same key interrupts the one before (latest wins). */
  readonly key?: string;
  /** Redraw the copy when it ends (default true). */
  readonly redraw?: boolean;
}

/** One failure, as the line a person reads. Interruptions say nothing. */
export function describe<E>(cause: Cause.Cause<E>): string | null {
  if (Cause.hasInterruptsOnly(cause)) return null;

  const error = Cause.squash(cause);

  if (error instanceof Error) return error.message || error.name;

  return String(error);
}

/** A copy's clock: the wall clock, and sleeps on its `cx.timer` (cancelled when the fiber is interrupted). */
export function hostClock(cx: AsyncContext): Clock.Clock {
  const sleep = (duration: Duration.Duration): Effect.Effect<void> => {
    const ms = Duration.toMillis(duration);

    if (ms <= 0) return Effect.yieldNow;

    if (!Number.isFinite(ms)) return Effect.never;

    return Effect.callback<void>((resume) => {
      // owner null: the fiber, not whichever view's call is running now, owns it; close() interrupts the fiber, which cancels it.
      const task = cx.timer.after(ms, () => resume(Effect.void), { owner: null });

      return Effect.sync(() => task.cancel());
    });
  };

  // This is the Clock: the wall clock is where it reads the time.
  // oxlint-disable-next-line effecttsgo/global-date
  const millis = () => Date.now();
  const nanos = () => BigInt(millis()) * 1_000_000n;

  return {
    currentTimeMillisUnsafe: millis,
    currentTimeMillis: Effect.sync(millis),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: nanos,
    monotonicTimeNanos: Effect.sync(nanos),
    sleep,
  };
}

/** A copy's handle on its mod's runtime (see the top). */
export interface ViewFx<R> {
  /** Starts `effect` for this copy; failures are reported, the copy redraws when it ends. */
  readonly run: <A, E>(effect: Effect.Effect<A, E, R | ViewServices>, options?: RunOptions) => void;
  /** Runs `effect` now and returns its value: a read for a render (it may not wait or fail). */
  readonly now: <A>(effect: Effect.Effect<A, never, R>) => A;
  /** Interrupts everything this copy started and waits for it to stop (the app cuts `close` off at 250 ms). */
  readonly close: () => Promise<void>;
  /** How many effects this copy is running (tests, and a busy mark). */
  readonly running: () => number;
}

/** The mod's runtime: its services, built once. */
export interface ModRuntime<R> {
  /** Attaches a copy: `init`'s `cx` and how it reports a failure. */
  readonly attach: (cx: AsyncContext, report: Report) => ViewFx<R>;
  /** Runs `effect` now and returns its value: a read for a render, which needs no copy (it may not wait or fail). */
  readonly now: <A>(effect: Effect.Effect<A, never, R>) => A;
  /** Runs an effect outside any copy (a test, a module-level task): no copy's clock, no redraw. */
  readonly runtime: ManagedRuntime.ManagedRuntime<R, never>;
}

/** The mod's runtime over `layer` (live.ts `Live`, or a test layer). */
export function modRuntime<R>(layer: Layer.Layer<R>): ModRuntime<R> {
  const runtime = ManagedRuntime.make(layer);

  const attach = (cx: AsyncContext, report: Report): ViewFx<R> => {
    const fibers = new Set<Fiber.Fiber<unknown, unknown>>();
    const keyed = new Map<string, Fiber.Fiber<unknown, unknown>>();
    const clock = hostClock(cx);
    const redrawService = Redraw.of({ now: Effect.sync(() => cx.notify()) });
    let closed = false;

    const run = <A, E>(effect: Effect.Effect<A, E, R | ViewServices>, options?: RunOptions): void => {
      if (closed) return;

      const key = options?.key;
      const before = key === undefined ? undefined : keyed.get(key);

      if (before !== undefined) before.interruptUnsafe();

      const fiber = runtime.runFork(effect.pipe(Effect.provideService(Redraw, redrawService), Effect.provideService(Clock.Clock, clock)));

      fibers.add(fiber);

      if (key !== undefined) keyed.set(key, fiber);

      fiber.addObserver((exit) => {
        fibers.delete(fiber);

        if (key !== undefined && keyed.get(key) === fiber) keyed.delete(key);

        if (Exit.isFailure(exit)) {
          const said = describe(exit.cause);

          if (said !== null && !closed) report(said);
        }

        if (!closed && options?.redraw !== false) cx.notify();
      });
    };

    const close = (): Promise<void> => {
      closed = true;

      const all = Arr.fromIterable(fibers);

      fibers.clear();
      keyed.clear();

      return runtime.runPromise(Fiber.interruptAll(all));
    };

    return { run, now: (effect) => runtime.runSync(effect), close, running: () => fibers.size };
  };

  return { attach, now: (effect) => runtime.runSync(effect), runtime };
}

/** A moment's local wall-clock fields: what a view prints ("14:05", "Tue", "2026-11-16"). */
export interface LocalTime {
  readonly year: number;
  /** 1 January … 12 December. */
  readonly month: number;
  /** The day of the month, 1 … 31. */
  readonly day: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  /** 0 Sunday … 6 Saturday. */
  readonly weekday: number;
  /** The zone's offset from UTC at that moment, in minutes (east positive: 60 for CET). */
  readonly offset: number;
}

/**
 * The local time at `ms`. The engine has no `Intl`, so Effect's `DateTime`
 * can't name the person's time zone; JavaScript's Date reads it from the
 * system, here and nowhere else in a mod.
 */
export function localTime(ms: number): LocalTime {
  // oxlint-disable-next-line effecttsgo/global-date
  const d = new Date(ms);

  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hours: d.getHours(),
    minutes: d.getMinutes(),
    seconds: d.getSeconds(),
    weekday: d.getDay(),
    offset: -d.getTimezoneOffset(),
  };
}

const two = (n: number): string => Str.padStart(2, "0")(String(n));

/**
 * `ms` as a plain local stamp: "2026-11-16 14:05" (`seconds`: "2026-11-16
 * 14:05:09"; `zone`: "… +0100", as git prints one).
 */
export function localStamp(ms: number, show: { readonly seconds?: boolean; readonly zone?: boolean } = {}): string {
  const t = localTime(ms);
  const time = `${two(t.hours)}:${two(t.minutes)}${show.seconds === true ? `:${two(t.seconds)}` : ""}`;
  const off = Math.abs(t.offset);
  const zone = show.zone === true ? ` ${t.offset < 0 ? "-" : "+"}${two(Math.floor(off / 60))}${two(off % 60)}` : "";

  return `${t.year}-${two(t.month)}-${two(t.day)} ${time}${zone}`;
}
