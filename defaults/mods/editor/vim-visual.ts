// Vim's visual modes (vim.ts feed runs them): the selections of char, line
// and block visual mode, and a command applied to them.

import type { Doc, FeedResult, Mode, Pos, Selection, Vim } from "./vim.ts";
import type { Buffer } from "./vim-buffer.ts";
import { cmp, maxPos, minPos } from "./vim-buffer.ts";
import { MOTIONS, motion } from "./vim-motions.ts";
import type { Outcome } from "./vim-normal.ts";
import { normalCommand } from "./vim-normal.ts";
import type { Span } from "./vim-objects.ts";
import type { Operator } from "./vim-ops.ts";
import { applyOperator, clipboardTo, enterInsert, getReg, setReg } from "./vim-ops.ts";
import type { Command } from "./vim-parse.ts";

/** The selections of a visual mode from `a` (the anchor) to `c` (the caret). */
export function visualSelections(mode: Mode, a: Pos, b: Buffer, c: Pos = b.cursor): Selection[] {
  if (mode === "visual") {
    const s = minPos(a, c);
    const e = maxPos(a, c);

    return [{ start: s, end: { line: e.line, col: Math.min(b.len(e.line), e.col + 1) }, head: cmp(c, a) < 0 ? "start" : "end" }];
  }

  if (mode === "vline") {
    const s = Math.min(a.line, c.line);
    const e = Math.max(a.line, c.line);

    return [{ start: { line: s, col: 0 }, end: { line: e, col: b.len(e) }, head: c.line < a.line ? "start" : "end" }];
  }

  const s = Math.min(a.line, c.line);
  const e = Math.max(a.line, c.line);
  const l = Math.min(a.col, c.col);
  const r = Math.max(a.col, c.col) + 1;
  const out: Selection[] = [];

  for (let line = s; line <= e; line++) out.push({ start: { line, col: Math.min(l, b.len(line)) }, end: { line, col: Math.min(r, b.len(line)) } });

  return out;
}

function visualRange(vim: Vim, b: Buffer): Span {
  const a = vim.anchor ?? b.cursor;
  const c = b.cursor;

  if (vim.mode === "vline") {
    const s = Math.min(a.line, c.line);
    const e = Math.max(a.line, c.line);

    return { start: { line: s, col: 0 }, end: { line: e, col: b.len(e) }, linewise: true };
  }

  const s = minPos(a, c);
  const e = maxPos(a, c);

  return { start: s, end: { line: e.line, col: Math.min(b.len(e.line), e.col + 1) }, linewise: false };
}

function leaveVisual(vim: Vim, b: Buffer): void {
  const anchor = vim.anchor ?? b.cursor;

  vim.marks.set("<", minPos(anchor, b.cursor));
  vim.marks.set(">", maxPos(anchor, b.cursor));
  vim.lastVisual = vim.mode;
  vim.mode = "normal";
  vim.anchor = null;
}

/** What a visual key does to the selection (an operator, or one of the line-wise ones). */
type VisualOp = Operator | "D" | "Y" | "C" | "S";

/** Visual mode's keys and the operators they are. */
const VISUAL_OPS: ReadonlyMap<string, VisualOp> = new Map<string, VisualOp>([
  ["d", "d"],
  ["x", "d"],
  ["<del>", "d"],
  ["y", "y"],
  ["c", "c"],
  ["s", "c"],
  [">", ">"],
  ["<", "<"],
  ["~", "~"],
  ["u", "gu"],
  ["U", "gU"],
  ["gu", "gu"],
  ["gU", "gU"],
  ["g~", "g~"],
  ["X", "D"],
  ["D", "D"],
  ["Y", "Y"],
  ["C", "C"],
  ["S", "S"],
  ["R", "S"],
]);

export function visualCommand(vim: Vim, cmd: Command, b: Buffer, doc: Doc, out: FeedResult): Outcome {
  const key = cmd.key ?? cmd.op ?? "";
  const n = cmd.count;

  if (!cmd.op && MOTIONS.has(key)) {
    const m = motion(b, vim, key, n, cmd.arg, cmd.has);

    if (m) {
      if (m.keepGoal) {
        vim.goal ??= b.cursor.col;
        out.keepGoal = true;
      }

      b.cursor = m.to;
    }

    return false;
  }

  // Text objects extend the selection: viw, va(, vip.
  if (!cmd.op && (key === "i" || key === "a")) return "pending-object";

  const block = vim.mode === "vblock";
  const r = visualRange(vim, b);
  const op: VisualOp | undefined = cmd.op ?? VISUAL_OPS.get(key);

  const done = visualKey(vim, cmd, b, doc, out, key, n, block, r);

  if (done !== null) return done;

  if (!op) {
    leaveVisual(vim, b);

    return "unknown";
  }

  if (block && (op === "d" || op === "c" || op === "y" || op === "~" || op === "gu" || op === "gU")) return blockOperator(vim, cmd, b, out, op);

  leaveVisual(vim, b);

  if (op === "D" || op === "Y" || op === "C" || op === "S") {
    const lr = { start: { line: r.start.line, col: 0 }, end: { line: r.end.line, col: b.len(r.end.line) }, linewise: true };

    applyOperator(b, vim, op === "Y" ? "y" : op === "D" ? "d" : "c", lr, cmd.reg, out);

    return op !== "Y";
  }

  if (op === ">" || op === "<") vim.shiftCount = n;

  applyOperator(b, vim, op, r, cmd.reg, out);
  vim.shiftCount = 1;

  if (op === "y") {
    b.cursor = r.start;

    return false;
  }

  return true;
}

