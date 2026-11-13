// A form in the GitHub window, for what writes to GitHub (a new pull
// request: prForm.ts; running a workflow: dispatchForm.ts). It takes the
// tab's body: the fields in a column on the left (COLUMN wide, the whole
// body when it's narrow), what will be sent beside it in the width that's
// left (the flow's `side`), and a last step that shows the exact commands
// in the column's place before anything runs. Where fields sit is
// form-layout.ts: sections under eyebrows, labels above the fields with the
// hint on the label line, pairs and halves two to a row, the body growing
// into the free room, the buttons in a footer on the panel's bottom edge,
// a list opening under its field (upward without room below).
//
// Keyboard first, the way every form is (form-keys.ts): tab / shift-tab
// (or ↓ ↑ outside the body) walk the fields, then Review and Cancel,
// wrapping; typing goes into text; ← → step a choice's value, space flips a
// toggle and opens a list (typing on a list field opens it filtered); enter
// reviews the commands (cmd/ctrl-enter from the body, where enter is a new
// line, or from Cancel); enter on a button presses it; esc cancels. In the
// review Send has the keyboard: tab / ← → reach Back, enter presses, y sends,
// esc goes back. The mouse does the same: click a field, a toggle, a list,
// the buttons.
//
// Field: a union on `kind` (text, number, area, toggle, choice, multi): its
//   value (text for text, number, area and choice; on / off for a toggle; the
//   chosen values for multi), required, hint, placeholder, note (beside a
//   toggle), free (a list field takes what's typed too), display(value) (a
//   list value in words), options(): [{ value, label, sub, right }] | null
//   (reading), group (starts a section), half (two to a row), pair + join
//   (shares its row with the next field, `join` between them).

import { div } from "gpui-kit";
import type { Context, Element, KeyEvent, Size } from "gpui-kit";
import { h_flex, v_flex, InputState, TextareaState } from "gpui-base";
import { window as appWindow } from "herdr";
import type { Theme } from "herdr";
import { panel } from "./kit.ts";
import { formKey, formHints, wrap } from "./form-keys.ts";
import type { FormHint, Stop } from "./form-keys.ts";
import type { Layout, PickerPlace } from "./form-layout.ts";
import type { AreaField, Choice, Field, FieldValue, FormHost, FormSpec, ListField, Outcome, TextField, Values } from "./form-fields.ts";
import { isText, isList, keep, textIn } from "./form-fields.ts";
import { body, reviewBody, pickerSpot } from "./form-draw.ts";
import { layout, cellOf, columns, TOP, PICK_MAX } from "./form-layout.ts";

const PICK_ROWS = PICK_MAX;

/** An open list: its field, the filter, the row with the keyboard, the first row shown. */
export interface Picker {
  readonly field: ListField;
  readonly query: InputState;
  at: number;
  top: number;
}

/** Where an open list sits and which of its rows show. */
export interface PickerSpot {
  readonly rows: readonly Choice[] | null;
  readonly n: number;
  readonly place: PickerPlace;
  readonly top: number;
  readonly end: number;
  readonly hOf: (r: Choice) => number;
}

/** The input a text field has, if it has one yet. */
const inputOfField = (f: Field): InputState | TextareaState | undefined => (isText(f) ? f.input : undefined);

export class Form<R> {
  readonly app: FormHost;
  readonly spec: FormSpec<R>;
  fields: Field[] = [];

  /** The stop with the keyboard: a field, then Review, Cancel. */
  at = 0;

  /** In the review: Send, Back. */
  confirmAt = 0;
  stage: "edit" | "confirm" | "sending" = "edit";

  /** What's wrong, by field id. */
  errors = new Map<string, string>();
  sendError = "";
  picker: Picker | null = null;

  // The scrolled part's size, as last drawn.
  scrollY = 0;
  viewH = 400;
  width = 638;

  /** Released: its inputs are gone. */
  gone = false;

  /** spec: { title, fields, side(t, size), summary() (the footer's line), commands() -> [{ line, label }], send(cx) -> Promise<{ ok, err }>, cancel(), sendWord } */
  constructor(app: FormHost, spec: FormSpec<R>) {
    this.app = app;
    this.spec = spec;
    this.setFields(spec.fields ?? []);
  }

  // ---- fields

  /** Replaces the fields, keeping what was typed in the ones that stay (by id). */
  setFields(list: readonly Field[]): void {
    const was = new Map(this.fields.map((f) => [f.id, f]));
    const cur = this.stops()[this.at]?.id;

    this.fields = list.map((f) => {
      const old = was.get(f.id);

      if (old && !f.reset) keep(f, old);

      return f;
    });

    for (const [id, f] of was) {
      const input = inputOfField(f);

      if (input && !this.fields.some((x) => x.id === id && inputOfField(x) === input)) input.release();
    }

    // Inputs are made here, never while drawing (the runtime refuses that).
    for (const f of this.fields) if (isText(f)) this.typingOf(f);

    const i = this.stops().findIndex((s) => s.id === cur);

    this.at = Math.max(0, Math.min(this.stops().length - 1, i < 0 ? this.at : i));
  }

