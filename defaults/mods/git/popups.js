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

import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { dither, stop, edgeRow, popupScrim } from "./draw.js";
import { keyLabel } from "./keys.js";
import { window as appWindow } from "herdr";
import { formKey, formHints, ring } from "./form-keys.ts";
import { keysView, keysKey } from "./keyhelp.ts";

const mac = () => appWindow?.()?.platform === "macos";

/** A key as keyName() writes it ("shift-tab", "ctrl-enter", "a") as form-keys.ts takes it: the key and its modifiers. */
function split(k) {
  const m = {};
  let key = k;
  for (let r; (r = /^(ctrl|shift|cmd)-(.+)$/.exec(key));) { m[{ ctrl: "control", shift: "shift", cmd: "platform" }[r[1]]] = true; key = r[2]; }
  return [key, m];
}

const ROW = 20;

export class Popups {
  constructor(v) { this.v = v; this.top = null; }

  get open() { return Boolean(this.top); }
  get kind() { return this.top?.kind ?? null; }

  close() {
    const p = this.top;
    this.top = null;
    p?.input?.release?.();
    p?.desc?.release?.();
    this.v.focusSelf();
  }

  /** ?: every key here as keyhelp.ts's overview, over the window; its rows
   *  run as a menu's do (j k enter, or a row's own key). `sections`:
   *  [{ title, keys: [[label, words, go], ...] }] with `.key` and `.danger` on a row. */
  keys({ title, sections }) {
    const rows = sections.flatMap((s) => s.keys);
    this.top = { kind: "keys", title, sections, rows, sel: 0 };
  }

  menu({ title, items, at = null, empty = null }) {
    this.top = { kind: "menu", title, items, sel: Math.max(0, items.findIndex((x) => !x.off)), at, empty };
  }

  /** `lines`: more to say, as [text, color] (colors by theme name);
   *  `checks`: toggles [{ key, label, on }], their own key flips one, and
   *  go(cx, checks) gets them. */
  confirm({ title, text, danger = false, go, error = false, lines = [], checks = [] }) {
    this.top = { kind: "confirm", title, text, danger, go, error, lines, checks, at: 0 };
  }

  /** A form popup's stops in tab order (form-keys.ts); `at` is the focused one. */
  stops(p = this.top) {
    if (p?.kind === "confirm") return [
      ...(p.checks ?? []).map((_, i) => ({ id: `cf-c-${i}`, kind: "toggle" })),
      { id: "cf-yes", kind: "button", submit: true },
      ...(p.error ? [] : [{ id: "cf-no", kind: "button" }]),
    ];
    if (p?.kind === "commit") return [{ id: "cm-sum", kind: "text" }, { id: "cm-desc", kind: "area" }, { id: "cm-ok", kind: "button", submit: true }, { id: "cm-no", kind: "button" }];
    return [];
  }

  /** The hint line of a form popup: tab, what the focused stop takes, and the submit / cancel buttons. */
  hints(p = this.top) {
    const submit = p.kind === "commit" ? "commit" : p.error ? "close" : p.danger ? "yes, do it" : "confirm";
    const cancel = p.kind === "commit" && p.draft ? "keep draft" : "cancel";
    const hs = formHints(this.stops(p), p.at, { mac: mac(), submit, cancel });
    return p.error ? hs.filter(([k]) => k !== "esc").map(([k, w]) => [k, k === "enter" ? submit : w]) : hs;
  }

  /** `note`: a line under the input; `suggest(text)`: completions to pick
   *  ([{ value, sub? }]): ↑↓ pick one, tab puts it in, enter takes it. */
  prompt({ title, value = "", placeholder = "", ok, history = null, note = null, suggest = null }) {
    const input = InputState.new({ placeholder, value });
    input.on("submit", (_e, cx) => this.submit(cx));
    const p = { kind: "prompt", title, input, ok, history, hi: -1, note, suggest, pick: -1 };
    if (suggest) input.on("change", (_e, cx) => { if (this.top === p) { p.pick = -1; cx?.notify?.(); } });
    this.top = p;
    this.focusLater(input);
  }

  /** A prompt's completions for what's typed now. */
  suggestions(p) {
    if (!p?.suggest) return [];
    try { return (p.suggest(p.input.value()) ?? []).slice(0, 6); } catch { return []; }
  }

