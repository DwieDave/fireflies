// The sidebar: a dithered night sky.
//   moon     its lit share is the share of agents at rest (idle or done);
//            new moon while everything works, full when the herd is quiet
//   spaces   one row each (spaces.js), with inline create / rename / delete
//            spaces in a repo's worktrees sit indented under its main one
//   usage    Claude's or Codex's 5-hour and weekly limits (usage.js), foldable,
//            at the foot; the hills rest on top of it
//   meadow   every agent is a firefly: blocked blinks red at the top,
//            working drifts amber, done glows green below them (kit.js
//            agentRank), idle rests in the grass;
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

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState } from "gpui-base";
import { spaces, agents, panes, run, hc, theme, setAgentOrder, nextCommand, shared, setShared, openOverlay, settings, window as appWindow } from "herdr";
import * as herdrAll from "herdr";
import { ART, LOGO, WORD, agentRank, dither, pip, eyebrow, hash, givenName, nameTerminal } from "./kit.js";
import { field } from "./inline.js";
import Spaces from "./spaces.js";
import { menuHeight, NAME_AGENT } from "./menu.js";
import { toggleLazygit } from "./lazygit.js";
import { UsageSection } from "./usage.js";
import { toggleFiles } from "./files.js";
import { toggleGithub } from "./github.js";
import { toggleDeck, lastFailed, grantAppManagement } from "./scripts.js";
import { openNewMenu, OPEN as NEW_OPEN } from "./newmenu.js";

const stop = (_e, cx) => cx.stop_propagation();

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");

