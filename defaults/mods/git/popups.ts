// lazygit's popups in Nocturne's frame: menus (the ? keybindings menu, the
// right-click menus, every "…options" menu), confirms (red for destructive
// ones), prompts and the commit message (summary + description). One popup
// at a time over the window, on a dithered scrim; esc closes it.
//
// The confirm and the commit message are forms (form-keys.ts): tab /
// shift-tab walk their stops (a confirm's checks, then its buttons; the
// summary, the description, commit, cancel), wrapping; the focused one wears
// the accent ring; enter submits from a one-line field and presses a
// focused button, cmd-enter (ctrl-enter) commits from anywhere, esc cancels.

import { Array as Arr, Option, String as Str } from "effect";
import { div } from "gpui-kit";
import type { Color, Context, Element, KeyEvent } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import type { Theme } from "herdr";
import { window as appWindow } from "herdr";
import type { PopupHost, MenuItem, Suggestion, KeysOptions, MenuOptions, ConfirmOptions, PromptOptions, CommitOptions, Popup, ConfirmPopup, PromptPopup, CommitPopup, FormPopup, Size, FrameOptions } from "./popup-types.ts";
import { dither, ink, isDithered, stop, edgeRow, popupScrim } from "./draw.ts";
import { CARD_HEAD, button, frameBox, heading, menuBox } from "@fireflies/look";
import { keyLabel } from "./keys.ts";
import type { FormModifiers, Stop } from "@fireflies/form-keys";
import { formKey, formHints, ring } from "@fireflies/form-keys";
import type { KeyRow } from "@fireflies/keyhelp";
import { keysView, keysKey } from "@fireflies/keyhelp";
import { placeMenu } from "@fireflies/menu-place";
import { edge as edgeTone } from "@fireflies/tones";

export type { PopupHost, MenuItem, Check, Line, Suggestion, KeysOptions, MenuOptions, ConfirmOptions, PromptOptions, CommitOptions } from "./popup-types.ts";

const mac = () => appWindow().platform === "macos";

/** A chosen row (a menu's, a suggestion's): nocturne's dithered band with its accent edge, or the selected fill, rounded. */
function chosen(t: Theme, row: Element): Element {
  if (!isDithered()) return row.rounded(6).bg(t.selected);

  return row.child(dither(edgeTone(t), 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent));
}

/** An input's box: square in nocturne, rounded in a plain layout. */
const inputBox = (el: Element): Element => (isDithered() ? el : el.rounded(6));

/** An input's edge off focus: nocturne's edge tone, or the input border. */
const fieldEdge = (t: Theme): Color => (isDithered() ? edgeTone(t) : t.input);

/** A menu entry's text color: a dangerous one red, an unavailable one dim, the selected one bright. */
function itemInk(t: Theme, it: { readonly danger?: boolean; readonly off?: boolean }, sel: boolean): Color {
  if (it.danger === true) return t.ansi1;

  if (it.off === true) return t.dim;

  return sel ? t.foreground : t.muted;
}

/** A key as keyName() writes it ("shift-tab", "ctrl-enter", "a") as form-keys.ts takes it: the key and its modifiers. */
function split(k: string): [string, FormModifiers] {
  let shift = false, control = false, platform = false;
  let key = k;

  for (let r = /^(ctrl|shift|cmd)-(.+)$/.exec(key); r?.[2] !== undefined; r = /^(ctrl|shift|cmd)-(.+)$/.exec(key)) {
    if (r[1] === "ctrl") control = true;
    else if (r[1] === "shift") shift = true;
    else platform = true;

    key = r[2];
  }

  return [key, { ...(shift ? { shift } : null), ...(control ? { control } : null), ...(platform ? { platform } : null) }];
}

// A menu's row, and the options bar under the body (draw.ts hints) menus stay clear of.
const ROW = 20, OPTIONS_BAR = 22;


export class Popups {
  readonly v: PopupHost;
  top: Popup | null = null;

  constructor(v: PopupHost) { this.v = v; }

  get open() { return this.top !== null; }

  get kind() { return this.top?.kind ?? null; }

  close() {
    const p = this.top;

    this.top = null;

    if (p?.kind === "prompt") p.input.release();
    else if (p?.kind === "commit") {
      p.input.release();
      p.desc.release();
    }

    this.v.focusSelf();
  }

