// The sidebar: a dithered night sky.
//   moon     its lit share is the share of agents at rest (idle or done);
//            new moon while everything works, full when the herd is quiet
//   spaces   one row each (spaces.js), with inline create / rename / delete
//            spaces in a repo's worktrees sit indented under its main one
//   usage    Claude's or Codex's 5-hour and weekly limits (usage.js), foldable,
//            at the foot; the hills rest on top of it
//   meadow   every agent is a firefly: blocked blinks red at the top,
//            working drifts amber, done glows green below them (kit.js
//            agentRank), idle rests in the grass; how each flies and
//            glows is flight.js;
//            pinned ones (pins.js) sit above them all in a glass jar at
//            the top, in the order pinned, status and all; the glass
//            glints when one flies in and breathes red while one needs you;
//            other pinned panes (web, editor, files, a shell) sit as tiles
//            on a shelf at the jar's foot, a caption naming the one under
//            the pointer or the cursor (shelf());
//            nocturne.pin (cmd-alt-p) pins the focused pane, whatever it shows,
//            nocturne.pin-up / pin-down move it in the jar (on the shelf: left / right);
//            nocturne.agent-next / agent-prev walk the agents, then the shelf's
//            tiles, wrapping (walk.js; the layout's cmd-] / cmd-[);
//            its pane's name leads (kit.js givenName, else the agent's own, "Claude Code";
//            its space only when it's another one, awake ones add their status;
//            resting ones keep to one line); double-click to rename it
//            (esc: keep, empty: the agent's name back);
//            right-click for a menu: focus, rename, delete its tab (menu.js)
//   clock    the time and date beside the moon
//   fold    « at the top (or cmd-b / cmd-s) folds the sky into a rail: the
//            moon and the hour, a row per space (its first letters; the shown
//            one on the dithered band with a blue edge, the status pip at the
//            right edge), the fireflies' marks in the same order as open,
//            and a meter per usage window; the » key under the hour opens it
//            again. On macOS the rail is wide enough for the window buttons
//            at any zoom.
//   glow     the pointer carries a firefly's light over the sky and the rail
//            (glow.js): a nested view, so following it never redraws the sky
//   keys     the sidebar takes the keyboard from pane.go (cmd-alt-left from
//            the leftmost pane) or nocturne.sidebar (layout.focus): a cursor
//            walks every control (nav.js SIDEBAR_KEYS; ? lists them), the
//            hint line at its foot says the main ones; l / → goes back to
//            the panes, esc / q to the pane it came from.

import { div, svg, image } from "gpui-kit";
import type { Color, Context, Element, Entity, FocusHandle, KeyEvent, MouseButtonEvent, Point, Size } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex, InputState } from "gpui-base";
import { spaces, terminals, panes, run, hc, theme, setAgentOrder, nextCommand, shared, setShared, settings, layout, focused, window as appWindow } from "herdr";
import type { AgentInfo, PaneInfo, SpaceInfo, Status, Theme } from "herdr";
import * as herdrAll from "herdr";
import { isNumber, isString, object, readShared, readSharedMap, sharedKey, sharedMapKey, writeShared } from "./guard.ts";
import { isRawObject, isTerminal, mapOf } from "./guards.ts";
import { ART, LOGO, WORD, atRest, dither, pip, eyebrow, hash, givenName, nameTerminal, pin, movePin, sortedAgents, pinFocused, moveFocused, goToPin, unpin, dockWeb, dockFocused, jar as jarNow, paneRecordsNow, navRing, cornerTicks, tracked, GLOW_SQUARE, TICK_OUT } from "./kit.ts";
import { stamps, tidy, onShelf, storedRecords, PANES_KEY, GONE_AFTER as PIN_GONE } from "./pins.ts";
import type { JarItem } from "./pins.ts";
import { walkStops, walkAt, walkNext } from "./walk.ts";
import { markPath, modKind, paneName, paneMenu } from "./header.ts";
import { isDock, adoptDock, dockMaking } from "./dock.ts";
import { field } from "./inline.ts";
import Spaces from "./spaces.ts";
import { NAME_AGENT_KEY, EDIT_SPACE_KEY, openMenu, openKeys, newWorktree } from "./menu.ts";
import { keysHint } from "./keyhelp.ts";
import { SIDEBAR_KEYS, SIDEBAR_HELP, keyVerb, move, moveSection, keep, blockOf, isLayoutNode } from "./nav.ts";
import type { NavActs } from "./nav.ts";
import { toggleGit, openWorktrees } from "./git.ts";
import { UsageSection } from "./usage.ts";
import { focusFiles } from "./files.ts";
import { togglePicker } from "./picker.ts";
import { openScratchpad } from "./scratchpad.ts";
import { toggleGithub, githubForm } from "./github.ts";
import { toggleDeck, lastFailed, grantAppManagement } from "./scripts.ts";
import { toggleProcs } from "./procs.ts";
import { openNewMenu, OPEN as NEW_OPEN } from "./newmenu.ts";
import { openSpacePicker } from "./newspace.ts";
import { gridify } from "./gridify.ts";
import { toastKey } from "./toast.ts";
import { dismissUpdate } from "./screens.ts";
import { calm, flash, dust, fly as flyPath } from "./flight.ts";
import { Fireglow, nextGlow, GONE_AFTER } from "./glow.ts";
import type { GlowPlace, GlowProps } from "./glow.ts";
import { bindTab, tabActions } from "./form-keys.ts";

export { GLOW_SQUARE };

const stop = (_e: MouseButtonEvent, cx: Context) => cx.stop_propagation();

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** The time and date as the sky shows them. */
interface Clock {
  readonly time: string;
  readonly date: string;
}

/** The time ("14:05") and date ("Fri 6 Nov") right now. */
function clock(): Clock {
  const d = new Date();

  return { time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, date: `${DAYS[d.getDay()] ?? ""} ${d.getDate()} ${MONTHS[d.getMonth()] ?? ""}` };
}

/** A lane of the meadow: its top and height (layout px), and whether it's in the jar. */
export interface Lane {
  readonly y: number;
  readonly h: number;
  readonly jar: boolean;
}

/** How far a lane's press area reaches into the gaps above and below it. */
export interface Reach {
  up: number;
  down: number;
}

/** How far each lane's press area reaches into the gaps above and below it
 *  (layout px): half the gap to its neighbour, so no strip between two
 *  agents is dead; the jar's lanes only to each other (its glass between). */
export function laneReach(lanes: readonly Lane[]): Reach[] {
  const order = lanes.map((_l, i) => i).sort((i, j) => (lanes[i]?.y ?? 0) - (lanes[j]?.y ?? 0));
  const out: Reach[] = lanes.map(() => ({ up: 0, down: 0 }));

  for (let k = 0; k + 1 < order.length; k++) {
    const ia = order[k] ?? 0;
    const ib = order[k + 1] ?? 0;
    const a = lanes[ia];
    const b = lanes[ib];
    const ra = out[ia];
    const rb = out[ib];

    if (!a || !b || !ra || !rb || a.jar !== b.jar) continue;

    const gap = Math.max(0, b.y - (a.y + a.h));

    ra.down = Math.floor(gap / 2);
    rb.up = gap - Math.floor(gap / 2);
  }

  return out;
}

/** A web pane's props, as far as its name goes: its slot and the address it opened on. */
const isWebProps = object({}, { slot: isString, url: isString });

/** The browser's page titles, by slot; its tabs' titles, by slot and tab. */
const TITLES = sharedMapKey("browser.titles", isString);
const TAB_TITLES = sharedMapKey("browser.tab-titles", isRawObject);

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

/** The shelf's height for `n` tiles in `w` px (layout px): the board, the
 *  rows of tiles (as many to a row as fit), the caption line. */
export function shelfHeight(n: number, w: number): number {
  if (!n) return 0;

  const perRow = Math.max(1, Math.floor((w - 2 * SHELF_PAD + TILE_GAP) / (TILE + TILE_GAP)));
  const rows = Math.ceil(n / perRow);

  return BOARD + BOARD_GAP + rows * TILE + (rows - 1) * TILE_GAP + CAPTION.gap + CAPTION.h;
}

/** The open jar's rows (jarPlan). */
export interface JarPlan {
  readonly ys: number[];
  readonly shelfY: number;
  readonly jarH: number;
}

/**
 * The open jar's rows when the sky has room (layout px from the meadow's top):
 * each firefly lane's top (`lanes`: their heights, in jar order), the shelf's
 * top (`shelfH`: its height, 0 for none) and the jar's height. A jar held at
 * its least height (JAR.min) centers what it holds in the glass, so one firefly
 * sits in the middle with as much glass above as under it.
 */
export function jarPlan(lanes: readonly number[], shelfH = 0): JarPlan {
  const held = lanes.reduce((n, l) => n + l, 0) + (shelfH ? (lanes.length ? SHELF_ABOVE : 0) + shelfH : 0);
  const jarH = Math.max(JAR.min, JAR.top + held + JAR.bottom);
  let y = JAR.top + Math.floor((jarH - JAR.top - held - JAR.bottom) / 2);

  const ys = lanes.map((l) => {
    const at = y;

    y += l;

    return at;
  });

  return { ys, shelfY: shelfH ? (lanes.length ? y + SHELF_ABOVE : y) : 0, jarH };
}

/** The shelf's inset from the jar's walls (layout px): its tiles and caption
 *  start where a firefly's square does (its lane's mark at x 6, the glow's
 *  square GLOW_SQUARE.at in), so they line up under the fireflies. */
export const SHELF_PAD = 6 + GLOW_SQUARE.at;

function moonPhase(list: readonly AgentInfo[]): number {
  if (!list.length) return 8;

  const rest = list.filter((a) => a.status === "idle" || a.status === "done").length;

  return Math.round((rest / list.length) * 8);
}

// Fireflies shows a hidden tab's terminals at 54x52 for a moment before their
// real size, and Claude Code's renderer is left half-drawn by the double
// resize until something makes it draw again. So when a tab comes into view,
// once the sizes have settled, idle Claude Codes there get an "x" and a
// backspace: a redraw that leaves the prompt as it was. Working ones get it
// too (their spinner only redraws its own line); blocked ones show a dialog
// where a letter can be an answer, so they're left alone. Only on stock
// Fireflies: the DwieDave fork (the one with native views) holds a new size until
// the layout settles, so programs never see the placeholder.
const REDRAW_ON_SHOW = !("nativeView" in herdrAll);

// Agents with a dithered mark in art/ (art/logos.py), by program key or the
// agent's own app name. Others wear Fireflies' icon for them.
// Fireflies' shipped check (lucide), the done mark.
const CHECK = "mods/workspace-chrome/check.svg";

