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

import { div } from "gpui-kit";

const LIST = new Set(["choice", "multi"]);

/** The key context forms bind tab in, and the actions it becomes. */
export const FORM_CONTEXT = "Form";
export const TAB = "form::tab", TAB_BACK = "form::tab_back";

let bound = false;
/** Binds tab / shift-tab inside forms (the keymap is the app's: once is enough). Not from render. */
export function bindTab(cx) {
  if (bound) return;
  try {
    cx.bind_keys([
      { keystroke: "tab", action: TAB, context: FORM_CONTEXT },
      { keystroke: "shift-tab", action: TAB_BACK, context: FORM_CONTEXT },
    ]);
    bound = true;
  } catch { /* the key handler still tries */ }
}

/** The key event a bound tab stands for. */
export const tabEvent = (shift) => ({ key: "tab", keystroke: shift ? "shift-tab" : "tab", key_char: null, modifiers: { shift, control: false, alt: false, platform: false, function: false } });

/** A form's root: the context tab is bound in, its actions handed to `key(event, cx)` as the tab key. */
export function tabActions(el, key) {
  return el.key_context(FORM_CONTEXT)
    .on_action(TAB, (_e, cx) => key(tabEvent(false), cx))
    .on_action(TAB_BACK, (_e, cx) => key(tabEvent(true), cx));
}

/** The submit chord's name: ⌘enter on macOS, ctrl-enter elsewhere. */
export const chord = (mac) => (mac ? "⌘enter" : "ctrl-enter");

/** Stop `at` moved by `by`, wrapping at both ends. */
export function wrap(n, at, by) {
  return n ? (((at + by) % n) + n) % n : 0;
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
 *   null                  not the form's (an app chord)
 */
export function formKey(stops, at, k, m = {}, char = null) {
  const n = stops.length;
  const s = stops[at];
  const kind = s?.kind;
  if (k === "enter" && (m.platform || m.control)) return { act: "submit" };
  if (m.platform || m.alt) return null;
  if (k === "escape") return { act: "cancel" };
  if (k === "tab") return { act: "move", to: wrap(n, at, m.shift ? -1 : 1) };
  if (!s) return k === "enter" ? { act: "submit" } : null;
  if (kind === "text" || kind === "area") {
    if (kind === "text" && k === "enter") return { act: "submit" };
    if (kind === "text" && (k === "up" || k === "down")) return { act: "move", to: wrap(n, at, k === "down" ? 1 : -1) };
    return { act: "type" };
  }
  if (m.control) return null;
  if (k === "up" || k === "down") return { act: "move", to: wrap(n, at, k === "down" ? 1 : -1) };
  if (kind === "button") {
    if (k === "enter" || k === "space") return { act: "press" };
    if (k === "left" || k === "right") {
      // Along the row of buttons, wrapping inside it.
      const row = stops.map((x, i) => (x.kind === "button" ? i : -1)).filter((i) => i >= 0);
      return { act: "move", to: row[wrap(row.length, row.indexOf(at), k === "right" ? 1 : -1)] };
    }
    return { act: "none" };
  }
  if (k === "enter") return { act: "submit" };
  if (kind === "toggle") return k === "space" || k === "left" || k === "right" ? { act: "flip" } : { act: "none" };
  if (LIST.has(kind)) {
    if (kind === "choice" && (k === "left" || k === "right")) return { act: "step", by: k === "right" ? 1 : -1 };
    if (k === "space" || k === "right") return { act: "open", typed: "" };
    if (k === "backspace" || k === "delete") return { act: "clear" };
    const typed = char ?? (k.length === 1 ? k : null);
    if (typed && typed.length === 1 && typed.trim()) return { act: "open", typed };
  }
  return { act: "none" };
}

/** The key that submits from stop `at`: enter, or the chord where enter is a new line or presses another button. */
export function submitKey(stops, at, mac) {
  const s = stops[at];
  return s?.kind === "area" || (s?.kind === "button" && !s.submit) ? chord(mac) : "enter";
}

/** The hint line: moving, what the focused stop takes, submitting, cancelling. */
export function formHints(stops, at, { mac = false, submit = "submit", cancel = "cancel" } = {}) {
  const s = stops[at];
  const own = {
    choice: [["← →", "change"], ["type", "filter"]],
    multi: [["space", "pick"], ["type", "filter"]],
    toggle: [["space", "on / off"]],
    area: [["enter", "new line"]],
    button: s && !s.submit ? [["enter", "press"]] : [],
  }[s?.kind] ?? [];
  return [["tab ⇧tab", "move"], ...own, [submitKey(stops, at, mac), submit], ["esc", cancel]];
}

/** The focus ring: a 1 px accent edge over the stop (rounded by `radius`). */
export function ring(el, on, color, radius = 0) {
  return el.relative().when(on, (e) => e.child(div().absolute().inset_0().rounded(radius).border(1).border_color(color)));
}
