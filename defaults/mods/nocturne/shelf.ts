// The shelf at the jar's foot (sky.ts, meadow.ts): pinned panes that aren't
// agents as tiles, their names (a web pane's by its page, webName) and
// favicons (webIcon), where each is, the "+" tile and its menu of what can go
// into the dock (any pane: the focused one, a new web pane, shell or files pane).

import { div, svg, image } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { shared, focused } from "herdr";
import type { Theme } from "herdr";
import { isString, object, readSharedMap, sharedMapKey } from "./guard.ts";
import { isRawObject, mapOf } from "./guards.ts";
import { dither, givenName, goToPin, cornerTicks } from "./kit.ts";
import { openMenu } from "./menu.ts";
import type { JarItem } from "./pins.ts";
import { markPath, modKind, paneName, paneMenu } from "./header.ts";
import { stop, SHELF_PAD, TILE, TILE_GAP, BOARD, BOARD_GAP, paneOf } from "./sky-plan.ts";
import { pinActs } from "./sky-keys.ts";
import type Sky from "./sky.ts";

/** A web pane's props, as far as its name goes: its slot and the address it opened on. */
export const isWebProps = object({}, { slot: isString, url: isString });

/** The browser's page titles, by slot; its tabs' titles, by slot and tab. */
export const TITLES = sharedMapKey("browser.titles", isString);
export const TAB_TITLES = sharedMapKey("browser.tab-titles", isRawObject);

/** A web pane's name on the shelf: its page's title, if browser
 *  notes it by slot in shared `browser.titles` (as the viewers do
 *  theirs), else the host it opened on (props.url), else "Web". One of its
 *  tabs (`tab`, a tab pin): that tab's title (`browser.tab-titles`). */
export function webName(p: { readonly props?: unknown } | null | undefined, tab: string | null = null): string {
  const pr = isWebProps(p?.props) ? p.props : {};
  const slot = pr.slot;
  const tabs = slot === undefined || !tab ? undefined : readSharedMap(shared, TAB_TITLES).get(slot);
  const title = slot === undefined ? null : tab ? (tabs ? mapOf(tabs).get(tab) : undefined) : readSharedMap(shared, TITLES).get(slot);

  if (title) return String(title);

  try {
    return new URL(String(pr.url)).host || "Web";
  } catch {
    return "Web";
  }
}

/** The browser's favicons (browser/favicons.ts): the shown tab's by slot; every tab's by slot, then by tab. */
export const PAGE_ICONS = sharedMapKey("browser.icons", isString);
export const TAB_ICONS = sharedMapKey("browser.tab-icons", isRawObject);

/** A web pane's favicon on the shelf, as image() takes it (a file in the browser's
 *  cache folder): its shown tab's, or one tab's (`tab`, a tab pin). Null: none known
 *  yet (the tile wears the web pane's mark). */
export function webIcon(p: { readonly props?: unknown } | null | undefined, tab: string | null = null): string | null {
  const slot = isWebProps(p?.props) ? p.props.slot : undefined;

  if (slot === undefined) return null;

  const tabs = tab ? readSharedMap(shared, TAB_ICONS).get(slot) : undefined;
  const icon = tab ? (tabs ? mapOf(tabs).get(tab) : undefined) : readSharedMap(shared, PAGE_ICONS).get(slot);

  return isString(icon) && icon.startsWith("cache/browser-icons/") ? icon : null;
}

/** On screen now: its tab is the shown one of the shown space, not parked. */
export function pinLit(sky: Sky, it: JarItem): boolean {
  const p = paneOf(it);

  return Boolean(p) && !p?.parked && sky.shownTabs.has(p?.tab ?? "");
}

/** It holds the focus: the focused pane, or the focused terminal. */
export function pinFocus(it: JarItem): boolean {
  const f = focused();

  return it.kind === "pane" ? Boolean(f?.pane) && f?.pane === it.pane.pane : Boolean(f?.terminal) && f?.terminal === it.key;
}

/** What a tile is called: the pane's name (header.ts paneName), a terminal's given name. */
export function pinName(it: JarItem): string {
  const p = paneOf(it);

  if (p?.mod === "browser") return webName(p, it.kind === "pane" ? (it.tab ?? null) : null);

  if (p) return paneName(p);

  return givenName(it.key) ?? (it.kind === "terminal" ? it.terminal.name : null) ?? "shell";
}

/** Where and what a tile is: its kind ("web", "editor", "shell"), its space when
 *  that's not the shown one, "parked". The kind goes when the name says it already. */
export function pinWhere(sky: Sky, it: JarItem): string {
  const p = paneOf(it);
  const program = p?.program;
  const kind = it.kind === "pane" ? modKind(p) : (program?.name && !program.shell ? program.name : "shell");
  const space = p ? sky.tabSpace.get(p.tab) : null;

  return [kind && kind.toLowerCase() !== pinName(it).toLowerCase() ? kind : null,
    space && space.id !== sky.shownSpace ? space.name : null, p?.parked ? "parked" : null].flatMap((x) => (x ? [x] : [])).join(" · ");
}

