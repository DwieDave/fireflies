// The editor pane's lines and panels drawn under the bar (main.ts render
// places them): the close question, the ex line, the leader's keys, a
// conflict, the body, the problems' drawer, the hints and keys strip.

import type EditorPane from "./main.ts";
import { hint, keysHint, keysKey, keysView } from "./keyhelp.ts";
import { basename, editorKeys, hintList } from "./logic.ts";
import { LOOK_KEYS } from "./tabs.ts";
import { Editor, h_flex, v_flex } from "gpui-base";
import type { Context, Element, KeyEvent } from "gpui-kit";
import { div, svg } from "gpui-kit";
import type { Theme } from "herdr";
import { readTextFile, settings, setUnsaved } from "herdr";
import type { Answer } from "./pane-kit.ts";
import { codeAndSource, dither, FIND, focusOn, GUTTER_INSET, HINTS, serverId, severityColors } from "./pane-kit.ts";
import { lookHints } from "./drawn-tabs.ts";
import { renderedView } from "./md-pane.ts";
import { answerClose } from "./pane-tabs.ts";
import { previewView } from "./preview-pane.ts";

export const DRAWER = 132;

export const ROW = 24;

// Under this width a split puts the preview under the text.
export const SIDE_BY_SIDE = 760;

export const ANSWERS: readonly Answer[] = ["save", "discard", "keep"];

/** Closing a tab with unsaved changes asks here: save and close, discard, or keep. */
export function askLine(ed: EditorPane, t: Theme): Element {
  const a = ed.asking;

  if (!a) return div();

  const chip = (id: Answer, label: string, k: string): Element =>
    div()
      .id(`editor-ask-${id}`)
      .flex_none()
      .h(18)
      .px(6)
      .flex()
      .items_center()
      .gap(6)
      .border(1)
      .border_color(a.at === id ? t.accent : t.ansi0)
      .text_color(a.at === id ? t.foreground : t.muted)
      .when(a.at === id, (el) => el.bg(t.ansi0))
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => {
        answerClose(ed, id, cx);
        cx.notify();
      })
      .child(div().child(label))
      .child(div().text_color(t.accent).child(k));

  return h_flex()
    .id("editor-ask")
    .relative()
    .h(FIND)
    .flex_none()
    .px(12)
    .gap(10)
    .items_center()
    .child(div().absolute().inset_0().opacity(0.25).child(dither(t.ansi3, 1)))
    .child(div().relative().flex_1().min_w(0).truncate().text_color(t.ansi3).child(`${basename(a.doc.path)} has unsaved changes. Close it?`))
    .child(chip("save", "save & close", "s"))
    .child(chip("discard", "discard", "d"))
    .child(chip("keep", "keep open", "esc"));
}

/** The question's keys (it holds the keyboard while it shows): s / d / esc
 *  (n) answer, tab / ← → move between the answers, enter / space press. */
export function askKey(ed: EditorPane, e: KeyEvent, cx: Context): boolean {
  const a = ed.asking;
  const k = e.key;
  const m = e.modifiers;

  if (!a) return false;

  if (["shift", "control", "alt", "platform", "function", "capslock"].includes(k)) return false;

  if (m.platform) return false;

  const i = ANSWERS.indexOf(a.at);
  const n = ANSWERS.length;

  if (k === "escape" || k === "n") answerClose(ed, "keep", cx);
  else if (k === "s" || k === "y") answerClose(ed, "save", cx);
  else if (k === "d") answerClose(ed, "discard", cx);
  else if (k === "enter" || k === "space") answerClose(ed, a.at, cx);
  else if (k === "tab" || k === "right" || k === "l") a.at = ANSWERS[(i + (m.shift && k === "tab" ? n - 1 : 1)) % n] ?? a.at;
  else if (k === "left" || k === "h") a.at = ANSWERS[(i + n - 1) % n] ?? a.at;

  cx.notify();

  return true;
}

/** Vim's ex line (`:`, `/`, `?`), under the bar. */
export function exLine(ed: EditorPane, t: Theme, code: string): Element {
  const ex = ed.vim.ex ?? "";
  const lead = ex.startsWith("/") || ex.startsWith("?") ? (ex[0] ?? ":") : ":";
  const body = lead === ":" ? ex : ex.slice(1);
  const ui = settings().ui_font_family || "Geist";

  return h_flex()
    .id("editor-ex")
    .relative()
    .h(FIND)
    .flex_none()
    .px(12)
    .gap(2)
    .items_center()
    .font_family(code)
    .text_size(12.5)
    .child(div().flex_none().text_color(t.accent).child(lead))
    .child(div().flex_none().text_color(t.foreground).child(body))
    .child(div().w(7).h(15).flex_none().bg(t.foreground))
    .child(div().flex_1())
    .child(h_flex().flex_none().gap(4).font_family(ui).text_size(11).child(div().text_color(t.accent).child("enter")).child(div().text_color(t.dim).child("run")))
    .child(h_flex().flex_none().gap(4).font_family(ui).text_size(11).child(div().text_color(t.accent).child("esc")).child(div().text_color(t.dim).child("cancel")))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
}

