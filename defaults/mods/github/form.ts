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
import type { Context, Element, KeyEvent, MouseButtonEvent, Size } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { window as appWindow } from "herdr";
import type { Theme } from "herdr";
import { isString } from "./guard.ts";
import { dither, panel, stop, band, sweep, empty, unzoom } from "./kit.ts";
import { formKey, formHints, submitKey, wrap } from "./form-keys.ts";
import type { FormHint, Stop } from "./form-keys.ts";
import type { Cell, Layout, PickerPlace, Row as LayoutRow } from "./form-layout.ts";
import { layout, cellOf, columns, pickerHeight, pickerPlace, LABEL, LABEL_GAP, CONTROL, ERROR, TOGGLE, JOIN, TOP, FOOTER, PICK_MAX, PICK_HEAD, PICK_ROW, PICK_ROW_SUB } from "./form-layout.ts";

const PICK_ROWS = PICK_MAX;

/** A row of a list field's picker: the value it stands for, its words; `typed`: what was typed, taken as it is. */
export interface Choice {
  readonly value: string;
  readonly label: string;
  readonly sub?: string;
  readonly right?: string;
  readonly typed?: boolean;
}

/** What every field has: its id (unique in the form), its label, how it's drawn and placed. */
interface Common {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly group?: string;
  readonly half?: boolean;
  readonly pair?: boolean;
  readonly join?: string;
  /** Replaces the field of its id without keeping what was typed there. */
  readonly reset?: boolean;
  /** The person changed it (a fill no longer writes over it). */
  touched?: boolean;
}

/** A one-line text (or a number, typed as text). */
export interface TextField extends Common {
  readonly kind: "text" | "number";
  value: string;
  input?: InputState;
  readonly onChange?: (value: string, cx: Context) => void;
}

/** A multi-line text: cmd-enter in it reviews (the new line it typed is taken back). */
export interface AreaField extends Common {
  readonly kind: "area";
  value: string;
  input?: TextareaState;
  before?: string;
  readonly onChange?: (value: string, cx: Context) => void;
}

export interface ToggleField extends Common {
  readonly kind: "toggle";
  value: boolean;
  readonly note?: string;
  readonly onChange?: (value: boolean, cx: Context) => void;
}

/** One value from a list (or typed, when `free`). */
export interface ChoiceField extends Common {
  readonly kind: "choice";
  value: string;
  readonly free?: boolean;
  readonly display?: (value: string) => string;
  readonly options: () => readonly Choice[] | null;
  readonly onChange?: (value: string, cx: Context) => void;
}

/** Any number of values from a list. */
export interface MultiField extends Common {
  readonly kind: "multi";
  value: readonly string[];
  readonly free?: boolean;
  readonly display?: (value: string) => string;
  readonly options: () => readonly Choice[] | null;
  readonly onChange?: (value: readonly string[], cx: Context) => void;
}

export type Field = TextField | AreaField | ToggleField | ChoiceField | MultiField;

/** A field with a list. */
export type ListField = ChoiceField | MultiField;

/** A field's value. */
export type FieldValue = Field["value"];

/** Every field's value by id. */
export type Values = ReadonlyMap<string, FieldValue>;

/** A field's text (a text, number, area or choice field's value), "" when it's another kind or missing. */
export function textIn(values: Values, id: string): string {
  const v = values.get(id);

  return isString(v) ? v : "";
}

/** A toggle's value, false when missing. */
export const flagIn = (values: Values, id: string): boolean => values.get(id) === true;

/** A multi field's values, none when missing. */
export function listIn(values: Values, id: string): readonly string[] {
  const v = values.get(id);

  return Array.isArray(v) ? v : [];
}

/** A command the review shows before anything runs. */
export interface Command {
  readonly label: string;
  readonly line: string;
}

/** How a send went: done (with what the form's flow needs next), or why not. */
export type Outcome<R> = (R & { readonly ok: true }) | { readonly ok: false; readonly err: string };

/** What a form is: its fields, what goes beside it, how it checks, shows and sends what it writes. */
export interface FormSpec<R> {
  readonly title: string;
  readonly fields?: readonly Field[];
  readonly side?: (t: Theme, size: Size) => Element;
  readonly summary?: () => string;
  readonly check?: (values: Values) => ReadonlyMap<string, string>;
  readonly commands?: () => readonly Command[];
  readonly send: (cx: Context) => Promise<Outcome<R>>;
  readonly done?: (r: R & { readonly ok: true }, cx: Context) => void;
  readonly cancel?: () => void;
  readonly sendWord?: string;
  readonly confirmTitle?: string;
  readonly confirmNote?: () => string;
}

