// The question dialog: a block of questions answered like Claude Code's
// AskUserQuestion (keys in ask.js), then a review that sends them together.
// Progress is a row of dithered cells, one per question and one for the
// review; nothing reaches the agent before "submit".

import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, props, closeOverlay, run, nextCommand } from "herdr";
import { items } from "./engine.js";
import { where } from "./model.js";
import { start, press, setOther, answers, answered, isReview, otherRow, REVIEW } from "./ask.js";
import { reviewText } from "./claude.js";
import { answer } from "./drive.js";
import { forget, followCommands } from "./open.js";
import { dither, pip, logo, horizon, kbd, stop } from "./kit.js";

export default class AskDialog {
  init(p, cx) {
    this.terminal = p?.terminal ?? props()?.terminal;
    this.item = this.find();
    this.asked = this.item ? JSON.stringify(this.item.request.questions) : "";
    this.s = this.item ? start(this.item.request.questions) : null;
    this.busy = null;
    this.note = null; // { text, bad }
    this.changed = false;
    this.input = InputState.new({ placeholder: "type your answer" });
    this.input.on("submit", (_e, cx) => {
      this.s = setOther(this.qs(), this.s, this.input.value());
      this.handle.focus();
      cx.notify();
    });
    this.handle = cx.focus_handle();
    this.handle.focus();
    followCommands(cx, nextCommand, (e, cx) => this.key(e, cx), () => (this.s?.editing ? this.input.focus() : this.handle.focus()));
    cx.timer.after(400, () => (this.s?.editing ? this.input.focus() : this.handle.focus()));
  }

  find() {
    return items().find((x) => x.address === this.terminal && x.type === "question" && x.answerable) ?? null;
  }

  qs() { return this.item?.request?.questions ?? []; }
  closing() { forget("ask", props()?.overlay); }
  close() { closeOverlay(props()?.overlay); }

  apply(action, cx) {
    if (action === "close") return this.close();
    if (action === "edit") {
      const i = this.s.q;
      this.input.set_value(this.s.other[i] ?? "");
      this.input.focus();
    }
    if (action === "submit") this.submit(cx);
  }

