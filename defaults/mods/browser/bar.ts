// The bar's drawing: its buttons, the address (host bright, path dim), the
// error line with retry, the keys button, a blank page's words, the web view.

import { div, svg } from "gpui-kit";
import type { Context, Element } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import * as herdr from "herdr";
import type { Theme } from "herdr";
import { keysHint } from "./keyhelp.ts";
import * as Tabs from "./tabs.ts";
import type { Tab } from "./tabs.ts";
import { dither } from "./dither.ts";
import { retry, external, editAddress } from "./address.ts";
import { toggleInspector } from "./inspector.ts";
import { ICONS, available } from "./props.ts";
import type Browser from "./main.ts";

/** An address split for the bar: host, then the rest. */
export function parts(href: string | null): readonly [string, string] {
  const m = /^[a-z]+:\/\/([^/?#]+)(.*)$/i.exec(href ?? "");
  const host = m?.[1], rest = m?.[2];

  return host !== undefined && rest !== undefined ? [host.replace(/^www\./, ""), rest === "/" ? "" : rest] : [href ?? "", ""];
}

/** A bar button; `focus`: the press goes on to the pane too, which Fireflies then focuses. */
export function barIcon(view: Browser, t: Theme, id: string, name: string, enabled: boolean, action: (cx: Context) => void, focus = false): Element {
  const ringed = view.control(id, enabled, action);

  return div().id(id).relative().size(24).flex_none().flex().items_center().justify_center()
    .text_color(ringed ? t.foreground : enabled ? t.muted : t.ansi0)
    .when(ringed, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
    .when(enabled, (el) => el.hover((s) => s.text_color(t.foreground).bg(t.ansi0)))
    .on_mouse_down("left", (e, cx) => (focus ? view.claim() : view.stop(e, cx)))
    .on_click((_e, cx) => {
      if (enabled) {
        view.claim();
        action(cx);
        cx.notify();
      }
    })
    .child(svg(`${ICONS}/${name}.svg`).size(13));
}

export function addressField(view: Browser, t: Theme): Element {
  if (view.editing && view.input) {
    return div().id("address-edit").flex_1().min_w(0).h(22).px(6).flex().items_center().border(1).border_color(t.accent)
      .on_mouse_down("left", (e, cx) => view.stop(e, cx))
      .child(Input.new(view.input).w_full().text_size(11).text_color(t.foreground));
  }

  const [host, rest] = parts(view.page.href);
  const ringed = view.control("address", true, () => editAddress(view));

  return h_flex().id("address").relative().flex_1().min_w(0).h(22).px(6).items_center().gap(0).text_size(11)
    .hover((s) => s.bg(`${t.ansi0}66`))
    .when(ringed, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
    .on_mouse_down("left", (e, cx) => view.stop(e, cx))
    .on_click((_e, cx) => {
      editAddress(view);
      cx.notify();
    })
    .child(div().flex_none().max_w_full().truncate().text_color(t.foreground).child(host || "blank"))
    .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(rest));
}

export function barView(view: Browser, t: Theme): Element {
  const p = view.page, loading = p.loading && Boolean(view.start);

  return h_flex().id("bar").relative().h(32).flex_none().px(6).gap(4).items_center()
    .on_size_change((size, cx) => {
      if (Math.abs(size.width - view.barW) > 1) {
        view.barW = size.width;
        cx.notify();
      }
    })
    .child(barIcon(view, t, "back", "arrow-left", p.canGoBack, () => view.command("back")))
    .child(barIcon(view, t, "forward", "arrow-right", p.canGoForward, () => view.command("forward")))
    .child(barIcon(view, t, "reload", loading ? "x" : "rotate-cw", Boolean(view.start), () => view.command("reload")))
    .child(addressField(view, t))
    .child(barIcon(view, t, "zoom-out", "minus", view.zoom > 0.5, () => view.command("zoom_out")))
    .child(div().id("zoom").relative().flex_none().w(34).text_center().text_size(11)
      .text_color(view.control("zoom", true, () => view.command("zoom_reset")) ? t.foreground : t.dim)
      .when(view.ring === "zoom" && view.barFocused, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)))
      .hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", (e, cx) => view.stop(e, cx))
      .on_click((_e, cx) => {
        view.command("zoom_reset");
        cx.notify();
      })
      .child(`${Math.round(view.zoom * 100)}%`))
    .child(barIcon(view, t, "zoom-in", "plus", view.zoom < 3, () => view.command("zoom_in")))
    // focus: the press focuses this pane first, so the pane hidden for the player is this one.
    .when(Boolean(view.start && available() && (view.video || view.away)), (el) => el.child(barIcon(view, t, "pip", "picture-in-picture", true, () => view.command("pip"), true)))
    .child(barIcon(view, t, "inspect", "code", Boolean(view.start && available()), (cx) => toggleInspector(view, cx), true))
    .child(barIcon(view, t, "external", "external-link", Boolean(view.start && p.href), () => external(view)))
    .child(keysButton(view, t))
    // Loading: a dithered line along the bar's foot, as far as the page has come.
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)))
    .when(loading, (el) => el.child(div().absolute().left(0).bottom(0).h(2)
      .w(Math.max(8, view.barW * Math.min(1, p.progress || 0.05))).transition("width", 180)
      .child(dither(t.accent, 1))));
}

