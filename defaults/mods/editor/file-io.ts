// The editor pane's file (main.ts): its title, loading and watching it,
// the files pane's renames, moves and deletes, a change typed, saving and
// formatting, the bar's short note.

import type EditorPane from "./main.ts";
import { fileChanges, follow as followFiles } from "./follow.ts";
import { readSharedMap, writeSharedMap } from "./guard.ts";
import { basename, dirname, languageId, languageSettings, tilde, uri } from "./logic.ts";
import { noteName } from "./scratch.ts";
import { tabKind } from "./tabs.ts";
import type { Context } from "gpui-kit";
import { appHome, exec, home, languageOf, lspNotify, lspRelease, props, readTextFile, setShared, settings, shared, watchFolder, writeTextFile } from "herdr";
import type { Doc, Go } from "./pane-kit.ts";
import { errorText, isPaneProps, serverId, TITLES_KEY } from "./pane-kit.ts";
import { closeCard, later } from "./card.ts";
import { syncViewer } from "./drawn-tabs.ts";
import { didChange } from "./lsp-client.ts";
import { focusText } from "./md-pane.ts";
import { keepTabs, noteUnsaved, publish, select } from "./pane-tabs.ts";
import { refreshPreview } from "./preview-pane.ts";

/** The pane header's name (nocturne/header.ts): the shown tab's. */
export function setTitle(ed: EditorPane): void {
  const slot = ed.slot;

  if (!slot) return;

  const name = ed.scratch ? `Scratchpad · ${noteName(ed.path)}` : basename(ed.path) + (ed.dirty ? " ●" : "");
  const all = readSharedMap(shared, TITLES_KEY);

  if (all.get(slot) !== name) writeSharedMap(setShared, TITLES_KEY, new Map([...all, [slot, name]]));
}

/** Acts on the change record's entries newer than the last seen, for every
 *  tab (from a task, never a render). */
export function followChanges(ed: EditorPane, cx: Context): void {
  const list = fileChanges(shared);
  const from = ed.seenChange;
  let seen = from;

  for (const d of ed.allDocs()) {
    const r = followFiles(list, from, d.path, ed.on);

    seen = Math.max(seen, r.seen);

    if (r.path !== d.path) moveTo(ed, r.path, cx, d);

    if (r.deleted && !d.deleted) markDeleted(ed, cx, d);
  }

  ed.seenChange = seen;
  cx.notify();
}

/** The file is at `to` now: the buffer, its edits, caret, scroll and undo
 *  stay; the name, the folder, the language and the server's document follow. */
export function moveTo(ed: EditorPane, to: string, cx: Context, d: Doc = ed.shown()): void {
  const from = d.path;
  const id = serverId(d.server);

  if (d.look) {
    d.path = to;
    d.deleted = false;
    d.kind = tabKind(to);

    if (d.kind === "text") {
      d.look = false;
      d.state = "unloaded";
    }

    if (d === ed.cur) {
      syncViewer(ed);

      if (!d.look) select(ed, d, cx, null, true);
    }

    setTitle(ed);
    keepTabs(ed);
    publish(ed);

    return;
  }

  if (id !== null) lspNotify(id, "textDocument/didClose", { textDocument: { uri: uri(from) } });

  d.path = to;
  d.deleted = false;

  const own = props();

  if (d.firstPath === ((isPaneProps(own) ? own.path : undefined) ?? d.firstPath)) {
    try {
      localStorage.setItem("moved", JSON.stringify({ from: d.firstPath, to }));
    } catch {
      /* a nicety */
    }
  }

  const lang = languageOf(to) ?? "text";

  if (lang !== d.lang) {
    // Another language: its grammar, settings and server.
    d.lang = lang;
    d.opts = languageSettings(settings().editor, lang);
    d.editor.set_language(lang);
    d.markdown = lang === "markdown";

    if (id !== null && !ed.allDocs().some((x) => x !== d && serverId(x.server) === id)) {
      lspRelease(id);
      ed.listening.delete(id);
    }

    d.server = null;
    ed.setProblems([], d);

    if (d.state === "ready") void ed.startServer(cx, false, d);
  } else if (id !== null) {
    d.version += 1;
    d.sent = d.editor.value();
    lspNotify(id, "textDocument/didOpen", { textDocument: { uri: uri(to), languageId: languageId(lang, to), version: d.version, text: d.sent } });
  }

  if (!ed.on && d.state !== "unloaded") ed.watch(cx, d);

  noteUnsaved(ed);
  setTitle(ed);
  keepTabs(ed);
  publish(ed);

  if (d === ed.cur) ed.say(`moved to ${tilde(dirname(to), home())}`);
}

