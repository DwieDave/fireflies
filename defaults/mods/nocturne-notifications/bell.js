// The bell: a quiet mark in the tab strip, and the engine behind it.
//
//   nothing waits   a dim "N" (for notifications, lettered as the rail's spaces)
//   requests wait   a blinking pink pip and how many permissions and
//                   questions wait, in a filled chip; agents that need a
//                   look (an error, waiting for input) as a dim "+n" beside it
// Click (or nocturne-notifications.open) opens the overview. Nocturne's tab
// strip walks to it with the keyboard (its row's last control): a blue ring
// while its cursor is here (shared CHROME), enter opens the overview.
//
// The bell's block is as wide as the bell plus END: it ends where the panes
// below end, with no blank after it. It sizes its own block (layout.resize)
// when the bell grows or shrinks.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, terminals, nextCommand, shared, keys, layout, run, settings } from "herdr";
import { Engine, items, OPEN } from "./engine.js";
import { counts } from "./model.js";
import { openOverview } from "./open.js";
import { dither, pip, stop } from "./kit.js";

const POLL = 1500;
// Room after the bell, layout px: the main block's side padding, so its edge
// lines up with the panes' right edge.
const END = 8;
// Nocturne's keyboard cursor outside its tab strip (nocturne/nav.js CURSOR).
const CHROME = "nocturne.chrome";

/** This bell's layout block: the one showing nocturne-notifications as a bell. */
function bellNode(n = layout()) {
  if (!n || typeof n !== "object") return null;
  if (n.content?.mod === "nocturne-notifications" && (n.content?.props?.role ?? "bell") === "bell") return n;
  for (const c of n.children ?? []) { const f = bellNode(c); if (f) return f; }
  return null;
}

/** Sizes the bell's block to `width` (drawn px, zoomed) plus END, when it isn't. */
function fit(width) {
  const node = bellNode();
  if (!node?.id || !(width > 0)) return;
  const px = Math.round(width / (Number(settings()?.zoom) || 1)) + END;
  if (Math.abs((node.size?.px ?? 0) - px) >= 1) run("layout.resize", { id: node.id, px });
}

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
    const parts = [c.permission && `${c.permission} permission${c.permission > 1 ? "s" : ""}`, c.question && `${c.question} question${c.question > 1 ? "s" : ""}`, c.other && `${c.other} to look at`].filter(Boolean);
    const key = shortcut();
    const tip = (parts.length ? `Waiting on you: ${parts.join(" · ")}` : "Nothing waits on you") + (key ? ` (${key})` : "");
    const ring = shared(CHROME)?.region === "bell";
    return h_flex().id("notify-bell").relative().size_full().pr(END).items_center().justify_start().bg(t.background)
      // The tab strip's horizon continues under the bell.
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)))
      .child(h_flex().id("bell").relative().flex_none().h(24).px(7).gap(6).items_center().text_size(11).text_color(t.muted).cursor_pointer()
        .on_size_change((size) => fit(size.width))
        .hover((s) => s.bg(t.ansi0).text_color(t.foreground))
        .tooltip(tip)
        .on_mouse_down("left", stop)
        .on_click(() => openOverview())
        .when(c.needs > 0, (el) => el
          .child(pip(t.blocked, 6, true))
          .child(div().h(15).px(4).flex().items_center().bg(t.blocked).text_color(t.background).child(String(c.needs))))
        .when(c.needs === 0 && c.other > 0, (el) => el.child(pip(t.working, 6)))
        .when(c.needs === 0 && !c.other, (el) => el.child(div().child("N")))
        .when(c.other > 0, (el) => el.child(div().text_color(t.dim).child(c.needs > 0 ? `+${c.other}` : String(c.other))))
        .when(ring, (el) => el.text_color(t.foreground).child(div().absolute().top(0).left(0).size_full().border(1).border_color(t.accent))));
  }
}
