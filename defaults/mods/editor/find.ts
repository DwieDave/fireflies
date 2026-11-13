// The editor pane's find and replace, go to line and the problems' steps
// (main.ts), and the find line drawn.

import type EditorPane from "./main.ts";
import type { Stop } from "./form-keys.ts";
import { formKey, tabActions } from "./form-keys.ts";
import { nextProblem, parseGoto } from "./lsp-replies.ts";
import { h_flex, Input, v_flex } from "gpui-base";
import type { Context, Element, KeyEvent } from "gpui-kit";
import { div } from "gpui-kit";
import type { Theme } from "herdr";
import { settings, window as appWindow } from "herdr";
import { dither, FIND, focusOn } from "./pane-kit.ts";
import { closeCard, showCard } from "./card.ts";

// The find line's stops in tab order (form-keys.ts): the find field, Aa, ‹, ›
// and, replacing, the "with" field, replace, all.
export const FIND_STOPS: readonly Stop[] = [{ id: "find", kind: "text" }, { id: "case", kind: "toggle" }, { id: "prev", kind: "button" }, { id: "next", kind: "button", submit: true }];

export const REPLACE_STOPS: readonly Stop[] = [...FIND_STOPS, { id: "with", kind: "text" }, { id: "replace-one", kind: "button" }, { id: "replace-all", kind: "button" }];

export function gotoPlace(ed: EditorPane, line: number, col: number, cx: Context): void {
  closeCard(ed, cx);
  ed.editor.set_cursor(line, col);
  // Before the first layout there's nothing to scroll: try again once drawn.
  cx.timer.after(60, () => ed.editor.set_cursor(line, col));

  // The rendered view lights the block holding that line.
  const d = ed.cur;

  if (d?.markdown && d.view === "rendered" && d.rendered) {
    d.rendered.open(cx);
    d.rendered.focus();

    return;
  }

  ed.editor.focus();
}

export function goLine(ed: EditorPane, cx: Context): void {
  const g = parseGoto(ed.lineInput?.value());

  if (!g) return;

  ed.mode = null;
  gotoPlace(ed, g.line - 1, g.col - 1, cx);
  cx.notify();
}

export function problem(ed: EditorPane, dir: number, cx: Context): void {
  const at = ed.editor.cursor();
  const d = nextProblem(ed.problems, at.line, at.col, dir);

  if (!d) return ed.say("no problems");

  gotoPlace(ed, d.line, d.col, cx);
  showCard(ed, d.line, d.col, true, cx);
}

export function openFind(ed: EditorPane, replace: boolean): void {
  ed.mode = replace ? "replace" : "find";
  ed.findAt = "find";

  const sel = ed.editor.selection();

  if (sel.text && !sel.text.includes("\n")) ed.findInput?.set_value(sel.text);

  ed.findInput?.focus();
}

export function search(ed: EditorPane, cx: Context): void {
  const q = ed.findInput?.value() ?? "";

  if (q) ed.find = ed.editor.find(q, { case_sensitive: ed.caseSensitive });
  else {
    ed.editor.find_close();
    ed.find = { count: 0, current: null };
  }

  cx.notify();
}

export function step(ed: EditorPane, d: number, cx: Context): void {
  if (!ed.findInput?.value()) return;

  ed.find = d > 0 ? ed.editor.find_next() : ed.editor.find_prev();
  cx.notify();
}

export function replaceFound(ed: EditorPane, all: boolean, cx: Context): void {
  if (!ed.findInput?.value()) return;

  ed.find = ed.editor.replace(ed.replaceInput?.value() ?? "", all);
  cx.notify();
}

/** The find line's keyboard to stop `id`: a field's input, or the line itself for a chip. */
export function findGo(ed: EditorPane, id: string): void {
  ed.findAt = id;

  if (id === "find") ed.findInput?.focus();
  else if (id === "with") ed.replaceInput?.focus();
  else ed.handle?.focus();
}

/** A key on the find line, as every form takes them (form-keys.ts): tab /
 *  shift-tab walk its fields and chips, wrapping; space / enter press a
 *  chip (Aa flips); a field keeps its own enter (next, or replace). */
export function findKey(ed: EditorPane, e: KeyEvent, cx: Context): void {
  if (ed.mode !== "find" && ed.mode !== "replace") return;

  const stops = ed.mode === "replace" ? REPLACE_STOPS : FIND_STOPS;
  const i = Math.max(0, stops.findIndex((s) => s.id === ed.findAt));
  const here = stops[i];
  const a = formKey(stops, i, e.key, e.modifiers, e.key_char ?? null);

  if (!a || !here || a.act === "type" || (a.act === "submit" && here.kind === "text")) return;

  const id = here.id;

  if (a.act === "move") findGo(ed, stops[a.to]?.id ?? "find");
  else if (a.act === "cancel") closeFind(ed, cx);
  else if (a.act === "flip" || (a.act === "press" && id === "case")) {
    ed.caseSensitive = !ed.caseSensitive;
    search(ed, cx);
  } else if (a.act === "press" && id === "prev") step(ed, -1, cx);
  else if (a.act === "press" && (id === "replace-one" || id === "replace-all")) ed.replace(id === "replace-all", cx);
  else if (a.act === "press" || a.act === "submit") step(ed, 1, cx);
  else if (a.act !== "none") return;

  cx.stop_propagation();
  cx.notify();
}