// How long a mark's scanline takes there and back, by status; still otherwise.
const SWEEP: ReadonlyMap<Status, number> = new Map([["working", 2400], ["blocked", 900]]);

// How fast the wings beat (there and back), by status; resting ones fold them.
const FLAP: ReadonlyMap<Status, number> = new Map([["working", 260], ["blocked", 140], ["done", 900]]);

// Going to rest: how long the flight down to the ridge takes, while the
// glow and the mark's last awake color fade into the resting one.
const LAND = 1800;

// Late enough for both resizes of a space switch to have landed.
const REDRAW_DELAY = 700;

// Folding: the rail's width and where the open width is remembered.
// Narrower than RAIL_BELOW draws the rail, so dragging the edge in folds it
// too. On macOS the window buttons sit at the layout's traffic_lights (16 pt
// in, about 54 pt wide) in points, not zoomed: the rail gives them 16 pt on
// the far side too, in layout px at the zoom it's folded at.
const RAIL = 76;
const LIGHTS_ROOM = 86;
const railWidth = (): number => (appWindow().platform === "macos" ? Math.max(RAIL, Math.ceil(LIGHTS_ROOM / (settings().zoom || 1))) : RAIL);
const RAIL_BELOW = 160;

// The rail's ground (railGround): how far above the usage the stack ends (on
// the near ridge), how many at rest stand in one column before they pair
// up, and how many cells it shows at most (the last becomes "+n").
const RAIL_RIDGE = 74;
const RAIL_GROUND_ONE = 4;
const RAIL_GROUND_MAX = 8;
const OPEN_WIDTH = sharedKey("nocturne.sidebar", isNumber);
const OPEN_DEFAULT = 252;

// How long a fold gets to land before its width is checked (ms).
const SETTLE = 350;

// The jar of pinned fireflies (pins.js) at the top of the sky: where its
// first lane starts under the lid, the glass under its last, the clear sky
// before the next firefly (layout px).
const JAR = { at: 4, top: 38, bottom: 12, gap: 10, min: 112 } as const;

// min: the jar's least height, so with one firefly in it its lid, neck and
// shoulders don't take most of it (a wide flat band): there's glass under it.
// The jar's side margins in the open sky (equal both sides), and how far its
// fireflies' lanes sit in from the sidebar's edges (inside the 2 px walls).
const JAR_SIDE = 8, JAR_INSET = JAR_SIDE + 2;

// How far the neck sits in from the body's walls: in the open sky, on the rail.
const NECK = 22, RAIL_NECK = 11;

// Where the body's walls begin, under the lid, neck and shoulders.
const BODY = 16;

// The open sky's mason jar: its lid (rim and thread) and where its walls
// begin, under the neck and the round shoulders.
const LID = 10, JAR_BODY = 28;

/** How far a rail firefly's press area reaches past its cell, beside and above / below. */
interface RailReach {
  readonly x: number;
  readonly y: number;
}

// How far a rail firefly's press area reaches past its cell: into the rail's
// padding beside it, half the 2 px gap above and below; the ground's pairs
// sit 2 px apart, so there only half that.
const RAIL_REACH: RailReach = { x: 8, y: 1 };
const PAIR_REACH: RailReach = { x: 1, y: 1 };

// How long the glass glints after a firefly flies in (ms): as long as the flight.
const GLINT = 1800;

// The shelf at the jar's foot, where pinned panes that aren't agents sit as
// tiles (pins.js onShelf): a tile's size and the gap between tiles, the
// room above it under the last firefly (clear of its halo: air before the
// board), its dithered board, the board's gap to the tiles, the caption line
// under them (its gap above, its height); SHELF_PAD (above) is its inset from
// the jar's walls. On the rail: smaller tiles, two abreast.
const TILE = 28, TILE_GAP = 6, SHELF_ABOVE = 10, BOARD = 2, BOARD_GAP = 6, CAPTION = { gap: 6, h: 14 } as const;
const RAIL_TILE = 18, RAIL_TILE_GAP = 4;

/** A control the sidebar's cursor walks: its id, its section, what the keyboard's verbs do on it. */
type NavEntry = NavActs & { readonly id: string; readonly sec: string };

/** The verbs a control acts on itself. */
type ActVerb = keyof NavActs;

const ACT_VERBS: ReadonlySet<string> = new Set<ActVerb>(["go", "menu", "rename", "folder", "delete", "tab", "worktree", "new", "pin", "pin-up", "pin-down"]);

const isActVerb = (verb: string): verb is ActVerb => ACT_VERBS.has(verb);

/** The sidebar's sections, top to bottom, as the cursor walks them. */
const SECTION_RANK: ReadonlyMap<string, number> = new Map([["top", 0], ["spaces", 1], ["flies", 2], ["usage", 3]]);

/** An agent just gone to rest: its last awake color, and until when it lands. */
interface Landing {
  readonly color: Color;
  readonly until: number;
}

/** What the glow needs of the sky to light its backdrop. */
type GlowSky = Pick<GlowProps, "folded" | "h" | "lift">;

/** A lane placed in the meadow: its agent, its top, its height. */
type Placed = readonly [AgentInfo, number, number];

/** A jar item's pane, if it has one (a mod pane, a terminal shown in one). */
const paneOf = (it: JarItem): PaneInfo | null => ("pane" in it ? it.pane : null);

/** What the jar holds by key: an agent's address, a pin's jar key. */
const heldKey = (x: AgentInfo | JarItem): string => ("address" in x ? x.address : x.key);

/** The heights above the rail's space list (railTop): its clock, its » key. */
interface RailTops {
  clock?: number;
  key?: number;
}

export default class Sky {
  spaces = new Spaces();
  handle: FocusHandle | null = null;
  cursor: string | null = null;
  navAt = 0;
  navList: NavEntry[] = [];
  usage = new UsageSection();
  size: Size = { width: 248, height: 800 };
  want: boolean | null = null; // the fold state asked for while it lands (fold())
  foldAt = 0;
  reasked = false;
  field: Size = { width: 248, height: 300 };
  naming: string | null = null; // the address of the agent being named
  nameInput: InputState | null = null;
  nameAsked: number | null = null;
  clock: Clock = clock();
  glow: Entity | null = null;
  glowList: Entity | null = null;
  railTops: RailTops = {};
  glowAt: GlowPlace | null = null;
  glowSky: GlowSky = {};
  glowKey = "";
  walkedTo: string | null = null;
  seen = new Map<string, Status>();
  landing = new Map<string, Landing>();
  glintUntil = 0;
  arriving: Set<string> | null = null;
  jarSeen: Set<string> | null = null;
  stamped = new Map<string, number>();
  tileOn: string | null = null;
  tileHover: string | null = null;
  railHover: string | null = null;
  missing = new Map<string, number>();
  tidyLater = false;
  shownTab: string | undefined = undefined;
  shownSpace: string | null = null;
  shownTabs = new Set<string>();
  tabSpace = new Map<string, SpaceInfo>();

  init(_props: Props | undefined, cx: Context): void {
    // No "+ new" menu outlives a restart or a layout switch: forget one.
    setShared(NEW_OPEN, null);
    this.spaces = new Spaces();
    this.spaces.init(cx);

    // The keyboard (nav.ts): the cursor's control, where it was in the list,
    // the controls as last drawn ({ id, sec, go?, menu?, ... }).
    const handle = cx.focus_handle();

    this.handle = handle;
    bindTab(cx); // tab / shift-tab reach the key handler (form-keys.ts)
    this.cursor = null;
    this.navAt = 0;
    this.navList = [];
    this.spaces.onDone = () => this.refocus();
    this.spaces.focusHost = () => handle.focus(); // an inline form's chip has the keyboard
    this.usage = new UsageSection();
    this.usage.init(cx);
    // keys.json's layout:nocturne section sends nocturne.next / nocturne.prev
    // here: the next space in the sidebar's order (worktrees under their repo);
    // nocturne.git (cmd-g; nocturne.lazygit, its old name, too) toggles the git
    // window (git.ts), nocturne.diff the same on its Review tab, nocturne.worktrees
    // on its Worktrees tab (what the worktree dialog was), nocturne.files
    // the files pane with the keyboard in it (files.ts focusFiles), nocturne.github (cmd-shift-g) the GitHub
    // window (github.ts; nocturne.github-pr / nocturne.github-run open it on a new pull request or running a workflow), nocturne.scripts (cmd-shift-r) the script runner's
    // deck (scripts.ts; nocturne.scripts-failed, a failure's toast, opens it
    // on that run's output; nocturne.scripts-again runs the folder's last
    // script again; nocturne.scripts-grant, the toast of a nix-darwin switch
    // that Herdr Core's missing App Management stopped, opens that setting),
    // nocturne.procs the processes and ports manager (procs.ts; nocturne.ports
    // on its ports tab),
    // nocturne.new (cmd-n) the "+ new" menu, nocturne.gridify (cmd-alt-g)
    // the shown tab's panes into an even grid (gridify.ts), nocturne.picker
    // (cmd-p) and nocturne.grep (cmd-shift-f) the file picker (picker.ts);
    // nocturne.scratchpad the repository's note in the editor (scratchpad.ts;
    // nocturne.scratchpad-tab in a tab of its own; the palette and the "+ new"
    // menu run these: this copy outlives their overlays while git answers);
    // nocturne.dock moves the focused pane into the dock and pins it, nocturne.dock-web
    // opens a web pane there (dock.ts);
    // nocturne.toast runs the newest toast's action, nocturne.toast-close
    // (alias nocturne.toast-dismiss) dismisses it (toast.ts), or with none the
    // update note; nocturne.update-close closes the update note (screens.ts).
    // A saved file doesn't restart this loop: changes to it need the layout
    // shown again (another layout and back) or the app restarted.
    cx.spawn(async (later) => {
      for (;;) {
        const c = (await nextCommand()).replace(/^nocturne\./, "");

        if (c === "focus") this.takeKeys();
        else if (c === "sidebar") this.toggleKeys();
        else if (c === "next") this.spaces.step(1);
        else if (c === "prev") this.spaces.step(-1);
        else if (c === "fold") this.fold(later);
        else if (c === "git" || c === "lazygit") toggleGit();
        else if (c === "diff") toggleGit({ review: true });
        else if (c === "worktrees") openWorktrees();
        else if (c === "files") focusFiles();
        else if (c === "picker") togglePicker("files");
        else if (c === "grep") togglePicker("grep");
        else if (c === "scratchpad" || c === "scratchpad-tab") openScratchpad(c === "scratchpad-tab");
        else if (c === "github") toggleGithub();
        else if (c === "github-pr") githubForm("pr");
        else if (c === "github-run") githubForm("run");
        else if (c === "scripts") toggleDeck({ centered: true });
        else if (c === "scripts-again") toggleDeck({ centered: true, again: true });
        else if (c === "scripts-failed") toggleDeck({ centered: true, focus: "runs", show: lastFailed() });
        else if (c === "scripts-grant") grantAppManagement();
        else if (c === "procs") toggleProcs({ centered: true });
        else if (c === "ports") toggleProcs({ centered: true, tab: "ports" });
        else if (c === "gridify") gridify(later);
        else if (c === "new") openNewMenu({ centered: true });
        else if (c === "space-new") openSpacePicker();
        else if (c === "pin") pinFocused();
        else if (c === "dock") dockFocused();
        else if (c === "dock-web") dockWeb();
        else if (c === "pin-up") moveFocused(-1);
        else if (c === "pin-down") moveFocused(1);
        else if (c === "agent-next") this.walk(1);
        else if (c === "agent-prev") this.walk(-1);
        // With no toast on show, closing one closes the update note.
        else if (c === "toast" || c === "toast-close" || c === "toast-dismiss") {
          if (!toastKey(c) && c !== "toast") dismissUpdate();
        } else if (c === "update-close") dismissUpdate();

        later.notify();
      }
    });
    this.size = { width: 248, height: 800 };
    this.want = null;
    cx.timer.every(SETTLE, (later) => this.settle(later));
    this.field = { width: 248, height: 300 };
    this.naming = null;

    const input = InputState.new({ placeholder: "name" });

    this.nameInput = input;
    input.on("submit", (_e, later) => this.name(input.value().trim(), later));
    // A firefly's menu (another copy of this mod) asks for naming through
    // shared(NAME_AGENT); a request from before this sky was made is old.
    this.nameAsked = readShared(shared, NAME_AGENT_KEY, null)?.at ?? null;
    this.clock = clock();
    // The pointer's own firefly (glow.ts): a nested view, so following the
    // pointer rebuilds only it.
    this.glow = cx.new(Fireglow, {});
    // On the rail the space list sits on a plate of the night (no star by a
    // letter): a second glow inside it, under its letters, carries the light
    // across it. railTop: how far down the sky the list starts (layout px).
    this.glowList = cx.new(Fireglow, {});
    this.railTops = {};
    this.glowAt = null;
    this.glowSky = {};
    cx.timer.every(5000, (later) => {
      const c = clock();

      if (c.time !== this.clock.time) {
        this.clock = c;
        later.notify();
      }
    });
  }

