// The question dialog: a block of questions answered like Claude Code's
// AskUserQuestion (keys in ask.ts), then a review that sends them together.
// Progress is a row of dithered cells, one per question and one for the
// review; nothing reaches the agent before "submit".

import { div } from "gpui-kit";
import type { AsyncContext, Element, FocusHandle } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, props, closeOverlay, run, window as appWindow } from "herdr";
import type { Theme } from "herdr";
import { Array as Arr, Effect, Option, Schema, String as Str } from "effect";
import { boxed, edge, frameBox, lit, rule } from "@fireflies/look";
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
import { fill, pip, logo, horizon, kbd, stop } from "./kit.ts";
import { attach } from "./fx.ts";
import type { NotifyFx } from "./fx.ts";
import { bindTab, tabActions } from "@fireflies/form-keys";
import { QuestionSchema } from "./request.ts";
import type { Question, QuestionRequest } from "./request.ts";

/** The dialog's props: the terminal whose questions it answers, its overlay. */
const AskPropsSchema = Schema.Struct({ terminal: Schema.optionalKey(Schema.String), overlay: Schema.optionalKey(Schema.String) });

const readAskProps = Schema.decodeUnknownOption(AskPropsSchema);

const askProps = (given?: Props): typeof AskPropsSchema.Type => Option.getOrElse(readAskProps(props() ?? given), () => ({}));

/** Two blocks of questions are the same, field by field. */
const sameQuestions = Schema.toEquivalence(Schema.Array(QuestionSchema));

/** An item asking a block of questions this mod can answer, and the block. */
type Asking = Item & { readonly request: QuestionRequest };

const askingOf = (it: Item | undefined): Asking | null => (it?.type === "question" && it.answerable && it.request?.type === "question" ? { ...it, request: it.request } : null);

/** How long after opening the dialog takes the keyboard (its window is up by then). */
const FOCUS_LATER = "400 millis";

export default class AskDialog {
  terminal: string | null = null;
  item: Asking | null = null;
  s: AskState | null = null;
  busy: string | null = null;
  note: { readonly text: string; readonly bad: boolean } | null = null;
  changed = false;
  input: InputState | null = null;
  handle: FocusHandle | null = null;
  fx: NotifyFx | null = null;

  init(p: Props | undefined, cx: AsyncContext) {
    const fx = attach(cx);

    this.fx = fx;
    this.terminal = askProps(p).terminal ?? null;
    this.item = this.find();
    this.s = this.item === null ? null : start(this.item.request.questions);

    const input = InputState.new({ placeholder: "type your answer" });

    this.input = input;
    this.handle = cx.focus_handle();
    bindTab(cx); // tab / shift-tab reach the key handler (form-keys.ts)

    const handle = this.handle;

    input.on("submit", (_e, cx) => {
      if (this.s !== null) this.s = setOther(this.qs(), this.s, input.value());

      handle.focus();
      cx.notify();
    });
    handle.focus();

    const focus = () => (this.s?.editing === true ? input.focus() : handle.focus());

    fx.run(followCommands((e, cx) => this.key(e, cx), focus, () => cx.notify()));
    fx.run(Effect.andThen(Effect.sleep(FOCUS_LATER), Effect.sync(focus)), { redraw: false });
  }

  find(): Asking | null {
    return askingOf(Option.getOrUndefined(Arr.findFirst(items(), (x) => x.address === this.terminal && x.type === "question" && x.answerable)));
  }

  qs(): readonly Question[] {
    return this.item?.request.questions ?? [];
  }

  /** The overlay closed (main.ts close()): no longer ours to close, its effects end. */
  closing(): Promise<void> | undefined {
    forget("ask", askProps().overlay);

    return this.fx?.close();
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

    if (action === "edit" && this.s !== null) {
      this.input?.set_value(this.s.other[this.s.q] ?? "");
      this.input?.focus();
    }

    if (action === "submit") this.submit(cx);
  }

  submit(cx: KeyContext) {
    const item = this.item, s = this.s;

    if (this.busy !== null || this.changed || item === null || s === null) return;

    const goal: QuestionGoal = { type: "question", request: item.request, answers: answers(this.qs(), s) };

    this.busy = "sending";
    this.note = null;
    cx.notify();
    this.fx?.run(answer(item, goal, (text) => {
      this.busy = text;
      cx.notify();
    }).pipe(
      Effect.tap((r) => Effect.sync(() => {
        run("notifications.refresh");

        if (r.ok) this.close();
        else this.note = { text: r.reason, bad: true };
      })),
      // Whatever ends it (an answer, a failure, the dialog closing), it isn't sending any more.
      Effect.ensuring(Effect.sync(() => {
        this.busy = null;
      })),
    ), { key: "answer" });
  }

