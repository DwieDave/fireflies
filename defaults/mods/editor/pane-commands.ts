// The editor pane's commands (keys.json mod:editor, the palette): each
// name to what it does in the pane.

import type EditorPane from "./main.ts";
import type { EditorView } from "./editor-route.ts";
import { isEditorView } from "./editor-route.ts";
import { isNumber, isString, nullable, object, parseJson } from "./guard.ts";
import { dirname } from "./logic.ts";
import { join } from "./paths.ts";
import type { Context } from "gpui-kit";
import { cardShown, closeCard, hoverLevel, showCard } from "./card.ts";
import { toggleDrawn } from "./drawn-tabs.ts";
import { loadDoc, save } from "./file-io.ts";
import { openFind, problem } from "./find.ts";
import { definition } from "./lsp-client.ts";
import { openMdMenu, runMdCommand } from "./md-pane.ts";
import { toggleKeys } from "./pane-lines.ts";
import { closeTab, popIn, popOut, stepMove, stepShownTab } from "./pane-tabs.ts";
import { setWrap, toggleVim } from "./pane-vim.ts";
import { setView } from "./preview-pane.ts";
import { openTabMenu } from "./tab-menu.ts";

// The Markdown preview: how it shows, in the order the switch goes.
export const VIEWS: readonly EditorView[] = ["rendered", "split", "preview", "text"];

/** An `editor.open:{…}` command's argument. */
export const isOpenArg = object({}, { path: isString, line: nullable(isNumber), col: nullable(isNumber), view: nullable(isEditorView) });

export function command(ed: EditorPane, c: string, cx: Context): void {
  if (c === "focus") return ed.view === "rendered" && ed.cur?.rendered ? ed.cur.rendered.focus() : ed.editor.focus();

  if (c === "save") {
    void save(ed, cx);

    return;
  }

  if (c === "find") return openFind(ed, false);

  if (c === "replace") return openFind(ed, true);

  if (c === "line") {
    ed.mode = "line";
    ed.lineInput?.set_value("");

    return ed.lineInput?.focus();
  }

  if (c === "next-problem") return problem(ed, 1, cx);

  if (c === "prev-problem") return problem(ed, -1, cx);

  if (c === "problems") {
    ed.drawer = !ed.drawer;

    return;
  }

  if (c === "definition") {
    void definition(ed, cx);

    return;
  }

  // cmd-i (vim: K) opens the card at the caret, and closes an open one.
  // (A pointer's card still waiting isn't on screen: cmd-i opens the caret's then.)
  if (c === "hover") {
    if (ed.card && cardShown(ed, ed.card)) return closeCard(ed, cx);

    const at = ed.editor.cursor();

    return showCard(ed, at.line, at.col, true, cx);
  }

  if (c === "hover-more") return hoverLevel(ed, 1, cx);

  if (c === "hover-less") return hoverLevel(ed, -1, cx);

  if (c === "reload") {
    ed.dirty = false;

    return loadDoc(ed, cx, null, false);
  }

  if (c === "vim") return toggleVim(ed, cx);

  if (c === "wrap") return setWrap(ed, null, cx);

  if (c === "keys") return toggleKeys(ed, !ed.keysShown);

  if (c === "preview" && ed.kind === "either") return toggleDrawn(ed, cx);

  if (c === "preview") return setView(ed, VIEWS[(VIEWS.indexOf(ed.view) + 1) % VIEWS.length] ?? "split", cx);

  if (c === "preview-split") return setView(ed, "split", cx);

  if (c === "preview-only") return setView(ed, "preview", cx);

  if (c === "preview-text") return setView(ed, "text", cx);

  if (c === "preview-rendered") return setView(ed, "rendered", cx);

  if (c === "md-menu") return openMdMenu(ed, cx);

  if (c.startsWith("md-")) return runMdCommand(ed, c.slice(3), cx);

  if (c === "next-tab") return stepShownTab(ed, 1, cx);

  if (c === "prev-tab") return stepShownTab(ed, -1, cx);

  if (c === "close-tab") return closeTab(ed, cx);

  if (c === "move-tab-left") return stepMove(ed, -1, cx);

  if (c === "move-tab-right") return stepMove(ed, 1, cx);

  if (c === "pop-out") return popOut(ed, cx);

  if (c === "pop-out-tab") return popOut(ed, cx, ed.cur, "tab");

  if (c === "pop-in") return popIn(ed, cx);

  if (c === "tab-menu") return openTabMenu(ed, cx);

  // `editor.open:{"path","line"?,"col"?,"view"?}`: a file as a tab of the focused editor.
  if (c.startsWith("open:")) {
    const arg = parseJson(c.slice(5), isOpenArg);

    if (!arg) return ed.say('open: needs {"path": …}', true);

    const path = arg.path ?? "";

    if (!path) return;

    return ed.openFile(path.startsWith("/") ? path : join(dirname(ed.path), path), cx, { line: arg.line ?? null, col: arg.col ?? null, view: arg.view ?? null });
  }
}
