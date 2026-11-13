// The files pane's preview split, its geometry: which side it takes (the
// pane's shape), how big (a share of the room, clamped), the divider's drag,
// what's kept per slot, a folder's facts.

import { isBoolean, isNumber, object } from "./guard.ts";

/** How much wider than tall (or taller than wide) a pane is before its
 *  preview moves: near square it stays where it was, so it doesn't flip. */
export const SLACK = 1.2;

/** Where the preview is: at the pane's right, or at its bottom. */
export type Side = "right" | "bottom";

/** A pane's size (layout px). */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Where a pane `size` ({ width, height }, layout px) puts its preview:
 *  "right" when clearly wider than tall, "bottom" when clearly taller; in
 *  between where it `was` (first time: right if at least as wide). */
export function lookSide(size: Size, was: Side | null = null): Side {
  const { width: w, height: h } = size;

  if (w > h * SLACK) return "right";

  if (h > w * SLACK) return "bottom";

  return was ?? (w >= h ? "right" : "bottom");
}

/** The toolbar and the filter line above the split (px). */
export const LOOK_TOP = 34 + 26;

/** The divider's grab area (px); its line is 1 px in the middle. */
export const DIVIDER = 5;

/** What each part keeps at least (px along the split), by side. */
export const LOOK_MIN = { bottom: { tree: 110, look: 96 }, right: { tree: 150, look: 160 } } as const satisfies { readonly [S in Side]: { readonly tree: number; readonly look: number } };

/** A new pane's preview share, and one < / > step. */
export const LOOK_SHARE = 0.5;

export const LOOK_STEP = 0.06;

/** The room the split shares along `side`: the pane's width, or its height under the header. */
export const lookRoom = (size: Size, side: Side): number => (side === "right" ? size.width : size.height - LOOK_TOP) - DIVIDER;

/** `share` kept so both parts get their least; null: the room can't hold both. */
export function clampShare(size: Size, side: Side, share: number): number | null {
  const room = lookRoom(size, side);
  const min = LOOK_MIN[side];

  if (room < min.tree + min.look) return null;

  const f = Number.isFinite(share) ? share : LOOK_SHARE;

  return Math.max(min.look / room, Math.min((room - min.tree) / room, f));
}

/** The preview's size (px along `side`) for its `share`; null: no room for it. */
export function lookSize(size: Size, side: Side, share: number): number | null {
  const f = clampShare(size, side, share);

  return f === null ? null : Math.round(lookRoom(size, side) * f);
}

/** A point in the pane (layout px). */
export interface At {
  readonly x: number;
  readonly y: number;
}

/** The share a divider dragged to `at` ({ x, y } in the pane, layout px) gives. */
export function dragShare(size: Size, side: Side, at: At): number | null {
  const room = lookRoom(size, side);
  const look = side === "right" ? size.width - at.x - DIVIDER / 2 : size.height - at.y - DIVIDER / 2;

  return clampShare(size, side, look / room);
}

/** A pane's preview split, kept in shared state by slot: on, and its share at each side. */
export interface LookState {
  readonly on: boolean;
  readonly right: number;
  readonly bottom: number;
}

/** An entry of shared `file-tree.look` (an older one may lack a field: the default fills it). */
export const isLookEntry = object({}, { on: isBoolean, right: isNumber, bottom: isNumber });

/** Each pane's preview, as kept in shared state by slot: { on, right, bottom } (shares). */
export const newLook = (): LookState => ({ on: false, right: LOOK_SHARE, bottom: LOOK_SHARE });

/** An entry of a folder: its name, a folder or not. */
export interface Entry {
  readonly name: string;
  readonly dir: boolean;
}

/** A folder's summary in the preview: "3 folders · 12 files". */
export function folderFacts(entries: readonly Entry[]): string {
  const dirs = entries.filter((e) => e.dir).length;
  const files = entries.length - dirs;
  const n = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;

  return entries.length ? `${n(dirs, "folder", "folders")} · ${n(files, "file", "files")}` : "empty";
}
