// Nocturne diff moved into the git window: nocturne-git's Review tab (the
// Files panel's second tab) does what this mod did, scopes, reviewed marks
// (kept: the same shared keys) and hidden kinds included. This stub keeps
// every old way in working (a mod can't load another mod's files, so it
// hands over through commands):
//   an overlay window (the GitHub window's d, { pr, repo, back }) reopens as
//   the git window in the same place, on that review;
//   a pane (saved in a tab, pane.split { mod: "nocturne-diff" }) is replaced
//   by a nocturne-git pane on Review, same props;
//   anywhere else (a layout block, an old lazygit float's second view) it
//   says where the diff went and opens it on enter or a click.

import { View, div, svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { props, theme, panes, run, openOverlay, closeOverlay, setShared, nextCommand } from "herdr";

/** nocturne-diff's props as nocturne-git's: Review, same folder, scope, PR and way back. */
export function gitProps(p) {
  const { overlay, ...rest } = p ?? {};
  return { ...rest, review: true };
}

export default class DiffMoved extends View {
  init(p, cx) {
    this.p = props() ?? p ?? {};
    this.handle = cx.focus_handle();
    cx.timer.after(0, () => this.handOver());
    cx.spawn(async (cx) => { for (;;) { const c = await nextCommand(); if (c === "focus") this.handle.focus(); cx.notify(); } });
  }

  handOver() {
    if (this.done) return;
    const p = this.p;
    if (p.overlay) {
      this.done = true;
      const key = p.back ? "nocturne-github" : "nocturne-git";
      const id = openOverlay({ mod: "nocturne-git", kind: "window", key, frame: "none", scrim: true, width: 0.85, height: 0.85, props: gitProps(p) });
      if (p.back) setShared("nocturne-github.window", { id, beat: Date.now() });
      else setShared("nocturne-git.window", { id, beat: Date.now(), folder: p.folder ?? null });
      closeOverlay(p.overlay);
      return;
    }
    // A pane of its own: a nocturne-git pane takes its place.
    const mine = panes().filter((x) => x.mod === "nocturne-diff" && JSON.stringify(x.props ?? {}) === JSON.stringify(p));
    if (mine.length === 1) {
      this.done = true;
      run("pane.split", { direction: "right", pane: mine[0].pane, mod: "nocturne-git", props: gitProps(p) });
      run("pane.close", { pane: mine[0].pane });
    }
  }

  open() {
    run("pane.split", { direction: "auto", mod: "nocturne-git", props: gitProps(this.p) });
  }

  render() {
    const t = theme();
    return v_flex().id("diff-moved").size_full().bg(t.background).items_center().justify_center().gap(10).text_size(11)
      .track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "enter") { this.open(); cx.stop_propagation(); } })
      .child(svg("mods/nocturne/art/moon-8.svg").w(40).h(40).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child("The diff lives in Git now"))
      .child(div().text_color(t.ansi8).child("Git's Files panel, Review tab: cmd-g, then 2 and ]"))
      .child(div().id("diff-moved-open").px(8).py(3).border(1).border_color(t.accent).text_color(t.accent)
        .hover((s) => s.bg(t.ansi0))
        .on_click(() => this.open())
        .child("enter  open the review"));
  }
}
