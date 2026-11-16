// The Markdown viewer's bars (main.ts draws the page between them): the
// toolbar on top with its chips (‹ back, raw / rendered, edit, files, ? keys),
// the chosen link's bar at the foot, the keys strip ? opens, the empty page
// (no file, or why it can't be shown), and the dither they're drawn on, which
// the page's chosen block uses too. Used by main.ts's view, whose methods of
// the same names forward here.

import { div, svg, PathBuilder, Background } from "gpui-kit";
import type { Color, Context, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import { settings, home, window as appWindow } from "herdr";
import { basename, dirname, tilde } from "./paths.ts";
import type { DocLink } from "./links.ts";
import { keysHint, keysView } from "@fireflies/keyhelp";
import type { KeyRow } from "@fireflies/keyhelp";
import { edge as edgeTone } from "@fireflies/tones";
import type { default as Markdown } from "./main.ts";
import { flat } from "@fireflies/layout-look";

const ART = "mods/nocturne/art";

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

/** A 50% checker dither filling the parent (same as ../nocturne/kit.ts). */
export function dither(color: Color, cell = 1): Element {
  const plain = flat(color, cell);

  if (plain) return plain;

  const dpr = appWindow().platform === "macos" ? 2 : 1;
  const zoom = settings().zoom || 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

/** A toolbar chip: its label, lit (dithered, an accent underline) when `on`; a click runs `action`. */
export function chip(t: Theme, id: string, label: string, action: (cx: Context) => void, on = false): Element {
  return h_flex().id(id).relative().h(20).px(6).flex_none().items_center()
    .text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => {
      cx.stop_propagation();
      action(cx);
      cx.notify();
    })
    .when(on, (el) => el.child(dither(edgeTone(t), 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)))
    .child(div().relative().child(label));
}

/** The bar on top: MD, ‹ back, the file and its folder, raw / rendered, edit, files, ? keys. */
export function toolbar(v: Markdown, t: Theme): Element {
  const w = v.width;

  return h_flex().id("md-toolbar").relative().h(34).flex_none().px(10).gap(8).items_center().text_size(11)
    .when(w >= 320, (el) => el.child(div().flex_none().text_color(t.muted).child("MD")))
    .when(v.history.length > 0, (el) => el.child(v.chip(t, "md-back", "‹", (cx) => v.back(cx))))
    .child(h_flex().flex_1().min_w(0).gap(6).items_baseline()
      .child(div().flex_none().max_w_full().truncate().text_color(t.foreground).child(basename(v.path || "Markdown")))
      .when(w >= 420 && Boolean(v.path), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim)
        .child(`${v.on ? v.on + ":" : ""}${tilde(dirname(v.path), home())}`))))
    .child(v.chip(t, "md-raw", v.raw ? "raw" : "rendered", () => {
      v.raw = !v.raw;
    }, v.raw))
    .when(Boolean(v.path), (el) => el
      .child(v.chip(t, "md-edit", "edit", () => v.edit()))
      .when(w >= 300, (e2) => e2.child(v.chip(t, "md-files", "files", () => v.revealFolder()))))
    .child(keysHint(t, "md-keys", Boolean(v.keysShown), () => {
      v.keysShown = !v.keysShown;
    }).ml(4))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(edgeTone(t), 1)));
}

/** The page when there's nothing to show: the moon, a title, a hint. */
export function empty(t: Theme, title: string, hint: string): Element {
  return v_flex().size_full().items_center().justify_center().gap(10).px(16).text_size(11)
    .child(svg(`${ART}/moon-8.svg`).w(44).h(44).text_color(t.muted).opacity(0.6))
    .child(div().text_color(t.foreground).child(title))
    .when(Boolean(hint), (el) => el.child(div().text_center().text_color(t.muted).child(hint)));
}

/** `?`: every key (`list`), in the page's place (keyhelp.ts); `close` puts it away. */
export function keysStrip(t: Theme, list: readonly KeyRow[], close: () => void): Element {
  return keysView(t, { id: "md-keys-strip", title: "markdown", list, close });
}

/** The chosen link, at the foot of the page: what it says and where it goes (`sel` of `count`). */
export function linkBar(t: Theme, l: DocLink, sel: number, count: number): Element {
  return h_flex().id("md-link").absolute().left(0).right(0).bottom(0).h(24).px(10).gap(8).items_center().text_size(11).bg(t.background)
    .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(edgeTone(t), 1)))
    .child(div().flex_none().text_color(t.accent).child("enter"))
    .child(div().flex_none().max_w(260).truncate().text_color(t.foreground).child(`${l.image ? "▧ " : ""}${l.text}`))
    .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(l.href))
    .child(div().flex_none().text_color(t.dim).child(`${sel + 1}/${count}`));
}
