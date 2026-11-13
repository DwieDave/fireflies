// Vim's operators and registers (vim.ts): a register set and read ("a-z,
// "0-"9, "-, "_, "+), an operator applied to a span (d c y > < g~ gu gU),
// a put, insert mode entered, `.` set up to replay the last change.

import { isString, literal } from "./guard.ts";
import type { FeedResult, Key, Mode, Pos, Register, Vim } from "./vim.ts";
import type { Buffer } from "./vim-buffer.ts";
import { maxPos, minPos } from "./vim-buffer.ts";
import type { Motion } from "./vim-motions.ts";
import type { Outcome } from "./vim-normal.ts";
import type { Span } from "./vim-objects.ts";

// ---- the machine

/** Why a register is set: a yank fills "0, a delete "1-"9 or "-. */
type RegKind = "yank" | "delete";

export function setReg(vim: Vim, name: string | null, text: string, linewise: boolean, kind: RegKind): void {
  if (name === "_") return;

  const value = { text, linewise };

  if (name && /[A-Z]/.test(name)) {
    const r = vim.registers.get(name.toLowerCase());

    vim.registers.set(name.toLowerCase(), r ? { text: r.text + (r.linewise && !linewise ? "\n" : "") + text, linewise: r.linewise || linewise } : value);
  } else if (name && name !== '"') vim.registers.set(name, value);

  vim.registers.set('"', value);

  if (kind === "yank" && (!name || name === '"')) vim.registers.set("0", value);

  if (kind === "delete" && (!name || name === '"')) {
    if (linewise || text.includes("\n")) {
      for (let i = 9; i > 1; i--) {
        const was = vim.registers.get(String(i - 1));

        if (was) vim.registers.set(String(i), was);
      }

      vim.registers.set("1", value);
    } else vim.registers.set("-", value);
  }

  // Everything yanked or deleted also goes to the system clipboard (clipboard=unnamedplus).
  vim.clipboard = { text, linewise };
}

export function getReg(vim: Vim, name: string | null, clipboard: string | null | undefined): Register | null {
  if (name === "+" || name === "*") return clipboard ? { text: clipboard, linewise: clipboard.endsWith("\n") } : (vim.registers.get("+") ?? null);

  if (!name || name === '"') {
    // Another app's copy wins over the last yank when it differs.
    const own = vim.registers.get('"');

    if (clipboard !== null && clipboard !== undefined && clipboard !== "" && clipboard !== own?.text && clipboard !== (own?.text ?? "") + "\n") return { text: clipboard, linewise: clipboard.endsWith("\n") && !own };

    return own ?? null;
  }

  return vim.registers.get(name.toLowerCase()) ?? null;
}

/** The range an operator covers from a motion. -> { start, end, linewise } */
export function rangeOf(b: Buffer, from: Pos, m: Motion): Span {
  const start = minPos(from, m.to);
  let end = maxPos(from, m.to);

  if (m.linewise) return { start: { line: start.line, col: 0 }, end: { line: end.line, col: b.len(end.line) }, linewise: true };

  if (m.inclusive) end = { line: end.line, col: Math.min(b.len(end.line), end.col + 1) };

  // `cw` on a word is `ce`; `dw` at a line's last word stops at the line end.
  if (m.word && end.line > start.line) end = { line: start.line, col: b.len(start.line) };

  return { start, end, linewise: false };
}

export function deleteLines(b: Buffer, s: number, e: number): Pos {
  // Lines s..e whole, with their newline.
  if (e < b.last) return b.replace({ line: s, col: 0 }, { line: e + 1, col: 0 }, "");

  if (s > 0) return b.replace({ line: s - 1, col: b.len(s - 1) }, { line: e, col: b.len(e) }, "");

  return b.replace({ line: s, col: 0 }, { line: e, col: b.len(e) }, "");
}

/** An operator: delete, change, yank, indent, outdent, case. */
export const isOperator = literal("d", "c", "y", ">", "<", "g~", "gu", "gU", "~");

export type Operator = "d" | "c" | "y" | ">" | "<" | "g~" | "gu" | "gU" | "~";

