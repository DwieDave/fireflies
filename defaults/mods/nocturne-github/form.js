// A form in the GitHub window, for what writes to GitHub (a new pull
// request: prForm.js; running a workflow: dispatchForm.js). It takes the
// tab's body: the fields in a panel on the left, what will be sent beside
// it (the flow's `side`), and a last step that shows the exact commands
// before anything runs.
//
// Keyboard first: tab / shift-tab (or ↓ ↑ outside text) walk the fields;
// typing goes into text; space flips a toggle and opens a list (typing on a
// list field opens it filtered); enter reviews the commands from anywhere
// (cmd/ctrl-enter from the body, where enter is a new line); in the review
// enter (or y) sends, esc goes back; esc in the form cancels it. The mouse
// does the same: click a field, a toggle, a list, the buttons.
//
// Field: { id, label, kind: "text" | "area" | "number" | "toggle" | "choice" | "multi",
//   value, required, hint, placeholder, note (beside a toggle), free (a list
//   field takes what's typed too), display(value) (a list value in words), options(): [{ value, label, sub, right }] | null (reading) }

import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { dither, panel, stop, band, sweep, empty, unzoom, popupScrim } from "./kit.js";

const ROW = 28, AREA = 150, NOTE = 16, GAP = 8, LABEL = 96, PICK_ROWS = 12;
const TEXT = new Set(["text", "area", "number"]);
const LIST = new Set(["choice", "multi"]);

export class Form {
  /** spec: { title, right, fields, side(t, size), commands() -> [{ cmd, args, label }], send(cx) -> Promise<{ ok, err }>, cancel(), sendWord } */
  constructor(app, spec) {
    this.app = app;
    this.spec = spec;
    this.fields = [];
    this.at = 0;
    this.stage = "edit"; // edit | confirm | sending
    this.errors = {}; // field id -> words
    this.sendError = "";
    this.picker = null; // { field, query: InputState, at }
    this.scrollY = 0; this.viewH = 400;
    this.setFields(spec.fields ?? []);
  }

  // ---- fields

  /** Replaces the fields, keeping what was typed in the ones that stay (by id). */
  setFields(list) {
    const was = new Map(this.fields.map((f) => [f.id, f]));
    const cur = this.fields[this.at]?.id;
    this.fields = list.map((f) => {
      const old = was.get(f.id);
      if (old && old.kind === f.kind && !f.reset) { f.value = old.value; f.input = old.input; f.touched = old.touched; }
      return f;
    });
    for (const [id, f] of was) if (!this.fields.some((x) => x.id === id && x.input === f.input)) f.input?.release?.();
    // Inputs are made here, never while drawing (the runtime refuses that).
    for (const f of this.fields) if (TEXT.has(f.kind)) this.inputOf(f);
    const i = this.fields.findIndex((f) => f.id === cur);
    this.at = Math.max(0, Math.min(this.fields.length - 1, i < 0 ? this.at : i));
  }

  field(id) { return this.fields.find((f) => f.id === id) ?? null; }
  value(id) { return this.field(id)?.value; }
  values() { return Object.fromEntries(this.fields.map((f) => [f.id, f.value])); }

  /** Sets a field's value from outside (a fill, a default): text inputs follow, unless the person typed there. */
  set(id, value, { force = false } = {}) {
    const f = this.field(id);
    if (!f || (f.touched && !force)) return;
    f.value = value;
    if (f.input) f.input.set_value(String(value ?? ""));
  }

  /** The text field's input (made when the field is set). */
  inputOf(f) {
    if (f.input) return f.input;
    const opts = { placeholder: f.placeholder ?? "", value: String(f.value ?? "") };
    f.input = f.kind === "area" ? TextareaState.new({ ...opts, rows: 8 }) : InputState.new(opts);
    f.input.on("change", (_e, cx) => {
      const v = f.input.value();
      if (v === f.value) return;
      f.value = v; f.touched = true;
      delete this.errors[f.id];
      f.onChange?.(v, cx);
      cx?.notify?.();
    });
    return f.input;
  }

  /** Moves to field i: a text field gets the keyboard, others leave it with the window. */
  go(i, cx) {
    if (!this.fields.length) return;
    this.at = (i + this.fields.length) % this.fields.length;
    this.focusField(cx);
    this.reveal();
  }

