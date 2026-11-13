// Vim in the editor pane (vim.ts is the machine): switching it, a key fed
// to it and what it answers applied, its commands for the editor, the
// references and formatting it asks for.

import type EditorPane from "./main.ts";
import { isString, object } from "./guard.ts";
import { isList } from "./guards.ts";
import { basename, dirname, uri } from "./logic.ts";
import { firstLocation, isLocations } from "./lsp-replies.ts";
import { editBetween } from "./md-text.ts";
import { join } from "./paths.ts";
import { beginInsert } from "./vim-ops.ts";
import type { Doc as VimDoc, FeedResult, Played } from "./vim.ts";
import { applyEdits, CARET, feed, play, token } from "./vim.ts";
import type { Context, KeyEvent } from "gpui-kit";
import { home, lspRequest, run, settings, setUnsaved, window as appWindow } from "herdr";
import { BAR, errorText, HINTS, isLspPos, serverId, whereArgs } from "./pane-kit.ts";
import { appKey, cardKeyDown, later } from "./card.ts";
import { format, loadDoc, save } from "./file-io.ts";
import { mdMenuKey, openMdMenu, runMdCommand } from "./md-pane.ts";
import { askKey } from "./pane-lines.ts";
import { closeTab, ownPane, popIn, popOut, select, stepMove, stepShownTab } from "./pane-tabs.ts";
import { imagePasteKey } from "./preview-pane.ts";

/** cmd-. (ctrl-. off the Mac): the Markdown commands' list. */
export function isMdMenuKey(e: KeyEvent): boolean {
  const m = e.modifiers;
  const mod = appWindow().platform === "macos" ? m.platform && !m.control : m.control && !m.platform;

  return e.key === "." && mod && !m.alt && !m.shift;
}

/** A server's formatting answer: edits in LSP ranges. */
export const isTextEdits = (value: unknown): value is readonly { readonly range: { readonly start: { readonly line: number; readonly character: number }; readonly end: { readonly line: number; readonly character: number } }; readonly newText: string }[] =>
  isList(value) && value.every((e) => isTextEdit(e));

export const isTextEdit = object({ range: object({ start: isLspPos, end: isLspPos }), newText: isString });

/** Vim in this pane: its own switch when flipped (remembered for the pane),
 *  else settings.json's default `editor.vim` (on unless false). */
export function vimOn(ed: EditorPane): boolean {
  return ed.paneVim ?? settings().editor.vim !== false;
}

/** The pane's switch (the vim chip, cmd-k v, :novim): this pane only. */
export function toggleVim(ed: EditorPane, cx: Context): void {
  const on = !ed.vimOn();

  ed.paneVim = on;

  try {
    localStorage.setItem("vim", on ? "on" : "off");
  } catch {
    /* a nicety */
  }

  vimSettled(ed, on);
  ed.say(on ? "vim on in this pane" : "vim off in this pane");
  cx.notify();
}

/** Word wrap on or off in the shown tab (cmd-k z, space u w, :set wrap, the bar's chip). */
export function setWrap(ed: EditorPane, on: boolean | null, cx: Context): void {
  ed.softWrap = on === null ? !ed.softWrap : on;
  ed.editor.set_soft_wrap(ed.softWrap);
  ed.say(ed.softWrap ? "word wrap on" : "word wrap off");
  cx.notify();
}

/** Vim's state when it's turned on or off. */
export function vimSettled(ed: EditorPane, on: boolean): void {
  ed.vim.mode = "normal";
  ed.vim.keys = [];
  ed.vim.ex = null;
  ed.vim.pendingLeader = null;
  ed.which = null;
  ed.pending = "";
  ed.editor.set_cursor_shape(on ? CARET.normal : "bar");
  ed.vimWas = on;
}

