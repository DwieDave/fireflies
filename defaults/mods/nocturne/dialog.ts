// Fireflies' own dialogs in Nocturne's look: square, 1-bit, a title over a
// dithered horizon line. The layout's prompt_mod and confirm_mod (DwieDave
// fork) open this mod with the shipped dialogs' props plus `dialog`:
//   prompt   { title, value, hint, command }  a name (rename tab / space);
//            Enter saves (runs command with { name }), Esc cancels; Tab /
//            Shift-Tab go name → cancel → save, wrapping, ← → between the
//            buttons, Enter (or Space) presses the focused one, cmd-enter
//            saves from anywhere
//   confirm  { title, detail, command }       before something destructive;
//            Enter confirms (runs command), Esc keeps; Tab / ← → / h l move
//            between keep and confirm (confirm first), Enter / Space press,
//            y confirms, n keeps
// Both take their keys the way every form does (form-keys.ts) and name them
// in the button row.
// Colors from theme() only.

import { div } from "gpui-kit";
import type { ClickEvent, Color, Context, Element, FocusHandle, KeyEvent, MouseButtonEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme, window as appWindow } from "herdr";
import type { Theme } from "herdr";
import { isString, object } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import { isJsonObject } from "./guards.ts";
import { dither, tracked } from "./kit.ts";
import { formKey, formHints, bindTab, tabActions } from "./form-keys.ts";
import type { FormHint, Stop } from "./form-keys.ts";

const stop = (_e: MouseButtonEvent, cx: Context) => cx.stop_propagation();
const cap = (s: string | undefined) => (s ?? "").replace(/^./, (c) => c.toUpperCase());

/** The command a dialog runs: its name and arguments (the prompt adds { name }). */
const isCommand = object({ name: isString }, { args: isJsonObject });

/** The props Fireflies opens the dialogs with (the shipped dialogs' own). */
const isDialogProps = object({}, { title: isString, value: isString, hint: isString, detail: isString, command: isCommand, overlay: isString });

type DialogProps = Guarded<typeof isDialogProps>;

/** This dialog's props, proven (else none). */
const dialogProps = (): DialogProps => {
  const p = props();

  return isDialogProps(p) ? p : {};
};

/** Closes this dialog's overlay. */
const closeMe = (): void => {
  const id = dialogProps().overlay;

  if (id) closeOverlay(id);
};

/** The title row: the words, "esc" at the right, the horizon under it. */
function titleRow(t: Theme, title: string): Element {
  return h_flex().relative().h(34).flex_none().px(14).items_center()
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(title))
    .child(div().text_size(11).text_color(t.dim).child("esc"))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
}

/** A square button: `strong` fills on hover in its color, the other is a quiet
 *  chip. `focused` (the keyboard's) looks hovered, edged in the accent. */
function button(t: Theme, id: string, label: string, color: Color, strong: boolean, action: () => void, focused = false): Element {
  return div().id(id).flex_none().h(24).px(10).flex().items_center().text_size(11)
    .border(1).border_color(focused ? (strong ? color : t.accent) : strong ? color : t.ansi0).text_color(strong ? color : t.muted)
    .when(focused, (el) => (strong ? el.bg(color).text_color(t.background) : el.text_color(t.foreground).bg(t.ansi0)))
    .hover((s) => (strong ? s.bg(color).text_color(t.background) : s.text_color(t.foreground).bg(t.ansi0)))
    .on_mouse_down("left", stop)
    .on_click((_e: ClickEvent, cx: Context) => {
      cx.stop_propagation();
      action();
    })
    .child(label);
}

const mac = () => appWindow().platform === "macos";

/** The keys, named on the left of the button row (the dialog keeps its height). */
function hintLine(t: Theme, hs: readonly FormHint[]): Element {
  return h_flex().flex_1().min_w(0).gap(8).items_center().text_size(10).overflow_hidden()
    .children(hs.map(([k, w], i) => h_flex().id(`dh-${i}`).flex_none().gap(4).child(div().text_color(t.accent).child(k)).child(div().text_color(t.dim).child(w))));
}

function frame(t: Theme, id: string): Element {
  return v_flex().id(id).w_full().min_h(0).bg(t.background).border(1).border_color(t.ansi0).text_color(t.foreground);
}

/** The prompt's stops. */
type PromptAt = "input" | "cancel" | "save";

// The prompt's stops in tab order (form-keys.ts).
const PROMPT: readonly (Stop & { readonly id: PromptAt })[] = [{ id: "input", kind: "text" }, { id: "cancel", kind: "button" }, { id: "save", kind: "button", submit: true }];

/** The confirm's buttons. */
type ConfirmAt = "go" | "keep";

// The confirm's: confirm first (it has the keyboard when the dialog opens).
const CONFIRM: readonly (Stop & { readonly id: ConfirmAt })[] = [{ id: "go", kind: "button", submit: true }, { id: "keep", kind: "button" }];

export class Prompt {
  input: InputState | null = null;
  handle: FocusHandle | null = null;
  at: PromptAt = "input"; // the keyboard's

  init(_props: Props | undefined, cx: Context): void {
    const value = dialogProps().value ?? "";
    const input = InputState.new({ value, placeholder: "name" });

    this.input = input;

    if (value) input.set_selected_range({ start: 0, end: value.length });

    input.on("submit", () => this.save());
    input.focus();
    // The overlay takes focus once it's shown; take it back.
    cx.timer.after(600, () => {
      if (this.at === "input") input.focus();
    });
    this.handle = cx.focus_handle();
    bindTab(cx); // tab / shift-tab reach the key handler (form-keys.ts)
    this.at = "input";
  }

