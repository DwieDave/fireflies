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

import { Array as Arr, Clock, Option, Random, Schema, String as Str } from "effect";
import { panes, focused, run, openOverlay, closeOverlay, shared, setShared } from "herdr";
import type { OverlaySpec, PaneInfo } from "herdr";
import { readShared, sharedKey, writeShared } from "@fireflies/kit";
import { PanelSchema, ModeSchema, TabOfSchema, WINDOW_KEY, isGitProps } from "./state.ts";
import { runtime } from "./fx.ts";
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
const NumbersSchema = Schema.Record(Schema.String, Schema.Finite);

/** What one copy shows that the folder's kept state doesn't hold. */
export const CopySchema = Schema.Struct({
  panel: Schema.optionalKey(PanelSchema),
  tabOf: Schema.optionalKey(TabOfSchema),
  mode: Schema.optionalKey(ModeSchema),
  focus: Schema.optionalKey(Schema.Literals(["side", "main"])),
  sel: Schema.optionalKey(NumbersSchema),
  top: Schema.optionalKey(NumbersSchema),
});

export type Copy = typeof CopySchema.Type;

/** The note a moving copy leaves for the one it opens. */
export const HANDOVER = sharedKey("git.handover", Schema.NullOr(Schema.Struct({ at: Schema.Finite, folder: Schema.NullOr(Schema.String), copy: CopySchema })));

/** Now, in ms: the runtime's clock (one read). */
export const nowMs = (): number => runtime.now(Clock.currentTimeMillis);

/** A short random id: the clock's ms and a random part, base 36 (a pane's slot, a ctrl-p pane's id). */
export const randomId = (n: number): string => nowMs().toString(36) + Str.padStart(n, "0")(runtime.now(Random.nextIntBetween(0, 36 ** n)).toString(36));

/** A new pane's slot. */
export const newSlot = (): string => randomId(4);

/** This copy is a pane (or a tab's only pane): no overlay. */
export const inPane = (v: GitView): boolean => v.overlay === null;

/** This copy can move: the window, or a pane showing the whole window (not a ctrl-p diff). */
export const movable = (v: GitView): boolean => v.show === null && v.backTo === null;

/** This copy's pane, found by its slot (a whole-window pane) or paneId (a ctrl-p pane). */
export function ownPane(v: GitView): PaneInfo | null {
  if (!inPane(v)) return null;

  const mine = (p: PaneInfo) => {
    if (p.mod !== "git" || !isGitProps(p.props)) return false;

    if (v.slot !== null) return p.props.slot === v.slot;

    return v.paneId !== null && p.props.paneId === v.paneId;
  };

  return Option.getOrNull(Arr.findFirst(panes(), mine));
}

/** keys.json's git.<action> reach every copy: one acts. The window when one is open; else a
 *  pane with the keyboard; a pane that can't find itself (an old one, no slot) acts as before. */
export function actsOnCommands(v: GitView): boolean {
  const w = readShared(shared, WINDOW_KEY, null);
  const windowOpen = w !== null && w.id !== "" && nowMs() - (w.beat ?? 0) < 10000;

  if (!inPane(v)) return !windowOpen || w.id === v.overlay;

  if (windowOpen) return false;

  const me = ownPane(v);

  return me === null || me.focused || focused()?.pane === me.pane;
}

/** What this copy shows now, for the handover and its localStorage. */
export function copyOf(v: GitView): Copy {
  return { panel: v.panel, tabOf: { ...v.tabOf }, mode: v.mode, focus: v.focus, sel: { ...v.sel }, top: { ...v.top } };
}

/** Takes a copy's state over (init, after the props and the folder's kept state). */
export function applyCopy(v: GitView, c: Copy): void {
  const { panel, tabOf, mode, focus, sel, top } = c;

  if (panel !== undefined) v.panel = panel;

  if (tabOf !== undefined) v.tabOf = { files: tabOf.files ?? v.tabOf.files, branches: tabOf.branches ?? v.tabOf.branches, commits: tabOf.commits ?? v.tabOf.commits };

  if (mode !== undefined) v.mode = mode;

  if (focus !== undefined) v.focus = focus;

  if (sel !== undefined) v.sel = { ...sel };

  if (top !== undefined) v.top = { ...top };
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

const copyJson = Schema.fromJsonString(CopySchema);
const decodeCopy = Schema.decodeUnknownOption(copyJson);
const encodeCopy = Schema.encodeOption(copyJson);

/** A pane keeps what it shows (per slot), for the next start. */
export function saveCopy(v: GitView): void {
  if (!inPane(v) || v.slot === null || v.show !== null) return;

  // localStorage can refuse (full, a private window): the pane then starts as the folder's kept state says.
  Option.map(encodeCopy(copyOf(v)), (text) => { try { store()?.setItem(COPY, text); } catch { /* not kept, as said */ } });
}

/** At init: a fresh handover for this folder (a move), else a pane's own kept copy (a restart). */
export function takeCopy(v: GitView): void {
  if (v.show !== null || v.wtIntent !== null) return;

  const note = readShared(shared, HANDOVER, null);

  if (note !== null && nowMs() - note.at < HANDOVER_FRESH && note.folder === v.folder) {
    writeShared(setShared, HANDOVER, null);
    applyCopy(v, note.copy);

    return;
  }

  if (!inPane(v) || v.slot === null) return;

  let text: string | null = null;

  // localStorage that refuses a read: nothing kept.
  try { text = store()?.getItem(COPY) ?? null; } catch { /* none, as said */ }

  if (text !== null) Option.map(decodeCopy(text), (kept) => applyCopy(v, kept));
}

/** Leaves the handover note and the folder's kept state for the copy about to open. */
function handOver(v: GitView): void {
  v.saveState();
  writeShared(setShared, HANDOVER, { at: nowMs(), folder: v.folder, copy: copyOf(v) });
}

/** The props a copy of this folder opens with (slot: a pane's). */
function placeProps(v: GitView, slot: string | null): PlaceProps {
  const base: PlaceProps = v.on === null ? { folder: v.folder } : { folder: v.folder, on: v.on };

  return slot === null ? base : { ...base, slot };
}

/** ◧ / ctrl-t in the window: the same view in a pane beside the focused pane under it; the window steps aside. */
export function toPane(v: GitView): void {
  if (inPane(v) || !movable(v)) return;

  handOver(v);

  const f = focused();
  const props = placeProps(v, newSlot());

  const pane = f?.pane ?? null;

  run("pane.split", pane === null ? { direction: "auto", mod: "git", props } : { direction: "auto", pane, mod: "git", props });

  const id = v.overlay;

  if (id !== null) v.later(() => closeOverlay(id), STEP_ASIDE);
}

/** ⧉ / ctrl-t in a pane: the same view as the floating window (an open one gives way); the pane closes. */
export function toWindow(v: GitView): void {
  if (!inPane(v) || !movable(v)) return;

  handOver(v);

  const open = readShared(shared, WINDOW_KEY, null);

  if (open !== null && open.id !== "") closeOverlay(open.id);

  const id = openOverlay(windowSpec(placeProps(v, null)));

  writeShared(setShared, WINDOW_KEY, { id, beat: nowMs(), folder: v.folder });

  const me = ownPane(v);

  v.later(() => run("pane.close", me === null ? {} : { pane: me.pane }), STEP_ASIDE);
}

/** ctrl-t: wherever this copy is, to the other place. */
export function move(v: GitView): void {
  if (inPane(v)) toWindow(v);
  else toPane(v);
}
