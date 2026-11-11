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
//            nocturne.pin (cmd-alt-p) pins the focused pane's agent,
//            nocturne.pin-up / pin-down move it in the jar;
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
//   keys     the sidebar takes the keyboard from pane.go (cmd-alt-left from
//            the leftmost pane) or nocturne.sidebar (layout.focus): a cursor
//            walks every control (nav.js SIDEBAR_KEYS; ? lists them), the
//            hint line at its foot says the main ones; l / → goes back to
//            the panes, esc / q to the pane it came from.

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState } from "gpui-base";
import { spaces, terminals, panes, run, hc, theme, setAgentOrder, nextCommand, shared, setShared, settings, layout, focused, window as appWindow } from "herdr";
import * as herdrAll from "herdr";
import { ART, LOGO, WORD, atRest, dither, pip, eyebrow, hash, givenName, nameTerminal, pin, movePin, sortedAgents, focusedTerminal, navRing } from "./kit.js";
import { stamps } from "./pins.js";
import { field } from "./inline.js";
import Spaces from "./spaces.js";
import { NAME_AGENT, openMenu, openKeys } from "./menu.js";
import { SIDEBAR_KEYS, SIDEBAR_HELP, keyVerb, move, moveSection, keep, blockOf } from "./nav.js";
import { toggleGit, openWorktrees } from "./git.js";
import { UsageSection } from "./usage.js";
import { focusFiles } from "./files.js";
import { togglePicker } from "./picker.js";
import { toggleGithub, githubForm } from "./github.js";
import { toggleDeck, lastFailed, grantAppManagement } from "./scripts.js";
import { openNewMenu, OPEN as NEW_OPEN } from "./newmenu.js";
import { newWorktree } from "./menu.js";
import { gridify } from "./gridify.js";
import { toastKey } from "./toast.js";
import { calm, flash, dust, fly as flyPath } from "./flight.js";
import { Fireglow, nextGlow, GONE_AFTER } from "./glow.js";

const stop = (_e, cx) => cx.stop_propagation();

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");

/** The time ("14:05") and date ("Fri 6 Nov") right now. */
function clock() {
  const d = new Date();
  return { time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, date: `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` };
}

/** The blue corner ticks: a 4 px corner in the accent at a thing's top left
 *  and one at its bottom right, `out` px outside its box (0: on its corners).
 *  What's shown wears them: the shown space on the rail, the focused agent in
 *  the open sky (around its name, over the moonlit path) and on the rail. */
function cornerTicks(t, out = 3) {
  const tick = (pos) => div().absolute().size(4).border_color(t.accent)
    .when(pos === "top", (el) => el.left(-out).top(-out).border_t(1).border_l(1))
    .when(pos === "bottom", (el) => el.right(-out).bottom(-out).border_b(1).border_r(1));
  return [tick("top"), tick("bottom")];
}

function moonPhase(list) {
  if (!list.length) return 8;
  const rest = list.filter((a) => a.status === "idle" || a.status === "done").length;
  return Math.round((rest / list.length) * 8);
}

// Herdr shows a hidden tab's terminals at 54x52 for a moment before their
// real size, and Claude Code's renderer is left half-drawn by the double
// resize until something makes it draw again. So when a tab comes into view,
// once the sizes have settled, idle Claude Codes there get an "x" and a
// backspace: a redraw that leaves the prompt as it was. Working ones get it
// too (their spinner only redraws its own line); blocked ones show a dialog
// where a letter can be an answer, so they're left alone. Only on stock
// Herdr: the DwieDave fork (the one with native views) holds a new size until
// the layout settles, so programs never see the placeholder.
const REDRAW_ON_SHOW = typeof herdrAll.nativeView === "undefined";

// Agents with a dithered mark in art/ (art/logos.py), by program key or the
// agent's own app name. Others wear Herdr's icon for them.
// Herdr's shipped check (lucide), the done mark.
const CHECK = "mods/workspace-chrome/check.svg";
// How long a mark's scanline takes there and back, by status; still otherwise.
const SWEEP = { working: 2400, blocked: 900 };
// How fast the wings beat (there and back), by status; resting ones fold them.
const FLAP = { working: 260, blocked: 140, done: 900 };
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
const railWidth = () => appWindow()?.platform === "macos" ? Math.max(RAIL, Math.ceil(LIGHTS_ROOM / (Number(settings()?.zoom) || 1))) : RAIL;
const RAIL_BELOW = 160;
// The rail's ground (railGround): how far above the usage the stack ends (on
// the near ridge), how many at rest stand in one column before they pair
// up, and how many cells it shows at most (the last becomes "+n").
const RAIL_RIDGE = 74;
const RAIL_GROUND_ONE = 4;
const RAIL_GROUND_MAX = 8;
const OPEN_WIDTH = "nocturne.sidebar";
const OPEN_DEFAULT = 252;
// How long a fold gets to land before its width is checked (ms).
const SETTLE = 350;

// The jar of pinned fireflies (pins.js) at the top of the sky: where its
// first lane starts under the lid, the glass under its last, the clear sky
// before the next firefly (layout px).
const JAR = { at: 4, top: 26, bottom: 10, gap: 10 };
// The jar's side margins in the open sky (equal both sides), and how far its
// fireflies' lanes sit in from the sidebar's edges (inside the 2 px walls).
const JAR_SIDE = 8, JAR_INSET = JAR_SIDE + 2;
// How far the neck sits in from the body's walls: in the open sky, on the rail.
const NECK = 22, RAIL_NECK = 11;
// Where the body's walls begin, under the lid, neck and shoulders.
const BODY = 16;
// How long the glass glints after a firefly flies in (ms): as long as the flight.
const GLINT = 1800;

