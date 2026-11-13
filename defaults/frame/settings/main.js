// App-owned settings mod. Writes changes immediately; no Save step.
//
// Keys: the section rail is one stop (↑↓ / j k pick a section, 1-6 jump to
// one); tab / shift-tab and ↑↓ / j k walk the page's controls in order,
// enter / space press the focused one, ← → / h l step a stepper or a choice
// (← on anything else goes back to the rail), esc closes the font list, a
// machine's rename or remove, else Settings. The focused control has a ring
// and scrolls into view; a click hides the ring until the next key.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, InputState, Input, Popup, ScrollHandle } from "gpui-base";
import { hc, run, theme, themes, fonts, updates, settings, layouts, shared, appHome, readTextFile, writeTextFile, playSound, props, closeOverlay, window } from "herdr";
import { bindTab, tabActions } from "./form-keys.ts";

const I = (name) => `frame/settings/${name}.svg`;

const SECTIONS = [
  { id: "look", title: "Look", icon: "palette" },
  ...(window()?.platform === "macos" ? [{ id: "keyboard", title: "Keyboard", icon: "keyboard" }] : []),
  { id: "editor", title: "Editor", icon: "code" },
  { id: "machines", title: "Machines", icon: "server" },
  { id: "alerts", title: "Alerts", icon: "bell" },
  { id: "updates", title: "Updates", icon: "refresh" },
];

const LOOKS = { main: "Fireflies", terminals: "Terminals", win98: "Fireflies 98" };
const APPEARANCES = [
  [null, "System"],
  ["light", "Light"],
  ["dark", "Dark"],
];

// What the app uses when settings.json names no font (settings.rs).
const DEFAULT_FONT = "JetBrains Mono";
const DEFAULT_UI_FONT = "Geist";

export default class Settings extends View {
  init(_props, cx) {
    const asked = props()?.section;
    this.section = SECTIONS.some((s) => s.id === asked) ? asked : "look";
    this.picking = null; // "font" | "ui_font" while its list is open
    this.filter = "";
    this.fontInput = InputState.new({ placeholder: "Type to search fonts" });
    this.fontInput.on("change", (_e, cx) => { this.filter = this.fontInput.value(); this.fontAt = 0; cx.notify(); });
    this.fontAt = 0; // the font list's row under the keyboard
    this.fontRows = []; // what that list shows: null (the default), then names
    this.fontScroll = ScrollHandle.new();
    // The keyboard: "nav" (the section rail) or "body" (the page's controls,
    // `focus` the id of the one it's on); `kbd` once a key moved it, so the
    // ring shows. `order` is the controls the last render drew, in order.
    this.zone = "nav";
    this.focus = null;
    this.kbd = false;
    this.order = [];
    this.scroll = ScrollHandle.new();
    this.renameInput = InputState.new();
    this.renameInput.on("focus", (_e, cx) => { this.renameFocused = true; cx.notify(); });
    this.renameInput.on("blur", (_e, cx) => { this.renameFocused = false; cx.notify(); });
    this.renameInput.on("change", (_e, cx) => { if (this.machineEdit?.action === "rename") this.machineEdit.name = this.renameInput.value(); cx.notify(); });
    this.renameInput.on("submit", (_e, cx) => {
      const edit = this.machineEdit;
      if (edit?.action === "rename") this.machineAction(edit.machine, "rename", cx, edit.name);
    });
    this.person = {};
    this.raw = null;
    this.previews = {}; // layout name -> its "preview" picture
    this.previewsOf = "";
    this.machineList = null;
    this.machineLoading = false;
    this.machineError = null;
    this.machineBusy = {};
    this.machineResults = {};
    this.machineEdit = null;
    this.machineNotice = null;
    this.handle = cx.focus_handle();
    bindTab(cx); // tab / shift-tab reach the key handler (form-keys.ts)
    this.handle.focus();
    // The overlay takes the keyboard once it's shown; take it back.
    cx.timer.after(600, () => { if (!this.picking && !this.machineEdit) this.handle.focus(); });
    cx.spawn(async (cx) => {
      await this.load();
      if (this.section === "machines") await this.loadMachines();
      cx.notify();
    });
    // After "Check now": follow the look (the answer comes from the app), then
    // "Up to date" for a moment.
    cx.timer.every(300, (cx) => {
      if (!this.asked) return;
      if (updates().checking) this.asked = Date.now();
      else if (Date.now() - this.asked >= 3000) this.asked = null;
      cx.notify();
    });
    cx.timer.every(3000, (cx) => {
      if (this.section !== "machines") return;
      cx.spawn(async (cx) => {
        await this.loadMachines();
        cx.notify();
      });
    });
  }

  file() {
    return `${appHome()}/settings.json`;
  }

  // Each layout file may name a picture of itself (`"preview"` on its root).
  loadPreviews(names, cx) {
    this.previewsOf = names.join("\n");
    cx.spawn(async (cx) => {
      const found = {};
      for (const name of names) {
        try {
          const preview = JSON.parse((await readTextFile(`${appHome()}/layouts/${name}.json`)) ?? "{}").preview;
          if (typeof preview === "string" && preview) found[name] = preview;
        } catch {}
      }
      this.previews = found;
      cx.notify();
    });
  }

  async load() {
    this.raw = await readTextFile(this.file());
    try {
      this.person = this.raw ? JSON.parse(this.raw) : {};
    } catch {
      this.person = {};
    }
  }

