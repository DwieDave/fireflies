// Notifications ({ role: "toast" }), in Nocturne's look: a square card with
// a dithered edge in the level's color, a pip, the title and one body line.
// Herdr opens one per notify() with the notification as props
// ({ title, body, level, icon, action, overlay }), 340 x 72, bottom right.
// Click runs its action (e.g. go to the agent) and dismisses it.
// An agent's own toast (Herdr's "… needs you", going to the agent) says what
// it asks when the notifications mod knows (shared ITEMS: "wants to run a
// command", the command), and a click opens that request in its overview.

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, closeOverlay, run, theme, shared, setShared } from "herdr";
import { ART, dither } from "./kit.js";

// The level's theme color: the same words the fireflies use for status.
const COLOR = { error: "blocked", warning: "working", success: "done", info: "accent" };

// nocturne-notifications' items and the request its overview opens on.
const ITEMS = "nocturne-notifications.items";
const OPEN = "nocturne-notifications.open";

/** The notifications mod's request for an agent's toast, if it has one. */
function request(p) {
  if (p.action?.name !== "agent.focus") return null;
  const list = shared(ITEMS);
  return Array.isArray(list) ? list.find((x) => x.address === p.action.args?.terminal && x.type !== "other") ?? null : null;
}

export default class Toast {
  render() {
    const t = theme();
    const p = props() ?? {};
    const ask = request(p);
    const color = t[COLOR[p.level] ?? "accent"];
    const urgent = p.level === "error" || p.level === "warning";
    const mark = p.icon
      ? image(p.icon).size(16).flex_none()
      : svg(`${ART}/pip.svg`).size(8).flex_none().text_color(color)
        .when(urgent, (el) => el.loop("opacity", { from: 0.25, to: 1, period: p.level === "error" ? 700 : 1400, easing: "linear" }));
    return h_flex().id("nocturne-toast").relative().size_full().bg(t.background).border(1).border_color(t.ansi0)
      .cursor_pointer()
      .on_click(() => {
        if (ask) {
          setShared(OPEN, { terminal: ask.address, at: Date.now() });
          run("nocturne-notifications.open");
        } else if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
      // A dithered stripe down the left edge in the level's color.
      .child(div().relative().w(6).h_full().flex_none().child(dither(color, 1)))
      .child(h_flex().relative().flex_1().min_w(0).h_full().px(12).gap(12).items_center()
        .hover((s) => s.bg(t.ansi0 + "55"))
        .child(div().w(16).flex_none().flex().items_center().justify_center().child(mark))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(div().truncate().text_size(12).text_color(urgent ? color : t.foreground).child(ask?.title ?? p.title ?? ""))
          .when(Boolean(ask?.line ?? p.body), (el) => el.child(div().truncate().text_size(11).text_color(t.muted).child(ask?.line ?? p.body)))))
      // The horizon line, like the tab strip's.
      .child(div().absolute().left(6).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }
}