  /** The keyboard to the focused field's input (again a moment later: an input not drawn yet can't take it), or to the window. */
  focusField(cx) {
    const f = this.fields[this.at];
    if (f && TEXT.has(f.kind) && this.stage === "edit" && !this.picker) {
      const input = this.inputOf(f);
      input.focus();
      cx?.timer?.after?.(40, () => { if (this.fields[this.at] === f && this.stage === "edit" && !this.picker && !this.gone) input.focus(); });
    } else this.app.focusSelf();
  }

  /** The focused field's top and height in the scrolled form. */
  place(i) {
    let y = 0;
    for (let k = 0; k < this.fields.length; k++) {
      const h = this.heightOf(this.fields[k]);
      if (k === i) return { y, h };
      y += h + GAP;
    }
    return { y, h: 0 };
  }

  heightOf(f) {
    return (f.kind === "area" ? AREA : ROW) + (f.hint ? NOTE : 0) + (this.errors[f.id] ? NOTE : 0);
  }

  reveal() {
    const { y, h } = this.place(this.at);
    if (y < this.scrollY) this.scrollY = Math.max(0, y - 4);
    else if (y + h > this.scrollY + this.viewH - 8) this.scrollY = y + h - this.viewH + 12;
  }

  // ---- keys

  /** true: used (stop it); "typing": the focused input's; false: not the form's. */
  key(k, e, cx) {
    const m = e?.modifiers ?? {};
    // cmd / alt chords are the app's (and an input's copy / paste), except cmd-enter.
    if ((m.platform || m.alt) && k !== "enter") return false;
    if (this.picker) return this.pickerKey(k, e, cx);
    if (this.stage === "sending") return true;
    if (this.stage === "confirm") {
      if (k === "enter" || k === "y") this.send(cx);
      else if (k === "escape" || k === "n" || k === "q" || k === "backspace") { this.stage = "edit"; this.focusField(cx); }
      return true;
    }
    const f = this.fields[this.at];
    if (k === "escape") { this.cancel(); return true; }
    if (k === "tab") { this.go(this.at + (m.shift ? -1 : 1), cx); return true; }
    if (k === "enter" && (f?.kind !== "area" || m.platform || m.control)) { this.review(cx); return true; }
    if (!f) return true;
    if (TEXT.has(f.kind)) {
      // ↑ ↓ leave a one-line field (the body keeps them for its lines).
      if (f.kind !== "area" && (k === "down" || k === "up")) { this.go(this.at + (k === "down" ? 1 : -1), cx); return true; }
      return "typing";
    }
    if (k === "down" || k === "j") this.go(this.at + 1, cx);
    else if (k === "up" || k === "k") this.go(this.at - 1, cx);
    else if (f.kind === "toggle" && (k === "space" || k === "x")) this.flip(f, cx);
    else if (LIST.has(f.kind) && (k === "space" || k === "right" || k === "l")) this.openPicker(f, "", cx);
    else if (LIST.has(f.kind) && (k === "backspace" || k === "delete")) this.clear(f, cx);
    else if (LIST.has(f.kind) && k.length === 1 && !m.control) this.openPicker(f, k, cx);
    return true;
  }

  flip(f, cx) { f.value = !f.value; f.touched = true; f.onChange?.(f.value, cx); }

  clear(f, cx) {
    if (f.required) return;
    f.value = f.kind === "multi" ? [] : ""; f.touched = true;
    f.onChange?.(f.value, cx);
  }

  cancel() {
    this.release();
    this.spec.cancel?.();
  }

  release() {
    this.gone = true;
    for (const f of this.fields) f.input?.release?.();
    this.picker?.query.release?.();
    this.picker = null;
    this.app.focusSelf();
  }

  /** Enter: what's wrong goes beside its field (and the first such gets the keyboard), else the commands to check. */
  review(cx) {
    this.errors = this.spec.check?.(this.values()) ?? {};
    const bad = this.fields.findIndex((f) => this.errors[f.id]);
    if (bad >= 0) { this.go(bad, cx); return; }
    this.sendError = "";
    this.stage = "confirm";
    this.app.focusSelf();
    cx?.notify?.();
  }