  // Changes settings.json the way an agent would: read, change, write back
  // only if nobody changed it meanwhile (else read again and redo).
  change(edit, cx) {
    cx.spawn(async (cx) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.load();
        const next = JSON.parse(JSON.stringify(this.person));
        edit(next);
        try {
          await writeTextFile(this.file(), JSON.stringify(next, null, 2) + "\n", this.raw);
          this.person = next;
          break;
        } catch {}
      }
      cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  // Keyboard -------------------------------------------------------------

  // A page block: the scroll area's direct child, so a control in it can be
  // scrolled into view. Controls register with the block being built.
  b(el) {
    this.blk++;
    return el;
  }

  // Registers a control in keyboard order and draws the ring on it while it
  // has the keyboard. `on`: { go(cx), left(cx), right(cx) }.
  ring(el, id, on = {}, radius = 7) {
    this.order.push({ id, block: this.blk, ...on });
    const focused = this.kbd && this.zone === "body" && this.focus === id;
    return el.relative().when(focused, (el) => el.child(div().absolute().inset_0().rounded(radius).border_2().border_color(theme().accent)));
  }

  section_(id, cx) {
    this.section = id;
    this.picking = null;
    this.machineEdit = null;
    this.focus = null;
    this.handle.focus();
    if (id === "machines") cx.spawn(async (cx) => { await this.loadMachines(); cx.notify(); });
    cx.notify();
  }

  // Moves the keyboard to the control `i` places along (clamped; past the
  // ends of tab order it wraps through the rail).
  moveTo(i, cx) {
    const c = this.order[i];
    if (!c) return;
    this.zone = "body";
    this.focus = c.id;
    if (c.block >= 0) this.scroll.scroll_to_item(c.block);
    if (c.input) c.go?.(cx);
    else this.handle.focus();
  }

  // The font list's keys, while it's open (its search field has the keyboard).
  fontKey(e, cx) {
    const k = e.key, n = this.fontRows.length;
    if (k === "escape" || k === "tab") {
      this.picking = null;
      this.handle.focus();
    } else if ((k === "down" || k === "up") && n) {
      this.fontAt = Math.max(0, Math.min(n - 1, this.fontAt + (k === "down" ? 1 : -1)));
      this.fontScroll.scroll_to_item(this.fontAt);
    } else if (k === "enter" && n) {
      this.chooseFont(this.picking, this.fontRows[this.fontAt], cx);
    } else return false;
    return true;
  }

  key(e, cx) {
    const k = e.key, m = e.modifiers ?? {};
    if (m.platform || m.control || m.alt) return;
    const done = () => { this.kbd = true; cx.stop_propagation(); cx.notify(); };
    if (this.picking) {
      if (this.fontKey(e, cx)) done();
      return;
    }
    // Typing a machine's new name: the field keeps its keys.
    if (this.machineEdit && this.renameFocused) {
      if (k === "escape") { this.machineEdit = null; this.handle.focus(); }
      else if (k === "tab") { const i = this.order.findIndex((c) => c.id === this.focus); this.moveTo(i + (m.shift ? -1 : 1), cx); }
      else return;
      return done();
    }
    if (k === "escape") {
      if (!this.machineEdit) return this.close();
      this.machineEdit = null;
      this.handle.focus();
      return done();
    }
    const n = this.order.length;
    const i = this.order.findIndex((c) => c.id === this.focus);
    const c = this.order[i];
    const sections = SECTIONS.map((s) => s.id), at = sections.indexOf(this.section);
    const down = k === "down" || k === "j", up = k === "up" || k === "k";
    if (/^[1-9]$/.test(k) && sections[Number(k) - 1]) {
      this.zone = "nav";
      this.section_(sections[Number(k) - 1], cx);
    } else if (k === "tab") {
      if (this.zone === "nav") m.shift ? this.moveTo(n - 1, cx) : this.moveTo(0, cx);
      else if ((m.shift && i <= 0) || (!m.shift && i >= n - 1)) this.zone = "nav";
      else this.moveTo(i + (m.shift ? -1 : 1), cx);
    } else if (this.zone === "nav") {
      if (down || up) this.section_(sections[Math.max(0, Math.min(sections.length - 1, at + (down ? 1 : -1)))], cx);
      else if (k === "right" || k === "l" || k === "enter" || k === "space") this.moveTo(0, cx);
      else return;
    } else if (down || up) this.moveTo(i < 0 ? 0 : Math.max(0, Math.min(n - 1, i + (down ? 1 : -1))), cx);
    else if (k === "left" || k === "h") c?.left ? c.left(cx) : (this.zone = "nav");
    else if (k === "right" || k === "l") c?.right?.(cx);
    else if (k === "enter" || k === "space") {
      if (c) c.go?.(cx);
      else this.moveTo(0, cx);
    } else return;
    done();
  }

  // Pieces ---------------------------------------------------------------

  heading(t, text) {
    return div().pt(6).pb(8).text_size(12).font_semibold().text_color(t.dim).child(text.toUpperCase());
  }

  // One setting: what it is on the left, the control on the right.
  row(t, title, about, control) {
    return h_flex()
      .w_full()
      .gap(16)
      .py(12)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(3)
          .child(div().text_size(14).text_color(t.foreground).child(title))
          .when(Boolean(about), (el) => el.child(div().text_size(12.5).line_height("18px").text_color(t.dim).child(about))),
      )
      .child(div().flex_none().child(control));
  }

  button(t, id, label, onClick) {
    return this.ring(div()
      .id(id)
      .px(12)
      .py(5)
      .rounded(7)
      .border_1()
      .border_color(t.border)
      .bg(t.raised)
      .cursor_pointer()
      .text_size(13)
      .text_color(t.foreground)
      .hover((s) => s.bg(t.hover))
      .on_click(onClick)
      .child(label), id, { go: (cx) => onClick(null, cx) });
  }

