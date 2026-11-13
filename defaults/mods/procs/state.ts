// The process deck's state: its sizes (the window, the rows, the detail
// block, the graphs), its tabs and props, the shared records (the open deck,
// the ports count), the keys ? lists, and the shapes the deck holds (the
// cursors, scrolls, the question, a note, a drag, the histories).

import type { Color } from "gpui-kit";
import { home, props } from "herdr";
import type { Guarded } from "./guard.ts";
import { isNumber, isString, literal, nullable, object, sharedKey } from "./guard.ts";
import type { KeyRow } from "./keyhelp.ts";
import type { Index, Port, ProcNode, Row } from "./logic.ts";
import { KEEP } from "./sys.ts";

export const ART = "mods/nocturne/art";
export const CONTEXT = "NocturneProcsDeck";
export const ESCAPE = "nocturne_procs_escape";

export const REFRESH = 2000;

export const GRACE = 2000;

export const SYSTEM_PACE = "a reading every second";

export const W = 480;
export const H = 560;

export const ROW = 24;

export const PROW = 30;

export const HEAD = 36;
export const COLS = 18;
export const FOOT = 26;
export const IND = 14;
export const CONFIRM = 76;

// The selected process's detail block, under its row: air, the command (1 to 3 lines), air, its
// facts and its buttons, its live readings, air, a dithered rule where its ground ends, air.
export const D_TOP = 9;
export const D_GAP = 9;
export const D_LINE = 16;
export const D_LINES_GAP = 4;
export const D_FOOT = 10;
export const D_AFTER = 7;
export const D_LEFT = 26;
export const D_RIGHT = 12;

// About how wide a character of the 11 px mono is, to guess a command's lines before it's drawn.
export const CHAR_W = 7;

export const LIST_H = H - 2 - HEAD - COLS - FOOT;

// The system tab: five graphs, KEEP bars each, the newest at the right.
export const GRAPH_W = W - 2 - 24;
export const GRAPH_H = 48;
export const SLOT = Math.floor(GRAPH_W / KEEP);
export const BAR = SLOT - 2;
export const SPARK = 30;

export const PORTS_H = H - 2 - HEAD - FOOT;

/** The deck's tabs. */
export type Tab = "procs" | "ports" | "system";

/** The tabs with a list that scrolls. */
export type ListTab = "procs" | "ports";

export const TABS: readonly Tab[] = ["procs", "ports", "system"];

export const isTab = literal("procs", "ports", "system");

/** What the deck is opened with (nocturne/procs.ts; `openOverlay` adds `overlay`). */
export const isDeckProps = object({}, { tab: isString, overlay: isString });

export type DeckProps = Guarded<typeof isDeckProps>;

export const deckProps = (): DeckProps => {
  const p = props();

  return isDeckProps(p) ? p : {};
};

// The strip's note that the deck is open, and which tab (../nocturne/procs.ts DECK): the deck
// renews it each refresh; the strip adds `want`, a tab it asks for (nocturne.ports).
export const DECK = sharedKey("procs.deck", nullable(object({ id: isString, tab: isString, beat: isNumber }, { want: isString })));

// The ports in this app's terminals, for the strip's count (../nocturne/procs.ts COUNT).
export const COUNT = sharedKey("procs.count", nullable(object({ at: isNumber, n: isNumber })));

// The scrollbar's hit strip along a list's right edge, and its thumb's least height.
export const BAR_HIT = 8;
export const THUMB_MIN = 16;

// The detail block's command: lines of CMD_LINE px, at most CMD_SHOWN shown (the wheel scrolls the rest).
export const CMD_LINE = 15;
export const CMD_SHOWN = 3;

export function short(folder: string | null): string {
  if (!folder) return "";

  const h = home();

  return folder === h ? "~" : folder.startsWith(`${h}/`) ? `~${folder.slice(h.length)}` : folder;
}

/** What ? lists: every key onKey() takes. */
export const deckKeys = (): KeyRow[] => [
  ["j k ↑ ↓", "move"], ["g G home end", "first / last"], ["pgup pgdn", "a page"],
  ["h ←", "fold, or up to the parent"], ["l →", "unfold, or into the first child"], ["space", "fold or unfold"],
  ["enter", "a group: fold · a process: show its terminal · a port: open it"],
  ["tab 1 2 3", "processes / ports / system"], ["a", "this app's terminals / all of yours"],
  ["x", "end it (TERM, asks first)"], ["X", "end it and everything under it"], ["K", "kill -9 what held on"],
  ["o", "open the port in a web pane"], ["c", "copy the address · a process: its command line"],
  ["r", "read again now"], ["/", "find (esc clears, again: back)"], ["q esc", "close"], ["?", "keys"],
];

/** A port as the ports tab lists it: where its process runs, and whether it may be ended. */
export interface PortItem extends Port {
  readonly key: string;
  readonly term: string | null;
  readonly where: string | null;
  readonly guard: string | null;
}

/** A row of the shown list: the processes tab's, or the ports tab's. */
export type Item = Row | PortItem;

/** A process row (its node a process). */
export type ProcRow = Row & { readonly node: ProcNode };

export const isProcRow = (r: Row): r is ProcRow => r.node.kind === "proc";

/** The cursor of a tab: on its row's key, else at its index. */
export interface Cursor {
  key: string | null;
  at: number;
}

/** Each tab's cursor. */
export interface Cursors {
  procs: Cursor;
  ports: Cursor;
  system: Cursor;
}

/** How far each list is scrolled (layout px). */
export interface Scrolls {
  procs: number;
  ports: number;
}

/** The detail block's command: its process, its scroll, its drawn height. */
export interface Command {
  pid: number | null;
  y: number;
  h: number;
}

/** Ending a process, asked under its row: asked, TERM sent, or some held on (`left`). */
export interface Ask {
  readonly pids: readonly number[];
  readonly key: string;
  readonly tab: Tab;
  readonly tree: boolean;
  phase: "ask" | "ending" | "held";
  left: readonly number[];
  readonly name: string;
  readonly pid: number;
  readonly ports: readonly number[];
}

/** A line in the foot for a while. */
export interface Note {
  readonly text: string;
  readonly tone: "done" | "dim";
  readonly until: number;
}

/** The scrollbar's drag: its list, where the pointer took it, the offset then. */
export interface Drag {
  readonly tab: ListTab;
  readonly at: number;
  readonly from: number;
  readonly ratio: number;
  readonly room: number;
}

/** A bar of a graph, in the graph's px. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** How a graph draws: a second series under a midline, its color, what to say instead. */
export interface GraphOptions {
  readonly down?: readonly (number | null)[] | null;
  readonly color2?: Color | null;
  readonly none?: string | null;
}

/** The system graphs' histories. */
export interface History {
  cpu: (number | null)[];
  gpu: (number | null)[];
  mem: (number | null)[];
  disk: (number | null)[];
  rx: (number | null)[];
  tx: (number | null)[];
}

/** A process's own readings since the deck opened. */
export interface Own {
  readonly cpu: readonly number[];
  readonly rss: readonly number[];
}

export const NO_PIDS: Index["byPid"] = new Map();

/** Typed text without control characters (enter, tab, delete come as keys). */
export const printable = (ch: string): boolean => Array.from(ch).every((c) => {
  const code = c.codePointAt(0) ?? 0;

  return code >= 0x20 && code !== 0x7f;
});
