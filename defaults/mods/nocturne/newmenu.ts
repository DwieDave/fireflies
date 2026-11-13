// The "+ new" menu ({ role: "new" }, an overlay from the tab strip).
//
//   landing   the switch at the top says where new things go: a pane beside
//             the focused one, or a tab of their own. Its little picture shows
//             the landing spot in dithered blue. Tab flips it; it's
//             remembered (shared(DEST)).
//   panels    a grid of tiles (menuPanels): terminal, web, files, agents,
//             usage, scratchpad (the repository's note, its own dithered
//             page-and-moon mark), git, github, scripts, three to a row (COLS); a short last row
//             keeps the columns, its cells empty. Each opens beside the focused pane or in a tab
//             of its own; Files too (a files pane of its own, `files.open`:
//             the panel docked down the tab's edge is the strip's files
//             button and cmd-e). Agents and Usage, open in the shown tab,
//             say so with a corner mark and close on a second pick. Git,
//             GitHub and Scripts open here as a normal pane (or tab) of
//             their own, a new one each pick (inpane.ts); their windows over
//             the tab are the strip's buttons, their keys and the palette's.
//             Mods Nocturne doesn't ship follow, one tile each, when their
//             mod.json declares a launcher (launchers.ts).
//             Worktrees and the diff aren't here (the git button's ▾).
//   agents    every installed agent, started at the landing spot; the ones
//             that aren't installed are hidden behind a dim last row, "2 not
//             installed · show" (enter or a click shows them, again hides
//             them; remembered, shared(MISSING)). They come after the
//             installed ones and carry no number, so 1-9 never move.
//   space     a new space, or a worktree (made or opened)
//   footer    what the item under the cursor will do, in words
//
// Keys: the letter on a tile / 1..9 for an agent (shift: the other landing
// spot, once); ← → ↑ ↓ move, enter picks, tab flips the landing, esc or q closes.

import { div, svg, image } from "gpui-kit";
import type { ClickEvent, Color, Context, Element, FocusHandle, KeyEvent, MouseButtonEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, knownAgents, openOverlay, closeOverlay, props, window as appWindow, keys, shared, setShared } from "herdr";
import type { Theme } from "herdr";
import { arrayOf, isBoolean, isString, literal, nullable, object, readShared, readSharedMap, sharedKey, sharedMapKey, writeShared, writeSharedMap } from "./guard.ts";
import type { Guarded } from "./guard.ts";
import { ART, LOGO, dither, eyebrow } from "./kit.ts";
import type { DropAt } from "./kit.ts";
import { panels, here, terminalPane, terminalTab, filesHere } from "./panels.ts";
import type { Panel } from "./panels.ts";
import { openWorktrees } from "./git.ts";
import { openSpacePicker } from "./newspace.ts";
import { readLaunchers } from "./launchers.ts";

/** An agent as knownAgents() reports it (and the shipped new-menu keeps it). */
const isKnownAgent = object(
  { key: isString, name: isString, run: arrayOf(isString), installed: isBoolean },
  { icon: nullable(isString), tint: isBoolean, app: nullable(isString) },
);

type KnownAgent = Guarded<typeof isKnownAgent>;

// Shared with the shipped new-menu: the last agents each machine reported (by machine, "" for this one).
const KNOWN = sharedMapKey("new-menu.agents", arrayOf(isKnownAgent));

// Where new things land: "pane" or "tab".
const DEST = sharedKey("nocturne.newDest", nullable(literal("pane", "tab")));

// The agents that aren't installed are shown (true) or hidden (else, the default).
export const MISSING = "nocturne.newShowMissing";
const MISSING_KEY = sharedKey(MISSING, nullable(isBoolean));

/** Where new things land. */
type Dest = "pane" | "tab";

// Three tiles to a row, "Terminal" whole in one: each (WIDTH - 2 PAD - 2 GAP)
// / 3 = 96 px, 84 inside its padding and border. The footer's words fit
// beside "shift: other" (say(): short lines).
export const WIDTH = 320;
const PAD = 12;
const COLS = 3;
const GAP = 4;
const TILE_H = 64;
const ROW = 26;
const HEAD = 44;
const SECTION = 24;
const FOOT = 26;

const stop = (_e: MouseButtonEvent, cx: Context) => cx.stop_propagation();
const chrome = (n: string) => `mods/workspace-chrome/${n}.svg`;

