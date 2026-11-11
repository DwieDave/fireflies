// Popup menus in Nocturne's look (the "+ new" menu, right-click menus):
// square, 1-bit; the row under the cursor sits on a dithered band with a
// blue edge. An item: { id, mark, name, hint?, key?, go, off? }, or
// { section } for an eyebrow, { rule: true } for a divider, { note } for a line.
//
// Keys: ↑↓ / j k / ctrl-n ctrl-p / tab shift-tab move (wrapping), home / end
// jump to the ends, enter or space picks, an item's `key` picks it, esc closes.
// The list scrolls to keep the cursor in sight.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { closeOverlay, props } from "herdr";
import { dither, eyebrow } from "./kit.js";

export const ROW = 26;

/** A 14 px icon in the accent color (Herdr's shipped icon set). */
export function icon(t, name, color) {
  return svg(`mods/workspace-chrome/${name}.svg`).size(14).flex_none().text_color(color ?? t.accent);
}

export class Popup {
  init(cx) {
    this.cursor = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // The overlay takes the keyboard once it's shown; take it back.
    cx.timer.after(250, () => this.handle.focus());
    this.scroll = ScrollHandle.new();
  }

  /** A key: true when the popup used it. `live` are the pickable items, `items` all rows. */
  key(e, live, items) {
    const m = e.modifiers ?? {};
    const k = e.key, n = live.length;
    const ctrl = m.control && !m.platform && !m.alt;
    if ((m.control && !ctrl) || m.platform || m.alt) return false;
    let to = null;
    if (k === "down" || (!ctrl && k === "j") || (ctrl && k === "n") || (k === "tab" && !m.shift)) to = this.cursor + 1;
    else if (k === "up" || (!ctrl && k === "k") || (ctrl && k === "p") || (k === "tab" && m.shift)) to = this.cursor - 1;
    else if (k === "home") to = 0;
    else if (k === "end") to = n - 1;
    else if (ctrl) return false;
    else if (k === "enter" || k === "space") { this.pick(live[this.cursor]); return true; }
    else if (k === "escape" || (k === "q" && !m.shift && !live.some((y) => y.key === "q"))) { this.close(); return true; }
    else {
      const x = live.find((y) => y.key && y.key === k);
      if (!x) return false;
      this.pick(x);
      return true;
    }
    if (!n) return true;
    this.cursor = (to + n) % n;
    this.scroll.scroll_to_item(items.indexOf(live[this.cursor]));
    return true;
  }

  close() { closeOverlay(props().overlay); }

  pick(item) {
    if (!item?.go || item.off) return;
    this.close();
    item.go();
  }

  /** The popup: an optional title over a horizon line, then the items. */
  render(t, items, { title, hint } = {}) {
    const live = items.filter((x) => x.go && !x.off);
    this.cursor = Math.min(this.cursor, Math.max(0, live.length - 1));
    const current = live[this.cursor];
    const row = (x, i) => {
      if (x.section) return div().id(`pm-sec-${i}`).px(12).pt(10).pb(3).flex_none().child(eyebrow(t, x.section));
      if (x.rule) return div().id(`pm-rule-${i}`).mx(12).my(4).h(2).flex_none().relative().child(dither(t.ansi0, 1));
      if (x.note) return div().id(`pm-note-${i}`).px(12).h(ROW).flex().items_center().text_size(11).text_color(t.dim).child(x.note);
      const on = x === current;
      return h_flex().id(`pm-${x.id}`).relative().h(ROW).px(12).gap(10).items_center().flex_none().text_size(12)
        .text_color(x.off ? t.dim : on ? t.foreground : t.muted)
        .when(!x.off, (el) => el.on_hover((h, cx) => { if (h) { this.cursor = live.indexOf(x); cx.notify(); } }))
        .on_click(() => this.pick(x))
        .when(on, (el) => el
          .child(dither(t.ansi0, 1))
          .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
        .child(div().relative().w(14).flex_none().flex().items_center().justify_center().child(x.mark ?? div()))
        .child(div().relative().flex_1().min_w(0).truncate().child(x.name))
        .child(div().relative().flex_none().text_size(11).text_color(on && !x.off ? t.accent : t.dim).child(x.hint ?? ""));
    };
    return v_flex().id("nocturne-popup").size_full().bg(t.background).border(1).border_color(t.ansi0).py(4)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (!this.key(e, live, items)) return;
        cx.stop_propagation();
        cx.notify();
      })
      .when(Boolean(title), (el) => el.child(h_flex().relative().h(26).mt(-4).mb(2).flex_none().px(12).items_center()
        .child(div().text_size(11).text_color(t.foreground).child(title))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(hint ?? ""))
        .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)))))
      .child(v_flex().id("pm-list").flex_1().min_h(0).overflow_y_scroll().track_scroll(this.scroll).children(items.map(row)));
  }
}

/** Height for a list of items (plus a title), so nothing scrolls. */
export function popupHeight(items, title) {
  const h = items.reduce((k, x) => k + (x.section ? 30 : x.rule ? 10 : ROW), 0);
  return h + 10 + (title ? 24 : 0);
}
