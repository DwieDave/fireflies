// Herdr's own dialogs in Nocturne's look: square, 1-bit, a title over a
// dithered horizon line. The layout's prompt_mod and confirm_mod (DwieDave
// fork) open this mod with the shipped dialogs' props plus `dialog`:
//   prompt   { title, value, hint, command }  a name (rename tab / space);
//            Enter saves (runs command with { name }), Esc cancels
//   confirm  { title, detail, command }       before something destructive;
//            Enter confirms (runs command), Esc keeps
// Colors from theme() only.

import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme } from "herdr";
import { dither } from "./kit.js";

const stop = (_e, cx) => cx.stop_propagation();
const cap = (s) => (s ?? "").replace(/^./, (c) => c.toUpperCase());

/** The title row: the words, "esc" at the right, the horizon under it. */
function titleRow(t, title) {
  return h_flex().relative().h(34).flex_none().px(14).items_center()
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(title))
    .child(div().text_size(11).text_color(t.dim).child("esc"))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
}

/** A square button: `strong` fills on hover in its color, the other is a quiet chip. */
function button(t, id, label, color, strong, action) {
  return div().id(id).flex_none().h(24).px(10).flex().items_center().text_size(11)
    .border(1).border_color(strong ? color : t.ansi0).text_color(strong ? color : t.muted)
    .hover((s) => strong ? s.bg(color).text_color(t.background) : s.text_color(t.foreground).bg(t.ansi0))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => { cx.stop_propagation(); action(); })
    .child(label);
}

function frame(t, id) {
  return v_flex().id(id).w_full().min_h(0).bg(t.background).border(1).border_color(t.ansi0).text_color(t.foreground);
}

export class Prompt {
  init(_props, cx) {
    const value = props()?.value ?? "";
    this.input = InputState.new({ value, placeholder: "name" });
    if (value) this.input.set_selected_range({ start: 0, end: value.length });
    this.input.on("submit", () => this.save());
    this.input.focus();
    // The overlay takes focus once it's shown; take it back.
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  close() { closeOverlay(props().overlay); }

  save() {
    const p = props();
    this.close();
    run(p.command.name, { ...(p.command.args ?? {}), name: this.input.value().trim() });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    return frame(t, "nocturne-prompt").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); this.close(); } })
      .child(titleRow(t, cap(p.title)))
      .child(v_flex().px(14).pt(12).pb(12).gap(6)
        .child(div().h(26).px(6).flex().items_center().border(1).border_color(t.accent).bg(t.background)
          .on_mouse_down("left", stop)
          .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground)))
        .when(Boolean(p.hint), (el) => el.child(div().text_size(11).text_color(t.dim).child(p.hint)))
        .child(h_flex().pt(6).gap(6).justify_end()
          .child(button(t, "pm-cancel", "cancel", t.muted, false, () => this.close()))
          .child(button(t, "pm-save", "save", t.accent, true, () => this.save()))));
  }
}

export class Confirm {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  close() { closeOverlay(props().overlay); }

  yes() {
    const p = props();
    this.close();
    run(p.command.name, p.command.args ?? {});
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    // Destructive: a red edge down the left, like the sidebar's inline confirms.
    return frame(t, "nocturne-confirm").size_full().relative().track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "enter") this.yes();
        else if (e.key === "escape") this.close();
        else return;
        cx.stop_propagation();
      })
      .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.blocked))
      .child(titleRow(t, p.title ?? "Are you sure?"))
      .child(div().id("confirm-detail").flex_1().min_h(0).px(14).pt(10).overflow_y_scrollbar()
        .text_size(11).text_color(t.muted).child(p.detail ?? ""))
      .child(h_flex().px(14).pb(12).pt(6).gap(6).justify_end()
        .child(button(t, "cf-keep", "keep", t.muted, false, () => this.close()))
        .child(button(t, "cf-go", "confirm", t.blocked, true, () => this.yes())));
  }
}
