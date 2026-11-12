// Nocturne picture in picture: the video a browser pane put in Picture in
// Picture, in a Fireflies window (drag it by its bar, resize it by its edges and
// corners: the video keeps its shape) that stays over every tab and space.
// Square, like the rest of Nocturne.
//
//   ↩    back to the pane it came from (it plays on there)
//   «  » 10 seconds back / on (commands nocturne-pip.rewind / .forward)
//   ❚❚ ▶ pause / play (nocturne-pip.toggle)
//   🔈   sound off / on (nocturne-pip.mute)
//   ◧    into a pane: a new pane beside the focused one, in the shown tab
//        (nocturne-pip.pane); the video plays on there
//   ⤓    park: a chip in the shown tab's parked row (nocturne-pip.park); the
//        video plays on, unparking the chip brings the window back
//   ⇱    out of Fireflies: a window above every app and space, in the screen's
//        bottom right corner (nocturne-pip.out; its ⇲ brings it back)
//   ✕    close: the video goes back to its page, paused (nocturne-pip.close)
//   ⋯    when the bar is too narrow for them all: the rest, as a menu.
//        Play/pause and close always stay on the bar.
// Keys while it has the keyboard (overlay.focus to the window, pane.go to its
// pane, a click on it; its bar's edge turns blue meanwhile):
//   space k  pause / play   ← → (h l)  10 s back / on   m  sound   b  back
//   p  into a pane   P  park   o  out of Fireflies   x q  close
//   esc  (the window) the keyboard back to the pane (overlay.focus none)
//   ?    these keys (KEYS), keyhelp.js's overview in a popup: the video is a
//        native view, drawn over the panes and the overlays opened before it
//        (a popup, a dialog or a window raised after it cuts a hole in it and
//        its backdrop dims it); the bar's ? (before ✕) opens it too
// The ⋯ menu: ↑ ↓ (j k) move, enter picks, esc q close. The keys popup: esc q ? close.
//
// Opened by nocturne-browser (`openOverlay` WINDOW below, props { of: the
// browser's web view key }). As a pane (◧): props { of, pane: true }; the pane
// closes when the video leaves it. Parked (⤓): props { of, pane: true, park:
// true }, a pane that parks itself once it holds the video and turns back into
// the window when unparked. The ⋯ menu: this mod as a popup, props { menu }.
// Any site's video works: the page itself moves into the player and its
// video is lifted to fill it (native view `pip`).

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as herdr from "herdr";
import { props, theme, settings, closeOverlay, openOverlay, run, panes, focused, shared, setShared, nextCommand, window as appWindow } from "herdr";
import { keysView, keysKey, keysHeight } from "./keyhelp.js";

const ID = "pip";
const BAR = 22;
const MOD = "nocturne-pip";
const ICONS = "mods/nocturne-pip/icons";
// How the window resizes: the video's shape (16:9 until the video says) under
// a 22 px bar in a 1 px border.
const RESIZE = { min: [240, 158], aspect: 16 / 9, chrome: [2, 24] };
// The window, as nocturne-browser opens it too.
const WINDOW = { mod: MOD, kind: "window", key: MOD, frame: "none", width: 384, height: 238, resizable: RESIZE };
// The pane a ◧ or ⤓ made: { of, pane, park }, so that pane can find itself (a mod isn't told
// its pane id), and the page's browser knows whether the video went into a pane or a chip.
const PANE = "nocturne-pip.pane";
// The video the player window shows now (the palette offers its commands meanwhile).
const PLAYER = "nocturne-pip.player";
const SKIP = 10;
const ROW = 26;
// The keys popup's width.
const KEYS_W = 340;