/** The modifiers in a chord, as a binding spells them, in the order shown. */
const HELD = ["ctrl", "alt", "shift", "cmd"] as const;

/** Each modifier's glyph on a Mac, its word elsewhere. */
const MAC_NAMES: ReadonlyMap<string, string> = new Map([["ctrl", "⌃"], ["alt", "⌥"], ["shift", "⇧"], ["cmd", "⌘"]]);
const NAMES: ReadonlyMap<string, string> = new Map([["ctrl", "Ctrl"], ["alt", "Alt"], ["shift", "Shift"], ["cmd", "Super"]]);

/** The key bound to a command (in `section`, default global), in macOS glyphs. */
export function shortcut(name: string, section = "global"): string {
  const all = keys();
  const k = all.find((b) => b.section === section && b.action === name);

  if (!k?.keys.trim()) return "";

  // Taken by the Nocturne layout for something else (cmd-n opens this menu).
  if (section === "global" && all.some((b) => b.section === "layout:nocturne" && b.keys.trim() === k.keys.trim() && b.action !== name)) return "";

  const mac = appWindow().platform === "macos";
  const names = mac ? MAC_NAMES : NAMES;
  const alias: ReadonlyMap<string, string> = new Map([["secondary", mac ? "cmd" : "ctrl"], ["super", "cmd"], ["win", "cmd"]]);

  return k.keys.trim().split(/\s+/).map((stroke) => {
    const parts = stroke.split("-");
    let key = parts.pop() ?? "";

    if (key === "") {
      key = "-";
      parts.pop();
    }

    const held = new Set(parts.map((m) => alias.get(m.toLowerCase()) ?? m.toLowerCase()));
    const label = key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();

    return [...HELD.flatMap((m) => (held.has(m) ? [names.get(m) ?? m] : [])), label].join(mac ? "" : "+");
  }).join(" ");
}

// The open menu's overlay id, so cmd-n can close it again (null: none open).
export const OPEN = "nocturne.newOpen";
const OPEN_KEY = sharedKey(OPEN, nullable(isString));

const destNow = (): Dest => (readShared(shared, DEST, null) === "tab" ? "tab" : "pane");
const showMissing = () => readShared(shared, MISSING_KEY, null) === true;
const CONTEXT = "NocturneNew";
const FLIP = "nocturne_new::flip";
const CLOSE = "nocturne_new::close";

/** A tile: a panel. */
interface TileItem {
  readonly kind: "tile";
  readonly id: string;
  readonly p: Panel;
  readonly key: string;
  readonly off: boolean;
}

/** An agent to start; `off`: not installed (shown, but can't be picked). */
interface AgentItem {
  readonly kind: "agent";
  readonly id: string;
  readonly a: KnownAgent;
  readonly key?: string | null;
  readonly off?: boolean;
}

/** The row that shows or hides the agents that aren't installed. */
interface MissingItem {
  readonly kind: "missing";
  readonly id: string;
  readonly n: number;
  readonly shown: boolean;
  readonly off?: boolean;
}

/** A space row: a new space, a worktree. */
interface RowItem {
  readonly kind: "row";
  readonly id: string;
  readonly icon: string;
  readonly name: string;
  readonly hint?: string;
  readonly go: () => void;
  readonly off?: boolean;
  readonly say: string;
}

/** A pickable item of the menu. */
type NewItem = TileItem | AgentItem | MissingItem | RowItem;

/** An item's key (a tile's letter, an agent's number), if it has one. */
const keyOf = (x: NewItem): string | null => (x.kind === "tile" || x.kind === "agent" ? (x.key ?? null) : null);

/** The agents a machine last reported, installed first (numbered 1-9), then
 *  (`show`) the first two that aren't, then the row that shows or hides those
 *  (only when there are any). */
function agentRows(agents: readonly KnownAgent[], show = showMissing()): NewItem[] {
  const installed = agents.filter((a) => a.installed);
  const missing = agents.filter((a) => !a.installed).slice(0, 2);

  return [
    ...installed.map((a, i): NewItem => ({ kind: "agent", id: `agent-${a.key}`, a, key: i < 9 ? String(i + 1) : null })),
    ...(show ? missing.map((a): NewItem => ({ kind: "agent", id: `agent-${a.key}`, a, off: true })) : []),
    ...(missing.length ? [{ kind: "missing", id: "agents-missing", n: missing.length, shown: show } as const] : []),
  ];
}

