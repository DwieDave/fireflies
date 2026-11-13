// The files pane's keyboard: the modes that take every key first (the menu,
// the delete question, a drag, the name row, the filter, the keys overview,
// the filter line's tab ring), then the list's keys in groups (marks, the
// preview split, file operations, moving, opening), tried in that order.

import type { Context, KeyEvent, Modifiers } from "gpui-kit";
import type { Row } from "./logic.ts";
import type { default as Files } from "./main.ts";
import { askKey, startDraft, startRename, paste, cutRow, askDelete } from "./file-ops.ts";
import { cancelDrag, markRange, markToggle } from "./drag.ts";
import { clearSearch, pressStop, startFind, reveal, openWeb } from "./search.ts";
import { stepRow, selectRow } from "./list-view.ts";
import { keysKey } from "./keyhelp.ts";
import { parent } from "./logic.ts";
import { toggleLook, resizeLook } from "./look.ts";
import { closePane, terminalEdit, nvim, previewRow, openPane, copyPath } from "./opening.ts";
import { viewerFor } from "./state.ts";
import { rootRow } from "./menu.ts";
import { lensStep, lensStops } from "./fit.ts";

/** What the list's keys read: the key and its modifiers, the rows, the selected one. */
interface ListKey {
  readonly e: KeyEvent;
  readonly k: string;
  readonly m: Modifiers;
  readonly low: string;
  readonly upper: boolean;
  readonly rows: readonly Row[];
  readonly i: number;
  readonly row: Row | undefined;
  readonly moved: (to: number) => void;
  readonly cx: Context;
}

/** A key in the files pane (the view's key handler). */
export function keyDown(v: Files, e: KeyEvent, cx: Context): void {
  if (v.menu) {
    v.menuKey(e, cx);

    return;
  }

  if (v.ask) {
    askKey(v, v.ask, e, cx);

    return;
  }

  const k = e.key;
  const m = e.modifiers;

  const done = (): void => {
    cx.stop_propagation();
    cx.notify();
  };

  // A drag: esc cancels it, other keys wait.
  if (v.drag) {
    if (k === "escape") cancelDrag(v);

    done();

    return;
  }

  if (v.draft) {
    // Typing goes to the name; esc gives up (enter is the input's submit).
    if (k !== "escape") return;

    v.endDraft(cx);
    done();

    return;
  }

  if (v.msg && !v.typing) v.msg = null;

  if (v.typing) {
    // Typing goes to the filter; these steer the hits (enter is the input's submit).
    if (k === "escape") clearSearch(v, cx);
    else if (k === "down" || (m.control && k === "n")) stepRow(v, 1);
    else if (k === "up" || (m.control && k === "p")) stepRow(v, -1);
    else if (k === "tab") v.focus();
    else return;

    done();

    return;
  }

  // Back and forward, the browser's and vim's jump list's way too.
  if ((m.alt && k === "left") || (m.control && k === "o")) {
    v.back(cx);
    done();

    return;
  }

  if ((m.alt && k === "right") || (m.control && k === "i")) {
    v.forward(cx);
    done();

    return;
  }

  if (m.platform || m.control || m.alt) return;

  // ? (shift-/ on most layouts: check what was typed before "/" filters).
  // The keys overview (keyhelp.ts): ? opens it, ? esc q close it; meanwhile it takes every key.
  const help = keysKey(e, v.keysShown);

  if (help || v.keysShown) {
    if (help) v.keysShown = help === "toggle" ? !v.keysShown : false;

    done();

    return;
  }

  // tab / shift-tab ring the filter line's switches, + file / + folder and ? keys
  // in turn, then the list again; enter or space presses the ringed one, esc
  // leaves it, any other key leaves it and does what it does in the list.
  if (k === "tab") {
    v.stop = lensStep(lensStops(v.lensAdd), v.stop, m.shift ? -1 : 1);
    done();

    return;
  }

  if (v.stop) {
    if (k === "enter" || k === "space" || k === "escape") {
      if (k === "escape") v.stop = null;
      else pressStop(v, v.stop, cx);

      done();

      return;
    }

    v.stop = null;
  }

  const upper = m.shift || /^[A-Z]$/.test(k);
  const low = k.toLowerCase();
  const rows = v.shown();
  const i = rows.findIndex((r) => r.path === v.sel);
  const row = rows[i];

  // A move ends a shift-range; in V's range it grows the range.
  const moved = (to: number): void => {
    selectRow(v, rows, to);

    if (v.range) markRange(v, v.sel);
  };

  if (v.range?.shift && !m.shift && ["j", "k", "down", "up"].includes(k)) v.range = null;

  const l: ListKey = { e, k, m, low, upper, rows, i, row, moved, cx };

  if (markKey(v, l) || lookKey(v, l) || editKey(v, l) || moveKey(v, l) || openKey(v, l)) done();
}

