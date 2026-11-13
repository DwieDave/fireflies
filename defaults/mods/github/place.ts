// Where this copy lives: the floating window (props.overlay) or a pane of a
// tab (no overlay), and moving between the two (ctrl-t, the header's ◧ / ⧉,
// github.to-pane / github.to-window). docs/mods-in-panes.md is the pattern
// every window mod follows.
//
// A pane has props { slot, folder, on? }: slot is unique, so the pane finds
// itself in panes() and keeps what it shows in localStorage (per mod and
// props: per slot), which brings it back after a restart. A move hands over
// through shared(STATE), what the window keeps (its folder, tab and each
// tab's selection, filter and sizes), saved just before.

import { panes, focused, run, openOverlay, closeOverlay, shared, setShared } from "herdr";
import type { OverlaySpec, PaneInfo } from "herdr";
import type { Context } from "gpui-kit";
import type { Guarded } from "./guard.ts";
import { isNumber, isString, literal, nullable, object, parseJson, readShared, sharedKey, writeShared } from "./guard.ts";
import { isPrsKept } from "./prs.ts";
import { isActionsKept } from "./actions.ts";
import { isProjectsKept } from "./projects.ts";
import type { default as GitHub } from "./main.ts";

/** What the window keeps in shared state (its folder, tab and each tab's own), so it comes back
 *  where it was (after git's review, say, or a move); a pane keeps the same in its localStorage. */
export const isKept = object({}, {
  // The tabs (window-chrome.ts isTabId: that file imports this one).
  folder: nullable(isString), tab: literal("prs", "actions", "projects"), prs: isPrsKept, actions: isActionsKept, projects: isProjectsKept,
});

export type Kept = Guarded<typeof isKept>;

export const STATE = sharedKey("github.state", isKept);

/** The open window, for the toggle (nocturne's sky): its overlay id and when it last said so. */
export const WINDOW_KEY = sharedKey("github.window", nullable(object({ id: isString, beat: isNumber })));

/** How long the old copy stays after a move (closed in the same turn, the new copy's first tasks went with it). */
export const STEP_ASIDE = 300;

/** What a moved copy opens with: its folder, machine, and (a pane) slot. */
type PlaceProps = { readonly folder: string | null; readonly on?: string; readonly slot?: string };

/** The window as nocturne's github.ts opens it (a copy: a mod can't import another's). */
export function windowSpec(props: PlaceProps): OverlaySpec {
  return { mod: "github", kind: "window", key: "github", frame: "none", scrim: true, width: 0.85, height: 0.85, resizable: { min: [520, 360] }, props };
}

/** A new pane's slot. */
export const newSlot = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** This copy is a pane (or a tab's only pane): no overlay. */
export const inPane = (v: GitHub) => v.overlay === null;

/** A pane's props as far as its slot. */
const isSlotted = object({}, { slot: isString });

/** This copy's pane, found by its slot. */
export function ownPane(v: GitHub): PaneInfo | null {
  const slot = v.slot;

  if (!inPane(v) || !slot) return null;

  return panes().find((p) => p.mod === "github" && isSlotted(p.props) && p.props.slot === slot) ?? null;
}

/** The window is open (its fresh note), and its id. */
function openWindow(): string | null {
  const w = readShared(shared, WINDOW_KEY, null);

  return w && Date.now() - w.beat < 10000 ? w.id : null;
}

/** keys.json's github.<name> reach every copy: one acts. The window while one is open; else
 *  the pane with the keyboard; a pane that can't find itself (no slot) acts as before. */
export function actsOnCommands(v: GitHub): boolean {
  const open = openWindow();

  if (!inPane(v)) return !open || open === v.overlay;

  if (open) return false;

  const me = ownPane(v);

  return me ? me.focused || focused()?.pane === me.pane : true;
}

/** What links and "beside" open next to: this pane. */
export const besidePane = (v: GitHub): string | null => ownPane(v)?.pane ?? null;

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
export function saveCopy(v: GitHub, kept: Kept): void {
  if (!inPane(v) || !v.slot) return;

  try { store()?.setItem("kept", JSON.stringify(kept)); } catch { /* not kept */ }
}

/** What this copy starts on: a pane's own (a restart), else what the window kept. */
export function keptFor(v: GitHub): Kept {
  if (inPane(v) && v.slot) {
    let text: string | null = null;

    try { text = store()?.getItem("kept") ?? null; } catch { /* none */ }

    const own = text ? parseJson(text, isKept) : undefined;

    if (own && own.folder === v.folder) return own;
  }

  return readShared(shared, STATE, {});
}

/** The props a copy of this folder opens with (slot: a pane's). */
function placeProps(v: GitHub, slot: string | null): PlaceProps {
  const base: PlaceProps = v.on ? { folder: v.folder, on: v.on } : { folder: v.folder };

  return slot ? { ...base, slot } : base;
}

/** ◧ / ctrl-t in the window: the same view in a pane beside the focused pane under it; the window steps aside. */
export function toPane(v: GitHub, cx: Context): void {
  const id = v.overlay;

  if (!id) return;

  v.save();

  const f = focused();
  const props = placeProps(v, newSlot());

  run("pane.split", f?.pane ? { direction: "auto", pane: f.pane, mod: "github", props } : { direction: "auto", mod: "github", props });
  cx.timer.after(STEP_ASIDE, () => closeOverlay(id));
}

/** ⧉ / ctrl-t in a pane: the same view as the floating window (an open one gives way); the pane closes. */
export function toWindow(v: GitHub, cx: Context): void {
  if (!inPane(v)) return;

  v.save();

  const open = openWindow();

  if (open) closeOverlay(open);

  const id = openOverlay(windowSpec(placeProps(v, null)));

  writeShared(setShared, WINDOW_KEY, { id, beat: Date.now() });

  const me = ownPane(v);

  cx.timer.after(STEP_ASIDE, () => run("pane.close", me ? { pane: me.pane } : {}));
}

/** ctrl-t: wherever this copy is, to the other place. */
export function move(v: GitHub, cx: Context): void {
  if (inPane(v)) toWindow(v, cx);
  else toPane(v, cx);
}

/** esc or q at the top level: a window closes; in a pane esc stays and q closes the pane. */
export function leave(v: GitHub, key: string): void {
  if (!inPane(v)) {
    v.closeWindow();

    return;
  }

  if (key !== "q") return;

  const me = ownPane(v);

  run("pane.close", me ? { pane: me.pane } : {});
}
