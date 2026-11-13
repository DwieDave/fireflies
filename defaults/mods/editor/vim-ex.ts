// Vim's ex line (vim.ts): the keys typed after `:` / `?`, and a line run:
// :w :q :wq :x :e! :s :%s :<line> :noh and the rest.

import { isString } from "./guard.ts";
import type { Doc, FeedResult, Key, Vim } from "./vim.ts";
import { Buffer } from "./vim-buffer.ts";
import { pattern, searchFrom } from "./vim-motions.ts";
import { normalCommand } from "./vim-normal.ts";
import { clipboardTo, deleteLines, setReg } from "./vim-ops.ts";
import { visualSelections } from "./vim-visual.ts";

// ---- the ex line

export function exKey(vim: Vim, ex: string, key: Key, doc: Doc, out: FeedResult): FeedResult {
  if (key === "<esc>") {
    vim.ex = null;
    out.ex = null;

    return out;
  }

  if (key === "<bs>") {
    vim.ex = !ex.length || ex === "/" || ex === "?" ? null : ex.slice(0, -1);
    out.ex = vim.ex;

    return out;
  }

  if (key === "<cr>") {
    vim.ex = null;
    out.ex = null;

    return runEx(vim, ex, doc, out);
  }

  if (isString(key) && [...key].length === 1) vim.ex = ex + key;
  else if (key === "<tab>") vim.ex = ex + "\t";

  out.ex = vim.ex;

  return out;
}

/** Runs an ex line (`:w`, `:%s/a/b/g`, `/pattern`...). */
export function runEx(vim: Vim, line: string, doc: Doc, out: FeedResult): FeedResult {
  const b = new Buffer(doc.text, doc.cursor);

  if (line.startsWith("/") || line.startsWith("?")) return exSearch(vim, line, b, out);

  const wasVisual = vim.mode !== "normal" && vim.mode !== "insert";

  if (wasVisual) {
    vim.mode = "normal";
    vim.anchor = null;
    out.mode = "normal";
    out.selections = null;
  }

  const { from, to, rest } = exRange(vim, b, line);

  const parts = /^([a-zA-Z]*)(!?)\s*(.*)$/s.exec(rest);
  const name = parts ? (parts[1] ?? "") : rest;
  const bang = parts?.[2] ?? "";
  const arg = parts?.[3] ?? "";

  if (!name && from !== null) {
    out.cursor = b.firstNonBlank(Math.max(0, Math.min(b.last, to ?? 0)));
    vim.marks.set("`", { ...b.cursor });

    return out;
  }

  const one = from ?? b.cursor.line;
  const two = to ?? one;

  return fileEx(out, name, bang, arg) ?? tabEx(out, name, bang, arg) ?? editEx(vim, line, doc, out, b, name, one, two) ?? substituteEx(vim, line, out, b, rest, name, arg, one, two) ?? settingEx(out, name, arg) ?? notACommand(out, line);
}

/** `/pattern` or `?pattern` typed on the ex line: the caret to the next match (back for `?`); visual mode keeps its selection. */
function exSearch(vim: Vim, line: string, b: Buffer, out: FeedResult): FeedResult {
  const back = line[0] === "?";
  const pat = line.slice(1) || vim.search?.pattern;

  if (!pat) return out;

  vim.search = { pattern: pat, back };

  const to = searchFrom(b, b.cursor, pat, back, 1);

  if (!to) {
    out.message = `not found: ${pat}`;

    return out;
  }

  vim.marks.set("`", { ...b.cursor });
  out.cursor = to;
  out.search = pat;

  if (vim.mode !== "normal") {
    b.cursor = to;
    out.selections = visualSelections(vim.mode, vim.anchor ?? to, b);
  }

  return out;
}

/** An ex line's range and what follows it. */
interface ExRange {
  readonly from: number | null;
  readonly to: number | null;
  readonly rest: string;
}

