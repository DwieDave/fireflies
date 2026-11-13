// The worktree manager pane ({ role: "worktrees" }) moved into the git
// window: its Worktrees tab (the Files panel's third) lists a repo's
// checkouts with what's running in each, and makes, goes to, renames and
// removes them (picks: M merged, U unused). This stub keeps a saved pane of
// it working: it hands its place to a git pane on Worktrees for the
// same space and closes itself; where it can't find its own pane, it says
// where the worktrees went, with an enter / click that opens them.

import { div, svg } from "gpui-kit";
import type { Context, Element } from "gpui-kit";
import type { Props } from "gpui-shell";
import { v_flex } from "gpui-base";
import { panes, spaces, run, theme } from "herdr";
import { isString, object } from "./guard.ts";
import { spaceFolder } from "./kit.ts";
import { openWorktrees } from "./git.ts";
import type { WorktreesAsk } from "./git.ts";

/** A saved worktrees pane's props. */
const isRoleProps = object({}, { role: isString });

export class WorktreesPanel {
  done = false;

  init(_props: Props | undefined, cx: Context): void {
    cx.timer.after(0, () => this.handOver());
  }

  handOver(): void {
    if (this.done) return;

    const mine = panes().filter((p) => p.mod === "nocturne" && isRoleProps(p.props) && p.props.role === "worktrees");
    const pane = mine.length === 1 ? mine[0] : undefined;

    if (!pane) return;

    this.done = true;

    const s = spaces().find((x) => x.tabs.some((t) => t.id === pane.tab));
    const folder = s ? spaceFolder(s, panes()) : null;
    const worktrees: WorktreesAsk = s ? { action: "open", space: s.id } : { action: "open" };

    run("pane.split", { direction: "right", pane: pane.pane, mod: "git", props: { folder, on: s?.machine ?? null, worktrees } });
    run("pane.close", { pane: pane.pane });
  }

  render(): Element {
    const t = theme();

    return v_flex().id("worktrees-moved").size_full().bg(t.background).items_center().justify_center().gap(10).text_size(11)
      .on_key_down((e, cx) => {
        if (e.key === "enter") {
          openWorktrees();
          cx.stop_propagation();
        }
      })
      .child(svg("mods/nocturne/art/moon-8.svg").w(40).h(40).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child("Worktrees live in Git now"))
      .child(div().text_color(t.ansi8).child("Git's Files panel, Worktrees tab: cmd-g, then 2 and ["))
      .child(div().id("worktrees-moved-open").px(8).py(3).border(1).border_color(t.accent).text_color(t.accent)
        .hover((s) => s.bg(t.ansi0))
        .on_click(() => openWorktrees())
        .child("enter  open the worktrees"));
  }
}
