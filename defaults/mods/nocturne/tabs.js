// The tab strip: tabs sit on a dithered horizon line; the shown one is
// underlined in a blue checker. Right of the tabs, icons only:
//   scripts ▶ and a jar of runs: the script runner (scripts.js); runs the
//           deck's queued jobs (jobs.js)
//   files   the files pane down the tab's right edge (files.js); lit while open
//   git     one button for the repo: the changed files and how far the branch
//           is ahead / behind its upstream; a plain git mark when there's
//           nothing anywhere. Click floats the git float over the tab
//           (lazygit.js) on its diff when there are changes, else on lazygit;
//           again closes it.
//   + new   the Nocturne new menu (newmenu.js)
// The drop-downs (+ new, the script deck) hang under their button, right
// edges lined up (kit.js dropBelow); a second press closes them. A rule like
// the ones between the groups closes the strip before the bell's block.

import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme } from "herdr";
import { dither, pip, spaceFolder, givenName, dropBelow } from "./kit.js";
import { openNewMenu, newMenuOpen, WIDTH as NEW_W } from "./newmenu.js";
import { menuHeight } from "./menu.js";
import { lazygitOpen, toggleLazygit, toggleDiff, gitState } from "./lazygit.js";
import { filesPane, toggleFiles } from "./files.js";
import { scriptsControl, scriptRuns, tellFailures, trackRuns } from "./scripts.js";
import { runJobs, pendingJobs } from "./jobs.js";
import { watchPrompts } from "./prompt.js";

const chrome = (n) => `mods/workspace-chrome/${n}.svg`;

export default class Tabs {
  init(_props, cx) {
    this.pressed = null;
    this.git = null; // gitState() of the active space's folder, null outside a repo
    this.poll(cx);
    cx.timer.every(5000, (cx) => this.poll(cx));
    // Scripts that failed since the last look get a toast.
    // The deck's queued jobs (jobs.js) run here, on the render queueing them
    // causes; the timer catches any that render missed.
    cx.timer.every(1500, () => { runJobs(); trackRuns().then(() => tellFailures(scriptRuns())); });
    // A switch's sudo prompt gets its small window (prompt.js); it reads only while one runs.
    cx.timer.every(700, () => { watchPrompts(); });
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
   *  `action` gets the press's event, for a drop-down to hang under the button
   *  (dropBelow). No `tip`: no tooltip (one over an open drop-down would sit on it). */
  tool(t, id, on, tip, action, ...kids) {
    return h_flex().id(id).relative().flex_none().h(24).px(7).gap(5).items_center().text_size(11)
      .text_color(on ? t.foreground : t.muted)
      .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.press = e; })
      .on_click(() => action(this.press))
      .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(4).right(4).bottom(0).h(2).bg(t.accent)))
      .children(kids.map((k) => k.relative()));
  }

  filesButton(t) {
    const on = Boolean(filesPane());
    return this.tool(t, "tab-files", on, on ? "Close files" : "Files", () => toggleFiles(),
      svg(chrome("files")).size(14).text_color(on ? t.accent : t.muted));
  }

  /** Changes and branch state in one: ±n, ↑ahead, ↓behind; else the git mark alone. */
  gitButton(t) {
    const g = this.git;
    const open = lazygitOpen();
    const busy = Boolean(g && (g.changed || g.ahead || g.behind));
    const tip = !g ? "Lazygit"
      : [g.changed ? `${g.changed} changed` : "clean", g.ahead ? `${g.ahead} ahead` : null, g.behind ? `${g.behind} behind` : null]
        .filter(Boolean).join(" · ") + (g.branch ? ` on ${g.branch}` : "");
    const go = () => (open ? (lazygitOpen(1) ? toggleDiff() : toggleLazygit()) : g?.changed ? toggleDiff() : toggleLazygit());
    const num = (s, c) => div().flex_none().text_color(c).child(s);
    return this.tool(t, "tab-git", open, tip, go,
      svg(chrome(busy ? "git-compare" : "git-branch")).size(14).text_color(open ? t.accent : g?.changed ? t.ansi3 : t.muted),
      ...(g?.changed ? [num(String(g.changed), t.ansi3)] : []),
      ...(g?.ahead ? [num(`↑${g.ahead}`, t.ansi4)] : []),
      ...(g?.behind ? [num(`↓${g.behind}`, t.ansi5)] : []));
  }

  /** "+ new": its menu hangs under it; lit (the open look) while it's open. */
  newButton(t) {
    const open = newMenuOpen();
    return this.tool(t, "tab-new", open, open ? null : "New (⌘N)", (e) => openNewMenu({ at: dropBelow(e, NEW_W) }),
      div().text_color(open ? t.foreground : t.muted).child("+ new"));
  }

  render() {
    if (pendingJobs()) runJobs();
    const t = theme();
    const space = spaces().find((s) => s.active);
    const shown = (space?.tabs ?? []).filter((c) => !c.settled || c.active);
    const item = (c, i) => {
      const lead = panes().find((p) => p.tab === c.id && p.program?.agent) ?? panes().find((p) => p.tab === c.id);
      // An unnamed tab goes by its lead pane: the name it was given, else its agent's or program's.
      const name = c.named ? c.name : givenName(lead?.terminal) ?? (lead?.program?.agent ? lead.program.name : lead?.title || lead?.program?.name || c.name);
      const prog = lead?.program;
      return h_flex().id(`tab-${c.id}`).relative().h_full().px(12).gap(7).items_center().flex_none()
        .text_size(11).text_color(c.active ? t.foreground : t.muted)
        .hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex((x) => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        // Middle click closes the tab, as in a browser.
        .on_mouse_down("middle", (_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); const props = { role: "menu", tab: "tab", target: { id: c.id, space: space.id } };
          openOverlay({ mod: "nocturne", kind: "popup", frame: "none", width: 220, height: menuHeight(props), props }); })
        .child(div().text_color(c.active ? t.accent : t.dim).child(String(c.index)))
        .when(Boolean(prog?.icon), (el) => el.child(prog.tint ? svg(prog.icon).size(12).text_color(c.active ? t.foreground : t.dim) : image(prog.icon).size(12)))
        .child(div().max_w(180).truncate().child(c.zoomed ? `${name} [z]` : name))
        .child(pip(t, c.status))
        .when(c.active, (el) => el.child(div().absolute().left(8).right(8).bottom(0).h(4).child(dither(t.accent, 2))));
    };
    const rule = () => div().w(1).h(14).mx(4).flex_none().bg(t.ansi0);
    return h_flex().id("tabs").relative().size_full().min_w(0).pl(4).pr(0).items_center().bg(t.background)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel((e) => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      // The horizon: a 2 px dithered line the tabs stand on.
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().overflow_x_scrollbar().children(shown.map(item)))
      .child(h_flex().flex_none().gap(2).items_center()
        .child(scriptsControl(t, (...a) => this.tool(...a)))
        .child(rule())
        .child(this.filesButton(t))
        .child(this.gitButton(t))
        .child(rule())
        .child(this.newButton(t))
        .child(rule()));
  }
}
