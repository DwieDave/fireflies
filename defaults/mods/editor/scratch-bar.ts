// A scratchpad's bar (pane-bar.ts draws it for a note): one quiet line,
// Developer's pick of two (2026-11-16, "Scratchpad toolbar way to
// overcrowded: multiple \"markdown\" labels"). It says what changes while he
// writes: vim's mode, the kind of block the caret is in (moved here from the
// lit block's corner, so the text being typed has the column's whole width)
// and the save; then two buttons: "format" (the Markdown commands, cmd-. /
// space .) and "more" (its menu: copy the note's path, the view, word wrap,
// vim). No language, indent, server or line:col: a note is always Markdown,
// and the pane's header names it.

import type EditorPane from "./main.ts";
import { kindWord } from "./rendered-column.ts";
import { tilde } from "./logic.ts";
import { focusText, openMdMenu } from "./md-pane.ts";
import { BAR, dither } from "./pane-kit.ts";
import { setWrap, toggleVim } from "./pane-vim.ts";
import { h_flex, v_flex } from "gpui-base";
import type { Color, Context, Element, KeyEvent } from "gpui-kit";
import { div, svg } from "gpui-kit";
import type { Theme } from "herdr";
import { home, notify } from "herdr";

/** The more button's mark: three dots on the pixel grid. */
const MORE = "mods/editor/art/more.svg";

/** What the bar takes from pane-bar.ts (its own parts, shared). */
export interface BarParts {
  readonly mode: () => Element;
  readonly problems: () => Element[];
  readonly message: () => Element | null;
}

/** An entry of the more menu: its letter, its title, what it shows on the right, what it does. */
interface MoreItem {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly group: string;
  readonly note: (ed: EditorPane, t: Theme) => readonly [string, Color] | null;
  readonly run: (ed: EditorPane, cx: Context) => void;
}

/** The note's path to the clipboard, a toast saying so (nocturne.scratchpad-copy-path does it from anywhere). */
export function copyNotePath(ed: EditorPane, cx: Context): void {
  const path = ed.on ? `${ed.on}:${ed.path}` : ed.path;

  cx.write_to_clipboard(path);

  try {
    notify({ title: "copied the scratchpad's path", body: tilde(path, home()), level: "success" });
  } catch {
    ed.say("copied its path");
  }
}

const on = (yes: boolean, t: Theme, color: Color): readonly [string, Color] => (yes ? ["on", color] : ["off", t.dim]);

/** The more menu's entries, in its order. */
export const MORE_ITEMS: readonly MoreItem[] = [
  { id: "copy-path", key: "y", title: "Copy its path", group: "this note", note: (ed, t) => [ed.path.split("/").pop() ?? "", t.dim], run: copyNotePath },
  { id: "rendered", key: "r", title: "Rendered", group: "view", note: (ed, t) => (ed.view === "rendered" ? ["shown", t.ansi5] : null), run: (ed, cx) => ed.command("preview-rendered", cx) },
  { id: "text", key: "e", title: "Text", group: "view", note: (ed, t) => (ed.view === "text" ? ["shown", t.ansi5] : null), run: (ed, cx) => ed.command("preview-text", cx) },
  { id: "split", key: "s", title: "Split with the preview", group: "view", note: (ed, t) => (ed.view === "split" ? ["shown", t.ansi5] : null), run: (ed, cx) => ed.command("preview-split", cx) },
  { id: "wrap", key: "w", title: "Word wrap", group: "view", note: (ed, t) => on(ed.softWrap, t, t.ansi4), run: (ed, cx) => setWrap(ed, null, cx) },
  { id: "vim", key: "v", title: "Vim", group: "view", note: (ed, t) => on(ed.vimOn(), t, t.accent), run: (ed, cx) => toggleVim(ed, cx) },
];

/** Opens or closes the more menu (the keyboard stays in the text: the menu's letters reach it through vimKey). */
export function toggleMore(ed: EditorPane, cx: Context): void {
  ed.moreMenu = ed.moreMenu ? null : { at: Date.now() };
  ed.mdMenu = null;
  focusText(ed);
  cx.notify();
}

/** Runs an entry of the more menu and closes it. */
export function runMore(ed: EditorPane, item: MoreItem, cx: Context): void {
  ed.moreMenu = null;
  item.run(ed, cx);
  focusText(ed);
  cx.notify();
}

/** A key while the more menu is open: an entry's letter runs it; anything else closes it. */
export function moreKey(ed: EditorPane, e: KeyEvent, cx: Context): boolean {
  if (["shift", "control", "alt", "platform", "function", "capslock"].includes(e.key)) return true;

  const m = e.modifiers;
  const item = !m.platform && !m.control && !m.alt ? MORE_ITEMS.find((x) => x.key === e.key) : undefined;

  if (item) runMore(ed, item, cx);
  else {
    ed.moreMenu = null;
    cx.notify();
  }

  return true;
}