// The bar's controls, in bar order. `keep`: the lower, the longer it stays
// on a narrow bar (the rest go into ⋯).
const CONTROLS = [
  { id: "back", keep: 3, glyph: "↩", name: "Back to the page" },
  { id: "rewind", keep: 5, glyph: "«", name: `Back ${SKIP} seconds` },
  { id: "toggle", keep: 0, glyph: (s) => (s.playing ? "❚❚" : "▶"), name: (s) => (s.playing ? "Pause" : "Play") },
  { id: "forward", keep: 6, glyph: "»", name: `On ${SKIP} seconds` },
  { id: "mute", keep: 2, icon: (s) => (s.muted ? "volume-x" : "volume"), name: (s) => (s.muted ? "Sound on" : "Sound off") },
  { id: "pane", keep: 7, glyph: "◧", name: "Into a pane", window: true },
  { id: "park", keep: 4, glyph: "⤓", name: "Park as a chip" },
  { id: "out", keep: 8, glyph: "⇱", name: "Out of Fireflies" },
  { id: "keys", keep: 9, glyph: "?", name: "Keys" },
  { id: "close", keep: 1, glyph: "✕", name: "Close" },
];

/** What ? lists: every key keyControl() takes, ? keys last. */
export const KEYS = [["space k", "pause / play"], ["← →  h l", `${SKIP} s back / on`], ["m", "sound off / on"], ["b", "back to the page"],
  ["p", "into a pane"], ["P", "park as a chip"], ["o", "out of Fireflies"], ["x q", "close"], ["esc", "the keyboard back to the pane"], ["?", "keys"]];

const available = () => typeof herdr.nativeView?.new === "function";
const val = (v, s) => (typeof v === "function" ? v(s) : v);

