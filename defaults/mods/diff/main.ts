// Nocturne diff moved into the git window: git's Review tab (the
// Files panel's second tab) does what this mod did, scopes, reviewed marks
// (kept: the same shared keys) and hidden kinds included. This stub keeps
// every old way in working (a mod can't load another mod's files, so it
// hands over through commands):
//   an overlay window (the GitHub window's d, { pr, repo, back }) reopens as
//   the git window in the same place, on that review;
//   a pane (saved in a tab, pane.split { mod: "diff" }) is replaced
//   by a git pane on Review, same props;
//   anywhere else (a layout block, an old lazygit float's second view) it
//   says where the diff went and opens it on enter or a click.

import { View, div, svg } from "gpui-kit";
import type { AsyncContext, FocusHandle } from "gpui-kit";
import type { Props } from "gpui-shell";
import { v_flex } from "gpui-base";
import { props, theme, panes, run, openOverlay, closeOverlay, setShared, nextCommand } from "herdr";
import type { Guarded } from "./guard.ts";
import { isNull, isString, object, oneOf } from "./guard.ts";

/** The props this mod was opened with, the fields read here: git's own
 *  (folder, on, pr, repo, scope, …) are handed on as they are. `back` is the
 *  GitHub window to put back ({ mod, props }). */
const isDiffProps = object({}, {
  overlay: isString,
  folder: oneOf(isString, isNull),
  back: oneOf(object({ mod: isString }), isNull),
});

type DiffProps = Guarded<typeof isDiffProps>;

const NO_PROPS: DiffProps = {};

/** diff's props as git's: Review, same folder, scope, PR and way back. */
export function gitProps(p: DiffProps) {
  const { overlay: _overlay, ...rest } = p;

  return { ...rest, review: true };
}

export default class DiffMoved extends View {
  p: DiffProps = NO_PROPS;
  handle: FocusHandle | null = null;
  done = false;

  override init(p: Props | undefined, cx: AsyncContext) {
    const given = props() ?? p;

    this.p = isDiffProps(given) ? given : NO_PROPS;

    const handle = cx.focus_handle();

    this.handle = handle;
    cx.timer.after(0, () => this.handOver());
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();

        if (c === "focus") handle.focus();

        cx.notify();
      }
    });
  }

  handOver() {
    if (this.done) return;

    const p = this.p;

    if (p.overlay !== undefined) {
      this.done = true;

      const back = p.back ?? null;
      const key = back ? "github" : "git";
      const id = openOverlay({ mod: "git", kind: "window", key, frame: "none", scrim: true, width: 0.85, height: 0.85, props: gitProps(p) });

      if (back) setShared("github.window", { id, beat: Date.now() });
      else setShared("git.window", { id, beat: Date.now(), folder: p.folder ?? null });

      closeOverlay(p.overlay);

      return;
    }

    // A pane of its own: a git pane takes its place.
    const mine = panes().filter((x) => x.mod === "diff" && JSON.stringify(x.props ?? {}) === JSON.stringify(p));
    const pane = mine.length === 1 ? mine[0] : undefined;

    if (pane) {
      this.done = true;
      run("pane.split", { direction: "right", pane: pane.pane, mod: "git", props: gitProps(p) });
      run("pane.close", { pane: pane.pane });
    }
  }

  open() {
    run("pane.split", { direction: "auto", mod: "git", props: gitProps(this.p) });
  }

  override render() {
    const t = theme();
    const handle = this.handle;
    const view = v_flex().id("diff-moved").size_full().bg(t.background).items_center().justify_center().gap(10).text_size(11);

    return (handle ? view.track_focus(handle) : view)
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
