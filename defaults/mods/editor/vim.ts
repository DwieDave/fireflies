// Vim for the editor: a state machine over the text, no app calls, so
// scripts/nocturne-vim.test.ts can drive it key by key. The editor hands it
// every keystroke first (EditorState.on("key")); it answers whether it took
// the key and what to do: edits, where the caret goes, selections, the mode
// (so the caret's shape and the bar follow), registers for the clipboard,
// and commands for the editor (save, quit, find, definition...).
//
// Behaviour follows Vim (and Zed's vim mode, whose tests guided the cases;
// no code is taken from it): normal, insert, replace, visual (char, line,
// block) modes; counts; operators d c y > < g~ gu gU with motions and text
// objects; registers "a-z (A-Z appends), "0, "_ and "+ (the system
// clipboard); . repeat; q / @ macros; m / ` ' marks; / ? n N * #; f F t T ; ,;
// the ex line (:w :q :wq :x :e! :s :%s :<line> :noh); and a leader key
// (space) whose next keys a which-key popup shows.
//
// Insert mode keeps typing native (IME, autoclose, autoindent): the keys pass
// through, and what was typed is read back from the text when insert mode
// ends, for `.` and macros.
//
// This file holds the types, the state, the key's way in (feed, play) and
// insert mode; the rest in layers, each importing only those under it:
// vim-buffer.ts (the working copy), vim-motions.ts, vim-objects.ts,
// vim-ops.ts (operators, registers), vim-parse.ts (commands from keys),
// vim-normal.ts, vim-visual.ts, vim-ex.ts (the ex line).

import type { KeyEvent } from "gpui-kit";
import type { EditorPosition } from "gpui-base";
import { isString } from "./guard.ts";
import { Buffer, cmp, maxPos, minPos } from "./vim-buffer.ts";
import { exKey } from "./vim-ex.ts";
import { normalCommand } from "./vim-normal.ts";
import { textObject } from "./vim-objects.ts";
import { isVisual, modeOf, parse, parseVisual } from "./vim-parse.ts";
import { visualCommand, visualSelections } from "./vim-visual.ts";

/** Positions are { line, col }: zero-based, columns in JS string units. */
export type Pos = EditorPosition;

/** Vim's modes: normal, insert, replace and the three visual ones (char, line, block). */
export type Mode = "normal" | "insert" | "replace" | "visual" | "vline" | "vblock";

/** A key as vim takes it: a token (`x`, `<esc>`, `<C-r>`), or text a replay inserts. */
export type Key = string | Insertion;

/** Text typed in insert mode, replayed as one insertion (`.`, a macro). */
export interface Insertion {
  readonly insert: string;
}

/** A register's text and whether it holds whole lines. */
export interface Register {
  readonly text: string;
  readonly linewise: boolean;
}

/** f F t T: to or till a character, forward or back. */
export type FindKind = "f" | "F" | "t" | "T";

/** One edit: [start, end) replaced by `text` (EditorState.edit's). */
export interface Edit {
  readonly start: Pos;
  readonly end: Pos;
  readonly text: string;
}

/** A selection; `head`: which end the caret is at (visual and line-visual). */
export interface Selection {
  readonly start: Pos;
  readonly end: Pos;
  readonly head?: "start" | "end";
}

/** What the leader's next keys can be: an entry to run [command, label], or a node of more keys. */
export type LeaderEntry = readonly [command: string, label: string];

/** A node of the leader map: its name (the which-key popup's +name) and what each key
 *  (a typed character: data) does there, in the popup's order. */
export interface LeaderNode {
  readonly name: string;
  readonly keys: ReadonlyMap<string, LeaderStep>;
}

/** What a key after the leader is: an entry to run, or a node of more keys. */
export type LeaderStep = LeaderEntry | LeaderNode;

const node = (name: string, keys: readonly (readonly [string, LeaderStep])[]): LeaderNode => ({ name, keys: new Map(keys) });

/** A key of the which-key popup and what it does. */
export interface Which {
  readonly key: string;
  readonly label: string;
}

