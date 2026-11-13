// Where this copy lives: the floating window (props.overlay) or a pane of a
// tab (no overlay), and moving between the two (ctrl-t, the header's ◧ / ⧉,
// git.to-pane / git.to-window). docs/mods-in-panes.md is the pattern every
// window mod follows.
//
// A pane opened as the whole window has props { slot, folder, on? }: slot is
// unique, so the pane finds itself in panes() and keeps what it shows in
// localStorage (per mod and props: per slot), which brings it back after a
// restart. A move hands over through the folder's kept state (git.state)
// and a one-shot note, shared(HANDOVER), the new copy takes within 5 s.

import { panes, focused, run, openOverlay, closeOverlay, shared, setShared } from "herdr";
import type { OverlaySpec, PaneInfo } from "herdr";
import type { Guarded } from "./guard.ts";
import { isNumber, isString, literal, nullable, object, parseJson, readShared, sharedKey, writeShared } from "./guard.ts";
import { isPanel, isMode, isGitProps, WINDOW_KEY } from "./state.ts";
import type { default as GitView } from "./main.ts";

/** What a moved copy opens with: its folder, machine, and (a pane) slot. */
export type PlaceProps = {
  readonly folder: string | null;
  readonly on?: string;
  readonly slot?: string;
};

/** The window as nocturne's git.ts opens it (a copy: a mod can't import another's). */
export function windowSpec(props: PlaceProps): OverlaySpec {
  return { mod: "git", kind: "window", key: "git", frame: "none", scrim: true, width: 0.88, height: 0.88, resizable: { min: [420, 300] }, props };
}

/** How long a handover note waits for the new copy, and how long the old copy stays after a move
 *  (closed in the same turn, the new copy's first tasks were cancelled with it). */
export const HANDOVER_FRESH = 5000;
export const STEP_ASIDE = 300;

/** A record of numbers (the lists' selections and scrolls, by context). */
const isNumbers = (x: unknown): x is Readonly<Record<string, number>> =>
  typeof x === "object" && x !== null && !Array.isArray(x) && Object.values(x).every((n) => isNumber(n));

/** What one copy shows that the folder's kept state doesn't hold. */
export const isCopy = object({}, {
  panel: isPanel,
  tabOf: object({}, { files: literal("files", "review", "worktrees"), branches: literal("branches", "remotes", "tags"), commits: literal("commits", "reflog") }),
  mode: isMode,
  focus: literal("side", "main"),
  sel: isNumbers,
  top: isNumbers,
});

export type Copy = Guarded<typeof isCopy>;

/** The note a moving copy leaves for the one it opens. */
export const HANDOVER = sharedKey("git.handover", nullable(object({ at: isNumber, folder: nullable(isString), copy: isCopy })));

