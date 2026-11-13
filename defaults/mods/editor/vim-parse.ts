// Vim's command parser (vim.ts): the keys typed so far read as a command
// (register, count, operator, motion or object, argument), not yet one, or
// none; a register's text cut back into keys; the mode a command sees.

import type { Mode, Vim } from "./vim.ts";
import { MOTIONS, MOTION_ARG } from "./vim-motions.ts";
import type { Operator } from "./vim-ops.ts";
import { isOperator } from "./vim-ops.ts";

/** A parsed command: its register and count, and an operator with its line, object or
 *  motion, or a key (with its argument: f's character, m's mark...). */
export interface Command {
  readonly done: true;
  readonly reg: string | null;
  readonly count: number;
  readonly has: boolean;
  readonly op?: Operator;
  readonly line?: boolean;
  readonly obj?: string;
  readonly around?: boolean;
  readonly key?: string;
  readonly arg?: string;
}

/** Visual mode's keys: operators act at once on the selection. */
const VISUAL_KEYS = new Set(["d", "c", "y", ">", "<", "x", "X", "D", "Y", "C", "S", "R", "p", "P", "J", "o", "O", "I", "A", "~", "u", "U", "s", "v", "V", "<C-v>", "<del>"]);

/** A count typed before a command (null: none), and where the command goes on. */
interface CountAt {
  readonly count: number | null;
  readonly next: number;
}

/** The digits of a count at keys[i] (a leading 0 is a motion), and the index after them. */
function countAt(keys: readonly string[], from: number): CountAt {
  let i = from;
  let s = "";

  while (i < keys.length && /[0-9]/.test(keys[i] ?? "") && !(s === "" && keys[i] === "0")) s += keys[i++] ?? "";

  return { count: s ? Number(s) : null, next: i };
}

export function parseVisual(keys: readonly string[]): Command | null | false {
  let i = 0;
  let reg: string | null = null;

  if (keys[0] === '"') {
    if (keys.length < 2) return null;

    reg = keys[1] ?? null;
    i = 2;
  }

  const c = countAt(keys, i);

  i = c.next;

  const k = keys[i];

  if (k === undefined) return null;

  const count = c.count ?? 1;
  const has = c.count !== null;

  if (VISUAL_KEYS.has(k)) return { done: true, reg, key: k, count, has };

  if (k === "r") {
    const arg = keys[i + 1];

    return arg === undefined ? null : { done: true, reg, key: "r", arg, count, has };
  }

  if (k === "g") {
    const next = keys[i + 1];

    if (next === undefined) return null;

    const g = "g" + next;

    if (g === "gu" || g === "gU" || g === "g~") return { done: true, reg, key: g, count, has };

    if (g === "gv" || g === "gJ") return { done: true, reg, key: g, count, has };
  }

  return parse(keys);
}

/** Parses a pending normal-mode command; -> { done, reg, count, op, key, arg, obj } or null (needs more keys) or false (invalid). */
export function parse(keys: readonly string[]): Command | null | false {
  let i = 0;
  let reg: string | null = null;

  if (keys[i] === '"') {
    if (keys.length < 2) return null;

    reg = keys[1] ?? null;
    i = 2;
  }

  const c = countAt(keys, i);
  const count = c.count;

  i = c.next;

  if (i >= keys.length) return null;

  if (keys[i] === "g" && i + 1 >= keys.length) return null;

  const named = keys[i] === "g" ? "g" + (keys[i + 1] ?? "") : (keys[i] ?? "");

  if (isOperator(named) && named !== "~") {
    const op = named;

    i += op.length;

    const oc = countAt(keys, i);
    const opCount = oc.count;

    i = oc.next;

    if (i >= keys.length) return null;

    const total = (count ?? 1) * (opCount ?? 1);
    const has = count !== null || opCount !== null;
    // dd cc yy >> << g~~ guu gUU (and gugu...)
    const last = op.at(-1);

    if (keys[i] === last || (op.length === 2 && keys[i] === "g" && keys[i + 1] === op[1])) return { done: true, reg, op, line: true, count: total, has };

    if (keys[i] === "i" || keys[i] === "a") {
      const obj = keys[i + 1];

      if (obj === undefined) return null;

      return { done: true, reg, op, obj, around: keys[i] === "a", count: total, has };
    }

    let key = keys[i] ?? "";

    if (key === "g") {
      if (i + 1 >= keys.length) return null;

      key = "g" + (keys[i + 1] ?? "");
      i++;
    }

    if (!MOTIONS.has(key)) return false;

    if (MOTION_ARG.has(key)) {
      const arg = keys[i + 1];

      if (arg === undefined) return null;

      return { done: true, reg, op, key, arg, count: total, has };
    }

    return { done: true, reg, op, key, count: total, has };
  }

  let key = keys[i] ?? "";

  if (key === "g" || key === "Z" || key === "[" || key === "]" || key === "z") {
    if (i + 1 >= keys.length) return null;

    key = key + (keys[i + 1] ?? "");
    i++;
  }

  if (MOTION_ARG.has(key) || ["r", "m", "q", "@"].includes(key)) {
    const arg = keys[i + 1];

    if (arg === undefined) return null;

    return { done: true, reg, key, arg, count: count ?? 1, has: count !== null };
  }

  return { done: true, reg, key, count: count ?? 1, has: count !== null };
}

/** The mode as it is now (a command may have changed it since it was looked at). */
export const modeOf = (vim: Vim): Mode => vim.mode;

export const isVisual = (mode: Mode): boolean => mode === "visual" || mode === "vline" || mode === "vblock";

/** Keys from a register's text (a recorded macro). */
export function tokens(text: string): string[] {
  const out: string[] = [];
  const re = /<[^<>\s]+>|[\s\S]/gu;

  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[0]);

  return out;
}