/** The default leader map: key sequences after the leader and what they do. */
export const LEADER: LeaderNode = node("leader", [
  ["f", node("find", [["f", ["picker", "files"]], ["g", ["grep", "grep"]], ["b", ["picker", "files"]]])],
  ["e", ["files-pane", "files pane"]],
  ["w", ["save", "save"]],
  ["q", ["quit", "close"]],
  ["b", node("tabs", [["n", ["next-tab", "next tab"]], ["p", ["prev-tab", "previous tab"]], ["d", ["close-tab", "close tab"]], ["l", ["tabs", "list tabs"]], ["<", ["move-tab-left", "move tab left"]], [">", ["move-tab-right", "move tab right"]], ["o", ["pop-out", "pop out into its own pane"]], ["i", ["pop-in", "into the editor beside"]], ["m", ["tab-menu", "tab menu"]]])],
  ["d", ["problems", "problems"]],
  ["h", ["hover", "hover"]],
  ["c", node("code", [["a", ["code-action", "code action"]], ["f", ["format", "format"]]])],
  ["r", node("refactor", [["n", ["rename", "rename"]]])],
  ["g", node("go", [["d", ["definition", "definition"]], ["r", ["references", "references"]]])],
  ["?", ["keys", "keys"]],
  ["u", node("toggle", [["w", ["wrap", "word wrap"]]])],
  ["m", node("markdown", [["p", ["preview", "view: rendered / split / preview / text"]], ["r", ["preview-rendered", "rendered"]], ["s", ["preview-split", "preview beside"]], ["v", ["preview-only", "preview only"]], ["t", ["preview-text", "text only"]]])],
  // The Markdown commands (mdedit.ts), by the letters cmd-. takes (the levels first, as the popup lists them).
  [".", node("markdown commands", [
    ["0", ["md-heading-0", "text"]], ["1", ["md-heading-1", "heading 1"]], ["2", ["md-heading-2", "heading 2"]], ["3", ["md-heading-3", "heading 3"]],
    ["b", ["md-bold", "bold"]], ["i", ["md-italic", "italic"]], ["`", ["md-code", "inline code"]], ["k", ["md-link", "link"]],
    ["h", ["md-heading-up", "heading up"]], ["H", ["md-heading-down", "heading down"]],
    ["l", ["md-bullets", "bullet list"]], ["n", ["md-numbers", "numbered list"]], ["t", ["md-task", "task box"]], ["x", ["md-tick", "tick"]],
    ["q", ["md-quote", "quote"]], ["c", ["md-fence", "code block"]], ["r", ["md-rule", "rule"]], ["p", ["md-image", "image from a file"]], ["v", ["md-image-paste", "paste an image"]],
  ])],
]);

/** Where insert mode began: the text and caret then, the keys that entered it. */
export interface InsertStart {
  text: string;
  cursor: Pos;
  keys: readonly Key[];
  typed?: boolean;
}

/** A macro being recorded into register `reg` (`append`: "A-Z adds to it). */
export interface Recording {
  readonly reg: string;
  readonly keys: Key[];
  readonly append: boolean;
}

/** The state of one editor's vim. */
export interface Vim {
  mode: Mode;
  /** The pending command's keys. */
  keys: string[];
  registers: Map<string, Register>;
  marks: Map<string, Pos>;
  /** Visual mode's other end. */
  anchor: Pos | null;
  /** Visual mode's caret (the editor's sits at the selection's end). */
  head: Pos | null;
  /** The column j / k keep to. */
  goal: number | null;
  /** For `.`. */
  lastChange: { readonly keys: readonly Key[]; readonly inserted: string | null } | null;
  recording: Recording | null;
  lastMacro: string | null;
  lastFind: { readonly kind: FindKind; readonly ch: string } | null;
  search: { readonly pattern: string; readonly back: boolean } | null;
  /** The ex line being typed, or null. */
  ex: string | null;
  /** While inserting. */
  insertStart: InsertStart | null;
  leader: string;
  leaderMap: LeaderNode;
  /** The leader map node being walked. */
  pendingLeader: LeaderNode | null;
  replaying: boolean;
  message: string | null;
  lastVisual: Mode | null;
  /** What was last yanked or deleted, for the system clipboard. */
  clipboard?: Register;
  /** The editor's indent unit (its tab size), and the view: half a page, the top line, rows shown. */
  indent: string | null;
  shiftCount: number;
  page: number | null;
  top: number | null;
  rows: number | null;
}

