import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { theme, props, closeOverlay, feedbackIssue, run } from "herdr";

// Feedback is a GitHub issue: this drafts it, GitHub's page (opened like any
// link) is where the person adds screenshots and submits. Nothing is sent from here.
export default class Feedback extends View {
  init(_props, cx) {
    this.title = InputState.new({ placeholder: "Title (optional: the message's first line)" });
    this.message = TextareaState.new({ value: props()?.message ?? "", placeholder: "What happened? What did you expect?", rows: 4 });
    this.title.on("change", (_e, cx) => cx.notify());
    this.message.on("change", (_e, cx) => cx.notify());
    this.handle = cx.focus_handle();
    this.message.focus();
  }

  close() { closeOverlay(props()?.overlay); }

  button(t, id, label, action, primary = false, disabled = false) {
    return div().id(id).px(14).py(7).rounded(7).border_1().border_color(t.border)
      .bg(primary && !disabled ? t.accent : t.raised)
      .text_color(primary && !disabled ? t.accent_foreground : t.muted)
      .cursor_pointer().on_click((e, cx) => { if (!disabled) action(e, cx); }).child(label);
  }

  open(issue) {
    run("app.open_url", { url: issue.url });
    this.close();
  }

  render(cx) {
    const t = theme();
    const issue = feedbackIssue(this.title.value(), this.message.value());
    const disabled = !this.message.value().trim();
    const label = (text) => div().text_size(13).text_color(t.muted).child(text);
    const field = (el) => el.w_full().p(10).rounded(7).border_1().border_color(t.border).bg(t.background).text_color(t.foreground).text_size(14);
    return v_flex().id("feedback").track_focus(this.handle).w_full().min_h(0).h(600).bg(t.popover)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.close(); cx.stop_propagation(); } })
      // The title drags the window; everything below keeps its presses (selecting text).
      .child(div().flex_none().px(24).py(18).cursor_grab().text_size(19).font_semibold().text_color(t.foreground).child("Send feedback"))
      .child(v_flex().id("feedback-body").on_mouse_down("left", (_e, cx) => cx.stop_propagation()).flex_1().flex_shrink(1).min_h(0).overflow_y_scrollbar().px(24).gap(10)
        .when(props()?.from === "agent", (el) => el.child(div().p(10).rounded(7).bg(t.raised).text_color(t.accent).text_size(14).child("Drafted by an agent: read it before opening")))
        .child(label("Opens a new GitHub issue with this filled in. You review it, add screenshots and submit it there."))
        .child(field(Input.new(this.title)).h(40))
        .child(field(Textarea.new(this.message)).h(150))
        .child(label("The issue's text:"))
        .child(v_flex().w_full().p(10).rounded(7).border_1().border_color(t.border).bg(t.background)
          .children([`# ${issue.title}`, "", ...issue.body.split("\n")].map((line) => div().text_size(11).line_height("15px").text_color(t.dim).child(line || " ")))))
      .child(h_flex().flex_none().px(24).py(16).gap(10).justify_end().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(this.button(t, "feedback-cancel", "Cancel", () => this.close()))
        .child(this.button(t, "feedback-open", "Open on GitHub", () => this.open(issue), true, disabled)));
  }
}