/** What a form asks of the window: the keyboard back, and work in the background. */
export interface FormHost {
  focusSelf(): void;
  spawn(cx: Context, fn: () => Promise<void>): void;
}

/** An open list: its field, the filter, the row with the keyboard, the first row shown. */
interface Picker {
  readonly field: ListField;
  readonly query: InputState;
  at: number;
  top: number;
}

/** Where an open list sits and which of its rows show. */
interface PickerSpot {
  readonly rows: readonly Choice[] | null;
  readonly n: number;
  readonly place: PickerPlace;
  readonly top: number;
  readonly end: number;
  readonly hOf: (r: Choice) => number;
}

const isText = (f: Field): f is TextField | AreaField => f.kind === "text" || f.kind === "number" || f.kind === "area";

const isList = (f: Field): f is ListField => f.kind === "choice" || f.kind === "multi";

/** `f` with what was typed in `old` (the same field before the fields were replaced), when both are the same kind. */
function keep(f: Field, old: Field): void {
  switch (f.kind) {
    case "text":
    case "number":
      if (old.kind === f.kind) {
        f.value = old.value;

        if (old.input) f.input = old.input;
      }

      break;
    case "area":
      if (old.kind === "area") {
        f.value = old.value;

        if (old.input) f.input = old.input;
      }

      break;
    case "toggle":
      if (old.kind === "toggle") f.value = old.value;

      break;
    case "choice":
      if (old.kind === "choice") f.value = old.value;

      break;
    case "multi":
      if (old.kind === "multi") f.value = old.value;

      break;
  }

  if (old.kind === f.kind && old.touched !== undefined) f.touched = old.touched;
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

    const left = panel(t, "form", title, true, review ? this.reviewBody(t) : this.body(t), { right: step }).h_full()
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

  /** The fields (scrolled when they don't fit) over the footer with the buttons. */
  body(t: Theme): Element {
    const lay = this.lay();
    const parts: Element[] = [];

    for (const r of lay.rows) {
      if (r.kind === "section") {
        parts.push(this.section(t, r, lay));

        continue;
      }

      for (const c of r.cells) parts.push(this.fieldCell(t, c, lay));

      const [a] = r.cells;

      if (r.join && r.cells.length === 2 && a) {
        parts.push(div().absolute().left(a.x + a.w).top(r.y + LABEL + LABEL_GAP).w(JOIN).h(CONTROL).flex().items_center().justify_center()
          .text_size(12).text_color(t.dim).child(r.join));
      }
    }

    const view = div().id("form-view").relative().flex_1().min_h(0).overflow_hidden()
      .on_size_change((s, cx) => {
        const h = unzoom(s.height), w = unzoom(s.width);

        if (Math.abs(h - this.viewH) > 1 || Math.abs(w - this.width) > 1) {
          this.viewH = h;
          this.width = w;
          // Scrolled before the panel's size was known: keep the focused stop in view, scrolling no further than the form needs.
          this.scrollY = 0;
          this.reveal();
          cx.notify();
        }
      })
      .on_scroll_wheel((e, cx) => {
        this.scrollY = Math.max(0, Math.min(Math.max(0, this.lay().height - this.viewH), this.scrollY - unzoom(e.delta.y)));
        cx.notify();
      })
      .child(div().id("form-fields").absolute().left(0).right(0).top(-this.scrollY).h(lay.height).children(parts))
      .when(Boolean(this.picker), (el) => el.children(this.pickerBox(t, lay)));

    const foot = this.footer(t, lay.pad, this.spec.summary?.() ?? "", [
      button(t, "form-review", "Review", submitKey(this.stops(), this.at, this.mac), true, (cx) => this.review(cx), false, this.isAt("form-review")),
      button(t, "form-cancel", "Cancel", "esc", false, () => this.cancel(), false, this.isAt("form-cancel")),
    ]);

    return v_flex().size_full().child(view).child(foot);
  }

  /** The bar on the panel's bottom edge: a dithered horizon (a running sweep while sending), a line of summary, the buttons. */
  footer(t: Theme, pad: number, summary: string, buttons: Element[]): Element {
    const sending = this.stage === "sending";

    return h_flex().id("form-foot").relative().h(FOOTER).flex_none().px(pad).gap(8).items_center()
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(sending ? t.working : t.ansi0, 1)))
      .when(sending, (el) => el.child(div().absolute().left(0).right(0).top(0).h(2).overflow_hidden().child(sweep(t, t.working, this.width))))
      .child(div().relative().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(summary))
      .children(buttons);
  }

  /** A section's eyebrow over a dithered rule. */
  section(t: Theme, r: LayoutRow<Field> & { readonly kind: "section" }, lay: Layout<Field>): Element {
    return h_flex().absolute().left(lay.pad).top(r.y).w(lay.inner).h(r.h).gap(8).items_center()
      .child(div().flex_none().text_size(10).text_color(t.ansi8).child(r.title.toUpperCase()))
      .child(div().relative().flex_1().h(1).child(dither(t.ansi0, 1)));
  }

  /** One field at its place in the column: its label line (label, *, hint), the control, what's wrong under it. */
  fieldCell(t: Theme, c: Cell<Field>, lay: Layout<Field>): Element {
    const f = c.field, i = c.index;
    const on = i === this.at && this.stage === "edit";
    const err = this.errors.get(f.id) ?? "";
    const edge = err ? t.blocked : on ? t.accent : t.ansi0;

    const click = (_e: MouseButtonEvent, cx: Context) => {
      cx.stop_propagation();
      this.at = i;

      if (f.kind === "toggle") this.flip(f, cx);
      else if (isList(f)) this.openPicker(f, "", cx);

      if (!this.picker) this.focusField(cx);

      cx.notify();
    };

    const errLine = () => div().h(ERROR).pt(3).text_size(10).text_color(t.blocked).truncate().child(err);
    const cell = v_flex().id(`frow-${f.id}`).absolute().left(c.x).top(c.y).w(c.w);

    if (f.kind === "toggle") {
      return cell
        .child(h_flex().id(`ff-${f.id}`).relative().h(TOGGLE).gap(8).items_center().cursor_pointer().on_mouse_down("left", click)
          .child(div().relative().size(12).flex_none().border(1).border_color(on ? t.accent : f.value ? t.foreground : t.ansi8)
            .when(f.value, (el) => el.child(div().absolute().top(2).left(2).size(6).bg(on ? t.accent : t.foreground))))
          .child(div().flex_none().text_size(12).text_color(on || f.value ? t.foreground : t.muted).child(f.label))
          .when(Boolean(f.note), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(f.note ?? ""))))
        .when(Boolean(err), (el) => el.child(errLine()));
    }

    const label = h_flex().h(LABEL).gap(4).items_center().text_size(11)
      .child(div().flex_none().max_w(Math.max(60, Math.floor(c.w * 0.62))).truncate().text_color(on ? t.foreground : t.muted).child(f.label))
      .when(Boolean(f.required), (el) => el.child(div().flex_none().text_color(on ? t.accent : t.dim).child("*")))
      .child(div().flex_1().min_w(0).pl(8).truncate().text_right().text_size(10).text_color(t.dim).child(f.hint ?? ""));

    let control: Element;

    if (isText(f)) {
      const box = div().id(`ff-${f.id}`).relative().w_full().border(1).border_color(edge).px(7)
        .when(on, (el) => el.child(div().absolute().inset_0().opacity(0.35).child(dither(t.ansi0, 1))))
        .on_mouse_down("left", (_e, cx) => {
          cx.stop_propagation();
          this.at = i;
          this.focusField(cx);
          cx.notify();
        });

      control = f.kind === "area"
        ? box.h(lay.area).py(5).child(Textarea.new(this.areaOf(f)).relative().w_full().h_full().text_size(12).text_color(t.foreground))
        : box.h(CONTROL).flex().items_center().child(Input.new(this.inputOf(f)).relative().w_full().text_size(12).text_color(t.foreground));
    } else {
      const list = f.kind === "multi" ? f.value : null;
      const shownAs = (v: string) => (f.display ? f.display(v) : v);
      const text = f.kind === "multi" ? "" : shownAs(f.value);
      const open = this.picker?.field === f;
      const shown = list?.length ? null : text || f.placeholder || (list ? "none" : "pick one");

      control = h_flex().id(`ff-${f.id}`).relative().w_full().h(CONTROL).px(7).gap(6).items_center().border(1).border_color(open ? t.accent : edge).cursor_pointer()
        .hover((s) => s.border_color(on ? t.accent : t.ansi8))
        .when(on, (el) => el.child(div().absolute().inset_0().opacity(0.35).child(dither(t.ansi0, 1))))
        .on_mouse_down("left", click)
        .when(Boolean(list?.length), (el) => el.child(h_flex().relative().flex_1().min_w(0).gap(6).overflow_hidden()
          .children((list ?? []).map((v, k) => chipOf(t, `fc-${f.id}-${k}`, shownAs(v))))))
        .when(shown !== null, (el) => el.child(div().relative().flex_1().min_w(0).truncate().text_size(12)
          .text_color(text ? t.foreground : t.dim).child(shown ?? "")))
        .child(div().relative().flex_none().text_size(10).text_color(on || open ? t.accent : t.dim)
          .child(list ? `${list.length || ""} ▾` : on ? "‹ › ▾" : "▾"));
    }

    return cell.child(label).child(div().h(LABEL_GAP)).child(control).when(Boolean(err), (el) => el.child(errLine()));
  }

  /** The review, in place of the fields: the exact commands, in order, before they run; Send and Back in the footer. */
  reviewBody(t: Theme): Element {
    const cmds = this.spec.commands?.() ?? [];
    const sending = this.stage === "sending";
    const pad = this.lay().pad;

    const lines = cmds.map((c, i) => v_flex().id(`fc-${i}`).relative().gap(4)
      .child(h_flex().gap(8).text_size(10).text_color(t.ansi8)
        .child(div().flex_none().text_color(t.accent).child(String(i + 1)))
        .child(div().flex_1().min_w(0).truncate().child(c.label)))
      .child(div().relative().px(8).py(6).text_size(11).text_color(t.foreground)
        .child(div().absolute().inset_0().opacity(0.6).child(dither(t.ansi0, 1)))
        .child(div().relative().child(c.line))));

    const note = this.spec.confirmNote;

    const view = v_flex().id("form-confirm").relative().flex_1().min_h(0).overflow_y_scroll().px(pad).pt(12).pb(12).gap(14)
      .children(lines)
      .when(Boolean(note), (el) => el.child(div().text_size(11).text_color(t.muted).child(note?.() ?? "")))
      .when(Boolean(this.sendError), (el) => el.child(h_flex().gap(8).items_start().text_size(11)
        .child(div().flex_none().text_color(t.blocked).child("failed"))
        .child(div().flex_1().min_w(0).text_color(t.blocked).child(this.sendError))));

    const foot = this.footer(t, pad, sending ? "sending…" : `${cmds.length} command${cmds.length === 1 ? "" : "s"}, in this order`, [
      button(t, "form-send", this.sendError ? "Try again" : this.spec.sendWord ?? "Send", submitKey(this.stops(), this.confirmAt, this.mac), true, (cx) => {
        if (!sending) this.send(cx);
      }, sending, !sending && this.confirmAt === 0),
      button(t, "form-back", "Back", "esc", false, (cx) => this.back(cx), sending, !sending && this.confirmAt === 1),
    ]);

    return v_flex().size_full().child(view).child(foot);
  }

  /** Where the open list sits and which of its rows show: { rows, n, place, top, end, hOf }, or null. */
  pickerSpot(lay: Layout<Field> = this.lay()): PickerSpot | null {
    const p = this.picker;

    if (!p) return null;

    const f = p.field;
    const rows = this.rows(f, p.query.value());
    const n = rows?.length ?? 0;

    p.at = Math.max(0, Math.min(p.at, n - 1));

    const cell = cellOf(lay, this.fields.indexOf(f));

    if (!cell) return null;

    const place = pickerPlace(cell, { scrollY: this.scrollY, viewH: this.viewH, want: pickerHeight(rows), width: this.width });

    // The rows that fit, scrolled so the one with the keyboard shows.
    const room = place.h - PICK_HEAD - 8;
    const hOf = (r: Choice) => (r.sub ? PICK_ROW_SUB : PICK_ROW);

    const fits = (from: number) => {
      let h = 0, k = from;

      for (let r = rows?.[k]; r && k < n && h + hOf(r) <= room; r = rows?.[k]) {
        h += hOf(r);
        k++;
      }

      return k;
    };

    let top = 0;

    if (n) {
      top = Math.min(p.top, p.at);

      while (fits(top) <= p.at && top < p.at) top++;

      p.top = top;
    }

    return { rows, n, place, top, end: n ? Math.max(fits(top), top + 1) : 0, hOf };
  }

  /** The open list, under its field at the field's width (form-layout.ts pickerPlace: upward without room below,
   *  never over the footer), over a catcher that closes it on a click outside. */
  pickerBox(t: Theme, lay: Layout<Field>): Element[] {
    const spot = this.pickerSpot(lay);
    const p = this.picker;

    if (!spot || !p) return [];

    const f = p.field;
    const { rows, n, place, top, end, hOf } = spot;
    const chosen = (r: Choice) => (f.kind === "multi" ? f.value.includes(r.value) : f.value === r.value);

    const row = (r: Choice, i: number) => h_flex().id(`fp-${i}`).relative().h(hOf(r)).flex_none().px(8).gap(8).items_center().cursor_pointer()
      .hover((s) => s.bg(`${t.ansi0}55`))
      .when(i === p.at, (el) => el.children(band(t, true)))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        p.at = i;
        this.pick(f, r, cx);
        cx.notify();
      })
      .when(f.kind === "multi", (el) => el.child(div().relative().size(10).flex_none().border(1).border_color(chosen(r) ? t.accent : t.ansi8)
        .when(chosen(r), (e2) => e2.child(div().absolute().top(2).left(2).size(4).bg(t.accent)))))
      .child(v_flex().relative().flex_1().min_w(0)
        .child(div().truncate().text_size(12).text_color(i === p.at ? t.foreground : r.typed ? t.accent : t.muted).child(r.label))
        .when(Boolean(r.sub), (el) => el.child(div().truncate().text_size(10).text_color(t.dim).child(r.sub ?? ""))))
      .when(Boolean(r.right) || (f.kind === "choice" && chosen(r)), (el) => el.child(div().relative().flex_none().text_size(10).text_color(t.dim).child(r.right || "current")));

    const body = rows === null ? div().h(60).child(empty(t, "Reading…", null, { small: true }))
      : !n ? div().px(8).py(9).text_size(11).text_color(t.dim).child(f.free ? "Nothing matches: type a name." : "Nothing matches.")
      : v_flex().py(4).children(rows.slice(top, end).map((r, k) => row(r, top + k)));

    const count = f.kind === "multi" ? `${f.value.length} chosen` : rows ? `${n}` : "";

    return [
      div().id("form-picker").absolute().inset_0()
        .on_mouse_down("left", (_e, cx) => {
          cx.stop_propagation();
          p.query.release();
          this.picker = null;
          this.focusField(cx);
          cx.notify();
        }),
      v_flex().id("form-picker-box").absolute().left(place.x).top(place.y).w(place.w).h(place.h).overflow_hidden().bg(t.background).border(1).border_color(t.accent)
        .on_mouse_down("left", stop)
        .child(h_flex().relative().h(PICK_HEAD - 1).flex_none().px(8).gap(6).items_center()
          .child(div().text_size(11).text_color(t.accent).child("›"))
          .child(Input.new(p.query).flex_1().h_full().text_size(12).text_color(t.foreground))
          .child(div().flex_none().text_size(10).text_color(t.dim).child(count)))
        .child(div().h(1).flex_none().bg(t.ansi0))
        .child(body),
    ];
  }
}

