// The editor pane's bar and tab strip drawn (main.ts render places them):
// the mode, the file's name and marks, the server's word, the tabs.

import type EditorPane from "./main.ts";
import { fileIcon, ICON_SIZE, iconColor, iconSvg } from "./file-icons.ts";
import { basename, dirname, serverNote, tilde } from "./logic.ts";
import { busy, counts, progressWord } from "./lsp-replies.ts";
import { noteName } from "./scratch.ts";
import { dropIndex, gapAt, MORE, showStrip, stakeAt, tabLabels, tabWidth, visibleTabs } from "./tabs.ts";
import type { TabLabel } from "./tabs.ts";
import type { Mode } from "./vim.ts";
import { MODE_NAME } from "./vim.ts";
import { h_flex } from "gpui-base";
import type { Color, Element } from "gpui-kit";
import { div, svg } from "gpui-kit";
import type { Theme } from "herdr";
import { home } from "herdr";
import type { Doc } from "./pane-kit.ts";
import { BAR, dither, MOD, stop, zoom } from "./pane-kit.ts";
import { setDrawn } from "./drawn-tabs.ts";
import { focusText, openMdMenu } from "./md-pane.ts";
import { closeTab, select, stepShownTab } from "./pane-tabs.ts";
import { setWrap, toggleVim } from "./pane-vim.ts";
import { dragOver, dropTab, leaveStrip, openTabMenu } from "./tab-menu.ts";

export const TABS = 26;

// A tab's name is cut past this (px); its full path is in the bar.
export const MAX_TAB_NAME = 180;

/** A scratchpad's mark (nocturne's art: the "+ new" menu's tile has it too). */
export const SCRATCH_MARK = "mods/nocturne/art/scratchpad.svg";

/** Where a dragged tab lands: a 2 px accent bar capped top and bottom, at the
 *  left edge of its box (as the app's tab strip, nocturne/tabdrag.ts). */
export function tabStake(t: Theme): Element {
  return div()
    .absolute()
    .left(-3)
    .top(3)
    .bottom(2)
    .w(8)
    .child(div().absolute().left(3).top(0).bottom(0).w(2).bg(t.accent))
    .child(div().absolute().left(0).right(0).top(0).h(2).bg(t.accent))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent));
}

/** The bar's color for vim's mode. */
export function modeColorOf(t: Theme, mode: Mode): Color {
  switch (mode) {
    case "insert":
      return t.ansi2;
    case "replace":
      return t.ansi1;
    case "visual":
    case "vline":
    case "vblock":
      return t.ansi5;
    case "normal":
      return t.accent;
  }
}

export function bar(ed: EditorPane, t: Theme): Element {
  const narrow = ed.size.width < 520;
  const vim = ed.vimOn();
  const recording = ed.vim.recording;
  const msg = ed.message && Date.now() - ed.message.at < 4000 ? ed.message : null;

  return h_flex()
    .id("editor-bar")
    .h(BAR)
    .flex_none()
    .px(12)
    .gap(10)
    .items_center()
    .border_b(1)
    .border_color(t.ansi0)
    .when(vim, (el) => el.child(modeChip(ed, t)))
    .when(vim && Boolean(recording), (el) => (recording ? el.child(div().flex_none().text_color(t.ansi1).child(`rec @${recording.reg}`)) : el))
    // One file (no strip): its unsaved mark and name are here, as before tabs.
    .when(!showStrip(ed.allDocs().length), (el) => el.children(oneFile(ed, t)))
    .when(ed.deleted, (el) => el.child(div().id("bar-deleted").flex_none().text_color(t.ansi1).child("deleted · cmd-s writes it again")))
    .child(
      div()
        .flex_1()
        .min_w(0)
        .truncate()
        .text_color(t.dim)
        .child(narrow ? "" : ed.scratch ? `${noteName(ed.path)} · every worktree of it` : tilde(dirname(ed.path), home())),
    )
    // A scratchpad: saving… while it waits to write, saved after (green), what went wrong (red).
    .when(ed.scratch, (el) => el.child(autosaveChip(ed, t)))
    .when(Boolean(msg), (el) =>
      msg
        ? el.child(
            div()
              .flex_none()
              .text_color(msg.bad ? t.ansi1 : t.ansi2)
              .truncate()
              .max_w(260)
              .child(msg.text),
          )
        : el,
    )
    .children(problemChips(ed, t))
    .children(fileChips(ed, t, narrow, vim))
    .children(viewChips(ed, t, narrow, vim));
}

