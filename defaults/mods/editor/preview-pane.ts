// The editor pane's Markdown preview and images: the preview drawn and
// refreshed, its keys and links; pictures pasted, picked and drawn
// (images.ts); closing the pane.

import type EditorPane from "./main.ts";
import * as herdr from "herdr";
import type { EditorView } from "./editor-route.ts";
import { editorPaths, OPEN_KEY, PATHS_KEY } from "./editor-route.ts";
import { readShared, readSharedMap, writeShared, writeSharedMap } from "./guard.ts";
import { assetPlace, imageMarkdown, insertImage, isImagePath, maybeCopiedImage, readClipboardImage, relative, stamp } from "./images.ts";
import { unitFor, units as liveUnits } from "./live.ts";
import { basename, dirname, uri } from "./logic.ts";
import { cacheImage, isLocalSource, taskToggle } from "./markdown.ts";
import { editBetween } from "./md-text.ts";
import { follow, join } from "./paths.ts";
import type { Picture } from "./rendered.ts";
import { v_flex } from "gpui-base";
import type { Context, Element, KeyEvent } from "gpui-kit";
import type { Theme } from "herdr";
import { appHome, exec, languageOf, lspNotify, lspRelease, run, setShared, setUnsaved, shared, window as appWindow } from "herdr";
import type { Doc } from "./pane-kit.ts";
import { dither, focusOn, MOD, PREVIEWED, serverId, TITLES_KEY, zoom } from "./pane-kit.ts";

export const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;

/** The preview's own leader keys (space m …) and the commands they run. */
export const PREVIEW_LEADER: ReadonlyMap<string, string> = new Map([
  ["mp", "preview"],
  ["ms", "preview-split"],
  ["mv", "preview-only"],
  ["mt", "preview-text"],
]);

/** Splits the text into the preview's blocks again (now, or after a moment of typing). */
export function refreshPreview(ed: EditorPane, cx: Context, now: boolean, d: Doc = ed.shown()): void {
  const apply = (cx: Context): void => {
    d.previewDue = false;
    d.preview.setText(d.text);
    loadPreviewImages(ed, cx, d);
    cx.notify();
  };

  if (now) return apply(cx);

  if (d.previewDue) return;

  d.previewDue = true;
  cx.timer.after(40, (cx) => apply(cx));
}

/** Split, preview only or text only: this tab's, and what the pane's new
 *  Markdown tabs start with (it remembers). */
export function setView(ed: EditorPane, view: EditorView, cx: Context): void {
  if (!ed.markdown) return ed.say("the preview is for Markdown files");

  ed.view = view;
  ed.defaultView = view;

  try {
    localStorage.setItem("preview", view);
  } catch {
    /* a nicety */
  }

  ed.driver = "editor";

  const d = ed.shown();

  if (view === "rendered") d.rendered?.open(cx);
  else if (d.previewStale) {
    d.previewStale = false;
    refreshPreview(ed, cx, true);
  }

  if (view === "preview") cx.timer.after(0, () => ed.previewHandle?.focus());
  else ed.focusText();

  ed.say(view === "rendered" ? "rendered: type into it" : view === "split" ? "preview beside the text" : view === "preview" ? "preview only (e: back to the text)" : "text only");
  cx.notify();
}

/** Copies the document's local images where they can be drawn. */
export function loadPreviewImages(ed: EditorPane, cx: Context, d: Doc = ed.shown()): void {
  if (ed.on) return;

  for (const part of d.preview.parts) {
    if (part.kind !== "images") continue;

    for (const img of part.images) copyImage(ed, img.src, cx, d);
  }
}