/** Visual mode's keys that aren't operators: o (the other end), v V ctrl-v (switch or leave), J, p P, r, I A (block inserts). */
function visualKey(vim: Vim, cmd: Command, b: Buffer, doc: Doc, out: FeedResult, key: string, n: number, block: boolean, r: Span): Outcome | null {
  switch (key) {
    case "o": {
      const a = vim.anchor ?? b.cursor;

      vim.anchor = { ...b.cursor };
      b.cursor = a;

      return false;
    }

    case "v":
    case "V":
    case "<C-v>": {
      const want = key === "v" ? "visual" : key === "V" ? "vline" : "vblock";

      if (vim.mode === want) {
        leaveVisual(vim, b);

        return false;
      }

      vim.mode = want;

      return false;
    }

    case "J": {
      leaveVisual(vim, b);
      b.cursor = r.start;

      return normalCommand(vim, { done: true, reg: null, key: "J", count: Math.max(2, r.end.line - r.start.line + 1), has: false }, b, doc, out);
    }

    case "p":
    case "P": {
      const reg = getReg(vim, cmd.reg, doc.clipboard);

      if (!reg) return false;

      const old = b.text(r.start, r.end) + (r.linewise ? "\n" : "");

      leaveVisual(vim, b);

      if (r.linewise) {
        b.replace(r.start, r.end, reg.text.replace(/\n$/, ""));
        b.cursor = b.firstNonBlank(r.start.line);
      } else {
        const end = b.replace(r.start, r.end, reg.linewise ? "\n" + reg.text.replace(/\n$/, "") + "\n" : reg.text);

        b.cursor = b.clamp({ line: end.line, col: Math.max(0, end.col - 1) });
      }

      if (key === "p") setReg(vim, null, old, r.linewise === true, "delete");

      clipboardTo(out, vim);

      return true;
    }

    case "r": {
      leaveVisual(vim, b);

      const start = vim.marks.get("<") ?? r.start;
      const ranges: readonly Span[] = block ? visualSelections("vblock", start, b, vim.marks.get(">") ?? start) : [r];

      for (const s of [...ranges].reverse()) {
        const t = b.text(s.start, s.end);

        b.replace(s.start, s.end, t.replace(/[^\n]/g, cmd.arg ?? ""));
      }

      b.cursor = r.start;

      return true;
    }

    case "I":
    case "A": {
      if (!block) {
        leaveVisual(vim, b);
        b.cursor = key === "I" ? r.start : { line: r.end.line, col: r.end.col };
        enterInsert(vim, b);

        return true;
      }

      const sels = visualSelections(vim.mode, vim.anchor ?? b.cursor, b);

      leaveVisual(vim, b);

      // One caret per line of the block: typing goes to all.
      const multi = sels.map((s) => (key === "I" ? s.start : s.end));

      out.multi = multi;
      b.cursor = multi[0] ?? b.cursor;
      enterInsert(vim, b);

      return true;
    }

    default:
      return null;
  }
}

/** An operator in block visual mode: on each line's piece of the block (a change types into all of them). */
function blockOperator(vim: Vim, cmd: Command, b: Buffer, out: FeedResult, op: "d" | "c" | "y" | "~" | "gu" | "gU"): Outcome {
  const sels = visualSelections(vim.mode, vim.anchor ?? b.cursor, b);

  leaveVisual(vim, b);

  const first = sels[0]?.start ?? b.cursor;
  const texts = sels.map((s) => b.text(s.start, s.end));

  if (op === "y") {
    setReg(vim, cmd.reg, texts.join("\n"), false, "yank");
    clipboardTo(out, vim);
    b.cursor = first;

    return false;
  }

  if (op === "d" || op === "c") {
    setReg(vim, cmd.reg, texts.join("\n"), false, "delete");
    clipboardTo(out, vim);

    for (const s of [...sels].reverse()) b.replace(s.start, s.end, "");

    b.cursor = first;

    if (op === "c") {
      out.multi = sels.map((s) => s.start);
      enterInsert(vim, b);
    }

    return true;
  }

  for (const s of [...sels].reverse()) applyOperator(b, vim, op, { start: s.start, end: s.end }, null, out);

  b.cursor = first;

  return true;
}
