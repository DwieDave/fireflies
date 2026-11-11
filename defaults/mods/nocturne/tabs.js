// The tab strip: tabs sit on a dithered horizon line; the shown one is
// underlined in a blue checker. Right of the tabs, icons only:
//   scripts ▶ and a jar of runs: the script runner (scripts.js); runs the
//           deck's queued jobs (jobs.js)
//   files   the files pane down the tab's right edge (files.js); lit while open
//   git     one button for the repo: the changed files and how far the branch
//           is ahead / behind its upstream; a plain git mark when there's
//           nothing anywhere. Click floats the git window over the tab
//           (git.js, nocturne-git); again closes it. Its ▾ (or a right-click)
//           drops a menu: Git, Diff (Git's review) and GitHub.
//   + new   the Nocturne new menu (newmenu.js)
// Drag a tab along the strip to move it (tabdrag.js): it lifts where it is
// and a stake marks the gap it drops into; leaving the strip drops nothing.
// The drop-downs (+ new, the script deck) hang under their button, right
// edges lined up (kit.js dropBelow); a second press closes them. A rule like
// the ones between the groups closes the strip before the bell's block.
//
// Keys: the strip takes the keyboard from pane.go (cmd-alt-up from a top
// pane), nocturne.tabstrip or nocturne.header (layout.focus). Its cursor
// walks three rows (nav.js STRIP_KEYS; ? lists them): the tabs, the buttons
// and the bell; the focused pane's header (header.js headerControls); the
// shown tab's parked chips. j / ↓ past the last row, esc or q: back to the
// pane; h / ← past the first tab: the sidebar. The header, the chips and the
// bell draw the cursor from shared(nav.js CURSOR).

import { div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, run, theme, shared, setShared, layout, focused, nextCommand } from "herdr";
import { dither, pip, spaceFolder, givenName, dropBelow, navRing } from "./kit.js";
import { openNewMenu, newMenuOpen, WIDTH as NEW_W } from "./newmenu.js";
import { openMenu, openKeys } from "./menu.js";
import { keysHint } from "./keyhelp.js";
import { headerControls, paneMenu, renamePane } from "./header.js";
import { CURSOR, STRIP_KEYS, STRIP_HELP, HEADER_HELP, PARKED_HELP, keyVerb, move, blockOf, hasMod } from "./nav.js";
import { gitState } from "./lazygit.js";
import { gitOpen, toggleGit } from "./git.js";
import { githubOpen } from "./github.js";
import { filesPane, toggleFiles, focusFiles } from "./files.js";
import { scriptsControl, scriptRuns, tellFailures, trackRuns, toggleDeck } from "./scripts.js";
import { runJobs, pendingJobs } from "./jobs.js";
import { watchPrompts } from "./prompt.js";
import { DRAG_START, gapAt, dropIndex, stakeAt, stake, lift } from "./tabdrag.js";

const chrome = (n) => `mods/workspace-chrome/${n}.svg`;

