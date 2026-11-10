// The overview: every request, grouped down the left (permissions,
// questions, other), the selected one in full on the right.
//
//   j / k, [ / ]      the next / previous request
//   up / down         the permission's options (as its terminal lists them)
//   enter, 1-9        answer with that option; a question block: answer it
//                     (the question dialog); other: go to the agent
//   tab / shift-tab   "yes, but…" / "no, but…": a line that goes with the
//                     answer, as the agent's next instruction (enter sends)
//   p / g             peek at its terminal / go to it
//   x                 put a finished or failed one away
//   esc               close (from the note's line: back to the options)

import { div, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, props, closeOverlay, run, nextCommand } from "herdr";
import { items, dismiss } from "./engine.js";
import { group, age, headline, summary, where, TYPES } from "./model.js";
import { answer } from "./drive.js";
import { openAsk, forget, followCommands } from "./open.js";
import { dither, pip, logo, horizon, button, kbd, stop, TYPE_COLOR } from "./kit.js";

const TITLE = { permission: "Permissions", question: "Questions", other: "Other" };
const KIND_COLOR = { yes: "done", always: "accent", auto: "working", no: "blocked" };
const HOOK_DOC = "Claude Code's hook: see ~/.config/herdr-app/AGENTS.md, Notifications";

export default class Overview {
  init(p, cx) {
    this.want = p?.terminal ?? props()?.terminal ?? null; // open on this terminal's request
    this.sel = null; // the selected item's id
    this.cursor = 0;
    this.but = null; // "yes" | "no": the note's line is open
    this.busy = null; // { id, text }
    this.note = null; // { id, text, bad }
    this.input = InputState.new({ placeholder: "what it should do instead / next" });
    this.input.on("submit", (_e, cx) => this.answerWith(cx, { amend: this.input.value() }));
    this.handle = cx.focus_handle();
    this.handle.focus();
    followCommands(cx, nextCommand, (e, cx) => this.key(e, cx));
    cx.timer.after(400, () => (this.but ? this.input.focus() : this.handle.focus()));
  }

  closing() { forget("overview", props()?.overlay); }
  close() { closeOverlay(props()?.overlay); }

  list() {
    const g = group(items());
    return TYPES.flatMap((k) => g[k]);
  }

  current(list) {
    if (this.want) {
      const it = list.find((x) => x.address === this.want);
      if (it) { this.sel = it.id; this.want = null; }
    }
    let it = list.find((x) => x.id === this.sel);
    if (!it && list.length) {
      // Gone (answered): the next one in its place.
      it = list[0];
      this.sel = it.id;
      this.cursor = 0;
      this.but = null;
    }
    return it ?? null;
  }

  select(list, dir) {
    if (!list.length) return;
    const i = list.findIndex((x) => x.id === this.sel);
    const it = list[(i + dir + list.length) % list.length];
    this.sel = it.id;
    this.cursor = 0;
    this.closeBut();
  }

  openBut(kind, it) {
    if (!it?.answerable || it.type !== "permission" || !it.request.canAmend) return;
    const opts = it.request.options;
    const t = kind === "yes" ? 0 : opts.findIndex((o) => o.kind === "no");
    if (t < 0) return;
    this.cursor = t;
    this.but = kind;
    this.input.focus();
  }

  closeBut() {
    this.but = null;
    this.input.set_value("");
    this.handle.focus();
  }

  peek(it) { this.close(); run("terminal.peek", { terminal: it.address }); }
  goTo(it) { this.close(); run("agent.focus", { terminal: it.address }); }

