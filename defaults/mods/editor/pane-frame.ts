// The editor pane drawn whole (main.ts render): the tab strip, the bar, the
// lines under it (a question, a conflict, find, the ex line), the file or the
// keys overview, the problems' drawer, the hints, and over them the card, the
// leader's keys, the Markdown commands' list, the drop zone and the tab menu.

import type EditorPane from "./main.ts";
import type { Element } from "gpui-kit";
import type { Theme } from "herdr";
import { askLine, bodyView, conflictLine, drawerView, exLine, hints, keysStrip, whichView } from "./pane-lines.ts";
import { bar, tabStrip } from "./pane-bar.ts";
import { cancelDrag, closeTabMenu, dropOut, dropZone, tabMenuView } from "./tab-menu.ts";
import { cardView } from "./card-view.ts";
import { closeCard } from "./card.ts";
import { closeFind, findLine } from "./find.ts";
import { div } from "gpui-kit";
import { lookView } from "./drawn-tabs.ts";
import { mdMenuView } from "./md-pane.ts";
import { settings } from "herdr";
import { showStrip } from "./tabs.ts";
import { v_flex } from "gpui-base";

/** The pane's frame, `t` its theme: its parts placed, its own keys and pointer (esc, a click outside the card, a tab let go). */
export function paneFrame(ed: EditorPane, t: Theme): Element {
  const code = settings().font_family || "JetBrains Mono";
  const card = ed.card ? cardView(ed, t, code) : null;
  const tabMenu = ed.tabMenu;
  const drag = ed.tabDrag;
  const asking = ed.asking;
  const page = ed.look ? lookView(ed, t) : bodyView(ed, t, code);

  return v_flex()
    .id("editor")
    .relative()
    .size_full()
    .bg(t.background)
    .text_size(11)
    .on_size_change((size, cx) => {
      ed.size = size;
      cx.notify();
    })
    .on_key_down((e, cx) => {
      // The editor's own keys came through vimKey; these are the pane's
      // others (the find line, the preview): esc closes the card, then find.
      if (e.key !== "escape") return;

      if (ed.card) {
        closeCard(ed, cx);
        cx.stop_propagation();
      } else if (ed.mode) {
        closeFind(ed, cx);
        cx.stop_propagation();
      }
    })
    // A click outside the card closes it (the card keeps its own), and the tab menu.
    .on_mouse_down("left", (_e, cx) => {
      closeCard(ed, cx);
      closeTabMenu(ed, cx, false);
    })
    // A tab dragged off the strip and let go over the pane: popped out beside (tabs.ts).
    .on_mouse_up("left", (_e, cx) => {
      if (ed.tabDrag?.out) dropOut(ed, cx);
    })
    .on_hover((over, cx) => {
      if (!over) cancelDrag(ed, cx);
    })
    .when(showStrip(ed.allDocs().length), (el) => el.child(tabStrip(ed, t)))
    // A drawn tab: the viewer's slim bar says what it is; the editor's is for text.
    .when(!ed.look, (el) => el.child(bar(ed, t)))
    .when(Boolean(asking), (el) => (asking ? el.child(askLine(ed, t)) : el))
    .when(ed.conflict, (el) => el.child(conflictLine(ed, t)))
    .when(ed.mode !== null, (el) => el.child(findLine(ed, t)))
    .when(ed.vim.ex !== null, (el) => el.child(exLine(ed, t, code)))
    // ?: the keys in the file's place (the file folds away, kept), the bars stay (keyhelp.ts).
    .when(ed.keysShown, (el) => el.child(div().relative().flex_1().min_h(0).child(keysStrip(ed, t))))
    .child(ed.keysShown ? div().h(0).flex_none().overflow_hidden().child(page) : page)
    .when(ed.drawer && !ed.keysShown && !ed.look, (el) => el.child(drawerView(ed, t)))
    .child(hints(ed, t))
    .when(Boolean(card), (el) => (card ? el.child(card) : el))
    .when(Boolean(ed.which?.length) && ed.vimOn(), (el) => el.child(whichView(ed, t)))
    .when(Boolean(ed.mdMenu) && ed.markdown, (el) => el.child(mdMenuView(ed, t)))
    .when(Boolean(drag?.out), (el) => (drag ? el.child(dropZone(ed, t)) : el))
    .when(Boolean(tabMenu), (el) => (tabMenu ? el.child(tabMenuView(ed, t)) : el));
}