  submit(cx) {
    if (this.busy || this.changed) return;
    const goal = { type: "question", request: this.item.request, answers: answers(this.qs(), this.s) };
    this.busy = "sending";
    this.note = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await answer(cx, this.item, goal, (text) => { this.busy = text; cx.notify(); }).catch((e) => ({ ok: false, reason: String(e) }));
      this.busy = null;
      run("nocturne-notifications.refresh");
      if (r.ok) return this.close();
      this.note = { text: r.reason, bad: true };
      cx.notify();
    });
  }

  key(e, cx) {
    if (!this.s) { if (e.key === "escape") this.close(); return; }
    const m = e.modifiers;
    if (m.control || m.platform || m.alt) return;
    if (this.s.editing && e.key !== "escape") return; // the input has it
    const k = e.key === " " ? "space" : e.key;
    const { state, action } = press(this.qs(), this.s, k, { shift: m.shift });
    this.s = state;
    if (!state.editing) this.handle.focus();
    this.apply(action, cx);
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    const t = theme();
    // The request on the agent's screen changed or went away meanwhile.
    const now = this.find();
    if (this.item && (!now || JSON.stringify(now.request.questions) !== this.asked) && !this.busy) this.changed = true;
    const it = this.item;
    const frame = v_flex().id("notify-ask").relative().size_full().bg(t.background).border(1).border_color(t.ansi0).text_color(t.foreground).text_size(11)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx));
    const head = h_flex().relative().h(34).flex_none().px(14).gap(10).items_center()
      .child(logo(it?.logo ?? "claude", t.foreground, 12))
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(it ? `${it.name} asks` : "Questions"))
      .when(Boolean(it && where(it)), (el) => el.child(div().flex_none().text_color(t.dim).child(where(it))))
      .child(div().flex_none().text_color(t.dim).child("esc"))
      .child(horizon(t));
    if (!it) {
      return frame.child(head).child(v_flex().flex_1().items_center().justify_center().gap(8)
        .child(div().text_color(t.muted).child("These questions are gone: answered or withdrawn.")));
    }
    const qs = this.qs();
    const body = isReview(qs, this.s) ? this.review(t, qs) : this.question(t, qs);
    return frame.child(head).child(this.cells(t, qs)).child(body).child(this.footer(t, qs));
  }

  cells(t, qs) {
    const cell = (i) => {
      const on = this.s.q === i;
      const done = i < qs.length ? answered(qs, this.s, i) : false;
      const review = i === qs.length;
      const color = on ? t.accent : done ? t.done : t.ansi0;
      return div().id(`cell-${i}`).relative().w(review ? 22 : 34).h(8).flex_none().border(1).border_color(color).cursor_pointer()
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { this.s = { ...this.s, q: i, editing: false }; this.handle.focus(); cx.notify(); })
        .when(done || on, (el) => el.child(div().absolute().top(1).left(1).right(1).bottom(1).opacity(on ? 0.6 : 1).child(dither(on ? t.accent : t.done, on ? 2 : 1))));
    };
    const where = isReview(qs, this.s) ? "review" : `${this.s.q + 1} of ${qs.length}`;
    return h_flex().px(18).pt(14).gap(4).items_center().flex_none()
      .children(qs.length > 1 ? [...qs.map((_, i) => cell(i)), cell(qs.length)] : [cell(0)])
      .child(div().ml(8).text_color(t.dim).child(qs.length > 1 ? where : ""));
  }

  question(t, qs) {
    const i = this.s.q;
    const q = qs[i];
    const cur = this.s.cursor[i];
    const box = (on, focus) => q.multiSelect
      ? div().relative().size(9).flex_none().border(1).border_color(on ? t.accent : t.dim)
        .when(on, (el) => el.child(div().absolute().top(1).left(1).right(1).bottom(1).bg(t.accent)))
      : div().relative().size(9).flex_none().flex().items_center().justify_center().child(on ? pip(t.accent, 6) : div());
    const row = (r, label, desc, on, content) => h_flex().id(`q${i}-row-${r}`).relative().px(18).py(6).gap(10).items_start().flex_none().cursor_pointer()
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        this.s = { ...this.s, cursor: this.s.cursor.map((c, j) => (j === i ? r : c)) };
        const { state, action } = press(qs, this.s, "enter");
        this.s = state;
        this.apply(action, cx);
        cx.notify();
      })
      .when(r === cur, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
      .child(div().relative().pt(3).w(14).flex_none().flex().justify_center().child(box(on, r === cur)))
      .child(content ?? v_flex().relative().flex_1().min_w(0).gap(2)
        .child(div().text_color(on || r === cur ? t.foreground : t.muted).child(label))
        .when(Boolean(desc), (el) => el.child(div().text_color(t.dim).child(desc))));
    const picked = this.s.picked[i];
    const o = otherRow(qs, i);
    const otherOn = this.s.otherOn[i] && Boolean(this.s.other[i]);
    const otherContent = this.s.editing
      ? h_flex().relative().flex_1().min_w(0).h(20).border_b_1().border_color(t.accent)
        .on_mouse_down("left", stop)
        .child(Input.new(this.input).flex_1().h_full().text_size(11).text_color(t.foreground))
      : div().relative().flex_1().min_w(0).text_color(this.s.other[i] ? (otherOn ? t.foreground : t.muted) : t.dim).child(this.s.other[i] || "other: type an answer");
    return v_flex().flex_1().min_h(0).id("ask-body").overflow_y_scrollbar()
      .child(div().px(18).pt(12).text_color(t.dim).child(`${q.header ? `${q.header} · ` : ""}${q.multiSelect ? "pick any" : "pick one"}`))
      .child(div().px(18).pt(6).pb(12).text_size(13).text_color(t.foreground).child(q.question))
      .children(q.options.map((x, r) => row(r, x.label, x.description, picked.includes(r) && !(!q.multiSelect && otherOn))))
      .child(row(o, null, null, otherOn, otherContent))
      .when(Boolean(this.note), (el) => el.child(div().px(18).pt(10).text_color(this.note.bad ? t.blocked : t.done).child(this.note.text)));
  }

  review(t, qs) {
    const rowEl = (k, i) => {
      const on = this.s.reviewCursor === i;
      const label = k === "submit" ? (this.busy ? `sending… ${this.busy === "sending" ? "" : this.busy}` : "submit answers") : "back to the first question";
      return h_flex().id(`rv-${k}`).relative().h(28).px(18).gap(10).items_center().flex_none().cursor_pointer()
        .text_color(on ? t.foreground : t.muted)
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => {
          this.s = { ...this.s, reviewCursor: i };
          const { state, action } = press(qs, this.s, "enter");
          this.s = state;
          this.apply(action, cx);
          cx.notify();
        })
        .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(k === "submit" ? t.done : t.accent)))
        .child(div().relative().w(14).flex_none().text_color(on ? t.accent : t.dim).child(String(i + 1)))
        .child(div().relative().child(label));
    };
    const a = answers(qs, this.s);
    return v_flex().flex_1().min_h(0).id("ask-review").overflow_y_scrollbar()
      .child(div().px(18).pt(12).text_color(t.dim).child("review · nothing is sent until you submit"))
      .child(v_flex().px(18).pt(10).pb(12).gap(8)
        .children(qs.map((q, i) => h_flex().gap(10).items_start()
          .child(div().pt(4).child(pip(answered(qs, this.s, i) ? t.done : t.ansi0, 6)))
          .child(v_flex().flex_1().min_w(0).gap(2)
            .child(div().text_color(t.muted).child(q.question))
            .child(div().text_color(answered(qs, this.s, i) ? t.foreground : t.dim).child(answered(qs, this.s, i) ? reviewText(q, a[i]) : "not answered yet"))))))
      .children(REVIEW.map(rowEl))
      .when(this.changed, (el) => el.child(div().px(18).pt(10).text_color(t.blocked).child("The questions changed or went away in the terminal: nothing was sent. Close and look again.")))
      .when(Boolean(this.note), (el) => el.child(div().px(18).pt(10).text_color(this.note.bad ? t.blocked : t.done).child(this.note.text)));
  }

  footer(t, qs) {
    const hint = (k, w) => h_flex().gap(5).items_center().flex_none().child(kbd(t, k)).child(div().text_color(t.dim).child(w));
    const q = qs[this.s.q];
    return h_flex().relative().h(30).flex_none().px(18).gap(12).items_center()
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
      .when(this.s.editing, (el) => el.child(hint("↵", "keep")).child(hint("esc", "drop")))
      .when(!this.s.editing, (el) => el
        .child(hint("j k", "move"))
        .child(hint(q?.multiSelect ? "space" : "↵", q?.multiSelect ? "toggle" : isReview(qs, this.s) ? "choose" : "pick"))
        .when(qs.length > 1, (el) => el.child(hint("⇥", "next")).child(hint("⇧⇥", "back"))))
      .child(div().flex_1())
      .when(this.changed && !isReview(qs, this.s), (el) => el.child(div().text_color(t.blocked).child("changed in the terminal")));
  }
}
