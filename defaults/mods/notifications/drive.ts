// Sends an answer into the agent's terminal the way a person would: keys
// (hc keys) and typed text (hc send --force: pasted, then Enter), one step at
// a time. Before every step the screen is read again and the adapter decides
// from it (claude.ts step()); when the screen no longer shows the request
// that was answered, it refuses instead of pressing anything.

import { Array as Arr, Effect, String as Str } from "effect";
import type { Goal, StepState } from "./claude.ts";
import { adapterOf } from "./model.ts";
import type { Item } from "./model.ts";
import { readScreen } from "./engine.ts";
import { Hc } from "@fireflies/kit";

const STEPS = 60; // a block of questions takes ~20
const SETTLE_MS = 1600; // how long one key may take to show
const LOOK_MS = 80; // between two reads while a key takes effect

/** Reads a terminal's screen (null: it can't be read). */
export type ReadScreen = (address: string) => Effect.Effect<string | null, never, Hc>;

/** Waits until the dialog on screen differs from the one in `before` (or a
 *  while passed). `view` picks the dialog out of a screen: the rest of a busy
 *  agent's screen changes all the time, and taking that for the key's effect
 *  would press the next key (a second Tab shuts the note line) too soon. */
export const settled = Effect.fnUntraced(function* (address: string, before: string, view: (screen: string) => string = (s) => s, read: ReadScreen = readScreen) {
  const was = view(before);

  for (let waited = 0; waited < SETTLE_MS; waited += LOOK_MS) {
    yield* Effect.sleep(LOOK_MS);

    const now = yield* read(address);

    if (now !== null && view(now) !== was) {
      // One more short look: Claude draws a change in a few frames.
      yield* Effect.sleep(60);

      return (yield* read(address)) ?? now;
    }
  }

  return yield* read(address);
});

/** How an answer went: sent, or why not. */
export type Outcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Why `hc` didn't take what was sent: its last words, else what it was. */
const didntGo = (what: string, fallback: string, said: string): Outcome => ({ ok: false, reason: `${what} didn't go through: ${Str.isEmpty(Str.trim(said)) ? fallback : Str.trim(said)}` });

/** Sends keys or text with `hc`: an exit or a run that failed is the outcome's reason; null when it went. */
const send = (args: readonly string[], what: string, fallback: string): Effect.Effect<Outcome | null, never, Hc> =>
  Hc.use((h) => h.run(args)).pipe(
    Effect.map((r) => (r.code === 0 ? null : didntGo(what, fallback, r.stderr))),
    Effect.catchTag("ExecError", (e) => Effect.succeed(didntGo(what, fallback, e.message))),
  );

/**
 * Answers `item` with `goal` (see claude.ts step()). `progress(text)` hears
 * how it goes.
 */
export const answer = Effect.fnUntraced(function* (item: Item, goal: Goal, progress: (text: string) => void = () => undefined) {
  const adapter = adapterOf({ report: { app: item.app }, program: { key: item.app } });
  const step = adapter.step;

  if (step === null) return { ok: false, reason: "Answering this agent from here isn't supported: go to it." } satisfies Outcome;

  const state: StepState = {};
  let screen = yield* readScreen(item.address);
  let quiet = 0;

  for (let i = 0; i < STEPS; i++) {
    if (screen === null) return { ok: false, reason: "Its terminal can't be read." } satisfies Outcome;

    const a = step(goal, screen, state);

    if ("done" in a) return { ok: true } satisfies Outcome;

    if ("refuse" in a) return { ok: false, reason: a.refuse } satisfies Outcome;

    if ("wait" in a) {
      // ~3 s: a busy agent's terminal may take a while to draw.
      if (++quiet > 12) return { ok: false, reason: a.reason ?? "Sent, but the request is still showing: look at the terminal." } satisfies Outcome;

      yield* Effect.sleep(250);
      screen = yield* readScreen(item.address);

      continue;
    }

    quiet = 0;

    const before = screen;

    if ("keys" in a) {
      if (a.keys.length > 0) {
        progress(Arr.join(a.keys, " "));

        const failed = yield* send(["keys", item.address, ...a.keys], "The keys", "hc keys failed");

        if (failed !== null) return failed;
      }
    } else {
      progress("typing");

      const failed = yield* send(["send", "--force", item.address, a.paste], "The text", "hc send failed");

      if (failed !== null) return failed;
    }

    screen = yield* settled(item.address, before, adapter.dialog);
  }

  return { ok: false, reason: "That took too many steps: look at the terminal." } satisfies Outcome;
});