export default class Tabs {
  init(_props, cx) {
    this.pressed = null; // { id, x }: the tab a left press went down on, and where
    this.drag = null; // { id, gap }: the tab being dragged and the gap it's over (tabdrag.js)
    this.order = []; // the active space's tab ids, as last drawn
    this.git = null; // gitState() of the active space's folder, null outside a repo
    this.poll(cx);
    cx.timer.every(5000, (cx) => this.poll(cx));
    // Scripts that failed since the last look get a toast.
    // The deck's queued jobs (jobs.js) run here, on the render queueing them
    // causes; the timer catches any that render missed.
    cx.timer.every(1500, () => { runJobs(); trackRuns().then(() => tellFailures(scriptRuns())); });
    // A switch's sudo prompt gets its small window (prompt.js); it reads only while one runs.
    cx.timer.every(700, () => { watchPrompts(); });
    // The keyboard (nav.js): the row and control the cursor is on, the rows as last drawn.
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.row = "tabs";
    this.cursor = null;
    this.rows = { tabs: [], head: [], parked: [] };
    // "focus" from Herdr (pane.go, layout.focus, a popup over the strip closed);
    // nocturne.tabstrip / nocturne.header (keys.json): into the strip on that
    // row, or back out. Every nocturne.* command reaches every copy: the sky
    // takes its own.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^nocturne\./, "");
        if (c === "focus") this.takeKeys();
        else if (c === "tabstrip") this.toggleKeys("tabs");
        else if (c === "header") this.toggleKeys("head");
        else continue;
        cx.notify();
      }
    });
  }

  // ---- the keyboard (nav.js)

  /** The strip's layout block (the one showing nocturne as the tabs). */
  get block() { return blockOf(layout(), "tabs"); }

  /** The strip has the keyboard (pane.go or layout.focus gave it the block). */
  get navOn() { const b = this.block; return Boolean(b) && focused()?.block === b; }

  /** The rows with something in them, top to bottom. */
  liveRows() { return ["tabs", "head", "parked"].filter((r) => this.rows[r].length); }

  /** The cursor's control (an item of its row). */
  item() { return this.rows[this.row]?.find((x) => x.id === this.cursor) ?? null; }

  /** Puts the cursor on `row` (its `id`, else where it was, else the row's natural start). */
  place(row, id) {
    const items = this.rows[row] ?? [];
    if (!items.length) return;
    this.row = row;
    const start = row === "tabs" ? items.find((x) => x.active)?.id : row === "head" ? items.find((x) => x.id !== "name")?.id : null;
    this.cursor = items.some((x) => x.id === id) ? id : items.some((x) => x.id === this.cursor) ? this.cursor : start ?? items[0].id;
  }

  /** "focus": the keyboard is the strip's. */
  takeKeys() {
    this.handle.focus();
    this.place(this.want ?? this.row, this.want ? null : this.cursor);
    if (!this.item()) this.place("tabs");
    this.want = null;
  }

  /** nocturne.tabstrip / nocturne.header: in on that row; pressed again there, back to the pane. */
  toggleKeys(row) {
    if (this.navOn) {
      if (this.row === row) return this.back();
      return this.place(row, null);
    }
    const b = this.block;
    if (!b) return;
    this.want = row;
    if (row !== this.row) this.cursor = null;
    run("layout.focus", { id: b });
  }

  /** Back to the pane (pane.focus clears the block). */
  back() {
    const pane = focused()?.pane;
    if (pane) run("pane.focus", { pane });
    else run("pane.go", { direction: "down" });
  }

  /** The rows' controls, as the strip, the header and the chips draw them. */
  collect(space, shown) {
    const tabOf = (c) => ({
      id: `tab:${c.id}`, active: c.active,
      go: () => (c.active ? this.back() : run("tab.select", { id: c.id })),
      menu: () => openMenu({ tab: "tab", target: { id: c.id, space: space.id } }, { centered: true }),
      rename: () => run("tab.rename", { id: c.id }),
      close: () => run("tab.close", { id: c.id }),
      "move-left": () => { if (c.index > 1) run("tab.move", { id: c.id, index: c.index - 1 }); },
      "move-right": () => { if (c.index < space.tabs.length) run("tab.move", { id: c.id, index: c.index + 1 }); },
    });
    const gitMenu = () => openMenu({ tab: "git" }, { centered: true });
    const tools = [
      { id: "tab-scripts-run", go: () => toggleDeck({ centered: true }) },
      // As cmd-e: the panel with the keyboard in it (opened if need be); in it, closed.
      { id: "tab-files", go: () => focusFiles() },
      { id: "tab-git", go: () => toggleGit(), menu: gitMenu },
      { id: "tab-git-more", go: gitMenu, menu: gitMenu },
      { id: "tab-new", go: () => openNewMenu({ centered: true }) },
      ...(hasMod(layout(), "nocturne-notifications") ? [{ id: "bell", go: () => run("nocturne-notifications.open") }] : []),
    ];
    const all = panes();
    const fp = all.find((p) => p.focused && !p.parked);
    const head = fp ? headerControls(fp, all).map((c) => ({
      id: c.id, go: c.go, menu: () => paneMenu(fp, true), rename: () => renamePane(fp), close: () => run("pane.close", { pane: fp.pane }),
    })) : [];
    const tab = space?.tabs.find((c) => c.active)?.id;
    const parked = all.filter((p) => p.tab === tab && p.parked).map((p) => ({
      id: `park:${p.pane}`, pane: p.pane,
      go: () => run("pane.unpark", { pane: p.pane }), menu: () => paneMenu(p, true), close: () => run("pane.close", { pane: p.pane }),
    }));
    this.rows = { tabs: [...(space ? shown.map(tabOf) : []), ...tools], head, parked };
  }

  /** A key while the strip has the keyboard. */
  key(e, cx) {
    const verb = keyVerb(e, STRIP_KEYS);
    if (!verb) return;
    cx.stop_propagation();
    const items = this.rows[this.row] ?? [];
    const item = this.item();
    const rows = this.liveRows();
    const r = rows.indexOf(this.row);
    switch (verb) {
      case "left":
        if (this.row === "tabs" && items[0]?.id === this.cursor) return run("pane.go", { direction: "left" });
        this.cursor = move(items, this.cursor, -1); break;
      case "right": this.cursor = move(items, this.cursor, 1); break;
      case "first": this.cursor = items[0]?.id ?? null; break;
      case "last": this.cursor = items.at(-1)?.id ?? null; break;
      case "down": if (r < 0 || r >= rows.length - 1) return this.back(); this.place(rows[r + 1]); break;
      case "up": if (r > 0) this.place(rows[r - 1]); break;
      case "next": case "prev": {
        const flat = rows.flatMap((row) => this.rows[row].map((x) => ({ row, id: x.id })));
        const i = flat.findIndex((x) => x.row === this.row && x.id === this.cursor);
        const n = flat[(i + (verb === "next" ? 1 : -1) + flat.length) % flat.length];
        if (n) { this.row = n.row; this.cursor = n.id; }
        break;
      }
      case "back": return this.back();
      // The row the cursor is on says which keys: the strip's, the header's, the chips'.
      case "help": return this.openHelp();
      case "new": { const sp = spaces().find((s) => s.active); run("tab.new", sp ? { space: sp.id } : {}); return; }
      default:
        if (/^n[1-9]$/.test(verb)) return run("tab.select", { index: Number(verb.slice(1)) });
        item?.[verb]?.(cx);
    }
    this.reveal();
    cx.notify();
  }

  /** Scrolls the strip to the tab under the cursor. */
  reveal() {
    if (this.row !== "tabs") return;
    const i = this.rows.tabs.filter((x) => x.id.startsWith("tab:")).findIndex((x) => x.id === this.cursor);
    if (i >= 0) this.scroll.scroll_to_item(i);
  }

  /** Where the cursor is for the header, the chips and the bell (shared CURSOR), only when it changes. */
  tell(on) {
    const want = !on ? null
      : this.row === "head" ? { region: "head", pane: panes().find((p) => p.focused && !p.parked)?.pane ?? null, item: this.cursor }
      : this.row === "parked" ? { region: "parked", pane: this.item()?.pane ?? null, item: this.cursor }
      : this.cursor === "bell" ? { region: "bell", item: "bell" } : null;
    if (JSON.stringify(want) !== JSON.stringify(shared(CURSOR) ?? null)) setShared(CURSOR, want);
  }

  /** Is the cursor on this control of the strip's own row? */
  at(id) { return this.navOn && this.row === "tabs" && this.cursor === id; }

  // ---- dragging a tab (tabdrag.js)

  /** The pointer moved over a gap while a press is down: past DRAG_START it's
   *  a drag, and the gap it's over is where the stake stands. */
  dragOver(gap, e, cx) {
    const p = this.pressed;
    if (!p) return;
    if (!this.drag) {
      if (Math.abs(e.position.x - p.x) < DRAG_START) return;
      this.drag = { id: p.id, gap: null };
    }
    if (this.drag.gap?.id === gap.id && this.drag.gap?.after === gap.after) return;
    this.drag.gap = gap;
    cx.notify();
  }

  /** The press let go in the strip: a drag drops where its stake stands. */
  drop(cx) {
    const d = this.drag;
    this.drag = null;
    this.pressed = null;
    if (!d) return;
    const index = dropIndex(this.order, d.id, d.gap);
    if (index != null) run("tab.move", { id: d.id, index });
    cx.notify();
  }

  /** The pointer left the strip: the drag ends where it started. */
  cancelDrag(cx) {
    const dragging = Boolean(this.drag);
    this.drag = null;
    this.pressed = null;
    if (dragging) cx.notify();
  }

  // Where the git button looks: the active space's folder, on its machine.
  target() {
    const space = spaces().find((s) => s.active);
    return { folder: spaceFolder(space, panes()), on: space?.machine ?? null };
  }

  poll(cx) {
    const { folder, on } = this.target();
    if (!folder || this.polling) return;
    this.polling = true;
    cx.spawn(async (cx) => {
      try {
        const g = await gitState(folder, on);
        if (JSON.stringify(g) !== JSON.stringify(this.git)) { this.git = g; cx.notify(); }
      } catch { /* not reachable: keep the last state */ }
      finally { this.polling = false; }
    });
  }

  /** A square icon button on the strip; `on`: its panel is open (a dithered band, a blue foot).
   *  `action(e, wasOpen)` gets the press's event, for a drop-down to hang under
   *  the button (dropBelow), and whether the button was lit when pressed: an
   *  open drop-down closes on that very press (a popup closes on any press
   *  beside it, and the press goes on to the button), so by the click nothing
   *  is open; a toggle goes by `wasOpen` and stays closed (scripts.js
   *  toggleDeck, newmenu.js openNewMenu). No `tip`: no tooltip (one over an
   *  open drop-down would sit on it). */
  tool(t, id, on, tip, action, ...kids) {
    return h_flex().id(id).relative().flex_none().h(24).px(7).gap(5).items_center().text_size(11)
      .text_color(on ? t.foreground : t.muted)
      .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.press = { e, on }; })
      .on_click(() => action(this.press?.e, Boolean(this.press?.on)))
      .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(4).right(4).bottom(0).h(2).bg(t.accent)))
      .children(kids.map((k) => k.relative()))
      .map((el) => navRing(t, el, this.at(id)));
  }

  filesButton(t) {
    const on = Boolean(filesPane());
    return this.tool(t, "tab-files", on, on ? "Close files" : "Files", () => toggleFiles(),
      svg(chrome("files")).size(14).text_color(on ? t.accent : t.muted));
  }

  /** Changes and branch state in one: ±n, ↑ahead, ↓behind; else the git mark alone. */
  gitButton(t) {
    const g = this.git;
    const open = Boolean(gitOpen());
    const busy = Boolean(g && (g.changed || g.ahead || g.behind));
    const tip = !g ? "Git (⌘G)"
      : [g.changed ? `${g.changed} changed` : "clean", g.ahead ? `${g.ahead} ahead` : null, g.behind ? `${g.behind} behind` : null]
        .filter(Boolean).join(" · ") + (g.branch ? ` on ${g.branch}` : "") + " · Git (⌘G)";
    const num = (s, c) => div().flex_none().text_color(c).child(s);
    const menu = (e) => openMenu({ tab: "git" }, { at: dropBelow(e, 220) });
    const github = Boolean(githubOpen());
    return h_flex().id("tab-git-group").flex_none().items_center()
      .on_mouse_down("right", (e, cx) => { cx.stop_propagation(); menu(e); })
      .child(this.tool(t, "tab-git", open, tip, () => toggleGit(),
        svg(chrome(busy ? "git-compare" : "git-branch")).size(14).text_color(open ? t.accent : g?.changed ? t.ansi3 : t.muted),
        ...(g?.changed ? [num(String(g.changed), t.ansi3)] : []),
        ...(g?.ahead ? [num(`↑${g.ahead}`, t.ansi4)] : []),
        ...(g?.behind ? [num(`↓${g.behind}`, t.ansi5)] : [])))
      .child(this.tool(t, "tab-git-more", github, null, (e) => menu(e), div().text_size(9).text_color(github ? t.accent : t.dim).child("▾")).px(3));
  }

  /** "+ new": its menu hangs under it; lit (the open look) while it's open. */
  newButton(t) {
    const open = newMenuOpen();
    return this.tool(t, "tab-new", open, open ? null : "New (⌘N)", (e, wasOpen) => openNewMenu({ at: dropBelow(e, NEW_W), wasOpen }),
      div().text_color(open ? t.foreground : t.muted).child("+ new"));
  }

  /** ?: the keys of the row the cursor is on (menu.js openKeys, keyhelp.js's overview). */
  openHelp() {
    return this.row === "head" ? openKeys("pane header keys", HEADER_HELP)
      : this.row === "parked" ? openKeys("parked pane keys", PARKED_HELP) : openKeys("tab strip keys", STRIP_HELP);
  }

  render() {
    if (pendingJobs()) runJobs();
    const t = theme();
    const space = spaces().find((s) => s.active);
    const shown = (space?.tabs ?? []).filter((c) => !c.settled || c.active);
    const on = this.navOn;
    this.collect(space, shown);
    if (on && !this.item()) this.place(this.liveRows().includes(this.row) ? this.row : "tabs");
    this.tell(on);
    this.order = (space?.tabs ?? []).map((c) => c.id);
    const drag = this.drag;
    const at = drag ? stakeAt(this.order, shown.map((c) => c.id), drag.id, dropIndex(this.order, drag.id, drag.gap)) : null;
    const item = (c) => {
      const lead = panes().find((p) => p.tab === c.id && p.program?.agent) ?? panes().find((p) => p.tab === c.id);
      // An unnamed tab goes by its lead pane: the name it was given, else its agent's or program's.
      const name = c.named ? c.name : givenName(lead?.terminal) ?? (lead?.program?.agent ? lead.program.name : lead?.title || lead?.program?.name || c.name);
      const prog = lead?.program;
      const lifted = drag?.id === c.id;
      return h_flex().id(`tab-${c.id}`).relative().h_full().px(12).gap(7).items_center().flex_none()
        .text_size(11).text_color(c.active || lifted ? t.foreground : t.muted)
        .hover((s) => s.text_color(t.foreground))
        // Dragged: lifted where it is, behind its words.
        .when(lifted, (el) => el.children(lift(t)))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = { id: c.id, x: e.position.x }; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_move((e, cx) => this.dragOver(gapAt(c.id, e.local_position.x, e.bounds.width), e, cx))
        // A click (no drag) shows the tab; a drag drops in the strip's mouse up.
        .on_mouse_up("left", () => { if (!this.drag && this.pressed?.id === c.id) run("tab.select", { id: c.id }); })
        // Middle click closes the tab, as in a browser.
        .on_mouse_down("middle", (_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openMenu({ tab: "tab", target: { id: c.id, space: space.id } }); })
        .child(div().text_color(c.active || lifted ? t.accent : t.dim).child(String(c.index)))
        .when(Boolean(prog?.icon), (el) => el.child(prog.tint ? svg(prog.icon).size(12).text_color(c.active ? t.foreground : t.dim) : image(prog.icon).size(12)))
        .child(div().max_w(180).truncate().child(c.zoomed ? `${name} [z]` : name))
        .child(pip(t, c.status))
        .when(c.active, (el) => el.child(div().absolute().left(8).right(8).bottom(0).h(4).child(dither(t.accent, 2))))
        .map((el) => navRing(t, el, this.at(`tab:${c.id}`)))
        .when(at?.before === c.id, (el) => el.child(stake(t)));
    };
    // Past the last tab: the gap at the end, at least wide enough to aim at.
    const end = div().id("tab-end").relative().flex_1().min_w(24).h_full()
      .on_mouse_move((e, cx) => this.dragOver({ id: null, after: false }, e, cx))
      .when(Boolean(at) && at.before === null, (el) => el.child(stake(t)));
    const rule = () => div().w(1).h(14).mx(4).flex_none().bg(t.ansi0);
    return h_flex().id("tabs").relative().size_full().min_w(0).pr(0).items_center().bg(t.background)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_up("left", (_e, cx) => this.drop(cx))
      .on_hover((hovered, cx) => { if (!hovered) this.cancelDrag(cx); })
      .when(Boolean(drag), (el) => el.cursor_grabbing())
      .on_scroll_wheel((e) => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      // The horizon: a 2 px dithered line the tabs stand on.
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)))
      // Its left padding inside the scroll, so a stake before the first tab isn't cut.
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().pl(4).items_center().overflow_x_scrollbar().track_scroll(this.scroll).children(shown.map(item)).child(end))
      .child(h_flex().flex_none().gap(2).items_center()
        .child(scriptsControl(t, (...a) => this.tool(...a)))
        .child(rule())
        .child(this.filesButton(t))
        .child(this.gitButton(t))
        .child(rule())
        .child(this.newButton(t))
        .child(rule()))
      // While the strip has the keyboard: which row its cursor is on, and ? for
      // the keys, the strip's last word (after its buttons, as every keys bar).
      .when(on, (el) => el.child(h_flex().flex_none().px(6).gap(6).items_center().text_size(11).text_color(t.dim)
        .when(this.row !== "tabs", (e2) => e2.child(div().child(this.row === "head" ? "pane ←→ ⏎ ·" : "parked ⏎ ·")))
        .child(keysHint(t, "strip-keys", false, () => this.openHelp()))));
  }
}
