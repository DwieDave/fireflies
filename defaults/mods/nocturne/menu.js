// Right-click menus in Nocturne's look (popup.js), with Herdr's items:
//   tab    the tab strip's tabs (tabs.js opens it, props { role: "menu", tab: "tab", target })
//   pane   a terminal's menu: the layout's `terminal_menu` is "nocturne", and
//          Herdr opens it with props { tab: "pane", target: { pane, terminal } };
//          renaming happens inline in the pane's header, asked for through shared(NAME_PANE)
//   fly    a sidebar firefly's (sky.js opens it, props { tab: "fly", target: { id, address } }):
//          renaming happens inline in the sidebar, asked for through shared(NAME_AGENT)
//   space  a sidebar space's (spaces.js opens it, props { tab: "space", target: { id } }):
//          rename, folder and delete happen inline in the sidebar, asked for through
//          shared(EDIT_SPACE); "New worktree…" opens the worktree dialog on the space's folder
//
// A pane's menu can also move it: to another tab of its space, or a tab of its
// own. The sidebar does the move (shared(MOVE_PANE); sky.js), since this menu
// closes before a terminal's pane change finishes.

import { svg } from "gpui-kit";
import { theme, props, run, terminals, keys, setShared, spaces, panes, openOverlay } from "herdr";
import { Popup, icon, popupHeight } from "./popup.js";
import { openEqualize } from "./equalize.js";
import { spaceFolder } from "./kit.js";

