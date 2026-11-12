// Right-click menus in Nocturne's look (popup.js), with Herdr's items:
//   tab    the tab strip's tabs (tabs.js opens it, props { role: "menu", tab: "tab", target })
//   pane   a terminal's menu: the layout's `terminal_menu` is "nocturne", and
//          Herdr opens it with props { tab: "pane", target: { pane, terminal } };
//          renaming happens inline in the pane's header, asked for through shared(NAME_PANE)
//   fly    a sidebar firefly's (sky.js opens it, props { tab: "fly", target: { id, address } }):
//          renaming happens inline in the sidebar, asked for through shared(NAME_AGENT);
//          moving and closing act on the agent's pane, not its whole tab
//   space  a sidebar space's (spaces.js opens it, props { tab: "space", target: { id } }):
//          rename, folder and delete happen inline in the sidebar, asked for through
//          shared(EDIT_SPACE); "New worktree…" opens the worktree dialog on the space's folder
//
// A pane's menu can also move it (pane.move): to any other tab on its machine,
// or a tab of its own.

import { svg, div } from "gpui-kit";
import { theme, props, run, terminals, keys, setShared, spaces, panes, openOverlay, closeOverlay } from "herdr";
import { keysView, keysKey, keysHeight } from "./keyhelp.js";
import { Popup, icon, popupHeight } from "./popup.js";
import { openEqualize } from "./equalize.js";
import { openWorktrees } from "./git.js";
import { ART, spaceFolder, panePinnedNow, pinPane, movePin, jar, pinKey, dockPane } from "./kit.js";
import { isDock } from "./dock.js";
import { onShelf } from "./pins.js";

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

/** "Move to …" rows for a pane: the other tabs of its space, then the tabs of
 *  the other spaces on its machine (pane.move: any pane, the only one of its
 *  tab too, a parked one too), then a tab of its own. */
export function moveItems(t, pane) {
  const ps = panes();
  const p = ps.find((x) => x.pane === pane);
  if (!p) return [];
  const all = spaces();
  const space = all.find((s) => s.tabs.some((c) => c.id === p.tab));
  const alone = ps.filter((x) => x.tab === p.tab).length === 1;
  const go = (args) => () => run("pane.move", { pane: p.pane, ...args });
  const tabName = (c) => (c.named ? c.name : `tab ${c.index}`);
  const here = (space?.tabs ?? []).filter((c) => c.id !== p.tab && !c.settled)
    .map((c) => ({ id: `move-${c.id}`, mark: icon(t, "panel-right"), name: `Move to ${tabName(c)}`, hint: String(c.index), go: go({ tab: c.id }) }));
  const there = all.filter((s) => s.id !== space?.id && (s.machine ?? null) === (space?.machine ?? null))
    .flatMap((s) => s.tabs.filter((c) => !c.settled).map((c) => ({ id: `move-${c.id}`, mark: icon(t, "layers"), name: `Move to ${s.name} / ${tabName(c)}`, hint: "", go: go({ tab: c.id }) })));
  return [
    { rule: true },
    ...here,
    ...there,
    ...(alone ? [] : [{ id: "move-new", mark: icon(t, "plus"), name: "Move to a new tab", hint: "", go: go({}) }]),
  ];
}

/** The layout:nocturne key for a Nocturne command ("nocturne.pin"), as keys.json spells it. */
function layoutKey(action) {
  return keys().find((b) => b.section === "layout:nocturne" && b.action === action)?.keys ?? "";
}

/** The pane is in the dock's space (dock.js). */
function inDock(p) {
  return isDock(spaces().find((s) => s.tabs.some((c) => c.id === p.tab)));
}

/** "Pin to the top" / "Unpin" for any pane (`p`: { pane, terminal }: an
 *  agent's, a plain terminal's, a web page's, an editor's...), and moving it
 *  in the jar (pins.js) while there's a neighbor of its kind to swap with: a
 *  firefly up and down, a tile on the shelf left and right. */
export function pinItems(t, p) {
  const key = pinKey(p);
  if (!key) return [];
  if (!panePinnedNow(p)) return [{ id: "pin", mark: icon(t, "pin"), name: "Pin to the top", hint: layoutKey("nocturne.pin"), go: () => pinPane(p, true) }];
  const all = jar(), it = all.find((x) => x.key === key);
  const group = it ? all.filter((x) => onShelf(x) === onShelf(it)) : [], i = group.indexOf(it);
  const shelf = it && onShelf(it);
  const glyph = (name) => svg(`${name.startsWith("chevron-up") ? ART : "mods/workspace-chrome"}/${name}.svg`).size(14).flex_none().text_color(t.accent);
  return [
    { id: "unpin", mark: icon(t, "pin-off"), name: "Unpin", hint: layoutKey("nocturne.pin"), go: () => pinPane(p, false) },
    ...(i > 0 ? [{ id: "pin-up", mark: glyph(shelf ? "chevron-left" : "chevron-up"), name: shelf ? "Move left" : "Move up in the jar", hint: layoutKey("nocturne.pin-up"), go: () => movePin(key, -1) }] : []),
    ...(i >= 0 && i < group.length - 1 ? [{ id: "pin-down", mark: glyph(shelf ? "chevron-right" : "chevron-down"), name: shelf ? "Move right" : "Move down in the jar", hint: layoutKey("nocturne.pin-down"), go: () => movePin(key, 1) }] : []),
  ];
}

