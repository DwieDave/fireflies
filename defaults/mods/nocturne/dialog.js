// Herdr's own dialogs in Nocturne's look: square, 1-bit, a title over a
// dithered horizon line. The layout's prompt_mod and confirm_mod (DwieDave
// fork) open this mod with the shipped dialogs' props plus `dialog`:
//   prompt   { title, value, hint, command }  a name (rename tab / space);
//            Enter saves (runs command with { name }), Esc cancels; Tab /
//            Shift-Tab go name → cancel → save, ← → between the buttons,
//            Enter (or Space) presses the focused one
//   confirm  { title, detail, command }       before something destructive;
//            Enter confirms (runs command), Esc keeps; Tab / ← → / h l move
//            between keep and confirm (confirm first), Enter / Space press,
//            y confirms, n keeps
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

/** A square button: `strong` fills on hover in its color, the other is a quiet
 *  chip. `focused` (the keyboard's) looks hovered, edged in the accent. */
function button(t, id, label, color, strong, action, focused = false) {
  return div().id(id).flex_none().h(24).px(10).flex().items_center().text_size(11)
    .border(1).border_color(focused ? (strong ? color : t.accent) : strong ? color : t.ansi0).text_color(strong ? color : t.muted)
    .when(focused, (el) => strong ? el.bg(color).text_color(t.background) : el.text_color(t.foreground).bg(t.ansi0))
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
    cx.timer.after(600, () => { if (this.at === "input") this.input.focus(); });
    this.handle = cx.focus_handle();
    this.at = "input"; // the keyboard's: "input" | "cancel" | "save"
  }

  close() { closeOverlay(props().overlay); }

  /** The keys the dialog takes before the name field: moving between the
   *  field and the buttons, and pressing a button. */
  key(e, cx) {
    const k = e.key, m = e.modifiers ?? {};
    if (m.control || m.platform || m.alt) return;
    const stops = ["input", "cancel", "save"];
    const go = (at) => {
      this.at = at;
      if (at === "input") this.input.focus(); else this.handle.focus();
    };
    if (k === "escape") this.close();
    else if (k === "tab") go(stops[(stops.indexOf(this.at) + (m.shift ? 2 : 1)) % 3]);
    else if (this.at === "input") return;
    else if (k === "left" || k === "right" || k === "h" || k === "l") go(this.at === "save" ? "cancel" : "save");
    else if (k === "enter" || k === "space") this.at === "save" ? this.save() : this.close();
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  save() {
    const p = props();
    this.close();
    run(p.command.name, { ...(p.command.args ?? {}), name: this.input.value().trim() });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    return frame(t, "nocturne-prompt").track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(titleRow(t, cap(p.title)))
      .child(v_flex().px(14).pt(12).pb(12).gap(6)
        .child(div().h(26).px(6).flex().items_center().border(1).border_color(this.at === "input" ? t.accent : t.ansi0).bg(t.background)
          .on_mouse_down("left", stop)
          .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground)))
        .when(Boolean(p.hint), (el) => el.child(div().text_size(11).text_color(t.dim).child(p.hint)))
        .child(h_flex().pt(6).gap(6).justify_end()
          .child(button(t, "pm-cancel", "cancel", t.muted, false, () => this.close(), this.at === "cancel"))
          .child(button(t, "pm-save", "save", t.accent, true, () => this.save(), this.at === "save"))));
  }
}

export class Confirm {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    // The overlay takes focus once it's shown; take it back.
    cx.timer.after(600, () => this.handle.focus());
    this.at = "go"; // the keyboard's button: "go" (confirm) | "keep"
  }

  key(e, cx) {
    const k = e.key, m = e.modifiers ?? {};
    if (m.control || m.platform || m.alt) return;
    if (k === "enter" || k === "space") this.at === "go" ? this.yes() : this.close();
    else if (k === "escape" || k === "n") this.close();
    else if (k === "y") this.yes();
    else if (["tab", "left", "right", "h", "l"].includes(k)) this.at = this.at === "go" ? "keep" : "go";
    else return;
    cx.stop_propagation();
    cx.notify();
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
    return frame(t, "nocturne-confirm").relative().track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.blocked))
      .child(titleRow(t, p.title ?? "Are you sure?"))
      // As tall as its words (the dialog fits its content), scrolling past 240 px.
      .child(div().id("confirm-detail").max_h(240).px(14).pt(10).overflow_y_scrollbar()
        .text_size(11).line_height("17px").text_color(t.muted).child(p.detail ?? ""))
      .child(h_flex().px(14).pb(12).pt(6).gap(6).justify_end()
        .child(button(t, "cf-keep", "keep", t.muted, false, () => this.close(), this.at === "keep"))
        .child(button(t, "cf-go", "confirm", t.blocked, true, () => this.yes(), this.at === "go")));
  }
}