  close(): void {
    closeMe();
  }

  /** The keys the dialog takes before the name field (form-keys.ts):
   *  moving between the field and the buttons, and pressing a button. */
  key(e: KeyEvent, cx: Context): void {
    const at = PROMPT.findIndex((s) => s.id === this.at);
    const a = formKey(PROMPT, at, e.key, e.modifiers, e.key_char ?? null);

    // The field's own: letters, and a plain enter (its "submit" saves).
    if (!a || a.act === "type" || (a.act === "submit" && this.at === "input" && !e.modifiers.platform && !e.modifiers.control)) return;

    const go = (i: number) => {
      this.at = PROMPT[i]?.id ?? "input";

      if (this.at === "input") this.input?.focus();
      else this.handle?.focus();
    };

    if (a.act === "cancel") this.close();
    else if (a.act === "move") go(a.to);
    else if (a.act === "submit" || (a.act === "press" && this.at === "save")) this.save();
    else if (a.act === "press") this.close();
    else if (this.at !== "input" && (e.key === "h" || e.key === "l")) go(PROMPT.findIndex((s) => s.id === (this.at === "save" ? "cancel" : "save")));

    cx.stop_propagation();
    cx.notify();
  }

  save(): void {
    const command = dialogProps().command;

    this.close();

    if (command) run(command.name, { ...command.args, name: this.input?.value().trim() ?? "" });
  }

  render(): Element {
    const t = theme();
    const p = dialogProps();
    const input = this.input;

    return tracked(frame(t, "nocturne-prompt"), this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .map((el) => tabActions(el, (e, cx) => this.key(e, cx)))
      .child(titleRow(t, cap(p.title)))
      .child(v_flex().px(14).pt(12).pb(12).gap(6)
        .child(div().h(26).px(6).flex().items_center().border(1).border_color(this.at === "input" ? t.accent : t.ansi0).bg(t.background)
          .on_mouse_down("left", stop)
          .when(Boolean(input), (el) => (input ? el.child(Input.new(input).flex_1().h_full().text_size(12).text_color(t.foreground)) : el)))
        .when(Boolean(p.hint), (el) => el.child(div().text_size(11).text_color(t.dim).child(p.hint ?? "")))
        .child(h_flex().pt(6).gap(6).items_center()
          .child(hintLine(t, formHints(PROMPT, PROMPT.findIndex((s) => s.id === this.at), { mac: mac(), submit: "save" })))
          .child(button(t, "pm-cancel", "cancel", t.muted, false, () => this.close(), this.at === "cancel"))
          .child(button(t, "pm-save", "save", t.accent, true, () => this.save(), this.at === "save"))));
  }
}

export class Confirm {
  handle: FocusHandle | null = null;
  at: ConfirmAt = "go"; // the keyboard's button: "go" (confirm) | "keep"

  init(_props: Props | undefined, cx: Context): void {
    const handle = cx.focus_handle();

    this.handle = handle;
    bindTab(cx); // tab / shift-tab reach the key handler (form-keys.ts)
    handle.focus();
    // The overlay takes focus once it's shown; take it back.
    cx.timer.after(600, () => handle.focus());
    this.at = "go";
  }

  key(e: KeyEvent, cx: Context): void {
    const k = e.key;
    const m = e.modifiers;
    const a = formKey(CONFIRM, CONFIRM.findIndex((s) => s.id === this.at), k, m, e.key_char ?? null);

    if (!a) return;

    const plain = !m.control && !m.shift;

    if (plain && k === "y") this.yes();
    else if (plain && k === "n") this.close();
    else if (plain && (k === "h" || k === "l")) this.at = this.at === "go" ? "keep" : "go";
    else if (a.act === "move") this.at = CONFIRM[a.to]?.id ?? "go";
    else if (a.act === "submit" || (a.act === "press" && this.at === "go")) this.yes();
    else if (a.act === "cancel" || a.act === "press") this.close();
    else return;

    cx.stop_propagation();
    cx.notify();
  }

  close(): void {
    closeMe();
  }

  yes(): void {
    const command = dialogProps().command;

    this.close();

    if (command) run(command.name, command.args ?? {});
  }

  render(): Element {
    const t = theme();
    const p = dialogProps();

    // Destructive: a red edge down the left, like the sidebar's inline confirms.
    return tracked(frame(t, "nocturne-confirm").relative(), this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .map((el) => tabActions(el, (e, cx) => this.key(e, cx)))
      .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.blocked))
      .child(titleRow(t, p.title ?? "Are you sure?"))
      // As tall as its words (the dialog fits its content), scrolling past 240 px.
      .child(div().id("confirm-detail").max_h(240).px(14).pt(10).overflow_y_scrollbar()
        .text_size(11).line_height("17px").text_color(t.muted).child(p.detail ?? ""))
      .child(h_flex().px(14).pb(12).pt(6).gap(6).items_center()
        .child(hintLine(t, formHints(CONFIRM, CONFIRM.findIndex((s) => s.id === this.at), { mac: mac(), submit: "confirm", cancel: "keep" })))
        .child(button(t, "cf-keep", "keep", t.muted, false, () => this.close(), this.at === "keep"))
        .child(button(t, "cf-go", "confirm", t.blocked, true, () => this.yes(), this.at === "go")));
  }
}
