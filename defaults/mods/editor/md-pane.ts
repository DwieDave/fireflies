// The editor pane's Markdown: the rendered view's hooks and drawing, the
// Markdown commands (mdedit.ts) and their list, the scratchpad's autosave.

import type EditorPane from "./main.ts";
import { isString } from "./guard.ts";
import { syntaxColors } from "./logic.ts";
import type { Sel } from "./md-text.ts";
import { editBetween } from "./md-text.ts";
import { active as mdActive, commandInfo, COMMANDS as MD_COMMANDS, LEVELS as MD_LEVELS, run as mdCommand, tickLine } from "./mdedit.ts";
import type { RenderedHost } from "./rendered.ts";
import { noteName } from "./scratch.ts";
import { CARET } from "./vim.ts";
import { h_flex, v_flex } from "gpui-base";
import type { Context, Element, KeyEvent } from "gpui-kit";
import { div, svg } from "gpui-kit";
import type { Theme } from "herdr";
import { readTextFile, settings, theme, writeTextFile } from "herdr";
import type { Doc } from "./pane-kit.ts";
import { dither, errorText, HINTS, selectionColor, zoom } from "./pane-kit.ts";
import { imageOf, loadImageSrcs, pasteImageBlock, pickImage, previewLink } from "./preview-pane.ts";

/** A Markdown command's entry in the list: [title, its letter after cmd-., what it writes]. */
export type MdEntry = readonly [title: string, key: string, mark: string];

/** The image commands in the list (main.ts, not mdedit.ts: they ask the clipboard or a picker):
 *  name -> [title, its letter after cmd-., what it writes]. */
export const MD_IMAGE: ReadonlyMap<string, MdEntry> = new Map<string, MdEntry>([
  ["image", ["Image from a file", "p", "![](…)"]],
  ["image-paste", ["Paste an image", "v", "assets/"]],
]);

/** A command of the list by name: mdedit's, or one of the image ones. */
export const mdEntry = (name: string): MdEntry | undefined => commandInfo(name) ?? MD_IMAGE.get(name);

/** The Markdown commands that, from a caret in the rendered view, take the caret's whole block. */
export const WHOLE_BLOCK = new Set(["bullets", "numbers", "task", "tick", "quote", "fence"]);

/** The keyboard to the shown tab's text: the rendered view's block, else the code editor. */
export function focusText(ed: EditorPane): void {
  const d = ed.cur;

  if (!d) return;

  if (d.look) ed.lookHandle?.focus();
  else if (d.markdown && d.view === "rendered" && d.rendered) d.rendered.focus();
  else d.editor.focus();
}

/** What a tab's rendered view (rendered.ts) asks of the pane. */
export function renderedHost(ed: EditorPane): RenderedHost {
  return {
    font: settings().font_family || "JetBrains Mono",
    colors: ed.colors ?? syntaxColors(theme()),
    selection: selectionColor(theme()),
    zoom,
    dither: (color) => dither(color, 1),
    moon: (t) => svg("mods/nocturne/art/moon-8.svg").w(44).h(44).text_color(t.ansi8),
    onKey: (e, cx) => blockKey(ed, e, cx),
    link: (url, cx) => previewLink(ed, url, cx),
    notify: (cx) => cx?.notify(),
    mdRun: (name, cx) => runMdCommand(ed, name, cx),
    image: (src) => imageOf(ed, src),
    loadImages: (srcs, cx) => loadImageSrcs(ed, srcs, cx),
    pasteImage: (cx) => void pasteImageBlock(ed, cx),
    mdMenu: (cx) => openMdMenu(ed, cx),
    vim: () => ed.vimOn(),
  };
}

/** A key in the rendered view's block, before it: what the code editor would
 *  take first (the close question, the card, the app's keys, cmd-., vim over
 *  the whole text); the block then follows the caret. */
export function blockKey(ed: EditorPane, e: KeyEvent, cx: Context): boolean {
  const d = ed.cur;
  const taken = ed.vimKey(e, cx);

  if (d?.rendered) {
    if (taken) d.rendered.pull(cx);

    d.rendered.block.set_cursor_shape(ed.vimOn() ? CARET[ed.vim.mode] : "bar");
  }

  return taken;
}

/** Opens the Markdown commands' list (cmd-., vim: space .) at the caret. */
export function openMdMenu(ed: EditorPane, cx: Context): void {
  if (!ed.markdown) return ed.say("the Markdown commands are for Markdown files");

  ed.mdMenu = { at: Date.now() };
  cx.notify();
}