// The dither fill, as ../nocturne/kit.js has it (a mod can't import another mod's files).
const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
function dither(color, cell = 1) {
  const zoom = Number(settings()?.zoom) || 1, dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

// The bar keeps this much for its title before controls go into ⋯.
const TITLE = 70;

/** The controls a `width` px bar shows, and those for ⋯ (which takes a place itself). */
export function fit(controls, width) {
  const room = Math.floor((width - 8 - TITLE) / BAR);
  if (controls.length <= room) return { shown: controls, more: [] };
  const keep = new Set([...controls].sort((a, b) => a.keep - b.keep).slice(0, Math.max(2, room - 1)).map((c) => c.id));
  return { shown: controls.filter((c) => keep.has(c.id)), more: controls.filter((c) => !keep.has(c.id)) };
}

/** The player's control for a key event, or null. "unfocus": esc, the keyboard back to the pane. */
export function keyControl(e) {
  const m = e?.modifiers ?? {};
  if (m.platform || m.control || m.alt) return null;
  const c = e?.key_char;
  const k = typeof c === "string" && c.length === 1 && c.trim() ? c : String(e?.key ?? "");
  return { space: "toggle", k: "toggle", left: "rewind", h: "rewind", right: "forward", l: "forward", m: "mute", b: "back",
    p: "pane", P: "park", o: "out", x: "close", q: "close", escape: "unfocus", "?": "keys" }[k] ?? null;
}

/** The ⋯ menu's cursor after a key (null: not a moving key). */
export function menuMove(k, at, n) {
  const d = k === "down" || k === "j" ? 1 : k === "up" || k === "k" ? -1 : 0;
  return d && n ? (at + d + n) % n : null;
}

export default class Pip extends View {
  init(_p, cx) {
    this.menu = props()?.menu ?? null;
    this.keysList = Boolean(props()?.keys);
    if (this.menu || this.keysList) return this.initMenu(cx);
    this.handle = cx.focus_handle();
    this.playing = true;
    this.muted = false;
    this.error = null;
    this.width = 384;
    // The control under the pointer: its name shows in the title (a tooltip
    // isn't an overlay: it would be drawn under the video, a native view).
    this.hover = null;
    this.aspect = null;
    this.inPane = Boolean(props()?.pane);
    this.parks = Boolean(props()?.park);
    if (!available()) return;
    if (!this.inPane) setShared(PLAYER, props()?.of ?? null);
    cx.spawn(async (cx) => {
      for (;;) {
        let e;
        try { e = JSON.parse(await herdr.nextNativeViewEvent()); } catch { return; }
        // The video went home (here, in its page or elsewhere), or into
        // another player (a pane, a chip, out of Fireflies): nothing left to show here.
        if (e.event === "pip.moved") this.noteMade();
        if (e.event === "pip.ended" || e.event === "pip.moved") return this.leave();
        if (e.event === "pip.state" && e.data?.result && e.data.result !== "none") {
          this.playing = e.data.result === "playing";
          if (typeof e.data.muted === "boolean") this.muted = e.data.muted;
          this.shape(e.data.width, e.data.height);
        }
        cx.notify();
      }
    });
    // How the video is (playing, sound), once the view holds it.
    cx.timer.after(500, () => { try { herdr.nativeViewCall(ID, "pip.sync", {}); } catch {} });
    // Popped back in by the window out of Fireflies' ◧ or ⤓: on into a pane or a chip.
    const then = props()?.then;
    if (!this.inPane && (then === "pane" || then === "park")) cx.timer.after(400, () => this.command(then));
    if (this.inPane) {
      // A pane from an earlier run (it is saved with its tab): no video comes.
      cx.timer.after(1500, () => { if (!this.state()) this.leave(); });
      // A chip: parks once it holds the video; unparked, the window comes back.
      cx.timer.every(250, () => { if (this.parks) this.watchPark(); });
    }
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^nocturne-pip\./, "");
        if (c === "focus") this.handle.focus();
        else this.command(c);
        cx.notify();
      }
    });
  }

  key(e, cx) {
    const c = keyControl(e);
    if (!c || ((c === "pane" || c === "unfocus") && this.inPane) || (c === "park" && this.parks)) return;
    if (c === "unfocus") run("overlay.focus", { dir: "none" });
    else this.command(c);
    cx.stop_propagation();
    cx.notify();
  }

  command(c) {
    if (this.menu) return;
    if (c === "toggle") this.call("pip.toggle");
    else if (c === "rewind") this.call("pip.seek", { by: -SKIP });
    else if (c === "forward") this.call("pip.seek", { by: SKIP });
    else if (c === "mute") this.call("pip.mute");
    else if (c === "back") { this.call("pip.back"); this.leave(); }
    else if (c === "close") { this.call("pip.close"); this.leave(); }
    else if (c === "out") this.popOut();
    else if (c === "pane" && !this.inPane) this.intoPane(false);
    else if (c === "park" && !this.parks) this.park();
    else if (c === "keys") this.openKeys();
  }

  /** ?: the keys, a popup over the video. */
  openKeys() {
    openOverlay({ mod: MOD, kind: "popup", frame: "none", width: KEYS_W, height: keysHeight(KEYS, KEYS_W) + 2, props: { keys: true } });
  }

  /** The window keeps the video's real shape (`videoWidth` × `videoHeight`). */
  shape(w, h) {
    if (this.inPane || !(w > 0 && h > 0)) return;
    const aspect = w / h;
    if (this.aspect && Math.abs(this.aspect - aspect) < 0.001) return;
    this.aspect = aspect;
    run("overlay.resizable", { id: props()?.overlay, resizable: { ...RESIZE, aspect } });
  }

  /** ⤓: a pane parks itself; the window goes into a pane that does. */
  park() {
    if (this.inPane) this.parks = true;
    else this.intoPane(true);
  }

  call(action, args) {
    try { return herdr.nativeViewCall(ID, action, args ?? {}); }
    catch (err) { this.error = String(err?.message ?? err); return null; }
  }

  /** The session this player shows, if any (`{ showing, ... }`). */
  state() {
    try { return herdr.nativeViewCall(ID, "state", {})?.content?.session ?? null; } catch { return null; }
  }

  /** This copy's pane: the one ◧/⤓ noted, else the only player pane there is. */
  ownPane() {
    const mine = (p) => p?.mod === MOD;
    const noted = shared(PANE);
    const pane = noted?.of === props()?.of ? panes().find((p) => p.pane === noted.pane && mine(p)) : null;
    if (pane) return pane;
    const all = panes().filter(mine);
    return all.length === 1 ? all[0] : null;
  }

  /** A parking pane: parks itself once the video is in it; when the chip is
   *  unparked (clicked, dragged back, focused), opens the window again,
   *  which takes the video, and this pane closes (`pip.moved`). */
  watchPark() {
    if (this.closing) return;
    const me = this.ownPane();
    if (!me) return;
    if (me.parked) { this.wasParked = true; return; }
    if (this.wasParked) {
      this.wasParked = false;
      openOverlay({ ...WINDOW, props: { of: props()?.of } });
      return;
    }
    if (!this.parkAsked && this.state()?.showing) {
      this.parkAsked = true;
      run("pane.park", { pane: me.pane });
    }
  }

  /** The copy ends (its window or pane closed, by us or by Fireflies). */
  async close() {
    if (!this.menu && !this.inPane && shared(PLAYER) === props()?.of) setShared(PLAYER, null);
  }

  /** This player goes: its window, or its pane. */
  leave() {
    if (!this.inPane) {
      if (shared(PLAYER) === props()?.of) setShared(PLAYER, null);
      return closeOverlay(props()?.overlay);
    }
    if (this.closing) return;
    this.closing = true;
    const pane = this.ownPane();
    if (pane && shared(PANE)?.pane === pane.pane) setShared(PANE, null);
    if (pane) run("pane.close", { pane: pane.pane });
  }

  /** Out of Fireflies: the popped-out window takes the video, this player goes. */
  popOut() {
    const t = theme();
    this.call("pip.popOut", { colors: { background: t.background, foreground: t.foreground, dim: t.dim, border: t.border, hover: t.ansi0 } });
    if (!this.error) this.leave();
  }

  /** Into a new pane beside the focused one, in the shown tab (`park`: one
   *  that parks itself, a chip). The new pane's player takes the video;
   *  this one then gets `pip.moved` and goes. */
  intoPane(park) {
    const of = props()?.of;
    if (!of) return;
    const before = new Set(panes().map((p) => p.pane));
    const f = focused();
    const args = f?.pane ? { direction: "right", pane: f.pane } : { edge: "right" };
    run("pane.split", { ...args, mod: MOD, props: { of, pane: true, ...(park ? { park: true } : {}) } });
    // Noted when the new pane takes the video (`pip.moved`).
    this.made = { of, before, park: Boolean(park) };
  }

  /** Notes the pane `intoPane` made, for it to find itself. */
  noteMade() {
    const m = this.made;
    this.made = null;
    const made = m && panes().find((p) => !m.before.has(p.pane) && p.mod === MOD);
    if (made) setShared(PANE, { of: m.of, pane: made.pane, park: m.park });
  }

  controls() {
    return CONTROLS.filter((c) => !(c.window && this.inPane));
  }

  mark(c, color, s) {
    return c.icon ? svg(`${ICONS}/${val(c.icon, s)}.svg`).size(12).text_color(color) : div().text_color(color).child(val(c.glyph, s));
  }

  /** Under the pointer: bright on the hover color, its `name` in the title. */
  hovers(el, id, name) {
    return el.on_hover((h, cx) => {
      if (h) this.hover = { id, name };
      else if (this.hover?.id === id) this.hover = null;
      cx.notify();
    });
  }

  button(t, c) {
    const s = { playing: this.playing, muted: this.muted };
    const on = this.hover?.id === c.id;
    return this.hovers(div().id(`pip-${c.id}`).flex_none().w(BAR).h_full().flex().items_center().justify_center()
      .when(on, (el) => el.bg(t.ansi0)), c.id, val(c.name, s))
      // A press on a button isn't a drag of the window.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.command(c.id); cx.notify(); })
      .child(this.mark(c, on ? t.foreground : t.dim, s));
  }

  /** ⋯: the controls that didn't fit, as a popup under the pointer. */
  more(t, ids) {
    const on = this.hover?.id === "more";
    return this.hovers(div().id("pip-more").flex_none().w(BAR).h_full().flex().items_center().justify_center()
      .text_color(on ? t.foreground : t.dim).when(on, (el) => el.bg(t.ansi0)), "more", "More")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.openMore(ids); })
      .child("⋯");
  }

  openMore(ids) {
    openOverlay({ mod: MOD, kind: "popup", frame: "none", width: 240, height: ids.length * ROW + 10,
      props: { menu: ids, playing: this.playing, muted: this.muted } });
  }

  bar(t) {
    const { shown, more } = fit(this.controls(), this.width);
    const items = shown.map((c) => this.button(t, c));
    // The ⋯ goes before ✕, the last on the bar.
    if (more.length) items.splice(items.length - 1, 0, this.more(t, more.map((c) => c.id)));
    // The bar's edge turns blue while the player has the keyboard.
    return h_flex().id("pip-bar").h(BAR).flex_none().pl(8).items_center().text_size(11).bg(t.background)
      .border_b(1).border_color(this.handle?.is_focused?.() ? t.accent : t.border)
      .child(div().flex_1().min_w(0).truncate().text_color(this.error ? t.blocked : this.hover ? t.foreground : t.dim)
        .child(this.error ?? this.hover?.name ?? "picture in picture"))
      .children(items);
  }

  render() {
    const t = theme();
    if (this.keysList) return this.renderKeys(t);
    if (this.menu) return this.renderMenu(t);
    const of = props()?.of;
    const body = available() && of
      ? herdr.nativeView.new(ID, { kind: "pip", of }).child(div().size_full().bg("#000000"))
      : div().size_full().flex().items_center().justify_center().text_size(11).text_color(t.dim).child("Picture in picture needs native views (macOS).");
    return v_flex().id("pip").size_full().bg(t.background).when(!this.inPane, (el) => el.border(1).border_color(t.border))
      .when(Boolean(this.handle), (el) => el.track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
        .on_mouse_down("left", () => this.handle.focus()))
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) >= 1) { this.width = size.width; cx.notify(); } })
      .child(this.bar(t))
      .child(div().flex_1().min_h(0).relative().child(body));
  }

  // ---- the ⋯ menu (props { menu: control ids, playing, muted })

  initMenu(cx) {
    this.cursor = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  pick(c) {
    closeOverlay(props()?.overlay);
    // To the player (commands reach the shown copies; this one ignores them).
    run(`nocturne-pip.${c.id}`);
  }

  /** The keys, keyhelp.js's overview in a popup: ? esc q close it. */
  renderKeys(t) {
    const close = () => closeOverlay(props()?.overlay);
    return div().id("pip-keys").relative().size_full().bg(t.background).border(1).border_color(t.ansi0)
      .track_focus(this.handle)
      .on_key_down((e, cx) => { if (keysKey(e, true)) { cx.stop_propagation(); close(); } })
      .child(keysView(t, { id: "pip-keys-view", title: "picture in picture", list: KEYS, narrow: true, close }));
  }

  renderMenu(t) {
    const p = props() ?? {};
    const s = { playing: Boolean(p.playing), muted: Boolean(p.muted) };
    const items = CONTROLS.filter((c) => this.menu.includes(c.id));
    this.cursor = Math.min(this.cursor, Math.max(0, items.length - 1));
    const row = (c, i) => {
      const on = i === this.cursor;
      return h_flex().id(`pm-${c.id}`).relative().h(ROW).px(12).gap(10).items_center().flex_none().text_size(12)
        .text_color(on ? t.foreground : t.muted)
        .on_hover((h, cx) => { if (h) { this.cursor = i; cx.notify(); } })
        .on_click(() => this.pick(c))
        .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
        .child(div().relative().w(14).flex_none().flex().items_center().justify_center().child(this.mark(c, on ? t.accent : t.dim, s)))
        .child(div().relative().flex_1().min_w(0).truncate().child(val(c.name, s)));
    };
    return v_flex().id("pip-menu").size_full().bg(t.background).border(1).border_color(t.ansi0).py(4)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const k = e.key;
        const to = menuMove(k, this.cursor, items.length);
        if (to != null) {
          this.cursor = to;
          return cx.notify();
        }
        if (k === "enter" && items[this.cursor]) return this.pick(items[this.cursor]);
        if (k === "escape" || k === "q") closeOverlay(props()?.overlay);
      })
      .children(items.map(row));
  }
}