export function closeFind(ed: EditorPane, cx: Context): void {
  if (ed.mode === "find" || ed.mode === "replace") ed.editor.find_close();

  ed.mode = null;

  if (ed.view === "rendered" && ed.cur?.rendered) ed.cur.rendered.focus();
  else ed.editor.focus();

  cx.notify();
}

export function findLine(ed: EditorPane, t: Theme): Element {
  const line = ed.mode === "line";
  const font = settings().font_family || "JetBrains Mono";

  return focusOn(v_flex().id("editor-find").relative().flex_none(), ed.handle)
    .on_key_down((e, cx) => findKey(ed, e, cx))
    .map((el) => tabActions(el, (e, cx) => findKey(ed, e, cx)))
    .child(findRow(ed, t, line, font))
    .when(ed.mode === "replace", (el) => el.child(replaceRow(ed, t, font)))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
}

/** A chip on the find line; one with the keyboard wears the dialogs' ring: a band, an accent edge. */
function findChip(ed: EditorPane, t: Theme, id: string, label: string, on: boolean, go: (cx: Context) => void): Element {
  return (
    div()
      .id(id)
      .flex_none()
      .h(18)
      .px(6)
      .flex()
      .items_center()
      .border(1)
      .border_color(on || ed.findAt === id ? t.accent : t.ansi0)
      .text_color(on ? t.accent : ed.findAt === id ? t.foreground : t.muted)
      .when(ed.findAt === id, (el) => el.bg(t.ansi0))
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => {
        go(cx);
        cx.notify();
      })
      .child(label)
  );
}

/** A key and what it does, at the find line's right. */
function findHint(t: Theme, k: string, what: string): Element {
  return h_flex().flex_none().gap(4).child(div().text_color(t.accent).child(k)).child(div().text_color(t.dim).child(what));
}

/** The find (or go to line) row: its field, the count, case, previous / next, its keys. */
function findRow(ed: EditorPane, t: Theme, line: boolean, font: string): Element {
  const count = ed.find.count ? `${(ed.find.current ?? 0) + 1} / ${ed.find.count}` : ed.findInput?.value() ? "none" : "";
  const input = line ? ed.lineInput : ed.findInput;

  return (
    h_flex()
      .h(FIND)
      .px(12)
      .gap(10)
      .items_center()
      .child(
        div()
          .flex_none()
          .text_color(t.accent)
          .child(line ? "line" : "find"),
      )
      .child(
        div()
          .w(line ? 160 : 240)
          .flex_none()
          .h(20)
          .border_b(1)
          .border_color(t.accent)
          .when(Boolean(input), (el) => (input ? el.child(Input.new(input).size_full().text_size(12).font_family(font)) : el)),
      )
      .when(!line, (el) =>
        el
          .child(
            div()
              .flex_none()
              .text_color(ed.find.count ? t.foreground : t.dim)
              .child(count),
          )
          .child(
            findChip(ed, t, "case", "Aa", ed.caseSensitive, (cx) => {
              ed.caseSensitive = !ed.caseSensitive;
              search(ed, cx);
            }),
          )
          .child(findChip(ed, t, "prev", "‹", false, (cx) => step(ed, -1, cx)))
          .child(findChip(ed, t, "next", "›", false, (cx) => step(ed, 1, cx))),
      )
      .child(div().flex_1())
      .when(ed.size.width > 560, (el) =>
        el
          .child(line ? findHint(t, "enter", "go") : findHint(t, "enter", "next"))
          .child(line ? div() : findHint(t, "shift-enter", "prev"))
          .child(line ? div() : findHint(t, "tab ⇧tab", "move"))
          .child(findHint(t, "esc", "close")),
      )
  );
}

/** The replace row: its field, replace one or all, its keys. */
function replaceRow(ed: EditorPane, t: Theme, font: string): Element {
  const replaceInput = ed.replaceInput;

  return (
    h_flex()
      .h(FIND)
      .px(12)
      .gap(10)
      .items_center()
      .child(div().flex_none().text_color(t.accent).child("with"))
      .child(
        div()
          .w(240)
          .flex_none()
          .h(20)
          .border_b(1)
          .border_color(ed.findAt === "with" ? t.accent : t.ansi0)
          .when(Boolean(replaceInput), (el) => (replaceInput ? el.child(Input.new(replaceInput).size_full().text_size(12).font_family(font)) : el)),
      )
      .child(findChip(ed, t, "replace-one", "replace", false, (cx) => ed.replace(false, cx)))
      .child(findChip(ed, t, "replace-all", "all", false, (cx) => ed.replace(true, cx)))
      .child(div().flex_1())
      .when(ed.size.width > 560, (el) => el.child(findHint(t, "enter", "replace")).child(findHint(t, appWindow().platform === "macos" ? "⌘enter" : "ctrl-enter", "all")))
  );
}
