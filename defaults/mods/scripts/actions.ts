// What the script runner does: run, watch, stop or dismiss a run (asking
// first where it matters), its output, enter and esc, the filter, the list
// in groups.

import type { Context } from "gpui-kit";
import { hc } from "herdr";
import { needsAppManagement } from "./nix.ts";
import type { Run } from "./runs.ts";
import { watch, stop, dismiss, restart } from "./runs.ts";
import { ASK_MS } from "./state.ts";
import type { Output, Item, Act, Asked } from "./state.ts";
import { goTo } from "./found.ts";
import type { default as ScriptsDeck } from "./main.ts";

export function runAct(v: ScriptsDeck, what: Act, r: Run, cx: Context) {
  // A run that ended has no terminal to float: its output shows here instead.
  if (what === "watch" && !r.live) return showOutput(v, r, cx);

  if (what === "watch") {
    v.dismissDeck();

    return watch(r);
  }

  // Ending a running one (stop, or again: it's stopped first) asks: the
  // same press again within ASK_MS does it.
  if (r.live && (what === "stop" || what === "again") && !asked(v, what, r)) return ask(v, what, r, cx);

  v.asking = null;

  // Queued for the strip (runs.ts), like a start: closing the deck can't cut them short.
  if (what === "stop") stop(r);
  else if (what === "dismiss") dismiss(r);
  else if (what === "again") restart(r);

  cx.notify();
}

/** The press `what` on `r` was asked for and is still fresh. */
export function asked(v: ScriptsDeck, what: Asked, r: Run) {
  const a = v.asking;

  return a !== null && a.what === what && a.address === r.address && Date.now() < a.until;
}

/** Asks before ending a running one: its chip says "stop?" / "again?" for ASK_MS. */
export function ask(v: ScriptsDeck, what: Asked, r: Run, cx: Context) {
  v.asking = { what, address: r.address, until: Date.now() + ASK_MS };
  cx.timer.after(ASK_MS + 50, (cx) => {
    if (v.asking && Date.now() >= v.asking.until) { v.asking = null; cx.notify(); }
  });
  cx.notify();
}

/** Shows an ended run's last output lines in place of the scripts (esc: back). */
export function showOutput(v: ScriptsDeck, r: Run, cx: Context) {
  v.output = { r, lines: null, back: 0, grant: false, shown: null, placed: false };
  cx.notify();
  cx.spawn(async (cx) => {
    const res = await hc(["read", r.address, "--lines", "300"]).catch(() => null);

    const now = v.output;

    if (now === null || now.r.address !== r.address) return;

    const text = res?.code === 0 ? res.stdout : null;

    now.lines = text === null ? ["(its output is gone)"] : text.replace(/\s+$/, "").split("\n");
    now.grant = needsAppManagement(r, text);
    cx.notify();
  });
}

/** Enter (shift: and watch) on the cursor's item. */
export function enterRow(v: ScriptsDeck, shift: boolean, cx: Context) {
  const cur = v.items[v.cursor];

  if (!cur || v.gone) return;

  if (cur.kind === "run") return v.act("watch", cur.r, cx);

  v.gone = true;
  goTo(v, cur.row.s, shift);
}

/** Esc, one step at a time: the filter's text, the filter, an ended run's
 *  output, then the deck. */
export function escapeKey(v: ScriptsDeck, cx: Context) {
  if (v.typing && v.query) filtered(v, "");
  else if (v.typing) v.typing = false;
  else if (v.output) v.output = null;
  else return v.dismissDeck();

  cx.notify();
}

/** The filter changed: the cursor starts over on what matches. */
export function filtered(v: ScriptsDeck, q: string) {
  v.query = q;
  v.cursor = -1;
  v.scroll = 0;
}

/** Scrolls an ended run's output `d` lines (+: back, toward its start). */
export function scrollOutput(o: Output, d: number) {
  const n = o.lines?.length ?? 0;

  o.back = Math.max(0, Math.min(Math.max(0, n - (o.shown ?? 1)), o.back + d));
}

/** Where each group starts in `items`: the runs, then each manifest's scripts. */
export function groups(items: readonly Item[]) {
  return items.flatMap((it, i) => {
    const prev = items[i - 1];

    return prev === undefined || it.kind !== prev.kind || (it.kind === "script" && prev.kind === "script" && it.row.head !== prev.row.head) ? [i] : [];
  });
}