  commit({ title, value = "", ok, draft = false }) {
    // The draft (lazygit keeps it): what esc left, when this is a new commit.
    const [summary, ...rest] = (draft && !value ? this.v.draft ?? "" : value).split("\n");
    const input = InputState.new({ placeholder: "summary", value: summary ?? "" });
    const desc = TextareaState.new({ placeholder: "description (optional)", value: rest.join("\n").replace(/^\n+/, ""), rows: 6 });
    input.on("submit", (_e, cx) => this.submit(cx));
    // The description eats cmd-enter as a new line and says so: take it back and commit.
    let before = desc.value(), now = before;
    desc.on("change", () => { before = now; now = desc.value(); });
    desc.on("submit", (e, cx) => { if (!e?.secondary) return; desc.set_value(before); this.submit(cx); });
    this.top = { kind: "commit", title, input, desc, ok, at: 0, draft };
    this.focusLater(input);
  }

  focusLater(input) {
    input.focus();
    this.v.later?.((cx) => { if (this.top?.input === input) input.focus(); cx?.notify?.(); });
  }

  /** Enter on a prompt / commit (the input's submit, or the key). */
  submit(cx) {
    const p = this.top;
    if (!p) return;
    if (p.kind === "prompt") {
      const picked = this.suggestions(p)[p.pick];
      const text = picked ? picked.value : p.input.value();
      this.close();
      p.ok(text, cx);
    } else if (p.kind === "commit") {
      const summary = p.input.value().trim();
      if (!summary) return;
      const desc = p.desc.value().trim();
      if (p.draft) this.v.draft = null;
      this.close();
      p.ok(desc ? `${summary}\n\n${desc}` : summary, cx);
    }
    cx?.notify?.();
  }

  /** The popup's own yes (a command: menu-run, confirm-yes, prompt-ok, commit-ok), wherever its keyboard is. */
  ok(cx) {
    const p = this.top;
    if (p?.kind === "menu") this.runItem(p.items[p.sel], cx);
    else if (p?.kind === "keys") this.runRow(p.rows[p.sel], cx);
    else if (p?.kind === "confirm") this.yes(p, cx);
    else if (p) this.submit(cx);
  }

  /** A key while a popup is open: true when it was used. */
  key(k, e, cx) {
    const p = this.top;
    if (!p) return false;
    if (p.kind === "keys") {
      if (keysKey(e ?? { key: k }, true) || k === "escape" || k === "q") this.close();
      else if (k === "j" || k === "down") p.sel = Math.min(p.rows.length - 1, p.sel + 1);
      else if (k === "k" || k === "up") p.sel = Math.max(0, p.sel - 1);
      else if (k === "enter" || k === "space") this.runRow(p.rows[p.sel], cx);
      else {
        const hit = p.rows.find((r) => r.key && r.key === k);
        if (hit) this.runRow(hit, cx);
      }
      return true;
    }
    if (p.kind === "menu") {
      const live = p.items.filter((x) => !x.off);
      if (k === "escape" || k === "q") this.close();
      else if (k === "j" || k === "down") p.sel = Math.min(p.items.length - 1, p.sel + 1);
      else if (k === "k" || k === "up") p.sel = Math.max(0, p.sel - 1);
      else if (k === "enter" || k === "space") this.runItem(p.items[p.sel], cx);
      else {
        // An item's own key runs it, as in lazygit's menus.
        const hit = live.find((x) => x.key && x.key === k);
        if (hit) this.runItem(hit, cx);
        else return true;
      }
      return true;
    }
    if (p.kind === "confirm") {
      const check = p.checks?.find((c) => c.key === k);
      if (check) { check.on = !check.on; return true; }
      if (k === "y") { this.yes(p, cx); return true; }
      if (k === "n" || k === "q") { this.close(); return true; }
      const [key, m] = split(k);
      const stops = this.stops(p);
      const a = formKey(stops, p.at, key, m, k.length === 1 ? k : null);
      if (a?.act === "move") p.at = a.to;
      else if (a?.act === "submit" || (a?.act === "press" && stops[p.at].id === "cf-yes")) this.yes(p, cx);
      else if (a?.act === "cancel" || a?.act === "press") this.close();
      else if (a?.act === "flip") p.checks[p.at].on = !p.checks[p.at].on;
      return true;
    }
    if (p.kind === "prompt") {
      if (k === "escape") { this.close(); return true; }
      if (k === "enter") { this.submit(cx); return true; }
      const sug = this.suggestions(p);
      if (sug.length && (k === "up" || k === "down")) {
        p.pick = k === "down" ? Math.min(sug.length - 1, p.pick + 1) : Math.max(-1, p.pick - 1);
        return true;
      }
      if (sug.length && k === "tab") {
        p.input.set_value(sug[Math.max(0, p.pick)].value);
        p.pick = -1;
        return true;
      }
      if (p.history?.length && (k === "up" || k === "down")) {
        p.hi = Math.max(-1, Math.min(p.history.length - 1, p.hi + (k === "up" ? 1 : -1)));
        p.input.set_value(p.hi < 0 ? "" : p.history[p.hi]);
        return true;
      }
      return false; // typing goes to the input
    }
    if (p.kind === "commit") {
      const [key, m] = split(k);
      const stops = this.stops(p);
      const a = formKey(stops, p.at, key, m, k.length === 1 ? k : null);
      if (!a || a.act === "type") return false; // typing goes to the input
      if (a.act === "move") this.commitGo(p, a.to);
      else if (a.act === "submit" || (a.act === "press" && stops[p.at].id === "cm-ok")) this.submit(cx);
      else if (a.act === "cancel" || a.act === "press") this.cancelCommit(p);
      return true;
    }
    return false;
  }