/** A keystroke, before the editor sees it: vim's, or the editor's (false). */
export function vimKey(ed: EditorPane, e: KeyEvent, cx: Context): boolean {
  if (ed.asking && askKey(ed, e, cx)) return true;

  // The Markdown commands' list (cmd-.): its letter runs one.
  if (ed.mdMenu) return mdMenuKey(ed, e, cx);

  if (ed.markdown && isMdMenuKey(e)) {
    openMdMenu(ed, cx);

    return true;
  }

  if (cardKeyDown(ed, e, cx)) return true;

  if (appKey(ed, e)) return true;

  if (ed.markdown && !ed.mode && imagePasteKey(ed, e, cx)) return true;

  if (!ed.vimOn() || ed.state === "loading" || ed.mode) return false;

  const k = token(e);

  if (k === null) return false;

  if (k === "<cr>" && renderedEnter(ed, cx)) return true;

  const doc = vimDoc(ed, cx);
  const r = feed(ed.vim, k, doc);

  if (!r.taken) return false;

  vimApply(ed, r, doc, cx);

  if (r.replay) {
    const now = vimDoc(ed, cx);

    vimApply(ed, play(ed.vim, r.replay.keys, now, r.replay.times), now, cx);
  }

  cx.notify();

  return true;
}

/** Vim's enter in the rendered view, normal mode with nothing pending: not the `<cr>` motion
 *  (the caret dropping onto the blank line between blocks looked like nothing) but a new block
 *  below the lit one, typed into (rendered.ts enterBelow); `.` appends it again (as `A`). */
export function renderedEnter(ed: EditorPane, cx: Context): boolean {
  const d = ed.cur;
  const v = ed.vim;
  const rendered = d?.view === "rendered" ? d.rendered : null;

  if (!d || !rendered || v.mode !== "normal" || v.keys.length || v.ex !== null || v.pendingLeader || v.replaying) return false;

  const text = d.editor.value();
  const line = rendered.range.to;
  const end = { line, col: (text.split("\n")[line] ?? "").replace(/\r$/, "").length };

  beginInsert(v, text, end, ["A"]);

  if (!rendered.enterBelow(cx)) {
    v.mode = "normal";
    v.insertStart = null;

    return false;
  }

  cx.notify();

  return true;
}

/** The text as vim acts on it (vim.ts Doc): the text, the caret, the clipboard, the screen, the tabs. */
export function vimDoc(ed: EditorPane, cx: Context): VimDoc {
  if (!ed.text && ed.state === "ready") ed.text = ed.editor.value();

  const lines = Math.max(4, Math.floor((ed.size.height - BAR - HINTS) / 20 / 2));
  let clipboard: string | null = null;

  try {
    clipboard = cx.read_from_clipboard() ?? null;
  } catch {
    /* no clipboard */
  }

  // The screen's lines (H M L) and the tabs (H / L step them when there are several).
  let top = 0;

  try {
    top = Number(ed.editor.top_line()) || 0;
  } catch {
    /* the first line */
  }

  return { text: ed.text, cursor: ed.editor.cursor(), clipboard, page: lines, top, rows: 2 * lines, tabs: ed.allDocs().length };
}

/** What vim decided: one undoable edit for all its edits, the caret,
 *  selections, the mode's caret shape, the clipboard, commands. */
export function vimApply(ed: EditorPane, r: FeedResult | Played, doc: VimDoc, cx: Context): void {
  if (r.edits?.length) {
    const after = applyEdits(doc.text, r.edits);
    const d = editBetween(doc.text, after);

    if (d) ed.editor.edit([d]);

    ed.text = after;
  }

  const multi = "multi" in r ? r.multi : undefined;

  if (multi) ed.editor.set_selections(multi.map((p) => ({ start: p, end: p })));
  else if (r.selections) ed.editor.set_selections(r.selections.map((s) => (s.head === "start" ? { start: s.end, end: s.start } : { start: s.start, end: s.end })));
  else if (r.cursor) ed.editor.set_cursor(r.cursor.line, r.cursor.col);

  if (r.mode) ed.editor.set_cursor_shape(CARET[r.mode]);

  if (r.clipboard) cx.write_to_clipboard(r.clipboard.text);

  if ("which" in r && r.which !== undefined) ed.which = r.which;

  if ("pending" in r && r.pending !== undefined) ed.pending = r.pending;

  if (r.message) ed.say(r.message, /^E\d/.test(r.message) || r.message.startsWith("not found"));

  if ("search" in r && r.search) {
    ed.searchMark = r.search;
    ed.find = ed.editor.find(r.search.replace(/\\[<>]/g, ""), {});
  }

  for (const c of r.commands) vimCommand(ed, c, cx);
}

