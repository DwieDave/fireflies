// Vim's normal mode commands (vim.ts feed runs them): a parsed command
// applied to the working copy: motions, operators, edits, puts, marks,
// macros, the leader's and g's commands, and what they came to.

import type { Doc, FeedResult, Pos, Vim } from "./vim.ts";
import type { Buffer } from "./vim-buffer.ts";
import { cls, cmp, times } from "./vim-buffer.ts";
import type { Motion } from "./vim-motions.ts";
import { MOTIONS, motion, wordEnd } from "./vim-motions.ts";
import type { Span } from "./vim-objects.ts";
import { textObject } from "./vim-objects.ts";
import { applyOperator, enterInsert, put, rangeOf, repeat } from "./vim-ops.ts";
import type { Command } from "./vim-parse.ts";
import { tokens } from "./vim-parse.ts";

/** What a command came to: a change (true), none (false), only commands for the editor
 *  ("nochange"), a key vim doesn't know ("unknown"), or an object still to come. */
export type Outcome = boolean | "nochange" | "unknown" | "pending-object";

export function normalCommand(vim: Vim, cmd: Command, b: Buffer, doc: Doc, out: FeedResult): Outcome {
  const p = b.cursor;
  const n = cmd.count;

  if (cmd.op) {
    let r: Span;

    if (cmd.line) {
      const e = Math.min(b.last, p.line + n - 1);

      r = { start: { line: p.line, col: 0 }, end: { line: e, col: b.len(e) }, linewise: true };
    } else if (cmd.obj !== undefined) {
      const o = textObject(b, p, cmd.around === true, cmd.obj, n);

      if (!o) return false;

      r = o;
    } else {
      // `cw` on a non-blank changes to the end of this word (and n - 1 more).
      const key = cmd.key;

      if (key === undefined) return false;

      let m: Motion | null;

      if (cmd.op === "c" && (key === "w" || key === "W") && cls(b.at(p), key === "W") > 0) {
        const big = key === "W";
        const k = cls(b.at(p), big);
        let q = { ...p };
        let nn: Pos | null;

        while ((nn = b.next(q)) && b.at(nn) !== "\n" && cls(b.at(nn), big) === k) q = nn;

        if (n > 1) q = wordEnd(b, q, big, n - 1);

        m = { to: q, inclusive: true };
      } else m = motion(b, vim, key, n, cmd.arg, cmd.has);

      if (!m) return false;

      r = rangeOf(b, p, m);

      if ((key === "j" || key === "k") && m.to.line === p.line && n > 0 && key === "j" && p.line === b.last) return false;
    }

    if (cmp(r.start, r.end) === 0 && !r.linewise && cmd.op !== "c") return false;

    applyOperator(b, vim, cmd.op, r, cmd.reg, out);

    return cmd.op !== "y";
  }

  const key = cmd.key ?? "";

  // H / L: the pane's previous / next file tab while it has several (a count:
  // that many); with one, the screen's top / bottom line as in Vim.
  if ((key === "H" || key === "L") && (doc.tabs ?? 1) > 1) {
    out.commands.push(...times(n, key === "H" ? "prev-tab" : "next-tab"));

    return false;
  }

  if (MOTIONS.has(key)) {
    const m = motion(b, vim, key, n, cmd.arg, cmd.has);

    if (!m) return false;

    if (m.jump) vim.marks.set("`", { ...p });

    if (m.keepGoal) {
      vim.goal ??= p.col;
      out.keepGoal = true;
    }

    b.cursor = m.to;

    if (m.eol) {
      vim.goal = 1e9;
      out.keepGoal = true;
    }

    return false;
  }

  const arg = cmd.arg ?? "";

  return insertCommand(vim, b, p, key) ?? changeCommand(vim, cmd, b, out, p, n, key) ?? editCommand(vim, cmd, b, doc, out, p, n, key, arg) ?? stateCommand(vim, cmd, b, out, p, n, key, arg) ?? editorCommand(cmd, b, out, p, n, key) ?? "unknown";
}

