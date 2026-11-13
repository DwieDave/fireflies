// The sky's plan (sky.ts and its parts draw it): its sizes and timings, the
// clock, the lanes fireflies fly in and how far each may stray, the jar's plan
// and the shelf's height, the moon's phase.

import type { Color, Context, MouseButtonEvent } from "gpui-kit";
import { settings, window as appWindow } from "herdr";
import type { AgentInfo, PaneInfo, Status } from "herdr";
import * as herdrAll from "herdr";
import { isNumber, sharedKey } from "./guard.ts";
import { GLOW_SQUARE } from "./kit.ts";
import type { JarItem } from "./pins.ts";
import type { NavActs } from "./nav.ts";
import type { GlowProps } from "./glow.ts";

export const stop = (_e: MouseButtonEvent, cx: Context) => cx.stop_propagation();

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const pad = (n: number) => String(n).padStart(2, "0");

/** The time and date as the sky shows them. */
export interface Clock {
  readonly time: string;
  readonly date: string;
}

/** The time ("14:05") and date ("Fri 6 Nov") right now. */
export function clock(): Clock {
  const d = new Date();

  return { time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, date: `${DAYS[d.getDay()] ?? ""} ${d.getDate()} ${MONTHS[d.getMonth()] ?? ""}` };
}

/** A lane of the meadow: its top and height (layout px), and whether it's in the jar. */
export interface Lane {
  readonly y: number;
  readonly h: number;
  readonly jar: boolean;
}

/** How far a lane's press area reaches into the gaps above and below it. */
export interface Reach {
  up: number;
  down: number;
}

/** How far each lane's press area reaches into the gaps above and below it
 *  (layout px): half the gap to its neighbour, so no strip between two
 *  agents is dead; the jar's lanes only to each other (its glass between). */
export function laneReach(lanes: readonly Lane[]): Reach[] {
  const order = lanes.map((_l, i) => i).sort((i, j) => (lanes[i]?.y ?? 0) - (lanes[j]?.y ?? 0));
  const out: Reach[] = lanes.map(() => ({ up: 0, down: 0 }));

  for (let k = 0; k + 1 < order.length; k++) {
    const ia = order[k] ?? 0;
    const ib = order[k + 1] ?? 0;
    const a = lanes[ia];
    const b = lanes[ib];
    const ra = out[ia];
    const rb = out[ib];

    if (!a || !b || !ra || !rb || a.jar !== b.jar) continue;

    const gap = Math.max(0, b.y - (a.y + a.h));

    ra.down = Math.floor(gap / 2);
    rb.up = gap - Math.floor(gap / 2);
  }

  return out;
}

/** The shelf's height for `n` tiles in `w` px (layout px): the board, the
 *  rows of tiles (as many to a row as fit), the caption line. */
export function shelfHeight(n: number, w: number): number {
  if (!n) return 0;

  const perRow = Math.max(1, Math.floor((w - 2 * SHELF_PAD + TILE_GAP) / (TILE + TILE_GAP)));
  const rows = Math.ceil(n / perRow);

  return BOARD + BOARD_GAP + rows * TILE + (rows - 1) * TILE_GAP + CAPTION.gap + CAPTION.h;
}

/** The open jar's rows (jarPlan). */
export interface JarPlan {
  readonly ys: number[];
  readonly shelfY: number;
  readonly jarH: number;
}

/**
 * The open jar's rows when the sky has room (layout px from the meadow's top):
 * each firefly lane's top (`lanes`: their heights, in jar order), the shelf's
 * top (`shelfH`: its height, 0 for none) and the jar's height. A jar held at
 * its least height (JAR.min) centers what it holds in the glass, so one firefly
 * sits in the middle with as much glass above as under it.
 */
export function jarPlan(lanes: readonly number[], shelfH = 0): JarPlan {
  const held = lanes.reduce((n, l) => n + l, 0) + (shelfH ? (lanes.length ? SHELF_ABOVE : 0) + shelfH : 0);
  const jarH = Math.max(JAR.min, JAR.top + held + JAR.bottom);
  let y = JAR.top + Math.floor((jarH - JAR.top - held - JAR.bottom) / 2);

  const ys = lanes.map((l) => {
    const at = y;

    y += l;

    return at;
  });

  return { ys, shelfY: shelfH ? (lanes.length ? y + SHELF_ABOVE : y) : 0, jarH };
}

/** The shelf's inset from the jar's walls (layout px): its tiles and caption
 *  start where a firefly's square does (its lane's mark at x 6, the glow's
 *  square GLOW_SQUARE.at in), so they line up under the fireflies. */
export const SHELF_PAD = 6 + GLOW_SQUARE.at;

export function moonPhase(list: readonly AgentInfo[]): number {
  if (!list.length) return 8;

  const rest = list.filter((a) => a.status === "idle" || a.status === "done").length;

  return Math.round((rest / list.length) * 8);
}

// Fireflies shows a hidden tab's terminals at 54x52 for a moment before their
// real size, and Claude Code's renderer is left half-drawn by the double
// resize until something makes it draw again. So when a tab comes into view,
// once the sizes have settled, idle Claude Codes there get an "x" and a
// backspace: a redraw that leaves the prompt as it was. Working ones get it
// too (their spinner only redraws its own line); blocked ones show a dialog
// where a letter can be an answer, so they're left alone. Only on stock
// Fireflies: the DwieDave fork (the one with native views) holds a new size until
// the layout settles, so programs never see the placeholder.
export const REDRAW_ON_SHOW = !("nativeView" in herdrAll);

// Agents with a dithered mark in art/ (art/logos.py), by program key or the
// agent's own app name. Others wear Fireflies' icon for them.
// Fireflies' shipped check (lucide), the done mark.
export const CHECK = "mods/workspace-chrome/check.svg";

