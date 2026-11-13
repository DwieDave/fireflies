// Where the deck lives: over the tab (props.overlay: the popover under the
// tree mark, or the centered dialog) or in a pane of a tab (no overlay), and
// moving between the two (ctrl-t, the head's ◧ / ⧉, procs.to-pane /
// procs.to-window). docs/mods-in-panes.md is the pattern every window mod
// follows.
//
// A pane has props { slot, folder?, on?, tab? }: slot is unique, so the pane
// finds itself in panes() and keeps what it shows in localStorage (per slot),
// which brings it back after a restart; the deck reads this machine whatever
// the folder. In a pane nothing closes it but q (its own pane, by slot) and
// the pane's own ×: going to a terminal, opening a port or a folder leave it.
// A move hands the tab, the cursors, the find and the scope over in a
// one-shot note, shared(HANDOVER), the new copy takes within 5 s.

import { panes, focused, run, openOverlay, closeOverlay, shared, setShared } from "herdr";
import type { OverlaySpec, PaneInfo } from "herdr";
import type { Context } from "gpui-kit";
import type { Guarded } from "./guard.ts";
import { isBoolean, isNumber, isString, literal, nullable, object, parseJson, readShared, sharedKey, writeShared } from "./guard.ts";
import { DECK, H, W, deckProps } from "./state.ts";
import type { default as ProcsDeck } from "./main.ts";

/** How long a handover waits for the new copy, and how long the old copy stays after a move. */
export const HANDOVER_FRESH = 5000;
export const STEP_ASIDE = 300;

/** What a copy shows that a move or a restart carries: the tab, each tab's cursor, the find, the scope. */
const isShown = object({ tab: literal("procs", "ports"), procs: nullable(isString), ports: nullable(isString), query: isString, all: isBoolean });

export type Shown = Guarded<typeof isShown>;

/** The note a moving deck leaves for the one it opens. */
export const HANDOVER = sharedKey("procs.handover", nullable(object({ at: isNumber, shown: isShown })));

/** A pane's props as far as its slot. */
const isSlotted = object({}, { slot: isString });

/** The centered deck (nocturne's toggleProcs with centered; a copy: a mod can't import another's). */
export function deckSpec(tab: Shown["tab"]): OverlaySpec {
  return { mod: "procs", kind: "dialog", frame: "none", width: W, height: H, props: { tab } };
}

/** A new pane's slot. */
export const newSlot = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** This copy is a pane (or a tab's only pane): no overlay. */
export const inPane = (): boolean => deckProps().overlay === undefined;

/** This copy's pane, found by its slot. */
export function ownPane(): PaneInfo | null {
  const slot = deckProps().slot;

  if (!inPane() || !slot) return null;

  return panes().find((p) => p.mod === "procs" && isSlotted(p.props) && p.props.slot === slot) ?? null;
}

/** The deck's window, open (its fresh note): its overlay id. */
export function openWindow(): string | null {
  const d = readShared(shared, DECK, null);

  return d && Date.now() - d.beat < 6000 ? d.id : null;
}

/** procs.<command> reaches every copy: one acts. The window while one is open; else the pane
 *  with the keyboard; a pane that can't find itself (no slot) acts as before. */
export function actsOnCommands(): boolean {
  const open = openWindow();

  if (!inPane()) return !open || open === deckProps().overlay;

  if (open) return false;

  const me = ownPane();

  return me ? me.focused || focused()?.pane === me.pane : true;
}

/** What a copy shows now. */
export function shownOf(v: ProcsDeck): Shown {
  return { tab: v.tab, procs: v.cur.procs.key, ports: v.cur.ports.key, query: v.query, all: v.all };
}

/** Puts back what a copy showed. */
function putBack(v: ProcsDeck, s: Shown): void {
  v.tab = s.tab;
  v.cur.procs.key = s.procs;
  v.cur.ports.key = s.ports;
  v.query = s.query;
  v.all = s.all;
}

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage when the runtime has it (tests and stock Herdr may not). */
function store(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** A pane keeps what it shows (per slot), for the next start. */
export function saveCopy(v: ProcsDeck): void {
  if (!inPane() || !deckProps().slot) return;

  try {
    store()?.setItem("shown", JSON.stringify(shownOf(v)));
  } catch {
    // Not kept: the next start shows the processes.
  }
}

/** At init: a move's fresh note, else (a pane) what this pane showed before a restart. */
export function takeShown(v: ProcsDeck): void {
  const note = readShared(shared, HANDOVER, null);

  if (note && Date.now() - note.at < HANDOVER_FRESH) {
    writeShared(setShared, HANDOVER, null);
    putBack(v, note.shown);

    return;
  }

  if (!inPane() || !deckProps().slot) return;

  let text: string | null = null;

  try {
    text = store()?.getItem("shown") ?? null;
  } catch {
    // None kept.
  }

  const own = text ? parseJson(text, isShown) : undefined;

  if (own) putBack(v, own);
}

function handOver(v: ProcsDeck): void {
  writeShared(setShared, HANDOVER, { at: Date.now(), shown: shownOf(v) });
}

/** ◧ / ctrl-t over the tab: the deck in a pane beside the focused pane; the overlay steps aside. */
export function toPane(v: ProcsDeck, cx: Context): void {
  const id = deckProps().overlay;

  if (!id) return;

  handOver(v);

  const f = focused();
  const props = { slot: newSlot(), tab: v.tab };

  run("pane.split", f?.pane ? { direction: "auto", pane: f.pane, mod: "procs", props } : { direction: "auto", mod: "procs", props });
  cx.timer.after(STEP_ASIDE, () => closeOverlay(id));
}

/** ⧉ / ctrl-t in a pane: the deck centered over the tab (an open one gives way); the pane closes. */
export function toWindow(v: ProcsDeck, cx: Context): void {
  if (!inPane()) return;

  handOver(v);

  const open = openWindow();

  if (open) closeOverlay(open);

  const id = openOverlay(deckSpec(v.tab));

  writeShared(setShared, DECK, { id, tab: v.tab, beat: Date.now() });

  const me = ownPane();

  cx.timer.after(STEP_ASIDE, () => run("pane.close", me ? { pane: me.pane } : {}));
}

/** ctrl-t: wherever the deck is, to the other place. */
export function move(v: ProcsDeck, cx: Context): void {
  if (inPane()) toWindow(v, cx);
  else toPane(v, cx);
}

/** q: the overlay closes; a pane closes too (esc, going to a terminal, opening a port leave a pane open). */
export function quit(v: ProcsDeck): void {
  if (!inPane()) {
    v.dismissDeck();

    return;
  }

  saveCopy(v);

  const me = ownPane();

  run("pane.close", me ? { pane: me.pane } : {});
}