/** The kind of block the caret is in (rendered), else the view's name. */
function where(ed: EditorPane): string {
  const r = ed.cur?.rendered;

  return ed.view === "rendered" && r ? kindWord(r.unit) : ed.view;
}

/** The save: a quiet "saved" (its green square), "saving…" (yellow), "not saved" (red). */
function saveWord(ed: EditorPane, t: Theme): Element {
  const st = ed.saveState;
  const color = st === "error" ? t.ansi1 : st === "saved" ? t.ansi2 : t.ansi3;

  return h_flex()
    .id("bar-autosave")
    .flex_none()
    .gap(6)
    .items_center()
    .text_color(st === "saved" ? t.dim : color)
    .child(div().relative().size(7).border(1).border_color(color).child(dither(color, 1)))
    .child(st === "error" ? "not saved" : st === "saved" ? "saved" : "saving…");
}

/** "format": the Markdown commands' list (a click opens it at the caret; its key beside it). */
function formatChip(ed: EditorPane, t: Theme): Element {
  return h_flex()
    .id("bar-md")
    .flex_none()
    .h(18)
    .px(6)
    .gap(6)
    .items_center()
    .border(1)
    .border_color(ed.mdMenu ? t.accent : t.ansi0)
    .text_color(ed.mdMenu ? t.accent : t.foreground)
    .hover((s) => s.border_color(t.ansi8))
    .tooltip("bold, headings, lists, tasks, quotes, code: the Markdown commands")
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => {
      ed.moreMenu = null;

      if (ed.mdMenu) {
        ed.mdMenu = null;
        focusText(ed);
        cx.notify();
      } else {
        openMdMenu(ed, cx, true);
        focusText(ed);
      }
    })
    .child("format")
    .child(div().text_color(t.dim).child(ed.vimOn() ? "space ." : "cmd-."));
}

/** "more": the menu of the rest (lit while it's open). */
function moreChip(ed: EditorPane, t: Theme): Element {
  const open = Boolean(ed.moreMenu);

  return div()
    .id("bar-more")
    .flex_none()
    .h(18)
    .w(26)
    .flex()
    .items_center()
    .justify_center()
    .border(1)
    .border_color(open ? t.accent : t.ansi0)
    .hover((s) => s.border_color(t.ansi8))
    .tooltip("copy its path, the view, word wrap, vim")
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => toggleMore(ed, cx))
    .child(svg(MORE).size(12).text_color(open ? t.accent : t.muted));
}

/** A scratchpad's bar: vim's mode, the caret's block, the save, format and more. */
export function scratchBar(ed: EditorPane, t: Theme, parts: BarParts): Element {
  const vim = ed.vimOn();
  const recording = ed.vim.recording;
  const msg = parts.message();

  return h_flex()
    .id("editor-bar")
    .h(BAR)
    .flex_none()
    .px(12)
    .gap(10)
    .items_center()
    .border_b(1)
    .border_color(t.ansi0)
    .when(vim, (el) => el.child(parts.mode()))
    .when(vim && Boolean(recording), (el) => (recording ? el.child(div().flex_none().text_color(t.ansi1).child(`rec @${recording.reg}`)) : el))
    .child(div().id("bar-kind").flex_none().text_color(t.muted).child(where(ed)))
    .when(ed.deleted, (el) => el.child(div().id("bar-deleted").flex_none().text_color(t.ansi1).child("deleted · it's written again as you type")))
    .child(div().flex_1().min_w(0))
    .when(Boolean(msg), (el) => (msg ? el.child(msg) : el))
    .children(parts.problems())
    .child(saveWord(ed, t))
    .child(formatChip(ed, t))
    .child(moreChip(ed, t));
}

/** The more menu, under the bar at the right. */
export function moreView(ed: EditorPane, t: Theme): Element {
  let group = "";
  const rows: Element[] = [];

  for (const item of MORE_ITEMS) {
    if (item.group !== group) {
      group = item.group;
      rows.push(div().px(12).pt(6).pb(2).text_size(10.5).text_color(t.dim).child(group));
    }

    const note = item.note(ed, t);

    rows.push(
      h_flex()
        .id(`more-${item.id}`)
        .px(12)
        .py(3)
        .gap(10)
        .items_center()
        .cursor_pointer()
        .hover((s) => s.bg(t.ansi0))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => {
          cx.stop_propagation();
          runMore(ed, item, cx);
        })
        .child(div().w(14).flex_none().text_color(t.accent).child(item.key))
        .child(div().flex_none().text_color(t.foreground).child(item.title))
        .child(div().flex_1().min_w(0))
        .when(Boolean(note), (el) => (note ? el.child(div().min_w(0).truncate().text_color(note[1]).child(note[0])) : el)),
    );
  }

  return v_flex()
    .id("editor-more-menu")
    .absolute()
    .right(10)
    .top(ed.stripH() + BAR + 2)
    .w(300)
    .py(4)
    .bg(t.background)
    .border(1)
    .border_color(t.ansi0)
    .shadow_lg()
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .children(rows);
}
