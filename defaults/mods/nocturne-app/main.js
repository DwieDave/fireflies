// Nocturne app: another application shown in a pane, on the native-view
// element's `app` kind (DwieDave fork). macOS can't put another app's window
// inside ours, so its real window is launched and kept over this pane: moved
// and sized with it, just above Fireflies' window, hidden while the pane isn't
// shown. A click on it focuses this pane; this pane's focus (pane.go, cmd-d
// then arrows) gives it the keyboard.
//
//   bar     the app's name; ↗ brings it forward; ⟳ starts it again after it
//           quit; × closes the pane (and quits the app, if the pane started it)
//   empty   "Choose an app…" opens the system picker (any .app)
//
// Props: { path?, instance?: "shared" | "new", slot? }. Without `path` it asks
// for one; the choice is remembered per slot (localStorage), so a pane kept
// across restarts starts its app again.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as herdr from "herdr";
import { props, theme, nextCommand, exec, run, panes } from "herdr";

const CHROME = (n) => `mods/workspace-chrome/${n}.svg`;
const ACCESSIBILITY = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

const available = () => typeof herdr.nativeView?.new === "function";
const appName = (path) => (path ?? "").replace(/\/+$/, "").split("/").pop()?.replace(/\.app$/, "") ?? "";

export default class AppPane extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    let saved = null;
    try { saved = localStorage.getItem("path"); } catch {}
    this.path = pr.path || saved || null;
    this.instance = pr.instance === "new" ? "new" : "shared";
    // A new id starts the app again (a new view) after it quit.
    this.run = 0;
    this.status = this.path ? "launching" : "empty";
    this.name = appName(this.path);
    this.permission = true;
    this.error = null;
    if (available()) {
      cx.spawn(async (cx) => {
        for (;;) {
          let e;
          try { e = JSON.parse(await herdr.nextNativeViewEvent()); } catch { return; }
          this.onEvent(e);
          cx.notify();
        }
      });
    }
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^nocturne-app\./, "");
        if (c === "focus") this.call("focus");
        cx.notify();
      }
    });
  }

  id() { return `app-${this.run}`; }

  onEvent(e) {
    if (e.id !== this.id()) return;
    const d = e.data ?? {};
    if (e.event === "app.launched") { this.status = "running"; this.name = d.name || this.name; this.error = null; }
    else if (e.event === "app.window") this.status = "shown";
    else if (e.event === "app.terminated") this.status = "quit";
    else if (e.event === "app.permission") this.permission = Boolean(d.granted);
    else if (e.event === "load.error") { this.status = "error"; this.error = d.message ?? "The app didn't start."; }
  }

  call(action, args) {
    try { return herdr.nativeViewCall(this.id(), action, args ?? {}); } catch (err) { this.error = String(err?.message ?? err); return null; }
  }

  async choose(cx) {
    const path = await herdr.pickFile({ prompt: "Show in this pane" }).catch(() => null);
    if (!path) return;
    if (!/\.app\/?$/.test(path)) { this.error = `${appName(path) || path} isn't an app.`; cx.notify(); return; }
    this.path = path.replace(/\/+$/, "");
    this.name = appName(this.path);
    try { localStorage.setItem("path", this.path); } catch {}
    this.status = "launching";
    this.error = null;
    this.run += 1;
    cx.notify();
  }

  again(cx) {
    this.status = "launching";
    this.error = null;
    this.run += 1;
    cx.notify();
  }

  /** This copy's pane: the focused app pane (a click on the bar focuses it). */
  close() {
    const mine = panes().find((x) => x.mod === "nocturne-app" && x.focused);
    if (mine) run("pane.close", { pane: mine.pane });
  }

  // ---- parts

  icon(t, id, name, action) {
    return div().id(id).size(24).flex_none().flex().items_center().justify_center()
      .text_color(t.muted).hover((s) => s.text_color(t.foreground).bg(t.ansi0))
      // The press goes on to the pane too, which Herdr then focuses.
      .on_click((_e, cx) => { action(cx); cx.notify(); })
      .child(svg(CHROME(name)).size(13));
  }

  bar(t) {
    const word = { launching: "starting…", running: "waiting for its window…", shown: "", quit: "quit", error: "didn't start", empty: "" }[this.status] ?? "";
    return h_flex().id("bar").h(32).flex_none().px(8).gap(6).items_center().text_size(11)
      .child(svg(CHROME("square")).size(12).flex_none().text_color(this.status === "shown" ? t.accent : t.dim))
      .child(div().flex_none().text_color(t.foreground).child(this.name || "App"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(word))
      .when(Boolean(this.path), (el) => el.child(this.icon(t, "choose", "folder", (cx) => this.choose(cx))))
      .when(this.status === "shown" || this.status === "running", (el) => el.child(this.icon(t, "front", "panel-right", () => this.call("app.activate"))))
      .when(this.status === "quit" || this.status === "error", (el) => el.child(this.icon(t, "again", "chevron-right", (cx) => this.again(cx))))
      .child(this.icon(t, "close", "x", () => this.close()));
  }

  blank(t, title, hint, action) {
    return v_flex().flex_1().items_center().justify_center().gap(10).px(16).text_size(11)
      .child(svg("mods/nocturne/art/moon-8.svg").w(44).h(44).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child(title))
      .when(Boolean(hint), (el) => el.child(div().text_center().text_color(t.ansi8).child(hint)))
      .when(Boolean(action), (el) => el.child(div().id("action").px(10).py(4).border(1).border_color(t.ansi8)
        .text_color(t.foreground).hover((s) => s.border_color(t.accent))
        .on_click((_e, cx) => { action[1](cx); cx.notify(); })
        .child(action[0])));
  }

  render() {
    const t = theme();
    let body;
    if (!available()) body = this.blank(t, "This Fireflies has no native views", "An app pane needs the DwieDave fork (native-view/0).");
    else if (!this.path) body = this.blank(t, "No app yet", "Any app: its window is kept over this pane.", ["Choose an app…", (cx) => this.choose(cx)]);
    else if (this.status === "quit") body = this.blank(t, `${this.name} quit`, null, ["Start it again", (cx) => this.again(cx)]);
    else {
      const hint = !this.permission
        ? "Fireflies needs Accessibility access to move its window here: System Settings › Privacy & Security › Accessibility."
        : this.status === "error" ? this.error : this.status === "shown" ? null : "Its window is kept over this pane.";
      const action = !this.permission ? ["Open Accessibility settings", () => exec("open", [ACCESSIBILITY]).catch(() => {})] : null;
      body = div().flex_1().min_h(0).relative().child(herdr.nativeView.new(this.id(), { kind: "app", path: this.path, instance: this.instance })
        .child(this.blank(t, this.status === "shown" ? this.name : `Starting ${this.name}…`, hint, action)));
    }
    return v_flex().id("app").size_full().bg(t.background)
      .child(this.bar(t))
      .when(Boolean(this.error) && this.status !== "error", (el) => el.child(div().flex_none().px(10).py(4).text_size(11).text_color(t.blocked).child(this.error)))
      .child(body);
  }
}