/** The file was deleted: the editor keeps its text and says so; a save writes it again. */
export function markDeleted(ed: EditorPane, cx: Context, d: Doc = ed.shown()): void {
  d.deleted = true;
  d.saved = null; // a save creates it (writeTextFile's "new file")
  d.conflict = false;
  d.dirty = d.editor.value() !== "";
  noteUnsaved(ed);
  setTitle(ed);
  cx.notify();
}

/** Reads tab `d`'s file; `go`: the place to put the caret after. `quiet`: a
 *  poll or a change on disk, which leaves an edited buffer alone. */
export function loadDoc(ed: EditorPane, cx: Context, go: Go | null, quiet: boolean, d: Doc = ed.shown()): void {
  // Drawn: the viewer reads it; a change on disk draws it again.
  if (d.look) {
    if (d === ed.cur && quiet) syncViewer(ed, { reload: ed.viewerProps.reload + 1 });

    return;
  }

  if (!d.path) {
    d.state = "error";
    d.error = "No file given: editor.open {path}.";

    return;
  }

  cx.spawn(async (cx) => {
    let text: string | null = null;
    let error: string | null = null;

    try {
      text = await readTextFile(d.path, { on: ed.on });

      if (text !== null && text.includes("\0")) {
        text = null;
        error = "Not a text file: it holds binary data.";
      }
    } catch (cause) {
      error = errorText(cause);
    }

    if (d.gone) return;

    if (quiet) return reloadFromDisk(ed, cx, d, text);

    if (error) {
      d.state = "error";
      d.error = error;
      cx.notify();

      return;
    }

    if (text === null) {
      d.state = "missing";
      d.saved = null;
      d.editor.set_value("");
    } else {
      d.state = "ready";
      d.saved = text;
      d.editor.set_value(text);
    }

    // Handed over with unsaved changes: that text, unsaved here too.
    const hand = d.hand;

    d.hand = null;

    if (hand?.text !== null && hand?.text !== undefined) d.editor.set_value(hand.text);

    d.text = hand?.text ?? text ?? "";

    if (d.markdown) refreshPreview(ed, cx, true, d);

    d.dirty = hand?.text !== null && hand?.text !== undefined && hand.text !== (d.saved ?? "");
    d.conflict = false;

    if (hand) {
      d.editor.set_cursor(hand.caret.line, hand.caret.col);

      if (hand.top) d.editor.scroll_to_line(hand.top);
    }

    noteUnsaved(ed);
    setTitle(ed);

    const place = go ?? d.go;

    d.go = null;

    if (place && d === ed.cur) ed.goto(place.line - 1, (place.col ?? 1) - 1, cx);

    if (d.markdown && d.view === "rendered") {
      d.rendered?.open(cx);

      if (d === ed.cur) focusText(ed);
    }

    cx.notify();

    if (d.state === "ready" && !d.server) void ed.startServer(cx, false, d);
  });
}


/** The file read again while watched (a change on disk): our own write isn't news; an edited
 *  tab asks (it never drops what's typed); else the new text, the caret where it was, the
 *  server told it's saved. */
function reloadFromDisk(ed: EditorPane, cx: Context, d: Doc, text: string | null): void {
  // Our own write (the autosave's, maybe read while it was under way) isn't news.
  if (text === null || text === d.saved || text === d.writing) return;

  // Edited (a scratchpad: typed but not written yet): it asks, never drops what's typed.
  if (d.dirty || (d.scratch && d.saveState !== "saved")) {
    if (text !== d.editor.value()) d.conflict = true;

    cx.notify();

    return;
  }

  const at = d.editor.cursor();

  d.saved = text;
  d.editor.set_value(text);
  d.text = text;

  if (d.markdown) refreshPreview(ed, cx, true, d);

  d.editor.set_cursor(at.line, at.col);

  if (d.view === "rendered") d.rendered?.open(cx);

  if (d === ed.cur && !d.scratch) ed.say("reloaded: it changed on disk");

  didChange(ed, cx, true, d);

  // What's in the editor is what's on disk now: saved, as far as the
  // server goes (rust-analyzer runs cargo check on a save, so an agent's
  // edit shows its errors as one of Developer's would).
  const id = serverId(d.server);

  if (id !== null) lspNotify(id, "textDocument/didSave", { textDocument: { uri: uri(d.path) }, text });

  cx.notify();
}