/** A chosen value in a list field: a small dithered chip. */
function chipOf(t: Theme, id: string, word: string): Element {
  return div().id(id).relative().flex_none().h(18).px(5).flex().items_center().text_size(11).text_color(t.foreground)
    .child(div().absolute().inset_0().child(dither(t.ansi0, 1)))
    .child(div().relative().child(word));
}

/** A form button: the key it answers to beside its word; `main` is the accent one.
 *  `focused` (the keyboard's) wears the dialogs' ring: the main one filled in
 *  the accent, the other on a band with an accent edge. */
export function button(t: Theme, id: string, word: string, key: string, main: boolean, action: (cx: Context) => void, off = false, focused = false): Element {
  const filled = focused && main;

  return h_flex().id(id).relative().h(24).px(10).gap(8).flex_none().items_center().text_size(11).border(1)
    .border_color(off ? t.ansi0 : focused || main ? t.accent : t.ansi8)
    .when(!off, (el) => el.cursor_pointer().hover((s) => s.border_color(t.foreground)))
    .when(main && !off && !focused, (el) => el.child(div().absolute().inset_0().opacity(0.5).child(dither(t.ansi0, 1))))
    .when(filled, (el) => el.bg(t.accent))
    .when(focused && !main, (el) => el.bg(t.ansi0))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      cx.stop_propagation();

      if (!off) action(cx);

      cx.notify();
    })
    .child(div().relative().text_color(off ? t.dim : filled ? t.background : main || focused ? t.foreground : t.muted).child(word))
    .child(div().relative().text_size(10).text_color(off ? t.dim : filled ? t.background : t.accent).child(key));
}