/** Vim's mode, on its colour's dither. */
function modeChip(ed: EditorPane, t: Theme): Element {
  const modeColor = modeColorOf(t, ed.vim.mode);

  return (
    div()
      .id("bar-mode")
      .relative()
      .flex_none()
      .h(18)
      .px(6)
      .flex()
      .items_center()
      .child(div().absolute().inset_0().opacity(0.3).child(dither(modeColor, 1)))
      .child(div().relative().text_color(modeColor).child(MODE_NAME[ed.vim.mode]))
  );
}

/** One file (no strip): its unsaved mark (not a scratchpad's), its type mark and its name. */
function oneFile(ed: EditorPane, t: Theme): Element[] {
  const mark =
    div()
      .id("bar-mark")
      .relative()
      .size(8)
      .flex_none()
      .border(1)
      .border_color(ed.dirty ? t.ansi3 : t.ansi0)
      .when(ed.dirty, (el) => el.child(dither(t.ansi3, 1)));

  const name =
    div()
      .id("bar-name")
      .flex_none()
      .max_w(MAX_TAB_NAME * 1.5)
      .truncate()
      .text_color(t.foreground)
      .child(ed.scratch ? "scratchpad" : basename(ed.path) || "untitled");

  return [...(ed.scratch ? [] : [mark]), typeMark(ed, t, ed.shown(), "bar-icon", true), name];
}

/** A scratchpad's autosave: saving…, saved (green), not saved (red). */
function autosaveChip(ed: EditorPane, t: Theme): Element {
  const st = ed.saveState;
  const color = st === "error" ? t.ansi1 : st === "saved" ? t.ansi2 : t.ansi3;

  return (
    h_flex()
      .id("bar-autosave")
      .flex_none()
      .gap(6)
      .items_center()
      .text_color(color)
      .child(div().relative().size(7).border(1).border_color(color).child(dither(color, 1)))
      .child(st === "error" ? "not saved" : st === "saved" ? "saved" : "saving…")
  );
}

/** The errors' and warnings' counts (a click opens the problems' drawer). */
function problemChips(ed: EditorPane, t: Theme): Element[] {
  const c = counts(ed.problems);

  const sev = (n: number, color: Color, id: string): Element =>
    h_flex()
      .id(id)
      .flex_none()
      .gap(5)
      .items_center()
      .on_click((_e, cx) => {
        ed.drawer = !ed.drawer;
        cx.notify();
      })
      .child(div().relative().size(7).border(1).border_color(color).child(dither(color, 1)))
      .child(div().text_color(color).child(String(n)));

  return [...(c.error > 0 ? [sev(c.error, t.ansi1, "bar-errors")] : []), ...(c.warning > 0 ? [sev(c.warning, t.ansi3, "bar-warnings")] : [])];
}

/** The server's word in its colour: running (with its work), starting, loading the project's .envrc, stopped, or why there's none. */
function serverWord(ed: EditorPane, t: Theme): readonly [Color, string] | null {
  const s = ed.server;
  // The server's word (logic.ts serverNote): running, starting, loading the
  // project's .envrc, stopped, or why there's none ("direnv allow").
  const word = serverNote(s, ed.lang, { tilde: (p) => tilde(p, home()) })?.short ?? "";
  // A running server's own words for what it's doing: "indexing 120/340"
  // while answers wait on it (yellow), "· cargo check" beside its name after.
  const work = s?.status === "ready" ? progressWord(ed.progress) : null;
  const envKind = s && "envKind" in s ? s.envKind : undefined;

  const server: readonly [Color, string] | null =
    s?.status === "ready" && work
      ? busy(ed.progress)
        ? [t.ansi3, work]
        : [t.ansi2, `${s.name} · ${work}`]
      : s?.status === "ready"
        ? [t.ansi2, s.name]
        : s?.status === "starting" || s?.status === "env" || envKind === "blocked"
          ? [t.ansi3, word]
          : s?.status === "exited" || envKind === "failed"
            ? [t.ansi1, word]
            : word
              ? [t.dim, word]
              : null;


  return server;
}

