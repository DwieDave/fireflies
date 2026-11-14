// The sidebar: a dithered night sky.
//   moon     its lit share is the share of agents at rest (idle or done);
//            new moon while everything works, full when the herd is quiet
//   spaces   one row each (spaces.ts), with inline create / rename / delete
//            spaces in a repo's worktrees sit indented under its main one
//   usage    Claude's or Codex's 5-hour and weekly limits (usage.ts), foldable,
//            at the foot; the hills rest on top of it
//   meadow   every agent is a firefly: blocked blinks red at the top,
//            working drifts amber, done glows green below them (kit.ts
//            agentRank), idle rests in the grass; how each flies and
//            glows is flight.ts;
//            pinned ones (pins.ts) sit above them all in a glass jar at
//            the top, in the order pinned, status and all; the glass
//            glints when one flies in and breathes red while one needs you;
//            other pinned panes (web, editor, files, a shell) sit as tiles
//            on a shelf at the jar's foot, each named in its tooltip
//            (shelf.ts);
//            nocturne.pin (cmd-alt-p) pins the focused pane, whatever it shows,
//            nocturne.pin-up / pin-down move it in the jar (on the shelf: left / right);
//            nocturne.pin-tab pins the shown tab whole (a tile with a tab's ear),
//            nocturne.tab-to-space moves it whole to another space (menu.ts);
//            nocturne.agent-next / agent-prev walk the jar's agents, its
//            shelf's tiles, then the other agents, as drawn, wrapping
//            (walk.ts; the layout's cmd-] / cmd-[);
//            its pane's name leads (kit.ts givenName, else the agent's own, "Claude Code";
//            its space only when it's another one, awake ones add their status;
//            resting ones keep to one line); double-click to rename it
//            (esc: keep, empty: the agent's name back);
//            right-click for a menu: focus, rename, delete its tab (menu.ts)
//   clock    the time and date beside the moon
//   fold    « at the top (or cmd-b / cmd-s) folds the sky into a rail: the
//            moon and the hour, a row per space (its first letters; the shown
//            one on the dithered band with a blue edge, the status pip at the
//            right edge), the fireflies' marks in the same order as open,
//            and a meter per usage window; the » key under the hour opens it
//            again. On macOS the rail is wide enough for the window buttons
//            at any zoom.
//   glow     the pointer carries a firefly's light over the sky and the rail
//            (glow.ts): a nested view, so following it never redraws the sky
//   keys     the sidebar takes the keyboard from pane.go (cmd-alt-left from
//            the leftmost pane) or nocturne.sidebar (layout.focus): a cursor
//            walks every control (nav.ts SIDEBAR_KEYS; ? lists them), the
//            hint line at its foot says the main ones; l / → goes back to
//            the panes, esc / q to the pane it came from.

import { div, svg } from "gpui-kit";
import type { Color, Context, Element, Entity, FocusHandle, KeyEvent, Point, Size } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex, InputState } from "gpui-base";
import { spaces, panes, run, hc, theme, setAgentOrder, nextCommand, shared, setShared, settings, layout, focused } from "herdr";
import type { AgentInfo, SpaceInfo, Status, Theme } from "herdr";
import { readShared, writeShared } from "./guard.ts";
import { ART, WORD, atRest, dither, eyebrow, givenName, nameTerminal, sortedAgents, goToPin, dockWeb, dockShell, dockFiles, pinDockShell, dockFocused, jar as jarNow, paneRecordsNow, tabRecordsNow, navRing, tracked, GLOW_SQUARE } from "./kit.ts";
import { tidy, tidyTabs, onShelf, storedRecords, PANES_KEY, TABS_KEY, GONE_AFTER as PIN_GONE } from "./pins.ts";
import type { JarItem } from "./pins.ts";
import { walkStops, walkAt, walkNext } from "./walk.ts";
import { adoptDock, dockMaking, shellWaiting } from "./dock.ts";
import Spaces from "./spaces.ts";
import { NAME_AGENT_KEY, EDIT_SPACE_KEY, openMenu, openKeys } from "./menu.ts";
import { keysHint } from "./keyhelp.ts";
import { SIDEBAR_HELP, blockOf, isLayoutNode } from "./nav.ts";
import type { NavActs } from "./nav.ts";
import { toggleGit, openWorktrees } from "./git.ts";
import { UsageSection } from "./usage.ts";
import { focusFiles } from "./files.ts";
import { togglePicker } from "./picker.ts";
import { openScratchpad } from "./scratchpad.ts";
import { toggleGithub, githubForm } from "./github.ts";
import { toggleDeck, lastFailed, grantAppManagement } from "./scripts.ts";
import { databasesCommand, openAsCommand } from "./inpane.ts";
import { toggleProcs } from "./procs.ts";
import { openNewMenu, OPEN as NEW_OPEN } from "./newmenu.ts";
import { openSpacePicker } from "./newspace.ts";
import { gridify } from "./gridify.ts";
import { toastKey } from "./toast.ts";
import { dismissUpdate } from "./screens.ts";
import { calm } from "./flight.ts";
import { Fireglow, nextGlow, GONE_AFTER } from "./glow.ts";
import type { GlowPlace, GlowProps } from "./glow.ts";
import { bindTab, tabActions } from "./form-keys.ts";

