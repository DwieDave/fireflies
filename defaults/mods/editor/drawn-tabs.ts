// The editor pane's drawn tabs (a picture, a PDF, a table: the preview's
// viewer mounted in the pane): switching a tab between drawn and text,
// their keys, and the hints under them.

import type EditorPane from "./main.ts";
import { keysHint } from "./keyhelp.ts";
import type { LookAct } from "./tabs.ts";
import { lookAction } from "./tabs.ts";
import Viewer from "./viewer.ts";
import { h_flex } from "gpui-base";
import type { Context, Element, KeyEvent } from "gpui-kit";
import { div } from "gpui-kit";
import type { Props } from "gpui-shell";
import type { Theme } from "herdr";
import { run } from "herdr";
import type { Doc, ViewerPropsNow } from "./pane-kit.ts";
import { dither, focusOn, HINTS, whereArgs } from "./pane-kit.ts";

/** A change to the viewer's props. */
export type ViewerChange = Partial<Pick<ViewerPropsNow, "scroll" | "reload">>;

/** The viewer's props as the engine takes them. */
export const viewerPropsOf = (v: ViewerPropsNow): Props => ({ embedded: v.embedded, path: v.path, on: v.on, scroll: v.scroll, reload: v.reload });

/** The viewer, made once, when a drawn tab first shows: a nested view, so
 *  its reading and drawing redraw only it. */
export function mountViewer(ed: EditorPane, cx: Context): void {
  ed.viewer ??= cx.new(Viewer, viewerPropsOf(ed.viewerProps));
}

/** The viewer's props for the shown tab: its file when drawn, none
 *  otherwise (a native view, a PDF's or a clip's, goes with it). */
export function syncViewer(ed: EditorPane, change: ViewerChange = {}): void {
  const d = ed.cur;
  const path = d?.look ? d.path : null;

  if (path === ed.viewerProps.path && !Object.keys(change).length) return;

  ed.viewerProps = { ...ed.viewerProps, path, on: ed.on, ...change };
  ed.viewer?.set_props(viewerPropsOf(ed.viewerProps));
}

/** Tab `d` drawn (true) or as text (false); a "look" file (a picture)
 *  stays drawn. `focus`: the shown tab takes the keyboard after. */
export function setDrawn(ed: EditorPane, d: Doc, drawn: boolean, cx: Context, focus = true): void {
  const on = d.kind === "look" ? true : d.kind === "text" ? false : drawn;

  if (on === d.look) return;

  d.look = on;

  if (d !== ed.cur) return;

  if (on) mountViewer(ed, cx);

  syncViewer(ed);

  if (!on && d.state === "unloaded") {
    d.state = "loading";
    ed.load(cx, null, false, d);

    if (!ed.on && d.path) ed.watch(cx, d);
  }

  if (focus) {
    if (on) ed.lookHandle?.focus();
    else ed.focusText();
  }

  cx.notify();
}

/** e, the bar's chip, cmd-shift-v on a table, patch or SVG: drawn <-> text. */
export function toggleDrawn(ed: EditorPane, cx: Context): void {
  const d = ed.shown();

  if (d.kind === "look") return ed.say(`This ${d.path.split(".").pop() ?? ""} is drawn only: o opens the system's app`);

  if (d.kind === "text") return ed.say("Not a kind the preview draws");

  setDrawn(ed, d, !d.look, cx);
}

/** A key on a drawn tab (tabs.ts lookAction): tabs, scrolling, as text,
 *  the preview pane, the system's app, the path, close, the keys. */
export function lookKeyDown(ed: EditorPane, e: KeyEvent, cx: Context): void {
  if (ed.keysShown) return;

  const r = lookAction(ed.lookPending, e);

  ed.lookPending = r.pending;

  if (!r.taken) return;

  cx.stop_propagation();

  if (r.act) lookAct(ed, r.act, cx);

  cx.notify();
}

export function lookAct(ed: EditorPane, act: LookAct, cx: Context): void {
  const d = ed.shown();
  const me = ed.me();
  const where = { path: d.path, ...whereArgs(me?.pane, ed.on) };

  switch (act) {
    case "next-tab":
      return ed.stepTab(1, cx);
    case "prev-tab":
      return ed.stepTab(-1, cx);
    case "move-tab-right":
      return ed.stepMove(1, cx);
    case "move-tab-left":
      return ed.stepMove(-1, cx);
    case "down":
    case "up":
      ed.scrollN += 1;

      return syncViewer(ed, { scroll: { n: ed.scrollN, dir: act === "down" ? 1 : -1 } });
    case "text":
      return toggleDrawn(ed, cx);
    case "pane":
      run("preview.open", where);

      return;
    case "system":
      run("preview.open", { path: d.path, in: "system", ...whereArgs(null, ed.on) });

      return;
    case "copy":
      try {
        cx.write_to_clipboard(ed.on ? `${ed.on}:${d.path}` : d.path);
      } catch {
        /* no clipboard */
      }

      return ed.say("path copied");
    case "close":
      return ed.closeTab(cx);
    case "keys":
      return ed.toggleKeys(!ed.keysShown);
  }
}

/** A file a link points at (a card's, the Markdown preview's, a drawn
 *  picture's): drawn kinds as a drawn tab here, another machine's in the
 *  preview beside (the viewer reads only this computer's pictures). */
export function openLooked(ed: EditorPane, path: string, cx: Context): void {
  if (ed.on) {
    const me = ed.me();

    run("preview.open", { path, ...whereArgs(me?.pane, null), on: ed.on });

    return;
  }

  ed.openFile(path, cx, { look: true });
}

/** A drawn tab's body: the viewer, the pane's keys (lookKey). */
export function lookView(ed: EditorPane, t: Theme): Element {
  return focusOn(div().id("editor-look").relative().flex_1().min_h(0).min_w(0).flex().flex_col(), ed.lookHandle)
    .on_key_down((e, cx) => lookKeyDown(ed, e, cx))
    .on_mouse_down("left", () => ed.lookHandle?.focus())
    .child(ed.viewer ? div().flex_1().min_h(0).child(ed.viewer) : ed.note(t, "Opening…", null));
}

/** A drawn tab's hints along the bottom: each one a button too. */
export function lookHints(ed: EditorPane, t: Theme): Element {
  const d = ed.shown();

  const list: readonly (readonly [string, string, LookAct])[] = [
    ...(ed.allDocs().length > 1 ? [["H L", "tabs", "next-tab"] as const] : []),
    ...(d.kind === "either" ? [["e", "text", "text"] as const] : []),
    ["p", "preview pane", "pane"],
    ["o", "open", "system"],
    ["y", "path", "copy"],
    ["d", "close", "close"],
  ];

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
    .children(
      list.map(([k, what, act], i) =>
        h_flex()
          .id(`editor-look-hint-${i}`)
          .flex_none()
          .gap(4)
          .items_center()
          .text_color(t.dim)
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => {
            lookAct(ed, act, cx);
            cx.notify();
          })
          .child(div().text_color(t.accent).child(k))
          .child(div().child(what)),
      ),
    )
    .child(div().flex_1())
    .child(keysHint(t, "editor-hint-keys", ed.keysShown, () => ed.toggleKeys(!ed.keysShown), "?"));
}
