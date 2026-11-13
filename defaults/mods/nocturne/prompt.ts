// A nix switch's password, typed where it's asked. A switch activates through
// sudo in its run's own terminal (../scripts/nix.js switchPlan), and
// that terminal has no pane: so when its last line is sudo's prompt
// (SUDO_PROMPT), a small window shows it, the run's name and "password" in a
// bar over the terminal itself, cut down to its last lines. The person types
// into the terminal: sudo reads the password there, and nothing else sees it.
// Once the output moves past the prompt (the password was taken), the window
// goes and the run carries on in the background. "Sorry, try again." keeps
// it open for the next try. Its bar's cancel presses ctrl-c in the run, which
// ends it as "cancelled".
//
// Not when the run's terminal already floats (the person is watching it:
// it's typed there), nor without a prompt (sudo took a cached password, or
// Touch ID's own dialog asks). The strip's timer calls watchPrompts.

import { hc, terminals, shared, setShared, openOverlay, closeOverlay } from "herdr";
import type { OverlaySpec } from "herdr";
import { isString, literal, nullable, object, oneOf, readSharedMap, sharedMapKey, writeSharedMap } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import { isTerminal } from "./guards.ts";

/** A copy of ../scripts/nix.js SUDO_PROMPT (a mod can't import another's files). */
export const SUDO_PROMPT = "password to activate (sudo): ";

// The small windows open now: { address: { id } }, or { closed: true } once
// cancelled, so it doesn't come back while the run ends.
export const PROMPTS = "scripts.prompts";

/** A run's small window: { id } (null while it opens), or { closed: true } (the scripts mod, on cancel). */
const isPromptWindow = oneOf(object({ id: nullable(isString) }), object({ closed: literal(true) }));

type PromptWindow = Guarded<typeof isPromptWindow>;

const PROMPTS_KEY = sharedMapKey(PROMPTS, isPromptWindow);

/** The small windows now, by run address. */
const promptsNow = (): Map<string, PromptWindow> => new Map(readSharedMap(shared, PROMPTS_KEY));

/** A window's overlay id, if it has one open. */
const idOf = (w: PromptWindow | undefined): string | null => (w && "id" in w ? w.id : null);

export const PROMPT_W = 440;
export const PROMPT_H = 34 + 58;

/** Whether a terminal's screen is waiting for the password: its last line is
 *  the prompt, or sudo's "Sorry, try again." just before it asks again. */
export function asking(screen: string | null | undefined): boolean {
  const lines = (screen ?? "").split("\n").map((l) => l.replace(/\s+$/, "")).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";

  return last.endsWith(SUDO_PROMPT.trim()) || /^Sorry, try again\.?$/.test(last);
}

/** The small window: a bar (scripts with { password }) over the terminal. */
export function promptOverlay(address: string, name: string | undefined): OverlaySpec {
  return {
    kind: "dialog", modal: true, width: PROMPT_W, height: PROMPT_H,
    layout: {
      type: "column",
      children: [
        { type: "block", size: { px: 34 }, content: { mod: "scripts", props: { password: address, name } } },
        { type: "block", padding: [4, 10], content: { terminal: address } },
      ],
    },
  };
}

let busy = false;

/** Opens and closes the small windows for the live switch runs' prompts. */
export async function watchPrompts(): Promise<void> {
  const live = terminals().filter((t) => isTerminal(t)).filter((t) => t.labels?.["nocturne.script.plan"]);

  if (busy || (!live.length && !promptsNow().size)) return;

  busy = true;

  try {
    for (const t of live) {
      const r = await hc(["read", t.address, "--lines", "0"]).catch(() => null);

      if (r?.code !== 0) continue;

      const now = promptsNow();
      const mine = now.get(t.address);

      if (asking(r.stdout)) {
        if (mine || t.floating) continue;

        // Claimed before it opens, so another copy of the strip doesn't open one too.
        writeSharedMap(setShared, PROMPTS_KEY, now.set(t.address, { id: null }));

        const id = openOverlay(promptOverlay(t.address, t.labels?.["nocturne.script.name"] || t.labels?.["nocturne.script"]));

        writeSharedMap(setShared, PROMPTS_KEY, promptsNow().set(t.address, { id }));
      } else {
        const id = idOf(mine);

        if (id) {
          closeOverlay(id);
          now.delete(t.address);
          writeSharedMap(setShared, PROMPTS_KEY, now);
        }
      }
    }

    // A run that ended takes its window with it (an overlay with its terminal closes by itself).
    const left = promptsNow();
    const gone = [...left.keys()].filter((a) => !live.some((t) => t.address === a));

    for (const a of gone) {
      const id = idOf(left.get(a));

      if (id) closeOverlay(id);

      left.delete(a);
    }

    if (gone.length) writeSharedMap(setShared, PROMPTS_KEY, left);
  } finally {
    busy = false;
  }
}