export function applyOperator(b: Buffer, vim: Vim, op: Operator, r: Span, reg: string | null, out: FeedResult): void {
  const textOf = (): string => (r.linewise ? b.text({ line: r.start.line, col: 0 }, { line: r.end.line, col: b.len(r.end.line) }) + "\n" : b.text(r.start, r.end));
  const linewise = r.linewise === true;

  switch (op) {
    case "y":
      setReg(vim, reg, textOf(), linewise, "yank");
      b.cursor = r.linewise ? { line: r.start.line, col: b.cursor.col } : r.start;
      clipboardTo(out, vim);

      return;
    case "d": {
      setReg(vim, reg, textOf(), linewise, "delete");
      clipboardTo(out, vim);

      if (r.linewise) {
        deleteLines(b, r.start.line, r.end.line);
        b.cursor = b.firstNonBlank(Math.min(r.start.line, b.last));
      } else {
        b.replace(r.start, r.end, "");
        b.cursor = b.clamp(r.start);
      }

      return;
    }

    case "c": {
      setReg(vim, reg, textOf(), linewise, "delete");
      clipboardTo(out, vim);

      if (r.linewise) {
        const indent = b.line(r.start.line).match(/^\s*/)?.[0] ?? "";

        b.replace({ line: r.start.line, col: 0 }, { line: r.end.line, col: b.len(r.end.line) }, indent);
        b.cursor = { line: r.start.line, col: indent.length };
      } else {
        b.replace(r.start, r.end, "");
        b.cursor = r.start;
      }

      enterInsert(vim, b);

      return;
    }

    case ">":
    case "<": {
      const unit = vim.indent ?? "  ";

      for (let l = r.start.line; l <= r.end.line; l++) {
        const line = b.line(l);

        if (op === ">") {
          if (line.length) b.replace({ line: l, col: 0 }, { line: l, col: 0 }, unit.repeat(vim.shiftCount));
        } else {
          const n = Math.min((line.match(/^ */)?.[0] ?? "").length, unit.length * vim.shiftCount);
          const tabs = line.startsWith("\t") ? 1 : 0;

          if (n || tabs) b.replace({ line: l, col: 0 }, { line: l, col: n || tabs }, "");
        }
      }

      b.cursor = b.firstNonBlank(r.start.line);

      return;
    }

    case "g~":
    case "gu":
    case "gU":
    case "~": {
      const from = r.linewise ? { line: r.start.line, col: 0 } : r.start;
      const to = r.linewise ? { line: r.end.line, col: b.len(r.end.line) } : r.end;
      const t = b.text(from, to);

      const f = (s: string): string =>
        op === "gu"
          ? s.toLowerCase()
          : op === "gU"
            ? s.toUpperCase()
            : [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join("");

      b.replace(from, to, f(t));
      b.cursor = r.linewise ? { line: r.start.line, col: b.cursor.col } : r.start;
    }
  }
}

/** What was yanked or deleted, for the editor to put on the system clipboard. */
export function clipboardTo(out: FeedResult, vim: Vim): void {
  if (vim.clipboard) out.clipboard = vim.clipboard;
}

/** Insert mode begun from outside vim's keys (the rendered view's enter in normal mode: a new
 *  block typed into), from `text` with the caret at `cursor`; `keys` stand for it in `.`. */
export function beginInsert(vim: Vim, text: string, cursor: Pos, keys: readonly Key[]): void {
  vim.mode = "insert";
  vim.insertStart = { text, cursor: { ...cursor }, keys: [...keys] };
}

export function enterInsert(vim: Vim, b: Buffer, mode: Mode = "insert"): void {
  vim.mode = mode;
  vim.insertStart = { text: b.all(), cursor: { ...b.cursor }, keys: [] };
}

export function put(b: Buffer, vim: Vim, reg: string | null, after: boolean, count: number, clipboard: string | null | undefined): void {
  const r = getReg(vim, reg, clipboard);

  if (!r) return;

  const text = r.text.repeat(count);

  if (r.linewise) {
    const body = text.endsWith("\n") ? text.slice(0, -1) : text;

    if (after) {
      b.replace({ line: b.cursor.line, col: b.len(b.cursor.line) }, { line: b.cursor.line, col: b.len(b.cursor.line) }, "\n" + body);
      b.cursor = b.firstNonBlank(b.cursor.line + 1);
    } else {
      b.replace({ line: b.cursor.line, col: 0 }, { line: b.cursor.line, col: 0 }, body + "\n");
      b.cursor = b.firstNonBlank(b.cursor.line);
    }
  } else {
    const at = after && b.len(b.cursor.line) ? { line: b.cursor.line, col: b.cursor.col + 1 } : b.cursor;
    const end = b.replace(at, at, text);

    b.cursor = text.includes("\n") ? at : b.clamp({ line: end.line, col: end.col - 1 });
  }
}

/** `.`: the last change again (at the caret, `count` times when given). */
export function repeat(vim: Vim, out: FeedResult, count: number | null): Outcome {
  const last = vim.lastChange;

  if (!last) return false;

  const keys: Key[] = count ? stripCount(last.keys, count) : [...last.keys];

  out.replay = { keys: last.inserted === null ? keys : [...keys, { insert: last.inserted }, "<esc>"], times: 1, repeat: true };

  return "nochange";
}

function stripCount(keys: readonly Key[], count: number): Key[] {
  const text = (k: Key | undefined): string => (isString(k) ? k : "");
  let i = 0;

  if (keys[0] === '"') i = 2;

  let j = i;

  while ((j < keys.length && /[1-9]/.test(text(keys[j]))) || (j > i && /[0-9]/.test(text(keys[j])))) j++;

  return [...keys.slice(0, i), ...String(count), ...keys.slice(j)];
}