/** A new worktree for a space's repo: the git window's Worktrees tab asks
 *  for the branch, checks it out in its own folder and opens it as a new
 *  space (indented under the repo's). */
export function newWorktree(id) {
  if (!spaces().some((x) => x.id === id)) return;
  openWorktrees({ space: id, action: "new" });
}

/** Opens a menu for these props (role "menu"). From the keyboard (`centered`)
 *  it opens in the middle as a dialog, since there's no pointer to hang it from;
 *  `at` places it (kit.js dropBelow), else it opens at the pointer. */
export function openMenu(props, { width = 220, centered = false, at = null } = {}) {
  const p = { role: "menu", ...props };
  return openOverlay({ mod: "nocturne", kind: centered ? "dialog" : "popup", frame: "none", width, height: menuHeight(p),
    ...(at && !centered ? { at } : {}), props: p });
}

// The chrome's keys overview (role "keyshelp"): a dialog, since the sidebar,
// the folded rail and the tab strip have no body to draw it over.
const KEYS_W = 460;

/** The keys a chrome block takes (nav.js SIDEBAR_HELP, STRIP_HELP): keyhelp.js's overview, in a dialog. */
export function openKeys(title, lines) {
  return openOverlay({ mod: "nocturne", kind: "dialog", frame: "none", width: KEYS_W, height: keysHeight(lines, KEYS_W), props: { role: "keyshelp", title, lines } });
}

/** The dialog openKeys opens: ? esc q close it. */
export class KeysDialog {
  init(_p, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(120, () => this.handle.focus());
  }

  render() {
    const t = theme(), p = props() ?? {};
    const close = () => closeOverlay(p.overlay);
    return div().id("keys-dialog").relative().size_full().bg(t.background).border(1).border_color(t.ansi0)
      .track_focus(this.handle)
      .on_key_down((e, cx) => { if (keysKey(e, true)) { cx.stop_propagation(); close(); } })
      .child(keysView(t, { id: "chrome-keys", title: p.title ?? "", list: p.lines ?? [], narrow: true, close }));
  }
}

/** The rows for these props. */
export function menuItems(t, p) {
  const tg = p?.target ?? {};
  if (p?.tab === "fly") {
    // Closing an agent closes its pane, not the tab around it; a pane alone
    // in its tab takes the tab with it, and the row says so. A sub-agent
    // without a pane of its own has none to close.
    const ps = panes();
    const mine = ps.find((x) => x.terminal === tg.address);
    const alone = !!mine && ps.filter((x) => x.tab === mine.tab).length === 1;
    return [
      item(t, "focus", "terminal", "Focus", "agent.focus", { terminal: tg.address }),
      { id: "rename", mark: icon(t, "square-pen"), name: "Rename", hint: "", go: () => setShared(NAME_AGENT, { address: tg.address, at: Date.now() }) },
      ...pinItems(t, { pane: null, terminal: tg.address }),
      ...(mine ? moveItems(t, mine.pane) : []),
      ...(mine ? [{ rule: true }, item(t, "close", "x", alone ? "Close pane & tab" : "Close pane", "pane.close", { pane: mine.pane }, t.blocked)] : []),
    ];
  }
  if (p?.tab === "space") {
    const edit = (kind) => () => setShared(EDIT_SPACE, { id: tg.id, kind, at: Date.now() });
    // The dock (dock.js) stays tied to no folder and isn't deleted by a slip:
    // no folder, worktree or delete rows (`herdr-app do space.close` still closes it).
    if (isDock(spaces().find((s) => s.id === tg.id))) return [
      item(t, "select", "layers", "Show", "space.select", { id: tg.id }),
      item(t, "new", "plus", "New tab here", "tab.new", { space: tg.id }),
      { id: "rename", mark: icon(t, "square-pen"), name: "Rename", hint: "", go: edit("rename") },
    ];
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
  if (p?.tab === "git") {
    // The tab strip's git ▾: the git window, its review, its worktrees, the GitHub window.
    const bound = (cmd) => keys().find((b) => b.action === cmd)?.keys ?? "";
    return [
      { id: "git", mark: icon(t, "git-compare"), name: "Git", hint: bound("nocturne.git") || bound("nocturne.lazygit"), go: () => run("nocturne.git") },
      { id: "diff", mark: icon(t, "eye"), name: "Diff", hint: bound("nocturne.diff"), go: () => run("nocturne.diff") },
      { id: "worktrees", mark: icon(t, "git-branch"), name: "Worktrees", hint: bound("nocturne.worktrees"), go: () => run("nocturne.worktrees") },
      { id: "github", mark: svg(`${ART}/github.svg`).size(14).flex_none().text_color(t.accent), name: "GitHub", hint: bound("nocturne.github"), go: () => run("nocturne.github") },
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
    // Any pane can be pinned to the top of the sky: an agent's, a shell's, a web page, an editor.
    ...pinItems(t, { pane: tg.pane, terminal: term ? term.address : null }),
    // Or kept in the dock (dock.js: the space tied to no folder), pinned to the shelf.
    ...(mine && !mine.pane.includes("/") && !inDock(mine) ? [{ id: "dock", mark: icon(t, "archive"), name: "Move to the dock", hint: "", go: () => dockPane(mine) }] : []),
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
