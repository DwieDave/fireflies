// Nocturne: a 1-bit night meadow for the moonfly palette.
// One mod in roles; the layout gives each copy props { role }:
//   sky    the sidebar: the moon (waxes as agents settle), spaces, and the
//          meadow where every agent is a firefly glowing in its status
//   tabs   the tab strip along the horizon
//   pane   a pane's header (the layout's pane header)
//   worktrees  the worktree manager, as a pane (the tab strip opens it)
//   new    the "+ new" menu, an overlay from the tab strip
//   menu   right-click menus: a tab's, and a terminal's (the layout's terminal_menu)
//   toast  notifications (the layout's toast_mod, on the DwieDave fork)
//   prompt, confirm  Herdr's name prompt and confirm dialog (dialog.js; the
//          layout's prompt_mod / confirm_mod, on the DwieDave fork)
//   palette  the command palette (palette.js; the layout's palette_mod)
//   peek     the bar over a floating or peeked terminal (peek.js; the
//          layout's peek_mod, fork-only)

import { View, div } from "gpui-kit";
import { props } from "herdr";
import { Prompt, Confirm } from "./dialog.js";
import Palette from "./palette.js";
import Peek from "./peek.js";
import Sky from "./sky.js";
import Tabs from "./tabs.js";
import Header from "./header.js";
import { WorktreesPanel } from "./worktrees.js";
import NewMenu from "./newmenu.js";
import Menu from "./menu.js";
import Toast from "./toast.js";

const ROLES = {
  sky: Sky, tabs: Tabs, pane: Header, worktrees: WorktreesPanel, new: NewMenu, menu: Menu, toast: Toast,
  prompt: Prompt, confirm: Confirm, palette: Palette, peek: Peek,
};

export default class Nocturne extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    // The layout's terminal_menu and toast_mod open this mod with Herdr's own
    // props, no role: a menu's { tab, target }, a notification's { title, ... }.
    // Its prompt_mod / confirm_mod / palette_mod say which with `dialog`.
    const R = ROLES[pr.role ?? pr.dialog ?? (pr.tab ? "menu" : "title" in pr ? "toast" : undefined)];
    this.role = R ? new R() : null;
    this.role?.init?.(pr, cx);
  }

  render(cx) {
    if (!this.role) return div().child(`nocturne: no role "${props()?.role}"`);
    return this.role.render(cx);
  }

  /** Herdr's last call before the copy goes: passed on to its role as
   *  closing() (several roles' close() closes their own overlay). */
  async close(cx) {
    await this.role?.closing?.(cx);
  }
}
