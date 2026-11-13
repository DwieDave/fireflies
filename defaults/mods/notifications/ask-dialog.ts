// The question dialog: a block of questions answered like Claude Code's
// AskUserQuestion (keys in ask.ts), then a review that sends them together.
// Progress is a row of dithered cells, one per question and one for the
// review; nothing reaches the agent before "submit".

import { div } from "gpui-kit";
import type { AsyncContext, Element, FocusHandle } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, props, closeOverlay, run, nextCommand, window as appWindow } from "herdr";
import type { Theme } from "herdr";
import { isString, object } from "./guard.ts";
import { items } from "./engine.ts";
import { where } from "./model.ts";
import type { Item } from "./model.ts";
import { start, press, setOther, keepOther, answers, answered, isReview, otherRow, REVIEW } from "./ask.ts";
import type { AskAction, AskState } from "./ask.ts";
import { reviewText } from "./claude.ts";
import type { QuestionGoal } from "./claude.ts";
import { answer } from "./drive.ts";
import { forget, followCommands } from "./open.ts";
import type { KeyContext, KeyInput } from "./open.ts";
import { dither, pip, logo, horizon, kbd, stop } from "./kit.ts";
import { bindTab, tabActions } from "./form-keys.ts";
import type { Question, QuestionRequest } from "./request.ts";

/** The dialog's props: the terminal whose questions it answers, its overlay. */
const isAskProps = object({}, { terminal: isString, overlay: isString });

const askProps = (given?: Props) => {
  const p = props() ?? given;

  return isAskProps(p) ? p : {};
};

/** An item asking a block of questions this mod can answer, and the block. */
type Asking = Item & { readonly request: QuestionRequest };

const askingOf = (it: Item | undefined): Asking | null => (it?.type === "question" && it.answerable && it.request?.type === "question" ? { ...it, request: it.request } : null);

export default class AskDialog {
  terminal: string | null = null;
  item: Asking | null = null;
  asked = "";
  s: AskState | null = null;
  busy: string | null = null;
  note: { readonly text: string; readonly bad: boolean } | null = null;
  changed = false;
  input: InputState | null = null;
  handle: FocusHandle | null = null;

  init(p: Props | undefined, cx: AsyncContext) {
    this.terminal = askProps(p).terminal ?? null;
    this.item = this.find();
    this.asked = this.item ? JSON.stringify(this.item.request.questions) : "";
    this.s = this.item ? start(this.item.request.questions) : null;

    const input = InputState.new({ placeholder: "type your answer" });

    this.input = input;
    this.handle = cx.focus_handle();
    bindTab(cx); // tab / shift-tab reach the key handler (form-keys.ts)

    const handle = this.handle;

    input.on("submit", (_e, cx) => {
      if (this.s) this.s = setOther(this.qs(), this.s, input.value());

      handle.focus();
      cx.notify();
    });
    handle.focus();
    followCommands(cx, nextCommand, (e, cx) => this.key(e, cx), () => (this.s?.editing ? input.focus() : handle.focus()));
    cx.timer.after(400, () => (this.s?.editing ? input.focus() : handle.focus()));
  }

  find(): Asking | null {
    return askingOf(items().find((x) => x.address === this.terminal && x.type === "question" && x.answerable));
  }

  qs(): readonly Question[] {
    return this.item?.request.questions ?? [];
  }

  closing() {
    forget("ask", askProps().overlay);
  }

  close() {
    const id = askProps().overlay;

    if (id !== undefined) closeOverlay(id);
  }

  apply(action: AskAction, cx: KeyContext) {
    if (action === "close") {
      this.close();

      return;
    }

    if (action === "edit" && this.s) {
      this.input?.set_value(this.s.other[this.s.q] ?? "");
      this.input?.focus();
    }

    if (action === "submit") this.submit(cx);
  }