  // − value +
  stepper(t, id, value, onMinus, onPlus) {
    const b = (k, label, f) =>
      div()
        .id(`${id}-${k}`)
        .w(28)
        .h(28)
        .flex()
        .items_center()
        .justify_center()
        .cursor_pointer()
        .text_size(15)
        .text_color(t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(f)
        .child(label);
    return this.ring(h_flex()
      .id(id)
      .items_center()
      .rounded(7)
      .border_1()
      .border_color(t.border)
      .bg(t.raised)
      .overflow_hidden()
      .child(b("minus", "\u2212", onMinus))
      .child(div().w(54).text_size(13).text_color(t.foreground).flex().justify_center().child(value))
      .child(b("plus", "+", onPlus)), id, { left: (cx) => onMinus(null, cx), right: (cx) => onPlus(null, cx) });
  }

  toggle(t, id, on, onClick) {
    return this.ring(div()
      .id(id)
      .w(36)
      .h(20)
      .rounded(10)
      .p(2)
      .cursor_pointer()
      .bg(on ? t.accent : t.hover)
      .flex()
      .when(on, (el) => el.justify_end())
      .on_click(onClick)
      .child(div().w(16).h(16).rounded(8).bg(on ? t.accent_foreground : t.muted)), id, { go: (cx) => onClick(null, cx) }, 10);
  }

  // Look -----------------------------------------------------------------

  // A small drawing of each layout, in the theme's colors (as the welcome draws them).
  preview(t, name) {
    const row = () => div().flex().flex_row();
    const col = () => div().flex().flex_col();
    const term = (bg = t.background, edge = t.border) => div().flex_1().rounded(2).bg(bg).border_1().border_color(edge);
    const line = (w, c = t.dim) => div().h(3).w(w).flex_none().rounded(2).bg(c);
    const lines = (n, c) => col().gap(4).p(5).children([...Array(n)].map((_, i) => line(i % 2 ? 22 : 32, c)));
    const frame = (el) => el.size_full().rounded(6).overflow_hidden().border_1().border_color(t.border).bg(t.surface);
    if (name === "main")
      return frame(row())
        .child(col().w(42).border_r(1).border_color(t.border).child(lines(4)))
        .child(
          col()
            .flex_1()
            .child(row().h(11).gap(2).p(2).border_b(1).border_color(t.border).child(div().w(20).rounded(2).bg(t.accent)).child(div().w(16).rounded(2).bg(t.raised)).child(div().w(16).rounded(2).bg(t.raised)))
            .child(row().flex_1().p(4).gap(3).child(term()).child(term())),
        );
    if (name === "terminals") {
      const card = () => col().flex_1().rounded(4).border_1().border_color("#2c2f34").bg("#17191c").child(row().h(7).px(3).items_center().border_b(1).border_color("#25282c").child(line(14, "#5d6168")));
      return frame(col())
        .bg("#131619")
        .p(4)
        .gap(4)
        .child(row().h(10).gap(3).p(1).rounded(4).bg("#1d1f22").child(div().w(30).rounded(3).bg("#34373c").border_1().border_color("#4a4d53")).child(div().w(30)))
        .child(row().flex_1().gap(4).child(card()).child(card()));
    }
    // A layout of the person's own: a plain frame.
    return frame(col()).child(row().h(11).border_b(1).border_color(t.border)).child(row().flex_1().p(4).child(term()));
  }

  layoutPicker(t, cx) {
    const current = shared("layout") ?? "main";
    // Shipped looks in the welcome's order, then the person's own; new files show up by themselves.
    const shipped = Object.keys(LOOKS);
    const rank = (n) => (shipped.includes(n) ? shipped.indexOf(n) : shipped.length);
    const names = [...layouts()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    if (names.join("\n") !== this.previewsOf) this.loadPreviews(names, cx);
    return h_flex()
      .w_full()
      .flex_wrap()
      .gap(8)
      .children(
        names.map((name) => {
          const on = name === current;
          const pick = () => run("layout.switch", { name });
          return this.ring(v_flex()
            .id(`st-l-${name}`)
            .w(124)
            .gap(6)
            .p(6)
            .rounded(10)
            .border_2()
            .border_color(on ? t.accent : "#00000000")
            .bg(on ? t.raised : "#00000000")
            .cursor_pointer()
            .hover((s) => s.bg(t.raised))
            .on_click((_e, cx) => {
              run("layout.switch", { name });
              cx.notify();
            })
            .child(
              div()
                .h(62)
                .w_full()
                .overflow_hidden()
                .child(
                  this.previews[name]
                    ? image(this.previews[name]).w_full().h(62).rounded(6).border_1().border_color(t.border)
                    : this.preview(t, name),
                ),
            )
            .child(
              h_flex()
                .gap(5)
                .items_center()
                .child(div().text_size(12.5).text_color(on ? t.foreground : t.muted).child(LOOKS[name] ?? name))
                .when(on, (el) => el.child(svg(I("check")).size(12).text_color(t.accent))),
            ), `st-l-${name}`, { go: pick }, 10);
        }),
      );
  }

  appearancePicker(t, cx) {
    const now = this.person.appearance ?? null;
    const set = (value, cx) => this.change((p) => {
      if (value === null) delete p.appearance;
      else p.appearance = value;
    }, cx);
    const at = Math.max(0, APPEARANCES.findIndex(([v]) => v === now));
    const step = (d) => (cx) => set(APPEARANCES[(at + d + APPEARANCES.length) % APPEARANCES.length][0], cx);
    return this.ring(h_flex()
      .id("st-appearance")
      .p(2)
      .gap(2)
      .rounded(8)
      .border_1()
      .border_color(t.border)
      .bg(t.background)
      .children(
        APPEARANCES.map(([value, label]) =>
          div()
            .id(`st-ap-${label}`)
            .px(12)
            .py(4)
            .rounded(6)
            .text_size(13)
            .cursor_pointer()
            .when(now === value, (el) => el.bg(t.raised).text_color(t.foreground).border_1().border_color(t.border))
            .when(now !== value, (el) => el.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
            .on_click((_e, cx) => set(value, cx))
            .child(label),
        ),
      ), "st-appearance", { go: step(1), left: step(-1), right: step(1) }, 8);
  }

  themePicker(t, light) {
    const s = settings();
    const current = light ? s.theme_light : s.theme_dark;
    return h_flex()
      .w_full()
      .flex_wrap()
      .gap(8)
      .children(
        // A theme named like a layout (themes/win98.json) is that layout's own.
        themes()
          .filter((x) => Boolean(x.light) === light && (x.name === shared("layout") || !layouts().includes(x.name)))
          .map(({ name, colors: c }) => {
          const on = name === current;
          const label = name.replace(/-/g, " ");
          const dot = (color) => div().w(8).h(8).rounded(4).bg(color);
          return this.ring(v_flex()
            .id(`st-t-${name}`)
            .w(124)
            .gap(6)
            .p(6)
            .rounded(10)
            .border_2()
            .border_color(on ? t.accent : "#00000000")
            .cursor_pointer()
            .hover((s) => s.bg(t.raised))
            .on_click((_e, cx) => {
              run("app.theme", { name });
              cx.notify();
            })
            .child(
              v_flex()
                .h(46)
                .w_full()
                .p(7)
                .gap(6)
                .rounded(6)
                .border_1()
                .border_color(t.border)
                .bg(c.background)
                .child(div().h(4).w(44).rounded(2).bg(c.terminal_foreground))
                .child(h_flex().gap(4).child(dot(c.accent)).child(dot(c.ansi1)).child(dot(c.ansi2)).child(dot(c.ansi3)).child(dot(c.ansi5))),
            )
            .child(
              h_flex()
                .w_full()
                .min_w(0)
                .gap(5)
                .items_center()
                .child(div().min_w(0).truncate().tooltip(label).text_size(12.5).text_color(on ? t.foreground : t.muted).child(label))
                .when(on, (el) => el.child(svg(I("check")).size(12).flex_none().text_color(t.accent))),
            ), `st-t-${name}`, { go: () => run("app.theme", { name }) }, 10);
        }),
      );
  }

  // The font in use, written in itself; a click opens the list.
  fontButton(t, which, family, def) {
    const open = this.picking === which;
    const toggle = (cx) => {
      this.picking = this.picking === which ? null : which;
      this.filter = "";
      this.fontAt = 0;
      this.fontInput.set_value("");
      if (this.picking) this.fontInput.focus();
      else this.handle.focus();
      cx.notify();
    };
    const trigger = this.ring(div()
      .id(`st-f-${which}`)
      .w(220)
      .px(12)
      .py(6)
      .rounded(7)
      .border_1()
      .border_color(open ? t.accent : t.border)
      .bg(t.raised)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => toggle(cx))
      .child(div().font_family(family).text_size(13.5).text_color(t.foreground).child(family)), `st-f-${which}`, { go: toggle });
    return Popup.new(`st-fp-${which}`, trigger)
      .when(open, (el) => el.content(this.fontList(t, which, def)));
  }

  chooseFont(which, name, cx) {
    this.change((p) => {
      if (name === null) delete p[which];
      else p[which] = name;
    }, cx);
    this.picking = null;
    this.handle.focus();
    cx.notify();
  }

  fontList(t, which, def) {
    const q = this.filter.toLowerCase();
    const matches = fonts().filter((f) => f.toLowerCase().includes(q)).slice(0, 200);
    const choose = (name, cx) => this.chooseFont(which, name, cx);
    // What the keyboard walks: the default (no filter), then the matches.
    this.fontRows = [...(q ? [] : [null]), ...matches];
    this.fontAt = Math.min(this.fontAt, Math.max(0, this.fontRows.length - 1));
    let row = 0;
    const item = (id, label, family, onClick) =>
      div()
        .id(id)
        .px(10)
        .py(5)
        .rounded(6)
        .cursor_pointer()
        .when(row++ === this.fontAt, (el) => el.bg(t.hover))
        .hover((s) => s.bg(t.hover))
        .on_click(onClick)
        .child(div().font_family(family).text_size(13.5).text_color(t.foreground).child(label));
    return v_flex()
      .id(`st-font-list-${which}`)
      .w(360)
      .on_mouse_down_out((_e, cx) => {
        this.picking = null;
        this.handle.focus();
        cx.notify();
      })
      .rounded(8)
      .border_1()
      .border_color(t.border)
      .bg(t.background)
      // Let the child's native scroll run before stopping the page's wheel event.
      .on_scroll_wheel((_e, cx) => cx.stop_propagation())
      .child(
        div()
          .px(12)
          .py(8)
          .border_b(1)
          .border_color(t.border)
          .text_size(13)
          .child(Input.new(this.fontInput).h(28).text_color(t.foreground)),
      )
      .child(
        div()
          .id(`st-fl-${which}`)
          .h(200)
          .p(4)
          .overflow_y_scrollbar()
          .track_scroll(this.fontScroll)
          .when(!q, (el) => el.child(item(`st-fd-${which}`, `Default (${def})`, def, (_e, cx) => choose(null, cx))))
          .children(matches.map((f, i) => item(`st-fi-${which}-${i}`, f, f, (_e, cx) => choose(f, cx)))),
      );
  }

  look(t, cx) {
    const s = settings();
    const p = this.person;
    const own = (key, composed, def) => (p[key] ?? def) !== composed;
    const size = (key, value, d, cx) => this.change((q) => (q[key] = Math.max(8, Math.min(32, (q[key] ?? value) + d))), cx);
    const fontRow = (which, sizeKey, title, family, def, sizeNow) =>
      v_flex()
        .w_full()
        .child(
          this.row(
            t,
            title,
            own(which, family, def) ? "This layout sets its own; yours shows in the others." : null,
            h_flex()
              .gap(8)
              .items_center()
              .child(this.fontButton(t, which, family, def))
              // The panels' text follows zoom: they size their rows to it.
              .when(Boolean(sizeKey), (el) => el.child(this.stepper(t, `st-${sizeKey}`, `${Math.round(sizeNow)}`, (_e, cx) => size(sizeKey, sizeNow, -1, cx), (_e, cx) => size(sizeKey, sizeNow, 1, cx)))),
          ),
        );
    // Blocks (b): what scrolls into view under the keyboard.
    return [
      this.b(this.heading(t, "Layout")),
      this.b(this.layoutPicker(t, cx)),
      this.b(div().h(18)),
      this.b(this.heading(t, "Theme")),
      this.b(this.row(t, "Appearance", "Light or dark, or as your system is now.", this.appearancePicker(t, cx))),
      this.b(div().pt(12).pb(8).text_size(12.5).text_color(t.dim).child("For the layout you're in: each layout keeps its own light and dark theme.")),
      this.b(div().pb(6).text_size(12.5).font_medium().text_color(t.muted).child("Dark")),
      this.b(this.themePicker(t, false)),
      this.b(div().pt(10).pb(6).text_size(12.5).font_medium().text_color(t.muted).child("Light")),
      this.b(this.themePicker(t, true)),
      this.b(div().h(18)),
      this.b(this.heading(t, "Size and fonts")),
      this.b(
        this.row(
          t,
          "Zoom",
          "Everything: terminals, panels, text.",
          h_flex()
            .gap(8)
            .items_center()
            .child(this.stepper(t, "st-zoom", `${Math.round(s.zoom * 100)}%`, () => run("app.zoom_out"), () => run("app.zoom_in")))
            .child(this.button(t, "st-zoom-reset", "Reset", () => run("app.zoom_reset"))),
        ),
      ),
      this.b(fontRow("font", "font_size", "Terminal font", s.font_family, DEFAULT_FONT, s.font_size)),
      this.b(fontRow("ui_font", null, "Interface font", s.ui_font_family, DEFAULT_UI_FONT)),
    ];
  }

  keyboard(t) {
    const choices = [
      ["auto", "Automatic (Alt on US keyboards)"],
      ["on", "Alt"],
      ["off", "Types characters"],
      ["left", "Left Option is Alt"],
      ["right", "Right Option is Alt"],
    ];
    return [
      this.b(this.heading(t, "Option key")),
      this.b(div().pb(12).text_size(13).text_color(t.dim).child("Use Option for terminal shortcuts or to type accents and special characters.")),
      ...choices.map(([value, label]) => {
        const on = (this.person.option_as_alt ?? "auto") === value;
        const pick = (cx) => this.change((p) => { p.option_as_alt = value; }, cx);
        return this.b(this.ring(h_flex()
          .id(`st-option-${value}`)
          .gap(10)
          .px(12)
          .py(10)
          .rounded(7)
          .items_center()
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => pick(cx))
          .child(div().text_color(on ? t.accent : t.muted).child(on ? "◉" : "○"))
          .child(div().text_size(14).text_color(t.foreground).child(label)), `st-option-${value}`, { go: pick }));
      }),
    ];
  }

  // Editor ---------------------------------------------------------------

  // settings.json `editor.vim` (default true) and `editor.leader`: what new
  // editors start with; each editor pane's vim chip switches that pane only.
  editor(t) {
    const radio = (id, on, label, edit) => this.ring(h_flex()
      .id(id).gap(10).px(12).py(10).rounded(7).items_center().cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.change(edit, cx))
      .child(div().text_color(on ? t.accent : t.muted).child(on ? "◉" : "○"))
      .child(div().text_size(14).text_color(t.foreground).child(label)), id, { go: (cx) => this.change(edit, cx) });
    const vim = this.person.editor?.vim !== false;
    const leader = this.person.editor?.leader ?? "space";
    const set = (k, v) => (p) => { p.editor = { ...(p.editor ?? {}), [k]: v }; };
    return [
      this.b(this.heading(t, "Vim mode")),
      this.b(div().pb(12).text_size(13).text_color(t.dim).child("How new editors start. An editor's own vim chip (cmd-k v, :novim) switches that pane only, and the pane keeps its choice.")),
      this.b(radio("st-vim-on", vim, "Start in vim mode", set("vim", true))),
      this.b(radio("st-vim-off", !vim, "Start without vim", set("vim", false))),
      this.b(div().pt(18).child(this.heading(t, "Leader key"))),
      this.b(div().pb(12).text_size(13).text_color(t.dim).child("Vim's leader: it opens the list of what comes next (files, grep, problems, ...).")),
      this.b(radio("st-leader-space", leader === "space" || leader === " ", "Space", set("leader", "space"))),
      this.b(radio("st-leader-comma", leader === "comma" || leader === ",", "Comma", set("leader", "comma"))),
      this.b(div().pt(12).text_size(12.5).text_color(t.dim).child("Language servers, formatters and indentation per language: settings.json editor (ask your agent).")),
    ];
  }