/** What went wrong, under the bar, with "retry" (r too) when a page failed. */
export function errorLine(view: Browser, t: Theme): Element {
  const page = Boolean(view.start && available() && view.tab.failed);

  return h_flex().id("error").flex_none().px(10).py(4).gap(10).items_center().text_size(11)
    .child(div().flex_1().min_w(0).text_color(t.blocked).child(view.error ?? ""))
    .when(page, (el) => el.child(div().id("retry").flex_none().px(4).text_color(t.muted)
      .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
      .on_mouse_down("left", (e, cx) => view.stop(e, cx))
      .on_click((_e, cx) => {
        retry(view);
        cx.notify();
      })
      .child("retry  r")));
}

/** ? keys, the bar's last control (keyhelp.ts); tab rings it like the others. */
export function keysButton(view: Browser, t: Theme): Element {
  const toggle = () => {
    view.keysShown = !view.keysShown;
  };

  const ringed = view.control("keys", true, toggle);

  return keysHint(t, "keys", view.keysShown || ringed, toggle).relative().h(24).px(4)
    .when(ringed, (el) => el.child(div().absolute().inset_0().border(1).border_color(t.accent)));
}

export function blankPage(view: Browser, t: Theme, title: string, hint: string | null): Element {
  return v_flex().flex_1().items_center().justify_center().gap(10).px(16).text_size(11)
    .child(svg("mods/nocturne/art/moon-8.svg").w(44).h(44).text_color(t.ansi8).opacity(0.6))
    .child(div().text_color(t.foreground).child(title))
    .when(Boolean(hint), (el) => el.child(div().text_center().text_color(t.ansi8).child(hint ?? "")));
}

/** Tab `tab`'s page: a WebKit view of its own (id: the tab's), on `start`. The mod's
 *  children sit under it: seen while it loads, or while a Fireflies menu or
 *  dialog makes the view step aside. `tabs`: what would open a window
 *  comes as web.newTab. */
export function webView(view: Browser, t: Theme, tab: Tab, start: string): Element {
  return herdr.nativeView.new(tab.id, { kind: "web", ...Tabs.source(start), persist: true, zoom: tab.zoom, pip: true, tabs: true })
    .child(view.away && tab === view.tab
      ? blankPage(view, t, "Playing in picture in picture", "↩ in the player brings it back here.")
      : blankPage(view, t, tab.page.loading ? "Loading…" : "", tab.page.href));
}
