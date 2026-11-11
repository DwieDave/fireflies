import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { theme, props, closeOverlay, feedbackIssue, run, window as appWindow } from "herdr";
import { formKey, formHints, submitKey, ring, bindTab, tabActions } from "./form-keys.js";

// Feedback is a GitHub issue: this drafts it, GitHub's page (opened like any
// link) is where the person adds screenshots and submits. Nothing is sent from here.
//
// Keys, as every form takes them (form-keys.js): tab / shift-tab go title →
// message → Cancel → Open on GitHub, wrapping; the focused one has the ring.
// Enter in the title opens it (cmd-enter from the message or Cancel), enter /
// space press a button, esc closes.

// The stops in tab order.
const STOPS = [
  { id: "title", kind: "text" },
  { id: "message", kind: "area" },
  { id: "feedback-cancel", kind: "button" },
  { id: "feedback-open", kind: "button", submit: true },
];

export default class Feedback extends View {
  init(_props, cx) {
    this.title = InputState.new({ placeholder: "Title (optional: the message's first line)" });
    this.message = TextareaState.new({ value: props()?.message ?? "", placeholder: "What happened? What did you expect?", rows: 4 });
    this.title.on("change", (_e, cx) => cx.notify());
    // The message eats cmd-enter as a new line and says so: take it back and open the issue.
    let before = this.message.value(), now = before;
    this.message.on("change", (_e, cx) => { before = now; now = this.message.value(); cx.notify(); });
    this.message.on("submit", (e, cx) => { if (!e?.secondary) return; this.message.set_value(before); now = before; this.submit(); cx?.notify?.(); });
    // A click into a field moves the keyboard's stop with it.
    this.title.on("focus", (_e, cx) => { this.at = 0; cx?.notify?.(); });
    this.message.on("focus", (_e, cx) => { this.at = 1; cx?.notify?.(); });
    this.handle = cx.focus_handle();
    bindTab(cx); // tab / shift-tab reach the key handler (form-keys.js)
    this.at = 0; // the stop with the keyboard (STOPS)
    this.title.focus();
    // The overlay takes focus once it's shown; take it back.
    cx.timer?.after?.(300, () => this.go(this.at));
  }

  close() { closeOverlay(props()?.overlay); }

  get mac() { return appWindow?.()?.platform === "macos"; }

  go(i) {
    this.at = i;
    if (i === 0) this.title.focus();
    else if (i === 1) this.message.focus();
    else this.handle.focus();
  }

  /** Opens the drafted issue, or (no message yet) takes the keyboard to the message. */
  submit() {
    if (!this.message.value().trim()) return this.go(1);
    this.open(feedbackIssue(this.title.value(), this.message.value()));
  }

  key(e, cx) {
    const a = formKey(STOPS, this.at, e.key, e.modifiers ?? {}, e.key_char);
    if (!a || a.act === "type") return;
    if (a.act === "move") this.go(a.to);
    else if (a.act === "cancel" || (a.act === "press" && this.at === 2)) this.close();
    else if (a.act === "submit" || a.act === "press") this.submit();
    cx.stop_propagation();
    cx.notify();
  }

  button(t, id, label, action, primary = false, disabled = false, focused = false) {
    return ring(div().id(id).px(14).py(7).rounded(7).border_1().border_color(t.border)
      .bg(primary && !disabled ? t.accent : t.raised)
      .text_color(primary && !disabled ? t.accent_foreground : focused ? t.foreground : t.muted)
      .cursor_pointer().on_click((e, cx) => { if (!disabled) action(e, cx); }).child(label), focused, primary && !disabled ? t.foreground : t.accent, 7);
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
    const field = (el, on) => el.w_full().p(10).rounded(7).border_1().border_color(on ? t.accent : t.border).bg(t.background).text_color(t.foreground).text_size(14);
    const hints = formHints(STOPS, this.at, { mac: this.mac, submit: "open on GitHub", cancel: "close" });
    return v_flex().id("feedback").track_focus(this.handle).w_full().min_h(0).h(600).bg(t.popover)
      .on_key_down((e, cx) => this.key(e, cx))
      .map((el) => tabActions(el, (e, cx) => this.key(e, cx)))
      // The title drags the window; everything below keeps its presses (selecting text).
      .child(div().flex_none().px(24).py(18).cursor_grab().text_size(19).font_semibold().text_color(t.foreground).child("Send feedback"))
      .child(v_flex().id("feedback-body").on_mouse_down("left", (_e, cx) => cx.stop_propagation()).flex_1().flex_shrink(1).min_h(0).overflow_y_scrollbar().px(24).gap(10)
        .when(props()?.from === "agent", (el) => el.child(div().p(10).rounded(7).bg(t.raised).text_color(t.accent).text_size(14).child("Drafted by an agent: read it before opening")))
        .child(label("Opens a new GitHub issue with this filled in. You review it, add screenshots and submit it there."))
        .child(field(Input.new(this.title), this.at === 0).h(40))
        .child(field(Textarea.new(this.message), this.at === 1).h(150))
        .child(label("The issue's text:"))
        .child(v_flex().w_full().p(10).rounded(7).border_1().border_color(t.border).bg(t.background)
          .children([`# ${issue.title}`, "", ...issue.body.split("\n")].map((line) => div().text_size(11).line_height("15px").text_color(t.dim).child(line || " ")))))
      .child(h_flex().flex_none().px(24).py(16).gap(10).items_center().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(h_flex().id("feedback-keys").flex_1().min_w(0).gap(10).overflow_hidden().text_size(12)
          .children(hints.map(([k, w], i) => h_flex().id(`fk-${i}`).flex_none().gap(4).child(div().text_color(t.foreground).child(k)).child(div().text_color(t.dim).child(w)))))
        .child(this.button(t, "feedback-cancel", "Cancel", () => this.close(), false, false, this.at === 2))
        .child(this.button(t, "feedback-open", `Open on GitHub  ${submitKey(STOPS, this.at, this.mac)}`, () => this.open(issue), true, disabled, this.at === 3)));
  }
}
