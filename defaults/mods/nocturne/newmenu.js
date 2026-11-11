// The "+ new" menu ({ role: "new" }, an overlay from the tab strip).
//
//   landing   the switch at the top says where new things go: a pane beside
//             the focused one, or a tab of their own. Its little picture shows
//             the landing spot in dithered blue. Tab flips it; it's
//             remembered (shared(DEST)).
//   panels    a grid of tiles (menuPanels): terminal, web, files, agents,
//             usage, in fixed columns (a short last row keeps them). The
//             panels that float over the tab (worktrees, Git, its diff,
//             GitHub) aren't here: the strip's git button and its ▾, their
//             keys and the palette open them. Files runs down the tab's edge
//             when "pane" is picked; open ones say so with a corner mark and
//             close on a second pick.
//   agents    every installed agent, started at the landing spot
//   space     a new space, or a worktree (made or opened)
//   footer    what the item under the cursor will do, in words
//
// Keys: the letter on a tile / 1..9 for an agent (shift: the other landing
// spot, once); ← → ↑ ↓ move, enter picks, tab flips the landing, esc closes.

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, knownAgents, run, openOverlay, closeOverlay, props, window as appWindow, keys, shared, setShared } from "herdr";
import { ART, LOGO, dither, eyebrow } from "./kit.js";
import { panels, here, terminalPane, terminalTab } from "./panels.js";
import { openWorktrees } from "./git.js";

// Shared with the shipped new-menu: the last agents each machine reported.
const KNOWN = "new-menu.agents";
// Where new things land: "pane" or "tab".
const DEST = "nocturne.newDest";

export const WIDTH = 352;
const PAD = 12;
const COLS = 4;
const GAP = 4;
const TILE_H = 64;
const ROW = 26;
const HEAD = 44;
const SECTION = 24;
const FOOT = 26;

const stop = (_e, cx) => cx.stop_propagation();
const chrome = (n) => `mods/workspace-chrome/${n}.svg`;