/** What createVim takes: the leader key and its map. */
export interface VimOptions {
  readonly leader?: string;
  readonly leaderMap?: LeaderNode;
}

export function createVim(options: VimOptions = {}): Vim {
  return {
    mode: "normal",
    keys: [],
    registers: new Map(),
    marks: new Map(),
    anchor: null,
    head: null,
    goal: null,
    lastChange: null,
    recording: null,
    lastMacro: null,
    lastFind: null,
    search: null,
    ex: null,
    insertStart: null,
    leader: options.leader ?? " ",
    leaderMap: options.leaderMap ?? LEADER,
    pendingLeader: null,
    replaying: false,
    message: null,
    lastVisual: null,
    indent: null,
    shiftCount: 1,
    page: null,
    top: null,
    rows: null,
  };
}

/** Keys with a name of their own, as vim spells them. */
const NAMED: ReadonlyMap<string, string> = new Map([
  ["escape", "<esc>"],
  ["enter", "<cr>"],
  ["backspace", "<bs>"],
  ["tab", "<tab>"],
  ["up", "<up>"],
  ["down", "<down>"],
  ["left", "<left>"],
  ["right", "<right>"],
  ["delete", "<del>"],
  ["home", "<home>"],
  ["end", "<end>"],
  ["pageup", "<pgup>"],
  ["pagedown", "<pgdn>"],
  ["space", " "],
]);

/** The key a keystroke event names: a typed character, else `<esc>`,
 *  `<cr>`, `<bs>`, `<tab>`, `<C-r>`, `<up>`...; null for one vim leaves to
 *  the app (cmd combinations). */
export function token(e: KeyEvent): string | null {
  const m = e.modifiers;

  if (m.platform) return null;

  const k = e.key;
  const named = NAMED.get(k);

  if (m.control) {
    if (k === "[") return "<esc>";

    return k.length === 1 ? `<C-${k.toLowerCase()}>` : named ? `<C-${named.slice(1, -1)}>` : null;
  }

  if (m.alt) return null;

  if (named && k !== "space") return named;

  if (isString(e.key_char) && e.key_char !== "") return e.key_char;

  if (k === "space") return " ";

  return k.length === 1 ? (m.shift ? k.toUpperCase() : k) : null;
}

/** The editor's text as vim acts on it: its text and caret, the system clipboard's text,
 *  half a page, the top line and rows shown, how many tabs the pane has. */
export interface Doc {
  readonly text: string;
  readonly cursor: Pos;
  readonly clipboard?: string | null;
  readonly page?: number;
  readonly top?: number;
  readonly rows?: number;
  readonly tabs?: number;
}

/** Keys to play again: a macro, or `.` (`repeat`). */
export interface Replay {
  readonly keys: readonly Key[];
  readonly times: number;
  readonly repeat?: boolean;
}

/** What a key came to (what changed; omitted keys mean unchanged). */
export interface FeedResult {
  taken: boolean;
  commands: string[];
  edits?: Edit[];
  cursor?: Pos;
  selections?: Selection[] | null;
  mode?: Mode;
  clipboard?: Register;
  message?: string;
  ex?: string | null;
  pending?: string;
  which?: Which[] | null;
  recording?: null;
  replay?: Replay;
  multi?: Pos[];
  keepGoal?: boolean;
  search?: string;
}

/**
 * Feeds one key. `doc`: { text, cursor, clipboard? } as the editor has them
 * now. -> { taken, edits, cursor, selections, mode, commands, clipboard,
 * message, ex, pending, which } (what changed; omitted keys mean unchanged).
 */