  /** nocturne.agent-next / agent-prev (walk.ts): the next / previous agent in
   *  the sidebar's order, then on through the shelf's tiles, wrapping. A tile
   *  is gone to the way a click on it goes (kit.ts goToPin). */
  walk(dir: number): void {
    const stops = walkStops(sortedAgents().all.map((a) => a.address), jarNow().filter(onShelf));
    const to = walkNext(stops, walkAt(stops, focused(), this.walkedTo), dir);

    if (!to) return;

    this.walkedTo = to.key;

    if ("item" in to) goToPin(to.item);
    else run("agent.focus", { terminal: to.agent });
  }

  /** A menu's ask ({ at }) this view hasn't answered yet. */
  asked(ask: { readonly at: number } | null, answered: number | null): boolean {
    return Boolean(ask) && ask?.at !== answered;
  }

  /** Starts naming the agent a firefly menu asked about, once per request
   *  (from a task, never a render: see render). */
  answerNaming(list: readonly AgentInfo[], cx: Context): void {
    const ask = readShared(shared, NAME_AGENT_KEY, null);

    if (!ask || ask.at === this.nameAsked) return;

    this.nameAsked = ask.at;

    const a = list.find((x) => x.address === ask.address);

    if (!a || this.folded) return;

    this.naming = a.address;
    this.nameInput?.set_value(givenName(a.address) ?? "");
    this.nameInput?.focus();
    cx.notify();
  }

  /** The pointer moved over the sky (or left it, `local` null): the glow
   *  (glow.ts) follows it. Only the glow's own view is rebuilt, and only when
   *  it moves to another cell; once faded out it leaves the tree. */
  pointer(local: Point | null | undefined, cx: Context): void {
    const at = nextGlow(this.glowAt, local, settings().zoom, calm());

    if (!at) return;

    this.glowAt = at;
    this.showGlow(at);

    if (!at.on) {
      cx.timer.after(GONE_AFTER, () => {
        if (this.glowAt === at) this.showGlow({ ...at, gone: true });
      });
    }
  }

  /** Hands the glow (and on the rail its copy in the space list) its props. */
  showGlow(at: GlowProps): void {
    this.glow?.set_props({ ...this.glowSky, ...at });

    if (this.glowSky.folded) this.glowList?.set_props({ ...this.glowSky, ...at, ox: 0, oy: this.railTop });
  }

  /** Where the rail's space list starts: under its top padding, the clock and the » key. */
  get railTop(): number {
    return 48 + (this.railTops.clock ?? 0) + (this.railTops.key ?? 0);
  }

  /** Notes a measured height above the rail's space list (railTop). */
  railMeasure(k: keyof RailTops): (size: Size, cx: Context) => void {
    return (size, cx) => {
      const v = Math.round(size.height / (settings().zoom || 1));

      if (this.railTops[k] !== v) {
        this.railTops[k] = v;
        cx.notify();
      }
    };
  }

  /** A firefly's right-click menu: focus, rename, move or close its pane. */
  flyMenu(a: AgentInfo, centered = false): void {
    openMenu({ tab: "fly", target: { id: a.tab, address: a.address } }, { width: 280, centered });
  }

  /** Folded: what was last asked for while a fold settles, else what the width says
   *  (dragging the edge in folds too). */
  get folded(): boolean {
    return this.want ?? this.size.width < RAIL_BELOW;
  }

  /**
   * Folds to the rail, or opens to the width it had. Quick presses don't
   * trust the measured width, which lags the resize: each press flips the
   * wanted state, draws it at once, and asks for that width. Once things
   * settle, a width that doesn't match (a resize lost in a burst) is asked
   * for again; then the width rules again.
   */
  fold(cx: Context): void {
    const folded = this.folded;

    // Remember the open width only from a settled, open sidebar.
    if (!folded && this.want == null && this.size.width >= RAIL_BELOW) writeShared(setShared, OPEN_WIDTH, Math.round(this.size.width));

    this.want = !folded;
    this.foldAt = Date.now();
    this.reasked = false;
    this.askFold();
    cx.notify();
  }

  askFold(): void {
    const open = Math.max(RAIL_BELOW + 40, readShared(shared, OPEN_WIDTH, 0) || OPEN_DEFAULT);

    run("layout.resize", { id: "sidebar", px: this.want ? railWidth() : open });
  }

  /** Every SETTLE ms while a fold is landing: ask again if the width is wrong, then let the width rule. */
  settle(cx: Context): void {
    if (this.want == null) return;

    const age = Date.now() - this.foldAt;

    if (age < SETTLE) return;

    const there = this.want ? this.size.width < RAIL_BELOW : this.size.width >= RAIL_BELOW;

    if (!there && !this.reasked) {
      this.reasked = true;
      this.foldAt = Date.now();
      this.askFold();

      return;
    }

    if (there || age >= SETTLE * 4) {
      this.want = null;
      cx.notify();
    }
  }