  send(cx) {
    this.stage = "sending";
    this.sendError = "";
    this.app.spawn(cx, async () => {
      let r;
      try { r = await this.spec.send(cx); } catch (e) { r = { ok: false, err: String(e?.message ?? e) }; }
      if (r?.ok) { this.release(); this.spec.done?.(r, cx); }
      else { this.stage = "confirm"; this.sendError = r?.err || "gh didn't answer."; }
    });
  }

  // ---- lists

  openPicker(f, typed, cx) {
    const query = InputState.new({ placeholder: f.free ? "filter, or type a name" : "filter", value: typed });
    query.on("change", (_e, cx) => { if (this.picker) this.picker.at = 0; cx?.notify?.(); });
    const rows = this.rows(f, typed);
    const cur = f.kind === "choice" ? rows.findIndex((r) => r.value === f.value) : -1;
    this.picker = { field: f, query, at: Math.max(0, cur) };
    query.focus();
    cx?.timer?.after?.(40, () => { if (this.picker?.query === query) query.focus(); });
  }

  /** The picker's rows for `q`: the options matching every word, and what's typed when the field takes free text. */
  rows(f, q) {
    const all = f.options?.() ?? null;
    if (!all) return null;
    const words = String(q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const out = all.filter((o) => words.every((w) => `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(w)));
    const typed = String(q ?? "").trim();
    if (f.free && typed && !all.some((o) => o.value === typed)) out.push({ value: typed, label: typed, sub: "as typed", typed: true });
    return out;
  }

  pickerKey(k, e, cx) {
    const p = this.picker, f = p.field, m = e?.modifiers ?? {};
    const rows = this.rows(f, p.query.value()) ?? [];
    if (k === "escape" || k === "tab") {
      p.query.release?.(); this.picker = null;
      if (k === "tab") this.go(this.at + (m.shift ? -1 : 1), cx); else this.focusField(cx);
      return true;
    }
    if (k === "down" || (m.control && (k === "n" || k === "j"))) { p.at = Math.min(rows.length - 1, p.at + 1); return true; }
    if (k === "up" || (m.control && (k === "p" || k === "k"))) { p.at = Math.max(0, p.at - 1); return true; }
    if (k === "pagedown") { p.at = Math.min(rows.length - 1, p.at + PICK_ROWS); return true; }
    if (k === "pageup") { p.at = Math.max(0, p.at - PICK_ROWS); return true; }
    if (k === "enter") { const r = rows[p.at]; if (r) this.pick(f, r, cx); return true; }
    return "typing";
  }

  /** A row picked: a choice takes it and closes; a multi flips it and stays open. */
  pick(f, r, cx) {
    f.touched = true;
    delete this.errors[f.id];
    if (f.kind === "multi") {
      const on = (f.value ?? []).includes(r.value);
      f.value = on ? f.value.filter((v) => v !== r.value) : [...(f.value ?? []), r.value];
      f.onChange?.(f.value, cx);
      return;
    }
    f.value = r.value;
    this.picker.query.release?.();
    this.picker = null;
    f.onChange?.(f.value, cx);
    this.focusField(cx);
  }

  hints() {
    if (this.picker) return this.picker.field.kind === "multi"
      ? [["type", "filter"], ["↑↓", "move"], ["enter", "on / off"], ["esc", "done"]]
      : [["type", "filter"], ["↑↓", "move"], ["enter", "choose"], ["esc", "back"]];
    if (this.stage === "confirm") return [["enter y", this.spec.sendWord ?? "send"], ["esc", "back to the form"]];
    if (this.stage === "sending") return [["", "sending…"]];
    const f = this.fields[this.at];
    const own = f?.kind === "toggle" ? [["space", "on / off"]] : LIST.has(f?.kind) ? [["space", "pick"], ["type", "filter"]] : f?.kind === "area" ? [["enter", "new line"], ["ctrl-enter", "review"]] : [];
    return [["tab ⇧tab", "field"], ...own, ...(f?.kind === "area" ? [] : [["enter", "review"]]), ["esc", "cancel"]];
  }

  // ---- drawing

  render(t, size) {
    const wide = size.width >= 860;
    const sideW = wide ? Math.round(Math.min(520, Math.max(320, size.width * 0.4))) : 0;
    const left = panel(t, "form", this.spec.title, this.stage === "edit" || Boolean(this.picker), this.body(t), { right: this.spec.right?.() ?? "" }).flex_1().h_full();
    return div().id("form-wrap").relative().size_full()
      .child(h_flex().size_full().gap(6)
        .child(left)
        .when(wide, (el) => el.child(v_flex().w(sideW).flex_none().h_full().child(this.spec.side?.(t, { width: sideW, height: size.height }) ?? div()))))
      .when(this.stage !== "edit", (el) => el.child(this.confirmBox(t, size)))
      .when(Boolean(this.picker), (el) => el.child(this.pickerBox(t, size)));
  }

  body(t) {
    const rows = this.fields.map((f, i) => this.fieldRow(t, f, i));
    const content = v_flex().absolute().left(0).right(0).top(-this.scrollY).px(12).pt(10).gap(GAP).children(rows)
      .child(h_flex().pt(10).pb(14).gap(8).items_center()
        .child(button(t, "form-review", "Review", "enter", true, (cx) => this.review(cx)))
        .child(button(t, "form-cancel", "Cancel", "esc", false, () => this.cancel()))
        .child(div().flex_1())
        .when(Boolean(this.spec.footer), (el) => el.child(this.spec.footer(t))));
    return div().id("form-view").relative().size_full().overflow_hidden()
      .on_size_change((s, cx) => { const h = unzoom(s.height); if (Math.abs(h - this.viewH) > 1) { this.viewH = h; cx.notify(); } })
      .on_scroll_wheel((e, cx) => {
        const end = this.place(this.fields.length).y + 80;
        this.scrollY = Math.max(0, Math.min(Math.max(0, end - this.viewH), this.scrollY - unzoom(e.delta?.y ?? 0)));
        cx.notify();
      })
      .child(content);
  }

  fieldRow(t, f, i) {
    const on = i === this.at && this.stage === "edit";
    const err = this.errors[f.id];
    const edge = err ? t.blocked : on ? t.accent : t.ansi0;
    const click = (_e, cx) => {
      cx.stop_propagation();
      this.at = i;
      if (f.kind === "toggle") this.flip(f, cx);
      else if (LIST.has(f.kind)) this.openPicker(f, "", cx);
      if (!this.picker) this.focusField(cx);
      cx.notify();
    };
    let control;
    if (TEXT.has(f.kind)) {
      const box = div().id(`ff-${f.id}`).relative().flex_1().min_w(0).border(1).border_color(edge).px(7)
        .when(on, (el) => el.child(div().absolute().inset_0().opacity(0.35).child(dither(t.ansi0, 1))))
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.at = i; this.focusField(cx); cx.notify(); });
      control = f.kind === "area"
        ? box.h(AREA).py(5).child(Textarea.new(this.inputOf(f)).relative().w_full().h_full().text_size(12).text_color(t.foreground))
        : box.h(ROW).flex().items_center().child(Input.new(this.inputOf(f)).relative().w_full().text_size(12).text_color(t.foreground));
    } else if (f.kind === "toggle") {
      control = h_flex().id(`ff-${f.id}`).relative().flex_1().min_w(0).h(ROW).gap(8).items_center().cursor_pointer()
        .on_mouse_down("left", click)
        .child(div().relative().size(12).flex_none().border(1).border_color(on ? t.accent : f.value ? t.foreground : t.ansi8)
          .when(Boolean(f.value), (el) => el.child(div().absolute().top(2).left(2).size(6).bg(on ? t.accent : t.foreground))))
        .child(div().relative().flex_1().min_w(0).truncate().text_size(12).text_color(f.value ? t.foreground : t.muted).child(f.note ?? (f.value ? "on" : "off")));
    } else {
      const list = f.kind === "multi" ? f.value ?? [] : null;
      const text = list ? list.join(", ") : f.display ? f.display(f.value) : String(f.value ?? "");
      const shown = text || f.placeholder || (list ? "none" : "pick one");
      control = h_flex().id(`ff-${f.id}`).relative().flex_1().min_w(0).h(ROW).px(7).gap(8).items_center().border(1).border_color(edge).cursor_pointer()
        .hover((s) => s.border_color(on ? t.accent : t.ansi8))
        .when(on, (el) => el.child(div().absolute().inset_0().opacity(0.35).child(dither(t.ansi0, 1))))
        .on_mouse_down("left", click)
        .child(div().relative().flex_1().min_w(0).truncate().text_size(12).text_color(text ? (f.tone ? t[f.tone] ?? t.foreground : t.foreground) : t.dim).child(shown))
        .when(Boolean(f.right), (el) => el.child(div().relative().flex_none().text_size(10).text_color(t.dim).child(f.right)))
        .child(div().relative().flex_none().text_size(10).text_color(on ? t.accent : t.dim).child(list ? `${list.length || ""} ▾` : "▾"));
    }
    return v_flex().id(`frow-${f.id}`).relative().flex_none()
      .child(h_flex().items_start().gap(10)
        .child(h_flex().w(LABEL).flex_none().h(ROW).items_center().gap(4).text_size(11)
          .when(on, (el) => el.child(div().absolute().left(-12).top(6).bottom(6).w(2).bg(t.accent)))
          .child(div().truncate().text_color(on ? t.foreground : t.muted).child(f.label))
          .when(Boolean(f.required), (el) => el.child(div().flex_none().text_color(on ? t.accent : t.dim).child("*"))))
        .child(control))
      .when(Boolean(f.hint), (el) => el.child(div().h(NOTE).pl(LABEL + 10).pt(2).text_size(10).text_color(t.dim).truncate().child(f.hint)))
      .when(Boolean(err), (el) => el.child(div().h(NOTE).pl(LABEL + 10).pt(2).text_size(10).text_color(t.blocked).truncate().child(err)));
  }

  /** The last step: the exact commands, in order, before they run. */
  confirmBox(t, size) {
    const cmds = this.spec.commands?.() ?? [];
    const sending = this.stage === "sending";
    const w = Math.min(720, size.width - 40);
    const lines = cmds.map((c, i) => v_flex().id(`fc-${i}`).relative().gap(3)
      .child(h_flex().gap(8).text_size(10).text_color(t.ansi8)
        .child(div().flex_none().text_color(t.accent).child(String(i + 1)))
        .child(div().flex_1().min_w(0).truncate().child(c.label)))
      .child(div().relative().px(8).py(6).text_size(11).text_color(t.foreground)
        .child(div().absolute().inset_0().opacity(0.6).child(dither(t.ansi0, 1)))
        .child(div().relative().child(c.line))));
    return div().id("form-confirm").absolute().inset_0().flex().items_center().justify_center()
      .on_mouse_down("left", stop)
      .child(popupScrim("form-confirm-scrim"))
      .child(v_flex().id("form-confirm-box").relative().w(w).max_h(size.height - 30).bg(t.background).border(1).border_color(sending ? t.working : t.accent).overflow_y_scroll()
        .child(h_flex().relative().h(24).flex_none().px(10).items_center().text_size(11)
          .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(sending ? t.working : t.accent, 1)))
          .when(sending, (el) => el.child(div().absolute().inset_0().overflow_hidden().child(sweep(t, t.working, w))))
          .child(div().relative().text_color(t.foreground).child(sending ? "Sending…" : this.spec.confirmTitle ?? "Send to GitHub?"))
          .child(div().flex_1())
          .child(div().relative().text_color(t.dim).child(`${cmds.length} command${cmds.length === 1 ? "" : "s"}, in this order`)))
        .child(v_flex().relative().p(12).gap(12).children(lines)
          .when(Boolean(this.spec.confirmNote), (el) => el.child(div().text_size(11).text_color(t.muted).child(this.spec.confirmNote())))
          .when(Boolean(this.sendError), (el) => el.child(h_flex().gap(8).items_start().text_size(11)
            .child(div().flex_none().text_color(t.blocked).child("failed"))
            .child(div().flex_1().min_w(0).text_color(t.blocked).child(this.sendError))))
          .child(h_flex().gap(8).pt(2)
            .child(button(t, "form-send", this.sendError ? "Try again" : this.spec.sendWord ?? "Send", "enter", true, (cx) => { if (!sending) this.send(cx); }, sending))
            .child(button(t, "form-back", "Back", "esc", false, () => { if (!sending) { this.stage = "edit"; this.focusField(); } }, sending)))));
  }

  pickerBox(t, size) {
    const p = this.picker, f = p.field;
    const rows = this.rows(f, p.query.value());
    const n = rows?.length ?? 0;
    p.at = Math.max(0, Math.min(p.at, n - 1));
    const top = Math.max(0, Math.min(p.at - Math.floor(PICK_ROWS / 2), n - PICK_ROWS));
    const chosen = (r) => (f.kind === "multi" ? (f.value ?? []).includes(r.value) : f.value === r.value);
    const row = (r, i) => h_flex().id(`fp-${i}`).relative().h(r.sub ? 32 : 22).flex_none().px(10).gap(8).items_center().cursor_pointer()
      .hover((s) => s.bg(t.ansi0 + "55"))
      .when(i === p.at, (el) => el.children(band(t, true)))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { p.at = i; this.pick(f, r, cx); cx.notify(); })
      .when(f.kind === "multi", (el) => el.child(div().relative().size(10).flex_none().border(1).border_color(chosen(r) ? t.accent : t.ansi8)
        .when(chosen(r), (e2) => e2.child(div().absolute().top(2).left(2).size(4).bg(t.accent)))))
      .child(v_flex().relative().flex_1().min_w(0)
        .child(div().truncate().text_size(12).text_color(i === p.at ? t.foreground : r.typed ? t.accent : t.muted).child(r.label))
        .when(Boolean(r.sub), (el) => el.child(div().truncate().text_size(10).text_color(t.dim).child(r.sub))))
      .when(Boolean(r.right) || (f.kind === "choice" && chosen(r)), (el) => el.child(div().relative().flex_none().text_size(10).text_color(t.dim).child(r.right ?? "current")));
    const body = rows == null ? div().h(80).child(empty(t, "Reading…", null, { small: true }))
      : !n ? div().px(10).py(10).text_size(11).text_color(t.dim).child(f.free ? "Nothing matches: type a name." : "Nothing matches.")
      : v_flex().py(4).children(rows.slice(top, top + PICK_ROWS).map((r, i) => row(r, top + i)));
    const w = Math.min(560, size.width - 40);
    return div().id("form-picker").absolute().inset_0().flex().justify_center().pt(40)
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); p.query.release?.(); this.picker = null; this.focusField(); cx.notify(); })
      .child(popupScrim("form-picker-scrim"))
      .child(v_flex().id("form-picker-box").w(w).max_h(PICK_ROWS * 32 + 60).bg(t.background).border(1).border_color(t.accent)
        .on_mouse_down("left", stop)
        .child(h_flex().relative().h(24).flex_none().px(10).items_center().text_size(11)
          .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.accent, 1)))
          .child(div().relative().text_color(t.foreground).child(f.label))
          .child(div().flex_1())
          .child(div().relative().text_color(t.dim).child(f.kind === "multi" ? `${(f.value ?? []).length} chosen` : rows ? `${n}` : "")))
        .child(h_flex().h(28).flex_none().px(10).gap(6).items_center()
          .child(div().text_size(11).text_color(t.accent).child(">"))
          .child(Input.new(p.query).flex_1().h_full().text_size(12).text_color(t.foreground)))
        .child(div().h(1).flex_none().bg(t.ansi0))
        .child(body));
  }
}

/** A form button: the key it answers to beside its word; `main` is the accent one. */
export function button(t, id, word, key, main, action, off = false) {
  return h_flex().id(id).relative().h(24).px(10).gap(8).flex_none().items_center().text_size(11).border(1)
    .border_color(off ? t.ansi0 : main ? t.accent : t.ansi8)
    .when(!off, (el) => el.cursor_pointer().hover((s) => s.border_color(t.foreground)))
    .when(main && !off, (el) => el.child(div().absolute().inset_0().opacity(0.5).child(dither(t.ansi0, 1))))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => { cx.stop_propagation(); if (!off) action(cx); cx.notify(); })
    .child(div().relative().text_color(off ? t.dim : main ? t.foreground : t.muted).child(word))
    .child(div().relative().text_size(10).text_color(off ? t.dim : t.accent).child(key));
}