export function feed(vim: Vim, key: Key | null | undefined, doc: Doc): FeedResult {
  const out: FeedResult = { taken: true, commands: [] };

  if (key === null || key === undefined) return { taken: false, commands: [] };

  // Macro recording (not of the q that ends it).
  if (vim.recording && !vim.replaying && !(vim.mode !== "insert" && vim.keys.length === 0 && key === "q")) vim.recording.keys.push(key);

  if (vim.ex !== null) return exKey(vim, vim.ex, key, doc, out);

  if (vim.mode === "insert" || vim.mode === "replace") return insertKey(vim, key, doc, out);

  // Text to insert only comes while inserting (a replay's).
  if (!isString(key)) return out;

  // In visual modes the editor's caret sits at the selection's end, not on
  // vim's head: the head is vim's own.
  const visual = isVisual(vim.mode);
  const b = new Buffer(doc.text, visual && vim.head ? vim.head : doc.cursor);

  vim.page = doc.page ?? vim.page;
  vim.top = doc.top ?? vim.top;
  vim.rows = doc.rows ?? vim.rows;

  if (vim.pendingLeader) return leaderKey(vim, vim.pendingLeader, key, out);

  if (vim.keys.length === 0 && key === vim.leader && vim.mode === "normal") {
    vim.pendingLeader = vim.leaderMap;
    out.which = whichOf(vim.pendingLeader);

    return out;
  }

  if (key === "<esc>") return escape(vim, b, out);

  if (key === ":" && vim.keys.length === 0) return openEx(vim, b, out);

  if ((key === "/" || key === "?") && vim.keys.length === 0) {
    vim.ex = key;
    out.ex = key;

    return out;
  }

  // q ends a recording.
  if (vim.recording && vim.keys.length === 0 && key === "q" && vim.mode === "normal") {
    out.message = `recorded @${stopRecording(vim) ?? ""}`;
    out.recording = null;

    return out;
  }

  vim.keys.push(key);

  // Visual mode: i / a then an object extends the selection over it (viw, va").
  if ((vim.mode === "visual" || vim.mode === "vline") && (vim.keys[0] === "i" || vim.keys[0] === "a")) return visualObject(vim, b, out);

  const cmd = isVisual(vim.mode) ? parseVisual(vim.keys) : parse(vim.keys);

  if (cmd === null) {
    out.pending = vim.keys.join("");

    return out;
  }

  const keys = vim.keys;

  vim.keys = [];
  out.pending = "";

  if (cmd === false) return out;

  const before = { ...b.cursor };
  const result = vim.mode.startsWith("v") ? visualCommand(vim, cmd, b, doc, out) : normalCommand(vim, cmd, b, doc, out);

  if (result === "unknown") {
    out.taken = !(keys.length === 1 && (keys[0] ?? "").startsWith("<C-"));

    return out;
  }

  // Only a change counts for `.` (not undo, `.` itself, motions or yanks).
  const changed = result === true;
  // The mode the command left (it may have entered insert mode).
  const mode = modeOf(vim);

  if (changed && !vim.replaying && mode !== "insert") vim.lastChange = { keys, inserted: null };

  if (changed && mode === "insert" && vim.insertStart) vim.insertStart.keys = keys;

  out.edits = b.edits;

  if (mode === "normal" || mode === "insert" || mode === "replace") out.cursor = mode === "normal" ? b.clamp(b.cursor) : b.clamp(b.cursor, true);
  else out.cursor = b.cursor;

  if (cmp(before, b.cursor) !== 0 && !out.keepGoal) vim.goal = null;

  out.mode = vim.mode;

  if (isVisual(vim.mode)) {
    out.selections = visualSelections(vim.mode, vim.anchor ?? b.cursor, b);
    vim.head = { ...b.cursor };
  } else vim.head = null;

  return out;
}

/** Escape: back to normal mode, the keys typed so far dropped. */
function escape(vim: Vim, b: Buffer, out: FeedResult): FeedResult {
  vim.keys = [];

  if (vim.mode !== "normal") {
    vim.mode = "normal";
    vim.anchor = null;
    vim.head = null;
    out.mode = "normal";
    out.cursor = b.clamp(b.cursor);
    out.selections = null;
  }

  out.taken = true;
  out.pending = "";

  return out;
}

/** `:` opens the ex line (from visual mode: on the selection's lines, '<,'>). */
function openEx(vim: Vim, b: Buffer, out: FeedResult): FeedResult {
  vim.ex = vim.mode.startsWith("v") ? "'<,'>" : "";

  if (vim.mode !== "normal") {
    const anchor = vim.anchor ?? b.cursor;

    vim.marks.set("<", minPos(anchor, b.cursor));
    vim.marks.set(">", maxPos(anchor, b.cursor));
  }

  out.ex = vim.ex;

  return out;
}