/** The menu's tiles: every panel (panels.ts) that lands in a pane or a tab,
 *  and the floating ones that also open in one (Git, GitHub, Scripts). Files is a files pane of its own
 *  here, beside the focused pane or in a tab, like Terminal (no corner mark,
 *  no close on a second pick); the docked panel is the strip's button's. */
export const menuPanels = (): Panel[] => panels().flatMap((p): Panel[] => {
  // Git, GitHub, Scripts: a normal pane or tab of their own here (inpane.ts), a new one each pick.
  if (p.fixed === "float") return p.beside ? [{ id: p.id, name: p.name, icon: p.icon, key: p.key, words: p.words, pane: p.beside, tab: p.tab }] : [];

  if (p.id !== "files") return [p];

  return [{ id: p.id, name: p.name, icon: p.icon, key: p.key, words: p.words, pane: () => filesHere(), tab: () => filesHere(true) }];
});

/** Every pickable item, in cursor order: tiles, agents, space rows. */
function items(agents: readonly KnownAgent[]): NewItem[] {
  const space = here().space;
  const worktree = (action: "new" | "open") => () => openWorktrees({ space: space?.id ?? null, action });

  return [
    ...menuPanels().map((p): NewItem => ({ kind: "tile", id: p.id, p, key: p.key, off: !space && p.id !== "terminal" })),
    ...agentRows(agents),
    { kind: "row", id: "space", icon: "plus", name: "New space", hint: shortcut("nocturne.space-new", "layout:nocturne") || shortcut("space.new"), go: () => openSpacePicker(), say: "pick its folder first" },
    { kind: "row", id: "wt-new", icon: "git-branch", name: "New worktree…", go: worktree("new"), off: !space, say: "a new branch, as a space" },
    { kind: "row", id: "wt-open", icon: "folder", name: "Open worktree…", go: worktree("open"), off: !space, say: "a worktree, as a space" },
  ];
}

/** How the menu opens (openNewMenu). */
export interface NewMenuOpening {
  readonly centered?: boolean;
  readonly at?: DropAt | null;
  readonly wasOpen?: boolean;
}

/** Opens the menu, or closes it when it's open: hanging under the tab
 *  strip's "+ new" (`at`, kit.ts dropBelow; else under the pointer), dead
 *  center from a key (cmd-n), where the pointer could be anywhere. A dialog
 *  also takes the keyboard, so esc and the menu's keys reach it.
 *  `wasOpen`: "+ new" was lit when pressed (tabs.ts tool): the press closed
 *  the menu already, or closes it now; either way it stays closed. */
export function openNewMenu({ centered = false, at = null, wasOpen = false }: NewMenuOpening = {}): void {
  const open = readShared(shared, OPEN_KEY, null);

  if (open) {
    writeShared(setShared, OPEN_KEY, null);
    closeOverlay(open);

    return;
  }

  if (wasOpen) return;

  // An optional mod installed since the last look gets its tile (launchers.ts).
  readLaunchers().catch(() => undefined);

  // It sets its own height (menuHeight) as it finds agents and shows or hides
  // the ones that aren't installed: a popup is as tall as its content up to
  // `height`, a dialog without one up to most of the window.
  const props = { role: "new" };

  const id = centered
    ? openOverlay({ mod: "nocturne", kind: "dialog", frame: "none", width: WIDTH, props })
    : openOverlay(at
      ? { mod: "nocturne", kind: "popup", frame: "none", width: WIDTH, height: MOST, at, props }
      : { mod: "nocturne", kind: "popup", frame: "none", width: WIDTH, height: MOST, props });

  writeShared(setShared, OPEN_KEY, id);
}

/** The menu is open (the strip lights "+ new" and drops its tooltip). */
export const newMenuOpen = (): boolean => Boolean(readShared(shared, OPEN_KEY, null));

// The menu at its tallest (layout px); past it the body scrolls. Four rows of tiles (Processes,
// Databases and a launcher fill the fourth) with the agents a machine has: 640 and a tile row, which
// still hangs inside a small screen's window at zoom 0.9 (about 970 layout px under the strip).
const MOST = 640 + TILE_H + GAP;

