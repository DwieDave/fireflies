// Nocturne: a 1-bit night meadow for the moonfly palette.
// One mod in roles; the layout gives each copy props { role }:
//   sky    the sidebar: the moon (waxes as agents settle), spaces, and the
//          meadow where every agent is a firefly glowing in its status
//   tabs   the tab strip along the horizon
//   pane   a pane's header (the layout's pane header)
//   parked a parked pane's chip under the tab (the layout's pane.parked look)
//   worktrees  (moved to the git window) hands a saved worktrees pane to
//          git on its Worktrees tab
//   new    the "+ new" menu, an overlay from the tab strip
//   newspace  the new-space picker: a folder list (newspace.ts)
//   newbutton  "+ new" itself, the tab row's last block, right of the bell
//   menu   right-click menus: a tab's, and a terminal's (the layout's terminal_menu)
//   keyshelp  the keys overview of the sidebar, tab strip, header and parked chips (menu.ts openKeys)
//   toast  notifications (the layout's toast_mod, on the DwieDave fork)
//   prompt, confirm  Fireflies' name prompt and confirm dialog (dialog.ts; the
//          layout's prompt_mod / confirm_mod, on the DwieDave fork)
//   palette  the command palette (palette.ts; the layout's palette_mod)
//   peek     the bar over a floating or peeked terminal (peek.ts; the
//          layout's peek_mod, fork-only)
//   welcome, whats_new, help, update  Fireflies' welcome, release notes, keys
//          and update note (screens.ts; the layout's dialog_mods, fork-only)

import { View, div } from "gpui-kit";
import type { AsyncContext, Context, Element } from "gpui-kit";
import type { Props } from "gpui-shell";
import { props } from "herdr";
import { isString, object } from "./guard.ts";
import { Prompt, Confirm } from "./dialog.ts";
import Palette from "./palette.ts";
import Peek from "./peek.ts";
import Sky from "./sky.ts";
import Tabs from "./tabs.ts";
import Header from "./header.ts";
import Parked from "./parked.ts";
import { WorktreesPanel } from "./worktrees.ts";
import NewMenu from "./newmenu.ts";
import NewButton from "./newbutton.ts";
import NewSpace from "./newspace.ts";
import Menu, { KeysDialog } from "./menu.ts";
import Toast from "./toast.ts";
import { Welcome, WhatsNew, Keys, UpdateNote } from "./screens.ts";

/** A role: what one copy of this mod is (the sidebar, the tab strip, a dialog ...). */
interface Role {
  init?(props: Props | undefined, cx: Context): void;
  render(cx: Context): Element;
  /** Fireflies' last call before the copy goes. */
  closing?(cx: AsyncContext): void | Promise<void>;
}

const ROLES: ReadonlyMap<string, new () => Role> = new Map<string, new () => Role>([
  ["sky", Sky], ["tabs", Tabs], ["pane", Header], ["parked", Parked], ["worktrees", WorktreesPanel], ["new", NewMenu], ["newbutton", NewButton], ["newspace", NewSpace], ["menu", Menu], ["keyshelp", KeysDialog], ["toast", Toast],
  ["prompt", Prompt], ["confirm", Confirm], ["palette", Palette], ["peek", Peek],
  ["welcome", Welcome], ["whats_new", WhatsNew], ["help", Keys], ["update", UpdateNote],
]);

/** The props that say a copy's role: its `role`, a dialog's `dialog`, a menu's `tab`, a notification's `title`. */
const isRoleProps = object({}, { role: isString, dialog: isString, tab: isString, title: isString });

export default class Nocturne extends View {
  role: Role | null = null;

  override init(p: Props | undefined, cx: AsyncContext): void {
    const raw = props() ?? p;
    const pr = isRoleProps(raw) ? raw : {};
    // The layout's terminal_menu and toast_mod open this mod with Fireflies' own
    // props, no role: a menu's { tab, target }, a notification's { title, ... }.
    // Its prompt_mod / confirm_mod / palette_mod say which with `dialog`.
    const name = pr.role ?? pr.dialog ?? (pr.tab ? "menu" : pr.title !== undefined ? "toast" : undefined);
    const R = name ? ROLES.get(name) : undefined;

    this.role = R ? new R() : null;
    this.role?.init?.(pr, cx);
  }

  override render(cx: Context): Element {
    if (!this.role) {
      const p = props();

      return div().child(`nocturne: no role "${isRoleProps(p) ? (p.role ?? "undefined") : "undefined"}"`);
    }

    return this.role.render(cx);
  }

  /** Fireflies' last call before the copy goes: passed on to its role as
   *  closing() (several roles' close() closes their own overlay). */
  override async close(cx: AsyncContext): Promise<void> {
    await this.role?.closing?.(cx);
  }
}
