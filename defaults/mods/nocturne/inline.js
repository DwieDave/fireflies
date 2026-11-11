// Inline editing pieces for the sidebar's lists (spaces, worktrees): a text
// button, a one-line field, a confirm panel for destructive steps, and a
// progress line for slow ones. Colors from theme() only.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import { ART } from "./kit.js";

const stop = (_e, cx) => cx.stop_propagation();

/** A small text button. */
export function chip(t, id, label, action, color) {
  return div().id(id).relative().flex_none().px(5).h(18).flex().items_center().text_size(11).text_color(color ?? t.muted)
    .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
    .child(label);
}

/** A one-line field; Enter submits (the InputState's own "submit"), Esc calls cancel,
 *  Tab / Shift-Tab call `tab(back, cx)` when given (the next field of a form). */
export function field(t, id, input, cancel, tab) {
  return div().id(id).flex_1().min_w(0).h(20).px(4).border(1).border_color(t.accent).bg(t.background)
    .on_mouse_down("left", stop)
    .on_key_down((e, cx) => {
      if (e.key === "escape") { cx.stop_propagation(); cancel(cx); }
      else if (e.key === "tab" && tab) { cx.stop_propagation(); tab(Boolean(e.modifiers?.shift), cx); }
    })
    .child(Input.new(input).h_full().text_size(11).text_color(t.foreground));
}

/** A checkbox with a label, drawn like the diff pane's reviewed box. */
export function check(t, id, label, on, action) {
  return h_flex().id(id).flex_none().gap(6).h(18).items_center().text_size(11)
    .text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
    .child(div().size(10).flex_none().border(1).border_color(on ? t.blocked : t.ansi8).when(on, (el) => el.bg(t.blocked)))
    .child(label);
}

/** The animated "this is happening" line: a blinking pip and the step's words. */
export function working(t, id, text) {
  return h_flex().id(id).h(20).gap(8).items_center().text_size(11)
    .child(svg(`${ART}/pip.svg`).size(6).flex_none().text_color(t.working).loop("opacity", { from: 0.15, to: 1, period: 600, easing: "linear" }))
    .child(div().text_color(t.working).child(text))
    .child(div().w(18).text_color(t.working).frames(["", ".", "..", "..."], 300));
}

/**
 * A destructive step asked about in place of a row.
 *   title   "Delete feat/x?"
 *   facts   [[color, text], ...]: what it will do and what's at risk
 *   options extra elements (checkboxes)
 *   go      { label, action }   keep: cancel
 *   busy    a step's words while it runs: buttons give way to `working`
 */
export function confirm(t, id, { title, facts = [], options = [], go, keep, keepLabel = "keep", busy }) {
  return v_flex().id(id).mx(10).my(3).px(8).py(6).gap(4).text_size(11)
    .bg(t.ansi0 + "66").border_l(2).border_color(t.blocked)
    .on_mouse_down("left", stop)
    .child(div().truncate().text_color(t.foreground).child(title))
    .children(facts.map(([color, text], i) => div().id(`${id}-fact-${i}`).text_color(color).child(text)))
    .when(!busy, (el) => el
      .children(options)
      .child(h_flex().pt(2).gap(6).items_center()
        .child(div().id(`${id}-go`).flex_none().h(20).px(8).flex().items_center().border(1).border_color(t.blocked).text_color(t.blocked)
          .hover((s) => s.bg(t.blocked).text_color(t.background))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); go.action(cx); })
          .child(go.label))
        .child(chip(t, `${id}-keep`, keepLabel, keep))))
    .when(Boolean(busy), (el) => el.child(working(t, `${id}-busy`, busy)));
}
