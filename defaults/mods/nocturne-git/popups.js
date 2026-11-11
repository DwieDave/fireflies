// lazygit's popups in Nocturne's frame: menus (the ? keybindings menu, the
// right-click menus, every "…options" menu), confirms (red for destructive
// ones), prompts and the commit message (summary + description). One popup
// at a time over the window, on a dithered scrim; esc closes it.

import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { dither, stop, edgeRow } from "./draw.js";
import { keyLabel } from "./keys.js";

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

  menu({ title, items, at = null, empty = null }) {
    this.top = { kind: "menu", title, items, sel: Math.max(0, items.findIndex((x) => !x.off)), at, empty };
  }

  confirm({ title, text, danger = false, go, error = false }) {
    this.top = { kind: "confirm", title, text, danger, go, error };
  }

  prompt({ title, value = "", placeholder = "", ok, history = null }) {
    const input = InputState.new({ placeholder, value });
    input.on("submit", (_e, cx) => this.submit(cx));
    this.top = { kind: "prompt", title, input, ok, history, hi: -1 };
    this.focusLater(input);
  }

  commit({ title, value = "", ok, draft = false }) {
    // The draft (lazygit keeps it): what esc left, when this is a new commit.
    const [summary, ...rest] = (draft && !value ? this.v.draft ?? "" : value).split("\n");
    const input = InputState.new({ placeholder: "summary", value: summary ?? "" });
    const desc = TextareaState.new({ placeholder: "description (optional)", value: rest.join("\n").replace(/^\n+/, ""), rows: 6 });
    input.on("submit", (_e, cx) => this.submit(cx));
    this.top = { kind: "commit", title, input, desc, ok, field: "summary", draft };
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
      const text = p.input.value();
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

  /** A key while a popup is open: true when it was used. */
  key(k, e, cx) {
    const p = this.top;
    if (!p) return false;
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
      if (k === "enter" || k === "y") { this.close(); if (!p.error) p.go?.(cx); }
      else if (k === "escape" || k === "n" || k === "q") this.close();
      return true;
    }
    if (p.kind === "prompt") {
      if (k === "escape") { this.close(); return true; }
      if (k === "enter") { this.submit(cx); return true; }
      if (p.history?.length && (k === "up" || k === "down")) {
        p.hi = Math.max(-1, Math.min(p.history.length - 1, p.hi + (k === "up" ? 1 : -1)));
        p.input.set_value(p.hi < 0 ? "" : p.history[p.hi]);
        return true;
      }
      return false; // typing goes to the input
    }
    if (p.kind === "commit") {
      if (k === "escape") {
        if (p.draft) this.v.draft = [p.input.value(), p.desc.value()].filter((s) => s.trim()).join("\n\n");
        this.close();
        return true;
      }
      if (k === "tab" || k === "shift-tab") {
        p.field = p.field === "summary" ? "desc" : "summary";
        (p.field === "summary" ? p.input : p.desc).focus();
        return true;
      }
      if (k === "enter" && p.field === "summary") { this.submit(cx); return true; }
      if (k === "ctrl-enter" || (k === "enter" && (e?.modifiers?.platform || e?.modifiers?.control))) { this.submit(cx); return true; }
      return false;
    }
    return false;
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
    // The window dims under a popup: half the background, dithered (Nocturne's way of 50%).
    const scrim = div().id("git-scrim").absolute().inset_0().bg(t.background + "99").child(dither(t.background, 1))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); if (p.kind === "menu" || p.kind === "confirm") this.close(); cx.notify(); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); if (p.kind === "menu") this.close(); cx.notify(); });
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
    const w = Math.min(520, size.width - 24);
    const { x, y } = this.center(size, w, 110);
    const body = v_flex().px(12).pt(14).pb(10).gap(12).text_size(12)
      .child(div().text_color(p.error ? t.ansi1 : t.foreground).child(p.text))
      .child(h_flex().gap(16).text_size(11)
        .child(h_flex().id("cf-yes").gap(5).hover((s) => s.bg(t.ansi0 + "66"))
          .on_click((_e, cx) => { cx.stop_propagation(); this.key("enter", null, cx); cx.notify(); })
          .child(div().text_color(t.accent).child("enter")).child(div().text_color(t.dim).child(p.error ? "close" : p.danger ? "yes, do it" : "confirm")))
        .when(!p.error, (el) => el.child(h_flex().id("cf-no").gap(5).hover((s) => s.bg(t.ansi0 + "66"))
          .on_click((_e, cx) => { cx.stop_propagation(); this.close(); cx.notify(); })
          .child(div().text_color(t.accent).child("esc")).child(div().text_color(t.dim).child("cancel")))));
    return this.frame(t, "git-confirm", p.title, w, x, y, body, { danger: p.danger || p.error });
  }

  promptBox(t, p, size) {
    const w = Math.min(560, size.width - 24);
    const { x, y } = this.center(size, w, 90);
    const body = v_flex().px(12).pt(14).pb(10).gap(8)
      .child(div().border(1).border_color(t.accent).px(6).h(26).flex().items_center()
        .child(Input.new(p.input).w_full().text_size(12).text_color(t.foreground)))
      .child(h_flex().gap(16).text_size(11)
        .child(h_flex().gap(5).child(div().text_color(t.accent).child("enter")).child(div().text_color(t.dim).child("confirm")))
        .child(h_flex().gap(5).child(div().text_color(t.accent).child("esc")).child(div().text_color(t.dim).child("cancel")))
        .when(Boolean(p.history?.length), (el) => el.child(h_flex().gap(5).child(div().text_color(t.accent).child("↑↓")).child(div().text_color(t.dim).child("history")))));
    return this.frame(t, "git-prompt", p.title, w, x, y, body);
  }

  commitBox(t, p, size) {
    const w = Math.min(620, size.width - 24);
    const { x, y } = this.center(size, w, 260);
    const len = p.input.value().length;
    const label = (s, right) => h_flex().mt(10).mb(4).text_size(10).text_color(t.dim).child(div().child(s.toUpperCase())).child(div().flex_1()).when(Boolean(right), (el) => el.child(right));
    const body = v_flex().px(14).pt(6).pb(12)
      .child(label("Summary", h_flex().text_size(11).child(div().text_color(len > 50 ? (len > 72 ? t.ansi1 : t.ansi3) : t.ansi2).child(String(len))).child(div().text_color(t.dim).child(" / 50"))))
      .child(div().id("cm-sum").border(1).border_color(p.field === "summary" ? t.accent : t.ansi0).px(6).h(26).flex().items_center()
        .on_mouse_down("left", () => { p.field = "summary"; p.input.focus(); })
        .child(Input.new(p.input).w_full().text_size(12).text_color(t.foreground)))
      .child(label("Description"))
      .child(div().id("cm-desc").border(1).border_color(p.field === "desc" ? t.accent : t.ansi0).px(6).py(4).h(110)
        .on_mouse_down("left", () => { p.field = "desc"; p.desc.focus(); })
        .child(Textarea.new(p.desc).w_full().h_full().text_size(12).text_color(t.foreground)))
      .child(h_flex().mt(10).gap(14).text_size(11)
        .child(h_flex().gap(5).child(div().text_color(t.accent).child("enter")).child(div().text_color(t.dim).child(p.field === "summary" ? "commit" : "new line")))
        .child(h_flex().gap(5).child(div().text_color(t.accent).child("tab")).child(div().text_color(t.dim).child(p.field === "summary" ? "description" : "summary")))
        .child(h_flex().gap(5).child(div().text_color(t.accent).child("ctrl-enter")).child(div().text_color(t.dim).child("commit")))
        .child(div().flex_1())
        .child(h_flex().gap(5).child(div().text_color(t.accent).child("esc")).child(div().text_color(t.dim).child(p.draft ? "keep draft" : "cancel"))));
    return this.frame(t, "git-commit", p.title, w, x, y, body, { right: this.v.commitWhat?.() ?? null });
  }
}