  key(e: KeyInput, cx: KeyContext) {
    const s = this.s;

    if (s === null) {
      if (e.key === "escape" || e.key === "q") this.close();

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
    const it = this.item;

    if (it !== null && (now === null || !sameQuestions(now.request.questions, it.request.questions)) && this.busy === null) this.changed = true;

    const root = frameBox(t, v_flex().id("notify-ask").relative().size_full().bg(t.background).text_color(t.foreground).text_size(11));

    const frame = (this.handle === null ? root : root.track_focus(this.handle))
      .on_key_down((e, cx) => this.key(e, cx))
      .map((el) => tabActions(el, (e, cx) => this.key(e, cx)));

    const place = it === null ? "" : where(it);

    const head = h_flex().relative().h(34).flex_none().px(14).gap(10).items_center()
      .child(logo(it?.logo ?? "claude", t.foreground, 12))
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(it === null ? "Questions" : `${it.name} asks`))
      .when(Str.isNonEmpty(place), (el) => el.child(div().flex_none().text_color(t.dim).child(place)))
      .child(div().flex_none().text_color(t.dim).child("esc"))
      .child(horizon(t));

    const s = this.s;

    if (it === null || s === null) {
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
      const color = on ? t.accent : done ? t.done : edge(t);

      return boxed(t, div().id(`cell-${i}`).relative().w(review ? 22 : 34).h(8).flex_none(), color).cursor_pointer()
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => {
          this.s = { ...s, q: i, editing: false };
          this.handle?.focus();
          cx.notify();
        })
        .when(done || on, (el) => el.child(div().absolute().top(1).left(1).right(1).bottom(1).opacity(on ? 0.6 : 1).child(fill(on ? t.accent : t.done, on ? 2 : 1))));
    };

    const at = isReview(qs, s) ? "review" : `${s.q + 1} of ${qs.length}`;