/** A new pane's slot. */
export const newSlot = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** This copy is a pane (or a tab's only pane): no overlay. */
export const inPane = (v: GitView) => v.overlay === null;

/** This copy can move: the window, or a pane showing the whole window (not a ctrl-p diff). */
export const movable = (v: GitView) => !v.show && !v.backTo;

/** This copy's pane, found by its slot (a whole-window pane) or paneId (a ctrl-p pane). */
export function ownPane(v: GitView): PaneInfo | null {
  if (!inPane(v)) return null;

  const mine = (p: PaneInfo) => {
    if (p.mod !== "git" || !isGitProps(p.props)) return false;

    return v.slot ? p.props.slot === v.slot : v.paneId ? p.props.paneId === v.paneId : false;
  };

  return panes().find(mine) ?? null;
}

/** keys.json's git.<action> reach every copy: one acts. The window when one is open; else a
 *  pane with the keyboard; a pane that can't find itself (an old one, no slot) acts as before. */
export function actsOnCommands(v: GitView): boolean {
  const w = readShared(shared, WINDOW_KEY, null);
  const windowOpen = Boolean(w?.id && Date.now() - (w.beat ?? 0) < 10000);

  if (!inPane(v)) return !windowOpen || w?.id === v.overlay;

  if (windowOpen) return false;

  const me = ownPane(v);

  return me ? me.focused || focused()?.pane === me.pane : true;
}

/** What this copy shows now, for the handover and its localStorage. */
export function copyOf(v: GitView): Copy {
  return { panel: v.panel, tabOf: { ...v.tabOf }, mode: v.mode, focus: v.focus, sel: { ...v.sel }, top: { ...v.top } };
}

/** Takes a copy's state over (init, after the props and the folder's kept state). */
export function applyCopy(v: GitView, c: Copy): void {
  if (c.panel) v.panel = c.panel;

  if (c.tabOf) v.tabOf = { files: c.tabOf.files ?? v.tabOf.files, branches: c.tabOf.branches ?? v.tabOf.branches, commits: c.tabOf.commits ?? v.tabOf.commits };

  if (c.mode) v.mode = c.mode;

  if (c.focus) v.focus = c.focus;

  if (c.sel) v.sel = { ...c.sel };

  if (c.top) v.top = { ...c.top };
}

/** What place.ts uses of localStorage. */
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

const COPY = "copy";

/** A pane keeps what it shows (per slot), for the next start. */
export function saveCopy(v: GitView): void {
  if (!inPane(v) || !v.slot || v.show) return;

  try { store()?.setItem(COPY, JSON.stringify(copyOf(v))); } catch { /* not kept */ }
}

/** At init: a fresh handover for this folder (a move), else a pane's own kept copy (a restart). */
export function takeCopy(v: GitView): void {
  if (v.show || v.wtIntent) return;

  const note = readShared(shared, HANDOVER, null);

  if (note && Date.now() - note.at < HANDOVER_FRESH && note.folder === v.folder) {
    writeShared(setShared, HANDOVER, null);
    applyCopy(v, note.copy);

    return;
  }

  if (!inPane(v) || !v.slot) return;

  let text: string | null = null;

  try { text = store()?.getItem(COPY) ?? null; } catch { /* none */ }

  const kept = text ? parseJson(text, isCopy) : undefined;

  if (kept) applyCopy(v, kept);
}

/** Leaves the handover note and the folder's kept state for the copy about to open. */
function handOver(v: GitView): void {
  v.saveState();
  writeShared(setShared, HANDOVER, { at: Date.now(), folder: v.folder, copy: copyOf(v) });
}

/** The props a copy of this folder opens with (slot: a pane's). */
function placeProps(v: GitView, slot: string | null): PlaceProps {
  const base: PlaceProps = v.on ? { folder: v.folder, on: v.on } : { folder: v.folder };

  return slot ? { ...base, slot } : base;
}

/** ◧ / ctrl-t in the window: the same view in a pane beside the focused pane under it; the window steps aside. */
export function toPane(v: GitView): void {
  if (inPane(v) || !movable(v)) return;

  handOver(v);

  const f = focused();
  const props = placeProps(v, newSlot());

  run("pane.split", f?.pane ? { direction: "auto", pane: f.pane, mod: "git", props } : { direction: "auto", mod: "git", props });

  const id = v.overlay;

  if (id) v.later(() => closeOverlay(id), STEP_ASIDE);
}

/** ⧉ / ctrl-t in a pane: the same view as the floating window (an open one gives way); the pane closes. */
export function toWindow(v: GitView): void {
  if (!inPane(v) || !movable(v)) return;

  handOver(v);

  const open = readShared(shared, WINDOW_KEY, null);

  if (open?.id) closeOverlay(open.id);

  const id = openOverlay(windowSpec(placeProps(v, null)));

  writeShared(setShared, WINDOW_KEY, { id, beat: Date.now(), folder: v.folder });

  const me = ownPane(v);

  v.later(() => run("pane.close", me ? { pane: me.pane } : {}), STEP_ASIDE);
}

/** ctrl-t: wherever this copy is, to the other place. */
export function move(v: GitView): void {
  if (inPane(v)) toWindow(v);
  else toPane(v);
}