export function vimCommand(ed: EditorPane, c: string, cx: Context): void {
  const colon = c.indexOf(":");
  const name = colon >= 0 ? c.slice(0, colon) : c;
  const arg = colon >= 0 ? c.slice(colon + 1) : null;

  const closeHere = (confirmed: boolean): void => {
    const me = ownPane(ed);

    run("pane.close", confirmed ? { ...whereArgs(me?.pane, null), confirmed: true } : whereArgs(me?.pane, null));
  };

  // :q closes the pane with every tab: none may hold unsaved changes (:q! drops them).
  const edited = (): string[] => ed.allDocs().flatMap((d) => (d.dirty ? [basename(d.path)] : []));

  if (fileVimCommand(ed, cx, name, arg, closeHere, edited)) return;

  if (tabVimCommand(ed, cx, name, arg)) return;

  if (otherVimCommand(ed, cx, name, arg)) return;

  // space . and a letter: a Markdown command (mdedit.ts).
  if (name.startsWith("md-")) runMdCommand(ed, name.slice(3), cx);
}

/** Saving, quitting, reloading, :e. -> whether it was one of these. */
function fileVimCommand(ed: EditorPane, cx: Context, name: string, arg: string | null, closeHere: (confirmed: boolean) => void, edited: () => string[]): boolean {
  switch (name) {
    case "save":
      void save(ed, cx);

      return true;
    case "save-quit":
      void save(ed, cx).then(() => {
        if (!edited().length) closeHere(false);
        else ed.say(`E37: unsaved changes in ${edited().join(", ")}`, true);
      });

      return true;
    case "quit":
      if (edited().length) {
        ed.say(`E37: unsaved changes in ${edited().join(", ")} (:q! discards them)`, true);

        return true;
      }

      closeHere(false);

      return true;
    case "quit!":
      for (const d of ed.allDocs()) d.dirty = false;

      setUnsaved(null);

      closeHere(true);

      return true;
    case "reload":
      if (ed.dirty) {
        ed.say("E37: unsaved changes (:e! discards them)", true);

        return true;
      }

      loadDoc(ed, cx, null, false);

      return true;
    case "reload!":
      ed.dirty = false;

      loadDoc(ed, cx, null, false);

      return true;
    // :e file opens it as a tab here.
    case "edit": {
      const file = arg ?? "";

      ed.openFile(file.startsWith("/") ? file : file.startsWith("~/") ? `${home()}/${file.slice(2)}` : join(dirname(ed.path), file), cx);

      return true;
    }

    default:
      return false;
  }
}

/** The pane's tabs: step, go to, close, move, pop out / in, the menu, the list. -> whether it was one of these. */
function tabVimCommand(ed: EditorPane, cx: Context, name: string, arg: string | null): boolean {
  switch (name) {
    case "next-tab":
      stepShownTab(ed, 1, cx);

      return true;
    case "prev-tab":
      stepShownTab(ed, -1, cx);

      return true;
    case "tab": {
      const n = Number(arg);
      const d = ed.docs[n - 1];

      if (!(n >= 1 && n <= ed.docs.length) || !d) {
        ed.say(`E86: no tab ${arg ?? ""}`, true);

        return true;
      }

      select(ed, d, cx);

      return true;
    }

    case "close-tab":
      closeTab(ed, cx);

      return true;
    case "close-tab!":
      closeTab(ed, cx, ed.cur, true);

      return true;
    case "move-tab-left":
      stepMove(ed, -1, cx);

      return true;
    case "move-tab-right":
      stepMove(ed, 1, cx);

      return true;
    case "move-tab":
      stepMove(ed, 0, cx, arg);

      return true;
    case "pop-out":
      popOut(ed, cx);

      return true;
    case "pop-out-tab":
      popOut(ed, cx, ed.cur, "tab");

      return true;
    case "pop-in":
      popIn(ed, cx);

      return true;
    case "tab-menu":
      ed.openTabMenu(cx);

      return true;
    case "tabs":
      ed.say(ed.docs.map((d, i) => `${i + 1}${d === ed.cur ? "%" : ""} ${basename(d.path)}${d.dirty ? " +" : ""}`).join("  "));

      return true;
    default:
      return false;
  }
}