  /** The keyboard's stops, in tab order (form-keys.ts): the fields and the
   *  buttons under them, or in the review its two buttons. */
  stops(): Stop[] {
    if (this.stage !== "edit") return [{ id: "form-send", kind: "button", submit: true }, { id: "form-back", kind: "button" }];

    return [
      ...this.fields.map((f): Stop => ({ id: f.id, kind: f.kind === "number" ? "text" : f.kind })),
      { id: "form-review", kind: "button", submit: true },
      { id: "form-cancel", kind: "button" },
    ];
  }

  get mac(): boolean {
    return appWindow().platform === "macos";
  }

  field(id: string): Field | null {
    return this.fields.find((f) => f.id === id) ?? null;
  }

  value(id: string): FieldValue | undefined {
    return this.field(id)?.value;
  }

  /** A text or choice field's value ("" for none). */
  text(id: string): string {
    return textIn(this.values(), id);
  }

  values(): Values {
    return new Map(this.fields.map((f) => [f.id, f.value]));
  }

  /** Sets a text or choice field's value from outside (a fill, a default): text inputs follow, unless the person typed there. */
  set(id: string, value: string, { force = false } = {}): void {
    const f = this.field(id);

    if (!f || (f.touched && !force)) return;

    if (isText(f)) {
      f.value = value;
      f.input?.set_value(value);
    } else if (f.kind === "choice") f.value = value;
  }

  /** A text field's input, whichever kind it is (made when the field is set). */
  typingOf(f: TextField | AreaField): InputState | TextareaState {
    return f.kind === "area" ? this.areaOf(f) : this.inputOf(f);
  }

  /** The one-line field's input. */
  inputOf(f: TextField): InputState {
    if (f.input) return f.input;

    const input = InputState.new({ placeholder: f.placeholder ?? "", value: f.value });

    f.input = input;
    input.on("change", (_e, cx) => {
      const v = input.value();

      if (v === f.value) return;

      f.value = v;
      f.touched = true;
      this.errors.delete(f.id);
      f.onChange?.(v, cx);
      cx.notify();
    });

    return input;
  }

  /** The body's input: cmd-enter there reviews. */
  areaOf(f: AreaField): TextareaState {
    if (f.input) return f.input;

    const input = TextareaState.new({ placeholder: f.placeholder ?? "", value: f.value, rows: 8 });

    f.input = input;
    input.on("change", (_e, cx) => {
      const v = input.value();

      if (v === f.value) return;

      f.before = f.value; // cmd-enter's new line is taken back (below)
      f.value = v;
      f.touched = true;
      this.errors.delete(f.id);
      f.onChange?.(v, cx);
      cx.notify();
    });

    // The body eats cmd-enter as a new line and says so: take it back and review.
    input.on("submit", (e, cx) => {
      if (!e.secondary) return;

      if (f.before !== undefined) {
        f.value = f.before;
        input.set_value(f.before);
      }

      this.review(cx);
      cx.notify();
    });

    return input;
  }

  /** Moves to stop i: a text field gets the keyboard, others leave it with the window. */
  go(i: number, cx: Context | null): void {
    this.at = wrap(this.stops().length, i, 0);
    this.focusField(cx);
    this.reveal();
  }

  /** The keyboard to the focused field's input (again a moment later: an input not drawn yet can't take it), or to the window. */
  focusField(cx: Context | null): void {
    const f = this.fields[this.at];

    if (f && isText(f) && this.stage === "edit" && !this.picker) {
      const input = this.typingOf(f);

      input.focus();
      cx?.timer.after(40, () => {
        if (this.fields[this.at] === f && this.stage === "edit" && !this.picker && !this.gone) input.focus();
      });
    } else this.app.focusSelf();
  }

  /** The fields laid out for the panel's last known size (form-layout.ts). */
  lay(): Layout<Field> {
    return layout(this.fields, { width: this.width, viewH: this.viewH, errors: this.errors });
  }

  /** Stop i's top and height in the scrolled form; null for the buttons (the footer doesn't scroll). */
  place(i: number): { readonly y: number; readonly h: number } | null {
    const c = cellOf(this.lay(), i);

    return c ? { y: c.y, h: c.h } : null;
  }

  reveal(): void {
    const p = this.place(this.at);

    if (!p) return;

    if (p.y < this.scrollY) this.scrollY = Math.max(0, p.y - TOP);
    else if (p.y + p.h > this.scrollY + this.viewH - 8) this.scrollY = p.y + p.h - this.viewH + 12;
  }