/** The keys bound to a command (pane.split:right style too), as keys.json spells them. */
function shortcut(name, args) {
  const value = args && Object.values(args)[0];
  return keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`))?.keys ?? "";
}

function item(t, id, glyph, name, command, args, color) {
  return { id, mark: icon(t, glyph, color), name, hint: shortcut(command, args), go: () => run(command, args) };
}

/** shared() key: { address, at } asks the sidebar to start naming that agent (its terminal: kit.js NAME_LABEL). */
export const NAME_AGENT = "nocturne.name-agent";

/** shared() key: { terminal, at } asks that pane's header to start naming it. */
export const NAME_PANE = "nocturne.name-pane";

/** shared() key: { id, kind: "rename" | "folder" | "delete", at } asks the sidebar to edit that space inline. */
export const EDIT_SPACE = "nocturne.edit-space";

/** shared() key: { pane, terminal, mod, to (a tab id, or null: a new tab), at } asks the sidebar to move a pane. */
export const MOVE_PANE = "nocturne.move-pane";

/** Mod panes that can be moved: made again from the same props elsewhere ({} for all of these). */
export const MOVABLE_MODS = { "nocturne-agents": {}, "nocturne-usage": {}, nocturne: { role: "worktrees" } };

/** "Move to …" rows for a pane: the other tabs in its space, then a new tab. */
function moveItems(t, pane) {
  const p = panes().find((x) => x.pane === pane);
  if (!p || (!p.terminal && !(p.mod in MOVABLE_MODS))) return [];
  const space = spaces().find((s) => s.tabs.some((c) => c.id === p.tab));
  const alone = panes().filter((x) => x.tab === p.tab).length === 1;
  const ask = (to) => () => setShared(MOVE_PANE, { pane: p.pane, terminal: p.terminal, mod: p.mod ?? null, to, at: Date.now() });
  const others = (space?.tabs ?? []).filter((c) => c.id !== p.tab && !c.settled);
  return [
    { rule: true },
    ...others.slice(0, 3).map((c) => ({ id: `move-${c.id}`, mark: icon(t, "panel-right"), name: `Move to ${c.named ? c.name : `tab ${c.index}`}`, hint: String(c.index), go: ask(c.id) })),
    ...(alone ? [] : [{ id: "move-new", mark: icon(t, "plus"), name: "Move to a new tab", hint: "", go: ask(null) }]),
  ];
}

/** The worktree dialog (the worktree mod) on a space's folder: a branch in its
 *  own checkout, as a new space attached to it (indented under the repo's). */
export function newWorktree(id) {
  const s = spaces().find((x) => x.id === id);
  if (!s) return;
  openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: s.id, folder: spaceFolder(s, panes()), action: "new" } });
}

/** The rows for these props. */
export function menuItems(t, p) {
  const tg = p?.target ?? {};
  if (p?.tab === "fly") {
    return [
      item(t, "focus", "terminal", "Focus", "agent.focus", { terminal: tg.address }),
      { id: "rename", mark: icon(t, "square-pen"), name: "Rename", hint: "", go: () => setShared(NAME_AGENT, { address: tg.address, at: Date.now() }) },
      { rule: true },
      item(t, "close", "x", "Delete tab", "tab.close", { id: tg.id }, t.blocked),
    ];
  }
  if (p?.tab === "space") {
    const edit = (kind) => () => setShared(EDIT_SPACE, { id: tg.id, kind, at: Date.now() });
    return [
      item(t, "select", "layers", "Show", "space.select", { id: tg.id }),
      item(t, "new", "plus", "New tab here", "tab.new", { space: tg.id }),
      { id: "rename", mark: icon(t, "square-pen"), name: "Rename", hint: "", go: edit("rename") },
      { id: "folder", mark: icon(t, "folder"), name: "Change folder…", hint: "", go: edit("folder") },
      { id: "worktree", mark: icon(t, "git-branch"), name: "New worktree…", hint: "", go: () => newWorktree(tg.id) },
      { rule: true },
      { id: "delete", mark: icon(t, "x", t.blocked), name: "Delete", hint: "", go: edit("delete") },
    ];
  }
  if (p?.tab === "tab") {
    return [
      item(t, "rename", "square-pen", "Rename", "tab.rename", { id: tg.id }),
      item(t, "new", "plus", "New tab", "tab.new", { space: tg.space }),
      { rule: true },
      item(t, "close", "x", "Close", "tab.close", { id: tg.id }, t.blocked),
    ];
  }
  // pane
  const all = terminals();
  const term = all.find((x) => x.address === tg.terminal);
  const parent = term?.parent && all.find((x) => x.address === term.parent);
  // Once right-clicks go to the program, Shift+right-click still opens this menu.
  const toProgram = term?.labels?.["herdr.right-click"] === "program";
  // Parking needs another pane left in place.
  const ps = panes(), mine = ps.find((p) => p.pane === tg.pane);
  const parkable = !!mine && !mine.parked && ps.filter((p) => p.tab === mine.tab && !p.parked).length > 1;
  return [
    ...(term ? [{ id: "rename", mark: icon(t, "square-pen"), name: "Rename", hint: "", go: () => setShared(NAME_PANE, { terminal: term.address, at: Date.now() }) }] : []),
    item(t, "split-right", "panel-right", "Split right", "pane.split", { direction: "right", pane: tg.pane }),
    item(t, "split-down", "layers", "Split down", "pane.split", { direction: "down", pane: tg.pane }),
    item(t, "zoom", "square", "Zoom", "pane.zoom", { pane: tg.pane }),
    ...(panes().filter((x) => x.tab === panes().find((y) => y.pane === tg.pane)?.tab).length > 1
      ? [{ id: "equalize", mark: svg("mods/nocturne-equalize-panes/equalize.svg").size(14).flex_none().text_color(t.accent), name: "Even out panes…", hint: "", go: () => openEqualize(tg.pane) }] : []),
    ...(parkable ? [item(t, "park-pane", "archive", "Park pane", "pane.park", { pane: tg.pane })] : []),
    ...(term ? [toProgram
      ? item(t, "rc", "terminal", "Use Nocturne's right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" })
      : item(t, "rc", "terminal", "Send right-clicks to the program", "terminal.right_click", { terminal: term.address, to: "program" })] : []),
    ...(parent ? [item(t, "park", "archive", `Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address })] : []),
    ...moveItems(t, tg.pane),
    { rule: true },
    item(t, "close", "x", "Close pane", "pane.close", { pane: tg.pane }, t.blocked),
  ];
}

export default class Menu {
  init(_props, cx) { this.popup = new Popup(); this.popup.init(cx); }
  render() {
    const t = theme();
    return this.popup.render(t, menuItems(t, props()));
  }
}

/** The tab menu's height. */
export function menuHeight(p) { return popupHeight(menuItems(theme(), p)); }