  /** A confirm's yes (an error's only button closes it). */
  yes(p, cx) {
    this.close();
    if (!p.error) p.go?.(cx, p.checks);
  }

  /** Esc on the commit message: what's typed stays as the draft (a new commit). */
  cancelCommit(p) {
    if (p.draft) this.v.draft = [p.input.value(), p.desc.value()].filter((s) => s.trim()).join("\n\n");
    this.close();
  }

  /** The commit message's keyboard to stop i: a field's input, or the window for a button. */
  commitGo(p, i) {
    p.at = i;
    if (i === 0) p.input.focus();
    else if (i === 1) p.desc.focus();
    else this.v.focusSelf();
  }

  /** A keys row: [label, words, go]. */
  runRow(row, cx) {
    if (!row) return;
    this.close();
    row[2]?.(cx);
  }

  runItem(item, cx) {
    if (!item || item.off) return;
    this.close();
    item.go?.(cx);
  }

  // ---- drawing

  render(t, size) {
    const p = this.top;
    if (!p) return null;
    // The window dims under a popup, lightly (draw.js POPUP_SCRIM): it stays readable.
    const scrim = popupScrim("git-scrim")
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); if (p.kind === "menu" || p.kind === "confirm") this.close(); cx.notify(); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); if (p.kind === "menu") this.close(); cx.notify(); });
    if (p.kind === "keys") {
      return div().id("git-popup-layer").absolute().inset_0()
        .child(keysView(t, { id: "git-keys", title: p.title, list: p.sections, cursor: p.sel, narrow: size.width < 640,
          pick: (row, cx) => this.runRow(row, cx), close: () => this.close() }));
    }
    let box;
    if (p.kind === "menu") box = this.menuBox(t, p, size);
    else if (p.kind === "confirm") box = this.confirmBox(t, p, size);
    else if (p.kind === "prompt") box = this.promptBox(t, p, size);
    else box = this.commitBox(t, p, size);
    return div().id("git-popup-layer").absolute().inset_0().child(scrim).child(box);
  }

  frame(t, id, title, w, x, y, body, { danger = false, right = null } = {}) {
    const edge = danger ? t.ansi1 : t.accent;
    return v_flex().id(id).absolute().left(x).top(y).w(w).bg(t.background).border_l(1).border_r(1).border_color(edge)
      .on_mouse_down("left", stop)
      .child(body)
      .child(edgeRow(t, `${id}-top`, edge, "top",
        div().min_w(0).max_w(w - (right ? 120 : 40)).truncate().text_color(danger ? t.ansi1 : t.foreground).child(title),
        right ? div().text_color(t.dim).child(right) : null))
      .child(edgeRow(t, `${id}-bottom`, edge, "bottom", null, null));
  }

  center(size, w, h) {
    return { x: Math.max(8, Math.round((size.width - w) / 2)), y: Math.max(40, Math.round((size.height - h) / 2.4)) };
  }

  menuBox(t, p, size) {
    const w = Math.min(Math.max(320, ...p.items.map((x) => 120 + (x.label?.length ?? 0) * 7 + Math.min(180, (x.sub?.length ?? 0) * 6))), size.width - 24);
    const shown = Math.min(p.items.length || 1, Math.max(4, Math.floor((size.height - 120) / ROW)));
    const first = Math.max(0, Math.min(p.sel - Math.floor(shown / 2), p.items.length - shown));
    const h = shown * ROW + 20;
    let { x, y } = this.center(size, w, h);
    if (p.at) { x = Math.min(Math.max(8, p.at.x), size.width - w - 8); y = Math.min(Math.max(8, p.at.y), size.height - h - 30); }
    const keyW = Math.max(30, ...p.items.map((it) => keyLabel(it.key ?? "").length * 7 + 14));
    const rows = p.items.slice(first, first + shown).map((it, n) => {
      const i = first + n, sel = i === p.sel;
      if (it.section) {
        return h_flex().id(`mi-${i}`).h(ROW).px(10).items_center().text_size(10).text_color(t.ansi8).child(it.section.toUpperCase());
      }
      return h_flex().id(`mi-${i}`).relative().h(ROW).px(10).gap(10).items_center().text_size(11)
        .text_color(it.off ? t.dim : sel ? t.foreground : t.muted)
        .hover((s) => s.bg(t.ansi0 + "66"))
        .on_mouse_move((_e, cx) => { if (p.sel !== i && !it.off) { p.sel = i; cx.notify(); } })
        .on_click((_e, cx) => { cx.stop_propagation(); this.runItem(it, cx); cx.notify(); })
        .when(sel, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
        .child(div().relative().w(keyW).flex_none().text_color(t.accent).child(keyLabel(it.key ?? "")))
        .child(div().relative().flex_1().min_w(0).truncate().text_color(it.danger ? t.ansi1 : it.off ? t.dim : sel ? t.foreground : t.muted).child(it.label))
        .when(Boolean(it.sub), (el) => el.child(div().relative().flex_none().max_w(200).truncate().text_color(t.dim).child(it.sub)));
    });
    const body = v_flex().pt(10).pb(6).children(rows.length ? rows : [div().px(12).py(4).text_size(11).text_color(t.dim).child(p.empty ?? "Nothing here.")]);
    return this.frame(t, "git-menu", p.title, w, x, y, body, { right: p.items.length > shown ? `${p.sel + 1} of ${p.items.length}` : null });
  }

  confirmBox(t, p, size) {
    const w = Math.min(560, size.width - 24);
    const { x, y } = this.center(size, w, 110 + (p.lines?.length ?? 0) * 18 + (p.checks?.length ?? 0) * 20);
    const body = v_flex().px(12).pt(14).pb(10).gap(12).text_size(12)
      .child(div().text_color(p.error ? t.ansi1 : t.foreground).child(p.text))
      .when(Boolean(p.lines?.length), (el) => el.child(v_flex().gap(3).text_size(11)
        .children(p.lines.map(([s, c], i) => div().id(`cf-l-${i}`).text_color(t[c] ?? c ?? t.muted).child(s)))))
      .when(Boolean(p.checks?.length), (el) => el.child(v_flex().gap(2).text_size(11)
        .children(p.checks.map((c, i) => ring(h_flex().id(`cf-c-${i}`).px(4).gap(8).items_center().hover((s) => s.bg(t.ansi0 + "66")), p.at === i, t.accent)
          .on_click((_e, cx) => { cx.stop_propagation(); p.at = i; c.on = !c.on; cx.notify(); })
          .child(div().w(18).text_color(t.accent).child(c.key))
          .child(div().text_color(c.on ? t.foreground : t.dim).child(c.on ? "[x]" : "[ ]"))
          .child(div().text_color(c.on || p.at === i ? t.foreground : t.muted).child(c.label))))))
      .child(this.hintRow(t, p, { "cf-yes": (cx) => this.yes(p, cx), "cf-no": () => this.close() }));
    return this.frame(t, "git-confirm", p.title, w, x, y, body, { danger: p.danger || p.error });
  }

  /** A form popup's hint line: each key and its word, the submit and cancel
   *  ones as buttons (`go` by id) that tab reaches and the ring marks. */
  hintRow(t, p, go) {
    const stops = this.stops(p);
    const ids = stops.filter((s) => s.kind === "button").map((s) => s.id); // [submit, cancel]
    const hs = this.hints(p);
    return h_flex().gap(10).text_size(11).items_center().children(hs.map(([k, w], i) => {
      const id = i === hs.length - (ids.length === 2 ? 2 : 1) ? ids[0] : ids.length === 2 && i === hs.length - 1 ? ids[1] : null;
      const pair = h_flex().gap(5).items_center().child(div().relative().text_color(t.accent).child(k)).child(div().relative().text_color(id && stops[p.at]?.id === id ? t.foreground : t.dim).child(w));
      if (!id) return pair.id(`hint-${i}`);
      return ring(pair.id(id).h(18).px(4).hover((s) => s.bg(t.ansi0 + "66")), stops[p.at]?.id === id, t.accent)
        .when(stops[p.at]?.id === id, (el) => el.bg(t.ansi0))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); go[id]?.(cx); cx.notify(); });
    }));
  }

  promptBox(t, p, size) {
    const w = Math.min(560, size.width - 24);
    const sug = this.suggestions(p);
    const { x, y } = this.center(size, w, 90 + sug.length * ROW + (p.note ? 18 : 0));
    const body = v_flex().px(12).pt(14).pb(10).gap(8)
      .child(div().border(1).border_color(t.accent).px(6).h(26).flex().items_center()
        .child(Input.new(p.input).w_full().text_size(12).text_color(t.foreground)))
      .when(Boolean(p.note), (el) => el.child(div().text_size(11).text_color(t.muted).child(p.note)))
      .when(sug.length > 0, (el) => el.child(v_flex().children(sug.map((s, i) => h_flex().id(`ps-${i}`).relative().h(ROW).px(6).gap(10).items_center().text_size(11)
        .hover((st) => st.bg(t.ansi0 + "66"))
        .on_click((_e, cx) => { cx.stop_propagation(); p.pick = i; this.submit(cx); cx.notify(); })
        .when(i === p.pick, (r) => r.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
        .child(div().relative().flex_1().min_w(0).truncate().text_color(i === p.pick ? t.foreground : t.muted).child(s.value))
        .when(Boolean(s.sub), (r) => r.child(div().relative().flex_none().text_color(t.dim).child(s.sub)))))))
      .child(h_flex().gap(16).text_size(11)
        .child(h_flex().gap(5).child(div().text_color(t.accent).child("enter")).child(div().text_color(t.dim).child("confirm")))
        .child(h_flex().gap(5).child(div().text_color(t.accent).child("esc")).child(div().text_color(t.dim).child("cancel")))
        .when(Boolean(p.history?.length), (el) => el.child(h_flex().gap(5).child(div().text_color(t.accent).child("↑↓")).child(div().text_color(t.dim).child("history"))))
        .when(sug.length > 0, (el) => el.child(h_flex().gap(5).child(div().text_color(t.accent).child("↑↓ tab")).child(div().text_color(t.dim).child("pick")))));
    return this.frame(t, "git-prompt", p.title, w, x, y, body);
  }

  commitBox(t, p, size) {
    const w = Math.min(620, size.width - 24);
    const { x, y } = this.center(size, w, 260);
    const len = p.input.value().length;
    const label = (s, right) => h_flex().mt(10).mb(4).text_size(10).text_color(t.dim).child(div().child(s.toUpperCase())).child(div().flex_1()).when(Boolean(right), (el) => el.child(right));
    const body = v_flex().px(14).pt(6).pb(12)
      .child(label("Summary", h_flex().text_size(11).child(div().text_color(len > 50 ? (len > 72 ? t.ansi1 : t.ansi3) : t.ansi2).child(String(len))).child(div().text_color(t.dim).child(" / 50"))))
      .child(div().id("cm-sum").border(1).border_color(p.at === 0 ? t.accent : t.ansi0).px(6).h(26).flex().items_center()
        .on_mouse_down("left", () => { p.at = 0; p.input.focus(); })
        .child(Input.new(p.input).w_full().text_size(12).text_color(t.foreground)))
      .child(label("Description"))
      .child(div().id("cm-desc").border(1).border_color(p.at === 1 ? t.accent : t.ansi0).px(6).py(4).h(110)
        .on_mouse_down("left", () => { p.at = 1; p.desc.focus(); })
        .child(Textarea.new(p.desc).w_full().h_full().text_size(12).text_color(t.foreground)))
      .child(div().mt(10).child(this.hintRow(t, p, { "cm-ok": (cx) => this.submit(cx), "cm-no": () => this.cancelCommit(p) })));
    return this.frame(t, "git-commit", p.title, w, x, y, body, { right: this.v.commitWhat?.() ?? null });
  }
}