  /** ?: every key here as keyhelp.ts's overview, over the window; its rows
   *  run as a menu's do (j k enter, or a row's own key). `sections`:
   *  [{ title, keys: [[label, words, go], ...] }] with `.key` and `.danger` on a row. */
  keys(o: KeysOptions) {
    const rows = Arr.flatMap(o.sections, (s) => s.keys);

    this.top = { kind: "keys", title: o.title, sections: o.sections, rows, sel: 0 };
  }

  menu(o: MenuOptions) {
    const { title, items, at = null, empty = null } = o;

    this.top = { kind: "menu", title, items, sel: Option.getOrElse(Arr.findFirstIndex(items, (x) => x.off !== true), () => 0), at, empty };
  }

  /** `lines`: more to say, as [text, color] (colors by theme name);
   *  `checks`: toggles [{ key, label, on }], their own key flips one, and
   *  go(cx, checks) gets them. */
  confirm(o: ConfirmOptions) {
    const { title, text, danger = false, go = null, error = false, lines = [], checks = [] } = o;

    this.top = { kind: "confirm", title, text, danger, go, error, lines, checks, at: 0 };
  }

  /** The open popup when it's a form (a confirm, the commit message). */
  form(): FormPopup | null {
    const p = this.top;

    return p?.kind === "confirm" || p?.kind === "commit" ? p : null;
  }

  /** A form popup's stops in tab order (form-keys.ts); `at` is the focused one. */
  stops(p: Popup | null = this.top): Stop[] {
    if (p?.kind === "confirm") {
      return [
        ...Arr.map(p.checks, (_, i): Stop => ({ id: `cf-c-${i}`, kind: "toggle" })),
        { id: "cf-yes", kind: "button", submit: true },
        ...(p.error ? [] : [{ id: "cf-no", kind: "button" } satisfies Stop]),
      ];
    }

    if (p?.kind === "commit") return [{ id: "cm-sum", kind: "text" }, { id: "cm-desc", kind: "area" }, { id: "cm-ok", kind: "button", submit: true }, { id: "cm-no", kind: "button" }];

    return [];
  }

  /** The hint line of a form popup: tab, what the focused stop takes, and the submit / cancel buttons. */
  hints(form: FormPopup | null = this.form()) {
    const p = form;

    if (p === null) return [];

    const submit = p.kind === "commit" ? "commit" : p.error ? "close" : p.danger ? "yes, do it" : "confirm";
    const cancel = p.kind === "commit" && p.draft ? "keep draft" : "cancel";
    const hs = formHints(this.stops(p), p.at, { mac: mac(), submit, cancel });

    return p.kind === "confirm" && p.error ? Arr.flatMap(hs, ([k, w]) => (k === "esc" ? [] : [[k, k === "enter" ? submit : w] as const])) : hs;
  }

  /** `note`: a line under the input; `suggest(text)`: completions to pick
   *  ([{ value, sub? }]): ↑↓ pick one, tab puts it in, enter takes it. */
  prompt(o: PromptOptions) {
    const { title, value = "", placeholder = "", ok, history = null, note = null, suggest = null } = o;
    const input = InputState.new({ placeholder, value });

    input.on("submit", (_e, cx) => this.submit(cx));

    const p: PromptPopup = { kind: "prompt", title, input, ok, history, hi: -1, note, suggest, pick: -1 };

    if (suggest !== null && suggest !== undefined) {
      input.on("change", (_e, cx) => {
        if (this.top === p) {
          p.pick = -1;
          cx.notify();
        }
      });
    }

    this.top = p;
    this.focusLater(input);
  }

  /** A prompt's completions for what's typed now. */
  suggestions(p: PromptPopup): readonly Suggestion[] {
    if (p.suggest === null) return [];

    try { return (p.suggest(p.input.value()) ?? []).slice(0, 6); } catch { return []; }
  }