  // ---- keys

  /** true: used (stop it); "typing": the focused input's; false: not the form's. */
  key(k: string, e: KeyEvent, cx: Context): boolean | "typing" {
    const m = e.modifiers;

    if (this.picker) return (m.platform || m.alt) && k !== "enter" ? false : this.pickerKey(this.picker, k, e, cx);

    if (this.stage === "sending") return !(m.platform || m.alt);

    const stops = this.stops();

    if (this.stage === "confirm") {
      const plain = !m.platform && !m.control && !m.alt;

      if (plain && k === "y") {
        this.send(cx);

        return true;
      }

      if (plain && (k === "n" || k === "q" || k === "backspace")) {
        this.back(cx);

        return true;
      }

      const a = formKey(stops, this.confirmAt, k, m, e.key_char ?? null);

      if (!a) return false;

      if (a.act === "move") this.confirmAt = a.to;
      else if (a.act === "submit" || (a.act === "press" && this.confirmAt === 0)) this.send(cx);
      else if (a.act === "cancel" || a.act === "press") this.back(cx);

      return true;
    }

    const a = formKey(stops, this.at, k, m, e.key_char ?? null);

    if (!a) return false;

    const f = this.fields[this.at];

    if (a.act === "type") return "typing";

    if (a.act === "move") this.go(a.to, cx);
    else if (a.act === "submit") this.review(cx);
    else if (a.act === "cancel") this.cancel();
    else if (a.act === "press") {
      if (stops[this.at]?.id === "form-review") this.review(cx);
      else this.cancel();
    } else if (!f) return true;
    else if (a.act === "step") this.step(f, a.by, cx);
    else if (a.act === "flip") this.flip(f, cx);
    else if (a.act === "open") {
      if (isList(f)) this.openPicker(f, a.typed, cx);
    } else if (a.act === "clear") this.clear(f, cx);

    return true;
  }

  /** ← →: a choice's previous / next value, wrapping (nothing while its list is read). */
  step(f: Field, by: number, cx: Context): void {
    if (f.kind !== "choice") return;

    const opts = f.options() ?? [];

    if (!opts.length) return;

    const i = opts.findIndex((o) => o.value === f.value);
    const next = opts[wrap(opts.length, i < 0 ? (by > 0 ? -1 : 0) : i, by)];

    if (!next) return;

    f.value = next.value;
    f.touched = true;
    this.errors.delete(f.id);
    f.onChange?.(f.value, cx);
  }

  /** From the review back to the form. */
  back(cx: Context): void {
    if (this.stage === "sending") return;

    this.stage = "edit";
    this.focusField(cx);
  }

  flip(f: Field, cx: Context): void {
    if (f.kind !== "toggle") return;

    f.value = !f.value;
    f.touched = true;
    f.onChange?.(f.value, cx);
  }

  clear(f: Field, cx: Context): void {
    if (f.required) return;

    f.touched = true;

    switch (f.kind) {
      case "multi":
        f.value = [];
        f.onChange?.(f.value, cx);

        break;
      case "toggle":
        f.value = false;
        f.onChange?.(f.value, cx);

        break;
      default:
        f.value = "";
        f.onChange?.(f.value, cx);
    }
  }

  cancel(): void {
    this.release();
    this.spec.cancel?.();
  }

  release(): void {
    this.gone = true;

    for (const f of this.fields) inputOfField(f)?.release();

    this.picker?.query.release();
    this.picker = null;
    this.app.focusSelf();
  }

  /** Enter: what's wrong goes beside its field (and the first such gets the keyboard), else the commands to check. */
  review(cx: Context): void {
    this.errors = new Map(this.spec.check?.(this.values()) ?? []);

    const bad = this.fields.findIndex((f) => this.errors.has(f.id));

    if (bad >= 0) {
      this.go(bad, cx);

      return;
    }

    this.sendError = "";
    this.stage = "confirm";
    this.confirmAt = 0;
    this.app.focusSelf();
    cx.notify();
  }

  send(cx: Context): void {
    this.stage = "sending";
    this.sendError = "";
    this.app.spawn(cx, async () => {
      let r: Outcome<R>;

      try {
        r = await this.spec.send(cx);
      } catch (err) {
        r = { ok: false, err: err instanceof Error ? err.message : String(err) };
      }

      if (r.ok) {
        this.release();
        this.spec.done?.(r, cx);
      } else {
        this.stage = "confirm";
        this.confirmAt = 0;
        this.sendError = r.err || "gh didn't answer.";
      }
    });
  }

  // ---- lists

