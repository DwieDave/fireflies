// The editor pane's tabs (main.ts): a tab made for a file, shown, opened,
// stepped and moved; popped out into a pane of its own and back; closed
// (asking about unsaved changes); what the pane keeps and tells others.

import type EditorPane from "./main.ts";
import type { EditorView } from "./editor-route.ts";
import { editorPaths, isScratchpad, LAST_KEY, OPEN_KEY, PATHS_KEY } from "./editor-route.ts";
import { readShared, writeShared, writeSharedMap } from "./guard.ts";
import { basename, languageSettings, syntaxColors, uri } from "./logic.ts";
import { MarkdownDoc } from "./markdown.ts";
import { Rendered } from "./rendered.ts";
import { Autosave, isNote } from "./scratch.ts";
import type { Handover } from "./tabs.ts";
import { afterClose, drawnAfter, handover, HANDOVER_KEY, handoverFor, keptTabs, moved, placeTab, startsDrawn, stepTab, tabKind, unsavedNote } from "./tabs.ts";
import { CARET } from "./vim.ts";
import { EditorState } from "gpui-base";
import type { Context } from "gpui-kit";
import { appHome, languageOf, lspNotify, lspRelease, panes, run, setShared, settings, setUnsaved, shared, theme } from "herdr";
import type { Answer, Doc, Go } from "./pane-kit.ts";
import { MOD, paneProps, selectionColor, serverId, whereArgs } from "./pane-kit.ts";
import { mountViewer, setDrawn, syncViewer } from "./drawn-tabs.ts";
import { autosaveTimer, autosaveWrite, focusText, renderedHost } from "./md-pane.ts";
import { pasteImageBlock } from "./preview-pane.ts";

