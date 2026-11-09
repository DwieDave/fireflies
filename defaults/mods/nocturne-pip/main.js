// Nocturne picture in picture: the video a browser pane put in Picture in
// Picture, in a Herdr window (drag it by its bar) that stays over every tab
// and space. Square, like the rest of Nocturne.
//
//   ↩    back to the pane it came from (it plays on there)
//   ⇱    out of Herdr: a window above every app and space (its ⇲ brings it back)
//   ❚❚ ▶ pause / play
//   ✕    close: the video goes back to its page, paused
//
// Opened by nocturne-browser (`openOverlay` kind "window", key "nocturne-pip");
// props: { of: the browser's web view key, overlay }. Any site's video works:
// WebKit's own Picture in Picture does the playing (native view `pip`).

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as herdr from "herdr";
import { props, theme, closeOverlay } from "herdr";

const ID = "pip";
const BAR = 22;

const available = () => typeof herdr.nativeView?.new === "function";

export default class Pip extends View {
  init(_p, cx) {
    this.playing = true;
    this.error = null;
    if (!available()) return;
    cx.spawn(async (cx) => {
      for (;;) {
        let e;
        try { e = JSON.parse(await herdr.nextNativeViewEvent()); } catch { return; }
        // Picture in Picture ended (here, in its page or elsewhere): nothing left to show.
        if (e.event === "pip.ended") return this.close();
        if (e.event === "pip.state" && e.data?.result) this.playing = e.data.result === "playing";
        cx.notify();
      }
    });
  }

  call(action, args) {
    try { return herdr.nativeViewCall(ID, action, args ?? {}); }
    catch (err) { this.error = String(err?.message ?? err); return null; }
  }

  close() {
    closeOverlay(props()?.overlay);
  }

  /** Out of Herdr: the popped-out window takes the video, this window goes. */
  popOut() {
    const t = theme();
    this.call("pip.popOut", { colors: { background: t.background, foreground: t.foreground, dim: t.dim, border: t.border } });
    if (!this.error) this.close();
  }

  button(t, id, label, go) {
    return div().id(`pip-${id}`).flex_none().w(BAR).h_full().flex().items_center().justify_center().text_color(t.dim)
      .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
      // A press on a button isn't a drag of the window.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); go(); cx.notify(); })
      .child(label);
  }

  bar(t) {
    return h_flex().id("pip-bar").h(BAR).flex_none().pl(8).items_center().text_size(11).bg(t.background)
      .border_b(1).border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(this.error ?? "picture in picture"))
      .child(this.button(t, "back", "↩", () => { this.call("pip.back"); this.close(); }))
      .child(this.button(t, "out", "⇱", () => this.popOut()))
      .child(this.button(t, "play", this.playing ? "❚❚" : "▶", () => this.call("pip.toggle")))
      .child(this.button(t, "close", "✕", () => { this.call("pip.close"); this.close(); }));
  }

  render() {
    const t = theme();
    const of = props()?.of;
    const body = available() && of
      ? herdr.nativeView.new(ID, { kind: "pip", of }).child(div().size_full().bg("#000000"))
      : div().size_full().flex().items_center().justify_center().text_size(11).text_color(t.dim).child("Picture in picture needs native views (macOS).");
    return v_flex().id("pip").size_full().bg(t.background).border(1).border_color(t.border)
      .child(this.bar(t))
      .child(div().flex_1().min_h(0).relative().child(body));
  }
}