/** The server's word, the file's language and indent, keys typed toward a command, the caret's place. */
function fileChips(ed: EditorPane, t: Theme, narrow: boolean, vim: boolean): Element[] {
  const server = serverWord(ed, t);
  const at = ed.state === "ready" || ed.state === "missing" ? ed.editor.cursor() : null;
  const out: Element[] = [];

  if (server && !narrow) out.push(h_flex().id("bar-server").flex_none().gap(6).items_center().text_color(t.muted).child(div().size(6).bg(server[0])).child(server[1]));

  if (!narrow) {
    out.push(
      h_flex()
        .flex_none()
        .h(18)
        .px(6)
        .items_center()
        .border(1)
        .border_color(t.ansi0)
        .text_color(t.muted)
        .child(`${ed.lang} · ${ed.opts.insert_spaces === false ? "tab" : `${ed.opts.tab_size} sp`}`),
    );
  }

  if (vim && ed.pending) out.push(div().flex_none().text_color(t.foreground).child(ed.pending));

  if (at) out.push(div().flex_none().text_color(t.dim).child(`${at.line + 1}:${at.col + 1}`));

  return out;
}

/** The view's switches: the Markdown commands (a click opens their list), the preview's view, a table / patch / SVG drawn again, wrap, vim. */
function viewChips(ed: EditorPane, t: Theme, narrow: boolean, vim: boolean): Element[] {
  const out: Element[] = [];

  if (ed.markdown && ed.view !== "preview" && !narrow) out.push(mdChip(ed, t, vim));

  if (ed.markdown) {
    out.push(
      div()
        .id("bar-preview")
        .flex_none()
        .h(18)
        .px(6)
        .flex()
        .items_center()
        .border(1)
        .border_color(ed.view === "text" ? t.ansi0 : t.ansi5)
        .text_color(ed.view === "text" ? t.dim : t.ansi5)
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => ed.command("preview", cx))
        .child(ed.view),
    );
  }

  // A table, patch or SVG as text: drawn again (e in the drawn tab comes back here).
  if (ed.kind === "either") {
    out.push(
      div()
        .id("bar-drawn")
        .flex_none()
        .h(18)
        .px(6)
        .flex()
        .items_center()
        .border(1)
        .border_color(t.ansi0)
        .text_color(t.dim)
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          setDrawn(ed, ed.shown(), true, cx);
          cx.notify();
        })
        .child("drawn"),
    );
  }

  if (!narrow || ed.softWrap) {
    out.push(
      div()
        .id("bar-wrap")
        .flex_none()
        .h(18)
        .px(6)
        .flex()
        .items_center()
        .border(1)
        .border_color(ed.softWrap ? t.ansi4 : t.ansi0)
        .text_color(ed.softWrap ? t.ansi4 : t.dim)
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => setWrap(ed, null, cx))
        .child("wrap"),
    );
  }

  out.push(
    div()
      .id("bar-vim")
      .flex_none()
      .h(18)
      .px(6)
      .flex()
      .items_center()
      .border(1)
      .border_color(vim ? t.accent : t.ansi0)
      .text_color(vim ? t.accent : t.dim)
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => toggleVim(ed, cx))
      .child("vim"),
  );

  return out;
}

/** The Markdown commands' list (cmd-., vim: space .), found from the bar: a click opens it. */
function mdChip(ed: EditorPane, t: Theme, vim: boolean): Element {
  return (
    h_flex()
      .id("bar-md")
      .flex_none()
      .h(18)
      .px(6)
      .gap(6)
      .items_center()
      .border(1)
      .border_color(ed.mdMenu ? t.accent : t.ansi0)
      .text_color(ed.mdMenu ? t.accent : t.muted)
      .hover((s) => s.text_color(t.foreground).border_color(t.ansi8))
      .tooltip("bold, headings, lists, tasks, quotes, code: the Markdown commands")
      .on_click((_e, cx) => {
        if (ed.mdMenu) {
          ed.mdMenu = null;
          focusText(ed);
          cx.notify();
        } else {
          openMdMenu(ed, cx);
          focusText(ed);
        }
      })
      .child("markdown")
      .child(div().text_color(t.dim).child(vim ? "space ." : "cmd-."))
  );
}