  foldButton(t: Theme, label: string): Element {
    const on = this.nav("fold", "top", { go: (cx) => this.fold(cx) });

    return div().id("fold").relative().flex_none().px(5).h(18).flex().items_center().text_size(11).text_color(on ? t.foreground : t.dim)
      .map((el) => navRing(t, el, on))
      .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.fold(cx);
      })
      .child(label);
  }

  // ---- naming agents: an agent goes by its pane's name, kept on its terminal (kit.ts NAME_LABEL)

  startNaming(a: AgentInfo, cx: Context): void {
    this.naming = a.address;
    this.nameInput?.set_value(givenName(a.address) ?? "");
    this.nameInput?.focus();
    cx.notify();
  }

  name(value: string, cx: Context): void {
    const terminal = this.naming;

    this.naming = null;
    cx.notify();

    if (terminal) nameTerminal(terminal, value);

    this.refocus();
  }

  // ---- the keyboard (nav.ts)

  /** This sidebar's layout block (the one showing nocturne as the sky). */
  get block(): string | null {
    const tree = layout();

    return blockOf(isLayoutNode(tree) ? tree : null, "sky");
  }

  /** The sidebar has the keyboard (pane.go or layout.focus gave it the block). */
  get navOn(): boolean {
    const b = this.block;

    return Boolean(b) && focused()?.block === b;
  }

  /** "focus" from Fireflies: the keyboard is the sidebar's. */
  takeKeys(): void {
    this.handle?.focus();
    this.placeCursor();
  }

  /** A cursor on a live control: where it was, else its neighbor (a space closed), else the shown space. */
  placeCursor(): boolean {
    if (this.navList.some((x) => x.id === this.cursor)) return false;

    const shown = spaces().find((s) => s.active);

    this.cursor = this.cursor == null
      ? (this.navList.find((x) => x.id === `space:${shown?.id ?? ""}`)?.id ?? keep(this.navList, null))
      : keep(this.navList, this.cursor, this.navAt);

    return true;
  }

  /** nocturne.sidebar: into the sidebar, or back out to the pane. */
  toggleKeys(): void {
    if (this.navOn) {
      this.back();

      return;
    }

    const b = this.block;

    if (b) run("layout.focus", { id: b });
  }

  /** Back to the pane the keyboard came from (pane.focus clears the block). */
  back(): void {
    const pane = focused()?.pane;

    if (pane) run("pane.focus", { pane });
    else run("pane.go", { direction: "right" });
  }

  /** After an inline edit (a name, a folder, a delete): the keyboard back on the sidebar. */
  refocus(): void {
    if (this.navOn) this.handle?.focus();
  }

  /** A control the keyboard can reach, as it's drawn: true while the cursor is on it. */
  nav = (id: string, sec: string, acts: NavActs = {}): boolean => {
    this.navList.push({ ...acts, id, sec });

    return this.navOn && this.cursor === id;
  };

  /** The verbs on a firefly. */
  flyActs(a: AgentInfo): NavActs {
    return {
      go: () => run("agent.focus", { terminal: a.address }),
      menu: () => this.flyMenu(a, true),
      rename: (cx) => {
        if (!this.folded) this.startNaming(a, cx);
      },
      pin: () => pin(a.address),
      "pin-up": () => movePin(a.address, -1),
      "pin-down": () => movePin(a.address, 1),
    };
  }

  /** The verbs on a pinned pane that isn't an agent's (pinLane, railPin). */
  pinActs(it: JarItem): NavActs {
    const p = paneOf(it);

    return {
      go: () => goToPin(it),
      menu: () => {
        if (p) paneMenu(p, true);
      },
      pin: () => unpin(it),
      "pin-up": () => movePin(it.key, -1),
      "pin-down": () => movePin(it.key, 1),
    };
  }

  /** The verbs on a space's rail row: Fireflies' own dialogs, as the folded menu uses. */
  railActs(s: SpaceInfo): NavActs {
    const acts: NavActs = {
      go: () => run("space.select", { id: s.id }),
      menu: () => this.spaces.menu(s, true),
      rename: () => run("space.rename", { id: s.id }),
      tab: () => run("tab.new", { space: s.id }),
    };

    // The dock (dock.ts) keeps no folder and isn't deleted by a key.
    return isDock(s) ? acts : { ...acts, folder: () => this.spaces.folder(s), delete: () => run("space.close", { id: s.id }), worktree: () => newWorktree(s.id) };
  }

  /** A key while the sidebar has the keyboard. */
  key(e: KeyEvent, cx: Context): void {
    if (this.spaces.confirmKey(e, cx)) {
      cx.stop_propagation();
      cx.notify();

      return;
    }

    // A field inside (a name, a folder) has the keyboard: its keys are its own.
    if (this.naming || this.spaces.mode) return;

    const verb = keyVerb(e, SIDEBAR_KEYS);

    if (!verb) return;

    cx.stop_propagation();

    const items = this.navList;
    const item = items.find((x) => x.id === this.cursor);

    switch (verb) {
      case "down":
      case "up":
        this.cursor = move(items, this.cursor, verb === "down" ? 1 : -1);
        break;
      case "first":
        this.cursor = items[0]?.id ?? null;
        break;
      case "last":
        this.cursor = items.at(-1)?.id ?? null;
        break;
      case "next":
      case "prev":
        this.cursor = moveSection(items, this.cursor, verb === "next" ? 1 : -1);
        break;
      case "right":
        run("pane.go", { direction: "right" });

        return;
      case "back":
        this.back();

        return;
      case "help":
        openKeys("sidebar keys", SIDEBAR_HELP);

        return;
      case "new":
        openSpacePicker();
        break;
      default:
        if (item && isActVerb(verb)) item[verb]?.(cx);
    }

    this.navAt = Math.max(0, items.findIndex((x) => x.id === this.cursor));
    cx.notify();
  }

  /** The hint line at the sidebar's foot while it has the keyboard. */
  hints(t: Theme): Element {
    return h_flex().id("sky-hints").absolute().left(0).right(0).bottom(0).h(20).px(10).gap(8).items_center()
      .bg(t.background).text_size(11).text_color(t.dim)
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.accent, 1)))
      .child(div().text_color(t.accent).child("sidebar"))
      .child(div().flex_1().min_w(0).truncate().child("jk ⏎ m menu esc"))
      // ? keys last, never cut off (keyhelp.ts).
      .child(keysHint(t, "sky-keys", false, () => openKeys("sidebar keys", SIDEBAR_HELP)));
  }

  header(t: Theme, list: readonly AgentInfo[]): Element {
    const n = (s: Status) => list.filter((a) => a.status === s).length;
    const blocked = n("blocked");
    const working = n("working");
    const done = n("done");
    const rest = list.length - blocked - working;
    const lines: (readonly [Color, string, boolean])[] = [];

    if (blocked) lines.push([t.blocked, `${blocked} ${WORD.blocked}`, false]);

    if (working) lines.push([t.working, `${working} working`, false]);

    if (done) lines.push([t.done, `${done} done`, true]);

    // The moon and the hour side by side, like a night almanac: the time is
    // the one large figure, the date and the herd sit under it in small type.
    // The pair stays centered as the sidebar is resized.
    return h_flex().pt(54).px(14).gap(12).items_center().justify_center().flex_none()
      .child(svg(`${ART}/moon-${moonPhase(list)}.svg`).w(88).h(88).flex_none().text_color(t.ansi7))
      .child(v_flex().min_w(0).gap(2)
        .child(div().text_size(22).text_color(t.foreground).child(this.clock.time))
        .child(div().truncate().text_size(11).text_color(t.ansi8).child(this.clock.date.toUpperCase()))
        .child(div().h(6))
        .child(list.length
          ? h_flex().items_baseline().gap(5).min_w(0)
            .child(div().flex_none().text_size(11).text_color(t.foreground).child(`${rest}/${list.length}`))
            .child(div().truncate().text_size(11).text_color(t.ansi8).child("at rest"))
          : div().truncate().text_size(11).text_color(t.ansi8).child("no agents"))
        .children(lines.map(([c, s, check], i) => h_flex().id(`sum-${i}`).min_w(0).gap(4).items_center()
          .when(check, (el) => el.child(svg(CHECK).size(10).flex_none().text_color(c)))
          .child(div().truncate().text_size(11).text_color(c).child(s)))));
  }

  /** A 12 px check on a dark plate, set on a done firefly's mark. */
  doneBadge(t: Theme): Element {
    return div().size(12).flex().items_center().justify_center().bg(t.background).border(1).border_color(t.done)
      .child(svg(CHECK).size(8).text_color(t.done));
  }

  /** The agent's mark, 16 px: a dithered logo (art/logo-*.svg), else Fireflies' own icon, else a bot. */
  mark(a: AgentInfo, color: Color): Element {
    const p = a.program;
    const key = LOGO.get(p.key) ?? LOGO.get(a.app ?? "");

    if (key) return svg(`${ART}/logo-${key}.svg`).size(16).text_color(color);

    if (p.icon) return p.tint !== false ? svg(p.icon).size(16).text_color(color) : image(p.icon).size(16);

    return svg(`${ART}/logo-agent.svg`).size(16).text_color(color);
  }

  /** A pair of 1-bit wings over the mark's shoulders (art/wings.svg). They beat
   *  by folding: a clip anchored at their base shortens and grows, so the tips
   *  dip behind it, pixels kept whole. Resting ones hold them still. */
  wings(a: AgentInfo, h: number, color: Color, landing: Landing | undefined): Element {
    const beat = calm() ? null : landing ? FLAP.get("working") : FLAP.get(a.status);

    // Roots on the mark's shoulders: the mark sits at 12..28, its body's top edge near 15.
    // The mark's own color: one creature, not a sprite with a costume.
    const clip = div().absolute().left(8).top(10).w(25).h(8).overflow_hidden()
      .child(svg(`${ART}/wings.svg`).absolute().bottom(0).left(0).w(25).h(8).text_color(color));

    if (!beat) return clip;

    const period = beat + (h % 60);

    return clip.loop("top", { from: 10, to: 13, period, easing: "linear" }).loop("height", { from: 8, to: 5, period, easing: "linear" });
  }

  /** Notes agents that just went to rest; they're `landing` for LAND ms. */
  land(t: Theme, list: readonly AgentInfo[], cx: Context): void {
    const now = Date.now();

    for (const a of list) {
      const was = this.seen.get(a.address);

      if (was && was !== "idle" && a.status === "idle") {
        this.landing.set(a.address, { color: t[was], until: now + LAND });
        cx.timer.after(LAND + 50, (later) => later.notify());
      } else if (a.status !== "idle") this.landing.delete(a.address);

      this.seen.set(a.address, a.status);
    }

    for (const [k, v] of this.landing) if (v.until <= now) this.landing.delete(k);
  }

  firefly(t: Theme, a: AgentInfo, y: number, lane: number, w: number, reach: Reach = { up: 0, down: 0 }): Element {
    const h = hash(a.address);
    const on = this.nav(`fly:${a.address}`, "flies", this.flyActs(a));
    const x = 6; // the halo's edge lines up with the eyebrow; every mark in one column
    const color = a.status === "idle" ? t.muted : t[a.status];
    const glow = svg(`${ART}/glow.svg`).w(40).h(40).absolute().top(0).left(0).text_color(color);
    const landing = this.landing.get(a.address);
    const still = calm();
    // Landing: the last awake glow and mark fade out over the resting mark
    // (a loop's first half, removed once it's out).
    const fade = (el: Element) => el.loop("opacity", { from: 1, to: 0, period: LAND * 2, easing: "ease-out" });
    // Every firefly glows in its own rhythm (flight.ts): working ones flash,
    // blocked ones fast and bright, done ones breathe dimly, resting ones blink faintly.
    const halo = landing ? fade(glow.text_color(landing.color)) : flash(glow, a.status, h);
    const sweep = SWEEP.get(a.status);

    // The firefly's body is its agent's mark, on a dark plate so the halo's
    // dots don't run into it.
    const body0 = div().relative().size(40).flex_none()
      .child(halo).child(div().absolute().top(10).left(10).size(20).bg(t.background))
      .child(this.wings(a, h, color, landing))
      .child(div().absolute().top(12).left(12).size(16).overflow_hidden()
        .child(this.mark(a, color))
        .when(Boolean(landing), (el) => (landing ? el.child(fade(div().absolute().top(0).left(0).size(16).child(this.mark(a, landing.color)))) : el))
        // Alive: a band of night-colored dither sweeps across the mark. Over
        // the plate it vanishes, so only the mark's own pixels darken, like a
        // scanline over a sprite. Working sweeps slowly, blocked fast.
        .when(sweep != null && !still, (el) => el.child(div().absolute().top(0).h(16).w(6)
          .loop("left", { from: -6, to: 16, period: (sweep ?? 0) + (h % 400), easing: "linear" })
          .child(dither(t.background, 1)))))
      // Done says so by shape too, not only by its green: a check on the mark.
      .when(a.status === "done", (el) => el.child(this.doneBadge(t).absolute().top(22).left(22)));

    // Only the firefly flies (flight.ts), in its slot, leaving dust; its name stays put.
    // The focused one's square wears the corner ticks: the glow's dotted
    // square (art/glow.svg, 8..34 of its 40 px) where its slot holds still as it flies.
    const fly = div().relative().size(40).flex_none()
      .children(dust(a.status, h, () => div().child(dither(color, 1))))
      .when(a.focused, (el) => el.child(div().absolute().left(GLOW_SQUARE.at).top(GLOW_SQUARE.at).size(GLOW_SQUARE.size)
        .children(cornerTicks(t, TICK_OUT))))
      .child(flyPath(body0, a.status, h, this.naming === a.address || Boolean(landing)));

    // The pane's name leads (the agent's own when nobody named it). Only
    // what the halo doesn't already say follows: its space when that isn't
    // the shown one; awake ones add their status on a second line, resting
    // ones keep to one. The focused one stands in a moonlit path: a dithered band
    // behind its name that thins out in three steps, and only its name is bright;
    // its firefly's square wears the corner ticks, as its cell does on the rail.
    const title = givenName(a.address) ?? (a.program.agent ? a.program.name : a.title || a.program.name || a.address);
    const naming = this.naming === a.address;
    const resting = a.status === "idle" || lane < 32;
    const elsewhere = a.space_name && a.space !== this.shownSpace ? a.space_name : null;
    const whereColor = a.focused || on ? t.foreground : a.status === "blocked" ? t.blocked : t.muted;
    const sub = [elsewhere, a.status === "idle" ? null : WORD[a.status]].flatMap((x) => (x ? [x] : [])).join(" · ");

    // A press, a right-click or a double-click (naming) anywhere on the lane:
    // its full width and half the gap to each neighbour (`reach`), not only
    // the firefly and its name. While naming, the name's field keeps them.
    const press = (el: Element) => el
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();

        if (e.click_count === 2) this.startNaming(a, cx);
      })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.flyMenu(a);
      })
      .on_click((e) => {
        if (e.click_count < 2) run("agent.focus", { terminal: a.address });
      });

    const hit = div().id(`hit-${a.address}`).absolute().left(0).w(w).top(-reach.up).h(lane + reach.up + reach.down).map(press);
    const input = this.nameInput;

    const body = h_flex().id(`fly-${a.address}`).absolute().top(0).left(x).h(lane).items_center()
      .when(naming, press)
      .child(fly)
      .child(naming && input
        ? h_flex().ml(-2).w(w - x - 50).gap(4).items_center()
          .child(field(t, `name-${a.address}`, input, (cx) => {
            this.naming = null;
            cx.notify();
          }))
        : v_flex().ml(-2).max_w(w - x - 44).min_w(0).relative().pl(6).pr(4).py(1).gap(1)
          .child(resting
            ? h_flex().min_w(0).gap(6).items_baseline()
              .child(div().flex_none().max_w(w - x - 54).truncate().text_size(11).text_color(whereColor).child(title))
              .when(Boolean(elsewhere), (el) => el.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(elsewhere ?? "")))
            : div().truncate().text_size(11).text_color(whereColor).child(title))
          .when(!resting && Boolean(sub), (el) => el.child(a.status === "done"
            // Done reads at a glance: a check and the word, bright, not dim.
            ? h_flex().min_w(0).gap(4).items_center()
              .child(svg(CHECK).size(10).flex_none().text_color(t.done))
              .child(div().truncate().text_size(11).text_color(t.foreground).child(sub))
            : div().truncate().text_size(11).text_color(t.dim).child(sub))));

    const step = (o: number) => div().flex_1().h_full().relative().opacity(o).child(dither(t.ansi0, 1));

    const path = h_flex().absolute().top(4).bottom(4).left(x + 36).right(0).gap(2)
      .child(step(1).flex_grow(3)).child(step(0.6)).child(step(0.3));

    // The lane holds still (only the firefly in it flies), so it can move to
    // a new spot (to rest, say) on its own transition.
    const inner = div().absolute().top(0).left(0).w(w).h(lane).when(!naming, (el) => el.child(hit)).child(body);

    return div().id(`lane-${a.address}`).absolute().left(0).w(w).h(lane).top(y)
      .transition("top", { duration: LAND, easing: "ease-in-out" })
      .when(a.focused || on, (el) => el.child(path))
      .when(on, (el) => el.child(div().absolute().left(0).top(4).bottom(4).w(2).bg(t.accent)))
      .child(inner);
  }

  /**
   * The folded rail's jar, filling its (relative) parent: a lid, a neck, 2 px
   * dithered walls and a faint moonlit fill, square like everything here.
   * When a pinned firefly needs you the glass breathes in its color, slower
   * than the firefly's own blink; just after one flies in, it glints.
   */
  railGlass(t: Theme, jarred: readonly AgentInfo[], n = RAIL_NECK): Element {
    const needs = jarred.some((a) => a.status === "blocked");
    const tone = needs ? t.blocked : t.ansi8;
    const strip = (el: Element) => el.absolute().child(dither(tone, 1));
    // A mason jar, symmetric around its middle, square pixels only: a screw
    // band lid wider than the neck, the neck, shoulders stepping out in two
    // stairs, then the body's walls and base. `n`: the neck's inset.
    const half = Math.round(n / 2);
    // The same piece on the left and, mirrored, on the right (`side(el, x)` places it x in).
    const pair = (mk: (side: (el: Element, x: number) => Element) => Element) => [mk((el, x) => el.left(x)), mk((el, x) => el.right(x))];

    const frame = div().absolute().top(0).left(0).size_full()
      .child(div().absolute().top(0).left(n - 4).right(n - 4).h(4).bg(tone)) // the lid
      .child(strip(div().top(4).left(n - 4).right(n - 4).h(2)).opacity(0.6)) // its band
      .children(pair((side) => strip(side(div().top(6).w(2).h(6), n)))) // the neck
      .children(pair((side) => strip(side(div().top(12).w(n - half + 2).h(2), half)))) // upper shoulders
      .children(pair((side) => strip(side(div().top(14).w(half + 2).h(2), 0)))) // lower shoulders
      .children(pair((side) => strip(side(div().top(BODY).bottom(0).w(2), 0)))) // the walls
      .child(strip(div().bottom(0).left(0).right(0).h(2))); // the base

    const glinting = this.glintUntil > Date.now();

    // The glass: the body and the neck, faintly moonlit (or red while one needs you).
    const fill = (c: Color, o: number) => [
      div().absolute().top(BODY).left(2).right(2).bottom(2).opacity(o).child(dither(c, 1)),
      div().absolute().top(6).left(n + 2).right(n + 2).h(6).opacity(o).child(dither(c, 1)),
      div().absolute().top(12).left(half + 2).right(half + 2).h(4).opacity(o).child(dither(c, 1)),
    ];

    return div().absolute().top(0).left(0).size_full()
      .children(fill(needs ? t.blocked : t.ansi4, needs ? 0.16 : 0.1))
      .when(glinting, (el) => el.child(div().absolute().top(0).left(0).size_full()
        .loop("opacity", { from: 0.35, to: 0, period: GLINT * 2, easing: "ease-out" }).children(fill(t.foreground, 1))))
      .child(needs ? frame.loop("opacity", { from: 0.5, to: 1, period: 2400 }) : frame.opacity(0.85));
  }

  /**
   * The jar in the open sky, filling its (relative) parent: a mason jar,
   * square pixels only. A lid with a rim and a screw thread, a clear neck,
   * shoulders in a quarter round, walls drawn crisp outside and dithered
   * inside (the glass's thickness), round foot corners and a thick base, a
   * sheen down the left of the glass and a faint moonlit fill. When a pinned
   * firefly needs you the glass breathes in its color; just after one flies
   * in, it glints.
   */
  glass(t: Theme, jarred: readonly AgentInfo[], n = NECK): Element {
    const needs = jarred.some((a) => a.status === "blocked");
    const tone = needs ? t.blocked : t.ansi8;
    const strip = (el: Element, c: Color = tone) => el.absolute().child(dither(c, 1));
    const solid = (el: Element, c: Color = tone) => el.absolute().bg(c);
    const pair = (mk: (side: (el: Element, x: number) => Element) => Element) => [mk((el, x) => el.left(x)), mk((el, x) => el.right(x))];
    // The shoulders: a quarter round from the neck (n in) down to the walls,
    // in 2 px rows, square pixels: each row's edge, x in from the side.
    const SH = JAR_BODY - LID - 4;
    const rows = SH / 2;
    const edge = (k: number) => Math.round(n * (1 - Math.sin((Math.PI / 2) * (k + 1) / rows)));
    const shoulders: Element[] = [];

    for (let k = 0; k < rows; k++) {
      const x = edge(k);
      const prev = k ? edge(k - 1) : n;

      shoulders.push(...pair((side) => solid(side(div().top(LID + 4 + 2 * k).w(Math.max(1, prev - x + 1)).h(k === rows - 1 ? 2 : 1), x))));
      shoulders.push(...pair((side) => solid(side(div().top(LID + 4 + 2 * k).w(1).h(2), x))));
    }

    // J1, a mason jar: a lid with a rim and a screw thread, a clear neck,
    // round shoulders, walls drawn crisp outside and dithered inside (the
    // glass's thickness), round foot corners, a sheen down the left.
    const frame = div().absolute().top(0).left(0).size_full()
      .child(solid(div().top(0).left(n - 6).right(n - 6).h(2))) // the lid's rim
      .children([3, 5, 7].map((y) => solid(div().top(y).left(n - 5).right(n - 5).h(1)).opacity(0.65))) // its thread
      .children(pair((side) => solid(side(div().top(0).w(1).h(LID), n - 6)))) // the lid's sides
      .child(solid(div().top(LID - 1).left(n - 6).right(n - 6).h(1)))
      .children(pair((side) => solid(side(div().top(LID).w(1).h(4), n)))) // the neck
      .children(shoulders)
      .children(pair((side) => solid(side(div().top(JAR_BODY).bottom(4).w(1), 0)))) // the walls
      .children(pair((side) => strip(side(div().top(JAR_BODY).bottom(5).w(2), 1)).opacity(0.5))) // their thickness
      .children(pair((side) => solid(side(div().bottom(2).w(2).h(2), 1)))) // the foot's corners
      .child(solid(div().bottom(0).left(3).right(3).h(2))) // the base
      .child(strip(div().bottom(2).left(3).right(3).h(3)).opacity(0.5));

    const sheen = div().absolute().top(0).left(0).size_full()
      .child(strip(div().top(JAR_BODY + 4).left(4).w(2).bottom(20), t.foreground).opacity(0.5))
      .child(strip(div().bottom(10).left(4).w(2).h(4), t.foreground).opacity(0.35))
      .child(strip(div().top(LID + 6).left(Math.round(n / 3) + 2).w(4).h(2), t.foreground).opacity(0.45));

    const inner = div();
    const glinting = this.glintUntil > Date.now();

    const fill = (c: Color, o: number) => [
      div().absolute().top(JAR_BODY).left(2).right(2).bottom(3).opacity(o).child(dither(c, 1)),
      div().absolute().top(LID).left(n + 1).right(n + 1).h(SH + 4).opacity(o).child(dither(c, 1)),
      div().absolute().top(LID + 4 + SH / 2).left(Math.round(n / 3)).right(Math.round(n / 3)).h(SH / 2).opacity(o).child(dither(c, 1)),
    ];

    return div().absolute().top(0).left(0).size_full()
      .child(inner)
      .children(fill(needs ? t.blocked : t.ansi4, needs ? 0.16 : 0.12))
      .when(glinting, (el) => el.child(div().absolute().top(0).left(0).size_full()
        .loop("opacity", { from: 0.35, to: 0, period: GLINT * 2, easing: "ease-out" }).children(fill(t.foreground, 1))))
      .child(sheen)
      .child(needs ? frame.loop("opacity", { from: 0.55, to: 1, period: 2400 }) : frame.opacity(0.95));
  }

  /** The jar in the open sky, behind its fireflies' lanes. */
  jar(t: Theme, jarred: readonly AgentInfo[], h: number, w: number): Element {
    return div().id("jar").absolute().top(JAR.at).left(JAR_SIDE).w(w - 2 * JAR_SIDE).h(h - JAR.at).child(this.glass(t, jarred));
  }

  /** Inside the jar even a resting firefly glows a little: a soft halo
   *  behind its lane (awake ones have their own), on the dark plate. */
  jarGlow(t: Theme, a: AgentInfo, y: number, lane: number): Element {
    // Not while it flies in (its plate would wait there before it), nor while landing.
    if (a.status !== "idle" || this.landing.has(a.address) || this.arriving?.has(a.address)) return div();

    const top = y + Math.round((lane - 40) / 2);

    return div().id(`jar-glow-${a.address}`).absolute().left(JAR_INSET + 6).top(top).size(40)
      .transition("top", { duration: LAND, easing: "ease-in-out" })
      .child(svg(`${ART}/glow.svg`).absolute().top(0).left(0).size(40).text_color(t.muted).opacity(0.45))
      .child(div().absolute().top(10).left(10).size(20).bg(t.background));
  }

  /** Notes fireflies that just flew into the jar: its glass glints for GLINT ms. */
  glint(jarred: readonly (AgentInfo | JarItem)[], cx: Context): void {
    const now = new Set(jarred.map((a) => heldKey(a)));
    const seen = this.jarSeen;
    const fresh = seen ? jarred.filter((a) => !seen.has(heldKey(a))) : [];

    if (Date.now() >= this.glintUntil) this.arriving = null;

    if (fresh.length) {
      this.glintUntil = Date.now() + GLINT;
      this.arriving = new Set([...(this.arriving ?? []), ...fresh.map((a) => heldKey(a))]);
      cx.timer.after(GLINT + 50, (later) => later.notify());
    }

    this.jarSeen = now;
  }

  /** Pins made elsewhere get their place in the jar; an unpin's leftover time goes (pins.ts stamps). Once per value. */
  stamp(): void {
    const now = Date.now();

    for (const [k, v] of this.stamped) if (now - v > 5000) this.stamped.delete(k);

    for (const [terminal, kv] of stamps(terminals().filter((x) => isTerminal(x)), now)) {
      const key = `${terminal} ${kv.replace(/=.*/, "")}`;

      if (this.stamped.has(key)) continue;

      this.stamped.set(key, now);
      hc(["label", terminal, kv]).catch(() => {});
    }
  }

  // Awake fireflies (blocked, working, running a command) spread through the
  // sky above the grass; those at rest (done, then resting: kit.ts atRest)
  // sit in a stack on the near ridge, as on the rail.
  // Pinned ones (pins.ts) live in a glass jar at the top, in the order
  // pinned; the rest keep this order below it. Lanes are placed in one space,
  // so a firefly being pinned flies up into the jar (and back out). Pinned
  // panes that aren't agents (`kept`) sit on the shelf at the jar's foot.
  meadow(t: Theme, list: readonly AgentInfo[], jarred: readonly AgentInfo[] = [], kept: readonly JarItem[] = []): Element {
    // Measured sizes come back as drawn (zoomed); lengths here are layout px.
    const zoom = settings().zoom || 1;
    const w = this.field.width / zoom;
    const hgt = this.field.height / zoom;
    const inJar = new Set(jarred.map((a) => a.address));
    const free = list.filter((a) => !inJar.has(a.address));
    const awake = free.filter((a) => !atRest(a));
    const resting = free.filter(atRest);
    const ground = hgt - 96; // above the far ridge (hills-rim), so labels stay on clear sky
    const jarOn = jarred.length > 0 || kept.length > 0;
    const shelfW = w - 2 * JAR_INSET;
    const shelfH = kept.length ? shelfHeight(kept.length + 1, shelfW) : 0; // + the "+" tile
    let lane = 40;
    const restLane = 28;
    const laneOf = (a: AgentInfo) => (a.status === "idle" ? restLane : lane);
    const jarNeed = jarOn ? jarPlan(jarred.map(laneOf), shelfH).jarH : 0;
    const need = jarNeed + awake.length * lane + resting.length * restLane + 16;
    const placed: Placed[] = [];
    let more = 0;
    let jarH = 0;
    let shelfY = 0;

    if (need <= ground) {
      // Room to spare: the jar on top (the shelf at its foot), awake ones
      // spread out under it, the rest settle on the ground.
      if (jarOn) {
        const plan = jarPlan(jarred.map(laneOf), shelfH);

        jarred.forEach((a, i) => placed.push([a, plan.ys[i] ?? 0, laneOf(a)]));
        shelfY = plan.shelfY;
        jarH = plan.jarH;
      }

      const top = jarH ? jarH + JAR.gap : 8;
      const restTop = ground - resting.length * restLane;
      const step = awake.length ? Math.min(46, (restTop - top) / awake.length) : 0;

      awake.forEach((a, i) => placed.push([a, Math.round(top + i * step), lane]));
      resting.forEach((a, i) => placed.push([a, restTop + i * restLane, restLane]));
    } else {
      // Crowded: one tight list (the jar's first, its shelf whole), then a count.
      lane = 24;

      const fit = Math.max(1, Math.floor((ground - 8 - (jarOn ? JAR.top + JAR.bottom + JAR.gap - 8 + shelfH : 0)) / lane) - 1);
      const shown = [...jarred, ...free].slice(0, fit);
      let y = jarOn ? JAR.top : 8;

      const closeJar = () => {
        if (kept.length) {
          shelfY = jarred.length ? y + SHELF_ABOVE : y;
          y = shelfY + shelfH;
        }

        jarH = y + JAR.bottom;
        y = jarH + JAR.gap;
      };

      shown.forEach((a, i) => {
        if (i === jarred.length && jarOn) closeJar();

        placed.push([a, y, lane]);
        y += lane;
      });

      if (jarOn && !jarH) closeJar();

      more = list.length - shown.length;
    }

    const jarLanes = placed.filter(([a]) => inJar.has(a.address));
    const reaches = laneReach(placed.map(([a, y, l]) => ({ y, h: l, jar: inJar.has(a.address) })));
    const last = placed.at(-1);

    return div().id("meadow").relative().flex_1().min_h(0).w_full()
      .on_size_change((size, cx) => {
        this.field = size;
        cx.notify();
      })
      .when(jarH > 0, (el) => el.child(this.jar(t, jarred, jarH, w)).children(jarLanes.map(([a, y, l]) => this.jarGlow(t, a, y, l))))
      // The jar's lanes sit inside its walls, the same margin on both sides.
      .children(placed.map(([a, y, l], i) => (inJar.has(a.address)
        ? this.firefly(t, a, y, l, w - 2 * JAR_INSET, reaches[i]).left(JAR_INSET)
        : this.firefly(t, a, y, l, w, reaches[i]))))
      .when(kept.length > 0, (el) => el.child(div().absolute().left(JAR_INSET).top(shelfY).w(shelfW).child(this.shelf(t, kept, shelfW))))
      .when(more > 0, (el) => el.child(div().id("more").absolute().left(50).top(last ? last[1] + last[2] : 8)
        .map((m) => navRing(t, m, this.nav("more", "flies", { go: () => run("agent.next") })))
        .text_size(11).text_color(t.ansi8).hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stop).on_click(() => run("agent.next"))
        .child(`+${more} more in the grass`)));
  }

  // ---- the shelf: pinned panes that aren't agents (pins.ts onShelf)

  /** On screen now: its tab is the shown one of the shown space, not parked. */
  pinLit(it: JarItem): boolean {
    const p = paneOf(it);

    return Boolean(p) && !p?.parked && this.shownTabs.has(p?.tab ?? "");
  }

  /** It holds the focus: the focused pane, or the focused terminal. */
  pinFocus(it: JarItem): boolean {
    const f = focused();

    return it.kind === "pane" ? Boolean(f?.pane) && f?.pane === it.pane.pane : Boolean(f?.terminal) && f?.terminal === it.key;
  }

  /** What a tile is called: the pane's name (header.ts paneName), a terminal's given name. */
  pinName(it: JarItem): string {
    const p = paneOf(it);

    if (p?.mod === "browser") return webName(p, it.kind === "pane" ? (it.tab ?? null) : null);

    if (p) return paneName(p);

    return givenName(it.key) ?? (it.kind === "terminal" ? it.terminal.name : null) ?? "shell";
  }

  /** Where and what a tile is: its kind ("web", "editor", "shell"), its space when
   *  that's not the shown one, "parked". The kind goes when the name says it already. */
  pinWhere(it: JarItem): string {
    const p = paneOf(it);
    const program = p?.program;
    const kind = it.kind === "pane" ? modKind(p) : (program?.name && !program.shell ? program.name : "shell");
    const space = p ? this.tabSpace.get(p.tab) : null;

    return [kind && kind.toLowerCase() !== this.pinName(it).toLowerCase() ? kind : null,
      space && space.id !== this.shownSpace ? space.name : null, p?.parked ? "parked" : null].flatMap((x) => (x ? [x] : [])).join(" · ");
  }

  /**
   * A pinned pane's tile, `size` px: its mark (header.ts markPath) on the dark
   * plate in a square frame. Lit (on screen now) the frame brightens and the
   * tile is moonlit; under the pointer a grey plate; the focused one wears the
   * corner ticks, the keyboard's cursor a blue ring. A click goes to it, a
   * right-click opens its pane's menu.
   */
  pinTile(t: Theme, it: JarItem, size = TILE): Element {
    const on = this.nav(`pin:${it.key}`, "flies", this.pinActs(it));

    if (on) this.tileOn = it.key;

    const lit = this.pinLit(it);
    const focus = this.pinFocus(it);
    const hot = this.tileHover === it.key;
    const small = size < TILE;
    const glyph = small ? 12 : 14;
    const plate = glyph + 2;
    const at = (size - plate) / 2;
    const where = this.pinWhere(it);
    const p = paneOf(it);

    return div().id(`pin-${it.key}`).relative().size(size).flex_none().flex().items_center().justify_center()
      .tooltip(`${this.pinName(it)}${where ? ` · ${where}` : ""}`)
      .on_hover((h, cx) => {
        if (h ? this.tileHover !== it.key : this.tileHover === it.key) {
          this.tileHover = h ? it.key : null;
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
      .child(svg(markPath(p)).size(glyph).flex_none().text_color(lit || on || focus || hot ? t.foreground : t.muted))
      .when(focus, (el) => el.children(cornerTicks(t, small ? 2 : 3)))
      .when(on, (el) => el.child(div().absolute().top(-2).left(-2).size(size + 4).border(1).border_color(t.accent)));
  }

  /** The shelf's last tile, "+": a new web pane in the dock (dock.ts), pinned
   *  here. Dimmer than the tiles, a dotted frame: a place, not a pane. */
  newTile(t: Theme, size = TILE): Element {
    const on = this.nav("shelf-new", "flies", { go: () => dockWeb() });

    if (on) this.tileOn = "shelf-new";

    const hot = this.tileHover === "shelf-new";

    return div().id("shelf-new").relative().size(size).flex_none().flex().items_center().justify_center()
      .tooltip("New web pane in the dock")
      .on_hover((h, cx) => {
        if (h ? this.tileHover !== "shelf-new" : this.tileHover === "shelf-new") {
          this.tileHover = h ? "shelf-new" : null;
          cx.notify();
        }
      })
      .on_mouse_down("left", stop)
      .on_click(() => dockWeb())
      .when(hot, (el) => el.child(div().absolute().top(0).left(0).size_full().bg(`${t.ansi0}88`)))
      .child(div().absolute().top(0).left(0).size_full().opacity(0.5).child(dither(t.ansi0, 1)))
      .child(div().absolute().top(1).left(1).size(size - 2).bg(t.background))
      .child(svg("mods/workspace-chrome/plus.svg").size(12).flex_none().text_color(hot || on ? t.foreground : t.dim))
      .when(on, (el) => el.child(div().absolute().top(-2).left(-2).size(size + 4).border(1).border_color(t.accent)));
  }

  /** The shelf at the jar's foot, `w` wide: a dithered board, the tiles in
   *  rows in the order pinned, and a caption naming the tile under the pointer
   *  or the keyboard's cursor, else the focused one, else how many it keeps. */
  shelf(t: Theme, kept: readonly JarItem[], w: number): Element {
    this.tileOn = null;

    const tiles = [...kept.map((it) => this.pinTile(t, it)), this.newTile(t)];
    const adding = this.tileHover === "shelf-new" || this.tileOn === "shelf-new";
    const named = adding ? undefined : kept.find((it) => it.key === this.tileHover) ?? kept.find((it) => it.key === this.tileOn) ?? kept.find((it) => this.pinFocus(it));
    const where = named ? this.pinWhere(named) : "";

    return v_flex().id("shelf").w(w)
      .child(div().relative().h(BOARD).mx(4).mb(BOARD_GAP).opacity(0.7).child(dither(t.ansi8, 1)))
      .child(h_flex().flex_wrap().px(SHELF_PAD).gap(TILE_GAP).children(tiles))
      .child(h_flex().h(CAPTION.h).mt(CAPTION.gap).px(SHELF_PAD).gap(6).items_center().min_w(0).text_size(11)
        .when(Boolean(named), (el) => (named ? el
          .child(div().flex_none().max_w(w - 2 * SHELF_PAD - 40).truncate().text_color(t.foreground).child(this.pinName(named)))
          .when(Boolean(where), (e2) => e2.child(div().min_w(0).truncate().text_color(t.dim).child(where))) : el))
        .when(!named, (el) => el.child(div().text_color(t.dim)
          .child(adding ? "new web pane in the dock" : `${kept.length} ${kept.length === 1 ? "pane" : "panes"} kept`))));
  }

  /** Keeps the mod panes' pins true to panes() (pins.ts tidy): a pane that came
   *  back under a new id keeps its pin, a closed one's goes. Writes from a task. */
  tidyPins(cx: Context): void {
    const recs = paneRecordsNow();

    if (!recs.length) return;

    const out = tidy(recs, panes(), this.missing, Date.now());

    if (out) cx.timer.after(0, () => setShared(PANES_KEY, storedRecords(out)));

    if (this.missing.size && !this.tidyLater) {
      this.tidyLater = true;
      cx.timer.after(PIN_GONE + 200, (later) => {
        this.tidyLater = false;
        later.notify();
      });
    }
  }

  redraw(cx: Context, sp: readonly SpaceInfo[]): void {
    const tab = sp.find((s) => s.active)?.tabs.find((c) => c.active)?.id;

    if (!REDRAW_ON_SHOW || !tab || tab === this.shownTab) return;

    const first = this.shownTab === undefined;

    this.shownTab = tab;

    if (first) return; // the app just started: nothing was resized under it

    // Also redraw the window itself once things settle.
    cx.timer.after(REDRAW_DELAY, (later) => later.notify());
    cx.timer.after(REDRAW_DELAY, () => {
      if (this.shownTab !== tab) return; // switched on again meanwhile

      for (const p of panes()) {
        if (p.tab === tab && p.terminal && p.app === "claude-code" && p.status !== "blocked") {
          hc(["keys", p.terminal, "x", "backspace"]).catch(() => {});
        }
      }
    });
  }

  /** The rail's name for a space: its first letter, and the next one small ("Mo"). */
  initials(name: string): string {
    const chars = name.match(/[\p{L}\p{N}]/gu) ?? [];
    const first = chars[0];

    return first ? first.toUpperCase() + (chars[1] ?? "").toLowerCase() : "·";
  }

  /** The rail's » : a bordered key, filled and bright under the pointer. */
  openKey(t: Theme): Element {
    const on = this.nav("fold", "top", { go: (cx) => this.fold(cx) });

    return div().id("fold").relative().flex_none().w(28).h(20).flex().items_center().justify_center()
      .map((el) => navRing(t, el, on))
      .border(1).border_color(t.ansi0).text_size(11).text_color(t.muted)
      .hover((s) => s.text_color(t.foreground).bg(t.ansi0).border_color(t.ansi8))
      .tooltip("Open the sidebar (⌘B)")
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.fold(cx);
      })
      .child("»");
  }

  /** A space's rail row: its initials on a dotted thread down the rail's
   *  middle that runs only between spaces (`at`: its place, of `count`). The
   *  shown one has blue corner ticks; the one under the pointer a grey plate;
   *  one that wants attention its status pip beside the initials. */
  railSpace(t: Theme, s: SpaceInfo, at: number, count: number): Element {
    const hot = this.railHover === s.id || this.nav(`space:${s.id}`, "spaces", this.railActs(s));

    const thread = count > 1 ? div().absolute().left(0).right(0).top(at === 0 ? 13 : 0).bottom(at === count - 1 ? 13 : 0).flex().justify_center()
      .child(div().relative().w(1).h_full().child(dither(`${t.ansi8}99`, 1))) : null;

    return div().id(`rail-space-${s.id}`).relative().w_full().h(26).flex_none().flex().items_center().justify_center().text_size(11)
      .tooltip(s.name)
      .on_hover((h, cx) => {
        if (h ? this.railHover !== s.id : this.railHover === s.id) {
          this.railHover = h ? s.id : null;
          cx.notify();
        }
      })
      .on_mouse_down("left", stop)
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.spaces.menu(s);
      })
      .on_click(() => run("space.select", { id: s.id }))
      .when(Boolean(thread), (el) => (thread ? el.child(thread) : el))
      // On a plate of the night's ground (the list is on it too, so no star
      // lands beside a letter like a stray mark), so the thread stops at the letters.
      .child(div().relative().px(3).py(1).bg(hot ? t.ansi0 : t.background).text_color(s.active || hot ? t.foreground : t.muted)
        .child(this.initials(s.name))
        .when(s.active, (el) => el.children(cornerTicks(t)))
        .when(Boolean(s.status) && s.status !== "idle", (el) => el.child(div().absolute().right(-13).top(5).child(pip(t, s.status)))));
  }

  /** A firefly on the rail: its mark in a 32 px cell, glowing in its rhythm
   *  (flight.ts); a working one rises and falls a pixel or two. */
  railFly(t: Theme, a: AgentInfo, size = 32, reach: RailReach = RAIL_REACH): Element {
    const h = hash(a.address);
    const on = this.nav(`fly:${a.address}`, "flies", this.flyActs(a));
    const color = a.status === "idle" ? t.muted : t[a.status];
    const awake = a.status !== "idle";
    const mark = div().relative().child(this.mark(a, color));
    const plate = (size - 16) / 2;

    return div().id(`rail-fly-${a.address}`).relative().size(size).flex_none().flex().items_center().justify_center()
      .hover((s) => s.bg(`${t.ansi0}55`))
      .tooltip(`${givenName(a.address) ?? a.program.name ?? a.title ?? a.address}${a.space_name ? ` · ${a.space_name}` : ""} · ${WORD[a.status]}`)
      // Pressed anywhere on the cell and the padding around it (`reach`), not only the mark.
      .child(div().id(`rail-hit-${a.address}`).absolute().left(-reach.x).top(-reach.y).w(size + 2 * reach.x).h(size + 2 * reach.y)
        .on_mouse_down("left", stop)
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          this.flyMenu(a);
        })
        .on_click(() => run("agent.focus", { terminal: a.address })))
      // Focused: a plate of the ground, the corner ticks on its corners.
      .when(a.focused, (el) => el.child(dither(t.ansi0, 1)).children(cornerTicks(t, 0)))
      .when(awake, (el) => el
        .child(flash(svg(`${ART}/glow.svg`).size(size).absolute().top(0).left(0).text_color(color), a.status, h))
        .child(div().absolute().top(plate).left(plate).size(16).bg(t.background)))
      .child(a.status === "working" && !calm() ? mark.loop("top", { from: -1, to: 1, period: 1900 + (h % 700) }) : mark)
      .when(a.status === "done", (el) => el.child(this.doneBadge(t).absolute().bottom(size > 28 ? 2 : 0).right(size > 28 ? 2 : 0)))
      .map((el) => navRing(t, el, on));
  }

  /** The rail's ground: fireflies at rest (done, then resting) stacked at its
   *  foot on the hills, as the open sky's are. Crowded: smaller cells, two
   *  abreast, then a count. Always above the usage, never behind it. */
  railGround(t: Theme, resting: readonly AgentInfo[]): Element | null {
    if (!resting.length) return null;

    const pairs = resting.length > RAIL_GROUND_ONE;
    const cell = pairs ? 28 : 30;
    const room = pairs ? RAIL_GROUND_MAX : resting.length;
    const shown = resting.length > room ? resting.slice(0, room - 1) : resting;
    const more = resting.length - shown.length;

    // The count takes the last cell, so the stack keeps its shape above the hills.
    const marks = [...shown.map((a) => this.railFly(t, a, cell, pairs ? PAIR_REACH : RAIL_REACH)),
      ...(more > 0 ? [div().id("rail-ground-more").relative().size(cell).flex_none().flex().items_center().justify_center()
        .map((el) => navRing(t, el, this.nav("more", "flies", { go: () => run("agent.next") })))
        .text_size(10).text_color(t.ansi8).hover((s) => s.text_color(t.foreground).bg(`${t.ansi0}55`))
        .tooltip(`${more} more at rest`)
        .on_mouse_down("left", stop).on_click(() => run("agent.next"))
        .child(`+${more}`)] : [])];

    const body = pairs
      ? v_flex().gap(2).items_center().children(Array.from({ length: Math.ceil(marks.length / 2) }, (_, i) =>
        h_flex().gap(2).children(marks.slice(i * 2, i * 2 + 2))))
      : v_flex().gap(1).items_center().children(marks);

    return v_flex().id("rail-ground").w_full().flex_none().items_center().pt(6).pb(RAIL_RIDGE).child(body);
  }

  /** Folded: the moon and the hour, », a row per space (sidebar order), every firefly's mark, the usage. */
  rail(t: Theme, list: readonly AgentInfo[], jarred: readonly AgentInfo[] = [], kept: readonly JarItem[] = []): Element {
    const rows = this.spaces.rows().flatMap((r) => ("s" in r ? [r] : []));
    const inJar = new Set(jarred.map((a) => a.address));
    const free = list.filter((a) => !inJar.has(a.address));

    // The pinned panes that aren't agents: smaller tiles two abreast on a board under them.
    this.tileOn = null;

    const tiles = kept.map((it) => this.pinTile(t, it, RAIL_TILE));

    const shelf = kept.length ? v_flex().id("rail-shelf").flex_none().items_center().gap(RAIL_TILE_GAP).pt(jarred.length ? 2 : 0)
      .when(jarred.length > 0, (el) => el.child(div().relative().w(40).h(BOARD).opacity(0.7).child(dither(t.ansi8, 1))))
      .children(Array.from({ length: Math.ceil(tiles.length / 2) }, (_, i) => h_flex().gap(RAIL_TILE_GAP).children(tiles.slice(i * 2, i * 2 + 2)))) : null;

    // The pinned ones' marks in a small jar of their own, resting ones lit a little.
    const jar = jarred.length || kept.length ? v_flex().id("rail-jar").relative().w(48).flex_none().items_center().pt(BODY + 2).pb(4).gap(2).mb(6)
      .child(this.railGlass(t, jarred, RAIL_NECK))
      .children(jarred.map((a) => div().relative().size(32).flex_none()
        .when(a.status === "idle", (el) => el.child(svg(`${ART}/glow.svg`).absolute().top(0).left(0).size(32).text_color(t.muted).opacity(0.45))
          .child(div().absolute().top(8).left(8).size(16).bg(t.background)))
        .child(div().absolute().top(0).left(0).child(this.railFly(t, a)))))
      .when(Boolean(shelf), (el) => (shelf ? el.child(shelf) : el)) : null;

    // Awake ones under the jar at the top; those at rest on the ground at the foot (railGround).
    const flies = free.flatMap((a) => (atRest(a) ? [] : [this.railFly(t, a)]));
    const ground = this.railGround(t, free.filter(atRest));
    const rule = () => div().w(28).h(2).flex_none().relative().child(dither(t.ansi8, 1));
    const glowList = this.glowList;
    const spacesList = v_flex().id("rail-spaces").relative().overflow_hidden().w_full().flex_none().bg(t.background);

    return v_flex().w_full().flex_1().min_h(0).pt(48).items_center()
      .child(v_flex().id("rail-clock").flex_none().items_center().tooltip(this.clock.date).on_size_change(this.railMeasure("clock"))
        .child(svg(`${ART}/moon-${moonPhase(list)}.svg`).size(32).flex_none().text_color(t.ansi7))
        .child(div().pt(4).text_size(11).text_color(t.foreground).child(this.clock.time)))
      .child(div().id("rail-key").pt(10).pb(14).flex_none().on_size_change(this.railMeasure("key")).child(this.openKey(t)))
      .child((glowList ? spacesList.child(glowList) : spacesList).children(rows.map(({ s }, i) => this.railSpace(t, s, i, rows.length))))
      .child(div().py(12).flex_none().child(rule()))
      .child(v_flex().id("rail-flies").w_full().flex_1().min_h(0).gap(2).items_center().overflow_y_scroll().when(Boolean(jar), (el) => (jar ? el.child(jar) : el)).children(flies))
      .when(Boolean(ground), (el) => (ground ? el.child(ground) : el))
      .child(this.usage.rail(t, this.nav));
  }

  render(cx: Context): Element {
    const t = theme();

    // The controls are listed again as they're drawn (nav()).
    this.navList = [];

    const on = this.navOn;
    // Pinned agents first, in the order pinned (pins.ts), then by status (kit.ts agentRank).
    const { pinned: jarred, all: list } = sortedAgents();
    // Pinned panes that aren't agents, for the jar's shelf (pins.ts onShelf).
    const kept = jarNow().filter(onShelf);

    setAgentOrder(list.map((a) => a.address));
    this.stamp();
    this.tidyPins(cx);

    // A dock being made (dock.ts) that has appeared: its id, then what was asked of it.
    if (dockMaking()) cx.timer.after(0, () => adoptDock());

    this.glint([...jarred, ...kept], cx);

    const sp = spaces();

    this.shownSpace = sp.find((s) => s.active)?.id ?? null;
    this.shownTabs = new Set(sp.filter((s) => s.active).flatMap((s) => s.tabs.filter((c) => c.active).map((c) => c.id)));
    this.tabSpace = new Map(sp.flatMap((s) => s.tabs.map((c): readonly [string, SpaceInfo] => [c.id, s])));
    this.redraw(cx, sp);

    // A menu's ask (rename an agent, edit or delete a space) is answered just
    // after this render, from a task: answering starts a field, focuses it
    // and draws again (cx.notify), which a render can't do (GPUI refuses it,
    // and the sidebar showed "could not be re-rendered" for a frame).
    if (this.asked(readShared(shared, NAME_AGENT_KEY, null), this.nameAsked) || this.asked(readShared(shared, EDIT_SPACE_KEY, null), this.spaces.editAsked)) {
      cx.timer.after(0, (later) => {
        this.answerNaming(list, later);
        this.spaces.answer(this.folded, later);
      });
    }

    const sky = tracked(v_flex().id("sky").relative().size_full().overflow_hidden().bg(t.background), this.handle)
      .on_key_down((e, later) => this.key(e, later))
      .map((el) => tabActions(el, (e, later) => this.key(e, later)))
      .on_size_change((size, later) => {
        this.size = size;
        later.notify();
      })
      .on_mouse_move((e, later) => this.pointer(e.local_position, later))
      .on_hover((h, later) => {
        if (!h) this.pointer(null, later);
      });

    // What the glow needs of the sky to light its backdrop; a glow that's
    // up hears at once when the sky changes under it or calm() turns.
    const zoom = settings().zoom || 1;

    this.glowSky = { folded: this.folded, h: Math.round(this.size.height / zoom), lift: this.folded ? this.usage.railHeight : this.usage.height + (on ? 20 : 0) };

    const g = this.glowAt;
    const key = JSON.stringify([this.glowSky, this.railTop]);

    if (g?.on && (g.calm !== calm() || this.glowKey !== key)) {
      const next = { ...g, calm: calm() };

      this.glowAt = next;
      cx.timer.after(0, () => {
        if (this.glowAt === next) this.showGlow(next);
      });
    }

    this.glowKey = key;

    // After drawing: the controls top to bottom (the rail draws its fireflies
    // before its spaces), and a cursor on one that went moves to its neighbor.
    const placeCursor = (el: Element) => {
      const rank = (x: NavEntry) => SECTION_RANK.get(x.sec) ?? 0;

      this.navList = this.navList.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map(({ x }) => x);

      if (on && this.placeCursor()) cx.timer.after(0, (later) => later.notify());

      return el;
    };

    const glow = this.glow;
    const withGlow = (el: Element) => (glow ? el.child(glow) : el);

    if (this.folded) {
      return placeCursor(withGlow(sky
        // Fainter stars than open: here they'd sit between small controls.
        .child(svg(`${ART}/stars.svg`).w(480).h(900).absolute().top(0).left(0).text_color(t.ansi8).opacity(0.3))
        // The hills rest on the usage, as open, never behind its numbers.
        .child(svg(`${ART}/hills-fill.svg`).w(480).h(144).absolute().bottom(this.usage.railHeight).left(0).text_color(t.background))
        .child(svg(`${ART}/hills-rim.svg`).w(480).h(144).absolute().bottom(this.usage.railHeight).left(0).text_color(t.ansi8).opacity(0.5)))
        .child(this.rail(t, list, jarred, kept)));
    }

    // The usage section sits at the foot; the haze and hills rest on it.
    // While the sidebar has the keyboard, its hint line lies under the usage.
    const lift = this.usage.height + (on ? 20 : 0);

    this.land(t, list, cx);

    return placeCursor(withGlow(sky.when(on, (el) => el.pb(20))
      // Backdrop, back to front: stars, moonlight haze, ground, its lit rim.
      .child(svg(`${ART}/stars.svg`).w(480).h(900).absolute().top(0).left(0).text_color(t.ansi8).opacity(0.55))
      .child(svg(`${ART}/haze.svg`).w(480).h(1400).absolute().bottom(lift).left(0).text_color(t.ansi4).opacity(0.2))
      .child(svg(`${ART}/hills-fill.svg`).w(480).h(144).absolute().bottom(lift).left(0).text_color(t.background))
      .child(svg(`${ART}/hills-rim.svg`).w(480).h(144).absolute().bottom(lift).left(0).text_color(t.ansi8).opacity(0.5)))
      .child(div().absolute().top(14).right(10).child(this.foldButton(t, "«")))
      .child(this.header(t, list))
      .child(this.spaces.render(t, this.nav))
      .child(div().px(16).pt(8).flex_none().child(eyebrow(t, "fireflies")))
      .child(this.meadow(t, list, jarred, kept))
      .child(this.usage.render(t, this.nav))
      .when(on, (el) => el.child(this.hints(t))));
  }
}
