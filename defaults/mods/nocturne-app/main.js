// Nocturne app: removed. App panes kept another application's real window
// glued over a pane (moved, sized, raised and hidden through the
// Accessibility API). That fought tiling window managers like AeroSpace and
// made the screen flicker, so the feature and its native view kind are gone.
//
// This mod stays only so panes saved with it still load: it says what
// happened and closes itself on request.

import { View, div, svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme, run, panes } from "herdr";

export default class AppPane extends View {
  /** This copy's pane: the focused app pane (the click on the button focuses it). */
  close() {
    const mine = panes().find((x) => x.mod === "nocturne-app" && x.focused);
    if (mine) run("pane.close", { pane: mine.pane });
  }

  render() {
    const t = theme();
    return v_flex().id("app").size_full().bg(t.background).items_center().justify_center().gap(10).px(16).text_size(11)
      .child(svg("mods/nocturne/art/moon-8.svg").w(44).h(44).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child("App panes were removed"))
      .child(div().text_center().text_color(t.ansi8)
        .child("Keeping another app's window over a pane fought window managers and made the screen flicker."))
      .child(div().id("close").px(10).py(4).border(1).border_color(t.ansi8)
        .text_color(t.foreground).hover((s) => s.border_color(t.accent))
        .on_click((_e, cx) => { this.close(); cx.notify(); })
        .child("Close this pane"));
  }
}