  submit(cx: KeyContext) {
    const item = this.item, s = this.s;

    if (this.busy || this.changed || !item || !s) return;

    const goal: QuestionGoal = { type: "question", request: item.request, answers: answers(this.qs(), s) };

    this.busy = "sending";
    this.note = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await answer(cx, item, goal, (text) => {
        this.busy = text;
        cx.notify();
      }).catch((cause: unknown) => ({ ok: false, reason: String(cause) } as const));

      this.busy = null;
      run("notifications.refresh");

      if (r.ok) {
        this.close();

        return;
      }

      this.note = { text: r.reason, bad: true };
      cx.notify();
    });
  }

  key(e: KeyInput, cx: KeyContext) {
    const s = this.s;

    if (!s) {
      if (e.key === "escape") this.close();

      return;
    }

    const m = e.modifiers;
    // cmd-enter (ctrl-enter) submits from anywhere, the typed answer kept.
    const chord = e.key === "enter" && (m.platform || m.control);

    if (!chord && (m.control || m.platform || m.alt)) return;

    let now = s;

    if (s.editing && (e.key === "tab" || chord)) now = keepOther(this.qs(), s, this.input?.value() ?? "");
    else if (s.editing && e.key !== "escape") return; // the input has it

    const k = chord ? "submit" : e.key === " " ? "space" : e.key;
    const { state, action } = press(this.qs(), now, k, { shift: m.shift });

    this.s = state;

    if (!state.editing) this.handle?.focus();

    this.apply(action, cx);
    cx.stop_propagation();
    cx.notify();
  }

  /** Picks row `r` of the shown question (a click), as enter would. */
  pick(qs: readonly Question[], s: AskState, cx: KeyContext) {
    const { state, action } = press(qs, s, "enter");

    this.s = state;
    this.apply(action, cx);
    cx.notify();
  }

  render(): Element {
    const t = theme();
    // The request on the agent's screen changed or went away meanwhile.
    const now = this.find();

    if (this.item && (!now || JSON.stringify(now.request.questions) !== this.asked) && !this.busy) this.changed = true;

    const it = this.item;
    const root = v_flex().id("notify-ask").relative().size_full().bg(t.background).border(1).border_color(t.ansi0).text_color(t.foreground).text_size(11);

    const frame = (this.handle ? root.track_focus(this.handle) : root)
      .on_key_down((e, cx) => this.key(e, cx))
      .map((el) => tabActions(el, (e, cx) => this.key(e, cx)));

    const place = it ? where(it) : "";

    const head = h_flex().relative().h(34).flex_none().px(14).gap(10).items_center()
      .child(logo(it?.logo ?? "claude", t.foreground, 12))
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(it ? `${it.name} asks` : "Questions"))
      .when(Boolean(place), (el) => el.child(div().flex_none().text_color(t.dim).child(place)))
      .child(div().flex_none().text_color(t.dim).child("esc"))
      .child(horizon(t));

    const s = this.s;

    if (!it || !s) {
      return frame.child(head).child(v_flex().flex_1().items_center().justify_center().gap(8)
        .child(div().text_color(t.muted).child("These questions are gone: answered or withdrawn.")));
    }

    const qs = this.qs();
    const body = isReview(qs, s) ? this.review(t, qs, s) : this.question(t, qs, s);

    return frame.child(head).child(this.cells(t, qs, s)).child(body).child(this.footer(t, qs, s));
  }

  cells(t: Theme, qs: readonly Question[], s: AskState): Element {
    const cell = (i: number) => {
      const on = s.q === i;
      const done = i < qs.length ? answered(qs, s, i) : false;
      const review = i === qs.length;
      const color = on ? t.accent : done ? t.done : t.ansi0;

      return div().id(`cell-${i}`).relative().w(review ? 22 : 34).h(8).flex_none().border(1).border_color(color).cursor_pointer()
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => {
          this.s = { ...s, q: i, editing: false };
          this.handle?.focus();
          cx.notify();
        })
        .when(done || on, (el) => el.child(div().absolute().top(1).left(1).right(1).bottom(1).opacity(on ? 0.6 : 1).child(dither(on ? t.accent : t.done, on ? 2 : 1))));
    };

    const where = isReview(qs, s) ? "review" : `${s.q + 1} of ${qs.length}`;

    return h_flex().px(18).pt(14).gap(4).items_center().flex_none()
      .children(qs.length > 1 ? [...qs.map((_, i) => cell(i)), cell(qs.length)] : [cell(0)])
      .child(div().ml(8).text_color(t.dim).child(qs.length > 1 ? where : ""));
  }

  question(t: Theme, qs: readonly Question[], s: AskState): Element {
    const i = s.q;
    const q = qs[i];

    if (!q) return v_flex();

    const cur = s.cursor[i] ?? 0;

    const box = (on: boolean) => q.multiSelect
      ? div().relative().size(9).flex_none().border(1).border_color(on ? t.accent : t.dim)
        .when(on, (el) => el.child(div().absolute().top(1).left(1).right(1).bottom(1).bg(t.accent)))
      : div().relative().size(9).flex_none().flex().items_center().justify_center().child(on ? pip(t.accent, 6) : div());

    const row = (r: number, label: string | null, desc: string | null, on: boolean, content?: Element) => h_flex().id(`q${i}-row-${r}`).relative().px(18).py(6).gap(10).items_start().flex_none().cursor_pointer()
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => this.pick(qs, { ...s, cursor: s.cursor.map((c, j) => (j === i ? r : c)) }, cx))
      .when(r === cur, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
      .child(div().relative().pt(3).w(14).flex_none().flex().justify_center().child(box(on)))
      .child(content ?? v_flex().relative().flex_1().min_w(0).gap(2)
        .child(div().text_color(on || r === cur ? t.foreground : t.muted).child(label ?? ""))
        .when(Boolean(desc), (el) => el.child(div().text_color(t.dim).child(desc ?? ""))));

    const picked = s.picked[i] ?? [];
    const o = otherRow(qs, i);
    const typed = s.other[i] ?? "";
    const otherOn = Boolean(s.otherOn[i]) && Boolean(typed);
    const input = this.input;

    const otherContent = s.editing && input
      ? h_flex().relative().flex_1().min_w(0).h(20).border_b_1().border_color(t.accent)
        .on_mouse_down("left", stop)
        .child(Input.new(input).flex_1().h_full().text_size(11).text_color(t.foreground))
      : div().relative().flex_1().min_w(0).text_color(typed ? (otherOn ? t.foreground : t.muted) : t.dim).child(typed || "other: type an answer");

    const note = this.note;

    return v_flex().flex_1().min_h(0).id("ask-body").overflow_y_scrollbar()
      .child(div().px(18).pt(12).text_color(t.dim).child(`${q.header ? `${q.header} · ` : ""}${q.multiSelect ? "pick any" : "pick one"}`))
      .child(div().px(18).pt(6).pb(12).text_size(13).text_color(t.foreground).child(q.question))
      .children(q.options.map((x, r) => row(r, x.label, x.description, picked.includes(r) && !(!q.multiSelect && otherOn))))
      .child(row(o, null, null, otherOn, otherContent))
      .when(note !== null, (el) => el.child(div().px(18).pt(10).text_color(note?.bad ? t.blocked : t.done).child(note?.text ?? "")));
  }

  review(t: Theme, qs: readonly Question[], s: AskState): Element {
    const rowEl = (k: (typeof REVIEW)[number], i: number) => {
      const on = s.reviewCursor === i;
      const label = k === "submit" ? (this.busy ? `sending… ${this.busy === "sending" ? "" : this.busy}` : "submit answers") : "back to the first question";

      return h_flex().id(`rv-${k}`).relative().h(28).px(18).gap(10).items_center().flex_none().cursor_pointer()
        .text_color(on ? t.foreground : t.muted)
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => this.pick(qs, { ...s, reviewCursor: i }, cx))
        .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(k === "submit" ? t.done : t.accent)))
        .child(div().relative().w(14).flex_none().text_color(on ? t.accent : t.dim).child(String(i + 1)))
        .child(div().relative().child(label));
    };

    const a = answers(qs, s);
    const note = this.note;

    return v_flex().flex_1().min_h(0).id("ask-review").overflow_y_scrollbar()
      .child(div().px(18).pt(12).text_color(t.dim).child("review · nothing is sent until you submit"))
      .child(v_flex().px(18).pt(10).pb(12).gap(8)
        .children(qs.map((q, i) => h_flex().gap(10).items_start()
          .child(div().pt(4).child(pip(answered(qs, s, i) ? t.done : t.ansi0, 6)))
          .child(v_flex().flex_1().min_w(0).gap(2)
            .child(div().text_color(t.muted).child(q.question))
            .child(div().text_color(answered(qs, s, i) ? t.foreground : t.dim).child(answered(qs, s, i) ? reviewText(q, a[i] ?? { picked: [], other: null }) : "not answered yet"))))))
      .children(REVIEW.map(rowEl))
      .when(this.changed, (el) => el.child(div().px(18).pt(10).text_color(t.blocked).child("The questions changed or went away in the terminal: nothing was sent. Close and look again.")))
      .when(note !== null, (el) => el.child(div().px(18).pt(10).text_color(note?.bad ? t.blocked : t.done).child(note?.text ?? "")));
  }

  footer(t: Theme, qs: readonly Question[], s: AskState): Element {
    const hint = (k: string, w: string) => h_flex().gap(5).items_center().flex_none().child(kbd(t, k)).child(div().text_color(t.dim).child(w));
    const q = qs[s.q];

    return h_flex().relative().h(30).flex_none().px(18).gap(12).items_center()
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
      .when(s.editing, (el) => el.child(hint("↵", "keep")).child(hint("⇥ ⇧⇥", "keep, move")).child(hint("esc", "drop")))
      .when(!s.editing, (el) => el
        .child(hint("⇥ ⇧⇥", "move"))
        .child(hint("j k", isReview(qs, s) ? "row" : "answer"))
        .child(hint(q?.multiSelect ? "space" : "↵", q?.multiSelect ? "toggle" : isReview(qs, s) ? "choose" : "pick")))
      .when(!isReview(qs, s), (el) => el.child(hint(appWindow().platform === "macos" ? "⌘↵" : "ctrl-↵", "submit")))
      .child(hint("esc", "close"))
      .child(div().flex_1())
      .when(this.changed && !isReview(qs, s), (el) => el.child(div().text_color(t.blocked).child("changed in the terminal")));
  }
}
