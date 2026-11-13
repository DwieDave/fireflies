// Sends an answer into the agent's terminal the way a person would: keys
// (hc keys) and typed text (hc send --force: pasted, then Enter), one step at
// a time. Before every step the screen is read again and the adapter decides
// from it (claude.ts step()); when the screen no longer shows the request
// that was answered, it refuses instead of pressing anything.

import type { AsyncContext } from "gpui-kit";
import { hc } from "herdr";
import type { ExecResult } from "herdr";
import type { Goal } from "./claude.ts";
import { adapterOf } from "./model.ts";
import type { Item } from "./model.ts";
import { readScreen } from "./engine.ts";

const STEPS = 60; // a block of questions takes ~20
const SETTLE_MS = 1600; // how long one key may take to show

/** Waits until the dialog on screen differs from the one in `before` (or a
 *  while passed). `view` picks the dialog out of a screen: the rest of a busy
 *  agent's screen changes all the time, and taking that for the key's effect
 *  would press the next key (a second Tab shuts the note line) too soon. */
export async function settled(cx: AsyncContext, address: string, before: string, view: (screen: string) => string = (s) => s, read: (address: string) => Promise<string | null> = readScreen): Promise<string | null> {
  const was = view(before);

  for (let waited = 0; waited < SETTLE_MS; waited += 80) {
    await cx.sleep(80);

    const now = await read(address);

    if (now !== null && view(now) !== was) {
      // One more short look: Claude draws a change in a few frames.
      await cx.sleep(60);

      return (await read(address)) ?? now;
    }
  }

  return read(address);
}

/** How an answer went: sent, or why not. */
export type Outcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** A failed hc call's words. */
const failed = (cause: unknown): ExecResult => ({ code: 1, stdout: "", stderr: cause instanceof Error ? cause.message : String(cause) });

/**
 * Answers `item` with `goal` (see claude.ts step()). `progress(text)` hears
 * how it goes.
 */
export async function answer(cx: AsyncContext, item: Item, goal: Goal, progress: (text: string) => void = () => undefined): Promise<Outcome> {
  const adapter = adapterOf({ report: { app: item.app }, program: { key: item.app } });

  if (!adapter.step) return { ok: false, reason: "Answering this agent from here isn't supported: go to it." };

  const state = {};
  let screen = await readScreen(item.address);
  let quiet = 0;

  for (let i = 0; i < STEPS; i++) {
    if (screen === null) return { ok: false, reason: "Its terminal can't be read." };

    const a = adapter.step(goal, screen, state);

    if ("done" in a) return { ok: true };

    if ("refuse" in a) return { ok: false, reason: a.refuse };

    if ("wait" in a) {
      // ~3 s: a busy agent's terminal may take a while to draw.
      if (++quiet > 12) return { ok: false, reason: a.reason ?? "Sent, but the request is still showing: look at the terminal." };

      await cx.sleep(250);
      screen = await readScreen(item.address);

      continue;
    }

    quiet = 0;

    const before = screen;

    if ("keys" in a) {
      if (a.keys.length) {
        progress(a.keys.join(" "));

        const r = await hc(["keys", item.address, ...a.keys]).catch(failed);

        if (r.code !== 0) return { ok: false, reason: `The keys didn't go through: ${r.stderr.trim() || "hc keys failed"}` };
      }
    } else {
      progress("typing");

      const r = await hc(["send", "--force", item.address, a.paste]).catch(failed);

      if (r.code !== 0) return { ok: false, reason: `The text didn't go through: ${r.stderr.trim() || "hc send failed"}` };
    }

    screen = await settled(cx, item.address, before, adapter.dialog);
  }

  return { ok: false, reason: "That took too many steps: look at the terminal." };
}