/** How tall the menu is with these agents' rows (at least one: the "looking" line). */
export function menuHeight(agents: readonly KnownAgent[], show = showMissing()): number {
  const n = Math.max(1, agentRows(agents, show).length);
  const tiles = Math.ceil(menuPanels().length / COLS);

  return Math.min(MOST, HEAD + SECTION + tiles * TILE_H + (tiles - 1) * GAP + SECTION + n * ROW + SECTION + 3 * ROW + 8 + FOOT + 2);
}

/** The agents a machine ("": this one) last reported, as the menu keeps them. */
export const lastKnownAgents = (machine: string): readonly KnownAgent[] => readSharedMap(shared, KNOWN).get(machine) ?? [];

/** How tall the menu is for the agents it last found on the shown space's machine. */
export function newMenuHeight(): number {
  const machine = spaces().find((s) => s.active)?.machine ?? "";

  return menuHeight(readSharedMap(shared, KNOWN).get(machine) ?? []);
}

/** The menu's overlay, from its props. */
const isOverlayProps = object({ overlay: isString });

/** This copy's overlay id, if it has one. */
const overlayNow = (): string | null => {
  const p = props();

  return isOverlayProps(p) ? p.overlay : null;
};

export default class NewMenu {
  static bound = false;

  agents: readonly KnownAgent[] = [];
  cursor = 0;
  handle: FocusHandle | null = null;
  failed = false;
  flipped = 0;
  keep: string | null = null;

  init(_props: Props | undefined, cx: Context): void {
    const machine = spaces().find((s) => s.active)?.machine ?? null;

    this.agents = readSharedMap(shared, KNOWN).get(machine ?? "") ?? [];
    this.cursor = 0;

    const handle = cx.focus_handle();

    this.handle = handle;
    handle.focus();

    // The overlay takes the keyboard once it's shown; take it back.
    for (const ms of [60, 250, 600]) cx.timer.after(ms, () => handle.focus());

    // Tab is the base's focus key before it's ours: bound to an action in
    // this menu's key context, it flips the landing spot instead.
    if (!NewMenu.bound) {
      try {
        cx.bind_keys([
          { keystroke: "tab", action: FLIP, context: CONTEXT },
          { keystroke: "shift-tab", action: FLIP, context: CONTEXT },
          { keystroke: "escape", action: CLOSE, context: CONTEXT },
        ]);
        NewMenu.bound = true;
      } catch {
        /* the key handler still tries */
      }
    }

    cx.spawn(async (later) => {
      try {
        const found = (await knownAgents({ on: machine })).filter((a) => isKnownAgent(a));

        this.agents = found;
        writeSharedMap(setShared, KNOWN, new Map(readSharedMap(shared, KNOWN)).set(machine ?? "", found));
      } catch {
        this.failed = true;
      }

      later.notify();
    });
  }

  dismiss(): void {
    const id = overlayNow();

    if (id) closeOverlay(id);
  }

  /** The overlay is going (any way: a pick, esc, a click beside it, cmd-n). */
  closing(): void {
    if (readShared(shared, OPEN_KEY, null) === overlayNow()) writeShared(setShared, OPEN_KEY, null);
  }

  /** Flips where new things land (Tab, or its action). Once per press. */
  flip(cx: Context): void {
    if (Date.now() - this.flipped < 80) return;

    this.flipped = Date.now();
    writeShared(setShared, DEST, destNow() === "tab" ? "pane" : "tab");
    cx.notify();
  }

  /** Runs an item at `dest` (the switch's, unless shift asked for the other).
   *  The not-installed row shows or hides those agents and the menu stays. */
  pick(x: NewItem | undefined, dest: Dest = destNow(), cx: Context | null = null): void {
    if (!x || x.off) return;

    if (x.kind === "missing") {
      writeShared(setShared, MISSING_KEY, !showMissing());
      // The cursor stays on the row (it moves down as the agents show).
      this.keep = x.id;
      cx?.notify();

      return;
    }

    this.dismiss();

    if (x.kind === "tile") {
      if (dest === "tab") x.p.tab();
      else x.p.pane();
    } else if (x.kind === "agent") {
      if (dest === "tab") terminalTab(x.a.run, x.a.name);
      else terminalPane(x.a.run);
    } else x.go();
  }