  commit(o: CommitOptions) {
    const { title, value = "", ok, draft = false } = o;
    // The draft (lazygit keeps it): what esc left, when this is a new commit.
    const [summary, ...rest] = Str.split(draft && Str.isEmpty(value) ? this.v.draft ?? "" : value, "\n");
    const input = InputState.new({ placeholder: "summary", value: summary ?? "" });
    const desc = TextareaState.new({ placeholder: "description (optional)", value: Str.replace(/^\n+/, "")(Arr.join(rest, "\n")), rows: 6 });

    input.on("submit", (_e, cx) => this.submit(cx));

    // The description eats cmd-enter as a new line and says so: take it back and commit.
    let before = desc.value(), now = before;

    desc.on("change", () => {
      before = now;
      now = desc.value();
    });
    desc.on("submit", (e, cx) => {
      if (e.secondary !== true) return;

      desc.set_value(before);
      this.submit(cx);
    });
    this.top = { kind: "commit", title, input, desc, ok, at: 0, draft };
    this.focusLater(input);
  }

  focusLater(input: InputState) {
    input.focus();
    this.v.later((cx) => {
      if (this.top?.kind === "prompt" || this.top?.kind === "commit") {
        if (this.top.input === input) input.focus();
      }

      cx.notify();
    });
  }

  /** Enter on a prompt / commit (the input's submit, or the key). */
  submit(cx: Context) {
    const p = this.top;

    if (p === null) return;

    if (p.kind === "prompt") {
      const picked = this.suggestions(p)[p.pick];
      const text = picked === undefined ? p.input.value() : picked.value;

      this.close();
      p.ok(text, cx);
    } else if (p.kind === "commit") {
      const summary = Str.trim(p.input.value());

      if (Str.isEmpty(summary)) return;

      const desc = Str.trim(p.desc.value());

      if (p.draft) this.v.draft = null;

      this.close();
      p.ok(Str.isEmpty(desc) ? summary : `${summary}\n\n${desc}`, cx);
    }

    cx.notify();
  }

  /** The popup's own yes (a command: menu-run, confirm-yes, prompt-ok, commit-ok), wherever its keyboard is. */
  ok(cx: Context) {
    const p = this.top;

    if (p?.kind === "menu") this.runItem(p.items[p.sel], cx);
    else if (p?.kind === "keys") this.runRow(p.rows[p.sel], cx);
    else if (p?.kind === "confirm") this.yes(p, cx);
    else if (p !== null) this.submit(cx);
  }

  /** A key while a popup is open: true when it was used. */
  key(k: string, e: KeyEvent | null, cx: Context) {
    const p = this.top;

    if (p === null) return false;

    switch (p.kind) {
      case "keys": return this.keysPopupKey(p, k, e, cx);
      case "menu": return this.menuKey(p, k, cx);
      case "confirm": return this.confirmKey(p, k, cx);
      case "prompt": return this.promptKey(p, k, cx);
      case "commit": return this.commitKey(p, k, cx);
    }
  }

  /** A key on the ? overview. */
  keysPopupKey(p: Extract<Popup, { kind: "keys" }>, k: string, e: KeyEvent | null, cx: Context) {
    if (keysKey(e ?? { key: k }, true) !== null || k === "escape" || k === "q") this.close();
    else if (k === "j" || k === "down") p.sel = Math.min(p.rows.length - 1, p.sel + 1);
    else if (k === "k" || k === "up") p.sel = Math.max(0, p.sel - 1);
    else if (k === "enter" || k === "space") this.runRow(p.rows[p.sel], cx);
    else {
      Option.map(Arr.findFirst(p.rows, (r) => r.key !== undefined && Str.isNonEmpty(r.key) && r.key === k), (hit) => this.runRow(hit, cx));
    }

    return true;
  }

  /** A key on a menu: j k, enter, an item's own key. */
  menuKey(p: Extract<Popup, { kind: "menu" }>, k: string, cx: Context) {
    const live = Arr.filter(p.items, (x) => x.off !== true);

    if (k === "escape" || k === "q") this.close();
    else if (k === "j" || k === "down") p.sel = Math.min(p.items.length - 1, p.sel + 1);
    else if (k === "k" || k === "up") p.sel = Math.max(0, p.sel - 1);
    else if (k === "enter" || k === "space") this.runItem(p.items[p.sel], cx);
    else {
      // An item's own key runs it, as in lazygit's menus.
      Option.map(Arr.findFirst(live, (x) => x.key !== undefined && Str.isNonEmpty(x.key) && x.key === k), (hit) => this.runItem(hit, cx));
    }

    return true;
  }