/** Keys that start insert mode: i a I gI A o O. */
function insertCommand(vim: Vim, b: Buffer, p: Pos, key: string): Outcome | null {
  switch (key) {
    case "i":
      enterInsert(vim, b);

      return true;
    case "a":
      b.cursor = { line: p.line, col: Math.min(b.len(p.line), p.col + 1) };
      enterInsert(vim, b);

      return true;
    case "I":
      b.cursor = b.firstNonBlank(p.line);

      if (b.len(p.line) && b.line(p.line).trim() === "") b.cursor = { line: p.line, col: b.len(p.line) };

      enterInsert(vim, b);

      return true;
    case "gI":
      b.cursor = { line: p.line, col: 0 };
      enterInsert(vim, b);

      return true;
    case "A":
      b.cursor = { line: p.line, col: b.len(p.line) };
      enterInsert(vim, b);

      return true;
    case "o":
    case "O": {
      const indent = (b.line(p.line).match(/^\s*/)?.[0] ?? "") + (key === "o" && /[{([:]\s*$/.test(b.line(p.line)) ? (vim.indent ?? "  ") : "");

      if (key === "o") {
        b.replace({ line: p.line, col: b.len(p.line) }, { line: p.line, col: b.len(p.line) }, "\n" + indent);
        b.cursor = { line: p.line + 1, col: indent.length };
      } else {
        b.replace({ line: p.line, col: 0 }, { line: p.line, col: 0 }, indent + "\n");
        b.cursor = { line: p.line, col: indent.length };
      }

      enterInsert(vim, b);

      return true;
    }

    default:
      return null;
  }
}

/** Deletes and changes by key: x X s S cc D C Y. */
function changeCommand(vim: Vim, cmd: Command, b: Buffer, out: FeedResult, p: Pos, n: number, key: string): Outcome | null {
  switch (key) {
    case "x":
    case "<del>": {
      if (!b.len(p.line)) return false;

      const e = Math.min(b.len(p.line), p.col + n);

      applyOperator(b, vim, "d", { start: p, end: { line: p.line, col: e } }, cmd.reg, out);

      return true;
    }

    case "X": {
      if (!p.col) return false;

      applyOperator(b, vim, "d", { start: { line: p.line, col: Math.max(0, p.col - n) }, end: p }, cmd.reg, out);

      return true;
    }

    case "s": {
      const e = Math.min(b.len(p.line), p.col + n);

      applyOperator(b, vim, "c", { start: p, end: { line: p.line, col: e } }, cmd.reg, out);

      return true;
    }

    case "S":
    case "cc": {
      const e = Math.min(b.last, p.line + n - 1);

      applyOperator(b, vim, "c", { start: { line: p.line, col: 0 }, end: { line: e, col: b.len(e) }, linewise: true }, cmd.reg, out);

      return true;
    }

    case "D": {
      const e = Math.min(b.last, p.line + n - 1);

      applyOperator(b, vim, "d", { start: p, end: { line: e, col: b.len(e) } }, cmd.reg, out);
      b.cursor = b.clamp(b.cursor);

      return true;
    }

    case "C": {
      const e = Math.min(b.last, p.line + n - 1);

      applyOperator(b, vim, "c", { start: p, end: { line: e, col: b.len(e) } }, cmd.reg, out);

      return true;
    }

    case "Y": {
      const e = Math.min(b.last, p.line + n - 1);

      applyOperator(b, vim, "y", { start: { line: p.line, col: 0 }, end: { line: e, col: b.len(e) }, linewise: true }, cmd.reg, out);
      b.cursor = p;

      return false;
    }

    default:
      return null;
  }
}

/** Puts and edits in place: p P r R J gJ ~. */
function editCommand(vim: Vim, cmd: Command, b: Buffer, doc: Doc, out: FeedResult, p: Pos, n: number, key: string, arg: string): Outcome | null {
  switch (key) {
    case "p":
    case "P":
      put(b, vim, cmd.reg, key === "p", n, doc.clipboard);

      return true;
    case "r": {
      if (p.col + n > b.len(p.line)) return false;

      const ch = arg === "<cr>" ? "\n" : arg;

      if (ch.length !== 1 && ch !== "\n") return false;

      b.replace(p, { line: p.line, col: p.col + n }, ch === "\n" ? "\n" : ch.repeat(n));
      b.cursor = ch === "\n" ? { line: p.line + 1, col: 0 } : { line: p.line, col: p.col + n - 1 };

      return true;
    }

    case "R":
      enterInsert(vim, b, "replace");

      return true;
    case "J":
    case "gJ": {
      const last = Math.min(b.last, p.line + Math.max(1, n - 1));

      if (last === p.line) return false;

      for (let l = p.line; l < last; l++) {
        const end = b.len(p.line);
        const nextLine = b.line(p.line + 1);
        const lead = key === "J" ? (nextLine.match(/^\s*/)?.[0] ?? "").length : 0;
        const sep = key === "J" && end > 0 && nextLine.trim() !== "" && !nextLine.trim().startsWith(")") ? " " : "";
        const trail = key === "J" ? (b.line(p.line).match(/\s*$/)?.[0] ?? "").length : 0;

        b.replace({ line: p.line, col: end - trail }, { line: p.line + 1, col: lead }, sep);
        b.cursor = { line: p.line, col: end - trail };
      }

      return true;
    }

    case "~": {
      const e = Math.min(b.len(p.line), p.col + n);

      if (e === p.col) return false;

      applyOperator(b, vim, "~", { start: p, end: { line: p.line, col: e } }, null, out);
      b.cursor = b.clamp({ line: p.line, col: e });

      return true;
    }

    default:
      return null;
  }
}

/** Undo, redo, `.`, the visual modes, marks and macros. */
function stateCommand(vim: Vim, cmd: Command, b: Buffer, out: FeedResult, p: Pos, n: number, key: string, arg: string): Outcome | null {
  switch (key) {
    case "u":
      out.commands.push(...times(n, "undo"));

      return "nochange";
    case "<C-r>":
      out.commands.push(...times(n, "redo"));

      return "nochange";
    case ".":
      return repeat(vim, out, cmd.has ? n : null);
    case "v":
      vim.mode = "visual";
      vim.anchor = { ...p };

      return false;
    case "V":
      vim.mode = "vline";
      vim.anchor = { ...p };

      return false;
    case "<C-v>":
      vim.mode = "vblock";
      vim.anchor = { ...p };

      return false;
    case "gv": {
      const s = vim.marks.get("<");
      const e = vim.marks.get(">");

      if (!s) return false;

      vim.mode = vim.lastVisual ?? "visual";
      vim.anchor = s;
      b.cursor = e ?? s;

      return false;
    }

    case "m":
      if (/[a-zA-Z]/.test(arg)) vim.marks.set(arg, { ...p });

      return false;
    case "q": {
      if (vim.recording) return false;

      if (!/[a-z0-9"]/i.test(arg)) return false;

      vim.recording = { reg: arg.toLowerCase(), keys: [], append: /[A-Z]/.test(arg) };
      out.message = `recording @${vim.recording.reg}`;

      return false;
    }

    case "@": {
      const r = arg === "@" ? vim.lastMacro : arg;
      const reg = r === null ? undefined : vim.registers.get(r);

      if (!reg) return false;

      vim.lastMacro = r;
      out.replay = { keys: tokens(reg.text), times: n };

      return false;
    }

    default:
      return null;
  }
}

/** Keys the editor acts on (definition, tabs, problems, saving, jumps), and ctrl-a / ctrl-x on a number. */
function editorCommand(cmd: Command, b: Buffer, out: FeedResult, p: Pos, n: number, key: string): Outcome | null {
  switch (key) {
    case "gd":
      out.commands.push("definition");

      return false;
    // The pane's file tabs: gt / gT (a count: that tab), ]b / [b.
    case "gt":
      out.commands.push(cmd.has ? `tab:${n}` : "next-tab");

      return false;
    case "gT":
    case "[b":
      out.commands.push(...times(n, "prev-tab"));

      return false;
    case "]b":
      out.commands.push(...times(n, "next-tab"));

      return false;
    // ]B / [B: the shown tab one place right / left (a count: that many).
    case "]B":
      out.commands.push(...times(n, "move-tab-right"));

      return false;
    case "[B":
      out.commands.push(...times(n, "move-tab-left"));

      return false;
    case "gr":
      out.commands.push("references");

      return false;
    case "K":
      out.commands.push("hover");

      return false;
    case "]d":
      out.commands.push("next-problem");

      return false;
    case "[d":
      out.commands.push("prev-problem");

      return false;
    case "gx":
      out.commands.push("open-link");

      return false;
    case "zz":
      out.commands.push("center");

      return false;
    case "ZZ":
      out.commands.push("save-quit");

      return false;
    case "ZQ":
      out.commands.push("quit!");

      return false;
    case "<C-o>":
      out.commands.push("back");

      return false;
    case "<C-g>":
      out.message = "file info";
      out.commands.push("info");

      return false;
    case "<C-a>":
    case "<C-x>": {
      const line = b.line(p.line);
      const re = /-?\d+/g;
      let m = re.exec(line);

      while (m && m.index + m[0].length <= p.col) m = re.exec(line);

      if (!m) return false;

      const v = Number(m[0]) + (key === "<C-a>" ? n : -n);

      b.replace({ line: p.line, col: m.index }, { line: p.line, col: m.index + m[0].length }, String(v));
      b.cursor = { line: p.line, col: m.index + String(v).length - 1 };

      return true;
    }

    default:
      return null;
  }
}
