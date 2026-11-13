// The Databases view's dividers (dividers.ts) at its size: between the left
// column and the right one (`left`), Connections and Tables (`conns`), Tables
// and Structure (`struct`), the main view and the Log (`log`), a query's
// editor and its result (`editor`); each panel's edges for + / -; the sizes
// kept in shared state, one set for the window and one for panes.

import { shared, setShared } from "herdr";
import { isNumber, nullable, object, readShared, sharedKey, writeShared } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import type { Divider, Edge, Sizes } from "./dividers.ts";
import { GRAB } from "./dividers.ts";
import type { Place } from "./keys.ts";

/** Under this width the view is one column (the pattern's one break per mod). */
export const NARROW = 640;

/** The gaps between panels: side by side, and stacked (a stacked panel's title is cut into its top edge). */
export const GAP_X = 6;
export const GAP_Y = 14;

/** What each panel keeps at least (layout px). */
export const LEAST = { left: 200, right: 320, conns: 60, tables: 80, struct: 80, main: 160, log: 40, editor: 60, result: 80 } as const;

/** The line between a query's editor and its result (main-view.ts resultHead). */
export const RESULT_HEAD = 22;

const isSizesEntry = object({}, { left: isNumber, conns: isNumber, struct: isNumber, log: isNumber, editor: isNumber });

/** The dragged sizes, kept: the window's, and the panes' (one set for every pane). */
export const SIZES_KEY = sharedKey("databases.sizes", nullable(object({}, { window: isSizesEntry, pane: isSizesEntry })));

type SizesEntry = Guarded<typeof isSizesEntry>;

/** An entry put together field by field. */
type SizesDraft = { -readonly [K in keyof SizesEntry]: SizesEntry[K] };

/** The sizes kept for a window or a pane. */
export function keptSizes(window: boolean): SizesEntry {
  const all = readShared(shared, SIZES_KEY, null);

  return (window ? all?.window : all?.pane) ?? {};
}

/** The sizes kept again (the other kind's left as they are). */
export function keepSizes(window: boolean, sizes: Sizes): void {
  const all = readShared(shared, SIZES_KEY, null) ?? {};
  const entry: SizesDraft = {};

  for (const k of ["left", "conns", "struct", "log", "editor"] as const) {
    const n = sizes[k];

    if (n !== undefined) entry[k] = n;
  }

  writeShared(setShared, SIZES_KEY, window ? { ...all, window: entry } : { ...all, pane: entry });
}

/** The view's sizes the dividers are worked out from: the view, its body, a query's box. */
export interface Room {
  readonly width: number;
  readonly height: number;
  /** The body's inner height (under the top bar, over the key bar, inside its padding). */
  readonly inner: number;
  /** A query tab's box (its editor, its result line and its result), or null when none shows. */
  readonly query: number | null;
}

/** The wide view's dividers; `size` reads a divider's size now (kept, clamped). */
export interface Wide {
  readonly left: Divider;
  readonly conns: Divider;
  readonly struct: Divider;
  readonly log: Divider | null;
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Whether the right column has the Log under the main view. */
export const tallEnough = (room: Room): boolean => room.height > 520;

/** The wide view's dividers at `room`; `size` gives a divider's size now (the stacked ones share
 *  the column, so each one's most depends on the other's size). */
export function wideDividers(room: Room, size: (d: Divider) => number): Wide {
  const { width, inner } = room;
  const left: Divider = { key: "left", axis: "x", side: 1, min: LEAST.left, max: width - 12 - GAP_X - LEAST.right, start: Math.round(clamp(width * 0.3, 250, 400)) };
  const column = inner - 2 * GAP_Y - LEAST.tables;
  const conns: Divider = { key: "conns", axis: "y", side: 1, min: LEAST.conns, max: column - LEAST.struct, start: Math.round(clamp((room.height - 90) * 0.28, 110, 230)) };
  const struct: Divider = { key: "struct", axis: "y", side: -1, min: LEAST.struct, max: column - size(conns), start: Math.round(clamp((room.height - 90) * 0.36, 120, 300)) };
  const log: Divider | null = tallEnough(room) ? { key: "log", axis: "y", side: -1, min: LEAST.log, max: inner - GAP_Y - LEAST.main, start: 92 } : null;

  return { left, conns, struct, log };
}

/** A query tab's split: its editor's height over the divider, the result line and the result. */
export function editorDivider(box: number): Divider {
  const tall = box - RESULT_HEAD;

  return { key: "editor", axis: "y", side: 1, min: LEAST.editor, max: box - GRAB - RESULT_HEAD - LEAST.result, start: Math.round(clamp(tall * 0.38, 90, 280)) };
}

/** The edges + / - move for what has the keyboard: each divider around the focused panel, and
 *  +1 where its size is that panel's (the left column, Connections, Structure, the Log), -1 where
 *  growing the panel shrinks it. Narrow, only a query's split is there to move. */
export function edgesOf(place: Place, room: Room, size: (d: Divider) => number): Edge[] {
  const editor = room.query !== null ? editorDivider(room.query) : null;
  const split: Edge[] = editor && (place === "results" || place === "editor") ? [{ divider: editor, sign: place === "editor" ? 1 : -1 }] : [];

  if (room.width < NARROW) return split;

  const w = wideDividers(room, size);
  const log = w.log ? [w.log] : [];

  switch (place) {
    case "conns": return [{ divider: w.left, sign: 1 }, { divider: w.conns, sign: 1 }];
    case "tables": return [{ divider: w.left, sign: 1 }, { divider: w.conns, sign: -1 }, { divider: w.struct, sign: -1 }];
    case "structure": return [{ divider: w.left, sign: 1 }, { divider: w.struct, sign: 1 }];
    case "log": return [{ divider: w.left, sign: -1 }, ...log.map((d): Edge => ({ divider: d, sign: 1 }))];
    case "rows":
    case "results":
    case "editor": return [{ divider: w.left, sign: -1 }, ...log.map((d): Edge => ({ divider: d, sign: -1 })), ...split];
    case "window": return [];
  }
}