/** A key while the list is open: a command's letter (a digit: that heading level) runs it; anything else closes it. */
export function mdMenuKey(ed: EditorPane, e: KeyEvent, cx: Context): boolean {
  const k = e.key;
  const m = e.modifiers;

  if (["shift", "control", "alt", "platform", "function", "capslock"].includes(k)) return true;

  ed.mdMenu = null;

  const ch = isString(e.key_char) && e.key_char.length === 1 ? e.key_char : m.shift && k.length === 1 ? k.toUpperCase() : k;

  if (!m.platform && !m.control) {
    const name = MD_LEVELS.includes(ch) ? `heading-${ch}` : (Object.keys(MD_COMMANDS).find((n) => commandInfo(n)?.[1] === ch) ?? [...MD_IMAGE].find(([, entry]) => entry[1] === ch)?.[0]);

    if (name) runMdCommand(ed, name, cx);
  }

  cx.notify();

  return true;
}

/** Runs a Markdown command (mdedit.ts) on the shown tab's text and selection, as one undoable edit. */
export function runMdCommand(ed: EditorPane, name: string, cx: Context): void {
  ed.mdMenu = null;

  const d = ed.cur;

  if (!d?.markdown) return ed.say("the Markdown commands are for Markdown files");

  if (name === "image") return pickImage(ed, cx);

  if (name === "image-paste") {
    void pasteImageBlock(ed, cx);

    return;
  }

  if (d.state !== "ready" && d.state !== "missing") return;

  const rendered = d.view === "rendered" ? d.rendered : null;
  const text = d.editor.value();
  let sel: Sel = rendered ? rendered.selection() : d.editor.selection();
  // In the rendered view a caret stands for its whole block where a command
  // works line by line (a quote, a list, a code block); headings stay the caret's line.
  const caret = sel.start.line === sel.end.line && sel.start.col === sel.end.col ? sel.start : null;
  const whole = rendered && caret && WHOLE_BLOCK.has(name);

  if (rendered && whole) sel = { start: { line: rendered.range.from, col: 0 }, end: { line: rendered.range.to, col: text.split("\n")[rendered.range.to]?.replace(/\r$/, "").length ?? 0 } };

  let r = mdCommand(name, text, sel);

  if (r && whole && caret) {
    // The caret back where it was, moved with its line.
    const line = caret.line + (r.sel.start.line - sel.start.line);
    const was = text.split("\n")[caret.line] ?? "";
    const now = r.text.split("\n")[line] ?? "";
    const at = { line, col: Math.max(0, Math.min(now.length, caret.col + now.length - was.length)) };

    r = { text: r.text, sel: { start: at, end: at } };
  }

  const title = mdEntry(name)?.[0] ?? name.replace("heading-", "heading ");

  if (!r) {
    ed.say(`${title.toLowerCase()}: nothing to change here`);
    cx.notify();

    return;
  }

  const e = editBetween(text, r.text);

  if (e) d.editor.edit([e]);

  const { start, end } = r.sel;

  if (start.line === end.line && start.col === end.col) d.editor.set_cursor(start.line, start.col);
  else d.editor.set_cursor(start.line, start.col, end);

  // The rendered view follows the file's caret and selection (its block, edited in place).
  if (rendered) {
    rendered.pull(cx);
    rendered.focus();
  }

  ed.changed(cx, d);
}

/** A task box clicked in the rendered view: [ ] <-> [x], one undoable edit. */
export function tickRendered(ed: EditorPane, line: number, cx: Context): void {
  const d = ed.shown();
  const text = d.editor.value();
  const r = tickLine(text, line);

  if (!r) return;

  const e = editBetween(text, r.text);

  if (e) d.editor.edit([e]);

  ed.changed(cx, d);
}

/** A scratchpad's write: only over what was read (another pane on the same note
 *  may have written it); a note changed elsewhere asks as a file does. */
export async function autosaveWrite(ed: EditorPane, d: Doc): Promise<void> {
  const text = d.editor.value();

  d.writing = text;

  try {
    await writeTextFile(d.path, text, d.saved);
  } catch (cause) {
    d.writing = null;

    if (/changed outside/.test(errorText(cause))) {
      const disk = await readTextFile(d.path).catch(() => null);

      if (disk === text) {
        d.saved = text;

        return;
      }

      d.conflict = true;
    }

    throw cause instanceof Error ? cause : new Error(String(cause));
  }

  d.saved = text;
  d.writing = null;
  d.state = "ready";
  d.deleted = false;
}

/** The autosave's wait: a timer from the last change's task; the write in a task of its own. */
export function autosaveTimer(ed: EditorPane, ms: number, fn: () => Promise<void>): () => void {
  let off = false;
  const cx = ed.timerCx;

  if (!cx) {
    void fn();

    return () => {};
  }

  cx.timer.after(ms, (cx) => {
    if (off) return;

    cx.spawn(async (cx) => {
      try {
        await fn();
      } catch {
        /* the state says */
      }

      cx.notify();
    });
  });

  return () => {
    off = true;
  };
}