/** Undo, redo, the editor's commands (definition, problems, picker, format…), vim and keys, the views, :set, :w <file>. -> whether it was one of these. */
function otherVimCommand(ed: EditorPane, cx: Context, name: string, arg: string | null): boolean {
  switch (name) {
    case "undo":
      ed.editor.undo();

      return true;
    case "redo":
      ed.editor.redo();

      return true;
    case "nohlsearch":
      ed.editor.find_close();
      ed.searchMark = null;

      return true;
    case "definition":
    case "next-problem":
    case "prev-problem":
    case "hover":
    case "problems":
      ed.command(name, cx);

      return true;
    case "references":
      void references(ed, cx);

      return true;
    case "picker":
      run("nocturne.picker");

      return true;
    case "grep":
      run("nocturne.grep");

      return true;
    case "files-pane":
      run("nocturne.files");

      return true;
    case "format":
      void formatNow(ed, cx);

      return true;
    case "code-action":
    case "rename":
      ed.say(`${name}: not here yet`);

      return true;
    case "vim":
      toggleVim(ed, cx);

      return true;
    case "keys":
      ed.command("keys", cx);

      return true;
    case "preview":
    case "preview-split":
    case "preview-only":
    case "preview-text":
    case "preview-rendered":
    case "md-menu":
      ed.command(name, cx);

      return true;
    case "set": {
      const opt = (arg ?? "").trim();

      if (opt === "wrap" || opt === "nowrap") {
        setWrap(ed, opt === "wrap", cx);

        return true;
      }

      if (opt === "wrap!" || opt === "invwrap") {
        setWrap(ed, null, cx);

        return true;
      }

      ed.say(`:set ${opt}: only :set wrap / nowrap / wrap! and :novim are known`);

      return true;
    }

    case "wrap":
      setWrap(ed, null, cx);

      return true;
    case "write":
      ed.say("E: :w <file> isn't supported; :w saves this file", true);

      return true;
    default:
      return false;
  }
}

export function references(ed: EditorPane, cx: Context): Promise<void> {
  return later(ed, cx, (cx) => referencesNow(ed, cx));
}

export async function referencesNow(ed: EditorPane, cx: Context): Promise<void> {
  let answer = null;

  try {
    answer = await ed.request("textDocument/references", isLocations, { context: { includeDeclaration: false } });
  } catch (cause) {
    return ed.say(errorText(cause), true);
  }

  const count = isList(answer) ? answer.length : 0;

  if (!count) {
    ed.say("no references");
    cx.notify();

    return;
  }

  ed.say(`${count} reference${count === 1 ? "" : "s"}: going to the first`);

  const loc = firstLocation(answer);

  if (!loc) return;

  if (loc.path === ed.path) ed.goto(loc.line, loc.col, cx);
  else ed.openFile(loc.path, cx, { line: loc.line + 1, col: loc.col + 1 });

  cx.notify();
}

export function formatNow(ed: EditorPane, cx: Context): Promise<void> {
  return later(ed, cx, (cx) => formatting(ed, cx));
}

export async function formatting(ed: EditorPane, cx: Context): Promise<void> {
  const d = ed.shown();

  if (d.opts.format) {
    await format(ed, d.editor.value(), cx, d);
    cx.notify();

    return;
  }

  const id = serverId(d.server);

  if (id === null) return ed.say("no formatter: settings.json editor format");

  try {
    const edits = await lspRequest(id, "textDocument/formatting", { textDocument: { uri: uri(d.path) }, options: { tabSize: d.opts.tab_size, insertSpaces: d.opts.insert_spaces !== false } });

    if (isTextEdits(edits) && edits.length) d.editor.edit(edits.map((e) => ({ start: { line: e.range.start.line, col: e.range.start.character }, end: { line: e.range.end.line, col: e.range.end.character }, text: e.newText })));

    ed.say("formatted");
  } catch (cause) {
    ed.say(errorText(cause), true);
  }

  cx.notify();
}