/** One picture's copy where it can be drawn (once: cacheImage names it by content). */
export function copyImage(ed: EditorPane, src: string, cx: Context, d: Doc): void {
  if (!isLocalSource(src)) return;

  const abs = join(dirname(d.path), decodeURI(src.split(/[?#]/)[0] ?? ""));

  if (d.images.has(abs)) return;

  if (!IMAGE_EXT.test(abs)) {
    d.images.set(abs, null);

    return;
  }

  d.images.set(abs, undefined);
  cx.spawn(async (cx) => {
    d.images.set(abs, await cacheImage(abs, MOD));
    cx.notify();
  });
}

/** cmd-v (and vim's p / P in normal mode) when the clipboard may hold a picture: a copied
 *  image file (its name is the clipboard's text) or no text at all (vim's p; cmd-v without
 *  text comes as the editor's paste_other). Taken: the clipboard is asked, and what isn't a
 *  picture is pasted as before. */
export function imagePasteKey(ed: EditorPane, e: KeyEvent, cx: Context): boolean {
  const m = e.modifiers;
  const mac = appWindow().platform === "macos";
  const cmdV = e.key === "v" && (mac ? m.platform && !m.control : m.control && !m.platform) && !m.alt && !m.shift;
  const vimP = ed.vimOn() && ed.vim.mode === "normal" && !ed.vim.keys.length && !ed.vim.pendingLeader && ed.vim.ex === null && (e.key === "p" || e.key_char === "P") && !m.platform && !m.control && !m.alt && !ed.imagePassP;

  if (!cmdV && !vimP) return false;

  let text: string | null = null;

  try {
    text = cx.read_from_clipboard() ?? null;
  } catch {
    /* no clipboard */
  }

  if (cmdV && !maybeCopiedImage(text)) return false;

  if (vimP && text && !maybeCopiedImage(text)) return false;

  cx.spawn(async (cx) => {
    const done = await pasteImageBlock(ed, cx, { quiet: true });

    if (done) return;

    if (cmdV && text !== null) typeText(ed, text, cx);
    else if (vimP) {
      ed.imagePassP = true;

      try {
        ed.vimKey(e, cx);
      } finally {
        ed.imagePassP = false;
      }

      ed.cur?.rendered?.pull(cx);
    }

    cx.notify();
  });

  return true;
}

/** Text at the caret, as the editor's own paste would (one edit). */
export function typeText(ed: EditorPane, text: string, cx: Context): void {
  const d = ed.shown();
  const rendered = d.view === "rendered" ? d.rendered : null;
  const s = rendered ? rendered.selection() : d.editor.selection();

  d.editor.edit([{ start: s.start, end: s.end, text }]);

  const lines = text.split("\n");
  const line = s.start.line + lines.length - 1;
  const col = (lines.length > 1 ? 0 : s.start.col) + (lines.at(-1) ?? "").length;

  d.editor.set_cursor(line, col);

  if (rendered) rendered.pull(cx);

  ed.changed(cx, d);
}

/** The clipboard's picture into the shown Markdown tab: saved beside it (images.ts
 *  assetPlace) and an image block at the caret. -> whether there was one. */
export async function pasteImageBlock(ed: EditorPane, cx: Context, { quiet = false }: { readonly quiet?: boolean } = {}): Promise<boolean> {
  const d = ed.cur;

  if (!d?.markdown || !d.path || ed.on) {
    if (!quiet) ed.say("pasting a picture works in a Markdown file on this machine", true);

    return false;
  }

  const tmp = `${appHome()}/cache/${MOD}/clip-${stamp()}-${Math.random().toString(36).slice(2, 6)}.png`;

  await herdr.exec("mkdir", ["-p", dirname(tmp)]).catch(() => null);

  const got = await readClipboardImage(herdr.exec, appWindow().platform, tmp);

  if (!got) {
    if (!quiet) ed.say("the clipboard holds no picture");

    cx.notify();

    return false;
  }

  const ext = got.kind === "file" ? (got.path.split(".").pop() || "png").toLowerCase() : "png";
  const place = assetPlace(d.path, { scratch: d.scratch, ext });
  // Into its place: the clipboard's PNG moved, a copied file copied (the original stays where it was).
  const r = await herdr.exec("sh", ["-c", 'mkdir -p "$1" && if [ "$4" = file ]; then cp "$2" "$3"; else mv "$2" "$3"; fi', "paste-image", place.dir, got.path, place.path, got.kind]).catch(() => null);

  if (r?.code !== 0) {
    ed.say(`couldn't save the picture: ${(r?.stderr ?? "").trim() || "no answer"}`, true);
    cx.notify();

    return true;
  }

  const alt = got.kind === "file" ? basename(got.path).replace(/\.[^.]+$/, "") : "";

  insertImageBlock(ed, imageMarkdown(place.rel, alt), cx);
  ed.say(`pasted: ${place.rel}`);

  return true;
}

/** The system's file picker: an image block for the chosen picture (a relative path to it). */
export function pickImage(ed: EditorPane, cx: Context): void {
  const d = ed.cur;

  if (!d?.path || ed.on) return ed.say("pick a picture in a file on this machine", true);

  cx.spawn(async (cx) => {
    const file = await herdr.pickFile({ prompt: "Insert" }).catch(() => null);

    if (!file) return;

    if (!isImagePath(file)) {
      ed.say(`not a picture: ${basename(file)}`, true);
      cx.notify();

      return;
    }

    insertImageBlock(ed, imageMarkdown(relative(dirname(d.path), file), basename(file).replace(/\.[^.]+$/, "")), cx);
    cx.notify();
  });
}

/** An image line at the caret (its own block: the caret's blank line, else after its block), one undoable edit. */
export function insertImageBlock(ed: EditorPane, md: string, cx: Context): void {
  const d = ed.shown();
  const rendered = d.view === "rendered" ? d.rendered : null;
  const text = d.editor.value();
  const caret = rendered ? rendered.selection().end.line : d.editor.cursor().line;
  // After the caret's whole block (the lit lines; in the text view the unit holding the caret).
  const end = rendered && caret >= rendered.range.from && caret <= rendered.range.to ? (rendered.unit.kind !== "blank" ? rendered.range.to : caret) : unitFor(liveUnits(text), caret).to;
  const r = insertImage(text, caret, md, end);
  const e = editBetween(text, r.text);

  if (e) d.editor.edit([e]);

  d.editor.set_cursor(r.line, 0);

  if (rendered) {
    rendered.pull(cx);
    rendered.focus();
  }

  ed.changed(cx, d);
}

/** Copies the pictures of `srcs` where they can be drawn (once each: cacheImage names them by content). */
export function loadImageSrcs(ed: EditorPane, srcs: readonly string[], cx: Context): void {
  const d = ed.cur;

  if (!d || ed.on) return;

  for (const src of srcs) copyImage(ed, src, cx, d);
}

export function imageOf(ed: EditorPane, src: string): Picture {
  if (!isLocalSource(src) || ed.on) return { abs: null, name: null };

  const abs = join(dirname(ed.path), decodeURI(src.split(/[?#]/)[0] ?? ""));
  const name = ed.images.get(abs);

  return { abs, name: name ? `cache/${MOD}/${name}` : name };
}

/** A preview link: a heading here, another Markdown file in the editor,
 *  pictures and the like in the preview pane, web pages as the app opens them. */
export function previewLink(ed: EditorPane, href: string, cx: Context): void {
  const to = follow(href, ed.path);

  if (!to) return;

  const here = (anchor: string): void => {
    const d = ed.shown();

    if (d.previewStale) {
      d.previewStale = false;
      d.preview.setText(d.text);
    }

    if (!ed.preview.scrollTo(anchor)) return;

    // The text goes there too: the heading's line.
    const part = ed.preview.parts.find((p) => (p.kind === "md" && p.anchor === anchor) || p.anchors?.includes(anchor) || (p.kind === "footnotes" && p.notes.some((n) => n.anchor === anchor)));
    const line = (part?.kind === "footnotes" ? part.notes.find((n) => n.anchor === anchor)?.from : undefined) ?? part?.from;

    if (line !== undefined && ed.view !== "preview") {
      ed.previewDrove = Date.now();
      ed.driver = "preview";
      ed.editor.set_cursor(line, 0);
      ed.editor.scroll_to_line(line);
    }
  };

  if (to.kind === "anchor") here(to.anchor);
  else if (to.kind === "markdown") {
    if (to.path === ed.path) {
      if (to.anchor) here(to.anchor);
    } else ed.openFile(to.path, cx);
  } else if (to.kind === "web") run("app.open_url", { url: to.url });
  else if (to.kind === "file" && PREVIEWED.test(to.path)) ed.openLooked(to.path, cx);
  else if (to.kind === "file" && languageOf(to.path)) ed.openFile(to.path, cx);
  else if (!ed.on) {
    const platform = appWindow().platform;
    const opener = platform === "windows" ? null : platform === "macos" ? "open" : "xdg-open";

    if (opener) exec(opener, [to.kind === "file" ? to.path : to.url]).catch(() => null);
  }

  cx.notify();
}

/** A task box ticked in the preview: [ ] <-> [x] in the text, one undoable edit. */
export function tick(ed: EditorPane, line: number, cx: Context): void {
  const edit = taskToggle(ed.text, line);

  if (!edit) return;

  ed.editor.edit([{ start: { line, col: edit.col }, end: { line, col: edit.col + 1 }, text: edit.text }]);
  ed.changed(cx);
}

/** Keys while the preview alone has the keyboard: the viewer's scrolling, and back to the text. */
export function previewKey(ed: EditorPane, e: KeyEvent, cx: Context): void {
  const k = e.key;
  const m = e.modifiers;

  if (m.platform || m.alt) return;

  const doc = ed.preview;
  const page = Math.max(80, doc.viewH / 2);

  if (ed.leaderAt && Date.now() - ed.leaderAt < 1500) {
    const seq = ed.leaderKeys + k;

    if (seq === "m") {
      ed.leaderKeys = "m";
      cx.stop_propagation();

      return;
    }

    ed.leaderAt = 0;
    ed.leaderKeys = "";

    const go = PREVIEW_LEADER.get(seq);

    if (go) {
      ed.command(go, cx);
      cx.stop_propagation();
      cx.notify();
    }

    return;
  }

  if (m.control) {
    if (k === "d") doc.scroll(page);
    else if (k === "u") doc.scroll(-page);
    else return;
  } else if (k === "j" || k === "down") doc.scroll(60);
  else if (k === "k" || k === "up") doc.scroll(-60);
  else if (k === "d" || k === "pagedown") doc.scroll(page);
  else if (k === "u" || k === "pageup") doc.scroll(-page);
  else if (k === "G" || (k === "g" && m.shift) || k === "end") doc.scroll(1e9);
  else if (k === "g" || k === "home") {
    if (k === "home" || Date.now() - ed.gAt < 500) {
      ed.gAt = 0;
      doc.scrollY = 0;
    } else ed.gAt = Date.now();
  } else if (k === "space" && ed.vimOn()) {
    ed.leaderAt = Date.now();
    ed.leaderKeys = "";
  } else if (k === "space") doc.scroll(page);
  else if (k === "e" || k === "i" || k === "escape") return setView(ed, "split", cx);
  else return;

  cx.stop_propagation();
  cx.notify();
}

/** The preview, following the text when the text scrolled last. */
export function previewView(ed: EditorPane, t: Theme): Element {
  const doc = ed.preview;

  if (ed.view === "split" && ed.driver === "editor") {
    const top = ed.editor.top_line();

    if (top !== null) doc.setScroll(doc.yOfLine(top) - 4);
  }

  const focused = ed.view === "preview" && ed.previewHandle?.is_focused() === true;

  return focusOn(v_flex().id("editor-preview").relative().flex_1().min_w(0).min_h(0).bg(t.background), ed.previewHandle)
    .on_key_down((e, cx) => previewKey(ed, e, cx))
    .on_mouse_down("left", () => {
      if (ed.view === "preview") ed.previewHandle?.focus();
    })
    .child(
      doc.render(t, {
        onLink: (url, cx) => previewLink(ed, url, cx),
        onTask: (line, cx) => tick(ed, line, cx),
        image: (src) => imageOf(ed, src),
        // A drawn picture: a drawn tab here (through the open record, answered with a context in render).
        onImage: (abs) => {
          if (ed.slot && abs) writeShared(setShared, OPEN_KEY, { slot: ed.slot, path: abs, look: true, n: (readShared(shared, OPEN_KEY, null)?.n ?? 0) + 1, at: Date.now() });
        },
        dither: (color) => dither(color, 1),
        focused,
        size: 13,
        maxWidth: ed.view === "preview" ? 780 : 720,
        unzoom: (v) => v / zoom(),
        notify: (cx) => cx.notify(),
        onScroll: () => {
          // The preview scrolled by hand: the text follows it.
          ed.driver = "preview";

          if (ed.view !== "split") return;

          ed.previewDrove = Date.now();
          ed.editor.scroll_to_line(doc.lineAtY(doc.scrollY + 4));
        },
      }),
    );
}

export async function closePane(ed: EditorPane): Promise<void> {
  // A scratchpad writes what waits before it goes.
  await Promise.all(ed.allDocs().map((d) => d.autosave?.flush().catch(() => null)));

  const ids = new Set<number>();

  for (const d of ed.allDocs()) {
    d.gone = true;

    const id = serverId(d.server);

    if (id === null) continue;

    lspNotify(id, "textDocument/didClose", { textDocument: { uri: uri(d.path) } });
    ids.add(id);
  }

  for (const id of ids) lspRelease(id);

  setUnsaved(null);

  const slot = ed.slot;

  if (slot) {
    const titles = readSharedMap(shared, TITLES_KEY);

    if (titles.has(slot)) writeSharedMap(setShared, TITLES_KEY, new Map([...titles].filter(([k]) => k !== slot)));

    const paths = editorPaths(shared);

    if (paths.has(slot)) writeSharedMap(setShared, PATHS_KEY, new Map([...paths].filter(([k]) => k !== slot)));
  }
}