/**
 * A pinned pane's tile, `size` px: its mark (header.ts markPath; a web page's
 * favicon, webIcon) on the dark
 * plate in a square frame. Lit (on screen now) the frame brightens and the
 * tile is moonlit; under the pointer a grey plate; the focused one wears the
 * corner ticks, the keyboard's cursor a blue ring. A click goes to it, a
 * right-click opens its pane's menu.
 */
export function pinTile(sky: Sky, t: Theme, it: JarItem, size = TILE): Element {
  const on = sky.nav(`pin:${it.key}`, "flies", pinActs(it));

  if (on) sky.tileOn = it.key;

  const lit = pinLit(sky, it);
  const focus = pinFocus(it);
  const hot = sky.tileHover === it.key;
  const small = size < TILE;
  const glyph = small ? 12 : 14;
  const plate = glyph + 2;
  const at = (size - plate) / 2;
  const where = pinWhere(sky, it);
  const p = paneOf(it);
  const icon = p?.mod === "browser" ? webIcon(p, it.kind === "pane" ? (it.tab ?? null) : null) : null;
  const bright = lit || on || focus || hot;

  return div().id(`pin-${it.key}`).relative().size(size).flex_none().flex().items_center().justify_center()
    .tooltip(`${pinName(it)}${where ? ` · ${where}` : ""}`)
    .on_hover((h, cx) => {
      if (h ? sky.tileHover !== it.key : sky.tileHover === it.key) {
        sky.tileHover = h ? it.key : null;
        cx.notify();
      }
    })
    .on_mouse_down("left", stop)
    .on_mouse_down("right", (_e, cx) => {
      cx.stop_propagation();

      if (p) paneMenu(p);
    })
    .on_click(() => goToPin(it))
    .when(lit, (el) => el.child(div().absolute().top(1).left(1).size(size - 2).opacity(0.35).child(dither(t.ansi4, 1))))
    .when(hot, (el) => el.child(div().absolute().top(0).left(0).size_full().bg(`${t.ansi0}88`)))
    .child(div().absolute().top(0).left(0).size_full().border(1).border_color(lit ? t.ansi8 : t.ansi0))
    .child(div().absolute().top(at).left(at).size(plate).bg(t.background))
    // A web page's favicon (its own colours, a little dimmer while not lit), else the pane's mark.
    .child(icon ? image(icon).id(`pin-icon-${it.key}`).size(glyph).flex_none().opacity(bright ? 1 : 0.75)
      : svg(markPath(p)).size(glyph).flex_none().text_color(bright ? t.foreground : t.muted))
    .when(focus, (el) => el.children(cornerTicks(t, small ? 2 : 3)))
    .when(on, (el) => el.child(div().absolute().top(-2).left(-2).size(size + 4).border(1).border_color(t.accent)));
}

/** The dock's menu (menu.ts dockItems): what can go into the dock, pinned
 *  here. At the pointer, or `centered` (from the keyboard). */
export function dockMenu(centered = false): void {
  openMenu({ tab: "dock" }, { width: 240, centered });
}

/** The shelf's last tile, "+": what can go into the dock (dock.ts), pinned
 *  here (dockMenu: the focused pane, a new web pane, shell or files pane).
 *  Dimmer than the tiles, a dotted frame: a place, not a pane. */
export function newTile(sky: Sky, t: Theme, size = TILE): Element {
  const on = sky.nav("shelf-new", "flies", { go: () => dockMenu(true), menu: () => dockMenu(true) });

  if (on) sky.tileOn = "shelf-new";

  const hot = sky.tileHover === "shelf-new";

  return div().id("shelf-new").relative().size(size).flex_none().flex().items_center().justify_center()
    .tooltip("Into the dock: this pane, a web page, a shell, files")
    .on_hover((h, cx) => {
      if (h ? sky.tileHover !== "shelf-new" : sky.tileHover === "shelf-new") {
        sky.tileHover = h ? "shelf-new" : null;
        cx.notify();
      }
    })
    .on_mouse_down("left", stop)
    .on_click(() => dockMenu())
    .when(hot, (el) => el.child(div().absolute().top(0).left(0).size_full().bg(`${t.ansi0}88`)))
    .child(div().absolute().top(0).left(0).size_full().opacity(0.5).child(dither(t.ansi0, 1)))
    .child(div().absolute().top(1).left(1).size(size - 2).bg(t.background))
    .child(svg("mods/workspace-chrome/plus.svg").size(12).flex_none().text_color(hot || on ? t.foreground : t.dim))
    .when(on, (el) => el.child(div().absolute().top(-2).left(-2).size(size + 4).border(1).border_color(t.accent)));
}

/** The shelf at the jar's foot, `w` wide: a dithered board and the tiles in
 *  rows in the order pinned, the "+" tile last. Each tile names itself in its
 *  tooltip; the shelf has no caption line. */
export function shelfView(sky: Sky, t: Theme, kept: readonly JarItem[], w: number): Element {
  sky.tileOn = null;

  const tiles = [...kept.map((it) => pinTile(sky, t, it)), newTile(sky, t)];

  return v_flex().id("shelf").w(w)
    .child(div().relative().h(BOARD).mx(4).mb(BOARD_GAP).opacity(0.7).child(dither(t.ansi8, 1)))
    .child(h_flex().flex_wrap().px(SHELF_PAD).gap(TILE_GAP).children(tiles));
}