export { GLOW_SQUARE };

import { stop, clock, moonPhase, REDRAW_ON_SHOW, CHECK, REDRAW_DELAY, railWidth, RAIL_BELOW, OPEN_WIDTH, OPEN_DEFAULT, SETTLE, SECTION_RANK } from "./sky-plan.ts";
import type { Clock, NavEntry, Landing, GlowSky, RailTops } from "./sky-plan.ts";
import { placeCursor, toggleKeys, sidebarKey, railActs, jarCommand } from "./sky-keys.ts";
import { noteLandings, glint, stamp, meadowView } from "./meadow.ts";
import { pinLit, pinName, pinWhere } from "./shelf.ts";
import { railView } from "./rail.ts";

/** After a draw, the dock's (dock.ts) open asks: a dock being made that has
 *  appeared gets its id, then what was asked of it; a shell asked for there is
 *  pinned to the shelf once its terminal runs. Its pane shows first, and
 *  nothing draws again when the terminal starts, so the sky looks again
 *  shortly while one is awaited (dock.ts gives up after MAKING). */
function dockTasks(cx: Context): void {
  if (dockMaking()) cx.timer.after(0, () => adoptDock());

  if (!shellWaiting()) return;

  cx.timer.after(250, (later) => {
    pinDockShell();

    if (shellWaiting()) later.notify();
  });
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
  missingTabs = new Map<string, number>(); // whole tabs' pins, as `missing` (pins.ts tidyTabs)
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
    this.handle = cx.focus_handle();
    bindTab(cx); // tab / shift-tab reach the key handler (form-keys.ts)
    this.cursor = null;
    this.navAt = 0;
    this.navList = [];
    this.spaces.onDone = () => this.refocus();
    this.spaces.focusHost = () => this.handle?.focus(); // an inline form's chip has the keyboard
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
    // nocturne.dock moves the focused pane (any kind) into the dock and pins it,
    // nocturne.dock-web / dock-shell / dock-files open a web pane, a shell or a
    // files pane there (dock.ts);
    // nocturne.toast runs the newest toast's action, nocturne.toast-close
    // (alias nocturne.toast-dismiss) dismisses it (toast.ts), or with none the
    // update note; nocturne.update-close closes the update note (screens.ts).
    // A saved file doesn't restart this loop: changes to it need the layout
    // shown again (another layout and back) or the app restarted.
    cx.spawn(async (later) => {
      for (;;) {
        const c = (await nextCommand()).replace(/^nocturne\./, "");

        if (c === "focus") this.takeKeys();
        else if (c === "sidebar") toggleKeys(this);
        else if (c === "next") this.spaces.step(1);
        else if (c === "prev") this.spaces.step(-1);
        else if (c === "fold") this.fold(later);
        // nocturne.git:pane / :tab / :window or :{"as", folder?, on?} (github, scripts too): inpane.ts.
        else if (databasesCommand(c)) { /* a connection sent to the Databases window, or it opened */ }
        else if (openAsCommand(c)) { /* opened */ }
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
        else if (jarCommand(c)) { /* pinned, moved in the jar, or the tab sent to a space */ }
        else if (c === "dock") dockFocused();
        else if (c === "dock-web") dockWeb();
        else if (c === "dock-shell") dockShell();
        else if (c === "dock-files") dockFiles();
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

  /** nocturne.agent-next / agent-prev (walk.ts): the next / previous stop in
   *  the order drawn: the jar's agents, its shelf's tiles, the other agents,
   *  wrapping. A tile is gone to the way a click on it goes (kit.ts goToPin). */
  walk(dir: number): void {
    const { pinned, all } = sortedAgents();
    const inJar = new Set(pinned.map((a) => a.address));
    // Under the jar as meadow.ts and rail.ts draw them: the awake ones, then those at rest.
    const free = all.filter((a) => !inJar.has(a.address));
    const rest = [...free.filter((a) => !atRest(a)), ...free.filter(atRest)].map((a) => a.address);
    const stops = walkStops([...inJar], jarNow().filter(onShelf), rest);
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
    placeCursor(this);
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

  /** Keeps the mod panes' pins true to panes() (pins.ts tidy): a pane that came
   *  back under a new id keeps its pin, a closed one's goes. Writes from a task. */
  tidyPins(cx: Context): void {
    const recs = paneRecordsNow();
    const tabs = tabRecordsNow();

    if (!recs.length && !tabs.length) return;

    const out = recs.length ? tidy(recs, panes(), this.missing, Date.now()) : null;

    if (out) cx.timer.after(0, () => setShared(PANES_KEY, storedRecords(out)));

    // Whole tabs' pins (pins.ts tidyTabs): one that moved space notes it, one closed goes.
    const outTabs = tabs.length ? tidyTabs(tabs, spaces(), this.missingTabs, Date.now()) : null;

    if (outTabs) cx.timer.after(0, () => setShared(TABS_KEY, outTabs));

    if ((this.missing.size || this.missingTabs.size) && !this.tidyLater) {
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

  /** The sidebar's keys (sky-keys.ts sidebarKey). */
  key(e: KeyEvent, cx: Context): void {
    sidebarKey(this, e, cx);
  }

  /** nocturne.sidebar: the keyboard in, or back out (sky-keys.ts toggleKeys). */
  toggleKeys(): void {
    toggleKeys(this);
  }

  /** A tile is on screen now (shelf.ts pinLit). */
  pinLit(it: JarItem): boolean {
    return pinLit(this, it);
  }

  /** A rail row's acts (sky-keys.ts railActs). */
  railActs(s: SpaceInfo): NavActs {
    return railActs(this, s);
  }

  /** A tile's name (shelf.ts pinName). */
  pinName(it: JarItem): string {
    return pinName(it);
  }

  /** A tile's place in words (shelf.ts pinWhere). */
  pinWhere(it: JarItem): string {
    return pinWhere(this, it);
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
    stamp(this);
    this.tidyPins(cx);

    dockTasks(cx);

    glint(this, [...jarred, ...kept], cx);

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
      .on_key_down((e, cx) => this.key(e, cx))
      .map((el) => tabActions(el, (e, cx) => this.key(e, cx)))
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
    const ordered = (el: Element) => {
      const rank = (x: NavEntry) => SECTION_RANK.get(x.sec) ?? 0;

      this.navList = this.navList.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map(({ x }) => x);

      if (on && placeCursor(this)) cx.timer.after(0, (later) => later.notify());

      return el;
    };

    const glow = this.glow;
    const withGlow = (el: Element) => (glow ? el.child(glow) : el);

    if (this.folded) {
      return ordered(withGlow(sky
        // Fainter stars than open: here they'd sit between small controls.
        .child(svg(`${ART}/stars.svg`).w(480).h(900).absolute().top(0).left(0).text_color(t.ansi8).opacity(0.3))
        // The hills rest on the usage, as open, never behind its numbers.
        .child(svg(`${ART}/hills-fill.svg`).w(480).h(144).absolute().bottom(this.usage.railHeight).left(0).text_color(t.background))
        .child(svg(`${ART}/hills-rim.svg`).w(480).h(144).absolute().bottom(this.usage.railHeight).left(0).text_color(t.ansi8).opacity(0.5)))
        .child(railView(this, t, list, jarred, kept)));
    }

    // The usage section sits at the foot; the haze and hills rest on it.
    // While the sidebar has the keyboard, its hint line lies under the usage.
    const lift = this.usage.height + (on ? 20 : 0);

    noteLandings(this, t, list, cx);

    return ordered(withGlow(sky.when(on, (el) => el.pb(20))
      // Backdrop, back to front: stars, moonlight haze, ground, its lit rim.
      .child(svg(`${ART}/stars.svg`).w(480).h(900).absolute().top(0).left(0).text_color(t.ansi8).opacity(0.55))
      .child(svg(`${ART}/haze.svg`).w(480).h(1400).absolute().bottom(lift).left(0).text_color(t.ansi4).opacity(0.2))
      .child(svg(`${ART}/hills-fill.svg`).w(480).h(144).absolute().bottom(lift).left(0).text_color(t.background))
      .child(svg(`${ART}/hills-rim.svg`).w(480).h(144).absolute().bottom(lift).left(0).text_color(t.ansi8).opacity(0.5)))
      .child(div().absolute().top(14).right(10).child(this.foldButton(t, "«")))
      .child(this.header(t, list))
      .child(this.spaces.render(t, this.nav))
      .child(div().px(16).pt(8).flex_none().child(eyebrow(t, "fireflies")))
      .child(meadowView(this, t, list, jarred, kept))
      .child(this.usage.render(t, this.nav))
      .when(on, (el) => el.child(this.hints(t))));
  }
}