export default class Sky {
  init(_props, cx) {
    // No "+ new" menu outlives a restart or a layout switch: forget one.
    setShared(NEW_OPEN, null);
    this.spaces = new Spaces();
    this.spaces.init(cx);
    // The keyboard (nav.js): the cursor's control, where it was in the list,
    // the controls as last drawn ({ id, sec, go?, menu?, ... }).
    this.handle = cx.focus_handle();
    this.cursor = null;
    this.navAt = 0;
    this.navList = [];
    this.spaces.onDone = () => this.refocus();
    this.usage = new UsageSection();
    this.usage.init(cx);
    // keys.json's layout:nocturne section sends nocturne.next / nocturne.prev
    // here: the next space in the sidebar's order (worktrees under their repo);
    // nocturne.git (cmd-g; nocturne.lazygit, its old name, too) toggles the git
    // window (git.js), nocturne.diff the same on its Review tab, nocturne.worktrees
    // on its Worktrees tab (what the worktree dialog was), nocturne.files
    // the files pane with the keyboard in it (files.js focusFiles), nocturne.github (cmd-shift-g) the GitHub
    // window (github.js; nocturne.github-pr / nocturne.github-run open it on a new pull request or running a workflow), nocturne.scripts (cmd-shift-r) the script runner's
    // deck (scripts.js; nocturne.scripts-failed, a failure's toast, opens it
    // on that run's output; nocturne.scripts-again runs the folder's last
    // script again; nocturne.scripts-grant, the toast of a nix-darwin switch
    // that Herdr Core's missing App Management stopped, opens that setting),
    // nocturne.new (cmd-n) the "+ new" menu, nocturne.gridify (cmd-alt-g)
    // the shown tab's panes into an even grid (gridify.js), nocturne.picker
    // (cmd-p) and nocturne.grep (cmd-shift-f) the file picker (picker.js);
    // nocturne.toast runs the newest toast's action, nocturne.toast-close
    // (alias nocturne.toast-dismiss) dismisses it (toast.js).
    // A saved file doesn't restart this loop: changes to it need the layout
    // shown again (another layout and back) or the app restarted.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^nocturne\./, "");
        if (c === "focus") this.takeKeys();
        else if (c === "sidebar") this.toggleKeys();
        else if (c === "next") this.spaces.step(1);
        else if (c === "prev") this.spaces.step(-1);
        else if (c === "fold") this.fold(cx);
        else if (c === "git" || c === "lazygit") toggleGit();
        else if (c === "diff") toggleGit({ review: true });
        else if (c === "worktrees") openWorktrees();
        else if (c === "files") focusFiles();
        else if (c === "picker") togglePicker("files");
        else if (c === "grep") togglePicker("grep");
        else if (c === "github") toggleGithub();
        else if (c === "github-pr") githubForm("pr");
        else if (c === "github-run") githubForm("workflow");
        else if (c === "scripts") toggleDeck({ centered: true });
        else if (c === "scripts-again") toggleDeck({ centered: true, again: true });
        else if (c === "scripts-failed") toggleDeck({ centered: true, focus: "runs", show: lastFailed() });
        else if (c === "scripts-grant") grantAppManagement();
        else if (c === "gridify") gridify(cx);
        else if (c === "new") openNewMenu({ centered: true });
        else if (c === "pin") pin(focusedTerminal());
        else if (c === "pin-up") movePin(focusedTerminal(), -1);
        else if (c === "pin-down") movePin(focusedTerminal(), 1);
        else if (c === "toast" || c === "toast-close" || c === "toast-dismiss") toastKey(c);
        cx.notify();
      }
    });
    this.size = { width: 248, height: 800 };
    this.want = null; // the fold state asked for while it lands (fold())
    cx.timer.every(SETTLE, (cx) => this.settle(cx));
    this.field = { width: 248, height: 300 };
    this.naming = null; // the address of the agent being named
    this.nameInput = InputState.new({ placeholder: "name" });
    this.nameInput.on("submit", (_e, cx) => this.name(this.nameInput.value().trim(), cx));
    // A firefly's menu (another copy of this mod) asks for naming through
    // shared(NAME_AGENT); a request from before this sky was made is old.
    this.nameAsked = shared(NAME_AGENT)?.at ?? null;
    this.clock = clock();
    // The pointer's own firefly (glow.js): a nested view, so following the
    // pointer rebuilds only it.
    this.glow = cx.new(Fireglow, {});
    // On the rail the space list sits on a plate of the night (no star by a
    // letter): a second glow inside it, under its letters, carries the light
    // across it. railTop: how far down the sky the list starts (layout px).
    this.glowList = cx.new(Fireglow, {});
    this.railTops = {};
    this.glowAt = null;
    this.glowSky = {};
    cx.timer.every(5000, (cx) => {
      const c = clock();
      if (c.time !== this.clock.time) { this.clock = c; cx.notify(); }
    });
  }

  /** Starts naming the agent a firefly menu asked about, once per request. */
  answerNaming(list) {
    const ask = shared(NAME_AGENT);
    if (!ask || ask.at === this.nameAsked) return;
    this.nameAsked = ask.at;
    const a = list.find((x) => x.address === ask.address);
    if (!a || this.folded) return;
    this.naming = a.address;
    this.nameInput.set_value(givenName(a.address) ?? "");
    this.nameInput.focus();
  }

  /** The pointer moved over the sky (or left it, `local` null): the glow
   *  (glow.js) follows it. Only the glow's own view is rebuilt, and only when
   *  it moves to another cell; once faded out it leaves the tree. */
  pointer(local, cx) {
    const at = nextGlow(this.glowAt, local, settings()?.zoom, calm());
    if (!at) return;
    this.glowAt = at;
    this.showGlow(at);
    if (!at.on) cx?.timer.after(GONE_AFTER, () => { if (this.glowAt === at) this.showGlow({ ...at, gone: true }); });
  }

  /** Hands the glow (and on the rail its copy in the space list) its props. */
  showGlow(at) {
    this.glow.set_props({ ...this.glowSky, ...at });
    if (this.glowSky.folded) this.glowList.set_props({ ...this.glowSky, ...at, ox: 0, oy: this.railTop });
  }

  /** Where the rail's space list starts: under its top padding, the clock and the » key. */
  get railTop() { return 48 + (this.railTops.clock ?? 0) + (this.railTops.key ?? 0); }

  /** Notes a measured height above the rail's space list (railTop). */
  railMeasure(k) {
    return (size, cx) => {
      const v = Math.round(size.height / (Number(settings()?.zoom) || 1));
      if (this.railTops[k] !== v) { this.railTops[k] = v; cx.notify(); }
    };
  }

  /** A firefly's right-click menu: focus, rename, move or close its pane. */
  flyMenu(a, centered = false) {
    openMenu({ tab: "fly", target: { id: a.tab, address: a.address } }, { width: 280, centered });
  }

  /** Folded: what was last asked for while a fold settles, else what the width says
   *  (dragging the edge in folds too). */
  get folded() { return this.want ?? this.size.width < RAIL_BELOW; }

  /**
   * Folds to the rail, or opens to the width it had. Quick presses don't
   * trust the measured width, which lags the resize: each press flips the
   * wanted state, draws it at once, and asks for that width. Once things
   * settle, a width that doesn't match (a resize lost in a burst) is asked
   * for again; then the width rules again.
   */
  fold(cx) {
    const folded = this.folded;
    // Remember the open width only from a settled, open sidebar.
    if (!folded && this.want == null && this.size.width >= RAIL_BELOW) setShared(OPEN_WIDTH, Math.round(this.size.width));
    this.want = !folded;
    this.foldAt = Date.now();
    this.reasked = false;
    this.askFold();
    cx?.notify();
  }

  askFold() {
    const open = Math.max(RAIL_BELOW + 40, Number(shared(OPEN_WIDTH)) || OPEN_DEFAULT);
    run("layout.resize", { id: "sidebar", px: this.want ? railWidth() : open });
  }

  /** Every SETTLE ms while a fold is landing: ask again if the width is wrong, then let the width rule. */
  settle(cx) {
    if (this.want == null) return;
    const age = Date.now() - this.foldAt;
    if (age < SETTLE) return;
    const there = this.want ? this.size.width < RAIL_BELOW : this.size.width >= RAIL_BELOW;
    if (!there && !this.reasked) { this.reasked = true; this.foldAt = Date.now(); return this.askFold(); }
    if (there || age >= SETTLE * 4) { this.want = null; cx.notify(); }
  }

  foldButton(t, label) {
    const on = this.nav("fold", "top", { go: (cx) => this.fold(cx) });
    return div().id("fold").relative().flex_none().px(5).h(18).flex().items_center().text_size(11).text_color(on ? t.foreground : t.dim)
      .map((el) => navRing(t, el, on))
      .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); this.fold(cx); })
      .child(label);
  }

  // ---- naming agents: an agent goes by its pane's name, kept on its terminal (kit.js NAME_LABEL)

  startNaming(a, cx) {
    this.naming = a.address;
    this.nameInput.set_value(givenName(a.address) ?? "");
    this.nameInput.focus();
    cx.notify();
  }

  name(value, cx) {
    const terminal = this.naming;
    this.naming = null;
    cx.notify();
    if (terminal) nameTerminal(terminal, value);
    this.refocus();
  }

  // ---- the keyboard (nav.js)

  /** This sidebar's layout block (the one showing nocturne as the sky). */
  get block() { return blockOf(layout(), "sky"); }

  /** The sidebar has the keyboard (pane.go or layout.focus gave it the block). */
  get navOn() { const b = this.block; return Boolean(b) && focused()?.block === b; }

  /** "focus" from Herdr: the keyboard is the sidebar's. */
  takeKeys() {
    this.handle.focus();
    this.placeCursor();
  }

  /** A cursor on a live control: where it was, else its neighbor (a space closed), else the shown space. */
  placeCursor() {
    if (this.navList.some((x) => x.id === this.cursor)) return false;
    const shown = spaces().find((s) => s.active);
    this.cursor = this.cursor == null
      ? this.navList.find((x) => x.id === `space:${shown?.id}`)?.id ?? keep(this.navList, null)
      : keep(this.navList, this.cursor, this.navAt);
    return true;
  }

  /** nocturne.sidebar: into the sidebar, or back out to the pane. */
  toggleKeys() {
    if (this.navOn) return this.back();
    const b = this.block;
    if (b) run("layout.focus", { id: b });
  }

  /** Back to the pane the keyboard came from (pane.focus clears the block). */
  back() {
    const pane = focused()?.pane;
    if (pane) run("pane.focus", { pane });
    else run("pane.go", { direction: "right" });
  }

  /** After an inline edit (a name, a folder, a delete): the keyboard back on the sidebar. */
  refocus() { if (this.navOn) this.handle.focus(); }

  /** A control the keyboard can reach, as it's drawn: true while the cursor is on it. */
  nav(id, sec, acts = {}) {
    this.navList.push({ id, sec, ...acts });
    return this.navOn && this.cursor === id;
  }

  /** The verbs on a firefly. */
  flyActs(a) {
    return {
      go: () => run("agent.focus", { terminal: a.address }),
      menu: () => this.flyMenu(a, true),
      rename: (cx) => { if (!this.folded) this.startNaming(a, cx); },
      pin: () => pin(a.address),
      "pin-up": () => movePin(a.address, -1),
      "pin-down": () => movePin(a.address, 1),
    };
  }

  /** The verbs on a space's rail row: Herdr's own dialogs, as the folded menu uses. */
  railActs(s) {
    return {
      go: () => run("space.select", { id: s.id }),
      menu: () => this.spaces.menu(s, true),
      rename: () => run("space.rename", { id: s.id }),
      folder: (cx) => this.spaces.pick(cx, s),
      delete: () => run("space.close", { id: s.id }),
      tab: () => run("tab.new", { space: s.id }),
      worktree: () => newWorktree(s.id),
    };
  }

  /** A key while the sidebar has the keyboard. */
  key(e, cx) {
    if (this.spaces.confirmKey(e, cx)) { cx.stop_propagation(); return cx.notify(); }
    // A field inside (a name, a folder) has the keyboard: its keys are its own.
    if (this.naming || (this.spaces.mode && this.spaces.mode.kind !== "delete")) return;
    const verb = keyVerb(e, SIDEBAR_KEYS);
    if (!verb) return;
    cx.stop_propagation();
    const items = this.navList;
    const item = items.find((x) => x.id === this.cursor);
    switch (verb) {
      case "down": case "up": this.cursor = move(items, this.cursor, verb === "down" ? 1 : -1); break;
      case "first": this.cursor = items[0]?.id ?? null; break;
      case "last": this.cursor = items.at(-1)?.id ?? null; break;
      case "next": case "prev": this.cursor = moveSection(items, this.cursor, verb === "next" ? 1 : -1); break;
      case "right": return run("pane.go", { direction: "right" });
      case "back": return this.back();
      case "help": return openKeys("sidebar keys", SIDEBAR_HELP);
      case "new": if (this.folded) run("space.new"); else this.spaces.start({ kind: "new" }, cx); break;
      default: item?.[verb]?.(cx);
    }
    this.navAt = Math.max(0, items.findIndex((x) => x.id === this.cursor));
    cx.notify();
  }

  /** The hint line at the sidebar's foot while it has the keyboard. */
  hints(t) {
    return h_flex().id("sky-hints").absolute().left(0).right(0).bottom(0).h(20).px(10).gap(8).items_center()
      .bg(t.background).text_size(11).text_color(t.dim)
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.accent, 1)))
      .child(div().text_color(t.accent).child("keys"))
      .child(div().flex_1().min_w(0).truncate().child("jk ⏎ m menu esc ?"));
  }

  header(t, list) {
    const n = (s) => list.filter((a) => a.status === s).length;
    const blocked = n("blocked"), working = n("working"), done = n("done");
    const rest = list.length - blocked - working;
    const lines = [];
    if (blocked) lines.push([t.blocked, `${blocked} ${WORD.blocked}`]);
    if (working) lines.push([t.working, `${working} working`]);
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
          .when(Boolean(check), (el) => el.child(svg(CHECK).size(10).flex_none().text_color(c)))
          .child(div().truncate().text_size(11).text_color(c).child(s)))));
  }

  /** A 12 px check on a dark plate, set on a done firefly's mark. */
  doneBadge(t) {
    return div().size(12).flex().items_center().justify_center().bg(t.background).border(1).border_color(t.done)
      .child(svg(CHECK).size(8).text_color(t.done));
  }

  /** The agent's mark, 16 px: a dithered logo (art/logo-*.svg), else Herdr's own icon, else a bot. */
  mark(a, color) {
    const p = a.program ?? {};
    const key = LOGO[p.key] ?? LOGO[a.app];
    if (key) return svg(`${ART}/logo-${key}.svg`).size(16).text_color(color);
    if (p.icon) return p.tint !== false ? svg(p.icon).size(16).text_color(color) : image(p.icon).size(16);
    return svg(`${ART}/logo-agent.svg`).size(16).text_color(color);
  }

  /** A pair of 1-bit wings over the mark's shoulders (art/wings.svg). They beat
   *  by folding: a clip anchored at their base shortens and grows, so the tips
   *  dip behind it, pixels kept whole. Resting ones hold them still. */
  wings(a, h, color, landing) {
    const beat = calm() ? null : landing ? FLAP.working : FLAP[a.status];
    // Roots on the mark's shoulders: the mark sits at 12..28, its body's top edge near 15.
    // The mark's own color: one creature, not a sprite with a costume.
    const clip = div().absolute().left(8).top(10).w(25).h(8).overflow_hidden()
      .child(svg(`${ART}/wings.svg`).absolute().bottom(0).left(0).w(25).h(8).text_color(color));
    if (!beat) return clip;
    const period = beat + (h % 60);
    return clip.loop("top", { from: 10, to: 13, period, easing: "linear" }).loop("height", { from: 8, to: 5, period, easing: "linear" });
  }

  /** Notes agents that just went to rest; they're `landing` for LAND ms. */
  land(t, list, cx) {
    this.seen ??= new Map();
    this.landing ??= new Map();
    const now = Date.now();
    for (const a of list) {
      const was = this.seen.get(a.address);
      if (was && was !== "idle" && a.status === "idle") {
        this.landing.set(a.address, { color: t[was] ?? t.dim, until: now + LAND });
        cx.timer.after(LAND + 50, (cx) => cx.notify?.());
      } else if (a.status !== "idle") this.landing.delete(a.address);
      this.seen.set(a.address, a.status);
    }
    for (const [k, v] of this.landing) if (v.until <= now) this.landing.delete(k);
  }

  firefly(t, a, y, lane, w) {
    const h = hash(a.address);
    const on = this.nav(`fly:${a.address}`, "flies", this.flyActs(a));
    const x = 6; // the halo's edge lines up with the eyebrow; every mark in one column
    const color = a.status === "idle" ? t.muted : t[a.status] ?? t.dim;
    const glow = svg(`${ART}/glow.svg`).w(40).h(40).absolute().top(0).left(0).text_color(color);
    const landing = this.landing?.get(a.address);
    const still = calm();
    // Landing: the last awake glow and mark fade out over the resting mark
    // (a loop's first half, removed once it's out).
    const fade = (el) => el.loop("opacity", { from: 1, to: 0, period: LAND * 2, easing: "ease-out" });
    // Every firefly glows in its own rhythm (flight.js): working ones flash,
    // blocked ones fast and bright, done ones breathe dimly, resting ones blink faintly.
    const halo = landing ? fade(glow.text_color(landing.color)) : flash(glow, a.status, h);
    // The firefly's body is its agent's mark, on a dark plate so the halo's
    // dots don't run into it.
    const body0 = div().relative().size(40).flex_none()
      .child(halo).child(div().absolute().top(10).left(10).size(20).bg(t.background))
      .child(this.wings(a, h, color, landing))
      .child(div().absolute().top(12).left(12).size(16).overflow_hidden()
        .child(this.mark(a, color))
        .when(Boolean(landing), (el) => el.child(fade(div().absolute().top(0).left(0).size(16).child(this.mark(a, landing.color)))))
        // Alive: a band of night-colored dither sweeps across the mark. Over
        // the plate it vanishes, so only the mark's own pixels darken, like a
        // scanline over a sprite. Working sweeps slowly, blocked fast.
        .when(SWEEP[a.status] != null && !still, (el) => el.child(div().absolute().top(0).h(16).w(6)
          .loop("left", { from: -6, to: 16, period: SWEEP[a.status] + (h % 400), easing: "linear" })
          .child(dither(t.background, 1)))))
      // Done says so by shape too, not only by its green: a check on the mark.
      .when(a.status === "done", (el) => el.child(this.doneBadge(t).absolute().top(22).left(22)));
    // Only the firefly flies (flight.js), in its slot, leaving dust; its name stays put.
    const fly = div().relative().size(40).flex_none()
      .children(dust(a.status, h, () => div().child(dither(color, 1))))
      .child(flyPath(body0, a.status, h, this.naming === a.address || Boolean(landing)));
    // The pane's name leads (the agent's own when nobody named it). Only
    // what the halo doesn't already say follows: its space when that isn't
    // the shown one; awake ones add their status on a second line, resting
    // ones keep to one. The focused one stands in a moonlit path: a dithered band
    // behind its name that thins out in three steps, and only its name is bright;
    // its name wears the corner ticks, as the shown space does on the rail.
    const title = givenName(a.address) ?? (a.program?.agent ? a.program.name : a.title || a.program?.name || a.address);
    const naming = this.naming === a.address;
    const resting = a.status === "idle" || lane < 32;
    const elsewhere = a.space_name && a.space !== this.shownSpace ? a.space_name : null;
    const whereColor = a.focused || on ? t.foreground : a.status === "blocked" ? t.blocked : t.muted;
    const sub = [elsewhere, a.status === "idle" ? null : WORD[a.status]].filter(Boolean).join(" · ");
    const body = h_flex().id(`fly-${a.address}`).absolute().top(0).left(x).h(lane).items_center()
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); if (e.click_count === 2) this.startNaming(a, cx); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.flyMenu(a); })
      .on_click((e) => { if ((e?.click_count ?? 1) < 2) run("agent.focus", { terminal: a.address }); })
      .child(fly)
      .child(naming
        ? h_flex().ml(-2).w(w - x - 50).gap(4).items_center()
          .child(field(t, `name-${a.address}`, this.nameInput, (cx) => { this.naming = null; cx.notify(); }))
        : v_flex().ml(-2).max_w(w - x - 44).min_w(0).relative().pl(6).pr(4).py(1).gap(1)
          .child(resting
            ? h_flex().min_w(0).gap(6).items_baseline()
              .child(div().flex_none().max_w(w - x - 54).truncate().text_size(11).text_color(whereColor).child(title))
              .when(Boolean(elsewhere), (el) => el.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(elsewhere)))
            : div().truncate().text_size(11).text_color(whereColor).child(title))
          .when(!resting && Boolean(sub), (el) => el.child(a.status === "done"
            // Done reads at a glance: a check and the word, bright, not dim.
            ? h_flex().min_w(0).gap(4).items_center()
              .child(svg(CHECK).size(10).flex_none().text_color(t.done))
              .child(div().truncate().text_size(11).text_color(t.foreground).child(sub))
            : div().truncate().text_size(11).text_color(t.dim).child(sub)))
          .when(Boolean(a.focused), (el) => el.children(cornerTicks(t))));
    const step = (o) => div().flex_1().h_full().relative().opacity(o).child(dither(t.ansi0, 1));
    const path = h_flex().absolute().top(4).bottom(4).left(x + 36).right(0).gap(2)
      .child(step(1).flex_grow(3)).child(step(0.6)).child(step(0.3));
    // The lane holds still (only the firefly in it flies), so it can move to
    // a new spot (to rest, say) on its own transition.
    const inner = div().absolute().top(0).left(0).w(w).h(lane).child(body);
    return div().id(`lane-${a.address}`).absolute().left(0).w(w).h(lane).top(y)
      .transition("top", { duration: LAND, easing: "ease-in-out" })
      .when(a.focused || on, (el) => el.child(path))
      .when(on, (el) => el.child(div().absolute().left(0).top(4).bottom(4).w(2).bg(t.accent)))
      .child(inner);
  }

  /**
   * The jar's glass, filling its (relative) parent: a lid, a neck, 2 px
   * dithered walls and a faint moonlit fill, square like everything here.
   * When a pinned firefly needs you the glass breathes in its color, slower
   * than the firefly's own blink; just after one flies in, it glints.
   */
  glass(t, jarred, n = NECK) {
    const needs = jarred.some((a) => a.status === "blocked");
    const tone = needs ? t.blocked : t.ansi8;
    const strip = (el) => el.absolute().child(dither(tone, 1));
    // A mason jar, symmetric around its middle, square pixels only: a screw
    // band lid wider than the neck, the neck, shoulders stepping out in two
    // stairs, then the body's walls and base. `n`: the neck's inset.
    const half = Math.round(n / 2);
    // The same piece on the left and, mirrored, on the right (`side(el, x)` places it x in).
    const pair = (mk) => ["left", "right"].map((side) => mk((el, x) => el[side](x)));
    const frame = div().absolute().top(0).left(0).size_full()
      .child(div().absolute().top(0).left(n - 4).right(n - 4).h(4).bg(tone)) // the lid
      .child(strip(div().top(4).left(n - 4).right(n - 4).h(2)).opacity(0.6)) // its band
      .children(pair((side) => strip(side(div().top(6).w(2).h(6), n)))) // the neck
      .children(pair((side) => strip(side(div().top(12).w(n - half + 2).h(2), half)))) // upper shoulders
      .children(pair((side) => strip(side(div().top(14).w(half + 2).h(2), 0)))) // lower shoulders
      .children(pair((side) => strip(side(div().top(BODY).bottom(0).w(2), 0)))) // the walls
      .child(strip(div().bottom(0).left(0).right(0).h(2))); // the base
    const glinting = (this.glintUntil ?? 0) > Date.now();
    // The glass: the body and the neck, faintly moonlit (or red while one needs you).
    const fill = (c, o) => [
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

  /** The jar in the open sky, behind its fireflies' lanes. */
  jar(t, jarred, h, w) {
    return div().id("jar").absolute().top(JAR.at).left(JAR_SIDE).w(w - 2 * JAR_SIDE).h(h - JAR.at).child(this.glass(t, jarred));
  }

  /** Inside the jar even a resting firefly glows a little: a soft halo
   *  behind its lane (awake ones have their own), on the dark plate. */
  jarGlow(t, a, y, lane) {
    // Not while it flies in (its plate would wait there before it), nor while landing.
    if (a.status !== "idle" || this.landing?.has(a.address) || this.arriving?.has(a.address)) return div();
    const top = y + Math.round((lane - 40) / 2);
    return div().id(`jar-glow-${a.address}`).absolute().left(JAR_INSET + 6).top(top).size(40)
      .transition("top", { duration: LAND, easing: "ease-in-out" })
      .child(svg(`${ART}/glow.svg`).absolute().top(0).left(0).size(40).text_color(t.muted).opacity(0.45))
      .child(div().absolute().top(10).left(10).size(20).bg(t.background));
  }

  /** Notes fireflies that just flew into the jar: its glass glints for GLINT ms. */
  glint(jarred, cx) {
    const now = new Set(jarred.map((a) => a.address));
    const fresh = this.jarSeen ? jarred.filter((a) => !this.jarSeen.has(a.address)) : [];
    if (Date.now() >= (this.glintUntil ?? 0)) this.arriving = null;
    if (fresh.length) {
      this.glintUntil = Date.now() + GLINT;
      this.arriving = new Set([...(this.arriving ?? []), ...fresh.map((a) => a.address)]);
      cx.timer.after(GLINT + 50, (cx) => cx.notify?.());
    }
    this.jarSeen = now;
  }

  /** Pins made elsewhere get their place in the jar; an unpin's leftover time goes (pins.js stamps). Once per value. */
  stamp() {
    const now = Date.now();
    this.stamped ??= new Map();
    for (const [k, v] of this.stamped) if (now - v > 5000) this.stamped.delete(k);
    for (const [terminal, kv] of stamps(terminals(), now)) {
      const key = `${terminal} ${kv.replace(/=.*/, "")}`;
      if (this.stamped.has(key)) continue;
      this.stamped.set(key, now);
      hc(["label", terminal, kv]).catch(() => {});
    }
  }

  // Awake fireflies (blocked, working, running a command) spread through the
  // sky above the grass; those at rest (done, then resting: kit.js atRest)
  // sit in a stack on the near ridge, as on the rail.
  // Pinned ones (pins.js) live in a glass jar at the top, in the order
  // pinned; the rest keep this order below it. Lanes are placed in one space,
  // so a firefly being pinned flies up into the jar (and back out).
  meadow(t, list, jarred = []) {
    // Measured sizes come back as drawn (zoomed); lengths here are layout px.
    const zoom = Number(settings()?.zoom) || 1;
    const w = this.field.width / zoom, hgt = this.field.height / zoom;
    const inJar = new Set(jarred.map((a) => a.address));
    const free = list.filter((a) => !inJar.has(a.address));
    const awake = free.filter((a) => !atRest(a));
    const resting = free.filter(atRest);
    const ground = hgt - 96; // above the far ridge (hills-rim), so labels stay on clear sky
    let lane = 40, restLane = 28;
    const laneOf = (a) => (a.status === "idle" ? restLane : lane);
    const jarNeed = jarred.length ? JAR.top + jarred.reduce((n, a) => n + laneOf(a), 0) + JAR.bottom : 0;
    const need = jarNeed + awake.length * lane + resting.length * restLane + 16;
    let placed = [];
    let more = 0;
    let jarH = 0;
    if (need <= ground) {
      // Room to spare: the jar on top, awake ones spread out under it, the
      // rest settle on the ground.
      let y = JAR.top;
      for (const a of jarred) { placed.push([a, y, laneOf(a)]); y += laneOf(a); }
      jarH = jarred.length ? y + JAR.bottom : 0;
      const top = jarH ? jarH + JAR.gap : 8;
      const restTop = ground - resting.length * restLane;
      const step = awake.length ? Math.min(46, (restTop - top) / awake.length) : 0;
      awake.forEach((a, i) => placed.push([a, Math.round(top + i * step), lane]));
      resting.forEach((a, i) => placed.push([a, restTop + i * restLane, restLane]));
    } else {
      // Crowded: one tight list (the jar's first), then a count.
      lane = 24;
      const fit = Math.max(1, Math.floor((ground - 8 - (jarred.length ? JAR.top + JAR.bottom + JAR.gap - 8 : 0)) / lane) - 1);
      const shown = [...jarred, ...free].slice(0, fit);
      let y = jarred.length ? JAR.top : 8;
      shown.forEach((a, i) => {
        if (i === jarred.length && jarred.length) { jarH = y + JAR.bottom; y = jarH + JAR.gap; }
        placed.push([a, y, lane]);
        y += lane;
      });
      if (jarred.length && !jarH) jarH = y + JAR.bottom;
      more = list.length - shown.length;
    }
    const jarLanes = placed.filter(([a]) => inJar.has(a.address));
    return div().id("meadow").relative().flex_1().min_h(0).w_full()
      .on_size_change((size, cx) => { this.field = size; cx.notify(); })
      .when(jarH > 0, (el) => el.child(this.jar(t, jarred, jarH, w)).children(jarLanes.map(([a, y, l]) => this.jarGlow(t, a, y, l))))
      // The jar's lanes sit inside its walls, the same margin on both sides.
      .children(placed.map(([a, y, l]) => inJar.has(a.address)
        ? this.firefly(t, a, y, l, w - 2 * JAR_INSET).left(JAR_INSET)
        : this.firefly(t, a, y, l, w)))
      .when(more > 0, (el) => el.child(div().id("more").absolute().left(50).top(placed.length ? placed.at(-1)[1] + placed.at(-1)[2] : 8)
        .map((el) => navRing(t, el, this.nav("more", "flies", { go: () => run("agent.next") })))
        .text_size(11).text_color(t.ansi8).hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stop).on_click(() => run("agent.next"))
        .child(`+${more} more in the grass`)));
  }

  redraw(cx, sp) {
    const tab = sp.find((s) => s.active)?.tabs.find((c) => c.active)?.id;
    if (!REDRAW_ON_SHOW || !tab || tab === this.shownTab) return;
    const first = this.shownTab === undefined;
    this.shownTab = tab;
    if (first) return; // the app just started: nothing was resized under it
    // Also redraw the window itself once things settle.
    cx.timer.after(REDRAW_DELAY, (cx) => cx.notify?.());
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
  initials(name) {
    const chars = String(name).match(/[\p{L}\p{N}]/gu) ?? [];
    return chars.length ? chars[0].toUpperCase() + (chars[1] ?? "").toLowerCase() : "·";
  }

  /** The rail's » : a bordered key, filled and bright under the pointer. */
  openKey(t) {
    const on = this.nav("fold", "top", { go: (cx) => this.fold(cx) });
    return div().id("fold").relative().flex_none().w(28).h(20).flex().items_center().justify_center()
      .map((el) => navRing(t, el, on))
      .border(1).border_color(t.ansi0).text_size(11).text_color(t.muted)
      .hover((s) => s.text_color(t.foreground).bg(t.ansi0).border_color(t.ansi8))
      .tooltip("Open the sidebar (⌘B)")
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); this.fold(cx); })
      .child("»");
  }

  /** A space's rail row: its initials on a dotted thread down the rail's
   *  middle that runs only between spaces (`at`: its place, of `count`). The
   *  shown one has blue corner ticks; the one under the pointer a grey plate;
   *  one that wants attention its status pip beside the initials. */
  railSpace(t, s, at, count) {
    const hot = this.railHover === s.id || this.nav(`space:${s.id}`, "spaces", this.railActs(s));
    const thread = count > 1 ? div().absolute().left(0).right(0).top(at === 0 ? 13 : 0).bottom(at === count - 1 ? 13 : 0).flex().justify_center()
      .child(div().relative().w(1).h_full().child(dither(t.ansi8 + "99", 1))) : null;
    return div().id(`rail-space-${s.id}`).relative().w_full().h(26).flex_none().flex().items_center().justify_center().text_size(11)
      .tooltip(s.name)
      .on_hover((h, cx) => { if (h ? this.railHover !== s.id : this.railHover === s.id) { this.railHover = h ? s.id : null; cx.notify(); } })
      .on_mouse_down("left", stop)
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.spaces.menu(s); })
      .on_click(() => run("space.select", { id: s.id }))
      .when(Boolean(thread), (el) => el.child(thread))
      // On a plate of the night's ground (the list is on it too, so no star
      // lands beside a letter like a stray mark), so the thread stops at the letters.
      .child(div().relative().px(3).py(1).bg(hot ? t.ansi0 : t.background).text_color(s.active || hot ? t.foreground : t.muted)
        .child(this.initials(s.name))
        .when(s.active, (el) => el.children(cornerTicks(t)))
        .when(Boolean(s.status) && s.status !== "idle", (el) => el.child(div().absolute().right(-13).top(5).child(pip(t, s.status)))));
  }

  /** A firefly on the rail: its mark in a 32 px cell, glowing in its rhythm
   *  (flight.js); a working one rises and falls a pixel or two. */
  railFly(t, a, size = 32) {
    const h = hash(a.address);
    const on = this.nav(`fly:${a.address}`, "flies", this.flyActs(a));
    const color = a.status === "idle" ? t.muted : t[a.status] ?? t.dim;
    const awake = a.status !== "idle";
    const mark = div().relative().child(this.mark(a, color));
    const plate = (size - 16) / 2;
    return div().id(`rail-fly-${a.address}`).relative().size(size).flex_none().flex().items_center().justify_center()
      .hover((s) => s.bg(t.ansi0 + "55"))
      .tooltip(`${givenName(a.address) ?? a.program?.name ?? a.title ?? a.address}${a.space_name ? ` · ${a.space_name}` : ""} · ${WORD[a.status] ?? a.status}`)
      .on_mouse_down("left", stop)
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.flyMenu(a); })
      .on_click(() => run("agent.focus", { terminal: a.address }))
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
  railGround(t, resting) {
    if (!resting.length) return null;
    const pairs = resting.length > RAIL_GROUND_ONE;
    const cell = pairs ? 28 : 30;
    const room = pairs ? RAIL_GROUND_MAX : resting.length;
    const shown = resting.length > room ? resting.slice(0, room - 1) : resting;
    const more = resting.length - shown.length;
    // The count takes the last cell, so the stack keeps its shape above the hills.
    const marks = [...shown.map((a) => this.railFly(t, a, cell)),
      ...(more > 0 ? [div().id("rail-ground-more").relative().size(cell).flex_none().flex().items_center().justify_center()
        .map((el) => navRing(t, el, this.nav("more", "flies", { go: () => run("agent.next") })))
        .text_size(10).text_color(t.ansi8).hover((s) => s.text_color(t.foreground).bg(t.ansi0 + "55"))
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
  rail(t, list, jarred = []) {
    const rows = this.spaces.rows().filter((r) => r.s);
    const inJar = new Set(jarred.map((a) => a.address));
    const free = list.filter((a) => !inJar.has(a.address));
    // The pinned ones' marks in a small jar of their own, resting ones lit a little.
    const jar = jarred.length ? v_flex().id("rail-jar").relative().w(48).flex_none().items_center().pt(BODY + 2).pb(4).gap(2).mb(6)
      .child(this.glass(t, jarred, RAIL_NECK))
      .children(jarred.map((a) => div().relative().size(32).flex_none()
        .when(a.status === "idle", (el) => el.child(svg(`${ART}/glow.svg`).absolute().top(0).left(0).size(32).text_color(t.muted).opacity(0.45))
          .child(div().absolute().top(8).left(8).size(16).bg(t.background)))
        .child(div().absolute().top(0).left(0).child(this.railFly(t, a))))) : null;
    // Awake ones under the jar at the top; those at rest on the ground at the foot (railGround).
    const flies = free.filter((a) => !atRest(a)).map((a) => this.railFly(t, a));
    const ground = this.railGround(t, free.filter(atRest));
    const rule = () => div().w(28).h(2).flex_none().relative().child(dither(t.ansi8, 1));
    return v_flex().w_full().flex_1().min_h(0).pt(48).items_center()
      .child(v_flex().id("rail-clock").flex_none().items_center().tooltip(this.clock.date).on_size_change(this.railMeasure("clock"))
        .child(svg(`${ART}/moon-${moonPhase(list)}.svg`).size(32).flex_none().text_color(t.ansi7))
        .child(div().pt(4).text_size(11).text_color(t.foreground).child(this.clock.time)))
      .child(div().id("rail-key").pt(10).pb(14).flex_none().on_size_change(this.railMeasure("key")).child(this.openKey(t)))
      .child(v_flex().id("rail-spaces").relative().overflow_hidden().w_full().flex_none().bg(t.background).child(this.glowList).children(rows.map(({ s }, i) => this.railSpace(t, s, i, rows.length))))
      .child(div().py(12).flex_none().child(rule()))
      .child(v_flex().id("rail-flies").w_full().flex_1().min_h(0).gap(2).items_center().overflow_y_scroll().when(Boolean(jar), (el) => el.child(jar)).children(flies))
      .when(Boolean(ground), (el) => el.child(ground))
      .child(this.usage.rail(t, (...a) => this.nav(...a)));
  }

  render(cx) {
    const t = theme();
    // The controls are listed again as they're drawn (nav()).
    this.navList = [];
    const on = this.navOn;
    // Pinned agents first, in the order pinned (pins.js), then by status (kit.js agentRank).
    const { pinned: jarred, all: list } = sortedAgents();
    setAgentOrder(list.map((a) => a.address));
    this.stamp();
    this.glint(jarred, cx);
    const sp = spaces();
    this.shownSpace = sp.find((s) => s.active)?.id ?? null;
    this.redraw(cx, sp);
    this.answerNaming(list);
    this.spaces.answer(this.folded, cx);
    const sky = v_flex().id("sky").relative().size_full().overflow_hidden().bg(t.background)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_mouse_move((e, cx) => this.pointer(e.local_position, cx))
      .on_hover((h, cx) => { if (!h) this.pointer(null, cx); });
    // What the glow needs of the sky to light its backdrop; a glow that's
    // up hears at once when the sky changes under it or calm() turns.
    const zoom = Number(settings()?.zoom) || 1;
    this.glowSky = { folded: this.folded, h: Math.round(this.size.height / zoom), lift: this.folded ? this.usage.railHeight : this.usage.height + (on ? 20 : 0) };
    const g = this.glowAt, key = JSON.stringify([this.glowSky, this.railTop]);
    if (g?.on && (g.calm !== calm() || this.glowKey !== key)) {
      const next = this.glowAt = { ...g, calm: calm() };
      cx.timer.after(0, () => { if (this.glowAt === next) this.showGlow(next); });
    }
    this.glowKey = key;
    // After drawing: the controls top to bottom (the rail draws its fireflies
    // before its spaces), and a cursor on one that went moves to its neighbor.
    const placeCursor = (el) => {
      const rank = { top: 0, spaces: 1, flies: 2, usage: 3 };
      this.navList = this.navList.map((x, i) => [x, i]).sort(([a, i], [b, j]) => (rank[a.sec] - rank[b.sec]) || i - j).map(([x]) => x);
      if (on && this.placeCursor()) cx.timer.after(0, (cx) => cx.notify?.());
      return el;
    };
    if (this.folded) {
      return placeCursor(sky
        // Fainter stars than open: here they'd sit between small controls.
        .child(svg(`${ART}/stars.svg`).w(480).h(900).absolute().top(0).left(0).text_color(t.ansi8).opacity(0.3))
        // The hills rest on the usage, as open, never behind its numbers.
        .child(svg(`${ART}/hills-fill.svg`).w(480).h(144).absolute().bottom(this.usage.railHeight).left(0).text_color(t.background))
        .child(svg(`${ART}/hills-rim.svg`).w(480).h(144).absolute().bottom(this.usage.railHeight).left(0).text_color(t.ansi8).opacity(0.5))
        .child(this.glow)
        .child(this.rail(t, list, jarred)));
    }
    // The usage section sits at the foot; the haze and hills rest on it.
    // While the sidebar has the keyboard, its hint line lies under the usage.
    const lift = this.usage.height + (on ? 20 : 0);
    return placeCursor(sky.when(on, (el) => el.pb(20))
      // Backdrop, back to front: stars, moonlight haze, ground, its lit rim.
      .child(svg(`${ART}/stars.svg`).w(480).h(900).absolute().top(0).left(0).text_color(t.ansi8).opacity(0.55))
      .child(svg(`${ART}/haze.svg`).w(480).h(1400).absolute().bottom(lift).left(0).text_color(t.ansi4).opacity(0.2))
      .child(svg(`${ART}/hills-fill.svg`).w(480).h(144).absolute().bottom(lift).left(0).text_color(t.background))
      .child(svg(`${ART}/hills-rim.svg`).w(480).h(144).absolute().bottom(lift).left(0).text_color(t.ansi8).opacity(0.5))
      .child(this.glow)
      .child(div().absolute().top(14).right(10).child(this.foldButton(t, "«")))
      .child(this.header(t, list))
      .child(this.spaces.render(t, (...a) => this.nav(...a)))
      .child(div().px(16).pt(8).flex_none().child(eyebrow(t, "fireflies")))
      .child((this.land(t, list, cx), this.meadow(t, list, jarred)))
      .child(this.usage.render(t, (...a) => this.nav(...a)))
      .when(on, (el) => el.child(this.hints(t))));
  }
}