/** Reads the range an ex line starts with: %, ., $, numbers, '<,'>, 'a, +n, -n. */
function exRange(vim: Vim, b: Buffer, line: string): ExRange {
let rest = line.trim();

// A range: %, ., $, numbers, '<,'>, 'a, +n, -n.
const addr = (): number | null | undefined => {
  const digits = /^(\d+)/.exec(rest);

  if (digits) {
    rest = rest.slice(digits[0].length);

    return Number(digits[1]) - 1;
  }

  if (rest[0] === ".") {
    rest = rest.slice(1);

    return b.cursor.line;
  }

  if (rest[0] === "$") {
    rest = rest.slice(1);

    return b.last;
  }

  const mark = /^'([a-z<>])/.exec(rest);

  if (mark) {
    rest = rest.slice(2);

    return vim.marks.get(mark[1] ?? "")?.line ?? null;
  }

  return undefined;
};

let from: number | null = null;
let to: number | null = null;

if (rest[0] === "%") {
  from = 0;
  to = b.last;
  rest = rest.slice(1);
} else {
  const a = addr();

  if (a !== undefined) {
    from = a;
    to = a;

    for (let m = /^([+-])(\d*)/.exec(rest); m?.[0]; m = /^([+-])(\d*)/.exec(rest)) {
      const d = Number(m[2] || 1) * (m[1] === "+" ? 1 : -1);

      from = (to ?? b.cursor.line) + d;
      to = from;
      rest = rest.slice(m[0].length);
    }

    if (rest[0] === ",") {
      rest = rest.slice(1);

      const c = addr();

      to = c === undefined ? from : c;
    }
  }
}

  return { from, to, rest };
}

/** Writing, quitting, reloading, :noh. */
function fileEx(out: FeedResult, name: string, bang: string, arg: string): FeedResult | null {
  switch (name) {
    case "w":
    case "write":
      out.commands.push(arg ? `write:${arg}` : "save");

      return out;
    case "wq":
    case "x":
    case "xit":
    case "exit":
      out.commands.push("save-quit");

      return out;
    case "q":
    case "quit":
    case "close":
      out.commands.push(bang ? "quit!" : "quit");

      return out;
    case "wa":
    case "wall":
      out.commands.push("save");

      return out;
    case "e":
    case "edit":
      out.commands.push(arg ? `edit:${arg}` : bang ? "reload!" : "reload");

      return out;
    case "noh":
    case "nohlsearch":
      out.commands.push("nohlsearch");

      return out;
    // The pane's file tabs, as buffers: :bn :bp :bd(!) :b N :ls, and :tabn :tabp :tabc.
    default:
      return null;
  }
}

/** The pane's file tabs: next, previous, close, pop out / in, move, go to, list. */
function tabEx(out: FeedResult, name: string, bang: string, arg: string): FeedResult | null {
  switch (name) {
    case "bn":
    case "bnext":
    case "tabn":
    case "tabnext":
      out.commands.push("next-tab");

      return out;
    case "bp":
    case "bprevious":
    case "bN":
    case "bNext":
    case "tabp":
    case "tabprevious":
    case "tabN":
      out.commands.push("prev-tab");

      return out;
    case "bd":
    case "bdelete":
    case "bw":
    case "bwipeout":
    case "tabc":
    case "tabclose":
      out.commands.push(bang ? "close-tab!" : "close-tab");

      return out;
    // :popout (the shown tab into a pane of its own beside), :popin (into the editor beside).
    case "popout":
    case "popo":
      out.commands.push("pop-out");

      return out;
    case "popin":
    case "popi":
      out.commands.push("pop-in");

      return out;
    // :tabm N (that place, 0 the first), :tabm +N / -N (that many right / left), :tabm (the end).
    case "tabm":
    case "tabmove": {
      const a = arg.trim();

      if (a && !/^[+-]?\d+$/.test(a)) {
        out.message = "E474: :tabm takes N, +N or -N";

        return out;
      }

      out.commands.push(`move-tab:${a || "$"}`);

      return out;
    }

    case "b":
    case "buffer":
      if (!/^\d+$/.test(arg.trim())) {
        out.message = "E94: :b takes a tab number (:ls lists them)";

        return out;
      }

      out.commands.push(`tab:${arg.trim()}`);

      return out;
    case "ls":
    case "buffers":
    case "files":
      out.commands.push("tabs");

      return out;
    default:
      return null;
  }
}