/** Visual mode: i / a then an object extends the selection over it (viw, va"). */
function visualObject(vim: Vim, b: Buffer, out: FeedResult): FeedResult {
  const [ia, obj] = vim.keys;

  if (obj === undefined) {
    out.pending = vim.keys.join("");

    return out;
  }

  vim.keys = [];

  const r = textObject(b, b.cursor, ia === "a", obj, 1);

  if (r) {
    if (r.linewise && vim.mode === "visual") vim.mode = "vline";

    vim.anchor = r.start;
    b.cursor = cmp(r.end, r.start) > 0 ? (b.prev(r.end) ?? r.end) : r.end;
  }

  out.cursor = b.cursor;
  out.mode = vim.mode;
  out.selections = visualSelections(vim.mode, vim.anchor ?? b.cursor, b);
  out.pending = "";
  vim.head = { ...b.cursor };

  return out;
}

function whichOf(at: LeaderNode): Which[] {
  return [...at.keys].map(([k, v]) => ({ key: k === " " ? "space" : k, label: isEntry(v) ? v[1] : `+${v.name}` }));
}

/** A leader entry to run, not a node of more keys. */
const isEntry = (step: LeaderStep): step is LeaderEntry => Array.isArray(step);

function leaderKey(vim: Vim, at: LeaderNode, key: string, out: FeedResult): FeedResult {
  if (key === "<esc>") {
    vim.pendingLeader = null;
    out.which = null;

    return out;
  }

  const next = at.keys.get(key);

  if (next === undefined) {
    vim.pendingLeader = null;
    out.which = null;
    out.message = `leader: nothing on ${key}`;

    return out;
  }

  if (isEntry(next)) {
    vim.pendingLeader = null;
    out.which = null;
    out.commands.push(next[0]);

    return out;
  }

  vim.pendingLeader = next;
  out.which = whichOf(next);

  return out;
}

function insertKey(vim: Vim, key: Key, doc: Doc, out: FeedResult): FeedResult {
  if (vim.insertStart && !vim.replaying) vim.insertStart.typed = true;

  if (key === "<esc>") {
    // What was typed since insert mode began, for `.` and macros: the text
    // that differs between then and now, as one insertion at the start.
    const st = vim.insertStart;
    const inserted = st ? typedText(st.text, doc.text) : "";

    if (st && !vim.replaying) vim.lastChange = { keys: st.keys, inserted };

    vim.mode = "normal";
    vim.insertStart = null;

    const b = new Buffer(doc.text, doc.cursor);

    out.cursor = b.clamp({ line: doc.cursor.line, col: Math.max(0, doc.cursor.col - 1) });
    out.mode = "normal";
    out.selections = null;

    return out;
  }

  // Replaying (a macro, `.`): the editor doesn't type, so the keys become edits.
  if (vim.replaying) {
    const b = new Buffer(doc.text, doc.cursor);

    if (!isString(key)) b.cursor = b.replace(b.cursor, b.cursor, key.insert);
    else if (key === "<cr>") b.cursor = b.replace(b.cursor, b.cursor, "\n" + (b.line(b.cursor.line).match(/^\s*/)?.[0] ?? ""));
    else if (key === "<bs>") {
      const pr = b.prev(b.cursor);

      if (pr) {
        b.replace(pr, b.cursor, "");
        b.cursor = pr;
      }
    } else if (key === "<tab>") b.cursor = b.replace(b.cursor, b.cursor, vim.indent ?? "  ");
    else if ([...key].length === 1) {
      if (vim.mode === "replace" && b.cursor.col < b.len(b.cursor.line)) b.cursor = b.replace(b.cursor, { line: b.cursor.line, col: b.cursor.col + 1 }, key);
      else b.cursor = b.replace(b.cursor, b.cursor, key);
    }

    out.edits = b.edits;
    out.cursor = b.cursor;

    return out;
  }

  if (vim.mode === "replace" && isString(key) && [...key].length === 1) {
    // Overtype: the editor would insert; replace the next character instead.
    const b = new Buffer(doc.text, doc.cursor);

    if (b.cursor.col < b.len(b.cursor.line)) {
      b.replace(b.cursor, { line: b.cursor.line, col: b.cursor.col + 1 }, key);
      out.edits = b.edits;
      out.cursor = { line: b.cursor.line, col: b.cursor.col + 1 };

      return out;
    }
  }

  // Everything else is the editor's: typing, IME, arrows, backspace.
  out.taken = false;

  return out;
}