/** The key bound to a global command, in macOS glyphs. */
export function shortcut(name) {
  const all = keys();
  const k = all.find((b) => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  // Taken by the Nocturne layout for something else (cmd-n opens this menu).
  if (all.some((b) => b.section === "layout:nocturne" && b.keys.trim() === k.keys.trim() && b.action !== name)) return "";
  const mac = appWindow()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.keys.trim().split(/\s+/).map((stroke) => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map((m) => alias[m.toLowerCase()] ?? m.toLowerCase()));
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter((m) => held.has(m)).map((m) => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

// The open menu's overlay id, so cmd-n can close it again (null: none open).
export const OPEN = "nocturne.newOpen";

const destNow = () => (shared(DEST) === "tab" ? "tab" : "pane");
const CONTEXT = "NocturneNew";
const FLIP = "nocturne_new::flip";
const CLOSE = "nocturne_new::close";

/** The agents a machine last reported, installed first. */
function agentRows(agents) {
  const installed = agents.filter((a) => a.installed);
  const missing = agents.filter((a) => !a.installed).slice(0, 2);
  return [
    ...installed.map((a, i) => ({ kind: "agent", id: `agent-${a.key}`, a, key: i < 9 ? String(i + 1) : null })),
    ...missing.map((a) => ({ kind: "agent", id: `agent-${a.key}`, a, off: true })),
  ];
}

/** The menu's tiles: every panel (panels.js) that lands in a pane or a tab,
 *  not the ones that float over the tab. */
export const menuPanels = () => panels().filter((p) => p.fixed !== "float");

/** Every pickable item, in cursor order: tiles, agents, space rows. */
function items(agents) {
  const space = here().space;
  const worktree = (action) => () => openWorktrees({ space: space?.id, action });
  return [
    ...menuPanels().map((p) => ({ kind: "tile", id: p.id, p, key: p.key, off: !space && p.id !== "terminal" })),
    ...agentRows(agents),
    { kind: "row", id: "space", icon: "plus", name: "New space", hint: shortcut("space.new"), go: () => run("space.new"), say: "a new space, in your home folder" },
    { kind: "row", id: "wt-new", icon: "git-branch", name: "New worktree…", go: worktree("new"), off: !space, say: "a branch in its own folder, as a space" },
    { kind: "row", id: "wt-open", icon: "folder", name: "Open worktree…", go: worktree("open"), off: !space, say: "a worktree that's already there, as a space" },
  ];
}

/** Opens the menu, or closes it when it's open: hanging under the tab
 *  strip's "+ new" (`at`, kit.js dropBelow; else under the pointer), dead
 *  center from a key (cmd-n), where the pointer could be anywhere. A dialog
 *  also takes the keyboard, so esc and the menu's keys reach it.
 *  `wasOpen`: "+ new" was lit when pressed (tabs.js tool): the press closed
 *  the menu already, or closes it now; either way it stays closed. */
export function openNewMenu({ centered = false, at = null, wasOpen = false } = {}) {
  const open = shared(OPEN);
  if (open) {
    setShared(OPEN, null);
    closeOverlay(open);
    return;
  }
  if (wasOpen) return;
  setShared(OPEN, openOverlay({ mod: "nocturne", kind: centered ? "dialog" : "popup", frame: "none", width: WIDTH, height: newMenuHeight(),
    ...(at && !centered ? { at } : {}), props: { role: "new" } }));
}

/** The menu is open (the strip lights "+ new" and drops its tooltip). */
export const newMenuOpen = () => Boolean(shared(OPEN));

/** How tall the menu is for the agents it last found on the shown space's machine. */
export function newMenuHeight() {
  const machine = spaces().find((s) => s.active)?.machine ?? "";
  const n = Math.max(1, agentRows(shared(KNOWN)?.[machine] ?? []).length);
  const tiles = Math.ceil(menuPanels().length / COLS);
  return Math.min(640, HEAD + SECTION + tiles * TILE_H + (tiles - 1) * GAP + SECTION + n * ROW + SECTION + 3 * ROW + 8 + FOOT + 2);
}

export default class NewMenu {
  init(_props, cx) {
    const machine = spaces().find((s) => s.active)?.machine ?? null;
    this.agents = shared(KNOWN)?.[machine ?? ""] ?? [];
    this.cursor = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // The overlay takes the keyboard once it's shown; take it back.
    for (const ms of [60, 250, 600]) cx.timer.after(ms, () => this.handle.focus());
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
      } catch { /* the key handler still tries */ }
    }
    cx.spawn(async (cx) => {
      try {
        this.agents = await knownAgents({ on: machine });
        setShared(KNOWN, { ...shared(KNOWN), [machine ?? ""]: this.agents });
      } catch { this.failed = true; }
      cx.notify();
    });
  }

  dismiss() { closeOverlay(props().overlay); }

  /** The overlay is going (any way: a pick, esc, a click beside it, cmd-n). */
  closing() {
    if (shared(OPEN) === props().overlay) setShared(OPEN, null);
  }

  /** Flips where new things land (Tab, or its action). Once per press. */
  flip(cx) {
    if (Date.now() - (this.flipped ?? 0) < 80) return;
    this.flipped = Date.now();
    setShared(DEST, destNow() === "tab" ? "pane" : "tab");
    cx.notify();
  }

  /** Runs an item at `dest` (the switch's, unless shift asked for the other). */
  pick(x, dest = destNow()) {
    if (!x || x.off) return;
    this.dismiss();
    if (x.kind === "tile") return dest === "tab" ? x.p.tab() : x.p.pane();
    if (x.kind === "agent") return dest === "tab" ? terminalTab(x.a.run, x.a.name) : terminalPane(x.a.run);
    x.go();
  }

  /** What picking `x` will do, for the footer. */
  say(x, dest) {
    if (!x) return "";
    if (x.off) return x.kind === "agent" ? `${x.a.name} isn't installed here` : "open a space first";
    if (x.kind === "row") return x.say;
    const name = x.kind === "agent" ? x.a.name : x.p.name.toLowerCase();
    if (dest === "tab") return `${name} in a new tab`;
    if (x.kind === "tile") {
      if (x.p.open?.()) return `closes the ${name}`;
      if (x.p.fixed === "edge") return `${name} along the tab's right edge`;
    }
    return `${name} in a new pane`;
  }

  // ---- parts

  /** The landing picture: the tab as a frame, the spot that's coming in dithered blue. */
  picture(t, dest) {
    const glow = (el) => el.loop("opacity", { from: 0.55, to: 1, period: 1800 });
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
  switcher(t, dest) {
    const opt = (id, label) => {
      const on = dest === id;
      return div().id(`nm-dest-${id}`).relative().h(20).px(7).flex().items_center().text_size(11)
        .text_color(on ? t.foreground : t.dim).hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); setShared(DEST, id); cx.notify(); })
        .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)))
        .child(div().relative().child(label));
    };
    return h_flex().flex_none().items_center().child(opt("pane", "pane")).child(opt("tab", "new tab"));
  }

  head(t, dest) {
    return h_flex().relative().h(HEAD).flex_none().px(PAD).gap(10).items_center()
      .child(this.picture(t, dest))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child("New"))
      .child(div().flex_none().h(16).px(4).flex().items_center().border(1).border_color(t.ansi0).text_size(10).text_color(t.dim)
        .tooltip("tab flips where new things land").child("tab"))
      .child(this.switcher(t, dest))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }

  section(t, label, aside) {
    return h_flex().h(SECTION).flex_none().px(PAD).pt(6).gap(8).items_center()
      .child(eyebrow(t, label))
      .child(div().flex_1().h(1).relative().opacity(0.6).child(dither(t.ansi8, 1)))
      .when(Boolean(aside), (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child(aside)));
  }

  hoverTo(x, live) {
    return (h, cx) => { if (h && !x.off) { const i = live.indexOf(x); if (i !== this.cursor) { this.cursor = i; cx.notify(); } } };
  }

  /** A panel tile: a strip along its top (where it always lands, left; its key,
   *  right), then its icon and name. Open ones carry a blue mark before the label. */
  tile(t, x, on, live, dest) {
    const open = !x.off && x.p.open?.();
    const color = x.off ? t.ansi8 : on ? t.foreground : t.muted;
    const fixed = dest === "pane" ? x.p.fixed : null;
    // Every tile keeps its 1 px border (only its color changes), so hovering doesn't move anything.
    return v_flex().id(`nm-${x.id}`).relative().flex_1().min_w(0).h(TILE_H).px(5).pt(3).pb(7)
      .border(1).border_color(on && !x.off ? t.ansi8 : t.ansi0)
      .on_hover(this.hoverTo(x, live))
      .on_click((e) => this.pick(x, e?.modifiers?.shift ? (dest === "tab" ? "pane" : "tab") : dest))
      .when(on && !x.off, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)))
      .child(h_flex().relative().h(12).flex_none().gap(3).items_center().text_size(9)
        .when(open, (el) => el.child(div().size(4).flex_none().bg(t.accent)))
        .child(div().flex_1().min_w(0).truncate().text_color(open ? t.accent : t.dim).child(open ? "open" : fixed ?? ""))
        .child(div().flex_none().text_size(10).text_color(on ? t.accent : t.dim).child(x.key)))
      .child(v_flex().relative().flex_1().items_center().justify_center().gap(5)
        .child(svg(x.p.icon.includes("/") ? x.p.icon : chrome(x.p.icon)).size(16).flex_none().text_color(x.off ? t.ansi8 : on || open ? t.accent : t.dim))
        .child(div().max_w_full().truncate().text_size(11).text_color(color).child(on && open ? "close" : x.p.name)));
  }

  /** An agent's mark: its dithered logo, else Herdr's icon for it. */
  mark(t, a, color) {
    const key = LOGO[a.key] ?? LOGO[a.app];
    if (key) return svg(`${ART}/logo-${key}.svg`).size(14).flex_none().text_color(color);
    if (!a.icon) return svg(`${ART}/logo-agent.svg`).size(14).flex_none().text_color(color);
    return a.tint ? svg(a.icon).size(14).flex_none().text_color(color) : image(a.icon).size(14).flex_none().opacity(a.installed ? 1 : 0.4);
  }

  row(t, x, on, live, dest, mark, name, hint) {
    return h_flex().id(`nm-${x.id}`).relative().h(ROW).flex_none().px(PAD).gap(10).items_center().text_size(12)
      .text_color(x.off ? t.ansi8 : on ? t.foreground : t.muted)
      .on_hover(this.hoverTo(x, live))
      .on_click((e) => this.pick(x, e?.modifiers?.shift ? (dest === "tab" ? "pane" : "tab") : dest))
      .when(on && !x.off, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
      .child(div().relative().w(14).flex_none().flex().items_center().justify_center().child(mark))
      .child(div().relative().flex_1().min_w(0).truncate().child(name))
      .child(div().relative().flex_none().text_size(11).text_color(on && !x.off ? t.accent : t.dim).child(hint ?? ""));
  }

  foot(t, x, dest) {
    return h_flex().relative().h(FOOT).flex_none().px(PAD).gap(6).items_center().text_size(11)
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
      .child(div().flex_none().text_color(t.accent).child("↳"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(this.say(x, dest)))
      .child(div().flex_none().text_color(t.dim).child("shift: other"));
  }

  key(e, cx, live) {
    const m = e.modifiers;
    if (m.control || m.platform || m.alt) return;
    const k = String(e.key ?? "").toLowerCase(), n = live.length;
    const cur = live[this.cursor];
    // In the grid, ↑ ↓ move by a row of tiles.
    const tiles = live.filter((x) => x.kind === "tile").length;
    const inGrid = cur?.kind === "tile";
    const other = destNow() === "tab" ? "pane" : "tab";
    let done = true;
    if (k === "tab") this.flip(cx);
    else if (k === "right" || k === "left") this.cursor = (this.cursor + (k === "right" ? 1 : -1) + n) % n;
    else if (k === "down") this.cursor = inGrid && this.cursor + COLS < tiles ? this.cursor + COLS : inGrid ? tiles : (this.cursor + 1) % n;
    else if (k === "up") this.cursor = inGrid ? (this.cursor >= COLS ? this.cursor - COLS : (this.cursor - 1 + n) % n) : this.cursor === tiles ? tiles - 1 : (this.cursor - 1 + n) % n;
    else if (k === "enter") { cx.stop_propagation(); return this.pick(cur, m.shift ? other : destNow()); }
    else if (k === "escape") { cx.stop_propagation(); return this.dismiss(); }
    else {
      // A tile's letter or an agent's number: the key itself, or what it types.
      const typed = [k, String(e.key_char ?? "").toLowerCase()];
      const x = live.find((y) => y.key && typed.includes(y.key));
      if (x) { cx.stop_propagation(); return this.pick(x, m.shift ? other : destNow()); }
      done = false;
    }
    if (done) { cx.stop_propagation(); cx.notify(); }
  }

  render() {
    const t = theme();
    const dest = destNow();
    const all = items(this.agents);
    const live = all.filter((x) => !x.off);
    this.cursor = Math.min(this.cursor, Math.max(0, live.length - 1));
    const current = live[this.cursor];
    const tiles = all.filter((x) => x.kind === "tile");
    const grid = [];
    for (let i = 0; i < tiles.length; i += COLS) {
      const slice = tiles.slice(i, i + COLS);
      grid.push(h_flex().id(`nm-grid-${i}`).gap(GAP).w_full()
        .children(slice.map((x) => this.tile(t, x, x === current, live, dest)))
        // A short last row keeps the columns: each pad is a tile's box (its
        // padding and border count toward a flex_1 item's width), left empty.
        .children(Array.from({ length: COLS - slice.length }, (_, j) => div().id(`nm-pad-${i}-${j}`).flex_1().min_w(0).h(TILE_H).px(5).border(1).border_color(t.background))));
    }
    const ags = all.filter((x) => x.kind === "agent");
    const rows = all.filter((x) => x.kind === "row");
    const machine = here().space?.machine;
    return v_flex().id("nocturne-new").size_full().bg(t.background).border(1).border_color(t.ansi0)
      .key_context(CONTEXT)
      .track_focus(this.handle)
      .on_action(FLIP, (_e, cx) => this.flip(cx))
      .on_action(CLOSE, () => this.dismiss())
      .on_key_down((e, cx) => this.key(e, cx, live))
      .child(this.head(t, dest))
      .child(v_flex().id("nm-body").flex_1().min_h(0).overflow_y_scroll()
        .child(this.section(t, "panels"))
        .child(v_flex().px(PAD).gap(GAP).children(grid))
        .child(this.section(t, "start an agent", machine ? `on ${machine}` : null))
        .children(ags.map((x) => this.row(t, x, x === current, live, dest, this.mark(t, x.a, x.off ? t.ansi8 : x === current ? t.foreground : t.dim),
          x.a.name, x.off ? "not installed" : x.key ?? "")))
        .when(!ags.length, (el) => el.child(div().h(ROW).px(PAD).flex().items_center().text_size(11).text_color(t.dim)
          .child(this.failed ? "couldn't ask for agents" : "looking for agents…")))
        .child(this.section(t, "space"))
        .children(rows.map((x) => this.row(t, x, x === current, live, dest,
          svg(chrome(x.icon)).size(14).flex_none().text_color(x.off ? t.ansi8 : x === current ? t.accent : t.dim), x.name, x.hint)))
        .child(div().h(8).flex_none()))
      .child(this.foot(t, current, dest));
  }
}
