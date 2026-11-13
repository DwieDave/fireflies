// Where the deck lives: over the tab (props.overlay: the popover under ▶ or
// the centered dialog) or in a pane of a tab (no overlay), and moving between
// the two (ctrl-t, the head's ◧ / ⧉, scripts.to-pane / scripts.to-window).
// docs/mods-in-panes.md is the pattern every window mod follows.
//
// A pane has props { slot, folder, on? }: slot is unique, so the pane finds
// itself in panes(). It stays when a script runs from it (the deck closes);
// esc never closes it, q does. A move hands the filter and the cursor over in
// a one-shot note, shared(HANDOVER), the new copy takes within 5 s.

import { panes, focused, run, openOverlay, closeOverlay, shared, setShared, settings } from "herdr";
import type { OverlaySpec, PaneInfo } from "herdr";
import type { Context } from "gpui-kit";
import { isNumber, isString, nullable, object, readShared, sharedKey, writeShared } from "./guard.ts";
import { DECK, H } from "./state.ts";
import type { default as ScriptsDeck } from "./main.ts";

/** The deck as nocturne's scripts.ts opens it centered (a copy: a mod can't import another's). */
export const DECK_W = 420;

/** How long a handover waits for the new copy, and how long the old copy stays after a move. */
export const HANDOVER_FRESH = 5000;
export const STEP_ASIDE = 300;

/** The note a moving deck leaves for the one it opens. */
export const HANDOVER = sharedKey("scripts.handover", nullable(object({ at: isNumber, folder: nullable(isString), query: isString, cursor: isNumber })));

/** A pane's props as far as its slot. */
const isSlotted = object({}, { slot: isString });

/** What a moved copy opens with: its folder, machine, and (a pane) slot. */
type PlaceProps = { readonly folder: string | null; readonly on?: string; readonly slot?: string; readonly focus?: "pick" };

/** The centered deck (nocturne's toggleDeck with centered). */
export function deckSpec(props: PlaceProps): OverlaySpec {
  return { mod: "scripts", kind: "dialog", frame: "none", width: DECK_W, height: H, props };
}

/** A new pane's slot. */
export const newSlot = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** This copy is a pane: no overlay (the password bar is always an overlay). */
export const inPane = (v: ScriptsDeck) => v.overlay === null;

/** This copy's pane, found by its slot. */
export function ownPane(v: ScriptsDeck): PaneInfo | null {
  const slot = v.slot;

  if (!inPane(v) || !slot) return null;

  return panes().find((p) => p.mod === "scripts" && isSlotted(p.props) && p.props.slot === slot) ?? null;
}

/** A drawn size in the deck's px (the app's zoom taken out). */
export const unzoom = (px: number) => px / (settings().zoom || 1);

/** The deck's height: a pane's, else the overlay's fixed H. */
export const deckHeight = (v: ScriptsDeck) => (inPane(v) && v.height > 0 ? v.height : H);

/** At init: a fresh handover for this folder (a move) puts back the filter and the cursor. */
export function takeHandover(v: ScriptsDeck): void {
  const note = readShared(shared, HANDOVER, null);

  if (!note || Date.now() - note.at >= HANDOVER_FRESH || note.folder !== v.folder) return;

  writeShared(setShared, HANDOVER, null);
  v.query = note.query;
  v.cursor = note.cursor;
}

function handOver(v: ScriptsDeck): void {
  writeShared(setShared, HANDOVER, { at: Date.now(), folder: v.folder, query: v.query, cursor: v.cursor });
}

function placeProps(v: ScriptsDeck, slot: string | null): PlaceProps {
  const base: PlaceProps = v.on ? { folder: v.folder, on: v.on } : { folder: v.folder };

  return slot ? { ...base, slot } : { ...base, focus: "pick" };
}

/** ◧ / ctrl-t over the tab: the deck in a pane beside the focused pane; the overlay steps aside. */
export function toPane(v: ScriptsDeck, cx: Context): void {
  const id = v.overlay;

  if (!id) return;

  handOver(v);

  const f = focused();
  const props = placeProps(v, newSlot());

  run("pane.split", f?.pane ? { direction: "auto", pane: f.pane, mod: "scripts", props } : { direction: "auto", mod: "scripts", props });
  cx.timer.after(STEP_ASIDE, () => closeOverlay(id));
}

/** ⧉ / ctrl-t in a pane: the deck centered over the tab (an open one gives way); the pane closes. */
export function toWindow(v: ScriptsDeck, cx: Context): void {
  if (!inPane(v)) return;

  handOver(v);

  const open = readShared(shared, DECK, null);

  if (open) closeOverlay(open.id);

  const id = openOverlay(deckSpec(placeProps(v, null)));

  writeShared(setShared, DECK, { id, beat: Date.now() });

  const me = ownPane(v);

  cx.timer.after(STEP_ASIDE, () => run("pane.close", me ? { pane: me.pane } : {}));
}

/** ctrl-t: wherever the deck is, to the other place. */
export function move(v: ScriptsDeck, cx: Context): void {
  if (inPane(v)) toWindow(v, cx);
  else toPane(v, cx);
}

/** q: the overlay closes; a pane closes too (esc and running a script leave a pane open). */
export function quit(v: ScriptsDeck): void {
  if (!inPane(v)) {
    v.dismissDeck();

    return;
  }

  const me = ownPane(v);

  run("pane.close", me ? { pane: me.pane } : {});
}
