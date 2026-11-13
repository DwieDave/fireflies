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

/** A copy of ../scripts/nix.js SUDO_PROMPT (a mod can't import another's files). */
export const SUDO_PROMPT = "password to activate (sudo): ";
// The small windows open now: { address: { id } }, or { closed: true } once
// cancelled, so it doesn't come back while the run ends.
export const PROMPTS = "scripts.prompts";
const LABEL = "nocturne.script";
export const PROMPT_W = 440, PROMPT_H = 34 + 58;

/** Whether a terminal's screen is waiting for the password: its last line is
 *  the prompt, or sudo's "Sorry, try again." just before it asks again. */
export function asking(screen) {
  const lines = String(screen ?? "").split("\n").map((l) => l.replace(/\s+$/, "")).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  return last.endsWith(SUDO_PROMPT.trim()) || /^Sorry, try again\.?$/.test(last);
}

/** The small window: a bar (scripts with { password }) over the terminal. */
export function promptOverlay(address, name) {
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
export async function watchPrompts() {
  const live = terminals().filter((t) => t?.labels?.[`${LABEL}.plan`]);
  const open = { ...(shared(PROMPTS) ?? {}) };
  if (busy || (!live.length && !Object.keys(open).length)) return;
  busy = true;
  try {
    for (const t of live) {
      const r = await hc(["read", t.address, "--lines", "0"]).catch(() => null);
      if (r?.code !== 0) continue;
      const now = { ...(shared(PROMPTS) ?? {}) };
      const mine = now[t.address];
      if (asking(r.stdout)) {
        if (mine || t.floating) continue;
        // Claimed before it opens, so another copy of the strip doesn't open one too.
        now[t.address] = { id: null };
        setShared(PROMPTS, now);
        const id = openOverlay(promptOverlay(t.address, t.labels[`${LABEL}.name`] || t.labels[LABEL]));
        setShared(PROMPTS, { ...(shared(PROMPTS) ?? {}), [t.address]: { id } });
      } else if (mine?.id) {
        closeOverlay(mine.id);
        delete now[t.address];
        setShared(PROMPTS, now);
      }
    }
    // A run that ended takes its window with it (an overlay with its terminal closes by itself).
    const left = { ...(shared(PROMPTS) ?? {}) };
    const gone = Object.keys(left).filter((a) => !live.some((t) => t.address === a));
    for (const a of gone) { if (left[a]?.id) closeOverlay(left[a].id); delete left[a]; }
    if (gone.length) setShared(PROMPTS, left);
  } finally {
    busy = false;
  }
}
