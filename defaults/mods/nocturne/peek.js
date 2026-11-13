// The bar over a floating or peeked terminal (the layout's peek_mod, on the
// DwieDave fork): the pane header's look (header.js) for a terminal with no
// pane, so a floating lazygit gets its git mark, branch, dithered band and
// counts, and its views (lazygit / diff) to switch between. Then keep (↗:
// its pane, or a tab), dock (⇥: a split beside the focused pane, "auto"),
// end (⏻, floats) and close (✕: hidden, still running).
// Props: { terminal, float, overlay, views?, dialog: "peek" }.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { terminals, panes, spaces, props, run, theme, closeOverlay } from "herdr";
import Header from "./header.ts";
import { dither } from "./kit.ts";

export default class Peek extends Header {
  /** The terminal as a pane-like record, focused: the float has the keyboard. */
  target() {
    const k = terminals().find((x) => x.address === props()?.terminal);
    if (!k) return null;
    return { pane: null, terminal: k.address, focused: true, cwd: k.cwd, branch: null, program: k.program, status: k.status, title: k.name || k.title };
  }

  machine() {
    return spaces().find((s) => s.active)?.machine ?? null;
  }

  /** No pane to focus: the row is plain, standing on a dithered night-blue horizon. */
  frame(t) {
    return h_flex().id("peek-bar").relative().size_full().px(10).gap(8).items_center().bg(t.background).text_size(11)
      .child(div().absolute().left(0).right(0).bottom(0).h(2).opacity(0.7).child(dither(t.accent, 1)));
  }

  action(t, id, label, go, color) {
    return div().id(`peek-${id}`).flex_none().px(4).text_color(t.dim)
      .hover((s) => s.text_color(color ?? t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); go(); closeOverlay(props()?.overlay); })
      .child(label);
  }

  /** The float's views, when it has more than one: the shown one on a dithered plate. */
  views(t, terminal, names) {
    const shown = terminals().find((x) => x.address === terminal)?.floating_view ?? 0;
    return h_flex().flex_none().gap(2).children(names.map((name, i) => h_flex().id(`peek-view-${i}`).relative().h(20).px(6).items_center()
      .text_color(i === shown ? t.foreground : t.dim)
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); run("float.view", { index: i }); })
      .when(i === shown, (el) => el.child(dither(t.ansi0, 1)))
      .child(div().relative().child(name))));
  }

  buttons(t, el) {
    const { terminal, float, views } = props() ?? {};
    const home = panes().some((p) => p.terminal === terminal);
    return el
      .when(Array.isArray(views) && views.length > 1, (el) => el.child(this.views(t, terminal, views)))
      .child(this.action(t, "keep", home ? "↗ go to" : "↗ keep", () => run(home ? "pane.focus" : "terminal.keep", { terminal })))
      .when(!home, (el) => el.child(this.action(t, "dock", "⇥ dock", () => run("terminal.keep", { terminal, place: "auto" }))))
      .when(Boolean(float), (el) => el.child(this.action(t, "end", "⏻ end", () => run("terminal.kill", { terminal }), t.blocked)))
      .child(this.action(t, "close", "✕", () => {}));
  }
}