    return h_flex().px(18).pt(14).gap(4).items_center().flex_none()
      .children(qs.length > 1 ? [...Arr.map(qs, (_, i) => cell(i)), cell(qs.length)] : [cell(0)])
      .child(div().ml(8).text_color(t.dim).child(qs.length > 1 ? at : ""));
  }

  question(t: Theme, qs: readonly Question[], s: AskState): Element {
    const i = s.q;
    const q = qs[i];

    if (q === undefined) return v_flex();

    const cur = s.cursor[i] ?? 0;

    const box = (on: boolean) => q.multiSelect
      ? boxed(t, div().relative().size(9).flex_none(), on ? t.accent : t.dim)
        .when(on, (el) => el.child(div().absolute().top(1).left(1).right(1).bottom(1).bg(t.accent)))
      : div().relative().size(9).flex_none().flex().items_center().justify_center().child(on ? pip(t.accent, 6) : div());

    const row = (r: number, label: string | null, desc: string | null, on: boolean, content?: Element) => {
      const el = h_flex().id(`q${i}-row-${r}`).relative().px(18).py(6).gap(10).items_start().flex_none().cursor_pointer()
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => this.pick(qs, { ...s, cursor: Arr.map(s.cursor, (c, j) => (j === i ? r : c)) }, cx));

      return (r === cur ? lit(t, el, true) : el)
        .child(div().relative().pt(3).w(14).flex_none().flex().justify_center().child(box(on)))
        .child(content ?? v_flex().relative().flex_1().min_w(0).gap(2)
          .child(div().text_color(on || r === cur ? t.foreground : t.muted).child(label ?? ""))
          .when(desc !== null && Str.isNonEmpty(desc), (d) => d.child(div().text_color(t.dim).child(desc ?? ""))));
    };

    const picked = s.picked[i] ?? [];
    const o = otherRow(qs, i);
    const typed = s.other[i] ?? "";
    const otherOn = s.otherOn[i] === true && Str.isNonEmpty(typed);
    const input = this.input;

    const otherContent = s.editing && input !== null
      ? h_flex().relative().flex_1().min_w(0).h(20).border_b_1().border_color(t.accent)
        .on_mouse_down("left", stop)
        .child(Input.new(input).flex_1().h_full().text_size(11).text_color(t.foreground))
      : div().relative().flex_1().min_w(0).text_color(Str.isEmpty(typed) ? t.dim : otherOn ? t.foreground : t.muted).child(Str.isEmpty(typed) ? "other: type an answer" : typed);

    const note = this.note;

    return v_flex().flex_1().min_h(0).id("ask-body").overflow_y_scrollbar()
      .child(div().px(18).pt(12).text_color(t.dim).child(`${Str.isEmpty(q.header) ? "" : `${q.header} · `}${q.multiSelect ? "pick any" : "pick one"}`))
      .child(div().px(18).pt(6).pb(12).text_size(13).text_color(t.foreground).child(q.question))
      .children(Arr.map(q.options, (x, r) => row(r, x.label, x.description, Arr.contains(picked, r) && (q.multiSelect || !otherOn))))
      .child(row(o, null, null, otherOn, otherContent))
      .when(note !== null, (el) => el.child(div().px(18).pt(10).text_color(note?.bad === true ? t.blocked : t.done).child(note?.text ?? "")));
  }

  review(t: Theme, qs: readonly Question[], s: AskState): Element {
    const busy = this.busy;

    const rowEl = (k: (typeof REVIEW)[number], i: number) => {
      const on = s.reviewCursor === i;
      const label = k === "submit" ? (busy === null ? "submit answers" : `sending… ${busy === "sending" ? "" : busy}`) : "back to the first question";

      const el = h_flex().id(`rv-${k}`).relative().h(28).px(18).gap(10).items_center().flex_none().cursor_pointer()
        .text_color(on ? t.foreground : t.muted)
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => this.pick(qs, { ...s, reviewCursor: i }, cx));

      return (on ? lit(t, el, true, { mark: k === "submit" ? t.done : t.accent }) : el)
        .child(div().relative().w(14).flex_none().text_color(on ? t.accent : t.dim).child(String(i + 1)))
        .child(div().relative().child(label));
    };

    const a = answers(qs, s);
    const note = this.note;

    return v_flex().flex_1().min_h(0).id("ask-review").overflow_y_scrollbar()
      .child(div().px(18).pt(12).text_color(t.dim).child("review · nothing is sent until you submit"))
      .child(v_flex().px(18).pt(10).pb(12).gap(8)
        .children(Arr.map(qs, (q, i) => h_flex().gap(10).items_start()
          .child(div().pt(4).child(pip(answered(qs, s, i) ? t.done : edge(t), 6)))
          .child(v_flex().flex_1().min_w(0).gap(2)
            .child(div().text_color(t.muted).child(q.question))
            .child(div().text_color(answered(qs, s, i) ? t.foreground : t.dim).child(answered(qs, s, i) ? reviewText(q, a[i] ?? { picked: [], other: null }) : "not answered yet"))))))
      .children(Arr.map(REVIEW, rowEl))
      .when(this.changed, (el) => el.child(div().px(18).pt(10).text_color(t.blocked).child("The questions changed or went away in the terminal: nothing was sent. Close and look again.")))
      .when(note !== null, (el) => el.child(div().px(18).pt(10).text_color(note?.bad === true ? t.blocked : t.done).child(note?.text ?? "")));
  }

  footer(t: Theme, qs: readonly Question[], s: AskState): Element {
    const hint = (k: string, w: string) => h_flex().gap(5).items_center().flex_none().child(kbd(t, k)).child(div().text_color(t.dim).child(w));
    const multi = qs[s.q]?.multiSelect === true;

    return h_flex().relative().h(30).flex_none().px(18).gap(12).items_center()
      .child(rule(t, "top"))
      .when(s.editing, (el) => el.child(hint("↵", "keep")).child(hint("⇥ ⇧⇥", "keep, move")).child(hint("esc", "drop")))
      .when(!s.editing, (el) => el
        .child(hint("⇥ ⇧⇥", "move"))
        .child(hint("j k", isReview(qs, s) ? "row" : "answer"))
        .child(hint(multi ? "space" : "↵", multi ? "toggle" : isReview(qs, s) ? "choose" : "pick")))
      .when(!isReview(qs, s), (el) => el.child(hint(appWindow().platform === "macos" ? "⌘↵" : "ctrl-↵", "submit")))
      .child(hint(s.editing ? "esc" : "esc q", "close"))
      .child(div().flex_1())
      .when(this.changed && !isReview(qs, s), (el) => el.child(div().text_color(t.blocked).child("changed in the terminal")));
  }
}
