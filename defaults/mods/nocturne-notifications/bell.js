// The bell: a quiet mark in the tab strip, and the engine behind it.
//
//   nothing waits   a dim pip
//   requests wait   a blinking pink pip and how many permissions and
//                   questions wait, in a filled chip; finished / failed
//                   agents as a dim "+n" beside it
// Click (or nocturne-notifications.open) opens the overview.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, terminals, nextCommand, shared, keys } from "herdr";
import { Engine, items, OPEN } from "./engine.js";
import { counts } from "./model.js";
import { openOverview } from "./open.js";
import { dither, pip, stop } from "./kit.js";

const POLL = 1500;

/** "⌘⇧A" for the key bound to open the overview, if any. */
function shortcut() {
  const k = keys().find((x) => x.action === "nocturne-notifications.open")?.keys;
  if (!k) return "";
  return k.replace(/cmd-/g, "⌘").replace(/shift-/g, "⇧").replace(/alt-/g, "⌥").replace(/ctrl-/g, "⌃").toUpperCase();
}

export default class Bell {
  init(_props, cx) {
    this.engine = new Engine();
    this.seen = "";
    this.refresh(cx);
    cx.timer.every(POLL, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^nocturne-notifications\./, "");
        if (c === "open") {
          // A toast asks for one terminal's request through shared(OPEN), fresh.
          const o = shared(OPEN);
          openOverview(o && Date.now() - (o.at ?? 0) < 5000 ? o.terminal : null);
        } else if (c === "refresh") this.refresh(cx);
        cx.notify();
      }
    });
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      try { if (await this.engine.refresh()) cx.notify(); } catch (e) { console.log(`nocturne-notifications: ${e}`); }
    });
  }

  render(cx) {
    const t = theme();
    // A status changed: read again now rather than at the next poll.
    const sig = terminals().map((x) => `${x.address}:${x.report?.state ?? x.status}:${x.status_ms ?? ""}`).join(",");
    if (sig !== this.seen) { this.seen = sig; this.refresh(cx); }
    const c = counts(items());
    const parts = [c.permission && `${c.permission} permission${c.permission > 1 ? "s" : ""}`, c.question && `${c.question} question${c.question > 1 ? "s" : ""}`, c.other && `${c.other} other`].filter(Boolean);
    const key = shortcut();
    const tip = (parts.length ? `Waiting on you: ${parts.join(" · ")}` : "Nothing waits on you") + (key ? ` (${key})` : "");
    return h_flex().id("notify-bell").relative().size_full().pr(10).items_center().justify_start().bg(t.background)
      // The tab strip's horizon continues under the bell.
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)))
      .child(h_flex().id("bell").relative().h(24).px(7).gap(6).items_center().text_size(11).cursor_pointer()
        .hover((s) => s.bg(t.ansi0))
        .tooltip(tip)
        .on_mouse_down("left", stop)
        .on_click(() => openOverview())
        .when(c.needs > 0, (el) => el
          .child(pip(t.blocked, 6, true))
          .child(div().h(15).px(4).flex().items_center().bg(t.blocked).text_color(t.background).child(String(c.needs))))
        .when(c.needs === 0, (el) => el.child(pip(c.other ? t.done : t.ansi0, 6)))
        .when(c.other > 0, (el) => el.child(div().text_color(t.dim).child(c.needs > 0 ? `+${c.other}` : String(c.other)))));
  }
}
