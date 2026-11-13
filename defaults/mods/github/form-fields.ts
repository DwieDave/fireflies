// A GitHub form's fields and what a flow gives the form (form.ts draws and
// drives them; prForm.ts and dispatchForm.ts make them): the field kinds, the
// values read back, the spec of a form, and what it asks of the window.

import type { Context, Element, Size } from "gpui-kit";
import type { InputState, TextareaState } from "gpui-base";
import type { Theme } from "herdr";
import { isString } from "./guard.ts";

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

export const isText = (f: Field): f is TextField | AreaField => f.kind === "text" || f.kind === "number" || f.kind === "area";

export const isList = (f: Field): f is ListField => f.kind === "choice" || f.kind === "multi";

/** `f` with what was typed in `old` (the same field before the fields were replaced), when both are the same kind. */
export function keep(f: Field, old: Field): void {
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
