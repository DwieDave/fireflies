// Keyboard-first forms: the one way every form takes its keys. A mod can't
// import another mod's files, so this file is copied byte for byte into each
// mod that draws a form (scripts/form-keys.test.ts checks the copies match).
//
// A form is its stops in tab order: the fields, then the buttons.
//   stop: { id, kind }  kind: "text" (one line) | "area" (lines) | "choice"
//                       (one of a list) | "multi" (any of a list) | "toggle"
//                       | "button"; `submit: true` on the button enter presses
//
// The keys, the same in every form:
//   tab / shift-tab   the next / previous stop, wrapping at both ends
//   ctrl-tab / ctrl-shift-tab  the same, also out of a multi-line field
//                     (whose tab is an indent)
//   ↑ ↓               the same, outside a multi-line field
//   ← →               a choice steps through its values, a toggle flips,
//                     a button goes to the button beside it
//   space             a toggle flips, a list opens, a button presses
//   typing            goes into text; on a list field it opens the list,
//                     filtered by what's typed
//   enter             submits from a one-line field, a choice or a toggle;
//                     presses a button; is a new line in a multi-line field
//   cmd-enter         submits from anywhere (ctrl-enter off macOS)
//   esc               cancels
//
// formKey() says what a key does; the form does it. formHints() is the hint
// line naming these keys, ring() the focus ring the focused stop wears.
//
// Tab never reaches an on_key_down: GPUI runs key bindings first, and the
// root binds tab / shift-tab to move the focus. So a form binds them in its
// own key context (bindTab(cx) once, from init) and its root element, at or
// above both its focus handle and its inputs, takes them as actions
// (tabActions(el, key)) that hand its key handler the tab it never heard. A
// multi-line field eats cmd-enter as a new line and says so through its
// "submit" event with `secondary`: a form listens for that too.
//
// ctrl-tab / ctrl-shift-tab are the app's tab switching (keys.json, the
// window's "Herdr" context), and a text area takes tab for itself. So a form
// binds them too, deeper than the app's: inside a text field of a form root
// ("Form > Input": every form's fields and text areas), and anywhere under a
// root that says a form has the keyboard (tabActions' `open`: the "FormOpen"
// context). Elsewhere (a pane that shows no form) they switch the app's tabs.

import { div } from "gpui-kit";
import type { Color, Context, Element, KeyEvent } from "gpui-kit";

/** What a stop is: a one-line field, lines, one of a list, any of a list, on / off, a button. */
export type StopKind = "text" | "area" | "choice" | "multi" | "toggle" | "button";

/** One place the keyboard can be in a form. */
export interface Stop {
  readonly id: string;
  readonly kind: StopKind;
  /** The button enter presses (the form's own submit). */
  readonly submit?: boolean;
}

/** The modifiers formKey looks at (GPUI's Modifiers has these and more). */
export interface FormModifiers {
  readonly shift?: boolean;
  readonly control?: boolean;
  readonly alt?: boolean;
  readonly platform?: boolean;
}

/** What a key does to a form (formKey). */
export type FormAction =
  | { readonly act: "move"; readonly to: number }
  | { readonly act: "submit" }
  | { readonly act: "cancel" }
  | { readonly act: "press" }
  | { readonly act: "step"; readonly by: 1 | -1 }
  | { readonly act: "flip" }
  | { readonly act: "open"; readonly typed: string }
  | { readonly act: "clear" }
  | { readonly act: "type" }
  | { readonly act: "none" };

/** A hint line's entry: the key, what it does. */
export type FormHint = readonly [key: string, what: string];

/** formHints' words: the platform's submit chord, and what submitting and cancelling are called. */
export interface FormHintOptions {
  readonly mac?: boolean;
  readonly submit?: string;
  readonly cancel?: string;
}

/** The key context forms bind tab in, and the actions it becomes. */
export const FORM_CONTEXT = "Form";
export const TAB = "form::tab";
export const TAB_BACK = "form::tab_back";

/** The context a root adds while a form has its keyboard (tabActions' `open`). */
export const FORM_OPEN = "FormOpen";

let bound = false;

/** Binds tab / shift-tab inside forms, ctrl-tab / ctrl-shift-tab in their fields and open forms (the keymap is the app's: once is enough). Not from render. */
export function bindTab(cx: Context): void {
  if (bound) return;

  try {
    cx.bind_keys([
      { keystroke: "tab", action: TAB, context: FORM_CONTEXT },
      { keystroke: "shift-tab", action: TAB_BACK, context: FORM_CONTEXT },
      ...[`${FORM_CONTEXT} > Input`, FORM_OPEN].flatMap((context) => [
        { keystroke: "ctrl-tab", action: TAB, context },
        { keystroke: "ctrl-shift-tab", action: TAB_BACK, context },
      ]),
    ]);
    bound = true;
  } catch {
    // The key handler still tries.
  }
}

/** The key event a bound tab stands for. */
export const tabEvent = (shift: boolean): KeyEvent => ({
  key: "tab",
  keystroke: shift ? "shift-tab" : "tab",
  modifiers: { shift, control: false, alt: false, platform: false, function: false },
});

/**
 * A form's root: the context tab is bound in, its actions handed to `key(event, cx)` as the tab key.
 * `open`: a form has the keyboard here, so ctrl-tab moves from any stop (a pane that shows a form
 * only at times says when; without it ctrl-tab moves from a text field only).
 */
