// The bell: a quiet mark in the tab strip, and the engine behind it.
//
//   nothing waits   a 9 px pixel bell (art/bell.svg, drawn like the strip's
//                   ▶), muted like the strip's tools; blue while open
//   requests wait   the bell in pink, blinking, and how many permissions and
//                   questions wait, in a filled chip; agents that need a
//                   look (an error, waiting for input) as a dim "+n" beside it
//   a look only     the bell in the working yellow and a dim count
// Click opens the overview, hanging under the bell like the script runner's
// deck under ▶; nocturne-notifications.open (a key, the palette, a toast)
// opens it centered, as cmd-shift-r the deck. Again closes it, and the
// bell is lit (a dithered band, a blue foot) while it's open. A toast's
// request for one terminal opens it on that one. Nocturne's tab strip walks
// to it with the keyboard (its row's last control): a blue ring while its
// cursor is here (shared CHROME), enter opens or closes the overview.
//
// The bell's block is as wide as the bell plus END: it ends where the panes
// below end, with no blank after it. It sizes its own block (layout.resize)
// when the bell grows or shrinks. Nocturne's layout puts "+ new" after it
// (props.end 0: that block keeps the room at the end).

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, terminals, nextCommand, shared, keys, layout, run, settings, props } from "herdr";
import { Engine, items, OPEN } from "./engine.js";
import { counts } from "./model.js";
import { openOverview, toggleOverview, overviewOpen, noteWindow } from "./open.js";
import { ART, dither, stop } from "./kit.js";

const POLL = 1500;
// Room after the bell, layout px: the main block's side padding, so its edge
// lines up with the panes' right edge; props.end when a block follows.
const END = 8;
const end = () => { const e = Number(props()?.end); return Number.isFinite(e) && e >= 0 ? e : END; };
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
  const px = Math.round(width / (Number(settings()?.zoom) || 1)) + end();
  if (Math.abs((node.size?.px ?? 0) - px) >= 1) run("layout.resize", { id: node.id, px });
}

/** "⌘⇧A" for the key bound to open the overview, if any. */
function shortcut() {
  const k = keys().find((x) => x.action === "nocturne-notifications.open")?.keys;
  if (!k) return "";
  return k.replace(/cmd-/g, "⌘").replace(/shift-/g, "⇧").replace(/alt-/g, "⌥").replace(/ctrl-/g, "⌃").toUpperCase();
}

/** The bell's mark in `color`; `blink` for what needs the person. */
export function mark(color, blink = false) {
  const el = svg(`${ART}/bell.svg`).size(9).flex_none().text_color(color);
  return blink ? el.loop("opacity", { from: 0.15, to: 1, period: 700, easing: "linear" }) : el;
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
          // A toast asks for one terminal's request through shared(OPEN),
          // fresh and once: that opens (or retargets) the overview; else open
          // toggles it.
          const o = shared(OPEN);
          if (o?.terminal && o.at !== this.asked && Date.now() - (o.at ?? 0) < 5000) {
            this.asked = o.at;
            openOverview(o.terminal);
          } else toggleOverview();
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
    const open = Boolean(overviewOpen());
    // How big the overview can be (open.js overviewPlace).
    try { noteWindow(window.viewport_size?.()); } catch { /* not drawing: the last size stays */ }
    return h_flex().id("notify-bell").relative().size_full().pr(end()).items_center().justify_start().bg(t.background)
      // The tab strip's horizon continues under the bell.
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)))
      .child(h_flex().id("bell").relative().flex_none().h(24).px(7).gap(6).items_center().text_size(11).text_color(open ? t.foreground : t.muted).cursor_pointer()
        .on_size_change((size) => fit(size.width))
        .hover((s) => s.bg(t.ansi0).text_color(t.foreground))
        // No tooltip while open: it would sit on the drop-down.
        .when(!open, (el) => el.tooltip(tip))
        // As the strip's buttons (nocturne/tabs.js tool): the click goes by
        // whether the bell was lit when pressed, since the press itself
        // closes an open drop-down before the click comes.
        .on_mouse_down("left", (e, cx) => { stop(e, cx); this.press = { e, open }; })
        .on_click(() => toggleOverview({ press: this.press?.e, wasOpen: Boolean(this.press?.open) }))
        // Open: the strip's open look, a dithered band and a blue foot.
        .when(open, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(4).right(4).bottom(0).h(2).bg(t.accent)))
        .when(c.needs > 0, (el) => el
          .child(mark(t.blocked, true))
          .child(div().h(15).px(4).flex().items_center().bg(t.blocked).text_color(t.background).child(String(c.needs))))
        .when(c.needs === 0 && c.other > 0, (el) => el.child(mark(t.working)))
        .when(c.needs === 0 && !c.other, (el) => el.child(mark(open ? t.accent : t.muted)))
        .when(c.other > 0, (el) => el.child(div().text_color(t.dim).child(c.needs > 0 ? `+${c.other}` : String(c.other))))
        .when(ring, (el) => el.text_color(t.foreground).child(div().absolute().top(0).left(0).size_full().border(1).border_color(t.accent))));
  }
}