  // Machines -------------------------------------------------------------

  async loadMachines() {
    if (this.machineLoading) return;
    this.machineLoading = true;
    try {
      const r = await hc(["machine", "ls", "--json"]);
      if (r.code !== 0) throw new Error(r.stderr || r.stdout || "Couldn't read machines.");
      const list = JSON.parse(r.stdout).machines;
      if (!Array.isArray(list)) throw new Error("Couldn't read machines.");
      this.machineList = list.filter((m) => !m.temporary);
      this.machineError = null;
    } catch (e) {
      this.machineError = String(e);
    } finally {
      this.machineLoading = false;
    }
  }

  machineAction(machine, action, cx, name) {
    if (this.machineBusy[machine]) return;
    if (action === "rename" && (!name?.trim() || name.trim() === machine)) return;
    this.machineBusy[machine] = action;
    delete this.machineResults[machine];
    this.machineEdit = null;
    this.handle.focus();
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const args = ["machine", action, machine];
        if (action === "rename") args.push(name.trim());
        const r = await hc(args);
        let payload = null;
        try { payload = JSON.parse(r.stdout || r.stderr); } catch {}
        if (r.code !== 0) throw new Error(payload?.error?.message || (r.stderr || r.stdout || "It didn't work.").trim());
        const message = action === "update"
          ? `Updated ${machine}${payload?.version ? ` to hc ${payload.version}` : ""}; its terminals kept running.`
          : action === "rename" ? `Renamed ${machine} to ${name.trim()}.` : `Removed ${machine}; its terminals keep running there.`;
        if (action === "update") this.machineResults[machine] = { message, ok: true };
        else this.machineNotice = message;
      } catch (e) {
        this.machineResults[machine] = { message: String(e), ok: false };
      } finally {
        delete this.machineBusy[machine];
      }
      await this.loadMachines();
      cx.notify();
    });
  }

  olderCore(remote, local) {
    const parse = (v) => /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.*)?$/.exec(v ?? "");
    const a = parse(remote), b = parse(local);
    if (!a || !b) return false;
    for (let i = 1; i <= 3; i++) {
      if (+a[i] !== +b[i]) return +a[i] < +b[i];
    }
    if (!a[4] || !b[4]) return Boolean(a[4] && !b[4]);
    const x = a[4].split("."), y = b[4].split(".");
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === y[i]) continue;
      if (x[i] === undefined || y[i] === undefined) return x[i] === undefined;
      const xn = /^\d+$/.test(x[i]), yn = /^\d+$/.test(y[i]);
      return xn && yn ? +x[i] < +y[i] : xn !== yn ? xn : x[i] < y[i];
    }
    return false;
  }

  machineRow(t, m, localVersion) {
    const busy = this.machineBusy[m.name];
    const edit = this.machineEdit?.machine === m.name ? this.machineEdit : null;
    const state = String(m.state ?? "unknown").replace(/[_-]/g, " ");
    const color = ["connected", "online"].includes(m.state) ? t.ansi2 : ["connecting", "reconnecting"].includes(m.state) ? t.working : t.blocked;
    const result = this.machineResults[m.name];
    const controls = h_flex().gap(6).items_center();
    if (busy) controls.child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900)).child(div().text_size(12).text_color(t.muted).child(busy === "update" ? "Updating…" : busy === "rename" ? "Renaming…" : "Removing…"));
    else {
      if (this.olderCore(m.version, localVersion)) controls.child(this.button(t, `st-m-update-${m.name}`, "Update", (_e, cx) => this.machineAction(m.name, "update", cx)));
      for (const [action, label] of [["rename", "Rename"], ["rm", "Remove"]]) {
        controls.child(this.button(t, `st-m-${action}-${m.name}`, label, (_e, cx) => {
          this.machineEdit = { machine: m.name, action, name: m.name };
          // The keyboard goes on to the new name, or to "Cancel" before a remove.
          this.focus = action === "rename" ? `st-m-input-${m.name}` : `st-m-cancel-${m.name}`;
          if (action === "rename") {
            this.renameInput.set_value(m.name);
            this.renameInput.set_selected_range({ start: 0, end: encodeURIComponent(m.name).replace(/%[0-9A-F]{2}/g, "_").length });
            this.renameFocused = true;
            this.renameInput.focus();
          }
          cx.notify();
        }));
      }
    }
    const row = v_flex().w_full().py(12).gap(8).border_b(1).border_color(t.border)
      .child(h_flex().gap(10).items_center()
        .child(div().w(7).h(7).flex_none().rounded(4).bg(color))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(div().text_size(14).text_color(t.foreground).child(m.name))
          .child(div().text_size(12.5).text_color(t.dim).child(`${m.target ?? ""} · ${state} · ${m.version ? `hc ${m.version}` : "hc version unknown"}`)))
        .child(controls.flex_none()));
    if (m.state === "needs_login") {
      const command = `hc machine login ${m.name}`;
      row.child(v_flex().gap(5)
        .child(div().text_size(12.5).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.foreground).child(command))
          .child(this.button(t, `st-m-login-copy-${m.name}`, this.copiedLogin === command ? "Copied" : "Copy", (_e, cx) => {
            cx.write_to_clipboard(command);
            this.copiedLogin = command;
            cx.notify();
          }))));
    }
    if (busy === "update") row.child(div().text_size(12.5).text_color(t.dim).child("Copying this computer's herdr-core. Its terminals keep running."));
    if (edit && !busy) {
      // Built in keyboard order: the name field, then "Cancel", then the action.
      const cancel = () => this.button(t, `st-m-cancel-${m.name}`, "Cancel", (_e, cx) => {
        this.machineEdit = null;
        this.focus = `st-m-${edit.action}-${m.name}`;
        this.handle.focus();
        cx.notify();
      });
      if (edit.action === "rm") row.child(v_flex().gap(8)
        .child(div().text_size(12.5).text_color(t.muted).child(`Remove ${m.name}? Its terminals keep running there.`))
        .child(h_flex().gap(6).child(cancel()).child(this.button(t, `st-m-confirm-${m.name}`, "Remove machine", (_e, cx) => this.machineAction(m.name, "rm", cx)))));
      else {
        // The field shows its own focus (its accent edge): registered, no ring.
        this.order.push({ id: `st-m-input-${m.name}`, block: this.blk, input: true, go: () => this.renameInput.focus() });
        row.child(v_flex().gap(6)
          .child(div().text_size(12).text_color(t.dim).child("New name (addresses using the old name stop working)"))
          .child(h_flex().gap(6).items_center()
            .child(Input.new(this.renameInput).flex_1().min_w(0).h(32).px(10).rounded(7).border_1().border_color(this.renameFocused ? t.accent : t.input).bg(t.background).text_size(13).text_color(t.foreground))
            .child(cancel()).child(this.button(t, `st-m-save-${m.name}`, "Save", (_e, cx) => this.machineAction(m.name, "rename", cx, edit.name)))));
      }
    }
    if (result) row.child(div().text_size(12.5).text_color(result.ok ? t.ansi2 : t.blocked).child(result.message));
    return row;
  }

  machines(t) {
    const version = updates().core.version;
    return [
      this.b(this.heading(t, "Machines")),
      this.b(div().pb(8).text_size(12.5).line_height("18px").text_color(t.dim).child("Your computers, reached over ssh. Their terminals keep running when you disconnect.")),
      this.b(this.row(t, "This computer", `Connected · ${version ? `hc ${version}` : "hc version unknown"}`, div().w(7).h(7).rounded(4).bg(t.ansi2))),
      ...(this.machineList ?? []).map((m) => this.b(this.machineRow(t, m, version))),
      ...(this.machineList === null && !this.machineError ? [this.b(h_flex().py(14).gap(8).items_center().child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900)).child(div().text_size(12.5).text_color(t.dim).child("Reading machines…")))] : []),
      ...(this.machineList?.length === 0 ? [this.b(div().py(14).text_size(12.5).text_color(t.dim).child("No other machines yet."))] : []),
      ...(this.machineError ? [this.b(div().py(10).text_size(12.5).text_color(t.blocked).child(this.machineError))] : []),
      ...(this.machineNotice ? [this.b(div().py(10).text_size(12.5).text_color(t.ansi2).child(this.machineNotice))] : []),
      this.b(h_flex().pt(16).child(this.button(t, "st-m-add", "Add a machine", () => run("mod.open", { name: "machine-add" })))),
    ];
  }

  // Alerts ---------------------------------------------------------------

  alerts(t) {
    const sounds = this.person.sounds ?? {};
    const on = sounds.enabled !== false;
    const file = (f) => (f ? f.split(/[\\/]/).pop() : "Fireflies' sound");
    return [
      this.b(this.heading(t, "Sounds")),
      this.b(
        this.row(
          t,
          "Play sounds",
          "When an agent needs you, and when one finishes while you're not looking. A note shows in the corner either way.",
          this.toggle(t, "st-sounds", on, (_e, cx) => this.change((p) => (p.sounds = { ...(p.sounds ?? {}), enabled: !on }), cx)),
        ),
      ),
      this.b(this.row(t, "An agent needs you", file(sounds.blocked), this.button(t, "st-play-blocked", "Play", () => playSound("blocked")))),
      this.b(this.row(t, "An agent finished", file(sounds.done), this.button(t, "st-play-done", "Play", () => playSound("done")))),
      this.b(div().pt(12).text_size(12.5).line_height("18px").text_color(t.dim).child("Want your own sounds? Ask your agent to set sounds.done and sounds.blocked in settings.json to an MP3.")),
      this.b(this.heading(t, "Notifications")),
      this.b(
        this.row(
          t,
          "System notifications",
          "While Fireflies isn't the app in front, its notes also go to the system's notification center. A click on one comes back here.",
          this.toggle(t, "st-sysnote", this.person.system_notifications !== false, (_e, cx) =>
            this.change((p) => (p.system_notifications = p.system_notifications === false), cx),
          ),
        ),
      ),
    ];
  }

  // Updates --------------------------------------------------------------

  updates(t) {
    const u = updates();
    const at = (secs) => {
      const d = new Date(secs * 1000);
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };
    const checked = u.checked ? ` Checked at ${at(u.checked)}.` : "";
    const result = u.checking ? "Checking\u2026" : u.checked
      ? `Up to date.${checked}`
      : "No successful check. Check your connection and try again.";
    // Pressed: "Checking\u2026" while it looks, then "Up to date" for a moment
    // (a find changes the row instead). One per row: an element shows once.
    const asked = this.asked && Date.now() - this.asked < 3000;
    const check = (id) =>
      !u.checks
        ? null
        : u.checking && this.asked
          ? div().px(12).py(5).text_size(13).text_color(t.dim).child("Checking\u2026")
          : asked && u.checked && !u.checking
            ? div().px(12).py(5).text_size(13).text_color(t.ansi2).child("\u2713 Up to date")
            : this.button(t, id, "Check now", (_e, cx) => {
                this.asked = Date.now();
                run("app.check_updates");
                cx.notify();
              });
    const primary = (id, label, f) =>
      this.ring(div().id(id).px(12).py(5).rounded(7).cursor_pointer().bg(t.accent).text_color(t.accent_foreground).text_size(13).font_semibold().hover((s) => s.opacity(0.9)).on_click(f).child(label), id, { go: f });
    // Controls as thunks, built where they show, so the keyboard meets them in order.
    const app = !u.app.updates
      ? ["A build from source: it updates with git, not here.", null]
      : u.app.ready
        ? [`${u.app.ready} is ready. Restart to switch now; it also switches when you quit.`, () => primary("st-app-update", "Restart to update", () => run("app.update"))]
        : [result, () => check("st-check-app")];
    const c = u.core;
    const core = c.managed
      ? [`Managed by ${c.managed}: update it there.`, null]
      : c.updating
        ? ["Updating\u2026 your terminals keep running.", null]
        : c.error
          ? [`The update failed: ${c.error}`, () => primary("st-core-retry", "Try again", () => run("app.update_core"))]
          : c.ready
            ? [`${c.ready} is ready. Your terminals keep running through it.`, () => primary("st-core-update", "Update herdr-core", () => run("app.update_core"))]
            : u.checks
              ? [result, () => check("st-check-core")]
              : ["Not checked: a build from source looks for no updates.", null];
    return [
      this.b(this.heading(t, "Fireflies")),
      this.b(this.row(t, `Fireflies ${u.app.version}`, app[0], h_flex().gap(8).flex_none()
        .child(this.button(t, "st-whats-new", "What's new", () => { closeOverlay(props()?.overlay); run("app.whats_new"); }))
        .when(Boolean(app[1]), (el) => { const c = app[1](); return c ? el.child(c) : el; }))),
      this.b(div().h(18)),
      this.b(this.heading(t, "herdr-core")),
      this.b(this.row(t, `herdr-core ${c.version ?? ""}`, core[0], core[1]?.() ?? div())),
      this.b(div().pt(12).text_size(12.5).line_height("18px").text_color(t.dim).child("Fireflies looks for both every hour and tells you in the corner. herdr-core runs your terminals, so they keep running through its updates.")),
    ];
  }

  // ----------------------------------------------------------------------

  render(cx) {
    const t = theme();
    const u = updates();
    const waiting = Boolean(u.app.ready || (u.core.ready && !u.core.managed));
    // The page first: its controls are the keyboard's order, "Send feedback" last.
    this.order = [];
    this.blk = 0;
    const page = this.section === "look"
      ? this.look(t, cx)
      : this.section === "keyboard"
        ? this.keyboard(t)
      : this.section === "editor"
        ? this.editor(t)
      : this.section === "machines"
        ? this.machines(t)
      : this.section === "alerts"
        ? this.alerts(t)
        : this.updates(t);
    this.blk = -1;
    const feedback = this.button(t, "st-feedback", "Send feedback", () => { closeOverlay(props()?.overlay); run("app.feedback"); });
    const railFocus = this.kbd && this.zone === "nav";
    const hint = (k, what) => h_flex().gap(5).child(div().text_color(t.muted).child(k)).child(div().child(what));
    const nav = v_flex()
      .flex_none()
      .w(190)
      .p(10)
      .gap(2)
      .border_r(1)
      .border_color(t.border)
      .child(div().px(10).pt(6).pb(12).text_size(16).font_semibold().text_color(t.foreground).child("Settings"))
      .children(
        SECTIONS.map((s, i) => {
          const on = s.id === this.section;
          return h_flex()
            .id(`st-s-${s.id}`)
            .relative()
            .gap(10)
            .px(10)
            .py(7)
            .items_center()
            .rounded(7)
            .cursor_pointer()
            .bg(on ? t.raised : "#00000000")
            .hover((st) => st.bg(t.raised))
            .on_click((_e, cx) => {
              this.zone = "nav";
              this.section_(s.id, cx);
            })
            .when(on && railFocus, (el) => el.child(div().absolute().inset_0().rounded(7).border_2().border_color(t.accent)))
            .child(svg(I(s.icon)).size(15).text_color(on ? t.accent : t.dim))
            .child(div().flex_1().text_size(13.5).text_color(on ? t.foreground : t.muted).child(s.title))
            .when(s.id === "updates" && waiting, (el) => el.child(div().w(7).h(7).rounded(4).bg(t.accent)))
            .child(div().text_size(11).text_color(t.dim).child(String(i + 1)));
        }),
      );
    return h_flex()
      .id("settings")
      .track_focus(this.handle)
      .when(Boolean(this.picking), (el) => el.on_action("overlay.close", (_e, cx) => {
        this.picking = null;
        this.handle.focus();
        cx.stop_propagation();
        cx.notify();
      }))
      .w_full()
      .h(620)
      .min_h(0)
      .items_start()
      // A click hides the ring until the next key.
      .on_mouse_down("left", () => { this.kbd = false; })
      .on_key_down((e, cx) => this.key(e, cx))
      .map((el) => tabActions(el, (e, cx) => this.key(e, cx)))
      .child(nav.h_full().child(div().flex_1())
        .child(v_flex().px(10).pb(10).gap(2).text_size(11).text_color(t.dim)
          .child(hint("tab ↑↓", "move"))
          .child(hint("↵", "press · ←→ change"))
          .child(hint("1-" + SECTIONS.length, "section · esc close")))
        .child(feedback))
      .child(
        // A bar that always shows: the pages are taller than the dialog and
        // people should see that they scroll.
        div()
          .relative()
          .flex_1()
          .min_w(0)
          .h_full()
          .child(
            div()
              .id("st-body")
              .size_full()
              .overflow_y_scroll()
              .track_scroll(this.scroll)
              // Padding inside, not on the scroll area: there it counts as
              // content and a page that fits still shows a bar. Each block is
              // a direct child, so the keyboard's control scrolls into view.
              .children(page.map((el, i) => div().px(28).when(i === 0, (d) => d.pt(22)).when(i === page.length - 1, (d) => d.pb(22)).child(el))),
          )
          .child(Scrollbar.vertical("st-body").mode("always").absolute().inset_0()),
      );
  }
}