export function tabActions(el: Element, key: (event: KeyEvent, cx: Context) => void, open = false): Element {
  return el.key_context(open ? `${FORM_CONTEXT} ${FORM_OPEN}` : FORM_CONTEXT)
    .on_action(TAB, (_e, cx) => key(tabEvent(false), cx))
    .on_action(TAB_BACK, (_e, cx) => key(tabEvent(true), cx));
}

/** The submit chord's name: ⌘enter on macOS, ctrl-enter elsewhere. */
export const chord = (mac: boolean): string => (mac ? "⌘enter" : "ctrl-enter");

/** Stop `at` moved by `by`, wrapping at both ends (0 in an empty form). */
export function wrap(n: number, at: number, by: number): number {
  return n ? (((at + by) % n) + n) % n : 0;
}

/** The next (`down`) or previous stop. */
const vertical = (n: number, at: number, k: string): FormAction => ({ act: "move", to: wrap(n, at, k === "down" ? 1 : -1) });

/** What a key does on a choice or a multi: step (a choice's ← →), open the list, empty it, filter it. */
function listKey(kind: "choice" | "multi", k: string, char: string | null): FormAction {
  if (kind === "choice" && (k === "left" || k === "right")) return { act: "step", by: k === "right" ? 1 : -1 };

  if (k === "space" || k === "right") return { act: "open", typed: "" };

  if (k === "backspace" || k === "delete") return { act: "clear" };

  const typed = char ?? (k.length === 1 ? k : null);

  if (typed && typed.length === 1 && typed.trim()) return { act: "open", typed };

  return { act: "none" };
}

/** What a key does on a button: enter or space press it, ← → go along the row of buttons. */
function buttonKey(stops: readonly Stop[], at: number, k: string): FormAction {
  if (k === "enter" || k === "space") return { act: "press" };

  if (k === "left" || k === "right") {
    // Along the row of buttons, wrapping inside it.
    const row = stops.flatMap((x, i) => (x.kind === "button" ? [i] : []));

    return { act: "move", to: row[wrap(row.length, row.indexOf(at), k === "right" ? 1 : -1)] ?? at };
  }

  return { act: "none" };
}

/**
 * What key `k` (GPUI's name: "tab", "enter", "a"…) with modifiers `m` does
 * on stop `at`. `char`: what it types (the event's key_char). Returns
 *   { act: "move", to }   the keyboard to stop `to`
 *   { act: "submit" } | { act: "cancel" } | { act: "press" } (the button at `at`)
 *   { act: "step", by }   a choice's next (1) / previous (-1) value
 *   { act: "flip" }       a toggle
 *   { act: "open", typed } a list field's list, filtered by `typed`
 *   { act: "clear" }      a list field emptied
 *   { act: "type" }       the focused input's (let it through)
 *   { act: "none" }       the form's, nothing to do
 *   null                  not the form's (an app chord)
 */
export function formKey(stops: readonly Stop[], at: number, k: string, m: FormModifiers = {}, char: string | null = null): FormAction | null {
  const n = stops.length;
  const s = stops[at];

  if (k === "enter" && (m.platform || m.control)) return { act: "submit" };

  if (m.platform || m.alt) return null;

  if (k === "escape") return { act: "cancel" };

  if (k === "tab") return { act: "move", to: wrap(n, at, m.shift ? -1 : 1) };

  if (!s) return k === "enter" ? { act: "submit" } : null;

  const vertically = k === "up" || k === "down";

  if (s.kind === "text") return k === "enter" ? { act: "submit" } : vertically ? vertical(n, at, k) : { act: "type" };

  if (s.kind === "area") return { act: "type" };

  if (m.control) return null;

  if (vertically) return vertical(n, at, k);

  if (s.kind === "button") return buttonKey(stops, at, k);

  if (k === "enter") return { act: "submit" };

  if (s.kind === "toggle") return k === "space" || k === "left" || k === "right" ? { act: "flip" } : { act: "none" };

  return listKey(s.kind, k, char);
}

/** The key that submits from stop `at`: enter, or the chord where enter is a new line or presses another button. */
export function submitKey(stops: readonly Stop[], at: number, mac: boolean): string {
  const s = stops[at];

  return s?.kind === "area" || (s?.kind === "button" && !s.submit) ? chord(mac) : "enter";
}

/** What the focused stop takes, for the hint line. */
function ownHints(s: Stop | undefined): readonly FormHint[] {
  switch (s?.kind) {
    case "choice": return [["← →", "change"], ["type", "filter"]];
    case "multi": return [["space", "pick"], ["type", "filter"]];
    case "toggle": return [["space", "on / off"]];
    case "area": return [["enter", "new line"]];
    case "button": return s.submit ? [] : [["enter", "press"]];
    default: return [];
  }
}

/** The hint line: moving, what the focused stop takes, submitting, cancelling. */
export function formHints(stops: readonly Stop[], at: number, options: FormHintOptions = {}): FormHint[] {
  const { mac = false, submit = "submit", cancel = "cancel" } = options;

  // A text area's tab is an indent: it says the chord that leaves it.
  const move: FormHint = stops[at]?.kind === "area" ? [mac ? "⌃tab ⌃⇧tab" : "ctrl-tab ctrl-shift-tab", "move"] : ["tab ⇧tab", "move"];

  return [move, ...ownHints(stops[at]), [submitKey(stops, at, mac), submit], ["esc", cancel]];
}

/** The focus ring: a 1 px accent edge over the stop (rounded by `radius`). */
export function ring(el: Element, on: boolean, color: Color, radius = 0): Element {
  const at = el.relative();

  return on ? at.child(div().absolute().inset_0().rounded(radius).border(1).border_color(color)) : at;
}