/** A new editor pane's slot (its shared records' key). */
export const newSlot = (): string => `ed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A file's record: its own code editor (text, undo, caret, scroll,
 *  folds), what's on disk, unsaved changes, its server document, problems
 *  and Markdown preview. Read when first shown (`state` "unloaded" till then). */
export function newDoc(ed: EditorPane, path: string, { look = false, view = null, hand = null }: { readonly look?: boolean; readonly view?: EditorView | null; readonly hand?: Handover | null } = {}): Doc {
  const lang = languageOf(path) ?? "text";
  const opts = languageSettings(settings().editor, lang);
  const t = theme();
  const markdown = lang === "markdown";
  const kind = tabKind(path);
  // Word wrap in this tab: the language's soft_wrap until cmd-k z / space u w
  // / :set wrap / the bar's chip switch it (this tab only, not written to settings).
  const softWrap = Boolean(opts.soft_wrap);

  const editor = EditorState.new({
    language: lang,
    value: "",
    font_family: settings().font_family || "JetBrains Mono",
    font_size: 13,
    line_numbers: true,
    folding: true,
    soft_wrap: softWrap,
    syntax: ed.colors ?? syntaxColors(t),
    // The theme's selection is moonfly's border tone, hard to see on its
    // background: moonfly blue at 40% stands out and keeps text readable.
    selection: selectionColor(t),
  });

  const d: Doc = {
    path,
    firstPath: path,
    lang,
    opts,
    openedAt: Date.now(),
    deleted: false,
    saved: null,
    state: "unloaded",
    error: null,
    dirty: false,
    conflict: false,
    problems: [],
    server: null,
    version: 1,
    sent: null,
    progress: new Map(),
    hovers: new Map(),
    text: "",
    find: { count: 0, current: null },
    searchMark: null,
    markdown,
    preview: new MarkdownDoc("pv"),
    images: new Map(),
    // Markdown takes the view asked for, else the pane's (rendered, split, preview, text: its last pick).
    view: markdown && view ? view : ed.defaultView,
    driver: "editor",
    previewDrove: 0,
    previewDue: false,
    previewStale: false,
    flushDue: false,
    lastWork: 0,
    watchGen: 0,
    watched: false,
    kind,
    look: startsDrawn(path, { look, view }),
    softWrap,
    editor,
    rendered: null,
    scratch: isNote(path, appHome()),
    autosave: null,
    saveState: "saved",
    writing: null,
    hand: null,
    go: null,
    gone: false,
  };

  wireDoc(ed, d, hand);

  return d;
}

/** A new tab's editor set up: what a handed-over tab had, its indent and wrap, its keys and
 *  events (vim, changes, a pasted picture, hover, blur, scroll), the rendered view of a
 *  Markdown file, a scratchpad's autosave. */
function wireDoc(ed: EditorPane, d: Doc, hand: Handover | null): void {
  const editor = d.editor;
  const opts = d.opts;

  // Handed over from another editor: its view and drawn state now, its text, caret and scroll once read (load).
  if (hand) {
    if (d.markdown && hand.view) d.view = hand.view;

    if (d.kind === "either") d.look = hand.look;

    d.hand = hand;
  }

  editor.set_tab_size(opts.tab_size, opts.insert_spaces === false);

  if (d.hand && d.hand.wrap !== d.softWrap) {
    d.softWrap = d.hand.wrap;
    editor.set_soft_wrap(d.softWrap);
  }

  editor.on("key", (e, cx) => ed.vimKey(e, cx));
  editor.set_cursor_shape(ed.vimOn() ? CARET.normal : "bar");
  editor.on("change", (_e, cx) => ed.changed(cx, d));
  // A paste the editor found no text in (a screenshot): a Markdown file takes it as an image block.
  editor.on("paste_other", (_e, cx) => {
    if (d.markdown && d === ed.cur) void pasteImageBlock(ed, cx);
  });
  editor.on("hover", (e, cx) => {
    if (d === ed.cur) ed.hovered(e, cx);
  });
  // The editor losing the keyboard closes the card (and watchFocus, while
  // one is open: the editor's blur doesn't reach mods every time).
  editor.on("blur", (_e, cx) => ed.closeCard(cx));

  // Markdown: the rendered view's block editor (rendered.ts); a scratchpad
  // note (scratch.ts) opens rendered and saves itself as it's typed.
  if (d.markdown) d.rendered = new Rendered(d, renderedHost(ed));

  if (d.scratch) {
    d.view = "rendered";
    d.saveState = "saved";
    d.autosave = new Autosave({
      write: () => autosaveWrite(ed, d),
      timer: (ms, fn) => autosaveTimer(ed, ms, fn),
      onState: (st) => {
        d.saveState = st;
      },
    });
  }

  editor.on("scroll", (_e, cx) => {
    if (d !== ed.cur) return;

    // The card stays at its word: drawn again where the word went (and once
    // more a frame later, when the scrolled text has been laid out).
    if (ed.card) {
      cx.notify();
      cx.timer.after(16, (cx) => cx.notify());
    }

    if (Date.now() - d.previewDrove < 150) return;

    d.driver = "editor";

    if (d.markdown && d.view === "split") cx.notify();
  });
}

/** Shows tab `d`: the card, find line and vim's pending keys go; read the
 *  first time; `go` { line, col } (one-based) puts the caret there. */
export function select(ed: EditorPane, d: Doc, cx: Context, go: Go | null = null, first = false): void {
  if (d !== ed.cur || first) {
    if (!first) {
      ed.closeCard(cx);

      if (ed.mode === "find" || ed.mode === "replace") ed.editor.find_close();

      ed.mode = null;
      ed.asking = null;
      ed.keysShown = false;
      // A tab's menu belongs to the tab it opened on: another one shown closes it.
      ed.tabMenu = null;
    }

    ed.cur = d;
    ed.vimSettled(ed.vimOn());
  }

  ed.vim.indent = d.opts.insert_spaces === false ? "\t" : " ".repeat(d.opts.tab_size);

  if (d.look) mountViewer(ed, cx);

  syncViewer(ed);

  if (d.look) {
    // Drawn: the viewer reads it; its folder's changes draw it again (load).
    if (!d.watched && !ed.on && d.path) {
      d.watched = true;
      ed.watch(cx, d);
    }
  } else if (d.state === "unloaded") {
    d.state = "loading";
    ed.load(cx, go, false, d);

    if (!ed.on && d.path) ed.watch(cx, d);
  } else if (go && d.state !== "loading") ed.goto(go.line - 1, (go.col ?? 1) - 1, cx);
  else if (go) d.go = go;

  ed.title();
  keepTabs(ed);

  if (!first || d.look) {
    if (d.look) cx.timer.after(0, () => ed.lookHandle?.focus());
    else if (d.markdown && d.view === "preview") cx.timer.after(0, () => ed.previewHandle?.focus());
    else if (d.markdown && d.view === "rendered" && d.state !== "loading") {
      d.rendered?.open(cx);
      focusText(ed);
    } else focusText(ed);
  }

  cx.notify();
}

/** Opens `path` here as a tab (the one showing it, if open) and shows it;
 *  `line` / `col` one-based; `view` a Markdown file's view, or "preview" /
 *  "text" for a table, patch or SVG (drawn or as text); `look`: opened to be
 *  looked at (a new tab of a picture or table starts drawn). */
export function openFile(ed: EditorPane, path: string, cx: Context, { line = null, col = null, view = null, look = false }: { readonly line?: number | null; readonly col?: number | null; readonly view?: EditorView | null; readonly look?: boolean } = {}): void {
  if (!path) return;

  // A scratchpad's pane is the note's own: other files open in an editor beside it.
  if (ed.docs.length && ed.docs.every((d) => d.scratch) && !isNote(path, appHome())) {
    const me = ownPane(ed);

    const where = whereArgs(me?.pane, null);

    run("editor.open", line ? { path, line, col: col ?? 1, ...where } : { path, ...where });

    return;
  }

  const at = placeTab(
    ed.docs.map((d) => d.path),
    ed.docs.indexOf(ed.shown()),
    path,
  );

  if (at.added) ed.docs.splice(at.index, 0, newDoc(ed, path, { look, view, hand: handoverFor(readShared(shared, HANDOVER_KEY, null), ed.slot, path) }));

  const d = ed.docs[at.index];

  if (!d) return;

  if (!at.added) {
    if (view && d.markdown) d.view = view;

    const drawn = drawnAfter(path, { view });

    if (drawn !== null && drawn !== d.look) setDrawn(ed, d, drawn, cx, false);
  }

  select(ed, d, cx, line && !d.look ? { line, col: col ?? 1 } : null);
  publish(ed);
}

/** Tab `d` into a new editor pane of its own: beside this one (`where`
 *  "beside"), or in a new tab of the window ("tab"); what it had goes with
 *  it (handover) and it leaves this strip without asking (its unsaved text
 *  went too). The last tab popping out closes this pane. */
export function popOut(ed: EditorPane, cx: Context, d: Doc | null = ed.cur, where: "beside" | "tab" = "beside"): void {
  if (!d) return;

  if (d.scratch) return ed.say("the scratchpad is a pane of its own");

  const me = ownPane(ed);
  const slot = newSlot();

  writeShared(setShared, HANDOVER_KEY, handover(d, slot));

  const paneProps = ed.on ? { path: d.path, slot, popped: true, on: ed.on } : { path: d.path, slot, popped: true };

  if (where === "tab" || !me) run("tab.new", { mod: MOD, props: paneProps, name: basename(d.path) });
  else run("pane.split", { direction: "auto", pane: me.pane, mod: MOD, props: paneProps });

  leave(ed, cx, d);
}

/** The shown tab into another editor of this window's tab, as a tab there
 *  (the one that last had the keyboard, else the first): what it had goes
 *  with it; this pane closes when it was its last tab. */
export function popIn(ed: EditorPane, cx: Context, d: Doc | null = ed.cur): void {
  if (!d || d.scratch) return;

  const target = otherEditor(ed);

  if (!target) return ed.say("no other editor in this tab");

  writeShared(setShared, HANDOVER_KEY, handover(d, target.slot));
  writeShared(setShared, OPEN_KEY, { slot: target.slot, path: d.path, n: (readShared(shared, OPEN_KEY, null)?.n ?? 0) + 1, at: Date.now() });
  run("pane.focus", { pane: target.pane });
  leave(ed, cx, d);
}

/** Another editor in this pane's window tab (not a scratchpad's), for popIn: its pane and slot. */
export function otherEditor(ed: EditorPane): { readonly pane: string; readonly slot: string } | null {
  const me = ownPane(ed);

  if (!me) return null;

  const eds = panes().flatMap((p) => {
    const pp = paneProps(p);

    return p.mod === MOD && p.tab === me.tab && p.pane !== me.pane && !p.parked && pp.slot && (pp.on ?? null) === ed.on && !isScratchpad(p) ? [{ pane: p.pane, slot: pp.slot }] : [];
  });

  const last = readShared(shared, LAST_KEY, null);

  return eds.find((p) => p.slot === last) ?? eds[0] ?? null;
}

/** Tab `d` goes from here without asking: it lives on elsewhere. */
export function leave(ed: EditorPane, cx: Context, d: Doc): void {
  d.dirty = false;
  closeTab(ed, cx, d, true);
}

/** The next (1) or previous (-1) tab. */
export function stepShownTab(ed: EditorPane, dir: number, cx: Context): void {
  if (ed.docs.length < 2) return ed.say("one tab");

  const next = ed.docs[stepTab(ed.docs.length, ed.docs.indexOf(ed.shown()), dir)];

  if (next) select(ed, next, cx);
}

/** Moves tab `from` to index `to` (a drag's drop, ]B / [B, :tabm): the
 *  order is kept for a restart and told to the routing (shared PATHS). */
export function moveTab(ed: EditorPane, from: number, toIndex: number | null, cx: Context | null = null): void {
  const n = ed.docs.length;

  if (from < 0 || from >= n || toIndex === null) return;

  const to = Math.max(0, Math.min(n - 1, toIndex));

  if (to === from) return;

  ed.docs = moved(ed.docs, from, to);
  keepTabs(ed);
  publish(ed);
  cx?.notify();
}

/** The shown tab one place right (1) or left (-1); `:tabm`'s "N", "+N",
 *  "-N" or "$" (the end) as `spec`. */
export function stepMove(ed: EditorPane, dir: number, cx: Context, spec: string | null = null): void {
  const n = ed.docs.length;
  const i = ed.docs.indexOf(ed.shown());

  if (n < 2) return ed.say("one tab");

  const to = spec === null ? i + dir : spec === "$" ? n - 1 : /^[+-]/.test(spec) ? i + Number(spec) : Number(spec);

  if (!(to >= 0 && to < n)) return ed.say(dir < 0 || (spec ?? "").startsWith("-") ? "the first tab" : "the last tab");

  moveTab(ed, i, to, cx);
}

/** Closes tab `d` (the shown one by default): with unsaved changes it
 *  asks first (the question's line: save, discard, keep), unless
 *  `confirmed`. The last tab closes the pane. */
export function closeTab(ed: EditorPane, cx: Context, d: Doc | null = ed.cur, confirmed = false): void {
  if (!d) return;

  if (d.dirty && !confirmed) {
    if (d !== ed.cur) select(ed, d, cx);

    ed.asking = { doc: d, at: "save" };
    cx.notify();

    return;
  }

  ed.asking = null;
  void d.autosave?.flush();

  if (ed.docs.length <= 1) {
    d.dirty = false;
    noteUnsaved(ed);

    const me = ownPane(ed);

    run("pane.close", { ...whereArgs(me?.pane, null), confirmed: true });

    return;
  }

  const i = ed.docs.indexOf(d);
  const next = afterClose(ed.docs.length, ed.docs.indexOf(ed.shown()), i);

  releaseDoc(ed, d);
  ed.docs.splice(i, 1);

  const show = (next === null ? undefined : ed.docs[next]) ?? ed.docs[0];

  if (show && (show !== ed.cur || d === ed.cur)) select(ed, show, cx);

  noteUnsaved(ed);
  ed.title();
  keepTabs(ed);
  publish(ed);
  cx.notify();
}

/** The question on closing an edited tab: save and close, discard, or keep it open. */
export function answerClose(ed: EditorPane, choice: Answer, cx: Context): void {
  const a = ed.asking;

  if (!a) return;

  ed.asking = null;

  if (choice === "keep") {
    ed.editor.focus();
    cx.notify();

    return;
  }

  if (choice === "discard") return closeTab(ed, cx, a.doc, true);

  // Save, then close if it was written.
  void ed.later(cx, async (cx) => {
    await ed.saveNow(cx, a.doc);

    if (!a.doc.dirty) closeTab(ed, cx, a.doc, true);

    cx.notify();
  });
}

/** A tab going: its server document closes, the server is let go when no
 *  other tab uses it, its folder watch ends. */
export function releaseDoc(ed: EditorPane, d: Doc): void {
  d.watchGen += 1;
  d.gone = true;

  const id = serverId(d.server);

  if (id === null) return;

  lspNotify(id, "textDocument/didClose", { textDocument: { uri: uri(d.path) } });

  if (!ed.allDocs().some((x) => x !== d && serverId(x.server) === id)) {
    lspRelease(id);
    ed.listening.delete(id);
  }
}

/** This copy's own pane (found by its slot). */
export function ownPane(ed: EditorPane): { readonly pane: string; readonly tab: string } | null {
  return panes().find((p) => p.mod === MOD && paneProps(p).slot === ed.slot) ?? null;
}

/** The tabs as kept for a restart (localStorage). */
export function keepTabs(ed: EditorPane): void {
  if (!ed.docs.length) return;

  try {
    localStorage.setItem("tabs", JSON.stringify(keptTabs(ed.docs.map((d) => d.path), ed.docs.indexOf(ed.shown()))));
  } catch {
    /* a nicety */
  }
}

/** Every file here, for the files pane, the picker and the app's
 *  editor.open to find the editor holding one (shared PATHS by slot). */
export function publish(ed: EditorPane): void {
  const slot = ed.slot;

  if (!slot) return;

  const live = new Set(panes().flatMap((p) => (p.mod === MOD && paneProps(p).slot ? [paneProps(p).slot] : [])));
  const was = editorPaths(shared);
  const mine = ed.allDocs().map((d) => d.path);

  if (JSON.stringify(was.get(slot)) === JSON.stringify(mine) && [...was.keys()].every((k) => live.has(k) || k === slot)) return;

  const next = new Map([...was].filter(([k]) => live.has(k)));

  next.set(slot, mine);
  writeSharedMap(setShared, PATHS_KEY, next);
}

/** What closing the pane asks: every tab with unsaved changes, once. */
export function noteUnsaved(ed: EditorPane): void {
  setUnsaved(unsavedNote(ed.allDocs()));
}