/** Edits over the range: undo, redo, delete, yank, join. */
function editEx(vim: Vim, line: string, doc: Doc, out: FeedResult, b: Buffer, name: string, one: number, two: number): FeedResult | null {
  switch (name) {
    case "u":
    case "undo":
      out.commands.push("undo");

      return out;
    case "red":
    case "redo":
      out.commands.push("redo");

      return out;
    case "d":
    case "delete": {
      setReg(vim, null, b.text({ line: one, col: 0 }, { line: two, col: b.len(two) }) + "\n", true, "delete");
      clipboardTo(out, vim);
      deleteLines(b, Math.min(one, two), Math.max(one, two));
      out.edits = b.edits;
      out.cursor = b.firstNonBlank(Math.min(one, b.last));

      return out;
    }

    case "y":
    case "yank":
      setReg(vim, null, b.text({ line: one, col: 0 }, { line: two, col: b.len(two) }) + "\n", true, "yank");
      clipboardTo(out, vim);

      return out;
    case "j":
    case "join": {
      b.cursor = { line: Math.min(one, two), col: 0 };
      normalCommand(vim, { done: true, reg: null, key: "J", count: Math.max(2, Math.abs(two - one) + 1), has: false }, b, doc, out);
      out.edits = b.edits;
      out.cursor = b.cursor;

      return out;
    }

    default:
      return null;
  }
}

/** :s / :%s (and :&-less `:/a/b/`): replace a pattern on the range's lines. */
function substituteEx(vim: Vim, line: string, out: FeedResult, b: Buffer, rest: string, name: string, arg: string, one: number, two: number): FeedResult | null {
  switch (name) {
    case "s":
    case "substitute":
    case "": {
      if (name === "" && !arg) return out;

      const sub = /^([^\w\s\\])((?:\\.|(?!\1).)*)\1((?:\\.|(?!\1).)*)(?:\1([gci]*))?$/s.exec(name === "" ? rest : arg);

      if (!sub) {
        out.message = "E486: substitute needs /pattern/replacement/";

        return out;
      }

      const pat = sub[2] ?? "";
      const rep = sub[3] ?? "";
      const flags = sub[4] ?? "";
      const re = pattern(pat || vim.search?.pattern || "");
      const global = flags.includes("g");
      const ignore = flags.includes("i");
      const rx = new RegExp(re.source, (global ? "g" : "") + (ignore || re.flags.includes("i") ? "i" : ""));

      const replacement = rep
        .replace(/\\(\d)/g, "$$$1")
        .replace(/(^|[^\\])&/g, "$1$$&")
        .replace(/\\&/g, "&")
        .replace(/\\n/g, "\n")
        .replace(/\\\//g, "/");

      let count = 0;
      let lastLine: number | null = null;

      for (let l = Math.min(one, two); l <= Math.max(one, two) && l <= b.last; l++) {
        const old = b.line(l);

        const next = old.replace(rx, (found: string) => {
          count++;

          return found.replace(new RegExp(rx.source, rx.flags.replace("g", "")), replacement);
        });

        if (next !== old) {
          b.replace({ line: l, col: 0 }, { line: l, col: old.length }, next);
          lastLine = l + (next.split("\n").length - 1);
          l += next.split("\n").length - 1;
        }
      }

      if (pat) vim.search = { pattern: pat, back: false };

      if (!count) {
        out.message = `pattern not found: ${pat}`;

        return out;
      }

      out.edits = b.edits;
      out.cursor = b.firstNonBlank(lastLine ?? b.cursor.line);
      out.message = `${count} substitution${count === 1 ? "" : "s"}`;

      return out;
    }

    default:
      return null;
  }
}

/** Settings the editor applies: :set, :vim / :novim. */
function settingEx(out: FeedResult, name: string, arg: string): FeedResult | null {
  switch (name) {
    case "set":
      out.commands.push(`set:${arg}`);

      return out;
    case "vim":
    case "novim":
      out.commands.push("vim");

      return out;
    default:
      return null;
  }
}

/** A line that names no command: says so. */
function notACommand(out: FeedResult, line: string): FeedResult {
  out.message = `E492: not an editor command: ${line}`;

  return out;
}