  /** What picking `x` will do, for the footer. */
  say(x: NewItem | undefined, dest: Dest): string {
    if (!x) return "";

    if (x.off) return x.kind === "agent" ? `${x.a.name} isn't installed` : "open a space first";

    if (x.kind === "row") return x.say;

    if (x.kind === "missing") return `${x.shown ? "hides" : "shows"} ${x.n} not installed`;

    const name = x.kind === "agent" ? x.a.name : x.p.name.toLowerCase();

    if (dest === "tab") return `${name} in a new tab`;

    if (x.kind === "tile" && x.p.open?.()) return `closes the ${name}`;

    return `${name} in a new pane`;
  }

  // ---- parts

  /** The landing picture: the tab as a frame, the spot that's coming in dithered blue. */
  picture(t: Theme, dest: Dest): Element {
    const glow = (el: Element) => el.loop("opacity", { from: 0.55, to: 1, period: 1800 });
    const frame = div().relative().w(30).h(18).flex_none().border(1).border_color(t.ansi8);

    if (dest === "tab") {
      return v_flex().flex_none().gap(1)
        .child(h_flex().gap(2).h(3)
          .child(div().w(8).h_full().bg(t.ansi8))
          .child(glow(div().relative().w(8).h_full().child(dither(t.accent, 1)))))
        .child(frame.child(glow(div().absolute().top(2).bottom(2).left(2).right(2).child(dither(t.accent, 1)))));
    }

    return v_flex().flex_none().gap(1)
      .child(h_flex().gap(2).h(3).child(div().w(8).h_full().bg(t.ansi8)))
      .child(frame
        .child(div().absolute().top(0).bottom(0).left(14).w(1).bg(t.ansi8))
        .child(glow(div().absolute().top(2).bottom(2).left(17).right(2).child(dither(t.accent, 1)))));
  }