/** The leader's next keys, which-key style, bottom right over the text. */
export function whichView(ed: EditorPane, t: Theme): Element {
  const list = ed.which ?? [];
  const cols = list.length > 6 ? 2 : 1;
  const rows = Math.ceil(list.length / cols);

  return v_flex()
    .id("editor-which")
    .absolute()
    .right(12)
    .bottom(HINTS + 8)
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
        .child(div().text_color(t.accent).child(ed.pending ? `leader ${ed.pending}` : "leader"))
        .child(div().relative().flex_1().min_w(40).h(1).opacity(0.6).child(dither(t.ansi8, 1)))
        .child(div().text_color(t.dim).child("esc")),
    )
    .child(
      h_flex()
        .px(12)
        .pb(8)
        .gap(18)
        .children(
          Array.from({ length: cols }, (_, c) =>
            v_flex()
              .gap(2)
              .children(
                list.slice(c * rows, (c + 1) * rows).map((w, i) =>
                  h_flex()
                    .id(`which-${c}-${i}`)
                    .gap(10)
                    .child(div().w(36).text_color(t.accent).child(w.key))
                    .child(
                      div()
                        .text_color(w.label.startsWith("+") ? t.ansi5 : t.foreground)
                        .child(w.label),
                    ),
                ),
              ),
          ),
        ),
    );
}

export function conflictLine(ed: EditorPane, t: Theme): Element {
  const chip = (id: string, go: (cx: Context) => void): Element =>
    div()
      .id(id)
      .flex_none()
      .px(6)
      .h(18)
      .flex()
      .items_center()
      .border(1)
      .border_color(t.ansi0)
      .text_color(t.foreground)
      .hover((s) => s.border_color(t.accent))
      .on_click((_e, cx) => {
        go(cx);
        cx.notify();
      });

  return h_flex()
    .id("editor-conflict")
    .relative()
    .h(FIND)
    .flex_none()
    .px(12)
    .gap(10)
    .items_center()
    .child(div().absolute().inset_0().opacity(0.25).child(dither(t.ansi3, 1)))
    .child(div().relative().flex_1().min_w(0).truncate().text_color(t.ansi3).child("Changed on disk while you edited it."))
    .child(
      chip("conflict-reload", (cx) => {
        ed.dirty = false;
        setUnsaved(null);
        ed.load(cx, null, false);
      }).child("reload theirs"),
    )
    .child(
      chip("conflict-keep", (cx) => {
        ed.conflict = false;
        keepMine(ed, cx);
      }).child("keep mine"),
    );
}

/** Keeping my version: what's on disk now becomes what saving replaces. */
export function keepMine(ed: EditorPane, cx: Context): void {
  cx.spawn(async (cx) => {
    try {
      ed.saved = await readTextFile(ed.path, { on: ed.on });
    } catch {
      /* saved stays */
    }

    // A scratchpad writes yours over theirs by itself.
    if (ed.scratch) {
      ed.timerCx = cx;
      ed.autosave?.touch();
      ed.say("yours is kept: written in a moment");
    } else ed.say("yours is kept: cmd-s writes it over theirs");

    cx.notify();
  });
}

export function bodyView(ed: EditorPane, t: Theme, code: string): Element {
  if (ed.state === "error") return noteView(ed, t, "Can't edit this file", ed.error);

  if (ed.state === "loading") return noteView(ed, t, "Reading…", null);

  const text = div()
    .id("editor-body")
    .relative()
    .flex_1()
    .min_h(0)
    .min_w(0)
    .pl(GUTTER_INSET)
    .when(ed.state === "missing", (el) => el.child(div().absolute().top(6).right(14).text_color(t.dim).child("new file: cmd-s creates it")))
    .child(Editor.new(ed.editor).size_full().font_family(code));

  const d = ed.shown();

  if (d.markdown && d.view === "rendered" && d.rendered) return renderedView(ed, t);

  if (!ed.markdown || ed.view === "text") return text;

  if (ed.view === "preview") return previewView(ed, t);

  const side = ed.size.width >= SIDE_BY_SIDE;

  const rule = div()
    .relative()
    .flex_none()
    .when(side, (el) => el.w(1).h_full())
    .when(!side, (el) => el.h(1).w_full())
    .child(dither(t.ansi8, 1));

  // A plain row: h_flex centers its children, which would leave them no height.
  return (side ? div().flex().flex_row() : div().flex().flex_col())
    .id("editor-split")
    .flex_1()
    .min_h(0)
    .min_w(0)
    .child(text)
    .child(rule)
    .child(previewView(ed, t));
}

export function noteView(ed: EditorPane, t: Theme, title: string, detail: string | null): Element {
  return v_flex()
    .flex_1()
    .min_h(0)
    .items_center()
    .justify_center()
    .gap(10)
    .px(16)
    .child(svg("mods/nocturne/art/moon-8.svg").w(44).h(44).text_color(t.ansi8).opacity(0.6))
    .child(div().text_color(t.foreground).child(title))
    .when(Boolean(detail), (el) => (detail ? el.child(div().text_center().text_color(t.ansi8).child(detail)) : el));
}