  /** Answers the selected permission: the option under the cursor, with the note when the line is open. */
  answerWith(cx, { option, amend } = {}) {
    const it = this.current(this.list());
    if (!it || it.type !== "permission" || !it.answerable || this.busy) return;
    const o = option ?? it.request.options[this.cursor]?.n;
    if (o == null) return;
    const goal = { type: "permission", request: it.request, option: o };
    if (this.but && amend != null) {
      if (!amend.trim()) return;
      goal.amend = amend.trim();
    }
    this.busy = { id: it.id, text: "answering" };
    this.note = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await answer(cx, it, goal, (text) => { this.busy = { id: it.id, text }; cx.notify(); }).catch((e) => ({ ok: false, reason: String(e) }));
      this.busy = null;
      if (r.ok) { this.closeBut(); this.note = { id: it.id, text: "answered" }; }
      else this.note = { id: it.id, text: r.reason, bad: true };
      run("nocturne-notifications.refresh");
      cx.notify();
    });
  }

  key(e, cx) {
    const list = this.list();
    const it = this.current(list);
    const k = e.key;
    const m = e.modifiers;
    if (this.but) {
      if (k === "escape") { this.closeBut(); cx.stop_propagation(); cx.notify(); }
      return; // the input has the rest
    }
    if (m.control || m.platform || m.alt) return;
    let handled = true;
    if (k === "escape") this.close();
    else if (k === "j" || k === "]") this.select(list, 1);
    else if (k === "k" || k === "[") this.select(list, -1);
    else if ((k === "down" || k === "up") && it?.type === "permission" && it.answerable) {
      const n = it.request.options.length;
      this.cursor = (this.cursor + (k === "down" ? 1 : -1) + n) % n;
    } else if (k === "tab" && it) this.openBut(m.shift ? "no" : "yes", it);
    else if (k === "enter" && it) {
      if (it.type === "permission" && it.answerable) this.answerWith(cx);
      else if (it.type === "question" && it.answerable) openAsk(it);
      else this.goTo(it);
    } else if (/^[1-9]$/.test(k) && it?.type === "permission" && it.answerable) {
      const i = it.request.options.findIndex((o) => o.n === Number(k));
      if (i >= 0) { this.cursor = i; this.answerWith(cx, { option: Number(k) }); }
    } else if (k === "p" && it) this.peek(it);
    else if (k === "g" && it) this.goTo(it);
    else if (k === "x" && it?.type === "other" && it.status !== "blocked") dismiss(it.id);
    else handled = false;
    if (handled) { cx.stop_propagation(); cx.notify(); }
  }

  render() {
    const t = theme();
    const list = this.list();
    const it = this.current(list);
    return h_flex().id("notify-overview").size_full().bg(t.background).border(1).border_color(t.ansi0).text_color(t.foreground).text_size(11)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(this.side(t, list, it))
      .child(this.main(t, it));
  }

  // ---- the list

  side(t, list, it) {
    const g = group(list);
    const head = h_flex().relative().h(34).flex_none().px(12).items_center()
      .child(div().flex_1().text_size(12).child("Waiting on you"))
      .child(div().text_color(t.dim).child("esc"))
      .child(horizon(t));
    const groups = TYPES.map((k) => {
      const color = t[TYPE_COLOR[k]];
      const n = g[k].length;
      const urgent = k !== "other";
      return v_flex().flex_none()
        .child(h_flex().h(30).mt(4).px(12).gap(8).items_center().flex_none()
          .child(pip(n ? color : t.ansi0, 6))
          .child(div().flex_1().text_color(n ? t.foreground : t.dim).child(TITLE[k]))
          .child(n && urgent
            ? div().h(15).px(5).flex().items_center().bg(color).text_color(t.background).child(String(n))
            : div().text_color(t.dim).child(String(n))))
        .children(g[k].map((x) => this.entry(t, x, x.id === it?.id)));
    });
    return v_flex().w(280).h_full().flex_none().border_r_1().border_color(t.ansi0)
      .child(head)
      .child(v_flex().id("notify-list").flex_1().min_h(0).pb(8).overflow_y_scrollbar().children(groups));
  }

  entry(t, x, on) {
    const second = x.type === "other"
      ? div().truncate().text_color(x.status === "error" ? t.ansi1 : x.status === "done" ? t.done : t.muted).child(summary(x))
      : div().truncate().text_color(t.dim).child(summary(x));
    return v_flex().id(`entry-${x.id}`).relative().h(42).px(12).pl(14).justify_center().gap(3).flex_none().cursor_pointer()
      .hover((s) => s.bg(t.hover ?? t.ansi0))
      .on_click((_e, cx) => { this.sel = x.id; this.cursor = 0; this.closeBut(); cx.notify(); })
      .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
      .child(h_flex().relative().gap(7).items_center().text_color(on ? t.foreground : t.muted)
        .child(logo(x.logo, on ? t.foreground : t.muted, 12))
        .child(div().flex_1().min_w(0).truncate().child(x.name))
        .child(div().flex_none().text_color(t.dim).child(age(x.since))))
      .child(h_flex().relative().pl(19).child(second));
  }

  // ---- the request in full

  main(t, it) {
    if (!it) return this.empty(t);
    const color = t[it.type === "other" ? (it.status === "error" ? "ansi1" : it.status === "done" ? "done" : "working") : TYPE_COLOR[it.type]];
    const place = where(it);
    const sub = [it.program, place, it.since && `${it.type === "other" && it.status !== "blocked" ? "" : "waiting "}${age(it.since)}`].filter(Boolean).join(" · ");
    const hero = h_flex().relative().px(20).pt(18).pb(14).gap(14).items_start().flex_none()
      .child(div().relative().size(44).flex_none().flex().items_center().justify_center()
        .child(div().absolute().top(0).left(0).size_full().opacity(0.55).child(dither(color, 2)))
        .child(logo(it.logo, t.foreground, 20).relative()))
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(div().text_size(13).text_color(t.foreground).child(`${it.name} ${headline(it)}`))
        .child(div().text_color(t.dim).truncate().child(sub)))
      .child(h_flex().gap(6).flex_none()
        .child(button(t, "ov-peek", "p peek", t.muted, false, () => this.peek(it)))
        .child(button(t, "ov-go", "g go to", t.muted, false, () => this.goTo(it))));
    const body = it.type === "permission" ? this.permission(t, it) : it.type === "question" ? this.questions(t, it) : this.other(t, it);
    const note = this.note?.id === it.id && this.note.bad ? this.note.text : null;
    return v_flex().flex_1().min_w(0).h_full()
      .child(hero)
      .when(Boolean(note), (el) => el.child(h_flex().mx(20).mb(10).px(10).py(6).gap(8).items_start().border(1).border_color(t.blocked).flex_none()
        .child(div().pt(3).child(pip(t.blocked, 6)))
        .child(div().flex_1().min_w(0).text_color(t.blocked).child(`Not sent. ${note}`))))
      .child(v_flex().id("notify-detail").flex_1().min_h(0).overflow_y_scrollbar().pb(12).child(body))
      .child(this.footer(t, it));
  }

  plate(t, kids) {
    return v_flex().relative().mx(20).px(12).py(10).gap(4).flex_none()
      .child(div().absolute().top(0).left(0).size_full().opacity(0.9).child(dither(t.ansi0, 1)))
      .children(kids.map((k) => k.relative()));
  }

  /** The end of the agent's screen, for anything without a structured request. */
  screenTail(t, it) {
    if (!it.tail) return div();
    const ls = it.tail.split("\n").slice(-12);
    return v_flex().mx(20).mt(10).px(10).py(8).gap(1).border(1).border_color(t.ansi0).flex_none()
      .children(ls.map((l) => div().truncate().text_color(t.muted).child(l || " ")));
  }

  permission(t, it) {
    const r = it.request;
    if (!it.answerable || !r) {
      return v_flex().gap(0)
        .child(this.plate(t, [div().text_color(t.foreground).child(it.msg || "It waits for a permission.")]))
        .child(this.screenTail(t, it))
        .child(div().mx(20).mt(10).text_color(t.dim).child("Answer it in its terminal: p peeks, g goes to it."));
    }
    const preview = [];
    const input = r.input ?? {};
    if (typeof input.content === "string") preview.push(...input.content.split("\n").slice(0, 6));
    if (typeof input.old_string === "string") preview.push(...input.old_string.split("\n").slice(0, 3).map((l) => `- ${l}`), ...String(input.new_string ?? "").split("\n").slice(0, 3).map((l) => `+ ${l}`));
    const plate = this.plate(t, [
      div().text_color(t.muted).child(r.tool),
      ...String(r.line || r.title).split("\n").slice(0, 4).map((l) => div().text_color(t.foreground).child(l)),
      ...preview.map((l) => div().truncate().text_color(l.startsWith("+ ") ? t.done : l.startsWith("- ") ? t.ansi1 : t.dim).child(l || " ")),
    ]);
    const busy = this.busy?.id === it.id;
    const opts = v_flex().mt(14).flex_none().children(r.options.map((o, i) => {
      const on = i === this.cursor;
      const c = t[KIND_COLOR[o.kind] ?? "accent"];
      return h_flex().id(`opt-${o.n}`).relative().min_h(28).py(5).px(20).gap(12).items_center().cursor_pointer()
        .text_color(on ? t.foreground : t.muted)
        .hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { this.cursor = i; if (!this.but) this.answerWith(cx, { option: o.n }); cx.notify(); })
        .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(c)))
        .child(div().relative().w(14).flex_none().text_color(on ? c : t.dim).child(String(o.n)))
        .child(div().relative().flex_1().min_w(0).child(o.label))
        .child(div().relative().flex_none().text_color(t.dim).child(on ? (busy ? this.busy.text : this.but ? "" : "enter") : ""));
    }));
    return v_flex()
      .child(plate)
      .when(Boolean(r.description), (el) => el.child(div().mx(20).mt(10).text_color(t.muted).child(`“${r.description}”`)))
      .child(opts)
      .when(r.canAmend, (el) => el.child(this.butBox(t, it)));
  }

  butBox(t, it) {
    const tab = (kind, label, color) => {
      const on = this.but === kind;
      return h_flex().id(`but-${kind}`).relative().h(26).px(10).items_center().cursor_pointer()
        .text_color(on ? t.foreground : t.muted)
        .hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { on ? this.closeBut() : this.openBut(kind, it); cx.notify(); })
        .child(div().relative().child(label))
        .when(on, (el) => el.child(div().absolute().left(6).right(6).bottom(0).h(4).child(dither(color, 2))));
    };
    return v_flex().mx(20).mt(12).border(1).border_color(this.but ? t.ansi0 : t.ansi0).flex_none()
      .child(h_flex().relative().h(26).items_center()
        .child(tab("yes", "yes, but…", t.done))
        .child(tab("no", "no, but…", t.blocked))
        .child(div().flex_1())
        .child(div().px(10).text_color(t.dim).child(this.but ? "enter sends · esc" : "tab · shift-tab"))
        .child(horizon(t)))
      .child(h_flex().h(30).px(10).items_center()
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); if (!this.but) this.openBut("yes", it); cx.notify(); })
        .when(Boolean(this.but), (el) => el.child(Input.new(this.input).flex_1().h_full().text_size(11).text_color(t.foreground)))
        .when(!this.but, (el) => el.child(div().text_color(t.dim).child("a line for the agent with your answer"))));
  }

  questions(t, it) {
    const r = it.request;
    if (!it.answerable || !r) {
      return v_flex()
        .child(this.plate(t, [div().text_color(t.foreground).child(it.msg || "It asks a question.")]))
        .child(this.screenTail(t, it))
        .child(div().mx(20).mt(10).text_color(t.dim).child(it.adapter === "claude" ? `Answer it in its terminal (p, g), or turn on ${HOOK_DOC} to answer here.` : "Answer it in its terminal: p peeks, g goes to it."));
    }
    const q = (x, i) => v_flex().mx(20).mt(i ? 12 : 0).gap(4).flex_none()
      .child(h_flex().gap(8).items_center()
        .child(div().h(15).px(4).flex().items_center().border(1).border_color(t.ansi0).text_color(t.muted).child(x.header || String(i + 1)))
        .child(div().text_color(t.dim).child(x.multiSelect ? "pick any" : "pick one")))
      .child(div().text_size(12).text_color(t.foreground).child(x.question))
      .child(div().text_color(t.dim).child([...x.options.map((o) => o.label), "other"].join(" · ")));
    return v_flex()
      .children(r.questions.map(q))
      .child(h_flex().mx(20).mt(16).gap(8).items_center()
        .child(button(t, "ov-answer", "answer ↵", t.accent, true, () => openAsk(it)))
        .child(div().text_color(t.dim).child(r.questions.length > 1 ? "one at a time, then a review sends them together" : "")));
  }

  other(t, it) {
    const words = it.status === "done" ? "It finished while you were elsewhere." : it.status === "error" ? (it.msg || "It stopped with an error.") : (it.msg || "It waits for your input.");
    return v_flex()
      .child(div().mx(20).text_color(it.status === "error" ? t.ansi1 : t.muted).child(words))
      .child(this.screenTail(t, it))
      .child(h_flex().mx(20).mt(14).gap(6)
        .child(button(t, "ov-goto", "go to ↵", t.accent, true, () => this.goTo(it)))
        .when(it.status !== "blocked", (el) => el.child(button(t, "ov-dismiss", "x put away", t.muted, false, () => dismiss(it.id)))));
  }

  empty(t) {
    return v_flex().flex_1().h_full().items_center().justify_center().gap(10).px(40)
      .child(image("mods/nocturne/art/fireflies.svg").size(48))
      .child(div().text_size(12).text_color(t.foreground).child("Nothing waits on you"))
      .child(div().text_color(t.dim).max_w(380).child("Permissions, questions and finished work from every agent, in every space and machine, gather here."))
      .child(div().text_color(t.dim).max_w(380).child(`For Claude Code's exact requests and its questions: ${HOOK_DOC}.`));
  }

  footer(t, it) {
    const note = this.note?.id === it?.id ? this.note : null;
    const hint = (k, w) => h_flex().gap(5).items_center().flex_none().child(kbd(t, k)).child(div().text_color(t.dim).child(w));
    return h_flex().relative().h(30).flex_none().px(20).gap(14).items_center()
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
      .child(hint("j k", "requests"))
      .when(it?.type === "permission" && it.answerable, (el) => el.child(hint("↑↓", "choose")).child(hint("1-9", "answer")).child(hint("⇥", "but…")))
      .when(it?.type === "question" && it.answerable, (el) => el.child(hint("↵", "answer")))
      .child(div().flex_1())
      .when(Boolean(note), (el) => el.child(div().max_w(320).truncate().text_color(note.bad ? t.blocked : t.done).child(note.bad ? "not sent" : note.text)))
      .when(!note && this.busy?.id === it?.id, (el) => el.child(div().text_color(t.working).child(`${this.busy.text}…`)));
  }
}