  /** A key on a confirm: its checks' keys, y / n, the form's keys. */
  confirmKey(p: ConfirmPopup, k: string, cx: Context) {
    const check = Option.getOrUndefined(Arr.findFirst(p.checks, (c) => c.key === k));

    if (check !== undefined) {
      check.on = !check.on;

      return true;
    }

    if (k === "y") {
      this.yes(p, cx);

      return true;
    }

    if (k === "n" || k === "q") {
      this.close();

      return true;
    }

    const [key, m] = split(k);
    const stops = this.stops(p);
    const a = formKey(stops, p.at, key, m, k.length === 1 ? k : null);

    if (a?.act === "move") p.at = a.to;
    else if (a?.act === "submit" || (a?.act === "press" && stops[p.at]?.id === "cf-yes")) this.yes(p, cx);
    else if (a?.act === "cancel" || a?.act === "press") this.close();
    else if (a?.act === "flip") {
      const c = p.checks[p.at];

      if (c !== undefined) c.on = !c.on;
    }

    return true;
  }

  /** A key on a prompt: suggestions and history on up / down, tab takes one. */
  promptKey(p: PromptPopup, k: string, cx: Context) {
    if (k === "escape") {
      this.close();

      return true;
    }

    if (k === "enter") {
      this.submit(cx);

      return true;
    }

    const sug = this.suggestions(p);

    if (Arr.isReadonlyArrayNonEmpty(sug) && (k === "up" || k === "down")) {
      p.pick = k === "down" ? Math.min(sug.length - 1, p.pick + 1) : Math.max(-1, p.pick - 1);

      return true;
    }

    if (Arr.isReadonlyArrayNonEmpty(sug) && k === "tab") {
      p.input.set_value(sug[Math.max(0, p.pick)]?.value ?? "");
      p.pick = -1;

      return true;
    }

    if (p.history !== null && Arr.isReadonlyArrayNonEmpty(p.history) && (k === "up" || k === "down")) {
      p.hi = Math.max(-1, Math.min(p.history.length - 1, p.hi + (k === "up" ? 1 : -1)));
      p.input.set_value(p.hi < 0 ? "" : p.history[p.hi] ?? "");

      return true;
    }

    return false; // typing goes to the input
  }

  /** A key on the commit message: the form's keys; typing goes to the input. */
  commitKey(p: CommitPopup, k: string, cx: Context) {
  const [key, m] = split(k);
  const stops = this.stops(p);
  const a = formKey(stops, p.at, key, m, k.length === 1 ? k : null);

  if (a === null || a.act === "type") return false; // typing goes to the input

  if (a.act === "move") this.commitGo(p, a.to);
  else if (a.act === "submit" || (a.act === "press" && stops[p.at]?.id === "cm-ok")) this.submit(cx);
  else if (a.act === "cancel" || a.act === "press") this.cancelCommit(p);

  return true;
  }

  /** A confirm's yes (an error's only button closes it). */
  yes(p: ConfirmPopup, cx: Context) {
    this.close();

    if (!p.error) p.go?.(cx, p.checks);
  }

  /** Esc on the commit message: what's typed stays as the draft (a new commit). */
  cancelCommit(p: CommitPopup) {
    if (p.draft) this.v.draft = Arr.join(Arr.filter([p.input.value(), p.desc.value()], (s) => Str.isNonEmpty(Str.trim(s))), "\n\n");

    this.close();
  }

  /** The commit message's keyboard to stop i: a field's input, or the window for a button. */
  commitGo(p: CommitPopup, i: number) {
    p.at = i;

    if (i === 0) p.input.focus();
    else if (i === 1) p.desc.focus();
    else this.v.focusSelf();
  }

  /** A keys row: [label, words, go]. */
  runRow(row: KeyRow | undefined, cx: Context) {
    if (row === undefined) return;

    this.close();
    row[2]?.(cx);
  }

  runItem(item: MenuItem | undefined, cx: Context) {
    if (item === undefined || item.off === true) return;

    this.close();
    item.go?.(cx);
  }

  // ---- drawing