/** The strip's height: none with one tab. */
export function stripH(ed: EditorPane): number {
  return showStrip(ed.allDocs().length) ? TABS : 0;
}

/** The file tabs along the pane's top (from two files on): each file's
 *  unsaved mark, name (with the folder that tells two of the same name
 *  apart) and ×; the shown one lit (a dithered band, an accent edge). Those
 *  that don't fit fold into ‹ n / n › at the ends, the shown one always in
 *  view. A press dragged along the strip moves its tab: it lifts where it
 *  is and a stake stands in the gap it drops into; the wheel steps tabs. */
/** A file's type mark (file-icons.ts) before its name: tinted by its kind, dimmed on a tab
 *  not shown; a scratchpad's is the scratchpad's own mark. */
export function typeMark(ed: EditorPane, t: Theme, d: Doc, id: string, on: boolean): Element {
  const icon = fileIcon(d.path);
  const src = d.scratch ? SCRATCH_MARK : iconSvg(icon, MOD);

  return div()
    .id(id)
    .relative()
    .flex_none()
    .size(ICON_SIZE)
    .opacity(on ? 1 : 0.5)
    .child(svg(src).size(ICON_SIZE).text_color(d.scratch ? t.accent : iconColor(icon, t)));
}

export function tabStrip(ed: EditorPane, t: Theme): Element {
  const docs = ed.allDocs();

  // A scratchpad's tab says so, with its repository (its file is named for the app).
  const labels = tabLabels(docs.map((d) => d.path)).map((l, i) => {
    const d = docs[i];

    return d?.scratch ? { ...l, name: "scratchpad", hint: noteName(d.path) } : l;
  });

  const z = zoom();
  const room = ed.size.width / z - 8;
  const active = ed.cur ? docs.indexOf(ed.cur) : -1;
  const widths = labels.map((l) => tabWidth(l));
  const fit = visibleTabs(widths, active, room);

  // Where each drawn tab starts (px, unzoomed): the tab menu opens under it.
  ed.tabX = (i) => (i < fit.from || i >= fit.to ? 8 : (fit.before > 0 ? MORE : 0) + widths.slice(fit.from, i).reduce((a, b) => a + b, 0));

  const drag = ed.tabDrag;
  const stake = drag ? stakeAt(docs.length, drag.from, dropIndex(docs.length, drag.from, drag.gap)) : null;
  // The landing place among the drawn tabs: one folded away stands at the edge.
  const stakeBefore = stake === null ? undefined : stake.before === null || stake.before >= fit.to ? null : Math.max(stake.before, fit.from);

  // Past the last tab: the gap at the end, wide enough to aim at.
  const end = div()
    .id("editor-tabs-end")
    .relative()
    .flex_1()
    .min_w(24)
    .h_full()
    .on_mouse_move((e, cx) => dragOver(ed, { index: null, after: false }, e, cx))
    .when(stakeBefore === null, (el) => el.child(tabStake(t)));

  return h_flex()
    .id("editor-tabs")
    .relative()
    .h(TABS)
    .flex_none()
    .items_center()
    .overflow_hidden()
    .bg(t.background)
    .on_mouse_up("left", (_e, cx) => dropTab(ed, cx))
    .on_hover((hovered, cx) => {
      if (!hovered) leaveStrip(ed, cx);
    })
    .when(Boolean(drag), (el) => el.cursor_grabbing())
    .on_scroll_wheel((e, cx) => {
      const dy = e.delta.y;

      if (Math.abs(dy) >= 1) {
        stepShownTab(ed, dy > 0 ? -1 : 1, cx);
        cx.notify();
      }
    })
    .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.ansi0, 1)))
    .when(fit.before > 0, (el) => el.child(moreTabs(ed, t, "editor-tabs-before", `‹ ${fit.before}`, -1)))
    .children(docs.slice(fit.from, fit.to).map((d, j) => stripTab(ed, t, d, fit.from + j, labels[fit.from + j] ?? { name: basename(d.path), hint: null }, stakeBefore)))
    .child(end)
    .when(fit.after > 0, (el) => el.child(moreTabs(ed, t, "editor-tabs-after", `${fit.after} ›`, 1)));
}

