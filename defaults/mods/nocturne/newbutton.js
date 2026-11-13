// "+ new" at the far right of the tab row, after the bell: a layout block of
// its own ({ role: "newbutton" }, right of the notifications bell's), so it is
// the toolbar's last control. A rule like the strip's sets it off from the
// bell. Its menu (newmenu.js) hangs under it, right edges lined up (kit.js
// dropBelow), so it ends 8 px inside the window; a second press closes it
// (tabs.js tool says why the press goes by `wasOpen`). Lit while the menu is
// open. The strip's keyboard walk ends on it (tabs.js collect): its blue ring
// comes from shared(nav.js CURSOR), region "new".
//
// The block is as wide as the button plus END: it ends where the panes below
// end. It sizes its own block (layout.resize) when the button's width changes.
// A layout without this block (an edited copy of an older nocturne) gets
// "+ new" in the strip, before the bell, as before.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, shared, layout, run, settings } from "herdr";
import { dither, dropBelow, navRing, toolGround, toolHover } from "./kit.ts";
import { openNewMenu, newMenuOpen, WIDTH as NEW_W } from "./newmenu.js";
import { CURSOR } from "./nav.js";

export const ROLE = "newbutton";
// Room after the button, layout px: the main block's side padding, so its
// edge lines up with the panes' right edge.
const END = 8;

/** The layout block showing "+ new" (shown, not hidden), or null. */
export function newButtonNode(n = layout()) {
  if (!n || typeof n !== "object" || n.hidden) return null;
  if (n.content?.mod === "nocturne" && n.content?.props?.role === ROLE) return n;
  for (const c of n.children ?? []) { const f = newButtonNode(c); if (f) return f; }
  return null;
}

/** Sizes the block to `width` (drawn px, zoomed) plus END, when it isn't. */
function fit(width) {
  const node = newButtonNode();
  if (!node?.id || !(width > 0)) return;
  const px = Math.round(width / (Number(settings()?.zoom) || 1)) + END;
  if (Math.abs((node.size?.px ?? 0) - px) >= 1) run("layout.resize", { id: node.id, px });
}

export default class NewButton {
  init() { this.press = null; }

  render() {
    const t = theme();
    const open = newMenuOpen();
    const ring = shared(CURSOR)?.region === "new";
    const button = h_flex().id("tab-new").relative().flex_none().h(24).px(7).items_center().text_size(11)
      .text_color(open ? t.foreground : t.muted)
      .hover((s) => s.text_color(t.foreground).bg(toolHover(t)))
      // No tooltip while open: it would sit on the menu.
      .when(!open, (el) => el.tooltip("New (⌘N)"))
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.press = { e, open }; })
      .on_click(() => openNewMenu({ at: dropBelow(this.press?.e, NEW_W), wasOpen: Boolean(this.press?.open) }))
      .when(open, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(4).right(4).bottom(0).h(2).bg(t.accent)))
      .child(div().relative().text_color(open ? t.foreground : t.muted).child("+ new"))
      .map((el) => navRing(t, el, ring));
    return h_flex().id("new-block").relative().size_full().pr(END).items_center().justify_start().bg(t.background)
      // The toolbar's ground runs on under it to the strip's right edge (kit.js toolGround).
      .children(toolGround(t))
      .child(h_flex().id("new-tools").relative().flex_none().items_center().on_size_change((size) => fit(size.width))
        .child(div().w(1).h(14).mx(4).flex_none().bg(t.ansi0))
        .child(button));
  }
}