/** The time ("14:05") and date ("Fri 6 Nov") right now. */
function clock() {
  const d = new Date();
  return { time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, date: `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` };
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
const OPEN_WIDTH = "nocturne.sidebar";
const OPEN_DEFAULT = 252;
// How long a fold gets to land before its width is checked (ms).
const SETTLE = 350;

export default class Sky {
  init(_props, cx) {
    // No "+ new" menu outlives a restart or a layout switch: forget one.
    setShared(NEW_OPEN, null);
    this.spaces = new Spaces();
    this.spaces.init(cx);
    this.usage = new UsageSection();
    this.usage.init(cx);
    // keys.json's layout:nocturne section sends nocturne.next / nocturne.prev
    // here: the next space in the sidebar's order (worktrees under their repo);
    // nocturne.lazygit toggles the lazygit pane (lazygit.js), nocturne.files
    // the files pane (files.js), nocturne.github (cmd-shift-g) the GitHub
    // window (github.js), nocturne.scripts (cmd-shift-r) the script runner's
    // deck (scripts.js; nocturne.scripts-failed, a failure's toast, opens it
    // on that run's output; nocturne.scripts-again runs the folder's last
    // script again; nocturne.scripts-grant, the toast of a nix-darwin switch
    // that Herdr Core's missing App Management stopped, opens that setting),
    // nocturne.new (cmd-n) the "+ new" menu.
    // A saved file doesn't restart this loop: changes to it need the layout
    // shown again (another layout and back) or the app restarted.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^nocturne\./, "");
        if (c === "next") this.spaces.step(1);
        else if (c === "prev") this.spaces.step(-1);
        else if (c === "fold") this.fold(cx);
        else if (c === "lazygit") toggleLazygit();
        else if (c === "files") toggleFiles();
        else if (c === "github") toggleGithub();
        else if (c === "scripts") toggleDeck({ centered: true });
        else if (c === "scripts-again") toggleDeck({ centered: true, again: true });
        else if (c === "scripts-failed") toggleDeck({ centered: true, focus: "runs", show: lastFailed() });
        else if (c === "scripts-grant") grantAppManagement();
        else if (c === "new") openNewMenu({ centered: true });
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

  /** A firefly's right-click menu: focus, rename, move or close its pane. */
  flyMenu(a) {
    const props = { role: "menu", tab: "fly", target: { id: a.tab, address: a.address } };
    openOverlay({ mod: "nocturne", kind: "popup", frame: "none", width: 280, height: Math.min(520, menuHeight(props)), props });
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
    return div().id("fold").flex_none().px(5).h(18).flex().items_center().text_size(11).text_color(t.dim)
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
    const beat = landing ? FLAP.working : FLAP[a.status];
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
    const x = 6; // the halo's edge lines up with the eyebrow; every mark in one column
    const drift = a.status === "working" && this.naming !== a.address;
    const color = a.status === "idle" ? t.muted : t[a.status] ?? t.dim;
    const glow = svg(`${ART}/glow.svg`).w(40).h(40).absolute().top(0).left(0).text_color(color);
    const landing = this.landing?.get(a.address);
    // Landing: the last awake glow and mark fade out over the resting mark
    // (a loop's first half, removed once it's out).
    const fade = (el) => el.loop("opacity", { from: 1, to: 0, period: LAND * 2, easing: "ease-out" });
    const halo = landing ? fade(glow.text_color(landing.color))
      : a.status === "working" ? glow.loop("opacity", { from: 0.35, to: 1, period: 1500 + (h % 900) })
      : a.status === "blocked" ? glow.loop("opacity", { from: 0.1, to: 1, period: 650, easing: "linear" })
      : a.status === "done" ? glow : null;
    // The firefly's body is its agent's mark, on a dark plate so the halo's
    // dots don't run into it. Resting ones have no halo, only the dim mark.
    const fly = div().relative().size(40).flex_none()
      .when(Boolean(halo), (el) => el.child(halo).child(div().absolute().top(10).left(10).size(20).bg(t.background)))
      .child(this.wings(a, h, color, landing))
      .child(div().absolute().top(12).left(12).size(16).overflow_hidden()
        .child(this.mark(a, color))
        .when(Boolean(landing), (el) => el.child(fade(div().absolute().top(0).left(0).size(16).child(this.mark(a, landing.color)))))
        // Alive: a band of night-colored dither sweeps across the mark. Over
        // the plate it vanishes, so only the mark's own pixels darken, like a
        // scanline over a sprite. Working sweeps slowly, blocked fast.
        .when(SWEEP[a.status] != null, (el) => el.child(div().absolute().top(0).h(16).w(6)
          .loop("left", { from: -6, to: 16, period: SWEEP[a.status] + (h % 400), easing: "linear" })
          .child(dither(t.background, 1)))))
      // Done says so by shape too, not only by its green: a check on the mark.
      .when(a.status === "done", (el) => el.child(this.doneBadge(t).absolute().top(22).left(22)));
    // The pane's name leads (the agent's own when nobody named it). Only
    // what the halo doesn't already say follows: its space when that isn't
    // the shown one; awake ones add their status on a second line, resting
    // ones keep to one. The focused one stands in a moonlit path: a dithered band
    // behind its name that thins out in three steps, and only its name is bright.
    const title = givenName(a.address) ?? (a.program?.agent ? a.program.name : a.title || a.program?.name || a.address);
    const naming = this.naming === a.address;
    const resting = a.status === "idle" || lane < 32;
    const elsewhere = a.space_name && a.space !== this.shownSpace ? a.space_name : null;
    const whereColor = a.focused ? t.foreground : a.status === "blocked" ? t.blocked : t.muted;
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
            : div().truncate().text_size(11).text_color(t.dim).child(sub))));
    const step = (o) => div().flex_1().h_full().relative().opacity(o).child(dither(t.ansi0, 1));
    const path = h_flex().absolute().top(4).bottom(4).left(x + 36).right(0).gap(2)
      .child(step(1).flex_grow(3)).child(step(0.6)).child(step(0.3));
    // Working fireflies also bob: a layer inside the lane rises and falls a
    // little, so the lane itself can fly to a new spot (to rest, say).
    const inner = div().absolute().top(0).left(0).w(w).h(lane)
      .child(drift ? body.loop("left", { from: x, to: x + 4 + (h % 3), period: 5200 + (h % 2400) }) : body);
    return div().id(`lane-${a.address}`).absolute().left(0).w(w).h(lane).top(y)
      .transition("top", { duration: LAND, easing: "ease-in-out" })
      .when(a.focused, (el) => el.child(path))
      .child(drift ? inner.loop("top", { from: 0, to: -6, period: 2300 + (h % 1100) }) : inner);
  }

  // Awake fireflies (blocked, working, done: agentRank) spread through the sky above
  // the grass; resting ones sit in a stack on the near ridge.
  meadow(t, list) {
    const { width: w, height: hgt } = this.field;
    const awake = list.filter((a) => a.status !== "idle");
    const resting = list.filter((a) => a.status === "idle");
    const ground = hgt - 96; // above the far ridge (hills-rim), so labels stay on clear sky
    let lane = 40, restLane = 28;
    const need = awake.length * lane + resting.length * restLane + 16;
    let placed = [];
    let more = 0;
    if (need <= ground) {
      // Room to spare: awake ones spread out, the rest settle on the ground.
      const restTop = ground - resting.length * restLane;
      const step = awake.length ? Math.min(46, (restTop - 8) / awake.length) : 0;
      awake.forEach((a, i) => placed.push([a, Math.round(8 + i * step), lane]));
      resting.forEach((a, i) => placed.push([a, restTop + i * restLane, restLane]));
    } else {
      // Crowded: one tight list, then a count.
      lane = 24;
      const fit = Math.max(1, Math.floor((ground - 8) / lane) - 1);
      list.slice(0, fit).forEach((a, i) => placed.push([a, 8 + i * lane, lane]));
      more = list.length - fit;
    }
    return div().id("meadow").relative().flex_1().min_h(0).w_full()
      .on_size_change((size, cx) => { this.field = size; cx.notify(); })
      .children(placed.map(([a, y, l]) => this.firefly(t, a, y, l, w)))
      .when(more > 0, (el) => el.child(div().id("more").absolute().left(50).top(8 + placed.length * lane)
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
    return div().id("fold").flex_none().w(28).h(20).flex().items_center().justify_center()
      .border(1).border_color(t.ansi0).text_size(11).text_color(t.muted)
      .hover((s) => s.text_color(t.foreground).bg(t.ansi0).border_color(t.ansi8))
      .tooltip("Open the sidebar (⌘B)")
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); this.fold(cx); })
      .child("»");
  }

  /** A space's rail row: its initials, its status pip at the right edge; the
   *  shown one on the dithered band with a blue edge (like a tile's foot). */
  railSpace(t, s) {
    // On the night's own ground, so no star lands beside a letter like a stray mark.
    return h_flex().id(`rail-space-${s.id}`).relative().w_full().h(24).flex_none().pl(12).pr(10).items_center().text_size(11)
      .bg(t.background).text_color(s.active ? t.foreground : t.muted)
      .hover((st) => st.text_color(t.foreground).bg(t.ansi0 + "55"))
      .tooltip(s.name)
      .on_mouse_down("left", stop)
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.spaces.menu(s); })
      .on_click(() => run("space.select", { id: s.id }))
      .when(s.active, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
      .child(div().relative().flex_1().min_w(0).child(this.initials(s.name)))
      .child(div().relative().child(pip(t, s.status)));
  }

  /** Folded: the moon and the hour, », a row per space (sidebar order), every firefly's mark, the usage. */
  rail(t, list) {
    const rows = this.spaces.rows().filter((r) => r.s);
    const flies = list.map((a) => {
      const color = a.status === "idle" ? t.muted : t[a.status] ?? t.dim;
      return div().id(`rail-fly-${a.address}`).relative().size(32).flex_none().flex().items_center().justify_center()
        .hover((s) => s.bg(t.ansi0 + "55"))
        .tooltip(`${givenName(a.address) ?? a.program?.name ?? a.title ?? a.address}${a.space_name ? ` · ${a.space_name}` : ""} · ${WORD[a.status] ?? a.status}`)
        .on_mouse_down("left", stop)
        .on_click(() => run("agent.focus", { terminal: a.address }))
        .when(a.focused, (el) => el.child(dither(t.ansi0, 1)))
        .when(a.status === "blocked", (el) => el.child(svg(`${ART}/glow.svg`).size(32).absolute().top(0).left(0).text_color(color)
          .loop("opacity", { from: 0.1, to: 1, period: 650, easing: "linear" })))
        .child(div().relative().child(this.mark(a, color)))
        .when(a.status === "done", (el) => el.child(this.doneBadge(t).absolute().bottom(2).right(2)));
    });
    const rule = () => div().w(28).h(2).flex_none().relative().child(dither(t.ansi8, 1));
    return v_flex().w_full().flex_1().min_h(0).pt(48).items_center()
      .child(v_flex().id("rail-clock").flex_none().items_center().tooltip(this.clock.date)
        .child(svg(`${ART}/moon-${moonPhase(list)}.svg`).size(32).flex_none().text_color(t.ansi7))
        .child(div().pt(4).text_size(11).text_color(t.foreground).child(this.clock.time)))
      .child(div().pt(10).pb(14).flex_none().child(this.openKey(t)))
      .child(v_flex().w_full().px(8).py(2).flex_none().bg(t.background).children(rows.map(({ s }) => this.railSpace(t, s))))
      .child(div().py(12).flex_none().child(rule()))
      .child(v_flex().id("rail-flies").w_full().flex_1().min_h(0).gap(2).items_center().overflow_y_scroll().children(flies))
      .child(this.usage.rail(t));
  }

  render(cx) {
    const t = theme();
    const list = [...agents()].sort((a, b) => (agentRank(a) - agentRank(b)) || (b.pinned - a.pinned));
    setAgentOrder(list.map((a) => a.address));
    const sp = spaces();
    this.shownSpace = sp.find((s) => s.active)?.id ?? null;
    this.redraw(cx, sp);
    this.answerNaming(list);
    this.spaces.answer(this.folded, cx);
    const sky = v_flex().id("sky").relative().size_full().overflow_hidden().bg(t.background)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); });
    if (this.folded) {
      return sky
        // Fainter stars than open: here they'd sit between small controls.
        .child(svg(`${ART}/stars.svg`).w(480).h(900).absolute().top(0).left(0).text_color(t.ansi8).opacity(0.3))
        // The hills rest on the usage, as open, never behind its numbers.
        .child(svg(`${ART}/hills-fill.svg`).w(480).h(144).absolute().bottom(this.usage.railHeight).left(0).text_color(t.background))
        .child(svg(`${ART}/hills-rim.svg`).w(480).h(144).absolute().bottom(this.usage.railHeight).left(0).text_color(t.ansi8).opacity(0.5))
        .child(this.rail(t, list));
    }
    // The usage section sits at the foot; the haze and hills rest on it.
    const lift = this.usage.height;
    return sky
      // Backdrop, back to front: stars, moonlight haze, ground, its lit rim.
      .child(svg(`${ART}/stars.svg`).w(480).h(900).absolute().top(0).left(0).text_color(t.ansi8).opacity(0.55))
      .child(svg(`${ART}/haze.svg`).w(480).h(1400).absolute().bottom(lift).left(0).text_color(t.ansi4).opacity(0.2))
      .child(svg(`${ART}/hills-fill.svg`).w(480).h(144).absolute().bottom(lift).left(0).text_color(t.background))
      .child(svg(`${ART}/hills-rim.svg`).w(480).h(144).absolute().bottom(lift).left(0).text_color(t.ansi8).opacity(0.5))
      .child(div().absolute().top(14).right(10).child(this.foldButton(t, "«")))
      .child(this.header(t, list))
      .child(this.spaces.render(t))
      .child(div().px(16).pt(8).flex_none().child(eyebrow(t, "fireflies")))
      .child((this.land(t, list, cx), this.meadow(t, list)))
      .child(this.usage.render(t));
  }
}