/** The strip's ‹ n / n › marks: the tabs folded away on that side; a click steps to the next. */
function moreTabs(ed: EditorPane, t: Theme, id: string, text: string, dir: number): Element {
  return (
    h_flex()
      .id(id)
      .relative()
      .h_full()
      .w(MORE)
      .flex_none()
      .justify_center()
      .items_center()
      .text_color(t.dim)
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => {
        stepShownTab(ed, dir, cx);
        cx.notify();
      })
      .child(text)
  );
}

/** A tab on the strip: lit when shown, lifted while dragged; its unsaved mark, type mark,
 *  name, folder hint and ×; a click shows it, a drag moves it, middle closes, right opens its menu. */
function stripTab(ed: EditorPane, t: Theme, d: Doc, i: number, l: TabLabel, stakeBefore: number | null | undefined): Element {
  const drag = ed.tabDrag;
  const on = d === ed.cur;
  const bad = d.state === "error" || d.deleted;
  const lifted = drag?.from === i;
  const hint = l.hint;

  return (
    h_flex()
      .id(`editor-tab-${i}`)
      .relative()
      .h_full()
      .flex_none()
      .pl(10)
      .pr(6)
      .gap(6)
      .items_center()
      .border_r(1)
      .border_color(t.ansi0)
      .text_color(on || lifted ? t.foreground : t.muted)
      .when(on && !lifted, (el) => el.child(div().absolute().inset_0().opacity(0.45).child(dither(t.ansi0, 1))).child(div().absolute().left(0).right(0).top(0).h(2).bg(t.accent)))
      // Dragged: lifted where it is (a plate edged in the accent, a dither shadow), behind its words.
      .when(lifted, (el) => el.child(div().absolute().left(5).right(-1).top(5).bottom(1).child(dither(t.ansi0, 1))).child(div().absolute().left(2).right(2).top(2).bottom(4).bg(t.background).border(1).border_color(t.accent)))
      .when(!on && !drag, (el) => el.hover((s) => s.text_color(t.foreground)))
      .on_mouse_down("left", (e) => {
        ed.tabPress = { index: i, x: e.position.x };
      })
      .on_mouse_move((e, cx) => dragOver(ed, gapAt(i, e.local_position.x, e.bounds.width), e, cx))
      // A click (no drag) shows the tab; a drag drops in the strip's mouse up.
      .on_click((_e, cx) => {
        if (ed.tabDrag) return;

        select(ed, d, cx);
        cx.notify();
      })
      // Middle click closes it, as the app's tab strip does; a right-click opens its menu.
      .on_mouse_down("middle", (_e, cx) => {
        cx.stop_propagation();
        closeTab(ed, cx, d);
        cx.notify();
      })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        openTabMenu(ed, cx, i);
        cx.notify();
      })
      // Unsaved: the bar's yellow dithered square; nothing when clean.
      .child(
        div()
          .id(`editor-tab-mark-${i}`)
          .relative()
          .size(7)
          .flex_none()
          .border(1)
          .border_color(d.dirty ? t.ansi3 : bad ? t.ansi1 : on ? t.ansi8 : t.ansi0)
          .when(d.dirty, (el) => el.child(dither(t.ansi3, 1))),
      )
      .child(typeMark(ed, t, d, `editor-tab-icon-${i}`, on || lifted))
      .child(div().relative().flex_none().max_w(MAX_TAB_NAME).truncate().child(l.name))
      .when(Boolean(hint), (el) => (hint ? el.child(div().relative().flex_none().max_w(120).truncate().text_color(t.dim).child(hint)) : el))
      .child(tabClose(ed, t, d, i, on))
      .when(stakeBefore === i, (el) => el.child(tabStake(t)))
  );
}

/** A tab's ×: closes it (asking first with unsaved changes). */
function tabClose(ed: EditorPane, t: Theme, d: Doc, i: number, on: boolean): Element {
  return (
    div()
      .id(`editor-tab-close-${i}`)
      .relative()
      .flex_none()
      .size(14)
      .flex()
      .items_center()
      .justify_center()
      .text_color(on ? t.muted : t.ansi8)
      .hover((s) => s.text_color(t.ansi1))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        closeTab(ed, cx, d);
        cx.notify();
      })
      .child("×")
  );
}
