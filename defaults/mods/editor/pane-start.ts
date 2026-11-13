// How the editor pane starts and what it answers each frame (main.ts init and
// render): its handles, vim, the preview's view and the find line's inputs;
// its tabs as kept or asked for; the loops it runs (another machine's files
// polled, the keyboard taken, the commands); the files pane's and the app's
// requests through shared state.

import { isNumber, isString, nullable, object, parseJson, readShared, sharedKey, writeShared } from "./guard.ts";
import type { AsyncContext, Context } from "gpui-kit";
import type EditorPane from "./main.ts";
import type { Go, PaneProps } from "./pane-kit.ts";
import { HANDOVER_KEY, handoverFor, isKeptTabsNote, isMovedNote, restoreTabs } from "./tabs.ts";
import { InputState } from "gpui-base";
import { isEditorView, LAST_KEY, OPEN_KEY } from "./editor-route.ts";
import { MOD } from "./pane-kit.ts";
import type { OpenRequest } from "./editor-route.ts";
import { bindTab } from "./form-keys.ts";
import { command } from "./pane-commands.ts";
import { createVim } from "./vim.ts";
import { fileChanges, newestId } from "./follow.ts";
import { focusText } from "./md-pane.ts";
import { followChanges, loadDoc } from "./file-io.ts";
import { goLine, search, step } from "./find.ts";
import { mountViewer } from "./drawn-tabs.ts";
import { newDoc, publish, select } from "./pane-tabs.ts";
import { nextCommand, setShared, settings, shared, theme } from "herdr";
import { syntaxColors } from "./logic.ts";
import { vimSettled } from "./pane-vim.ts";

// The app asks an editor already on a file to go somewhere (`editor.open` with a line):
// { path, n, line?, col? } (src/window.rs).
const GOTO = "editor.goto";

const GOTO_KEY = sharedKey(GOTO, nullable(object({ path: isString, n: isNumber }, { line: isNumber, col: isNumber })));

const POLL = 4000; // a file on another machine can't be watched

/** The pane's own state from its props: the handles, vim and its leader, the view kept, the find line's inputs. */
export function startFields(ed: EditorPane, pr: PaneProps, cx: AsyncContext): void {
  ed.on = pr.on ?? null;
  ed.slot = pr.slot ?? null;
  ed.seenChange = newestId(fileChanges(shared));
  // A file sent to this pane's own slot just before it started (the files
  // pane put this editor in its preview pane's place): opened on the first frame.
  const req = readShared(shared, OPEN_KEY, null);
  const early = req !== null && req.slot !== null && req.slot === ed.slot && Date.now() - (req.at ?? 0) < 10000;

  ed.seenOpen = early ? req.n - 1 : req?.n ?? 0;
  ed.menuHandle = cx.focus_handle();
  ed.handle = cx.focus_handle();
  bindTab(cx); // tab / shift-tab reach the key handler (form-keys.ts)

  // Vim: the pane's own switch, else settings.json editor.vim (default on).
  const leader = settings().editor.leader ?? "space";

  ed.vim = createVim({ leader: leader === "space" ? " " : leader === "comma" ? "," : leader.slice(0, 1) || " " });

  // This pane's own vim switch, if it was flipped here before.
  try {
    const v = localStorage.getItem("vim");

    ed.paneVim = v === "on" ? true : v === "off" ? false : null;
  } catch {
    ed.paneVim = null;
  }

  ed.vimWas = ed.vimOn();
  ed.colors = syntaxColors(theme());

  // Markdown: how the preview shows (the pane remembers; each tab keeps its own after).
  let view: string | null = null;

  try {
    view = localStorage.getItem("preview");
  } catch {
    /* the default */
  }

  ed.defaultView = isEditorView(view) ? view : "split";
  ed.previewHandle = cx.focus_handle();
  ed.lookHandle = cx.focus_handle();
  ed.viewerProps = { embedded: true, path: null, on: ed.on, scroll: null, reload: 0 };
  ed.keysHandle = cx.focus_handle();

  const findInput = InputState.new({ placeholder: "find" });

  findInput.on("change", (_e, cx) => search(ed, cx));
  findInput.on("submit", (e, cx) => step(ed, e.shift ? -1 : 1, cx));

  const replaceInput = InputState.new({ placeholder: "replace with" });

  replaceInput.on("submit", (e, cx) => ed.replace(Boolean(e.secondary), cx));
  // A click into a field moves the find line's stop with it.
  findInput.on("focus", () => {
    ed.findAt = "find";
  });
  replaceInput.on("focus", () => {
    ed.findAt = "with";
  });

  const lineInput = InputState.new({ placeholder: "line or line:column" });

  lineInput.on("submit", (_e, cx) => goLine(ed, cx));
  ed.findInput = findInput;
  ed.replaceInput = replaceInput;
  ed.lineInput = lineInput;
}

/** The tabs: as kept (a restart), else the props' file (where the files pane moved it; opened
 *  to be looked at, at a line, handed over from another editor); the shown one selected. */