/** The rendered view of the shown tab. */
export function renderedView(ed: EditorPane, t: Theme): Element {
  const d = ed.shown();
  const rendered = d.rendered;

  if (!rendered) return div();

  const empty =
    d.scratch && !d.editor.value().trim()
      ? { title: `A page for ${noteName(d.path)}`, detail: "Kept under the app's folder, out of the repository; every worktree of it opens this one.", hint: `type, or ${ed.vimOn() ? "space ." : "cmd-."} for the Markdown commands` }
      : null;

  return rendered.view({
    t,
    focused: rendered.focused(),
    empty,
    maxWidth: 760,
    unzoom: (v) => v / zoom(),
    onTask: (line, cx) => tickRendered(ed, line, cx),
  });
}

/** The Markdown commands' list, which-key style, by the lit block (rendered) or the bar. */
export function mdMenuView(ed: EditorPane, t: Theme): Element {
  const d = ed.shown();
  const sel = d.view === "rendered" && d.rendered ? d.rendered.selection() : d.editor.selection();
  const on = mdActive(d.editor.value(), sel);
  const names: string[] = Object.keys(MD_COMMANDS);
  const row = (n: string): Element => mdRow(ed, t, n, on);
  const group = (name: string): Element => div().text_size(10.5).text_color(t.dim).mt(4).child(name);

  return v_flex()
    .id("editor-md-menu")
    .absolute()
    .right(16)
    .top(mdMenuTop(ed, d))
    .w(400)
    .bg(t.background)
    .border(1)
    .border_color(t.ansi0)
    .shadow_lg()
    .child(
      h_flex()
        .relative()
        .h(24)
        .px(12)
        .gap(10)
        .items_center()
        .child(div().text_color(t.accent).child(ed.vimOn() ? "space .  markdown" : "cmd-.  markdown"))
        .child(div().relative().flex_1().min_w(40).h(1).opacity(0.6).child(dither(t.ansi8, 1)))
        .child(div().text_color(t.dim).child("esc")),
    )
    .child(
      h_flex()
        .px(12)
        .pb(10)
        .gap(22)
        .items_start()
        .child(
          v_flex()
            .flex_1()
            .gap(2)
            .child(group("inline"))
            .children(names.slice(0, 4).map(row))
            .child(group("heading"))
            .children(names.slice(4, 6).map(row))
            // 0-6: a digit each, clickable (0: back to text).
            .child(
              h_flex()
                .gap(4)
                .items_center()
                .child(div().pr(4).text_color(t.foreground).child("level"))
                .children(MD_LEVELS.map((n) => levelChip(ed, t, n))),
            ),
        )
        .child(
          v_flex()
            .flex_1()
            .gap(2)
            .child(group("blocks"))
            .children(names.slice(6).map(row))
            .child(group("image"))
            .children([...MD_IMAGE.keys()].map(row)),
        ),
    );
}

/** Where the list sits: under the lit block (rendered), above it when it doesn't fit there; under the bar in the text views. */
function mdMenuTop(ed: EditorPane, d: Doc): number {
  const MENU_H = 270;
  const paneH = ed.size.height / zoom();
  let top = ed.textTop() + 8;

  if (d.view === "rendered" && d.rendered) {
    const litTop = ed.textTop() + d.rendered.litTop;
    const litBottom = litTop + d.rendered.litHeight();

    top = litBottom + 6 + MENU_H < paneH - HINTS ? litBottom + 6 : Math.max(ed.textTop() + 4, litTop - MENU_H - 6);
  }

  return top;
}

/** A command's row: its letter, its title (lit when it's on at the caret), the mark it writes; a click runs it. */
function mdRow(ed: EditorPane, t: Theme, n: string, on: ReadonlySet<string>): Element {
  const [title, key, mark] = mdEntry(n) ?? [n, "", ""];
  const lit = on.has(n) || (n.startsWith("heading") && [...on].some((x) => /^heading-\d/.test(x)));

  // A click runs it too (the pointer's way; the letter is the keyboard's).
  return h_flex()
    .id(`md-menu-${n}`)
    .gap(10)
    .px(4)
    .ml(-4)
    .cursor_pointer()
    .hover((s) => s.bg(t.ansi0))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => {
      cx.stop_propagation();
      runMdCommand(ed, n, cx);
      cx.notify();
    })
    .child(div().w(18).flex_none().text_color(t.accent).child(key))
    .child(
      div()
        .flex_1()
        .text_color(lit ? t.ansi5 : t.foreground)
        .child(title.replace(/^Heading level /, "level ")),
    )
    .child(div().flex_none().pl(12).text_color(t.dim).child(mark));
}

/** A heading level's digit (0: back to text); a click makes the caret's line that level. */
function levelChip(ed: EditorPane, t: Theme, n: string): Element {
  return (
    div()
      .id(`md-menu-level-${n}`)
      .w(16)
      .h(16)
      .flex()
      .items_center()
      .justify_center()
      .border(1)
      .border_color(t.ansi0)
      .text_color(t.accent)
      .cursor_pointer()
      .hover((s) => s.border_color(t.accent))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        runMdCommand(ed, `heading-${n}`, cx);
        cx.notify();
      })
      .child(n)
  );
}