  openPicker(f: ListField, typed: string, cx: Context): void {
    const query = InputState.new({ placeholder: f.free ? "filter, or type a name" : "filter", value: typed });

    query.on("change", (_e, cx) => {
      if (this.picker) this.picker.at = 0;

      cx.notify();
    });

    const rows = this.rows(f, typed);
    const cur = f.kind === "choice" ? (rows ?? []).findIndex((r) => r.value === f.value) : -1;

    this.picker = { field: f, query, at: Math.max(0, cur), top: 0 };
    query.focus();
    cx.timer.after(40, () => {
      if (this.picker?.query === query) query.focus();
    });
  }

  /** The picker's rows for `q`: the options matching every word, and what's typed when the field takes free text. */
  rows(f: ListField, q: string): Choice[] | null {
    const all = f.options();

    if (!all) return null;

    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out = all.filter((o) => words.every((w) => `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(w)));
    const typed = q.trim();

    if (f.free && typed && !all.some((o) => o.value === typed)) out.push({ value: typed, label: typed, sub: "as typed", typed: true });

    return out;
  }

  pickerKey(p: Picker, k: string, e: KeyEvent, cx: Context): boolean | "typing" {
    const f = p.field, m = e.modifiers;
    const rows = this.rows(f, p.query.value()) ?? [];

    if (k === "escape" || k === "tab") {
      p.query.release();
      this.picker = null;

      if (k === "tab") this.go(this.at + (m.shift ? -1 : 1), cx);
      else this.focusField(cx);

      return true;
    }

    if (k === "down" || (m.control && (k === "n" || k === "j"))) {
      p.at = Math.min(rows.length - 1, p.at + 1);

      return true;
    }

    if (k === "up" || (m.control && (k === "p" || k === "k"))) {
      p.at = Math.max(0, p.at - 1);

      return true;
    }

    if (k === "pagedown") {
      p.at = Math.min(rows.length - 1, p.at + PICK_ROWS);

      return true;
    }

    if (k === "pageup") {
      p.at = Math.max(0, p.at - PICK_ROWS);

      return true;
    }

    if (k === "enter") {
      const r = rows[p.at];

      if (r) this.pick(f, r, cx);

      return true;
    }

    return "typing";
  }

  /** A row picked: a choice takes it and closes; a multi flips it and stays open. */
  pick(f: ListField, r: Choice, cx: Context): void {
    f.touched = true;
    this.errors.delete(f.id);

    if (f.kind === "multi") {
      const on = f.value.includes(r.value);

      f.value = on ? f.value.filter((v) => v !== r.value) : [...f.value, r.value];
      f.onChange?.(f.value, cx);

      return;
    }

    f.value = r.value;
    this.picker?.query.release();
    this.picker = null;
    f.onChange?.(f.value, cx);
    this.focusField(cx);
  }

  hints(): FormHint[] {
    if (this.picker) {
      return this.picker.field.kind === "multi"
        ? [["type", "filter"], ["↑↓", "move"], ["enter", "on / off"], ["esc", "done"]]
        : [["type", "filter"], ["↑↓", "move"], ["enter", "choose"], ["esc", "back"]];
    }

    if (this.stage === "sending") return [["", "sending…"]];

    if (this.stage === "confirm") return [...formHints(this.stops(), this.confirmAt, { mac: this.mac, submit: this.spec.sendWord ?? "send", cancel: "back" }), ["y", "send"]];

    return formHints(this.stops(), this.at, { mac: this.mac, submit: "review", cancel: "cancel" });
  }

  // ---- drawing

  /** The tab's body: the form panel (a column, COLUMN wide) and, from WIDE, what it will send beside it. */
  render(t: Theme, size: Size): Element {
    const cols = columns(size.width);
    const review = this.stage !== "edit";
    const title = !review ? this.spec.title : this.stage === "sending" ? "Sending…" : this.spec.confirmTitle ?? "Send to GitHub?";
    const step = review ? "2 of 2 · check" : "1 of 2 · fill in";

    const left = panel(t, "form", title, true, review ? reviewBody(this, t) : body(this, t), { right: step }).h_full()
      .when(this.stage === "sending", (el) => el.border_color(t.working))
      .when(cols.side > 0, (el) => el.w(cols.form).flex_none())
      .when(!cols.side, (el) => el.flex_1());

    return div().id("form-wrap").relative().size_full()
      .child(h_flex().size_full().gap(6)
        .child(left)
        .when(cols.side > 0, (el) => el.child(v_flex().flex_1().min_w(0).h_full().child(this.spec.side?.(t, { width: cols.side, height: size.height }) ?? div()))));
  }

  isAt(id: string): boolean {
    return this.stage === "edit" && !this.picker && this.stops()[this.at]?.id === id;
  }

  /** Where the open list sits and which of its rows show (form-draw.ts). */
  pickerSpot(lay: Layout<Field> = this.lay()): PickerSpot | null {
    return pickerSpot(this, lay);
  }
}