/** Waits for tab `d`'s folder to change, and reads its file again. */
export function watch(ed: EditorPane, cx: Context, d: Doc = ed.shown()): void {
  const dir = dirname(d.path);

  // A moved file's tab watches its new folder; the old loop ends (and a closed tab's).
  d.watchGen += 1;

  const gen = d.watchGen;

  cx.spawn(async (cx) => {
    for (;;) {
      let changed: string[];

      try {
        changed = await watchFolder(dir);
      } catch {
        return;
      }

      if (gen !== d.watchGen || d.gone) return;

      if (!changed.some((p) => basename(p) === basename(d.path) || p === dir)) continue;

      loadDoc(ed, cx, null, true, d);
    }
  });
}

export function onChanged(ed: EditorPane, cx: Context, d: Doc = ed.shown()): void {
  d.text = d.editor.value();
  d.hovers.clear();

  // Typing closes the card.
  if (ed.card && d === ed.cur) closeCard(ed, cx);

  // The preview's blocks are cut again only where they're shown (rendered draws its own):
  // a keystroke in the rendered view doesn't re-split the whole document.
  if (d.markdown && d.view !== "rendered") refreshPreview(ed, cx, false, d);
  else if (d.markdown) d.previewStale = true;

  if (d.markdown && d.view === "rendered") d.rendered?.pull(cx);

  if (d.scratch) {
    // A scratchpad saves itself: never unsaved, written a moment after the typing.
    if (d.text !== (d.saved ?? "")) {
      ed.timerCx = cx;
      d.autosave?.touch();
    }

    didChange(ed, cx, false, d);
    cx.notify();

    return;
  }

  const dirty = d.text !== (d.saved ?? "");

  if (dirty !== d.dirty) {
    d.dirty = dirty;
    noteUnsaved(ed);
    setTitle(ed);
  }

  didChange(ed, cx, false, d);
  cx.notify();
}

export function save(ed: EditorPane, cx: Context): Promise<void> {
  const d = ed.shown();

  return later(ed, cx, (cx) => saveNow(ed, cx, d));
}

export async function saveNow(ed: EditorPane, cx: Context, d: Doc = ed.shown()): Promise<void> {
  if (d.state === "error" || d.state === "unloaded" || d.state === "loading") return;

  let text = d.editor.value();

  if (d.opts.format_on_save && d.opts.format) text = (await format(ed, text, cx, d)) ?? text;

  try {
    // Only over what was read: a file someone else changed isn't overwritten.
    await writeTextFile(d.path, text, d.saved);
    d.saved = text;
    d.state = "ready";
    d.deleted = false;
    d.dirty = d.editor.value() !== text;
    d.conflict = false;
    noteUnsaved(ed);
    setTitle(ed);
    ed.say(d === ed.cur ? "saved" : `saved ${basename(d.path)}`);

    const id = serverId(d.server);

    if (id !== null) lspNotify(id, "textDocument/didSave", { textDocument: { uri: uri(d.path) }, text });
    else if (!d.server) void ed.startServer(cx, false, d);
  } catch (cause) {
    ed.say(errorText(cause), true);

    if (/changed outside/.test(errorText(cause))) d.conflict = true;
  }

  cx.notify();
}

/** Runs settings.json's `format` on the text (it reads stdin, prints the
 *  result); puts the result in as one undoable edit. Null when it fails. */
export async function format(ed: EditorPane, text: string, _cx: Context, d: Doc = ed.shown()): Promise<string | null> {
  const tmp = `${appHome()}/cache/editor/format-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    await writeTextFile(tmp, text, null);

    const r = await exec("sh", ["-c", 'f="$1"; shift; "$@" < "$f"', "format", tmp, ...(d.opts.format ?? [])], { cwd: dirname(d.path) });

    exec("rm", ["-f", tmp]).catch(() => null);

    if (r.code !== 0 || !r.stdout) {
      ed.say(`formatter failed: ${r.stderr.split("\n")[0] ?? ""}`, true);

      return null;
    }

    if (r.stdout !== text) {
      const lines = text.split("\n");

      d.editor.edit([{ start: { line: 0, col: 0 }, end: { line: lines.length - 1, col: (lines.at(-1) ?? "").length }, text: r.stdout }]);
    }

    return r.stdout;
  } catch (cause) {
    ed.say(`formatter: ${errorText(cause)}`, true);

    return null;
  }
}

export function say(ed: EditorPane, text: string, bad = false): void {
  ed.message = { text, bad, at: Date.now() };
}
