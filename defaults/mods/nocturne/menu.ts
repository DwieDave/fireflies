// Right-click menus in Nocturne's look (popup.ts), with Fireflies' items:
//   tab    the tab strip's tabs (tabs.ts opens it, props { role: "menu", tab: "tab", target })
//   pane   a terminal's menu: the layout's `terminal_menu` is "nocturne", and
//          Fireflies opens it with props { tab: "pane", target: { pane, terminal } };
//          renaming happens inline in the pane's header, asked for through shared(NAME_PANE)
//   fly    a sidebar firefly's (sky.ts opens it, props { tab: "fly", target: { id, address } }):
//          renaming happens inline in the sidebar, asked for through shared(NAME_AGENT);
//          moving and closing act on the agent's pane, not its whole tab
//   space  a sidebar space's (spaces.ts opens it, props { tab: "space", target: { id } }):
//          rename, folder and delete happen inline in the sidebar, asked for through
//          shared(EDIT_SPACE); "New worktree…" opens the worktree dialog on the space's folder
//
// A pane's menu can also move it (pane.move): to any other tab on its machine,
// or a tab of its own; past MOVE_FLAT places they gather under one "Move to…"
// row whose levels (popup.ts) list this space's tabs, then the other spaces
// (moveItems).

import { svg, div } from "gpui-kit";
import type { Color, Context, Element, FocusHandle } from "gpui-kit";
import type { Props } from "gpui-shell";
import { theme, props, run, terminals, keys, setShared, spaces, panes, openOverlay, closeOverlay } from "herdr";
import type { PaneInfo, SpaceInfo, TabInfo, Theme } from "herdr";
import { arrayOf, isNumber, isString, literal, nullable, object, sharedKey, writeShared } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import { isTerminal } from "./guards.ts";
import { keysView, keysKey, keysHeight } from "./keyhelp.ts";
import { Popup, icon, popupHeight } from "./popup.ts";
import type { MenuItem, PopupItem } from "./popup.ts";
import { openEqualize } from "./equalize.ts";
import { openWorktrees } from "./git.ts";
import { ART, panePinnedNow, pinPane, movePin, jar, pinKey, dockPane, tracked } from "./kit.ts";
import type { DropAt, PinTarget } from "./kit.ts";
import { isDock } from "./dock.ts";
import { onShelf } from "./pins.ts";
import { isHelpLine } from "./nav.ts";
import type { HelpLine } from "./nav.ts";

/** A menu row's command arguments (the commands these rows run). */
type MenuArgs = { terminal?: string; pane?: string | null; id?: string; space?: string | null; direction?: "right" | "down"; to?: "menu" | "program"; tab?: string };