export function drawerView(ed: EditorPane, t: Theme): Element {
  const sevColor = severityColors(t);
  const at = ed.editor.cursor();
  const s = ed.server;
  const empty = !ed.problems.length;
  const none = s?.status === "ready" ? "No problems." : s?.status === "exited" ? s.note : s?.status === "starting" ? "The language server is starting…" : "No language server for this file.";

  return v_flex()
    .id("editor-problems")
    .h(DRAWER)
    .flex_none()
    .border_t(1)
    .border_color(t.ansi0)
    .child(
      h_flex()
        .relative()
        .h(ROW)
        .flex_none()
        .px(12)
        .gap(12)
        .items_center()
        .text_color(t.muted)
        .child(div().text_color(t.foreground).child("PROBLEMS"))
        .child(div().text_color(t.dim).child(`${ed.problems.length}`))
        .child(div().relative().flex_1().h(1).opacity(0.6).child(dither(t.ansi8, 1)))
        .child(
          h_flex()
            .gap(4)
            .child(
              div()
                .text_color(t.accent)
                .child(ed.vimOn() ? "]d" : "cmd-k n"),
            )
            .child(div().text_color(t.dim).child("next")),
        ),
    )
    .child(
      empty
        ? div().px(12).py(8).text_color(t.dim).child(none)
        : div()
            .id("problems-list")
            .flex_1()
            .min_h(0)
            .overflow_y_scrollbar()
            .children(
              ed.problems.map((d, i) => {
                const sel = d.line === at.line;
                const color = sevColor[d.severity];

                return h_flex()
                  .id(`problem-${i}`)
                  .relative()
                  .h(ROW)
                  .flex_none()
                  .px(12)
                  .gap(10)
                  .items_center()
                  .text_color(t.muted)
                  .hover((s) => s.bg(`${t.ansi0}55`))
                  .on_click((_e, cx) => {
                    ed.goto(d.line, d.col, cx);
                    cx.notify();
                  })
                  .when(sel, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
                  .child(div().relative().size(7).flex_none().border(1).border_color(color).child(dither(color, 1)))
                  .child(div().relative().w(54).flex_none().text_color(t.dim).child(`${d.line + 1}:${d.col + 1}`))
                  .child(div().relative().flex_1().min_w(0).truncate().text_color(t.foreground).child(d.message.split("\n")[0] ?? ""))
                  .child(div().relative().flex_none().text_color(t.dim).child(codeAndSource(d)));
              }),
            ),
    );
}

export function hints(ed: EditorPane, t: Theme): Element {
  if (ed.look) return lookHints(ed, t);

  const list = hintList({ mode: ed.mode, vim: ed.vimOn(), vimMode: ed.vim.mode, server: serverId(ed.server) !== null, markdown: ed.markdown, view: ed.view });
  // The keys entry (the last) is keyhelp.ts's: its key is the chord that opens it here.
  const last = list.at(-1);
  const help = last?.[1] === "keys" ? last : null;
  const rest = help ? list.slice(0, -1) : list;

  return h_flex()
    .id("editor-hints")
    .relative()
    .h(HINTS)
    .flex_none()
    .px(10)
    .gap(14)
    .items_center()
    .overflow_hidden()
    .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
    .children(rest.map(([k, what], i) => hint(t, `editor-hint-${i}`, k, what)))
    .when(Boolean(help), (el) => (help ? el.child(div().flex_1()).child(keysHint(t, "editor-hint-keys", ed.keysShown, () => toggleKeys(ed, !ed.keysShown), help[0])) : el));
}

/** Opens or closes the keys overview; it holds the keyboard while open, the file gets it back after. */
export function toggleKeys(ed: EditorPane, on: boolean): void {
  ed.keysShown = on;

  if (on) ed.keysHandle?.focus();
  else if (ed.look) ed.lookHandle?.focus();
  else if (ed.view === "preview") ed.previewHandle?.focus();
  else if (ed.view === "rendered" && ed.cur?.rendered) ed.cur.rendered.focus();
  else ed.editor.focus();
}

/** The keys entry (space ? / cmd-k ?): every key, in the file's place (keyhelp.ts); ? esc q close it. */
export function keysStrip(ed: EditorPane, t: Theme): Element {
  return focusOn(div().id("editor-keys-host").absolute().top(0).left(0).size_full(), ed.keysHandle)
    .on_key_down((e, cx) => {
      const k = keysKey(e, true);

      if (k) toggleKeys(ed, false);

      cx.stop_propagation();
      cx.notify();
    })
    .child(keysView(t, { id: "editor-keys", title: ed.vimOn() ? "editor · vim" : "editor", list: ed.look ? LOOK_KEYS : editorKeys(ed.vimOn()), close: () => toggleKeys(ed, false) }));
}