export function openTabs(ed: EditorPane, pr: PaneProps, cx: AsyncContext): void {
  // The tabs: as kept (a restart), else the props' file (where the files
  // pane moved it: its props keep the first path).
  const stored = (name: string): string | null => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null; // none kept
    }
  };

  const keptText = stored("tabs");
  const movedText = stored("moved");
  const keptTabsNote = keptText ? (parseJson(keptText, isKeptTabsNote) ?? null) : null;
  const start = restoreTabs(keptTabsNote, pr.path ?? "", movedText ? (parseJson(movedText, isMovedNote) ?? null) : null);
  const keptAny = (keptTabsNote?.paths?.length ?? 0) > 0;
  // The props' file opened to be looked at (a terminal's link: `look`) starts drawn.
  const req = readShared(shared, OPEN_KEY, null);
  const asked = req && req.slot === null && req.path === pr.path && Date.now() - (req.at ?? 0) < 10000 ? req : null;
  // A tab popped out of another editor into this new one: what it had (tabs.ts handover).
  const handed = keptAny ? null : handoverFor(readShared(shared, HANDOVER_KEY, null), pr.slot, pr.path);

  ed.docs = start.paths.map((path) => newDoc(ed, path, path === pr.path && !keptAny ? { look: pr.look === true || asked?.look === true, view: asked?.view ?? null, hand: handed } : {}));

  const first = ed.docs[start.active] ?? ed.docs[0];

  if (!first) throw new Error("restoreTabs gives a tab at least");

  ed.cur = first;

  // The props' line goes to the props' file (editor.open opened this pane on it).
  let go: Go | null = null;

  if (pr.line) {
    ed.cur = ed.docs.find((x) => x.path === pr.path) ?? first;
    go = { line: pr.line, col: pr.col ?? 1 };
  }

  // An "edit" from the Markdown viewer asked for the preview (editor-route.ts: slot null).
  if (asked?.view && asked.path === ed.cur.path && ed.cur.markdown) ed.cur.view = asked.view;

  select(ed, ed.cur, cx, go, true);
  // The tabs it restored, told to the routing now: shared PATHS outlives a
  // restart, and an entry from before (a scratchpad note this pane no longer
  // holds) would send the app's editor.open to a pane that ignores it.
  publish(ed);
}

/** What runs for the pane's life: another machine's files polled, the keyboard taken at the start, the commands. */
export function runLoops(ed: EditorPane, cx: AsyncContext): void {
  if (ed.on) {
    cx.timer.every(POLL, (cx) => {
      for (const d of ed.docs) if (d.state !== "unloaded" && d.state !== "loading") loadDoc(ed, cx, null, true, d);
    });
  }

  // A newly opened editor takes the keyboard.
  for (const ms of [0, 120, 400]) cx.timer.after(ms, () => focusText(ed));

  cx.spawn(async (cx) => {
    for (;;) {
      const c = (await nextCommand()).replace(`${MOD}.`, "");

      command(ed, c, cx);
      cx.notify();
    }
  });
}

/** What the pane answers each frame from shared state (render): vim's switch flipped, the
 *  files pane's renames, the app's editor.open on a tab's file, a file sent here as a tab;
 *  the drawn tab's viewer mounted; this pane told as the editor with the keyboard. */
export function watchShared(ed: EditorPane, cx: Context): void {
  if (ed.vimWas !== null && ed.vimWas !== ed.vimOn()) vimSettled(ed, ed.vimOn());

  const goto = readShared(shared, GOTO_KEY, null);

  // A newer rename, move or delete from the files pane: answered after this render.
  if (newestId(fileChanges(shared)) > ed.seenChange) cx.timer.after(0, (cx) => followChanges(ed, cx));

  // The app's editor.open on a file one of the tabs holds: that tab, at the line asked for.
  if (goto && goto.n !== ed.seenGoto && ed.allDocs().some((d) => d.path === goto.path)) {
    ed.seenGoto = goto.n;
    cx.timer.after(0, (cx) => {
      ed.openFile(goto.path, cx, { line: goto.line ?? null, col: goto.col ?? null });
      cx.notify();
    });
  }

  // A file sent to this editor as a tab (editor-route.ts: the files pane, the picker, the Markdown viewer).
  const req: OpenRequest | null = readShared(shared, OPEN_KEY, null);

  if (req && req.slot === ed.slot && ed.slot && req.n !== ed.seenOpen) {
    ed.seenOpen = req.n;
    cx.timer.after(0, (cx) => {
      ed.openFile(req.path, cx, { line: req.line ?? null, col: req.col ?? null, view: req.view ?? null, look: req.look === true });
      cx.notify();
    });
  }

  // The shown drawn tab's viewer, made once: a nested view, so its reading redraws only it.
  if (ed.cur?.look) mountViewer(ed, cx);

  // The editor that last had the keyboard, for the files pane and the picker to send files to.
  const slot = ed.slot;

  if (slot && (ed.editor.focused() || (ed.look && ed.lookHandle?.is_focused() === true)) && readShared(shared, LAST_KEY, null) !== slot) {
    cx.timer.after(0, () => {
      if (readShared(shared, LAST_KEY, null) !== slot) writeShared(setShared, LAST_KEY, slot);
    });
  }
}
