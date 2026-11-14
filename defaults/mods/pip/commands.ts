// The player's keys and commands: what ? lists (KEYS), the control a key asks
// for (keyControl), a command's text as one (parseCommand), and the ⋯ menu's
// cursor (menuMove). Pure, so scripts/pip.test.ts tests them without a window.

import type { KeyEvent } from "gpui-kit";
import { isString, literal } from "./guard.ts";

/** Seconds a « or » skips. */
export const SKIP = 10;

/** The bar's controls (main.ts CONTROLS), by the command each runs. */
export type ControlId = "back" | "rewind" | "toggle" | "forward" | "mute" | "pane" | "park" | "out" | "snap" | "keys" | "close";

/** Where `to:` moves the window: one of the pane grid's eight places, or the next place that way. */
type SnapTo = "top-left" | "top" | "top-right" | "right" | "bottom-right" | "bottom" | "bottom-left" | "left" | "up" | "down";

const isSnapTo = literal("top-left", "top", "top-right", "right", "bottom-right", "bottom", "bottom-left", "left", "up", "down");

/** What a key or a command asks of the player: a control, the keyboard back to the
 *  pane, snapping set on or off, or the window onto a place (`to:<place | left | right | up | down>`). */
export type Command = ControlId | "unfocus" | "snap:on" | "snap:off" | `to:${SnapTo}`;

const isControlCommand = literal("back", "rewind", "toggle", "forward", "mute", "pane", "park", "out", "snap", "keys", "close", "unfocus", "snap:on", "snap:off");

/** A command's text (`pip.` taken off) as a Command, or null. */
export function parseCommand(c: string): Command | null {
  if (isControlCommand(c)) return c;

  const to = c.startsWith("to:") ? c.slice(3) : null;

  return to !== null && isSnapTo(to) ? `to:${to}` : null;
}

/** What ? lists: every key keyControl() takes, ? keys last. */
export const KEYS: readonly (readonly [string, string])[] = [["space k", "pause / play"], ["← →  h l", `${SKIP} s back / on`], ["m", "sound off / on"], ["b", "back to the page"],
  ["p", "into a pane"], ["P", "park as a chip"], ["o", "out of Fireflies"], ["s", "snap to corners on / off"],
  ["⇧← ⇧→  H L", "to the corner or edge middle left / right"], ["⇧↑ ⇧↓  K J", "… above / below"],
  ["x q", "close"], ["esc", "the keyboard back to the pane"], ["?", "keys"]];

const KEY_COMMANDS: ReadonlyMap<string, Command> = new Map<string, Command>([
  ["space", "toggle"], ["k", "toggle"], ["left", "rewind"], ["h", "rewind"], ["right", "forward"], ["l", "forward"], ["m", "mute"], ["b", "back"],
  ["p", "pane"], ["P", "park"], ["o", "out"], ["s", "snap"], ["x", "close"], ["q", "close"], ["escape", "unfocus"], ["?", "keys"],
  // From place to place on the pane grid (shift with the arrows, or with h j k l).
  ["H", "to:left"], ["L", "to:right"], ["K", "to:up"], ["J", "to:down"],
  ["shift-left", "to:left"], ["shift-right", "to:right"], ["shift-up", "to:up"], ["shift-down", "to:down"],
]);

/** A key as keyControl() reads it: GPUI's key event, or the fields a test gives. */
type Key = Pick<KeyEvent, "key"> & { readonly key_char?: string | null | undefined; readonly modifiers?: Partial<KeyEvent["modifiers"]> | undefined };

/** The player's control for a key event, or null. "unfocus": esc, the keyboard back to the pane. */
export function keyControl(e: Key | null | undefined): Command | null {
  const m = e?.modifiers;

  if (m?.platform || m?.control || m?.alt) return null;

  const c = e?.key_char;
  const key = e?.key ?? "";
  // Shift with an arrow (the arrows type no character).
  const arrow = m?.shift && ["left", "right", "up", "down"].includes(key) ? `shift-${key}` : null;
  const k = arrow ?? (isString(c) && c.length === 1 && c.trim() !== "" ? c : key);

  return KEY_COMMANDS.get(k) ?? null;
}

/** The ⋯ menu's cursor after a key (null: not a moving key). */
export function menuMove(k: string, at: number, n: number): number | null {
  const d = k === "down" || k === "j" ? 1 : k === "up" || k === "k" ? -1 : 0;

  return d !== 0 && n > 0 ? (at + d + n) % n : null;
}