// How long a mark's scanline takes there and back, by status; still otherwise.
export const SWEEP: ReadonlyMap<Status, number> = new Map([["working", 2400], ["blocked", 900]]);

// How fast the wings beat (there and back), by status; resting ones fold them.
export const FLAP: ReadonlyMap<Status, number> = new Map([["working", 260], ["blocked", 140], ["done", 900]]);

// Going to rest: how long the flight down to the ridge takes, while the
// glow and the mark's last awake color fade into the resting one.
export const LAND = 1800;

// Late enough for both resizes of a space switch to have landed.
export const REDRAW_DELAY = 700;

// Folding: the rail's width and where the open width is remembered.
// Narrower than RAIL_BELOW draws the rail, so dragging the edge in folds it
// too. On macOS the window buttons sit at the layout's traffic_lights (16 pt
// in, about 54 pt wide) in points, not zoomed: the rail gives them 16 pt on
// the far side too, in layout px at the zoom it's folded at.
export const RAIL = 76;
export const LIGHTS_ROOM = 86;
export const railWidth = (): number => (appWindow().platform === "macos" ? Math.max(RAIL, Math.ceil(LIGHTS_ROOM / (settings().zoom || 1))) : RAIL);
export const RAIL_BELOW = 160;

// The rail's ground (railGround): how far above the usage the stack ends (on
// the near ridge), how many at rest stand in one column before they pair
// up, and how many cells it shows at most (the last becomes "+n").
export const RAIL_RIDGE = 74;
export const RAIL_GROUND_ONE = 4;
export const RAIL_GROUND_MAX = 8;
export const OPEN_WIDTH = sharedKey("nocturne.sidebar", isNumber);
export const OPEN_DEFAULT = 252;

// How long a fold gets to land before its width is checked (ms).
export const SETTLE = 350;

// The jar of pinned fireflies (pins.ts) at the top of the sky: where its
// first lane starts under the lid, the glass under its last, the clear sky
// before the next firefly (layout px).
export const JAR = { at: 4, top: 38, bottom: 12, gap: 10, min: 112 } as const;

// min: the jar's least height, so with one firefly in it its lid, neck and
// shoulders don't take most of it (a wide flat band): there's glass under it.
// The jar's side margins in the open sky (equal both sides), and how far its
// fireflies' lanes sit in from the sidebar's edges (inside the 2 px walls).
export const JAR_SIDE = 8, JAR_INSET = JAR_SIDE + 2;

// How far the neck sits in from the body's walls: in the open sky, on the rail.
export const NECK = 22, RAIL_NECK = 11;

// Where the body's walls begin, under the lid, neck and shoulders.
export const BODY = 16;

// The open sky's mason jar: its lid (rim and thread) and where its walls
// begin, under the neck and the round shoulders.
export const LID = 10, JAR_BODY = 28;

/** How far a rail firefly's press area reaches past its cell, beside and above / below. */
export interface RailReach {
  readonly x: number;
  readonly y: number;
}

// How far a rail firefly's press area reaches past its cell: into the rail's
// padding beside it, half the 2 px gap above and below; the ground's pairs
// sit 2 px apart, so there only half that.
export const RAIL_REACH: RailReach = { x: 8, y: 1 };
export const PAIR_REACH: RailReach = { x: 1, y: 1 };

// How long the glass glints after a firefly flies in (ms): as long as the flight.
export const GLINT = 1800;

// The shelf at the jar's foot, where pinned panes that aren't agents sit as
// tiles (pins.ts onShelf): a tile's size and the gap between tiles, the
// room above it under the last firefly (clear of its halo: air before the
// board), its dithered board, the board's gap to the tiles, the caption line
// under them (its gap above, its height); SHELF_PAD (above) is its inset from
// the jar's walls. On the rail: smaller tiles, two abreast.
export const TILE = 28, TILE_GAP = 6, SHELF_ABOVE = 10, BOARD = 2, BOARD_GAP = 6, CAPTION = { gap: 6, h: 14 } as const;
export const RAIL_TILE = 18, RAIL_TILE_GAP = 4;

/** A control the sidebar's cursor walks: its id, its section, what the keyboard's verbs do on it. */
export type NavEntry = NavActs & { readonly id: string; readonly sec: string };

/** The verbs a control acts on itself. */
export type ActVerb = keyof NavActs;

export const ACT_VERBS: ReadonlySet<string> = new Set<ActVerb>(["go", "menu", "rename", "folder", "delete", "tab", "worktree", "new", "pin", "pin-up", "pin-down"]);

export const isActVerb = (verb: string): verb is ActVerb => ACT_VERBS.has(verb);

/** The sidebar's sections, top to bottom, as the cursor walks them. */
export const SECTION_RANK: ReadonlyMap<string, number> = new Map([["top", 0], ["spaces", 1], ["flies", 2], ["usage", 3]]);

/** An agent just gone to rest: its last awake color, and until when it lands. */
export interface Landing {
  readonly color: Color;
  readonly until: number;
}

/** What the glow needs of the sky to light its backdrop. */
export type GlowSky = Pick<GlowProps, "folded" | "h" | "lift">;

/** A lane placed in the meadow: its agent, its top, its height. */
export type Placed = readonly [AgentInfo, number, number];

/** A jar item's pane, if it has one (a mod pane, a terminal shown in one). */
export const paneOf = (it: JarItem): PaneInfo | null => ("pane" in it ? it.pane : null);

/** What the jar holds by key: an agent's address, a pin's jar key. */
export const heldKey = (x: AgentInfo | JarItem): string => ("address" in x ? x.address : x.key);

/** The heights above the rail's space list (railTop): its clock, its » key. */
export interface RailTops {
  clock?: number;
  key?: number;
}