/** Marks: esc clears them, shift-↑↓ marks while moving, V a range, t one row. */
function markKey(v: Files, l: ListKey): boolean {
  const { k, m, low, upper, rows, i, row, moved } = l;

  if (k === "escape" && (v.marked.size || v.range)) v.unmark();
  else if (m.shift && (k === "down" || k === "up") && row) {
    // shift-↑↓: marks while moving, from where it started.
    if (!v.range) v.range = { anchor: row.path, base: new Set(v.marked), shift: true };

    moved(k === "down" ? i + 1 : i - 1);
    markRange(v, v.sel);
  } else if (low === "v" && upper) {
    // V: a range from here, as vim's line-wise visual mode; V again keeps the marks and ends it.
    if (v.range) v.range = null;
    else if (row) {
      v.range = { anchor: row.path, base: new Set(v.marked), shift: false };
      markRange(v, row.path);
    }
  } else if (k === "t" && row && !row.head) {
    markToggle(v, row.path);
    selectRow(v, rows, i + 1);
  }
  else return false;

  return true;
}

/** The preview split: space on / off, J K scroll it, < > size it. */
function lookKey(v: Files, l: ListKey): boolean {
  const { k, m, low, upper, cx } = l;

  if (k === "space") toggleLook(v, cx);
  else if (low === "j" && upper) v.scrollLook(1);
  else if (low === "k" && upper) v.scrollLook(-1);
  else if (k === "<" || (k === "," && m.shift)) resizeLook(v, -1);
  else if (k === ">" || (k === "." && m.shift)) resizeLook(v, 1);
  else return false;

  return true;
}

/** The filters (H, I) and the file operations: a / A new, R rename, P paste, x cut, d delete, / filters. */
function editKey(v: Files, l: ListKey): boolean {
  const { e, k, low, upper, row, cx } = l;

  if (low === "h" && upper) v.setFilter("hidden", cx);
  else if (low === "i" && upper) v.setFilter("ignored", cx);
  else if (low === "a") startDraft(v, upper ? "folder" : "file", row ?? null, cx);
  else if (low === "r" && upper) startRename(v, row, cx);
  else if (low === "p" && upper) paste(v, row ?? null, cx);
  else if (k === "x") cutRow(v, row, cx);
  else if (k === "d") askDelete(v, row, cx);
  else if (k === "/" || e.key_char === "/") startFind(v, cx);
  else return false;

  return true;
}

/** Moving: esc and q leave, [ ] back and forward, j k g G, l h into and out of folders, enter. */
function moveKey(v: Files, l: ListKey): boolean {
  const { k, low, upper, rows, i, row, moved, cx } = l;

  if (k === "escape") {
    if (v.query) clearSearch(v, cx);
    else if (v.alone) closePane(v);
    else v.leave();
  } else if (k === "q") closePane(v);
  else if (k === "[" || k === "backspace") v.back(cx);
  else if (k === "]") v.forward(cx);
  else if (k === "j" || k === "down") moved(i + 1);
  else if (k === "k" || k === "up") moved(i < 0 ? 0 : i - 1);
  else if (low === "g" && upper) {
    moved(rows.length - 1);
    v.gAt = 0;
  } else if (k === "g") {
    if (Date.now() - v.gAt < 500) {
      v.gAt = 0;
      moved(0);
    } else v.gAt = Date.now();
  } else if ((k === "l" || k === "right" || k === "enter") && row?.head) reveal(v, row.path, cx);
  else if ((k === "l" || k === "right") && row) {
    if (!row.dir) v.openFile(row.path, cx);
    else if (!v.folders.has(row.path)) v.toggle(row.path, cx);
    else selectRow(v, rows, i + 1);
  } else if ((k === "h" || k === "left") && row && !row.hit) {
    if (row.dir && v.folders.has(row.path)) v.toggle(row.path, cx);
    else if (row.depth > 0) selectRow(v, rows, rows.findIndex((r) => r.path === parent(row.path)));
  } else if (k === "enter" && row) {
    if (row.dir) v.toggle(row.path, cx);
    else v.openFile(row.path, cx);
  }
  else return false;

  return true;
}

/** Opening: E e $EDITOR, v Neovim, w the browser, p its viewer, o a files pane, y copy, m the menu, - . reroot, r refresh. */
function openKey(v: Files, l: ListKey): boolean {
  const { k, m, low, row, cx } = l;

  if (k === "E" || (low === "e" && m.shift)) terminalEdit(v, row?.path ?? "", cx);
  else if (k === "e") {
    if (row && !row.dir && viewerFor(row.path)?.other === "system") v.openFile(row.path, cx, true);
    else v.edit(row?.path ?? "", cx);
  } else if (k === "v") nvim(v, row ?? null);
  else if (k === "w" && row && !row.dir) openWeb(v, row.path, cx);
  else if (k === "p") previewRow(v, row, cx);
  else if (k === "o") openPane(v, row?.dir ? row.path : "");
  else if (k === "y") copyPath(v, row?.path ?? "", cx);
  else if (k === "m") v.openMenu(row ?? rootRow(v), cx);
  else if (k === "-") {
    const from = v.root;

    v.go(parent(v.root), cx);
    v.pendingSel = from;
  } else if (k === "." && row) {
    const into = row.dir ? row.path : row.path.includes("/") ? parent(row.path) : "";

    if (into) v.go(`${v.root}/${into}`, cx);
  } else if (k === "r") v.refresh(cx);
  else return false;

  return true;
}