/** The keys bound to a command (pane.split:right style too), as keys.json spells them. */
function shortcut(name: string, args: MenuArgs): string {
  const value = Object.values(args)[0];

  return keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${String(value)}`))?.keys ?? "";
}

function item(t: Theme, id: string, glyph: string, name: string, command: string, args: MenuArgs, color?: Color): MenuItem {
  return { id, mark: icon(t, glyph, color), name, hint: shortcut(command, args), go: () => run(command, args) };
}

/** shared() key: { address, at } asks the sidebar to start naming that agent (its terminal: kit.ts NAME_LABEL). */
export const NAME_AGENT = "nocturne.name-agent";
export const NAME_AGENT_KEY = sharedKey(NAME_AGENT, object({ address: isString, at: isNumber }));

/** shared() key: { terminal, at } asks that pane's header to start naming it. */
export const NAME_PANE = "nocturne.name-pane";
const NAME_PANE_KEY = sharedKey(NAME_PANE, object({ terminal: isString, at: isNumber }));

/** What the sidebar edits inline for a space. */
export type SpaceEdit = "rename" | "folder" | "delete";

/** shared() key: { id, kind: "rename" | "folder" | "delete", at } asks the sidebar to edit that space inline. */
export const EDIT_SPACE = "nocturne.edit-space";
export const EDIT_SPACE_KEY = sharedKey(EDIT_SPACE, object({ id: isString, kind: literal("rename", "folder", "delete"), at: isNumber }));

/** Up to this many places to move to in all, the "Move to" rows stay flat in
 *  the menu; past it they gather under one "Move to…" row (moveItems). */
export const MOVE_FLAT = 3;

/** Where a pane can move (moveTargets). */
export interface MoveTargets {
  readonly pane: PaneInfo;
  readonly here: TabInfo[];
  readonly spaces: { readonly space: SpaceInfo; readonly tabs: TabInfo[] }[];
  readonly fresh: boolean;
  readonly count: number;
}

/**
 * Where a pane can move (pane.move: any pane, the only one of its tab too, a
 * parked one too): `here`, the other tabs of its space; `spaces`, the other
 * spaces on its machine with their tabs ({ space, tabs }, those with none
 * left out); `fresh`, a tab of its own (not for a pane alone in its tab);
 * `count`, every place in all. Settled tabs aren't places. Null: no such pane.
 */
export function moveTargets(pane: string | null | undefined, ps: readonly PaneInfo[] = panes(), all: readonly SpaceInfo[] = spaces()): MoveTargets | null {
  const p = ps.find((x) => x.pane === pane);

  if (!p) return null;

  const space = all.find((s) => s.tabs.some((c) => c.id === p.tab));
  const here = (space?.tabs ?? []).filter((c) => c.id !== p.tab && !c.settled);

  const others = all.filter((s) => s.id !== space?.id && (s.machine ?? null) === (space?.machine ?? null))
    .flatMap((s) => {
      const tabs = s.tabs.filter((c) => !c.settled);

      return tabs.length ? [{ space: s, tabs }] : [];
    });

  const fresh = ps.filter((x) => x.tab === p.tab).length > 1;

  return { pane: p, here, spaces: others, fresh, count: here.length + others.reduce((n, x) => n + x.tabs.length, 0) + (fresh ? 1 : 0) };
}

const tabName = (c: TabInfo) => (c.named ? c.name : `tab ${c.index}`);

/** A tab's row in a "Move to" level: its number shown, and as its key when 1 to 9 (a number moves there at once). */
function tabRow(c: TabInfo, mark: Element, name: string, go: () => void): MenuItem {
  const row = { id: `move-${c.id}`, mark, name, hint: String(c.index), go };

  return c.index >= 1 && c.index <= 9 ? { ...row, key: String(c.index) } : row;
}

/**
 * "Move to …" rows for a pane, as few levels as it needs:
 *   - MOVE_FLAT places or fewer: flat, as they are ("Move to <tab>", "Move to
 *     <space> / <tab>", "Move to a new tab");
 *   - more: one "Move to…" row. Its level lists this space's tabs (numbers
 *     shown and keyed), "a new tab", then a row per other space: one with a
 *     single tab moves there at once, one with more opens a level of its tabs.
 */
export function moveItems(t: Theme, pane: string | null | undefined): PopupItem[] {
  const m = moveTargets(pane);

  if (!m || !m.count) return [];

  const go = (tab: string | null) => () => run("pane.move", tab ? { pane: m.pane.pane, tab } : { pane: m.pane.pane });
  const mark = (n: string) => icon(t, n);

  if (m.count <= MOVE_FLAT) {
    return [
      { rule: true },
      ...m.here.map((c): PopupItem => ({ id: `move-${c.id}`, mark: mark("panel-right"), name: `Move to ${tabName(c)}`, hint: String(c.index), go: go(c.id) })),
      ...m.spaces.flatMap(({ space: s, tabs }) => tabs.map((c): PopupItem => ({ id: `move-${c.id}`, mark: mark("layers"), name: `Move to ${s.name} / ${tabName(c)}`, hint: "", go: go(c.id) }))),
      ...(m.fresh ? [{ id: "move-new", mark: mark("plus"), name: "Move to a new tab", hint: "", go: go(null) }] : []),
    ];
  }

  // The levels are worked out when shown, so they follow tabs coming and going.
  const tabsOf = (sid: string) => (): PopupItem[] => {
    const x = moveTargets(pane)?.spaces.find((y) => y.space.id === sid);

    return (x?.tabs ?? []).map((c) => tabRow(c, mark("panel-right"), tabName(c), go(c.id)));
  };

  const level = (): PopupItem[] => {
    const now = moveTargets(pane);

    if (!now) return [];

    return [
      ...now.here.map((c) => tabRow(c, mark("panel-right"), tabName(c), go(c.id))),
      ...(now.fresh ? [{ id: "move-new", mark: mark("plus"), name: "a new tab", hint: "", go: go(null) }] : []),
      ...(now.spaces.length && (now.here.length || now.fresh) ? [{ rule: true } as const] : []),
      ...now.spaces.map(({ space: s, tabs }): PopupItem => {
        const only = tabs.length === 1 ? tabs[0] : undefined;

        return only
          ? { id: `move-space-${s.id}`, mark: mark("layers"), name: s.name, hint: tabName(only), go: go(only.id) }
          : { id: `move-space-${s.id}`, mark: mark("layers"), name: s.name, hint: `${tabs.length} tabs`, title: `Move to ${s.name}`, sub: tabsOf(s.id) };
      }),
    ];
  };

  return [{ rule: true }, { id: "move", mark: mark("panel-right"), name: "Move to…", hint: "", title: "Move to", sub: level }];
}

/** The layout:nocturne key for a Nocturne command ("nocturne.pin"), as keys.json spells it. */
function layoutKey(action: string): string {
  return keys().find((b) => b.section === "layout:nocturne" && b.action === action)?.keys ?? "";
}

/** The pane is in the dock's space (dock.ts). */
function inDock(p: PaneInfo): boolean {
  return isDock(spaces().find((s) => s.tabs.some((c) => c.id === p.tab)));
}

/** "Pin to the top" / "Unpin" for any pane (`p`: { pane, terminal }: an
 *  agent's, a plain terminal's, a web page's, an editor's...), and moving it
 *  in the jar (pins.ts) while there's a neighbor of its kind to swap with: a
 *  firefly up and down, a tile on the shelf left and right. */
export function pinItems(t: Theme, p: PinTarget): PopupItem[] {
  const key = pinKey(p);

  if (!key) return [];

  if (!panePinnedNow(p)) return [{ id: "pin", mark: icon(t, "pin"), name: "Pin to the top", hint: layoutKey("nocturne.pin"), go: () => pinPane(p, true) }];

  const all = jar();
  const it = all.find((x) => x.key === key);
  const group = it ? all.filter((x) => onShelf(x) === onShelf(it)) : [];
  const i = it ? group.indexOf(it) : -1;
  const shelf = Boolean(it && onShelf(it));
  const glyph = (name: string) => svg(`${name.startsWith("chevron-up") ? ART : "mods/workspace-chrome"}/${name}.svg`).size(14).flex_none().text_color(t.accent);

  return [
    { id: "unpin", mark: icon(t, "pin-off"), name: "Unpin", hint: layoutKey("nocturne.pin"), go: () => pinPane(p, false) },
    ...(i > 0 ? [{ id: "pin-up", mark: glyph(shelf ? "chevron-left" : "chevron-up"), name: shelf ? "Move left" : "Move up in the jar", hint: layoutKey("nocturne.pin-up"), go: () => movePin(key, -1) }] : []),
    ...(i >= 0 && i < group.length - 1 ? [{ id: "pin-down", mark: glyph(shelf ? "chevron-right" : "chevron-down"), name: shelf ? "Move right" : "Move down in the jar", hint: layoutKey("nocturne.pin-down"), go: () => movePin(key, 1) }] : []),
  ];
}

/** A new worktree for a space's repo: the git window's Worktrees tab asks
 *  for the branch, checks it out in its own folder and opens it as a new
 *  space (indented under the repo's). */
export function newWorktree(id: string | undefined): void {
  if (!id || !spaces().some((x) => x.id === id)) return;

  openWorktrees({ space: id, action: "new" });
}

/** What a menu's rows are for: which menu, and what it was opened on. */
const isMenuTarget = object({}, { id: isString, address: isString, space: nullable(isString), pane: nullable(isString), terminal: nullable(isString) });

/** A menu's props: which (tab, pane, fly, space, git), on what (`target`), and its overlay. */
const isMenuProps = object({}, { tab: literal("tab", "pane", "fly", "space", "git"), target: isMenuTarget, overlay: isString, role: isString });

export type MenuProps = Guarded<typeof isMenuProps>;

/** How a menu opens (openMenu). */
export interface MenuOpening {
  readonly width?: number;
  readonly centered?: boolean;
  readonly at?: DropAt | null;
}

/** Opens a menu for these props (role "menu"). From the keyboard (`centered`)
 *  it opens in the middle as a dialog, since there's no pointer to hang it from;
 *  `at` places it (kit.ts dropBelow), else it opens at the pointer. */
export function openMenu(menu: MenuProps, { width = 220, centered = false, at = null }: MenuOpening = {}): string {
  const p = { role: "menu", ...menu };
  const kind = centered ? "dialog" : "popup";
  const height = menuHeight(p);

  return openOverlay(at && !centered ? { mod: "nocturne", kind, frame: "none", width, height, at, props: p } : { mod: "nocturne", kind, frame: "none", width, height, props: p });
}

// The chrome's keys overview (role "keyshelp"): a dialog, since the sidebar,
// the folded rail and the tab strip have no body to draw it over.
const KEYS_W = 460;

/** The keys a chrome block takes (nav.ts SIDEBAR_HELP, STRIP_HELP): keyhelp.ts's overview, in a dialog. */
export function openKeys(title: string, lines: readonly HelpLine[]): string {
  return openOverlay({ mod: "nocturne", kind: "dialog", frame: "none", width: KEYS_W, height: keysHeight(lines, KEYS_W), props: { role: "keyshelp", title, lines } });
}

/** The keys dialog's props (openKeys). */
const isKeysProps = object({}, { title: isString, lines: arrayOf(isHelpLine), overlay: isString });

/** The dialog openKeys opens: ? esc q close it. */
export class KeysDialog {
  handle: FocusHandle | null = null;

  init(_p: Props | undefined, cx: Context): void {
    const handle = cx.focus_handle();

    this.handle = handle;
    handle.focus();
    cx.timer.after(120, () => handle.focus());
  }

  render(): Element {
    const t = theme();
    const raw = props();
    const p = isKeysProps(raw) ? raw : {};

    const close = () => {
      if (p.overlay) closeOverlay(p.overlay);
    };

    return tracked(div().id("keys-dialog").relative().size_full().bg(t.background).border(1).border_color(t.ansi0), this.handle)
      .on_key_down((e, cx) => {
        if (keysKey(e, true)) {
          cx.stop_propagation();
          close();
        }
      })
      .child(keysView(t, { id: "chrome-keys", title: p.title ?? "", list: p.lines ?? [], narrow: true, close }));
  }
}

/** A tab-strip git ▾ row: a command and its key. */
function gitRow(t: Theme, id: string, mark: Element, name: string, hint: string, command: string): MenuItem {
  return { id, mark, name, hint, go: () => run(command) };
}

/** The rows for these props. */
export function menuItems(t: Theme, p: MenuProps | null | undefined): PopupItem[] {
  const tg = p?.target ?? {};

  if (p?.tab === "fly") {
    // Closing an agent closes its pane, not the tab around it; a pane alone
    // in its tab takes the tab with it, and the row says so. A sub-agent
    // without a pane of its own has none to close.
    const ps = panes();
    const mine = ps.find((x) => x.terminal === tg.address);
    const alone = Boolean(mine) && ps.filter((x) => x.tab === mine?.tab).length === 1;
    const address = tg.address ?? "";

    return [
      item(t, "focus", "terminal", "Focus", "agent.focus", { terminal: address }),
      { id: "rename", mark: icon(t, "square-pen"), name: "Rename", hint: "", go: () => writeShared(setShared, NAME_AGENT_KEY, { address, at: Date.now() }) },
      ...pinItems(t, { pane: null, terminal: address }),
      ...(mine ? moveItems(t, mine.pane) : []),
      ...(mine ? [{ rule: true } as const, item(t, "close", "x", alone ? "Close pane & tab" : "Close pane", "pane.close", { pane: mine.pane }, t.blocked)] : []),
    ];
  }

  if (p?.tab === "space") {
    const id = tg.id ?? "";
    const edit = (kind: SpaceEdit) => () => writeShared(setShared, EDIT_SPACE_KEY, { id, kind, at: Date.now() });

    // The dock (dock.ts) stays tied to no folder and isn't deleted by a slip:
    // no folder, worktree or delete rows (`herdr-app do space.close` still closes it).
    if (isDock(spaces().find((s) => s.id === id))) {
      return [
        item(t, "select", "layers", "Show", "space.select", { id }),
        item(t, "new", "plus", "New tab here", "tab.new", { space: id }),
        { id: "rename", mark: icon(t, "square-pen"), name: "Rename", hint: "", go: edit("rename") },
      ];
    }

    return [
      item(t, "select", "layers", "Show", "space.select", { id }),
      item(t, "new", "plus", "New tab here", "tab.new", { space: id }),
      { id: "rename", mark: icon(t, "square-pen"), name: "Rename", hint: "", go: edit("rename") },
      { id: "folder", mark: icon(t, "folder"), name: "Change folder…", hint: "", go: edit("folder") },
      { id: "worktree", mark: icon(t, "git-branch"), name: "New worktree…", hint: "", go: () => newWorktree(id) },
      { rule: true },
      { id: "delete", mark: icon(t, "x", t.blocked), name: "Delete", hint: "", go: edit("delete") },
    ];
  }

  if (p?.tab === "git") {
    // The tab strip's git ▾: the git window, its review, its worktrees, the GitHub window.
    const bound = (cmd: string) => keys().find((b) => b.action === cmd)?.keys ?? "";

    return [
      gitRow(t, "git", icon(t, "git-compare"), "Git", bound("nocturne.git") || bound("nocturne.lazygit"), "nocturne.git"),
      gitRow(t, "diff", icon(t, "eye"), "Diff", bound("nocturne.diff"), "nocturne.diff"),
      gitRow(t, "worktrees", icon(t, "git-branch"), "Worktrees", bound("nocturne.worktrees"), "nocturne.worktrees"),
      gitRow(t, "github", svg(`${ART}/github.svg`).size(14).flex_none().text_color(t.accent), "GitHub", bound("nocturne.github"), "nocturne.github"),
    ];
  }

  if (p?.tab === "tab") {
    const id = tg.id ?? "";

    return [
      item(t, "rename", "square-pen", "Rename", "tab.rename", { id }),
      item(t, "new", "plus", "New tab", "tab.new", { space: tg.space ?? null }),
      { rule: true },
      item(t, "close", "x", "Close", "tab.close", { id }, t.blocked),
    ];
  }

  // pane
  const all = terminals().filter((x) => isTerminal(x));
  const term = all.find((x) => x.address === tg.terminal);
  const parent = term?.parent ? all.find((x) => x.address === term.parent) : undefined;
  // Once right-clicks go to the program, Shift+right-click still opens this menu.
  const toProgram = term?.labels?.["herdr.right-click"] === "program";
  // Parking needs another pane left in place.
  const ps = panes();
  const mine = ps.find((x) => x.pane === tg.pane);
  const parkable = Boolean(mine) && !mine?.parked && ps.filter((x) => x.tab === mine?.tab && !x.parked).length > 1;
  const pane = tg.pane ?? null;

  return [
    ...(term ? [{ id: "rename", mark: icon(t, "square-pen"), name: "Rename", hint: "", go: () => writeShared(setShared, NAME_PANE_KEY, { terminal: term.address, at: Date.now() }) }] : []),
    // Any pane can be pinned to the top of the sky: an agent's, a shell's, a web page, an editor.
    ...pinItems(t, { pane, terminal: term ? term.address : null }),
    // Or kept in the dock (dock.ts: the space tied to no folder), pinned to the shelf.
    ...(mine && !mine.pane.includes("/") && !inDock(mine) ? [{ id: "dock", mark: icon(t, "archive"), name: "Move to the dock", hint: "", go: () => dockPane(mine) }] : []),
    item(t, "split-right", "panel-right", "Split right", "pane.split", { direction: "right", pane }),
    item(t, "split-down", "layers", "Split down", "pane.split", { direction: "down", pane }),
    item(t, "zoom", "square", "Zoom", "pane.zoom", { pane }),
    ...(ps.filter((x) => x.tab === ps.find((y) => y.pane === pane)?.tab).length > 1
      ? [{ id: "equalize", mark: svg("mods/equalize-panes/equalize.svg").size(14).flex_none().text_color(t.accent), name: "Even out panes…", hint: "", go: () => openEqualize(pane) }] : []),
    ...(parkable ? [item(t, "park-pane", "archive", "Park pane", "pane.park", { pane })] : []),
    ...(term ? [toProgram
      ? item(t, "rc", "terminal", "Use Nocturne's right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" })
      : item(t, "rc", "terminal", "Send right-clicks to the program", "terminal.right_click", { terminal: term.address, to: "program" })] : []),
    ...(parent && term ? [item(t, "park", "archive", `Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address })] : []),
    ...moveItems(t, pane),
    { rule: true },
    item(t, "close", "x", "Close pane", "pane.close", { pane }, t.blocked),
  ];
}

/** The menu's props now, proven (else none). */
const menuProps = (): MenuProps => {
  const p = props();

  return isMenuProps(p) ? p : {};
};

export default class Menu {
  popup = new Popup();

  init(_props: Props | undefined, cx: Context): void {
    this.popup = new Popup();
    this.popup.init(cx);
  }

  render(): Element {
    const t = theme();

    return this.popup.render(t, menuItems(t, menuProps()));
  }
}

/** The tab menu's height. */
export function menuHeight(p: MenuProps): number {
  return popupHeight(menuItems(theme(), p));
}