  /** The switch: two words on the horizon, the chosen one on a dithered band. */
  switcher(t: Theme, dest: Dest): Element {
    const opt = (id: Dest, label: string) => {
      const on = dest === id;

      return div().id(`nm-dest-${id}`).relative().h(20).px(7).flex().items_center().text_size(11)
        .text_color(on ? t.foreground : t.dim).hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click((_e: ClickEvent, cx: Context) => {
          cx.stop_propagation();
          writeShared(setShared, DEST, id);
          cx.notify();
        })
        .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)))
        .child(div().relative().child(label));
    };

    return h_flex().flex_none().items_center().child(opt("pane", "pane")).child(opt("tab", "new tab"));
  }

  head(t: Theme, dest: Dest): Element {
    return h_flex().relative().h(HEAD).flex_none().px(PAD).gap(10).items_center()
      .child(this.picture(t, dest))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child("New"))
      .child(div().flex_none().h(16).px(4).flex().items_center().border(1).border_color(t.ansi0).text_size(10).text_color(t.dim)
        .tooltip("tab flips where new things land").child("tab"))
      .child(this.switcher(t, dest))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }

  section(t: Theme, label: string, aside: string | null = null): Element {
    return h_flex().h(SECTION).flex_none().px(PAD).pt(6).gap(8).items_center()
      .child(eyebrow(t, label))
      .child(div().flex_1().h(1).relative().opacity(0.6).child(dither(t.ansi8, 1)))
      .when(Boolean(aside), (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child(aside ?? "")));
  }

  hoverTo(x: NewItem, live: readonly NewItem[]): (hovered: boolean, cx: Context) => void {
    return (h, cx) => {
      if (h && !x.off) {
        const i = live.indexOf(x);

        if (i !== this.cursor) {
          this.cursor = i;
          cx.notify();
        }
      }
    };
  }

  /** The landing a click asks for: the switch's, the other with shift. */
  clickDest(e: ClickEvent, dest: Dest): Dest {
    return e.modifiers.shift ? (dest === "tab" ? "pane" : "tab") : dest;
  }

  /** A panel tile: a strip along its top ("open" when it's open in the shown
   *  tab, with a blue mark, left; its key, right), then its icon and name. */
  tile(t: Theme, x: TileItem, on: boolean, live: readonly NewItem[], dest: Dest): Element {
    const open = !x.off && Boolean(x.p.open?.());
    const color = x.off ? t.ansi8 : on ? t.foreground : t.muted;

    // Every tile keeps its 1 px border (only its color changes), so hovering doesn't move anything.
    return v_flex().id(`nm-${x.id}`).relative().flex_1().min_w(0).h(TILE_H).px(5).pt(3).pb(7)
      .border(1).border_color(on && !x.off ? t.ansi8 : t.ansi0)
      .on_hover(this.hoverTo(x, live))
      .on_click((e, cx) => this.pick(x, this.clickDest(e, dest), cx))
      .when(on && !x.off, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)))
      .child(h_flex().relative().h(12).flex_none().gap(3).items_center().text_size(9)
        .when(open, (el) => el.child(div().size(4).flex_none().bg(t.accent)))
        .child(div().flex_1().min_w(0).truncate().text_color(open ? t.accent : t.dim).child(open ? "open" : ""))
        .child(div().flex_none().text_size(10).text_color(on ? t.accent : t.dim).child(x.key)))
      .child(v_flex().relative().flex_1().items_center().justify_center().gap(5)
        .child(svg(x.p.icon.includes("/") ? x.p.icon : chrome(x.p.icon)).size(16).flex_none().text_color(x.off ? t.ansi8 : on || open ? t.accent : t.dim))
        .child(div().max_w_full().truncate().text_size(11).text_color(color).child(on && open ? "close" : x.p.name)));
  }

  /** An agent's mark: its dithered logo, else Fireflies' icon for it. */
  mark(t: Theme, a: KnownAgent, color: Color): Element {
    const key = LOGO.get(a.key) ?? LOGO.get(a.app ?? "");

    if (key) return svg(`${ART}/logo-${key}.svg`).size(14).flex_none().text_color(color);

    if (!a.icon) return svg(`${ART}/logo-agent.svg`).size(14).flex_none().text_color(color);

    return a.tint ? svg(a.icon).size(14).flex_none().text_color(color) : image(a.icon).size(14).flex_none().opacity(a.installed ? 1 : 0.4);
  }

  row(t: Theme, x: NewItem, on: boolean, live: readonly NewItem[], dest: Dest, mark: Element, name: string, hint?: string): Element {
    return h_flex().id(`nm-${x.id}`).relative().h(ROW).flex_none().px(PAD).gap(10).items_center().text_size(12)
      .text_color(x.off ? t.ansi8 : on ? t.foreground : t.muted)
      .on_hover(this.hoverTo(x, live))
      .on_click((e, cx) => this.pick(x, this.clickDest(e, dest), cx))
      .when(on && !x.off, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
      .child(div().relative().w(14).flex_none().flex().items_center().justify_center().child(mark))
      .child(div().relative().flex_1().min_w(0).truncate().child(name))
      .child(div().relative().flex_none().text_size(11).text_color(on && !x.off ? t.accent : t.dim).child(hint ?? ""));
  }

  /** The dim last row of the agents: how many aren't installed, and show / hide. */
  missingRow(t: Theme, x: MissingItem, on: boolean, live: readonly NewItem[], dest: Dest): Element {
    const icon = svg(chrome(x.shown ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(on ? t.accent : t.ansi8);

    return this.row(t, x, on, live, dest, icon, `${x.n} not installed`, x.shown ? "hide" : "show").text_color(on ? t.muted : t.dim);
  }

  foot(t: Theme, x: NewItem | undefined, dest: Dest): Element {
    return h_flex().relative().h(FOOT).flex_none().px(PAD).gap(6).items_center().text_size(11)
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
      .child(div().flex_none().text_color(t.accent).child("↳"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(this.say(x, dest)))
      .child(div().flex_none().text_color(t.dim).child("shift: other"));
  }

  key(e: KeyEvent, cx: Context, live: readonly NewItem[]): void {
    const m = e.modifiers;

    if (m.control || m.platform || m.alt) return;

    const k = e.key.toLowerCase();
    const n = live.length;
    const cur = live[this.cursor];
    // In the grid, ↑ ↓ move by a row of tiles; ↓ into the short last row
    // from past its end lands on its last tile, ↓ from the last row leaves the grid.
    const tiles = live.filter((x) => x.kind === "tile").length;
    const inGrid = cur?.kind === "tile";
    const other = destNow() === "tab" ? "pane" : "tab";
    let done = true;

    if (k === "tab") this.flip(cx);
    else if (k === "right" || k === "left") this.cursor = (this.cursor + (k === "right" ? 1 : -1) + n) % n;
    else if (k === "down") {
      const lastRow = Math.floor((tiles - 1) / COLS);

      this.cursor = !inGrid ? (this.cursor + 1) % n
        : this.cursor + COLS < tiles ? this.cursor + COLS
        : Math.floor(this.cursor / COLS) < lastRow ? tiles - 1 : tiles;
    } else if (k === "up") this.cursor = inGrid ? (this.cursor >= COLS ? this.cursor - COLS : (this.cursor - 1 + n) % n) : this.cursor === tiles ? tiles - 1 : (this.cursor - 1 + n) % n;
    else if (k === "enter") {
      cx.stop_propagation();
      this.pick(cur, m.shift ? other : destNow(), cx);

      return;
    } else if (k === "escape") {
      cx.stop_propagation();
      this.dismiss();

      return;
    } else {
      // A tile's letter or an agent's number: the key itself, or what it types.
      const typed = [k, (e.key_char ?? "").toLowerCase()];

      const x = live.find((y) => {
        const key = keyOf(y);

        return key && typed.includes(key);
      });

      if (x) {
        cx.stop_propagation();
        this.pick(x, m.shift ? other : destNow());

        return;
      }

      // q closes, as esc does (a tile's own q would win above).
      if (k === "q" && !m.shift) {
        cx.stop_propagation();
        this.dismiss();

        return;
      }

      done = false;
    }

    if (done) {
      cx.stop_propagation();
      cx.notify();
    }
  }

  render(): Element {
    const t = theme();
    const dest = destNow();
    const all = items(this.agents);
    const live = all.filter((x) => !x.off);

    if (this.keep) {
      const keep = this.keep;
      const i = live.findIndex((x) => x.id === keep);

      if (i >= 0) this.cursor = i;

      this.keep = null;
    }

    this.cursor = Math.min(this.cursor, Math.max(0, live.length - 1));

    const current = live[this.cursor];
    const tiles = all.flatMap((x) => (x.kind === "tile" ? [x] : []));
    const grid: Element[] = [];

    for (let i = 0; i < tiles.length; i += COLS) {
      const slice = tiles.slice(i, i + COLS);

      grid.push(h_flex().id(`nm-grid-${i}`).gap(GAP).w_full()
        .children(slice.map((x) => this.tile(t, x, x === current, live, dest)))
        // A short last row keeps the columns: each pad is a tile's box (its
        // padding and border count toward a flex_1 item's width), left empty.
        .children(Array.from({ length: COLS - slice.length }, (_, j) => div().id(`nm-pad-${i}-${j}`).flex_1().min_w(0).h(TILE_H).px(5).border(1).border_color(t.background))));
    }

    const ags = all.flatMap((x) => (x.kind === "agent" || x.kind === "missing" ? [x] : []));
    const rows = all.flatMap((x) => (x.kind === "row" ? [x] : []));
    const machine = here().space?.machine;
    const handle = this.handle;

    return v_flex().id("nocturne-new").w_full().h(menuHeight(this.agents)).bg(t.background).border(1).border_color(t.ansi0)
      .key_context(CONTEXT)
      .when(Boolean(handle), (el) => (handle ? el.track_focus(handle) : el))
      .on_action(FLIP, (_e, cx) => this.flip(cx))
      .on_action(CLOSE, () => this.dismiss())
      .on_key_down((e, cx) => this.key(e, cx, live))
      .child(this.head(t, dest))
      .child(v_flex().id("nm-body").flex_1().min_h(0).overflow_y_scroll()
        .child(this.section(t, "panels"))
        .child(v_flex().px(PAD).gap(GAP).children(grid))
        .child(this.section(t, "start an agent", machine ? `on ${machine}` : null))
        .children(ags.map((x) => (x.kind === "missing" ? this.missingRow(t, x, x === current, live, dest)
          : this.row(t, x, x === current, live, dest, this.mark(t, x.a, x.off ? t.ansi8 : x === current ? t.foreground : t.dim),
            x.a.name, x.off ? "not installed" : (x.key ?? "")))))
        .when(!ags.length, (el) => el.child(div().h(ROW).px(PAD).flex().items_center().text_size(11).text_color(t.dim)
          .child(this.failed ? "couldn't ask for agents" : "looking for agents…")))
        .child(this.section(t, "space"))
        .children(rows.map((x) => this.row(t, x, x === current, live, dest,
          svg(chrome(x.icon)).size(14).flex_none().text_color(x.off ? t.ansi8 : x === current ? t.accent : t.dim), x.name, x.hint)))
        .child(div().h(8).flex_none()))
      .child(this.foot(t, current, dest));
  }
}