/** The text inserted between `before` and `after` (one contiguous change). */
export function typedText(before: string, after: string): string {
  let s = 0;

  while (s < before.length && s < after.length && before[s] === after[s]) s++;

  let e = 0;

  while (e < before.length - s && e < after.length - s && before[before.length - 1 - e] === after[after.length - 1 - e]) e++;

  return after.slice(s, after.length - e);
}

/** Ends a macro recording: the register gets the keys. -> the register name. */
export function stopRecording(vim: Vim): string | null {
  const r = vim.recording;

  if (!r) return null;

  vim.recording = null;

  const text = r.keys.map((k) => (isString(k) ? k : k.insert)).join("");
  const prev = r.append ? (vim.registers.get(r.reg)?.text ?? "") : "";

  vim.registers.set(r.reg, { text: prev + text, linewise: false });

  return r.reg;
}

/** The caret's shape for a mode. */
// Visual modes: a bar, where the editor draws its caret (the selection's edge).
export const CARET = { normal: "block", visual: "bar", vline: "bar", vblock: "bar", insert: "bar", replace: "underline" } as const satisfies Readonly<Record<Mode, "block" | "bar" | "underline">>;

/** The mode's name in the bar. */
export const MODE_NAME = { normal: "NORMAL", insert: "INSERT", replace: "REPLACE", visual: "VISUAL", vline: "V-LINE", vblock: "V-BLOCK" } as const satisfies Readonly<Record<Mode, string>>;

/** Applies edits to a text, in order (each one against the text after the previous); for tests and replays. */
export function applyEdits(text: string, edits: readonly Edit[] | null | undefined): string {
  const b = new Buffer(text, { line: 0, col: 0 });

  for (const e of edits ?? []) b.replace(e.start, e.end, e.text);

  return b.all();
}

/** What playing keys came to: the edits in order, the caret, the mode, the selections,
 *  commands, the clipboard, a message and the text after them. */
export interface Played {
  edits: Edit[];
  commands: string[];
  cursor: Pos;
  mode: Mode;
  selections?: Selection[] | null;
  clipboard?: Register;
  message?: string;
  text?: string;
}

/** Plays keys (a macro, `.`) `times` times against `doc` as if typed, with
 *  insert-mode text applied as edits: -> the edits in order, the final
 *  caret, mode and selections, commands and messages. */
export function play(vim: Vim, keys: readonly Key[], doc: Doc, times = 1): Played {
  let text = doc.text;
  let cursor = { ...doc.cursor };
  const res: Played = { edits: [], commands: [], cursor, mode: vim.mode };
  const was = vim.replaying;

  vim.replaying = true;

  try {
    for (let i = 0; i < times; i++) {
      for (const k of keys) {
        const r = feed(vim, k, { ...doc, text, cursor });

        absorb(res, r);

        if (r.edits?.length) text = applyEdits(text, r.edits);

        if (r.cursor) cursor = r.cursor;

        if (r.replay) {
          const nested = play(vim, r.replay.keys, { ...doc, text, cursor }, r.replay.times);

          absorb(res, nested);

          if (nested.edits.length) text = applyEdits(text, nested.edits);

          cursor = nested.cursor;
        }
      }
    }
  } finally {
    vim.replaying = was;
  }

  res.cursor = cursor;
  res.mode = vim.mode;
  res.text = text;

  return res;
}

function absorb(res: Played, r: Pick<FeedResult, "edits" | "commands" | "selections" | "clipboard" | "message">): void {
  if (r.edits?.length) res.edits.push(...r.edits);

  if (r.commands.length) res.commands.push(...r.commands);

  if (r.selections !== undefined) res.selections = r.selections;

  if (r.clipboard !== undefined) res.clipboard = r.clipboard;

  if (r.message !== undefined) res.message = r.message;
}