  render(t: Theme, size: Size) {
    const p = this.top;

    if (p === null) return null;

    // The window dims under a popup, lightly (draw.ts POPUP_SCRIM): it stays readable.
    const scrim = popupScrim("git-scrim")
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();

        if (p.kind === "menu" || p.kind === "confirm") this.close();

        cx.notify();
      })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();

        if (p.kind === "menu") this.close();

        cx.notify();
      });

    if (p.kind === "keys") {
      return div().id("git-popup-layer").absolute().inset_0()
        .child(keysView(t, { id: "git-keys", title: p.title, list: p.sections, cursor: p.sel, narrow: size.width < 640,
          pick: (row, cx) => this.runRow(row, cx), close: () => this.close() }));
    }

    const box = this.boxOf(t, p, size);

    return div().id("git-popup-layer").absolute().inset_0().child(scrim).child(box);
  }

  frame(t: Theme, id: string, title: string, w: number, x: number, y: number, body: Element, options: FrameOptions = {}) {
    const { danger = false, right = null } = options;
    const edge = danger ? t.ansi1 : t.accent;

    // Plain: upstream's popover (a menu's box for a menu), its title in a header row.
    if (!isDithered()) {
      const head = h_flex().h(CARD_HEAD + 4).flex_none().px(12).gap(8).items_center().text_size(12.5).border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(danger ? t.ansi1 : t.foreground).child(title))
        .child(right === null ? div() : div().flex_none().text_size(11).text_color(t.dim).child(right));

      const box = v_flex().id(id).absolute().left(x).top(y).w(w).on_mouse_down("left", stop).child(head).child(body);

      return id === "git-menu" ? menuBox(t, box) : frameBox(t, box);
    }

    return v_flex().id(id).absolute().left(x).top(y).w(w).bg(t.background).border_l(1).border_r(1).border_color(edge)
      .on_mouse_down("left", stop)
      .child(body)
      .child(edgeRow(t, `${id}-top`, edge, "top",
        div().min_w(0).max_w(w - (right === null ? 40 : 120)).truncate().text_color(danger ? t.ansi1 : t.foreground).child(title),
        right === null ? null : div().text_color(t.dim).child(right)))
      .child(edgeRow(t, `${id}-bottom`, edge, "bottom", null, null));
  }

  center(size: Size, w: number, h: number) {
    return { x: Math.max(8, Math.round((size.width - w) / 2)), y: Math.max(40, Math.round((size.height - h) / 2.4)) };
  }

  /** The box of a popup other than the keys overview. */
  boxOf(t: Theme, p: Exclude<Popup, { kind: "keys" }>, size: Size): Element {
    switch (p.kind) {
      case "menu": return this.menuBox(t, p, size);
      case "confirm": return this.confirmBox(t, p, size);
      case "prompt": return this.promptBox(t, p, size);
      case "commit": return this.commitBox(t, p, size);
    }
  }

  menuBox(t: Theme, p: Extract<Popup, { kind: "menu" }>, size: Size) {
    const w = Math.min(Math.max(320, ...Arr.map(p.items, (x) => 120 + (x.label?.length ?? 0) * 7 + Math.min(180, (x.sub?.length ?? 0) * 6))), size.width - 24);
    const shown = Math.min(p.items.length || 1, Math.max(4, Math.floor((size.height - 120) / ROW)));
    const first = Math.max(0, Math.min(p.sel - Math.floor(shown / 2), p.items.length - shown));
    const h = shown * ROW + 20;
    // At the press or under the row (menu-place.ts), clear of the options bar; else the middle.
    const { x, y } = p.at !== null ? placeMenu({ width: w, height: h }, { width: size.width, height: size.height - OPTIONS_BAR }, p.at) : this.center(size, w, h);
    const keyW = Math.max(30, ...Arr.map(p.items, (it) => keyLabel(it.key ?? "").length * 7 + 14));

    const rows = Arr.map(Arr.take(Arr.drop(p.items, first), shown), (it, n) => {
      const i = first + n, sel = i === p.sel;

      if (it.section !== undefined) {
        return h_flex().id(`mi-${i}`).h(ROW).px(10).items_center().text_size(10).text_color(t.muted).child(isDithered() ? Str.toUpperCase(it.section) : heading(t, it.section));
      }

      const row = h_flex().id(`mi-${i}`).relative().h(ROW).px(10).gap(10).items_center().text_size(11)
        .text_color(it.off === true ? t.dim : (sel ? t.foreground : t.muted))
        .hover((s) => s.bg(`${edgeTone(t)}66`))
        .on_mouse_move((_e, cx) => {
          if (p.sel !== i && it.off !== true) {
            p.sel = i;
            cx.notify();
          }
        })
        .on_click((_e, cx) => { cx.stop_propagation(); this.runItem(it, cx); cx.notify(); });

      const marked = sel ? chosen(t, row) : row;

      const labelled = marked
        .child(div().relative().w(keyW).flex_none().text_color(t.accent).child(keyLabel(it.key ?? "")))
        .child(div().relative().flex_1().min_w(0).truncate().text_color(itemInk(t, it, sel)).child(it.label));

      return it.sub === undefined || it.sub === null || Str.isEmpty(it.sub) ? labelled : labelled.child(div().relative().flex_none().max_w(200).truncate().text_color(t.dim).child(it.sub));
    });

    const body = v_flex().pt(10).pb(6).children(Arr.isReadonlyArrayNonEmpty(rows) ? rows : [div().px(12).py(4).text_size(11).text_color(t.dim).child(p.empty ?? "Nothing here.")]);

    return this.frame(t, "git-menu", p.title, w, x, y, body, { right: p.items.length > shown ? `${p.sel + 1} of ${p.items.length}` : null });
  }

  confirmBox(t: Theme, p: ConfirmPopup, size: Size) {
    const w = Math.min(560, size.width - 24);
    const { x, y } = this.center(size, w, 110 + p.lines.length * 18 + p.checks.length * 20);

    const text = v_flex().px(12).pt(14).pb(10).gap(12).text_size(12)
      .child(div().text_color(p.error ? t.ansi1 : t.foreground).child(p.text));

    const lined = Arr.isReadonlyArrayNonEmpty(p.lines) ? text.child(v_flex().gap(3).text_size(11)
      .children(Arr.map(p.lines, ([s, c], i) => div().id(`cf-l-${i}`).text_color(ink(t, c ?? "muted")).child(s)))) : text;

    const checked = Arr.isReadonlyArrayNonEmpty(p.checks) ? lined.child(v_flex().gap(2).text_size(11)
      .children(Arr.map(p.checks, (c, i) => ring(h_flex().id(`cf-c-${i}`).px(4).gap(8).items_center().hover((s) => s.bg(`${edgeTone(t)}66`)), p.at === i, t.accent)
        .on_click((_e, cx) => { cx.stop_propagation(); p.at = i; c.on = !c.on; cx.notify(); })
        .child(div().w(18).text_color(t.accent).child(c.key))
        .child(div().text_color(c.on ? t.foreground : t.dim).child(c.on ? "[x]" : "[ ]"))
        .child(div().text_color(c.on || p.at === i ? t.foreground : t.muted).child(c.label))))) : lined;

    const body = checked.child(this.hintRow(t, p, (cx) => this.yes(p, cx), () => this.close()));

    return this.frame(t, "git-confirm", p.title, w, x, y, body, { danger: p.danger || p.error });
  }

  /** A form popup's hint line: each key and its word, the submit and cancel
   *  ones as buttons (`yes`, `no`) that tab reaches and the ring marks. */
  hintRow(t: Theme, p: FormPopup, yes: (cx: Context) => void, no: (cx: Context) => void) {
    const stops = this.stops(p);
    const ids = Arr.flatMap(stops, (s) => (s.kind === "button" ? [s.id] : [])); // [submit, cancel]
    const hs = this.hints(p);
    const on = stops[p.at]?.id;

    return h_flex().gap(10).text_size(11).items_center().children(Arr.map(hs, ([k, w], i) => {
      const id = i === hs.length - (ids.length === 2 ? 2 : 1) ? ids[0] : ids.length === 2 && i === hs.length - 1 ? ids[1] : undefined;
      const pair = h_flex().gap(5).items_center().child(div().relative().text_color(t.accent).child(k)).child(div().relative().text_color(id !== undefined && on === id ? t.foreground : t.dim).child(w));

      if (id === undefined || Str.isEmpty(id)) return pair.id(`hint-${i}`);

      const go = id === ids[0] ? yes : no;

      if (!isDithered()) {
        // Plain: upstream's raised buttons, the focused one ringed in the accent.
        return ring(button(t, pair.id(id).h(26).px(10)), on === id, t.accent)
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); go(cx); cx.notify(); });
      }

      const pressed = ring(pair.id(id).h(18).px(4).hover((s) => s.bg(`${edgeTone(t)}66`)), on === id, t.accent);

      return (on === id ? pressed.bg(edgeTone(t)) : pressed)
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); go(cx); cx.notify(); });
    }));
  }

  promptBox(t: Theme, p: PromptPopup, size: Size) {
    const w = Math.min(560, size.width - 24);
    const sug = this.suggestions(p);
    const { x, y } = this.center(size, w, 90 + sug.length * ROW + (p.note === null ? 0 : 18));
    const keyPair = (key: string, what: string) => h_flex().gap(5).child(div().text_color(t.accent).child(key)).child(div().text_color(t.dim).child(what));

    const field = v_flex().px(12).pt(14).pb(10).gap(8)
      .child(inputBox(div().border(1).border_color(t.accent).px(6).h(26).flex().items_center())
        .child(Input.new(p.input).w_full().text_size(12).text_color(t.foreground)));

    const noted = p.note === null ? field : field.child(div().text_size(11).text_color(t.muted).child(p.note));

    const listed = sug.length > 0 ? noted.child(v_flex().children(Arr.map(sug, (s, i) => {
      const row = h_flex().id(`ps-${i}`).relative().h(ROW).px(6).gap(10).items_center().text_size(11)
        .hover((st) => st.bg(`${edgeTone(t)}66`))
        .on_click((_e, cx) => { cx.stop_propagation(); p.pick = i; this.submit(cx); cx.notify(); });

      const marked = i === p.pick ? chosen(t, row) : row;
      const valued = marked.child(div().relative().flex_1().min_w(0).truncate().text_color(i === p.pick ? t.foreground : t.muted).child(s.value));

      return s.sub === undefined || s.sub === null || Str.isEmpty(s.sub) ? valued : valued.child(div().relative().flex_none().text_color(t.dim).child(s.sub));
    }))) : noted;

    const keys = h_flex().gap(16).text_size(11).child(keyPair("enter", "confirm")).child(keyPair("esc", "cancel"));
    const withHistory = p.history !== null && Arr.isReadonlyArrayNonEmpty(p.history) ? keys.child(keyPair("↑↓", "history")) : keys;
    const body = listed.child(sug.length > 0 ? withHistory.child(keyPair("↑↓ tab", "pick")) : withHistory);

    return this.frame(t, "git-prompt", p.title, w, x, y, body);
  }

  commitBox(t: Theme, p: CommitPopup, size: Size) {
    const w = Math.min(620, size.width - 24);
    const { x, y } = this.center(size, w, 260);
    const len = p.input.value().length;

    const label = (s: string, right: Element | null = null) => {
      const el = h_flex().mt(10).mb(4).text_size(10).text_color(t.dim).child(isDithered() ? div().child(Str.toUpperCase(s)) : heading(t, s)).child(div().flex_1());

      return right === null ? el : el.child(right);
    };

    const count: Color = len > 50 ? (len > 72 ? t.ansi1 : t.ansi3) : t.ansi2;

    const body = v_flex().px(14).pt(6).pb(12)
      .child(label("Summary", h_flex().text_size(11).child(div().text_color(count).child(String(len))).child(div().text_color(t.dim).child(" / 50"))))
      .child(inputBox(div().id("cm-sum").border(1).border_color(p.at === 0 ? t.accent : fieldEdge(t)).px(6).h(26).flex().items_center())
        .on_mouse_down("left", () => { p.at = 0; p.input.focus(); })
        .child(Input.new(p.input).w_full().text_size(12).text_color(t.foreground)))
      .child(label("Description"))
      .child(inputBox(div().id("cm-desc").border(1).border_color(p.at === 1 ? t.accent : fieldEdge(t)).px(6).py(4).h(110))
        .on_mouse_down("left", () => { p.at = 1; p.desc.focus(); })
        .child(Textarea.new(p.desc).w_full().h_full().text_size(12).text_color(t.foreground)))
      .child(div().mt(10).child(this.hintRow(t, p, (cx) => this.submit(cx), () => this.cancelCommit(p))));

    return this.frame(t, "git-commit", p.title, w, x, y, body, { right: this.v.commitWhat() });
  }
}
